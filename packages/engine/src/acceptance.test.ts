// The F-201 acceptance suite: the six scenarios and every boundary fixture in
// docs/test-scenario-answer-key.md (v6), pinned to that document's clock (today = 2026-07-22)
// and evaluated against the published ruleset. Expected finding sets are exact — a rule the
// key does not list is a false addition and fails here.
//
// Two things the key does NOT pin, called out at each use:
//   * `disposition` per line (zero occurrences in the whole document). Where a rule publishes
//     one, that value is asserted as published. Where it does not, the assertion documents the
//     engine's PROPOSED default (packages/engine/src/proposals.ts §1) and is not evidence the
//     team agreed to it.
//   * the holiday list behind `us-ny-business-days@2026.1`, which is still RESEARCH_REQUIRED.
//     Fixture windows are pinned to periods the key states carry no contested holidays.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PUBLISHED_RULES_FILE } from "./__fixtures__/published-ruleset";
import { countBusinessDays, differenceInCalendarDays, evaluate, parseEngineRuleset } from "./index";
import { SCENARIO_INTAKE_FIXTURES, fixtureSubmission } from "./intake/scenario-intake-fixtures";
import type { EventIntake, Finding, PermitPlan, PublishedHolidayCalendar } from "./types";

const TODAY = "2026-07-22";

const ruleset = parseEngineRuleset(JSON.parse(readFileSync(PUBLISHED_RULES_FILE, "utf8")));

// The pinned calendar's holiday list is unresolved upstream (config.business_day_math: "the
// holiday list itself remains RESEARCH_REQUIRED"). Fixtures may not invent holidays, so the
// list stays empty and every fixture window is one the answer key states is uncontested.
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

/** Dates are compared only for the scenarios whose expectations pin them. */
const expectFindings = (findings: readonly Finding[], expected: ExpectedLine[]): void => {
  const withDates = expected.every((line) => line.latestApplyDate !== undefined);
  expect(actualLines(findings, withDates)).toEqual(expected);
};

