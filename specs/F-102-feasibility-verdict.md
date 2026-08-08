# F-102 · Feasibility Verdict

**Status:** APPROVED (2026-07-24; Outputs amended 2026-08-02, product-owner approved, one person currently holding every lane: the three rescope enrichment fields the engine already emits are written down, and `verdict_detail` prose is pinned to rule ids, with the render-time substitution stated as what it actually delivers and its one merged-finding residue named. No verdict, finding, deadline, threshold or regulatory fact moves; Acceptance amended 2026-08-08, product-owner approved: a missed finding blocks at or above `required` in the disposition strength order rather than exactly at it, so a finding that is both barred and past its published window renders INFEASIBLE where it rendered CONDITIONAL. That one moves a verdict, and AC 10 states which) · **Reviewer/approver:** product owner · **Owner:** see Lane below · see `docs/BASELINE.md`.
**Phase:** 1 (core, week 1) · **Lane:** Dev 1 · **Depends on:** F-201 (same engine invocation) · **Feeds:** plan UI, F-203 slack warnings
**Updated:** 2026-07-22 against nyc.v2.1; retargeted through nyc.v2.8 for the changes recorded in `docs/BASELINE.md`, to nyc.v2.9 on 2026-07-29, to nyc.v2.10 the same day for issue #181's citation-only correction, and to nyc.v2.11 for organizer summaries. v2.9 adds `no_new_requirement` confirmation findings and changes the active intake registry for F-110 and issue #194 without changing a verdict. v2.10 and v2.11 change no finding, status, or verdict. The plan renderer's separate near-empty predicate is disposition-based: a `required + not_calculable` finding remains definite and suppresses near-empty copy.

## User Story

As an independent organizer, the moment my plan generates I see whether my date actually works, and if it doesn't, exactly which requirement blocks it and what I could change.

## Inputs

The F-201 evaluation context: findings with typed deadlines, `event_date`, `today`, the pinned holiday calendar, `config.slack_warning_days` (14), unknown facts.

## Outputs

Per-finding **deadline status**: ON_TRACK / DEADLINE_APPROACHING / PUBLISHED_DEADLINE_MISSED / NOT_CALCULABLE / NOT_APPLICABLE.

One top-level verdict on the `permit_plans` row, plus `verdict_detail`:

| Verdict          | detail carries                                                    | Copy rule                                                                                                |
| ---------------- | ----------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| FEASIBLE         | min_slack_days                                                    | "On track"                                                                                               |
| FEASIBLE-AT-RISK | tightest finding, "apply within N days"                           | threshold labeled as PopEngine's **internal planning buffer**, never an official threshold               |
| CONDITIONAL      | each missing fact + every branch's verdict and reason             | branch table rendered                                                                                    |
| INFEASIBLE       | blocking finding, rescope suggestions (each a full re-evaluation) | **"published deadline missed as scoped"** — a missed filing window, never a claim of legal impossibility |

### Rescope suggestion enrichment (amended 2026-08-02)

On the current ruleset line only, a rescope suggestion carries three optional fields beside `introducedRuleIds`. Superseded eras keep the historical three-field shape, so stored plans replay unchanged (AD-7).

| Field                      | Carries                                                                                                             | Emitted when                                                                                                                                                                       |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `introducedFindings`       | per introduced finding: its rule ids, published organizer heading, first published source link, portal name and URL | only when the rescope introduces at least one finding and **every** one of them has a published `output.user_summary`. All-or-nothing: a partial list would read as a complete one |
| `remainingMissingFields`   | the fields the re-evaluated intake still leaves unanswered                                                          | always on the current line; empty when the rescope resolves every open fact                                                                                                        |
| `remainingTimelineReasons` | the reasons the re-evaluation still cannot date a published timeline                                                | always on the current line; empty when every finding in the rescope dates                                                                                                          |

A rescope that improves the verdict is not thereby complete. These two "remaining" fields exist so the UI can say what a suggested change still would not resolve, rather than presenting an improved verdict as a finished one.

**Prose in `verdict_detail` names rules by id, never by organizer heading.** Branch reasons, tightened-finding lines, and published-threshold descriptions are persisted verbatim on the `permit_plans` row, and the id is what traces a stored sentence back to one published rule permanently. Headings are not unique and any later publish may reword one. The plan view substitutes the same published heading at render time, so a plan read on the ruleset line it pinned shows the organizer no id. One residue is known and accepted rather than promised away: on a stored plan whose pinned ruleset is no longer the deployed one, a rule that prose names and that contributed to a **merged** finding keeps its id. The snapshot files a merged finding under one contributor's heading without recording which contributor it belongs to, and the deployed per-rule references are withheld because the version has moved on, so nothing on the page can label that rule without risking a different requirement's name — rendering `DOB-TALL-STRUCTURE-001` as the tent approval would be a wrong answer, not an approximate one. Closing the residue means persisting per-rule labels in `verdict_detail`, which is era-gated engine output under AD-7 and so requires a new published ruleset plus the product owner's approval under governance §6, which is the whole requirement even where the product owner authored that publication; none is claimed here, and it would still leave every already-stored plan on the id. (Reconciled 2026-08-02 and narrowed the same day once the residue was measured, product-owner approved, one person currently holding every lane. `packages/engine/src/acceptance.test.ts` pins the id-in-prose rule; `apps/web/app/plan/plan-view.test.tsx` pins both the substitution and the residue.)

