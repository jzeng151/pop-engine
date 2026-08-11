// Measurement harness for PR #252's route-list review, second of two.

import { readFileSync, writeFileSync } from "node:fs";
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
// `HOLIDAYS=published` runs against a published (empty) holiday list, which is what the api's own suites inject; unset runs against production's, where none is published and a business-day window is NOT_CALCULABLE.
const calendar = {
  id: ruleset.calendarId,
  holidays: process.env.HOLIDAYS === "published" ? [] : null,
};

const TODAY = "2026-07-22";
const EVENT_DATE = "2026-09-19";

// The same intake space as `scripts/dedupe-route-sweep.mts`, for the same reason it uses it: the power set of `structure_types` by `tent_area_sqft` by `tent_days_in_place` by `structure_over_10ft_tall`.
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

/** `apps/api/src/checklist.ts`'s `TRACKABLE_FINDING_KINDS`. */
const TRACKABLE = new Set(["permit", "insurance"]);

type Finding = Record<string, unknown>;

/**
 * `apps/api/src/plan.ts`'s `filingRouteOf`, expressed against a finding rather than a stored row.
 * Null when the line publishes its own window, which is every unmerged line.
 */
function filingRoute(finding: Finding): Finding | null {
  if (finding.deadline !== null || finding.latestApplyDate !== null) return null;
  const routes = finding.routes as Finding[] | undefined;
  if (routes === undefined || routes.length < 2) return null;
  return routes.find((route) => route.deadline !== null || route.latestApplyDate !== null) ?? null;
}

/** `item.latest_apply_date`: the column, which is the binding route's window and only that. */
const columnDate = (finding: Finding): string | null => finding.latestApplyDate as string | null;

/** `FILING_ORDER_DATE`: the date the row renders, which is the column or the filing route's. */
const renderedDate = (finding: Finding): string | null =>
  columnDate(finding) ?? (filingRoute(finding)?.latestApplyDate as string | null) ?? null;

/**
 * One ordering of a plan's trackable items, as the row identity each position holds.
 *
 * `PLAN_ITEM_ORDER`: the date NULLS LAST, then `permit_name`, then `rule_ids`. The two orderings
 * differ only in which date `date` is, so passing it in is the whole of the comparison.
 */
function order(items: readonly Finding[], date: (finding: Finding) => string | null): string[] {
  return [...items]
    .sort((left, right) => {
      const leftDate = date(left);
      const rightDate = date(right);
      // NULLS LAST.
      if (leftDate !== rightDate) {
        if (leftDate === null) return 1;
        if (rightDate === null) return -1;
        if (leftDate !== rightDate) return leftDate < rightDate ? -1 : 1;
      }
      const leftName = (left.name as string | null) ?? "";
      const rightName = (right.name as string | null) ?? "";
      if (leftName !== rightName) return leftName < rightName ? -1 : 1;
      const leftIds = (left.ruleIds as string[]).join("\x00");
      const rightIds = (right.ruleIds as string[]).join("\x00");
      return leftIds < rightIds ? -1 : leftIds > rightIds ? 1 : 0;
    })
    .map((finding) => (finding.ruleIds as string[]).join("+"));
}

type Row = {
  readonly id: number;
  readonly intake: Record<string, unknown>;
  readonly verdict: string;
  readonly trackableItems: number;
  readonly onTheColumn: readonly string[];
  readonly onWhatTheRowShows: readonly string[];
  readonly reordered: boolean;
};

const rows: Row[] = [];
let id = 0;
let reordered = 0;
let withAMergedLine = 0;

for (const structures of STRUCTURE_SETS) {
  for (const over10 of OVER_10FT) {
    for (const area of TENT_AREA) {
      for (const days of TENT_DAYS) {
        id += 1;
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
        const items = (plan.findings as Finding[]).filter((finding) =>
          TRACKABLE.has(finding.kind as string),
        );
        if (items.some((finding) => (finding.ruleIds as string[]).length > 1)) withAMergedLine += 1;

        const onTheColumn = order(items, columnDate);
        const onWhatTheRowShows = order(items, renderedDate);
        const differs = onTheColumn.join("|") !== onWhatTheRowShows.join("|");
        if (differs) reordered += 1;

        rows.push({
          id,
          intake,
          verdict: plan.verdict as string,
          trackableItems: items.length,
          onTheColumn,
          onWhatTheRowShows,
          reordered: differs,
        });
      }
    }
  }
}

writeFileSync(
  outPath,
  JSON.stringify(
    {
      holidays: calendar.holidays === null ? "unpublished (production)" : "published (empty)",
      intakes: id,
      withAMergedLine,
      reordered,
      rows,
    },
    null,
    1,
  ),
);
process.stdout.write(
  `${outPath}: ${reordered} of ${id} checklists reorder ` +
    `(${withAMergedLine} intakes carry a merged trackable line, ` +
    `holidays ${calendar.holidays === null ? "unpublished" : "published"})\n`,
);
