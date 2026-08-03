// @vitest-environment jsdom

// F-101 Acceptance Criterion 8: editing a field after a plan exists bumps `revision_counter`,
// marks the plan stale in the UI, and offers one-click regeneration. The intake form used to
// render that notice itself; since the edit save redirects to this overview, the affordance has
// to live where the organizer lands or the criterion has nowhere to happen.

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PlanStaleNotice } from "./plan-stale-notice";

const PINNED_VERSION = "nyc.v2.11";

const eventResponse = (planStale: boolean, revision = 3) =>
  new Response(
    JSON.stringify({
      event: { id: "event-9", name: "Night Market", revision_counter: revision },
      plan_stale: planStale,
    }),
    { headers: { "Content-Type": "application/json" }, status: 200 },
  );

const planResponse = (rulesetVersion = PINNED_VERSION) =>
  new Response(
    JSON.stringify({
      eventRevision: 3,
      rulesetVersion,
      snapshotDate: "2026-07-01",
      verdict: "CONDITIONAL",
      verdictDetail: {
        minSlackDays: null,
        missingFacts: [],
        blockingFinding: null,
        missedRuleIds: [],
        unresolvedTimelines: [],
        rescopeSuggestions: [],
      },
      generatedAt: "2026-08-02T12:00:00.000Z",
      findings: [],
    }),
    { headers: { "Content-Type": "application/json" }, status: 200 },
  );

const metaResponse = (rulesetVersion = PINNED_VERSION) =>
  new Response(JSON.stringify({ ruleset_version: rulesetVersion, snapshot_date: "2026-07-01" }), {
    headers: { "Content-Type": "application/json" },
    status: 200,
  });

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/**
 * Answers the four calls this notice can make, the way the api does: the event, the stored plan,
 * the ruleset the service is running, and the regeneration POST. The service defaults to the
 * version the plan pinned, so the downgrade guard stays open unless a test moves it.
 */
const respondWith = ({
  event = () => eventResponse(true),
  plan = () => planResponse(),
  meta = () => metaResponse(),
  regeneration = () =>
    new Response(JSON.stringify({ eventRevision: 3 }), {
      headers: { "Content-Type": "application/json" },
      status: 201,
    }),
}: {
  event?: () => Response;
  plan?: () => Response;
  meta?: () => Response;
  regeneration?: () => Response;
} = {}) => {
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    if (init?.method === "POST") return regeneration();
    if (url.endsWith("/api/rules/meta")) return meta();
    if (url.endsWith("/plan")) return plan();
    return event();
  });
};

const renderNotice = (eventId = "event-9") =>
  render(<PlanStaleNotice apiBaseUrl="https://api.example.com" eventId={eventId} />);

const notice = (eventId: string) => (
  <PlanStaleNotice apiBaseUrl="https://api.example.com" eventId={eventId} />
);

