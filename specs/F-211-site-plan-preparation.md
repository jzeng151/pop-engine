# F-211 · Site Plan Preparation

**Status:** PROPOSED (2026-07-26) — ready for review; not implementable until approved and listed in `docs/BASELINE.md`.

**Phase:** 3 · **Issue:** [#33](https://github.com/jzeng151/pop-engine/issues/33) · **Owner:** TBD · **Reviewer:** product owner plus affected architecture, contract, security, and lane owners (TBD) · **Approval date:** —

## Purpose and User Outcome

An organizer can assemble a site-plan checklist, dimensions, and versioned uploads tied to the relevant requirement without PopEngine pretending to author or approve a professional plan.

## Scope

**In scope**

- Requirement-derived preparation checklist, organizer-entered dimensions/notes, controlled uploads, and immutable file versions.
- Link each site-plan record to its checklist/application context and show missing required elements.
- Preview metadata and download safe versions.

**Non-goals**

- CAD/drawing tools, professional certification, plan review, agency submission, or inferring dimensions from files.
- Inventing required elements not present in published rules or user-confirmed agency instructions.

## Dependencies and Baseline

- F-202, F-208 where an application exists, F-209 upload controls, and the F-701/F-702/F-703 gate. F-702 supplies the workspace membership boundary the site-plan record and its event resolve against and F-703 supplies the permission matrix `F211-AC-10` checks; F-701 supplies the authenticated actor both read from. All three are PROPOSED, so the gate is not an approved input today and this spec is not implementable against it until they are approved and listed in `docs/BASELINE.md`.
- Approved site-plan checklist source and upload/scanning ADR.
- Baseline at draft time: PRD, Roadmap, Design, and Phase 0–1.5 Architecture approved 2026-07-22; `ARCHITECTURE-FUTURE.md` approved as a planning target 2026-07-25; NYC ruleset `nyc.v2.7`, rules schema `popengine-rules/v2`, and scenario fixtures v5 where regulatory output is consumed.
- Operand binding for client-supplied identities: `specs/F-411-staff-roles-credentialed-entry.md` F411-AC-08 states once, for this whole branch, that a client-supplied identity is committed with the operands that determine its recorded result and that a reuse carrying different operands is a conflict rather than a replay. Every identity criterion below relies on it. F-411 is PROPOSED, so that rule is not an approved input today and this spec is not implementable against it until F-411 is approved or the rule is promoted to an approved shared invariant; F411-AC-08 records both paths.
- The approval PR must re-pin any baseline version that changes before approval. A proposed or superseded input blocks implementation.

## Inputs, Outputs, State, Validation, and Errors

- Inputs are source-backed checklist elements, organizer dimensions/notes, and files; outputs are a current site-plan projection with immutable versions.
- Version state is upload pending → scanning → available or rejected; replacement creates a new version and follows F211-AC-08, which is where the compare-and-swap and retry-identity rule is binding.
- Unknown dimensions or conflicting instructions remain visible and prevent a complete claim.
- Missing or unresolved material data stays visibly unset, unknown, pending, or failed as appropriate; it never becomes a successful or complete result.
- Invalid input produces a field or action-specific error without partial mutation. Retriable external failures preserve the user's confirmed state and expose a safe retry.

## UI and Accessibility

- Checklist/source links, dimension units, upload progress, scan status, version history, and incomplete warnings are accessible.
- The complete workflow is keyboard operable, uses programmatic labels and visible focus, does not encode status by color alone, and announces asynchronous success or failure.
- Empty, loading, permission-denied, validation, provider-failure, and unavailable states have explicit copy and a safe next action.

## System Impact

| Concern              | Proposed impact                                                                                 |
| -------------------- | ----------------------------------------------------------------------------------------------- |
| API                  | Site-plan/checklist/version/upload operations require approved OpenAPI contracts.               |
| Schema               | Forward migrations for site-plan records and file versions; bytes remain private.               |
| Jobs                 | File scanning and optional document rendering only through approved durable jobs.               |
| Providers            | Private storage/scanning adapter.                                                               |
| Privacy and security | Workspace scope, signed URLs, file validation/scan, retention, and no document content in logs. |

Exact HTTP, JSON Schema, migration, job, and provider shapes belong in their reviewed machine contracts; this proposal does not authorize parallel local types or edits to merged migrations.

## Acceptance Criteria

1. **F211-AC-01:** Every preparation checklist element is either linked to an approved published rule or visibly labeled user-recorded/non-regulatory with exact organizer-confirmed agency-instruction evidence; the latter cannot mutate the plan/ruleset or support an official completeness claim.
2. **F211-AC-02:** Dimensions require explicit units and validate approved ranges without inferring missing values.
3. **F211-AC-03:** Replacing a file preserves earlier version metadata, follows F211-AC-08, and never edits a merged migration or immutable plan.
4. **F211-AC-04:** Unknown/conflicting elements remain visible and prevent the interface from claiming the site plan complete.
5. **F211-AC-05:** Unauthorized, unsafe, oversized, or mismatched files cannot be viewed or marked available.
6. **F211-AC-06:** Each download issuance rechecks workspace role, ownership, and scan state and returns only a short-lived signed URL; authorization loss blocks new URLs and issued direct-storage URLs retain only bounded validity until expiry.
7. **F211-AC-07:** Every preparation element, dimension set, and uploaded plan pins the exact finding/plan version; supersession or removal marks the preparation visibly stale and prevents a current/complete claim without rewriting its history.
8. **F211-AC-08:** A replacement names the exact site-plan file version it was composed against and commits only by compare-and-swap on that version: one transaction appends the new version and advances the current-site-plan projection while the named version is still current. A replacement naming a superseded version is rejected, is not appended, and returns the current version for the organizer to resubmit against. Every replacement carries a stable request identity, committed with the appended version under a uniqueness constraint scoped to the site-plan record it replaces, and a request presenting an already committed identity is resolved from that record before the version comparison above and returns the outcome that request originally recorded, appending no second version. The ordering is stated because the two rules otherwise contradict each other on one request: when a replacement commits and its response is lost, the retry still names the file version the organizer read, which that commit superseded, so a comparison made first rejects it as stale for work that in fact succeeded and the organizer resubmits, appending a second version for one intended replacement. Concurrent replacements of one site-plan file therefore end with exactly one accepted current version and explicit rejections, never a last-write-wins projection that hides a confirmed replacement the other organizer was told had succeeded. Preserving the earlier immutable version under F211-AC-03 is not sufficient on its own, because both writes succeed and only the projection pointer races. That identity binds its operands under the rule `F411-AC-08` states once for every client-supplied identity on this branch: it is committed together with the request fields that determine the recorded result, including every aggregate, version, and generation the request names, and a later request presenting the same identity with any different operand is refused as a conflict rather than being answered with the stored result. The identity is still the key and the operands are only a precondition on reusing it, so this is not the content uniqueness this criterion already forbids.

   The same rule covers every other mutable preparation field, not only file replacement. Each write to a dimension set under AC-02, to a preparation element's user-recorded state or evidence under AC-01, to its checklist completion, and to any organizer note names the exact current site-plan preparation projection version it was composed against and commits only by compare-and-swap on that version; a write naming a superseded version is rejected, mutates nothing, and returns the current projection for the organizer to reload and recompose against. AC-07 compares the pinned finding/plan version, which detects a regulatory supersession and never a second organizer editing the same preparation from the same observed state, so without this rule two tabs editing one dimension set, note, or checklist entry both report success, the later write erases the earlier confirmed edit, and the AC-04 completeness claim moves on a value nobody was told had changed.

9. **F211-AC-09:** Creating a site-plan record, and uploading its first file version, bind the request to a stable client-supplied request identity, committed with the record under a uniqueness constraint scoped to the event. A retry presenting the same identity returns the original record and its first version and appends nothing; a deliberately separate site plan uses a new identity. This is request identity, never content uniqueness: two genuinely distinct site plans whose files are byte-identical are both created, and a repeated identity is never rejected as a duplicate value. That identity binds its operands under the rule `F411-AC-08` states once for every client-supplied identity on this branch: it is committed together with the request fields that determine the recorded result, including every aggregate, version, and generation the request names, and a later request presenting the same identity with any different operand is refused as a conflict rather than being answered with the stored result. The identity is still the key and the operands are only a precondition on reusing it, so this is not the content uniqueness this criterion already forbids.

   AC-08 gives replacements this behaviour and begins at the second version, so the first upload is unprotected. When the create-and-upload transaction commits and its response is lost, the retry produces a second site-plan record, or a second first version, each with its own current-site-plan projection. AC-07's staleness rule then pins findings to both, and the organizer has two competing current site plans where AC-04 expects one.

10. **F211-AC-10:** Every operation this feature defines names the site-plan record it acts on and the workspace that owns it, and is admitted only by the acting actor's current F-702 membership of that workspace together with the F-703 permission approved for the action, both re-read server-side from stored membership and role at the moment of the operation and, for a write, inside the same transaction that commits it. That covers site-plan record creation and the first-version upload under F211-AC-09, file replacement under F211-AC-08, every write to a dimension set, a preparation element's user-recorded state or evidence, checklist completion, and organizer notes under F211-AC-08, F211-AC-01, and F211-AC-02, and every read: the current site-plan projection, the version history, and the staleness views under F211-AC-04 and F211-AC-07. F211-AC-06 remains the rule for its leg, the recheck of workspace role, ownership, and scan state at each download issuance, and F211-AC-05 remains the file-safety rule rejecting unauthorized, unsafe, oversized, or mismatched files; this criterion does not restate either and gates everything they do not reach. A request failing the check is refused before any durable write and before any dimension, note, checklist state, version, or projection is disclosed, and its response does not distinguish a site-plan record that does not exist from one the actor may not see. The check is at the operation and not at session start or workspace switch, so authority removed while a request is in flight causes that request to fail rather than commit.

    Without this criterion AC-01 through AC-04 and AC-07 through AC-09 all pass for a caller who names another workspace's site-plan record. They fix the source labeling of checklist elements, the unit validation, the version preservation, the visibility of unknown elements, the finding-version pinning and staleness, the compare-and-swap and replay identity of replacements and field writes, and the creation identity, and not one of them asks who the actor is; AC-06 and AC-05 gate only download issuance and file content. The surface that set leaves open reads another organizer's dimensions, notes, checklist state, and version history, and creates records, replaces files, and rewrites preparation state in their workspace.

    One input this criterion needs is not established by any approved artifact today and is not invented here. F-703 is PROPOSED and names no role set, so the permission above cannot be named. Until F-703 is approved this criterion is testable only as "every site-plan read and mutation is refused unless the acting actor holds an active membership of the workspace that owns the named site-plan record, read server-side at that operation, and a refusal discloses nothing about whether that record exists", not against a named role or permission identifier. Naming the site-plan read and mutation permissions with F-703 is an approval blocker below.

## Fixtures and Verification

- Planned automated fixture IDs are the acceptance IDs above; each must map one-to-one to a runnable test before approval can claim implementation readiness.
- Regulatory fixtures: Use approved findings that require site-plan-related documents; all dimensions/files are synthetic.
- F211-AC-08 includes a fixture in which a file replacement commits, its response is lost, and the retry presenting the same request identity and the pre-replacement file version returns the original recorded outcome rather than a superseded-version rejection, appending no second version.
- F211-AC-10 includes a fixture in which an actor holding no membership of the owning workspace names a valid site-plan record and is refused at creation and first-version upload, at file replacement, at every dimension, element, checklist, and note write, and at every projection, history, and staleness read, with a response that does not distinguish absence from denial, and a fixture in which authority removed while a mutation is in flight fails that request rather than committing.
- Security-sensitive and cross-workspace paths require negative authorization tests; provider paths require success, duplicate-delivery, retry, invalid-signature, and permanent-failure tests where applicable.

## Allowed Footprint and Coordination

- `apps/web` and `apps/api` feature code and tests.
- New ordered forward migrations and approved OpenAPI/JSON Schema changes required by this feature.
- No repository restructuring, speculative package, or unrelated feature edit.
- Shared contracts, migrations, provider adapters, engine/rules artifacts, consent policy, and cross-lane UI primitives require the approvals named in `docs/DOCUMENTATION-GOVERNANCE.md` §6.

## Rollout and Fallback

- Checklist plus versioned uploads only; no editor or extraction until separately scheduled.
- Rollback disables the new surface and workers/provider calls without deleting confirmed user data or rewriting immutable plans, rulesets, revisions, or history.

## Approval Blockers

- Approve source-backed checklist content, units/validation, retention, and upload policy.
- Approve F-701, F-702, and F-703, and name with F-703 the site-plan read and mutation permissions `F211-AC-10` checks. That criterion checks a permission no approved artifact defines today and may not invent one, so until the matrix names them it is testable only at the membership level stated there.
- Assign the owner and independent reviewer, approve this spec, and add it to `docs/BASELINE.md`.
