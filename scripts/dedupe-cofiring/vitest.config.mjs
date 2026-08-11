import { defineConfig } from "vitest/config";

// This suite has its own config so it can stay OUT of the root `include`.
export default defineConfig({
  test: {
    environment: "node",
    include: ["scripts/dedupe-cofiring/**/*.test.mjs"],
  },
});
