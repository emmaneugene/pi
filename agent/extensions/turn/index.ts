/**
 * turn — pi's turn-based transcript behavior:
 *
 * - diff/: per-turn file-change card and /turn-diff Hunk review (local).
 * - fold/: compact transcript rendering (vendored fork of @onurpi/turn-fold;
 *   see fold/README.md for provenance and local adaptations).
 *
 * turn-diff owns change summaries and reviewable patches, so Turn Fold's
 * upstream edit diffstats stay disabled here.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import turnDiff from "./diff/index.ts";
import turnFold from "./fold/index.ts";

export default function (pi: ExtensionAPI) {
  turnDiff(pi);
  turnFold(pi, { showEditDiffs: false });
}
