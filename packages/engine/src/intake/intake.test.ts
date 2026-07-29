import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PUBLISHED_RULES_FILE } from "../__fixtures__/published-ruleset";
import { parseIntakeContract } from "./registry";
import { askedFields, askedFieldNames as askedNamesIn } from "./visibility";
import { isIntakeUnchanged, mergeIntakeEdit, validateIntake } from "./validate";
import {
  FIXTURE_TODAY,
  SCENARIO_INTAKE_FIXTURES,
  fixtureSubmission,
} from "./scenario-intake-fixtures";

// The published ruleset is the only source of the intake contract, so these tests read
// the real file rather than a hand-built stub wherever the assertion is about the
// contract itself. Structural error branches use minimal synthetic rulesets.

const publishedRuleset: Record<string, unknown> = JSON.parse(
  readFileSync(PUBLISHED_RULES_FILE, "utf8"),
);
const contract = parseIntakeContract(publishedRuleset);
const fieldNamed = (name: string) => {
  const field = contract.fields.find((candidate) => candidate.field === name);
  if (field === undefined) throw new Error(`registry has no field ${name}`);
  return field;
};

const scenarioFixture = (id: string) => {
  const fixture = SCENARIO_INTAKE_FIXTURES.find((candidate) => candidate.scenario === id);
  if (fixture === undefined) throw new Error(`no fixture ${id}`);
  return fixture;
};

/** A scenario's complete submission: the answer key's values plus anything inferred. */
const scenario = (id: string): Record<string, unknown> => fixtureSubmission(scenarioFixture(id));

// Test names say where each scenario's values came from, so a green run never reads as
// "entered exactly as written" while an inferred value is standing in for a missing one.
const SCENARIO_CASES = SCENARIO_INTAKE_FIXTURES.map((fixture) => ({
  ...fixture,
  submission: fixtureSubmission(fixture),
  provenance:
    fixture.inferred === undefined
      ? "exactly as the answer key specifies"
      : `with ${Object.keys(fixture.inferred).join(", ")} inferred (SPEC-CONFLICT #${Object.values(
          fixture.inferred,
        )
          .map((entry) => entry.conflictIssue)
          .join(", #")})`,
}));

const askedFieldNames = (answers: Record<string, unknown>): string[] =>
  askedFields(contract.fields, answers as never).map((field) => field.field);

const codesFor = (
  submission: Record<string, unknown>,
  today = FIXTURE_TODAY,
): Record<string, string> =>
  Object.fromEntries(
    validateIntake(contract, submission, today).errors.map((error) => [error.field, error.code]),
  );

type PublishedRuleJson = {
  id: string;
  output: Record<string, string>;
  verification: { status: string };
};

/** A synthetic ruleset carrying just the pieces the contract parser reads. */
const rulesetWith = (fields: unknown[]): Record<string, unknown> => ({
  intake_fields: fields,
  rules: publishedRuleset.rules,
  advisories: publishedRuleset.advisories,
});

