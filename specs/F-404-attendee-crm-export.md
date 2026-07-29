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

- F-401 accepted check-ins, F-403 contacts/consent, and the F-701/F-702/F-703 gate.
- Approved contact-resolution, retention, export, correction, deletion, and authorization policy.
- Baseline at draft time: PRD, Roadmap, Design, and Phase 0–1.5 Architecture approved 2026-07-22; `ARCHITECTURE-FUTURE.md` approved as a planning target 2026-07-25; NYC ruleset `nyc.v2.7`, rules schema `popengine-rules/v2`, and scenario fixtures v5 where regulatory output is consumed.
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
4. **F404-AC-04:** CSV rows match the active filters, use the approved minimal columns, escape formula-leading values, and expire under the retention policy.
5. **F404-AC-05:** Correction/deletion and ambiguous-identity changes are reflected consistently in list, detail, repeat flag, and future exports.

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

- Start with read-only list/detail and bounded export; keep any contact merge action disabled until its separate policy and acceptance criteria exist.
- Rollback disables the new surface and workers/provider calls without deleting confirmed user data or rewriting immutable plans, rulesets, revisions, or history.

## Approval Blockers

- Approve privacy lifecycle, export columns/limits, role permissions, contact resolution, and audit behavior.
- Assign the owner and independent reviewer, approve this spec, and add it to `docs/BASELINE.md`.
