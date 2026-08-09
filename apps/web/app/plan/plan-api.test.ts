import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CONSUMED_FINDING_FIELDS,
  CONSUMED_PLAN_FIELDS,
  generatePlan,
  loadPlan,
  loadRulesMeta,
} from "./plan-api";

// `fetch` is stubbed; the api's own behavior is covered by apps/api. What is pinned here is the
// request this page makes and how each answer is reported.

const jsonResponse = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const stubFetch = (implementation: typeof fetch) => {
  const fetchMock = vi.fn(implementation);
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
};

/**
 * A plan body as the api serves it. It carries `verdictDetail` because the view reads it — the old
 * validator did not check that field, so this fixture omitted it and still passed, which is the same
 * blind spot the shipped code had.
 */
const storedPlan = {
  id: "plan-1",
  eventId: "event-1",
  eventRevision: 2,
  rulesetVersion: "nyc.v2.3",
  snapshotDate: "2026-07-25",
  verdict: "CONDITIONAL",
  verdictDetail: {
    blockingFinding: null,
    missedRuleIds: [],
    minSlackDays: null,
    missingFacts: [],
    unresolvedTimelines: [],
    rescopeSuggestions: [],
  },
  today: "2026-07-25",
  generatedAt: "2026-07-25T12:00:00.000Z",
  findings: [],
};

/** A finding as the api serves one, carrying every member the plan lines read. */
const storedFinding = {
  ruleIds: ["PARKS-EVENT-001"],
  disposition: "required",
  name: "Special Event Permit",
  agency: "NYC Parks",
  deadline: null,
  deadlineDisplay: null,
  latestApplyDate: null,
  applyAfterDate: null,
  deadlineStatus: "not_applicable",
  feeDisplay: null,
  portalName: null,
  portalUrl: null,
  portalInstructions: null,
  notes: [],
  noteText: null,
  deadlineUnknownFields: [],
  timelineUnresolvedReason: null,
  conflictText: null,
  sources: [{ ruleId: "PARKS-EVENT-001", citation: "Parks FAQ", urls: ["https://example.gov"] }],
  verificationStatus: "SOURCE_CONFIRMED",
  lastVerifiedDate: null,
};

