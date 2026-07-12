import { join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { readJsonFile, writeJsonFile } from "../../lib/json-state.ts";

const STATE_FILE = join(getAgentDir(), "subagents.json");

export interface SubagentsState {
  enabled: boolean;
}

export function loadState(): SubagentsState {
  const state = readJsonFile(STATE_FILE) as Partial<SubagentsState> | undefined;
  if (typeof state?.enabled === "boolean") return { enabled: state.enabled };
  return { enabled: true };
}

export function saveState(state: SubagentsState): void {
  writeJsonFile(STATE_FILE, state);
}

export { STATE_FILE };
