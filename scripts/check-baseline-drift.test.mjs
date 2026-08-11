import { afterAll, describe, expect, it } from "vitest";
import { execFile } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptPath = resolve(dirname(fileURLToPath(import.meta.url)), "check-baseline-drift.mjs");

const ruleset = (version) => ["nyc", `rules.v${version}.json`].join("-");

const SQUARE_RECONCILED = {
  "docs/ROADMAP.md":
    "# Roadmap\n\n- **F-408 · Inventory Low-Stock Alerts** — manual counts or Square webhook.\n",
  "docs/PRD.md":
    "# PRD\n\n- **F-308 / F-408** — ticketing integration/export; inventory low-stock alerts " +
    "(manual counts or Square webhook).\n",
  "docs/ARCHITECTURE-FUTURE.md":
    "# Architecture\n\n| External integrations | F-108, F-212, F-308, F-408 | webhook events |\n",
};

const FIXTURE_VERSION = "nyc.v0.0";
const FIXTURE_RULESET = ruleset("0.0");
const MISSING = ruleset("9.9");
const ALSO_MISSING = ruleset("8.8");

function plant(files = {}) {
  const root = mkdtempSync(join(tmpdir(), "baseline-check-"));
  const seed = {
    "docs/BASELINE.md":
      "# Fixture manifest\n\nNo APPROVED rows, so no status or digest is claimed.\n",
    [`rules/${FIXTURE_RULESET}`]: JSON.stringify({ ruleset_version: FIXTURE_VERSION }),
    "apps/api/src/ruleset.ts": `const EXPECTED_RULESET_VERSION = "${FIXTURE_VERSION}";\n`,
    ...SQUARE_RECONCILED,
    ...files,
  };
  for (const [relative, contents] of Object.entries(seed)) {
    if (contents === null) continue;
    const full = join(root, relative);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, contents);
  }
  return root;
}

function check(root) {
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      [scriptPath],
      { encoding: "utf8", env: { ...process.env, BASELINE_CHECK_ROOT: root } },
      (error, stdout, stderr) => {
        resolve({ status: error === null ? 0 : (error.code ?? 1), output: `${stdout}${stderr}` });
      },
    );
  });
}

const roots = [];
const runOn = (files) => {
  const root = plant(files);
  roots.push(root);
  return check(root);
};

afterAll(() => {
  while (roots.length > 0) rmSync(roots.pop(), { recursive: true, force: true });
});

describe.concurrent("the baseline check's own guarantees", () => {
  it("passes a tree with nothing wrong in it, so a failure below means something", async () => {
    const { status, output } = await runOn({});

    expect(status).toBe(0);
    expect(output).toContain("Ruleset reference check passed");
  });
});

describe.concurrent("ruleset names in executable code", () => {
  it("fails on a dangling name in a string literal, naming file, line and version", async () => {
    const { status, output } = await runOn({
      "apps/web/app/reader.ts": `const a = 1;\nconst path = "rules/${MISSING}";\n`,
    });

    expect(status).toBe(1);
    expect(output).toContain(`apps/web/app/reader.ts:2 names ${MISSING}`);
    expect(output).toContain(`The repo publishes: ${FIXTURE_RULESET}`);
  });

  it("passes the same name in a comment, even quoted, which is the documented boundary", async () => {
    const { status, output } = await runOn({
      "apps/web/app/reader.ts":
        `// \`rules/${MISSING}\` used to be read here.\n` +
        `/* and "rules/${ALSO_MISSING}" before that */\n` +
        "const a = 1;\n",
    });

    expect(status).toBe(0);
    expect(output).not.toContain(MISSING);
    expect(output).not.toContain(ALSO_MISSING);
  });

  it("fails on a name split across lines in a template literal", async () => {
    const { status, output } = await runOn({
      "apps/web/app/reader.ts": `const path = \`rules/\n${MISSING}\`;\n`,
    });

    expect(status).toBe(1);
    expect(output).toContain(`apps/web/app/reader.ts:2 names ${MISSING}`);
  });

  it.each([
    ["a .bak suffix", `${FIXTURE_RULESET}.bak`],
    ["a .jsonx suffix", FIXTURE_RULESET.replace(".json", ".jsonx")],
  ])("fails on a published name with %s", async (_label, named) => {
    const { status, output } = await runOn({
      "apps/web/app/reader.ts": `const path = "rules/${named}";\n`,
    });

    expect(status).toBe(1);
    expect(output).toContain(`apps/web/app/reader.ts:1 names ${named}`);
  });

  it.each([
    ["a query suffix", `${FIXTURE_RULESET}?backup`],
    ["a fragment suffix", `${FIXTURE_RULESET}#old`],
    ["a percent escape", `${FIXTURE_RULESET}%20`],
    ["a stream suffix", `${FIXTURE_RULESET}:2`],
  ])("fails on a published name with %s, which names no file", async (_label, named) => {
    const { status, output } = await runOn({
      "apps/web/app/reader.ts": `const path = "rules/${named}";\n`,
    });

    expect(status).toBe(1);
    expect(output).toContain(`apps/web/app/reader.ts:1 names ${named}`);
  });

  it.each([
    ["a trailing hyphen", `${FIXTURE_RULESET}-`],
    ["a trailing period", `${FIXTURE_RULESET}.`],
  ])("fails a published name with %s, which names no file", async (_label, named) => {
    const { status, output } = await runOn({
      "apps/web/app/reader.ts": `const path = "rules/${named}";\n`,
    });

    expect(status).toBe(1);
    expect(output).toContain(`apps/web/app/reader.ts:1 names ${named}`);
  });

  it("costs a false positive on prose inside a literal, which is the accepted half of that trade", async () => {
    const { status } = await runOn({
      "apps/web/app/reader.ts": `const note = "Read from ${FIXTURE_RULESET}.";\n`,
    });

    expect(status).toBe(1);
  });

  it("fails on a path hidden after a literal that ends in an escaped backslash", async () => {
    const { status, output } = await runOn({
      "apps/web/app/reader.ts":
        'const a = "ends with a backslash \\\\";\n' +
        `const p = read("rules//${MISSING}"); // trailing comment\n`,
    });

    expect(status).toBe(1);
    expect(output).toContain(`apps/web/app/reader.ts:2 names ${MISSING}`);
  });

  it.each([
    ["a double quote", '"', '\\"'],
    ["a single quote", "'", "\\'"],
    ["a backtick", "`", "\\`"],
  ])("fails on a path after %s escaped inside its own literal", async (_label, quote, escaped) => {
    const { status, output } = await runOn({
      "apps/web/app/reader.ts": `const p = ${quote}prefix ${escaped} rules/${MISSING}${quote};\n`,
    });

    expect(status).toBe(1);
    expect(output).toContain(`apps/web/app/reader.ts:1 names ${MISSING}`);
  });

  it("still finds a path after a literal that ends in an escaped quote", async () => {
    const { status, output } = await runOn({
      "apps/web/app/reader.ts": 'const a = "x \\"";\n' + `const p = "rules/${MISSING}";\n`,
    });

    expect(status).toBe(1);
    expect(output).toContain(`apps/web/app/reader.ts:2 names ${MISSING}`);
  });

  it("still finds a path after a regular expression containing a quote", async () => {
    const { status, output } = await runOn({
      "apps/web/app/reader.ts":
        "const quoted = text.matchAll(/'([^']+)'/g);\n" + `const p = "rules/${MISSING}";\n`,
    });

    expect(status).toBe(1);
    expect(output).toContain(`apps/web/app/reader.ts:2 names ${MISSING}`);
  });
  it("still finds a path after a regex in return position", async () => {
    const { status, output } = await runOn({
      "apps/web/app/reader.ts":
        "function quoted(text) {\n  return /'([^']+)'/.test(text);\n}\n" +
        `const p = "rules/${MISSING}";\n`,
    });

    expect(output).not.toContain("unterminated");
    expect(status).toBe(1);
    expect(output).toContain(`apps/web/app/reader.ts:4 names ${MISSING}`);
  });

  it("finds a path in a template literal that nests other template literals", async () => {
    const { status, output } = await runOn({
      "apps/web/app/reader.ts":
        "const p = `${dir}/${legacy ? `" + MISSING + "` : `" + FIXTURE_RULESET + "`}`;\n",
    });

    expect(status).toBe(1);
    expect(output).toContain(`apps/web/app/reader.ts:1 names ${MISSING}`);
  });

  it("still finds a path after an apostrophe in JSX text", async () => {
    const { status, output } = await runOn({
      "apps/web/app/reader.tsx":
        "export const Note = () => <p>don't file late</p>;\n" + `const p = "rules/${MISSING}";\n`,
    });

    expect(output).not.toContain("unterminated");
    expect(status).toBe(1);
    expect(output).toContain(`apps/web/app/reader.tsx:2 names ${MISSING}`);
  });

  it("fails on a file it cannot parse rather than passing it unscanned", async () => {
    const { status, output } = await runOn({
      "apps/web/app/reader.ts": "const broken = (((;\n",
    });

    expect(status).toBe(1);
    expect(output).toContain("apps/web/app/reader.ts");
    expect(output).toContain("could not be parsed");
  });
});

