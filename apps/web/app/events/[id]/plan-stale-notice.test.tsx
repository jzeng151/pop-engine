// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useLayoutEffect } from "react";
import { createRoot } from "react-dom/client";
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

const downgradeRefusal = (
  standing: "older" | "different",
  rulesetVersion: string,
  pinnedRulesetVersion = PINNED_VERSION,
) =>
  new Response(
    JSON.stringify({
      error: "plan generation refused: …",
      rulesetVersion,
      pinnedRulesetVersion,
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

    const cleared = await screen.findByText(/Plan regenerated for revision 4\./);
    expect(screen.queryByText(/edited since its plan was generated/)).toBeNull();
    expect(regenerateButton()).toBeNull();
    expect(cleared.closest("[aria-live]")?.getAttribute("aria-live")).toBe("polite");
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

  it("says two versions cannot be ordered rather than calling one of them older", async () => {
    respondWith({ post: () => downgradeRefusal("different", "sfo.v1.0") });

    renderNotice();
    await clickRegenerate();

    const text = await refusalText();
    expect(text).toContain("the two versions cannot be ordered");
    expect(text).not.toContain("which is older");
    expect(text).toContain("sfo.v1.0");
  });

  it("does not offer a deployment as the way out when the pinned version cannot be ordered at all", async () => {
    respondWith({ post: () => downgradeRefusal("different", "nyc.v2.11", "draft") });

    renderNotice();
    await clickRegenerate();

    const text = await refusalText();
    expect(text).toContain("draft");
    expect(text).not.toContain("or a later version of it");
    expect(text).not.toContain("try again");
    expect(text).not.toMatch(/dropped|would drop|were removed|are missing/);
    expect(text).toContain("Ask whoever runs this deployment");
  });

  it("leaves no retry that would repeat the same refusal", async () => {
    respondWith({ post: () => downgradeRefusal("older", "nyc.v2.10") });

    renderNotice();
    await clickRegenerate();

    await screen.findByText(/Your plan was not regenerated/);
    expect(regenerateButton()).toBeNull();
    expect(postCount()).toBe(1);
    expect(screen.getByText(/edited since its plan was generated/)).toBeDefined();
  });

  it("keeps retry available when a 409 does not match the refusal contract", async () => {
    respondWith({
      post: () =>
        new Response(JSON.stringify({ error: "plan generation refused: nyc.v2.11 vs nyc.v2.10" }), {
          headers: { "Content-Type": "application/json" },
          status: 409,
        }),
    });

    renderNotice();
    await clickRegenerate();

    expect(
      await screen.findByText("plan generation refused: nyc.v2.11 vs nyc.v2.10"),
    ).toBeDefined();
    expect(regenerateButton()).toBeDefined();
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
  it("withholds the retry when a failed POST cannot be shown to have stored nothing", async () => {
    let eventReads = 0;
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (isPost(init)) throw new Error("connection reset");
      eventReads += 1;
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

  it("clears the notice when the read after a failed POST reports the plan current", async () => {
    let posted = false;
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (isPost(init)) {
        posted = true;
        throw new Error("connection reset");
      }
      return eventResponse(posted ? false : true, 4);
    });

    renderNotice();
    await clickRegenerate();

    const cleared = await screen.findByText(/its plan is current for revision 4/);
    expect(cleared.textContent).toContain("nothing out of date and nothing to regenerate");
    expect(cleared.textContent).not.toContain("Plan regenerated for revision");
    expect(screen.queryByText(/edited since its plan was generated/)).toBeNull();
    expect(screen.queryByText(/it is not known whether a plan was stored/)).toBeNull();
    expect(regenerateButton()).toBeNull();
  });

  it("still withholds the retry when a failed POST reads back current without a revision", async () => {
    let posted = false;
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (isPost(init)) {
        posted = true;
        throw new Error("connection reset");
      }
      if (!posted) return eventResponse(true);
      return new Response(
        JSON.stringify({ event: { id: "event-9", revision_counter: null }, plan_stale: false }),
        { headers: { "Content-Type": "application/json" }, status: 200 },
      );
    });

    renderNotice();
    await clickRegenerate();

    expect(await screen.findByText(/it is not known whether a plan was stored/)).toBeDefined();
    expect(screen.getByText(/edited since its plan was generated/)).toBeDefined();
    expect(regenerateButton()).toBeNull();
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

  it("reports a regeneration that stored a plan the event has already been edited past", async () => {
    respondWith();

    renderNotice();
    await clickRegenerate();

    const outcome = await screen.findByText(/built from an earlier revision of this event/);
    expect(outcome.textContent).toContain("regenerated and stored");
    expect(screen.getByText(/edited since its plan was generated/)).toBeDefined();
    expect(regenerateButton()).not.toBeNull();
  });

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

  it("says nothing when the event cannot be loaded", async () => {
    respondWith({ event: () => new Response("", { status: 500 }) });

    renderNotice();

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(screen.queryByText(/edited since its plan was generated/)).toBeNull();
    expect(regenerateButton()).toBeNull();
  });
});

describe("event identity and announcement", () => {
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

  it("ignores a read that lands after the component is handed another event", async () => {
    let releaseFirst: (r: Response) => void = () => {};
    fetchMock.mockImplementationOnce(
      () => new Promise<Response>((resolve) => (releaseFirst = resolve)),
    );

    const view = render(<PlanStaleNotice apiBaseUrl="https://api.example.com" eventId="event-1" />);

    fetchMock.mockResolvedValue(eventResponse(false));
    view.rerender(<PlanStaleNotice apiBaseUrl="https://api.example.com" eventId="event-2" />);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

    releaseFirst(eventResponse(true));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(screen.queryByText(/edited since its plan was generated/)).toBeNull();
  });

  it("reports no outcome for an event it has been handed away from", async () => {
    let releasePost: (r: Response) => void = () => {};
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (isPost(init)) return new Promise<Response>((resolve) => (releasePost = resolve));
      return eventResponse(true);
    });

    const view = renderNotice();
    await clickRegenerate();
    await vi.waitFor(() => expect(postCount()).toBe(1));

    view.rerender(notice("event-10"));
    releasePost(downgradeRefusal("older", "nyc.v2.10"));
    await new Promise((resolve) => setTimeout(resolve, 0));

    await vi.waitFor(() =>
      expect(screen.queryByText(/edited since its plan was generated/)).not.toBeNull(),
    );
    expect(screen.queryByText(/Your plan was not regenerated/)).toBeNull();
  });

  it("applies no regeneration outcome once another event's render has committed", async () => {
    const actEnvironment = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean };
    const wasActEnvironment = actEnvironment.IS_REACT_ACT_ENVIRONMENT;
    actEnvironment.IS_REACT_ACT_ENVIRONMENT = false;
    const container = document.body.appendChild(document.createElement("div"));
    const root = createRoot(container);

    try {
      let releasePost: (response: Response) => void = () => {};
      fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
        if (isPost(init)) return new Promise<Response>((resolve) => (releasePost = resolve));
        return eventResponse(true);
      });

      onNoticeCommitted = () => {};
      root.render(noticeWithProbe("event-9"));
      const button = await vi.waitFor(() => {
        const found = regenerateButton();
        if (found === null) throw new Error("the regeneration was not offered");
        return found;
      });
      button.click();
      await vi.waitFor(() => expect(postCount()).toBe(1));

      onNoticeCommitted = () => releasePost(downgradeRefusal("older", "nyc.v2.10"));
      root.render(noticeWithProbe("event-10"));

      await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
      await vi.waitFor(() =>
        expect(screen.queryByText(/edited since its plan was generated/)).not.toBeNull(),
      );
      expect(screen.queryByText(/Your plan was not regenerated/)).toBeNull();
      expect(regenerateButton()).not.toBeNull();
    } finally {
      root.unmount();
      container.remove();
      actEnvironment.IS_REACT_ACT_ENVIRONMENT = wasActEnvironment;
    }
  });

  it("announces the stale warning, which appears only after the read resolves", async () => {
    fetchMock.mockResolvedValue(eventResponse(true));

    render(<PlanStaleNotice apiBaseUrl="https://api.example.com" eventId="event-9" />);

    const warning = await screen.findByText(/edited since its plan was generated/);
    const region = warning.closest("[aria-live]");
    expect(region).not.toBeNull();
    expect(region?.getAttribute("aria-live")).toBe("polite");
  });
});
