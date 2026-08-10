// The measurement harness behind `docs/research/draft-dedupe-cofiring.md`.

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, URL } from "node:url";

import {
  createScopeResolver,
  evaluateTrigger,
  parseAskedWhen,
} from "../../packages/engine/src/conditions.ts";

const repoRoot = fileURLToPath(new URL("../../", import.meta.url));

/** The published control is found by reading `rules/` rather than by naming a version. */
function soleArtifact(directory, describe) {
  const names = readdirSync(join(repoRoot, directory)).filter((name) => name.endsWith(".json"));
  if (names.length !== 1) {
    throw new Error(`${directory} holds ${names.length} JSON artifacts; ${describe} is ambiguous`);
  }
  return join(repoRoot, directory, names[0]);
}

/** The draft is found by the identity it declares, not by being alone in its directory. */
const MEASURED_DRAFT = { schema: "popengine-rules/v2", rulesetVersion: "nyc.v2" };

/** What one candidate publishes about itself, or `null` when it publishes nothing readable. */
function declaredIdentity(path) {
  let candidate;
  try {
    candidate = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
  // Arrays and primitives fall out here too: neither declares a schema, and `null` would throw on
  // the property read rather than returning `undefined`.
  if (candidate === null || typeof candidate !== "object") return null;
  return { schema: candidate.schema, rulesetVersion: candidate.ruleset_version };
}

export function measuredDraftPath(directory = join(repoRoot, "rules/proposals")) {
  const matches = readdirSync(directory)
    .filter((name) => name.endsWith(".json"))
    .filter((name) => {
      const identity = declaredIdentity(join(directory, name));
      return (
        identity !== null &&
        identity.schema === MEASURED_DRAFT.schema &&
        identity.rulesetVersion === MEASURED_DRAFT.rulesetVersion
      );
    });
  if (matches.length !== 1) {
    throw new Error(
      `rules/proposals holds ${matches.length} artifacts declaring schema ` +
        `"${MEASURED_DRAFT.schema}" version "${MEASURED_DRAFT.rulesetVersion}"; ` +
        "the measured draft is ambiguous",
    );
  }
  return join(directory, matches[0]);
}

export const DRAFT_PATH = () => measuredDraftPath();
export const CONTROL_PATH = () => soleArtifact("rules", "the published control");

export function loadDraft() {
  const draft = JSON.parse(readFileSync(DRAFT_PATH(), "utf8"));
  assertDerivedValuesMatchDraft(draft);
  return draft;
}

export const loadControl = () => JSON.parse(readFileSync(CONTROL_PATH(), "utf8"));

/** The engine's explicit-unknown answer (`conditions.ts:242`). */
const UNKNOWN_ANSWER = "unknown";

/** The exclusive multi_enum option `validateIntake` refuses to combine with any other. */
const EXCLUSIVE_OPTION = "none";

/** The intake date every sweep fixes, so `event_days` varies only through `event_end_date`. */
export const EVENT_DATE = "2026-09-01";

/** The one end date above `EVENT_DATE`, which is what takes `event_days` above its threshold. */
const EVENT_END_DATE_NEXT_DAY = "2026-09-02";

/** The one end date below `EVENT_DATE`, which is what takes `event_days` below its threshold. */
const EVENT_END_DATE_PRIOR_DAY = "2026-08-31";

/** The draft publishes `asked_when` as a condition object; the engine's registry grammar is a string, and `parseIntakeField` reads it with `optionalString`, so an object silently becomes `null` and the field would be unconditionally in scope. */
export function askedWhenExpression(condition, field) {
  const reject = (reason) => {
    throw new Error(
      `asked_when for "${field}" ${reason}, which the engine's grammar cannot express`,
    );
  };

  const token = (value) => {
    const text = String(value);
    if (/[\s/]/.test(text)) reject(`names the value "${text}"`);
    return text;
  };

  const clause = (node) => {
    if ("all" in node) return node.all.map(clause).join(" AND ");
    if (!("field" in node)) reject("uses `any`");
    switch (node.op) {
      case "in":
        if (!Array.isArray(node.value) || node.value.length === 0) {
          reject(`applies "in" to ${JSON.stringify(node.value)}`);
        }
        return `${node.field} in ${node.value.map(token).join("/")}`;
      case "eq":
        return `${node.field} = ${token(node.value)}`;
      case "bool":
        if (node.value !== true) reject(`asserts \`${node.field}\` is false`);
        return node.field;
      default:
        return reject(`uses the operator "${String(node.op)}"`);
    }
  };

  return clause(condition);
}

/** The draft's derived values that a trigger reads, added to the intake as declared pseudo-fields so the comparisons *on* them run through the engine's operator table rather than a second one. */
const DERIVED_VALUES = {
  structure_area_sqft: {
    type: "number",
    inputs: ["structure_length_ft", "structure_width_ft"],
    declaration: {
      formula: "structure_length_ft * structure_width_ft",
      null_behavior: "unknown if either dimension is missing",
    },
    // "unknown if either dimension is missing"
    compute: (intake) => {
      const length = intake.structure_length_ft;
      const width = intake.structure_width_ft;
      if (typeof length !== "number" || typeof width !== "number") return null;
      return length * width;
    },
  },
  event_days: {
    type: "integer",
    inputs: ["event_date", "event_end_date"],
    declaration: {
      formula: "inclusive_days(event_date, event_end_date ?? event_date)",
      null_behavior: "1 when event_end_date is null",
    },
    // "1 when event_end_date is null"
    compute: (intake) => {
      const start = intake.event_date;
      const end = intake.event_end_date ?? start;
      if (typeof start !== "string" || typeof end !== "string") return null;
      const day = 24 * 60 * 60 * 1000;
      return (
        Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / day) + 1
      );
    },
  },
  effective_fuel_types: {
    type: "multi_enum",
    inputs: ["fuel_types", "generator_fuel_type"],
    declaration: {
      formula:
        "union(fuel_types, generator_fuel_type when generator_fuel_type not in ['none','unknown'])",
      null_behavior: "fuel_types only",
    },
    // "fuel_types only"
    compute: (intake) => {
      const base = Array.isArray(intake.fuel_types) ? [...intake.fuel_types] : [];
      const generator = intake.generator_fuel_type;
      if (typeof generator === "string" && generator !== "none" && generator !== UNKNOWN_ANSWER) {
        if (!base.includes(generator)) base.push(generator);
      }
      return base;
    },
  },
};