/** Fields every scenario answers the same way; each scenario overrides what it exercises. */
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
  // The answer key describes no battery system in any scenario ("battery none" in E, no power
  // equipment in the others). Since nyc.v2.5 that is said by answering the question the registry
  // actually asks: `battery_present` is collected of every event, and `battery_system_kwh` is only
  // asked when it is true. Before, this file answered a kWh of 0 while the shared intake fixtures
  // left it unanswered, so the same six scenarios disagreed about the battery between two fixture
  // sets and only one of them saw FDNY-GENERATOR-001 (recorded against #88 on #91).
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
      // disposition PROPOSED (kind default: permit -> required)
      {
        ruleIds: ["SAPO-STREET-LARGE-001"],
        kind: "permit",
        disposition: "required",
        deadlineStatus: "published_deadline_missed",
        latestApplyDate: "2026-07-12",
      },
      // disposition PROPOSED (kind default: insurance -> required)
      {
        ruleIds: ["SAPO-INSURANCE-001"],
        kind: "insurance",
        disposition: "required",
        deadlineStatus: "not_applicable",
        latestApplyDate: null,
      },
      // disposition PROPOSED (kind default: permit -> required)
      {
        ruleIds: ["NYPD-SOUND-001"],
        kind: "permit",
        disposition: "required",
        deadlineStatus: "on_track",
        latestApplyDate: "2026-08-21",
      },
      // disposition PROPOSED (kind default: permit -> required)
      {
        ruleIds: ["DOHMH-VENDOR-PERMIT-001"],
        kind: "permit",
        disposition: "required",
        deadlineStatus: "not_calculable",
        latestApplyDate: null,
      },
      // disposition published on the rule (MAY_BE_REQUIRED)
      {
        ruleIds: ["DOHMH-ORGANIZER-NOTIFY-001"],
        kind: "notification",
        disposition: "may_be_required",
        deadlineStatus: "deadline_approaching",
        latestApplyDate: "2026-07-27",
      },
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
    // F-102 AC 7 ladder order: Medium → Small → private venue.
    expect(suggestions.map((suggestion) => suggestion.change.value)).toEqual([
      "medium",
      "small",
      "private_venue",
    ]);
    expect(suggestions).toMatchObject([
      // (a) size=medium: 30-day deadline = 2026-07-27, five days out
      {
        change: { field: "street_event_size", value: "medium" },
        reevaluatedVerdict: "FEASIBLE_AT_RISK",
        droppedRuleIds: ["SAPO-STREET-LARGE-001"],
        minSlackDays: 5,
      },
      // (b) size=small: 14-day deadline clears; the DOHMH notification is the tight one
      {
        change: { field: "street_event_size", value: "small" },
        reevaluatedVerdict: "FEASIBLE_AT_RISK",
        droppedRuleIds: ["SAPO-STREET-LARGE-001"],
      },
      // (c) private venue: SAPO permit + SAPO insurance drop. Conditional rather than at-risk
      // because moving indoors opens a question the street version never asked — whether the
      // amplified sound carries to a public way (§10-108(b)(3)) — and that decides a permit.
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
    // Non-at-risk suggestions keep the historical three-field shape (no null enrichment keys).
    expect(privateVenue !== undefined && !("minSlackDays" in privateVenue)).toBe(true);
    expect(privateVenue !== undefined && !("atRiskFindingName" in privateVenue)).toBe(true);
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
      // disposition PROPOSED (kind default: permit -> required)
      {
        ruleIds: ["DOHMH-VENDOR-PERMIT-001"],
        kind: "permit",
        disposition: "required",
        deadlineStatus: "not_calculable",
        latestApplyDate: null,
      },
      // disposition published on the rule (MAY_BE_REQUIRED)
      {
        ruleIds: ["DOHMH-ORGANIZER-NOTIFY-001"],
        kind: "notification",
        disposition: "may_be_required",
        deadlineStatus: "published_deadline_missed",
        latestApplyDate: "2026-07-13",
      },
      // disposition PROPOSED (kind default: advisory -> advisory)
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
      // disposition PROPOSED (kind default: permit -> required)
      {
        ruleIds: ["NYPD-SOUND-001"],
        kind: "permit",
        disposition: "required",
        deadlineStatus: "on_track",
        latestApplyDate: "2026-09-11",
      },
      // disposition published on the rule (MAY_BE_REQUIRED)
      {
        ruleIds: ["NYPD-SOUND-PARKS-DEP-001"],
        kind: "dependency",
        disposition: "may_be_required",
        deadlineStatus: "not_applicable",
        latestApplyDate: null,
      },
      // disposition PROPOSED (kind default: permit -> required)
      {
        ruleIds: ["PARKS-EVENT-001"],
        kind: "permit",
        disposition: "required",
        deadlineStatus: "on_track",
        latestApplyDate: "2026-08-26",
      },
      // disposition PROPOSED (kind default: note -> no_new_requirement)
      {
        ruleIds: ["PARKS-INSURANCE-NOTE-001"],
        kind: "note",
        disposition: "no_new_requirement",
        deadlineStatus: "not_applicable",
        latestApplyDate: null,
      },
    ]);
  });

  it("keeps the published in-person filing instructions on the sound permit", () => {
    // NYPD-SOUND-001 publishes no portal URL; the precinct and form number are the only
    // actionable filing detail it has.
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
    // Parks publishes 21–30 days of processing, so the earliest the sound permit can be pursued
    // is 21 days from today; its own 5-day deadline is 2026-09-11, leaving a 30-day window.
    expect(sound?.applyAfterDate).toBe("2026-08-12");
    expect(sound?.latestApplyDate).toBe("2026-09-11");
    expect(sound?.deadlineStatus).toBe("on_track");
    expect(sound?.notes.join(" ")).toContain("earliest pursuit 2026-08-12");
    expect(sound?.notes.join(" ")).toContain("21–30 day decision window");
    // The order itself is not confirmed by located primary text, so the note says so.
    expect(sound?.notes.join(" ")).toContain("not confirmed by located primary text");
  });

  it("reports gated slack as the filing window, not the distance to the deadline", () => {
    // 35-day runway. Parks processing opens the window 21 days out (2026-08-12); the sound
    // permit's own 5-day deadline is 2026-08-21. The buffer that matters is the 9 days between
    // them, not the 30 days from today, because nothing can be filed before the window opens.
    const runway35 = plan({ ...intakeC, event_date: "2026-08-26" });
    const sound = runway35.findings.find((finding) => finding.ruleIds.includes("NYPD-SOUND-001"));

    expect(sound?.applyAfterDate).toBe("2026-08-12");
    expect(sound?.latestApplyDate).toBe("2026-08-21");
    // Pin the arithmetic, not the number: slack is latest_apply − apply_after (F-102 AC 5).
    expect(sound?.slackDays).toBe(
      differenceInCalendarDays(sound?.applyAfterDate ?? "", sound?.latestApplyDate ?? ""),
    );
    expect(sound?.slackDays).toBe(9);
    // The plan's minimum slack follows it, so deadline copy and F-203 alerts inherit 9, not the
    // 14 days the Parks line has or the 30 the ungated sound figure would have claimed.
    expect(runway35.verdictDetail.minSlackDays).toBe(9);
  });

  it("warns but never fabricates a blocker when the sequence is squeezed", () => {
    // 25 days out: the Parks decision lands 2026-08-12, one day after the sound permit's own
    // 2026-08-11 deadline. A strict issued-before-filed order is unconfirmed, so this raises a
    // warning and never a missed window — but the gate is a day past the deadline, so there is no
    // date to wait for and none is published. The 35-day case above keeps its gate.
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
      // disposition PROPOSED (kind default: permit -> required)
      {
        ruleIds: ["SAPO-BLOCK-PARTY-001"],
        kind: "permit",
        disposition: "required",
        deadlineStatus: "deadline_approaching",
        latestApplyDate: "2026-08-01",
      },
      // disposition published on the rule (MAY_BE_REQUIRED)
      {
        ruleIds: ["SAPO-BLOCK-PARTY-SPONSOR-001"],
        kind: "eligibility",
        disposition: "may_be_required",
        deadlineStatus: "not_applicable",
        latestApplyDate: null,
      },
      // disposition PROPOSED (kind default: permit -> required)
      {
        ruleIds: ["NYPD-SOUND-001"],
        kind: "permit",
        disposition: "required",
        deadlineStatus: "on_track",
        latestApplyDate: "2026-09-25",
      },
      // disposition PROPOSED (kind default: permit -> required)
      {
        ruleIds: ["FDNY-FUEL-001"],
        kind: "permit",
        disposition: "required",
        deadlineStatus: "not_calculable",
        latestApplyDate: null,
      },
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
    // Eight findings, and item 8 carries both DOB rule ids — what the key has specified since v3.
    // Until nyc.v2.6 only DOB-TALL-STRUCTURE-001 published `dedupe_key: dob-structure` and
    // DOB-TENT-001 published none, so the key paired with nothing and the plan rendered two lines
    // for one DOB temporary-structure permit. v2.6 wired the missing side (#89 item 6), resolving
    // the ruleset against its own note_text rather than bending the fixture.
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
      // At exactly 400 sq ft the engine refuses to assert the trigger (proposals §4). The merged
      // line retains both contributing rule ids, so neither route to the permit is lost.
      {
        ruleIds: ["DOB-TENT-001", "DOB-TALL-STRUCTURE-001"],
        kind: "permit",
        disposition: "may_be_required",
        deadlineStatus: "on_track",
      },
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
});

