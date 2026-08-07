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

  // `docs/ARCHITECTURE.md:9` rolls web and API independently, so this build can be talking to an
  // API that predates the `headcount` to `capacity` rename. Rejecting that response would empty
  // the guest list and take the cancel controls with it until the API deployment lands. The limit
  // an old API serves under `headcount` is the limit that API actually enforces, so it is read as
  // the limit rather than discarded.
  it("reads the pre-rename headcount as the limit when the API sends no capacity", async () => {
    const legacy = {
      ...sampleList,
      event: { ...sampleList.event, headcount: 40, capacity: undefined },
    };
    delete (legacy.event as { capacity?: unknown }).capacity;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse(200, legacy)),
    );

    const result = await loadGuestList("https://api.example.com", sampleList.event.id);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.list.event.capacity).toBe(40);
  });

  // Both generations at once is what a mid-rollout API serves. `capacity` is this contract's
  // field and `headcount` is the compatibility copy for pre-rename pages, so the newer field wins
  // and the older one is ignored rather than merged. Values that disagree are what a pre-rename
  // API would send, and this client must keep reading `capacity` there too.
  it("prefers capacity over headcount when the API serves both", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse(200, { ...sampleList, event: { ...sampleList.event, headcount: 40 } }),
      ),
    );

    const result = await loadGuestList("https://api.example.com", sampleList.event.id);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.list.event.capacity).toBe(5);
  });

  // A null capacity is a stated fact from a current API: no confirmed limit. It is not the same
  // as an absent one, and the fallback must not turn it into the regulatory headcount.
  it("keeps a stated null capacity even when headcount is also served", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse(200, {
          ...sampleList,
          event: { ...sampleList.event, capacity: null, headcount: 40 },
        }),
      ),
    );

    const result = await loadGuestList("https://api.example.com", sampleList.event.id);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.list.event.capacity).toBeNull();
  });

  // What the current API serves from 2026-08-05 (issue #236): the compatibility field mirrors the
  // enforced limit, so both keys are null when no capacity is confirmed. This build must read that
  // as no limit, not as a shape it cannot parse.
  it("reads a compatibility response whose headcount mirrors a null capacity", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse(200, {
          ...sampleList,
          event: { ...sampleList.event, capacity: null, headcount: null },
        }),
      ),
    );

    const result = await loadGuestList("https://api.example.com", sampleList.event.id);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.list.event.capacity).toBeNull();
  });

  it("rejects a list that carries neither capacity nor headcount", async () => {
    const neither = { ...sampleList, event: { ...sampleList.event, capacity: undefined } };
    delete (neither.event as { capacity?: unknown }).capacity;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse(200, neither)),
    );

    await expect(loadGuestList("https://api.example.com", sampleList.event.id)).resolves.toEqual({
      ok: false,
      message: "The API returned a guest list this page cannot read.",
    });
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
