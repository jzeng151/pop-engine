// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { DEFAULT_DISPOSITION_BY_RULE_KIND } from "@pop-engine/engine";
import { publishedRulesFileIn } from "../rules-file";
import { InsurancePanel } from "./insurance-panel";
import type { ConsumedFinding } from "./plan-api";

// Component tests for F-205. Regulatory prose in the assertions is read out of the published
// ruleset rather than retyped here, so a rule edit moves the test the same way it moves the
// screen — the discipline `plan-view.test.tsx` and `checklist-fixtures.ts` already hold their own
// fixtures to. Resolved from the repo root, which is vitest's working directory.

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

/** A `ConsumedFinding` built from a published rule's own output, the way `findings.ts` builds one. */
const findingFor = (
  rule: PublishedRule,
  overrides: Partial<ConsumedFinding> = {},
): ConsumedFinding => ({
  ruleIds: [rule.id],
  disposition: DEFAULT_DISPOSITION_BY_RULE_KIND[rule.kind],
  name: rule.output.requirement_name ?? null,
  agency: rule.output.agency ?? null,
  deadline: rule.output.deadline ?? null,
  deadlineDisplay: null,
  latestApplyDate: null,
  applyAfterDate: null,
  deadlineStatus: "not_applicable",
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
  ...overrides,
});

/**
 * A finding none of the three insurance rules produce, standing in for "other findings are on the
 * plan while insurance is silent" — Scenario D's block party without a ride, and the Scenario A
 * street-to-private-venue rescope, are both "insurance's trigger did not fire", not "the plan is
 * empty".
 */
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
    // OPEN-QUESTIONS.md R-8: "$1M + City-as-additional-insured + exceptions are source-confirmed;
    // exact certificate wording per class is not." Both halves are the rule's own published notes.
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

/**
 * #252 review: THE CARD IS SELECTED BY RULE AND WAS RENDERED FROM THE LINE.
 *
 * The panel picks a finding because ANY of its rule ids is an insurance id, and a merged group can
 * hold an insurance rule beside a permit that BINDS — in which case every scalar on the line is the
 * permit's. The card then showed the permit's name, agency, disposition and deadline as the
 * insurance card, with the insurance checklist link beside it.
 */
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

  it("renders the insurance route's own notes, not the group's", () => {
    const merged: ConsumedFinding = {
      ...findingFor(STREET_INSURANCE),
      ruleIds: ["SAPO-STREET-MEDIUM-001", "SAPO-INSURANCE-001"],
      name: bindingRoute.name,
      agency: bindingRoute.agency,
      disposition: bindingRoute.disposition,
      deadline: null,
      // What the merge produces: every contributing rule's notes, concatenated.
      notes: ["the permit's own note", "the insurance rule's own note"],
      headlineMode: "applies_together",
      routes: [
        { ...bindingRoute, notes: ["the permit's own note"] },
        { ...insuranceRoute, notes: ["the insurance rule's own note"] },
      ],
    };

    render(<InsurancePanel findings={[merged]} eventId="event-1" />);

    const card = screen.getByRole("article");
    expect(card.textContent).toContain("the insurance rule's own note");
    // The sibling's published qualification is not attributed to the insurance rule.
    expect(card.textContent).not.toContain("the permit's own note");
  });

  it("renders the insurance rule's own name, agency and disposition, not the binding route's", () => {
    const merged: ConsumedFinding = {
      ...findingFor(STREET_INSURANCE),
      ruleIds: ["SAPO-STREET-MEDIUM-001", "SAPO-INSURANCE-001"],
      // The line reads as its binding route, which is the permit.
      name: bindingRoute.name,
      agency: bindingRoute.agency,
      disposition: bindingRoute.disposition,
      deadline: null,
      noteText: "the permit's own published note",
      headlineMode: "applies_together",
      routes: [bindingRoute, insuranceRoute],
    };

    render(<InsurancePanel findings={[merged]} eventId="event-1" />);

    const card = screen.getByRole("article");
    expect(within(card).getByRole("heading").textContent).toBe("Street event insurance");
    expect(card.textContent).toContain("SAPO (CECM)");
    expect(card.textContent).toContain("required");
    // The binding route's values are not on the insurance card at all.
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

    // Correct absence, not an empty state: no section, no "no insurance required" affirmation.
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
    // An unknown-triggered SAPO-INSURANCE-001 (e.g. sapo_event_type unanswered) renders
    // `disposition: may_be_required` (UNKNOWN_TRIGGER_DISPOSITION), not `required` — but it is
    // still a kind: insurance finding with a trackable checklist row underneath it, so the link
    // must not depend on disposition the way the warning styling does.
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
    // AC 5 requires that removing this feature lose ONLY the dedicated card: this component must
    // not become the only place a field renders. Sources/citations stay PlanLine's.
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
    // 50 RCNY §1-08(b): block parties are exempt from the baseline requirement. The exemption is
    // encoded upstream by SAPO-INSURANCE-001 simply not triggering, so the findings list this
    // scenario's plan carries has no insurance rule id in it at all.
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
    // The rescope drops SAPO and insurance findings together (test-scenario-answer-key.md,
    // Scenario A rescope (c)); DOHMH findings remain. Modeled here as the same "not in the
    // findings list" fact the engine produces post-rescope.
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
