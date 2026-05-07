import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

/**
 * Skill Inject Extension
 *
 * Controls whether skill metadata is injected into the system prompt.
 * When enabled (default), skills appear in context as usual.
 * When disabled, skill descriptions are stripped while keeping skills
 * registered and loadable via `/skill:name` or explicit `read` calls.
 */

const STATE_FILE = join(homedir(), ".pi", "skill-inject.json");

function loadState(): { enabled: boolean } {
  try {
    if (existsSync(STATE_FILE)) {
      return JSON.parse(readFileSync(STATE_FILE, "utf-8")) as { enabled: boolean };
    }
  } catch {
    // ignore parse/read errors
  }
  return { enabled: true };
}

function saveState(state: { enabled: boolean }): void {
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2) + "\n");
}

let injectSkills = loadState().enabled;

export default function (pi: ExtensionAPI) {
  pi.registerCommand("skill-inject", {
    description: "Toggle skill metadata injection in system prompt",
    handler: async (_args, ctx) => {
      injectSkills = !injectSkills;
      saveState({ enabled: injectSkills });
      ctx.ui.notify(
        injectSkills
          ? "Skill metadata will be injected to system prompt"
          : "Skill metadata hidden from system prompt",
        "info",
      );
    },
  });

  pi.on("before_agent_start", async (event) => {
    if (injectSkills) return;

    const { systemPrompt } = event;

    // Strip the <available_skills> block injected by formatSkillsForPrompt()
    const cleaned = systemPrompt.replace(
      /\n\nThe following skills provide specialized instructions for specific tasks\.[\s\S]*?<\/available_skills>/,
      "",
    );

    if (cleaned !== systemPrompt) {
      return { systemPrompt: cleaned };
    }
  });
}
