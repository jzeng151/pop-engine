// @vitest-environment jsdom

// F-101 Acceptance Criterion 8: editing a field after a plan exists bumps `revision_counter`,
// marks the plan stale in the UI, and offers one-click regeneration. The intake form used to
// render that notice itself; since the edit save redirects to this overview, the affordance has
// to live where the organizer lands or the criterion has nowhere to happen.
//
// The one click is offered here again. What changed is not this component's confidence: it is
// that `POST /api/events/:id/plan` now refuses a ruleset downgrade inside the transaction that
// inserts (F-201 AC 12), so the precondition is checked where both facts are visible at once.
// This surface therefore asks and reports, and makes no check of its own that a write could
// outrun: the tests below assert the absence of those reads, not just the presence of the button.

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
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

/** What the endpoint's downgrade guard answers with (F-201 AC 12). */
const downgradeRefusal = (standing: "older" | "different", rulesetVersion: string) =>
  new Response(
    JSON.stringify({
      error: "plan generation refused: …",
      rulesetVersion,
      pinnedRulesetVersion: PINNED_VERSION,
      standing,
    }),
    { headers: { "Content-Type": "application/json" }, status: 409 },
  );

const generatedResponse = () =>
  new Response(JSON.stringify({ eventRevision: 3 }), {
    headers: { "Content-Type": "application/json" },
    status: 201,
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

const isPost = (init?: RequestInit) => init?.method === "POST";

/**
 * Answers the two calls this notice makes: the event, and the regeneration itself.
 *
 * Anything else fails the request rather than answering it. The plan and the running ruleset are
 * NOT read here, and that is the point of the change rather than an oversight: reading them would
 * be the client deciding whether its own write is safe, which is the shape #232 removed. A request
 * for either is a regression, and this is what keeps it from being a silent one.
 */
const respondWith = ({
  event = () => eventResponse(true),
  post = () => generatedResponse(),
}: { event?: () => Response; post?: () => Response | Promise<Response> } = {}) => {
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    if (isPost(init)) {
      if (!String(url).endsWith("/plan")) throw new Error(`unexpected POST: ${String(url)}`);
      return post();
    }
    if (String(url).endsWith("/plan") || String(url).endsWith("/api/rules/meta")) {
      throw new Error(`unexpected guard read: ${String(url)}`);
    }
    return event();
  });
};

const renderNotice = (eventId = "event-9") =>
  render(<PlanStaleNotice apiBaseUrl="https://api.example.com" eventId={eventId} />);

const notice = (eventId: string) => (
  <PlanStaleNotice apiBaseUrl="https://api.example.com" eventId={eventId} />
);

const regenerateButton = () => screen.queryByRole("button", { name: "Regenerate plan" });

const clickRegenerate = async () => {
  const button = await screen.findByRole("button", { name: "Regenerate plan" });
  fireEvent.click(button);
};

/** Every request the component made, as (url, init) pairs. `mock.calls` itself is untyped. */
const requests = (): readonly { url: string; init?: RequestInit }[] =>
  fetchMock.mock.calls.map((call) => ({
    url: String(call[0]),
    init: call[1] as RequestInit | undefined,
  }));

const postCount = () => requests().filter((request) => isPost(request.init)).length;

describe("the stale-plan notice on the event overview", () => {
  it("says nothing at all when the plan is current", async () => {
    respondWith({ event: () => eventResponse(false) });

    renderNotice();

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(screen.queryByText(/edited since its plan was generated/)).toBeNull();
    expect(regenerateButton()).toBeNull();
  });

  it("offers the regeneration once the read reports the plan stale", async () => {
    respondWith();

    renderNotice();

    expect(await screen.findByText(/edited since its plan was generated/)).toBeDefined();
    expect(await screen.findByRole("button", { name: "Regenerate plan" })).toBeDefined();
  });

  /**
   * The reads this notice does NOT make. Three rounds of #232 tried to establish from the browser
   * that a regeneration would not rebuild the plan from an older ruleset, by reading the plan's
   * pinned version and `/api/rules/meta` before writing. All of them decided on reads that had
   * already returned. The endpoint decides now, so those reads are gone; asking for either would
   * be rebuilding a guard that cannot hold across its own write.
   */
  it("makes no guard read of its own before regenerating", async () => {
    respondWith();

    renderNotice();
    await clickRegenerate();

    await vi.waitFor(() => expect(postCount()).toBe(1));
    expect(requests().some((request) => request.url.endsWith("/api/rules/meta"))).toBe(false);
    expect(
      requests().some((request) => !isPost(request.init) && request.url.endsWith("/plan")),
    ).toBe(false);
  });

  it("clears the notice when the regeneration succeeds and the event reads back current", async () => {
    let stale = true;
    respondWith({
      event: () => eventResponse(stale, 4),
      post: () => {
        stale = false;
        return generatedResponse();
      },
    });

    renderNotice();
    await clickRegenerate();

    expect(await screen.findByText(/Plan regenerated for revision 4\./)).toBeDefined();
    expect(screen.queryByText(/edited since its plan was generated/)).toBeNull();
    expect(regenerateButton()).toBeNull();
  });
});

