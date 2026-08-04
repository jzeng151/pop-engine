# F-404 · Attendee CRM and Export

**Status:** PROPOSED (2026-07-26) — ready for review; not implementable until approved and listed in `docs/BASELINE.md`.

**Phase:** 2 · **Issue:** [#24](https://github.com/jzeng151/pop-engine/issues/24) · **Owner:** TBD · **Reviewer:** product owner plus affected architecture, contract, security, and lane owners (TBD) · **Approval date:** —

## Purpose and User Outcome

An authorized organizer can view consent-aware attendee history across their workspace's events, export it, and identify repeat attendance without crossing tenant boundaries.

## Scope

**In scope**

- Workspace-scoped attendee list, event history, consent/suppression summary, CSV export, and repeat-attendee flag.
- Define a repeat attendee as one resolved contact linked to attendance at two or more distinct workspace events.
- Apply retention, correction, and deletion decisions to views and exports.

**Non-goals**

- Sales pipeline automation, contact enrichment, scoring, cross-workspace identity, or automatic deduplication of ambiguous people.
- Treating attendance as marketing consent.

## Dependencies and Baseline

- F-401 accepted check-ins, F-403 contacts/consent, and the F-701/F-702/F-703 gate. F-702 supplies the workspace membership boundary contacts, event history, and export jobs resolve against and F-703 supplies the permission matrix `F404-AC-09` checks; F-701 supplies the authenticated actor both read from. All three are PROPOSED, so the gate is not an approved input today and this spec is not implementable against it until they are approved and listed in `docs/BASELINE.md`.
- Approved contact-resolution, retention, export, correction, deletion, and authorization policy.
- Baseline at draft time: PRD, Roadmap, Design, and Phase 0–1.5 Architecture approved 2026-07-22; `ARCHITECTURE-FUTURE.md` approved as a planning target 2026-07-25; NYC ruleset `nyc.v2.7`, rules schema `popengine-rules/v2`, and scenario fixtures v5 where regulatory output is consumed.
- Operand binding for client-supplied identities: `specs/F-411-staff-roles-credentialed-entry.md` F411-AC-08 states once, for this whole branch, that a client-supplied identity is committed with the operands that determine its recorded result and that a reuse carrying different operands is a conflict rather than a replay. Every identity criterion below relies on it. F-411 is PROPOSED, so that rule is not an approved input today and this spec is not implementable against it until F-411 is approved or the rule is promoted to an approved shared invariant; F411-AC-08 records both paths.
- The approval PR must re-pin any baseline version that changes before approval. A proposed or superseded input blocks implementation.

## Inputs, Outputs, State, Validation, and Errors

- Inputs are workspace-authorized filters; outputs are a paginated contact projection or bounded CSV export.
- Repeat status derives only from an F-401 accepted check-in explicitly linked to a resolved F-403 contact and distinct event; check-in/contact corrections or deletions update the projection without rewriting source history.
- Ambiguous identities remain separate; export state is requested → generated, failed, expired, or downloaded.
- Missing or unresolved material data stays visibly unset, unknown, pending, or failed as appropriate; it never becomes a successful or complete result.
- Invalid input produces a field or action-specific error without partial mutation. Retriable external failures preserve the user's confirmed state and expose a safe retry.

## UI and Accessibility

- Tables expose active filters, result count, consent/suppression meaning, repeat-attendee definition, and an accessible export status.
- The complete workflow is keyboard operable, uses programmatic labels and visible focus, does not encode status by color alone, and announces asynchronous success or failure.
- Empty, loading, permission-denied, validation, provider-failure, and unavailable states have explicit copy and a safe next action.

## System Impact

| Concern              | Proposed impact                                                                                                                                    |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| API                  | Workspace contact/history/query/export operations require approved OpenAPI contracts with pagination and bounded export behavior.                  |
| Schema               | Uses F-403 contact/consent records; add only approved history/read-model or export-job storage by forward migration.                               |
| Jobs                 | Durable job for bounded large CSV exports; small synchronous export may be approved if measured safe.                                              |
| Providers            | Private object storage only if exports are staged for download.                                                                                    |
| Privacy and security | Role-gated workspace scope, formula-injection-safe CSV, short-lived download, audit record, data minimization, and retention/deletion enforcement. |

Exact HTTP, JSON Schema, migration, job, and provider shapes belong in their reviewed machine contracts; this proposal does not authorize parallel local types or edits to merged migrations.

## Acceptance Criteria

1. **F404-AC-01:** An authorized user sees only contacts and event history belonging to the active workspace.
2. **F404-AC-02:** Repeat-attendee status is true only for one resolved contact linked to accepted F-401 check-ins at at least two distinct events; RSVP or consent alone never counts, and check-in/contact correction or deletion recomputes the flag.
3. **F404-AC-03:** Consent and suppression are displayed by purpose/channel and are not inferred from RSVP or attendance.
4. **F404-AC-04:** CSV rows match the active filters, use the approved minimal columns, escape cells beginning with `=`, `+`, `-`, `@`, tab, carriage return, or line feed (including control-prefixed formulas), and expire under the retention policy.
5. **F404-AC-05:** Correction/deletion and ambiguous-identity changes are reflected consistently in list, detail, repeat flag, and future exports.
6. **F404-AC-06:** Contact, check-in, consent, and suppression source versions plus their complete generation are pinned to each export; artifact publication compare-and-swaps that generation and serializes with every correction, deletion, consent transition, or suppression change, so stale in-flight work cannot publish superseded data. Any such change invalidates queued jobs and unexpired staged downloads containing superseded data, requiring regeneration. Already downloaded copies cannot be recalled and remain subject to the approved retention notice.
7. **F404-AC-07:** Every staged CSV remains private; each download issuance rechecks current workspace membership/role and returns only a short-lived signed URL or an authorized streaming response. Authorization loss blocks new access, and an issued direct-storage URL has only its disclosed bounded validity until expiry.
8. **F404-AC-08:** Creating an export binds the request to a stable client-supplied request identity, committed with the export job under a uniqueness constraint scoped to the workspace. A retry presenting the same identity returns the original job and, once complete, its original artifact, and enqueues no second job and stages no second file; a deliberately separate export sends a new identity. This is request identity, never content uniqueness: two genuinely distinct exports over the same filters and the same pinned generation are both produced, and a repeated identity is never rejected as a duplicate value. That identity binds its operands under the rule `F411-AC-08` states once for every client-supplied identity on this branch: it is committed together with the request fields that determine the recorded result, including every aggregate, version, and generation the request names, and a later request presenting the same identity with any different operand is refused as a conflict rather than being answered with the stored result. The identity is still the key and the operands are only a precondition on reusing it, so this is not the content uniqueness this criterion already forbids.

   AC-06 pins the source generation and compare-and-swaps it at publication, which guards freshness rather than replay: a retry re-reads the same generation and passes that check. When the create transaction commits and its response is lost, the retry stages a second CSV of attendee contacts. That is a second copy of sensitive personal data in private storage, a second retention clock, and a second audit trail entry for one authorized action, and AC-07's per-download authorization recheck does not reduce the number of artifacts that exist.

9. **F404-AC-09:** Every operation this feature defines names the workspace whose contacts it acts on, and is admitted only by the acting actor's current F-702 membership of that workspace together with the F-703 permission approved for the action, both re-read server-side from stored membership and role at the moment of the operation and, for a write, inside the same transaction that commits it. That covers the contact list, detail, event-history, and query reads under F404-AC-01, F404-AC-03, and F404-AC-05, creating an export job under F404-AC-08, with the check inside the same transaction that commits the job, and export generation and artifact publication under F404-AC-06. F404-AC-07 remains the rule for the download leg: each staged-CSV download issuance rechecks current workspace membership and role as that criterion states, and this criterion covers every operation before that leg, so an export whose creator's authority is later withdrawn is not generated or published on the withdrawn authority either. A request failing the check is refused before any durable write and before any contact, history row, consent or suppression state, or export artifact is disclosed, and its response does not distinguish a workspace, contact, or export that does not exist from one the actor may not see. The check is at the operation and not at session start or workspace switch, so authority removed while a request is in flight causes that request to fail rather than commit.

   Without this criterion the existing criteria all pass for an authenticated caller who names another workspace's contacts or export. F404-AC-01 scopes what a response may contain to the active workspace and does not state how "authorized" is established, when authority is read, or that it is re-read at each operation; F404-AC-07 rechecks authority only at download issuance; and AC-02 through AC-06 and AC-08 fix the repeat flag, consent display, CSV escaping, correction propagation, generation pinning, and request identity, and not one asks who the actor is. The surface they leave open reads another workspace's attendee contacts, consent and suppression state, and event history, and commits export jobs and staged CSV artifacts of that data against it.

   One input this criterion needs is not established by any approved artifact today and is not invented here. F-703 is PROPOSED and names no role set, so the permission above cannot be named. Until F-703 is approved this criterion is testable only as "every contact read, export-job creation, export generation, and artifact publication is refused unless the acting actor holds an active membership of the workspace that owns the named contacts or export, read server-side at that operation, and a refusal discloses nothing about whether that workspace, contact, or export exists", not against a named role or permission identifier. Naming the contact read and export permissions with F-703 is an approval blocker below.

## Fixtures and Verification

- Planned automated fixture IDs are the acceptance IDs above; each must map one-to-one to a runnable test before approval can claim implementation readiness.
- Regulatory fixtures: none; this feature does not define regulatory ground truth.
- F404-AC-09 includes a fixture in which an actor holding no membership of the owning workspace names a valid workspace and export and is refused at the list, detail, history, and query reads, at export-job creation, and at generation and publication, with a response that does not distinguish absence from denial, and a fixture in which authority removed mid-flight fails the request rather than committing the export job.
- Security-sensitive and cross-workspace paths require negative authorization tests; provider paths require success, duplicate-delivery, retry, invalid-signature, and permanent-failure tests where applicable.

## Allowed Footprint and Coordination

- `apps/web` and `apps/api` feature code and tests.
- New ordered forward migrations and approved OpenAPI/JSON Schema changes required by this feature.
- No repository restructuring, speculative package, or unrelated feature edit.
- Shared contracts, migrations, provider adapters, engine/rules artifacts, consent policy, and cross-lane UI primitives require the approvals named in `docs/DOCUMENTATION-GOVERNANCE.md` §6.

## Rollout and Fallback

- Start with read-only list/detail and bounded export; keep any contact merge action disabled until its separate policy and acceptance criteria exist.
- Rollback disables the new surface and workers/provider calls without deleting confirmed user data or rewriting immutable plans, rulesets, revisions, or history.

## Approval Blockers

- Approve privacy lifecycle, export columns/limits, role permissions, contact resolution, and audit behavior.
- Approve F-701, F-702, and F-703, and name with F-703 the contact read and export permissions `F404-AC-09` checks. That criterion checks a permission no approved artifact defines today and may not invent one, so until the matrix names them it is testable only at the membership level stated there.
- Assign the owner and independent reviewer, approve this spec, and add it to `docs/BASELINE.md`.
