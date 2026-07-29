import { readFileSync, readdirSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Client } from "pg";

type JsonObject = Record<string, unknown>;

export type PublishedRule = {
  id: string;
  kind: string;
  trigger: JsonObject;
  output: JsonObject;
  verification: JsonObject;
  source: JsonObject | null;
};

export type PublishedRuleset = {
  schema: string;
  rulesetVersion: string;
  snapshotDate: string;
  status: string;
  intakeFields: string[];
  rules: PublishedRule[];
  advisories: PublishedRule[];
  /** The validated document itself, for consumers that read parts this type flattens
   * away (F-101 parses the `intake_fields` registry, `asked_when` included). */
  document: JsonObject;
};

const EXPECTED_SCHEMA = "popengine-rules/v2";
const EXPECTED_RULESET_VERSION = "nyc.v2.9";
const EXPECTED_RULE_COUNT = 42;
const EXPECTED_ADVISORY_COUNT = 4;
/** Published rulesets are `nyc-rules.v<version>.json`; `rules/proposals/` is drafts and excluded. */
const PUBLISHED_RULESET = /^nyc-rules\.v.+\.json$/;

/** The artifact family this api can read. `EXPECTED_SCHEMA` pins the exact token at validation. */
const SCHEMA_FAMILY = "popengine-rules/";

const RULES_DIRECTORY = fileURLToPath(new URL("../../../rules/", import.meta.url));

/**
 * The published ruleset, FOUND rather than named.
 *
 * This used to spell the versioned filename directly, and that is a landmine a bump
 * cannot see: publishing the next version deletes the file this points at, and the api then fails
 * to boot on a path nobody remembered to update. Reading the directory means a bump changes one
 * artifact and nothing else has to be swept.
 *
 * Exactly one is expected. Zero and two both throw naming what was found, because booting against
 * an arbitrary one of two rulesets is the failure this whole file exists to prevent — every permit
 * fact the product states would come from an artifact nobody chose.
 *
 * NOTE ON `EXPECTED_RULESET_VERSION` ABOVE, which deliberately still names nyc.v2.9: the two are
 * not redundant and this change does not weaken it. The PATH says which file to read; the VERSION
 * says which content is approved to boot on, and a mismatch is a hard boot failure on purpose
 * (AD-2, and the check further down this file). Finding the file does not decide whether its
 * contents are the ratified ones, so a bump that publishes v2.10 without updating that constant
 * still fails loudly at boot — which is the intended behaviour, not a gap.
 */
/**
 * Asserts that `path` is a published ruleset, and nothing more than that.
 *
 * The cost of finding rather than naming. A named path failed loudly when the file was missing;
 * discovery succeeds on any file whose NAME fits, so a truncated download, a merge artefact or a
 * half-written publish would be found and booted from. The name is not evidence, so the file is
 * asked to identify itself: it must parse as JSON, declare a `popengine-rules/*` schema, and carry
 * a non-empty `ruleset_version`.
 *
 * It stops there deliberately. `validateRuleset` below already checks the schema token exactly, the
 * version against `EXPECTED_RULESET_VERSION`, the rule and advisory counts, and every field of
 * every rule — and `loadRuleset` runs it on whatever path this returns. Re-checking any of that
 * here would be a second copy of the contract, free to drift from the one that boots the api. This
 * answers "is this the artifact?"; `validateRuleset` answers "is it the approved artifact?".
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
 * The published artifact itself, ignoring any `RULES_FILE` override. Exported so the suites that
 * assert against the real ruleset read the same one the api boots from rather than spelling their
 * own path to it.
 *
 * A FUNCTION RATHER THAN A CONST, which is the whole of the override fix. As a module-scope const
 * this scanned the directory at IMPORT, so a missing or ambiguous `rules/` threw before
 * `rulesFilePath` ever looked at `RULES_FILE` — defeating the override in precisely the situation
 * someone reaches for it, which is pointing the api at a file when the directory is not in the
 * expected state. Nothing scans now until something actually needs the default.
 */
