# F-213 · Team Task Assignment

**Status:** PROPOSED (2026-07-26) — ready for review; not implementable until approved and listed in `docs/BASELINE.md`.

**Phase:** 3 · **Issue:** [#34](https://github.com/jzeng151/pop-engine/issues/34) · **Owner:** TBD · **Reviewer:** product owner plus affected architecture, contract, security, and lane owners (TBD) · **Approval date:** —

## Purpose and User Outcome

An authorized organizer can assign a requirement or operational task to an active workspace member and track ownership without changing the underlying evidence.

## Scope

**In scope**

- Create, assign, reassign, unassign, and complete tasks linked to checklist/application/runbook records.
- Show assignee, creator, due date if confirmed, status, and append-only change history.
- Enforce role permissions and active membership.

**Non-goals**

- A general project-management suite, subtasks, dependencies, time tracking, external assignees, or automatic escalation.
- Changing a requirement's regulatory status when a task is completed.
- Replacing F-405's Phase 2 runbook-only assignee-label/duty records; those records carry no F-213 task, membership-assignment, or task-status semantics.

## Dependencies and Baseline

- F-702/F-703 and at least one approved task source such as F-202.
- F-704 may consume assignment history but is not required for core task audit fields.
- Baseline at draft time: PRD, Roadmap, Design, and Phase 0–1.5 Architecture approved 2026-07-22; `ARCHITECTURE-FUTURE.md` approved as a planning target 2026-07-25; NYC ruleset `nyc.v2.7`, rules schema `popengine-rules/v2`, and scenario fixtures v5 where regulatory output is consumed.
- Operand binding for client-supplied identities: `specs/F-411-staff-roles-credentialed-entry.md` F411-AC-08 states once, for this whole branch, that a client-supplied identity is committed with the operands that determine its recorded result and that a reuse carrying different operands is a conflict rather than a replay. Every identity criterion below relies on it. F-411 is PROPOSED, so that rule is not an approved input today and this spec is not implementable against it until F-411 is approved or the rule is promoted to an approved shared invariant; F411-AC-08 records both paths.
- The approval PR must re-pin any baseline version that changes before approval. A proposed or superseded input blocks implementation.

## Inputs, Outputs, State, Validation, and Errors

- Inputs are an exact source-record version, title, active member, optional confirmed due date, a stable request identity on creation and on every update, and the exact task version each update was composed against; output is a workspace-scoped task and history.
- Task state is open → completed or cancelled, with reopen if approved; reassignment appends history.
- Removing a member leaves historical attribution and unassigns or blocks active work according to the approved policy.
- Missing or unresolved material data stays visibly unset, unknown, pending, or failed as appropriate; it never becomes a successful or complete result.
- Invalid input produces a field or action-specific error without partial mutation. Retriable external failures preserve the user's confirmed state and expose a safe retry.

## UI and Accessibility

- Assignment controls list only eligible active members and expose status/assignee changes in text with accessible date inputs.
- The complete workflow is keyboard operable, uses programmatic labels and visible focus, does not encode status by color alone, and announces asynchronous success or failure.
- Empty, loading, permission-denied, validation, provider-failure, and unavailable states have explicit copy and a safe next action.

## System Impact

| Concern              | Proposed impact                                                                                                 |
| -------------------- | --------------------------------------------------------------------------------------------------------------- |
| API                  | Task and assignment operations require approved OpenAPI authorization and concurrency contracts.                |
| Schema               | Forward migrations for tasks and assignment history linked to source aggregates.                                |
| Jobs                 | None in the minimal feature; notifications/escalations require a separately approved alert expansion.           |
| Providers            | None.                                                                                                           |
| Privacy and security | Workspace/role authorization, safe member projections, and audit history; task notes exclude secrets/documents. |

Exact HTTP, JSON Schema, migration, job, and provider shapes belong in their reviewed machine contracts; this proposal does not authorize parallel local types or edits to merged migrations.

## Acceptance Criteria

1. **F213-AC-01:** Only an authorized actor can assign an open task to an eligible active member of the same workspace.
2. **F213-AC-02:** Reassign, unassign, complete, cancel, and approved reopen actions preserve actor/timestamp history.
3. **F213-AC-03:** Completing a task does not mark a permit, application, document, or regulatory finding complete.
4. **F213-AC-04:** Assignment and member removal serialize on membership (or use an equivalent database invariant), so their race cannot leave an open task assigned to an inactive member; historical attribution remains.
5. **F213-AC-05:** Every update names the exact task version it was composed against and commits only by compare-and-swap on that version; a stale update is rejected as a conflict, mutates nothing, and returns the current task for the actor to reload and reconcile, never a last-write-wins overwrite. That is every mutable task field, not only status and assignee: the AC-02 reassign, unassign, complete, cancel, and approved reopen transitions, and equally the title, the optional confirmed due date, and the AC-06 source pin, are each composed against a named version on the same terms, because two tabs editing one task from a single observed version otherwise both succeed and the later write erases a change the earlier actor was told had saved. Each update also carries a stable client-supplied request identity committed with the history entry it appends, under a uniqueness constraint scoped to the task, so a lost-response retry returns its original recorded outcome instead of appending a second history entry or re-applying a change against a version that has since moved. That identity binds its operands under the rule `F411-AC-08` states once for every client-supplied identity on this branch: it is committed together with the request fields that determine the recorded result, including every aggregate, version, and generation the request names, and a later request presenting the same identity with any different operand is refused as a conflict rather than being answered with the stored result. The identity is still the key and the operands are only a precondition on reusing it, so this is not the content uniqueness this criterion already forbids.
6. **F213-AC-06:** Each task pins its exact checklist, application, or runbook source version. When that source is superseded or removed, active work is visibly source-stale and cannot appear current; history remains, and the approved policy determines whether the task is cancelled or requires review.
7. **F213-AC-07:** Task creation carries a client-supplied stable request identity and commits it with the task in one transaction, under a uniqueness constraint scoped to the workspace the task belongs to; a replay of that identity returns the original task instead of appending a second one, and a deliberate second task from the same source uses a new identity and is created normally. Source uniqueness cannot stand in for this, because F-213 allows several deliberate tasks against one source record, so deduplicating on the source would refuse legitimate work while a lost create response would still leave two indistinguishable tasks. That identity binds its operands under the rule `F411-AC-08` states once for every client-supplied identity on this branch: it is committed together with the request fields that determine the recorded result, including every aggregate, version, and generation the request names, and a later request presenting the same identity with any different operand is refused as a conflict rather than being answered with the stored result. The identity is still the key and the operands are only a precondition on reusing it, so this is not the content uniqueness this criterion already forbids.

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

- Ship assignments without notifications; add team reminders only through the Roadmap-approved F-203 full expansion after that expansion is separately approved.
- Rollback disables the new surface and workers/provider calls without deleting confirmed user data or rewriting immutable plans, rulesets, revisions, or history.

## Approval Blockers

- Approve task status/reopen policy, permission matrix, member-removal behavior, and due-date semantics.
- Assign the owner and independent reviewer, approve this spec, and add it to `docs/BASELINE.md`.
