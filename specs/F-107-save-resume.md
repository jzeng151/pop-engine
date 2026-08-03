# F-107 · Save and Resume

**Status:** PROPOSED (2026-07-26) — ready for review; not implementable until approved and listed in `docs/BASELINE.md`.

**Phase:** 2 · **Issue:** [#16](https://github.com/jzeng151/pop-engine/issues/16) · **Owner:** TBD · **Reviewer:** product owner plus affected architecture, contract, security, and lane owners (TBD) · **Approval date:** —

## Purpose and User Outcome

An organizer can safely leave an incomplete intake and resume it later without fabricating answers or accidentally evaluating an unfinished event.

## Scope

**In scope**

- Persist partial F-101 answers for the authenticated workspace as immutable incomplete Event Revisions and restore the latest saved revision.
- Show completion and validation state without treating unanswered material fields as false.
- Save complete revisions that are eligible for normal F-201 evaluation without adding a separate submission transition.

**Non-goals**

- Anonymous cross-device recovery, collaborative simultaneous editing, autosuggested answers, or offline editing.
- Generating a permit plan from an incomplete draft.

## Dependencies and Baseline

- F-101 intake and the F-701/F-702/F-703 production gate.
- The approved `docs/EVENT-REVISION-CONTRACT.md` is authoritative; this proposal reconciles SPEC-CONFLICT #213 to that contract.
- Baseline at draft time: PRD, Roadmap, Design, and Phase 0–1.5 Architecture approved 2026-07-22; `ARCHITECTURE-FUTURE.md` approved as a planning target 2026-07-25; NYC ruleset `nyc.v2.7`, rules schema `popengine-rules/v2`, and scenario fixtures v5 where regulatory output is consumed.
- The approval PR must re-pin any baseline version that changes before approval. A proposed or superseded input blocks implementation.

## Inputs, Outputs, State, Validation, and Errors

- Inputs are partial intake values, exact registry/version, validated `base_revision_id`, and stable save-request identity; output is an immutable `incomplete` or `complete` Event Revision with completion metadata.
- Every changed save appends exactly one immutable revision and advances the Event's current-revision pointer; F-107 does not add a separate submission transition. Later edits append another revision and never rewrite one used by a plan.
- Reopening against a newer registry requires an approved migration: compatible answers are mapped with provenance, removed/incompatible answers stay visible for review, and saving remains blocked until the candidate validates under the current registry's partial-save rules.
- Conditional answers made irrelevant by a trigger change are removed or retained only as non-evaluated history according to the approved revision contract, never silently saved as active answers.
- Missing or unresolved material data stays visibly unset, unknown, pending, or failed as appropriate; it never becomes a successful or complete result.
- Invalid input produces a field or action-specific error without partial mutation. Retriable external failures preserve the user's confirmed state and expose a safe retry.

## UI and Accessibility

- The intake shows saved/saving/failed state, last successful revision, incomplete required questions, and whether the latest saved revision is eligible for normal plan generation.
- The complete workflow is keyboard operable, uses programmatic labels and visible focus, does not encode status by color alone, and announces asynchronous success or failure.
- Empty, loading, permission-denied, validation, provider-failure, and unavailable states have explicit copy and a safe next action.

## System Impact

| Concern              | Proposed impact                                                                                                                                  |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| API                  | Event Revision save/read behavior, optimistic concurrency, and idempotency require approved OpenAPI contracts.                                   |
| Schema               | Forward migrations implement the approved immutable Event Revision/current-pointer contract; no separate mutable questionnaire authority exists. |
| Jobs                 | None required; saving is a synchronous durable write.                                                                                            |
| Providers            | None.                                                                                                                                            |
| Privacy and security | Revisions are workspace-scoped and may contain sensitive event details; logs and analytics exclude answer values.                                |

Exact HTTP, JSON Schema, migration, job, and provider shapes belong in their reviewed machine contracts; this proposal does not authorize parallel local types or edits to merged migrations.

## Acceptance Criteria

1. **F107-AC-01:** While its pinned registry/version is current, reopening after a successful save restores the latest revision's partial answers and registry-derived question state byte-for-byte.
2. **F107-AC-02:** A failed save is visibly unsaved and cannot append a revision or advance the Event's current-revision pointer.
3. **F107-AC-03:** An `incomplete` revision cannot create or refresh a permit plan; a `complete` revision is eligible only for normal F-201 generation, and unanswered material values remain unknown or absent.
4. **F107-AC-04:** A changed save atomically validates `base_revision_id` against the current pointer, appends one immutable `incomplete` or `complete` revision, and advances that pointer. Later changed saves append new revisions and make plan output tied to an older revision stale; no save rewrites a revision or uses a separate submission state.
5. **F107-AC-05:** Two stale clients cannot silently overwrite each other; the later conflicting save is rejected with a reload/reconcile path.
6. **F107-AC-06:** When the intake registry changes, reopening uses only the approved migration path, shows removed or incompatible answers for review, and cannot save obsolete inputs or a candidate that fails the current registry's partial-save validation.
7. **F107-AC-07:** A save binds its stable request identity to the original immutable revision and pointer/staleness result. One concurrent save from a shared base wins, stale saves are rejected, and a lost-response retry returns the original result without appending duplicate work.
8. **F107-AC-08 (legacy projection, from the approved contract):** While any Phase 1 reader still uses the `events` projections, a save succeeds only when its revision projects losslessly and satisfies every legacy column constraint. A save omitting a legacy-required value is **rejected without appending a revision or changing any projection**; the server never retains the previous value, substitutes a default, or writes `NULL` to make the save appear compatible. A true no-op changes neither the projections nor `revision_counter`, while every changed save updates both in one transaction. Incomplete saves that cannot meet this rule activate only after the last legacy reader has atomically cut over.

   This bounds F-107's core feature rather than decorating it, so it is stated rather than assumed. `events` is that Phase 1 reader today: no `event_revisions` table exists, and migration 001 puts `NOT NULL` on thirteen columns the save has to fill. Twelve are questionnaire projections the revision supplies — `borough`, `location_type`, `headcount`, `event_date`, `event_open_to_public`, `food_present`, `selling_anything`, `amplified_sound`, `structure_types`, `open_flame_or_cooking`, `generator_present` and `alcohol`. The thirteenth, `name`, is not one of them: `docs/EVENT-REVISION-CONTRACT.md` §2.2 makes `answers_json` authoritative for questionnaire answers only and defines the organizer-facing name as stable Event metadata whose update appends no revision, and the intake registry has no `name` field for a revision to answer. `events.name` is therefore satisfied from that metadata authority, under the Event concurrency token §2.2 requires, and a revision is never asked for it; requiring one would either reject a valid partial revision for an already-named Event or duplicate stable metadata into `answers_json`, both of which that contract forbids. Incompleteness and legacy compatibility are two separate tests, and an incomplete revision can pass both: a street event that has answered all twelve of those questionnaire columns but not yet `street_event_size` is incomplete under the current registry, which asks that question when `sapo_event_type = street_event`, while migration 001 leaves that column nullable, so the revision projects losslessly and saves. What AC-08 rejects is the narrower case where an unanswered question is one of the `NOT NULL` columns. Until cutover, therefore, the saveable subset is narrower than "any incomplete intake," and a build that widens it by writing defaults or nulls violates `docs/EVENT-REVISION-CONTRACT.md` rather than extending this spec. The criterion asserts no new rule; it restates that contract (recorded as the ratification of SPEC-CONFLICT #213, 2026-08-02).

## Fixtures and Verification

- Planned automated fixture IDs are the acceptance IDs above; each must map one-to-one to a runnable test before approval can claim implementation readiness.
- Regulatory fixtures: F-101 approved input scenarios A–F are reused to verify partial-to-complete saves; expected regulatory outputs remain owned by F-201/F-102.
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

- Approve the OpenAPI/JSON Schema and compatibility package that implement the already approved Event Revision, stale-write, and registry-upgrade behavior.
- Resolve any required shared events-schema change through the all-lane gate.
- Assign the owner and independent reviewer, approve this spec, and add it to `docs/BASELINE.md`.