export function publishedRulesFile(): string {
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

export const RULE_KINDS = new Set([
  "permit",
  "insurance",
  "notification",
  "registration",
  "eligibility",
  "prohibition",
  "dependency",
  "classification",
  "advisory",
  "note",
]);
// Kinds whose finding directs the organizer to act with a specific body, so the
// agency must be published (issue #77). advisory / note / classification describe a
// condition rather than a filing and may omit it; ADV-NOISE-CODE-001 has no single
// acting agency (DEP and NYPD share Noise Code enforcement) and ADV-ALCOHOL-PUBLIC-001
// deliberately names none.
const AGENCY_REQUIRED_KINDS = new Set([
  "permit",
  "insurance",
  "notification",
  "registration",
  "eligibility",
  "prohibition",
  "dependency",
]);
const CONDITION_OPERATORS = new Set(["eq", "in", "gt", "gte", "bool", "contains", "contains_any"]);
export const VERIFICATION_STATUSES = new Set([
  "SOURCE_CONFIRMED",
  "OFFICIAL_CONFLICT",
  "RESEARCH_REQUIRED",
  "COVERAGE_GAP",
  "VERIFIED",
]);

function validationError(message: string): never {
  throw new Error(`Ruleset validation failed: ${message}`);
}

function requireObject(value: unknown, label: string): JsonObject {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    validationError(`${label} must be an object`);
  }
  return value as JsonObject;
}

function requireArray(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) {
    validationError(`${label} must be an array`);
  }
  return value;
}

function requireString(object: JsonObject, key: string, label: string): string {
  const value = object[key];
  if (typeof value !== "string" || value.length === 0) {
    validationError(`${label}.${key} must be a non-empty string`);
  }
  return value;
}

/**
 * A `YYYY-MM-DD` day that a Postgres `date` column will store as itself.
 *
 * Both dates this guards reach a `date` column, and a column is the wrong place to find out: the
 * api would boot clean on a bad artifact and then fail every plan write, per organizer, at the
 * moment the plan is generated. Boot validation exists so that never happens (F-201 AC 6). That
 * makes the promise here specific — not "this parses in JS" but "this survives the column" — so all
 * three clauses below are load-bearing and each rejects a class the others let through.
 *
 * 1. THE SHAPE excludes a wide class Postgres would otherwise accept and reinterpret. `date` input
 *    takes `today`, `epoch`, `infinity`, `-infinity`, ordinal `2026-189`, `20260718`, `2026/07/18`,
 *    `July 18, 2026`, `4713-01-01 BC` and years past 9999 — every one of which would become a
 *    published verification date that no source states. It also excludes `2026-7-18`, which
 *    Postgres accepts and pads, so the response and the row read back would disagree.
 * 2. THE ROUND TRIP rejects impossible days inside the shape — "2026-02-31", "2026-13-45" — because
 *    `Date.parse` rolls them forward, so they do not come back as themselves.
 * 3. YEAR 0000 is the one place clauses 1 and 2 agree and Postgres does not. ISO 8601 has a year
 *    zero and ECMAScript implements it, so "0000-01-01" satisfies the shape and round-trips
 *    unchanged; Postgres has no year 0 (1 BC is followed by 1 AD) and refuses it at the cast. Left
 *    to clause 2 alone this was the deferred failure the whole check exists to stop, surviving
 *    inside the check.
 *
 * That clause 3 is the ONLY such place is measured rather than assumed. Every string the shape
 * admits was cast against Postgres 16 and compared with this predicate — the full year axis
 * 0000–9999, the full month and day axes, February 28 and 29 of all 10,000 years, and each month's
 * last and first-invalid day across the boundary years. 30,488 values: the two disagree on year
 * 0000 and nowhere else, no value that both accept is stored as a different day, and DateStyle
 * changes only how a date is rendered, never how `YYYY-MM-DD` is read. So the JS check standing in
 * for the cast is justified over the space it admits, not merely hoped to be.
 */
function requireIsoDate(value: string, label: string): void {
  const parsed = Date.parse(`${value}T00:00:00Z`);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    Number.isNaN(parsed) ||
    new Date(parsed).toISOString().slice(0, 10) !== value
  ) {
    validationError(`${label} must be an ISO date`);
  }
  // Named separately because the value is a legal ISO date, so "must be an ISO date" would send an
  // operator looking for a typo that is not there.
  if (value.startsWith("0000-")) {
    validationError(`${label} has no year 0000; Postgres dates run 1 BC to 1 AD with none between`);
  }
}

/**
 * The alert type F-203 schedules its reminders from. Named because it is the one entry this
 * validator closes over: the feature reads `config.alert_offsets.deadline_reminder.days_before`
 * exactly, so that path existing and being usable is not a matter of taste.
 */
const REQUIRED_ALERT_TYPE = "deadline_reminder";

