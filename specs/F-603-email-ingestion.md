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

- F-208, F-209 private documents, F-602 extraction handoff, approved jobs/outbox, and the F-701/F-702/F-703 gate.
- Inbound provider/domain, authentication, retention, attachment, matching, and unmatched-message policy.
- Baseline at draft time: PRD, Roadmap, Design, and Phase 0–1.5 Architecture approved 2026-07-22; `ARCHITECTURE-FUTURE.md` approved as a planning target 2026-07-25; NYC ruleset `nyc.v2.7`, rules schema `popengine-rules/v2`, and scenario fixtures v5 where regulatory output is consumed.
- The approval PR must re-pin any baseline version that changes before approval. A proposed or superseded input blocks implementation.

## Inputs, Outputs, State, Validation, and Errors

- Input is a verified provider envelope and bounded message content; output is quarantined/unmatched or a pending event/application match pinned to the target's exact F-208 application/projection version.
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
2. **F603-AC-02:** A received message is idempotent by the provider/message identity together with the active workspace-scoped recipient the delivery was addressed to, and preserves immutable source metadata/content reference. The dedupe key is that pair, not the provider identity alone, and each recognized redelivery of that pair returns or links only the source record belonging to that recipient's workspace. A delivery of one provider message identity to a second active recipient is a separate received message and is stored, matched, and made available under that second recipient's workspace on its own terms.

   Scoping the key is what keeps a legitimate delivery from being dropped. One agency email addressed to two event-specific inbound addresses reaches AC-01 twice and is accepted twice, because AC-01 admits any valid provider request to an active workspace-scoped recipient, and many providers carry one message identity across both deliveries. Under a global key the second delivery is collapsed into the first: the second event's organizer never receives the correspondence, and, worse, a lookup on that identity resolves to the first recipient's source record, so a message and its attachment reference can be returned or linked across a workspace boundary by a value the sender controls. The provider identity is also not something this feature can require to be distinct, since it is assigned outside PopEngine, which is why the scope is placed on the key here rather than as a constraint on the provider.

   Provider redelivery of the same message to the same recipient still collapses, which is the case this criterion exists for, and the immutable payload reference is what makes that safe: a redelivery presenting the recipient-scoped key with a different message payload is a conflict rather than a replay, on the same terms `F411-AC-08` states for every client-supplied identity on this branch, so a reused identity carrying substituted content cannot overwrite or answer for the stored message.
3. **F603-AC-03:** Event/application matching remains pending until an authorized user confirms or reassigns it.
4. **F603-AC-04:** Ambiguous, unmatched, quarantined, unsafe, or failed messages cannot trigger extraction/reconciliation or workflow mutation.
5. **F603-AC-05:** Email authentication results are displayed as evidence limits and never represented as regulatory or sender authority.
6. **F603-AC-06:** Confirming, reassigning, or rejecting a `matched-pending` proposal compare-and-swaps the expected pending match version, and confirming or reassigning additionally compare-and-swaps the exact active target application's F-208 application/projection version, then atomically commits the winning application link, immutable message/safe document versions, and F-602 outbox work. If archival or another application mutation wins, confirmation rejects and rebuilds the match without linking or enqueuing work; retries do not duplicate links or extraction work.

   Reviewer rejection is one of the terminal dispositions of a `matched-pending` proposal and competes on the same match version as confirmation and reassignment, so exactly one of the three wins and the losers reject and rebuild the match. A rejection commits no application link, no document version, and no F-602 outbox work, and it leaves the message visible and unattached under AC-04 rather than deleting it. Rejection is replay-safe on the same terms as the other two: a retry of a rejection that already committed returns that terminal disposition and neither re-runs the transition nor reopens the proposal, and a rejection presenting a stale match version rejects the whole write without changing the disposition that won.

   This is stated because the earlier round on this criterion serialized only confirmation and reassignment, and AC-07 governs rejection at ingress, which is a different transition on a message that never became a proposal. Reviewer rejection was therefore named only in the state prose above and in no criterion at all, and an implementation is built to the criteria: it could omit it, or apply it without the pending-match version fence, and a rejection could land on a proposal whose confirmation had already committed the application link, the documents, and the F-602 outbox work, leaving a rejected projection over committed downstream effects. The transitions out of `matched-pending` are exactly confirm, reassign, and reject; naming all three on one version is what keeps a fourth from being added later without a fence.

