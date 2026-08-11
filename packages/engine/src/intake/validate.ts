// Intake validation: types, applicability, contradictions, and the inline notices.

import type { IntakeContract, IntakeField, PublishedNotice } from "./registry";
import { askedFieldNames, type IntakeAnswers, type IntakeValue } from "./visibility";

export type IntakeIssue = {
  readonly field: string;
  readonly code: string;
  readonly message: string;
  /** Set when the message is quoted from a published rule, so the rule id and its
   * verification status stay visible wherever the issue is rendered. */
  readonly ruleId?: string;
  readonly verificationStatus?: string;
};

export type IntakeRecord = Readonly<Record<string, IntakeValue>>;

export type IntakeValidation = {
  /** The full event row to persist, or null when `errors` is non-empty. */
  readonly values: IntakeRecord | null;
  readonly errors: readonly IntakeIssue[];
  readonly warnings: readonly IntakeIssue[];
};

/**
 * Columns the `events` table carries that the ruleset does not declare, because they
 * hold no regulatory meaning (ARCHITECTURE.md events table: Identity, Scale + date).
 * `capacity` is the confirmed venue capacity for F-402, not the headcount.
 */
const DESCRIPTIVE_FIELDS = [
  { field: "name", type: "text", required: true },
  { field: "location_name", type: "text", required: false },
  { field: "capacity", type: "positive_integer", required: false },
] as const;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
/** The exclusive option a multi-enum uses for "none of these" (mirrors the CHECK constraint). */
const EXCLUSIVE_OPTION = "none";

const issue = (field: string, code: string, message: string): IntakeIssue => ({
  field,
  code,
  message,
});

/** An issue whose text is a published rule's, carrying that rule's verification status. */
const noticeIssue = (field: string, code: string, notice: PublishedNotice): IntakeIssue => ({
  field,
  code,
  message: notice.text,
  ruleId: notice.ruleId,
  verificationStatus: notice.verificationStatus,
});

function isIsoDate(value: string): boolean {
  if (!ISO_DATE.test(value)) return false;
  // "2026-13-01" matches the shape but parses to an Invalid Date, and "2026-02-30"
  // parses to a different day: both are field errors, never a thrown RangeError.
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().startsWith(value);
}

/** Every registry number is a count or a physical quantity (vendors, square feet, days, feet, gallons, kW, kWh), so a negative answer is not a smaller value — it is not an answer. */
const negativeMessage = (field: string): string => `${field} cannot be negative`;

/** Coerce one submitted value against its declared type, or describe why it does not fit. */
function readFieldValue(field: IntakeField, raw: unknown): IntakeValue | IntakeIssue {
  const rejected = (message: string): IntakeIssue => issue(field.field, "invalid_value", message);

  switch (field.type) {
    case "enum":
      return typeof raw === "string" && field.values?.includes(raw) === true
        ? raw
        : rejected(`${field.field} must be one of ${field.values?.join(", ")}`);
    case "multi_enum": {
      if (!Array.isArray(raw) || raw.length === 0) {
        return rejected(`${field.field} must select at least one option`);
      }
      const selected = [...new Set(raw)];
      if (
        selected.some(
          (value) => typeof value !== "string" || field.values?.includes(value) !== true,
        )
      ) {
        return rejected(`${field.field} must only contain ${field.values?.join(", ")}`);
      }
      if (selected.includes(EXCLUSIVE_OPTION) && selected.length > 1) {
        return rejected(`${field.field} cannot combine "${EXCLUSIVE_OPTION}" with other options`);
      }
      return selected as readonly string[];
    }
    case "boolean":
      return typeof raw === "boolean" ? raw : rejected(`${field.field} must be true or false`);
    case "integer":
      if (!Number.isInteger(raw)) return rejected(`${field.field} must be a whole number`);
      return (raw as number) < 0 ? rejected(negativeMessage(field.field)) : (raw as number);
    case "number":
      if (typeof raw !== "number" || !Number.isFinite(raw)) {
        return rejected(`${field.field} must be a number`);
      }
      return raw < 0 ? rejected(negativeMessage(field.field)) : raw;
    case "date":
      return typeof raw === "string" && isIsoDate(raw)
        ? raw
        : rejected(`${field.field} must be a date (YYYY-MM-DD)`);
  }
}

function readDescriptiveValue(
  descriptive: (typeof DESCRIPTIVE_FIELDS)[number],
  raw: unknown,
): IntakeValue | IntakeIssue {
  if (descriptive.type === "text") {
    return typeof raw === "string" && raw.trim().length > 0
      ? raw.trim()
      : issue(descriptive.field, "invalid_value", `${descriptive.field} must be text`);
  }
  return Number.isInteger(raw) && (raw as number) > 0
    ? (raw as number)
    : issue(
        descriptive.field,
        "invalid_value",
        `${descriptive.field} must be a positive whole number`,
      );
}

const isIssue = (value: IntakeValue | IntakeIssue): value is IntakeIssue =>
  typeof value === "object" && value !== null && !Array.isArray(value) && "code" in value;

const isProvided = (submission: Readonly<Record<string, unknown>>, field: string): boolean =>
  submission[field] !== undefined && submission[field] !== null;

/** The columns an intake record covers: the registry's fields plus the descriptive ones. */
export function intakeColumnNames(contract: IntakeContract): string[] {
  return [
    ...contract.fields.map((field) => field.field),
    ...DESCRIPTIVE_FIELDS.map((field) => field.field),
  ];
}