describe("intake contract derives from the published registry", () => {
  it("parses every declared field without inventing or dropping one", () => {
    const declared = (publishedRuleset.intake_fields as { field: string }[]).map(
      (entry) => entry.field,
    );
    expect(contract.fields.map((field) => field.field)).toEqual(declared);
  });

  it("parses every asked_when expression the registry publishes", () => {
    for (const entry of publishedRuleset.intake_fields as {
      field: string;
      asked_when?: string;
    }[]) {
      const field = fieldNamed(entry.field);
      expect(field.askedWhenSource).toBe(entry.asked_when ?? null);
      expect(field.askedWhen.length > 0).toBe(entry.asked_when !== undefined);
    }
  });

  it("publishes the approved PACO checklist and complete fold guidance", () => {
    expect(fieldNamed("venue_paco_covers_exact_event").note).toBe(
      [
        "Check the current or most recent PACO, certificate of occupancy, and DOB-approved primary or alternate plan:",
        "- Identifies the exact event space.",
        "- Authorizes the event use and assembly classification.",
        "- Allows the event's maximum occupant load.",
        "- Matches the event's seating, furnishings, and layout.",
        "Answer No if any checklist item has a proved mismatch.",
        "Answer Yes if all checklist items are proved.",
        "Answer I don't know otherwise.",
      ].join("\n"),
    );
  });

  it("resolves each asked_when form to the clause it means", () => {
    // These are the engine's clauses, not a second vocabulary: the questionnaire and the rules
    // engine parse `asked_when` with one parser, so they cannot drift apart on what a
    // question depends on.
    expect(fieldNamed("obstructs_public_way").askedWhen).toEqual([
      { kind: "in", field: "location_type", values: ["street", "sidewalk", "plaza"] },
    ]);
    expect(fieldNamed("sapo_event_type").askedWhen).toEqual([
      { kind: "compare", field: "obstructs_public_way", op: "!=", value: "no" },
    ]);
    expect(fieldNamed("plaza_level").askedWhen).toEqual([
      { kind: "compare", field: "sapo_event_type", op: "=", value: "plaza_event" },
    ]);
    expect(fieldNamed("food_vendor_count").askedWhen).toEqual([
      { kind: "truthy", field: "food_present" },
    ]);
    expect(fieldNamed("tent_area_sqft").askedWhen).toEqual([
      { kind: "member", field: "structure_types", member: "tent_canopy" },
    ]);
    expect(fieldNamed("venue_paco_covers_exact_event").askedWhen).toEqual([
      { kind: "compare", field: "location_type", op: "=", value: "private_venue" },
      { kind: "at_least", field: "headcount", threshold: 75 },
    ]);
    expect(fieldNamed("venue_fdny_pa_permit_current_for_event_space").askedWhen).toEqual([
      { kind: "compare", field: "location_type", op: "=", value: "private_venue" },
      { kind: "at_least", field: "headcount", threshold: 75 },
    ]);
  });

  it("types a comparison operand the same way the engine does", () => {
    // The bug this sharing removes: the questionnaire kept "true"/"75" as strings while the
    // engine typed them, so a field the engine had in scope was a question the user never saw.
    const contract = parseIntakeContract(
      rulesetWith([
        { field: "food_present", type: "boolean" },
        { field: "headcount", type: "integer" },
        { field: "alcohol", type: "boolean", asked_when: "food_present = true AND headcount = 75" },
      ]),
    );
    const alcohol = contract.fields.find((field) => field.field === "alcohol");
    expect(alcohol?.askedWhen).toEqual([
      { kind: "compare", field: "food_present", op: "=", value: true },
      { kind: "compare", field: "headcount", op: "=", value: 75 },
    ]);
    // and the questionnaire actually asks it, rather than comparing a string to a boolean
    // (this file's own askedFieldNames helper is bound to the published contract, so the
    // synthetic registry is queried through the visibility function directly)
    expect(askedNamesIn(contract.fields, { food_present: true, headcount: 75 })).toContain(
      "alcohol",
    );
    expect(askedNamesIn(contract.fields, { food_present: false, headcount: 75 })).not.toContain(
      "alcohol",
    );
  });

  it("carries the registry's published notes as help text", () => {
    expect(fieldNamed("street_event_size").note).toBe(
      (publishedRuleset.intake_fields as { field: string; note?: string }[]).find(
        (entry) => entry.field === "street_event_size",
      )?.note,
    );
    expect(fieldNamed("borough").note).toBeNull();
  });

  it("takes both inline notices verbatim from their published rules, status included", () => {
    const published = [
      ...(publishedRuleset.rules as PublishedRuleJson[]),
      ...(publishedRuleset.advisories as PublishedRuleJson[]),
    ];
    const blockParty = published.find((rule) => rule.id === "SAPO-BLOCK-PARTY-ELIG-001");
    expect(contract.blockPartyEligibilityNotice).toEqual({
      ruleId: "SAPO-BLOCK-PARTY-ELIG-001",
      text: blockParty?.output.note_text,
      verificationStatus: blockParty?.verification.status,
    });

    const alcohol = published.find((rule) => rule.id === "ADV-ALCOHOL-PUBLIC-001");
    expect(contract.alcoholInPublicSpaceNotice).toEqual({
      ruleId: "ADV-ALCOHOL-PUBLIC-001",
      text: alcohol?.output.advisory_text,
      verificationStatus: alcohol?.verification.status,
    });
    // The two notices carry different statuses; neither may be rendered as the other.
    expect(contract.alcoholInPublicSpaceNotice.verificationStatus).toBe("COVERAGE_GAP");
    expect(contract.blockPartyEligibilityNotice.verificationStatus).toBe("SOURCE_CONFIRMED");
  });

  it("keeps the coverage warning's location set equal to the advisory's own trigger", () => {
    // Drift guard: intake warns for alcohol at any non-private location. If the advisory
    // ever narrows its trigger, the two must be reconciled rather than quietly disagree.
    const advisory = (
      publishedRuleset.advisories as {
        id: string;
        trigger: { all: { field: string; value: unknown }[] };
      }[]
    ).find((rule) => rule.id === "ADV-ALCOHOL-PUBLIC-001");
    const triggerLocations = advisory?.trigger.all.find(
      (condition) => condition.field === "location_type",
    )?.value;
    const publicLocations = fieldNamed("location_type").values?.filter(
      (value) => value !== "private_venue",
    );
    expect([...(triggerLocations as string[])].sort()).toEqual([...(publicLocations ?? [])].sort());
  });
});

