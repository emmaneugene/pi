/**
 * models.ts — Resolve a spawn's model reference against the session registry.
 *
 * A reference is an exact `provider/id` or a unique substring of an available
 * model's id. Nothing here falls back to the parent model: an unresolvable
 * reference is a caller error, and the caller that owns a default applies it
 * itself. Silently substituting the parent model is what made a bad reference
 * invisible to the agent that wrote it.
 */

import type { Model } from "@earendil-works/pi-ai/compat";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

type ModelRegistry = ExtensionContext["modelRegistry"];

/** How a model is named in tool arguments and invocation records. */
export const modelRef = (model: Model<any>): string =>
  `${model.provider}/${model.id}`;

/** Suggestions offered when a reference does not resolve. */
const MAX_SUGGESTIONS = 5;

function availableModels(registry: ModelRegistry): Model<any>[] {
  return registry.getAvailable?.() ?? [];
}

/**
 * The model a reference names, or undefined when nothing matches.
 * Empty input is "no preference", not a failed lookup.
 */
export function findModel(
  input: string | undefined,
  registry: ModelRegistry,
): Model<any> | undefined {
  const reference = input?.trim();
  if (!reference) return undefined;
  const query = reference.toLowerCase();
  const available = availableModels(registry);

  const slash = reference.indexOf("/");
  if (slash !== -1) {
    const exact = registry.find(
      reference.slice(0, slash),
      reference.slice(slash + 1),
    );
    if (
      exact &&
      available.some((m) => m.provider === exact.provider && m.id === exact.id)
    ) {
      return exact;
    }
  }
  // Substring over both forms, so a provider-qualified reference that missed
  // the exact lookup can still match instead of falling through as unknown.
  return available.find(
    (m) =>
      modelRef(m).toLowerCase().includes(query) ||
      m.id.toLowerCase().includes(query),
  );
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
 * Available references closest to one that did not resolve, for the rejection
 * message. This strips a provider prefix and any `:effort` suffix first.
 * Those are the two most common ways a reference goes wrong, and stripping
 * either one still leaves a usable id fragment.
 *
 * The named provider ranks first. One model id is often served by several
 * providers. A caller retries with the head of this list, so sending that
 * retry to a different provider would silently change auth and billing.
 */
export function suggestModels(
  input: string,
  registry: ModelRegistry,
): string[] {
  const { provider, fragment } = parseReference(input);
  const available = availableModels(registry);
  const matches = fragment
    ? available.filter((m) => m.id.toLowerCase().includes(fragment))
    : [];
  const pool = matches.length > 0 ? matches : available;

  const rank = (model: Model<any>): number =>
    (model.provider.toLowerCase() === provider ? 0 : 2) +
    (model.id.toLowerCase() === fragment ? 0 : 1);
  return [...pool]
    .sort((a, b) => rank(a) - rank(b))
    .slice(0, MAX_SUGGESTIONS)
    .map(modelRef);
}
