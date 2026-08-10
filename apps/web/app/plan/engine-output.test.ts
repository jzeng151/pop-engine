import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  FIXTURE_TODAY,
  SCENARIO_INTAKE_FIXTURES,
  evaluate,
  fixtureSubmission,
  parseEngineRuleset,
} from "@pop-engine/engine";
import type { EventIntake, PermitPlan, PublishedHolidayCalendar } from "@pop-engine/engine";
import { loadPlan } from "./plan-api";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const rulesDirectory = path.join(repoRoot, "rules");

const published = readdirSync(rulesDirectory).filter((entry) =>
  /^nyc-rules\.v[\d.]+\.json$/.test(entry),
);
if (published.length !== 1) {
  throw new Error(`expected one published ruleset in ${rulesDirectory}, found ${published.length}`);
}
const ruleset = parseEngineRuleset(
  JSON.parse(readFileSync(path.join(rulesDirectory, published[0] as string), "utf8")),
);

const CALENDARS: readonly PublishedHolidayCalendar[] = [
  { id: ruleset.calendarId, holidays: [] },
  { id: ruleset.calendarId, holidays: null as unknown as readonly string[] },
];

const CLOCKS = [FIXTURE_TODAY, "2026-08-20", "2026-12-01"] as const;

const served = (plan: PermitPlan) => ({
  ...plan,
  findings: plan.findings.map((finding) => ({
    ...finding,
    lastVerifiedDate: finding.lastVerifiedDate ?? null,
  })),
  id: "11111111-1111-4111-8111-111111111111",
  eventId: "22222222-2222-4222-8222-222222222222",
  eventRevision: 1,
  snapshotDate: ruleset.snapshotDate ?? null,
  generatedAt: "2026-07-22T12:00:00.000Z",
});

const stubFetch = (body: unknown) => {
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(JSON.stringify(body), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    ),
  );
};

afterEach(() => {
  vi.unstubAllGlobals();
});

const UNANSWERED_FIELDS = [
  "sapo_event_type",
  "street_event_size",
  "structure_over_10ft_tall",
  "tent_area_sqft",
  "plaza_level",
  "amplified_sound",
  "location_type",
  "headcount",
] as const;

describe("the plan boundary over real engine output", () => {
  for (const fixture of SCENARIO_INTAKE_FIXTURES) {
    for (const today of CLOCKS) {
      for (const [index, calendar] of CALENDARS.entries()) {
        const label = `${fixture.scenario} at ${today} with ${index === 0 ? "an empty" : "an unpublished"} calendar`;
        it(`accepts scenario ${label}`, async () => {
          const plan = evaluate(
            fixtureSubmission(fixture) as unknown as EventIntake,
            ruleset,
            today,
            calendar,
          );
          stubFetch(served(plan));

          const result = await loadPlan("https://api.example.com", "event-1");
          expect(result.ok ? null : result.message).toBeNull();
        });
      }
    }
  }

  for (const fixture of SCENARIO_INTAKE_FIXTURES) {
    for (const field of UNANSWERED_FIELDS) {
      const submitted = fixtureSubmission(fixture);
      if (!(field in submitted)) continue;
      for (const [index, calendar] of CALENDARS.entries()) {
        it(`accepts scenario ${fixture.scenario} with ${field} unanswered (calendar ${index})`, async () => {
          const plan = evaluate(
            { ...submitted, [field]: null } as unknown as EventIntake,
            ruleset,
            "2026-08-20",
            calendar,
          );
          stubFetch(served(plan));

          const result = await loadPlan("https://api.example.com", "event-1");
          expect(result.ok ? null : result.message).toBeNull();
        });
      }
    }
  }
});
