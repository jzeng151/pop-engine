// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { DEFAULT_DISPOSITION_BY_RULE_KIND } from "@pop-engine/engine";
import { publishedRulesFileIn } from "../_lib/rules-file";
import { InsurancePanel } from "./insurance-panel";
import type { ConsumedFinding } from "./plan-api";

type PublishedRule = {
  id: string;
  kind: keyof typeof DEFAULT_DISPOSITION_BY_RULE_KIND;
  output: {
    requirement_name?: string;
    note_text?: string;
    notes?: string[];
    agency?: string;
    deadline?: { type: string };
  };
};

const publishedRuleset: { rules: PublishedRule[] } = JSON.parse(
  readFileSync(resolve(publishedRulesFileIn("rules")), "utf8"),
);

const publishedRule = (id: string): PublishedRule => {
  const rule = publishedRuleset.rules.find((candidate) => candidate.id === id);
  if (rule === undefined) throw new Error(`ruleset has no rule ${id}`);
  return rule;
};

const STREET_INSURANCE = publishedRule("SAPO-INSURANCE-001");
const BLOCK_PARTY_RIDE_INSURANCE = publishedRule("SAPO-INSURANCE-BLOCK-PARTY-RIDE-001");
const PARKS_NOTE = publishedRule("PARKS-INSURANCE-NOTE-001");

const streetInsuranceName = STREET_INSURANCE.output.requirement_name;
const blockPartyRideName = BLOCK_PARTY_RIDE_INSURANCE.output.requirement_name;
const parksNoteText = PARKS_NOTE.output.note_text;
if (streetInsuranceName === undefined || blockPartyRideName === undefined) {
  throw new Error("fixture rules must publish a requirement_name");
}
if (parksNoteText === undefined) {
  throw new Error("fixture rule must publish a note_text");
}

const findingFor = (
  rule: PublishedRule,
  overrides: Record<string, unknown> = {},
): ConsumedFinding =>
  ({
    ruleIds: [rule.id],
    disposition: DEFAULT_DISPOSITION_BY_RULE_KIND[rule.kind],
    name: rule.output.requirement_name ?? null,
    agency: rule.output.agency ?? null,
    deadline: rule.output.deadline ?? null,
    deadlineDisplay: null,
    latestApplyDate: null,
    applyAfterDate: null,
    deadlineStatus: "not_applicable",
    slackDays: null,
    feeDisplay: null,
    portalName: null,
    portalUrl: null,
    portalInstructions: null,
    notes: rule.output.notes ?? [],
    noteText: rule.output.note_text ?? null,
    deadlineUnknownFields: [],
    timelineUnresolvedReason: null,
    conflictText: null,
    sources: [],
    verificationStatus: "SOURCE_CONFIRMED",
    lastVerifiedDate: null,
    routes: null,
    headlineMode: null,
    headlineRouteId: null,
    legacyMerged: false,
    ...overrides,
  }) as ConsumedFinding;

const nonInsuranceFinding = (ruleId: string, name: string): ConsumedFinding => ({
  ruleIds: [ruleId],
  disposition: "required",
  name,
  agency: "NYPD",
  deadline: null,
  deadlineDisplay: null,
  latestApplyDate: null,
  applyAfterDate: null,
  deadlineStatus: "on_track",
  feeDisplay: null,
  portalName: null,
  portalUrl: null,
  portalInstructions: null,
  notes: [],
  noteText: null,
  deadlineUnknownFields: [],
  timelineUnresolvedReason: null,
  conflictText: null,
  sources: [],
  verificationStatus: "SOURCE_CONFIRMED",
  lastVerifiedDate: null,
  routes: null,
  headlineMode: null,
  headlineRouteId: null,
  legacyMerged: false,
});

afterEach(() => {
  cleanup();
});

