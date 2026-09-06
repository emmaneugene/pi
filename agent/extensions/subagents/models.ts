/**
 * models.ts — Resolve a spawn's model reference against the session scope.
 *
 * A reference is an exact `provider/id` or a unique substring of a scoped
 * model's id. An empty scope exposes no model choices. Nothing here falls back
 * to the global model registry or parent model: the caller that owns an
 * inheritance policy applies it itself.
 */

import type { Model } from "@earendil-works/pi-ai/compat";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

type ScopedModels = ExtensionContext["scopedModels"];

/** How a model is named in tool arguments and invocation records. */
export const modelRef = (model: Model<any>): string =>
  `${model.provider}/${model.id}`;

/** Suggestions offered when a reference does not resolve. */
const MAX_SUGGESTIONS = 5;

/** Unique models in the configured session scope. */
function modelsInScope(scope: ScopedModels | undefined): Model<any>[] {
  const models = new Map<string, Model<any>>();
  for (const entry of scope ?? []) {
    models.set(modelRef(entry.model), entry.model);
  }
  return [...models.values()];
}

/**
 * The scoped model a reference names, or undefined when nothing matches.
 * Empty input is "no preference", not a failed lookup.
 */
export function findModel(
  input: string | undefined,
  scope: ScopedModels | undefined,
): Model<any> | undefined {
  const reference = input?.trim();
  if (!reference) return undefined;
  const query = reference.toLowerCase();
  const models = modelsInScope(scope);

  const exact = models.find((model) => modelRef(model).toLowerCase() === query);
  if (exact) return exact;

  const matches = models.filter(
    (model) =>
      modelRef(model).toLowerCase().includes(query) ||
      model.id.toLowerCase().includes(query),
  );
  return matches.length === 1 ? matches[0] : undefined;
}

/** The provider and bare id a reference names, however malformed it is. */
function parseReference(input: string): {
  provider?: string;
  fragment: string;
} {
  const withoutEffort = input.split(":")[0].trim().toLowerCase();
  const slash = withoutEffort.indexOf("/");
  if (slash === -1) return { fragment: withoutEffort };
  return {
    provider: withoutEffort.slice(0, slash),
    // A provider can prefix its own ids (openrouter/openai/gpt-x), so the bare
    // id is the last segment, not the remainder.
    fragment:
      withoutEffort
        .slice(slash + 1)
        .split("/")
        .pop() ?? "",
  };
}

/**
 * Scoped references closest to one that did not resolve. This strips a
 * provider prefix and any `:effort` suffix first. Those are the two most common
 * ways a reference goes wrong, and stripping either one still leaves a usable
 * id fragment.
 *
 * The named provider ranks first. One model id is often served by several
 * providers. A caller retries with the head of this list, so sending that retry
 * to a different provider would silently change auth and billing.
 */
export function suggestModels(
  input: string,
  scope: ScopedModels | undefined,
): string[] {
  const { provider, fragment } = parseReference(input);
  const models = modelsInScope(scope);
  const matches = fragment
    ? models.filter((model) => model.id.toLowerCase().includes(fragment))
    : [];
  const pool = matches.length > 0 ? matches : models;

  const rank = (model: Model<any>): number =>
    (model.provider.toLowerCase() === provider ? 0 : 2) +
    (model.id.toLowerCase() === fragment ? 0 : 1);
  return [...pool]
    .sort((a, b) => rank(a) - rank(b))
    .slice(0, MAX_SUGGESTIONS)
    .map(modelRef);
}
