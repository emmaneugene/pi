import { defineConfig } from "vitest/config";

export default defineConfig({
  root: "extensions/turn-fold",
  test: {
    include: ["test/**/*.test.ts"],
  },
});
