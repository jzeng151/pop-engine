// ─────────────────────────────────────────────────────────────────────────────
// PROPOSAL — PARTLY APPROVED. §7 is approved (2026-07-27, see its own block for the
// scope and the capacity); §1, §2, §3 and §6 are NOT, and still need the product
// owner's sign-off (DOCUMENTATION-GOVERNANCE §6, "rule trigger, dedupe, branch,
// deadline, or formula semantics", which names one capacity since 2026-08-04; that
// row is regulatory publication, and that sign-off is the whole requirement even
// where the product owner is also the author).
//
// The banner is per-section rather than per-file on purpose. It used to read NOT YET
// APPROVED for everything, and replacing it wholesale when one contract was decided
// would have approved the other four by implication, which nobody decided. A reader
// who needs to know whether a given contract is settled has to be able to get that
// answer for THAT contract.
//
// Everything in this file is a contract that F-201 needs and that no approved artifact
// states. It is collected here, in one place, on purpose: when the team decides, the
// decision moves into the ruleset's `engine_conventions` and this file shrinks or
// disappears. That move is PENDING rather than forgotten for §7. The issue #107 v2.9
// publication deliberately did not carry it: moving the contract requires an engine
// change of its own, as `docs/BASELINE.md` records.
// Nothing here invents a regulatory fact — every value is either a vocabulary mapping
// or a quotation of published rule text.
//
// Recorded on issue #4 (comment "Two undecided contracts F-201 will hit") for §1 and §2.
// §3, §6 and §7 were found while deriving the six scenarios and are new. §4 and §5 are gone:
// nyc.v2.4 publishes both as rule data — the by-level deadline names the fields it keys on, and
// the tent condition declares that its exact threshold is unresolved — so neither is an
// engine-side assertion any more. Five contracts remain: §1, §2, §3, §6, §7.
// ─────────────────────────────────────────────────────────────────────────────

import type { Disposition, RuleKind } from "./types";

/**
 * §1 — Default disposition per rule kind.
 *
 * `permit_plan_items.disposition` is NOT NULL, but 24 of the 37 published rules omit
 * `output.disposition`, and no artifact says what those rules emit. A rule's own
 * `output.disposition` always wins; this table only fills the silence.
 *
 * Scenario B's single dated finding is DOHMH-ORGANIZER-NOTIFY-001, whose 30-day window
 * (2026-07-13) is already past on the fixture clock, and the answer key pins B as
 * CONDITIONAL rather than INFEASIBLE. That uncertainty is now carried by the rule itself:
 * the product owner authorized adding `disposition: MAY_BE_REQUIRED` to that one rule's
 * output (its own commit on this branch; the sign-off that class needs under governance §6 is
 * the product owner's, and that is the whole requirement even for a publication they authored). So `notification` stays `required` here — the per-rule mark is not a
 * kind-wide weakening.
 */
export const DEFAULT_DISPOSITION_BY_RULE_KIND: Readonly<Record<RuleKind, Disposition>> = {
  permit: "required",
  insurance: "required",
  registration: "required",
  notification: "required",
  eligibility: "may_be_required",
  prohibition: "prohibited_or_ineligible",
  dependency: "may_be_required",
  advisory: "advisory",
  note: "no_new_requirement",
  // A classification rule persists as a note finding with this disposition (#73,
  // ARCHITECTURE "Rule kind vs finding kind"). That part is approved; it is repeated
  // here only so the table is total.
  classification: "no_new_requirement",
};

/**
 * §2 — A finding whose trigger evaluated tri-state `unknown` is never definitive.
 *
 * engine_conventions says a material unknown propagates to CONDITIONAL and never silently
 * becomes false; it does not say what disposition the resulting finding carries. Rendering
 * it as REQUIRED would overclaim, so a `required` finding whose trigger came back unknown
 * is downgraded to this. Dispositions that already hedge or already say something other
 * than "you must file this" (advisory, no_new_requirement, prohibited_or_ineligible) are
 * left exactly as published.
 */
export const UNKNOWN_TRIGGER_DISPOSITION: Disposition = "may_be_required";

/**
 * §3 — A MAY_BE_REQUIRED finding whose published window has passed yields CONDITIONAL.
 *
 * ARCHITECTURE step 4 only says a *definitively required* missed finding gives INFEASIBLE,
 * and step 5 only covers positive slack. A missed window on a finding that may not apply
 * falls through both. Fixtures B and F both land on it. Ranked after INFEASIBLE and before
 * FEASIBLE-AT-RISK.
 */
export const MISSED_MAY_BE_REQUIRED_IS_CONDITIONAL = true;

