const FOREIGN_TRANSCRIPT_COMPONENT = Symbol.for(
  "pi.foreign-transcript-component",
);

type MarkedTranscriptComponent = object & {
  [FOREIGN_TRANSCRIPT_COMPONENT]?: true;
};

export function markForeignTranscriptComponent<T extends object>(
  component: T,
): T {
  Object.defineProperty(component, FOREIGN_TRANSCRIPT_COMPONENT, {
    configurable: false,
    enumerable: false,
    value: true,
    writable: false,
  });
  return component;
}

export function isForeignTranscriptComponent(component: object): boolean {
  return (
    (component as MarkedTranscriptComponent)[FOREIGN_TRANSCRIPT_COMPONENT] ===
    true
  );
}
