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

const rawRuleset: unknown = JSON.parse(
  readFileSync(resolve(publishedRulesFileIn("rules")), "utf8"),
);
const ruleset = parseEngineRuleset(rawRuleset);

type RawRule = {
  readonly id: string;
  readonly output?: {
    readonly agency?: string;
    readonly dedupe_key?: string;
    readonly deadline?: { readonly type?: string };
  };
};

const productionCalendar = { id: ruleset.calendarId, holidays: null };

const TODAY = "2026-07-22";

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

const heightAnswered: EventIntake = { ...intake, structure_over_10ft_tall: "no" };

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
  findings: findings.map((finding) => {
    const served = finding as Record<string, unknown>;
    return {
      ...served,
      lastVerifiedDate: served.lastVerifiedDate ?? null,
      userSummary: served.userSummary ?? null,
    };
  }),
});

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

const applyByLine = async (finding: unknown): Promise<string> => (await applyBy(finding)).sentence;

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("a published business-day window with no computable date", () => {
  it("states what DOB-TENT-001's exact date depends on, and who to ask", async () => {
    const tent = tentAlone();
    expect(tent.deadlineStatus).toBe("not_calculable");
    expect(tent.latestApplyDate).toBeNull();
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
    const assembly = findingFor("DOB-ASSEMBLY-001");
    expect(assembly.agency).toBe("DOB (+ FDNY Public Assembly Permit)");

    expect(await applyByLine(assembly)).toContain(
      `Exact apply-by date: not calculable — ${CONFIRM_WITH_AGENCY}`,
    );
  });

  it("renders DOB-ASSEMBLY-001's new line as soon as the ruleset publishes agency as DOB", async () => {
    const corrected = { ...findingFor("DOB-ASSEMBLY-001"), agency: "DOB" };

    expect(await applyByLine(corrected)).toContain(
      "Apply by: the exact date depends on which days DOB counts as business days. " +
        "Allow more if it closes for holidays. Confirm with DOB.",
    );
  });

  it("cites no source under a sentence about business-day counting", async () => {
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
    const { citation } = await applyBy(findingFor("DOB-ASSEMBLY-001"));
    expect(citation).toContain("Sources:");
    expect(citation).toContain("DOB TPA filing page");
  });

  it("never repeats the unresolved reason's prose or the internal calendar id on the apply-by line", async () => {
    const tent = tentAlone();
    expect(tent.timelineUnresolvedReason).toContain(ruleset.calendarId);
    expect(await applyByLine(tent)).not.toContain(ruleset.calendarId);
  });
});

describe("a merged dedupe line, and the routes whose windows it did not take", () => {
  it("gets the same sentence when a second route merged into it", async () => {
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
    expect(merged.headlineMode).toBe("candidate");
    expect(entry.querySelector(".line__route-deadline-notice")?.textContent?.trim()).toBe(
      "the exact date depends on which days DOB counts as business days. " +
        "Allow more if it closes for holidays. Confirm with DOB.",
    );
    expect(entry.querySelector(".line__route-deadline")?.textContent).toContain("not calculable");
    expect(container.querySelector(".line__deadline-notice")).toBeNull();
    expect(
      [...container.querySelectorAll("li.line__point")].filter((item) =>
        /^(Apply by|Exact apply-by date):/.test(item.textContent ?? ""),
      ),
    ).toEqual([]);
  });

  it("holds the published ruleset to one agency per business-day dedupe group", () => {
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
    expect(groups.get("dob-structure")?.map((rule) => rule.id)).toEqual([
      "DOB-TENT-001",
      "DOB-TALL-STRUCTURE-001",
    ]);
    expect(groups.get("dob-structure")?.map((rule) => rule.output?.agency)).toEqual(["DOB", "DOB"]);
  });
});

describe("the cases this copy must not reach", () => {
  it("never states a window for a research_required deadline", async () => {
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
    const served = await asServed({ ...findingFor("DOB-ASSEMBLY-001"), userSummary: null });

    const { container } = render(<PlanLine finding={served} />);
    expect(container.querySelector(".line__deadline")).not.toBeNull();
    expect(container.querySelector(".line__deadline-notice")).toBeNull();
  });

  it("keeps the fallback's agency-confirmation obligation on the legacy branch too", async () => {
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
