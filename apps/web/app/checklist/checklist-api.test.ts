// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CONSUMED_ITEM_FIELDS,
  createChecklist,
  documentRejection,
  documentUrl,
  loadChecklist,
  MAX_DOCUMENT_BYTES,
  updateChecklistItem,
  uploadDocument,
  uploadKey,
} from "./checklist-api";
import { checklistBody, planContext, STREET_MEDIUM, trackedItem } from "./checklist-fixtures";

/** An event nobody has given a contact for, which is what the store answers by default. */
const NO_CONTACT = { email: null, phone: null };

// `fetch` is stubbed; the api's own behavior is covered by apps/api. What is pinned here is the
// request this page makes and how each answer is reported.

const jsonResponse = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const stubFetch = (implementation: typeof fetch) => {
  const fetchMock = vi.fn(implementation);
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
};

const omit = (record: Record<string, unknown>, field: string): Record<string, unknown> => {
  const { [field]: _dropped, ...rest } = record;
  return rest;
};

const pdf = (name = "permit.pdf", size = 1024): File =>
  new File([new Uint8Array(size)], name, { type: "application/pdf" });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("loadChecklist", () => {
  it("gets the event's checklist with the Access cookie attached", async () => {
    const body = checklistBody({ created: true, items: [trackedItem()] });
    const fetchMock = stubFetch(async () => jsonResponse(200, body));

    const result = await loadChecklist("https://api.example.com", "event-1");

    expect(result.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.example.com/api/events/event-1/checklist",
      expect.objectContaining({ credentials: "include" }),
    );
  });

  it("reports a 404 as the event having no plan, which is a different fact from a failure", async () => {
    stubFetch(async () => jsonResponse(404, { error: "no plan generated for event event-1" }));

    await expect(loadChecklist("https://api.example.com", "event-1")).resolves.toEqual({
      ok: false,
      noPlan: true,
      message: "no plan generated for event event-1",
    });
  });

  it("reports any other status as unavailable rather than as a missing plan", async () => {
    stubFetch(async () => jsonResponse(500, {}));

    await expect(loadChecklist("https://api.example.com", "event-1")).resolves.toEqual({
      ok: false,
      noPlan: false,
      message: "The checklist could not be loaded (HTTP 500).",
    });
  });

  it("reports an unreachable api rather than throwing at the caller", async () => {
    stubFetch(async () => {
      throw new TypeError("network down");
    });

    await expect(loadChecklist("https://api.example.com", "event-1")).resolves.toEqual({
      ok: false,
      noPlan: false,
      message: "The API could not be reached.",
    });
  });

  it("refuses a body that is not a checklist", async () => {
    stubFetch(async () => jsonResponse(200, { items: "not an array" }));

    await expect(loadChecklist("https://api.example.com", "event-1")).resolves.toMatchObject({
      ok: false,
      message: "The API returned a checklist this page cannot read.",
    });
  });

  it("refuses a body whose non-JSON content cannot even be parsed", async () => {
    stubFetch(async () => new Response("<html>Access denied</html>", { status: 403 }));

    await expect(loadChecklist("https://api.example.com", "event-1")).resolves.toEqual({
      ok: false,
      noPlan: false,
      message: "The checklist could not be loaded (HTTP 403).",
    });
  });

  // The point of the consumed-type discipline: a field this page reads cannot go unvalidated.
  // Dropping any one of them has to be refused, whichever it is.
  it.each(CONSUMED_ITEM_FIELDS)("refuses a checklist row missing %s", async (field) => {
    stubFetch(async () =>
      jsonResponse(200, checklistBody({ items: [omit(trackedItem(), field)] })),
    );

    await expect(loadChecklist("https://api.example.com", "event-1")).resolves.toMatchObject({
      ok: false,
      message: "The API returned a checklist this page cannot read.",
    });
  });

  it("reads a checklist from an API that has not deployed the reconciliation notice yet", async () => {
    // Web and api are deployed separately, so a web-first rollout meets an api that does not send
    // `alertsHeldForReconciliation` yet. Refusing the body over it replaces the organizer's whole
    // checklist with "this page cannot read it" for the length of the rollout, to withhold a
    // notice that has nothing to report until the api can report it. Absent is read as none —
    // which is what it is — and every other field stays as strictly checked as before.
    const body = checklistBody({ created: true, items: [trackedItem()] }) as Record<
      string,
      unknown
    >;
    stubFetch(async () => jsonResponse(200, omit(body, "alertsHeldForReconciliation")));

    const result = await loadChecklist("https://api.example.com", "event-1");

    expect(result).toMatchObject({ ok: true });
    expect(result.ok && result.checklist.alertsHeldForReconciliation).toEqual([]);
  });

  it("reads a failed delivery from an API that does not qualify the paused notice yet", async () => {
    // Same rollout, one field further in: web goes first, so this page meets an api whose failed
    // deliveries carry no `attemptedWithoutOutcome`. Refusing the body would cost the organizer
    // the whole checklist over a qualification, and inventing `false` would be a claim the api did
    // not make. Absent stays absent and the notice says what it said before.
    stubFetch(async () =>
      jsonResponse(
        200,
        checklistBody({
          created: true,
          items: [trackedItem()],
          failedAlertDeliveries: [{ channel: "email", failedCount: 1, heldForReview: true }],
        }),
      ),
    );

    const result = await loadChecklist("https://api.example.com", "event-1");

    expect(result).toMatchObject({ ok: true });
    expect(result.ok && result.checklist.failedAlertDeliveries[0]?.attemptedWithoutOutcome).toBe(
      undefined,
    );
  });

  it("refuses a failed delivery whose qualification is not a boolean", async () => {
    // Optional is not unchecked: a field this page reads still has to prove its type when it is
    // there, which is the consumed-type discipline the rest of this suite pins.
    stubFetch(async () =>
      jsonResponse(
        200,
        checklistBody({
          created: true,
          items: [trackedItem()],
          failedAlertDeliveries: [
            {
              channel: "email",
              failedCount: 1,
              heldForReview: true,
              attemptedWithoutOutcome: "yes",
            },
          ],
        }),
      ),
    );

    await expect(loadChecklist("https://api.example.com", "event-1")).resolves.toMatchObject({
      ok: false,
      message: "The API returned a checklist this page cannot read.",
    });
  });

  it("refuses a row whose source plan is missing its snapshot pair", async () => {
    stubFetch(async () =>
      jsonResponse(
        200,
        checklistBody({
          items: [{ ...trackedItem(), sourcePlan: { rulesetVersion: "nyc.v2.7" } }],
        }),
      ),
    );

    await expect(loadChecklist("https://api.example.com", "event-1")).resolves.toMatchObject({
      ok: false,
    });
  });

  it("accepts a source plan whose snapshot date was never recorded", async () => {
    stubFetch(async () =>
      jsonResponse(
        200,
        checklistBody({
          items: [
            { ...trackedItem(), sourcePlan: { rulesetVersion: "nyc.v2.5", snapshotDate: null } },
          ],
        }),
      ),
    );

    await expect(loadChecklist("https://api.example.com", "event-1")).resolves.toMatchObject({
      ok: true,
    });
  });

  it("refuses a context line that is not shaped like plan context", async () => {
    stubFetch(async () =>
      jsonResponse(
        200,
        checklistBody({ contextItems: [omit(planContext(STREET_MEDIUM), "disposition")] }),
      ),
    );

    await expect(loadChecklist("https://api.example.com", "event-1")).resolves.toMatchObject({
      ok: false,
    });
  });

  /**
   * #252: the checklist serves `routes` and `headlineMode` exactly as the plan endpoint does, and
   * until now applied none of the plan boundary's cross-field rules to them. `PlanContextBody`
   * reads routes only in `candidate` mode, so a row claiming `applies_together` over a route whose
   * own trigger is `unknown` had the deciding question suppressed on the surface the organizer
   * works the item through: a material unknown disappearing, which is what the engine invariants
   * forbid. The row and the context line are both checked, and both halves of the presence rule.
   */
  const mergedRoutes = (triggerResult: string) => [
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
      slackDays: null,
      feeDisplay: null,
      portalName: null,
      portalUrl: null,
      portalInstructions: null,
    },
    {
      ruleId: "SAPO-PERMIT-001",
      triggerResult,
      // The pair the engine produces: an unresolved trigger always names the field it stopped on,
      // and a resolved one names none, which the boundary now reads rather than assumes.
      unknownFields: triggerResult === "unknown" ? ["sapo_event_type"] : [],
      disposition: "required",
      name: "SAPO permit",
      agency: "SAPO (CECM)",
      deadline: null,
      deadlineDisplay: null,
      latestApplyDate: null,
      applyAfterDate: null,
      deadlineStatus: "not_applicable",
      slackDays: null,
      feeDisplay: null,
      portalName: null,
      portalUrl: null,
      portalInstructions: null,
    },
  ];

  it("reads a checklist whose routes and headline mode agree", async () => {
    for (const [triggerResult, headlineMode] of [
      ["true", "applies_together"],
      ["unknown", "candidate"],
    ]) {
      stubFetch(async () =>
        jsonResponse(
          200,
          checklistBody({
            items: [
              trackedItem(STREET_MEDIUM, {
                routes: mergedRoutes(triggerResult as string),
                headlineMode,
                filingRouteRuleId: null,
              }),
            ],
          }),
        ),
      );

      await expect(loadChecklist("https://api.example.com", "event-1")).resolves.toMatchObject({
        ok: true,
      });
    }
  });

  it("refuses a checklist row whose headline mode its own routes contradict", async () => {
    for (const [triggerResult, headlineMode] of [
      ["unknown", "applies_together"],
      ["true", "candidate"],
    ]) {
      stubFetch(async () =>
        jsonResponse(
          200,
          checklistBody({
            items: [
              trackedItem(STREET_MEDIUM, {
                routes: mergedRoutes(triggerResult as string),
                headlineMode,
                filingRouteRuleId: null,
              }),
            ],
          }),
        ),
      );

      await expect(loadChecklist("https://api.example.com", "event-1")).resolves.toMatchObject({
        ok: false,
      });
    }
  });

  /**
   * #252 review: the same invariant the plan boundary applies, at the door the organizer works the
   * item through. `routes` and `ruleIds` are built from one group, so a row repeating one rule's
   * route, or carrying a route for a rule the row does not name, renders the duplicate while the
   * other rule's window, fee and portal are absent from a row that names it.
   */
  it("refuses a row whose routes do not match its own rule ids", async () => {
    const routes = mergedRoutes("true");
    const rows = [
      // Two routes, both the same rule.
      { routes: [routes[0], { ...routes[1], ruleId: "PARKS-EVENT-001" }] },
      // A route for a rule the row does not name.
      { routes, ruleIds: ["PARKS-EVENT-001", "DOB-TENT-001"] },
      // A third rule named with no route of its own.
      { routes, ruleIds: ["PARKS-EVENT-001", "SAPO-PERMIT-001", "DOB-TENT-001"] },
    ];
    for (const row of rows) {
      stubFetch(async () =>
        jsonResponse(
          200,
          checklistBody({
            items: [
              trackedItem(STREET_MEDIUM, {
                ...row,
                headlineMode: "applies_together",
                filingRouteRuleId: null,
              }),
            ],
          }),
        ),
      );

      await expect(loadChecklist("https://api.example.com", "event-1")).resolves.toMatchObject({
        ok: false,
      });
    }
  });

  /**
   * #252 review: the sibling invariant, on the one field only this boundary carries.
   * `filingRouteRuleId` names the route the window, status, fee and filing details were read off,
   * and the api sets it from a route of the row's own list. Named as anything else, `PlanContextBody`
   * resolves no route, drops the attribution sentence and leaves the alternate route's date, fee and
   * portal rendered under the binding permit's heading — crossed values reading as a complete row.
   */
  it("refuses a filing-route id that is not one of the row's own routes", async () => {
    const routes = mergedRoutes("true");
    const rows = [
      // A rule the row does not carry a route for.
      { routes, headlineMode: "applies_together", filingRouteRuleId: "DOB-TENT-001" },
      // No route list at all, so the id names nothing.
      { filingRouteRuleId: "PARKS-EVENT-001" },
    ];
    for (const row of rows) {
      stubFetch(async () =>
        jsonResponse(200, checklistBody({ items: [trackedItem(STREET_MEDIUM, row)] })),
      );

      await expect(loadChecklist("https://api.example.com", "event-1")).resolves.toMatchObject({
        ok: false,
      });
    }
  });

  /**
   * #252 review: the sibling of the plan boundary's widened-blocker group. The api writes `routes`,
   * `headlineMode` and `filingRouteRuleId` in one object literal, so a row carrying some of them is
   * one no deployment produces, and the missing field is not read as missing: `gatedRoutesOf` falls
   * back to `routes[0]` when `filingRouteRuleId` is absent, so the row silently treats the first
   * route as the one its scalars came from and skips that route's gate.
   */
  it("refuses a row carrying only part of the route group", async () => {
    const routes = mergedRoutes("true");
    const partials = [
      { routes, headlineMode: "applies_together" },
      { routes, filingRouteRuleId: null },
      { headlineMode: "applies_together", filingRouteRuleId: null },
    ];
    for (const partial of partials) {
      const item = trackedItem(STREET_MEDIUM, partial) as Record<string, unknown>;
      for (const field of ["routes", "headlineMode", "filingRouteRuleId"]) {
        if (!(field in partial)) delete item[field];
      }
      stubFetch(async () => jsonResponse(200, checklistBody({ items: [item] })));

      await expect(loadChecklist("https://api.example.com", "event-1")).resolves.toMatchObject({
        ok: false,
      });
    }
  });

  /** Absence of all three is the api deployed before the checklist served routes, and still reads. */
  it("reads a row from an api that serves none of the route group", async () => {
    const item = trackedItem() as Record<string, unknown>;
    for (const field of ["routes", "headlineMode", "filingRouteRuleId"]) delete item[field];
    stubFetch(async () => jsonResponse(200, checklistBody({ items: [item] })));

    await expect(loadChecklist("https://api.example.com", "event-1")).resolves.toMatchObject({
      ok: true,
    });
  });

  /**
   * #252 review: NAMING THE RIGHT ROUTE IS NOT THE SAME AS CARRYING ITS VALUES. Membership alone
   * still accepted a row whose date, status, fee or portal came from a different route than the one
   * it names, and `PlanContextBody` states in as many words that the filing details above belong to
   * the named route — so the row asserts an attribution that is false rather than dropping one.
   */
  it("refuses a row whose filing fields are not the named route's", async () => {
    const routes = mergedRoutes("true");
    const named = routes[1] as Record<string, unknown>;
    const crossed = [
      { latestApplyDate: "2026-09-30" },
      { feeDisplay: "$1,050 licence fee" },
      { portalUrl: "https://example.test/elsewhere" },
      { deadlineStatus: "published_deadline_missed" },
    ];
    for (const override of crossed) {
      stubFetch(async () =>
        jsonResponse(
          200,
          checklistBody({
            items: [
              trackedItem(STREET_MEDIUM, {
                routes,
                headlineMode: "applies_together",
                filingRouteRuleId: named.ruleId,
                ...override,
              }),
            ],
          }),
        ),
      );

      await expect(loadChecklist("https://api.example.com", "event-1")).resolves.toMatchObject({
        ok: false,
      });
    }
  });

  /** The other half, so the check cannot be written as "a filing route id is never accepted". */
  it("reads a row whose filing-route id names one of its own routes", async () => {
    stubFetch(async () =>
      jsonResponse(
        200,
        checklistBody({
          items: [
            trackedItem(STREET_MEDIUM, {
              routes: mergedRoutes("true"),
              headlineMode: "applies_together",
              filingRouteRuleId: "SAPO-PERMIT-001",
            }),
          ],
        }),
      ),
    );

    await expect(loadChecklist("https://api.example.com", "event-1")).resolves.toMatchObject({
      ok: true,
    });
  });

  it("refuses a context line carrying only one of the two route fields", async () => {
    for (const half of [
      { routes: mergedRoutes("true") },
      { headlineMode: "applies_together", routes: null },
    ]) {
      stubFetch(async () =>
        jsonResponse(
          200,
          checklistBody({
            contextItems: [planContext(STREET_MEDIUM, { ...half, filingRouteRuleId: null })],
          }),
        ),
      );

      await expect(loadChecklist("https://api.example.com", "event-1")).resolves.toMatchObject({
        ok: false,
      });
    }
  });

  it("refuses a status the engine does not publish", async () => {
    stubFetch(async () =>
      jsonResponse(200, checklistBody({ items: [{ ...trackedItem(), status: "filed" }] })),
    );

    await expect(loadChecklist("https://api.example.com", "event-1")).resolves.toMatchObject({
      ok: false,
    });
  });
});

