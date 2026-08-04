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
- Callback-state binding for the optional Square path: F408-AC-10 does not restate the rule it applies, it makes two other specs' criteria normative by reference. `specs/F-212-calendar-export-sync.md` F212-AC-06 states the single-use callback state and its bindings in full, and `specs/F-702-workspaces.md` F702-AC-10 requires every externally initiated callback to name the workspace it acts in and to have that binding established before the callback. Both are PROPOSED, so neither is an approved input today and F408-AC-10 is not implementable until F-212 and F-702 are approved or the rule is promoted to an approved shared invariant. This dependency exists only where the Square path is enabled; manual counts do not reach it.
- Baseline at draft time: PRD, Roadmap, Design, and Phase 0–1.5 Architecture approved 2026-07-22; `ARCHITECTURE-FUTURE.md` approved as a planning target 2026-07-25; NYC ruleset `nyc.v2.7`, rules schema `popengine-rules/v2`, and scenario fixtures v5 where regulatory output is consumed.
- Operand binding for client-supplied identities: `specs/F-411-staff-roles-credentialed-entry.md` F411-AC-08 states once, for this whole branch, that a client-supplied identity is committed with the operands that determine its recorded result and that a reuse carrying different operands is a conflict rather than a replay. Every identity criterion below relies on it. F-411 is PROPOSED, so that rule is not an approved input today and this spec is not implementable against it until F-411 is approved or the rule is promoted to an approved shared invariant; F411-AC-08 records both paths.
- The approval PR must re-pin any baseline version that changes before approval. A proposed or superseded input blocks implementation.

## Inputs, Outputs, State, Validation, and Errors

- Inputs are item, integer adjustment/current count, threshold, source, and a stable request identity on item creation; outputs are append-only adjustments and derived current/low-stock state.
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

1. **F408-AC-01:** Manual integer adjustments bind a stable operation identity to actor/time/reason/source history, deterministically derive current count, and return the original result without reapplying on replay. That identity binds its operands under the rule `F411-AC-08` states once for every client-supplied identity on this branch: it is committed together with the request fields that determine the recorded result, including every aggregate, version, and generation the request names, and a later request presenting the same identity with any different operand is refused as a conflict rather than being answered with the stored result. The identity is still the key and the operands are only a precondition on reusing it, so this is not the content uniqueness this criterion already forbids.
2. **F408-AC-02:** Creating an item with a known count at/below its threshold, first resolving an unknown/stale count to known at/below, or changing a known item from above threshold to at/below creates one low-stock transition/alert; the reverse known-low to known-above change records one recovery transition. Initialization above threshold creates no transition. Notification jobs pin the item generation, deliver in generation order after rechecking it, and suppress a stale low-stock alert after recovery; retries/repeated reads do not duplicate either transition or notification.
3. **F408-AC-03:** Unknown or stale count is labeled and cannot appear in-stock.
4. **F408-AC-04:** Invalid, replayed, duplicate, out-of-scope, or unverified Square events cannot change inventory.
5. **F408-AC-05:** The provider connection requests no payment capability and no feature surface performs POS, purchasing, or forecasting.
6. **F408-AC-06:** For distinct verified Square events delivered out of order, the approved provider cursor/version ordering rejects or records the delayed older event without allowing it to regress current count, freshness, or low-stock state.
7. **F408-AC-07:** Disconnect and verified-event application compete on the same mapping version/lock; event application atomically verifies the active mapping and mutates inventory, while a winning disconnect prevents that mutation and all later provider events. Provider-derived inventory becomes stale or unavailable while manual counts remain usable.
8. **F408-AC-08:** An operation that SETS an absolute value — a current count or a threshold — names the exact item generation it was composed against and commits only by compare-and-swap on it; an operation naming a superseded generation is rejected, changes no count, threshold, freshness, or low-stock state, and returns the current item for the staff member to recompose against. A stable operation identity under F408-AC-01 makes a replay safe but does not make a stale value correct, so two tabs composing distinct absolute values from one observed state are both valid without it and the delayed one overwrites the newer count and spuriously creates or reverses a low-stock transition under F408-AC-02. Append-only delta adjustments carry no such generation and continue to accumulate independently in any order.
9. **F408-AC-09:** Item creation carries its own client-generated request identity, and the transaction that creates the item commits that identity under a uniqueness constraint scoped to the event, so a retry after a lost response returns the original item and its F408-AC-02 transition result instead of creating a second item and a second low-stock alert. F408-AC-01's operation identity does not reach this case: it is scoped to adjustments of an item that already exists. A deliberate second item sends a new identity. Uniqueness over item name or recorded attributes is not that enforcement: an event may legitimately stock two items whose recorded attributes are identical, so it would refuse a real item. That identity binds its operands under the rule `F411-AC-08` states once for every client-supplied identity on this branch: it is committed together with the request fields that determine the recorded result, including every aggregate, version, and generation the request names, and a later request presenting the same identity with any different operand is refused as a conflict rather than being answered with the stored result. The identity is still the key and the operands are only a precondition on reusing it, so this is not the content uniqueness this criterion already forbids.
10. **F408-AC-10:** When the optional Square path is enabled, starting provider authorization issues a single-use callback state that the server stores bound to the initiating actor, the workspace, the provider, and the exact approved redirect target, on the same terms `F212-AC-06` states in full and `F702-AC-10` requires of every externally initiated callback. The callback rejects any request whose state is missing, unrecognized, expired, already consumed, or bound to a different actor, workspace, provider, or redirect; a rejection stores no credential and creates no connection or mapping, and a successful callback retires its state. AC-07's disconnect invalidates every outstanding state issued against the prior mapping generation, so a delayed callback cannot recreate the mapping after disconnect.

    AC-04 and AC-06 govern what a verified provider event may do once a mapping exists, and AC-07 governs disconnecting one, so nothing today constrains how the mapping came to exist. An attacker who begins authorization against their own Square account and induces a staff member to open the callback binds that attacker's account to the staff member's workspace; every later event then arrives verified under AC-04, passes the active-mapping check in AC-07, and moves that workspace's counts, so AC-03's freshness labelling reports attacker-chosen numbers as known. State entropy and lifetime are not established by any approved artifact today; they belong to the provider ADR named in the Approval Blockers, so until that approval names them this criterion is testable only as "an unguessable single-use state is required, bound, verified, and consumed before credentials are stored, and disconnect invalidates every outstanding state," not against a specific length or expiry. The manual path this feature ships first establishes no connection and is unaffected.

## Fixtures and Verification

- Planned automated fixture IDs are the acceptance IDs above; each must map one-to-one to a runnable test before approval can claim implementation readiness.
- F408-AC-07 includes a disconnect-versus-event-mutation concurrency fixture proving that a winning disconnect permits no later provider-derived count change.
- F408-AC-10 includes a cross-workspace callback fixture in which a state issued for one workspace is presented while another is active and no mapping is created, and a fixture proving a callback whose state was issued before a disconnect recreates no mapping.
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
- For Square: approve scopes, webhook ordering/signature/replay, mapping, and disconnect behavior. That ADR must name the callback-state entropy and lifetime F408-AC-10 leaves unpinned.
- Assign the owner and independent reviewer, approve this spec, and add it to `docs/BASELINE.md`.
