// The plan boundary read against the engine's OWN output, rather than against hand-written bodies.
//
// `headlineMatchesBinding` and the route contract are assertions about what `mergeGroup()` produces,
// and a boundary that refuses valid engine output costs an organizer their whole plan. Every merged
// shape this repository knows how to build is evaluated here and served exactly as `plan.ts` serves
// it, so a predicate that is too strict fails in CI rather than in front of an organizer (#252
// review).

import { describe, expect, it, vi } from "vitest";
import { evaluate, parseEngineRuleset } from "@pop-engine/engine";
import type { EventIntake } from "@pop-engine/engine";
import { loadPlan } from "./plan-api";

const TODAY = "2026-07-22";
const EVENT_DATE = "2026-12-04";

type RuleSpec = {
  readonly id: string;
  readonly kind?: string;
  readonly dedupeKey: string | null;
  readonly trigger: unknown;
  readonly output: Record<string, unknown>;
};

const ALWAYS = { all: [{ field: "headcount", op: "gte", value: 10 }] };

function ruleset(rules: readonly RuleSpec[], fields: readonly unknown[] = []) {
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
      ...fields,
    ],
    rules: rules.map((rule) => ({
      id: rule.id,
      kind: rule.kind ?? "permit",
      trigger: { all: [rule.trigger, { field: "headcount", op: "gte", value: 0 }] },
      output: {
        ...rule.output,
        ...(rule.dedupeKey === null ? {} : { dedupe_key: rule.dedupeKey }),
      },
      verification: { status: "SOURCE_CONFIRMED" },
      source: { citation: `citation ${rule.id}`, urls: [`https://example.test/${rule.id}`] },
    })),
    advisories: [],
  });
}

/** Served exactly as `apps/api/src/plan.ts` serves a generated plan. */
const served = (rules: readonly RuleSpec[], intake: Record<string, unknown>, fields: unknown[]) => {
  const plan = evaluate(
    { event_date: EVENT_DATE, headcount: 50, ...intake } as unknown as EventIntake,
    ruleset(rules, fields),
    TODAY,
    { id: "test-calendar@2026", holidays: [] },
  );
  return {
    id: "plan-1",
    eventId: "event-1",
    eventRevision: 1,
    rulesetVersion: "test.v1",
    snapshotDate: "2026-07-22",
    verdict: plan.verdict,
    verdictDetail: {
      blockingFinding: null,
      missedRuleIds: [],
      minSlackDays: null,
      missingFacts: [],
      unresolvedTimelines: [],
      rescopeSuggestions: [],
    },
    today: TODAY,
    generatedAt: "2026-07-22T12:00:00.000Z",
    findings: plan.findings.map((finding) => ({
      ...finding,
      userSummary: finding.userSummary ?? null,
      lastVerifiedDate: finding.lastVerifiedDate ?? null,
      routes: finding.routes ?? null,
      headlineMode: finding.headlineMode ?? null,
    })),
  };
};

const readsBack = async (body: unknown) => {
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
  return loadPlan("https://api.example.com", "event-1");
};

describe("the plan boundary reads what the engine produces (#252)", () => {
  const FIELD = [{ field: "sidewalk_use", type: "enum", values: ["unknown", "cafe", "display"] }];
  const RESOLVED_ADVISORY = {
    id: "DOT-SIDEWALK-ADVISORY-001",
    kind: "advisory",
    dedupeKey: "sidewalk",
    trigger: ALWAYS,
    output: {
      permit_name: "Sidewalk clearance advisory",
      agency: "DOT",
      deadline: { type: "published_minimum", calendar_days: 60 },
      fee: { display: "No fee" },
      portal: { name: "DOT sidewalk desk", url: "https://example.test/dot" },
    },
  } as const;
  const CANDIDATE = {
    id: "DOT-SIDEWALK-CAFE-001",
    kind: "eligibility",
    dedupeKey: "sidewalk",
    trigger: { all: [{ field: "sidewalk_use", op: "eq", value: "cafe" }] },
    output: {
      permit_name: "Sidewalk cafe licence",
      agency: "DCWP",
      deadline: { type: "published_minimum", calendar_days: 10 },
      fee: { display: "$1,050 licence fee" },
      portal: { name: "DCWP licence centre", url: "https://example.test/dcwp" },
    },
  } as const;

  it("reads a merged line whose scalars are its binding route's", async () => {
    const body = served([RESOLVED_ADVISORY, CANDIDATE], { sidewalk_use: "cafe" }, FIELD);
    expect(body.findings[0]?.routes).toHaveLength(2);
    await expect(readsBack(body)).resolves.toMatchObject({ ok: true });
  });

  it("reads a merged line that publishes no scalars of its own", async () => {
    const body = served([RESOLVED_ADVISORY, CANDIDATE], { sidewalk_use: null }, FIELD);
    // The unattributable shape, produced by the engine rather than hand-written.
    expect(body.findings[0]?.deadlineStatus).toBe("not_calculable");
    expect(body.findings[0]?.latestApplyDate).toBeNull();
    await expect(readsBack(body)).resolves.toMatchObject({ ok: true });
  });

  it("reads a merged line whose gated route carries dependency sequencing", async () => {
    // `applyDependencySequencing` rewrites the line's gate, slack and status AND the gated route's,
    // so the two must still agree after it has run.
    const body = served(
      [
        {
          id: "PARKS-EVENT-001",
          dedupeKey: null,
          trigger: ALWAYS,
          output: {
            permit_name: "Parks event permit",
            deadline: {
              type: "composite",
              hard_floor_days: 21,
              processing_range_days: [21, 30],
            },
          },
        },
        {
          id: "NYPD-SOUND-001",
          dedupeKey: "sound",
          trigger: ALWAYS,
          output: {
            permit_name: "Sound Device Permit",
            deadline: { type: "published_minimum", calendar_days: 5 },
          },
        },
        {
          id: "NYPD-SOUND-ALT-001",
          dedupeKey: "sound",
          trigger: ALWAYS,
          output: {
            permit_name: "Sound Device Permit (alternate)",
            deadline: { type: "published_minimum", calendar_days: 40 },
          },
        },
      ],
      {},
      [],
    );
    await expect(readsBack(body)).resolves.toMatchObject({ ok: true });
  });
});
