// Every published figure in `docs/research/draft-dedupe-cofiring.md`, asserted.
//
// Run it with `pnpm test:cofiring` (or `PRINT_TABLES=1 pnpm test:cofiring` to see the tables the
// document quotes). A failure here means the document and the artifacts have parted company: the
// draft moved, the engine moved, or the harness moved. That is the point of committing it. The
// document's numbers are cited elsewhere, and a number nobody can re-run is a number nobody can
// correct.

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

/** The published control's contract, for the intake rules the engine applies to every ruleset. */
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
    // The row that publishes "the 7 `is_null` leaves and the 1 `lte` leaf". It rewrote them and
    // reported nothing, so a draft that gained or dropped a leaf left that figure stale with the
    // suite still green, exactly as the three counts above would have been (#251 review).
    expect(m.staging[4].changed).toEqual({ operatorsRewritten: { is_null: 7, lte: 1 } });
    // The row that publishes "declare the 3 derived values as intake fields". Same failure again:
    // it declared them and reported nothing, so the "3" was a hand-written count of a set nothing
    // read back (#251 review).
    expect(m.staging[5].changed).toEqual({
      derivedValuesDeclared: ["effective_fuel_types", "event_days", "structure_area_sqft"],
    });
  });

  test("the declared names are the draft's derived values, not whatever a trigger names", () => {
    // This step declared every trigger field no `intake_fields` entry covered, as a nullable
    // number. Only three such names exist today and all three are derived values, but the step did
    // not check that: a raw-field typo in a future trigger would have been adapted away into a
    // fabricated numeric intake field, the load would still have failed on the same later error,
    // and the table's row would still have read "the 3 derived values" while declaring four
    // (#251 review). The names are now validated against the draft's own `derived_values`.
    for (const name of m.staging[5].changed.derivedValuesDeclared) {
      expect(m.draft.derived_values.map((value) => value.name)).toContain(name);
    }

    // A whole published rule with one field swapped, because `stagingSequence` runs every
    // adaptation and the later ones read `verification` and `output`.
    const readingField = (id, field) => ({
      ...m.draft,
      rules: [
        ...m.draft.rules,
        { ...m.draft.rules[0], id, trigger: { all: [{ field, op: "gt", value: 1 }] } },
      ],
    });

    // `event_dayz` is a raw-field typo: no `intake_fields` entry and no `derived_values` entry
    // declares it. It sorts after `event_days`, the undeclared name the table's next error names,
    // so that expected error is reached either way and only this step's own claim is at stake.
    expect(() => stagingSequence(readingField("SYNTHETIC-TYPO-001", "event_dayz"))).toThrow(
      /triggers read "event_dayz", which the draft declares neither as an intake field nor under derived_values/,
    );

    // And the same trigger naming a published derived value is still declared, so the check
    // rejects undeclared names rather than every new name.
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
    // The classification is only as good as its tie to the parser. Every type the table reports as
    // unsupported is rejected by `parseEngineRuleset` on that exact ground, and a type the engine
    // does have a case for is not reported, so an engine that gains a case for a later draft
    // deadline type stops it being classified and deleted here on the same commit.
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

    // The second class is the parser's too: a `published_minimum` with no `calendar_days` fails on
    // the field, not on the type.
    const missingDays = probeDeadline({ type: "published_minimum" });
    expect(missingDays.unsupportedType).toBe(false);
    expect(missingDays.message).toContain("calendar_days");
  });

  test("the mapped kinds and statuses are the parser's verdict too", () => {
    // Same class as the deadline types, and the same failure: the table's first error is raised by
    // a deadline, so the engine declaring `certificate` or `CONDITIONAL` would leave every message
    // in section 3.1 unchanged while this file went on rewriting a value the engine could read.
    // `stagingSequence` already checks both mappings on every run; these are the two directions it
    // checks, put to the parser here so the check itself is not the only thing asserting them.
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
  // A string value is written verbatim, so a case can plant a file that is not JSON at all;
  // anything else is serialised.
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
    // Every candidate used to be parsed eagerly, so one malformed or non-object file anywhere in
    // the directory threw before anything could be selected and made `pnpm test:cofiring` unusable
    // over a file the measurement never reads (#251 review). Each of these is a nonmatch, not a
    // failure, and the `nyc.v2` artifact is still found.
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
    // Tolerating unreadable nonmatches must not tolerate an unreadable draft. It becomes a
    // nonmatch, nothing declares the identity, and the zero case throws naming what it looked for.
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
    // The previous check split the serialised draft on `"is_null"`, so it saw the operator only
    // where the name stood alone as a JSON string or key. A note defining the operator inside a
    // longer sentence would have left this green while the draft defined the very semantics the
    // harness supplies, invalidating every figure that rests on the supplied reading (#251 review).
    const described = (draft) => m.inventory.operatorSemantics(draft);
    const named = (draft, name) =>
      described(draft).find((operator) => operator.name === name).describedOutsideTheList;

    // Embedded in a sentence, in a note the draft does not have today.
    const inProse = {
      ...m.draft,
      notes: ["is_null returns true for absent answers"],
    };
    expect(named(inProse, "is_null")).toBe(true);
    expect(named(inProse, "lte")).toBe(false);

    // As a key of a defined semantics structure.
    const asStructure = { ...m.draft, operator_semantics: { lte: "at or below the value" } };
    expect(named(asStructure, "lte")).toBe(true);

    // Nested, rather than at the top level, since a real draft would not put it in the first place
    // a walk happens to look.
    const nested = {
      ...m.draft,
      engine_conventions: { operators: { notes: ["lte is inclusive"] } },
    };
    expect(named(nested, "lte")).toBe(true);

    // Substrings are not matches, or every longer identifier containing an operator's name would
    // read as a definition of it.
    const substring = { ...m.draft, notes: ["deltec_lteq is not an operator"] };
    expect(named(substring, "lte")).toBe(false);

    // A trigger applying the operator is not a statement about it, so `rules` stays excluded.
    const applied = {
      ...m.draft,
      notes: [],
      rules: [{ id: "x", trigger: { field: "headcount", op: "lte", value: 1 } }],
    };
    expect(named(applied, "lte")).toBe(false);
  });

  test("the harness agrees with the engine on every published rule and every control intake", () => {
    expect(m.control.agreement).toEqual({ comparisons: 28_612, mismatches: 0, rules: 46 });
  });

  test("the derived-value implementations are the ones the draft declares", () => {
    // The formulas are prose over functions the draft never defines, so they are implemented
    // rather than read. What is read is whether the declaration still says what was implemented.
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
    // The section opens on these figures, and nothing else in the suite reads an intake field the
    // draft declares but no rule uses, so without this an added or removed unused field left every
    // published number green while the inventory went stale.
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
    // Five of the 43 are classifications the draft derives and publishes no derivation for, so the
    // opening figure multiplies them in independently and is an upper bound rather than a size of
    // the intake contract (3.4, limitation 9). The document publishes both figures and the reason;
    // without this the qualification could be edited out while every number stayed green.
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
    // 38 answered fields, and the derived five account for the whole factor between the two.
    expect(draft.factorialFields - draft.derivedFactorialFields.length).toBe(38);
    expect(draft.combinations / draft.combinationsAnswered).toBe(8_100n);
    expect(draft.combinations % draft.combinationsAnswered).toBe(0n);
    // The control derives no intake field, so its two figures are the same one.
    const control = m.inventory.intakeFieldInventory(loadControl());
    expect(control.derivedFactorialFields).toEqual([]);
    expect(control.combinationsAnswered).toBe(control.combinations);
  });

  test("the factorial applies `asked_when`, and rests on no field held outside itself", () => {
    // The count is over valid intakes, not over full domains, so a field the event is not asked
    // carries one value. Without this the unconstrained product, 1.77 x 10^28, passed the case
    // above while contradicting the omitted-field rule the section states below it.
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
    // The two gates and the two fields they gate have 180 combinations between them, of which 42
    // are valid intakes; every other field is independent of the gates and factors out.
    expect(m.inventory.intakeFieldInventory(m.draft).combinations * 180n).toBe(unconstrained * 42n);
    expect(m.inventory.gatesReadOutsideTheCount(m.draft)).toEqual([]);
  });

  test("a multi_enum domain is its valid selections, not its power set", () => {
    // `validateIntake` rejects the empty selection and any selection combining `none` with another
    // value (`packages/engine/src/intake/validate.ts:88-101`).
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
    // `headcount` is the one numeric field `validateIntake` gives a minimum, and the minimum is
    // read from the engine here rather than asserted as a constant, so the sweep follows a change
    // to the rule instead of outliving it.
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
    // `structure_length_ft` and `structure_width_ft` are swept over hand-set factors because the
    // thresholds are on their product. The factors are a choice, so what makes the choice sound is
    // that the products still straddle every published area threshold. A threshold that moved
    // without crossing a product would otherwise leave the distributions identical while the
    // at-threshold case stopped being swept, so the domain fails rather than going quietly stale.
    const factors = { type: "number", nullable: true };
    const readingArea = (op, value) => [{ trigger: { field: "structure_area_sqft", op, value } }];

    // The hand-set part is the four positive factors. The `0` and the `null` are the generic
    // numeric rule, which both of these nullable fields are subject to because `validateIntake`
    // gives neither a minimum, so the domain is six values wide and not five.
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
    // Every hand-set dimension obeys the generic rule rather than restating it, so a domain written
    // out by hand cannot drop an answer the contract admits.
    for (const field of ["structure_length_ft", "structure_width_ft"]) {
      const domain = domainFor(field, factors, readingArea("gt", 400));
      expect(domain).toContain(0);
      expect(domain).toContain(null);
      expect(domain.filter((value) => value !== null)).toEqual(
        domainFor(field, { type: "number", nullable: false }, readingArea("gt", 400)),
      );
    }

    // 401 is between the products 400 and 420, so nothing in the sweep sits on it.
    expect(() => domainFor("structure_length_ft", factors, readingArea("gt", 401))).toThrow(
      /is at the "structure_area_sqft" threshold 401/,
    );
    // 441 is the largest product, so no swept structure is above it.
    expect(() => domainFor("structure_length_ft", factors, readingArea("gt", 441))).toThrow(
      /is above the "structure_area_sqft" threshold 441/,
    );
    // 0 is the smallest product, so no swept structure is below it.
    expect(() => domainFor("structure_length_ft", factors, readingArea("gte", 0))).toThrow(
      /is below the "structure_area_sqft" threshold 0/,
    );
  });

  test("the date domain is the artifact's declared nullability, not a fixed three values", () => {
    // Every date other than `event_date` used to receive the same hard-coded `[null, same day,
    // next day]`, so a draft that made `event_end_date` required left every sweep count and every
    // assertion in this file unchanged while the harness went on counting a `null` end date that
    // `validateIntake` no longer admits, against section 3.3's guarantee that only answers the
    // contract admits are enumerated (#251 review). The domain now reads `nullable` like every
    // other type does.
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

    // `event_date` is fixed, which is what makes `event_days` vary only through the end date.
    expect(domainFor("event_date", { type: "date" }, [])).toEqual([EVENT_DATE]);

    // The two endpoints are chosen to bracket `event_days`, so they say nothing about some other
    // date the draft might publish. A measured group reading one fails rather than borrowing them.
    expect(() => domainFor("permit_filing_date", { type: "date", nullable: true }, [])).toThrow(
      /no domain rule for date field "permit_filing_date"/,
    );
  });

  test("the end date sweeps below, at and above the one `event_days` threshold", () => {
    // AGENTS.md requires a below case for every numeric threshold, and `event_days gt 1` had none:
    // the domain produced 1, 2 and 1, which is at, above and at again (#251 review). It now sweeps
    // an end date one day before the start, which the harness's declared inclusive-days
    // computation makes 0.
    const declared = m.draft.intake_fields.find((field) => field.field === "event_end_date");
    const days = (end) =>
      DERIVED_VALUES.event_days.compute({ event_date: EVENT_DATE, event_end_date: end });
    expect(domainFor("event_end_date", declared, []).map(days).sort()).toEqual([0, 1, 1, 2]);

    // What makes that a value the sweep OWES rather than one it invents: `validateIntake` accepts
    // the reversed pair. It validates each date's ISO shape and rejects only a start before
    // `today`, and the contract publishes no ordering rule between the two. If an approved
    // ordering rule ever lands, this fails and the domain has to lose the value rather than go on
    // enumerating an intake the contract has started refusing.
    // The published control declares no end date, so the contract put to the validator is the
    // engine's own registry carrying the draft's `event_end_date` declaration verbatim. What is
    // under test is the engine's date rules, not the draft's field list.
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
    // The one date rule the contract does publish, so a validator that stopped checking anything
    // at all would not read as agreement here.
    expect(errorsFor({ event_date: "2026-08-31", event_end_date: EVENT_DATE })).toEqual([
      "in_the_past",
    ]);
  });

  test("the draft publishes no date field the sweep has no rule for", () => {
    // The throw above is only reachable on a future draft. This is the check that the current one
    // has not already grown such a field somewhere no measured group happens to read.
    const dates = m.draft.intake_fields.filter((field) => field.type === "date");
    expect(dates.map((field) => field.field).sort()).toEqual(["event_date", "event_end_date"]);
  });
});

