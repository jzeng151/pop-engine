# F-703 · Roles and Permissions

**Status:** PROPOSED (2026-07-26) — ready for review; not implementable until approved and listed in `docs/BASELINE.md`.

**Phase:** 2 · **Issue:** [#50](https://github.com/jzeng151/pop-engine/issues/50) · **Owner:** TBD · **Reviewer:** product owner · **Approval date:** —

## Purpose and User Outcome

Workspace owners and delegated admins can grant only the access each collaborator needs, completing the authorization gate required before real user-owned data or an external beta.

## Scope

**In scope**

- Workspace roles: owner, admin, organizer, contributor, check-in staff, and viewer.
- Separate platform rules-admin authority from workspace roles.
- One server-side authorization policy layer applied to API, UI affordances, exports, uploads, jobs, and public-token administration.

**Non-goals**

- Arbitrary custom roles, per-field ACLs, enterprise policy engines, or SSO provisioning.
- Treating hidden UI controls as authorization.

## Dependencies and Baseline

- F-701 authentication and F-702 workspaces. F-702 supplies the workspace membership boundary every role change and member-management operation resolves against and F-701 supplies the authenticated actor `F703-AC-06` reads it for; the permission matrix that check consults is the one this spec itself defines and its Approval Blockers gate. F-701 is APPROVED (2026-07-28, `docs/BASELINE.md`); F-702 remains PROPOSED, so the gate is not an approved input today and this spec is not implementable against it until F-702 is approved and listed in `docs/BASELINE.md`.
- Operand binding for client-supplied identities is stated locally in `F703-AC-03` and is deliberately not declared as a dependency on `specs/F-411-staff-roles-credentialed-entry.md`. Other specs on this branch take that rule by reference to `F411-AC-08`, but F-703 cannot: F-411 already declares F-703 as a dependency, because `F411-AC-09` consults the permission matrix this spec defines, so declaring F-411 here would make the two specs blockers of each other and neither could be approved first. The phase order says the same thing from the other side, since F-703 is the Phase 2 authorization gate and F-411 is a Phase 3 spec, so a Phase 2 gate cannot wait on it. Restating the rule locally is therefore the option taken of the three the review named, and it leaves no unapproved undeclared input in the criterion. If the rule is later promoted to an approved shared invariant, this spec and F-411 both cite that invariant and the local restatement is removed.
- Product-owner approval of the proposed permission matrix below, covering every currently shipped workspace aggregate and action.
- Baseline at this draft: PRD, Roadmap, Design, and Phase 0–1.5 Architecture approved 2026-07-22; `ARCHITECTURE-FUTURE.md` approved as a planning target 2026-07-25; NYC ruleset `nyc.v2.13`, rules schema `popengine-rules/v2`, and scenario fixtures v5 where regulatory output is consumed.
- The approval PR must re-pin any baseline version that changes before approval. A proposed or superseded input blocks implementation.

## Proposed authorization model

This section records the decision proposed for approval. It is not implementable while this spec and F-702 remain `PROPOSED`.

### One workspace role per membership

- An active membership has at most one active workspace role grant. Workspace roles do not combine and do not inherit permissions from one another. Authorization reads the exact matrix cell for the active role and action.
- An active F-702 membership without an active F-703 role grant has no workspace permission. Membership proves tenancy; the role grant supplies authority.
- F-703 assigns `owner` to each active F-702 owner membership and `viewer` to every other active membership when its migration runs. After that migration, accepting an invitation creates a `viewer` grant in the same transaction as the membership unless a committed acceptance replay returns the grant already created. An authorized role change may follow as a separate request.
- A role change revokes the current grant and activates the requested role atomically. A revoke leaves the membership active with no role and therefore no workspace permission. F-702 membership removal remains a separate owner-only transition.
- `owner`, `admin`, `organizer`, `contributor`, `check_in_staff`, and `viewer` are distinct roles, not ranks. A change between two non-owner roles may add some permissions and remove others. The grant checks below therefore inspect both the current role and requested role rather than relying on a higher-than comparison.

### Workspace permission matrix

`Allow` means the server may admit the action after it rechecks the actor's active membership and role for the owning workspace. Every blank cell means deny. The permission names are policy identifiers, not new HTTP routes.

| Permission                 | Currently shipped action                                                                                           | Owner | Admin | Organizer | Contributor | Check-in staff | Viewer |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------ | :---: | :---: | :-------: | :---------: | :------------: | :----: |
| `workspace.read`           | View and switch to a workspace                                                                                     | Allow | Allow |   Allow   |    Allow    |     Allow      | Allow  |
| `workspace.update`         | Rename or update workspace settings                                                                                | Allow | Allow |           |             |                |        |
| `invitation.manage`        | Issue, re-deliver, or revoke an invitation                                                                         | Allow |       |           |             |                |        |
| `membership.remove`        | Remove another active member                                                                                       | Allow |       |           |             |                |        |
| `membership.leave`         | Leave through F-702's self-only transition                                                                         | Allow | Allow |   Allow   |    Allow    |     Allow      | Allow  |
| `member.read_all`          | Read the member-management list                                                                                    | Allow | Allow |           |             |                |        |
| `role.read_all`            | Read every member's current and historical grants                                                                  | Allow | Allow |           |             |                |        |
| `authorization_audit.read` | Read workspace role and membership audit records                                                                   | Allow | Allow |           |             |                |        |
| `event.create`             | `POST /api/events`                                                                                                 | Allow | Allow |   Allow   |    Allow    |                |        |
| `event.read`               | `GET /api/events/:id` and event workspace shell                                                                    | Allow | Allow |   Allow   |    Allow    |                | Allow  |
| `event.update`             | `PATCH /api/events/:id`                                                                                            | Allow | Allow |   Allow   |    Allow    |                |        |
| `plan.generate`            | `POST /api/events/:id/plan`                                                                                        | Allow | Allow |   Allow   |    Allow    |                |        |
| `plan.read`                | `GET /api/events/:id/plan`                                                                                         | Allow | Allow |   Allow   |    Allow    |                | Allow  |
| `checklist.materialize`    | `POST /api/events/:id/checklist`, including reminder scheduling                                                    | Allow | Allow |   Allow   |    Allow    |                |        |
| `checklist.read`           | `GET /api/events/:id/checklist`                                                                                    | Allow | Allow |   Allow   |    Allow    |                | Allow  |
| `checklist.update`         | `PATCH /api/checklist-items/:id`                                                                                   | Allow | Allow |   Allow   |    Allow    |                |        |
| `document.upload`          | `POST /api/checklist-items/:id/documents`                                                                          | Allow | Allow |   Allow   |    Allow    |                |        |
| `document.read`            | Read document metadata and `GET /api/documents/:id/url`                                                            | Allow | Allow |   Allow   |    Allow    |                | Allow  |
| `public_page.read_config`  | `GET /api/events/:id/public-page`                                                                                  | Allow | Allow |   Allow   |    Allow    |                | Allow  |
| `public_page.manage`       | Change description, publish, unpublish, or administer the public token through `PATCH /api/events/:id/public-page` | Allow | Allow |   Allow   |             |                |        |
| `attendee.read`            | `GET /api/events/:id/guests` and `GET /api/events/:id/stats`                                                       | Allow | Allow |   Allow   |             |     Allow      |        |
| `rsvp.cancel`              | `PATCH /api/events/:id/guests/:rsvpId`                                                                             | Allow | Allow |   Allow   |             |                |        |
| `checkin.read`             | `GET /api/events/:id/checkins`                                                                                     | Allow | Allow |   Allow   |             |     Allow      |        |
| `checkin.record`           | `POST /api/events/:id/checkins`                                                                                    | Allow | Allow |   Allow   |             |     Allow      |        |
| `alert.test`               | `POST /api/events/:id/alerts/test`                                                                                 | Allow | Allow |   Allow   |             |                |        |

Each actor may read their own membership and current role so the workspace switcher and denied-state UI can explain their access. That self-read does not include another member's identity, grant, or audit record.

An export requires every read permission needed for every record it would include. The server refuses the whole export if any record falls outside the actor's current permissions. An upload uses the permission for its owning aggregate as well as `document.upload`; a signed download rechecks `document.read` every time it mints a URL.

The public attendee operations `GET /e/:eventId` and `POST /api/events/:id/rsvps` do not consult a workspace role. Their published-state and public-input checks grant no workspace permission. F-401's name-only `GET /api/events/:id/checkins` and public `POST` to the same path remain public only during its bounded rehearsal window; the F-401 deployment gate, not a workspace role, admits those requests during that window. When that bypass is closed, an authenticated workspace request uses `checkin.read` or `checkin.record`. `/health`, `/api/rules/meta`, and `/api/permits/nyc/discover` also remain platform-neutral reads. `/api/rules/meta` returns published runtime metadata only and is not a rules-admin surface.

### Role-change authority

| Acting role                                    | Grant when the subject has no active role                 | Replace an active role                                                                              | Revoke an active role                                                      |
| ---------------------------------------------- | --------------------------------------------------------- | --------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| Owner                                          | Any workspace role                                        | Any workspace role with any other workspace role                                                    | Any workspace role                                                         |
| Admin                                          | `organizer`, `contributor`, `check_in_staff`, or `viewer` | Allowed only when both the subject's current role and requested role are in that same four-role set | Allowed only when the subject's current role is in that same four-role set |
| Organizer, contributor, check-in staff, viewer | Denied                                                    | Denied                                                                                              | Denied                                                                     |

An owner may change or revoke their own role only when another active owner remains after the transaction. The same last-owner check applies when an owner acts on another owner. An admin cannot act on an owner, another admin, or themself and cannot grant `owner` or `admin`. A request that would leave the current role unchanged is refused as a no-op. Every grant, replacement, and revoke still follows the version, replay, actor-authority, workspace-binding, and audit requirements in F703-AC-03, F703-AC-06, and F703-AC-07.

Only owners and admins may read the full member list and role history. Only owners and admins may read workspace authorization audit records. No workspace role may grant or revoke the platform rules-admin role.

### Platform rules-admin authority

- Platform rules-admin is a separate versioned grant keyed to the F-701 actor. It is not a workspace membership or workspace role. Holding it grants no workspace action in the matrix above, and holding a workspace role grants no platform action.
- The platform permission covers rules-admin source and configuration reads, comparison creation, comparison-result reads, previews, exports, generated reports, and approved publication operations. Every such operation checks the current platform grant when it produces or returns data.
- The role authorizes a platform operation but cannot approve regulatory content, a verification promotion, or a ruleset publication. Those decisions still require the product owner's recorded approval under documentation governance.
- F-703 adds no public or workspace-facing platform-role endpoint. The product owner grants or revokes the role through one deployment-only administrative command running under a dedicated database operator credential. The runtime API database role cannot invoke that command or write platform grants directly.
- The command takes the target F-701 actor ID, `grant` or `revoke`, the expected grant version, a client request identity, and a reason. It atomically compare-and-swaps the grant, records the bound request and outcome for replay, and appends a redacted audit entry. Only the product owner operates it. This command is also the bootstrap path for the first rules admin.
- Revocation blocks the next platform operation and every later read or export of a retained result. A rules admin cannot grant or revoke platform authority merely by holding the role.

### Queued and provider work

- A user-initiated workspace job records the initiating F-701 actor, owning workspace, subject aggregate, and exact permission that admitted creation. It stores no client-supplied role claim.
- The worker re-reads that actor's active membership and permission when claiming the job. It re-reads them again immediately before the protected database write or provider handoff. A changed role may continue the job only when the new role still allows the recorded permission.
- The execution-time check and side effect use the shared linearizable fence required by F703-AC-03. If revocation wins, the worker makes no protected write and no provider call. If the side effect wins, the later revocation observes that order and does not report the side effect as stopped.
- Reminder jobs created by `checklist.materialize` recheck that permission for the actor who materialized the checklist. The synchronous test-alert endpoint rechecks `alert.test` immediately before its provider handoff. A platform job rechecks the separate platform grant instead of a workspace role.
- An authorization denial records the actor, workspace, job, required permission, and denial reason without contact data, document contents, secrets, invitation tokens, or provider credentials. The reviewed job contract chooses the terminal job state; this spec requires only that denial cannot look successful and cannot retry into a side effect without a newly authorized request.

## Inputs, Outputs, State, Validation, and Errors

- Inputs are a grant, replacement, or revoke request by an owner or the bounded admin cases in the matrix, with the exact expected membership and role-grant versions. Output is an auditable role grant used by server-side policy evaluation.
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

1. **F703-AC-01:** Every `Allow` cell in the approved permission matrix has a same-workspace allow test and an inactive-membership or cross-workspace deny test. Every blank cell has a same-workspace deny test. No role/action pair relies on an untested default.
2. **F703-AC-02:** A client cannot gain authority by changing a workspace ID, role value, URL, hidden form field, queued job, or public token.
3. **F703-AC-03:** Every grant, downgrade, or revoke mutation compare-and-swaps the exact expected membership and role-grant versions; a mismatch changes no authority or audit history and requires rebuilt review. Role revocation therefore prevents a stale concurrent grant, the next privileged request, and any queued job from committing its protected write or provider handoff. A claim-time check alone does not deliver that, because the worker holds the lease across the interval in which the revocation commits: the job rechecks the actor's current authority at execution, immediately before the irreversible side effect, and that recheck and the side effect are linearizable through one shared fence, the shape `docs/EVENT-REVISION-CONTRACT.md` §2.5 already requires between a worker's final checks and its provider handoff. If revocation wins the fence the job cannot cross the handoff; if the handoff wins, revocation observes that ordering rather than reporting queued work as stopped. Owner revoke/downgrade also uses F702-AC-04's serialized workspace invariant so concurrent changes cannot remove the last owner. Denials cause no provider side effect or data disclosure and are recorded without secret/contact content.

   Every grant, downgrade, and revoke also commits its own stable client-supplied request identity, under a uniqueness constraint scoped to the membership it changes, in the same transaction as the authority change and the audit entry it records. A request presenting an already committed identity is resolved from that record before the membership and role-grant version comparison above and returns the outcome that request originally recorded, changing no authority a second time and appending no second audit entry. It is not resolved past the acting actor's own current authority: the authority that admits a first grant, downgrade, or revoke is re-read server-side at the replay, in the same transaction, and the stored outcome is returned only if it still admits the request, so an actor whose own grant was revoked between the commit and the retry is refused rather than answered from the record. The one exception is the authority that same commit removed, which this criterion's own subject matter makes reachable: where the committed mutation is what ended the acting actor's grant, that commit satisfies the read rather than failing the replay. Without the separation, this spec's own revocation rule would be reversible by retry, because the criterion above exists to stop a revoked actor's next privileged request and a replay is exactly that request. That identity is committed together with the request fields that determine the recorded result, at minimum the workspace, the subject membership, the role change requested, and the membership and role-grant versions the request names, and a later request presenting the same identity with any different operand is refused as a conflict, changing no authority and returning no stored outcome, rather than being answered with the result the original request recorded. The identity is still the key and the operands are only a precondition on reusing it, so this is not content uniqueness: two genuinely distinct role changes that read the same are both committed. This rule is stated here in full rather than by reference to `F411-AC-08`, which states the same rule once for the specs that depend on F-411; the Dependencies section explains why this spec cannot take that reference.

   Without it the comparison and the safe-retry behavior contradict each other on the same request. F702-AC-01 and F702-AC-07 give workspace and invitation creation their identities and F702-AC-11's M-07 covers a replayed removal or leave, so role change was the transition on this aggregate left with a version comparison and nothing to resolve against it. When a revoke commits and its response is lost, the retry still names the membership and role-grant versions the administrator read, which that commit advanced, so it is rejected as a mismatch and reported as requiring rebuilt review. An administrator revoking authority in response to an incident is then told the revoke did not take effect when it did, and the plausible next action, granting and revoking again to be sure, writes two more audit entries for one intended change.

4. **F703-AC-04:** Rules-admin functions require the separate platform role and cannot be granted by a workspace owner. A rules-admin function is any operation on a platform rules-admin surface, and reading one is a rules-admin function exactly as much as writing one: comparison, result read, export, preview, and generated report each hand ruleset source, verification, and configuration internals to whoever receives them, so each is admitted only by that role, checked server-side at the operation that produces or returns the data rather than at session start or from a client-supplied role claim, and a refusal discloses nothing about which artifacts, versions, or checksums exist. Authority lost after a result is produced blocks every later read and export of it, including a retained one.

   The read half is stated here because the authority rules on this branch were written around operations that commit. F702-AC-10 quantifies over "every mutation of a workspace-owned aggregate, and every externally initiated callback", F410-AC-08 and F714-AC-09 attach their re-read to the transaction that performs a compare-and-swap, and the paragraph of F702-AC-10 that carries the rule across to platform scope still phrases the obligation as validation "at the moment of the write". A surface that only reads has no commit to attach any of them to, so it satisfied all of them vacuously. `F704-AC-04` already applies this rule to platform-scoped activity; `F606-AC-10`, `F712-AC-07`, and `F713-AC-07` apply it to the three rules-admin surfaces whose criteria never named this spec at all. Platform rules-admin authority never derives from a workspace role, per the deny-by-default state rule above, so naming a workspace, holding any workspace role, or owning a workspace admits nothing on those surfaces.

5. **F703-AC-05:** After F-701, F-702, and F-703 all pass security and migration checks, the production gate may be explicitly enabled; otherwise it remains closed.

6. **F703-AC-06:** Every grant, downgrade, and revoke names the workspace and the subject membership it acts on, and is admitted only by the acting actor's current F-702 membership of that workspace together with the granting authority the approved matrix assigns for that exact role change, both re-read server-side from stored membership and role inside the same transaction that commits the change, serialized against concurrent changes to the acting actor's own authority so that a revocation of the actor's granting authority and the actor's grant cannot both commit. `F703-AC-03` remains the rule for the subject side, and this criterion composes with it rather than restating it: its compare-and-swap covers the membership and role-grant versions of the membership being changed, its request identity covers the retry, and its execution-time recheck covers queued jobs, while this criterion adds the actor side that comparison never reads. Every read of role grants, audit records, and the member-management surface likewise re-reads the acting actor's current membership and the permission the approved matrix assigns for that read, per request rather than at session start or workspace switch. A request failing either check is refused before any durable write and before any grant, role, membership, or audit entry is disclosed, and its response does not distinguish a workspace or membership that does not exist from one the actor may not see. F702-AC-04's serialized last-owner invariant and `F703-AC-04`'s platform separation are unchanged: a workspace owner still cannot grant the platform rules-admin role, and nothing here lets a workspace role confer platform authority.

   Without this criterion the primary mutations this spec defines have no criterion stating who may perform them. `F703-AC-01` tests the matrix's allow and deny pairs, `F703-AC-02` blocks parameter tampering, and `F703-AC-03`'s compare-and-swap reads the subject membership's versions and never the acting actor's authority, so an actor whose own granting authority was revoked a moment earlier, or who never held it at all, still presents matching subject versions and commits the change. `F702-AC-11` M-04 explicitly delegates role-change authority to whatever F-703 approves, so no criterion outside this spec supplies the check either, and the role-grant, audit, and member-management reads were gated nowhere at all.

   The proposed matrix now names every granting and member-management authority this criterion checks. It remains an unapproved input until the product owner approves this spec. Before that approval, this criterion is testable only at the check shape stated above and no implementation may treat the proposed cells as authority.

7. **F703-AC-07:** The subject membership a grant, downgrade, or revoke names must resolve to the workspace that same request names, compared server-side inside the transaction that commits the change and before the subject membership is read for update. `F703-AC-06` re-reads the acting actor's authority for the named workspace and `F703-AC-03` compare-and-swaps the subject membership's own versions, and the two are independent: the workspace and the subject membership arrive as separate request fields, so an actor holding an active membership of workspace A and a membership of workspace B names workspace A and a subject membership in B and passes both. The actor is legitimately authorized where they stand, the named subject membership genuinely exists and its versions are current, and the mutation commits, so a role in another organization's workspace is granted, downgraded, or revoked by an administrator who holds no authority there at all. A mismatch refuses the whole request before any durable write, changes no authority and no role grant, appends no audit entry, and returns the same non-disclosing response `F703-AC-06` requires, which does not distinguish a workspace or membership that does not exist from one the actor may not see.

   This applies `F702-AC-10`'s fourth obligation, which states once for the whole feature set that every record an operation names must resolve to one workspace, to the pair this criterion's own mutations name. It is stated here rather than taken by reference because F-702 is `PROPOSED`, so that criterion is not an approved input, and because an implementation of this spec is built from this spec's criteria; the Dependencies section gives the same reason `F703-AC-03` restates the identity rule locally. `F702-AC-11` M-04 delegates the whole role-change transition to whatever F-703 approves, so no criterion outside this spec supplies the comparison either, and `F702-AC-04`'s last-active-owner invariant is evaluated for the subject membership's own workspace, which with this criterion in force is the named one.

   One input this criterion needs is not established by any approved artifact today and is not invented here. F-702 is `PROPOSED` and establishes no approved membership record, so the workspace a membership resolves to is not an approved input. Until F-702 is approved and listed in `docs/BASELINE.md` this criterion is testable only as "a grant, downgrade, or revoke whose named workspace and named subject membership do not resolve to the same workspace is refused, changes no authority, appends no audit entry, and discloses neither", not against a named workspace model.

## Fixtures and Verification

- Planned automated fixture IDs are the acceptance IDs above; each must map one-to-one to a runnable test before approval can claim implementation readiness.
- F703-AC-01 covers the positive and negative cases its criterion assigns to every matrix cell. It also covers the public and platform-neutral exclusions, including proof that a public RSVP, published-page read, or F-401 rehearsal-window check-in grants no workspace permission.
- F703-AC-04 includes a read-side fixture in which a workspace owner holding no platform rules-admin role is refused a rules-admin comparison, result read, export, preview, and generated report, with a response indistinguishable from the one for a record that does not exist, and a fixture in which the role is revoked after a result is produced and every later read and export of it is refused.
- Regulatory fixtures: none; this feature does not define regulatory ground truth.
- F703-AC-03 includes a fixture in which a revoke commits, its response is lost, and the retry presenting the same request identity and the pre-revoke membership and role-grant versions returns the original recorded outcome rather than a version-mismatch rejection, appending no second audit entry.
- F703-AC-06 includes a fixture in which an authenticated actor holding no membership of the owning workspace names a valid membership and is refused at grant, downgrade, and revoke and at every role-grant, audit, and member-management read, with a response that does not distinguish absence from denial; a fixture in which the acting actor's own granting authority is revoked while a grant is in flight and the grant fails rather than commits; and a fixture in which a self-serve escalation is refused.
- F703-AC-06 also covers every cell in the role-change authority table, an admin attempting to act on an owner or admin, an owner's permitted self-change with another owner present, the same request refused for the last owner, and an active membership with a revoked grant receiving no workspace permission.
- F703-AC-07 includes a fixture in which an actor holding an active membership of two workspaces names one workspace and a subject membership belonging to the other and is refused at grant, downgrade, and revoke, with no authority change, no audit entry, and a response that does not distinguish absence from a different workspace, and a same-workspace control fixture in which the identical mutation commits.
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

### Proposed production-gate runbook

The product owner may open the joint F-701, F-702, and F-703 production gate only after one deployed release records all of these results:

1. F-701 authentication provider settings, verified-email projection, session expiry, logout, recovery, and protected-session checks pass in the production configuration.
2. F-702 workspace, membership, invitation, synthetic-data backfill, one-active-membership, and last-owner migration checks pass from both an empty database and the prior release schema. The product owner records the deployed migration head and the synthetic workspace that received every backfilled row.
3. The F-703 role migration assigns `owner` and `viewer` exactly as this spec states, creates no duplicate active grant, and leaves no active membership with unintended authority.
4. Every `Allow` cell's same-workspace allow and inactive-membership or cross-workspace deny tests pass. Every blank cell's same-workspace deny test passes. Cross-workspace read, write, export, upload, signed-download, public-token administration, and identifier-guessing tests pass for every shipped aggregate.
5. Grant, replacement, revoke, self-change, stale-version, replay, mismatched-replay, concurrent actor revocation, and concurrent last-owner tests pass against the deployed database.
6. A workspace owner and admin both fail every platform rules-admin read and write. A deployment-only platform grant and revoke each succeed once, replay safely, append one audit record, and make a retained result unreadable after revocation.
7. A queued workspace job is denied at claim after its actor loses permission. A second fixture revokes permission after claim and proves the execution-time fence prevents the provider handoff. The opposite ordering records the completed handoff before revocation succeeds.
8. Synthetic browser checks cover member and role management, each role's navigation and denied states, event planning, document download, public-page administration, guest operations, check-in, and the platform rules-admin denial. No check uses real attendee, contact, document, or application data.
9. Format, lint, typecheck, the full test suite, migration tests, and the production build pass on the exact deployed commit. The production dependency audit reports no known production advisory.

The gate starts closed and has one explicit production configuration value. Only the product owner changes it after attaching the commit, migration head, timestamp, and results above to the release record. Rollback closes that value first, stops new claims and provider calls, rolls application code back only to a schema-compatible release, and preserves memberships, grants, audit history, and user records. A failed check leaves the gate closed; it does not create an exception.

## Approval Blockers

- Approve the proposed single-role model, migration defaults, role/action matrix, role-change authority table, and deployment-only platform-role administration path. In particular, approval must accept that a revoked grant leaves an active membership with no permission, admins cannot act on owners or admins, contributors can change event and checklist data but not public-page or attendee state, viewers cannot read attendee contacts, and check-in staff cannot read event intake, plans, checklists, or documents.
- Approve the tenancy/security review and proposed production-gate runbook, including the product-owner-only gate activation and rollback sequence.
- Approve F-702. The matrix now names the granting, replacement, revoke, member-management read, and audit-read authorities `F703-AC-06` checks, but F-702 still supplies the membership and last-owner boundary those checks read.
- Approve F-702 so that the workspace a subject membership resolves to is an approved input `F703-AC-07` can compare. That criterion compares a boundary no approved artifact defines today and may not invent one.
- Approve the Phase 2 OpenAPI and JSON Schema authority handoff, then approve the exact role, membership, platform-grant, audit, and job contract changes. This proposal does not authorize local duplicate request or response types while that handoff remains unapproved.
- Assign the owner, approve this spec, and add it to `docs/BASELINE.md`. The reviewer and approver is the product owner (`docs/DOCUMENTATION-GOVERNANCE.md` §6), which is what this spec's header records, and that is the whole requirement: the independent-reviewer element this blocker used to carry was retired on 2026-08-05 (product owner; see §6 and `docs/BASELINE.md`). Until those three things are done this blocker is not satisfied and this spec is not approved: it stays PROPOSED under governance §3, its Approval date stays `—`, and it is not implementable and not listed in `docs/BASELINE.md`. Retiring the reviewer element made this spec approvable; it did not approve it.
