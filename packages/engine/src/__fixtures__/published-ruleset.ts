// The published ruleset's path, found rather than named, for the suites that evaluate against the
// real artifact.
//
// WHY THIS EXISTS. Four engine suites used to hard-code a published ruleset filename, and each read
// it at MODULE SCOPE. A version bump deletes the file the old name points at, so the read throws
// during import and the whole file fails to collect: vitest reports "no tests" for it rather than a
// red assertion. That is how #128 took main down without anyone noticing — a suite that stops
// existing looks a lot like a suite that passes. Naming the next version instead only moves the
// landmine, because a bump structurally cannot find references that did not exist when it ran.
//
// Resolved relative to THIS file rather than to each caller, so a suite's own depth in the tree is
// not a thing that can be wrong: `intake/intake.test.ts` and `engine.test.ts` sit at different
// depths and previously spelled their own `../../../` prefixes.
//
// This is test support and deliberately NOT exported from the package. `packages/engine` reads no
// files at runtime — `parseEngineRuleset` takes a document, which is what makes AD-7 replay work
// from a lineage commit — and that stays true.

import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** Published rulesets are `nyc-rules.v<version>.json`; `rules/proposals/` is drafts and excluded. */
const PUBLISHED_RULESET = /^nyc-rules\.v.+\.json$/;

/** The artifact family these suites can read. The minor version is the parser's business. */
const SCHEMA_FAMILY = "popengine-rules/";

const RULES_DIRECTORY = fileURLToPath(new URL("../../../../rules/", import.meta.url));

/**
 * Asserts that `path` is a published ruleset, and nothing more than that.
 *
 * Discovery succeeds on any file whose NAME fits, so a truncated download, a merge artefact or a
 * half-written publish would be found and handed to `parseEngineRuleset` as though it were the
 * artifact. The name is not evidence, so the file is asked to identify itself: it must parse as
 * JSON (the truncation case), declare a `popengine-rules/*` schema (the file saying what it is),
 * and carry a non-empty `ruleset_version` (a published artifact rather than a fragment).
 *
 * It stops there on purpose. `parseEngineRuleset` validates `rules`, `advisories`, `intake_fields`
 * and `config` already, in one place and with precise errors, and every caller of this module runs
 * it. Re-checking them here would be a second copy of the ruleset contract, free to drift from the
 * first. This answers "is this the artifact?"; the parser answers "is the artifact valid?".
 */
function assertPublishedRuleset(path: string): void {
  let document: unknown;
  try {
    document = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new Error(
      `${path} matches the published-ruleset name pattern but is not readable JSON: ` +
        `${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const record =
    typeof document === "object" && document !== null
      ? (document as Record<string, unknown>)
      : null;
  const schema = record?.schema;
  if (typeof schema !== "string" || !schema.startsWith(SCHEMA_FAMILY)) {
    throw new Error(
      `${path} matches the published-ruleset name pattern but does not declare a ` +
        `${SCHEMA_FAMILY}* schema (found ${JSON.stringify(schema)}); it is not a published ruleset`,
    );
  }
  const version = record?.ruleset_version;
  if (typeof version !== "string" || version === "") {
    throw new Error(
      `${path} declares a ${SCHEMA_FAMILY}* schema but carries no ruleset_version ` +
        `(found ${JSON.stringify(version)}); it is not a published ruleset`,
    );
  }
}

/**
 * The one published ruleset in `rules/`.
 *
 * Exactly one is expected. Zero and two both throw with what was actually found, because a fixture
 * that silently picks one of two rulesets is worse than one that stops: the suite would go green
 * against an artifact nobody chose. Failing loudly here is the whole point of the change — a bump
 * that breaks this gets an error naming the directory contents, not an empty test file.
 */
function publishedRulesFile(): string {
  const published = readdirSync(RULES_DIRECTORY).filter((entry) => PUBLISHED_RULESET.test(entry));
  if (published.length !== 1) {
    throw new Error(
      `expected exactly one published ruleset in ${RULES_DIRECTORY}, found ${published.length}` +
        (published.length === 0 ? "" : `: ${published.join(", ")}`),
    );
  }
  const path = `${RULES_DIRECTORY}${published[0] as string}`;
  assertPublishedRuleset(path);
  return path;
}

export const PUBLISHED_RULES_FILE = publishedRulesFile();
