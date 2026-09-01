import { describe, expect, it } from "vitest";

import {
  isForeignTranscriptComponent,
  markForeignTranscriptComponent,
} from "../transcript-component-scope.ts";

describe("foreign transcript component scope", () => {
  it("marks components without adding an enumerable property", () => {
    const component = markForeignTranscriptComponent({ value: 1 });

    expect(isForeignTranscriptComponent(component)).toBe(true);
    expect(Object.keys(component)).toEqual(["value"]);
  });

  it("inherits a marker applied before a subclass constructor runs", () => {
    class ForeignComponent {}
    markForeignTranscriptComponent(ForeignComponent.prototype);

    expect(isForeignTranscriptComponent(new ForeignComponent())).toBe(true);
  });
});