/**
 * The largest offset `packages/engine/src/calendar.ts` can subtract from a filing deadline and still
 * return a real calendar date, MEASURED rather than assumed.
 *
 * `addCalendarDays` converts to an epoch day, adds, and formats with
 * `new Date(ms).toISOString().slice(0, 10)`. Two boundaries fall out of that, and the useful one is
 * not the obvious one:
 *
 * - It throws `RangeError` past ±100,000,000 days from the Unix epoch, the ECMAScript time-value
 *   limit (8.64e15 ms). Confirmed at the edge: 100,000,000 formats, 100,000,001 throws.
 * - Long BEFORE that it stops being correct without throwing. `toISOString` switches to an extended
 *   year outside 0000–9999, so `.slice(0, 10)` truncates `-000001-12-31T…` to `"-000001-12"` — ten
 *   characters that are not a date, returned with no error. From 2026-08-26, offset 740,219 gives
 *   `0000-01-01` and 740,220 gives `"-000001-12"`, while `RangeError` waits until 100,020,692. That
 *   silent band is a defect in `fromEpochDay` rather than in this validator, reported separately and
 *   deliberately not fixed here; this bound keeps every admitted offset far outside it.
 *
 * The usable boundary is therefore date-dependent — `epochDay(deadline) − epochDay(0000-01-01)` — so
 * there is no single representable constant. This is the tightest value that holds for ANY deadline
 * at or after the Unix epoch, which every deadline the product can produce is: they come from a
 * Postgres `date` column the engine computes from an event date F-101 refuses to accept in the past.
 * Measured from 1970-01-01, where it is smallest.
 */
export const MAX_REPRESENTABLE_DAYS_BEFORE = 719_528;

/**
 * The longest reminder offset the product will accept, independent of what the arithmetic can hold.
 *
 * PRODUCT POLICY, NOT A MECHANICAL LIMIT. Ratified 2026-07-26 (product-owner approved) and published
 * in `specs/F-203-deadline-alerts.md`, which owns the alert offsets: "A published offset must be a
 * whole number of days from 1 to 3650." That spec is the approved artifact this constant enforces —
 * change it there first, then here, and it is deliberately alone on this line. Rationale, from the
 * spec: an offset counts days back from a filing deadline, and the longest window published in
 * nyc.v2.9 is 60 days, so 3,650 never binds on anything real while still refusing nonsense. It is
 * ~200× smaller than `MAX_REPRESENTABLE_DAYS_BEFORE`, so in practice
 * this is the bound that does the work; the representable one documents the mechanical ceiling and
 * catches the case where this is ever raised past what the arithmetic can take.
 */
export const MAX_PRODUCT_DAYS_BEFORE = 3_650;

/**
 * A `days_before` list: one reminder per entry, scheduled at the item's `latest_apply_date` minus
 * that many whole days.
 *
 * Extracted so the closed and open halves below cannot drift into checking it differently.
 *
 * `Number.isInteger` alone was the third instance in this file of one shape: a JavaScript predicate
 * standing in for a constraint that lives downstream. `requireIsoDate` accepted ISO year zero that
 * Postgres rejects (#114); the checksum reader treated a malformed digest as an absent one (#120).
 * `Number.isInteger(1e20)` is true and the date arithmetic cannot represent it (#122), so boot
 * reported success and the failure waited for the first reminder F-203 tried to schedule. Both
 * bounds below are named and checked separately because they answer different questions, and the
 * error says which one refused the value so nobody has to guess which line to change.
 */
function requireDaysBefore(value: unknown, label: string): void {
  const days = requireArray(value, label);
  if (days.length === 0) {
    validationError(`${label} must not be empty`);
  }
  const seen = new Set<number>();
  for (const [index, day] of days.entries()) {
    const at = `${label}[${index}]`;
    // A fraction lands mid-day, a negative fires after the deadline it warns about, and zero is the
    // deadline itself rather than a warning — none of the three is a reminder.
    if (typeof day !== "number" || !Number.isInteger(day) || day <= 0) {
      validationError(`${at} must be a positive whole number of days, received ${String(day)}`);
    }
    // Checked before the product bound so an absurd value is named for what it is. Unreachable while
    // the product bound is the tighter of the two, and here so that raising that one past what the
    // arithmetic can hold fails loudly instead of reopening #122.
    if (day > MAX_REPRESENTABLE_DAYS_BEFORE) {
      validationError(
        `${at} is ${day}, beyond the ${MAX_REPRESENTABLE_DAYS_BEFORE} days the calendar arithmetic ` +
          `can subtract from a filing deadline and still return a real date`,
      );
    }
    if (day > MAX_PRODUCT_DAYS_BEFORE) {
      validationError(
        `${at} is ${day}, beyond the ${MAX_PRODUCT_DAYS_BEFORE}-day maximum reminder offset; the ` +
          `longest window nyc.v2.9 publishes is 60 days`,
      );
    }
    if (seen.has(day)) {
      validationError(`${at} repeats ${day}, which would send the same reminder twice`);
    }
    seen.add(day);
  }
}

