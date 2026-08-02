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

  // F-705 AC 3: an event that cannot be read leaves the workspace usable and says nothing about
  // the event. Naming it, or claiming it is missing, would both assert more than the failure knows.
  it("keeps the shell navigable and invents no name when the event cannot be read", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("", { status: 500 })));

    render(
      <EventWorkspace apiBaseUrl="https://api.example.com" eventId="event-9">
        <p>Current surface</p>
      </EventWorkspace>,
    );

    const masthead = await screen.findByText("Event workspace");
    expect(masthead.getAttribute("data-load-state")).toBe("unavailable");
    expect(masthead.getAttribute("aria-live")).toBe("polite");
    expect(screen.getAllByRole("link", { name: "Permit plan" }).length).toBeGreaterThan(0);
  });

  // F-705 AC 3: a blank name is absent, not an empty heading.
  it("treats a whitespace-only event name as absent", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ event: { id: "event-9", name: "   " }, plan_stale: false }), {
          headers: { "Content-Type": "application/json" },
          status: 200,
        }),
      ),
    );

    render(
      <EventWorkspace apiBaseUrl="https://api.example.com" eventId="event-9">
        <p>Current surface</p>
      </EventWorkspace>,
    );

    const masthead = await screen.findByText("Event workspace");
    expect(masthead.getAttribute("data-load-state")).toBe("ready");
  });

  // F-705 AC 4 and AC 7: the capstone label and the two access affordances that carry no visible
  // text of their own, so nothing else would catch their removal.
  it("labels the demo and exposes the skip link and named navigation", () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise(() => undefined)),
    );

    render(
      <EventWorkspace apiBaseUrl="https://api.example.com" eventId="event-9">
        <p>Current surface</p>
      </EventWorkspace>,
    );

    expect(screen.getByText("Synthetic data demo")).toBeDefined();
    expect(screen.getByRole("link", { name: "Skip to event content" }).getAttribute("href")).toBe(
      "#event-workspace-content",
    );
    expect(screen.getAllByRole("navigation", { name: "Event lifecycle" }).length).toBeGreaterThan(
      0,
    );
  });
});