describe("contract parsing rejects a registry it cannot honor", () => {
  const cases: [string, unknown[]][] = [
    ["a non-object entry", ["borough"]],
    ["a missing name", [{ type: "boolean" }]],
    ["an unsupported type", [{ field: "borough", type: "colour" }]],
    ["a non-array enum", [{ field: "borough", type: "enum", values: "manhattan" }]],
    ["an empty enum", [{ field: "borough", type: "enum", values: [] }]],
    ["a blank enum value", [{ field: "borough", type: "enum", values: [""] }]],
    [
      "a duplicate field",
      [
        { field: "alcohol", type: "boolean" },
        { field: "alcohol", type: "boolean" },
      ],
    ],
    ["a non-string asked_when", [{ field: "alcohol", type: "boolean", asked_when: 7 }]],
    [
      "an undeclared trigger field",
      [{ field: "alcohol", type: "boolean", asked_when: "ghost = yes" }],
    ],
    [
      "an undeclared trigger value",
      [
        { field: "borough", type: "enum", values: ["queens"] },
        { field: "alcohol", type: "boolean", asked_when: "borough = mars" },
      ],
    ],
    [
      "a numeric comparison on an enum",
      [
        { field: "borough", type: "enum", values: ["queens"] },
        { field: "alcohol", type: "boolean", asked_when: "borough gte 5" },
      ],
    ],
    [
      "a non-boolean used as a flag",
      [
        { field: "headcount", type: "integer" },
        { field: "alcohol", type: "boolean", asked_when: "headcount" },
      ],
    ],
    ["an unresolvable bare token", [{ field: "alcohol", type: "boolean", asked_when: "sparkles" }]],
    [
      "an ambiguous bare token",
      [
        { field: "left", type: "multi_enum", values: ["shared"] },
        { field: "right", type: "multi_enum", values: ["shared"] },
        { field: "alcohol", type: "boolean", asked_when: "shared" },
      ],
    ],
  ];

  it.each(cases)("refuses %s", (_label, fields) => {
    expect(() => parseIntakeContract(rulesetWith(fields))).toThrow(/Intake contract invalid/);
  });

  it("refuses a ruleset that is not an object, or has no field list", () => {
    expect(() => parseIntakeContract(null)).toThrow(/must be an object/);
    expect(() => parseIntakeContract({ intake_fields: {} })).toThrow(/must be an array/);
  });

  it("refuses a ruleset missing an inline notice it must quote", () => {
    expect(() =>
      parseIntakeContract({
        intake_fields: [],
        rules: [],
        advisories: [],
      }),
    ).toThrow(/does not publish SAPO-BLOCK-PARTY-ELIG-001/);
    expect(() =>
      parseIntakeContract({
        intake_fields: [],
        rules: [{ id: "SAPO-BLOCK-PARTY-ELIG-001", output: {} }],
        advisories: [],
      }),
    ).toThrow(/publishes no note_text or advisory_text/);
    expect(() =>
      parseIntakeContract({
        intake_fields: [],
        rules: [
          { id: "SAPO-BLOCK-PARTY-ELIG-001", output: { note_text: "text" }, verification: {} },
        ],
        advisories: [],
      }),
    ).toThrow(/verification.status must be a non-empty string/);
  });
});

