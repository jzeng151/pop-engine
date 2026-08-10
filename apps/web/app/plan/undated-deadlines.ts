import type { DeadlineStatus } from "@pop-engine/engine";
import type { ConsumedFinding } from "./plan-api";

/** F-102 Edge Cases — FEASIBLE when every deadline is undated. */
export const NO_DATED_DEADLINES_NOTE = "No dated deadlines identified.";

const isUndated = (status: DeadlineStatus): boolean =>
  status === "not_applicable" || status === "not_calculable";

/** True when every finding's deadline is NOT_APPLICABLE or NOT_CALCULABLE (or there are none). */
export function hasOnlyUndatedDeadlines(findings: readonly ConsumedFinding[]): boolean {
  return findings.every((finding) =>
    finding.routes == null
      ? isUndated(finding.deadlineStatus)
      : finding.routes.every((route) => isUndated(route.deadlineStatus)),
  );
}
