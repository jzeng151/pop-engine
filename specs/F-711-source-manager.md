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
- Operand binding for client-supplied identities: `specs/F-411-staff-roles-credentialed-entry.md` F411-AC-08 states once, for this whole branch, that a client-supplied identity is committed with the operands that determine its recorded result and that a reuse carrying different operands is a conflict rather than a replay. Every identity criterion below relies on it. F-411 is PROPOSED, so that rule is not an approved input today and this spec is not implementable against it until F-411 is approved or the rule is promoted to an approved shared invariant; F411-AC-08 records both paths.
- The approval PR must re-pin any baseline version that changes before approval. A proposed or superseded input blocks implementation.

## Inputs, Outputs, State, Validation, and Errors

- Inputs are human-reviewed metadata/excerpt/archive; output is a versioned source record and link-check observations.
- Source records carry only metadata, archival, and link-health lifecycle state. Regulatory verification exists exclusively on immutable rule-source facet decisions for exact artifact versions.
- A metadata correction versions the record or appends history and never rewrites evidence used by a published artifact.
- Missing or unresolved material data stays visibly unset, unknown, pending, or failed as appropriate; it never becomes a successful or complete result.
- Invalid input produces a field or action-specific error without partial mutation. Retriable external failures preserve the user's confirmed state and expose a safe retry.

## UI and Accessibility

- Source detail distinguishes facet-level verification decisions, link health, archive availability, excerpt, linked rules, history, and reviewer authority.
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
2. **F711-AC-02:** Only the verification owner can record a review decision for an exact immutable rule-source facet and artifact version, with evidence/reason; source rows have no aggregate regulatory status, and decisions affect runtime only through publication. Decisions stay immutable, but each rule-source facet and artifact version carries exactly one current decision, identified by a current-decision generation that the recording transaction compares and swaps. Recording names the generation the author was shown; a mismatch rejects the whole write and returns the current decision, so two tabs produce one recorded decision and one rejection the author re-reviews rather than two decisions with no defined order. Superseding a decision marks the prior one superseded in that same transaction, and it stays readable as history. Readiness and publication accept only the exact current unsuperseded decision for the facet and version they read: `F710-AC-04` names the generation it evaluated and rejects on a mismatch, which is what stops it from pinning an older favorable decision after a newer one records `OFFICIAL_CONFLICT` or `RESEARCH_REQUIRED` and lets F-714 publish against stale verification evidence.
3. **F711-AC-03:** Broken, blocked, redirected, or unavailable links create health observations and never automatically invalidate or verify a rule.
4. **F711-AC-04:** Published artifacts continue to reference immutable source versions even after metadata correction.
5. **F711-AC-05:** Fetching cannot access private network targets, unsupported protocols, unbounded content, or execute remote content.
6. **F711-AC-06:** Creating a source record, and appending a version to one, each bind the request to a stable client-supplied request identity, committed with the row under a uniqueness constraint scoped to the source for a version and, for a new source, to the platform source catalog the record is created in (its jurisdiction partition where the catalog is partitioned by one), together with the recording rules-admin actor. No part of that scope is a tenant workspace: F-711 defines platform rules-admin operations, F-703's deny-by-default state rule says platform rules-admin checks never derive from a workspace role while `F703-AC-04` keeps the rules-admin role separate from and ungrantable by a workspace owner, so a workspace-scoped identity would fail to recognise the original creation for an administrator with no active workspace or one retrying after switching workspaces, and a second global source record would be created. A retry presenting the same identity returns the original source or version and writes no second row; a deliberately separate source or a genuine new version uses a new identity. This is request identity, never content uniqueness: the same URL can legitimately be registered as two sources and re-retrieved into two versions with identical bytes, so neither URL nor content may serve as the key, and a repeated identity is never rejected as a duplicate value. That identity binds its operands under the rule `F411-AC-08` states once for every client-supplied identity on this branch: it is committed together with the request fields that determine the recorded result, including every aggregate, version, and generation the request names, and a later request presenting the same identity with any different operand is refused as a conflict rather than being answered with the stored result. The identity is still the key and the operands are only a precondition on reusing it, so this is not the content uniqueness this criterion already forbids.

   AC-01 requires version history and says nothing about how a version comes to exist. When a create commits and its response is lost, the retry produces either two source identities for one document or two indistinguishable versions of one source. Rule links and the AC-02 review decisions then split across them: a decision recorded against one version leaves the other unreviewed, and F-710 readiness and F-714 publication read whichever version their pin happens to name.

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
