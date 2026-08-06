// Engine behaviors the scenario fixtures do not reach: determinism, dedupe merging, the
// tri-state rules, business-day arithmetic, and every way evaluation can fail loudly.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { PUBLISHED_RULES_FILE } from "./__fixtures__/published-ruleset";
import {
  addCalendarDays,
  countBusinessDays,
  differenceInCalendarDays,
  evaluate,
  parseEngineRuleset,
  subtractBusinessDays,
  triggerFields,
  EvaluationError,
} from "./index";
import type { EventIntake, HolidayCalendar, PermitPlan, PublishedHolidayCalendar } from "./types";

const TODAY = "2026-07-22";
const rawRuleset: Record<string, unknown> = JSON.parse(readFileSync(PUBLISHED_RULES_FILE, "utf8"));
const ruleset = parseEngineRuleset(rawRuleset);
const calendar: PublishedHolidayCalendar = { id: ruleset.calendarId, holidays: [] };

const parkIntake: EventIntake = {
  borough: "brooklyn",
  location_type: "park",
  headcount: 150,
  event_date: "2026-09-16",
  event_open_to_public: "yes",
  food_present: false,
  selling_anything: false,
  amplified_sound: true,
  structure_types: ["none"],
  open_flame_or_cooking: ["none"],
  generator_present: false,
  battery_present: false,
  battery_system_kwh: 0,
  alcohol: false,
};

/** A two-rule ruleset in the published shape, for behaviors the current publication does not exercise. */
function syntheticRuleset(
  rules: unknown[],
  extraFields: unknown[] = [],
): ReturnType<typeof parseEngineRuleset> {
  return parseEngineRuleset({
    ruleset_version: "test.v1",
    jurisdiction: "US-NY-NYC",
    snapshot_date: "2026-07-22",
    config: {
      slack_warning_days: { value: 14 },
      business_day_math: { calendar: "test-calendar@2026" },
    },
    // Only fields the rules below consume: the loader refuses a declared field nothing reads.
    intake_fields: [
      { field: "event_date", type: "date" },
      { field: "headcount", type: "integer" },
      ...extraFields,
    ],
    rules,
    advisories: [],
  });
}

const dedupeRule = (id: string, citation: string, lastVerifiedDate?: string) => ({
  id,
  kind: "permit",
  trigger: { all: [{ field: "headcount", op: "gte", value: 10 }] },
  output: { permit_name: `${id} permit`, agency: "DOB", dedupe_key: "dob-structure" },
  verification: {
    status: "SOURCE_CONFIRMED",
    ...(lastVerifiedDate === undefined ? {} : { last_verified_date: lastVerifiedDate }),
  },
  source: { citation, urls: [`https://example.test/${id}`] },
});

describe("determinism (AC 3)", () => {
  it("produces a byte-identical plan for the same revision, ruleset, today, and calendar", () => {
    const first = JSON.stringify(evaluate(parkIntake, ruleset, TODAY, calendar));
    const second = JSON.stringify(evaluate(parkIntake, ruleset, TODAY, calendar));
    expect(first).toBe(second);
  });

  it("is insensitive to the order the intake keys arrive in", () => {
    const reordered = Object.fromEntries(Object.entries(parkIntake).reverse()) as EventIntake;
    expect(JSON.stringify(evaluate(reordered, ruleset, TODAY, calendar))).toBe(
      JSON.stringify(evaluate(parkIntake, ruleset, TODAY, calendar)),
    );
  });

  it("moves with `today`, which is a parameter and never the system clock", () => {
    // Same intake, same ruleset: only the clock moved, past the Parks 21-day floor.
    const later = evaluate(parkIntake, ruleset, "2026-09-01", calendar);
    expect(later.today).toBe("2026-09-01");
    expect(later.verdict).toBe("INFEASIBLE");
    expect(evaluate(parkIntake, ruleset, TODAY, calendar).verdict).toBe("FEASIBLE");
  });
});

describe("provenance (AC 1)", () => {
  it("records the intake answers that triggered each finding", () => {
    const sound = evaluate(parkIntake, ruleset, TODAY, calendar).findings.find((finding) =>
      finding.ruleIds.includes("NYPD-SOUND-001"),
    );
    expect(sound?.triggeredBy).toEqual([
      { field: "amplified_sound", value: true },
      { field: "location_type", value: "park" },
    ]);
  });

  it("attaches a tri-state trace for every published rule", () => {
    const plan = evaluate(parkIntake, ruleset, TODAY, calendar);
    expect(plan.verdictDetail.trace).toHaveLength(ruleset.rules.length);
    expect(
      plan.verdictDetail.trace.find((entry) => entry.ruleId === "PARKS-EVENT-001")?.result,
    ).toBe("true");
    expect(plan.verdictDetail.trace.find((entry) => entry.ruleId === "PARKS-TUA-001")?.result).toBe(
      "false",
    );
  });

  it("merges findings that share a dedupe key, retaining every rule id and source", () => {
    const merged = evaluate(
      { event_date: "2026-12-04", headcount: 50, structure_types: ["none"] },
      syntheticRuleset([dedupeRule("RULE-A", "citation A"), dedupeRule("RULE-B", "citation B")]),
      TODAY,
      { id: "test-calendar@2026", holidays: [] },
    );
    expect(merged.findings).toHaveLength(1);
    expect(merged.findings[0]?.ruleIds).toEqual(["RULE-A", "RULE-B"]);
    expect(merged.findings[0]?.sources.map((source) => source.citation)).toEqual([
      "citation A",
      "citation B",
    ]);
    expect("userSummary" in (merged.findings[0] as object)).toBe(false);
  });

  it("keeps the earliest verification date only when every merged rule publishes one", () => {
    const dated = evaluate(
      { event_date: "2026-12-04", headcount: 50 },
      syntheticRuleset([
        dedupeRule("RULE-A", "citation A", "2026-07-20"),
        dedupeRule("RULE-B", "citation B", "2026-07-18"),
      ]),
      TODAY,
      { id: "test-calendar@2026", holidays: [] },
    );
    expect(dated.findings[0]?.lastVerifiedDate).toBe("2026-07-18");

    const incomplete = evaluate(
      { event_date: "2026-12-04", headcount: 50 },
      syntheticRuleset([
        dedupeRule("RULE-A", "citation A", "2026-07-20"),
        dedupeRule("RULE-B", "citation B"),
      ]),
      TODAY,
      { id: "test-calendar@2026", holidays: [] },
    );
    expect(incomplete.findings[0]?.lastVerifiedDate).toBeNull();
  });

  it("rejects mixed verification statuses within one dedupe group", () => {
    expect(() =>
      syntheticRuleset([
        dedupeRule("RULE-A", "citation A"),
        {
          ...dedupeRule("RULE-B", "citation B"),
          verification: { status: "RESEARCH_REQUIRED" },
        },
      ]),
    ).toThrow(
      /dedupe key "dob-structure" mixes verification statuses "SOURCE_CONFIRMED" and "RESEARCH_REQUIRED"/,
    );
  });
});

/**
 * #239. `dedupeRule` above publishes one disposition and no deadline, so the suite never asked what
 * a merged finding says when two contributing rules disagree. It said whatever the ruleset listed
 * first: nyc.v2.11's `dob-structure` group mixes disposition (DOB-TENT-001 takes the permit-kind
 * default `required`, DOB-TALL-STRUCTURE-001 publishes MAY_BE_REQUIRED) and deadline (15 business
 * days vs none), so reversing the two rules in the published file, with no regulatory fact
 * changing, turned a dated `required` line into an undated `may_be_required` one.
 *
 * These build the group both ways round and assert the merged finding, not the merge helper.
 */
const disposedRule = (
  id: string,
  disposition: string | undefined,
  deadline?: Record<string, unknown>,
  extraOutput: Record<string, unknown> = {},
): Record<string, unknown> => {
  const base = dedupeRule(id, `citation ${id}`);
  return {
    ...base,
    output: {
      ...base.output,
      ...(disposition === undefined ? {} : { disposition }),
      ...(deadline === undefined ? {} : { deadline }),
      ...extraOutput,
    },
  };
};

/** A published filing window that many calendar days before the event. */
const calendarWindow = (days: number) => ({ type: "published_minimum", calendar_days: days });

/** A published filing window that needs the holiday list the deployment has not published. */
const businessWindow = (days: number) => ({ type: "business_days_minimum", business_days: days });

/** The merged `dob-structure` finding for a group listed in the given order. */
const mergedGroup = (
  rules: Record<string, unknown>[],
  options: {
    intake?: Record<string, unknown>;
    holidays?: readonly string[] | null;
    extraFields?: unknown[];
  } = {},
) => {
  const plan = evaluate(
    { event_date: "2026-12-04", headcount: 50, ...options.intake } as unknown as EventIntake,
    syntheticRuleset(rules, options.extraFields),
    TODAY,
    { id: "test-calendar@2026", holidays: options.holidays === undefined ? [] : options.holidays },
  );
  expect(plan.findings).toHaveLength(1);
  return plan.findings[0];
};

/** Every scalar the merge decides, as opposed to the lists it concatenates. */
const decidedFields = (finding: ReturnType<typeof mergedGroup>) => ({
  disposition: finding?.disposition,
  kind: finding?.kind,
  name: finding?.name,
  agency: finding?.agency,
  deadline: finding?.deadline,
  deadlineDisplay: finding?.deadlineDisplay,
  latestApplyDate: finding?.latestApplyDate,
  deadlineStatus: finding?.deadlineStatus,
  slackDays: finding?.slackDays,
  feeDisplay: finding?.feeDisplay,
  portalName: finding?.portalName,
  portalUrl: finding?.portalUrl,
  portalInstructions: finding?.portalInstructions,
  noteText: finding?.noteText,
  conflictText: finding?.conflictText,
  timelineUnresolvedReason: finding?.timelineUnresolvedReason,
  verificationStatus: finding?.verificationStatus,
  summaryHeading: finding?.userSummary?.heading ?? null,
});

