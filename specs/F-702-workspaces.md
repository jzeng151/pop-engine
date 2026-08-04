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
- Invitation states and every transition between them, including who may perform each one and against which identity and version, are enumerated in F702-AC-08. Membership state is active → removed. Removing the last owner is rejected.
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
2. **F702-AC-02:** Acceptance atomically compare-and-swaps the invitation from pending to accepted together with membership creation; revocation competes on the same row/version, so exactly one terminal transition wins. Expired, revoked, reused, or mismatched invitations create no membership. "Mismatched" is defined by F702-AC-08 as the accepting actor's verified identity failing to equal the invitation's recorded target identity, and that comparison is made inside this same transaction, before membership creation.
3. **F702-AC-03:** Every workspace-owned aggregate rejects cross-workspace reads, writes, identifier guessing, exports, uploads, and job execution.
4. **F702-AC-04:** Owner removal/leave serializes on the workspace (or uses an equivalent database invariant) so the last active owner cannot be removed under concurrent requests; the concurrent two-owner removal fixture leaves at least one owner.
5. **F702-AC-05:** No authenticated user-owned product data or external beta is enabled before F-703 is also deployed and verified.
6. **F702-AC-06:** Issuing and revoking an invitation require the actor to hold an active owner membership of that exact workspace, checked server-side against stored membership rather than any client-supplied workspace or role claim. A non-owner member, a removed member, and a member of a different workspace are each rejected without disclosing whether the workspace or invitation exists, and the rejection creates, mutates, and expires nothing.

   This is the minimum owner authority the non-goals reserve to F-702 rather than a role model, which stays F-703's. Without it, AC-02 and AC-03 hold and the boundary still opens: AC-02 governs only transitions of an invitation that already exists, and AC-03 admits anyone who reached active membership. An ordinary member could therefore invite an outsider, the outsider would accept through AC-02 into a valid membership, and every cross-workspace check in AC-03 would pass for them, because by then they are legitimately inside. Membership is what AC-03 trusts, so the criterion that decides who may create membership cannot be deferred to F-703 while F-702 ships. Revocation is named alongside issuance for the same reason: leaving it open lets any member cancel an owner's pending invitation.

7. **F702-AC-07:** Issuing an invitation binds the request to a stable client-supplied request identity, committed with the invitation under a uniqueness constraint scoped to the workspace. A retry presenting the same identity returns the original invitation and its original token and creates no second pending row; deliberately inviting the same address again sends a new identity. This is request identity, never content uniqueness: two genuinely distinct invitations that read the same are both created, and a repeated identity is never rejected as a duplicate value.

   AC-02 serializes transitions of one invitation and cannot see a second one. When issuance commits and its response is lost, the caller retries, a second pending row and a second token exist for the same intended invitation, and revoking or accepting either leaves the other still valid, so a revocation the owner was told succeeded does not close the invitation.

