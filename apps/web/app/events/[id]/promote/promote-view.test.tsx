// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PromoteView } from "./promote-view";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const EVENT_ID = "11111111-1111-4111-8111-111111111111";

const jsonResponse = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

const sample = {
  event_id: EVENT_ID,
  title: "Demo Night",
  event_date: "2026-08-26",
  venue: "Lot",
  borough: "brooklyn",
  description: "",
  public_page_published: false,
  public_path: `/e/${EVENT_ID}`,
  map_url: "https://maps.google.com/?q=Lot",
  infeasible_warning: true,
  plan_available: true,
  publication_blocked: false,
};

describe("PromoteView", () => {
  it("warns when infeasible and can publish the page", async () => {
    const user = userEvent.setup();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, sample))
      .mockResolvedValueOnce(
        jsonResponse(200, { ...sample, public_page_published: true, description: "Come through" }),
      );
    vi.stubGlobal("fetch", fetchMock);

    render(
      <PromoteView
        eventId={EVENT_ID}
        apiBaseUrl="https://api.example.com"
        webOrigin="https://web.example.com"
      />,
    );
    expect(await screen.findByText(/published deadline was missed/i)).toBeDefined();
    await user.type(screen.getByLabelText("Description"), "Come through");
    await user.click(screen.getByRole("button", { name: "Publish page" }));
    await waitFor(() => {
      expect(screen.getByText("Public page is live.")).toBeDefined();
    });
    expect(screen.getByText(`https://web.example.com/e/${EVENT_ID}`)).toBeDefined();
  });

  it("explains a prohibition and disables publication", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse(200, { ...sample, publication_blocked: true }),
    );
    vi.stubGlobal("fetch", fetchMock);
    render(
      <PromoteView
        eventId={EVENT_ID}
        apiBaseUrl="https://api.example.com"
        webOrigin="https://web.example.com"
      />,
    );

    expect(await screen.findByText(/published prohibition or ineligibility/i)).toBeDefined();
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "Publish page" }).disabled).toBe(
      true,
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("builds the share URL from the browser origin when webOrigin is unset", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse(200, sample)),
    );
    render(<PromoteView eventId={EVENT_ID} apiBaseUrl="https://api.example.com" />);
    expect(await screen.findByText(`${window.location.origin}/e/${EVENT_ID}`)).toBeDefined();
  });

  it("explains and disables publication when no plan exists", async () => {
    const fetchMock = vi.fn(async () => jsonResponse(200, { ...sample, plan_available: false }));
    vi.stubGlobal("fetch", fetchMock);
    render(
      <PromoteView
        eventId={EVENT_ID}
        apiBaseUrl="https://api.example.com"
        webOrigin="https://web.example.com"
      />,
    );

    expect(await screen.findByText(/generate a permit plan before publishing/i)).toBeDefined();
    expect(screen.getByRole("link", { name: "Open permit plan" }).getAttribute("href")).toBe(
      `/events/${EVENT_ID}/plan`,
    );
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "Publish page" }).disabled).toBe(
      true,
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("surfaces a friendly message when clipboard write is unavailable", async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse(200, sample)),
    );
    vi.stubGlobal("navigator", {
      ...navigator,
      clipboard: undefined,
    });
    render(
      <PromoteView
        eventId={EVENT_ID}
        apiBaseUrl="https://api.example.com"
        webOrigin="https://web.example.com"
      />,
    );
    expect(await screen.findByText(/Status: unpublished/i)).toBeDefined();
    await user.click(screen.getByRole("button", { name: "Copy link" }));
    expect(await screen.findByRole("alert")).toBeDefined();
    expect(screen.getByRole("alert").textContent).toMatch(/select the link/i);
  });
});
