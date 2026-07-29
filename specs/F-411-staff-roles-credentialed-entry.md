# F-411 · Staff Roles and Credentialed Entry

**Status:** PROPOSED (2026-07-26) — ready for review; not implementable until approved and listed in `docs/BASELINE.md`.

**Phase:** 3 · **Issue:** [#43](https://github.com/jzeng151/pop-engine/issues/43) · **Owner:** TBD · **Reviewer:** product owner plus affected architecture, contract, security, and lane owners (TBD) · **Approval date:** —

## Purpose and User Outcome

Event staff can perform only their assigned door operations and validate attendee, vendor, or performer entry categories without receiving broader workspace access.

## Scope

**In scope**

- Event-scoped staff assignments with check-in/entry permissions and credential categories for attendee, vendor, and performer.
- Issue, revoke, and validate opaque event credentials; record accepted/denied attempts.
- Enforce F-703 server-side authorization at every door action.

**Non-goals**

- Background checks, identity verification, physical badge printing, payroll, scheduling, access-control hardware, or arbitrary policy scripting.
- Using a credential as marketing consent or regulatory evidence.

## Dependencies and Baseline

- F-703, F-401, and F-410 for directional entry where used.
- Approved credential token, expiry, revocation, category, and staff permission contracts.
- Baseline at draft time: PRD, Roadmap, Design, and Phase 0–1.5 Architecture approved 2026-07-22; `ARCHITECTURE-FUTURE.md` approved as a planning target 2026-07-25; NYC ruleset `nyc.v2.7`, rules schema `popengine-rules/v2`, and scenario fixtures v5 where regulatory output is consumed.
- The approval PR must re-pin any baseline version that changes before approval. A proposed or superseded input blocks implementation.

## Inputs, Outputs, State, Validation, and Errors

- Inputs are authorized staff assignment and event credential; outputs are minimal validation result and append-only attempt/entry record.
- Credential state is active → revoked or expired; validation is event-bound and reveals only the minimum door decision.
- Unknown/malformed/wrong-event credentials deny without disclosing private attendee/vendor data.
- Missing or unresolved material data stays visibly unset, unknown, pending, or failed as appropriate; it never becomes a successful or complete result.
- Invalid input produces a field or action-specific error without partial mutation. Retriable external failures preserve the user's confirmed state and expose a safe retry.

## UI and Accessibility

- Door UI identifies active event/staff role, gives non-color accept/deny feedback, and supports scanner/keyboard fallback.
- The complete workflow is keyboard operable, uses programmatic labels and visible focus, does not encode status by color alone, and announces asynchronous success or failure.
- Empty, loading, permission-denied, validation, provider-failure, and unavailable states have explicit copy and a safe next action.

## System Impact

| Concern              | Proposed impact                                                                                                               |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| API                  | Staff assignment, credential issue/revoke/validate, and attempt contracts require approved OpenAPI rate/idempotency shapes.   |
| Schema               | Forward migrations for event staff assignments, opaque credential references, categories, and attempt history.                |
| Jobs                 | None.                                                                                                                         |
| Providers            | Camera/scanner uses browser-native capabilities; no hardware provider.                                                        |
| Privacy and security | Opaque high-entropy credentials, minimal validation projection, event/time binding, revocation, rate limits, and role checks. |

Exact HTTP, JSON Schema, migration, job, and provider shapes belong in their reviewed machine contracts; this proposal does not authorize parallel local types or edits to merged migrations.

## Acceptance Criteria

1. **F411-AC-01:** A check-in staff member can perform only the approved event-scoped door actions and no broader organizer/admin operation.
2. **F411-AC-02:** A valid active credential returns the approved minimal category/decision for its event and records one idempotent attempt.
3. **F411-AC-03:** Revoked, expired, malformed, guessed, or wrong-event credentials deny without revealing identity/contact details and append one idempotent non-sensitive attempt with the denial category.
4. **F411-AC-04:** Vendor and performer categories remain distinct from attendee and do not create RSVP, consent, or regulatory status.
5. **F411-AC-05:** Removing a staff assignment blocks the next protected action while preserving prior attempt attribution.

## Fixtures and Verification

- Planned automated fixture IDs are the acceptance IDs above; each must map one-to-one to a runnable test before approval can claim implementation readiness.
- Regulatory fixtures: none; this feature does not define regulatory ground truth.
- Security-sensitive and cross-workspace paths require negative authorization tests; provider paths require success, duplicate-delivery, retry, invalid-signature, and permanent-failure tests where applicable.

## Allowed Footprint and Coordination

- `apps/web` and `apps/api` feature code and tests.
- New ordered forward migrations and approved OpenAPI/JSON Schema changes required by this feature.
- No repository restructuring, speculative package, or unrelated feature edit.
- Shared contracts, migrations, provider adapters, engine/rules artifacts, consent policy, and cross-lane UI primitives require the approvals named in `docs/DOCUMENTATION-GOVERNANCE.md` §6.

## Rollout and Fallback

- Feature-flag per event; F-401 contact check-in remains available according to its own access policy.
- Rollback disables the new surface and workers/provider calls without deleting confirmed user data or rewriting immutable plans, rulesets, revisions, or history.

## Approval Blockers

- Approve credential lifecycle/token threat model, category list, and staff permission matrix.
- Assign the owner and independent reviewer, approve this spec, and add it to `docs/BASELINE.md`.
