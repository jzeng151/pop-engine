# PopEngine — Delivery Design (Canonical)

**Status:** APPROVED (2026-07-22; F-109's concept renamed from "coverage states"/"coverage envelope" to "scope support states" 2026-07-26, product-owner approved, resolving a three-way overload of "coverage"; see `docs/BASELINE.md`; the COVERAGE_GAP clause is amended 2026-07-27 under `docs/DOCUMENTATION-GOVERNANCE.md` §2 against the published legend, and is approved under §6 ("Regulatory source/status/content") by the product owner acting as verification owner and rules reviewer. ONE person signed in THREE capacities, all lanes being currently held by one person. §6 states two things about that, and the first is unconditional: "No person approves their own regulatory publication alone. The author and source reviewer should be distinct whenever the team size permits." The first sentence does not bite here because there is no regulatory publication to approve: the amendment asserts no new regulatory fact, changes no rule, trigger, threshold, deadline or verification status, and conforms a lower-authority artifact to the legend already published in `rules/nyc-rules.v2.8.json` under §2's authority hierarchy. The second sentence is the one that applies, and its "whenever the team size permits" is what a single-person team cannot satisfy. Recorded so the sole-approver fact is visible rather than implied.). Companion to `ROADMAP.md`. Covers how the team builds: lifecycle model, ID policy, quality gates, lanes, dependencies, and the demo plan. Technical design (schema, rules engine, API) lives in `ARCHITECTURE.md`.

## Decisions of 2026-07-22 (baseline correction)

5. **Ruleset baseline is the corrected subset `nyc.v2.1`** (33 rules + 4 advisories, evidence-linked to `VERIFICATION-SOURCES.md`), after two fetch-confirmed verification passes contradicted several v1 facts; the pointer is now `nyc.v2.5`, retargeted 2026-07-25 with no regulatory change. The 59-rule draft stays in `rules/proposals/` as the post-capstone target. Scenario fixtures v6 derive from the ruleset.
6. **The demo anchor is re-anchored:** a Large street event 35 days out misses its verified 45-day deadline (the universal 60-day SAPO lead was contradicted by primary sources).
7. **Verdict model:** the four-state verdict stays as the top-level summary, computed from per-finding deadline statuses (ON_TRACK / DEADLINE_APPROACHING / PUBLISHED_DEADLINE_MISSED / NOT_CALCULABLE / NOT_APPLICABLE). INFEASIBLE copy = "published deadline missed as scoped." The 14-day slack threshold is labeled as internal policy.
8. **Real business-day math** against a pinned holiday calendar replaces the calendar approximation (fixture dates are pinned, so determinism holds).
9. **Governance adopted:** `DOCUMENTATION-GOVERNANCE.md` (authority-by-concern + conflict protocol), `AGENTS.md`, and `BASELINE.md` are in force. Authority for regulatory facts: primary source → published rule → approved fixture → engine output → UI copy.
10. **Two parallel tracks (supersedes the stretch-after-gate rule):** the MVP core (Track A: F-101, F-201, F-102, F-206, F-202, F-203, F-204) and the stretch set (Track B: F-301, F-302, F-401, F-402, F-205) are worked separately, so Track B doubles as the demo fallback if the core runs out of time. Invariants: core blockers always outrank stretch work for whoever holds them; Track B never touches core-path files; the green gate now gates the demo-narrative decision, not stretch start. F-205 remains Track B scope but starts only after the F-201/F-202 plan and checklist views merge because its dedicated card integrates into those core-path files.

## Decisions of 2026-07-21

1. **The iron-clad MVP is permit planning:** F-101, F-201, F-102, F-206, F-202, F-203, F-204. Complete, real (no mocks), demoable. Everything else is a nice-to-have.
2. **The demo is a permit-planning deep dive**, not a four-stage traversal. Stretch features appear only if actually built. This replaces the earlier degradation order ("F-301/302 degrade before F-401 gets cut"); check-in is now stretch, not guaranteed.
3. **Lean-plus rigor** adopted into the core: intake contradiction checks (F-101), "I don't know" propagating to CONDITIONAL (F-101 + F-102), ruleset version stored with every plan (F-201/F-206), distinct deadline types in the rules schema (rules JSON + F-203). Location/authority resolution and scope support states are post-MVP (F-108, F-109). F-109's concept was called "coverage states" until 2026-07-26; renamed because "coverage" also names the per-rule `COVERAGE_GAP` verification status and `ARCHITECTURE-FUTURE.md` §7.1's per-result completeness.
4. **The roadmap covers the full product vision.** Phases 2+ exist for delegation and direction, not capstone deadlines.

