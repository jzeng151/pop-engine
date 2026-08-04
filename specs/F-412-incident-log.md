# F-412 · Incident Log

**Status:** PROPOSED (2026-07-26) — ready for review; not implementable until approved and listed in `docs/BASELINE.md`.

**Phase:** 3 · **Issue:** [#44](https://github.com/jzeng151/pop-engine/issues/44) · **Owner:** TBD · **Reviewer:** product owner plus affected architecture, contract, security, and lane owners (TBD) · **Approval date:** —

## Purpose and User Outcome

Authorized event staff can record timestamped incidents and private attachments while preserving corrections and avoiding unsupported legal or emergency classifications.

## Scope

**In scope**

- Create timestamped incident entries with author, description, approved category/severity if defined, attachments, and follow-up notes.
- Append corrections/addenda and preserve original records.
- Filter/export only under approved role and retention rules.

**Non-goals**

- Emergency dispatch, medical records, law-enforcement reporting, legal conclusions, automated severity, or public disclosure.
- Editing or deleting original history outside the approved retention/legal process.

## Dependencies and Baseline

- F-402 event-day dashboard, F-703 roles, and approved upload controls.
- Approved incident fields, retention, export, and escalation copy.
- Baseline at draft time: PRD, Roadmap, Design, and Phase 0–1.5 Architecture approved 2026-07-22; `ARCHITECTURE-FUTURE.md` approved as a planning target 2026-07-25; NYC ruleset `nyc.v2.7`, rules schema `popengine-rules/v2`, and scenario fixtures v5 where regulatory output is consumed.
- The approval PR must re-pin any baseline version that changes before approval. A proposed or superseded input blocks implementation.

## Inputs, Outputs, State, Validation, and Errors

- Inputs are staff-confirmed event/time/description, optional safe files, and a stable request identity on each create and each addendum append; outputs are append-only incident and addendum records.
- State is recorded with later addenda/correction markers; unsafe attachments remain quarantined and separate from incident status.
- The event's incident-export source generation advances on any incident, addendum/correction, or retention removal; every queued or staged export pins that generation.
- Unknown time/category or conflicting accounts remain explicit and are not reconciled by the system.
- Missing or unresolved material data stays visibly unset, unknown, pending, or failed as appropriate; it never becomes a successful or complete result.
- Invalid input produces a field or action-specific error without partial mutation. Retriable external failures preserve the user's confirmed state and expose a safe retry.

## UI and Accessibility

- Fast event-day entry supports keyboard/mobile use, visible saved state, safe cancel, attachment progress, and clear emergency-service disclaimer/action copy.
- The complete workflow is keyboard operable, uses programmatic labels and visible focus, does not encode status by color alone, and announces asynchronous success or failure.
- Empty, loading, permission-denied, validation, provider-failure, and unavailable states have explicit copy and a safe next action.

## System Impact

| Concern              | Proposed impact                                                                                                              |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| API                  | Incident/addendum/attachment/query/export operations require approved OpenAPI contracts.                                     |
| Schema               | Forward migrations for incidents/addenda and private attachment references.                                                  |
| Jobs                 | File scanning and bounded export only through approved jobs.                                                                 |
| Providers            | Private storage/scanning adapter.                                                                                            |
| Privacy and security | Least-privilege roles, strict workspace/event scope, sensitive-data warnings, signed URLs, audit history, and redacted logs. |

Exact HTTP, JSON Schema, migration, job, and provider shapes belong in their reviewed machine contracts; this proposal does not authorize parallel local types or edits to merged migrations.

## Acceptance Criteria

1. **F412-AC-01:** An authorized staff member records staff-confirmed occurrence time separately from immutable server recorded-at time/actor and retrieves the incident only inside the correct event/workspace. Occurrence time may be explicitly unknown; both values are displayed without substituting one for the other. The create request carries a client-generated request identity, and the creating transaction commits it under a uniqueness constraint scoped to the event, so a retry after a lost response returns the original incident rather than appending a second one that would then read as a separate occurrence in history and exports. A deliberate second entry sends a new identity. Uniqueness over the payload is not that enforcement: two genuinely separate incidents may carry identical event, time, and description values, so it would refuse a real record.
2. **F412-AC-02:** Correction or follow-up appends a timestamped addendum and cannot rewrite the original account. The append request carries its own client-generated request identity, and the transaction that appends the addendum commits that identity under a uniqueness constraint scoped to the incident, so a retry after a lost response returns the original addendum instead of appending the same historical statement twice and advancing the incident-export generation a second time. AC-01's identity does not reach this case: it is scoped to incident creation and says nothing about later appends. A deliberate second addendum sends a new identity. Uniqueness over the addendum text is not that enforcement: a genuine later correction may repeat an earlier statement verbatim, so it would refuse a real append.
3. **F412-AC-03:** Unknown/conflicting details remain labeled and the system never generates a legal, medical, or emergency classification.
4. **F412-AC-04:** Unsafe/unauthorized files remain unavailable and do not erase the text incident.
5. **F412-AC-05:** Export/retention behavior matches the approved policy and records the actor/action.
6. **F412-AC-06:** Attachments remain in private storage; every download issuance rechecks event/workspace authorization and scan state and returns only a short-lived signed URL. Authorization loss blocks new URLs, and an issued direct-storage URL has only its disclosed bounded validity until expiry.
7. **F412-AC-07:** Generated exports remain private and pin the complete incident/addendum/retention generation they read. A generation change cancels queued work, invalidates staged artifacts, and blocks new access to the obsolete export. Every authenticated stream or short-lived signed URL issuance rechecks both that generation and current event/workspace-role authorization; an already issued direct-storage URL has only its disclosed bounded validity until expiry.

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

- Manual text incidents first; attachment/export controls remain disabled until upload/retention review passes.
- Rollback disables the new surface and workers/provider calls without deleting confirmed user data or rewriting immutable plans, rulesets, revisions, or history.

## Approval Blockers

- Approve minimal fields/categories, emergency copy, retention/export policy, role access, and upload handling.
- Assign the owner and independent reviewer, approve this spec, and add it to `docs/BASELINE.md`.
