// @vitest-environment jsdom

import { cleanup, render, screen, within } from "@testing-library/react";
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

    // F-705 AC 5: the visible PLANNED stamp is the group's, published once by
    // `docs/DESIGN-SYSTEM.md` and drawn by `.riso-nav__group--planned::after`. Nothing inside a
    // button may claim it: a per-button stamp in the markup is a stamp the stylesheet hides, which
    // is a criterion this test would report as met while no organizer ever sees it.
    // The shell renders the rail once per breakpoint, so every copy of the group is checked.
    const groups = screen
      .getAllByRole("heading", { name: "Planned" })
      .map((heading) => heading.closest("section") as HTMLElement);
    expect(groups.length).toBeGreaterThan(0);

    for (const group of groups) {
      expect(within(group).queryAllByRole("link")).toHaveLength(0);
      const buttons = within(group).getAllByRole("button");
      expect(buttons.length).toBeGreaterThan(0);
      for (const button of buttons) {
        expect((button as HTMLButtonElement).disabled).toBe(true);
        expect(button.textContent).not.toContain("Planned");
      }
      expect(group.querySelectorAll(".riso-nav__stamp")).toHaveLength(0);
    }
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

  // F-705 AC 3 and the spec's state table: a blank or absent name is `unavailable`, not `ready`.
  // `ready` would say the event responded with a name it never sent, and the placeholder on screen
  // would be reported as that name.
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
    expect(masthead.getAttribute("data-load-state")).toBe("unavailable");
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

// F-705 AC 2, narrowed 2026-08-03: aria-current is promised only for the destinations this
// layout wraps. Event intake and Check-in are outside it — following either unmounts the shell,
// so no rail survives to carry the mark. This pins which destinations are in the promise, so a
// future edit that widens the criterion has to change a test that says why it cannot hold.
describe("F-705 AC 2: which destinations the aria-current promise covers", () => {
  const WRAPPED = [
    "/events/event-9",
    "/events/event-9/plan",
    "/events/event-9/checklist",
    "/events/event-9/promote",
    "/events/event-9/guests",
    "/events/event-9/dashboard",
  ];
  const OUTSIDE_THE_SHELL = ["/intake/event-9", "/e/event-9/checkin"];

  it("routes every promised destination through the layout that mounts the shell", () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise(() => undefined)),
    );
    render(
      <EventWorkspace apiBaseUrl="https://api.example.com" eventId="event-9">
        <p>Current surface</p>
      </EventWorkspace>,
    );

    const hrefs = screen.getAllByRole("link").map((link) => link.getAttribute("href") ?? "");
    // Both sets are rendered by the shell...
    for (const href of [...WRAPPED, ...OUTSIDE_THE_SHELL]) expect(hrefs).toContain(href);
    // ...but only the wrapped ones sit under /events/[id], which is the only path
    // apps/web/app/events/[id]/layout.tsx mounts EventWorkspace for.
    for (const href of WRAPPED) expect(href.startsWith("/events/")).toBe(true);
    for (const href of OUTSIDE_THE_SHELL) expect(href.startsWith("/events/")).toBe(false);
  });
});
