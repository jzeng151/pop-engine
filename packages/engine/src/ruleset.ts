// Narrows the published ruleset JSON into the typed shape the engine evaluates.

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
  RuleUserSummary,
  SummarySourceLink,
  TriggerNode,
  UserSummaryPoint,
  UserSummaryPointKind,
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

/** What a published ruleset from before nyc.v2.4 relied on the engine to supply. */
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

/** Whether the published number is an inclusive or exclusive bound. */
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

/** The intake fields a by-level deadline keys on, as the rule declares them. */
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
  // The resolver reads the answer as a single level (`deadline.levels[answer]`), so a field that can answer with several has no level to resolve.
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
  // Same rule again, on the other half: the resolver must be able to honour every level the rule publishes.
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

const USER_SUMMARY_POINT_KINDS: readonly UserSummaryPointKind[] = [
  "overview",
  "deadline",
  "fee",
  "action",
  "warning",
];

function parseSummarySource(
  value: unknown,
  label: string,
  source: RuleSource | null,
): SummarySourceLink {
  const link = asObject(value, label);
  const url = asString(link.url, `${label}.url`);
  if (source === null || !source.urls.includes(url)) {
    fail(`${label}.url must also appear in the rule's source.urls`);
  }
  return { label: asString(link.label, `${label}.label`), url };
}

function parseUserSummary(
  value: unknown,
  label: string,
  source: RuleSource | null,
): RuleUserSummary | null {
  if (value === undefined) return null;
  const summary = asObject(value, label);
  const points = asArray(summary.points, `${label}.points`);
  if (points.length === 0) fail(`${label}.points must not be empty`);
  return {
    heading: asString(summary.heading, `${label}.heading`),
    points: points.map((value, index): UserSummaryPoint => {
      const pointLabel = `${label}.points[${index}]`;
      const point = asObject(value, pointLabel);
      const kind = asString(point.kind, `${pointLabel}.kind`) as UserSummaryPointKind;
      if (!USER_SUMMARY_POINT_KINDS.includes(kind)) {
        fail(`${pointLabel}.kind has unsupported value "${kind}"`);
      }
      const sources = asArray(point.sources, `${pointLabel}.sources`).map((link, sourceIndex) =>
        parseSummarySource(link, `${pointLabel}.sources[${sourceIndex}]`, source),
      );
      if (source !== null && sources.length === 0) {
        fail(`${pointLabel}.sources must not be empty for a sourced rule`);
      }
      return {
        kind,
        text: asString(point.text, `${pointLabel}.text`),
        sources,
      };
    }),
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
  const source = parseSource(rule.source, `${label}.source`);

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
    source,
    userSummary: parseUserSummary(output.user_summary, `${label}.output.user_summary`, source),
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

/** Validate every `asked_when` expression while the ruleset loads, so a malformed one aborts boot instead of quietly putting a field out of scope. */
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

/** A scoping cycle parses one clause at a time perfectly well, so it only surfaces when evaluation first resolves one of the fields involved — by which point the api has started and every plan request fails instead of the artifact being refused. */
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
  const rulesetVersion = asString(ruleset.ruleset_version, "ruleset.ruleset_version");

  const intakeFields = withParsedScoping(
    asArray(ruleset.intake_fields, "ruleset.intake_fields").map((field, index) =>
      parseIntakeField(field, `ruleset.intake_fields[${index}]`),
    ),
  );
  // Looked up before any rule is parsed: a superseded artifact is read under the semantics of
  // its own version, not normalized into this one.
  const legacy = PRE_PUBLICATION_FACTS.get(rulesetVersion) ?? null;
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
  rejectUnconsumedFields(intakeFields, published, rulesetVersion);

  return {
    rulesetVersion,
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

/** Intake fields the ruleset declares but nothing consumes: questions an organizer is asked whose answer changes no output. */
export const UNCONSUMED_INTAKE_FIELDS: Readonly<Record<string, string>> = {
  borough: "Display and future jurisdiction routing (F-207). No NYC rule varies by borough today.",
  venue_paco_covers_exact_event:
    "Confirmation-only F-110 input. No published rule consumes it or supports an inference that " +
    "an exact PACO match removes a temporary filing.",
  venue_fdny_pa_permit_current_for_event_space:
    "Confirmation-only F-110 input. No published rule consumes it or supports an inference that " +
    "a current FDNY Public Assembly Permit removes a temporary filing.",
};

// Replay keeps the intake contract a plan originally stored.
const RETIRED_UNCONSUMED_INTAKE_FIELDS = new Set([
  "food_affinity_private_exception_claimed",
  "venue_has_assembly_approval",
]);
const RULESET_VERSIONS_WITH_RETIRED_INTAKE_FIELDS = new Set([
  "nyc.v2.1",
  "nyc.v2.2",
  "nyc.v2.3",
  "nyc.v2.4",
  "nyc.v2.5",
  "nyc.v2.6",
  "nyc.v2.7",
  "nyc.v2.8",
]);

/** The intake fields the published deadlines read. */
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
  rulesetVersion: string,
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
    if (
      RULESET_VERSIONS_WITH_RETIRED_INTAKE_FIELDS.has(rulesetVersion) &&
      RETIRED_UNCONSUMED_INTAKE_FIELDS.has(field)
    )
      continue;
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
