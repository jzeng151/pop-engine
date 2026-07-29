import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path) => readFileSync(resolve(repoRoot, path), "utf8");

describe("PR 134 SPEC-CONFLICT reconciliations", () => {
  it("keeps F-405 in Phase 2 with its own runbook assignments and F-213 in Phase 3", () => {
    const roadmap = read("docs/ROADMAP.md");
    const runbook = read("specs/F-405-day-of-runbook.md");
    const f405 = roadmap.indexOf("F-405 · Day-of Runbook");
    const f213 = roadmap.indexOf("F-213 · Team Task Assignment");
    const phase3 = roadmap.indexOf("## Phase 3");

    expect(f405).toBeGreaterThanOrEqual(0);
    expect(f213).toBeGreaterThanOrEqual(0);
    expect(phase3).toBeGreaterThanOrEqual(0);
    expect(f405).toBeLessThan(phase3);
    expect(f213).toBeGreaterThan(phase3);
    expect(runbook).toContain("F-405 owns the minimal Phase 2 runbook-assignment source");
    expect(runbook).toContain("F-213 remains the Phase 3 general team-task feature");
    expect(runbook).not.toContain("SPEC-CONFLICT #207) blocks approval");
  });

  it("keeps F-103 and F-502 on the same permit-burden/v1 definition", () => {
    const comparator = read("specs/F-103-scope-comparator.md");
    const historical = read("specs/F-502-historical-event-comparison.md");

    expect(comparator).toContain("### Shared permit-burden/v1 definition");
    expect(comparator).toContain("`{ definite, unresolved }`");
    expect(comparator).toContain("Count each final deduplicated finding once");
    expect(comparator).toContain("material unknown that can change the finding set");
    expect(historical).toContain("consumes F-103's exact shared `permit-burden/v1`");
    expect(historical).not.toContain("Permit burden remains unavailable until SPEC-CONFLICT #208");
  });
});
