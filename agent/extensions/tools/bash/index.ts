/**
 * Overrides the built-in `bash` tool to apply a default timeout, and to explain
 * what to do when that timeout trips.
 *
 * Pi ships no default timeout, so a command that never returns blocks the
 * agent until the user interrupts it. The cap prevents that.
 *
 * The cap has a cost: the notice on the way out (`Command timed out after
 * 300 seconds`) reads as a tool malfunction. Because of that, the agent
 * tends to re-run the same command unchanged. See timeout-message.ts for
 * the replacement.
 */

import {
  createBashToolDefinition,
  type ExtensionAPI,
} from "@earendil-works/pi-coding-agent";
import { explainTimeout } from "./timeout-message.ts";

const DEFAULT_TIMEOUT_SECONDS = 300;

export default function (pi: ExtensionAPI) {
  const core = createBashToolDefinition(process.cwd());

  pi.registerTool({
    ...core,
    async execute(toolCallId, params, signal, onUpdate, ctx) {
      const explicit = params.timeout !== undefined;
      const timeout = params.timeout ?? DEFAULT_TIMEOUT_SECONDS;
      try {
        // This function must forward ctx. The built-in uses it to expose
        // PI_SESSION_ID, PI_SESSION_FILE, PI_PROVIDER, and PI_MODEL to the
        // command.
        return await core.execute(
          toolCallId,
          { ...params, timeout },
          signal,
          onUpdate,
          ctx,
        );
      } catch (error) {
        throw explainTimeout(error, explicit);
      }
    },
  });
}
