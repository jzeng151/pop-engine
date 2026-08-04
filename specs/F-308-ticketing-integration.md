# F-308 · Ticketing Integration

**Status:** PROPOSED (2026-07-26) — ready for review; not implementable until approved and listed in `docs/BASELINE.md`.

**Phase:** 4 · **Issue:** [#55](https://github.com/jzeng151/pop-engine/issues/55) · **Owner:** TBD · **Reviewer:** product owner plus affected architecture, contract, security, and lane owners (TBD) · **Approval date:** —

## Purpose and User Outcome

An organizer can export event and registration data to one established ticketing provider without PopEngine processing payments or creating a second attendee truth.

## Scope

**In scope**

- Connect one approved provider, map a PopEngine event, export approved event/registration fields, and show per-record results.
- Use idempotent provider mappings and respect consent/data-minimization rules.
- Provide a safe CSV export fallback if the provider is unavailable.

**Non-goals**

- In-house ticket sales/payments, refunds, fees, seating, ticket scanning, bidirectional sync, or multiple providers at launch.
- Importing provider marketing consent.

## Dependencies and Baseline

- F-302 registrations, F-403 consent/privacy, F-701/F-702/F-703, and approved jobs/outbox.
- Provider ADR covering API terms, field mapping, credentials, idempotency, deletion, and rate limits.
- Baseline at draft time: PRD, Roadmap, Design, and Phase 0–1.5 Architecture approved 2026-07-22; `ARCHITECTURE-FUTURE.md` approved as a planning target 2026-07-25; NYC ruleset `nyc.v2.7`, rules schema `popengine-rules/v2`, and scenario fixtures v5 where regulatory output is consumed.
- Operand binding for client-supplied identities: `specs/F-411-staff-roles-credentialed-entry.md` F411-AC-08 states once, for this whole branch, that a client-supplied identity is committed with the operands that determine its recorded result and that a reuse carrying different operands is a conflict rather than a replay. Every identity criterion below relies on it. F-411 is PROPOSED, so that rule is not an approved input today and this spec is not implementable against it until F-411 is approved or the rule is promoted to an approved shared invariant; F411-AC-08 records both paths.
- The approval PR must re-pin any baseline version that changes before approval. A proposed or superseded input blocks implementation.

## Inputs, Outputs, State, Validation, and Errors

- Inputs are authorized event, selected records, connection, and a stable request identity on each export-run creation; outputs are provider mapping/results or bounded CSV.
- Export state is draft → queued → completed, partially failed, cancelled, or failed; retries preserve mapping/idempotency.
- Provider changes never mutate PopEngine RSVP truth in the first release.
- Missing or unresolved material data stays visibly unset, unknown, pending, or failed as appropriate; it never becomes a successful or complete result.
- Invalid input produces a field or action-specific error without partial mutation. Retriable external failures preserve the user's confirmed state and expose a safe retry.

## UI and Accessibility

- Preview shows provider, exact fields/record count, consent exclusions, and irreversible effects before export.
- The complete workflow is keyboard operable, uses programmatic labels and visible focus, does not encode status by color alone, and announces asynchronous success or failure.
- Empty, loading, permission-denied, validation, provider-failure, and unavailable states have explicit copy and a safe next action.

## System Impact

| Concern              | Proposed impact                                                                                                                                |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| API                  | Connection/export/status/callback-webhook operations require approved OpenAPI contracts.                                                       |
| Schema               | Forward migrations for encrypted connections, provider mappings, export runs, and redacted result metadata.                                    |
| Jobs                 | Durable export jobs with bounded retry, cancellation, idempotency, and dead-letter handling.                                                   |
| Providers            | One ticketing provider behind an adapter; CSV uses no provider.                                                                                |
| Privacy and security | Encrypted credentials, workspace scope, data minimization, safe CSV, webhook verification if used, rate limits, and provider retention review. |

Exact HTTP, JSON Schema, migration, job, and provider shapes belong in their reviewed machine contracts; this proposal does not authorize parallel local types or edits to merged migrations.

## Acceptance Criteria

1. **F308-AC-01:** Preview and export contain only the approved event/registration fields and exclude contacts lacking the required transfer basis.
2. **F308-AC-02:** Repeated export/retry creates no duplicate provider event or registration for the same stable mapping.
3. **F308-AC-03:** Partial failures report exact record outcomes and can retry failed records without resending successful ones.
4. **F308-AC-04:** Invalid, replayed, duplicate, out-of-scope, or unverified provider webhook events are rejected and change nothing, and no verified provider or webhook data can create payment, consent, or authoritative RSVP state in PopEngine. Verifying authenticity belongs in this criterion rather than only under Privacy and security because an implementation is built to the acceptance criteria: this criterion previously bounded only what webhook data may do once accepted, so an unauthenticated caller could still drive every other provider-derived state this feature keeps. The verification scheme is not established by any approved artifact today; it belongs to the provider webhook contract named in the Approval Blockers, so until that contract is approved this criterion is testable only as "an event whose provider authenticity cannot be verified is rejected," not against a specific signature or timestamp scheme.
5. **F308-AC-05:** Disconnecting advances the connection generation and serializes against the AC-07 transfer claim, immediately blocking queued or leased work that has not entered `sending`; already-sending transfers remain explicitly accounted and PopEngine event/registration data remains intact.
6. **F308-AC-06:** When the provider is unavailable, an authorized workspace member can download a short-lived CSV containing only the approved allow-listed preview fields; cells beginning with any spreadsheet-dangerous prefix (`=`, `+`, `-`, `@`, tab, carriage return, or line feed) are escaped, including control-prefixed formulas, no provider credential is included, and expiry or revocation makes the download unavailable.
7. **F308-AC-07:** Transfer atomically claims a non-cancellable `sending` state after the final export, connection, and eligibility generation check; cancellation, disconnect, consent withdrawal, suppression, and deletion serialize against claims, prevent only work not yet sending, report already-sending work explicitly, and account for every in-flight claim.
8. **F308-AC-08:** Export generation pins the exact source contact and registration record versions whose values the organizer reviewed, the same pin AC-09 already requires of CSV artifacts. Every queued or leased record rechecks current transfer basis, suppression, and deletion state immediately before the provider call, and compares each pinned source version against the current one; a contact that is no longer eligible is excluded and reported without transfer, and a record whose pinned version no longer matches is excluded and reported rather than sent. The transfer as a whole is rejected or rebuilt from a fresh reviewed export before it may claim `sending`. Without the pin the eligibility rechecks all pass while the values themselves have changed since preview, so the job sends stale PII or a newly changed value the organizer never confirmed.
9. **F308-AC-09:** CSV artifacts pin source contact/eligibility versions; deletion, suppression, or loss of transfer basis revokes every server-controlled staged artifact and signed URL containing that record and requires regeneration. Already saved local copies cannot be recalled.
10. **F308-AC-10:** Creating an export run, including the AC-06 CSV fallback, binds the request to a stable client-supplied request identity, committed with the run under a uniqueness constraint scoped to the event. A retry presenting the same identity returns the original run and, once complete, its original outcome and staged artifact, enqueues no second job, and stages no second file; a deliberately separate export sends a new identity. This is request identity, never content uniqueness: two genuinely distinct exports over the same selected records, connection, and pinned source versions are both produced, and a repeated identity is never rejected as a duplicate value. That identity binds its operands under the rule `F411-AC-08` states once for every client-supplied identity on this branch: it is committed together with the request fields that determine the recorded result, including every aggregate, version, and generation the request names, and a later request presenting the same identity with any different operand is refused as a conflict rather than being answered with the stored result. The identity is still the key and the operands are only a precondition on reusing it, so this is not the content uniqueness this criterion already forbids.

    AC-02 deduplicates provider events and registrations for one stable mapping, which is the provider side of a run and not the run itself; a second run carries the same mappings and passes that check. When the create transaction commits and its response is lost, the retry starts a second export run over the same records: a second CSV of attendee contacts in private storage with its own retention clock and its own AC-09 revocation surface, a second set of AC-07 transfer claims to account for, and two runs whose AC-03 partial-failure outcomes the organizer must reconcile for one authorized action.

11. **F308-AC-11:** Starting provider authorization issues a single-use callback state that the server stores bound to the initiating actor, the workspace, the provider, and the exact approved redirect target, on the same terms `F212-AC-06` states in full. The callback rejects any request whose state is missing, unrecognized, expired, already consumed, or bound to a different actor, workspace, provider, or redirect; a rejection stores no credential and creates no connection or mapping, and a successful callback retires its state so a replayed callback cannot bind a second time. Disconnecting under AC-05 advances the connection generation and invalidates every outstanding state issued against the prior generation, so a delayed callback cannot silently reconnect the workspace after the organizer was told the connection was removed.

    This is the callback half of `F702-AC-10`, which requires every externally initiated callback to name the workspace it acts in and to have that binding established by the server when the flow starts rather than read from whatever browser session presents the callback. AC-01 through AC-10 all pass for a connection an attacker established: the attacker begins authorization against their own provider account, induces an authenticated organizer to open the callback, and the organizer's workspace is bound to the attacker's ticketing account, after which AC-01's own export sends that event's registration data, including the contact fields the transfer basis admitted, to the attacker. AC-04 does not reach this, because it governs what a webhook may do once a connection exists and says nothing about how the connection came to exist. State entropy and lifetime are not established by any approved artifact today; they belong to the provider credential contract named in the Approval Blockers, so until that approval names them this criterion is testable only as "an unguessable single-use state is required, bound, verified, and consumed before credentials are stored, and disconnect invalidates every outstanding state," not against a specific length or expiry.

## Fixtures and Verification

- Planned automated fixture IDs are the acceptance IDs above; each must map one-to-one to a runnable test before approval can claim implementation readiness.
- F308-AC-11 includes a cross-workspace callback fixture in which a state issued for one workspace is presented while a different workspace is active and is rejected with no credential stored, a replayed-callback fixture, and a fixture proving a callback whose state was issued before a disconnect creates no connection.
- Regulatory fixtures: none; this feature does not define regulatory ground truth.
- Security-sensitive and cross-workspace paths require negative authorization tests; provider paths require success, duplicate-delivery, retry, invalid-signature, and permanent-failure tests where applicable.

## Allowed Footprint and Coordination

- `apps/web` and `apps/api` feature code and tests.
- New ordered forward migrations and approved OpenAPI/JSON Schema changes required by this feature.
- No repository restructuring, speculative package, or unrelated feature edit.
- Shared contracts, migrations, provider adapters, engine/rules artifacts, consent policy, and cross-lane UI primitives require the approvals named in `docs/DOCUMENTATION-GOVERNANCE.md` §6.

## Rollout and Fallback

- CSV fallback ships with or before the provider adapter; keep provider integration flagged until sandbox/live contract checks pass.
- Rollback disables the new surface and workers/provider calls without deleting confirmed user data or rewriting immutable plans, rulesets, revisions, or history.

## Approval Blockers

- Select/approve one provider and its field mapping, terms, credentials, webhook, retention, and deletion behavior. The credential contract must name the callback-state entropy and lifetime that F308-AC-11 leaves unpinned.
- Approve the CSV field allow-list, complete dangerous-prefix escaping rule, authorization, retention, and short-lived download contract.
- Assign the owner and independent reviewer, approve this spec, and add it to `docs/BASELINE.md`.
