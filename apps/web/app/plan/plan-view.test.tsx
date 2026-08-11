// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  CONFIRM_WITH_AGENCY,
  mergedDispositionOf,
  type Finding,
  type FindingRoute,
} from "@pop-engine/engine";
import { publishedRulesFileIn } from "../_lib/rules-file";
import PlanPage from "../events/[id]/plan/page";
import { PlanView } from "./plan-view";
import { SnapshotBanner, compareToPinned, formatSnapshotDate } from "./snapshot-banner";
import { verdictCopy } from "./verdict-copy";
import { NOT_COVERED_BY_RULESET } from "../_lib/verification-copy";

const publishedRuleset: {
  ruleset_version: string;
  snapshot_date: string;
  rules: PublishedRule[];
  advisories: PublishedRule[];
} = JSON.parse(readFileSync(resolve(publishedRulesFileIn("rules")), "utf8"));

type PublishedRule = {
  id: string;
  output: {
    permit_name?: string;
    note_text?: string;
    user_summary?: {
      heading: string;
      points: { sources: { label: string; url: string }[] }[];
    };
    portal?: { name?: string; url?: string | null; instructions?: string };
    [key: string]: unknown;
  };
  source?: { citation: string; urls: string[] };
  verification: { status: string; qualification?: string };
};

const publishedRule = (id: string) => {
  const rule = [...publishedRuleset.rules, ...publishedRuleset.advisories].find(
    (candidate) => candidate.id === id,
  );
  if (rule === undefined) throw new Error(`ruleset has no rule ${id}`);
  return rule;
};

const publishedHeading = (id: string): string => {
  const heading = publishedRule(id).output.user_summary?.heading;
  if (heading === undefined) throw new Error(`ruleset has no organizer heading for ${id}`);
  return heading;
};

const publishedSource = (id: string): { label: string; url: string } => {
  const source = publishedRule(id).output.user_summary?.points.flatMap((point) => point.sources)[0];
  if (source === undefined) throw new Error(`ruleset has no organizer source for ${id}`);
  return source;
};

const introducedFinding = (ruleId: string) => ({
  ruleIds: [ruleId],
  label: publishedHeading(ruleId),
  source: publishedSource(ruleId),
  portalName: publishedRule(ruleId).output.portal?.name ?? null,
  portalUrl: publishedRule(ruleId).output.portal?.url ?? null,
});

const rulesetReferences = {
  rulesetVersion: publishedRuleset.ruleset_version,
  findings: [...publishedRuleset.rules, ...publishedRuleset.advisories].flatMap((rule) => {
    if (rule.output.user_summary === undefined) return [];
    return [
      {
        ruleIds: [rule.id],
        label: rule.output.user_summary.heading,
        source: rule.output.user_summary.points.flatMap((point) => point.sources)[0] ?? null,
        portalName: rule.output.portal?.name ?? null,
        portalUrl: rule.output.portal?.url ?? null,
      },
    ];
  }),
};

const CONFLICT_RULE = publishedRule("PARKS-EVENT-EXACTLY-20-001");

const HEADLINE_FROM_BINDING = [
  "name",
  "agency",
  "deadline",
  "deadlineDisplay",
  "latestApplyDate",
  "applyAfterDate",
  "deadlineStatus",
  "feeDisplay",
  "portalName",
  "portalUrl",
  "portalInstructions",
] as const;

const headlineOf = (overrides: Partial<Finding>): Partial<Finding> => {
  const binding = overrides.routes?.[0];
  if (binding === undefined) return {};
  const headline: Record<string, unknown> = {};
  for (const field of HEADLINE_FROM_BINDING) {
    headline[field] = field in overrides ? overrides[field] : binding[field];
  }
  headline.disposition =
    "disposition" in overrides
      ? overrides.disposition
      : mergedDispositionOf(overrides.routes as readonly FindingRoute[]);
  return headline as Partial<Finding>;
};

const finding = (overrides: Partial<Finding> = {}): Finding => ({
  ruleIds: ["PARKS-EVENT-001"],
  kind: "permit",
  disposition: "required",
  name: "Special Event Permit",
  agency: "NYC Parks",
  deadline: null,
  deadlineDisplay: null,
  latestApplyDate: null,
  applyAfterDate: null,
  deadlineStatus: "not_applicable",
  slackDays: null,
  feeDisplay: null,
  portalName: null,
  portalUrl: null,
  portalInstructions: null,
  notes: [],
  noteText: null,
  deadlineUnknownFields: [],
  timelineUnresolvedReason: null,
  conflictText: null,
  sources: [
    { ruleId: "PARKS-EVENT-001", citation: "Parks FAQ", urls: ["https://example.gov/faq"] },
  ],
  verificationStatus: "SOURCE_CONFIRMED",
  lastVerifiedDate: null,
  triggeredBy: [],
  ...overrides,
  ...headlineOf(overrides),
});

const emptyVerdictDetail = {
  blockingFinding: null,
  missedRuleIds: [],
  minSlackDays: null,
  missingFacts: [],
  unresolvedTimelines: [],
  rescopeSuggestions: [],
};

const plan = (overrides: Record<string, unknown> = {}) => ({
  id: "plan-1",
  eventId: "event-1",
  eventRevision: 1,
  rulesetVersion: publishedRuleset.ruleset_version,
  snapshotDate: publishedRuleset.snapshot_date,
  verdict: "CONDITIONAL",
  verdictDetail: emptyVerdictDetail,
  today: "2026-07-25",
  generatedAt: "2026-07-25T12:00:00.000Z",
  findings: [finding()],
  ...overrides,
});

const jsonResponse = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const liveMeta = {
  ruleset_version: publishedRuleset.ruleset_version,
  snapshot_date: publishedRuleset.snapshot_date,
};

const stubApi = (
  planBody: unknown,
  metaBody: unknown = liveMeta,
  planStatus = 200,
  metaStatus = 200,
) => {
  const pinned = (planBody as { eventRevision?: number }).eventRevision ?? 1;
  const fetchMock = vi.fn(async (url: string) => {
    if (url.endsWith("/rules/meta")) return jsonResponse(metaStatus, metaBody);
    if (url.endsWith("/plan")) return jsonResponse(planStatus, planBody);
    return jsonResponse(200, {
      event: { id: "event-1", revision_counter: pinned },
      warnings: [],
      plan_stale: false,
    });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
};

const renderPlan = (eventId = "event-1") =>
  render(
    <PlanView
      apiBaseUrl="https://api.example.com"
      eventId={eventId}
      rulesetReferences={rulesetReferences}
    />,
  );

beforeEach(() => {
  sessionStorage.clear();
  stubApi(plan());
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("initial-create recovery", () => {
  const storageKey = "pop-engine.pending-event-create:https://api.example.com";
  const storeRecovery = (eventId: string) =>
    sessionStorage.setItem(
      storageKey,
      JSON.stringify({
        key: "44f58390-9892-4e1b-b1ed-ecf00ea20967",
        body: {},
        answers: {},
        eventId,
      }),
    );

  it("clears the matching recovery operation after validating the stored plan", async () => {
    storeRecovery("event-1");
    renderPlan();

    await screen.findByRole("complementary", { name: "Rules snapshot" });
    expect(sessionStorage.getItem(storageKey)).toBeNull();
  });

  it("reports a matching recovery operation that durable storage could not clear", async () => {
    storeRecovery("event-1");
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
      throw new DOMException("storage disabled", "SecurityError");
    });
    renderPlan();

    expect(
      await screen.findByText(
        "The plan is ready, but this browser could not clear its saved recovery information. Refresh this page to try again before creating another event.",
      ),
    ).toBeDefined();
    expect(sessionStorage.getItem(storageKey)).not.toBeNull();
  });

  it("keeps recovery for another event", async () => {
    storeRecovery("event-2");
    renderPlan();

    await screen.findByRole("complementary", { name: "Rules snapshot" });
    expect(sessionStorage.getItem(storageKey)).not.toBeNull();
  });

  it("keeps recovery until a plan is actually found", async () => {
    storeRecovery("event-1");
    stubApi({}, liveMeta, 404);
    renderPlan();

    await screen.findByRole("button", { name: "Generate the plan" });
    expect(sessionStorage.getItem(storageKey)).not.toBeNull();
  });

  it("blocks generation while the recovery read is indeterminate", async () => {
    storeRecovery("event-1");
    const fetchMock = stubApi({}, liveMeta, 404);
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("storage disabled", "SecurityError");
    });
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
      throw new DOMException("storage disabled", "SecurityError");
    });
    const user = userEvent.setup();
    renderPlan();

    await user.click(await screen.findByRole("button", { name: "Generate the plan" }));

    expect(
      await screen.findByText(
        "This browser could not safely read or clear the saved event recovery. Reload this page once session storage is available before generating a plan.",
      ),
    ).toBeDefined();
    expect(fetchMock.mock.calls.filter(([url]) => url.endsWith("/plan"))).toHaveLength(1);
  });

  it("reuses the matching recovery key for a differently cased event path", async () => {
    storeRecovery("event-1");
    let generated = false;
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith("/rules/meta")) return jsonResponse(200, liveMeta);
      if (url.endsWith("/plan")) {
        if (init?.method === "POST") {
          generated = true;
          return jsonResponse(200, plan());
        }
        return generated ? jsonResponse(200, plan()) : jsonResponse(404, {});
      }
      return jsonResponse(200, {
        event: { id: "event-1", revision_counter: 1 },
        warnings: [],
        plan_stale: false,
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    renderPlan("EVENT-1");

    await user.click(await screen.findByRole("button", { name: "Generate the plan" }));

    await screen.findByRole("complementary", { name: "Rules snapshot" });
    const planPost = fetchMock.mock.calls.find(
      ([url, init]) => url.endsWith("/plan") && init?.method === "POST",
    );
    expect(new Headers(planPost?.[1]?.headers).get("Idempotency-Key")).toBe(
      "44f58390-9892-4e1b-b1ed-ecf00ea20967",
    );
    expect(sessionStorage.getItem(storageKey)).toBeNull();
  });

  it("keeps recovery when a 2xx generation response and its re-read are unreadable", async () => {
    storeRecovery("event-1");
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith("/rules/meta")) return jsonResponse(200, liveMeta);
      if (url.endsWith("/plan")) {
        return init?.method === "POST"
          ? new Response("<html>Access challenge</html>", { status: 200 })
          : jsonResponse(404, { error: "no plan generated" });
      }
      return jsonResponse(200, {
        event: { id: "event-1", revision_counter: 1 },
        warnings: [],
        plan_stale: false,
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    renderPlan();

    await user.click(await screen.findByRole("button", { name: "Generate the plan" }));

    expect(await screen.findByText("The API returned a plan this page cannot read.")).toBeDefined();
    expect(sessionStorage.getItem(storageKey)).not.toBeNull();
    expect(screen.getByRole("button", { name: "Generate the plan" })).toBeDefined();
  });
});

describe("the snapshot banner (AC 1)", () => {
  it("states the ruleset version and the date it was published", async () => {
    renderPlan();
    const banner = await screen.findByRole("complementary", { name: "Rules snapshot" });

    expect(banner.textContent).toContain(`Rules snapshot ${publishedRuleset.ruleset_version}`);
    expect(banner.textContent).toContain(
      `published ${formatSnapshotDate(publishedRuleset.snapshot_date)}`,
    );
  });

  it("never says the rules were verified as of that date", () => {
    render(<SnapshotBanner rulesetVersion="nyc.v2.3" snapshotDate="2026-07-25" meta={liveMeta} />);
    const banner = screen.getByRole("complementary", { name: "Rules snapshot" });

    expect(banner.textContent?.toLowerCase()).not.toContain("verified");
    expect(banner.textContent?.toLowerCase()).toContain("published");
  });

  it("takes the version and the date from the artifact rather than from copy", () => {
    render(
      <SnapshotBanner
        rulesetVersion="nyc.v9.9"
        snapshotDate="2030-01-31"
        meta={{ ruleset_version: "nyc.v9.9", snapshot_date: "2030-01-31" }}
      />,
    );
    const banner = screen.getByRole("complementary", { name: "Rules snapshot" });

    expect(banner.textContent).toContain("Rules snapshot nyc.v9.9");
    expect(banner.textContent).toContain("published January 31, 2030");
  });

  it("reads the published date as a calendar day, not an instant", () => {
    expect(formatSnapshotDate("2026-07-25")).toBe("July 25, 2026");
    expect(formatSnapshotDate("2026-01-01")).toBe("January 1, 2026");
    expect(formatSnapshotDate("not-a-date")).toBe("not-a-date");
  });
});

describe("a plan pinned to an older ruleset (AC 4)", () => {
  const PINNED = { rulesetVersion: "nyc.v2.1", snapshotDate: "2026-03-02" };

  it("shows the version that produced the plan, not the one now published", async () => {
    stubApi(plan(PINNED));
    renderPlan();
    const banner = await screen.findByRole("complementary", { name: "Rules snapshot" });

    expect(banner.textContent).toContain("Rules snapshot nyc.v2.1");
    expect(banner.textContent).not.toContain(publishedRuleset.ruleset_version.replace("nyc.", "v"));
    expect(banner.textContent).toContain(
      `a newer ruleset (${publishedRuleset.ruleset_version}) exists; regenerate to update`,
    );
  });

  it("dates a superseded plan from its own row, never from the live file", async () => {
    stubApi(plan(PINNED));
    renderPlan();
    const banner = await screen.findByRole("complementary", { name: "Rules snapshot" });

    expect(banner.textContent).toContain("published March 2, 2026");
    expect(banner.textContent).not.toContain(formatSnapshotDate(publishedRuleset.snapshot_date));
  });

  it("states the pinned pair even when the live ruleset cannot be read", async () => {
    stubApi(plan(PINNED), {}, 200, 503);
    renderPlan();
    const banner = await screen.findByRole("complementary", { name: "Rules snapshot" });

    expect(banner.textContent).toContain("Rules snapshot nyc.v2.1");
    expect(banner.textContent).toContain("published March 2, 2026");
    expect(banner.textContent).not.toContain("newer ruleset");
  });

  it("never asks the live file for a date, even when the versions agree", async () => {
    stubApi(plan({ snapshotDate: "2026-03-02" }), {
      ruleset_version: publishedRuleset.ruleset_version,
      snapshot_date: "2026-12-31",
    });
    renderPlan();
    const banner = await screen.findByRole("complementary", { name: "Rules snapshot" });

    expect(banner.textContent).toContain("published March 2, 2026");
    expect(banner.textContent).not.toContain("December 31, 2026");
  });
});

describe("a plan generated before migration 002 recorded a snapshot date (AC 4)", () => {
  it("names the pinned version and says the publication date was not recorded", async () => {
    stubApi(plan({ rulesetVersion: "nyc.v2.1", snapshotDate: null }));
    renderPlan();
    const banner = await screen.findByRole("complementary", { name: "Rules snapshot" });

    expect(banner.textContent).toContain("Rules snapshot nyc.v2.1");
    expect(banner.textContent).toContain("publication date not recorded for this plan");
  });

  it("does not fall back to the live file's date", async () => {
    stubApi(plan({ snapshotDate: null }), {
      ruleset_version: publishedRuleset.ruleset_version,
      snapshot_date: "2026-12-31",
    });
    renderPlan();
    const banner = await screen.findByRole("complementary", { name: "Rules snapshot" });

    expect(banner.textContent).not.toContain("December 31, 2026");
    expect(banner.textContent).not.toContain("published ");
  });

  it("is the only reading of a missing date — an absent field is unreadable, not legacy", async () => {
    const { snapshotDate: _omitted, ...withoutDate } = plan();
    stubApi(withoutDate);
    renderPlan();

    expect(await screen.findByRole("alert")).toBeDefined();
    expect(screen.queryByRole("complementary", { name: "Rules snapshot" })).toBeNull();
    expect(screen.queryByText(/publication date not recorded/)).toBeNull();
  });
});

