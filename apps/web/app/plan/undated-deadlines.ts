import type { DeadlineStatus } from "@pop-engine/engine";
import type { ConsumedFinding } from "./plan-api";

/** F-102 Edge Cases — FEASIBLE when every deadline is undated. */
export const NO_DATED_DEADLINES_NOTE = "No dated deadlines identified.";

const isUndated = (status: DeadlineStatus): boolean =>
  status === "not_applicable" || status === "not_calculable";

/**
 * True when every finding's deadline is NOT_APPLICABLE or NOT_CALCULABLE (or there are none).
 *
 * ASKED OF EVERY ROUTE, NOT OF THE MERGED LINE. A merged dedupe line takes its status from its
 * binding route, and where that route publishes no window the line reads `not_applicable` while
 * another route on the same line publishes a dated one. Read off the line alone, this printed "No
 * dated deadlines identified." over a plan whose only dated window was a non-binding route's,
 * confirmed on a synthetic ruleset whose binding route is undated and whose other route dates
 * 2026-11-10, verdict FEASIBLE (#252 review). `routes` is null on an unmerged line and on a plan
 * stored before the field existed, and there the line is its own single route.
 */
export function hasOnlyUndatedDeadlines(findings: readonly ConsumedFinding[]): boolean {
  return findings.every((finding) =>
    finding.routes == null
      ? isUndated(finding.deadlineStatus)
      : finding.routes.every((route) => isUndated(route.deadlineStatus)),
  );
}
