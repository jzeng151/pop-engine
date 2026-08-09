// What the draft publishes, re-derived by parsing it rather than by reading it.
//
// Every claim in the document that counts something about the draft comes from here: deadline
// windows, permit names, which outputs are byte-identical, which rules read a fuel field, which
// rules are blockers, which dedupe groups mix verification statuses.

import { DISPOSITION_STRENGTH } from "../../packages/engine/src/findings.ts";
import { DEFAULT_DISPOSITION_BY_RULE_KIND } from "../../packages/engine/src/proposals.ts";

import {
  buildFieldDefinitions,
  domainFor,
  multiMemberGroups,
  sweepSize,
  triggerOperators,
} from "./harness.mjs";

const published = (draft) => [...draft.rules, ...draft.advisories];

const membersOf = (draft, dedupeKey) =>
  published(draft).filter((rule) => rule.output?.dedupe_key === dedupeKey);

/** The output objects of a group, serialised, so "byte-identical" is a comparison and not a read. */
export function distinctOutputs(draft, dedupeKey) {
  const serialised = membersOf(draft, dedupeKey).map((rule) => {
    const { dedupe_key: _ignored, ...rest } = rule.output;
    return JSON.stringify(rest);
  });
  return new Set(serialised);
}

/** Output fields that are byte-identical across every member of a group. */
export function sharedOutputFields(draft, dedupeKey) {
  const members = membersOf(draft, dedupeKey);
  const [first] = members;
  return Object.keys(first.output)
    .filter((key) => key !== "dedupe_key")
    .filter((key) =>
      members.every(
        (rule) => JSON.stringify(rule.output[key]) === JSON.stringify(first.output[key]),
      ),
    );
}

/** The field types that multiply out, for section 3.3's opening figures. */
const FACTORIAL_TYPES = new Set(["enum", "boolean", "multi_enum"]);

/**
 * The declared intake surface of an artifact, for section 3.3's opening figures: how many fields it
 * declares, how many of each type, and how many valid intakes its enum, boolean and multi_enum
 * fields admit.
 *
 * The count is built by the two rules section 3.3 states for every other sweep, and by calling the
 * same code rather than a parallel implementation of them:
 *
 *   - each field's domain is `domainFor`'s, so a multi_enum contributes its valid selections rather
 *     than its power set, and an enum or boolean contributes `null` only where it is nullable;
 *   - a field the event is not asked is omitted and contributes one value rather than its whole
 *     domain, because `validateIntake` rejects a supplied value for an out-of-scope field.
 *
 * The second rule is why this is not one product. A gated field's size depends on the answers that
 * gate it, so the gated fields and every field their `asked_when` clauses read are counted together
 * by running `sweepSize` over exactly that set, which is `enumerateIntakes` and therefore the same
 * scope resolution the group sweeps use. The remaining fields are independent of the gates and
 * multiply in as constant factors. It is a `BigInt` because the value exceeds an exact double.
 *
 * Neither rule makes the count a count of reachable events, and `combinations` is not one. Some of
 * these fields are marked `derived: true`, which means their values are produced from raw answers
 * by a classifier the draft publishes as prose rather than as an algorithm, so multiplying their
 * declared enums in independently admits classification combinations that may be jointly
 * unreachable. That is limitation 9's defect, and it applies to this figure exactly as it applies
 * to the three group sweeps there. Both figures are therefore returned: `combinations`, an upper
 * bound over every one of these fields, and `combinationsAnswered`, the product over only the
 * fields an organizer answers, which is the one that is a size of the intake contract.
 * `derivedFactorialFields` names the difference, read off the artifact's flags.
 *
 * An unused intake field the draft adds or drops moves `fields`, `byType` and both counts, and so
 * does an `asked_when` the draft adds, widens or withdraws, and so does a `derived` flag the draft
 * lands or withdraws, so the section's inventory cannot go stale while the suite stays green.
 */
export function intakeFieldInventory(artifact) {
  const byType = {};
  for (const field of artifact.intake_fields) {
    byType[field.type] = (byType[field.type] ?? 0) + 1;
  }

  const definitions = new Map(
    buildFieldDefinitions(artifact, { translateAskedWhen: true }).map((field) => [
      field.field,
      field,
    ]),
  );
  const factorial = artifact.intake_fields
    .filter((field) => FACTORIAL_TYPES.has(field.type))
    .map((field) => field.field);
  const derived = factorial.filter((field) => definitions.get(field).derived);

  return {
    fields: artifact.intake_fields.length,
    byType,
    factorialFields: factorial.length,
    derivedFactorialFields: derived,
    combinations: factorialCombinations(factorial, definitions),
    combinationsAnswered: factorialCombinations(
      factorial.filter((field) => !derived.includes(field)),
      definitions,
    ),
  };
}

