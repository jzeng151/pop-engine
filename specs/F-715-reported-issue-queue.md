# F-715 · Rules Admin: Reported-Issue Queue

**Status:** PROPOSED (2026-07-26) — ready for review; not implementable until approved and listed in `docs/BASELINE.md`.

**Phase:** 4 · **Issue:** [#68](https://github.com/jzeng151/pop-engine/issues/68) · **Owner:** TBD · **Reviewer:** product owner plus affected architecture, contract, security, and lane owners (TBD) · **Approval date:** —

## Purpose and User Outcome

A user can report a possibly wrong, missing, or outdated requirement with exact plan context, and the verification team can triage it without the report becoming regulatory authority.

## Scope

**In scope**

- Capture category, user explanation, exact jurisdiction/ruleset/plan revision, finding/rule context when the category has one, bounded optional contact follow-up, and safe attachment if approved.
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

- Inputs are bounded user report, a client-supplied submission identity under F715-AC-08, and system-captured immutable context; output is a non-authoritative queue item/receipt.
- State is new → triaged → needs-research, linked, resolved, dismissed, or closed under the approved vocabulary; the current triage version advances with every append-only transition.
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

1. **F715-AC-01:** A report captures the exact safe jurisdiction, ruleset, plan revision, category, and user explanation available at submission. Finding/rule identity is required for a report about an existing finding and absent for a missing-requirement report; the latter never fabricates or misattributes one.
2. **F715-AC-02:** Submitting a report does not change any plan, finding, rule, verification status, current pointer, or user-visible regulatory claim.
3. **F715-AC-03:** Every triage mutation binds a stable request identity and compare-and-swaps the expected immutable report version plus current triage version. Success atomically records actor/time/reason, advances state/version, and enqueues any required downstream research; a recognized retry returns that result, while a mismatch changes no history, state, or downstream work and requires rebuilt triage.
4. **F715-AC-04:** Duplicate/link handling preserves each report and cannot inflate evidence or erase reporter context.
5. **F715-AC-05:** Unauthorized, abusive, oversized, unsafe, or cross-workspace submissions are rejected/quarantined without exposing private plan data.
6. **F715-AC-06:** Successful submission returns an opaque receipt; an authenticated reporter uses their identity, while any separately approved anonymous mode issues an additional unguessable status credential shown once. Only that reporter/credential or an authorized triage actor can retrieve bounded non-authoritative status, with no private plan, queue, other-reporter, or internal triage context. In the anonymous mode the credential is bound to a reporter-held secret or stable submission identity established before the report commits, and the same transaction that creates the report commits that binding, so a submission whose response is lost is recoverable: a retry presenting the same secret or identity is recognized and returns the original report's receipt rather than creating a second report or being refused as a duplicate. Recovery proves possession of that secret and grants nothing an authorized retrieval would not, and an unrecognized retry remains a new report.
7. **F715-AC-07:** When the separately approved attachment mode is enabled, attachments remain in private storage; every download issuance rechecks current reporter/triage authorization and scan state and returns only a short-lived signed URL. Authorization loss blocks new URLs, and an issued direct-storage URL has only its disclosed bounded validity until expiry.
8. **F715-AC-08:** Every submission, authenticated and anonymous alike, carries a client-supplied submission identity, and the same transaction that creates the queue item commits that identity under a uniqueness constraint scoped to the reporting account for an authenticated report and to the approved public submission scope for an anonymous one. In that anonymous scope the submission identity alone retrieves nothing: the transaction that records the identity also binds it to the F715-AC-06 reporter-held secret, and a retry counts as the same submission only when it presents that secret, which the server verifies before returning anything. A retry presenting a known identity without the matching secret returns no receipt, no report, and no indication that the identity exists; it creates no second queue item and is not admitted as a new report under that identity, so a second reporter who guesses or deliberately collides with another reporter's identity is told to submit under a new one and learns nothing about the first. Without that binding an identity scoped to a public namespace is a bearer key, and AC-06's credential-based retrieval restriction is bypassed by replaying this criterion instead of satisfying that one. A retry presenting the same identity, and in the anonymous scope its bound secret, returns the original receipt and report, creates no second queue item, and enqueues no second triage, notification, or attachment-scanning work; a deliberately separate report sends a new identity. This is submission identity, never content uniqueness: one reporter may legitimately file two reports carrying the same category, explanation, and captured jurisdiction, ruleset, plan-revision, and finding context, so neither the payload nor the system-captured context may serve as the key, and a repeated identity is never rejected as a duplicate value. The reporter's account identity is not that key either, because the same account must be able to submit many distinct reports.

   F715-AC-06 establishes a recoverable binding only inside the separately approved anonymous mode, so the authenticated path, which Rollout and Fallback starts with, is the one that ships with nothing to replay. When the submission transaction commits and its response is lost, the reporter retries and one report becomes two queue items and two receipts. F715-AC-04 runs after the fact and preserves each report by construction, so linking them cannot undo the triage, notification, and attachment-scanning work the duplicate already caused, and the verification team is left with two independently triageable items for one user action.

## Fixtures and Verification

- Planned automated fixture IDs are the acceptance IDs above; each must map one-to-one to a runnable test before approval can claim implementation readiness.
- Regulatory fixtures: Synthetic reports attached to approved scenario findings plus missing-requirement reports with no finding/rule identity, including wrong/missing/outdated/duplicate/abusive cases; reports are never ground truth.
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
