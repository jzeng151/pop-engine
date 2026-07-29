// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CheckinForm } from "./checkin-form";
import CheckinPage from "./page";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

const EVENT_ID = "11111111-1111-4111-8111-111111111111";

const jsonResponse = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

describe("CheckinForm", () => {
  it("shows exactly two inputs and confirms by name on success", async () => {
    const user = userEvent.setup();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, { event: { id: EVENT_ID, name: "Demo Night" } }))
      .mockResolvedValueOnce(
        jsonResponse(201, {
          checkin: {
            id: "c1",
            event_id: EVENT_ID,
            rsvp_id: null,
            name: "Ada Lovelace",
            contact: "ada@example.com",
            checked_in_at: "2026-07-25T12:00:00.000Z",
          },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    render(<CheckinForm eventId={EVENT_ID} apiBaseUrl="https://api.example.com" />);
    expect(await screen.findByRole("heading", { name: "Check in" })).toBeDefined();
    expect(screen.getByRole("main")).toBeDefined();
    expect(screen.getByLabelText("Name")).toBeDefined();
    const contact = screen.getByLabelText("Email or phone");
    expect(contact).toBeDefined();
    expect(contact.getAttribute("autocomplete")).toBeNull();
    expect(contact.getAttribute("inputmode")).toBeNull();
    expect(screen.getAllByRole("textbox")).toHaveLength(2);

    await user.type(screen.getByLabelText("Name"), "Ada Lovelace");
    await user.type(screen.getByLabelText("Email or phone"), "ada@example.com");
    await user.click(screen.getByRole("button", { name: "Check in" }));

    await waitFor(() => {
      expect(
        screen.getByRole("heading", { name: /You.re checked in, Ada Lovelace/ }),
      ).toBeDefined();
    });
    expect(screen.getByRole("main")).toBeDefined();
    expect(screen.getByText(/Synthetic demo data only/i)).toBeDefined();
  });

  it("rejects a malformed event id without calling the api", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    render(<CheckinForm eventId="not-a-uuid" apiBaseUrl="https://api.example.com" />);
    expect(screen.getByRole("heading", { name: "Check-in unavailable" })).toBeDefined();
    expect(screen.getByRole("alert").textContent).toMatch(/not valid/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("shows a friendly error when the event is unknown", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse(404, { error: "That event was not found." })),
    );
    render(<CheckinForm eventId={EVENT_ID} apiBaseUrl="https://api.example.com" />);
    expect(await screen.findByRole("heading", { name: "Check-in unavailable" })).toBeDefined();
    expect(screen.getByRole("alert").textContent).toMatch(/not found/i);
  });

  it("keeps the form up and shows the api message when submit fails", async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(jsonResponse(200, { event: { id: EVENT_ID, name: "Demo Night" } }))
        .mockResolvedValueOnce(jsonResponse(400, { error: "contact is required" })),
    );
    render(<CheckinForm eventId={EVENT_ID} apiBaseUrl="https://api.example.com" />);
    await screen.findByRole("heading", { name: "Check in" });
    await user.type(screen.getByLabelText("Name"), "Ada");
    await user.type(screen.getByLabelText("Email or phone"), "x");
    await user.click(screen.getByRole("button", { name: "Check in" }));
    expect((await screen.findByRole("alert")).textContent).toBe("contact is required");
    expect(screen.getByRole("heading", { name: "Check in" })).toBeDefined();
  });
});

describe("CheckinPage", () => {
  it("wires the route params and api base url into the form", async () => {
    vi.stubEnv("NEXT_PUBLIC_API_BASE_URL", "https://api.example.com");
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise(() => {})),
    );
    render(await CheckinPage({ params: Promise.resolve({ eventId: EVENT_ID }) }));
    expect(screen.getByRole("status").textContent).toBe("Opening check-in…");
  });
});
