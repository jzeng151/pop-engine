# F-306 · RSVP Waitlist

**Status:** PROPOSED (2026-07-26) — `docs/OPEN-QUESTIONS.md` T-6 / [SPEC-CONFLICT #209](https://github.com/jzeng151/pop-engine/issues/209) was resolved 2026-08-03 and no longer blocks this spec. The approvals listed under Approval Blockers below are still outstanding; not implementable until approved and listed in `docs/BASELINE.md`.

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
- **T-6 / SPEC-CONFLICT #209 is resolved 2026-08-03, product-owner approved:** the shared F-302/F-306 admission limit is `events.capacity`, the confirmed venue/event capacity, and a null `capacity` means no confirmed limit. F-101 `headcount` is not the limit; it is a regulatory input and admitting against it would let a guest-limit change move a permit finding. A null capacity therefore never fills, so on an event whose capacity is null no NEW registration is ever waitlisted: each one is confirmed directly and the waitlist stays empty by construction rather than by a special case. That is a statement about new registrations only. An event that already holds waitlist entries and then has its capacity cleared to null still holds them, and this spec does not say what becomes of them: promote all of them, freeze them in place, or refuse the capacity change are all open. Which one applies is the capacity-change policy still listed as an approval blocker below, and F-306 does not answer it here.
- Baseline at draft time: PRD, Roadmap, Design, and Phase 0–1.5 Architecture approved 2026-07-22; `ARCHITECTURE-FUTURE.md` approved as a planning target 2026-07-25; NYC ruleset `nyc.v2.7`, rules schema `popengine-rules/v2`, and scenario fixtures v5 where regulatory output is consumed.
- Operand binding for client-supplied identities: `specs/F-411-staff-roles-credentialed-entry.md` F411-AC-08 states once, for this whole branch, that a client-supplied identity is committed with the operands that determine its recorded result and that a reuse carrying different operands is a conflict rather than a replay. Every identity criterion below relies on it. F-411 is PROPOSED, so that rule is not an approved input today and this spec is not implementable against it until F-411 is approved or the rule is promoted to an approved shared invariant; F411-AC-08 records both paths.
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
6. **F306-AC-06:** The join request carries a client-generated unguessable join secret, and the transaction that creates the entry commits a verifier for it under a uniqueness constraint scoped to that event's waitlist, so the attendee holds the proof before the response exists. Joining returns that receipt credential, shown once, and attendee status and withdrawal require it or the authenticated entry owner. A retry presenting the same secret returns the existing entry and its credential rather than a non-disclosing result, so a join that commits with a lost response leaves the attendee able to view and withdraw it; without that binding, AC-03's at-most-one-entry rule would strand an unauthenticated attendee with no credential and no way to create another. A submission carrying neither proof still returns only a non-disclosing result and cannot reveal or change the existing entry. The secret binds its operands under the rule `F411-AC-08` states once for every client-supplied identity on this branch: the committed verifier carries the event and the contact point the entry was created for, and a submission presenting a committed secret with a different event or contact point is refused as a conflict rather than being answered with the existing entry. Without that binding the secret is a replay key the client chooses for content the server never matched it against, so a caller holding one secret could submit arbitrary contact points and learn from the answer which entry it names.
7. **F306-AC-07:** Promotion and its notice outbox record compare-and-swap the current event lifecycle generation and pin the exact promoted RSVP/promotion generation; event closure, RSVP cancellation, or other promotion ineligibility serializes against promotion and the notice delivery claim. Delivery atomically claims `sending` only after rechecking both generations, cancels stale work before `sending`, and accounts for any already-sending notice explicitly.

8. **F306-AC-08:** Public waitlist joins are rate limited per event and per approved public submission origin. Within that limit every join is processed as AC-01 through AC-06 describe. Once the limit is exceeded for that key, further joins are refused before any per-request durable write, including before the AC-06 entry and its join-secret verifier and before any promotion or notice work becomes reachable for them, and the evidence of that refused activity is one coalesced record per event, origin, and window, carrying the first and last refused instant and a count of refusals, written at most once per key per approved flush interval. The refusal is reported to the attendee with a safe next action under UI and Accessibility and is never reported as a join, so a refused request is never given a receipt credential or a status AC-06 would resolve.

   This criterion and F306-AC-06 are evaluated in one stated order, the same order `F411-AC-08` sets out for validation and `F403-AC-09` for consent capture, because each otherwise assumes it owns the request. A join presenting a committed join secret whose operands match under F306-AC-06 is resolved from that record first: it returns the existing entry and its credential, creates nothing, and consumes no unit of this limit. Every other join is then checked against this limit and refused if it is exceeded, before its entry and secret verifier are committed. Only a join passing both creates an entry. Resolving the recognized secret first is what makes the two composable: enforcing the limit first would refuse the attendee whose original join consumed the last unit and then lost its response, stranding them with a committed entry they can never reach, which is exactly the outcome F306-AC-06 exists to prevent. The consequence is stated rather than left implied: a refused join commits no entry and no verifier, so presenting its secret after the window has passed is a first join and not a replay, and F306-AC-06's replay guarantee covers exactly the secrets that reached a committed entry.

   This is the rule `F715-AC-09` states, applied rather than restated: an externally reachable surface may not persist a row or enqueue work per rejected request, a rejection costs the caller a request and the system a bounded number of writes per key, window, and flush interval, and the check that bounds it runs before the write it bounds. `F603-AC-07` states it for inbound email, `F411-AC-07` for credential validation, and `F715-AC-09` for the public issue queue; this criterion is the fourth instance and adds no new formulation of it. The between-flush reading of the coalesced record, the requirement that the set of coalescing keys itself be bounded, and the retention bound on those records are as `F715-AC-09` states them.

   Nothing above bounds this today. A full public event is exactly when this surface is reachable: an unauthenticated caller submits an unlimited stream of fresh contacts and fresh AC-06 join secrets, each request satisfies AC-03 and AC-06 because each is a genuinely distinct attendee by construction, and each therefore commits a durable ordered entry plus a secret verifier and puts future promotion and notice work behind it. AC-03's duplicate collapsing does not bound it, because a flood sends distinct contacts and distinct secrets by construction. The System Impact API row names abuse controls without values and outside the acceptance criteria, and an implementation is built to the acceptance criteria, so the public join surface this feature exists to expose is unbounded write and worker amplification until a criterion says otherwise.

   The exact limit, window, coalescing window, flush interval, and retention bound are not approved today and this criterion does not invent them; they belong with the ordering, eligibility, and capacity-change policy named in the Approval Blockers. Until that approval names them, this criterion is testable only as "a configured finite limit is enforced per event and origin, joins over it are refused before any per-request durable write, and both the number of durable rows and the number of durable writes a refused flood produces are bounded by a finite count per key, window, and flush interval rather than growing with the request count," not against a specific number.

## Fixtures and Verification

- Planned automated fixture IDs are the acceptance IDs above; each must map one-to-one to a runnable test before approval can claim implementation readiness.
- F306-AC-08 includes a replay-first fixture in which the join that consumes the last unit of the limit loses its response and the attendee's retry with the committed secret returns the existing entry and credential rather than a refusal, and a fixture proving a refused join committed no entry and no verifier so its secret is a first join later, not a replay. It also includes a flood fixture in which a full public event receives more joins than the configured limit from one origin and the durable rows and durable writes are counted, proving both are bounded by the number of keys, windows, and flush intervals rather than by the request count, and that no refused join created an entry, a secret verifier, or promotion work. F306-AC-06 includes a mismatched-reuse fixture in which a committed join secret is presented with a different contact point and is refused as a conflict, revealing nothing about the entry it names.
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

- ~~Resolve T-6 / SPEC-CONFLICT #209 and approve the shared F-302/F-306 admission limit~~ **resolved 2026-08-03: the shared limit is `events.capacity`.** Still to approve: ordering, eligibility, promotion-expiry, notification-channel, and capacity-change policy. That approval must also name F306-AC-08's join limit and window, its coalescing window, flush interval, and retention bound, and the approved public submission origin the limit is keyed on, because that criterion cannot be evaluated against a value no approved artifact establishes and may not invent one.
- Assign the owner and independent reviewer, approve this spec, and add it to `docs/BASELINE.md`.
