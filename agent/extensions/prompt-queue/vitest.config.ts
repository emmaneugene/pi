import { defineConfig } from "vitest/config";

export default defineConfig({
  cacheDir: "../../node_modules/.vite/prompt-queue",
  root: "extensions/prompt-queue",
  test: {
    include: ["test/**/*.test.ts"],
  },
});
