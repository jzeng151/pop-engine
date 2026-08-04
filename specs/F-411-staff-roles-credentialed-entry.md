# F-411 · Staff Roles and Credentialed Entry

**Status:** PROPOSED (2026-07-26) — ready for review; not implementable until approved and listed in `docs/BASELINE.md`.

**Phase:** 3 · **Issue:** [#43](https://github.com/jzeng151/pop-engine/issues/43) · **Owner:** TBD · **Reviewer:** product owner plus affected architecture, contract, security, and lane owners (TBD) · **Approval date:** —

## Purpose and User Outcome

Event staff can perform only their assigned door operations and validate attendee, vendor, or performer entry categories without receiving broader workspace access.

## Scope

**In scope**

- Event-scoped staff assignments with check-in/entry permissions and credential categories for attendee, vendor, and performer.
- Issue, revoke, and validate opaque event credentials; record accepted/denied attempts.
- Enforce F-703 server-side authorization at every door action.

**Non-goals**

- Background checks, identity verification, physical badge printing, payroll, scheduling, access-control hardware, or arbitrary policy scripting.
- Using a credential as marketing consent or regulatory evidence.

## Dependencies and Baseline

- F-703, F-401, and F-410 for directional entry where used.
- Approved credential token, expiry, revocation, category, and staff permission contracts.
- Baseline at draft time: PRD, Roadmap, Design, and Phase 0–1.5 Architecture approved 2026-07-22; `ARCHITECTURE-FUTURE.md` approved as a planning target 2026-07-25; NYC ruleset `nyc.v2.7`, rules schema `popengine-rules/v2`, and scenario fixtures v5 where regulatory output is consumed.
- The approval PR must re-pin any baseline version that changes before approval. A proposed or superseded input blocks implementation.

## Inputs, Outputs, State, Validation, and Errors

- Inputs are an exact authorized staff-assignment generation and event-credential version, plus, on issuance, the subject, category, expiry, and a stable request identity; every validation additionally carries its own client-generated operation identity under F411-AC-08; outputs are the issued credential, minimal validation result, and append-only attempt/entry record.
- Credential state is active → revoked or expired; validation is event-bound and reveals only the minimum door decision.
- Unknown/malformed/wrong-event credentials deny without disclosing private attendee/vendor data.
- Missing or unresolved material data stays visibly unset, unknown, pending, or failed as appropriate; it never becomes a successful or complete result.
- Invalid input produces a field or action-specific error without partial mutation. Retriable external failures preserve the user's confirmed state and expose a safe retry.

## UI and Accessibility

- Door UI identifies active event/staff role, gives non-color accept/deny feedback, and supports scanner/keyboard fallback.
- The complete workflow is keyboard operable, uses programmatic labels and visible focus, does not encode status by color alone, and announces asynchronous success or failure.
- Empty, loading, permission-denied, validation, provider-failure, and unavailable states have explicit copy and a safe next action.

## System Impact

| Concern              | Proposed impact                                                                                                               |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| API                  | Staff assignment, credential issue/revoke/validate, and attempt contracts require approved OpenAPI rate/idempotency shapes.   |
| Schema               | Forward migrations for event staff assignments, opaque credential references, categories, and attempt history.                |
| Jobs                 | None.                                                                                                                         |
| Providers            | Camera/scanner uses browser-native capabilities; no hardware provider.                                                        |
| Privacy and security | Opaque high-entropy credentials, minimal validation projection, event/time binding, revocation, rate limits, and role checks. |

Exact HTTP, JSON Schema, migration, job, and provider shapes belong in their reviewed machine contracts; this proposal does not authorize parallel local types or edits to merged migrations.

## Acceptance Criteria

1. **F411-AC-01:** A check-in staff member can perform only the approved event-scoped door actions and no broader organizer/admin operation.
2. **F411-AC-02:** Validation and its accepted attempt/entry record serialize against both credential revocation and staff-assignment removal on the exact versions, so exactly one wins: a winning validation records one idempotent entry and returns the approved minimal category/decision, while a winning revocation or removal prevents acceptance.
3. **F411-AC-03:** Revoked, expired, malformed, guessed, or wrong-event credentials deny without revealing identity/contact details and append one idempotent non-sensitive attempt with the denial category.
4. **F411-AC-04:** Vendor and performer categories remain distinct from attendee and do not create RSVP, consent, or regulatory status.
5. **F411-AC-05:** Removing a staff assignment advances its generation and serializes against validation's claim of the prior generation; a winning removal blocks that validation and every later protected action, while preserving prior attempt attribution.
6. **F411-AC-06:** Issuance is an acceptance criterion, not a setup step: only an actor holding the approved issuing permission for that exact event can issue a credential, and the issuing transaction binds in one commit the event, the subject the credential admits, exactly one category from the approved category list, the expiry instant, the initial active state, and an opaque high-entropy token that no other issued credential holds. An issuance missing any of those bindings is rejected and creates nothing, so F411-AC-02, F411-AC-03, and F411-AC-04 can rely on every stored credential carrying them and the door feature is usable without seeded credentials. The issue request carries a client-generated request identity committed in that same transaction under a uniqueness constraint scoped to the event, matching the scope F411-AC-08 uses for a validation, so a retry after a lost response returns the original credential rather than issuing a second live token for the same subject; a deliberate second credential sends a new identity. Uniqueness over subject and category is not that enforcement: one subject may legitimately hold two credentials, so it would refuse a real issuance.
7. **F411-AC-07:** Credential validation is rate limited per event and per validating staff assignment. Within that limit every validation denies or accepts normally, appends its non-sensitive attempt record under F411-AC-03, and is visibly reported to the door operator rather than silently dropped. Once the limit is exceeded for that key, further requests are refused before any per-request durable write, including before the F411-AC-08 identity row, and the evidence of that refused activity is one coalesced record per event, staff assignment, and window, carrying the first and last refused instant and a count of refusals. That record is written at most once per key per approved flush interval, so the durable writes a refused flood produces are bounded by the number of windows and flush intervals it spans and not by the number of requests it sends; refusals arriving between flushes are answered from the limiter's own non-durable state and update no row. Between flushes the persisted last-refused instant and count are therefore accurate as of the last flush and are read as a lower bound on refusals to date, which the record states rather than presenting as a total. Appending one attempt record per refused request would make the limiter an amplifier, and updating the coalesced record in place on every refused request keeps that amplification while only bounding the row count: the cheap path a compromised door device or a stolen staff assignment controls is exactly the path that persists, so denied validation still buys the caller unbounded event-day write load. The refusal is still reported to the operator with a safe next action, and the coalesced record is still queryable evidence that the limit was reached, so bounding the write does not cost the audit trail its meaning. The exact limit and window are not approved today: they belong to the credential lifecycle and token threat model named in the Approval Blockers, which must also name the coalescing window, the flush interval, and the retention bound on coalesced records, because an unbounded set of coalescing keys reintroduces the growth this bound was added to stop. Until that approval names them, this criterion is testable only as "a configured finite limit is enforced, requests over it deny, and both the number of durable rows and the number of durable writes they produce are bounded by a finite count per key, window, and flush interval rather than growing with the request count," not against a specific number. This is stated here rather than only under Privacy and security because a repository agent implements acceptance criteria, and an unenforced limit leaves the opaque token guessable at whatever rate the door endpoint answers.

   Validation is the only operation this feature defines that an unauthorized or compromised caller can drive at will, which is why the bound is placed here and not repeated elsewhere. F411-AC-06 issuance, credential revocation, and F411-AC-05 staff-assignment removal each require the approved permission for that exact event under F411-AC-01, and a request failing that check is refused before any durable write, so none of them converts a rejected request into a persisted row.

8. **F411-AC-08:** Every validation carries a client-generated operation identity supplied by the door client, committed under a uniqueness constraint scoped to the event together with that validation's accepted or denied outcome. A replay presenting the same identity returns the stored outcome, appends no second attempt or entry record, and consumes no second unit of the F411-AC-07 limit; a genuinely separate presentation of the same credential sends a new identity and is validated normally. This is operation identity, never content uniqueness: the credential, the staff assignment, and the submitted payload may not serve as the key, because a deliberate rescan of one credential and a repeated denied guess are both legitimate, and F411-AC-03's attempt history and F411-AC-07's rate limiting are only meaningful while those repeats stay distinct. A server-generated request identifier is not that enforcement either, because a retry after a lost response carries a new one and duplicates the attempt it was meant to collapse.

   F411-AC-02 and F411-AC-03 each require an idempotent record, and the only stable request identity this spec otherwise defines belongs to F411-AC-06 issuance, so nothing gives a validation an identity to be idempotent on. When a validation commits its attempt or entry and the response is lost, the operator rescans and one presentation becomes two records: an accepted entry attributed twice, or a denial charged twice against a limit whose size the threat model has not yet named.

   This criterion and F411-AC-07 are evaluated in one stated order, because each otherwise assumes it owns the request. A presented identity that already holds a committed outcome is resolved from that record first and returns it, appending nothing and consuming no unit of the limit. Every other validation is then checked against the F411-AC-07 limit and refused if it is exceeded, before its identity is committed. Only a request passing both is validated and commits its outcome and identity in one transaction. Resolving the identity first is what makes the two composable: checking the limit first would charge the operator's retry against the unit the original presentation already paid and could deny an entry that was already accepted, while committing an identity for a refused request would restore exactly the per-request durable write F411-AC-07 removes. The consequence is stated rather than left implied: a request refused over the limit stores no outcome for its identity, so resending that identity after the window has passed is a first attempt and not a replay, and this criterion's replay guarantee covers exactly the identities that reached a committed outcome.

## Fixtures and Verification

- Planned automated fixture IDs are the acceptance IDs above; each must map one-to-one to a runnable test before approval can claim implementation readiness.
- Regulatory fixtures: none; this feature does not define regulatory ground truth.
- Security-sensitive and cross-workspace paths require negative authorization tests; provider paths require success, duplicate-delivery, retry, invalid-signature, and permanent-failure tests where applicable.

## Allowed Footprint and Coordination

- `apps/web` and `apps/api` feature code and tests.
- New ordered forward migrations and approved OpenAPI/JSON Schema changes required by this feature.
- No repository restructuring, speculative package, or unrelated feature edit.
- Shared contracts, migrations, provider adapters, engine/rules artifacts, consent policy, and cross-lane UI primitives require the approvals named in `docs/DOCUMENTATION-GOVERNANCE.md` §6.

## Rollout and Fallback

- Feature-flag per event; F-401 contact check-in remains available according to its own access policy.
- Rollback disables the new surface and workers/provider calls without deleting confirmed user data or rewriting immutable plans, rulesets, revisions, or history.

## Approval Blockers

- Approve credential lifecycle/token threat model, category list, and staff permission matrix. The threat model must name the exact validation rate limit, window, and coalesced-record flush interval that F411-AC-07 leaves unpinned, and the permission matrix must name which role holds the F411-AC-06 issuing permission.
- Assign the owner and independent reviewer, approve this spec, and add it to `docs/BASELINE.md`.
