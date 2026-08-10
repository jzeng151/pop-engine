// The apply-by line for a published business-day window that production cannot turn into a date.
//
// WHAT THIS REPLACES. `business_days_minimum` findings render `not_calculable` in production
// because `PUBLISHED_HOLIDAY_CALENDARS` is empty (SPEC-CONFLICT #130; the decision and its
// evidence are in `apps/api/src/calendar.ts`, and `rules/nyc-rules.v2.11.json` states the same for
// DOB-ASSEMBLY-001). The plan line said only "not calculable", which names a failure of ours and
// tells the organizer nothing about what to do. This line says what the missing piece is and who
// has it.
//
// THIS LINE CARRIES NO NUMBER, AND THAT IS THE POINT. The window is already on the line above it,
// stated with the qualification its source carries: DOB-TENT-001's published qualification names
// the Temporary Use Permit path and the registered design professional who files, and each SLA
// rule's names the permit page the 15 comes from. Restating "at least 15 business days" here,
// unqualified and in the slot an organizer reads as the answer, would present as settled a number
// whose unit both SLA rules record as in conflict across three official sources. So this sentence
// explains and does not re-state.
//
// EVERY CLAUSE IS LOAD BEARING, and the copy is approved as regulatory content (product owner,
// 2026-08-08; recorded in `docs/BASELINE.md`). Do not reword it here:
//
//   • "the exact date depends on which days <agency> counts as business days" says why no date is
//     shown. It asserts nothing about whether the agency publishes that definition, only that the
//     date turns on it. An earlier draft said "which it does not publish", and that claimed more
//     than the sources support: `docs/VERIFICATION-SOURCES.md` records DOB TUP as NOT PUBLISHED
//     *from the Pass B source set*, and the SLA agency-closure question as NOT ASSESSED. "No source
//     we consulted defines it" is not "the agency does not publish it".
//   • "Allow more if it closes for holidays" is conditional. It asserts nothing about which days
//     any agency observes, which is exactly what no located source establishes.
//   • "Confirm with <agency>" preserves the CONFIRM_WITH_AGENCY obligation the old line carried.
//
// NOTHING PUBLISHED IS READ FOR THIS SENTENCE except the agency's name and the deadline's published
// type. There is no count to carry, so no member of `Deadline` beyond `type` is projected onto the
// page and this feature changes no contract.

import type { ConsumedFinding } from "./plan-api";

/**
 * What the sentence is read off: the four published values that decide whether it applies and which
 * agency it names. A merged line and one of its contributing routes both carry all four, and it is
 * the same sentence on either, so it is stated once over the shape rather than twice over the two
 * types. Projected from `ConsumedFinding` so a rename there still fails this typecheck.
 */
type BusinessDayLine = Pick<
  ConsumedFinding,
  "agency" | "deadline" | "deadlineStatus" | "latestApplyDate"
>;

/**
 * How an agency's published name reads inside the notice, in both positions it appears: as the
 * subject of "<agency> counts as business days" and as the object of "Confirm with <agency>". The
 * article is grammar, not regulatory content, so it is decided here rather than added to the
 * ruleset, and it is decided per published name rather than guessed from the string's shape.
 *
 * The table is exhaustive over the agencies that publish a `business_days_minimum` deadline in
 * `rules/nyc-rules.v2.11.json`, with one deliberate omission:
 *
 *   DOB-TENT-001      "DOB"                       -> "DOB"
 *   SLA-ONEDAY-001    "NY State Liquor Authority" -> "the NY State Liquor Authority"
 *   SLA-CATERING-001  "NY State Liquor Authority" -> "the NY State Liquor Authority"
 *   DOB-ASSEMBLY-001  "DOB (+ FDNY Public Assembly Permit)" -> ABSENT
 *
 * DOB-ASSEMBLY-001's published agency string names two agencies and a permit. It does not read as
 * the subject of a sentence ("which days DOB (+ FDNY Public Assembly Permit) counts as business
 * days") and it does not read after "Confirm with". Shortening it to "DOB" here would silently drop
 * the FDNY half of a published field, which is a regulatory-content edit and not this change's to
 * make, so the finding falls back to the previous "not calculable, confirm with agency" line and
 * loses nothing it had. The fix belongs in the ruleset: when that rule's published `agency` becomes
 * "DOB", this table already carries "DOB" and the rule renders the new line with no edit here.
 *
 * An agency that is not listed falls back the same way. A new business-day rule therefore renders
 * the old line rather than an ungrammatical new one.
 */
