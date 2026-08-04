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
- Operand binding for client-supplied identities: `specs/F-411-staff-roles-credentialed-entry.md` F411-AC-08 states once, for this whole branch, that a client-supplied identity is committed with the operands that determine its recorded result and that a reuse carrying different operands is a conflict rather than a replay. Every identity criterion below relies on it. F-411 is PROPOSED, so that rule is not an approved input today and this spec is not implementable against it until F-411 is approved or the rule is promoted to an approved shared invariant; F411-AC-08 records both paths.
- The approval PR must re-pin any baseline version that changes before approval. A proposed or superseded input blocks implementation.

## Inputs, Outputs, State, Validation, and Errors

- Inputs are user-confirmed actual entries and one budget version, plus a stable client-supplied request identity on every ledger or mapping mutation under F406-AC-06 and on every confirmation under F406-AC-04; outputs are known revenue, cost, profit/loss, margin, and variance plus F-406's per-event current confirmed P&L-snapshot pointer.
- Draft actuals may change; confirmation creates an immutable event-local snapshot version, corrections create a strictly increasing version with predecessor provenance, and the current confirmed P&L-snapshot pointer advances atomically.
- Missing/unknown costs remain excluded with an incomplete warning; zero is accepted only when explicitly entered.
- Missing or unresolved material data stays visibly unset, unknown, pending, or failed as appropriate; it never becomes a successful or complete result.
- Invalid input produces a field or action-specific error without partial mutation. Retriable external failures preserve the user's confirmed state and expose a safe retry.

## UI and Accessibility

- Budget, actual, variance, uncategorized, and incomplete values remain distinct and readable with signs/symbols announced to assistive technology.
- The complete workflow is keyboard operable, uses programmatic labels and visible focus, does not encode status by color alone, and announces asynchronous success or failure.
- Empty, loading, permission-denied, validation, provider-failure, and unavailable states have explicit copy and a safe next action.

## System Impact

| Concern              | Proposed impact                                                                                                                             |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| API                  | Actual-entry, rollup, and snapshot operations require approved OpenAPI money/concurrency contracts.                                         |
| Schema               | Forward migrations for actual ledger entries, immutable P&L snapshots linked to a budget version, and a per-event current-snapshot pointer. |
| Jobs                 | None.                                                                                                                                       |
| Providers            | None.                                                                                                                                       |
| Privacy and security | Workspace authorization and audit history; raw financial values are excluded from logs/analytics.                                           |

Exact HTTP, JSON Schema, migration, job, and provider shapes belong in their reviewed machine contracts; this proposal does not authorize parallel local types or edits to merged migrations.

## Acceptance Criteria

1. **F406-AC-01:** Actual entries use integer minor units and one currency and deterministically calculate revenue, cost, profit/loss, margin, and budget variance; margin is unavailable (not zero) when revenue is zero, with zero/positive-revenue boundary fixtures.

   That one currency is the currency of the exact referenced F-104 budget version. `F104-AC-03` already validates the currency of every budget line, so the referenced version has one to read. Every actual entry and every snapshot records the currency it is denominated in, and an entry whose currency differs from the referenced budget version's is rejected at entry rather than stored, so the ledger cannot come to hold entries the comparison would have to reconcile. Where an actual ledger already exists in a different currency, or the referenced budget version's currency is unknown, budget variance is reported as unavailable with the reason, not computed; revenue, cost, profit, loss, and margin, which are derived from the actuals alone, remain available in the actual ledger's own currency and are labeled with it. Unavailable variance follows F406-AC-02's incomplete-result treatment and is never rendered as zero variance.

   Each aggregate independently satisfying a "one currency" rule is what leaves this open: a USD budget and a EUR actual ledger are each internally consistent, and subtracting one set of minor units from the other produces a number with no meaning that this feature then presents as a profit-and-loss result. Unlike the concurrency defects elsewhere in this spec, nothing is lost or overwritten; the report is simply wrong and says nothing about being wrong, which for a figure an organizer reads as fact is the worse failure. Requiring the match is the only correct behavior available today, because multi-currency conversion is an explicit non-goal and no approved artifact establishes a currency list, a rate source, a rate date, or a rounding rule. This criterion establishes none of those. If conversion is ever wanted it returns to the PRD and Roadmap decision process under `docs/DOCUMENTATION-GOVERNANCE.md` §6 as product scope, and the approval that admits it would have to name at minimum the permitted currency set, the rate source and its authority, which date's rate a comparison uses and how that date is pinned to an immutable snapshot so a re-read of a confirmed snapshot cannot change, the rounding and minor-unit rule for the converted result, and how a converted variance is labeled so it is never read as a directly comparable figure.