/**
 * The reminder offsets F-203 schedules from (`config.alert_offsets`), checked at boot.
 *
 * F-203 states these are config rather than code, so the artifact is the contract and an
 * implementer reads it rather than a constant. That makes an unusable value a boot failure and not
 * a runtime one: the alternative is an api that starts clean and then schedules nothing, a negative
 * offset that fires after the deadline, or a fractional one that lands mid-day, discovered per
 * organizer at the moment the alert should have gone out. Same reasoning as `last_verified_date`,
 * which is validated here for the same reason.
 *
 * THIS VALIDATOR IS DELIBERATELY CLOSED IN ONE PLACE AND OPEN EVERYWHERE ELSE, and the two halves
 * are not a compromise between each other — they answer different questions. Collapsing either into
 * the other reintroduces a defect this shape was reviewed into fixing, so the split is stated here
 * rather than left to be inferred:
 *
 * CLOSED — `deadline_reminder` and its `days_before`. F-203 reads that exact path, so an artifact
 * without it boots an api with no configuration for the feature and defers the failure to wherever
 * F-203 first looks. Checking only that SOME type is present let an artifact carrying, say, only
 * `slack_warning` pass. Do not relax this to "at least one alert type": that is what it was.
 *
 * OPEN — every other key. Keys are `alerts.alert_type` values and the published note says each type
 * owns an object precisely so a later kind (F-305, F-413) can schedule by an absolute date or an
 * hour offset instead. Requiring `days_before` of every entry rejected exactly the extension the
 * note invites. So an unknown type is accepted with whatever shape it declares, and `days_before`
 * is checked only when the entry declares one — validating what this file understands without
 * predicting what it does not. Do not "fix" this by enumerating future types: the enumeration is
 * the thing the shape exists to avoid.
 *
 * What the open half deliberately does not do: an unknown entry declaring no recognised field is
 * accepted rather than rejected as empty. There is no field name to require without guessing the
 * mechanism, and `alerts.alert_type` is CHECK-constrained in migration 001, so an unusable new kind
 * cannot reach persistence without a forward migration reviewing it anyway.
 */
function requireAlertOffsets(value: unknown, label: string): void {
  const offsets = requireObject(value, label);

  // The closed half.
  if (!Object.hasOwn(offsets, REQUIRED_ALERT_TYPE)) {
    validationError(
      `${label}.${REQUIRED_ALERT_TYPE} is required; F-203 schedules its reminders from it`,
    );
  }
  const required = requireObject(offsets[REQUIRED_ALERT_TYPE], `${label}.${REQUIRED_ALERT_TYPE}`);
  requireDaysBefore(required.days_before, `${label}.${REQUIRED_ALERT_TYPE}.days_before`);

  // The open half.
  for (const alertType of Object.keys(offsets)) {
    // `note` is metadata on the map itself, not an alert type.
    if (alertType === "note" || alertType === REQUIRED_ALERT_TYPE) continue;
    const entry = requireObject(offsets[alertType], `${label}.${alertType}`);
    if (entry.days_before !== undefined) {
      requireDaysBefore(entry.days_before, `${label}.${alertType}.days_before`);
    }
  }
}

/**
 * The reminder offsets F-203 schedules from, read off the artifact rather than restated as a
 * constant — the spec says they are config and not code. Safe to assert the shape here because
 * `requireAlertOffsets` refused the load otherwise; boot is where an unusable value fails.
 */
export function deadlineReminderOffsets(ruleset: PublishedRuleset): number[] {
  const config = ruleset.document.config as {
    alert_offsets: Record<string, { days_before: number[] }>;
  };
  return [...(config.alert_offsets[REQUIRED_ALERT_TYPE]?.days_before ?? [])];
}