describe("per-line citations and status (AC 2, AC 3)", () => {
  const lineFor = async (only: Finding) => {
    stubApi(plan({ findings: [only] }));
    renderPlan();
    const line = within(await screen.findByRole("article"));
    const toggle = line.queryByRole("button", { name: /^Details for/ });
    if (toggle !== null) await userEvent.click(toggle);
    return line;
  };

  it("shows each line's citation with click-through to the official page", async () => {
    const line = await lineFor(finding());

    expect(line.getByText("Parks FAQ")).toBeDefined();
    expect(line.getByRole("link", { name: /source/ }).getAttribute("href")).toBe(
      "https://example.gov/faq",
    );
  });

  it("renders every status the schema allows, visibly", async () => {
    const line = await lineFor(finding({ verificationStatus: "SOURCE_CONFIRMED" }));
    expect(line.getByText("SOURCE CONFIRMED")).toBeDefined();
  });

  it("shows a stored per-line verification date and omits it when absent", async () => {
    const dated = await lineFor(finding({ lastVerifiedDate: "2026-07-18" }));
    expect(dated.getByText("last verified 2026-07-18")).toBeDefined();
    cleanup();

    const undated = await lineFor(finding({ lastVerifiedDate: null }));
    expect(undated.queryByText(/last verified/i)).toBeNull();
  });

  it("reports an unreadable plan rather than crashing on a finding it cannot render", async () => {
    const { verificationStatus: _lost, ...withoutStatus } = finding();
    stubApi(plan({ findings: [withoutStatus] }));
    renderPlan();

    expect((await screen.findByRole("alert")).textContent).toContain(
      "The API returned a plan this page cannot read.",
    );
    expect(screen.queryByRole("article")).toBeNull();
  });

  it("renders RESEARCH_REQUIRED as confirm with agency, on the line and not in a tooltip", async () => {
    const line = await lineFor(finding({ verificationStatus: "RESEARCH_REQUIRED" }));

    const note = line.getByRole("note");
    expect(note.textContent).toBe(CONFIRM_WITH_AGENCY);
    expect(note.getAttribute("title")).toBeNull();
    expect(line.getByText("RESEARCH REQUIRED")).toBeDefined();
  });

  it.each([CONFIRM_WITH_AGENCY, `14–60 days depending on level; ${CONFIRM_WITH_AGENCY}`])(
    "renders one confirmation when the deadline displays %s",
    async (deadlineDisplay) => {
      const line = await lineFor(
        finding({
          verificationStatus: "RESEARCH_REQUIRED",
          deadline: { type: "research_required", display: null, qualification: null },
          deadlineDisplay,
          deadlineStatus: "not_calculable",
        }),
      );

      expect(
        (screen.getByRole("article").textContent ?? "").split(CONFIRM_WITH_AGENCY),
      ).toHaveLength(2);
      expect(line.getByText("RESEARCH REQUIRED")).toBeDefined();
    },
  );

  it.each(["Published output note", "Published verification qualification"])(
    "keeps one confirmation visible before and after expanding a %s",
    async (publishedProse) => {
      const note = `${publishedProse}: ${CONFIRM_WITH_AGENCY}`;
      stubApi(
        plan({
          findings: [
            finding({
              verificationStatus: "RESEARCH_REQUIRED",
              notes: [note],
            }),
          ],
        }),
      );
      renderPlan();
      const article = await screen.findByRole("article");
      const line = within(article);

      expect(line.getByRole("note").textContent).toBe(CONFIRM_WITH_AGENCY);
      expect(line.queryByText(note)).toBeNull();
      expect((article.textContent ?? "").split(CONFIRM_WITH_AGENCY)).toHaveLength(2);

      await userEvent.click(line.getByRole("button", { name: /^Details for/ }));

      expect(line.queryByRole("note")).toBeNull();
      expect(line.getByText(note)).toBeDefined();
      expect((article.textContent ?? "").split(CONFIRM_WITH_AGENCY)).toHaveLength(2);
      expect(line.getByText("RESEARCH REQUIRED")).toBeDefined();
    },
  );

  it("renders both readings of an official conflict with every source behind them", async () => {
    const conflict = finding({
      ruleIds: [CONFLICT_RULE.id],
      name: CONFLICT_RULE.output.permit_name ?? null,
      verificationStatus: "OFFICIAL_CONFLICT",
      conflictText: CONFLICT_RULE.output.note_text ?? null,
      sources: [
        {
          ruleId: CONFLICT_RULE.id,
          citation: CONFLICT_RULE.source?.citation ?? "",
          urls: CONFLICT_RULE.source?.urls ?? [],
        },
      ],
    });
    const line = await lineFor(conflict);

    expect(line.getByText(String(CONFLICT_RULE.output.note_text))).toBeDefined();
    expect(line.getByText("OFFICIAL CONFLICT")).toBeDefined();
    expect(line.getByText(String(CONFLICT_RULE.source?.citation))).toBeDefined();

    const urls = CONFLICT_RULE.source?.urls ?? [];
    expect(urls.length).toBeGreaterThan(1);
    const hrefs = line.getAllByRole("link").map((link) => link.getAttribute("href"));
    expect(hrefs).toEqual(urls);
  });

  it("shows a conflict's text once when the rule publishes it as both note and conflict", async () => {
    const shared = String(CONFLICT_RULE.output.note_text);
    const line = await lineFor(
      finding({ verificationStatus: "OFFICIAL_CONFLICT", conflictText: shared, noteText: shared }),
    );

    expect(line.getAllByText(shared)).toHaveLength(1);
  });

  it("renders a citation with no resolved URL as text, with no dead link", async () => {
    const line = await lineFor(
      finding({
        sources: [
          { ruleId: "PARKS-EVENT-001", citation: "Parks borough office, by phone", urls: [] },
        ],
      }),
    );

    expect(line.getByText("Parks borough office, by phone")).toBeDefined();
    expect(line.queryAllByRole("link")).toEqual([]);
  });

  it("logs loudly when a stored citation has lost its URL, and still renders the text", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const line = await lineFor(
        finding({
          sources: [
            { ruleId: "PARKS-EVENT-001", citation: "Parks borough office, by phone", urls: [] },
          ],
        }),
      );

      await waitFor(() =>
        expect(logged).toHaveBeenCalledWith(
          expect.stringContaining("no source URL"),
          expect.objectContaining({
            ruleId: "PARKS-EVENT-001",
            citation: "Parks borough office, by phone",
          }),
        ),
      );
      expect(line.getByText("Parks borough office, by phone")).toBeDefined();
      expect(line.queryAllByRole("link")).toEqual([]);
    } finally {
      logged.mockRestore();
    }
  });

  it("says nothing about a citation that has its URL", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await lineFor(finding());
      expect(logged).not.toHaveBeenCalled();
    } finally {
      logged.mockRestore();
    }
  });

  it("renders the explicit not-covered-by-this-ruleset-version state for a source-less coverage gap", async () => {
    const line = await lineFor(
      finding({
        ruleIds: ["ADV-ALCOHOL-PUBLIC-001"],
        kind: "advisory",
        disposition: "advisory",
        agency: null,
        sources: [],
        verificationStatus: "COVERAGE_GAP",
        userSummary: {
          heading: "Public-space alcohol needs agency review",
          points: [
            {
              kind: "warning",
              text: "This ruleset cannot determine the correct alcohol path.",
              sources: [],
            },
          ],
        },
      }),
    );

    expect(line.queryAllByRole("link")).toEqual([]);
    expect(line.getByText("COVERAGE GAP")).toBeDefined();
    expect(line.getByText(NOT_COVERED_BY_RULESET)).toBeDefined();
    expect(line.queryByText(/Source: not available in this ruleset/)).toBeNull();
  });

  it("omits the agency label on findings that publish no agency", async () => {
    const withAgency = await lineFor(finding({ agency: "NYC Parks" }));
    expect(withAgency.getByText("NYC Parks")).toBeDefined();
    cleanup();

    const line = await lineFor(finding({ agency: null, name: "Insurance determined at review" }));
    expect(line.queryByText("NYC Parks")).toBeNull();
    expect(line.getByRole("heading").textContent).toBe("Insurance determined at review");
  });

  it("renders the filing route for a rule that publishes instructions instead of a URL", async () => {
    const instructions = "File at the precinct where the device will be used; form PD 656-041A.";
    const line = await lineFor(
      finding({
        ruleIds: ["NYPD-SOUND-001"],
        portalName: "Local NYPD precinct (in person)",
        portalUrl: null,
        portalInstructions: instructions,
      }),
    );

    expect(line.getByText(/apply at Local NYPD precinct \(in person\)/)).toBeDefined();
    expect(line.getByText(instructions)).toBeDefined();
    expect(line.queryByRole("link", { name: "Local NYPD precinct (in person)" })).toBeNull();
  });

  it("links the portal when the rule publishes one, and names it plainly when it has no URL", async () => {
    const linked = await lineFor(
      finding({
        portalUrl: "https://fires.fdnycloud.org/CitizenAccess/Default.aspx",
        portalName: "FDNY Business",
        feeDisplay: "$105 filing fee",
      }),
    );
    expect(linked.getByText(/apply at/)).toBeDefined();
    expect(linked.getByRole("link", { name: "FDNY Business" }).getAttribute("href")).toBe(
      "https://fires.fdnycloud.org/CitizenAccess/Default.aspx",
    );
    expect(linked.getByRole("link", { name: "FDNY Business" }).getAttribute("target")).toBe(
      "_blank",
    );
    expect(linked.getByText("$105 filing fee")).toBeDefined();
    cleanup();

    const unlinked = await lineFor(finding({ portalUrl: null, portalName: "Borough office" }));
    expect(unlinked.getByText(/apply at Borough office/)).toBeDefined();
    expect(unlinked.queryByRole("link", { name: "Borough office" })).toBeNull();
  });

  it("renders distinct application paths for Scenario A SAPO and Scenario C Parks (F-204 AC 5)", async () => {
    const sapo = publishedRule("SAPO-STREET-LARGE-001");
    const parks = publishedRule("PARKS-EVENT-001");
    const sound = publishedRule("NYPD-SOUND-001");
    const sapoPortal = sapo.output.portal as { name: string; url: string };
    const parksPortal = parks.output.portal as { name: string; url: string };
    const soundPortal = sound.output.portal as {
      name: string;
      url: null;
      instructions: string;
    };

    const sapoLine = await lineFor(
      finding({
        ruleIds: [sapo.id],
        portalName: sapoPortal.name,
        portalUrl: sapoPortal.url,
        portalInstructions: null,
      }),
    );
    expect(sapoLine.getByRole("link", { name: "E-Apply" }).getAttribute("href")).toBe(
      "https://nyceventpermits.nyc.gov/cems/Login",
    );
    cleanup();

    const parksLine = await lineFor(
      finding({
        ruleIds: [parks.id],
        portalName: parksPortal.name,
        portalUrl: parksPortal.url,
        portalInstructions: null,
      }),
    );
    expect(
      parksLine.getByRole("link", { name: "NYC Parks event permits" }).getAttribute("href"),
    ).toBe("https://nyceventpermits.nyc.gov/parks");
    cleanup();

    const soundLine = await lineFor(
      finding({
        ruleIds: [sound.id],
        portalName: soundPortal.name,
        portalUrl: null,
        portalInstructions: soundPortal.instructions,
      }),
    );
    expect(soundLine.queryByRole("link", { name: soundPortal.name })).toBeNull();
    expect(soundLine.getByText(/apply at Local NYPD precinct \(in person\)/)).toBeDefined();
    expect(soundLine.getByText(soundPortal.instructions)).toBeDefined();
  });

  it("omits the portal block when the finding carries no portal fields", async () => {
    const line = await lineFor(
      finding({ portalName: null, portalUrl: null, portalInstructions: null }),
    );
    expect(line.queryByText(/apply at/)).toBeNull();
  });

  it("renders every published note on the line", async () => {
    const noteText =
      "Insurance determined by borough office at review — not automatically required.";
    const line = await lineFor(
      finding({
        kind: "note",
        disposition: "no_new_requirement",
        noteText,
        notes: [
          "Community board recommendation required",
          "Sequencing caveat: Parks decides first",
        ],
      }),
    );

    expect(line.getByText(noteText)).toBeDefined();
    expect(line.getByText("Community board recommendation required")).toBeDefined();
    expect(line.getByText("Sequencing caveat: Parks decides first")).toBeDefined();
  });

  it("falls back to the rule ids when a finding publishes no name", async () => {
    const line = await lineFor(finding({ name: null, ruleIds: ["SAPO-SCOPE-001"] }));
    expect(line.getByRole("heading").textContent).toBe("SAPO-SCOPE-001");
  });

  it("keeps the published deadline qualification rather than showing only a date", async () => {
    const line = await lineFor(
      finding({
        deadlineDisplay: "at least 21 days before the event; processing 21–30 days",
        latestApplyDate: "2026-08-26",
        deadlineStatus: "on_track",
        timelineUnresolvedReason: "no published holiday list; business-day math not computed",
        deadlineUnknownFields: ["plaza_level"],
      }),
    );

    expect(line.getByText(/at least 21 days before the event/)).toBeDefined();
    expect(line.getByText(/apply by 2026-08-26/)).toBeDefined();
    expect(line.getByText(/on track/)).toBeDefined();
    expect(line.getByText(/no published holiday list/)).toBeDefined();
    expect(line.getByText(/plaza level/)).toBeDefined();
  });
});

