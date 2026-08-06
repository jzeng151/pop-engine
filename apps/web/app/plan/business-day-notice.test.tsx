// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import {
  CONFIRM_WITH_AGENCY,
  evaluate,
  parseEngineRuleset,
  type EventIntake,
  type Finding,
} from "@pop-engine/engine";
import { publishedRulesFileIn } from "../rules-file";
import { loadPlan } from "./plan-api";
import { PlanLine } from "./plan-line";

// The apply-by line for a published business-day window production cannot date.
//
// EVALUATED, NOT HAND-BUILT. The findings under test come from the engine running over
// `rules/nyc-rules.v2.11.json` with `holidays: null`, which is the PRODUCTION configuration:
// `PUBLISHED_HOLIDAY_CALENDARS` in `apps/api/src/calendar.ts` is empty by decision
// (SPEC-CONFLICT #130), so `pinnedCalendar` hands the engine a null list and every
// `business_days_minimum` deadline renders `not_calculable`. A fixture with an empty list would
// compute a date instead and prove nothing about what an organizer sees.
//
// Each finding then travels the wire the way a stored plan does: serialized, read back through
// `loadPlan`'s validator and normalizer, and rendered. What is asserted is the text on screen.

const ruleset = parseEngineRuleset(
  JSON.parse(readFileSync(resolve(publishedRulesFileIn("rules")), "utf8")),
);

/** Production: no holiday list is published for the pinned calendar. */
const productionCalendar = { id: ruleset.calendarId, holidays: null };

const TODAY = "2026-07-22";

/**
 * One event that triggers all four rules carrying a `business_days_minimum` deadline: a large
 * private-venue party with a tent over the published 400 square feet and alcohol the venue's own
 * license does not cover.
 */
const intake: EventIntake = {
  borough: "manhattan",
  location_type: "private_venue",
  headcount: 90,
  event_date: "2026-09-30",
  event_open_to_public: "no",
  food_present: false,
  selling_anything: false,
  amplified_sound: false,
  structure_types: ["tent_canopy"],
  tent_area_sqft: 500,
  tent_days_in_place: 3,
  open_flame_or_cooking: ["none"],
  generator_present: false,
  battery_present: false,
  alcohol: true,
  venue_license_covers_event_area: "no",
};

const evaluated = evaluate(intake, ruleset, TODAY, productionCalendar);

const findingFor = (ruleId: string): Finding => {
  const finding = evaluated.findings.find((candidate) => candidate.ruleIds.includes(ruleId));
  if (finding === undefined) throw new Error(`this intake produced no finding for ${ruleId}`);
  return finding;
};

const storedPlanWith = (findings: readonly unknown[]) => ({
  eventRevision: 1,
  rulesetVersion: ruleset.rulesetVersion,
  snapshotDate: ruleset.snapshotDate,
  verdict: "CONDITIONAL",
  verdictDetail: {
    blockingFinding: null,
    missedRuleIds: [],
    minSlackDays: null,
    missingFacts: [],
    unresolvedTimelines: [],
    rescopeSuggestions: [],
  },
  generatedAt: "2026-07-22T12:00:00.000Z",
  // The two members the api fills in on the way out (`apps/api/src/plan.ts`), so this body is the
  // one the page actually receives rather than the engine's internal finding.
  findings: findings.map((finding) => {
    const served = finding as Record<string, unknown>;
    return {
      ...served,
      lastVerifiedDate: served.lastVerifiedDate ?? null,
      userSummary: served.userSummary ?? null,
    };
  }),
});

/**
 * The finding as the page receives it: through the api's JSON and this feature's own validator, so
 * a member the projection drops cannot reach the assertion by another route.
 */
const asServed = async (finding: unknown) => {
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(JSON.stringify(storedPlanWith([finding])), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    ),
  );
  const result = await loadPlan("https://api.example.com", "event-1");
  if (!result.ok) throw new Error(`the served plan was unreadable: ${result.message}`);
  const served = result.plan.findings[0];
  if (served === undefined) throw new Error("the served plan carried no finding");
  return served;
};

