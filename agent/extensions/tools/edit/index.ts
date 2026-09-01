/**
 * Overrides the built-in `edit` tool with two additions:
 *
 * 1. `edits[].replaceAll` rewrites every occurrence of `oldText` in one call,
 *    matching the Claude Code and Cursor edit tools.
 * 2. An ambiguous `oldText` reports the line number of every occurrence and
 *    names `replaceAll` as the alternative, instead of reporting a bare count.
 *
 * This override never writes a file. The built-in definition applies every
 * call, so the built-in owns path resolution, the file mutation queue, BOM
 * and line-ending preservation, abort handling, and diff rendering.
 *
 * This override expresses a `replaceAll` call to the built-in as a single
 * whole-file replacement. The built-in re-reads the file under the mutation
 * queue before that replacement runs, so it still refuses the write if the
 * file changed after this override first read it.
 */

import { readFile } from "node:fs/promises";
import {
  createEditToolDefinition,
  type ExtensionAPI,
} from "@earendil-works/pi-coding-agent";
import { Container } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import { resolveToolPath } from "../../../lib/paths.ts";
import {
  applyEdits,
  duplicateMatchError,
  type EditSpec,
  locateOccurrences,
  normalizeToLF,
  parseDuplicateError,
  stripBom,
} from "./replace.ts";

const replaceEditSchema = Type.Object({
  oldText: Type.String({
    description:
      "Exact text for one targeted replacement. It must be unique in the original file unless replaceAll is set, and must not overlap with any other edits[].oldText in the same call.",
  }),
  newText: Type.String({
    description: "Replacement text for this targeted edit.",
  }),
  replaceAll: Type.Optional(
    Type.Boolean({
      description:
        "Replace every occurrence of oldText instead of requiring a unique match. Use for mechanical rewrites such as renames; oldText must then match exactly, with no whitespace-insensitive fallback.",
    }),
  ),
});

const editSchema = Type.Object({
  path: Type.String({
    description: "Path to the file to edit (relative or absolute)",
  }),
  edits: Type.Array(replaceEditSchema, {
    description:
      "One or more targeted replacements. Each edit is matched against the original file, not incrementally. Do not include overlapping or nested edits. If two changes touch the same block or nearby lines, merge them into one edit instead.",
  }),
});

type EditInput = { path: string; edits: EditSpec[] };
type CoreEdit = { oldText: string; newText: string };

function coerceBoolean(value: unknown): boolean | undefined {
  if (typeof value === "boolean") return value;
  if (value === "true") return true;
  if (value === "false") return false;
  return undefined;
}

type MaybeFlagged = { replaceAll?: unknown; replace_all?: unknown };

function flagOf(value: MaybeFlagged | null | undefined): boolean | undefined {
  return coerceBoolean(value?.replaceAll ?? value?.replace_all);
}

/**
 * True when any edit asks for replaceAll, in any spelling a model might send.
 * Applied to raw streaming arguments, so it cannot assume prepareArguments ran.
 */
function usesReplaceAll(args: unknown): boolean {
  if (!args || typeof args !== "object") return false;
  const candidate = args as MaybeFlagged & { edits?: unknown };
  if (flagOf(candidate) === true) return true;

  let edits = candidate.edits;
  if (typeof edits === "string") {
    try {
      edits = JSON.parse(edits);
    } catch {
      return false;
    }
  }
  return (
    Array.isArray(edits) &&
    edits.some((edit) => flagOf(edit as MaybeFlagged) === true)
  );
}

function validateInput(input: unknown): EditInput {
  const args = input as { path?: unknown; edits?: unknown };
  if (
    typeof args.path !== "string" ||
    !Array.isArray(args.edits) ||
    args.edits.length === 0
  ) {
    throw new Error(
      "Edit tool input is invalid. edits must contain at least one replacement.",
    );
  }
  return { path: args.path, edits: args.edits as EditSpec[] };
}