describe("dedupe field merge (#239)", () => {
  it("takes the strongest contributing disposition, whichever rule is listed first", () => {
    const forward = mergedGroup([
      disposedRule("RULE-A", "MAY_BE_REQUIRED"),
      disposedRule("RULE-B", "REQUIRED"),
    ]);
    const reverse = mergedGroup([
      disposedRule("RULE-B", "REQUIRED"),
      disposedRule("RULE-A", "MAY_BE_REQUIRED"),
    ]);
    expect(forward?.disposition).toBe("required");
    expect(reverse?.disposition).toBe("required");
  });

  it("never lets a permit finding erase a blocking one on the same key", () => {
    // ARCHITECTURE-FUTURE §8.4. The blocking value outranks `required` in both listings.
    expect(
      mergedGroup([
        disposedRule("RULE-A", "REQUIRED"),
        disposedRule("RULE-B", "PROHIBITED_OR_INELIGIBLE"),
      ])?.disposition,
    ).toBe("prohibited_or_ineligible");
    expect(
      mergedGroup([
        disposedRule("RULE-B", "PROHIBITED_OR_INELIGIBLE"),
        disposedRule("RULE-A", "REQUIRED"),
      ])?.disposition,
    ).toBe("prohibited_or_ineligible");
  });

  it("does not let a blocker whose own trigger is unknown make the merged line a blocker", () => {
    // ARCHITECTURE-FUTURE §8.4: a candidate requirement produced by an unknown branch stays
    // conditional and is not promoted by deduplication. The blocking route is still named in
    // `ruleIds`, its note is still carried, and the unanswered field is still asked.
    const unknownBlocker = {
      ...disposedRule("RULE-B", "PROHIBITED_OR_INELIGIBLE"),
      trigger: { all: [{ field: "structure_height_ft", op: "gte", value: 10 }] },
    };
    const group = [disposedRule("RULE-A", "REQUIRED"), unknownBlocker];
    const options = {
      intake: { structure_height_ft: null },
      extraFields: [{ field: "structure_height_ft", type: "integer" }],
    };
    // The definite permit route still decides the line; the conditional blocker does not.
    expect(mergedGroup(group, options)?.disposition).toBe("required");
    expect(mergedGroup([...group].reverse(), options)?.disposition).toBe("required");
    expect(mergedGroup(group, options)?.ruleIds).toContain("RULE-B");
  });

  it("keeps everything but the headline disposition when the blocker's trigger is unknown", () => {
    // Where ARCHITECTURE-FUTURE §8.4's two guarantees collide, the one about not promoting an
    // unknown branch wins: promoting the blocker would tell an organizer their event is ineligible
    // on the strength of a question they never answered. This pins what that costs and what it
    // does not, so the exception is a decision rather than an accident.
    const rules = [
      disposedRule("RULE-A", "REQUIRED", calendarWindow(45), { permit_name: "permit route" }),
      {
        ...disposedRule("RULE-B", "PROHIBITED_OR_INELIGIBLE", undefined, {
          permit_name: "barred route",
          note_text: "not eligible above ten feet",
        }),
        trigger: { all: [{ field: "structure_height_ft", op: "gte", value: 10 }] },
      },
    ];
    const plan = evaluate(
      {
        event_date: "2026-12-04",
        headcount: 50,
        structure_height_ft: null,
      } as unknown as EventIntake,
      syntheticRuleset(rules, [{ field: "structure_height_ft", type: "integer" }]),
      TODAY,
      { id: "test-calendar@2026", holidays: [] },
    );
    const merged = plan.findings[0];
    // What does not survive: the merged line reads as the permit route it can actually name.
    expect(merged?.disposition).toBe("required");
    expect(merged?.name).toBe("permit route");
    // What survives: the blocking route, its citation, its published note text, and the
    // unanswered field as a material unknown that keeps the whole plan conditional.
    expect(merged?.ruleIds).toContain("RULE-B");
    expect(merged?.sources.map((source) => source.ruleId)).toContain("RULE-B");
    expect(merged?.triggeredBy.map((reason) => reason.field)).toContain("structure_height_ft");
    expect(merged?.noteText).toBe("not eligible above ten feet");
    expect(plan.verdictDetail.missingFacts.map((fact) => fact.field)).toContain(
      "structure_height_ft",
    );
    expect(plan.verdict).toBe("CONDITIONAL");
  });

  it("reads every displayed scalar off the contributor that supplied the disposition", () => {
    // No hybrid line: a blocked requirement must not carry a permit's apply-by date, fee or portal.
    const blocked = mergedGroup([
      disposedRule("RULE-A", "REQUIRED", calendarWindow(45), {
        permit_name: "permit route",
        fee: { display: "$100" },
        portal: { name: "permit portal", url: "https://example.test/permit" },
      }),
      disposedRule("RULE-B", "PROHIBITED_OR_INELIGIBLE", undefined, {
        permit_name: "barred route",
        note_text: "not eligible at this location",
      }),
    ]);
    expect(blocked).toMatchObject({
      disposition: "prohibited_or_ineligible",
      name: "barred route",
      latestApplyDate: null,
      deadline: null,
      feeDisplay: null,
      portalName: null,
      portalUrl: null,
      noteText: "not eligible at this location",
    });
  });

  it("takes the earlier published filing window, whichever rule is listed first", () => {
    // 45 days back from 2026-12-04 is the earlier window; taking the later one would tell an
    // organizer they have three more weeks than the group's own rules publish.
    const forward = mergedGroup([
      disposedRule("RULE-A", "REQUIRED", calendarWindow(21)),
      disposedRule("RULE-B", "REQUIRED", calendarWindow(45)),
    ]);
    const reverse = mergedGroup([
      disposedRule("RULE-B", "REQUIRED", calendarWindow(45)),
      disposedRule("RULE-A", "REQUIRED", calendarWindow(21)),
    ]);
    expect(forward?.latestApplyDate).toBe("2026-10-20");
    expect(reverse?.latestApplyDate).toBe("2026-10-20");
  });

  it("binds to the earliest window that is still open, not to one that has closed", () => {
    // Two published routes to one requirement: the 45-day window closed on 2026-07-06, the
    // 21-day one is open until 2026-07-30. Binding the closed one renders the requirement missed
    // while a published route is still available.
    const group = [
      disposedRule("RULE-A", "REQUIRED", calendarWindow(45)),
      disposedRule("RULE-B", "REQUIRED", calendarWindow(21)),
    ];
    const options = { intake: { event_date: "2026-08-20" } };
    for (const listing of [group, [...group].reverse()]) {
      expect(mergedGroup(listing, options)).toMatchObject({
        latestApplyDate: "2026-07-30",
        deadlineStatus: "deadline_approaching",
      });
    }
  });

  it("binds to the earliest window when every published route has closed", () => {
    const group = [
      disposedRule("RULE-A", "REQUIRED", calendarWindow(45)),
      disposedRule("RULE-B", "REQUIRED", calendarWindow(21)),
    ];
    const options = { intake: { event_date: "2026-08-01" } };
    for (const listing of [group, [...group].reverse()]) {
      expect(mergedGroup(listing, options)).toMatchObject({
        latestApplyDate: "2026-06-17",
        deadlineStatus: "published_deadline_missed",
      });
    }
  });

  it("keeps a published window that cannot be dated over a route that publishes none", () => {
    // The deployed shape of the defect: an uncalculable window and no window at all both leave
    // `latestApplyDate` null, and the group must still read as the rule that publishes a window.
    const group = [
      disposedRule("RULE-A", "MAY_BE_REQUIRED", undefined, { permit_name: "undated route" }),
      disposedRule("RULE-B", "MAY_BE_REQUIRED", businessWindow(15), {
        permit_name: "dated route",
      }),
    ];
    const options = { holidays: null };
    for (const listing of [group, [...group].reverse()]) {
      expect(mergedGroup(listing, options)).toMatchObject({
        name: "dated route",
        deadlineStatus: "not_calculable",
        latestApplyDate: null,
      });
    }
  });

  it("keeps a dated window over a route whose window the engine could not date", () => {
    // The other half of the same ordering, and the one the deployed calendar reaches: with no
    // published holiday list the 15-business-day route is real but `not_calculable`, and binding
    // it would throw away a computed apply-by date, a permit name, a fee and a portal for a route
    // that says nothing about when to file (#244 review).
    const group = [
      disposedRule("RULE-A", "REQUIRED", businessWindow(15), {
        permit_name: "undatable route",
        fee: { display: "$500" },
      }),
      disposedRule("RULE-B", "REQUIRED", calendarWindow(45), {
        permit_name: "datable route",
        fee: { display: "$100" },
      }),
    ];
    const options = { holidays: null };
    for (const listing of [group, [...group].reverse()]) {
      expect(mergedGroup(listing, options)).toMatchObject({
        name: "datable route",
        latestApplyDate: "2026-10-20",
        deadlineStatus: "on_track",
        feeDisplay: "$100",
      });
    }
  });

  it("keeps a dated rule's window when the other member of the group publishes none", () => {
    const forward = mergedGroup([
      disposedRule("RULE-A", "REQUIRED", calendarWindow(45)),
      disposedRule("RULE-B", "MAY_BE_REQUIRED"),
    ]);
    const reverse = mergedGroup([
      disposedRule("RULE-B", "MAY_BE_REQUIRED"),
      disposedRule("RULE-A", "REQUIRED", calendarWindow(45)),
    ]);
    expect(forward).toMatchObject({ latestApplyDate: "2026-10-20", deadlineStatus: "on_track" });
    expect(reverse).toMatchObject({ latestApplyDate: "2026-10-20", deadlineStatus: "on_track" });
  });

  it("reads note, conflict and timeline text off the binding rule rather than the file order", () => {
    // These three were resolved by position in the ruleset, which is the defect itself.
    const group = [
      disposedRule("RULE-A", "MAY_BE_REQUIRED", undefined, { note_text: "undated reading" }),
      disposedRule("RULE-B", "MAY_BE_REQUIRED", businessWindow(15), {
        note_text: "dated reading",
      }),
    ].map((rule) => ({ ...rule, verification: { status: "OFFICIAL_CONFLICT" } }));
    const options = { holidays: null };
    for (const listing of [group, [...group].reverse()]) {
      expect(mergedGroup(listing, options)).toMatchObject({
        noteText: "dated reading",
        conflictText: "dated reading",
        timelineUnresolvedReason: expect.stringContaining("15 business days"),
      });
    }
  });

  it("renders the same merged finding whichever order the ruleset lists the group in", () => {
    // The property the defect is. Rule ids, notes and sources stay in contributing order — the
    // approved contract is that a merged finding retains every contributing rule — so this pins
    // everything the merge decides rather than concatenates.
    const rules = [
      disposedRule("RULE-A", "MAY_BE_REQUIRED", undefined, {
        permit_name: "undated route",
        note_text: "undated reading",
        fee: { display: "$25" },
        portal: { name: "undated portal", instructions: "walk in" },
        user_summary: {
          heading: "undated heading",
          points: [
            {
              kind: "overview",
              text: "undated route",
              sources: [{ label: "citation", url: "https://example.test/RULE-A" }],
            },
          ],
        },
      }),
      disposedRule("RULE-B", "REQUIRED", calendarWindow(45), {
        permit_name: "dated route",
        note_text: "dated reading",
        fee: { display: "$100" },
        portal: { name: "dated portal", url: "https://example.test/dated" },
        user_summary: {
          heading: "dated heading",
          points: [
            {
              kind: "overview",
              text: "dated route",
              sources: [{ label: "citation", url: "https://example.test/RULE-B" }],
            },
          ],
        },
      }),
    ];
    expect(decidedFields(mergedGroup(rules))).toEqual(
      decidedFields(mergedGroup([...rules].reverse())),
    );
  });

  it("merges the published dob-structure group against the deployed holiday configuration", () => {
    // `apps/api/src/calendar.ts` publishes no holiday list, so production evaluates with
    // `holidays: null` and DOB-TENT-001's 15-business-day window is real but not calculable,
    // while DOB-TALL-STRUCTURE-001 publishes no window at all. Both leave `latestApplyDate`
    // null, so the group's binding rule cannot be chosen on that field alone. Every other engine
    // test injects `holidays: []`, which dates DOB-TENT-001 and hides this entirely.
    const tentIntake: EventIntake = {
      ...parkIntake,
      event_date: "2026-12-04",
      structure_types: ["tent_canopy"],
      tent_area_sqft: 500,
      tent_days_in_place: 2,
      structure_over_10ft_tall: "yes",
    };
    const merged = (holidays: readonly string[] | null) =>
      evaluate(tentIntake, ruleset, TODAY, { id: ruleset.calendarId, holidays }).findings.find(
        (finding) => finding.ruleIds.includes("DOB-TENT-001"),
      );

    const deployed = merged(null);
    expect(deployed?.ruleIds).toEqual(["DOB-TENT-001", "DOB-TALL-STRUCTURE-001"]);
    expect(deployed).toMatchObject({
      disposition: "required",
      name: "DOB permit — tent/canopy over 400 gross sq ft or in place 30+ days",
      deadlineStatus: "not_calculable",
      latestApplyDate: null,
      feeDisplay: "TUP: $100 initial 30 days, $130 per additional period — confirm instrument",
    });
    expect(deployed?.userSummary?.heading).toBe(
      "Buildings Department approval for a tent or canopy",
    );
    expect(deployed?.timelineUnresolvedReason).toContain("15 business days");
    // DOB-TENT-001 publishes no `note_text`, so the other route's published note is not dropped.
    expect(deployed?.noteText).toContain("over 10 feet tall require a permit");

    // The same group, same rules, with the holiday list a published calendar would carry.
    expect(merged([])).toMatchObject({
      disposition: "required",
      name: "DOB permit — tent/canopy over 400 gross sq ft or in place 30+ days",
      deadlineStatus: "on_track",
      latestApplyDate: "2026-11-13",
    });
  });
});

