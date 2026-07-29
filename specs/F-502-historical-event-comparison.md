# F-502 · Historical Event Comparison

**Status:** PROPOSED (2026-07-26) — ready for review; not implementable until approved and listed in `docs/BASELINE.md`.

**Phase:** 3 · **Issue:** [#47](https://github.com/jzeng151/pop-engine/issues/47) · **Owner:** TBD · **Reviewer:** product owner plus affected architecture, contract, security, and lane owners (TBD) · **Approval date:** —

## Purpose and User Outcome

An organizer can compare permit burden, cost, preparation time, and attendance across explicitly selected past events without an opaque similarity algorithm.

## Scope

**In scope**

- Select two or more workspace events and compare approved metric snapshots side by side.
- Show scope descriptors, source versions, coverage, and incomparable/missing measures.
- Link to source event/post-mortem details.

**Non-goals**

- Automatic similarity scoring, recommendations, predictions, cross-customer benchmarks, or rewriting historical plans.
- Comparing values with incompatible definitions/currencies without an explicit unavailable result.

## Dependencies and Baseline

- F-406/F-407 confirmed outcome snapshots and retained immutable plan/application data.
- Approved comparison metrics and compatibility rules.
- F-103 and the exact shared `permit-burden/v1` definition and fixtures that resolve [SPEC-CONFLICT #208](https://github.com/jzeng151/pop-engine/issues/208).
- Baseline at draft time: PRD, Roadmap, Design, and Phase 0–1.5 Architecture approved 2026-07-22; `ARCHITECTURE-FUTURE.md` approved as a planning target 2026-07-25; NYC ruleset `nyc.v2.7`, rules schema `popengine-rules/v2`, and scenario fixtures v5 where regulatory output is consumed.
- The approval PR must re-pin any baseline version that changes before approval. A proposed or superseded input blocks implementation.

## Inputs, Outputs, State, Validation, and Errors

- Inputs are organizer-selected workspace events; output is a derived comparison keyed to exact metric/source versions.
- Comparison is available only for compatible metric versions/units; missing or incompatible values remain explicit.
- Historical permit findings stay pinned to their original ruleset; the feature does not re-evaluate them.
- Missing or unresolved material data stays visibly unset, unknown, pending, or failed as appropriate; it never becomes a successful or complete result.
- Invalid input produces a field or action-specific error without partial mutation. Retriable external failures preserve the user's confirmed state and expose a safe retry.

## UI and Accessibility

- Table/chart views preserve a linear accessible table, label units/versions, and explain missing/incomparable cells.
- The complete workflow is keyboard operable, uses programmatic labels and visible focus, does not encode status by color alone, and announces asynchronous success or failure.
- Empty, loading, permission-denied, validation, provider-failure, and unavailable states have explicit copy and a safe next action.

## System Impact

| Concern              | Proposed impact                                                                                                      |
| -------------------- | -------------------------------------------------------------------------------------------------------------------- |
| API                  | Comparison query and optional saved-selection operations require approved OpenAPI contracts.                         |
| Schema               | No persistence for ephemeral comparisons; save only selected IDs/metric versions if a retained use case is approved. |
| Jobs                 | None.                                                                                                                |
| Providers            | None.                                                                                                                |
| Privacy and security | All selected events and source metrics must belong to the active workspace; aggregates contain no attendee PII.      |

Exact HTTP, JSON Schema, migration, job, and provider shapes belong in their reviewed machine contracts; this proposal does not authorize parallel local types or edits to merged migrations.

## Acceptance Criteria

1. **F502-AC-01:** Only explicitly selected events from the active workspace enter a comparison.
2. **F502-AC-02:** Cost, preparation time, and attendance use approved metric definitions and show units/source versions. Permit burden consumes F-103's exact shared `permit-burden/v1` kind/disposition filters, final-finding identity, deduplication rule, definite/unresolved treatment, version, and fixtures and cannot define a separate interpretation.
3. **F502-AC-03:** Missing, partial, incompatible-version, or incompatible-currency values display as unavailable rather than zero or a coerced comparison.
4. **F502-AC-04:** Historical regulatory results remain pinned to their original artifact and are never recomputed for this report.
5. **F502-AC-05:** Reordering selected events changes presentation only and leaves metric values unchanged.

## Fixtures and Verification

- Planned automated fixture IDs are the acceptance IDs above; each must map one-to-one to a runnable test before approval can claim implementation readiness.
- Regulatory fixtures: Permit burden reuses the exact shared `permit-burden/v1` F-103 fixtures; F-502 adds no separate regulatory interpretation.
- Security-sensitive and cross-workspace paths require negative authorization tests; provider paths require success, duplicate-delivery, retry, invalid-signature, and permanent-failure tests where applicable.

## Allowed Footprint and Coordination

- `apps/web` and `apps/api` feature code and tests.
- New ordered forward migrations and approved OpenAPI/JSON Schema changes required by this feature.
- No repository restructuring, speculative package, or unrelated feature edit.
- Shared contracts, migrations, provider adapters, engine/rules artifacts, consent policy, and cross-lane UI primitives require the approvals named in `docs/DOCUMENTATION-GOVERNANCE.md` §6.

## Rollout and Fallback

- Use explicit user selection; add similarity assistance only through a later approved feature.
- Rollback disables the new surface and workers/provider calls without deleting confirmed user data or rewriting immutable plans, rulesets, revisions, or history.

## Approval Blockers

- Approve metric compatibility, minimum source coverage, unit/currency behavior, and selected-event limit.
- Assign the owner and independent reviewer, approve this spec, and add it to `docs/BASELINE.md`.