const AGENCY_IN_SENTENCE: Readonly<Record<string, string>> = {
  DOB: "DOB",
  "NY State Liquor Authority": "the NY State Liquor Authority",
};

/**
 * The approved sentence for this finding, or null when it does not apply.
 *
 * THE DISCRIMINATOR IS THE PUBLISHED DEADLINE TYPE, not the unresolved reason. `not_calculable` has
 * other causes: a `research_required` deadline (no agency published a lead time at all) and an
 * unanswered intake field such as the plaza level (`deadlineUnknownFields`). Neither turns on which
 * days an agency counts, so neither gets this sentence. A `business_days_minimum` deadline has
 * exactly one undatable path in `packages/engine/src/deadlines.ts` (`holidays === null`), so type
 * plus `not_calculable` plus no computed date identifies this case with nothing left to parse.
 *
 * A MERGED FINDING GETS THE SENTENCE, and the two fields it combines are now one route's. AD-19's
 * per-field split, under which `agency` arrived with the identity binding and `deadline` with the
 * window binding, is the one sentence of AD-19 this branch supersedes: `findings.ts:481-482` takes
 * identity and timeline both off the binding route, so the agency this sentence names is the agency
 * that published the window it explains. On a route entry the same is true by construction: every
 * value on a route is that rule's own. So the group-crosses-agencies hazard the invariant below was
 * written against can no longer produce the wrong agency on either surface, which is what that
 * comment predicted would happen when this route list landed. The invariant is kept anyway, as the
 * artifact-level check it already is: it costs one test and it fails on the event, a `dedupe_key`
 * edit, that #239 and #244 both record moving rendered output with no code change.
 *
 * NO PUBLISHED GROUP CROSSES AGENCIES, and that is checked rather than assumed. `dob-structure` is
 * the only `dedupe_key` group in nyc.v2.11 holding a rule with a `business_days_minimum` deadline,
 * and both its routes, DOB-TENT-001 and DOB-TALL-STRUCTURE-001, publish `agency` "DOB", so the
 * merged agency is DOB whichever route bound it. `business-day-notice.test.tsx` asserts that over
 * the published file as an invariant, not over this one group: every dedupe group holding a
 * business-day deadline publishes at most one distinct agency across its routes. A `dedupe_key`
 * edit that crossed agencies fails that test, which is the guarantee this sentence actually needs
 * and the reason it is at the artifact level. #239 and #244 both record a dedupe-key edit moving
 * rendered output with no code change, so an artifact edit is exactly the event to fail on.
 *
 * SUPPRESSING THE SENTENCE ON EVERY MERGED FINDING was the earlier guard and was wrong twice over.
 * It withheld the approved line from every tented event that does not answer `structure_over_10ft_tall`
 * "no", Scenario E among them, in the one case where the suppressed sentence is provably correct;
 * and the decision recorded in `docs/BASELINE.md` names DOB-ASSEMBLY-001 as the one finding that
 * falls back, so narrowing further is not this file's to decide.
 *
 * A NON-BINDING ROUTE GETS THE SENTENCE TOO, off its own four fields, which is why this reads a
 * shape rather than a `ConsumedFinding`. Where DOB-TALL-STRUCTURE-001 binds the `dob-structure`
 * group and DOB-TENT-001 rides along unresolved, the deployed null holiday calendar leaves the tent
 * route `not_calculable` with no date of its own, and the merged line's scalars are the tall route's,
 * so the finding-level call above returns null. The route entry then carried "not calculable" and
 * nothing else, and F-201 AC 13's explanation of what the exact date depends on was absent from the
 * one line that has the undatable window. The criterion is written about a finding whose published
 * deadline `type` is `business_days_minimum` and which could not be dated; a route entry publishing
 * exactly that is that finding's window, listed where the merge put it.
 */
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
