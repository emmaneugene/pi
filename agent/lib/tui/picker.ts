/**
 * Reusable, resume-style catalog browser.
 *
 * A filterable picker: a search box, a fuzzy filter, a windowed scroll, and
 * columns. It builds on pi-tui's `SelectList` and wraps it in
 * `ctx.ui.custom()` inside a solid black-backed bordered box, so it stands
 * out from the chat behind it.
 *
 * This picker is an ephemeral overlay, so it writes nothing to the session.
 * Catalogs never leak into the exported history.
 *
 * Selecting a row opens that entry's full artefact in the editor, unless the
 * caller supplies a custom selection action. Even with a custom action, the
 * configured external-editor key still opens the artefact:
 *   - $EDITOR / $VISUAL set → open directly in the external editor (a real
 *     file path when the artefact is a file, otherwise a temp file).
 *   - neither set → fall back to pi's built-in editor (`ctx.ui.editor`).
 */

import { spawn } from "node:child_process";
import { unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type ExtensionContext,
  getSelectListTheme,
  keyHint,
} from "@earendil-works/pi-coding-agent";
import {
  fuzzyFilter,
  matchesKey,
  SelectList,
  type SelectItem,
  truncateToWidth,
  type TUI,
  visibleWidth,
} from "@earendil-works/pi-tui";
import { modalPriority } from "./modal-priority.ts";

export interface CatalogArtifact {
  /** Full artefact text. Used by the builtin editor, and for the external
   *  editor when there is no real file to open. */
  content: string;
  /** Real file path to open directly in $EDITOR (e.g. a SKILL.md). */
  path?: string;
  /** Extension for the temp file written when `content` has no `path`. */
  ext?: string;
}

export interface CatalogEntry {
  /** Row shown in the picker (label = primary column, description = rest). */
  item: SelectItem;
  /** Resolve the artefact to open when this row is selected. */
  artifact: () => CatalogArtifact;
}

/** Result of a ctrl+x action: an optional toast to show afterward. */
export interface KillResult {
  message?: string;
  type?: "info" | "warning" | "error";
}

export interface CatalogOptions {
  /** Max rows visible before scrolling. Defaults to fit the terminal. */
  maxVisible?: number;
  /** Re-read entries at this interval while the picker is open. */
  refreshIntervalMs?: number;
  /** Override the default Enter action that opens the entry's artefact. */
  onSelect?: (entry: CatalogEntry) => Promise<void> | void;
  /**
   * Optional ctrl+x action on the highlighted entry (e.g. stop a running
   * subagent). When set, this shows a `ctrl+x stop` hint. After the action
   * runs, the list refreshes in place so statuses update.
   */
  onKill?: (value: string) => Promise<KillResult | void> | KillResult | void;
}

type CatalogChoice = {
  value: string;
  action: "select" | "artifact";
};

const BG_RESET = "\x1b[49m";

/** Pinned so SelectList's description-column budget is deterministic. */
const PRIMARY_COL = 32;

/** Pre-ellipsize descriptions to fit; SelectList otherwise hard-cuts them with
 *  no "…". Mirrors its width math, one column short so our "…" survives. */
function ellipsizeDescriptions(
  items: SelectItem[],
  inner: number,
): SelectItem[] {
  const PREFIX = 2;
  const effPrimary = Math.max(1, Math.min(PRIMARY_COL, inner - PREFIX - 4));
  const budget = inner - PREFIX - effPrimary - 2 - 1;
  if (inner <= 40 || budget <= 10) return items;
  return items.map((it) =>
    it.description && visibleWidth(it.description) > budget
      ? { ...it, description: truncateToWidth(it.description, budget, "…") }
      : it,
  );
}

