# F-407 · Post-Mortem Report

**Status:** PROPOSED (2026-07-26) — ready for review; not implementable until approved and listed in `docs/BASELINE.md`.

**Phase:** 3 · **Issue:** [#40](https://github.com/jzeng151/pop-engine/issues/40) · **Owner:** TBD · **Reviewer:** product owner plus affected architecture, contract, security, and lane owners (TBD) · **Approval date:** —

## Purpose and User Outcome

An organizer can freeze a source-linked post-event report covering attendance versus RSVP, leads, P&L, and permit timeline adherence for later planning.

## Scope

**In scope**

- Assemble approved metrics from attendance, RSVPs, consent-aware leads, F-406, and application/checklist history.
- Show coverage/missing-data notes and source versions for every metric.
- Confirm an immutable post-mortem snapshot consumable by F-104/F-502.

**Non-goals**

- AI narrative, agency scoring, causal claims, benchmarks, recommendations, or filling missing metrics.
- Editing source RSVP, attendance, application, or financial records.

## Dependencies and Baseline

- F-406 plus F-302/F-402/F-403 and F-208 data when present.
- Approved metric definitions and immutable snapshot contract.
- Baseline at draft time: PRD, Roadmap, Design, and Phase 0–1.5 Architecture approved 2026-07-22; `ARCHITECTURE-FUTURE.md` approved as a planning target 2026-07-25; NYC ruleset `nyc.v2.7`, rules schema `popengine-rules/v2`, and scenario fixtures v5 where regulatory output is consumed.
- The approval PR must re-pin any baseline version that changes before approval. A proposed or superseded input blocks implementation.

## Inputs, Outputs, State, Validation, and Errors

- Inputs are exact source versions; output is a draft then confirmed metric snapshot.
- State is draft → stale when source changes → confirmed; confirmed snapshots remain immutable and later corrections create a new version.
- Unavailable, partial, unknown, or incomparable data is labeled and excluded from denominators according to each approved metric definition.
- Missing or unresolved material data stays visibly unset, unknown, pending, or failed as appropriate; it never becomes a successful or complete result.
- Invalid input produces a field or action-specific error without partial mutation. Retriable external failures preserve the user's confirmed state and expose a safe retry.

## UI and Accessibility

- Each metric includes label, value, denominator, source, coverage note, and text trend/variance; print/export preserves this context.
- The complete workflow is keyboard operable, uses programmatic labels and visible focus, does not encode status by color alone, and announces asynchronous success or failure.
- Empty, loading, permission-denied, validation, provider-failure, and unavailable states have explicit copy and a safe next action.

## System Impact

| Concern              | Proposed impact                                                                                   |
| -------------------- | ------------------------------------------------------------------------------------------------- |
| API                  | Post-mortem preview/confirm/read operations require approved OpenAPI contracts.                   |
| Schema               | Forward migration for immutable post-mortem metric snapshots and exact source-version references. |
| Jobs                 | None for deterministic aggregation.                                                               |
| Providers            | None.                                                                                             |
| Privacy and security | Workspace scope and aggregate-only contact metrics; no attendee contact data in the report.       |

Exact HTTP, JSON Schema, migration, job, and provider shapes belong in their reviewed machine contracts; this proposal does not authorize parallel local types or edits to merged migrations.

## Acceptance Criteria

1. **F407-AC-01:** Attendance versus RSVP, consent-aware leads, P&L, and permit-timeline adherence each appear with the approved formula, exact source versions, and coverage, or an explicit unavailable state.
2. **F407-AC-02:** Attendance-versus-RSVP never becomes occupancy unless F-410 both-direction data is the selected source.
3. **F407-AC-03:** Missing/partial data remains labeled and cannot silently change a denominator or appear as zero.
4. **F407-AC-04:** Confirmation atomically compares the complete source-version set and rejects any mismatch; the organizer must rebuild the draft before confirmation. A successful confirmation freezes the report, and later source changes require a new report version.
5. **F407-AC-05:** F-502 consumes only confirmed snapshots and cannot mutate them; F-407 may present eligible same-currency cost lines as organizer-confirmable proposals in F-104's existing user-line shape with exact snapshot/line provenance, without making F-407 an F-104 prerequisite.

## Fixtures and Verification

- Planned automated fixture IDs are the acceptance IDs above; each must map one-to-one to a runnable test before approval can claim implementation readiness.
- Regulatory fixtures: none; this feature does not define regulatory ground truth.
- Security-sensitive and cross-workspace paths require negative authorization tests; provider paths require success, duplicate-delivery, retry, invalid-signature, and permanent-failure tests where applicable.

## Allowed Footprint and Coordination

- `apps/web` and `apps/api` feature code and tests.
- New ordered forward migrations and approved OpenAPI/JSON Schema changes required by this feature.
- No repository restructuring, speculative package, or unrelated feature edit.
- Shared contracts, migrations, provider adapters, engine/rules artifacts, consent policy, and cross-lane UI primitives require the approvals named in `docs/DOCUMENTATION-GOVERNANCE.md` §6.

## Rollout and Fallback

- Only metrics with approved definitions and live source features appear; unavailable sections stay explicit or absent, never simulated.
- Rollback disables the new surface and workers/provider calls without deleting confirmed user data or rewriting immutable plans, rulesets, revisions, or history.

## Approval Blockers

- Approve metric formulas/denominators, source precedence, coverage wording, snapshot retention, and the F-104 snapshot-to-estimate mapping/provenance contract.
- Assign the owner and independent reviewer, approve this spec, and add it to `docs/BASELINE.md`.
