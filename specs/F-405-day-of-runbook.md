# F-405 · Day-of Runbook

**Status:** PROPOSED (2026-07-26) — ready for review; not implementable until approved and listed in `docs/BASELINE.md`.

**Phase:** 2 · **Issue:** [#25](https://github.com/jzeng151/pop-engine/issues/25) · **Owner:** TBD · **Reviewer:** product owner plus affected architecture, contract, security, and lane owners (TBD) · **Approval date:** —

## Purpose and User Outcome

An organizer can generate one current event-day sheet containing confirmed permit references, load-in tasks, contacts, and staff assignments without presenting missing data as complete.

## Scope

**In scope**

- Own minimal organizer-entered load-in task, operational-contact, and runbook-only staff-assignment records and assemble them with current confirmed checklist/application data into a versioned runbook.
- Preview, refresh, and print the runbook with source timestamps and incomplete/conflict warnings.
- Keep regulatory wording and statuses sourced from the approved plan/findings.

**Non-goals**

- Replacing source records, dispatching staff, emergency response, workspace-member task assignment/status tracking, a general task manager, or inventing missing permit/contact facts. General team tasks remain F-213.
- Marking an event operationally ready solely because a runbook was generated.

## Dependencies and Baseline

- **Depends on:** F-202 checklist, F-208/F-209 records where present, F-405's runbook-only staff assignments, the F-701/F-702/F-703 gate, F-107 Event Revisions, and the approved plan-acceptance contract. The last two are prerequisites because AC-01 reads `events.current_revision_id` and `events.current_plan_id`, which `docs/EVENT-REVISION-CONTRACT.md` §3 assigns to F-107 and to the plan-acceptance contract respectively. Before they ship there is no approved source for which revision is current or which plan is accepted, and this spec does not invent one: §2.5 forbids treating the newest candidate as accepted, and `permit_plans.event_revision` is a historical migration input rather than an authority for new reads, so an implementer may substitute neither. It also depends on `specs/F-411-staff-roles-credentialed-entry.md` for one thing only: F411-AC-08 states once, for this whole branch, that a client-supplied identity is committed with the operands that determine its recorded result and that a reuse carrying different operands is a conflict rather than a replay, which F405-AC-07 and F405-AC-08 both rely on. That is a shared identity invariant and not the Phase 3 staff-assignment or team-task feature: F-411 supplies no runbook assignment, no task, and no criterion F-405 implements, and the exclusion recorded below is unaffected. F-411 is PROPOSED, so the rule is not an approved input today and this spec is not implementable against it until F-411 is approved or the rule is promoted to an approved shared invariant; F411-AC-08 records both paths.
- **Not a dependency:** [SPEC-CONFLICT #207](https://github.com/jzeng151/pop-engine/issues/207) is resolved for this proposal: F-405 owns the minimal Phase 2 runbook-assignment source required by the PRD/Roadmap, while F-213 remains the Phase 3 general team-task feature and is not an F-405 dependency. This resolution does not approve either spec.
- Baseline at draft time: PRD, Roadmap, Design, and Phase 0–1.5 Architecture approved 2026-07-22; `ARCHITECTURE-FUTURE.md` approved as a planning target 2026-07-25; NYC ruleset `nyc.v2.7`, rules schema `popengine-rules/v2`, and scenario fixtures v5 where regulatory output is consumed.
- The approval PR must re-pin any baseline version that changes before approval. A proposed or superseded input blocks implementation.

## Inputs, Outputs, State, Validation, and Errors

- Inputs are an exact event revision plus current confirmed workflow records, including F-405-owned runbook assignments and distinct ordinary operational contacts and emergency contacts; output is a timestamped runbook snapshot and printable projection.
- Runbook state is generated → stale when a source changes → regenerated; prior snapshots remain identifiable if retained.
- Unknown, conflicting, research-required, expired, or missing facts render as warnings and never as completed fields.
- Missing or unresolved material data stays visibly unset, unknown, pending, or failed as appropriate; it never becomes a successful or complete result.
- Invalid input produces a field or action-specific error without partial mutation. Retriable external failures preserve the user's confirmed state and expose a safe retry.

## UI and Accessibility

- Print and screen views preserve headings, reading order, status text, source timestamps, contact alternatives, and page-break safety.
- The complete workflow is keyboard operable, uses programmatic labels and visible focus, does not encode status by color alone, and announces asynchronous success or failure.
- Empty, loading, permission-denied, validation, provider-failure, and unavailable states have explicit copy and a safe next action.

## System Impact

| Concern              | Proposed impact                                                                                                                                                                                                                            |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| API                  | Minimal load-in task, operational-contact, and runbook-assignment CRUD plus runbook preview/generate/read operations require approved OpenAPI contracts, including the request-identity and record-version shapes AC-07 and AC-08 require. |
| Schema               | Forward migration for minimal F-405-owned load-in task, contact, and runbook-assignment records; add an immutable runbook snapshot/reference only if retention is approved.                                                                |
| Jobs                 | None for the minimal synchronous runbook; asynchronous document rendering requires a separately approved job.                                                                                                                              |
| Providers            | None.                                                                                                                                                                                                                                      |
| Privacy and security | Organizer-only/private by default; printed/downloaded output is explicitly warned as containing contacts, staff labels, and operational details.                                                                                           |

Exact HTTP, JSON Schema, migration, job, and provider shapes belong in their reviewed machine contracts; this proposal does not authorize parallel local types or edits to merged migrations.

## Acceptance Criteria

1. **F405-AC-01:** A runbook is generated only from an accepted plan that is still current for the Event's current revision. In one consistency boundary, generation reads `events.current_revision_id` and `events.current_plan_id` and requires the accepted plan's `event_revision_id` to equal that current revision; `docs/EVENT-REVISION-CONTRACT.md` §2.5 makes a plan stale the moment those differ, so when they differ no runbook is generated, the existing one stays labeled stale under AC-03, and the organizer regenerates the plan first. The snapshot records that revision, that accepted plan, the plan's ruleset version, the generation time, and the source update times; recording those identifiers is a reporting requirement and never a substitute for the check, because displaying a mismatch does not stop the mismatched sources being published as the current event-day sheet.
2. **F405-AC-02:** Confirmed permit numbers, load-in tasks, ordinary operational contacts, emergency contacts, and F-405-owned runbook assignments appear once, link back to their source record, and keep the two contact categories distinct. A runbook assignment records only the organizer-entered assignee label and runbook duty needed for the event-day sheet; it is not an F-213 task, membership assignment, or task-status workflow.
3. **F405-AC-03:** Missing, unknown, conflict, research-required, expired, or stale values are visibly labeled and prevent a complete/ready claim; no confirmed emergency contact produces an explicit unavailable warning.
4. **F405-AC-04:** Changing a source record marks the prior runbook stale; regeneration creates current output without rewriting source history.
5. **F405-AC-05:** The approved print viewport produces readable ordering and no clipped critical content.
6. **F405-AC-06:** Generation pins the complete permit, contact, assignment, and other source-version set together with AC-01's current revision and accepted plan; publication compare-and-swaps all of them, so a concurrent source correction, revision save, or plan acceptance rejects the stale in-flight snapshot rather than publishing it as current.
7. **F405-AC-07:** Creating a load-in task, an operational or emergency contact, or a runbook assignment binds the request to a stable client-supplied request identity, committed with the record under a uniqueness constraint scoped to the event. A retry carrying the same identity returns the original source record and creates no second row; a deliberately separate record uses a new identity. This is request identity, never content uniqueness: two genuinely distinct load-in tasks that read the same are both created, and a repeated identity is never rejected as a duplicate value. That identity binds its operands under the rule `F411-AC-08` states once for every client-supplied identity on this branch: it is committed together with the request fields that determine the recorded result, including every aggregate, version, and generation the request names, and a later request presenting the same identity with any different operand is refused as a conflict rather than being answered with the stored result. The identity is still the key and the operands are only a precondition on reusing it, so this is not the content uniqueness this criterion already forbids.

   F-405 newly owns these CRUD operations, so nothing upstream supplies the guarantee. When a create commits and its response is lost, the organizer retries and a second source row appears. AC-02 includes each distinct source record once and links it back, so the duplicate is correct by AC-02 and still shows the same load-in task, contact, or assignment twice on the event-day sheet the crew reads.

8. **F405-AC-08:** Every update and delete of an F-405-owned source record names the record version it was made against and commits only while that version is still current; otherwise it is rejected as a conflict with a reload-and-reconcile path, never applied as a last-write-wins overwrite. These operations carry AC-07's stable request identity as well, so a lost-response retry is not re-applied against a version that has since moved.

   AC-06 pins and compare-and-swaps the whole source set at publication, which stops a stale snapshot being published and cannot on its own recover a lost update. What follows is the reason for the rule above, not an outcome this criterion allows. Without the record-version comparison, two organizer tabs editing the same load-in task, contact, or assignment from one observed state would both commit, the later write would erase the earlier confirmed correction, and every subsequent generation would publish the surviving value as correct. Nothing would record that the correction existed, so there would be nothing for AC-06 to notice.

## Fixtures and Verification

- Planned automated fixture IDs are the acceptance IDs above; each must map one-to-one to a runnable test before approval can claim implementation readiness.
- Regulatory fixtures: Use approved scenario findings to verify status/citation passthrough; all operational contacts, staff assignments, and permit numbers are synthetic.
- Security-sensitive and cross-workspace paths require negative authorization tests; provider paths require success, duplicate-delivery, retry, invalid-signature, and permanent-failure tests where applicable.

## Allowed Footprint and Coordination

- `apps/web` and `apps/api` feature code and tests.
- New ordered forward migrations and approved OpenAPI/JSON Schema changes required by this feature.
- No repository restructuring, speculative package, or unrelated feature edit.
- Shared contracts, migrations, provider adapters, engine/rules artifacts, consent policy, and cross-lane UI primitives require the approvals named in `docs/DOCUMENTATION-GOVERNANCE.md` §6.

## Rollout and Fallback

- A live assembled/print view is the default; persist snapshots only if approval establishes a retention need.
- Rollback disables the new surface and workers/provider calls without deleting confirmed user data or rewriting immutable plans, rulesets, revisions, or history.

## Approval Blockers

- F-107 and the approved plan-acceptance contract must be shipped, or an approved pre-cutover acceptance source must exist and be named here. Approving F-405 without one of those approves AC-01 as a criterion that cannot run.
- Approve minimal load-in task/contact/runbook-assignment fields and lifecycle, included runbook fields, ready/incomplete wording, privacy handling, and whether snapshots require persistence.
- Assign the owner and independent reviewer, approve this spec, and add it to `docs/BASELINE.md`.