## Feature ID Policy

F-xxx IDs are permanent shared vocabulary across PRD, roadmap, specs, branches, and PRs.

- Once assigned, an ID's meaning never changes, and IDs are never reused.
- New features get new, non-colliding IDs; `ROADMAP.md` is the authoritative ID registry.
- Closely related capabilities are absorbed into existing IDs rather than split: run-of-show lives in F-405 (day-of runbook); consent separation lives in F-403 (lead capture & consent).

## Lifecycle Model (the spine of the architecture)

An **EVENT** is the core entity. It moves through four stages, and every stage-scoped feature attaches to exactly one:

- **STAGE 1 — IDEATE:** concept, venue, date, budget, feasibility (F-101–F-109)
- **STAGE 2 — COMPLY:** permits, documents, deadlines, insurance (F-201–F-214)
- **STAGE 3 — MARKET:** event page, promotion, RSVPs, reminders (F-301–F-309)
- **STAGE 4 — OPERATE & ADMINISTER:** check-in, day-of ops, leads, money, post-mortem (F-401–F-413)

Three horizontal domains sit beside the stages: **Cross-Event Intelligence** (F-5xx), **AI Assist** (F-6xx), **Platform & Rules Administration** (F-7xx).

**Architectural implication:** one Event record with stage-scoped modules, not four apps. The permit plan (Stage 2) is generated FROM the intake (Stage 1); the event page (Stage 3) is generated FROM the same intake; check-in (Stage 4) writes back to the same record. One source of truth, four views.

## AI Policy (governs F-6xx)

AI may draft and extract; it may never make the authoritative permit determination or publish a rule. Deterministic evaluation (F-201) is the only source of regulatory output. Every AI-extracted value is user-confirmed before it enters rule evaluation.

## Definition of Iron-Clad (Phase 1 quality bar)

