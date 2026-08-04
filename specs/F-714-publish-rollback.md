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

- Publication input is an exact approved candidate with its declared predecessor plus the expected current artifact and lineage-tip checksums; rollback input is an exact prior artifact plus the expected current checksum. Output is an immutable publish/rollback record and atomic pointer change.
- State is review-ready → approved → publishing → published or failed; any changed input invalidates approval.
- Distribution state is pending → effective, partially distributed, or failed; evaluators resolve the authoritative pointer to an exact checksum-keyed artifact and never treat a stale `current` cache entry as authoritative.
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
| Schema               | Forward migrations for immutable artifacts/approvals/test links/publish and rollback records/current and append-only lineage-tip pointers.         |
| Jobs                 | Validation/distribution/cache refresh may use durable jobs; pointer commit remains atomic and authoritative.                                       |
| Providers            | Immutable artifact storage only through approved adapter.                                                                                          |
| Privacy and security | Separation of duties, strong authorization/reauth, immutable audit, checksum verification, idempotency, no mutable artifacts, and incident alerts. |

Exact HTTP, JSON Schema, migration, job, and provider shapes belong in their reviewed machine contracts; this proposal does not authorize parallel local types or edits to merged migrations.

## Acceptance Criteria

1. **F714-AC-01:** Publication rejects unless the exact candidate checksum has required independent approvals and a passing full F-712 suite matching the deployed engine/schema/calendar contracts and current approved fixture set; any context change invalidates approval.
2. **F714-AC-02:** A successful publication stores the immutable artifact/metadata and compare-and-swaps the expected current rules checksum, expected lineage-tip checksum, and complete approved engine/schema/calendar/fixture/approval gate context before atomically advancing both jurisdiction pointers to the candidate with one audit record; any concurrent context change rejects publication.
3. **F714-AC-03:** The publication and rollback requests each carry a stable client-supplied idempotency identity, committed in the same transaction as the artifact, pointer, and audit records, under a uniqueness constraint scoped to the jurisdiction. A recognized retry is the one presenting an identity already committed: it is resolved before any current-pointer validation and returns that request's original immutable result, and a partial failure cannot expose an unrecorded pointer. A deliberately new publication or rollback sends a new identity. This is request identity, never content uniqueness: a candidate checksum is not a retry key, because AC-08 already decides on its own terms whether a checksum may be published again.

   The identity has to exist on the client before the pointer transaction commits, or the criterion promises recognition it cannot perform. Committing it with the records is what makes the retry recognizable at all: if the transaction succeeds and its response is lost, a retry with no committed identity is indistinguishable from a genuinely new publication, so AC-02 and AC-06 compare it against a pointer that has already moved and it fails the checks rather than returning the result it actually achieved. Rollback carries the same identity rule, so a lost rollback response cannot be retried into a second pointer move with a second reason record.

4. **F714-AC-04:** Rollback rejects unless the exact prior artifact checksum has explicit authorization, the required independent approval, and a passing current F-712 compatibility/full-suite run for the deployed engine, schema, and calendar contracts or an explicitly selected preserved compatible runtime. Success records the reason/actors and atomically moves only the current rules pointer plus authoritative runtime selection when a preserved runtime is required; the lineage tip remains unchanged, and neither artifact is edited or deleted.
5. **F714-AC-05:** Historical plans continue resolving their pinned ruleset/revision and are never silently re-evaluated after publish or rollback.
6. **F714-AC-06:** A genuinely new publication rejects when either jurisdiction pointer no longer matches its expected checksum; rollback rejects when the current pointer no longer matches its expected checksum. Concurrent requests from one predecessor cannot both advance the lineage tip or produce a non-linear artifact history.
7. **F714-AC-07:** After pointer commit, runtime selection uses the authoritative pointer's exact artifact checksum; if that artifact is unavailable, evaluation fails visibly rather than serving an older artifact as current, and publication cannot report effective until required evaluator/cache checks confirm the checksum.
8. **F714-AC-08:** Publication rejects a candidate already present in the jurisdiction artifact lineage and any candidate whose declared predecessor is not the current lineage tip. Rollback never changes that tip: after a rollback, a new candidate declares the unchanged tip as predecessor while separately compare-and-swapping the rolled-back current pointer; success atomically moves both pointers to the candidate. Selecting a prior artifact or otherwise moving only the current pointer backward must use the rollback path and satisfy AC-04.

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
