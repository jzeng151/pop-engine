import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { URL } from "node:url";

import { beforeAll, describe, expect, test } from "vitest";

import { evaluate, parseEngineRuleset } from "../../packages/engine/src/index.ts";
import { parseIntakeContract } from "../../packages/engine/src/intake/registry.ts";
import { validateIntake } from "../../packages/engine/src/intake/validate.ts";

import {
  DERIVED_VALUES,
  EVENT_DATE,
  NUMERIC_MINIMUMS,
  askedWhenExpression,
  assertDerivedValuesMatchDraft,
  buildFieldDefinitions,
  domainFor,
  loadControl,
  measuredDraftPath,
  sweepControl,
  validMultiEnumSelections,
} from "./harness.mjs";
import {
  coFiringEvents,
  measure,
  printTables,
  setsWith,
  unsettledAcrossCoFiring,
} from "./report.mjs";
import {
  engineDeclaresKind,
  engineDeclaresStatus,
  probeDeadline,
  stagingSequence,
} from "./staging.mjs";

let m;

const controlContract = parseIntakeContract(loadControl());

beforeAll(() => {
  m = measure();
  if (process.env.PRINT_TABLES === "1") printTables(m);
}, 600_000);

const setNamed = (group, ids, results) =>
  group.sets.find(
    (set) =>
      set.members.length === ids.length &&
      ids.every((id) => set.members.includes(id)) &&
      ids.every((id, index) => set.results[group.memberIds.indexOf(id)] === results[index]),
  );

describe("section 1, the dedupe-group inventory", () => {
  test("the draft declares 25 dedupe groups, nine of which hold more than one member", () => {
    expect(m.inventory.dedupeGroupInventory(m.draft)).toEqual({ groups: 25, multiMember: 9 });
  });
});

describe("section 3.1, the load-staging errors", () => {
  test("the parser's complaints arrive in the published order", () => {
    const errors = m.staging.map((step) => step.error);
    expect(errors[0]).toContain(
      'ruleset.rules[4].output.deadline.type has unsupported value "conditional"',
    );
    expect(errors[1]).toContain(
      'ruleset.rules[4].verification.status has unsupported value "VERIFIED_WITH_QUALIFICATION"',
    );
    expect(errors[2]).toContain(
      'ruleset.rules[8].trigger.all[1].any[3].op has unsupported value "is_null"',
    );
    expect(errors[3]).toBe(errors[2]);
    expect(errors[4]).toContain(
      'rule SAPO-BLOCK-PARTY-INELIGIBLE-001 references undeclared field "event_days"',
    );
    expect(errors[5]).toContain('dedupe key "block_party_eligibility" mixes verification statuses');
    expect(errors[6]).toContain('intake field "event_address" is declared but no rule trigger');
  });

  test("the inventory each adaptation touches, as the table's left column publishes it", () => {
    expect(m.staging[1].changed).toEqual({
      deadlinesDropped: {
        byUnsupportedType: {
          conditional: 3,
          official_conflict: 1,
          fixed_annual_date: 1,
          dependency: 1,
        },
        byMissingCalendarDays: 4,
      },
    });
    expect(m.staging[2].changed).toEqual({
      statusesMapped: { VERIFIED_WITH_QUALIFICATION: 33, CONDITIONAL: 8 },
    });
    expect(m.staging[3].changed).toEqual({
      kindsMapped: { conditional_requirement: 4, approval: 1, certificate: 1 },
    });
    expect(m.staging[4].changed).toEqual({ operatorsRewritten: { is_null: 7, lte: 1 } });
    expect(m.staging[5].changed).toEqual({
      derivedValuesDeclared: ["effective_fuel_types", "event_days", "structure_area_sqft"],
    });
  });

  test("the declared names are the draft's derived values, not whatever a trigger names", () => {
    for (const name of m.staging[5].changed.derivedValuesDeclared) {
      expect(m.draft.derived_values.map((value) => value.name)).toContain(name);
    }

    const readingField = (id, field) => ({
      ...m.draft,
      rules: [
        ...m.draft.rules,
        { ...m.draft.rules[0], id, trigger: { all: [{ field, op: "gt", value: 1 }] } },
      ],
    });

    expect(() => stagingSequence(readingField("SYNTHETIC-TYPO-001", "event_dayz"))).toThrow(
      /triggers read "event_dayz", which the draft declares neither as an intake field nor under derived_values/,
    );

    const withDerived = readingField("SYNTHETIC-DERIVED-001", "business_days_until_event");
    expect(stagingSequence(withDerived)[5].changed).toEqual({
      derivedValuesDeclared: [
        "business_days_until_event",
        "effective_fuel_types",
        "event_days",
        "structure_area_sqft",
      ],
    });
  });

  test("the unsupported deadline types are the parser's verdict, not a list", () => {
    const reported = Object.keys(m.staging[1].changed.deadlinesDropped.byUnsupportedType);
    expect(reported.sort()).toEqual([
      "conditional",
      "dependency",
      "fixed_annual_date",
      "official_conflict",
    ]);
    for (const type of reported) expect(probeDeadline({ type }).unsupportedType).toBe(true);

    expect(probeDeadline({ type: "published_minimum", calendar_days: 30 }).supported).toBe(true);
    expect(probeDeadline({ type: "before_issuance" }).supported).toBe(true);
    expect(probeDeadline({ type: "research_required" }).supported).toBe(true);
    expect(probeDeadline({ type: "business_days_minimum", business_days: 10 }).supported).toBe(
      true,
    );

    const missingDays = probeDeadline({ type: "published_minimum" });
    expect(missingDays.unsupportedType).toBe(false);
    expect(missingDays.message).toContain("calendar_days");
  });

  test("the mapped kinds and statuses are the parser's verdict too", () => {
    for (const kind of ["conditional_requirement", "approval", "certificate"]) {
      expect(engineDeclaresKind(kind)).toBe(false);
    }
    for (const kind of ["permit", "insurance", "prohibition", "advisory"]) {
      expect(engineDeclaresKind(kind)).toBe(true);
    }
    for (const status of ["VERIFIED_WITH_QUALIFICATION", "CONDITIONAL"]) {
      expect(engineDeclaresStatus(status)).toBe(false);
    }
    for (const status of ["VERIFIED", "RESEARCH_REQUIRED"]) {
      expect(engineDeclaresStatus(status)).toBe(true);
    }
  });

  test("six of the nine multi-member groups mix verification statuses", () => {
    expect(
      m.inventory
        .mixedStatusGroups(m.draft)
        .map((group) => group.key)
        .sort(),
    ).toEqual([
      "block_party_eligibility",
      "nypd_sound",
      "parks_special_event",
      "sapo_insurance",
      "sapo_permit",
      "sla_alcohol",
    ]);
  });
});

