import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PUBLISHED_RULES_FILE } from "./__fixtures__/published-ruleset";
import { countBusinessDays, differenceInCalendarDays, evaluate, parseEngineRuleset } from "./index";
import { SCENARIO_INTAKE_FIXTURES, fixtureSubmission } from "./intake/scenario-intake-fixtures";
import type { EventIntake, Finding, PermitPlan, PublishedHolidayCalendar } from "./types";

const TODAY = "2026-07-22";

const ruleset = parseEngineRuleset(JSON.parse(readFileSync(PUBLISHED_RULES_FILE, "utf8")));

const calendar: PublishedHolidayCalendar = { id: ruleset.calendarId, holidays: [] };

const plan = (intake: EventIntake, today = TODAY): PermitPlan =>
  evaluate(intake, ruleset, today, calendar);

type ExpectedLine = {
  ruleIds: string[];
  kind: string;
  disposition: string;
  deadlineStatus: string;
  latestApplyDate?: string | null;
};

const actualLines = (findings: readonly Finding[], withDates: boolean): unknown[] =>
  findings.map((finding) => ({
    ruleIds: [...finding.ruleIds],
    kind: finding.kind,
    disposition: finding.disposition,
    deadlineStatus: finding.deadlineStatus,
    ...(withDates ? { latestApplyDate: finding.latestApplyDate } : {}),
  }));

const expectFindings = (findings: readonly Finding[], expected: ExpectedLine[]): void => {
  const withDates = expected.every((line) => line.latestApplyDate !== undefined);
  expect(actualLines(findings, withDates)).toEqual(expected);
};

const confirmationLine = (ruleId: string, withDate = true): ExpectedLine => ({
  ruleIds: [ruleId],
  kind: "note",
  disposition: "no_new_requirement",
  deadlineStatus: "not_applicable",
  ...(withDate ? { latestApplyDate: null } : {}),
});

const baseIntake: EventIntake = {
  borough: "manhattan",
  location_type: "private_venue",
  headcount: 10,
  event_date: "2026-09-30",
  event_open_to_public: "no",
  food_present: false,
  selling_anything: false,
  amplified_sound: false,
  structure_types: ["none"],
  open_flame_or_cooking: ["none"],
  generator_present: false,

  battery_present: false,
  alcohol: false,
};

describe("Scenario A — Bushwick Street Activation (demo anchor)", () => {
  const intakeA: EventIntake = {
    ...baseIntake,
    borough: "brooklyn",
    location_type: "street",
    obstructs_public_way: "yes",
    sapo_event_type: "street_event",
    street_event_size: "large",
    headcount: 75,
    event_date: "2026-08-26",
    event_open_to_public: "yes",
    food_present: true,
    food_vendor_count: 1,
    selling_anything: true,
    amplified_sound: true,
  };

  it("produces exactly the five expected findings with their published dates", () => {
    expectFindings(plan(intakeA).findings, [
      {
        ruleIds: ["SAPO-STREET-LARGE-001"],
        kind: "permit",
        disposition: "required",
        deadlineStatus: "published_deadline_missed",
        latestApplyDate: "2026-07-12",
      },

      {
        ruleIds: ["SAPO-INSURANCE-001"],
        kind: "insurance",
        disposition: "required",
        deadlineStatus: "not_applicable",
        latestApplyDate: null,
      },

      {
        ruleIds: ["NYPD-SOUND-001"],
        kind: "permit",
        disposition: "required",
        deadlineStatus: "on_track",
        latestApplyDate: "2026-08-21",
      },

      {
        ruleIds: ["DOHMH-VENDOR-PERMIT-001"],
        kind: "permit",
        disposition: "required",
        deadlineStatus: "not_calculable",
        latestApplyDate: null,
      },

      {
        ruleIds: ["DOHMH-ORGANIZER-NOTIFY-001"],
        kind: "notification",
        disposition: "may_be_required",
        deadlineStatus: "deadline_approaching",
        latestApplyDate: "2026-07-27",
      },
      confirmationLine("CONF-NO-STRUCTURE-001"),
      confirmationLine("CONF-NO-FLAME-001"),
      confirmationLine("CONF-NO-GENERATOR-001"),
      confirmationLine("CONF-NO-BATTERY-001"),
      confirmationLine("CONF-NO-ALCOHOL-001"),
    ]);
  });

  it("renders INFEASIBLE naming the SAPO street event as the blocking finding", () => {
    const result = plan(intakeA);
    expect(result.verdict).toBe("INFEASIBLE");
    expect(result.verdictDetail.blockingFinding?.ruleIds).toEqual(["SAPO-STREET-LARGE-001"]);
    expect(result.verdictDetail.missedRuleIds).toEqual(["SAPO-STREET-LARGE-001"]);
  });

  it("produces the three rescopes by full re-evaluation, not static text (AC 9)", () => {
    const suggestions = plan(intakeA).verdictDetail.rescopeSuggestions;

    expect(suggestions.map((suggestion) => suggestion.change.value)).toEqual([
      "medium",
      "small",
      "private_venue",
    ]);
    expect(suggestions).toMatchObject([
      {
        change: { field: "street_event_size", value: "medium" },
        reevaluatedVerdict: "FEASIBLE_AT_RISK",
        droppedRuleIds: ["SAPO-STREET-LARGE-001"],
        minSlackDays: 5,
      },

      {
        change: { field: "street_event_size", value: "small" },
        reevaluatedVerdict: "FEASIBLE_AT_RISK",
        droppedRuleIds: ["SAPO-STREET-LARGE-001"],
      },

      {
        change: { field: "location_type", value: "private_venue" },
        reevaluatedVerdict: "CONDITIONAL",
        droppedRuleIds: ["SAPO-INSURANCE-001", "SAPO-STREET-LARGE-001"],
      },
    ]);
    const medium = suggestions.find((s) => s.change.value === "medium");
    const small = suggestions.find((s) => s.change.value === "small");
    const privateVenue = suggestions.find((s) => s.change.value === "private_venue");
    expect(medium?.minSlackDays).toBe(5);
    expect(small?.atRiskFindingName ?? small?.minSlackDays).toBeTruthy();

    expect(privateVenue?.introducedRuleIds).toEqual(
      expect.arrayContaining(["ADV-NOISE-CODE-001", "ADV-VENUE-OCCUPANCY-001", "DOB-ASSEMBLY-001"]),
    );
    const assemblyRule = ruleset.rules.find((rule) => rule.id === "DOB-ASSEMBLY-001");
    expect(privateVenue?.introducedFindings).toContainEqual({
      ruleIds: ["DOB-ASSEMBLY-001"],
      label: assemblyRule?.userSummary?.heading,
      source: assemblyRule?.userSummary?.points[0]?.sources[0],
      portalName: null,
      portalUrl: null,
    });
    expect(privateVenue?.remainingMissingFields).toContain("sound_audible_from_public_way");
    expect(privateVenue?.remainingTimelineReasons).toEqual([]);

    expect(privateVenue !== undefined && !("minSlackDays" in privateVenue)).toBe(true);
    expect(privateVenue !== undefined && !("atRiskFindingName" in privateVenue)).toBe(true);
  });

  it("keeps the private-venue ladder step when the holiday calendar is unpublished", () => {
    const unpublished = { id: ruleset.calendarId, holidays: null };
    const suggestions = evaluate(intakeA, ruleset, TODAY, unpublished).verdictDetail
      .rescopeSuggestions;
    expect(suggestions.map((suggestion) => suggestion.change.value)).toEqual([
      "medium",
      "small",
      "private_venue",
    ]);
    const privateVenue = suggestions.find(
      (suggestion) => suggestion.change.value === "private_venue",
    );
    expect(privateVenue?.reevaluatedVerdict).toBe("CONDITIONAL");
    expect(privateVenue?.introducedRuleIds).toEqual(expect.arrayContaining(["DOB-ASSEMBLY-001"]));
  });

  it("re-evaluates rescope (a) to the 30-day deadline and five days of slack", () => {
    const rescoped = plan({ ...intakeA, street_event_size: "medium" });
    expect(rescoped.verdict).toBe("FEASIBLE_AT_RISK");
    expect(rescoped.verdictDetail.minSlackDays).toBe(5);
    const sapo = rescoped.findings.find((finding) =>
      finding.ruleIds.includes("SAPO-STREET-MEDIUM-001"),
    );
    expect(sapo?.latestApplyDate).toBe("2026-07-27");
  });

  it("re-evaluates rescope (b) to an on-track SAPO date with the DOHMH notification still tight", () => {
    const rescoped = plan({ ...intakeA, street_event_size: "small" });
    expect(rescoped.verdict).toBe("FEASIBLE_AT_RISK");
    const sapo = rescoped.findings.find((finding) =>
      finding.ruleIds.includes("SAPO-STREET-SMALL-001"),
    );
    expect(sapo?.latestApplyDate).toBe("2026-08-12");
    expect(sapo?.deadlineStatus).toBe("on_track");
    expect(rescoped.verdictDetail.minSlackDays).toBe(5);
  });

  it("re-evaluates rescope (c) so SAPO and insurance drop and DOHMH plus occupancy remain", () => {
    const rescoped = plan({ ...intakeA, location_type: "private_venue" });
    const ruleIds = rescoped.findings.flatMap((finding) => finding.ruleIds);
    expect(ruleIds).not.toContain("SAPO-STREET-LARGE-001");
    expect(ruleIds).not.toContain("SAPO-INSURANCE-001");
    expect(ruleIds).toContain("DOHMH-VENDOR-PERMIT-001");
    expect(ruleIds).toContain("DOHMH-ORGANIZER-NOTIFY-001");
    expect(ruleIds).toContain("ADV-VENUE-OCCUPANCY-001");
  });
});

