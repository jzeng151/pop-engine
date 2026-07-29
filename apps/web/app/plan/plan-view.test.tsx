// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CONFIRM_WITH_AGENCY, type Finding } from "@pop-engine/engine";
import { publishedRulesFileIn } from "../rules-file";
import PlanPage from "../events/[id]/plan/page";
import { PlanView } from "./plan-view";
import { SnapshotBanner, compareToPinned, formatSnapshotDate } from "./snapshot-banner";
import { verdictCopy } from "./verdict-copy";
import { NOT_COVERED_BY_RULESET } from "../verification-copy";

// Component tests for F-206. Regulatory prose in the assertions is read out of the published
// ruleset rather than retyped here, so a rule edit moves the test the same way it moves the
// screen. Resolved from the repo root, which is vitest's working directory.
const publishedRuleset: {
  ruleset_version: string;
  snapshot_date: string;
  rules: {
    id: string;
    output: {
      permit_name?: string;
      note_text?: string;
      portal?: { name?: string; url?: string | null; instructions?: string };
      [key: string]: unknown;
    };
    source?: { citation: string; urls: string[] };
    verification: { status: string; qualification?: string };
  }[];
} = JSON.parse(readFileSync(resolve(publishedRulesFileIn("rules")), "utf8"));

const publishedRule = (id: string) => {
  const rule = publishedRuleset.rules.find((candidate) => candidate.id === id);
  if (rule === undefined) throw new Error(`ruleset has no rule ${id}`);
  return rule;
};

/** The exactly-20 conflict: two official readings, three pages between them. */
const CONFLICT_RULE = publishedRule("PARKS-EVENT-EXACTLY-20-001");

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

/**
 * Answers all three calls the page makes, the way the api does: the plan, the rules meta, and the
 * event whose revision says whether the plan is still current. The event defaults to the revision
 * the plan pinned, so nothing reads as stale unless a test says so.
 */
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

const renderPlan = () =>
  render(<PlanView apiBaseUrl="https://api.example.com" eventId="event-1" />);

beforeEach(() => {
  stubApi(plan());
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
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
    // A snapshot date is published-on, not all-facts-verified-on. Each line's own verification
    // status is what carries that claim, and this wording has been wrong once already.
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
    // Parsing "2026-07-25" as local midnight would render July 24 anywhere west of Greenwich.
    expect(formatSnapshotDate("2026-07-25")).toBe("July 25, 2026");
    expect(formatSnapshotDate("2026-01-01")).toBe("January 1, 2026");
    expect(formatSnapshotDate("not-a-date")).toBe("not-a-date");
  });
});

describe("a plan pinned to an older ruleset (AC 4)", () => {
  /** A pinned pair from an older ruleset, both values unlike anything the live file carries. */
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
    // The pinned version and the pinned date travel together. Reading the date off the live file
    // would render a version-and-date pair that never existed on any artifact.
    stubApi(plan(PINNED));
    renderPlan();
    const banner = await screen.findByRole("complementary", { name: "Rules snapshot" });

    expect(banner.textContent).toContain("published March 2, 2026");
    expect(banner.textContent).not.toContain(formatSnapshotDate(publishedRuleset.snapshot_date));
  });

  it("states the pinned pair even when the live ruleset cannot be read", async () => {
    // /api/rules/meta answers one question — whether a newer ruleset exists. Losing it costs the
    // comparison, not the banner: both values the banner states come from the plan.
    stubApi(plan(PINNED), {}, 200, 503);
    renderPlan();
    const banner = await screen.findByRole("complementary", { name: "Rules snapshot" });

    expect(banner.textContent).toContain("Rules snapshot nyc.v2.1");
    expect(banner.textContent).toContain("published March 2, 2026");
    expect(banner.textContent).not.toContain("newer ruleset");
  });

  it("never asks the live file for a date, even when the versions agree", async () => {
    // The version matching is not licence to read the live file's date: two artifacts can share a
    // version string, and only the plan's row witnesses which date its evaluation ran against.
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
    // A null snapshot_date is not an invitation to substitute one. The plan does not record which
    // artifact it read, so any date rendered here would assert provenance nothing witnessed.
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
    // A plan body with no `snapshotDate` at all is a plumbing mismatch, and rendering the legacy
    // sentence for it would state something about the plan that nothing checked.
    const { snapshotDate: _omitted, ...withoutDate } = plan();
    stubApi(withoutDate);
    renderPlan();

    expect(await screen.findByRole("alert")).toBeDefined();
    expect(screen.queryByRole("complementary", { name: "Rules snapshot" })).toBeNull();
    expect(screen.queryByText(/publication date not recorded/)).toBeNull();
  });
});

