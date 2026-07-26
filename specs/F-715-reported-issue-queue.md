# F-715 · Rules Admin: Reported-Issue Queue

**Status:** PROPOSED (2026-07-26) — ready for review; not implementable until approved and listed in `docs/BASELINE.md`.

**Phase:** 4 · **Issue:** [#68](https://github.com/jzeng151/pop-engine/issues/68) · **Owner:** TBD · **Reviewer:** product owner plus affected architecture, contract, security, and lane owners (TBD) · **Approval date:** —

## Purpose and User Outcome

A user can report a possibly wrong, missing, or outdated requirement with exact plan context, and the verification team can triage it without the report becoming regulatory authority.

## Scope

**In scope**

- Capture category, user explanation, exact jurisdiction/ruleset/revision/finding context, bounded optional contact follow-up, and safe attachment if approved.
- Deduplicate/link related reports, triage, request research, close with reason, and route accepted work into F-711/F-710.
- Show the reporter a receipt and status that makes no correction promise.

**Non-goals**

- Changing a plan/rule/status automatically, crowdsourced voting, public issue disclosure, agency complaints, or treating reports as evidence.
- Guaranteeing response/resolution time without an approved service policy.

## Dependencies and Baseline

- F-703 roles, F-711/F-710 review workflow, and approved retention/contact/attachment policy.
- Public/authenticated report abuse controls and triage state vocabulary.
- Baseline at draft time: PRD, Roadmap, Design, and Phase 0–1.5 Architecture approved 2026-07-22; `ARCHITECTURE-FUTURE.md` approved as a planning target 2026-07-25; NYC ruleset `nyc.v2.7`, rules schema `popengine-rules/v2`, and scenario fixtures v5 where regulatory output is consumed.
- The approval PR must re-pin any baseline version that changes before approval. A proposed or superseded input blocks implementation.

## Inputs, Outputs, State, Validation, and Errors

- Inputs are bounded user report and system-captured immutable context; output is a non-authoritative queue item/receipt.
- State is new → triaged → needs-research, linked, resolved, dismissed, or closed under the approved vocabulary; every transition appends history.
- Missing context, duplicate, abusive content, or reporter disagreement never changes published output.
- Missing or unresolved material data stays visibly unset, unknown, pending, or failed as appropriate; it never becomes a successful or complete result.
- Invalid input produces a field or action-specific error without partial mutation. Retriable external failures preserve the user's confirmed state and expose a safe retry.

## UI and Accessibility

- Report form pre-fills safe context, warns against sensitive data, supports accessible errors/receipt, and queue shows source/report distinction.
- The complete workflow is keyboard operable, uses programmatic labels and visible focus, does not encode status by color alone, and announces asynchronous success or failure.
- Empty, loading, permission-denied, validation, provider-failure, and unavailable states have explicit copy and a safe next action.

## System Impact

| Concern              | Proposed impact                                                                                                                                     |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| API                  | Report create/receipt and admin triage/history operations require approved OpenAPI contracts and rate limits.                                       |
| Schema               | Forward migrations for issue reports, immutable context, triage history, duplicate links, and optional safe contact/attachment references.          |
| Jobs                 | Optional notifications and attachment scanning through approved jobs.                                                                               |
| Providers            | Private storage/scanning only if attachments are approved; notification adapters only if policy requires.                                           |
| Privacy and security | Rate limits/spam controls, content bounds, workspace/plan authorization, data minimization, signed files, redacted logs, and separate admin access. |

Exact HTTP, JSON Schema, migration, job, and provider shapes belong in their reviewed machine contracts; this proposal does not authorize parallel local types or edits to merged migrations.

## Acceptance Criteria

1. **F715-AC-01:** A report captures the exact safe jurisdiction, ruleset, plan revision, finding/rule identity, category, and user explanation available at submission.
2. **F715-AC-02:** Submitting a report does not change any plan, finding, rule, verification status, current pointer, or user-visible regulatory claim.
3. **F715-AC-03:** Every triage transition records actor/time/reason and preserves original report/context.
4. **F715-AC-04:** Duplicate/link handling preserves each report and cannot inflate evidence or erase reporter context.
5. **F715-AC-05:** Unauthorized, abusive, oversized, unsafe, or cross-workspace submissions are rejected/quarantined without exposing private plan data.

## Fixtures and Verification

- Planned automated fixture IDs are the acceptance IDs above; each must map one-to-one to a runnable test before approval can claim implementation readiness.
- Regulatory fixtures: Synthetic reports attached to approved scenario findings, including wrong/missing/outdated/duplicate/abusive cases; reports are never ground truth.
- Security-sensitive and cross-workspace paths require negative authorization tests; provider paths require success, duplicate-delivery, retry, invalid-signature, and permanent-failure tests where applicable.

## Allowed Footprint and Coordination

- `apps/web` and `apps/api` feature code and tests.
- New ordered forward migrations and approved OpenAPI/JSON Schema changes required by this feature.
- No repository restructuring, speculative package, or unrelated feature edit.
- Shared contracts, migrations, provider adapters, engine/rules artifacts, consent policy, and cross-lane UI primitives require the approvals named in `docs/DOCUMENTATION-GOVERNANCE.md` §6.

## Rollout and Fallback

- Start authenticated and attachment-free; public submission/attachments require separate abuse and retention readiness.
- Rollback disables the new surface and workers/provider calls without deleting confirmed user data or rewriting immutable plans, rulesets, revisions, or history.

## Approval Blockers

- Approve category/state vocabulary, triage ownership/SLA wording, retention/contact policy, abuse controls, and attachment decision.
- Assign the owner and independent reviewer, approve this spec, and add it to `docs/BASELINE.md`.