describe("the routes of a merged dedupe line", () => {
  const route = (overrides: Partial<FindingRoute> = {}): FindingRoute => ({
    ruleId: "DOB-TENT-001",
    triggerResult: "true",
    disposition: "required",
    unknownFields: [],
    name: "Tent permit",
    agency: "DOB",
    deadline: null,
    deadlineDisplay: null,
    latestApplyDate: null,
    applyAfterDate: null,
    deadlineStatus: "not_applicable",
    slackDays: null,
    feeDisplay: null,
    portalName: null,
    portalUrl: null,
    portalInstructions: null,
    ...overrides,
  });

  const lineWith = async (overrides: Partial<Finding>) => {
    stubApi(plan({ findings: [finding(overrides)] }));
    renderPlan();
    return within(await screen.findByRole("article"));
  };

  it("labels a candidate line's disclosure after no single route", async () => {
    const ruleIds = ["DOB-TENT-001", "DOB-TALL-STRUCTURE-001"];
    for (const userSummary of [
      {
        heading: "Tall structure permit",
        points: [{ kind: "overview" as const, text: "what this means", sources: [] }],
      },
      null,
    ]) {
      cleanup();
      await lineWith({
        ruleIds,
        name: "Tall structure permit",
        headlineMode: "candidate",
        ...(userSummary === null ? {} : { userSummary }),
        routes: [
          route({ ruleId: "DOB-TALL-STRUCTURE-001", name: "Tall structure permit" }),
          route({ ruleId: "DOB-TENT-001", triggerResult: "unknown", unknownFields: ["tent_area"] }),
        ],
      });

      const disclosure = screen.getByRole("button", { name: /details|Legal details/i });
      const announced = disclosure.getAttribute("aria-label") ?? disclosure.textContent ?? "";
      expect(announced).not.toContain("Tall structure permit");
      for (const ruleId of ruleIds) expect(announced).toContain(ruleId);
    }
  });

  it("renders nothing extra when the routes publish the same thing", async () => {
    const line = await lineWith({
      ruleIds: ["DOB-STAGE-001", "DOB-STRUCTURE-DURATION-001"],
      headlineMode: "applies_together",
      routes: [route({ ruleId: "DOB-STAGE-001" }), route({ ruleId: "DOB-STRUCTURE-DURATION-001" })],
    });
    expect(line.queryByText(/Both of these have their conditions met/)).toBeNull();
    expect(line.queryByText(/do not say which of these applies/)).toBeNull();
  });

  it("renders a candidate line that publishes no scalars of its own", async () => {
    const line = await lineWith({
      ruleIds: ["DOT-SIDEWALK-CAFE-001", "DOT-SIDEWALK-ADVISORY-001"],
      name: null,
      agency: null,
      deadline: null,
      deadlineDisplay: null,
      latestApplyDate: null,
      applyAfterDate: null,
      deadlineStatus: "not_calculable",
      feeDisplay: null,
      portalName: null,
      portalUrl: null,
      portalInstructions: null,
      headlineMode: "candidate",
      routes: [
        route({
          ruleId: "DOT-SIDEWALK-CAFE-001",
          name: "Sidewalk cafe licence",
          agency: "DCWP",
          disposition: "may_be_required",
          triggerResult: "unknown",
          unknownFields: ["sidewalk_use"],
          latestApplyDate: "2026-10-15",
          deadlineStatus: "on_track",
          feeDisplay: "$1,050 licence fee",
          portalName: "DCWP licence centre",
          portalUrl: "https://example.test/dcwp",
        }),
        route({
          ruleId: "DOT-SIDEWALK-ADVISORY-001",
          name: "Sidewalk clearance advisory",
          agency: "DOT",
          disposition: "advisory",
          latestApplyDate: "2026-08-26",
          deadlineStatus: "on_track",
          feeDisplay: "No fee",
          portalName: "DOT sidewalk desk",
          portalUrl: "https://example.test/dot",
        }),
      ],
    });

    expect(line.getByText(/do not say which of these applies/)).toBeDefined();
    const own = screen.getByRole("article");
    expect(own.querySelector(".line__deadline-date")).toBeNull();
    expect(own.querySelector(".line__fee")).toBeNull();
    expect(own.querySelector(".line__portal")).toBeNull();
    expect(own.querySelectorAll(".line__route")).toHaveLength(2);
    expect(line.getByText("No fee")).toBeDefined();
    expect(line.getByText("$1,050 licence fee")).toBeDefined();
    expect(own.querySelector('a[href="https://example.test/dot"]')).not.toBeNull();
    expect(own.querySelector('a[href="https://example.test/dcwp"]')).not.toBeNull();
    expect(line.getByText(/not calculable/)).toBeDefined();
  });

  it("renders a route's own gate, and does not collapse a group that differs only by it", async () => {
    const gated = route({
      ruleId: "NYPD-SOUND-001",
      name: "Sound Device Permit",
      applyAfterDate: "2026-08-12",
    });
    const line = await lineWith({
      ruleIds: ["DOB-TENT-001", "NYPD-SOUND-001"],
      headlineMode: "applies_together",
      routes: [route({ name: "Sound Device Permit" }), gated],
    });

    expect(line.getByText(/Earliest realistic filing:/)).toBeDefined();
    expect(line.getByText(/2026-08-12/)).toBeDefined();
    expect(screen.getByRole("article").querySelectorAll(".line__route")).toHaveLength(2);
  });

  it("collapses a group whose routes differ only in a value the entry does not render", async () => {
    await lineWith({
      ruleIds: ["DOB-STAGE-001", "DOB-STRUCTURE-DURATION-001"],
      headlineMode: "applies_together",
      routes: [
        route({ ruleId: "DOB-STAGE-001", notes: ["the stage rule's own qualification"] }),
        route({ ruleId: "DOB-STRUCTURE-DURATION-001", notes: ["the duration rule's own note"] }),
      ],
    });
    expect(screen.getByRole("article").querySelectorAll(".line__route")).toHaveLength(0);
    expect(screen.queryByText(/Both of these have their conditions met/)).toBeNull();
  });

  it("keeps a group whose routes differ only in a value the entry renders", async () => {
    const cases: {
      field: string;
      overrides: Partial<FindingRoute>;
      headline?: Partial<Finding>;
      shown: string;
    }[] = [
      {
        field: "conflictText",
        overrides: { conflictText: "two published readings of the same threshold" },
        shown: "two published readings of the same threshold",
      },
      {
        field: "deadline type",
        overrides: { deadline: { type: "before_issuance" } as FindingRoute["deadline"] },
        headline: { deadline: { type: "before_issuance" } as Finding["deadline"] },
        shown: "before issuance",
      },
    ];
    for (const { overrides, headline, shown } of cases) {
      cleanup();
      const line = await lineWith({
        ruleIds: ["DOB-TALL-STRUCTURE-001", "DOB-TENT-001"],
        headlineMode: "applies_together",
        ...(headline ?? {}),
        routes: [
          route({ ruleId: "DOB-TALL-STRUCTURE-001", ...overrides }),
          route({ ruleId: "DOB-TENT-001" }),
        ],
      });

      expect(screen.getByRole("article").querySelectorAll(".line__route")).toHaveLength(2);
      expect(line.getAllByText(shown).length).toBeGreaterThan(0);
    }
  });

  it("renders a route's typed-only deadline and does not collapse the group over it", async () => {
    const line = await lineWith({
      ruleIds: ["DOB-TALL-STRUCTURE-001", "DOB-TENT-001"],
      headlineMode: "applies_together",
      deadline: { type: "before_issuance" } as Finding["deadline"],
      routes: [
        route({
          ruleId: "DOB-TALL-STRUCTURE-001",
          deadline: { type: "before_issuance" } as FindingRoute["deadline"],
        }),
        route({ ruleId: "DOB-TENT-001" }),
      ],
    });
    expect(screen.getByRole("article").querySelectorAll(".line__route")).toHaveLength(2);
    expect(line.getAllByText("before issuance").length).toBe(2);
  });

  it("still asks the question when two routes differ only by trigger result", async () => {
    const line = await lineWith({
      ruleIds: ["DOB-STAGE-001", "DOB-STRUCTURE-DURATION-001"],
      headlineMode: "candidate",
      routes: [
        route({ ruleId: "DOB-STAGE-001", triggerResult: "true" }),
        route({
          ruleId: "DOB-STRUCTURE-DURATION-001",
          triggerResult: "unknown",
          unknownFields: ["structure_duration_days"],
        }),
      ],
    });
    expect(line.getByText(/do not say which of these applies/)).toBeDefined();
    expect(line.getAllByText(/structure duration days/).length).toBeGreaterThan(0);
    expect(line.getByText("May apply")).toBeDefined();
  });

  it("still asks the question when every unresolved route publishes the same thing", async () => {
    const line = await lineWith({
      ruleIds: ["DOB-STAGE-001", "DOB-STRUCTURE-DURATION-001"],
      headlineMode: "candidate",
      routes: [
        route({
          ruleId: "DOB-STAGE-001",
          triggerResult: "unknown",
          unknownFields: ["structure_duration_days"],
        }),
        route({
          ruleId: "DOB-STRUCTURE-DURATION-001",
          triggerResult: "unknown",
          unknownFields: ["structure_duration_days"],
        }),
      ],
    });
    expect(line.getByText(/do not say which of these applies/)).toBeDefined();
    expect(line.getByText(/structure duration days/)).toBeDefined();
    expect(line.getByText(/treat none of the routes below as settled/)).toBeDefined();
  });

  it("heads a candidate line with the question and puts it before the merged summary", async () => {
    stubApi(
      plan({
        findings: [
          finding({
            ruleIds: ["DOB-STAGE-001", "DOB-STRUCTURE-DURATION-001"],
            userSummary: {
              heading: "Do you need a temporary structure permit?",
              points: [
                { kind: "overview", text: "A stage over 10ft needs a permit.", sources: [] },
              ],
            },
            headlineMode: "candidate",
            routes: [
              route({
                ruleId: "DOB-STAGE-001",
                name: "Stage permit",
                triggerResult: "unknown",
                unknownFields: ["structure_duration_days"],
              }),
              route({
                ruleId: "DOB-STRUCTURE-DURATION-001",
                name: "Structure duration permit",
                triggerResult: "unknown",
                unknownFields: ["structure_duration_days"],
              }),
            ],
          }),
        ],
      }),
    );
    renderPlan();
    const line = within(await screen.findByRole("article"));

    expect(line.getByRole("heading").textContent).toBe(
      "The answers so far do not say which of these applies.",
    );
    expect(line.getAllByText(/do not say which of these applies/)).toHaveLength(1);

    const article = await screen.findByRole("article");
    const routesBlock = article.querySelector(".line__routes");
    const summary = article.querySelector(".line__summary");
    expect(routesBlock).not.toBeNull();
    expect(summary).not.toBeNull();
    expect(
      (routesBlock as Element).compareDocumentPosition(summary as Element) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeGreaterThan(0);
    expect(line.getByText("Stage permit")).toBeDefined();
  });

  it("keeps the permit heading when the routes apply together", async () => {
    const line = await lineWith({
      ruleIds: ["NYPD-SOUND-PROHIBITED-001", "NYPD-SOUND-PUBLIC-001"],
      name: "Commercial advertising by sound device",
      disposition: "prohibited_or_ineligible",
      headlineMode: "applies_together",
      routes: [
        route({
          ruleId: "NYPD-SOUND-PROHIBITED-001",
          name: "Commercial advertising by sound device",
          disposition: "prohibited_or_ineligible",
        }),
        route({ ruleId: "NYPD-SOUND-PUBLIC-001", name: "Sound Device Permit" }),
      ],
    });
    expect(line.getByRole("heading").textContent).toBe("Commercial advertising by sound device");
  });

  it("says both apply, and names each route's own window and fee, when every trigger resolved", async () => {
    const line = await lineWith({
      ruleIds: ["NYPD-SOUND-PROHIBITED-001", "NYPD-SOUND-PUBLIC-001"],
      name: "Commercial advertising by sound device",
      disposition: "prohibited_or_ineligible",
      headlineMode: "applies_together",
      routes: [
        route({
          ruleId: "NYPD-SOUND-PROHIBITED-001",
          name: "Commercial advertising by sound device",
          disposition: "prohibited_or_ineligible",
        }),
        route({
          ruleId: "NYPD-SOUND-PUBLIC-001",
          name: "Sound Device Permit",
          latestApplyDate: "2026-11-29",
          deadlineStatus: "on_track",
          feeDisplay: "$45 per sound device for the first day",
        }),
      ],
    });
    expect(line.getByText(/Both of these have their conditions met/)).toBeDefined();
    expect(line.getByText(/each of their conditions is met/)).toBeDefined();
    expect(line.getAllByText("Sound Device Permit").length).toBeGreaterThan(0);
    expect(line.getAllByText("Commercial advertising by sound device").length).toBeGreaterThan(0);
    expect(line.getAllByText(/apply by 2026-11-29/).length).toBeGreaterThan(0);
    expect(line.getAllByText(/\$45 per sound device/).length).toBeGreaterThan(0);
  });

  it("reads as a question, not a list of requirements, when a trigger did not resolve", async () => {
    const line = await lineWith({
      ruleIds: ["NYPD-SOUND-PUBLIC-001", "NYPD-SOUND-PROHIBITED-001"],
      headlineMode: "candidate",
      routes: [
        route({ ruleId: "NYPD-SOUND-PUBLIC-001", name: "Sound Device Permit" }),
        route({
          ruleId: "NYPD-SOUND-PROHIBITED-001",
          name: "Commercial advertising by sound device",
          disposition: "prohibited_or_ineligible",
          triggerResult: "unknown",
          unknownFields: ["sound_purpose"],
        }),
      ],
    });
    expect(line.getByText(/The answers so far do not say which of these applies/)).toBeDefined();
    expect(
      line.getByText(/one of them has its conditions met on the answers so far/),
    ).toBeDefined();
    expect(line.getByText(/Answering sound purpose would decide it/)).toBeDefined();
    expect(line.getByText(/treat the routes marked .May apply. as unsettled/)).toBeDefined();
    expect(line.getByText("Conditions met")).toBeDefined();
    expect(line.getByText("May apply")).toBeDefined();
    expect(
      line.getByText(
        "Whether Commercial advertising by sound device also applies turns on sound purpose.",
      ),
    ).toBeDefined();
    expect(line.queryByText(/would also be required/)).toBeNull();
  });

  it("names a candidate route's portal instead of telling an organizer to apply at it", async () => {
    const line = await lineWith({
      ruleIds: ["DOB-STAGE-001", "DOB-TENT-001"],
      headlineMode: "candidate",
      routes: [
        route({ ruleId: "DOB-STAGE-001", name: "Stage permit" }),
        route({
          ruleId: "DOB-TENT-001",
          triggerResult: "unknown",
          unknownFields: ["tent_area_sqft"],
          portalName: "DOB NOW: Build",
          portalUrl: "https://example.test/dob-now",
          portalInstructions: "Select the temporary structure application.",
        }),
      ],
    });

    expect(line.queryByText(/apply at/)).toBeNull();
    expect(line.getByText(/portal:/)).toBeDefined();
    expect(line.getByRole("link", { name: "DOB NOW: Build" })).toBeDefined();
    expect(line.queryByText("Select the temporary structure application.")).toBeNull();
  });

  it("names the binding route's portal in the disclosure rather than telling an organizer to apply at it", async () => {
    const line = await lineWith({
      ruleIds: ["DOB-STAGE-001", "DOB-TENT-001"],
      headlineMode: "candidate",
      portalName: "DOB NOW: Build",
      portalUrl: "https://example.test/dob-now",
      portalInstructions: "Select the temporary structure application.",
      routes: [
        route({
          ruleId: "DOB-STAGE-001",
          name: "Stage permit",
          portalName: "DOB NOW: Build",
          portalUrl: "https://example.test/dob-now",
          portalInstructions: "Select the temporary structure application.",
        }),
        route({
          ruleId: "DOB-TENT-001",
          triggerResult: "unknown",
          unknownFields: ["tent_area_sqft"],
        }),
      ],
    });

    await userEvent.click(line.getByRole("button", { name: /^Details for/ }));

    expect(line.queryByText(/apply at/)).toBeNull();
    expect(line.getAllByText(/portal:/)).toHaveLength(2);
    expect(line.getAllByRole("link", { name: "DOB NOW: Build" })).toHaveLength(2);
  });

  it("still says apply at the finding's portal once the group applies together", async () => {
    const line = await lineWith({
      ruleIds: ["DOB-STAGE-001", "DOB-TENT-001"],
      headlineMode: "applies_together",
      portalName: "DOB NOW: Build",
      portalUrl: "https://example.test/dob-now",
      routes: [
        route({
          ruleId: "DOB-STAGE-001",
          name: "Stage permit",
          portalName: "DOB NOW: Build",
          portalUrl: "https://example.test/dob-now",
        }),
        route({
          ruleId: "DOB-TENT-001",
          portalName: "DOB NOW: Build",
          portalUrl: "https://example.test/dob-now",
        }),
      ],
    });
    await userEvent.click(line.getByRole("button", { name: /^Details for/ }));
    expect(line.getAllByText(/apply at/).length).toBeGreaterThan(0);
  });

  it("names the deadline unknowns alongside the trigger unknowns in the question", async () => {
    const line = await lineWith({
      ruleIds: ["DOB-STAGE-001", "DOB-TENT-001"],
      headlineMode: "candidate",
      deadlineUnknownFields: ["load_in_date"],
      routes: [
        route({ ruleId: "DOB-STAGE-001", name: "Stage permit" }),
        route({
          ruleId: "DOB-TENT-001",
          triggerResult: "unknown",
          unknownFields: ["tent_area_sqft"],
        }),
      ],
    });
    expect(line.getByText(/Answering tent area sqft, load in date would decide it/)).toBeDefined();
  });

  it("renders a line with no route list exactly as it did before the field existed", async () => {
    const line = await lineWith({});
    expect(line.queryByText(/of these applies/)).toBeNull();
    expect(line.getByText("Special Event Permit")).toBeDefined();
  });
});

describe("the plan route", () => {
  it("renders the plan for the event in the path", async () => {
    stubApi(plan());
    vi.stubEnv("NEXT_PUBLIC_API_BASE_URL", "https://api.example.com");
    vi.stubEnv("RULES_FILE", publishedRulesFileIn("rules"));
    render(await PlanPage({ params: Promise.resolve({ id: "event-1" }) }));

    await waitFor(() =>
      expect(screen.getByRole("complementary", { name: "Rules snapshot" })).toBeDefined(),
    );
    const [url] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string];
    expect(url).toBe("https://api.example.com/api/events/event-1/plan");
  });
});

describe("the plan view's own states", () => {
  it("says it is loading before the plan arrives", () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise(() => {})),
    );
    renderPlan();
    expect(screen.getByRole("status").textContent).toBe("Loading your permit plan…");
  });

  it("drops a plan that arrives after the view has gone", async () => {
    let releasePlan: (response: Response) => void = () => {};
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (url: string) =>
          new Promise<Response>((resolvePromise) => {
            if (url.endsWith("/rules/meta")) resolvePromise(jsonResponse(200, liveMeta));
            else releasePlan = resolvePromise;
          }),
      ),
    );
    renderPlan();
    cleanup();

    releasePlan(jsonResponse(200, plan()));
    await waitFor(() => expect(screen.queryByRole("status")).toBeNull());
  });

  it("reports why a plan could not be shown, with no banner claiming a snapshot", async () => {
    stubApi({}, liveMeta, 404);
    renderPlan();

    expect((await screen.findByRole("alert")).textContent).toBe(
      "No plan has been generated for this event yet.",
    );
    expect(screen.queryByRole("complementary")).toBeNull();
  });

  it("renders one line per finding, each with its own citation", async () => {
    stubApi(
      plan({
        findings: [
          finding({ ruleIds: ["PARKS-EVENT-001"], name: "Special Event Permit" }),
          finding({
            ruleIds: ["NYPD-SOUND-001"],
            name: "Sound Device Permit",
            sources: [
              { ruleId: "NYPD-SOUND-001", citation: "Admin Code §10-108", urls: ["https://a.gov"] },
            ],
          }),
        ],
      }),
    );
    renderPlan();

    await waitFor(() => expect(screen.getAllByRole("article")).toHaveLength(2));
    expect(screen.getByText("Parks FAQ")).toBeDefined();
    expect(screen.getByText("Admin Code §10-108")).toBeDefined();
  });
});