describe("choosing the measured draft", () => {
  const directoryHolding = (files) => {
    const directory = mkdtempSync(join(tmpdir(), "cofiring-proposals-"));
    for (const [name, artifact] of Object.entries(files)) {
      const text = typeof artifact === "string" ? artifact : JSON.stringify(artifact);
      writeFileSync(join(directory, name), text);
    }
    return directory;
  };

  const measured = { schema: "popengine-rules/v2", ruleset_version: "nyc.v2" };

  test("an unrelated proposal alongside it does not make the draft ambiguous", () => {
    const directory = directoryHolding({
      "renamed-draft.json": measured,
      "some-other-proposal.json": { schema: "popengine-rules/v2", ruleset_version: "nyc.v3" },
      "not-a-ruleset.json": { notes: [] },
    });
    expect(measuredDraftPath(directory)).toBe(join(directory, "renamed-draft.json"));
  });

  test("an unreadable unrelated proposal does not break the lookup", () => {
    const directory = directoryHolding({
      "renamed-draft.json": measured,
      "truncated.json": '{"schema": "popengine-rules/v2",',
      "not-json-at-all.json": "# a note somebody dropped in here",
      "empty.json": "",
      "null.json": null,
      "a-number.json": 42,
      "a-string.json": '"popengine-rules/v2"',
      "an-array.json": [measured],
    });
    expect(measuredDraftPath(directory)).toBe(join(directory, "renamed-draft.json"));
  });

  test("an unreadable measured draft is reported by the identity check, not swallowed", () => {
    const directory = directoryHolding({ "the-draft.json": '{"schema": "popengine-rules/v2",' });
    expect(() => measuredDraftPath(directory)).toThrow(
      /holds 0 artifacts declaring schema "popengine-rules\/v2" version "nyc.v2"/,
    );
  });

  test("two artifacts claiming the same identity fail rather than one being picked", () => {
    const directory = directoryHolding({ "a.json": measured, "b.json": measured });
    expect(() => measuredDraftPath(directory)).toThrow(/ambiguous/);
  });

  test("the committed draft is the one the identity names", () => {
    expect(m.draft.schema).toBe(measured.schema);
    expect(m.draft.ruleset_version).toBe(measured.ruleset_version);
  });
});

describe("section 3.2, what the harness supplies", () => {
  test("the draft publishes no semantics for `is_null` or `lte`", () => {
    const described = m.inventory.operatorSemantics(m.draft);
    expect(described.find((operator) => operator.name === "is_null").describedOutsideTheList).toBe(
      false,
    );
    expect(described.find((operator) => operator.name === "lte").describedOutsideTheList).toBe(
      false,
    );
  });

  test("a semantics the draft states in prose is detected, not just one it states as a field", () => {
    const described = (draft) => m.inventory.operatorSemantics(draft);
    const named = (draft, name) =>
      described(draft).find((operator) => operator.name === name).describedOutsideTheList;

    const inProse = {
      ...m.draft,
      notes: ["is_null returns true for absent answers"],
    };
    expect(named(inProse, "is_null")).toBe(true);
    expect(named(inProse, "lte")).toBe(false);

    const asStructure = { ...m.draft, operator_semantics: { lte: "at or below the value" } };
    expect(named(asStructure, "lte")).toBe(true);

    const nested = {
      ...m.draft,
      engine_conventions: { operators: { notes: ["lte is inclusive"] } },
    };
    expect(named(nested, "lte")).toBe(true);

    const substring = { ...m.draft, notes: ["deltec_lteq is not an operator"] };
    expect(named(substring, "lte")).toBe(false);

    const applied = {
      ...m.draft,
      notes: [],
      rules: [{ id: "x", trigger: { field: "headcount", op: "lte", value: 1 } }],
    };
    expect(named(applied, "lte")).toBe(false);
  });

  test("a semantics a rule or an advisory states in its own prose is detected too", () => {
    const named = (draft, name) =>
      m.inventory.operatorSemantics(draft).find((operator) => operator.name === name)
        .describedOutsideTheList;

    const [rule, ...otherRules] = m.draft.rules;
    const inARuleNote = {
      ...m.draft,
      rules: [
        {
          ...rule,
          output: { ...rule.output, notes: ["is_null matches an answer the organizer never gave"] },
        },
        ...otherRules,
      ],
    };
    expect(named(inARuleNote, "is_null")).toBe(true);

    const [advisory, ...otherAdvisories] = m.draft.advisories;
    const inAnAdvisoryNote = {
      ...m.draft,
      advisories: [
        { ...advisory, output: { ...advisory.output, note_text: "lte is inclusive of the value" } },
        ...otherAdvisories,
      ],
    };
    expect(named(inAnAdvisoryNote, "lte")).toBe(true);

    expect(named(m.draft, "is_null")).toBe(false);
    expect(named(m.draft, "lte")).toBe(false);
  });

  test.each([
    ["a structural entry keyed `op`", { operator_semantics: { op: "lte", meaning: "inclusive" } }],
    [
      "a structure nested in a rule's output",
      { output_semantics: { operators: [{ op: "lte" }] }, id: "X" },
    ],
    ["a legend keyed by the name", { operator_legend: { lte: "at or below" } }],
    ["prose in a note", { notes: ["lte compares at or below the value"] }],
  ])("a semantics published as %s is detected wherever it sits", (_label, published) => {
    const named = (draft) =>
      draft === null
        ? null
        : m.inventory.operatorSemantics(draft).find((operator) => operator.name === "lte")
            .describedOutsideTheList;

    const [rule, ...otherRules] = m.draft.rules;
    const [advisory, ...otherAdvisories] = m.draft.advisories;
    expect(named({ ...m.draft, engine_conventions: published })).toBe(true);
    expect(named({ ...m.draft, rules: [{ ...rule, ...published }, ...otherRules] })).toBe(true);
    expect(
      named({ ...m.draft, advisories: [{ ...advisory, ...published }, ...otherAdvisories] }),
    ).toBe(true);
  });

  test("an operator applied in a condition leaf is not a statement, wherever the leaf sits", () => {
    const named = (draft, name) =>
      m.inventory.operatorSemantics(draft).find((operator) => operator.name === name)
        .describedOutsideTheList;
    const leaf = { field: "headcount", op: "lte", value: 1 };

    const [rule, ...otherRules] = m.draft.rules;
    expect(named({ ...m.draft, rules: [{ ...rule, trigger: leaf }, ...otherRules] }, "lte")).toBe(
      false,
    );
    expect(
      named(
        { ...m.draft, rules: [{ ...rule, output: { ...rule.output, when: leaf } }, ...otherRules] },
        "lte",
      ),
    ).toBe(false);
    expect(
      named(
        {
          ...m.draft,
          intake_fields: m.draft.intake_fields.map((field) =>
            field.field === "event_address" ? { ...field, asked_when: leaf } : field,
          ),
        },
        "lte",
      ),
    ).toBe(false);
  });

  test("the two fields that carry an `asked_when` are the only two, whatever their type", () => {
    expect(m.inventory.intakeFieldInventory(m.draft).conditionalFields).toEqual([
      { field: "public_space_interference", type: "enum", gates: ["location_type"] },
      {
        field: "sound_audible_in_public_space",
        type: "enum",
        gates: ["amplified_sound", "location_type"],
      },
    ]);

    const gatedString = {
      ...m.draft,
      intake_fields: m.draft.intake_fields.map((field) =>
        field.field === "event_address"
          ? { ...field, asked_when: { field: "location_type", op: "eq", value: "street" } }
          : field,
      ),
    };
    const widened = m.inventory.intakeFieldInventory(gatedString);
    expect(widened.conditionalFields).toHaveLength(3);
    expect(widened.conditionalFields.map((entry) => entry.field)).toContain("event_address");
    expect(widened.combinations).toBe(m.inventory.intakeFieldInventory(m.draft).combinations);
  });

  test("the harness agrees with the engine on every published rule and every control intake", () => {
    expect(m.control.agreement).toEqual({ comparisons: 28_612, mismatches: 0, rules: 46 });
  });

  test("the derived-value implementations are the ones the draft declares", () => {
    expect(() => assertDerivedValuesMatchDraft(m.draft)).not.toThrow();
  });

  test("a moved formula or null behaviour fails the load instead of being measured", () => {
    const moved = (name, key, value) => ({
      ...m.draft,
      derived_values: m.draft.derived_values.map((declaration) =>
        declaration.name === name ? { ...declaration, [key]: value } : declaration,
      ),
    });
    expect(() =>
      assertDerivedValuesMatchDraft(moved("structure_area_sqft", "formula", "length * width * 2")),
    ).toThrow(/structure_area_sqft/);
    expect(() =>
      assertDerivedValuesMatchDraft(moved("event_days", "null_behavior", "unknown")),
    ).toThrow(/event_days/);
    expect(() =>
      assertDerivedValuesMatchDraft({
        ...m.draft,
        derived_values: m.draft.derived_values.filter((value) => value.name !== "event_days"),
      }),
    ).toThrow(/no longer declares/);
  });

  test("a trigger reading a derived value the harness cannot compute fails the load", () => {
    const draft = {
      ...m.draft,
      rules: [
        ...m.draft.rules,
        {
          id: "SYNTHETIC-001",
          trigger: { field: "business_days_until_event", op: "gt", value: 30 },
        },
      ],
    };
    expect(() => assertDerivedValuesMatchDraft(draft)).toThrow(/business_days_until_event/);
  });

  test("the `asked_when` scoping is translated from the published object", () => {
    const askedWhen = (field) =>
      m.draft.intake_fields.find((entry) => entry.field === field).asked_when;
    expect(
      askedWhenExpression(askedWhen("public_space_interference"), "public_space_interference"),
    ).toBe("location_type in street/sidewalk/curb_lane/plaza");
    expect(
      askedWhenExpression(
        askedWhen("sound_audible_in_public_space"),
        "sound_audible_in_public_space",
      ),
    ).toBe("amplified_sound AND location_type in private_indoor/private_rooftop/private_outdoor");
  });

  test("a changed `asked_when` object changes the scope, and an inexpressible one throws", () => {
    expect(
      askedWhenExpression(
        { all: [{ field: "amplified_sound", op: "bool", value: true }] },
        "sound_audible_in_public_space",
      ),
    ).toBe("amplified_sound");
    expect(
      askedWhenExpression({ field: "location_type", op: "in", value: ["plaza"] }, "any_field"),
    ).toBe("location_type in plaza");
    expect(() =>
      askedWhenExpression({ any: [{ field: "amplified_sound", op: "bool", value: true }] }, "f"),
    ).toThrow(/any/);
    expect(() => askedWhenExpression({ field: "headcount", op: "gt", value: 20 }, "f")).toThrow(
      /"gt"/,
    );
    expect(() =>
      askedWhenExpression({ field: "amplified_sound", op: "bool", value: false }, "f"),
    ).toThrow(/false/);
  });
});

