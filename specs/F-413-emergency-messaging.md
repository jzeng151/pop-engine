# F-413 · Emergency Messaging

**Status:** PROPOSED (2026-07-26) — ready for review; not implementable until approved and listed in `docs/BASELINE.md`.

**Phase:** 3 · **Issue:** [#45](https://github.com/jzeng151/pop-engine/issues/45) · **Owner:** TBD · **Reviewer:** product owner plus affected architecture, contract, security, and lane owners (TBD) · **Approval date:** —

## Purpose and User Outcome

An authorized organizer can deliberately send an urgent event message to eligible attendees with preview, confirmation, audit, and consent/suppression enforcement.

## Scope

**In scope**

- Compose, preview, select approved event audience/channel, confirm, send, cancel unclaimed work, and inspect delivery.
- Use separate emergency-message consent/eligibility and central suppression according to approved policy.
- Reuse durable F-203/F-305 delivery infrastructure.

**Non-goals**

- Automatic emergency detection, 911/public-alert integration, geofencing, public-safety advice generation, or messages to ineligible contacts.
- AI-generated emergency copy.

## Dependencies and Baseline

- F-203 messaging plumbing, F-403 consent, F-703 roles, and approved jobs/outbox.
- Approved emergency consent/legal policy, templates, audience, confirmation, and provider readiness.
- Baseline at draft time: PRD, Roadmap, Design, and Phase 0–1.5 Architecture approved 2026-07-22; `ARCHITECTURE-FUTURE.md` approved as a planning target 2026-07-25; NYC ruleset `nyc.v2.7`, rules schema `popengine-rules/v2`, and scenario fixtures v5 where regulatory output is consumed.
- Operand binding for client-supplied identities: `specs/F-411-staff-roles-credentialed-entry.md` F411-AC-08 states once, for this whole branch, that a client-supplied identity is committed with the operands that determine its recorded result and that a reuse carrying different operands is a conflict rather than a replay. Every identity criterion below relies on it. F-411 is PROPOSED, so that rule is not an approved input today and this spec is not implementable against it until F-411 is approved or the rule is promoted to an approved shared invariant; F411-AC-08 records both paths.
- The approval PR must re-pin any baseline version that changes before approval. A proposed or superseded input blocks implementation.

## Inputs, Outputs, State, Validation, and Errors

- Inputs are authorized actor, event, channel, exact message, audience, and an explicit validity deadline under the approved policy; outputs are an immutable send snapshot plus message attempts.
- State is draft → confirmed/queued → sending → completed, partially failed, cancelled, or failed; editing after confirmation requires a new send.
- Eligibility is checked at confirmation and immediately before delivery; unknown eligibility fails closed.
- Missing or unresolved material data stays visibly unset, unknown, pending, or failed as appropriate; it never becomes a successful or complete result.
- Invalid input produces a field or action-specific error without partial mutation. Retriable external failures preserve the user's confirmed state and expose a safe retry.

## UI and Accessibility

- A high-friction confirmation repeats event, audience count, channel, exact text, and irreversible effect; status is live and accessible.
- The complete workflow is keyboard operable, uses programmatic labels and visible focus, does not encode status by color alone, and announces asynchronous success or failure.
- Empty, loading, permission-denied, validation, provider-failure, and unavailable states have explicit copy and a safe next action.

## System Impact

| Concern              | Proposed impact                                                                                                                             |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| API                  | Emergency-message preview/confirm/cancel/status operations require approved OpenAPI idempotency and authorization contracts.                |
| Schema               | Reuse consent/message jobs; add only immutable emergency send snapshot and audit fields by forward migration.                               |
| Jobs                 | Priority-aware durable delivery with idempotency, bounded retry, cancellation, and complete attempt accounting.                             |
| Providers            | Approved email/SMS adapters only; no simulated user-facing emergency send.                                                                  |
| Privacy and security | Narrow organizer permission, rate/volume controls, consent/suppression, immutable audit, redacted logs, and provider credential protection. |

Exact HTTP, JSON Schema, migration, job, and provider shapes belong in their reviewed machine contracts; this proposal does not authorize parallel local types or edits to merged migrations.

## Acceptance Criteria

1. **F413-AC-01:** Only an actor holding the approved event-scoped emergency-message permission for that exact event can reach final confirmation, and that same permission, re-checked against the actor's current assignment inside the transaction that performs the operation, is required for every other mutation this feature defines: creating or editing the draft, final confirmation under F413-AC-02, cancellation under F413-AC-06, and any retry or supersession under F413-AC-07. A request failing that check is refused before any state change, creates or cancels no send, snapshot, or job, and does not disclose whether the send exists. The permission is named here for every mutation rather than only for confirmation because F-703 supplies the role model but does not map F-413's actions onto it, so an implementation built to the other criteria satisfies all of them while letting a workspace member who lacks the permission cancel an urgent message before delivery claims `sending`: AC-06 states what cancellation must serialize against, not who may call it. Which role holds this permission is not established by any approved artifact today; the Approval Blockers name it, so until that approval lands this criterion is testable only as "one configured event-scoped permission gates every mutation above, and an actor lacking it is refused before any durable change," not against a named role.
2. **F413-AC-02:** Confirmation displays and freezes exact event, channel, audience, recipient count, and message; any edit requires reconfirmation. Final confirmation names the exact draft version it displayed, and the single transaction that creates the send snapshot compare-and-swaps that version before moving the draft from `draft` to `confirmed`. A mismatch rejects the whole confirmation, creates no send, snapshot, or job, and returns the current draft for re-review; the server never confirms a draft the actor did not see, and only one transition out of a given draft version can win. Every draft edit likewise supplies the draft version it was edited from, so a concurrent edit is rejected rather than silently replaced before anyone reviews it. F413-AC-09's request identity does not reach this case: it recognizes a retry of one confirmation, while this comparison is what stops two deliberate confirmations of the same reviewed draft, each carrying its own identity, from both creating a send and delivering the emergency message to every recipient twice.
3. **F413-AC-03:** Only contacts eligible under the approved emergency purpose/channel policy and not suppressed receive jobs.
4. **F413-AC-04:** Retries/duplicate claims create at most one accepted provider delivery per contact/send/channel and preserve every attempt.
5. **F413-AC-05:** Provider failure or partial delivery reports exact known counts and never claims all attendees were reached.
6. **F413-AC-06:** Delivery atomically claims a non-cancellable `sending` state after its final eligibility/generation check; cancellation, consent withdrawal, and suppression serialize against that claim, prevent only work not yet `sending`, report already-sending attempts separately, preserve every attempt, and keep sent/cancelled counts accurate. Organizer-initiated cancellation additionally requires the F413-AC-01 permission, checked before the cancellation touches any job.
7. **F413-AC-07:** Confirmation freezes the approved explicit validity deadline and send generation. Every retry and delivery claim rejects expired or explicitly superseded generations, cancels their work before `sending`, and preserves their attempt history; the spec does not invent a default validity duration.
8. **F413-AC-08:** Confirmation transactionally freezes the exact eligible contact and channel-endpoint version set, not only its selector/count, and fan-out creates jobs only from that snapshot. Delivery-time eligibility checks may remove newly ineligible snapshot members but cannot add a contact or endpoint that was not confirmed.
9. **F413-AC-09:** Draft creation and final confirmation each carry their own stable client-supplied request identity, supplied before the record each one creates exists. That identity binds its operands under the rule `F411-AC-08` states once for every client-supplied identity on this branch: it is committed together with the request fields that determine the recorded result, including every aggregate, version, and generation the request names, and a later request presenting the same identity with any different operand is refused as a conflict rather than being answered with the stored result. The identity is still the key and the operands are only a precondition on reusing it, so this is not the content uniqueness this criterion already forbids.

   Draft creation commits its identity with the first draft version, in the same transaction that creates the draft, under a uniqueness constraint scoped to the event. A recognized replay returns the original draft and its draft ID and creates no second draft. Creation is named here from 2026-08-04 because it was the one mutation in this feature with no committed identity and no predecessor version: F413-AC-02's compare-and-swap starts at the first edit, which needs a draft version to name, and the confirmation identity below is supplied at confirmation, so a creation whose response is lost leaves the organizer's retry with nothing to recognize. That retry creates a second draft of the same emergency notice, each draft is independently confirmable under its own valid confirmation identity, each confirmation produces its own send, and F413-AC-04's per `contact/send/channel` deduplication is satisfied by both because they are different sends. Every attendee then receives the emergency notice twice, which is the exact outcome the confirmation identity exists to prevent, reached one step earlier in the lifecycle. This is the same client-identity contract every other creating operation in this feature set carries, applied to the operation that creates the draft.

   Final confirmation commits its identity in the same transaction that creates the send snapshot, under a uniqueness constraint scoped to the event. A recognized replay returns the original send and its send ID and creates no second snapshot; a deliberate second emergency message uses a new identity, and a deliberate second draft likewise sends a new creation identity. F413-AC-04's per `contact/send/channel` deduplication does not reach this case, because a retry that created a second send ID produces two sends whose per-send limits are each satisfied while every recipient is delivered to twice. This criterion is what makes an emergency confirmation attributable to one send that can be shown to have reached a specific person; without it a lost confirmation response leaves the organizer unable to tell one delivered message from two.

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

- Keep disabled until live provider, consent, volume, incident-response, and deployed end-to-end checks pass.
- Rollback disables the new surface and workers/provider calls without deleting confirmed user data or rewriting immutable plans, rulesets, revisions, or history.

## Approval Blockers

- Approve emergency consent/legal policy, role, templates/copy limits, validity/supersession and priority/retry policy, and live-provider readiness. The role approval must name which event-scoped permission F413-AC-01 gates every emergency-send mutation on, including cancellation.
- Assign the owner and independent reviewer, approve this spec, and add it to `docs/BASELINE.md`.
