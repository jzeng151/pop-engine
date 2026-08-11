import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CONSUMED_FINDING_FIELDS,
  CONSUMED_PLAN_FIELDS,
  generatePlan,
  loadPlan,
  loadRulesMeta,
} from "./plan-api";

const jsonResponse = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const stubFetch = (implementation: typeof fetch) => {
  const fetchMock = vi.fn(implementation);
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
};

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
    const { snapshotDate: _omitted, ...withoutDate } = storedPlan;
    stubFetch(async () => jsonResponse(200, withoutDate));
    await expect(loadPlan("https://api.example.com", "event-1")).resolves.toEqual({
      ok: false,
      missing: false,
      message: "The API returned a plan this page cannot read.",
    });
  });

  it("does not refuse a plan over a field the view never reads", async () => {
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

        unknownFields: triggerResult === "unknown" ? ["sapo_event_type"] : [],
        disposition: "required",
        name: "SAPO permit",
        agency: "SAPO (CECM)",
        deadline: null,
        deadlineDisplay: null,

        latestApplyDate: "2026-03-01",
        applyAfterDate: null,
        deadlineStatus: "published_deadline_missed",
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

  it("refuses a merged finding whose headline is not its binding route's", async () => {
    const crossed = [
      { name: "SAPO permit" },
      { latestApplyDate: "2026-09-30" },
      { feeDisplay: "$1,050" },
      { portalUrl: "https://example.test/elsewhere" },
      { deadlineStatus: "published_deadline_missed" },
    ];
    for (const override of crossed) {
      const finding = mergedFinding("true");
      stubFetch(async () =>
        jsonResponse(200, { ...storedPlan, findings: [{ ...finding, ...override }] }),
      );
      await expect(loadPlan("https://api.example.com", "event-1")).resolves.toMatchObject({
        ok: false,
      });
    }
  });

  it("reads a merged finding that publishes no scalars of its own", async () => {
    const finding = mergedFinding("unknown", "candidate");

    const routes = [
      { ...(finding.routes[1] as Record<string, unknown>), disposition: "may_be_required" },
      { ...(finding.routes[0] as Record<string, unknown>), disposition: "advisory" },
    ];
    stubFetch(async () =>
      jsonResponse(200, {
        ...storedPlan,
        findings: [
          {
            ...finding,
            routes,
            disposition: "may_be_required",
            name: null,
            agency: null,
            deadline: null,
            deadlineDisplay: null,
            latestApplyDate: null,
            applyAfterDate: null,
            deadlineStatus: "not_calculable",
            feeDisplay: null,
            portalName: null,
            portalUrl: null,
            portalInstructions: null,
          },
        ],
      }),
    );

    await expect(loadPlan("https://api.example.com", "event-1")).resolves.toMatchObject({
      ok: true,
    });
  });

  it("refuses a merged finding whose disposition no route contributes", async () => {
    const finding = mergedFinding("true");
    for (const disposition of ["prohibited_or_ineligible", "advisory"]) {
      stubFetch(async () =>
        jsonResponse(200, { ...storedPlan, findings: [{ ...finding, disposition }] }),
      );
      await expect(loadPlan("https://api.example.com", "event-1")).resolves.toMatchObject({
        ok: false,
      });
    }

    const capped = mergedFinding("unknown", "candidate");
    stubFetch(async () =>
      jsonResponse(200, {
        ...storedPlan,
        findings: [{ ...capped, disposition: "required" }],
      }),
    );
    await expect(loadPlan("https://api.example.com", "event-1")).resolves.toMatchObject({
      ok: true,
    });
  });

  it("refuses an ordinary merged group that nulls its headline", async () => {
    const finding = mergedFinding("true");
    stubFetch(async () =>
      jsonResponse(200, {
        ...storedPlan,
        findings: [
          {
            ...finding,
            name: null,
            agency: null,
            deadline: null,
            deadlineDisplay: null,
            latestApplyDate: null,
            applyAfterDate: null,
            deadlineStatus: "not_calculable",
            feeDisplay: null,
            portalName: null,
            portalUrl: null,
            portalInstructions: null,
          },
        ],
      }),
    );

    await expect(loadPlan("https://api.example.com", "event-1")).resolves.toMatchObject({
      ok: false,
    });
  });

  it("refuses a widened blocker whose values are not its own route's", async () => {
    const finding = mergedFinding("true");
    const routes = finding.routes as Record<string, unknown>[];
    const blocking = routes[1] as Record<string, unknown>;
    const whole = {
      ruleIds: [blocking.ruleId as string],
      name: blocking.name as string,
      agency: blocking.agency as string,
      disposition: blocking.disposition as string,
      deadlineDisplay: blocking.deadlineDisplay as string | null,
      latestApplyDate: blocking.latestApplyDate as string | null,
      deadlineStatus: blocking.deadlineStatus as string,
      feeDisplay: blocking.feeDisplay as string | null,
      portalName: blocking.portalName as string | null,
      portalUrl: blocking.portalUrl as string | null,
      portalInstructions: blocking.portalInstructions as string | null,
      sources: [],
      userSummary: null,
    };
    const planWith = (blockingFinding: unknown) => ({
      ...storedPlan,
      verdict: "INFEASIBLE",
      findings: [finding],
      verdictDetail: {
        ...storedPlan.verdictDetail,
        blockingFinding,

        missedRuleIds: [blocking.ruleId as string],
      },
    });

    for (const crossed of [
      { name: (routes[0] as Record<string, unknown>).name },
      { latestApplyDate: "2026-09-30" },
      { feeDisplay: "$1,050" },
      { portalUrl: "https://example.test/elsewhere" },
    ]) {
      stubFetch(async () => jsonResponse(200, planWith({ ...whole, ...crossed })));
      await expect(loadPlan("https://api.example.com", "event-1")).resolves.toMatchObject({
        ok: false,
      });
    }

    for (const legal of [whole, { ruleIds: whole.ruleIds, name: whole.name }]) {
      stubFetch(async () => jsonResponse(200, planWith(legal)));
      await expect(loadPlan("https://api.example.com", "event-1")).resolves.toMatchObject({
        ok: true,
      });
    }
  });

  it("refuses a widened blocker whose rule is on no finding of the plan", async () => {
    const orphan = {
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
    stubFetch(async () =>
      jsonResponse(200, {
        ...storedPlan,
        verdict: "INFEASIBLE",
        findings: [],
        verdictDetail: {
          ...storedPlan.verdictDetail,
          blockingFinding: orphan,
          missedRuleIds: ["SAPO-STREET-LARGE-001"],
        },
      }),
    );
    await expect(loadPlan("https://api.example.com", "event-1")).resolves.toMatchObject({
      ok: false,
    });

    stubFetch(async () =>
      jsonResponse(200, {
        ...storedPlan,
        verdict: "INFEASIBLE",
        findings: [],
        verdictDetail: {
          ...storedPlan.verdictDetail,
          blockingFinding: { ruleIds: orphan.ruleIds, name: orphan.name },
          missedRuleIds: ["SAPO-STREET-LARGE-001"],
        },
      }),
    );
    await expect(loadPlan("https://api.example.com", "event-1")).resolves.toMatchObject({
      ok: true,
    });
  });

  it("refuses a widened blocker naming a route that is not missed", async () => {
    const finding = mergedFinding("true");
    const routes = finding.routes as Record<string, unknown>[];
    const onTrack = routes[0] as Record<string, unknown>;
    const missed = routes[1] as Record<string, unknown>;
    const blockerFor = (route: Record<string, unknown>) => ({
      ruleIds: [route.ruleId as string],
      name: route.name as string,
      agency: route.agency as string,
      disposition: route.disposition as string,
      deadlineDisplay: route.deadlineDisplay as string | null,
      latestApplyDate: route.latestApplyDate as string | null,
      deadlineStatus: route.deadlineStatus as string,
      feeDisplay: route.feeDisplay as string | null,
      portalName: route.portalName as string | null,
      portalUrl: route.portalUrl as string | null,
      portalInstructions: route.portalInstructions as string | null,

      sources: (finding.sources as { ruleId: string }[]).filter(
        (source) => source.ruleId === route.ruleId,
      ),
      userSummary: null,
    });
    const planWith = (blockingFinding: unknown) => ({
      ...storedPlan,
      verdict: "INFEASIBLE",
      findings: [finding],
      verdictDetail: {
        ...storedPlan.verdictDetail,
        blockingFinding,
        missedRuleIds: [missed.ruleId as string],
      },
    });

    stubFetch(async () => jsonResponse(200, planWith(blockerFor(onTrack))));
    await expect(loadPlan("https://api.example.com", "event-1")).resolves.toMatchObject({
      ok: false,
    });

    stubFetch(async () => jsonResponse(200, planWith(blockerFor(missed))));
    await expect(loadPlan("https://api.example.com", "event-1")).resolves.toMatchObject({
      ok: true,
    });
  });

  it("refuses a widened blocker on a route the engine would not block on", async () => {
    const blockingRoute = {
      ruleId: "SAPO-PERMIT-001",
      triggerResult: "true",
      disposition: "required",
      unknownFields: [] as string[],
      name: "SAPO permit",
      agency: "SAPO (CECM)",
      deadline: null,
      deadlineDisplay: null,
      latestApplyDate: "2026-03-01",
      applyAfterDate: null,
      deadlineStatus: "published_deadline_missed",
      feeDisplay: null,
      portalName: null,
      portalUrl: null,
      portalInstructions: null,
    };
    const planWith = (route: Record<string, unknown>, verificationStatus: string) => {
      const binding = { ...blockingRoute, ruleId: "PARKS-EVENT-001", name: "Special Event Permit" };
      const finding = {
        ...storedFinding,
        ruleIds: ["PARKS-EVENT-001", route.ruleId as string],
        headlineMode: "applies_together",
        verificationStatus,

        name: binding.name,
        agency: binding.agency,
        disposition: binding.disposition,
        latestApplyDate: binding.latestApplyDate,
        deadlineStatus: binding.deadlineStatus,
        routes: [binding, route],
      };
      return {
        ...storedPlan,
        verdict: "INFEASIBLE",
        findings: [finding],
        verdictDetail: {
          ...storedPlan.verdictDetail,

          blockingFinding: {
            ruleIds: [route.ruleId as string],
            name: route.name as string,
            agency: route.agency as string,
            disposition: route.disposition as string,
            deadlineDisplay: route.deadlineDisplay as string | null,
            latestApplyDate: route.latestApplyDate as string | null,
            deadlineStatus: route.deadlineStatus as string,
            feeDisplay: route.feeDisplay as string | null,
            portalName: route.portalName as string | null,
            portalUrl: route.portalUrl as string | null,
            portalInstructions: route.portalInstructions as string | null,
            sources: [],
            userSummary: null,
          },
          missedRuleIds: [route.ruleId as string],
        },
      };
    };

    const refused: [Record<string, unknown>, string][] = [
      [{ ...blockingRoute, disposition: "advisory" }, "SOURCE_CONFIRMED"],

      [
        { ...blockingRoute, disposition: "prohibited_or_ineligible", triggerResult: "unknown" },
        "SOURCE_CONFIRMED",
      ],

      [blockingRoute, "OFFICIAL_CONFLICT"],
    ];
    for (const [route, verificationStatus] of refused) {
      stubFetch(async () => jsonResponse(200, planWith(route, verificationStatus)));
      await expect(loadPlan("https://api.example.com", "event-1")).resolves.toMatchObject({
        ok: false,
      });
    }

    stubFetch(async () => jsonResponse(200, planWith(blockingRoute, "SOURCE_CONFIRMED")));
    await expect(loadPlan("https://api.example.com", "event-1")).resolves.toMatchObject({
      ok: true,
    });
  });

  it("refuses a merged finding whose routes are not in binding order", async () => {
    const route = (overrides: Record<string, unknown>) => ({
      ruleId: "PARKS-EVENT-001",
      triggerResult: "true",
      disposition: "required",
      unknownFields: [] as string[],
      name: "Special Event Permit",
      agency: "NYC Parks",
      deadline: { type: "before_issuance" },
      deadlineDisplay: null,
      latestApplyDate: null,
      applyAfterDate: null,
      deadlineStatus: "on_track",
      feeDisplay: null,
      portalName: null,
      portalUrl: null,
      portalInstructions: null,
      ...overrides,
    });

    const tight = route({
      ruleId: "SAPO-PERMIT-001",
      name: "SAPO permit",
      latestApplyDate: "2026-03-01",
    });
    const loose = route({ latestApplyDate: "2026-09-01" });
    const planWith = (routes: unknown[], headline: Record<string, unknown>) => ({
      ...storedPlan,
      findings: [
        {
          ...storedFinding,
          ruleIds: routes.map((entry) => (entry as { ruleId: string }).ruleId),
          headlineMode: "applies_together",
          deadline: { type: "before_issuance" },
          deadlineStatus: "on_track",
          ...headline,
          routes,
        },
      ],
    });

    stubFetch(async () =>
      jsonResponse(
        200,
        planWith([loose, tight], { name: loose.name, latestApplyDate: loose.latestApplyDate }),
      ),
    );
    await expect(loadPlan("https://api.example.com", "event-1")).resolves.toMatchObject({
      ok: false,
    });

    stubFetch(async () =>
      jsonResponse(
        200,
        planWith([tight, loose], { name: tight.name, latestApplyDate: tight.latestApplyDate }),
      ),
    );
    await expect(loadPlan("https://api.example.com", "event-1")).resolves.toMatchObject({
      ok: true,
    });
  });

  it("accepts a promoted blocker naming a non-headline route, on the engine's own promotion rule", async () => {
    const route = (overrides: Record<string, unknown>) => ({
      ruleId: "PARKS-EVENT-001",
      triggerResult: "true",
      disposition: "required",
      unknownFields: [] as string[],
      name: "Special Event Permit",
      agency: "NYC Parks",
      deadline: { type: "before_issuance" },
      deadlineDisplay: null,
      latestApplyDate: "2026-09-01",
      applyAfterDate: null,
      deadlineStatus: "on_track",
      feeDisplay: null,
      portalName: null,
      portalUrl: null,
      portalInstructions: null,
      ...overrides,
    });

    const binding = route({});

    const closed = route({
      ruleId: "SAPO-PERMIT-001",
      name: "SAPO permit",
      agency: "SAPO (CECM)",
      feeDisplay: "$25 processing fee",
      triggerResult: "unknown",
      unknownFields: ["sapo_event_type"],
      disposition: "may_be_required",
      deadline: null,
      latestApplyDate: null,
      deadlineStatus: "not_applicable",
    });
    const planWith = (branchVerdicts: string[]) => ({
      ...storedPlan,
      verdict: "INFEASIBLE",
      findings: [
        {
          ...storedFinding,
          ruleIds: [binding.ruleId, closed.ruleId],
          headlineMode: "candidate",
          name: binding.name,
          agency: binding.agency,
          deadline: binding.deadline,
          latestApplyDate: binding.latestApplyDate,
          deadlineStatus: binding.deadlineStatus,
          routes: [binding, closed],
        },
      ],
      verdictDetail: {
        ...storedPlan.verdictDetail,

        blockingFinding: {
          ruleIds: [closed.ruleId],
          name: closed.name,
          agency: closed.agency,
          disposition: "required",
          deadlineDisplay: null,
          latestApplyDate: "2026-03-01",
          deadlineStatus: "published_deadline_missed",
          feeDisplay: closed.feeDisplay,
          portalName: null,
          portalUrl: null,
          portalInstructions: null,
          sources: [],
          userSummary: null,
        },
        missedRuleIds: [closed.ruleId],
        missingFacts: [
          {
            field: "sapo_event_type",
            thresholds: null,
            branches: branchVerdicts.map((verdict, index) => ({
              value: `option ${index}`,
              verdict,
              reason: "the SAPO window has closed on this path",
            })),
          },
        ],
      },
    });

    stubFetch(async () => jsonResponse(200, planWith(["INFEASIBLE", "INFEASIBLE"])));
    stubFetch(async () => jsonResponse(200, planWith(["INFEASIBLE", "INFEASIBLE"])));
    await expect(loadPlan("https://api.example.com", "event-1")).resolves.toMatchObject({
      ok: true,
    });

    for (const verdicts of [["INFEASIBLE", "CONDITIONAL"], ["INFEASIBLE", "FEASIBLE"], []]) {
      stubFetch(async () => jsonResponse(200, planWith(verdicts)));
      await expect(loadPlan("https://api.example.com", "event-1")).resolves.toMatchObject({
        ok: false,
      });
    }

    const crossed: Record<string, unknown>[] = [
      { name: "Some other permit" },
      { agency: "Some other agency" },
      { feeDisplay: "$1,000,000" },
      { portalName: "Another portal" },
      { portalUrl: "https://example.test/elsewhere" },
      { portalInstructions: "Bring cash to the side door" },
      {
        sources: [
          { ruleId: closed.ruleId, citation: "Invented page", urls: ["https://example.test/no"] },
        ],
      },
      {
        sources: [
          { ruleId: binding.ruleId, citation: "Parks FAQ", urls: ["https://example.gov/faq"] },
        ],
      },
    ];
    for (const override of crossed) {
      const body = planWith(["INFEASIBLE", "INFEASIBLE"]);
      stubFetch(async () =>
        jsonResponse(200, {
          ...body,
          verdictDetail: {
            ...body.verdictDetail,
            blockingFinding: { ...body.verdictDetail.blockingFinding, ...override },
          },
        }),
      );
      await expect(loadPlan("https://api.example.com", "event-1")).resolves.toMatchObject({
        ok: false,
      });
    }
  });

  it("reads an unmerged blocker's trigger result rather than assuming it resolved", async () => {
    const line = {
      ...storedFinding,
      ruleIds: ["PARKS-PROPANE-001"],
      name: "Propane prohibited in this park",
      disposition: "prohibited_or_ineligible",
      latestApplyDate: "2026-03-01",
      deadlineStatus: "published_deadline_missed",
      sources: [
        { ruleId: "PARKS-PROPANE-001", citation: "Parks rules", urls: ["https://example.gov/p"] },
      ],
    };
    const detailWith = (trace: unknown) => ({
      ...storedPlan,
      verdict: "INFEASIBLE",
      findings: [line],
      verdictDetail: {
        ...storedPlan.verdictDetail,
        blockingFinding: {
          ruleIds: line.ruleIds,
          name: line.name,
          agency: line.agency,
          disposition: line.disposition,
          deadlineDisplay: line.deadlineDisplay,
          latestApplyDate: line.latestApplyDate,
          deadlineStatus: line.deadlineStatus,
          feeDisplay: line.feeDisplay,
          portalName: line.portalName,
          portalUrl: line.portalUrl,
          portalInstructions: line.portalInstructions,
          sources: line.sources,
          userSummary: null,
        },
        missedRuleIds: line.ruleIds,
        ...(trace === undefined ? {} : { trace }),
      },
    });

    for (const trace of [
      [{ ruleId: "PARKS-PROPANE-001", result: "unknown" }],
      [{ ruleId: "SOME-OTHER-RULE-001", result: "true" }],
      undefined,
    ]) {
      stubFetch(async () => jsonResponse(200, detailWith(trace)));
      await expect(loadPlan("https://api.example.com", "event-1")).resolves.toMatchObject({
        ok: false,
      });
    }

    stubFetch(async () =>
      jsonResponse(200, detailWith([{ ruleId: "PARKS-PROPANE-001", result: "true" }])),
    );
    await expect(loadPlan("https://api.example.com", "event-1")).resolves.toMatchObject({
      ok: true,
    });
  });

  it("refuses a widened blocker carrying another route's sources or a merged summary", async () => {
    const finding = mergedFinding("true");
    const routes = finding.routes as Record<string, unknown>[];
    const blocking = routes[1] as Record<string, unknown>;
    const whole = {
      ruleIds: [blocking.ruleId as string],
      name: blocking.name as string,
      agency: blocking.agency as string,
      disposition: blocking.disposition as string,
      deadlineDisplay: blocking.deadlineDisplay as string | null,
      latestApplyDate: blocking.latestApplyDate as string | null,
      deadlineStatus: blocking.deadlineStatus as string,
      feeDisplay: blocking.feeDisplay as string | null,
      portalName: blocking.portalName as string | null,
      portalUrl: blocking.portalUrl as string | null,
      portalInstructions: blocking.portalInstructions as string | null,
      sources: [],
      userSummary: null,
    };
    const planWith = (blockingFinding: unknown) => ({
      ...storedPlan,
      verdict: "INFEASIBLE",
      findings: [finding],
      verdictDetail: {
        ...storedPlan.verdictDetail,
        blockingFinding,
        missedRuleIds: [blocking.ruleId as string],
      },
    });

    for (const crossed of [
      {
        sources: [
          { ruleId: "PARKS-EVENT-001", citation: "Parks FAQ", urls: ["https://example.gov/parks"] },
        ],
      },
      {
        userSummary: {
          heading: "Do you need a special event permit?",
          points: [{ kind: "overview", text: "A merged heading.", sources: [] }],
        },
      },
    ]) {
      stubFetch(async () => jsonResponse(200, planWith({ ...whole, ...crossed })));
      await expect(loadPlan("https://api.example.com", "event-1")).resolves.toMatchObject({
        ok: false,
      });
    }

    stubFetch(async () => jsonResponse(200, planWith(whole)));
    await expect(loadPlan("https://api.example.com", "event-1")).resolves.toMatchObject({
      ok: true,
    });
  });

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
    const line = {
      ...storedFinding,
      ruleIds: ["SAPO-STREET-LARGE-001"],
      name: whole.name,
      agency: whole.agency,
      disposition: whole.disposition,
      deadlineDisplay: whole.deadlineDisplay,
      latestApplyDate: whole.latestApplyDate,
      deadlineStatus: whole.deadlineStatus,
      feeDisplay: whole.feeDisplay,
      portalName: whole.portalName,
      portalUrl: whole.portalUrl,
      portalInstructions: whole.portalInstructions,
      sources: [],
    };
    const detailWith = (blockingFinding: unknown) => ({
      ...storedPlan,
      verdict: "INFEASIBLE",
      findings: [line],
      verdictDetail: {
        ...storedPlan.verdictDetail,
        blockingFinding,
        missedRuleIds: ["SAPO-STREET-LARGE-001"],
        trace: [{ ruleId: "SAPO-STREET-LARGE-001", result: "true" }],
      },
    });

    for (const dropped of ["agency", "sources", "portalInstructions", "userSummary"]) {
      const { [dropped]: _gone, ...partial } = whole as Record<string, unknown>;
      stubFetch(async () => jsonResponse(200, detailWith(partial)));
      await expect(loadPlan("https://api.example.com", "event-1")).resolves.toMatchObject({
        ok: false,
      });
    }

    for (const legal of [whole, { ruleIds: whole.ruleIds, name: whole.name }]) {
      stubFetch(async () => jsonResponse(200, detailWith(legal)));
      await expect(loadPlan("https://api.example.com", "event-1")).resolves.toMatchObject({
        ok: true,
      });
    }
  });

  it("refuses a route whose unknown fields contradict its own trigger result", async () => {
    const contradictions = [
      { triggerResult: "unknown", unknownFields: [], headlineMode: "candidate" },
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

  it("refuses a route list that does not match the finding's own rule ids", async () => {
    const merged = mergedFinding("true");
    const [first, second] = merged.routes;
    const bodies = [
      { ...merged, routes: [first, { ...second, ruleId: "PARKS-EVENT-001" }] },
      { ...merged, routes: [first, { ...second, ruleId: "DOB-TENT-001" }] },
      { ...merged, ruleIds: ["PARKS-EVENT-001", "PARKS-EVENT-001"] },
      { ...merged, ruleIds: [...merged.ruleIds, "DOB-TENT-001"] },
    ];
    for (const finding of bodies) {
      stubFetch(async () => jsonResponse(200, { ...storedPlan, findings: [finding] }));
      const result = await loadPlan("https://api.example.com", "event-1");
      expect(result.ok).toBe(false);
    }
  });

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
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith("https://api.example.com/api/events/event-1/plan", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
    });
  });

  it("sends the retained create key for an initial-plan retry", async () => {
    const fetchMock = stubFetch(async () => jsonResponse(200, storedPlan));
    const key = "44f58390-9892-4e1b-b1ed-ecf00ea20967";

    await expect(generatePlan("https://api.example.com", "event-1", key)).resolves.toEqual({
      ok: true,
      plan: storedPlan,
    });
    expect(
      new Headers((fetchMock.mock.calls[0]?.[1] as RequestInit).headers).get("Idempotency-Key"),
    ).toBe(key);
  });

  it("re-reads only when the POST's own body cannot be read", async () => {
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

describe("coverage of every field this feature reads", () => {
  const refusal = {
    ok: false,
    missing: false,
    message: "The API returned a plan this page cannot read.",
  };

  const WRONG = true;

  const expectRefused = async (body: unknown) => {
    stubFetch(async () => jsonResponse(200, body));
    await expect(loadPlan("https://api.example.com", "event-1")).resolves.toEqual(refusal);
  };

  it("validates every plan field the page reads, and nothing it does not", () => {
    expect([...CONSUMED_PLAN_FIELDS].sort()).toEqual([
      "eventRevision",
      "findings",
      "generatedAt",
      "rulesetVersion",
      "snapshotDate",
      "verdict",
      "verdictDetail",
    ]);
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

  it("refuses a verdict token the approved copy does not cover", async () => {
    await expectRefused({ ...storedPlan, verdict: "MAYBE" });
  });

  it("refuses a verification status outside the schema's five", async () => {
    await expectRefused({
      ...storedPlan,
      findings: [{ ...storedFinding, verificationStatus: "PROVISIONAL" }],
    });
  });

  it("refuses a null revision, which is what JSON makes of NaN or Infinity", async () => {
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
