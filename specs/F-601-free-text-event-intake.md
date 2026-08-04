# F-601 · Free-Text Event Intake

**Status:** PROPOSED (2026-07-26) — ready for review; not implementable until approved and listed in `docs/BASELINE.md`.

**Phase:** 4 · **Issue:** [#57](https://github.com/jzeng151/pop-engine/issues/57) · **Owner:** TBD · **Reviewer:** product owner plus affected architecture, contract, security, and lane owners (TBD) · **Approval date:** —

## Purpose and User Outcome

An organizer can describe an event in free text and receive proposed structured F-101 answers, but only confirmed values reach F-109 scope-support classification or evaluation.

## Scope

**In scope**

- Send bounded organizer text through the approved AI gateway and map proposals only to current intake-registry fields/options.
- Show evidence snippets/confidence where available, allow accept/edit/reject per field, and run F-109 scope-support classification.
- Present a material concept with no current registry field as an unmatched-scope review item that the organizer can confirm or reject; it is never an engine answer.
- Require the organizer to confirm that the original description is fully represented or manually add an unmatched-scope item before evaluation.
- Create a normal event draft/revision only from explicit confirmations.

**Non-goals**

- Direct evaluation of free text, automatic submission, new intake fields, regulatory interpretation, or silent defaulting.
- Using AI output as a regulatory source.

## Dependencies and Baseline

- F-101, F-109, F-304 AI gateway, Event Revisions, and the F-701/F-702/F-703 gate.
- Approved prompt/model, extraction evaluation set, privacy, retention, and field-confirmation contract.
- Baseline at draft time: PRD, Roadmap, Design, and Phase 0–1.5 Architecture approved 2026-07-22; `ARCHITECTURE-FUTURE.md` approved as a planning target 2026-07-25; NYC ruleset `nyc.v2.7`, rules schema `popengine-rules/v2`, and scenario fixtures v5 where regulatory output is consumed.
- Operand binding for client-supplied identities: `specs/F-411-staff-roles-credentialed-entry.md` F411-AC-08 states once, for this whole branch, that a client-supplied identity is committed with the operands that determine its recorded result and that a reuse carrying different operands is a conflict rather than a replay. Every identity criterion below relies on it. F-411 is PROPOSED, so that rule is not an approved input today and this spec is not implementable against it until F-411 is approved or the rule is promoted to an approved shared invariant; F411-AC-08 records both paths.
- The approval PR must re-pin any baseline version that changes before approval. A proposed or superseded input blocks implementation.

## Inputs, Outputs, State, Validation, and Errors

- Input is bounded free text, registry/version, a stable run-request identity, and, on every review action, the exact proposal version and run review generation it was composed against plus, on a manual unmatched-scope addition, its own request identity, all under F601-AC-07; output is field-level proposals with provenance and no committed answers.
- Each proposal is pending → accepted/edited/rejected; only accepted/edited values enter the draft.
- Unsupported concepts, ambiguity, missing material facts, model failure, and unsafe content remain visible through F-109 or manual intake. A confirmed unmatched-scope item is a scope-support input outside the engine answer registry.
- Missing or unresolved material data stays visibly unset, unknown, pending, or failed as appropriate; it never becomes a successful or complete result.
- Invalid input produces a field or action-specific error without partial mutation. Retriable external failures preserve the user's confirmed state and expose a safe retry.

## UI and Accessibility

- Review lists original text and every proposed field/value/reason, supports keyboard bulk navigation but requires explicit material confirmation.
- The complete workflow is keyboard operable, uses programmatic labels and visible focus, does not encode status by color alone, and announces asynchronous success or failure.
- Empty, loading, permission-denied, validation, provider-failure, and unavailable states have explicit copy and a safe next action.

## System Impact

| Concern              | Proposed impact                                                                                                                       |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| API                  | AI proposal/run/status/confirmation operations require approved OpenAPI/JSON Schema contracts tied to registry version.               |
| Schema               | Forward migration only for bounded AI run/proposal/confirmation provenance; authoritative answers remain Event Revision data.         |
| Jobs                 | Durable AI job with timeout, cancellation, bounded retry, idempotency, and cost limits.                                               |
| Providers            | Approved AI gateway/provider only.                                                                                                    |
| Privacy and security | Data minimization, prompt-injection handling, redacted logs, provider retention/training settings, workspace scope, and abuse limits. |

Exact HTTP, JSON Schema, migration, job, and provider shapes belong in their reviewed machine contracts; this proposal does not authorize parallel local types or edits to merged migrations.

## Acceptance Criteria

1. **F601-AC-01:** The model can propose only fields/options present in the exact current intake registry and cannot create an endpoint, enum, or rule.
2. **F601-AC-02:** No proposed field value or unmatched-scope observation reaches scope-support classification or evaluation until the user accepts, edits, or confirms it.
3. **F601-AC-03:** Evaluation remains blocked until the organizer confirms the original description is fully represented and can manually add any model-omitted unmatched-scope item; every material concept with no current registry field must then be rejected as inapplicable or confirmed as unmatched scope. Confirmed unmatched scope enters F-109, never the engine answer set, and cannot yield a complete-plan claim.
4. **F601-AC-04:** Rejecting a proposal leaves the corresponding answer absent; editing uses normal F-101 validation.
5. **F601-AC-05:** Provider/model/prompt failure preserves the original text and offers the complete manual F-101 path.
6. **F601-AC-06:** The start-run request carries a client-generated request identity, and the transaction that creates the run commits that identity under a uniqueness constraint on `(workspace, actor, request identity)` in the AI-run table this feature owns. A retry presenting the same identity returns the original run and its proposals instead of starting a second one, so a run that commits with a lost response cannot consume provider quota twice or leave two independently actionable proposal sets. Deliberate regeneration from the same or edited text sends a new identity and is therefore never mistaken for a retry. Uniqueness over the submitted text is not that enforcement: identical text is a legitimate second run, so it would refuse deliberate regeneration while a lost create response still produced two runs. That identity binds its operands under the rule `F411-AC-08` states once for every client-supplied identity on this branch: it is committed together with the request fields that determine the recorded result, including every aggregate, version, and generation the request names, and a later request presenting the same identity with any different operand is refused as a conflict rather than being answered with the stored result. The identity is still the key and the operands are only a precondition on reusing it, so this is not the content uniqueness this criterion already forbids.

   The scope is the actor inside their workspace, not a draft, because no draft aggregate exists to scope it to. `docs/EVENT-REVISION-CONTRACT.md` has no independently mutable questionnaire draft, F107-AC-08 and F503-AC-04 both forbid one, and on the pre-event path the Event itself does not exist until confirmed proposals are saved. An earlier wording said "scoped to the draft", which left an implementer to invent that entity or to pick an unstated Event or actor scope, and the two paths would then have disagreed about what a retry even means. Workspace and actor exist on both paths under the F-701/F-702/F-703 gate this spec already depends on, and the run row belongs to the bounded AI-run migration the System Impact table already declares, so nothing new is required to enforce it. A run that targets an existing Event additionally records that Event; the recording is provenance and does not narrow the constraint, so a retry is recognized identically before and after an Event exists.

7. **F601-AC-07:** Every review action names the exact version of the item it was composed against and commits only by compare-and-swap on that version. Accepting, editing, or rejecting a field proposal names that proposal's current version; a transition naming a superseded version is rejected, changes no disposition or value, and returns the current proposal for the organizer to reload and re-review, never a last-write-wins overwrite. The same rule covers every sibling reviewable item in the run and not only a field proposal: an unmatched-scope item's confirm or reject under AC-03, a manually added unmatched-scope item, and the AC-03 full-representation confirmation each name the version they were composed against and are applied on the same terms. Final confirmation additionally names the run's complete review generation, which advances on every one of those transitions, and compare-and-swaps that exact generation inside the transaction that builds the revision; a generation that has moved rejects the confirmation, appends no revision, and requires the organizer to re-review the current proposal set.

   Final confirmation also carries its own stable client-supplied request identity, distinct from AC-06's and from the manual-addition identity below, committed atomically with the Event and revision it writes: on the pre-event path under a uniqueness constraint scoped to the actor and workspace, since no Event exists yet to scope it to, and on the existing-Event path scoped to that Event. It is resolved before the review-generation and base-revision comparisons, so a retry after a lost response returns the Event and revision the first attempt committed rather than being answered as a stale conflict for work that in fact succeeded. Nothing else identifies this write: AC-06's identity names creation of the AI run and is consumed by the run that already exists, and this criterion's generation and base-revision comparisons name the state the confirmation was composed against rather than the request that made it. Without it, a lost response on the pre-event path lets the retry create a second Event and first revision for one confirmation, and on an existing Event the first save advances the revision the retry named, so the organizer is told their confirmation was stale when it had already committed. That identity binds its operands under the rule `F411-AC-08` states once for every client-supplied identity on this branch, so a reuse naming a different run, review generation, or base revision is refused as a conflict rather than answered with the committed Event.

   A manual unmatched-scope addition creates the item it acts on, so it has no prior version for the request to name and compare-and-swap cannot make its retry safe on its own. That creation therefore binds a stable client-supplied request identity, committed with the item under a uniqueness constraint scoped to the run, in the same transaction that appends the item and advances the run's review generation. A retry presenting the same identity returns the original item and the generation that creation reached, appends no second review item, and advances the generation no further; a deliberate second manual addition, including one carrying the same text as an existing item, sends a new identity and is created as its own item. Once created, the item's later confirm, reject, edit, and removal are ordinary review actions governed by the version comparison above. AC-06's identity does not reach this: it is scoped to run creation on `(workspace, actor, request identity)` and is consumed by the run that already exists. That identity binds its operands under the rule `F411-AC-08` states once for every client-supplied identity on this branch: it is committed together with the request fields that determine the recorded result, including every aggregate, version, and generation the request names, and a later request presenting the same identity with any different operand is refused as a conflict rather than being answered with the stored result. The identity is still the key and the operands are only a precondition on reusing it, so this is not the content uniqueness this criterion already forbids.

   Comparing only the run's review generation is not that protection either, in either direction. A retry that names the generation it read before the first attempt finds that the committed first attempt has already advanced it, so the retry is rejected as stale and the organizer is told their addition failed when it succeeded; a retry that names the generation the first attempt reached passes the comparison and appends a second review item for one intended addition, which AC-03 then requires the organizer to confirm or reject twice and which enters F-109 twice. The identity and the generation are both required and do different work: the identity decides whether this request has already been applied, and the generation decides whether the review set it was composed against has moved.

   AC-02 keeps an unconfirmed value out of scope-support classification and evaluation and says nothing about which confirmed set the revision is built from. Without these comparisons two tabs accepting, editing, or rejecting one proposal both report success and the later write silently replaces the disposition the organizer was told had saved, and a final confirmation racing one of those actions builds the revision from a disposition or unmatched-scope set other than the one shown at review. AC-02 sees a confirmed value in each case, so what reaches F-109 or evaluation is a value the organizer never confirmed.

## Fixtures and Verification

- F601-AC-07 includes a confirmation-retry fixture on each path: on the pre-event path a lost response followed by a retry of the same confirmation identity yields exactly one Event and one first revision, and on an existing Event the retry returns the revision the first attempt committed instead of a stale-generation rejection.
- Planned automated fixture IDs are the acceptance IDs above; each must map one-to-one to a runnable test before approval can claim implementation readiness.
- Regulatory fixtures: A reviewed paraphrase corpus for scenarios A–F plus ambiguous/unsupported/adversarial descriptions; engine expectations remain the approved structured fixtures.
- Security-sensitive and cross-workspace paths require negative authorization tests; provider paths require success, duplicate-delivery, retry, invalid-signature, and permanent-failure tests where applicable.

## Allowed Footprint and Coordination

- `apps/web` and `apps/api` feature code and tests.
- New ordered forward migrations and approved OpenAPI/JSON Schema changes required by this feature.
- No repository restructuring, speculative package, or unrelated feature edit.
- Shared contracts, migrations, provider adapters, engine/rules artifacts, consent policy, and cross-lane UI primitives require the approvals named in `docs/DOCUMENTATION-GOVERNANCE.md` §6.

## Rollout and Fallback

- Feature-flag AI intake; manual F-101 remains fully available and authoritative.
- Rollback disables the new surface and workers/provider calls without deleting confirmed user data or rewriting immutable plans, rulesets, revisions, or history.

## Approval Blockers

- F-109 must be approved and shipped. **This prerequisite is itself blocked on open question T-8.** `docs/DESIGN.md:90` is a row of the "Dependency Graph (build-order constraints)" section, where every other row's `X → Y` means X is built before Y, and it reads `F-601 (open-ended intake) → F-109 becomes necessary`. Under that section's reading F-601 comes first, which this blocker and F-109's own "F-601 is blocked on F-109" both contradict, and which nothing can implement because F-601 calls the classification F-109 defines. Under the row's own predicate it records only that adding F-601 is what makes F-109 necessary, and states no order. `docs/DOCUMENTATION-GOVERNANCE.md` §1 gives the delivery design the sequence concern, so this proposal cannot settle it by preferring the reading that suits it; the row is amended through governance §6 or says which of the two it is, and until then F-601 is not approvable. Registered 2026-08-03.
- Approve AI gateway/privacy/cost decisions and an independently reviewed proposal evaluation set.
- Assign the owner and independent reviewer, approve this spec, and add it to `docs/BASELINE.md`.