8. **F702-AC-08:** An invitation has exactly the states and transitions in the table below, and no operation outside that table creates, changes, or ends an invitation or a membership derived from one. An invitation is in exactly one of `absent` (no record), `pending`, `accepted`, `revoked`, or `expired`; the last three are terminal, and no transition leaves a terminal state. Issuance records, immutably and at creation, the normalized intended target identity the invitation is for; that recorded target is never re-supplied by a later request and never changed after issuance. Every transition names the invitation version it read and compare-and-swaps that version inside the transaction that performs it.

   | ID   | Transition                                            | Who may perform it                                                                                        | Identity checked                                                                                                                                  | State change                                    | Version named and compare-and-swapped                                                                   |
   | ---- | ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
   | T-01 | Issue                                                 | an actor holding an active owner membership of that exact workspace, per F702-AC-06                        | the actor's own membership, read server-side from stored membership; the normalized target identity is recorded immutably and is not the actor's    | `absent` → `pending`                            | no invitation version exists to compare; the F702-AC-07 request identity is unique within the workspace     |
   | T-02 | Issue replayed on a committed request identity         | the same actor as T-01                                                                                     | as T-01                                                                                                                                            | none; the original invitation is returned        | request identity only; no second pending row and no second token, per F702-AC-07                            |
   | T-03 | Issue refused, actor is not an active owner            | nobody; the request is rejected                                                                            | the actor's membership, which fails                                                                                                                | none, remains `absent`                          | none read, none written; nothing is created, mutated, or expired, per F702-AC-06                            |
   | T-04 | Deliver or re-deliver                                 | no end-user actor; the delivery adapter acting on an existing `pending` invitation                          | the target identity recorded at T-01 and only that one; no address supplied at delivery time is ever used                                            | none, remains `pending`                         | the invitation row is read, not transitioned; the same invitation and the same token are re-sent, never a new row |
   | T-05 | Accept                                                | only an authenticated actor whose F-701 verified identity equals the recorded target identity               | the actor's verified identity compared to the immutable recorded target, inside the accepting transaction and before any membership row is written   | `pending` → `accepted`, with membership creation | the invitation row/version, per F702-AC-02                                                                  |
   | T-06 | Accept refused, identity does not match                | nobody; the request is rejected even when it presents a valid, unexpired, unrevoked token                    | the actor's verified identity, which fails the comparison                                                                                          | none, remains `pending`                         | the invitation version is read and released unchanged; no membership is created and the intended target can still accept |
   | T-07 | Accept refused, invitation is not `pending`            | nobody; the request is rejected                                                                            | not reached; state is terminal or expired under T-09                                                                                                | none                                            | the invitation version, compared and rejected before any write                                              |
   | T-08 | Revoke                                                | an actor holding an active owner membership of that exact workspace, per F702-AC-06, naming the invitation by its server-side identifier rather than by presenting the token | the actor's own membership; the target identity is not consulted and possession of the token confers nothing                                        | `pending` → `revoked`                           | the same invitation row/version T-05 compares, so exactly one of accept and revoke wins                       |
   | T-09 | Expire                                                | no actor                                                                                                   | none                                                                                                                                               | `pending` → `expired`                           | evaluated server-side from the recorded issuance instant and the configured lifetime at every read, delivery, and acceptance, so an invitation past its lifetime is already terminal for T-04 and T-05 whether or not a sweep has written the terminal state |
   | T-10 | Membership removal or leave after acceptance           | per F702-AC-04                                                                                             | the membership, not the invitation                                                                                                                 | none; the `accepted` invitation stays terminal   | none on the invitation; re-admitting the same person is a new T-01, never a reuse of the accepted invitation  |

   Each earlier round on this spec secured one step of this lifecycle and left the next, which is why the whole set is enumerated here rather than another rule being added beside them. F702-AC-06 fixed who may issue and revoke. F702-AC-07 fixed issuance replay. F702-AC-02 fixed the race between accepting and revoking one invitation that already exists. None of the three said who may accept: acceptance was reached by presenting the token, so the token was a bearer credential for entering the workspace, and a forwarded, leaked, or stolen one admitted whoever held it. Once inside, F702-AC-03 passes for that membership because it is a real membership, exactly as F702-AC-06 already described for an invitation issued by a non-owner. Delivery and expiry had no criterion at all: nothing said the delivery adapter may send only to the recorded target, so an implementation could accept a delivery address from the caller and bypass the binding T-05 checks, and nothing said an expired invitation is terminal at the moment of use, so an implementation could depend on a sweep the System Impact says workspace consistency must not depend on.

   Two inputs this criterion needs are not established by any approved artifact today, and both belong to the invitation decisions already named in the Approval Blockers. First, the normalization rule for the target identity: it must be one approved deterministic rule applied identically at T-01 and T-05 and recorded with the invitation, and it must be conservative, because a rule that folds distinct addresses onto one normalized target widens the set of actors T-05 admits. Second, the invitation lifetime T-09 measures against. Until that approval names them, T-01, T-05, and T-09 are testable only as "a single recorded normalized target is compared for equality at acceptance, and a configured finite lifetime is enforced at every use," not against a specific rule or window. This criterion also requires F-701's actor projection to report whether the actor's email is verified, which F701-AC-05 does not state today: it exposes the verified subject and an optional email without saying the email is verified as owned. Where that verification state is unavailable, T-05 fails closed and no membership is created, because admitting an unverified identity would restore the bearer behavior this criterion removes.

9. **F702-AC-09:** Switching the active workspace names one target workspace. The server accepts the switch only when the actor holds an active membership of that exact workspace and the workspace itself is active, both checked server-side against stored membership rather than any client-supplied workspace or role claim. On success the server-selected active workspace context becomes that workspace, and every subsequent read and mutation derives its scope from the new context, so the switcher reaches each workspace the actor is actually a member of instead of remaining pinned to the first one. A target the actor is not an active member of, whose membership was removed, or that is not active is rejected without disclosing whether the workspace or the membership exists, and the previously active context is left unchanged.

   Switching selects among authority the actor already holds; it never creates, restores, or elevates any. It is not itself an authorization decision beyond the membership check above, and the authority for each later operation is still that actor's stored membership of the now-active workspace, re-read server-side per request rather than carried forward from the previously active workspace or frozen into the session at switch time. Being an owner of one workspace therefore confers nothing in another, a membership removed after a switch takes effect on the next request, and F702-AC-03 still rejects every request naming an aggregate outside the active workspace, so the active context narrows what a request may reach and never widens it. This is stated because the same identity-scoping defect has already appeared once on this stack: an operation that resolved authority from something other than the actor's own stored membership of the exact target. A switch that returned a context the server then trusted in place of a per-request membership check would be that defect again, with the client choosing the scope.