const omit = (plan: Record<string, unknown>, field: string): Record<string, unknown> => {
  const { [field]: _dropped, ...rest } = plan;
  return rest;
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("loadPlan", () => {
  it("gets the event's plan with the Access cookie attached", async () => {
    const fetchMock = stubFetch(async () => jsonResponse(200, storedPlan));

    await expect(loadPlan("https://api.example.com", "event-1")).resolves.toEqual({
      ok: true,
      plan: storedPlan,
    });
    expect(fetchMock).toHaveBeenCalledWith("https://api.example.com/api/events/event-1/plan", {
      credentials: "include",
      headers: { "Content-Type": "application/json" },
    });
  });

  it("says plainly when no plan has been generated yet", async () => {
    stubFetch(async () => jsonResponse(404, {}));
    await expect(loadPlan("https://api.example.com", "event-1")).resolves.toEqual({
      ok: false,
      missing: true,
      message: "No plan has been generated for this event yet.",
    });
  });

  it("repeats the api's own message when it explains the refusal", async () => {
    stubFetch(async () => jsonResponse(500, { error: "plan lookup failed" }));
    await expect(loadPlan("https://api.example.com", "event-1")).resolves.toEqual({
      ok: false,
      missing: false,
      message: "plan lookup failed",
    });
  });

  it("falls back to the status when the failure body carries no message", async () => {
    stubFetch(async () => new Response("<html>gateway</html>", { status: 502 }));
    await expect(loadPlan("https://api.example.com", "event-1")).resolves.toEqual({
      ok: false,
      missing: false,
      message: "The plan could not be loaded (HTTP 502).",
    });
  });

  it("refuses a success body it cannot read as a plan", async () => {
    stubFetch(async () => jsonResponse(200, { findings: [] }));
    await expect(loadPlan("https://api.example.com", "event-1")).resolves.toEqual({
      ok: false,
      missing: false,
      message: "The API returned a plan this page cannot read.",
    });
  });

  it("keeps a null snapshot date, which is what a pre-migration-002 plan carries", async () => {
    stubFetch(async () => jsonResponse(200, { ...storedPlan, snapshotDate: null }));
    const result = await loadPlan("https://api.example.com", "event-1");
    expect(result.ok && result.plan.snapshotDate).toBeNull();
  });

  it("refuses a plan that omits the snapshot date rather than reading it as null", async () => {
    // Null means "generated before migration 002", which the banner says out loud. An absent field
    // means the api and this page disagree, and must not be reported as a fact about the plan.
    const { snapshotDate: _omitted, ...withoutDate } = storedPlan;
    stubFetch(async () => jsonResponse(200, withoutDate));
    await expect(loadPlan("https://api.example.com", "event-1")).resolves.toEqual({
      ok: false,
      missing: false,
      message: "The API returned a plan this page cannot read.",
    });
  });

  it("does not refuse a plan over a field the view never reads", async () => {
    // Rejecting a body for `id`, `eventId` or `today` would refuse a plan the page renders
    // correctly. The rule is what the view consumes, not everything the endpoint serves.
    stubFetch(async () =>
      jsonResponse(200, omit(omit(omit(storedPlan, "id"), "eventId"), "today")),
    );
    const result = await loadPlan("https://api.example.com", "event-1");
    expect(result.ok).toBe(true);
  });

  it("reads a plan carrying a full finding", async () => {
    stubFetch(async () => jsonResponse(200, { ...storedPlan, findings: [storedFinding] }));
    const result = await loadPlan("https://api.example.com", "event-1");
    expect(result.ok && result.plan.findings).toHaveLength(1);
  });

  /**
   * #252: the F-201 route contract publishes exactly two trigger results. A route that resolved
   * `false` produced no finding and cannot be a member of a merged line, so "false" on the wire is
   * a plan this page has no reading for — and a plan carrying one with `headlineMode:
   * "applies_together"` renders "the answers recorded in this plan meet each route's own
   * conditions" over a route that explicitly does not.
   */
  const mergedFinding = (triggerResult: string, headlineMode = "applies_together") => ({
    ...storedFinding,
    ruleIds: ["PARKS-EVENT-001", "SAPO-PERMIT-001"],
    headlineMode,
    routes: [
      {
        ruleId: "PARKS-EVENT-001",
        triggerResult: "true",
        disposition: "required",
        unknownFields: [],
        name: "Special Event Permit",
        agency: "NYC Parks",
        deadline: null,
        deadlineDisplay: null,
        latestApplyDate: null,
        applyAfterDate: null,
        deadlineStatus: "not_applicable",
        feeDisplay: null,
        portalName: null,
        portalUrl: null,
        portalInstructions: null,
      },
      {
        ruleId: "SAPO-PERMIT-001",
        triggerResult,
        // The pair the engine produces: an unresolved trigger always names the field it stopped
        // on, and a resolved one names none, which this boundary now reads rather than assumes.
        unknownFields: triggerResult === "unknown" ? ["sapo_event_type"] : [],
        disposition: "required",
        name: "SAPO permit",
        agency: "SAPO (CECM)",
        deadline: null,
        deadlineDisplay: null,
        latestApplyDate: null,
        applyAfterDate: null,
        deadlineStatus: "not_applicable",
        feeDisplay: null,
        portalName: null,
        portalUrl: null,
        portalInstructions: null,
      },
    ],
  });

  it("reads a merged finding whose routes carry the two published trigger results", async () => {
    for (const [triggerResult, headlineMode] of [
      ["true", "applies_together"],
      ["unknown", "candidate"],
    ]) {
      stubFetch(async () =>
        jsonResponse(200, {
          ...storedPlan,
          findings: [mergedFinding(triggerResult as string, headlineMode)],
        }),
      );
      const result = await loadPlan("https://api.example.com", "event-1");
      expect(result.ok).toBe(true);
    }
  });

  /**
   * #252 review: THE WIDENED BLOCKER KEYS ARE A VERSION, SO A PARTIAL SET IS NOT A VERSION.
   *
   * `verdict-detail.tsx` turns the legacy fallback off as soon as ANY of them is present, on the
   * reading that presence means the api wrote the narrowed blocker. Checked one at a time, a payload
   * carrying `agency` alone passed and still turned the fallback off, so the INFEASIBLE panel
   * rendered the citation, the portal and the apply-by date blank rather than refusing the payload
   * or recovering them from the stored line.
   */
  it("refuses a blocking finding carrying only some of the widened keys", async () => {
    const whole = {
      ruleIds: ["SAPO-STREET-LARGE-001"],
      name: "Street Activity Permit — Large",
      agency: "SAPO (CECM)",
      disposition: "required",
      deadlineDisplay: "submit by December 31 of the prior year",
      latestApplyDate: "2025-12-31",
      deadlineStatus: "published_deadline_missed",
      feeDisplay: null,
      portalName: null,
      portalUrl: null,
      portalInstructions: null,
      sources: [],
      userSummary: null,
    };
    const detailWith = (blockingFinding: unknown) => ({
      ...storedPlan,
      verdict: "INFEASIBLE",
      verdictDetail: { ...storedPlan.verdictDetail, blockingFinding },
    });

    for (const dropped of ["agency", "sources", "portalInstructions", "userSummary"]) {
      const { [dropped]: _gone, ...partial } = whole as Record<string, unknown>;
      stubFetch(async () => jsonResponse(200, detailWith(partial)));
      await expect(loadPlan("https://api.example.com", "event-1")).resolves.toMatchObject({
        ok: false,
      });
    }

    // Both legal states still read: the whole set, and the stored plan that predates it.
    for (const legal of [whole, { ruleIds: whole.ruleIds, name: whole.name }]) {
      stubFetch(async () => jsonResponse(200, detailWith(legal)));
      await expect(loadPlan("https://api.example.com", "event-1")).resolves.toMatchObject({
        ok: true,
      });
    }
  });

  /**
   * #252 review: AN UNRESOLVED ROUTE MUST NAME WHAT WOULD SETTLE IT.
   *
   * The engine cannot produce either half of this wrong: `evaluateTrigger` returns `unknown` only
   * when a child did, and every unknown leaf carries its own `condition.field`, while every
   * decisive branch returns an empty list. Unread, a body could still say `unknown` and name
   * nothing, and the plan line's introduction, its unsettled sentence and the checklist's deciding
   * question are all built from these fields, so the one actionable thing about the route would
   * disappear with no sign it was missing.
   */
  it("refuses a route whose unknown fields contradict its own trigger result", async () => {
    const contradictions = [
      // Unresolved and naming nothing that would decide it.
      { triggerResult: "unknown", unknownFields: [], headlineMode: "candidate" },
      // Resolved and still naming an open question.
      {
        triggerResult: "true",
        unknownFields: ["sapo_event_type"],
        headlineMode: "applies_together",
      },
    ];
    for (const { triggerResult, unknownFields, headlineMode } of contradictions) {
      const finding = mergedFinding(triggerResult, headlineMode);
      stubFetch(async () =>
        jsonResponse(200, {
          ...storedPlan,
          findings: [
            {
              ...finding,
              routes: [finding.routes[0], { ...finding.routes[1], unknownFields }],
            },
          ],
        }),
      );

      await expect(loadPlan("https://api.example.com", "event-1")).resolves.toMatchObject({
        ok: false,
      });
    }
  });

  /**
   * #252: every field of this body is a token the contract permits, and the combination is one it
   * has no reading for. `applies_together` renders "the answers recorded in this plan meet each
   * route's own conditions" over a route whose own trigger says nothing has been settled, and
   * `candidate` is the mode for the routes that cannot yet be told apart, so it needs one.
   */
  it("refuses a headline mode its own routes' trigger results contradict", async () => {
    for (const [triggerResult, headlineMode] of [
      ["unknown", "applies_together"],
      ["true", "candidate"],
    ]) {
      stubFetch(async () =>
        jsonResponse(200, {
          ...storedPlan,
          findings: [mergedFinding(triggerResult as string, headlineMode)],
        }),
      );
      const result = await loadPlan("https://api.example.com", "event-1");
      expect(result.ok).toBe(false);
    }
  });

  /**
   * #252: `routes` is published only for a line that MERGED, so a one-entry list is a shape the
   * contract has no reading for. Every consumer tests `length > 1` before treating a line as
   * merged, so accepting one here presented an incomplete route set as a complete line.
   */
  it("refuses a route list shorter than the merge that produces one", async () => {
    const single = mergedFinding("true");
    stubFetch(async () =>
      jsonResponse(200, {
        ...storedPlan,
        findings: [{ ...single, routes: [single.routes[0]] }],
      }),
    );
    const result = await loadPlan("https://api.example.com", "event-1");
    expect(result.ok).toBe(false);
  });

  /**
   * #252 review: the route list and `ruleIds` are built from one group, so they name the same rules
   * and name each once. A list that repeats one rule, or names a rule the line does not, clears
   * every per-field check and then renders the duplicate while the other rule's window, fee and
   * portal are absent from a line that names it.
   */
  it("refuses a route list that does not match the finding's own rule ids", async () => {
    const merged = mergedFinding("true");
    const [first, second] = merged.routes;
    const bodies = [
      // Two routes, both the same rule: `ruleIds` still says two rules were merged.
      { ...merged, routes: [first, { ...second, ruleId: "PARKS-EVENT-001" }] },
      // A route for a rule the line does not name.
      { ...merged, routes: [first, { ...second, ruleId: "DOB-TENT-001" }] },
      // The ids match as a set but `ruleIds` repeats one, so the line names one rule twice.
      { ...merged, ruleIds: ["PARKS-EVENT-001", "PARKS-EVENT-001"] },
      // A third rule named with no route of its own.
      { ...merged, ruleIds: [...merged.ruleIds, "DOB-TENT-001"] },
    ];
    for (const finding of bodies) {
      stubFetch(async () => jsonResponse(200, { ...storedPlan, findings: [finding] }));
      const result = await loadPlan("https://api.example.com", "event-1");
      expect(result.ok).toBe(false);
    }
  });

  /**
   * #252: the engine publishes `headlineMode` exactly when it publishes `routes`, so either without
   * the other is a shape no plan has. A list with no mode is the damaging half: it clears every
   * per-field check, and `Routes` then returns null for want of a mode, so the page renders the
   * binding scalar alone and the other route's name, window, fee and portal are silently absent
   * from a line that has them.
   */
  it("refuses a route list and a headline mode that do not arrive together", async () => {
    const merged = mergedFinding("true");
    const halves = [
      { ...merged, headlineMode: null },
      (({ headlineMode: _dropped, ...rest }) => rest)(merged),
      { ...merged, routes: null },
      (({ routes: _dropped, ...rest }) => rest)(merged),
    ];
    for (const finding of halves) {
      stubFetch(async () => jsonResponse(200, { ...storedPlan, findings: [finding] }));
      const result = await loadPlan("https://api.example.com", "event-1");
      expect(result.ok).toBe(false);
    }
  });

  it("refuses a route whose trigger result is false, which the route contract has no reading for", async () => {
    stubFetch(async () => jsonResponse(200, { ...storedPlan, findings: [mergedFinding("false")] }));
    await expect(loadPlan("https://api.example.com", "event-1")).resolves.toEqual({
      ok: false,
      missing: false,
      message: "The API returned a plan this page cannot read.",
    });
  });

  it("reports an unreachable api instead of throwing", async () => {
    stubFetch(async () => {
      throw new TypeError("Failed to fetch");
    });
    await expect(loadPlan("https://api.example.com", "event-1")).resolves.toEqual({
      ok: false,
      missing: false,
      message: "The API could not be reached.",
    });
  });
});

describe("loadRulesMeta", () => {
  it("reads the version and snapshot date the api publishes", async () => {
    const fetchMock = stubFetch(async () =>
      jsonResponse(200, { ruleset_version: "nyc.v2.3", snapshot_date: "2026-07-25" }),
    );

    await expect(loadRulesMeta("https://api.example.com")).resolves.toEqual({
      ok: true,
      meta: { ruleset_version: "nyc.v2.3", snapshot_date: "2026-07-25" },
    });
    expect(fetchMock).toHaveBeenCalledWith("https://api.example.com/api/rules/meta", {
      credentials: "include",
      headers: { "Content-Type": "application/json" },
    });
  });

  it("refuses a body that does not carry both values", async () => {
    stubFetch(async () => jsonResponse(200, { ruleset_version: "nyc.v2.3" }));
    await expect(loadRulesMeta("https://api.example.com")).resolves.toEqual({
      ok: false,
      message: "The API returned a ruleset version this page cannot read.",
    });
  });

  it("reports a refusal and an unreachable api", async () => {
    stubFetch(async () => jsonResponse(503, {}));
    await expect(loadRulesMeta("https://api.example.com")).resolves.toEqual({
      ok: false,
      message: "The ruleset version could not be read (HTTP 503).",
    });

    stubFetch(async () => {
      throw new TypeError("Failed to fetch");
    });
    await expect(loadRulesMeta("https://api.example.com")).resolves.toEqual({
      ok: false,
      message: "The API could not be reached.",
    });
  });
});

describe("generatePlan", () => {
  it("returns the plan the POST stored, asking for nothing more", async () => {
    const fetchMock = stubFetch(async () => jsonResponse(201, storedPlan));

    await expect(generatePlan("https://api.example.com", "event-1")).resolves.toEqual({
      ok: true,
      plan: storedPlan,
    });
    // One call: the POST. A second would be re-reading a plan already in hand.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith("https://api.example.com/api/events/event-1/plan", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
    });
  });

  it("re-reads only when the POST's own body cannot be read", async () => {
    // The one case where a re-read is genuinely necessary: a row was written, so reporting a failure
    // would misstate what happened and POSTing again would write a second row for one action.
    const fetchMock = stubFetch(async (_url, init) =>
      (init as RequestInit | undefined)?.method === "POST"
        ? jsonResponse(201, omit(storedPlan, "generatedAt"))
        : jsonResponse(200, storedPlan),
    );

    await expect(generatePlan("https://api.example.com", "event-1")).resolves.toEqual({
      ok: true,
      plan: storedPlan,
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("says a plan was stored even when neither the POST body nor the re-read can be read", async () => {
    stubFetch(async (_url, init) =>
      (init as RequestInit | undefined)?.method === "POST"
        ? jsonResponse(201, omit(storedPlan, "generatedAt"))
        : jsonResponse(500, { error: "plan lookup failed" }),
    );

    await expect(generatePlan("https://api.example.com", "event-1")).resolves.toEqual({
      ok: false,
      stored: true,
      message: "The API returned a plan this page cannot read.",
    });
  });

  it("says no plan was stored when the POST itself failed", async () => {
    stubFetch(async () => jsonResponse(500, { error: "plan generation failed" }));
    await expect(generatePlan("https://api.example.com", "event-1")).resolves.toEqual({
      ok: false,
      stored: false,
      message: "plan generation failed",
    });

    stubFetch(async () => {
      throw new TypeError("Failed to fetch");
    });
    await expect(generatePlan("https://api.example.com", "event-1")).resolves.toEqual({
      ok: false,
      stored: false,
      message: "The API could not be reached.",
    });
  });
});

// The compile-time half of the guarantee is `pnpm typecheck`: a field the page reads that is not in
// a consumed type does not compile, and a field in a consumed type with no check does not compile.
// This is the runtime half — that each declared check is actually enforced — and it is DERIVED from
// the check maps rather than listed, so a field added to either one is covered here the moment it
// exists. That is what stops the fifth "field X was never validated" finding: there is no list to
// forget to update.
describe("coverage of every field this feature reads", () => {
  const refusal = {
    ok: false,
    missing: false,
    message: "The API returned a plan this page cannot read.",
  };

  /** `true` satisfies no check in either map: not a string, number, null, array, token or record. */
  const WRONG = true;

  const expectRefused = async (body: unknown) => {
    stubFetch(async () => jsonResponse(200, body));
    await expect(loadPlan("https://api.example.com", "event-1")).resolves.toEqual(refusal);
  };

  it("validates every plan field the page reads, and nothing it does not", () => {
    // Pins the derivation itself: if a field appears here that the page never reads, or a field the
    // page reads is missing, the consumed type and this list have come apart.
    expect([...CONSUMED_PLAN_FIELDS].sort()).toEqual([
      "eventRevision",
      "findings",
      "generatedAt",
      "rulesetVersion",
      "snapshotDate",
      "verdict",
      "verdictDetail",
    ]);
    // `kind`, `slackDays` and `triggeredBy` are absent by decision: nothing under app/plan reads
    // them, so they stay the engine's schema to police rather than this client's.
    //
    // `kind` was consumed for one release of this branch, to decide whether a null `feeDisplay`
    // meant "not published" or "no fee at all". That split is withdrawn and the field is back out:
    // an absent fee and an explicit `fee: null` are one value by the time a finding carries one, so
    // no kind could distinguish them, and inferring this filing's fee from what other rules of the
    // same kind publish is a fact about a different filing. Nothing reads `kind` now, and a field
    // consumed by nothing does not belong on this list.
    expect(CONSUMED_FINDING_FIELDS).not.toContain("kind");
    expect(CONSUMED_FINDING_FIELDS).not.toContain("slackDays");
    expect(CONSUMED_FINDING_FIELDS).not.toContain("triggeredBy");
  });

  it.each(CONSUMED_PLAN_FIELDS)("refuses a plan with no %s", async (field) => {
    await expectRefused(omit(storedPlan, field));
  });

  it.each(CONSUMED_PLAN_FIELDS)("refuses a plan whose %s is the wrong type", async (field) => {
    await expectRefused({ ...storedPlan, [field]: WRONG });
  });

  it.each(CONSUMED_FINDING_FIELDS)("refuses a plan whose finding has no %s", async (field) => {
    await expectRefused({ ...storedPlan, findings: [omit(storedFinding, field)] });
  });

  it.each(CONSUMED_FINDING_FIELDS)(
    "refuses a plan whose finding has the wrong type of %s",
    async (field) => {
      await expectRefused({ ...storedPlan, findings: [{ ...storedFinding, [field]: WRONG }] });
    },
  );

  it("accepts a historical finding with no user summary and normalizes it to null", async () => {
    stubFetch(async () =>
      jsonResponse(200, {
        ...storedPlan,
        findings: [omit(storedFinding, "userSummary")],
      }),
    );
    const result = await loadPlan("https://api.example.com", "event-1");
    expect(result.ok && result.plan.findings[0]?.userSummary).toBeNull();
  });

  it("refuses a malformed user summary", async () => {
    await expectRefused({
      ...storedPlan,
      findings: [{ ...storedFinding, userSummary: WRONG }],
    });
  });

  it("refuses a malformed human-readable rescope finding", async () => {
    await expectRefused({
      ...storedPlan,
      verdictDetail: {
        ...storedPlan.verdictDetail,
        rescopeSuggestions: [
          {
            change: { field: "location_type", value: "private_venue" },
            reevaluatedVerdict: "CONDITIONAL",
            droppedRuleIds: [],
            introducedRuleIds: ["DOB-ASSEMBLY-001"],
            introducedFindings: [
              {
                ruleIds: ["DOB-ASSEMBLY-001"],
                label: WRONG,
                source: null,
                portalName: null,
                portalUrl: null,
              },
            ],
          },
        ],
      },
    });
  });

  it("refuses malformed rescope explanation fields", async () => {
    await expectRefused({
      ...storedPlan,
      verdictDetail: {
        ...storedPlan.verdictDetail,
        rescopeSuggestions: [
          {
            change: { field: "location_type", value: "private_venue" },
            reevaluatedVerdict: "CONDITIONAL",
            droppedRuleIds: [],
            remainingMissingFields: [WRONG],
            remainingTimelineReasons: [],
          },
        ],
      },
    });
  });

  // Cases the derived sweep cannot express, kept for the reasoning rather than the coverage.
  it("refuses a verdict token the approved copy does not cover", async () => {
    // A string that is not one of the four renders an empty verdict line and silently drops the
    // at-risk buffer label — both load-bearing sentences on the page, blank, with nothing thrown.
    await expectRefused({ ...storedPlan, verdict: "MAYBE" });
  });

  it("refuses a verification status outside the schema's five", async () => {
    // The one that merged unfixed: `VerificationBadge` calls `.toLowerCase()` on it, so a renamed
    // token crashed the page instead of rendering the intended unreadable-plan error.
    await expectRefused({
      ...storedPlan,
      findings: [{ ...storedFinding, verificationStatus: "PROVISIONAL" }],
    });
  });

  it("refuses a null revision, which is what JSON makes of NaN or Infinity", async () => {
    // Worth pinning because it is the shape those values arrive in: JSON cannot encode them, so
    // `JSON.stringify` writes `null` and this is the check that has to catch it.
    await expectRefused({ ...storedPlan, eventRevision: null });
  });

  it("refuses a citation whose urls are not strings", async () => {
    await expectRefused({
      ...storedPlan,
      findings: [
        { ...storedFinding, sources: [{ ruleId: "R", citation: "C", urls: [{ href: "x" }] }] },
      ],
    });
  });
});

it("accepts a conditional missingFact that omits thresholds (pre-field stored plans)", async () => {
  stubFetch(async () =>
    jsonResponse(200, {
      ...storedPlan,
      verdict: "CONDITIONAL",
      verdictDetail: {
        ...storedPlan.verdictDetail,
        missingFacts: [{ field: "venue_license_covers_event_area", branches: [] }],
      },
    }),
  );
  const result = await loadPlan("http://api.test", "event-1");
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.plan.verdictDetail.missingFacts[0]?.thresholds).toBeNull();
});