function parseSource(value: unknown, label: string): JsonObject {
  const source = requireObject(value, label);
  requireString(source, "citation", label);
  const urls = requireArray(source.urls, `${label}.urls`);
  if (urls.length === 0) {
    validationError(`${label}.urls must not be empty`);
  }
  for (const [index, url] of urls.entries()) {
    if (typeof url !== "string" || url.length === 0) {
      validationError(`${label}.urls[${index}] must be a non-empty string`);
    }
  }
  return source;
}

function collectTriggerFields(value: unknown, label: string): string[] {
  const trigger = requireObject(value, label);
  const nodeKeys = ["field", "all", "any"].filter((key) => Object.hasOwn(trigger, key));
  if (nodeKeys.length !== 1) {
    validationError(`${label} must contain exactly one of all, any, or field`);
  }

  if (nodeKeys[0] === "field") {
    const field = requireString(trigger, "field", label);
    const operator = requireString(trigger, "op", label);
    if (!CONDITION_OPERATORS.has(operator)) {
      validationError(`${label}.op has unsupported value "${operator}"`);
    }
    if (!Object.hasOwn(trigger, "value")) {
      validationError(`${label}.value is required`);
    }
    return [field];
  }

  const combinator = nodeKeys[0]!;
  const children = requireArray(trigger[combinator], `${label}.${combinator}`);
  if (children.length === 0) {
    validationError(`${label}.${combinator} must not be empty`);
  }

  return children.flatMap((child, index) =>
    collectTriggerFields(child, `${label}.${combinator}[${index}]`),
  );
}

function parseRule(
  value: unknown,
  label: string,
  declaredFields: ReadonlySet<string>,
): PublishedRule {
  const rule = requireObject(value, label);
  const id = requireString(rule, "id", label);
  const kind = requireString(rule, "kind", label);
  if (!RULE_KINDS.has(kind)) {
    validationError(`${label}.kind has unsupported value "${kind}"`);
  }

  const trigger = requireObject(rule.trigger, `${label}.trigger`);
  for (const field of collectTriggerFields(trigger, `${label}.trigger`)) {
    if (!declaredFields.has(field)) {
      validationError(`${label}.trigger references undeclared field "${field}"`);
    }
  }

  const output = requireObject(rule.output, `${label}.output`);
  if (AGENCY_REQUIRED_KINDS.has(kind)) {
    requireString(output, "agency", `${label}.output`);
  }

  const verification = requireObject(rule.verification, `${label}.verification`);
  const verificationStatus = requireString(verification, "status", `${label}.verification`);
  if (!VERIFICATION_STATUSES.has(verificationStatus)) {
    validationError(`${label}.verification.status has unsupported value "${verificationStatus}"`);
  }
  // Optional (F-206: a date is stored only when every contributing rule publishes one), but when
  // it is published it is written to `permit_plan_items.last_verified_date`, a `date` column.
  if (verification.last_verified_date !== undefined) {
    requireIsoDate(
      requireString(verification, "last_verified_date", `${label}.verification`),
      `${label}.verification.last_verified_date`,
    );
  }

  const source = rule.source === undefined ? null : parseSource(rule.source, `${label}.source`);
  if (source === null && verificationStatus !== "COVERAGE_GAP") {
    validationError(`${label}.source is required unless verification.status is COVERAGE_GAP`);
  }
  return { id, kind, trigger, output, verification, source };
}

