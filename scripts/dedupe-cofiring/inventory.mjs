// What the draft publishes, re-derived by parsing it rather than by reading it.
//
// Every claim in the document that counts something about the draft comes from here: deadline
// windows, permit names, which outputs are byte-identical, which rules read a fuel field, which
// rules are blockers, which dedupe groups mix verification statuses.

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

/**
 * Section 1's opening count: every distinct non-null `dedupe_key` the draft publishes, and how many
 * of those groups hold more than one member.
 *
 * `multiMemberGroups` returns the same nine whatever the single-member keys do, so a rule or
 * advisory the draft added under a new single-member key left the published total of 25 stale while
 * every sweep size and every section 5 figure stayed green (#251 review). `multiMember` is that
 * function's own answer rather than a second count of the same thing, so the two cannot part
 * company.
 */
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
 *
 * `conditionalFields` is that last promise's own carrier, and it is deliberately not a projection of
 * the counts. Both counts range over enum, boolean and multi_enum fields alone, so an `asked_when`
 * added to a numeric, date or string field, `event_address` for instance, moved neither of them; no
 * group sweep reads such a field either, so section 3.2's "only two of the draft's 63 intake fields
 * carry an `asked_when` at all" and this promise could both go stale with the suite green
 * (#251 review). It is read off the artifact's own `asked_when` keys rather than off the translated
 * definitions, so a clause too complex for `askedWhenExpression` still counts as one the draft
 * carries instead of disappearing into a `null`.
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
    // The fee displays, per member, in rule order. Every fee claim section 5.1 publishes is a
    // reading of these strings, and only their cardinality was ever checked, so a renamed
    // instrument or a changed fee left the suite green while the section went stale (#251 review).
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

/**
 * Every leaf any trigger applies to a numeric field, with the constant it names, for limitation 3.
 *
 * The operand is carried, not just the operator. `numericOperators` alone returns the same set of
 * names whether or not a leaf still publishes a threshold, so a numeric leaf that dropped its
 * `value` or changed it to a non-number left limitation 3 asserting that every numeric leaf names a
 * constant while one no longer did, and left the threshold-local domains with no threshold to build
 * from for that leaf. A leaf in a single-member group is not swept, so nothing else would have
 * caught it either (#251 review).
 */
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

/**
 * What the draft's own `engine_operators` array publishes, and what it publishes about each.
 *
 * The check is a textual one over every string and every property key in the draft's non-rule
 * metadata, not a search for the operator as a complete JSON string. Splitting on `"is_null"` found
 * the name only where it stood alone as a value or a key, so a draft that added a note reading
 * `is_null returns true for absent answers` would define the semantics this harness supplies while
 * this function went on reporting none, leaving section 3.2 green on a reading the draft had
 * started contradicting (#251 review). Word boundaries are `[^a-z0-9_]` rather than `\b`, because
 * `\b` does not fire around the underscore in `is_null`.
 *
 * What is skipped is operator APPLICATIONS, and nothing wider. The earlier fix skipped the whole
 * `rules` and `advisories` arrays on the grounds that an operator name in a rule is a trigger
 * applying it, which closed the instance and left the class: a rule's own prose, an output note
 * reading `is_null matches an answer the organizer never gave`, defines the operator as squarely as
 * a legend does and went on reporting none (#251 review). So a rule is walked like any other part of
 * the draft except for its `trigger` tree, which is applications and nothing else, and except for
 * the value of any `op` key, which is one application wherever it sits (`output.paths[].when` is
 * the draft's other place for them). `engine_operators` is excluded because it is the list itself:
 * naming an operator in it is what makes it an operator, not what describes one.
 */
export function operatorSemantics(draft) {
  const strings = [];
  const walk = (node, insideRule) => {
    if (typeof node === "string") strings.push(node);
    else if (Array.isArray(node)) node.forEach((child) => walk(child, insideRule));
    else if (node !== null && typeof node === "object") {
      for (const [key, value] of Object.entries(node)) {
        if (insideRule && (key === "trigger" || key === "op")) continue;
        strings.push(key);
        walk(value, insideRule);
      }
    }
  };
  const { rules, advisories, engine_operators: operators, ...metadata } = draft;
  walk(metadata, false);
  for (const rule of [...rules, ...advisories]) walk(rule, true);

  return operators.map((name) => {
    const occurrence = new RegExp(`(^|[^a-z0-9_])${name}([^a-z0-9_]|$)`, "i");
    return {
      name,
      // A published semantic would have to say something about the operator beyond listing its
      // name, and saying it anywhere counts: a note, a convention, a legend, a key of a defined
      // semantics structure.
      describedOutsideTheList: strings.some((text) => occurrence.test(text)),
    };
  });
}

/**
 * What `parseRule` would make of a rule's output: the name it derives and whether it publishes a
 * disposition. A draft field the parser does not read cannot reach a merged plan item.
 *
 * Every part of this is the parser's own answer, asked through `probeOutput` below. None of it is a
 * reading of `packages/engine/src/ruleset.ts`.
 */
export function parserVisibleOutput(draft, ruleId) {
  const rule = published(draft).find((entry) => entry.id === ruleId);
  const output = rule.output;
  const publishedDisposition = probedDisposition(output);
  return {
    id: rule.id,
    kind: rule.kind,
    name: probedName(output),
    publishedDisposition,
    // What the finding actually carries: the published disposition where there is one, and
    // otherwise the engine's own default for the rule's kind. Read from the engine's table rather
    // than restated, so a rule kind the draft moves, or a default the engine changes, moves the
    // document's account of which route binds a merged line instead of leaving it stale.
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

/**
 * Put one `output` object to `parseRule` and return the rule it produced, or `null` where the
 * parser rejected the artifact.
 *
 * The object is published on the first rule of the PUBLISHED control, which loads cleanly, and the
 * clone is parsed. `rules/` is never written, and the draft is not the base here on purpose: the
 * draft does not load at all (section 3.1), so a question about the parser cannot be asked through
 * it.
 */
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

/**
 * Whether `parseRule` reads an `output` key, asked by putting the key to the parser.
 *
 * This used to be a hand-maintained set of the reads at `ruleset.ts:484-545`, which is a set no
 * test can falsify: the cases asserting which draft fields are dropped took that set as their own
 * oracle, so they would have stayed green after `parseRule` started reading `output.message` or
 * `candidate_requirement`, with sections 5.9 to 7 still claiming the prohibition text and the
 * nested deadline never reach a merged line (#251 review).
 *
 * The key is instead published on the control under each of `PROBE_VALUES`, and counts as READ when
 * any of them moves the parsed rule or makes the parser reject the artifact. A key the parser never
 * touches can do neither, whatever is published under it, so an unread verdict here is the parser's
 * answer and not this file's. `conflict_text` comes back unread for the reason it always was: a
 * finding's `conflictText` is derived from `noteText` at an `OFFICIAL_CONFLICT` status
 * (`apps/web/app/checklist/checklist-fixtures.ts:121`), and no ruleset field feeds it.
 */
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

/**
 * The name `parseRule` would derive from an output, and nothing about which keys it derives it from.
 *
 * The candidates are the output's own keys that produce the probe string as the parsed rule's name
 * when published alone; where an output carries more than one, all of them are published together
 * and the parser names the winner, so the precedence among them is read off the parser rather than
 * restated as a fallback chain. A key whose published value is null is not a candidate, matching the
 * `??` the parser falls through on.
 */
function probedName(output) {
  const candidates = Object.keys(output).filter(
    (key) =>
      (output[key] ?? null) !== null && probeOutput({ [key]: PROBE_STRING })?.name === PROBE_STRING,
  );
  if (candidates.length === 0) return null;
  const winner = probeOutput(Object.fromEntries(candidates.map((key) => [key, key]))).name;
  return output[winner];
}

/**
 * The disposition `parseRule` would take from an output, in the lowercase form a finding carries.
 *
 * The key is found by publishing the dispositions the engine itself ranks in `DISPOSITION_STRENGTH`
 * and seeing which key turns one of them into a parsed `publishedDisposition`. It is `some` rather
 * than `every` because the published token for a disposition is not always its name in upper case:
 * `no_new_requirement` is published as `NO_NEW_REQUIREMENT_IDENTIFIED`. The rule's own token is then
 * put to the parser in turn, so a token the parser does not accept publishes no disposition here.
 */
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
