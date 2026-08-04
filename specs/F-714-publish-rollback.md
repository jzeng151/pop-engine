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
- Operand binding for client-supplied identities: `specs/F-411-staff-roles-credentialed-entry.md` F411-AC-08 states once, for this whole branch, that a client-supplied identity is committed with the operands that determine its recorded result and that a reuse carrying different operands is a conflict rather than a replay. Every identity criterion below relies on it. F-411 is PROPOSED, so that rule is not an approved input today and this spec is not implementable against it until F-411 is approved or the rule is promoted to an approved shared invariant; F411-AC-08 records both paths.
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
3. **F714-AC-03:** The publication and rollback requests each carry a stable client-supplied idempotency identity, committed in the same transaction as the artifact, pointer, and audit records, under a uniqueness constraint scoped to the jurisdiction. A recognized retry is the one presenting an identity already committed: it is resolved before any current-pointer validation and returns that request's original immutable result, and a partial failure cannot expose an unrecorded pointer. A deliberately new publication or rollback sends a new identity. This is request identity, never content uniqueness: a candidate checksum is not a retry key, because AC-08 already decides on its own terms whether a checksum may be published again. That identity binds its operands under the rule `F411-AC-08` states once for every client-supplied identity on this branch: it is committed together with the request fields that determine the recorded result, including every aggregate, version, and generation the request names, and a later request presenting the same identity with any different operand is refused as a conflict rather than being answered with the stored result. The identity is still the key and the operands are only a precondition on reusing it, so this is not the content uniqueness this criterion already forbids.

   The identity has to exist on the client before the pointer transaction commits, or the criterion promises recognition it cannot perform. Committing it with the records is what makes the retry recognizable at all: if the transaction succeeds and its response is lost, a retry with no committed identity is indistinguishable from a genuinely new publication, so AC-02 and AC-06 compare it against a pointer that has already moved and it fails the checks rather than returning the result it actually achieved. Rollback carries the same identity rule, so a lost rollback response cannot be retried into a second pointer move with a second reason record.

4. **F714-AC-04:** Rollback rejects unless the exact prior artifact checksum has explicit authorization, the required independent approval, and a passing current F-712 compatibility/full-suite run for the deployed engine, schema, and calendar contracts or an explicitly selected preserved compatible runtime.

   The request names the exact context that authorization was granted against: the prior artifact checksum, the approval record it was granted under, the F-712 run identity and its recorded result, the deployed engine, schema, calendar, and approved fixture-set versions that run was made against, and the current authoritative runtime selection when a preserved runtime is required. The single transaction that moves the pointer compare-and-swaps every one of those named values, together with the expected current rules checksum required by AC-06 and the lineage tip it must leave unchanged. Any one of them differing from what was reviewed rejects the rollback and mutates nothing, so a re-run or invalidated F-712 result, a redeployed engine or schema, a replaced calendar, a changed fixture set, or a runtime selection that moved since review cannot be committed against. This is what AC-02 already requires of publication; without it the recovery path is the one operation allowed to act on a stale basis.

   Success records the reason/actors and atomically moves only the current rules pointer plus authoritative runtime selection when a preserved runtime is required; the lineage tip remains unchanged, and neither artifact is edited or deleted.

   Comparing the approval the same way needs the approval record to carry a version or explicit revocation state that a superseding decision advances, and no approved artifact establishes one: the separation-of-duties matrix named in Approval Blockers is still unapproved, and this spec does not invent that representation. Until it exists, the compare-and-swap above is implementable for the artifact, run, runtime, schema, calendar, fixture-set, and pointer values, and a rollback approval that was superseded between review and commit stays detectable only by the approving actors. Approving that matrix has to fix the approval-record version and what supersedes it before this criterion can claim to cover the approval too.

5. **F714-AC-05:** Historical plans continue resolving their pinned ruleset/revision and are never silently re-evaluated after publish or rollback.
6. **F714-AC-06:** A genuinely new publication rejects when either jurisdiction pointer no longer matches its expected checksum; rollback rejects when the current pointer no longer matches its expected checksum. Concurrent requests from one predecessor cannot both advance the lineage tip or produce a non-linear artifact history.
7. **F714-AC-07:** After pointer commit, runtime selection uses the authoritative pointer's exact artifact checksum; if that artifact is unavailable, evaluation fails visibly rather than serving an older artifact as current, and publication cannot report effective until required evaluator/cache checks confirm the checksum.
8. **F714-AC-08:** Publication rejects a candidate already present in the jurisdiction artifact lineage and any candidate whose declared predecessor is not the current lineage tip. Rollback never changes that tip: after a rollback, a new candidate declares the unchanged tip as predecessor while separately compare-and-swapping the rolled-back current pointer; success atomically moves both pointers to the candidate. Selecting a prior artifact or otherwise moving only the current pointer backward must use the rollback path and satisfy AC-04.

9. **F714-AC-09:** The transaction that advances either jurisdiction pointer, on publication and on rollback alike, re-reads the acting actor's current platform authority server-side and compare-and-swaps it, and additionally requires an approved fresh-authentication proof bound to that exact publish or rollback confirmation. The proof names the confirmation it was produced for, is verified inside the same transaction that moves the pointer rather than at the start of the flow, and is single use: it authorizes that one pointer move and is consumed by it, so it cannot be carried to a second publication, to a rollback, or to a retry of a different request. A request without a valid unconsumed proof, or whose proof names a different confirmation, is rejected and mutates nothing: no artifact, no pointer, no lineage record, and no audit record beyond the rejection itself. Platform authority lost between the proof and the commit rejects the request on the same terms, because the authority comparison is made at the write and not at session start.

   A recognized AC-03 retry is the one exception, and it is not a second authorization: it presents an identity already committed, returns that request's original immutable result, and moves no pointer, so it consumes no proof and needs none. That ordering is the one AC-03 already states, with the identity resolved before any current-pointer validation.

   This is stated as an acceptance criterion because an implementation is built to the acceptance criteria, and the System Impact table's "strong authorization/reauth" row and the reauthentication item in the Approval Blockers are neither. Without it, AC-01 through AC-08 can all pass on a session's existing role: they compare checksums, approvals, F-712 results, lineage, and pointers, and every one of those comparisons succeeds for a stale, unattended, or stolen platform-admin session once the candidate or rollback already carries its approvals. The result is the most damaging write this system has, a change to the published regulatory ruleset every organizer's plan is evaluated against, reachable without anyone proving they are present.

   The exact fresh-authentication mechanism, its validity window, and what counts as an approved proof are not established by any approved artifact today and this criterion does not invent them; they belong to the reauthentication decision already named in the Approval Blockers. Until that approval names them, this criterion is testable only as "a single-use proof bound to the exact confirmation is verified inside the pointer transaction, a request without one or with one naming a different confirmation mutates nothing, and a proof consumed by one pointer move cannot authorize another," not against a specific mechanism or window.

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

- Approve separation-of-duties matrix, including the approval-record version and supersession rule AC-04 compares, artifact/pointer transaction, cache/recovery runbook, reauthentication, and git cutover. The reauthentication approval must name the mechanism, the validity window, and what constitutes an approved single-use proof, because F714-AC-09 requires one bound to each pointer move and may not invent any of the three.
- Assign the owner and independent reviewer, approve this spec, and add it to `docs/BASELINE.md`.
