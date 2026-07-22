import {
  getAgentDir,
  parseArgs,
  SettingsManager,
  type ExtensionAPI,
} from "@earendil-works/pi-coding-agent";
import type { Model } from "@earendil-works/pi-ai/compat";
import { Type } from "typebox";

type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh";

type ScopedModel = {
  model: Model<any>;
  explicitThinkingLevel?: ThinkingLevel;
};

const THINKING_LEVELS: ThinkingLevel[] = [
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
];

const isThinkingLevel = (value: string): value is ThinkingLevel =>
  THINKING_LEVELS.includes(value as ThinkingLevel);

const isAlias = (id: string): boolean =>
  id.endsWith("-latest") || !/-\d{8}$/.test(id);

const modelRef = (model: Model<any>): string => `${model.provider}/${model.id}`;

const modelsEqual = (a: Model<any>, b: Model<any>): boolean =>
  a.provider === b.provider && a.id === b.id;

const supportedThinkingLevels = (model: Model<any>): ThinkingLevel[] => {
  if (!model.reasoning) return ["off"];

  return THINKING_LEVELS.filter((level) => {
    const mapped = model.thinkingLevelMap?.[level];
    if (mapped === null) return false;
    if (level === "xhigh") return mapped !== undefined;
    return true;
  });
};

const findExactModelReferenceMatch = (
  reference: string,
  models: Model<any>[],
): Model<any> | undefined => {
  const trimmed = reference.trim();
  if (!trimmed) return undefined;

  const normalized = trimmed.toLowerCase();
  const canonicalMatches = models.filter(
    (model) => modelRef(model).toLowerCase() === normalized,
  );
  if (canonicalMatches.length === 1) return canonicalMatches[0];
  if (canonicalMatches.length > 1) return undefined;

  const slashIndex = trimmed.indexOf("/");
  if (slashIndex !== -1) {
    const provider = trimmed.slice(0, slashIndex).trim().toLowerCase();
    const modelId = trimmed
      .slice(slashIndex + 1)
      .trim()
      .toLowerCase();
    const providerMatches = models.filter(
      (model) =>
        model.provider.toLowerCase() === provider &&
        model.id.toLowerCase() === modelId,
    );
    if (providerMatches.length === 1) return providerMatches[0];
    if (providerMatches.length > 1) return undefined;
  }

  const idMatches = models.filter(
    (model) => model.id.toLowerCase() === normalized,
  );
  return idMatches.length === 1 ? idMatches[0] : undefined;
};

const tryMatchModel = (
  pattern: string,
  models: Model<any>[],
): Model<any> | undefined => {
  const exact = findExactModelReferenceMatch(pattern, models);
  if (exact) return exact;

  const normalized = pattern.toLowerCase();
  const matches = models.filter(
    (model) =>
      model.id.toLowerCase().includes(normalized) ||
      (model.name ?? "").toLowerCase().includes(normalized),
  );
  if (matches.length === 0) return undefined;

  const aliases = matches.filter((model) => isAlias(model.id));
  const candidates = aliases.length > 0 ? aliases : matches;
  return candidates.sort((a, b) => b.id.localeCompare(a.id))[0];
};

const parseModelPattern = (
  pattern: string,
  models: Model<any>[],
): {
  model?: Model<any>;
  explicitThinkingLevel?: ThinkingLevel;
  warning?: string;
} => {
  const exact = tryMatchModel(pattern, models);
  if (exact) return { model: exact };

  const lastColon = pattern.lastIndexOf(":");
  if (lastColon === -1) return {};

  const prefix = pattern.slice(0, lastColon);
  const suffix = pattern.slice(lastColon + 1);
  const parsed = parseModelPattern(prefix, models);
  if (!parsed.model) return parsed;

  if (isThinkingLevel(suffix)) {
    return {
      model: parsed.model,
      explicitThinkingLevel: parsed.warning ? undefined : suffix,
      warning: parsed.warning,
    };
  }

  return {
    model: parsed.model,
    warning: `Invalid thinking level "${suffix}" in pattern "${pattern}". Using default instead.`,
  };
};

const globToRegExp = (glob: string): RegExp => {
  let pattern = "^";
  for (let i = 0; i < glob.length; i += 1) {
    const char = glob[i];
    if (char === "*") {
      pattern += ".*";
      continue;
    }
    if (char === "?") {
      pattern += ".";
      continue;
    }
    if (char === "[") {
      const end = glob.indexOf("]", i + 1);
      if (end !== -1) {
        pattern += glob.slice(i, end + 1);
        i = end;
        continue;
      }
    }
    pattern += char.replace(/[|\\{}()[\]^$+*?.]/g, "\\$&");
  }
  return new RegExp(`${pattern}$`, "i");
};

