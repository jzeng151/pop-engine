# F-104 · Budget Estimator

**Status:** PROPOSED (2026-07-26) — ready for review; not implementable until approved and listed in `docs/BASELINE.md`.

**Phase:** 3 · **Issue:** [#29](https://github.com/jzeng151/pop-engine/issues/29) · **Owner:** TBD · **Reviewer:** product owner plus affected architecture, contract, security, and lane owners (TBD) · **Approval date:** —

## Purpose and User Outcome

An organizer can combine published permit-fee information with their own budget lines and target budget while seeing exactly which costs remain unknown.

## Scope

**In scope**

- Import known fee facets from the immutable plan and add/edit/remove user-entered estimated line items with optional source provenance.
- Calculate known total, unknown-fee warning, target variance, and category subtotals in one currency.
- Preserve source and verification status for every rule-derived fee.

**Non-goals**

- A guaranteed total, accounting system, payment flow, tax calculation, quote marketplace, or invented fee.
- Treating research-required, variable, or missing fees as zero.

## Dependencies and Baseline

- F-201 typed findings and approved money/source contracts.
- F-406 consumes the approved budget snapshot for actuals comparison; later integrations may submit organizer-confirmed proposals through F-104's existing user-line contract without becoming F-104 prerequisites.
- Baseline at draft time: PRD, Roadmap, Design, and Phase 0–1.5 Architecture approved 2026-07-22; `ARCHITECTURE-FUTURE.md` approved as a planning target 2026-07-25; NYC ruleset `nyc.v2.7`, rules schema `popengine-rules/v2`, and scenario fixtures v5 where regulatory output is consumed.
- The approval PR must re-pin any baseline version that changes before approval. A proposed or superseded input blocks implementation.

## Inputs, Outputs, State, Validation, and Errors

- Inputs are one immutable plan, target budget, and user lines with optional provenance; output is a versioned budget with known totals and explicit unknown coverage.
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

1. **F104-AC-01:** Known rule-derived fees import once with exact finding/source/version linkage and cannot be edited as if user-entered. The import that creates the budget names the exact plan and finding generation it read the fee lines from, and the single transaction that creates the budget compare-and-swaps that generation against the event's current one, so an import composed against plan P commits only while P is still the current plan. A regeneration that committed first rejects the import in full, creating no budget and no lines, and the organizer re-imports from the current plan. The import also carries a stable client-supplied request identity committed with the budget it creates, under a uniqueness constraint scoped to the event, and a replay returns the original budget rather than creating a second one.

   The generation comparison is stated here from 2026-08-04, and not as an outcome this criterion allows: "import once" and exact source linkage record which plan the lines came from but do not establish that plan is still current at commit, and F104-AC-04's fencing applies only to a refresh of a budget that already exists. Without it, an import from plan P racing a regeneration to plan Q lets Q commit first, find no budget, and therefore mark nothing stale; the import then commits P's fee lines as the current budget, with no stale marking anywhere, so the organizer sees superseded rule-derived fees presented as current until someone refreshes by hand. Every other operation on this aggregate is fenced on the budget version it read, per F104-AC-06; the import is the one with no predecessor budget version to name, so the generation it read is what it must compare instead of nothing at all.
2. **F104-AC-02:** Research-required, variable, missing, or conflicting fees remain unknown and trigger an incomplete-total warning.
3. **F104-AC-03:** User lines validate currency and minor units and produce deterministic category, known-total, and target-variance calculations.
4. **F104-AC-04:** Plan regeneration marks imported lines stale. Refresh names the exact plan, finding, and current budget version it was composed against, compare-and-swaps all three at commit, rejects an in-flight stale refresh, creates a new budget version, and preserves prior values. The budget version is named alongside the plan and finding versions, and not as redundancy: two tabs refreshing the same stale budget after one regeneration read the same current plan and finding versions and therefore both satisfy a plan-and-finding comparison, while the budget each was composed against may already have been superseded by the other's refresh or by an organizer edit committed under F104-AC-06 in between. Without the budget comparison both refreshes report success, the projection committed last supersedes the other, and an edit the organizer was told had saved is silently discarded by a recomputation that never read it. Refresh also carries a stable client-supplied request identity committed with the new budget version, and a retry after a lost response is resolved from that committed record and returns the original new version before the version comparison is applied, so the safe retry is answered rather than reported as a stale rejection for work that in fact succeeded; a deliberate later refresh sends a new identity and is compared normally.
5. **F104-AC-05:** Deleting or editing a user line never changes the immutable plan or a rule-derived fee.
6. **F104-AC-06:** User-line create/edit/delete operations bind a stable client-supplied request identity to the original result, committed with it under a uniqueness constraint scoped to the budget; replay returns that result without duplicating lines, versions, or totals. Each create, edit, and delete, and each target-budget update, additionally names the exact current budget version, together with the affected line's version where it addresses an existing line, and is applied by compare-and-swap, so a request built from a version the caller no longer holds is rejected against the version it did not see. Added 2026-08-03 as the reason for that compare-and-swap, and not as an outcome this criterion allows: request identity only prevents replay of the same request, so with the identity rule alone two tabs or workspace actors editing from one budget version would issue two distinct requests that both satisfy it, and the later commit would silently overwrite or delete an edit the earlier caller was told had saved, leaving the displayed totals inconsistent with that confirmation. The version comparison above is what rejects that second commit instead. Create was brought under the same comparison on 2026-08-04: each mutation derives a new budget version from the version it read, so a create composed against a superseded version carries that version's line set forward and reinstates lines a concurrent delete had already removed.

   Every operation that writes this aggregate is enumerated below with the version it names, so a later operation added to this aggregate is visibly missing from the list rather than silently exempt. No operation writes a budget or a budget line except these six.

   | Operation                              | Criterion    | Version named and compare-and-swapped in the committing transaction                                                       | Request identity, uniqueness scope |
   | -------------------------------------- | ------------ | -------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- |
   | Import that creates the budget         | F104-AC-01   | the plan and finding generation the fee lines were read from, compared against the event's current generation; no predecessor budget version exists to name | yes, scoped to the event           |
   | User-line create                       | F104-AC-06   | the current budget version                                                                                                 | yes, scoped to the budget          |
   | User-line edit                         | F104-AC-06   | the current budget version and the affected line's version                                                                 | yes, scoped to the budget          |
   | User-line delete                       | F104-AC-06   | the current budget version and the affected line's version                                                                 | yes, scoped to the budget          |
   | Target-budget update                   | F104-AC-06   | the current budget version                                                                                                 | yes, scoped to the budget          |
   | Refresh after regeneration             | F104-AC-04   | the plan version, the finding version, and the current budget version, all three                                           | yes, scoped to the budget          |

   Each of the five operations on an existing budget names the exact budget version it read, so no two of them can produce sibling versions from one observed state. The import is the only one with no predecessor budget version, which is why the row above requires it to compare the plan and finding generation instead: an operation with nothing to fence against is what produced the first-import race F104-AC-01 now closes, and leaving that cell empty was the defect rather than a property of creation. The enumeration was added 2026-08-03 with the import listed as exempt and corrected on 2026-08-04 to fence it, which is the reason it is a table now: an exemption stated in prose reads as a fact about the operation, while an empty cell in a column every other row fills reads as a question.

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

- Approve money precision, category list, version/refresh semantics, exact known-total wording, and optional user-line provenance.
- Assign the owner and independent reviewer, approve this spec, and add it to `docs/BASELINE.md`.
