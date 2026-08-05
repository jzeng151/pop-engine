# F-306 · RSVP Waitlist

**Status:** PROPOSED (2026-07-26) — `docs/OPEN-QUESTIONS.md` T-6 / [SPEC-CONFLICT #209](https://github.com/jzeng151/pop-engine/issues/209) was resolved 2026-08-03 and no longer blocks this spec. The approvals listed under Approval Blockers below are still outstanding; not implementable until approved and listed in `docs/BASELINE.md`.

**Phase:** 3 · **Issue:** [#36](https://github.com/jzeng151/pop-engine/issues/36) · **Owner:** TBD · **Reviewer:** product owner · **Approval date:** —

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
- **T-6 / SPEC-CONFLICT #209 is resolved 2026-08-03, product-owner approved:** the shared F-302/F-306 admission limit is `events.capacity`, the confirmed venue/event capacity, and a null `capacity` means no confirmed limit. F-101 `headcount` is not the limit; it is a regulatory input and admitting against it would let a guest-limit change move a permit finding. A null capacity therefore never fills, so on an event whose capacity is null no NEW registration is ever waitlisted: each one is confirmed directly and the waitlist stays empty by construction rather than by a special case. That is a statement about new registrations only. An event that already holds waitlist entries and then has its capacity cleared to null still holds them, and this spec does not say what becomes of them: promote all of them, freeze them in place, or refuse the capacity change are all open. Which one applies is the capacity-change policy still listed as an approval blocker below, and F-306 does not answer it here.
- Baseline at draft time: PRD, Roadmap, Design, and Phase 0–1.5 Architecture approved 2026-07-22; `ARCHITECTURE-FUTURE.md` approved as a planning target 2026-07-25; NYC ruleset `nyc.v2.7`, rules schema `popengine-rules/v2`, and scenario fixtures v5 where regulatory output is consumed.
- The approval PR must re-pin any baseline version that changes before approval. A proposed or superseded input blocks implementation.

## Inputs, Outputs, State, Validation, and Errors

- Inputs are event and lifecycle generation, contact, and the shared F-302/F-306 admission limit T-6 resolved, `events.capacity`; outputs are confirmed RSVP or ordered waitlist entry. Join and promotion remain unavailable until this spec is approved.
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

1. **F306-AC-01:** At the shared F-302/F-306 admission limit, a confirmed `events.capacity`, an eligible registration creates one ordered waitlist entry rather than an RSVP; a null capacity is no confirmed limit, so the event never fills and no new registration is waitlisted. This criterion governs new registrations only. It states nothing about entries that already exist when a capacity is cleared to null, which the capacity-change policy named in the approval blockers decides; until that policy is approved, an implementation may not infer a transition for them.
2. **F306-AC-02:** For any positive availability delta under the approved shared admission limit, one transaction promotes the earliest eligible entries up to all available places and inserts each durable promotion-notice outbox record; it cannot overbook or silently promote without notice work under concurrent workers/requests.
3. **F306-AC-03:** Duplicate join, cancellation, webhook, or retry actions do not create duplicate entries, RSVPs, or promotion messages.
4. **F306-AC-04:** Withdrawal or ineligibility before claim skips that entry without reordering remaining eligible entries.
5. **F306-AC-05:** Promotion communication is transactional only and does not create marketing consent.
6. **F306-AC-06:** The join request carries a client-generated unguessable join secret, and the transaction that creates the entry commits a verifier for it, so the attendee holds the proof before the response exists. Joining returns that receipt credential, shown once, and attendee status and withdrawal require it or the authenticated entry owner. A retry presenting the same secret returns the existing entry and its credential rather than a non-disclosing result, so a join that commits with a lost response leaves the attendee able to view and withdraw it; without that binding, AC-03's at-most-one-entry rule would strand an unauthenticated attendee with no credential and no way to create another. A submission carrying neither proof still returns only a non-disclosing result and cannot reveal or change the existing entry.
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

- ~~Resolve T-6 / SPEC-CONFLICT #209 and approve the shared F-302/F-306 admission limit~~ **resolved 2026-08-03: the shared limit is `events.capacity`.** Still to approve: ordering, eligibility, promotion-expiry, notification-channel, and capacity-change policy.
- Assign the owner, approve this spec, and add it to `docs/BASELINE.md`. The reviewer capacity is the product owner (`docs/DOCUMENTATION-GOVERNANCE.md` §6, 2026-08-04), which is what this spec's header records. That does not meet the independent reviewer this blocker asked for. Spec approval publishes no ruleset and asserts no regulatory fact, so the requirement never rested on §6's closing paragraph's first sentence; it rested on the second, and a one-person team cannot make the author and the reviewer distinct. §6 records that element UNMET rather than removing it, and names what would satisfy it: a second contributor with repository access who reviews this spec before approval and is named here beside the owner. Until then this blocker is not satisfied and this spec is not approved: it stays PROPOSED under governance §3, its Approval date stays `—`, and it is not implementable and not listed in `docs/BASELINE.md`. The author's own review does not stand in for the missing reviewer, and this line says so rather than leaving the gap to be read as approval.
