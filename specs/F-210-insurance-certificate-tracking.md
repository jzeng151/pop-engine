# F-210 · Insurance Certificate Tracking

**Status:** PROPOSED (2026-07-26) — ready for review; not implementable until approved and listed in `docs/BASELINE.md`.

**Phase:** 3 · **Issue:** [#32](https://github.com/jzeng151/pop-engine/issues/32) · **Owner:** TBD · **Reviewer:** product owner plus affected architecture, contract, security, and lane owners (TBD) · **Approval date:** —

## Purpose and User Outcome

An organizer can track policy, coverage, additional-insured, certificate status, and expiration while keeping rule-derived requirements separate from user-recorded evidence.

## Scope

**In scope**

- Create certificate records linked to the F-201 insurance plan items (R10/R11) and their F-202 checklist elements, and record policy reference, coverage, additional-insured text, status, expiration, and private file.
- Show gaps between the published requirement and organizer-confirmed certificate facts.
- Preserve history for replacement and expiration.

**Non-goals**

- Insurance sales, broker integration, legal sufficiency determination, OCR, or automatic agency acceptance.
- Changing the F-201 insurance findings or the F-205 card that surfaces them.

## Dependencies and Baseline

- F-201, F-205, F-202, F-209 controlled documents, and the F-701/F-702/F-703 gate.
- Approved certificate status/money/date and upload contracts.
- Baseline at draft time: PRD, Roadmap, Design, and Phase 0–1.5 Architecture approved 2026-07-22; `ARCHITECTURE-FUTURE.md` approved as a planning target 2026-07-25; NYC ruleset `nyc.v2.7`, rules schema `popengine-rules/v2`, and scenario fixtures v5 where regulatory output is consumed.
- Operand binding for client-supplied identities: `specs/F-411-staff-roles-credentialed-entry.md` F411-AC-08 states once, for this whole branch, that a client-supplied identity is committed with the operands that determine its recorded result and that a reuse carrying different operands is a conflict rather than a replay. Every identity criterion below relies on it. F-411 is PROPOSED, so that rule is not an approved input today and this spec is not implementable against it until F-411 is approved or the rule is promoted to an approved shared invariant; F411-AC-08 records both paths.
- The approval PR must re-pin any baseline version that changes before approval. A proposed or superseded input blocks implementation.

## Inputs, Outputs, State, Validation, and Errors

- Inputs are immutable insurance finding plus organizer-confirmed certificate facts; outputs are source-linked certificate versions.
- State is missing → recorded → expiring/expired or replaced; scan safety and organizer status remain separate.
- Unknown coverage or additional-insured text remains unknown and cannot satisfy a requirement automatically.
- Missing or unresolved material data stays visibly unset, unknown, pending, or failed as appropriate; it never becomes a successful or complete result.
- Invalid input produces a field or action-specific error without partial mutation. Retriable external failures preserve the user's confirmed state and expose a safe retry.

## UI and Accessibility

- Requirement and evidence appear side by side; warnings state what is missing without declaring legal invalidity.
- The complete workflow is keyboard operable, uses programmatic labels and visible focus, does not encode status by color alone, and announces asynchronous success or failure.
- Empty, loading, permission-denied, validation, provider-failure, and unavailable states have explicit copy and a safe next action.

## System Impact

| Concern              | Proposed impact                                                                                                           |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| API                  | Certificate/version/upload operations require approved OpenAPI contracts.                                                 |
| Schema               | Forward migrations for insurance certificates and versions linked to findings/checklist items; private storage for files. |
| Jobs                 | Optional expiration reminders only through the approved message job system.                                               |
| Providers            | Private storage/scanning adapter; no insurer provider.                                                                    |
| Privacy and security | Private signed downloads, workspace scope, type/size/checksum/scan checks, and no document content in logs.               |

Exact HTTP, JSON Schema, migration, job, and provider shapes belong in their reviewed machine contracts; this proposal does not authorize parallel local types or edits to merged migrations.

## Acceptance Criteria

1. **F210-AC-01:** A certificate version links to the exact insurance finding and preserves its policy reference, versioned certificate status, entered source, dates, coverage, additional-insured text, and file.
2. **F210-AC-02:** Missing or unknown coverage/additional-insured facts remain visibly unresolved and never auto-complete the requirement.
3. **F210-AC-03:** Replacement preserves the earlier version and follows F210-AC-08; expiration uses the approved timezone/date rule.
4. **F210-AC-04:** The UI never labels a certificate legally sufficient or agency accepted without an explicit authoritative record.
5. **F210-AC-05:** Unauthorized, unsafe, oversized, or mismatched files are unavailable and cannot create a recorded certificate version. The size and type bounds are the ones the upload policy named in the Approval Blockers establishes; until it is approved this criterion is testable only as "configured finite size and type bounds are enforced against the file's verified bytes and a file outside them is rejected," not against a specific number or type list.
6. **F210-AC-06:** A certificate links to the F-201 plan item that carries the insurance requirement (the R10 `insurance` item or the R11 `note` item) by that item's identity and version, and to the F-202 checklist element derived from it, never to F-205 state. Approved F-205 owns no finding of its own: its acceptance criteria consume the existing R10/R11 plan items from F-201, F205-AC-04 links its card to the R10 checklist item, and F205-AC-05 states that removing F-205 loses only the dedicated card while the insurance findings still appear in the plan from F-201. Pinning the finding to F-205 would therefore either invent a second record for one requirement or leave this projection following a card rather than the plan item it displays. When a new plan supersedes or removes that pinned F-201 item, the prior requirement-to-certificate projection becomes stale while certificate history remains intact; a current finding requires explicit handling and is never guessed or silently remapped to old evidence. Removing or disabling the F-205 card alone changes nothing here, because the pinned item survives it.
7. **F210-AC-07:** Every certificate stays in private storage; each download issuance rechecks workspace authorization and scan state and returns only a short-lived signed URL. Authorization loss blocks new URLs, and already issued direct-storage URLs retain only their disclosed bounded validity until expiry.
8. **F210-AC-08:** A replacement names the exact certificate version it was composed against and commits only by compare-and-swap on that version: one transaction appends the new version and advances the current-certificate projection while the named version is still current. A replacement naming a superseded version is rejected, is not appended, and returns the current version for the organizer to resubmit against. Every replacement carries a stable request identity, so a retry returns its original recorded outcome instead of appending a second version. Concurrent replacements of one certificate therefore end with exactly one accepted current version and explicit rejections, never a last-write-wins projection that hides a confirmed update. "Replacement" here is every appended certificate version, not only a new file: a change to the policy reference, certificate status, entered source, dates, coverage, or additional-insured text AC-01 records is appended and compare-and-swapped on the same terms, so no field listed there can be edited without naming the certificate version it was composed against. That identity binds its operands under the rule `F411-AC-08` states once for every client-supplied identity on this branch: it is committed together with the request fields that determine the recorded result, including every aggregate, version, and generation the request names, and a later request presenting the same identity with any different operand is refused as a conflict rather than being answered with the stored result. The identity is still the key and the operands are only a precondition on reusing it, so this is not the content uniqueness this criterion already forbids.
9. **F210-AC-09:** Creating a certificate binds the request to a stable client-supplied request identity, committed with the first version under a uniqueness constraint scoped to the insurance finding it satisfies. A retry presenting the same identity returns the original certificate and its first version and appends nothing; a deliberately separate certificate uses a new identity. This is request identity, never content uniqueness: two genuinely distinct certificates carrying the same policy reference, dates, and coverage are both created, and a repeated identity is never rejected as a duplicate value. That identity binds its operands under the rule `F411-AC-08` states once for every client-supplied identity on this branch: it is committed together with the request fields that determine the recorded result, including every aggregate, version, and generation the request names, and a later request presenting the same identity with any different operand is refused as a conflict rather than being answered with the stored result. The identity is still the key and the operands are only a precondition on reusing it, so this is not the content uniqueness this criterion already forbids.

   AC-08 gives replacements this behaviour and starts at the second version, so the first one is the gap. When creation commits and its response is lost, the retry appends a second certificate record and a second private file reference for one upload. AC-01 makes both well-formed and AC-06 links both to the same finding, so nothing marks either superseded and the organizer's current evidence has two candidates with no rule to choose between them.

## Fixtures and Verification

- Planned automated fixture IDs are the acceptance IDs above; each must map one-to-one to a runnable test before approval can claim implementation readiness.
- Regulatory fixtures: Use the approved insurance-finding scenarios F-205 exercises (A, C, D, E), whose R10/R11 items come from F-201; all certificate data and files are synthetic.
- Security-sensitive and cross-workspace paths require negative authorization tests; provider paths require success, duplicate-delivery, retry, invalid-signature, and permanent-failure tests where applicable.

## Allowed Footprint and Coordination

- `apps/web` and `apps/api` feature code and tests.
- New ordered forward migrations and approved OpenAPI/JSON Schema changes required by this feature.
- No repository restructuring, speculative package, or unrelated feature edit.
- Shared contracts, migrations, provider adapters, engine/rules artifacts, consent policy, and cross-lane UI primitives require the approvals named in `docs/DOCUMENTATION-GOVERNANCE.md` §6.

## Rollout and Fallback

- Manual tracking first; extraction and reminders require separately approved F-602/F-203 expansion behavior.
- Rollback disables the new surface and workers/provider calls without deleting confirmed user data or rewriting immutable plans, rulesets, revisions, or history.

## Approval Blockers

- Approve certificate status vocabulary, upload policy, expiration behavior, and gap wording.
- Assign the owner and independent reviewer, approve this spec, and add it to `docs/BASELINE.md`.