describe("conditional flow (spec #2)", () => {
  it("asks the SAPO classification only where the event can obstruct a public way", () => {
    expect(askedFieldNames({ location_type: "street" })).toContain("obstructs_public_way");
    expect(askedFieldNames({ location_type: "park" })).not.toContain("obstructs_public_way");
    expect(askedFieldNames({ location_type: "private_venue" })).not.toContain(
      "obstructs_public_way",
    );
  });

  it("holds the SAPO class back until the obstruction answer allows it", () => {
    expect(askedFieldNames({ location_type: "street" })).not.toContain("sapo_event_type");
    expect(askedFieldNames({ location_type: "street", obstructs_public_way: "no" })).not.toContain(
      "sapo_event_type",
    );
    for (const answer of ["yes", "unknown"]) {
      expect(askedFieldNames({ location_type: "street", obstructs_public_way: answer })).toContain(
        "sapo_event_type",
      );
    }
  });

  it("asks street size only for street events and plaza level only for plazas", () => {
    const street = askedFieldNames(scenario("A"));
    expect(street).toContain("street_event_size");
    expect(street).not.toContain("plaza_level");
    expect(street).not.toContain("has_amusement_ride");

    const plaza = askedFieldNames(scenario("E"));
    expect(plaza).toEqual(expect.arrayContaining(["plaza_level", "plaza_multiple_blocks"]));
    expect(plaza).not.toContain("street_event_size");

    expect(askedFieldNames(scenario("D"))).toContain("has_amusement_ride");
  });

  it("asks dimensions only for the structure types selected", () => {
    const tent = askedFieldNames({ structure_types: ["tent_canopy"] });
    expect(tent).toEqual(expect.arrayContaining(["tent_area_sqft", "tent_days_in_place"]));
    expect(tent).not.toContain("stage_height_ft");

    const stage = askedFieldNames({ structure_types: ["stage_platform_scaffold"] });
    expect(stage).toEqual(expect.arrayContaining(["stage_height_ft", "stage_area_sqft"]));
    expect(stage).not.toContain("tent_area_sqft");

    expect(askedFieldNames({ structure_types: ["none"] })).not.toContain(
      "structure_over_10ft_tall",
    );
    expect(askedFieldNames({ structure_types: ["prop_truss"] })).toContain(
      "structure_over_10ft_tall",
    );
  });

  it("asks audibility, licence and assembly questions only when they are relevant", () => {
    expect(askedFieldNames({ amplified_sound: true, location_type: "street" })).not.toContain(
      "sound_audible_from_public_way",
    );
    expect(askedFieldNames({ amplified_sound: true, location_type: "private_venue" })).toContain(
      "sound_audible_from_public_way",
    );

    expect(askedFieldNames({ alcohol: true, location_type: "street" })).not.toContain(
      "venue_license_covers_event_area",
    );
    expect(askedFieldNames({ alcohol: true, location_type: "private_venue" })).toContain(
      "venue_license_covers_event_area",
    );

    const assemblyFields = [
      "venue_paco_covers_exact_event",
      "venue_fdny_pa_permit_current_for_event_space",
    ];
    for (const field of assemblyFields) {
      expect(askedFieldNames({ location_type: "private_venue", headcount: 74 })).not.toContain(
        field,
      );
    }
    for (const headcount of [75, 76]) {
      expect(askedFieldNames({ location_type: "private_venue", headcount })).toEqual(
        expect.arrayContaining(assemblyFields),
      );
      for (const field of assemblyFields) {
        expect(askedFieldNames({ location_type: "park", headcount })).not.toContain(field);
      }
    }
  });

  it("does not declare the deprecated food-exception claim", () => {
    expect(contract.fields.map((field) => field.field)).not.toContain(
      "food_affinity_private_exception_claimed",
    );
    expect(askedFieldNames({ food_present: false, event_open_to_public: "no" })).not.toContain(
      "food_vendor_count",
    );
  });

  it("asks each scenario a fraction of the 33 declared questions", () => {
    expect(contract.fields).toHaveLength(33);
    const asked = Object.fromEntries(
      SCENARIO_INTAKE_FIXTURES.map((fixture) => [
        fixture.scenario,
        askedFieldNames(fixtureSubmission(fixture)).length,
      ]),
    );
    // The low-burden scenarios land in the spec's 10-15 band; the SAPO and
    // max-complexity ones ask more because they classify. None asks all 33.
    expect(asked.B).toBeGreaterThanOrEqual(10);
    expect(asked.B).toBeLessThanOrEqual(15);
    expect(asked.C).toBeGreaterThanOrEqual(10);
    expect(asked.C).toBeLessThanOrEqual(15);
    for (const count of Object.values(asked)) expect(count).toBeLessThan(33);
  });

  it("treats a field with no asked_when as always asked", () => {
    expect(askedFieldNames({})).toEqual(
      contract.fields.filter((field) => field.askedWhen.length === 0).map((field) => field.field),
    );
  });

  it("ignores an answer whose own question is no longer asked", () => {
    // The organizer classified a street event, then moved it to a park. The stale SAPO
    // class must not keep the street-size question alive.
    const moved = {
      location_type: "park",
      obstructs_public_way: "yes",
      sapo_event_type: "street_event",
    };
    expect(askedFieldNames(moved)).not.toContain("sapo_event_type");
    expect(askedFieldNames(moved)).not.toContain("street_event_size");
  });
});

