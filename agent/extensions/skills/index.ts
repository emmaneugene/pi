/**
 * skills — everything about how skills surface in the harness:
 *
 * - catalog.ts: /show-skills viewer.
 * - audit.ts: warns on session start when project and global skills collide.
 * - inline-skill-identifier.ts: $skill aliases in the editor. Vendored from
 *   @pi-kaush/pi-inline-skill-identifier (see its header); kept byte-identical
 *   to upstream so re-vendoring stays a file copy.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import audit from "./audit.ts";
import catalog from "./catalog.ts";
import inlineSkillIdentifier from "./inline-skill-identifier.ts";

export default function (pi: ExtensionAPI) {
  catalog(pi);
  audit(pi);
  inlineSkillIdentifier(pi);
}