describe("dated lines that publish no deadline prose", () => {
  const lineFor = async (only: Finding) => {
    stubApi(plan({ findings: [only] }));
    renderPlan();
    const line = within(await screen.findByRole("article"));
    const toggle = line.queryByRole("button", { name: /^Details for/ });
    if (toggle !== null) await userEvent.click(toggle);
    return line;
  };

  it("shows the demo anchor's apply-by date and missed status with no display text", async () => {
    const large = publishedRule("SAPO-STREET-LARGE-001");
    expect(large.output.deadline).toBeDefined();
    expect((large.output.deadline as unknown as { display?: string }).display).toBeUndefined();

    const line = await lineFor(
      finding({
        ruleIds: ["SAPO-STREET-LARGE-001"],
        name: String(large.output.permit_name),
        deadlineDisplay: null,
        latestApplyDate: "2026-07-12",
        deadlineStatus: "published_deadline_missed",
      }),
    );

    expect(line.getByText(/apply by 2026-07-12/)).toBeDefined();
    expect(line.getByText(/published deadline missed/)).toBeDefined();
  });

  it("dates when a gated line can realistically be pursued, without barring an earlier filing", async () => {
    const dependency = publishedRule("NYPD-SOUND-PARKS-DEP-001");
    expect(dependency.verification.qualification).toBe("sequencing detail RESEARCH_REQUIRED");

    const line = await lineFor(
      finding({
        ruleIds: ["NYPD-SOUND-PARKS-DEP-001"],
        deadlineDisplay: null,
        latestApplyDate: "2026-09-11",
        applyAfterDate: "2026-08-26",
        deadlineStatus: "on_track",
        noteText: dependency.output.note_text ?? null,
      }),
    );

    expect(line.getByText(/apply by 2026-09-11/)).toBeDefined();
    expect(line.getByText(/earliest realistic filing 2026-08-26/)).toBeDefined();

    const rendered = line.getByRole("heading").closest("article")?.textContent ?? "";
    expect(rendered).not.toMatch(/not before/i);
    expect(rendered).not.toMatch(/cannot be filed/i);
    expect(rendered).not.toMatch(/must not/i);

    expect(line.getByText(String(dependency.output.note_text))).toBeDefined();
    expect(String(dependency.output.note_text)).toContain("not confirmed by located primary text");
  });

  it("still renders the published prose when a rule does carry it", async () => {
    const line = await lineFor(
      finding({
        deadlineDisplay: "file at least 5 days before use",
        latestApplyDate: "2026-09-11",
        deadlineStatus: "on_track",
      }),
    );

    expect(line.getByText(/file at least 5 days before use/)).toBeDefined();
    expect(line.getByText(/apply by 2026-09-11/)).toBeDefined();
  });

  it("says nothing about timing on a line that has no deadline at all", async () => {
    const line = await lineFor(
      finding({ deadlineDisplay: null, latestApplyDate: null, deadlineStatus: "not_applicable" }),
    );

    expect(line.queryByText(/apply by/)).toBeNull();
    expect(line.queryByText(/not applicable/)).toBeNull();
  });
});

describe("the verdict's approved copy", () => {
  const verdictText = async (verdict: string, detail: Record<string, unknown> = {}) => {
    stubApi(plan({ verdict, verdictDetail: { ...emptyVerdictDetail, ...detail } }));
    renderPlan();
    await screen.findByRole("complementary", { name: "Rules snapshot" });
    return document.querySelector(".plan__verdict")?.textContent ?? "";
  };

  it("states a missed filing window as the approved copy, never as impossibility", async () => {
    const text = await verdictText("INFEASIBLE");

    expect(text).toContain("Published deadline missed as scoped");
    expect(text.toLowerCase()).not.toContain("infeasible");
    expect(text.toLowerCase()).not.toContain("impossible");
  });

  it("renders each of the other three verdicts in its approved copy", async () => {
    expect(await verdictText("FEASIBLE")).toContain("On track");
    cleanup();
    expect(await verdictText("FEASIBLE_AT_RISK", { minSlackDays: 10 })).toContain(
      "At risk — apply within 10 days",
    );
    cleanup();
    expect(
      await verdictText("CONDITIONAL", {
        missingFacts: [{ field: "street_event_size", branches: [], thresholds: null }],
      }),
    ).toContain("Depends on: street event size");
  });

  it("leaves a slot empty rather than inventing a number or a fact", async () => {
    expect(await verdictText("FEASIBLE_AT_RISK")).toContain("At risk");
    expect(await verdictText("FEASIBLE_AT_RISK")).not.toMatch(/within \d/);
    cleanup();
    expect(await verdictText("CONDITIONAL")).toContain("Depends on");
  });

  it("labels the at-risk countdown as PopEngine's buffer, on screen", async () => {
    stubApi(
      plan({
        verdict: "FEASIBLE_AT_RISK",
        verdictDetail: { ...emptyVerdictDetail, minSlackDays: 10 },
      }),
    );
    renderPlan();
    await screen.findByRole("complementary", { name: "Rules snapshot" });

    const note = document.querySelector(".plan__buffer");
    expect(note?.getAttribute("role")).toBe("note");
    expect(note?.textContent).toContain("PopEngine's internal planning buffer");
    expect(note?.textContent).toContain("not an agency filing deadline");
  });

  it("does not label a verdict that carries no buffer countdown", async () => {
    stubApi(plan({ verdict: "FEASIBLE" }));
    renderPlan();
    await screen.findByRole("complementary", { name: "Rules snapshot" });

    expect(screen.queryByText(/internal planning buffer/)).toBeNull();
  });
});

describe("F-102 · undated deadlines note", () => {
  it("notes FEASIBLE when every deadline is undated", async () => {
    stubApi(
      plan({
        verdict: "FEASIBLE",
        findings: [
          finding({ deadlineStatus: "not_applicable" }),
          finding({ ruleIds: ["Y"], deadlineStatus: "not_calculable" }),
        ],
      }),
    );
    renderPlan();
    expect((await screen.findByTestId("no-dated-deadlines")).textContent).toBe(
      "No dated deadlines identified.",
    );
  });

  it("does not claim undated deadlines when a non-binding route publishes a window", async () => {
    stubApi(
      plan({
        verdict: "FEASIBLE",
        findings: [
          finding({
            ruleIds: ["SYN-UNDATED-001", "SYN-DATED-001"],
            deadlineStatus: "not_applicable",
            routes: [
              {
                ruleId: "SYN-UNDATED-001",
                triggerResult: "true",
                disposition: "required",
                unknownFields: [],
                name: "Undated route permit",
                agency: "SYN",
                deadline: null,
                deadlineDisplay: null,
                latestApplyDate: null,
                applyAfterDate: null,
                deadlineStatus: "not_applicable",
                slackDays: null,
                feeDisplay: null,
                portalName: null,
                portalUrl: null,
                portalInstructions: null,
              },
              {
                ruleId: "SYN-DATED-001",
                triggerResult: "true",
                disposition: "may_be_required",
                unknownFields: [],
                name: "Dated route permit",
                agency: "SYN",
                deadline: null,
                deadlineDisplay: null,
                latestApplyDate: "2026-11-10",
                applyAfterDate: null,
                deadlineStatus: "on_track",
                slackDays: 111,
                feeDisplay: null,
                portalName: null,
                portalUrl: null,
                portalInstructions: null,
              },
            ],
            headlineMode: "applies_together",
          }),
        ],
      }),
    );
    renderPlan();
    await screen.findByRole("complementary", { name: "Rules snapshot" });

    expect(screen.queryByTestId("no-dated-deadlines")).toBeNull();
  });

  it("does not claim undated deadlines when any dated status appears", async () => {
    stubApi(
      plan({
        verdict: "FEASIBLE",
        findings: [finding({ deadlineStatus: "on_track" })],
      }),
    );
    renderPlan();
    await screen.findByRole("complementary", { name: "Rules snapshot" });
    expect(screen.queryByTestId("no-dated-deadlines")).toBeNull();
  });

  it("refuses a plan whose route list is empty rather than reading it as no routes", async () => {
    stubApi(
      plan({
        verdict: "FEASIBLE",
        findings: [finding({ deadlineStatus: "on_track", routes: [], headlineMode: "candidate" })],
      }),
    );
    renderPlan();

    expect(await screen.findByRole("alert")).toBeDefined();
    expect(screen.queryByTestId("no-dated-deadlines")).toBeNull();
  });
});

