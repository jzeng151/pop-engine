# F-212 · Calendar Export and Sync

**Status:** PROPOSED (2026-07-26) — ready for review; not implementable until approved and listed in `docs/BASELINE.md`.

**Phase:** 2 · **Issue:** [#19](https://github.com/jzeng151/pop-engine/issues/19) · **Owner:** TBD · **Reviewer:** product owner plus affected architecture, contract, security, and lane owners (TBD) · **Approval date:** —

## Purpose and User Outcome

An organizer can place confirmed deadlines, inspections, and milestones on an external calendar while keeping unknown or dependency-gated dates honest.

## Scope

**In scope**

- Portable calendar export and synchronization through one approved provider adapter.
- Create, update, cancel, and relink calendar entries using stable mappings and the event timezone.
- Export only dates that the authoritative workflow can represent without invention.

**Non-goals**

- A new calendar UI, scheduling agency appointments, attendee invitations, or support for multiple providers at first release.
- Converting research-required or unresolved dependency dates into guessed dates.

## Dependencies and Baseline

- F-203 deadline schedule, F-208 inspection/milestone data, and the F-701/F-702/F-703 gate. F-702 supplies the workspace membership boundary that connections, mappings, and exports resolve against and F-703 supplies the permission matrix `F212-AC-07` checks; F-701 supplies the authenticated actor both read from. All three are PROPOSED, so the gate is not an approved input today and this spec is not implementable against it until they are approved and listed in `docs/BASELINE.md`.
- Approved provider/credential, timezone, recurrence, and job/outbox contracts.
- Baseline at draft time: PRD, Roadmap, Design, and Phase 0–1.5 Architecture approved 2026-07-22; `ARCHITECTURE-FUTURE.md` approved as a planning target 2026-07-25; NYC ruleset `nyc.v2.7`, rules schema `popengine-rules/v2`, and scenario fixtures v5 where regulatory output is consumed.
- Operand binding and replay ordering for client-supplied identities: `specs/F-411-staff-roles-credentialed-entry.md` F411-AC-08 states once, for this whole branch, that a client-supplied identity is committed with the operands that determine its recorded result, that a reuse carrying different operands is a conflict rather than a replay, and that a committed identity is resolved before any version, generation, state, authority, or limit check whose answer the committed operation itself changed. The disconnect identity in `F212-AC-04` relies on both. F-411 is PROPOSED, so those rules are not an approved input today and this spec is not implementable against them until F-411 is approved or they are promoted to an approved shared invariant; F411-AC-08 records both paths.
- The approval PR must re-pin any baseline version that changes before approval. A proposed or superseded input blocks implementation.

## Inputs, Outputs, State, Validation, and Errors

- Inputs are dated workflow milestones plus user connection and selection; outputs are a portable calendar document or provider event mappings.
- Sync state is disconnected → connected → syncing → current, failed, or revoked; stable source IDs and a source generation make retries idempotent and order writes for each mapping.
- A removed or changed source milestone cancels or updates the mapped provider event without touching unrelated calendar entries.
- Missing or unresolved material data stays visibly unset, unknown, pending, or failed as appropriate; it never becomes a successful or complete result.
- Invalid input produces a field or action-specific error without partial mutation. Retriable external failures preserve the user's confirmed state and expose a safe retry.

## UI and Accessibility

- Users preview included and excluded milestones, see why an unknown date is excluded, and can disconnect or retry without losing PopEngine data.
- The complete workflow is keyboard operable, uses programmatic labels and visible focus, does not encode status by color alone, and announces asynchronous success or failure.
- Empty, loading, permission-denied, validation, provider-failure, and unavailable states have explicit copy and a safe next action.

## System Impact

| Concern              | Proposed impact                                                                                                   |
| -------------------- | ----------------------------------------------------------------------------------------------------------------- |
| API                  | Connection, export, sync, status, and callback/webhook operations require approved OpenAPI contracts.             |
| Schema               | Forward migrations for encrypted connections, provider mappings, sync cursors, and failure state.                 |
| Jobs                 | Durable outbox/worker jobs perform sync, retry with bounds, and dead-letter permanent failures.                   |
| Providers            | One calendar provider selected behind an adapter plus standards-compliant portable export.                        |
| Privacy and security | OAuth/connection secrets are encrypted and redacted; callbacks validate state; all mappings are workspace-scoped. |

Exact HTTP, JSON Schema, migration, job, and provider shapes belong in their reviewed machine contracts; this proposal does not authorize parallel local types or edits to merged migrations.

## Acceptance Criteria

1. **F212-AC-01:** Export includes each selected confirmed milestone once with the correct title, source link, date/time, timezone, and stable identifier.
2. **F212-AC-02:** Research-required, unknown, or unresolved dependency dates are excluded with an explicit reason and never guessed.
3. **F212-AC-03:** Repeated sync creates no duplicate; source changes update the mapped entry and source removal cancels only that entry. Jobs carry and recheck the source generation before the provider call, provider mutations for one mapping are generation-ordered, and a stale or out-of-order completion cannot overwrite the latest mapping or leave the provider on the obsolete source value.
4. **F212-AC-04:** Each provider call atomically claims a non-cancellable in-flight state after its final source-generation and credential check. Disconnect serializes with claims, blocks new claims immediately, and does not report credentials revoked until every existing claim is durably accounted for; PopEngine source data remains intact.

   Disconnect is itself a durable mutation of the connection, not only a fence over the claims, so it names the exact connection generation it reviewed and commits only by compare-and-swap on that generation, and it carries a stable client-supplied request identity committed in that same transaction under a uniqueness constraint scoped to the connection. The identity binds its operands under `F411-AC-08`: the workspace, the connection, and the generation the request reviewed. A disconnect naming a generation the connection has already left changes nothing, revokes no credential, advances no generation, and returns the current connection state for the organizer to reload, and a reuse of a committed identity naming a different connection or generation is refused as a conflict rather than answered with the stored outcome.

   The two are evaluated in the order `F411-AC-08` states once for every client-supplied identity on this branch: a presented identity that already holds a committed disconnect is resolved from that record first and returns that disconnect's recorded outcome, advancing the generation no second time and revoking nothing again, and only a request whose identity resolves to no committed outcome is then compared against the current generation. Both halves are needed and neither substitutes for the other. Without the compare-and-swap, a disconnect composed for generation G is a bare command: when its response is lost and the organizer meanwhile reconnects at G+1 under `F212-AC-06`, the retry that arrives afterwards revokes the credentials the organizer just established and invalidates the states bound to the new generation, while this criterion as written is satisfied, because the retry did serialize with claims and did advance a generation. Without the identity, that same retry is indistinguishable from a deliberate second disconnect and the compare-and-swap refuses it as stale, telling the organizer their disconnect failed when it committed, which is the outcome the ordering rule exists to prevent. Together they make the fence generation-scoped and the retry recognizable: a stale retry reaches neither the credentials nor the generation of a connection it never reviewed, and an organizer who disconnects once is told so once, however many times the request is sent.

   `F212-AC-06`'s consumption of outstanding authorization states is unchanged and runs inside the transaction that wins this compare-and-swap, so the states invalidated are exactly those issued against the generation the winning disconnect reviewed. A disconnect refused by the comparison consumes no state and commits no identity, so re-presenting that identity later is a first attempt and not a replay.

5. **F212-AC-05:** Provider timeout, rate limit, expired credential, duplicate webhook, and permanent rejection produce deterministic retry or repair states.
6. **F212-AC-06:** Starting authorization issues a single-use callback state that the server stores bound to the initiating actor, the workspace, the provider, and the exact approved redirect target. The callback rejects any request whose state is missing, unrecognized, expired, already consumed, or bound to a different actor, workspace, provider, or redirect; a rejection stores no credential and creates no connection or mapping, and a successful callback retires its state so a replayed callback cannot bind a second time. This is stated as a criterion rather than only under Privacy and security because an implementation is built to the acceptance criteria: AC-01 through AC-05 all pass for a connection an attacker established. The attacker begins authorization against their own provider account, induces an authenticated organizer to open the callback, and the organizer's workspace is bound to the attacker's calendar, after which AC-01's own export sends that event's milestone titles, dates, times, and source links there. State entropy and lifetime are not established by any approved artifact today; they belong to the credential handling ADR named in the Approval Blockers, so until that approval names them this criterion is testable only as "an unguessable single-use state is required, bound, and verified before credentials are stored," not against a specific length or expiry.

   The state is additionally bound to the connection generation current when authorization started, and AC-04's disconnect, in the same transaction that advances that generation and revokes the credentials, consumes or invalidates every outstanding state issued against the prior generation. A callback presenting a state from a superseded generation is rejected on the same terms as an unrecognized one: no credential is stored, no connection or mapping is created, and the organizer is not silently reconnected. Without that, the two criteria disagree about the same connection. AC-04 revokes the credentials and reports the connection disconnected, while this criterion still finds the earlier state valid, unexpired, and unconsumed, so a callback the organizer or an attacker triggers afterwards stores fresh credentials and recreates the connection the organizer was told was removed. Reconnecting would then not be the only path back in, and the organizer's own disconnect would not be the decision it was reported as. This also completes `F702-AC-10` for this feature: an operation whose workspace binding was issued under authority that has since been withdrawn must fail rather than commit on the withdrawn authority, and a stale authorization state is exactly that. The generation binding covers withdrawal of the connection; withdrawal of the actor's own authority is the third leg of the same lifecycle, and the re-read `F212-AC-07` requires at state issuance and again at the callback is stated there.

7. **F212-AC-07:** Every organizer operation this feature defines names the workspace it acts in, and is admitted only by the acting actor's current F-702 membership of that workspace together with the F-703 permission approved for the action, both re-read server-side from stored membership and role at the moment of the operation and, for a write, inside the same transaction that commits it. That covers starting provider authorization under F212-AC-06, consuming the callback that stores a credential and creates the connection, portable export under F212-AC-01, the inclusion and exclusion preview read under F212-AC-02, creating, updating, cancelling, and relinking a sync and reading its status under F212-AC-03, and disconnect under F212-AC-04. A request failing the check is refused before any durable write, before any provider call, and before any milestone, mapping, or connection state is disclosed, and its response does not distinguish a workspace or connection that does not exist from one the actor may not see. The check is at the operation and not at session start or workspace switch, so authority removed while a request is in flight causes that request to fail rather than commit. Provider webhooks under F212-AC-05 are provider-initiated and carry no acting user; they are bound by the stored connection they name and by signature validation, not by this criterion.

   This criterion and the two rules F212-AC-06 already states are one lifecycle, not three parallel checks. At authorization start, this criterion admits the actor before AC-06 issues any state, so the state AC-06 binds to the initiating actor, workspace, provider, and redirect is only ever minted for an actor who held the connection permission at issuance; a caller who can name a guessed or leaked workspace identifier but holds no current membership is refused before a state exists to bind. At the callback, the checks run in order on the one request: AC-06's binding and single-use validation proves the request completes the authorization this actor started, its generation binding proves the connection has not been disconnected under AC-04 since, and this criterion then re-reads the actor's current membership and permission before any credential is stored. Authority withdrawn between issuance and callback therefore fails the callback on the same terms as a stale or foreign state: no credential stored, no connection or mapping created. The two withdrawal paths compose rather than overlap: AC-04's disconnect invalidates outstanding states by advancing the generation AC-06 checks, and an F-702/F-703 withdrawal invalidates them by failing the re-read this criterion requires. Either alone stops the credential from binding, and neither substitutes for the other, because one revokes the connection and the other revokes the actor.

   One input this criterion needs is not established by any approved artifact today and is not invented here. F-703 is PROPOSED and names no role set, so the permission above cannot be named. Until F-703 is approved this criterion is testable only as "every connection, export, preview, sync, status, and disconnect operation is refused unless the acting actor holds an active membership of the named workspace, read server-side at that operation, and a refusal discloses nothing about whether that workspace or connection exists", not against a named role or permission identifier. Naming the calendar-connection, export, sync, and disconnect permissions with F-703 is an approval blocker below.

## Fixtures and Verification

- Planned automated fixture IDs are the acceptance IDs above; each must map one-to-one to a runnable test before approval can claim implementation readiness.
- F212-AC-04 includes a fixture in which a disconnect commits, its response is lost, the organizer reconnects at the next generation, and the delayed retry presenting the same request identity returns the original disconnect's outcome without revoking the new credentials or advancing the new generation, and a fixture in which a disconnect naming a superseded generation and carrying no committed identity changes nothing and returns the current connection state, plus a mismatched-reuse fixture in which a committed disconnect identity is re-presented naming a different connection and is refused as a conflict, disconnecting nothing.
- F212-AC-06 includes a fixture in which authorization starts, the organizer disconnects under AC-04, and the delayed callback presenting the still-unexpired state stores no credential and creates no connection, plus a fixture proving a state bound to one workspace is rejected when presented while another is active.
- F212-AC-07 includes a fixture in which an actor holding no membership of the named workspace is refused at authorization start with no state minted and nothing disclosed, and a fixture in which membership is removed after a state is issued and the otherwise-valid callback is refused with no credential stored and no connection created, paired with the AC-06 disconnect fixture to prove the two withdrawal paths reject on the same terms. It also refuses the export, preview, sync, status, and disconnect operations for that actor without distinguishing absence from denial.
- Regulatory fixtures: Approved dated and research-required findings from scenarios A–F exercise inclusion/exclusion; calendar-provider data is synthetic.
- Security-sensitive and cross-workspace paths require negative authorization tests; provider paths require success, duplicate-delivery, retry, invalid-signature, and permanent-failure tests where applicable.

## Allowed Footprint and Coordination

- `apps/web` and `apps/api` feature code and tests.
- New ordered forward migrations and approved OpenAPI/JSON Schema changes required by this feature.
- No repository restructuring, speculative package, or unrelated feature edit.
- Shared contracts, migrations, provider adapters, engine/rules artifacts, consent policy, and cross-lane UI primitives require the approvals named in `docs/DOCUMENTATION-GOVERNANCE.md` §6.

## Rollout and Fallback

- Ship portable export even if the selected provider is unavailable; provider sync remains feature-flagged until credential and job checks pass.
- Rollback disables the new surface and workers/provider calls without deleting confirmed user data or rewriting immutable plans, rulesets, revisions, or history.

## Approval Blockers

- Approve the job/outbox ADR, calendar provider ADR, credential handling, and timezone/date ADR.
- Approve F-701, F-702, and F-703, and name with F-703 the calendar-connection, export, sync, and disconnect permissions `F212-AC-07` checks. That criterion checks a permission no approved artifact defines today and may not invent one, so until the matrix names them it is testable only at the membership level stated there.
- Assign the owner and independent reviewer, approve this spec, and add it to `docs/BASELINE.md`.
