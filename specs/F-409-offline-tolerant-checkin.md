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
- F-701/F-702/F-703 for staff-authenticated production use: the full gate. F-702 supplies the workspace membership boundary the named workspace and event resolve against and F-703 supplies the permission matrix `F409-AC-07` checks; F-701 supplies the authenticated staff actor both read from. All three are PROPOSED, so the gate is not an approved input today and this spec is not implementable against it until they are approved and listed in `docs/BASELINE.md`.
- Baseline at draft time: PRD, Roadmap, Design, and Phase 0–1.5 Architecture approved 2026-07-22; `ARCHITECTURE-FUTURE.md` approved as a planning target 2026-07-25; NYC ruleset `nyc.v2.7`, rules schema `popengine-rules/v2`, and scenario fixtures v5 where regulatory output is consumed.
- Operand binding and replay ordering for client-supplied identities: `specs/F-411-staff-roles-credentialed-entry.md` F411-AC-08 states once, for this whole branch, that a client-supplied identity is committed with the operands that determine its recorded result and that a reuse carrying different operands is a conflict rather than a replay, and that a committed identity is resolved before any version, generation, state, authority, or limit check whose answer the committed operation itself changed. Every identity criterion below relies on it. F-411 is PROPOSED, so that rule is not an approved input today and this spec is not implementable against it until F-411 is approved or the rule is promoted to an approved shared invariant; F411-AC-08 records both paths.
- The approval PR must re-pin any baseline version that changes before approval. A proposed or superseded input blocks implementation.

## Inputs, Outputs, State, Validation, and Errors

- Input is a minimal check-in operation with the workspace and event it was composed against, contact fields, a client-generated operation ID unique within that workspace and event under F409-AC-02, captured time, and the event lifecycle generation last confirmed by the server; output is queued then server-acknowledged operation.
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

1. **F409-AC-01:** While offline, a valid check-in is durably queued locally with a client-generated operation ID, captured time, the workspace and event the operation was composed against, last-confirmed event lifecycle generation, and visible pending state. The operation ID is unique within that workspace and event, not globally, and the queued operation names them so the sync in F409-AC-02 can present all three together.
2. **F409-AC-02:** After reconnection, sync rechecks the operation's lifecycle generation and F-401's current New York date gate before ingestion; repeated sync of the same operation creates at most one server check-in and returns the same acknowledgment. The server holds exactly one operation record per operation ID within one workspace and event, created under a uniqueness constraint scoped to that workspace and event rather than a global one, and every write that resolves the operation is a versioned transition on that one record: ingestion under this criterion, the closed-event conflict under AC-06, and the terminal resolution AC-05 requires. Concurrent writes therefore serialize on that row rather than on the check-in table, and the loser of any race commits nothing, observes the state the winner committed, and returns it. This is what makes "at most one check-in" also mean "no second outcome that contradicts the check-in". That identity binds its operands under the rule `F411-AC-08` states once for every client-supplied identity on this branch: it is committed together with the request fields that determine the recorded result, including every aggregate, version, and generation the request names, and a later request presenting the same identity with any different operand is refused as a conflict rather than being answered with the stored result. The identity is still the key and the operands are only a precondition on reusing it, so this is not the content uniqueness this criterion already forbids.

   The scope is the tenancy rule `F702-AC-10` already states, applied to this identity rather than restated for it: the sync request names the workspace and event it was composed against, that named scope is validated against the staff actor's stored membership at the moment of the write, and the operation record is created, looked up, and resolved only within it. A globally unique operation ID does not satisfy this. Two offline clients in different events or workspaces can generate the same ID, because the ID is generated on a disconnected device with nothing to coordinate against, and under a global constraint the second one collides with the first. The loser would then have to observe and return the first operation's committed state, which is another workspace's acknowledgment and is exactly what F702-AC-03 forbids disclosing; and if F702-AC-03 does block that read, the second staff member's legitimate check-in cannot be ingested at all and the attendee in front of them is refused on a collision they cannot see or clear.

   A recognized identity is also bound to the operation it was committed with. The replay lookup compares the presented operation's event, captured time, and contact fields against the record the identity names, and a presented operation that differs is not answered as a replay: it is refused as a conflict that stays visible under F409-AC-04, because returning the stored acknowledgment for a different operation would report an attendee as checked in who was not. This makes the identity a retry key for one queued operation rather than a claim on whatever record happens to carry that ID.

