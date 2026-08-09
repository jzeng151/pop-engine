# F-704 · Activity History

**Status:** PROPOSED (2026-07-26) — ready for review; not implementable until approved and listed in `docs/BASELINE.md`.

**Phase:** 3 · **Issue:** [#51](https://github.com/jzeng151/pop-engine/issues/51) · **Owner:** TBD · **Reviewer:** product owner · **Approval date:** —

## Purpose and User Outcome

Authorized users can see who changed material answers, recalculated plans, changed rule versions, uploaded files, or changed workflow status without exposing secret content.

## Scope

**In scope**

- Append-only significant activity for the Roadmap actions with actor, scope, aggregate, action, timestamp, and redacted metadata. Workspace activity carries its workspace; jurisdiction-wide rules publication/rollback carries platform scope and jurisdiction instead.
- Filter by event/action/date and link to an authorized source record.
- Represent system, user, provider, and later rules-publication actors distinctly.

**Non-goals**

- Full database change capture, raw request logging, message/document contents, analytics event collection, or undo.
- A second source of domain state.

## Dependencies and Baseline

- The F-701/F-702/F-703 gate and approved activity event vocabulary/redaction policy. F-702 supplies the workspace membership boundary workspace-scoped activity resolves against and F-703 supplies the permission matrix and the separate platform role `F704-AC-07` checks; F-701 supplies the authenticated actor both read from. F-701 is APPROVED (2026-07-28, `docs/BASELINE.md`); F-702 and F-703 remain PROPOSED, so the gate is not an approved input today and this spec is not implementable against it until those two are approved and listed in `docs/BASELINE.md`.
- Consuming features must emit activity in the same transaction as their domain mutation.
- Baseline at draft time: PRD, Roadmap, Design, and Phase 0–1.5 Architecture approved 2026-07-22; `ARCHITECTURE-FUTURE.md` approved as a planning target 2026-07-25; NYC ruleset `nyc.v2.7`, rules schema `popengine-rules/v2`, and scenario fixtures v5 where regulatory output is consumed.
- The approval PR must re-pin any baseline version that changes before approval. A proposed or superseded input blocks implementation.

## Inputs, Outputs, State, Validation, and Errors

- Inputs are successful material domain mutations; output is one append-only activity record with bounded metadata.
- Failed/no-op requests create no success activity; corrections append events and never edit prior entries.
- Unknown actor is a named system/import state, not a fabricated user.
- Missing or unresolved material data stays visibly unset, unknown, pending, or failed as appropriate; it never becomes a successful or complete result.
- Invalid input produces a field or action-specific error without partial mutation. Retriable external failures preserve the user's confirmed state and expose a safe retry.

## UI and Accessibility

- Timeline/filter views state actor type/action/time in text, preserve chronological order, and handle unavailable source links safely.
- The complete workflow is keyboard operable, uses programmatic labels and visible focus, does not encode status by color alone, and announces asynchronous success or failure.
- Empty, loading, permission-denied, validation, provider-failure, and unavailable states have explicit copy and a safe next action.

## System Impact

| Concern              | Proposed impact                                                                                                                                  |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| API                  | Activity query/filter/pagination operations require approved OpenAPI contracts; writes remain internal to domain transactions.                   |
| Schema               | Forward migration for append-only activity log with explicit workspace-or-platform scope, aggregate indexes, and redacted metadata schema.       |
| Jobs                 | Jobs record their own actor/correlation and activity in the same transaction as successful state change.                                         |
| Providers            | None.                                                                                                                                            |
| Privacy and security | Role-scoped reads, tenant filters, strict metadata allow-list, retention, tamper-evident operational controls, and no secrets/PII/document text. |

Exact HTTP, JSON Schema, migration, job, and provider shapes belong in their reviewed machine contracts; this proposal does not authorize parallel local types or edits to merged migrations.

## Acceptance Criteria

1. **F704-AC-01:** Each in-scope successful material action creates one activity record atomically with actor type, exactly one approved scope, aggregate, action, and timestamp; workspace scope requires a workspace, while platform rules publication/rollback requires a jurisdiction and no fabricated workspace.

   The scope is derived from the recorded aggregate rather than supplied beside it. Inside the emitting domain transaction, the workspace or jurisdiction stored on the activity record is read from the aggregate the record references and compared to it, and a record whose scope does not resolve to its aggregate is not written and fails the emitting transaction with it. This criterion as written requires both values and never relates them, which is the shape `F702-AC-10`'s fourth obligation says an existence or currency check does not close: a consuming transaction that records an event-A aggregate with workspace B as its scope satisfies "exactly one approved scope" and "aggregate" independently, and both values name records that really exist. A B timeline then discloses A's actor, action, timestamp, and aggregate reference through F704-AC-04's own tenant filter, which filters on the stored scope and therefore admits the row; the alternative, a read-time join that rejects the mismatch defensively, hides the row from A as well and leaves A's audit history incomplete under F704-AC-05, which forbids rewriting it to repair. Platform activity has the same case with a jurisdiction: a rules publication for jurisdiction A recorded under jurisdiction B misattributes the most consequential entry this log holds. Deriving the scope removes both outcomes, because there is then only one value and no pair to disagree.

2. **F704-AC-02:** Failed, unauthorized, rolled-back, or no-op actions do not appear as successful activity.
3. **F704-AC-03:** Activity metadata passes the approved allow-list and contains no secret, token, document body, message body, or unredacted contact data.
4. **F704-AC-04:** Cross-workspace query/filter/pagination/source-link paths disclose no foreign activity or aggregate existence, and platform-scoped activity is visible only through the approved platform role.
5. **F704-AC-05:** Corrections, rule publication/rollback, and system jobs append new entries and never rewrite earlier history.
6. **F704-AC-06:** Every record carries a stable non-secret actor reference in addition to actor type; user attribution remains distinct and displayable under the approved deletion policy, while system and provider actions use explicit named identities rather than a generic or fabricated user.

7. **F704-AC-07:** Every activity read this feature defines, the query, filter, pagination, and source-link operations of `F704-AC-04`, names the workspace it reads in or the platform scope it reads at, and is admitted only by the acting actor's current F-702 membership of that workspace together with the F-703 permission approved for the read, or for platform-scoped activity by the actor's current authority under the approved separate platform role, re-read server-side from stored membership and role at each request. Activity writes are internal to the consuming features' own domain transactions under `F704-AC-01` and are gated by the criteria of the features that emit them, so this criterion reaches only reads. `F704-AC-04` remains the rule for what a read may disclose, its tenant isolation and platform-role visibility unchanged; this criterion adds when and where the authority that rule presumes is read: per request, at the operation, never from a session, a client-supplied role claim, or the authority held when the timeline was first opened, so membership or platform authority removed while a request is in flight causes that request to fail rather than return records. A request failing the check is refused before any activity record, aggregate reference, or source link is disclosed, and its response does not distinguish a workspace, aggregate, or activity record that does not exist from one the actor may not see.

   Without this criterion AC-01 through AC-06 all pass for a caller whose authority is stale. They fix atomic emission, failure suppression, metadata redaction, cross-workspace non-disclosure, append-only history, and actor attribution, and `F704-AC-04` says what a foreign caller may not see without saying when the authority that decides it is read, so an implementation that resolves membership once at session start satisfies every criterion while a removed member keeps reading the workspace's full activity timeline, who changed what and when, until they sign out.

   One input this criterion needs is not established by any approved artifact today and is not invented here. F-703 is PROPOSED and names no role set, so neither the workspace read permission nor the platform role above can be named. Until F-703 is approved this criterion is testable only as "every workspace-scoped activity read is refused unless the acting actor holds an active membership of that workspace, and every platform-scoped activity read is refused unless the actor holds the separate platform authority, both read server-side at that request, and a refusal discloses nothing about whether the scope or its records exist", not against a named role or permission identifier. Naming the activity read permissions with F-703 is an approval blocker below.

## Fixtures and Verification

- Planned automated fixture IDs are the acceptance IDs above; each must map one-to-one to a runnable test before approval can claim implementation readiness.
- Regulatory fixtures: none; this feature does not define regulatory ground truth.
- F704-AC-01 includes a fixture in which a consuming transaction attempts to write an activity record whose stored workspace scope is not the workspace of the aggregate it references: the activity record is not written, the emitting transaction fails with it, and no partial state is left behind. A matching platform-scope fixture attempts a rules publication entry whose stored jurisdiction is not the jurisdiction of the published artifact. A paired read fixture proves that after the correct record is written, it appears in the owning workspace's timeline and in no other.
- F704-AC-07 includes a fixture in which an authenticated actor holding no membership of the owning workspace names a valid aggregate and is refused at query, filter, pagination, and source-link resolution, with a response that does not distinguish absence from denial; a matching platform-scope fixture for an actor without the platform role; and a fixture in which membership removed while a request is in flight fails that request rather than returning records.
- Security-sensitive and cross-workspace paths require negative authorization tests; provider paths require success, duplicate-delivery, retry, invalid-signature, and permanent-failure tests where applicable.

## Allowed Footprint and Coordination

- `apps/web` and `apps/api` feature code and tests.
- New ordered forward migrations and approved OpenAPI/JSON Schema changes required by this feature.
- No repository restructuring, speculative package, or unrelated feature edit.
- Shared contracts, migrations, provider adapters, engine/rules artifacts, consent policy, and cross-lane UI primitives require the approvals named in `docs/DOCUMENTATION-GOVERNANCE.md` §6.

## Rollout and Fallback

- Instrument only approved material actions; do not attempt generic change capture.
- Rollback disables the new surface and workers/provider calls without deleting confirmed user data or rewriting immutable plans, rulesets, revisions, or history.

## Approval Blockers

- Approve action vocabulary, workspace/platform scope contract, metadata/redaction, retention, role visibility, and transactional emission pattern.
- Approve F-702 and F-703, and name with F-703 the workspace and platform activity read permissions `F704-AC-07` checks. That criterion checks a permission no approved artifact defines today and may not invent one, so until the matrix names them it is testable only at the membership and platform-authority level stated there.
- Assign the owner, approve this spec, and add it to `docs/BASELINE.md`. The reviewer and approver is the product owner (`docs/DOCUMENTATION-GOVERNANCE.md` §6), which is what this spec's header records, and that is the whole requirement: the independent-reviewer element this blocker used to carry was retired on 2026-08-05 (product owner; see §6 and `docs/BASELINE.md`). Until those three things are done this blocker is not satisfied and this spec is not approved: it stays PROPOSED under governance §3, its Approval date stays `—`, and it is not implementable and not listed in `docs/BASELINE.md`. Retiring the reviewer element made this spec approvable; it did not approve it.
