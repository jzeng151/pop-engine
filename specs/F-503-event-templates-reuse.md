# F-503 · Event Templates and Reuse

**Status:** PROPOSED (2026-07-26) — ready for review; not implementable until approved and listed in `docs/BASELINE.md`.

**Phase:** 3 · **Issue:** [#48](https://github.com/jzeng151/pop-engine/issues/48) · **Owner:** TBD · **Reviewer:** product owner plus affected architecture, contract, security, and lane owners (TBD) · **Approval date:** —

## Purpose and User Outcome

An organizer can start from a past event's confirmed inputs while PopEngine always evaluates the new event against the current approved ruleset.

## Scope

**In scope**

- Duplicate selected organizer-confirmed event inputs into a new Event's first immutable revision and require review of date/location/material unknowns.
- Record source event/template provenance and evaluate only a `complete` revision.
- Optionally save a reusable input template without findings or workflow records.

**Non-goals**

- Copying findings, verdicts, deadlines, applications, documents, contacts, RSVPs, check-ins, incidents, or financial actuals.
- Guaranteeing the new event has the same requirements.

## Dependencies and Baseline

- F-107 Event Revisions, F-201 current evaluation, and the F-701/F-702/F-703 gate. F-702 supplies the workspace membership boundary the source revision, the template, and the new Event resolve against and F-703 supplies the permission matrix `F503-AC-09` checks; F-701 supplies the authenticated actor both read from. All three are PROPOSED, so the gate is not an approved input today and this spec is not implementable against it until they are approved and listed in `docs/BASELINE.md`.
- Approved template field allow-list and current-ruleset selection contract.
- Baseline at draft time: PRD, Roadmap, Design, and Phase 0–1.5 Architecture approved 2026-07-22; `ARCHITECTURE-FUTURE.md` approved as a planning target 2026-07-25; NYC ruleset `nyc.v2.7`, rules schema `popengine-rules/v2`, and scenario fixtures v5 where regulatory output is consumed.
- Operand binding for client-supplied identities: `specs/F-411-staff-roles-credentialed-entry.md` F411-AC-08 states once, for this whole branch, that a client-supplied identity is committed with the operands that determine its recorded result and that a reuse carrying different operands is a conflict rather than a replay. Every identity criterion below relies on it. F-411 is PROPOSED, so that rule is not an approved input today and this spec is not implementable against it until F-411 is approved or the rule is promoted to an approved shared invariant; F411-AC-08 records both paths.
- The approval PR must re-pin any baseline version that changes before approval. A proposed or superseded input blocks implementation.

## Inputs, Outputs, State, Validation, and Errors

- Inputs are one authorized source revision/template, the new Event's stable metadata, and a stable creation-request identity; output is a new Event whose first immutable revision carries the copied answers and source provenance, normally `incomplete`.
- The copied answers are reviewed and corrected through ordinary F-107 saves; every changed save appends one immutable revision and advances the current pointer, and evaluation pins the current baseline ruleset, calendar, and the `complete` revision it ran against.
- Fields no longer present/compatible in the current intake registry are omitted and reported, never coerced.
- Missing or unresolved material data stays visibly unset, unknown, pending, or failed as appropriate; it never becomes a successful or complete result.
- Invalid input produces a field or action-specific error without partial mutation. Retriable external failures preserve the user's confirmed state and expose a safe retry.

## UI and Accessibility

- Review shows copied, omitted, changed-required, and unanswered fields before the revision that completes them is saved, and warns that requirements will be recalculated.
- The complete workflow is keyboard operable, uses programmatic labels and visible focus, does not encode status by color alone, and announces asynchronous success or failure.
- Empty, loading, permission-denied, validation, provider-failure, and unavailable states have explicit copy and a safe next action.

## System Impact

| Concern              | Proposed impact                                                                                                            |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| API                  | Duplicate/template/apply operations require approved OpenAPI contracts and concurrency behavior.                           |
| Schema               | Forward migration only for reusable template input snapshots/provenance if source-event duplication alone is insufficient. |
| Jobs                 | None.                                                                                                                      |
| Providers            | None.                                                                                                                      |
| Privacy and security | Workspace scope and allow-listed input copy; no private documents/contact data leak into a new event.                      |

Exact HTTP, JSON Schema, migration, job, and provider shapes belong in their reviewed machine contracts; this proposal does not authorize parallel local types or edits to merged migrations.

## Acceptance Criteria

1. **F503-AC-01:** Creating from a past event copies only the approved organizer-input allow-list into the first immutable revision of a new stable Event identity. The creation request binds its stable client-supplied request identity to that Event and original revision result, committed under a uniqueness constraint scoped to the workspace the new Event is created in; a recognized lost-response retry returns the same result without another Event, while deliberate repeated duplication uses a new request identity. The request also supplies the new Event's stable metadata, at minimum the organizer-facing name, and creation is rejected without it. That metadata is not copied from the source and is not carried by the allow-list: `docs/EVENT-REVISION-CONTRACT.md:59-65` keeps the organizer-facing name outside `answers_json` as stable Event metadata, while `apps/api/migrations/001_initial_schema.ts:18` requires `events.name` at insertion, so a creation contract naming only a source revision and a request identity would leave an implementer to copy an unpinned source name, invent a default, or solicit a value this spec never declared. The actor must be authorized to read the source revision or template in the same workspace as the new Event; a source outside that workspace is rejected without disclosing whether it exists. Added 2026-08-04. That identity binds its operands under the rule `F411-AC-08` states once for every client-supplied identity on this branch: it is committed together with the request fields that determine the recorded result, including every aggregate, version, and generation the request names, and a later request presenting the same identity with any different operand is refused as a conflict rather than being answered with the stored result. The identity is still the key and the operands are only a precondition on reusing it, so this is not the content uniqueness this criterion already forbids.
2. **F503-AC-02:** No finding, verdict, deadline, application, file, contact, RSVP, check-in, incident, or outcome record is copied.
3. **F503-AC-03:** Removed/incompatible registry fields are omitted with an explicit review warning, not mapped by guess.
4. **F503-AC-04:** Each changed save appends exactly one immutable revision and advances the current pointer; when the appended revision is `complete`, it is evaluated with the then-current approved ruleset/calendar and the exact artifact version is stored. No separate submission transition exists and no mutable draft holds the answers.
5. **F503-AC-05:** Changing the source event after duplication cannot mutate the new Event's revisions or its later plan.
6. **F503-AC-06:** Date-, exact-event-, and document-specific answers are reset even if otherwise allow-listed, including `venue_license_covers_event_area`, `venue_paco_covers_exact_event`, and `venue_fdny_pa_permit_current_for_event_space`; the review shows them unanswered and requires new-event confirmation before a revision can be `complete` and evaluated. While any Phase 1 reader still uses the `events` compatibility projections, this reset cannot produce the first revision: `event_date` is among the reset date-specific answers and migration 001 keeps that projection `NOT NULL`, so an incomplete first revision would force the implementation either to fail every duplication or to retain or invent a date the revision does not contain, which F107-AC-08 and `docs/EVENT-REVISION-CONTRACT.md` forbid. Until the last legacy reader has atomically cut over, creation therefore requires every legacy-required projection to be answered for the new event before the first revision is appended; the incomplete-creation path above activates with that cutover. Added 2026-08-03.
7. **F503-AC-07:** A template is created from one named source event revision by an actor authorized to read that revision, and it stores an organizer-facing name plus exactly the AC-01 allow-list with the AC-06 resets already applied, so a template can never carry a date-, exact-event-, or document-specific answer. It carries nothing AC-02 excludes. Creation binds a stable client-supplied request identity, committed under a uniqueness constraint scoped to the workspace the template belongs to, and a recognized lost-response retry returns the original template rather than creating a second one. A template belongs to the workspace of its source revision; only members of that workspace can list, read, use, or change it, and a request naming a template outside the actor's workspace is rejected without disclosing whether it exists. That identity binds its operands under the rule `F411-AC-08` states once for every client-supplied identity on this branch: it is committed together with the request fields that determine the recorded result, including every aggregate, version, and generation the request names, and a later request presenting the same identity with any different operand is refused as a conflict rather than being answered with the stored result. The identity is still the key and the operands are only a precondition on reusing it, so this is not the content uniqueness this criterion already forbids.
8. **F503-AC-08:** A template is immutable once created. Editing it appends a new template version from the same allow-list and compare-and-swaps the current-template pointer against the version the editor was shown; a stale version rejects the whole write, appends nothing, and returns the current version to reload against. Archiving sets the template out of selection while preserving every version and the provenance of Events already created from it, and it deletes nothing. Creating an Event from an archived template, or from a version that is no longer current, is rejected with the current version named, so AC-01 never duplicates from a template the organizer cannot see in selection.

   Archiving and editing both advance the same template state and version pointer, and creating an Event from a template names the exact template state and version the organizer was shown and compare-and-swaps that pointer inside the creation transaction, before the new Event and its first revision commit. Archiving and creation therefore compete on one value: whichever commits first advances it, and the other reads a stale state or version and rejects the whole write, appending no Event and no revision and returning the current state to reload against. Without that, both succeed, because creation reads version V as selectable, the archive commits, and creation then still commits from the now-archived V, which is exactly the rejection this criterion promises. The transitions that write the template aggregate are exactly creation under AC-07, edit, and archive; each names the state and version it read and compare-and-swaps it, and creating an Event is a reader that compares the same pointer rather than a fourth writer of it. Archive is terminal for selection: no approved artifact establishes an unarchive path, so returning an archived template to selection is a new transition that belongs in this criterion if the approval wants one, not an unstated reading of archive. Events already created keep their provenance to the exact template version they used, and archiving never rewrites it.

   The earlier round on these two criteria established that a template is immutable, that edits append a version, and that the edit compare-and-swaps the pointer the editor was shown. It left every other operation on that pointer unfenced: archiving changed selectability with no version to compete on, and Event creation read the template outside the transaction that used it. Fencing the edit alone bounds concurrent editors against each other and nothing else, so the rule stated here covers the whole set of writers and the one reader whose decision depends on them.

   AC-01 admits a template as a duplication source and the scope offers saving one, and until these two criteria existed nothing said how a template came to exist, who could use it, how it changed, or what it was allowed to hold. Because implementation is bound to the acceptance criteria, every criterion could pass with no template path built at all, or with one that copied the answers AC-06 resets and quietly reintroduced a prior event's date into a new one. The version and archive rules are the same immutable-append-plus-compare-and-swap shape AC-04 applies to revisions, so a template does not become the mutable holder of answers that F107-AC-08 and AC-04 both refuse.

9. **F503-AC-09:** Every operation this feature defines names the source revision, template, or Event it acts on and the workspace that owns it, and is admitted only by the acting actor's current F-702 membership of that workspace together with the F-703 permission approved for the action, both re-read server-side from stored membership and role at the moment of the operation and, for a write, inside the same transaction that commits it. `F503-AC-01`'s requirement that the actor be authorized to read the source revision or template in the same workspace as the new Event, and `F503-AC-07`'s rule that only members of the owning workspace can list, read, use, or change a template, remain the scope statements for their legs; this criterion supplies the terms on which that authority is established and re-read. That covers creating an Event from a source event or template under `F503-AC-01`, checked inside the transaction that commits the new Event and its first revision; every revision save on the new Event under `F503-AC-04`; template creation under `F503-AC-07`; listing, reading, and using a template under `F503-AC-07`; template edit, versioning, and archive under `F503-AC-08`, which states no authorization requirement of its own; and the template read that Event creation compare-and-swaps inside its transaction under `F503-AC-08`. A request failing the check is refused before any durable write and before any allow-listed answer, template content, provenance record, or version is disclosed, and its response does not distinguish a source revision, template, or Event that does not exist from one the actor may not see. The check is at the operation and not at session start or workspace switch, so authority removed while a request is in flight causes that request to fail rather than commit.

   Without this criterion the other eight pass for a caller who names another workspace's aggregate wherever their own scope fragments do not reach. AC-01 and AC-07 bind the source read and the template surface as scope statements but say nothing about when or where the actor's authority is read, AC-04's revision saves, AC-08's edit, versioning, and archive transitions, and the template read inside the creation transaction name no actor at all, and AC-02 through AC-06 fix what is copied, omitted, reset, and evaluated without asking who asked. The surface that set leaves open reads another workspace's allow-listed answers through a template, appends revisions to an Event the actor cannot see, and advances or archives a template pointer whose organizers were never consulted.

   One input this criterion needs is not established by any approved artifact today and is not invented here. F-703 is PROPOSED and names no role set, so the permission above cannot be named. Until F-703 is approved this criterion is testable only as "every duplication, revision save, template creation, list, read, use, edit, version, and archive is refused unless the acting actor holds an active membership of the workspace that owns the named source revision, template, or Event, read server-side at that operation, and a refusal discloses nothing about whether that aggregate exists", not against a named role or permission identifier. Naming the duplication, revision-save, and template permissions with F-703 is an approval blocker below.

## Fixtures and Verification

- Planned automated fixture IDs are the acceptance IDs above; each must map one-to-one to a runnable test before approval can claim implementation readiness.
- F503-AC-08 includes a concurrent archive-versus-creation fixture proving exactly one commits, and that a creation reviewed against version V before the archive appends no Event and no revision.
- F503-AC-09 includes a fixture in which an actor holding no membership of the owning workspace names a valid source revision, template, and Event and is refused at duplication, at every revision save, and at template creation, list, read, use, edit, versioning, and archive, with a response that does not distinguish absence from denial, and a fixture in which authority removed while a duplication or template edit is in flight fails that request rather than committing.
- Regulatory fixtures: Duplicate each approved scenario input, change date where needed, and verify output through the current full engine suite rather than copied expectations.
- Security-sensitive and cross-workspace paths require negative authorization tests; provider paths require success, duplicate-delivery, retry, invalid-signature, and permanent-failure tests where applicable.

## Allowed Footprint and Coordination

- `apps/web` and `apps/api` feature code and tests.
- New ordered forward migrations and approved OpenAPI/JSON Schema changes required by this feature.
- No repository restructuring, speculative package, or unrelated feature edit.
- Shared contracts, migrations, provider adapters, engine/rules artifacts, consent policy, and cross-lane UI primitives require the approvals named in `docs/DOCUMENTATION-GOVERNANCE.md` §6.

## Rollout and Fallback

- Start with duplicate-from-event; add named reusable templates only if repeated use demonstrates the need.
- Rollback disables the new surface and workers/provider calls without deleting confirmed user data or rewriting immutable plans, rulesets, revisions, or history.

## Approval Blockers

- Approve copy allow-list, incompatible-field behavior, current-artifact selection, and template retention.
- Approve F-701, F-702, and F-703, and name with F-703 the duplication, revision-save, and template permissions `F503-AC-09` checks. That criterion checks a permission no approved artifact defines today and may not invent one, so until the matrix names them it is testable only at the membership level stated there.
- Assign the owner and independent reviewer, approve this spec, and add it to `docs/BASELINE.md`.
