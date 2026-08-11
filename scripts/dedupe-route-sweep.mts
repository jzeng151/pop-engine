// Measurement harness for PR #252's route-list review.

import { readFileSync } from "node:fs";
import path from "node:path";

const [engineDir, outPath] = process.argv.slice(2).filter((arg) => arg !== "--");
if (engineDir === undefined || outPath === undefined) throw new Error("usage: <engine-src> <out>");

const engine = (await import(path.resolve(engineDir, "index.ts"))) as {
  evaluate: (
    intake: Record<string, unknown>,
    ruleset: unknown,
    today: string,
    calendar: unknown,
  ) => Record<string, unknown>;
  parseEngineRuleset: (value: unknown) => { calendarId: string };
};
const { evaluate, parseEngineRuleset } = engine;

const RULES = path.resolve(process.cwd(), "rules/nyc-rules.v2.11.json");
const ruleset = parseEngineRuleset(JSON.parse(readFileSync(RULES, "utf8")));
/** The ruleset's own pinned calendar, with no published holiday list, as `pinnedCalendar` gives. */
// `HOLIDAYS=published` runs the sweep against a published (empty) holiday list, which is what the api's own suites inject; unset runs it against production's, where none is published and a business-day window is.
const calendar = {
  id: ruleset.calendarId,
  holidays: process.env.HOLIDAYS === "published" ? [] : null,
};

const TODAY = "2026-07-22";
const EVENT_DATE = "2026-09-19";

// The proposal's own section 4.3 / 9.1 dimensions: the power set of `structure_types` by `tent_area_sqft` by `tent_days_in_place` by `structure_over_10ft_tall`.
const STRUCTURE_VALUES = [
  "tent_canopy",
  "stage_platform_scaffold",
  "prop_truss",
  "bleachers_inflatable",
  "none",
];
const STRUCTURE_SETS = Array.from({ length: 1 << STRUCTURE_VALUES.length }, (_unused, mask) =>
  STRUCTURE_VALUES.filter((_value, bit) => (mask & (1 << bit)) !== 0),
);
const OVER_10FT = ["yes", "no", "unknown", undefined];
const TENT_AREA = [undefined, 300, 400, 401, 500];
const TENT_DAYS = [undefined, 10, 29, 30, 45];

type Row = {
  readonly id: number;
  readonly intake: Record<string, unknown>;
  readonly verdict: string;
  readonly merged: boolean;
  readonly ruleIds: readonly string[];
  readonly permitName: string | null;
  readonly latestApplyDate: string | null;
  readonly feeDisplay: string | null;
  readonly deadlineStatus: string;
  readonly deadlineType: string | null;
  readonly schedulingRoutes: number;
  readonly routeRuleIds: readonly string[];
  readonly headlineMode: string | null;
  readonly filingRouteRuleId: string | null;
};

/** Every route of a finding, with the same single-route fallback `routesOf` gives. */
const routesOf = (finding: Record<string, unknown>): Record<string, unknown>[] =>
  (finding.routes as Record<string, unknown>[] | undefined) ?? [
    {
      ruleId: (finding.ruleIds as string[])[0],
      latestApplyDate: finding.latestApplyDate,
      feeDisplay: finding.feeDisplay,
      deadlineStatus: finding.deadlineStatus,
      applyAfterDate: finding.applyAfterDate,
      deadline: finding.deadline,
    },
  ];

/**
 * The route the checklist reads its window off, which is `apps/api/src/planning/plan.ts`'s `filingRouteOf`
 * expressed against a finding rather than a stored row. Null when the line publishes its own.
 */
function filingRoute(finding: Record<string, unknown>): Record<string, unknown> | null {
  if (finding.deadline !== null || finding.latestApplyDate !== null) return null;
  const routes = finding.routes as Record<string, unknown>[] | undefined;
  if (routes === undefined || routes.length < 2) return null;
  return routes.find((route) => route.deadline !== null || route.latestApplyDate !== null) ?? null;
}

/**
 * How many routes of this line F-203 schedules reminders for. The alert count is this times the
 * ruleset's published offsets, which are the same on both sides of the comparison, so the route
 * count is what the comparison is about.
 */
function schedulingRoutes(finding: Record<string, unknown>): number {
  const routes = (finding.routes as Record<string, unknown>[] | undefined) ?? undefined;
  const scheduling =
    routes === undefined || routes.length < 2
      ? routesOf(finding)
      : routes.filter((route) => route.latestApplyDate !== null || route.applyAfterDate !== null);
  return scheduling.filter(
    (route) => typeof route.latestApplyDate === "string" && route.latestApplyDate >= TODAY,
  ).length;
}

const rows: Row[] = [];
let id = 0;
for (const structures of STRUCTURE_SETS) {
  for (const over10 of OVER_10FT) {
    for (const area of TENT_AREA) {
      for (const days of TENT_DAYS) {
        {
          id += 1;
          // EVERY OTHER COLLECTED FIELD IS ANSWERED, so the only unknowns in the sweep are the four dimensions it varies.
          const intake: Record<string, unknown> = {
            borough: "manhattan",
            location_type: "street",
            obstructs_public_way: "no",
            event_date: EVENT_DATE,
            headcount: 120,
            event_open_to_public: "yes",
            food_present: false,
            selling_anything: false,
            amplified_sound: false,
            structure_types: structures,
            open_flame_or_cooking: ["none"],
            generator_present: false,
            battery_present: false,
            alcohol: false,
          };
          if (over10 !== undefined) intake.structure_over_10ft_tall = over10;
          if (area !== undefined) intake.tent_area_sqft = area;
          if (days !== undefined) intake.tent_days_in_place = days;

          const plan = evaluate(intake, ruleset, TODAY, calendar);

          const findings = plan.findings as Record<string, unknown>[];
          const dob = findings.find((finding) =>
            (finding.ruleIds as string[]).some((ruleId) =>
              ["DOB-TENT-001", "DOB-TALL-STRUCTURE-001"].includes(ruleId),
            ),
          );
          if (dob === undefined) continue;
          const filing = filingRoute(dob);
          rows.push({
            id,
            intake,
            verdict: plan.verdict as string,
            merged: (dob.ruleIds as string[]).length > 1,
            ruleIds: dob.ruleIds as string[],
            permitName: dob.name as string | null,
            latestApplyDate:
              (filing?.latestApplyDate as string | null | undefined) ??
              (dob.latestApplyDate as string | null),
            feeDisplay:
              (filing?.feeDisplay as string | null | undefined) ??
              (dob.feeDisplay as string | null),
            deadlineStatus:
              (filing?.deadlineStatus as string | undefined) ?? (dob.deadlineStatus as string),
            deadlineType:
              ((filing?.deadline ?? dob.deadline) as { type?: string } | null)?.type ?? null,
            schedulingRoutes: schedulingRoutes(dob),
            routeRuleIds: routesOf(dob).map((route) => route.ruleId as string),
            headlineMode: (dob.headlineMode as string | undefined) ?? null,
            filingRouteRuleId: (filing?.ruleId as string | undefined) ?? null,
          });
        }
      }
    }
  }
}

const { writeFileSync } = await import("node:fs");
writeFileSync(outPath, JSON.stringify({ total: id, rows }, null, 1));
process.stdout.write(`${outPath}: ${rows.length} DOB lines from ${id} intakes\n`);