describe.concurrent("the PR #128 break, which is the coverage floor for what gets scanned", () => {
  it("fails on a module-scope default in a helper that only tests import", async () => {
    const { status, output } = await runOn({
      "apps/web/app/checklist/checklist-fixtures.ts":
        `import { readFileSync } from "node:fs";\n` +
        `const RULES_FILE = process.env.RULES_FILE ?? "rules/${MISSING}";\n` +
        `export const RULESET = JSON.parse(readFileSync(RULES_FILE, "utf8"));\n`,
      "apps/web/app/checklist/checklist-view.test.tsx": `import { RULESET } from "./checklist-fixtures";\nexport const value = RULESET;\n`,
    });

    expect(status).toBe(1);
    expect(output).toContain(`apps/web/app/checklist/checklist-fixtures.ts:2 names ${MISSING}`);
  });

  it("scans such a helper even when nothing outside the test tree imports it at all", async () => {
    const { status, output } = await runOn({
      "apps/web/app/checklist/checklist-fixtures.ts": `export const path = "rules/${MISSING}";\n`,
    });

    expect(status).toBe(1);
    expect(output).toContain(`apps/web/app/checklist/checklist-fixtures.ts:1 names ${MISSING}`);
  });
});

describe.concurrent("where a named ruleset has to exist, which is not just anywhere", () => {
  const FIXTURES = "packages/engine/src/__fixtures__";

  it("does not let a replay fixture satisfy a path under rules/", async () => {
    const { status, output } = await runOn({
      [`${FIXTURES}/${MISSING}`]: JSON.stringify({ ruleset_version: "nyc.v9.9" }),
      "apps/api/src/loader.ts": `const p = "rules/${MISSING}";\n`,
    });

    expect(status).toBe(1);
    expect(output).toContain(`apps/api/src/loader.ts:1 names ${MISSING}`);
  });

  it("accepts a fixture path that points at the fixture directory", async () => {
    const { status, output } = await runOn({
      [`${FIXTURES}/${MISSING}`]: JSON.stringify({ ruleset_version: "nyc.v9.9" }),
      "packages/engine/src/replay.ts": `const p = "${FIXTURES}/${MISSING}";\n`,
    });

    expect(status).toBe(0);
    expect(output).toContain("Ruleset reference check passed");
  });
});

describe.concurrent("the RULES_FILE override, which no code scan can see through", () => {
  it("fails on a stale ruleset pinned in a .env file", async () => {
    const { status, output } = await runOn({
      "apps/api/.env.example": `PORT=3001\nRULES_FILE=../../rules/${MISSING}\n`,
    });

    expect(status).toBe(1);
    expect(output).toContain(`apps/api/.env.example:2 names ${MISSING}`);
  });

  it("fails on a stale ruleset in a COMMENTED OUT .env line", async () => {
    const { status, output } = await runOn({
      "apps/api/.env.example": `PORT=3001\n# RULES_FILE=../../rules/${MISSING}\n`,
    });

    expect(status).toBe(1);
    expect(output).toContain(`apps/api/.env.example:2 names ${MISSING}`);
  });

  it("fails on a stale ruleset in a workflow file", async () => {
    const { status, output } = await runOn({
      ".github/workflows/ci.yml": `jobs:\n  verify:\n    env:\n      RULES_FILE: rules/${MISSING}\n`,
    });

    expect(status).toBe(1);
    expect(output).toContain(`.github/workflows/ci.yml:4 names ${MISSING}`);
  });
});

describe.concurrent("how many rulesets are published", () => {
  it("fails on two published rulesets, naming every file and the one to keep", async () => {
    const { status, output } = await runOn({
      [`rules/${ruleset("0.1")}`]: JSON.stringify({ ruleset_version: "nyc.v0.1" }),
    });

    expect(status).toBe(1);
    expect(output).toContain("rules/ holds 2 published rulesets");
    expect(output).toContain(FIXTURE_RULESET);
    expect(output).toContain(ruleset("0.1"));
    expect(output).toContain(`pins ${FIXTURE_VERSION}, so that is the one to keep`);
  });

  it("fails when nothing is published at all", async () => {
    const root = plant({ [`rules/${FIXTURE_RULESET}`]: null });
    roots.push(root);
    mkdirSync(join(root, "rules"), { recursive: true });

    const { status, output } = await check(root);

    expect(status).toBe(1);
    expect(output).toContain("No published ruleset in rules/");
  });
});

describe.concurrent("the version, which is spelled in three places", () => {
  it("fails when the filename says one version and the file and pin say another", async () => {
    const root = plant({});
    roots.push(root);
    renameSync(join(root, "rules", FIXTURE_RULESET), join(root, "rules", ruleset("0.1")));

    const { status, output } = await check(root);

    expect(status).toBe(1);
    expect(output).toContain(`${ruleset("0.1")} is named for nyc.v0.1`);
    expect(output).toContain(`the file's own ruleset_version is ${FIXTURE_VERSION}`);
    expect(output).toContain(`pins ${FIXTURE_VERSION}`);
  });

  it("reads the live pin, not one quoted in a comment above it", async () => {
    const { status, output } = await runOn({
      "apps/api/src/ruleset.ts":
        `// const EXPECTED_RULESET_VERSION = "${FIXTURE_VERSION}"\n` +
        `const EXPECTED_RULESET_VERSION = "nyc.v9.9";\n`,
    });

    expect(status).toBe(1);
    expect(output).toContain("pins nyc.v9.9");
  });

  it("reads the live pin, not one quoted inside a string literal", async () => {
    const { status, output } = await runOn({
      "apps/api/src/ruleset.ts":
        `const banner = 'EXPECTED_RULESET_VERSION = "nyc.v9.9"';\n` +
        `const EXPECTED_RULESET_VERSION = "${FIXTURE_VERSION}";\n` +
        `export { banner, EXPECTED_RULESET_VERSION };\n`,
    });

    expect(status).toBe(0);
    expect(output).toContain("Ruleset reference check passed");
  });

  it("fails when the artifact moved and the pin did not", async () => {
    const { status, output } = await runOn({
      "apps/api/src/ruleset.ts": `const EXPECTED_RULESET_VERSION = "nyc.v9.9";\n`,
    });

    expect(status).toBe(1);
    expect(output).toContain(`${FIXTURE_RULESET} is named for ${FIXTURE_VERSION}`);
    expect(output).toContain("pins nyc.v9.9");
  });

  it.each([["let"], ["var"]])(
    "refuses a %s pin, which the const argument does not cover",
    async (kind) => {
      const { status, output } = await runOn({
        "apps/api/src/ruleset.ts":
          `${kind} EXPECTED_RULESET_VERSION = "${FIXTURE_VERSION}";\n` +
          `EXPECTED_RULESET_VERSION = "nyc.v9.9";\n` +
          `export { EXPECTED_RULESET_VERSION };\n`,
      });

      expect(status).toBe(1);
      expect(output).toContain("no longer declares EXPECTED_RULESET_VERSION");
    },
  );

  it("fails when the one constant allowed to name a version is gone", async () => {
    const { status, output } = await runOn({
      "apps/api/src/ruleset.ts": `export const somethingElse = 1;\n`,
    });

    expect(status).toBe(1);
    expect(output).toContain("no longer declares EXPECTED_RULESET_VERSION");
  });
});

