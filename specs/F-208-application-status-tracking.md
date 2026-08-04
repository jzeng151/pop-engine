# F-208 · Application Status Tracking

**Status:** PROPOSED (2026-07-26) — ready for review; not implementable until approved and listed in `docs/BASELINE.md`.

**Phase:** 2 · **Issue:** [#17](https://github.com/jzeng151/pop-engine/issues/17) · **Owner:** TBD · **Reviewer:** product owner plus affected architecture, contract, security, and lane owners (TBD) · **Approval date:** —

## Purpose and User Outcome

An organizer can record what happened after filing—application number, agency state, revisions, inspection, decision, and conditions—without changing the immutable permit plan.

## Scope

**In scope**

- Create a tracked application from a checklist requirement, or record an unexpected agency-requested application/requirement with explicit user confirmation and source provenance, then record submitted date, agency-provided identifier/state/deadline, revisions, inspections, decision, and conditions.
- Preserve a timestamped history of confirmed application changes.
- Keep agency-entered text visibly user-recorded unless backed by a published rule.

**Non-goals**

- Agency portal submission, scraping, guaranteed agency status sync, or interpreting a condition as legal advice.
- Fees and document accounting owned by F-209.

## Dependencies and Baseline

- F-202 checklist and the F-701/F-702/F-703 production gate.
- Approved application state vocabulary and forward migration.
- Baseline at draft time: PRD, Roadmap, Design, and Phase 0–1.5 Architecture approved 2026-07-22; `ARCHITECTURE-FUTURE.md` approved as a planning target 2026-07-25; NYC ruleset `nyc.v2.7`, rules schema `popengine-rules/v2`, and scenario fixtures v5 where regulatory output is consumed.
- The approval PR must re-pin any baseline version that changes before approval. A proposed or superseded input blocks implementation.

## Inputs, Outputs, State, Validation, and Errors

- Inputs are either a checklist item or a user-confirmed unexpected agency request with source provenance, plus user-confirmed agency facts; outputs are an application record and append-only application events.
- A correction appends a new event and preserves the prior value; deletion is archival, not history erasure.
- Unknown agency status, missing decision date, or conflicting correspondence remains explicit and never marks a requirement complete.
- Missing or unresolved material data stays visibly unset, unknown, pending, or failed as appropriate; it never becomes a successful or complete result.
- Invalid input produces a field or action-specific error without partial mutation. Retriable external failures preserve the user's confirmed state and expose a safe retry.

## UI and Accessibility

- Timeline entries distinguish user-entered, imported, and later AI-proposed values; conditions are readable without implying PopEngine verification.
- The complete workflow is keyboard operable, uses programmatic labels and visible focus, does not encode status by color alone, and announces asynchronous success or failure.
- Empty, loading, permission-denied, validation, provider-failure, and unavailable states have explicit copy and a safe next action.

## System Impact

| Concern              | Proposed impact                                                                                                                  |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| API                  | Application and application-event operations require an approved OpenAPI contract.                                               |
| Schema               | Forward migrations for applications and immutable application events linked to checklist items/findings.                         |
| Jobs                 | None for manual tracking; later provider/ingestion updates enter as proposals through F-603/F-604.                               |
| Providers            | None.                                                                                                                            |
| Privacy and security | Workspace authorization covers records, exports, and attachments; application identifiers and conditions are excluded from logs. |

Exact HTTP, JSON Schema, migration, job, and provider shapes belong in their reviewed machine contracts; this proposal does not authorize parallel local types or edits to merged migrations.

## Acceptance Criteria

1. **F208-AC-01:** A checklist requirement can create at most the explicitly supported application records linked to its immutable finding; an application absent from the plan requires an explicit user-confirmed unexpected-requirement action with agency-source provenance, remains labeled user-recorded/non-regulatory, and cannot mutate the plan or ruleset. Creation claims that limit as a slot: the creating transaction inserts a unique key over the checklist requirement, its immutable finding, and the record's position within the approved supported count, enforced by a database uniqueness constraint, so two concurrent creations from one requirement commit exactly one record and reject the other. AC-06's replay identity is not that enforcement; two tabs send two distinct request identities, which are not retries of each other, so replay idempotency would let both creations succeed. The creation also names the exact plan/checklist generation it read the requirement from and compare-and-swaps that generation in the same transaction: if the plan was regenerated while the creation was in flight, so that the requirement no longer exists in the current generation or was superseded by a different one, the creation is rejected in full and returned for review rather than committing. The uniqueness constraint above does not reach this case, because it is keyed on the requirement and its immutable finding, both of which a stale in-flight creation still presents intact; only comparing the generation distinguishes a requirement that is still current from one the current plan no longer carries. Without it a creation commits as plan-backed against a requirement that is gone at commit time, while this criterion requires an application absent from the plan to take the explicitly confirmed, source-provenanced unexpected-requirement path instead. The rejected actor reloads the current checklist and either re-creates against the still-current requirement or takes that unexpected-requirement path.
2. **F208-AC-02:** Recording or correcting an application identifier, agency state, agency-provided deadline, submission, revision, inspection, decision, or condition validates the typed value, appends history, and updates the projection atomically. A deadline change commits its generation/transactional outbox invalidation in that transaction, and reminder/calendar workers recheck the generation before side effects.
3. **F208-AC-03:** A correction preserves the previous value and actor; no edit rewrites plan evidence.
4. **F208-AC-04:** Unknown or conflicting agency state remains visible and cannot auto-complete the checklist requirement.
5. **F208-AC-05:** Cross-workspace access and unauthorized role mutations fail without disclosing record existence.
6. **F208-AC-06:** Application creation and every history mutation bind a stable client-supplied request identity to the original result, committed with it under a uniqueness constraint scoped to the Event; replay returns that result without duplicating history, projection changes, deadline generations, or downstream work. Every history mutation also compare-and-swaps the expected application/projection version; a mismatch rejects the whole mutation before appending history or advancing any downstream generation. That identity binds its operands under the rule `F411-AC-08` states once for every client-supplied identity on this branch: it is committed together with the request fields that determine the recorded result, including every aggregate, version, and generation the request names, and a later request presenting the same identity with any different operand is refused as a conflict rather than being answered with the stored result. The identity is still the key and the operands are only a precondition on reusing it, so this is not the content uniqueness this criterion already forbids.

## Fixtures and Verification

- Planned automated fixture IDs are the acceptance IDs above; each must map one-to-one to a runnable test before approval can claim implementation readiness.
- Regulatory fixtures: Use synthetic application histories attached to approved scenario findings; no fixture may invent an agency status or condition.
- Security-sensitive and cross-workspace paths require negative authorization tests; provider paths require success, duplicate-delivery, retry, invalid-signature, and permanent-failure tests where applicable.

## Allowed Footprint and Coordination

- `apps/web` and `apps/api` feature code and tests.
- New ordered forward migrations and approved OpenAPI/JSON Schema changes required by this feature.
- No repository restructuring, speculative package, or unrelated feature edit.
- Shared contracts, migrations, provider adapters, engine/rules artifacts, consent policy, and cross-lane UI primitives require the approvals named in `docs/DOCUMENTATION-GOVERNANCE.md` §6.

## Rollout and Fallback

- Begin with manual confirmed entry; automated ingestion stays disabled until F-603/F-604 are separately approved.
- Rollback disables the new surface and workers/provider calls without deleting confirmed user data or rewriting immutable plans, rulesets, revisions, or history.

## Approval Blockers

- Approve application state vocabulary, history semantics, API, and migrations.
- Assign the owner and independent reviewer, approve this spec, and add it to `docs/BASELINE.md`.
