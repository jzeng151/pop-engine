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

- F-202 checklist and the F-701/F-702/F-703 production gate. F-702 supplies the workspace membership boundary the tracked application and its Event resolve against and F-703 supplies the permission matrix `F208-AC-07` checks; F-701 supplies the authenticated actor both read from. All three are PROPOSED, so the gate is not an approved input today and this spec is not implementable against it until they are approved and listed in `docs/BASELINE.md`.
- Approved application state vocabulary and forward migration.
- Baseline at draft time: PRD, Roadmap, Design, and Phase 0–1.5 Architecture approved 2026-07-22; `ARCHITECTURE-FUTURE.md` approved as a planning target 2026-07-25; NYC ruleset `nyc.v2.7`, rules schema `popengine-rules/v2`, and scenario fixtures v5 where regulatory output is consumed.
- Operand binding and replay ordering for client-supplied identities: `specs/F-411-staff-roles-credentialed-entry.md` F411-AC-08 states once, for this whole branch, that a client-supplied identity is committed with the operands that determine its recorded result and that a reuse carrying different operands is a conflict rather than a replay, and that a committed identity is resolved before any version, generation, state, or limit check whose answer the committed operation itself changed, while the acting actor's current authority is re-read at the replay and must still admit the operation before any stored outcome is returned. Every identity criterion below relies on it. F-411 is PROPOSED, so that rule is not an approved input today and this spec is not implementable against it until F-411 is approved or the rule is promoted to an approved shared invariant; F411-AC-08 records both paths.
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
6. **F208-AC-06:** Application creation and every history mutation bind a stable client-supplied request identity to the original result, committed with it under a uniqueness constraint scoped to the Event; replay returns that result without duplicating history, projection changes, deadline generations, or downstream work. Every history mutation also compare-and-swaps the expected application/projection version; a mismatch rejects the whole mutation before appending history or advancing any downstream generation. That identity binds its operands under the rule `F411-AC-08` states once for every client-supplied identity on this branch: it is committed together with the request fields that determine the recorded result, including every aggregate, version, and generation the request names, and a later request presenting the same identity with any different operand is refused as a conflict rather than being answered with the stored result. The identity is still the key and the operands are only a precondition on reusing it, so this is not the content uniqueness this criterion already forbids. That identity is resolved in the order `F411-AC-08` states once for every client-supplied identity on this branch, applied here rather than restated: a request presenting an already committed identity is resolved from that record before the version, generation, state, and limit checks this criterion requires, and returns the outcome that request originally recorded, because the commit the retry repeats is exactly what moved the state those checks read. The acting actor's current authority is not among the checks the identity is resolved past: the authority this feature requires for a first attempt is re-read server-side at the replay, and the stored outcome is returned only if it still admits the operation, so a replay presented after that authority is gone is refused and discloses no more than a first request would; the only exception is authority the committed operation itself removed, which `F411-AC-08` states once for this branch. A request whose identity resolves to no committed outcome is then held to every one of them, and a request refused by one of them commits no identity, so re-presenting it later is a first attempt and not a replay.
7. **F208-AC-07:** Every operation this feature defines names the application it acts on and the workspace that owns it, and is admitted only by the acting actor's current F-702 membership of that workspace together with the F-703 permission approved for the action, both re-read server-side from stored membership and role at the moment of the operation and, for a write, inside the same transaction that commits it. That covers application creation and the user-confirmed unexpected-requirement creation under F208-AC-01, recording or correcting an application identifier, agency state, agency-provided deadline, submission, revision, inspection, decision, or condition under F208-AC-02, corrections under F208-AC-03, the replay-identity mutations under F208-AC-06, and every read of the application record, its timeline and history, and its projection. F208-AC-05 remains the non-disclosure rule this criterion composes with: AC-05 states that a failed cross-workspace access or unauthorized role mutation discloses no record existence, and this criterion supplies the current-authority re-read at each operation that decides whether the request fails at all. A request failing the check is refused before any durable write and before any application identifier, agency state, deadline, condition, or history entry is disclosed, and per AC-05 its response does not distinguish an application that does not exist from one the actor may not see. The check is at the operation and not at session start or workspace switch, so authority removed while a request is in flight causes that request to fail rather than commit.

   Without this criterion AC-01 through AC-04 and AC-06 all pass for a caller who names another workspace's application. They fix the creation slot and generation compare-and-swap, the typed validation and atomic history append, the preservation of prior values, the visibility of unknown agency state, and the replay identity, and not one of them asks who the actor is at the moment of the operation; AC-05 states that unauthorized access fails but not what authority is read, when, or from where, so a check made once at session start would satisfy its words while admitting an actor whose membership was revoked mid-session. The surface that gap leaves open reads another organizer's application identifiers, agency correspondence state, and conditions, and writes history events into their record.

   One input this criterion needs is not established by any approved artifact today and is not invented here. F-703 is PROPOSED and names no role set, so the permission above cannot be named. Until F-703 is approved this criterion is testable only as "every application read and mutation is refused unless the acting actor holds an active membership of the workspace that owns the named application, read server-side at that operation, and a refusal discloses nothing about whether that application exists", not against a named role or permission identifier. Naming the application tracking read and mutation permissions with F-703 is an approval blocker below.

## Fixtures and Verification

- Planned automated fixture IDs are the acceptance IDs above; each must map one-to-one to a runnable test before approval can claim implementation readiness.
- Regulatory fixtures: Use synthetic application histories attached to approved scenario findings; no fixture may invent an agency status or condition.
- F208-AC-07 includes a fixture in which an actor holding no membership of the owning workspace names a valid application and is refused at creation, at every recording and correction operation, and at every timeline, history, and projection read, with a response that does not distinguish absence from denial, and a fixture in which authority removed while a mutation is in flight fails that request rather than committing.
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
- Approve F-701, F-702, and F-703, and name with F-703 the application tracking read and mutation permissions `F208-AC-07` checks. That criterion checks a permission no approved artifact defines today and may not invent one, so until the matrix names them it is testable only at the membership level stated there.
- Assign the owner and independent reviewer, approve this spec, and add it to `docs/BASELINE.md`.
