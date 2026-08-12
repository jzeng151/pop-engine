import { afterEach, describe, expect, it, vi } from "vitest";
import { loadEvent, regeneratePlan } from "./events-api";

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

        plan_stale_reported: true,
      },
    });

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
  it.each([
    [
      { error: "initial plan key does not match the event create key" },
      true,
      "the API key-mismatch contract",
    ],
    [
      {
        error: "plan generation refused",
        rulesetVersion: "nyc.v2.10",
        pinnedRulesetVersion: "nyc.v2.12",
        standing: "older",
      },
      true,
      "the API ruleset refusal contract",
    ],
    [{ error: "gateway conflict" }, false, "an unrecognized intermediary-shaped response"],
  ])(
    "classifies %s as definitive=%s (%s)",
    async (body: Record<string, unknown>, refused: boolean, _case: string) => {
      stubFetch(async () => jsonResponse(409, body));

      await expect(
        regeneratePlan("https://api.example.com", "event-1", crypto.randomUUID()),
      ).resolves.toMatchObject({
        ok: false,
        refused,
      });
    },
  );
});