/** Apply an edit to a stored intake. */
export function mergeIntakeEdit(
  contract: IntakeContract,
  stored: Readonly<Record<string, unknown>>,
  submission: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...stored, ...submission };
  const asked = askedFieldNames(contract.fields, merged as IntakeAnswers);
  for (const field of contract.fields) {
    if (asked.has(field.field) || Object.hasOwn(submission, field.field)) continue;
    merged[field.field] = null;
  }
  return merged;
}

/**
 * Whether two answers to the same question say the same thing. Multi-selects are sets,
 * so the order the options were ticked in is not part of the answer.
 */
function isSameAnswer(left: unknown, right: unknown): boolean {
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) {
      return false;
    }
    const sorted = (values: unknown[]) => [...values].map(String).sort();
    return sorted(left).every((value, index) => value === sorted(right)[index]);
  }
  return (left ?? null) === (right ?? null);
}

/**
 * Whether a validated intake says anything the stored row does not already say.
 *
 * A save that changes no answer is not an edit, so it must not bump the revision
 * counter or make a plan stale (AD-13: the counter increments on an intake edit).
 */
export function isIntakeUnchanged(
  contract: IntakeContract,
  stored: Readonly<Record<string, unknown>>,
  values: IntakeRecord,
): boolean {
  return intakeColumnNames(contract).every((column) =>
    isSameAnswer(stored[column], values[column]),
  );
}

/** The spec's inline warnings for a set of answers. */
export function intakeWarnings(contract: IntakeContract, answers: IntakeAnswers): IntakeIssue[] {
  const warnings: IntakeIssue[] = [];
  const asked = askedFieldNames(contract.fields, answers);
  const applicable = (field: string): IntakeValue =>
    asked.has(field) ? (answers[field] ?? null) : null;

  // Spec #4: a block party that sells or serves alcohol conflicts with block-party eligibility.
  if (
    applicable("sapo_event_type") === "block_party" &&
    (applicable("selling_anything") === true || applicable("alcohol") === true)
  ) {
    warnings.push(
      noticeIssue(
        "sapo_event_type",
        "block_party_eligibility_conflict",
        contract.blockPartyEligibilityNotice,
      ),
    );
  }

  // Spec #5: alcohol in public space is outside this ruleset version's coverage.
  const locationType = applicable("location_type");
  if (
    applicable("alcohol") === true &&
    typeof locationType === "string" &&
    locationType !== "private_venue"
  ) {
    warnings.push(noticeIssue("alcohol", "coverage_gap", contract.alcoholInPublicSpaceNotice));
  }

  return warnings;
}

/**
 * Validate a complete intake submission against the published contract.
 *
 * `today` is an explicit ISO date (the engine never reads the clock) and is only used
 * for the past-date check.
 */
export function validateIntake(
  contract: IntakeContract,
  submission: Readonly<Record<string, unknown>>,
  today: string,
): IntakeValidation {
  const errors: IntakeIssue[] = [];
  const answers: Record<string, IntakeValue> = {};

  const known = new Set<string>([
    ...contract.fields.map((field) => field.field),
    ...DESCRIPTIVE_FIELDS.map((field) => field.field),
  ]);
  for (const key of Object.keys(submission)) {
    if (!known.has(key)) {
      errors.push(issue(key, "unknown_field", `${key} is not an intake field`));
    }
  }

  for (const field of contract.fields) {
    if (!isProvided(submission, field.field)) continue;
    const value = readFieldValue(field, submission[field.field]);
    if (isIssue(value)) errors.push(value);
    else answers[field.field] = value;
  }

  const asked = askedFieldNames(contract.fields, answers);
  for (const field of contract.fields) {
    if (!asked.has(field.field)) {
      if (isProvided(submission, field.field)) {
        errors.push(
          issue(
            field.field,
            "not_applicable",
            `${field.field} is only asked when ${field.askedWhenSource}; remove it or change the answer that triggers it`,
          ),
        );
      }
      continue;
    }
    if (!isProvided(submission, field.field) && !field.nullable) {
      errors.push(issue(field.field, "required", `${field.field} is required for this event`));
    }
  }

  for (const descriptive of DESCRIPTIVE_FIELDS) {
    if (!isProvided(submission, descriptive.field)) {
      if (descriptive.required) {
        errors.push(issue(descriptive.field, "required", `${descriptive.field} is required`));
      }
      continue;
    }
    const value = readDescriptiveValue(descriptive, submission[descriptive.field]);
    if (isIssue(value)) errors.push(value);
    else answers[descriptive.field] = value;
  }

  if (typeof answers.headcount === "number" && answers.headcount <= 0) {
    errors.push(issue("headcount", "must_be_positive", "headcount must be at least 1"));
  }
  if (typeof answers.event_date === "string" && answers.event_date < today) {
    errors.push(issue("event_date", "in_the_past", "event_date must be today or later"));
  }

  const warnings = intakeWarnings(contract, answers);
  if (errors.length > 0) return { values: null, errors, warnings };

  // Un-asked fields persist as NULL: the question was never put to the organizer.
  const values: Record<string, IntakeValue> = {};
  for (const field of contract.fields) values[field.field] = answers[field.field] ?? null;
  for (const descriptive of DESCRIPTIVE_FIELDS) {
    values[descriptive.field] = answers[descriptive.field] ?? null;
  }
  return { values, errors, warnings };
}
