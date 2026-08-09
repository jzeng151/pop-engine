# F-213 · Team Task Assignment

**Status:** PROPOSED (2026-07-26) — ready for review; not implementable until approved and listed in `docs/BASELINE.md`.

**Phase:** 3 · **Issue:** [#34](https://github.com/jzeng151/pop-engine/issues/34) · **Owner:** TBD · **Reviewer:** product owner · **Approval date:** —

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

- At least one approved task source such as F-202, and the F-701/F-702/F-703 gate. F-702 supplies the workspace membership boundary the task and its source record resolve against and F-703 supplies the permission matrix `F213-AC-08` checks; F-701 supplies the authenticated actor both read from. F-701 is APPROVED (2026-07-28, `docs/BASELINE.md`); F-702 and F-703 remain PROPOSED, so the gate is not an approved input today and this spec is not implementable against it until those two are approved and listed in `docs/BASELINE.md`.
- F-704 may consume assignment history but is not required for core task audit fields.
- Baseline at draft time: PRD, Roadmap, Design, and Phase 0–1.5 Architecture approved 2026-07-22; `ARCHITECTURE-FUTURE.md` approved as a planning target 2026-07-25; NYC ruleset `nyc.v2.7`, rules schema `popengine-rules/v2`, and scenario fixtures v5 where regulatory output is consumed.
- Operand binding and replay ordering for client-supplied identities: `specs/F-411-staff-roles-credentialed-entry.md` F411-AC-08 states once, for this whole branch, that a client-supplied identity is committed with the operands that determine its recorded result and that a reuse carrying different operands is a conflict rather than a replay, and that a committed identity is resolved before any version, generation, state, or limit check whose answer the committed operation itself changed, while the acting actor's current authority is re-read at the replay and must still admit the operation before any stored outcome is returned. Every identity criterion below relies on it. F-411 is PROPOSED, so that rule is not an approved input today and this spec is not implementable against it until F-411 is approved or the rule is promoted to an approved shared invariant; F411-AC-08 records both paths.
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
5. **F213-AC-05:** Every update names the exact task version it was composed against and commits only by compare-and-swap on that version; a stale update is rejected as a conflict, mutates nothing, and returns the current task for the actor to reload and reconcile, never a last-write-wins overwrite. That is every mutable task field, not only status and assignee: the AC-02 reassign, unassign, complete, cancel, and approved reopen transitions, and equally the title, the optional confirmed due date, and the AC-06 source pin, are each composed against a named version on the same terms, because two tabs editing one task from a single observed version otherwise both succeed and the later write erases a change the earlier actor was told had saved. Each update also carries a stable client-supplied request identity committed with the history entry it appends, under a uniqueness constraint scoped to the task, and a request presenting an already committed identity is resolved from that record before the version comparison above and returns the outcome that request originally recorded, appending no second history entry. The ordering is stated because the two rules otherwise contradict each other on one request: when an update commits and its response is lost, the retry still names the task version the actor read, which that commit advanced, so a comparison made first rejects it as stale for work that in fact succeeded. That identity binds its operands under the rule `F411-AC-08` states once for every client-supplied identity on this branch: it is committed together with the request fields that determine the recorded result, including every aggregate, version, and generation the request names, and a later request presenting the same identity with any different operand is refused as a conflict rather than being answered with the stored result. The identity is still the key and the operands are only a precondition on reusing it, so this is not the content uniqueness this criterion already forbids. That identity is resolved in the order `F411-AC-08` states once for every client-supplied identity on this branch, applied here rather than restated: a request presenting an already committed identity is resolved from that record before the version, generation, state, and limit checks this criterion requires, and returns the outcome that request originally recorded, because the commit the retry repeats is exactly what moved the state those checks read. The acting actor's current authority is not among the checks the identity is resolved past: the authority this feature requires for a first attempt is re-read server-side at the replay, and the stored outcome is returned only if it still admits the operation, so a replay presented after that authority is gone is refused and discloses no more than a first request would; the only exception is authority the committed operation itself removed, which `F411-AC-08` states once for this branch. A request whose identity resolves to no committed outcome is then held to every one of them, and a request refused by one of them commits no identity, so re-presenting it later is a first attempt and not a replay.
6. **F213-AC-06:** Each task pins its exact checklist, application, or runbook source version. When that source is superseded or removed, active work is visibly source-stale and cannot appear current; history remains, and the approved policy determines whether the task is cancelled or requires review.
7. **F213-AC-07:** Task creation carries a client-supplied stable request identity and commits it with the task in one transaction, under a uniqueness constraint scoped to the workspace the task belongs to; a replay of that identity returns the original task instead of appending a second one, and a deliberate second task from the same source uses a new identity and is created normally. Source uniqueness cannot stand in for this, because F-213 allows several deliberate tasks against one source record, so deduplicating on the source would refuse legitimate work while a lost create response would still leave two indistinguishable tasks. That identity binds its operands under the rule `F411-AC-08` states once for every client-supplied identity on this branch: it is committed together with the request fields that determine the recorded result, including every aggregate, version, and generation the request names, and a later request presenting the same identity with any different operand is refused as a conflict rather than being answered with the stored result. The identity is still the key and the operands are only a precondition on reusing it, so this is not the content uniqueness this criterion already forbids. That identity is resolved in the order `F411-AC-08` states once for every client-supplied identity on this branch, applied here rather than restated: a request presenting an already committed identity is resolved from that record before the version, generation, state, and limit checks this criterion requires, and returns the outcome that request originally recorded, because the commit the retry repeats is exactly what moved the state those checks read. The acting actor's current authority is not among the checks the identity is resolved past: the authority this feature requires for a first attempt is re-read server-side at the replay, and the stored outcome is returned only if it still admits the operation, so a replay presented after that authority is gone is refused and discloses no more than a first request would; the only exception is authority the committed operation itself removed, which `F411-AC-08` states once for this branch. A request whose identity resolves to no committed outcome is then held to every one of them, and a request refused by one of them commits no identity, so re-presenting it later is a first attempt and not a replay.
8. **F213-AC-08:** Every operation this feature defines names the task it acts in, or on creation the workspace the task will belong to, and the workspace that owns it, and is admitted only by the acting actor's current F-702 membership of that workspace together with the F-703 permission approved for the action, both re-read server-side from stored membership and role at the moment of the operation and, for a write, inside the same transaction that commits it. That covers task creation under F213-AC-07, the reassign, unassign, complete, cancel, and approved reopen transitions under F213-AC-02, the title, confirmed-due-date, and source-pin updates under F213-AC-05, and every read this feature defines, of a task, its assignee, its append-only history, and the eligible-member projections the assignment controls list. F213-AC-01 remains the rule for the assign action, an authorized actor assigning an open task to an eligible active member of the same workspace, and F213-AC-04 remains the rule that serializes assignment against the assignee's membership removal; this criterion composes with both by supplying what neither states, the acting actor's own current authority re-read at every operation, including every operation AC-01 does not reach. A request failing the check is refused before any durable write and before any task field, assignee, history entry, or member projection is disclosed, and its response does not distinguish a task that does not exist from one the actor may not see. The check is at the operation and not at session start or workspace switch, so authority removed while a request is in flight causes that request to fail rather than commit.

   Without this criterion the other criteria all pass for a caller who names another workspace's task. F213-AC-01 gates only the assign action, and F213-AC-04 serializes on the assignee's membership, not the acting actor's; AC-02, AC-03, AC-05, AC-06, and AC-07 fix history, regulatory separation, versioning, source pinning, and request identity, and not one of them asks who the actor is. The surface that set leaves open reads another workspace's tasks, member projections, and attribution history, and completes, cancels, retitles, or re-dates their open work, for anyone who can name the task.

   **The same boundary binds the source a task is pinned to, not only the task it names.** The exact checklist, application, or runbook source version pinned under F213-AC-06 must itself resolve to the workspace the task belongs to, checked when the task is created under F213-AC-07, again on every source-pin update under F213-AC-05, and again on every read that exposes the pinned source, its identifiers, or the source-stale status F213-AC-06 derives from it. A creation or update naming a source outside that workspace is refused: it creates or changes nothing, and its refusal does not distinguish a source that does not exist from one the actor may not pin.

   Pinning the exact version is not the same as pinning a source the workspace owns. A user who belongs to two workspaces creates a task in workspace B and names a workspace-A checklist, application, or runbook version; F213-AC-06 pins it because it is exact, and F213-AC-08 admits the request because the task's own workspace is authorized, so the foreign source reaches the actor's collaborators through the task's fields, its source-stale status, and its append-only history while every stated check passes. The source pin is content the task carries and not only an identifier it stores, which is why the boundary is stated for it here rather than left to the identifier rule above.

   One input this criterion needs is not established by any approved artifact today and is not invented here. F-703 is PROPOSED and names no role set, so the permission above cannot be named. Until F-703 is approved this criterion is testable only as "every task creation, mutation, and read is refused unless the acting actor holds an active membership of the workspace that owns the named task, read server-side at that operation, and a refusal discloses nothing about whether that task exists", not against a named role or permission identifier. Naming the task creation, read, and management permissions with F-703 is an approval blocker below.

## Fixtures and Verification

- Planned automated fixture IDs are the acceptance IDs above; each must map one-to-one to a runnable test before approval can claim implementation readiness.
- Regulatory fixtures: none; this feature does not define regulatory ground truth.
- F213-AC-05 includes a fixture in which a task update commits, its response is lost, and the retry presenting the same request identity and the pre-update task version returns the original recorded outcome rather than a stale-version conflict, appending no second history entry.
- F213-AC-08 includes a fixture in which an actor holding no membership of the owning workspace names a valid task and is refused at creation, at every AC-02 transition, at every AC-05 field update, and at every read of the task, its history, and its member projections, with a response that does not distinguish absence from denial, and a fixture in which authority removed while an update is in flight fails that request rather than committing. It also includes a cross-workspace source fixture in which a user holding membership of both workspaces creates a task in workspace B naming an exact workspace-A checklist, application, or runbook source version, and a second fixture in which an existing task's source pin is updated to one: both are refused, nothing is created or changed, and no field, source-stale status, or history entry exposes the workspace-A source.
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
- Approve F-702 and F-703, and name with F-703 the task creation, read, and management permissions `F213-AC-08` checks. That criterion checks a permission no approved artifact defines today and may not invent one, so until the matrix names them it is testable only at the membership level stated there.
- Assign the owner, approve this spec, and add it to `docs/BASELINE.md`. The reviewer and approver is the product owner (`docs/DOCUMENTATION-GOVERNANCE.md` §6), which is what this spec's header records, and that is the whole requirement: the independent-reviewer element this blocker used to carry was retired on 2026-08-05 (product owner; see §6 and `docs/BASELINE.md`). Until those three things are done this blocker is not satisfied and this spec is not approved: it stays PROPOSED under governance §3, its Approval date stays `—`, and it is not implementable and not listed in `docs/BASELINE.md`. Retiring the reviewer element made this spec approvable; it did not approve it.
