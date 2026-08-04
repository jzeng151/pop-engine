# F-214 · Vendor and Contractor Compliance

**Status:** PROPOSED (2026-07-26) — ready for review; not implementable until approved and listed in `docs/BASELINE.md`.

**Phase:** 3 · **Issue:** [#35](https://github.com/jzeng151/pop-engine/issues/35) · **Owner:** TBD · **Reviewer:** product owner plus affected architecture, contract, security, and lane owners (TBD) · **Approval date:** —

## Purpose and User Outcome

An organizer can track vendor contacts, insurance, permits, arrival times, and contract status for an event without PopEngine becoming a procurement or legal-review system.

## Scope

**In scope**

- Event-scoped vendor records with contacts, category, confirmed arrival time, contract status, and linked insurance/permit evidence.
- Show unresolved compliance items and expiration/arrival conflicts from recorded facts.
- Preserve source and history for status changes and attachments.

**Non-goals**

- Vendor marketplace, contracting, payments, background checks, legal review, or automatic compliance certification.
- Inventing vendor permits or insurance requirements.

## Dependencies and Baseline

- F-208, F-209, F-210 where applicable, and the F-701/F-702/F-703 gate. F-702 supplies the workspace membership boundary the event and its vendor records resolve against and F-703 supplies the permission matrix `F214-AC-08` checks; F-701 supplies the authenticated actor both read from. All three are PROPOSED, so the gate is not an approved input today and this spec is not implementable against it until they are approved and listed in `docs/BASELINE.md`.
- Approved vendor status/category and document/privacy contracts.
- Baseline at draft time: PRD, Roadmap, Design, and Phase 0–1.5 Architecture approved 2026-07-22; `ARCHITECTURE-FUTURE.md` approved as a planning target 2026-07-25; NYC ruleset `nyc.v2.7`, rules schema `popengine-rules/v2`, and scenario fixtures v5 where regulatory output is consumed.
- Operand binding for client-supplied identities: `specs/F-411-staff-roles-credentialed-entry.md` F411-AC-08 states once, for this whole branch, that a client-supplied identity is committed with the operands that determine its recorded result and that a reuse carrying different operands is a conflict rather than a replay. Every identity criterion below relies on it. F-411 is PROPOSED, so that rule is not an approved input today and this spec is not implementable against it until F-411 is approved or the rule is promoted to an approved shared invariant; F411-AC-08 records both paths.
- The approval PR must re-pin any baseline version that changes before approval. A proposed or superseded input blocks implementation.

## Inputs, Outputs, State, Validation, and Errors

- Inputs are organizer-confirmed vendor facts and source-backed requirements; outputs are event-scoped vendor/compliance projections.
- Status and evidence changes append history; unknown requirements remain unresolved.
- A vendor contact is not automatically a marketing contact and carries no attendee consent.
- Missing or unresolved material data stays visibly unset, unknown, pending, or failed as appropriate; it never becomes a successful or complete result.
- Invalid input produces a field or action-specific error without partial mutation. Retriable external failures preserve the user's confirmed state and expose a safe retry.

## UI and Accessibility

- Vendor rows show arrival, contract, permit, insurance, expiration, and unknown states separately rather than one misleading compliance badge.
- The complete workflow is keyboard operable, uses programmatic labels and visible focus, does not encode status by color alone, and announces asynchronous success or failure.
- Empty, loading, permission-denied, validation, provider-failure, and unavailable states have explicit copy and a safe next action.

## System Impact

| Concern              | Proposed impact                                                                                                                      |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| API                  | Vendor, contact, evidence, and history operations require approved OpenAPI contracts.                                                |
| Schema               | Forward migrations for vendors and vendor-compliance links; reuse approved document/certificate records rather than duplicate files. |
| Jobs                 | Optional confirmed-date reminders only through approved jobs; no procurement workflow.                                               |
| Providers            | Private storage/scanning only through existing adapters.                                                                             |
| Privacy and security | Workspace scope, minimal contact access, private documents, retention, and no vendor contact content in logs.                        |

Exact HTTP, JSON Schema, migration, job, and provider shapes belong in their reviewed machine contracts; this proposal does not authorize parallel local types or edits to merged migrations.

## Acceptance Criteria

1. **F214-AC-01:** An authorized organizer can create and update an event vendor with the approved minimal fields and source-linked evidence. Every update here is subject to F214-AC-04's compare-and-swap; no vendor field is editable without naming the vendor projection version it was composed against.
2. **F214-AC-02:** Permit, insurance, contract, and arrival states remain independent; their aggregate describes workflow-record completeness only and never regulatory sufficiency or agency acceptance.
3. **F214-AC-03:** Missing, unknown, expired, conflicting, user-recorded, or not-authoritatively-accepted evidence remains visibly distinct and prevents a regulatory compliance claim.
4. **F214-AC-04:** Status changes and replacement documents preserve actor/time/version history, and preserving that history is not on its own enough to keep two actors from overwriting each other. Every vendor update supplies the opaque concurrency tokens the actor read for the vendor projection and for each record the change touches. That is every update, not only status changes and replacement documents: an AC-01 edit to contact, category, arrival time, or any other core vendor field carries the expected vendor projection token on the same terms, because two organizers editing one vendor from a single observed version otherwise both succeed and the later core-field write erases a confirmed edit exactly as an unguarded status change would. In one transaction the server locks those records in a deterministic order, compares every supplied token, appends the history entries, and advances the projection and its tokens; a stale token rejects the whole update as a conflict and mutates nothing. Without that compare-and-swap, two actors editing the same vendor from one observed version are both told their change saved while the later projection silently hides a confirmed update. This is the same rule `docs/EVENT-REVISION-CONTRACT.md` §2.2 applies to stable Event metadata and §2.5 applies to workflow items at plan acceptance; F-214 owns these records, so the exact token representation belongs in its reviewed OpenAPI and forward migration.

   Every vendor update also commits its own stable client-supplied request identity, distinct from the creation identity in F214-AC-07 and from every other update's, under a uniqueness constraint scoped to the vendor it mutates, and that identity is committed in the same transaction as the update's recorded outcome and its history entry. A request presenting an already committed identity is resolved from that record before the token comparison above and returns the outcome that request originally recorded, appending no second history entry and advancing no token a second time. That covers every mutation this criterion reaches: a status change, an evidence or replacement-document change, and an AC-01 edit to contact, category, arrival time, or any other core field. That identity binds its operands under the rule `F411-AC-08` states once for every client-supplied identity on this branch, so a reuse carrying different operands is a conflict rather than a replay.

   The ordering is what the criterion turns on, and stating only that updates carry an identity would not deliver it. When an update commits and its response is lost, the retry still presents the projection and evidence tokens the actor read before that commit, which the commit itself has advanced. Compared first, those tokens are stale by construction and the whole update is rejected as a conflict, so the organizer is told their confirmed change did not save and is sent to reload and reconcile a change that in fact succeeded. That is the compare-and-swap and the shared error contract's safe-retry promise contradicting each other on the same request. Resolving the identity first answers the retry with its original outcome and leaves the token comparison to do what it is for, which is rejecting a genuinely stale second edit composed from an older observed state.
5. **F214-AC-05:** Vendor contacts do not enter attendee CRM, campaign eligibility, or consent records automatically.
6. **F214-AC-06:** Each vendor projection pins the exact F-208/F-209/F-210 requirement and evidence versions it consumes. Supersession or removal visibly marks affected projection data stale and excludes it from current workflow completeness until reconciled, while preserving the prior requirement, evidence, and status history.
7. **F214-AC-07:** Creating a vendor binds the request to a stable client-supplied request identity, committed with the vendor under a uniqueness constraint scoped to the event. A retry presenting the same identity returns the original vendor and creates no second row; a deliberately separate vendor uses a new identity. This is request identity, never content uniqueness: two genuinely distinct vendors that read the same, including the same company name and contact, are both created, and a repeated identity is never rejected as a duplicate value. That identity binds its operands under the rule `F411-AC-08` states once for every client-supplied identity on this branch: it is committed together with the request fields that determine the recorded result, including every aggregate, version, and generation the request names, and a later request presenting the same identity with any different operand is refused as a conflict rather than being answered with the stored result. The identity is still the key and the operands are only a precondition on reusing it, so this is not the content uniqueness this criterion already forbids.

   AC-04 protects later status and evidence edits with concurrency tokens, and a token can only defend a record that already exists. When creation commits and its response is lost, the retry creates a second vendor and the event carries two records for one supplier. Subsequent permits, certificates, and contracts attach to whichever the organizer happens to open, so AC-02's per-vendor completeness is computed over evidence split across duplicates and reads as incomplete on both.

8. **F214-AC-08:** Every operation this feature defines names the vendor it acts on, or on creation the event the vendor will belong to, and the workspace that owns it, and is admitted only by the acting actor's current F-702 membership of that workspace together with the F-703 permission approved for the action, both re-read server-side from stored membership and role at the moment of the operation and, for a write, inside the same transaction that commits it. That covers vendor creation under F214-AC-07, an edit to contact, category, arrival time, or any other core vendor field under F214-AC-01, a status change and an evidence or replacement-document change under F214-AC-04, and every read this feature defines, of a vendor, its contacts, its compliance projections and their pinned requirement and evidence versions under F214-AC-02, F214-AC-03, and F214-AC-06, its unresolved-item and conflict views, and its actor/time/version history. F214-AC-01 says "an authorized organizer" without defining one; this criterion is that definition, and it is the rule for every operation, not only the create and update AC-01 names. A request failing the check is refused before any durable write and before any vendor field, contact, document reference, projection, or history entry is disclosed, and its response does not distinguish a vendor or event that does not exist from one the actor may not see. The check is at the operation and not at session start or workspace switch, so authority removed while a request is in flight causes that request to fail rather than commit.

   Without this criterion AC-01 through AC-07 all pass for a caller who names another workspace's event or vendor. They fix field independence, evidence visibility, concurrency tokens, request identity, consent separation, and version pinning, and not one of them asks who the actor is beyond the undefined word "authorized". The surface that set leaves open reads another organizer's vendor contacts, insurance and permit evidence, and compliance state, and creates or rewrites vendor records on their event, for anyone who can name it.

   One input this criterion needs is not established by any approved artifact today and is not invented here. F-703 is PROPOSED and names no role set, so the permission above cannot be named. Until F-703 is approved this criterion is testable only as "every vendor creation, mutation, and read is refused unless the acting actor holds an active membership of the workspace that owns the named event, read server-side at that operation, and a refusal discloses nothing about whether that event or vendor exists", not against a named role or permission identifier. Naming the vendor creation, read, and management permissions with F-703 is an approval blocker below.

## Fixtures and Verification

- Planned automated fixture IDs are the acceptance IDs above; each must map one-to-one to a runnable test before approval can claim implementation readiness.
- Regulatory fixtures: Only approved vendor-related findings may seed requirements; vendor records and evidence are synthetic.
- F214-AC-04 includes a fixture in which a vendor status change commits, its response is lost, and the retry presenting the same request identity and the pre-update tokens returns the original recorded outcome rather than a stale-token conflict, appending no second history entry; and a fixture in which a genuinely stale second edit composed from an older observed state is still rejected as a conflict.
- F214-AC-08 includes a fixture in which an actor holding no membership of the owning workspace names a valid event and vendor and is refused at vendor creation, at every AC-01 and AC-04 mutation, and at every read of the vendor, its contacts, its compliance projections, and its history, with a response that does not distinguish absence from denial, and a fixture in which authority removed while an update is in flight fails that request rather than committing.
- Security-sensitive and cross-workspace paths require negative authorization tests; provider paths require success, duplicate-delivery, retry, invalid-signature, and permanent-failure tests where applicable.

## Allowed Footprint and Coordination

- `apps/web` and `apps/api` feature code and tests.
- New ordered forward migrations and approved OpenAPI/JSON Schema changes required by this feature.
- No repository restructuring, speculative package, or unrelated feature edit.
- Shared contracts, migrations, provider adapters, engine/rules artifacts, consent policy, and cross-lane UI primitives require the approvals named in `docs/DOCUMENTATION-GOVERNANCE.md` §6.

## Rollout and Fallback

- Manual event-scoped tracking only; no vendor portal or provider integration.
- Rollback disables the new surface and workers/provider calls without deleting confirmed user data or rewriting immutable plans, rulesets, revisions, or history.

## Approval Blockers

- Approve minimal vendor fields, source-backed requirement mapping, privacy/retention, and status wording.
- Approve F-701, F-702, and F-703, and name with F-703 the vendor creation, read, and management permissions `F214-AC-08` checks. That criterion checks a permission no approved artifact defines today and may not invent one, so until the matrix names them it is testable only at the membership level stated there.
- Assign the owner and independent reviewer, approve this spec, and add it to `docs/BASELINE.md`.