describe("the six scenario fixtures are enterable (spec #1)", () => {
  it.each(SCENARIO_CASES)("accepts scenario $scenario ($title), $provenance", (fixture) => {
    const result = validateIntake(contract, fixture.submission, FIXTURE_TODAY);
    expect(result.errors).toEqual([]);
    expect(result.values).not.toBeNull();
    for (const [field, value] of Object.entries(fixture.submission)) {
      expect(result.values?.[field]).toEqual(value);
    }
  });

  it("enters Scenario F as the answer key writes it (closes SPEC-CONFLICT #88 and #106)", () => {
    // The case that used to fail: F's documented inputs were incomplete against the registry.
    // Answer key v4 states the caterer count and the battery answer, so what the key writes is
    // now a complete submission on its own — no value stands in for a missing one.
    const asWritten = scenarioFixture("F").intake;
    expect(scenarioFixture("F").inferred).toBeUndefined();
    expect(codesFor(asWritten)).toEqual({});
  });

  it("supplies no answer the key does not state, for any scenario", () => {
    // The register of what the fixtures supply beyond the approved key, asserted exactly so a new
    // supplied value cannot arrive unlisted. Empty everywhere since v4: #88 (Scenario F's
    // food_vendor_count) and #106 (battery_present, which nyc.v2.5 asks of every event) are both
    // closed by the key stating the values the fixtures were already running on.
    const supplied = Object.fromEntries(
      SCENARIO_INTAKE_FIXTURES.map((fixture) => [
        fixture.scenario,
        Object.keys(fixture.inferred ?? {}).sort(),
      ]),
    );
    expect(supplied).toEqual({ A: [], B: [], C: [], D: [], E: [], F: [] });
  });

  it("stores every question the scenario was not asked as null", () => {
    const values = validateIntake(contract, scenario("C"), FIXTURE_TODAY).values;
    expect(values?.obstructs_public_way).toBeNull();
    expect(values?.food_vendor_count).toBeNull();
    expect(values?.venue_paco_covers_exact_event).toBeNull();
    expect(values?.venue_fdny_pa_permit_current_for_event_space).toBeNull();
    expect(values?.location_name).toBeNull();
    expect(values?.capacity).toBeNull();
  });

  it("raises no inline warning on any approved fixture", () => {
    const warned = SCENARIO_CASES.filter(
      (fixture) => validateIntake(contract, fixture.submission, FIXTURE_TODAY).warnings.length > 0,
    );
    expect(warned).toEqual([]);
  });
});

describe("unknown is a real answer (spec #3)", () => {
  const unknownCapable = [
    "obstructs_public_way",
    "street_event_size",
    "plaza_level",
    "sound_audible_from_public_way",
    "venue_license_covers_event_area",
    "venue_paco_covers_exact_event",
    "venue_fdny_pa_permit_current_for_event_space",
    "structure_over_10ft_tall",
  ];

  it("declares unknown on every field the spec lists", () => {
    for (const name of unknownCapable) expect(fieldNamed(name).values).toContain("unknown");
  });

  it("stores unknown answers as unknown, never as false or null", () => {
    const values = validateIntake(contract, scenario("F"), FIXTURE_TODAY).values;
    expect(values?.sound_audible_from_public_way).toBe("unknown");
    expect(values?.venue_license_covers_event_area).toBe("unknown");
    expect(values?.venue_paco_covers_exact_event).toBe("unknown");
    expect(values?.venue_fdny_pa_permit_current_for_event_space).toBe("unknown");
  });

  it("keeps blank numeric answers on a selected structure or generator as null", () => {
    const blankDimensions = {
      ...scenario("E"),
      tent_area_sqft: null,
      tent_days_in_place: null,
      generator_gasoline_gallons: null,
      generator_kw: null,
    };
    const result = validateIntake(contract, blankDimensions, FIXTURE_TODAY);
    expect(result.errors).toEqual([]);
    expect(result.values?.tent_area_sqft).toBeNull();
    expect(result.values?.generator_kw).toBeNull();
  });

  it("still requires a conditional question that has no blank option", () => {
    const { street_event_size: _dropped, ...withoutSize } = scenario("A");
    expect(codesFor(withoutSize)).toEqual({ street_event_size: "required" });
  });
});

