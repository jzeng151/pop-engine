// The plan boundary, run over what `evaluate` ACTUALLY EMITS.
//
// WHY THIS FILE EXISTS. Every other test of this boundary hands it a payload written by a test
// author, and most of them were written to be REJECTED. A validator exercised only on invalid input
// has never been shown to accept valid input, and three guards on this branch went out having been
// shown exactly that: the identity check made `loadChecklist` report a whole checklist unreadable,
// the widened-blocker path refused a stored plan whose blocker was promoted out of a branch, and
// each was found by a reviewer rather than by a test (#252 review). Refusal here is not a degraded
// page: `readPlan` returns null and the organizer sees no plan at all.
//
// SO THE ASSERTION IS THE WHOLE POINT AND IT IS ONE SENTENCE: for every scenario the engine can
// produce, the boundary accepts it. No expected values, nothing pinned about the plan's content —
// the acceptance suite already owns that. This owns the property that the two sides agree at all.
//
// THE CLOCKS ARE PART OF THE SWEEP. A fixture set evaluated at one date reaches one set of
// deadline states, and the guards that failed were all about missed windows, promoted blockers and
// undatable ones. So every scenario runs at the answer key's own clock, at a day inside each
// published lead time, and past the event, which is what reaches `published_deadline_missed`,
// INFEASIBLE and the branch promotion.
//
// THE CALENDAR IS TOO. Production publishes NO holiday list (`apps/api/src/calendar.ts`), so
// `business_days_minimum` windows evaluate `not_calculable` there and datable in tests. Both are
// real deployments of this engine and both are swept.

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
/**
 * The published ruleset, found rather than named. `scripts/check-baseline-drift.mjs` fails any
 * source file that spells the artifact's version, so that a publish is one file rename and not a
 * sweep through the tree; this resolves it the same way `packages/engine/src/__fixtures__` does.
 */
const published = readdirSync(rulesDirectory).filter((entry) =>
  /^nyc-rules\.v[\d.]+\.json$/.test(entry),
);
if (published.length !== 1) {
  throw new Error(`expected one published ruleset in ${rulesDirectory}, found ${published.length}`);
}
const ruleset = parseEngineRuleset(
  JSON.parse(readFileSync(path.join(rulesDirectory, published[0] as string), "utf8")),
);

/** The two calendars this engine is deployed with: the published empty list, and none at all. */
const CALENDARS: readonly PublishedHolidayCalendar[] = [
  { id: ruleset.calendarId, holidays: [] },
  // What production deploys: the list itself is still RESEARCH_REQUIRED, so business-day windows
  // evaluate `not_calculable` there (`apps/api/src/calendar.ts`).
  { id: ruleset.calendarId, holidays: null as unknown as readonly string[] },
];

/**
 * Clocks that reach different deadline states for the same intake. The answer key's own day, one
 * inside the published lead times, and one past every fixture event date.
 */
const CLOCKS = [FIXTURE_TODAY, "2026-08-20", "2026-12-01"] as const;

/**
 * The api's storage envelope around the engine's plan, which is what the browser is served.
 *
 * ONE FIELD IS RESTATED FROM `plan.ts` AND IT IS THE ONLY ONE. The engine omits
 * `lastVerifiedDate` on a rule that publishes none, to keep historical finding shapes byte-stable;
 * `plan.ts` reads it out of a column and therefore always emits it, null included, which is why the
 * wire type requires it. Everything else here is the engine's own object, untouched. If the api
 * ever normalizes a second field, this sweep stops modelling it and that is a real limit of the
 * check, stated rather than hidden.
 */
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

/**
 * THE FIXTURES ANSWER EVERYTHING, AND THAT IS THE GAP. Every scenario in the answer key is
 * specified completely — `inferred` has been empty for all six since v4 — so no fixture leaves an
 * intake field unanswered, `evaluateTrigger` never returns `unknown`, `evaluateConditional` never
 * branches, and the whole family of shapes that only exists behind a branch is unreachable from
 * them: `missingFacts` with branch tables, a CONDITIONAL verdict reached by divergence, and the
 * blocker PROMOTED out of a branch that this file was written for.
 *
 * So the sweep also runs each scenario with one answer REMOVED. That is not a synthetic payload: it
 * is what an intake looks like before an organizer has finished it, the engine's own tri-state path
 * handles it, and the plan the engine returns for it is one the api will serve. The fields listed
 * are the ones the published ruleset branches on.
 */
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
          // The message is included because a bare `false` says nothing about WHICH guard refused,
          // and the whole failure mode this file exists for is a guard nobody expected to fire.
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
          // The late clock, because a branch that closes the plan is what promotes a blocker out of
          // it, and that needs a published window already past.
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
