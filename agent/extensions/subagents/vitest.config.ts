import { defineConfig } from "vitest/config";

export default defineConfig({
  root: "extensions/subagents",
  test: {
    include: ["test/**/*.test.ts"],
  },
});
