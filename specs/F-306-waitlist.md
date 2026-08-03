# F-306 · RSVP Waitlist

**Status:** PROPOSED (2026-07-26) — approval blocked by `docs/OPEN-QUESTIONS.md` T-6 / [SPEC-CONFLICT #209](https://github.com/jzeng151/pop-engine/issues/209); not implementable until approved and listed in `docs/BASELINE.md`.

**Phase:** 3 · **Issue:** [#36](https://github.com/jzeng151/pop-engine/issues/36) · **Owner:** TBD · **Reviewer:** product owner plus affected architecture, contract, security, and lane owners (TBD) · **Approval date:** —

## Purpose and User Outcome

When registration capacity is full, an attendee can join a deterministic waitlist and be promoted exactly once when a place becomes available.

## Scope

**In scope**

- Join/leave waitlist, preserve order, atomically promote the earliest eligible entries up to available capacity, and deliver transactional promotion notices.
- Handle RSVP cancellation/capacity increase and concurrent promotion safely.
- Expose organizer counts and attendee status.

**Non-goals**

- Paid holds, priority tiers, lotteries, group reservations, seat selection, or manual reordering.
- Marketing consent inferred from waitlist participation.

## Dependencies and Baseline

- F-302 capacity-aware RSVP, F-403 contact/transactional messaging policy, and approved jobs/outbox.
- Stable public event token and event timezone.
- T-6 / SPEC-CONFLICT #209 must approve one shared F-302/F-306 admission-limit source and semantics; this spec does not choose between F-101 `headcount` and the separate confirmed `capacity`.
- Baseline at draft time: PRD, Roadmap, Design, and Phase 0–1.5 Architecture approved 2026-07-22; `ARCHITECTURE-FUTURE.md` approved as a planning target 2026-07-25; NYC ruleset `nyc.v2.7`, rules schema `popengine-rules/v2`, and scenario fixtures v5 where regulatory output is consumed.
- The approval PR must re-pin any baseline version that changes before approval. A proposed or superseded input blocks implementation.

## Inputs, Outputs, State, Validation, and Errors

- Inputs are event and lifecycle generation, contact, and the approved shared F-302/F-306 admission-limit version; outputs are confirmed RSVP or ordered waitlist entry. Join and promotion remain unavailable while T-6 is unresolved.
- State is waitlisted → promoted/confirmed, withdrawn, or expired; transitions are atomic and idempotent.
- Duplicate contact submissions return current state only to the authenticated attendee or holder of that entry's receipt credential; other callers receive a non-disclosing result. A suppressed marketing contact may still receive only the policy-approved transactional promotion notice.
- Missing or unresolved material data stays visibly unset, unknown, pending, or failed as appropriate; it never becomes a successful or complete result.
- Invalid input produces a field or action-specific error without partial mutation. Retriable external failures preserve the user's confirmed state and expose a safe retry.

## UI and Accessibility

- Attendees see confirmed versus waitlisted state, their next action, and withdrawal; no exact position is shown unless concurrency-safe and approved.
- The complete workflow is keyboard operable, uses programmatic labels and visible focus, does not encode status by color alone, and announces asynchronous success or failure.
- Empty, loading, permission-denied, validation, provider-failure, and unavailable states have explicit copy and a safe next action.

## System Impact

| Concern              | Proposed impact                                                                                                               |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| API                  | Public waitlist join/withdraw/status and organizer operations require OpenAPI idempotency and abuse controls.                 |
| Schema               | Forward migration for ordered waitlist entries and promotion history linked to RSVPs.                                         |
| Jobs                 | Durable transactional promotion delivery with idempotency and bounded retry.                                                  |
| Providers            | Existing email/SMS adapters according to approved transactional-contact policy.                                               |
| Privacy and security | Opaque public tokens, rate limits, minimal status disclosure, workspace scope for organizer views, and redacted contact logs. |

Exact HTTP, JSON Schema, migration, job, and provider shapes belong in their reviewed machine contracts; this proposal does not authorize parallel local types or edits to merged migrations.

## Acceptance Criteria

1. **F306-AC-01:** At the approved shared F-302/F-306 admission limit, an eligible registration creates one ordered waitlist entry rather than an RSVP; no admission decision is available before T-6 resolves that limit.
2. **F306-AC-02:** For any positive availability delta under the approved shared admission limit, one transaction promotes the earliest eligible entries up to all available places and inserts each durable promotion-notice outbox record; it cannot overbook or silently promote without notice work under concurrent workers/requests.
3. **F306-AC-03:** Duplicate join, cancellation, webhook, or retry actions do not create duplicate entries, RSVPs, or promotion messages.
4. **F306-AC-04:** Withdrawal or ineligibility before claim skips that entry without reordering remaining eligible entries.
5. **F306-AC-05:** Promotion communication is transactional only and does not create marketing consent.
6. **F306-AC-06:** Joining returns an unguessable receipt credential shown once; attendee status and withdrawal require that credential or the authenticated entry owner. A duplicate submission without either proof returns only a non-disclosing result and cannot reveal or change the existing entry.
7. **F306-AC-07:** Promotion and its notice outbox record compare-and-swap the current event lifecycle generation and pin the exact promoted RSVP/promotion generation; event closure, RSVP cancellation, or other promotion ineligibility serializes against promotion and the notice delivery claim. Delivery atomically claims `sending` only after rechecking both generations, cancels stale work before `sending`, and accounts for any already-sending notice explicitly.

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

- Enable per event only after concurrency and delivery tests pass; otherwise F-302 continues to reject registrations at capacity.
- Rollback disables the new surface and workers/provider calls without deleting confirmed user data or rewriting immutable plans, rulesets, revisions, or history.

## Approval Blockers

- Resolve T-6 / SPEC-CONFLICT #209 and approve the shared F-302/F-306 admission limit plus ordering, eligibility, promotion-expiry, notification-channel, and capacity-change policy.
- Assign the owner and independent reviewer, approve this spec, and add it to `docs/BASELINE.md`.