7. **F603-AC-07:** An inbound message is rejected or quarantined at ingress, before its content or attachments are stored and before any matching, extraction, or notification work is enqueued, when its total size, individual attachment size, attachment count, or attachment type falls outside the approved inbound limits; the rejection is recorded as a visible failed message under AC-04 rather than silently dropped, within the bound the next paragraph sets. This belongs in a criterion rather than only under Privacy and security because an implementation is built to the acceptance criteria and the sender of an inbound message is an unauthenticated external party who chooses what it carries: AC-01 validates the provider request and the recipient, not the size of its payload, and AC-04 keeps unsafe content from mutating the workflow only after it has already been accepted and stored. The limits themselves are not established by any approved artifact today; they belong to the inbound provider and attachment policy named in the Approval Blockers, so until that approval names them this criterion is testable only as "configured finite total-size, per-attachment-size, attachment-count, and attachment-type limits are enforced before storage, and a message outside them is rejected and visible," not against a specific number or type list.

   Inbound messages are rate limited per active recipient and per sending origin. Within that limit every message is processed as this criterion and AC-01 through AC-06 describe, and every rejection persists its own visible failed message as above. Once the limit is exceeded for that key, further inbound messages are refused before any per-message durable write, including before the failed-message row this criterion otherwise requires, and the evidence of that refused activity is one coalesced record per recipient, origin, and window, carrying the first and last refused instant and a count of refusals. That record is written at most once per key per approved flush interval, so the durable writes a flood produces are bounded by the number of windows and flush intervals it spans and not by the number of messages it sends; messages arriving between flushes are refused from the limiter's own non-durable state and update no row. Between flushes the persisted last-refused instant and count are accurate as of the last flush and are read as a lower bound on refusals to date, which the record states rather than presenting as a total. The refusal remains visible to the workspace's reviewers through that record, so a flood is distinguishable from an inbox that simply received nothing, and no message the limiter refused is ever reported as delivered, matched, or clean.

   The size and type limits above and this bound compose in one direction only: the size check is what makes an oversized message a rejection, and this bound is what stops the volume of rejections from becoming the write load. Applied in the other order they do not hold, because the limiter must be consulted before the per-message failed row, not after. Without this paragraph the size check was itself the amplifier the reviewer names: the sender of an inbound message is an unauthenticated external party, the provider request carrying it stays valid however many are sent, and every message the size check refused bought the sender one durable row, so the cheapest message to construct, an oversized or disallowed one, was the one that persisted. AC-02's idempotency by provider and message identity does not bound this, because a flood sends distinct identities by construction.

   The rate limit, its window, the flush interval, and the retention bound on coalesced records are not established by any approved artifact today. `Privacy and security` names rate limits without values, and they belong to the inbound provider and attachment policy in the Approval Blockers, which must also bound the set of coalescing keys, because an unbounded key set reintroduces the growth this bound was added to stop. Until that approval names them, this bound is testable only as "a configured finite per-recipient and per-origin limit is enforced, messages over it are refused before any per-message durable write, and both the number of durable rows and the number of durable writes they produce are bounded by a finite count per key, window, and flush interval rather than growing with the message count," not against a specific number.

## Fixtures and Verification

- Planned automated fixture IDs are the acceptance IDs above; each must map one-to-one to a runnable test before approval can claim implementation readiness.
- F603-AC-06 includes a concurrent fixture for each pair drawn from confirm, reassign, and reject, proving one terminal disposition wins and the loser rejects and rebuilds the match without linking or enqueuing work, and a replayed-rejection fixture proving the terminal disposition is returned rather than re-applied.
- F603-AC-07 includes a flood fixture in which a sending origin submits more rejected messages than the configured limit against one active recipient, proving the durable writes are bounded by windows and flush intervals rather than by message count, and that the coalesced record remains visible to reviewers.
- Regulatory fixtures: none; this feature does not define regulatory ground truth.
- F603-AC-02 includes a fixture in which one provider message identity is delivered to two active workspace-scoped recipients and both messages are stored, matched, and readable only within their own workspaces; a fixture in which a redelivery to the same recipient collapses to the one stored message; and a fixture in which a redelivery presenting that recipient-scoped key with a different payload is refused as a conflict.
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

- Approve inbound provider/domain, webhook/recipient authentication, retention, attachment policy, and matching thresholds. The inbound provider and attachment policy must name the per-recipient and per-origin rate limit, its window, the coalesced-record flush interval, the retention bound on those records, and the bound on the set of coalescing keys that F603-AC-07 leaves unpinned.
- Assign the owner and independent reviewer, approve this spec, and add it to `docs/BASELINE.md`.
