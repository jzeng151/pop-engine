import { availableParallelism } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const repoRoot = path.dirname(fileURLToPath(import.meta.url));

// One core is reserved for the main process, which is the reporter's and the RPC server's.
//
// Vitest defaults to one worker per core and does not count the main process, so a two-core runner
// gets two CPU-bound workers and a main process fighting for the same two cores. Workers report
// results by calling `onTaskUpdate` on the main process over birpc, which throws after 60 seconds
// unanswered, and vitest counts that throw as an unhandled error and exits non-zero with every test
// passing. That is exactly how runs 31269789560 and 31272998939 failed: `Test Files 67 passed`,
// `Tests 1813 passed`, `Errors 1 error`, coverage over threshold on all four metrics.
//
// It began when `scripts/dedupe-cofiring/` landed, and the reason is the load, not the suite: that
// file is 80 seconds of uninterruptible sweeping on the runner against 6 seconds here, and it runs
// beside `scripts/check-baseline-drift.test.mjs`, which is another 67 seconds and additionally
// spawns `tsc` children vitest's scheduler cannot see. Total test time was 266 seconds inside a
// 113-second wall, so the main process was getting a fraction of a core for minutes at a time.
//
// Leaving it a core costs wall-clock on small machines and buys back most of it in lost contention.
// It is deliberately not a hard-coded 1: a developer's machine keeps its parallelism.
const workers = Math.max(1, availableParallelism() - 1);

// Single root config runs every workspace test suite (`pnpm test`).
// Coverage is enforced at 90% per CONTRIBUTING.md across the engine, the api, and the
// web app, components included.
export default defineConfig({
  // React components are transformed by esbuild's automatic JSX runtime. Tests need no
  // React import and the app keeps Next's own build untouched (`jsx: preserve`).
  esbuild: { jsx: "automatic" },
  resolve: {
    // next/font/google is a Next build-time loader; vitest cannot call it.
    alias: {
      "next/font/google": path.join(repoRoot, "apps/web/test/next-font-google-mock.ts"),
    },
  },
  test: {
    // The default stays node: the engine and api suites are pure and must stay fast.
    // Component tests opt into jsdom per file with a `@vitest-environment jsdom`
    // docblock, so only those files pay for a DOM.
    environment: "node",
    // Discovery covers every workspace, so a new app's tests run the day they land.
    // Next.js keeps its code in `app/`, not `src/`, so that tree is listed too.
    // `scripts/` is listed because the baseline check is CI's own guard, and a guard with no test
    // proves only that it does not false-positive on a good tree. Nothing proved it still FAILS on
    // a bad one until its suite existed.
    include: [
      "{apps,packages}/*/src/**/*.test.{ts,tsx}",
      "apps/web/app/**/*.test.{ts,tsx}",
      "scripts/**/*.test.mjs",
    ],
    // Only `scripts/check-baseline-drift.test.mjs` runs concurrent cases today, and each one spawns
    // a node process that loads the TypeScript compiler. The default of 5 saturated a two-core CI
    // runner well enough to time out an unrelated 5-second database test in `checklist.test.ts`,
    // once, on a run where every other file passed. Measured on this tree, not predicted: that file
    // runs 122 cases in 5.6s at five and 12.0s at two, against 12.8s for the 110-case synchronous
    // version it replaced. Two therefore costs most of the parallel win and still does not regress,
    // and the property that actually fixed the reporter timeout is the awaiting rather than the
    // parallelism, so buying safety with it is cheap.
    maxConcurrency: 2,
    maxWorkers: workers,
    minWorkers: 1,

    // Workspace packages export TypeScript source; force Vite to transform them.
    server: { deps: { inline: ["@pop-engine/engine"] } },
    coverage: {
      provider: "v8",
      // `scripts/` is deliberately NOT here, and the reason is measured rather than assumed.
      // Its suite runs the real guard in `spawnSync` children pointed at planted trees, which is
      // what makes those tests worth anything: they exercise the file CI runs rather than a copy.
      // v8 does not instrument those children, so adding `scripts/**` reports 0% for a file its
      // suite exercises hard and drops the all-files figure from 97% to 70.67%, failing the 90%
      // gate. Measured on this tree, not predicted. A number that says zero about well-tested code
      // is worse than an honest exclusion, and instrumenting the children to manufacture a
      // percentage would be worse still. What stands in for the gate here is the suite itself:
      // every rule has a planted tree that provably fails when the rule regresses.
      include: ["packages/engine/src/**", "apps/api/src/**", "apps/web/app/**"],
      exclude: ["**/*.test.{ts,tsx}", "apps/api/src/index.ts"],
      thresholds: {
        statements: 90,
        branches: 90,
        functions: 90,
        lines: 90,
      },
      reporter: ["text", "html"],
    },
  },
});
