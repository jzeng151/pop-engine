// @vitest-environment jsdom

// F-101 Acceptance Criterion 8: editing a field after a plan exists bumps `revision_counter`,
// marks the plan stale in the UI, and offers one-click regeneration. The intake form used to
// render that notice itself; since the edit save redirects to this overview, the affordance has
// to live where the organizer lands or the criterion has nowhere to happen.

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PlanStaleNotice } from "./plan-stale-notice";

const eventResponse = (planStale: boolean, revision = 3) =>
  new Response(
    JSON.stringify({
      event: { id: "event-9", name: "Night Market", revision_counter: revision },
      plan_stale: planStale,
    }),
    { headers: { "Content-Type": "application/json" }, status: 200 },
  );

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const renderNotice = () =>
  render(<PlanStaleNotice apiBaseUrl="https://api.example.com" eventId="event-9" />);

describe("the stale-plan notice on the event overview", () => {
  it("says nothing at all when the plan is current", async () => {
    fetchMock.mockResolvedValue(eventResponse(false));

    renderNotice();

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(screen.queryByRole("button", { name: "Regenerate plan" })).toBeNull();
  });

  it("reports the stale plan and regenerates it in one click", async () => {
    const user = userEvent.setup();
    fetchMock.mockImplementation(async (_url: string, init?: RequestInit) =>
      init?.method === "POST"
        ? new Response(JSON.stringify({ eventRevision: 3 }), {
            headers: { "Content-Type": "application/json" },
            status: 201,
          })
        : eventResponse(true),
    );

    renderNotice();

    const button = await screen.findByRole("button", { name: "Regenerate plan" });
    expect(button.hasAttribute("disabled")).toBe(false);
    await user.click(button);

    expect(await screen.findByRole("status")).toBeDefined();
    expect(screen.queryByRole("button", { name: "Regenerate plan" })).toBeNull();
    const regeneration = fetchMock.mock.calls[1] ?? [];
    expect(regeneration[0]).toBe("https://api.example.com/api/events/event-9/plan");
    expect((regeneration[1] as RequestInit | undefined)?.method).toBe("POST");
  });

  it("keeps the warning and says why when regeneration fails", async () => {
    const user = userEvent.setup();
    fetchMock.mockImplementation(async (_url: string, init?: RequestInit) =>
      init?.method === "POST"
        ? new Response(JSON.stringify({ message: "The ruleset could not be read." }), {
            headers: { "Content-Type": "application/json" },
            status: 500,
          })
        : eventResponse(true),
    );

    renderNotice();

    await user.click(await screen.findByRole("button", { name: "Regenerate plan" }));

    expect(await screen.findByRole("alert")).toBeDefined();
    expect(screen.getByRole("button", { name: "Regenerate plan" })).toBeDefined();
  });

  // A plan generated for a revision other than the one on screen does not make this one current.
  // Clearing the warning on it would tell the organizer their plan matches an event it does not.
  it("keeps the warning when the plan comes back for another revision", async () => {
    const user = userEvent.setup();
    fetchMock.mockImplementation(async (_url: string, init?: RequestInit) =>
      init?.method === "POST"
        ? new Response(JSON.stringify({ eventRevision: 2 }), {
            headers: { "Content-Type": "application/json" },
            status: 201,
          })
        : eventResponse(true, 3),
    );

    renderNotice();

    await user.click(await screen.findByRole("button", { name: "Regenerate plan" }));

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(screen.getByRole("button", { name: "Regenerate plan" })).toBeDefined();
    expect(screen.queryByRole("status")).toBeNull();
  });

  // The plan endpoint is F-201's and may not report the revision. The event has not moved while
  // this was in flight, so that is still this revision's plan.
  it("accepts a plan that does not name a revision", async () => {
    const user = userEvent.setup();
    fetchMock.mockImplementation(async (_url: string, init?: RequestInit) =>
      init?.method === "POST"
        ? new Response(JSON.stringify({ verdict: "feasible" }), {
            headers: { "Content-Type": "application/json" },
            status: 201,
          })
        : eventResponse(true, 3),
    );

    renderNotice();

    await user.click(await screen.findByRole("button", { name: "Regenerate plan" }));

    expect((await screen.findByRole("status")).textContent).toBe(
      "Plan regenerated for revision 3.",
    );
  });

  // The overview must not claim a plan is current because the event could not be read.
  it("says nothing when the event cannot be loaded", async () => {
    fetchMock.mockResolvedValue(new Response("", { status: 500 }));

    renderNotice();

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(screen.queryByRole("button", { name: "Regenerate plan" })).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
