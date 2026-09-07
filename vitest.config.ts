import path from "node:path";
import { fileURLToPath } from "node:url";
import { configDefaults, defineConfig } from "vitest/config";

const repoRoot = path.dirname(fileURLToPath(import.meta.url));

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
    //
    // The glob is recursive, and the one directory that must stay out is named in `exclude` below
    // rather than kept out by a shallow glob. A shallow glob spells the exemption as "any script
    // test in any subdirectory", which drops guards that need no exemption the day someone adds
    // `scripts/migrations/check.test.mjs` (#251 review).
    include: [
      "{apps,packages}/*/src/**/*.test.{ts,tsx}",
      "apps/web/app/**/*.test.{ts,tsx}",
      "scripts/**/*.test.mjs",
    ],
    // `scripts/dedupe-cofiring/` measures `rules/proposals/nyc-rules.v2-full-draft.json`, which
    // `docs/BASELINE.md` carries as "ARCHIVED / PROPOSED drafts", so it must not sit inside the
    // suite AGENTS.md requires before review: a revision of the proposal would fail that suite
    // until the measurements were resynchronised, which is the stop-on-PROPOSED rule inverted. It
    // runs on demand instead, through `pnpm test:cofiring`, which supplies its own include.
    //
    // `configDefaults.exclude` is spread back in because naming `exclude` at all replaces vitest's
    // own list, and dropping it would walk `node_modules`.
    exclude: [...configDefaults.exclude, "scripts/dedupe-cofiring/**"],
    // Baseline-check tests spawn TypeScript processes. Limit concurrent cases to avoid CI timeouts.
    maxConcurrency: 2,
    // API files share one PostgreSQL database; a live alert poller in one file can claim another
    // file's due reminders. Keep files serial so database suites remain isolated (#296).
    fileParallelism: false,

    // Workspace packages export TypeScript source; force Vite to transform them.
    server: { deps: { inline: ["@pop-engine/engine"] } },
    coverage: {
      provider: "v8",
      // Parent V8 coverage does not instrument the baseline guard's subprocesses. Its tests run
      // the real guard against planted repositories. The proposed co-firing suite runs separately
      // via test:cofiring and is excluded from this run above.
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
