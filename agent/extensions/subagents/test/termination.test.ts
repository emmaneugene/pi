import { describe, expect, it } from "vitest";
import {
  classifyProviderError,
  resultOrReason,
  terminationNote,
} from "../termination.ts";
import type { AgentRecord } from "../types.ts";

// Verbatim from local child transcripts.
const REAL_401 =
  'OpenAI API error (401): {"message":"Incorrect API key provided: sk-proj-Ab3dEfGhIjKlMnOpQrSt","type":"invalid_request_error","param":null,"code":"invalid_api_key"}';
const REAL_TOKEN =
  "Your authentication token has been invalidated. Please try signing in again.";
const REAL_404 =
  '404 {"type":"error","error":{"type":"not_found_error","message":"model: claude-3-opus-20240229"},"request_id":"req_011CcSECRET"}';
const REAL_CONN = "Connection error.";

// Everything an earlier implementation leaked. Prose is the hard case: a
// leaked prompt has no symbols to filter on.
const HOSTILE = [
  '{"request_id":"req_01HXSECRET","api_key":"AIzaSyDUMMY1234567890abcdef","prompt":"private payroll prompt"}',
  "GET https://api.example.test/run?access_token=superSecretToken123456&prompt=delete%20production",
  'API failed: {"meta":{"message":"private echoed prompt"},"error":{"message":"safe auth failure"}}',
  "auth failed AKIAIOSFODNN7EXAMPLE / wJalrXUtnFEMI0K7MDENGbPxRfiCYEXAMPLEKEY",
  "denied: Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abc",
  "Echoed prompt Employee Alice salary is 90000 and diagnosis is cancer",
  "Authentication failed for key AIza-SyDUMMY-1234567890-abcdef",
  "pin 4417 rejected",
];
const SECRETS = [
  "req_01HXSECRET",
  "AIzaSy",
  "AIza-Sy",
  "payroll",
  "superSecretToken",
  "delete%20",
  "private echoed",
  "AKIA",
  "wJalrX",
  "eyJhbGci",
  "sk-proj",
  "Alice",
  "90000",
  "cancer",
  "4417",
];

const record = (over: Partial<AgentRecord>): AgentRecord =>
  ({ turns: 3, status: "completed", ...over }) as AgentRecord;

describe("classifyProviderError", () => {
  it.each([
    REAL_401,
    REAL_TOKEN,
    "API key not valid. Please pass a valid API key.",
  ])("credentials: %s", (raw) =>
    expect(classifyProviderError(raw)).toBe("credentials"),
  );

  it.each([REAL_404, "400 Bad Request: context length exceeded"])(
    "request: %s",
    (raw) => expect(classifyProviderError(raw)).toBe("request"),
  );

  it("lands somewhere permanent when the provider is itself ambiguous", () => {
    // Anthropic returns one message for "no such model" and "no access".
    // Which label wins does not matter; not retrying does.
    const raw =
      "The requested model does not exist or you do not have access to it.";
    expect(classifyProviderError(raw)).not.toBe("transient");
    expect(
      terminationNote(record({ stopReason: "error", errorMessage: raw })),
    ).toContain("Relaunching as-is");
  });

  it.each([
    REAL_CONN,
    "OpenAI API error (503): service temporarily unavailable",
    "rate limit exceeded, try again shortly",
    // A permanent-looking status whose body says otherwise. Calling this
    // permanent would suppress a retry that works, the costlier mistake.
    "403 Forbidden: rate limit exceeded, retry after 30 seconds",
  ])("transient: %s", (raw) =>
    expect(classifyProviderError(raw)).toBe("transient"),
  );

  it.each([
    // Digits that merely contain a status code must not read as one.
    "connection reset after 1401ms",
    "temporary upstream failure; request req_01H404ABCDEF; retry later",
  ])("does not read an embedded number as a status code: %s", (raw) => {
    expect(classifyProviderError(raw)).not.toBe("credentials");
    expect(classifyProviderError(raw)).not.toBe("request");
  });

  it("does not guess", () => {
    expect(classifyProviderError("Cursor session agent scope is closed")).toBe(
      "unknown",
    );
    expect(classifyProviderError("terminated")).toBe("unknown");
    expect(classifyProviderError(undefined)).toBe("unknown");
  });
});

