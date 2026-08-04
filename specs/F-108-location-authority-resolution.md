# F-108 · Location and Authority Resolution

**Status:** PROPOSED (2026-07-26) — ready for review; not implementable until approved and listed in `docs/BASELINE.md`.

**Phase:** 4 · **Issue:** [#53](https://github.com/jzeng151/pop-engine/issues/53) · **Owner:** TBD · **Reviewer:** product owner plus affected architecture, contract, security, and lane owners (TBD) · **Approval date:** —

## Purpose and User Outcome

An organizer can turn a location into proposed park, plaza, precinct, community-board, and other authority fields with confidence and manual correction before evaluation.

## Scope

**In scope**

- Geocode an organizer-entered location through one approved adapter and propose authority/reference-data matches with provenance/confidence.
- Require review and confirmation or correction before material values enter an event revision.
- Preserve raw organizer input, provider result reference, confirmed value, and correction history.

**Non-goals**

- Treating geocoding or a provider as a regulatory source, silently selecting an agency, guaranteeing jurisdiction, or tracking a user's location.
- Replacing F-204 official portal/citation sources.

## Dependencies and Baseline

- F-101, F-107 Event Revisions, whose save path AC-05 confirms through, approved jurisdiction/reference datasets, and the F-701/F-702/F-703 gate.
- ADR for geocoding provider, confidence policy, retention, manual correction, and versioned reference data.
- Baseline at draft time: PRD, Roadmap, Design, and Phase 0–1.5 Architecture approved 2026-07-22; `ARCHITECTURE-FUTURE.md` approved as a planning target 2026-07-25; NYC ruleset `nyc.v2.7`, rules schema `popengine-rules/v2`, and scenario fixtures v5 where regulatory output is consumed.
- The approval PR must re-pin any baseline version that changes before approval. A proposed or superseded input blocks implementation.

## Inputs, Outputs, State, Validation, and Errors

- Input is a user-entered address/place plus jurisdiction context; output is a proposal with provider/reference versions and confidence.
- State is unresolved → proposed → confirmed or corrected; ambiguous/no-match/provider-failure never auto-confirms.
- A later reference-data change creates a new proposal and never rewrites a revision already evaluated.
- Missing or unresolved material data stays visibly unset, unknown, pending, or failed as appropriate; it never becomes a successful or complete result.
- Invalid input produces a field or action-specific error without partial mutation. Retriable external failures preserve the user's confirmed state and expose a safe retry.

## UI and Accessibility

- Map-free review is fully usable; proposals expose source/confidence, alternatives, manual fields, and a clear unconfirmed state.
- The complete workflow is keyboard operable, uses programmatic labels and visible focus, does not encode status by color alone, and announces asynchronous success or failure.
- Empty, loading, permission-denied, validation, provider-failure, and unavailable states have explicit copy and a safe next action.

## System Impact

| Concern              | Proposed impact                                                                                                                          |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| API                  | Resolve/proposal/confirm/correct operations require approved OpenAPI contracts with bounded provider input/output.                       |
| Schema               | Forward migrations/contracts for versioned location proposals and confirmed authority references; engine inputs remain registry-defined. |
| Jobs                 | Optional durable provider call/cache refresh; confirmation is synchronous.                                                               |
| Providers            | One geocoding provider behind an adapter plus approved public authority/reference datasets.                                              |
| Privacy and security | Workspace scope, address minimization, provider terms/retention review, rate limits, encrypted credentials, and no raw address logs.     |

Exact HTTP, JSON Schema, migration, job, and provider shapes belong in their reviewed machine contracts; this proposal does not authorize parallel local types or edits to merged migrations.

## Acceptance Criteria

1. **F108-AC-01:** A successful lookup returns a versioned proposal with confidence/provenance and never writes material F-101 values before confirmation.
2. **F108-AC-02:** Ambiguous, low-confidence, no-match, unsupported-jurisdiction, and provider-failure states require manual resolution and cannot evaluate as confirmed.
3. **F108-AC-03:** Manual correction records actor/time and the selected authoritative reference without changing provider history. A correction names the exact proposal version it was made from and the reference that version presented, and the single transaction compare-and-swaps that version before appending the corrected proposal version and advancing the Event's current proposal. A stale version rejects the whole correction, mutates nothing, and returns the current proposal so the organizer re-reviews; the server never merges two corrections and never applies one to a proposal the organizer did not read. The same comparison applies to the manual resolution AC-02 requires for ambiguous, low-confidence, no-match, unsupported-jurisdiction, and provider-failure states. Without it a concurrent second correction, a deliberate re-resolution, or the reference-data change that creates a new proposal silently discards the organizer's override, and provider history cannot reconstruct what was overridden.
4. **F108-AC-04:** The engine consumes only the confirmed registry-compatible value and treats the provider result as non-authoritative.
5. **F108-AC-05:** A proposal pins the provider/reference version it resolved and the `base_revision_id` of the Event revision the reviewer saw, and a confirmation additionally names the exact proposal version and the selected authoritative reference it displayed. Confirmation writes the confirmed value through F-107's ordinary revision save, so the single transaction in `docs/EVENT-REVISION-CONTRACT.md` §2.4 locks the Event, compares that `base_revision_id` with `events.current_revision_id`, and compare-and-swaps the pinned provider/reference version, the named proposal version, and the named selected reference in the same transaction. Any one of them being stale rejects the whole confirmation and mutates nothing; a stale base returns `409` with code `revision_conflict` and the current revision, and the organizer reloads and re-reviews rather than the server merging. Comparing only the provider/reference version would let a concurrent Event edit be lost, because the appended revision would carry answers read before that edit; comparing neither the proposal version nor the selected reference would let a confirmation commit a selection that a concurrent correction or re-resolution had already replaced, so the location and authority entering evaluation would not be the ones the reviewer reviewed. A reviewed historical-version exception is recorded before the save and waives only the reference-version comparison, never the revision, proposal-version, or selected-reference comparisons. A later version cannot silently alter an existing revision or plan.
6. **F108-AC-06:** Starting a lookup binds the request to a stable client-supplied request identity, committed with the proposal under a uniqueness constraint scoped to the Event. A retry presenting the same identity returns the original proposal and issues no second provider call; a deliberate re-resolution of the same location sends a new identity. This is request identity, never content uniqueness: two genuinely distinct lookups of the same address are both recorded, and a repeated identity is never rejected as a duplicate value. That identity binds its operands under the rule `F411-AC-08` states once for every client-supplied identity on this branch: it is committed together with the request fields that determine the recorded result, including every aggregate, version, and generation the request names, and a later request presenting the same identity with any different operand is refused as a conflict rather than being answered with the stored result. The identity is still the key and the operands are only a precondition on reusing it, so this is not the content uniqueness this criterion already forbids.

   AC-05 stops a stale proposal from being confirmed into an Event and does nothing about how many proposals exist. When the lookup transaction records a proposal and its response is lost, the retry calls the provider again and writes a second proposal for one intended action. The reviewer is then offered two proposals with the same provenance and no way to tell which the earlier attempt produced, and the provider is billed and rate-limited twice for one resolution.

   That request identity covers lookup starts and the proposal each one creates; it is not the record key for the rest of the aggregate. Correction under AC-03 and confirmation under AC-05 carry no lookup identity, do not consume or reuse one, and never create a proposal under the AC-06 uniqueness constraint. They are compare-and-swap operations instead, so a lost response is answered by a retry that finds the version it expected already advanced, is rejected as stale, and returns the organizer to a proposal that already shows the first attempt's effect rather than applying it a second time. The two therefore compose without either owning the record: AC-06 decides how many proposals one intended lookup may create, and AC-03 and AC-05 decide which proposal version a correction or confirmation is allowed to act on.

## Fixtures and Verification

- Planned automated fixture IDs are the acceptance IDs above; each must map one-to-one to a runnable test before approval can claim implementation readiness.
- Regulatory fixtures: Approved F-101 location scenarios plus separately approved synthetic resolution fixtures; provider output is not regulatory ground truth.
- Security-sensitive and cross-workspace paths require negative authorization tests; provider paths require success, duplicate-delivery, retry, invalid-signature, and permanent-failure tests where applicable.

## Allowed Footprint and Coordination

- `apps/web` and `apps/api` feature code and tests.
- New ordered forward migrations and approved OpenAPI/JSON Schema changes required by this feature.
- No repository restructuring, speculative package, or unrelated feature edit.
- Shared contracts, migrations, provider adapters, engine/rules artifacts, consent policy, and cross-lane UI primitives require the approvals named in `docs/DOCUMENTATION-GOVERNANCE.md` §6.

## Rollout and Fallback

- Manual F-101 location entry remains the fallback whenever resolution is disabled or uncertain.
- Rollback disables the new surface and workers/provider calls without deleting confirmed user data or rewriting immutable plans, rulesets, revisions, or history.

## Approval Blockers

- Approve provider/reference datasets, confidence thresholds, manual-correction authority, retention, and cost/rate limits.
- Assign the owner and independent reviewer, approve this spec, and add it to `docs/BASELINE.md`.
