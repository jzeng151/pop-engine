# F-602 · Document Extraction

**Status:** PROPOSED (2026-07-26) — ready for review; not implementable until approved and listed in `docs/BASELINE.md`.

**Phase:** 4 · **Issue:** [#58](https://github.com/jzeng151/pop-engine/issues/58) · **Owner:** TBD · **Reviewer:** product owner plus affected architecture, contract, security, and lane owners (TBD) · **Approval date:** —

## Purpose and User Outcome

An organizer can receive proposed application number, deadline, fee, and status values from a private upload and confirm them before any workflow record changes.

## Scope

**In scope**

- Run approved text/extraction processing on a safe uploaded document and create field-level proposals with page/snippet provenance.
- Accept/edit/reject each proposal through normal validation; a confirmed value for an empty field may enter F-208/F-209, while a confirmed difference from an existing value remains an unapplied typed proposal for F-604.
- Preserve document/extractor/model/version and confirmation actor.

**Non-goals**

- Automatic overwrite, legal interpretation, signature verification, document authenticity, agency acceptance, or invented missing values.
- Making the extracted text a regulatory source.

## Dependencies and Baseline

- F-208, F-209 upload controls, approved jobs/outbox, and the F-701/F-702/F-703 gate.
- AI/OCR provider, file-type, retention, confidence/display, and proposal contracts.
- Baseline at draft time: PRD, Roadmap, Design, and Phase 0–1.5 Architecture approved 2026-07-22; `ARCHITECTURE-FUTURE.md` approved as a planning target 2026-07-25; NYC ruleset `nyc.v2.7`, rules schema `popengine-rules/v2`, and scenario fixtures v5 where regulatory output is consumed.
- The approval PR must re-pin any baseline version that changes before approval. A proposed or superseded input blocks implementation.

## Inputs, Outputs, State, Validation, and Errors

- Input is an authorized safe file; output is zero or more pending field proposals with exact source location when available.
- Proposal state is pending → accepted/edited/rejected; an accepted difference from current state becomes confirmed-but-unapplied for F-604, and later extraction creates a separate run.
- Unreadable, conflicting, ambiguous, or unsupported values remain pending/unavailable; low-confidence values remain pending for explicit review or direct the organizer to manual entry and never become record state from confidence alone.
- Missing or unresolved material data stays visibly unset, unknown, pending, or failed as appropriate; it never becomes a successful or complete result.
- Invalid input produces a field or action-specific error without partial mutation. Retriable external failures preserve the user's confirmed state and expose a safe retry.

## UI and Accessibility

- Side-by-side review shows document location, proposed value/type, confidence limitation, existing value, and explicit per-field action.
- The complete workflow is keyboard operable, uses programmatic labels and visible focus, does not encode status by color alone, and announces asynchronous success or failure.
- Empty, loading, permission-denied, validation, provider-failure, and unavailable states have explicit copy and a safe next action.

## System Impact

| Concern              | Proposed impact                                                                                                                             |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| API                  | Extraction run/status/proposal/confirmation operations require approved OpenAPI contracts.                                                  |
| Schema               | Forward migrations for extraction runs/proposals/confirmations linked to private document versions.                                         |
| Jobs                 | Durable scan-then-extract job chain with idempotency, timeout, bounded retry, cancellation, and dead-letter state.                          |
| Providers            | Private storage/scanning plus approved OCR/AI adapter.                                                                                      |
| Privacy and security | Strict file validation/scan, signed access, provider minimization/retention, prompt injection controls, redacted logs, and workspace scope. |

Exact HTTP, JSON Schema, migration, job, and provider shapes belong in their reviewed machine contracts; this proposal does not authorize parallel local types or edits to merged migrations.

## Acceptance Criteria

1. **F602-AC-01:** Only a safe authorized document version can start extraction, and every proposal links to that exact version/run/source location.
2. **F602-AC-02:** Application number, agency-provided deadline, and status remain proposals until explicit user acceptance/edit through F-208 validation; fee remains a proposal until explicit user acceptance/edit through F-209 validation.
3. **F602-AC-03:** Existing confirmed values are never overwritten; accepting a difference creates a source-linked, typed, confirmed-but-unapplied proposal for F-604 rather than appending domain history.
4. **F602-AC-04:** Unreadable, ambiguous, conflicting, or unsupported content cannot create a confirmed workflow fact; low-confidence content stays pending until an organizer verifies and accepts/edits it against the displayed source, or is suppressed as a proposal in favor of manual entry.
5. **F602-AC-05:** Duplicate/retried extraction of the same request does not create duplicate accepted proposals or records.

## Fixtures and Verification

- Planned automated fixture IDs are the acceptance IDs above; each must map one-to-one to a runnable test before approval can claim implementation readiness.
- Regulatory fixtures: Synthetic document fixtures only; no extracted value becomes regulatory ground truth.
- Security-sensitive and cross-workspace paths require negative authorization tests; provider paths require success, duplicate-delivery, retry, invalid-signature, and permanent-failure tests where applicable.

## Allowed Footprint and Coordination

- `apps/web` and `apps/api` feature code and tests.
- New ordered forward migrations and approved OpenAPI/JSON Schema changes required by this feature.
- No repository restructuring, speculative package, or unrelated feature edit.
- Shared contracts, migrations, provider adapters, engine/rules artifacts, consent policy, and cross-lane UI primitives require the approvals named in `docs/DOCUMENTATION-GOVERNANCE.md` §6.

## Rollout and Fallback

- Keep manual F-208/F-209 entry available; disable extraction if provider/privacy/file checks fail.
- Rollback disables the new surface and workers/provider calls without deleting confirmed user data or rewriting immutable plans, rulesets, revisions, or history.

## Approval Blockers

- Approve upload/scanning and OCR/AI provider ADRs, supported file limits, retention, proposal UX, and evaluation fixtures.
- Assign the owner and independent reviewer, approve this spec, and add it to `docs/BASELINE.md`.
