// Narrows the published ruleset JSON into the typed shape the engine evaluates.
// Pure: the caller reads the file (apps/api at boot) and hands over parsed JSON.
// Anything malformed throws — an evaluation input the engine cannot read is an error,
// never a quiet "no requirement" (AC 5).

import { parseAskedWhen } from "./conditions";
import { EVENT_DATE_FIELD, EvaluationError } from "./types";
import type {
  LevelBinding,
  Condition,
  ConditionBoundary,
  ConditionOperator,
  Deadline,
  DeadlineBoundary,
  Disposition,
  EngineRule,
  EngineRuleset,
  IntakeFieldDefinition,
  RuleKind,
  RuleSource,
  TriggerNode,
  VerificationStatus,
} from "./types";

type JsonObject = Record<string, unknown>;

const CONDITION_OPERATORS: readonly ConditionOperator[] = [
  "eq",
  "in",
  "gt",
  "gte",
  "bool",
  "contains",
  "contains_any",
];

const RULE_KINDS: readonly RuleKind[] = [
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
];

const VERIFICATION_STATUSES: readonly VerificationStatus[] = [
  "SOURCE_CONFIRMED",
  "OFFICIAL_CONFLICT",
  "RESEARCH_REQUIRED",
  "COVERAGE_GAP",
  "VERIFIED",
];

/** The rule domain publishes SCREAMING_CASE dispositions; plan items store the lowercase form (engine_conventions). */
const PUBLISHED_DISPOSITIONS: Readonly<Record<string, Disposition>> = {
  REQUIRED: "required",
  MAY_BE_REQUIRED: "may_be_required",
  PROHIBITED_OR_INELIGIBLE: "prohibited_or_ineligible",
  ADVISORY: "advisory",
  NO_NEW_REQUIREMENT_IDENTIFIED: "no_new_requirement",
};

function fail(message: string): never {
  throw new EvaluationError(`Ruleset cannot be evaluated: ${message}`);
}

function asObject(value: unknown, label: string): JsonObject {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    fail(`${label} must be an object`);
  return value as JsonObject;
}

function asArray(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) fail(`${label} must be an array`);
  return value;
}

function asString(value: unknown, label: string): string {
  if (typeof value !== "string" || value === "") fail(`${label} must be a non-empty string`);
  return value;
}

function asNumber(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) fail(`${label} must be a number`);
  return value;
}

function optionalString(container: JsonObject, key: string): string | null {
  const value = container[key];
  return typeof value === "string" && value !== "" ? value : null;
}

function optionalStringArray(container: JsonObject, key: string, label: string): string[] {
  const value = container[key];
  if (value === undefined) return [];
  return asArray(value, label).map((entry, index) => asString(entry, `${label}[${index}]`));
}

/**
 * A threshold whose exact value is unresolved rather than below the line.
 *
 * Only an ordering comparison against a number can carry one: "exactly on the boundary" means
 * nothing for an equality or a set membership, so a rule declaring it there is an authoring
 * mistake rather than something to ignore. Published per condition because it is a fact about
 * that threshold — FDNY-GENERATOR-001's 2.5 gallons and DOB-STAGE-001's 2 feet exclude their
 * exact values, and say so by declaring nothing.
 */
/**
 * What a published ruleset from before nyc.v2.4 relied on the engine to supply.
 *
 * These are not defaults. A version reaches this table only by having already shipped without
 * publishing the facts: from nyc.v2.4 on every ruleset declares them itself and fails to load
 * otherwise, so the table can never cover a version that had the option to publish. It exists
 * because a plan pins its `ruleset_version` and `intake_snapshot` in order to be re-evaluated
 * later (AD-7 "history is reproducible even after rules change", AD-13 version coexistence,
 * DOCUMENTATION-GOVERNANCE §9 "verify historical replay"). Refusing the artifact would make
 * every plan generated before this bump unreproducible; guessing the facts from the artifact
 * would be the inference the bump exists to delete. Recording what the engine of that era
 * actually did is neither.
 *
 * Closed set. A new entry is only ever wrong: a new ruleset can publish.
 *
 * nyc.v1 is deliberately absent — it predates the corrected subset and its own artifact is not
 * known to parse under this engine at all, so listing it would assert a replay guarantee that
 * has not been demonstrated.
 */
