/**
 * tools — everything about the agent's tool surface:
 *
 * Overrides of pi built-ins:
 * - bash/: default 300s timeout on the bash tool, with a timeout message
 *   that explains how to proceed.
 * - edit/: edits[].replaceAll on the edit tool, plus line-numbered
 *   duplicate-match errors.
 *
 * Additional tools:
 * - ask-user-question/: AskUserQuestion collects structured answers via TUI.
 * - read-image.ts: read_image delegates image analysis to a vision model.
 * - get-models.ts: get_models lists session-scoped models for the LLM.
 *
 * Introspection:
 * - show-tools.ts: /show-tools catalog of all tools with documentation.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import askUserQuestion from "./ask-user-question/index.ts";
import bashTimeout from "./bash/index.ts";
import editReplaceAll from "./edit/index.ts";
import getModels from "./get-models.ts";
import readImage from "./read-image.ts";
import showTools from "./show-tools.ts";

export default function (pi: ExtensionAPI) {
  bashTimeout(pi);
  editReplaceAll(pi);
  askUserQuestion(pi);
  readImage(pi);
  getModels(pi);
  showTools(pi);
}
