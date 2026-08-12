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
const EXPECTED_RULESET_VERSION = "nyc.v2.12";
const EXPECTED_RULE_COUNT = 42;
const EXPECTED_ADVISORY_COUNT = 4;
/** Published rulesets are `nyc-rules.v<version>.json`; `rules/proposals/` is drafts and excluded. */
const PUBLISHED_RULESET = /^nyc-rules\.v.+\.json$/;

/** The artifact family this api can read. `EXPECTED_SCHEMA` pins the exact token at validation. */
const SCHEMA_FAMILY = "popengine-rules/";

const RULES_DIRECTORY = fileURLToPath(new URL("../../../rules/", import.meta.url));

/** Asserts that `path` is a published ruleset. */
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

/** The published artifact itself, ignoring any `RULES_FILE` override. */
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
// Kinds whose finding directs the organizer to act with a specific body, so the agency must be published (issue #77).
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

/** A `YYYY-MM-DD` day that a Postgres `date` column will store as itself. */
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

/** The largest offset `packages/engine/src/calendar.ts` can subtract from a filing deadline and still return a real calendar date, MEASURED rather than assumed. */
export const MAX_REPRESENTABLE_DAYS_BEFORE = 719_528;

/** The longest reminder offset the product will accept, independent of what the arithmetic can hold. */
export const MAX_PRODUCT_DAYS_BEFORE = 3_650;

/** A `days_before` list: one reminder per entry, scheduled at the item's `latest_apply_date` minus that many whole days. */
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
    // Checked before the product bound so an absurd value is named for what it is.
    if (day > MAX_REPRESENTABLE_DAYS_BEFORE) {
      validationError(
        `${at} is ${day}, beyond the ${MAX_REPRESENTABLE_DAYS_BEFORE} days the calendar arithmetic ` +
          `can subtract from a filing deadline and still return a real date`,
      );
    }
    if (day > MAX_PRODUCT_DAYS_BEFORE) {
      validationError(
        `${at} is ${day}, beyond the ${MAX_PRODUCT_DAYS_BEFORE}-day maximum reminder offset; the ` +
          `longest window nyc.v2.12 publishes is 60 days`,
      );
    }
    if (seen.has(day)) {
      validationError(`${at} repeats ${day}, which would send the same reminder twice`);
    }
    seen.add(day);
  }
}

/** The reminder offsets F-203 schedules from (`config.alert_offsets`), checked at boot. */
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
  // The override is consulted BEFORE the directory is scanned.
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
    // Serialize delete/reseed across API instances for this ruleset version.
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