describe("createChecklist", () => {
  it("posts once and installs the checklist the api answered with", async () => {
    const body = checklistBody({ created: true, items: [trackedItem()] });
    const fetchMock = stubFetch(async () => jsonResponse(201, body));

    const result = await createChecklist(
      "https://api.example.com",
      "event-1",
      "plan-1",
      NO_CONTACT,
    );

    expect(result).toMatchObject({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.example.com/api/events/event-1/checklist",
      expect.objectContaining({
        method: "POST",
        credentials: "include",
        // The plan the page was showing rides on the request. Without it the api has no way to
        // tell a review of THIS plan from a review of whatever arrived while the page was open.
        // The contact rides with it because converting is what schedules the alerts (F-203), and
        // an event nobody has given one for states that as null rather than omitting the field.
        body: JSON.stringify({ planId: "plan-1", contactEmail: null, contactPhone: null }),
      }),
    );
  });

  it("sends the contact with the conversion, because that is what schedules the alerts", async () => {
    // This call used to carry no body at all, so the api parsed no contacts, resolved no channel
    // and scheduled nothing: F-203 was unreachable from the product and only a direct API caller
    // could exercise it.
    const fetchMock = stubFetch(async () => jsonResponse(201, checklistBody({ created: true })));

    await createChecklist("https://api.example.com", "event-1", "plan-1", {
      email: "organizer@example.test",
      phone: "+15555550123",
    });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toEqual({
      planId: "plan-1",
      contactEmail: "organizer@example.test",
      contactPhone: "+15555550123",
    });
  });

  it("sends an emptied box as null, which is how the api is told to clear it", async () => {
    const fetchMock = stubFetch(async () => jsonResponse(201, checklistBody({ created: true })));

    await createChecklist("https://api.example.com", "event-1", "plan-1", {
      email: "a@b.test",
      phone: "",
    });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    // "" is a browser form reporting a field the organizer cleared, and null is the api's word
    // for that. Sending "" would be refused as not a phone number.
    expect(JSON.parse(String(init.body))).toEqual({
      planId: "plan-1",
      contactEmail: "a@b.test",
      contactPhone: null,
    });
  });

  // Edge case: created twice is idempotent. The api answers 200 with the checklist that already
  // exists rather than 201 with a second one, and the client treats both as the current checklist.
  it("takes a 200 as the existing checklist, not as a second one", async () => {
    const existing = checklistBody({
      created: true,
      items: [trackedItem(STREET_MEDIUM, { id: "item-1" })],
    });
    stubFetch(async () => jsonResponse(200, existing));

    const result = await createChecklist(
      "https://api.example.com",
      "event-1",
      "plan-1",
      NO_CONTACT,
    );

    expect(result.ok && result.checklist.items.map((item) => item.id)).toEqual(["item-1"]);
  });

  it("reports a refused conversion with the api's own reason", async () => {
    stubFetch(async () =>
      jsonResponse(409, { error: "plan was generated against revision 1, but the event is at 2" }),
    );

    await expect(
      createChecklist("https://api.example.com", "event-1", "plan-1", NO_CONTACT),
    ).resolves.toEqual({
      ok: false,
      noPlan: false,
      message: "plan was generated against revision 1, but the event is at 2",
    });
  });

  it("reports an unreachable api", async () => {
    stubFetch(async () => {
      throw new TypeError("network down");
    });

    await expect(
      createChecklist("https://api.example.com", "event-1", "plan-1", NO_CONTACT),
    ).resolves.toMatchObject({
      ok: false,
      message: "The API could not be reached.",
    });
  });

  it("reports a 404 as the event having no plan to convert", async () => {
    stubFetch(async () => jsonResponse(404, {}));

    await expect(
      createChecklist("https://api.example.com", "event-1", "plan-1", NO_CONTACT),
    ).resolves.toMatchObject({
      ok: false,
      noPlan: true,
    });
  });

  it("refuses a created checklist it cannot read", async () => {
    stubFetch(async () => jsonResponse(201, { created: "yes" }));

    await expect(
      createChecklist("https://api.example.com", "event-1", "plan-1", NO_CONTACT),
    ).resolves.toMatchObject({
      ok: false,
      message: "The API returned a checklist this page cannot read.",
    });
  });
});

describe("updateChecklistItem", () => {
  it("patches a status and returns the row the api stored", async () => {
    const fetchMock = stubFetch(async () =>
      jsonResponse(200, { id: "item-1", planItemId: "pi-1", status: "submitted", notes: null }),
    );

    const result = await updateChecklistItem("https://api.example.com", "item-1", {
      status: "submitted",
    });

    expect(result).toEqual({
      ok: true,
      item: { id: "item-1", planItemId: "pi-1", status: "submitted", notes: null },
    });
    expect(fetchMock.mock.calls[0]?.[0]).toBe("https://api.example.com/api/checklist-items/item-1");
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      method: "PATCH",
      body: JSON.stringify({ status: "submitted" }),
    });
  });

  it("patches notes, including clearing them", async () => {
    const fetchMock = stubFetch(async () =>
      jsonResponse(200, { id: "item-1", status: "not_started", notes: null }),
    );

    await updateChecklistItem("https://api.example.com", "item-1", { notes: "" });

    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ body: JSON.stringify({ notes: "" }) });
  });

  it("reports the api's reason for refusing an update", async () => {
    stubFetch(async () => jsonResponse(404, { error: "checklist item item-9 not found" }));

    await expect(
      updateChecklistItem("https://api.example.com", "item-9", { status: "approved" }),
    ).resolves.toEqual({ ok: false, message: "checklist item item-9 not found" });
  });

  it("reports an unreachable api", async () => {
    stubFetch(async () => {
      throw new TypeError("network down");
    });

    await expect(
      updateChecklistItem("https://api.example.com", "item-1", { status: "approved" }),
    ).resolves.toEqual({ ok: false, message: "The API could not be reached." });
  });

  it("falls back to a status-bearing message when the api sends no reason", async () => {
    stubFetch(async () => jsonResponse(500, {}));

    await expect(
      updateChecklistItem("https://api.example.com", "item-1", { status: "approved" }),
    ).resolves.toEqual({ ok: false, message: "The item could not be updated (HTTP 500)." });
  });

  it("refuses an updated row it cannot read", async () => {
    stubFetch(async () => jsonResponse(200, { id: "item-1", status: "filed", notes: null }));

    await expect(
      updateChecklistItem("https://api.example.com", "item-1", { status: "approved" }),
    ).resolves.toEqual({ ok: false, message: "The API returned an item this page cannot read." });
  });
});