3. **F409-AC-03:** Concurrent devices and preexisting check-ins resolve through F-401 identity rules without losing an operation silently.
4. **F409-AC-04:** Acknowledged data is removed locally; rejected/pending data remains visible until resolved, explicitly discarded with confirmation/audit, or carried into AC-05's hard-expiry path, which clears the contact payload without user interaction at the limit and reaches a terminal outcome only on the server check AC-05 requires.
5. **F409-AC-05:** Offline storage contains only approved minimal encrypted fields. Sign-out requires pending/rejected operations to be resolved, securely handed off, or discarded with confirmation and audit. At hard retention expiry the client atomically clears the contact payload without user interaction and records a non-sensitive `expired-unresolved` marker carrying the operation ID plus policy actor/reason/time. That marker is not yet an outcome. Hard expiry can arrive while the device is still offline, and an operation the server already ingested can have lost only its acknowledgment, so the client is never in a position to decide on its own whether a server check-in exists. On the next connection the client presents the operation ID and the server resolves it under F409-AC-02: where a check-in was already created for that operation the outcome is `acknowledged` and the client retains only that acknowledgment, and only where the server confirms ingestion never committed does the outcome become the `expired-discarded` terminal tombstone the client syncs as an audit record. An operation that reaches `expired-discarded` is not retried or backfilled outside F409-AC-06's authorized audited path.

   That resolution is a versioned transition on the single AC-02 operation record, never a lookup followed by a separate write, because a lookup and a write cannot be told apart from a slow ingestion of the same operation that is still in flight behind them. Terminal resolution and ingestion therefore compete for the same row: whichever commits first fixes the outcome, and the other commits nothing and returns what it finds. Where ingestion wins, the resolution reads the committed check-in and returns `acknowledged`. Where resolution wins, the record is already terminal, so the delayed ingestion creates no check-in, records no acknowledgment, and returns the `expired-discarded` the record holds. No sequence leaves a check-in and a discard tombstone standing for one operation, and no discard can be invalidated by an ingestion that lands after it.

   A delayed ingestion that loses to a terminal resolution is not a lost admission that this criterion silently drops. It is the same unresolved case the paragraph below names: the attendee may have been admitted at the door on an operation the server never accepted, and appending it now is the backfill F409-AC-06 reserves to an approved conflict policy. Until that policy exists the loss is recorded in the audit record the tombstone carries, with the operation ID, its captured time, and the fact that ingestion arrived after resolution, and it is never presented as a completed check-in.

   Neither outcome removes or reverses a check-in the server already holds. The local queue records operations and is never authority over who has been admitted, so no criterion in this spec asks staff to un-admit an attendee who is already inside, and an attendee admitted at the door on an operation the server had in fact accepted stays admitted with the original acknowledgment rather than being overwritten by a client-side tombstone.

   Two things this criterion depends on are not established by any approved artifact and are not assumed here. The hard retention expiry itself belongs to the local data and retention policy named in the Approval Blockers, so until that policy is approved this criterion is testable only as "a configured finite retention limit is enforced and the payload is cleared at it," not against a specific window or grace period. The remaining case is a decision nobody has made: an attendee physically admitted at the door on an operation that never reached the server, which then reaches hard expiry or whose event F-401 already considers expired under F409-AC-06. Discarding it loses the server-side record of an admission that really happened, and appending it is exactly the backfill F409-AC-06 says requires an approved conflict policy that does not exist yet, so this spec does not choose between them and does not invent an extension for it. Until that conflict policy names the evidence and the authority for the append, such an operation stays visible and unresolved under F409-AC-04, reaches a terminal outcome only through the server check above, and the loss is recorded in the audit record rather than silent.