describe("the endpoint's downgrade refusal", () => {
  const refusalText = async () =>
    (await screen.findByText(/Your plan was not regenerated/)).textContent ?? "";

  it("names both versions and which way round they stand", async () => {
    respondWith({ post: () => downgradeRefusal("older", "nyc.v2.10") });

    renderNotice();
    await clickRegenerate();

    const text = await refusalText();
    expect(text).toContain("nyc.v2.11");
    expect(text).toContain("nyc.v2.10");
    expect(text).toContain("which is older");
  });

  // Version ordering establishes only that the rebuild COULD differ. `docs/BASELINE.md` records
  // bumps that moved no finding at all, so a service merely behind drops nothing in those cases.
  // The copy is regulatory-adjacent and may not state a consequence it has not established.
  it("does not claim requirements were dropped", async () => {
    respondWith({ post: () => downgradeRefusal("older", "nyc.v2.10") });

    renderNotice();
    await clickRegenerate();

    const text = await refusalText();
    expect(text).not.toMatch(/dropped|would drop|were removed|are missing/);
    expect(text).toContain(
      "not guaranteed to reproduce the requirements you have already been shown",
    );
  });

  it("says the stored plan is untouched and names the link it is behind", async () => {
    respondWith({ post: () => downgradeRefusal("older", "nyc.v2.10") });

    renderNotice();
    await clickRegenerate();

    const text = await refusalText();
    expect(text).toContain("nothing about it has changed");
    expect(text).toContain("Open permit plan");
    expect(text).not.toContain("the plan below");
  });

  it("tells the organizer what would make regenerating work", async () => {
    respondWith({ post: () => downgradeRefusal("older", "nyc.v2.10") });

    renderNotice();
    await clickRegenerate();

    expect(await refusalText()).toContain(
      "once the service is running nyc.v2.11 or a later version of it",
    );
  });

  // An unorderable pair is refused for a different reason than an older one, and saying "older"
  // about a version nothing established an order for would be a false statement about the service.
  it("says two versions cannot be ordered rather than calling one of them older", async () => {
    respondWith({ post: () => downgradeRefusal("different", "sfo.v1.0") });

    renderNotice();
    await clickRegenerate();

    const text = await refusalText();
    expect(text).toContain("the two versions cannot be ordered");
    expect(text).not.toContain("which is older");
    expect(text).toContain("sfo.v1.0");
  });

  // A retry posts the same request to the same service and is refused the same way. Leaving the
  // button up invites the organizer to press it until something changes that only a deployment can.
  it("leaves no retry that would repeat the same refusal", async () => {
    respondWith({ post: () => downgradeRefusal("older", "nyc.v2.10") });

    renderNotice();
    await clickRegenerate();

    await screen.findByText(/Your plan was not regenerated/);
    expect(regenerateButton()).toBeNull();
    expect(postCount()).toBe(1);
    // The warning itself stands: the plan really is stale, and the refusal did not change that.
    expect(screen.getByText(/edited since its plan was generated/)).toBeDefined();
  });

  // A 409 from this endpoint IS the guard, and it decides before it inserts, so the refusal and the
  // fact that nothing was stored are both certain even when the versions cannot be read off the
  // body. The retry stays withheld on that alone; only the specifics fall back to the api's prose.
  it("still withholds the retry when the refusal does not name the versions readably", async () => {
    respondWith({
      post: () =>
        new Response(JSON.stringify({ error: "plan generation refused: nyc.v2.11 vs nyc.v2.10" }), {
          headers: { "Content-Type": "application/json" },
          status: 409,
        }),
    });

    renderNotice();
    await clickRegenerate();

    const refusal = await screen.findByText(/Your plan was not regenerated/);
    expect(refusal.textContent).toContain("did not name the two ruleset versions");
    expect(refusal.textContent).toContain("plan generation refused: nyc.v2.11 vs nyc.v2.10");
    expect(regenerateButton()).toBeNull();
    expect(postCount()).toBe(1);
  });

  it("announces the refusal", async () => {
    respondWith({ post: () => downgradeRefusal("older", "nyc.v2.10") });

    renderNotice();
    await clickRegenerate();

    const refusal = await screen.findByText(/Your plan was not regenerated/);
    expect(refusal.getAttribute("role")).toBe("alert");
  });
});

