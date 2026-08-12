# F-102 · Feasibility Verdict

**Status:** APPROVED (2026-07-24; Outputs amended 2026-08-02, product-owner approved, one person currently holding every lane: the three rescope enrichment fields the engine already emits are written down, and `verdict_detail` prose is pinned to rule ids, with the render-time substitution stated as what it actually delivers and its one merged-finding residue named. No verdict, finding, deadline, threshold or regulatory fact moves; Acceptance amended 2026-08-08, product-owner approved: a missed finding blocks at or above `required` in the disposition strength order rather than exactly at it, so a finding that is both barred and past its published window renders INFEASIBLE where it rendered CONDITIONAL, and, at the same tier, the blocking finding's trigger has to have resolved, which is AC 2's invariant restated where the demotion it relies on does not reach. That one moves a verdict, and AC 10 states which; Edge Cases amended 2026-08-08, product-owner approved, so the window checks read a merged line's routes rather than the line, see the Amendment at the foot of this file) · **Reviewer/approver:** product owner · **Owner:** see Lane below · see `docs/BASELINE.md`.
**Decision 2026-08-12:** APPROVED by the product owner under issue #258: F-102 is the overall verdict, and a resolved prohibition or ineligibility is an INFEASIBLE blocker without needing a deadline. See Acceptance Criterion 11 and the signed amendment below.
**Phase:** 1 (core, week 1) · **Lane:** Dev 1 · **Depends on:** F-201 (same engine invocation) · **Feeds:** plan UI, F-203 slack warnings
**Updated:** 2026-07-22 against nyc.v2.1; retargeted through nyc.v2.8 for the changes recorded in `docs/BASELINE.md`, to nyc.v2.9 on 2026-07-29, to nyc.v2.10 the same day for issue #181's citation-only correction, to nyc.v2.11 for organizer summaries, and to nyc.v2.12 on 2026-08-12 for issues #258 and #287. v2.9 adds `no_new_requirement` confirmation findings and changes the active intake registry for F-110 and issue #194 without changing a verdict. v2.10 and v2.11 change no finding, status, or verdict. v2.12 changes existing structure and fuel findings under the approved overall-prohibition verdict semantics. The plan renderer's separate near-empty predicate is disposition-based: a `required + not_calculable` finding remains definite and suppresses near-empty copy.

## User Story

As an independent organizer, the moment my plan generates I see whether my date actually works, and if it doesn't, exactly which requirement blocks it and what I could change.

## Inputs

The F-201 evaluation context: findings with typed deadlines, `event_date`, `today`, the pinned holiday calendar, `config.slack_warning_days` (14), unknown facts.

## Outputs

Per-finding **deadline status**: ON_TRACK / DEADLINE_APPROACHING / PUBLISHED_DEADLINE_MISSED / NOT_CALCULABLE / NOT_APPLICABLE.

One top-level verdict on the `permit_plans` row, plus `verdict_detail`:

| Verdict          | detail carries                                                    | Copy rule                                                                                                            |
| ---------------- | ----------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| FEASIBLE         | min_slack_days                                                    | "On track"                                                                                                           |
| FEASIBLE-AT-RISK | tightest finding, "apply within N days"                           | threshold labeled as PopEngine's **internal planning buffer**, never an official threshold                           |
| CONDITIONAL      | each missing fact + every branch's verdict and reason             | branch table rendered                                                                                                |
| INFEASIBLE       | blocking finding, rescope suggestions (each a full re-evaluation) | **"Blocked as scoped"**; detail distinguishes a published prohibition/ineligibility from a missed published deadline |

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
10. **What a missed window blocks on (amended 2026-08-08, product owner).** A PUBLISHED_DEADLINE_MISSED finding drives the verdict to INFEASIBLE when **both** of these hold: its disposition is at or above `required` in the engine's disposition strength order (`no_new_requirement` < `advisory` < `may_be_required` < `required` < `prohibited_or_ineligible`), **and** the trigger it asserts that disposition off resolved rather than coming back `unknown`.

    The bar was written as exactly `required`, which read the strength order as a set rather than a ladder: `prohibited_or_ineligible` is stronger, so a finding that was both barred and past its published window fell through to the missed-but-not-blocking branch and the plan rendered CONDITIONAL. Nothing about deduplication was involved; a lone barred finding with a closed window and no dedupe key read CONDITIONAL too. Tiers below the bar are unchanged, so the missed MAY_BE_REQUIRED case in `packages/engine/src/proposals.ts` §3 still renders CONDITIONAL.

    The `unknown` condition is AC 2's invariant restated at the tier ABOVE the bar, where the demotion AC 2 relies on does not reach. `resolveDisposition()` demotes an unknown-triggered `required` to `may_be_required` and deliberately does not demote `prohibited_or_ineligible` (`packages/engine/src/proposals.ts` §2), so that a lone barred finding still renders as the blocking answer it publishes. Under the narrower bar that finding could never reach this criterion; under the wider one it can, and for a field the registry cannot enumerate there are no branches to diverge, so the window check would decide the verdict before branch evaluation could soften it. A plan would then assert a blocker and, in the same payload, that it does not know the fact the blocker hangs off. The finding keeps its published disposition and still renders as barred; only the verdict waits for the answer. Where the finding is a merged line, the resolved trigger has to be the one that contributed the blocking disposition: a group whose only barred route is unresolved blocks on nothing.

    On the published ruleset this moves no plan, and the bound is per dedupe group rather than per rule, because a merged line takes its group's tightest published window whatever disposition contributed it (AD-19): no rule that can reach `prohibited_or_ineligible` is in a dedupe group holding a published window. `SAPO-BLOCK-PARTY-ELIG-001` and `PARKS-PROPANE-001` are the only findings that carry the disposition, both publish no deadline and neither carries a `dedupe_key`. It becomes reachable when a ruleset publishes a barred rule that carries a filing window or shares a dedupe key with one.

11. **What a prohibition blocks on (amended 2026-08-12, product owner).** A route whose own trigger resolves `true`, whose verification status is not `OFFICIAL_CONFLICT`, and whose disposition is `prohibited_or_ineligible` drives the overall verdict to INFEASIBLE regardless of deadline status. The blocker detail names that route and identifies the bar rather than describing a missed deadline. An unresolved trigger remains CONDITIONAL. `verdictDetail.missedRuleIds` lists only routes with `published_deadline_missed` status and does not acquire an undated prohibition merely because it blocks.

## Edge Cases

- Multiple findings missed → INFEASIBLE names the blocking finding with the longest lead; all missed findings listed in detail.
- Zero dated findings (Scenario B) → no slack figure; verdict from the conditional/coverage logic alone.
- A resolved PROHIBITED_OR_INELIGIBLE route drives INFEASIBLE without deadline math and renders with rescope guidance; an unresolved or OFFICIAL_CONFLICT route does not close the plan by itself.
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

## Amendment (SIGNED 2026-08-08): the window checks read a merged line's routes

**Status: APPROVED 2026-08-08 by the product owner, and part of this spec's approved baseline.** It amends the two Edge Cases named below, on the "Rule trigger, dedupe, branch, deadline, or formula semantics" row of `docs/DOCUMENTATION-GOVERNANCE.md` §6, together with the "Product scope, feature meaning, phase" row for what the INFEASIBLE panel names. Since the second-party review requirement was retired on 2026-08-05, the product owner's approval is the whole requirement for both rows, including where the product owner is also the author. It asserts no regulatory fact: no rule, trigger, threshold, deadline, fee, agency, portal, exception or verification status changes, and every value the amendment exposes is some contributing rule's own published value. The decision record is in `docs/BASELINE.md` and the architecture record is AD-19 as amended on the same date.

The design is `docs/proposals/dedupe-route-list.md` (APPROVED 2026-08-08). What changes here is the domain the window checks run over, not what a verdict means: the four verdicts, their ranks, the branch expansion and every threshold in this spec are exactly as they were.

- **Edge Case "Multiple findings missed → INFEASIBLE names the blocking finding with the longest lead".** Amended: the checks run over every ROUTE of every finding rather than over each merged line's single window. A merged dedupe line's `latestApplyDate`, `deadlineStatus` and `slackDays` are its binding route's, so a group whose non-binding route has a closed window was not seen to be missed at all. Reading routes, it is. The blocking finding the panel names is the merged line NARROWED to the blocking route: that route's rule id, name, agency, disposition, window, status, fee, portal, instructions and citations, so the panel never names one rule and quotes another's date, fee, portal or "More information" link. Where the blocking route is not the route the line reads, the merged organizer summary is dropped rather than reattributed, because a summary is written about a rule and there is no per-route form of it to narrow to; the route's own published name stands in. Every missed route's rule id is still listed in `verdictDetail.missedRuleIds`.
- **Edge Case "Only NOT_APPLICABLE/NOT_CALCULABLE deadlines → CONDITIONAL if material unknowns exist, else FEASIBLE with an explicit 'no dated deadlines identified' note".** Amended: "every deadline" is asked of every route, not of every merged line. A line whose binding route publishes no window reads `not_applicable` while another route on the same line publishes a dated one, so read off the line alone this note printed over a plan that shows a date.
- **The check stays CONJUNCTIVE while the disposition merge is disjunctive, and that is deliberate.** A group blocks if ANY route's published window is missed, so a group can read INFEASIBLE while one of its routes is still open. Nothing published says that filing under one route cures another's missed date: a `dedupe_key` says two rules describe one requirement, not that the agency accepts either filing interchangeably. Reading it disjunctively would assert that equivalence, which is inventing an exception, and would make a verdict depend on whether two rules share a key.
- **The residual this amendment recorded is closed, and this says so rather than leaving it standing.** It said a closed route whose OWN disposition is `prohibited_or_ineligible` reads CONDITIONAL rather than INFEASIBLE, because `computeWindowVerdict()` selected its blocking finding from missed routes whose disposition is exactly `required`. That was true when the amendment was written and is not true now: the 2026-08-08 amendment to AC 10 above, shipped as PR #254 and merged as `91a1894b`, widened the filter from that equality to the at-or-above bar AC 10 states, and `blocksWhenMissed()` (`packages/engine/src/verdict.ts`) compares `DISPOSITION_STRENGTH.indexOf(route.disposition)` against `BLOCKING_DISPOSITION_FLOOR` with `>=`. A route whose own disposition is `prohibited_or_ineligible`, whose own trigger resolved, and whose published window has closed therefore reads INFEASIBLE, which `packages/engine/src/engine.test.ts` pins as "blocks on a barred route whose own trigger resolved and whose window has closed" beside the unresolved-trigger case that still waits. This amendment adds no residual of its own.

## Amendment (SIGNED 2026-08-10): the conditional missed-window panel, stated whole

**Status: APPROVED 2026-08-10 by the product owner, and part of this spec's approved baseline.** It amends the Outputs table's CONDITIONAL detail on the "Product scope, feature meaning, phase" row of `docs/DOCUMENTATION-GOVERNANCE.md` §6, and the copy it states is regulatory content under the first row of that table. It asserts no regulatory fact: no rule, trigger, threshold, deadline, fee, agency, portal, exception or verification status changes, no verdict changes rank or meaning, and every disposition the panel prints is some contributing rule's own published value. The decision record is in `docs/BASELINE.md`.

**Why the whole section and not only the new branches.** Three of the five sentences below were already shipping with no section of any artifact owning them. They went in under a product-owner instruction to branch the lede on the dispositions actually listed rather than assert one over them, and were never written down. That is the same gap that let a route-entry label ship unowned, so this amendment states all five. The three existing sentences are recorded EXACTLY as they render and are unchanged by this amendment; they are written down here, not decided here.

**The section.** Under CONDITIONAL, where `verdictDetail.missedRuleIds` is non-empty, the panel renders one section listing every route whose own published window has closed, each with the disposition its own rule publishes printed beside it. `required` is unreachable in this list and that is a property of the engine rather than a copy decision: a `required` rule whose trigger resolved and whose window closed makes the verdict INFEASIBLE, and one whose trigger came back `unknown` is demoted to `may_be_required`.

**The heading (AMENDED).**

> Published windows that are past

It previously read "Published windows that are past only if the requirement applies". That is false of a route whose own trigger resolved and whose rule publishes no requirement to apply, which is exactly the fourth branch below. The conditionality is the lede's, where it is branched per shape.

**The lede, branched on what the list actually holds.** Every branch is exhaustive over the list; the fifth is the fallback.

1. **Every listed route is `may_be_required` (EXISTING COPY, recorded unchanged).**
   > These findings carry a may-be-required disposition, so a passed published date keeps the verdict conditional rather than treating the window as a definitive miss.
2. **Every listed route is `prohibited_or_ineligible` (EXISTING COPY, recorded unchanged).**
   > The findings below publish a prohibition or an ineligibility, and their own triggers are unresolved, so a passed published date keeps the verdict conditional rather than closing the plan. The bar stands as each rule publishes it.
3. **Every listed route is `advisory` or `no_new_requirement` (NEW).**
   > The findings below publish no filing of their own, and their published windows are past. Each keeps the disposition its own rule publishes, printed beside it.
4. **The plan records no disposition for any listed route (NEW).** Reachable on a replayed or rescoped plan whose line is no longer among the plan's own findings.
   > The findings below have published windows that are past. This plan does not record what each of them publishes, so nothing here states it.
5. **Anything else, which is a genuinely mixed list (EXISTING COPY, recorded unchanged).**
   > The findings below differ in what they publish, and a passed published date settles none of them: it keeps the verdict conditional rather than treating the window as a definitive miss. Each keeps the disposition its own rule publishes, printed beside it.

Each branch is followed by the unchanged sentence "Each finding below states its own published date and qualification on the plan line."

**The shared phrase.** "Publishes no filing of its own" is the vocabulary for a dated route outside the filing dispositions, chosen so that this surface and any other saying the same thing say it in the same words. It names no disposition the ruleset does not use, and the humanized disposition token still renders beside each entry.

**Reachability, measured rather than assumed.** On `rules/nyc-rules.v2.12.json` no `advisory` or `no_new_requirement` rule publishes a deadline, so branch 3 is unreachable on the published ruleset and arises on the proposed draft and in fixtures. Branch 4 is reachable today. That bounds the harm of the sentences the three earlier branches produced for those shapes; it does not make them true, which is why they are amended rather than left.

**This amendment adds no residual.**

## Amendment (SIGNED 2026-08-12): resolved prohibitions block the overall verdict

**Status: APPROVED 2026-08-12 by the product owner under issue #258, and part of this spec's approved baseline.** This changes product and verdict semantics under `docs/DOCUMENTATION-GOVERNANCE.md` §6. It publishes no regulatory fact and changes no rule or verification status.

The four-state verdict vocabulary remains unchanged. A resolved `prohibited_or_ineligible` route now closes the plan as INFEASIBLE even when it publishes no deadline. Its organizer label is “Blocked as scoped,” and the detail says the published rule marks the setup prohibited or ineligible. Missed-deadline blockers keep their deadline explanation. An unresolved prohibition remains CONDITIONAL, an OFFICIAL_CONFLICT never closes the plan by itself, and `missedRuleIds` remains a deadline-only list.