describe("contradictions are challenged, never resolved silently (spec #4)", () => {
  it("rejects dimensions for a structure type that was not selected", () => {
    expect(codesFor({ ...scenario("A"), tent_area_sqft: 200 })).toEqual({
      tent_area_sqft: "not_applicable",
    });
  });

  it("names the condition that would have made the question apply", () => {
    const [error] = validateIntake(
      contract,
      { ...scenario("A"), tent_area_sqft: 200 },
      FIXTURE_TODAY,
    ).errors;
    expect(error?.message).toContain("only asked when tent_canopy");
  });

  it("rejects generator specifications without a generator", () => {
    expect(codesFor({ ...scenario("A"), generator_kw: 50, generator_diesel_gallons: 4 })).toEqual({
      generator_kw: "not_applicable",
      generator_diesel_gallons: "not_applicable",
    });
  });

  it("rejects licence and assembly answers without their trigger conditions", () => {
    expect(
      codesFor({
        ...scenario("A"),
        venue_license_covers_event_area: "yes",
        venue_paco_covers_exact_event: "yes",
        venue_fdny_pa_permit_current_for_event_space: "yes",
      }),
    ).toEqual({
      venue_license_covers_event_area: "not_applicable",
      venue_paco_covers_exact_event: "not_applicable",
      venue_fdny_pa_permit_current_for_event_space: "not_applicable",
    });
  });

  it("rejects a SAPO classification on an event that cannot obstruct a public way", () => {
    expect(codesFor({ ...scenario("C"), sapo_event_type: "street_event" })).toEqual({
      sapo_event_type: "not_applicable",
    });
  });

  it("rejects an event date in the past and a headcount of zero or less", () => {
    expect(codesFor({ ...scenario("C"), event_date: "2026-07-21" })).toEqual({
      event_date: "in_the_past",
    });
    expect(codesFor({ ...scenario("C"), event_date: FIXTURE_TODAY }).event_date).toBeUndefined();
    expect(codesFor({ ...scenario("C"), headcount: 0 })).toEqual({
      headcount: "must_be_positive",
    });
    // A negative headcount is caught by the non-negative rule that guards every
    // quantity, one step earlier than the spec's "at least 1" rule.
    expect(codesFor({ ...scenario("C"), headcount: -5 })).toEqual({
      headcount: "invalid_value",
    });
  });

  it("rejects a negative quantity instead of letting it evaluate below a threshold", () => {
    // Under-prescribing is the failure mode here: -5 gallons would clear
    // FDNY-GENERATOR-001's "more than 2.5" and silently drop the permit.
    const negatives = {
      generator_gasoline_gallons: -5,
      generator_diesel_gallons: -1,
      generator_kw: -50,
    };
    expect(codesFor({ ...scenario("E"), ...negatives })).toEqual({
      generator_gasoline_gallons: "invalid_value",
      generator_diesel_gallons: "invalid_value",
      generator_kw: "invalid_value",
    });
    expect(codesFor({ ...scenario("E"), battery_present: true, battery_system_kwh: -21 })).toEqual({
      battery_system_kwh: "invalid_value",
    });
    expect(codesFor({ ...scenario("C"), capacity: -400 })).toEqual({ capacity: "invalid_value" });

    const structures = {
      structure_types: ["tent_canopy", "stage_platform_scaffold"],
      tent_area_sqft: -401,
      tent_days_in_place: -30,
      stage_height_ft: -2.5,
      stage_area_sqft: -120,
      structure_over_10ft_tall: "no",
    };
    expect(codesFor({ ...scenario("C"), ...structures })).toEqual({
      tent_area_sqft: "invalid_value",
      tent_days_in_place: "invalid_value",
      stage_height_ft: "invalid_value",
      stage_area_sqft: "invalid_value",
    });
    expect(codesFor({ ...scenario("A"), food_vendor_count: -1 })).toEqual({
      food_vendor_count: "invalid_value",
    });
  });

  it("accepts zero on every quantity, which is a real answer", () => {
    const zeroed = {
      ...scenario("E"),
      // Zero kWh is a real answer to a question that was asked, which since nyc.v2.5 means the
      // battery question was answered yes; unasked is a different state and no longer spelled 0.
      battery_present: true,
      tent_area_sqft: 0,
      tent_days_in_place: 0,
      generator_gasoline_gallons: 0,
      generator_diesel_gallons: 0,
      generator_kw: 0,
      battery_system_kwh: 0,
    };
    const result = validateIntake(contract, zeroed, FIXTURE_TODAY);
    expect(result.errors).toEqual([]);
    expect(result.values?.generator_diesel_gallons).toBe(0);
    expect(result.values?.tent_days_in_place).toBe(0);
  });

  it("returns a field error for a date that matches the shape but is not a day", () => {
    // "2026-13-01" parses to an Invalid Date; it must not escape as a thrown RangeError.
    for (const malformed of ["2026-13-01", "2026-02-30", "2026-00-10", "2026-01-32"]) {
      expect(codesFor({ ...scenario("C"), event_date: malformed }), malformed).toEqual({
        event_date: "invalid_value",
      });
    }
    expect(codesFor({ ...scenario("C"), event_date: "2026-12-31" })).toEqual({});
  });

  it("reports a field it does not recognize instead of dropping it", () => {
    expect(codesFor({ ...scenario("C"), attendee_wifi: true })).toEqual({
      attendee_wifi: "unknown_field",
    });
  });

  it("checks each declared type", () => {
    expect(
      codesFor({
        ...scenario("C"),
        borough: "hoboken",
        headcount: 12.5,
        event_date: "2026-02-30",
        food_present: "yes",
        structure_types: [],
      }),
    ).toEqual({
      borough: "invalid_value",
      headcount: "invalid_value",
      event_date: "invalid_value",
      food_present: "invalid_value",
      structure_types: "invalid_value",
    });
    expect(codesFor({ ...scenario("E"), generator_kw: "lots" })).toEqual({
      generator_kw: "invalid_value",
    });
    expect(codesFor({ ...scenario("C"), event_date: 20260916 })).toEqual({
      event_date: "invalid_value",
    });
  });

  it("checks multi-select answers against their published options", () => {
    expect(codesFor({ ...scenario("C"), structure_types: ["bouncy_house"] })).toEqual({
      structure_types: "invalid_value",
    });
    expect(codesFor({ ...scenario("C"), open_flame_or_cooking: ["none", "propane_lpg"] })).toEqual({
      open_flame_or_cooking: "invalid_value",
    });
    const deduplicated = validateIntake(
      contract,
      { ...scenario("D"), open_flame_or_cooking: ["charcoal_wood", "charcoal_wood"] },
      FIXTURE_TODAY,
    );
    expect(deduplicated.values?.open_flame_or_cooking).toEqual(["charcoal_wood"]);
  });

  it("requires a name and validates the optional descriptive answers", () => {
    const { name: _dropped, ...unnamed } = scenario("C");
    expect(codesFor(unnamed)).toEqual({ name: "required" });
    expect(codesFor({ ...scenario("C"), name: "   " })).toEqual({ name: "invalid_value" });
    expect(codesFor({ ...scenario("C"), capacity: 0 })).toEqual({
      capacity: "invalid_value",
    });
    expect(codesFor({ ...scenario("C"), location_name: 12 })).toEqual({
      location_name: "invalid_value",
    });

    const described = validateIntake(
      contract,
      { ...scenario("C"), location_name: "  Prospect Park  ", capacity: 400 },
      FIXTURE_TODAY,
    );
    expect(described.values?.location_name).toBe("Prospect Park");
    expect(described.values?.capacity).toBe(400);
  });

  it("returns no values to store while any error stands", () => {
    expect(
      validateIntake(contract, { ...scenario("C"), headcount: 0 }, FIXTURE_TODAY).values,
    ).toBeNull();
  });
});

