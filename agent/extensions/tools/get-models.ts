import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  getSupportedThinkingLevels,
  type Model,
} from "@earendil-works/pi-ai/compat";
import { Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";

const modelRef = (model: Model<any>): string => `${model.provider}/${model.id}`;

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
      const hasConfiguredScope = ctx.scopedModels.length > 0;
      const scopedModels = hasConfiguredScope
        ? ctx.scopedModels
        : ctx.modelRegistry
            .getAvailable()
            .map((model) => ({ model, thinkingLevel: undefined }));
      const currentModel = ctx.model;
      const details = {
        cwd: ctx.cwd,
        scopeSource: hasConfiguredScope
          ? "session scopedModels"
          : "all available models fallback",
        currentModel: currentModel
          ? {
              id: modelRef(currentModel),
              provider: currentModel.provider,
              model: currentModel.id,
              name: currentModel.name,
              currentThinkingLevel: pi.getThinkingLevel(),
              supportedThinkingLevels: getSupportedThinkingLevels(currentModel),
            }
          : null,
        count: scopedModels.length,
        models: scopedModels.map(({ model, thinkingLevel }) => ({
          id: modelRef(model),
          provider: model.provider,
          model: model.id,
          name: model.name,
          api: model.api,
          input: model.input,
          contextWindow: model.contextWindow,
          maxTokens: model.maxTokens,
          reasoning: model.reasoning,
          explicitThinkingLevel: thinkingLevel ?? null,
          supportedThinkingLevels: getSupportedThinkingLevels(model),
        })),
        warnings: [],
      };

      return {
        content: [{ type: "text", text: JSON.stringify(details, null, 2) }],
        details,
      };
    },
    renderResult(result, { expanded }, theme) {
      if (!expanded) return new Text("", 0, 0);

      const content = result.content[0];
      const text =
        content?.type === "text" ? content.text : "No model data returned.";
      return new Text(theme.fg("toolOutput", text), 0, 0);
    },
  });
}
