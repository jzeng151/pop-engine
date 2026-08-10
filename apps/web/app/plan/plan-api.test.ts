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
        // GENUINELY MISSED, because the blocker tests below name this route as the blocking one and
        // the boundary now reads the route's own status rather than taking the plan's
        // `missedRuleIds` for it. The binding route above stays `not_applicable`, which is what
        // makes it the on-track sibling those tests contrast against.
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

  /**
   * #252 review: THE HEADLINE IS THE BINDING ROUTE'S, AND NOTHING CHECKED IT.
   *
   * `mergeGroup()` spreads the binding route into the merged finding and leads `routes` with it, so
   * the headline tuple and `routes[0]` are the same rule's values. A body carrying valid matching
   * routes and rule ids beside a headline taken from the OTHER route cleared every check, and the
   * page rendered the crossed tuple as the heading.
   */
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

  /**
   * The approved state where the headline is deliberately nobody's: no resolved route contributes
   * the merged disposition, so the line publishes no scalars and reads `not_calculable`
   * (design §4.3, amended 2026-08-09). It must not be read as a crossed headline.
   */
  it("reads a merged finding that publishes no scalars of its own", async () => {
    const finding = mergedFinding("unknown", "candidate");
    // THE CONDITION, NOT THE SHAPE: a resolved route BELOW `required`, so the unresolved-route
    // ceiling does not bite and the unknown route alone carries the group to `may_be_required`.
    // That is the one case §4.3 publishes no scalars for, and it is what the routes have to show.
    // IN BINDING ORDER, which on this shape is the unresolved route: it is the only one
    // contributing the merged `may_be_required`, so the pool is that route alone even though it is
    // the one whose trigger did not resolve. The line still publishes none of its values.
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

  /**
   * #252 review: THE HEADLINE DISPOSITION HAS TO FOLLOW FROM THE ROUTES.
   *
   * It is excluded from the binding-route comparison on purpose, since the merged value is the
   * strongest any route CONTRIBUTES rather than `routes[0]`'s, and that left it checked by nothing.
   * `PlanLine` renders blocker styling and blocker copy off it, so a headline of
   * `prohibited_or_ineligible` beside two routes that publish `required` and `advisory` is a blocker
   * an organizer is shown that no route in the group states.
   */
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

    // Not vacuous: the value the routes DO contribute reads, and it is the capped one where an
    // unresolved route would otherwise carry the group past a resolved sibling.
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

  /**
   * #252 review: THE SCALAR-FREE STATE IS A CONDITION, NOT A SHAPE.
   *
   * §4.3 publishes no headline scalars in ONE case: the group holds a resolved route and none of
   * them contributes the merged disposition. Accepting the SHAPE alone let any merged group null its
   * name, dates, fee and portal and skip the binding-route comparison, so a plan silently missing
   * every one of those published values passed validation.
   */
  it("refuses an ordinary merged group that nulls its headline", async () => {
    // Both routes resolved and `required`, so a resolved route does contribute the merged
    // disposition and this line has a binding route to read: the scalars are not nobody's.
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

  /**
   * #252 review: THE THIRD TUPLE VALIDATED FOR PRESENCE RATHER THAN FOR AGREEMENT.
   *
   * `blockerView` narrows the merged line to the route whose window closed, so every widened field
   * is that route's. Nothing compared them, so a payload could name one route in `ruleIds` and carry
   * another's date, fee or portal — and `VerdictDetailPanel` reads a widened blocker and turns the
   * legacy fallback OFF, so the crossed tuple reaches the INFEASIBLE panel with nothing behind it.
   */
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
        // The route the blocker names has to be one whose window closed; a payload that says
        // otherwise is refused on its own, which the missed-route test below covers.
        missedRuleIds: [blocking.ruleId as string],
      },
    });

    // Each crossing in turn: a value the NAMED route does not publish.
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

    // Not vacuous: the route's own values read, and so does a plan stored before the narrowing.
    for (const legal of [whole, { ruleIds: whole.ruleIds, name: whole.name }]) {
      stubFetch(async () => jsonResponse(200, planWith(legal)));
      await expect(loadPlan("https://api.example.com", "event-1")).resolves.toMatchObject({
        ok: true,
      });
    }
  });

  /**
   * #252 review: THE PATH AROUND THE PREDICATE, NOT A MISSING CONDITION.
   *
   * A widened blocker whose rule is on no finding of the plan returned early, before any condition
   * ran — and it is exactly the shape that must not be trusted, because carrying the widened keys
   * makes `verdict-detail.tsx` turn its legacy fallback OFF and render the payload's own name,
   * deadline, portal and citations with nothing on the plan to corroborate them. A widened blocker
   * always has its finding: `computeVerdict` narrows it from the same findings it returns, and a
   * stored plan serves its own generation's findings beside its own `verdict_detail`.
   */
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

    // The pre-narrowing shape is still accepted on the same plan: it carries no values to check and
    // the panel keeps its fallback on, so it is not trusted.
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

  /**
   * #252 review: A BLOCKER MUST NAME A ROUTE WHOSE WINDOW CLOSED.
   *
   * The panel's whole sentence is that this route's deadline was missed. Comparing only the tuple,
   * the sources and the summary, a response could list route B in `missedRuleIds` and hand over a
   * perfectly valid narrowed tuple for on-track route A — and the panel would state a miss for a
   * route that has none.
   */
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
      // The route's OWN citations, so this blocker is valid in every other respect and the only
      // thing that can refuse it is that its route's window is not missed.
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

    // A valid tuple for the route that is NOT among the missed ids.
    stubFetch(async () => jsonResponse(200, planWith(blockerFor(onTrack))));
    await expect(loadPlan("https://api.example.com", "event-1")).resolves.toMatchObject({
      ok: false,
    });

    // Not vacuous: the same shape for the route that IS missed reads.
    stubFetch(async () => jsonResponse(200, planWith(blockerFor(missed))));
    await expect(loadPlan("https://api.example.com", "event-1")).resolves.toMatchObject({
      ok: true,
    });
  });

  /**
   * #252 review: A BLOCKER MUST BE A ROUTE THE ENGINE WOULD HAVE BLOCKED ON.
   *
   * Six conditions said the named route is on this plan, is missed, and carries these values. None
   * said the engine reads it as blocking, and `computeWindowVerdict` blocks on a much narrower set:
   * `canBlockWhenMissed` wants a disposition at or above `required`, a trigger that RESOLVED, and a
   * rule that is not OFFICIAL_CONFLICT. A resolved advisory route and an unresolved barred route
   * both satisfy every earlier condition, and either would put INFEASIBLE on the panel for a plan
   * the engine reads as CONDITIONAL.
   */
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
        // The headline is the binding route's, which the boundary checks on its own.
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
          // Every earlier condition is satisfied: one rule, on this plan, missed, values agreeing,
          // its own citations, no merged summary. Only the seventh can refuse these.
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
      // Resolved, missed, and far below the floor. F-102 AC 10.
      [{ ...blockingRoute, disposition: "advisory" }, "SOURCE_CONFIRMED"],
      // A bar whose own trigger never resolved. `resolveDisposition` leaves this one undemoted so
      // it still RENDERS, which is exactly why the verdict has to check the trigger itself (#254).
      [
        { ...blockingRoute, disposition: "prohibited_or_ineligible", triggerResult: "unknown" },
        "SOURCE_CONFIRMED",
      ],
      // A rule whose own reading of its window may be one of the two that disagree.
      [blockingRoute, "OFFICIAL_CONFLICT"],
    ];
    for (const [route, verificationStatus] of refused) {
      stubFetch(async () => jsonResponse(200, planWith(route, verificationStatus)));
      await expect(loadPlan("https://api.example.com", "event-1")).resolves.toMatchObject({
        ok: false,
      });
    }

    // NOT VACUOUS: the same payload with a resolved `required` route on a non-conflict rule reads,
    // so the three refusals are the seventh condition and not some other field of these fixtures.
    stubFetch(async () => jsonResponse(200, planWith(blockingRoute, "SOURCE_CONFIRMED")));
    await expect(loadPlan("https://api.example.com", "event-1")).resolves.toMatchObject({
      ok: true,
    });
  });

  /**
   * #252 review: `routes[0]` WAS THE DEFINITION OF THE BINDING ROUTE RATHER THAN A CLAIM ABOUT IT.
   *
   * Every other check on a merged line hangs off that position — the headline is compared against
   * it, and `plan.ts`'s `filingRouteOf` takes the first route publishing a window BECAUSE the list
   * arrives in binding order. So a body ordering a later or less available route first and copying
   * its tuple into the headline satisfied every per-field comparison, and the line rendered that
   * route's name and its later apply-by date, understating the filing urgency.
   *
   * `bindingRouteOf` is the engine's own selection, exported from beside the merge.
   */
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
    // The engine binds the EARLIER published date where availability ties, so this is the order a
    // served plan carries.
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

    // The later route first, with the headline copied off it, so every per-field check passes.
    stubFetch(async () =>
      jsonResponse(
        200,
        planWith([loose, tight], { name: loose.name, latestApplyDate: loose.latestApplyDate }),
      ),
    );
    await expect(loadPlan("https://api.example.com", "event-1")).resolves.toMatchObject({
      ok: false,
    });

    // NOT VACUOUS: the same two routes in the order the engine produces read, and the headline is
    // then the tighter route's.
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

  /**
   * #252 review: A PROMOTED BLOCKER NAMING A NON-HEADLINE ROUTE, AND THE PROMOTION RULE ITSELF.
   *
   * `evaluateConditional` promotes a blocker out of the branches while returning the unresolved
   * base line, so the blocker's values are the branch's and the base tuple is the wrong thing to
   * compare them to. Two ways that went wrong, both here:
   *
   *   • The comparison used the merged HEADLINE, which is the binding route's. A promoted blocker
   *     can name a different route of the same group — reachable the moment two routes both
   *     publish windows, since an OPEN window binds ahead of a closed one and the missed route is
   *     therefore the non-binding one — and its published name, agency, fee and portal
   *     legitimately differ from the headline's.
   *   • The branch test asked whether SOME branch was infeasible. `resolveVerdict` promotes only
   *     when EVERY path verdict is, so the weaker test let a payload with one infeasible branch
   *     beside a feasible one bypass every narrowed check.
   *
   * NEITHER SHAPE IS REACHABLE ON `nyc-rules.v2.11`, which is why the acceptance sweep does not
   * cover them and this test is hand-built: the file's only multi-member dedupe group has exactly
   * one route publishing a window, and that route therefore always binds.
   */
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
    // The OPEN route binds; the closed one is the blocker and publishes its own name and fee.
    const binding = route({});
    // THE BASE LINE'S OWN ROUTE, which is what the plan returns: its trigger did not resolve, so
    // the engine could not date it. The blocker below is the BRANCH's version of the same rule,
    // dated and missed, which is exactly why the narrowed comparison cannot be the one that
    // accepts it.
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
        // The BRANCH's finding: resolved, dated and missed, unlike the base line above it.
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

    // Every recorded branch closes the plan, and the blocker's published values are the NAMED
    // route's rather than the headline's.
    stubFetch(async () => jsonResponse(200, planWith(["INFEASIBLE", "INFEASIBLE"])));
    stubFetch(async () => jsonResponse(200, planWith(["INFEASIBLE", "INFEASIBLE"])));
    await expect(loadPlan("https://api.example.com", "event-1")).resolves.toMatchObject({
      ok: true,
    });

    // NOT VACUOUS, on the promotion rule: one branch that does not close the plan means the engine
    // would not have promoted anything, so the payload describes a blocker it could not produce.
    for (const verdicts of [["INFEASIBLE", "CONDITIONAL"], ["INFEASIBLE", "FEASIBLE"], []]) {
      stubFetch(async () => jsonResponse(200, planWith(verdicts)));
      await expect(loadPlan("https://api.example.com", "event-1")).resolves.toMatchObject({
        ok: false,
      });
    }

    // AND ON EVERY VALUE A BRANCH CANNOT MOVE. The compared list is derived from
    // `ROUTE_FIELD_ORIGIN`'s published half rather than typed out, so this asserts the derivation
    // reaches each of them — `portalInstructions` above all, which the hand-typed version omitted
    // and which renders as a filing instruction under the blocking route's name.
    const crossed: Record<string, unknown>[] = [
      { name: "Some other permit" },
      { agency: "Some other agency" },
      { feeDisplay: "$1,000,000" },
      { portalName: "Another portal" },
      { portalUrl: "https://example.test/elsewhere" },
      { portalInstructions: "Bring cash to the side door" },
      // A fabricated citation, which rule-id membership on the parent used to admit.
      {
        sources: [
          { ruleId: closed.ruleId, citation: "Invented page", urls: ["https://example.test/no"] },
        ],
      },
      // And a sibling's real one, which it also admitted.
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

  /**
   * #252 review: THE EXCEPTION WAS THE CASE THE ARGUMENT WAS PROTECTING.
   *
   * The previous round left the unmerged trigger result unchecked and argued the gap was narrow,
   * because `resolveDisposition` demotes an unknown-triggered `required` below the blocking floor.
   * True of `required`, and false of the one disposition that matters: `prohibited_or_ineligible`
   * is deliberately left undemoted so a lone barred finding still RENDERS its bar (`proposals.ts`
   * §2, #254). So an unmerged bar whose trigger never resolved clears the floor, and synthesizing
   * `triggerResult: "true"` for it accepted a blocker the engine could not have produced — the
   * panel stating INFEASIBLE off a bar hanging on an unanswered question, which is the exact
   * outcome #254 exists to prevent.
   *
   * The trigger result is read off `verdictDetail.trace` now, which carries one entry per rule.
   */
  it("reads an unmerged blocker's trigger result rather than assuming it resolved", async () => {
    const line = {
      ...storedFinding,
      ruleIds: ["PARKS-PROPANE-001"],
      name: "Propane prohibited in this park",
      disposition: "prohibited_or_ineligible",
      latestApplyDate: "2026-03-01",
      deadlineStatus: "published_deadline_missed",
      // Its own citation, so condition 5 cannot be what refuses these payloads.
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

    // The bar hangs off a question nobody answered. Every other condition is satisfied.
    for (const trace of [
      [{ ruleId: "PARKS-PROPANE-001", result: "unknown" }],
      // And a payload recording no result for it at all: `trace` has been written since plans were
      // first generated, so absence is a payload nothing corroborates rather than a legacy shape.
      [{ ruleId: "SOME-OTHER-RULE-001", result: "true" }],
      undefined,
    ]) {
      stubFetch(async () => jsonResponse(200, detailWith(trace)));
      await expect(loadPlan("https://api.example.com", "event-1")).resolves.toMatchObject({
        ok: false,
      });
    }

    // NOT VACUOUS: the same barred blocker whose trigger DID resolve is exactly what the engine
    // produces for a lone prohibition past its window, and it reads.
    stubFetch(async () =>
      jsonResponse(200, detailWith([{ ruleId: "PARKS-PROPANE-001", result: "true" }])),
    );
    await expect(loadPlan("https://api.example.com", "event-1")).resolves.toMatchObject({
      ok: true,
    });
  });

  /**
   * #252 review: THE TWO FIELDS THE TUPLE CHECK CANNOT REACH.
   *
   * `blockerView` FILTERS the sources to the blocking rule and NULLS a merged summary rather than
   * reattributing it, so neither is comparable field-by-field and both were left out. But
   * `referenceFromFinding` prefers the summary heading and the summary's first source over the
   * finding's own, so a blocker carrying a sibling's sources or a non-null merged summary makes the
   * INFEASIBLE panel name the right route and link to another route's regulatory material.
   */
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
        // The route the blocker names has to be one whose window closed; a payload that says
        // otherwise is refused on its own, which the missed-route test below covers.
        missedRuleIds: [blocking.ruleId as string],
      },
    });

    for (const crossed of [
      // A sibling's citation, which the panel would link from.
      {
        sources: [
          { ruleId: "PARKS-EVENT-001", citation: "Parks FAQ", urls: ["https://example.gov/parks"] },
        ],
      },
      // A merged summary, which the panel prefers over the narrowed name.
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

    // Not vacuous: the narrowed shape the engine serves reads.
    stubFetch(async () => jsonResponse(200, planWith(whole)));
    await expect(loadPlan("https://api.example.com", "event-1")).resolves.toMatchObject({
      ok: true,
    });
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
    // The line the blocker is narrowed FROM. A widened blocker whose rule is on no finding of the
    // plan is refused on its own now, so a fixture without one would prove nothing about the
    // partial-key rule this test is about.
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
        // The line is UNMERGED, so its own trigger result is recorded nowhere but here, and the
        // boundary refuses a blocker it cannot establish rather than reading absence as resolved.
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
