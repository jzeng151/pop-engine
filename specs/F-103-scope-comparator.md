# F-103 · Scope Comparator

**Status:** PROPOSED (2026-07-26) — ready for review; not implementable until approved and listed in `docs/BASELINE.md`.

**Phase:** 3 · **Issue:** [#28](https://github.com/jzeng151/pop-engine/issues/28) · **Owner:** TBD · **Reviewer:** product owner plus affected architecture, contract, security, and lane owners (TBD) · **Approval date:** —

## Purpose and User Outcome

An organizer can compare two event configurations using two complete engine evaluations, seeing permit burden and earliest feasible date without relying on a shortcut or copied finding.

## Scope

**In scope**

- Create or select two complete intake revisions and evaluate both with the same explicit ruleset, holiday calendar, and `today`.
- Compare findings, verdict drivers, unresolved facts, and earliest feasible date side by side.
- Show added, removed, and changed requirements using stable finding identity.

**Non-goals**

- Choosing a winner, optimizing an event automatically, comparing more than two configurations, or estimating venue availability/cost.
- Approximating an evaluation from changed fields instead of running the engine twice.

## Dependencies and Baseline

- F-101, F-201, F-102, F-106 Date Advisor, and approved Event Revisions.
- Stable plan/finding identity and plan-diff contracts from `ARCHITECTURE-FUTURE.md`.
- Baseline at draft time: PRD, Roadmap, Design, and Phase 0–1.5 Architecture approved 2026-07-22; `ARCHITECTURE-FUTURE.md` approved as a planning target 2026-07-25; NYC ruleset `nyc.v2.7`, rules schema `popengine-rules/v2`, and scenario fixtures v5 where regulatory output is consumed.
- The approval PR must re-pin any baseline version that changes before approval. A proposed or superseded input blocks implementation.

## Inputs, Outputs, State, Validation, and Errors

- Inputs are two complete revision snapshots, one organizer-selected shared target month, and identical evaluation context; outputs are two immutable plans and a derived comparison.
- Comparison state is unevaluated → evaluating → comparable, conditional, or failed; one failed evaluation never becomes a favorable comparison.
- Unknown/conflict/research-required findings remain visible on their respective side and in the difference summary.
- Missing or unresolved material data stays visibly unset, unknown, pending, or failed as appropriate; it never becomes a successful or complete result.
- Invalid input produces a field or action-specific error without partial mutation. Retriable external failures preserve the user's confirmed state and expose a safe retry.

## UI and Accessibility

- Side-by-side content has a linear mobile reading order, explicit configuration labels, and text indicators for added/removed/changed findings.
- The complete workflow is keyboard operable, uses programmatic labels and visible focus, does not encode status by color alone, and announces asynchronous success or failure.
- Empty, loading, permission-denied, validation, provider-failure, and unavailable states have explicit copy and a safe next action.

## System Impact

| Concern              | Proposed impact                                                                                                |
| -------------------- | -------------------------------------------------------------------------------------------------------------- |
| API                  | Use approved evaluation/plan APIs; add a comparison resource only if persistence is approved in OpenAPI.       |
| Schema               | No new regulatory schema. Persist only saved comparison references if the approved product need requires them. |
| Jobs                 | None unless measured evaluation cost requires an approved asynchronous path.                                   |
| Providers            | None.                                                                                                          |
| Privacy and security | Both revisions and plans must belong to the active workspace; traces expose no unauthorized source data.       |

Exact HTTP, JSON Schema, migration, job, and provider shapes belong in their reviewed machine contracts; this proposal does not authorize parallel local types or edits to merged migrations.

## Acceptance Criteria

1. **F103-AC-01:** Both configurations evaluate with byte-identical ruleset, calendar, and `today` inputs, producing normal immutable plans.
2. **F103-AC-02:** The comparison identifies each added, removed, and materially changed finding without hiding deduplicated source facets.
3. **F103-AC-03:** Permit burden is derived from typed plan output, and earliest feasible dates come only from F-106 candidate-date evaluations for the same explicit shared target month and engine context; neither value comes from prose parsing or a second rules implementation.
4. **F103-AC-04:** Unknown, conflict, research-required, or evaluation failure remains visible and cannot make a configuration appear better by omission.
5. **F103-AC-05:** Swapping left and right preserves each plan and reverses only directional comparison labels.

## Fixtures and Verification

- Planned automated fixture IDs are the acceptance IDs above; each must map one-to-one to a runnable test before approval can claim implementation readiness.
- Regulatory fixtures: Pair approved scenarios A–F and the approved boundary fixtures; expected plan output remains owned by F-201/F-102.
- Security-sensitive and cross-workspace paths require negative authorization tests; provider paths require success, duplicate-delivery, retry, invalid-signature, and permanent-failure tests where applicable.

## Allowed Footprint and Coordination

- `apps/web` and `apps/api` feature code and tests.
- New ordered forward migrations and approved OpenAPI/JSON Schema changes required by this feature.
- No repository restructuring, speculative package, or unrelated feature edit.
- Shared contracts, migrations, provider adapters, engine/rules artifacts, consent policy, and cross-lane UI primitives require the approvals named in `docs/DOCUMENTATION-GOVERNANCE.md` §6.

## Rollout and Fallback

- Start with ephemeral comparisons; save comparison records only after a retained-history use case is approved.
- Rollback disables the new surface and workers/provider calls without deleting confirmed user data or rewriting immutable plans, rulesets, revisions, or history.

## Approval Blockers

- Approve Event Revision, finding-identity, plan-diff, and F-106 earliest-feasible-date contracts.
- Assign the owner and independent reviewer, approve this spec, and add it to `docs/BASELINE.md`.