/** A `null` answer is unanswered, except where the artifact publishes a definite meaning for it. */
const NULL_IS_A_DECLARED_ANSWER = new Set(["event_end_date"]);

/** Fail when the draft's `derived_values` declarations and this file's implementations have parted company, in either direction. */
export function assertDerivedValuesMatchDraft(artifact) {
  const declared = new Map(artifact.derived_values.map((value) => [value.name, value]));

  for (const [name, implementation] of Object.entries(DERIVED_VALUES)) {
    const declaration = declared.get(name);
    if (declaration === undefined) {
      throw new Error(`the draft no longer declares the derived value "${name}"`);
    }
    for (const key of ["formula", "null_behavior"]) {
      if (declaration[key] !== implementation.declaration[key]) {
        throw new Error(
          `derived value "${name}" declares ${key} "${declaration[key]}", but this harness ` +
            `implements "${implementation.declaration[key]}"`,
        );
      }
    }
  }

  for (const rule of [...artifact.rules, ...artifact.advisories]) {
    for (const leaf of triggerOperators(rule.trigger)) {
      if (declared.has(leaf.field) && DERIVED_VALUES[leaf.field] === undefined) {
        throw new Error(
          `rule ${rule.id} reads the derived value "${leaf.field}", which this harness does not compute`,
        );
      }
    }
  }
}

/** Dimensions whose thresholds are on their product, so the extra factors are set on the product's behalf. */
const HAND_SET_NUMERIC_DOMAINS = {
  structure_length_ft: { factors: [10, 12, 20, 21], brackets: "structure_area_sqft" },
  structure_width_ft: { factors: [10, 12, 20, 21], brackets: "structure_area_sqft" },
};

/** The numeric points a hand-set dimension sweeps: its factors under the generic numeric rules. */
const handSetNumericPoints = (field) =>
  numericPoints(field, HAND_SET_NUMERIC_DOMAINS[field].factors);

