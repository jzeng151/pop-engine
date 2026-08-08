# F-502 · Historical Event Comparison

**Status:** PROPOSED (2026-07-26) — ready for review; not implementable until approved and listed in `docs/BASELINE.md`.

**Phase:** 3 · **Issue:** [#47](https://github.com/jzeng151/pop-engine/issues/47) · **Owner:** TBD · **Reviewer:** product owner · **Approval date:** —

## Purpose and User Outcome

An organizer can compare permit burden, cost, preparation time, and attendance across explicitly selected past events without an opaque similarity algorithm.

## Scope

**In scope**

- Select two or more workspace events and compare approved metric snapshots side by side.
- Show scope descriptors, source versions, coverage, and incomparable/missing measures.
- Link to source event/post-mortem details.

**Non-goals**

- Automatic similarity scoring, recommendations, predictions, cross-customer benchmarks, or rewriting historical plans.
- Comparing values with incompatible definitions/currencies without an explicit unavailable result.

## Dependencies and Baseline

- F-406/F-407 confirmed outcome snapshots and retained immutable plan/application data. F407-AC-01 freezes attendance versus RSVP, leads, P&L, and permit-timeline adherence; it does not carry permit burden, so F-502 pins the immutable plan each burden value is read from rather than inferring one from a snapshot (F502-AC-07).
- The F-701/F-702/F-703 gate. F-702 supplies the workspace membership boundary the selected events and their confirmed snapshots resolve against and F-703 supplies the permission matrix `F502-AC-08` checks; F-701 supplies the authenticated actor both read from. All three are PROPOSED, so the gate is not an approved input today and this spec is not implementable against it until they are approved and listed in `docs/BASELINE.md`.
- Approved comparison metrics and compatibility rules.
- The approved plan-acceptance contract that defines and populates `events.current_plan_id`, plus its named owner. F502-AC-07 makes that accepted-plan pointer the default permit-burden source, and the approved Event Revision contract assigns the pointer to separate plan-acceptance work, so implementing F-502 after only its other prerequisites can find no such pointer. F-502 does not invent one: until that contract is approved, either it is a prerequisite of this spec or an approved pre-cutover burden source is named here in its place.
- F-103 and the exact shared `permit-burden/v1` definition and fixtures that resolve [SPEC-CONFLICT #208](https://github.com/jzeng151/pop-engine/issues/208).
- Baseline at draft time: PRD, Roadmap, Design, and Phase 0–1.5 Architecture approved 2026-07-22; `ARCHITECTURE-FUTURE.md` approved as a planning target 2026-07-25; NYC ruleset `nyc.v2.7`, rules schema `popengine-rules/v2`, and scenario fixtures v5 where regulatory output is consumed.
- The approval PR must re-pin any baseline version that changes before approval. A proposed or superseded input blocks implementation.

## Inputs, Outputs, State, Validation, and Errors

- Inputs are organizer-selected workspace events and, for each event, either F-407's exact per-event current confirmed outcome-snapshot pointer or an explicitly selected historical confirmed snapshot version, plus one exact retained immutable plan version per event for permit burden; output is a derived comparison pinned to those exact snapshot, plan, metric, and source versions.
- Comparison is available only for compatible metric versions/units; missing or incompatible values remain explicit.
- Historical permit findings stay pinned to their original ruleset; the feature does not re-evaluate them.
- Missing or unresolved material data stays visibly unset, unknown, pending, or failed as appropriate; it never becomes a successful or complete result.
- Invalid input produces a field or action-specific error without partial mutation. Retriable external failures preserve the user's confirmed state and expose a safe retry.

## UI and Accessibility

- Table/chart views preserve a linear accessible table, label units/versions, and explain missing/incomparable cells.
- The complete workflow is keyboard operable, uses programmatic labels and visible focus, does not encode status by color alone, and announces asynchronous success or failure.
- Empty, loading, permission-denied, validation, provider-failure, and unavailable states have explicit copy and a safe next action.

## System Impact

| Concern              | Proposed impact                                                                                                      |
| -------------------- | -------------------------------------------------------------------------------------------------------------------- |
| API                  | Comparison query and optional saved-selection operations require approved OpenAPI contracts.                         |
| Schema               | No persistence for ephemeral comparisons; save only selected IDs/metric versions if a retained use case is approved. |
| Jobs                 | None.                                                                                                                |
| Providers            | None.                                                                                                                |
| Privacy and security | All selected events and source metrics must belong to the active workspace; aggregates contain no attendee PII.      |

Exact HTTP, JSON Schema, migration, job, and provider shapes belong in their reviewed machine contracts; this proposal does not authorize parallel local types or edits to merged migrations.

## Acceptance Criteria

1. **F502-AC-01:** Only explicitly selected events from the active workspace enter a comparison.
2. **F502-AC-02:** Cost, preparation time, and attendance use approved metric definitions and show units/source versions. Permit burden consumes F-103's exact shared `permit-burden/v1` sets, declared in `docs/proposals/permit-burden-v1.ts` and read rather than restated here, with its final-finding identity, deduplication rule, definite/unresolved treatment, version, and fixtures and cannot define a separate interpretation. Each burden value is computed from the stored final findings of the one plan version pinned under F502-AC-07, which it names, and the engine is never re-run.
3. **F502-AC-03:** Missing, partial, incompatible-version, or incompatible-currency values display as unavailable rather than zero or a coerced comparison.
4. **F502-AC-04:** Historical regulatory results remain pinned to their original artifact and are never recomputed for this report.
5. **F502-AC-05:** Reordering selected events changes presentation only and leaves metric values unchanged.
6. **F502-AC-06:** The default comparison captures F-407's per-event current confirmed outcome-snapshot pointer with the exact snapshot it reads and rejects/rebuilds if that pointer changes before the comparison is returned. An organizer may instead select an exact older confirmed version, which remains visibly labeled historical; F-502 never chooses an arbitrary confirmed snapshot or presents a superseded snapshot as current. A selected historical version must be one the event whose comparison column consumes it retains, checked server-side before the comparison is built and again on every read that returns a cost, preparation-time, or attendance value derived from it; a version that event does not retain refuses the comparison in whole rather than returning that event's column from it. The default leg gets this for free because it starts from the event's own pointer, which is why the explicit leg is where it has to be stated. F502-AC-08 checks the actor's membership of each selected event's owning workspace individually and says nothing about which event a selected snapshot belongs to, and AC-04's rule that a historical result stays pinned to its original artifact keeps a snapshot unrecomputed without saying whose it is, so without this check an organizer who can see events A and B selects B's confirmed snapshot in A's column and the comparison attributes B's attendance, cost, and preparation outcomes to A while every stated check passes. That is the same binding F502-AC-07 already makes for the plan version leg, applied to the outcome-snapshot leg beside it.
7. **F502-AC-07:** Permit burden derives from exactly one immutable plan version per event, pinned and displayed with the value. The default is the plan the event's accepted-plan pointer names at read time, captured with the exact version read, and the comparison is rejected or rebuilt if that pointer moves before it is returned; an organizer may instead select an exact retained plan version, which must be one that same event retains, checked server-side before the comparison is built, and which remains visibly labeled historical. F502-AC-08 checks the actor's membership of each selected event's owning workspace individually and says nothing about where a selected plan version lives, so without that check an actor who can see two events can pin event B's plan version as event A's permit burden and read a figure the comparison then attributes to A. A selected version the named event does not retain refuses the comparison in whole rather than returning a burden for that event. When an event retains several plans, F-502 never resolves the choice by recency, generation order, or any other implicit rule: with no accepted plan and no explicit selection, that event's permit burden is unavailable under F502-AC-03 rather than defaulted.

8. **F502-AC-08:** Every operation this feature defines names the workspace it acts in and each event it compares, and is admitted only by the acting actor's current F-702 membership of that workspace together with the F-703 permission approved for the action, both re-read server-side from stored membership and role at the moment of the operation. That covers event selection under F502-AC-01, building and reading a comparison under F502-AC-02 through F502-AC-07, and any export of one. Membership is checked for each selected event's owning workspace individually, not once for the comparison, so a selection mixing an event the actor may see with one they may not is refused in whole. A request failing the check is refused before any metric value, unit, source version, pinned plan, or permit-burden figure is disclosed, and its response does not distinguish an event that does not exist from one the actor may not see. The check is at the operation and not at session start or workspace switch.

   AC-01 states that only explicitly selected events from the active workspace enter a comparison, which constrains which events may be selected and not who may select them. It is satisfied by any caller who switches the active workspace to the one they are naming, and F702-AC-09 admits a switch only into a workspace the actor already belongs to, so the gap is not the switch itself but that no criterion here re-reads that membership at the selection or at the read. AC-02 through AC-07 fix the metric definitions, the unavailable states, the pinning of historical regulatory results, the ordering, the pointer capture, and the plan pin, and not one of them asks who the actor is. The comparison surfaces cost, preparation time, attendance, and permit burden per event, which is the whole of another organizer's outcome history for the events named.

   One input this criterion needs is not established by any approved artifact today and is not invented here. F-703 is PROPOSED and names no role set, so the permission above cannot be named. Until F-703 is approved this criterion is testable only as "every selection, comparison build, read, and export is refused unless the acting actor holds an active membership of the workspace owning every named event, read server-side at that operation, and a refusal discloses nothing about whether an event exists", not against a named role or permission identifier. Naming the comparison read and export permissions with F-703 is an approval blocker below.

## Fixtures and Verification

- Planned automated fixture IDs are the acceptance IDs above; each must map one-to-one to a runnable test before approval can claim implementation readiness.
- Regulatory fixtures: Permit burden reuses the exact shared `permit-burden/v1` F-103 fixtures; F-502 adds no separate regulatory interpretation.
- F502-AC-08 includes a fixture in which a selection naming one event the actor may see and one they may not is refused in whole, disclosing no metric from either, and a fixture in which an actor holding no membership of the owning workspace is refused at build, read, and export with a response that does not distinguish absence from denial.
- F502-AC-06 includes a fixture in which an organizer comparing two same-workspace events selects the confirmed historical outcome-snapshot version of one as the other's column, and the comparison is refused in whole with no attendance, cost, or preparation value returned for either event, plus a same-event control fixture in which a historical version that event retains is accepted and rendered labeled historical.
- F502-AC-07 includes a fixture in which an actor who can see two events selects a plan version retained by one as the pinned plan for the other and the comparison is refused in whole, and a same-event control fixture in which a retained plan version of the named event is accepted and displayed with the value.
- Security-sensitive and cross-workspace paths require negative authorization tests; provider paths require success, duplicate-delivery, retry, invalid-signature, and permanent-failure tests where applicable.

## Allowed Footprint and Coordination

- `apps/web` and `apps/api` feature code and tests.
- New ordered forward migrations and approved OpenAPI/JSON Schema changes required by this feature.
- No repository restructuring, speculative package, or unrelated feature edit.
- Shared contracts, migrations, provider adapters, engine/rules artifacts, consent policy, and cross-lane UI primitives require the approvals named in `docs/DOCUMENTATION-GOVERNANCE.md` §6.

## Rollout and Fallback

- Use explicit user selection; add similarity assistance only through a later approved feature.
- Rollback disables the new surface and workers/provider calls without deleting confirmed user data or rewriting immutable plans, rulesets, revisions, or history.

## Approval Blockers

- Approve metric compatibility, minimum source coverage, unit/currency behavior, and selected-event limit.
- Approve the plan-acceptance contract that supplies `events.current_plan_id`, and name its owner, or approve an explicit pre-cutover permit-burden source for F502-AC-07.
- Approve F-701, F-702, and F-703, and name with F-703 the comparison read and export permissions `F502-AC-08` checks. That criterion checks a permission no approved artifact defines today and may not invent one, so until the matrix names them it is testable only at the membership level stated there.
- Assign the owner, approve this spec, and add it to `docs/BASELINE.md`. The reviewer and approver is the product owner (`docs/DOCUMENTATION-GOVERNANCE.md` §6), which is what this spec's header records, and that is the whole requirement: the independent-reviewer element this blocker used to carry was retired on 2026-08-05 (product owner; see §6 and `docs/BASELINE.md`). Until those three things are done this blocker is not satisfied and this spec is not approved: it stays PROPOSED under governance §3, its Approval date stays `—`, and it is not implementable and not listed in `docs/BASELINE.md`. Retiring the reviewer element made this spec approvable; it did not approve it.
