# F-109 · Coverage-State Classification

**Status:** PROPOSED (2026-07-26) — ready for review; not implementable until approved and listed in `docs/BASELINE.md`.

**Phase:** 4 · **Issue:** [#54](https://github.com/jzeng151/pop-engine/issues/54) · **Owner:** TBD · **Reviewer:** product owner plus affected architecture, contract, security, and lane owners (TBD) · **Approval date:** —

## Purpose and User Outcome

PopEngine can tell users whether their described scope is fully supported, partially supported, unsupported, ambiguous, or awaiting information before open-ended intake reaches the rules engine.

## Scope

**In scope**

- Define and carry the five Roadmap coverage states through intake, proposals, evaluation gating, plan/API, and UI.
- Attach machine-readable reasons and user actions without inventing regulatory conclusions.
- Keep coverage status distinct from verdict, finding disposition, verification status, and evaluation error.

**Non-goals**

- Inferring missing regulatory rules, treating partial coverage as complete, replacing tri-state conditions, or grading AI confidence.
- Adding open-ended intake; F-601 consumes this contract.

## Dependencies and Baseline

- Approved shared-enum/type-authority handoff and coverage decision table.
- F-108 where location/authority coverage contributes; F-601 is blocked on F-109.
- Baseline at draft time: PRD, Roadmap, Design, and Phase 0–1.5 Architecture approved 2026-07-22; `ARCHITECTURE-FUTURE.md` approved as a planning target 2026-07-25; NYC ruleset `nyc.v2.7`, rules schema `popengine-rules/v2`, and scenario fixtures v5 where regulatory output is consumed.
- The approval PR must re-pin any baseline version that changes before approval. A proposed or superseded input blocks implementation.

## Inputs, Outputs, State, Validation, and Errors

- Inputs are confirmed structured scope plus registry/ruleset jurisdiction coverage metadata; output is exactly one coverage state with reasons.
- State may change only when confirmed inputs or versioned coverage artifacts change; history pins the prior result.
- Ambiguous and awaiting-information remain non-terminal; unsupported and partial never produce a complete-plan claim.
- Missing or unresolved material data stays visibly unset, unknown, pending, or failed as appropriate; it never becomes a successful or complete result.
- Invalid input produces a field or action-specific error without partial mutation. Retriable external failures preserve the user's confirmed state and expose a safe retry.

## UI and Accessibility

- Coverage state, reason, missing information, and safe next action appear before evaluation and beside any partial output; wording is not color-only.
- The complete workflow is keyboard operable, uses programmatic labels and visible focus, does not encode status by color alone, and announces asynchronous success or failure.
- Empty, loading, permission-denied, validation, provider-failure, and unavailable states have explicit copy and a safe next action.

## System Impact

| Concern              | Proposed impact                                                                                                                       |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| API                  | Add the five-state enum/reasons to approved OpenAPI/JSON Schema and generated shared types atomically.                                |
| Schema               | Shared enum/schema change requires all affected lane owners; persistence stores state, reasons, input revision, and artifact version. |
| Jobs                 | None.                                                                                                                                 |
| Providers            | None; provider confidence from F-108 is an input, not coverage authority.                                                             |
| Privacy and security | No sensitive intake values in reason telemetry; rate limits apply to classification/evaluation.                                       |

Exact HTTP, JSON Schema, migration, job, and provider shapes belong in their reviewed machine contracts; this proposal does not authorize parallel local types or edits to merged migrations.

## Acceptance Criteria

1. **F109-AC-01:** The only coverage states are the four `ARCHITECTURE-FUTURE.md` §7.1 publishes — `COMPLETE_WITHIN_VALIDATED_COVERAGE`, `CONDITIONAL`, `CANNOT_DETERMINE`, and `OUTSIDE_VALIDATED_COVERAGE` — in every contract and UI. This spec does not define its own vocabulary: §7.1 is the approved enum, and a second set of state names in a spec that classifies coverage would put two incompatible vocabularies in the same contract. UI copy may render a state in plain language, but the state itself is one of the four.
2. **F109-AC-02:** The approved decision table maps the same confirmed input/artifact versions to the same state/reasons deterministically.
3. **F109-AC-03:** Partial, unsupported, ambiguous, or awaiting-information output cannot be labeled a complete permit plan.
4. **F109-AC-04:** Coverage state remains distinct from feasibility verdict, rule verification status, finding disposition, and evaluation failure.
5. **F109-AC-05:** Unknown or failed classification cannot fall back to fully supported.

## Fixtures and Verification

- Planned automated fixture IDs are the acceptance IDs above; each must map one-to-one to a runnable test before approval can claim implementation readiness.
- Regulatory fixtures: Add independently reviewed coverage fixtures for every state/reason branch; existing scenarios A–F must remain fully classified under their approved structured scope.
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

- Approve the coverage decision table/reason taxonomy and atomic OpenAPI/JSON Schema/type handoff.
- Obtain all affected lane-owner approval for the shared enum.
- Assign the owner and independent reviewer, approve this spec, and add it to `docs/BASELINE.md`.