/** Every value the hand-set factors of a derived value can compute, through its own formula. */
function handSetProducts(derivedName) {
  const { inputs, compute } = DERIVED_VALUES[derivedName];
  const products = new Set();
  const build = (index, intake) => {
    if (index === inputs.length) {
      const value = compute(intake);
      if (typeof value === "number") products.add(value);
      return;
    }
    if (HAND_SET_NUMERIC_DOMAINS[inputs[index]] === undefined) {
      throw new Error(`"${inputs[index]}" feeds "${derivedName}" but has no hand-set domain`);
    }
    for (const value of handSetNumericPoints(inputs[index])) {
      build(index + 1, { ...intake, [inputs[index]]: value });
    }
  };
  build(0, {});
  return [...products];
}

/** Fail when a hand-set factor domain no longer brackets a threshold its product is compared to. */
function assertHandSetDomainBrackets(field, members) {
  const derivedName = HAND_SET_NUMERIC_DOMAINS[field].brackets;
  const products = handSetProducts(derivedName);
  for (const threshold of thresholdsFor(derivedName, members)) {
    const sides = {
      below: products.some((product) => product < threshold),
      at: products.includes(threshold),
      above: products.some((product) => product > threshold),
    };
    for (const [side, covered] of Object.entries(sides)) {
      if (!covered) {
        throw new Error(
          `no product of the hand-set "${DERIVED_VALUES[derivedName].inputs.join('" and "')}" ` +
            `domains is ${side} the "${derivedName}" threshold ${threshold}`,
        );
      }
    }
  }
}

/** The smallest value the intake contract admits for a numeric field, where it names one. */
const NUMERIC_MINIMUMS = { headcount: 1 };

/** Section 3.3's numeric domain rule, applied in one place so every numeric field obeys it: the `0` anchor, plus the points the caller chose for the field, less anything below the field's `NUMERIC_MINIMUMS` entry. */
function numericPoints(field, points) {
  const minimum = NUMERIC_MINIMUMS[field] ?? 0;
  const sorted = [...new Set([0, ...points])]
    .filter((point) => point >= minimum)
    .sort((a, b) => a - b);
  if (sorted.length === 0) {
    throw new Error(`no value of "${field}" at or above ${minimum} is in the swept domain`);
  }
  return sorted;
}

/** A domain plus the `null` answer, where the field is nullable. */
const withNull = (values, definition) => (definition.nullable ? [...values, null] : values);

// Field definitions

/**
 * Build `IntakeFieldDefinition`s for an artifact, with the draft's two `asked_when` objects
 * translated into the engine's grammar and parsed by the engine's parser. Derived values are added
 * as unscoped pseudo-fields so the scope resolver can answer for them.
 */
export function buildFieldDefinitions(artifact, { translateAskedWhen = false } = {}) {
  const declared = artifact.intake_fields.map((field) => ({
    field: field.field,
    type: field.type,
    values: field.values ?? null,
    derived: field.derived === true,
    askedWhen:
      typeof field.asked_when === "string"
        ? field.asked_when
        : translateAskedWhen && field.asked_when != null
          ? askedWhenExpression(field.asked_when, field.field)
          : null,
    askedWhenClauses: null,
    nullable: field.nullable === true,
  }));

  const derived = Object.entries(DERIVED_VALUES).map(([name, definition]) => ({
    field: name,
    type: definition.type,
    values: null,
    derived: true,
    askedWhen: null,
    askedWhenClauses: null,
    nullable: true,
  }));

  const all = [...declared, ...derived];
  return all.map((field) =>
    field.askedWhen === null
      ? field
      : { ...field, askedWhenClauses: parseAskedWhen(field.askedWhen, all) },
  );
}

const byField = (fields) => new Map(fields.map((field) => [field.field, field]));

// Trigger evaluation

/** `is_null`: true when the field is in scope and its answer is absent; false otherwise, never unknown. */
function evaluateIsNull(condition, intake, scope) {
  if (!scope.isInScope(condition.field)) return "false";
  const value = intake[condition.field];
  return value === undefined || value === null ? "true" : "false";
}

