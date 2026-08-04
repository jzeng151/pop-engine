# F-214 · Vendor and Contractor Compliance

**Status:** PROPOSED (2026-07-26) — ready for review; not implementable until approved and listed in `docs/BASELINE.md`.

**Phase:** 3 · **Issue:** [#35](https://github.com/jzeng151/pop-engine/issues/35) · **Owner:** TBD · **Reviewer:** product owner plus affected architecture, contract, security, and lane owners (TBD) · **Approval date:** —

## Purpose and User Outcome

An organizer can track vendor contacts, insurance, permits, arrival times, and contract status for an event without PopEngine becoming a procurement or legal-review system.

## Scope

**In scope**

- Event-scoped vendor records with contacts, category, confirmed arrival time, contract status, and linked insurance/permit evidence.
- Show unresolved compliance items and expiration/arrival conflicts from recorded facts.
- Preserve source and history for status changes and attachments.

**Non-goals**

- Vendor marketplace, contracting, payments, background checks, legal review, or automatic compliance certification.
- Inventing vendor permits or insurance requirements.

## Dependencies and Baseline

- F-208, F-209, F-210 where applicable, and the F-701/F-702/F-703 gate.
- Approved vendor status/category and document/privacy contracts.
- Baseline at draft time: PRD, Roadmap, Design, and Phase 0–1.5 Architecture approved 2026-07-22; `ARCHITECTURE-FUTURE.md` approved as a planning target 2026-07-25; NYC ruleset `nyc.v2.7`, rules schema `popengine-rules/v2`, and scenario fixtures v5 where regulatory output is consumed.
- The approval PR must re-pin any baseline version that changes before approval. A proposed or superseded input blocks implementation.

## Inputs, Outputs, State, Validation, and Errors

- Inputs are organizer-confirmed vendor facts and source-backed requirements; outputs are event-scoped vendor/compliance projections.
- Status and evidence changes append history; unknown requirements remain unresolved.
- A vendor contact is not automatically a marketing contact and carries no attendee consent.
- Missing or unresolved material data stays visibly unset, unknown, pending, or failed as appropriate; it never becomes a successful or complete result.
- Invalid input produces a field or action-specific error without partial mutation. Retriable external failures preserve the user's confirmed state and expose a safe retry.

## UI and Accessibility

- Vendor rows show arrival, contract, permit, insurance, expiration, and unknown states separately rather than one misleading compliance badge.
- The complete workflow is keyboard operable, uses programmatic labels and visible focus, does not encode status by color alone, and announces asynchronous success or failure.
- Empty, loading, permission-denied, validation, provider-failure, and unavailable states have explicit copy and a safe next action.

## System Impact

| Concern              | Proposed impact                                                                                                                      |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| API                  | Vendor, contact, evidence, and history operations require approved OpenAPI contracts.                                                |
| Schema               | Forward migrations for vendors and vendor-compliance links; reuse approved document/certificate records rather than duplicate files. |
| Jobs                 | Optional confirmed-date reminders only through approved jobs; no procurement workflow.                                               |
| Providers            | Private storage/scanning only through existing adapters.                                                                             |
| Privacy and security | Workspace scope, minimal contact access, private documents, retention, and no vendor contact content in logs.                        |

Exact HTTP, JSON Schema, migration, job, and provider shapes belong in their reviewed machine contracts; this proposal does not authorize parallel local types or edits to merged migrations.

## Acceptance Criteria

1. **F214-AC-01:** An authorized organizer can create and update an event vendor with the approved minimal fields and source-linked evidence.
2. **F214-AC-02:** Permit, insurance, contract, and arrival states remain independent; their aggregate describes workflow-record completeness only and never regulatory sufficiency or agency acceptance.
3. **F214-AC-03:** Missing, unknown, expired, conflicting, user-recorded, or not-authoritatively-accepted evidence remains visibly distinct and prevents a regulatory compliance claim.
4. **F214-AC-04:** Status changes and replacement documents preserve actor/time/version history, and preserving that history is not on its own enough to keep two actors from overwriting each other. Every such change supplies the opaque concurrency tokens the actor read for the vendor projection and for each status and evidence record the change touches. In one transaction the server locks those records in a deterministic order, compares every supplied token, appends the history entries, and advances the projection and its tokens; a stale token rejects the whole update as a conflict and mutates nothing. Without that compare-and-swap, two actors editing the same vendor from one observed version are both told their change saved while the later projection silently hides a confirmed update. This is the same rule `docs/EVENT-REVISION-CONTRACT.md` §2.2 applies to stable Event metadata and §2.5 applies to workflow items at plan acceptance; F-214 owns these records, so the exact token representation belongs in its reviewed OpenAPI and forward migration.
5. **F214-AC-05:** Vendor contacts do not enter attendee CRM, campaign eligibility, or consent records automatically.
6. **F214-AC-06:** Each vendor projection pins the exact F-208/F-209/F-210 requirement and evidence versions it consumes. Supersession or removal visibly marks affected projection data stale and excludes it from current workflow completeness until reconciled, while preserving the prior requirement, evidence, and status history.
7. **F214-AC-07:** Creating a vendor binds the request to a stable client-supplied request identity, committed with the vendor under a uniqueness constraint scoped to the event. A retry presenting the same identity returns the original vendor and creates no second row; a deliberately separate vendor uses a new identity. This is request identity, never content uniqueness: two genuinely distinct vendors that read the same, including the same company name and contact, are both created, and a repeated identity is never rejected as a duplicate value.

   AC-04 protects later status and evidence edits with concurrency tokens, and a token can only defend a record that already exists. When creation commits and its response is lost, the retry creates a second vendor and the event carries two records for one supplier. Subsequent permits, certificates, and contracts attach to whichever the organizer happens to open, so AC-02's per-vendor completeness is computed over evidence split across duplicates and reads as incomplete on both.

## Fixtures and Verification

- Planned automated fixture IDs are the acceptance IDs above; each must map one-to-one to a runnable test before approval can claim implementation readiness.
- Regulatory fixtures: Only approved vendor-related findings may seed requirements; vendor records and evidence are synthetic.
- Security-sensitive and cross-workspace paths require negative authorization tests; provider paths require success, duplicate-delivery, retry, invalid-signature, and permanent-failure tests where applicable.

## Allowed Footprint and Coordination

- `apps/web` and `apps/api` feature code and tests.
- New ordered forward migrations and approved OpenAPI/JSON Schema changes required by this feature.
- No repository restructuring, speculative package, or unrelated feature edit.
- Shared contracts, migrations, provider adapters, engine/rules artifacts, consent policy, and cross-lane UI primitives require the approvals named in `docs/DOCUMENTATION-GOVERNANCE.md` §6.

## Rollout and Fallback

- Manual event-scoped tracking only; no vendor portal or provider integration.
- Rollback disables the new surface and workers/provider calls without deleting confirmed user data or rewriting immutable plans, rulesets, revisions, or history.

## Approval Blockers

- Approve minimal vendor fields, source-backed requirement mapping, privacy/retention, and status wording.
- Assign the owner and independent reviewer, approve this spec, and add it to `docs/BASELINE.md`.
