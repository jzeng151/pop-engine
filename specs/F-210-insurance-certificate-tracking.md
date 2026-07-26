# F-210 · Insurance Certificate Tracking

**Status:** PROPOSED (2026-07-26) — ready for review; not implementable until approved and listed in `docs/BASELINE.md`.

**Phase:** 3 · **Issue:** [#32](https://github.com/jzeng151/pop-engine/issues/32) · **Owner:** TBD · **Reviewer:** product owner plus affected architecture, contract, security, and lane owners (TBD) · **Approval date:** —

## Purpose and User Outcome

An organizer can track policy, coverage, additional-insured, certificate status, and expiration while keeping rule-derived requirements separate from user-recorded evidence.

## Scope

**In scope**

- Create certificate records linked to F-205/F-202 requirements and record policy reference, coverage, additional-insured text, status, expiration, and private file.
- Show gaps between the published requirement and organizer-confirmed certificate facts.
- Preserve history for replacement and expiration.

**Non-goals**

- Insurance sales, broker integration, legal sufficiency determination, OCR, or automatic agency acceptance.
- Changing F-205 regulatory findings.

## Dependencies and Baseline

- F-205, F-202, F-209 controlled documents, and the F-701/F-702/F-703 gate.
- Approved certificate status/money/date and upload contracts.
- Baseline at draft time: PRD, Roadmap, Design, and Phase 0–1.5 Architecture approved 2026-07-22; `ARCHITECTURE-FUTURE.md` approved as a planning target 2026-07-25; NYC ruleset `nyc.v2.7`, rules schema `popengine-rules/v2`, and scenario fixtures v5 where regulatory output is consumed.
- The approval PR must re-pin any baseline version that changes before approval. A proposed or superseded input blocks implementation.

## Inputs, Outputs, State, Validation, and Errors

- Inputs are immutable insurance finding plus organizer-confirmed certificate facts; outputs are source-linked certificate versions.
- State is missing → recorded → expiring/expired or replaced; scan safety and organizer status remain separate.
- Unknown coverage or additional-insured text remains unknown and cannot satisfy a requirement automatically.
- Missing or unresolved material data stays visibly unset, unknown, pending, or failed as appropriate; it never becomes a successful or complete result.
- Invalid input produces a field or action-specific error without partial mutation. Retriable external failures preserve the user's confirmed state and expose a safe retry.

## UI and Accessibility

- Requirement and evidence appear side by side; warnings state what is missing without declaring legal invalidity.
- The complete workflow is keyboard operable, uses programmatic labels and visible focus, does not encode status by color alone, and announces asynchronous success or failure.
- Empty, loading, permission-denied, validation, provider-failure, and unavailable states have explicit copy and a safe next action.

## System Impact

| Concern              | Proposed impact                                                                                                           |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| API                  | Certificate/version/upload operations require approved OpenAPI contracts.                                                 |
| Schema               | Forward migrations for insurance certificates and versions linked to findings/checklist items; private storage for files. |
| Jobs                 | Optional expiration reminders only through the approved message job system.                                               |
| Providers            | Private storage/scanning adapter; no insurer provider.                                                                    |
| Privacy and security | Private signed downloads, workspace scope, type/size/checksum/scan checks, and no document content in logs.               |

Exact HTTP, JSON Schema, migration, job, and provider shapes belong in their reviewed machine contracts; this proposal does not authorize parallel local types or edits to merged migrations.

## Acceptance Criteria

1. **F210-AC-01:** A certificate version links to the exact insurance finding and preserves its own entered source, dates, coverage, and file.
2. **F210-AC-02:** Missing or unknown coverage/additional-insured facts remain visibly unresolved and never auto-complete the requirement.
3. **F210-AC-03:** Replacement preserves the earlier version; expiration uses the approved timezone/date rule.
4. **F210-AC-04:** The UI never labels a certificate legally sufficient or agency accepted without an explicit authoritative record.
5. **F210-AC-05:** Unsafe or unauthorized files are unavailable and cannot create a recorded certificate version.

## Fixtures and Verification

- Planned automated fixture IDs are the acceptance IDs above; each must map one-to-one to a runnable test before approval can claim implementation readiness.
- Regulatory fixtures: Use approved F-205 finding scenarios; all certificate data and files are synthetic.
- Security-sensitive and cross-workspace paths require negative authorization tests; provider paths require success, duplicate-delivery, retry, invalid-signature, and permanent-failure tests where applicable.

## Allowed Footprint and Coordination

- `apps/web` and `apps/api` feature code and tests.
- New ordered forward migrations and approved OpenAPI/JSON Schema changes required by this feature.
- No repository restructuring, speculative package, or unrelated feature edit.
- Shared contracts, migrations, provider adapters, engine/rules artifacts, consent policy, and cross-lane UI primitives require the approvals named in `docs/DOCUMENTATION-GOVERNANCE.md` §6.

## Rollout and Fallback

- Manual tracking first; extraction and reminders require separately approved F-602/F-203 expansion behavior.
- Rollback disables the new surface and workers/provider calls without deleting confirmed user data or rewriting immutable plans, rulesets, revisions, or history.

## Approval Blockers

- Approve certificate status vocabulary, upload policy, expiration behavior, and gap wording.
- Assign the owner and independent reviewer, approve this spec, and add it to `docs/BASELINE.md`.
