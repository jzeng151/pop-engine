// Where the published ruleset is, found rather than named — and a check that what was found is
// actually a ruleset.
//
// WHY THIS EXISTS. A published ruleset filename was once spelled out in four places in this app — the
// intake page's production read, two suites that read it at module scope, and one that pointed
// `RULES_FILE` at it. A version bump deletes the file every one of those names, and the two
// module-scope reads fail during IMPORT, so vitest reports "no tests" for those files rather than a
// red assertion. That is how #128 took main down unnoticed: a suite that stops existing looks like
// a suite that passes. Writing the next version in instead only moves the landmine, because a bump
// structurally cannot find references that did not exist when it ran.
//
// WHY IT VALIDATES, which is the second half of that trade. Naming a path failed loudly on a
// missing file. DISCOVERY succeeds on any file whose NAME fits, so a truncated download, a merge
// artefact or a half-written publish is found and handed back as though it were the artifact. The
// name is not evidence, so the file is opened and asked to identify itself before it is returned.
//
// The directory takes an argument rather than being fixed, because the two callers legitimately
// resolve from different bases: the Next app runs with its own directory as the working directory,
// and vitest runs from the repo root.

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/** Published rulesets are `nyc-rules.v<version>.json`; `rules/proposals/` is drafts and excluded. */
const PUBLISHED_RULESET = /^nyc-rules\.v.+\.json$/;

/** The artifact family this app can read. The minor version is the parser's business, not ours. */
const SCHEMA_FAMILY = "popengine-rules/";

/**
 * Asserts that `path` is a published ruleset, and nothing more than that.
 *
 * THREE CHECKS, AND THE REASON THE SET STOPS THERE.
 *
 *   1. It parses as JSON. This is the truncated download and the half-written publish — the file
 *      exists, the name matches, and the bytes are not a document.
 *   2. `schema` names this artifact family. This is the file identifying ITSELF. A merge artefact,
 *      a proposal draft copied into `rules/`, or any unrelated JSON that happens to match the name
 *      pattern fails here. Matched on the family rather than on `popengine-rules/v2` exactly, so a
 *      future schema version resolves and the PARSER decides whether it can read it — pinning the
 *      exact token here would put a second copy of that decision in a file that has no business
 *      making it.
 *   3. `ruleset_version` is a non-empty string. This is what separates a published artifact from a
 *      fragment that merely looks like one, and it is the field every downstream consumer pins:
 *      plans persist it for AD-7 replay, and the api refuses to boot when it is not the ratified
 *      one.
 *
 * WHAT IT DELIBERATELY DOES NOT CHECK: `rules`, `advisories`, `intake_fields`, `config` and every
 * field inside them. `parseEngineRuleset` and `parseIntakeContract` already validate those, in one
 * place, with precise errors, and every caller of this module runs one of them. Re-checking them
 * here would put a second copy of the ruleset contract in the repo, free to drift from the first —
 * which is the exact defect `apps/api/src/schema-contract.test.ts` exists to catch. So the split is
 * deliberate: this answers "is this the artifact?", the parsers answer "is the artifact valid?".
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
 * The one published ruleset in `rulesDirectory`, verified to be one.
 *
 * Exactly one is expected. Zero and two both throw naming what was actually found, because
 * silently picking one of two rulesets is worse than stopping: every permit fact on screen would
 * come from an artifact nobody chose, and the page would look entirely normal doing it.
 */
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

/**
 * The ruleset this app should read: the `RULES_FILE` override when there is one, the published
 * artifact in `rulesDirectory` otherwise.
 *
 * ONE PLACE FOR ONE DECISION. Both callers used to spell `process.env.RULES_FILE ?? ...` for
 * themselves, and `??` falls through on null and undefined only. An empty `RULES_FILE` therefore
 * counted as a real answer here, resolved to the working directory, and failed on a directory —
 * while `apps/api` treated the same value as unset and quietly did the right thing. Same variable,
 * two services, opposite behaviour, and `intake-page-props.ts` carried a comment asserting the
 * parity that did not hold.
 *
 * WHY EMPTY MEANS UNSET, rather than web's `??` being right and the api being the odd one out.
 * Nothing intends `RULES_FILE=`. It is what a declared-but-unvalued variable becomes: node's
 * `--env-file-if-exists` reads `RULES_FILE=` as the empty string, and several hosts materialise a
 * declared variable with no value the same way. There is also no outcome it could usefully select
 * that differs from unset, because the fallback IS the default artifact, so both intents land in
 * the same place. And an empty path is not a path to anything: it resolves to the working
 * directory, so the failure it produces is EISDIR on a directory, naming neither the variable nor
 * the ruleset.
 *
 * The alternative worth naming, since "never proceed on input that can only be a mistake" would
 * argue for it: treat empty as a configuration ERROR and refuse to start. Rejected as the smaller
 * risk of the two. Falling back loads this repo's own published, ratified artifact rather than
 * anything invented, the api validates it against `EXPECTED_RULESET_VERSION` regardless, and an
 * operator who meant to pin a different version sees it — F-206 renders the ruleset version on
 * every plan. Refusing would instead break the default path outright on any host that always
 * materialises declared variables.
 */
export function rulesFileIn(rulesDirectory: string): string {
  const override = process.env.RULES_FILE;
  // Returned as given, matching `rulesFilePath` in `apps/api/src/ruleset.ts`: what the override
  // names is the caller's explicit choice, and the parsers validate whatever it points at.
  return override !== undefined && override !== ""
    ? override
    : publishedRulesFileIn(rulesDirectory);
}