/**
 * `lte`: numeric `<=`; unknown when the answer is absent or explicitly unknown. The comparison
 * follows from the operator's name and its company (`lt`, `gt`, `gte`); the tri-state behaviour is
 * copied from how the engine treats every other numeric comparison.
 */
function evaluateLte(condition, intake, scope) {
  if (!scope.isInScope(condition.field)) return "false";
  const value = intake[condition.field];
  if (value === undefined || value === null || value === UNKNOWN_ANSWER) return "unknown";
  if (typeof value !== "number") {
    throw new Error(`${condition.field} must be numeric for op "lte"`);
  }
  return value <= condition.value ? "true" : "false";
}

/**
 * Tri-state walk. Every node the engine supports is handed to the engine; the combinator is the
 * only engine logic restated, and it short-circuits on a decisive child, which is exact because a
 * decisive child settles the node whatever its siblings say.
 */
export function evalTrigger(node, intake, scope) {
  if ("field" in node) {
    if (node.op === "is_null") return evaluateIsNull(node, intake, scope);
    if (node.op === "lte") return evaluateLte(node, intake, scope);
    return evaluateTrigger(node, intake, scope).result;
  }

  const isAll = "all" in node;
  const children = isAll ? node.all : node.any;
  const decisive = isAll ? "false" : "true";
  let sawUnknown = false;
  for (const child of children) {
    const result = evalTrigger(child, intake, scope);
    if (result === decisive) return decisive;
    if (result === "unknown") sawUnknown = true;
  }
  return sawUnknown ? "unknown" : isAll ? "true" : "false";
}

/** Every field a trigger reads, in walk order, with each derived value expanded to its inputs. */
export function triggerFieldsInOrder(node, seen = []) {
  if ("field" in node) {
    const derived = DERIVED_VALUES[node.field];
    const names = derived === undefined ? [node.field] : derived.inputs;
    for (const name of names) if (!seen.includes(name)) seen.push(name);
    return seen;
  }
  for (const child of "all" in node ? node.all : node.any) triggerFieldsInOrder(child, seen);
  return seen;
}

/** Every operator a trigger uses, with the field it is applied to. */
export function triggerOperators(node, found = []) {
  if ("field" in node) {
    found.push({ field: node.field, op: node.op, value: node.value });
    return found;
  }
  for (const child of "all" in node ? node.all : node.any) triggerOperators(child, found);
  return found;
}

// Value domains

/** The valid selections of a multi_enum, not its power set. */
export function validMultiEnumSelections(values) {
  const others = values.filter((value) => value !== EXCLUSIVE_OPTION);
  const selections = [];
  for (let mask = 1; mask < 1 << others.length; mask += 1) {
    selections.push(others.filter((_, index) => (mask & (1 << index)) !== 0));
  }
  if (values.includes(EXCLUSIVE_OPTION)) selections.push([EXCLUSIVE_OPTION]);
  return selections;
}

/** Every numeric constant any member of the sweep compares this field against. */
function thresholdsFor(field, members) {
  const thresholds = new Set();
  for (const member of members) {
    for (const leaf of triggerOperators(member.trigger)) {
      if (leaf.field === field && typeof leaf.value === "number") thresholds.add(leaf.value);
    }
  }
  return [...thresholds];
}

/** The value domain of one field, applied uniformly: - enum / boolean: every value the artifact declares, plus `null` when it marks the field nullable. */
export function domainFor(field, definition, members) {
  if (HAND_SET_NUMERIC_DOMAINS[field] !== undefined) {
    assertHandSetDomainBrackets(field, members);
    return withNull(handSetNumericPoints(field), definition);
  }

  switch (definition.type) {
    case "enum":
      return definition.nullable ? [...definition.values, null] : [...definition.values];
    case "multi_enum": {
      const selections = validMultiEnumSelections(definition.values);
      return definition.nullable ? [...selections, null] : selections;
    }
    case "boolean":
      return definition.nullable ? [true, false, null] : [true, false];
    case "integer":
    case "number": {
      const points = [];
      for (const threshold of thresholdsFor(field, members)) {
        points.push(threshold - 1, threshold, threshold + 1);
      }
      return withNull(numericPoints(field, points), definition);
    }
    case "date":
      if (field === "event_date") return [EVENT_DATE];
      if (field !== "event_end_date") {
        throw new Error(`no domain rule for date field "${field}"`);
      }
      return withNull([EVENT_END_DATE_PRIOR_DAY, EVENT_DATE, EVENT_END_DATE_NEXT_DAY], definition);
    default:
      throw new Error(`no domain rule for field "${field}" of type "${definition.type}"`);
  }
}

