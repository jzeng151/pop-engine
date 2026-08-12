# F-301 · Public Event Page (STRETCH)

**Status:** APPROVED (2026-07-25; no-plan publication amended 2026-08-11 by the product owner, resolving SPEC-CONFLICT #283) · **Reviewer/approver:** product owner + affected lane owners via the approval PR · **Owner:** see Lane below · see `docs/BASELINE.md`.
**Decision 2026-08-12:** APPROVED by the product owner under issue #258: publication is prohibited while the latest plan is blocked by a resolved prohibition or ineligibility.
**Phase:** 1.5 (third in retention order) · **Lane:** Dev 3 (parallel Track B; core blockers outrank it) · **Depends on:** F-101 (generated from the same event row) · **Feeds:** F-302

## User Story

As an organizer whose event is now compliant, one click turns the same event record into a shareable public page, so the event I made legal becomes the event I promote.

## Inputs / Outputs

- Source: the `events` row (name, date, location_name, headcount, borough) + organizer-entered `description` and `public_page_published` (migration 005; resolves SPEC-CONFLICT #100).
- `GET /e/:eventId` (public, no account during the rehearsal/demo window): title, date, venue, description, map link, RSVP affordance (wired to F-302 when present). Returns friendly 404 when `public_page_published` is false. Cloudflare Access exposes this route anonymously only for the window defined in `DEPLOY.md` §5; publication state is not a substitute for that deployment gate.
- `GET` / `PATCH /api/events/:id/public-page`: organizer promote controls (description, publish toggle, shareable path, whether a plan exists, an infeasible warning, and whether publication is blocked by the latest plan's prohibition/ineligibility). A request to publish without a stored plan or while `publication_blocked` returns 409 and writes nothing.
- Shareable URL shown to the organizer with copy-to-clipboard.

## Acceptance Criteria

1. Page is generated from the event record, not re-entered content; editing the event updates the page.
2. Renders correctly on mobile (attendees open it from chat links).
3. Public page never exposes compliance internals (permit statuses, documents, verdicts): promotion view only.
4. RSVP button appears only when F-302 shipped; otherwise the page is informational (the "static page" degradation from DESIGN.md).
5. Map affordance is a search link built from `location_name` + `borough`; the MVP has no address field and no maps API integration.
6. Outside the rehearsal/demo window, an unauthenticated request is stopped by Cloudflare Access before it reaches the web origin even when `public_page_published` is true; the deployment smoke check in `DEPLOY.md` verifies the gate before opening and after closing the window.
7. Publishing requires at least one stored permit plan. When none exists, the organizer view explains the requirement and disables publishing, while description-only saves remain available; a direct `PATCH` carrying `public_page_published: true` returns 409 and writes none of the supplied fields. Any stored plan qualifies; this criterion does not require the plan to match the event's current revision.
8. Publishing is prohibited when the latest plan's `blockingFinding.disposition` is `prohibited_or_ineligible`. The organizer response exposes `publication_blocked`, the organizer view explains the block and disables publishing, and a direct publish PATCH returns 409 without writing any supplied field. Public GET also returns the friendly 404 if a page was previously marked published and the latest plan now has that blocker. Description-only saves and unpublishing remain available. An INFEASIBLE plan blocked only by a missed published deadline keeps the organizer-choice behavior.

## Edge Cases

- Event with INFEASIBLE current plan from a missed deadline: page still renders (publishing is the organizer's call), but the organizer-side view shows a warning banner.
- Event whose latest plan is blocked by a prohibition/ineligibility: publication is refused and the public URL stays unavailable.
- Event with no plan: description copy can be saved, but publication is refused until a plan exists.
- Visibility: `public_page_published` on `events` (not lifecycle `status`). Organizer toggles publish via `PATCH /api/events/:id/public-page`; unpublished URL returns a friendly 404.

## Answer-Key Scenarios Exercised

None. Demo uses the Scenario A rescoped event if stretch is green.
