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

/**
 * The same event with the structure height answered "no", which is the ONLY difference.
 *
 * DOB-TENT-001 shares `dedupe_key` "dob-structure" with DOB-TALL-STRUCTURE-001, whose trigger reads
 * `structure_over_10ft_tall`. That field is unanswered above, so the trigger is tri-state unknown,
 * the rule fires MAY_BE_REQUIRED and the two merge. Answering "no" resolves it to false, the rule
 * does not fire, and DOB-TENT-001 is a single-route finding. Both states are real production states
 * and both are asserted below: the merged one gets the previous line, this one gets the new
 * sentence.
 */
const heightAnswered: EventIntake = { ...intake, structure_over_10ft_tall: "no" };

const evaluated = evaluate(intake, ruleset, TODAY, productionCalendar);
const evaluatedAlone = evaluate(heightAnswered, ruleset, TODAY, productionCalendar);

const findIn = (plan: typeof evaluated, ruleId: string): Finding => {
  const finding = plan.findings.find((candidate) => candidate.ruleIds.includes(ruleId));
  if (finding === undefined) throw new Error(`this intake produced no finding for ${ruleId}`);
  return finding;
};

const findingFor = (ruleId: string): Finding => findIn(evaluated, ruleId);

/** DOB-TENT-001 with no route merged into it, off the height-answered evaluation. */
const tentAlone = (): Finding => findIn(evaluatedAlone, "DOB-TENT-001");

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

/**
 * The summary's apply-by point, whichever of the two lines rendered, SPLIT FROM ITS CITATION.
 *
 * The citation renders inside the same `<li>`, so a helper that returned `textContent` would fold
 * the source label into the sentence and every `toContain` assertion would pass whether a citation
 * was attached or not. The two are separated here so the citation is something a test can assert
 * ON rather than something it swallows: `sentence` is the point with the citation span removed, and
 * `citation` is that span's text, or null when the line carries none.
 */
const applyBy = async (
  finding: unknown,
): Promise<{ readonly sentence: string; readonly citation: string | null }> => {
  const { container } = render(<PlanLine finding={await asServed(finding)} />);
  const line = [...container.querySelectorAll("li.line__point")].find((item) =>
    /^(Apply by|Exact apply-by date):/.test(item.textContent ?? ""),
  );
  if (line === undefined) throw new Error("the plan line rendered no apply-by point");
  const citation = line.querySelector(".line__point-sources")?.textContent ?? null;
  const withoutCitation = line.cloneNode(true) as Element;
  withoutCitation.querySelector(".line__point-sources")?.remove();
  return { sentence: withoutCitation.textContent ?? "", citation };
};