/**
 * Every numeric leaf the draft publishes: rule, field, operator and the constant it names.
 *
 * Limitation 3 says every numeric leaf names its own constant, and section 3.4 says the
 * threshold-local domains cover every discriminator. Neither survives on the operator names alone,
 * which is what was asserted before (#251 review). `is_null` is a presence test, so its operand is
 * the boolean answer it expects rather than a threshold.
 */
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

    // The operator names alone do not carry this claim. A leaf that dropped its `value`, or gave a
    // non-numeric one, returns the same set of names and left this green while limitation 3 went on
    // saying every numeric leaf names a constant and section 3.4 went on saying the threshold-local
    // domains cover every discriminator, with no threshold derivable for that leaf. A leaf in a
    // single-member group is never swept, so no count would have moved either (#251 review). So the
    // operand is asserted, per leaf, alongside the operator.
    const leaves = m.inventory.numericLeaves(m.draft);
    for (const leaf of leaves) {
      const where = `${leaf.rule}: ${leaf.field} ${leaf.op}`;
      if (m.inventory.OPERAND_FREE_NUMERIC_OPERATORS.has(leaf.op)) {
        // `is_null` asks whether the fact was supplied, so its operand is the boolean answer it
        // expects and not a threshold. It is still asserted: a threshold there would mean the leaf
        // is not the presence test limitation 3 excludes it as.
        expect([where, typeof leaf.value]).toEqual([where, "boolean"]);
      } else {
        expect([where, typeof leaf.value, Number.isFinite(leaf.value)]).toEqual([
          where,
          "number",
          true,
        ]);
      }
    }

    // And the leaves themselves, so a leaf that disappears fails here rather than leaving a loop
    // over a shorter list quietly passing.
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
    // These fields are not answers. The draft derives them with `classify_sapo_event`, which it
    // publishes as prose rather than as an algorithm, so no reachability constraint exists to
    // apply and each is swept over its declared enum independently. Every figure for a group
    // listed here is an upper bound over an unconstrained product, not a count of reachable
    // events. The list is read off the artifact's `derived: true` flags, so a draft that lands a
    // derivation and drops a flag moves it.
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

