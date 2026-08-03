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

- F-202, F-208 where an application exists, F-209 upload controls, and the F-701/F-702/F-703 gate.
- Approved site-plan checklist source and upload/scanning ADR.
- Baseline at draft time: PRD, Roadmap, Design, and Phase 0–1.5 Architecture approved 2026-07-22; `ARCHITECTURE-FUTURE.md` approved as a planning target 2026-07-25; NYC ruleset `nyc.v2.7`, rules schema `popengine-rules/v2`, and scenario fixtures v5 where regulatory output is consumed.
- The approval PR must re-pin any baseline version that changes before approval. A proposed or superseded input blocks implementation.

## Inputs, Outputs, State, Validation, and Errors

- Inputs are source-backed checklist elements, organizer dimensions/notes, and files; outputs are a current site-plan projection with immutable versions.
- Version state is upload pending → scanning → available or rejected; replacement creates a new version. **A replacement names the exact current version it advances from and is applied by compare-and-swap**, so two organizers replacing the same current file concurrently do not both append and race to become the current projection — the later one is rejected against the version it did not see rather than silently hiding a confirmed replacement the other organizer was told had succeeded. Retries carry a stable request identity, so a re-sent replacement is the same replacement rather than a second one. Added 2026-08-03; preserving the earlier immutable version is not sufficient on its own, because both writes succeed and only the projection pointer races.
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
3. **F211-AC-03:** Replacing a file preserves earlier version metadata and never edits a merged migration or immutable plan.
4. **F211-AC-04:** Unknown/conflicting elements remain visible and prevent the interface from claiming the site plan complete.
5. **F211-AC-05:** Unauthorized, unsafe, oversized, or mismatched files cannot be viewed or marked available.
6. **F211-AC-06:** Each download issuance rechecks workspace role, ownership, and scan state and returns only a short-lived signed URL; authorization loss blocks new URLs and issued direct-storage URLs retain only bounded validity until expiry.
7. **F211-AC-07:** Every preparation element, dimension set, and uploaded plan pins the exact finding/plan version; supersession or removal marks the preparation visibly stale and prevents a current/complete claim without rewriting its history.

## Fixtures and Verification

- Planned automated fixture IDs are the acceptance IDs above; each must map one-to-one to a runnable test before approval can claim implementation readiness.
- Regulatory fixtures: Use approved findings that require site-plan-related documents; all dimensions/files are synthetic.
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
- Assign the owner and independent reviewer, approve this spec, and add it to `docs/BASELINE.md`.
