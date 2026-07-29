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

- F-101 confirmed event data and the F-701/F-702/F-703 gate.
- ADR for the AI gateway, provider/model, retention, prompt versioning, and evaluation.
- Baseline at draft time: PRD, Roadmap, Design, and Phase 0–1.5 Architecture approved 2026-07-22; `ARCHITECTURE-FUTURE.md` approved as a planning target 2026-07-25; NYC ruleset `nyc.v2.7`, rules schema `popengine-rules/v2`, and scenario fixtures v5 where regulatory output is consumed.
- The approval PR must re-pin any baseline version that changes before approval. A proposed or superseded input blocks implementation.

## Inputs, Outputs, State, Validation, and Errors

- Inputs are organizer-selected confirmed public facts from an exact event revision and tone; outputs are non-authoritative editable drafts labeled as AI-generated and pinned to that revision.
- Draft state is requested → generated, stale, failed, or rejected by policy; a source-revision change makes the draft visibly stale before copy, and generation never mutates event data or publishes content.
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

1. **F304-AC-01:** For one confirmed event snapshot, the composer returns distinct Instagram, email, and SMS drafts tied to the exact event revision and prompt/model version; a newer source revision visibly invalidates or warns on those drafts before copy.
2. **F304-AC-02:** The provider receives only the organizer-approved public fields shown in the preview; private documents, contacts, and hidden intake values are absent.
3. **F304-AC-03:** Drafts cannot send or publish, and copying/editing a draft does not mutate the event or approved plan.
4. **F304-AC-04:** Generated text cannot add a regulatory deadline, fee, agency, permit, completeness claim, or requirement not present in approved source wording.
5. **F304-AC-05:** Timeout, policy rejection, provider failure, and unsafe output show a recoverable error and preserve manual composition.

## Fixtures and Verification

- Planned automated fixture IDs are the acceptance IDs above; each must map one-to-one to a runnable test before approval can claim implementation readiness.
- Regulatory fixtures: Use approved scenario findings only as a prohibited-claim regression corpus; generated text is never a regulatory fixture.
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
- Assign the owner and independent reviewer, approve this spec, and add it to `docs/BASELINE.md`.
