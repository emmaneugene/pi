/**

 * Overrides the built-in `bash` tool to apply a default timeout (in seconds)
 * whenever the model does not specify one.
 *
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createBashTool } from "@earendil-works/pi-coding-agent";

// Default timeout in seconds applied when the model omits `timeout`.
const DEFAULT_TIMEOUT_SECONDS = 300;

export default function (pi: ExtensionAPI) {
  const bashTool = createBashTool(process.cwd());

  pi.registerTool({
    // Spread keeps name ("bash"), schema, label, and built-in renderers.
    // Same name => overrides the built-in bash tool.
    ...bashTool,
    execute: async (id, params, signal, onUpdate, _ctx) => {
      const withDefault = {
        ...params,
        timeout: params.timeout ?? DEFAULT_TIMEOUT_SECONDS,
      };
      return bashTool.execute(id, withDefault, signal, onUpdate);
    },
  });
}