type PrePublicationFacts = {
  readonly levelBinding: { readonly levelField: string; readonly multiBlockField: string };
  /** Thresholds whose exact value these versions treated as unresolved, by rule and field. */
  readonly conditionalThresholds: readonly { readonly ruleId: string; readonly field: string }[];
};

const PRE_PUBLICATION_FACTS: ReadonlyMap<string, PrePublicationFacts> = new Map(
  ["nyc.v2.1", "nyc.v2.2", "nyc.v2.3"].map((version) => [
    version,
    {
      levelBinding: { levelField: "plaza_level", multiBlockField: "plaza_multiple_blocks" },
      conditionalThresholds: [{ ruleId: "DOB-TENT-001", field: "tent_area_sqft" }],
    },
  ]),
);

function parseConditionBoundary(
  node: JsonObject,
  operator: ConditionOperator,
  label: string,
  legacyConditionalFields: readonly string[],
): ConditionBoundary | null {
  const declared =
    node.boundary ??
    (legacyConditionalFields.includes(asString(node.field, `${label}.field`))
      ? "conditional"
      : undefined);
  if (declared === undefined) return null;
  if (declared !== "conditional") {
    fail(`${label}.boundary has unsupported value "${String(declared)}"`);
  }
  // Only "gt" excludes its own threshold, so only "gt" has an excluded value to reopen. Under
  // "gte" the exact value already matches, which is a different fact and not this one.
  if (operator !== "gt") {
    fail(`${label}.boundary does not apply to the "${operator}" operator`);
  }
  if (typeof node.value !== "number") {
    fail(`${label}.boundary needs a numeric threshold to sit on`);
  }
  return declared;
}

function parseTrigger(
  value: unknown,
  label: string,
  legacyConditionalFields: readonly string[],
): TriggerNode {
  const node = asObject(value, label);
  const keys = ["all", "any", "field"].filter((key) => Object.hasOwn(node, key));
  if (keys.length !== 1) fail(`${label} must contain exactly one of all, any, or field`);

  if (keys[0] === "field") {
    const operator = asString(node.op, `${label}.op`) as ConditionOperator;
    if (!CONDITION_OPERATORS.includes(operator))
      fail(`${label}.op has unsupported value "${operator}"`);
    if (!Object.hasOwn(node, "value")) fail(`${label}.value is required`);
    return {
      field: asString(node.field, `${label}.field`),
      op: operator,
      value: node.value,
      boundary: parseConditionBoundary(node, operator, label, legacyConditionalFields),
    } satisfies Condition;
  }

  const combinator = keys[0] === "all" ? "all" : "any";
  const children = asArray(node[combinator], `${label}.${combinator}`);
  if (children.length === 0) fail(`${label}.${combinator} must not be empty`);
  const parsed = children.map((child, index) =>
    parseTrigger(child, `${label}.${combinator}[${index}]`, legacyConditionalFields),
  );
  return combinator === "all" ? { all: parsed } : { any: parsed };
}

/** Deadline types that express a single filing bound, so an exclusive boundary has a meaning. */
const BOUNDED_DEADLINE_TYPES = new Set([
  "published_minimum",
  "published_minimum_by_level",
  "business_days_minimum",
  "composite",
]);

/**
 * Whether the published number is an inclusive or exclusive bound. Absent means inclusive, which
 * is what every rule that says "at least N days" means. Only the types that date a deadline by
 * counting back from the event carry one; declaring a boundary on any other type is a ruleset
 * error rather than something to ignore quietly.
 */
function parseBoundary(deadline: JsonObject, type: string, label: string): DeadlineBoundary {
  const declared = deadline.boundary;
  if (declared === undefined) return "inclusive";
  if (declared !== "inclusive" && declared !== "exclusive") {
    fail(`${label}.boundary has unsupported value "${String(declared)}"`);
  }
  if (!BOUNDED_DEADLINE_TYPES.has(type)) {
    fail(`${label}.boundary does not apply to a "${type}" deadline`);
  }
  return declared;
}

