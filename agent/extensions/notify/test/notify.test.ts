import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  shouldNotifyOnAgentEnd,
  SUPPRESS_AGENT_END_NOTIFICATION_ENTRY,
} from "../../../lib/session-notification-policy.ts";
import { formatNotification, markdownToNotificationText } from "../index.ts";

describe("markdownToNotificationText", () => {
  it("removes common block and emphasis syntax", () => {
    const markdown = [
      "# **Finished**",
      "> Checked the implementation.",
      "- First item",
      "2. ~~Old~~ _new_ behavior",
    ].join("\n");

    assert.equal(
      markdownToNotificationText(markdown),
      "Finished Checked the implementation. First item Old new behavior",
    );
  });

  it("keeps link labels, image alt text, URLs, and inline code", () => {
    const markdown =
      "See [the report](https://example.com/report), " +
      "![success](result.png), <https://example.com>, and `npm test`.";

    assert.equal(
      markdownToNotificationText(markdown),
      "See the report, success, https://example.com, and npm test.",
    );
  });

  it("removes code fences but preserves their contents", () => {
    const markdown = "```ts\nconst answer = 42;\n```";
    assert.equal(markdownToNotificationText(markdown), "const answer = 42;");
  });

  it("normalizes line endings and repeated whitespace", () => {
    assert.equal(
      markdownToNotificationText("first\r\n\r\n  second\tthird"),
      "first second third",
    );
  });

  it("leaves malformed Markdown readable", () => {
    assert.equal(
      markdownToNotificationText("Result: [unfinished](https://example.com"),
      "Result: [unfinished](https://example.com",
    );
  });
});

describe("shouldNotifyOnAgentEnd", () => {
  it("notifies by default", () => {
    assert.equal(shouldNotifyOnAgentEnd([]), true);
    assert.equal(shouldNotifyOnAgentEnd([{ type: "message" }]), true);
  });

  it("does not notify when the session has the suppression marker", () => {
    assert.equal(
      shouldNotifyOnAgentEnd([
        {
          type: "custom",
          customType: SUPPRESS_AGENT_END_NOTIFICATION_ENTRY,
        },
      ]),
      false,
    );
  });

  it("ignores unrelated entries", () => {
    assert.equal(
      shouldNotifyOnAgentEnd([
        { type: "custom", customType: "other" },
        { customType: SUPPRESS_AGENT_END_NOTIFICATION_ENTRY },
      ]),
      true,
    );
  });
});

describe("formatNotification", () => {
  it("uses a fallback title when no readable text remains", () => {
    assert.deepEqual(formatNotification(null), {
      title: "Ready for input",
      body: "",
    });
    assert.deepEqual(formatNotification("  \n\t"), {
      title: "Ready for input",
      body: "",
    });
  });

  it("uses the Pi title for a non-empty response", () => {
    assert.deepEqual(formatNotification("**Done**"), {
      title: "π",
      body: "Done",
    });
  });

  it("limits the body to 200 Unicode code points without splitting a surrogate pair", () => {
    const formatted = formatNotification("🙂".repeat(201));
    assert.equal(Array.from(formatted.body).length, 200);
    assert.equal(formatted.body, `${"🙂".repeat(199)}…`);
  });
});
