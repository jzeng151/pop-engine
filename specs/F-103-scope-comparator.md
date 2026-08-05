# F-103 · Scope Comparator

**Status:** PROPOSED (2026-07-26) — ready for review; not implementable until approved and listed in `docs/BASELINE.md`.

**Phase:** 3 · **Issue:** [#28](https://github.com/jzeng151/pop-engine/issues/28) · **Owner:** TBD · **Reviewer:** product owner plus affected architecture, contract, security, and lane owners (TBD) · **Approval date:** —

## Purpose and User Outcome

An organizer can compare two event configurations using two complete engine evaluations, seeing permit burden and earliest feasible date without relying on a shortcut or copied finding.

## Scope

**In scope**

- Create or select two complete intake revisions and evaluate both with the same explicit ruleset, holiday calendar, and `today`.
- Compare findings, verdict drivers, unresolved facts, and earliest feasible date side by side.
- Show added, removed, and changed requirements using stable finding identity.

**Non-goals**

- Choosing a winner, optimizing an event automatically, comparing more than two configurations, or estimating venue availability/cost.
- Approximating an evaluation from changed fields instead of running the engine twice.

## Dependencies and Baseline

- F-101, F-201, F-102, F-106 Date Advisor, and approved Event Revisions.
- The F-701/F-702/F-703 gate. F-702 supplies the workspace membership boundary the compared Event and its revisions resolves against and F-703 supplies the permission matrix `F103-AC-08` checks; F-701 supplies the authenticated actor both read from. All three are PROPOSED, so the gate is not an approved input today and this spec is not implementable against it until they are approved and listed in `docs/BASELINE.md`.
- Stable plan/finding identity and plan-diff contracts from `ARCHITECTURE-FUTURE.md`.
- Baseline at draft time: PRD, Roadmap, Design, and Phase 0–1.5 Architecture approved 2026-07-22; `ARCHITECTURE-FUTURE.md` approved as a planning target 2026-07-25; NYC ruleset `nyc.v2.7`, rules schema `popengine-rules/v2`, and scenario fixtures v5 where regulatory output is consumed.
- Operand binding and replay ordering for client-supplied identities: `specs/F-411-staff-roles-credentialed-entry.md` F411-AC-08 states once, for this whole branch, that a client-supplied identity is committed with the operands that determine its recorded result and that a reuse carrying different operands is a conflict rather than a replay, and that a committed identity is resolved before any version, generation, state, authority, or limit check whose answer the committed operation itself changed. The selection identity in `F103-AC-07` relies on it. F-411 is PROPOSED, so that rule is not an approved input today and this spec is not implementable against it until F-411 is approved or the rule is promoted to an approved shared invariant; F411-AC-08 records both paths.
- The approval PR must re-pin any baseline version that changes before approval. A proposed or superseded input blocks implementation.

## Inputs, Outputs, State, Validation, and Errors

- Inputs are two complete revision snapshots, one organizer-selected shared target month, and identical evaluation context; outputs are two immutable evaluation results and a derived comparison, none of which is an F-201 generation.
- Comparison state is unevaluated → evaluating → comparable, conditional, or failed; one failed evaluation never becomes a favorable comparison.
- Unknown/conflict/research-required findings remain visible on their respective side and in the difference summary.
- Permit burden uses the shared `permit-burden/v1` breakdown below; it is never a scalar score or winner ranking.
- Missing or unresolved material data stays visibly unset, unknown, pending, or failed as appropriate; it never becomes a successful or complete result.
- Invalid input produces a field or action-specific error without partial mutation. Retriable external failures preserve the user's confirmed state and expose a safe retry.

### Shared permit-burden/v1 definition

- **The membership sets live in `docs/proposals/permit-burden-v1.ts`, not in this prose.** This spec decides what belongs in each set and why; that file states the membership it decided, and both this spec and F-502 read it. Moved out of this paragraph 2026-08-03 because the guard that checked the sets partitioned the engine's enumerations had to parse it, and was repaired four times as prose found new shapes around each parsing rule. It is a proposal artifact and not package code: while this spec is PROPOSED its membership is not part of any shipped API, so nothing can depend on a partition the approval process may still change. A finding is considered when its kind is in `BURDEN_COUNTED_KINDS` and its disposition is in `BURDEN_COUNTED_DISPOSITIONS`; `BURDEN_EXCLUDED_KINDS` and `BURDEN_EXCLUDED_DISPOSITIONS` name the rest, which raise no requirement to carry and so enter nothing.
- Count each final deduplicated finding once by the canonical JSON serialization of its sorted `rule_ids`; contributing rule IDs, sources, and facets never add extra units.
- The value is the versioned breakdown `{ definite, unresolved }`. A considered `required` or `prohibited_or_ineligible` finding whose verification is in `BURDEN_DEFINITE_STATUSES` contributes one `definite`. A considered `may_be_required` finding, or any considered finding whose verification is in `BURDEN_UNRESOLVED_STATUSES`, contributes one `unresolved`; unresolved wins when both rules apply.
- A final finding carries one scalar `verificationStatus` and one scalar `disposition`, and this metric reads both. `mergeFindings()` in `packages/engine/src/findings.ts` builds a deduplicated finding as `{ ...first }`, keeping the first contributing rule's value of each, while `FindingSource` carries only rule id, citation, and URLs. Verification status is nonetheless safe to read: `rejectMixedDedupeVerificationStatuses()` in `packages/engine/src/ruleset.ts` refuses at load any ruleset whose dedupe key mixes verification statuses, so every rule in a dedupe group shares one status and the merged scalar is that status, not an ordering artifact. Disposition has no such guard, and `nyc.v2.11` already mixes it: `DOB-TENT-001` (`required`) and `DOB-TALL-STRUCTURE-001` (`MAY_BE_REQUIRED`) share `dedupe_key: dob-structure`, so a merged finding's requirement strength, and therefore which side of this breakdown it lands on, follows the order the two rules are listed in. `resolveDisposition()` widens that: a rule whose trigger resolves `unknown` is downgraded to `may_be_required` at evaluation time, so even a group publishing one disposition can mix at runtime. Issue [#239](https://github.com/jzeng151/pop-engine/issues/239) records it; this spec does not authorize the fix, because it is shipped engine behavior and needs the verification owner plus the engine owner under `docs/DOCUMENTATION-GOVERNANCE.md` §6.
- Until #239 closes, this breakdown cannot be made both truthful and implementable, so it is an approval blocker rather than a criterion an implementer may satisfy. Closing it needs one of two things, and the choice is the engine owner's: a load-time guard on mixed dispositions within a dedupe key, mirroring the verification-status one, which would reject `nyc.v2.11` as published and so needs a rules decision about `dob-structure` first; or per-contributing-rule `disposition` and `verificationStatus` on `FindingSource`, which is what lets this metric apply unresolved-wins across a group instead of reading one scalar chosen by position.
- A material unknown that can change the finding set makes the breakdown unavailable rather than assigning a favorable count; the underlying typed findings and missing facts remain visible. A required finding with a `not_calculable` deadline remains definite, while evaluation failure also makes the breakdown unavailable. The UI shows both counts and the underlying typed findings/statuses when available; it never sums them, ranks configurations, or treats unresolved work as absent.

## UI and Accessibility

- Side-by-side content has a linear mobile reading order, explicit configuration labels, and text indicators for added/removed/changed findings.
- The complete workflow is keyboard operable, uses programmatic labels and visible focus, does not encode status by color alone, and announces asynchronous success or failure.
- Empty, loading, permission-denied, validation, provider-failure, and unavailable states have explicit copy and a safe next action.

## System Impact

| Concern              | Proposed impact                                                                                                |
| -------------------- | -------------------------------------------------------------------------------------------------------------- |
| API                  | Use approved evaluation/plan APIs; add a comparison resource only if persistence is approved in OpenAPI.       |
| Schema               | No new regulatory schema. Persist only saved comparison references if the approved product need requires them. |
| Jobs                 | None unless measured evaluation cost requires an approved asynchronous path.                                   |
| Providers            | None.                                                                                                          |
| Privacy and security | Both revisions and plans must belong to the active workspace; traces expose no unauthorized source data.       |

Exact HTTP, JSON Schema, migration, job, and provider shapes belong in their reviewed machine contracts; this proposal does not authorize parallel local types or edits to merged migrations.

## Acceptance Criteria

1. **F103-AC-01:** Both configurations evaluate with byte-identical engine version/checksum, ruleset, calendar, and `today` inputs, producing two immutable evaluation results; otherwise they are incomparable. "Immutable" is about the results themselves, not about where they are kept: AC-06 keeps them out of plan history.
2. **F103-AC-02:** The comparison identifies each added, removed, and materially changed finding without hiding deduplicated source facets.
3. **F103-AC-03:** Permit burden derives only from typed plan output using the exact shared `permit-burden/v1` kind/disposition filters, final-finding identity, deduplication rule, and definite/unresolved treatment above. Earliest feasible dates come only from F-106 candidate-date evaluations for the same explicit shared target month and engine context; neither value comes from prose parsing or a second rules implementation.
4. **F103-AC-04:** Unknown, conflict, research-required, or evaluation failure remains visible and cannot make a configuration appear better by omission.
5. **F103-AC-05:** Swapping left and right preserves each plan and reverses only directional comparison labels.
6. **F103-AC-06:** A comparison's two evaluations are never F-201 generations. Whatever a comparison holds them in, it is not `permit_plans`, and no comparison changes what `PlanService.latest()` returns, what the F-201 regeneration guard compares against, or what any other latest-plan read sees. A comparison persists both plans or neither: both configurations finish evaluating before anything is written, the two immutable results commit together, and a failure in either evaluation or in the commit leaves nothing behind. A configuration enters normal plan history only through AC-07.

7. **F103-AC-07:** A configuration becomes an F-201 generation only when the organizer explicitly selects it, and then exactly one generation is created, from that configuration alone. Running a comparison, swapping sides, and abandoning a comparison all leave plan history unchanged.

   The selection is the one durable write this feature triggers, so it carries a stable client-supplied request identity, committed with the generation it creates under a uniqueness constraint scoped to the Event whose plan history the generation joins. A request presenting an already committed identity returns the generation that request originally created and creates no second one; a deliberate later selection, including a selection of the other configuration, sends a new identity and generates normally. Without it "exactly one generation is created" holds only for a selection whose response arrives: when the selection commits and its response is lost, the organizer retries and plan history gains a second generation from one intended selection, which the F-201 regeneration guard this criterion is careful not to disturb then reads as the newest. The identity binds its operands under the rule `F411-AC-08` states once for every client-supplied identity on this branch, so a reuse naming the other configuration, or a different engine context, is refused as a conflict rather than being answered with the stored generation. This is request identity, never content uniqueness: an organizer may legitimately generate twice from one configuration, and a repeated identity is never rejected as a duplicate value.

   AC-01 already requires both configurations to share one engine context, and AC-04 requires a failure to stay visible. Neither reaches the residue. The earlier form of AC-06 allowed a successful comparison's evaluations to "become normal F-201 generations", which is the same defect it was written to prevent, only on the success path: `PlanService.latest()` orders by `generated_at` and returns the newest row for the event, so whichever side committed second becomes the organizer's latest plan for a configuration they selected neither of. Everything downstream of that read moves with it, including F-206's snapshot banner and any plan the organizer is shown by default.

   It also reaches the F-201 regeneration downgrade guard. `refuseRulesetDowngrade()` reads the same newest row and refuses a generation whose service ruleset is older than, or unorderable against, the version that row pinned. AC-01 makes both comparison evaluations share one ruleset, so a comparison cannot make a later generation on that same ruleset refuse. It can still raise the floor: comparison plans written by a service on a newer ruleset pin that newer version, and a later real generation routed to a service still on the older one is then refused, naming a version the organizer's own plan history never contained. Keeping comparison evaluations out of `permit_plans` is what stops both effects, which is why AC-06 constrains where they live rather than only how they commit.

   Only the ephemeral form is implementable against what is approved today. Persisted comparison artifacts would need an approved OpenAPI resource and an ordered migration for a table that latest-plan reads do not touch, and the System Impact table above gates both on an approved retained-history need. Until that exists, a comparison holds its two evaluations for the life of the request and stores nothing.

8. **F103-AC-08:** Every operation this feature defines names the Event it acts in and the workspace that owns it, and is admitted only by the acting actor's current F-702 membership of that workspace together with the F-703 permission approved for the action, both re-read server-side from stored membership and role at the moment of the operation and, for a write, inside the same transaction that commits it. That covers the reads as well as the writes: composing and reading a comparison and its two evaluation results under F103-AC-01 through F103-AC-06, and the explicit selection that creates an F-201 generation under F103-AC-07. A request failing the check is refused before any durable write and before any finding, disposition, permit-burden value, or configuration is disclosed, and its response does not distinguish an Event or comparison that does not exist from one the actor may not see. The check is at the operation and not at session start or workspace switch, so authority removed while a request is in flight causes that request to fail rather than commit.

   Without this criterion AC-01 through AC-07 all pass for a caller who names another workspace's Event. They fix determinism, the added, removed, and changed finding sets, the permit-burden derivation, the visibility of unknown and failed states, the symmetry of a swap, and the single-generation rule, and not one of them asks who the actor is. A comparison discloses the full typed finding set of both configurations, and AC-07 additionally commits an immutable F-201 generation against the selected one, so the surface that criterion set leaves open both reads another organizer's regulatory plan and writes to their Event.

   One input this criterion needs is not established by any approved artifact today and is not invented here. F-703 is PROPOSED and names no role set, so the permission above cannot be named. Until F-703 is approved this criterion is testable only as "every comparison composition, read, and generation selection is refused unless the acting actor holds an active membership of the workspace that owns the named Event, read server-side at that operation, and a refusal discloses nothing about whether that Event exists", not against a named role or permission identifier. Naming the comparison read and generation-selection permissions with F-703 is an approval blocker below.

## Fixtures and Verification

- Planned automated fixture IDs are the acceptance IDs above; each must map one-to-one to a runnable test before approval can claim implementation readiness.
- Regulatory fixtures: Pair approved scenarios A–F and the approved boundary fixtures; expected plan output remains owned by F-201/F-102.
- `F103-BURDEN-01`: two contributing rule IDs merged into one final finding contribute one unit, not two.
- `F103-BURDEN-02`: Scenario B's required `not_calculable` DOHMH finding contributes one definite unit; its advisory and named-confirmation findings contribute none.
- `F103-BURDEN-03`: the Parks exactly-20 `OFFICIAL_CONFLICT` finding contributes one unresolved unit, while a material unknown that can change the finding set makes the breakdown unavailable rather than favorable.
- `F103-BURDEN-04`: swapping the same two plans preserves each breakdown and reverses only directional finding labels.
- F103-AC-07 includes a fixture in which a configuration selection commits, its response is lost, and the retry presenting the same selection identity returns the generation the original request created rather than adding a second generation to plan history, and a mismatched-reuse fixture in which that committed identity is re-presented naming the other configuration and is refused as a conflict, generating nothing.
- F103-AC-08 includes a fixture in which an actor holding no membership of the owning workspace names a valid Event and comparison identifier and is refused at composition, at read, and at generation selection, with a response that does not distinguish absence from denial.
- Security-sensitive and cross-workspace paths require negative authorization tests; provider paths require success, duplicate-delivery, retry, invalid-signature, and permanent-failure tests where applicable.

## Allowed Footprint and Coordination

- `apps/web` and `apps/api` feature code and tests.
- New ordered forward migrations and approved OpenAPI/JSON Schema changes required by this feature.
- No repository restructuring, speculative package, or unrelated feature edit.
- Shared contracts, migrations, provider adapters, engine/rules artifacts, consent policy, and cross-lane UI primitives require the approvals named in `docs/DOCUMENTATION-GOVERNANCE.md` §6.

## Rollout and Fallback

- Start with ephemeral comparisons; save comparison records only after a retained-history use case is approved.
- Rollback disables the new surface and workers/provider calls without deleting confirmed user data or rewriting immutable plans, rulesets, revisions, or history.

## Approval Blockers

- Approve Event Revision, finding-identity, plan-diff, and F-106 earliest-feasible-date contracts.
- Close issue [#239](https://github.com/jzeng151/pop-engine/issues/239). Until a merged finding's `disposition` is either guarded against mixing within a dedupe group or carried per contributing rule, `permit-burden/v1`'s definite/unresolved split reads a scalar chosen by ruleset order and AC-03 cannot be satisfied truthfully.
- Approve F-701, F-702, and F-703, and name with F-703 the comparison read and generation-selection permissions `F103-AC-08` checks. That criterion checks a permission no approved artifact defines today and may not invent one, so until the matrix names them it is testable only at the membership level stated there.
- Assign the owner and independent reviewer, approve this spec, and add it to `docs/BASELINE.md`.
