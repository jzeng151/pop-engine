# F-102 · Feasibility Verdict

**Status:** APPROVED (2026-07-24) · **Reviewer/approver:** product owner · **Owner:** see Lane below · see `docs/BASELINE.md`.
**Phase:** 1 (core, week 1) · **Lane:** Dev 1 · **Depends on:** F-201 (same engine invocation) · **Feeds:** plan UI, F-203 slack warnings
**Updated:** 2026-07-22 against nyc.v2.1 (layered status model, AD-10); retargeted to nyc.v2.5 on 2026-07-25, to nyc.v2.6 on 2026-07-25, and to nyc.v2.7 on 2026-07-26, none with a verdict change. Retargeted to nyc.v2.8 on 2026-07-26, which DOES move a deadline status: DOB-ASSEMBLY-001's filing lead becomes ten BUSINESS days on an inclusive bound, so in the running product that finding renders NOT_CALCULABLE rather than a dated status, because business-day math needs the holiday calendar this repo deliberately does not publish (SPEC-CONFLICT #130). No verdict rule, status definition or threshold in this spec changes; NOT_CALCULABLE already never counts toward FEASIBLE. AC 6 and the Scenario F summary were corrected 2026-07-28 with product-owner and architecture-owner approval under issue #89: license coverage and sound audibility are its only material verdict branches. `venue_has_assembly_approval` records only that an approval exists and cannot establish exact PACO/PA-permit coverage. Whether exact coverage removes the temporary filing is not published either way; confirm with DOB. Inconsistent conditions require amendment or separate authorization. Objective coverage-specific modeling is rehomed to #188, and this amendment authorizes no ruleset trigger or regulatory claim.

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
6. **Branching:** every material unknown produces a fully evaluated branch (Scenario F: license coverage and sound audibility → branch table with per-branch verdicts; the no-license branch shows the one-business-day miss). `venue_has_assembly_approval` remains collected confirmation context: it records only that an approval exists and cannot establish whether the current PACO and PA permit cover the exact event space, use, occupancy, and layout. Whether exact coverage removes the temporary filing is not published either way; confirm with DOB. Inconsistent conditions require amendment or separate authorization. Objective coverage-specific modeling belongs to #188; this coarse field does not branch the current verdict.
7. **Rescopes are re-evaluations:** Scenario A's ladder (Large missed → Medium at-risk 5 days → Small at-risk on the DOHMH notification → private venue drops SAPO/insurance) comes from running the engine on modified intakes.
8. Verdict computation adds < 5 seconds to plan generation (PRD metric; in practice the same in-memory pass).
9. Deterministic: same inputs + same `today` + same calendar → same statuses, verdict, and detail.

## Edge Cases

- Multiple findings missed → INFEASIBLE names the blocking finding with the longest lead; all missed findings listed in detail.
- Zero dated findings (Scenario B) → no slack figure; verdict from the conditional/coverage logic alone.
- PROHIBITED_OR_INELIGIBLE findings (block party + sales) don't drive date math; they render as blockers of a different color with rescope guidance.
- An OFFICIAL_CONFLICT finding never flips the verdict by itself; it renders MAY_BE_REQUIRED with both readings.
- Only NOT_APPLICABLE/NOT_CALCULABLE deadlines → CONDITIONAL if material unknowns exist, else FEASIBLE with an explicit "no dated deadlines identified" note.

## Fixture Scenarios Exercised

- A: INFEASIBLE + deadline ladder + three re-evaluated rescopes.
- B: CONDITIONAL, low identified burden, no dated findings.
- C: FEASIBLE with sequenced dependency timeline.
- D: FEASIBLE-AT-RISK, 10 days, no insurance finding.
- E: CONDITIONAL with all dated findings ON_TRACK (~90-day slack) and the 400-sq-ft boundary.
- F: CONDITIONAL, two-fact branch table (license coverage and sound audibility), real business-day math; assembly approval remains confirmation context outside the verdict branches.
