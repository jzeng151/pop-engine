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

- F-101, the F-107 immutable revision lifecycle defined by `docs/EVENT-REVISION-CONTRACT.md`, and the F-701/F-702/F-703 gate.
- Approved mapping from shortlist fields to current intake registry fields.
- Baseline at draft time: PRD, Roadmap, Design, and Phase 0–1.5 Architecture approved 2026-07-22; `ARCHITECTURE-FUTURE.md` approved as a planning target 2026-07-25; NYC ruleset `nyc.v2.7`, rules schema `popengine-rules/v2`, and scenario fixtures v5 where regulatory output is consumed.
- Operand binding for client-supplied identities: `specs/F-411-staff-roles-credentialed-entry.md` F411-AC-08 states once, for this whole branch, that a client-supplied identity is committed with the operands that determine its recorded result and that a reuse carrying different operands is a conflict rather than a replay. Every identity criterion below relies on it. F-411 is PROPOSED, so that rule is not an approved input today and this spec is not implementable against it until F-411 is approved or the rule is promoted to an approved shared invariant; F411-AC-08 records both paths.
- The approval PR must re-pin any baseline version that changes before approval. A proposed or superseded input blocks implementation.

## Inputs, Outputs, State, Validation, and Errors

- Inputs are organizer-entered candidate facts; outputs are workspace-owned candidates and an explicit prefill proposal.
- Candidate state is active → archived; applying a candidate appends one immutable event revision through the normal F-107 save path and never mutates the candidate. An appended `incomplete` revision generates no plan.
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
2. **F105-AC-02:** Preview pins the exact candidate version and the target Event's current revision; apply compare-and-swaps both (the candidate version and `base_revision_id`) and changes only the reviewed F-101 mapping, rejecting and rebuilding the preview if either changed or the candidate was archived.
3. **F105-AC-03:** Missing, unknown, or incompatible facts remain unanswered and cannot be inferred from notes or tags.
4. **F105-AC-04:** Applying a prefill is an ordinary F-107 revision save: it appends exactly one immutable revision from the validated `base_revision_id`, advances the current-revision pointer, makes plans bound to an older revision stale, and triggers normal evaluation only when the appended revision is `complete`. No separate mutable draft holds the answers and no submission transition exists.
5. **F105-AC-05:** No surface claims availability, price, suitability, regulatory approval, or marketplace status.
6. **F105-AC-06:** Every update and archive of a venue candidate names the exact candidate version it was made against and commits only while that version is still current; a stale version rejects the whole write as a conflict, mutates nothing, and returns the current version for the editor to reload and reconcile, never a last-write-wins overwrite. Creating a candidate, and each of these writes, also binds the request to a stable client-supplied request identity, committed with the result it produces under a uniqueness constraint scoped to the creating user's candidate set for a creation and to the candidate itself for an update or archive. A request presenting an already committed identity is resolved from that record before the version comparison above and returns the outcome that request originally recorded, creating no second candidate and applying no second edit. The ordering is stated because the two rules otherwise contradict each other on one request: when an update or archive commits and its response is lost, the retry still names the candidate version the editor read, which that commit advanced, so a comparison made first rejects it as stale for work that in fact succeeded. This is request identity, never content uniqueness: two genuinely distinct candidates that read the same are both created, and a repeated identity is never rejected as a duplicate value. That identity binds its operands under the rule `F411-AC-08` states once for every client-supplied identity on this branch: it is committed together with the request fields that determine the recorded result, including every aggregate, version, and generation the request names, and a later request presenting the same identity with any different operand is refused as a conflict rather than being answered with the stored result. The identity is still the key and the operands are only a precondition on reusing it, so this is not the content uniqueness this criterion already forbids.

   Each identity is scoped to the aggregate the operation writes, which is the candidate, never to an Event. A shortlist candidate is a workspace-owned record owned by its creating user under F105-AC-01, and the Scope's first In-scope line lets an organizer create, edit, archive, and compare candidates before any target Event is chosen; an Event enters this feature only at F105-AC-02, where a candidate is applied to one. So creation binds its identity under a uniqueness constraint scoped to the workspace and the owning user, the two things that exist at the moment a candidate is created, and every later update and archive binds its identity under a constraint scoped to the candidate itself. Scoping any of them to an Event was corrected on 2026-08-04: a personal candidate created before an Event is selected has no Event for the constraint to name, so an implementation would have had to invent an Event association outside the declared model or would have been unable to recognize the retry at all. Applying a candidate is the one operation in this feature that does have an Event, and F105-AC-02 governs it. Making candidates event-specific would be a Scope change returning to the PRD and Roadmap decision process, not a reading of this criterion.

   AC-02 compare-and-swaps the candidate version at preview and apply, which is the only place AC-01 gave the version any weight. What follows is the reason for the rule above, not an outcome this criterion allows. Without it the edit path accepts writes with no observed version, so two tabs editing one candidate from a single observed state would both report success and the later write would erase the earlier confirmed correction. Nothing would record that the correction existed, so the next preview would be built from a candidate that silently lost it while AC-02 saw a version that is perfectly current.

## Fixtures and Verification

- Planned automated fixture IDs are the acceptance IDs above; each must map one-to-one to a runnable test before approval can claim implementation readiness.
- Regulatory fixtures: Reuse F-101 location inputs to verify mapping only; venue records create no regulatory expectation.
- F105-AC-06 includes a fixture in which a candidate update commits, its response is lost, and the retry presenting the same request identity and the pre-update candidate version returns the original recorded outcome rather than a stale-version conflict.
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