/**
 * The intake fields a by-level deadline keys on, as the rule declares them.
 *
 * Published data since nyc.v2.4 rather than supplied out of band. Both halves are validated
 * against the registry, because a binding naming a field the evaluator cannot read is a deadline
 * it cannot date: the level field must offer every published level, and the multi-block field must
 * be the boolean that chooses between a level's two windows.
 */
function parseLevelBinding(
  deadline: JsonObject,
  levels: Record<string, { calendarDays: number; multiBlockDays: number | null }>,
  intakeFields: readonly IntakeFieldDefinition[],
  label: string,
  legacy: PrePublicationFacts | null,
): LevelBinding {
  const declared = (key: "level_field" | "multi_block_field", fallback: string): string =>
    deadline[key] === undefined && legacy !== null
      ? fallback
      : asString(deadline[key], `${label}.${key}`);

  const levelField = requireDeclaredField(
    declared("level_field", legacy?.levelBinding.levelField ?? ""),
    intakeFields,
    `${label}.level_field`,
  );
  // The resolver reads the answer as a single level (`deadline.levels[answer]`), so a field that
  // can answer with several has no level to resolve. It would take the unresolvable path, which
  // reports NOT_CALCULABLE without naming a blocking fact, and a plan can read FEASIBLE around an
  // undated permit. Rejecting the artifact is the loud half of the same check.
  if (levelField.type !== "enum") {
    fail(
      `${label}.level_field "${levelField.field}" is a ${levelField.type} field; ` +
        `a level deadline resolves one level per plan, so it needs an enum`,
    );
  }
  const missing = Object.keys(levels).filter((key) => levelField.values?.includes(key) !== true);
  if (missing.length > 0) {
    fail(
      `${label}.level_field "${levelField.field}" does not offer published level(s) ` +
        missing.join(", "),
    );
  }

  const multiBlockField = requireDeclaredField(
    declared("multi_block_field", legacy?.levelBinding.multiBlockField ?? ""),
    intakeFields,
    `${label}.multi_block_field`,
  );
  if (multiBlockField.type !== "boolean") {
    fail(
      `${label}.multi_block_field "${multiBlockField.field}" is a ${multiBlockField.type} field; ` +
        `choosing between a level's two windows needs a boolean`,
    );
  }
  // Same rule again, on the other half: the resolver must be able to honour every level the rule
  // publishes. An out-of-scope field is not unanswered — `isUnanswered` reports false for it — so
  // the flag reads as "no" and the shorter single-block window is applied silently, which can
  // present an already-missed multi-block deadline as on track. That is the exact failure the
  // resolver guards against for an *unanswered* flag; scoping is the way around that guard.
  const unreachable = Object.entries(levels)
    .filter(([, entry]) => entry.multiBlockDays !== null)
    .map(([level]) => level)
    .filter((level) => !scopeAdmits(multiBlockField, levelField.field, level));
  if (unreachable.length > 0) {
    fail(
      `${label}.multi_block_field "${multiBlockField.field}" is not asked for level(s) ` +
        `${unreachable.join(", ")}, which publish a multi-block window`,
    );
  }
  return { levelField: levelField.field, multiBlockField: multiBlockField.field };
}

/** Whether `field`'s asked-when scoping still asks it when `levelField` answers `level`. */
function scopeAdmits(field: IntakeFieldDefinition, levelField: string, level: string): boolean {
  const clauses = (field.askedWhenClauses ?? []).filter((clause) => clause.field === levelField);
  return clauses.every((clause) => {
    if (clause.kind === "in") return clause.values.includes(level);
    if (clause.kind === "compare") {
      return clause.op === "=" ? clause.value === level : clause.value !== level;
    }
    // Any other clause kind against an enum level field is an authoring mistake rather than a
    // scoping this can reason about. Refusing is the safe direction.
    return false;
  });
}