/**
 * §7 — Dependency sequencing bindings. APPROVED 2026-07-27.
 *
 * WHO APPROVED IT, stated plainly rather than implied. Governance §6 puts this class — "rule
 * trigger, dedupe, branch, deadline, or formula semantics" — with the verification owner plus the
 * engine owner. The product owner currently holds both lanes and granted it in that capacity. That
 * is one person approving, not two independent sign-offs, and the record says so because a reader
 * counting signatures would otherwise count two.
 *
 * WHAT THE APPROVAL COVERS, and the reservation is part of it rather than a separate question
 * left open. Two of the three things this binding does are uncontroversial. The sequencing
 * RELATIONSHIP is already published regulatory content: NYPD-SOUND-PARKS-DEP-001 states in its own
 * `note_text` that Parks controls amplified-sound permission through its event review and that it
 * should be obtained before pursuing the NYPD permit, SOURCE_CONFIRMED with a source URL. And the
 * DATES are not invented here either — every one comes from PARKS-EVENT-001's own published
 * `processing_range_days`, so this file contributes no number.
 *
 * The third thing is an interpretation, and it is the part being approved rather than merely
 * recorded. The published prose says "Parks amplified-sound permission ... through its event
 * review"; treating that as PARKS-EVENT-001, the Special Event Permit, is a reading of which Parks
 * instrument is meant. It is load-bearing, because it is what imports that rule's 21 to 30 day
 * processing range into a date an organizer is shown. A different reading of the instrument would
 * produce a different date. That is precisely why this needed §6 approval and not an implementer's
 * judgement, and it is what was approved.
 *
 * WHAT THIS APPROVAL REGULARISES RATHER THAN AUTHORISES: `findings.ts` already consumes this
 * binding on main to populate `permit_plan_items.apply_after_date`, which F-202 renders as the
 * start date on a checklist row. The interpretation above has therefore been reaching organizers
 * since F-201. The approval catches the record up with what shipped; it does not switch anything
 * on.
 *
 * NYPD-SOUND-PARKS-DEP-001 states in prose that Parks amplified-sound permission precedes the NYPD
 * sound permit, but nothing machine-readable says which finding it gates or which one it waits on,
 * and `permit_plan_items.apply_after_date` is a declared F-201 output that stays dead without that
 * link. Same shape as §5: the engine needs a binding the ruleset does not publish.
 *
 * The dates it produces come only from published numbers — the upstream rule's own processing
 * range — and the rule's own caveat travels with the finding, because its `verification` block
 * qualifies the sequencing as RESEARCH_REQUIRED: a strict issued-before-filed order is NOT
 * confirmed. So the gated date is rendered as the earliest the downstream window opens if the
 * sequencing holds, never as a prohibition on filing sooner, and a tight or negative gated window
 * can raise the finding to DEADLINE_APPROACHING but can never mark it PUBLISHED_DEADLINE_MISSED.
 * Closing a window on the strength of an unconfirmed sequence would invent a blocker.
 */
export const DEPENDENCY_SEQUENCING_BINDINGS: readonly {
  readonly dependencyRuleId: string;
  readonly upstreamRuleId: string;
  readonly gatedRuleId: string;
}[] = [
  {
    dependencyRuleId: "NYPD-SOUND-PARKS-DEP-001",
    upstreamRuleId: "PARKS-EVENT-001",
    gatedRuleId: "NYPD-SOUND-001",
  },
];

/**
 * §6 — Rescope generation policy.
 *
 * ARCHITECTURE says rescope suggestions are full re-evaluations of modified intakes but
 * never says which modifications to try. Scenario A pins exactly three. These three rules
 * reproduce them from the published registry alone:
 *
 *  R1 candidates are alternate declared values of a field in the blocking rule's trigger,
 *     or of the root field that gates that rule through the registry's `asked_when` chain
 *     (for Scenario A: street_event_size, and location_type at the root). `unknown` is
 *     never suggested — telling an organizer to un-know a fact is not a rescope.
 *  R2 keep it only if the verdict strictly improves.
 *  R3 drop it if the re-evaluated plan introduces any of:
 *     - a COVERAGE_GAP finding — the ruleset asserts nothing there, so the engine cannot
 *       claim the change helps (rules out "hold it as some other SAPO class");
 *     - a definitively-required finding from an agency the current plan does not already
 *       involve — trading one agency's permit burden for another's is not advice (rules out
 *       "hold it in a park", which swaps SAPO for Parks);
 *     - a finding whose deadline is NOT_CALCULABLE for any reason other than an unpublished
 *       holiday calendar — a scope whose timeline the engine cannot compute (unasked plaza
 *       level, research_required lead, etc.) is not a scope it can recommend. An undated
 *       window solely from an unpublished holiday list (SPEC-CONFLICT #130) does not trigger
 *       this drop: CONDITIONAL already surfaces it, and withholding would erase F-102 AC 7's
 *       private-venue ladder step under the deployed null calendar.
 *     Re-sizing within the same agency survives all three, which is Scenario A's ladder.
 */
export const RESCOPE_EXCLUDES_UNKNOWN_VALUES = true;