- Deterministic engine output: same event + same ruleset + same date → same plan, every time.
- Every plan line shows its verification status. Source-bearing lines cite an official source; a COVERAGE_GAP finding that carries no citation visibly states that the combination is not covered by this ruleset version, and never invents a citation or implies a source is merely missing (that is RESEARCH_REQUIRED's meaning; the published legend calls COVERAGE_GAP "combination not modeled by this ruleset version").
- The full fixture suite passes (6 scenarios + boundary fixtures, `test-scenario-answer-key.md` v6): 100% of expected findings, zero false omissions, zero false additions, correct verdicts.
- Zero fabricated permit facts; RESEARCH_REQUIRED renders "confirm with agency"; OFFICIAL_CONFLICT renders both readings.
- The ruleset's SOURCE_CONFIRMED facts are signed off by the verification owner and `BASELINE.md` flips nyc.v2.8 to APPROVED before the demo.
- Nothing in the core path is mocked, seeded, or hardcoded to look like engine output.

## Green Gate (target end of day 8) — the demo decision point

The full fixture suite passes as unit tests and all 6 scenarios pass end-to-end through the real UI.

Under the two-track model (Decision 10) the gate no longer gates stretch start; it gates the demo narrative:

- **Gate green:** the permit-planning deep dive is the demo; finished Track B features become the finale.
- **Gate red at final rehearsal:** the fallback demo leads with Track B (event page → RSVP → live QR check-in) plus however far the core honestly works — shown as-is, never mocked. The rules snapshot banner and any working plan generation still appear; a partial engine is presented as partial.

Permitted demo fallbacks for stretch features: seeded RSVP data, simulated email send shown in-product. Never permitted: hardcoded permit plans presented as engine output, fake source citations, hardcoded verdicts.

## Team Lanes (Phase 0–1.5)

One integration point (the `events` schema — agreed by all four devs before any lane codes); four lanes with minimal merge conflicts:

- **Dev 1 — Rules engine + verdict:** F-201, F-102; owns engine fidelity to `rules/nyc-rules.v2.8.json` and the fixture suite. Verify: full fixture suite (scenarios + boundaries) passes as automated tests.
- **Dev 2 — Intake + plan UI:** F-101 (incl. contradiction checks, "I don't know"), F-206, plan rendering. Verify: Scenario A renders end-to-end with citations + snapshot banner.
- **Dev 3 — Checklist + portals:** F-202, F-204. Verify: plan converts to checklist; every permit links to its portal with its document list.
- **Dev 4 — Alerts + platform:** F-203, DB migrations, deploy, demo environment; **owns verification sign-off**: confirms the ruleset's SOURCE_CONFIRMED facts in a browser (evidence pre-collected in `VERIFICATION-SOURCES.md`) and works the open research items (OPEN-QUESTIONS §2). Verify: a seeded deadline fires a real email/SMS; `BASELINE.md` flips nyc.v2.5 to APPROVED.

Track B staffing is the team's kickoff call (default suggestion: Dev 3 → F-301/F-302 and Dev 4 → F-401/F-402 as their core items complete; F-205 stays with Dev 1 but begins only after the F-201/F-202 views merge). The invariant from Decision 10: a dev holding an unmerged core blocker works the blocker first, and parallel Track B branches never touch core-path files.

## Dependency Graph (build-order constraints)

- F-101 → everything (single source of truth)
- F-201 → F-102, F-202, F-203, F-204, F-205, F-208, F-405; ruleset versioning (F-201) → F-503, F-712, F-713, F-714
- F-201 → F-206 plan rendering; F-202 → F-206 checklist rendering
- F-301 → F-302 → F-306/F-307; F-302 optionally enriches F-401 with pre-registered lookup
- F-401 → F-402/F-403 → F-404, F-407
- F-104 → F-406 → F-407 → F-501/F-502
- F-701 → F-702 → F-703 → F-704/F-213; F-701/F-702/F-703 jointly gate authenticated user-owned product data and external beta
- Twilio plumbing: built once for F-203, reused by F-305, F-413
- QR infra: built once for F-401, reused by F-303
- F-601 (open-ended intake) → F-109 becomes necessary (scope support states: can we handle the scope the organizer described?)

## Demo Plan (permit-planning deep dive)

1. **Scenario A (anchor):** Bushwick street activation, 35 days out, classified Large → INFEASIBLE: "the published 45-day deadline passed July 12" → the deadline ladder renders (Small 14 / Medium 30 / Large 45) → rescope to Medium → FEASIBLE-AT-RISK, "apply within 5 days" (the DOHMH 30-day notification lands the same day) → checklist → portal links.
2. **Scenario B (the judge test):** gallery event → "no new city event requirement identified from your answers" plus exactly two confirmations. The system that says "almost nothing, and here's what to confirm" is the system you trust.
3. **Scenario D (the yellow state):** block party, 70 days out → FEASIBLE-AT-RISK, "apply within 10 days" — and no insurance line (block parties without rides are exempt). The absence is a credibility beat.
4. **Scenario F (the branch):** rooftop party → CONDITIONAL branch table: license coverage and sound audibility; the no-license branch misses the SLA window by one business day. The coarse assembly-approval answer remains confirmation context and cannot establish exact PACO/PA-permit coverage (#188).
5. Rules snapshot banner + a live source-citation click-through; an OFFICIAL_CONFLICT rendering (Parks exactly-20 or TUA) if time allows.
6. If stretch is green: seed synthetic guests, give audience participants organizer-provided synthetic name/contact aliases, then live QR check-in on their phones. No attendee enters personal contact data.

## Rules Administration (until F-710–F-715 exist)

Performed manually: the rules JSON is versioned in git, the answer key is the test runner, and PRs are the review workflow.

## Spec-Driven Development

- One spec per F-id in `/specs`; work follows the two-track model and dependency graph above, not a core-then-stretch sequence. F-206 plan rendering follows F-201, while its checklist integration waits for F-202. Phases 2+ get specs when scheduled, not now.
- F-201's acceptance suite is the fixture set in `test-scenario-answer-key.md` (v6, derived from the ruleset). Authority for any disagreement: primary source → published rule → approved fixture → engine output → UI copy; fix the lower level, never bend the engine to a broken expectation.
- `rules/nyc-rules.v2.8.json` is the crown jewel; version it like code. No fact enters it without an evidence reference to `VERIFICATION-SOURCES.md`; gaps are RESEARCH_REQUIRED, conflicts are OFFICIAL_CONFLICT, never guesses.