describe("verification treatments", () => {
  it("leaves RESEARCH_REQUIRED confirmation to the renderer instead of duplicating it in notes", () => {
    const plan = evaluate(
      { event_date: "2026-12-04", headcount: 50 },
      syntheticRuleset([
        {
          id: "RESEARCH-001",
          kind: "permit",
          trigger: { all: [{ field: "headcount", op: "gte", value: 10 }] },
          output: {
            permit_name: "Research permit",
            agency: "DOB",
            notes: ["Published note."],
          },
          verification: { status: "RESEARCH_REQUIRED" },
        },
      ]),
      TODAY,
      { id: "test-calendar@2026", holidays: [] },
    );

    expect(plan.findings[0]).toMatchObject({
      verificationStatus: "RESEARCH_REQUIRED",
      notes: ["Published note."],
    });
  });
});

describe("tri-state evaluation", () => {
  const structureIntake: EventIntake = {
    ...parkIntake,
    structure_types: ["tent_canopy"],
    tent_days_in_place: 1,
    structure_over_10ft_tall: "no",
  };

  it("treats an unanswered numeric on a selected structure as unknown, not false", () => {
    const tent = evaluate(
      { ...structureIntake, tent_area_sqft: null },
      ruleset,
      TODAY,
      calendar,
    ).findings.find((finding) => finding.ruleIds.includes("DOB-TENT-001"));
    expect(tent?.disposition).toBe("may_be_required");
  });

  it("does not make a field the registry never asked into a material unknown", () => {
    // tent_area_sqft is asked only when a tent is selected; with no tent it stays silent.
    const plan = evaluate({ ...parkIntake, tent_area_sqft: null }, ruleset, TODAY, calendar);
    expect(plan.findings.flatMap((finding) => finding.ruleIds)).not.toContain("DOB-TENT-001");
    expect(plan.verdict).toBe("FEASIBLE");
  });

  it("treats `unknown` as an answer for a rule that lists it among accepted values", () => {
    const plan = evaluate(
      {
        ...parkIntake,
        location_type: "private_venue",
        headcount: 40,
        amplified_sound: true,
        sound_audible_from_public_way: "unknown",
      },
      ruleset,
      TODAY,
      calendar,
    );
    const noiseAdvisory = plan.findings.find((finding) =>
      finding.ruleIds.includes("ADV-NOISE-CODE-001"),
    );
    expect(noiseAdvisory?.disposition).toBe("advisory");
  });

  it("records only the answers that decided a settled `any` trigger", () => {
    // FDNY-GENERATOR-001 is any(gasoline > 2.5, diesel > 10, battery > 20). Gasoline alone
    // settles it; the unanswered diesel amount did not trigger anything and must not be
    // recorded as if it had (AC 1).
    const plan = evaluate(
      {
        ...parkIntake,
        generator_present: true,
        generator_gasoline_gallons: 5,
        generator_diesel_gallons: null,
        generator_kw: 0,
      },
      ruleset,
      TODAY,
      calendar,
    );
    const generator = plan.findings.find((finding) =>
      finding.ruleIds.includes("FDNY-GENERATOR-001"),
    );
    expect(generator?.triggeredBy).toEqual([{ field: "generator_gasoline_gallons", value: 5 }]);
  });

  it("keeps every contribution when an `any` trigger is not settled", () => {
    // No decisive child: gasoline is under the threshold and diesel is unanswered, so the finding
    // is conditional and both answers are part of why.
    const plan = evaluate(
      {
        ...parkIntake,
        generator_present: true,
        generator_gasoline_gallons: 1,
        generator_diesel_gallons: null,
        generator_kw: 0,
      },
      ruleset,
      TODAY,
      calendar,
    );
    const generator = plan.findings.find((finding) =>
      finding.ruleIds.includes("FDNY-GENERATOR-001"),
    );
    expect(generator?.disposition).toBe("may_be_required");
    expect(generator?.triggeredBy).toEqual([{ field: "generator_diesel_gallons", value: null }]);
  });

  it("reads the ruleset's trigger fields for provenance tooling", () => {
    const rule = ruleset.rules.find((entry) => entry.id === "NYPD-SOUND-001");
    expect(triggerFields(rule?.trigger ?? { all: [] })).toEqual([
      "amplified_sound",
      "location_type",
      "amplified_sound",
      "location_type",
      "sound_audible_from_public_way",
    ]);
  });
});

describe("typed deadlines", () => {
  it("renders the Parks processing band as at-risk once the runway is shorter than processing", () => {
    // 25 days out: the 21-day hard floor still clears, but 21–30 days of processing may not.
    const plan = evaluate({ ...parkIntake, event_date: "2026-08-16" }, ruleset, TODAY, calendar);
    const parks = plan.findings.find((finding) => finding.ruleIds.includes("PARKS-EVENT-001"));
    expect(parks?.deadlineStatus).toBe("deadline_approaching");
    expect(plan.verdict).toBe("FEASIBLE_AT_RISK");
  });

  it("keeps the Parks floor day itself inside the window", () => {
    // 2026-08-12 is exactly 21 days from the fixture clock, and PARKS-EVENT-001 publishes "apply
    // at least 21 days ahead (applications inside 21 days are not accepted)" — so the floor day is
    // the last valid filing day, with zero slack, not a miss. This test previously asserted the
    // opposite, citing an F-102 sentence that has since been corrected against the published rule.
    const plan = evaluate({ ...parkIntake, event_date: "2026-08-12" }, ruleset, TODAY, calendar);
    const parks = plan.findings.find((finding) => finding.ruleIds.includes("PARKS-EVENT-001"));
    expect(parks?.latestApplyDate).toBe(TODAY);
    expect(parks?.slackDays).toBe(0);
    expect(parks?.deadlineStatus).not.toBe("published_deadline_missed");
    expect(plan.verdict).not.toBe("INFEASIBLE");
  });

  it("publishes no negative countdown when the sequence closes the window", () => {
    // The exact case making the floor day feasible exposed: parkIntake has amplified sound, so
    // once Parks is no longer missed the NYPD pursuit is gated on a decision expected 2026-08-12
    // while its own deadline is 2026-08-07. That window closed before it opened, which is not a
    // countdown — and because the sequence is unconfirmed it is not a miss either, since filing
    // directly is still possible. Reporting -5 would put "apply within -5 days" into deadline copy
    // and F-203's alerts.
    const plan = evaluate({ ...parkIntake, event_date: "2026-08-12" }, ruleset, TODAY, calendar);
    const sound = plan.findings.find((finding) => finding.ruleIds.includes("NYPD-SOUND-001"));

    // No actionable gate: F-202 would render 2026-08-12 as the start date and F-203 would fire
    // `dependency_unlocked` there, five days after this permit's own deadline. The date stays in
    // the note, where it explains the conflict instead of scheduling work.
    expect(sound?.applyAfterDate).toBeNull();
    expect(sound?.notes.join(" ")).toContain("2026-08-12");
    expect(sound?.latestApplyDate).toBe("2026-08-07");
    expect(sound?.slackDays).toBeNull();
    expect(sound?.deadlineStatus).not.toBe("published_deadline_missed");
    expect(sound?.notes.join(" ")).toContain("leaves no window to file in");
    expect(sound?.notes.join(" ")).not.toContain("-5");

    // Nothing negative reaches the plan-level figure that copy and alerts read.
    expect(plan.verdictDetail.minSlackDays).toBe(0);
    expect(
      plan.findings.every((finding) => finding.slackDays === null || finding.slackDays >= 0),
      "no finding publishes a negative countdown",
    ).toBe(true);
  });

  it("does not call direct filing open once the gated permit's own deadline has passed", () => {
    // Four days out: NYPD-SOUND-001 publishes five days, so its window is already closed and the
    // gated window is negative too. The closed-sequence note is still right that the order is
    // unconfirmed, but "filing directly may still be open" would contradict the rule's own
    // deadline — the same overclaim class as the "not before" wording on #93.
    const plan = evaluate({ ...parkIntake, event_date: "2026-07-26" }, ruleset, TODAY, calendar);
    const sound = plan.findings.find((finding) => finding.ruleIds.includes("NYPD-SOUND-001"));
    const notes = sound?.notes.join(" ") ?? "";

    expect(sound?.deadlineStatus).toBe("published_deadline_missed");
    expect(notes).toContain("leaves no window to file in");
    expect(notes).not.toContain("filing directly may still be open");
    expect(notes).toContain("confirm the order with the agency");
    // The caveat is right in the neighbouring case, so its absence here is a condition rather
    // than a deletion.
    const stillOpen = evaluate(
      { ...parkIntake, event_date: "2026-08-12" },
      ruleset,
      TODAY,
      calendar,
    ).findings.find((finding) => finding.ruleIds.includes("NYPD-SOUND-001"));
    expect(stillOpen?.notes.join(" ")).toContain("filing directly may still be open");
  });

  it("treats the first day past the Parks floor as on track", () => {
    // 2026-08-13 is 22 days out: the immediate above-boundary case CONTRIBUTING.md:63 requires,
    // completing 20 / 21 / 22. An off-by-one that only shifted the first day past the floor would
    // pass the other two.
    const plan = evaluate({ ...parkIntake, event_date: "2026-08-13" }, ruleset, TODAY, calendar);
    const parks = plan.findings.find((finding) => finding.ruleIds.includes("PARKS-EVENT-001"));
    expect(parks?.latestApplyDate).toBe("2026-07-23");
    expect(parks?.slackDays).toBe(1);
    expect(parks?.deadlineStatus).not.toBe("published_deadline_missed");
    expect(plan.verdict).not.toBe("INFEASIBLE");
  });

  it("treats the day inside the Parks floor as missed", () => {
    // 2026-08-11 is 20 days out: inside the floor, which the rule says is not accepted. Pinning
    // both sides keeps the cliff located rather than only pinning where it is not.
    const plan = evaluate({ ...parkIntake, event_date: "2026-08-11" }, ruleset, TODAY, calendar);
    const parks = plan.findings.find((finding) => finding.ruleIds.includes("PARKS-EVENT-001"));
    expect(parks?.latestApplyDate).toBe("2026-07-21");
    expect(parks?.deadlineStatus).toBe("published_deadline_missed");
    expect(plan.verdict).toBe("INFEASIBLE");
  });

  const unknownLevelPlaza: EventIntake = {
    ...parkIntake,
    location_type: "plaza",
    obstructs_public_way: "yes",
    sapo_event_type: "plaza_event",
    plaza_level: "unknown",
    plaza_multiple_blocks: false,
    amplified_sound: false,
  };

  it("lists the published plaza range instead of guessing when the level is unknown", () => {
    const plan = evaluate(unknownLevelPlaza, ruleset, TODAY, calendar);
    const plaza = plan.findings.find((finding) => finding.ruleIds.includes("SAPO-PLAZA-001"));
    expect(plaza?.latestApplyDate).toBeNull();
    expect(plaza?.deadlineStatus).toBe("not_calculable");
    expect(plaza?.deadlineDisplay).toBe("14–60 days depending on level; confirm with agency");
  });

  it("makes an unknown plaza level conditional, as SAPO-PLAZA-001 publishes", () => {
    // The rule's own deadline block says `unknown_level_behavior: "CONDITIONAL listing 14–60
    // range"`. SAPO-PLAZA-001 triggers on sapo_event_type alone, so the level only reaches the
    // verdict because deadline resolution reports it as a material unknown.
    const plan = evaluate(unknownLevelPlaza, ruleset, TODAY, calendar);
    expect(plan.verdict).toBe("CONDITIONAL");
    const levelFact = plan.verdictDetail.missingFacts.find((fact) => fact.field === "plaza_level");
    expect(levelFact?.branches.map((branch) => branch.value)).toEqual(["a", "b", "c", "d"]);
  });

  it("keeps an unknown level conditional even when every branch clears its window", () => {
    // Far-future event: each branch verdict is FEASIBLE, and only the timeline differs. The
    // engine must still refuse to call it feasible, because which window applies is unknown.
    const plan = evaluate(
      { ...unknownLevelPlaza, event_date: "2027-06-01" },
      ruleset,
      TODAY,
      calendar,
    );
    const levelFact = plan.verdictDetail.missingFacts.find((fact) => fact.field === "plaza_level");
    expect(levelFact?.branches.map((branch) => branch.verdict)).toEqual([
      "FEASIBLE",
      "FEASIBLE",
      "FEASIBLE",
      "FEASIBLE",
    ]);
    expect(plan.verdict).toBe("CONDITIONAL");
  });

  it("reports an unknown level as missed rather than on track when every window has closed", () => {
    // Nine days out: even the shortest published level window (14 days) is already gone, so no
    // answer to the level question reopens it. Calling that conditional would understate a closed
    // window; the finding still renders undated with the published range.
    const plan = evaluate(
      { ...unknownLevelPlaza, event_date: "2026-07-31" },
      ruleset,
      TODAY,
      calendar,
    );
    const levelFact = plan.verdictDetail.missingFacts.find((fact) => fact.field === "plaza_level");
    expect(levelFact?.branches.every((branch) => branch.verdict === "INFEASIBLE")).toBe(true);
    expect(plan.verdict).toBe("INFEASIBLE");
    expect(plan.findings.find((f) => f.ruleIds.includes("SAPO-PLAZA-001"))?.deadlineStatus).toBe(
      "not_calculable",
    );
  });

  it("uses the multi-block variant of a level deadline when the event spans blocks", () => {
    const plan = evaluate(
      {
        ...parkIntake,
        location_type: "plaza",
        obstructs_public_way: "yes",
        sapo_event_type: "plaza_event",
        plaza_level: "a",
        plaza_multiple_blocks: true,
        event_date: "2026-12-04",
        amplified_sound: false,
      },
      ruleset,
      TODAY,
      calendar,
    );
    const plaza = plan.findings.find((finding) => finding.ruleIds.includes("SAPO-PLAZA-001"));
    expect(plaza?.latestApplyDate).toBe("2026-10-05");
  });
});