describe("per-line citations and status (AC 2, AC 3)", () => {
  /**
   * One rendered line, with its detail expanded when it has any.
   *
   * The line is progressively disclosed: the summary carries name, agency, disposition, fee, the
   * deadline, the verification badge and the primary citation, and everything else is one click
   * away. These cases assert that a field RENDERS with the right content, which is unchanged by
   * the split, so the helper opens the panel. The collapsed contract has its own cases below.
   */
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
    // The finding that merged unfixed on #93: a finding with valid ruleIds but a missing or renamed
    // `verificationStatus` reached `VerificationBadge`, which called `.toLowerCase()` on undefined
    // and took the page down — a render failure standing in for the intended error message.
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
    // Visible text, not an attribute a pointer has to hover to reveal.
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

    // Both readings, verbatim from the rule that publishes them.
    expect(line.getByText(String(CONFLICT_RULE.output.note_text))).toBeDefined();
    expect(line.getByText("OFFICIAL CONFLICT")).toBeDefined();
    expect(line.getByText(String(CONFLICT_RULE.source?.citation))).toBeDefined();

    // Every page the two readings rest on is reachable, not just the first.
    const urls = CONFLICT_RULE.source?.urls ?? [];
    expect(urls.length).toBeGreaterThan(1);
    const hrefs = line.getAllByRole("link").map((link) => link.getAttribute("href"));
    expect(hrefs).toEqual(urls);
  });

  it("shows a conflict's text once when the rule publishes it as both note and conflict", async () => {
    // PARKS-EVENT-EXACTLY-20-001 publishes one string that is both its note and its conflict
    // reading; rendering it twice would read as two separate official statements.
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
    // F-206's Edge Cases pair the fallback above with "log loudly". Every rule in the published
    // ruleset carries at least one URL on its source, so reaching this means a stored plan has lost
    // its click-through — and a plan row is immutable with nothing re-deriving it, so the log is the
    // only way an operator learns of it.
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const line = await lineFor(
        finding({
          sources: [
            { ruleId: "PARKS-EVENT-001", citation: "Parks borough office, by phone", urls: [] },
          ],
        }),
      );

      // Awaited, not asserted directly: the log fires from an effect, so it is not guaranteed to
      // have run by the time the article is queryable. Asserting it synchronously passed locally
      // and failed in CI, where coverage instrumentation moves the flush — a race in the test, not
      // in the component.
      await waitFor(() =>
        expect(logged).toHaveBeenCalledWith(
          expect.stringContaining("no source URL"),
          expect.objectContaining({
            ruleId: "PARKS-EVENT-001",
            citation: "Parks borough office, by phone",
          }),
        ),
      );
      // The organizer is not told: they can do nothing with it, and the citation is still correct.
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
    // ADV-ALCOHOL-PUBLIC-001 is a COVERAGE_GAP advisory: it asserts nothing and cites nothing.
    const line = await lineFor(
      finding({
        ruleIds: ["ADV-ALCOHOL-PUBLIC-001"],
        kind: "advisory",
        disposition: "advisory",
        agency: null,
        sources: [],
        verificationStatus: "COVERAGE_GAP",
      }),
    );

    expect(line.queryAllByRole("link")).toEqual([]);
    expect(line.getByText("COVERAGE GAP")).toBeDefined();
    expect(line.getByText(NOT_COVERED_BY_RULESET)).toBeDefined();
  });

  it("omits the agency label on findings that publish no agency", async () => {
    const withAgency = await lineFor(finding({ agency: "NYC Parks" }));
    expect(withAgency.getByText("NYC Parks")).toBeDefined();
    cleanup();

    const line = await lineFor(finding({ agency: null, name: "Insurance determined at review" }));
    expect(line.queryByText("NYC Parks")).toBeNull();
    // The line still reads as a complete row rather than showing an empty label.
    expect(line.getByRole("heading").textContent).toBe("Insurance determined at review");
  });

  it("renders the filing route for a rule that publishes instructions instead of a URL", async () => {
    // NYPD-SOUND-001 publishes the precinct and form PD 656-041A and no portal URL; that text is
    // the entire filing route for the line (F-204 AC 1).
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

    // A portal named but not yet resolved to a URL renders as text rather than a dead link.
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
    // PARKS-INSURANCE-NOTE-001's whole content is its note text: dropping it would leave the line
    // asserting a requirement the rule explicitly says is not automatic.
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

describe("the plan route", () => {
  it("renders the plan for the event in the path", async () => {
    stubApi(plan());
    vi.stubEnv("NEXT_PUBLIC_API_BASE_URL", "https://api.example.com");
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
    // Nothing to assert on screen: the point is that the late answer updates no state and the
    // test does not blow up on an unmounted component.
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
  /**
   * One rendered line, with its detail expanded when it has any.
   *
   * The line is progressively disclosed: the summary carries name, agency, disposition, fee, the
   * deadline, the verification badge and the primary citation, and everything else is one click
   * away. These cases assert that a field RENDERS with the right content, which is unchanged by
   * the split, so the helper opens the panel. The collapsed contract has its own cases below.
   */
  const lineFor = async (only: Finding) => {
    stubApi(plan({ findings: [only] }));
    renderPlan();
    const line = within(await screen.findByRole("article"));
    const toggle = line.queryByRole("button", { name: /^Details for/ });
    if (toggle !== null) await userEvent.click(toggle);
    return line;
  };

  it("shows the demo anchor's apply-by date and missed status with no display text", async () => {
    // SAPO-STREET-LARGE-001 publishes no `deadline.display`, and it is Scenario A's blocking
    // finding. Gating the block on that prose hid the two facts the line exists to state.
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
    // NYPD-SOUND-PARKS-DEP-001 carries verification.qualification "sequencing detail
    // RESEARCH_REQUIRED", and the engine dates this from the upstream processing range precisely
    // because a strict issued-before-filed order is not confirmed. "Not before" would assert the
    // sequencing the verification owner declined to assert, one layer above the engine that
    // deliberately stopped short of it.
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

    // No wording anywhere on the line may read as a prohibition on filing earlier.
    const rendered = line.getByRole("heading").closest("article")?.textContent ?? "";
    expect(rendered).not.toMatch(/not before/i);
    expect(rendered).not.toMatch(/cannot be filed/i);
    expect(rendered).not.toMatch(/must not/i);

    // The published caveat is on the line in the words the verification owner approved, not a
    // paraphrase, so the uncertainty travels with the date.
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
    // The bare enum token would read as a claim about legality rather than a filing window.
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
    // F-102's verdict table: "threshold labeled as PopEngine's internal planning buffer, never an
    // official threshold", and the ruleset's own config note says the UI must label it. An
    // organizer reading "apply within 10 days" with the explanation only in a source comment has
    // been handed what looks like an agency filing deadline.
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
    // The label qualifies the at-risk countdown. Attaching it to "On track" would explain a
    // threshold that verdict never states.
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

  it("names the blocking finding and lists each re-evaluated rescope for INFEASIBLE", async () => {
    stubApi(
      plan({
        verdict: "INFEASIBLE",
        verdictDetail: {
          ...emptyVerdictDetail,
          blockingFinding: {
            ruleIds: ["SAPO-STREET-LARGE-001"],
            name: "Street Activity Permit — Large",
          },
          missedRuleIds: ["SAPO-STREET-LARGE-001"],
          rescopeSuggestions: [
            {
              change: { field: "location_type", value: "private_venue" },
              reevaluatedVerdict: "CONDITIONAL",
              droppedRuleIds: ["SAPO-INSURANCE-001", "SAPO-STREET-LARGE-001"],
              minSlackDays: null,
              atRiskFindingName: null,
            },
            {
              change: { field: "street_event_size", value: "medium" },
              reevaluatedVerdict: "FEASIBLE_AT_RISK",
              droppedRuleIds: ["SAPO-STREET-LARGE-001"],
              minSlackDays: 5,
              atRiskFindingName: "Street Activity Permit — Medium",
            },
            {
              change: { field: "street_event_size", value: "small" },
              reevaluatedVerdict: "FEASIBLE_AT_RISK",
              droppedRuleIds: ["SAPO-STREET-LARGE-001"],
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
    expect(screen.getByTestId("rescope-ladder")).toBeDefined();
    const suggestions = screen.getAllByTestId("rescope-suggestion");
    expect(suggestions).toHaveLength(3);
    // AC 7 ladder order even when the wire arrives in field-discovery order.
    expect(suggestions[0]?.textContent).toContain("medium");
    expect(suggestions[0]?.textContent).toContain("At risk — apply within 5 days");
    expect(suggestions[0]?.textContent).toContain("on Street Activity Permit — Medium");
    expect(suggestions[1]?.textContent).toContain("small");
    expect(suggestions[2]?.textContent).toContain("private venue");
    expect(screen.getByTestId("rescope-at-risk-buffer").textContent).toContain(
      "PopEngine's internal planning buffer",
    );
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
    expect(section.textContent).toContain("past only if the requirement applies");
    expect(section.textContent).toContain("may-be-required");
    expect(section.textContent).toContain("keeps the verdict conditional");
    expect(section.textContent).toContain("DOHMH-ORGANIZER-NOTIFY-001");
    expect(section.textContent).toContain("Organizer notification to DOHMH");
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

    // The second event's plan request never settles: the first event's plan must not be sitting
    // on screen underneath it.
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

    // The failure renders alongside the missing-plan message rather than replacing it.
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
            // The meta call hangs; the plan call answers normally.
            if (!url.endsWith("/rules/meta")) resolvePromise(jsonResponse(200, plan()));
          }),
      ),
    );
    renderPlan();

    // The banner states the pinned pair off the plan, so a hanging meta call costs it nothing but
    // the comparison: it simply says nothing about a newer ruleset until the metadata arrives.
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
    // F-102's verdict card will call this without a plan in hand.
    expect(verdictCopy("INFEASIBLE")).toBe("Published deadline missed as scoped");
    expect(verdictCopy("FEASIBLE")).toBe("On track");
    expect(verdictCopy("CONDITIONAL")).toBe("Depends on");
    expect(verdictCopy("FEASIBLE_AT_RISK")).toBe("At risk");
  });
});

describe("a generated plan whose own response cannot be read", () => {
  /**
   * The generation POST answers with the plan it stored, and that is what the page installs. The
   * only case left needing a re-read is a POST that succeeded with a body this page cannot read: a
   * plan row was still written, so reporting a failure would misstate what happened and POSTing
   * again would write a second immutable row for one organizer action.
   */
  const stubUnreadableGeneration = (reread: () => Response) => {
    let generated = false;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.endsWith("/rules/meta")) return jsonResponse(200, liveMeta);
        if (url.endsWith("/plan")) {
          if (init?.method === "POST") {
            generated = true;
            // 201, so a plan was written — but the body omits `generatedAt`, which the page reads
            // unconditionally, so it cannot be rendered.
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
    // The POST answers with the complete plan it stored. Re-reading made the plan the organizer had
    // just created conditional on a second request: a slow one left the old plan on screen, and a
    // failed one replaced it with "could not be read" for a plan that exists — and in that state the
    // button disappeared, so there was no way to retry without reloading the page.
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
          // Only the initial load may read; anything after the POST would be the redundant re-read.
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

    // The plan exists and is shown, recovered by the one re-read that is genuinely necessary.
    await waitFor(() =>
      expect(document.querySelector(".plan__verdict")?.textContent).toContain("generated"),
    );
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("reports the failure rather than claiming the plan is there", async () => {
    stubUnreadableGeneration(() => jsonResponse(500, { error: "plan lookup failed" }));
    const user = userEvent.setup();
    renderPlan();

    await user.click(await screen.findByRole("button", { name: "Generate the plan" }));

    await waitFor(() =>
      expect(screen.getAllByRole("alert").map((alert) => alert.textContent)).toContain(
        "The API returned a plan this page cannot read.",
      ),
    );
    // A plan that could not be read is not a plan that is missing, so generating is not offered
    // again — that would write a second plan row for one that already exists.
    expect(screen.queryByRole("button", { name: "Generate the plan" })).toBeNull();
  });
});

describe("a rule whose whole deadline is its type", () => {
  it("states 'before issuance' for a line that publishes no prose and no date", async () => {
    // SAPO-INSURANCE-001 publishes {type: "before_issuance"} and nothing else. Dropping it
    // leaves the line silent about when the insurance actually has to exist.
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

    // F-205 also renders SAPO-INSURANCE-001 as its own dedicated card, so two articles now match
    // this rule id; this test is about the plan LINE (F-206), scoped here by its own class.
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
    // Regenerating onto an older ruleset would rebuild the plan from superseded rules.
    expect(compareToPinned("nyc.v2.2", "nyc.v2.3")).toBe("older");
    expect(compareToPinned("nyc.v2.9", "nyc.v3.0")).toBe("older");
    expect(compareToPinned("nyc.v2.3", "nyc.v2.3")).toBe("same");
  });

  it("orders the minor part as a number, not as text", () => {
    // A string comparison puts v2.10 below v2.9 and would call a newer ruleset older.
    expect(compareToPinned("nyc.v2.10", "nyc.v2.9")).toBe("newer");
    expect(compareToPinned("nyc.v2.9", "nyc.v2.10")).toBe("older");
  });

  it("refuses to claim a direction it cannot derive", () => {
    // `nyc.vMAJOR.MINOR` is the only shape BASELINE declares; anything else is unorderable.
    expect(compareToPinned("nyc-2.3", "nyc.v2.1")).toBe("different");
    expect(compareToPinned("nyc.v2.3", "draft")).toBe("different");
    // Two jurisdictions have no ordering between them at all.
    expect(compareToPinned("bos.v1.0", "nyc.v2.3")).toBe("different");
  });

  it("says the service is on an older ruleset after a rollback, without advising regeneration", async () => {
    // The api is rolled back to v2.2 while a plan pinned to v2.3 is read.
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
  /** A stale plan — the event has been edited — pinned to `pinned`, with the service on `live`. */
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
    // The event has been edited, so staleness would offer the button. Regeneration evaluates the
    // SERVICE's ruleset, so taking that offer would rebuild a v2.3 plan from v2.2 — a silent
    // downgrade of the plan's regulatory basis, dressed as the routine fix for a stale plan.
    stubBehind("nyc.v2.3", "nyc.v2.2");
    renderPlan();

    // The staleness warning still stands: the plan really is stale.
    expect((await screen.findByRole("alert")).textContent).toContain("now at revision 4");
    expect(screen.queryByRole("button", { name: "Regenerate the plan" })).toBeNull();
  });

  it("says it is the service that is behind, naming both versions", async () => {
    stubBehind("nyc.v2.3", "nyc.v2.2");
    renderPlan();
    await screen.findByRole("complementary", { name: "Rules snapshot" });

    // Greying out a button, or dropping it, leaves an organizer to conclude their event is at fault.
    const refused = document.querySelector(".plan__refused");
    expect(refused?.textContent).toContain("generated from ruleset nyc.v2.3");
    expect(refused?.textContent).toContain("service is currently running nyc.v2.2");
    expect(refused?.textContent).toContain("not a problem with your event");
  });

  it("refuses a version it cannot order, for the same reason", async () => {
    // Nothing establishes that regenerating onto an unorderable artifact would not move the plan
    // backwards, and "we cannot tell" is not permission to overwrite a regulatory basis.
    stubBehind("nyc.v2.3", "nyc-hotfix");
    renderPlan();
    await screen.findByRole("complementary", { name: "Rules snapshot" });

    expect(screen.queryByRole("button", { name: "Regenerate the plan" })).toBeNull();
    expect(document.querySelector(".plan__refused")?.textContent).toContain("nyc-hotfix");
  });

  it("refuses when the service's ruleset cannot be read at all", async () => {
    // The claim being made is that the service is at or ahead of the pinned version. An unreadable
    // /api/rules/meta does not establish it, and the cost of waiting is a stale-but-sound plan.
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
    // Nothing is pinned yet, so there is no regulatory basis to downgrade.
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
  /** The event endpoint's answer, which is where the current revision comes from. */
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
    // Same comparison the checklist API refuses on: the event's revision is past the plan's.
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
    // The event sits at revision 3 while the stored plan still pins 1. Generating pins the
    // revision the event is actually on, which is what clears the warning.
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
    // The event could not be read, so silence would read as confirmation that the plan matches.
    stubWithEvent(plan({ eventRevision: 1 }), null);
    renderPlan();

    await screen.findByRole("complementary", { name: "Rules snapshot" });
    expect(screen.getByText(/whether this plan is still current is unconfirmed/)).toBeDefined();
  });

  /**
   * `loadEvent` answers `ok` for any body with a string `id` and casts the rest to `SavedEvent`,
   * which declares `revision_counter: number` without checking it. An unusable revision therefore
   * arrived as a successful load — and `current > pinned` against a non-number is `false`, so an
   * edited plan rendered with NEITHER the stale warning nor the unconfirmed one. Silence, on a
   * regulatory plan whose dates were computed from superseded answers.
   */
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
    // Unconfirmed, not silent. The plan may well be stale and we cannot tell.
    expect(screen.getByText(/whether this plan is still current is unconfirmed/)).toBeDefined();
  });

  it("still compares a revision the event body actually carries", async () => {
    stubEventBody({ id: "event-1", revision_counter: 4 });
    renderPlan();

    expect((await screen.findByRole("alert")).textContent).toContain("now at revision 4");
    expect(screen.queryByText(/unconfirmed/)).toBeNull();
  });

  it("does not claim currency it has not confirmed yet", async () => {
    // The plan and the event are two independent requests. When the plan wins the race, the
    // verdict and deadlines are on screen with the revision check still outstanding — and if the
    // event request never settles after an edit, an outdated regulatory plan sits there looking
    // authoritative. Not-yet-checked has to read as unconfirmed, exactly like could-not-check.
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

    // The plan is fully rendered while the revision check is still in flight.
    await screen.findByRole("complementary", { name: "Rules snapshot" });
    expect(screen.getAllByRole("article").length).toBeGreaterThan(0);
    expect(screen.getByText(/unconfirmed until then/)).toBeDefined();

    // And the caveat comes off only once the check actually answers.
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
    // The mirror image of the finding above, and the same mistake: the event request treated as a
    // gate on the plan rather than a separate fact. The POST has succeeded, so a plan exists on the
    // server — withholding it until an ancillary revision check answers leaves the organizer looking
    // at a button stuck on "Generating plan…" and a plan they cannot reach.
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
        // The initial load answers; the re-read after the generation never settles.
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

    // The new plan is on screen and the button has let go, with the revision check still in flight.
    // Read off the verdict line, which only the installed plan renders — "revision 3" also appears
    // in the staleness warning the old plan was showing.
    await waitFor(() =>
      expect(document.querySelector(".plan__verdict")?.textContent).toContain("revision 3"),
    );
    expect(screen.queryByRole("button", { name: "Generating plan…" })).toBeNull();
    // And currency is not claimed off the revision read before the generation ran.
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
  /** Answers each endpoint from a small script, so a test states exactly what the api did. */
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
    // A 500, an integrity error or an unreachable api all leave no plan on screen, but a plan may
    // well exist — generating would write a second immutable row for one that is merely unread.
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
    // The plan endpoint answers 404 for a missing event as well as a missing plan; only the event
    // itself distinguishes them.
    stubScript({
      plan: () => jsonResponse(404, { error: "event event-1 not found" }),
      event: () => jsonResponse(404, { error: "event not found" }),
    });
    renderPlan();

    expect((await screen.findByRole("alert")).textContent).toBe("event event-1 not found");
    expect(screen.queryByRole("button", { name: /Generate|Regenerate/ })).toBeNull();
  });

  it("shows a regeneration failure while the stale plan is still on screen", async () => {
    // The button re-enabling with no message left the organizer clicking again, and every attempt
    // writes another immutable plan row.
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
    // The plan it failed to replace is still readable, and still marked stale.
    expect(screen.getAllByRole("article").length).toBeGreaterThan(0);
    expect(screen.getByText(/generated for revision 1/)).toBeDefined();
  });

  it("offers the regeneration the banner tells the organizer to perform", async () => {
    // A rules update with no event edit: the banner says a newer ruleset exists, so the page has
    // to offer the action it names. Nothing else on the page would.
    stubScript({
      plan: () => jsonResponse(200, plan({ rulesetVersion: "nyc.v2.1", eventRevision: 1 })),
      meta: () => jsonResponse(200, { ruleset_version: "nyc.v2.3", snapshot_date: "2026-07-25" }),
    });
    renderPlan();

    const banner = await screen.findByRole("complementary", { name: "Rules snapshot" });
    expect(banner.textContent).toContain("regenerate to update");
    expect(screen.getByRole("button", { name: "Regenerate the plan" })).toBeDefined();
    // The event matches its plan, so this is the rules-update case and not the stale one.
    expect(screen.queryByText(/has since been edited/)).toBeNull();
  });

  it("offers nothing when the live ruleset is older or unorderable", async () => {
    // The banner does not tell the organizer to regenerate in either case, so neither should the
    // page: regenerating onto an older ruleset would rebuild the plan from superseded rules.
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
    // The approved boundary fixture: a park event at headcount 19 triggers no rule at all, and
    // F-201 AC 4 makes that result first-class so it is never read as a failed evaluation.
    stubScript({
      plan: () => jsonResponse(200, plan({ verdict: "FEASIBLE", findings: [] })),
    });
    renderPlan();

    expect(
      await screen.findByText("No new city event requirement identified from your answers."),
    ).toBeDefined();
    expect(screen.getByText("On track")).toBeDefined();
    expect(screen.queryAllByRole("article")).toEqual([]);
  });

  it("still lists findings when there are any", async () => {
    stubScript({});
    renderPlan();

    await waitFor(() => expect(screen.getAllByRole("article").length).toBe(1));
    expect(screen.queryByText(/No new city event requirement/)).toBeNull();
  });
});

describe("a regeneration that finishes after the page has moved on", () => {
  it("does not install one event's plan under another event's id", async () => {
    // The effect's guard covers its own requests; this one starts outside it. After the POST for
    // event-1 lands, event-1's plan is readable — so without a guard the follow-up read installs
    // it, and the page is showing event-2.
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
    // Away to another event while event-1's generation is still in flight.
    view.rerender(<PlanView apiBaseUrl="https://api.example.com" eventId="event-2" />);
    await screen.findByRole("button", { name: "Generate the plan" });

    releasePost(jsonResponse(201, plan({ eventId: "event-1", rulesetVersion: "nyc.v2.1" })));
    await new Promise((resolveTimer) => setTimeout(resolveTimer, 50));

    // event-1's plan must not appear under event-2, current or otherwise.
    expect(screen.queryByText(/nyc\.v2\.1/)).toBeNull();
    expect(screen.queryAllByRole("article")).toEqual([]);
    expect(screen.getByRole("button", { name: "Generate the plan" })).toBeDefined();
  });
});

// Progressive disclosure. Nothing was removed from a line; these pin WHICH fields are visible
// before an interaction and which are one interaction away, because that split is the whole
// change and a later edit could quietly move a field across it.
describe("a scannable line (progressive disclosure)", () => {
  const collapsedLine = async (only: Finding) => {
    stubApi(plan({ findings: [only] }));
    renderPlan();
    return within(await screen.findByRole("article"));
  };

  /** Everything the summary carries, on a finding that publishes all of it. */
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

  it("shows exactly the summary fields before the line is expanded", async () => {
    const line = await collapsedLine(full());

    // Present: name, agency, disposition, fee, the deadline and its status, the badge, the
    // primary citation.
    expect(line.getByRole("heading", { name: "Special Event Permit" })).toBeDefined();
    expect(line.getByText("NYC Parks")).toBeDefined();
    expect(line.getByText("required")).toBeDefined();
    expect(line.getByText("$25 processing fee")).toBeDefined();
    expect(line.getByText(/apply by 2026-08-01/)).toBeDefined();
    expect(line.getByText(/on track/)).toBeDefined();
    expect(line.getByText("SOURCE CONFIRMED")).toBeDefined();
    expect(line.getByText("Parks FAQ")).toBeDefined();

    // Absent until expanded, and absent from the DOM rather than merely hidden.
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

    // The summary keeps everything it had: expanding adds, it never moves a field down.
    expect(line.getByText(/apply by 2026-08-01/)).toBeDefined();
    expect(line.getByText("SOURCE CONFIRMED")).toBeDefined();
  });

  it("shows a RESEARCH_REQUIRED line's absent source on the line itself", async () => {
    // The absence IS the information, so it cannot sit behind the expand: an empty citation slot
    // would read as a rendering fault instead of a finding.
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

    // The badge is the scannable signal; the two readings are one interaction away, verbatim.
    expect(line.getByText("OFFICIAL CONFLICT")).toBeDefined();
    expect(line.queryByText(/One source says 90 days/)).toBeNull();

    await userEvent.click(line.getByRole("button", { name: /^Details for/ }));
    expect(line.getByText(/One source says 90 days/)).toBeDefined();
  });

  it("renders a published fee, and nothing at all when none is published", async () => {
    // The line used to say "fee not published" for a null fee. That sentence asserted two things at
    // once — that a price exists, and that its amount was withheld — and a finding carries evidence
    // for neither: `ruleset.ts` collapses an absent `fee` and an explicit `fee: null` to one value,
    // so "this filing has no fee" and "the amount is unpublished" arrive here identical. Deciding it
    // from the finding's KIND only moved the inference up a level, to what OTHER rules of that kind
    // publish, which is a fact about a different filing. SAPO-INSURANCE-BLOCK-PARTY-RIDE-001,
    // PARKS-EVENT-EXACTLY-20-001 and DOB-PROP-TRUSS-001 are all fee-bearing kinds carrying no fee,
    // and all three would have been captioned on that basis alone.
    const published = await collapsedLine(finding({ feeDisplay: "$25 processing fee" }));
    expect(published.getByText("$25 processing fee")).toBeDefined();

    cleanup();
    const absent = await collapsedLine(finding({ feeDisplay: null }));
    expect(absent.queryByText("fee not published")).toBeNull();
    // No blank row standing where the amount would be: the row is not rendered at all.
    expect(document.querySelector(".line__fee")).toBeNull();
    expect(absent.queryByText("$0")).toBeNull();
  });

  /** Scenario B's DOHMH-EXEMPTION-001: one source, and none of the optional detail fields. */
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
    // F-201 AC 1: every finding references its rule ID. The rule ids render inside the panel, so
    // gating the panel on the OPTIONAL fields took them off the page entirely for this shape —
    // not hidden behind an expand, absent, with no control to reveal them.
    const line = await collapsedLine(bareFinding());

    const toggle = line.getByRole("button", {
      name: "Details for Temporary food service exemption",
    });
    await userEvent.click(toggle);
    expect(line.getByText("DOHMH-EXEMPTION-001")).toBeDefined();
  });

  it("offers the expand on every finding shape, so no panel field can vanish with the panel", async () => {
    // The general form of the case above: the panel is unconditional, so a finding shape can never
    // drop a field that was moved into it. Asserted on the emptiest shape the plan produces.
    for (const shape of [bareFinding(), finding({ sources: [] }), full()]) {
      cleanup();
      const line = await collapsedLine(shape);
      expect(line.queryByRole("button", { name: /^Details for/ })).not.toBeNull();
    }
  });

  it("reports a URL-less source that is behind the expand, without anyone expanding it", async () => {
    // The log is how an operator learns a stored plan has lost its click-through, and a plan row is
    // immutable, so nothing else reports it. A source past the first renders inside the panel, and
    // the panel is UNMOUNTED while collapsed: while the check lived inside the citation it ran only
    // if someone happened to expand that one line. The existing case above covers a url-less
    // PRIMARY source, which stays mounted, and passes either way.
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

      // Still collapsed, and the second citation is genuinely absent rather than hidden.
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

    // Reachable by Tab, and the state is on the control rather than in a colour or a glyph.
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    await userEvent.tab();
    while (document.activeElement !== toggle) await userEvent.tab();

    await userEvent.keyboard("{Enter}");
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(line.getByText("last verified 2026-07-18")).toBeDefined();

    await userEvent.keyboard(" ");
    expect(toggle.getAttribute("aria-expanded")).toBe("false");

    // The control points at the region it opens, so assistive technology can follow it.
    await userEvent.keyboard("{Enter}");
    const panelId = toggle.getAttribute("aria-controls");
    expect(panelId).not.toBeNull();
    expect(document.getElementById(panelId as string)).not.toBeNull();
  });
});
