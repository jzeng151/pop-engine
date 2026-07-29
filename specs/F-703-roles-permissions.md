# F-703 · Roles and Permissions

**Status:** PROPOSED (2026-07-26) — ready for review; not implementable until approved and listed in `docs/BASELINE.md`.

**Phase:** 2 · **Issue:** [#50](https://github.com/jzeng151/pop-engine/issues/50) · **Owner:** TBD · **Reviewer:** product owner plus affected architecture, contract, security, and lane owners (TBD) · **Approval date:** —

## Purpose and User Outcome

Workspace owners can grant only the access each collaborator needs, completing the authorization gate required before real user-owned data or an external beta.

## Scope

**In scope**

- Workspace roles: owner, admin, organizer, contributor, check-in staff, and viewer.
- Separate platform rules-admin authority from workspace roles.
- One server-side authorization policy layer applied to API, UI affordances, exports, uploads, jobs, and public-token administration.

**Non-goals**

- Arbitrary custom roles, per-field ACLs, enterprise policy engines, or SSO provisioning.
- Treating hidden UI controls as authorization.

## Dependencies and Baseline

- F-701 authentication and F-702 workspaces.
- Approved permission matrix covering every currently shipped aggregate and action.
- Baseline at draft time: PRD, Roadmap, Design, and Phase 0–1.5 Architecture approved 2026-07-22; `ARCHITECTURE-FUTURE.md` approved as a planning target 2026-07-25; NYC ruleset `nyc.v2.7`, rules schema `popengine-rules/v2`, and scenario fixtures v5 where regulatory output is consumed.
- The approval PR must re-pin any baseline version that changes before approval. A proposed or superseded input blocks implementation.

## Inputs, Outputs, State, Validation, and Errors

- Inputs are an owner/admin grant or revoke request; output is an auditable role grant used by server-side policy evaluation.
- Role grant state is active → revoked; authorization changes take effect on the next request or queued-job claim/execution check and invalidate stale privileged context.
- Unknown actions, missing membership, missing workspace, and stale grants deny by default. Platform rules-admin checks never derive from a workspace role.
- Missing or unresolved material data stays visibly unset, unknown, pending, or failed as appropriate; it never becomes a successful or complete result.
- Invalid input produces a field or action-specific error without partial mutation. Retriable external failures preserve the user's confirmed state and expose a safe retry.

## UI and Accessibility

- Member management explains each role in plain language and never offers a grant the current actor cannot make.
- The complete workflow is keyboard operable, uses programmatic labels and visible focus, does not encode status by color alone, and announces asynchronous success or failure.
- Empty, loading, permission-denied, validation, provider-failure, and unavailable states have explicit copy and a safe next action.

## System Impact

| Concern              | Proposed impact                                                                                                                |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| API                  | Role-grant operations and consistent forbidden/not-found behavior require an approved OpenAPI change.                          |
| Schema               | Forward migration for role grants or the minimal approved membership role representation; no duplicate role source.            |
| Jobs                 | Jobs re-check workspace scope and required authority at claim or execution time where actor authority matters.                 |
| Providers            | None.                                                                                                                          |
| Privacy and security | Default deny, centralized policy tests, privilege-change audit records, and indistinguishable cross-tenant not-found behavior. |

Exact HTTP, JSON Schema, migration, job, and provider shapes belong in their reviewed machine contracts; this proposal does not authorize parallel local types or edits to merged migrations.

## Acceptance Criteria

1. **F703-AC-01:** The approved permission matrix has a passing allow and deny test for every role/action pair in scope.
2. **F703-AC-02:** A client cannot gain authority by changing a workspace ID, role value, URL, hidden form field, queued job, or public token.
3. **F703-AC-03:** Role revocation prevents the next privileged request and any queued job from passing claim/execution-time authorization; the denial causes no provider side effect or data disclosure and is recorded without secret or contact content.
4. **F703-AC-04:** Rules-admin functions require the separate platform role and cannot be granted by a workspace owner.
5. **F703-AC-05:** After F-701, F-702, and F-703 all pass security and migration checks, the production gate may be explicitly enabled; otherwise it remains closed.

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

- Ship with default-deny policies and keep the production gate closed until the complete matrix passes in the deployed environment.
- Synchronize issue #50's Phase 3 metadata to Roadmap-authoritative Phase 2 before approval.
- Rollback disables the new surface and workers/provider calls without deleting confirmed user data or rewriting immutable plans, rulesets, revisions, or history.

## Approval Blockers

- Approve the role/action matrix and platform-role administration path.
- Approve tenancy/security review and the explicit production-gate runbook.
- Assign the owner and independent reviewer, approve this spec, and add it to `docs/BASELINE.md`.