describe("published bound inclusivity", () => {
  /**
   * A SYNTHETIC exclusive rule, because as of nyc.v2.8 NO PUBLISHED RULE DECLARES boundary
   * "exclusive" any more. DOB-ASSEMBLY-001 was the only one, and v2.8 corrects it to inclusive
   * against TPPN #07/96 and AC Table 28-112.8. The three assertions below used to read that rule
   * off the published file; leaving them there would have left the engine's exclusive path with
   * zero subjects, so they would have had to be deleted or the rule excluded — either of which
   * removes the guard on a code path `lastValidFilingDate` still has and a future rule can still
   * reach. Moved rather than dropped: the semantics stay exercised, on the same dates and the same
   * 10-day calendar window the published rule used to supply, so the numbers below are unchanged
   * from when they were read off nyc.v2.7.
   *
   * The published half of this coverage is NOT lost either — "leaves inclusive bounds alone" below
   * still reads a published rule, so the default is still pinned to the data.
   */
  const exclusiveTenDay = syntheticRuleset([
    {
      id: "RULE-EXCLUSIVE-TEN",
      kind: "permit",
      trigger: { all: [{ field: "headcount", op: "gte", value: 75 }] },
      output: {
        permit_name: "x",
        agency: "DOB",
        deadline: { type: "published_minimum", calendar_days: 10, boundary: "exclusive" },
      },
      verification: { status: "SOURCE_CONFIRMED" },
      source: { citation: "c", urls: ["https://example.test"] },
    },
  ]);
  const assemblyIn = (eventDate: string) =>
    evaluate(
      { event_date: eventDate, headcount: 90 } as unknown as EventIntake,
      exclusiveTenDay,
      TODAY,
      { id: exclusiveTenDay.calendarId, holidays: [] },
    ).findings.find((finding) => finding.ruleIds.includes("RULE-EXCLUSIVE-TEN"));

  it("treats an exclusive published bound as closed on the boundary day itself", () => {
    // An exclusive bound means "earlier than 10 days before the event", so exactly 10 days out is
    // already too late. This is the reading nyc.v2.7 gave DOB-ASSEMBLY-001 from a DOB code note;
    // v2.8 withdrew it for that rule, but the engine behavior it pinned is unchanged.
    const onTheBoundary = assemblyIn("2026-08-01"); // TODAY is 2026-07-22: exactly 10 days out
    expect(onTheBoundary?.latestApplyDate).toBe("2026-07-21");
    expect(onTheBoundary?.deadlineStatus).toBe("published_deadline_missed");
  });

  it("stays missed inside the strict window", () => {
    // Below the boundary: nine days out is further inside a window that closed at day 10, so it
    // is missed for the same reason and not merely at-risk. AGENTS.md wants below/at/above pinned
    // rather than the middle case inferred from the other two.
    const insideTheWindow = assemblyIn("2026-07-31");
    expect(insideTheWindow?.latestApplyDate).toBe("2026-07-20");
    expect(insideTheWindow?.deadlineStatus).toBe("published_deadline_missed");
    expect(insideTheWindow?.slackDays).toBe(-2);
  });

  it("keeps the day before the exclusive bound valid", () => {
    const dayBefore = assemblyIn("2026-08-02"); // eleven days out: the last valid filing day
    expect(dayBefore?.latestApplyDate).toBe("2026-07-22");
    expect(dayBefore?.deadlineStatus).not.toBe("published_deadline_missed");
    expect(dayBefore?.slackDays).toBe(0);
  });

  it("has no published rule left on the exclusive path, which is why the cases above are synthetic", () => {
    // Pins the premise of the synthetic fixture above, so it cannot quietly become wrong. If a
    // later ruleset publishes an exclusive bound again, this fails and whoever adds it should read
    // the three cases above and decide whether to point them back at the published rule.
    const exclusive = ruleset.rules
      .filter((rule) => rule.deadline !== null)
      .filter((rule) => {
        const deadline = rule.deadline!;
        return "boundary" in deadline && deadline.boundary === "exclusive";
      })
      .map((rule) => rule.id);
    expect(exclusive).toEqual([]);
  });

  it("honors a boundary on a composite floor rather than only accepting one", () => {
    // Accepting the field without acting on it would be the same contradiction in the other
    // direction, so this checks the date moves: an exclusive floor makes the floor day itself too
    // late, exactly as it does for the other dated variants.
    const floorDate = (boundary?: string) => {
      const ruleset = parseEngineRuleset({
        ruleset_version: "test.v1",
        jurisdiction: "US-NY-NYC",
        snapshot_date: "2026-07-22",
        config: {
          slack_warning_days: { value: 14 },
          business_day_math: { calendar: "test-calendar@2026" },
        },
        intake_fields: [
          { field: "event_date", type: "date" },
          { field: "headcount", type: "integer" },
        ],
        rules: [
          {
            id: "RULE-FLOOR",
            kind: "permit",
            trigger: { all: [{ field: "headcount", op: "gte", value: 1 }] },
            output: {
              permit_name: "x",
              agency: "DOB",
              deadline: {
                type: "composite",
                hard_floor_days: 21,
                processing_range_days: [21, 30],
                ...(boundary === undefined ? {} : { boundary }),
              },
            },
            verification: { status: "SOURCE_CONFIRMED" },
            source: { citation: "c", urls: ["https://example.test"] },
          },
        ],
        advisories: [],
      });
      return evaluate({ event_date: "2026-12-04", headcount: 5 } as EventIntake, ruleset, TODAY, {
        id: ruleset.calendarId,
        holidays: [],
      }).findings[0]?.latestApplyDate;
    };

    expect(floorDate()).toBe("2026-11-13"); // absent means inclusive: the floor day is valid
    expect(floorDate("inclusive")).toBe("2026-11-13");
    expect(floorDate("exclusive")).toBe("2026-11-12"); // day 21 too late, so day 22 is the last
  });

  it("leaves inclusive bounds alone, so 'at least N days' still includes day N", () => {
    // NYPD-SOUND-001 publishes "file at least 5 days before use" and declares no boundary, so the
    // default keeps day 5 valid. A blanket exclusive reading would wrongly close it.
    const sound = evaluate(
      { ...parkIntake, event_date: "2026-07-27" },
      ruleset,
      TODAY,
      calendar,
    ).findings.find((finding) => finding.ruleIds.includes("NYPD-SOUND-001"));
    expect(sound?.latestApplyDate).toBe("2026-07-22");
    expect(sound?.deadlineStatus).not.toBe("published_deadline_missed");
  });

  it("rejects an unsupported or misplaced boundary rather than ignoring it", () => {
    const withDeadline = (deadline: Record<string, unknown>) => () =>
      syntheticRuleset([
        {
          id: "RULE-BOUND",
          kind: "permit",
          trigger: { all: [{ field: "headcount", op: "gte", value: 1 }] },
          output: { permit_name: "x", agency: "DOB", deadline },
          verification: { status: "SOURCE_CONFIRMED" },
          source: { citation: "c", urls: ["https://example.test"] },
        },
      ]);
    expect(
      withDeadline({ type: "published_minimum", calendar_days: 10, boundary: "loose" }),
    ).toThrow(/boundary has unsupported value "loose"/);
    // Only the types dated by counting back from the event carry a boundary. Declaring one
    // anywhere else is an authoring mistake, and a composite's hard floor in particular has its
    // own cliff semantics that an "inclusive" label would contradict on the wire.
    expect(withDeadline({ type: "research_required", boundary: "exclusive" })).toThrow(
      /boundary does not apply to a "research_required" deadline/,
    );
    // composite is no longer excluded: its floor day is valid, which is what inclusive means, so
    // it takes a boundary like every other dated variant.
    expect(
      withDeadline({
        type: "composite",
        hard_floor_days: 21,
        processing_range_days: [21, 30],
        boundary: "inclusive",
      }),
    ).not.toThrow();
  });
});

