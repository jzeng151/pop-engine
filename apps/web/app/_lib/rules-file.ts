// Where the published ruleset is, found rather than named — and a check that what was found is actually a ruleset.

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/** Published rulesets are `nyc-rules.v<version>.json`; `rules/proposals/` is drafts and excluded. */
const PUBLISHED_RULESET = /^nyc-rules\.v.+\.json$/;

/** The artifact family this app can read. The minor version is the parser's business, not ours. */
const SCHEMA_FAMILY = "popengine-rules/";

/** Asserts that `path` is a published ruleset, and nothing more than that. */
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

/** The one published ruleset in `rulesDirectory`, verified to be one. */
export function publishedRulesFileIn(rulesDirectory: string): string {
  const published = readdirSync(rulesDirectory).filter((entry) => PUBLISHED_RULESET.test(entry));
  if (published.length !== 1) {
    throw new Error(
      `expected exactly one published ruleset in ${rulesDirectory}, found ${published.length}` +
        (published.length === 0 ? "" : `: ${published.join(", ")}`),
    );
  }
  const path = join(rulesDirectory, published[0] as string);
  assertPublishedRuleset(path);
  return path;
}

/** The ruleset this app should read: the `RULES_FILE` override when there is one, the published artifact in `rulesDirectory` otherwise. */
export function rulesFileIn(rulesDirectory: string): string {
  const override = process.env.RULES_FILE;
  // Returned as given, matching `rulesFilePath` in `apps/api/src/ruleset.ts`: what the override
  // names is the caller's explicit choice, and the parsers validate whatever it points at.
  return override !== undefined && override !== ""
    ? override
    : publishedRulesFileIn(rulesDirectory);
}
