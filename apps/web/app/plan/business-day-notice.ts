// The apply-by line for a published business-day window that production cannot turn into a date.

import type { ConsumedFinding } from "./plan-api";

/** What the sentence is read off: the four published values that decide whether it applies and which agency it names. */
type BusinessDayLine = Pick<
  ConsumedFinding,
  "agency" | "deadline" | "deadlineStatus" | "latestApplyDate"
>;

/** How an agency's published name reads inside the notice, in both positions it appears: as the subject of "<agency> counts as business days" and as the object of "Confirm with <agency>". */
const AGENCY_IN_SENTENCE: Readonly<Record<string, string>> = {
  DOB: "DOB",
  "NY State Liquor Authority": "the NY State Liquor Authority",
};

/** The approved sentence for this finding, or null when it does not apply. */
export function businessDayNotice(line: BusinessDayLine): string | null {
  if (line.deadlineStatus !== "not_calculable" || line.latestApplyDate !== null) return null;
  if (line.deadline === null || line.deadline.type !== "business_days_minimum") return null;

  const agency = line.agency === null ? undefined : AGENCY_IN_SENTENCE[line.agency];
  if (agency === undefined) return null;

  return (
    `the exact date depends on which days ${agency} counts as business days. ` +
    `Allow more if it closes for holidays. Confirm with ${agency}.`
  );
}
