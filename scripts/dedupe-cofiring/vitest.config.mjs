import { defineConfig } from "vitest/config";

// This suite has its own config so it can stay OUT of the root `include`.
//
// Its only input is `rules/proposals/nyc-rules.v2-full-draft.json`, which `docs/BASELINE.md`
// carries as "ARCHIVED / PROPOSED drafts". AGENTS.md requires stopping when a feature's inputs are
// PROPOSED, so a suite reading one must not sit inside the run that CI enforces or that AGENTS.md
// requires before review: an ordinary revision of the proposal would then fail those runs until
// every figure here was resynchronised, which inverts the rule. It runs on demand instead:
//
//   pnpm test:cofiring
//
// It folds back into the root config when the draft's baseline row is APPROVED.
export default defineConfig({
  test: {
    environment: "node",
    include: ["scripts/dedupe-cofiring/**/*.test.mjs"],
  },
});