function requireDeclaredField(
  name: string,
  intakeFields: readonly IntakeFieldDefinition[],
  label: string,
): IntakeFieldDefinition {
  const declared = intakeFields.find((field) => field.field === name);
  if (declared === undefined) fail(`${label} "${name}" is not a declared intake field`);
  return declared;
}

function parseDeadline(value: unknown, label: string): Deadline | null {
  if (value === undefined || value === null) return null;
  const deadline = asObject(value, label);
  const type = asString(deadline.type, `${label}.type`);
  const display = optionalString(deadline, "display");
  // The published caveat on the number itself (which instrument applies, calendar vs business
  // days). Dropping it presents a computed date as more definitive than its source is.
  const qualification = optionalString(deadline, "qualification");
  const boundary = parseBoundary(deadline, type, label);

  switch (type) {
    case "published_minimum":
      return {
        type,
        calendarDays: asNumber(deadline.calendar_days, `${label}.calendar_days`),
        display,
        qualification,
        boundary,
      };
    case "published_minimum_by_level": {
      const levels = asObject(deadline.levels, `${label}.levels`);
      const parsedLevels: Record<string, { calendarDays: number; multiBlockDays: number | null }> =
        {};
      for (const [level, definition] of Object.entries(levels)) {
        const entry = asObject(definition, `${label}.levels.${level}`);
        const multiBlockDays = entry.multi_block_days;
        parsedLevels[level] = {
          calendarDays: asNumber(entry.calendar_days, `${label}.levels.${level}.calendar_days`),
          multiBlockDays:
            multiBlockDays === undefined
              ? null
              : asNumber(multiBlockDays, `${label}.levels.${level}.multi_block_days`),
        };
      }
      if (Object.keys(parsedLevels).length === 0) fail(`${label}.levels must not be empty`);
      return {
        type,
        levels: parsedLevels,
        unknownLevelBehavior: optionalString(deadline, "unknown_level_behavior"),
        qualification,
        boundary,
      };
    }
    case "composite": {
      const range = asArray(deadline.processing_range_days, `${label}.processing_range_days`);
      if (range.length !== 2) fail(`${label}.processing_range_days must hold two numbers`);
      return {
        type,
        hardFloorDays: asNumber(deadline.hard_floor_days, `${label}.hard_floor_days`),
        processingRangeDays: [
          asNumber(range[0], `${label}.processing_range_days[0]`),
          asNumber(range[1], `${label}.processing_range_days[1]`),
        ],
        display,
        qualification,
        boundary,
      };
    }
    case "business_days_minimum":
      return {
        type,
        businessDays: asNumber(deadline.business_days, `${label}.business_days`),
        display,
        qualification,
        boundary,
      };
    case "before_issuance":
      return { type, display, qualification };
    case "research_required":
      return { type, display, qualification };
    default:
      return fail(`${label}.type has unsupported value "${type}"`);
  }
}

function parseSource(value: unknown, label: string): RuleSource | null {
  if (value === undefined) return null;
  const source = asObject(value, label);
  return {
    citation: asString(source.citation, `${label}.citation`),
    urls: asArray(source.urls, `${label}.urls`).map((url, index) =>
      asString(url, `${label}.urls[${index}]`),
    ),
  };
}

