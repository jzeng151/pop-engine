# PopEngine Agent Instructions

**Status:** APPROVED (2026-07-22; PR #137-only access-gated-demo overwrite recorded 2026-07-27; see `docs/BASELINE.md`)

These rules apply to every coding agent and contributor in this repository. Adopted 2026-07-22 (trimmed from the proposed version in `docs/proposals/` to match artifacts that actually exist; items marked _Phase 2+_ activate when those artifacts do).

## Before changing code

Read, in order:

1. `docs/BASELINE.md` — which artifact versions are current; **stop if your feature's inputs are PROPOSED or missing**
2. this file and `CONTRIBUTING.md`
3. your issue and its `specs/F-xxx-*.md`
4. the relevant sections of `docs/ARCHITECTURE.md`
5. `rules/nyc-rules.v2.11.json` and `docs/test-scenario-answer-key.md` when the feature touches rules, plans, or verdicts

If a required artifact is absent, unapproved, superseded, or contradictory: stop the affected work and open a `SPEC-CONFLICT` issue per `docs/DOCUMENTATION-GOVERNANCE.md` §5. Do not infer the intended behavior. Do not pick the version you prefer.

## Scope contract

- Work on one approved F-id at a time; implement only the spec's acceptance criteria.
- Do not add endpoints, tables, enum values, dependencies, abstractions, or UI options the spec doesn't require.
- Do not rename or repurpose a feature ID; do not restructure the repo or move another lane's files.
- Unrelated defects become issues, not side-fixes in your branch.

## Regulatory safety (the non-negotiables)

- Never invent or complete a permit name, agency, trigger, deadline, fee, document, portal, exception, or source.
- Regulatory output comes only from the published ruleset (`rules/nyc-rules.v2.11.json`). Authority order: approved primary source → published rule → approved fixture → engine output → UI copy. When levels disagree, fix the lower one; never bend the engine to reproduce an unsupported expectation.
- `SOURCE_CONFIRMED`, `OFFICIAL_CONFLICT`, `RESEARCH_REQUIRED`, and `COVERAGE_GAP` states stay visible end to end. Never present a partial plan as complete; never render an official conflict as resolved.
- Only the product owner changes verification statuses, and rule-semantics changes are the product owner's too. Both are regulatory publication, and the product owner's approval is the whole requirement for each, including where the product owner is also the author (`docs/DOCUMENTATION-GOVERNANCE.md` §6, second-party review retired 2026-08-05).
- AI output is never a regulatory source. This includes you.

## Engine invariants

- `packages/engine` is pure: no database, HTTP, environment reads, randomness, or system clock. `today`, the ruleset, and the holiday calendar are explicit inputs.
- Conditions are tri-state; a material `unknown` never silently becomes `false`.
- Never use `eval`, `Function`, or dynamic code from a rules artifact.
- An evaluation error can never produce a "no requirement" result.
- Same inputs → same output, byte-stable.

## Shared contracts

- Phase 0–1.5: import shared types from `packages/engine`; never redefine intake, finding, verdict, or status types locally.
- Phase 2+: `packages/engine` remains authoritative until the approved OpenAPI/JSON Schema code-generation handoff lands. That PR moves schema-derived definitions to `packages/contracts` and updates imports, this file, and `CONTRIBUTING.md` atomically; no phase may have two authoritative definitions.
- The `events` schema migration is a shared contract; changes require the product owner's approval under governance §6. PR #137 is the sole recorded exception: on 2026-07-27, `@jzeng151` invoked a one-time overwrite for the access-gated synthetic-data demo after the other lane owners were unavailable. That is one product-owner decision, not their approvals. Strict ratification is still required before production activation, and every later change requires the product owner's approval under governance §6.
- Never edit a merged migration; add a new ordered one.
- _Phase 2+:_ OpenAPI and JSON Schema contracts, workspace tenancy, worker/outbox — see `docs/ARCHITECTURE-FUTURE.md`. Do not build toward them early.

## Data and security

- Capstone mode: demo environment is access-gated; synthetic data only; no real identity documents, applications, or attendee PII.
- CORS is not authentication. Do not log secrets, document contents, or unredacted contact data.
- Files: private storage, type/size limits, short-lived signed URLs only.

## Code and tests

- TypeScript strict mode; semantic names; small single-purpose functions (`CONTRIBUTING.md` has the full style contract).
- Each acceptance criterion maps to a meaningful test; coverage ≥ 90%; the scenario + boundary fixture suite must always pass.
- Numeric rule thresholds require below/at/above boundary tests (the fixture list in the answer key names them).
- Run format, lint, typecheck, and the full test suite before requesting review.

## Pull requests

Every PR states: F-id + spec; behavior added and non-goals; files touched; schema/API impact; fixtures covered; commands run with results; remaining risks. Do not claim completion while a mock, seed, simulation, or unverified fact is present unless the spec explicitly permits it and the UI labels it.