describe("F-102 · CONDITIONAL branch table and INFEASIBLE rescope ladder", () => {
  it("renders each missing fact's branch outcomes for CONDITIONAL", async () => {
    stubApi(
      plan({
        verdict: "CONDITIONAL",
        verdictDetail: {
          ...emptyVerdictDetail,
          missingFacts: [
            {
              field: "venue_license_covers_event_area",
              thresholds: null,
              branches: [
                {
                  value: "yes",
                  verdict: "CONDITIONAL",
                  reason: "sound audibility still open",
                },
                {
                  value: "no",
                  verdict: "INFEASIBLE",
                  reason: "SLA one-day window missed",
                },
              ],
            },
          ],
        },
      }),
    );
    renderPlan();
    await screen.findByTestId("verdict-detail");

    const fact = screen.getByTestId("missing-fact");
    expect(fact.textContent).toContain("venue license covers event area");
    expect(within(fact).getByText("Depends on")).toBeDefined();
    expect(within(fact).getByText("Published deadline missed as scoped")).toBeDefined();
    expect(within(fact).getByText("sound audibility still open")).toBeDefined();
    expect(within(fact).getByText("SLA one-day window missed")).toBeDefined();
  });

  it("does not claim exhaustive branching when a numeric fact has only thresholds", async () => {
    stubApi(
      plan({
        verdict: "CONDITIONAL",
        verdictDetail: {
          ...emptyVerdictDetail,
          missingFacts: [
            {
              field: "tent_area_sqft",
              branches: [],
              thresholds:
                "DOB-TENT-001 applies above 400; exactly 400 is a conditional boundary (confirm with the publishing agency)",
            },
          ],
        },
      }),
    );
    renderPlan();
    await screen.findByTestId("verdict-detail");

    expect(screen.getByTestId("verdict-detail").textContent).toContain(
      "cannot be exhaustively branched",
    );
    expect(screen.getByTestId("verdict-detail").textContent).not.toContain(
      "evaluated on every published answer",
    );
    expect(screen.getByTestId("verdict-detail").textContent).toContain(
      publishedHeading("DOB-TENT-001"),
    );
    expect(screen.getByTestId("verdict-detail").textContent).not.toContain("DOB-TENT-001");
  });

  it("names a branch rule by its own heading, not by the merged finding's", async () => {
    stubApi(
      plan({
        verdict: "CONDITIONAL",
        findings: [
          finding({
            ruleIds: ["DOB-TENT-001", "DOB-TALL-STRUCTURE-001"],
            name: "Temporary structure filing",
            userSummary: { heading: publishedHeading("DOB-TENT-001"), points: [] },
          }),
        ],
        verdictDetail: {
          ...emptyVerdictDetail,
          missingFacts: [
            {
              field: "structure_over_10ft_tall",
              thresholds: null,
              branches: [
                {
                  value: "false",
                  verdict: "CONDITIONAL",
                  reason: "drops DOB-TALL-STRUCTURE-001",
                },
              ],
            },
          ],
        },
      }),
    );
    renderPlan();
    const fact = await screen.findByTestId("missing-fact");

    expect(fact.textContent).toContain(publishedHeading("DOB-TALL-STRUCTURE-001"));
    expect(fact.textContent).not.toContain(publishedHeading("DOB-TENT-001"));
    expect(fact.textContent).not.toContain("DOB-TALL-STRUCTURE-001");
  });

  it("shows the residue F-102 names: a historical merged rule id no source can label", async () => {
    stubApi(
      plan({
        rulesetVersion: "nyc.v2.10",
        verdict: "CONDITIONAL",
        findings: [
          finding({
            ruleIds: ["DOB-TENT-001", "DOB-TALL-STRUCTURE-001"],
            name: "Temporary structure filing",
            userSummary: { heading: publishedHeading("DOB-TENT-001"), points: [] },
          }),
        ],
        verdictDetail: {
          ...emptyVerdictDetail,
          missingFacts: [
            {
              field: "structure_over_10ft_tall",
              thresholds: null,
              branches: [
                {
                  value: "false",
                  verdict: "CONDITIONAL",
                  reason: "drops DOB-TALL-STRUCTURE-001",
                },
              ],
            },
          ],
        },
      }),
    );
    renderPlan();
    const fact = await screen.findByTestId("missing-fact");

    expect(fact.textContent).toContain("drops DOB-TALL-STRUCTURE-001");
    expect(fact.textContent).not.toContain(publishedHeading("DOB-TENT-001"));
  });

  it("names the blocking finding and lists each re-evaluated rescope for INFEASIBLE", async () => {
    const introducedRuleIds = [
      "ADV-VENUE-OCCUPANCY-001",
      "DOB-ASSEMBLY-001",
      "SLA-CATERING-001",
      "SLA-ONEDAY-001",
      "SLA-VENUE-LICENSE-001",
    ];
    stubApi(
      plan({
        verdict: "INFEASIBLE",
        findings: [
          finding({
            ruleIds: ["SAPO-STREET-LARGE-001"],
            name: "Street Activity Permit — Large",
            agency: "SAPO (CECM)",
            deadlineDisplay: "submit by December 31 of the prior year",
            deadlineStatus: "published_deadline_missed",
            latestApplyDate: "2025-12-31",
          }),
          finding({
            ruleIds: ["SAPO-INSURANCE-001"],
            name: "Street event insurance",
          }),
        ],
        verdictDetail: {
          ...emptyVerdictDetail,
          blockingFinding: {
            ruleIds: ["SAPO-STREET-LARGE-001"],
            name: "Street Activity Permit — Large",
            agency: "SAPO (CECM)",
            disposition: "required",
            deadlineDisplay: "submit by December 31 of the prior year",
            latestApplyDate: "2025-12-31",
            deadlineStatus: "published_deadline_missed",
            feeDisplay: null,
            portalName: null,
            portalUrl: null,
            portalInstructions: null,
            sources: [],
            userSummary: null,
          },
          missedRuleIds: ["SAPO-STREET-LARGE-001"],
          trace: [{ ruleId: "SAPO-STREET-LARGE-001", result: "true" }],
          rescopeSuggestions: [
            {
              change: { field: "location_type", value: "private_venue" },
              reevaluatedVerdict: "CONDITIONAL",
              droppedRuleIds: ["SAPO-INSURANCE-001", "SAPO-STREET-LARGE-001"],
              introducedRuleIds,
              remainingMissingFields: ["sound_audible_from_public_way"],
              remainingTimelineReasons: [],
              minSlackDays: null,
              atRiskFindingName: null,
            },
            {
              change: { field: "street_event_size", value: "medium" },
              reevaluatedVerdict: "FEASIBLE_AT_RISK",
              droppedRuleIds: ["SAPO-STREET-LARGE-001"],
              introducedRuleIds: ["SAPO-STREET-MEDIUM-001"],
              introducedFindings: [introducedFinding("SAPO-STREET-MEDIUM-001")],
              minSlackDays: 5,
              atRiskFindingName: "Street Activity Permit — Medium",
            },
            {
              change: { field: "street_event_size", value: "small" },
              reevaluatedVerdict: "FEASIBLE_AT_RISK",
              droppedRuleIds: ["SAPO-STREET-LARGE-001"],
              introducedRuleIds: ["SAPO-STREET-SMALL-001"],
              introducedFindings: [introducedFinding("SAPO-STREET-SMALL-001")],
              minSlackDays: null,
              atRiskFindingName: "Organizer notification to DOHMH",
            },
          ],
        },
      }),
    );
    renderPlan();
    await screen.findByTestId("verdict-detail");

    expect(screen.getByTestId("blocking-finding").textContent).toContain(
      "Street Activity Permit — Large",
    );
    expect(screen.getByTestId("blocking-finding").textContent).toContain(
      "published deadline was missed as scoped",
    );
    expect(screen.getByTestId("blocking-finding").textContent).toContain(
      "Published timing: submit by December 31 of the prior year",
    );
    expect(screen.getByTestId("blocking-finding").textContent).toContain(
      "latest published apply-by date was 2025-12-31",
    );
    expect(screen.getByTestId("rescope-ladder")).toBeDefined();
    const suggestions = screen.getAllByTestId("rescope-suggestion");
    expect(suggestions).toHaveLength(3);
    expect(suggestions[0]?.textContent).toContain("medium");
    expect(suggestions[0]?.textContent).not.toContain("SAPO-STREET-MEDIUM-001");
    expect(
      suggestions[0]?.querySelector(
        `a[href="${publishedRule("SAPO-STREET-MEDIUM-001").output.portal?.url}"]`,
      )?.textContent,
    ).toContain("Apply through E-Apply");
    expect(suggestions[0]?.textContent).toContain("At risk — apply within 5 days");
    expect(suggestions[0]?.textContent).toContain("on Street Activity Permit — Medium");
    expect(suggestions[0]?.textContent).toContain(
      "Why this helps: This removes Street Activity Permit — Large",
    );
    expect(suggestions[1]?.textContent).toContain("small");
    expect(suggestions[1]?.textContent).not.toContain("SAPO-STREET-SMALL-001");
    expect(suggestions[2]?.textContent).toContain("private venue");
    expect(suggestions[2]?.textContent).toContain(
      "Still conditional — needs answers about sound audible from public way",
    );
    expect(suggestions[2]?.textContent).not.toContain("Depends on");
    expect(suggestions[2]?.textContent).toContain(
      "Why this helps: This removes Street Activity Permit — Large",
    );
    expect(suggestions[2]?.textContent).toContain("would newly appear");
    expect(suggestions[2]?.textContent).toContain("Findings that would newly appear");
    const introduced = suggestions[2]?.querySelector(".verdict-detail__rescope-introduced");
    for (const ruleId of introducedRuleIds) {
      expect(introduced?.textContent).toContain(publishedHeading(ruleId));
      expect(introduced?.textContent).not.toContain(ruleId);
      expect(introduced?.querySelector(`a[href="${publishedSource(ruleId).url}"]`)).not.toBeNull();
    }
    expect(screen.getByTestId("rescope-at-risk-buffer").textContent).toContain(
      "PopEngine's internal planning buffer",
    );
  });

  it("renders a stored blocker that predates the widened keys from the plan's own line", async () => {
    stubApi(
      plan({
        verdict: "INFEASIBLE",
        findings: [
          finding({
            ruleIds: ["SAPO-STREET-LARGE-001"],
            name: "Street Event Permit (Large)",
            deadlineDisplay: "submit by December 31 of the prior year",
            deadlineStatus: "published_deadline_missed",
            latestApplyDate: "2026-07-12",
            portalName: publishedRule("SAPO-STREET-LARGE-001").output.portal?.name ?? null,
            portalUrl: publishedRule("SAPO-STREET-LARGE-001").output.portal?.url ?? null,
            userSummary: publishedRule("SAPO-STREET-LARGE-001").output
              .user_summary as unknown as Finding["userSummary"],
          }),
        ],
        verdictDetail: {
          ...emptyVerdictDetail,
          blockingFinding: {
            ruleIds: ["SAPO-STREET-LARGE-001"],
            name: "Street Event Permit (Large)",
          },
          missedRuleIds: ["SAPO-STREET-LARGE-001"],
        },
      }),
    );
    renderPlan();
    await screen.findByTestId("verdict-detail");

    const blocker = screen.getByTestId("blocking-finding");
    expect(blocker.textContent).toContain(publishedHeading("SAPO-STREET-LARGE-001"));
    expect(
      blocker.querySelector(`a[href="${publishedSource("SAPO-STREET-LARGE-001").url}"]`)
        ?.textContent,
    ).toContain("More information");
    expect(
      blocker.querySelector(
        `a[href="${publishedRule("SAPO-STREET-LARGE-001").output.portal?.url}"]`,
      )?.textContent,
    ).toContain("Apply through");
    expect(blocker.textContent).toContain("latest published apply-by date was 2026-07-12");
  });

  it("names a barred blocker's portal instead of telling the organizer to apply at it", async () => {
    stubApi(
      plan({
        verdict: "INFEASIBLE",
        findings: [
          finding({
            ruleIds: ["PARKS-PROPANE-001"],
            name: "Propane prohibited in this park",
            disposition: "prohibited_or_ineligible",
            deadlineStatus: "published_deadline_missed",
            latestApplyDate: "2026-07-12",
            portalName: "Parks permit office",
            portalUrl: null,
            portalInstructions: "File in person at the borough office",
            sources: [],
          }),
        ],
        verdictDetail: {
          ...emptyVerdictDetail,
          blockingFinding: {
            ruleIds: ["PARKS-PROPANE-001"],
            name: "Propane prohibited in this park",
            agency: "NYC Parks",
            disposition: "prohibited_or_ineligible",
            deadlineDisplay: null,
            latestApplyDate: "2026-07-12",
            deadlineStatus: "published_deadline_missed",
            feeDisplay: null,
            portalName: "Parks permit office",
            portalUrl: null,
            portalInstructions: "File in person at the borough office",
            sources: [],
            userSummary: null,
          },
          missedRuleIds: ["PARKS-PROPANE-001"],
          trace: [{ ruleId: "PARKS-PROPANE-001", result: "true" }],
        },
      }),
    );
    renderPlan();
    await screen.findByTestId("verdict-detail");

    const blocker = screen.getByTestId("blocking-finding");
    expect(blocker.textContent).toContain("Parks permit office");
    expect(blocker.textContent).not.toContain("apply at");
    expect(blocker.textContent).not.toContain("File in person at the borough office");
  });

  it("renders an instructions-only blocker's published filing path", async () => {
    stubApi(
      plan({
        verdict: "INFEASIBLE",
        findings: [
          finding({
            ruleIds: ["NYPD-SOUND-001"],
            name: "Sound Device Permit",
            agency: "NYPD",
            disposition: "required",
            deadlineDisplay: "File at the precinct no fewer than five days before use",
            deadlineStatus: "published_deadline_missed",
            latestApplyDate: "2026-07-12",
            feeDisplay: "$45 per sound device for the first day",
            portalName: "NYPD precinct",
            portalUrl: null,
            portalInstructions: "File in person at the precinct",
          }),
        ],
        verdictDetail: {
          ...emptyVerdictDetail,
          blockingFinding: {
            ruleIds: ["NYPD-SOUND-001"],
            name: "Sound Device Permit",
            agency: "NYPD",
            disposition: "required",
            deadlineDisplay: "File at the precinct no fewer than five days before use",
            latestApplyDate: "2026-07-12",
            deadlineStatus: "published_deadline_missed",
            feeDisplay: "$45 per sound device for the first day",
            portalName: "NYPD precinct",
            portalUrl: null,
            portalInstructions: "File in person at the precinct",
            sources: [],
            userSummary: null,
          },
          missedRuleIds: ["NYPD-SOUND-001"],
          trace: [{ ruleId: "NYPD-SOUND-001", result: "true" }],
        },
      }),
    );
    renderPlan();
    await screen.findByTestId("verdict-detail");

    const blocker = screen.getByTestId("blocking-finding");
    expect(blocker.textContent).toContain("File in person at the precinct");
    expect(blocker.textContent).toContain("NYPD precinct");
  });

  it("humanizes a code-only rescope from a matching stored rules snapshot", async () => {
    stubApi(
      plan({
        verdict: "INFEASIBLE",
        verdictDetail: {
          ...emptyVerdictDetail,
          blockingFinding: {
            ruleIds: ["PARKS-EVENT-001"],
            name: "NYC Parks special event permit",
          },
          missedRuleIds: ["PARKS-EVENT-001"],
          rescopeSuggestions: [
            {
              change: { field: "location_type", value: "street" },
              reevaluatedVerdict: "CONDITIONAL",
              droppedRuleIds: ["PARKS-EVENT-001"],
              introducedRuleIds: ["SAPO-SCOPE-001"],
            },
          ],
        },
      }),
    );
    renderPlan();
    const ladder = await screen.findByTestId("rescope-ladder");

    expect(ladder.textContent).toContain(publishedHeading("SAPO-SCOPE-001"));
    expect(ladder.textContent).not.toContain("SAPO-SCOPE-001");
    expect(ladder.textContent).toContain(
      "Still conditional — review the newly introduced findings below",
    );
    expect(ladder.textContent).not.toContain("Depends on");
    expect(ladder.textContent).toContain("Why this helps: This removes Special Event Permit");
    expect(
      ladder.querySelector(`a[href="${publishedSource("SAPO-SCOPE-001").url}"]`),
    ).not.toBeNull();
  });

  it("does not relabel a stored plan from a different ruleset version", async () => {
    stubApi(
      plan({
        rulesetVersion: "nyc.v2.10",
        verdict: "INFEASIBLE",
        verdictDetail: {
          ...emptyVerdictDetail,
          rescopeSuggestions: [
            {
              change: { field: "location_type", value: "street" },
              reevaluatedVerdict: "CONDITIONAL",
              droppedRuleIds: [],
              introducedRuleIds: ["SAPO-SCOPE-001"],
            },
          ],
        },
      }),
    );
    renderPlan();

    expect((await screen.findByTestId("rescope-ladder")).textContent).toContain("SAPO-SCOPE-001");
  });

  it("does not treat one multi-rule finding as multiple missed deadlines", async () => {
    stubApi(
      plan({
        verdict: "INFEASIBLE",
        findings: [
          finding({
            ruleIds: ["DOB-TENT-001", "DOB-TALL-STRUCTURE-001"],
            name: "Temporary structure filing",
            deadlineStatus: "published_deadline_missed",
            latestApplyDate: "2026-07-01",
          }),
        ],
        verdictDetail: {
          ...emptyVerdictDetail,
          blockingFinding: {
            ruleIds: ["DOB-TENT-001", "DOB-TALL-STRUCTURE-001"],
            name: "Temporary structure filing",
          },
          missedRuleIds: ["DOB-TENT-001", "DOB-TALL-STRUCTURE-001"],
        },
      }),
    );
    renderPlan();
    await screen.findByTestId("verdict-detail");

    expect(screen.getByTestId("blocking-finding").textContent).toContain(
      "Temporary structure filing",
    );
    expect(screen.getByTestId("blocking-finding").textContent).not.toContain(
      "All published deadlines missed as scoped",
    );
  });

  it("lists every missed route of one merged line", async () => {
    const missedRoute = (ruleId: string, name: string, latestApplyDate: string) => ({
      ruleId,
      triggerResult: "true" as const,
      disposition: "required" as const,
      unknownFields: [],
      name,
      agency: "DOB",
      deadline: null,
      deadlineDisplay: null,
      latestApplyDate,
      applyAfterDate: null,
      deadlineStatus: "published_deadline_missed" as const,
      slackDays: null,
      feeDisplay: null,
      portalName: null,
      portalUrl: null,
      portalInstructions: null,
    });
    stubApi(
      plan({
        verdict: "INFEASIBLE",
        findings: [
          finding({
            ruleIds: ["DOB-TENT-001", "DOB-TALL-STRUCTURE-001"],
            name: "Tent permit",
            deadlineStatus: "published_deadline_missed",
            latestApplyDate: "2026-07-01",
            headlineMode: "applies_together",
            routes: [
              missedRoute("DOB-TENT-001", "Tent permit", "2026-07-01"),
              missedRoute("DOB-TALL-STRUCTURE-001", "Tall structure permit", "2026-07-08"),
            ],
          }),
        ],
        verdictDetail: {
          ...emptyVerdictDetail,
          blockingFinding: { ruleIds: ["DOB-TENT-001"], name: "Tent permit" },
          missedRuleIds: ["DOB-TENT-001", "DOB-TALL-STRUCTURE-001"],
        },
      }),
    );
    renderPlan();
    await screen.findByTestId("verdict-detail");

    const blocker = screen.getByTestId("blocking-finding");
    expect(blocker.textContent).toContain("All published deadlines missed as scoped");
    expect(blocker.textContent).toContain("Tall structure permit");
  });

  it("describes a missed list that publishes no filing, and one it cannot read", async () => {
    const cases = [
      {
        findings: [
          finding({
            ruleIds: ["ADV-VENUE-OCCUPANCY-001"],
            name: "Venue occupancy advisory",
            disposition: "advisory",
            deadlineStatus: "published_deadline_missed",
            latestApplyDate: "2026-07-13",
          }),
          finding({
            ruleIds: ["PARKS-INSURANCE-NOTE-001"],
            name: "Parks insurance note",
            disposition: "no_new_requirement",
            deadlineStatus: "published_deadline_missed",
            latestApplyDate: "2026-07-13",
          }),
        ],
        missedRuleIds: ["ADV-VENUE-OCCUPANCY-001", "PARKS-INSURANCE-NOTE-001"],
        says: "publish no filing of their own",
      },
      {
        findings: [],
        missedRuleIds: ["SAPO-STREET-LARGE-001"],
        says: "does not record what each of them publishes",
      },
    ];
    for (const { findings, missedRuleIds, says } of cases) {
      cleanup();
      stubApi(
        plan({
          verdict: "CONDITIONAL",
          findings,
          verdictDetail: { ...emptyVerdictDetail, missedRuleIds },
        }),
      );
      renderPlan();
      await screen.findByTestId("verdict-detail");

      const section = screen.getByTestId("missed-may-be-required");
      expect(section.textContent).toContain(says);
      expect(section.textContent).not.toContain("differ in what they publish");
      const pointsAtTheLine = section.textContent?.includes("on the plan line") ?? false;
      expect(pointsAtTheLine).toBe(findings.length > 0);
    }
  });

  it("explains a conditional miss on may-be-required published windows", async () => {
    stubApi(
      plan({
        verdict: "CONDITIONAL",
        findings: [
          finding({
            ruleIds: ["DOHMH-ORGANIZER-NOTIFY-001"],
            name: "Organizer notification to DOHMH",
            disposition: "may_be_required",
            deadlineStatus: "published_deadline_missed",
            latestApplyDate: "2026-07-13",
          }),
        ],
        verdictDetail: {
          ...emptyVerdictDetail,
          missedRuleIds: ["DOHMH-ORGANIZER-NOTIFY-001"],
        },
      }),
    );
    renderPlan();
    await screen.findByTestId("verdict-detail");

    const section = screen.getByTestId("missed-may-be-required");
    expect(section.textContent).toContain("Published windows that are past");
    expect(section.textContent).toContain("may-be-required");
    expect(section.textContent).toContain("keeps the verdict conditional");
    expect(section.textContent).toContain("Organizer notification to DOHMH");
    expect(section.textContent).not.toContain("DOHMH-ORGANIZER-NOTIFY-001");
    expect(section.querySelector("a")?.textContent).toBe("More information");
  });

  it("lists a multi-rule may-be-required miss once, not once per rule id", async () => {
    stubApi(
      plan({
        verdict: "CONDITIONAL",
        findings: [
          finding({
            ruleIds: ["DOB-TENT-001", "DOB-TALL-STRUCTURE-001"],
            name: "Temporary structure filing",
            disposition: "may_be_required",
            deadlineStatus: "published_deadline_missed",
            latestApplyDate: "2026-07-01",
          }),
        ],
        verdictDetail: {
          ...emptyVerdictDetail,
          missedRuleIds: ["DOB-TENT-001", "DOB-TALL-STRUCTURE-001"],
        },
      }),
    );
    renderPlan();
    await screen.findByTestId("missed-may-be-required");

    const section = screen.getByTestId("missed-may-be-required");
    expect(section.querySelectorAll("li")).toHaveLength(1);
    expect(section.textContent).toContain("Temporary structure filing");
    expect(section.textContent).not.toContain("DOB-TENT-001");
    expect(section.textContent).not.toContain("DOB-TALL-STRUCTURE-001");
  });

  it("names the missed route, not the merged line it sits on", async () => {
    stubApi(
      plan({
        verdict: "CONDITIONAL",
        findings: [
          finding({
            ruleIds: ["DOB-TENT-001", "DOB-TALL-STRUCTURE-001"],
            name: "Temporary structure filing",
            disposition: "may_be_required",
            portalName: "DOB NOW",
            portalUrl: "https://example.gov/dobnow",
            headlineMode: "applies_together",
            deadline: { type: "before_issuance" } as Finding["deadline"],
            sources: [
              { ruleId: "DOB-TENT-001", citation: "Tent FAQ", urls: ["https://example.gov/tent"] },
              {
                ruleId: "DOB-TALL-STRUCTURE-001",
                citation: "Tall structure FAQ",
                urls: ["https://example.gov/tall"],
              },
            ],
            routes: [
              {
                ruleId: "DOB-TENT-001",
                triggerResult: "true",
                disposition: "may_be_required",
                unknownFields: [],
                name: "Temporary structure filing",
                agency: "DOB",
                deadline: { type: "before_issuance" } as FindingRoute["deadline"],
                deadlineDisplay: null,
                latestApplyDate: "2026-07-20",
                applyAfterDate: null,
                deadlineStatus: "on_track",
                slackDays: null,
                feeDisplay: null,
                portalName: "DOB NOW",
                portalUrl: "https://example.gov/dobnow",
                portalInstructions: null,
              },
              {
                ruleId: "DOB-TALL-STRUCTURE-001",
                triggerResult: "true",
                disposition: "may_be_required",
                unknownFields: [],
                name: "Tall structure permit",
                agency: "DOB",
                deadline: { type: "before_issuance" } as FindingRoute["deadline"],
                deadlineDisplay: null,
                latestApplyDate: "2026-07-01",
                applyAfterDate: null,
                deadlineStatus: "published_deadline_missed",
                slackDays: null,
                feeDisplay: null,
                portalName: "DOB tall structures",
                portalUrl: "https://example.gov/tall-portal",
                portalInstructions: null,
              },
            ],
          }),
        ],
        verdictDetail: {
          ...emptyVerdictDetail,
          missedRuleIds: ["DOB-TALL-STRUCTURE-001"],
        },
      }),
    );
    renderPlan();
    await screen.findByTestId("missed-may-be-required");

    const section = screen.getByTestId("missed-may-be-required");
    expect(section.textContent).toContain("Tall structure permit");
    expect(section.textContent).not.toContain("Temporary structure filing");
    expect(section.querySelector('a[href="https://example.gov/tall"]')).not.toBeNull();
    expect(section.querySelector('a[href="https://example.gov/dobnow"]')).toBeNull();
  });

  it("names an unsettled route's portal without telling the organizer to file it", async () => {
    const route = (overrides: Partial<FindingRoute> = {}): FindingRoute => ({
      ruleId: "DOB-TENT-001",
      triggerResult: "unknown",
      disposition: "may_be_required",
      unknownFields: ["tent_area_sqft"],
      name: "Tent permit",
      agency: "DOB",
      deadline: null,
      deadlineDisplay: null,
      latestApplyDate: "2026-07-01",
      applyAfterDate: null,
      deadlineStatus: "published_deadline_missed",
      slackDays: null,
      feeDisplay: null,
      portalName: "DOB NOW",
      portalUrl: "https://example.gov/dobnow",
      portalInstructions: null,
      ...overrides,
    });
    stubApi(
      plan({
        verdict: "CONDITIONAL",
        findings: [
          finding({
            ruleIds: ["DOB-TENT-001", "DOB-TALL-STRUCTURE-001"],
            name: "Tall structure permit",
            deadlineStatus: "published_deadline_missed",
            latestApplyDate: "2026-07-01",
            portalName: "DOB tall structures",
            portalUrl: "https://example.gov/tall-portal",
            headlineMode: "candidate",
            routes: [
              route({
                ruleId: "DOB-TALL-STRUCTURE-001",
                name: "Tall structure permit",
                triggerResult: "true",
                unknownFields: [],
                portalName: "DOB tall structures",
                portalUrl: "https://example.gov/tall-portal",
              }),
              route({}),
            ],
          }),
        ],
        verdictDetail: {
          ...emptyVerdictDetail,
          missedRuleIds: ["DOB-TENT-001", "DOB-TALL-STRUCTURE-001"],
        },
      }),
    );
    renderPlan();
    await screen.findByTestId("missed-may-be-required");

    const section = screen.getByTestId("missed-may-be-required");
    const unsettled = section.querySelector('a[href="https://example.gov/dobnow"]');
    expect(unsettled?.textContent).toBe("DOB NOW");
    expect(section.textContent).toContain("portal: DOB NOW");
    expect(
      section.querySelector('a[href="https://example.gov/tall-portal"]')?.textContent,
    ).not.toContain("Apply through");
    expect(section.textContent).toContain("portal: DOB tall structures");
  });

  it("keeps the apply link on a settled route that publishes a filing", async () => {
    const route = (overrides: Partial<FindingRoute> = {}): FindingRoute => ({
      ruleId: "DOB-TENT-001",
      triggerResult: "true",
      disposition: "required",
      unknownFields: [],
      name: "Tent permit",
      agency: "DOB",
      deadline: null,
      deadlineDisplay: null,
      latestApplyDate: "2026-07-01",
      applyAfterDate: null,
      deadlineStatus: "published_deadline_missed",
      slackDays: null,
      feeDisplay: null,
      portalName: "DOB NOW",
      portalUrl: "https://example.gov/dobnow",
      portalInstructions: null,
      ...overrides,
    });
    stubApi(
      plan({
        verdict: "CONDITIONAL",
        findings: [
          finding({
            ruleIds: ["DOB-TALL-STRUCTURE-001", "DOB-TENT-001"],
            name: "Tall structure permit",
            disposition: "required",
            deadlineStatus: "published_deadline_missed",
            latestApplyDate: "2026-07-01",
            portalName: "DOB NOW",
            portalUrl: "https://example.gov/dobnow",
            headlineMode: "applies_together",
            routes: [
              route({ ruleId: "DOB-TALL-STRUCTURE-001", name: "Tall structure permit" }),
              route({}),
            ],
          }),
        ],
        verdictDetail: {
          ...emptyVerdictDetail,
          missedRuleIds: ["DOB-TENT-001", "DOB-TALL-STRUCTURE-001"],
        },
      }),
    );
    renderPlan();
    await screen.findByTestId("missed-may-be-required");

    const section = screen.getByTestId("missed-may-be-required");
    expect(section.querySelector('a[href="https://example.gov/dobnow"]')?.textContent).toContain(
      "Apply through",
    );
  });

  it("describes a barred conditional miss without calling it may-be-required", async () => {
    const barredRoute = {
      ruleId: "NYPD-SOUND-PROHIBITED-001",
      triggerResult: "unknown" as const,
      disposition: "prohibited_or_ineligible",
      unknownFields: ["sound_purpose"],
      name: "Commercial advertising by sound device",
      agency: "NYPD",
      deadline: null,
      deadlineDisplay: null,
      latestApplyDate: "2026-07-01",
      applyAfterDate: null,
      deadlineStatus: "published_deadline_missed",
      slackDays: null,
      feeDisplay: null,
      portalName: null,
      portalUrl: null,
      portalInstructions: null,
    };
    stubApi(
      plan({
        verdict: "CONDITIONAL",
        findings: [
          finding({
            ruleIds: ["NYPD-SOUND-PROHIBITED-001"],
            name: "Commercial advertising by sound device",
            disposition: "prohibited_or_ineligible",
            deadlineStatus: "published_deadline_missed",
            latestApplyDate: "2026-07-01",
          }),
        ],
        verdictDetail: {
          ...emptyVerdictDetail,
          missedRuleIds: ["NYPD-SOUND-PROHIBITED-001"],
        },
      }),
    );
    renderPlan();
    await screen.findByTestId("missed-may-be-required");

    const section = screen.getByTestId("missed-may-be-required");
    expect(section.textContent).toContain("(prohibited or ineligible)");
    expect(section.textContent).not.toContain("These findings carry a may-be-required disposition");
    expect(section.textContent).toContain("publish a prohibition or an ineligibility");
    expect(section.textContent).toContain("The bar stands as each rule publishes it");
    expect(barredRoute.disposition).toBe("prohibited_or_ineligible");
  });

  it("names the blocking route, not the headline, in the rescope explanation", async () => {
    const route = (overrides: Partial<FindingRoute> = {}): FindingRoute => ({
      ruleId: "DOB-TENT-001",
      triggerResult: "true",
      disposition: "required",
      unknownFields: [],
      name: "Tent permit",
      agency: "DOB",
      deadline: { type: "before_issuance" } as FindingRoute["deadline"],
      deadlineDisplay: null,
      latestApplyDate: "2026-09-01",
      applyAfterDate: null,
      deadlineStatus: "on_track",
      slackDays: null,
      feeDisplay: null,
      portalName: null,
      portalUrl: null,
      portalInstructions: null,
      ...overrides,
    });
    stubApi(
      plan({
        verdict: "INFEASIBLE",
        findings: [
          finding({
            ruleIds: ["DOB-TENT-001", "DOB-TALL-STRUCTURE-001"],
            headlineMode: "applies_together",
            deadline: { type: "before_issuance" } as Finding["deadline"],
            routes: [
              route({}),
              route({
                ruleId: "DOB-TALL-STRUCTURE-001",
                name: "Tall structure permit",
                latestApplyDate: "2026-07-01",
                deadlineStatus: "published_deadline_missed",
              }),
            ],
          }),
        ],
        verdictDetail: {
          ...emptyVerdictDetail,
          blockingFinding: {
            ruleIds: ["DOB-TALL-STRUCTURE-001"],
            name: "Tall structure permit",
            agency: "DOB",
            disposition: "required",
            deadlineDisplay: null,
            latestApplyDate: "2026-07-01",
            deadlineStatus: "published_deadline_missed",
            feeDisplay: null,
            portalName: null,
            portalUrl: null,
            portalInstructions: null,
            sources: [],
            userSummary: null,
          },
          missedRuleIds: ["DOB-TALL-STRUCTURE-001"],
          rescopeSuggestions: [
            {
              change: { field: "structure_over_10ft_tall", value: "no" },
              reevaluatedVerdict: "CONDITIONAL",
              droppedRuleIds: ["DOB-TALL-STRUCTURE-001"],
              introducedRuleIds: [],
              remainingMissingFields: [],
              remainingTimelineReasons: [],
              minSlackDays: null,
              atRiskFindingName: null,
            },
          ],
        },
      }),
    );
    renderPlan();
    await screen.findByTestId("rescope-ladder");

    const reason = screen
      .getByTestId("rescope-ladder")
      .querySelector(".verdict-detail__rescope-reason");
    expect(reason?.textContent).toContain("Tall structure permit");
    expect(reason?.textContent).not.toContain("Tent permit");
  });

  it("shows nothing under a FEASIBLE verdict that has no branch or rescope work", async () => {
    stubApi(plan({ verdict: "FEASIBLE" }));
    renderPlan();
    await screen.findByRole("complementary", { name: "Rules snapshot" });
    expect(screen.queryByTestId("verdict-detail")).toBeNull();
  });
});

