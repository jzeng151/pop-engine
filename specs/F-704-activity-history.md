# F-704 · Activity History

**Status:** PROPOSED (2026-07-26) — ready for review; not implementable until approved and listed in `docs/BASELINE.md`.

**Phase:** 3 · **Issue:** [#51](https://github.com/jzeng151/pop-engine/issues/51) · **Owner:** TBD · **Reviewer:** product owner plus affected architecture, contract, security, and lane owners (TBD) · **Approval date:** —

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

- F-701/F-702/F-703 and approved activity event vocabulary/redaction policy.
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
2. **F704-AC-02:** Failed, unauthorized, rolled-back, or no-op actions do not appear as successful activity.
3. **F704-AC-03:** Activity metadata passes the approved allow-list and contains no secret, token, document body, message body, or unredacted contact data.
4. **F704-AC-04:** Cross-workspace query/filter/pagination/source-link paths disclose no foreign activity or aggregate existence, and platform-scoped activity is visible only through the approved platform role.
5. **F704-AC-05:** Corrections, rule publication/rollback, and system jobs append new entries and never rewrite earlier history.

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

- Instrument only approved material actions; do not attempt generic change capture.
- Rollback disables the new surface and workers/provider calls without deleting confirmed user data or rewriting immutable plans, rulesets, revisions, or history.

## Approval Blockers

- Approve action vocabulary, workspace/platform scope contract, metadata/redaction, retention, role visibility, and transactional emission pattern.
- Assign the owner and independent reviewer, approve this spec, and add it to `docs/BASELINE.md`.
