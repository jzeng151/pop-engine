# F-207 · Multi-Jurisdiction Activation

**Status:** PROPOSED (2026-07-26) — ready for review; not implementable until approved and listed in `docs/BASELINE.md`.

**Phase:** 4 · **Issue:** [#52](https://github.com/jzeng151/pop-engine/issues/52) · **Owner:** TBD · **Reviewer:** product owner plus affected architecture, contract, security, and lane owners (TBD) · **Approval date:** —

## Purpose and User Outcome

PopEngine can activate a second approved jurisdiction by publishing data and fixtures through the existing generic engine, proving expansion does not require jurisdiction-specific executable code.

## Scope

**In scope**

- Publish one named second jurisdiction's intake registry, classifications/reference data, ruleset artifact, holiday calendar, primary sources, and executable fixtures.
- Select jurisdiction explicitly and evaluate through the same validated AST, engine, finding, and plan contracts.
- Preserve immutable per-jurisdiction artifact versions, checksums, changelog, approvals, and historical replay.

**Non-goals**

- A core-engine rewrite, jurisdiction package/calculator, named code branch, guessed regulatory fact, nationwide coverage, or mixed-jurisdiction plan.
- Adding a generic AST primitive inside this feature when the approved schema cannot express a required rule.

## Dependencies and Baseline

- Approved jurisdiction selection/input contracts, F-108/F-109 behavior as required, and the complete rules publication process.
- Verification owner plus engine owner review; exact city and source set are TBD and block approval.
- Baseline at review time: PRD, Roadmap, Design, and Phase 0–1.5 Architecture approved 2026-07-22; `ARCHITECTURE-FUTURE.md` approved as a planning target 2026-07-25; NYC ruleset `nyc.v2.9` checksum `4c1a5db24c699c51e6dcfc27a8804ba09ee69314f241a329505158e0c115c4fb`, rules schema `popengine-rules/v2`, and scenario fixtures v7 where regulatory output is consumed.
- The approval PR must re-pin any baseline version that changes before approval. A proposed or superseded input blocks implementation.

## Inputs, Outputs, State, Validation, and Errors

- Inputs are an approved jurisdiction key plus that jurisdiction's immutable artifacts; output is the normal engine plan with jurisdiction/ruleset/calendar provenance.
- Publication state is draft → verified/reviewed → tested → published; any unexpressible classification stops publication.
- Missing, conflicting, research-required, and coverage-gap states remain visible end to end and never become no requirement.
- Missing or unresolved material data stays visibly unset, unknown, pending, or failed as appropriate; it never becomes a successful or complete result.
- Invalid input produces a field or action-specific error without partial mutation. Retriable external failures preserve the user's confirmed state and expose a safe retry.

## UI and Accessibility

- Jurisdiction selection and plan banner name the active jurisdiction/artifact; unsupported locations stop with coverage guidance rather than falling back to NYC.
- The complete workflow is keyboard operable, uses programmatic labels and visible focus, does not encode status by color alone, and announces asynchronous success or failure.
- Empty, loading, permission-denied, validation, provider-failure, and unavailable states have explicit copy and a safe next action.

## System Impact

| Concern              | Proposed impact                                                                                                                                             |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| API                  | Existing generic event/evaluation contracts gain only approved jurisdiction identifiers and artifact metadata through OpenAPI/JSON Schema.                  |
| Schema               | Versioned jurisdiction registry/artifact references by forward migration/schema publication; no jurisdiction-specific table or enum duplicated in app code. |
| Jobs                 | Publication validation may use approved jobs; runtime engine evaluation remains pure and synchronous.                                                       |
| Providers            | Only approved location/holiday/source archival providers behind adapters; none is a regulatory authority by itself.                                         |
| Privacy and security | Publication restricted to rules-admin approvals; artifacts are checksummed/immutable; no cross-jurisdiction or workspace leakage.                           |

Exact HTTP, JSON Schema, migration, job, and provider shapes belong in their reviewed machine contracts; this proposal does not authorize parallel local types or edits to merged migrations.

## Acceptance Criteria

1. **F207-AC-01:** The second jurisdiction publishes all required registry, classification, rules, calendar, source, fixture, version, checksum, changelog, and approval artifacts.
2. **F207-AC-02:** The unchanged generic engine passes every approved second-jurisdiction scenario and boundary fixture with deterministic byte-stable output.
3. **F207-AC-03:** The implementation adds no jurisdiction-named calculator, package, condition evaluator, or runtime branch.
4. **F207-AC-04:** If a required classification cannot be represented by the approved AST, publication stops and a separate architecture/schema decision is opened.
5. **F207-AC-05:** The checksummed current NYC v2.9 artifact and full scenario fixtures v7 remain unchanged and green; older NYC artifacts run only as explicitly versioned historical replay cases.

## Fixtures and Verification

- Planned automated fixture IDs are the acceptance IDs above; each must map one-to-one to a runnable test before approval can claim implementation readiness.
- Regulatory fixtures: A complete new jurisdiction suite with named scenario and below/at/above boundary IDs must be independently approved; NYC scenario fixtures v7 against the checksummed v2.9 artifact remain the current regression suite, with older versions labeled historical replay only.
- Security-sensitive and cross-workspace paths require negative authorization tests; provider paths require success, duplicate-delivery, retry, invalid-signature, and permanent-failure tests where applicable.

## Allowed Footprint and Coordination

- New immutable jurisdiction rules/calendar/source/fixture artifacts and the generic registry/contract changes approved for selection.
- Engine code may change only through a separate generic primitive decision; no jurisdiction-named executable file.
- No unrelated Phase 4 scaffolding.
- Shared contracts, migrations, provider adapters, engine/rules artifacts, consent policy, and cross-lane UI primitives require the approvals named in `docs/DOCUMENTATION-GOVERNANCE.md` §6.

## Rollout and Fallback

- Keep the second jurisdiction unavailable until independent verification, full fixtures, replay, and production artifact selection checks pass.
- Rollback disables the new surface and workers/provider calls without deleting confirmed user data or rewriting immutable plans, rulesets, revisions, or history.

## Approval Blockers

- Select the second jurisdiction and approve its primary-source research/verification plan.
- Approve jurisdiction registry, calendar, artifact layout, selection contracts, and all new fixtures.
- Resolve SPEC-CONFLICT #130 first. This spec treats publishing a jurisdiction's holiday calendar as a repeatable activation step, but it is unsolved for the FIRST jurisdiction: no located source establishes that an agency's published closure stops its filing counter, and NYC's own rules span a city agency and a state agency whose staff calendars differ (`apps/api/src/calendar.ts`). A second jurisdiction cannot be activated by a procedure that has never been executed once. Whatever resolves #130 defines the procedure this spec would repeat.
- Assign the owner and independent reviewer, approve this spec, and add it to `docs/BASELINE.md`.
