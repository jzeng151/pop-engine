# F-604 · Update Reconciliation

**Status:** PROPOSED (2026-07-26) — ready for review; not implementable until approved and listed in `docs/BASELINE.md`.

**Phase:** 4 · **Issue:** [#60](https://github.com/jzeng151/pop-engine/issues/60) · **Owner:** TBD · **Reviewer:** product owner plus affected architecture, contract, security, and lane owners (TBD) · **Approval date:** —

## Purpose and User Outcome

When a later confirmed document value differs from an application deadline, fee, or status, PopEngine proposes a source-linked change and waits for user confirmation.

## Scope

**In scope**

- Consume F-602's confirmed-but-unapplied typed proposal, compare it against current F-208/F-209 values, and create a field-level reconciliation proposal.
- Show old/new values, sources, confidence limits, and downstream effects before accept/reject.
- Apply accepted changes through normal append-only history and staleness behavior.

**Non-goals**

- Automatic overwrite, resolving regulatory conflicts, choosing which agency source is true, or bulk unattended updates.
- Changing immutable plan findings/ruleset output.

## Dependencies and Baseline

- F-208/F-209 plus F-602's confirmed-but-unapplied typed proposal contract; F-603 may supply a matched document to F-602 but does not itself produce workflow values.
- Approved field comparison, materiality, conflict, confirmation, and downstream-staleness contract.
- Baseline at draft time: PRD, Roadmap, Design, and Phase 0–1.5 Architecture approved 2026-07-22; `ARCHITECTURE-FUTURE.md` approved as a planning target 2026-07-25; NYC ruleset `nyc.v2.7`, rules schema `popengine-rules/v2`, and scenario fixtures v5 where regulatory output is consumed.
- The approval PR must re-pin any baseline version that changes before approval. A proposed or superseded input blocks implementation.

## Inputs, Outputs, State, Validation, and Errors

- Inputs are a current confirmed field and F-602 confirmed-but-unapplied typed proposal; output is no-change, pending reconciliation, or explicit conflict.
- Proposal state is pending → accepted/rejected/superseded; acceptance appends domain history and never overwrites the source or plan.
- Type mismatch, ambiguous source, official conflict, or unconfirmed extraction cannot auto-resolve.
- Missing or unresolved material data stays visibly unset, unknown, pending, or failed as appropriate; it never becomes a successful or complete result.
- Invalid input produces a field or action-specific error without partial mutation. Retriable external failures preserve the user's confirmed state and expose a safe retry.

## UI and Accessibility

- Diff view identifies exact field, old/new/source/time, conflict status, affected reminders/calendar entries, and explicit per-field action.
- The complete workflow is keyboard operable, uses programmatic labels and visible focus, does not encode status by color alone, and announces asynchronous success or failure.
- Empty, loading, permission-denied, validation, provider-failure, and unavailable states have explicit copy and a safe next action.

## System Impact

| Concern              | Proposed impact                                                                                                     |
| -------------------- | ------------------------------------------------------------------------------------------------------------------- |
| API                  | Reconciliation create/read/accept/reject operations require approved OpenAPI concurrency/idempotency contracts.     |
| Schema               | Forward migration for reconciliation proposals/decisions and exact source/current-version references.               |
| Jobs                 | Durable proposal detection may run after confirmed ingestion; applying a decision is synchronous and transactional. |
| Providers            | None beyond upstream extraction/ingestion adapters.                                                                 |
| Privacy and security | Workspace/role scope, source access, redacted logs, stale-decision protection, and immutable decision audit.        |

Exact HTTP, JSON Schema, migration, job, and provider shapes belong in their reviewed machine contracts; this proposal does not authorize parallel local types or edits to merged migrations.

## Acceptance Criteria

1. **F604-AC-01:** Only an authorized F-602 proposal with confirmed-but-unapplied state and an exact source/current-record pair can create a reconciliation proposal.
2. **F604-AC-02:** Each proposal shows typed old/new values and exact source/version without changing current state.
3. **F604-AC-03:** Accepting appends the normal F-208/F-209 history and triggers approved stale/reminder/calendar handling atomically.
4. **F604-AC-04:** Rejecting preserves current state and source; duplicate or stale acceptance is idempotent or rejected without lost updates.
5. **F604-AC-05:** Official conflict, ambiguity, type mismatch, or unconfirmed extraction remains visible and cannot be auto-resolved.

## Fixtures and Verification

- Planned automated fixture IDs are the acceptance IDs above; each must map one-to-one to a runnable test before approval can claim implementation readiness.
- Regulatory fixtures: Synthetic source/current pairs cover same/change/conflict; no reconciliation fixture overrides published rules.
- Security-sensitive and cross-workspace paths require negative authorization tests; provider paths require success, duplicate-delivery, retry, invalid-signature, and permanent-failure tests where applicable.

## Allowed Footprint and Coordination

- `apps/web` and `apps/api` feature code and tests.
- New ordered forward migrations and approved OpenAPI/JSON Schema changes required by this feature.
- No repository restructuring, speculative package, or unrelated feature edit.
- Shared contracts, migrations, provider adapters, engine/rules artifacts, consent policy, and cross-lane UI primitives require the approvals named in `docs/DOCUMENTATION-GOVERNANCE.md` §6.

## Rollout and Fallback

- Human-confirmed proposals only; automated application stays permanently out of scope unless Roadmap changes.
- Rollback disables the new surface and workers/provider calls without deleting confirmed user data or rewriting immutable plans, rulesets, revisions, or history.

## Approval Blockers

- Approve comparison/materiality/conflict decision table and downstream stale/job behavior.
- Assign the owner and independent reviewer, approve this spec, and add it to `docs/BASELINE.md`.