function parseRule(
  value: unknown,
  label: string,
  intakeFields: readonly IntakeFieldDefinition[],
  legacy: PrePublicationFacts | null,
): EngineRule {
  const rule = asObject(value, label);
  const ruleId = asString(rule.id, `${label}.id`);
  const legacyConditionalFields = (legacy?.conditionalThresholds ?? [])
    .filter((threshold) => threshold.ruleId === ruleId)
    .map((threshold) => threshold.field);
  const kind = asString(rule.kind, `${label}.kind`) as RuleKind;
  if (!RULE_KINDS.includes(kind)) fail(`${label}.kind has unsupported value "${kind}"`);

  const output = asObject(rule.output, `${label}.output`);
  const publishedDisposition = optionalString(output, "disposition");
  if (publishedDisposition !== null && PUBLISHED_DISPOSITIONS[publishedDisposition] === undefined) {
    fail(`${label}.output.disposition has unsupported value "${publishedDisposition}"`);
  }

  const deadline = parseDeadline(output.deadline, `${label}.output.deadline`);

  const verification = asObject(rule.verification, `${label}.verification`);
  const verificationStatus = asString(
    verification.status,
    `${label}.verification.status`,
  ) as VerificationStatus;
  if (!VERIFICATION_STATUSES.includes(verificationStatus)) {
    fail(`${label}.verification.status has unsupported value "${verificationStatus}"`);
  }

  const portal =
    output.portal === undefined ? null : asObject(output.portal, `${label}.output.portal`);
  const fee =
    output.fee === undefined || output.fee === null
      ? null
      : asObject(output.fee, `${label}.output.fee`);

  return {
    id: asString(rule.id, `${label}.id`),
    kind,
    trigger: parseTrigger(rule.trigger, `${label}.trigger`, legacyConditionalFields),
    name:
      optionalString(output, "permit_name") ??
      optionalString(output, "requirement_name") ??
      optionalString(output, "advisory_text") ??
      optionalString(output, "note_text"),
    agency: optionalString(output, "agency"),
    publishedDisposition:
      publishedDisposition === null ? null : (PUBLISHED_DISPOSITIONS[publishedDisposition] ?? null),
    deadline,
    levelBinding:
      deadline?.type === "published_minimum_by_level"
        ? parseLevelBinding(
            asObject(output.deadline, `${label}.output.deadline`),
            deadline.levels,
            intakeFields,
            `${label}.output.deadline`,
            legacy,
          )
        : null,
    feeDisplay: fee === null ? null : optionalString(fee, "display"),
    portalName: portal === null ? null : optionalString(portal, "name"),
    portalUrl: portal === null ? null : optionalString(portal, "url"),
    // A portal without a URL publishes its filing route here (precinct, form number); it is
    // regulatory content and is carried like any other published field.
    portalInstructions: portal === null ? null : optionalString(portal, "instructions"),
    noteText: optionalString(output, "note_text"),
    notes: optionalStringArray(output, "notes", `${label}.output.notes`),
    dedupeKey: optionalString(output, "dedupe_key"),
    verificationStatus,
    verificationQualification: optionalString(verification, "qualification"),
    verificationLastVerifiedDate: optionalString(verification, "last_verified_date"),
    source: parseSource(rule.source, `${label}.source`),
  };
}

function parseIntakeField(value: unknown, label: string): IntakeFieldDefinition {
  const definition = asObject(value, label);
  const values = definition.values;
  return {
    field: asString(definition.field, `${label}.field`),
    type: asString(definition.type, `${label}.type`),
    values:
      values === undefined
        ? null
        : asArray(values, `${label}.values`).map((entry, index) =>
            asString(entry, `${label}.values[${index}]`),
          ),
    askedWhen: optionalString(definition, "asked_when"),
    // Parsed below, once every field is known: a clause can name any declared field or value.
    askedWhenClauses: null,
    nullable: definition.nullable === true,
  };
}

/**
 * Validate every `asked_when` expression while the ruleset loads, so a malformed one aborts boot
 * instead of quietly putting a field out of scope. A scoping typo is silent by nature: the clause
 * reads false, the field and every rule depending on it drop out, and the plan omits requirements
 * with no error at all.
 */
function withParsedScoping(
  fields: readonly IntakeFieldDefinition[],
): readonly IntakeFieldDefinition[] {
  const parsed = fields.map((field) => {
    if (field.askedWhen === null) return field;
    try {
      return { ...field, askedWhenClauses: parseAskedWhen(field.askedWhen, fields) };
    } catch (error) {
      return fail(
        `intake field "${field.field}" has an unusable asked_when: ` +
          `${error instanceof Error ? error.message : String(error)}`,
      );
    }
  });
  rejectScopingCycles(parsed);
  return parsed;
}