// Sweeping

/** A scope resolver that refuses to answer for a scoped field, proving the shortcut sound. */
function strictResolver(scopedFields) {
  return {
    isInScope: (field) => {
      if (scopedFields.has(field)) {
        throw new Error(`sweep consulted scoped field "${field}" with no scope resolver`);
      }
      return true;
    },
  };
}

/** Order the swept fields so a field's `asked_when` gates are assigned before it is. */
function scopeOrder(fields, definitions) {
  const ordered = [];
  const remaining = [...fields];
  while (remaining.length > 0) {
    const index = remaining.findIndex((field) => {
      const clauses = definitions.get(field)?.askedWhenClauses ?? null;
      if (clauses === null) return true;
      return clauses.every((clause) => !remaining.includes(clause.field) || clause.field === field);
    });
    if (index === -1) throw new Error(`cyclic asked_when among ${remaining.join(", ")}`);
    ordered.push(...remaining.splice(index, 1));
  }
  return ordered;
}

const isSettled = (field, value, inScope) => {
  if (!inScope) return true;
  if (value === undefined || value === null) return NULL_IS_A_DECLARED_ANSWER.has(field);
  return value !== UNKNOWN_ANSWER;
};

/** Enumerate every valid intake over `fields`. */
export function enumerateIntakes(fields, definitions, members, visit) {
  const definitionList = [...definitions.values()];
  const assignmentOrder = scopeOrder(fields, definitions);
  const bitOf = new Map(fields.map((field, index) => [field, 1 << index]));
  const domains = new Map(
    fields.map((field) => [field, domainFor(field, definitions.get(field), members)]),
  );
  const scoped = new Set(
    fields.filter((field) => definitions.get(field).askedWhenClauses !== null),
  );
  const everyScopedField = new Set(
    definitionList.filter((field) => field.askedWhenClauses !== null).map((field) => field.field),
  );
  const unscopedResolver = strictResolver(everyScopedField);

  // A derived value is recomputed only at the depth that fixes its last input, and only when some
  // member reads it: injecting one nothing reads would put a value in the intake no rule asked for.
  const derivedRead = new Set(
    members.flatMap((member) => triggerOperators(member.trigger).map((leaf) => leaf.field)),
  );
  const derivedAtDepth = assignmentOrder.map(() => []);
  for (const [name, definition] of Object.entries(DERIVED_VALUES)) {
    if (!derivedRead.has(name)) continue;
    if (!definition.inputs.some((input) => fields.includes(input))) continue;
    const last = Math.max(
      ...definition.inputs.map((input) => assignmentOrder.indexOf(input)).filter((i) => i >= 0),
    );
    derivedAtDepth[last].push([name, definition]);
  }

  const intake = {};
  let ordinal = 0;

  const walk = (depth, unsettledMask) => {
    if (depth === assignmentOrder.length) {
      visit(
        intake,
        unsettledMask,
        ordinal,
        scoped.size === 0
          ? unscopedResolver
          : createScopeResolver(intake, { intakeFields: definitionList }),
      );
      ordinal += 1;
      return;
    }
    const field = assignmentOrder[depth];
    const inScope =
      !scoped.has(field) ||
      createScopeResolver(intake, { intakeFields: definitionList }).isInScope(field);
    const values = inScope ? domains.get(field) : [null];
    const bit = bitOf.get(field);
    for (const value of values) {
      intake[field] = value;
      for (const [name, definition] of derivedAtDepth[depth])
        intake[name] = definition.compute(intake);
      walk(depth + 1, isSettled(field, value, inScope) ? unsettledMask : unsettledMask | bit);
    }
    intake[field] = null;
  };

  walk(0, 0);
  return ordinal;
}

