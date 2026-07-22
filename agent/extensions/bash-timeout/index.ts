/**
 * Overrides the built-in `bash` tool to apply a shorter default timeout
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createBashTool } from "@earendil-works/pi-coding-agent";

const DEFAULT_TIMEOUT_SECONDS = 300;

export default function (pi: ExtensionAPI) {
  const bashTool = createBashTool(process.cwd());

  pi.registerTool({
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
