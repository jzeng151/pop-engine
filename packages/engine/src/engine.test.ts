import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { PUBLISHED_RULES_FILE } from "./__fixtures__/published-ruleset";
import {
  addCalendarDays,
  countBusinessDays,
  differenceInCalendarDays,
  bindingRouteOf,
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

const calendarWindow = (days: number) => ({ type: "published_minimum", calendar_days: days });

const businessWindow = (days: number) => ({ type: "business_days_minimum", business_days: days });

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
    const unknownBlocker = {
      ...disposedRule("RULE-B", "PROHIBITED_OR_INELIGIBLE"),
      trigger: { all: [{ field: "structure_height_ft", op: "gte", value: 10 }] },
    };
    const group = [disposedRule("RULE-A", "REQUIRED"), unknownBlocker];
    const options = {
      intake: { structure_height_ft: null },
      extraFields: [{ field: "structure_height_ft", type: "integer" }],
    };
    expect(mergedGroup(group, options)?.disposition).toBe("required");
    expect(mergedGroup([...group].reverse(), options)?.disposition).toBe("required");
    expect(mergedGroup(group, options)?.ruleIds).toContain("RULE-B");
  });

  const conditionalBlocker = (id: string) => ({
    ...disposedRule(id, "PROHIBITED_OR_INELIGIBLE"),
    trigger: {
      all: [
        { field: "headcount", op: "gte", value: 10 },
        { field: "structure_height_ft", op: "gte", value: 10 },
      ],
    },
  });
  const unknownHeight = {
    intake: { structure_height_ft: null },
    extraFields: [{ field: "structure_height_ft", type: "integer" }],
  };

  it("keeps two conditional blockers on one key reading as the blocking answer they publish", () => {
    const group = [conditionalBlocker("RULE-A"), conditionalBlocker("RULE-B")];
    for (const listing of [group, [...group].reverse()]) {
      expect(mergedGroup(listing, unknownHeight)?.disposition).toBe("prohibited_or_ineligible");
    }
  });

  it("does not let an advisory on the same key demote a conditional blocker", () => {
    const group = [conditionalBlocker("RULE-A"), disposedRule("RULE-B", "ADVISORY")];
    for (const listing of [group, [...group].reverse()]) {
      expect(mergedGroup(listing, unknownHeight)?.disposition).toBe("prohibited_or_ineligible");
    }
  });

  it("does not let a resolved may_be_required on the same key demote a conditional blocker", () => {
    const group = [conditionalBlocker("RULE-A"), disposedRule("RULE-B", "MAY_BE_REQUIRED")];
    for (const listing of [group, [...group].reverse()]) {
      expect(mergedGroup(listing, unknownHeight)?.disposition).toBe("prohibited_or_ineligible");
    }
  });

  it("still caps a conditional blocker under a resolved required route", () => {
    const group = [conditionalBlocker("RULE-A"), disposedRule("RULE-B", "REQUIRED")];
    for (const listing of [group, [...group].reverse()]) {
      expect(mergedGroup(listing, unknownHeight)?.disposition).toBe("required");
    }
  });

  it("leaves a lone conditional blocker alone, because one route is not a merge", () => {
    expect(mergedGroup([conditionalBlocker("RULE-A")], unknownHeight)?.disposition).toBe(
      "prohibited_or_ineligible",
    );
  });

  it("keeps everything but the headline disposition when the blocker's trigger is unknown", () => {
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
    expect(merged?.disposition).toBe("required");
    expect(merged?.name).toBe("permit route");
    expect(merged?.ruleIds).toContain("RULE-B");
    expect(merged?.sources.map((source) => source.ruleId)).toContain("RULE-B");
    expect(merged?.triggeredBy.map((reason) => reason.field)).toContain("structure_height_ft");
    expect(merged?.noteText).toBe("not eligible above ten feet");
    expect(plan.verdictDetail.missingFacts.map((fact) => fact.field)).toContain(
      "structure_height_ft",
    );
    expect(plan.verdict).toBe("CONDITIONAL");
  });

  it("agrees with bindingRouteOf on which route binds", () => {
    const groups = [
      [
        disposedRule("RULE-Z", "REQUIRED", undefined, { permit_name: "no window" }),
        disposedRule("RULE-A", "REQUIRED", calendarWindow(45), { permit_name: "dated" }),
      ],
      [
        disposedRule("RULE-A", "REQUIRED", calendarWindow(20), { permit_name: "later" }),
        disposedRule("RULE-B", "REQUIRED", calendarWindow(60), { permit_name: "earlier" }),
      ],
      [
        disposedRule("RULE-Z", "REQUIRED", calendarWindow(45), { permit_name: "z" }),
        disposedRule("RULE-A", "REQUIRED", calendarWindow(45), { permit_name: "a" }),
      ],
      [
        disposedRule("RULE-A", "REQUIRED", calendarWindow(60), { permit_name: "permit route" }),
        disposedRule("RULE-B", "PROHIBITED_OR_INELIGIBLE", undefined, { permit_name: "barred" }),
      ],
    ];
    for (const rules of groups) {
      const merged = mergedGroup(rules);
      const routes = merged?.routes ?? [];
      expect(routes.length).toBeGreaterThan(1);
      expect(bindingRouteOf(routes)?.ruleId).toBe(routes[0]?.ruleId);
      expect(routes[0]?.ruleId).not.toBe(rules[0]?.id);
    }

    const plan = evaluate(
      {
        ...parkIntake,
        event_date: "2026-12-04",
        structure_types: ["tent_canopy"],
        tent_area_sqft: 500,
        tent_days_in_place: 2,
        structure_over_10ft_tall: "yes",
      } as EventIntake,
      ruleset,
      TODAY,
      calendar,
    );
    const merged = plan.findings.filter((finding) => (finding.routes?.length ?? 0) > 1);
    expect(merged.length).toBeGreaterThan(0);
    for (const finding of merged) {
      expect(bindingRouteOf(finding.routes ?? [])?.ruleId).toBe(finding.routes?.[0]?.ruleId);
    }
  });

  it("reads identity and timeline off one route, and keeps the other route's window", () => {
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
      feeDisplay: null,
      portalName: null,
      portalUrl: null,
      noteText: "not eligible at this location",
      latestApplyDate: null,
      deadlineStatus: "not_applicable",
      headlineMode: "applies_together",
    });
    expect(blocked?.deadline).toBeNull();
    expect(blocked?.routes).toMatchObject([
      {
        ruleId: "RULE-B",
        triggerResult: "true",
        disposition: "prohibited_or_ineligible",
        name: "barred route",
        latestApplyDate: null,
        deadlineStatus: "not_applicable",
        feeDisplay: null,
      },
      {
        ruleId: "RULE-A",
        triggerResult: "true",
        disposition: "required",
        name: "permit route",
        latestApplyDate: "2026-10-20",
        deadlineStatus: "on_track",
        feeDisplay: "$100",
        portalName: "permit portal",
      },
    ]);
  });

  const closedWindow = { intake: { event_date: "2026-08-02" } };

  it("keeps a closed window that a stronger disposition on the same key publishes none for", () => {
    const group = [
      disposedRule("RULE-A", "REQUIRED", calendarWindow(45), {
        permit_name: "closed route",
        fee: { display: "$500" },
      }),
      disposedRule("RULE-B", "PROHIBITED_OR_INELIGIBLE", undefined, {
        permit_name: "barred route",
      }),
    ];
    for (const listing of [group, [...group].reverse()]) {
      const merged = mergedGroup(listing, closedWindow);
      expect(merged).toMatchObject({
        disposition: "prohibited_or_ineligible",
        name: "barred route",
        feeDisplay: null,
        latestApplyDate: null,
        deadlineStatus: "not_applicable",
      });
      expect(merged?.routes?.map((route) => route.ruleId).sort()).toEqual(["RULE-A", "RULE-B"]);
      expect(merged?.routes?.find((route) => route.ruleId === "RULE-A")).toMatchObject({
        disposition: "required",
        name: "closed route",
        latestApplyDate: "2026-06-18",
        deadlineStatus: "published_deadline_missed",
        slackDays: -34,
        feeDisplay: "$500",
      });
    }
  });

  it("carries the closed window into the verdict at every tier the sweep found", () => {
    const missedThenStronger = (missed: string, stronger: string) =>
      evaluate(
        { event_date: "2026-08-02", headcount: 50 } as unknown as EventIntake,
        syntheticRuleset([
          disposedRule("RULE-A", missed, calendarWindow(45), { permit_name: "closed route" }),
          disposedRule("RULE-B", stronger, undefined, { permit_name: "later route" }),
        ]),
        TODAY,
        { id: "test-calendar@2026", holidays: [] },
      );
    const cases = [
      ["REQUIRED", "PROHIBITED_OR_INELIGIBLE", "INFEASIBLE"],
      ["MAY_BE_REQUIRED", "REQUIRED", "CONDITIONAL"],
      ["ADVISORY", "REQUIRED", "CONDITIONAL"],
    ] as const;
    for (const [missed, stronger, verdict] of cases) {
      const plan = missedThenStronger(missed, stronger);
      const closed = plan.findings[0]?.routes?.find((route) => route.ruleId === "RULE-A");
      expect(closed?.deadlineStatus).toBe("published_deadline_missed");
      expect(closed?.latestApplyDate).toBe("2026-06-18");
      expect(plan.verdictDetail.missedRuleIds).toContain("RULE-A");
      expect(plan.verdict).toBe(verdict);
    }
  });

  it("takes the earlier published filing window, whichever rule is listed first", () => {
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

  it("keeps a closed window over a route whose window the engine could not date", () => {
    const group = [
      disposedRule("RULE-A", "REQUIRED", calendarWindow(60), {
        permit_name: "permit with a closed window",
        fee: { display: "$500" },
      }),
      disposedRule(
        "RULE-B",
        "REQUIRED",
        { type: "research_required" },
        {
          permit_name: "permit whose lead time is unresearched",
        },
      ),
    ];
    const options = { intake: { event_date: "2026-08-20" } };
    for (const listing of [group, [...group].reverse()]) {
      expect(mergedGroup(listing, options)).toMatchObject({
        name: "permit with a closed window",
        deadlineStatus: "published_deadline_missed",
        latestApplyDate: "2026-06-21",
        feeDisplay: "$500",
      });
    }
  });

  it("keeps a closed window over an undatable one under the deployed calendar", () => {
    const group = [
      disposedRule("RULE-A", "REQUIRED", calendarWindow(60), {
        permit_name: "permit with a closed window",
      }),
      disposedRule("RULE-B", "REQUIRED", businessWindow(15), {
        permit_name: "permit the engine could not date",
      }),
    ];
    const options = { intake: { event_date: "2026-08-20" }, holidays: null };
    for (const listing of [group, [...group].reverse()]) {
      expect(mergedGroup(listing, options)).toMatchObject({
        name: "permit with a closed window",
        deadlineStatus: "published_deadline_missed",
        latestApplyDate: "2026-06-21",
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

  it("reads the merged heading off the binding order when the binding route publishes none", () => {
    const summary = (heading: string, id: string) => ({
      user_summary: {
        heading,
        points: [
          {
            kind: "overview",
            text: heading,
            sources: [{ label: "citation", url: `https://example.test/${id}` }],
          },
        ],
      },
    });
    const group = [
      disposedRule("RULE-Z", "REQUIRED", undefined, summary("Z heading", "RULE-Z")),
      disposedRule("RULE-M", "REQUIRED", undefined, summary("M heading", "RULE-M")),
      disposedRule("RULE-B", "REQUIRED", calendarWindow(45), { permit_name: "binding route" }),
    ];
    const swapped = [group[1], group[0], group[2]] as Record<string, unknown>[];
    for (const listing of [group, swapped]) {
      expect(mergedGroup(listing)).toMatchObject({
        name: "binding route",
        latestApplyDate: "2026-10-20",
      });
      expect(mergedGroup(listing)?.userSummary?.heading).toBe("M heading");
    }
  });

  it("renders the same merged finding whichever order the ruleset lists the group in", () => {
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

    expect(deployed?.noteText).toContain("over 10 feet may require");

    expect(merged([])).toMatchObject({
      disposition: "required",
      name: "DOB permit — tent/canopy over 400 gross sq ft or in place 30+ days",
      deadlineStatus: "on_track",
      latestApplyDate: "2026-11-13",
    });
  });

  it("sequences a gated rule that merged, wherever its group sits in the published file", () => {
    const publishedSound = (rawRuleset.rules as Record<string, unknown>[]).find(
      (rule) => rule.id === "NYPD-SOUND-001",
    ) as Record<string, unknown>;
    const alternativeRoute = publishedSound.trigger;
    const sequencedSound = (gatedFirst: boolean) => {
      const rules = (rawRuleset.rules as Record<string, unknown>[]).flatMap((rule) => {
        if (rule.id !== "NYPD-SOUND-001") return [rule];
        const gated = {
          ...rule,
          output: { ...(rule.output as Record<string, unknown>), dedupe_key: "nypd-sound" },
        };
        const alternative = {
          id: "NYPD-SOUND-ALT-001",
          kind: "permit",
          trigger: alternativeRoute,
          output: {
            permit_name: "Sound Device Permit (alternative route)",
            agency: "NYPD",
            dedupe_key: "nypd-sound",
          },
          verification: rule.verification,
          source: rule.source,
        };
        return gatedFirst ? [gated, alternative] : [alternative, gated];
      });
      return evaluate(
        { ...parkIntake, event_date: "2026-09-16" },
        parseEngineRuleset({ ...rawRuleset, rules }),
        TODAY,
        calendar,
      ).findings.find((finding) => finding.ruleIds.includes("NYPD-SOUND-001"));
    };

    const gatedFirst = sequencedSound(true);
    const alternativeFirst = sequencedSound(false);

    expect(gatedFirst?.applyAfterDate).not.toBeNull();
    expect(alternativeFirst?.applyAfterDate).toBe(gatedFirst?.applyAfterDate);
    expect(alternativeFirst?.slackDays).toBe(gatedFirst?.slackDays);
    expect(alternativeFirst?.notes.join(" ")).toContain("sequenced after PARKS-EVENT-001");
    expect(gatedFirst?.notes.join(" ")).toContain("sequenced after PARKS-EVENT-001");
  });
});

describe("a rule's kind decides its default disposition (product owner, 2026-08-08)", () => {
  const planForKind = (kind: string) =>
    evaluate(
      { event_date: "2026-12-04", headcount: 50 } as unknown as EventIntake,
      syntheticRuleset([
        {
          id: "KIND-001",
          kind,
          trigger: { all: [{ field: "headcount", op: "gte", value: 10 }] },
          output: { note_text: "the kind under test" },
          verification: { status: "SOURCE_CONFIRMED" },
          source: { citation: "citation KIND-001", urls: ["https://example.test/KIND-001"] },
        },
      ]),
      TODAY,
      { id: "test-calendar@2026", holidays: [] },
    );

  it("resolves `prohibition` with no published disposition to prohibited_or_ineligible", () => {
    const plan = planForKind("prohibition");
    expect(plan.findings[0]?.kind).toBe("prohibition");
    expect(plan.findings[0]?.disposition).toBe("prohibited_or_ineligible");
  });

  it("resolves `eligibility` with no published disposition to may_be_required", () => {
    expect(planForKind("eligibility").findings[0]?.disposition).toBe("may_be_required");
  });
});

describe("the published ruleset says `barred` in a field the engine reads", () => {
  it("finds no rule in the published ruleset that could carry the same error", () => {
    const published = rawRuleset.rules as Record<string, unknown>[];
    expect(published.filter((rule) => "severity" in rule)).toEqual([]);
    expect(
      published.filter((rule) => "status" in (rule.output as Record<string, unknown>)),
    ).toEqual([]);

    for (const finding of ["SAPO-BLOCK-PARTY-ELIG-001", "PARKS-PROPANE-001"]) {
      const rule = published.find((entry) => entry.id === finding) as Record<string, unknown>;
      const output = rule.output as Record<string, unknown>;
      expect(rule.kind === "prohibition" || output.disposition === "PROHIBITED_OR_INELIGIBLE").toBe(
        true,
      );
    }
  });
});

describe("a missed window blocks at or above `required` (F-102, amended 2026-08-08)", () => {
  const loneRule = (kind: string, disposition: string | undefined) => ({
    id: "LONE-001",
    kind,
    trigger: { all: [{ field: "headcount", op: "gte", value: 10 }] },
    output: {
      permit_name: "lone route",
      agency: "DOB",
      deadline: calendarWindow(45),
      ...(disposition === undefined ? {} : { disposition }),
    },
    verification: { status: "SOURCE_CONFIRMED" },
    source: { citation: "citation LONE-001", urls: ["https://example.test/LONE-001"] },
  });

  const closedWindowPlan = (kind: string, disposition?: string) =>
    evaluate(
      { event_date: "2026-08-02", headcount: 50 } as unknown as EventIntake,
      syntheticRuleset([loneRule(kind, disposition)]),
      TODAY,
      { id: "test-calendar@2026", holidays: [] },
    );

  it("blocks on a barred finding whose published window has closed", () => {
    const plan = closedWindowPlan("prohibition");
    expect(plan.findings[0]?.disposition).toBe("prohibited_or_ineligible");
    expect(plan.findings[0]?.deadlineStatus).toBe("published_deadline_missed");
    expect(plan.findings[0]?.latestApplyDate).toBe("2026-06-18");
    expect(plan.verdict).toBe("INFEASIBLE");

    expect(plan.verdictDetail.blockingFinding?.ruleIds).toEqual(["LONE-001"]);
    expect(plan.verdictDetail.missedRuleIds).toEqual(["LONE-001"]);
  });

  it("still blocks on a missed `required` finding, exactly as before", () => {
    const plan = closedWindowPlan("permit");
    expect(plan.findings[0]?.disposition).toBe("required");
    expect(plan.findings[0]?.deadlineStatus).toBe("published_deadline_missed");
    expect(plan.verdict).toBe("INFEASIBLE");
    expect(plan.verdictDetail.blockingFinding?.ruleIds).toEqual(["LONE-001"]);
  });

  it("leaves a missed finding below the bar conditional, exactly as before", () => {
    const plan = closedWindowPlan("permit", "MAY_BE_REQUIRED");
    expect(plan.findings[0]?.disposition).toBe("may_be_required");
    expect(plan.findings[0]?.deadlineStatus).toBe("published_deadline_missed");
    expect(plan.verdict).toBe("CONDITIONAL");
    expect(plan.verdictDetail.blockingFinding).toBeNull();
  });
});

describe("an unknown trigger never blocks, however barred the finding (F-102 AC 2)", () => {
  const barredRule = (trigger: Record<string, unknown>) => ({
    id: "BAR-001",
    kind: "prohibition",
    trigger,
    output: { permit_name: "barred route", agency: "DOB", deadline: calendarWindow(45) },
    verification: { status: "SOURCE_CONFIRMED" },
    source: { citation: "citation BAR-001", urls: ["https://example.test/BAR-001"] },
  });

  it("leaves a barred, missed finding conditional when the field cannot be enumerated", () => {
    const plan = evaluate(
      { event_date: "2026-08-02", headcount: "unknown" } as unknown as EventIntake,
      syntheticRuleset([barredRule({ all: [{ field: "headcount", op: "gte", value: 10 }] })]),
      TODAY,
      { id: "test-calendar@2026", holidays: [] },
    );

    expect(plan.findings[0]?.disposition).toBe("prohibited_or_ineligible");
    expect(plan.findings[0]?.deadlineStatus).toBe("published_deadline_missed");
    expect(plan.verdict).toBe("CONDITIONAL");
    expect(plan.verdictDetail.blockingFinding).toBeNull();

    expect(plan.verdictDetail.missingFacts.map((fact) => fact.field)).toEqual(["headcount"]);
    expect(plan.verdictDetail.missedRuleIds).toEqual(["BAR-001"]);
  });

  it("leaves it conditional when the field can be enumerated and the branches disagree", () => {
    const plan = evaluate(
      { event_date: "2026-08-02", headcount: 50, crowd_size: "unknown" } as unknown as EventIntake,
      syntheticRuleset(
        [
          barredRule({
            all: [
              { field: "headcount", op: "gte", value: 10 },
              { field: "crowd_size", op: "eq", value: "large" },
            ],
          }),
        ],
        [{ field: "crowd_size", type: "enum", values: ["small", "large"] }],
      ),
      TODAY,
      { id: "test-calendar@2026", holidays: [] },
    );
    expect(plan.findings[0]?.disposition).toBe("prohibited_or_ineligible");
    expect(plan.verdict).toBe("CONDITIONAL");
    expect(plan.verdictDetail.blockingFinding).toBeNull();

    expect(
      plan.verdictDetail.missingFacts[0]?.branches.map((branch) => [branch.value, branch.verdict]),
    ).toEqual([
      ["small", "FEASIBLE"],
      ["large", "INFEASIBLE"],
    ]);
  });

  it("does not block a merged line whose only barred route is the unresolved one", () => {
    const plan = evaluate(
      { event_date: "2026-08-02", headcount: 50, crowd_size: "unknown" } as unknown as EventIntake,
      syntheticRuleset(
        [
          {
            ...barredRule({
              all: [
                { field: "headcount", op: "gte", value: 10 },
                { field: "crowd_size", op: "eq", value: "large" },
              ],
            }),
            output: {
              permit_name: "barred route",
              agency: "DOB",
              deadline: calendarWindow(45),
              dedupe_key: "dob-structure",
            },
          },
          disposedRule("RULE-B", "ADVISORY", calendarWindow(45)),
        ],
        [{ field: "crowd_size", type: "enum", values: ["small", "large"] }],
      ),
      TODAY,
      { id: "test-calendar@2026", holidays: [] },
    );
    expect(plan.findings).toHaveLength(1);
    expect(plan.findings[0]?.disposition).toBe("prohibited_or_ineligible");

    expect(plan.findings[0]?.deadlineStatus).toBe("not_calculable");
    expect(plan.findings[0]?.latestApplyDate).toBeNull();
    expect(
      plan.findings[0]?.routes?.map((route) => [route.ruleId, route.deadlineStatus]),
    ).toContainEqual(["BAR-001", "published_deadline_missed"]);
    expect(plan.verdict).toBe("CONDITIONAL");
    expect(plan.verdictDetail.blockingFinding).toBeNull();
  });
});

describe("a resolved prohibition blocks independently of its window (F-102, amended 2026-08-12)", () => {
  const undatedBar = {
    id: "BAR-NODATE-001",
    kind: "prohibition",
    trigger: { all: [{ field: "headcount", op: "gte", value: 10 }] },
    output: { permit_name: "barred route", agency: "DOB", dedupe_key: "dob-structure" },
    verification: { status: "SOURCE_CONFIRMED" },
    source: { citation: "citation BAR-NODATE-001", urls: ["https://example.test/BAR-NODATE-001"] },
  };

  const datedRoute = {
    id: "RULE-B",
    kind: "permit",
    trigger: {
      all: [
        { field: "headcount", op: "gte", value: 10 },
        { field: "structure_height_ft", op: "gte", value: 20 },
      ],
    },
    output: {
      permit_name: "dated route",
      agency: "DOB",
      deadline: calendarWindow(45),
      dedupe_key: "dob-structure",
    },
    verification: { status: "SOURCE_CONFIRMED" },
    source: { citation: "citation RULE-B", urls: ["https://example.test/RULE-B"] },
  };

  const planWithHeight = (structureHeightFt: number | string) =>
    evaluate(
      {
        event_date: "2026-08-02",
        headcount: 50,
        structure_height_ft: structureHeightFt,
      } as unknown as EventIntake,
      syntheticRuleset(
        [undatedBar, datedRoute],
        [{ field: "structure_height_ft", type: "integer" }],
      ),
      TODAY,
      { id: "test-calendar@2026", holidays: [] },
    );

  const routeOf = (plan: ReturnType<typeof planWithHeight>, ruleId: string) =>
    plan.findings[0]?.routes?.find((route) => route.ruleId === ruleId);

  it("blocks on the resolved undated prohibition while another route's window is unresolved", () => {
    const plan = planWithHeight("unknown");
    expect(plan.findings).toHaveLength(1);

    expect(plan.findings[0]?.disposition).toBe("prohibited_or_ineligible");
    expect(plan.findings[0]?.deadlineStatus).toBe("not_applicable");
    expect(routeOf(plan, "RULE-B")?.deadlineStatus).toBe("published_deadline_missed");
    expect(routeOf(plan, "RULE-B")?.latestApplyDate).toBe("2026-06-18");

    expect(plan.verdict).toBe("INFEASIBLE");
    expect(plan.verdictDetail.blockingFinding?.ruleIds).toEqual(["BAR-NODATE-001"]);
    expect(plan.verdictDetail.blockingFinding?.deadlineStatus).toBe("not_applicable");
    expect(plan.verdictDetail.missedRuleIds).toEqual(["RULE-B"]);
  });

  it("still blocks once that same route resolves", () => {
    const plan = planWithHeight(30);
    expect(routeOf(plan, "RULE-B")?.deadlineStatus).toBe("published_deadline_missed");
    expect(plan.verdict).toBe("INFEASIBLE");

    expect(plan.verdictDetail.blockingFinding?.ruleIds).toEqual(["BAR-NODATE-001"]);
    expect(plan.verdictDetail.missedRuleIds).toEqual(["RULE-B"]);
  });

  const barredDatedRoute = {
    ...datedRoute,
    id: "BAR-DATED-001",
    kind: "prohibition",
    output: { ...datedRoute.output, permit_name: "barred dated route" },
  };

  const barredDatedPlan = (structureHeightFt: number | string) =>
    evaluate(
      {
        event_date: "2026-08-02",
        headcount: 50,
        structure_height_ft: structureHeightFt,
      } as unknown as EventIntake,
      syntheticRuleset([barredDatedRoute], [{ field: "structure_height_ft", type: "integer" }]),
      TODAY,
      { id: "test-calendar@2026", holidays: [] },
    );

  it("does not block on a barred route whose own trigger never resolved", () => {
    const plan = barredDatedPlan("unknown");

    expect(plan.findings[0]?.disposition).toBe("prohibited_or_ineligible");
    expect(plan.findings[0]?.deadlineStatus).toBe("published_deadline_missed");

    expect(plan.verdict).toBe("CONDITIONAL");
    expect(plan.verdictDetail.blockingFinding).toBeNull();
  });

  it("blocks on a barred route whose own trigger resolved and whose window has closed", () => {
    const plan = barredDatedPlan(30);
    expect(plan.findings[0]?.disposition).toBe("prohibited_or_ineligible");
    expect(plan.findings[0]?.deadlineStatus).toBe("published_deadline_missed");
    expect(plan.findings[0]?.latestApplyDate).toBe("2026-06-18");
    expect(plan.verdict).toBe("INFEASIBLE");

    expect(plan.verdictDetail.blockingFinding?.ruleIds).toEqual(["BAR-DATED-001"]);
    expect(plan.verdictDetail.blockingFinding?.latestApplyDate).toBe("2026-06-18");
  });
});

describe("an official conflict never closes a plan on its own (F-102)", () => {
  const conflictedRule = (kind: string, disposition?: string) => ({
    id: "CONFLICT-001",
    kind,
    trigger: { all: [{ field: "headcount", op: "gte", value: 10 }] },
    output: {
      permit_name: "conflicted route",
      agency: "DOB",
      deadline: calendarWindow(45),
      note_text: "One page says 45 days ahead; the FAQ says December 31 of the preceding year.",
      ...(disposition === undefined ? {} : { disposition }),
    },
    verification: { status: "OFFICIAL_CONFLICT" },
    source: { citation: "citation CONFLICT-001", urls: ["https://example.test/CONFLICT-001"] },
  });

  const closedWindowPlan = (kind: string, disposition?: string) =>
    evaluate(
      { event_date: "2026-08-02", headcount: 50 } as unknown as EventIntake,
      syntheticRuleset([conflictedRule(kind, disposition)]),
      TODAY,
      { id: "test-calendar@2026", holidays: [] },
    );

  it("leaves a barred, missed official conflict conditional", () => {
    const plan = closedWindowPlan("prohibition");
    expect(plan.findings[0]?.disposition).toBe("prohibited_or_ineligible");
    expect(plan.findings[0]?.deadlineStatus).toBe("published_deadline_missed");
    expect(plan.verdict).toBe("CONDITIONAL");
    expect(plan.verdictDetail.blockingFinding).toBeNull();

    expect(plan.findings[0]?.verificationStatus).toBe("OFFICIAL_CONFLICT");
    expect(plan.findings[0]?.conflictText).toBe(
      "One page says 45 days ahead; the FAQ says December 31 of the preceding year.",
    );
    expect(plan.verdictDetail.missedRuleIds).toEqual(["CONFLICT-001"]);
  });

  it("leaves a required, missed official conflict conditional as well", () => {
    const plan = closedWindowPlan("permit");
    expect(plan.findings[0]?.disposition).toBe("required");
    expect(plan.findings[0]?.deadlineStatus).toBe("published_deadline_missed");
    expect(plan.verdict).toBe("CONDITIONAL");
    expect(plan.verdictDetail.blockingFinding).toBeNull();
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
    const plan = evaluate({ ...parkIntake, event_date: "2026-08-16" }, ruleset, TODAY, calendar);
    const parks = plan.findings.find((finding) => finding.ruleIds.includes("PARKS-EVENT-001"));
    expect(parks?.deadlineStatus).toBe("deadline_approaching");
    expect(plan.verdict).toBe("FEASIBLE_AT_RISK");
  });

  it("keeps the Parks floor day itself inside the window", () => {
    const plan = evaluate({ ...parkIntake, event_date: "2026-08-12" }, ruleset, TODAY, calendar);
    const parks = plan.findings.find((finding) => finding.ruleIds.includes("PARKS-EVENT-001"));
    expect(parks?.latestApplyDate).toBe(TODAY);
    expect(parks?.slackDays).toBe(0);
    expect(parks?.deadlineStatus).not.toBe("published_deadline_missed");
    expect(plan.verdict).not.toBe("INFEASIBLE");
  });

  it("publishes no negative countdown when the sequence closes the window", () => {
    const plan = evaluate({ ...parkIntake, event_date: "2026-08-12" }, ruleset, TODAY, calendar);
    const sound = plan.findings.find((finding) => finding.ruleIds.includes("NYPD-SOUND-001"));

    expect(sound?.applyAfterDate).toBeNull();
    expect(sound?.notes.join(" ")).toContain("2026-08-12");
    expect(sound?.latestApplyDate).toBe("2026-08-07");
    expect(sound?.slackDays).toBeNull();
    expect(sound?.deadlineStatus).not.toBe("published_deadline_missed");
    expect(sound?.notes.join(" ")).toContain("leaves no window to file in");
    expect(sound?.notes.join(" ")).not.toContain("-5");

    expect(plan.verdictDetail.minSlackDays).toBe(0);
    expect(
      plan.findings.every((finding) => finding.slackDays === null || finding.slackDays >= 0),
      "no finding publishes a negative countdown",
    ).toBe(true);
  });

  it("does not call direct filing open once the gated permit's own deadline has passed", () => {
    const plan = evaluate({ ...parkIntake, event_date: "2026-07-26" }, ruleset, TODAY, calendar);
    const sound = plan.findings.find((finding) => finding.ruleIds.includes("NYPD-SOUND-001"));
    const notes = sound?.notes.join(" ") ?? "";

    expect(sound?.deadlineStatus).toBe("published_deadline_missed");
    expect(notes).toContain("leaves no window to file in");
    expect(notes).not.toContain("filing directly may still be open");
    expect(notes).toContain("confirm the order with the agency");

    const stillOpen = evaluate(
      { ...parkIntake, event_date: "2026-08-12" },
      ruleset,
      TODAY,
      calendar,
    ).findings.find((finding) => finding.ruleIds.includes("NYPD-SOUND-001"));
    expect(stillOpen?.notes.join(" ")).toContain("filing directly may still be open");
  });

  it("treats the first day past the Parks floor as on track", () => {
    const plan = evaluate({ ...parkIntake, event_date: "2026-08-13" }, ruleset, TODAY, calendar);
    const parks = plan.findings.find((finding) => finding.ruleIds.includes("PARKS-EVENT-001"));
    expect(parks?.latestApplyDate).toBe("2026-07-23");
    expect(parks?.slackDays).toBe(1);
    expect(parks?.deadlineStatus).not.toBe("published_deadline_missed");
    expect(plan.verdict).not.toBe("INFEASIBLE");
  });

  it("treats the day inside the Parks floor as missed", () => {
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
    const plan = evaluate(unknownLevelPlaza, ruleset, TODAY, calendar);
    expect(plan.verdict).toBe("CONDITIONAL");
    const levelFact = plan.verdictDetail.missingFacts.find((fact) => fact.field === "plaza_level");
    expect(levelFact?.branches.map((branch) => branch.value)).toEqual(["a", "b", "c", "d"]);
  });

  it("keeps an unknown level conditional even when every branch clears its window", () => {
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
    const onTheBoundary = assemblyIn("2026-08-01"); // TODAY is 2026-07-22: exactly 10 days out
    expect(onTheBoundary?.latestApplyDate).toBe("2026-07-21");
    expect(onTheBoundary?.deadlineStatus).toBe("published_deadline_missed");
  });

  it("stays missed inside the strict window", () => {
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

    expect(withDeadline({ type: "research_required", boundary: "exclusive" })).toThrow(
      /boundary does not apply to a "research_required" deadline/,
    );

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

  it("is distinguishable from the outer RangeError", () => {
    expect(() => addCalendarDays("1970-01-01", -100_000_000)).toThrow(EvaluationError);
    expect(() => addCalendarDays("1970-01-01", -100_000_001)).toThrow(RangeError);
    expect(() => addCalendarDays("1970-01-01", -100_000_001)).not.toThrow(EvaluationError);
  });

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

    expect(withLevelField(undefined)).toThrow(/"tier" is declared but no rule trigger, deadline/);

    expect(withLevelField(byLevel)).not.toThrow();

    expect(
      withLevelField({ ...byLevel, level_field: "grade" }, [
        { field: "grade", type: "enum", values: ["a", "b"], asked_when: "venue_kind = plaza" },
      ]),
    ).toThrow(/"tier" is declared but no rule trigger, deadline/);
  });

  it("counts deadline resolution and scoping as consuming a field", () => {
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
    expect(ruleset.rulesetVersion).toBe("nyc.v2.12");
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

    expect(fires("food_present = true", { food_present: true })).toBe(true);
    expect(fires("food_present = true", { food_present: false })).toBe(false);
    expect(fires("food_present != true", { food_present: false })).toBe(true);

    expect(fires("headcount = 75", { headcount: 75 })).toBe(true);
    expect(fires("headcount = 75", { headcount: 76 })).toBe(false);
    expect(fires("headcount != 75", { headcount: 76 })).toBe(true);

    expect(fires("sapo_event_type = street_event", { sapo_event_type: "street_event" })).toBe(true);
    expect(fires("sapo_event_type = street_event", { sapo_event_type: "block_party" })).toBe(false);
  });

  it("rejects a clause that names neither a declared field nor a declared value", () => {
    expect(withScoping("the_vibes_are_right")).toThrow(/names no declared field or value/);
  });

  it("rejects a cyclic scoping chain when the ruleset loads", () => {
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

describe("facts the ruleset publishes rather than the engine assuming (nyc.v2.4)", () => {
  const testCalendar: PublishedHolidayCalendar = { id: "test-calendar@2026", holidays: [] };
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
    const dateFor = (intake: Record<string, unknown>) =>
      evaluate(
        { event_date: "2026-10-01", ...intake } as unknown as EventIntake,
        plazaRuleset(byLevel),
        TODAY,
        testCalendar,
      ).findings[0]?.latestApplyDate;

    expect(dateFor({ tier: "gold", spans_two_sites: false })).toBe("2026-09-01"); // 30 days
    expect(dateFor({ tier: "silver", spans_two_sites: false })).toBe("2026-09-21"); // 10 days
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
    expect(() =>
      plazaRuleset({ ...byLevel, level_field: "grade" }, [
        { field: "grade", type: "enum", values: ["silver"] },
      ]),
    ).toThrow(/does not offer published level\(s\) gold/);
    expect(() => plazaRuleset({ ...byLevel, level_field: "nope" })).toThrow(
      /"nope" is not a declared intake field/,
    );
    expect(() => plazaRuleset({ ...byLevel, multi_block_field: "tier" })).toThrow(
      /is a enum field/,
    );
    expect(() =>
      plazaRuleset({ ...byLevel, level_field: "tiers" }, [
        { field: "tiers", type: "multi_enum", values: ["gold", "silver"] },
      ]),
    ).toThrow(/is a multi_enum field; a level deadline resolves one level per plan/);
  });

  it("refuses a multi-block field the resolver cannot read at every level that needs it", () => {
    expect(() =>
      plazaRuleset({ ...byLevel, multi_block_field: "gold_only_flag" }, [
        { field: "gold_only_flag", type: "boolean", asked_when: "tier = gold" },
      ]),
    ).toThrow(/is not asked for level\(s\) silver, which publish a multi-block window/);

    expect(() =>
      plazaRuleset({ ...byLevel, multi_block_field: "either_flag" }, [
        { field: "either_flag", type: "boolean", asked_when: "tier in gold/silver" },
      ]),
    ).not.toThrow();

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
        rulesMatch:
          JSON.stringify(reached(before.findings)) === JSON.stringify(reached(afterFindings)),
        windowsMatch:
          JSON.stringify(windows(before.findings)) === JSON.stringify(windows(afterFindings)),
        verdict: before.verdict,
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

    const tentOnBoundary = replays({
      ...parkIntake,
      location_type: "private_venue",
      amplified_sound: false,
      structure_types: ["tent_canopy"],
      tent_area_sqft: 400,
      tent_days_in_place: 3,
    } as EventIntake);
    expect(tentOnBoundary).toMatchObject({
      verdictMatches: true,
      rulesMatch: true,
      windowsMatch: false,
      findingsMatch: false,
    });
    expect(tentOnBoundary.windowFor("DOB-ASSEMBLY-001")).toEqual({
      before: "2026-09-05:on_track",
      after: "2026-09-02:on_track",
    });
    expect(tentOnBoundary.windowFor("DOB-TENT-001")).toEqual({
      before: "2026-08-26:on_track",
      after: "2026-08-26:on_track",
    });
    expect(tentOnBoundary.verdict).toBe("CONDITIONAL");

    expect(replays(parkIntake)).toMatchObject({
      verdictMatches: true,
      findingsMatch: true,
      rulesMatch: true,
      windowsMatch: true,
    });
  });

  it("never dates a level deadline from a field the plan was not asked", () => {
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

    const flagScoped = scoped([
      { field: "spans", type: "boolean", asked_when: "tier in gold/silver AND enabled" },
    ]);
    const unreachableFlag = plan(flagScoped, { tier: "gold", enabled: false });
    const flagFinding = unreachableFlag.findings[0];
    expect(flagFinding?.latestApplyDate).toBeNull();
    expect(flagFinding?.deadlineStatus).toBe("not_calculable");
    expect(flagFinding?.timelineUnresolvedReason).toContain("never asked spans");
    expect(unreachableFlag.verdict).toBe("CONDITIONAL");
    expect(
      plan(flagScoped, { tier: "gold", enabled: true, spans: true }).findings[0]?.latestApplyDate,
    ).toBe("2026-08-02");

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
    expect(unreachableLevel.findings[0]?.disposition).toBe("required");
    expect(unreachableLevel.verdict).toBe("CONDITIONAL");

    expect(unreachableLevel.verdictDetail.missingFacts).toHaveLength(0);
    expect(unreachableLevel.verdictDetail.unresolvedTimelines).toHaveLength(1);
  });

  it("reproduces a v2.3 plaza finding in the shape v2.3 serialised it", () => {
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
    expect(Object.keys(plaza?.deadline ?? {})).not.toContain("levelField");
    expect(Object.keys(plaza?.deadline ?? {})).not.toContain("multiBlockField");
  });

  it("keeps three-field rescopes when replaying a superseded ruleset era", () => {
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