/**
 * Findings per event on COMPLETE intakes, per group, whole rather than summed above a cutoff.
 *
 * Index `i` is the number of complete intakes on which `i` of the group's members produced a
 * finding. Section 4.3 quotes the tails of these; they are pinned here so the tails cannot agree by
 * both moving (#251 review).
 */
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
    // This used to compare `completeAndTwoFindings` with `completeAndTwoTrue`, which is not the
    // claim. Both are counts above a two-member cutoff, so a complete intake carrying one `unknown`
    // member and fewer than two findings left both at zero and the assertion passed while the
    // sentence it defends was false; two differing complete distributions whose tails happened to
    // sum alike passed it too (#251 review). What is asserted now is the sentence: the number of
    // member results that came back `unknown` on a complete intake, per group, is zero.
    expect(Object.fromEntries(m.groups.map((g) => [g.key, g.completeUnknownResults]))).toEqual(
      Object.fromEntries(m.groups.map((g) => [g.key, 0])),
    );

    // And the whole complete distributions, not their tails, so a group whose complete findings
    // move without crossing the cutoff fails here rather than going quietly stale. `findings`
    // counts members whose trigger was `true` or `unknown` and `true` counts only `true`, so with
    // no `unknown` anywhere on a complete intake the two are the same distribution.
    for (const group of m.groups) {
      expect(group.completeFindings).toEqual(group.completeTrue);
      expect(group.completeFindings.reduce((total, count) => total + count, 0)).toBe(
        group.complete,
      );
    }
  });

  test("the complete distributions are the published ones", () => {
    // The distributions the assertion above compares, pinned to values, so that "they are equal to
    // each other" cannot become true by both of them moving together.
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
    // `tent_area_sqft` answered at exactly 400, and `DOB-TENT-001` is `unknown` because the rule
    // publishes `boundary: "conditional"` on that threshold.
    const shape = m.control.shapes.find((entry) => entry.results.join("/") === "unknown/true");
    expect(shape.firstCompleteIntake).toEqual({
      structure_types: ["tent_canopy"],
      tent_area_sqft: 400,
      tent_days_in_place: 0,
      structure_over_10ft_tall: "yes",
    });
  });
});