describe("business-day arithmetic against the pinned calendar", () => {
  it("skips weekends when counting backward", () => {
    expect(subtractBusinessDays("2026-08-11", 15, calendar)).toBe("2026-07-21");
    expect(subtractBusinessDays("2026-07-27", 1, calendar)).toBe("2026-07-24");
  });

  it("honors an injected holiday", () => {
    const withHoliday: PublishedHolidayCalendar = { id: calendar.id, holidays: ["2026-07-24"] };
    expect(subtractBusinessDays("2026-07-27", 1, withHoliday)).toBe("2026-07-23");
    expect(countBusinessDays("2026-07-22", "2026-07-27", withHoliday)).toBe(2);
  });

  it("counts in both directions and across calendar days", () => {
    expect(countBusinessDays("2026-07-22", "2026-08-11", calendar)).toBe(14);
    expect(countBusinessDays("2026-08-11", "2026-07-22", calendar)).toBe(-14);
    expect(addCalendarDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(differenceInCalendarDays("2026-07-22", "2026-08-26")).toBe(35);
  });

  it("keeps an uncomputable published window conditional instead of dropping it", () => {
    // holidays: null is "no list published for this calendar id", not "a list with no holidays".
    // Weekday-only math would date SLA-ONEDAY-001 at 2026-07-21 and could call a missed window
    // on track, so the finding takes the published uncomputable-deadline treatment instead.
    const unpublished: HolidayCalendar = { id: ruleset.calendarId, holidays: null };
    const rooftop: EventIntake = {
      ...parkIntake,
      location_type: "private_venue",
      headcount: 40,
      event_date: "2026-08-11",
      amplified_sound: false,
      alcohol: true,
      venue_license_covers_event_area: "no",
    };

    const withList = evaluate(rooftop, ruleset, TODAY, calendar);
    const dated = withList.findings.find((finding) => finding.ruleIds.includes("SLA-ONEDAY-001"));
    expect(dated?.latestApplyDate).toBe("2026-07-21");
    expect(dated?.deadlineStatus).toBe("published_deadline_missed");

    const withoutList = evaluate(rooftop, ruleset, TODAY, unpublished);
    const degraded = withoutList.findings.find((finding) =>
      finding.ruleIds.includes("SLA-ONEDAY-001"),
    );
    expect(degraded?.latestApplyDate).toBeNull();
    expect(degraded?.deadlineStatus).toBe("not_calculable");
    expect(degraded?.notes).toContain("confirm with agency");

    // The agency published this window; only our ability to date it is missing. Excluding it from
    // the arithmetic would let the plan read FEASIBLE while the window is in fact already closed,
    // so the plan is CONDITIONAL and names the finding whose timeline it cannot compute.
    expect(withList.verdict).toBe("INFEASIBLE");
    expect(withoutList.verdict).toBe("CONDITIONAL");
    expect(withoutList.verdictDetail.unresolvedTimelines.map((entry) => entry.ruleIds)).toEqual([
      ["SLA-ONEDAY-001"],
      ["SLA-CATERING-001"],
    ]);
  });

  it("still computes every finding that needs no business-day math", () => {
    const unpublished: HolidayCalendar = { id: ruleset.calendarId, holidays: null };
    const plan = evaluate(parkIntake, ruleset, TODAY, unpublished);
    expect(plan.verdict).toBe("FEASIBLE");
    expect(plan.findings.find((f) => f.ruleIds.includes("PARKS-EVENT-001"))?.latestApplyDate).toBe(
      "2026-08-26",
    );
  });

  it("rejects a nonsensical business-day count", () => {
    expect(() => subtractBusinessDays("2026-08-11", -1, calendar)).toThrow(EvaluationError);
  });
});

describe("calendar arithmetic refuses a result outside the representable range", () => {
  const ISO_SHAPE = /^\d{4}-\d{2}-\d{2}$/;

  // The boundary is not a constant. `addCalendarDays` adds to its argument's epoch day, so the
  // backward range is `epochDay(start) − epochDay(0000-01-01)` and depends on where you start.
  it("throws one day past the backward boundary, from several starting dates", () => {
    for (const [start, bound] of [
      ["1970-01-01", 719_528],
      ["2026-08-26", 740_219],
      ["0001-01-01", 366],
    ] as const) {
      expect(addCalendarDays(start, -bound), `${start} at its bound`).toBe("0000-01-01");
      expect(() => addCalendarDays(start, -(bound + 1)), `${start} one past`).toThrow(
        EvaluationError,
      );
    }
  });

  // The guard sits in the shared formatting step, so it covers addition too. Overflowing forward
  // truncates to `"+010000-01"` rather than `"-000001-12"`, and is equally not a date.
  it("throws one day past the forward boundary as well", () => {
    expect(addCalendarDays("1970-01-01", 2_932_896)).toBe("9999-12-31");
    expect(() => addCalendarDays("1970-01-01", 2_932_897)).toThrow(EvaluationError);
    expect(() => addCalendarDays("9999-12-31", 1)).toThrow(/produced "\+010000-01"/);
  });

  it("names the offending value and what happened", () => {
    const past = (): string => addCalendarDays("2026-08-26", -740_220);
    expect(past).toThrow(
      /epoch day -719529 is outside the representable calendar range \(years 0000-9999\)/,
    );
    expect(past).toThrow(/produced "-000001-12", which is not a calendar date/);
  });

  // Two different boundaries. Past ±8.64e15 ms `toISOString` throws `RangeError` on its own, before
  // the guard can run; the much wider band below that is what the guard covers.
  it("is distinguishable from the outer RangeError", () => {
    expect(() => addCalendarDays("1970-01-01", -100_000_000)).toThrow(EvaluationError);
    expect(() => addCalendarDays("1970-01-01", -100_000_001)).toThrow(RangeError);
    expect(() => addCalendarDays("1970-01-01", -100_000_001)).not.toThrow(EvaluationError);
  });

  // Why this is safe to land: the longest window nyc.v2.8 publishes is 60 calendar days (SAPO
  // multi-block, rules[4]/[5]/[8]) and the longest business-day window is 15. Both are five orders
  // of magnitude short of the bound, so no published rule can reach the guard.
  it("is unreachable from anything the ruleset publishes", () => {
    for (const window of [5, 10, 14, 21, 30, 45, 60]) {
      expect(addCalendarDays("2026-08-26", -window), `${window}-day window`).toMatch(ISO_SHAPE);
    }
    expect(subtractBusinessDays("2026-08-26", 15, calendar)).toMatch(ISO_SHAPE);
    expect(countBusinessDays("2026-08-26", "2026-10-25", calendar)).toBeGreaterThan(0);
  });
});

describe("failures are explicit and never a 'no requirement' result (AC 5)", () => {
  const validCalendar = calendar;

  it("rejects an intake with no event date", () => {
    const { event_date: _omitted, ...withoutDate } = parkIntake;
    expect(() => evaluate(withoutDate, ruleset, TODAY, validCalendar)).toThrow(
      /event_date is required/,
    );
  });

  it("rejects an unparseable date on either side", () => {
    expect(() =>
      evaluate({ ...parkIntake, event_date: "2026-13-01" }, ruleset, TODAY, validCalendar),
    ).toThrow(EvaluationError);
    expect(() => evaluate(parkIntake, ruleset, "tomorrow", validCalendar)).toThrow(EvaluationError);
  });

  it("refuses a calendar that is not the one the ruleset pins", () => {
    expect(() =>
      evaluate(parkIntake, ruleset, TODAY, { id: "some-other-calendar", holidays: [] }),
    ).toThrow(/does not match the ruleset's pinned calendar/);
  });

  it("refuses an intake value whose type the operator cannot compare", () => {
    expect(() =>
      evaluate({ ...parkIntake, headcount: "many" }, ruleset, TODAY, validCalendar),
    ).toThrow(/headcount must be numeric/);
  });

  it("refuses an intake field the ruleset does not declare", () => {
    const strayField = syntheticRuleset([
      {
        id: "RULE-STRAY",
        kind: "permit",
        trigger: { all: [{ field: "headcount", op: "gte", value: 1 }] },
        output: { permit_name: "stray", agency: "DOB" },
        verification: { status: "SOURCE_CONFIRMED" },
        source: { citation: "c", urls: ["https://example.test"] },
      },
    ]);
    expect(() =>
      evaluate(
        { event_date: "2026-12-04", headcount: 5, structure_types: ["none"] },
        strayField,
        TODAY,
        {
          id: "test-calendar@2026",
          holidays: [],
        },
      ),
    ).not.toThrow();
  });
});

describe("ruleset parsing rejects anything it cannot evaluate", () => {
  const withRule = (rule: Record<string, unknown>) => () => syntheticRuleset([rule]);
  const baseRule = {
    id: "RULE-X",
    kind: "permit",
    trigger: { all: [{ field: "headcount", op: "gte", value: 1 }] },
    output: { permit_name: "x", agency: "DOB" },
    verification: { status: "SOURCE_CONFIRMED" },
    source: { citation: "c", urls: ["https://example.test"] },
  };

  it("rejects a non-object ruleset", () => {
    expect(() => parseEngineRuleset("nope")).toThrow(/ruleset must be an object/);
  });

  it("rejects an unsupported operator, kind, disposition, deadline type, or status", () => {
    expect(
      withRule({ ...baseRule, trigger: { all: [{ field: "headcount", op: "near", value: 1 }] } }),
    ).toThrow(/unsupported value "near"/);
    expect(withRule({ ...baseRule, kind: "vibe" })).toThrow(/unsupported value "vibe"/);
    expect(withRule({ ...baseRule, output: { ...baseRule.output, disposition: "MAYBE" } })).toThrow(
      /unsupported value "MAYBE"/,
    );
    expect(
      withRule({ ...baseRule, output: { ...baseRule.output, deadline: { type: "soonish" } } }),
    ).toThrow(/unsupported value "soonish"/);
    expect(withRule({ ...baseRule, verification: { status: "PROBABLY" } })).toThrow(
      /unsupported value "PROBABLY"/,
    );
  });

  it("parses sourced user summaries and rejects links outside the rule source", () => {
    const output = {
      ...baseRule.output,
      user_summary: {
        heading: "Plain heading",
        points: [
          {
            kind: "fee",
            text: "The fee is $25.",
            sources: [{ label: "Official fee page", url: "https://example.test" }],
          },
        ],
      },
    };
    const parsed = syntheticRuleset([{ ...baseRule, output }]);
    expect(parsed.rules[0]?.userSummary).toEqual(output.user_summary);

    expect(() =>
      syntheticRuleset([
        {
          ...baseRule,
          output: {
            ...output,
            user_summary: {
              ...output.user_summary,
              points: [
                {
                  kind: "fee",
                  text: "The fee is $25.",
                  sources: [{ label: "Other page", url: "https://other.test" }],
                },
              ],
            },
          },
        },
      ]),
    ).toThrow(/must also appear in the rule's source.urls/);

    expect(() =>
      syntheticRuleset([
        {
          ...baseRule,
          output: {
            ...output,
            user_summary: {
              ...output.user_summary,
              points: [{ kind: "fee", text: "The fee is $25.", sources: [] }],
            },
          },
        },
      ]),
    ).toThrow(/sources must not be empty for a sourced rule/);
  });

  it("rejects a malformed trigger tree", () => {
    expect(withRule({ ...baseRule, trigger: { all: [] } })).toThrow(/must not be empty/);
    expect(withRule({ ...baseRule, trigger: { all: [{ any: [], field: "headcount" }] } })).toThrow(
      /exactly one of all, any, or field/,
    );
    expect(
      withRule({ ...baseRule, trigger: { any: [{ field: "headcount", op: "gte" }] } }),
    ).toThrow(/value is required/);
  });

  it("rejects a trigger on a field the registry does not declare", () => {
    expect(
      withRule({ ...baseRule, trigger: { all: [{ field: "vibes", op: "eq", value: 1 }] } }),
    ).toThrow(/references undeclared field "vibes"/);
  });

  it("rejects a malformed deadline body", () => {
    expect(
      withRule({
        ...baseRule,
        output: {
          ...baseRule.output,
          deadline: { type: "composite", hard_floor_days: 21, processing_range_days: [21] },
        },
      }),
    ).toThrow(/must hold two numbers/);
    expect(
      withRule({
        ...baseRule,
        output: {
          ...baseRule.output,
          deadline: { type: "published_minimum_by_level", levels: {} },
        },
      }),
    ).toThrow(/levels must not be empty/);
  });

  it("refuses a declared field no rule, deadline, or scoping condition reads", () => {
    // The reverse of the check boot already had. A trigger naming an undeclared field was refused;
    // a declared field naming no trigger was invisible, which is how seven of them went unnoticed.
    expect(() =>
      parseEngineRuleset({
        ruleset_version: "test.v1",
        jurisdiction: "US-NY-NYC",
        snapshot_date: "2026-07-22",
        config: {
          slack_warning_days: { value: 14 },
          business_day_math: { calendar: "test-calendar@2026" },
        },
        intake_fields: [
          { field: "event_date", type: "date" },
          { field: "headcount", type: "integer" },
          { field: "favourite_colour", type: "enum", values: ["blue"] },
        ],
        rules: [
          {
            id: "RULE-X",
            kind: "permit",
            trigger: { all: [{ field: "headcount", op: "gte", value: 1 }] },
            output: { permit_name: "x", agency: "DOB" },
            verification: { status: "SOURCE_CONFIRMED" },
            source: { citation: "c", urls: ["https://example.test"] },
          },
        ],
        advisories: [],
      }),
    ).toThrow(/"favourite_colour" is declared but no rule trigger, deadline, or scoping condition/);
  });

  it("counts a level field as consumed only when a by-level deadline keys on it", () => {
    // The bug the derivation fixes. Naming the field as consumed unconditionally let a ruleset
    // declare it while publishing no by-level deadline and still pass the orphan check.
    const withLevelField =
      (deadline: Record<string, unknown> | undefined, extra: unknown[] = []) =>
      () =>
        parseEngineRuleset({
          ruleset_version: "test.v1",
          jurisdiction: "US-NY-NYC",
          snapshot_date: "2026-07-22",
          config: {
            slack_warning_days: { value: 14 },
            business_day_math: { calendar: "test-calendar@2026" },
          },
          intake_fields: [
            { field: "event_date", type: "date" },
            { field: "venue_kind", type: "enum", values: ["hall", "plaza"] },
            { field: "tier", type: "enum", values: ["a", "b"], asked_when: "venue_kind = plaza" },
            {
              field: "spans_blocks",
              type: "boolean",
              asked_when: "venue_kind = plaza",
            },
            ...extra,
          ],
          rules: [
            {
              id: "RULE-LEVEL",
              kind: "permit",
              trigger: { all: [{ field: "venue_kind", op: "eq", value: "plaza" }] },
              output: { permit_name: "x", agency: "DOB", ...(deadline ? { deadline } : {}) },
              verification: { status: "SOURCE_CONFIRMED" },
              source: { citation: "c", urls: ["https://example.test"] },
            },
          ],
          advisories: [],
        });

    const byLevel = {
      type: "published_minimum_by_level",
      level_field: "tier",
      multi_block_field: "spans_blocks",
      levels: { a: { calendar_days: 45, multi_block_days: 60 }, b: { calendar_days: 30 } },
    };

    // No by-level deadline: nothing keys on `tier`, and the flag has nothing to qualify.
    expect(withLevelField(undefined)).toThrow(/"tier" is declared but no rule trigger, deadline/);

    // A by-level deadline consumes exactly the two fields its binding names.
    expect(withLevelField(byLevel)).not.toThrow();

    // And only those. A level-shaped field the binding does not name is still an orphan, which is
    // what stops the guard from waving through any enum that happens to cover the level keys.
    expect(
      withLevelField({ ...byLevel, level_field: "grade" }, [
        { field: "grade", type: "enum", values: ["a", "b"], asked_when: "venue_kind = plaza" },
      ]),
    ).toThrow(/"tier" is declared but no rule trigger, deadline/);
  });

  it("counts deadline resolution and scoping as consuming a field", () => {
    // plaza_level and plaza_multiple_blocks appear in no trigger but resolve SAPO-PLAZA-001's
    // deadline; generator_present appears in no trigger but gates the quantity questions that
    // rules do read. None of them belongs on the unconsumed list, and the published ruleset
    // loading at all is the assertion.
    expect(ruleset.intakeFields.map((field) => field.field)).toEqual(
      expect.arrayContaining([
        "plaza_level",
        "plaza_multiple_blocks",
        "generator_present",
        "event_date",
      ]),
    );
  });

  it("accepts the published ruleset unchanged", () => {
    expect(ruleset.rulesetVersion).toBe("nyc.v2.11");
    expect(ruleset.slackWarningDays).toBe(14);
    expect(ruleset.rules).toHaveLength(46);
  });

  it("publishes a plain-language summary for every rule and advisory", () => {
    expect(
      ruleset.rules.filter((rule) => rule.userSummary === null).map((rule) => rule.id),
    ).toEqual([]);
  });

  it("keeps organizer summary wording and links aligned with the published facts", () => {
    const assembly = ruleset.rules.find((rule) => rule.id === "DOB-ASSEMBLY-001");
    expect(assembly?.userSummary?.points.find((point) => point.kind === "deadline")?.text).toBe(
      "File 10 or more business days before the event to avoid DOB's late surcharge.",
    );

    const exemption = ruleset.rules.find((rule) => rule.id === "DOHMH-EXEMPTION-001");
    expect(
      exemption?.userSummary?.points.find((point) => point.kind === "warning")?.sources,
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          url: "https://www.nyc.gov/assets/doh/downloads/pdf/rii/temp-vendors.pdf",
        }),
        expect.objectContaining({
          url: "https://www.nyc.gov/site/doh/business/food-operators/temporary-food-service-establishments.page",
        }),
      ]),
    );

    expect(rawRuleset.status).toContain(
      "plain-language organizer summaries across all 42 rules and four advisories",
    );
  });
});

