# F-410 · Entry/Exit Occupancy and Re-entry

**Status:** PROPOSED (2026-07-26) — ready for review; not implementable until approved and listed in `docs/BASELINE.md`.

**Phase:** 3 · **Issue:** [#42](https://github.com/jzeng151/pop-engine/issues/42) · **Owner:** TBD · **Reviewer:** product owner plus affected architecture, contract, security, and lane owners (TBD) · **Approval date:** —

## Purpose and User Outcome

Door staff can record both entry and exit so PopEngine can show current occupancy and re-entry history without mislabeling cumulative check-ins.

## Scope

**In scope**

- Append entry and exit events per attendee/credential, support re-entry, and derive current occupancy from accepted directional events.
- Expose correction/reversal events rather than editing history.
- Upgrade F-402 wording to occupancy only when data coverage is valid.

**Non-goals**

- People counting sensors, fire-code enforcement, predictive crowd control, anonymous occupancy inference, or door hardware.
- Staff credentials owned by F-411.

## Dependencies and Baseline

- F-401 and F-402; F-409 when offline behavior is enabled.
- Approved attendee identity, directional-event, correction, and capacity-warning contracts.
- Baseline at draft time: PRD, Roadmap, Design, and Phase 0–1.5 Architecture approved 2026-07-22; `ARCHITECTURE-FUTURE.md` approved as a planning target 2026-07-25; NYC ruleset `nyc.v2.7`, rules schema `popengine-rules/v2`, and scenario fixtures v5 where regulatory output is consumed.
- The approval PR must re-pin any baseline version that changes before approval. A proposed or superseded input blocks implementation.

## Inputs, Outputs, State, Validation, and Errors

- Inputs are authenticated directional operations; outputs are append-only entry/exit history and a derived current count.
- Attendee state alternates outside → inside → outside; invalid duplicate direction is rejected or explicitly corrected under the approved policy.
- Occupancy is unavailable when directional history is incomplete, failed, or has an unresolved cross-device occurrence-order conflict; it never falls below zero.
- Missing or unresolved material data stays visibly unset, unknown, pending, or failed as appropriate; it never becomes a successful or complete result.
- Invalid input produces a field or action-specific error without partial mutation. Retriable external failures preserve the user's confirmed state and expose a safe retry.

## UI and Accessibility

- Entry and exit actions are distinct, confirm the attendee/current state, support rapid keyboard/scanner use, and show count coverage.
- The complete workflow is keyboard operable, uses programmatic labels and visible focus, does not encode status by color alone, and announces asynchronous success or failure.
- Empty, loading, permission-denied, validation, provider-failure, and unavailable states have explicit copy and a safe next action.

## System Impact

| Concern              | Proposed impact                                                                                                |
| -------------------- | -------------------------------------------------------------------------------------------------------------- |
| API                  | Directional-operation and occupancy projection contracts require approved OpenAPI idempotency/conflict shapes. |
| Schema               | Forward migration for append-only entry/exit/correction events; do not repurpose existing check-in timestamps. |
| Jobs                 | None except F-409 sync when enabled.                                                                           |
| Providers            | None.                                                                                                          |
| Privacy and security | Role/workspace scope, minimal attendee projection, audit history, and rate limits.                             |

Exact HTTP, JSON Schema, migration, job, and provider shapes belong in their reviewed machine contracts; this proposal does not authorize parallel local types or edits to merged migrations.

## Acceptance Criteria

1. **F410-AC-01:** Accepted entry increments and accepted exit decrements current occupancy exactly once; re-entry repeats the valid sequence.
2. **F410-AC-02:** Duplicate/replayed operations are idempotent and cannot double-count or drive occupancy below zero.
3. **F410-AC-03:** An invalid direction produces a visible conflict and no silent history rewrite. An authorized correction binds a stable request identity to the exact unresolved operation set and expected attendee-direction version, compare-and-swaps both, and appends one auditable event; a recognized retry returns that result, while a mismatch appends nothing and requires rebuilt resolution.
4. **F410-AC-04:** This feature supplies the complete accepted entry/exit data that F-402 AC 3 already names as the precondition for occupancy language ("no exit tracking in MVP; occupancy claims require F-410"). It satisfies that precondition; it does not restate or redefine F-402's criterion. Where the data is incomplete, F-402's existing rule stands unchanged and counts remain labeled check-ins.
5. **F410-AC-05:** Direction acceptance compare-and-swaps the attendee's current directional state, so concurrent distinct operations from the same state cannot both succeed; the first valid operation is accepted exactly once and each loser returns the visible invalid-direction conflict without changing occupancy. Concurrent door devices converge to the same derived count from the accepted order.
6. **F410-AC-06:** A delayed offline direction that conflicts with a later online direction preserves both operations and puts attendee state and occupancy into a visible unresolved/unavailable state until authorized correction; the offline/out-of-order fixture cannot report a confident count from server append order alone.

## Fixtures and Verification

- Planned automated fixture IDs are the acceptance IDs above; each must map one-to-one to a runnable test before approval can claim implementation readiness.
- Regulatory fixtures: none; this feature does not define regulatory ground truth.
- Security-sensitive and cross-workspace paths require negative authorization tests; provider paths require success, duplicate-delivery, retry, invalid-signature, and permanent-failure tests where applicable.

## Allowed Footprint and Coordination

- `apps/web` and `apps/api` feature code and tests.
- New ordered forward migrations and approved OpenAPI/JSON Schema changes required by this feature.
- No repository restructuring, speculative package, or unrelated feature edit.
- Shared contracts, migrations, provider adapters, engine/rules artifacts, consent policy, and cross-lane UI primitives require the approvals named in `docs/DOCUMENTATION-GOVERNANCE.md` §6.

## Rollout and Fallback

- Keep existing check-in counts alongside the new metric until directional coverage and reconciliation tests pass.
- Rollback disables the new surface and workers/provider calls without deleting confirmed user data or rewriting immutable plans, rulesets, revisions, or history.

## Approval Blockers

- Approve directional state machine, correction policy, attendee correlation, and occupancy coverage wording.
- Assign the owner and independent reviewer, approve this spec, and add it to `docs/BASELINE.md`.
