# F-107 · Save and Resume

**Status:** PROPOSED (2026-07-26) — ready for review; not implementable until approved and listed in `docs/BASELINE.md`.

**Phase:** 2 · **Issue:** [#16](https://github.com/jzeng151/pop-engine/issues/16) · **Owner:** TBD · **Reviewer:** product owner plus affected architecture, contract, security, and lane owners (TBD) · **Approval date:** —

## Purpose and User Outcome

An organizer can safely leave an incomplete intake and resume it later without fabricating answers or accidentally evaluating an unfinished event.

## Scope

**In scope**

- Persist partial F-101 answers for the authenticated workspace and restore the latest confirmed draft.
- Show completion and validation state without treating unanswered material fields as false.
- Explicitly submit a complete draft to create the immutable revision used for evaluation.

**Non-goals**

- Anonymous cross-device recovery, collaborative simultaneous editing, autosuggested answers, or offline editing.
- Generating a permit plan from an incomplete draft.

## Dependencies and Baseline

- F-101 intake and the F-701/F-702/F-703 production gate.
- Approved Event Revision contract from `ARCHITECTURE-FUTURE.md` AD-05.
- Baseline at draft time: PRD, Roadmap, Design, and Phase 0–1.5 Architecture approved 2026-07-22; `ARCHITECTURE-FUTURE.md` approved as a planning target 2026-07-25; NYC ruleset `nyc.v2.7`, rules schema `popengine-rules/v2`, and scenario fixtures v5 where regulatory output is consumed.
- The approval PR must re-pin any baseline version that changes before approval. A proposed or superseded input blocks implementation.

## Inputs, Outputs, State, Validation, and Errors

- Inputs are partial intake values pinned to an exact registry/version; output is a workspace-owned mutable draft with completion metadata and that registry/version.
- Draft state is incomplete ↔ complete-unsubmitted; submission creates an immutable revision. Later edits occur in a new mutable draft and never rewrite a revision used by a plan.
- Reopening against a newer registry requires an approved migration: compatible answers are mapped with provenance, removed/incompatible answers stay visible for review, and submission remains blocked until the draft validates against the current registry.
- Conditional answers made irrelevant by a trigger change are removed or retained only as non-evaluated history according to the approved revision contract, never silently submitted.
- Missing or unresolved material data stays visibly unset, unknown, pending, or failed as appropriate; it never becomes a successful or complete result.
- Invalid input produces a field or action-specific error without partial mutation. Retriable external failures preserve the user's confirmed state and expose a safe retry.

## UI and Accessibility

- The intake shows saved/saving/failed state, last successful save, incomplete required questions, and an explicit final submission action.
- The complete workflow is keyboard operable, uses programmatic labels and visible focus, does not encode status by color alone, and announces asynchronous success or failure.
- Empty, loading, permission-denied, validation, provider-failure, and unavailable states have explicit copy and a safe next action.

## System Impact

| Concern              | Proposed impact                                                                                                                |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| API                  | Mutable draft create/read/update behavior and submission into an immutable revision require approved OpenAPI contracts.        |
| Schema               | Forward migration keeps mutable draft storage separate from immutable event revisions; stable Event identity remains separate. |
| Jobs                 | None required; saving is a synchronous durable write.                                                                          |
| Providers            | None.                                                                                                                          |
| Privacy and security | Drafts are workspace-scoped and may contain sensitive event details; logs and analytics exclude answer values.                 |

Exact HTTP, JSON Schema, migration, job, and provider shapes belong in their reviewed machine contracts; this proposal does not authorize parallel local types or edits to merged migrations.

## Acceptance Criteria

1. **F107-AC-01:** While its pinned registry/version is current, reopening after a successful save restores the same partial answers and registry-derived question state byte-for-byte.
2. **F107-AC-02:** A failed save is visibly unsaved and cannot replace the last durable draft.
3. **F107-AC-03:** No unsubmitted draft—whether incomplete or complete-unsubmitted—can create or refresh a permit plan; only explicit submission creates the immutable evaluable revision, and unanswered material values remain unknown or absent.
4. **F107-AC-04:** Submitting a complete draft creates an immutable revision; later edits remain in a new mutable draft, and only its next explicit submission creates another revision and marks prior plan output stale.
5. **F107-AC-05:** Two stale clients cannot silently overwrite each other; the later conflicting save is rejected with a reload/reconcile path.
6. **F107-AC-06:** When the intake registry changes, reopening uses only the approved migration path, shows removed or incompatible answers for review, and cannot submit obsolete inputs or a draft that fails the current registry.

## Fixtures and Verification

- Planned automated fixture IDs are the acceptance IDs above; each must map one-to-one to a runnable test before approval can claim implementation readiness.
- Regulatory fixtures: F-101 approved input scenarios A–F are reused to verify partial-to-complete submission; expected regulatory outputs remain owned by F-201/F-102.
- Security-sensitive and cross-workspace paths require negative authorization tests; provider paths require success, duplicate-delivery, retry, invalid-signature, and permanent-failure tests where applicable.

## Allowed Footprint and Coordination

- `apps/web` and `apps/api` feature code and tests.
- New ordered forward migrations and approved OpenAPI/JSON Schema changes required by this feature.
- No repository restructuring, speculative package, or unrelated feature edit.
- Shared contracts, migrations, provider adapters, engine/rules artifacts, consent policy, and cross-lane UI primitives require the approvals named in `docs/DOCUMENTATION-GOVERNANCE.md` §6.

## Rollout and Fallback

- Enable only after tenancy and revision contracts are deployed; existing capstone rows remain readable under an explicit migration decision.
- Rollback disables the new surface and workers/provider calls without deleting confirmed user data or rewriting immutable plans, rulesets, revisions, or history.

## Approval Blockers

- Approve Event Revision schema/API, stale-write strategy, and registry-upgrade migration/review behavior.
- Resolve any required shared events-schema change through the all-lane gate.
- Assign the owner and independent reviewer, approve this spec, and add it to `docs/BASELINE.md`.
