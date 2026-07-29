# F-710 · Rules Admin: Rule Editor

**Status:** PROPOSED (2026-07-26) — ready for review; not implementable until approved and listed in `docs/BASELINE.md`.

**Phase:** 4 · **Issue:** [#63](https://github.com/jzeng151/pop-engine/issues/63) · **Owner:** TBD · **Reviewer:** product owner plus affected architecture, contract, security, and lane owners (TBD) · **Approval date:** —

## Purpose and User Outcome

An authorized rules administrator can draft and edit rules as validated data without executing code or changing the published runtime artifact.

## Scope

**In scope**

- Create/edit draft rules through the approved rules JSON Schema/AST, with source links, verification state, validation, and review metadata.
- Preview machine-readable diff and hand off to F-712 testing/F-714 publication.
- Use optimistic concurrency and immutable draft versions.

**Non-goals**

- Publishing, runtime database rules, dynamic code/eval, bypassing primary-source review, or changing verification status without Dev 4.
- Editing an already published immutable artifact.

## Dependencies and Baseline

- F-711 sources, F-703 separate rules-admin role, and approved schema/type authority.
- F-712 testing and F-714 publication are downstream consumers of immutable F-710 draft versions, not prerequisites for draft/edit implementation.
- Verification and engine-owner review for rule semantics.
- Baseline at draft time: PRD, Roadmap, Design, and Phase 0–1.5 Architecture approved 2026-07-22; `ARCHITECTURE-FUTURE.md` approved as a planning target 2026-07-25; NYC ruleset `nyc.v2.7`, rules schema `popengine-rules/v2`, and scenario fixtures v5 where regulatory output is consumed.
- The approval PR must re-pin any baseline version that changes before approval. A proposed or superseded input blocks implementation.

## Inputs, Outputs, State, Validation, and Errors

- Inputs are schema-valid draft fields/AST and source references where the published rules contract requires them; output is a versioned non-published draft.
- Draft state is editing → ready-for-review → changes-requested/approved-for-test; publication remains separate.
- Schema error, unsupported AST, required source missing, conflict, or stale edit blocks progression and never changes runtime output. A source-less `COVERAGE_GAP` draft is allowed only when it matches the published rules contract and asserts no regulatory fact.
- Missing or unresolved material data stays visibly unset, unknown, pending, or failed as appropriate; it never becomes a successful or complete result.
- Invalid input produces a field or action-specific error without partial mutation. Retriable external failures preserve the user's confirmed state and expose a safe retry.

## UI and Accessibility

- Structured controls expose validation at the field/path level, source/status context, diff, version conflict, and keyboard-accessible review.
- The complete workflow is keyboard operable, uses programmatic labels and visible focus, does not encode status by color alone, and announces asynchronous success or failure.
- Empty, loading, permission-denied, validation, provider-failure, and unavailable states have explicit copy and a safe next action.

## System Impact

| Concern              | Proposed impact                                                                                                                               |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| API                  | Rules-draft/version/review operations require platform-admin OpenAPI contracts.                                                               |
| Schema               | Forward migrations for draft metadata/reviews while rule content remains schema-validated artifact data.                                      |
| Jobs                 | None for editing; validation/test handoff may create F-712 jobs.                                                                              |
| Providers            | None.                                                                                                                                         |
| Privacy and security | Separate platform role, strong reauthentication for sensitive actions if approved, audit history, CSRF/rate limits, and no dynamic execution. |

Exact HTTP, JSON Schema, migration, job, and provider shapes belong in their reviewed machine contracts; this proposal does not authorize parallel local types or edits to merged migrations.

## Acceptance Criteria

1. **F710-AC-01:** The editor can represent only the approved rules schema/AST and rejects unknown fields/operators/types before save/readiness.
2. **F710-AC-02:** Every draft version preserves author/time/base artifact/source references and cannot mutate a published artifact.
3. **F710-AC-03:** A stale concurrent save is rejected with a diff/reload path and no lost update.
4. **F710-AC-04:** Verification status changes require the verification owner; semantic rule changes require verification plus engine-owner review.
5. **F710-AC-05:** No draft affects runtime evaluation until F-714 publishes a new immutable approved artifact.
6. **F710-AC-06:** Missing source blocks readiness for every entry except a schema-valid `COVERAGE_GAP` entry that asserts no regulatory fact; that exception matches the runtime artifact validator and has a positive fixture.

## Fixtures and Verification

- Planned automated fixture IDs are the acceptance IDs above; each must map one-to-one to a runnable test before approval can claim implementation readiness.
- Regulatory fixtures: Schema-valid/invalid AST fixtures, approved rule examples, a valid source-less `COVERAGE_GAP` advisory, and a rejected source-less non-`COVERAGE_GAP` entry; every semantic draft requires affected and full suite coverage via F-712.
- Security-sensitive and cross-workspace paths require negative authorization tests; provider paths require success, duplicate-delivery, retry, invalid-signature, and permanent-failure tests where applicable.

## Allowed Footprint and Coordination

- `apps/web` and `apps/api` feature code and tests.
- New ordered forward migrations and approved OpenAPI/JSON Schema changes required by this feature.
- No repository restructuring, speculative package, or unrelated feature edit.
- Shared contracts, migrations, provider adapters, engine/rules artifacts, consent policy, and cross-lane UI primitives require the approvals named in `docs/DOCUMENTATION-GOVERNANCE.md` §6.

## Rollout and Fallback

- Keep git PR authoring as fallback until the full F-710–F-714 flow proves equivalent and is explicitly activated.
- Rollback disables the new surface and workers/provider calls without deleting confirmed user data or rewriting immutable plans, rulesets, revisions, or history.

## Approval Blockers

- Approve draft/review state machine, schema editor mapping, concurrency, role/reauth policy, and git-transition plan.
- Assign the owner and independent reviewer, approve this spec, and add it to `docs/BASELINE.md`.