describe("navigating from one event's plan to another", () => {
  it("never shows the previous event's plan under a new event id", async () => {
    const first = plan({ eventId: "event-1", rulesetVersion: "nyc.v2.1" });
    stubApi(first);
    const view = render(<PlanView apiBaseUrl="https://api.example.com" eventId="event-1" />);
    await waitFor(() =>
      expect(screen.getByRole("complementary", { name: "Rules snapshot" }).textContent).toContain(
        "nyc.v2.1",
      ),
    );

    vi.stubGlobal(
      "fetch",
      vi.fn(
        (url: string) =>
          new Promise<Response>((resolvePromise) => {
            if (url.endsWith("/rules/meta")) resolvePromise(jsonResponse(200, liveMeta));
          }),
      ),
    );
    view.rerender(<PlanView apiBaseUrl="https://api.example.com" eventId="event-2" />);

    await waitFor(() =>
      expect(screen.getByRole("status").textContent).toBe("Loading your permit plan…"),
    );
    expect(screen.queryByRole("complementary")).toBeNull();
    expect(screen.queryByText(/nyc\.v2\.1/)).toBeNull();
  });

  it("does not leave the old plan on screen when the new event's request fails", async () => {
    stubApi(plan({ eventId: "event-1" }));
    const view = render(<PlanView apiBaseUrl="https://api.example.com" eventId="event-1" />);
    await waitFor(() => expect(screen.getAllByRole("article").length).toBeGreaterThan(0));

    stubApi({}, liveMeta, 404);
    view.rerender(<PlanView apiBaseUrl="https://api.example.com" eventId="event-2" />);

    expect((await screen.findByRole("alert")).textContent).toBe(
      "No plan has been generated for this event yet.",
    );
    expect(screen.queryAllByRole("article")).toEqual([]);
  });
});

describe("the first plan for an event", () => {
  it("offers to generate one instead of dead-ending on the 404", async () => {
    stubApi({}, liveMeta, 404);
    renderPlan();

    expect((await screen.findByRole("alert")).textContent).toBe(
      "No plan has been generated for this event yet.",
    );
    expect(screen.getByRole("button", { name: "Generate the plan" })).toBeDefined();
  });

  it("generates the plan and shows it, banner and citations included", async () => {
    let generated = false;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.endsWith("/rules/meta")) return jsonResponse(200, liveMeta);
        if (url.endsWith("/plan")) {
          if (init?.method === "POST") {
            generated = true;
            return jsonResponse(201, { ...plan(), eventRevision: 1 });
          }
          return generated ? jsonResponse(200, plan()) : jsonResponse(404, {});
        }
        return jsonResponse(200, {
          event: { id: "event-1", revision_counter: 1 },
          warnings: [],
          plan_stale: false,
        });
      }),
    );
    const user = userEvent.setup();
    renderPlan();

    await user.click(await screen.findByRole("button", { name: "Generate the plan" }));

    await waitFor(() =>
      expect(screen.getByRole("complementary", { name: "Rules snapshot" })).toBeDefined(),
    );
    expect(screen.getByText("Parks FAQ")).toBeDefined();
  });

  it("says why when generation itself fails, and lets the organizer retry", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.endsWith("/rules/meta")) return jsonResponse(200, liveMeta);
        if (url.endsWith("/plan")) {
          if (init?.method === "POST")
            return jsonResponse(500, { error: "plan generation failed" });
          return jsonResponse(404, {});
        }
        return jsonResponse(200, {
          event: { id: "event-1", revision_counter: 1 },
          warnings: [],
          plan_stale: false,
        });
      }),
    );
    const user = userEvent.setup();
    renderPlan();

    await user.click(await screen.findByRole("button", { name: "Generate the plan" }));

    await waitFor(() =>
      expect(screen.getAllByRole("alert").map((alert) => alert.textContent)).toContain(
        "plan generation failed",
      ),
    );
    expect(screen.getByRole("button", { name: "Generate the plan" }).hasAttribute("disabled")).toBe(
      false,
    );
  });
});

describe("the metadata request", () => {
  it("does not hold the plan behind a rules-meta call that never settles", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (url: string) =>
          new Promise<Response>((resolvePromise) => {
            if (!url.endsWith("/rules/meta")) resolvePromise(jsonResponse(200, plan()));
          }),
      ),
    );
    renderPlan();

    const banner = await screen.findByRole("complementary", { name: "Rules snapshot" });
    expect(banner.textContent).toContain(`Rules snapshot ${publishedRuleset.ruleset_version}`);
    expect(banner.textContent).toContain(
      `published ${formatSnapshotDate(publishedRuleset.snapshot_date)}`,
    );
    expect(banner.textContent).not.toContain("ruleset (");
    expect(screen.getAllByRole("article").length).toBeGreaterThan(0);
  });
});

describe("verdictCopy on its own", () => {
  it("returns the approved copy with no plan detail to draw slots from", () => {
    expect(verdictCopy("INFEASIBLE")).toBe("Published deadline missed as scoped");
    expect(verdictCopy("FEASIBLE")).toBe("On track");
    expect(verdictCopy("CONDITIONAL")).toBe("Depends on");
    expect(verdictCopy("FEASIBLE_AT_RISK")).toBe("At risk");
  });
});

