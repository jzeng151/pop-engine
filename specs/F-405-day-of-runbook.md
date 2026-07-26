# F-405 · Day-of Runbook

**Status:** PROPOSED (2026-07-26) — ready for review; not implementable until approved and listed in `docs/BASELINE.md`.

**Phase:** 2 · **Issue:** [#25](https://github.com/jzeng151/pop-engine/issues/25) · **Owner:** TBD · **Reviewer:** product owner plus affected architecture, contract, security, and lane owners (TBD) · **Approval date:** —

## Purpose and User Outcome

An organizer can generate one current event-day sheet containing confirmed permit references, load-in tasks, contacts, and staff assignments without presenting missing data as complete.

## Scope

**In scope**

- Assemble a versioned runbook from current confirmed checklist/application data, organizer-entered load-in tasks/contacts, and available staff assignments.
- Preview, refresh, and print the runbook with source timestamps and incomplete/conflict warnings.
- Keep regulatory wording and statuses sourced from the approved plan/findings.

**Non-goals**

- Replacing source records, dispatching staff, emergency response, a general task manager, or inventing missing permit/contact facts.
- Marking an event operationally ready solely because a runbook was generated.

## Dependencies and Baseline

- F-202 checklist, F-208/F-209 records where present, and the F-701/F-702/F-703 gate.
- F-213 may enrich staff assignments later but is not required for a runbook without assignments.
- Baseline at draft time: PRD, Roadmap, Design, and Phase 0–1.5 Architecture approved 2026-07-22; `ARCHITECTURE-FUTURE.md` approved as a planning target 2026-07-25; NYC ruleset `nyc.v2.7`, rules schema `popengine-rules/v2`, and scenario fixtures v5 where regulatory output is consumed.
- The approval PR must re-pin any baseline version that changes before approval. A proposed or superseded input blocks implementation.

## Inputs, Outputs, State, Validation, and Errors

- Inputs are an exact event revision plus current confirmed workflow records; output is a timestamped runbook snapshot and printable projection.
- Runbook state is generated → stale when a source changes → regenerated; prior snapshots remain identifiable if retained.
- Unknown, conflicting, research-required, expired, or missing facts render as warnings and never as completed fields.
- Missing or unresolved material data stays visibly unset, unknown, pending, or failed as appropriate; it never becomes a successful or complete result.
- Invalid input produces a field or action-specific error without partial mutation. Retriable external failures preserve the user's confirmed state and expose a safe retry.

## UI and Accessibility

- Print and screen views preserve headings, reading order, status text, source timestamps, contact alternatives, and page-break safety.
- The complete workflow is keyboard operable, uses programmatic labels and visible focus, does not encode status by color alone, and announces asynchronous success or failure.
- Empty, loading, permission-denied, validation, provider-failure, and unavailable states have explicit copy and a safe next action.

## System Impact

| Concern              | Proposed impact                                                                                                                             |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| API                  | Runbook preview/generate/read operations require an approved OpenAPI contract if snapshots are persisted.                                   |
| Schema               | Use existing source records; add only a minimal immutable runbook snapshot/reference by forward migration if approval requires persistence. |
| Jobs                 | None for the minimal synchronous runbook; asynchronous document rendering requires a separately approved job.                               |
| Providers            | None.                                                                                                                                       |
| Privacy and security | Organizer-only/private by default; printed/downloaded output is explicitly warned as containing contacts and operational details.           |

Exact HTTP, JSON Schema, migration, job, and provider shapes belong in their reviewed machine contracts; this proposal does not authorize parallel local types or edits to merged migrations.

## Acceptance Criteria

1. **F405-AC-01:** A runbook identifies the exact event revision, plan/ruleset version, generation time, and source update times.
2. **F405-AC-02:** Confirmed permit numbers, load-in tasks, contacts, and available assignments appear once and link back to their source record.
3. **F405-AC-03:** Missing, unknown, conflict, research-required, expired, or stale values are visibly labeled and prevent a complete/ready claim.
4. **F405-AC-04:** Changing a source record marks the prior runbook stale; regeneration creates current output without rewriting source history.
5. **F405-AC-05:** The approved print viewport produces readable ordering and no clipped critical content.

## Fixtures and Verification

- Planned automated fixture IDs are the acceptance IDs above; each must map one-to-one to a runnable test before approval can claim implementation readiness.
- Regulatory fixtures: Use approved scenario findings to verify status/citation passthrough; all operational contacts and permit numbers are synthetic.
- Security-sensitive and cross-workspace paths require negative authorization tests; provider paths require success, duplicate-delivery, retry, invalid-signature, and permanent-failure tests where applicable.

## Allowed Footprint and Coordination

- `apps/web` and `apps/api` feature code and tests.
- New ordered forward migrations and approved OpenAPI/JSON Schema changes required by this feature.
- No repository restructuring, speculative package, or unrelated feature edit.
- Shared contracts, migrations, provider adapters, engine/rules artifacts, consent policy, and cross-lane UI primitives require the approvals named in `docs/DOCUMENTATION-GOVERNANCE.md` §6.

## Rollout and Fallback

- A live assembled/print view is the default; persist snapshots only if approval establishes a retention need.
- Rollback disables the new surface and workers/provider calls without deleting confirmed user data or rewriting immutable plans, rulesets, revisions, or history.

## Approval Blockers

- Approve included fields, ready/incomplete wording, privacy handling, and whether snapshots require persistence.
- Assign the owner and independent reviewer, approve this spec, and add it to `docs/BASELINE.md`.
