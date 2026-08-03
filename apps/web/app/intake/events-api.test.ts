import { afterEach, describe, expect, it, vi } from "vitest";
import { loadEvent, regeneratePlan } from "./events-api";

// `fetch` is stubbed; the api's own behavior is covered by the integration suite in
// apps/api. What is pinned here is the request this app makes and how each answer is
// reported back to the form.

const jsonResponse = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

const stubFetch = (implementation: typeof fetch) => {
  const fetchMock = vi.fn(implementation);
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("loadEvent", () => {
  it("gets the event with the Access cookie attached", async () => {
    const fetchMock = stubFetch(async () =>
      jsonResponse(200, {
        event: { id: "event-1", revision_counter: 3, borough: "queens" },
        warnings: [],
        plan_stale: true,
      }),
    );

    await expect(loadEvent("https://api.example.com", "event-1")).resolves.toEqual({
      ok: true,
      loaded: {
        event: { id: "event-1", revision_counter: 3, borough: "queens" },
        plan_stale: true,
        // Distinct from `plan_stale`: whether the API answered the question at all. A caller
        // confirming freshness after a regeneration cannot read the boolean, because a body that
        // omits the field normalises to `false` and would read as confirmed-current.
        plan_stale_reported: true,
      },
    });
    // Added 2026-08-03: the two are not the same question.
    const silent = stubFetch(async () =>
      jsonResponse(200, { event: { id: "event-1", revision_counter: 3 }, warnings: [] }),
    );
    const quiet = await loadEvent("https://api.example.com", "event-1");
    expect(quiet.ok && quiet.loaded.plan_stale).toBe(false);
    expect(quiet.ok && quiet.loaded.plan_stale_reported).toBe(false);
    void silent;

    expect(fetchMock).toHaveBeenCalledWith("https://api.example.com/api/events/event-1", {
      credentials: "include",
      headers: { "Content-Type": "application/json" },
    });
  });

  it("defaults a missing plan_stale to a current plan", async () => {
    stubFetch(async () => jsonResponse(200, { event: { id: "event-1", revision_counter: 1 } }));
    const result = await loadEvent("https://api.example.com", "event-1");
    expect(result.ok && result.loaded.plan_stale).toBe(false);
  });

  it("says plainly when the event does not exist", async () => {
    stubFetch(async () => jsonResponse(404, { error: "event not found" }));
    await expect(loadEvent("https://api.example.com", "gone")).resolves.toEqual({
      ok: false,
      message: "event not found",
    });
  });

  it("falls back to the status when the failure body carries no message", async () => {
    stubFetch(async () => new Response("<html>gateway</html>", { status: 502 }));
    await expect(loadEvent("https://api.example.com", "event-1")).resolves.toEqual({
      ok: false,
      message: "The event could not be loaded (HTTP 502).",
    });
  });

  it("uses a not-found message when a 404 body says nothing", async () => {
    stubFetch(async () => new Response("", { status: 404 }));
    await expect(loadEvent("https://api.example.com", "gone")).resolves.toEqual({
      ok: false,
      message: "That event was not found.",
    });
  });

  it("refuses a success body it cannot read as an event", async () => {
    stubFetch(async () => jsonResponse(200, { event: { revision_counter: 1 } }));
    await expect(loadEvent("https://api.example.com", "event-1")).resolves.toEqual({
      ok: false,
      message: "The API returned an event this form cannot read.",
    });

    stubFetch(async () => jsonResponse(200, []));
    await expect(loadEvent("https://api.example.com", "event-1")).resolves.toEqual({
      ok: false,
      message: "The API returned an event this form cannot read.",
    });
  });

  it("reports an unreachable api instead of throwing", async () => {
    stubFetch(async () => {
      throw new TypeError("Failed to fetch");
    });
    await expect(loadEvent("https://api.example.com", "event-1")).resolves.toEqual({
      ok: false,
      message: "The API could not be reached.",
    });
  });
});

describe("regeneratePlan", () => {
  it("posts to the event's plan endpoint with the Access cookie attached", async () => {
    const fetchMock = stubFetch(async () =>
      jsonResponse(201, { verdict: "feasible", eventRevision: 2 }),
    );

    await expect(regeneratePlan("https://api.example.com", "event-1")).resolves.toEqual({
      ok: true,
      eventRevision: 2,
    });
    expect(fetchMock).toHaveBeenCalledWith("https://api.example.com/api/events/event-1/plan", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
    });
  });

  it("reports an unknown revision when the plan response does not name one", async () => {
    // The plan endpoint is F-201's; this app must not require a shape it does not own.
    // A snake_case key is not the one F-201 publishes, so it reads as "cannot confirm".
    stubFetch(async () => jsonResponse(201, { verdict: "feasible", event_revision: 2 }));
    await expect(regeneratePlan("https://api.example.com", "event-1")).resolves.toEqual({
      ok: true,
      eventRevision: null,
    });

    stubFetch(async () => jsonResponse(201, { verdict: "feasible" }));
    await expect(regeneratePlan("https://api.example.com", "event-1")).resolves.toEqual({
      ok: true,
      eventRevision: null,
    });
  });

  it("reports the api's own error message", async () => {
    stubFetch(async () => jsonResponse(409, { error: "event has no intake to evaluate" }));
    await expect(regeneratePlan("https://api.example.com", "event-1")).resolves.toEqual({
      ok: false,
      message: "event has no intake to evaluate",
    });
  });

  it("falls back to the status when the failure body carries no message", async () => {
    stubFetch(async () => new Response("<html>gateway</html>", { status: 502 }));
    await expect(regeneratePlan("https://api.example.com", "event-1")).resolves.toEqual({
      ok: false,
      message: "The plan could not be regenerated (HTTP 502).",
    });
  });

  it("falls back to the status when the failure body is JSON without an error string", async () => {
    stubFetch(async () => jsonResponse(500, { error: 42 }));
    await expect(regeneratePlan("https://api.example.com", "event-1")).resolves.toEqual({
      ok: false,
      message: "The plan could not be regenerated (HTTP 500).",
    });
  });

  it("reports an unreachable api instead of throwing", async () => {
    stubFetch(async () => {
      throw new TypeError("Failed to fetch");
    });
    await expect(regeneratePlan("https://api.example.com", "event-1")).resolves.toEqual({
      ok: false,
      message: "The API could not be reached.",
    });
  });
});
