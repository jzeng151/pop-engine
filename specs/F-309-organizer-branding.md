# F-309 · Organizer Branding

**Status:** PROPOSED (2026-07-26) — ready for review; not implementable until approved and listed in `docs/BASELINE.md`.

**Phase:** 3 · **Issue:** [#38](https://github.com/jzeng151/pop-engine/issues/38) · **Owner:** TBD · **Reviewer:** product owner plus affected architecture, contract, security, and lane owners (TBD) · **Approval date:** —

## Purpose and User Outcome

An organizer can apply limited, accessible branding to the public event page without injecting code or obscuring PopEngine's required status and consent UI.

## Scope

**In scope**

- One optional logo and one accent color applied to approved public-page elements.
- Preview, validate, publish, reset, and preserve readable fallback styling.
- Keep PopEngine attribution, required consent copy, errors, and regulatory/status messaging unchanged.

**Non-goals**

- Themes, custom fonts, arbitrary CSS/HTML/JavaScript, layout editing, white-labeling, or per-block styling.
- Branding check-in or authenticated admin surfaces.

## Dependencies and Baseline

- F-301 public page, F-209/F-211 upload safety where reused, and the F-701/F-702/F-703 gate.
- Approved logo dimensions/file types and contrast rules.
- Baseline at draft time: PRD, Roadmap, Design, and Phase 0–1.5 Architecture approved 2026-07-22; `ARCHITECTURE-FUTURE.md` approved as a planning target 2026-07-25; NYC ruleset `nyc.v2.7`, rules schema `popengine-rules/v2`, and scenario fixtures v5 where regulatory output is consumed.
- The approval PR must re-pin any baseline version that changes before approval. A proposed or superseded input blocks implementation.

## Inputs, Outputs, State, Validation, and Errors

- Inputs are a safe logo file and accent color; output is a validated brand setting on one public page.
- State is draft → published or reset; invalid/unsafe assets never become public.
- The server computes accessible foreground/fallback treatment rather than accepting arbitrary style input.
- Missing or unresolved material data stays visibly unset, unknown, pending, or failed as appropriate; it never becomes a successful or complete result.
- Invalid input produces a field or action-specific error without partial mutation. Retriable external failures preserve the user's confirmed state and expose a safe retry.

## UI and Accessibility

- Preview covers normal, focus, error, disabled, and high-contrast states; required content remains in reading order.
- The complete workflow is keyboard operable, uses programmatic labels and visible focus, does not encode status by color alone, and announces asynchronous success or failure.
- Empty, loading, permission-denied, validation, provider-failure, and unavailable states have explicit copy and a safe next action.

## System Impact

| Concern              | Proposed impact                                                                                                                                              |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| API                  | Brand settings and controlled logo upload require approved OpenAPI contracts.                                                                                |
| Schema               | Forward migration for minimal brand settings and a private approved logo-asset reference.                                                                    |
| Jobs                 | File scanning/normalization only if required by the upload ADR.                                                                                              |
| Providers            | Private storage/scanning adapter.                                                                                                                            |
| Privacy and security | Validate file signatures, strip active metadata/content, prohibit SVG script risk unless sanitized policy explicitly approves it, and prevent CSS injection. |

Exact HTTP, JSON Schema, migration, job, and provider shapes belong in their reviewed machine contracts; this proposal does not authorize parallel local types or edits to merged migrations.

## Acceptance Criteria

1. **F309-AC-01:** Only one approved logo asset and one valid accent color can affect the public event page.
2. **F309-AC-02:** Published branding meets approved contrast/focus requirements or falls back to the default design.
3. **F309-AC-03:** Organizer input cannot inject HTML, script, CSS, external font, tracking pixel, or arbitrary URL.
4. **F309-AC-04:** Consent copy, status labels, errors, PopEngine attribution, and page structure remain unchanged.
5. **F309-AC-05:** Publish, replacement, and reset each name the exact current published-brand version they were reviewed against, together with the reviewed draft/asset version and a stable request identity, and compare-and-swap that brand version inside the transaction that changes it. A concurrent publish and reset therefore produce one success and one rejection, so a draft reviewed before the reset cannot restore the logo and accent after the organizer was told reset succeeded; the rejected actor reloads and re-reviews. Reset removes branding and restores the default page without changing event/RSVP data.
6. **F309-AC-06:** The logo remains in private storage; public rendering issues only a short-lived signed URL for the currently published asset. Reset or replacement stops issuing URLs for the prior asset, and any already issued URL has only its disclosed bounded validity until expiry.

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

- Default styling remains the fallback for missing, invalid, unsafe, or removed branding.
- Rollback disables the new surface and workers/provider calls without deleting confirmed user data or rewriting immutable plans, rulesets, revisions, or history.

## Approval Blockers

- Approve asset policy, accent application points, contrast thresholds, and attribution requirements.
- Assign the owner and independent reviewer, approve this spec, and add it to `docs/BASELINE.md`.