describe.concurrent("round 7: the rules the parser made reachable", () => {
  it("refuses a published name the runtime's own pattern would not discover", async () => {
    const withoutV = ["nyc", "rules.2.9.json"].join("-");
    const { status, output } = await runOn({
      [`rules/${FIXTURE_RULESET}`]: null,
      [`rules/${withoutV}`]: JSON.stringify({ ruleset_version: FIXTURE_VERSION }),
    });

    expect(status).toBe(1);
    expect(output).toContain("No published ruleset in rules/");
  });

  it("keeps its published-ruleset pattern identical to every runtime discoverer", async () => {
    const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
    const declared = (relative) => {
      const text = readFileSync(join(repo, relative), "utf8");
      return /PUBLISHED_RULESET\s*=\s*(\/[^\n]*?\/)[;\s]/.exec(text)?.[1] ?? null;
    };
    const copies = [
      declared("scripts/check-baseline-drift.mjs"),
      declared("apps/api/src/ruleset.ts"),
      declared("apps/web/app/rules-file.ts"),
      declared("packages/engine/src/__fixtures__/published-ruleset.ts"),
    ];
    expect(copies.every((copy) => copy !== null)).toBe(true);
    expect(new Set(copies).size).toBe(1);
  });

  it("fails a published name written in a directory that holds no rulesets", async () => {
    const { status, output } = await runOn({
      "apps/web/app/reader.ts": `const p = "elsewhere/${FIXTURE_RULESET}";\n`,
    });

    expect(status).toBe(1);
    expect(output).toContain(`apps/web/app/reader.ts:1 names ${FIXTURE_RULESET}`);
  });

  it.each([["../../rules/"], ["./rules/"], ["rules//"]])(
    "resolves a published name written under %s",
    async (prefix) => {
      const { status } = await runOn({
        "apps/web/app/reader.ts": `const p = "${prefix}${FIXTURE_RULESET}";\n`,
      });

      expect(status).toBe(0);
    },
  );

  it("fails on a name an escape hides from the raw text", async () => {
    const { status, output } = await runOn({
      "apps/web/app/reader.ts": `const p = "rules/nyc\\x2drules.v9.9.json";\n`,
    });

    expect(status).toBe(1);
    expect(output).toContain(`apps/web/app/reader.ts:1 names ${MISSING}`);
  });

  it("reads the module-scope pin rather than a nested declaration of the same name", async () => {
    const { status, output } = await runOn({
      "apps/api/src/ruleset.ts":
        `const EXPECTED_RULESET_VERSION = "nyc.v9.9";\n` +
        `function helper() {\n  const EXPECTED_RULESET_VERSION = "${FIXTURE_VERSION}";\n` +
        `  return EXPECTED_RULESET_VERSION;\n}\n`,
    });

    expect(status).toBe(1);
    expect(output).toContain("nyc.v9.9");
  });

  it.each([[".mts"], [".cts"], [".cjs"], [".jsx"]])("scans a %s file", async (extension) => {
    const { status, output } = await runOn({
      [`apps/web/app/reader${extension}`]: `const p = "rules/${MISSING}";\n`,
    });

    expect(status).toBe(1);
    expect(output).toContain(`apps/web/app/reader${extension}:1 names ${MISSING}`);
  });
});

describe.concurrent("round 7: the fixture-name exemption, and what it does not cover", () => {
  it("lets a TEST file declare that its ruleset names are fixtures", async () => {
    const { status } = await runOn({
      "apps/web/app/reader.test.ts":
        `// baseline-check: fixture ruleset names\n` +
        `const names = ["${MISSING}", "${ALSO_MISSING}"];\n`,
    });

    expect(status).toBe(0);
  });

  it("accepts the marker on the same line as the names", async () => {
    const { status } = await runOn({
      "apps/web/app/reader.test.ts": `const names = ["${MISSING}"]; // baseline-check: fixture ruleset names\n`,
    });

    expect(status).toBe(0);
  });

  it("refuses the marker in a file that is not a test", async () => {
    const { status, output } = await runOn({
      "apps/web/app/checklist-fixtures.ts":
        `// baseline-check: fixture ruleset names\n` + `const p = "rules/${MISSING}";\n`,
    });

    expect(status).toBe(1);
    expect(output).toContain(`apps/web/app/checklist-fixtures.ts:2 names ${MISSING}`);
  });

  it("silences a genuinely dangling path in a test file, which is the cost it admits", async () => {
    const { status } = await runOn({
      "apps/web/app/reader.test.ts":
        `// baseline-check: fixture ruleset names\n` + `const p = "rules/${MISSING}";\n`,
    });

    expect(status).toBe(0);
  });

  it("leaves an unmarked line in a test file checked", async () => {
    const { status, output } = await runOn({
      "apps/web/app/reader.test.ts":
        `// baseline-check: fixture ruleset names\n` +
        `const ok = ["${MISSING}"];\n` +
        `const p = "rules/${ALSO_MISSING}";\n`,
    });

    expect(status).toBe(1);
    expect(output).toContain(`apps/web/app/reader.test.ts:3 names ${ALSO_MISSING}`);
  });
});

describe.concurrent("round 9: valid code the check used to reject", () => {
  it("accepts an escaped literal that cooks to the published artifact", async () => {
    const { status, output } = await runOn({
      "apps/web/app/reader.ts": `const p = "rules/${FIXTURE_RULESET.replace(".json", "\\x2ejson")}";\n`,
    });

    expect(status).toBe(0);
    expect(output).toContain("Ruleset reference check passed");
  });

  it("still fails an escaped literal that cooks to a name that is not there", async () => {
    const { status, output } = await runOn({
      "apps/web/app/reader.ts": `const p = "rules/${MISSING.replace("v9.9", "v9\\x2e9")}";\n`,
    });

    expect(status).toBe(1);
    expect(output).toContain(`apps/web/app/reader.ts:1 names ${MISSING}`);
  });

  it("fails a published name with a backslash suffix, which names no file", async () => {
    const { status, output } = await runOn({
      "apps/web/app/reader.ts": `const p = "rules/${FIXTURE_RULESET}\\\\backup";\n`,
    });

    expect(status).toBe(1);
    expect(output).toContain(`apps/web/app/reader.ts:1 names ${FIXTURE_RULESET}\\backup`);
  });

  it("accepts a version interpolated into the filename", async () => {
    const { status, output } = await runOn({
      "apps/web/app/reader.ts":
        "const p = `rules/" + ["nyc", "rules.v"].join("-") + "${version}.json`;\n",
    });

    expect(status).toBe(0);
    expect(output).toContain("Ruleset reference check passed");
  });

  it("still fails a complete dangling name earlier in the same template head", async () => {
    const { status, output } = await runOn({
      "apps/web/app/reader.ts": "const p = `rules/" + MISSING + "/${leaf}`;\n",
    });

    expect(status).toBe(1);
    expect(output).toContain(`apps/web/app/reader.ts:1 names ${MISSING}`);
  });

  it("still fails a dangling name in a template tail", async () => {
    const { status, output } = await runOn({
      "apps/web/app/reader.ts": "const p = `${dir}/" + MISSING + "`;\n",
    });

    expect(status).toBe(1);
    expect(output).toContain(`apps/web/app/reader.ts:1 names ${MISSING}`);
  });

  it("does not report a name immediately before an interpolation, which is the cost it admits", async () => {
    const { status } = await runOn({
      "apps/web/app/reader.ts": "const p = `rules/" + MISSING + "${suffix}`;\n",
    });

    expect(status).toBe(0);
  });

  it.each([
    ["parentheses", `("${FIXTURE_VERSION}")`],
    ["as const", `"${FIXTURE_VERSION}" as const`],
    ["as string", `"${FIXTURE_VERSION}" as string`],
    ["satisfies", `"${FIXTURE_VERSION}" satisfies string`],
    ["a non-null assertion", `"${FIXTURE_VERSION}"!`],
    ["both, nested", `("${FIXTURE_VERSION}" as const)`],
  ])("reads a pin written with %s", async (_label, initializer) => {
    const { status, output } = await runOn({
      "apps/api/src/ruleset.ts": `const EXPECTED_RULESET_VERSION = ${initializer};\n`,
    });

    expect(status).toBe(0);
    expect(output).toContain(`pins ${FIXTURE_VERSION}`);
  });

  it("still fails a wrapped pin that names the wrong version", async () => {
    const { status, output } = await runOn({
      "apps/api/src/ruleset.ts": `const EXPECTED_RULESET_VERSION = ("nyc.v9.9") as const;\n`,
    });

    expect(status).toBe(1);
    expect(output).toContain("pins nyc.v9.9");
  });

  it("still reports no pin when the value is computed rather than wrapped", async () => {
    const { status, output } = await runOn({
      "apps/api/src/ruleset.ts":
        `const versions = ["${FIXTURE_VERSION}"];\n` +
        `const EXPECTED_RULESET_VERSION = versions[0];\n`,
    });

    expect(status).toBe(1);
    expect(output).toContain("no longer declares EXPECTED_RULESET_VERSION");
  });
});

