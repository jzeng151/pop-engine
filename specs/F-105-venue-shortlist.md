# F-105 · Venue Shortlist

**Status:** PROPOSED (2026-07-26) — ready for review; not implementable until approved and listed in `docs/BASELINE.md`.

**Phase:** 3 · **Issue:** [#30](https://github.com/jzeng151/pop-engine/issues/30) · **Owner:** TBD · **Reviewer:** product owner plus affected architecture, contract, security, and lane owners (TBD) · **Approval date:** —

## Purpose and User Outcome

An organizer can keep a private list of candidate venues and deliberately copy selected venue facts into F-101 without PopEngine acting as a marketplace.

## Scope

**In scope**

- Create, edit, archive, and compare organizer-entered candidate venue name, location facts, notes, and approved tags.
- Prefill compatible F-101 location fields only after the organizer selects a candidate and reviews the values.
- Retain the venue source link on the resulting revision for traceability.

**Non-goals**

- Venue discovery, booking, availability, pricing verification, reviews, maps search, or venue recommendations.
- Treating venue notes/tags as regulatory facts.

## Dependencies and Baseline

- F-101, F-107 mutable draft lifecycle, and the F-701/F-702/F-703 gate.
- Approved mapping from shortlist fields to current intake registry fields.
- Baseline at draft time: PRD, Roadmap, Design, and Phase 0–1.5 Architecture approved 2026-07-22; `ARCHITECTURE-FUTURE.md` approved as a planning target 2026-07-25; NYC ruleset `nyc.v2.7`, rules schema `popengine-rules/v2`, and scenario fixtures v5 where regulatory output is consumed.
- The approval PR must re-pin any baseline version that changes before approval. A proposed or superseded input blocks implementation.

## Inputs, Outputs, State, Validation, and Errors

- Inputs are organizer-entered candidate facts; outputs are workspace-owned candidates and an explicit prefill proposal.
- Candidate state is active → archived; applying a candidate creates or edits the mutable event draft but never mutates the candidate or auto-submits intake.
- Missing or incompatible candidate fields remain unanswered in F-101; free-text notes never enter engine inputs.
- Missing or unresolved material data stays visibly unset, unknown, pending, or failed as appropriate; it never becomes a successful or complete result.
- Invalid input produces a field or action-specific error without partial mutation. Retriable external failures preserve the user's confirmed state and expose a safe retry.

## UI and Accessibility

- The prefill review shows every field that will change, every required field still missing, and a cancel path with no mutation.
- The complete workflow is keyboard operable, uses programmatic labels and visible focus, does not encode status by color alone, and announces asynchronous success or failure.
- Empty, loading, permission-denied, validation, provider-failure, and unavailable states have explicit copy and a safe next action.

## System Impact

| Concern              | Proposed impact                                                                                       |
| -------------------- | ----------------------------------------------------------------------------------------------------- |
| API                  | Venue candidate CRUD and prefill-preview/apply behavior require approved OpenAPI contracts.           |
| Schema               | Forward migration for minimal workspace-owned venue candidates; do not duplicate the intake registry. |
| Jobs                 | None.                                                                                                 |
| Providers            | None.                                                                                                 |
| Privacy and security | Workspace isolation; notes and private locations do not enter public pages, logs, or analytics.       |

Exact HTTP, JSON Schema, migration, job, and provider shapes belong in their reviewed machine contracts; this proposal does not authorize parallel local types or edits to merged migrations.

## Acceptance Criteria

1. **F105-AC-01:** A venue candidate is owned by its creating user within the workspace authorization boundary; only that user can create, update, archive, or list their personal candidates, and other workspace members cannot read or alter them.
2. **F105-AC-02:** Preview pins the exact candidate and target-draft versions; apply compare-and-swaps both versions and changes only the reviewed F-101 mapping, rejecting and rebuilding the preview if either changed or the candidate was archived.
3. **F105-AC-03:** Missing, unknown, or incompatible facts remain unanswered and cannot be inferred from notes or tags.
4. **F105-AC-04:** Prefill updates the mutable event draft; normal intake submission creates the immutable revision, marks prior plans stale, and triggers normal evaluation.
5. **F105-AC-05:** No surface claims availability, price, suitability, regulatory approval, or marketplace status.

## Fixtures and Verification

- Planned automated fixture IDs are the acceptance IDs above; each must map one-to-one to a runnable test before approval can claim implementation readiness.
- Regulatory fixtures: Reuse F-101 location inputs to verify mapping only; venue records create no regulatory expectation.
- Security-sensitive and cross-workspace paths require negative authorization tests; provider paths require success, duplicate-delivery, retry, invalid-signature, and permanent-failure tests where applicable.

## Allowed Footprint and Coordination

- `apps/web` and `apps/api` feature code and tests.
- New ordered forward migrations and approved OpenAPI/JSON Schema changes required by this feature.
- No repository restructuring, speculative package, or unrelated feature edit.
- Shared contracts, migrations, provider adapters, engine/rules artifacts, consent policy, and cross-lane UI primitives require the approvals named in `docs/DOCUMENTATION-GOVERNANCE.md` §6.

## Rollout and Fallback

- Manual candidate entry only; geocoding may enrich it later through approved F-108 behavior.
- Rollback disables the new surface and workers/provider calls without deleting confirmed user data or rewriting immutable plans, rulesets, revisions, or history.

## Approval Blockers

- Approve the minimal candidate fields/tags and exact F-101 mapping.
- Assign the owner and independent reviewer, approve this spec, and add it to `docs/BASELINE.md`.
