import { afterEach, describe, expect, it, vi } from "vitest";
import { loadEventStats } from "./dashboard-api";

const jsonResponse = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("loadEventStats", () => {
  it("parses the F-402 wire shape", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse(200, {
          checkins_total: 4,
          checkins_registered: 3,
          checkins_walk_in: 1,
          rsvps_total: 9,
          capacity: 100,
          checkins_last_10min: 2,
        }),
      ),
    );

    await expect(loadEventStats("https://api.example.com", "event-1")).resolves.toEqual({
      ok: true,
      stats: {
        checkins_total: 4,
        checkins_registered: 3,
        checkins_walk_in: 1,
        rsvps_total: 9,
        capacity: 100,
        checkins_last_10min: 2,
      },
    });
  });

  it("reports unreachable and unreadable bodies", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("offline")));
    await expect(loadEventStats("https://api.example.com", "event-1")).resolves.toEqual({
      ok: false,
      message: "The API could not be reached.",
    });

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse(200, { checkins_total: "nope" })),
    );
    await expect(loadEventStats("https://api.example.com", "event-1")).resolves.toEqual({
      ok: false,
      message: "The API returned stats this page cannot read.",
    });
  });

  it("aborts a hung fetch after timeoutMs so callers can resume polling", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_url: string, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () => {
              reject(new DOMException("Aborted", "AbortError"));
            });
          }),
      ),
    );

    await expect(
      loadEventStats("https://api.example.com", "event-1", { timeoutMs: 20 }),
    ).resolves.toEqual({
      ok: false,
      message: "The API could not be reached.",
    });
  });

  it("keeps the timeout armed while the response body is still being read", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((_url: string, init?: RequestInit) =>
        Promise.resolve({
          ok: true,
          status: 200,
          json: () =>
            new Promise<unknown>((_resolve, reject) => {
              init?.signal?.addEventListener("abort", () => {
                reject(new DOMException("Aborted", "AbortError"));
              });
            }),
        } as Response),
      ),
    );

    await expect(
      loadEventStats("https://api.example.com", "event-1", { timeoutMs: 20 }),
    ).resolves.toEqual({
      ok: false,
      message: "The API could not be reached.",
    });
  });
});
