// Every published figure in `docs/research/draft-dedupe-cofiring.md`, asserted.
//
// Run it with `pnpm test:cofiring` (or `PRINT_TABLES=1 pnpm test:cofiring` to see the tables the
// document quotes). A failure here means the document and the artifacts have parted company: the
// draft moved, the engine moved, or the harness moved. That is the point of committing it. The
// document's numbers are cited elsewhere, and a number nobody can re-run is a number nobody can
// correct.

import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { beforeAll, describe, expect, test } from "vitest";

import { parseIntakeContract } from "../../packages/engine/src/intake/registry.ts";
import { validateIntake } from "../../packages/engine/src/intake/validate.ts";

import {
  EVENT_DATE,
  NUMERIC_MINIMUMS,
  askedWhenExpression,
  assertDerivedValuesMatchDraft,
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
      writeFileSync(join(directory, name), JSON.stringify(artifact));
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
  test("a multi_enum domain is its valid selections, not its power set", () => {
    // `validateIntake` rejects the empty selection and any selection combining `none` with another
    // value (`packages/engine/src/intake/validate.ts:88-101`).
    expect(validMultiEnumSelections(["a", "b", "c", "d", "none"]).length).toBe(16);
    expect(validMultiEnumSelections(["a", "b"]).length).toBe(3);
  });

  test("the sweep sizes are the published ones", () => {
    expect(Object.fromEntries(m.groups.map((group) => [group.key, group.sweep]))).toEqual({
      sapo_permit: 6_480,
      dob_temporary_structure: 10_000,
      sla_alcohol: 60,
      sapo_insurance: 36,
      nypd_sound: 156,
      parks_special_event: 120,
      fdny_generator: 4_800,
      dob_assembly: 80,
      block_party_eligibility: 24_330_240,
    });
    expect(m.totalIntakes).toBe(24_351_972);
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
});

describe("section 3.4, the limitations", () => {
  test("limitation 3: every numeric leaf names its own constant", () => {
    expect(m.inventory.numericOperators(m.draft)).toEqual(["eq", "gt", "gte", "is_null", "lte"]);
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
    ["dob_temporary_structure", [4_480, 3_096, 1_902, 270, 180, 72]],
    ["sla_alcohol", [37, 11, 2, 4, 2, 4]],
    ["sapo_insurance", [4, 26, 2, 2, 2]],
    ["nypd_sound", [84, 27, 36, 9, 0]],
    ["parks_special_event", [98, 22, 0, 0]],
    ["fdny_generator", [2_686, 1_706, 344, 64]],
    ["dob_assembly", [59, 15, 3, 3]],
    ["block_party_eligibility", [18_923_544, 737_256, 4_669_440]],
  ])("%s", (key, distribution) => {
    expect(m.group(key).findings).toEqual(distribution);
  });
});

describe("section 4.2, the same sweeps counting only `true` triggers", () => {
  test.each([
    ["sapo_permit", [2_268, 4_212]],
    ["dob_temporary_structure", [7_066, 2_478, 456]],
    ["sla_alcohol", [43, 17]],
    ["sapo_insurance", [9, 27]],
    ["nypd_sound", [90, 58, 8]],
    ["parks_special_event", [109, 11]],
    ["fdny_generator", [3_913, 852, 35]],
    ["dob_assembly", [68, 12]],
    ["block_party_eligibility", [21_627_024, 830_448, 1_872_768]],
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

describe("section 4.3, completeness", () => {
  test.each([
    ["sapo_permit", 1_536, 0, 0],
    ["dob_temporary_structure", 4_032, 444, 444],
    ["sla_alcohol", 24, 0, 0],
    ["sapo_insurance", 16, 0, 0],
    ["nypd_sound", 84, 8, 8],
    ["parks_special_event", 108, 0, 0],
    ["fdny_generator", 2_016, 35, 35],
    ["dob_assembly", 63, 0, 0],
    ["block_party_eligibility", 1_474_560, 0, 0],
  ])("%s", (key, complete, andTwoFindings, andTwoTrue) => {
    const group = m.group(key);
    expect(group.complete).toBe(complete);
    expect(group.completeAndTwoFindings).toBe(andTwoFindings);
    expect(group.completeAndTwoTrue).toBe(andTwoTrue);
  });

  test("on a complete intake no draft member's trigger is ever `unknown`", () => {
    for (const group of m.groups) {
      expect(group.completeAndTwoFindings).toBe(group.completeAndTwoTrue);
    }
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
    expect(group.true[2]).toBe(1_872_768);
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
    expect(sapo.permitNames).toHaveLength(7);
    expect(sapo.sharedFields).toEqual(["agency", "portal"]);
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

  test("5.9 `block_party_eligibility`: four sets, none complete", () => {
    const group = m.group("block_party_eligibility");
    expect(group.sets.map((set) => [set.count, set.complete])).toEqual([
      [2_334_828, 0],
      [1_872_768, 0],
      [460_692, 0],
      [1_152, 0],
    ]);
  });
});

describe("section 6, the blocker-plus-window shape", () => {
  test("the draft publishes four blockers, all `kind: eligibility`", () => {
    expect(m.inventory.blockingRules(m.draft)).toEqual([
      {
        id: "SAPO-BLOCK-PARTY-INELIGIBLE-001",
        kind: "eligibility",
        dedupeKey: "block_party_eligibility",
        members: 2,
      },
      {
        id: "SAPO-ALCOHOL-PROHIBITION-001",
        kind: "eligibility",
        dedupeKey: "sapo_alcohol",
        members: 1,
      },
      {
        id: "NYPD-SOUND-COMMERCIAL-ADVERTISING-PROHIBITED-001",
        kind: "eligibility",
        dedupeKey: "nypd_sound",
        members: 4,
      },
      {
        id: "PARKS-PROPANE-PROHIBITION-001",
        kind: "eligibility",
        dedupeKey: "parks_propane",
        members: 1,
      },
    ]);
  });

  test("the prohibition co-fires `unknown`-side on a further 28 intakes", () => {
    const group = m.group("nypd_sound");
    const unknownSide = setsWith(
      group,
      "NYPD-SOUND-COMMERCIAL-ADVERTISING-PROHIBITED-001",
      "unknown",
    );
    expect(unknownSide.map((set) => set.count)).toEqual([10, 9, 6, 3]);
    expect(unknownSide.every((set) => set.complete === 0)).toBe(true);
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