/** The summary's apply-by point, whichever of the two lines rendered. */
const applyByLine = async (finding: unknown): Promise<string> => {
  const { container } = render(<PlanLine finding={await asServed(finding)} />);
  const line = [...container.querySelectorAll("li.line__point")].find((item) =>
    /^(Apply by|Exact apply-by date):/.test(item.textContent ?? ""),
  );
  if (line === undefined) throw new Error("the plan line rendered no apply-by point");
  return line.textContent ?? "";
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("a published business-day window with no computable date", () => {
  it("states what DOB-TENT-001's exact date depends on, and who to ask", async () => {
    const tent = findingFor("DOB-TENT-001");
    // The production configuration, restated at the assertion: no date, and a window that exists.
    expect(tent.deadlineStatus).toBe("not_calculable");
    expect(tent.latestApplyDate).toBeNull();

    expect(await applyByLine(tent)).toContain(
      "Apply by: the exact date depends on which days DOB counts as business days. " +
        "Allow more if it closes for holidays. Confirm with DOB.",
    );
  });

  it("names the State Liquor Authority as a sentence subject on both SLA rules", async () => {
    for (const ruleId of ["SLA-ONEDAY-001", "SLA-CATERING-001"]) {
      expect(await applyByLine(findingFor(ruleId))).toContain(
        "Apply by: the exact date depends on which days the NY State Liquor Authority counts as " +
          "business days. Allow more if it closes for holidays. " +
          "Confirm with the NY State Liquor Authority.",
      );
      cleanup();
    }
  });

  it("states no count, so it cannot restate a disputed one without its qualification", async () => {
    // The window is on the qualified line above this one, where its source's qualification travels
    // with it. Both SLA rules record the unit as in conflict across three official sources, so an
    // unqualified "at least 15 business days" here would read as settled. This line carries no
    // digit at all, which is the property that makes that impossible rather than merely unlikely.
    for (const ruleId of ["DOB-TENT-001", "SLA-ONEDAY-001", "SLA-CATERING-001"]) {
      const line = await applyByLine(findingFor(ruleId));
      const applyBy = line.slice(line.indexOf("Apply by:"));
      expect(applyBy).not.toMatch(/\d/);
      expect(applyBy).not.toContain("business days before your event");
      cleanup();
    }
  });

  it("claims nothing about what any agency publishes", async () => {
    // `docs/VERIFICATION-SOURCES.md` scopes the DOB result to NOT PUBLISHED from the Pass B source
    // set and leaves the SLA closure question NOT ASSESSED. "No source we consulted defines it" is
    // not "the agency does not publish it", and this sentence says neither.
    for (const ruleId of ["DOB-TENT-001", "SLA-ONEDAY-001", "SLA-CATERING-001"]) {
      expect(await applyByLine(findingFor(ruleId))).not.toContain("does not publish");
      cleanup();
    }
  });

  it("keeps the previous line for DOB-ASSEMBLY-001, whose agency names two agencies", async () => {
    // "DOB (+ FDNY Public Assembly Permit)" does not read as the subject of "<agency> counts as
    // business days", and shortening it here would drop half of a published field. The line falls
    // back rather than reading ungrammatically; the fix belongs in the ruleset, not here.
    const assembly = findingFor("DOB-ASSEMBLY-001");
    expect(assembly.agency).toBe("DOB (+ FDNY Public Assembly Permit)");

    expect(await applyByLine(assembly)).toContain(
      `Exact apply-by date: not calculable — ${CONFIRM_WITH_AGENCY}`,
    );
  });

  it("renders DOB-ASSEMBLY-001's new line as soon as the ruleset publishes agency as DOB", async () => {
    // The separately approved ruleset correction sets this rule's `agency` to "DOB" and names FDNY
    // where the rule already discusses it. Nothing in this module has to change when it lands: the
    // published string is the only input, and "DOB" is already in the table. This stands in for
    // that ruleset state so the claim is checked rather than asserted in a comment.
    const corrected = { ...findingFor("DOB-ASSEMBLY-001"), agency: "DOB" };

    expect(await applyByLine(corrected)).toContain(
      "Apply by: the exact date depends on which days DOB counts as business days. " +
        "Allow more if it closes for holidays. Confirm with DOB.",
    );
  });

  it("never repeats the unresolved reason's prose or the internal calendar id", async () => {
    // `timelineUnresolvedReason` was written for the verdict's unresolved-timeline record and names
    // the internal calendar id. It is not parsed, not changed, and never reaches the organizer.
    const tent = findingFor("DOB-TENT-001");
    expect(tent.timelineUnresolvedReason).toContain(ruleset.calendarId);
    expect(await applyByLine(tent)).not.toContain(ruleset.calendarId);
  });
});

describe("the cases this copy must not reach", () => {
  it("never states a window for a research_required deadline", async () => {
    // No agency published a lead time at all, so there is no window to state. This is the same
    // `not_calculable` status arrived at from a different cause.
    const researchRequired = {
      ...findingFor("DOB-TENT-001"),
      deadline: { type: "research_required", display: null, boundary: "inclusive" },
      timelineUnresolvedReason: null,
    };

    const line = await applyByLine(researchRequired);
    expect(line).toContain(`Exact apply-by date: not calculable — ${CONFIRM_WITH_AGENCY}`);
    expect(line).not.toContain("business days before your event");
  });

  it("never states a window when an unanswered intake field is what blocked the date", async () => {
    // SAPO-PLAZA-001's unknown level: a real published window, but by level and in calendar days.
    const unknownLevel = {
      ...findingFor("DOB-TENT-001"),
      deadline: { type: "published_minimum_by_level", boundary: "inclusive" },
      deadlineUnknownFields: ["plaza_level"],
      timelineUnresolvedReason: null,
    };

    expect(await applyByLine(unknownLevel)).not.toContain("business days before your event");
  });
});

describe("a plan stored by an older build", () => {
  it("renders the full line from a deadline carrying nothing but its published type", async () => {
    // This feature reads one member of a stored deadline, `type`, which every stored plan has
    // carried since the field existed. There is no new member that could be missing, so a plan
    // stored before this change gets the same sentence a fresh one gets rather than a fallback, a
    // blank, or a sentence with a hole in it. The deadline here is stripped to that one member to
    // prove the page needs nothing else.
    const stored = findingFor("DOB-TENT-001");
    const bareDeadline = { ...stored, deadline: { type: "business_days_minimum" } };

    const served = await asServed(bareDeadline);
    expect(served.deadline).toEqual({ type: "business_days_minimum" });

    expect(await applyByLine(bareDeadline)).toContain(
      "Apply by: the exact date depends on which days DOB counts as business days. " +
        "Allow more if it closes for holidays. Confirm with DOB.",
    );
  });
});
