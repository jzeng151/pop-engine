# F-209 · Fee and Document Ledger

**Status:** PROPOSED (2026-07-26) — ready for review; not implementable until approved and listed in `docs/BASELINE.md`.

**Phase:** 2 · **Issue:** [#18](https://github.com/jzeng151/pop-engine/issues/18) · **Owner:** TBD · **Reviewer:** product owner plus affected architecture, contract, security, and lane owners (TBD) · **Approval date:** —

## Purpose and User Outcome

An organizer can reconcile estimated, invoiced, and paid fees plus required and submitted documents and final permit expirations without losing provenance.

## Scope

**In scope**

- Track money by estimate, invoice, and payment; track required versus submitted documents; store final permit references and expiration dates.
- Link ledger entries to checklist items/applications and identify their source as rule-derived or user-confirmed.
- Use controlled private upload/download behavior for documents.

**Non-goals**

- Payment processing, bookkeeping, tax advice, legal validation of a document, or agency filing.
- Treating a missing or research-required fee as zero.

## Dependencies and Baseline

- F-202 checklist, F-208 application tracking where applicable, and the F-701/F-702/F-703 gate.
- Upload-limit/scanning ADR and approved money/date contracts.
- Baseline at draft time: PRD, Roadmap, Design, and Phase 0–1.5 Architecture approved 2026-07-22; `ARCHITECTURE-FUTURE.md` approved as a planning target 2026-07-25; NYC ruleset `nyc.v2.7`, rules schema `popengine-rules/v2`, and scenario fixtures v5 where regulatory output is consumed.
- The approval PR must re-pin any baseline version that changes before approval. A proposed or superseded input blocks implementation.

## Inputs, Outputs, State, Validation, and Errors

- Inputs are rule-derived estimates and user-confirmed invoice/payment/document facts; outputs are source-labeled ledger entries and private file references.
- A new plan marks prior rule-derived estimates stale and excludes them from current totals; refresh appends estimates linked to the new plan/finding while preserving prior estimates and all invoice/payment history.
- Document state is required → upload pending → submitted → accepted/rejected/expired only when the organizer records that fact; file scan state remains separate.
- Amounts use integer minor units and one explicit currency; negative or impossible transitions are rejected.
- Missing or unresolved material data stays visibly unset, unknown, pending, or failed as appropriate; it never becomes a successful or complete result.
- Invalid input produces a field or action-specific error without partial mutation. Retriable external failures preserve the user's confirmed state and expose a safe retry.

## UI and Accessibility

- Estimated, invoiced, and paid values are visually and semantically distinct; missing amounts display as unknown, not $0.
- The complete workflow is keyboard operable, uses programmatic labels and visible focus, does not encode status by color alone, and announces asynchronous success or failure.
- Empty, loading, permission-denied, validation, provider-failure, and unavailable states have explicit copy and a safe next action.

## System Impact

| Concern              | Proposed impact                                                                                                                                   |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| API                  | Ledger and controlled upload operations require approved OpenAPI contracts, including idempotency and error shapes.                               |
| Schema               | Forward migrations for fee/document ledger records and final-permit metadata; file bytes remain in private object storage.                        |
| Jobs                 | File scan/verification jobs if required by the upload ADR; no payment jobs.                                                                       |
| Providers            | Private storage adapter and selected scanning service, if any.                                                                                    |
| Privacy and security | Signed URLs are short-lived; server verifies type, size, checksum, ownership, and scan state before download; document contents never enter logs. |

Exact HTTP, JSON Schema, migration, job, and provider shapes belong in their reviewed machine contracts; this proposal does not authorize parallel local types or edits to merged migrations.

## Acceptance Criteria

1. **F209-AC-01:** Estimated, invoiced, and paid amounts remain separate, preserve source/currency, and roll up without floating-point error.
2. **F209-AC-02:** Unknown or research-required fees render as unknown and are excluded from known totals with an explicit incomplete-total warning.
3. **F209-AC-03:** Required and submitted document lists reconcile without marking an uploaded file agency-accepted unless a user records that state.
4. **F209-AC-04:** Final permit and expiration metadata retain history and never overwrite the source finding or application history.
5. **F209-AC-05:** Unauthorized, oversized, disallowed, checksum-mismatched, or unsafe uploads are unavailable and create no accepted document state.
6. **F209-AC-06:** Replanning marks every superseded or removed rule-derived estimate stale and excludes it from current totals; refresh creates source-linked current entries without overwriting old estimates, invoices, payments, or document history.
7. **F209-AC-07:** Every document remains in private storage; each URL issuance rechecks workspace ownership/role and scan state and returns only a short-lived signed URL. Authorization loss blocks new URLs, while an already issued direct-storage URL retains only its disclosed bounded validity until expiry unless an approved authenticated proxy provides immediate revocation.
8. **F209-AC-08:** Fee, estimate, invoice, payment, document-state, and final-permit mutations bind a stable request identity to the original immutable result; a lost-response retry returns that result without duplicating history or rollups.

## Fixtures and Verification

- Planned automated fixture IDs are the acceptance IDs above; each must map one-to-one to a runnable test before approval can claim implementation readiness.
- Regulatory fixtures: Use the approved scenario findings to exercise known and research-required fees; application documents and payments are synthetic.
- Security-sensitive and cross-workspace paths require negative authorization tests; provider paths require success, duplicate-delivery, retry, invalid-signature, and permanent-failure tests where applicable.

## Allowed Footprint and Coordination

- `apps/web` and `apps/api` feature code and tests.
- New ordered forward migrations and approved OpenAPI/JSON Schema changes required by this feature.
- No repository restructuring, speculative package, or unrelated feature edit.
- Shared contracts, migrations, provider adapters, engine/rules artifacts, consent policy, and cross-lane UI primitives require the approvals named in `docs/DOCUMENTATION-GOVERNANCE.md` §6.

## Rollout and Fallback

- Manual ledger entry ships before any optional extraction; F-602 proposals stay disabled until separately approved.
- Rollback disables the new surface and workers/provider calls without deleting confirmed user data or rewriting immutable plans, rulesets, revisions, or history.

## Approval Blockers

- Approve money, document-state, retention, upload, scan, API, and migration contracts.
- Assign the owner and independent reviewer, approve this spec, and add it to `docs/BASELINE.md`.