/** The size of a sweep, without evaluating anything. */
export function sweepSize(fields, definitions, members) {
  let count = 0;
  enumerateIntakes(fields, definitions, members, () => {
    count += 1;
  });
  return count;
}

const RESULT_INDEX = { false: 0, true: 1, unknown: 2 };

const fieldsOfMask = (fields, mask) => fields.filter((_, index) => (mask & (1 << index)) !== 0);

/** The swept fields the draft marks `derived: true`, which is what makes a sweep an unconstrained product rather than a statement about reachable events. */
const derivedSweptFields = (fields, definitions) =>
  fields.filter((field) => definitions.get(field)?.derived === true);

/** Sweep one dedupe group. */
export function sweepGroup(group, definitions) {
  const members = group.members;
  const fields = [];
  for (const member of members) triggerFieldsInOrder(member.trigger, fields);
  const memberFieldMask = members.map((member) => {
    let mask = 0;
    for (const field of triggerFieldsInOrder(member.trigger)) mask |= 1 << fields.indexOf(field);
    return mask;
  });

  const findingsHistogram = new Array(members.length + 1).fill(0);
  const trueHistogram = new Array(members.length + 1).fill(0);
  // The same two distributions restricted to complete intakes, kept whole rather than collapsed to their tails.
  const completeFindingsHistogram = new Array(members.length + 1).fill(0);
  const completeTrueHistogram = new Array(members.length + 1).fill(0);
  // Member trigger results that came back `unknown` on a complete intake, counted directly. This is
  // section 4.3's claim stated as the thing it says, with no cutoff between it and the measurement.
  let completeUnknownResults = 0;
  const sets = new Map();
  const results = new Array(members.length);
  let sweep = 0;
  let complete = 0;
  let completeAndTwoFindings = 0;
  let completeAndTwoTrue = 0;

  enumerateIntakes(fields, definitions, members, (intake, unsettledMask, ordinal, scope) => {
    let findings = 0;
    let decisive = 0;
    let unknowns = 0;
    let key = 0;
    let setFieldMask = 0;
    for (let index = 0; index < members.length; index += 1) {
      const result = evalTrigger(members[index].trigger, intake, scope);
      results[index] = result;
      key = key * 3 + RESULT_INDEX[result];
      if (result !== "false") {
        findings += 1;
        setFieldMask |= memberFieldMask[index];
        if (result === "true") decisive += 1;
        else unknowns += 1;
      }
    }
    const isComplete = unsettledMask === 0;

    sweep += 1;
    findingsHistogram[findings] += 1;
    trueHistogram[decisive] += 1;
    if (isComplete) {
      complete += 1;
      completeFindingsHistogram[findings] += 1;
      completeTrueHistogram[decisive] += 1;
      completeUnknownResults += unknowns;
      if (findings >= 2) completeAndTwoFindings += 1;
      if (decisive >= 2) completeAndTwoTrue += 1;
    }
    if (findings < 2) return;

    let entry = sets.get(key);
    if (entry === undefined) {
      entry = {
        results: [...results],
        members: members.filter((_, index) => results[index] !== "false").map((m) => m.id),
        count: 0,
        complete: 0,
        setComplete: 0,
        unsettledMasks: new Map(),
        firstIntake: { ...intake },
        firstCompleteIntake: null,
      };
      sets.set(key, entry);
    }
    entry.count += 1;
    if (isComplete) {
      entry.complete += 1;
      entry.firstCompleteIntake ??= { ...intake };
    }
    if ((unsettledMask & setFieldMask) === 0) entry.setComplete += 1;
    entry.unsettledMasks.set(unsettledMask, (entry.unsettledMasks.get(unsettledMask) ?? 0) + 1);
  });

  for (const entry of sets.values()) {
    entry.unsettled = new Map();
    for (const [mask, count] of entry.unsettledMasks) {
      for (const field of fieldsOfMask(fields, mask)) {
        entry.unsettled.set(field, (entry.unsettled.get(field) ?? 0) + count);
      }
    }
  }

  return {
    key: group.key,
    memberIds: members.map((member) => member.id),
    fields,
    derivedFields: derivedSweptFields(fields, definitions),
    sweep,
    complete,
    completeAndTwoFindings,
    completeAndTwoTrue,
    completeFindings: completeFindingsHistogram,
    completeTrue: completeTrueHistogram,
    completeUnknownResults,
    findings: findingsHistogram,
    true: trueHistogram,
    sets: [...sets.values()].sort((left, right) => right.count - left.count),
  };
}

