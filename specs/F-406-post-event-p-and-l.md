# F-406 · Post-Event P&L

**Status:** PROPOSED (2026-07-26) — ready for review; not implementable until approved and listed in `docs/BASELINE.md`.

**Phase:** 3 · **Issue:** [#39](https://github.com/jzeng151/pop-engine/issues/39) · **Owner:** TBD · **Reviewer:** product owner plus affected architecture, contract, security, and lane owners (TBD) · **Approval date:** —

## Purpose and User Outcome

An organizer can record actual revenue and costs against the approved F-104 budget and see deterministic variance and margin without turning PopEngine into accounting software.

## Scope

**In scope**

- Versioned actual revenue/cost ledger, mapping to budget lines/categories, rollups, variance, and margin.
- Preserve uncategorized entries and source notes.
- Freeze a post-event snapshot for F-407/F-502 after explicit confirmation.

**Non-goals**

- Accounting, invoicing, payments, bank/POS import, tax treatment, accruals, multi-currency conversion, or financial advice.
- Changing the original F-104 budget version.

## Dependencies and Baseline

- F-104 approved budget and the F-701/F-702/F-703 gate.
- Approved money precision, category mapping, and snapshot contract.
- Baseline at draft time: PRD, Roadmap, Design, and Phase 0–1.5 Architecture approved 2026-07-22; `ARCHITECTURE-FUTURE.md` approved as a planning target 2026-07-25; NYC ruleset `nyc.v2.7`, rules schema `popengine-rules/v2`, and scenario fixtures v5 where regulatory output is consumed.
- The approval PR must re-pin any baseline version that changes before approval. A proposed or superseded input blocks implementation.

## Inputs, Outputs, State, Validation, and Errors

- Inputs are user-confirmed actual entries and one budget version; outputs are known revenue, cost, profit/loss, margin, and variance.
- Draft actuals may change; confirmation creates an immutable outcome snapshot while corrections create a later version.
- Missing/unknown costs remain excluded with an incomplete warning; zero is accepted only when explicitly entered.
- Missing or unresolved material data stays visibly unset, unknown, pending, or failed as appropriate; it never becomes a successful or complete result.
- Invalid input produces a field or action-specific error without partial mutation. Retriable external failures preserve the user's confirmed state and expose a safe retry.

## UI and Accessibility

- Budget, actual, variance, uncategorized, and incomplete values remain distinct and readable with signs/symbols announced to assistive technology.
- The complete workflow is keyboard operable, uses programmatic labels and visible focus, does not encode status by color alone, and announces asynchronous success or failure.
- Empty, loading, permission-denied, validation, provider-failure, and unavailable states have explicit copy and a safe next action.

## System Impact

| Concern              | Proposed impact                                                                                      |
| -------------------- | ---------------------------------------------------------------------------------------------------- |
| API                  | Actual-entry, rollup, and snapshot operations require approved OpenAPI money/concurrency contracts.  |
| Schema               | Forward migrations for actual ledger entries and immutable P&L snapshots linked to a budget version. |
| Jobs                 | None.                                                                                                |
| Providers            | None.                                                                                                |
| Privacy and security | Workspace authorization and audit history; raw financial values are excluded from logs/analytics.    |

Exact HTTP, JSON Schema, migration, job, and provider shapes belong in their reviewed machine contracts; this proposal does not authorize parallel local types or edits to merged migrations.

## Acceptance Criteria

1. **F406-AC-01:** Actual entries use integer minor units and one currency and deterministically calculate revenue, cost, profit/loss, margin, and budget variance.
2. **F406-AC-02:** Unknown/missing actuals are not zero and produce an incomplete-result warning.
3. **F406-AC-03:** Mapping or unmapping an actual changes rollups without mutating the referenced budget line.
4. **F406-AC-04:** Confirmation atomically compare-and-swaps the complete current budget-mapping and actual-ledger version set; any mismatch rejects confirmation and requires a rebuilt preview. Success creates an immutable snapshot tied to those exact versions, and correction creates a new snapshot.
5. **F406-AC-05:** No screen or export represents the result as audited accounting, tax, or payment data.

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

- Manual actual entry only; integrations remain out until separately scheduled.
- Rollback disables the new surface and workers/provider calls without deleting confirmed user data or rewriting immutable plans, rulesets, revisions, or history.

## Approval Blockers

- Approve money signs/precision, margin behavior at zero revenue, category mapping, and snapshot finalization.
- Assign the owner and independent reviewer, approve this spec, and add it to `docs/BASELINE.md`.