describe("Scenario B — Gallery Pop-up (false-positive test)", () => {
  const intakeB: EventIntake = {
    ...baseIntake,
    headcount: 60,
    event_date: "2026-08-12",
    event_open_to_public: "yes",
    food_present: true,
    food_vendor_count: 1,
  };

  it("identifies a low burden and nothing more: no SAPO, sound, assembly, or insurance line", () => {
    expectFindings(plan(intakeB).findings, [
      {
        ruleIds: ["DOHMH-VENDOR-PERMIT-001"],
        kind: "permit",
        disposition: "required",
        deadlineStatus: "not_calculable",
        latestApplyDate: null,
      },

      {
        ruleIds: ["DOHMH-ORGANIZER-NOTIFY-001"],
        kind: "notification",
        disposition: "may_be_required",
        deadlineStatus: "published_deadline_missed",
        latestApplyDate: "2026-07-13",
      },
      confirmationLine("CONF-NO-SALES-001"),
      confirmationLine("CONF-NO-AMPLIFIED-SOUND-001"),
      confirmationLine("CONF-NO-STRUCTURE-001"),
      confirmationLine("CONF-NO-FLAME-001"),
      confirmationLine("CONF-NO-GENERATOR-001"),
      confirmationLine("CONF-NO-BATTERY-001"),
      confirmationLine("CONF-NO-ALCOHOL-001"),

      {
        ruleIds: ["ADV-VENUE-OCCUPANCY-001"],
        kind: "advisory",
        disposition: "advisory",
        deadlineStatus: "not_applicable",
        latestApplyDate: null,
      },
    ]);
  });

  it("surfaces the passed notification date inside the conditional, not as a definitive miss", () => {
    const result = plan(intakeB);
    expect(result.verdict).toBe("CONDITIONAL");
    expect(result.verdictDetail.blockingFinding).toBeNull();
    expect(result.verdictDetail.missedRuleIds).toEqual(["DOHMH-ORGANIZER-NOTIFY-001"]);
  });
});

