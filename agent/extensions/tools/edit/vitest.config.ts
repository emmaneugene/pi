import { defineConfig } from "vitest/config";

export default defineConfig({
  root: "extensions/tools/edit",
  test: {
    include: ["test/**/*.test.ts"],
  },
});