describe("Scenario F — Rooftop Launch Party (conditional branches)", () => {
  const intakeF: EventIntake = {
    ...baseIntake,
    headcount: 90,
    event_date: "2026-08-11",
    event_open_to_public: "no",
    food_present: true,
    food_affinity_private_exception_claimed: "unknown",
    amplified_sound: true,
    sound_audible_from_public_way: "unknown",
    alcohol: true,
    venue_license_covers_event_area: "unknown",
    venue_has_assembly_approval: "unknown",
  };

  it("produces the expected conditional finding set", () => {
    expectFindings(plan(intakeF).findings, [
      // permit -> required by default, downgraded because the trigger came back unknown
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
    // Each branch is itself evaluated in full: the "yes" branch stays conditional because sound
    // audibility is still open inside it and decides whether a permit applies. The "no" branch is
    // infeasible on every remaining path — the SLA window is missed whatever the sound answer is —
    // so it reports the closed window rather than hiding it behind another "it depends".
    expect(licenseFact?.branches.map((branch) => [branch.value, branch.verdict])).toEqual([
      ["yes", "CONDITIONAL"],
      ["no", "INFEASIBLE"],
    ]);
    const noLicense = licenseFact?.branches.find((branch) => branch.value === "no");
    // AC 6: the closed SLA window is named even when the rule ids were already on the unresolved base.
    expect(noLicense?.reason).toContain("published deadline missed as scoped");
    expect(noLicense?.reason).not.toBe("same findings, re-dated");
    // Approved Scenario F branch table is two facts (license + sound); assembly approval is confirmation context only (#89).
    expect(result.verdictDetail.missingFacts.map((fact) => fact.field).sort()).toEqual([
      "sound_audible_from_public_way",
      "venue_license_covers_event_area",
    ]);
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

describe("Boundary and unit fixtures (AC 8)", () => {
  const parkIntake = (headcount: number): EventIntake => ({
    ...baseIntake,
    location_type: "park",
    headcount,
    event_date: "2026-09-30",
    event_open_to_public: "yes",
  });

  const ruleIdsOf = (result: PermitPlan): string[] =>
    result.findings.flatMap((finding) => finding.ruleIds);

  // A location that triggers nothing on its own, so a structure/power fixture shows only what it tests.
  const neutralIntake: EventIntake = { ...baseIntake, location_type: "park", headcount: 10 };

  it("park headcount 19 identifies no new city requirement at all", () => {
    const result = plan(parkIntake(19));
    expect(result.findings).toEqual([]);
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
    const ruleIds = ruleIdsOf(plan({ ...blockParty, selling_anything: true }));
    expect(ruleIds).toContain("SAPO-BLOCK-PARTY-001");
    const eligibility = plan({ ...blockParty, selling_anything: true }).findings.find((finding) =>
      finding.ruleIds.includes("SAPO-BLOCK-PARTY-ELIG-001"),
    );
    expect(eligibility?.disposition).toBe("prohibited_or_ineligible");
    expect(eligibility?.noteText).toContain("rescope or apply under a different SAPO class");
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
    const atBoundary = plan(tentIntake(400)).findings;
    expect(atBoundary.map((finding) => finding.ruleIds)).toEqual([["DOB-TENT-001"]]);
    expect(atBoundary[0]?.disposition).toBe("may_be_required");
    const over = plan(tentIntake(401)).findings;
    expect(over.map((finding) => finding.ruleIds)).toEqual([["DOB-TENT-001"]]);
    expect(over[0]?.disposition).toBe("required");
  });

  it("tent in place 30+ days triggers the same permit on the duration arm", () => {
    expect(ruleIdsOf(plan({ ...tentIntake(100), tent_days_in_place: 30 }))).toEqual([
      "DOB-TENT-001",
    ]);
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
    // The shared intake fixtures, not this file's own base intake — that is where the defect lived.
    // `battery_system_kwh` had no asked_when and is nullable, so it was in scope and unanswered for
    // every event, the trigger's battery disjunct evaluated unknown, and the whole any(...) with
    // it. Five scenarios with no generator at all were told a fire-department permit may be
    // required; the answer key lists FDNY-GENERATOR-001 in Scenario E only. Over-prescribing is a
    // named failure mode (F-201 AC 4).
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
    // E keeps it on gasoline alone: 5 gal > 2.5, with no battery either. The scoping fix must not
    // silence the rule where it genuinely fires.
    expect(disposition("E")).toBe("required");
  });

  it("battery 20 kWh stays clear and 20.1 kWh triggers", () => {
    const withBattery = { ...neutralIntake, battery_present: true };
    expect(ruleIdsOf(plan({ ...withBattery, battery_system_kwh: 20 }))).toEqual([]);
    expect(ruleIdsOf(plan({ ...withBattery, battery_system_kwh: 20.1 }))).toEqual([
      "FDNY-GENERATOR-001",
    ]);
    // The third case the boundary needs and could not be written before nyc.v2.5: no battery at
    // all, as distinct from a battery of zero. It was previously indistinguishable from an
    // unanswered question, which is what reported the permit as MAY_BE_REQUIRED to every organizer
    // who had no generator either.
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
    // Every published size arm stays open, each with its own date — four, not three. The key's
    // ladder line named 14/30/45 until fixtures v5 corrected it to 14/30/45/60 (#89 item 1): the
    // extra-large arm's 60 days is equally unresolved, and it is the only arm an organizer can
    // already be late for, so omitting it hid the case that matters.
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
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]?.ruleIds).toEqual(["SAPO-SCOPE-001"]);
    expect(result.findings[0]?.kind).toBe("note");
    expect(result.findings[0]?.disposition).toBe("no_new_requirement");
  });
});
