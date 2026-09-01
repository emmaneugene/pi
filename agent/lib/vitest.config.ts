import { defineConfig } from "vitest/config";

export default defineConfig({
  root: "lib",
  test: {
    include: ["test/**/*.test.ts"],
  },
});
