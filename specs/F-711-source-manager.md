# F-711 · Rules Admin: Source Manager

**Status:** PROPOSED (2026-07-26) — ready for review; not implementable until approved and listed in `docs/BASELINE.md`.

**Phase:** 4 · **Issue:** [#64](https://github.com/jzeng151/pop-engine/issues/64) · **Owner:** TBD · **Reviewer:** product owner plus affected architecture, contract, security, and lane owners (TBD) · **Approval date:** —

## Purpose and User Outcome

The verification team can manage source metadata, bounded excerpts, archives, and link health as evidence while keeping verification decisions human-owned.

## Scope

**In scope**

- Create/version source records with URL, agency/title, retrieval metadata, bounded excerpt, archive reference, and link-check history.
- Link sources to draft/published rule facets and surface broken/unavailable changes for review.
- Restrict verification-status changes to the verification owner.

**Non-goals**

- Declaring a source authoritative automatically, copying entire copyrighted pages, editing rules, broad crawling, or silently replacing a source.
- Treating link health as regulatory validity.

## Dependencies and Baseline

- F-703 separate rules-admin role and approved evidence/archival/retention policy.
- F-606 consumes approved source records; F-710 links drafts; F-714 publishes reviewed references.
- Baseline at draft time: PRD, Roadmap, Design, and Phase 0–1.5 Architecture approved 2026-07-22; `ARCHITECTURE-FUTURE.md` approved as a planning target 2026-07-25; NYC ruleset `nyc.v2.7`, rules schema `popengine-rules/v2`, and scenario fixtures v5 where regulatory output is consumed.
- The approval PR must re-pin any baseline version that changes before approval. A proposed or superseded input blocks implementation.

## Inputs, Outputs, State, Validation, and Errors

- Inputs are human-reviewed metadata/excerpt/archive; output is a versioned source record and link-check observations.
- Source state/verification follows the approved regulatory vocabulary; link available/broken/blocked remains separate.
- A metadata correction versions the record or appends history and never rewrites evidence used by a published artifact.
- Missing or unresolved material data stays visibly unset, unknown, pending, or failed as appropriate; it never becomes a successful or complete result.
- Invalid input produces a field or action-specific error without partial mutation. Retriable external failures preserve the user's confirmed state and expose a safe retry.

## UI and Accessibility

- Source detail distinguishes verification, link health, archive availability, excerpt, linked rules, history, and reviewer authority.
- The complete workflow is keyboard operable, uses programmatic labels and visible focus, does not encode status by color alone, and announces asynchronous success or failure.
- Empty, loading, permission-denied, validation, provider-failure, and unavailable states have explicit copy and a safe next action.

## System Impact

| Concern              | Proposed impact                                                                                                                                      |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| API                  | Source/version/link-check/review operations require platform-admin OpenAPI contracts.                                                                |
| Schema               | Forward migrations for source records/versions/archives/link checks and rule links.                                                                  |
| Jobs                 | Durable allow-listed link checks/archive refresh with rate limits, bounded retry, and SSRF controls.                                                 |
| Providers            | Approved archival/fetch provider if used; direct primary source remains the authority.                                                               |
| Privacy and security | Separate rules-admin/verification roles, SSRF-safe fetching, allow-listed protocols/hosts, bounded content, audit, and copyright/retention controls. |

Exact HTTP, JSON Schema, migration, job, and provider shapes belong in their reviewed machine contracts; this proposal does not authorize parallel local types or edits to merged migrations.

## Acceptance Criteria

1. **F711-AC-01:** Every source record preserves URL, agency/title, retrieval metadata, bounded excerpt/archive reference, author/reviewer, and version history.
2. **F711-AC-02:** Only the verification owner can record a review decision for an exact immutable rule-source facet and artifact version, with evidence/reason; source rows have no aggregate regulatory status, and decisions affect runtime only through publication.
3. **F711-AC-03:** Broken, blocked, redirected, or unavailable links create health observations and never automatically invalidate or verify a rule.
4. **F711-AC-04:** Published artifacts continue to reference immutable source versions even after metadata correction.
5. **F711-AC-05:** Fetching cannot access private network targets, unsupported protocols, unbounded content, or execute remote content.

## Fixtures and Verification

- Planned automated fixture IDs are the acceptance IDs above; each must map one-to-one to a runnable test before approval can claim implementation readiness.
- Regulatory fixtures: Synthetic source/link/archive fixtures; real verification decisions require approved primary-source review.
- Security-sensitive and cross-workspace paths require negative authorization tests; provider paths require success, duplicate-delivery, retry, invalid-signature, and permanent-failure tests where applicable.

## Allowed Footprint and Coordination

- `apps/web` and `apps/api` feature code and tests.
- New ordered forward migrations and approved OpenAPI/JSON Schema changes required by this feature.
- No repository restructuring, speculative package, or unrelated feature edit.
- Shared contracts, migrations, provider adapters, engine/rules artifacts, consent policy, and cross-lane UI primitives require the approvals named in `docs/DOCUMENTATION-GOVERNANCE.md` §6.

## Rollout and Fallback

- Start with manual source management; automated link checks stay disabled until fetch-safety review passes.
- Rollback disables the new surface and workers/provider calls without deleting confirmed user data or rewriting immutable plans, rulesets, revisions, or history.

## Approval Blockers

- Approve evidence fields/versioning, verification permissions, excerpt/archive/copyright policy, and SSRF-safe fetch design.
- Assign the owner and independent reviewer, approve this spec, and add it to `docs/BASELINE.md`.
