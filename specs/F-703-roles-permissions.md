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

- Inputs are an owner/admin grant, downgrade, or revoke request with the exact expected membership and role-grant versions; output is an auditable role grant used by server-side policy evaluation.
- Role grant state is versioned and active → revoked; authorization changes take effect on the next request and, for a queued job, at both the claim check and the execution-time recheck that immediately precedes the job's side effect. Stale privileged context is invalidated.
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
| Jobs                 | Jobs re-check workspace scope and required authority at claim and again at execution, immediately before the side effect.      |
| Providers            | None.                                                                                                                          |
| Privacy and security | Default deny, centralized policy tests, privilege-change audit records, and indistinguishable cross-tenant not-found behavior. |

Exact HTTP, JSON Schema, migration, job, and provider shapes belong in their reviewed machine contracts; this proposal does not authorize parallel local types or edits to merged migrations.

## Acceptance Criteria

1. **F703-AC-01:** The approved permission matrix has a passing allow and deny test for every role/action pair in scope.
2. **F703-AC-02:** A client cannot gain authority by changing a workspace ID, role value, URL, hidden form field, queued job, or public token.
3. **F703-AC-03:** Every grant, downgrade, or revoke mutation compare-and-swaps the exact expected membership and role-grant versions; a mismatch changes no authority or audit history and requires rebuilt review. Role revocation therefore prevents a stale concurrent grant, the next privileged request, and any queued job from committing its protected write or provider handoff. A claim-time check alone does not deliver that, because the worker holds the lease across the interval in which the revocation commits: the job rechecks the actor's current authority at execution, immediately before the irreversible side effect, and that recheck and the side effect are linearizable through one shared fence, the shape `docs/EVENT-REVISION-CONTRACT.md` §2.5 already requires between a worker's final checks and its provider handoff. If revocation wins the fence the job cannot cross the handoff; if the handoff wins, revocation observes that ordering rather than reporting queued work as stopped. Owner revoke/downgrade also uses F702-AC-04's serialized workspace invariant so concurrent changes cannot remove the last owner. Denials cause no provider side effect or data disclosure and are recorded without secret/contact content.

   Every grant, downgrade, and revoke also commits its own stable client-supplied request identity, under a uniqueness constraint scoped to the membership it changes, in the same transaction as the authority change and the audit entry it records. A request presenting an already committed identity is resolved from that record before the membership and role-grant version comparison above and returns the outcome that request originally recorded, changing no authority a second time and appending no second audit entry. That identity binds its operands under the rule `F411-AC-08` states once for every client-supplied identity on this branch, so a reuse carrying different operands is a conflict rather than a replay.

   Without it the comparison and the safe-retry behavior contradict each other on the same request. F702-AC-01 and F702-AC-07 give workspace and invitation creation their identities and F702-AC-11's M-07 covers a replayed removal or leave, so role change was the transition on this aggregate left with a version comparison and nothing to resolve against it. When a revoke commits and its response is lost, the retry still names the membership and role-grant versions the administrator read, which that commit advanced, so it is rejected as a mismatch and reported as requiring rebuilt review. An administrator revoking authority in response to an incident is then told the revoke did not take effect when it did, and the plausible next action, granting and revoking again to be sure, writes two more audit entries for one intended change.
4. **F703-AC-04:** Rules-admin functions require the separate platform role and cannot be granted by a workspace owner. A rules-admin function is any operation on a platform rules-admin surface, and reading one is a rules-admin function exactly as much as writing one: comparison, result read, export, preview, and generated report each hand ruleset source, verification, and configuration internals to whoever receives them, so each is admitted only by that role, checked server-side at the operation that produces or returns the data rather than at session start or from a client-supplied role claim, and a refusal discloses nothing about which artifacts, versions, or checksums exist. Authority lost after a result is produced blocks every later read and export of it, including a retained one.

   The read half is stated here because the authority rules on this branch were written around operations that commit. F702-AC-10 quantifies over "every mutation of a workspace-owned aggregate, and every externally initiated callback", F410-AC-08 and F714-AC-09 attach their re-read to the transaction that performs a compare-and-swap, and the paragraph of F702-AC-10 that carries the rule across to platform scope still phrases the obligation as validation "at the moment of the write". A surface that only reads has no commit to attach any of them to, so it satisfied all of them vacuously. `F704-AC-04` already applies this rule to platform-scoped activity; `F606-AC-10`, `F712-AC-07`, and `F713-AC-07` apply it to the three rules-admin surfaces whose criteria never named this spec at all. Platform rules-admin authority never derives from a workspace role, per the deny-by-default state rule above, so naming a workspace, holding any workspace role, or owning a workspace admits nothing on those surfaces.
5. **F703-AC-05:** After F-701, F-702, and F-703 all pass security and migration checks, the production gate may be explicitly enabled; otherwise it remains closed.

## Fixtures and Verification

- Planned automated fixture IDs are the acceptance IDs above; each must map one-to-one to a runnable test before approval can claim implementation readiness.
- F703-AC-04 includes a read-side fixture in which a workspace owner holding no platform rules-admin role is refused a rules-admin comparison, result read, export, preview, and generated report, with a response indistinguishable from the one for a record that does not exist, and a fixture in which the role is revoked after a result is produced and every later read and export of it is refused.
- Regulatory fixtures: none; this feature does not define regulatory ground truth.
- F703-AC-03 includes a fixture in which a revoke commits, its response is lost, and the retry presenting the same request identity and the pre-revoke membership and role-grant versions returns the original recorded outcome rather than a version-mismatch rejection, appending no second audit entry.
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
