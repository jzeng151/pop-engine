// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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

const rawRuleset: unknown = JSON.parse(
  readFileSync(resolve(publishedRulesFileIn("rules")), "utf8"),
);
const ruleset = parseEngineRuleset(rawRuleset);

/**
 * The three published members the dedupe-group invariant reads, off the RAW file rather than the
 * parsed ruleset: `dedupe_key` is what groups the routes and the parsed shape does not surface it.
 */
type RawRule = {
  readonly id: string;
  readonly output?: {
    readonly agency?: string;
    readonly dedupe_key?: string;
    readonly deadline?: { readonly type?: string };
  };
};

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
 * does not fire, and DOB-TENT-001 is a single-route finding. Both states are real production states,
 * both are asserted below, and both get the sentence: the two routes publish one agency, which the
 * published-ruleset invariant further down is what keeps true.
 */
const heightAnswered: EventIntake = { ...intake, structure_over_10ft_tall: "no" };

/**
 * The same event with the height answered "yes" and the tent's own size and duration unanswered,
 * which is the state where the OTHER route binds the merged line.
 *
 * DOB-TALL-STRUCTURE-001's trigger resolves true and it publishes MAY_BE_REQUIRED with no deadline
 * at all. DOB-TENT-001's trigger goes tri-state unknown, so its `required` is demoted to
 * `may_be_required` on its own finding, the binding route is taken from the resolved subset, and
 * that subset holds only the tall route. The merged line therefore carries the tall route's
 * scalars: no deadline, `not_applicable`, no date. The published 15-business-day window is on the
 * tent route, where the deployed null holiday calendar leaves it `not_calculable`.
 */
const tallStructureBinds: EventIntake = {
  ...intake,
  structure_over_10ft_tall: "yes",
  tent_area_sqft: null,
  tent_days_in_place: null,
};

const evaluated = evaluate(intake, ruleset, TODAY, productionCalendar);
const evaluatedAlone = evaluate(heightAnswered, ruleset, TODAY, productionCalendar);
const evaluatedTallBinding = evaluate(tallStructureBinds, ruleset, TODAY, productionCalendar);

const findIn = (plan: typeof evaluated, ruleId: string): Finding => {
  const finding = plan.findings.find((candidate) => candidate.ruleIds.includes(ruleId));
  if (finding === undefined) throw new Error(`this intake produced no finding for ${ruleId}`);
  return finding;
};

const findingFor = (ruleId: string): Finding => findIn(evaluated, ruleId);

/**
 * A published deadline swapped onto a merged line AND onto its binding route, because those are one
 * rule's value: `mergeGroup()` spreads the binding route into the finding, and the plan boundary
 * refuses a body where the headline and `routes[0]` disagree. Changing only the finding builds a
 * line no api can serve.
 */
const withBindingDeadline = (finding: Finding, deadline: unknown): Finding =>
  ({
    ...finding,
    deadline,
    timelineUnresolvedReason: null,
    ...(finding.routes === undefined
      ? {}
      : {
          routes: finding.routes.map((route, index) =>
            index === 0 ? { ...route, deadline } : route,
          ),
        }),
  }) as Finding;

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

