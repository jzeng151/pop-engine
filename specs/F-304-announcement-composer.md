# F-304 · Announcement Composer

**Status:** PROPOSED (2026-07-26) — ready for review; not implementable until approved and listed in `docs/BASELINE.md`.

**Phase:** 2 · **Issue:** [#21](https://github.com/jzeng151/pop-engine/issues/21) · **Owner:** TBD · **Reviewer:** product owner plus affected architecture, contract, security, and lane owners (TBD) · **Approval date:** —

## Purpose and User Outcome

An organizer can generate editable Instagram, email, and SMS drafts from confirmed event data without letting AI publish, send, or invent regulatory claims.

## Scope

**In scope**

- Generate separate draft copy for Instagram caption, email, and SMS through the approved AI gateway.
- Show source event facts, allow editing/regeneration/copy, and retain prompt/model provenance needed for review.
- Filter private and unsupported fields before the provider call.

**Non-goals**

- Publishing, sending, social account connections, campaign scheduling, images, or engagement analytics.
- AI-authored regulatory advice, permit completeness claims, or unconfirmed event facts.

## Dependencies and Baseline

- F-101 confirmed event data and the F-701/F-702/F-703 gate. F-702 supplies the workspace membership boundary the event and its AI runs and drafts resolve against and F-703 supplies the permission matrix `F304-AC-07` checks; F-701 supplies the authenticated actor both read from. All three are PROPOSED, so the gate is not an approved input today and this spec is not implementable against it until they are approved and listed in `docs/BASELINE.md`.
- ADR for the AI gateway, provider/model, retention, prompt versioning, and evaluation.
- Baseline at draft time: PRD, Roadmap, Design, and Phase 0–1.5 Architecture approved 2026-07-22; `ARCHITECTURE-FUTURE.md` approved as a planning target 2026-07-25; NYC ruleset `nyc.v2.7`, rules schema `popengine-rules/v2`, and scenario fixtures v5 where regulatory output is consumed.
- Operand binding for client-supplied identities: `specs/F-411-staff-roles-credentialed-entry.md` F411-AC-08 states once, for this whole branch, that a client-supplied identity is committed with the operands that determine its recorded result and that a reuse carrying different operands is a conflict rather than a replay. Every identity criterion below relies on it. F-411 is PROPOSED, so that rule is not an approved input today and this spec is not implementable against it until F-411 is approved or the rule is promoted to an approved shared invariant; F411-AC-08 records both paths.
- The approval PR must re-pin any baseline version that changes before approval. A proposed or superseded input blocks implementation.

## Inputs, Outputs, State, Validation, and Errors

- Inputs are organizer-selected confirmed public facts from an exact event revision, the Event concurrency token, the lifecycle generation, and the exact version of every other selected fact, plus tone; outputs are non-authoritative editable drafts labeled as AI-generated and pinned to all of those under F304-AC-01.
- Draft state is requested → generated, stale, failed, or rejected by policy; a change to any pinned version, including the Event concurrency token, makes the draft visibly stale before copy, and generation never mutates event data or publishes content.
- Unsupported, unknown, private, and regulatory-sensitive fields are excluded or represented only by approved plan wording.
- Missing or unresolved material data stays visibly unset, unknown, pending, or failed as appropriate; it never becomes a successful or complete result.
- Invalid input produces a field or action-specific error without partial mutation. Retriable external failures preserve the user's confirmed state and expose a safe retry.

## UI and Accessibility

- Each channel has character guidance, source-fact preview, edit/copy controls, AI label, failure state, and manual blank-start fallback.
- The complete workflow is keyboard operable, uses programmatic labels and visible focus, does not encode status by color alone, and announces asynchronous success or failure.
- Empty, loading, permission-denied, validation, provider-failure, and unavailable states have explicit copy and a safe next action.

## System Impact

| Concern              | Proposed impact                                                                                                                                           |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| API                  | AI-run create/status/result operations require an approved OpenAPI contract and bounded input/output sizes.                                               |
| Schema               | Forward migration only for the minimal AI run, prompt version, redacted input references, and draft provenance required by policy.                        |
| Jobs                 | Durable bounded AI job with timeout, cancellation, retry policy, and idempotency.                                                                         |
| Providers            | One AI model/provider behind the gateway adapter.                                                                                                         |
| Privacy and security | Data minimization, workspace scope, prompt-injection boundaries, redacted logs, retention limits, and provider training/retention settings are mandatory. |

Exact HTTP, JSON Schema, migration, job, and provider shapes belong in their reviewed machine contracts; this proposal does not authorize parallel local types or edits to merged migrations.

## Acceptance Criteria

1. **F304-AC-01:** For one confirmed event snapshot, the composer returns distinct Instagram, email, and SMS drafts tied to the exact event revision, the Event concurrency token `docs/EVENT-REVISION-CONTRACT.md` §2.2 returns from the Event read, the lifecycle generation, the exact version of every other selected fact the draft is composed from, and the prompt/model version. Each of those is pinned at generation and rechecked before copy and before any organizer reconciliation; a newer value for any of them visibly invalidates the drafts and blocks copy until regeneration against, or explicit organizer reconciliation with, the current state. Cancellation or archival therefore cannot leave a prior event-advertising draft copyable.

   The Event concurrency token is pinned alongside the revision because the revision does not move when stable Event metadata does. `docs/EVENT-REVISION-CONTRACT.md` §2.2 keeps the organizer-facing name and the other stable metadata outside `answers_json`, and a metadata-only update advances only the Event token and explicitly appends no revision. A draft generated before the organizer renamed the event therefore passes a revision-and-lifecycle recheck unchanged while advertising a name that no longer exists, which is the concrete claim F304-AC-04 requires to match an exact confirmed source fact. Every other selected fact is named for the same reason and not as redundancy: the composer draws from more than the questionnaire, and a fact whose own version advanced without moving the revision or the token would leave the same stale claim copyable.

2. **F304-AC-02:** The provider receives only the organizer-approved public fields shown in the preview; private documents, contacts, and hidden intake values are absent.
3. **F304-AC-03:** Drafts cannot send or publish, and copying/editing a draft does not mutate the event or approved plan.
4. **F304-AC-04:** Generated text cannot add a regulatory deadline, fee, agency, permit, completeness claim, or requirement not present in approved source wording. Every other concrete event claim must match an exact confirmed source fact shown in the preview; otherwise the draft is rejected before copy with an action to confirm or correct the authoritative event data and regenerate.
5. **F304-AC-05:** Timeout, policy rejection, provider failure, and unsafe output show a recoverable error and preserve manual composition.
6. **F304-AC-06:** Starting a generation binds the request to a stable client-supplied request identity, committed with the run under a uniqueness constraint scoped to the event. A retry presenting the same identity returns the original run and its drafts and starts no second provider call; a deliberate regeneration sends a new identity. This is request identity, never content uniqueness: two genuinely distinct generations from one event revision, lifecycle generation, and prompt/model version are both recorded, and a repeated identity is never rejected as a duplicate value. That identity binds its operands under the rule `F411-AC-08` states once for every client-supplied identity on this branch: it is committed together with the request fields that determine the recorded result, including every aggregate, version, and generation the request names, and a later request presenting the same identity with any different operand is refused as a conflict rather than being answered with the stored result. The identity is still the key and the operands are only a precondition on reusing it, so this is not the content uniqueness this criterion already forbids.

   The System Impact table names idempotency, which is not a criterion an implementation is held to, and AC-01 pins the source versions rather than the request. When the run commits and its response is lost, the retry spends provider quota a second time and produces a second independently editable draft set for one organizer action, with nothing to say which set the organizer's later edits belong to.

7. **F304-AC-07:** Every operation this feature defines names the event it acts in and the workspace that owns it, and is admitted only by the acting actor's current F-702 membership of that workspace together with the F-703 permission approved for the action, both re-read server-side from stored membership and role at the moment of the operation and, for a write, inside the same transaction that commits it. That covers starting a generation and its AI run create under F304-AC-06, every run status and result read, draft retrieval and the source-fact preview under F304-AC-01 and F304-AC-02, copying, editing, and regenerating a draft and the pre-copy recheck under F304-AC-01 and F304-AC-03, and the explicit organizer reconciliation F304-AC-01 defines. A request failing the check is refused before any durable write and before any confirmed event fact, source-fact preview, draft, or run result is disclosed, and a refused generation issues no provider call, so a caller the check turns away sends nothing of the event to the provider either. Its response does not distinguish an event or run that does not exist from one the actor may not see. The check is at the operation and not at session start or workspace switch, so authority removed while a request is in flight causes that request to fail rather than commit.

   Without this criterion AC-01 through AC-06 all pass for a caller who names another workspace's event. They fix version pinning, the field filter the provider receives, the no-publish rule, the prohibited-claim check, failure recovery, and request identity, and not one of them asks who the actor is: AC-02's filter constrains which fields reach the provider, not who may trigger the call. A conforming implementation can therefore disclose another organizer's confirmed event details to the caller and to the provider, then return copyable drafts advertising an event the caller has no membership in.

   One input this criterion needs is not established by any approved artifact today and is not invented here. F-703 is PROPOSED and names no role set, so the permission above cannot be named. Until F-703 is approved this criterion is testable only as "every generation start, run read, draft retrieval, preview, copy, edit, regeneration, and reconciliation is refused unless the acting actor holds an active membership of the workspace that owns the named event, read server-side at that operation, and a refusal discloses nothing about whether that event or run exists", not against a named role or permission identifier. Naming the generation and draft permissions with F-703 is an approval blocker below.

## Fixtures and Verification

- Planned automated fixture IDs are the acceptance IDs above; each must map one-to-one to a runnable test before approval can claim implementation readiness.
- F304-AC-01 includes a fixture in which a metadata-only rename advances the Event concurrency token without appending a revision, and the draft naming the old name is blocked from copy until regeneration or explicit reconciliation.
- Regulatory fixtures: Use approved scenario findings only as a prohibited-claim regression corpus; generated text is never a regulatory fixture.
- F304-AC-07 includes a fixture in which an actor holding no membership of the owning workspace names a valid event and run and is refused at generation start, at every run and draft read, at preview, and at copy, with a response that does not distinguish absence from denial and with no provider call issued, and a fixture in which authority removed while a generation request is in flight fails that request rather than committing a run.
- Security-sensitive and cross-workspace paths require negative authorization tests; provider paths require success, duplicate-delivery, retry, invalid-signature, and permanent-failure tests where applicable.

## Allowed Footprint and Coordination

- `apps/web` and `apps/api` feature code and tests.
- New ordered forward migrations and approved OpenAPI/JSON Schema changes required by this feature.
- No repository restructuring, speculative package, or unrelated feature edit.
- Shared contracts, migrations, provider adapters, engine/rules artifacts, consent policy, and cross-lane UI primitives require the approvals named in `docs/DOCUMENTATION-GOVERNANCE.md` §6.

## Rollout and Fallback

- Feature-flag the AI gateway; manual channel-specific composition remains available when the flag/provider is off.
- Rollback disables the new surface and workers/provider calls without deleting confirmed user data or rewriting immutable plans, rulesets, revisions, or history.

## Approval Blockers

- Approve AI gateway/provider ADR, privacy review, prompt/evaluation set, cost limits, and prohibited-claim checks.
- Approve F-701, F-702, and F-703, and name with F-703 the generation and draft permissions `F304-AC-07` checks. That criterion checks a permission no approved artifact defines today and may not invent one, so until the matrix names them it is testable only at the membership level stated there.
- Assign the owner and independent reviewer, approve this spec, and add it to `docs/BASELINE.md`.
