/**
 * Filterable catalog picker. Replaces the prompt editor (not a floating
 * overlay) so terminal images cannot cover it. Writes nothing to the session.
 *
 * Enter opens the row's artefact unless `onSelect` is set. The external-editor
 * key still opens the artefact: `$EDITOR` / `$VISUAL` when set, else
 * `ctx.ui.editor`.
 */

import { spawn } from "node:child_process";
import { readFileSync, unlinkSync, writeFileSync } from "node:fs";
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

export type CatalogArtifact =
  | { kind: "file"; path: string }
  | { kind: "text"; content: string; ext?: string };

export interface CatalogEntry {
  item: SelectItem;
  artifact: () => CatalogArtifact;
}

export interface KillResult {
  message?: string;
  type?: "info" | "warning" | "error";
}

export interface CatalogOptions {
  maxVisible?: number;
  refreshIntervalMs?: number;
  onSelect?: (entry: CatalogEntry) => Promise<void> | void;
  /** ctrl+x on the highlighted row; list refreshes afterward. */
  onKill?: (value: string) => Promise<KillResult | void> | KillResult | void;
}

type CatalogChoice = {
  value: string;
  action: "select" | "artifact";
};

const BG_RESET = "\x1b[49m";

const PRIMARY_COL = 32;

/** SelectList hard-cuts descriptions; leave one column so "…" survives. */
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

function boxed(content: string[], width: number, theme: any): string[] {
  const BG = theme.getBgAnsi("customMessageBg");
  const inner = Math.max(1, width - 4);
  const bar = theme.fg("border", "│");
  // Rows may reset background; re-assert BG or the fill and right border drop.
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
        Math.max(5, Math.min(entries.length, 14, tui.terminal.rows - 12));
      let query = "";
      let currentInner = -1;

      let settled = false;
      const finish = (result: CatalogChoice | undefined) => {
        if (settled) return;
        settled = true;
        done(result);
      };
      // SelectList.setFilter is prefix-on-value; filter on label instead.
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
            list.handleInput(data);
          }
          tui.requestRender();
        },
        dispose() {
          if (refreshTimer) clearInterval(refreshTimer);
        },
      };
    },
  );
}

function runExternalEditor(
  ctx: ExtensionContext,
  editorCmd: string,
  file: string,
): Promise<void> {
  return ctx.ui.custom<void>((tui: TUI, theme, _kb, done) => {
    // Mount first, then hand the screen to the editor.
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

async function openArtifact(
  ctx: ExtensionContext,
  title: string,
  art: CatalogArtifact,
): Promise<void> {
  const editorCmd = process.env.VISUAL || process.env.EDITOR;
  if (!editorCmd) {
    const content =
      art.kind === "file" ? readFileSync(art.path, "utf-8") : art.content;
    await ctx.ui.editor(title, content);
    return;
  }
  if (art.kind === "file") {
    await runExternalEditor(ctx, editorCmd, art.path);
    return;
  }
  const temp = join(tmpdir(), `pi-catalog-${Date.now()}${art.ext ?? ".md"}`);
  writeFileSync(temp, art.content, "utf-8");
  try {
    await runExternalEditor(ctx, editorCmd, temp);
  } finally {
    try {
      unlinkSync(temp);
    } catch {}
  }
}

/** Filterable picker; select opens the artefact, then returns to the list. */
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
