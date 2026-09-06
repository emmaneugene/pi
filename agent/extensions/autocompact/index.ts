import { join } from "node:path";
import {
  getAgentDir,
  type ExtensionAPI,
  type ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { readJsonFile } from "../../lib/json-state.ts";
import { notify, setStatus } from "./ui.ts";

/**
 * Trigger compaction once context usage crosses the configured percentage or
 * absolute-token limit for the active model.
 *
 * This extension supports percentage and absolute-token thresholds. When both
 * apply, the lower token limit wins. It compacts only after the agent settles,
 * so compaction does not abort an active run or its attached asynchronous work.
 * Cursor provider models bypass this extension because pi-cursor-sdk manages
 * their agent runtime and does not support Pi's manual compaction flow.
 *
 * Disable Pi's built-in auto-compaction. Manual compaction stays available and
 * is the mechanism this extension uses after completed runs.
 *
 * Configure via ~/.pi/agent/autocompact.json:
 * {
 *   "enabled": true,
 *   "thresholdPercent": 80,
 *   "thresholdTokens": 200000,
 *   "models": {
 *     "anthropic/claude-opus-4-8": { "thresholdTokens": 500000 },
 *     "openai/gpt-5.6-sol": { "thresholdPercent": 60 }
 *   }
 * }
 *
 * Model settings are keyed by provider/model-id and override individual global
 * fields. Unspecified fields inherit their global values.
 */
const STATE_FILE = join(getAgentDir(), "autocompact.json");

interface ThresholdSettings {
  enabled: boolean;
  thresholdPercent: number;
  thresholdTokens?: number;
}

interface Config extends ThresholdSettings {
  models: Record<string, Partial<ThresholdSettings>>;
}

interface ContextUsage {
  tokens: number;
  contextWindow: number;
  percent: number;
}

interface EffectiveThreshold {
  tokens: number;
  source: "percentage" | "tokens";
}

const DEFAULTS: Config = {
  enabled: true,
  thresholdPercent: 80,
  thresholdTokens: 200_000,
  models: {},
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseThresholdOverrides(value: unknown): Partial<ThresholdSettings> {
  if (!isRecord(value)) return {};

  const overrides: Partial<ThresholdSettings> = {};
  if (typeof value.enabled === "boolean") {
    overrides.enabled = value.enabled;
  }

  const percent = value.thresholdPercent;
  if (
    typeof percent === "number" &&
    Number.isFinite(percent) &&
    percent > 0 &&
    percent < 100
  ) {
    overrides.thresholdPercent = percent;
  }

  const tokens = value.thresholdTokens;
  if (
    typeof tokens === "number" &&
    Number.isSafeInteger(tokens) &&
    tokens > 0
  ) {
    overrides.thresholdTokens = tokens;
  }

  return overrides;
}

function parseConfig(value: unknown): Config {
  if (!isRecord(value)) return { ...DEFAULTS, models: {} };

  const models: Record<string, Partial<ThresholdSettings>> = {};
  if (isRecord(value.models)) {
    for (const [modelRef, settings] of Object.entries(value.models)) {
      if (modelRef.includes("/") && isRecord(settings)) {
        models[modelRef] = parseThresholdOverrides(settings);
      }
    }
  }

  return {
    ...DEFAULTS,
    ...parseThresholdOverrides(value),
    models,
  };
}

function loadConfig(): Config {
  return parseConfig(readJsonFile(STATE_FILE));
}

function resolveSettings(
  config: Config,
  ctx: ExtensionContext,
): ThresholdSettings {
  if (ctx.model?.provider === "cursor") {
    return { ...config, enabled: false };
  }

  const modelRef = ctx.model
    ? `${ctx.model.provider}/${ctx.model.id}`
    : undefined;
  const overrides = modelRef ? config.models[modelRef] : undefined;

  return {
    enabled: overrides?.enabled ?? config.enabled,
    thresholdPercent: overrides?.thresholdPercent ?? config.thresholdPercent,
    thresholdTokens: overrides?.thresholdTokens ?? config.thresholdTokens,
  };
}

function contextUsage(
  raw: ReturnType<ExtensionContext["getContextUsage"]>,
): ContextUsage | undefined {
  if (!raw || raw.tokens === null || raw.percent === null) return undefined;
  return {
    tokens: raw.tokens,
    contextWindow: raw.contextWindow,
    percent: raw.percent,
  };
}

function effectiveThreshold(
  usage: ContextUsage,
  settings: ThresholdSettings,
): EffectiveThreshold {
  const percentageTokens =
    usage.contextWindow * (settings.thresholdPercent / 100);
  if (
    settings.thresholdTokens !== undefined &&
    settings.thresholdTokens < percentageTokens
  ) {
    return { tokens: settings.thresholdTokens, source: "tokens" };
  }
  return { tokens: percentageTokens, source: "percentage" };
}

function configuredThresholdLabel(settings: ThresholdSettings): string {
  if (settings.thresholdTokens === undefined) {
    return `${settings.thresholdPercent}%`;
  }
  return `min(${settings.thresholdPercent}%, ${settings.thresholdTokens.toLocaleString()} tokens)`;
}

function usageLabel(usage: ContextUsage): string {
  return `${usage.tokens.toLocaleString()} tokens (${Math.round(usage.percent)}%)`;
}

type CompactionState =
  | { kind: "ready" }
  | { kind: "attempted" }
  | { kind: "compacting" }
  | { kind: "terminate" };

export default function (pi: ExtensionAPI) {
  let config = loadConfig();
  let state: CompactionState = { kind: "ready" };

  const updateStatus = (ctx: ExtensionContext) => {
    const settings = resolveSettings(config, ctx);
    setStatus(
      ctx,
      settings.enabled
        ? `autocompact @ ${configuredThresholdLabel(settings)}`
        : "autocompact off",
    );
  };

  const warnTerminateSession = (
    ctx: ExtensionContext,
    usage: ContextUsage,
    settings: ThresholdSettings,
  ) => {
    state = { kind: "terminate" };
    setStatus(ctx, "autocompact: terminate session");
    notify(
      ctx,
      `Auto-compaction did not reduce context below ${configuredThresholdLabel(
        settings,
      )} (currently ${usageLabel(
        usage,
      )}). You should terminate this session and start a new one.`,
      "warning",
    );
  };

  // Reload config each session so edits to autocompact.json take effect on /reload or /new.
  pi.on("session_start", (_event, ctx) => {
    config = loadConfig();
    state = { kind: "ready" };
    updateStatus(ctx);
  });

  pi.on("model_select", (_event, ctx) => {
    // A compaction may still be running for the model being switched away
    // from; leave its outcome alone rather than discarding it mid-flight.
    if (state.kind !== "compacting") state = { kind: "ready" };
    updateStatus(ctx);
  });

  const compactIfNeeded = (ctx: ExtensionContext) => {
    const settings = resolveSettings(config, ctx);
    if (
      !settings.enabled ||
      state.kind === "compacting" ||
      state.kind === "terminate"
    )
      return;

    const usage = contextUsage(ctx.getContextUsage());
    if (!usage) return;
    const threshold = effectiveThreshold(usage, settings);

    if (usage.tokens < threshold.tokens) {
      state = { kind: "ready" };
      return;
    }

    if (state.kind === "attempted") {
      warnTerminateSession(ctx, usage, settings);
      return;
    }

    state = { kind: "compacting" };
    const limit =
      threshold.source === "tokens"
        ? `${threshold.tokens.toLocaleString()} tokens`
        : `${settings.thresholdPercent}%`;
    notify(
      ctx,
      `Context at ${usageLabel(usage)} reached the ${limit} limit. Compacting...`,
      "info",
    );
    ctx.compact({
      onComplete: () => {
        // Pi reports null usage until the first post-compaction assistant
        // response, so the next agent_settled verifies the new context size.
        state = { kind: "attempted" };
        notify(ctx, "Compaction complete.", "info");
      },
      onError: (error) => {
        state = { kind: "ready" };
        notify(ctx, `Compaction failed: ${error.message}`, "error");
      },
    });
  };

  // Compact only completed runs. Pi's built-in compaction handles context
  // overflow and continues the interrupted run without aborting attached work.
  pi.on("agent_settled", (_event, ctx) => {
    compactIfNeeded(ctx);
  });
}