describe("a generated plan whose own response cannot be read", () => {
  const stubUnreadableGeneration = (reread: () => Response) => {
    let generated = false;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.endsWith("/rules/meta")) return jsonResponse(200, liveMeta);
        if (url.endsWith("/plan")) {
          if (init?.method === "POST") {
            generated = true;
            const { generatedAt: _lost, ...unreadable } = plan();
            return jsonResponse(201, unreadable);
          }
          return generated ? reread() : jsonResponse(404, {});
        }
        return jsonResponse(200, {
          event: { id: "event-1", revision_counter: 1 },
          warnings: [],
          plan_stale: false,
        });
      }),
    );
  };

  it("installs the plan the generation returned, without reading it back", async () => {
    let planGets = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.endsWith("/rules/meta")) return jsonResponse(200, liveMeta);
        if (url.endsWith("/plan")) {
          if (init?.method === "POST") {
            return jsonResponse(201, plan({ eventRevision: 7, verdict: "FEASIBLE" }));
          }
          planGets += 1;
          return planGets > 1
            ? jsonResponse(500, { error: "must not be called" })
            : jsonResponse(404, {});
        }
        return jsonResponse(200, {
          event: { id: "event-1", revision_counter: 7 },
          warnings: [],
          plan_stale: false,
        });
      }),
    );
    const user = userEvent.setup();
    renderPlan();

    await user.click(await screen.findByRole("button", { name: "Generate the plan" }));

    await waitFor(() =>
      expect(document.querySelector(".plan__verdict")?.textContent).toContain("On track"),
    );
    expect(document.querySelector(".plan__verdict")?.textContent).toContain("revision 7");
    expect(planGets).toBe(1);
    expect(screen.queryByRole("button", { name: "Generating plan…" })).toBeNull();
  });

  it("falls back to reading the plan it just wrote", async () => {
    stubUnreadableGeneration(() => jsonResponse(200, plan()));
    const user = userEvent.setup();
    renderPlan();

    await user.click(await screen.findByRole("button", { name: "Generate the plan" }));

    await waitFor(() =>
      expect(document.querySelector(".plan__verdict")?.textContent).toContain("generated"),
    );
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("reports the failure and keeps the missing plan retryable", async () => {
    stubUnreadableGeneration(() => jsonResponse(500, { error: "plan lookup failed" }));
    const user = userEvent.setup();
    renderPlan();

    await user.click(await screen.findByRole("button", { name: "Generate the plan" }));

    await waitFor(() =>
      expect(screen.getAllByRole("alert").map((alert) => alert.textContent)).toContain(
        "The API returned a plan this page cannot read.",
      ),
    );
    expect(screen.getByRole("button", { name: "Generate the plan" })).toBeDefined();
  });
});

describe("a rule whose whole deadline is its type", () => {
  it("states 'before issuance' for a line that publishes no prose and no date", async () => {
    const insurance = publishedRule("SAPO-INSURANCE-001");
    expect(insurance.output.deadline).toEqual({ type: "before_issuance" });

    stubApi(
      plan({
        findings: [
          finding({
            ruleIds: ["SAPO-INSURANCE-001"],
            deadline: { type: "before_issuance", display: null, qualification: null },
            deadlineDisplay: null,
            latestApplyDate: null,
            deadlineStatus: "not_applicable",
          }),
        ],
      }),
    );
    renderPlan();

    await screen.findAllByRole("article");
    const planLine = document.querySelector("article.line");
    expect(planLine).not.toBeNull();
    const line = within(planLine as HTMLElement);
    expect(line.getByText("before issuance")).toBeDefined();
  });

  it("does not repeat the type when the line already states a date or prose", async () => {
    stubApi(
      plan({
        findings: [
          finding({
            deadline: {
              type: "published_minimum",
              calendarDays: 45,
              display: null,
              boundary: "inclusive",
              qualification: null,
            },
            deadlineDisplay: null,
            latestApplyDate: "2026-07-15",
            deadlineStatus: "published_deadline_missed",
          }),
        ],
      }),
    );
    renderPlan();

    const line = within(await screen.findByRole("article"));
    expect(line.getByText(/apply by 2026-07-15/)).toBeDefined();
    expect(line.queryByText("published minimum")).toBeNull();
  });
});

describe("ordering the live ruleset against the pinned one", () => {
  it("only tells the organizer to regenerate when the live ruleset is actually newer", () => {
    expect(compareToPinned("nyc.v2.3", "nyc.v2.1")).toBe("newer");
    expect(compareToPinned("nyc.v3.0", "nyc.v2.9")).toBe("newer");
    expect(compareToPinned("nyc.v2.2", "nyc.v2.3")).toBe("older");
    expect(compareToPinned("nyc.v2.9", "nyc.v3.0")).toBe("older");
    expect(compareToPinned("nyc.v2.3", "nyc.v2.3")).toBe("same");
  });

  it("orders the minor part as a number, not as text", () => {
    expect(compareToPinned("nyc.v2.10", "nyc.v2.9")).toBe("newer");
    expect(compareToPinned("nyc.v2.9", "nyc.v2.10")).toBe("older");
  });

  it("refuses to claim a direction it cannot derive", () => {
    expect(compareToPinned("nyc-2.3", "nyc.v2.1")).toBe("different");
    expect(compareToPinned("nyc.v2.3", "draft")).toBe("different");
    expect(compareToPinned("bos.v1.0", "nyc.v2.3")).toBe("different");
    expect(compareToPinned("draft", "draft")).toBe("different");
  });

  it("says the service is on an older ruleset after a rollback, without advising regeneration", async () => {
    stubApi(plan({ rulesetVersion: "nyc.v2.3" }), {
      ruleset_version: "nyc.v2.2",
      snapshot_date: "2026-07-24",
    });
    renderPlan();
    const banner = await screen.findByRole("complementary", { name: "Rules snapshot" });

    expect(banner.textContent).toContain("Rules snapshot nyc.v2.3");
    expect(banner.textContent).toContain("the service is running an older ruleset (nyc.v2.2)");
    expect(banner.textContent).not.toContain("newer");
    expect(banner.textContent).not.toContain("regenerate");
  });

  it("uses neutral wording for a version it cannot order", async () => {
    stubApi(plan({ rulesetVersion: "nyc.v2.3" }), {
      ruleset_version: "nyc-hotfix",
      snapshot_date: "2026-07-25",
    });
    renderPlan();
    const banner = await screen.findByRole("complementary", { name: "Rules snapshot" });

    expect(banner.textContent).toContain("the service is running a different ruleset (nyc-hotfix)");
    expect(banner.textContent).not.toContain("newer");
    expect(banner.textContent).not.toContain("older");
  });
});

describe("regenerating while the service is behind the plan's ruleset", () => {
  const stubBehind = (pinned: string, live: string | null) =>
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.endsWith("/rules/meta")) {
          return live === null
            ? jsonResponse(503, { error: "rules file unreadable" })
            : jsonResponse(200, { ruleset_version: live, snapshot_date: "2026-07-24" });
        }
        if (url.endsWith("/plan")) {
          return jsonResponse(200, plan({ rulesetVersion: pinned, eventRevision: 1 }));
        }
        return jsonResponse(200, {
          event: { id: "event-1", revision_counter: 4 },
          warnings: [],
          plan_stale: true,
        });
      }),
    );

  it("refuses regeneration when the service has been rolled back behind the plan", async () => {
    stubBehind("nyc.v2.3", "nyc.v2.2");
    renderPlan();

    expect((await screen.findByRole("alert")).textContent).toContain("now at revision 4");
    expect(screen.queryByRole("button", { name: "Regenerate the plan" })).toBeNull();
  });

  it("says it is the service that is behind, naming both versions", async () => {
    stubBehind("nyc.v2.3", "nyc.v2.2");
    renderPlan();
    await screen.findByRole("complementary", { name: "Rules snapshot" });

    const refused = document.querySelector(".plan__refused");
    expect(refused?.textContent).toContain("generated from ruleset nyc.v2.3");
    expect(refused?.textContent).toContain("service is currently running nyc.v2.2");
    expect(refused?.textContent).toContain("not a problem with your event");
    expect(refused?.textContent).toContain("the plan below");
  });

  it("refuses a version it cannot order, for the same reason", async () => {
    stubBehind("nyc.v2.3", "nyc-hotfix");
    renderPlan();
    await screen.findByRole("complementary", { name: "Rules snapshot" });

    expect(screen.queryByRole("button", { name: "Regenerate the plan" })).toBeNull();
    expect(document.querySelector(".plan__refused")?.textContent).toContain("nyc-hotfix");
  });

  it("refuses when the service's ruleset cannot be read at all", async () => {
    stubBehind("nyc.v2.3", null);
    renderPlan();
    await screen.findByRole("complementary", { name: "Rules snapshot" });

    expect(screen.queryByRole("button", { name: "Regenerate the plan" })).toBeNull();
    expect(document.querySelector(".plan__refused")?.textContent).toContain("could not be read");
  });

  it("still regenerates a stale plan when the service is level with it", async () => {
    stubBehind(publishedRuleset.ruleset_version, publishedRuleset.ruleset_version);
    renderPlan();

    expect(await screen.findByRole("button", { name: "Regenerate the plan" })).toBeDefined();
    expect(document.querySelector(".plan__refused")).toBeNull();
  });

  it("still regenerates onto a newer ruleset, which is what the banner promises", async () => {
    stubBehind("nyc.v2.1", publishedRuleset.ruleset_version);
    renderPlan();

    expect(await screen.findByRole("button", { name: "Regenerate the plan" })).toBeDefined();
    expect(document.querySelector(".plan__refused")).toBeNull();
  });

  it("still generates a first plan whatever the service is running", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.endsWith("/rules/meta")) {
          return jsonResponse(200, { ruleset_version: "nyc-hotfix", snapshot_date: "2026-07-25" });
        }
        if (url.endsWith("/plan")) return jsonResponse(404, {});
        return jsonResponse(200, {
          event: { id: "event-1", revision_counter: 1 },
          warnings: [],
          plan_stale: false,
        });
      }),
    );
    renderPlan();

    expect(await screen.findByRole("button", { name: "Generate the plan" })).toBeDefined();
    expect(document.querySelector(".plan__refused")).toBeNull();
  });
});

describe("a plan the event has moved past", () => {
  const stubWithEvent = (planBody: unknown, revisionCounter: number | null, planStatus = 200) => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith("/rules/meta")) return jsonResponse(200, liveMeta);
      if (url.endsWith("/plan")) {
        if (init?.method === "POST") return jsonResponse(201, planBody);
        return jsonResponse(planStatus, planBody);
      }
      return revisionCounter === null
        ? jsonResponse(500, { error: "event lookup failed" })
        : jsonResponse(200, {
            event: { id: "event-1", revision_counter: revisionCounter },
            warnings: [],
            plan_stale: false,
          });
    });
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  };

  it("says so when the event has been edited since the plan was generated", async () => {
    stubWithEvent(plan({ eventRevision: 1 }), 3);
    renderPlan();

    const warning = await screen.findByRole("alert");
    expect(warning.textContent).toContain("generated for revision 1");
    expect(warning.textContent).toContain("now at revision 3");
    expect(screen.getByRole("button", { name: "Regenerate the plan" })).toBeDefined();
  });

  it("does not warn when the plan matches the event's current revision", async () => {
    stubWithEvent(plan({ eventRevision: 2 }), 2);
    renderPlan();

    await screen.findByRole("complementary", { name: "Rules snapshot" });
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByText(/unconfirmed/)).toBeNull();
  });

  it("replaces a stale plan with one generated for the event as it stands", async () => {
    const eventRevision = 3;
    let planRevision = 1;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.endsWith("/rules/meta")) return jsonResponse(200, liveMeta);
        if (url.endsWith("/plan")) {
          if (init?.method === "POST") {
            planRevision = eventRevision;
            return jsonResponse(201, plan({ eventRevision: planRevision }));
          }
          return jsonResponse(200, plan({ eventRevision: planRevision }));
        }
        return jsonResponse(200, {
          event: { id: "event-1", revision_counter: eventRevision },
          warnings: [],
          plan_stale: false,
        });
      }),
    );
    const user = userEvent.setup();
    renderPlan();

    await user.click(await screen.findByRole("button", { name: "Regenerate the plan" }));

    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
    expect(screen.getByText(/revision 3/)).toBeDefined();
  });

  it("does not claim currency it could not confirm", async () => {
    stubWithEvent(plan({ eventRevision: 1 }), null);
    renderPlan();

    await screen.findByRole("complementary", { name: "Rules snapshot" });
    expect(screen.getByText(/whether this plan is still current is unconfirmed/)).toBeDefined();
  });

  const stubEventBody = (event: Record<string, unknown>) =>
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.endsWith("/rules/meta")) return jsonResponse(200, liveMeta);
        if (url.endsWith("/plan")) return jsonResponse(200, plan({ eventRevision: 1 }));
        return jsonResponse(200, { event, warnings: [], plan_stale: false });
      }),
    );

  it.each([
    ["is absent", {}],
    ["is a string", { revision_counter: "4" }],
    ["is null", { revision_counter: null }],
    // JSON cannot encode NaN or Infinity; both reach the browser as null, which is the case above.
  ])("says currency is unconfirmed when the revision %s", async (_case, revision) => {
    stubEventBody({ id: "event-1", ...revision });
    renderPlan();

    await screen.findByRole("complementary", { name: "Rules snapshot" });
    expect(screen.getByText(/whether this plan is still current is unconfirmed/)).toBeDefined();
  });

  it("still compares a revision the event body actually carries", async () => {
    stubEventBody({ id: "event-1", revision_counter: 4 });
    renderPlan();

    expect((await screen.findByRole("alert")).textContent).toContain("now at revision 4");
    expect(screen.queryByText(/unconfirmed/)).toBeNull();
  });

  it("does not claim currency it has not confirmed yet", async () => {
    let releaseEvent: (response: Response) => void = () => {};
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.endsWith("/rules/meta")) return jsonResponse(200, liveMeta);
        if (url.endsWith("/plan")) return jsonResponse(200, plan({ eventRevision: 1 }));
        return new Promise<Response>((resolvePromise) => {
          releaseEvent = resolvePromise;
        });
      }),
    );
    renderPlan();

    await screen.findByRole("complementary", { name: "Rules snapshot" });
    expect(screen.getAllByRole("article").length).toBeGreaterThan(0);
    expect(screen.getByText(/unconfirmed until then/)).toBeDefined();

    releaseEvent(
      jsonResponse(200, {
        event: { id: "event-1", revision_counter: 1 },
        warnings: [],
        plan_stale: false,
      }),
    );
    await waitFor(() => expect(screen.queryByText(/unconfirmed/)).toBeNull());
  });

  it("says the plan is stale, not unconfirmed, once the check comes back past it", async () => {
    stubWithEvent(plan({ eventRevision: 1 }), 3);
    renderPlan();

    await waitFor(() => expect(screen.queryByText(/unconfirmed/)).toBeNull());
    expect((await screen.findByRole("alert")).textContent).toContain("now at revision 3");
  });

  it("installs a regenerated plan without waiting for the revision re-read", async () => {
    const eventRevision = 3;
    let planRevision = 1;
    let eventCalls = 0;
    let releaseEvent: (response: Response) => void = () => {};
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.endsWith("/rules/meta")) return jsonResponse(200, liveMeta);
        if (url.endsWith("/plan")) {
          if (init?.method === "POST") {
            planRevision = eventRevision;
            return jsonResponse(201, plan({ eventRevision: planRevision }));
          }
          return jsonResponse(200, plan({ eventRevision: planRevision }));
        }
        eventCalls += 1;
        if (eventCalls > 1) {
          return new Promise<Response>((resolvePromise) => {
            releaseEvent = resolvePromise;
          });
        }
        return jsonResponse(200, {
          event: { id: "event-1", revision_counter: eventRevision },
          warnings: [],
          plan_stale: false,
        });
      }),
    );
    const user = userEvent.setup();
    renderPlan();

    await user.click(await screen.findByRole("button", { name: "Regenerate the plan" }));

    await waitFor(() =>
      expect(document.querySelector(".plan__verdict")?.textContent).toContain("revision 3"),
    );
    expect(screen.queryByRole("button", { name: "Generating plan…" })).toBeNull();
    expect(screen.getByText(/unconfirmed until then/)).toBeDefined();

    releaseEvent(
      jsonResponse(200, {
        event: { id: "event-1", revision_counter: eventRevision },
        warnings: [],
        plan_stale: false,
      }),
    );
    await waitFor(() => expect(screen.queryByText(/unconfirmed/)).toBeNull());
  });
});

