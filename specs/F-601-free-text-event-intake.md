# F-601 · Free-Text Event Intake

**Status:** PROPOSED (2026-07-26) — ready for review; not implementable until approved and listed in `docs/BASELINE.md`.

**Phase:** 4 · **Issue:** [#57](https://github.com/jzeng151/pop-engine/issues/57) · **Owner:** TBD · **Reviewer:** product owner plus affected architecture, contract, security, and lane owners (TBD) · **Approval date:** —

## Purpose and User Outcome

An organizer can describe an event in free text and receive proposed structured F-101 answers, but only confirmed values reach coverage classification or evaluation.

## Scope

**In scope**

- Send bounded organizer text through the approved AI gateway and map proposals only to current intake-registry fields/options.
- Show evidence snippets/confidence where available, allow accept/edit/reject per field, and run F-109 coverage classification.
- Create a normal event draft/revision only from explicit confirmations.

**Non-goals**

- Direct evaluation of free text, automatic submission, new intake fields, regulatory interpretation, or silent defaulting.
- Using AI output as a regulatory source.

## Dependencies and Baseline

- F-101, F-109, F-304 AI gateway, Event Revisions, and the F-701/F-702/F-703 gate.
- Approved prompt/model, extraction evaluation set, privacy, retention, and field-confirmation contract.
- Baseline at draft time: PRD, Roadmap, Design, and Phase 0–1.5 Architecture approved 2026-07-22; `ARCHITECTURE-FUTURE.md` approved as a planning target 2026-07-25; NYC ruleset `nyc.v2.7`, rules schema `popengine-rules/v2`, and scenario fixtures v5 where regulatory output is consumed.
- The approval PR must re-pin any baseline version that changes before approval. A proposed or superseded input blocks implementation.

## Inputs, Outputs, State, Validation, and Errors

- Input is bounded free text plus registry/version; output is field-level proposals with provenance and no committed answers.
- Each proposal is pending → accepted/edited/rejected; only accepted/edited values enter the draft.
- Unsupported concepts, ambiguity, missing material facts, model failure, and unsafe content remain visible through F-109 or manual intake.
- Missing or unresolved material data stays visibly unset, unknown, pending, or failed as appropriate; it never becomes a successful or complete result.
- Invalid input produces a field or action-specific error without partial mutation. Retriable external failures preserve the user's confirmed state and expose a safe retry.

## UI and Accessibility

- Review lists original text and every proposed field/value/reason, supports keyboard bulk navigation but requires explicit material confirmation.
- The complete workflow is keyboard operable, uses programmatic labels and visible focus, does not encode status by color alone, and announces asynchronous success or failure.
- Empty, loading, permission-denied, validation, provider-failure, and unavailable states have explicit copy and a safe next action.

## System Impact

| Concern              | Proposed impact                                                                                                                       |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| API                  | AI proposal/run/status/confirmation operations require approved OpenAPI/JSON Schema contracts tied to registry version.               |
| Schema               | Forward migration only for bounded AI run/proposal/confirmation provenance; authoritative answers remain Event Revision data.         |
| Jobs                 | Durable AI job with timeout, cancellation, bounded retry, idempotency, and cost limits.                                               |
| Providers            | Approved AI gateway/provider only.                                                                                                    |
| Privacy and security | Data minimization, prompt-injection handling, redacted logs, provider retention/training settings, workspace scope, and abuse limits. |

Exact HTTP, JSON Schema, migration, job, and provider shapes belong in their reviewed machine contracts; this proposal does not authorize parallel local types or edits to merged migrations.

## Acceptance Criteria

1. **F601-AC-01:** The model can propose only fields/options present in the exact current intake registry and cannot create an endpoint, enum, or rule.
2. **F601-AC-02:** No proposed value reaches coverage classification/evaluation until the user accepts or edits it.
3. **F601-AC-03:** Material ambiguity, unsupported scope, or missing facts produces the appropriate F-109 state and cannot yield a complete-plan claim.
4. **F601-AC-04:** Rejecting a proposal leaves the corresponding answer absent; editing uses normal F-101 validation.
5. **F601-AC-05:** Provider/model/prompt failure preserves the original text and offers the complete manual F-101 path.

## Fixtures and Verification

- Planned automated fixture IDs are the acceptance IDs above; each must map one-to-one to a runnable test before approval can claim implementation readiness.
- Regulatory fixtures: A reviewed paraphrase corpus for scenarios A–F plus ambiguous/unsupported/adversarial descriptions; engine expectations remain the approved structured fixtures.
- Security-sensitive and cross-workspace paths require negative authorization tests; provider paths require success, duplicate-delivery, retry, invalid-signature, and permanent-failure tests where applicable.

## Allowed Footprint and Coordination

- `apps/web` and `apps/api` feature code and tests.
- New ordered forward migrations and approved OpenAPI/JSON Schema changes required by this feature.
- No repository restructuring, speculative package, or unrelated feature edit.
- Shared contracts, migrations, provider adapters, engine/rules artifacts, consent policy, and cross-lane UI primitives require the approvals named in `docs/DOCUMENTATION-GOVERNANCE.md` §6.

## Rollout and Fallback

- Feature-flag AI intake; manual F-101 remains fully available and authoritative.
- Rollback disables the new surface and workers/provider calls without deleting confirmed user data or rewriting immutable plans, rulesets, revisions, or history.

## Approval Blockers

- F-109 must be approved and shipped.
- Approve AI gateway/privacy/cost decisions and an independently reviewed proposal evaluation set.
- Assign the owner and independent reviewer, approve this spec, and add it to `docs/BASELINE.md`.
