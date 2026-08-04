# F-303 · QR Marketing Assets

**Status:** PROPOSED (2026-07-26) — approval blocked by `docs/OPEN-QUESTIONS.md` T-7 / [SPEC-CONFLICT #210](https://github.com/jzeng151/pop-engine/issues/210); not implementable until approved and listed in `docs/BASELINE.md`.

**Phase:** 2 · **Issue:** [#20](https://github.com/jzeng151/pop-engine/issues/20) · **Owner:** TBD · **Reviewer:** product owner plus affected architecture, contract, security, and lane owners (TBD) · **Approval date:** —

## Purpose and User Outcome

An organizer can print a clear event flyer or poster whose QR sends attendees to the canonical public event page.

## Scope

**In scope**

- One browser-printable asset using the event name, public-page URL, short call to action, and scannable QR.
- Regenerate the QR when the public slug/token changes and preview before printing.
- Reuse F-401's approved QR encoding behavior.

**Non-goals**

- A graphic-design editor, arbitrary templates, professional print preflight, tracking pixels, or a second QR destination.
- Organizer branding beyond F-309.

## Dependencies and Baseline

- F-301 published public event page and F-401 QR infrastructure.
- A stable public slug/token contract from `ARCHITECTURE-FUTURE.md`.
- Under approved F-301 AC 6, anonymous exposure exists only during rehearsal; production activation requires T-7 / SPEC-CONFLICT #210 to approve a hardened production route or explicitly restrict this feature to rehearsal.
- Baseline at draft time: PRD, Roadmap, Design, and Phase 0–1.5 Architecture approved 2026-07-22; `ARCHITECTURE-FUTURE.md` approved as a planning target 2026-07-25; NYC ruleset `nyc.v2.7`, rules schema `popengine-rules/v2`, and scenario fixtures v5 where regulatory output is consumed.
- The approval PR must re-pin any baseline version that changes before approval. A proposed or superseded input blocks implementation.

## Inputs, Outputs, State, Validation, and Errors

- Input is one published event page; output is one printable page with an SVG or equally lossless QR and human-readable fallback URL. No production-ready asset state exists while T-7 is unresolved.
- Asset state is unavailable while unpublished or blocked by the effective public-route gate, ready only while the slug and anonymous route are active, and stale after slug rotation until regenerated.
- The QR payload is the canonical HTTPS public URL only; user text cannot alter its host or route.
- Missing or unresolved material data stays visibly unset, unknown, pending, or failed as appropriate; it never becomes a successful or complete result.
- Invalid input produces a field or action-specific error without partial mutation. Retriable external failures preserve the user's confirmed state and expose a safe retry.

## UI and Accessibility

- Preview identifies print boundaries, includes text equivalent/fallback URL, and warns when the page is unpublished or the QR is stale.
- The complete workflow is keyboard operable, uses programmatic labels and visible focus, does not encode status by color alone, and announces asynchronous success or failure.
- Empty, loading, permission-denied, validation, provider-failure, and unavailable states have explicit copy and a safe next action.

## System Impact

| Concern              | Proposed impact                                                                                                             |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| API                  | No new public data API is required beyond the approved public-page projection; optional asset retrieval must be in OpenAPI. |
| Schema               | No persistence required for the minimal browser-printable asset; slug rotation remains owned by F-301 contracts.            |
| Jobs                 | None.                                                                                                                       |
| Providers            | None.                                                                                                                       |
| Privacy and security | Only the public projection is rendered; organizer/intake/contact data and private tokens never enter the asset.             |

Exact HTTP, JSON Schema, migration, job, and provider shapes belong in their reviewed machine contracts; this proposal does not authorize parallel local types or edits to merged migrations.

## Acceptance Criteria

1. **F303-AC-01:** The generated QR decodes to the event's canonical HTTPS public-page URL and no other host, route, or organizer-only data.
2. **F303-AC-02:** A standard phone camera scans the printed asset from the approved rehearsal distance and opens the correct published event.
3. **F303-AC-03:** An unpublished, expired, malformed, rotated, or currently access-gated public URL cannot produce or retain a falsely ready asset; readiness follows F-301's effective anonymous-route exposure.
4. **F303-AC-04:** The print view contains event name, concise call to action, QR, and readable fallback URL without clipped content at the approved paper size.
5. **F303-AC-05:** Printing or regenerating the asset does not mutate the event, public page, or QR destination.

## Fixtures and Verification

- Automated fixtures map F303-AC-01 and F303-AC-03–05 one-to-one to runnable tests. F303-AC-02 is a documented manual release rehearsal using the approved paper size, phone camera, and distance; automated coverage verifies the encoded URL, rendered dimensions, and decoder compatibility but cannot replace the physical rehearsal.
- Regulatory fixtures: none; this feature does not define regulatory ground truth.
- Security-sensitive and cross-workspace paths require negative authorization tests; provider paths require success, duplicate-delivery, retry, invalid-signature, and permanent-failure tests where applicable.

## Allowed Footprint and Coordination

- `apps/web` and `apps/api` feature code and tests.
- New ordered forward migrations and approved OpenAPI/JSON Schema changes required by this feature.
- No repository restructuring, speculative package, or unrelated feature edit.
- Shared contracts, migrations, provider adapters, engine/rules artifacts, consent policy, and cross-lane UI primitives require the approvals named in `docs/DOCUMENTATION-GOVERNANCE.md` §6.

## Rollout and Fallback

- Use a native print stylesheet for rehearsal; do not claim or enable production readiness until T-7 is resolved.
- Rollback disables the new surface and workers/provider calls without deleting confirmed user data or rewriting immutable plans, rulesets, revisions, or history.

## Approval Blockers

- Resolve T-7 / SPEC-CONFLICT #210, then approve paper size, scan-distance rehearsal, public-slug lifecycle, production exposure or explicit rehearsal-only scope, and final public copy.
- Assign the owner and independent reviewer, approve this spec, and add it to `docs/BASELINE.md`.
