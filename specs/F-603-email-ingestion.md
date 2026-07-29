# F-603 · Email Ingestion

**Status:** PROPOSED (2026-07-26) — ready for review; not implementable until approved and listed in `docs/BASELINE.md`.

**Phase:** 4 · **Issue:** [#59](https://github.com/jzeng151/pop-engine/issues/59) · **Owner:** TBD · **Reviewer:** product owner plus affected architecture, contract, security, and lane owners (TBD) · **Approval date:** —

## Purpose and User Outcome

Authorized agency correspondence can be ingested and proposed for the correct event/application while uncertain matches stay in a review queue.

## Scope

**In scope**

- Receive mail through one approved inbound adapter, verify/authenticate what the provider supports, parse bounded metadata/body/attachments, and propose event/application matches.
- Allow an authorized user to confirm/reassign/reject the match before downstream extraction/reconciliation.
- Preserve source message, provider ID, match reasons, and processing history.

**Non-goals**

- General mailbox client, outbound email, automatic authoritative updates, legal authenticity guarantees, or accepting arbitrary forwarding without abuse controls.
- Treating sender/display name as verified agency authority.

## Dependencies and Baseline

- F-208, F-209 private documents, approved jobs/outbox, and the F-701/F-702/F-703 gate.
- Inbound provider/domain, authentication, retention, attachment, matching, and unmatched-message policy.
- Baseline at draft time: PRD, Roadmap, Design, and Phase 0–1.5 Architecture approved 2026-07-22; `ARCHITECTURE-FUTURE.md` approved as a planning target 2026-07-25; NYC ruleset `nyc.v2.7`, rules schema `popengine-rules/v2`, and scenario fixtures v5 where regulatory output is consumed.
- The approval PR must re-pin any baseline version that changes before approval. A proposed or superseded input blocks implementation.

## Inputs, Outputs, State, Validation, and Errors

- Input is a verified provider envelope and bounded message content; output is quarantined/unmatched or a pending event/application match.
- State is received → verified/quarantined → matched-pending → confirmed, reassigned, or rejected; downstream processing begins only after confirmation.
- Ambiguous/no-match/duplicate/failed messages remain visible and never attach silently.
- Missing or unresolved material data stays visibly unset, unknown, pending, or failed as appropriate; it never becomes a successful or complete result.
- Invalid input produces a field or action-specific error without partial mutation. Retriable external failures preserve the user's confirmed state and expose a safe retry.

## UI and Accessibility

- Review shows sender/authentication limitations, received time, subject, proposed match reasons, safe preview, and explicit confirm/reassign/reject.
- The complete workflow is keyboard operable, uses programmatic labels and visible focus, does not encode status by color alone, and announces asynchronous success or failure.
- Empty, loading, permission-denied, validation, provider-failure, and unavailable states have explicit copy and a safe next action.

## System Impact

| Concern              | Proposed impact                                                                                                                                              |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| API                  | Inbound webhook, review, match, and status operations require approved OpenAPI/internal webhook contracts.                                                   |
| Schema               | Forward migrations for source messages, encrypted/private content references, match proposals, provider IDs, and processing history.                         |
| Jobs                 | Durable parse/match/attachment jobs with idempotency, quarantine, bounded retry, and dead-letter handling.                                                   |
| Providers            | One inbound email provider behind a verified adapter plus private storage/scanning.                                                                          |
| Privacy and security | Webhook verification, recipient tokens, attachment scanning, HTML sanitization, no remote loads, rate/size limits, encryption, redacted logs, and retention. |

Exact HTTP, JSON Schema, migration, job, and provider shapes belong in their reviewed machine contracts; this proposal does not authorize parallel local types or edits to merged migrations.

## Acceptance Criteria

1. **F603-AC-01:** Only a valid provider request to an active workspace-scoped recipient is accepted; invalid/replayed requests cannot attach data.
2. **F603-AC-02:** A received message is idempotent by provider/message identity and preserves immutable source metadata/content reference.
3. **F603-AC-03:** Event/application matching remains pending until an authorized user confirms or reassigns it.
4. **F603-AC-04:** Ambiguous, unmatched, quarantined, unsafe, or failed messages cannot trigger extraction/reconciliation or workflow mutation.
5. **F603-AC-05:** Email authentication results are displayed as evidence limits and never represented as regulatory or sender authority.
6. **F603-AC-06:** Confirming or reassigning a match atomically links the exact immutable message and each safe document version to the application and makes each eligible document available to F-602 exactly once; retries do not duplicate source links or downstream extraction work.

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

- Start with allow-listed synthetic/test senders; expand only after quarantine, retention, and abuse monitoring pass.
- Rollback disables the new surface and workers/provider calls without deleting confirmed user data or rewriting immutable plans, rulesets, revisions, or history.

## Approval Blockers

- Approve inbound provider/domain, webhook/recipient authentication, retention, attachment policy, and matching thresholds.
- Assign the owner and independent reviewer, approve this spec, and add it to `docs/BASELINE.md`.
