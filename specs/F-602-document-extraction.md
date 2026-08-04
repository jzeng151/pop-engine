# F-602 · Document Extraction

**Status:** PROPOSED (2026-07-26) — ready for review; not implementable until approved and listed in `docs/BASELINE.md`.

**Phase:** 4 · **Issue:** [#58](https://github.com/jzeng151/pop-engine/issues/58) · **Owner:** TBD · **Reviewer:** product owner plus affected architecture, contract, security, and lane owners (TBD) · **Approval date:** —

## Purpose and User Outcome

An organizer can receive proposed application number, deadline, fee, and status values from a private upload and confirm them before any workflow record changes.

## Scope

**In scope**

- Run approved text/extraction processing on a safe uploaded document and create field-level proposals with page/snippet provenance.
- Accept/edit/reject each proposal through normal validation; a confirmed value for an empty field may enter F-208/F-209, while a confirmed difference from an existing value remains an unapplied typed proposal for F-604.
- Preserve document/extractor/model/version and confirmation actor.

**Non-goals**

- Automatic overwrite, legal interpretation, signature verification, document authenticity, agency acceptance, or invented missing values.
- Making the extracted text a regulatory source.

## Dependencies and Baseline

- F-208, F-209 upload controls, approved jobs/outbox, and the F-701/F-702/F-703 gate. F-702 supplies the workspace membership boundary the document version, extraction run, and proposals resolve against and F-703 supplies the permission matrix `F602-AC-09` checks; F-701 supplies the authenticated actor both read from. All three are PROPOSED, so the gate is not an approved input today and this spec is not implementable against it until they are approved and listed in `docs/BASELINE.md`.
- AI/OCR provider, file-type, retention, confidence/display, and proposal contracts.
- Baseline at draft time: PRD, Roadmap, Design, and Phase 0–1.5 Architecture approved 2026-07-22; `ARCHITECTURE-FUTURE.md` approved as a planning target 2026-07-25; NYC ruleset `nyc.v2.7`, rules schema `popengine-rules/v2`, and scenario fixtures v5 where regulatory output is consumed.
- Operand binding for client-supplied identities: `specs/F-411-staff-roles-credentialed-entry.md` F411-AC-08 states once, for this whole branch, that a client-supplied identity is committed with the operands that determine its recorded result and that a reuse carrying different operands is a conflict rather than a replay. Every identity criterion below relies on it. F-411 is PROPOSED, so that rule is not an approved input today and this spec is not implementable against it until F-411 is approved or the rule is promoted to an approved shared invariant; F411-AC-08 records both paths.
- The approval PR must re-pin any baseline version that changes before approval. A proposed or superseded input blocks implementation.

## Inputs, Outputs, State, Validation, and Errors

- Input is an authorized safe file; output is zero or more pending field proposals with exact source location when available.
- Proposal state is pending → accepted/edited/rejected; an accepted difference from current state becomes confirmed-but-unapplied for F-604, and later extraction creates a separate run.
- Unreadable, conflicting, ambiguous, or unsupported values remain pending/unavailable; low-confidence values remain pending for explicit review or direct the organizer to manual entry and never become record state from confidence alone.
- Missing or unresolved material data stays visibly unset, unknown, pending, or failed as appropriate; it never becomes a successful or complete result.
- Invalid input produces a field or action-specific error without partial mutation. Retriable external failures preserve the user's confirmed state and expose a safe retry.

## UI and Accessibility

- Side-by-side review shows document location, proposed value/type, confidence limitation, existing value, and explicit per-field action.
- The complete workflow is keyboard operable, uses programmatic labels and visible focus, does not encode status by color alone, and announces asynchronous success or failure.
- Empty, loading, permission-denied, validation, provider-failure, and unavailable states have explicit copy and a safe next action.

## System Impact

| Concern              | Proposed impact                                                                                                                             |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| API                  | Extraction run/status/proposal/confirmation operations require approved OpenAPI contracts.                                                  |
| Schema               | Forward migrations for extraction runs/proposals/confirmations linked to private document versions.                                         |
| Jobs                 | Durable scan-then-extract job chain with idempotency, timeout, bounded retry, cancellation, and dead-letter state.                          |
| Providers            | Private storage/scanning plus approved OCR/AI adapter.                                                                                      |
| Privacy and security | Strict file validation/scan, signed access, provider minimization/retention, prompt injection controls, redacted logs, and workspace scope. |

Exact HTTP, JSON Schema, migration, job, and provider shapes belong in their reviewed machine contracts; this proposal does not authorize parallel local types or edits to merged migrations.

## Acceptance Criteria

1. **F602-AC-01:** Only a safe authorized document version can start extraction, and every proposal links to that exact version/run/source location.
2. **F602-AC-02:** Application number, agency-provided deadline, and status remain proposals until explicit user acceptance/edit through F-208 validation; fee remains a proposal until explicit user acceptance/edit through F-209 validation.
3. **F602-AC-03:** Existing confirmed values are never overwritten; accepting a difference creates a source-linked, typed, confirmed-but-unapplied proposal for F-604 rather than appending domain history.
4. **F602-AC-04:** Unreadable, ambiguous, conflicting, or unsupported content cannot create a confirmed workflow fact; low-confidence content stays pending until an organizer verifies and accepts/edits it against the displayed source, or is suppressed as a proposal in favor of manual entry.
5. **F602-AC-05:** The start-extraction request carries a client-generated request identity, and the transaction that creates the run commits it under a uniqueness constraint scoped to the document version. A retry presenting the same identity returns the original run and its proposals instead of starting a second one, so an extraction that commits with a lost response cannot duplicate provider work or pending proposals. Deliberate later extraction of the same document version, which the state model already supports as a separate run, sends a new identity and is therefore never mistaken for a retry. Document-version uniqueness is not that enforcement: it would reject the supported rerun. Duplicate or retried extraction of the same request identity creates no duplicate accepted proposals or records. That identity binds its operands under the rule `F411-AC-08` states once for every client-supplied identity on this branch: it is committed together with the request fields that determine the recorded result, including every aggregate, version, and generation the request names, and a later request presenting the same identity with any different operand is refused as a conflict rather than being answered with the stored result. The identity is still the key and the operands are only a precondition on reusing it, so this is not the content uniqueness this criterion already forbids.
6. **F602-AC-06:** External access atomically claims a non-cancellable `processing` state after checking run generation and exact document availability/scan state; cancellation, deletion, and quarantine serialize against that claim and cannot report prevention for already-processing work.
7. **F602-AC-07:** Completion compare-and-swaps the pinned run generation and current document availability/scan state before publishing proposals; deletion, quarantine, or generation change discards the result and suppresses or purges derived snippets/proposals.
8. **F602-AC-08:** Every disposition of a pending proposal, accepting, editing, and rejecting alike, compare-and-swaps the proposal's state and rechecks the exact document version's current authorization, availability, and safe scan state, and each binds a stable client-supplied request identity, committed under a uniqueness constraint scoped to the proposal it dispositions, so a retry returns its original recorded outcome and audit result rather than recording a second decision. Deletion, quarantine, or other eligibility loss serializes against all of them, invalidates every still-pending proposal and derived snippet from that version, and prevents them from entering F-208/F-209. Rejection is advertised as a terminal transition by both the scope and the state model, so leaving it outside the comparison lets one reviewer's acceptance and another's rejection of the same proposal both report success: if acceptance commits first, the unguarded rejection makes the proposal read as rejected while the confirmed-but-unapplied F-604 work AC-03 already created still exists, and the opposite ordering produces a different outcome from the same two actions.
9. **F602-AC-09:** Every operation this feature defines names the document version, extraction run, or proposal it acts on and the workspace that owns it, and is admitted only by the acting actor's current F-702 membership of that workspace together with the F-703 permission approved for the action, both re-read server-side from stored membership and role at the moment of the operation and, for a write, inside the same transaction that commits it. `F602-AC-01`'s rule that only a safe authorized document version can start extraction, and `F602-AC-08`'s recheck of the exact document version's current authorization, availability, and safe scan state, remain the rules for the document's own state; they gate what the document is, not who the actor is, and this criterion adds the actor's current membership and permission alongside them, so a revoked member whose document remains authorized, available, and safe is still refused. That covers starting extraction under `F602-AC-01` and `F602-AC-05`; run status reads; proposal reads and listing, including the snippet and document-location display; each disposition of a pending proposal under `F602-AC-08`, checked inside the same transaction as its compare-and-swap and document-state recheck; cancellation under `F602-AC-06`'s serialization; and the writes that carry a confirmed value into F-208 or F-209. The worker and provider claim transitions under `F602-AC-06`, external access atomically claiming `processing`, execute as the system actor with no acting user and are outside this criterion; they are bound by that criterion's run-generation and document availability/scan checks instead. A request failing the check is refused before any durable write and before any proposal, snippet, document location, confidence, or extracted value is disclosed, and its response does not distinguish a document version, run, or proposal that does not exist from one the actor may not see. The check is at the operation and not at session start or workspace switch, so authority removed while a request is in flight causes that request to fail rather than commit.

   Without this criterion AC-01 through AC-08 all pass for a caller who names another workspace's document version or run. AC-01 and AC-08 check the document, AC-02 through AC-04 fix what may become a confirmed workflow fact, AC-05 fixes retry identity, and AC-06 and AC-07 serialize the job chain, and none of them re-reads the acting user's authority at the operation. The surface that set leaves open reads another organizer's extracted application numbers, deadlines, fees, statuses, and page snippets from a private upload, and dispositions their pending proposals, carrying confirmed values into their F-208 and F-209 records.

   One input this criterion needs is not established by any approved artifact today and is not invented here. F-703 is PROPOSED and names no role set, so the permission above cannot be named. Until F-703 is approved this criterion is testable only as "every extraction start, status read, proposal read, disposition, cancellation, and confirmed-value write is refused unless the acting actor holds an active membership of the workspace that owns the named document version, run, or proposal, read server-side at that operation, and a refusal discloses nothing about whether that aggregate exists", not against a named role or permission identifier. Naming the extraction and proposal-disposition permissions with F-703 is an approval blocker below.

## Fixtures and Verification

- Planned automated fixture IDs are the acceptance IDs above; each must map one-to-one to a runnable test before approval can claim implementation readiness.
- Regulatory fixtures: Synthetic document fixtures only; no extracted value becomes regulatory ground truth.
- F602-AC-09 includes a fixture in which an actor holding no membership of the owning workspace names a valid document version, run, and proposal and is refused at extraction start, at status and proposal reads, at every disposition, at cancellation, and at the confirmed-value write, with a response that does not distinguish absence from denial; a fixture in which a member whose membership is revoked mid-flight, while the document itself remains authorized, available, and safe, has that request fail rather than commit; and a paired fixture confirming the system-actor claim transitions under F602-AC-06 are unaffected.
- Security-sensitive and cross-workspace paths require negative authorization tests; provider paths require success, duplicate-delivery, retry, invalid-signature, and permanent-failure tests where applicable.

## Allowed Footprint and Coordination

- `apps/web` and `apps/api` feature code and tests.
- New ordered forward migrations and approved OpenAPI/JSON Schema changes required by this feature.
- No repository restructuring, speculative package, or unrelated feature edit.
- Shared contracts, migrations, provider adapters, engine/rules artifacts, consent policy, and cross-lane UI primitives require the approvals named in `docs/DOCUMENTATION-GOVERNANCE.md` §6.

## Rollout and Fallback

- Keep manual F-208/F-209 entry available; disable extraction if provider/privacy/file checks fail.
- Rollback disables the new surface and workers/provider calls without deleting confirmed user data or rewriting immutable plans, rulesets, revisions, or history.

## Approval Blockers

- Approve upload/scanning and OCR/AI provider ADRs, supported file limits, retention, proposal UX, and evaluation fixtures.
- Approve F-701, F-702, and F-703, and name with F-703 the extraction and proposal-disposition permissions `F602-AC-09` checks. That criterion checks a permission no approved artifact defines today and may not invent one, so until the matrix names them it is testable only at the membership level stated there.
- Assign the owner and independent reviewer, approve this spec, and add it to `docs/BASELINE.md`.