/** Sweep the published control through the real parser and the engine's own `evaluateTrigger`. */
export function sweepControl(ruleset) {
  const group = [...ruleset.rules]
    .filter((rule) => rule.dedupeKey !== null)
    .reduce((groups, rule) => {
      groups.set(rule.dedupeKey, [...(groups.get(rule.dedupeKey) ?? []), rule]);
      return groups;
    }, new Map());
  // Sections 4.4 and 7 read the control as having exactly one multi-member dedupe group, and every figure they quote is this one group's sweep.
  const multiMember = [...group.entries()].filter(([, rules]) => rules.length > 1);
  if (multiMember.length !== 1) {
    throw new Error(
      `the published control has ${multiMember.length} multi-member dedupe groups ` +
        `(${multiMember.map(([key]) => key).join(", ") || "none"}), and sections 4.4 and 7 ` +
        `describe exactly one; sweep and report every group before republishing them`,
    );
  }
  const [[key, members]] = multiMember;

  const definitions = byField(ruleset.intakeFields);
  const fields = [];
  for (const member of members) triggerFieldsInOrder(member.trigger, fields);

  const findings = [0, 0, 0];
  const decisive = [0, 0, 0];
  const completeFindings = [0, 0, 0];
  const completeDecisive = [0, 0, 0];
  const shapes = new Map();
  let sweep = 0;
  let complete = 0;
  let comparisons = 0;
  let mismatches = 0;

  enumerateIntakes(fields, definitions, members, (intake, unsettledMask, ordinal, scope) => {
    for (const rule of ruleset.rules) {
      const engineResult = evaluateTrigger(rule.trigger, intake, scope).result;
      comparisons += 1;
      if (evalTrigger(rule.trigger, intake, scope) !== engineResult) mismatches += 1;
    }

    const results = members.map((member) => evaluateTrigger(member.trigger, intake, scope).result);
    const reached = results.filter((result) => result !== "false").length;
    const settled = results.filter((result) => result === "true").length;
    const isComplete = unsettledMask === 0;

    sweep += 1;
    findings[reached] += 1;
    decisive[settled] += 1;
    if (isComplete) {
      complete += 1;
      completeFindings[reached] += 1;
      completeDecisive[settled] += 1;
    }

    if (reached < 2) return;
    const shapeKey = results.join("/");
    let shape = shapes.get(shapeKey);
    if (shape === undefined) {
      shape = {
        results,
        count: 0,
        complete: 0,
        firstIntake: { ...intake },
        firstCompleteIntake: null,
      };
      shapes.set(shapeKey, shape);
    }
    shape.count += 1;
    if (isComplete) {
      shape.complete += 1;
      shape.firstCompleteIntake ??= { ...intake };
    }
  });

  return {
    key,
    memberIds: members.map((member) => member.id),
    fields,
    sweep,
    complete,
    findings,
    true: decisive,
    completeFindings,
    completeTrue: completeDecisive,
    shapes: [...shapes.values()],
    agreement: { comparisons, mismatches, rules: ruleset.rules.length },
  };
}

/** The nine multi-member dedupe groups of the draft, in artifact order. */
export function multiMemberGroups(artifact) {
  const published = [...artifact.rules, ...artifact.advisories];
  const byKey = new Map();
  for (const rule of published) {
    const key = rule.output?.dedupe_key ?? null;
    if (key === null) continue;
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(rule);
  }
  return [...byKey.entries()]
    .filter(([, members]) => members.length > 1)
    .map(([key, members]) => ({ key, members }));
}

export { DERIVED_VALUES, NUMERIC_MINIMUMS, UNKNOWN_ANSWER, NULL_IS_A_DECLARED_ANSWER };
