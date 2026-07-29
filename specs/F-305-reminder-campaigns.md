# F-305 · Reminder Campaigns

**Status:** PROPOSED (2026-07-26) — ready for review; not implementable until approved and listed in `docs/BASELINE.md`.

**Phase:** 2 · **Issue:** [#22](https://github.com/jzeng151/pop-engine/issues/22) · **Owner:** TBD · **Reviewer:** product owner plus affected architecture, contract, security, and lane owners (TBD) · **Approval date:** —

## Purpose and User Outcome

An organizer can schedule consent-eligible RSVP reminders at T-7, T-1, and day-of, with preview, cancellation, suppression, and durable delivery.

## Scope

**In scope**

- Create channel-specific campaign drafts for the three Roadmap offsets, select eligible recipients, preview, schedule, cancel, and inspect delivery results.
- Reuse F-203 delivery plumbing through the approved durable job/outbox model.
- Enforce distinct email/SMS marketing consent and central suppression before every attempt.

**Non-goals**

- Emergency messages, arbitrary marketing automation, segmentation beyond event RSVP eligibility, or contact acquisition.
- Sending to contacts without the required channel consent.

## Dependencies and Baseline

- F-302 RSVPs, F-203 messaging plumbing, F-403 consent, approved Event Revisions, and the F-701/F-702/F-703 gate.
- Approved job/outbox, consent, timezone, provider, and template contracts.
- Baseline at draft time: PRD, Roadmap, Design, and Phase 0–1.5 Architecture approved 2026-07-22; `ARCHITECTURE-FUTURE.md` approved as a planning target 2026-07-25; NYC ruleset `nyc.v2.7`, rules schema `popengine-rules/v2`, and scenario fixtures v5 where regulatory output is consumed.
- The approval PR must re-pin any baseline version that changes before approval. A proposed or superseded input blocks implementation.

## Inputs, Outputs, State, Validation, and Errors

- Inputs are an exact event revision, channel, approved template content, and one Roadmap offset; outputs are a recipient snapshot plus message jobs/attempts pinned to that revision.
- Campaign state is draft → scheduled → sending → completed, partially failed, cancelled, or failed; cancellation prevents unclaimed sends.
- Eligibility is rechecked immediately before provider delivery so later opt-out/suppression wins over the schedule snapshot.
- Missing or unresolved material data stays visibly unset, unknown, pending, or failed as appropriate; it never becomes a successful or complete result.
- Invalid input produces a field or action-specific error without partial mutation. Retriable external failures preserve the user's confirmed state and expose a safe retry.

## UI and Accessibility

- Preview shows channel, send time/timezone, eligible/suppressed counts, exact copy, and a confirmation step before scheduling.
- The complete workflow is keyboard operable, uses programmatic labels and visible focus, does not encode status by color alone, and announces asynchronous success or failure.
- Empty, loading, permission-denied, validation, provider-failure, and unavailable states have explicit copy and a safe next action.

## System Impact

| Concern              | Proposed impact                                                                                                         |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| API                  | Campaign draft/schedule/cancel/status operations require OpenAPI contracts and idempotency keys.                        |
| Schema               | Forward migrations for campaign schedule, recipient snapshot/reference, message jobs/attempts, and suppression linkage. |
| Jobs                 | Durable PostgreSQL outbox/worker with leases, bounded retries, cancellation, idempotency, and dead-letter state.        |
| Providers            | Existing email/SMS adapters; SMS remains disabled or labeled according to current provider approval.                    |
| Privacy and security | Workspace scope, consent evidence, opt-out handling, rate limits, redacted message logs, and contact retention apply.   |

Exact HTTP, JSON Schema, migration, job, and provider shapes belong in their reviewed machine contracts; this proposal does not authorize parallel local types or edits to merged migrations.

## Acceptance Criteria

1. **F305-AC-01:** T-7, T-1, and day-of schedules resolve from the pinned event revision in the event timezone and reject a send time already invalid under the approved immediate-send policy; when a new revision changes the event date, one transaction cancels unclaimed old jobs and schedules their replacements while preserving sent attempts and history.
2. **F305-AC-02:** Only RSVP contacts with the required channel consent and no active suppression receive a job.
3. **F305-AC-03:** A consent withdrawal or suppression after scheduling prevents delivery when eligibility is rechecked.
4. **F305-AC-04:** Retries, worker crashes, and duplicate claims do not create more than one accepted provider delivery per recipient/campaign/channel.
5. **F305-AC-05:** Cancellation stops unclaimed jobs, preserves attempts/history, and reports sent, suppressed, failed, and cancelled counts accurately.

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

- Enable email first if SMS approval is incomplete; never simulate a real campaign to user contacts.
- Rollback disables the new surface and workers/provider calls without deleting confirmed user data or rewriting immutable plans, rulesets, revisions, or history.

## Approval Blockers

- Approve job/outbox ADR, consent/retention policy, provider readiness, template copy, and timezone behavior.
- Assign the owner and independent reviewer, approve this spec, and add it to `docs/BASELINE.md`.
