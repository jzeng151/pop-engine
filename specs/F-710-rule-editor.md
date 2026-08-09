# F-710 · Rules Admin: Rule Editor

**Status:** PROPOSED (2026-07-26) — ready for review; not implementable until approved and listed in `docs/BASELINE.md`.

**Phase:** 4 · **Issue:** [#63](https://github.com/jzeng151/pop-engine/issues/63) · **Owner:** TBD · **Reviewer:** product owner · **Approval date:** —

## Purpose and User Outcome

An authorized rules administrator can draft and edit rules as validated data without executing code or changing the published runtime artifact.

## Scope

**In scope**

- Create/edit draft rules through the approved rules JSON Schema/AST, with source links, exact F-711 verification-decision references, validation, and review metadata.
- Preview machine-readable diff and hand off to F-712 testing/F-714 publication.
- Use optimistic concurrency and immutable draft versions.

**Non-goals**

- Publishing, runtime database rules, dynamic code/eval, bypassing primary-source review, or changing verification status; F-711 exclusively owns verification decisions.
- Editing an already published immutable artifact.

## Dependencies and Baseline

- F-711 sources, F-703 separate rules-admin role, and approved schema/type authority. F-703's role is what admits every operation `F710-AC-08` names, on the terms `F703-AC-04` states, and F-701 supplies the authenticated actor that check reads. Both are PROPOSED, so the gate is not an approved input today and this spec is not implementable against it until they are approved and listed in `docs/BASELINE.md`.
- F-712 testing and F-714 publication are downstream consumers of immutable F-710 draft versions, not prerequisites for draft/edit implementation.
- The product owner's recorded F-711 verification decision for rule semantics, which `F710-AC-04` says is the complete requirement. No separate engine-owner or verification-owner review is a dependency here: `docs/DOCUMENTATION-GOVERNANCE.md` §6 routes rule trigger, dedupe, branch, deadline, and formula semantics to the product owner, `docs/BASELINE.md`'s 2026-08-04 decision collapsed the separate engine-owner and verification capacities into that actor, and second-party review was retired on 2026-08-05.
- Baseline at draft time: PRD, Roadmap, Design, and Phase 0–1.5 Architecture approved 2026-07-22; `ARCHITECTURE-FUTURE.md` approved as a planning target 2026-07-25; NYC ruleset `nyc.v2.7`, rules schema `popengine-rules/v2`, and scenario fixtures v5 where regulatory output is consumed.
- Operand binding and replay ordering for client-supplied identities: `specs/F-411-staff-roles-credentialed-entry.md` F411-AC-08 states once, for this whole branch, that a client-supplied identity is committed with the operands that determine its recorded result and that a reuse carrying different operands is a conflict rather than a replay, and that a committed identity is resolved before any version, generation, state, or limit check whose answer the committed operation itself changed, while the acting actor's current authority is re-read at the replay and must still admit the operation before any stored outcome is returned. Every identity criterion below relies on it. F-411 is PROPOSED, so that rule is not an approved input today and this spec is not implementable against it until F-411 is approved or the rule is promoted to an approved shared invariant; F411-AC-08 records both paths.
- The approval PR must re-pin any baseline version that changes before approval. A proposed or superseded input blocks implementation.

## Inputs, Outputs, State, Validation, and Errors

- Inputs are schema-valid draft fields/AST, source references, exact immutable F-711 facet-decision versions where the published rules contract requires them, a stable request identity on draft creation under F710-AC-07, and the exact draft and review-metadata versions each later write was composed against under F710-AC-03; output is a versioned non-published draft that projects those decisions.
- Draft state is editing → ready-for-review → changes-requested/approved-for-test; publication remains separate.
- Schema error, unsupported AST, required source missing, conflict, or stale edit blocks progression and never changes runtime output. A source-less `COVERAGE_GAP` draft is allowed only when it matches the published rules contract and asserts no regulatory fact.
- Missing or unresolved material data stays visibly unset, unknown, pending, or failed as appropriate; it never becomes a successful or complete result.
- Invalid input produces a field or action-specific error without partial mutation. Retriable external failures preserve the user's confirmed state and expose a safe retry.

## UI and Accessibility

- Structured controls expose validation at the field/path level, source/status context, diff, version conflict, and keyboard-accessible review.
- The complete workflow is keyboard operable, uses programmatic labels and visible focus, does not encode status by color alone, and announces asynchronous success or failure.
- Empty, loading, permission-denied, validation, provider-failure, and unavailable states have explicit copy and a safe next action.

## System Impact

| Concern              | Proposed impact                                                                                                                               |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| API                  | Rules-draft/version/review operations require platform-admin OpenAPI contracts.                                                               |
| Schema               | Forward migrations for draft metadata/reviews while rule content remains schema-validated artifact data.                                      |
| Jobs                 | None for editing; validation/test handoff may create F-712 jobs.                                                                              |
| Providers            | None.                                                                                                                                         |
| Privacy and security | Separate platform role, strong reauthentication for sensitive actions if approved, audit history, CSRF/rate limits, and no dynamic execution. |

Exact HTTP, JSON Schema, migration, job, and provider shapes belong in their reviewed machine contracts; this proposal does not authorize parallel local types or edits to merged migrations.

## Acceptance Criteria

1. **F710-AC-01:** The editor can represent only the approved rules schema/AST and rejects unknown fields/operators/types before save/readiness.
2. **F710-AC-02:** Every draft version preserves author/time/base artifact/source references and cannot mutate a published artifact.
3. **F710-AC-03:** Every save and every review-state transition names the exact draft version and current review-metadata version it was composed against and commits only by compare-and-swap on both. A stale save or transition is rejected with a diff/reload path, appends no draft version, advances no review state, and returns the current versions for the administrator to recompose against, never a last-write-wins overwrite. That is every mutable part of the draft, not only its rule content: the AC-01 fields and AST, the AC-02 source references, the AC-04 pinned F-711 decisions, and the editing → ready-for-review → changes-requested/approved-for-test state are each composed against a named version on the same terms. Saying only that a stale save is rejected does not say what the writer must name, so two administrators editing one draft from a single observed version would both commit and the later write would erase a correction the earlier was told had saved, with nothing recording that the correction existed.

   Every save and every review-state transition also commits its own stable client-supplied request identity, distinct from the creation identity in F710-AC-07 and from every other save's or transition's, under a uniqueness constraint scoped to the draft it writes, in the same transaction as the draft version or review state it produces. A request presenting an already committed identity is resolved from that record before the version comparison above and returns the outcome that request originally recorded, appending no second draft version and advancing no review state a second time. The acting actor's current authority is not one of the checks that identity is resolved past: the authority that admits a first attempt, membership and permission where an organizer acts and the equivalent admission where the caller is a public or door client, is re-read server-side at the replay, and the stored outcome is returned only if it still admits the request, so a replay presented after that authority is gone is refused and discloses no more than a first request would; the only exception is authority the committed operation itself removed, which `F411-AC-08` states once for this branch. That identity binds its operands under the rule `F411-AC-08` states once for every client-supplied identity on this branch, so a reuse carrying different operands is a conflict rather than a replay.

   F710-AC-07 is scoped to draft creation and recognizes only a repeated create, so every later write to the draft had a version comparison and no replay contract behind it. When a save commits and its response is lost, the retry still names the draft and review-metadata versions the administrator read, which that commit advanced, so it is refused with a diff-and-reload path for work that in fact saved; recomposing and saving again then appends a second draft version for one intended edit, and the rule-review history shows two revisions where the administrator made one.
4. **F710-AC-04:** F-710 exposes no verification-status mutation. Readiness pins and projects the exact immutable F-711 decision for each rule-source facet and candidate artifact version; a missing, changed, or mismatched decision blocks progression. A semantic rule change carries no additional review beyond that pinned decision: `docs/DOCUMENTATION-GOVERNANCE.md` §6 routes "Rule trigger, dedupe, branch, deadline, or formula semantics" to the product owner, and since second-party review was retired on 2026-08-05 that one approval is the whole requirement, so readiness reads the product owner's recorded F-711 decision and nothing else. Restating an engine-owner gate here would hold a draft whose approval governance already treats as complete.
5. **F710-AC-05:** No draft affects runtime evaluation until F-714 publishes a new immutable approved artifact.
6. **F710-AC-06:** Missing source blocks readiness for every entry except a schema-valid `COVERAGE_GAP` entry that asserts no regulatory fact; that exception matches the runtime artifact validator and has a positive fixture.
7. **F710-AC-07:** Creating a draft binds the request to a stable client-supplied request identity, committed with the draft and its first version in one transaction under a uniqueness constraint scoped to the base artifact the draft is taken from together with the acting rules administrator. No part of that scope is a tenant workspace: F-710 is a platform rules-admin surface, and `F703-AC-04` keeps the rules-admin role separate from and ungrantable by a workspace owner, so a workspace-scoped identity would fail to recognise the original creation for an administrator who holds no active workspace. A retry presenting the same identity returns the original draft and its first version and creates nothing; a deliberate second draft sends a new identity. This is request identity, never content uniqueness: two genuinely distinct drafts over one base artifact may carry byte-identical rule content, so the content may not serve as the key, and a repeated identity is never rejected as a duplicate value. That identity binds its operands under the rule `F411-AC-08` states once for every client-supplied identity on this branch: it is committed together with the request fields that determine the recorded result, including every aggregate, version, and generation the request names, and a later request presenting the same identity with any different operand is refused as a conflict rather than being answered with the stored result. The identity is still the key and the operands are only a precondition on reusing it, so this is not the content uniqueness this criterion already forbids. That identity is resolved in the order `F411-AC-08` states once for every client-supplied identity on this branch, applied here rather than restated: a request presenting an already committed identity is resolved from that record before the version, generation, state, and limit checks this criterion requires, and returns the outcome that request originally recorded, because the commit the retry repeats is exactly what moved the state those checks read. The acting actor's current authority is not among the checks the identity is resolved past: the authority this feature requires for a first attempt is re-read server-side at the replay, and the stored outcome is returned only if it still admits the operation, so a replay presented after that authority is gone is refused and discloses no more than a first request would; the only exception is authority the committed operation itself removed, which `F411-AC-08` states once for this branch. A request whose identity resolves to no committed outcome is then held to every one of them, and a request refused by one of them commits no identity, so re-presenting it later is a first attempt and not a replay.

   AC-03's comparison begins at the second version, so creation is the one write it cannot reach. When the creating transaction commits and its response is lost, the retry produces a second independently reviewable draft over the same base artifact. AC-02 makes both well-formed and nothing marks either superseded, so the F-711 decisions AC-04 pins and the F-712 runs the drafts feed split across two records for one intended change, and F-714 later publishes whichever candidate its pin happens to name.
8. **F710-AC-08:** Creating a draft, every save and every review-state transition, every readiness and pin progression, and every read of a draft, a draft version, review metadata, or a diff preview are rules-admin functions and are admitted only by the separate platform rules-admin role, on the terms `F703-AC-04` states for every such function rather than on a second formulation stated here. The acting actor's current platform authority is read server-side at each read and, for the create under F710-AC-07, each save and review-state transition under F710-AC-03, and each readiness or pin progression under F710-AC-04, inside the same transaction that commits it, never from the session or a client-supplied role claim, and never derived from a workspace role, per F-703's deny-by-default state rule and the separation `F703-AC-04` keeps, so naming a workspace, holding any workspace role, or owning a workspace admits nothing here, and authority revoked while a write is in flight fails that write rather than committing it. A refusal creates no draft, appends no version, advances no review state, pins no decision, and returns no draft content, diff, or provenance, and its response does not distinguish a draft the actor may not see from one that does not exist.

   F710-AC-01 through F710-AC-07 all pass for an ordinary workspace member. They constrain what the schema admits, what a version preserves, what a stale or replayed write may do, and what readiness pins, and not one of them requires the actor to hold the role: F710-AC-07 names the acting rules administrator only inside its identity scope, which records who created a draft without gating who may, and the separate platform role was otherwise written in the Purpose line and the System Impact privacy row, neither of which creates an acceptance criterion. The draft read path hands out unpublished rule content, the pinned F-711 verification decisions, and a machine-readable diff against the published artifact, so disclosure is the harm on the read half even though no read writes anything.

   F-703 is PROPOSED and is not listed in `docs/BASELINE.md`, so until it is approved this criterion is testable only as "every draft create, save, review-state transition, readiness progression, read, and diff preview is refused unless the acting actor holds the separate platform rules-admin role, read server-side at that operation and, for a write, inside the transaction that commits it, and a refusal discloses nothing about what exists", not against a named role identifier, matrix entry, or grant path, which F-703's own approval blockers reserve.

## Fixtures and Verification

- Planned automated fixture IDs are the acceptance IDs above; each must map one-to-one to a runnable test before approval can claim implementation readiness.
- Regulatory fixtures: Schema-valid/invalid AST fixtures, approved rule examples, a valid source-less `COVERAGE_GAP` advisory, and a rejected source-less non-`COVERAGE_GAP` entry; every semantic draft requires affected and full suite coverage via F-712.
- F710-AC-03 includes a fixture in which a draft save commits, its response is lost, and the retry presenting the same request identity and the pre-save draft and review-metadata versions returns the original recorded outcome rather than a stale rejection, appending no second draft version.
- F710-AC-08 includes a negative fixture per operation in which an authenticated actor holding no platform rules-admin role, including a workspace owner, is refused a draft create, a save, a review-state transition, a readiness progression, a draft read, and a diff preview, with nothing created or advanced and a response indistinguishable from the one for a draft that does not exist; and a fixture in which the role is revoked between reading a draft and the save composed from it, so the save is refused at commit rather than committing.
- Security-sensitive and cross-workspace paths require negative authorization tests; provider paths require success, duplicate-delivery, retry, invalid-signature, and permanent-failure tests where applicable.

## Allowed Footprint and Coordination

- `apps/web` and `apps/api` feature code and tests.
- New ordered forward migrations and approved OpenAPI/JSON Schema changes required by this feature.
- No repository restructuring, speculative package, or unrelated feature edit.
- Shared contracts, migrations, provider adapters, engine/rules artifacts, consent policy, and cross-lane UI primitives require the approvals named in `docs/DOCUMENTATION-GOVERNANCE.md` §6.

## Rollout and Fallback

- Keep git PR authoring as fallback until the full F-710–F-714 flow proves equivalent and is explicitly activated.
- Rollback disables the new surface and workers/provider calls without deleting confirmed user data or rewriting immutable plans, rulesets, revisions, or history.

## Approval Blockers

- Approve draft/review state machine, schema editor mapping, concurrency, role/reauth policy, and git-transition plan.
- Approve F-701 and F-703, whose role/action matrix and platform-role administration path are what make `F710-AC-08`, and the acting rules administrator already named in F710-AC-07's identity scope, testable against a named role rather than against the shape of a check.
- Assign the owner, approve this spec, and add it to `docs/BASELINE.md`. The reviewer and approver is the product owner (`docs/DOCUMENTATION-GOVERNANCE.md` §6), which is what this spec's header records, and that is the whole requirement: the independent-reviewer element this blocker used to carry was retired on 2026-08-05 (product owner; see §6 and `docs/BASELINE.md`). Until those three things are done this blocker is not satisfied and this spec is not approved: it stays PROPOSED under governance §3, its Approval date stays `—`, and it is not implementable and not listed in `docs/BASELINE.md`. Retiring the reviewer element made this spec approvable; it did not approve it.