describe("Scenario C — Prospect Park Community Day (dependency chain)", () => {
  const intakeC: EventIntake = {
    ...baseIntake,
    borough: "brooklyn",
    location_type: "park",
    headcount: 150,
    event_date: "2026-09-16",
    event_open_to_public: "yes",
    amplified_sound: true,
  };

  it("produces the four expected findings", () => {
    expectFindings(plan(intakeC).findings, [
      {
        ruleIds: ["NYPD-SOUND-001"],
        kind: "permit",
        disposition: "required",
        deadlineStatus: "on_track",
        latestApplyDate: "2026-09-11",
      },

      {
        ruleIds: ["NYPD-SOUND-PARKS-DEP-001"],
        kind: "dependency",
        disposition: "may_be_required",
        deadlineStatus: "not_applicable",
        latestApplyDate: null,
      },

      {
        ruleIds: ["PARKS-EVENT-001"],
        kind: "permit",
        disposition: "required",
        deadlineStatus: "on_track",
        latestApplyDate: "2026-08-26",
      },

      {
        ruleIds: ["PARKS-INSURANCE-NOTE-001"],
        kind: "note",
        disposition: "no_new_requirement",
        deadlineStatus: "not_applicable",
        latestApplyDate: null,
      },
      confirmationLine("CONF-NO-FOOD-001"),
      confirmationLine("CONF-NO-SALES-001"),
      confirmationLine("CONF-NO-STRUCTURE-001"),
      confirmationLine("CONF-NO-FLAME-001"),
      confirmationLine("CONF-NO-GENERATOR-001"),
      confirmationLine("CONF-NO-BATTERY-001"),
      confirmationLine("CONF-NO-ALCOHOL-001"),
    ]);
  });

  it("keeps the published in-person filing instructions on the sound permit", () => {
    const sound = plan(intakeC).findings.find((finding) =>
      finding.ruleIds.includes("NYPD-SOUND-001"),
    );
    expect(sound?.portalUrl).toBeNull();
    expect(sound?.portalName).toBe("Local NYPD precinct (in person)");
    expect(sound?.portalInstructions).toBe(
      "File at the precinct where the device will be used; application form PD 656-041A.",
    );
  });

  it("renders FEASIBLE with the sequencing caveat as a note, not a verdict change", () => {
    const result = plan(intakeC);
    expect(result.verdict).toBe("FEASIBLE");
    const dependency = result.findings.find((finding) =>
      finding.ruleIds.includes("NYPD-SOUND-PARKS-DEP-001"),
    );
    expect(dependency?.name).toContain("Parks amplified-sound permission");
  });

  it("dates the Parks-to-NYPD sequence: apply now, decide, then pursue the sound permit", () => {
    const sound = plan(intakeC).findings.find((finding) =>
      finding.ruleIds.includes("NYPD-SOUND-001"),
    );

    expect(sound?.applyAfterDate).toBe("2026-08-12");
    expect(sound?.latestApplyDate).toBe("2026-09-11");
    expect(sound?.deadlineStatus).toBe("on_track");
    expect(sound?.notes.join(" ")).toContain("earliest pursuit 2026-08-12");
    expect(sound?.notes.join(" ")).toContain("21–30 day decision window");

    expect(sound?.notes.join(" ")).toContain("not confirmed by located primary text");
  });

  it("reports gated slack as the filing window, not the distance to the deadline", () => {
    const runway35 = plan({ ...intakeC, event_date: "2026-08-26" });
    const sound = runway35.findings.find((finding) => finding.ruleIds.includes("NYPD-SOUND-001"));

    expect(sound?.applyAfterDate).toBe("2026-08-12");
    expect(sound?.latestApplyDate).toBe("2026-08-21");

    expect(sound?.slackDays).toBe(
      differenceInCalendarDays(sound?.applyAfterDate ?? "", sound?.latestApplyDate ?? ""),
    );
    expect(sound?.slackDays).toBe(9);

    expect(runway35.verdictDetail.minSlackDays).toBe(9);
  });

  it("warns but never fabricates a blocker when the sequence is squeezed", () => {
    const squeezed = plan({ ...intakeC, event_date: "2026-08-16" });
    const sound = squeezed.findings.find((finding) => finding.ruleIds.includes("NYPD-SOUND-001"));
    expect(sound?.latestApplyDate).toBe("2026-08-11");
    expect(sound?.applyAfterDate).toBeNull();
    expect(sound?.notes.join(" ")).toContain("leaves no window to file in");
    expect(sound?.deadlineStatus).toBe("deadline_approaching");
    expect(squeezed.verdict).toBe("FEASIBLE_AT_RISK");
  });
});

describe("Scenario D — Queens Block Party (tight but feasible)", () => {
  const intakeD: EventIntake = {
    ...baseIntake,
    borough: "queens",
    location_type: "street",
    obstructs_public_way: "yes",
    sapo_event_type: "block_party",
    has_amusement_ride: false,
    headcount: 200,
    event_date: "2026-09-30",
    event_open_to_public: "yes",
    amplified_sound: true,
    open_flame_or_cooking: ["charcoal_wood"],
  };

  it("produces four findings and no insurance line (block party without a ride is exempt)", () => {
    expectFindings(plan(intakeD).findings, [
      {
        ruleIds: ["SAPO-BLOCK-PARTY-001"],
        kind: "permit",
        disposition: "required",
        deadlineStatus: "deadline_approaching",
        latestApplyDate: "2026-08-01",
      },

      {
        ruleIds: ["SAPO-BLOCK-PARTY-SPONSOR-001"],
        kind: "eligibility",
        disposition: "may_be_required",
        deadlineStatus: "not_applicable",
        latestApplyDate: null,
      },

      {
        ruleIds: ["NYPD-SOUND-001"],
        kind: "permit",
        disposition: "required",
        deadlineStatus: "on_track",
        latestApplyDate: "2026-09-25",
      },

      {
        ruleIds: ["FDNY-FUEL-001"],
        kind: "permit",
        disposition: "required",
        deadlineStatus: "not_calculable",
        latestApplyDate: null,
      },
      confirmationLine("CONF-NO-FOOD-001"),
      confirmationLine("CONF-NO-SALES-001"),
      confirmationLine("CONF-NO-STRUCTURE-001"),
      confirmationLine("CONF-NO-GENERATOR-001"),
      confirmationLine("CONF-NO-BATTERY-001"),
      confirmationLine("CONF-NO-ALCOHOL-001"),
      confirmationLine("CONF-NO-BLOCK-PARTY-RIDE-001"),
    ]);
  });

  it("renders FEASIBLE-AT-RISK with exactly ten days of slack", () => {
    const result = plan(intakeD);
    expect(result.verdict).toBe("FEASIBLE_AT_RISK");
    expect(result.verdictDetail.minSlackDays).toBe(10);
  });

  it("lists the fuel permit as a fuel matter with 'confirm with agency', not a dated lead", () => {
    const fuel = plan(intakeD).findings.find((finding) =>
      finding.ruleIds.includes("FDNY-FUEL-001"),
    );
    expect(fuel?.name).toContain("FDNY Fuel Permit");
    expect(fuel?.notes).toContain("confirm with agency");
  });
});