/**
 * A scoping cycle parses one clause at a time perfectly well, so it only surfaces when evaluation
 * first resolves one of the fields involved — by which point the api has started and every plan
 * request fails instead of the artifact being refused. The graph is walked here so a cyclic
 * ruleset never boots.
 */
function rejectScopingCycles(fields: readonly IntakeFieldDefinition[]): void {
  const dependencies = new Map(
    fields.map((field) => [
      field.field,
      (field.askedWhenClauses ?? []).map((clause) => clause.field),
    ]),
  );
  const settled = new Set<string>();

  const walk = (field: string, path: readonly string[]): void => {
    if (settled.has(field)) return;
    const cycleAt = path.indexOf(field);
    if (cycleAt !== -1) {
      fail(`asked_when scoping is cyclic: ${[...path.slice(cycleAt), field].join(" → ")}`);
    }
    for (const dependency of dependencies.get(field) ?? []) walk(dependency, [...path, field]);
    settled.add(field);
  };

  for (const field of dependencies.keys()) walk(field, []);
}

/** Narrow parsed ruleset JSON into the engine's typed view. */
export function parseEngineRuleset(value: unknown): EngineRuleset {
  const ruleset = asObject(value, "ruleset");
  const config = asObject(ruleset.config, "ruleset.config");
  const slackWarning = asObject(config.slack_warning_days, "ruleset.config.slack_warning_days");
  const businessDayMath = asObject(config.business_day_math, "ruleset.config.business_day_math");

  const intakeFields = withParsedScoping(
    asArray(ruleset.intake_fields, "ruleset.intake_fields").map((field, index) =>
      parseIntakeField(field, `ruleset.intake_fields[${index}]`),
    ),
  );
  // Looked up before any rule is parsed: a superseded artifact is read under the semantics of
  // its own version, not normalized into this one.
  const legacy =
    PRE_PUBLICATION_FACTS.get(asString(ruleset.ruleset_version, "ruleset.ruleset_version")) ?? null;
  const rules = asArray(ruleset.rules, "ruleset.rules").map((rule, index) =>
    parseRule(rule, `ruleset.rules[${index}]`, intakeFields, legacy),
  );
  const advisories = asArray(ruleset.advisories, "ruleset.advisories").map((rule, index) =>
    parseRule(rule, `ruleset.advisories[${index}]`, intakeFields, legacy),
  );

  const declaredFields = new Set(intakeFields.map((field) => field.field));
  const published = [...rules, ...advisories];
  for (const rule of published) {
    for (const field of triggerFields(rule.trigger)) {
      if (!declaredFields.has(field))
        fail(`rule ${rule.id} references undeclared field "${field}"`);
    }
  }
  rejectMixedDedupeVerificationStatuses(published);
  rejectUnconsumedFields(intakeFields, published);

  return {
    rulesetVersion: asString(ruleset.ruleset_version, "ruleset.ruleset_version"),
    jurisdiction: asString(ruleset.jurisdiction, "ruleset.jurisdiction"),
    snapshotDate: asString(ruleset.snapshot_date, "ruleset.snapshot_date"),
    slackWarningDays: asNumber(slackWarning.value, "ruleset.config.slack_warning_days.value"),
    calendarId: asString(businessDayMath.calendar, "ruleset.config.business_day_math.calendar"),
    intakeFields,
    rules: [...rules, ...advisories],
  };
}

function rejectMixedDedupeVerificationStatuses(published: readonly EngineRule[]): void {
  const statusByDedupeKey = new Map<string, VerificationStatus>();
  for (const rule of published) {
    if (rule.dedupeKey === null) continue;
    const status = statusByDedupeKey.get(rule.dedupeKey);
    if (status !== undefined && status !== rule.verificationStatus) {
      fail(
        `dedupe key "${rule.dedupeKey}" mixes verification statuses ` +
          `"${status}" and "${rule.verificationStatus}"`,
      );
    }
    statusByDedupeKey.set(rule.dedupeKey, rule.verificationStatus);
  }
}

