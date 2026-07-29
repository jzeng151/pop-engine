import type { ConsumedFinding } from "./plan-api";

/** F-102 Edge Cases — FEASIBLE when every deadline is undated. */
export const NO_DATED_DEADLINES_NOTE = "No dated deadlines identified.";

/** True when every finding's deadline is NOT_APPLICABLE or NOT_CALCULABLE (or there are none). */
export function hasOnlyUndatedDeadlines(findings: readonly ConsumedFinding[]): boolean {
  return findings.every(
    (finding) =>
      finding.deadlineStatus === "not_applicable" || finding.deadlineStatus === "not_calculable",
  );
}