describe("asked_when scoping", () => {
  /** A registry where `venue_note` is scoped by the expression under test. */
  const scopingRuleset = (askedWhen: string, extraFields: Record<string, unknown>[] = []) =>
    ({
      ...rawRuleset,
      intake_fields: [
        { field: "event_date", type: "date" },
        { field: "headcount", type: "integer" },
        { field: "food_present", type: "boolean" },
        {
          field: "sapo_event_type",
          type: "enum",
          values: ["street_event", "block_party", "unknown"],
        },
        ...extraFields,
        { field: "venue_note", type: "boolean", asked_when: askedWhen },
      ],
      // The scoped field is what the rule reads; the others are consumed by scoping it.
      rules: [
        {
          id: "RULE-SCOPE",
          kind: "permit",
          trigger: { all: [{ field: "venue_note", op: "bool", value: true }] },
          output: { permit_name: "x", agency: "DOB" },
          verification: { status: "SOURCE_CONFIRMED" },
          source: { citation: "c", urls: ["https://example.test"] },
        },
        {
          // Consumes the fields the expressions under test scope against, so the registry stays
          // constant while the expression varies. The loader refuses a field nothing reads.
          id: "RULE-CONSUMER",
          kind: "note",
          trigger: {
            any: [
              { field: "headcount", op: "gte", value: 1_000_000 },
              { field: "food_present", op: "bool", value: true },
              { field: "sapo_event_type", op: "eq", value: "street_event" },
            ],
          },
          output: { note_text: "reads the scoping fields" },
          verification: { status: "SOURCE_CONFIRMED" },
          source: { citation: "c", urls: ["https://example.test"] },
        },
      ],
      advisories: [],
    }) as Record<string, unknown>;

  const withScoping =
    (askedWhen: string, extraFields: Record<string, unknown>[] = []) =>
    () =>
      parseEngineRuleset(scopingRuleset(askedWhen, extraFields));

  it("accepts the shapes the published registry actually uses", () => {
    expect(withScoping("headcount gte 75")).not.toThrow();
    expect(withScoping("sapo_event_type = street_event")).not.toThrow();
    expect(withScoping("sapo_event_type != unknown")).not.toThrow();
    expect(withScoping("sapo_event_type in street_event/block_party")).not.toThrow();
    expect(withScoping("food_present")).not.toThrow();
    expect(withScoping("food_present AND headcount gte 75")).not.toThrow();
  });

  it("rejects a mistyped enum operand at load, not silently at evaluation", () => {
    // The whole failure is silence: "street_evet" matches no intake ever, so venue_note and every
    // rule scoped by it leave scope and their requirements vanish with no error anywhere.
    expect(withScoping("sapo_event_type = street_evet")).toThrow(
      /compares "sapo_event_type" against "street_evet", which it does not declare/,
    );
    expect(withScoping("sapo_event_type != blockparty")).toThrow(/does not declare/);
    expect(withScoping("sapo_event_type in street_event/blok_party")).toThrow(
      /"blok_party", which is not a declared value of it/,
    );
    expect(withScoping("sapo_event_type = street_evet")).toThrow(/unusable asked_when/);
  });

  it("rejects a non-numeric threshold at load", () => {
    expect(withScoping("headcount gte seventy_five")).toThrow(
      /compares "headcount" against a non-numeric threshold "seventy_five"/,
    );
  });

  it("rejects operators the field's type cannot support", () => {
    expect(withScoping("sapo_event_type gte 3")).toThrow(/is a enum field, with "gte"/);
    expect(withScoping("headcount in 75/100")).toThrow(/declares no values to match against/);
    expect(withScoping("headcount")).toThrow(
      /reads "headcount" as a flag, but it is a integer field/,
    );
    expect(withScoping("food_present = maybe")).toThrow(/compares boolean "food_present"/);
  });

  it("scopes a typed comparison correctly at evaluation, not just at parse", () => {
    // The operand is written as text but the intake answer is a boolean or a number, so a
    // comparison kept as a string would never match: every equality false, every inequality true,
    // and the scoped field plus its requirements silently gone. Parsing is not enough to prove
    // this — the clause has to actually decide scope.
    const fires = (askedWhen: string, intake: Record<string, unknown>): boolean => {
      const ruleset = parseEngineRuleset(scopingRuleset(askedWhen));
      const plan = evaluate(
        { event_date: "2026-12-04", venue_note: true, ...intake } as EventIntake,
        ruleset,
        TODAY,
        { id: ruleset.calendarId, holidays: [] },
      );
      return plan.findings.some((finding) => finding.ruleIds.includes("RULE-SCOPE"));
    };

    // boolean-typed operand
    expect(fires("food_present = true", { food_present: true })).toBe(true);
    expect(fires("food_present = true", { food_present: false })).toBe(false);
    expect(fires("food_present != true", { food_present: false })).toBe(true);

    // number-typed operand
    expect(fires("headcount = 75", { headcount: 75 })).toBe(true);
    expect(fires("headcount = 75", { headcount: 76 })).toBe(false);
    expect(fires("headcount != 75", { headcount: 76 })).toBe(true);

    // an enum operand stays a string, which is what the published registry uses
    expect(fires("sapo_event_type = street_event", { sapo_event_type: "street_event" })).toBe(true);
    expect(fires("sapo_event_type = street_event", { sapo_event_type: "block_party" })).toBe(false);
  });

  it("rejects a clause that names neither a declared field nor a declared value", () => {
    expect(withScoping("the_vibes_are_right")).toThrow(/names no declared field or value/);
  });

  it("rejects a cyclic scoping chain when the ruleset loads", () => {
    // Each clause parses on its own, so a cycle only surfaced when evaluation first resolved one
    // of the fields — every plan request failing instead of the artifact being refused at boot.
    expect(
      withScoping("left", [
        { field: "left", type: "boolean", asked_when: "right" },
        { field: "right", type: "boolean", asked_when: "left" },
      ]),
    ).toThrow(/scoping is cyclic: left → right → left/);
  });

  it("rejects a field scoped by itself", () => {
    expect(withScoping("venue_note")).toThrow(/scoping is cyclic: venue_note → venue_note/);
  });
});