/** Wrap content lines in a solid panel-backed bordered box of the given width. */
function boxed(content: string[], width: number, theme: any): string[] {
  const BG = theme.getBgAnsi("customMessageBg");
  const inner = Math.max(1, width - 4);
  const bar = theme.fg("border", "│");
  // Re-assert BG after resets a row may carry (\x1b[0m, \x1b[49m); without this
  // the fill and right border lose their background from the reset onward.
  const keepBg = (s: string): string =>
    s
      .replace(/\x1b\[0m/g, `\x1b[0m${BG}`)
      .replace(/\x1b\[49m/g, `\x1b[49m${BG}`);
  const pad = (line: string): string => {
    let normalized = keepBg(line);
    if (visibleWidth(normalized) > inner) {
      normalized = keepBg(truncateToWidth(normalized, inner, "…"));
    }
    const gap = Math.max(0, inner - visibleWidth(normalized));
    return gap > 0 ? `${normalized}${BG}${" ".repeat(gap)}` : normalized;
  };
  const frame = (chars: string) => BG + theme.fg("border", chars) + BG_RESET;
  return [
    frame(`┌${"─".repeat(width - 2)}┐`),
    ...content.map((line) => `${BG}${bar} ${pad(line)} ${bar}${BG_RESET}`),
    frame(`└${"─".repeat(width - 2)}┘`),
  ];
}

/**
 * Show a filterable picker and resolve to the chosen item's `value`, or
 * `undefined` if cancelled.
 */
async function pickFromList(
  ctx: ExtensionContext,
  title: string,
  getEntries: () => CatalogEntry[],
  opts: CatalogOptions,
): Promise<CatalogChoice | undefined> {
  return ctx.ui.custom<CatalogChoice | undefined>(
    (tui, theme, keybindings, done) => {
      let entries = getEntries();
      const maxVisible =
        opts.maxVisible ??
        Math.max(5, Math.min(entries.length, tui.terminal.rows - 10));
      let query = "";
      let currentInner = -1; // last render width; -1 forces a rebuild on first render

      let settled = false;
      const finish = (result: CatalogChoice | undefined) => {
        if (settled) return;
        settled = true;
        done(result);
      };
      // SelectList's own setFilter is a prefix match on `value`. We want
      // resume-style fuzzy matching on the primary text (the name), so we
      // filter here and rebuild the list when the query changes.
      const visibleItems = (): SelectItem[] => {
        const items = entries.map((e) => e.item);
        return query ? fuzzyFilter(items, query, (i) => i.label) : items;
      };
      const makeList = (visible: SelectItem[]) => {
        const l = new SelectList(
          ellipsizeDescriptions(visible, currentInner),
          maxVisible,
          getSelectListTheme(),
          {
            minPrimaryColumnWidth: PRIMARY_COL,
            maxPrimaryColumnWidth: PRIMARY_COL,
          },
        );
        l.onSelect = (item) => finish({ value: item.value, action: "select" });
        l.onCancel = () => finish(undefined);
        return l;
      };
      let list = makeList(visibleItems());
      // Rebuild after a filter/data change, optionally keeping the cursor on a
      // given value (used to keep focus on a just-killed row).
      const rebuild = (preserveValue?: string) => {
        const visible = visibleItems();
        list = makeList(visible);
        if (preserveValue) {
          const i = visible.findIndex((it) => it.value === preserveValue);
          if (i >= 0) list.setSelectedIndex(i);
        }
      };
      const refreshTimer =
        opts.refreshIntervalMs && opts.refreshIntervalMs > 0
          ? setInterval(() => {
              const selected = list.getSelectedItem()?.value;
              entries = getEntries();
              rebuild(selected);
              tui.requestRender();
            }, opts.refreshIntervalMs)
          : undefined;

      return {
        render(width: number): string[] {
          const prompt = theme.fg("accent", "›");
          const shown =
            query.length > 0 ? query : theme.fg("dim", "type to filter");
          const inner = Math.max(1, width - 4);
          // Re-ellipsize to the current width on first render / resize.
          if (inner !== currentInner) {
            currentInner = inner;
            rebuild(list.getSelectedItem()?.value ?? undefined);
          }
          const body = [
            theme.bold(theme.fg("accent", title)),
            "",
            `${prompt} ${shown}`,
            "",
            ...list.render(inner),
          ];
          const hints: string[] = [];
          if (opts.onSelect) {
            hints.push(keyHint("tui.select.confirm", "view"));
            hints.push(keyHint("app.editor.external", "editor"));
          }
          if (opts.onKill) hints.push("ctrl+x stop");
          if (hints.length > 0)
            body.push("", theme.fg("dim", hints.join(" · ")));
          return boxed(body, width, theme);
        },
        invalidate() {
          list.invalidate();
        },
        handleInput(data: string) {
          if (
            opts.onSelect &&
            keybindings.matches(data, "app.editor.external")
          ) {
            const sel = list.getSelectedItem();
            if (sel) finish({ value: sel.value, action: "artifact" });
          } else if (opts.onKill && matchesKey(data, "ctrl+x")) {
            // ctrl+x: run the kill action on the highlighted row, then refresh.
            const sel = list.getSelectedItem();
            if (sel) {
              void (async () => {
                const res = await opts.onKill!(sel.value);
                if (res?.message)
                  ctx.ui.notify(res.message, res.type ?? "info");
                entries = getEntries();
                rebuild(sel.value);
                tui.requestRender();
              })();
            }
          } else if (matchesKey(data, "backspace")) {
            if (query.length > 0) {
              query = query.slice(0, -1);
              rebuild();
            }
          } else if (data.length === 1 && data.charCodeAt(0) >= 32) {
            query += data;
            rebuild();
          } else {
            // Arrows / enter / escape are owned by SelectList.
            list.handleInput(data);
          }
          tui.requestRender();
        },
        dispose() {
          if (refreshTimer) clearInterval(refreshTimer);
        },
      };
    },
    { overlay: true, overlayOptions: { width: "92%", maxHeight: "90%" } },
  );
}

/** Launch the external editor on `file`, suspending the TUI while it runs. */
function runExternalEditor(
  ctx: ExtensionContext,
  editorCmd: string,
  file: string,
): Promise<void> {
  return ctx.ui.custom<void>((tui: TUI, theme, _kb, done) => {
    // Defer so the overlay mounts before we hand the screen to the editor.
    setTimeout(async () => {
      try {
        tui.stop();
        const [bin, ...args] = editorCmd.split(" ");
        await new Promise<void>((resolve) => {
          const child = spawn(bin!, [...args, file], {
            stdio: "inherit",
            shell: process.platform === "win32",
          });
          child.on("error", () => resolve());
          child.on("close", () => resolve());
        });
      } finally {
        tui.start();
        tui.requestRender(true);
        done();
      }
    }, 0);
    return {
      render: () => [theme.fg("dim", " Opening editor…")],
      invalidate() {},
      handleInput() {},
    };
  });
}

/** Open an artefact: external $EDITOR if available, else the builtin editor. */
async function openArtifact(
  ctx: ExtensionContext,
  title: string,
  art: CatalogArtifact,
): Promise<void> {
  const editorCmd = process.env.VISUAL || process.env.EDITOR;
  if (!editorCmd) {
    await ctx.ui.editor(title, art.content);
    return;
  }
  let file = art.path;
  let temp: string | undefined;
  if (!file) {
    file = join(tmpdir(), `pi-catalog-${Date.now()}${art.ext ?? ".md"}`);
    writeFileSync(file, art.content, "utf-8");
    temp = file;
  }
  try {
    await runExternalEditor(ctx, editorCmd, file);
  } finally {
    if (temp) {
      try {
        unlinkSync(temp);
      } catch {}
    }
  }
}

/**
 * Browse a catalog: filterable picker → select opens the full artefact in the
 * editor → returns to the list. Loops until dismissed. TUI-only.
 */
export async function showCatalog(
  ctx: ExtensionContext,
  title: string,
  entriesArg: CatalogEntry[] | (() => CatalogEntry[]),
  opts: CatalogOptions = {},
): Promise<void> {
  if (ctx.mode !== "tui") {
    ctx.ui.notify(`${title} requires TUI mode`, "error");
    return;
  }
  // Accept a static array or a getter (the getter lets the list refresh in
  // place after a ctrl+x action).
  const getEntries =
    typeof entriesArg === "function" ? entriesArg : () => entriesArg;
  if (getEntries().length === 0) {
    ctx.ui.notify(`No ${title.toLowerCase()} to show.`, "info");
    return;
  }

  await modalPriority.run(async () => {
    for (;;) {
      const choice = await pickFromList(ctx, title, getEntries, opts);
      if (!choice) return;
      const entry = getEntries().find((e) => e.item.value === choice.value);
      if (!entry) continue;
      if (choice.action === "select" && opts.onSelect) {
        await opts.onSelect(entry);
      } else {
        await openArtifact(
          ctx,
          `${title} · ${entry.item.label}`,
          entry.artifact(),
        );
      }
    }
  });
}
