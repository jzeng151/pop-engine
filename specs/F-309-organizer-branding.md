# F-309 · Organizer Branding

**Status:** PROPOSED (2026-07-26) — ready for review; not implementable until approved and listed in `docs/BASELINE.md`.

**Phase:** 3 · **Issue:** [#38](https://github.com/jzeng151/pop-engine/issues/38) · **Owner:** TBD · **Reviewer:** product owner plus affected architecture, contract, security, and lane owners (TBD) · **Approval date:** —

## Purpose and User Outcome

An organizer can apply limited, accessible branding to the public event page without injecting code or obscuring PopEngine's required status and consent UI.

## Scope

**In scope**

- One optional logo and one accent color applied to approved public-page elements.
- Preview, validate, publish, reset, and preserve readable fallback styling.
- Keep PopEngine attribution, required consent copy, errors, and regulatory/status messaging unchanged.

**Non-goals**

- Themes, custom fonts, arbitrary CSS/HTML/JavaScript, layout editing, white-labeling, or per-block styling.
- Branding check-in or authenticated admin surfaces.

## Dependencies and Baseline

- F-301 public page, F-209/F-211 upload safety where reused, and the F-701/F-702/F-703 gate.
- Approved logo dimensions/file types and contrast rules.
- Baseline at draft time: PRD, Roadmap, Design, and Phase 0–1.5 Architecture approved 2026-07-22; `ARCHITECTURE-FUTURE.md` approved as a planning target 2026-07-25; NYC ruleset `nyc.v2.7`, rules schema `popengine-rules/v2`, and scenario fixtures v5 where regulatory output is consumed.
- The approval PR must re-pin any baseline version that changes before approval. A proposed or superseded input blocks implementation.

## Inputs, Outputs, State, Validation, and Errors

- Inputs are a safe logo file and accent color, plus a stable client-supplied request identity on every upload, publish, replacement, and reset under F309-AC-05; output is a validated brand setting on one public page.
- Asset and published-brand states and every transition between them are enumerated in F309-AC-08; invalid/unsafe assets never become public.
- The server computes accessible foreground/fallback treatment rather than accepting arbitrary style input.
- Missing or unresolved material data stays visibly unset, unknown, pending, or failed as appropriate; it never becomes a successful or complete result.
- Invalid input produces a field or action-specific error without partial mutation. Retriable external failures preserve the user's confirmed state and expose a safe retry.

## UI and Accessibility

- Preview covers normal, focus, error, disabled, and high-contrast states; required content remains in reading order.
- The complete workflow is keyboard operable, uses programmatic labels and visible focus, does not encode status by color alone, and announces asynchronous success or failure.
- Empty, loading, permission-denied, validation, provider-failure, and unavailable states have explicit copy and a safe next action.

## System Impact

| Concern              | Proposed impact                                                                                                                                              |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| API                  | Brand settings and controlled logo upload require approved OpenAPI contracts.                                                                                |
| Schema               | Forward migration for minimal brand settings and a private approved logo-asset reference.                                                                    |
| Jobs                 | File scanning/normalization only if required by the upload ADR.                                                                                              |
| Providers            | Private storage/scanning adapter.                                                                                                                            |
| Privacy and security | Validate file signatures, strip active metadata/content, prohibit SVG script risk unless sanitized policy explicitly approves it, and prevent CSS injection. |

Exact HTTP, JSON Schema, migration, job, and provider shapes belong in their reviewed machine contracts; this proposal does not authorize parallel local types or edits to merged migrations.

## Acceptance Criteria

1. **F309-AC-01:** Only one approved logo asset and one valid accent color can affect the public event page.
2. **F309-AC-02:** Published branding meets approved contrast/focus requirements or falls back to the default design.
3. **F309-AC-03:** Organizer input cannot inject HTML, script, CSS, external font, tracking pixel, or arbitrary URL.
4. **F309-AC-04:** Consent copy, status labels, errors, PopEngine attribution, and page structure remain unchanged.
5. **F309-AC-05:** Every upload that stores logo bytes, the initial one included, binds a stable client-supplied request identity committed with the draft asset it creates, under a uniqueness constraint scoped to the event; a retry presenting that identity returns the original draft asset and stores no second copy, repeating no scan or normalization work, while a deliberate second upload sends a new identity. The initial upload is named here from 2026-08-04 because it was the one operation on this aggregate without an identity: F309-AC-07 validates the incoming bytes but does not identify the operation, so a lost response after the first upload commits leaves a second private asset and an ambiguous reviewed version for the publish below to name. Publish and reset each name the exact current published-brand version they were reviewed against, together with, for publish, the reviewed draft asset version, plus a stable request identity, and compare-and-swap that brand version inside the transaction that changes it. A concurrent publish and reset therefore produce one success and one rejection, so a draft reviewed before the reset cannot restore the logo and accent after the organizer was told reset succeeded; the rejected actor reloads and re-reviews. Reset removes branding and restores the default page without changing event/RSVP data. F309-AC-08 enumerates every state and transition of this aggregate and is the authority on which operations write published branding; this criterion states the identity and version each of them binds.
6. **F309-AC-06:** The logo remains in private storage; public rendering issues only a short-lived signed URL for the currently published asset. Reset or replacement stops issuing URLs for the prior asset, and any already issued URL has only its disclosed bounded validity until expiry.
7. **F309-AC-07:** The initial logo upload and every replacement are rejected before the file is stored, previewed, or published unless its type, determined from the file's own bytes rather than a client-supplied filename or declared content type, is on the approved logo type list and its byte size and pixel dimensions are within the approved limits. A rejection creates no asset record, leaves the current published branding unchanged, and names the failing constraint to the organizer. This belongs in a criterion rather than only under Privacy and security because an implementation is built to the acceptance criteria, and AC-01 through AC-06 all pass for an oversized or disallowed file: AC-01 only calls the asset approved, AC-03 covers injection, and AC-06 covers private delivery, so nothing else makes the repository-wide file rule in `AGENTS.md` ("Files: private storage, type/size limits, short-lived signed URLs only") reach the upload path. The type list, maximum byte size, and dimension limits are not established by any approved artifact today. Dependencies names approved logo dimensions and file types as an input this spec does not own, and the Approval Blockers name the asset policy, so until that policy is approved this criterion is testable only as "a configured finite type allow-list and finite size and dimension limits are enforced against the file's verified bytes, and a file outside them is rejected," not against a specific list or number.

8. **F309-AC-08:** The branding aggregate has exactly the states and transitions in the two tables below, and no operation outside this table changes a branding asset or the published brand. A branding asset is in exactly one of `absent` (no record), `draft` (validated bytes in private storage, reachable only from the organizer's own preview), `published` (the one asset the public page renders), `superseded` (a later asset took its place in the same slot), or `withdrawn` (it was published and reset removed branding). The published brand is in exactly one of `unbranded` (no `published` asset and no accent color; the page renders the default design) or `branded` (at least one published branding element, meaning one `published` asset, one valid accent color, or one of each). The two are disjoint and exhaustive over the branding elements the Scope defines, and `branded` covers all three combinations the Scope permits, because the Scope calls the logo optional: logo only, accent only, and logo with accent. Never more than one published asset and never more than one accent, per F309-AC-01. Every transition names the version it read, and the transaction that performs it compare-and-swaps that version.

   | ID   | Transition                                       | Asset state change                                                          | Published brand              | Publish action | Version named and compare-and-swapped in the transaction                             |
   | ---- | ------------------------------------------------ | --------------------------------------------------------------------------- | ---------------------------- | -------------- | ------------------------------------------------------------------------------------ |
   | T-01 | Upload composed against an empty draft slot      | new asset `absent` → `draft`                                                | unchanged                    | no, draft-only | draft-slot version, asserted empty at the version read, plus the F309-AC-05 request identity |
   | T-02 | Upload composed against an occupied draft slot   | new asset `absent` → `draft`; the prior `draft` → `superseded`              | unchanged                    | no, draft-only | draft-slot version read, plus the request identity; reads and writes no published-brand version |
   | T-03 | Upload rejected by F309-AC-07                    | none, remains `absent`                                                      | unchanged                    | no             | none read, none written, no record created                                            |
   | T-04 | Upload replayed on a committed request identity  | none; the original `draft` is returned                                      | unchanged                    | no             | request identity only                                                                 |
   | T-05 | Publish a named draft, with or without an accent | that `draft` → `published`; the prior `published` asset, if any, → `superseded` | `unbranded` → `branded`, or `branded` → `branded` on the new asset and the accent as supplied | yes | published-brand version and the reviewed draft asset version, plus the request identity |
   | T-06 | Reset                                            | the `published` asset, if any, → `withdrawn`; assets in `draft` are untouched | `branded` → `unbranded` whichever elements were published, or `unbranded` → `unbranded` with nothing to withdraw | yes | published-brand version, plus the request identity                        |
   | T-07 | Publish or reset replayed on a committed request identity | none; the original result is returned                               | unchanged                    | yes, the original one | request identity only                                                          |
   | T-08 | Publish or reset presenting a stale published-brand version | none                                                             | unchanged                    | rejected       | published-brand version, compared and rejected before any write                       |
   | T-09 | Publish an accent, naming no new draft           | none; a `published` asset, if any, stays published                          | `unbranded` → `branded` on that accent alone, or `branded` → `branded` on the new accent with any published asset unchanged | yes | published-brand version, plus the request identity                                     |

   | Published-brand state | Public page renders                                        | Signed URLs issued under F309-AC-06         |
   | --------------------- | ---------------------------------------------------------- | ------------------------------------------- |
   | `unbranded`           | default design, no organizer logo or accent                | none                                        |
   | `branded`, accent only | default design with the published accent applied to the approved accent points, subject to F309-AC-02 fallback | none; there is no published asset |
   | `branded`, logo only  | default design with the one `published` asset, subject to F309-AC-02 fallback | only for the `published` asset |
   | `branded`, logo and accent | the one `published` asset and its accent, subject to F309-AC-02 fallback | only for the `published` asset |

   T-05, T-06, and T-09 are the only transitions that write the published brand, so every other transition leaves the public page exactly as it was. An organizer who uploads a replacement to review it takes T-02, which creates a draft and changes nothing public, so the replacement reaches the live page only when the organizer separately publishes it under T-05. Only an asset in `draft` is publishable: `superseded` and `withdrawn` are terminal, and returning to a withdrawn or superseded asset requires a new upload, because no approved artifact establishes a republish-without-reupload path. If the asset policy named in the Approval Blockers wants one, it is a new transition in this table, not an unstated reading of T-05. The accent color is part of the published brand and changes only through T-05, T-06, and T-09.

   Upload is gated on the version of the draft slot the organizer composed against, never on whether a reset has happened. That distinction is what separates the stale in-flight upload from the deliberate one. An upload composed against a draft slot that has since changed names a version that no longer matches and is rejected under the compare-and-swap this criterion requires of every transition, and even an upload that does commit holds no published-brand version and writes no published state, so it cannot restore a logo the organizer has already reset away; an in-flight publish reviewed before the reset is a T-08 rejection, not a restore. Because a `withdrawn` or `superseded` record leaves the draft slot empty, an organizer whose only asset was withdrawn by T-06 uploads again under T-01 and publishes under T-05. Reading T-01 as "no asset record exists at all" and T-02 as "a draft or published asset exists" left that ordinary path unlisted, and AC-08 forbids what it does not list, so the common reset-then-rebrand sequence was closed by a rule aimed at a different problem.

   Reset is likewise defined by the state it leaves rather than the state it found. A reset issued while the published brand is already `unbranded` withdraws no asset and leaves the default page, and it is a listed transition rather than an error because the organizer's intent is already satisfied and refusing it would fail a normal action after a co-organizer reset first. T-09 exists for the same reason: the accent color is part of the published brand, so an organizer who keeps the current logo and changes only the accent has no draft asset to name and T-05 would refuse a change the Scope allows.

   Every legal starting point and every legal end point the Scope permits is therefore reachable in this table, which was the defect found on 2026-08-04 and is why the whole table was re-read state by state rather than the one reported combination being added. An organizer who never uploads a logo starts `unbranded` and reaches `branded` by T-09, publishing an accent alone; the previous definition of `branded` as exactly one `published` asset together with one valid accent left that organizer no representable state at all, and T-09's restriction to a brand that was already `branded` left them no transition to reach one either, so an advertised part of the feature was unreachable in both directions. An organizer who wants a logo and no accent starts `unbranded` and reaches `branded` by T-05 with no accent supplied. An organizer who wants both takes either order: T-05 then T-09, or T-09 then T-05. Every one of those end states returns to `unbranded` by T-06, so no branded shape is a trap. `branded` is defined as at least one published element rather than as a fixed pair because the In-scope line calls the logo optional, and a state machine narrower than its own spec's declared scope forbids a legal operation, which is the same class of defect as one that permits an unsafe operation.

   Two operations remain outside this table, and both are named rather than left to be inferred. First, element-wise removal: withdrawing the logo while keeping the accent, and clearing the accent while keeping the logo, are not transitions here, because the only removal the Scope names is reset, which removes branding entirely. An organizer who wants either today resets and republishes what they want to keep. If the asset policy wants element-wise removal, it is a new transition in this table with its own version comparison, not an unstated reading of T-05, T-06, or T-09. Second, the accent application points: which approved public-page elements an accent may reach is not established by any approved artifact, and the Approval Blockers name it. That decision bounds where an accent renders in every `branded` shape above, including the accent-only one; it does not decide whether an accent-only brand exists, which the Scope already decides. Until it is recorded, the accent-only row is testable only as "the default design renders with the published accent applied to the configured accent points and no logo," not against a named element list.

   This table is stated as a criterion rather than left to the prose in Inputs, Outputs, State, Validation, and Errors because each of the findings this criterion answers came from one transition being pinned while its siblings were not: the stale-publish-after-reset race pinned T-05 against T-06 but named no version for uploads, F309-AC-07 pinned validation on T-01 and T-02 but not their effect on published state, and the enumeration in F309-AC-05 counted a replacement upload among the operations that change published branding, which contradicts the same criterion's requirement that every upload commit a draft asset. The withdrawn-only gap found on 2026-08-04 is the same failure pointed the other way: T-01 and T-02 were written against which asset records happened to exist instead of the version they compare and swap, and a state machine that forbids a normal action is as much a defect as one that permits an unsafe one. Enumerating the states and transitions together is what makes the next unlisted operation visibly missing rather than silently permitted.

## Fixtures and Verification

- Planned automated fixture IDs are the acceptance IDs above; each must map one-to-one to a runnable test before approval can claim implementation readiness.
- F309-AC-08 includes one fixture per transition in its table, plus one per published-brand row: an accent-only publish from `unbranded` reaches `branded` and issues no signed URL, a logo-only publish reaches `branded` with no accent, and a reset from each of the three `branded` shapes reaches `unbranded`.
- Regulatory fixtures: none; this feature does not define regulatory ground truth.
- Security-sensitive and cross-workspace paths require negative authorization tests; provider paths require success, duplicate-delivery, retry, invalid-signature, and permanent-failure tests where applicable.

## Allowed Footprint and Coordination

- `apps/web` and `apps/api` feature code and tests.
- New ordered forward migrations and approved OpenAPI/JSON Schema changes required by this feature.
- No repository restructuring, speculative package, or unrelated feature edit.
- Shared contracts, migrations, provider adapters, engine/rules artifacts, consent policy, and cross-lane UI primitives require the approvals named in `docs/DOCUMENTATION-GOVERNANCE.md` §6.

## Rollout and Fallback

- Default styling remains the fallback for missing, invalid, unsafe, or removed branding.
- Rollback disables the new surface and workers/provider calls without deleting confirmed user data or rewriting immutable plans, rulesets, revisions, or history.

## Approval Blockers

- Approve asset policy, accent application points, contrast thresholds, and attribution requirements.
- Assign the owner and independent reviewer, approve this spec, and add it to `docs/BASELINE.md`.