describe("AC 1: street/plaza events render the SAPO-INSURANCE-001 card", () => {
  it("states the requirement, the before-issuance timing, and both published notes", () => {
    render(<InsurancePanel findings={[findingFor(STREET_INSURANCE)]} eventId="event-1" />);
    const card = screen.getByRole("article", { name: streetInsuranceName });

    expect(card.className).toContain("insurance__card--required");
    expect(card.textContent).toContain("before issuance");
    const notes = STREET_INSURANCE.output.notes ?? [];
    expect(notes.length).toBeGreaterThan(0);
    for (const note of notes) {
      expect(card.textContent).toContain(note);
    }
  });

  it("states the exceptions and the R-8 certificate-wording caveat, not just the headline figure", () => {
    render(<InsurancePanel findings={[findingFor(STREET_INSURANCE)]} eventId="event-1" />);
    const card = screen.getByRole("article", { name: streetInsuranceName });

    expect(card.textContent).toMatch(/block part(y|ies)/i);
    expect(card.textContent).toMatch(/certificate-holder wording/i);
  });
});

describe("AC 2: Parks events render PARKS-INSURANCE-NOTE-001 as informational", () => {
  it("states the borough-office note", () => {
    render(<InsurancePanel findings={[findingFor(PARKS_NOTE)]} eventId="event-1" />);

    expect(screen.getByText(parksNoteText)).toBeTruthy();
  });

  it("is never styled as a hard requirement, and carries the engine's own informational disposition", () => {
    render(<InsurancePanel findings={[findingFor(PARKS_NOTE)]} eventId="event-1" />);
    const card = screen.getByText(parksNoteText).closest("article");
    expect(card).not.toBeNull();

    expect(card?.className).not.toContain("required");
    expect(within(card as HTMLElement).getByText("no new requirement")).toBeTruthy();
  });

  it("offers no checklist link — nothing is filed for a read-only context row", () => {
    render(<InsurancePanel findings={[findingFor(PARKS_NOTE)]} eventId="event-1" />);
    const card = screen.getByText(parksNoteText).closest("article") as HTMLElement;

    expect(within(card).queryByRole("link")).toBeNull();
  });
});

describe("an insurance rule merged onto a line another route binds (#252)", () => {
  const insuranceRoute = {
    ruleId: "SAPO-INSURANCE-001",
    triggerResult: "true" as const,
    disposition: "required" as const,
    unknownFields: [],
    name: "Street event insurance",
    agency: "SAPO (CECM)",
    deadline: { type: "before_issuance" },
    deadlineDisplay: null,
    latestApplyDate: null,
    applyAfterDate: null,
    deadlineStatus: "not_applicable" as const,
    slackDays: null,
    feeDisplay: null,
    portalName: null,
    portalUrl: null,
    portalInstructions: null,
  };
  const bindingRoute = {
    ...insuranceRoute,
    ruleId: "SAPO-STREET-MEDIUM-001",
    name: "Street Activity Permit — Medium",
    agency: "NYC DOT",
    disposition: "may_be_required" as const,
    deadline: null,
  };

  const mergedFinding = (overrides: Record<string, unknown> = {}): ConsumedFinding => {
    const scalar = findingFor(STREET_INSURANCE);
    const {
      name: _name,
      agency: _agency,
      deadline: _deadline,
      deadlineDisplay: _deadlineDisplay,
      latestApplyDate: _latestApplyDate,
      applyAfterDate: _applyAfterDate,
      deadlineStatus: _deadlineStatus,
      feeDisplay: _feeDisplay,
      portalName: _portalName,
      portalUrl: _portalUrl,
      portalInstructions: _portalInstructions,
      ...common
    } = scalar;
    return {
      ...common,
      ruleIds: [bindingRoute.ruleId, insuranceRoute.ruleId],
      disposition: bindingRoute.disposition,
      routes: [bindingRoute, insuranceRoute],
      headlineMode: "applies_together",
      headlineRouteId: bindingRoute.ruleId,
      legacyMerged: false,
      ...overrides,
    } as ConsumedFinding;
  };

  it("renders the insurance route's own notes, not the group's", () => {
    const merged = mergedFinding({
      notes: ["the permit's own note", "the insurance rule's own note"],
      routes: [
        { ...bindingRoute, notes: ["the permit's own note"] },
        { ...insuranceRoute, notes: ["the insurance rule's own note"] },
      ],
    });

    render(<InsurancePanel findings={[merged]} eventId="event-1" />);

    const card = screen.getByRole("article");
    expect(card.textContent).toContain("the insurance rule's own note");
    expect(card.textContent).not.toContain("the permit's own note");
  });

  it("renders the insurance rule's own name, agency and disposition, not the binding route's", () => {
    const merged = mergedFinding({
      noteText: "the permit's own published note",
      routes: [bindingRoute, insuranceRoute],
    });

    render(<InsurancePanel findings={[merged]} eventId="event-1" />);

    const card = screen.getByRole("article");
    expect(within(card).getByRole("heading").textContent).toBe("Street event insurance");
    expect(card.textContent).toContain("SAPO (CECM)");
    expect(card.textContent).toContain("required");
    expect(card.textContent).not.toContain("Street Activity Permit");
    expect(card.textContent).not.toContain("NYC DOT");
    expect(card.textContent).not.toContain("the permit's own published note");
  });
});