/** The combinations a set of enum, boolean and multi_enum fields admits, under both 3.3 rules. */
function factorialCombinations(factorial, definitions) {
  const conditional = new Set();
  const pending = factorial.filter((field) => definitions.get(field).askedWhenClauses !== null);
  while (pending.length > 0) {
    const field = pending.pop();
    if (conditional.has(field)) continue;
    conditional.add(field);
    for (const clause of definitions.get(field).askedWhenClauses ?? []) {
      // A gate that reads a field this count does not range over is held unanswered, which is the
      // same convention the group sweeps apply to fields outside their own set. Both of the draft's
      // gates read fields that are inside, so the draft's figure never rests on it; the published
      // control's one gate reads `headcount`, which is not, and is why this is a skip and not a
      // failure. `gatesReadOutsideTheCount` reports the difference and the suite asserts it.
      if (factorial.includes(clause.field)) pending.push(clause.field);
    }
  }

  let combinations = BigInt(sweepSize([...conditional], definitions, []));
  for (const field of factorial) {
    if (conditional.has(field)) continue;
    combinations *= BigInt(domainFor(field, definitions.get(field), []).length);
  }
  return combinations;
}

/**
 * Gates that read a field `intakeFieldInventory` does not range over, as `field -> gate field`.
 *
 * Empty for the draft, which is what makes its published count a statement about the intake
 * contract rather than one resting on a field held unanswered outside the count.
 */
export function gatesReadOutsideTheCount(artifact) {
  const counted = new Set(
    artifact.intake_fields.filter((field) => FACTORIAL_TYPES.has(field.type)).map((f) => f.field),
  );
  return buildFieldDefinitions(artifact, { translateAskedWhen: true })
    .filter((field) => counted.has(field.field) && field.askedWhenClauses !== null)
    .flatMap((field) =>
      field.askedWhenClauses
        .filter((clause) => !counted.has(clause.field))
        .map((clause) => ({ field: field.field, gateField: clause.field })),
    );
}

export function sapoPermitInventory(draft) {
  const members = membersOf(draft, "sapo_permit");
  const deadlineTypes = {};
  for (const rule of members) {
    const type = rule.output.deadline?.type ?? "none";
    deadlineTypes[type] = (deadlineTypes[type] ?? 0) + 1;
  }
  return {
    members: members.length,
    calendarDayValues: members
      .filter((rule) => rule.output.deadline?.type === "published_minimum")
      .map((rule) => ({ id: rule.id, calendarDays: rule.output.deadline.calendar_days })),
    deadlineTypes,
    permitNames: [...new Set(members.map((rule) => rule.output.permit_name))],
    sharedFields: sharedOutputFields(draft, "sapo_permit"),
  };
}

/** Every rule whose trigger reads a fuel field, directly or through a derived value. */
export function fuelFieldReaders(draft) {
  const derivedFromFuel = new Set(
    draft.derived_values
      .filter((value) => /fuel_types|open_flame_types/.test(value.formula))
      .map((value) => value.name),
  );
  const named = new Set(["fuel_types", "open_flame_types", ...derivedFromFuel]);
  return published(draft)
    .filter((rule) => triggerOperators(rule.trigger).some((leaf) => named.has(leaf.field)))
    .map((rule) => ({ id: rule.id, dedupeKey: rule.output?.dedupe_key ?? null }));
}

/** Every operator any trigger applies to a numeric field, for limitation 3. */
export function numericOperators(draft) {
  const numericFields = new Set(
    draft.intake_fields
      .filter((field) => field.type === "integer" || field.type === "number")
      .map((field) => field.field),
  );
  for (const derived of draft.derived_values) {
    if (/\*|inclusive_days|business_days_between/.test(derived.formula))
      numericFields.add(derived.name);
  }
  const operators = new Set();
  for (const rule of published(draft)) {
    for (const leaf of triggerOperators(rule.trigger)) {
      if (numericFields.has(leaf.field)) operators.add(leaf.op);
    }
  }
  return [...operators].sort();
}

