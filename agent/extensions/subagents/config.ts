import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

const STATE_FILE = join(homedir(), ".pi", "agent", "subagents.json");

export interface SubagentsState {
  enabled: boolean;
}

export function loadState(): SubagentsState {
  try {
    if (existsSync(STATE_FILE)) {
      const state = JSON.parse(
        readFileSync(STATE_FILE, "utf-8"),
      ) as Partial<SubagentsState>;
      if (typeof state.enabled === "boolean") return { enabled: state.enabled };
    }
  } catch {
    // ignore parse/read errors
  }
  return { enabled: true };
}

export function saveState(state: SubagentsState): void {
  mkdirSync(dirname(STATE_FILE), { recursive: true });
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2) + "\n");
}

export { STATE_FILE };