export default function (pi: ExtensionAPI) {
  const cwd = process.cwd();
  const core = createEditToolDefinition(cwd);
  // renderCall is optional on ToolDefinition, but the built-in edit tool always
  // supplies one. Fall back to an empty component rather than assert.
  const renderCoreCall = core.renderCall ?? (() => new Container());

  /**
   * Restate a bare duplicate-count error from the built-in with the line
   * numbers of the occurrences. Re-reads the file, which may have changed since
   * the failure; a disagreeing count drops the line numbers but keeps the
   * replaceAll hint.
   */
  async function locateDuplicates(
    error: unknown,
    path: string,
    edits: EditSpec[],
  ): Promise<never> {
    if (!(error instanceof Error)) throw error;
    const duplicate = parseDuplicateError(error.message);
    if (!duplicate || duplicate.editIndex >= edits.length) throw error;

    let lines: number[] = [];
    try {
      const content = normalizeToLF(
        stripBom(
          (await readFile(resolveToolPath(path, cwd))).toString("utf-8"),
        ),
      );
      lines = locateOccurrences(content, edits[duplicate.editIndex].oldText);
    } catch {
      // Leave lines empty; the message degrades to the alternative alone.
    }
    throw duplicateMatchError(
      path,
      duplicate.editIndex,
      edits.length,
      duplicate.count,
      lines,
    );
  }

  /**
   * Express a replaceAll call as one whole-file replacement so the built-in
   * applies it. The built-in re-reads under the mutation queue and rejects the
   * write if `oldText` no longer matches, which is what makes reading here safe.
   */
  async function toWholeFileEdit(
    path: string,
    edits: EditSpec[],
  ): Promise<{ coreEdits: CoreEdit[]; replacements: number }> {
    let raw: string;
    try {
      raw = (await readFile(resolveToolPath(path, cwd))).toString("utf-8");
    } catch (error) {
      const detail =
        error instanceof Error && "code" in error
          ? `Error code: ${error.code}`
          : String(error);
      throw new Error(`Could not edit file: ${path}. ${detail}.`);
    }
    const content = normalizeToLF(stripBom(raw));
    const { newContent, replacements } = applyEdits(content, edits, path);
    return {
      coreEdits: [{ oldText: content, newText: newContent }],
      replacements,
    };
  }

  pi.registerTool({
    ...core,
    parameters: editSchema,
    description: `${core.description} Set edits[].replaceAll to rewrite every occurrence of oldText in one call.`,
    promptGuidelines: [
      ...(core.promptGuidelines ?? []),
      "For a mechanical rewrite that touches every occurrence in a file (a rename, an import path change), set edits[].replaceAll: true instead of padding oldText with context or falling back to sed.",
    ],

    prepareArguments(raw: unknown) {
      const prepared = (core.prepareArguments?.(raw) ?? raw) as {
        edits?: unknown;
        replaceAll?: unknown;
        replace_all?: unknown;
      };
      if (
        !prepared ||
        typeof prepared !== "object" ||
        !Array.isArray(prepared.edits)
      ) {
        return prepared as EditInput;
      }
      // A legacy top-level call carries its flag outside edits[]; the built-in
      // prepareArguments folds such a call into the final edit.
      const legacy = raw as { oldText?: unknown };
      const legacyFlag =
        typeof legacy?.oldText === "string" ? flagOf(prepared) : undefined;
      const lastIndex = prepared.edits.length - 1;

      // Drop both spellings, then reinstate a single canonical boolean, so no
      // unvalidated flag value reaches the schema.
      prepared.edits = prepared.edits.map((entry, index) => {
        const { replaceAll, replace_all, ...rest } = entry as EditSpec &
          MaybeFlagged;
        const flag =
          flagOf({ replaceAll, replace_all }) ??
          (index === lastIndex ? legacyFlag : undefined);
        return flag === undefined ? rest : { ...rest, replaceAll: flag };
      });
      return prepared as EditInput;
    },

    async execute(toolCallId, input, signal, onUpdate, ctx) {
      const { path, edits } = validateInput(input);
      const bulk = edits.some((edit) => edit.replaceAll === true);
      const plan = bulk
        ? await toWholeFileEdit(path, edits)
        : {
            coreEdits: edits.map(({ oldText, newText }) => ({
              oldText,
              newText,
            })),
            replacements: 0,
          };

      const result = await core
        .execute(
          toolCallId,
          { path, edits: plan.coreEdits },
          signal,
          onUpdate,
          ctx,
        )
        .catch((error: unknown) => locateDuplicates(error, path, edits));

      if (!bulk) return result;
      // The built-in counts the one synthetic whole-file edit, not the occurrences.
      return {
        ...result,
        content: [
          {
            type: "text" as const,
            text: `Successfully replaced ${plan.replacements} occurrence(s) in ${path}.`,
          },
        ],
      };
    },

    renderCall(args, theme, context) {
      // The built-in preview runs the built-in matcher, which reports a
      // duplicate error for any replaceAll edit. An empty edits[] makes the
      // built-in skip the preview; renderResult still paints the applied diff.
      return renderCoreCall(
        usesReplaceAll(args) ? { ...args, edits: [] } : args,
        theme,
        context,
      );
    },
  });
}
