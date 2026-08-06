# F-502 · Historical Event Comparison

**Status:** PROPOSED (2026-07-26) — ready for review; not implementable until approved and listed in `docs/BASELINE.md`.

**Phase:** 3 · **Issue:** [#47](https://github.com/jzeng151/pop-engine/issues/47) · **Owner:** TBD · **Reviewer:** product owner · **Approval date:** —

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

- F-406/F-407 confirmed outcome snapshots and retained immutable plan/application data. F407-AC-01 freezes attendance versus RSVP, leads, P&L, and permit-timeline adherence; it does not carry permit burden, so F-502 pins the immutable plan each burden value is read from rather than inferring one from a snapshot (F502-AC-07).
- Approved comparison metrics and compatibility rules.
- The approved plan-acceptance contract that defines and populates `events.current_plan_id`, plus its named owner. F502-AC-07 makes that accepted-plan pointer the default permit-burden source, and the approved Event Revision contract assigns the pointer to separate plan-acceptance work, so implementing F-502 after only its other prerequisites can find no such pointer. F-502 does not invent one: until that contract is approved, either it is a prerequisite of this spec or an approved pre-cutover burden source is named here in its place.
- F-103 and the exact shared `permit-burden/v1` definition and fixtures that resolve [SPEC-CONFLICT #208](https://github.com/jzeng151/pop-engine/issues/208).
- Baseline at draft time: PRD, Roadmap, Design, and Phase 0–1.5 Architecture approved 2026-07-22; `ARCHITECTURE-FUTURE.md` approved as a planning target 2026-07-25; NYC ruleset `nyc.v2.7`, rules schema `popengine-rules/v2`, and scenario fixtures v5 where regulatory output is consumed.
- The approval PR must re-pin any baseline version that changes before approval. A proposed or superseded input blocks implementation.

## Inputs, Outputs, State, Validation, and Errors

- Inputs are organizer-selected workspace events and, for each event, either F-407's exact per-event current confirmed outcome-snapshot pointer or an explicitly selected historical confirmed snapshot version, plus one exact retained immutable plan version per event for permit burden; output is a derived comparison pinned to those exact snapshot, plan, metric, and source versions.
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
2. **F502-AC-02:** Cost, preparation time, and attendance use approved metric definitions and show units/source versions. Permit burden consumes F-103's exact shared `permit-burden/v1` sets, declared in `docs/proposals/permit-burden-v1.ts` and read rather than restated here, with its final-finding identity, deduplication rule, definite/unresolved treatment, version, and fixtures and cannot define a separate interpretation. Each burden value is computed from the stored final findings of the one plan version pinned under F502-AC-07, which it names, and the engine is never re-run.
3. **F502-AC-03:** Missing, partial, incompatible-version, or incompatible-currency values display as unavailable rather than zero or a coerced comparison.
4. **F502-AC-04:** Historical regulatory results remain pinned to their original artifact and are never recomputed for this report.
5. **F502-AC-05:** Reordering selected events changes presentation only and leaves metric values unchanged.
6. **F502-AC-06:** The default comparison captures F-407's per-event current confirmed outcome-snapshot pointer with the exact snapshot it reads and rejects/rebuilds if that pointer changes before the comparison is returned. An organizer may instead select an exact older confirmed version, which remains visibly labeled historical; F-502 never chooses an arbitrary confirmed snapshot or presents a superseded snapshot as current.
7. **F502-AC-07:** Permit burden derives from exactly one immutable plan version per event, pinned and displayed with the value. The default is the plan the event's accepted-plan pointer names at read time, captured with the exact version read, and the comparison is rejected or rebuilt if that pointer moves before it is returned; an organizer may instead select an exact retained plan version, which remains visibly labeled historical. When an event retains several plans, F-502 never resolves the choice by recency, generation order, or any other implicit rule: with no accepted plan and no explicit selection, that event's permit burden is unavailable under F502-AC-03 rather than defaulted.

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
- Approve the plan-acceptance contract that supplies `events.current_plan_id`, and name its owner, or approve an explicit pre-cutover permit-burden source for F502-AC-07.
- Assign the owner, approve this spec, and add it to `docs/BASELINE.md`. The reviewer and approver is the product owner (`docs/DOCUMENTATION-GOVERNANCE.md` §6), which is what this spec's header records, and that is the whole requirement: the independent-reviewer element this blocker used to carry was retired on 2026-08-05 (product owner; see §6 and `docs/BASELINE.md`). Until those three things are done this blocker is not satisfied and this spec is not approved: it stays PROPOSED under governance §3, its Approval date stays `—`, and it is not implementable and not listed in `docs/BASELINE.md`. Retiring the reviewer element made this spec approvable; it did not approve it.