describe("a regeneration whose outcome is not known", () => {
  /**
   * A POST that failed on the wire may still have reached the api and committed, which stores an
   * immutable plan (AD-7) this browser never saw a response for. Re-offering the button on the
   * strength of the error alone therefore writes a second plan for one organizer action. The
   * button comes back only on an explicit "still stale" read AFTER the POST.
   */
  it("withholds the retry when a failed POST cannot be shown to have stored nothing", async () => {
    let eventReads = 0;
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (isPost(init)) throw new Error("connection reset");
      eventReads += 1;
      // The read AFTER the POST cannot answer, so nothing withdraws or restores the button.
      if (eventReads > 1) return new Response("", { status: 503 });
      return eventResponse(true);
    });

    renderNotice();
    await clickRegenerate();

    const withheld = await screen.findByText(/it is not known whether a plan was stored/);
    expect(withheld.textContent).toContain("Reload this page to check");
    expect(regenerateButton()).toBeNull();
    expect(screen.getByText(/edited since its plan was generated/)).toBeDefined();
  });

  it("keeps the retry when the read after a failed POST reports the plan still stale", async () => {
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (isPost(init)) throw new Error("connection reset");
      return eventResponse(true);
    });

    renderNotice();
    await clickRegenerate();

    expect(await screen.findByText(/The API could not be reached\./)).toBeDefined();
    expect(regenerateButton()).not.toBeNull();
  });

  /**
   * `loadEvent` normalises a missing `plan_stale` to `false`, which is right for a reader asking
   * "is it stale" and wrong for this one, asking "was freshness confirmed". A 2xx body that omits
   * the field would otherwise read as an answer.
   */
  it("does not treat an unanswered staleness question as a confirmed regeneration", async () => {
    let posted = false;
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (isPost(init)) {
        posted = true;
        return generatedResponse();
      }
      if (!posted) return eventResponse(true);
      return new Response(JSON.stringify({ event: { id: "event-9", revision_counter: 4 } }), {
        headers: { "Content-Type": "application/json" },
        status: 200,
      });
    });

    renderNotice();
    await clickRegenerate();

    expect(await screen.findByText(/it did not report whether the plan is current/)).toBeDefined();
    expect(screen.getByText(/edited since its plan was generated/)).toBeDefined();
    expect(regenerateButton()).toBeNull();
  });

  it("keeps the warning up when a stored plan cannot be confirmed by a re-read", async () => {
    let posted = false;
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (isPost(init)) {
        posted = true;
        return generatedResponse();
      }
      if (!posted) return eventResponse(true);
      return new Response("", { status: 503 });
    });

    renderNotice();
    await clickRegenerate();

    expect(await screen.findByText(/regenerating again would store a second plan/)).toBeDefined();
    expect(screen.getByText(/edited since its plan was generated/)).toBeDefined();
    expect(regenerateButton()).toBeNull();
  });

  // The api answered, so nothing was written and the event is still stale by the read that follows.
  it("reports an api-reported failure and leaves the retry", async () => {
    respondWith({
      post: () =>
        new Response(JSON.stringify({ error: "plan generation failed" }), {
          headers: { "Content-Type": "application/json" },
          status: 500,
        }),
    });

    renderNotice();
    await clickRegenerate();

    expect(await screen.findByText("plan generation failed")).toBeDefined();
    expect(regenerateButton()).not.toBeNull();
  });

  // The overview must not claim a plan is current because the event could not be read.
  it("says nothing when the event cannot be loaded", async () => {
    respondWith({ event: () => new Response("", { status: 500 }) });

    renderNotice();

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(screen.queryByText(/edited since its plan was generated/)).toBeNull();
    expect(regenerateButton()).toBeNull();
  });
});

describe("event identity and announcement", () => {
  // React reuses a component instance across a prop change, so the state below belongs to whichever
  // event was last read. Left alone it states an edit to the event now on screen that nobody made,
  // and the button it leaves live posts an immutable plan (AD-7) for that event.
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
    expect(regenerateButton()).toBeNull();
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
    let committedButton: HTMLElement | null = null;
    onNoticeCommitted = () => {
      committedWarning =
        screen.queryByText(/edited since its plan was generated/)?.textContent ?? null;
      committedButton = regenerateButton();
    };
    rerender(noticeWithProbe("event-10"));

    expect(committedWarning).toBeNull();
    expect(committedButton).toBeNull();
  });

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

  // A regeneration for the event the organizer has navigated away from says nothing about the one
  // now on screen: the POST never touched it.
  it("reports no outcome for an event it has been handed away from", async () => {
    let releasePost: (r: Response) => void = () => {};
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (isPost(init)) return new Promise<Response>((resolve) => (releasePost = resolve));
      return eventResponse(url.includes("event-9"));
    });

    const view = renderNotice();
    await clickRegenerate();
    await vi.waitFor(() => expect(postCount()).toBe(1));

    view.rerender(notice("event-10"));
    releasePost(downgradeRefusal("older", "nyc.v2.10"));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(screen.queryByText(/Your plan was not regenerated/)).toBeNull();
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
