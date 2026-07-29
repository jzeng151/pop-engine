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

1. **F408-AC-01:** Manual integer adjustments bind a stable operation identity to actor/time/reason/source history, deterministically derive current count, and return the original result without reapplying on replay.
2. **F408-AC-02:** A count or threshold edit that changes a known item from above threshold to at/below creates one low-stock transition/alert; the reverse change records one recovery transition. Notification jobs pin the item generation, deliver in generation order after rechecking it, and suppress a stale low-stock alert after recovery; retries/repeated reads do not duplicate either transition or notification.
3. **F408-AC-03:** Unknown or stale count is labeled and cannot appear in-stock.
4. **F408-AC-04:** Invalid, replayed, duplicate, out-of-scope, or unverified Square events cannot change inventory.
5. **F408-AC-05:** The provider connection requests no payment capability and no feature surface performs POS, purchasing, or forecasting.
6. **F408-AC-06:** For distinct verified Square events delivered out of order, the approved provider cursor/version ordering rejects or records the delayed older event without allowing it to regress current count, freshness, or low-stock state.
7. **F408-AC-07:** Disconnect and verified-event application compete on the same mapping version/lock; event application atomically verifies the active mapping and mutates inventory, while a winning disconnect prevents that mutation and all later provider events. Provider-derived inventory becomes stale or unavailable while manual counts remain usable.

## Fixtures and Verification

- Planned automated fixture IDs are the acceptance IDs above; each must map one-to-one to a runnable test before approval can claim implementation readiness.
- F408-AC-07 includes a disconnect-versus-event-mutation concurrency fixture proving that a winning disconnect permits no later provider-derived count change.
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