6. **F409-AC-06:** If the lifecycle generation changed or F-401 now considers the event expired, automatic sync creates no check-in and returns a visible closed-event conflict that remains available for resolution under AC-04. Only an authorized, audited backfill under the approved conflict policy may append the operation with its original captured time and stale-generation provenance; it does not reopen the event or bypass F-401's ordinary route. Without that approved policy or sufficient evidence, resolution is confirmed audited discard before hard expiry or AC-05's hard-expiry path at the hard limit, which still resolves against the server before recording a discard.

7. **F409-AC-07:** Every staff-facing operation this feature defines names the workspace and event it acts in, and is admitted only by the acting staff actor's current F-702 membership of that workspace together with the F-703 permission approved for the action, both re-read server-side from stored membership and role at the moment of the operation and, for a write, inside the same transaction that commits it. F409-AC-02 remains the rule for sync ingestion: its named scope is already validated against the staff actor's stored membership at the moment of the write, and this criterion composes with it by adding the F-703 permission to that same check rather than restating the scope validation. This criterion then covers everything F409-AC-02 does not: reading pending, rejected, and conflict operations for staff resolution under F409-AC-03 and F409-AC-04, explicit discard with confirmation and audit under F409-AC-04 and the F409-AC-05 sign-out path, and the authorized audited backfill under F409-AC-06. The terminal resolution F409-AC-05 performs at hard retention expiry is a system-actor transition and not a staff request, so it carries the authority of the approved retention policy that defines it rather than a user re-read, and remains bound by the versioned-transition rules that criterion states. A request failing the check is refused before any durable write and before any operation record, contact field, conflict, or acknowledgment is disclosed, and its response does not distinguish an event or operation that does not exist from one the actor may not see. The check is at the operation and not at session start or workspace switch, so authority removed while a request is in flight causes that request to fail rather than commit.

   Without this criterion, AC-01 through AC-06 all pass for an authenticated caller who names another workspace's event. They fix local queueing, exactly-once ingestion, identity resolution, retention clearing, and the closed-event conflict, and only AC-02 asks who the actor is, only at ingestion and only at the membership level. The resolution reads under AC-03 and AC-04 disclose queued contact fields and conflict state, the AC-04 and AC-05 discard paths destroy the only record of an unsynced admission, and the AC-06 backfill appends a check-in with stale-generation provenance, so the surface that criterion set leaves open both reads another workspace's attendee data and decides whether that workspace's admissions are recorded or lost.

   One input this criterion needs is not established by any approved artifact today and is not invented here. F-703 is PROPOSED and names no role set, so the permission above cannot be named; no criterion in this spec required an F-703 permission before this one. Until F-703 is approved this criterion is testable only as "every staff-facing read, discard, and backfill is refused unless the acting actor holds an active membership of the workspace that owns the named event, read server-side at that operation, and a refusal discloses nothing about whether that event or operation exists", not against a named role or permission identifier. Naming the sync-resolution, discard, and backfill permissions with F-703 is an approval blocker below.

## Fixtures and Verification

- Planned automated fixture IDs are the acceptance IDs above; each must map one-to-one to a runnable test before approval can claim implementation readiness.
- F409-AC-02 includes a fixture in which two offline clients in different workspaces generate the same operation ID and both operations are ingested, each returning only its own acknowledgment, and a fixture in which a recognized identity presented with a different operation payload is refused as a conflict rather than answered with the stored acknowledgment.
- F409-AC-07 includes a fixture in which an authenticated actor holding no membership of the owning workspace names a valid event and operation and is refused at the resolution read, at explicit discard, and at backfill, with a response that does not distinguish absence from denial, and a fixture in which authority removed while a discard or backfill is in flight fails that request rather than committing it.
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
- Approve F-701, F-702, and F-703, and name with F-703 the sync-resolution, discard, and backfill permissions `F409-AC-07` checks. That criterion checks a permission no approved artifact defines today and may not invent one, so until the matrix names them it is testable only at the membership level stated there.
- Assign the owner and independent reviewer, approve this spec, and add it to `docs/BASELINE.md`.
