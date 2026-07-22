import { join } from "node:path";
import {
  getAgentDir,
  type ExtensionAPI,
  type ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { readJsonFile } from "../../lib/json-state.ts";

/**
 * Trigger compaction once context usage crosses the configured percentage or
 * absolute-token limit for the active model.
 *
 * Pi's built-in auto-compaction triggers on an absolute token reserve
 * (contextWindow - reserveTokens), so its effective percentage varies between
 * models. This extension supports percentage and absolute-token thresholds.
 * When both apply, the lower token limit wins. The built-in compaction stays
 * enabled as an overflow safety net.
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

function setStatus(ctx: ExtensionContext, text: string | undefined): void {
  if (ctx.hasUI) ctx.ui.setStatus("autocompact", text);
}

function notify(
  ctx: ExtensionContext,
  message: string,
  type: "info" | "warning" | "error" = "info",
): void {
  if (ctx.hasUI) ctx.ui.notify(message, type);
}

export default function (pi: ExtensionAPI) {
  let config = loadConfig();
  let compacting = false;
  let triedCompactionAboveThreshold = false;
  let warnedTerminateSession = false;

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
    warnedTerminateSession = true;
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
    compacting = false;
    triedCompactionAboveThreshold = false;
    warnedTerminateSession = false;
    updateStatus(ctx);
  });

  pi.on("model_select", (_event, ctx) => {
    triedCompactionAboveThreshold = false;
    warnedTerminateSession = false;
    updateStatus(ctx);
  });

  // Avoid racing with Pi's built-in compaction
  pi.on("agent_settled", (_event, ctx) => {
    const settings = resolveSettings(config, ctx);
    if (!settings.enabled || compacting || warnedTerminateSession) return;

    const rawUsage = ctx.getContextUsage();
    if (!rawUsage || rawUsage.tokens === null || rawUsage.percent === null) {
      return;
    }
    const usage: ContextUsage = rawUsage;
    const threshold = effectiveThreshold(usage, settings);

    if (usage.tokens < threshold.tokens) {
      triedCompactionAboveThreshold = false;
      return;
    }

    if (triedCompactionAboveThreshold) {
      warnTerminateSession(ctx, usage, settings);
      return;
    }

    compacting = true;
    triedCompactionAboveThreshold = true;
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
        compacting = false;
        notify(ctx, "Compaction complete.", "info");

        // Pi reports null usage until the first post-compaction assistant response.
        // Keep the attempt flag set so that response can verify the new context size.
        const rawPostCompactUsage = ctx.getContextUsage();
        if (
          rawPostCompactUsage?.tokens !== null &&
          rawPostCompactUsage?.tokens !== undefined &&
          rawPostCompactUsage.percent !== null
        ) {
          const postCompactUsage: ContextUsage = rawPostCompactUsage;
          const postCompactSettings = resolveSettings(config, ctx);
          const postCompactThreshold = effectiveThreshold(
            postCompactUsage,
            postCompactSettings,
          );
          if (postCompactUsage.tokens >= postCompactThreshold.tokens) {
            warnTerminateSession(ctx, postCompactUsage, postCompactSettings);
          } else {
            triedCompactionAboveThreshold = false;
          }
        }
      },
      onError: (error) => {
        compacting = false;
        triedCompactionAboveThreshold = false;
        notify(ctx, `Compaction failed: ${error.message}`, "error");
      },
    });
  });
}
