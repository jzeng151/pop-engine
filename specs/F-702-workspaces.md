# F-702 · Workspaces

**Status:** PROPOSED (2026-07-26) — ready for review; not implementable until approved and listed in `docs/BASELINE.md`.

**Phase:** 2 · **Issue:** [#49](https://github.com/jzeng151/pop-engine/issues/49) · **Owner:** TBD · **Reviewer:** product owner plus affected architecture, contract, security, and lane owners (TBD) · **Approval date:** —

## Purpose and User Outcome

Authenticated organizers can group events and members inside an explicit workspace boundary so one organization's data cannot leak into another.

## Scope

**In scope**

- Create, name, view, and switch workspaces; manage membership invitations and acceptance.
- Derive workspace scope server-side for every authenticated aggregate.
- Require workspace ownership before authenticated user-owned product data is persisted.

**Non-goals**

- Role-specific permissions beyond the minimum owner needed to establish a workspace; F-703 owns authorization roles.
- Workspace billing, domains, SSO, nested organizations, or cross-workspace sharing.

## Dependencies and Baseline

- F-701 authentication.
- The F-701/F-702/F-703 joint production gate in `ROADMAP.md` and `ARCHITECTURE-FUTURE.md` §15.2.
- Baseline at draft time: PRD, Roadmap, Design, and Phase 0–1.5 Architecture approved 2026-07-22; `ARCHITECTURE-FUTURE.md` approved as a planning target 2026-07-25; NYC ruleset `nyc.v2.7`, rules schema `popengine-rules/v2`, and scenario fixtures v5 where regulatory output is consumed.
- The approval PR must re-pin any baseline version that changes before approval. A proposed or superseded input blocks implementation.

## Inputs, Outputs, State, Validation, and Errors

- Inputs are an authenticated actor, workspace name, and invitation target; outputs are a workspace, membership, and server-selected active workspace context.
- Invitation state is pending → accepted, expired, or revoked; membership state is active → removed. Removing the last owner is rejected.
- A client-supplied workspace identifier is never sufficient authorization; every aggregate query joins through active membership.
- Missing or unresolved material data stays visibly unset, unknown, pending, or failed as appropriate; it never becomes a successful or complete result.
- Invalid input produces a field or action-specific error without partial mutation. Retriable external failures preserve the user's confirmed state and expose a safe retry.

## UI and Accessibility

- Workspace switcher and invitation screens identify the active workspace before any mutation and clearly distinguish expired, revoked, and unauthorized invitations.
- The complete workflow is keyboard operable, uses programmatic labels and visible focus, does not encode status by color alone, and announces asynchronous success or failure.
- Empty, loading, permission-denied, validation, provider-failure, and unavailable states have explicit copy and a safe next action.

## System Impact

| Concern              | Proposed impact                                                                                                                              |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| API                  | Workspace, membership, invitation, and active-context operations require an approved OpenAPI contract.                                       |
| Schema               | Forward migrations for workspaces and memberships plus `workspace_id` on activated user-owned aggregates, coordinated as one tenancy change. |
| Jobs                 | Optional invitation delivery only; workspace consistency does not depend on a job.                                                           |
| Providers            | Email adapter only if invitations are delivered by email.                                                                                    |
| Privacy and security | All reads and writes are tenant-scoped server-side; invitation tokens are opaque, expiring, single-use, and absent from logs.                |

Exact HTTP, JSON Schema, migration, job, and provider shapes belong in their reviewed machine contracts; this proposal does not authorize parallel local types or edits to merged migrations.

## Acceptance Criteria

1. **F702-AC-01:** Workspace creation and active-owner membership insertion are atomic and bind a stable request identity to the original result; replay returns that workspace and membership without creating another.
2. **F702-AC-02:** Acceptance atomically compare-and-swaps the invitation from pending to accepted together with membership creation; revocation competes on the same row/version, so exactly one terminal transition wins. Expired, revoked, reused, or mismatched invitations create no membership.
3. **F702-AC-03:** Every workspace-owned aggregate rejects cross-workspace reads, writes, identifier guessing, exports, uploads, and job execution.
4. **F702-AC-04:** Owner removal/leave serializes on the workspace (or uses an equivalent database invariant) so the last active owner cannot be removed under concurrent requests; the concurrent two-owner removal fixture leaves at least one owner.
5. **F702-AC-05:** No authenticated user-owned product data or external beta is enabled before F-703 is also deployed and verified.
6. **F702-AC-06:** Issuing and revoking an invitation require the actor to hold an active owner membership of that exact workspace, checked server-side against stored membership rather than any client-supplied workspace or role claim. A non-owner member, a removed member, and a member of a different workspace are each rejected without disclosing whether the workspace or invitation exists, and the rejection creates, mutates, and expires nothing.

   This is the minimum owner authority the non-goals reserve to F-702 rather than a role model, which stays F-703's. Without it, AC-02 and AC-03 hold and the boundary still opens: AC-02 governs only transitions of an invitation that already exists, and AC-03 admits anyone who reached active membership. An ordinary member could therefore invite an outsider, the outsider would accept through AC-02 into a valid membership, and every cross-workspace check in AC-03 would pass for them, because by then they are legitimately inside. Membership is what AC-03 trusts, so the criterion that decides who may create membership cannot be deferred to F-703 while F-702 ships. Revocation is named alongside issuance for the same reason: leaving it open lets any member cancel an owner's pending invitation.

7. **F702-AC-07:** Issuing an invitation binds the request to a stable client-supplied request identity, committed with the invitation under a uniqueness constraint scoped to the workspace. A retry presenting the same identity returns the original invitation and its original token and creates no second pending row; deliberately inviting the same address again sends a new identity. This is request identity, never content uniqueness: two genuinely distinct invitations that read the same are both created, and a repeated identity is never rejected as a duplicate value.

   AC-02 serializes transitions of one invitation and cannot see a second one. When issuance commits and its response is lost, the caller retries, a second pending row and a second token exist for the same intended invitation, and revoking or accepting either leaves the other still valid, so a revocation the owner was told succeeded does not close the invitation.

## Fixtures and Verification

- Planned automated fixture IDs are the acceptance IDs above; each must map one-to-one to a runnable test before approval can claim implementation readiness.
- F702-AC-02 includes a concurrent accept-versus-revoke fixture that proves a revoked invitation cannot create a membership.
- F702-AC-06 includes a non-owner-member issuance fixture and a non-owner-member revocation fixture, each proving the rejection leaves no invitation and no membership behind, so the AC-03 cross-workspace path is never reached through a membership a non-owner created.
- Regulatory fixtures: none; this feature does not define regulatory ground truth.
- Security-sensitive and cross-workspace paths require negative authorization tests; provider paths require success, duplicate-delivery, retry, invalid-signature, and permanent-failure tests where applicable.

## Allowed Footprint and Coordination

- `apps/web` and `apps/api` feature code and tests.
- New ordered forward migrations and approved OpenAPI/JSON Schema changes required by this feature.
- No repository restructuring, speculative package, or unrelated feature edit.
- Shared contracts, migrations, provider adapters, engine/rules artifacts, consent policy, and cross-lane UI primitives require the approvals named in `docs/DOCUMENTATION-GOVERNANCE.md` §6.

## Rollout and Fallback

- Backfill or attach only synthetic capstone data under an approved migration plan; do not infer real ownership.
- Synchronize issue #49's Phase 3 metadata to Roadmap-authoritative Phase 2 before approval.
- Rollback disables the new surface and workers/provider calls without deleting confirmed user data or rewriting immutable plans, rulesets, revisions, or history.

## Approval Blockers

- Approve tenancy migration/backfill and invitation decisions.
- Complete the events-schema all-lane approval for any shared-table change.
- Assign the owner and independent reviewer, approve this spec, and add it to `docs/BASELINE.md`.
