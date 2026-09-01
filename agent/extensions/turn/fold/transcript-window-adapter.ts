import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

import { selectTranscriptEntries, type TranscriptWindowValue } from "./transcript-windows.ts";

const ADAPTER_STATE_KEY = Symbol.for("@onurpi/turn-fold/transcript-window-adapter.v2");

type BranchEntries = ReturnType<ExtensionContext["sessionManager"]["getBranch"]>;

export type TranscriptSessionManager = {
  buildContextEntries: () => BranchEntries;
  readonly getBranch: () => BranchEntries;
};

export type TranscriptWindowAdapter = {
  getValue: () => TranscriptWindowValue;
  prepareCompletedCompactionReplay: (entryId: string) => void;
  setValue: (value: TranscriptWindowValue) => void;
};

type AdapterState = TranscriptWindowAdapter & {
  readonly buildEntries: () => BranchEntries;
};

function isAdapterState(value: unknown): value is AdapterState {
  if (typeof value !== "object" || value === null) return false;
  return (
    typeof Reflect.get(value, "buildEntries") === "function" &&
    typeof Reflect.get(value, "getValue") === "function" &&
    typeof Reflect.get(value, "prepareCompletedCompactionReplay") === "function" &&
    typeof Reflect.get(value, "setValue") === "function"
  );
}

function defineAdapterState(manager: object, state: AdapterState): void {
  if (
    !Reflect.defineProperty(manager, ADAPTER_STATE_KEY, {
      configurable: false,
      enumerable: false,
      value: state,
      writable: false,
    })
  ) {
    throw new Error("Unable to install Turn Fold transcript-window state");
  }
}

function completedCompactionFirst(
  entries: BranchEntries,
  completedCompactionEntryId: string | undefined,
): BranchEntries {
  if (!completedCompactionEntryId) return entries;
  const compaction = entries.find((entry) => entry.id === completedCompactionEntryId);
  if (compaction?.type !== "compaction") {
    throw new Error(
      `Completed Turn Fold compaction ${completedCompactionEntryId} is absent from the selected transcript`,
    );
  }
  return [compaction, ...entries.filter((entry) => entry.id !== completedCompactionEntryId)];
}

export function installTranscriptWindowAdapter(
  manager: TranscriptSessionManager,
  initialValue: TranscriptWindowValue,
): TranscriptWindowAdapter {
  const existing: unknown = Reflect.get(manager, ADAPTER_STATE_KEY);
  if (isAdapterState(existing)) {
    existing.setValue(initialValue);
    manager.buildContextEntries = existing.buildEntries;
    return existing;
  }

  let value = initialValue;
  let completedCompactionEntryId: string | undefined;
  const state: AdapterState = {
    buildEntries: () => {
      const selected = selectTranscriptEntries(manager.getBranch(), value);
      const completed = completedCompactionEntryId;
      completedCompactionEntryId = undefined;
      return completedCompactionFirst(selected, completed);
    },
    getValue: () => value,
    prepareCompletedCompactionReplay: (entryId) => {
      if (!entryId) throw new Error("Completed compaction entry ID must not be empty");
      completedCompactionEntryId = entryId;
    },
    setValue: (nextValue) => {
      value = nextValue;
    },
  };
  defineAdapterState(manager, state);
  manager.buildContextEntries = state.buildEntries;
  return state;
}
