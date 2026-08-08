// What the draft publishes, re-derived by parsing it rather than by reading it.
//
// Every claim in the document that counts something about the draft comes from here: deadline
// windows, permit names, which outputs are byte-identical, which rules read a fuel field, which
// rules are blockers, which dedupe groups mix verification statuses.

import { multiMemberGroups, triggerOperators } from "./harness.mjs";

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
    unreadFields: Object.keys(output).filter((key) => !PARSER_READ_OUTPUT_FIELDS.has(key)),
  };
}

/** The `output` keys `parseRule` (`packages/engine/src/ruleset.ts:484-520`) reads. */
const PARSER_READ_OUTPUT_FIELDS = new Set([
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
  "conflict_text",
]);
