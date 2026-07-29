// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { EventWorkspace } from "./event-workspace";

vi.mock("next/navigation", () => ({
  usePathname: () => "/events/event-9/plan",
}));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("the organizer event workspace", () => {
  it("loads the active event and marks the current lifecycle route", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            event: {
              id: "event-9",
              name: "Night Market",
              revision_counter: 2,
            },
            plan_stale: false,
          }),
          { headers: { "Content-Type": "application/json" }, status: 200 },
        ),
      ),
    );

    render(
      <EventWorkspace apiBaseUrl="https://api.example.com" eventId="event-9">
        <p>Current surface</p>
      </EventWorkspace>,
    );

    expect(await screen.findByText("Night Market")).toBeDefined();
    for (const link of screen.getAllByRole("link", { name: "Permit plan" })) {
      expect(link.getAttribute("aria-current")).toBe("page");
    }
    expect(screen.getByText("Current surface")).toBeDefined();
    expect(document.querySelector("#event-workspace-content")?.getAttribute("tabindex")).toBe("-1");
    expect(screen.getByRole("button", { name: "Switch to dark theme" })).toBeDefined();
  });

  it("exposes future modules as disabled planned scaffolds", () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise(() => undefined)),
    );

    render(
      <EventWorkspace apiBaseUrl="https://api.example.com" eventId="event-9">
        <p>Current surface</p>
      </EventWorkspace>,
    );

    for (const button of screen.getAllByRole("button", { name: "AI assistantPlanned" })) {
      expect((button as HTMLButtonElement).disabled).toBe(true);
    }
    expect(screen.getAllByText("Planned").length).toBeGreaterThan(0);
  });
});
