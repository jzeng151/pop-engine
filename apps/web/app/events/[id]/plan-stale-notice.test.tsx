// @vitest-environment jsdom

// F-101 Acceptance Criterion 8: editing a field after a plan exists bumps `revision_counter`,
// marks the plan stale in the UI, and offers one-click regeneration. The intake form used to
// render that notice itself; since the edit save redirects to this overview, the affordance has
// to live where the organizer lands or the criterion has nowhere to happen.
//
// The criterion's marking is met here. Its one click is NOT, and the tests say so rather than
// covering its absence: no check a browser can make holds across the write it would authorise
// (see the notice's own comment, and `docs/OPEN-QUESTIONS.md` T-5). The cases that asserted the
// button's behaviour are removed with the button — twelve of them, listed on the PR — because a
// test kept green against an affordance that no longer exists asserts nothing.

import { cleanup, render, screen } from "@testing-library/react";
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
 * Answers the one call this notice makes: the event.
 *
 * Anything else fails the request rather than answering it. The notice reads the plan, the running
 * ruleset and the regeneration endpoint no more, because each of those existed to decide or perform
 * a write it cannot establish the safety of; a request for one is a regression, and this is what
 * keeps it from being a silent one.
 */
const respondWith = ({ event = () => eventResponse(true) }: { event?: () => Response } = {}) => {
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    if (init?.method !== undefined || url.endsWith("/plan") || url.endsWith("/api/rules/meta")) {
      throw new Error(`unexpected request: ${init?.method ?? "GET"} ${url}`);
    }
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
    expect(screen.queryByText(/edited since its plan was generated/)).toBeNull();
  });

  it("reports the stale plan and says why it does not offer to regenerate it", async () => {
    respondWith();

    renderNotice();

    expect(await screen.findByText(/edited since its plan was generated/)).toBeDefined();
    expect(screen.getByText(/Regenerating is not offered here/).textContent).toContain(
      "is not guaranteed to reproduce the requirements you have already been shown",
    );
    expect(screen.queryByRole("button", { name: "Regenerate plan" })).toBeNull();
  });

  // `docs/BASELINE.md:60-63` records that v2.11 changed no trigger, finding or verdict, so a
  // service merely behind on v2.10 drops nothing. Version ordering establishes only that the
  // output COULD differ, so the refusal may not state a consequence as certain — neither that
  // requirements would be dropped nor that the plan would differ.
  it("does not state a rebuild's consequence as certain", async () => {
    respondWith();

    renderNotice();

    const refusal = await screen.findByText(/Regenerating is not offered here/);
    expect(refusal.textContent).not.toMatch(/would drop/);
    expect(refusal.textContent).not.toMatch(/would differ/);
  });

  // The refusal ends on the plan it leaves alone, and on this surface that plan is not the one the
  // sentence is read from — the overview only links to it. Naming the link is what stops the
  // sentence telling the organizer they are already looking at a regulatory artifact.
  it("names the permit-plan link as the plan it leaves alone", async () => {
    respondWith();

    renderNotice();

    const refusal = await screen.findByText(/Regenerating is not offered here/);
    expect(refusal.textContent).toContain("Open permit plan");
    expect(refusal.textContent).not.toContain("the plan below");
  });

  // React reuses a component instance across a prop change, so the state below belongs to whichever
  // event was last read. Left alone it states an edit to the event now on screen that nobody made.
  const respondPerEvent = (staleEventId: string) => {
    fetchMock.mockImplementation(async (url: string) => eventResponse(url.includes(staleEventId)));
  };

  it("clears the stale warning when it is reused for an event that is not stale", async () => {
    respondPerEvent("event-9");

    const { rerender } = renderNotice();
    await screen.findByText(/edited since its plan was generated/);

    rerender(notice("event-10"));

    await vi.waitFor(() =>
      expect(screen.queryByText(/edited since its plan was generated/)).toBeNull(),
    );
    expect(screen.queryByText(/Regenerating is not offered here/)).toBeNull();
  });

  /**
   * Reads the screen the organizer is actually shown. A layout effect runs after React has
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

  it("says nothing for the new event in the render that first carries its id", async () => {
    respondPerEvent("event-9");
    onNoticeCommitted = () => {};

    const { rerender } = render(noticeWithProbe("event-9"));
    await screen.findByText(/edited since its plan was generated/);

    let committedWarning: string | null = null;
    onNoticeCommitted = () => {
      committedWarning =
        screen.queryByText(/edited since its plan was generated/)?.textContent ?? null;
    };
    rerender(noticeWithProbe("event-10"));

    expect(committedWarning).toBeNull();
  });

  // The overview must not claim a plan is current because the event could not be read.
  it("says nothing when the event cannot be loaded", async () => {
    respondWith({ event: () => new Response("", { status: 500 }) });

    renderNotice();

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(screen.queryByText(/edited since its plan was generated/)).toBeNull();
    expect(screen.queryByText(/Regenerating is not offered here/)).toBeNull();
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

// The write this notice used to make, and why it does not make it.
describe("what the notice refuses to conclude", () => {
  /**
   * The ordering the fourth #232 round names: the state the downgrade guard decides on moves
   * between the reads that would authorise a regeneration and the write itself, and no read a
   * browser can make reports that it moved.
   *
   * 1. the event read reports the plan stale, pinned nyc.v2.11;
   * 2. the plan and the running-ruleset reads are answered by a deployment still on nyc.v2.11, so
   *    every input this page can gather says regenerating is safe;
   * 3. once both have been answered, another deployment stores a plan pinned nyc.v2.12. That is
   *    the state that makes the write a downgrade, and it is the state no client read reports:
   *    the plan read has already returned, and reading it again only moves the same window.
   *
   * So the assertion is NOT that the page detects step 3. It cannot, no ordering of client reads
   * can, and that is the finding rather than a gap in this test. It is that the page never issues
   * a write whose safety it cannot establish at the moment of writing: nothing is offered and no
   * POST is made, while the one thing the page CAN establish — that the plan is stale — is stated.
   *
   * Against the code this round reviewed, steps 1 and 2 open the button and the click writes. The
   * fixed page makes no guard reads at all, so step 3 has nothing to move under: `writes` stays
   * empty because the write is refused, not because the race was won.
   *
   * This says what this surface does and nothing more. The same regeneration is still offered by
   * the plan view, and the same interleaving still reaches it; refusing it there needs the
   * precondition checked where the plan is written (`docs/OPEN-QUESTIONS.md` T-5).
   */
  it("makes no write it cannot establish the safety of at the moment of writing", async () => {
    let storedPlanVersion = PINNED_VERSION;
    let guardReadsAnswered = 0;
    const writes: string[] = [];
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (init?.method === "POST") {
        // What the api holds when the write lands, which is what decides whether it is a downgrade.
        writes.push(storedPlanVersion);
        return new Response(JSON.stringify({ eventRevision: 3 }), {
          headers: { "Content-Type": "application/json" },
          status: 201,
        });
      }
      if (String(url).includes("/api/rules/meta") || String(url).endsWith("/plan")) {
        guardReadsAnswered += 1;
        // Step 3, once the guard has everything it asked for and before it can act on it.
        if (guardReadsAnswered === 2) storedPlanVersion = "nyc.v2.12";
        return String(url).includes("/api/rules/meta")
          ? metaResponse(PINNED_VERSION)
          : planResponse(PINNED_VERSION, 2);
      }
      return eventResponse(true, 3);
    });

    render(<PlanStaleNotice apiBaseUrl="https://api.example.com" eventId="event-9" />);

    expect(await screen.findByText(/edited since its plan was generated/)).toBeDefined();
    expect(screen.queryByRole("button", { name: "Regenerate plan" })).toBeNull();
    expect(writes).toHaveLength(0);
  });
});
