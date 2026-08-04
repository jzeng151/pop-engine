# F-302 · RSVP / Guest List (STRETCH)

**Status:** APPROVED (2026-07-25; Acceptance Criterion 2 amended 2026-08-03, product-owner approved, one person currently holding every lane: admission moves from F-101 `headcount` to the confirmed `capacity`, null meaning no limit, resolving T-6 / SPEC-CONFLICT #209) · **Reviewer/approver:** product owner + affected lane owners via the approval PR · **Owner:** see Lane below · see `docs/BASELINE.md`.
**Phase:** 1.5 (fourth in retention order) · **Lane:** Dev 3 (parallel Track B; core blockers outrank it) · **Depends on:** F-301 · **Feeds:** F-401 (guest-list lookup at check-in)

## User Story

As an attendee who found the event page, I RSVP with name and email in seconds; as the organizer, I see my guest list fill against capacity.

## Inputs / Outputs

- `POST /api/events/:id/rsvps` (public only during the rehearsal/demo window): name, email, optional phone → `rsvps` row. Requires both `public_page_published` (F-301) and the route-specific Cloudflare Access bypass in `DEPLOY.md` §5; publication state is not a deployment gate.
- Organizer view: `GET /api/events/:id/guests` + cancel via `PATCH /api/events/:id/guests/:rsvpId` (separate from the public RSVP path so Access bypass cannot open guest PII); count vs. the event's confirmed `capacity`, which is null when none is set.

## Acceptance Criteria

1. RSVP from the public page takes under 30 seconds, no account.
2. **Capacity-aware (amended 2026-08-03, product-owner approved, resolving T-6 / SPEC-CONFLICT #209):** admission is `events.capacity`, the confirmed venue/event capacity. At a confirmed capacity, new RSVPs are refused with a friendly "event is full" (no waitlist in MVP; that's F-306). **A null `capacity` means no confirmed limit and never refuses** — it is not read as zero, and it does not fall back to another field. Responses carry `capacity: number | null`, not `headcount`.

   Admission was F-101 `headcount` until this amendment. `headcount` is a regulatory input: it drives the 75-plus assembly gate, the DOHMH thresholds, and the Parks exactly-20 conflict. Admitting against it meant an organizer raising their guest limit silently moved their permit findings, which is why `ARCHITECTURE.md` already recorded `capacity` as a separate value and "NOT headcount (audit fix)". F-306 promotes into the same field, which is what SPEC-CONFLICT #209 required be settled before it could be approved.

3. Duplicate contact for the same event updates the existing RSVP, no double-count.
4. Guest list is available to F-401: a check-in matching an RSVP contact links to it (registered vs. walk-in distinction on F-402).
5. Organizer can cancel an RSVP (status → cancelled; frees capacity).
6. Outside the rehearsal/demo window, an unauthenticated POST is stopped by Cloudflare Access before Express and creates no `rsvps` row. The deployment smoke check opens only the public RSVP path for the window, never `/guests`, then closes it and verifies it is blocked again.

## Edge Cases

- Concurrent RSVPs at the capacity boundary: enforce at insert (transactional count check), not in the UI.
- RSVP after event date: refused with "this event has passed."

## Answer-Key Scenarios Exercised

None. Demo: one seeded RSVP plus one live RSVP if time allows (seeded RSVP data is a permitted fallback per DESIGN.md).
