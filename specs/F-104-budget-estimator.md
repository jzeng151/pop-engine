# F-104 · Budget Estimator

**Status:** PROPOSED (2026-07-26) — ready for review; not implementable until approved and listed in `docs/BASELINE.md`.

**Phase:** 3 · **Issue:** [#29](https://github.com/jzeng151/pop-engine/issues/29) · **Owner:** TBD · **Reviewer:** product owner plus affected architecture, contract, security, and lane owners (TBD) · **Approval date:** —

## Purpose and User Outcome

An organizer can combine published permit-fee information with their own budget lines and target budget while seeing exactly which costs remain unknown.

## Scope

**In scope**

- Import known fee facets from the immutable plan and add/edit/remove user-entered estimated line items.
- Optionally import organizer-selected eligible cost lines from a confirmed F-407 snapshot as proposed user estimates under an approved category/currency mapping, preserving snapshot provenance.
- Calculate known total, unknown-fee warning, target variance, and category subtotals in one currency.
- Preserve source and verification status for every rule-derived fee.

**Non-goals**

- A guaranteed total, accounting system, payment flow, tax calculation, quote marketplace, or invented fee.
- Treating research-required, variable, or missing fees as zero.

## Dependencies and Baseline

- F-201 typed findings and approved money/source contracts.
- F-406 consumes the approved budget snapshot for actuals comparison; confirmed F-407 snapshots may seed a later event's proposed estimates through the approved mapping.
- Baseline at draft time: PRD, Roadmap, Design, and Phase 0–1.5 Architecture approved 2026-07-22; `ARCHITECTURE-FUTURE.md` approved as a planning target 2026-07-25; NYC ruleset `nyc.v2.7`, rules schema `popengine-rules/v2`, and scenario fixtures v5 where regulatory output is consumed.
- The approval PR must re-pin any baseline version that changes before approval. A proposed or superseded input blocks implementation.

## Inputs, Outputs, State, Validation, and Errors

- Inputs are one immutable plan, target budget, user lines, and an optional confirmed F-407 snapshot; output is a versioned budget with known totals and explicit unknown coverage.
- Budget state is draft → saved; plan regeneration makes imported rule lines stale and requires explicit refresh into a new budget version.
- Amounts use integer minor units, one explicit currency, and nonnegative validation unless an approved revenue line belongs in later F-406.
- Missing or unresolved material data stays visibly unset, unknown, pending, or failed as appropriate; it never becomes a successful or complete result.
- Invalid input produces a field or action-specific error without partial mutation. Retriable external failures preserve the user's confirmed state and expose a safe retry.

## UI and Accessibility

- Totals distinguish known subtotal, unresolved costs, and target variance; source and verification status are available for imported lines.
- The complete workflow is keyboard operable, uses programmatic labels and visible focus, does not encode status by color alone, and announces asynchronous success or failure.
- Empty, loading, permission-denied, validation, provider-failure, and unavailable states have explicit copy and a safe next action.

## System Impact

| Concern              | Proposed impact                                                                                                                                     |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| API                  | Budget/read/update/version operations require approved OpenAPI money and concurrency contracts.                                                     |
| Schema               | Forward migrations for budgets and budget lines linked to exact plan/finding sources.                                                               |
| Jobs                 | None.                                                                                                                                               |
| Providers            | None.                                                                                                                                               |
| Privacy and security | Workspace authorization and audit history cover financial estimates; amounts are excluded from telemetry unless explicitly aggregated and approved. |

Exact HTTP, JSON Schema, migration, job, and provider shapes belong in their reviewed machine contracts; this proposal does not authorize parallel local types or edits to merged migrations.

## Acceptance Criteria

1. **F104-AC-01:** Known rule-derived fees import once with exact finding/source/version linkage and cannot be edited as if user-entered.
2. **F104-AC-02:** Research-required, variable, missing, or conflicting fees remain unknown and trigger an incomplete-total warning.
3. **F104-AC-03:** User lines validate currency and minor units and produce deterministic category, known-total, and target-variance calculations.
4. **F104-AC-04:** Plan regeneration marks imported lines stale; refresh creates a new budget version and preserves prior values.
5. **F104-AC-05:** Deleting or editing a user line never changes the immutable plan or a rule-derived fee.
6. **F104-AC-06:** Import from F-407 accepts only a confirmed snapshot, maps only approved same-currency cost lines, preserves snapshot/line provenance, and presents them as editable proposed user estimates requiring confirmation; missing, incompatible, revenue, and rule-derived lines are not guessed or overwritten.

## Fixtures and Verification

- Planned automated fixture IDs are the acceptance IDs above; each must map one-to-one to a runnable test before approval can claim implementation readiness.
- Regulatory fixtures: Use all approved scenarios containing known, variable, and research-required fee facets; below/at/above rules remain engine-owned.
- Security-sensitive and cross-workspace paths require negative authorization tests; provider paths require success, duplicate-delivery, retry, invalid-signature, and permanent-failure tests where applicable.

## Allowed Footprint and Coordination

- `apps/web` and `apps/api` feature code and tests.
- New ordered forward migrations and approved OpenAPI/JSON Schema changes required by this feature.
- No repository restructuring, speculative package, or unrelated feature edit.
- Shared contracts, migrations, provider adapters, engine/rules artifacts, consent policy, and cross-lane UI primitives require the approvals named in `docs/DOCUMENTATION-GOVERNANCE.md` §6.

## Rollout and Fallback

- Ship one-currency manual budgeting; add multi-currency only through a later scheduled requirement.
- Rollback disables the new surface and workers/provider calls without deleting confirmed user data or rewriting immutable plans, rulesets, revisions, or history.

## Approval Blockers

- Approve money precision, category list, version/refresh semantics, exact known-total wording, and the F-407 snapshot-to-estimate mapping/provenance contract.
- Assign the owner and independent reviewer, approve this spec, and add it to `docs/BASELINE.md`.