describe("a merged dedupe line, and the routes whose windows it did not take", () => {
  // `findings.ts:481-482` now takes identity and timeline both off the binding route, so the agency
  // and the window this sentence combines are one rule's on the merged line and one rule's on every
  // route entry. The published-ruleset invariant below is kept as the artifact-level check it
  // already was: a `dedupe_key` edit is the event that moves rendered output with no code change.

  it("gets the same sentence when a second route merged into it", async () => {
    // The same DOB-TENT-001, on the intake that leaves the structure height unanswered:
    // DOB-TALL-STRUCTURE-001's trigger goes tri-state unknown, the rule fires, and the two merge on
    // `dedupe_key` "dob-structure". Both routes publish "DOB", so the merged agency is DOB whichever
    // route bound it, and the organizer of a tented event with an unanswered height gets the
    // approved line rather than the one it replaces. Scenario E is that event.
    const merged = findingFor("DOB-TENT-001");
    expect(merged.ruleIds).toEqual(["DOB-TENT-001", "DOB-TALL-STRUCTURE-001"]);
    expect(merged.deadline?.type).toBe("business_days_minimum");
    expect(merged.deadlineStatus).toBe("not_calculable");

    expect(await applyByLine(merged)).toContain(
      "Apply by: the exact date depends on which days DOB counts as business days. " +
        "Allow more if it closes for holidays. Confirm with DOB.",
    );
  });

  it("carries the sentence on the route whose window it is, when another route binds", async () => {
    // F-201 AC 13 on the entry that has the undatable window. The merged line's scalars are
    // DOB-TALL-STRUCTURE-001's, and that rule publishes no deadline at all, so the line-level
    // sentence does not apply and must not render. DOB-TENT-001's 15-business-day window is on its
    // route entry, undatable for the same deployed reason as everywhere else in this file, and
    // before this the entry said "not calculable" and nothing more (#252 review).
    const merged = findIn(evaluatedTallBinding, "DOB-TENT-001");
    expect(merged.ruleIds).toContain("DOB-TALL-STRUCTURE-001");
    expect(merged.deadline).toBeNull();
    expect(merged.deadlineStatus).toBe("not_applicable");
    const tent = merged.routes?.find((route) => route.ruleId === "DOB-TENT-001");
    expect(tent?.deadline?.type).toBe("business_days_minimum");
    expect(tent?.deadlineStatus).toBe("not_calculable");
    expect(tent?.latestApplyDate).toBeNull();

    const { container } = render(<PlanLine finding={await asServed(merged)} />);
    const entry = [...container.querySelectorAll("li.line__route")].find((item) =>
      item.textContent?.includes("tent/canopy"),
    );
    if (entry === undefined) throw new Error("the routes block rendered no DOB-TENT-001 entry");
    expect(entry.querySelector(".line__route-deadline-notice")?.textContent).toBe(
      "Apply by: the exact date depends on which days DOB counts as business days. " +
        "Allow more if it closes for holidays. Confirm with DOB.",
    );
    // The state the entry reports is unchanged: this is still `not_calculable`, said beside the
    // sentence rather than replaced by it, which is how the pre-summary line renders the same pair.
    expect(entry.querySelector(".line__route-deadline")?.textContent).toContain("not calculable");
    // And the sentence renders once, on that entry. The line's own window is the tall route's and
    // there is none, so neither the summary's apply-by point nor the pre-summary notice appears.
    expect(container.querySelector(".line__deadline-notice")).toBeNull();
    expect(
      [...container.querySelectorAll("li.line__point")].filter((item) =>
        /^(Apply by|Exact apply-by date):/.test(item.textContent ?? ""),
      ),
    ).toEqual([]);
  });

  it("holds the published ruleset to one agency per business-day dedupe group", () => {
    // THE GUARANTEE THIS SENTENCE RESTS ON, checked against the published file rather than argued
    // in a comment. A `dedupe_key` edit alone reaches a group whose window comes from one agency's
    // rule and whose headline disposition, and therefore `agency`, comes from another's; #239 and
    // #244 both record a dedupe-key edit moving rendered output with no code change, so an artifact
    // edit is exactly the event this has to fail on. Stated over every group rather than over
    // `dob-structure`, so a NEW group carrying a business-day deadline is covered the day it is
    // published.
    const rules = (rawRuleset as { rules: readonly RawRule[] }).rules;
    const groups = new Map<string, RawRule[]>();
    for (const rule of rules) {
      const key = rule.output?.dedupe_key;
      if (typeof key !== "string") continue;
      groups.set(key, [...(groups.get(key) ?? []), rule]);
    }

    const crossAgency = [...groups]
      .filter(([, group]) =>
        group.some((rule) => rule.output?.deadline?.type === "business_days_minimum"),
      )
      .filter(
        ([, group]) =>
          new Set(
            group
              .map((rule) => rule.output?.agency)
              .filter((agency): agency is string => typeof agency === "string"),
          ).size > 1,
      )
      .map(([key, group]) => `${key}: ${group.map((rule) => rule.id).join(", ")}`);

    expect(crossAgency).toEqual([]);
    // Not vacuous: the group the rendered line above actually travels through is this one, and both
    // of its routes publish the agency the sentence names.
    expect(groups.get("dob-structure")?.map((rule) => rule.id)).toEqual([
      "DOB-TENT-001",
      "DOB-TALL-STRUCTURE-001",
    ]);
    expect(groups.get("dob-structure")?.map((rule) => rule.output?.agency)).toEqual(["DOB", "DOB"]);
  });
});

