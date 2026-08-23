import { readFileSync } from "node:fs";
import { URL } from "node:url";
import { describe, expect, it } from "vitest";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

// Partial prose guard for the exact stale F-206 implementation claims resolved by #301.
// Runtime checklist tests protect the behavior; arbitrary rewordings remain review-owned.
describe("SPEC-CONFLICT #301 F-206 lifecycle prose", () => {
  it("records the implemented terminal strike state and provenance", () => {
    const spec = read("specs/F-206-rules-snapshot-banner.md");
    const tests = read("apps/api/src/planning/checklist.test.ts");
    const regressions = [
      "ends a task on a kind change and appends a new task when its identity returns",
      "ends a task from an unreviewed intervening kind change",
    ];

    expect(spec).not.toContain("The implementation does not match: struck-through-ness");
    expect(spec).not.toContain("The implementation matches neither of them yet");
    for (const title of regressions) {
      expect(spec, `F-206 cites the ${title} regression`).toContain(title);
      expect(tests, `the cited ${title} regression still exists`).toContain(title);
    }
  });
});