describe("documentRejection", () => {
  it("accepts the three published types", () => {
    expect(documentRejection(pdf())).toBeNull();
    expect(documentRejection(new File(["x"], "a.png", { type: "image/png" }))).toBeNull();
    expect(documentRejection(new File(["x"], "a.jpg", { type: "image/jpeg" }))).toBeNull();
  });

  it("refuses anything else", () => {
    expect(documentRejection(new File(["x"], "a.docx", { type: "application/msword" }))).toBe(
      "Documents must be a PDF, PNG or JPG.",
    );
  });

  it("refuses a file over 10 MB at the boundary and accepts one exactly at it", () => {
    expect(documentRejection(pdf("big.pdf", MAX_DOCUMENT_BYTES + 1))).toBe(
      "Documents must be 10 MB or smaller.",
    );
    expect(documentRejection(pdf("exact.pdf", MAX_DOCUMENT_BYTES))).toBeNull();
  });

  it("refuses an empty file, which the api would refuse too", () => {
    expect(documentRejection(pdf("empty.pdf", 0))).toBe("That file is empty.");
  });
});

describe("uploadDocument", () => {
  it("streams the file with its declared type and its display name", async () => {
    const fetchMock = stubFetch(async () =>
      jsonResponse(201, {
        id: "doc-1",
        filename: "permit.pdf",
        contentType: "application/pdf",
        sizeBytes: 1024,
        uploadedAt: "2026-07-26T00:00:00.000Z",
      }),
    );

    const result = await uploadDocument("https://api.example.com", "item-1", pdf());

    expect(result).toMatchObject({ ok: true, document: { id: "doc-1", filename: "permit.pdf" } });
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "https://api.example.com/api/checklist-items/item-1/documents",
    );
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/pdf", "X-Filename": "permit.pdf" },
    });
  });

  // A header value is a ByteString, so assigning a name outside it throws while the request is
  // being constructed — before a byte is sent — and the throw lands in the same catch as a network
  // failure. A valid PDF was unuploadable and the organizer was told the api was unreachable.
  it.each([
    ["Chinese", "\u6587\u4ef6.pdf", "%E6%96%87%E4%BB%B6.pdf"],
    ["emoji", "\ud83d\ude00.pdf", "%F0%9F%98%80.pdf"],
    [
      "Cyrillic",
      "\u0437\u0430\u044f\u0432\u043a\u0430.pdf",
      "%D0%B7%D0%B0%D1%8F%D0%B2%D0%BA%D0%B0.pdf",
    ],
  ])("sends a %s filename percent-encoded rather than throwing", async (_label, name, encoded) => {
    // The stub builds a `Headers` from the init the way a real `fetch` does, so an unencodable
    // value throws here exactly as it would in a browser. Without that step this test would assert
    // the workaround while the bug it exists for went unreproduced.
    const fetchMock = stubFetch(async (_input, init) => {
      new Headers(init?.headers);
      return jsonResponse(201, { id: "doc-1", filename: name });
    });

    const result = await uploadDocument("https://api.example.com", "item-1", pdf(name));

    expect(result).toEqual({ ok: true, document: { id: "doc-1", filename: name } });
    expect((fetchMock.mock.calls[0]?.[1]?.headers as Record<string, string>)["X-Filename"]).toBe(
      encoded,
    );
  });

  // The key has to survive a page reload, because the case it exists for is an organizer whose
  // upload was interrupted, who refreshes and picks the same file again. Nothing is stored to
  // achieve that: the key is a function of the file, so re-selecting it reproduces the key in a
  // new tab, a new session, or a restarted browser.
  it("derives an upload key that a fresh File object reproduces", () => {
    const bytes = new Uint8Array(8);
    const picked = new File([bytes], "\u7533\u8bf7\u4e66.pdf", {
      type: "application/pdf",
      lastModified: 1769472000000,
    });
    // The same file, chosen again after a reload: a different object, same attributes.
    const repicked = new File([bytes], "\u7533\u8bf7\u4e66.pdf", {
      type: "application/pdf",
      lastModified: 1769472000000,
    });

    expect(uploadKey(repicked)).toBe(uploadKey(picked));
    // ASCII by construction, so it is a legal header value with no encoding step of its own.
    expect([...uploadKey(picked)].every((character) => character.charCodeAt(0) <= 0x7f)).toBe(true);
  });

  it("derives a different key for a file edited under the same name", () => {
    const original = new File([new Uint8Array(8)], "application.pdf", {
      type: "application/pdf",
      lastModified: 1769472000000,
    });
    const corrected = new File([new Uint8Array(9)], "application.pdf", {
      type: "application/pdf",
      lastModified: 1769558400000,
    });

    // Replacing a filed application is a new document, not a repeat of the old one.
    expect(uploadKey(corrected)).not.toBe(uploadKey(original));
  });

  it("sends the upload key so the api can make a repeat the same document", async () => {
    const fetchMock = stubFetch(async () => jsonResponse(201, { id: "doc-1", filename: "a.pdf" }));
    const file = new File([new Uint8Array(8)], "a.pdf", {
      type: "application/pdf",
      lastModified: 1769472000000,
    });

    await uploadDocument("https://api.example.com", "item-1", file);

    expect((fetchMock.mock.calls[0]?.[1]?.headers as Record<string, string>)["X-Upload-Key"]).toBe(
      uploadKey(file),
    );
  });

  it("refuses to let an unencodable filename be reported as the api being unreachable", () => {
    // The defect, pinned as platform behaviour rather than described: a header value is a
    // ByteString, so this is what the old code did while constructing the request — before a byte
    // was sent — and the throw landed in the same catch as a network failure.
    // Matched on the message, not `instanceof TypeError`: jsdom throws from its own realm, so the
    // constructor identity differs from this file's global.
    expect(() => new Headers({ "X-Filename": "\u6587\u4ef6.pdf" })).toThrow(
      /not a valid ByteString/,
    );
    expect(
      () => new Headers({ "X-Filename": encodeURIComponent("\u6587\u4ef6.pdf") }),
    ).not.toThrow();
  });

  // The api stored nothing and said so: a storage failure keeps the item's state and writes no
  // metadata row, and a refusal never reached storage. Both are safe to resend.
  it.each([
    [
      503,
      { error: "document storage is unavailable", retryable: true },
      "document storage is unavailable",
    ],
    [415, { error: "content type must be one of ..." }, "content type must be one of ..."],
    [
      413,
      { error: "document must be 10485760 bytes or smaller" },
      "document must be 10485760 bytes or smaller",
    ],
  ])("reports an api refusal (%i) as having stored nothing", async (status, body, message) => {
    stubFetch(async () => jsonResponse(status, body));

    await expect(uploadDocument("https://api.example.com", "item-1", pdf())).resolves.toEqual({
      ok: false,
      outcome: "not_stored",
      message,
    });
  });

  // The defect this replaced: `fetch` rejects for every failure that leaves no response, which
  // includes a connection dropped AFTER the body was sent, processed and committed. The old branch
  // claimed nothing had been stored and invited a retry, and the api mints a fresh document id and
  // storage key per request, so that retry stored a second copy.
  it("reports a request that never completed as an unknown outcome, not a safe retry", async () => {
    stubFetch(async () => {
      throw new TypeError("network down");
    });

    await expect(uploadDocument("https://api.example.com", "item-1", pdf())).resolves.toEqual({
      ok: false,
      outcome: "unknown",
      message: "The connection did not complete, so whether this document was stored is not known.",
    });
  });

  // The api can answer AND still not know. When the metadata insert's result is lost and the
  // lookup that would settle it also fails, it keeps the object and says so on the wire; reading
  // that 500 as a safe retry is what duplicates a committed row.
  it("carries the api's own unknown outcome rather than flattening it into a safe retry", async () => {
    stubFetch(async () =>
      jsonResponse(500, {
        error: "the document may have been stored; the checklist will show whether it was",
        storedOutcome: "unknown",
      }),
    );

    await expect(uploadDocument("https://api.example.com", "item-1", pdf())).resolves.toEqual({
      ok: false,
      outcome: "unknown",
      message: "the document may have been stored; the checklist will show whether it was",
    });
  });

  it("still treats an unmarked failure as having stored nothing", async () => {
    // The api marks only the case it cannot settle; everything else it either refused before
    // storage or compensated by deleting the object.
    stubFetch(async () => jsonResponse(500, { error: "checklist request failed" }));

    await expect(uploadDocument("https://api.example.com", "item-1", pdf())).resolves.toMatchObject(
      {
        outcome: "not_stored",
      },
    );
  });

  it("reports a 2xx with an unreadable body as stored, because it is", async () => {
    stubFetch(async () => jsonResponse(201, { id: 7 }));

    await expect(uploadDocument("https://api.example.com", "item-1", pdf())).resolves.toEqual({
      ok: false,
      outcome: "stored",
      message: "The document was uploaded, but the API returned a response this page cannot read.",
    });
  });

  it("falls back to a status-bearing message when the api sends no reason", async () => {
    stubFetch(async () => jsonResponse(500, {}));

    await expect(uploadDocument("https://api.example.com", "item-1", pdf())).resolves.toMatchObject(
      { message: "The document could not be uploaded (HTTP 500)." },
    );
  });
});

