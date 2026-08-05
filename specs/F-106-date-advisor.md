# F-106 · Date Advisor

**Status:** PROPOSED (2026-07-26) — ready for review; not implementable until approved and listed in `docs/BASELINE.md`.

**Phase:** 3 · **Issue:** [#31](https://github.com/jzeng151/pop-engine/issues/31) · **Owner:** TBD · **Reviewer:** product owner plus affected architecture, contract, security, and lane owners (TBD) · **Approval date:** —

## Purpose and User Outcome

Given a complete event scope and target month, an organizer can see the earliest dates the approved rules engine classifies as feasible, at risk, conditional, or infeasible.

## Scope

**In scope**

- Evaluate candidate dates in a target month using the same engine, ruleset, holiday calendar, and explicit `today` as F-102.
- Return the earliest dates by verdict with the deadline drivers and unresolved facts.
- Allow the organizer to choose a result into a new event revision and re-evaluate normally.

**Non-goals**

- Weather, venue availability, staffing, agency appointment availability, optimization across scope, or a guarantee of approval.
- A separate deadline calculator or jurisdiction-specific date code.

## Dependencies and Baseline

- F-101, F-201, F-102, and approved Event Revisions.
- The F-701/F-702/F-703 gate. F-702 supplies the workspace membership boundary the advised Event and its revisions resolves against and F-703 supplies the permission matrix `F106-AC-06` checks; F-701 supplies the authenticated actor both read from. All three are PROPOSED, so the gate is not an approved input today and this spec is not implementable against it until they are approved and listed in `docs/BASELINE.md`.
- Operand binding and replay ordering for client-supplied identities: `specs/F-411-staff-roles-credentialed-entry.md` F411-AC-08 states once, for this whole branch, that a client-supplied identity is committed with the operands that determine its recorded result, that a reuse carrying different operands is a conflict rather than a replay, and that a committed identity is resolved before any version, generation, state, authority, or limit check whose answer the committed operation itself changed. The apply save in `F106-AC-05` relies on both, applied to the save identity `specs/F-107-save-resume.md` F107-AC-07 defines. F-107 and F-411 are PROPOSED, so neither is an approved input today and this spec is not implementable against them until F-107 is approved and until F-411 is approved or the ordering rule is promoted to an approved shared invariant; F411-AC-08 records both paths.
- ADR for date library and versioned New York holiday source.
- Baseline at draft time: PRD, Roadmap, Design, and Phase 0–1.5 Architecture approved 2026-07-22; `ARCHITECTURE-FUTURE.md` approved as a planning target 2026-07-25; NYC ruleset `nyc.v2.7`, rules schema `popengine-rules/v2`, and scenario fixtures v5 where regulatory output is consumed.
- The approval PR must re-pin any baseline version that changes before approval. A proposed or superseded input blocks implementation.

## Inputs, Outputs, State, Validation, and Errors

- Inputs are one exact complete non-date scope Event Revision, a target month, explicit `today`, the ruleset, and the holiday calendar; output is a deterministic candidate-date result set pinned to that one revision plus the ruleset and calendar versions it evaluated with. That same revision is what a selected date is applied against as `base_revision_id` under F106-AC-05: there is no separate target draft version, because `docs/EVENT-REVISION-CONTRACT.md` §2.2 makes `event_revisions.answers_json` the sole questionnaire authority and no independently versioned event draft exists to name.
- Each candidate is a full evaluation. Evaluation errors are failed candidates, never no-requirement or feasible results.
- Unknown/conflict/research-required inputs propagate through each verdict and remain visible in the result explanation.
- Missing or unresolved material data stays visibly unset, unknown, pending, or failed as appropriate; it never becomes a successful or complete result.
- Invalid input produces a field or action-specific error without partial mutation. Retriable external failures preserve the user's confirmed state and expose a safe retry.

## UI and Accessibility

- Calendar/list results use text verdicts and deadline explanations, support keyboard selection, and distinguish unavailable evaluation from infeasibility.
- The complete workflow is keyboard operable, uses programmatic labels and visible focus, does not encode status by color alone, and announces asynchronous success or failure.
- Empty, loading, permission-denied, validation, provider-failure, and unavailable states have explicit copy and a safe next action.

## System Impact

| Concern              | Proposed impact                                                                                                                 |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| API                  | Advisor evaluation and optional apply-date operations require approved OpenAPI request limits and deterministic context fields. |
| Schema               | No new regulatory persistence; save only an event revision when the user applies a date.                                        |
| Jobs                 | None unless performance measurements require a bounded asynchronous evaluation job.                                             |
| Providers            | Versioned holiday calendar source only; no weather or venue provider.                                                           |
| Privacy and security | Workspace scope and evaluation rate limits; no intake values in logs.                                                           |

Exact HTTP, JSON Schema, migration, job, and provider shapes belong in their reviewed machine contracts; this proposal does not authorize parallel local types or edits to merged migrations.

## Acceptance Criteria

1. **F106-AC-01:** Every candidate date on or after explicit `today` is evaluated by the same engine path and exact ruleset/calendar/`today` inputs as a normal plan; dates before `today` are never candidates.
2. **F106-AC-02:** The earliest result in each shown verdict class is chronologically correct within the requested month; a month with no remaining candidate dates returns an explicit unavailable result.
3. **F106-AC-03:** Business-day, hard-floor, dependency-gated, unknown, and official-conflict behavior matches F-102 for the same date.
4. **F106-AC-04:** An evaluation error is labeled failed and cannot be returned as feasible or silently skipped.
5. **F106-AC-05:** Applying a suggested date is one ordinary Event Revision save that names as its `base_revision_id` the exact revision the advisor evaluated. There is no second thing to compare-and-swap alongside it: `docs/EVENT-REVISION-CONTRACT.md` §2.2 makes `event_revisions.answers_json` the sole questionnaire authority and no independently versioned event draft exists, so a criterion requiring one would put mutable answer state outside revision history and outside the plan-staleness guarantees that depend on it. A base that no longer equals `events.current_revision_id` is rejected under §2.4 with `revision_conflict`, creating no revision and no plan and requiring rebuilt advice; success appends exactly one revision carrying the applied date and generates one normal plan bound to it, while the advisor result itself is never authoritative plan output.

   Being one ordinary save, the apply carries the ordinary save's stable client-supplied request identity under `F107-AC-07`, committed with the revision and the pointer and staleness result it produces under that criterion's uniqueness constraint scoped to the Event, and it is resolved in the order `F411-AC-08` states once for every client-supplied identity on this branch: a request presenting an already committed identity is resolved from that record before the `base_revision_id` comparison above and returns the revision, pointer state, and generated plan that apply originally recorded. That identity binds its operands under the same rule, so a reuse naming a different date or a different base revision is refused as a conflict rather than answered with the stored result, and a deliberate later apply sends a new identity and is compared normally. Without that ordering the base-revision comparison is the whole of the rule and rejects the retry by construction: the first apply advanced `events.current_revision_id` past the base the advisor evaluated, so a retry after a lost response names a base that is now stale and is reported as `revision_conflict` for a date change and plan generation that already committed, sending the organizer to rebuild advice against the state their own apply produced. This adds no second identity beside `F107-AC-07`; it states that the apply is inside that criterion's scope and that the resolution order applies here.

6. **F106-AC-06:** Every operation this feature defines names the Event it acts in and the workspace that owns it, and is admitted only by the acting actor's current F-702 membership of that workspace together with the F-703 permission approved for the action, both re-read server-side from stored membership and role at the moment of the operation and, for a write, inside the same transaction that commits it. That covers the reads as well as the writes: requesting and reading a month's candidate-date evaluation under F106-AC-01 through F106-AC-04, and applying a suggested date as the Event Revision save under F106-AC-05. A request failing the check is refused before any durable write and before any verdict, candidate date, or failure state is disclosed, and its response does not distinguish an Event that does not exist from one the actor may not see. The check is at the operation and not at session start or workspace switch, so authority removed while a request is in flight causes that request to fail rather than commit.

   Without this criterion AC-01 through AC-05 all pass for a caller who names another workspace's Event. They fix the evaluation path and inputs, the chronological correctness of each verdict class, parity with F-102, the labeling of evaluation errors, and the revision the apply names, and not one of them asks who the actor is. The advisor evaluates that Event's confirmed intake against the ruleset and returns its verdicts, and AC-05's apply appends an immutable revision and advances the current-revision pointer, so the surface that criterion set leaves open both reads another organizer's regulatory position and changes their event date.

   One input this criterion needs is not established by any approved artifact today and is not invented here. F-703 is PROPOSED and names no role set, so the permission above cannot be named. Until F-703 is approved this criterion is testable only as "every candidate-date evaluation, read, and apply is refused unless the acting actor holds an active membership of the workspace that owns the named Event, read server-side at that operation, and a refusal discloses nothing about whether that Event exists", not against a named role or permission identifier. Naming the advisor read and apply permissions with F-703 is an approval blocker below.

## Fixtures and Verification

- Planned automated fixture IDs are the acceptance IDs above; each must map one-to-one to a runnable test before approval can claim implementation readiness.
- Regulatory fixtures: Approved scenarios A–F plus all date and business-day boundary fixtures, evaluated across representative month edges.
- F106-AC-05 includes a fixture in which an apply commits, its response is lost, and the retry presenting the same `F107-AC-07` save identity and the pre-apply `base_revision_id` returns the original revision, pointer state, and generated plan rather than a `revision_conflict`, appending no second revision and generating no second plan, and a mismatched-reuse fixture in which that committed identity is re-presented for the same Event with a different applied date and is refused as a conflict, appending no revision and advancing no pointer.
- F106-AC-06 includes a fixture in which an actor holding no membership of the owning workspace names a valid Event and is refused at evaluation, at read, and at apply, with a response that does not distinguish absence from denial, and a fixture in which membership is removed while an apply is in flight and that apply fails rather than appends a revision.
- Security-sensitive and cross-workspace paths require negative authorization tests; provider paths require success, duplicate-delivery, retry, invalid-signature, and permanent-failure tests where applicable.

## Allowed Footprint and Coordination

- `apps/web` and `apps/api` feature code and tests.
- New ordered forward migrations and approved OpenAPI/JSON Schema changes required by this feature.
- No repository restructuring, speculative package, or unrelated feature edit.
- Shared contracts, migrations, provider adapters, engine/rules artifacts, consent policy, and cross-lane UI primitives require the approvals named in `docs/DOCUMENTATION-GOVERNANCE.md` §6.

## Rollout and Fallback

- Bound the first release to one target month per request; widen only after measured need and performance evidence.
- Rollback disables the new surface and workers/provider calls without deleting confirmed user data or rewriting immutable plans, rulesets, revisions, or history.

## Approval Blockers

- Resolve OPEN-QUESTIONS R-10 and approve the date/holiday ADR.
- Resolve SPEC-CONFLICT #130. `F106-AC-03` requires business-day behavior matching F-102, and F-102 inherits F-201 AC 10's requirement that business days be counted against the pinned calendar. That calendar is deliberately unpublished: no located source defines "business day" for a filing lead, so publishing one would invent the semantics rather than record them (`apps/api/src/calendar.ts`). This is not an approval step. Until it resolves, every business-day deadline renders NOT_CALCULABLE, and a date advisor cannot rank candidate dates on windows the engine declines to compute.
- Approve evaluation request limits and result wording.
- Approve F-701, F-702, and F-703, and name with F-703 the advisor read and apply permissions `F106-AC-06` checks. That criterion checks a permission no approved artifact defines today and may not invent one, so until the matrix names them it is testable only at the membership level stated there.
- Assign the owner and independent reviewer, approve this spec, and add it to `docs/BASELINE.md`.