const resolveModelScope = (
  patterns: string[],
  models: Model<any>[],
): { scopedModels: ScopedModel[]; warnings: string[] } => {
  const scopedModels: ScopedModel[] = [];
  const warnings: string[] = [];

  const addModel = (scopedModel: ScopedModel) => {
    if (
      !scopedModels.some((existing) =>
        modelsEqual(existing.model, scopedModel.model),
      )
    ) {
      scopedModels.push(scopedModel);
    }
  };

  for (const pattern of patterns) {
    if (
      pattern.includes("*") ||
      pattern.includes("?") ||
      pattern.includes("[")
    ) {
      const colonIndex = pattern.lastIndexOf(":");
      const suffix =
        colonIndex === -1 ? undefined : pattern.slice(colonIndex + 1);
      const hasThinkingSuffix = suffix !== undefined && isThinkingLevel(suffix);
      const globPattern = hasThinkingSuffix
        ? pattern.slice(0, colonIndex)
        : pattern;
      const regex = globToRegExp(globPattern);
      const matchingModels = models.filter(
        (model) => regex.test(modelRef(model)) || regex.test(model.id),
      );

      if (matchingModels.length === 0) {
        warnings.push(`No models match pattern "${pattern}".`);
        continue;
      }

      for (const model of matchingModels) {
        addModel({
          model,
          explicitThinkingLevel: hasThinkingSuffix ? suffix : undefined,
        });
      }
      continue;
    }

    const resolved = parseModelPattern(pattern, models);
    if (resolved.warning) warnings.push(resolved.warning);
    if (!resolved.model) {
      warnings.push(`No models match pattern "${pattern}".`);
      continue;
    }
    addModel({
      model: resolved.model,
      explicitThinkingLevel: resolved.explicitThinkingLevel,
    });
  }

  return { scopedModels, warnings };
};

const getCliModelPatterns = (): string[] | undefined => {
  const parsed = parseArgs(process.argv.slice(2));
  return parsed.models;
};

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "get_models",
    label: "Get models",
    description:
      "Return the models scoped to the current Pi session and each model's supported thinking levels. Use before launching subagents or choosing model overrides.",
    promptSnippet:
      "get_models: list current Pi scoped models and supported thinking levels.",
    promptGuidelines: [
      "Use get_models instead of reading settings files when you need model IDs for subagents or model overrides.",
      "Prefer full provider/model IDs from get_models when setting subagent model overrides.",
    ],
    parameters: Type.Object({}),
    execute: async (_toolCallId, _params, _signal, _onUpdate, ctx) => {
      const cliPatterns = getCliModelPatterns();
      const settings = SettingsManager.create(ctx.cwd, getAgentDir(), {
        projectTrusted: ctx.isProjectTrusted(),
      });
      const settingsPatterns = settings.getEnabledModels();
      const patterns = cliPatterns ?? settingsPatterns ?? [];
      const scopeSource = cliPatterns
        ? "cli --models"
        : "settings enabledModels";
      const availableModels = ctx.modelRegistry.getAvailable();
      const { scopedModels, warnings } =
        patterns.length > 0
          ? resolveModelScope(patterns, availableModels)
          : {
              scopedModels: availableModels.map((model) => ({ model })),
              warnings: [],
            };

      const currentModel = ctx.model;
      const details = {
        cwd: ctx.cwd,
        scopeSource:
          patterns.length > 0 ? scopeSource : "all available models fallback",
        currentModel: currentModel
          ? {
              id: modelRef(currentModel),
              provider: currentModel.provider,
              model: currentModel.id,
              name: currentModel.name,
              currentThinkingLevel: pi.getThinkingLevel(),
              supportedThinkingLevels: supportedThinkingLevels(currentModel),
            }
          : null,
        count: scopedModels.length,
        models: scopedModels.map(({ model, explicitThinkingLevel }) => ({
          id: modelRef(model),
          provider: model.provider,
          model: model.id,
          name: model.name,
          api: model.api,
          input: model.input,
          contextWindow: model.contextWindow,
          maxTokens: model.maxTokens,
          reasoning: model.reasoning,
          explicitThinkingLevel: explicitThinkingLevel ?? null,
          supportedThinkingLevels: supportedThinkingLevels(model),
        })),
        warnings,
      };

      return {
        content: [{ type: "text", text: JSON.stringify(details, null, 2) }],
        details,
      };
    },
  });
}