describe("documentUrl", () => {
  it("reads the short-lived signed URL", async () => {
    const fetchMock = stubFetch(async () =>
      jsonResponse(200, {
        url: "https://storage.example.com/signed",
        filename: "permit.pdf",
        expiresInSeconds: 300,
      }),
    );

    await expect(documentUrl("https://api.example.com", "doc-1")).resolves.toEqual({
      ok: true,
      url: "https://storage.example.com/signed",
    });
    expect(fetchMock.mock.calls[0]?.[0]).toBe("https://api.example.com/api/documents/doc-1/url");
  });

  it("reports a missing document", async () => {
    stubFetch(async () => jsonResponse(404, { error: "document doc-9 not found" }));

    await expect(documentUrl("https://api.example.com", "doc-9")).resolves.toEqual({
      ok: false,
      message: "document doc-9 not found",
    });
  });

  it("reports an unreachable api", async () => {
    stubFetch(async () => {
      throw new TypeError("network down");
    });

    await expect(documentUrl("https://api.example.com", "doc-1")).resolves.toEqual({
      ok: false,
      message: "The API could not be reached.",
    });
  });

  it("falls back to a status-bearing message when the api sends no reason", async () => {
    stubFetch(async () => jsonResponse(500, {}));

    await expect(documentUrl("https://api.example.com", "doc-1")).resolves.toEqual({
      ok: false,
      message: "The document link could not be read (HTTP 500).",
    });
  });

  it("refuses an empty link rather than opening nothing", async () => {
    stubFetch(async () => jsonResponse(200, { url: "" }));

    await expect(documentUrl("https://api.example.com", "doc-1")).resolves.toEqual({
      ok: false,
      message: "The API returned a download link this page cannot read.",
    });
  });
});