/**
 * The `sapo_permit` fee displays, in rule order, as the draft publishes them.
 *
 * Section 5.1's fee paragraph is entirely a reading of these, and only their count was checked
 * (#251 review), so a changed fee could leave that paragraph quoting a figure the draft no longer
 * publishes.
 */
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
    // The section's opening sentence. Every member reads `sapo_event_type`; the three size-specific
    // street rules also read `street_event_size`; all six plaza rules also read `plaza_level` and
    // `plaza_size`, and only four of the six read `plaza_block_count`.
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
    // Which seven, not just how many: the cardinality check alone let a renamed instrument leave
    // the section's list stale with the suite green (#251 review).
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
    // Every fee sentence in 5.1 is a reading of these fourteen displays, and nothing read them:
    // a changed fee left `pnpm test:cofiring` green while the section quoted the old one
    // (#251 review). The displays are asserted verbatim, and the readings built on top of them.
    const fees = m.inventory.sapoPermitInventory(m.draft).fees;
    expect(fees.map((fee) => [fee.id, fee.eventFeeUsd, fee.display])).toEqual(SAPO_FEES);

    // "All 14 publish a `$25` processing fee".
    expect(fees.every((fee) => fee.processingFeeUsd === 25)).toBe(true);

    // The categories the section counts, each read off the displays above rather than restated.
    const displays = fees.map((fee) => fee.display);
    expect(displays.filter((text) => /^\$[\d,]+ per location per day/.test(text))).toHaveLength(3);
    expect(displays.filter((text) => text.includes("20%"))).toHaveLength(2);
    expect(displays.filter((text) => text.includes("see the verified fee matrix"))).toHaveLength(5);
    expect(displays.filter((text) => text.includes("$15,500 or $31,000"))).toHaveLength(1);

    // The two endpoints the section names.
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
    // The section quotes this intake to show why the pair cannot both be `true` on a complete one.
    // Nothing read it, so widening the `event_end_date` domain moved it and left the quotation
    // describing an intake the sweep no longer reaches first (#251 review).
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
    // Section 6 turns on which route binds a merged line's identity, and that is decided by the
    // dispositions, not by the kinds. Both are read from the engine here rather than restated, so
    // the draft moving a rule's kind or the engine moving its default table moves this instead of
    // leaving the section describing a mapping that no longer exists. It is what PR #254's
    // reclassification did: under `kind: eligibility` all four defaulted to `may_be_required`.
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
    // Section 6 describes the four separately because they have two different causes, and an
    // earlier revision gave all 28 the cause that holds for 16. `sound_purpose` unanswered is the
    // cause on the first two; on the other two the trigger's `any` is what is unknown, which is
    // why they survive `sound_purpose` being answered.
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
      // Rows where `sound_purpose` is answered: the prohibition is unknown on them for a reason
      // other than that field.
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
    // Section 6's blocker-plus-window reading needs a filing window on the merged line, and on that
    // shape the only `true` beside the prohibition is this advisory. Its window is nested inside
    // `candidate_requirement`, which the parser does not read, so none reaches the merge.
    const parsed = m.inventory.parserVisibleOutput(m.draft, "NYPD-SOUND-PRIVATE-UNKNOWN-001");
    expect(parsed.unreadFields).toContain("candidate_requirement");
    const advisory = [...m.draft.rules, ...m.draft.advisories].find(
      (rule) => rule.id === "NYPD-SOUND-PRIVATE-UNKNOWN-001",
    );
    expect(advisory.output.deadline).toBeUndefined();
    expect(advisory.output.candidate_requirement.deadline.calendar_days).toBe(5);
  });

  test("which shapes actually merge to a prohibited line, put to the engine", () => {
    // Section 6 is about what the MERGED line reads, and co-firing alone does not settle that: an
    // unresolved route cannot carry a group past `may_be_required` where the group already holds a
    // resolved route at or above `required` (`unresolvedRouteCeilingApplies`, `findings.ts:191-220`,
    // ARCHITECTURE-FUTURE §8.4). An earlier revision of this section gave the blocker-plus-window
    // reading to the 16 `unknown`-side rows where a permit fires `true`, which is the one shape the
    // ceiling bites on, and withheld it from the 12 where the permit is itself `unknown`, which is
    // where it holds (#251 review).
    //
    // The draft does not load (section 3.1), so this is put to the engine on a synthetic group in
    // the published shape rather than on the draft: three rules on one dedupe key, a `prohibition`
    // publishing no window, a `permit` publishing a 5-day one, and an `advisory`. Each shape is
    // reproduced by which gate is answered, so the assertion is the engine's merge, not a reading
    // of it.
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
        // The prohibition's whole `output` is `status`, `message` and `dedupe_key`, as the draft's
        // is, so it publishes no name and no window and takes its kind's default disposition.
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
      // The harness's own event date, and a `today` far enough ahead of it that the permit's
      // 5-day window is open: a closed one would decide the timeline on a different branch.
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
    // The 8 `true`-with-`true` rows: nothing is capped, so the prohibition binds identity.
    expect(
      mergedLine({ prohibition_gate: "yes", permit_gate: "yes", advisory_gate: "no" }),
    ).toEqual(blockerPlusWindow);
    // The 16 rows where the prohibition is `unknown` and a permit fires `true`. The resolved
    // `required` permit triggers the ceiling, the prohibition contributes `may_be_required`, and the
    // merged line reads as the permit an organizer can file. These co-fire; they are not this
    // section's shape.
    expect(mergedLine({ prohibition_gate: null, permit_gate: "yes", advisory_gate: "no" })).toEqual(
      {
        disposition: "required",
        name: "Sound Device Permit",
        quotesTheWindow: true,
      },
    );
    // The 9-row shape: the only route that resolved is the advisory, which is weaker than the
    // ceiling, so it does not trigger the cap. The permit's own `unknown` finding still contributes
    // the group's window.
    expect(mergedLine({ prohibition_gate: null, permit_gate: null, advisory_gate: "yes" })).toEqual(
      blockerPlusWindow,
    );
    // The 3-row shape: no route resolved at all, so there is nothing the prohibition is promoted
    // past.
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
});