/** Every derived value any trigger reads, for limitation 4. */
export function derivedValuesRead(draft) {
  const declared = new Set(draft.derived_values.map((value) => value.name));
  const read = new Set();
  for (const rule of published(draft)) {
    for (const leaf of triggerOperators(rule.trigger)) {
      if (declared.has(leaf.field)) read.add(leaf.field);
    }
  }
  return [...read];
}

/** Every rule the draft publishes as a blocker, with its kind and dedupe group. */
export function blockingRules(draft) {
  return published(draft)
    .filter((rule) => rule.severity === "blocking" || rule.output?.severity === "blocking")
    .map((rule) => ({
      id: rule.id,
      kind: rule.kind,
      dedupeKey: rule.output.dedupe_key ?? null,
      members:
        rule.output.dedupe_key === undefined ? 1 : membersOf(draft, rule.output.dedupe_key).length,
    }));
}

/**
 * Dedupe groups whose members publish more than one verification status.
 *
 * These are the groups `rejectMixedDedupeVerificationStatuses` (`ruleset.ts:665`) can fail a load
 * on. Derived by grouping on `output.dedupe_key` and counting distinct `verification.status`.
 */
export function mixedStatusGroups(draft) {
  return multiMemberGroups(draft)
    .map((group) => ({
      key: group.key,
      statuses: [...new Set(group.members.map((rule) => rule.verification.status))].sort(),
    }))
    .filter((group) => group.statuses.length > 1);
}

/** What the draft's own `engine_operators` array publishes, and what it publishes about each. */
export function operatorSemantics(draft) {
  const text = JSON.stringify({ ...draft, rules: null, advisories: null });
  return draft.engine_operators.map((name) => ({
    name,
    // A published semantic would have to say something about the operator beyond listing its name.
    describedOutsideTheList: text.split(`"${name}"`).length - 1 > 1,
  }));
}

/**
 * What `parseRule` would make of a rule's output: the name it derives and whether it publishes a
 * disposition. A draft field the parser does not read cannot reach a merged plan item.
 */
export function parserVisibleOutput(draft, ruleId) {
  const rule = published(draft).find((entry) => entry.id === ruleId);
  const output = rule.output;
  return {
    id: rule.id,
    kind: rule.kind,
    name:
      output.permit_name ??
      output.requirement_name ??
      output.advisory_text ??
      output.note_text ??
      null,
    publishedDisposition: output.disposition ?? null,
    // What the finding actually carries: the published disposition where there is one, and
    // otherwise the engine's own default for the rule's kind. Read from the engine's table rather
    // than restated, so a rule kind the draft moves, or a default the engine changes, moves the
    // document's account of which route binds a merged line instead of leaving it stale.
    effectiveDisposition: output.disposition ?? DEFAULT_DISPOSITION_BY_RULE_KIND[rule.kind],
    unreadFields: Object.keys(output).filter((key) => !PARSER_READ_OUTPUT_FIELDS.has(key)),
  };
}

/** Which of two rules' dispositions binds a merged line's identity, per `DISPOSITION_STRENGTH`. */
export function strongerDisposition(left, right) {
  return DISPOSITION_STRENGTH.indexOf(left) >= DISPOSITION_STRENGTH.indexOf(right) ? left : right;
}

/** The fields each member of a dedupe group reads, in walk order, without expanding derived values. */
export function triggerFieldsByMember(draft, dedupeKey) {
  return membersOf(draft, dedupeKey).map((rule) => ({
    id: rule.id,
    fields: [...new Set(triggerOperators(rule.trigger).map((leaf) => leaf.field))],
  }));
}

/**
 * The `output` keys `parseRule` (`packages/engine/src/ruleset.ts:484-545`) reads.
 *
 * Every entry is one `optionalString(output, ...)`, `output.<key>` or `optionalStringArray` call in
 * that range, checked against the parser rather than recalled. `conflict_text` is not among them:
 * a finding's `conflictText` is derived from `noteText` at an `OFFICIAL_CONFLICT` status
 * (`apps/web/app/checklist/checklist-fixtures.ts:121`), and no ruleset field feeds it.
 */
const PARSER_READ_OUTPUT_FIELDS = new Set([
  "agency",
  "disposition",
  "deadline",
  "portal",
  "fee",
  "permit_name",
  "requirement_name",
  "advisory_text",
  "note_text",
  "notes",
  "dedupe_key",
  "user_summary",
]);
