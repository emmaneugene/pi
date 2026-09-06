import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["lib/test/**/*.test.ts", "extensions/**/test/**/*.test.ts"],
    // The bash tool tests run real subprocesses with timeouts.
    testTimeout: 30000,
  },
});