describe("the cases this copy must not reach", () => {
  it("never states a window for a research_required deadline", async () => {
    // No agency published a lead time at all, so there is no window to state. This is the same
    // `not_calculable` status arrived at from a different cause.
    const researchRequired = withBindingDeadline(findingFor("DOB-TENT-001"), {
      type: "research_required",
      display: null,
      boundary: "inclusive",
    });

    const line = await applyByLine(researchRequired);
    expect(line).toContain(`Exact apply-by date: not calculable — ${CONFIRM_WITH_AGENCY}`);
    expect(line).not.toContain("business days before your event");
  });

  it("never states a window when an unanswered intake field is what blocked the date", async () => {
    // SAPO-PLAZA-001's unknown level: a real published window, but by level and in calendar days.
    const unknownLevel = {
      ...withBindingDeadline(findingFor("DOB-TENT-001"), {
        type: "published_minimum_by_level",
        boundary: "inclusive",
      }),
      deadlineUnknownFields: ["plaza_level"],
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

  it("states the same thing on a plan stored before organizer summaries existed", async () => {
    // A DIFFERENT BRANCH OF THE LINE, not a different sentence. `loadPlan` normalizes an absent
    // `userSummary` to null, and `plan-line.tsx` renders a null summary through the legacy branch:
    // no summary list, the published deadline as a paragraph. Such a plan is immutable and nothing
    // regenerates it into the summary shape, while it carries the same published deadline and the
    // same agency as one generated today. Without this it would keep "not calculable" as its whole
    // answer, which is what the decision in `docs/BASELINE.md` replaces.
    const served = await asServed({ ...tentAlone(), userSummary: null });
    expect(served.userSummary).toBeNull();

    const { container } = render(<PlanLine finding={served} />);
    expect(container.querySelector(".line__summary")).toBeNull();
    expect(container.querySelector(".line__deadline-notice")?.textContent).toBe(
      "Apply by: the exact date depends on which days DOB counts as business days. " +
        "Allow more if it closes for holidays. Confirm with DOB.",
    );
  });

  it("leaves a legacy line with no business-day window carrying no notice at all", async () => {
    // The same branch, on the finding that must not get the sentence: DOB-ASSEMBLY-001's published
    // agency names two agencies, so it falls back here exactly as it does in the summary branch,
    // and the fallback in this branch is the published deadline paragraph on its own.
    const served = await asServed({ ...findingFor("DOB-ASSEMBLY-001"), userSummary: null });

    const { container } = render(<PlanLine finding={served} />);
    expect(container.querySelector(".line__deadline")).not.toBeNull();
    expect(container.querySelector(".line__deadline-notice")).toBeNull();
  });

  it("keeps the fallback's agency-confirmation obligation on the legacy branch too", async () => {
    // THE OTHER HALF OF THE TEST ABOVE, which on its own asserts only an absence. What the fallback
    // finding must not lose is the CONFIRM_WITH_AGENCY treatment, and on this branch that is not
    // the summary's "not calculable — confirm with agency" point: this branch has never rendered
    // that point, before this change or after it. The obligation arrives from the engine instead.
    // `findings.ts:56-58` appends CONFIRM_WITH_AGENCY to `notes` for every `not_calculable`
    // finding that is not RESEARCH_REQUIRED, which is exactly this one, and `plan-line.tsx` renders
    // `notes` inside the disclosure on BOTH branches. So the legacy line states the status in the
    // published deadline paragraph and carries the confirmation one interaction away, which is
    // where this branch has always carried it.
    const served = await asServed({ ...findingFor("DOB-ASSEMBLY-001"), userSummary: null });
    expect(served.notes).toContain(CONFIRM_WITH_AGENCY);

    const line = render(<PlanLine finding={served} />);
    expect(line.container.querySelector(".line__deadline")?.textContent).toContain(
      "not calculable",
    );

    await userEvent.click(line.getByRole("button", { name: /^Details for/ }));
    const notes = [...line.container.querySelectorAll(".line__note")].map(
      (note) => note.textContent,
    );
    expect(notes).toContain(CONFIRM_WITH_AGENCY);
  });
});
