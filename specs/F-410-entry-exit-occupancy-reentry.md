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
- The F-701/F-702/F-703 gate. `F410-AC-08` admits a directional operation only by the actor's current F-703 door permission for that exact event, re-read from stored role and membership, so F-703 supplies the permission matrix, F-702 the membership that permission is read against, and F-701 the authenticated actor. No earlier revision of this spec declared them, which left AC-08 checking a permission its own dependency list did not name. All three are PROPOSED, so the gate is not an approved input today and this spec is not implementable against it until they are approved and listed in `docs/BASELINE.md`.
- Approved attendee identity, directional-event, correction, and capacity-warning contracts.
- Baseline at draft time: PRD, Roadmap, Design, and Phase 0–1.5 Architecture approved 2026-07-22; `ARCHITECTURE-FUTURE.md` approved as a planning target 2026-07-25; NYC ruleset `nyc.v2.7`, rules schema `popengine-rules/v2`, and scenario fixtures v5 where regulatory output is consumed.
- Operand binding for client-supplied identities: `specs/F-411-staff-roles-credentialed-entry.md` F411-AC-08 states once, for this whole branch, that a client-supplied identity is committed with the operands that determine its recorded result and that a reuse carrying different operands is a conflict rather than a replay. F410-AC-03 and F410-AC-07 both rely on it. F-411 is PROPOSED, so that rule is not an approved input today and this spec is not implementable against it until F-411 is approved or the rule is promoted to an approved shared invariant; F411-AC-08 records both paths.
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
3. **F410-AC-03:** An invalid direction produces a visible conflict and no silent history rewrite. An authorized correction binds a stable request identity to the exact unresolved operation set and expected attendee-direction version, compare-and-swaps both, and appends one auditable event; a recognized retry returns that result only when the operation set and version it presents equal the ones committed with that identity, per the operand-binding rule in F411-AC-08, while a mismatch is refused as a conflict, appends nothing, and requires rebuilt resolution.
4. **F410-AC-04:** This feature supplies the complete accepted entry/exit data that F-402 AC 3 already names as the precondition for occupancy language ("no exit tracking in MVP; occupancy claims require F-410"). It satisfies that precondition; it does not restate or redefine F-402's criterion. Where the data is incomplete, F-402's existing rule stands unchanged and counts remain labeled check-ins.
5. **F410-AC-05:** Direction acceptance compare-and-swaps the attendee's current directional state, so concurrent distinct operations from the same state cannot both succeed; the first valid operation is accepted exactly once and each loser returns the visible invalid-direction conflict without changing occupancy. Concurrent door devices converge to the same derived count from the accepted order.
6. **F410-AC-06:** A delayed offline direction that conflicts with a later online direction preserves both operations and puts attendee state and occupancy into a visible unresolved/unavailable state until authorized correction; the offline/out-of-order fixture cannot report a confident count from server append order alone.
7. **F410-AC-07:** Every directional operation, online and offline alike, carries a client-generated operation identity supplied by the device, committed under a uniqueness constraint scoped to the event together with the operation's accepted or rejected outcome. A replay presenting the same identity returns that stored outcome and neither changes occupancy nor appends a second event; a genuinely separate scan sends a new identity. This is operation identity, never content uniqueness: the same attendee legitimately enters, exits, and re-enters with otherwise identical payloads, so attendee, direction, and timestamp may not serve as the key, and a repeated identity is never rejected as a duplicate value.

   That identity binds its operands under the rule F411-AC-08 states for every client-supplied identity on this branch. It is committed together with the operands that determine the operation's result — the event, the attendee, the direction, and the captured instant — and a request presenting a committed identity is a replay, and receives the stored outcome, only when all of them equal what was stored. When any differs, the request is refused as a conflict: it returns no stored outcome, changes no occupancy, and appends no event. Two door devices that generate the same event-scoped identity, or one device that reuses an identity for a different attendee or direction, are therefore refused rather than silently answered with another scan's outcome. Without the binding, the second real entry or exit is omitted from history and from occupancy while its operator sees an acceptance belonging to someone else's scan, which is the failure AC-01's exactly-once counting and AC-06's unresolved state both assume cannot happen. This does not make the payload the key, which the paragraph above forbids: the device-chosen identity is still the key, and the operands are a precondition on reusing it, so a genuine re-entry with an identical payload still sends a new identity and is still counted.

   AC-02 requires duplicate and replayed operations to be idempotent, and nothing else in this spec gives an online operation an identifier to be idempotent on. F-409's operation ID exists only on the offline path, so an implementation reading these criteria alone would have to deduplicate an online operation by payload, which AC-01's re-entry sequence makes wrong by construction: it would drop the second genuine entry of an attendee who left and came back. Storing the rejected outcome as well as the accepted one is what keeps a replayed invalid direction from raising a second AC-03 conflict for one scan.

8. **F410-AC-08:** Every directional operation names the event it acts in and is admitted only by the actor's current F-703 door permission for that exact event, re-read server-side from stored role and membership at the moment of the write and compared inside the same transaction that compare-and-swaps the attendee's directional state under F410-AC-05. A request failing that check is refused before any durable write: it records no directional event, changes no occupancy, commits no F410-AC-07 identity row, and discloses nothing about whether the attendee or the event exists. The check is at the write and not at session start, so a permission removed while an operation is in flight causes that operation to fail rather than commit. Corrections under F410-AC-03 already require authorization and keep the permission they name; this criterion adds the ordinary entry and exit path beside them rather than replacing it.

   Only the correction path said this, and the ordinary path is the one that runs all day. F-702's tenancy check passes for any legitimate workspace member, and AC-01, AC-05 and AC-07 accept and count an operation without asking anything else, so a same-workspace viewer or lower-privilege contributor could drive event-day occupancy and its history while every criterion passed. Occupancy is what F-402 reports and what F410-AC-04 supplies as the precondition for occupancy language at all, so a corrupted count is a false operational claim rather than a private inconvenience.

   The permission itself is F-703's to define and this criterion does not name a role: it requires that the approved door permission for that exact event exist and be checked, and the Approval Blockers carry naming it. Until F-703 names it, this criterion is testable only as "an actor without the approved door permission for that event is refused before any durable write, and an actor whose permission is removed mid-flight does not commit," not against a specific role name.

## Fixtures and Verification

- Planned automated fixture IDs are the acceptance IDs above; each must map one-to-one to a runnable test before approval can claim implementation readiness.
- F410-AC-08 includes a fixture in which a same-workspace member without the door permission submits an entry and is refused with no directional event, no occupancy change, and no identity row, and one in which the permission is removed while an operation is in flight and that operation fails rather than commits.
- F410-AC-07 includes a matched-replay fixture proving occupancy and history are unchanged and the stored outcome is returned, and two mismatched-reuse fixtures: one in which a second device presents an identity already committed for a different attendee, and one in which a device re-presents a committed identity with the opposite direction. Each is refused as a conflict, leaves occupancy and history untouched, and returns no outcome belonging to the stored operation.
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

- Approve directional state machine, correction policy, attendee correlation, and occupancy coverage wording. The approval must also name, with F-703, the door permission F410-AC-08 requires for an ordinary entry or exit, because that criterion checks a permission no approved artifact defines today and may not invent one.
- Assign the owner and independent reviewer, approve this spec, and add it to `docs/BASELINE.md`.
