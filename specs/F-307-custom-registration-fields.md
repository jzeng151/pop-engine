# F-307 · Custom Registration Fields

**Status:** PROPOSED (2026-07-26) — ready for review; not implementable until approved and listed in `docs/BASELINE.md`.

**Phase:** 3 · **Issue:** [#37](https://github.com/jzeng151/pop-engine/issues/37) · **Owner:** TBD · **Reviewer:** product owner plus affected architecture, contract, security, and lane owners (TBD) · **Approval date:** —

## Purpose and User Outcome

An organizer can collect a small, safe set of extra RSVP answers without adding arbitrary code, files, payments, or sensitive-data workflows.

## Scope

**In scope**

- Organizer-defined short text, long text, single-select, and checkbox fields with an approved allow-listed non-sensitive purpose, label, required flag, order, and optional help text.
- Publish a versioned registration form and preserve answers against the exact field version shown.
- CSV export through F-404 with safe column names and values.

**Non-goals**

- Arbitrary HTML, scripts, formulas, file uploads, payments, medical/identity-document fields, branching logic, or a general form builder.
- Changing F-101 intake or rules-engine inputs.

## Dependencies and Baseline

- F-302 registration, F-404 export where available, and the F-701/F-702/F-703 gate.
- Approved field limits, prohibited-data policy, retention, and form-version contract.
- F-306 and F-307 cannot be enabled together for a form with required custom answers until an approved shared waitlist answer/form-version contract exists.
- Baseline at draft time: PRD, Roadmap, Design, and Phase 0–1.5 Architecture approved 2026-07-22; `ARCHITECTURE-FUTURE.md` approved as a planning target 2026-07-25; NYC ruleset `nyc.v2.7`, rules schema `popengine-rules/v2`, and scenario fixtures v5 where regulatory output is consumed.
- The approval PR must re-pin any baseline version that changes before approval. A proposed or superseded input blocks implementation.

## Inputs, Outputs, State, Validation, and Errors

- Inputs are bounded field definitions using an approved purpose key, a stable request identity on definition creation, the exact draft version each later draft change was composed against under F307-AC-07, and, on each write to an RSVP's custom answers, the exact answer-set version it was composed against plus a stable request identity under F307-AC-09; outputs are a versioned public form projection and validated answer set.
- Draft fields become active only on publish; each draft and active-form pointer is versioned, and changing an active definition creates a new version while preserving prior answers.
- Unknown field type/version, oversized text, invalid option, or omitted required answer rejects the submission without partial RSVP mutation.
- Missing or unresolved material data stays visibly unset, unknown, pending, or failed as appropriate; it never becomes a successful or complete result.
- Invalid input produces a field or action-specific error without partial mutation. Retriable external failures preserve the user's confirmed state and expose a safe retry.

## UI and Accessibility

- Builder and public form use programmatic labels/help/errors; organizer preview matches the published mobile form.
- The complete workflow is keyboard operable, uses programmatic labels and visible focus, does not encode status by color alone, and announces asynchronous success or failure.
- Empty, loading, permission-denied, validation, provider-failure, and unavailable states have explicit copy and a safe next action.

## System Impact

| Concern              | Proposed impact                                                                                                                               |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| API                  | Form definition/version and public answer operations require approved OpenAPI/JSON Schema contracts.                                          |
| Schema               | Forward migrations for versioned field definitions and answers; no executable expressions.                                                    |
| Jobs                 | None.                                                                                                                                         |
| Providers            | None.                                                                                                                                         |
| Privacy and security | Strict bounds/sanitization, prohibited-data warning, workspace scope, safe rendering/export, rate limits, and retention/deletion enforcement. |

Exact HTTP, JSON Schema, migration, job, and provider shapes belong in their reviewed machine contracts; this proposal does not authorize parallel local types or edits to merged migrations.

## Acceptance Criteria

1. **F307-AC-01:** Only the four approved field types and bounded label/help/option counts can be published.
2. **F307-AC-02:** A public submission compare-and-swaps the current active form version and validates required, length, and option membership atomically with RSVP; a retired version is rejected unless accompanied by an approved bounded server-issued in-flight grace token.
3. **F307-AC-03:** Publishing compare-and-swaps both the expected active-form version and exact reviewed draft version. A mismatch changes no active pointer and requires the organizer to rebase and review the draft; success creates one immutable new active version, while earlier answers remain readable against their original labels/options.
4. **F307-AC-04:** User text renders and exports as data, never HTML, script, formula, or engine input.
5. **F307-AC-05:** Only approved non-sensitive purpose keys and supported field types can be published; organizer-controlled labels, help text, and options are validated against the approved prohibited-data policy, and disallowed definitions are rejected. The form displays mandatory prohibited-data guidance and applies the approved retention/deletion policy; the feature does not claim to classify arbitrary attendee answers.
6. **F307-AC-06:** While an active form has required custom answers, F-306 waitlist join and promotion remain unavailable unless an approved shared contract pins the exact form/answer versions to the waitlist entry, validates them at join and promotion, and atomically links the validated answer set to the promoted RSVP. The system cannot silently drop required answers or create unapproved waitlist-answer storage.

7. **F307-AC-07:** Creating a draft field definition binds the request to a stable client-supplied request identity, committed with the definition under a uniqueness constraint scoped to the event's draft form. A retry presenting the same identity returns the original definition and adds no second field; a deliberately separate field sends a new identity. This is request identity, never content uniqueness: an organizer may legitimately define two fields carrying the same type, label, help text, options, required flag, and purpose key, so the definition may not serve as the key, and a repeated identity is never rejected as a duplicate value. Every later change to the draft names the exact draft version it was composed against and commits only by compare-and-swap on that version. That is every mutable part of the definition, not only its label: type, label, help text, required flag, order, options, purpose key, and the removal of a field are each composed against a named version on the same terms, and a stale change is rejected, mutates nothing, and returns the current draft for the organizer to reload and recompose against.

   AC-03 compare-and-swaps the reviewed draft version at publish, which stops a publish built from a draft the organizer did not review and cannot recover an edit already lost inside the draft. Without the comparison above, two organizers editing one draft from a single observed version both report success and the later write erases the earlier confirmed correction, so AC-03 publishes a draft that is perfectly current and silently missing it. Without the identity, a lost create response puts the same custom question on the public form twice, and AC-02 then validates two required answers against attendees who were shown one.

8. **F307-AC-08:** Public form submission is rate limited per event form and per originating client, and a submission over that limit is refused without creating an RSVP or storing any custom answer, and without disclosing form or attendee detail. This belongs in a criterion rather than only under Privacy and security because the submission surface is public and unauthenticated and an implementation is built to the acceptance criteria: AC-01 bounds what an organizer may publish and AC-02 validates one submission against the active form version, so neither bounds how many submissions an unauthenticated caller may make against that surface. The exact limit and window are not established by any approved artifact today; they belong to the field and retention policy named in the Approval Blockers, so until it names them this criterion is testable only as "a configured finite limit is enforced and submissions over it are refused," not against a specific number.

9. **F307-AC-09:** The custom-answer set held against one RSVP is a versioned aggregate, and every operation that writes it names the exact answer-set version it was composed against and commits only by compare-and-swap on that version, inside the same transaction as the RSVP write. That is every mutation of the aggregate, not only the public submission the review named: (a) a submission that creates the RSVP, which names the absent version and is rejected if an answer set already exists; (b) a submission that F-302's duplicate-contact rule resolves onto an existing RSVP, which names the version of the answer projection the submitter was shown; (c) the promotion of a waitlist entry under F307-AC-06, once its shared contract exists, which names the RSVP's current answer-set version alongside the pinned form and answer versions it links; and (d) the retention and deletion enforcement in F307-AC-05, which names the version it read so a deletion cannot silently remove an answer written after that deletion was decided. Publishing a new active version under F307-AC-03 and exporting through F-404 read this aggregate and never write it. A stale write mutates nothing, creates or modifies no RSVP, and returns an explicit conflict naming the current projection.

   Every one of those writes also binds a stable request identity, committed in the same transaction as the write it identifies under a uniqueness constraint scoped to the event's form, and a presented identity that is already committed is resolved from that record before the version comparison above and before F307-AC-08's rate-limit check, returning the original result and creating no second RSVP, answer set, promotion, or deletion. Resolving it first is the whole point: the comparison cannot tell a retry from a stale write, so case (a)'s retry after a lost response names the absent version that the first commit has already filled, is refused as a conflict, and leaves the attendee with no way to reach their own success. An attendee who cannot recover it retries under altered contact data, and F-302's duplicate-contact rule then has nothing to match, so one intended RSVP becomes two people. For the authorized operations, (c) promotion and (d) retention and deletion enforcement, the identity is supplied by the authenticated caller's request under the F-701/F-702/F-703 gate. For (a) and (b) it is supplied by the public client, because the surface is unauthenticated and no server-issued credential exists to derive it from.

   A client-supplied identity on an unauthenticated surface must not let one attendee claim another's submission, and two rules together are what hold that. The identity is an unguessable client-generated value, so it is not enumerable from anything an attacker knows about the event or its attendees. Beyond that, a presented identity that matches a committed submission whose contact identity differs from the one now presented is refused as a conflict: it commits nothing and returns nothing about the stored submission, so a guessed identity does not become a read of someone else's record. Where the presented identity and contact identity both match, the replay returns exactly the confirmation the original submission returned, which reports that the submission succeeded and reads back no stored answer or attendee detail. A successful claim therefore requires the attacker to already hold both the identity and the contact data they would be claiming, and to learn nothing from it that they did not supply, while F307-AC-08's rate limit bounds attempts to find that pair. Case (b) commits nothing today, so it has no committed identity to replay; its identity is committed only if and when F-302's duplicate-contact contract names a path that writes.

   The exact form and entropy of that client-supplied identity are not established by any approved artifact today. They belong to the OpenAPI idempotency contract and the field and retention policy named in the Approval Blockers, so until those name them this part of the criterion is testable only as "a committed unguessable client-supplied identity is required, a recognized replay returns the original result before the version and rate-limit checks, and a matching identity with a differing contact identity is refused without disclosure," not against a specific format, length, or lifetime.

   F307-AC-02 compares the active form version, which establishes only that both submitters were shown the same questions and says nothing about the answers already stored against them. Two public submissions that F-302-AC-03's duplicate-contact rule resolves onto one RSVP therefore both pass it, and the serialized later write erases the earlier answer set while both attendees are told their submission succeeded. F307-AC-07 protects the organizer's draft definition aggregate and does not reach attendee answers at all.

   Case (b) carries a limit this spec cannot remove on its own. F-302-AC-03 updates the existing RSVP on a duplicate contact, and a public submitter reaching that path is completing a fresh form and may never have been shown the stored answers, so there is no reviewed answer-set version for them to name. A submission that names no current answer-set version is a conflict by definition, not a write: it stores no answer, changes no RSVP, and returns the conflict with a safe next action. Who may then overwrite an existing attendee's answers, and through what authorized retry, is a property of the duplicate-contact rule owned by F-302 rather than of this feature, and no approved artifact establishes it today. Until F-302's duplicate-contact contract names that path, this criterion is testable only as "a submission resolving onto an existing RSVP without the current answer-set version is refused with a conflict and mutates nothing," not against a specific override or merge behavior.

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

- Start with the four native field types; add a type only through a Roadmap/spec change with privacy and export behavior.
- Rollback disables the new surface and workers/provider calls without deleting confirmed user data or rewriting immutable plans, rulesets, revisions, or history.

## Approval Blockers

- Approve the non-sensitive purpose allow-list, field/length/option limits, prohibited-data copy, versioning, and retention policy.
- Approve the shared F-306/F-307 waitlist answer/form-version contract before enabling both features together.
- Approve, in F-302's duplicate-contact rule, whether and how a later public submission may replace an existing RSVP's custom answers, which F307-AC-09 leaves as a conflict until it is named.
- Assign the owner and independent reviewer, approve this spec, and add it to `docs/BASELINE.md`.
