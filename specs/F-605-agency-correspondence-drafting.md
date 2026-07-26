# F-605 · Agency Correspondence Drafting

**Status:** PROPOSED (2026-07-26) — ready for review; not implementable until approved and listed in `docs/BASELINE.md`.

**Phase:** 4 · **Issue:** [#61](https://github.com/jzeng151/pop-engine/issues/61) · **Owner:** TBD · **Reviewer:** product owner plus affected architecture, contract, security, and lane owners (TBD) · **Approval date:** —

## Purpose and User Outcome

An organizer can create an editable draft to an agency from confirmed event/application facts while PopEngine never sends it or invents a regulatory claim.

## Scope

**In scope**

- Generate a draft subject/body for an organizer-selected purpose using approved AI gateway and selected confirmed facts.
- Preview sources, edit, regenerate, and copy/download the draft.
- Label AI provenance and prohibit sending/provider account connection.

**Non-goals**

- Auto-send, mailbox integration, legal advice, representation as an attorney/agency, fabricated permit/deadline/fee, or attachments.
- Using agency correspondence as a regulatory source before normal review.

## Dependencies and Baseline

- F-208/F-209 confirmed records and F-304 AI gateway.
- Approved drafting purposes/templates, data selection, prompt/model, privacy, and prohibited-claim evaluation.
- Baseline at draft time: PRD, Roadmap, Design, and Phase 0–1.5 Architecture approved 2026-07-22; `ARCHITECTURE-FUTURE.md` approved as a planning target 2026-07-25; NYC ruleset `nyc.v2.7`, rules schema `popengine-rules/v2`, and scenario fixtures v5 where regulatory output is consumed.
- The approval PR must re-pin any baseline version that changes before approval. A proposed or superseded input blocks implementation.

## Inputs, Outputs, State, Validation, and Errors

- Inputs are organizer-selected confirmed facts and purpose; output is a non-authoritative editable draft tied to exact source versions.
- State is requested → generated, failed, or policy-rejected; edit/copy creates no application/email mutation.
- Unknown/conflicting/unverified values are omitted or explicitly described using approved source wording, never completed by the model.
- Missing or unresolved material data stays visibly unset, unknown, pending, or failed as appropriate; it never becomes a successful or complete result.
- Invalid input produces a field or action-specific error without partial mutation. Retriable external failures preserve the user's confirmed state and expose a safe retry.

## UI and Accessibility

- Source-fact preview, AI label, editable text, copy/download, manual blank fallback, and explicit 'not sent' state remain visible.
- The complete workflow is keyboard operable, uses programmatic labels and visible focus, does not encode status by color alone, and announces asynchronous success or failure.
- Empty, loading, permission-denied, validation, provider-failure, and unavailable states have explicit copy and a safe next action.

## System Impact

| Concern              | Proposed impact                                                                                                                                         |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| API                  | Draft run/status/result operations require approved OpenAPI contracts and bounded content.                                                              |
| Schema               | Reuse minimal AI run/provenance; persist drafts only if retention need is approved.                                                                     |
| Jobs                 | Durable AI job with timeout, cancellation, retry/cost bounds, and idempotency.                                                                          |
| Providers            | Approved AI gateway only; no email sending provider.                                                                                                    |
| Privacy and security | Data minimization, private document exclusion by default, prompt-injection protection, provider retention controls, workspace scope, and redacted logs. |

Exact HTTP, JSON Schema, migration, job, and provider shapes belong in their reviewed machine contracts; this proposal does not authorize parallel local types or edits to merged migrations.

## Acceptance Criteria

1. **F605-AC-01:** The organizer sees and confirms every source fact before generation, and the result records exact source/prompt/model versions.
2. **F605-AC-02:** The draft cannot send, schedule, connect a mailbox, or mutate application/ledger state.
3. **F605-AC-03:** No generated deadline, fee, agency, permit, status, completeness, or legal claim may exceed approved selected source facts.
4. **F605-AC-04:** Unknown/conflicting facts remain omitted or explicitly unresolved and never become confident prose.
5. **F605-AC-05:** Provider failure preserves manual drafting and confirmed source records.

## Fixtures and Verification

- Planned automated fixture IDs are the acceptance IDs above; each must map one-to-one to a runnable test before approval can claim implementation readiness.
- Regulatory fixtures: A prohibited-claim corpus built from approved findings; generated prose is not a regulatory fixture.
- Security-sensitive and cross-workspace paths require negative authorization tests; provider paths require success, duplicate-delivery, retry, invalid-signature, and permanent-failure tests where applicable.

## Allowed Footprint and Coordination

- `apps/web` and `apps/api` feature code and tests.
- New ordered forward migrations and approved OpenAPI/JSON Schema changes required by this feature.
- No repository restructuring, speculative package, or unrelated feature edit.
- Shared contracts, migrations, provider adapters, engine/rules artifacts, consent policy, and cross-lane UI primitives require the approvals named in `docs/DOCUMENTATION-GOVERNANCE.md` §6.

## Rollout and Fallback

- Feature-flag AI; blank/manual drafting and copy remain the fallback.
- Rollback disables the new surface and workers/provider calls without deleting confirmed user data or rewriting immutable plans, rulesets, revisions, or history.

## Approval Blockers

- Approve drafting purposes/templates, AI/privacy ADRs, source allow-list, retention, and prohibited-claim evaluation.
- Assign the owner and independent reviewer, approve this spec, and add it to `docs/BASELINE.md`.
