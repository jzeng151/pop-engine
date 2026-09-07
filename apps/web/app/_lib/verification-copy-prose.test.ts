import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { NOT_COVERED_BY_RULESET } from "./verification-copy";

// Partial prose guard for the COVERAGE_GAP clauses in these four meaning artifacts and the
// shared UI copy. It detects the listed source-absence phrases, not arbitrary semantic drift.
// Runtime rendering tests cover the distinction from RESEARCH_REQUIRED. Other prose is outside
// this guard: comments, research, and unrelated source discussions may use these words.
const MEANING_ARTIFACTS = [
  "docs/PRD.md",
  "docs/DESIGN.md",
  "specs/F-201-permit-plan-generator.md",
  "specs/F-206-rules-snapshot-banner.md",
] as const;

const REQUIRED = /\bnot (?:covered|modeled|modelled) by this ruleset version\b/i;
const SOURCE_ABSENCE =
  /\b(?:source (?:is |was )?not (?:yet )?(?:established|published|located|available|identified)|no source)\b/i;

describe("COVERAGE_GAP definition clauses", () => {
  it.each(MEANING_ARTIFACTS)("%s retains the published meaning", (file) => {
    const clauses = readFileSync(resolve(file), "utf8")
      .split(/\n\s*\n/)
      .filter(
        (paragraph) => !paragraph.includes("**Status:**") && paragraph.includes("COVERAGE_GAP"),
      )
      .map((paragraph) => paragraph.replace(/[-_\s]+/g, " "));

    expect(clauses.some((clause) => REQUIRED.test(clause))).toBe(true);
    for (const clause of clauses) expect(clause).not.toMatch(SOURCE_ABSENCE);
  });

  it("keeps shared UI copy about ruleset coverage and possible plan incompleteness", () => {
    expect(NOT_COVERED_BY_RULESET).toMatch(REQUIRED);
    expect(NOT_COVERED_BY_RULESET).toContain("may be incomplete");
    expect(NOT_COVERED_BY_RULESET).not.toMatch(SOURCE_ABSENCE);
  });
});