/**
 * Intake fields the ruleset declares but nothing consumes: questions an organizer is asked whose
 * answer changes no output.
 *
 * Boot already refused a trigger naming an undeclared field. The reverse went unchecked, which is
 * how seven declared-but-unconsumed fields stayed invisible until someone counted by hand. A field
 * counts as consumed when a rule trigger reads it, when a deadline resolves against it, or when it
 * scopes another question whose answer is itself consumed.
 *
 * Everything else needs a reason here. Each entry is a field the published ruleset declares and no
 * rule acts on, recorded rather than deleted: removing a published intake field is a rules-owner
 * change, and one of these is an open product question. A NEW unconsumed field fails the load.
 */
export const UNCONSUMED_INTAKE_FIELDS: Readonly<Record<string, string>> = {
  borough: "Display and future jurisdiction routing (F-207). No NYC rule varies by borough today.",
  food_affinity_private_exception_claimed:
    "Collected for the Health Code Art. 88 private-function exemption, which DOHMH-EXEMPTION-001 " +
    "renders as an advisory on event_open_to_public alone. Open on issue #194.",
  venue_has_assembly_approval:
    "Confirms only that an assembly approval exists; it cannot establish whether the current PACO " +
    "and PA permit cover the event's exact space, use, occupancy, and layout. Whether exact coverage " +
    "removes the temporary filing is not published either way; confirm with DOB. Inconsistent " +
    "conditions require amendment or separate authorization. No published rule consumes this " +
    "coarse field, so answering it changes no output; objective coverage-specific input and rule " +
    "modeling is open on issue #188.",
};

/**
 * The intake fields the published deadlines read.
 *
 * Reads the binding rather than inferring one. Since nyc.v2.4 a by-level deadline names the fields
 * it keys on, and for the superseded versions that did not the loader supplies them from its closed
 * compatibility record; either way `parseRule` has already resolved and validated the pair before
 * this guard runs. Inferring it a second time here would be a second answer that can drift from the
 * one the evaluator uses, which is how a loader comes to accept an artifact the evaluator cannot
 * run.
 */
function deadlineConsumedFields(published: readonly EngineRule[]): Set<string> {
  // Every backward date is counted from the event date, whatever the deadline type.
  const consumed = new Set<string>([EVENT_DATE_FIELD]);

  for (const rule of published) {
    if (rule.levelBinding === null) continue;
    consumed.add(rule.levelBinding.levelField);
    consumed.add(rule.levelBinding.multiBlockField);
  }

  return consumed;
}

function rejectUnconsumedFields(
  intakeFields: readonly IntakeFieldDefinition[],
  published: readonly EngineRule[],
): void {
  const consumed = new Set<string>([
    ...published.flatMap((rule) => triggerFields(rule.trigger)),
    ...deadlineConsumedFields(published),
    ...intakeFields.flatMap((field) =>
      (field.askedWhenClauses ?? []).map((clause) => clause.field),
    ),
  ]);

  for (const { field } of intakeFields) {
    if (consumed.has(field)) continue;
    if (UNCONSUMED_INTAKE_FIELDS[field] !== undefined) continue;
    fail(
      `intake field "${field}" is declared but no rule trigger, deadline, or scoping condition ` +
        `reads it, so answering it changes nothing. Give a rule that consumes it, or record why ` +
        `it is collected in UNCONSUMED_INTAKE_FIELDS.`,
    );
  }

  // A stale exemption is its own drift: once a rule consumes the field, the entry must go, or the
  // list slowly becomes a place where real findings hide.
  for (const field of Object.keys(UNCONSUMED_INTAKE_FIELDS)) {
    if (consumed.has(field)) {
      fail(
        `intake field "${field}" is now consumed by the ruleset; remove its ` +
          `UNCONSUMED_INTAKE_FIELDS entry`,
      );
    }
  }
}

/** Every intake field a trigger tree reads. */
export function triggerFields(node: TriggerNode): string[] {
  if ("field" in node) return [node.field];
  const children = "all" in node ? node.all : node.any;
  return children.flatMap(triggerFields);
}