describe("Scenario E — Plaza Brand Activation (max complexity)", () => {
  const intakeE: EventIntake = {
    ...baseIntake,
    location_type: "plaza",
    obstructs_public_way: "yes",
    sapo_event_type: "plaza_event",
    plaza_level: "a",
    plaza_multiple_blocks: false,
    headcount: 300,
    event_date: "2026-12-04",
    event_open_to_public: "yes",
    food_present: true,
    food_vendor_count: 2,
    amplified_sound: true,
    structure_types: ["tent_canopy"],
    tent_area_sqft: 400,
    tent_days_in_place: 1,
    structure_over_10ft_tall: "unknown",
    generator_present: true,
    generator_gasoline_gallons: 5,
    generator_diesel_gallons: 0,
    generator_kw: 50,
  };

  it("produces the expected findings, with the two DOB structure rules as one line", () => {
    expectFindings(plan(intakeE).findings, [
      {
        ruleIds: ["SAPO-PLAZA-001"],
        kind: "permit",
        disposition: "required",
        deadlineStatus: "on_track",
      },
      {
        ruleIds: ["SAPO-INSURANCE-001"],
        kind: "insurance",
        disposition: "required",
        deadlineStatus: "not_applicable",
      },
      {
        ruleIds: ["NYPD-SOUND-001"],
        kind: "permit",
        disposition: "required",
        deadlineStatus: "on_track",
      },
      {
        ruleIds: ["DOHMH-VENDOR-PERMIT-001"],
        kind: "permit",
        disposition: "required",
        deadlineStatus: "not_calculable",
      },
      {
        ruleIds: ["DOHMH-ORGANIZER-NOTIFY-001"],
        kind: "notification",
        disposition: "may_be_required",
        deadlineStatus: "on_track",
      },
      {
        ruleIds: ["FDNY-GENERATOR-001"],
        kind: "permit",
        disposition: "required",
        deadlineStatus: "not_calculable",
      },
      {
        ruleIds: ["DEP-GENERATOR-REG-001"],
        kind: "registration",
        disposition: "required",
        deadlineStatus: "not_calculable",
      },

      {
        ruleIds: ["DOB-TENT-001", "DOB-TALL-STRUCTURE-001"],
        kind: "permit",
        disposition: "may_be_required",
        deadlineStatus: "on_track",
      },
      confirmationLine("CONF-NO-SALES-001", false),
      confirmationLine("CONF-NO-FLAME-001", false),
      confirmationLine("CONF-NO-BATTERY-001", false),
      confirmationLine("CONF-NO-ALCOHOL-001", false),
    ]);
  });

  it("dates the Level A single-block plaza deadline at 45 days with every dated line on track", () => {
    const result = plan(intakeE);
    const plaza = result.findings.find((finding) => finding.ruleIds.includes("SAPO-PLAZA-001"));
    expect(plaza?.latestApplyDate).toBe("2026-10-20");
    expect(
      result.findings
        .filter((finding) => finding.latestApplyDate !== null)
        .map((f) => f.deadlineStatus),
    ).toEqual(Array(4).fill("on_track"));
    expect(result.verdict).toBe("CONDITIONAL");
  });

  it("keeps the 400 sq ft tent line conditional with the published footprint caveat", () => {
    const tent = plan(intakeE).findings.find((finding) => finding.ruleIds.includes("DOB-TENT-001"));
    expect(tent?.disposition).toBe("may_be_required");
    expect(tent?.notes.join(" ")).toContain("confirm footprint calculation with DOB");
  });

  it("names the conditional boundary when tent area is unanswered", () => {
    const result = plan({ ...intakeE, tent_area_sqft: null, structure_over_10ft_tall: false });
    const tentFact = result.verdictDetail.missingFacts.find(
      (fact) => fact.field === "tent_area_sqft",
    );

    expect(tentFact?.thresholds).toContain("DOB-TENT-001 applies above 400");
    expect(tentFact?.thresholds).toContain("exactly 400 is a conditional boundary");
  });
});

describe("Scenario F — Rooftop Launch Party (conditional branches)", () => {
  const intakeF: EventIntake = {
    ...baseIntake,
    headcount: 90,
    event_date: "2026-08-11",
    event_open_to_public: "no",
    food_present: true,
    amplified_sound: true,
    sound_audible_from_public_way: "unknown",
    alcohol: true,
    venue_license_covers_event_area: "unknown",
    venue_paco_covers_exact_event: "unknown",
    venue_fdny_pa_permit_current_for_event_space: "unknown",
  };

  it("produces the expected conditional finding set", () => {
    expectFindings(plan(intakeF).findings, [
      {
        ruleIds: ["NYPD-SOUND-001"],
        kind: "permit",
        disposition: "may_be_required",
        deadlineStatus: "on_track",
      },
      {
        ruleIds: ["DOHMH-EXEMPTION-001"],
        kind: "advisory",
        disposition: "may_be_required",
        deadlineStatus: "not_applicable",
      },
      {
        ruleIds: ["DOB-ASSEMBLY-001"],
        kind: "permit",
        disposition: "may_be_required",
        deadlineStatus: "deadline_approaching",
      },
      {
        ruleIds: ["SLA-VENUE-LICENSE-001"],
        kind: "advisory",
        disposition: "no_new_requirement",
        deadlineStatus: "not_applicable",
      },
      {
        ruleIds: ["SLA-ONEDAY-001"],
        kind: "permit",
        disposition: "may_be_required",
        deadlineStatus: "published_deadline_missed",
      },
      {
        ruleIds: ["SLA-CATERING-001"],
        kind: "permit",
        disposition: "may_be_required",
        deadlineStatus: "published_deadline_missed",
      },
      confirmationLine("CONF-NO-SALES-001", false),
      confirmationLine("CONF-NO-STRUCTURE-001", false),
      confirmationLine("CONF-NO-FLAME-001", false),
      confirmationLine("CONF-NO-GENERATOR-001", false),
      confirmationLine("CONF-NO-BATTERY-001", false),
      {
        ruleIds: ["ADV-NOISE-CODE-001"],
        kind: "advisory",
        disposition: "advisory",
        deadlineStatus: "not_applicable",
      },
      {
        ruleIds: ["ADV-VENUE-OCCUPANCY-001"],
        kind: "advisory",
        disposition: "advisory",
        deadlineStatus: "not_applicable",
      },
    ]);
  });

  it("renders CONDITIONAL rather than INFEASIBLE: branches run before window checks", () => {
    const result = plan(intakeF);
    expect(result.verdict).toBe("CONDITIONAL");
    const licenseFact = result.verdictDetail.missingFacts.find(
      (fact) => fact.field === "venue_license_covers_event_area",
    );

    expect(licenseFact?.branches.map((branch) => [branch.value, branch.verdict])).toEqual([
      ["yes", "CONDITIONAL"],
      ["no", "INFEASIBLE"],
    ]);
    const noLicense = licenseFact?.branches.find((branch) => branch.value === "no");

    expect(noLicense?.reason).toContain("published deadline missed as scoped");
    expect(noLicense?.reason).not.toBe("same findings, re-dated");

    const sla = ruleset.rules.find((rule) => rule.id === "SLA-ONEDAY-001");
    expect(noLicense?.reason).toContain("SLA-ONEDAY-001");
    expect(sla?.userSummary?.heading).toBeDefined();
    expect(noLicense?.reason).not.toContain(sla?.userSummary?.heading);

    expect(result.verdictDetail.missingFacts.map((fact) => fact.field).sort()).toEqual([
      "sound_audible_from_public_way",
      "venue_license_covers_event_area",
    ]);
  });

  it("keeps both assembly-document confirmations outside the verdict branches", () => {
    const baseline = plan(intakeF);
    for (const value of ["yes", "no"] as const) {
      const result = plan({
        ...intakeF,
        venue_paco_covers_exact_event: value,
        venue_fdny_pa_permit_current_for_event_space: value,
      });
      expect([result.verdict, result.findings.map((finding) => finding.ruleIds)]).toEqual([
        baseline.verdict,
        baseline.findings.map((finding) => finding.ruleIds),
      ]);
    }
    const missingFields = baseline.verdictDetail.missingFacts.map((fact) => fact.field);
    expect(missingFields).not.toContain("venue_paco_covers_exact_event");
    expect(missingFields).not.toContain("venue_fdny_pa_permit_current_for_event_space");
  });

  it("never reinterprets the deprecated historical food-exception claim", () => {
    const current = plan(intakeF);
    for (const historicalValue of ["yes", "no", "unknown"]) {
      expect(
        plan({
          ...intakeF,
          food_affinity_private_exception_claimed: historicalValue,
        }),
      ).toEqual(current);
    }
  });

  it("counts real business days: 14 remain against the published 15 (AC 10)", () => {
    const oneDay = plan(intakeF).findings.find((finding) =>
      finding.ruleIds.includes("SLA-ONEDAY-001"),
    );
    expect(countBusinessDays(TODAY, "2026-08-11", calendar)).toBe(14);
    expect(oneDay?.latestApplyDate).toBe("2026-07-21");
    expect(oneDay?.deadlineStatus).toBe("published_deadline_missed");
  });
});