describe("the stale-plan notice on the event overview", () => {
  it("says nothing at all when the plan is current", async () => {
    respondWith({ event: () => eventResponse(false) });

    renderNotice();

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(screen.queryByRole("button", { name: "Regenerate plan" })).toBeNull();
  });

  it("reports the stale plan and regenerates it in one click", async () => {
    const user = userEvent.setup();
    let regenerated = false;
    respondWith({
      event: () => eventResponse(!regenerated),
      regeneration: () => {
        regenerated = true;
        return new Response(JSON.stringify({ eventRevision: 3 }), {
          headers: { "Content-Type": "application/json" },
          status: 201,
        });
      },
    });

    renderNotice();

    const button = await screen.findByRole("button", { name: "Regenerate plan" });
    expect(button.hasAttribute("disabled")).toBe(false);
    await user.click(button);

    expect((await screen.findByRole("status")).textContent).toBe(
      "Plan regenerated for revision 3.",
    );
    expect(screen.queryByRole("button", { name: "Regenerate plan" })).toBeNull();
    const regeneration = fetchMock.mock.calls.find(
      (call) => (call[1] as RequestInit | undefined)?.method === "POST",
    );
    expect(regeneration?.[0]).toBe("https://api.example.com/api/events/event-9/plan");
  });

  // React reuses a component instance across a prop change, so the state below belongs to whichever
  // event was last read. Left alone it describes the previous one, and the button it keeps enabled
  // posts against the new one — a second immutable plan (AD-7) for an event nobody said was stale.
  const respondPerEvent = (staleEventId: string, regenerated = { done: false }) => {
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (init?.method === "POST") {
        regenerated.done = true;
        return new Response(JSON.stringify({ eventRevision: 3 }), {
          headers: { "Content-Type": "application/json" },
          status: 201,
        });
      }
      if (url.endsWith("/api/rules/meta")) return metaResponse();
      if (url.endsWith("/plan")) return planResponse();
      return eventResponse(url.includes(staleEventId) && !regenerated.done);
    });
  };

  it("clears the stale warning when it is reused for an event that is not stale", async () => {
    respondPerEvent("event-9");

    const { rerender } = renderNotice();
    await screen.findByRole("button", { name: "Regenerate plan" });

    rerender(notice("event-10"));

    await vi.waitFor(() =>
      expect(screen.queryByText(/edited since its plan was generated/)).toBeNull(),
    );
    expect(screen.queryByRole("button", { name: "Regenerate plan" })).toBeNull();
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("does not report one event's regeneration against the event that replaced it", async () => {
    const user = userEvent.setup();
    respondPerEvent("event-9");

    const { rerender } = renderNotice();
    await user.click(await screen.findByRole("button", { name: "Regenerate plan" }));
    rerender(notice("event-10"));

    await vi.waitFor(() =>
      expect(screen.queryByText(/edited since its plan was generated/)).toBeNull(),
    );
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("keeps the warning and says why when regeneration fails", async () => {
    const user = userEvent.setup();
    respondWith({
      regeneration: () =>
        new Response(JSON.stringify({ message: "The ruleset could not be read." }), {
          headers: { "Content-Type": "application/json" },
          status: 500,
        }),
    });

    renderNotice();

    await user.click(await screen.findByRole("button", { name: "Regenerate plan" }));

    expect(await screen.findByRole("alert")).toBeDefined();
    expect(screen.getByRole("button", { name: "Regenerate plan" })).toBeDefined();
  });

  // The event can be edited again while the generation runs, so a revision captured before the POST
  // is not evidence about the plan that replaced it: both sides read 3 while a PATCH moved the
  // event to 4. Only the api's own recomputed answer clears the warning.
  it("keeps the warning when the event advanced while the regeneration was in flight", async () => {
    const user = userEvent.setup();
    respondWith({ event: () => eventResponse(true, 3) });

    renderNotice();

    await user.click(await screen.findByRole("button", { name: "Regenerate plan" }));

    await vi.waitFor(() =>
      expect(
        fetchMock.mock.calls.some(
          (call) => (call[1] as RequestInit | undefined)?.method === "POST",
        ),
      ).toBe(true),
    );
    expect(await screen.findByRole("button", { name: "Regenerate plan" })).toBeDefined();
    expect(screen.queryByRole("status")).toBeNull();
  });

  // A POST that answered 2xx wrote an immutable plan (AD-7). If the read that would confirm it
  // fails, the organizer has neither a confirmation nor an error, and the obvious response —
  // pressing the button again — stores a second plan for one action.
  const recheckFails = () => {
    let eventReads = 0;
    respondWith({
      event: () => {
        eventReads += 1;
        return eventReads === 1 ? eventResponse(true) : new Response("", { status: 502 });
      },
    });
  };

  it("says a plan was stored when the freshness check could not be made", async () => {
    const user = userEvent.setup();
    recheckFails();

    renderNotice();
    await user.click(await screen.findByRole("button", { name: "Regenerate plan" }));

    const outcome = await screen.findByRole("alert");
    expect(outcome.textContent).toContain("regenerated");
    expect(outcome.textContent).toContain("could not");
    expect(screen.getByText(/edited since its plan was generated/)).toBeDefined();
  });

  it("does not offer regeneration again once a plan was stored but unconfirmed", async () => {
    const user = userEvent.setup();
    recheckFails();

    renderNotice();
    await user.click(await screen.findByRole("button", { name: "Regenerate plan" }));

    await screen.findByRole("alert");
    expect(screen.queryByRole("button", { name: "Regenerate plan" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Regenerating plan…" })).toBeNull();
    const posts = fetchMock.mock.calls.filter(
      (call) => (call[1] as RequestInit | undefined)?.method === "POST",
    );
    expect(posts).toHaveLength(1);
  });

  // The overview must not claim a plan is current because the event could not be read.
  it("says nothing when the event cannot be loaded", async () => {
    respondWith({ event: () => new Response("", { status: 500 }) });

    renderNotice();

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(screen.queryByRole("button", { name: "Regenerate plan" })).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  // The plan view refuses this same operation when the service is behind the plan's pinned ruleset,
  // because regenerating would rebuild the plan from superseded rules and can drop a requirement
  // the organizer has already been shown. This surface offers the same operation, so it is bound by
  // the same refusal.
  it("refuses regeneration when the service is running an older ruleset", async () => {
    respondWith({ meta: () => metaResponse("nyc.v2.10") });

    renderNotice();

    expect((await screen.findByRole("alert")).textContent).toContain("nyc.v2.11");
    expect(screen.queryByRole("button", { name: "Regenerate plan" })).toBeNull();
  });

  // The refusal ends by saying the preserved plan is still the one the pinned rules produced. On
  // the plan view that plan is on the screen the sentence is read from; here it is not — the
  // overview only links to it — so a refusal that says "the plan below" tells the organizer they
  // are looking at a regulatory artifact that is one navigation away.
  it("names the permit-plan link rather than a plan below", async () => {
    respondWith({ meta: () => metaResponse("nyc.v2.10") });

    renderNotice();

    const refusal = (await screen.findByRole("alert")).textContent ?? "";
    expect(refusal).toContain("Open permit plan");
    expect(refusal).not.toContain("the plan below");
  });

  it("refuses regeneration when the running ruleset cannot be read", async () => {
    respondWith({ meta: () => new Response("", { status: 503 }) });

    renderNotice();

    expect((await screen.findByRole("alert")).textContent).toContain("could not be read");
    expect(screen.queryByRole("button", { name: "Regenerate plan" })).toBeNull();
  });

  // No pinned version, no way to establish that regenerating would not move the plan backwards.
  it("refuses regeneration when the stored plan cannot be read", async () => {
    respondWith({ plan: () => new Response("", { status: 500 }) });

    renderNotice();

    expect(await screen.findByRole("alert")).toBeDefined();
    expect(screen.queryByRole("button", { name: "Regenerate plan" })).toBeNull();
  });
});
