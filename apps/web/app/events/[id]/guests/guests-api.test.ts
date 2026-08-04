import { afterEach, describe, expect, it, vi } from "vitest";
import { cancelGuest, createRsvp, loadGuestList } from "./guests-api";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const jsonResponse = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

const sampleList = {
  event: {
    id: "11111111-1111-4111-8111-111111111111",
    name: "Demo Night",
    capacity: 5,
    event_date: "2026-08-26",
  },
  rsvps: [
    {
      id: "22222222-2222-4222-8222-222222222222",
      event_id: "11111111-1111-4111-8111-111111111111",
      name: "Ada",
      email: "ada@example.com",
      phone: null,
      status: "confirmed" as const,
      created_at: "2026-07-25T12:00:00.000Z",
    },
  ],
  confirmed_count: 1,
};

describe("loadGuestList", () => {
  it("returns the organizer guest list from /guests (not the public RSVP path)", async () => {
    const fetchMock = vi.fn(async () => jsonResponse(200, sampleList));
    vi.stubGlobal("fetch", fetchMock);
    await expect(loadGuestList("https://api.example.com", sampleList.event.id)).resolves.toEqual({
      ok: true,
      list: sampleList,
    });
    expect(fetchMock).toHaveBeenCalledWith(
      `https://api.example.com/api/events/${sampleList.event.id}/guests`,
      expect.anything(),
    );
  });

  it("maps a missing event to a friendly message", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse(404, { error: "That event was not found." })),
    );
    await expect(loadGuestList("https://api.example.com", sampleList.event.id)).resolves.toEqual({
      ok: false,
      message: "That event was not found.",
    });
  });
});

describe("createRsvp", () => {
  it("posts name, email, and optional phone", async () => {
    const fetchMock = vi.fn(async () => jsonResponse(201, { rsvp: sampleList.rsvps[0] }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(
      createRsvp("https://api.example.com", sampleList.event.id, {
        name: "Ada",
        email: "ada@example.com",
      }),
    ).resolves.toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledWith(
      `https://api.example.com/api/events/${sampleList.event.id}/rsvps`,
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("surfaces event is full", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse(400, { error: "event is full" })),
    );
    await expect(
      createRsvp("https://api.example.com", sampleList.event.id, {
        name: "Ada",
        email: "ada@example.com",
      }),
    ).resolves.toEqual({ ok: false, message: "event is full" });
  });
});

describe("cancelGuest", () => {
  it("patches cancelled then reloads the list", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse(200, { rsvp: { ...sampleList.rsvps[0], status: "cancelled" } }),
      )
      .mockResolvedValueOnce(jsonResponse(200, { ...sampleList, confirmed_count: 0, rsvps: [] }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await cancelGuest(
      "https://api.example.com",
      sampleList.event.id,
      sampleList.rsvps[0]!.id,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.list.confirmed_count).toBe(0);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      `https://api.example.com/api/events/${sampleList.event.id}/guests/${sampleList.rsvps[0]!.id}`,
    );
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ method: "PATCH" });
  });
});
