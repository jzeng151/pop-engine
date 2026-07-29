# F-102 · Feasibility Verdict

**Status:** APPROVED (2026-07-24) · **Reviewer/approver:** product owner · **Owner:** see Lane below · see `docs/BASELINE.md`.
**Phase:** 1 (core, week 1) · **Lane:** Dev 1 · **Depends on:** F-201 (same engine invocation) · **Feeds:** plan UI, F-203 slack warnings
**Updated:** 2026-07-22 against nyc.v2.1; retargeted through nyc.v2.8 for the changes recorded in `docs/BASELINE.md`, and to nyc.v2.9 on 2026-07-29. v2.9 adds `no_new_requirement` confirmation findings and changes the active intake registry for F-110 and issue #194 without changing a verdict. The plan renderer's separate near-empty predicate is disposition-based: a `required + not_calculable` finding remains definite and suppresses near-empty copy.

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

## Edge Cases

- Multiple findings missed → INFEASIBLE names the blocking finding with the longest lead; all missed findings listed in detail.
- Zero dated findings (Scenario B) → no slack figure; verdict from the conditional/coverage logic alone.
- PROHIBITED_OR_INELIGIBLE findings (block party + sales) don't drive date math; they render as blockers of a different color with rescope guidance.
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