describe("section 3.3, the sweep", () => {
  test("the draft's declared intake surface, and the factorial it makes unenumerable", () => {
    const draft = m.inventory.intakeFieldInventory(m.draft);
    expect(draft.fields).toBe(63);
    expect(draft.byType).toEqual({
      enum: 29,
      boolean: 12,
      multi_enum: 2,
      integer: 10,
      number: 7,
      date: 2,
      string: 1,
    });
    expect(draft.factorialFields).toBe(43);
    expect(draft.combinations).toBe(4_119_753_311_895_158_784_000_000_000n);
    expect(Number(draft.combinations) / 1e27).toBeCloseTo(4.12, 2);
    expect(m.inventory.intakeFieldInventory(loadControl()).fields).toBe(33);
  });

  test("the opening factorial is an upper bound, and the answered product is not", () => {
    const draft = m.inventory.intakeFieldInventory(m.draft);
    expect(draft.derivedFactorialFields).toEqual([
      "governing_authority",
      "sapo_event_type",
      "street_event_size",
      "plaza_level",
      "plaza_size",
    ]);
    expect(draft.combinationsAnswered).toBe(508_611_519_987_056_640_000_000n);
    expect(Number(draft.combinationsAnswered) / 1e23).toBeCloseTo(5.09, 2);
    expect(draft.factorialFields - draft.derivedFactorialFields.length).toBe(38);
    expect(draft.combinations / draft.combinationsAnswered).toBe(8_100n);
    expect(draft.combinations % draft.combinationsAnswered).toBe(0n);
    const control = m.inventory.intakeFieldInventory(loadControl());
    expect(control.derivedFactorialFields).toEqual([]);
    expect(control.combinationsAnswered).toBe(control.combinations);
  });

  test("the factorial applies `asked_when`, and rests on no field held outside itself", () => {
    const definitions = new Map(
      buildFieldDefinitions(m.draft, { translateAskedWhen: true }).map((f) => [f.field, f]),
    );
    for (const field of ["public_space_interference", "sound_audible_in_public_space"]) {
      expect(definitions.get(field).askedWhenClauses).not.toBeNull();
    }
    const unconstrained = m.draft.intake_fields
      .filter((field) => ["enum", "boolean", "multi_enum"].includes(field.type))
      .reduce(
        (total, field) =>
          total * BigInt(domainFor(field.field, definitions.get(field.field), []).length),
        1n,
      );
    expect(unconstrained).toBe(17_656_085_622_407_823_360_000_000_000n);
    expect(m.inventory.intakeFieldInventory(m.draft).combinations * 180n).toBe(unconstrained * 42n);
    expect(m.inventory.gatesReadOutsideTheCount(m.draft)).toEqual([]);
  });

  test("a multi_enum domain is its valid selections, not its power set", () => {
    expect(validMultiEnumSelections(["a", "b", "c", "d", "none"]).length).toBe(16);
    expect(validMultiEnumSelections(["a", "b"]).length).toBe(3);
  });

  test("the sweep sizes are the published ones", () => {
    expect(Object.fromEntries(m.groups.map((group) => [group.key, group.sweep]))).toEqual({
      sapo_permit: 6_480,
      dob_temporary_structure: 14_400,
      sla_alcohol: 60,
      sapo_insurance: 36,
      nypd_sound: 156,
      parks_special_event: 120,
      fdny_generator: 4_800,
      dob_assembly: 80,
      block_party_eligibility: 32_440_320,
    });
    expect(m.totalIntakes).toBe(32_466_452);
    expect(m.control.sweep).toBe(622);
  });

  test("a numeric domain holds no value the intake contract refuses", () => {
    const headcountErrors = (headcount) =>
      validateIntake(controlContract, { headcount }, EVENT_DATE)
        .errors.filter((error) => error.field === "headcount")
        .map((error) => error.code);
    const admits = (headcount) => headcountErrors(headcount).length === 0;
    expect(headcountErrors(NUMERIC_MINIMUMS.headcount - 1)).toEqual(["must_be_positive"]);
    expect(admits(NUMERIC_MINIMUMS.headcount)).toBe(true);

    const domain = domainFor("headcount", { type: "integer", nullable: false }, [
      { trigger: { field: "headcount", op: "gt", value: 20 } },
    ]);
    expect(domain).toEqual([19, 20, 21]);
    expect(domain.every((value) => admits(value))).toBe(true);
  });

  test("the hand-set area domain is checked against the thresholds it is there to bracket", () => {
    const factors = { type: "number", nullable: true };
    const readingArea = (op, value) => [{ trigger: { field: "structure_area_sqft", op, value } }];

    expect(domainFor("structure_length_ft", factors, readingArea("gt", 400))).toEqual([
      0,
      10,
      12,
      20,
      21,
      null,
    ]);
    expect(domainFor("structure_width_ft", factors, readingArea("gte", 120))).toEqual([
      0,
      10,
      12,
      20,
      21,
      null,
    ]);
    for (const field of ["structure_length_ft", "structure_width_ft"]) {
      const domain = domainFor(field, factors, readingArea("gt", 400));
      expect(domain).toContain(0);
      expect(domain).toContain(null);
      expect(domain.filter((value) => value !== null)).toEqual(
        domainFor(field, { type: "number", nullable: false }, readingArea("gt", 400)),
      );
    }

    expect(() => domainFor("structure_length_ft", factors, readingArea("gt", 401))).toThrow(
      /is at the "structure_area_sqft" threshold 401/,
    );
    expect(() => domainFor("structure_length_ft", factors, readingArea("gt", 441))).toThrow(
      /is above the "structure_area_sqft" threshold 441/,
    );
    expect(() => domainFor("structure_length_ft", factors, readingArea("gte", 0))).toThrow(
      /is below the "structure_area_sqft" threshold 0/,
    );
  });

  test("the date domain is the artifact's declared nullability, not a fixed three values", () => {
    const declared = m.draft.intake_fields.find((field) => field.field === "event_end_date");
    expect(declared.nullable).toBe(true);
    expect(domainFor("event_end_date", declared, [])).toEqual([
      "2026-08-31",
      EVENT_DATE,
      "2026-09-02",
      null,
    ]);
    expect(domainFor("event_end_date", { type: "date" }, [])).toEqual([
      "2026-08-31",
      EVENT_DATE,
      "2026-09-02",
    ]);

    expect(domainFor("event_date", { type: "date" }, [])).toEqual([EVENT_DATE]);

    expect(() => domainFor("permit_filing_date", { type: "date", nullable: true }, [])).toThrow(
      /no domain rule for date field "permit_filing_date"/,
    );
  });

  test("the end date sweeps below, at and above the one `event_days` threshold", () => {
    const declared = m.draft.intake_fields.find((field) => field.field === "event_end_date");
    const days = (end) =>
      DERIVED_VALUES.event_days.compute({ event_date: EVENT_DATE, event_end_date: end });
    expect(domainFor("event_end_date", declared, []).map(days).sort()).toEqual([0, 1, 1, 2]);

    const control = loadControl();
    const datesContract = parseIntakeContract({
      ...control,
      intake_fields: [...control.intake_fields, declared],
    });
    const errorsFor = (answers) =>
      validateIntake(datesContract, answers, EVENT_DATE)
        .errors.filter((error) => error.field === "event_date" || error.field === "event_end_date")
        .map((error) => error.code);
    expect(errorsFor({ event_date: EVENT_DATE, event_end_date: "2026-08-31" })).toEqual([]);
    expect(errorsFor({ event_date: EVENT_DATE, event_end_date: "2026-09-02" })).toEqual([]);
    expect(errorsFor({ event_date: "2026-08-31", event_end_date: EVENT_DATE })).toEqual([
      "in_the_past",
    ]);
  });

  test("the draft publishes no date field the sweep has no rule for", () => {
    const dates = m.draft.intake_fields.filter((field) => field.type === "date");
    expect(dates.map((field) => field.field).sort()).toEqual(["event_date", "event_end_date"]);
  });
});

