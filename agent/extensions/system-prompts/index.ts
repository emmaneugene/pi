/**
 * System Prompts Extension
 *
 * Lets you define multiple full system prompts as files and swap between
 * them at runtime, instead of committing to a single ~/.pi/agent/SYSTEM.md.
 *
 * Prompt files (project takes precedence over global for same-named files):
 * - ~/.pi/agent/system-prompts/*.md   (global)
 * - <cwd>/.pi/system-prompts/*.md     (project-local)
 *
 * Each file's basename (without .md) is the prompt's name, e.g.
 * `system-prompts/conversational.md` -> "conversational".
 *
 * How it works: pi still loads your base ~/.pi/agent/SYSTEM.md (or
 * .pi/SYSTEM.md) as before. This becomes `systemPromptOptions.customPrompt`.
 * When you select a prompt, this extension replaces that exact substring in
 * the assembled system prompt with the file's contents. Tool snippets,
 * skills, and context files come after that substring, so they stay
 * unchanged.
 *
 * If there is no base custom prompt to replace (no SYSTEM.md at all), this
 * extension adds the selected prompt before the system prompt instead.
 *
 * The active prompt is a global sticky default, stored in
 * ~/.pi/agent/system-prompt.json. Picking one via `/system-prompt`
 * applies to every session (current and future) until changed again.
 *
 * Usage:
 * - `/system-prompt`                        - interactive picker (primary way to switch)
 * - `/system-prompt conversational`         - switch directly
 * - `/system-prompt list`                   - list available prompt names
 * - `/system-prompt default`                - clear override, use SYSTEM.md as-is
 * - `pi --system-prompt-preset conversational` - override for this run only (does not persist)
 */

import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { CONFIG_DIR_NAME, getAgentDir } from "@earendil-works/pi-coding-agent";

const NONE = "(default)";
const STATE_FILE = join(getAgentDir(), "system-prompt.json");

function promptDirs(cwd: string): string[] {
  return [
    join(getAgentDir(), "system-prompts"),
    join(cwd, CONFIG_DIR_NAME, "system-prompts"),
  ];
}

/** name -> absolute file path. Project-local entries override global ones with the same name. */
function discoverPrompts(cwd: string): Map<string, string> {
  const result = new Map<string, string>();
  for (const dir of promptDirs(cwd)) {
    if (!existsSync(dir)) continue;
    for (const file of readdirSync(dir)) {
      if (!file.endsWith(".md")) continue;
      result.set(basename(file, ".md"), join(dir, file));
    }
  }
  return result;
}

function loadPersistedName(): string | undefined {
  if (!existsSync(STATE_FILE)) return undefined;
  try {
    const data = JSON.parse(readFileSync(STATE_FILE, "utf-8")) as {
      active?: string;
    };
    return data.active;
  } catch {
    return undefined;
  }
}

function savePersistedName(name: string | undefined): void {
  writeFileSync(STATE_FILE, JSON.stringify({ active: name ?? null }, null, 2));
}

export default function systemPromptsExtension(pi: ExtensionAPI) {
  let prompts: Map<string, string> = new Map();
  let activeName: string | undefined;

  function updateStatus(ctx: ExtensionContext) {
    ctx.ui.setStatus(
      "system-prompt",
      activeName ? `prompt:${activeName}` : undefined,
    );
  }

  function readActivePrompt(): string | undefined {
    if (!activeName) return undefined;
    const path = prompts.get(activeName);
    if (!path || !existsSync(path)) return undefined;
    return readFileSync(path, "utf-8");
  }

  /** Switch the in-memory active prompt for this run only; does not touch the sticky default. */
  function activateTransient(name: string | undefined, ctx: ExtensionContext) {
    activeName = name;
    updateStatus(ctx);
  }

  function availableNamesLabel(): string {
    return [...prompts.keys()].join(", ") || "(none defined)";
  }

  /** Activate a prompt (or undefined to reset to default), persist it as the sticky default, and notify. */
  function applyPrompt(name: string | undefined, ctx: ExtensionContext) {
    activateTransient(name, ctx);
    savePersistedName(name);
    ctx.ui.notify(
      name
        ? `System prompt "${name}" activated.`
        : "System prompt reset to default (SYSTEM.md).",
      "info",
    );
  }

  pi.registerFlag("system-prompt-preset", {
    description:
      "Named system prompt to activate for this run only (does not change the sticky default)",
    type: "string",
  });

  pi.registerCommand("system-prompt", {
    description: "Switch the active system prompt (sticky across sessions)",
    getArgumentCompletions: (prefix) => {
      const names = [NONE, "list", ...prompts.keys()];
      const filtered = names
        .filter((n) => n.startsWith(prefix))
        .map((n) => ({ value: n, label: n }));
      return filtered.length > 0 ? filtered : null;
    },
    handler: async (args, ctx) => {
      const arg = args?.trim();

      if (arg === "list") {
        const names = [...prompts.keys()];
        ctx.ui.notify(
          names.length > 0
            ? `Available prompts: ${names.join(", ")}`
            : "No system prompts defined.",
          "info",
        );
        return;
      }

      if (arg) {
        if (arg === NONE || arg === "default" || arg === "none")
          return applyPrompt(undefined, ctx);
        if (!prompts.has(arg)) {
          ctx.ui.notify(
            `Unknown system prompt "${arg}". Available: ${availableNamesLabel()}`,
            "error",
          );
          return;
        }
        return applyPrompt(arg, ctx);
      }

      const names = [...prompts.keys()];
      if (names.length === 0) {
        ctx.ui.notify(
          `No system prompts defined. Add .md files to ${join(getAgentDir(), "system-prompts")} or ${join(ctx.cwd, CONFIG_DIR_NAME, "system-prompts")}`,
          "warning",
        );
        return;
      }
      const items = [
        NONE,
        ...names.map((n) => (n === activeName ? `${n} (active)` : n)),
      ];
      const choice = await ctx.ui.select("Select system prompt:", items);
      if (!choice) return;
      applyPrompt(
        choice === NONE ? undefined : choice.replace(/ \(active\)$/, ""),
        ctx,
      );
    },
  });

  pi.on("before_agent_start", async (event) => {
    const content = readActivePrompt();
    if (content === undefined) return;

    const basePrompt = event.systemPromptOptions.customPrompt ?? "";
    if (basePrompt && event.systemPrompt.includes(basePrompt)) {
      return { systemPrompt: event.systemPrompt.replace(basePrompt, content) };
    }
    // No base custom prompt found to swap out (e.g. no SYSTEM.md); prepend instead.
    return { systemPrompt: `${content}\n\n${event.systemPrompt}` };
  });

  pi.on("session_start", async (_event, ctx) => {
    prompts = discoverPrompts(ctx.cwd);

    const flag = pi.getFlag("system-prompt-preset");
    if (typeof flag === "string" && flag) {
      if (prompts.has(flag)) {
        activateTransient(flag, ctx);
      } else {
        ctx.ui.notify(
          `Unknown system prompt "${flag}". Available: ${availableNamesLabel()}`,
          "warning",
        );
      }
      return;
    }

    const persisted = loadPersistedName();
    activeName = persisted && prompts.has(persisted) ? persisted : undefined;
    updateStatus(ctx);
  });

  pi.on("resources_discover", async (event, _ctx) => {
    prompts = discoverPrompts(event.cwd);
  });
}
