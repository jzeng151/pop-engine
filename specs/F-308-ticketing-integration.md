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
- The approval PR must re-pin any baseline version that changes before approval. A proposed or superseded input blocks implementation.

## Inputs, Outputs, State, Validation, and Errors

- Inputs are authorized event, selected records, and connection; outputs are provider mapping/results or bounded CSV.
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
4. **F308-AC-04:** Provider/webhook data cannot create payment, consent, or authoritative RSVP state in PopEngine.
5. **F308-AC-05:** Disconnecting revokes future calls and leaves PopEngine event/registration data intact.

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

- CSV fallback ships with or before the provider adapter; keep provider integration flagged until sandbox/live contract checks pass.
- Rollback disables the new surface and workers/provider calls without deleting confirmed user data or rewriting immutable plans, rulesets, revisions, or history.

## Approval Blockers

- Select/approve one provider and its field mapping, terms, credentials, webhook, retention, and deletion behavior.
- Assign the owner and independent reviewer, approve this spec, and add it to `docs/BASELINE.md`.
