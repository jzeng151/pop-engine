// What the draft publishes, re-derived by parsing it rather than by reading it.

import { DISPOSITION_STRENGTH } from "../../packages/engine/src/findings.ts";
import { DEFAULT_DISPOSITION_BY_RULE_KIND } from "../../packages/engine/src/proposals.ts";
import { parseEngineRuleset } from "../../packages/engine/src/ruleset.ts";

import {
  buildFieldDefinitions,
  domainFor,
  loadControl,
  multiMemberGroups,
  sweepSize,
  triggerOperators,
} from "./harness.mjs";

const published = (draft) => [...draft.rules, ...draft.advisories];

const membersOf = (draft, dedupeKey) =>
  published(draft).filter((rule) => rule.output?.dedupe_key === dedupeKey);

/** Section 1's opening count: every distinct non-null `dedupe_key` the draft publishes, and how many of those groups hold more than one member. */
export function dedupeGroupInventory(artifact) {
  const keys = published(artifact)
    .map((rule) => rule.output?.dedupe_key ?? null)
    .filter((key) => key !== null);
  return { groups: new Set(keys).size, multiMember: multiMemberGroups(artifact).length };
}

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

/** The declared intake surface of an artifact, for section 3.3's opening figures: how many fields it declares, how many of each type, and how many valid intakes its enum, boolean and multi_enum fields admit. */
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
    conditionalFields: artifact.intake_fields
      .filter((field) => field.asked_when != null)
      .map((field) => ({
        field: field.field,
        type: field.type,
        gates: [
          ...new Set(
            (definitions.get(field.field).askedWhenClauses ?? []).map((clause) => clause.field),
          ),
        ],
      })),
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
      // A gate that reads a field this count does not range over is held unanswered, which is the same convention the group sweeps apply to fields outside their own set.
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
    // The fee displays, per member, in rule order.
    fees: members.map((rule) => ({
      id: rule.id,
      eventFeeUsd: rule.output.fee?.event_fee_usd ?? null,
      processingFeeUsd: rule.output.fee?.processing_fee_usd ?? null,
      display: rule.output.fee?.display ?? null,
    })),
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

/** Every leaf any trigger applies to a numeric field, with the constant it names, for limitation 3. */
export function numericLeaves(draft) {
  const numericFields = new Set(
    draft.intake_fields
      .filter((field) => field.type === "integer" || field.type === "number")
      .map((field) => field.field),
  );
  for (const derived of draft.derived_values) {
    if (/\*|inclusive_days|business_days_between/.test(derived.formula))
      numericFields.add(derived.name);
  }
  const leaves = [];
  for (const rule of published(draft)) {
    for (const leaf of triggerOperators(rule.trigger)) {
      if (numericFields.has(leaf.field)) {
        leaves.push({ rule: rule.id, field: leaf.field, op: leaf.op, value: leaf.value });
      }
    }
  }
  return leaves.sort(
    (left, right) =>
      left.rule.localeCompare(right.rule) ||
      left.field.localeCompare(right.field) ||
      left.op.localeCompare(right.op),
  );
}

/** Every operator any trigger applies to a numeric field, for limitation 3. */
export function numericOperators(draft) {
  return [...new Set(numericLeaves(draft).map((leaf) => leaf.op))].sort();
}

/**
 * The one numeric operator that takes no operand: `is_null` asks whether the fact was supplied.
 * Every other numeric leaf has to name the constant it compares against.
 */
export const OPERAND_FREE_NUMERIC_OPERATORS = new Set(["is_null"]);

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

/** A condition leaf: an object naming a field, an operator and a value. */
const isConditionLeaf = (node) =>
  node !== null &&
  typeof node === "object" &&
  !Array.isArray(node) &&
  typeof node.op === "string" &&
  typeof node.field === "string";