describe("Issue #107 named confirmations", () => {
  const cases = [
    {
      id: "CONF-NO-FOOD-001",
      negative: { food_present: false },
      positive: { food_present: true },
      triggeredBy: [{ field: "food_present", value: false }],
      name: "No food-service path identified",
      noteText:
        "From the answers recorded in this plan, the published ruleset identified no food-service path because you answered that no food applies. This is not a legal exemption and does not mean no other requirement applies.",
      status: "SOURCE_CONFIRMED",
      citation: "DOHMH temporary-events page + Health Code Article 88 + Event Sponsor Guidelines",
      urls: [
        "https://www.nyc.gov/site/doh/business/food-operators/temporary-food-service-establishments.page",
        "https://www.nyc.gov/assets/doh/downloads/pdf/about/healthcode/health-code-article88.pdf",
        "https://www.nyc.gov/assets/doh/downloads/pdf/rii/temp-vendors.pdf",
      ],
    },
    {
      id: "CONF-NO-SALES-001",
      negative: { selling_anything: false },
      positive: { selling_anything: true },
      triggeredBy: [{ field: "selling_anything", value: false }],
      name: "No sales-triggered path identified",
      noteText:
        "From the answers recorded in this plan, the published ruleset identified no sales-triggered path because you answered that nothing will be sold. Parks sources conflict over whether a Temporary Use Authorization applies to any sale or only sales at events of 500 or more people; both readings require a sale, so this no-sale confirmation is unchanged. This is not a legal exemption and does not mean no other requirement applies.",
      status: "OFFICIAL_CONFLICT",
      citation:
        "CECM block-parties page; nycgovparks.org vendors + guide + large-events pages vs. FAQ",
      urls: [
        "https://www.nyc.gov/site/cecm/permitting/permit-types/block-parties.page",
        "https://www.nycgovparks.org/permits/special-events/vendors",
        "https://www.nycgovparks.org/permits/special-events/guide",
        "https://www.nycgovparks.org/permits/special-events/large-events",
        "https://www.nycgovparks.org/permits/special-events/faq",
      ],
    },
    {
      id: "CONF-NO-AMPLIFIED-SOUND-001",
      negative: { amplified_sound: false },
      positive: { amplified_sound: true },
      triggeredBy: [{ field: "amplified_sound", value: false }],
      name: "No amplified-sound path identified",
      noteText:
        "From the answers recorded in this plan, the published ruleset identified no amplified-sound path because you answered that no amplified sound applies. This is not a legal exemption and does not mean no other requirement applies.",
      status: "SOURCE_CONFIRMED",
      citation:
        "NYPD permits page + NYC Admin Code §§10-108, 24-244, 24-231 + Parks special-event guide",
      urls: [
        "https://www.nyc.gov/site/nypd/services/law-enforcement/permits-licenses-permits.page",
        "https://codelibrary.amlegal.com/codes/newyorkcity/latest/NYCadmin/0-0-0-6027",
        "https://codelibrary.amlegal.com/codes/newyorkcity/latest/NYCadmin/0-0-0-209196",
        "https://codelibrary.amlegal.com/codes/newyorkcity/latest/NYCadmin/0-0-0-209184",
        "https://www.nycgovparks.org/permits/special-events/guide",
      ],
    },
    {
      id: "CONF-NO-STRUCTURE-001",
      negative: { structure_types: ["none"] },
      positive: { structure_types: ["tent_canopy"] },
      triggeredBy: [{ field: "structure_types", value: ["none"] }],
      name: "No temporary-structure path identified",
      noteText:
        "From the answers recorded in this plan, the published ruleset identified no temporary-structure path because you answered that no listed temporary structures applies. This is not a legal exemption and does not mean no other requirement applies.",
      status: "SOURCE_CONFIRMED",
      citation: "CECM DOB support page + DOB TUP page + CECM street-events page",
      urls: [
        "https://www.nyc.gov/site/cecm/support/department-of-buildings.page",
        "https://www.nyc.gov/site/buildings/industry/tup.page",
        "https://www.nyc.gov/site/cecm/permitting/permit-types/street-events.page",
      ],
    },
    {
      id: "CONF-NO-FLAME-001",
      negative: { open_flame_or_cooking: ["none"] },
      positive: { open_flame_or_cooking: ["charcoal_wood"] },
      triggeredBy: [{ field: "open_flame_or_cooking", value: ["none"] }],
      name: "No fuel or open-flame path identified",
      noteText:
        "From the answers recorded in this plan, the published ruleset identified no fuel or open-flame path because you answered that no listed flame or cooking fuels applies. This is not a legal exemption and does not mean no other requirement applies.",
      status: "SOURCE_CONFIRMED",
      citation: "CECM FDNY page + FDNY Open Flame page + NYC311 barbecuing article KA-02228",
      urls: [
        "https://www.nyc.gov/site/cecm/support/new-york-city-fire-department.page",
        "https://www.nyc.gov/site/fdny/business/all-certifications/per-openflames.page",
        "https://portal.311.nyc.gov/article/?kanumber=KA-02228",
      ],
    },
    {
      id: "CONF-NO-GENERATOR-001",
      negative: { generator_present: false },
      positive: { generator_present: true },
      triggeredBy: [{ field: "generator_present", value: false }],
      name: "No generator path identified",
      noteText:
        "From the answers recorded in this plan, the published ruleset identified no generator path because you answered that no generator applies. This is not a legal exemption and does not mean no other requirement applies.",
      status: "SOURCE_CONFIRMED",
      citation: "CECM FDNY and DEP pages + Parks special-event guide",
      urls: [
        "https://www.nyc.gov/site/cecm/support/new-york-city-fire-department.page",
        "https://www.nyc.gov/site/cecm/support/department-of-environmental-protection.page",
        "https://www.nycgovparks.org/permits/special-events/guide",
      ],
    },
    {
      id: "CONF-NO-BATTERY-001",
      negative: { battery_present: false },
      positive: { battery_present: true },
      triggeredBy: [{ field: "battery_present", value: false }],
      name: "No battery-system path identified",
      noteText:
        "From the answers recorded in this plan, the published ruleset identified no battery-system path because you answered that no event battery system applies. This is not a legal exemption and does not mean no other requirement applies.",
      status: "SOURCE_CONFIRMED",
      citation: "CECM FDNY page + Parks special-event guide",
      urls: [
        "https://www.nyc.gov/site/cecm/support/new-york-city-fire-department.page",
        "https://www.nycgovparks.org/permits/special-events/guide",
      ],
    },
    {
      id: "CONF-NO-ALCOHOL-001",
      negative: { alcohol: false },
      positive: { alcohol: true },
      triggeredBy: [{ field: "alcohol", value: false }],
      name: "No alcohol path identified",
      noteText:
        "From the answers recorded in this plan, the published ruleset identified no alcohol path because you answered that no alcohol applies. This is not a legal exemption and does not mean no other requirement applies.",
      status: "SOURCE_CONFIRMED",
      citation: "CECM block-parties page + SLA permits page",
      urls: [
        "https://www.nyc.gov/site/cecm/permitting/permit-types/block-parties.page",
        "https://sla.ny.gov/permits-available-online",
      ],
    },
    {
      id: "CONF-NO-BLOCK-PARTY-RIDE-001",
      negative: {
        location_type: "street",
        obstructs_public_way: "yes",
        sapo_event_type: "block_party",
        has_amusement_ride: false,
      },
      positive: {
        location_type: "street",
        obstructs_public_way: "yes",
        sapo_event_type: "block_party",
        has_amusement_ride: true,
      },
      triggeredBy: [
        { field: "sapo_event_type", value: "block_party" },
        { field: "has_amusement_ride", value: false },
      ],
      name: "No block-party ride-insurance path identified",
      noteText:
        "From the answers recorded in this plan, the published ruleset identified no block-party ride-insurance path because you answered that the block party has no amusement ride applies. This is not a legal exemption and does not mean no other requirement applies.",
      status: "SOURCE_CONFIRMED",
      citation: "CECM FAQ + block-parties page",
      urls: [
        "https://www.nyc.gov/site/cecm/support/frequently-asked-questions.page",
        "https://www.nyc.gov/site/cecm/permitting/permit-types/block-parties.page",
      ],
    },
  ] as const;

  it.each(cases)(
    "$id emits exactly its sourced confirmation only for the approved answer",
    (test) => {
      const negative = plan({ ...baseIntake, ...test.negative }).findings.filter((finding) =>
        finding.ruleIds.includes(test.id),
      );
      expect(negative).toHaveLength(1);
      expect(negative[0]).toMatchObject({
        ruleIds: [test.id],
        kind: "note",
        disposition: "no_new_requirement",
        name: test.name,
        agency: null,
        deadline: null,
        deadlineStatus: "not_applicable",
        feeDisplay: null,
        portalName: null,
        portalUrl: null,
        portalInstructions: null,
        noteText: test.noteText,
        verificationStatus: test.status,
        triggeredBy: test.triggeredBy,
        sources: [{ ruleId: test.id, citation: test.citation, urls: test.urls }],
      });
      expect(
        plan({ ...baseIntake, ...test.positive }).findings.some((finding) =>
          finding.ruleIds.includes(test.id),
        ),
      ).toBe(false);
    },
  );

  it("does not emit the ride confirmation when the conditional gate was not asked", () => {
    const result = plan({
      ...baseIntake,
      location_type: "park",
      sapo_event_type: "block_party",
      has_amusement_ride: false,
    });
    expect(
      result.findings.some((finding) => finding.ruleIds.includes("CONF-NO-BLOCK-PARTY-RIDE-001")),
    ).toBe(false);
  });

  it.each([
    ["obstructs_public_way", { location_type: "street", obstructs_public_way: "unknown" }],
    ["event_open_to_public", { event_open_to_public: "unknown" }],
    [
      "sound_audible_from_public_way",
      { amplified_sound: true, sound_audible_from_public_way: "unknown" },
    ],
    [
      "structure_over_10ft_tall",
      {
        structure_types: ["tent_canopy"],
        tent_area_sqft: 100,
        tent_days_in_place: 1,
        structure_over_10ft_tall: "unknown",
      },
    ],
    [
      "venue_license_covers_event_area",
      { alcohol: true, venue_license_covers_event_area: "unknown" },
    ],
    ["venue_paco_covers_exact_event", { headcount: 90, venue_paco_covers_exact_event: "unknown" }],
    [
      "venue_fdny_pa_permit_current_for_event_space",
      { headcount: 90, venue_fdny_pa_permit_current_for_event_space: "unknown" },
    ],
  ] as const)(
    "keeps the UNKNOWN-capable %s field out of named-confirmation provenance",
    (field, overrides) => {
      const confirmations = plan({ ...baseIntake, ...overrides }).findings.filter((finding) =>
        finding.ruleIds[0]?.startsWith("CONF-"),
      );
      expect(
        confirmations.some((finding) =>
          finding.triggeredBy.some((trigger) => trigger.field === field),
        ),
      ).toBe(false);
    },
  );
});

