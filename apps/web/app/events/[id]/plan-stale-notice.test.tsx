// @vitest-environment jsdom

// F-101 Acceptance Criterion 8: editing a field after a plan exists bumps `revision_counter`,
// marks the plan stale in the UI, and offers one-click regeneration. The intake form used to
// render that notice itself; since the edit save redirects to this overview, the affordance has
// to live where the organizer lands or the criterion has nowhere to happen.

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useLayoutEffect } from "react";
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

// A STALE plan is one generated for an earlier revision than the event's, which is what the API's
// `plan_stale: true` means. These fixtures used to say `plan_stale: true` while the plan named the
// event's current revision — a state the API cannot produce — so `eventRevision` defaults to one
// behind `eventResponse`'s default of 3.
const planResponse = (rulesetVersion = PINNED_VERSION, eventRevision = 2) =>
  new Response(
    JSON.stringify({
      eventRevision,
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

  /**
   * Reads the screen the organizer can actually click. A layout effect runs after React has
   * committed the new event's render to the DOM and before the notice's own passive effect, so it
   * is the one place a test can stand inside the window where the new id is live and the previous
   * event's state may still be on screen. Anything that waits for effects to settle passes whether
   * or not that window exists.
   */
  let onNoticeCommitted = () => {};
  const CommittedScreenProbe = ({ eventId }: { eventId: string }) => {
    useLayoutEffect(() => {
      onNoticeCommitted();
    }, [eventId]);
    return null;
  };
  const noticeWithProbe = (eventId: string) => (
    <>
      {notice(eventId)}
      <CommittedScreenProbe eventId={eventId} />
    </>
  );

  it("offers nothing for the new event in the render that first carries its id", async () => {
    respondPerEvent("event-9");
    onNoticeCommitted = () => {};

    const { rerender } = render(noticeWithProbe("event-9"));
    await screen.findByRole("button", { name: "Regenerate plan" });

    let committedWarning: string | null = null;
    let committedButton: HTMLElement | null = null;
    onNoticeCommitted = () => {
      committedWarning =
        screen.queryByText(/edited since its plan was generated/)?.textContent ?? null;
      committedButton = screen.queryByRole("button", { name: "Regenerate plan" });
      // The organizer can press whatever this render left enabled. Against the mismatched render
      // that click posts an immutable plan (AD-7) for event-10, which nobody said was stale.
      committedButton?.click();
    };
    rerender(noticeWithProbe("event-10"));

    expect(committedWarning).toBeNull();
    expect(committedButton).toBeNull();
    expect(
      fetchMock.mock.calls.filter(
        (call) => (call[1] as RequestInit | undefined)?.method === "POST",
      ),
    ).toHaveLength(0);
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
    let posted = false;
    respondWith({
      event: () => (posted ? new Response("", { status: 502 }) : eventResponse(true)),
      regeneration: () => {
        posted = true;
        return new Response(JSON.stringify({ eventRevision: 3 }), {
          headers: { "Content-Type": "application/json" },
          status: 201,
        });
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

// Both added 2026-08-03 from the #232 review.
describe("event identity and announcement", () => {
  // What this test DOES prove: a read for a previous event, landing after the component has been
  // handed another one, never installs the previous event's warning.
  //
  // What it does NOT prove, stated because the distinction decides whether the identity guard in
  // the effect is load-bearing: the review described a narrower ordering, where the read settles
  // after the new id commits but BEFORE React runs the passive-effect cleanup. Under this file's
  // scheduling the cleanup has already set `mounted` false by the time the read resolves, so this
  // case passes with or without the identity comparison — verified by reverting the guard and
  // watching it stay green. The guard is kept as defence against that ordering, which jsdom cannot
  // deterministically reproduce here, and not because this test establishes it.
  it("ignores a read that lands after the component is handed another event", async () => {
    let releaseFirst: (r: Response) => void = () => {};
    fetchMock.mockImplementationOnce(
      () => new Promise<Response>((resolve) => (releaseFirst = resolve)),
    );

    const view = render(<PlanStaleNotice apiBaseUrl="https://api.example.com" eventId="event-1" />);

    // Second event is not stale, and its read settles first.
    fetchMock.mockResolvedValue(eventResponse(false));
    view.rerender(<PlanStaleNotice apiBaseUrl="https://api.example.com" eventId="event-2" />);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

    // Now the FIRST event's read arrives, saying it was stale.
    releaseFirst(eventResponse(true));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(screen.queryByRole("button", { name: "Regenerate plan" })).toBeNull();
    expect(screen.queryByText(/edited since its plan was generated/)).toBeNull();
  });

  // Regression: the intake form rendered this asynchronous state inside `.intake__saved`, which
  // carried aria-live="polite". Moving the affordance to the overview dropped that.
  it("announces the stale warning, which appears only after the read resolves", async () => {
    fetchMock.mockResolvedValue(eventResponse(true));

    render(<PlanStaleNotice apiBaseUrl="https://api.example.com" eventId="event-9" />);

    const warning = await screen.findByText(/edited since its plan was generated/);
    const region = warning.closest("[aria-live]");
    expect(region).not.toBeNull();
    expect(region?.getAttribute("aria-live")).toBe("polite");
  });
});

// All three added 2026-08-03 from the #232 review.
describe("what the notice refuses to conclude", () => {
  // Another tab regenerating while the guard reads are in flight leaves the plan already current.
  // Offering the button on the strength of the earlier plan_stale would store a second immutable
  // plan for one revision. The api recomputes staleness on every read, so the withdrawal rests on
  // its answer to a read made after the plan read, not on the revisions this component compared.
  it("withdraws the warning when the api reports the plan is no longer stale", async () => {
    let eventReads = 0;
    fetchMock.mockImplementation(async (url: string) => {
      if (String(url).includes("/api/rules/meta")) return metaResponse();
      if (String(url).endsWith("/plan")) return planResponse(PINNED_VERSION, 3);
      eventReads += 1;
      // The regeneration in the other tab lands between the two event reads.
      return eventReads === 1 ? eventResponse(true, 3) : eventResponse(false, 3);
    });

    render(<PlanStaleNotice apiBaseUrl="https://api.example.com" eventId="event-9" />);

    await vi.waitFor(() => expect(eventReads).toBeGreaterThan(1));
    await vi.waitFor(() =>
      expect(screen.queryByText(/edited since its plan was generated/)).toBeNull(),
    );
    expect(screen.queryByRole("button", { name: "Regenerate plan" })).toBeNull();
  });

  /**
   * The ordering the #232 review names, driven rather than raced: this component's reads happen in
   * a fixed order, so answering each one with the state the api would hold at that moment
   * reproduces the interleaving exactly, with no timing dependence.
   *
   * 1. the first event read reports revision 3, stale;
   * 2. another tab regenerates, so the plan read answers with a plan for revision 3;
   * 3. a PATCH moves the event to revision 4 before the guard finishes, so every later read
   *    reports revision 4 and the plan is stale again.
   *
   * Comparing the plan's revision against the revision from step 1 reads "current" here and
   * withdraws a warning that is true, hiding the edit from step 3 until a reload.
   */
  it("keeps the warning when the event moved on after the plan was read", async () => {
    let eventReads = 0;
    fetchMock.mockImplementation(async (url: string) => {
      if (String(url).includes("/api/rules/meta")) return metaResponse();
      if (String(url).endsWith("/plan")) return planResponse(PINNED_VERSION, 3);
      eventReads += 1;
      return eventReads === 1 ? eventResponse(true, 3) : eventResponse(true, 4);
    });

    render(<PlanStaleNotice apiBaseUrl="https://api.example.com" eventId="event-9" />);

    expect(await screen.findByRole("button", { name: "Regenerate plan" })).toBeDefined();
    expect(screen.getByText(/edited since its plan was generated/)).toBeDefined();
    expect(eventReads).toBeGreaterThan(1);
  });

  // No answer at all is not "still stale" and not "current". The warning stays, because nothing
  // withdrew it, and the button goes, because a plan another tab has already regenerated must not
  // be regenerated a second time (AD-7).
  it("withholds regeneration when staleness cannot be re-read", async () => {
    let eventReads = 0;
    fetchMock.mockImplementation(async (url: string) => {
      if (String(url).includes("/api/rules/meta")) return metaResponse();
      if (String(url).endsWith("/plan")) return planResponse();
      eventReads += 1;
      return eventReads === 1 ? eventResponse(true, 3) : new Response("", { status: 502 });
    });

    render(<PlanStaleNotice apiBaseUrl="https://api.example.com" eventId="event-9" />);

    expect((await screen.findByRole("alert")).textContent).toContain("could not be re-read");
    expect(screen.getByText(/edited since its plan was generated/)).toBeDefined();
    expect(screen.queryByRole("button", { name: "Regenerate plan" })).toBeNull();
  });

  /**
   * The ordering the #232 review names for the downgrade guard, driven rather than raced.
   *
   * The guard's inputs used to be read BEFORE the staleness recheck and used after it, so another
   * tab regenerating in that window — onto a ruleset newer than the one this service runs — left
   * the guard deciding on a plan that no longer exists. It opens, the organizer regenerates, and
   * the newer pinned plan is replaced from superseded rules.
   *
   * Driven by keying the plan's pinned version on how many event requests have ALREADY BEEN
   * ISSUED when the plan request goes out. That is the ordering relation itself, not a proxy for
   * it: `Promise.all` and a plain `await` both issue their fetches synchronously in source order,
   * so "the plan was read while only the first event read had gone out" is deterministic in jsdom
   * and needs no timing. One event request issued means the plan was read before the recheck; two
   * means it was read no earlier than the recheck.
   *
   * The service stays on nyc.v2.11 throughout, so the plan read before the recheck opens the guard
   * and the plan read with it (pinned nyc.v2.12 by the other tab) closes it.
   */
  it("guards on the plan as it stands after the staleness recheck, not before it", async () => {
    let eventRequests = 0;
    fetchMock.mockImplementation(async (url: string) => {
      if (String(url).includes("/api/rules/meta")) return metaResponse(PINNED_VERSION);
      if (String(url).endsWith("/plan")) {
        return planResponse(eventRequests > 1 ? "nyc.v2.12" : PINNED_VERSION, 3);
      }
      eventRequests += 1;
      return eventResponse(true, eventRequests === 1 ? 3 : 4);
    });

    render(<PlanStaleNotice apiBaseUrl="https://api.example.com" eventId="event-9" />);

    const refusal = await screen.findByRole("alert");
    expect(refusal.textContent).toContain("nyc.v2.12");
    expect(screen.queryByRole("button", { name: "Regenerate plan" })).toBeNull();
    expect(screen.getByText(/edited since its plan was generated/)).toBeDefined();
  });

  /**
   * A POST whose outcome the browser never learned may already have committed, and a committed
   * regeneration is an immutable plan (AD-7). Re-offering the button on the strength of the error
   * alone therefore writes a second plan for one organizer action.
   *
   * The ordering, driven: the connection drops on the POST, and every event read from that point
   * on reports the plan current, which is what the api holds once the request it did receive
   * committed. The assertion on the call log is the ordering claim — the read that decides whether
   * to re-offer the button must come after the POST in the sequence, not from the state this
   * component held before it.
   */
  it("withholds the retry when a failed regeneration may already have stored a plan", async () => {
    const user = userEvent.setup();
    const calls: string[] = [];
    let posted = false;
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (init?.method === "POST") {
        calls.push("post");
        posted = true;
        // The api received it and committed; the response never arrived.
        throw new TypeError("Failed to fetch");
      }
      if (String(url).includes("/api/rules/meta")) return metaResponse();
      if (String(url).endsWith("/plan")) return planResponse();
      calls.push("event");
      return eventResponse(!posted, 3);
    });

    render(<PlanStaleNotice apiBaseUrl="https://api.example.com" eventId="event-9" />);
    await user.click(await screen.findByRole("button", { name: "Regenerate plan" }));

    const outcome = await screen.findByRole("alert");
    expect(outcome.textContent).toContain("not known whether a plan was stored");
    expect(screen.queryByRole("button", { name: "Regenerate plan" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Regenerating plan…" })).toBeNull();
    expect(calls.filter((call) => call === "post")).toHaveLength(1);
    expect(calls.lastIndexOf("event")).toBeGreaterThan(calls.indexOf("post"));
  });

  // A 2xx body that omits plan_stale is not a confirmation. loadEvent normalises it to false,
  // which is right for "is it stale" and wrong for "was freshness confirmed".
  it("does not confirm regeneration when the event never reports staleness", async () => {
    const user = userEvent.setup();
    let posted = false;
    fetchMock.mockImplementation(async (_url: string, init?: RequestInit) => {
      if (init?.method === "POST") {
        posted = true;
        return new Response(JSON.stringify({ eventRevision: 3 }), {
          headers: { "Content-Type": "application/json" },
          status: 201,
        });
      }
      if (String(_url).endsWith("/plan")) return planResponse();
      if (String(_url).includes("/api/rules/meta")) return metaResponse();
      if (posted)
        // 2xx, valid event, no plan_stale field at all.
        return new Response(JSON.stringify({ event: { id: "event-9", revision_counter: 3 } }), {
          headers: { "Content-Type": "application/json" },
          status: 200,
        });
      return eventResponse(true, 3);
    });

    render(<PlanStaleNotice apiBaseUrl="https://api.example.com" eventId="event-9" />);
    await user.click(await screen.findByRole("button", { name: "Regenerate plan" }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("did not report whether the plan is current");
    expect(screen.queryByText(/Plan regenerated for revision undefined/)).toBeNull();
  });
});