/** What the draft's own `engine_operators` array publishes, and what it publishes about each. */
export function operatorSemantics(draft) {
  const strings = [];
  const walk = (node) => {
    if (typeof node === "string") strings.push(node);
    else if (Array.isArray(node)) node.forEach(walk);
    else if (node !== null && typeof node === "object") {
      const applies = isConditionLeaf(node);
      for (const [key, value] of Object.entries(node)) {
        if (applies && key === "op") continue;
        strings.push(key);
        walk(value);
      }
    }
  };
  const { engine_operators: operators, ...draftBesideTheList } = draft;
  walk(draftBesideTheList);

  return operators.map((name) => {
    const occurrence = new RegExp(`(^|[^a-z0-9_])${name}([^a-z0-9_]|$)`, "i");
    return {
      name,
      // A published semantic would have to say something about the operator beyond listing its name, and saying it anywhere counts: a note, a convention, a legend, a key of a defined semantics structure.
      describedOutsideTheList: strings.some((text) => occurrence.test(text)),
    };
  });
}

/** What `parseRule` would make of a rule's output: the name it derives and whether it publishes a disposition. */
export function parserVisibleOutput(draft, ruleId) {
  const rule = published(draft).find((entry) => entry.id === ruleId);
  const output = rule.output;
  const publishedDisposition = probedDisposition(output);
  return {
    id: rule.id,
    kind: rule.kind,
    name: probedName(output),
    publishedDisposition,
    // What the finding actually carries: the published disposition where there is one, and otherwise the engine's own default for the rule's kind.
    effectiveDisposition: publishedDisposition ?? DEFAULT_DISPOSITION_BY_RULE_KIND[rule.kind],
    unreadFields: Object.keys(output).filter((key) => !parserReadsOutputField(key)),
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

/** Put one `output` object to `parseRule` and return the rule it produced, or `null` where the parser rejected the artifact. */
const probeCache = new Map();

function probeOutput(output) {
  const key = JSON.stringify(output);
  if (probeCache.has(key)) return probeCache.get(key);

  const probe = JSON.parse(JSON.stringify(loadControl()));
  probe.rules[0].output = output;
  let parsed = null;
  try {
    parsed = parseEngineRuleset(probe).rules[0];
  } catch {
    parsed = null;
  }
  probeCache.set(key, parsed);
  return parsed;
}

const PROBE_STRING = "__probe__";

/**
 * Values covering the shapes `parseRule`'s own readers accept: a string for `optionalString`, an
 * array for `optionalStringArray`, an object for `asObject`, and a number, a boolean and `null` for
 * anything that reads a value without narrowing it first.
 */
const PROBE_VALUES = [PROBE_STRING, [PROBE_STRING], { probe: PROBE_STRING }, 1, true, null];

const readFieldCache = new Map();

/** Whether `parseRule` reads an `output` key, asked by putting the key to the parser. */
export function parserReadsOutputField(key) {
  if (readFieldCache.has(key)) return readFieldCache.get(key);

  const baseline = JSON.stringify(probeOutput({}));
  const read = PROBE_VALUES.some((value) => {
    const parsed = probeOutput({ [key]: value });
    return parsed === null || JSON.stringify(parsed) !== baseline;
  });
  readFieldCache.set(key, read);
  return read;
}

/** The name `parseRule` would derive from an output, and nothing about which keys it derives it from. */
function probedName(output) {
  const candidates = Object.keys(output).filter(
    (key) =>
      (output[key] ?? null) !== null && probeOutput({ [key]: PROBE_STRING })?.name === PROBE_STRING,
  );
  if (candidates.length === 0) return null;
  const winner = probeOutput(Object.fromEntries(candidates.map((key) => [key, key]))).name;
  return output[winner];
}

/** The disposition `parseRule` would take from an output, in the lowercase form a finding carries. */
const PROBE_DISPOSITIONS = DISPOSITION_STRENGTH.map((disposition) => disposition.toUpperCase());

function probedDisposition(output) {
  const key = Object.keys(output).find((candidate) =>
    PROBE_DISPOSITIONS.some(
      (token) => probeOutput({ [candidate]: token })?.publishedDisposition === token.toLowerCase(),
    ),
  );
  if (key === undefined) return null;
  return probeOutput({ [key]: output[key] })?.publishedDisposition ?? null;
}