export function validateRuleset(value: unknown): PublishedRuleset {
  const ruleset = requireObject(value, "ruleset");
  const schema = requireString(ruleset, "schema", "ruleset");
  if (schema !== EXPECTED_SCHEMA) {
    validationError(`expected schema ${EXPECTED_SCHEMA}, received ${schema}`);
  }

  const rulesetVersion = requireString(ruleset, "ruleset_version", "ruleset");
  if (rulesetVersion !== EXPECTED_RULESET_VERSION) {
    validationError(
      `expected ruleset version ${EXPECTED_RULESET_VERSION}, received ${rulesetVersion}`,
    );
  }

  const snapshotDate = requireString(ruleset, "snapshot_date", "ruleset");
  requireIsoDate(snapshotDate, "ruleset.snapshot_date");

  const config = requireObject(ruleset.config, "ruleset.config");
  requireAlertOffsets(config.alert_offsets, "ruleset.config.alert_offsets");

  const status = requireString(ruleset, "status", "ruleset");
  if (!status.startsWith("APPROVED")) {
    validationError("ruleset status must be APPROVED");
  }

  const intakeFields = requireArray(ruleset.intake_fields, "ruleset.intake_fields").map(
    (field, index) =>
      requireString(
        requireObject(field, `ruleset.intake_fields[${index}]`),
        "field",
        `ruleset.intake_fields[${index}]`,
      ),
  );
  const declaredFields = new Set(intakeFields);
  if (declaredFields.size !== intakeFields.length) {
    validationError("intake field names must be unique");
  }

  const ruleValues = requireArray(ruleset.rules, "ruleset.rules");
  if (ruleValues.length !== EXPECTED_RULE_COUNT) {
    validationError(`expected ${EXPECTED_RULE_COUNT} rules, received ${ruleValues.length}`);
  }

  const advisoryValues = requireArray(ruleset.advisories, "ruleset.advisories");
  if (advisoryValues.length !== EXPECTED_ADVISORY_COUNT) {
    validationError(
      `expected ${EXPECTED_ADVISORY_COUNT} advisories, received ${advisoryValues.length}`,
    );
  }

  const rules = ruleValues.map((rule, index) =>
    parseRule(rule, `ruleset.rules[${index}]`, declaredFields),
  );
  const advisories = advisoryValues.map((rule, index) =>
    parseRule(rule, `ruleset.advisories[${index}]`, declaredFields),
  );

  const ids = new Set<string>();
  for (const rule of [...rules, ...advisories]) {
    if (ids.has(rule.id)) {
      validationError(`duplicate rule id "${rule.id}"`);
    }
    ids.add(rule.id);
  }

  return {
    schema,
    rulesetVersion,
    snapshotDate,
    status,
    intakeFields,
    rules,
    advisories,
    document: ruleset,
  };
}

/** The published ruleset path the api boots from; the engine parses the same file (AD-2). */
export function rulesFilePath(): string {
  // The override is consulted BEFORE the directory is scanned. It used to be the other way round
  // only by accident — the default was a module-scope const — and that made the escape hatch
  // unusable exactly when it was needed: a caller who set RULES_FILE because `rules/` was empty,
  // ambiguous or holding a bad artifact still got the scan's error, about a directory they had
  // just said not to use. What the override names is the caller's explicit choice, so it is
  // returned unexamined here; `loadRuleset` validates it in full either way.
  const override = process.env.RULES_FILE;
  return override !== undefined && override !== "" ? resolve(override) : publishedRulesFile();
}

export async function loadRuleset(filePath = rulesFilePath()): Promise<PublishedRuleset> {
  try {
    return validateRuleset(JSON.parse(await readFile(filePath, "utf8")));
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Ruleset validation failed:")) {
      throw error;
    }
    throw new Error(`Ruleset validation failed: cannot load ${filePath}`, {
      cause: error,
    });
  }
}

function optionalString(object: JsonObject, key: string): string | null {
  const value = object[key];
  return typeof value === "string" ? value : null;
}

function ruleTitle(rule: PublishedRule): string | null {
  for (const key of ["permit_name", "requirement_name", "advisory_text", "note_text"]) {
    const title = optionalString(rule.output, key);
    if (title !== null) return title;
  }
  return null;
}

export async function syncPermitRules(client: Client, ruleset: PublishedRuleset): Promise<void> {
  await client.query("BEGIN");
  try {
    await client.query("SELECT pg_advisory_xact_lock(hashtext('pop-engine'), hashtext($1))", [
      ruleset.rulesetVersion,
    ]);
    await client.query("DELETE FROM permit_rules WHERE ruleset_version = $1", [
      ruleset.rulesetVersion,
    ]);

    // ponytail: 46 boot-time rows; use one bulk insert only if ruleset size grows materially.
    for (const rule of [...ruleset.rules, ...ruleset.advisories]) {
      await client.query(
        `INSERT INTO permit_rules
          (ruleset_version, rule_id, kind, title, agency, trigger, output, verification, source)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8::jsonb, $9::jsonb)`,
        [
          ruleset.rulesetVersion,
          rule.id,
          rule.kind,
          ruleTitle(rule),
          optionalString(rule.output, "agency"),
          JSON.stringify(rule.trigger),
          JSON.stringify(rule.output),
          JSON.stringify(rule.verification),
          rule.source === null ? null : JSON.stringify(rule.source),
        ],
      );
    }

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}
