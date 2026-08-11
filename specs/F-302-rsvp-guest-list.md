# F-302 · RSVP / Guest List (STRETCH)

**Status:** APPROVED (2026-07-25; Acceptance Criterion 2 amended 2026-08-03, product-owner approved, one person currently holding every lane: admission moves from F-101 `headcount` to the confirmed `capacity`, null meaning no limit, resolving T-6 / SPEC-CONFLICT #209; the 2026-08-05 issue #236 choice B was superseded 2026-08-10 by the product-owner-approved choice A, which eliminates the semantic window with a coordinated web-first deployment) · **Reviewer/approver:** product owner + affected lane owners via the approval PR · **Owner:** see Lane below · see `docs/BASELINE.md`.
**Phase:** 1.5 (fourth in retention order) · **Lane:** Dev 3 (parallel Track B; core blockers outrank it) · **Depends on:** F-301 · **Feeds:** F-401 (guest-list lookup at check-in)

## User Story

As an attendee who found the event page, I RSVP with name and email in seconds; as the organizer, I see my guest list fill against capacity.

## Inputs / Outputs

- `POST /api/events/:id/rsvps` (public only during the rehearsal/demo window): name, email, optional phone → `rsvps` row. Requires both `public_page_published` (F-301) and the route-specific Cloudflare Access bypass in `DEPLOY.md` §5; publication state is not a deployment gate.
- Organizer view: `GET /api/events/:id/guests` + cancel via `PATCH /api/events/:id/guests/:rsvpId` (separate from the public RSVP path so Access bypass cannot open guest PII); count vs. the event's confirmed `capacity`, which is null when none is set.

## Acceptance Criteria

1. RSVP from the public page takes under 30 seconds, no account.
2. **Capacity-aware (amended 2026-08-03, product-owner approved, resolving T-6 / SPEC-CONFLICT #209):** admission is `events.capacity`, the confirmed venue/event capacity. At a confirmed capacity, new RSVPs are refused with a friendly "event is full" (no waitlist in MVP; that's F-306). **A null `capacity` means no confirmed limit and never refuses** — it is not read as zero, and it does not fall back to another field. Responses carry `capacity: number | null`. For the shape-compatibility window below, `GET /api/events/:id/guests` also carries the pre-rename `headcount: number`; that key retains the `events.headcount` value and admission never reads it.

   Admission was F-101 `headcount` until this amendment. `headcount` is a regulatory input: it drives the 75-plus assembly gate and the Parks exactly-20 conflict. **(Corrected 2026-08-09, issue #235.)** This sentence carried a third example, a city health threshold keyed on the count, which the published ruleset does not support: no DOHMH rule's trigger reads `headcount`. It is struck here rather than annotated elsewhere, because this paragraph is a contributor's current rationale for the criterion and not a dated approval record. The `docs/BASELINE.md` correction record of 2026-08-05 carries the full case, and the two dated approvals that carry the clause stay on the record in the words they were given, per `docs/DOCUMENTATION-GOVERNANCE.md` §6. Nothing this criterion decides rested on the struck example. Admitting against it meant an organizer raising their guest limit silently moved their permit findings, which is why `ARCHITECTURE.md` already recorded `capacity` as a separate value and "NOT headcount (audit fix)". F-306 promotes into the same field, which is what SPEC-CONFLICT #209 required be settled before it could be approved.

   **Rollout compatibility window (added 2026-08-03 on PR #226).** `docs/ARCHITECTURE.md` line 9 rolls web and
   API independently, so between the two deployments one side speaks the pre-rename contract. A web
   build predating the rename rejects a guest-list response without `event.headcount`, and a build
   after it rejects one without `event.capacity`; either way the organizer gets the "cannot read"
   error and loses the cancel controls until the second deployment finishes. So, until the window
   closes:

   - `GET /api/events/:id/guests` serves `event.capacity` AND `event.headcount`. `headcount` retains
     its pre-rename meaning, the `events.headcount` column; it is not capacity under an old name.
   - The web client reads `event.capacity` when the key is present, including when it is null, and
     falls back to `event.headcount` only when `capacity` is absent. A pre-rename API enforces
     `headcount`, so that fallback shows the limit that API is actually applying.

   **Shape compatibility does not solve issue #236.** Deployed api-first, a pre-rename web build
   treats `event.headcount` as the enforced limit while the new api admits against `capacity`.
   These are two distinct failures. With `capacity = 5` and `headcount = 40`, the page displays the
   wrong numeric limit and the sixth RSVP is refused under a "1 of 40 confirmed" display. With
   `capacity = null`, admission enforces no limit at all but the page displays the finite
   `headcount` limit, which is enforced nowhere. Both services remain up and shape-compatible.

   **Choice A (2026-08-10, product-owner approved, superseding the 2026-08-05 choice B).** Eliminate
   that semantic window through the coordinated web-first release in `DEPLOY.md`: deploy and verify
   the web build against the old api, confirm no pre-rename web build or rollback target remains
   selectable, and only then deploy the api. The new web safely reads the old api's `headcount`,
   which that api enforces, then reads the new api's present `capacity`, including null. The
   repository's deployment-order test pins this instruction while the response remains shape-only.

   **Removing `headcount` from this response needs, in this order:** (1) every deployed web build
   reading the guest list is at or past the rename, which for the access-gated demo means the web
   deployment that carries this change has rolled out and no rollback target predating it remains
   selectable; (2) `readLimit` in `apps/web/app/events/[id]/guests/guests-api.ts` and its fallback
   tests are deleted, so the client requires `capacity`; (3) the `headcount` key is dropped from
   `ListRsvpsResult` and from the response `listRsvps` builds in `apps/api/src/attendance/rsvps.ts`, and the
   compatibility tests in `apps/api/src/attendance/rsvps.test.ts` go with it; (4) this window paragraph and its
   choice-A rollout constraint are removed and AC 2's response sentence returns to `capacity`
   alone. Deployment order does not constrain the removal itself: a client
   that still carries the fallback reads a response carrying only `capacity`, because a present
   `capacity` always wins. Condition (1) is the one that gates it. `events.headcount` itself is
   NOT dropped by any of this: it stays a regulatory intake input read by F-101, F-301 and the
   engine.

3. Duplicate contact for the same event updates the existing RSVP, no double-count.
4. Guest list is available to F-401: a check-in matching an RSVP contact links to it (registered vs. walk-in distinction on F-402).
5. Organizer can cancel an RSVP (status → cancelled; frees capacity).
6. Outside the rehearsal/demo window, an unauthenticated POST is stopped by Cloudflare Access before Express and creates no `rsvps` row. The deployment smoke check opens only the public RSVP path for the window, never `/guests`, then closes it and verifies it is blocked again.

## Edge Cases

- Concurrent RSVPs at the capacity boundary: enforce at insert (transactional count check), not in the UI.
- RSVP after event date: refused with "this event has passed."

## Answer-Key Scenarios Exercised

None. Demo: one seeded RSVP plus one live RSVP if time allows (seeded RSVP data is a permitted fallback per DESIGN.md).
