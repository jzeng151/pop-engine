# F-305 · Reminder Campaigns

**Status:** PROPOSED (2026-07-26) — ready for review; not implementable until approved and listed in `docs/BASELINE.md`.

**Phase:** 2 · **Issue:** [#22](https://github.com/jzeng151/pop-engine/issues/22) · **Owner:** TBD · **Reviewer:** product owner plus affected architecture, contract, security, and lane owners (TBD) · **Approval date:** —

## Purpose and User Outcome

An organizer can schedule consent-eligible RSVP reminders at T-7, T-1, and day-of, with preview, cancellation, suppression, and durable delivery.

## Scope

**In scope**

- Create channel-specific campaign drafts for the three Roadmap offsets, select eligible recipients, preview, schedule, cancel, and inspect delivery results.
- Reuse F-203 delivery plumbing through the approved durable job/outbox model.
- Enforce a distinct channel-specific transactional-notification lawful/consent basis, separate email/SMS marketing consent, and central purpose-scoped suppression before every attempt.

**Non-goals**

- Emergency messages, arbitrary marketing automation, segmentation beyond event RSVP eligibility, or contact acquisition.
- Sending to contacts without the required channel-specific transactional-notification basis.

## Dependencies and Baseline

- F-302 RSVPs, F-203 messaging plumbing, F-403 consent, approved Event Revisions, and the F-701/F-702/F-703 gate.
- Approved job/outbox, consent, timezone, provider, and template contracts.
- Baseline at draft time: PRD, Roadmap, Design, and Phase 0–1.5 Architecture approved 2026-07-22; `ARCHITECTURE-FUTURE.md` approved as a planning target 2026-07-25; NYC ruleset `nyc.v2.7`, rules schema `popengine-rules/v2`, and scenario fixtures v5 where regulatory output is consumed.
- The approval PR must re-pin any baseline version that changes before approval. A proposed or superseded input blocks implementation.

## Inputs, Outputs, State, Validation, and Errors

- Inputs are an exact event revision and lifecycle generation, channel, approved template content, one Roadmap offset, and, on every draft mutation, the exact draft version it was composed against plus its own request identity under F305-AC-08; outputs are a recipient snapshot plus message jobs/attempts pinned to that revision, lifecycle generation, and exact channel-endpoint version.
- Campaign state is draft → scheduled → sending → completed, partially failed, cancelled, or failed; cancellation marks the send generation stale and prevents unsent work from reaching a provider.
- Eligibility, pinned revision, event lifecycle generation, campaign generation, and exact channel-endpoint version are rechecked immediately before provider delivery so later transactional opt-out, suppression, endpoint change, reschedule, event cancellation/archive, or campaign cancellation wins over the schedule snapshot.
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

1. **F305-AC-01:** T-7, T-1, and day-of schedules resolve from the pinned event revision in the event timezone and reject a send time already invalid under the approved immediate-send policy; when a new revision changes any approved message-relevant field, one transaction marks the old send generation cancelled and schedules replacements pinned to the new revision, recomputing times when date/time changed and otherwise preserving them, while retaining sent attempts/history.
2. **F305-AC-02:** Only RSVP contacts with the approved channel-specific transactional-notification lawful/consent record and no active suppression for that purpose receive a job. Marketing consent is not required; a marketing opt-out remains enforced for marketing without withdrawing the distinct transactional basis. A new RSVP, newly established transactional-notification basis, removed suppression, or channel-endpoint change advances the recipient generation, cancels obsolete unsent jobs, and creates exactly one replacement job for each still-pending campaign offset when the current endpoint remains eligible; replay or concurrent enrollment cannot duplicate a job, and an offset already invalid under the approved immediate-send policy remains unscheduled.
3. **F305-AC-03:** Delivery atomically claims a non-cancellable `sending` state after its final eligibility, generation, and exact channel-endpoint-version check; transactional-notification withdrawal, suppression, endpoint change, reschedule, event cancellation/archive, or campaign cancellation serializes against that claim and cannot report prevention for already-sending work. Unrelated revisions do not stale the message generation.
4. **F305-AC-04:** Retries, worker crashes, and duplicate claims do not create more than one accepted provider delivery per recipient/campaign/channel.
5. **F305-AC-05:** Cancellation stops unclaimed and pre-`sending` leased jobs before provider delivery; a job that already claimed the non-cancellable `sending` state continues as accounted already-sending work under AC-03. Attempts/history remain preserved and sent, suppressed, failed, already-sending, and cancelled counts stay accurate.
6. **F305-AC-06:** The day-of reminder includes confirmed directions pinned and linked to their source record/version. Missing or unconfirmed directions block that reminder, and a directions-source change invalidates and replaces unsent work under AC-01.
7. **F305-AC-07:** Scheduling rejects a cancelled or archived event. A transition to either state advances the lifecycle generation and atomically cancels every job that has not claimed `sending`; already-sending work remains accounted under AC-03 and no replacement reminder is scheduled.
8. **F305-AC-08:** Draft creation, not scheduling, is the transaction that creates the campaign, matching the `draft → scheduled` state model and the draft operations the API surface already carries. It takes a stable client-supplied request identity supplied before the campaign exists, and the transaction that creates the draft commits that identity under a uniqueness constraint scoped to the event; a recognized replay returns the original draft campaign and creates no second one, while a deliberately separate campaign uses a new identity. F305-AC-04's per `recipient/campaign/channel` guarantee does not reach this case, because two campaigns each deliver once to the same recipients and neither exceeds its own limit.

   The draft campaign is a versioned aggregate from that creating transaction onward, and every later mutation of it names the exact draft version it was composed against and commits only by compare-and-swap on that version, carrying its own stable request identity distinct from the creation identity above. That is every mutable part of the draft and not only the field a reviewer happens to name: channel, template content selection, the Roadmap offset, the recipient scope the preview is computed from, any other approved draft-held value, and the discard or deletion of the draft itself are each composed against a named version on the same terms. A stale mutation changes nothing, and returns the current draft for the organizer to reload, recompose, and preview again.

   F305-AC-09 compare-and-swaps the draft version at scheduling, which stops a schedule built from a draft the organizer did not preview and cannot recover an edit already lost inside the draft. Without the comparison above, two organizers editing one draft from a single observed version both report success and the later write silently replaces the earlier one's channel, content, or offset, so AC-09 then schedules a draft that is perfectly current and missing a change its organizer was told had saved, and the recipient snapshot and jobs it creates in the same transaction go out against that draft. Without the per-mutation identity, a lost response on a draft edit gives the organizer no way to tell a committed edit from a failed one, and the retry is a fresh mutation against a version the first attempt has already advanced.
9. **F305-AC-09:** Scheduling is a transition of a campaign that already exists. It names the exact draft campaign version the organizer previewed and confirmed, carries its own stable request identity distinct from AC-08's, and commits only by compare-and-swap on that version: success moves the campaign from `draft` to `scheduled` and creates the recipient snapshot and jobs in the same transaction, while a version mismatch schedules nothing, creates no snapshot or job, and returns the current draft for the organizer to preview and confirm again. A recognized replay of the scheduling identity returns the original scheduled result and creates no second recipient snapshot or job set. Splitting the two is what makes both implementable: binding scheduling to AC-08's creation identity would leave the transition itself with no replay or stale-write protection, while treating scheduling as the creation would leave the draft that the scope and state model require for preview with nowhere durable to live.

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
