# F-407 · Post-Mortem Report

**Status:** PROPOSED (2026-07-26) — ready for review; not implementable until approved and listed in `docs/BASELINE.md`.

**Phase:** 3 · **Issue:** [#40](https://github.com/jzeng151/pop-engine/issues/40) · **Owner:** TBD · **Reviewer:** product owner plus affected architecture, contract, security, and lane owners (TBD) · **Approval date:** —

## Purpose and User Outcome

An organizer can freeze a source-linked post-event report covering attendance versus RSVP, leads, P&L, and permit timeline adherence for later planning.

## Scope

**In scope**

- Assemble approved metrics from attendance, RSVPs, consent-aware leads, F-406, and application/checklist history.
- Show coverage/missing-data notes and source versions for every metric.
- Confirm an immutable post-mortem snapshot consumable by F-104/F-502.

**Non-goals**

- AI narrative, agency scoring, causal claims, benchmarks, recommendations, or filling missing metrics.
- Editing source RSVP, attendance, application, or financial records.

## Dependencies and Baseline

- F-406 plus F-302/F-402/F-403 and F-208 data when present.
- Approved metric definitions and immutable snapshot contract.
- Baseline at draft time: PRD, Roadmap, Design, and Phase 0–1.5 Architecture approved 2026-07-22; `ARCHITECTURE-FUTURE.md` approved as a planning target 2026-07-25; NYC ruleset `nyc.v2.7`, rules schema `popengine-rules/v2`, and scenario fixtures v5 where regulatory output is consumed.
- The approval PR must re-pin any baseline version that changes before approval. A proposed or superseded input blocks implementation.

## Inputs, Outputs, State, Validation, and Errors

- Inputs are exact source versions, the exact draft version each rebuild and each confirmation was composed against under F407-AC-05, plus a stable client-supplied request identity on the initial draft build under F407-AC-05 and on every confirmation under F407-AC-04; the default P&L source is the snapshot captured with F-406's per-event current confirmed pointer, while an organizer may explicitly select an older confirmed version labeled historical. Output is a draft then confirmed metric snapshot.
- State is draft → stale when source changes → confirmed; the draft carries its own version that every rebuild advances by compare-and-swap, confirmed snapshots remain immutable, later corrections create a strictly increasing event-local version with predecessor provenance, and F-407's per-event current confirmed outcome-snapshot pointer advances atomically on confirmation.
- Unavailable, partial, unknown, or incomparable data is labeled and excluded from denominators according to each approved metric definition.
- Missing or unresolved material data stays visibly unset, unknown, pending, or failed as appropriate; it never becomes a successful or complete result.
- Invalid input produces a field or action-specific error without partial mutation. Retriable external failures preserve the user's confirmed state and expose a safe retry.

## UI and Accessibility

- Each metric includes label, value, denominator, source, coverage note, and text trend/variance; print/export preserves this context.
- The complete workflow is keyboard operable, uses programmatic labels and visible focus, does not encode status by color alone, and announces asynchronous success or failure.
- Empty, loading, permission-denied, validation, provider-failure, and unavailable states have explicit copy and a safe next action.

## System Impact

| Concern              | Proposed impact                                                                                   |
| -------------------- | ------------------------------------------------------------------------------------------------- |
| API                  | Post-mortem preview/confirm/read operations require approved OpenAPI contracts.                   |
| Schema               | Forward migration for immutable post-mortem metric snapshots and exact source-version references. |
| Jobs                 | None for deterministic aggregation.                                                               |
| Providers            | None.                                                                                             |
| Privacy and security | Workspace scope and aggregate-only contact metrics; no attendee contact data in the report.       |

Exact HTTP, JSON Schema, migration, job, and provider shapes belong in their reviewed machine contracts; this proposal does not authorize parallel local types or edits to merged migrations.

## Acceptance Criteria

1. **F407-AC-01:** Attendance versus RSVP, consent-aware leads, P&L, and permit-timeline adherence each appear with the approved formula, exact source versions, and coverage, or an explicit unavailable state.
2. **F407-AC-02:** Attendance-versus-RSVP never becomes occupancy unless F-410 both-direction data is the selected source.
3. **F407-AC-03:** Missing/partial data remains labeled and cannot silently change a denominator or appear as zero.
4. **F407-AC-04:** Confirmation carries a stable client-supplied request identity, committed in the same transaction as the snapshot it freezes under a uniqueness constraint scoped to the event. A request presenting an already committed identity is resolved from that record before the comparison below and returns the original frozen snapshot and pointer state, freezing no second report and recording no second predecessor. Confirmation then atomically compares the complete source-version set, the exact version of the draft it names under F407-AC-05, and the expected current confirmed outcome-snapshot version, and rejects any mismatch; the organizer must rebuild the draft before confirmation. A successful confirmation freezes the report, records its strictly increasing event-local version and predecessor, and atomically advances F-407's per-event current confirmed outcome-snapshot pointer. Later source changes require a new report version. That identity binds its operands under the rule `F411-AC-08` states once for every client-supplied identity on this branch: it is committed together with the request fields that determine the recorded result, including every aggregate, version, and generation the request names, and a later request presenting the same identity with any different operand is refused as a conflict rather than being answered with the stored result. The identity is still the key and the operands are only a precondition on reusing it, so this is not the content uniqueness this criterion already forbids.

   The identity is resolved before that comparison because the comparison cannot distinguish a retry from a stale confirmation. When the confirmation transaction succeeds and its response is lost, the retry still names the reviewed expected pointer, which the first commit has already advanced, so it is rejected; following the required rebuild and confirming again appends a second immutable outcome snapshot for one intended action, and every consumer bound by F407-AC-05 then reads two confirmed outcomes where the organizer confirmed once. The identity is client-supplied and never derived from the source-version set: a later correction is a distinct confirmation with its own new identity, composed against the pointer current when the organizer made it.

5. **F407-AC-05:** F-502 consumes only confirmed snapshots and cannot mutate them; F-407 may present eligible same-currency cost lines as organizer-confirmable proposals in F-104's existing user-line shape with exact snapshot/line provenance, without making F-407 an F-104 prerequisite. The operations that write durable state here are the draft build and rebuild, and confirmation under F407-AC-04, including a correction's confirmation, which carries its own request identity; accepting one of these proposals writes no F-407 state at all and commits through F-104's user-line create, which carries the request identity and budget-version comparison F104-AC-06 requires, so the proposal path adds no unidentified write to either feature.

   The draft is a versioned aggregate on the same terms as the confirmed snapshot, not a mutable scratch record. The initial build creates it at a first version, every rebuild names the exact draft version it was composed against and supersedes it only by compare-and-swap on that version, and a rebuild naming a superseded version replaces nothing and returns the current draft for the organizer to review before rebuilding again. That version is what F407-AC-04 compares, so confirmation freezes the exact draft the organizer reviewed or freezes nothing.

   The initial build carries its own stable client-supplied request identity, committed with the first draft version in the same transaction under a uniqueness constraint scoped to the event. A retry presenting that identity is resolved from the committed record and returns the original draft and its first version, building no second draft; a deliberate later build after the draft has been discarded sends a new identity. The two guards this spec already had do not reach the initial build. F407-AC-04's identity is committed with the confirmation and covers only confirmation, including a correction's. The compare-and-swap in the paragraph above begins at the first rebuild, because the initial build has no predecessor draft version to name, so a build whose response is lost leaves the organizer with nothing to compare against: retrying either creates a second first-version draft, and then two drafts exist for one event with nothing to say which one F407-AC-04 should freeze, or it fails the uniqueness constraint on the event's draft without returning the draft the first attempt in fact created, leaving the organizer unable to reach or confirm it. Uniqueness over the event is not that enforcement, because it refuses the retry rather than answering it. That identity binds its operands under the rule `F411-AC-08` states once for every client-supplied identity on this branch: it is committed together with the request fields that determine the recorded result, including every aggregate, version, and generation the request names, and a later request presenting the same identity with any different operand is refused as a conflict rather than being answered with the stored result. The identity is still the key and the operands are only a precondition on reusing it, so this is not the content uniqueness this criterion already forbids.

   The source-version set is not a substitute for that comparison. Two tabs can rebuild one draft to different contents with no source version changing at all, because a rebuild's result also depends on which P&L version F407-AC-06 selects, on the coverage and unavailable states each metric resolves to, and on the organizer's own selections at build time. The later rebuild supersedes the earlier draft in place, and a confirmation from the first tab then passes the source-version comparison and the pointer comparison exactly as it would have before, and freezes the second tab's draft as an immutable snapshot under the first organizer's confirmation. F407-AC-04's request identity does not reach this: it makes one confirmation happen once, and says nothing about which draft that one confirmation freezes.

6. **F407-AC-06:** The default P&L selection captures F-406's current confirmed P&L-snapshot pointer with the exact snapshot it reads, and confirmation rejects/rebuilds if that pointer changes. An explicitly selected older confirmed version remains visibly labeled historical; F-407 never chooses an arbitrary confirmed P&L snapshot or presents a superseded one as current.

## Fixtures and Verification

- Planned automated fixture IDs are the acceptance IDs above; each must map one-to-one to a runnable test before approval can claim implementation readiness.
- F407-AC-05 includes a fixture in which an initial draft build commits and its response is lost, and the retry presenting the same identity returns the original draft and first version rather than creating a second draft or being refused as a duplicate.
- Regulatory fixtures: none; this feature does not define regulatory ground truth.
- Security-sensitive and cross-workspace paths require negative authorization tests; provider paths require success, duplicate-delivery, retry, invalid-signature, and permanent-failure tests where applicable.

## Allowed Footprint and Coordination

- `apps/web` and `apps/api` feature code and tests.
- New ordered forward migrations and approved OpenAPI/JSON Schema changes required by this feature.
- No repository restructuring, speculative package, or unrelated feature edit.
- Shared contracts, migrations, provider adapters, engine/rules artifacts, consent policy, and cross-lane UI primitives require the approvals named in `docs/DOCUMENTATION-GOVERNANCE.md` §6.

## Rollout and Fallback

- Only metrics with approved definitions and live source features appear; unavailable sections stay explicit or absent, never simulated.
- Rollback disables the new surface and workers/provider calls without deleting confirmed user data or rewriting immutable plans, rulesets, revisions, or history.

## Approval Blockers

- Approve metric formulas/denominators, source precedence, coverage wording, snapshot retention, and the F-104 snapshot-to-estimate mapping/provenance contract.
- Assign the owner and independent reviewer, approve this spec, and add it to `docs/BASELINE.md`.
