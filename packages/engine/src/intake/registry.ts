// The intake contract, derived from the published ruleset.
//
// `rules/nyc-rules.v2.10.json` owns the field list, the enums, and the asked-when
// conditions (AGENTS.md "Shared contracts"; ARCHITECTURE.md events table). Nothing here
// restates them: this module parses the registry and the `asked_when` expressions into
// a structure the API and the UI both consume, so there is exactly one copy of the
// contract in the repository.
//
// Pure by construction (AGENTS.md "Engine invariants"): the caller supplies the parsed
// ruleset; this module reads no file, clock, or environment.

import { parseAskedWhen as parseAskedWhenExpression } from "../conditions";
import type { AskedWhenClause } from "../types";

export type IntakeFieldType = "enum" | "multi_enum" | "boolean" | "integer" | "number" | "date";

export type IntakeField = {
  readonly field: string;
  readonly type: IntakeFieldType;
  /** Allowed values for `enum` / `multi_enum`; null for the scalar types. */
  readonly values: readonly string[] | null;
  /** The registry's `nullable` flag: the question may be asked and left blank. */
  readonly nullable: boolean;
  /** The registry's published note, rendered verbatim as help text. */
  readonly note: string | null;
  /** Empty when the field is always asked. Parsed by the engine's one `asked_when` parser. */
  readonly askedWhen: readonly AskedWhenClause[];
  /** The raw `asked_when` expression, quoted back in validation messages. */
  readonly askedWhenSource: string | null;
};

export type IntakeRegistry = readonly IntakeField[];

/**
 * A notice quoted from a published rule. The verification status travels with the text
 * so it stays visible end to end (AGENTS.md "Regulatory safety"): a COVERAGE_GAP warning
 * must never be rendered as though it were SOURCE_CONFIRMED.
 */
export type PublishedNotice = {
  readonly ruleId: string;
  readonly text: string;
  readonly verificationStatus: string;
};

/**
 * Everything intake needs from the ruleset: the field registry plus the two published
 * notices the intake screen renders inline (F-101 spec #4 and #5). They are looked up by
 * rule id so the wording and the status stay the ruleset's, never ours.
 */
export type IntakeContract = {
  readonly fields: IntakeRegistry;
  readonly blockPartyEligibilityNotice: PublishedNotice;
  readonly alcoholInPublicSpaceNotice: PublishedNotice;
};

const BLOCK_PARTY_ELIGIBILITY_RULE_ID = "SAPO-BLOCK-PARTY-ELIG-001";
const ALCOHOL_IN_PUBLIC_SPACE_ADVISORY_ID = "ADV-ALCOHOL-PUBLIC-001";

const FIELD_TYPES = new Set<string>(["enum", "multi_enum", "boolean", "integer", "number", "date"]);
const ENUMERATED_TYPES = new Set<IntakeFieldType>(["enum", "multi_enum"]);

function contractError(message: string): never {
  throw new Error(`Intake contract invalid: ${message}`);
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    contractError(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function asArray(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) contractError(`${label} must be an array`);
  return value;
}

function optionalString(source: Record<string, unknown>, key: string): string | null {
  const value = source[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

/** A declared field, before its `asked_when` expression is resolved against the others. */
type PartialField = Omit<IntakeField, "askedWhen" | "askedWhenSource">;

function parseField(entry: unknown, label: string): PartialField {
  const source = asRecord(entry, label);
  const field = optionalString(source, "field");
  if (field === null) contractError(`${label}.field must be a non-empty string`);
  const type = optionalString(source, "type");
  if (type === null || !FIELD_TYPES.has(type)) {
    contractError(`${label}.type has unsupported value "${String(source.type)}"`);
  }
  const fieldType = type as IntakeFieldType;

  let values: readonly string[] | null = null;
  if (ENUMERATED_TYPES.has(fieldType)) {
    values = asArray(source.values, `${label}.values`).map((value, index) => {
      if (typeof value !== "string" || value.length === 0) {
        contractError(`${label}.values[${index}] must be a non-empty string`);
      }
      return value;
    });
    if (values.length === 0) contractError(`${label}.values must not be empty`);
  }

  return {
    field,
    type: fieldType,
    values,
    nullable: source.nullable === true,
    note: optionalString(source, "note"),
  };
}

/**
 * `asked_when` is parsed by the engine's parser, not a second one here.
 *
 * The questionnaire and the rules engine were each reading the same expression grammar with
 * their own code, which is how they came to disagree: the engine typed a comparison operand to
 * the field ("food_present = true" yields a boolean) while this side kept the raw string, so a
 * field the engine considered in scope was a question the questionnaire hid — the user unable to
 * answer something the engine expected an answer for. One parsed representation removes the class
 * rather than the instance.
 */
function parseAskedWhen(
  expression: unknown,
  fields: readonly PartialField[],
  label: string,
): { terms: readonly AskedWhenClause[]; source: string | null } {
  if (expression === undefined) return { terms: [], source: null };
  if (typeof expression !== "string" || expression.length === 0) {
    contractError(`${label}.asked_when must be a non-empty string`);
  }
  try {
    return { terms: parseAskedWhenExpression(expression, fields), source: expression };
  } catch (error) {
    return contractError(
      `${label}.asked_when is unusable: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function publishedNotice(ruleset: Record<string, unknown>, ruleId: string): PublishedNotice {
  const published = [
    ...asArray(ruleset.rules, "ruleset.rules"),
    ...asArray(ruleset.advisories, "ruleset.advisories"),
  ]
    .map((rule, index) => asRecord(rule, `ruleset rule[${index}]`))
    .find((rule) => rule.id === ruleId);
  if (published === undefined) contractError(`ruleset does not publish ${ruleId}`);

  const output = asRecord(published.output, `${ruleId}.output`);
  const text = optionalString(output, "note_text") ?? optionalString(output, "advisory_text");
  if (text === null) contractError(`${ruleId} publishes no note_text or advisory_text`);

  const verification = asRecord(published.verification, `${ruleId}.verification`);
  const verificationStatus = optionalString(verification, "status");
  if (verificationStatus === null) {
    contractError(`${ruleId}.verification.status must be a non-empty string`);
  }
  return { ruleId, text, verificationStatus };
}

/** Parse the ruleset's intake registry and the inline notices intake renders. */
export function parseIntakeContract(ruleset: unknown): IntakeContract {
  const source = asRecord(ruleset, "ruleset");
  const entries = asArray(source.intake_fields, "ruleset.intake_fields");
  const declared = entries.map((entry, index) =>
    parseField(entry, `ruleset.intake_fields[${index}]`),
  );

  const names = new Set(declared.map((field) => field.field));
  if (names.size !== declared.length) contractError("intake field names must be unique");

  const fields = declared.map((field, index) => {
    const { terms, source: expression } = parseAskedWhen(
      asRecord(entries[index], `ruleset.intake_fields[${index}]`).asked_when,
      declared,
      `ruleset.intake_fields[${index}]`,
    );
    return { ...field, askedWhen: terms, askedWhenSource: expression };
  });

  return {
    fields,
    blockPartyEligibilityNotice: publishedNotice(source, BLOCK_PARTY_ELIGIBILITY_RULE_ID),
    alcoholInPublicSpaceNotice: publishedNotice(source, ALCOHOL_IN_PUBLIC_SPACE_ADVISORY_ID),
  };
}
