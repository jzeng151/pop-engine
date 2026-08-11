import { describe, expect, it } from "vitest";
import { CONFIRM_WITH_AGENCY } from "@pop-engine/engine";
import { NOT_COVERED_BY_RULESET } from "./verification-copy";

describe("COVERAGE_GAP copy against the published legend", () => {
  it("states what the ruleset does not cover, not what a source does not do", () => {
    expect(NOT_COVERED_BY_RULESET).toContain("Not covered by this ruleset version");

    expect(NOT_COVERED_BY_RULESET.toLowerCase()).not.toContain("source");
  });

  it("tells the organizer what the gap means for their plan", () => {
    expect(NOT_COVERED_BY_RULESET).toContain("may be incomplete");
  });

  it("never converges with the RESEARCH_REQUIRED rendering", () => {
    expect(NOT_COVERED_BY_RULESET).not.toBe(CONFIRM_WITH_AGENCY);
    expect(NOT_COVERED_BY_RULESET).not.toContain(CONFIRM_WITH_AGENCY);
    expect(CONFIRM_WITH_AGENCY).not.toContain(NOT_COVERED_BY_RULESET);
    expect(NOT_COVERED_BY_RULESET.toLowerCase()).not.toContain("confirm with agency");
  });
});