## Acceptance Criteria

1. **Backward timeline:** every dated finding gets `latest_apply_date` per its deadline type (published minimums per SAPO class/size/plaza level; hard floor + processing range composites; actual business-day minimums; before-issuance; dependency-gated). `research_required` deadlines are NOT_CALCULABLE and excluded from verdict math.
2. **Algorithm order** (ARCHITECTURE steps 1–6): branch evaluation for unknowns runs before window checks. Scenario F must render CONDITIONAL, never INFEASIBLE.
3. **The cliff:** Parks' 21-day hard floor is binary (21 days out → not floor-blocked, the last valid filing day; 20 → PUBLISHED_DEADLINE_MISSED). PARKS-EVENT-001 publishes "apply at least 21 days ahead (applications inside 21 days are not accepted)", so day 21 is inside the window and only day 20 is past it. The 21–29-day band renders FEASIBLE-AT-RISK with "processing may not complete before event" (interpretation I-5, carried forward).
4. **Sequencing:** in parks with amplified sound, the sound finding is dependency-gated on the Parks timeline and the rendered timeline shows apply-now → decision window → pursue sound → buffer (Scenario C), with the sequencing caveat as a note.
5. **Slack warning:** Scenario D renders exactly "apply within 10 days". Slack for gated findings = latest_apply − apply_after (window width).
6. **Branching:** every material unknown produces a fully evaluated branch (Scenario F: license coverage and sound audibility → branch table with per-branch verdicts; the no-license branch shows the one-business-day miss). `venue_paco_covers_exact_event` and `venue_fdny_pa_permit_current_for_event_space` remain confirmation context in the immutable intake snapshot. No published trigger consumes them, so unknown on either creates no branch and neither supports a temporary-filing inference.
7. **Rescopes are re-evaluations:** Scenario A's ladder (Large missed → Medium at-risk 5 days → Small at-risk on the DOHMH notification → private venue drops SAPO/insurance) comes from running the engine on modified intakes.
8. Verdict computation adds < 5 seconds to plan generation (PRD metric; in practice the same in-memory pass).
9. Deterministic: same inputs + same `today` + same calendar → same statuses, verdict, and detail.
10. **What a missed window blocks on (amended 2026-08-08, product owner).** A PUBLISHED_DEADLINE_MISSED finding drives the verdict to INFEASIBLE when its disposition is at or above `required` in the engine's disposition strength order (`no_new_requirement` < `advisory` < `may_be_required` < `required` < `prohibited_or_ineligible`). It was written as exactly `required`, which read the strength order as a set rather than a ladder: `prohibited_or_ineligible` is stronger, so a finding that was both barred and past its published window fell through to the missed-but-not-blocking branch and the plan rendered CONDITIONAL. Nothing about deduplication was involved; a lone barred finding with a closed window and no dedupe key read CONDITIONAL too. Tiers below the bar are unchanged, so AC 2's Scenario F and the missed MAY_BE_REQUIRED case in `packages/engine/src/proposals.ts` §3 both still render CONDITIONAL. On the published ruleset this moves no plan: `SAPO-BLOCK-PARTY-ELIG-001` and `PARKS-PROPANE-001` are the only findings that carry `prohibited_or_ineligible`, and both publish no deadline, so neither can be missed. It becomes reachable when a ruleset publishes a barred rule that also carries a filing window.

## Edge Cases

- Multiple findings missed → INFEASIBLE names the blocking finding with the longest lead; all missed findings listed in detail.
- Zero dated findings (Scenario B) → no slack figure; verdict from the conditional/coverage logic alone.
- PROHIBITED_OR_INELIGIBLE findings (block party + sales) don't drive date math; they render as blockers of a different color with rescope guidance. Where such a finding does carry a published window and that window has closed, AC 10 applies and the verdict is INFEASIBLE.
- An OFFICIAL_CONFLICT finding never flips the verdict by itself; it renders MAY_BE_REQUIRED with both readings.
- Only NOT_APPLICABLE/NOT_CALCULABLE deadlines → CONDITIONAL if material unknowns exist, else FEASIBLE with an explicit "no dated deadlines identified" note.
- A required finding remains a definite requirement when its deadline is NOT_CALCULABLE; calculability never makes the plan near-empty.

## Fixture Scenarios Exercised

- A: INFEASIBLE + deadline ladder + three re-evaluated rescopes.
- B: CONDITIONAL, low identified burden, no dated findings.
- C: FEASIBLE with sequenced dependency timeline.
- D: FEASIBLE-AT-RISK, 10 days, no insurance finding.
- E: CONDITIONAL with all dated findings ON_TRACK (~90-day slack) and the 400-sq-ft boundary.
- F: CONDITIONAL, two-fact branch table (license coverage and sound audibility), real business-day math; both F-110 assembly-document confirmations remain context outside the verdict branches.
