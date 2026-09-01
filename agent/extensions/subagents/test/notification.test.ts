import { describe, expect, it } from "vitest";
import { notificationHeadline } from "../notification.ts";

describe("notificationHeadline", () => {
  it("keeps only the completion line", () => {
    expect(
      notificationHeadline(
        'Agent "Review auth" completed (12 tool uses).\n\n## Summary\nAll checks passed.',
      ),
    ).toBe('Agent "Review auth" completed (12 tool uses).');
  });

  it("leaves a one-line failure unchanged", () => {
    expect(
      notificationHeadline('Agent "Review auth" stopped. No final response.'),
    ).toBe('Agent "Review auth" stopped. No final response.');
  });
});