// nyc.v2.4 publishes two facts the engine used to hold in code. Both tests below are written so
// they fail if the engine goes back to assuming: the level binding is proven by naming fields the
// old constant never held, and the boundary by a threshold that declares none.
describe("facts the ruleset publishes rather than the engine assuming (nyc.v2.4)", () => {
  const testCalendar: PublishedHolidayCalendar = { id: "test-calendar@2026", holidays: [] };
  // The default flag lives in the parameter default rather than the base list, so a case that
  // binds the deadline to a different boolean does not also leave `spans_two_sites` declared and
  // unread — which the orphan guard now refuses, correctly.
  const plazaRuleset = (
    deadline: Record<string, unknown>,
    fields: unknown[] = [{ field: "spans_two_sites", type: "boolean" }],
  ) =>
    parseEngineRuleset({
      ruleset_version: "test.v1",
      jurisdiction: "US-NY-NYC",
      snapshot_date: "2026-07-22",
      config: {
        slack_warning_days: { value: 14 },
        business_day_math: { calendar: "test-calendar@2026" },
      },
      intake_fields: [
        { field: "event_date", type: "date" },
        { field: "tier", type: "enum", values: ["gold", "silver"] },
        ...fields,
      ],
      rules: [
        {
          id: "RULE-LEVEL",
          kind: "permit",
          trigger: { all: [{ field: "tier", op: "in", value: ["gold", "silver"] }] },
          output: { permit_name: "x", agency: "DOT", deadline },
          verification: { status: "SOURCE_CONFIRMED" },
          source: { citation: "c", urls: ["https://example.test"] },
        },
      ],
      advisories: [],
    });

  const byLevel = {
    type: "published_minimum_by_level",
    level_field: "tier",
    multi_block_field: "spans_two_sites",
    levels: {
      gold: { calendar_days: 30, multi_block_days: 60 },
      silver: { calendar_days: 10, multi_block_days: 20 },
    },
  };

  it("dates a by-level deadline from the fields the rule names, not from ones the engine knows", () => {
    // Neither "tier" nor "spans_two_sites" is a field the engine could have known about: the
    // published ruleset's only by-level deadline keys on plaza_level/plaza_multiple_blocks. The
    // dates below can only come from reading the deadline's own declaration.
    const dateFor = (intake: Record<string, unknown>) =>
      evaluate(
        { event_date: "2026-10-01", ...intake } as unknown as EventIntake,
        plazaRuleset(byLevel),
        TODAY,
        testCalendar,
      ).findings[0]?.latestApplyDate;

    expect(dateFor({ tier: "gold", spans_two_sites: false })).toBe("2026-09-01"); // 30 days
    expect(dateFor({ tier: "silver", spans_two_sites: false })).toBe("2026-09-21"); // 10 days
    // The multi-block window is chosen by the named boolean, not by whichever boolean the
    // registry happens to list first.
    expect(dateFor({ tier: "gold", spans_two_sites: true })).toBe("2026-08-02"); // 60 days
  });

  it("refuses a by-level deadline that does not say which fields it keys on", () => {
    const { level_field: levelField, multi_block_field: _ignored, ...unbound } = byLevel;
    expect(() => plazaRuleset(unbound)).toThrow(/level_field/);
    expect(() => plazaRuleset({ ...unbound, level_field: levelField })).toThrow(
      /multi_block_field/,
    );
  });

  it("refuses a binding that cannot carry the levels the rule publishes", () => {
    // A field that never offers "gold" would silently date every gold event as unknown.
    expect(() =>
      plazaRuleset({ ...byLevel, level_field: "grade" }, [
        { field: "grade", type: "enum", values: ["silver"] },
      ]),
    ).toThrow(/does not offer published level\(s\) gold/);
    expect(() => plazaRuleset({ ...byLevel, level_field: "nope" })).toThrow(
      /"nope" is not a declared intake field/,
    );
    // Choosing between a level's two windows is a yes/no question.
    expect(() => plazaRuleset({ ...byLevel, multi_block_field: "tier" })).toThrow(
      /is a enum field/,
    );
    // A field that can answer with several levels has no level for the resolver to look up. It
    // takes the unresolvable path, which reports NOT_CALCULABLE without naming a blocking fact,
    // so the plan can read FEASIBLE around an undated permit instead of failing loudly.
    expect(() =>
      plazaRuleset({ ...byLevel, level_field: "tiers" }, [
        { field: "tiers", type: "multi_enum", values: ["gold", "silver"] },
      ]),
    ).toThrow(/is a multi_enum field; a level deadline resolves one level per plan/);
  });

  it("refuses a multi-block field the resolver cannot read at every level that needs it", () => {
    // Both published levels carry a multi-block window, so a flag scoped away from either one is
    // unreachable there. Out of scope is not unanswered: the resolver's unanswered guard does not
    // fire, the flag reads as "no", and the shorter single-block window is applied silently — an
    // already-missed multi-block deadline reported as on track.
    expect(() =>
      plazaRuleset({ ...byLevel, multi_block_field: "gold_only_flag" }, [
        { field: "gold_only_flag", type: "boolean", asked_when: "tier = gold" },
      ]),
    ).toThrow(/is not asked for level\(s\) silver, which publish a multi-block window/);

    // In scope for every such level is fine, whether the scoping names them or ignores them.
    expect(() =>
      plazaRuleset({ ...byLevel, multi_block_field: "either_flag" }, [
        { field: "either_flag", type: "boolean", asked_when: "tier in gold/silver" },
      ]),
    ).not.toThrow();

    // And a level publishing no multi-block window puts no scoping demand on the flag: silver
    // here has a single window, so the gold-only flag is reachable everywhere it is consulted.
    expect(() =>
      plazaRuleset(
        {
          ...byLevel,
          levels: {
            gold: { calendar_days: 30, multi_block_days: 60 },
            silver: { calendar_days: 10 },
          },
          multi_block_field: "gold_only_flag",
        },
        [{ field: "gold_only_flag", type: "boolean", asked_when: "tier = gold" }],
      ),
    ).not.toThrow();
  });

  it("leaves a threshold that declares no boundary exclusive of its own value", () => {
    // DOB-TENT-001 declares boundary "conditional" for 400 sq ft; FDNY-GENERATOR-001's 2.5 gallons
    // declares nothing and so excludes 2.5 exactly. If the engine went back to a rule-id list this
    // synthetic rule would be off it and the assertion would still pass, so the published tent case
    // below is the half that pins the behavior to the data.
    const atThreshold = (extra: Record<string, unknown>) =>
      evaluate(
        { event_date: "2026-10-01", headcount: 400 } as unknown as EventIntake,
        syntheticRuleset([
          {
            id: "RULE-THRESHOLD",
            kind: "permit",
            trigger: { all: [{ field: "headcount", op: "gt", value: 400, ...extra }] },
            output: { permit_name: "x", agency: "DOB" },
            verification: { status: "SOURCE_CONFIRMED" },
            source: { citation: "c", urls: ["https://example.test"] },
          },
        ]),
        TODAY,
        testCalendar,
      );

    expect(atThreshold({}).findings).toHaveLength(0);
    expect(atThreshold({ boundary: "conditional" }).findings).toHaveLength(1);
    expect(atThreshold({ boundary: "conditional" }).verdict).toBe("CONDITIONAL");
  });

  it("rejects a boundary it cannot honor rather than ignoring it", () => {
    const withTrigger = (condition: Record<string, unknown>) => () =>
      syntheticRuleset([
        {
          id: "RULE-THRESHOLD",
          kind: "permit",
          trigger: { all: [condition] },
          output: { permit_name: "x", agency: "DOB" },
          verification: { status: "SOURCE_CONFIRMED" },
          source: { citation: "c", urls: ["https://example.test"] },
        },
      ]);
    expect(withTrigger({ field: "headcount", op: "gt", value: 400, boundary: "strict" })).toThrow(
      /boundary has unsupported value "strict"/,
    );
    // "at the threshold" means nothing for an operator that has no threshold to sit on.
    expect(
      withTrigger({ field: "headcount", op: "eq", value: 400, boundary: "conditional" }),
    ).toThrow(/boundary does not apply to the "eq" operator/);
    expect(
      withTrigger({
        field: "structure_types",
        op: "contains",
        value: "tent_canopy",
        boundary: "conditional",
      }),
    ).toThrow(/boundary does not apply to the "contains" operator/);
    // "gte" already admits its threshold, so there is no excluded value for a boundary to reopen.
    expect(
      withTrigger({ field: "headcount", op: "gte", value: 400, boundary: "conditional" }),
    ).toThrow(/boundary does not apply to the "gte" operator/);
  });

  it("loads every preserved v2 ruleset without weakening active unconsumed-field validation", () => {
    const superseded = [
      ["nyc.v2.1", "b0214b4"],
      ["nyc.v2.2", "3a1b7ba"],
      ["nyc.v2.3", "5f32040"],
      ["nyc.v2.4", "98dc5f8"],
      ["nyc.v2.5", "81320c7"],
      ["nyc.v2.6", "0122eca"],
      ["nyc.v2.7", "e4f04b1"],
      ["nyc.v2.8", "7a16461"],
    ] as const;

    expect(
      superseded.map(([version, revision]) => {
        const artifactPath = `rules/nyc-rules.${version.replace("nyc.", "")}.json`;
        const document = JSON.parse(
          execFileSync("git", ["show", `${revision}:${artifactPath}`], { encoding: "utf8" }),
        );
        return parseEngineRuleset(document).rulesetVersion;
      }),
    ).toEqual(superseded.map(([version]) => version));

    expect(() =>
      parseEngineRuleset({
        ...rawRuleset,
        intake_fields: [
          ...(rawRuleset.intake_fields as unknown[]),
          {
            field: "venue_has_assembly_approval",
            type: "enum",
            values: ["yes", "no", "unknown"],
            asked_when: "location_type = private_venue AND headcount gte 75",
          },
        ],
      }),
    ).toThrow(/intake field "venue_has_assembly_approval" is declared but no rule/);
  });

  it("still reads nyc.v2.3 under nyc.v2.3 semantics, so its plans replay", () => {
    // A plan pins ruleset_version and intake_snapshot in order to be re-evaluated later: AD-7
    // says history stays reproducible after rules change, AD-13 has two versions coexisting, and
    // governance §9 requires replay to be verified after a regulatory publish. v2.3 published
    // neither fact, so it is read under the engine facts of its own era rather than normalized
    // into v2.4 — same verdict, same findings, same dates as when the plan was generated.
    const v23 = parseEngineRuleset(
      JSON.parse(
        readFileSync(
          fileURLToPath(new URL("./__fixtures__/nyc-rules.v2.3.json", import.meta.url)),
          "utf8",
        ),
      ),
    );
    expect(v23.rulesetVersion).toBe("nyc.v2.3");

    const replays = (intake: EventIntake) => {
      const before = evaluate(intake, v23, TODAY, calendar);
      const after = evaluate(intake, ruleset, TODAY, calendar);
      const afterFindings = after.findings.filter(
        (finding) => !finding.ruleIds[0]?.startsWith("CONF-"),
      );
      const withoutPresentation = (findings: PermitPlan["findings"]) =>
        findings.map(({ userSummary: _userSummary, ...finding }) => finding);
      const reached = (findings: PermitPlan["findings"]) =>
        [...findings.flatMap((f) => f.ruleIds)].sort();
      // Every published filing window in the plan. Keyed by the window rather than by rule,
      // because a merged line carries one deadline for both of its rules — DOB-TALL-STRUCTURE-001
      // publishes none of its own, so nothing is being hidden by not attributing the tent's date
      // to it. `rulesMatch` already pins rule identity; this pins that no window moved or vanished.
      const windows = (findings: PermitPlan["findings"]) =>
        findings
          .filter((f) => f.latestApplyDate !== null)
          .map((f) => `${f.latestApplyDate}:${f.deadlineStatus}`)
          .sort();
      return {
        verdictMatches: before.verdict === after.verdict,
        findingsMatch:
          JSON.stringify(withoutPresentation(before.findings)) ===
          JSON.stringify(withoutPresentation(afterFindings)),
        // What must hold across ANY publish, grouping aside: the same rules are reached, and each
        // one keeps its date and status. A rule appearing, vanishing or moving its deadline between
        // eras is drift; two rules being rendered as one line is a published grouping decision.
        rulesMatch:
          JSON.stringify(reached(before.findings)) === JSON.stringify(reached(afterFindings)),
        windowsMatch:
          JSON.stringify(windows(before.findings)) === JSON.stringify(windows(afterFindings)),
        verdict: before.verdict,
        // Exposed so a window that DOES move can be named rather than waved through by flipping
        // `windowsMatch` to false. A bare `windowsMatch: false` would accept any movement at all,
        // including a rule silently losing its date, which is the drift this whole block guards.
        windowFor: (ruleId: string) => {
          const pick = (findings: PermitPlan["findings"]) => {
            const finding = findings.find((f) => f.ruleIds.includes(ruleId));
            return finding === undefined
              ? "no finding"
              : `${finding.latestApplyDate}:${finding.deadlineStatus}`;
          };
          return { before: pick(before.findings), after: pick(afterFindings) };
        },
      };
    };

    // The by-level deadline: a dated plaza permit is the case the binding decides, and the one a
    // missing binding would silently turn into NOT_CALCULABLE.
    const datedPlaza = replays({
      ...parkIntake,
      location_type: "plaza",
      obstructs_public_way: "yes",
      sapo_event_type: "plaza_event",
      plaza_level: "b",
      plaza_multiple_blocks: true,
      amplified_sound: false,
    } as EventIntake);
    expect(datedPlaza).toMatchObject({
      verdictMatches: true,
      findingsMatch: true,
      rulesMatch: true,
      windowsMatch: true,
    });

    // The exact boundary: DOB-TENT-001 at exactly 400 sq ft. This half fails silently rather than
    // loudly — v2.3 read the threshold as unresolved there, and a v2.4-only reading would make the
    // rule simply not fire, changing the verdict of a stored plan with no error anywhere.
    const tentOnBoundary = replays({
      ...parkIntake,
      location_type: "private_venue",
      amplified_sound: false,
      structure_types: ["tent_canopy"],
      tent_area_sqft: 400,
      tent_days_in_place: 3,
    } as EventIntake);
    // nyc.v2.6 gave DOB-TENT-001 the `dob-structure` dedupe key that DOB-TALL-STRUCTURE-001 had
    // always declared, so this intake reaches both rules and now renders them as ONE line where
    // v2.3 rendered two. `findingsMatch` is therefore false here by design, and that is the whole
    // point of reading each artifact under its own era: the grouping is published data, so a v2.5
    // plan replays as two findings from the v2.5 file (kept at git 81320c7) and a v2.6 plan as one
    // from this one. Nothing was normalized across the bump. What must not move did not: same
    // verdict, same rules reached, same date and status on each.
    //
    // nyc.v2.8 ALSO moves a window on this intake, and unlike the grouping change that is a
    // REGULATORY correction: at headcount 150 in a private venue this intake reaches
    // DOB-ASSEMBLY-001, whose filing lead v2.8 corrects from 10 calendar days on an exclusive
    // bound to 10 BUSINESS days on an inclusive bound (TPPN #07/96; AC Table 28-112.8). So
    // `windowsMatch` is false here BY DESIGN. It is asserted as a named, exact move rather than
    // by excluding the rule from the comparison: excluding it would drop the guard permanently and
    // a later real drift on that rule would replay clean. A v2.3 plan still replays as its own era
    // computed it — that is the point of reading each artifact under its own semantics — and the
    // v2.8 date is what a v2.8 plan gets.
    expect(tentOnBoundary).toMatchObject({
      verdictMatches: true,
      rulesMatch: true,
      windowsMatch: false,
      findingsMatch: false,
    });
    expect(tentOnBoundary.windowFor("DOB-ASSEMBLY-001")).toEqual({
      // v2.3: 10 calendar days back from 2026-09-16 is the 6th, exclusive makes it the 5th.
      before: "2026-09-05:on_track",
      // v2.8: 10 business days back from 2026-09-16, inclusive, is the 2nd — two weekends earlier.
      after: "2026-09-02:on_track",
    });
    // And every OTHER window on this intake is unmoved, so `windowsMatch: false` above cannot hide
    // a second movement behind the one being accounted for.
    expect(tentOnBoundary.windowFor("DOB-TENT-001")).toEqual({
      // 15 business days back from 2026-09-16, unchanged across both eras.
      before: "2026-08-26:on_track",
      after: "2026-08-26:on_track",
    });
    expect(tentOnBoundary.verdict).toBe("CONDITIONAL");

    // And the scenario intake, so the guarantee is not only asserted on the two changed rules.
    expect(replays(parkIntake)).toMatchObject({
      verdictMatches: true,
      findingsMatch: true,
      rulesMatch: true,
      windowsMatch: true,
    });
  });

  it("never dates a level deadline from a field the plan was not asked", () => {
    // Both halves of the binding, both reached by scoping the parser cannot disprove: "tier in
    // gold/silver AND enabled" is accepted because every clause naming the level field admits both
    // levels, and `enabled = false` still puts the field out of scope. Out of scope is not
    // unanswered, so the old guard passed and the resolver read the flag as "no".
    const scoped = (extra: unknown[], deadlineOverrides: Record<string, unknown> = {}) =>
      parseEngineRuleset({
        ruleset_version: "test.v1",
        jurisdiction: "US-NY-NYC",
        snapshot_date: "2026-07-22",
        config: {
          slack_warning_days: { value: 14 },
          business_day_math: { calendar: "test-calendar@2026" },
        },
        intake_fields: [
          { field: "event_date", type: "date" },
          { field: "enabled", type: "boolean" },
          { field: "tier", type: "enum", values: ["gold", "silver"] },
          ...extra,
        ],
        rules: [
          {
            id: "RULE-LEVEL",
            kind: "permit",
            // Fires whatever `enabled` says, so scope is the only thing under test.
            trigger: { all: [{ field: "enabled", op: "in", value: [true, false] }] },
            output: {
              permit_name: "x",
              agency: "DOT",
              deadline: {
                type: "published_minimum_by_level",
                level_field: "tier",
                multi_block_field: "spans",
                levels: {
                  gold: { calendar_days: 30, multi_block_days: 60 },
                  silver: { calendar_days: 10, multi_block_days: 20 },
                },
                ...deadlineOverrides,
              },
            },
            verification: { status: "SOURCE_CONFIRMED" },
            source: { citation: "c", urls: ["https://example.test"] },
          },
        ],
        advisories: [],
      });

    const plan = (
      ruleset: ReturnType<typeof parseEngineRuleset>,
      intake: Record<string, unknown>,
    ) =>
      evaluate({ event_date: "2026-10-01", ...intake } as unknown as EventIntake, ruleset, TODAY, {
        id: "test-calendar@2026",
        holidays: [],
      });

    // The multi-block flag, unreachable through a clause that names no level.
    const flagScoped = scoped([
      { field: "spans", type: "boolean", asked_when: "tier in gold/silver AND enabled" },
    ]);
    const unreachableFlag = plan(flagScoped, { tier: "gold", enabled: false });
    const flagFinding = unreachableFlag.findings[0];
    // The shorter single-block window would have dated it 2026-09-01. It is not dated at all.
    expect(flagFinding?.latestApplyDate).toBeNull();
    expect(flagFinding?.deadlineStatus).toBe("not_calculable");
    expect(flagFinding?.timelineUnresolvedReason).toContain("never asked spans");
    expect(unreachableFlag.verdict).toBe("CONDITIONAL");
    // Same ruleset, flag reachable: the deadline dates normally, so this is a scoping result and
    // not the binding being broken.
    expect(
      plan(flagScoped, { tier: "gold", enabled: true, spans: true }).findings[0]?.latestApplyDate,
    ).toBe("2026-08-02");

    // The level field itself, scoped behind something the trigger does not imply.
    const levelScoped = parseEngineRuleset({
      ruleset_version: "test.v1",
      jurisdiction: "US-NY-NYC",
      snapshot_date: "2026-07-22",
      config: {
        slack_warning_days: { value: 14 },
        business_day_math: { calendar: "test-calendar@2026" },
      },
      intake_fields: [
        { field: "event_date", type: "date" },
        { field: "enabled", type: "boolean" },
        { field: "tier", type: "enum", values: ["gold", "silver"], asked_when: "enabled" },
        { field: "spans", type: "boolean", asked_when: "enabled" },
      ],
      rules: [
        {
          id: "RULE-LEVEL",
          kind: "permit",
          trigger: { all: [{ field: "enabled", op: "in", value: [true, false] }] },
          output: {
            permit_name: "x",
            agency: "DOT",
            deadline: {
              type: "published_minimum_by_level",
              level_field: "tier",
              multi_block_field: "spans",
              levels: {
                gold: { calendar_days: 30, multi_block_days: 60 },
                silver: { calendar_days: 10, multi_block_days: 20 },
              },
            },
          },
          verification: { status: "SOURCE_CONFIRMED" },
          source: { citation: "c", urls: ["https://example.test"] },
        },
      ],
      advisories: [],
    });
    const unreachableLevel = plan(levelScoped, { enabled: false });
    expect(unreachableLevel.findings[0]?.deadlineStatus).toBe("not_calculable");
    expect(unreachableLevel.findings[0]?.timelineUnresolvedReason).toContain("never asked tier");
    // The hole this closes: a required permit with no date inside a FEASIBLE plan.
    expect(unreachableLevel.findings[0]?.disposition).toBe("required");
    expect(unreachableLevel.verdict).toBe("CONDITIONAL");

    // An unresolved timeline is not a missing fact: nobody can answer an unasked question, so the
    // verdict must not offer it as a branch. It also must not recurse trying.
    expect(unreachableLevel.verdictDetail.missingFacts).toHaveLength(0);
    expect(unreachableLevel.verdictDetail.unresolvedTimelines).toHaveLength(1);
  });

  it("reproduces a v2.3 plaza finding in the shape v2.3 serialised it", () => {
    // The replay test above compares two findings from the same parser, so a key both sides gained
    // together is invisible to it. This compares against a finding serialised by the engine on
    // main, before any of this existed: `__fixtures__/plaza-finding-nyc.v2.3.json`, generated by
    // running that engine against the v2.3 artifact and this intake. AD-7 replay is reproducing the
    // historical artifact, so a shape change is a replay failure even when every value matches —
    // and `buildFinding` snapshots `rule.deadline` verbatim, so anything the parser hangs on the
    // deadline lands in the stored plan.
    const historical = JSON.parse(
      readFileSync(
        fileURLToPath(new URL("./__fixtures__/plaza-finding-nyc.v2.3.json", import.meta.url)),
        "utf8",
      ),
    );
    const v23 = parseEngineRuleset(
      JSON.parse(
        readFileSync(
          fileURLToPath(new URL("./__fixtures__/nyc-rules.v2.3.json", import.meta.url)),
          "utf8",
        ),
      ),
    );
    const plaza = evaluate(
      {
        ...parkIntake,
        location_type: "plaza",
        obstructs_public_way: "yes",
        sapo_event_type: "plaza_event",
        plaza_level: "b",
        plaza_multiple_blocks: true,
        amplified_sound: false,
      } as EventIntake,
      v23,
      TODAY,
      calendar,
    ).findings.find((finding) => finding.ruleIds.includes("SAPO-PLAZA-001"));

    expect(plaza).toEqual(historical);
    // Named explicitly, because equality above would also pass if the fixture were regenerated
    // from the new parser by mistake.
    expect(Object.keys(plaza?.deadline ?? {})).not.toContain("levelField");
    expect(Object.keys(plaza?.deadline ?? {})).not.toContain("multiBlockField");
  });

  it("keeps three-field rescopes when replaying a superseded ruleset era", () => {
    // F-102 enrichment (introducedRuleIds / at-risk slack) is current-line output shape. Evaluating
    // a recovered v2.3 artifact must keep the historical three-field suggestion serialization.
    const v23 = parseEngineRuleset(
      JSON.parse(
        readFileSync(
          fileURLToPath(new URL("./__fixtures__/nyc-rules.v2.3.json", import.meta.url)),
          "utf8",
        ),
      ),
    );
    const plan = evaluate(
      {
        ...parkIntake,
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
      } as EventIntake,
      v23,
      TODAY,
      calendar,
    );
    expect(plan.verdict).toBe("INFEASIBLE");
    expect(plan.verdictDetail.rescopeSuggestions.length).toBeGreaterThan(0);
    for (const suggestion of plan.verdictDetail.rescopeSuggestions) {
      expect(Object.keys(suggestion).sort()).toEqual([
        "change",
        "droppedRuleIds",
        "reevaluatedVerdict",
      ]);
    }
    // Historical eras keep discovery order, not the F-102 demonstration ladder sort.
    expect(plan.verdictDetail.rescopeSuggestions.map((s) => s.change.value)).not.toEqual([
      "medium",
      "small",
      "private_venue",
    ]);
  });

  it("omits conditional-boundary threshold enrichment on nyc.v2.3", () => {
    const v23 = parseEngineRuleset(
      JSON.parse(
        readFileSync(
          fileURLToPath(new URL("./__fixtures__/nyc-rules.v2.3.json", import.meta.url)),
          "utf8",
        ),
      ),
    );
    const result = evaluate(
      {
        ...parkIntake,
        location_type: "private_venue",
        amplified_sound: false,
        structure_types: ["tent_canopy"],
        tent_area_sqft: null,
        tent_days_in_place: 3,
        structure_over_10ft_tall: false,
      } as EventIntake,
      v23,
      TODAY,
      calendar,
    );
    const tentFact = result.verdictDetail.missingFacts.find(
      (fact) => fact.field === "tent_area_sqft",
    );
    expect(tentFact?.thresholds).toContain("DOB-TENT-001 applies above 400");
    expect(tentFact?.thresholds ?? "").not.toContain("conditional boundary");
  });

  it("requires the binding of any version that could have published it", () => {
    // The compatibility record is closed, not a default: a version not in it must declare the
    // fields. Without this the record would be the live constant the bump deleted, reachable by
    // any artifact that simply omits them.
    const v23 = JSON.parse(
      readFileSync(
        fileURLToPath(new URL("./__fixtures__/nyc-rules.v2.3.json", import.meta.url)),
        "utf8",
      ),
    );
    expect(() => parseEngineRuleset({ ...v23, ruleset_version: "nyc.v2.8" })).toThrow(
      /level_field/,
    );
  });
});
