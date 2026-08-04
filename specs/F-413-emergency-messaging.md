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

1. **F413-AC-01:** Only an actor with the approved event emergency-message permission can reach final confirmation.
2. **F413-AC-02:** Confirmation displays and freezes exact event, channel, audience, recipient count, and message; any edit requires reconfirmation.
3. **F413-AC-03:** Only contacts eligible under the approved emergency purpose/channel policy and not suppressed receive jobs.
4. **F413-AC-04:** Retries/duplicate claims create at most one accepted provider delivery per contact/send/channel and preserve every attempt.
5. **F413-AC-05:** Provider failure or partial delivery reports exact known counts and never claims all attendees were reached.
6. **F413-AC-06:** Delivery atomically claims a non-cancellable `sending` state after its final eligibility/generation check; cancellation, consent withdrawal, and suppression serialize against that claim, prevent only work not yet `sending`, report already-sending attempts separately, preserve every attempt, and keep sent/cancelled counts accurate.
7. **F413-AC-07:** Confirmation freezes the approved explicit validity deadline and send generation. Every retry and delivery claim rejects expired or explicitly superseded generations, cancels their work before `sending`, and preserves their attempt history; the spec does not invent a default validity duration.
8. **F413-AC-08:** Confirmation transactionally freezes the exact eligible contact and channel-endpoint version set, not only its selector/count, and fan-out creates jobs only from that snapshot. Delivery-time eligibility checks may remove newly ineligible snapshot members but cannot add a contact or endpoint that was not confirmed.
9. **F413-AC-09:** Final confirmation carries a stable request identity supplied before the send exists, and the same transaction that creates the send snapshot commits that identity. A recognized replay returns the original send and its send ID and creates no second snapshot; a deliberate second emergency message uses a new identity. F413-AC-04's per `contact/send/channel` deduplication does not reach this case, because a retry that created a second send ID produces two sends whose per-send limits are each satisfied while every recipient is delivered to twice. This criterion is what makes an emergency confirmation attributable to one send that can be shown to have reached a specific person; without it a lost confirmation response leaves the organizer unable to tell one delivered message from two.

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

- Approve emergency consent/legal policy, role, templates/copy limits, validity/supersession and priority/retry policy, and live-provider readiness.
- Assign the owner and independent reviewer, approve this spec, and add it to `docs/BASELINE.md`.
