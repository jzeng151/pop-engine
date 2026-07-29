# F-106 · Date Advisor

**Status:** PROPOSED (2026-07-26) — ready for review; not implementable until approved and listed in `docs/BASELINE.md`.

**Phase:** 3 · **Issue:** [#31](https://github.com/jzeng151/pop-engine/issues/31) · **Owner:** TBD · **Reviewer:** product owner plus affected architecture, contract, security, and lane owners (TBD) · **Approval date:** —

## Purpose and User Outcome

Given a complete event scope and target month, an organizer can see the earliest dates the approved rules engine classifies as feasible, at risk, conditional, or infeasible.

## Scope

**In scope**

- Evaluate candidate dates in a target month using the same engine, ruleset, holiday calendar, and explicit `today` as F-102.
- Return the earliest dates by verdict with the deadline drivers and unresolved facts.
- Allow the organizer to choose a result into a new event revision and re-evaluate normally.

**Non-goals**

- Weather, venue availability, staffing, agency appointment availability, optimization across scope, or a guarantee of approval.
- A separate deadline calculator or jurisdiction-specific date code.

## Dependencies and Baseline

- F-101, F-201, F-102, and approved Event Revisions.
- ADR for date library and versioned New York holiday source.
- Baseline at draft time: PRD, Roadmap, Design, and Phase 0–1.5 Architecture approved 2026-07-22; `ARCHITECTURE-FUTURE.md` approved as a planning target 2026-07-25; NYC ruleset `nyc.v2.7`, rules schema `popengine-rules/v2`, and scenario fixtures v5 where regulatory output is consumed.
- The approval PR must re-pin any baseline version that changes before approval. A proposed or superseded input blocks implementation.

## Inputs, Outputs, State, Validation, and Errors

- Inputs are a complete non-date scope, target month, explicit `today`, ruleset, and holiday calendar; output is a deterministic candidate-date result set.
- Each candidate is a full evaluation. Evaluation errors are failed candidates, never no-requirement or feasible results.
- Unknown/conflict/research-required inputs propagate through each verdict and remain visible in the result explanation.
- Missing or unresolved material data stays visibly unset, unknown, pending, or failed as appropriate; it never becomes a successful or complete result.
- Invalid input produces a field or action-specific error without partial mutation. Retriable external failures preserve the user's confirmed state and expose a safe retry.

## UI and Accessibility

- Calendar/list results use text verdicts and deadline explanations, support keyboard selection, and distinguish unavailable evaluation from infeasibility.
- The complete workflow is keyboard operable, uses programmatic labels and visible focus, does not encode status by color alone, and announces asynchronous success or failure.
- Empty, loading, permission-denied, validation, provider-failure, and unavailable states have explicit copy and a safe next action.

## System Impact

| Concern              | Proposed impact                                                                                                                 |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| API                  | Advisor evaluation and optional apply-date operations require approved OpenAPI request limits and deterministic context fields. |
| Schema               | No new regulatory persistence; save only an event revision when the user applies a date.                                        |
| Jobs                 | None unless performance measurements require a bounded asynchronous evaluation job.                                             |
| Providers            | Versioned holiday calendar source only; no weather or venue provider.                                                           |
| Privacy and security | Workspace scope and evaluation rate limits; no intake values in logs.                                                           |

Exact HTTP, JSON Schema, migration, job, and provider shapes belong in their reviewed machine contracts; this proposal does not authorize parallel local types or edits to merged migrations.

## Acceptance Criteria

1. **F106-AC-01:** Every candidate date on or after explicit `today` is evaluated by the same engine path and exact ruleset/calendar/`today` inputs as a normal plan; dates before `today` are never candidates.
2. **F106-AC-02:** The earliest result in each shown verdict class is chronologically correct within the requested month; a month with no remaining candidate dates returns an explicit unavailable result.
3. **F106-AC-03:** Business-day, hard-floor, dependency-gated, unknown, and official-conflict behavior matches F-102 for the same date.
4. **F106-AC-04:** An evaluation error is labeled failed and cannot be returned as feasible or silently skipped.
5. **F106-AC-05:** Applying a suggested date creates a normal revision and plan; the advisor result itself is not authoritative plan output.

## Fixtures and Verification

- Planned automated fixture IDs are the acceptance IDs above; each must map one-to-one to a runnable test before approval can claim implementation readiness.
- Regulatory fixtures: Approved scenarios A–F plus all date and business-day boundary fixtures, evaluated across representative month edges.
- Security-sensitive and cross-workspace paths require negative authorization tests; provider paths require success, duplicate-delivery, retry, invalid-signature, and permanent-failure tests where applicable.

## Allowed Footprint and Coordination

- `apps/web` and `apps/api` feature code and tests.
- New ordered forward migrations and approved OpenAPI/JSON Schema changes required by this feature.
- No repository restructuring, speculative package, or unrelated feature edit.
- Shared contracts, migrations, provider adapters, engine/rules artifacts, consent policy, and cross-lane UI primitives require the approvals named in `docs/DOCUMENTATION-GOVERNANCE.md` §6.

## Rollout and Fallback

- Bound the first release to one target month per request; widen only after measured need and performance evidence.
- Rollback disables the new surface and workers/provider calls without deleting confirmed user data or rewriting immutable plans, rulesets, revisions, or history.

## Approval Blockers

- Resolve OPEN-QUESTIONS R-10 and approve the date/holiday ADR.
- Resolve SPEC-CONFLICT #130. `F106-AC-03` requires business-day behavior matching F-102, and F-102 inherits F-201 AC 10's requirement that business days be counted against the pinned calendar. That calendar is deliberately unpublished: no located source defines "business day" for a filing lead, so publishing one would invent the semantics rather than record them (`apps/api/src/calendar.ts`). This is not an approval step. Until it resolves, every business-day deadline renders NOT_CALCULABLE, and a date advisor cannot rank candidate dates on windows the engine declines to compute.
- Approve evaluation request limits and result wording.
- Assign the owner and independent reviewer, approve this spec, and add it to `docs/BASELINE.md`.