const NUMERIC_LEAVES = [
  ["ADV-GENERATOR-SPECS-MISSING-001", "generator_aggregate_tank_gallons", "is_null", true],
  ["ADV-STRUCTURE-SPECS-MISSING-001", "structure_duration_days", "is_null", true],
  ["ADV-STRUCTURE-SPECS-MISSING-001", "structure_height_ft", "is_null", true],
  ["ADV-STRUCTURE-SPECS-MISSING-001", "structure_length_ft", "is_null", true],
  ["ADV-STRUCTURE-SPECS-MISSING-001", "structure_width_ft", "is_null", true],
  ["DEP-GENERATOR-POWER-001", "generator_power_kw", "gt", 40],
  ["DOB-ASSEMBLY-INDOOR-001", "peak_concurrent_attendance", "gte", 75],
  ["DOB-ASSEMBLY-OUTDOOR-001", "peak_concurrent_attendance", "gte", 200],
  ["DOB-ASSEMBLY-ROOFTOP-001", "peak_concurrent_attendance", "gte", 75],
  ["DOB-STAGE-001", "structure_area_sqft", "gte", 120],
  ["DOB-STAGE-001", "structure_height_ft", "gt", 2],
  ["DOB-STRUCTURE-DURATION-001", "structure_duration_days", "gte", 30],
  ["DOB-TENT-AREA-001", "structure_area_sqft", "gt", 400],
  ["DOB-TENT-DURATION-001", "structure_duration_days", "gte", 30],
  ["DOB-TRUSS-001", "structure_height_ft", "gt", 10],
  ["FDNY-BATTERY-001", "outdoor_battery_kwh", "gt", 20],
  ["FDNY-GENERATOR-DIESEL-001", "generator_aggregate_tank_gallons", "gt", 10],
  ["FDNY-GENERATOR-GASOLINE-001", "generator_aggregate_tank_gallons", "gt", 2.5],
  ["PARKS-EXACT-20-CONFLICT-001", "headcount", "eq", 20],
  ["PARKS-SPECIAL-ELEMENT-001", "headcount", "lte", 20],
  ["PARKS-SPECIAL-EVENT-001", "headcount", "gt", 20],
  ["PARKS-TUA-001", "headcount", "gt", 500],
  ["SAPO-BLOCK-PARTY-ELIGIBILITY-UNKNOWN-001", "block_count", "is_null", true],
  ["SAPO-BLOCK-PARTY-ELIGIBILITY-UNKNOWN-001", "event_duration_hours", "is_null", true],
  ["SAPO-BLOCK-PARTY-INELIGIBLE-001", "block_count", "gt", 1],
  ["SAPO-BLOCK-PARTY-INELIGIBLE-001", "event_days", "gt", 1],
  ["SAPO-BLOCK-PARTY-INELIGIBLE-001", "event_duration_hours", "gt", 9],
  ["SAPO-PLAZA-A-MULTI-001", "plaza_block_count", "gt", 1],
  ["SAPO-PLAZA-A-ONE-001", "plaza_block_count", "eq", 1],
  ["SAPO-PLAZA-B-MULTI-001", "plaza_block_count", "gt", 1],
  ["SAPO-PLAZA-B-ONE-001", "plaza_block_count", "eq", 1],
];

describe("section 3.4, the limitations", () => {
  test("limitation 3: every numeric leaf names its own constant", () => {
    expect(m.inventory.numericOperators(m.draft)).toEqual(["eq", "gt", "gte", "is_null", "lte"]);

    const leaves = m.inventory.numericLeaves(m.draft);
    for (const leaf of leaves) {
      const where = `${leaf.rule}: ${leaf.field} ${leaf.op}`;
      if (m.inventory.OPERAND_FREE_NUMERIC_OPERATORS.has(leaf.op)) {
        expect([where, typeof leaf.value]).toEqual([where, "boolean"]);
      } else {
        expect([where, typeof leaf.value, Number.isFinite(leaf.value)]).toEqual([
          where,
          "number",
          true,
        ]);
      }
    }

    expect(leaves.map((leaf) => [leaf.rule, leaf.field, leaf.op, leaf.value])).toEqual(
      NUMERIC_LEAVES,
    );
  });

  test("limitation 4: `event_days` is the only date-derived value a trigger reads", () => {
    expect(m.inventory.derivedValuesRead(m.draft).sort()).toEqual([
      "effective_fuel_types",
      "event_days",
      "structure_area_sqft",
    ]);
  });

  test("limitation 9: which sweeps are products over draft-derived classifications", () => {
    expect(Object.fromEntries(m.groups.map((group) => [group.key, group.derivedFields]))).toEqual({
      sapo_permit: [
        "sapo_event_type",
        "street_event_size",
        "plaza_level",
        "plaza_block_count",
        "plaza_size",
      ],
      block_party_eligibility: ["sapo_event_type"],
      sapo_insurance: ["sapo_event_type"],
      parks_special_event: [],
      nypd_sound: [],
      fdny_generator: [],
      dob_assembly: [],
      dob_temporary_structure: [],
      sla_alcohol: [],
    });
  });

  test("limitation 9: the published control derives no intake field, so it is not qualified", () => {
    expect(m.draft.intake_fields.filter((field) => field.derived === true)).not.toHaveLength(0);
    expect(loadControl().intake_fields.filter((field) => field.derived === true)).toHaveLength(0);
  });

  test("limitation 5: three rules read a fuel field, each in a single-member group", () => {
    expect(m.inventory.fuelFieldReaders(m.draft)).toEqual([
      { id: "FDNY-FUEL-001", dedupeKey: "fdny_fuel" },
      { id: "FDNY-OPEN-FLAME-001", dedupeKey: "fdny_open_flame" },
      { id: "PARKS-PROPANE-PROHIBITION-001", dedupeKey: "parks_propane" },
    ]);
  });
});