describe("section 7, the summary restatements", () => {
  test("the rounded block-party denominator is the sweep it restates", () => {
    // Section 7 restates the other sections rather than measuring anything, so nothing here was
    // asserted. Its block-party sentence quotes "7.7% of a 32.4-million intake factorial", and the
    // rounded denominator is a figure of its own: when the below-threshold end-date case widened
    // the sweep, the percentage was updated and the rounded total was not, leaving the summary
    // pairing a current share with the previous denominator (#251 review). Both halves of that
    // sentence are now read off the group, rounded the way the sentence rounds them.
    const group = m.group("block_party_eligibility");
    expect(Math.round(group.sweep / 100_000) / 10).toBe(32.4);
    expect(Math.round((group.true[2] / group.sweep) * 1_000) / 10).toBe(7.7);
  });
});

describe("section 8, the harness footprint", () => {
  // Section 8 publishes these to scope the code behind the measurement, and they are the only
  // figures in the document about the harness rather than about the draft. Nothing read them, and
  // they went stale twice while every other number stayed green: once when `harness.mjs` and the
  // suite grew, and again when `staging.mjs` and the suite did. Reading them off disk is the same
  // arrangement `intakeFieldInventory` gave section 3.3.
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
      "harness.mjs": 996,
      "staging.mjs": 266,
      "inventory.mjs": 390,
      "report.mjs": 103,
      "cofiring.test.mjs": 1587,
      "vitest.config.mjs": 19,
    });
    expect(Object.values(counts).reduce((total, count) => total + count, 0)).toBe(3_361);
  });

  test("the published case count is the one Vitest collected", (context) => {
    // Section 8's file table publishes a case count beside the line counts, and it claimed the same
    // regression protection while nothing derived it: a case added, removed or split moved the line
    // counts above and left the case count stale with the suite green (#251 review). It is counted
    // off this file's own collected task tree rather than off the source, because four blocks use
    // `test.each` and expand at collection time, so a count of `test(` calls would be a different
    // quantity from the one `pnpm test:cofiring` reports.
    const collected = (task) =>
      (task.tasks ?? []).reduce(
        (total, child) => total + (child.type === "test" ? 1 : collected(child)),
        0,
      );
    expect(collected(context.task.file)).toBe(96);
  });
});
