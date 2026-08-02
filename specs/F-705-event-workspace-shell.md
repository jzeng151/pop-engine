# F-705 · Event Workspace Shell

**Status:** APPROVED (2026-08-02, product-owner approved, one person currently holding every lane) · **Reviewer/approver:** product owner · **Owner:** see Lane below · see `docs/BASELINE.md`.
**Phase:** 1.5 (stretch track) · **Lane:** Dev 3 · **Depends on:** the routes it links to (F-101, F-102/F-201, F-202, F-301, F-302, F-401, F-402) and `docs/DESIGN-SYSTEM.md` for tokens and chrome
**Written:** 2026-08-02, after the fact. The shell shipped in the 2026-07-29 Riso Field Guide work under the design-system amendment, whose scope clause covers presentation and existing-route chrome and excludes new cross-feature navigation. Navigation across lifecycle stages is product scope, so it gets an ID and a spec rather than a wider design-system gate. Nothing here asks for new behavior; it states what exists so the criteria can be checked and so later changes have something to change.

## User Story

As an independent organizer with one event in progress, every stage of that event's work is reachable from one place that tells me which event I am looking at, so I do not navigate by URL or lose track of which record I am editing.

## In Scope

The `/events/[id]` route group's layout and its overview page:

- the persistent shell (brand, masthead, skip link, navigation) wrapping every `/events/[id]/*` route;
- navigation grouped by the four `docs/DESIGN.md` lifecycle stages — Ideate (Overview, Event intake), Comply (Permit plan, Checklist), Market (Event page, Guests), Operate (Check-in, Live ops);
- a **Planned** group of disabled, non-navigating buttons naming modules that do not exist;
- the overview page at `/events/[id]`, listing the Comply, Market, and Operate destinations with one line each, plus a link to the event's intake;
- the light/dark theme toggle in the masthead.

## Non-Goals

- No endpoint, table, column, migration, or engine change. The shell reads one existing endpoint and writes nothing.
- No feature behavior. Every destination keeps the acceptance criteria of its own spec; this spec never overrides one.
- No regulatory copy. The shell states no requirement, deadline, fee, agency, or verification status, and renders no finding.
- No authenticated or per-user state. Theme is per-browser only. The F-701–F-703 production gate is untouched.
- The Planned group commits to no feature, date, or scope, and assigns no work to any F-id.

## Inputs

`eventId` from the route params; `API_BASE_URL`; the event record via `loadEvent`, read for its `name` alone.

## Outputs

Chrome and links. Nothing is persisted server-side. The selected theme is written to `localStorage` under `popengine-theme`.

## States

| State         | When                                              | Renders                                                                                    |
| ------------- | ------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `loading`     | before the event responds                         | the placeholder name "Event workspace"; navigation is already usable                       |
| `ready`       | the event responds with a non-empty trimmed name  | that name                                                                                  |
| `unavailable` | the request fails, or the name is absent or blank | the same placeholder, and no claim that the event exists, is missing, or is named anything |

The state is exposed as `data-load-state` so the distinction is testable rather than inferred from the text.

## Acceptance Criteria

1. Every `/events/[id]/*` route renders inside the shell, and the shell renders the same eight destinations in the same four groups regardless of which one is active.
2. The active destination carries `aria-current="page"`. Overview matches its path exactly; every other destination matches by prefix, so a nested route keeps its parent highlighted.
3. The masthead names the active event once loaded, announces the change politely (`aria-live="polite"`), and falls back to the placeholder in both non-ready states without inventing a name.
4. The masthead states "Synthetic data demo" on every route, satisfying the capstone labeling rule in `AGENTS.md` for an environment carrying no real applications or attendee data.
5. Planned modules render as `disabled` buttons carrying a visible "Planned" stamp. They are not links, do not navigate, and name no F-id, date, or commitment.
6. The theme toggle switches light and dark, reports state through `aria-pressed`, persists to `localStorage`, and follows a change made in another tab. When storage is unavailable it still applies the theme for the current page and does not fail.
7. Keyboard and screen-reader access: a skip link reaches the content region, the navigation carries `aria-label="Event lifecycle"`, and the mobile disclosure is a native `<details>` element rather than scripted show/hide.
8. The overview page links only to routes that exist and are reachable, and describes each in one sentence that promises no output the destination does not produce.

## Edge Cases

- An `eventId` that no event matches: the shell still renders and stays navigable. Each destination reports its own not-found state; the shell does not pre-empt them.
- A blank or whitespace-only event name is treated as absent, not rendered as an empty heading.
- Slow event loads never block navigation, because the nav does not depend on the response.
- A destination that a later decision removes must leave this spec's list, not linger as a dead link.

## Impact

API: none. Schema: none. Jobs: none. Providers: none. Privacy: the event name is already visible on every destination; the shell introduces no new data on screen. Security: no authorization decision is made or implied here, and the demo access gate (AD-12) remains the only gate.

## Allowed File Footprint

`apps/web/app/events/[id]/layout.tsx`, `apps/web/app/events/[id]/event-workspace.tsx`, `apps/web/app/events/[id]/page.tsx`, `apps/web/app/theme-toggle.tsx`, and their tests. Shared and requiring coordination: `apps/web/app/globals.css` (design-system tokens and chrome, `docs/DESIGN-SYSTEM.md`).

## Rollout and Fallback

Already deployed. There is no flag: the shell either renders or the route group fails to render, which the existing route tests catch. Removing it means deleting the layout and the overview route, and re-homing any affordance another spec depends on — as of this writing, F-101 Acceptance Criterion 8's plan-stale notice and one-click regeneration, which land on the overview.