describe.concurrent("round 10: the exemption is only for files vitest runs", () => {
  it.each([
    ["a suffix vitest does not collect", "apps/web/app/reader.test.helper.ts"],
    ["a tree no include pattern covers", "tools/reader.test.ts"],
    ["the tree the config excludes", "scripts/dedupe-cofiring/reader.test.mjs"],
  ])("refuses the marker in %s", async (_label, path) => {
    const { status, output } = await runOn({
      [path]:
        `// baseline-check: fixture ruleset names\n` + `export const p = "rules/${MISSING}";\n`,
    });

    expect(status).toBe(1);
    expect(output).toContain(`${path}:2 names ${MISSING}`);
  });

  it.each([
    ["apps/web/app/reader.test.ts"],
    ["apps/web/app/nested/deep/reader.test.tsx"],
    ["apps/api/src/reader.test.ts"],
    ["packages/engine/src/nested/reader.test.ts"],
    ["scripts/reader.test.mjs"],
    ["scripts/nested/deep/reader.test.mjs"],
  ])("still lets %s claim it", async (path) => {
    const { status } = await runOn({
      [path]:
        `// baseline-check: fixture ruleset names\n` + `export const p = "rules/${MISSING}";\n`,
    });

    expect(status).toBe(0);
  });

  it("keeps its copies of vitest's globs identical to the real config", async () => {
    const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
    const arrayAfter = (text, declaration) => {
      const opens = new RegExp(`${declaration}\\s*\\[`).exec(text);
      if (opens === null) return [];
      const body = text.slice(opens.index + opens[0].length);
      return [...body.slice(0, body.indexOf("]")).matchAll(/["'`]([^"'`]+)["'`]/g)].map(
        (m) => m[1],
      );
    };

    const config = readFileSync(join(repo, "vitest.config.ts"), "utf8");
    const check = readFileSync(join(repo, "scripts/check-baseline-drift.mjs"), "utf8");

    const include = arrayAfter(config, "include:");
    expect(include.length).toBeGreaterThan(0);
    expect(arrayAfter(check, "const VITEST_INCLUDE =")).toEqual(include);

    const exclude = arrayAfter(config, "exclude:");
    expect(exclude.length).toBeGreaterThan(0);
    expect(arrayAfter(check, "const VITEST_EXCLUDE =")).toEqual(exclude);
  });
});

describe.concurrent("round 10: pruning by basename pruned real source", () => {
  it("scans a source directory whose name is not ignored", async () => {
    const { status, output } = await runOn({
      ".gitignore": "node_modules/\ndist/\n",
      "apps/api/src/build/reader.ts": `export const p = "rules/${MISSING}";\n`,
    });

    expect(status).toBe(1);
    expect(output).toContain(`apps/api/src/build/reader.ts:1 names ${MISSING}`);
  });

  it.each([["node_modules"], ["dist"]])("still prunes %s, which is ignored", async (ignored) => {
    const { status } = await runOn({
      ".gitignore": "node_modules/\ndist/\n",
      [`apps/api/src/${ignored}/reader.ts`]: `export const p = "rules/${MISSING}";\n`,
    });

    expect(status).toBe(0);
  });

  it("scans an ignorable-looking directory when nothing declares it ignored", async () => {
    const { status, output } = await runOn({
      "apps/api/src/dist/reader.ts": `export const p = "rules/${MISSING}";\n`,
    });

    expect(status).toBe(1);
    expect(output).toContain(`apps/api/src/dist/reader.ts:1 names ${MISSING}`);
  });
});

describe.concurrent("round 10: package scripts are executable entry points", () => {
  it.each([["package.json"], ["apps/api/package.json"], ["packages/engine/package.json"]])(
    "fails on a stale ruleset in %s",
    async (manifest) => {
      const { status, output } = await runOn({
        [manifest]: JSON.stringify(
          { name: "x", scripts: { seed: `node seed.mjs rules/${MISSING}` } },
          null,
          2,
        ),
      });

      expect(status).toBe(1);
      expect(output).toContain(`${manifest}:4 names ${MISSING}`);
    },
  );

  it("does not read ruleset names out of the rest of a manifest", async () => {
    const { status, output } = await runOn({
      "package.json": JSON.stringify(
        { name: "x", description: `supersedes rules/${MISSING}`, scripts: { build: "tsc" } },
        null,
        2,
      ),
    });

    expect(status).toBe(0);
    expect(output).toContain("check passed");
  });

  it("fails on a manifest it cannot parse rather than passing it unscanned", async () => {
    const { status, output } = await runOn({ "package.json": "{ not json\n" });

    expect(status).toBe(1);
    expect(output).toContain("could not be parsed");
  });
});

describe.concurrent("round 11: a bump does not break the guard", () => {
  const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const NEXT = ruleset("2.9");

  const afterTheBump = (files) => {
    const root = plant({ [`rules/${FIXTURE_RULESET}`]: null, ...files });
    roots.push(root);
    mkdirSync(join(root, "rules"), { recursive: true });
    writeFileSync(join(root, "rules", NEXT), JSON.stringify({ ruleset_version: "nyc.v2.9" }));
    writeFileSync(
      join(root, "apps/api/src/ruleset.ts"),
      `const EXPECTED_RULESET_VERSION = "nyc.v2.9";\n`,
    );
    return check(root);
  };

  it("passes with the real rules-file.test.ts when the published artifact has moved on", async () => {
    const { status, output } = await afterTheBump({
      "apps/web/app/rules-file.test.ts": readFileSync(
        join(repo, "apps/web/app/rules-file.test.ts"),
        "utf8",
      ),
    });

    expect(status).toBe(0);
    expect(output).toContain("Ruleset reference check passed");
  });

  it("passes with every real source file when the published artifact has moved on", async () => {
    const sources = {};
    const collect = (directory) => {
      for (const entry of readdirSync(join(repo, directory), { withFileTypes: true })) {
        const relative = `${directory}/${entry.name}`;
        if (entry.isDirectory()) {
          if (!["node_modules", ".next", "dist", "coverage"].includes(entry.name))
            collect(relative);
        } else if (
          (/\.(ts|tsx)$/.test(entry.name) && !relative.includes("/ruleset.ts")) ||
          relative.includes("/__fixtures__/")
        ) {
          sources[relative] = readFileSync(join(repo, relative), "utf8");
        }
      }
    };
    collect("apps/web/app");
    collect("packages/engine/src");

    const { status, output } = await afterTheBump(sources);

    expect(Object.keys(sources).length).toBeGreaterThan(20);
    expect(status).toBe(0);
    expect(output).toContain("Ruleset reference check passed");
  });

  it("still fails a real path to the artifact the bump deleted", async () => {
    const { status, output } = await afterTheBump({
      "apps/web/app/reader.ts": `export const p = "rules/${FIXTURE_RULESET}";\n`,
    });

    expect(status).toBe(1);
    expect(output).toContain(`apps/web/app/reader.ts:1 names ${FIXTURE_RULESET}`);
  });
});

describe.concurrent("round 11: cooked values are tokenized as values", () => {
  it.each([
    ["an opening brace", "{backup"],
    ["a closing brace", "}backup"],
    ["a single quote", "'backup"],
    ["a double quote", '\\"backup'],
    ["a backtick", "`backup"],
  ])("fails a published name with %s in a string literal", async (_label, suffix) => {
    const { status, output } = await runOn({
      "apps/web/app/reader.ts": `const p = "rules/${FIXTURE_RULESET}${suffix}";\n`,
    });

    expect(status).toBe(1);
    expect(output).toContain(`apps/web/app/reader.ts:1 names ${FIXTURE_RULESET}`);
  });

  it("still reads a quoted name in a workflow file as ending at its quote", async () => {
    const { status, output } = await runOn({
      ".github/workflows/ci.yml": `jobs:\n  verify:\n    env:\n      RULES_FILE: "rules/${MISSING}"\n`,
    });

    expect(status).toBe(1);
    expect(output).toContain(`.github/workflows/ci.yml:4 names ${MISSING}`);
    expect(output).not.toContain(`${MISSING}"`);
  });

  it("still accepts a quoted published name in a workflow file", async () => {
    const { status } = await runOn({
      ".github/workflows/ci.yml": `jobs:\n  verify:\n    env:\n      RULES_FILE: "rules/${FIXTURE_RULESET}"\n`,
    });

    expect(status).toBe(0);
  });
});

describe.concurrent("round 12: every scanner judges the value a runtime would see", () => {
  it.each([
    ["an opening brace", "{backup"],
    ["a closing brace", "}backup"],
    ["a single quote", "'backup"],
    ["a backtick", "`backup"],
  ])("fails a package script naming a published name with %s", async (_label, suffix) => {
    const { status, output } = await runOn({
      "package.json": JSON.stringify(
        { name: "x", scripts: { seed: `node seed.mjs rules/${FIXTURE_RULESET}${suffix}` } },
        null,
        2,
      ),
    });

    expect(status).toBe(1);
    expect(output).toContain(`package.json:4 names ${FIXTURE_RULESET}${suffix}`);
  });

  it("still accepts a package script naming the published artifact", async () => {
    const { status, output } = await runOn({
      "package.json": JSON.stringify(
        { name: "x", scripts: { seed: `node seed.mjs rules/${FIXTURE_RULESET}` } },
        null,
        2,
      ),
    });

    expect(status).toBe(0);
    expect(output).toContain("check passed");
  });

  it("fails on an escaped ruleset hidden in a quoted scalar in a workflow file", async () => {
    const { status, output } = await runOn({
      ".github/workflows/ci.yml": `jobs:\n  verify:\n    env:\n      RULES_FILE: "rules/nyc\\x2drules.v9.9.json"\n`,
    });

    expect(status).toBe(1);
    expect(output).toContain(`.github/workflows/ci.yml:4 names ${MISSING}`);
  });

  it("accepts an escaped quoted scalar that decodes to the published artifact", async () => {
    const { status, output } = await runOn({
      ".github/workflows/ci.yml": `jobs:\n  verify:\n    env:\n      RULES_FILE: "rules/nyc\\x2drules.v0.0.json"\n`,
    });

    expect(status).toBe(0);
    expect(output).toContain("check passed");
  });

  it("does not decode escapes inside a single-quoted scalar", async () => {
    const { status } = await runOn({
      "apps/api/.env.example": `RULES_FILE='rules/nyc\\x2drules.v9.9.json'\n`,
    });

    expect(status).toBe(0);
  });

  it("still reads an unquoted stale ruleset in a workflow file", async () => {
    const { status, output } = await runOn({
      ".github/workflows/ci.yml": `jobs:\n  verify:\n    env:\n      RULES_FILE: rules/${MISSING}\n`,
    });

    expect(status).toBe(1);
    expect(output).toContain(`.github/workflows/ci.yml:4 names ${MISSING}`);
  });
});

describe.concurrent("round 12: a tagged template's value is the tag's to decide", () => {
  it("fails String.raw whose raw value names a file that is not there", async () => {
    const { status, output } = await runOn({
      "apps/web/app/reader.ts":
        "const p = readFileSync(String.raw`rules/" +
        FIXTURE_RULESET.replace(".json", "\\x2ejson") +
        "`);\n",
    });

    expect(status).toBe(1);
    expect(output).toContain("apps/web/app/reader.ts:1 names");
  });

  it("still accepts String.raw whose raw value is the published artifact", async () => {
    const { status, output } = await runOn({
      "apps/web/app/reader.ts":
        "const p = readFileSync(String.raw`rules/" + FIXTURE_RULESET + "`);\n",
    });

    expect(status).toBe(0);
    expect(output).toContain("check passed");
  });

  it("fails an unknown tag when only one of its candidate values resolves", async () => {
    const { status, output } = await runOn({
      "apps/web/app/reader.ts":
        "const p = dedent`rules/" + FIXTURE_RULESET.replace(".json", "\\x2ejson") + "`;\n",
    });

    expect(status).toBe(1);
    expect(output).toContain("apps/web/app/reader.ts:1 names");
  });

  it("still accepts an unknown tag naming the published artifact", async () => {
    const { status, output } = await runOn({
      "apps/web/app/reader.ts": "const p = dedent`rules/" + FIXTURE_RULESET + "`;\n",
    });

    expect(status).toBe(0);
    expect(output).toContain("check passed");
  });

  it("treats a string inside a tagged interpolation as an ordinary literal", async () => {
    const { status, output } = await runOn({
      "apps/web/app/reader.ts": 'const p = dedent`x${"rules/' + MISSING + '"}y`;\n',
    });

    expect(status).toBe(1);
    expect(output).toContain(`apps/web/app/reader.ts:1 names ${MISSING}`);
  });
});

describe.concurrent("round 13: each format decodes by its own rules", () => {
  it("fails a cooked path whose trailing whitespace is part of the filename", async () => {
    const { status, output } = await runOn({
      "apps/web/app/reader.ts": `const p = readFileSync("rules/${FIXTURE_RULESET} ");\n`,
    });

    expect(status).toBe(1);
    expect(output).toContain(`apps/web/app/reader.ts:1 names ${FIXTURE_RULESET} `);
  });

  it("still accepts a cooked path naming the published artifact exactly", async () => {
    const { status, output } = await runOn({
      "apps/web/app/reader.ts": `const p = readFileSync("rules/${FIXTURE_RULESET}");\n`,
    });

    expect(status).toBe(0);
    expect(output).toContain("check passed");
  });

  it.each([
    ["single quotes", `cat 'rules/${FIXTURE_RULESET}'`],
    ["double quotes", `cat "rules/${FIXTURE_RULESET}"`],
    ["a quoted directory", `cat 'rules'/${FIXTURE_RULESET}`],
  ])("accepts a package script that shell-quotes with %s", async (_label, command) => {
    const { status, output } = await runOn({
      "package.json": JSON.stringify({ name: "x", scripts: { seed: command } }, null, 2),
    });

    expect(status).toBe(0);
    expect(output).toContain("check passed");
  });

  it.each([
    ["single quotes", `cat 'rules/${MISSING}'`],
    ["double quotes", `cat "rules/${MISSING}"`],
    ["an escaped space", `cat rules/${FIXTURE_RULESET}\\ copy`],
  ])(
    "still fails a shell-quoted script naming a file that is not there, with %s",
    async (_label, command) => {
      const { status, output } = await runOn({
        "package.json": JSON.stringify({ name: "x", scripts: { seed: command } }, null, 2),
      });

      expect(status).toBe(1);
      expect(output).toContain("package.json:4 names");
    },
  );

  it("judges a script with an unterminated quote as written rather than guessing", async () => {
    const { status, output } = await runOn({
      "package.json": JSON.stringify(
        { name: "x", scripts: { seed: `node seed.mjs rules/${FIXTURE_RULESET}'backup` } },
        null,
        2,
      ),
    });

    expect(status).toBe(1);
    expect(output).toContain(`package.json:4 names ${FIXTURE_RULESET}'backup`);
  });

  it("fails a .env override whose escape is preserved and names no file", async () => {
    const { status, output } = await runOn({
      "apps/api/.env.example": `RULES_FILE="rules/${FIXTURE_RULESET.replace("v0.0", "v0\\x2e0")}"\n`,
    });

    expect(status).toBe(1);
    expect(output).toContain("apps/api/.env.example:1 names");
  });

  it("fails a .env value whose decoded newline is part of the path", async () => {
    const { status, output } = await runOn({
      "apps/api/.env.example": `RULES_FILE="rules/${FIXTURE_RULESET}\\nTRAILING=x"\n`,
    });

    expect(status).toBe(1);
    expect(output).toContain(`apps/api/.env.example:1 names ${FIXTURE_RULESET}`);
  });

  it("decodes the one escape --env-file defines, and only inside double quotes", async () => {
    const doubled = await runOn({
      "apps/api/.env.example": `RULES_FILE="rules/${FIXTURE_RULESET}\\nx"\n`,
    });
    const singled = await runOn({
      "apps/api/.env.example": `RULES_FILE='rules/${FIXTURE_RULESET}\\nx'\n`,
    });

    expect(doubled.status).toBe(1);
    expect(singled.status).toBe(1);
    expect(doubled.output).not.toContain(`${FIXTURE_RULESET}\\nx`);
    expect(singled.output).toContain(`${FIXTURE_RULESET}\\nx`);
  });

  it("decodes nothing inside a single-quoted .env value", async () => {
    const { status } = await runOn({
      "apps/api/.env.example": `RULES_FILE='rules/${FIXTURE_RULESET}\\nTRAILING=x'\n`,
    });

    expect(status).toBe(1);
  });

  it("still fails a plain stale .env override", async () => {
    const { status, output } = await runOn({
      "apps/api/.env.example": `PORT=3001\nRULES_FILE=../../rules/${MISSING}\n`,
    });

    expect(status).toBe(1);
    expect(output).toContain(`apps/api/.env.example:2 names ${MISSING}`);
  });
});

describe.concurrent("round 14: shell operators, one boundary, and escaped YAML quotes", () => {
  it.each([
    ["a semicolon", `cat rules/${FIXTURE_RULESET}; echo ok`],
    ["no space before it", `cat rules/${FIXTURE_RULESET};echo ok`],
    ["an and-list", `cat rules/${FIXTURE_RULESET}&&echo ok`],
    ["a pipe", `cat rules/${FIXTURE_RULESET}|wc -l`],
    ["a redirect", `cat <rules/${FIXTURE_RULESET}>out.txt`],
    ["a subshell", `(cat rules/${FIXTURE_RULESET})`],
    ["a background job", `cat rules/${FIXTURE_RULESET}&`],
  ])("accepts a package script using %s", async (_label, command) => {
    const { status, output } = await runOn({
      "package.json": JSON.stringify({ name: "x", scripts: { seed: command } }, null, 2),
    });

    expect(status).toBe(0);
    expect(output).toContain("check passed");
  });

  it.each([
    ["before an operator", `cat rules/${MISSING}; echo ok`],
    ["after an operator", `echo ok && cat rules/${MISSING}`],
  ])("still fails a dangling name %s", async (_label, command) => {
    const { status, output } = await runOn({
      "package.json": JSON.stringify({ name: "x", scripts: { seed: command } }, null, 2),
    });

    expect(status).toBe(1);
    expect(output).toContain(`package.json:4 names ${MISSING}`);
  });

  it("keeps a quoted operator inside the filename, where it names no file", async () => {
    const { status, output } = await runOn({
      "package.json": JSON.stringify(
        { name: "x", scripts: { seed: `cat 'rules/${FIXTURE_RULESET};backup'` } },
        null,
        2,
      ),
    });

    expect(status).toBe(1);
    expect(output).toContain(`package.json:4 names ${FIXTURE_RULESET};backup`);
  });

  it.each([
    [
      "a JS literal",
      "apps/web/app/reader.ts",
      (name) => `const p = readFileSync("rules/${name}\\nbackup");\n`,
    ],
    ["a .env override", "apps/api/.env.example", (name) => `RULES_FILE="rules/${name}\\nbackup"\n`],
  ])("fails a decoded newline inside %s", async (_label, file, shape) => {
    const { status, output } = await runOn({ [file]: shape(FIXTURE_RULESET) });

    expect(status).toBe(1);
    expect(output).toContain(`names ${FIXTURE_RULESET}`);
  });

  it.each([
    [
      "a JS literal",
      "apps/web/app/reader.ts",
      (name) => `const p = readFileSync("rules/${name}");\n`,
    ],
    ["a .env override", "apps/api/.env.example", (name) => `RULES_FILE="rules/${name}"\n`],
  ])("still accepts the published artifact named cleanly in %s", async (_label, file, shape) => {
    const { status, output } = await runOn({ [file]: shape(FIXTURE_RULESET) });

    expect(status).toBe(0);
    expect(output).toContain("check passed");
  });

  it("fails an escaped quote hiding a ruleset path in a YAML scalar", async () => {
    const { status, output } = await runOn({
      ".github/workflows/ci.yml": `jobs:\n  verify:\n    env:\n      RULES_FILE: "archive\\"/nyc\\x2drules.v9.9.json"\n`,
    });

    expect(status).toBe(1);
    expect(output).toContain(`.github/workflows/ci.yml:4 names ${MISSING}`);
  });

  it("still accepts an escaped quote in a YAML scalar naming the published artifact", async () => {
    const { status, output } = await runOn({
      ".github/workflows/ci.yml": `jobs:\n  verify:\n    env:\n      RULES_FILE: "archive\\"/rules/${FIXTURE_RULESET}"\n`,
    });

    expect(status).toBe(0);
    expect(output).toContain("check passed");
  });

  it("reads a doubled quote inside a single-quoted YAML scalar", async () => {
    const { status, output } = await runOn({
      ".github/workflows/ci.yml": `jobs:\n  verify:\n    env:\n      RULES_FILE: 'archive''/rules/${MISSING}'\n`,
    });

    expect(status).toBe(1);
    expect(output).toContain(`.github/workflows/ci.yml:4 names ${MISSING}`);
  });

  it("ends a .env value at an escaped quote, because --env-file does", async () => {
    const { status, output } = await runOn({
      "apps/api/.env.example": `RULES_FILE="archive\\"/rules/${MISSING}"\n`,
    });

    expect(status).toBe(1);
    expect(output).toContain(`apps/api/.env.example:1 names ${MISSING}`);
  });
});

describe.concurrent("round 15: ignored files, substitution, and values that span lines", () => {
  const IGNORE = "node_modules/\n.env*\n!.env.example\n";

  it.each([
    ["an absolute path outside the repo", `/tmp/${FIXTURE_RULESET}`],
    ["a path this repo knows nothing about", `../elsewhere/${MISSING}`],
  ])("ignores a gitignored .env naming %s", async (_label, path) => {
    const { status, output } = await runOn({
      ".gitignore": IGNORE,
      "apps/api/.env": `RULES_FILE=${path}\n`,
    });

    expect(status).toBe(0);
    expect(output).toContain("check passed");
  });

  it("still scans the committed .env.example that .gitignore negates", async () => {
    const { status, output } = await runOn({
      ".gitignore": IGNORE,
      "apps/api/.env.example": `RULES_FILE=rules/${MISSING}\n`,
    });

    expect(status).toBe(1);
    expect(output).toContain(`apps/api/.env.example:1 names ${MISSING}`);
  });

  it("scans a .env when no .gitignore declares it ignored", async () => {
    const { status, output } = await runOn({ "apps/api/.env": `RULES_FILE=rules/${MISSING}\n` });

    expect(status).toBe(1);
    expect(output).toContain(`apps/api/.env:1 names ${MISSING}`);
  });

  it.each([
    ["backquotes", "cat `printf rules/NAME`"],
    ["the modern spelling", "cat $(printf rules/NAME)"],
    ["a substitution mid-command", "cp `which node` rules/NAME"],
  ])("accepts a package script using %s", async (_label, shape) => {
    const { status, output } = await runOn({
      "package.json": JSON.stringify(
        { name: "x", scripts: { seed: shape.replace("NAME", FIXTURE_RULESET) } },
        null,
        2,
      ),
    });

    expect(status).toBe(0);
    expect(output).toContain("check passed");
  });

  it("still fails a dangling name inside a backquoted substitution", async () => {
    const { status, output } = await runOn({
      "package.json": JSON.stringify(
        { name: "x", scripts: { seed: `cat \`printf rules/${MISSING}\`` } },
        null,
        2,
      ),
    });

    expect(status).toBe(1);
    expect(output).toContain(`package.json:4 names ${MISSING}`);
  });

  it("judges a script with an unterminated backquote as written", async () => {
    const { status, output } = await runOn({
      "package.json": JSON.stringify(
        { name: "x", scripts: { seed: `node seed.mjs rules/${FIXTURE_RULESET}\`backup` } },
        null,
        2,
      ),
    });

    expect(status).toBe(1);
    expect(output).toContain(`package.json:4 names ${FIXTURE_RULESET}\`backup`);
  });

  it.each([
    ['"', '"'],
    ["'", "'"],
    ["`", "`"],
  ])("fails a .env value spanning lines in %s quotes", async (open, close) => {
    const { status, output } = await runOn({
      "apps/api/.env.example": `RULES_FILE=${open}rules/${FIXTURE_RULESET}\nbackup${close}\n`,
    });

    expect(status).toBe(1);
    expect(output).toContain(`names ${FIXTURE_RULESET}`);
  });

  it("still accepts a single-line .env value naming the published artifact", async () => {
    const { status, output } = await runOn({
      "apps/api/.env.example": `RULES_FILE="rules/${FIXTURE_RULESET}"\nOTHER=x\n`,
    });

    expect(status).toBe(0);
    expect(output).toContain("check passed");
  });

  it("does not let an unterminated .env quote swallow the rest of the file", async () => {
    const { status, output } = await runOn({
      "apps/api/.env.example": `RULES_FILE="unterminated\nOTHER=rules/${MISSING}\n`,
    });

    expect(status).toBe(1);
    expect(output).toContain(`apps/api/.env.example:2 names ${MISSING}`);
  });

  it.each([
    ["folded and stripped", ">-", " "],
    ["folded", ">", " "],
    ["literal", "|", "\n"],
    ["literal and kept", "|+", "\n"],
  ])("fails a %s block scalar whose value continues past the name", async (_label, indicator) => {
    const { status, output } = await runOn({
      ".github/workflows/ci.yml": `jobs:\n  verify:\n    env:\n      RULES_FILE: ${indicator}\n        rules/${FIXTURE_RULESET}\n        backup\n`,
    });

    expect(status).toBe(1);
    expect(output).toContain(`names ${FIXTURE_RULESET}`);
  });

  it("still accepts a block scalar naming the published artifact alone", async () => {
    const { status, output } = await runOn({
      ".github/workflows/ci.yml": `jobs:\n  verify:\n    env:\n      RULES_FILE: >-\n        rules/${FIXTURE_RULESET}\n    other: x\n`,
    });

    expect(status).toBe(0);
    expect(output).toContain("check passed");
  });

  it("stops a block scalar at the indentation, so later keys are still read", async () => {
    const { status, output } = await runOn({
      ".github/workflows/ci.yml": `jobs:\n  verify:\n    env:\n      NOTE: |\n        some text\n      RULES_FILE: rules/${MISSING}\n`,
    });

    expect(status).toBe(1);
    expect(output).toContain(`.github/workflows/ci.yml:6 names ${MISSING}`);
  });
});

describe.concurrent("round 16: a glob row expands to artifacts, never to directories", () => {
  const approvedRow = (artifact) =>
    `# Fixture manifest\n\n| Concern | Artifact | Status | Notes |\n| --- | --- | --- | --- |\n` +
    `| Drafts | \`${artifact}\` | APPROVED 2026-08-08 by the product owner | none |\n`;

  it("skips a directory inside an APPROVED glob and still checks the files beside it", async () => {
    const { status, output } = await runOn({
      "docs/BASELINE.md": approvedRow("docs/proposals/*"),
      "docs/proposals/one.md": "# One\n\n**Status:** APPROVED 2026-08-08\n",
      "docs/proposals/advisory-refetch-2026-07-28/notes.md": "# Notes\n\n**Status:** PROPOSED\n",
    });

    expect(status).toBe(0);
    expect(output).toContain("✓ docs/proposals/one.md");
    expect(output).not.toContain("advisory-refetch-2026-07-28");
  });

  it("reports the path and the row that named it rather than throwing EISDIR", async () => {
    const { status, output } = await runOn({
      "docs/BASELINE.md": approvedRow("docs/proposals/legacy.md"),
      "docs/proposals/legacy.md/inner.md": "# Inner\n\n**Status:** PROPOSED\n",
    });

    expect(status).toBe(1);
    expect(output).toContain("docs/proposals/legacy.md");
    expect(output).toContain('named by manifest row "Drafts"');
    expect(output).not.toContain("at readFileSync");
  });
});

describe.concurrent("round 17: a manifest row's path is whatever is on disk (#252)", () => {
  const approvedRow = (artifact, extra = "") =>
    `# Fixture manifest\n\n| Concern | Artifact | Status | Notes |\n| --- | --- | --- | --- |\n` +
    `| Drafts | \`${artifact}\` | APPROVED 2026-08-08 by the product owner | ${extra} |\n`;

  it.each([
    ["a space", "draft note.md"],
    ["a non-ASCII letter", "réunion.md"],
    ["a newline", "draft\nnote.md"],
    ["an uppercase extension", "DRAFT.MD"],
  ])("fails a PROPOSED file a glob reaches whose name has %s", async (_label, name) => {
    const { status, output } = await runOn({
      "docs/BASELINE.md": approvedRow("docs/proposals/*"),
      "docs/proposals/ordinary.md": "# Ordinary\n\n**Status:** APPROVED 2026-08-08\n",
      [`docs/proposals/${name}`]: "# Draft\n\n**Status:** PROPOSED\n",
    });

    expect(status).toBe(1);
    expect(output).toContain('header says "PROPOSED"');
  });

  it("reports a checksum row whose path is a directory rather than throwing EISDIR", async () => {
    const { status, output } = await runOn({
      "docs/BASELINE.md": approvedRow(
        "docs/proposals/legacy.md",
        "sha256 `" + "0".repeat(64) + "`",
      ),
      "docs/proposals/legacy.md/inner.md": "# Inner\n\n**Status:** PROPOSED\n",
    });

    expect(status).toBe(1);
    expect(output).toContain("docs/proposals/legacy.md");
    expect(output).toContain('named by manifest row "Drafts"');
    expect(output).not.toContain("at readFileSync");
  });

  it("reports a glob rooted at a file rather than throwing ENOTDIR", async () => {
    const { status, output } = await runOn({
      "docs/BASELINE.md": approvedRow("docs/proposals/one.md/*"),
      "docs/proposals/one.md": "# One\n\n**Status:** APPROVED 2026-08-08\n",
    });

    expect(status).toBe(1);
    expect(output).toContain("docs/proposals/one.md/*");
    expect(output).toContain('named by manifest row "Drafts"');
    expect(output).not.toContain("at readdirSync");
  });

  it("does not count a directory under rules/ as a published ruleset", async () => {
    const { status, output } = await runOn({
      [`rules/${MISSING}/placeholder.json`]: "{}\n",
    });

    expect(status).toBe(0);
    expect(output).toContain("check passed");
    expect(output).not.toContain("holds 2 published rulesets");
  });
});

describe.concurrent("Square/POS scope agreement (SPEC-CONFLICT #127 item 2)", () => {
  const reconciled = (overrides = {}) => overrides;

  it("passes the reconciled tree, so a failure below means something", async () => {
    const { status, output } = await runOn(reconciled());

    expect(status).toBe(0);
    expect(output).toContain("Square/POS scope check passed");
  });

  it("fails when the standalone Square/POS entry returns to the Roadmap", async () => {
    const { status, output } = await runOn(
      reconciled({
        "docs/ROADMAP.md": SQUARE_RECONCILED["docs/ROADMAP.md"] + "- Square/POS integrations.\n",
      }),
    );

    expect(status).toBe(1);
    expect(output).toContain("docs/ROADMAP.md:4 asserts the broader standalone Square/POS");
  });

  it("fails on a standalone POS entry that does not name the vendor", async () => {
    const { status, output } = await runOn(
      reconciled({
        "docs/PRD.md": SQUARE_RECONCILED["docs/PRD.md"] + "- POS integrations, provider TBD.\n",
      }),
    );

    expect(status).toBe(1);
    expect(output).toContain("docs/PRD.md:4 asserts the broader standalone Square/POS");
  });

  it("fails when F-408's own Roadmap entry is renamed to absorb the capability", async () => {
    const { status, output } = await runOn(
      reconciled({
        "docs/ROADMAP.md":
          "# Roadmap\n\n- **F-408 · Inventory Alerts and Square/POS Integrations** — manual " +
          "counts or Square webhook.\n",
      }),
    );

    expect(status).toBe(1);
    expect(output).toContain("docs/ROADMAP.md:3 asserts the broader standalone Square/POS");
  });

  it("fails when the PRD widens F-408 to absorb the capability", async () => {
    const { status, output } = await runOn(
      reconciled({
        "docs/PRD.md":
          "# PRD\n\n- **F-308 / F-408** — ticketing; inventory low-stock alerts and Square/POS " +
          "integrations.\n",
      }),
    );

    expect(status).toBe(1);
    expect(output).toContain("docs/PRD.md:3 asserts the broader standalone Square/POS");
  });

  it("fails when ARCHITECTURE-FUTURE gives the broader capability its own ownership row", async () => {
    const { status, output } = await runOn(
      reconciled({
        "docs/ARCHITECTURE-FUTURE.md":
          "# Architecture\n\n| External integrations | F-108, F-212, F-308, F-408 | webhook |\n" +
          "| Square/POS integrations | F-408 | provider mappings |\n",
      }),
    );

    expect(status).toBe(1);
    expect(output).toContain("docs/ARCHITECTURE-FUTURE.md:4 asserts the broader standalone");
  });

  it("fails when the capability is assigned to an id other than F-408", async () => {
    const { status, output } = await runOn(
      reconciled({
        "docs/ROADMAP.md":
          "# Roadmap\n\n- **F-414 · Inventory Low-Stock Alerts** — manual counts or Square " +
          "webhook.\n",
      }),
    );

    expect(status).toBe(1);
    expect(output).toContain("assigns the Square capability to an id other than F-408");
  });

  it("fails when the Roadmap drops the F-408 assignment entirely", async () => {
    const { status, output } = await runOn(
      reconciled({ "docs/ROADMAP.md": "# Roadmap\n\nNothing assigned here.\n" }),
    );

    expect(status).toBe(1);
    expect(output).toContain("docs/ROADMAP.md no longer assigns the Square capability to F-408");
  });

  it("fails when the PRD drops the F-408 assignment entirely", async () => {
    const { status, output } = await runOn(
      reconciled({ "docs/PRD.md": "# PRD\n\nNothing assigned here.\n" }),
    );

    expect(status).toBe(1);
    expect(output).toContain("docs/PRD.md no longer assigns the Square capability to F-408");
  });

  it("fails when ARCHITECTURE-FUTURE stops owning F-408 on its external integrations row", async () => {
    const { status, output } = await runOn(
      reconciled({
        "docs/ARCHITECTURE-FUTURE.md":
          "# Architecture\n\n| External integrations | F-108, F-212, F-308 | webhook events |\n",
      }),
    );

    expect(status).toBe(1);
    expect(output).toContain("no longer lists F-408 on its External integrations");
  });

  for (const relative of ["docs/ROADMAP.md", "docs/PRD.md", "docs/ARCHITECTURE-FUTURE.md"]) {
    it(`fails when ${relative} is deleted rather than passing by having nothing to check`, async () => {
      const { status, output } = await runOn(reconciled({ [relative]: null }));

      expect(status).toBe(1);
      expect(output).toContain(`${relative} is missing`);
    });
  }

  it("accepts POS named as a provider class rather than as a capability entry", async () => {
    const { status, output } = await runOn(
      reconciled({
        "docs/ARCHITECTURE-FUTURE.md":
          SQUARE_RECONCILED["docs/ARCHITECTURE-FUTURE.md"] +
          "\n| AD-13 | Put every external service behind an adapter. | POS providers cannot leak. |\n" +
          "\n- calendar/ticketing/POS synchronization and webhook processing;\n" +
          "\n```\n/packages/integrations   Calendar, ticketing, POS, geocoding adapters\n```\n",
      }),
    );

    expect(status).toBe(0);
    expect(output).toContain("Square/POS scope check passed");
  });

  it("accepts a provider bullet that mentions Square and assigns no capability", async () => {
    const { status, output } = await runOn(
      reconciled({
        "docs/ARCHITECTURE-FUTURE.md":
          SQUARE_RECONCILED["docs/ARCHITECTURE-FUTURE.md"] +
          "\n- Square adapter credentials must be encrypted at rest.\n",
      }),
    );

    expect(status).toBe(0);
    expect(output).toContain("Square/POS scope check passed");
  });

  it("accepts an entry whose 'integration' belongs to a different id on the same line", async () => {
    const { status, output } = await runOn(reconciled());

    expect(status).toBe(0);
    expect(output).toContain("Square/POS scope check passed");
  });

  it("accepts the prose record of the drop, which repeats the dropped entry's words", async () => {
    const { status, output } = await runOn(
      reconciled({
        "docs/ROADMAP.md":
          SQUARE_RECONCILED["docs/ROADMAP.md"] +
          "\n**Dropped 2026-07-28:** a standalone `Square/POS integrations` entry sat here with no\n" +
          "F-id, contradicting the PRD.\n",
      }),
    );

    expect(status).toBe(0);
    expect(output).toContain("Square/POS scope check passed");
  });
});