describe("the states this page can be in", () => {
  const stubScript = (script: {
    plan?: () => Response;
    post?: () => Response;
    event?: () => Response;
    meta?: () => Response;
  }) => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith("/rules/meta"))
        return (script.meta ?? (() => jsonResponse(200, liveMeta)))();
      if (url.endsWith("/plan")) {
        if (init?.method === "POST") return (script.post ?? (() => jsonResponse(201, plan())))();
        return (script.plan ?? (() => jsonResponse(200, plan())))();
      }
      return (
        script.event ??
        (() =>
          jsonResponse(200, {
            event: { id: "event-1", revision_counter: 1 },
            warnings: [],
            plan_stale: false,
          }))
      )();
    });
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  };

  it("offers generation for a missing plan but not for one it could not read", async () => {
    for (const unreadable of [
      () => jsonResponse(500, { error: "plan lookup failed" }),
      () => jsonResponse(500, { error: "stored plan is incomplete" }),
      () => new Response("<html>gateway</html>", { status: 502 }),
    ]) {
      stubScript({ plan: unreadable });
      renderPlan();
      await screen.findByRole("alert");
      expect(screen.queryByRole("button", { name: /Generate|Regenerate/ })).toBeNull();
      cleanup();
    }

    stubScript({ plan: () => jsonResponse(404, {}) });
    renderPlan();
    expect(await screen.findByRole("button", { name: "Generate the plan" })).toBeDefined();
  });

  it("does not offer to create a plan for an event that does not exist", async () => {
    stubScript({
      plan: () => jsonResponse(404, { error: "event event-1 not found" }),
      event: () => jsonResponse(404, { error: "event not found" }),
    });
    renderPlan();

    expect((await screen.findByRole("alert")).textContent).toBe("event event-1 not found");
    expect(screen.queryByRole("button", { name: /Generate|Regenerate/ })).toBeNull();
  });

  it("shows a regeneration failure while the stale plan is still on screen", async () => {
    stubScript({
      plan: () => jsonResponse(200, plan({ eventRevision: 1 })),
      event: () =>
        jsonResponse(200, {
          event: { id: "event-1", revision_counter: 4 },
          warnings: [],
          plan_stale: true,
        }),
      post: () => jsonResponse(500, { error: "plan generation failed" }),
    });
    const user = userEvent.setup();
    renderPlan();

    await user.click(await screen.findByRole("button", { name: "Regenerate the plan" }));

    await waitFor(() =>
      expect(screen.getAllByRole("alert").map((alert) => alert.textContent)).toContain(
        "plan generation failed",
      ),
    );
    expect(screen.getAllByRole("article").length).toBeGreaterThan(0);
    expect(screen.getByText(/generated for revision 1/)).toBeDefined();
  });

  it("offers the regeneration the banner tells the organizer to perform", async () => {
    stubScript({
      plan: () => jsonResponse(200, plan({ rulesetVersion: "nyc.v2.1", eventRevision: 1 })),
      meta: () => jsonResponse(200, { ruleset_version: "nyc.v2.3", snapshot_date: "2026-07-25" }),
    });
    renderPlan();

    const banner = await screen.findByRole("complementary", { name: "Rules snapshot" });
    expect(banner.textContent).toContain("regenerate to update");
    expect(screen.getByRole("button", { name: "Regenerate the plan" })).toBeDefined();
    expect(screen.queryByText(/has since been edited/)).toBeNull();
  });

  it("offers nothing when the live ruleset is older or unorderable", async () => {
    for (const live of ["nyc.v2.2", "nyc-hotfix"]) {
      stubScript({
        plan: () => jsonResponse(200, plan({ rulesetVersion: "nyc.v2.3", eventRevision: 1 })),
        meta: () => jsonResponse(200, { ruleset_version: live, snapshot_date: "2026-07-24" }),
      });
      renderPlan();
      await screen.findByRole("complementary", { name: "Rules snapshot" });
      expect(screen.queryByRole("button", { name: /Regenerate/ }), live).toBeNull();
      cleanup();
    }
  });

  it("explains an evaluation that found nothing rather than rendering an empty page", async () => {
    stubScript({
      plan: () => jsonResponse(200, plan({ verdict: "FEASIBLE", findings: [] })),
    });
    renderPlan();

    expect(
      await screen.findByText("No definite city event requirement identified from your answers."),
    ).toBeDefined();
    expect(screen.getByText("On track")).toBeDefined();
    expect(screen.queryAllByRole("article")).toEqual([]);
  });

  it("still lists findings when there are any", async () => {
    stubScript({});
    renderPlan();

    await waitFor(() => expect(screen.getAllByRole("article").length).toBe(1));
    expect(screen.queryByText(/No definite city event requirement/)).toBeNull();
  });

  it("keeps near-empty copy alongside advisories and named confirmations", async () => {
    stubScript({
      plan: () =>
        jsonResponse(
          200,
          plan({
            verdict: "FEASIBLE",
            findings: [
              finding({
                ruleIds: ["ADV-VENUE-OCCUPANCY-001"],
                kind: "advisory",
                disposition: "advisory",
              }),
              finding({
                ruleIds: ["CONF-NO-BATTERY-001"],
                kind: "note",
                disposition: "no_new_requirement",
              }),
            ],
          }),
        ),
    });
    renderPlan();

    expect(
      await screen.findByText("No definite city event requirement identified from your answers."),
    ).toBeDefined();
    expect(screen.getAllByRole("article")).toHaveLength(2);
  });

  it("never classifies a definite required finding as near-empty when its deadline is not calculable", async () => {
    stubScript({
      plan: () =>
        jsonResponse(
          200,
          plan({
            findings: [
              finding({
                disposition: "required",
                deadlineStatus: "not_calculable",
                latestApplyDate: null,
              }),
            ],
          }),
        ),
    });
    renderPlan();

    await screen.findByRole("article");
    expect(screen.queryByText(/No definite city event requirement/)).toBeNull();
  });
});

describe("a regeneration that finishes after the page has moved on", () => {
  it("does not install one event's plan under another event's id", async () => {
    let releasePost: (response: Response) => void = () => {};
    let generated = false;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.endsWith("/rules/meta")) return jsonResponse(200, liveMeta);
        if (url.endsWith("/plan")) {
          if (init?.method === "POST") {
            return new Promise<Response>((resolvePromise) => {
              releasePost = (response) => {
                generated = true;
                resolvePromise(response);
              };
            });
          }
          return url.includes("event-1") && generated
            ? jsonResponse(200, plan({ eventId: "event-1", rulesetVersion: "nyc.v2.1" }))
            : jsonResponse(404, {});
        }
        return jsonResponse(200, {
          event: { id: "event-1", revision_counter: 1 },
          warnings: [],
          plan_stale: false,
        });
      }),
    );
    const user = userEvent.setup();
    const view = render(<PlanView apiBaseUrl="https://api.example.com" eventId="event-1" />);

    await user.click(await screen.findByRole("button", { name: "Generate the plan" }));
    view.rerender(<PlanView apiBaseUrl="https://api.example.com" eventId="event-2" />);
    await screen.findByRole("button", { name: "Generate the plan" });

    releasePost(jsonResponse(201, plan({ eventId: "event-1", rulesetVersion: "nyc.v2.1" })));
    await new Promise((resolveTimer) => setTimeout(resolveTimer, 50));

    expect(screen.queryByText(/nyc\.v2\.1/)).toBeNull();
    expect(screen.queryAllByRole("article")).toEqual([]);
    expect(screen.getByRole("button", { name: "Generate the plan" })).toBeDefined();
  });
});

describe("a scannable line (progressive disclosure)", () => {
  const collapsedLine = async (only: Finding) => {
    stubApi(plan({ findings: [only] }));
    renderPlan();
    return within(await screen.findByRole("article"));
  };

  const full = () =>
    finding({
      name: "Special Event Permit",
      agency: "NYC Parks",
      disposition: "required",
      feeDisplay: "$25 processing fee",
      latestApplyDate: "2026-08-01",
      deadlineStatus: "on_track",
      verificationStatus: "SOURCE_CONFIRMED",
      lastVerifiedDate: "2026-07-18",
      noteText: "A published note.",
      portalName: "NYC Parks portal",
      portalUrl: "https://example.gov/apply",
      notes: ["Another published note."],
      sources: [
        { ruleId: "PARKS-EVENT-001", citation: "Parks FAQ", urls: ["https://example.gov/faq"] },
        { ruleId: "PARKS-EVENT-001", citation: "Second page", urls: ["https://example.gov/two"] },
      ],
    });

  it("renders a sourced plain-language summary and keeps legal prose collapsed", async () => {
    const line = await collapsedLine(
      finding({
        name: "Place of Assembly (PACO) / Temporary Place of Assembly (TPA)",
        agency: "DOB (+ FDNY Public Assembly Permit)",
        disposition: "may_be_required",
        deadlineDisplay: "Published legal deadline text.",
        deadlineStatus: "not_calculable",
        feeDisplay: "Published legal fee text.",
        notes: ["Long legal qualification."],
        userSummary: {
          heading: "Place of Assembly approval (PACO / TPA)",
          points: [
            {
              kind: "deadline",
              text: "File at least 10 business days before the event.",
              sources: [
                {
                  label: "DOB TPA filing page",
                  url: "https://example.gov/tpa",
                },
              ],
            },
            {
              kind: "fee",
              text: "DOB's published TPA filing fee is $250.",
              sources: [
                {
                  label: "DOB fee page",
                  url: "https://example.gov/fees",
                },
              ],
            },
          ],
        },
      }),
    );

    expect(
      line.getByRole("heading", { name: "Place of Assembly approval (PACO / TPA)" }),
    ).toBeDefined();
    expect(line.getByRole("list").querySelectorAll("li")).toHaveLength(3);
    expect(line.getByText(/File at least 10 business days/)).toBeDefined();
    expect(line.getByText("may be required")).toBeDefined();
    expect(
      line
        .getAllByRole("link", { name: "DOB TPA filing page" })
        .every((link) => link.getAttribute("href") === "https://example.gov/tpa"),
    ).toBe(true);
    expect(line.getByRole("link", { name: "DOB fee page" }).getAttribute("href")).toBe(
      "https://example.gov/fees",
    );
    expect(line.queryByText("Published legal deadline text.")).toBeNull();
    expect(line.queryByText("Published legal fee text.")).toBeNull();
    expect(line.queryByText("Long legal qualification.")).toBeNull();

    await userEvent.click(
      line.getByRole("button", {
        name: "Legal details and all sources for Place of Assembly approval (PACO / TPA)",
      }),
    );
    expect(line.getByText(/Published legal deadline text/)).toBeDefined();
    expect(line.getByText("Published legal fee text.")).toBeDefined();
    expect(line.getByText("Long legal qualification.")).toBeDefined();
  });

  it("preserves the published finding text inside summarized legal details", async () => {
    const publishedText =
      "Known published deadlines: production 10 days; open culture 15 days; street festival Dec 31.";
    const line = await collapsedLine(
      finding({
        name: publishedText,
        kind: "advisory",
        disposition: "advisory",
        agency: null,
        userSummary: {
          heading: "SAPO event type not covered",
          points: [{ kind: "warning", text: "Confirm the deadline with SAPO.", sources: [] }],
        },
      }),
    );

    expect(line.queryByText(publishedText)).toBeNull();
    await userEvent.click(
      line.getByRole("button", {
        name: "Legal details and all sources for SAPO event type not covered",
      }),
    );
    expect(line.getByText(publishedText)).toBeDefined();
  });

  it("shows exactly the summary fields before the line is expanded", async () => {
    const line = await collapsedLine(full());

    expect(line.getByRole("heading", { name: "Special Event Permit" })).toBeDefined();
    expect(line.getByText("NYC Parks")).toBeDefined();
    expect(line.getByText("required")).toBeDefined();
    expect(line.getByText("$25 processing fee")).toBeDefined();
    expect(line.getByText(/apply by 2026-08-01/)).toBeDefined();
    expect(line.getByText(/on track/)).toBeDefined();
    expect(line.getByText("SOURCE CONFIRMED")).toBeDefined();
    expect(line.getByText("Parks FAQ")).toBeDefined();

    expect(line.queryByText("Second page")).toBeNull();
    expect(line.queryByText(/last verified/)).toBeNull();
    expect(line.queryByText("A published note.")).toBeNull();
    expect(line.queryByText("Another published note.")).toBeNull();
    expect(line.queryByText(/apply at/)).toBeNull();
    expect(line.queryByText("PARKS-EVENT-001")).toBeNull();
  });

  it("reveals exactly the detail fields when expanded", async () => {
    const line = await collapsedLine(full());
    await userEvent.click(line.getByRole("button", { name: "Details for Special Event Permit" }));

    expect(line.getByText("Second page")).toBeDefined();
    expect(line.getByText("last verified 2026-07-18")).toBeDefined();
    expect(line.getByText("A published note.")).toBeDefined();
    expect(line.getByText("Another published note.")).toBeDefined();
    expect(line.getByText(/apply at/)).toBeDefined();
    expect(line.getByText("PARKS-EVENT-001")).toBeDefined();

    expect(line.getByText(/apply by 2026-08-01/)).toBeDefined();
    expect(line.getByText("SOURCE CONFIRMED")).toBeDefined();
  });

  it("shows a RESEARCH_REQUIRED line's absent source on the line itself", async () => {
    const line = await collapsedLine(
      finding({ verificationStatus: "RESEARCH_REQUIRED", sources: [] }),
    );

    expect(line.getByText(CONFIRM_WITH_AGENCY)).toBeDefined();
    expect(line.getByText("RESEARCH REQUIRED")).toBeDefined();
  });

  it("signals an official conflict in the summary and states both readings on expand", async () => {
    const line = await collapsedLine(
      finding({
        verificationStatus: "OFFICIAL_CONFLICT",
        conflictText: "One source says 90 days; another says December 31 of the prior year.",
      }),
    );

    expect(line.getByText("OFFICIAL CONFLICT")).toBeDefined();
    expect(line.queryByText(/One source says 90 days/)).toBeNull();

    await userEvent.click(line.getByRole("button", { name: /^Details for/ }));
    expect(line.getByText(/One source says 90 days/)).toBeDefined();
  });

  it("renders a published fee, and nothing at all when none is published", async () => {
    const published = await collapsedLine(finding({ feeDisplay: "$25 processing fee" }));
    expect(published.getByText("$25 processing fee")).toBeDefined();

    cleanup();
    const absent = await collapsedLine(finding({ feeDisplay: null }));
    expect(absent.queryByText("fee not published")).toBeNull();
    expect(document.querySelector(".line__fee")).toBeNull();
    expect(absent.queryByText("$0")).toBeNull();
  });

  const bareFinding = () =>
    finding({
      ruleIds: ["DOHMH-EXEMPTION-001"],
      kind: "advisory",
      name: "Temporary food service exemption",
      disposition: "may_be_required",
      noteText: null,
      conflictText: null,
      notes: [],
      portalName: null,
      portalUrl: null,
      portalInstructions: null,
      applyAfterDate: null,
      timelineUnresolvedReason: null,
      deadlineUnknownFields: [],
      lastVerifiedDate: null,
      sources: [
        {
          ruleId: "DOHMH-EXEMPTION-001",
          citation: "DOHMH temporary food service FAQ",
          urls: ["https://example.gov/dohmh"],
        },
      ],
    });

  it("keeps the rule ids reachable on a finding that has no optional detail", async () => {
    const line = await collapsedLine(bareFinding());

    const toggle = line.getByRole("button", {
      name: "Details for Temporary food service exemption",
    });
    await userEvent.click(toggle);
    expect(line.getByText("DOHMH-EXEMPTION-001")).toBeDefined();
  });

  it("offers the expand on every finding shape, so no panel field can vanish with the panel", async () => {
    for (const shape of [bareFinding(), finding({ sources: [] }), full()]) {
      cleanup();
      const line = await collapsedLine(shape);
      expect(line.queryByRole("button", { name: /^Details for/ })).not.toBeNull();
    }
  });

  it("reports a URL-less source that is behind the expand, without anyone expanding it", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const line = await collapsedLine(
        finding({
          sources: [
            { ruleId: "PARKS-EVENT-001", citation: "Parks FAQ", urls: ["https://example.gov/faq"] },
            {
              ruleId: "PARKS-EVENT-EXACTLY-20-001",
              citation: "Parks borough office, by phone",
              urls: [],
            },
          ],
        }),
      );

      expect(line.queryByText("Parks borough office, by phone")).toBeNull();

      await waitFor(() =>
        expect(logged).toHaveBeenCalledWith(
          expect.stringContaining("no source URL"),
          expect.objectContaining({
            ruleId: "PARKS-EVENT-EXACTLY-20-001",
            citation: "Parks borough office, by phone",
          }),
        ),
      );
    } finally {
      logged.mockRestore();
    }
  });

  it("is operable from the keyboard and reports its state programmatically", async () => {
    const line = await collapsedLine(full());
    const toggle = line.getByRole("button", { name: "Details for Special Event Permit" });

    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    await userEvent.tab();
    while (document.activeElement !== toggle) await userEvent.tab();

    await userEvent.keyboard("{Enter}");
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(line.getByText("last verified 2026-07-18")).toBeDefined();

    await userEvent.keyboard(" ");
    expect(toggle.getAttribute("aria-expanded")).toBe("false");

    await userEvent.keyboard("{Enter}");
    const panelId = toggle.getAttribute("aria-controls");
    expect(panelId).not.toBeNull();
    expect(document.getElementById(panelId as string)).not.toBeNull();
  });
});