describe("inline warnings do not block submission (spec #4, #5)", () => {
  const warningsFor = (submission: Record<string, unknown>) =>
    validateIntake(contract, submission, FIXTURE_TODAY).warnings;

  it("warns that sales conflict with block-party eligibility, and stores the event", () => {
    const selling = { ...scenario("D"), selling_anything: true };
    const result = validateIntake(contract, selling, FIXTURE_TODAY);
    expect(result.errors).toEqual([]);
    expect(result.values?.selling_anything).toBe(true);
    expect(warningsFor(selling)).toEqual([
      {
        field: "sapo_event_type",
        code: "block_party_eligibility_conflict",
        message: contract.blockPartyEligibilityNotice.text,
        ruleId: "SAPO-BLOCK-PARTY-ELIG-001",
        verificationStatus: "SOURCE_CONFIRMED",
      },
    ]);
  });

  it("warns the same way when a block party serves alcohol", () => {
    const codes = warningsFor({ ...scenario("D"), alcohol: true }).map((warning) => warning.code);
    expect(codes).toContain("block_party_eligibility_conflict");
  });

  it("renders the published coverage warning for alcohol in public space", () => {
    // The COVERAGE_GAP status travels with the text so the UI cannot render an
    // uncovered area as an evaluated one (AGENTS.md "Regulatory safety").
    expect(warningsFor({ ...scenario("C"), alcohol: true })).toEqual([
      {
        field: "alcohol",
        code: "coverage_gap",
        message: contract.alcoholInPublicSpaceNotice.text,
        ruleId: "ADV-ALCOHOL-PUBLIC-001",
        verificationStatus: "COVERAGE_GAP",
      },
    ]);
    expect(contract.alcoholInPublicSpaceNotice.text).toContain("Confirm with the relevant agency.");
  });

  it("does not warn about alcohol at a private venue", () => {
    expect(warningsFor(scenario("F"))).toEqual([]);
  });

  it("warns before the submission is complete enough to store", () => {
    const result = validateIntake(
      contract,
      { ...scenario("D"), selling_anything: true, headcount: 0 },
      FIXTURE_TODAY,
    );
    expect(result.values).toBeNull();
    expect(result.warnings).toHaveLength(1);
  });

  it("stops warning the moment the answer behind it stops applying", () => {
    // A published notice must never be shown for a scope the event no longer has. The
    // block-party classification is not asked of a park, so it cannot be what makes a
    // park event ineligible — regardless of whether the change has been saved yet.
    const sellingBlockParty = { ...scenario("D"), selling_anything: true };
    expect(warningsFor(sellingBlockParty).map((warning) => warning.code)).toEqual([
      "block_party_eligibility_conflict",
    ]);

    // The block-party answer is still sitting in the submission; a park is simply not
    // asked it, so it no longer says anything about this event.
    const movedToAPark: Record<string, unknown> = {
      ...sellingBlockParty,
      location_type: "park",
    };
    expect(movedToAPark.sapo_event_type).toBe("block_party");
    expect(warningsFor(movedToAPark)).toEqual([]);
  });

  it("stops warning about alcohol once the location is no longer public", () => {
    const alcoholInAPark = { ...scenario("C"), alcohol: true };
    expect(warningsFor(alcoholInAPark).map((warning) => warning.code)).toEqual(["coverage_gap"]);
    expect(warningsFor({ ...alcoholInAPark, location_type: "private_venue" })).toEqual([]);
  });
});

