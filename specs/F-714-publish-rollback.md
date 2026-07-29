# F-714 · Rules Admin: Publish and Rollback

**Status:** PROPOSED (2026-07-26) — ready for review; not implementable until approved and listed in `docs/BASELINE.md`.

**Phase:** 4 · **Issue:** [#67](https://github.com/jzeng151/pop-engine/issues/67) · **Owner:** TBD · **Reviewer:** product owner plus affected architecture, contract, security, and lane owners (TBD) · **Approval date:** —

## Purpose and User Outcome

Authorized independent reviewers can atomically publish one immutable ruleset artifact or move the current pointer back to a prior immutable artifact while historical plans retain their original versions.

## Scope

**In scope**

- Verify approvals, schema, full F-712 run, version, checksum, changelog, sources, and artifact bytes before atomic publication.
- Advance the jurisdiction current pointer in one transaction and record publication/rollback reason, actors, and prior/new versions.
- Rollback by pointer movement only; never mutate or delete an artifact.

**Non-goals**

- Editing rules, overwriting artifacts, auto-approval, deleting history, re-evaluating old plans, or one-person regulatory publication.
- Database rules as a second runtime truth.

## Dependencies and Baseline

- F-710/F-711/F-712/F-713 contracts, F-703 separate rules-admin roles, and `DOCUMENTATION-GOVERNANCE.md` §6 approvals.
- Approved artifact storage, pointer transaction, signing/checksum, deployment cache, and recovery runbook.
- Baseline at draft time: PRD, Roadmap, Design, and Phase 0–1.5 Architecture approved 2026-07-22; `ARCHITECTURE-FUTURE.md` approved as a planning target 2026-07-25; NYC ruleset `nyc.v2.7`, rules schema `popengine-rules/v2`, and scenario fixtures v5 where regulatory output is consumed.
- The approval PR must re-pin any baseline version that changes before approval. A proposed or superseded input blocks implementation.

## Inputs, Outputs, State, Validation, and Errors

- Input is an exact approved candidate or prior artifact, the expected current artifact checksum, and reason; output is immutable publish/rollback record and atomic current-pointer change.
- State is review-ready → approved → publishing → published or failed; any changed input invalidates approval.
- Failure before commit leaves the old pointer active; failure after commit is reconciled from the authoritative transaction, never guessed.
- Missing or unresolved material data stays visibly unset, unknown, pending, or failed as appropriate; it never becomes a successful or complete result.
- Invalid input produces a field or action-specific error without partial mutation. Retriable external failures preserve the user's confirmed state and expose a safe retry.

## UI and Accessibility

- Final confirmation shows jurisdiction, current/new version/checksum, changelog, approvals, full-suite result, and irreversible pointer effect.
- The complete workflow is keyboard operable, uses programmatic labels and visible focus, does not encode status by color alone, and announces asynchronous success or failure.
- Empty, loading, permission-denied, validation, provider-failure, and unavailable states have explicit copy and a safe next action.

## System Impact

| Concern              | Proposed impact                                                                                                                                    |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| API                  | Publish/rollback/record/status operations require narrow platform-admin OpenAPI contracts and idempotency.                                         |
| Schema               | Forward migrations for immutable artifacts/approvals/test links/publish and rollback records/current pointer.                                      |
| Jobs                 | Validation/distribution/cache refresh may use durable jobs; pointer commit remains atomic and authoritative.                                       |
| Providers            | Immutable artifact storage only through approved adapter.                                                                                          |
| Privacy and security | Separation of duties, strong authorization/reauth, immutable audit, checksum verification, idempotency, no mutable artifacts, and incident alerts. |

Exact HTTP, JSON Schema, migration, job, and provider shapes belong in their reviewed machine contracts; this proposal does not authorize parallel local types or edits to merged migrations.

## Acceptance Criteria

1. **F714-AC-01:** Publication rejects unless the exact candidate checksum has required independent approvals and a passing full F-712 suite.
2. **F714-AC-02:** A successful transaction stores the immutable artifact/metadata and compare-and-swap advances exactly one jurisdiction pointer from the expected current checksum atomically with an audit record.
3. **F714-AC-03:** Retrying the same publish/rollback request is idempotent; a partial failure cannot expose an unrecorded pointer.
4. **F714-AC-04:** Rollback rejects unless the exact prior artifact checksum has explicit authorization and the required independent approval; success records the reason/actors, moves only the pointer, and never edits or deletes either artifact.
5. **F714-AC-05:** Historical plans continue resolving their pinned ruleset/revision and are never silently re-evaluated after publish or rollback.
6. **F714-AC-06:** Publication or rollback rejects when the jurisdiction pointer no longer matches the request's expected current checksum; concurrent requests from one predecessor cannot both advance the pointer or produce a non-linear artifact history.

## Fixtures and Verification

- Planned automated fixture IDs are the acceptance IDs above; each must map one-to-one to a runnable test before approval can claim implementation readiness.
- Regulatory fixtures: Full approved suite for candidate bytes plus transaction failure, idempotency, concurrent publication, stale-current rejection, publication and rollback approval separation, cache refresh, and historical replay fixtures.
- Security-sensitive and cross-workspace paths require negative authorization tests; provider paths require success, duplicate-delivery, retry, invalid-signature, and permanent-failure tests where applicable.

## Allowed Footprint and Coordination

- `apps/web` and `apps/api` feature code and tests.
- New ordered forward migrations and approved OpenAPI/JSON Schema changes required by this feature.
- No repository restructuring, speculative package, or unrelated feature edit.
- Shared contracts, migrations, provider adapters, engine/rules artifacts, consent policy, and cross-lane UI primitives require the approvals named in `docs/DOCUMENTATION-GOVERNANCE.md` §6.

## Rollout and Fallback

- Keep git publication as fallback until dual-run evidence proves artifact/checksum/pointer/replay equivalence and the owner explicitly cuts over.
- Rollback disables the new surface and workers/provider calls without deleting confirmed user data or rewriting immutable plans, rulesets, revisions, or history.

## Approval Blockers

- Approve separation-of-duties matrix, artifact/pointer transaction, cache/recovery runbook, reauthentication, and git cutover.
- Assign the owner and independent reviewer, approve this spec, and add it to `docs/BASELINE.md`.
