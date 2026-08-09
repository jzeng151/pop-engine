# F-605 · Agency Correspondence Drafting

**Status:** PROPOSED (2026-07-26) — ready for review; not implementable until approved and listed in `docs/BASELINE.md`.

**Phase:** 4 · **Issue:** [#61](https://github.com/jzeng151/pop-engine/issues/61) · **Owner:** TBD · **Reviewer:** product owner · **Approval date:** —

## Purpose and User Outcome

An organizer can create an editable draft to an agency from confirmed event/application facts while PopEngine never sends it or invents a regulatory claim.

## Scope

**In scope**

- Generate a draft subject/body for an organizer-selected purpose using approved AI gateway and selected confirmed facts.
- Preview sources, edit, regenerate, and copy/download the draft.
- Label AI provenance and prohibit sending/provider account connection.

**Non-goals**

- Auto-send, mailbox integration, legal advice, representation as an attorney/agency, fabricated permit/deadline/fee, or attachments.
- Using agency correspondence as a regulatory source before normal review.

## Dependencies and Baseline

- F-208/F-209 confirmed records and F-304 AI gateway.
- The F-701/F-702/F-703 gate. F-702 supplies the workspace membership boundary the F-208/F-209 subject records resolve against and F-703 supplies the permission matrix `F605-AC-07` checks; F-701 supplies the authenticated actor both read from. F-701 is APPROVED (2026-07-28, `docs/BASELINE.md`); F-702 and F-703 remain PROPOSED, so the gate is not an approved input today and this spec is not implementable against it until those two are approved and listed in `docs/BASELINE.md`.
- Approved drafting purposes/templates, data selection, prompt/model, privacy, and prohibited-claim evaluation.
- Baseline at draft time: PRD, Roadmap, Design, and Phase 0–1.5 Architecture approved 2026-07-22; `ARCHITECTURE-FUTURE.md` approved as a planning target 2026-07-25; NYC ruleset `nyc.v2.7`, rules schema `popengine-rules/v2`, and scenario fixtures v5 where regulatory output is consumed.
- Operand binding and replay ordering for client-supplied identities: `specs/F-411-staff-roles-credentialed-entry.md` F411-AC-08 states once, for this whole branch, that a client-supplied identity is committed with the operands that determine its recorded result and that a reuse carrying different operands is a conflict rather than a replay, and that a committed identity is resolved before any version, generation, state, or limit check whose answer the committed operation itself changed, while the acting actor's current authority is re-read at the replay and must still admit the operation before any stored outcome is returned. Every identity criterion below relies on it. F-411 is PROPOSED, so that rule is not an approved input today and this spec is not implementable against it until F-411 is approved or the rule is promoted to an approved shared invariant; F411-AC-08 records both paths.
- The approval PR must re-pin any baseline version that changes before approval. A proposed or superseded input blocks implementation.

## Inputs, Outputs, State, Validation, and Errors

- Inputs are organizer-selected confirmed facts and purpose; output is a non-authoritative editable draft tied to exact source versions.
- State is requested → generated, failed, or policy-rejected; edit/copy creates no application/email mutation.
- Unknown/conflicting/unverified values are omitted or explicitly described using approved source wording, never completed by the model.
- Missing or unresolved material data stays visibly unset, unknown, pending, or failed as appropriate; it never becomes a successful or complete result.
- Invalid input produces a field or action-specific error without partial mutation. Retriable external failures preserve the user's confirmed state and expose a safe retry.

## UI and Accessibility

- Source-fact preview, AI label, editable text, copy/download, manual blank fallback, and explicit 'not sent' state remain visible.
- The complete workflow is keyboard operable, uses programmatic labels and visible focus, does not encode status by color alone, and announces asynchronous success or failure.
- Empty, loading, permission-denied, validation, provider-failure, and unavailable states have explicit copy and a safe next action.

## System Impact

| Concern              | Proposed impact                                                                                                                                         |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| API                  | Draft run/status/result operations require approved OpenAPI contracts and bounded content.                                                              |
| Schema               | Reuse minimal AI run/provenance; persist drafts only if retention need is approved.                                                                     |
| Jobs                 | Durable AI job with timeout, cancellation, retry/cost bounds, and idempotency.                                                                          |
| Providers            | Approved AI gateway only; no email sending provider.                                                                                                    |
| Privacy and security | Data minimization, private document exclusion by default, prompt-injection protection, provider retention controls, workspace scope, and redacted logs. |

Exact HTTP, JSON Schema, migration, job, and provider shapes belong in their reviewed machine contracts; this proposal does not authorize parallel local types or edits to merged migrations.

## Acceptance Criteria

1. **F605-AC-01:** The organizer sees and confirms every source fact before generation, and the result records exact source/prompt/model versions; copy/download rechecks current source versions and marks the draft stale when any selected fact changed, blocking use until regeneration from the current confirmed facts. Reconfirming an old source version cannot unblock the stale draft.
2. **F605-AC-02:** The draft cannot send, schedule, connect a mailbox, or mutate application/ledger state.
3. **F605-AC-03:** Every concrete assertion in generated text must match an exact selected confirmed fact; any mismatch is rejected before copy/download with an action to correct the authoritative source and regenerate. No generated deadline, fee, agency, permit, status, completeness, or legal claim may exceed approved selected source facts.
4. **F605-AC-04:** Unknown/conflicting facts remain omitted or explicitly unresolved and never become confident prose.
5. **F605-AC-05:** Provider failure preserves manual drafting and confirmed source records.
6. **F605-AC-06:** Starting a generation binds the request to a stable client-supplied request identity, committed with the run under a uniqueness constraint scoped to the correspondence's subject record. A retry presenting the same identity returns the original run and its draft and starts no second provider job; a deliberate regeneration from the same or edited confirmed facts sends a new identity. This is request identity, never content uniqueness: two genuinely distinct runs over one selected fact set and prompt/model version are both recorded, and a repeated identity is never rejected as a duplicate value. That identity binds its operands under the rule `F411-AC-08` states once for every client-supplied identity on this branch: it is committed together with the request fields that determine the recorded result, including every aggregate, version, and generation the request names, and a later request presenting the same identity with any different operand is refused as a conflict rather than being answered with the stored result. The identity is still the key and the operands are only a precondition on reusing it, so this is not the content uniqueness this criterion already forbids. That identity is resolved in the order `F411-AC-08` states once for every client-supplied identity on this branch, applied here rather than restated: a request presenting an already committed identity is resolved from that record before the version, generation, state, and limit checks this criterion requires, and returns the outcome that request originally recorded, because the commit the retry repeats is exactly what moved the state those checks read. The acting actor's current authority is not among the checks the identity is resolved past: the authority this feature requires for a first attempt is re-read server-side at the replay, and the stored outcome is returned only if it still admits the operation, so a replay presented after that authority is gone is refused and discloses no more than a first request would; the only exception is authority the committed operation itself removed, which `F411-AC-08` states once for this branch. A request whose identity resolves to no committed outcome is then held to every one of them, and a request refused by one of them commits no identity, so re-presenting it later is a first attempt and not a replay.

   AC-01 pins the source, prompt, and model versions the run reads, which is what makes a draft's basis auditable and says nothing about the request that started it. When the run commits and its response is lost, the organizer retries, a second provider job runs, and a second draft exists over the same confirmed facts; AC-01's staleness recheck marks neither stale, so both remain copyable and the record of what the organizer sent an agency has two equally valid answers.

7. **F605-AC-07:** Every operation this feature defines names the F-208 or F-209 subject record it acts on and the workspace that owns it, and is admitted only by the acting actor's current F-702 membership of that workspace together with the F-703 permission approved for the action, both re-read server-side from stored membership and role at the moment of the operation and, for a write, inside the same transaction that commits it. That covers the reads as well as the writes: fact selection and confirmation under F605-AC-01, generation under F605-AC-06, and every later read, copy, and download of a run or its draft under F605-AC-01 and F605-AC-03. A request failing the check is refused before any provider call, any durable write, and any disclosure of an application identifier, agency state, deadline, fee, or document fact, and its response does not distinguish a subject record that does not exist from one the actor may not see. The check is at the operation and not at session start or workspace switch, so authority removed while a request is in flight causes that request to fail rather than commit, and a copy or download issued after authority is lost is refused.

   Without this criterion AC-01 through AC-06 all pass for a caller who names another workspace's confirmed F-208 or F-209 record. They require the organizer to confirm every selected fact, pin the source, prompt, and model versions, forbid sending or mutating, bound every assertion to a selected fact, and give the run a request identity, and not one of them asks who the actor is. The feature's output is prose assembled from exactly those application, fee, deadline, and status facts, so the surface that criterion set leaves open turns a guessed or leaked record identifier into a readable summary of another organizer's agency correspondence, and the copy and download paths carry it out of the product. The System Impact row's workspace-scope wording is not an acceptance criterion, and an implementation is built to the acceptance criteria.

   **The same boundary binds the content a draft is assembled from, not only the subject record it names.** Every source fact and fact version selected under F605-AC-01, and every document, application, deadline, fee, and status value the generated prose is bound to under F605-AC-03, must itself resolve to the named F-208 or F-209 subject record and to the workspace that owns it. The set is checked when a fact is selected, and re-checked at preview, at generation, before the provider receives anything, and at every later copy and download, on the same terms the staleness recheck in F605-AC-01 already runs on. A selection naming a fact outside that set is refused: it selects nothing, generates nothing, sends nothing to the provider, and its refusal does not distinguish a fact that does not exist from one belonging to a record the actor may not draw on.

   Admitting the subject record is not admitting the facts. An actor who belongs to two workspaces passes the check above by naming a workspace-B application, then selects workspace-A fee, deadline, and status facts, and AC-01 and AC-03 both still pass because each asks whether a fact is confirmed and version-pinned rather than whose it is. The output is prose assembled from exactly those facts and the copy and download paths carry it out of the product, so the identifier boundary this criterion closes stays open on the content that crosses it. The requirement is stated as a property of the selected fact set rather than of each fact in isolation, because a draft mixing one foreign fact into an otherwise same-subject set is the case a per-fact confirmation check cannot see.

   One input this criterion needs is not established by any approved artifact today and is not invented here. F-703 is PROPOSED and names no role set, so the permission above cannot be named. Until F-703 is approved this criterion is testable only as "every fact selection, generation, run read, copy, and download is refused unless the acting actor holds an active membership of the workspace that owns the named subject record, read server-side at that operation, and a refusal discloses nothing about whether that record exists", not against a named role or permission identifier. Naming the drafting and download permissions with F-703 is an approval blocker below.

## Fixtures and Verification

- Planned automated fixture IDs are the acceptance IDs above; each must map one-to-one to a runnable test before approval can claim implementation readiness.
- F605-AC-07 includes a fixture in which an actor holding no membership of the owning workspace names a valid F-208/F-209 record and is refused at fact selection, at generation, and at run read, copy, and download, with a response that does not distinguish absence from denial, and a fixture in which membership is removed after a draft is generated and the later copy and download are refused. It also includes a cross-subject fixture in which an actor holding membership of both workspaces names an authorized workspace-B subject record and selects a confirmed, version-pinned workspace-A fee, deadline, or status fact: the selection is refused, no preview or generation runs, no provider call is issued, and the refusal discloses nothing about the workspace-A record.
- Regulatory fixtures: A prohibited-claim corpus built from approved findings; generated prose is not a regulatory fixture.
- Security-sensitive and cross-workspace paths require negative authorization tests; provider paths require success, duplicate-delivery, retry, invalid-signature, and permanent-failure tests where applicable.

## Allowed Footprint and Coordination

- `apps/web` and `apps/api` feature code and tests.
- New ordered forward migrations and approved OpenAPI/JSON Schema changes required by this feature.
- No repository restructuring, speculative package, or unrelated feature edit.
- Shared contracts, migrations, provider adapters, engine/rules artifacts, consent policy, and cross-lane UI primitives require the approvals named in `docs/DOCUMENTATION-GOVERNANCE.md` §6.

## Rollout and Fallback

- Feature-flag AI; blank/manual drafting and copy remain the fallback.
- Rollback disables the new surface and workers/provider calls without deleting confirmed user data or rewriting immutable plans, rulesets, revisions, or history.

## Approval Blockers

- Approve drafting purposes/templates, AI/privacy ADRs, source allow-list, retention, and prohibited-claim evaluation.
- Approve F-702 and F-703, and name with F-703 the drafting, run-read, copy, and download permissions `F605-AC-07` checks. That criterion checks a permission no approved artifact defines today and may not invent one, so until the matrix names them it is testable only at the membership level stated there.
- Assign the owner, approve this spec, and add it to `docs/BASELINE.md`. The reviewer and approver is the product owner (`docs/DOCUMENTATION-GOVERNANCE.md` §6), which is what this spec's header records, and that is the whole requirement: the independent-reviewer element this blocker used to carry was retired on 2026-08-05 (product owner; see §6 and `docs/BASELINE.md`). Until those three things are done this blocker is not satisfied and this spec is not approved: it stays PROPOSED under governance §3, its Approval date stays `—`, and it is not implementable and not listed in `docs/BASELINE.md`. Retiring the reviewer element made this spec approvable; it did not approve it.