describe("section 4.1, findings per event", () => {
  test.each([
    ["sapo_permit", [1_034, 4_332, 100, 144, 100, 34, 212, 200, 94, 80, 80, 10, 50, 0, 10]],
    ["dob_temporary_structure", [6_884, 4_622, 2_262, 350, 198, 84]],
    ["sla_alcohol", [37, 11, 2, 4, 2, 4]],
    ["sapo_insurance", [4, 26, 2, 2, 2]],
    ["nypd_sound", [84, 27, 36, 9, 0]],
    ["parks_special_event", [98, 22, 0, 0]],
    ["fdny_generator", [2_686, 1_706, 344, 64]],
    ["dob_assembly", [59, 15, 3, 3]],
    ["block_party_eligibility", [25_231_396, 983_004, 6_225_920]],
  ])("%s", (key, distribution) => {
    expect(m.group(key).findings).toEqual(distribution);
  });
});

describe("section 4.2, the same sweeps counting only `true` triggers", () => {
  test.each([
    ["sapo_permit", [2_268, 4_212]],
    ["dob_temporary_structure", [10_476, 3_468, 456]],
    ["sla_alcohol", [43, 17]],
    ["sapo_insurance", [9, 27]],
    ["nypd_sound", [90, 58, 8]],
    ["parks_special_event", [109, 11]],
    ["fdny_generator", [3_913, 852, 35]],
    ["dob_assembly", [68, 12]],
    ["block_party_eligibility", [28_836_056, 1_107_432, 2_496_832]],
  ])("%s", (key, head) => {
    expect(m.group(key).true.slice(0, head.length)).toEqual(head);
    expect(
      m
        .group(key)
        .true.slice(head.length)
        .every((count) => count === 0),
    ).toBe(true);
  });
});

