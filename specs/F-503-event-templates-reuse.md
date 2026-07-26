# F-503 · Event Templates and Reuse

**Status:** PROPOSED (2026-07-26) — ready for review; not implementable until approved and listed in `docs/BASELINE.md`.

**Phase:** 3 · **Issue:** [#48](https://github.com/jzeng151/pop-engine/issues/48) · **Owner:** TBD · **Reviewer:** product owner plus affected architecture, contract, security, and lane owners (TBD) · **Approval date:** —

## Purpose and User Outcome

An organizer can start from a past event's confirmed inputs while PopEngine always evaluates the new event against the current approved ruleset.

## Scope

**In scope**

- Duplicate selected organizer-confirmed event inputs into a new draft revision and require review of date/location/material unknowns.
- Record source event/template provenance and evaluate only after normal submission.
- Optionally save a reusable input template without findings or workflow records.

**Non-goals**

- Copying findings, verdicts, deadlines, applications, documents, contacts, RSVPs, check-ins, incidents, or financial actuals.
- Guaranteeing the new event has the same requirements.

## Dependencies and Baseline

- F-107 Event Revisions, F-201 current evaluation, and the F-701/F-702/F-703 gate.
- Approved template field allow-list and current-ruleset selection contract.
- Baseline at draft time: PRD, Roadmap, Design, and Phase 0–1.5 Architecture approved 2026-07-22; `ARCHITECTURE-FUTURE.md` approved as a planning target 2026-07-25; NYC ruleset `nyc.v2.7`, rules schema `popengine-rules/v2`, and scenario fixtures v5 where regulatory output is consumed.
- The approval PR must re-pin any baseline version that changes before approval. A proposed or superseded input blocks implementation.

## Inputs, Outputs, State, Validation, and Errors

- Inputs are one authorized source revision/template; output is a new incomplete draft revision with source provenance.
- Draft must be reviewed/submitted; evaluation pins the current baseline ruleset, calendar, and new revision.
- Fields no longer present/compatible in the current intake registry are omitted and reported, never coerced.
- Missing or unresolved material data stays visibly unset, unknown, pending, or failed as appropriate; it never becomes a successful or complete result.
- Invalid input produces a field or action-specific error without partial mutation. Retriable external failures preserve the user's confirmed state and expose a safe retry.

## UI and Accessibility

- Review shows copied, omitted, changed-required, and unanswered fields before submission and warns that requirements will be recalculated.
- The complete workflow is keyboard operable, uses programmatic labels and visible focus, does not encode status by color alone, and announces asynchronous success or failure.
- Empty, loading, permission-denied, validation, provider-failure, and unavailable states have explicit copy and a safe next action.

## System Impact

| Concern              | Proposed impact                                                                                                            |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| API                  | Duplicate/template/apply operations require approved OpenAPI contracts and concurrency behavior.                           |
| Schema               | Forward migration only for reusable template input snapshots/provenance if source-event duplication alone is insufficient. |
| Jobs                 | None.                                                                                                                      |
| Providers            | None.                                                                                                                      |
| Privacy and security | Workspace scope and allow-listed input copy; no private documents/contact data leak into a new event.                      |

Exact HTTP, JSON Schema, migration, job, and provider shapes belong in their reviewed machine contracts; this proposal does not authorize parallel local types or edits to merged migrations.

## Acceptance Criteria

1. **F503-AC-01:** Creating from a past event copies only the approved organizer-input allow-list into a new draft with a new stable Event identity.
2. **F503-AC-02:** No finding, verdict, deadline, application, file, contact, RSVP, check-in, incident, or outcome record is copied.
3. **F503-AC-03:** Removed/incompatible registry fields are omitted with an explicit review warning, not mapped by guess.
4. **F503-AC-04:** Submitting evaluates the new revision with the then-current approved ruleset/calendar and stores that exact artifact version.
5. **F503-AC-05:** Changing the source event after duplication cannot mutate the new draft or its later plan.

## Fixtures and Verification

- Planned automated fixture IDs are the acceptance IDs above; each must map one-to-one to a runnable test before approval can claim implementation readiness.
- Regulatory fixtures: Duplicate each approved scenario input, change date where needed, and verify output through the current full engine suite rather than copied expectations.
- Security-sensitive and cross-workspace paths require negative authorization tests; provider paths require success, duplicate-delivery, retry, invalid-signature, and permanent-failure tests where applicable.

## Allowed Footprint and Coordination

- `apps/web` and `apps/api` feature code and tests.
- New ordered forward migrations and approved OpenAPI/JSON Schema changes required by this feature.
- No repository restructuring, speculative package, or unrelated feature edit.
- Shared contracts, migrations, provider adapters, engine/rules artifacts, consent policy, and cross-lane UI primitives require the approvals named in `docs/DOCUMENTATION-GOVERNANCE.md` §6.

## Rollout and Fallback

- Start with duplicate-from-event; add named reusable templates only if repeated use demonstrates the need.
- Rollback disables the new surface and workers/provider calls without deleting confirmed user data or rewriting immutable plans, rulesets, revisions, or history.

## Approval Blockers

- Approve copy allow-list, incompatible-field behavior, current-artifact selection, and template retention.
- Assign the owner and independent reviewer, approve this spec, and add it to `docs/BASELINE.md`.
