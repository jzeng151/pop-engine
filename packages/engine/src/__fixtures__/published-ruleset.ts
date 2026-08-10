// The published ruleset's path, found rather than named, for the suites that evaluate against the real artifact.

import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** Published rulesets are `nyc-rules.v<version>.json`; `rules/proposals/` is drafts and excluded. */
const PUBLISHED_RULESET = /^nyc-rules\.v.+\.json$/;

/** The artifact family these suites can read. The minor version is the parser's business. */
const SCHEMA_FAMILY = "popengine-rules/";

const RULES_DIRECTORY = fileURLToPath(new URL("../../../../rules/", import.meta.url));

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

/** The one published ruleset in `rules/`. */
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
