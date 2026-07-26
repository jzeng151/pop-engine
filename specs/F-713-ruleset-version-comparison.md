# F-713 · Rules Admin: Ruleset Version Comparison

**Status:** PROPOSED (2026-07-26) — ready for review; not implementable until approved and listed in `docs/BASELINE.md`.

**Phase:** 4 · **Issue:** [#66](https://github.com/jzeng151/pop-engine/issues/66) · **Owner:** TBD · **Reviewer:** product owner plus affected architecture, contract, security, and lane owners (TBD) · **Approval date:** —

## Purpose and User Outcome

Rules reviewers can compare two immutable ruleset versions by stable identity and see structural and semantic field changes without guessing their user impact.

## Scope

**In scope**

- Diff metadata/config/intake/rule/advisory/source/verification facets using `(ruleset_version, rule_id)` lineage and stable field paths.
- Show added, removed, and changed data plus linked F-712 result differences when available.
- Export a bounded machine-readable/human-readable diff with exact checksums.

**Non-goals**

- Editing, publishing, declaring semantic equivalence, legal interpretation, or generating changelog claims without review.
- Diffing arbitrary unvalidated JSON as a ruleset.

## Dependencies and Baseline

- Immutable published artifact storage, F-712 results where impact is shown, and approved stable identity/diff rules.
- Both compared artifacts must validate under their recorded schemas.
- Baseline at draft time: PRD, Roadmap, Design, and Phase 0–1.5 Architecture approved 2026-07-22; `ARCHITECTURE-FUTURE.md` approved as a planning target 2026-07-25; NYC ruleset `nyc.v2.7`, rules schema `popengine-rules/v2`, and scenario fixtures v5 where regulatory output is consumed.
- The approval PR must re-pin any baseline version that changes before approval. A proposed or superseded input blocks implementation.

## Inputs, Outputs, State, Validation, and Errors

- Inputs are two exact immutable artifact versions/checksums; output is deterministic structured diff.
- Comparison state is valid, incompatible-schema, missing-artifact, or failed; missing/invalid input never produces no changes.
- Field changes are reported as data; user-visible/evaluated impact is shown only from an actual linked test run.
- Missing or unresolved material data stays visibly unset, unknown, pending, or failed as appropriate; it never becomes a successful or complete result.
- Invalid input produces a field or action-specific error without partial mutation. Retriable external failures preserve the user's confirmed state and expose a safe retry.

## UI and Accessibility

- Diff supports keyboard navigation/filtering, text add/remove/change labels, source/status context, and exact version/checksum headers.
- The complete workflow is keyboard operable, uses programmatic labels and visible focus, does not encode status by color alone, and announces asynchronous success or failure.
- Empty, loading, permission-denied, validation, provider-failure, and unavailable states have explicit copy and a safe next action.

## System Impact

| Concern              | Proposed impact                                                                                                  |
| -------------------- | ---------------------------------------------------------------------------------------------------------------- |
| API                  | Artifact comparison/result operations require platform-admin OpenAPI contracts.                                  |
| Schema               | No new regulatory schema; persist comparison artifacts only if audit/approval requires them.                     |
| Jobs                 | None for bounded artifacts; asynchronous diff only if measured size requires it.                                 |
| Providers            | None.                                                                                                            |
| Privacy and security | Rules-admin read scope, immutable artifact verification, bounded parsing, no dynamic execution, and safe export. |

Exact HTTP, JSON Schema, migration, job, and provider shapes belong in their reviewed machine contracts; this proposal does not authorize parallel local types or edits to merged migrations.

## Acceptance Criteria

1. **F713-AC-01:** The comparison verifies and displays both exact versions/checksums before diffing.
2. **F713-AC-02:** Added, removed, and changed registry/rule/advisory/source/verification/config fields are deterministically keyed and path-addressable.
3. **F713-AC-03:** Missing, invalid, checksum-mismatched, or incompatible artifacts produce an explicit failure and never 'no changes'.
4. **F713-AC-04:** The UI makes no evaluated/user-impact claim unless linked F-712 runs for the exact artifacts demonstrate it.
5. **F713-AC-05:** Swapping versions preserves changed values and reverses only before/after and add/remove direction.

## Fixtures and Verification

- Planned automated fixture IDs are the acceptance IDs above; each must map one-to-one to a runnable test before approval can claim implementation readiness.
- Regulatory fixtures: Known immutable artifact pairs covering add/remove/change, schema-version mismatch, checksum failure, and no-change.
- Security-sensitive and cross-workspace paths require negative authorization tests; provider paths require success, duplicate-delivery, retry, invalid-signature, and permanent-failure tests where applicable.

## Allowed Footprint and Coordination

- `apps/web` and `apps/api` feature code and tests.
- New ordered forward migrations and approved OpenAPI/JSON Schema changes required by this feature.
- No repository restructuring, speculative package, or unrelated feature edit.
- Shared contracts, migrations, provider adapters, engine/rules artifacts, consent policy, and cross-lane UI primitives require the approvals named in `docs/DOCUMENTATION-GOVERNANCE.md` §6.

## Rollout and Fallback

- Compute on demand; retain a diff only when linked to review/publish evidence.
- Rollback disables the new surface and workers/provider calls without deleting confirmed user data or rewriting immutable plans, rulesets, revisions, or history.

## Approval Blockers

- Approve stable identity/path diff rules, schema compatibility policy, export format, and impact wording.
- Assign the owner and independent reviewer, approve this spec, and add it to `docs/BASELINE.md`.