2. **F406-AC-02:** Unknown/missing actuals are not zero and produce an incomplete-result warning.
3. **F406-AC-03:** Mapping or unmapping an actual changes rollups without mutating the referenced budget line.
4. **F406-AC-04:** Confirmation carries a stable client-supplied request identity, committed in the same transaction as the snapshot it produces under a uniqueness constraint scoped to the event. A request presenting an already committed identity is resolved from that record before the version comparison below and returns the original snapshot and pointer state, appending no second snapshot and no second predecessor entry. Confirmation then atomically compare-and-swaps the complete current budget-mapping and actual-ledger version set plus the expected current confirmed P&L-snapshot version; any mismatch rejects confirmation and requires a rebuilt preview. Success creates an immutable, strictly increasing event-local snapshot tied to those exact versions, records its predecessor, and atomically advances F-406's per-event current confirmed P&L-snapshot pointer. That identity binds its operands under the rule `F411-AC-08` states once for every client-supplied identity on this branch: it is committed together with the request fields that determine the recorded result, including every aggregate, version, and generation the request names, and a later request presenting the same identity with any different operand is refused as a conflict rather than being answered with the stored result. The identity is still the key and the operands are only a precondition on reusing it, so this is not the content uniqueness this criterion already forbids.

   The identity is resolved before the pointer comparison because the comparison alone cannot tell a retry from a stale confirmation. When the first confirmation commits and its response is lost, the client retries with the same expected current-snapshot version, which that commit has already advanced, so the retry is classified stale and the organizer is told to rebuild the preview; rebuilding and confirming again then produces a second immutable snapshot and a second predecessor entry for one intended confirmation, which every later consumer of the pointer reads as two confirmed results. The identity is client-supplied and never derived from the ledger, mapping, or version set: a deliberate later correction is a separate confirmation that carries its own new identity, is composed against the pointer current when the organizer made it, and records its own snapshot and predecessor under this criterion.

5. **F406-AC-05:** No screen or export represents the result as audited accounting, tax, or payment data.
6. **F406-AC-06:** Actual-ledger create/edit/delete and mapping/unmapping operations bind a stable request identity to the original result; replay returns that result without duplicating entries or rollups. Each mutation compare-and-swaps the expected ledger version and every affected entry version; a mismatch rejects the whole mutation without changing an entry, mapping, or rollup. The operations that write this feature's state are actual-entry create, edit, and delete, mapping and unmapping, and confirmation under F406-AC-04, including the confirmation of a correction; each of them binds a stable request identity and names the exact versions it read, so no operation here reaches a durable write without both. That identity binds its operands under the rule `F411-AC-08` states once for every client-supplied identity on this branch: it is committed together with the request fields that determine the recorded result, including every aggregate, version, and generation the request names, and a later request presenting the same identity with any different operand is refused as a conflict rather than being answered with the stored result. The identity is still the key and the operands are only a precondition on reusing it, so this is not the content uniqueness this criterion already forbids.
7. **F406-AC-07:** Consumers may read the exact snapshot captured with F-406's current pointer or an explicitly selected older confirmed version; an older version remains visibly labeled historical and is never represented as current.

## Fixtures and Verification

- Planned automated fixture IDs are the acceptance IDs above; each must map one-to-one to a runnable test before approval can claim implementation readiness.
- F406-AC-01 includes a mismatched-currency fixture in which an actual entry whose currency differs from the referenced budget version's is rejected at entry, and a fixture in which a pre-existing mismatched ledger reports budget variance as unavailable with a reason rather than as zero or as a computed number.
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

- Approve money signs/precision, margin behavior at zero revenue, category mapping, and snapshot finalization.- Assign the owner and independent reviewer, approve this spec, and add it to `docs/BASELINE.md`.
