import { defineConfig } from "vitest/config";

export default defineConfig({
  root: "extensions/tools/ask-user-question",
  test: {
    include: ["test/**/*.test.ts"],
  },
});
