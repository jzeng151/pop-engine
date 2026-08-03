// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { existsSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { publishedRulesFileIn } from "./rules-file";
import RootLayout, { metadata } from "./layout";
import Home from "./page";
import IntakePage from "./intake/page";
import EditIntakePage from "./intake/[id]/page";
import EventLayout from "./events/[id]/layout";
import EventOverviewPage from "./events/[id]/page";
import { intakeFormProps } from "./intake/intake-page-props";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => "/events/event-9",
}));

// The route components are thin: each one reads the published ruleset on the server and
// hands the questionnaire its props. These assert the wiring — that the contract really
// is the published registry, and that the edit route passes the id through — rather than
// re-testing the form, which has its own suite.

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

// `intakeFormProps` resolves the ruleset against the working directory, which is the
// Next app's own directory when it runs. Vitest runs from the repo root, so the tests
// point RULES_FILE at the same artifact the way a deployment does.
const useRepoRuleset = () => vi.stubEnv("RULES_FILE", publishedRulesFileIn("rules"));

describe("the app shell", () => {
  it("names the product and says the demo holds synthetic data only", () => {
    expect(metadata.title).toEqual({
      default: "PopEngine",
      template: "%s | PopEngine",
    });
    const shell = RootLayout({ children: <p>content</p> });
    expect(shell.type).toBe("html");
    expect(shell.props.lang).toBe("en");
    expect(shell.props["data-theme"]).toBe("light");
  });

  it("links the landing page to the questionnaire", () => {
    render(<Home />);
    expect(screen.getByRole("link", { name: "Describe your event" }).getAttribute("href")).toBe(
      "/intake",
    );
    expect(screen.getByRole("button", { name: "Switch to dark theme" })).toBeDefined();
  });
});

describe("intakeFormProps", () => {
  it("parses the published registry and points at the configured api", async () => {
    useRepoRuleset();
    vi.stubEnv("NEXT_PUBLIC_API_BASE_URL", "https://api.example.com");

    const props = await intakeFormProps();
    expect(props.contract.fields).toHaveLength(33);
    expect(props.contract.alcoholInPublicSpaceNotice.verificationStatus).toBe("COVERAGE_GAP");
    expect(props.apiBaseUrl).toBe("https://api.example.com");
  });

  it("falls back to the local api in development", async () => {
    useRepoRuleset();
    vi.stubEnv("NEXT_PUBLIC_API_BASE_URL", undefined);
    expect((await intakeFormProps()).apiBaseUrl).toBe("http://localhost:3001");
  });

  it("fails loudly when the ruleset is not where it expects", async () => {
    // With no RULES_FILE the rules DIRECTORY is resolved against the working directory, which is
    // the Next app's own directory when it runs and the repo root here. A page that cannot read
    // the published ruleset must not render a questionnaire at all.
    //
    // Matched on the directory rather than on a filename. Pinning `nyc-rules.v2.8.json` here made
    // this assertion itself a version landmine — the very thing the resolver removes — and it
    // would have gone green on the next bump only because the message happened to still contain
    // whatever name was hard-coded. The directory is what the page looks for now, so that is what
    // this asserts, and it stays true across every bump.
    vi.stubEnv("RULES_FILE", undefined);
    await expect(intakeFormProps()).rejects.toThrow(/rules/);
  });
});

describe("the intake routes", () => {
  it("renders a blank questionnaire at /intake", async () => {
    useRepoRuleset();
    render(await IntakePage());
    expect(screen.getByRole("heading").textContent).toBe("Describe your event");
    expect(screen.getByRole("group", { name: /Borough/ })).toBeDefined();
  });

  it("loads the named event at /intake/[id]", async () => {
    useRepoRuleset();
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise(() => {})),
    );
    render(await EditIntakePage({ params: Promise.resolve({ id: "event-9" }) }));
    // The form takes it from here: it fetches the event from the browser, because the
    // Access cookie is the browser's and not this server's.
    expect(screen.getByRole("status").textContent).toBe("Loading your event…");
  });
});

// Vitest runs from the repo root, the same assumption `useRepoRuleset` above is built on.
const APP_DIRECTORY = resolve("apps/web/app");

/**
 * The route module Next would serve `href` from, or null when `app/` has no route for it.
 *
 * Walks the segments the way the router does — a literal directory first, the dynamic `[param]`
 * one otherwise — so a destination page that is deleted or renamed resolves to null here. Asserting
 * the href strings alone could not: those strings come from the component under test, so both sides
 * of the comparison move together and a dead link stays green.
 */
function routeModuleFor(href: string): string | null {
  let directory = APP_DIRECTORY;
  for (const segment of href.split("/").filter((part) => part !== "")) {
    const directories = readdirSync(directory, { withFileTypes: true }).filter((entry) =>
      entry.isDirectory(),
    );
    const match =
      directories.find((entry) => entry.name === segment) ??
      directories.find((entry) => /^\[.+\]$/.test(entry.name));
    if (match === undefined) return null;
    directory = join(directory, match.name);
  }
  const routeModule = join(directory, "page.tsx");
  return existsSync(routeModule) ? routeModule : null;
}

// F-705 AC 8: the overview links only to routes that exist. A destination removed or renamed
// elsewhere leaves a dead link here, and the shell's own suite does not cover this page.
describe("the event overview route", () => {
  it("links every listed destination to a route module that serves it", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise(() => undefined)),
    );
    render(await EventOverviewPage({ params: Promise.resolve({ id: "event-9" }) }));

    const destinations = screen.getAllByRole("link").map((link) => link.getAttribute("href") ?? "");
    const reachable = Object.fromEntries(
      destinations.map((href) => [href, routeModuleFor(href) !== null]),
    );
    expect(reachable).toEqual({
      "/e/event-9/checkin": true,
      "/events/event-9/checklist": true,
      "/events/event-9/dashboard": true,
      "/events/event-9/guests": true,
      "/events/event-9/plan": true,
      "/events/event-9/promote": true,
      "/intake/event-9": true,
    });
  });

  // The stale-plan notice and the workspace shell are client components: they fetch from the
  // organizer's browser, so a server-only `API_BASE_URL` reaches neither and both fall back to
  // localhost in every deployment. `NEXT_PUBLIC_API_BASE_URL` is the variable the deployment sets.

  it("points the workspace shell at the configured browser api", async () => {
    vi.stubEnv("NEXT_PUBLIC_API_BASE_URL", "https://api.example.com");
    const fetchMock = vi.fn(() => new Promise<Response>(() => undefined));
    vi.stubGlobal("fetch", fetchMock);

    render(
      await EventLayout({
        children: <p>Current surface</p>,
        params: Promise.resolve({ id: "event-9" }),
      }),
    );

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "https://api.example.com/api/events/event-9",
        expect.anything(),
      ),
    );
  });
});
