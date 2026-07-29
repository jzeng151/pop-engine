import type { ConsumedFinding } from "./plan-api";

// F-201 AC 4 / F-102 edge-case framing. Copy strings are mandated by the approved specs; the
// predicates decide when they are honest to show (overclaiming emptiness and over-prescribing are
// both failure modes).

/** F-201 Acceptance Criterion 4 — near-empty result, those words. */
export const NEAR_EMPTY_FRAMING =
  "No new city event requirement identified from your answers.";

/** F-102 Edge Cases — FEASIBLE when every deadline is undated. */
export const NO_DATED_DEADLINES_NOTE = "No dated deadlines identified.";

/**
 * A finding that means the plan is not "near empty": a prohibited line, an official conflict, a
 * required filing that is not merely a confirm-with-agency confirmation, or a may-be permit /
 * insurance / eligibility / registration that already carries a dated status.
 *
 * Scenario B keeps DOHMH vendor (`required` + `not_calculable`) and DOHMH notification
 * (`may_be_required` + kind `notification`) as named confirmations beside the framing sentence.
 * Scenario F's may-be permits with dated statuses keep the sentence off.
 */
export function isIdentifiedCityEventRequirement(finding: ConsumedFinding): boolean {
  if (finding.disposition === "prohibited_or_ineligible") return true;
  if (finding.verificationStatus === "OFFICIAL_CONFLICT") return true;
  if (finding.disposition === "required" && finding.deadlineStatus !== "not_calculable") {
    return true;
  }
  if (finding.disposition !== "may_be_required") return false;
  if (
    finding.kind !== "permit" &&
    finding.kind !== "insurance" &&
    finding.kind !== "eligibility" &&
    finding.kind !== "registration"
  ) {
    return false;
  }
  return (
    finding.deadlineStatus === "on_track" ||
    finding.deadlineStatus === "deadline_approaching" ||
    finding.deadlineStatus === "published_deadline_missed"
  );
}

/** True when AC 4's near-empty framing is honest — including the fully empty plan. */
export function isNearEmptyPlan(findings: readonly ConsumedFinding[]): boolean {
  return !findings.some(isIdentifiedCityEventRequirement);
}

/** True when every finding's deadline is NOT_APPLICABLE or NOT_CALCULABLE (or there are none). */
export function hasOnlyUndatedDeadlines(findings: readonly ConsumedFinding[]): boolean {
  return findings.every(
    (finding) =>
      finding.deadlineStatus === "not_applicable" || finding.deadlineStatus === "not_calculable",
  );
}
