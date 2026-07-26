# F-408 · Inventory Low-Stock Alerts

**Status:** PROPOSED (2026-07-26) — ready for review; not implementable until approved and listed in `docs/BASELINE.md`.

**Phase:** 4 · **Issue:** [#56](https://github.com/jzeng151/pop-engine/issues/56) · **Owner:** TBD · **Reviewer:** product owner plus affected architecture, contract, security, and lane owners (TBD) · **Approval date:** —

## Purpose and User Outcome

Event staff can maintain manual item counts and receive deterministic low-stock warnings; an optional Square webhook may update counts only after a separate provider decision.

## Scope

**In scope**

- Create event inventory items, record manual count adjustments with reason, set a nonnegative alert threshold, and show/send low-stock transitions.
- Optionally ingest approved Square inventory events through a verified idempotent adapter.
- Preserve adjustment/source history and distinguish stale provider state.

**Non-goals**

- POS, payments, sales analytics, purchasing, forecasting, recipes, multi-location inventory, or generic Square integration.
- Treating an unverified webhook as inventory truth.

## Dependencies and Baseline

- F-402 dashboard, F-703 roles, and approved jobs/outbox for notifications.
- Square path additionally requires provider/webhook ADR; manual counts must work without it.
- Baseline at draft time: PRD, Roadmap, Design, and Phase 0–1.5 Architecture approved 2026-07-22; `ARCHITECTURE-FUTURE.md` approved as a planning target 2026-07-25; NYC ruleset `nyc.v2.7`, rules schema `popengine-rules/v2`, and scenario fixtures v5 where regulatory output is consumed.
- The approval PR must re-pin any baseline version that changes before approval. A proposed or superseded input blocks implementation.

## Inputs, Outputs, State, Validation, and Errors

- Inputs are item, integer adjustment/current count, threshold, and source; outputs are append-only adjustments and derived current/low-stock state.
- Low-stock transition occurs when known count becomes at or below threshold; unknown/stale count is separate and never reported healthy.
- Duplicate provider events are idempotent; out-of-order events follow the approved cursor/version policy.
- Missing or unresolved material data stays visibly unset, unknown, pending, or failed as appropriate; it never becomes a successful or complete result.
- Invalid input produces a field or action-specific error without partial mutation. Retriable external failures preserve the user's confirmed state and expose a safe retry.

## UI and Accessibility

- Staff controls show current count, threshold, source freshness, adjustment history, and non-color low/unknown/stale warnings.
- The complete workflow is keyboard operable, uses programmatic labels and visible focus, does not encode status by color alone, and announces asynchronous success or failure.
- Empty, loading, permission-denied, validation, provider-failure, and unavailable states have explicit copy and a safe next action.

## System Impact

| Concern              | Proposed impact                                                                                                                          |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| API                  | Inventory/adjustment and optional webhook operations require approved OpenAPI contracts.                                                 |
| Schema               | Forward migrations for event inventory items, append-only adjustments, thresholds, and optional provider mappings/webhook events.        |
| Jobs                 | Durable low-stock notification and webhook replay/dead-letter only when enabled.                                                         |
| Providers            | Manual path has none; optional Square adapter with verified signatures and encrypted credentials.                                        |
| Privacy and security | Role/workspace scope, webhook signature/timestamp verification, idempotency, rate limits, redacted provider data, and no payment scopes. |

Exact HTTP, JSON Schema, migration, job, and provider shapes belong in their reviewed machine contracts; this proposal does not authorize parallel local types or edits to merged migrations.

## Acceptance Criteria

1. **F408-AC-01:** Manual integer adjustments deterministically derive current count and retain actor/time/reason/source history.
2. **F408-AC-02:** A known count crossing to at or below the threshold creates one low-stock transition/alert; retries or repeated reads do not duplicate it.
3. **F408-AC-03:** Unknown or stale count is labeled and cannot appear in-stock.
4. **F408-AC-04:** Invalid, replayed, duplicate, out-of-scope, or unverified Square events cannot change inventory.
5. **F408-AC-05:** The provider connection requests no payment capability and no feature surface performs POS, purchasing, or forecasting.

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

- Ship manual counts first; Square remains disabled until the provider ADR and live webhook checks pass.
- Rollback disables the new surface and workers/provider calls without deleting confirmed user data or rewriting immutable plans, rulesets, revisions, or history.

## Approval Blockers

- Approve item/count/threshold semantics and alert channel.
- For Square: approve scopes, webhook ordering/signature/replay, mapping, and disconnect behavior.
- Assign the owner and independent reviewer, approve this spec, and add it to `docs/BASELINE.md`.
