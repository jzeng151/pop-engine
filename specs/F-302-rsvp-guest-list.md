# F-302 · RSVP / Guest List (STRETCH)

**Status:** APPROVED (2026-07-25; Acceptance Criterion 2 amended 2026-08-03, product-owner approved, one person currently holding every lane: admission moves from F-101 `headcount` to the confirmed `capacity`, null meaning no limit, resolving T-6 / SPEC-CONFLICT #209; the rollout compatibility window within that criterion amended 2026-08-05, product-owner approved, so the pre-rename `headcount` key on the guest list carries the enforced limit rather than the `events.headcount` column, resolving issue #236) · **Reviewer/approver:** product owner + affected lane owners via the approval PR · **Owner:** see Lane below · see `docs/BASELINE.md`.
**Phase:** 1.5 (fourth in retention order) · **Lane:** Dev 3 (parallel Track B; core blockers outrank it) · **Depends on:** F-301 · **Feeds:** F-401 (guest-list lookup at check-in)

## User Story

As an attendee who found the event page, I RSVP with name and email in seconds; as the organizer, I see my guest list fill against capacity.

## Inputs / Outputs

- `POST /api/events/:id/rsvps` (public only during the rehearsal/demo window): name, email, optional phone → `rsvps` row. Requires both `public_page_published` (F-301) and the route-specific Cloudflare Access bypass in `DEPLOY.md` §5; publication state is not a deployment gate.
- Organizer view: `GET /api/events/:id/guests` + cancel via `PATCH /api/events/:id/guests/:rsvpId` (separate from the public RSVP path so Access bypass cannot open guest PII); count vs. the event's confirmed `capacity`, which is null when none is set.

## Acceptance Criteria

1. RSVP from the public page takes under 30 seconds, no account.
2. **Capacity-aware (amended 2026-08-03, product-owner approved, resolving T-6 / SPEC-CONFLICT #209):** admission is `events.capacity`, the confirmed venue/event capacity. At a confirmed capacity, new RSVPs are refused with a friendly "event is full" (no waitlist in MVP; that's F-306). **A null `capacity` means no confirmed limit and never refuses** — it is not read as zero, and it does not fall back to another field. Responses carry `capacity: number | null`. `GET /api/events/:id/guests` also carries the same enforced limit under the pre-rename key `headcount: number | null` for the compatibility window described below; admission never reads that key, and it never reports the `events.headcount` column.

   Admission was F-101 `headcount` until this amendment. `headcount` is a regulatory input: it drives the 75-plus assembly gate and the Parks exactly-20 conflict. **(Corrected 2026-08-09, issue #235.)** This sentence carried a third example, a city health threshold keyed on the count, which the published ruleset does not support: no DOHMH rule's trigger reads `headcount`. It is struck here rather than annotated elsewhere, because this paragraph is a contributor's current rationale for the criterion and not a dated approval record. The `docs/BASELINE.md` correction record of 2026-08-05 carries the full case, and the two dated approvals that carry the clause stay on the record in the words they were given, per `docs/DOCUMENTATION-GOVERNANCE.md` §6. Nothing this criterion decides rested on the struck example. Admitting against it meant an organizer raising their guest limit silently moved their permit findings, which is why `ARCHITECTURE.md` already recorded `capacity` as a separate value and "NOT headcount (audit fix)". F-306 promotes into the same field, which is what SPEC-CONFLICT #209 required be settled before it could be approved.

   **Rollout compatibility window (added 2026-08-03).** `docs/ARCHITECTURE.md` line 9 rolls web and
   API independently, so between the two deployments one side speaks the pre-rename contract. A web
   build predating the rename rejects a guest-list response without `event.headcount`, and a build
   after it rejects one without `event.capacity`; either way the organizer gets the "cannot read"
   error and loses the cancel controls until the second deployment finishes. So, until the window
   closes:

   - `GET /api/events/:id/guests` serves `event.capacity` AND `event.headcount`, and both carry the
     same value: the limit this API enforces. `headcount` is the pre-rename NAME for the current
     limit, not the pre-rename VALUE. It does not report the `events.headcount` column, which this
     response no longer reads at all.
   - The web client reads `event.capacity` when the key is present, including when it is null, and
     falls back to `event.headcount` only when `capacity` is absent. A pre-rename API enforces
     `headcount`, so that fallback shows the limit that API is actually applying.

   **Carrying the enforced limit (amended 2026-08-05, product-owner approved, issue #236).** The
   window above kept the response SHAPE working; it did not preserve the MEANING of the number
   shown. Deployed api-first, a pre-rename web build read `event.headcount` as the enforced limit
   while this API admitted against `capacity`: with capacity 5 and headcount 40 the organizer saw
   "1 of 40 confirmed" while the sixth RSVP was refused, and a null capacity displayed a finite
   limit that was enforced nowhere. The fix is this response, not the deployment order: a runbook
   step is only as good as the deployer following it. So the compatibility key carries the active
   limit, which makes an old page's denominator the number admission applies. Both client
   generations stay correct: the current one prefers a present `capacity` including null and never
   reads this key, and its fallback still covers a genuinely pre-rename API, which does enforce its
   own `headcount`.

   **The null case, and what it costs.** A null `capacity` is no confirmed limit and never refuses.
   The pre-rename shape cannot express that: it carries a number, and any number placed there would
   be an enforced limit that nothing enforces, so there is no truthful finite value to send and
   none is invented. `headcount` is therefore null too, stating the same fact as `capacity`. A
   pre-rename page that can only render a number cannot render this, so for a null-capacity event
   it shows its "cannot read" error and loses the cancel controls until the web deployment lands.
   That is the option that misleads least, not a costless one: the alternative was a fabricated
   finite denominator, and a visible failure is preferable to a silent wrong number in a product
   whose other invariant is that an unknown never renders as a known. No RSVP is refused in this
   case, so nothing an attendee sees depends on it. Deploying web-first avoids the gap entirely,
   which is a reason to prefer that order and not a condition of correctness.

   **Still not order-independent.** Api-first with a null capacity degrades as described above, and
   this window does not claim otherwise.

   **Removing `headcount` from this response needs, in this order:** (1) every deployed web build
   reading the guest list is at or past the rename, which for the access-gated demo means the web
   deployment that carries this change has rolled out and no rollback target predating it remains
   selectable; (2) `readLimit` in `apps/web/app/events/[id]/guests/guests-api.ts` and its fallback
   tests are deleted, so the client requires `capacity`; (3) the `headcount` key is dropped from
   `ListRsvpsResult` and from the response `listRsvps` builds in `apps/api/src/rsvps.ts`, and the
   compatibility tests in `apps/api/src/rsvps.test.ts` go with it (the `SELECT` already carries no
   `headcount` column since the 2026-08-05 amendment); (4) this window paragraph, its 2026-08-05
   amendment and its null-case paragraph are removed and AC 2's response sentence returns to
   `capacity` alone. Deployment order does not constrain the removal itself: a client
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
