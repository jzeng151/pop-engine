# F-409 · Offline-Tolerant Check-in

**Status:** PROPOSED (2026-07-26) — ready for review; not implementable until approved and listed in `docs/BASELINE.md`.

**Phase:** 3 · **Issue:** [#41](https://github.com/jzeng151/pop-engine/issues/41) · **Owner:** TBD · **Reviewer:** product owner plus affected architecture, contract, security, and lane owners (TBD) · **Approval date:** —

## Purpose and User Outcome

Check-in staff can continue recording arrivals during a temporary network loss and sync each append-only operation exactly once when connectivity returns.

## Scope

**In scope**

- Queue minimal check-in operations locally with client-generated IDs, visible offline state, retry, and conflict-safe server acknowledgment.
- Sync append-only operations idempotently and remove acknowledged local data.
- Handle duplicate contact/event operations using F-401 identity rules.

**Non-goals**

- Full offline event administration, offline exports, background sync guarantees on every browser, or last-write-wins record editing.
- Occupancy, exit/re-entry, or credential roles owned by F-410/F-411.

## Dependencies and Baseline

- F-401 and approved PWA/local-storage, sync-operation, privacy, and E2E decisions.
- F-701/F-702/F-703 for staff-authenticated production use.
- Baseline at draft time: PRD, Roadmap, Design, and Phase 0–1.5 Architecture approved 2026-07-22; `ARCHITECTURE-FUTURE.md` approved as a planning target 2026-07-25; NYC ruleset `nyc.v2.7`, rules schema `popengine-rules/v2`, and scenario fixtures v5 where regulatory output is consumed.
- The approval PR must re-pin any baseline version that changes before approval. A proposed or superseded input blocks implementation.

## Inputs, Outputs, State, Validation, and Errors

- Input is a minimal check-in operation with event, contact fields, client ID, and captured time; output is queued then server-acknowledged operation.
- State is local-pending → syncing → acknowledged, duplicate-resolved, or rejected; retries reuse the same operation ID.
- Server identity/deduplication remains authoritative; a rejected conflict stays visible for staff resolution and never disappears silently.
- Missing or unresolved material data stays visibly unset, unknown, pending, or failed as appropriate; it never becomes a successful or complete result.
- Invalid input produces a field or action-specific error without partial mutation. Retriable external failures preserve the user's confirmed state and expose a safe retry.

## UI and Accessibility

- A persistent offline/pending count, per-operation status, retry action, and do-not-close warning are screen-reader announced and not color-only.
- The complete workflow is keyboard operable, uses programmatic labels and visible focus, does not encode status by color alone, and announces asynchronous success or failure.
- Empty, loading, permission-denied, validation, provider-failure, and unavailable states have explicit copy and a safe next action.

## System Impact

| Concern              | Proposed impact                                                                                                                                                |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| API                  | Batch/single sync operations require approved OpenAPI idempotency, conflict, and acknowledgment contracts.                                                     |
| Schema               | Forward migration for append-only sync operations/idempotency keys if current check-ins cannot safely hold them.                                               |
| Jobs                 | Client retry plus synchronous server ingestion; no server job required for acceptance.                                                                         |
| Providers            | Browser-native offline storage only.                                                                                                                           |
| Privacy and security | Store the minimum contact data, bind queue to event/staff context, clear acknowledged/expired data, protect shared devices, and never cache organizer records. |

Exact HTTP, JSON Schema, migration, job, and provider shapes belong in their reviewed machine contracts; this proposal does not authorize parallel local types or edits to merged migrations.

## Acceptance Criteria

1. **F409-AC-01:** While offline, a valid check-in is durably queued locally with a unique operation ID and visible pending state.
2. **F409-AC-02:** After reconnection, repeated sync of the same operation creates at most one server check-in and returns the same acknowledgment.
3. **F409-AC-03:** Concurrent devices and preexisting check-ins resolve through F-401 identity rules without losing an operation silently.
4. **F409-AC-04:** Acknowledged data is removed locally; rejected/pending data remains visible until resolved or explicitly discarded with confirmation/audit.
5. **F409-AC-05:** Offline storage contains only the approved minimal fields and is cleared on event close, staff sign-out, or retention expiry.

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

- Enable only on supported browsers after real offline/reconnect E2E tests; otherwise retain online F-401 with a clear unavailable state.
- Rollback disables the new surface and workers/provider calls without deleting confirmed user data or rewriting immutable plans, rulesets, revisions, or history.

## Approval Blockers

- Approve E2E framework/CI, local data/retention policy, sync conflict contract, browser support, and shared-device threat model.
- Assign the owner and independent reviewer, approve this spec, and add it to `docs/BASELINE.md`.
