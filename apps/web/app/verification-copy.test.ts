import { describe, expect, it } from "vitest";
import { CONFIRM_WITH_AGENCY } from "@pop-engine/engine";
import { NOT_COVERED_BY_RULESET } from "./verification-copy";

// The defect these guard against actually shipped: COVERAGE_GAP rendered "source not yet
// established", which is RESEARCH_REQUIRED's meaning ("no primary source located in two research
// passes"). Nothing caught it because no test tied the copy to the published legend. These do.
describe("COVERAGE_GAP copy against the published legend", () => {
  it("states what the ruleset does not cover, not what a source does not do", () => {
    expect(NOT_COVERED_BY_RULESET).toContain("Not covered by this ruleset version");
    // "source" in any form is RESEARCH_REQUIRED's territory. COVERAGE_GAP asserts nothing about
    // sources: rules/nyc-rules.v2.9.json calls it "combination not modeled by this ruleset
    // version; advisory asserts nothing".
    expect(NOT_COVERED_BY_RULESET.toLowerCase()).not.toContain("source");
  });

  it("tells the organizer what the gap means for their plan", () => {
    // A limit the reader cannot act on is not an honest disclosure, so the consequence is stated.
    expect(NOT_COVERED_BY_RULESET).toContain("may be incomplete");
  });

  it("never converges with the RESEARCH_REQUIRED rendering", () => {
    // Two statuses that mean different things must not read the same. Equality is the obvious
    // failure; containment is the one that creeps in when someone reuses a phrase.
    expect(NOT_COVERED_BY_RULESET).not.toBe(CONFIRM_WITH_AGENCY);
    expect(NOT_COVERED_BY_RULESET).not.toContain(CONFIRM_WITH_AGENCY);
    expect(CONFIRM_WITH_AGENCY).not.toContain(NOT_COVERED_BY_RULESET);
    expect(NOT_COVERED_BY_RULESET.toLowerCase()).not.toContain("confirm with agency");
  });
});
