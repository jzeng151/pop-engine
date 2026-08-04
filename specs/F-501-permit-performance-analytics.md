# F-501 · Permit Performance Analytics

**Status:** PROPOSED (2026-07-26) — ready for review; not implementable until approved and listed in `docs/BASELINE.md`.

**Phase:** 3 · **Issue:** [#46](https://github.com/jzeng151/pop-engine/issues/46) · **Owner:** TBD · **Reviewer:** product owner plus affected architecture, contract, security, and lane owners (TBD) · **Approval date:** —

## Purpose and User Outcome

A workspace can review late submissions, revisions, unexpected requirements, and delays across retained events using defined metrics and explicit data coverage.

## Scope

**In scope**

- Workspace-scoped aggregate metrics from confirmed application/checklist histories and immutable plan snapshots.
- Filter by approved dimensions and drill back to source events without exposing other workspaces.
- Freeze metric definition/version and coverage with each report snapshot.

**Non-goals**

- Predictive approval odds, agency rankings, causation, benchmarking other customers, or regulatory guarantees.
- Inferring missing submission/decision dates.

## Dependencies and Baseline

- F-208 retained application history, F-702 workspace boundary, and approved metric definitions.
- F-407 confirmed post-mortem metric snapshots, upstream of this feature under the canonical build order `F-104 → F-406 → F-407 → F-501/F-502` (`docs/DESIGN.md` Dependency Graph). F-501 reads only a confirmed snapshot version (F-407's per-event current confirmed pointer, or an explicitly selected older confirmed version that stays labeled historical) and creates, mutates, or supersedes no **F-407-owned outcome** snapshot. Its own report snapshots under F501-AC-05 are unaffected: narrowed 2026-08-03 because the prohibition had been written to cover any metric snapshot, which AC-05 requires F-501 to publish and the System Impact section permits, so the spec could not be implemented as written.
- F-704 supplies broader action history only where a metric explicitly needs it.
- Baseline at draft time: PRD, Roadmap, Design, and Phase 0–1.5 Architecture approved 2026-07-22; `ARCHITECTURE-FUTURE.md` approved as a planning target 2026-07-25; NYC ruleset `nyc.v2.7`, rules schema `popengine-rules/v2`, and scenario fixtures v5 where regulatory output is consumed.
- The approval PR must re-pin any baseline version that changes before approval. A proposed or superseded input blocks implementation.

## Inputs, Outputs, State, Validation, and Errors

- Inputs are authorized filters plus confirmed source records, including only F-208's explicit user-confirmed unexpected-requirement records for that classification, and a stable request identity on each export creation under F501-AC-07 and on each refresh under F501-AC-05; outputs are aggregates with numerator, denominator, coverage, and metric version.
- Reports are computed or snapshotted from immutable sources; corrected inputs produce a new result version.
- Missing/unknown/conflicting dates are excluded or classified exactly by the metric definition, never silently treated as on time.
- Missing or unresolved material data stays visibly unset, unknown, pending, or failed as appropriate; it never becomes a successful or complete result.
- Invalid input produces a field or action-specific error without partial mutation. Retriable external failures preserve the user's confirmed state and expose a safe retry.

## UI and Accessibility

- Every chart/table has a text summary, metric definition, denominator, date range, coverage, source links, and no color-only encoding.
- The complete workflow is keyboard operable, uses programmatic labels and visible focus, does not encode status by color alone, and announces asynchronous success or failure.
- Empty, loading, permission-denied, validation, provider-failure, and unavailable states have explicit copy and a safe next action.

## System Impact

| Concern              | Proposed impact                                                                                                     |
| -------------------- | ------------------------------------------------------------------------------------------------------------------- |
| API                  | Analytics query/snapshot/drill-down operations require approved OpenAPI filter and pagination contracts.            |
| Schema               | Use source history; add immutable metric snapshots/read models only by forward migration after measured query need. |
| Jobs                 | Background snapshot refresh only if measured data volume requires it.                                               |
| Providers            | None.                                                                                                               |
| Privacy and security | Strict workspace aggregates/drill-down, minimum cohort policy if needed, no contact data, and safe exports.         |

Exact HTTP, JSON Schema, migration, job, and provider shapes belong in their reviewed machine contracts; this proposal does not authorize parallel local types or edits to merged migrations.

## Acceptance Criteria

1. **F501-AC-01:** Each metric result identifies its formula/version, numerator, denominator, source range, and data-coverage count.
2. **F501-AC-02:** Late submission, revision, and delay classifications use only approved definitions and confirmed source facts; unexpected-requirement classification uses only F-208 records created through its explicit user-confirmed unexpected-requirement path with source provenance.
3. **F501-AC-03:** Missing/unknown/conflicting data cannot silently enter the favorable denominator or appear as zero.
4. **F501-AC-04:** Cross-workspace queries, filters, exports, cached results, and drill-downs disclose no foreign record.
5. **F501-AC-05:** A refresh carries a stable client-supplied request identity, committed with the snapshot it publishes under a uniqueness constraint scoped to the workspace; a retry presenting the same identity is resolved from that committed record and returns the original published snapshot, publishing no second snapshot and enqueuing no second refresh, while a deliberately separate refresh sends a new identity. The generation comparison below rejects an obsolete refresh, not a replay: a retry after a lost response reads the same source generation and the same current pointers and therefore passes that comparison again, so without its own identity one refresh action can publish two analytics snapshots over the same records, each with its own retention clock. A refresh pins the complete source-version set and generation it reads; snapshot publication compare-and-swaps that generation, rejecting an obsolete refresh so it cannot replace a newer correction-derived snapshot. A default refresh additionally captures, for every event it reads, the exact F-407 per-event current confirmed outcome-snapshot pointer it resolved, and publication compare-and-swaps those pointers too: a refresh whose pointer moved before publication is rejected and rebuilt rather than published as current. A pointer advance from snapshot N to N+1 leaves N's immutable source-version set unchanged, so pinning versions alone does not detect it and would publish superseded outcomes as current. An explicitly selected historical confirmed version is still permitted and stays visibly labeled historical; it names its own version and is not compared against the current pointer. A source correction creates a new report/snapshot and preserves the prior version when retention is enabled. That identity binds its operands under the rule `F411-AC-08` states once for every client-supplied identity on this branch: it is committed together with the request fields that determine the recorded result, including every aggregate, version, and generation the request names, and a later request presenting the same identity with any different operand is refused as a conflict rather than being answered with the stored result. The identity is still the key and the operands are only a precondition on reusing it, so this is not the content uniqueness this criterion already forbids.
6. **F501-AC-06:** Every staged analytics export remains private; each download issuance rechecks current workspace membership/role and returns only an authorized streaming response or short-lived signed URL. Authorization loss blocks new access, and an issued direct-storage URL has only bounded validity until expiry.
7. **F501-AC-07:** Creating an export binds the request to a stable client-supplied request identity, committed with the export under a uniqueness constraint scoped to the workspace. A retry presenting the same identity returns the original export and its original artifact, enqueues no second job, and stages no second file; a deliberately separate export sends a new identity. This is request identity, never content uniqueness: two genuinely distinct exports over the same filters and the same pinned snapshot are both produced, and a repeated identity is never rejected as a duplicate value. That identity binds its operands under the rule `F411-AC-08` states once for every client-supplied identity on this branch: it is committed together with the request fields that determine the recorded result, including every aggregate, version, and generation the request names, and a later request presenting the same identity with any different operand is refused as a conflict rather than being answered with the stored result. The identity is still the key and the operands are only a precondition on reusing it, so this is not the content uniqueness this criterion already forbids.

   F501-AC-05 pins and compare-and-swaps the source generation, which rejects an obsolete refresh rather than a replay: a retry reads the same generation and passes that check. When the create transaction commits and its response is lost, the retry stages a second private artifact over the same workspace records, with its own retention clock and its own F501-AC-06 access surface, for one authorized export.

   The operations that write durable state in this feature are snapshot refresh and publication under F501-AC-05 and export creation under this criterion; each binds its own request identity, and the two identities are separate because one refresh may back several exports and one export may be retried without republishing. Download issuance under F501-AC-06 stages no new artifact and creates no snapshot, so it needs no identity of its own; it recomputes authorization on each issuance instead.

## Fixtures and Verification

- Planned automated fixture IDs are the acceptance IDs above; each must map one-to-one to a runnable test before approval can claim implementation readiness.
- Regulatory fixtures: Synthetic multi-event histories reference approved plan findings; analytics expectations are non-regulatory feature fixtures.
- Security-sensitive and cross-workspace paths require negative authorization tests; provider paths require success, duplicate-delivery, retry, invalid-signature, and permanent-failure tests where applicable.

## Allowed Footprint and Coordination

- `apps/web` and `apps/api` feature code and tests.
- New ordered forward migrations and approved OpenAPI/JSON Schema changes required by this feature.
- No repository restructuring, speculative package, or unrelated feature edit.
- Shared contracts, migrations, provider adapters, engine/rules artifacts, consent policy, and cross-lane UI primitives require the approvals named in `docs/DOCUMENTATION-GOVERNANCE.md` §6.

## Rollout and Fallback

- Compute directly first; add materialized snapshots only when measured query latency/data volume requires them.
- Rollback disables the new surface and workers/provider calls without deleting confirmed user data or rewriting immutable plans, rulesets, revisions, or history.

## Approval Blockers

- Approve metric definitions, dimensions/filters, coverage policy, retention, and authorization.
- Assign the owner and independent reviewer, approve this spec, and add it to `docs/BASELINE.md`.