describe("provider text is never echoed", () => {
  const note = (errorMessage: string) =>
    terminationNote(record({ stopReason: "error", errorMessage }))!;

  /** A minimal, secret-free message of each class. */
  const BENIGN: Record<string, string> = {
    transient: "connection",
    credentials: "401",
    request: "404",
    unknown: "zzz",
  };

  it.each(HOSTILE)(
    "output depends only on the class, not the text: %s",
    (raw) => {
      // If any fragment of the message reached the output, this would differ
      // from the output for a benign message of the same class.
      expect(note(raw)).toBe(note(BENIGN[classifyProviderError(raw)]));
    },
  );

  it.each(HOSTILE)("contains no secret from: %s", (raw) => {
    for (const secret of SECRETS) expect(note(raw)).not.toContain(secret);
  });

  it("applies the same boundary to a thrown error", () => {
    const out = resultOrReason(
      record({
        error: "Provider threw echoed prompt Employee Alice salary is 90000",
      }),
    );
    expect(out).not.toContain("Alice");
    expect(out).not.toContain("90000");
    expect(out).toContain("unrecognized provider error");
  });
});

describe("terminationNote", () => {
  it("is undefined for a clean run, so the answer passes through", () => {
    expect(terminationNote(record({ stopReason: "stop" }))).toBeUndefined();
    expect(terminationNote(record({}))).toBeUndefined();
  });

  it("advises against relaunching only a permanent failure", () => {
    const permanent = terminationNote(
      record({ stopReason: "error", errorMessage: REAL_TOKEN }),
    )!;
    const transient = terminationNote(
      record({ stopReason: "error", errorMessage: REAL_CONN }),
    )!;
    expect(permanent).toContain("Relaunching as-is will fail the same way");
    expect(transient).not.toContain("Relaunching as-is");
  });

  it("distinguishes the three ways a child gets cancelled", () => {
    const base = { stopReason: "aborted", turns: 12 } as const;
    expect(terminationNote(record({ ...base, userAborted: true }))).toBe(
      "The child was cancelled after 12 turns (stopped by the user).",
    );
    expect(terminationNote(record({ ...base, hitTurnLimit: true }))).toBe(
      "The child was cancelled after 12 turns (turn budget exhausted).",
    );
    expect(terminationNote(record(base))).toBe(
      "The child was cancelled after 12 turns.",
    );
  });

  it("names a truncated run rather than letting it look complete", () => {
    expect(terminationNote(record({ stopReason: "length" }))).toContain(
      "output limit",
    );
  });

  it("points at the transcript, which keeps the full provider text", () => {
    expect(
      terminationNote(
        record({
          stopReason: "error",
          errorMessage: REAL_401,
          transcriptFile: "/tmp/child.jsonl",
        }),
      ),
    ).toContain("/tmp/child.jsonl");
  });

  it("pluralizes turns", () => {
    expect(
      terminationNote(record({ stopReason: "aborted", turns: 1 })),
    ).toContain("after 1 turn.");
    expect(
      terminationNote(record({ stopReason: "aborted", turns: 2 })),
    ).toContain("after 2 turns.");
  });
});

describe("resultOrReason", () => {
  it("returns the answer untouched on a clean run", () => {
    expect(resultOrReason(record({ result: "the answer is 42" }))).toBe(
      "the answer is 42",
    );
  });

  it("explains an empty provider failure", () => {
    const out = resultOrReason(
      record({
        status: "error",
        stopReason: "error",
        errorMessage: REAL_TOKEN,
        turns: 1,
      }),
    );
    expect(out).toContain("authentication or permission failure");
    expect(out).toContain("Relaunching as-is");
  });

  it("never lets stale text hide a failure", () => {
    // Streamed text is retained across messages, so an aborted child can carry
    // text from an earlier turn. It must not read as the final answer.
    const out = resultOrReason(
      record({
        status: "aborted",
        stopReason: "aborted",
        result: "I will inspect the files now.",
        turns: 4,
      }),
    );
    expect(out.indexOf("cancelled")).toBeLessThan(
      out.indexOf("I will inspect"),
    );
    expect(out).toContain("Partial output:");
  });

  it("keeps a truncated answer but marks it incomplete", () => {
    const out = resultOrReason(
      record({ stopReason: "length", result: "The migration is complete" }),
    );
    expect(out).toContain("The migration is complete");
    expect(out).toContain("output limit");
  });

  it("uses the recorded turn limit rather than inferring it from status", () => {
    expect(
      resultOrReason(record({ stopReason: "aborted", hitTurnLimit: true })),
    ).toContain("turn budget exhausted");
    expect(
      resultOrReason(record({ status: "steered", stopReason: "aborted" })),
    ).not.toContain("turn budget exhausted");
  });

  it("says so when there is neither an answer nor a reason", () => {
    expect(resultOrReason(record({}))).toBe(
      "No final response, and no reason was reported.",
    );
  });
});