10. **F702-AC-10:** Every mutation and every externally initiated callback names the workspace it acts in. That named workspace is validated against the actor's authority at the moment of the write, re-read server-side from stored membership rather than from the session, from a client-supplied role claim, or from the context that was active when the operation began. Switching the active workspace never retroactively changes what an in-flight operation acts on: an operation that named workspace A commits in workspace A or is rejected, and never in workspace B.

    This is the tenancy boundary rule for the whole feature set, stated once here and referenced rather than restated wherever a workspace-scoped operation or an external callback needs it. Three obligations follow from it, and an implementation satisfies the criterion only by meeting all three.

    First, naming. Every request that writes carries the workspace it was composed against, and every externally initiated callback carries a server-issued reference that resolves to one workspace. Naming is not authorization: the named workspace only narrows what the request may reach, and the actor's stored membership of that exact workspace is what admits it, exactly as F702-AC-09 already requires of a switch. A request whose named workspace differs from the server-selected active context is rejected and returned for the actor to recompose, and is never silently redirected into the currently active workspace. The rejection discloses nothing about whether the named workspace or its aggregates exist, per F702-AC-03.

    Second, validation at the moment of the write. The membership check is made inside the transaction that commits, against stored membership read server-side at that instant, not at session start, not at switch time, and not at the moment the client began composing. A membership removed while a request was in flight therefore causes that request to fail rather than commit on authority the actor no longer holds.

    Third, callbacks. An externally initiated callback is not composed by the actor at all, so it cannot carry the actor's current context. Its workspace binding is instead established when the flow starts: the server issues and stores an unguessable single-use state bound to the initiating actor, the workspace, the provider, and the exact approved redirect target, and the callback is admitted only when it presents that state, which is consumed exactly once. `F212-AC-06` states this shape in full and `F308-AC-11` and `F408-AC-10` require it by reference; a callback with no such binding acts in whatever workspace the browser session happens to be in, which is the attacker-chosen workspace whenever the attacker started the flow.

    Without this criterion, F702-AC-03 and F702-AC-09 both hold and the boundary still opens. F702-AC-03 rejects cross-workspace access by comparing an existing aggregate's workspace to the active one, so it has nothing to compare for a create, which has no aggregate yet, and the actor is legitimately a member of both workspaces so no membership check fails. F702-AC-09 then makes the active context mutable without giving any subsequent request a way to say which context it was composed against. A member with workspace A open in one tab and workspace B in another therefore switches to B and the next create from the A tab, composed entirely against A and showing A's name in the switcher F702-AC-09 requires, writes into B. Nothing rejects it, nothing records that it was misdirected, and one organizer's data is now in another organizer's workspace. The same reasoning covers an external callback, where the gap is wider still because the party that chooses when the callback arrives is outside the boundary.

    Operations that are not workspace-scoped do not satisfy this criterion by naming a workspace. The platform rules-admin surfaces F-711 and F-712 define name their own platform scope, which `F703-AC-04` keeps separate from and ungrantable by a workspace owner, and `F711-AC-06` already states why a workspace-scoped identity would be wrong for them. Such an operation is in scope for this criterion only in that it must name a scope and validate authority for that scope at the moment of the write; the scope it names is the platform one.

## Fixtures and Verification

- Planned automated fixture IDs are the acceptance IDs above; each must map one-to-one to a runnable test before approval can claim implementation readiness.
- F702-AC-02 includes a concurrent accept-versus-revoke fixture that proves a revoked invitation cannot create a membership.
- F702-AC-06 includes a non-owner-member issuance fixture and a non-owner-member revocation fixture, each proving the rejection leaves no invitation and no membership behind, so the AC-03 cross-workspace path is never reached through a membership a non-owner created.
- F702-AC-08 includes one fixture per transition in its table. T-06 requires a forwarded-token fixture in which an authenticated actor other than the recorded target presents a valid, unexpired, unrevoked token and receives no membership while the invitation stays pending; T-04 requires a fixture proving delivery uses only the recorded target; T-09 requires a fixture proving an invitation past its lifetime is refused at acceptance with no sweep having run.
- F702-AC-09 includes an authorized-switch fixture, a non-member and an inactive-target rejection fixture, and a fixture proving that a read and a mutation issued after a switch resolve through the newly active membership, and that a membership removed after the switch is refused on the next request.
- F702-AC-10 includes a two-tab fixture in which a create composed against workspace A is submitted after the active context has switched to workspace B and is rejected rather than written into either workspace, a fixture proving the rejection discloses nothing about workspace B, a fixture in which a membership revoked while a mutation is in flight causes that mutation to fail rather than commit, and a fixture proving an externally initiated callback carrying no server-issued workspace-bound state is refused.
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

- Approve tenancy migration/backfill and invitation decisions. The invitation decisions must name the target-identity normalization rule and the invitation lifetime that F702-AC-08 leaves unpinned, and must confirm that F-701's actor projection reports verified-email state, which F701-AC-05 does not state today, because F702-AC-08 T-05 compares the actor's verified identity against the recorded target.
- Complete the events-schema all-lane approval for any shared-table change.
- Assign the owner and independent reviewer, approve this spec, and add it to `docs/BASELINE.md`.