/** The apply-by sentence alone, for the assertions that are about the wording. */
const applyByLine = async (finding: unknown): Promise<string> => (await applyBy(finding)).sentence;

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("a published business-day window with no computable date", () => {
  it("states what DOB-TENT-001's exact date depends on, and who to ask", async () => {
    const tent = tentAlone();
    // The production configuration, restated at the assertion: no date, and a window that exists.
    expect(tent.deadlineStatus).toBe("not_calculable");
    expect(tent.latestApplyDate).toBeNull();
    // One route, so the agency beside the window is the agency of the rule that published it.
    expect(tent.ruleIds).toEqual(["DOB-TENT-001"]);

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
    for (const finding of [
      tentAlone(),
      findingFor("SLA-ONEDAY-001"),
      findingFor("SLA-CATERING-001"),
    ]) {
      const line = await applyByLine(finding);
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
    for (const finding of [
      tentAlone(),
      findingFor("SLA-ONEDAY-001"),
      findingFor("SLA-CATERING-001"),
    ]) {
      expect(await applyByLine(finding)).not.toContain("does not publish");
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

  it("cites no source under a sentence about business-day counting", async () => {
    // The sources on this point are the deadline summary point's: `tup.page` for DOB-TENT-001 and
    // `sla.ny.gov/permits-available-online` for both SLA rules. This sentence is about which days an
    // agency counts, and `docs/VERIFICATION-SOURCES.md` records that none of those pages defines
    // "business day" (:251, :276, :283) and lists a definition of the unit for any of the three
    // examined rules under Not established (:294). So an organizer following the link would find a
    // page that says nothing of the kind, and the line carries no link at all.
    for (const finding of [
      tentAlone(),
      findingFor("SLA-ONEDAY-001"),
      findingFor("SLA-CATERING-001"),
    ]) {
      const { sentence, citation } = await applyBy(finding);
      expect(sentence).toContain("counts as business days");
      expect(citation).toBeNull();
      cleanup();
    }
  });

  it("keeps the citation on the fallback line, which asserts nothing a source must carry", async () => {
    // The omission above is specific to the new sentence, not a decision to stop citing the
    // deadline point. "not calculable, confirm with agency" makes no claim about the unit, so its
    // attribution stays where it has always been.
    const { citation } = await applyBy(findingFor("DOB-ASSEMBLY-001"));
    expect(citation).toContain("Sources:");
    expect(citation).toContain("DOB TPA filing page");
  });

  it("never repeats the unresolved reason's prose or the internal calendar id on the apply-by line", async () => {
    // `timelineUnresolvedReason` was written for the verdict's unresolved-timeline record and names
    // the internal calendar id. This module does not parse it and does not change it, and the
    // summary apply-by line does not restate it. THAT IS THE WHOLE CLAIM. The string does reach the
    // organizer elsewhere on the same page, verbatim: `plan-line.tsx` renders it inside the
    // disclosure, and `verdict-detail.tsx` renders it in the "What still depends on dating" panel
    // above the plan lines. Both predate this line and neither is in this change's scope.
    const tent = tentAlone();
    expect(tent.timelineUnresolvedReason).toContain(ruleset.calendarId);
    expect(await applyByLine(tent)).not.toContain(ruleset.calendarId);
  });
});

describe("a merged dedupe line, whose agency and window need not come from one route", () => {
  // `findings.ts:407-411` takes `agency` from `identityBinding` and `deadline`/`deadlineStatus`
  // from `windowBinding`, and `findings.ts:328-330` records that the two coincide in every group
  // nyc.v2.11 publishes without bounding what a future group can do. This sentence combines exactly
  // those two fields, so on a merged finding it cannot be shown to name the agency that published
  // the window. It falls back to the line that asserts nothing.

  it("gets the previous line when more than one rule contributed to it", async () => {
    // The same DOB-TENT-001, on the intake that leaves the structure height unanswered:
    // DOB-TALL-STRUCTURE-001's trigger goes tri-state unknown, the rule fires, and the two merge on
    // `dedupe_key` "dob-structure". Today both publish "DOB" and the suppressed sentence would have
    // been correct; the guard does not depend on knowing that, which is the point of it.
    const merged = findingFor("DOB-TENT-001");
    expect(merged.ruleIds).toEqual(["DOB-TENT-001", "DOB-TALL-STRUCTURE-001"]);
    expect(merged.deadline?.type).toBe("business_days_minimum");
    expect(merged.deadlineStatus).toBe("not_calculable");

    expect(await applyByLine(merged)).toContain(
      `Exact apply-by date: not calculable — ${CONFIRM_WITH_AGENCY}`,
    );
  });

  it("never names an agency that did not publish the window it is standing next to", async () => {
    // The state the split allows and no published ruleset reaches yet: a group whose window comes
    // from DOB-TENT-001 and whose headline disposition, and therefore `agency`, comes from a route
    // of another agency. A `dedupe_key` edit alone reaches it, and #239 and #244 both record a
    // dedupe-key edit moving rendered output with no code change. Built by overwriting the merged
    // agency, because the merge is what would supply it.
    const crossAgency = {
      ...findingFor("DOB-TENT-001"),
      agency: "NY State Liquor Authority",
    };

    const { sentence, citation } = await applyBy(crossAgency);
    expect(sentence).toContain(`Exact apply-by date: not calculable — ${CONFIRM_WITH_AGENCY}`);
    expect(sentence).not.toContain("the NY State Liquor Authority counts as business days");
    expect(sentence).not.toContain("Confirm with the NY State Liquor Authority.");
    // The fallback line keeps its attribution: it claims nothing the sources must carry.
    expect(citation).toContain("DOB Temporary Use Permit page");
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
    const stored = tentAlone();
    const bareDeadline = { ...stored, deadline: { type: "business_days_minimum" } };

    const served = await asServed(bareDeadline);
    expect(served.deadline).toEqual({ type: "business_days_minimum" });

    expect(await applyByLine(bareDeadline)).toContain(
      "Apply by: the exact date depends on which days DOB counts as business days. " +
        "Allow more if it closes for holidays. Confirm with DOB.",
    );
  });
});