describe("AC 3: private-venue events render no insurance card", () => {
  it("renders nothing when no insurance rule triggered, even alongside other findings", () => {
    const { container } = render(
      <InsurancePanel
        findings={[nonInsuranceFinding("ADV-VENUE-OCCUPANCY-001", "Venue occupancy advisory")]}
        eventId="event-1"
      />,
    );

    expect(container.firstChild).toBeNull();
  });

  it("renders nothing for a plan with no findings at all", () => {
    const { container } = render(<InsurancePanel findings={[]} eventId="event-1" />);
    expect(container.firstChild).toBeNull();
  });
});

describe("AC 4: the card links to the checklist item", () => {
  it("links a required card to /events/:id/checklist so the certificate lives with the requirement", () => {
    render(<InsurancePanel findings={[findingFor(STREET_INSURANCE)]} eventId="event-42" />);
    const card = screen.getByRole("article", { name: streetInsuranceName });
    const link = within(card).getByRole("link");

    expect(link.getAttribute("href")).toBe("/events/event-42/checklist");
  });

  it("still links a may_be_required card (unknown event type) — the checklist row exists either way", () => {
    const finding = findingFor(STREET_INSURANCE, { disposition: "may_be_required" });
    render(<InsurancePanel findings={[finding]} eventId="event-42" />);
    const card = screen.getByRole("article", { name: streetInsuranceName });

    expect(card.className).not.toContain("required");
    expect(within(card).getByText("may be required")).toBeTruthy();
    const link = within(card).getByRole("link");
    expect(link.getAttribute("href")).toBe("/events/event-42/checklist");
  });
});

describe("AC 5: this is an addition, not a replacement", () => {
  it("never renders line-item content (citations) the plan's own line owns", () => {
    const finding = findingFor(STREET_INSURANCE, {
      sources: [
        {
          ruleId: STREET_INSURANCE.id,
          citation: "50 RCNY §1-08(b)",
          urls: ["https://example.gov"],
        },
      ],
    });
    render(<InsurancePanel findings={[finding]} eventId="event-1" />);
    const card = screen.getByRole("article", { name: streetInsuranceName });

    expect(within(card).queryByText("50 RCNY §1-08(b)")).toBeNull();
  });
});

describe("Edge cases", () => {
  it("Scenario D — block party without a ride: no card at all", () => {
    const { container } = render(
      <InsurancePanel
        findings={[
          nonInsuranceFinding("SAPO-BLOCK-PARTY-001", "Block Party Permit"),
          nonInsuranceFinding("NYPD-SOUND-001", "Sound Device Permit"),
        ]}
        eventId="event-1"
      />,
    );

    expect(container.firstChild).toBeNull();
  });

  it("block party WITH a ride: the block-party-ride card appears, plus the DOB inspection-certificate note", () => {
    render(
      <InsurancePanel
        findings={[
          nonInsuranceFinding("SAPO-BLOCK-PARTY-001", "Block Party Permit"),
          findingFor(BLOCK_PARTY_RIDE_INSURANCE),
        ]}
        eventId="event-7"
      />,
    );
    const card = screen.getByRole("article", { name: blockPartyRideName });

    expect(card.className).toContain("insurance__card--required");
    expect(card.textContent).toMatch(/DOB inspection certificate/i);
    expect(within(card).getByRole("link").getAttribute("href")).toBe("/events/event-7/checklist");
  });

  it("Scenario A rescoped street to private venue: the card disappears with the insurance finding", () => {
    const { container } = render(
      <InsurancePanel
        findings={[
          nonInsuranceFinding("DOHMH-ORGANIZER-NOTIFY-001", "DOHMH organizer notification"),
        ]}
        eventId="event-1"
      />,
    );

    expect(container.firstChild).toBeNull();
  });
});