const COMPLETE_FINDINGS = {
  sapo_permit: [312, 1_224, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  dob_temporary_structure: [3_906, 1_950, 444, 0, 0, 0],
  sla_alcohol: [17, 7, 0, 0, 0, 0],
  sapo_insurance: [2, 14, 0, 0, 0],
  nypd_sound: [52, 24, 8, 0, 0],
  parks_special_event: [97, 11, 0, 0],
  fdny_generator: [1_479, 502, 35, 0],
  dob_assembly: [51, 12, 0, 0],
  block_party_eligibility: [1_720_338, 245_742, 0],
};

describe("section 4.3, completeness", () => {
  test.each([
    ["sapo_permit", 1_536, 0, 0],
    ["dob_temporary_structure", 6_300, 444, 444],
    ["sla_alcohol", 24, 0, 0],
    ["sapo_insurance", 16, 0, 0],
    ["nypd_sound", 84, 8, 8],
    ["parks_special_event", 108, 0, 0],
    ["fdny_generator", 2_016, 35, 35],
    ["dob_assembly", 63, 0, 0],
    ["block_party_eligibility", 1_966_080, 0, 0],
  ])("%s", (key, complete, andTwoFindings, andTwoTrue) => {
    const group = m.group(key);
    expect(group.complete).toBe(complete);
    expect(group.completeAndTwoFindings).toBe(andTwoFindings);
    expect(group.completeAndTwoTrue).toBe(andTwoTrue);
  });

  test("on a complete intake no draft member's trigger is ever `unknown`", () => {
    expect(Object.fromEntries(m.groups.map((g) => [g.key, g.completeUnknownResults]))).toEqual(
      Object.fromEntries(m.groups.map((g) => [g.key, 0])),
    );

    for (const group of m.groups) {
      expect(group.completeFindings).toEqual(group.completeTrue);
      expect(group.completeFindings.reduce((total, count) => total + count, 0)).toBe(
        group.complete,
      );
    }
  });

  test("the complete distributions are the published ones", () => {
    expect(
      Object.fromEntries(m.groups.map((group) => [group.key, group.completeFindings])),
    ).toEqual(COMPLETE_FINDINGS);
  });

  test("three of the nine co-fire on a complete intake", () => {
    expect(
      m.groups
        .filter((group) => group.completeAndTwoFindings > 0)
        .map((group) => group.key)
        .sort(),
    ).toEqual(["dob_temporary_structure", "fdny_generator", "nypd_sound"]);
  });

  test("`block_party_eligibility` reaches two `true` triggers, never on a complete intake", () => {
    const group = m.group("block_party_eligibility");
    expect(group.true[2]).toBe(2_496_832);
    expect(group.completeAndTwoTrue).toBe(0);
  });

  test("`sapo_permit` co-fires 1,114 times, 720 of them on an unknown event type", () => {
    const group = m.group("sapo_permit");
    expect(coFiringEvents(group)).toBe(1_114);
    expect(unsettledAcrossCoFiring(group).get("sapo_event_type")).toBe(720);
  });
});

describe("section 4.4, the published control", () => {
  test("the one multi-member group these figures describe is asserted, not assumed", () => {
    expect(m.control.key).toBe("dob-structure");
    const control = parseEngineRuleset(loadControl());
    const added = { ...control.rules[0], dedupeKey: "a_second_group" };
    expect(() =>
      sweepControl({
        ...control,
        rules: [
          ...control.rules,
          { ...added, id: "SECOND-GROUP-A-001" },
          { ...added, id: "SECOND-GROUP-B-001" },
        ],
      }),
    ).toThrow(/2 multi-member dedupe groups \(dob-structure, a_second_group\)/);
  });

  test("the distributions", () => {
    expect(m.control.sweep).toBe(622);
    expect(m.control.complete).toBe(271);
    expect(m.control.findings).toEqual([42, 244, 336]);
    expect(m.control.true).toEqual([208, 310, 104]);
    expect(m.control.completeFindings).toEqual([41, 134, 96]);
    expect(m.control.completeTrue).toEqual([57, 134, 80]);
  });

  test("the four co-firing shapes", () => {
    const shape = (results) =>
      m.control.shapes.find((entry) => entry.results.join("/") === results);
    expect(shape("true/true")).toMatchObject({ count: 104, complete: 80 });
    expect(shape("true/unknown")).toMatchObject({ count: 104, complete: 0 });
    expect(shape("unknown/true")).toMatchObject({ count: 64, complete: 16 });
    expect(shape("unknown/unknown")).toMatchObject({ count: 64, complete: 0 });
  });

  test("a complete intake still reaches the merge with an undecided member", () => {
    const shape = m.control.shapes.find((entry) => entry.results.join("/") === "unknown/true");
    expect(shape.firstCompleteIntake).toEqual({
      structure_types: ["tent_canopy"],
      tent_area_sqft: 400,
      tent_days_in_place: 0,
      structure_over_10ft_tall: "yes",
    });
  });
});

const SAPO_FEES = [
  [
    "SAPO-STREET-SMALL-001",
    3_100,
    "$3,100 per location per day, plus $25 nonrefundable processing fee",
  ],
  [
    "SAPO-STREET-MEDIUM-001",
    11_000,
    "$11,000 per location per day, plus $25 nonrefundable processing fee",
  ],
  [
    "SAPO-STREET-LARGE-001",
    25_000,
    "$25,000 per location per day, plus $25 nonrefundable processing fee",
  ],
  [
    "SAPO-STREET-EXTRA-LARGE-001",
    null,
    "Up to $66,000 per location per day, plus $25 processing fee",
  ],
  [
    "SAPO-PRODUCTION-001",
    null,
    "$290/day for curb lane or sidewalk only; $700/day for curb lane and sidewalk; plus $25 processing fee",
  ],
  ["SAPO-BLOCK-PARTY-001", null, "$25 nonrefundable processing fee; no additional SAPO event fee"],
  [
    "SAPO-SINGLE-BLOCK-FESTIVAL-001",
    null,
    "20% of total fees paid by vendors, plus $25 processing fee",
  ],
  [
    "SAPO-STREET-FESTIVAL-001",
    null,
    "20% of total vendor participation fees, plus $25 processing fee",
  ],
  [
    "SAPO-PLAZA-A-ONE-001",
    null,
    "Event fee depends on plaza level, size, borough, and plaza-partner charges; see the verified fee matrix.",
  ],
  [
    "SAPO-PLAZA-B-ONE-001",
    null,
    "Event fee depends on plaza level, size, borough, and plaza-partner charges; see the verified fee matrix.",
  ],
  [
    "SAPO-PLAZA-B-MULTI-001",
    null,
    "Event fee depends on plaza level, size, borough, and plaza-partner charges; see the verified fee matrix.",
  ],
  [
    "SAPO-PLAZA-C-001",
    null,
    "Event fee depends on plaza level, size, borough, and plaza-partner charges; see the verified fee matrix.",
  ],
  [
    "SAPO-PLAZA-D-001",
    null,
    "Event fee depends on plaza level, size, borough, and plaza-partner charges; see the verified fee matrix.",
  ],
  [
    "SAPO-PLAZA-A-MULTI-001",
    null,
    "Event fee depends on plaza size; current Level A listed fees are $15,500 or $31,000, plus processing and possible partner fees.",
  ],
];

describe("section 5, the co-firing sets", () => {
  test("5.1 `sapo_permit`: 72 sets, the widest 14 of 14, ten times", () => {
    const group = m.group("sapo_permit");
    expect(group.sets.length).toBe(72);
    const widest = group.sets.filter((set) => set.members.length === 14);
    expect(widest.map((set) => set.count)).toEqual([10]);
    expect(widest[0].firstIntake).toEqual({
      sapo_event_type: "unknown",
      street_event_size: "unknown",
      plaza_level: "unknown",
      plaza_block_count: null,
      plaza_size: "small",
    });
  });

  test("5.1 which dimension each `sapo_permit` member is keyed on", () => {
    expect(
      Object.fromEntries(
        m.inventory
          .triggerFieldsByMember(m.draft, "sapo_permit")
          .map((member) => [member.id, member.fields]),
      ),
    ).toEqual({
      "SAPO-STREET-SMALL-001": ["sapo_event_type", "street_event_size"],
      "SAPO-STREET-MEDIUM-001": ["sapo_event_type", "street_event_size"],
      "SAPO-STREET-LARGE-001": ["sapo_event_type", "street_event_size"],
      "SAPO-STREET-EXTRA-LARGE-001": ["sapo_event_type"],
      "SAPO-PRODUCTION-001": ["sapo_event_type"],
      "SAPO-BLOCK-PARTY-001": ["sapo_event_type"],
      "SAPO-SINGLE-BLOCK-FESTIVAL-001": ["sapo_event_type"],
      "SAPO-STREET-FESTIVAL-001": ["sapo_event_type"],
      "SAPO-PLAZA-A-ONE-001": ["sapo_event_type", "plaza_level", "plaza_block_count", "plaza_size"],
      "SAPO-PLAZA-B-ONE-001": ["sapo_event_type", "plaza_level", "plaza_block_count", "plaza_size"],
      "SAPO-PLAZA-B-MULTI-001": [
        "sapo_event_type",
        "plaza_level",
        "plaza_block_count",
        "plaza_size",
      ],
      "SAPO-PLAZA-C-001": ["sapo_event_type", "plaza_level", "plaza_size"],
      "SAPO-PLAZA-D-001": ["sapo_event_type", "plaza_level", "plaza_size"],
      "SAPO-PLAZA-A-MULTI-001": [
        "sapo_event_type",
        "plaza_level",
        "plaza_block_count",
        "plaza_size",
      ],
    });
  });

  test("5.1 the SAPO inventory, re-derived by parsing the draft", () => {
    const sapo = m.inventory.sapoPermitInventory(m.draft);
    expect(sapo.calendarDayValues.map((entry) => entry.calendarDays)).toEqual([
      14, 30, 45, 10, 60, 45, 30, 45, 30, 14, 60,
    ]);
    expect(
      [...new Set(sapo.calendarDayValues.map((entry) => entry.calendarDays))].sort((a, b) => a - b),
    ).toEqual([10, 14, 30, 45, 60]);
    expect(sapo.deadlineTypes).toEqual({
      published_minimum: 11,
      conditional: 1,
      official_conflict: 1,
      fixed_annual_date: 1,
    });
    expect(sapo.permitNames).toEqual([
      "Street Event Permit",
      "Extra Large Street/Plaza Event Permit",
      "Production Event Permit",
      "Block Party Permit",
      "Single Block Festival Permit",
      "Street Festival Permit",
      "Plaza Event Permit",
    ]);
    expect(sapo.sharedFields).toEqual(["agency", "portal"]);
  });

  test("5.1 the fee inventory the section publishes is the draft's own", () => {
    const fees = m.inventory.sapoPermitInventory(m.draft).fees;
    expect(fees.map((fee) => [fee.id, fee.eventFeeUsd, fee.display])).toEqual(SAPO_FEES);

    expect(fees.every((fee) => fee.processingFeeUsd === 25)).toBe(true);

    const displays = fees.map((fee) => fee.display);
    expect(displays.filter((text) => /^\$[\d,]+ per location per day/.test(text))).toHaveLength(3);
    expect(displays.filter((text) => text.includes("20%"))).toHaveLength(2);
    expect(displays.filter((text) => text.includes("see the verified fee matrix"))).toHaveLength(5);
    expect(displays.filter((text) => text.includes("$15,500 or $31,000"))).toHaveLength(1);

    expect(displays).toContain("Up to $66,000 per location per day, plus $25 processing fee");
    expect(displays).toContain("$25 nonrefundable processing fee; no additional SAPO event fee");
  });

  test("5.2 `dob_temporary_structure`: 18 sets, two of them all-`true`", () => {
    const group = m.group("dob_temporary_structure");
    expect(group.sets.length).toBe(18);
    expect(
      setNamed(group, ["DOB-STAGE-001", "DOB-STRUCTURE-DURATION-001"], ["true", "true"]),
    ).toMatchObject({
      count: 360,
      complete: 360,
      setComplete: 360,
    });
    expect(
      setNamed(group, ["DOB-TENT-AREA-001", "DOB-TENT-DURATION-001"], ["true", "true"]),
    ).toMatchObject({
      count: 96,
      complete: 84,
      setComplete: 96,
    });
    expect(m.inventory.distinctOutputs(m.draft, "dob_temporary_structure").size).toBe(1);
  });

  test("5.3 `sla_alcohol`: 8 sets, five distinct outputs", () => {
    expect(m.group("sla_alcohol").sets.length).toBe(8);
    expect(m.inventory.distinctOutputs(m.draft, "sla_alcohol").size).toBe(5);
  });

  test("5.4 `sapo_insurance`: 5 sets, four distinct outputs", () => {
    const group = m.group("sapo_insurance");
    expect(group.sets.length).toBe(5);
    expect(m.inventory.distinctOutputs(m.draft, "sapo_insurance").size).toBe(4);
    const pair = setNamed(
      group,
      ["SAPO-INSURANCE-GENERAL-001", "SAPO-INSURANCE-BLOCK-EXEMPT-001"],
      ["unknown", "unknown"],
    );
    expect(pair).toMatchObject({ count: 1, complete: 0 });
    expect(pair.firstIntake).toEqual({ sapo_event_type: "unknown", block_party_has_ride: "no" });
  });

  test("5.5 `nypd_sound`: 7 sets, three distinct outputs, two all-`true` pairs", () => {
    const group = m.group("nypd_sound");
    expect(group.sets.length).toBe(7);
    expect(m.inventory.distinctOutputs(m.draft, "nypd_sound").size).toBe(3);
    expect(
      setNamed(
        group,
        ["NYPD-SOUND-PUBLIC-001", "NYPD-SOUND-COMMERCIAL-ADVERTISING-PROHIBITED-001"],
        ["true", "true"],
      ),
    ).toMatchObject({ count: 5, complete: 5 });
    expect(
      setNamed(
        group,
        ["NYPD-SOUND-PRIVATE-AUDIBLE-001", "NYPD-SOUND-COMMERCIAL-ADVERTISING-PROHIBITED-001"],
        ["true", "true"],
      ),
    ).toMatchObject({ count: 3, complete: 3 });
  });

  test("5.5 the two sound permits never co-fire", () => {
    const group = m.group("nypd_sound");
    const together = group.sets.filter(
      (set) =>
        set.members.includes("NYPD-SOUND-PUBLIC-001") &&
        set.members.includes("NYPD-SOUND-PRIVATE-AUDIBLE-001"),
    );
    expect(together).toEqual([]);
  });

  test("5.6 `parks_special_event` never co-fires", () => {
    expect(m.group("parks_special_event").sets).toEqual([]);
  });

  test("5.7 `fdny_generator`: 11 sets, one output", () => {
    const group = m.group("fdny_generator");
    expect(group.sets.length).toBe(11);
    expect(m.inventory.distinctOutputs(m.draft, "fdny_generator").size).toBe(1);
    expect(
      setNamed(group, ["FDNY-GENERATOR-GASOLINE-001", "FDNY-BATTERY-001"], ["true", "true"]),
    ).toMatchObject({ count: 28, complete: 28 });
    expect(
      setNamed(group, ["FDNY-GENERATOR-DIESEL-001", "FDNY-BATTERY-001"], ["true", "true"]),
    ).toMatchObject({ count: 7, complete: 7 });
    expect(
      setNamed(
        group,
        ["FDNY-GENERATOR-GASOLINE-001", "FDNY-GENERATOR-DIESEL-001"],
        ["unknown", "unknown"],
      ),
    ).toMatchObject({ count: 136, complete: 0 });
  });

  test("5.8 `dob_assembly`: 2 sets, one output", () => {
    const group = m.group("dob_assembly");
    expect(group.sets.map((set) => [set.count, set.complete])).toEqual([
      [3, 0],
      [3, 0],
    ]);
    expect(m.inventory.distinctOutputs(m.draft, "dob_assembly").size).toBe(1);
  });

  test("5.9 the both-true intake the section quotes is the one the sweep reaches first", () => {
    const group = m.group("block_party_eligibility");
    expect(setNamed(group, group.memberIds, ["true", "true"]).firstIntake).toEqual({
      sapo_event_type: "block_party",
      has_sales: true,
      has_fundraising: true,
      alcohol: true,
      has_vendors: true,
      branding_or_promotion: "yes",
      commercial_sponsorship: true,
      rain_date_requested: true,
      open_to_all_block_neighbors: "yes",
      neighbor_permission_received: "yes",
      block_count: 0,
      event_duration_hours: 0,
      event_date: "2026-09-01",
      event_end_date: "2026-08-31",
      event_days: 0,
      organizer_type: "unknown",
    });
  });

  test("5.9 `block_party_eligibility`: four sets, none complete", () => {
    const group = m.group("block_party_eligibility");
    expect(group.sets.map((set) => [set.count, set.complete])).toEqual([
      [3_113_122, 0],
      [2_496_832, 0],
      [614_238, 0],
      [1_728, 0],
    ]);
  });
});

describe("section 6, the blocker-plus-window shape", () => {
  test("the draft publishes four blockers, all `kind: prohibition`", () => {
    expect(m.inventory.blockingRules(m.draft)).toEqual([
      {
        id: "SAPO-BLOCK-PARTY-INELIGIBLE-001",
        kind: "prohibition",
        dedupeKey: "block_party_eligibility",
        members: 2,
      },
      {
        id: "SAPO-ALCOHOL-PROHIBITION-001",
        kind: "prohibition",
        dedupeKey: "sapo_alcohol",
        members: 1,
      },
      {
        id: "NYPD-SOUND-COMMERCIAL-ADVERTISING-PROHIBITED-001",
        kind: "prohibition",
        dedupeKey: "nypd_sound",
        members: 4,
      },
      {
        id: "PARKS-PROPANE-PROHIBITION-001",
        kind: "prohibition",
        dedupeKey: "parks_propane",
        members: 1,
      },
    ]);
  });

  test("each blocker's disposition is the engine's own default for `prohibition`", () => {
    for (const blocker of m.inventory.blockingRules(m.draft)) {
      const parsed = m.inventory.parserVisibleOutput(m.draft, blocker.id);
      expect(parsed.publishedDisposition).toBeNull();
      expect(parsed.effectiveDisposition).toBe("prohibited_or_ineligible");
    }
  });

  test("the prohibition now outranks the sound permits it co-fires with", () => {
    const prohibition = m.inventory.parserVisibleOutput(
      m.draft,
      "NYPD-SOUND-COMMERCIAL-ADVERTISING-PROHIBITED-001",
    ).effectiveDisposition;
    for (const permitId of ["NYPD-SOUND-PUBLIC-001", "NYPD-SOUND-PRIVATE-AUDIBLE-001"]) {
      const permit = m.inventory.parserVisibleOutput(m.draft, permitId);
      expect(permit.effectiveDisposition).toBe("required");
      expect(m.inventory.strongerDisposition(prohibition, permit.effectiveDisposition)).toBe(
        prohibition,
      );
    }
  });

  test("the prohibition co-fires `unknown`-side on a further 28 intakes, in four shapes", () => {
    const group = m.group("nypd_sound");
    const unknownSide = setsWith(
      group,
      "NYPD-SOUND-COMMERCIAL-ADVERTISING-PROHIBITED-001",
      "unknown",
    );
    const shape = (set) => ({
      count: set.count,
      complete: set.complete,
      firing: group.memberIds
        .map((id, index) => `${id}:${set.results[index]}`)
        .filter((entry) => !entry.endsWith(":false")),
      soundPurposeAnswered: set.count - (set.unsettled.get("sound_purpose") ?? 0),
    });
    expect(unknownSide.map(shape)).toEqual([
      {
        count: 10,
        complete: 0,
        firing: [
          "NYPD-SOUND-PUBLIC-001:true",
          "NYPD-SOUND-COMMERCIAL-ADVERTISING-PROHIBITED-001:unknown",
        ],
        soundPurposeAnswered: 0,
      },
      {
        count: 9,
        complete: 0,
        firing: [
          "NYPD-SOUND-PRIVATE-AUDIBLE-001:unknown",
          "NYPD-SOUND-PRIVATE-UNKNOWN-001:true",
          "NYPD-SOUND-COMMERCIAL-ADVERTISING-PROHIBITED-001:unknown",
        ],
        soundPurposeAnswered: 3,
      },
      {
        count: 6,
        complete: 0,
        firing: [
          "NYPD-SOUND-PRIVATE-AUDIBLE-001:true",
          "NYPD-SOUND-COMMERCIAL-ADVERTISING-PROHIBITED-001:unknown",
        ],
        soundPurposeAnswered: 0,
      },
      {
        count: 3,
        complete: 0,
        firing: [
          "NYPD-SOUND-PUBLIC-001:unknown",
          "NYPD-SOUND-COMMERCIAL-ADVERTISING-PROHIBITED-001:unknown",
        ],
        soundPurposeAnswered: 1,
      },
    ]);
  });

  test("the advisory that fires `true` on the 9-row shape carries no deadline `parseRule` reads", () => {
    const parsed = m.inventory.parserVisibleOutput(m.draft, "NYPD-SOUND-PRIVATE-UNKNOWN-001");
    expect(parsed.unreadFields).toContain("candidate_requirement");
    const advisory = [...m.draft.rules, ...m.draft.advisories].find(
      (rule) => rule.id === "NYPD-SOUND-PRIVATE-UNKNOWN-001",
    );
    expect(advisory.output.deadline).toBeUndefined();
    expect(advisory.output.candidate_requirement.deadline.calendar_days).toBe(5);
  });

  test("which shapes actually merge to a prohibited line, put to the engine", () => {
    const gate = (field) => ({ all: [{ field, op: "eq", value: "yes" }] });
    const member = (id, kind, output, field) => ({
      id,
      kind,
      trigger: gate(field),
      output: { ...output, dedupe_key: "nypd_sound" },
      verification: { status: "SOURCE_CONFIRMED" },
      source: { citation: `citation ${id}`, urls: [`https://example.test/${id}`] },
    });
    const enumField = (field) => ({ field, type: "enum", values: ["yes", "no"] });
    const ruleset = parseEngineRuleset({
      ruleset_version: "cofiring-section-6.v1",
      jurisdiction: "US-NY-NYC",
      snapshot_date: "2026-07-22",
      config: {
        slack_warning_days: { value: 7 },
        business_day_math: { calendar: "cofiring-calendar@2026" },
      },
      intake_fields: [
        { field: "event_date", type: "date" },
        enumField("prohibition_gate"),
        enumField("permit_gate"),
        enumField("advisory_gate"),
      ],
      rules: [
        member(
          "PROHIBITION",
          "prohibition",
          { status: "PROHIBITED_USE", message: "section 10-108" },
          "prohibition_gate",
        ),
        member(
          "PERMIT",
          "permit",
          {
            permit_name: "Sound Device Permit",
            agency: "NYPD",
            deadline: { type: "published_minimum", calendar_days: 5 },
          },
          "permit_gate",
        ),
        member(
          "ADVISORY",
          "advisory",
          { advisory_text: "a permit may be required" },
          "advisory_gate",
        ),
      ],
      advisories: [],
    });
    const mergedLine = (gates) => {
      const plan = evaluate({ event_date: EVENT_DATE, ...gates }, ruleset, "2026-07-22", {
        id: "cofiring-calendar@2026",
        holidays: [],
      });
      expect(plan.findings).toHaveLength(1);
      const [finding] = plan.findings;
      return {
        disposition: finding.disposition,
        name: finding.name,
        quotesTheWindow: finding.latestApplyDate !== null,
      };
    };
    const blockerPlusWindow = {
      disposition: "prohibited_or_ineligible",
      name: null,
      quotesTheWindow: true,
    };
    expect(
      mergedLine({ prohibition_gate: "yes", permit_gate: "yes", advisory_gate: "no" }),
    ).toEqual(blockerPlusWindow);
    expect(mergedLine({ prohibition_gate: null, permit_gate: "yes", advisory_gate: "no" })).toEqual(
      {
        disposition: "required",
        name: "Sound Device Permit",
        quotesTheWindow: true,
      },
    );
    expect(mergedLine({ prohibition_gate: null, permit_gate: null, advisory_gate: "yes" })).toEqual(
      blockerPlusWindow,
    );
    expect(mergedLine({ prohibition_gate: null, permit_gate: null, advisory_gate: "no" })).toEqual(
      blockerPlusWindow,
    );
  });

  test.each([
    "SAPO-BLOCK-PARTY-INELIGIBLE-001",
    "NYPD-SOUND-COMMERCIAL-ADVERTISING-PROHIBITED-001",
  ])("%s publishes nothing `parseRule` turns into a name or a disposition", (ruleId) => {
    const parsed = m.inventory.parserVisibleOutput(m.draft, ruleId);
    expect(parsed.name).toBeNull();
    expect(parsed.publishedDisposition).toBeNull();
    expect(parsed.unreadFields).toContain("status");
  });

  test("`agency` is a field the parser reads, on every draft rule that publishes one", () => {
    const publishing = [...m.draft.rules, ...m.draft.advisories].filter(
      (rule) => rule.output?.agency !== undefined,
    );
    expect(publishing).toHaveLength(42);
    for (const rule of publishing) {
      expect(m.inventory.parserVisibleOutput(m.draft, rule.id).unreadFields).not.toContain(
        "agency",
      );
    }
  });

  test("the advisory it merges with does publish a name", () => {
    expect(
      m.inventory.parserVisibleOutput(m.draft, "SAPO-BLOCK-PARTY-ELIGIBILITY-UNKNOWN-001").name,
    ).not.toBeNull();
  });

  test("which of the draft's output fields `parseRule` reads, put to `parseRule`", () => {
    const keys = [
      ...new Set(
        [...m.draft.rules, ...m.draft.advisories].flatMap((rule) => Object.keys(rule.output)),
      ),
    ];
    expect(keys.filter((key) => m.inventory.parserReadsOutputField(key)).sort()).toEqual([
      "advisory_text",
      "agency",
      "deadline",
      "dedupe_key",
      "fee",
      "note_text",
      "permit_name",
      "portal",
      "requirement_name",
    ]);
    for (const key of ["disposition", "notes", "user_summary"]) {
      expect(m.inventory.parserReadsOutputField(key)).toBe(true);
    }
    for (const key of ["conflict_text", "message", "candidate_requirement", "status"]) {
      expect(m.inventory.parserReadsOutputField(key)).toBe(false);
    }
  });

  test("the name and the disposition are the parser's too, and not a fallback chain restated", () => {
    const asDraft = (output) => ({
      rules: [{ id: "PROBE-001", kind: "permit", output }],
      advisories: [],
    });
    const visible = (output) => m.inventory.parserVisibleOutput(asDraft(output), "PROBE-001");
    expect(visible({ note_text: "note", permit_name: "permit" }).name).toBe("permit");
    expect(visible({ status: "PROHIBITED" }).name).toBeNull();
    expect(visible({ disposition: "PROHIBITED_OR_INELIGIBLE" })).toMatchObject({
      publishedDisposition: "prohibited_or_ineligible",
      effectiveDisposition: "prohibited_or_ineligible",
    });
    expect(visible({ status: "PROHIBITED" }).effectiveDisposition).toBe("required");
  });
});

describe("section 7, the summary restatements", () => {
  test("the rounded block-party denominator is the sweep it restates", () => {
    const group = m.group("block_party_eligibility");
    expect(Math.round(group.sweep / 100_000) / 10).toBe(32.4);
    expect(Math.round((group.true[2] / group.sweep) * 1_000) / 10).toBe(7.7);
  });
});

describe("section 8, the harness footprint", () => {
  test("the published line counts are the files' own", () => {
    const lines = (name) =>
      readFileSync(new URL(`./${name}`, import.meta.url), "utf8").split("\n").length - 1;
    const counts = {
      "harness.mjs": lines("harness.mjs"),
      "staging.mjs": lines("staging.mjs"),
      "inventory.mjs": lines("inventory.mjs"),
      "report.mjs": lines("report.mjs"),
      "cofiring.test.mjs": lines("cofiring.test.mjs"),
      "vitest.config.mjs": lines("vitest.config.mjs"),
    };
    expect(counts).toEqual({
      "harness.mjs": 1009,
      "staging.mjs": 266,
      "inventory.mjs": 534,
      "report.mjs": 103,
      "cofiring.test.mjs": 1804,
      "vitest.config.mjs": 19,
    });
    expect(Object.values(counts).reduce((total, count) => total + count, 0)).toBe(3_735);
  });

  test("the published case count is the one Vitest collected", (context) => {
    const collected = (task) =>
      (task.tasks ?? []).reduce(
        (total, child) => total + (child.type === "test" ? 1 : collected(child)),
        0,
      );
    expect(collected(context.task.file)).toBe(107);
  });
});
