# F-109 · Scope-Support Classification

**Status:** PROPOSED (2026-07-26) — ready for review; not implementable until approved and listed in `docs/BASELINE.md`.

**Phase:** 4 · **Issue:** [#54](https://github.com/jzeng151/pop-engine/issues/54) · **Owner:** TBD · **Reviewer:** product owner plus affected architecture, contract, security, and lane owners (TBD) · **Approval date:** —

## Purpose and User Outcome

PopEngine can tell users whether their described scope is fully supported, partially supported, unsupported, ambiguous, or awaiting information before open-ended intake reaches the rules engine.

## Scope

**In scope**

- Define and carry the five Roadmap scope support states through intake, proposals, evaluation gating, plan/API, and UI.
- Attach machine-readable reasons and user actions without inventing regulatory conclusions.
- Carry scope support separately from result completeness, verdict, finding disposition, verification status, and evaluation error.

**Non-goals**

- Inferring missing regulatory rules, treating partially supported scope as complete, replacing tri-state conditions, or grading AI confidence.
- Adding open-ended intake; F-601 consumes this contract.

## Dependencies and Baseline

- Approved shared-enum/type-authority handoff and scope-support decision table.
- Operand binding and replay ordering for client-supplied identities: `specs/F-411-staff-roles-credentialed-entry.md` F411-AC-08 states once, for this whole branch, that a client-supplied identity is committed with the operands that determine its recorded result, that a reuse carrying different operands is a conflict rather than a replay, and that a committed identity is resolved before any version, generation, state, authority, or limit check whose answer the committed operation itself changed. The classification identity in `F109-AC-07` relies on both. F-411 is PROPOSED, so those rules are not an approved input today and this spec is not implementable against them until F-411 is approved or they are promoted to an approved shared invariant; F411-AC-08 records both paths.
- F-108 where location or authority metadata contributes; F-601 is blocked on F-109. Whether that agrees with `docs/DESIGN.md:90`, whose build-order section reads `F-601 → F-109`, is open question T-8 and blocks F-601's approval, not F-109's.
- The F-701/F-702/F-703 gate. F-702 supplies the workspace membership boundary the Event whose confirmed structured scope is classified resolves against and F-703 supplies the permission matrix `F109-AC-06` checks; F-701 supplies the authenticated actor both read from. All three are PROPOSED, so the gate is not an approved input today and this spec is not implementable against it until they are approved and listed in `docs/BASELINE.md`.
- Baseline at draft time: PRD, Roadmap, Design, and Phase 0–1.5 Architecture approved 2026-07-22; `ARCHITECTURE-FUTURE.md` approved as a planning target 2026-07-25; NYC ruleset `nyc.v2.7`, rules schema `popengine-rules/v2`, and scenario fixtures v5 where regulatory output is consumed.
- The approval PR must re-pin any baseline version that changes before approval. A proposed or superseded input blocks implementation.

## Inputs, Outputs, State, Validation, and Errors

- Inputs are confirmed structured scope plus registry/ruleset jurisdiction metadata; output is exactly one scope support state with reasons.
- State may change only when confirmed inputs or versioned scope-support artifacts change; history pins the prior result.
- Ambiguous and awaiting-information remain non-terminal; unsupported and partial never produce a complete-plan claim.
- Missing or unresolved material data stays visibly unset, unknown, pending, or failed as appropriate; it never becomes a successful or complete result.
- Invalid input produces a field or action-specific error without partial mutation. Retriable external failures preserve the user's confirmed state and expose a safe retry.

## UI and Accessibility

- Scope support state, reason, missing information, and safe next action appear before evaluation and beside any partial output; wording is not color-only.
- The complete workflow is keyboard operable, uses programmatic labels and visible focus, does not encode status by color alone, and announces asynchronous success or failure.
- Empty, loading, permission-denied, validation, provider-failure, and unavailable states have explicit copy and a safe next action.

## System Impact

| Concern              | Proposed impact                                                                                                                       |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| API                  | Add the five scope-support states/reasons to approved OpenAPI/JSON Schema and generated shared types atomically.                      |
| Schema               | Shared enum/schema change requires all affected lane owners; persistence stores state, reasons, input revision, and artifact version. |
| Jobs                 | None.                                                                                                                                 |
| Providers            | None; provider confidence from F-108 is an input, not scope-support authority.                                                        |
| Privacy and security | No sensitive intake values in reason telemetry; rate limits apply to classification/evaluation.                                       |

Exact HTTP, JSON Schema, migration, job, and provider shapes belong in their reviewed machine contracts; this proposal does not authorize parallel local types or edits to merged migrations.

## Acceptance Criteria

1. **F109-AC-01:** The only scope support states are fully supported, partially supported, unsupported, ambiguous, and awaiting information in every contract and UI, as `docs/PRD.md` and `docs/ROADMAP.md` state.
2. **F109-AC-02:** The approved decision table maps the same confirmed input/artifact versions to the same state/reasons deterministically.
3. **F109-AC-03:** Partial, unsupported, ambiguous, or awaiting-information output cannot be labeled a complete permit plan.
4. **F109-AC-04:** Scope support is carried separately from `ARCHITECTURE-FUTURE.md` §7.1 result completeness, feasibility verdict, rule verification status, finding disposition, and evaluation failure; this criterion does not decide whether the two pre/post-evaluation axes represent one fact observed at different points.
5. **F109-AC-05:** Unknown or failed classification cannot fall back to fully supported.
6. **F109-AC-06:** Every user-facing operation this feature defines names the Event whose confirmed structured scope it acts on and the workspace that owns it, and is admitted only by the acting actor's current F-702 membership of that workspace together with the F-703 permission approved for the action, both re-read server-side from stored membership and role at the moment of the operation and, for a write, inside the same transaction that commits it. That covers every user-triggered classification or re-classification of a confirmed structured scope, and every user-facing read of the resulting state and reasons through intake, proposals, evaluation gating, plan/API, and UI under F109-AC-01 through F109-AC-05. A classification the system invokes internally as part of an evaluation is not a user operation and is outside this criterion; it carries the authority of the operation that invoked it, which that operation's own authorization criterion gates, so no internal invocation widens what any actor can reach. A request failing the check is refused before any durable write and before any scope support state, reason, or missing-information item is disclosed, and its response does not distinguish an Event that does not exist from one the actor may not see. The check is at the operation and not at session start or workspace switch, so authority removed while a request is in flight causes that request to fail rather than commit.

   Without this criterion F109-AC-01 through F109-AC-05 all pass for a caller who names another workspace's Event. They fix the closed state set, the deterministic decision table, the complete-plan labeling bar, the separation of axes, and the failure fallback, and not one asks who the actor is; the only scoping language in this spec is the rate-limit line in the System Impact privacy row, which is not an acceptance criterion an implementation is built to. A scope support state and its machine-readable reasons disclose what another organizer's confirmed structured scope contains and where it falls short, and a user-triggered re-classification against changed artifacts writes a new pinned result into that Event's history.

   One input this criterion needs is not established by any approved artifact today and is not invented here. F-703 is PROPOSED and names no role set, so the permission above cannot be named. Until F-703 is approved this criterion is testable only as "every user-triggered classification or re-classification and every user-facing read of scope support state and reasons is refused unless the acting actor holds an active membership of the workspace that owns the named Event, read server-side at that operation, and a refusal discloses nothing about whether that Event exists", not against a named role or permission identifier. Naming the classification and scope-support read permissions with F-703 is an approval blocker below.

7. **F109-AC-07:** A user-triggered classification or re-classification names the exact confirmed input and artifact versions it read, the Event revision the confirmed structured scope belongs to and the version of every scope-support artifact the approved decision table consumed, and the transaction that persists the result compare-and-swaps every one of them; any mismatch rejects the whole classification, persists nothing, and requires the classification to be recomposed against the current inputs. The same request also binds a stable client-supplied request identity, committed with the persisted result under a uniqueness constraint scoped to the Event, and that identity is resolved in the order `F411-AC-08` states once for every client-supplied identity on this branch, before the version comparison above, returning the result that request originally recorded; it binds its operands under the same rule, so a reuse naming different input or artifact versions is refused as a conflict rather than answered with the stored result.

   F109-AC-02 makes the decision table deterministic for a given set of confirmed input and artifact versions and says nothing about which set is current when the result is written. A classification composed against one Event revision or scope-support artifact version, overtaken by a revision save or an artifact update before it commits, is therefore internally correct under AC-02 and still persisted and exposed as the current support state of a scope it never read, changing the evaluation gating and complete-plan labeling AC-03 governs for inputs that no longer exist. The identity and the comparison are both needed and neither substitutes for the other: without the comparison a stale classification commits as current, and without the identity the comparison rejects a retry after a lost response, because the commit the retry repeats is exactly what moved the versions it names.

   Where an implementation cannot fence the result this way, the only truthful alternative is to persist the classification as a result visibly labeled historical and pinned to the versions it read, never presented as the current state and never read by evaluation gating or complete-plan labeling. The persistence itself is not an approved artifact today: the System Impact Schema row states it as proposed impact and gates it on the shared enum/schema approval, so until that approval lands this criterion is testable only as "a persisted classification names the exact confirmed input and artifact versions it read, a classification whose named versions are no longer current is rejected rather than exposed as the current state, and a retry presenting a committed classification identity returns that classification's recorded result", not against a named table, column, or endpoint.

## Fixtures and Verification

- Planned automated fixture IDs are the acceptance IDs above; each must map one-to-one to a runnable test before approval can claim implementation readiness.
- Regulatory fixtures: Add independently reviewed scope-support fixtures for every state/reason branch; existing scenarios A–F must remain fully classified under their approved structured scope.
- F109-AC-07 includes a fixture in which a classification is composed against one Event revision and scope-support artifact version, a revision save commits before it, and the classification is rejected rather than persisted as the current state; a fixture in which a classification commits, its response is lost, and the retry presenting the same classification identity returns the original result rather than a version rejection and persists no second result; and a mismatched-reuse fixture in which that committed identity is re-presented naming a different artifact version and is refused as a conflict, persisting nothing.
- F109-AC-06 includes a fixture in which an actor holding no membership of the owning workspace names a valid Event and is refused at user-triggered classification and re-classification and at every user-facing read of scope support state and reasons across intake, proposals, evaluation gating, plan/API, and UI, with a response that does not distinguish absence from denial, a fixture in which membership removed while a re-classification is in flight fails the request rather than committing a new pinned result, and a paired fixture confirming a system-internal evaluation-invoked classification is unaffected and carries the invoking operation's authority.
- Security-sensitive and cross-workspace paths require negative authorization tests; provider paths require success, duplicate-delivery, retry, invalid-signature, and permanent-failure tests where applicable.

## Allowed Footprint and Coordination

- `apps/web` and `apps/api` feature code and tests.
- New ordered forward migrations and approved OpenAPI/JSON Schema changes required by this feature.
- No repository restructuring, speculative package, or unrelated feature edit.
- Shared contracts, migrations, provider adapters, engine/rules artifacts, consent policy, and cross-lane UI primitives require the approvals named in `docs/DOCUMENTATION-GOVERNANCE.md` §6.

## Rollout and Fallback

- Introduce the contract before F-601; keep open-ended intake disabled until all five states pass end-to-end tests.
- Rollback disables the new surface and workers/provider calls without deleting confirmed user data or rewriting immutable plans, rulesets, revisions, or history.

## Approval Blockers

- Resolve `docs/OPEN-QUESTIONS.md` T-4 before approval, including its durable-architecture and shared-enum approvals and verification/rules review if the decision retires or redefines `COVERAGE_GAP`.
- Approve the scope-support decision table/reason taxonomy and atomic OpenAPI/JSON Schema/type handoff.
- Obtain all affected lane-owner approval for the shared enum.
- Approve F-701, F-702, and F-703, and name with F-703 the classification and scope-support read permissions `F109-AC-06` checks. That criterion checks a permission no approved artifact defines today and may not invent one, so until the matrix names them it is testable only at the membership level stated there.
- Assign the owner and independent reviewer, approve this spec, and add it to `docs/BASELINE.md`.
