// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { GuestListView } from "./guest-list";
import GuestsPage from "./page";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

const EVENT_ID = "11111111-1111-4111-8111-111111111111";
const RSVP_ID = "22222222-2222-4222-8222-222222222222";

const jsonResponse = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

const listBody = {
  event: {
    id: EVENT_ID,
    name: "Demo Night",
    capacity: 5,
    event_date: "2026-08-26",
  },
  rsvps: [
    {
      id: RSVP_ID,
      event_id: EVENT_ID,
      name: "Ada Lovelace",
      email: "ada@example.com",
      phone: "5551112222",
      status: "confirmed",
      created_at: "2026-07-25T12:00:00.000Z",
    },
  ],
  confirmed_count: 1,
};

describe("GuestListView", () => {
  // SPEC-CONFLICT #209, resolved 2026-08-03: a null capacity is no confirmed limit, so the
  // count is shown on its own rather than against a number the organizer never set.
  it("shows the count alone when no capacity is confirmed", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({ ...listBody, event: { ...listBody.event, capacity: null } }),
          {
            headers: { "Content-Type": "application/json" },
            status: 200,
          },
        ),
      ),
    );
    render(<GuestListView eventId={EVENT_ID} apiBaseUrl="https://api.example.com" />);
    expect(await screen.findByText("1 confirmed")).toBeDefined();
  });

  // The note is rendered during the compatibility window, when `readLimit` may have taken the
  // number from a pre-rename API's regulatory `headcount`. Calling that a confirmed capacity
  // tells the organizer something the responding API has not stated, so the copy names the
  // limit by what it does rather than by which field supplied it.
  it("does not call the limit a confirmed capacity when a pre-rename api supplied it", async () => {
    const legacyBody = {
      ...listBody,
      event: { id: EVENT_ID, name: "Demo Night", headcount: 5, event_date: "2026-08-26" },
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, legacyBody)));

    render(<GuestListView eventId={EVENT_ID} apiBaseUrl="https://api.example.com" />);
    expect(await screen.findByText("1 of 5 confirmed")).toBeDefined();
    const note = document.querySelector(".guests__note");
    expect(note?.textContent).toContain("current admission limit");
    expect(note?.textContent).not.toContain("confirmed capacity");
  });

  it("shows confirmed count vs capacity and can cancel an RSVP", async () => {
    const user = userEvent.setup();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, listBody))
      .mockResolvedValueOnce(
        jsonResponse(200, { rsvp: { ...listBody.rsvps[0], status: "cancelled" } }),
      )
      .mockResolvedValueOnce(
        jsonResponse(200, {
          ...listBody,
          confirmed_count: 0,
          rsvps: [{ ...listBody.rsvps[0], status: "cancelled" }],
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    render(<GuestListView eventId={EVENT_ID} apiBaseUrl="https://api.example.com" />);
    expect(await screen.findByText("1 of 5 confirmed")).toBeDefined();
    expect(screen.getByText("Ada Lovelace")).toBeDefined();

    await user.click(screen.getByRole("button", { name: "Cancel RSVP" }));
    await waitFor(() => {
      expect(screen.getByText("0 of 5 confirmed")).toBeDefined();
    });
    expect(screen.getByText(/cancelled/i)).toBeDefined();
  });

  it("rejects a malformed event id without calling the api", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    render(<GuestListView eventId="bad" apiBaseUrl="https://api.example.com" />);
    expect(screen.getByRole("alert").textContent).toMatch(/not valid/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("keeps the newer cancel reload when overlapping cancels finish out of order", async () => {
    const user = userEvent.setup();
    const rsvpB = {
      id: "33333333-3333-4333-8333-333333333333",
      event_id: EVENT_ID,
      name: "Grace Hopper",
      email: "grace@example.com",
      phone: null,
      status: "confirmed",
      created_at: "2026-07-25T12:01:00.000Z",
    };
    const twoGuests = {
      ...listBody,
      confirmed_count: 2,
      rsvps: [listBody.rsvps[0], rsvpB],
    };

    let resolveFirstReload: ((value: Response) => void) | undefined;
    const firstReload = new Promise<Response>((resolve) => {
      resolveFirstReload = resolve;
    });

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, twoGuests))
      .mockResolvedValueOnce(
        jsonResponse(200, { rsvp: { ...listBody.rsvps[0], status: "cancelled" } }),
      )
      .mockImplementationOnce(async () => firstReload)
      .mockResolvedValueOnce(jsonResponse(200, { rsvp: { ...rsvpB, status: "cancelled" } }))
      .mockResolvedValueOnce(
        jsonResponse(200, {
          ...twoGuests,
          confirmed_count: 0,
          rsvps: [
            { ...listBody.rsvps[0], status: "cancelled" },
            { ...rsvpB, status: "cancelled" },
          ],
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    render(<GuestListView eventId={EVENT_ID} apiBaseUrl="https://api.example.com" />);
    expect(await screen.findByText("2 of 5 confirmed")).toBeDefined();

    const buttons = screen.getAllByRole("button", { name: "Cancel RSVP" });
    await user.click(buttons[0]!);
    await user.click(buttons[1]!);

    await waitFor(() => {
      expect(screen.getByText("0 of 5 confirmed")).toBeDefined();
    });

    resolveFirstReload?.(
      jsonResponse(200, {
        ...twoGuests,
        confirmed_count: 1,
        rsvps: [{ ...listBody.rsvps[0], status: "cancelled" }, rsvpB],
      }),
    );
    await waitFor(() => {
      expect(screen.getByText("0 of 5 confirmed")).toBeDefined();
    });
    expect(screen.queryByText("1 of 5 confirmed")).toBeNull();
  });

  it("keeps an earlier successful cancel when a newer cancel fails", async () => {
    const user = userEvent.setup();
    const rsvpB = {
      id: "33333333-3333-4333-8333-333333333333",
      event_id: EVENT_ID,
      name: "Grace Hopper",
      email: "grace@example.com",
      phone: null,
      status: "confirmed",
      created_at: "2026-07-25T12:01:00.000Z",
    };
    const twoGuests = {
      ...listBody,
      confirmed_count: 2,
      rsvps: [listBody.rsvps[0], rsvpB],
    };

    let resolveFirstReload: ((value: Response) => void) | undefined;
    const firstReload = new Promise<Response>((resolve) => {
      resolveFirstReload = resolve;
    });

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, twoGuests))
      .mockResolvedValueOnce(
        jsonResponse(200, { rsvp: { ...listBody.rsvps[0], status: "cancelled" } }),
      )
      .mockImplementationOnce(async () => firstReload)
      .mockResolvedValueOnce(jsonResponse(500, { error: "cancel failed" }));
    vi.stubGlobal("fetch", fetchMock);

    render(<GuestListView eventId={EVENT_ID} apiBaseUrl="https://api.example.com" />);
    expect(await screen.findByText("2 of 5 confirmed")).toBeDefined();

    const buttons = screen.getAllByRole("button", { name: "Cancel RSVP" });
    await user.click(buttons[0]!);
    await user.click(buttons[1]!);

    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toMatch(/cancel failed|could not/i);
    });

    resolveFirstReload?.(
      jsonResponse(200, {
        ...twoGuests,
        confirmed_count: 1,
        rsvps: [{ ...listBody.rsvps[0], status: "cancelled" }, rsvpB],
      }),
    );
    await waitFor(() => {
      expect(screen.getByText("1 of 5 confirmed")).toBeDefined();
    });
  });
});

describe("GuestsPage", () => {
  it("wires the route id into the guest list", async () => {
    vi.stubEnv("NEXT_PUBLIC_API_BASE_URL", "https://api.example.com");
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise(() => {})),
    );
    render(await GuestsPage({ params: Promise.resolve({ id: EVENT_ID }) }));
    expect(screen.getByRole("status").textContent).toBe("Loading guest list…");
  });
});
