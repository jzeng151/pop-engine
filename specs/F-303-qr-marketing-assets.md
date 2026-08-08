# F-303 · QR Marketing Assets

**Status:** PROPOSED (2026-07-26; `docs/OPEN-QUESTIONS.md` T-7 / [SPEC-CONFLICT #210](https://github.com/jzeng151/pop-engine/issues/210) RESOLVED 2026-08-04 by the product owner, which restricted this feature to rehearsal use and approved no production route) — the remaining Approval Blockers below still stand; not implementable until approved and listed in `docs/BASELINE.md`.

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
- The F-701/F-702/F-703 gate. F-702 supplies the workspace membership boundary the event whose asset is generated resolves against and F-703 supplies the permission matrix `F303-AC-06` checks; F-701 supplies the authenticated actor both read from. All three are PROPOSED, so the gate is not an approved input today and this spec is not implementable against it until they are approved and listed in `docs/BASELINE.md`.
- A stable public slug/token contract from `ARCHITECTURE-FUTURE.md`.
- Under approved F-301 AC 6, anonymous exposure exists only during rehearsal, and T-7 / SPEC-CONFLICT #210 was resolved on 2026-08-04 (product owner) by restricting this feature to rehearsal use. `docs/PRD.md` §5 and the `docs/ROADMAP.md` F-303 row carry that restriction: no hardened production public-route contract is approved, and this spec may not authorize production exposure of the event page. Lifting the restriction is a product-scope decision that returns to `docs/PRD.md`, not something this spec can settle.
- Baseline at draft time: PRD, Roadmap, Design, and Phase 0–1.5 Architecture approved 2026-07-22; `ARCHITECTURE-FUTURE.md` approved as a planning target 2026-07-25; NYC ruleset `nyc.v2.7`, rules schema `popengine-rules/v2`, and scenario fixtures v5 where regulatory output is consumed.
- The approval PR must re-pin any baseline version that changes before approval. A proposed or superseded input blocks implementation.

## Inputs, Outputs, State, Validation, and Errors

- Input is one published event page; output is one printable page with an SVG or equally lossless QR and human-readable fallback URL. No production-ready asset state exists, and none is in scope: T-7 was resolved on 2026-08-04 to rehearsal-only use.
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

6. **F303-AC-06:** Every organizer-facing operation this feature defines names the event it acts in and the workspace that owns it, and is admitted only by the acting actor's current F-702 membership of that workspace together with the F-703 permission approved for the action, both re-read server-side from stored membership and role at the moment of the operation. That covers generating, regenerating, previewing, printing, and downloading the asset under F303-AC-01 through F303-AC-05, and reading its readiness state under F303-AC-03. A request failing the check is refused before the asset is produced and before the event name, call to action, canonical URL, publication state, or readiness reason is disclosed, and its response does not distinguish an event that does not exist from one the actor may not see. The check is at the operation and not at session start or workspace switch, so authority removed while a request is in flight causes that request to fail. This criterion does not reach the published public page the QR resolves to, which F-301 governs and which is anonymous by design.

   Without this criterion AC-01 through AC-05 all pass for a caller who names another workspace's event. They fix the QR destination, the scan rehearsal, the readiness gate, the print layout, and the absence of mutation, and not one of them asks who the actor is. AC-03 makes readiness follow F-301's effective anonymous-route exposure, so an unpublished or access-gated event still answers the readiness question and still yields its name and canonical URL to whoever can name it, which is a disclosure about an event its organizer has not published.

   One input this criterion needs is not established by any approved artifact today and is not invented here. F-703 is PROPOSED and names no role set, so the permission above cannot be named. Until F-703 is approved this criterion is testable only as "every generation, preview, readiness read, print, and download is refused unless the acting actor holds an active membership of the workspace that owns the named event, read server-side at that operation, and a refusal discloses nothing about whether that event exists", not against a named role or permission identifier. Naming the asset generation and download permissions with F-703 is an approval blocker below.

## Fixtures and Verification

- Automated fixtures map F303-AC-01 and F303-AC-03–05 one-to-one to runnable tests. F303-AC-02 is a documented manual release rehearsal using the approved paper size, phone camera, and distance; automated coverage verifies the encoded URL, rendered dimensions, and decoder compatibility but cannot replace the physical rehearsal.
- Regulatory fixtures: none; this feature does not define regulatory ground truth.
- F303-AC-06 includes a fixture in which an actor holding no membership of the owning workspace names a valid unpublished event and is refused at generation, at the readiness read, and at print and download, with a response that does not distinguish absence from denial.
- Security-sensitive and cross-workspace paths require negative authorization tests; provider paths require success, duplicate-delivery, retry, invalid-signature, and permanent-failure tests where applicable.

## Allowed Footprint and Coordination

- `apps/web` and `apps/api` feature code and tests.
- New ordered forward migrations and approved OpenAPI/JSON Schema changes required by this feature.
- No repository restructuring, speculative package, or unrelated feature edit.
- Shared contracts, migrations, provider adapters, engine/rules artifacts, consent policy, and cross-lane UI primitives require the approvals named in `docs/DOCUMENTATION-GOVERNANCE.md` §6.

## Rollout and Fallback

- Use a native print stylesheet for rehearsal; do not claim or enable production readiness. T-7's 2026-08-04 resolution restricts this feature to rehearsal use, so there is no production route to enable here.
- Rollback disables the new surface and workers/provider calls without deleting confirmed user data or rewriting immutable plans, rulesets, revisions, or history.

## Approval Blockers

- Approve paper size, scan-distance rehearsal, public-slug lifecycle, and final public copy. T-7 / SPEC-CONFLICT #210 is resolved (2026-08-04, product owner): the scope is rehearsal-only, so production exposure is not an option this spec may approve, and proposing it again is a product-scope decision for `docs/PRD.md` rather than an approval blocker to clear here.
- Approve F-701, F-702, and F-703, and name with F-703 the asset generation and download permissions `F303-AC-06` checks. That criterion checks a permission no approved artifact defines today and may not invent one, so until the matrix names them it is testable only at the membership level stated there.
- Assign the owner and independent reviewer, approve this spec, and add it to `docs/BASELINE.md`.
