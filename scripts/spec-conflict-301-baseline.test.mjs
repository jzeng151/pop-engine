import { readFileSync } from "node:fs";
import { URL } from "node:url";
import { describe, expect, it } from "vitest";

const baseline = readFileSync(new URL("../docs/BASELINE.md", import.meta.url), "utf8");

// Partial prose guard for the exact stale implementation claim resolved by #301. Runtime
// checklist tests protect the behavior; this only keeps the shared approval record aligned.
describe("SPEC-CONFLICT #301 baseline reconciliation", () => {
  it("does not retain the resolved checklist implementation gap", () => {
    expect(baseline).not.toContain("The implementation matches neither criterion yet");
    expect(baseline).toContain("Implementation now matches both criteria (SPEC-CONFLICT #301)");
  });
});