describe("recognising a save that changes nothing (AD-13)", () => {
  const storedRow = (id: string): Record<string, unknown> => {
    const values = validateIntake(contract, scenario(id), FIXTURE_TODAY).values;
    if (values === null) throw new Error(`fixture ${id} does not validate`);
    return { ...values };
  };
  const validated = (submission: Record<string, unknown>) => {
    const values = validateIntake(contract, submission, FIXTURE_TODAY).values;
    if (values === null) throw new Error("submission does not validate");
    return values;
  };

  it("sees a resubmitted intake as unchanged", () => {
    expect(isIntakeUnchanged(contract, storedRow("E"), validated(scenario("E")))).toBe(true);
  });

  it("sees a changed answer of every shape", () => {
    const stored = storedRow("E");
    for (const edit of [
      { headcount: 301 },
      { plaza_level: "b" },
      { plaza_multiple_blocks: true },
      { tent_area_sqft: 401 },
      { structure_over_10ft_tall: "no" },
      { location_name: "Flatiron Plaza" },
    ]) {
      expect(
        isIntakeUnchanged(contract, stored, validated({ ...scenario("E"), ...edit })),
        Object.keys(edit)[0],
      ).toBe(false);
    }
  });

  it("sees a cleared answer and a newly given one as changes", () => {
    const stored = storedRow("E");
    expect(
      isIntakeUnchanged(contract, stored, validated({ ...scenario("E"), tent_area_sqft: null })),
    ).toBe(false);
    expect(
      isIntakeUnchanged(contract, stored, validated({ ...scenario("E"), capacity: 500 })),
    ).toBe(false);
  });

  it("treats a multi-select as a set, not as an order", () => {
    const stored = { ...storedRow("D"), open_flame_or_cooking: ["charcoal_wood", "propane_lpg"] };
    const values = validated({
      ...scenario("D"),
      open_flame_or_cooking: ["propane_lpg", "charcoal_wood"],
    });
    expect(isIntakeUnchanged(contract, stored, values)).toBe(true);

    const dropped = validated({ ...scenario("D"), open_flame_or_cooking: ["charcoal_wood"] });
    expect(isIntakeUnchanged(contract, stored, dropped)).toBe(false);
  });

  it("ignores the columns intake does not own", () => {
    // status, revision_counter and the timestamps are not answers, so they cannot make
    // a resubmitted intake look changed.
    const stored = {
      ...storedRow("C"),
      id: "event-1",
      status: "planned",
      revision_counter: 7,
      created_at: "2026-07-24T00:00:00.000Z",
    };
    expect(isIntakeUnchanged(contract, stored, validated(scenario("C")))).toBe(true);
  });
});

describe("editing a saved intake (spec #8)", () => {
  const stored = (id: string): Record<string, unknown> => {
    const values = validateIntake(contract, scenario(id), FIXTURE_TODAY).values;
    if (values === null) throw new Error(`fixture ${id} does not validate`);
    return { ...values };
  };

  it("clears the answers a rescope hides, so the edit can be saved", () => {
    // The dead end this prevents: the organizer moves a street event into a park, the
    // SAPO controls disappear, and the stored answers fail validation against fields
    // the form no longer renders. The edit could never be saved.
    const edited = mergeIntakeEdit(contract, stored("A"), { location_type: "park" });
    expect(edited.obstructs_public_way).toBeNull();
    expect(edited.sapo_event_type).toBeNull();
    expect(edited.street_event_size).toBeNull();
    expect(edited.headcount).toBe(75);

    const result = validateIntake(contract, edited, FIXTURE_TODAY);
    expect(result.errors).toEqual([]);
    expect(result.values?.location_type).toBe("park");
  });

  it("keeps an answer the edit supplies explicitly, so a contradiction still fails", () => {
    const edited = mergeIntakeEdit(contract, stored("A"), {
      location_type: "park",
      sapo_event_type: "street_event",
    });
    expect(edited.sapo_event_type).toBe("street_event");
    expect(codesFor(edited)).toEqual({ sapo_event_type: "not_applicable" });
  });

  it("leaves answers alone when the edit hides nothing", () => {
    const edited = mergeIntakeEdit(contract, stored("A"), { headcount: 90 });
    expect(edited.headcount).toBe(90);
    expect(edited.street_event_size).toBe("large");
    expect(edited.obstructs_public_way).toBe("yes");
  });

  it("clears the dimensions of a structure type the edit deselects", () => {
    const edited = mergeIntakeEdit(contract, stored("E"), { structure_types: ["none"] });
    expect(edited.tent_area_sqft).toBeNull();
    expect(edited.tent_days_in_place).toBeNull();
    expect(edited.structure_over_10ft_tall).toBeNull();
    expect(validateIntake(contract, edited, FIXTURE_TODAY).errors).toEqual([]);
  });
});
