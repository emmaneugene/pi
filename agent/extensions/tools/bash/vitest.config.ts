import { defineConfig } from "vitest/config";

export default defineConfig({
  root: "extensions/tools/bash",
  test: {
    include: ["test/**/*.test.ts"],
    testTimeout: 30000,
  },
});