describe("Boundary and unit fixtures (AC 8)", () => {
  const parkIntake = (headcount: number): EventIntake => ({
    ...baseIntake,
    location_type: "park",
    headcount,
    event_date: "2026-09-30",
    event_open_to_public: "yes",
  });

  const substantiveFindings = (result: PermitPlan): readonly Finding[] =>
    result.findings.filter((finding) => !finding.ruleIds[0]?.startsWith("CONF-"));

  const ruleIdsOf = (result: PermitPlan): string[] =>
    substantiveFindings(result).flatMap((finding) => finding.ruleIds);

  const neutralIntake: EventIntake = { ...baseIntake, location_type: "park", headcount: 10 };

  it("park headcount 19 identifies no new city requirement at all", () => {
    const result = plan(parkIntake(19));
    expect(substantiveFindings(result)).toEqual([]);
    expect(result.verdict).toBe("FEASIBLE");
  });

  it("park headcount 20 renders the official conflict with both readings and every source", () => {
    const conflict = plan(parkIntake(20)).findings;
    expect(ruleIdsOf(plan(parkIntake(20)))).toEqual(["PARKS-EVENT-EXACTLY-20-001"]);
    expect(conflict[0]?.disposition).toBe("may_be_required");
    expect(conflict[0]?.verificationStatus).toBe("OFFICIAL_CONFLICT");
    expect(conflict[0]?.conflictText).toContain("twenty or more people");
    expect(conflict[0]?.conflictText).toContain("more than 20");
    expect(conflict[0]?.sources[0]?.urls).toHaveLength(3);
  });

  it("park headcount 21 requires the permit", () => {
    expect(ruleIdsOf(plan(parkIntake(21)))).toEqual([
      "PARKS-EVENT-001",
      "PARKS-INSURANCE-NOTE-001",
    ]);
  });

  it("renders the Parks TUA conflict when anything is sold on parkland", () => {
    const tua = plan({ ...parkIntake(21), selling_anything: true }).findings.find((finding) =>
      finding.ruleIds.includes("PARKS-TUA-001"),
    );
    expect(tua?.disposition).toBe("may_be_required");
    expect(tua?.verificationStatus).toBe("OFFICIAL_CONFLICT");
    expect(tua?.conflictText).toContain("OFFICIAL CONFLICT");
    expect(tua?.sources[0]?.urls).toHaveLength(4);
  });

  const blockParty: EventIntake = {
    ...baseIntake,
    location_type: "street",
    obstructs_public_way: "yes",
    sapo_event_type: "block_party",
    has_amusement_ride: false,
    headcount: 100,
    event_open_to_public: "yes",
  };

  it("block party plus sales renders PROHIBITED_OR_INELIGIBLE while still listing the permit", () => {
    const result = plan({ ...blockParty, selling_anything: true });
    const ruleIds = ruleIdsOf(result);
    expect(ruleIds).toContain("SAPO-BLOCK-PARTY-001");
    const eligibility = plan({ ...blockParty, selling_anything: true }).findings.find((finding) =>
      finding.ruleIds.includes("SAPO-BLOCK-PARTY-ELIG-001"),
    );
    expect(eligibility?.disposition).toBe("prohibited_or_ineligible");
    expect(eligibility?.noteText).toContain("rescope or apply under a different SAPO class");
    expect(result.verdict).toBe("INFEASIBLE");
    expect(result.verdictDetail.blockingFinding?.ruleIds).toEqual(["SAPO-BLOCK-PARTY-ELIG-001"]);
    expect(result.verdictDetail.missedRuleIds).toEqual([]);
  });

  it("block party with a ride adds the insurance finding", () => {
    expect(ruleIdsOf(plan(blockParty))).not.toContain("SAPO-INSURANCE-BLOCK-PARTY-RIDE-001");
    expect(ruleIdsOf(plan({ ...blockParty, has_amusement_ride: true }))).toContain(
      "SAPO-INSURANCE-BLOCK-PARTY-RIDE-001",
    );
  });

  const tentIntake = (tentAreaSqft: number): EventIntake => ({
    ...neutralIntake,
    structure_types: ["tent_canopy"],
    tent_area_sqft: tentAreaSqft,
    tent_days_in_place: 1,
    structure_over_10ft_tall: "no",
  });

  it("tent 399 / 400 / 401 sq ft: nothing, conditional, required", () => {
    expect(ruleIdsOf(plan(tentIntake(399)))).toEqual([]);
    const atBoundary = substantiveFindings(plan(tentIntake(400)));
    expect(atBoundary.map((finding) => finding.ruleIds)).toEqual([["DOB-TENT-001"]]);
    expect(atBoundary[0]?.disposition).toBe("may_be_required");
    const over = substantiveFindings(plan(tentIntake(401)));
    expect(over.map((finding) => finding.ruleIds)).toEqual([["DOB-TENT-001"]]);
    expect(over[0]?.disposition).toBe("required");
  });

  it("tent in place 30+ days triggers the same permit on the duration arm", () => {
    expect(ruleIdsOf(plan({ ...tentIntake(100), tent_days_in_place: 30 }))).toEqual([
      "DOB-TENT-001",
    ]);
  });

  it("prop/truss height no, unknown, and yes resolve to none, conditional, and required", () => {
    const propTruss = (height: "no" | "unknown" | "yes") =>
      plan({
        ...neutralIntake,
        structure_types: ["prop_truss"],
        structure_over_10ft_tall: height,
      });

    expect(ruleIdsOf(propTruss("no"))).toEqual([]);
    const unknown = substantiveFindings(propTruss("unknown"));
    expect(unknown.map((finding) => finding.ruleIds)).toEqual([["DOB-PROP-TRUSS-001"]]);
    expect(unknown[0]?.disposition).toBe("may_be_required");
    expect(propTruss("unknown").verdict).toBe("CONDITIONAL");
    const yes = substantiveFindings(propTruss("yes"));
    expect(yes.map((finding) => finding.ruleIds)).toEqual([["DOB-PROP-TRUSS-001"]]);
    expect(yes[0]?.disposition).toBe("required");
  });

  it("reconciles propane and charcoal/wood fuel paths by venue", () => {
    const fuelPlan = (
      locationType: "park" | "private_venue",
      fuels: EventIntake["open_flame_or_cooking"],
    ) => plan({ ...neutralIntake, location_type: locationType, open_flame_or_cooking: fuels });
    const has = (result: PermitPlan, ruleId: string) => ruleIdsOf(result).includes(ruleId);

    const parkPropane = fuelPlan("park", ["propane_lpg"]);
    expect(has(parkPropane, "PARKS-PROPANE-001")).toBe(true);
    expect(has(parkPropane, "FDNY-FUEL-001")).toBe(false);
    expect(parkPropane.verdict).toBe("INFEASIBLE");
    expect(parkPropane.verdictDetail.rescopeSuggestions).toContainEqual(
      expect.objectContaining({
        change: { field: "open_flame_or_cooking", value: "none" },
        droppedRuleIds: ["PARKS-PROPANE-001"],
      }),
    );

    const parkCharcoal = fuelPlan("park", ["charcoal_wood"]);
    expect(has(parkCharcoal, "FDNY-FUEL-001")).toBe(true);
    expect(has(parkCharcoal, "PARKS-PROPANE-001")).toBe(false);

    const mixedPark = fuelPlan("park", ["propane_lpg", "charcoal_wood"]);
    expect(has(mixedPark, "PARKS-PROPANE-001")).toBe(true);
    expect(has(mixedPark, "FDNY-FUEL-001")).toBe(true);
    expect(
      mixedPark.findings.find((finding) => finding.ruleIds.includes("FDNY-FUEL-001"))?.name,
    ).toContain("charcoal/wood");

    const nonParkPropane = fuelPlan("private_venue", ["propane_lpg"]);
    expect(has(nonParkPropane, "FDNY-FUEL-001")).toBe(true);
    expect(has(nonParkPropane, "PARKS-PROPANE-001")).toBe(false);
  });

  const stageIntake = (heightFt: number, areaSqft: number): EventIntake => ({
    ...neutralIntake,
    structure_types: ["stage_platform_scaffold"],
    stage_height_ft: heightFt,
    stage_area_sqft: areaSqft,
    structure_over_10ft_tall: "no",
  });

  it("stage 2.0ft/120sqft and 2.5ft/119sqft stay clear; 2.5ft/120sqft triggers", () => {
    expect(ruleIdsOf(plan(stageIntake(2, 120)))).toEqual([]);
    expect(ruleIdsOf(plan(stageIntake(2.5, 119)))).toEqual([]);
    expect(ruleIdsOf(plan(stageIntake(2.5, 120)))).toEqual(["DOB-STAGE-001"]);
  });

  const generatorIntake = (overrides: EventIntake): EventIntake => ({
    ...neutralIntake,
    generator_present: true,
    generator_gasoline_gallons: 0,
    generator_diesel_gallons: 0,
    generator_kw: 0,
    ...overrides,
  });

  it("generator 2.5 gal stays clear and 2.6 gal triggers the FDNY permit", () => {
    expect(ruleIdsOf(plan(generatorIntake({ generator_gasoline_gallons: 2.5 })))).toEqual([]);
    expect(ruleIdsOf(plan(generatorIntake({ generator_gasoline_gallons: 2.6 })))).toEqual([
      "FDNY-GENERATOR-001",
    ]);
  });

  it("generator 39.9 kW stays clear and 40 kW registers with DEP (inclusive)", () => {
    expect(ruleIdsOf(plan(generatorIntake({ generator_kw: 39.9 })))).toEqual([]);
    expect(ruleIdsOf(plan(generatorIntake({ generator_kw: 40 })))).toEqual([
      "DEP-GENERATOR-REG-001",
    ]);
  });

  it("reports the FDNY permit only where the answer key lists it", () => {
    const disposition = (scenario: string) => {
      const fixture = SCENARIO_INTAKE_FIXTURES.find((entry) => entry.scenario === scenario);
      if (fixture === undefined) throw new Error(`no fixture for Scenario ${scenario}`);
      return evaluate(
        fixtureSubmission(fixture) as EventIntake,
        ruleset,
        TODAY,
        calendar,
      ).findings.find((finding) => finding.ruleIds.includes("FDNY-GENERATOR-001"))?.disposition;
    };

    for (const scenario of ["A", "B", "C", "D", "F"]) {
      expect(
        disposition(scenario),
        `Scenario ${scenario} has no generator and no battery`,
      ).toBeUndefined();
    }
    expect(disposition("E")).toBe("required");
  });

  it("battery 20 kWh stays clear and 20.1 kWh triggers", () => {
    const withBattery = { ...neutralIntake, battery_present: true };
    expect(ruleIdsOf(plan({ ...withBattery, battery_system_kwh: 20 }))).toEqual([]);
    expect(ruleIdsOf(plan({ ...withBattery, battery_system_kwh: 20.1 }))).toEqual([
      "FDNY-GENERATOR-001",
    ]);
    expect(ruleIdsOf(plan({ ...neutralIntake, battery_present: false }))).toEqual([]);
  });

  it("street_event_size unknown renders CONDITIONAL listing the published deadline ladder", () => {
    const result = plan({
      ...baseIntake,
      location_type: "street",
      obstructs_public_way: "yes",
      sapo_event_type: "street_event",
      street_event_size: "unknown",
      headcount: 100,
      event_date: "2026-12-04",
      event_open_to_public: "yes",
    });
    expect(result.verdict).toBe("CONDITIONAL");
    const ladder = result.findings
      .filter((finding) => finding.ruleIds[0]?.startsWith("SAPO-STREET-"))
      .map((finding) => [finding.ruleIds[0], finding.disposition, finding.latestApplyDate]);
    expect(ladder).toEqual([
      ["SAPO-STREET-SMALL-001", "may_be_required", "2026-11-20"],
      ["SAPO-STREET-MEDIUM-001", "may_be_required", "2026-11-04"],
      ["SAPO-STREET-LARGE-001", "may_be_required", "2026-10-20"],
      ["SAPO-STREET-XL-001", "may_be_required", "2026-10-05"],
    ]);
  });

  it("other_sapo_class emits a coverage-gap advisory that asserts nothing", () => {
    const result = plan({
      ...baseIntake,
      location_type: "street",
      obstructs_public_way: "yes",
      sapo_event_type: "other_sapo_class",
      headcount: 100,
      event_open_to_public: "yes",
    });
    const advisory = result.findings.find((finding) =>
      finding.ruleIds.includes("ADV-SAPO-OTHER-CLASS-001"),
    );
    expect(advisory?.disposition).toBe("advisory");
    expect(advisory?.verificationStatus).toBe("COVERAGE_GAP");
    expect(advisory?.agency).toBeNull();
    expect(advisory?.deadline).toBeNull();
    expect(advisory?.feeDisplay).toBeNull();
    expect(advisory?.portalUrl).toBeNull();
    expect(advisory?.sources).toEqual([]);
    expect(advisory?.name).toContain("outside this ruleset version's validated coverage");
  });

  it("obstructs_public_way=no on a sidewalk persists the classification rule as a note", () => {
    const result = plan({
      ...baseIntake,
      location_type: "sidewalk",
      obstructs_public_way: "no",
      headcount: 30,
      event_open_to_public: "yes",
    });
    const [scope] = substantiveFindings(result);
    expect(substantiveFindings(result)).toHaveLength(1);
    expect(scope?.ruleIds).toEqual(["SAPO-SCOPE-001"]);
    expect(scope?.kind).toBe("note");
    expect(scope?.disposition).toBe("no_new_requirement");
  });
});
