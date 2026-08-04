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

- F-203 deadline schedule, F-208 inspection/milestone data, and the F-701/F-702/F-703 gate.
- Approved provider/credential, timezone, recurrence, and job/outbox contracts.
- Baseline at draft time: PRD, Roadmap, Design, and Phase 0–1.5 Architecture approved 2026-07-22; `ARCHITECTURE-FUTURE.md` approved as a planning target 2026-07-25; NYC ruleset `nyc.v2.7`, rules schema `popengine-rules/v2`, and scenario fixtures v5 where regulatory output is consumed.
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
5. **F212-AC-05:** Provider timeout, rate limit, expired credential, duplicate webhook, and permanent rejection produce deterministic retry or repair states.
6. **F212-AC-06:** Starting authorization issues a single-use callback state that the server stores bound to the initiating actor, the workspace, the provider, and the exact approved redirect target. The callback rejects any request whose state is missing, unrecognized, expired, already consumed, or bound to a different actor, workspace, provider, or redirect; a rejection stores no credential and creates no connection or mapping, and a successful callback retires its state so a replayed callback cannot bind a second time. This is stated as a criterion rather than only under Privacy and security because an implementation is built to the acceptance criteria: AC-01 through AC-05 all pass for a connection an attacker established. The attacker begins authorization against their own provider account, induces an authenticated organizer to open the callback, and the organizer's workspace is bound to the attacker's calendar, after which AC-01's own export sends that event's milestone titles, dates, times, and source links there. State entropy and lifetime are not established by any approved artifact today; they belong to the credential handling ADR named in the Approval Blockers, so until that approval names them this criterion is testable only as "an unguessable single-use state is required, bound, and verified before credentials are stored," not against a specific length or expiry.

   The state is additionally bound to the connection generation current when authorization started, and AC-04's disconnect, in the same transaction that advances that generation and revokes the credentials, consumes or invalidates every outstanding state issued against the prior generation. A callback presenting a state from a superseded generation is rejected on the same terms as an unrecognized one: no credential is stored, no connection or mapping is created, and the organizer is not silently reconnected. Without that, the two criteria disagree about the same connection. AC-04 revokes the credentials and reports the connection disconnected, while this criterion still finds the earlier state valid, unexpired, and unconsumed, so a callback the organizer or an attacker triggers afterwards stores fresh credentials and recreates the connection the organizer was told was removed. Reconnecting would then not be the only path back in, and the organizer's own disconnect would not be the decision it was reported as. This also completes `F702-AC-10` for this feature: an operation whose workspace binding was issued under authority that has since been withdrawn must fail rather than commit on the withdrawn authority, and a stale authorization state is exactly that.

## Fixtures and Verification

- Planned automated fixture IDs are the acceptance IDs above; each must map one-to-one to a runnable test before approval can claim implementation readiness.
- F212-AC-06 includes a fixture in which authorization starts, the organizer disconnects under AC-04, and the delayed callback presenting the still-unexpired state stores no credential and creates no connection, plus a fixture proving a state bound to one workspace is rejected when presented while another is active.
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
- Assign the owner and independent reviewer, approve this spec, and add it to `docs/BASELINE.md`.
