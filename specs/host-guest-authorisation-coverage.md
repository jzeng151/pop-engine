# Venue Assembly-Approval Coverage

**Status:** PROPOSED (2026-07-28; Approval Blocker 13 resolved 2026-07-28 by the product owner as route 1, venue-neutral output, recorded on PR #171. Still PROPOSED: that decision settles what the feature says, not whether it can be published, and Approval Blocker 5 is the one that governs publication.) · **Reviewer/approver:** unassigned · **Owner:** unassigned — **both are Approval Blocker 21, a PREREQUISITE**, because only tagged entries gate approval and an untagged note here would let this spec reach APPROVED with the lane unowned · not in `docs/BASELINE.md` and must not be added there while this is PROPOSED.
**Phase:** post-MVP · **Lane:** Dev 1 (engine) + Dev 4 (verification), pending assignment · **Depends on:** F-101 (intake registry), F-201 (plan generation), F-102 (verdict and branch tables) · **Feeds:** nothing yet.
**NO F-ID IS ASSIGNED, and the filename says so deliberately.** `F-1NN` below is a placeholder, not
an assignment: the Stage 1 range is saturated and the id is an approval blocker. Every acceptance
criterion is keyed `F-1NN-AC-0N` and every one of those ids changes when the real id lands.

The file is **not** named `specs/F-...md`, and that is forced rather than chosen. `docs/BASELINE.md`
marks the glob `specs/F-*.md` APPROVED, so a file matching it must self-declare APPROVED or
`pnpm check:baseline` fails. A PROPOSED spec therefore cannot sit under the `F-` prefix while that
row stands, and adding a manifest row is not this document's to do. Recorded as an approval blocker
rather than worked around silently.

## Purpose and User Outcome

An event held in a private venue at 75 or more people meets the published gate for a temporary
place-of-assembly filing, and the intake asks whether the venue already holds a place-of-assembly
approval. The organizer needs to know **what that answer settles about this event's own filing**,
which on the published sources is: it does not settle it.

As an organizer of an event in a private venue, I answer whether the venue holds an assembly approval,
and the plan declines to treat that answer as settling my filing, without ever telling me I am covered
because the venue is.

## The output is venue-neutral, and that is a decision rather than a framing choice

**Approval Blocker 13 is RESOLVED: route 1, venue-neutral output.** Product owner, 2026-07-28,
recorded on PR #171 (`https://github.com/jzeng151/pop-engine/pull/171#issuecomment-5107886102`), which
is where the decision and its grounds live rather than here.

Earlier revisions of this document were written around a host and a guest: a travelling operator
renting space inside another business's premises. **The intake cannot express that relationship.** None
of the 33 published intake fields names a host, a renter, a tenant or an operator distinct from the
venue, and a trigger cannot read a descriptive field, because `validateRuleset` rejects a trigger
naming a field the registry does not declare. So the proposed triggers fire on `location_type`,
`headcount` and the venue's answer alone, and an event run by the venue's own operator matches all
three. The relationship vocabulary was this document's addition; the registry's vocabulary is
venue-shaped throughout, in the field's own name.

Route 2, adding a relationship discriminator, is **rejected rather than deferred**, and the
load-bearing ground is on the PR comment: `DOB-ASSEMBLY-001` records the effect of an existing approval
as not published in either direction, so knowing there is a host would not change what the product may
say.

**What this decision does NOT resolve, stated here because a resolved blocker invites the assumption
that the rest went with it.** Approval Blocker 5 stands: the `RESEARCH_REQUIRED` status and the
loader's source requirement are still in conflict, still blocked on the product owner, and neither
route unblocks publication. The F-id is still unassigned and the absorption into F-108 is still a
proposal. And **route 1 narrows what the feature SAYS, not what publishing it costs**: every coupling,
count, sweep category and approval route derived in rounds 3 to 8 stands unchanged, with one exception
recorded under the derived-test rows, where a conditional that depended on this decision now resolves.

## Scope

In scope: **one** field, `venue_has_assembly_approval`. It is the only field this feature touches that
is both collected-but-unread and an authorisation the VENUE reports holding rather than a claim the
organizer makes about their own event. Who operates the venue is not in the field and not in the
registry, per the section above. The first draft claimed two fields; see non-goal 3.

### Non-goals

1. **NEVER TELLING AN ORGANIZER THEY ARE COVERED BY THE VENUE'S APPROVAL.** This is the spec's central
   constraint, not a caveat. `packages/engine/src/ruleset.ts`, in the `UNCONSUMED_INTAKE_FIELDS`
   note for `venue_has_assembly_approval`, records the reason:

   > "AC 28-117.1.3 requires an amendment for any change inconsistent with the venue's certificate,
   > so an existing approval narrows the question rather than settling it."

   **THIS SPEC ASSERTS NOTHING ABOUT WHAT THE APPROVAL DOES**, and the sentence that used to sit here
   did. It said the approval reduces what must be established, which is an affirmative claim about
   effect, and DOB-ASSEMBLY-001's verification block records that whether a temporary filing is
   required at all at a venue already holding a certificate "is NOT PUBLISHED in either direction".
   Reduces, removes and does nothing are three claims and no source licenses any of them, so no
   acceptance criterion, copy string or rule output may state one. Any output that reads a `yes` as
   the operator's own answer, or as any change to the operator's obligation, is wrong by construction
   and must fail review.

   The quoted note above is the repository's record of WHY the question is open, and it is quoted
   rather than adopted: its "narrows the question" is itself stronger than DOB-ASSEMBLY-001's
   verification block licenses. Nothing carries it forward, because the entry containing it is the one
   this feature deletes.
2. **Not alcohol.** Already solved and out of scope. `SLA-VENUE-LICENSE-001`, `SLA-ONEDAY-001` and
   `SLA-CATERING-001` each read `venue_license_covers_event_area` in their published triggers, so
   the venue-approval question for alcohol is answered by the shipped ruleset. This spec must not
   restate, duplicate or re-derive it.
3. **NOT `food_affinity_private_exception_claimed`. It is not an authorisation the venue reports at
   all**, and the first draft of this spec wrongly placed it under the same semantics. Its published
   `asked_when` is `food_present AND event_open_to_public != yes`, **with no venue term**, so it is
   in scope for a street or park event as readily as a private venue. `UNCONSUMED_INTAKE_FIELDS`
   defines it as the organizer's own claim: "Collected for the Health Code Art. 88 private-function
   exemption, which DOHMH-EXEMPTION-001 renders as an advisory on event_open_to_public alone."

   An exception the ORGANIZER claims about their own event is not an authorisation the VENUE reports
   holding. Applying the semantics below to it would have told a park organizer that a venue
   authorisation reduced their obligation, which is precisely the false statement the non-goal above
   exists to make impossible, produced by this spec. Specifying its distinct exception semantics would need
   regulatory research this repository has not done, so it is removed from the feature rather than
   carried with the wrong semantics.
4. **Not multi-city.** An operator that travels between jurisdictions is F-207 · Multi-Jurisdiction
   Rules Architecture. This spec is single-jurisdiction and assumes the published NYC ruleset.
5. **Not new regulatory research.** This spec asserts no permit fact. Everything regulatory below is
   quoted from something already in the repository with its location, or is marked as requiring
   verification research and left unestablished.
6. **Not a new intake field.** The registry already collects what this needs. Adding a field is out
   of scope and would enlarge the blast radius described under System Impact.

## Dependencies and Baseline

Baseline artifacts this builds on, all APPROVED per `docs/BASELINE.md`:

| Artifact | What this depends on it for |
| --- | --- |
| `rules/nyc-rules.v2.8.json` | `venue_has_assembly_approval` and its gate, plus the three SLA rules that already consume `venue_license_covers_event_area` |
| `specs/F-101-event-intake.md` | the intake registry and `asked_when` scoping |
| `specs/F-201-permit-plan-generator.md` | plan generation and AC 4's named-confirmation model |
| `specs/F-102-feasibility-verdict.md` | verdict states and the branch table |

Published fields this uses, quoted from `rules/nyc-rules.v2.8.json` as declared:

| Field | Type and values | `asked_when` | Consumed today |
| --- | --- | --- | --- |
| `location_type` | enum, includes `private_venue` | always asked | yes, by many triggers |
| `venue_license_covers_event_area` | enum `yes`/`no`/`unknown` | `alcohol AND location_type = private_venue` | **yes**, by the three SLA rules |
| `venue_has_assembly_approval` | enum `yes`/`no`/`unknown` | `location_type = private_venue AND headcount gte 75` | **no** |
| `food_affinity_private_exception_claimed` | enum `yes`/`no`/`unknown` | `food_present AND event_open_to_public != yes` | **no** |

**`venue_has_assembly_approval` alone is the subject of this spec.** The row above it is already
consumed; the row below it is not an authorisation the venue reports and is out of the feature per
non-goal 3.
`venue_has_assembly_approval` is recorded in `UNCONSUMED_INTAKE_FIELDS` in
`packages/engine/src/ruleset.ts`, which is the mechanism that keeps a collected-but-unread field
visible rather than silent. That entry, and only that entry, is removed by this feature.

## Inputs

No new inputs. **One field**, `venue_has_assembly_approval`, as `validateIntake` already accepts it. The other two rows in the table above are context, not inputs to this feature.

## Outputs

**Swept for affirmative claims about what the answer does, which is the third round one has survived.**
Round 2 removed NARROWED, round 4 removed OPEN and UNRESOLVED, and round 7 found three statements left
behind by those two removals: the non-goal's "reduces what must be established", the user story's
promise that the plan says what the approval does for the operator, and this section's own opening
line announcing three plan states and calling the distinction between the second and third the whole
feature, two rounds after the states were deleted. The sweep axis is not the word "reduce": it is any
sentence stating an EFFECT of the answer, and any survivor of a deleted state. All three are removed
above and here.

The mapping is **by the field's answer**, and it uses only fields the shared `Finding` contract
already carries. Round 3's table invented two plan states, OPEN and UNRESOLVED, and **those states
are not representable**: `Finding` exposes `kind`, `disposition`, `deadlineStatus` and
`verificationStatus` and has no per-authorisation state, `parseRule` ignores unrecognised `output`
properties, and the footprint permits no shared-contract, API, persistence or UI change. A
ruleset-only implementation could not have emitted, persisted or rendered either label.

So the feature emits an ordinary finding, and the answer decides whether it is emitted at all:

| `venue_has_assembly_approval` | Finding | `disposition` | Note text must |
| --- | --- | --- | --- |
| not in scope (gate false) | none FROM THIS FEATURE | n/a | the plan still carries `ADV-VENUE-OCCUPANCY-001`; see Edge Cases |
| **`yes`** | emitted | **`may_be_required`** | state that this answer does not settle the filing; **make no claim about the approval's effect, in either direction**; **carry no confirmation instruction**, see below |
| **`no`** | emitted | **`may_be_required`** | state that the operator's own filing is unresolved |
| **`unknown`** (explicit) | emitted, **both rules** | **`may_be_required`** | both texts; measured, see below |
| **in scope, NO answer** | emitted, **both rules**, on the rescope path | **`may_be_required`** | a submission cannot be in this state; a rescope variant can and Scenario A's is |

**Why `may_be_required` and not something else.** It is the disposition
`DOB-ASSEMBLY-001` already publishes, and it means exactly what the sources support: the requirement
may apply and nothing here settles it. The collision to avoid is `no_new_requirement`, which asserts
there is no requirement, and which no source licenses: DOB-ASSEMBLY-001's own verification block
says the question is "NOT PUBLISHED in either direction". A disposition that already means something
else is how a false state gets rendered, so the mapping reuses the one whose existing meaning is the
one intended.

**All four answered cases share a disposition and differ only in note text.** That is not a
weakening of round 3's distinction, it is what round 3's distinction always was: after NARROWED was
removed, no state in this spec asserted a reduction, so the labels differed only in what they told
the operator to do next, and note text is where this contract puts that.

### The published rules, pinned field by field

Round 4 said "an ordinary finding" and stopped there. That is not implementable: a rule carries
`id`, `kind`, `trigger`, `output`, `source`, `verification` and `exercised_by_scenarios`, all seven
required by `parseRule`, and the ones this spec left unmentioned are the ones an implementer would
have had to invent. **In this repository an unmentioned regulatory field is an invitation to invent
a permit fact**, which is the single thing this spec exists to prevent, so every field is either
PINNED here or marked BLOCKED on a named owner. Nothing is left silent.

### THE IDS ARE RENAMED, because the earlier ones published the fact this feature must not infer

Rounds 5 to 7 called these rules `DOB-ASSEMBLY-VENUE-APPROVAL-001` and, for the venue-neutral variant,
`DOB-ASSEMBLY-VENUE-APPROVED-001`. **Both name an approval as held or in place, and the first rule
fires on answers where nothing of the kind is known.** Its trigger term is `eq yes`, and an explicit
`unknown` or an absent in-scope answer resolves that term tri-state `unknown`, on which the rule is
DELIBERATELY EMITTED, per the emission table above. So on Scenario F and on Scenario A's rescope, the
two cases this spec exists to handle carefully, the finding's own identifier would have told the
operator that an approval is held. That defeats the premise, and no copy discipline anywhere else in
the document can repair it, because the id is not copy: it is data that renders.

**The ids are visible, and after PR #176 they are visible unconditionally.** `plan-line.tsx:133`
joins them, `:135` falls `name` back to them, `:145` puts that in the `<h3>`, `:143` uses them for
the `aria-labelledby` target, `:221` interpolates `name` into the disclosure label, and `:223`
renders them inside a detail panel that PR #176 made unconditional precisely so nothing in it can
disappear. There is no rendering path on which a rule id is private.

**The axis is what the rule CHECKS, never what it found:**

| Was | Is | Why |
| --- | --- | --- |
| `DOB-ASSEMBLY-HOST-HELD-001`, or `...-VENUE-APPROVED-001` | **`DOB-ASSEMBLY-VENUE-APPROVAL-001`** | names the question the rule reads, the venue's place-of-assembly approval answer, and no value of it |
| `DOB-ASSEMBLY-HOST-UNRESOLVED-001`, or `...-VENUE-UNRESOLVED-001` | **`DOB-ASSEMBLY-VENUE-APPROVAL-002`** | same subject, and the branch is carried by the numeric suffix, which asserts nothing |

The numeric suffix is the one new convention: no published id uses `-002` today, and every id ends
`-001`. It is chosen for the property that makes it unattractive, that it is empty of meaning, since
any word distinguishing the two branches is a word about the answer. `UNRESOLVED` was the near miss:
it describes the operator's filing rather than the venue's answer, and it is true on every answer
either rule fires on, but it reads as a finding about the venue when it sits beside `APPROVAL`.

### Every string this feature introduces, tested for the same defect

The test is the one the rename came from: **does this string state a fact about the answer, when the
rule fires on more answers than one?** Applied to all of them, not only the ids:

| String | Fires on | Verdict |
| --- | --- | --- |
| both rule ids | 001 on `yes`, explicit `unknown`, absent; 002 on `no`, explicit `unknown`, absent | FIXED above |
| `output.requirement_name`, the `<h3>` and the disclosure label derived from it | both rules publish the SAME heading | PASSES, and the constraint is now explicit: it names the question and no answer, e.g. the venue's place-of-assembly approval and this event's own filing |
| 001's `note_text` | `yes`, explicit `unknown`, absent | CONSTRAINED: it may not say the venue reports an approval, because on two of its three answers that is unknown, and it carries no confirmation instruction. It says the answer does not settle this event's filing, which is true on all three |
| 002's `note_text` | `no`, explicit `unknown`, absent | CONSTRAINED the same way: it may not say the venue has no approval. It says this event's own filing is unresolved |
| `output.agency`, `permit_name`, `deadline`, `fee`, `portal` | n/a | PASS by absence, pinned below |
| the `aria-labelledby` DOM id | every render | PASSES as an attribute, but it points at the `<h3>`, so assistive technology reads whatever `name` resolves to, which is why the heading carries the same constraint |
| this document's title | n/a | FAILED on the relationship axis rather than the answer axis; renamed to "Venue Assembly-Approval Coverage" with the route 1 decision |
| this document's FILENAME | n/a | still says `host-guest`. Not renamed here: the path carries this PR's review history, and the file's name is already an open question under Approval Blocker 7, which the naming decision resolves in one move |
| Scenario G's answer-key section title, if that fixture lands | one fixture, one answer | PASSES, and the distinction is worth stating: a fixture's answer IS known, so its title may name it. A rule fires on more answers than one, so its id may not |

**Round 8 observed that this rename made route 1 read better, and route 1 is now the decision.** With
the ids on a subject-and-check axis, nothing in the rules names a relationship, so applying the decision
was a change to this document's framing rather than to the artifact: the ids did not move again, which
is the property this section bought.

**Two things this audit found in code that the spec does not fix.**

1. **The same defect is already shipped, for the analogous field.** `SLA-VENUE-LICENSE-001` fires on
   `venue_license_covers_event_area eq yes` and, measured on the published ruleset, also emits on an
   explicit `unknown`, carrying `NO_NEW_REQUIREMENT_IDENTIFIED` and an id naming the venue's licence.
   That is an id and a disposition asserting a settled state on an unsettled answer. It is a published
   rule, so it is out of this footprint and out of this spec's scope; recorded here because the next
   round of this review will otherwise find it and think it is new. An issue is the right home.
2. **A `RESEARCH_REQUIRED` rule renders "confirm with agency" twice, and this feature would have made
   it THREE.** `findings.ts:62` appends `CONFIRM_WITH_AGENCY` to `notes` whenever the status is
   `RESEARCH_REQUIRED` or the deadline is `not_calculable`, and `plan-line.tsx:194` renders the same
   constant again as the line-level research paragraph. Both surviving options in the verification-status
   conflict land `RESEARCH_REQUIRED`, so both renders fire, and the `note_text` pinned in earlier rounds
   said to confirm with DOB as well: three versions of one instruction on this feature's primary `yes`
   output, on the line an organizer reads first.

   **The third one is inside this footprint, so it is removed rather than reported.** Both note texts now
   carry no confirmation instruction: they say the answer does not settle the filing, and the plan already
   tells the organizer to confirm, twice. That loses nothing, because `CONFIRM_WITH_AGENCY` is the
   published rendering of the very status these rules carry.

   **The underlying double-render REMAINS and is not fixed here.** It is `packages/engine/src/findings.ts`
   and `apps/web/app/plan/plan-line.tsx`, a lane this feature does not otherwise touch beyond one comment,
   and no published rule carries `RESEARCH_REQUIRED` today, so it has never been exercised. It belongs to
   whoever resolves the status conflict in Approval Blocker 5, and it is reported rather than absorbed.

**Two rules, not one**, because a rule carries at most one `note_text` and the mapping above needs
two texts. Their ids are pinned here because the answer key and the test files pin rule ids
literally, so an implementer choosing them alone would fork the artifact and its expectations. Ids
are engine identifiers and assert no regulatory fact; the product owner may rename them provided
both artifacts move in the same commit.

| Field | `DOB-ASSEMBLY-VENUE-APPROVAL-001` | `DOB-ASSEMBLY-VENUE-APPROVAL-002` | Status |
| --- | --- | --- | --- |
| `kind` | `note` | `note` | PINNED, derived below |
| `trigger.all` | the published gate verbatim (`location_type eq private_venue`, `headcount gte 75`) plus `venue_has_assembly_approval eq yes` | the same gate plus `venue_has_assembly_approval in ["no", "unknown"]` | PINNED |
| `output.disposition` | `MAY_BE_REQUIRED` | `MAY_BE_REQUIRED` | PINNED, and it must be written explicitly; see the default trap |
| `output.requirement_name` | a short non-regulatory heading naming the question | the same heading | PINNED as PRESENT; see the double-render below |
| `output.note_text` | states that the answer does not settle the filing, makes NO claim about the approval's effect in either direction, and carries NO confirmation instruction (F-1NN-AC-01) | states the filing is unresolved, same two prohibitions (F-1NN-AC-02) | PINNED in constraint, wording is the feature's |
| `output.permit_name`, `agency`, `deadline`, `fee` | ABSENT | ABSENT | PINNED as absent |
| `output.portal` | ABSENT | ABSENT | PINNED as absent; it renders "apply at" and a note is not an application |
| `output.notes` | ABSENT | ABSENT | PINNED as absent; every entry renders as regulatory prose needing its own source |
| `output.dedupe_key` | ABSENT | ABSENT | PINNED as absent, decided below |
| `source.citation`, `source.urls` | cannot be settled inside this spec | same | **BLOCKED**: contract conflict, see below |
| `verification.status` | cannot be settled inside this spec | same | **BLOCKED**: contract conflict, see below |
| `verification.qualification` | records the silence, and is USER-VISIBLE, not metadata | same | **BLOCKED** on the product owner, as published prose |
| `verification.evidence` | points at the existing record of the silence; not rendered | same | **BLOCKED** on the product owner |
| `verification.last_verified_date` | ABSENT | ABSENT | PINNED as absent; adding one is the product owner's, per §6 as amended 2026-08-04 |
| `exercised_by_scenarios` | `["F", "A-rescope"]` | `["F", "A-rescope", <the new explicit-no fixture>]` | PINNED per rule, derived against each trigger |

**The three that had slipped the table, each read in `parseRule` and in the renderer rather than
assumed.** Round 5 wrote that an unmentioned field is an invitation, and then left three unmentioned,
so they are decided here:

- **`output.portal`** is consumed at `packages/engine/src/ruleset.ts:443` into `portalName`,
  `portalUrl` and `portalInstructions`, and `PlanLine` hands all three to `PortalBlock`, which renders
  F-204's "apply at" route. ABSENT: these rules are not an application, `DOB-ASSEMBLY-001` already
  publishes the TPA portal, and a second "apply at" beside it would invite a filing that does not
  exist.
- **`output.notes`** is concatenated into the finding's `notes` and rendered paragraph by paragraph.
  Every entry is regulatory prose and would need its own source, which is the thing this feature has
  none of. ABSENT, and the note text carries everything these rules say.
- **`verification.last_verified_date`** renders as "last verified <date>" in the detail panel
  (`plan-line.tsx:224`). ABSENT, and this one is not a preference: F-206 Acceptance Criterion 5 says a
  date is stored only when every contributing rule publishes one and that no other date may stand in,
  and the published legend reserves verification to the verification owner. That legend wording is
  `nyc.v2.11`'s, quoted as published and not an instruction to a future signatory: under
  `docs/DOCUMENTATION-GOVERNANCE.md` §6 as amended 2026-08-04 the capacity that may publish a date is
  the product owner's, which is the same routing the two `verification` rows above now carry. All
  three are verification-status publication, and the product owner's approval under §6 is the whole
  requirement, including where the product owner is also the author. A date
  here would print a verification of a fact nobody verified. If the product owner ever publishes one,
  note that `mergeFindings` takes the earliest of two and null if either is missing, so it also
  changes what a merged line would show.

**And one correction inside the row above them.** `verification.qualification` was marked BLOCKED as
though it were metadata. It is not: `findings.ts:61` appends it to `notes`, so whatever it says is
rendered to the operator as a paragraph on the line. It is published prose subject to the same rules
as `note_text`, including the answer-neutrality test above, and the row now says so.

**`kind: note`, and the alternative was measured rather than assumed.** A `permit`-kind finding is
trackable: `apps/api/src/checklist.ts` limits tasks to `permit` and `insurance`, so a permit-kind
rule here would add a SECOND checklist task for one TPA filing, and it would need a `permit_name`,
which would either duplicate `DOB-ASSEMBLY-001`'s published instrument or name an instrument that
does not exist. `note` is the shipped shape for a rule that qualifies another requirement without
being one: `PARKS-INSURANCE-NOTE-001` is `kind: note`, publishes `note_text` alone, carries no
`dedupe_key`, and sits beside `PARKS-EVENT-001`. Measured on the published ruleset with a note rule
added: it renders as its own finding, `kind=note`, with `deadline=null` and its own
`verificationStatus`. `note` is also not in `AGENCY_REQUIRED_KINDS`
(`apps/api/src/ruleset.ts:148`), so omitting `agency` parses, which the `permit` kind would not
allow.

**`requirement_name` is PRESENT, and round 5's reading of the `name` fallback was half the story.**
`parseRule` falls `name` back through `permit_name`, `requirement_name`, `advisory_text`,
`note_text` (`packages/engine/src/ruleset.ts:454`), and round 5 concluded from that only that the
note text becomes the heading. What it missed is that `PlanLine` renders BOTH: `finding.name` in the
`<h3>` (`apps/web/app/plan/plan-line.tsx:98`) and `finding.noteText` in its own paragraph (`:126`),
independently. A rule publishing `note_text` and nothing above it in the fallback chain therefore
displays its whole sentence twice, once as the heading and once as the body.

So each rule publishes a short `requirement_name` as well, and the pair is shipped practice rather
than a new shape: `SAPO-BLOCK-PARTY-ELIG-001` publishes `requirement_name: "Block party eligibility
conflict"` with a longer `note_text`, and `NYPD-SOUND-PARKS-DEP-001` does the same. The heading names
the QUESTION and asserts no permit fact, in the manner of those two: it says which authorisation and
whose filing are at issue, and says nothing about whether either is required, reduced or held. The
alternative, suppressing the body when it equals the heading, is refused: it is a rendering change in
`apps/web/app/plan`, a lane this feature otherwise does not touch at all, and PR #176 is changing
those same components. A published heading costs one field.

**THE DEFAULT TRAP, and it is the reason `disposition` may not be omitted.**
`DEFAULT_DISPOSITION_BY_RULE_KIND` in `packages/engine/src/proposals.ts:55` maps `note` to
`no_new_requirement`, which is exactly the disposition the paragraph above forbids, and
`PARKS-INSURANCE-NOTE-001` publishes no disposition and takes that default. So a note-kind rule that
says nothing about its disposition renders the one output this feature must never produce. Publishing
`MAY_BE_REQUIRED` explicitly is what prevents it, and `resolveDisposition` leaves a published
`may_be_required` alone on an unknown trigger, since only `required` is downgraded.

### The verification status and the source block are a contract conflict, not a wording choice

Round 5 pinned `RESEARCH_REQUIRED` and told the implementer to draw the citation from
`DOB-ASSEMBLY-001`'s existing block. **Those two instructions cannot both be followed honestly, and
the reason is in the loader rather than in the prose.**

- The published legend defines `RESEARCH_REQUIRED` as "no primary source located in two research
  passes; rendered as 'confirm with agency'", and `PlanLine` renders exactly that meaning:
  `apps/web/app/plan/plan-line.tsx:91` and `:117` put `CONFIRM_WITH_AGENCY` on the line, under a
  comment reading "A RESEARCH_REQUIRED line has no located primary source".
- `validateRuleset` requires a source for every status except `COVERAGE_GAP`
  (`apps/api/src/ruleset.ts:486`: "source is required unless verification.status is COVERAGE_GAP").
- So a `RESEARCH_REQUIRED` rule must carry a source to load, and carrying one contradicts the
  status's published meaning. `PlanLine` renders the contradiction on one line: the
  no-located-source sentence at `:117` and the citation list at `:199`.
- And the sources that could be attached are the wrong kind of true. DOB-ASSEMBLY-001's own
  verification block records that whether a filing is required at all at a venue already holding a
  certificate "is NOT PUBLISHED in either direction". Its citations establish the instrument, not the
  proposition these rules state, so they would sit beside an output they do not support.

**Whether any other legend value is defensible: none is.** Each is refused on the published legend
rather than on preference:

| Status | Legend text | Why it is not this rule |
| --- | --- | --- |
| `SOURCE_CONFIRMED` | "fetch-confirmed primary-source quote on file" | there is no quote on file for this proposition; this is the laundering round 5 already refused |
| `VERIFIED` | "verification owner confirmed ... (none at publication; only the verification owner assigns this)" | nothing is confirmed, and the legend reserves the value. The quoted wording is `nyc.v2.11`'s as published; the capacity that assigns it is the product owner's per §6 (2026-08-04), and that approval is the whole requirement even where the product owner authored the publication |
| `OFFICIAL_CONFLICT` | "live official pages disagree; both readings encoded" | this is silence in the sources, not disagreement between them |
| `COVERAGE_GAP` | "combination not modeled by this ruleset version; advisory asserts nothing" | the combination IS modelled once these rules exist, and three further consequences below |
| `RESEARCH_REQUIRED` | "no primary source located in two research passes" | the only value whose meaning is close, and the loader will not let it stand without a source |

`COVERAGE_GAP` is the one that parses without a source, so it deserves its refusal in full. It states
that this ruleset version does not model the combination, which is false the moment these rules fire
on it. `apps/web/app/verification-copy.ts` renders it to the operator as the plan possibly being
incomplete for their event, which is a second false statement. And it silently breaks Scenario A:
`buildRescopeSuggestions` drops any rescope that introduces a `COVERAGE_GAP` finding
(`packages/engine/src/verdict.ts`, "a coverage gap asserts nothing"), so A's private-venue rescope
would stop being suggested, `DOB-ASSEMBLY-001` would no longer be reached in `A-rescope`, and its own
`exercised_by_scenarios` claim would fail the agreement suite. Both artifacts that carry
`COVERAGE_GAP` today are advisories with no source, which is the shape the legend's wording describes.

**Nothing in this ruleset publishes `RESEARCH_REQUIRED` today.** All 33 rules are `SOURCE_CONFIRMED`
or `OFFICIAL_CONFLICT`; the two `COVERAGE_GAP` artifacts are advisories. So this feature would be the
status's first use, and the conflict above has never been exercised. **This is the same shape as PR
#170's finding that the schema cannot express a non-regulatory rule: the artifact format has no slot
for "sources located, and expressly silent on this proposition".**

**BLOCKED on the product owner. Four options, with their owners, none chosen here:**

1. **Widen the loader's exemption** so `RESEARCH_REQUIRED` may also omit a source: one condition at
   `apps/api/src/ruleset.ts:486`. The rule then states the honest status and carries no citation,
   which `PlanLine` already renders coherently (`CONFIRM_WITH_AGENCY`, no citation list) and F-206
   Acceptance Criterion 3 already contemplates. Cost: it is a rules-schema contract change, so
   governance §6's "Event Input, rules schema, OpenAPI, shared enum" row applies, requiring the
   product owner. It also weakens
   the guard for all 33 rules, since any rule could then omit its source by claiming this status.
2. **Amend the published legend** so `RESEARCH_REQUIRED` distinguishes "no source located" from
   "sources located and silent on this fact", and keep the source block. No code change; regulatory
   status content, so the product owner, for the rule and for the
   rendered copy, whose approval is the whole requirement under §6 even where the product owner
   authored the amendment. Constraint to check before drafting: `apps/web/app/verification-copy-prose.test.ts`
   denies the source-absence family across PRD, DESIGN, F-201, F-206 and `apps/web`, so the amendment
   has to be worded to pass that guard rather than around it.
3. **Publish the statement with `COVERAGE_GAP`.** Refused above on three counts, recorded as an
   option only so the refusal is on the record.
4. **Publish nothing**, which is this spec's existing fallback: the field stays in
   `UNCONSUMED_INTAKE_FIELDS` and answering it changes no output.

The author's recommendation, which is not a decision: option 1. It is the only one that leaves the
artifact stating something true without amending a published meaning that four approved documents and
a prose guard depend on, and its cost is a contract change that the product owner reviews rather than a
regulatory claim anyone has to stand behind. **One trap for whoever implements it:** the engine's own
`parseSource` returns null for an absent source without complaint
(`packages/engine/src/ruleset.ts:401`), so a source-less rule parses in the engine and the entire
fixture suite stays green. The failure appears only at API boot and in `apps/api/src/ruleset.test.ts`.

**NO SHARED `dedupe_key` WITH `DOB-ASSEMBLY-001`. One finding or two is a user-visible product
choice, so it is decided here, and it is decided on three measured consequences of merging**, taken
from the published ruleset with a shared key added:

1. **Merging launders an unestablished statement under a confirmed badge.** `mergeFindings` spreads
   the FIRST finding and concatenates only `ruleIds`, `notes`, `sources`, `triggeredBy` and
   `deadlineUnknownFields`. `verificationStatus` is not merged. With the note listed after
   `DOB-ASSEMBLY-001` the merged line carries `vstatus=SOURCE_CONFIRMED`, so F-206's per-line
   rendering shows a confirmed status beside a statement that cannot honestly carry one, whatever the
   status question above resolves to, and any weaker status's own rendering is lost. Merging also
   makes that question unaskable: the merged line has one status for two rules.
2. **Every displayed scalar depends on array order.** Listed AFTER, the merged line is
   `kind=permit` with DOB's name and its `business_days_minimum` deadline. Listed BEFORE, the same
   pair becomes `kind=note`, `name` = the note text, `deadline=null`: the TPA permit line stops being
   a permit, loses its deadline, and with it its checklist trackability and its F-203 alerts. Nothing
   in the schema or in `parseRule` prevents either order.
3. **Merging re-keys the requirement, and live checklists pay for it.** F-202 identifies a
   requirement by its whole sorted rule-id set, so `[DOB-ASSEMBLY-001]` and
   `[DOB-ASSEMBLY-001, DOB-ASSEMBLY-VENUE-APPROVAL-001]` are different requirements. On publication every
   existing checklist strikes its assembly row and appends an unstarted one, and the organizer's
   status, notes and uploaded documents stay on the struck row.

Also `noteText` merges as `first.noteText ?? second.noteText`, so a merged line drops the second
rule's note text outright. It survives today only because `DOB-ASSEMBLY-001` publishes none, which
is a fact about the current artifact rather than a guarantee. The note text is this feature's entire
output, so a shape whose output depends on another rule staying silent is not the shape to publish.

The cost of not merging is bounded by the `kind` decision: the second line is a note, not a permit,
so the plan shows one permit requirement and one note qualifying it, and the checklist gains no task.

**Which rules emit, corrected against a measurement rather than reasoned from the table.** Driven
through the published ruleset on the analogous shipped field `venue_license_covers_event_area`, whose
type, values and unknown-capability are identical, because the real field cannot be driven until its
`UNCONSUMED_INTAKE_FIELDS` entry is removed (the coupling under System Impact, confirmed by the
guard firing):

| Answer | Emits | Note |
| --- | --- | --- |
| `yes` | `-001` only | the `in ["no", "unknown"]` term resolves false |
| `no` | `-002` only | the `eq yes` term resolves false |
| explicit `unknown` | **BOTH** | a rule that does not list `unknown` among its accepted values gets tri-state `unknown` for an explicit `unknown`, and `findings.ts` continues only on `false` |
| in scope, no answer | **BOTH**, and only on the rescope path | the terms read an absent answer as tri-state `unknown`; the submission path never gets there because `validateIntake` refuses the omission |

An explicit `unknown` emits BOTH notes, so the two note texts must be jointly true rather than
alternatives, and F-1NN-AC-02 expects two findings.

### Which path each output has been checked against

Three rounds running, a conclusion true on one path has been carried onto another where it is false:
round 4 described plan states the shared contract cannot carry, round 5 priced a rule shape without
reading the renderer, and round 5 also retired the no-answer case on a validator that one of the two
paths reaching it does not run. So the paths are named, and every output above states which of them it
was checked against.

| Path | What runs | Checked how |
| --- | --- | --- |
| Submission | `parseIntakeContract` then `validateIntake`, then `evaluate` (F-101, `POST /api/events`) | measured: the omission returns `{field: "venue_has_assembly_approval", code: "required"}` |
| Rescope | `buildRescopeSuggestions` then `evaluateConditional`; the suite's `rescopeReachedIn` and `rescopePlan` then call `evaluate`. **No validator on either** | read in `packages/engine/src/verdict.ts` and `fixture-ruleset-agreement.test.ts:432` and `:462` |
| Fixture and metadata | the agreement suite's bidirectional `exercised_by_scenarios` checks, plus `acceptance.test.ts` finding sets | read, and the entries below derived against each trigger |
| Loader | `validateRuleset` at boot, `parseEngineRuleset` at load | read, and the unconsumed-field guard confirmed by firing |
| Render | `PlanLine`, `verification-copy.ts`, F-206's per-line rules | read at `plan-line.tsx:98`, `:117`, `:126`, `:196`, `:199` |

**The rescope path produces the no-answer case, so the spec specifies it rather than calling it
invalid.** Round 5 was right that a submission cannot be in scope with no answer, and wrong to
conclude the case does not arise. `buildRescopeSuggestions` builds each variant as
`{ ...intake, [field]: value }`, ONE field changed, and evaluates it through `evaluateConditional`
directly; the agreement suite's `rescopeReachedIn` and `rescopePlan` do the same through `evaluate`.
Neither calls `validateIntake`. Scenario A's private-venue rescope therefore changes `location_type`
alone, leaves `venue_has_assembly_approval` absent, satisfies both gate terms (`headcount: 75` meets
`gte 75`), and reads the third term as a material unknown.

That variant is not a valid submission, and not only on this field: measured through
`validateIntake`, A with `location_type: private_venue` also reports `obstructs_public_way`,
`sapo_event_type` and `street_event_size` as `not_applicable`. The one-field rescope is an
engine-level artifact by construction, which is why treating it as an invalid intake is not available:
the code produces it, the answer key documents it as rescope (c), and `DOB-ASSEMBLY-001` already
claims `A-rescope` on the strength of it.

**So both rules name `A-rescope`, and their output for it is specified here:** each is reached with
its trigger resolving tri-state `unknown`, so each emits with `disposition: may_be_required` and its
own note text, `venue_has_assembly_approval` appears in `missingFacts` with its branches evaluated,
and the verdict remains CONDITIONAL on that unknown. Omitting the entry fails the agreement suite from
the other direction: `metadataOmissions` requires every rule a rescope reaches, fired or conditional,
to list it.

**The coordinated multi-field rescope is NOT in scope**, and that is a decision rather than an
omission. Making the variant a valid submission means `buildRescopeSuggestions` changing several
fields at once, which changes what a rescope suggestion IS for every rule in the ruleset, is engine
work under F-102's verdict machinery rather than this feature's, and would move Scenario A's
documented rescopes. Recorded as a coordination point, not adopted.

### `exercised_by_scenarios`, derived per rule against its own trigger

Round 5 pinned the same list on both rules, which the agreement suite refuses in the other direction:
`claimsButCannotReach` fails a rule listing a scenario it never reaches, and the explicit-`no` fixture
is unreachable for the `eq yes` rule, which resolves false on it. With the `A-rescope` entry
removed last round, that makes two entries wrong in the same table, so every entry is now derived
against the trigger rather than copied:

| Scenario | `-001` (`eq yes`) | `-002` (`in ["no", "unknown"]`) | Why |
| --- | --- | --- | --- |
| F (explicit `unknown`) | listed | listed | measured: an explicit `unknown` resolves tri-state `unknown` for `-001` and TRUE for `-002`, and both emit |
| the new explicit-`no` fixture | **NOT listed** | listed | `eq yes` resolves false on `no`, so `-001` is not reached, fired or conditional |
| `A-rescope` (absent) | listed | listed | both terms read an absent in-scope answer as `unknown`, and the rescope path runs no validator |
| A, B, C, D, E base | neither | neither | the gate needs `private_venue` and `headcount gte 75`; B is a private venue at 60 |

Scenario B is the one worth stating explicitly, because it is a private venue and therefore looks like
a candidate: its `headcount` is 60, so the published gate never opens and the field is never asked.

## State, Validation and Errors

No new persisted state. No new validation: `validateIntake` already accepts, rejects and scopes
`venue_has_assembly_approval`, and this spec changes none of that. No new error class.

One existing behaviour this spec must not disturb, recorded because it is easy to break: answering
`event_open_to_public: "unknown"` makes `food_affinity_private_exception_claimed` **required**,
because the gate is a `!=` comparison and `"unknown" != "yes"` holds. A change that narrows that
gate would silently stop collecting the field.

## UI and Accessibility

Rendering is F-102's, not this spec's, and round 3 left two sentences that could not both stand:
one said this feature must not implement F-102 Acceptance Criterion 6, the other said its OPEN state
populates the branch table. **Decided: this feature does NOT implement F-102 Acceptance Criterion 6,
and it does not claim to populate a branch table.**

What it does do, as a consequence rather than as output: once a published rule consumes
`venue_has_assembly_approval`, the generic verdict engine sees an unknown-capable field that a
trigger reads, so it adds the field to `missingFacts` and evaluates its branches. That is the
assembly-approval PORTION OF THE DATA F-102 Acceptance Criterion 6 would render. This spec produces
it; it does not render it, does not test its rendering, and states no criterion about it.

**This document states no implementation status for F-102's criteria.** Two sentences here did, both
sourced to PR #170: that Acceptance Criterion 6 is an approved criterion never implemented, and that
the branch data would not be shown to an operator until it was. Approval Blocker 4 below already
says the opposite about the same subject, that "the status of another spec's criteria is not
asserted here", so the two could not both stand and the blocker is the one that is right. Which
criteria of F-102 are implemented is F-102's to state and a reader's to check in the tree, not a
fact this spec carries into its own approval.

**Consequence to state plainly:** this feature produces the assembly-approval branch data and
renders none of it. Where that data is shown, and when, is F-102's question. The finding itself
renders normally, because it is an ordinary finding.

Accessibility requirement inherited rather than restated: any status this introduces must be
distinguishable without colour alone, matching the treatment F-206 uses for verification statuses.

## System Impact

| Area | Impact | Note |
| --- | --- | --- |
| Intake registry | none | fields already published |
| `validateIntake` | none | already accepts all three |
| Ruleset | **two new rules** | the pair pinned under Outputs, so a version bump |
| `packages/engine/src/ruleset.ts` | **required change** | `UNCONSUMED_INTAKE_FIELDS` entries must be removed in the same change as the trigger |
| `apps/api/src/ruleset.ts` | **required change** | `EXPECTED_RULESET_VERSION` and `EXPECTED_RULE_COUNT` both compared at boot; see the enumeration below |
| Answer key | **moves** | new plan output for the scenarios that reach these gates |
| Web | none of this spec's | F-102 owns the rendering |

### Every constant coupled to the published artifact, enumerated once

The first draft prescribed moving the rule count only, which would still have failed boot on the
version mismatch before a single new rule loaded. Four such dependencies had been found one at a
time, so they are enumerated here rather than discovered a fifth time. **All seven, swept rather
than recalled:**

| # | Constant | Location | Compared where | Moves for this feature |
| --- | --- | --- | --- | --- |
| 1 | `EXPECTED_SCHEMA` | `apps/api/src/ruleset.ts:31` | `:495` | no, schema family unchanged |
| 2 | **`EXPECTED_RULESET_VERSION`** | `apps/api/src/ruleset.ts:32` | `:500` | **YES**, and the first draft omitted it |
| 3 | **`EXPECTED_RULE_COUNT`** | `apps/api/src/ruleset.ts:33` | `:531` | **YES**, one per new rule |
| 4 | `EXPECTED_ADVISORY_COUNT` | `apps/api/src/ruleset.ts:34` | `:536` | only if an advisory is added |
| 5 | **`UNCONSUMED_INTAKE_FIELDS`** | `packages/engine/src/ruleset.ts:617` | `parseEngineRuleset` | **YES**, the entry must go in the same change |
| 6 | `BLOCK_PARTY_ELIGIBILITY_RULE_ID` | `packages/engine/src/intake/registry.ts:56` | `parseIntakeContract` | no, unless that rule id changes |
| 7 | `ALCOHOL_IN_PUBLIC_SPACE_ADVISORY_ID` | `packages/engine/src/intake/registry.ts:57` | `parseIntakeContract` | no, unless that advisory id changes |

`DEPENDENCY_SEQUENCING_BINDINGS` (`packages/engine/src/proposals.ts:128`) is an eighth artifact
coupling of the same family, keyed by three rule ids, but it is not compared at boot and does not
move for this feature. It is listed because the point of this table is that the set is knowable.

Nos. 6 and 7 are the reason a synthetic ruleset cannot be driven through `parseIntakeContract` at
all: it requires those two ids to be published. That is a constraint on testing, not on this
feature.

**The engine change is not optional and not a publication.** Adding a trigger that reads
`venue_has_assembly_approval` without removing its `UNCONSUMED_INTAKE_FIELDS` entry fails
`parseEngineRuleset` with "is now consumed by the ruleset; remove its UNCONSUMED_INTAKE_FIELDS
entry". `apps/api/src/index.ts` calls that parser at module top level, so the API does not boot
until the entry is removed. Nos. 2, 3 and 5 must land in one commit or the API does not start.

## Acceptance Criteria

1. **F-1NN-AC-01 · A `yes` makes no claim about the approval's effect, in either direction.** For `venue_has_assembly_approval: yes` the
   finding is emitted with `disposition: may_be_required` and note text directing the operator to
   stating that the answer does not settle the filing, and carrying no confirmation instruction of its
   own, per the triple-confirmation finding below. No output string may assert that the operator is
   covered, exempt, has a
   reduced obligation, or has no obligation. Reduces, removes and does nothing are three claims and
   the sources license none of them. **The strings this criterion governs are the ones this feature
   publishes**, which is a scope the criterion needed: `ADV-VENUE-OCCUPANCY-001` also renders at this
   headcount and its published text describes the below-75 case, so read as a claim about the whole
   plan this criterion would fail an approved advisory rather than this feature. **And no output string may state or imply that the approval
   belongs to a party other than the organizer**, since no intake field distinguishes them and the
   output is venue-neutral by the route 1 decision. The test asserts the
   ABSENCE of each of those claims, not merely the presence of the correct one, because the failure
   mode is an extra sentence rather than a missing one.
2. **F-1NN-AC-02 · An explicit `unknown` emits BOTH notes, each with `may_be_required`**, and never
   a disposition asserting any reduction. Both, not one: an explicit `unknown` resolves tri-state
   `unknown` for the `eq yes` rule, which therefore emits as well, and `findings.ts` continues only
   on a `false` trigger. The two note texts are written to be jointly true for that reason, and this
   criterion asserts the pair rather than either text alone.
3. **F-1NN-AC-03 · An explicit `no` is emitted, and is tested.** `venue_has_assembly_approval: no`
   emits the finding with the unresolved-filing note text. This needs its own fixture: **no approved
   scenario contains an explicit `no` for this field**, so without one an implementation could omit
   or misclassify the known-negative path and still satisfy every other criterion here.
4. **F-1NN-AC-04 · IN SCOPE WITH NO ANSWER IS TWO DIFFERENT ANSWERS, one per path, and the criterion
   states both.** On the SUBMISSION path it cannot arise: measured through `parseIntakeContract` and
   `validateIntake`, a private-venue intake at `headcount` 75 or more with
   `venue_has_assembly_approval` omitted returns `{field: "venue_has_assembly_approval", code:
   "required", message: "venue_has_assembly_approval is required for this event"}`, and F-101
   validates on submission, so no stored event is in this state. On the RESCOPE path it does arise and
   is the normal case: `buildRescopeSuggestions` changes one field and evaluates through
   `evaluateConditional` with no validator, so Scenario A's private-venue variant leaves the field
   absent. There, both rules are reached with their triggers resolving tri-state `unknown`, both emit
   with `may_be_required` and their own note texts, the field appears in `missingFacts` with its
   branches evaluated, and the verdict stays CONDITIONAL on it. Both rules therefore list `A-rescope`,
   and this criterion is tested on that variant, built the way the agreement suite builds it.
   `resolveAnswer`'s `isExplicitUnknown` distinction is real and still matters for the
   `in ["no", "unknown"]` term, which an explicit `unknown` answers TRUE and an absent one does not.
5. **F-1NN-AC-05 · A field the gate did not reach emits nothing FROM THIS FEATURE**, per F-201
   Acceptance Criterion 4's rule that a field never asked is not a material unknown. The scope of the
   word "nothing" is the two new rules and only them: measured on the published ruleset, a private
   venue below 75 still renders `ADV-VENUE-OCCUPANCY-001`, so a test written against "no assembly
   output" would contradict a finding that ships today. The criterion is tested by asserting the
   absence of the two new rule ids, not the absence of assembly content.
6. **F-1NN-AC-06 · Alcohol is untouched, compared against an INDEPENDENT copy.** The three SLA
   rules' triggers, outputs and dispositions are unchanged. The comparison must NOT read the newly
   published artifact for both sides: rollout deletes `rules/nyc-rules.v2.8.json`, so a test
   deriving its expectation from the new file would pass a changed alcohol rule against itself.
   The expectation is pinned independently inside the test footprint, as either the exact expected
   bytes for those three rules or a digest of them, captured from v2.8 before it is deleted.
7. **F-1NN-AC-07 · Scenario A's rescope is expected explicitly, with the field left absent, because
   that is what the code builds.** Scenario A carries `headcount: 75`, which meets the
   `headcount gte 75` half of the gate, so its documented re-evaluation to
   `location_type = private_venue` puts `venue_has_assembly_approval` in scope with no answer. The
   variant is not made valid and no answer is invented for it: the rescope machinery changes one field
   and runs no validator, so the honest expectation is the unknown-path output of Acceptance Criterion
   4, and both rules carry `A-rescope` in `exercised_by_scenarios`. The rescope's findings and its
   missing facts move, and its exercise metadata gains both rules. Expectations and tests for the
   rescope land with the change; moving Scenario F's answer-key output alone is insufficient.
8. **F-1NN-AC-08 · The coupled constants, the publication record, the manifest and the
   current-version documents land together.** A published trigger reading
   `venue_has_assembly_approval` lands in ONE commit with:
   the removal of its `UNCONSUMED_INTAKE_FIELDS` entry, the `EXPECTED_RULESET_VERSION` move, the
   `EXPECTED_RULE_COUNT` move, the `snapshot_date` advance and its test pin, **`supersedes` extended
   with `nyc.v2.8`, `status` rewritten with this feature's approval, and `provenance` rewritten to
   describe this change rather than v2.8's deadline correction** (per Rollout item 1, and none of the
   three is caught by a guard: `status` passes on its `APPROVED` prefix alone and the other two are
   read by no code), the
   `docs/BASELINE.md` update (current row repointed, new sha256, superseded-lineage row for v2.8, and
   the Scenario-fixtures row's version marker if the new fixture lands), the deletion of
   `rules/nyc-rules.v2.8.json`, the current-version references in the approved documents listed under
   System Impact **including `AGENTS.md` and `CONTRIBUTING.md` at the repository root**, **the
   version literal in `apps/api/src/ruleset.ts:324`'s diagnostic message**, **the seven authority
   comments in category 4a of the sweep**, **the rule and advisory
   counts in the four documents that state them**, and, if Scenario G lands, **the scenario counts in
   the fourteen places that state them, two of which are other features' approved acceptance criteria,
   plus `G` added to `DOB-ASSEMBLY-001` and `ADV-VENUE-OCCUPANCY-001`'s `exercised_by_scenarios`**.
   That commit boots AND passes `pnpm check:baseline`.
9. **F-1NN-AC-09 · No fact beyond the ruleset.** Every regulatory statement rendered traces to a
   published rule's `output`, `notes`, `source` or `verification`. Nothing is asserted that the
   published artifact does not carry, and DOB-ASSEMBLY-001's position that the question is "NOT
   PUBLISHED in either direction" is quoted rather than paraphrased.
10. **F-1NN-AC-10 · Determinism.** Same intake, same ruleset, same `today`, same calendar produces
    the same findings, matching F-102 Acceptance Criterion 9.

### Every claim about output, checked against the PUBLISHED plan rather than against this feature's scope

The edge case below said a private venue under 75 produces no assembly output, which was written from
what this feature adds rather than from what the organizer would see. **This is the second time a claim
about output was derived from the feature's own scope**, after round 6's plan-state claim, so every such
claim is now checked against a measured plan. Each shape below was built as a valid intake, run through
`parseIntakeContract` and `validateIntake`, and evaluated against the published ruleset, with the
published findings read off the result:

| Intake, private venue | Published findings TODAY | Verdict | What this feature adds |
| --- | --- | --- | --- |
| `headcount: 60` | `ADV-VENUE-OCCUPANCY-001` | FEASIBLE | nothing; the gate is closed |
| `headcount: 74` | `ADV-VENUE-OCCUPANCY-001` | FEASIBLE | nothing; the gate is closed |
| `headcount: 75`, answer `yes` | `DOB-ASSEMBLY-001`, `ADV-VENUE-OCCUPANCY-001` | FEASIBLE_AT_RISK | `-001`'s note |
| `headcount: 80`, answer `no` | the same two | FEASIBLE_AT_RISK | `-002`'s note |
| `headcount: 80`, answer explicit `unknown` | the same two | FEASIBLE_AT_RISK | BOTH notes |
| `headcount: 80`, answer ABSENT | the same two, and `validateIntake` reports `venue_has_assembly_approval: required` | FEASIBLE_AT_RISK | both notes, on the rescope path only |

**Three consequences the table forced, beyond the edge case itself.**

1. Acceptance Criterion 5's "emits nothing" is narrowed to the two new rule ids, because assembly
   content is on the plan at every headcount in a private venue.
2. **Acceptance Criterion 1's prohibition is scoped to the strings this feature publishes.** It says no
   output string may assert that the organizer is covered or exempt. Read as a claim about the whole
   plan it would fail an APPROVED advisory: `ADV-VENUE-OCCUPANCY-001` emits at 75-plus as well, and its
   published text says ordinary assembly certification is typically not triggered below 75, which is a
   sentence about a different headcount sitting on a plan for this one. That is published content
   inside another artifact's approval, not this feature's to change, and the criterion now says which
   strings it governs.
3. **`missingFacts` cannot be measured for this field yet, and the criterion now says so.** With the
   field absent today, `missingFacts` is EMPTY, because no published trigger reads it. The mechanism is
   observable on a field that is read: Scenario F's `missingFacts` carries
   `venue_license_covers_event_area` with its branches, which is an unknown-capable enum answered
   explicit `unknown` and read by the SLA triggers. So Acceptance Criterion 4's `missingFacts`
   expectation follows from that mechanism rather than from a measurement of this field, which cannot
   exist until the `UNCONSUMED_INTAKE_FIELDS` entry is removed.

## Edge Cases

- The venue reports `yes` and the event is plainly outside what that certificate covers. The
  product cannot detect this: nothing in the intake describes the operator's activity in the terms a
  certificate uses. The note text is worded so this case cannot falsify it, which is a second
  reason the finding asserts nothing about the operator's obligation.
- `headcount` below 75 leaves `venue_has_assembly_approval` unasked even in a private venue, so
  **NEITHER NEW RULE emits. The plan still carries assembly output, and the earlier claim that a
  smaller event produces none was false.** `ADV-VENUE-OCCUPANCY-001`'s published trigger is
  `location_type eq private_venue` and nothing else, so it emits at any headcount, and its published
  text speaks to exactly this case: "Below 75 indoors, ordinary assembly certification is typically
  not triggered [thresholds source-confirmed]; confirm the venue's permitted use and occupancy."
  Measured on the published ruleset, a private venue at 60 or at 74 produces exactly
  `ADV-VENUE-OCCUPANCY-001` and a FEASIBLE verdict. The gate is as published and this spec does not
  change it; what this spec adds is nothing below the threshold.
- An event in a venue whose own authorisation has lapsed is not modelled and cannot be: the intake
  collects the reported answer, not the authorisation's current status.

## Fixtures and Verification

- The six approved scenarios in `docs/test-scenario-answer-key.md` are the baseline. **Two of them
  reach this gate, not one.** Scenario F answers `venue_has_assembly_approval` `"unknown"` today.
  Scenario A carries `headcount: 75` and its documented rescope to `location_type = private_venue`
  puts the same field in scope with no answer, which the rescope machinery does not validate, so that
  rescope's findings and missing facts move and both new rules carry `A-rescope`.
- **A new fixture is required for the explicit `no` path**, because no approved scenario contains
  one for this field. Adding it is an answer-key change and carries the approvals below.
- Any answer-key movement is a regulatory publication under the change-class table in
  `docs/DOCUMENTATION-GOVERNANCE.md` §6 "Change classes and approvals", whose "Regulatory
  source/status/content" row and whose "Rule trigger, dedupe, branch, deadline, or formula
  semantics" row both require the product owner. This feature crosses both classes; it no longer
  crosses two sets of signatories. The movement is a regulatory publication and the product owner's
  approval under §6 is the whole requirement, including where the product owner authored it.
- **Verification research is REQUIRED and is not done.** Whether an existing place-of-assembly
  approval removes the temporary filing for an event held at that venue is **not established in this
  repository**, and the published record is venue-shaped rather than relationship-shaped: the
  verification block asks it of "a venue that already holds a place-of-assembly certificate of
  operation". The
  answer key records for DOB-ASSEMBLY-001 that "whether it removes the temporary filing at all is
  not published, so the rule asserts no exemption". This spec inherits that and asserts none either.
  No acceptance criterion above depends on the answer. They depend only on the plan declining to
  assert a reduction that no source establishes, which is what the note text encodes.

## Allowed Footprint and Coordination

Files this feature may touch, and who must be in the room:

| Path | Change | Owner |
| --- | --- | --- |
| `rules/nyc-rules.v<next>.json` | new rules, new version, advanced `snapshot_date` | product owner |
| **`rules/nyc-rules.v2.8.json`** | **deleted** | product owner |
| `packages/engine/src/ruleset.ts` | remove **only** the `venue_has_assembly_approval` entry from `UNCONSUMED_INTAKE_FIELDS` | product owner |
| `apps/api/src/ruleset.ts` | move `EXPECTED_RULESET_VERSION` and `EXPECTED_RULE_COUNT` | product owner |
| `docs/test-scenario-answer-key.md` | expectations | product owner |
| `docs/BASELINE.md` | current row, new digest, superseded-lineage record | product owner |
| **`packages/engine/src/intake/scenario-intake-fixtures.ts`** | **the new explicit-`no` scenario's intake** | product owner |
| the test files below | version, count and expectation pins | product owner |
| the documents below, **including `AGENTS.md` and `CONTRIBUTING.md`** | current-version references | product owner |
| `apps/api/src/ruleset.ts` | the version literal in the offset diagnostic at `:324`, and the `EXPECTED_RULESET_VERSION` explanation at `:55-60` | product owner |
| `packages/engine/src/intake/registry.ts`, `packages/engine/src/proposals.ts` | the two engine authority comments, text only | product owner |
| `apps/web/app/verification-copy.ts`, `plan/plan-line.tsx`, `verification-copy.test.ts`, `verification-copy-prose.test.ts` | the four web authority comments, text only | product owner |

The Owner column names the capacity §6 requires, not the number of signatures. The rows the audit
below classes as regulatory (the new ruleset, the v2.8 deletion, the `UNCONSUMED_INTAKE_FIELDS`
entry, the answer key and the new scenario intake) are regulatory publication, and the product
owner's approval under §6 is the whole requirement on each, including where they authored it.

### The new fixture needs three artifacts, not one, and the id is pinned

The footprint permitted the answer key and the test files, and a new scenario cannot be added with
either. `fixture-ruleset-agreement.test.ts` opens with
`expect(sorted(scenarioIdsIn.fixtures())).toEqual(sorted(scenarioIdsIn.answerKey()))`, where
`fixtures()` reads `SCENARIO_INTAKE_FIXTURES` from
`packages/engine/src/intake/scenario-intake-fixtures.ts` and `answerKey()` matches
`/^## Scenario ([A-Z])\b/` over `docs/test-scenario-answer-key.md`. So:

1. **The id is a single capital letter, and the next free one is `G`.** The regex takes one letter, and
   `no rule claims a scenario that does not exist` validates every `exercised_by_scenarios` entry
   against those ids, so an ad-hoc name like `no-answer-fixture` fails that check.
2. **A `## Scenario G` section in the answer key**, carrying an `**Inputs:**` line, because
   `documentedInputs` parses that line into field pairs and compares them against the fixture
   submission. A section without it throws rather than skips.
3. **An entry in `SCENARIO_INTAKE_FIXTURES`**, which is what the footprint was missing. A unit case
   inside an allowed test file cannot satisfy the equality above, because the check reads the exported
   fixture set and not the test that uses it.

Adding G also enrols it in every parameterized check: reached-versus-key in both directions, metadata in
both directions, and the documented-inputs comparison. And `docs/BASELINE.md`'s **Scenario fixtures**
row is an APPROVED artifact carrying a version marker (`v5` today), so it moves with the new scenario,
which is why the manifest row in the audit above covers more than the ruleset digest.

**This is the third footprint gap found by following a required test to the file it actually reads**
(after the engine's `UNCONSUMED_INTAKE_FIELDS` entry and the derived test pins). The method that finds
them is the one used here: open the test the criterion names, read what it imports, and put every file
in that chain in the footprint.

### What Scenario G reaches, MEASURED, and the existing metadata it moves

A new scenario is not additive. Every rule it reaches, fired or conditional, must name it, or
`metadataOmissions` fails in the direction that has now caught this document twice. So the set is
measured rather than reasoned: the intake below was built, validated through `parseIntakeContract` and
`validateIntake` with zero errors, and evaluated against the published ruleset, and the trace was read
for every `true` or `unknown` result.

**G is pinned as the MINIMAL private-venue intake at the gate**, because the fixture's own answers
decide how much existing metadata moves, and that is a design choice rather than a consequence:
`private_venue`, `headcount: 80`, `venue_has_assembly_approval: "no"`, no alcohol, no food, no
amplified sound, no structures, no flame, no generator, no battery, not open to the public.

| Rule G reaches | Result | `exercised_by_scenarios` today | Action |
| --- | --- | --- | --- |
| `DOB-ASSEMBLY-001` | `true` | `["F", "A-rescope"]` | **add `G`** |
| `ADV-VENUE-OCCUPANCY-001` | `true` | `["B", "F", "A-rescope"]` | **add `G`** |
| `DOB-ASSEMBLY-VENUE-APPROVAL-002` | `true` | new rule | lists `G` |
| `DOB-ASSEMBLY-VENUE-APPROVAL-001` | not reached | new rule | must NOT list `G` |

Exactly the two the reviewer named, and no others. **G's expected findings in the answer key must
therefore list `DOB-ASSEMBLY-001` and `ADV-VENUE-OCCUPANCY-001` as well as the new note**, or the
reached-versus-key check fails from the other side. The measured verdict for the two existing findings
alone is `FEASIBLE_AT_RISK`; the key's expected verdict is derived by running the fixture once the
rules land rather than predicted here.

**The cost of a non-minimal G, also measured, because it is the argument for the pin.** Built off
Scenario F's answers instead, G reaches EIGHT existing rules, none of which lists it:
`NYPD-SOUND-001`, `DOHMH-EXEMPTION-001`, `DOB-ASSEMBLY-001`, `SLA-VENUE-LICENSE-001`,
`SLA-ONEDAY-001`, `SLA-CATERING-001`, `ADV-NOISE-CODE-001`, `ADV-VENUE-OCCUPANCY-001`. Every one would
need a metadata edit and a place in G's expected findings, which is four times the blast radius for a
fixture whose whole purpose is one answer to one field.

**And the cheaper alternative, reported because the derivation exposed it and the choice is not
mine.** Acceptance Criterion 3 needs the explicit-`no` path covered; it does not necessarily need an
approved scenario. The same coverage is available as an engine unit case against the PUBLISHED ruleset
with a hand-built private-venue intake, which is what the measurement above already is, in the file
`packages/engine/src/engine.test.ts` that exists for "engine behaviors the scenario fixtures do not
reach". That costs one test file already in the footprint, and it moves no metadata, no manifest row,
no scenario count, and no other spec's acceptance criteria. What it does not do is put the `no` path in
the approved regulatory record, which is the answer key's job and the product owner's call.
Stated as a comparison: **Scenario G costs three artifacts, two existing rules' metadata, the
manifest's fixtures row, and the fourteen scenario counts enumerated in the sweep below, two of which are
other features' approved acceptance criteria. The unit case costs one file.**

**PREFERENCE RECORDED, NOT DECIDED, and the condition is the whole of it.** The product owner prefers
the engine unit test, **if it satisfies Acceptance Criterion 3**
(PR #171, `https://github.com/jzeng151/pop-engine/pull/171#issuecomment-5107886102`). That question
has not been answered, so **the Scenario G option is not withdrawn** and everything it requires
stays specified above: the three artifacts, the two metadata edits, the manifest row, the fourteen counts,
and the two other features' acceptance criteria. Whether a unit case satisfies a criterion about the
approved regulatory record is the product owner's call, not a cost comparison, which is why a
preference is all that is recorded here.

**AND THE CHOICE IS APPROVAL BLOCKER 20, a PREREQUISITE, which is a separate act from recording the
preference.** A preference that gates nothing leaves both routes specified in an approvable document,
and two implementers would then read the same approved text and do materially different work: one test
file, or three fixture artifacts plus two rules' metadata plus a manifest row plus fourteen scenario
counts. Tagging the CHOICE as a prerequisite does not decide it and does not promote the preference into
a decision. It says the document cannot be approved while the question is open.

### Every row audited against the change class it actually describes

The rows had been assigned by what a path looks like rather than by what the change does, so the
whole table is re-derived here against `docs/DOCUMENTATION-GOVERNANCE.md` §6 "Change classes and
approvals". §6's two relevant rows are "Regulatory source/status/content" and "Rule trigger, dedupe,
branch, deadline, or formula semantics", and since 2026-08-04 both require the product owner. A
change can still be in both classes; what it can no longer do is need two different capacities.
It no longer needs two signatories either: every row below marked as a regulatory class is a
regulatory publication, and the product owner's approval under §6 is the whole requirement on each,
including where they authored it. The class column below is the part that still carries information.

| Row | Class per §6 | Why, and what changed here |
| --- | --- | --- |
| new ruleset file | both | it publishes regulatory content AND two new triggers reading a field no trigger reads today, which is trigger semantics |
| v2.8 deleted | both | the deletion is not separable from the publication: `publishedRulesFile` throws unless exactly one ruleset is present, so the pair is one act, and the deletion removes every published trigger |
| `UNCONSUMED_INTAKE_FIELDS` entry | engine plus regulatory content | it is engine code, and its entry text is this repository's record of AC 28-117.1.3's amendment requirement, so deleting it deletes regulatory prose |
| `apps/api/src/ruleset.ts` constants | neither §6 regulatory row | boot constants asserting nothing regulatory |
| answer key | both | its expectations move BECAUSE trigger semantics moved, and `fixture-ruleset-agreement.test.ts` checks published rules against this key, so the key is where a trigger change is verified. The Fixtures section already said this feature crosses both rows; the row did not carry it |
| `docs/BASELINE.md` | approval record | §4 defines the manifest and §6 has no row for it; amending approval status and digests is the product owner's, unchanged |
| test pins | neither §6 regulatory row | assertions over constants and expectations |
| current-version documents | product scope | the product owner, unchanged |

**One row this table does NOT yet grant.** If the verification-status conflict under Outputs is
resolved by widening the loader's source exemption, that is a change to `apps/api/src/ruleset.ts`
beyond the two constants this table permits, and it falls under §6's "Event Input, rules schema,
OpenAPI, shared enum" row, which requires the product owner. The
footprint stays as written until that decision lands, so an implementer who needs the loader change
returns here rather than treating the existing `apps/api/src/ruleset.ts` row as cover for it.

**Four trigger-semantics changes were routed to the wrong signatories before this table was
audited, so the fix is the audit rather than any one cited cell.** Any future row added to this
table states its §6 class in the same breath as its owner. Since 2026-08-04 that owner is the
product owner for every row, and the class is what the row still has to get right.

### The current-version documents, DERIVED the same way as the tests

Round 3 derived the pinned TESTS; this is the same method applied to DOCUMENTS, because deleting
v2.8 while approved artifacts still name it leaves them pointing at a missing file. **The method was
wrong and is replaced.** It grepped `specs/*.md` and `docs/*.md`, two directories, which cannot find a
reference at the repository root, and both root documents carry one. **New method, and it is a sweep
of every tracked file rather than of a directory list:**
`git grep -c "nyc.v2\.8\|nyc-rules\.v2\.8\.json" -- .`, then sort every hit into four categories,
because "assertion or lineage" was also too coarse to place them:

1. **Instructions and authority claims.** A reader is told to open the file, or told that the file is
   the authority. These MUST move, and the two at the root are the ones the old method could not see.
2. **Executable literals.** The version appears in code that runs, including inside a diagnostic
   message. These MUST move; see the row below the table.
3. **Assertions in tests.** Enumerated in the pinned-tests section, unchanged.
4. **Comments and historical records.** A comment citing where a legend is published, or a dated
   record of a past round. These do NOT move, which is the rule round 3 adopted for
   `packages/engine/src/types.ts` and `scripts/check-baseline-drift.mjs`, now stated once and applied
   to everything in the category.

**Thirty-five tracked files match.** Category 1, the documents that move:

| File | What asserts the current version |
| --- | --- |
| **`AGENTS.md`** | **line 13 directs every contributor to open `rules/nyc-rules.v2.8.json`; line 27 names it as the sole source of regulatory output. MISSED by the old two-directory method** |
| **`CONTRIBUTING.md`** | **line 17 states every lead time, fee, agency and requirement comes from that path; line 22 puts it in the authority chain. MISSED the same way** |
| `docs/ARCHITECTURE.md` | AD-2 names the authoritative file; the component diagram names it |
| `docs/DESIGN.md` | the lane definition owning engine fidelity to the file; the ratification line |
| `docs/PRD.md` | current-ruleset references |
| `specs/F-101-event-intake.md` | `Depends on: ruleset nyc.v2.8 ratified`; the registry-authority line |
| `specs/F-201-permit-plan-generator.md` | `Depends on:` and the authoritative-inputs line |
| `specs/F-206-rules-snapshot-banner.md` | the banner example, version AND published date |
| `specs/F-204-portal-deep-links.md` | its published-on-nyc.v2.8 scope line |
| `docs/test-scenario-answer-key.md` | the ruleset the key is derived from |
| `docs/ROADMAP.md` | the current-ruleset pointer |

**The root documents are the reason this is not a tidiness item.** `AGENTS.md` line 5 of its own
numbered list is mandatory pre-work: a worker is told to read the ruleset before touching rules, plans
or verdicts. If the publication leaves that line naming a deleted path, the next worker's first
instruction cannot be followed, and the honest response is to stop on the contradiction rather than
guess which file replaced it. Both root documents therefore land in the same commit as the deletion,
under Acceptance Criterion 8 and rollout item 7.

**Category 2, the one executable literal outside the enumerated tests:**
`apps/api/src/ruleset.ts:324`. When a published alert offset exceeds the product maximum,
`requireDaysBefore` reports that "the longest window nyc.v2.8 publishes is 60 days". The 60 is
unchanged by this feature and the version claim is not: it goes stale the moment v2.8 is deleted, and
it is inside a string rather than inside an assertion, which is why round 3's sweep for pins did not
model it. **It moves with the publication, or is derived from `EXPECTED_RULESET_VERSION`, which is in
the same file and already moves.** Deriving it is preferable, because it is then impossible to leave
behind on the next publication, and it costs one interpolation in a message no test asserts on. Either
way it is in the same commit.

### Category 5: COUNTS the publication moves, which the version sweep could not see

Round 7's sweep looked for the version string. **A document can name no version and still be made
false by this change, by stating a COUNT**, and two of those are approved acceptance criteria. Swept
with `git grep -niE "\b(six|seven|6) scenarios|all six|scenarios \(a.f\)|six approved"` and again for
rule and advisory counts, over every tracked file.

**Re-run in round 12 from the repository ROOT rather than over the directories the earlier passes
walked, which is what both misses have in common.** Round 11 found `docs/ROADMAP.md:17` outside them;
this pass found two more, both in `docs/ARCHITECTURE.md`, taking the scenario list from eleven entries
to fourteen. The pattern was never the failure: it matched these lines every time it was run. The path
argument was, so the sweep is recorded here with its scope stated, every tracked file from the root and
no directory list. `docs/ARCHITECTURE.md` is the instructive one, because it was already in the version
sweep AND in the rule-count table below, which is what made it feel already read.

**Scenario counts, which move only if Scenario G lands** (see the alternative above; if the `no` path
is covered as a unit case, none of these moves and that is most of the cost difference):

| File | What it states | Why it moves |
| --- | --- | --- |
| `specs/F-201-permit-plan-generator.md:35` | "six scenarios (A-F)" | names the suite's contents |
| `specs/F-201-permit-plan-generator.md:37` | **Acceptance Criterion 7, "All six scenarios pass"** | an APPROVED acceptance criterion of another feature |
| `specs/F-201-permit-plan-generator.md:51` | "All six + the boundary list" | its Scenarios Exercised line |
| `specs/F-101-event-intake.md:32` | **Acceptance Criterion 1, "All six fixture scenarios"** | an APPROVED acceptance criterion of another feature |
| `specs/F-101-event-intake.md:55` | "All six (A-F) as input fixtures" | its Scenarios Exercised line |
| `specs/F-206-rules-snapshot-banner.md:55` | "All six indirectly" | its Scenarios Exercised line |
| `CONTRIBUTING.md:60` | "the full fixture suite (6 scenarios + boundary fixtures)" | defines the engine gate |
| `CONTRIBUTING.md:84` | "Engine scenario suite still green (all six)" | the done checklist a contributor ticks |
| `docs/DESIGN.md:50` | the green-gate criterion, "6 scenarios" | the lane gate |
| `docs/DESIGN.md:57` | "all 6 scenarios pass end-to-end" | the same gate, end to end |
| `docs/PRD.md:114` | the plan-generation metric, "6 scenarios + boundary fixtures" | the success metric |
| **`docs/ROADMAP.md:17`** | **the Phase 1 gate, "Must pass all 6 answer-key scenarios"** | **the planning spine's own gate, and live rather than history** |
| **`docs/ARCHITECTURE.md:262`** | **"The fixture suite in `test-scenario-answer-key.md` (6 scenarios + boundary fixtures) is the engine's unit-test suite"** | **states what the suite IS** |
| **`docs/ARCHITECTURE.md:14`** | **AD-6's rationale, "testable against the 6 scenarios as plain unit tests from day 3"** | **a decision record's rationale rather than a gate, and stale the same way** |

**Rule counts, advisory counts and DERIVED TOTALS, which move whenever a rule is published, so they
move regardless of the fixture decision.** Round 8 swept scenario counts and stopped there; re-run for
rules, advisories, fields and any total derived from them, four more turned up, and they are the
dangerous ones because the footprint restricts those files to enumerated constants and comments, so an
implementer can follow it exactly and leave a live contract stale:

| File | What it states | New value |
| --- | --- | --- |
| `docs/ARCHITECTURE.md:312` | boot validation, "33 rules + 4 advisories present" | 35 + 4 |
| `docs/PRD.md:143` | "`rules/nyc-rules.v2.8.json`: 33 rules + 4 advisories" | 35 + 4 |
| **`docs/PRD.md:244`** | **a SECOND occurrence, in the Rules Engine bullet: "(33 rules + 4 advisories)"** | 35 + 4 |
| `docs/ROADMAP.md:12` | the ratification line, "33 rules + 4 advisories" | 35 + 4 |
| `specs/F-201-permit-plan-generator.md:31` | Acceptance Criterion 6, boot validation, "33 rules + 4 advisories" | 35 + 4 |
| **`apps/api/src/ruleset.ts:617`** | **"37 boot-time rows", the sizing statement behind the per-row insert decision** | 39 |
| **`apps/api/src/ruleset.test.ts:973`** | **the test NAME, "syncs all 37 rules". Its assertions at 980, 1022 and 1038 were already pinned; its title was not** | 39 |
| **`packages/engine/src/proposals.ts:34`** | **a DERIVED total: "24 of the 37 published rules omit `output.disposition`", which is the justification for the default-disposition table** | 24 of 39 |

**`docs/DESIGN.md:7` states the same "33 rules + 4 advisories" and MUST NOT MOVE**, which is the
distinction this table got wrong until round 12. It attributes that count to **`nyc.v2.1`**, the
corrected subset, inside a section headed "Decisions of 2026-07-22", and only afterwards records the
retarget to a later pointer. The count is part of a dated decision about what v2.1 CONTAINED. Applying
`35 + 4` there would not update a current fact, it would rewrite a historical one, and state that a past
ratified version held two rules that did not exist when it was ratified. A publication may not edit the
record of an earlier publication.

**So the same test the comment sweep uses applies to counts, and it is worth stating as the rule:**
does this number describe the CURRENT artifact, or a named past version as a historical fact. Applied to
every count statement the two sweeps found outside `docs/proposals/`, **eight describe the current
artifact and move, one describes a named past version and does not.** The eight are the eight rows
remaining in the table above. The one is `docs/DESIGN.md:7`. The tell is grammatical and cheap to check:
the moving eight name `nyc.v2.8` or no version at all, and the one that stays names `nyc.v2.1`.
`docs/ROADMAP.md:12` is the row that looks historical and is not, since it sits in a Phase 0 checklist
but states the count OF `nyc-rules.v2.8.json`, the file this rollout deletes, so its count moves with
its path.

**Found while applying that test, and NOT this feature's to fix.** `docs/DESIGN.md` carries two
version pointers naming a superseded version, **cited by content because a line number would not
survive the next edit to that file, which is the failure PR #161 exists to remove**. In the baseline
decision, the sentence continuing past the `nyc.v2.1` count reads "the pointer is now `nyc.v2.5`,
retargeted 2026-07-25 with no regulatory change". In the Dev 4 lane definition, the verification line
ends "`BASELINE.md` flips nyc.v2.5 to APPROVED". The published ruleset is `nyc.v2.8`, it is the only
file in `rules/`, and `docs/BASELINE.md`'s current-ruleset row already records it APPROVED. **The same
document contradicts itself on the point**: its green-gate criterion says `BASELINE.md` "flips nyc.v2.8
to APPROVED before the demo", so one document names two different versions for one event.

Both sentences are stale TODAY, before this feature changes anything, and they are not in this
footprint: this change does not make them false, it finds them already false. Reported rather than
corrected, because a correction to an APPROVED document is its owner's under §6 and is not smuggled in
beside a publication.

**Re-verified in round 13 against `origin/main` rather than a worktree**, after the claim was
questioned and after this branch was rebased, since a spec ABOUT stale pointers is the last document
that should carry one. Both sentences are present on main and both name `nyc.v2.5`.

**The same current-versus-historical test applied to VERSION POINTERS in that document, which is the
check that would have settled this before it was written.** `docs/DESIGN.md` carries seven pointers
across six lines. **Six name the current artifact; one names a past version as a historical fact.** The
one historical pointer is the `nyc.v2.1` baseline subset, which is correct as history and is the same
sentence whose COUNT is excluded from the table above. Of the six current-artifact pointers, four say
`nyc.v2.8` and are correct: the status header's amendment record, the green-gate criterion, the Dev 1
lane's engine-fidelity line and the crown-jewel line. **Two say `nyc.v2.5` and are the stale pair.** So
the defect is not that the document is old, which would have shown as a uniform lag. Four of its six
current pointers were updated and two were missed, which is what a per-occurrence retarget leaves
behind and exactly what this spec's own sweep categories exist to prevent.

Two new rules make 33 into 35 and the rules-plus-advisories total 37 into 39. **The derived total is the
one worth reading twice:** the numerator stays 24, because both new rules publish `MAY_BE_REQUIRED`
explicitly rather than omitting it, so only the denominator moves. A sweep that pattern-matched "37" and
replaced it would have been right here by luck rather than by derivation.

**Counts that do NOT move, checked rather than assumed:** the advisory count stays 4, because both new
rules are `kind: note` and live in `rules`; `apps/api/src/ruleset.test.ts:77`'s `intakeFields` at 33 stays,
settled by the route 1 decision; and `apps/api/src/ruleset.test.ts:370`'s `/expected 33 rules/`
expectation and `packages/engine/src/engine.test.ts:974`'s length of 37 were already in the pinned-tests
tables. The advisory count does not move, which the audited conditional row
above already settled, and `apps/api/src/ruleset.test.ts`'s `/expected 33 rules/` expectation is
already in the pinned tests.

**Counts that do NOT move, and the distinction is the same one the version sweep uses.**
`docs/test-scenario-answer-key.md:4` says "fixtures v4 (same six scenarios)", which is a true statement
about v4's lineage and stays true. The comments in `packages/engine/src/acceptance.test.ts`,
`proposals.ts`, `checklist.test.ts` and `fixture-ruleset-agreement.test.ts`, and the counts in
`docs/proposals/`, are category 4. The two in
`packages/engine/src/intake/scenario-intake-fixtures.ts` are comments as well, but the change already
opens that file to add the fixture, so they are corrected there rather than left stale.

**The two approved acceptance criteria are the expensive part, and they are named as such**: this
feature cannot add a seventh scenario without amending F-201 Acceptance Criterion 7 and F-101
Acceptance Criterion 1, which are other features' approved criteria under
`docs/DOCUMENTATION-GOVERNANCE.md` §7. That is each spec's owner plus the product owner, and it is a
coordination cost the fixture decision above should be weighed against rather than discovered during
implementation.

### Category 4 was too coarse and is SPLIT, because a comment can be an authority statement

Round 7 treated every comment as uniformly low-cost. **A comment that states WHERE AUTHORITY LIVES is
not a comment that mentions a version in passing**, and `packages/engine/src/intake/registry.ts:3` is
the proof: its opening comment says `rules/nyc-rules.v2.8.json` "owns the field list, the enums, and
the asked-when conditions". That is the engine's own contract documentation naming its authority, and
after the deletion it names a missing, superseded file. The test that separates them: **does the comment
present the named file as the CURRENT authority for something the code does, or is it scoped to the
version it names as a past fact?** The first becomes false on publication; the second stays true.

**Category 4a, AUTHORITY AND LIVE CITATIONS. Seven occurrences in seven files, and they move with the
version retarget.** The seventh was found by re-running the test over comments naming a CONSTANT that
Acceptance Criterion 8 moves rather than only those naming the file path, which is the same widening the
count sweep needed:

| File | What it states | Why it moves |
| --- | --- | --- |
| `packages/engine/src/intake/registry.ts:3` | the file "owns the field list, the enums, and the asked-when conditions" | the engine's contract documentation naming its authority |
| `packages/engine/src/proposals.ts:17` | the file "is published and immutable", which is why that module exists | asserts which artifact is currently published |
| `apps/web/app/verification-copy.ts:3` | the string is "mandated, not chosen", by the legend in that file | the live mandate for a shipped string |
| `apps/web/app/plan/plan-line.tsx:201` | the rendering rule, cited to "(published legend, `rules/nyc-rules.v2.8.json`)" | the live authority for a rendering decision |
| `apps/web/app/verification-copy-prose.test.ts:95` | "the formulation the published legend uses, in" that file | the citation behind the pattern the guard enforces |
| `apps/web/app/verification-copy.test.ts:12` | that file "calls it" the quoted legend text | the citation behind a live assertion about the current legend |
| **`apps/api/src/ruleset.ts:55-60`** | **`EXPECTED_RULESET_VERSION` "deliberately still names nyc.v2.8", and illustrates the guard with "a bump that publishes v2.9 without updating that constant"** | **Acceptance Criterion 8 moves that constant, so the sentence is false the moment the commit lands, and its illustration becomes the current version** |

**The footprint consequence, named rather than absorbed:** four of the seven are in `apps/web`, a lane
this feature otherwise does not touch, two are in `packages/engine`, and the seventh is in
`apps/api/src/ruleset.ts`, which the footprint already permits for the constants themselves. They are
comment-only edits with no behaviour attached, which makes them cheap, not free: the product owner
approves them, and the footprint gains those paths for comment text only.

**The re-run also found what does NOT move, and it is worth one line so nobody re-derives it.**
`apps/api/src/ruleset.ts:72` and `apps/web/app/rules-file.ts:128` name `EXPECTED_RULESET_VERSION` without
naming its value, so they stay true. `scripts/check-baseline-drift.mjs` uses `nyc.v2.8` and `nyc.v2.9` as
HYPOTHETICALS in comments about its own matching, which stay correct as illustrations; the only
cosmetic cost is that its "publishing v2.9" examples will name the version that actually shipped.
**Cited by content rather than by line, and re-counted after the round 13 rebase**: there are FOUR, not
the three an earlier round listed by line number, and the line numbers had all moved. They are the
comment on publishing v2.9 and deleting v2.8 turning every path into a miss, the `A BUMP DOES NOT BREAK
THE GUARD` suite note planting a v2.9-only tree, the nested-`EXPECTED_RULESET_VERSION` example, and the
comment recording that a `nyc-rules.v2.9.json` passed while the field and the pin still said `nyc.v2.8`.
The line-number citations went stale within a day of being written, which is the argument for content
citation stated by demonstration.

**Category 4b, PASSING MENTIONS AND HISTORICAL RECORDS, and they do not move.** **Re-counted in round
13 against the rebased tree, because PRs #170, #177, #182 and #183 landed on main while this branch was
open and three of them touched files in this category.** The classification is unchanged and the numbers
are not: `scripts/check-baseline-drift.mjs` now carries **forty-three** version mentions rather than the
twenty-five recorded before the rebase, and **seven** files under `docs/proposals/` name a version rather
than three. The load-bearing property was re-checked rather than carried over: **all forty-three of the
`check-baseline-drift.mjs` mentions are inside comments and none is executable**, verified by
partitioning the file's mentions into comment and code positions rather than by reading a sample. The
files: `docs/BASELINE.md`'s superseded-lineage rows for v2.7 and earlier,
`docs/VERIFICATION-SOURCES.md`'s dated round records, `docs/ARCHITECTURE-FUTURE.md`'s historical
references, the seven files under `docs/proposals/` that name a version, `packages/engine/src/types.ts:198` ("optional and
null throughout nyc.v2.8", which is scoped to the version it names and stays true),
`packages/engine/src/__fixtures__/published-ruleset.ts:4` and `apps/web/app/rules-file.ts:4` (both
narrating the hard-coding defect those modules exist to remove), `apps/web/app/pages.test.tsx:65`
(narrating a rejected approach), and the forty-three in `scripts/check-baseline-drift.mjs`, every one of
them commentary on path-matching bugs the guard has already fixed and none of them executable, which was
checked rather than assumed and re-checked after the rebase. **The cost of leaving them is stated rather than hidden:** they will name a
superseded version until they are next edited, and a reader who follows one learns a historical fact
rather than a wrong authority.

`specs/F-102-feasibility-verdict.md`'s single occurrence is in its `Updated:` history
line, which records a retarget rather than asserting the current version, so it does not move
either. **That is why the footprint permits F-102 nothing:** round 3 forbade touching it and this
derivation confirms nothing in it needs touching.

Three documents also state that `venue_has_assembly_approval` is read by no trigger
(`specs/F-101-event-intake.md`, `docs/ARCHITECTURE.md`, `docs/test-scenario-answer-key.md`). Those
statements become false the moment this feature lands and move with it.

### The pinned tests, DERIVED rather than listed

The footprint has been extended three rounds running by whatever a reviewer happened to find, so
this set is derived by search rather than by recall. **Method, so it can be re-run when the next
version publishes:** grep the non-`node_modules` TypeScript for the literal `nyc.v2.8`, for rule and
advisory count assertions, and for assertions over a complete set of published ids.

**Moves whenever the ruleset VERSION changes:**

| File | Line | Pin |
| --- | --- | --- |
| `apps/api/src/ruleset.ts` | 32 | `EXPECTED_RULESET_VERSION` |
| `apps/api/src/ruleset.test.ts` | 75, 112 | asserted version, and a fixture carrying it |
| `apps/api/src/ruleset.test.ts` | 76 | **`snapshotDate`. UNCONDITIONAL: rollout item 1 advances the date, so this pin always moves** |
| `apps/api/src/plan.test.ts` | 127 | `rulesetVersion` on the plan response |
| `packages/engine/src/engine.test.ts` | 972 | asserted version |
| `apps/api/src/ruleset.ts` | 324 | the version inside the offset diagnostic message, per the sweep below |

**Moves whenever a RULE is added:**

| File | Line | Pin |
| --- | --- | --- |
| `apps/api/src/ruleset.ts` | 33 | `EXPECTED_RULE_COUNT` (33) |
| `apps/api/src/ruleset.test.ts` | 78 | `rules` length (33) |
| `apps/api/src/ruleset.test.ts` | 368 to 370 | the `/expected 33 rules/` error expectation |
| `apps/api/src/ruleset.test.ts` | 980, 1022, 1038 | `permit_rules` row count (37, rules plus advisories) |
| `packages/engine/src/engine.test.ts` | 974 | merged `rules` length (37) |

**Moves whenever a scenario's FINDINGS change:**

| File | Pin |
| --- | --- |
| `packages/engine/src/acceptance.test.ts` | hard-coded finding sets per scenario |
| `packages/engine/src/fixture-ruleset-agreement.test.ts` | published rules against the answer key |
| `apps/api/src/plan.test.ts`, `apps/api/src/rules-snapshot.test.ts` | fixture expectations pinning plan output |
| `apps/api/src/checklist.test.ts` | complete per-scenario `ruleIds` lists, e.g. Scenario A at line 392 |

**Every conditional row audited, because the `snapshotDate` one had gone stale against Acceptance
Criterion 8 and a condition nobody re-reads is how that happens.** The `snapshotDate` row said it moves
only if the publication re-fetches a source, which was true when the rollout said nothing about the
date and false the moment rollout item 1 advanced it. An implementer following the old row would have
published the next ruleset with the test and the F-206 banner still pinned to July 26. It is now in the
unconditional table above. The rest:

| Row | Condition it carried | Resolved |
| --- | --- | --- |
| `ruleset.test.ts:76` `snapshotDate` | "only if the publication re-fetches a source" | **WRONG, removed.** Rollout item 1 advances `snapshot_date`, so it always moves |
| `ruleset.test.ts:77` `intakeFields` at 33 | "this feature adds no field" | **SETTLED by the route 1 decision: it does not move.** It was live for one round, because route 2 would have added a field and moved this pin, an `events` column and the registry. Route 1 adds none, so the count stays 33. **This is the ONLY number in this document that the decision changes** |
| `EXPECTED_ADVISORY_COUNT` | "only for a new advisory" | **settled false.** Both rules are `kind: note` and live in `rules`, not in `advisories` |
| `EXPECTED_SCHEMA` | "only for a schema change" | settled false; the feature publishes rules, not a schema change |
| `apps/api/src/checklist.test.ts` | "depends on which scenarios the new rule reaches" | **settled: it does not move.** Only Scenarios A and C are materialized into checklists in that suite, 40 cases on A and one on C, and neither reaches the gate. It stays in the footprint so a new fixture's checklist case is not blocked |

The `checklist.test.ts` resolution needed one more fact than round 3 had, and it is worth stating
because it cuts the other way from the obvious reading: `contextItems` pins complete rule-id lists too,
not only trackable `items`, so a `note`-kind finding WOULD move that assertion for any scenario the
rules reach. It is safe only because no such scenario is materialized in that suite today.

The first draft permitted only `packages/engine/src/ruleset.ts` under the engine, which made the
feature **unimplementable**.

Must not touch: `specs/F-102`, the plan view, the checklist, or any file owned by an in-flight core
feature. Coordination point: this feature produces assembly-coverage data that no criterion in this
spec renders, and it renders none of it, per the UI section. What another feature's criteria do with
that data is that feature's call; the two remain separate approvals.

## Rollout and Fallback

Rollout is one change or none. In it:

1. `rules/nyc-rules.v<next>.json` published with an advanced `snapshot_date`, and
   `rules/nyc-rules.v2.8.json` **deleted** and named in the footprint as deleted. `publishedRulesFile`
   throws unless exactly one published ruleset is present, so leaving v2.8 in place fails boot and
   deleting a file the footprint does not name is an out-of-footprint change. Round 3 required the
   deletion and permitted only the new file.
   **Its publication record is rewritten, not inherited.** Copying v2.8 and changing only the version
   and the date leaves three top-level keys describing the previous publication:
   - **`supersedes`** is an array, `["nyc.v1", "nyc.v2.1", ... "nyc.v2.7"]` in v2.8, eight entries and
     no `nyc.v2.8`. Appending `nyc.v2.8` is what puts v2.8 in the new artifact's lineage. Left as
     copied, the new file states that the version it replaces never existed.
   - **`status`** is prose carrying the ratification date and every republication. It gains this
     feature's approval, naming the product owner per the footprint audit above.
   - **`provenance`** is prose whose "CHANGE FROM nyc.v2.7" section describes the DOB-ASSEMBLY-001
     deadline correction. It is rewritten to describe THIS change: two new note rules and the field
     they consume. Left as copied, the new artifact claims v2.8's deadline correction as its own
     change.
     **It states what the rules DO and makes no claim about the approval's effect**, in either
     direction. An earlier revision of this item had it say the rules "assert no reduction", which is
     the affirmative effect claim the rest of this document spent three rounds removing: it tells a
     reader the approval reduces nothing, and `DOB-ASSEMBLY-001`'s verification block says the question
     is "NOT PUBLISHED in either direction". Provenance is published regulatory prose whether or not
     anything renders it, so the prohibition that governs `note_text` governs it identically. The
     honest formulation is the one the emission table uses: the rules record that the answer does not
     settle this event's filing.

   **Every string this rollout PUBLISHES was swept for the effect claim, not only the ones the plan
   renders.** Rounds 2, 4 and 9 each removed an affirmative reduction claim from somewhere, and it
   survived into `provenance` because the sweeps ran over rendered output. The unit is what the change
   PUBLISHES. There are six such strings and each is recorded with its verdict: `provenance`, which
   carried the claim and is corrected above; `status`, which records approval and names owners, and
   asserts nothing about the field; `supersedes`, version identifiers only; the `docs/BASELINE.md` row
   text, which by the existing pattern says each version was authorized "for the change named in its
   own `provenance`" and so restates no effect, and must keep pointing rather than summarising; and the
   two new rules' `output.note_text` and `verification.qualification`, both already constrained above
   and the second still BLOCKED on the product owner, who is the one person who may write it. The
   repository has no `CHANGELOG` file; the changelog for a ruleset IS the `provenance` string's "CHANGE
   FROM" section, which is why that one string is both entries.

   **`status` is the dangerous one, and the reason is that it IS validated.** `validateRuleset`
   requires `status` to be a string starting with `APPROVED` (`apps/api/src/ruleset.ts:511`), so a
   copied string passes the boot guard while carrying the previous publication's history: the check
   returns a false positive rather than no signal. `supersedes` and `provenance` are read by no code
   at all, confirmed by searching the tracked TypeScript and scripts, and neither
   `check-baseline-drift.mjs` nor `schema-contract.test.ts` asserts them. So all three ship stale in
   silence, which is this document's own recurring class: a claim in a published artifact that reads
   as verified and is not.
2. `EXPECTED_RULESET_VERSION` and `EXPECTED_RULE_COUNT` moved.
3. The `venue_has_assembly_approval` entry removed from `UNCONSUMED_INTAKE_FIELDS`, and **only**
   that entry: `food_affinity_private_exception_claimed` stays, because no rule in this feature
   consumes it and removing its exemption would fail `rejectUnconsumedFields` and stop the API
   booting.
4. **`docs/BASELINE.md` updated**: the current row repointed at the new path and version, its
   sha256 recomputed over the new bytes, and a superseded-lineage row recorded for v2.8 with its
   commit. Without this `pnpm check:baseline` fails, and the new artifact carries none of the
   approval metadata this spec requires of it.
5. The derived test pins updated, per the footprint, including the `snapshotDate` pin, which moves
   unconditionally because item 1 advances the date.
6. The answer key updated for Scenario F and Scenario A's rescope, plus, if the explicit-`no` path is
   covered as an approved scenario rather than as a unit case, the new scenario, its entry in
   `SCENARIO_INTAKE_FIXTURES`, `G` added to the two existing rules it reaches, and every scenario
   count in the sweep's category 5.
7. The current-version references in the approved documents updated, per the derivation in the
   footprint, **including `AGENTS.md` and `CONTRIBUTING.md`**. These are not documentation tidying:
   `AGENTS.md` tells every worker to open the ruleset before touching rules, plans or verdicts, so a
   stale path there makes the mandatory pre-work instruction unfollowable.
8. **The version literal in `apps/api/src/ruleset.ts:324`'s diagnostic message** moved, or derived
   from `EXPECTED_RULESET_VERSION` in the same file. It is executable text rather than an assertion,
   which is the category round 3's sweep did not model.
9. **The seven authority comments** in the sweep's category 4a retargeted:
   `packages/engine/src/intake/registry.ts`, `packages/engine/src/proposals.ts`,
   `apps/web/app/verification-copy.ts`, `apps/web/app/plan/plan-line.tsx`,
   `apps/web/app/verification-copy-prose.test.ts`, `apps/web/app/verification-copy.test.ts` and
   `apps/api/src/ruleset.ts:55-60`, whose explanation that the constant "deliberately still names
   nyc.v2.8" is falsified by item 2 of this same rollout. Comment
   text only, no behaviour, and no guard reads any of them, so like items 7 and 8 this ships green if
   it is forgotten. `registry.ts` is the one that matters most: it is the engine's own statement of
   which artifact owns the field list, the enums and the `asked_when` conditions.

Items 1 to 4 each fail independently: 1 and 2 at boot, 3 at load, 4 in CI. No subset starts. There is
no partial state worth shipping. **Two parts of the set fail nothing and are in it anyway.** Item 1's
publication record: a stale `supersedes` or `provenance` is read by no code, and a copied `status`
satisfies the one check there is. And items 7, 8 and 9: no guard reads `AGENTS.md`,
`CONTRIBUTING.md`, a diagnostic message or a comment, so a stale path in the contributor instructions
or in the engine's own contract documentation ships green and is discovered by the next worker who tries
to follow it. All of them are in the atomic set because they are unenforceable, not because something
will catch them. AC-08 lists them for the same reason.

Fallback is to publish nothing and leave the field in `UNCONSUMED_INTAKE_FIELDS`. That is the
current state, it is stable, and its cost is recorded honestly there: the field is collected and
answering it changes no output. The exemption mechanism exists precisely so this fallback is
visible rather than silent.

## Approval Blockers

**Only the entries tagged PREREQUISITE gate approval, and each names an owner who can act on it.** The
earlier rule, that every entry must resolve before this spec can be approved, made approval depend on
two things it should not: corrections this document has already made, which have no remaining action,
and work this feature explicitly excludes, which has no applicable owner here. Both are still recorded,
because the rest of the document cites them, and both are tagged for what they are:

- **PREREQUISITE.** An owner must decide something before this spec can be approved. Entries 1, 3, 5, 7,
  17, 18, 20 and 21.
- **DEPENDENCY, not a blocker.** True, relevant, and outside this feature or already tracked elsewhere.
  Entries 2, 4 and 6. Nothing in them is owed by anyone for this spec's approval.
- **RESOLVED, a record.** Corrected in the body above; kept so the reasoning that cites it still reads.
  Entries 8 to 16, with their content moved to the review-history section below.

**Entries 20 and 21 are new in round 12 and are the same defect in two places.** They take the next two
free positions: 19 is already held by round 11's resolved record, and positions are never reused. Round 11 made approval
gating explicit and precise, and two things that should gate approval were left untagged: the choice
between the two routes for covering the explicit-`no` path, and the assignment of an owner and an
approver. Both were recorded in the body, neither gated anything, and a document can be approved past a
recorded fact that nothing enforces. Tagging is the enforcement.

**Numbered positions are stable and are not reused**, because the body and PR #171's review threads cite
them by number. An entry that leaves this list leaves a one-line pointer at its position, which is what
was done for 13.

**Blocker 5 is the one that decides whether the feature can be published at all**, because it is the
conflict between the only honest verification status and the loader's source requirement, and route 1
does not touch it. **Blocker 18 is new in round 11 and is the one that decides WHEN**: three other pieces
of work are already promised the next ruleset version, and a fourth wants a publication too.

1. **PREREQUISITE. F-ID ASSIGNMENT, and the range is saturated.** Stage 1 (IDEATE) is stated in `docs/DESIGN.md`
   as F-101 to F-109, and all nine are assigned. `docs/ROADMAP.md` is the authoritative registry per
   the Feature ID Policy, and that policy also says "Closely related capabilities are absorbed into
   existing IDs rather than split". **The proposal, with reasoning and not a decision:** absorb this
   into **F-108 · Location & Authority Resolution**, whose subject is already which authority governs
   a given location, of which "which of this venue's authorisations reach my activity" is a
   specialisation. The alternative is a new id past the stated range, which extends Stage 1 beyond
   F-109 and needs the policy amended rather than stretched. This is the same class of problem as
   SPEC-CONFLICT #127, which is open on exactly this question of colliding and unassigned feature
   ids. **The product owner assigns; this spec does not.**
2. **DEPENDENCY. Issue #89** is open on this field, which is where the collected-but-unread state is
   tracked. Recorded so the two are read together; nobody owes this spec anything for it, and publishing
   the rules is what would close it.
3. **PREREQUISITE, product owner. The named-confirmation rule from issue #107 currently excludes this
   field.** The decision
   recorded there on 2026-07-28 is:

   > "A named confirmation may be published only for a field that cannot evaluate UNKNOWN."

   `venue_has_assembly_approval` is an unknown-capable enum, so it is deferred by that rule as
   written. This spec's finding is close in kind to a named confirmation. **The tension is
   recorded, not resolved:** whether it is a named confirmation for that rule's purposes, and
   therefore currently forbidden for exactly this field, is the product owner's call. Publishing a
   named confirmation for it is regulatory publication, so it is the product owner's approval under
   `docs/DOCUMENTATION-GOVERNANCE.md` §6, and that is the whole requirement even where the product
   owner authored it.
4. **DEPENDENCY. DOB-ASSEMBLY-001's coverage confirmation is unimplemented.** This feature produces
   assembly-coverage data that no criterion in this spec renders, and it renders none of it, per the
   UI section. Rendering it would sit in another feature's footprint, which this one excludes, and
   the status of another spec's criteria is not asserted here. No action is owed here.
5. **PREREQUISITE, product owner. Verification research** on whether an existing venue approval
   removes the temporary filing, per
   Fixtures and Verification above. Not established; the rule asserts no exemption in either
   direction.
   **And the artifact format has no slot for that state**, which is a second, separable blocker on the
   same fact. `validateRuleset` requires a source for every verification status except
   `COVERAGE_GAP`, while the published legend defines the only status whose meaning fits,
   `RESEARCH_REQUIRED`, as no source having been located. So these rules cannot be published truthfully
   without either a loader change (product owner, under §6's rules-schema
   row) or a legend amendment (product owner, and being regulatory status content that approval is the
   whole requirement under §6 even where the product owner authored it, as option 2
   under Outputs states). The four options and the
   refusal of each other legend value are under Outputs. Nothing in the current ruleset publishes
   `RESEARCH_REQUIRED`, so this feature would be its first use and the conflict is unexercised. Same
   shape as PR #170's finding that the schema cannot express a non-regulatory rule.
6. **DEPENDENCY. F-207 · Multi-Jurisdiction** is the home for an operator that travels between
   jurisdictions, and its own approval blocker is SPEC-CONFLICT #130, which is unresolved. Out of scope
   per non-goal 4, so nothing here gates this spec.
7. **PREREQUISITE, product owner. The manifest glob blocks the filename.** `docs/BASELINE.md` marks `specs/F-*.md` APPROVED, so
   this file cannot carry an `F-` prefix while it is PROPOSED without failing `check:baseline`, and
   a PROPOSED spec is not eligible for a manifest row. Either the glob narrows to the approved
   twelve, or PROPOSED specs live outside `specs/F-*`, or the id and the approval land together.
   Naming this file without the prefix is the only one of those three a worker can do alone, so it
   is what this branch does. The product owner decides the general rule.
8. ~~Round 2's two unbacked claims.~~ **RESOLVED, record.** Review history below.
9. ~~Round 3's defect created by round 2's narrowing.~~ **RESOLVED, record.** Review history below.
10. ~~Round 4's shape change.~~ **RESOLVED, record.** Review history below.
11. ~~Round 5's publication detail.~~ **RESOLVED, record.** Review history below.
12. ~~Round 6's four machinery findings.~~ **RESOLVED, record.** Review history below.
13. ~~**THE PREMISE IS NOT REPRESENTABLE IN INTAKE.**~~ **RESOLVED 2026-07-28 by the product owner:
    route 1, venue-neutral output**, recorded on PR #171
    (`https://github.com/jzeng151/pop-engine/pull/171#issuecomment-5107886102`) and stated in full under
    Purpose. It resolved this blocker and nothing else: blocker 5 stands, the F-id is still unassigned,
    and the publication cost is unchanged.
14. ~~Round 7's relationship framing and five sweep-unit defects.~~ **RESOLVED, record.** Review history
    below.
15. ~~Round 8's rule-id defect.~~ **RESOLVED, record.** Review history below.
16. ~~Round 10's two measured-against-scope claims.~~ **RESOLVED, record.** Review history below.
19. ~~Round 11's four applied findings.~~ **RESOLVED, record.** Review history below. The fifth,
    the collision on the next ruleset version, is blocker 18 above and is open.

17. **PREREQUISITE, product owner. Section structure diverges from the house shape,
    deliberately.** No PROPOSED spec exists in
   this repository to match: all twelve specs under `specs/` are APPROVED and use a shorter
   structure (User Story, Inputs, Outputs, Acceptance Criteria, Edge Cases, Scenarios Exercised).
   This spec follows the fuller structure it was briefed with and keys its criteria `F-1NN-AC-0N`,
   a format no existing spec uses; existing specs number criteria plainly and cross-reference them
   as "Acceptance Criterion N". Whether new specs adopt this structure, or this one is reshaped to
   match the twelve, is the product owner's call.

18. **PREREQUISITE, and it is a SCHEDULING DECISION ACROSS LANES rather than this spec's to take. THE
    NEXT RULESET VERSION IS ALREADY PROMISED TO OTHER WORK.** This rollout publishes `v<next>`, which by
    convention is nyc.v2.9, and includes none of the following:

    | Claim on v2.9 | Where it is recorded | What it changes |
    | --- | --- | --- |
    | the engine-conventions move for `proposals.ts` §7 | `packages/engine/src/proposals.ts:16-18`: the move "lands in a v2.9 publication, because `rules/nyc-rules.v2.8.json` is published and immutable" | moves engine-side contracts into the ruleset's `engine_conventions` |
    | `DOB-ASSEMBLY-001`'s source re-attribution | `docs/VERIFICATION-SOURCES.md:339`, the "v2.9 follow-up flag", and F-202's APPROVED status, which records that the planned publication "edits `deadline.qualification`" | corrects an attribution the repository already records as sitting on the wrong Table 28-112.8 row |
    | this feature's two rules | the rollout above | consumes the version, and would retain that attribution |

    **A fourth wants a publication too, and I have not seen it stated beside the other three.** The
    advisory reconciliation says in as many words that "Both outcomes require a publication. These are
    edits to an immutable artifact." So four pieces of work want the next version.
    **It is no longer a pending PR.** PR #177 merged, so this is now
    `docs/proposals/advisory-144-bounded-reconciliation-scope.md` on main and the claim is citable in the
    tree rather than in a review. Its content is unchanged by merging: it still requires a publication,
    so the collision is not resolved by its landing, only made easier to read.

    **Two shapes, and this document takes neither.** One publication carries all of it, in which case the
    atomic set above merges with theirs and the approvals union across lanes. Or this feature takes a
    later version, in which case its rollout renames `v<next>` and its lineage record gains whatever ships
    first. **Blocked on the other three pieces of work**: the `proposals.ts` move, the
    re-attribution flag that F-202's approved status depends on, and the reconciliation. All three
    are the product owner's to sequence. Nothing here reschedules anyone else's work.

    **Why it is correctness and not tidiness:** publishing this feature as v2.9 without the
    re-attribution ships a NEW artifact still carrying a source attribution the repository has already
    flagged as misleading, and F-202's approved status would then cite a publication that did not happen.

20. **PREREQUISITE, product owner. WHICH ROUTE COVERS THE EXPLICIT-`no` PATH must be chosen before
    this spec is approved, because the two routes are not the same specification.** Acceptance Criterion 3
    requires the explicit-`no` path covered, and this document specifies BOTH ways of covering it: an
    approved Scenario G, and an engine unit case against the published ruleset. The comparison is under
    the fixture section and is not repeated here.

    **Why this had to become a prerequisite rather than stay a preference.** Round 11 made approval
    gating explicit, and only tagged entries gate it. Untagged, this document could be approved carrying
    both routes, and two implementers reading the approved text would do materially different work: one
    writes a single test file; the other builds three fixture artifacts, edits two existing rules'
    metadata, adds a manifest row and moves fourteen scenario counts, two of which are other features'
    APPROVED acceptance criteria. An approved spec that admits both is not an approved specification of
    this feature. The gate is on the CHOICE, not on either option.

    **The preference is unchanged and is still a preference.** The product owner prefers the engine unit
    case IF it satisfies Acceptance Criterion 3 (PR #171,
    `https://github.com/jzeng151/pop-engine/pull/171#issuecomment-5107886102`). The condition is the
    whole of it, and it has not been answered. Whether a unit case can satisfy a
    criterion about the approved regulatory record is the product owner's to answer and not a cost
    comparison, which is why recording the preference does not close this. **Both options stay fully specified above until
    it is answered**, and neither is withdrawn by this entry.

21. **PREREQUISITE, product owner. THE LANE IS UNOWNED, and approval cannot assign it retroactively.**
    The header records the owner and the reviewer/approver as unassigned and points here. Nothing in this
    list required either to be filled, so the same gap round 11 closed for the route choice was open for
    the lane itself: this spec could reach APPROVED with no owner to implement it and no named approver
    to have approved it. `docs/DOCUMENTATION-GOVERNANCE.md` §6 assigns approvals by CHANGE CLASS and this
    feature's rollout lands in two of them, and since 2026-08-04 both classes are the product owner's,
    so the approver is already determined by the footprint audit above. **What is missing is the assignment, not the criteria.** The
    approver named here may be the sole signatory: the second-party review requirement was retired on
    2026-08-05 (product owner; see §6 and `docs/BASELINE.md`), so one person holding every lane is no
    longer an obstacle to approving this spec, and this entry stands for the assignment it names.

## Review history, resolved and requiring no action

Every entry below is a correction this document has already made, kept because the body cites them and
because a spec corrected in traceable steps is easier to review than one that hides it. **None gates
approval.**

8. **Round 2 removed a field and a state, and both were unbacked claims by this document.** The
   draft placed `food_affinity_private_exception_claimed` under host/guest semantics when its gate
   carries no venue term, and defined a NARROWED state asserting a reduction that DOB-ASSEMBLY-001's
   own verification block records as "NOT PUBLISHED in either direction". Both are corrected above.
   They are recorded here because a spec whose central non-goal is "do not assert unbacked
   coverage" made two unbacked coverage assertions in its first draft, and the reviewer caught them
   rather than the author.
9. **Round 3 fixed a defect round 2 created.** Removing the food field from the feature was right,
   and its consequence was not carried through: the footprint still told the implementer to remove
   two `UNCONSUMED_INTAKE_FIELDS` entries, and removing the food entry with no rule consuming it
   would fail `rejectUnconsumedFields` and stop the API booting. Recorded because it is the
   characteristic cost of a correct narrowing, and the way to catch it is to sweep for the plural
   rather than to edit the sentence that was flagged.
10. **Round 4 changed the feature's SHAPE, not its wording, and the shape is smaller.** Two findings
    said the spec could not be implemented as written. The plan states OPEN and UNRESOLVED were not
    representable in the shared `Finding` contract, and the spec simultaneously forbade implementing
    F-102 Acceptance Criterion 6 while claiming to populate its branch table. Both are resolved the
    same way: the feature emits an ORDINARY FINDING using fields the contract already carries, and
    the branch data is a consequence of the field becoming consumed rather than this feature's
    output. That keeps the footprint out of the shared contract, the API, persistence and the web
    lane entirely. Recorded because three rounds of this spec described output the product could not
    have produced, and no reviewer or author caught it until the contract was read.
11. **Round 5 found the reshape stopping at the boundary of the publication detail, three times.**
    Round 4 replaced two unrepresentable plan states with an ordinary finding and was right to. What
    it did not do was say WHICH rule: no id, kind, source, verification or dedupe decision, which in
    this repository is an instruction to invent regulatory metadata, and the two shapes an implementer
    could have chosen from that silence differ user-visibly (one merged permit line against a permit
    line plus a note). The approval row for the new artifact named the verification owner and the
    rules reviewer and not the engine owner, for the fourth time this session on a trigger-semantics
    change, so the whole table is now audited against §6 by class rather than by path. And the
    rollout prescribed the version and the date while leaving `supersedes`, `status` and `provenance`
    to be copied from v2.8. Two corrections came out of measuring rather than reasoning: an explicit
    `unknown` emits BOTH notes, and an in-scope OMISSION is an intake validation error rather than a
    plan state, which retired a mapping row and rewrote Acceptance Criterion 4.
12. **Round 6 found round 5's pinning right in the abstract and wrong against four specific pieces of
    machinery.** The verification status and the source block turned out to be a contract conflict
    rather than a wording choice, and it is the one finding this document cannot resolve: it is now
    reported with all four options, each other legend value refused on the published legend, and the
    owners named. The rest were the same mistake in different places, and the mistake is checking one
    path: `exercised_by_scenarios` was pinned identically on two rules with different triggers, so the
    `eq yes` rule claimed a fixture its own term cannot reach; the no-answer case was retired on
    the strength of `validateIntake` when the rescope path that produces it runs no validator; and the
    `name` fallback was read for what it puts in the heading without reading that `PlanLine` renders
    `noteText` again below it, so every note would have shown its sentence twice. Each output now
    states which of the five paths it was checked against, because three rounds running a conclusion
    true on one path was carried onto another where it is false.
13. ~~**THE PREMISE IS NOT REPRESENTABLE IN INTAKE.**~~ **RESOLVED 2026-07-28 by the product owner:
    route 1, venue-neutral output.** Recorded on PR #171
    (`https://github.com/jzeng151/pop-engine/pull/171#issuecomment-5107886102`); the section under
    Purpose states what a reader needs and cites that comment rather than restating it. Route 2, a
    relationship discriminator, is rejected rather than deferred, on the ground that
    `DOB-ASSEMBLY-001` records the effect as not published in either direction, so knowing there is a
    host would not change what the product may say. **This resolves this blocker and nothing else:**
    blocker 5 stands, the F-id is still unassigned, and the publication cost is unchanged. Left in the
    list rather than deleted, struck through, because the reasoning behind the other entries refers to
    it and a resolved blocker is a record.
14. **Round 7 found the framing asserting a relationship the intake cannot express, and five
    consequences of sweeping by the wrong unit.** The premise finding is blocker 13. The other five were
    all the same mistake: a sweep whose unit was too narrow. A reduction claim survived two rounds of
    state removals because the sweep looked for the word rather than for any statement of effect, and
    two more survivors turned up once it did: the user story's promise that the plan says what the
    approval does, and the Outputs section still announcing three plan states. The document sweep read
    two directories and so could not see `AGENTS.md` and `CONTRIBUTING.md`, which direct every
    contributor to the file the rollout deletes; it is now a sweep of every tracked file, sorted into
    instructions, executable literals, test assertions and comments, which also caught a version
    literal inside a diagnostic message. The footprint permitted the answer key without the fixture
    file its own required test reads. And a derived-test row still carried a condition Acceptance
    Criterion 8 had made unconditional, so every conditional row is now audited, which settled two of
    them and showed a third depends on blocker 13's route, which the product owner has since decided.
15. **Round 8 found the rule's own ID publishing the fact the spec forbids inferring, which no copy
    discipline elsewhere could have repaired.** `DOB-ASSEMBLY-HOST-HELD-001` named an approval as held,
    and its `eq yes` trigger is deliberately emitted on an explicit `unknown` and on an absent in-scope
    answer, so on the two cases this document exists to handle carefully the identifier asserted the
    thing nothing can infer. Rule ids render, and after PR #176 they render unconditionally. Both rules
    are renamed onto a subject-and-check axis, `DOB-ASSEMBLY-VENUE-APPROVAL-001` and `-002`, and every
    other string the feature introduces is audited against the same test, which tightened both note
    texts: neither may describe the answer, because each rule fires on three of them. The audit also
    found the same defect already shipped in `SLA-VENUE-LICENSE-001` and a double-rendered
    confirm-with-agency line, both reported and neither this footprint's to fix. Three consequences of
    the same not-looking: three rendered rule fields were neither pinned nor blocked while the table
    claimed all were, a new scenario moves two existing rules' metadata and fourteen scenario counts
    including two other features' approved acceptance criteria, and `verification.qualification` was
    filed as metadata when it renders to the operator as a paragraph. The scenario-count cost also
    surfaced a cheaper way to cover the explicit-`no` path, reported as a comparison for the
    verification owner.
16. **Round 10 found both remaining claims measured against this feature's scope rather than against
    the published product.** The edge case said a private venue below 75 produces no assembly output;
    `ADV-VENUE-OCCUPANCY-001` triggers on `location_type` alone, so it emits at any headcount, and its
    published text is about the below-75 case specifically. Every claim about output is now checked
    against a measured plan, which narrowed Acceptance Criterion 5 to the two new rule ids, scoped
    Acceptance Criterion 1's prohibition to the strings this feature publishes rather than to a plan
    that also carries an approved advisory, and turned Acceptance Criterion 4's `missingFacts`
    expectation from an unmeasurable claim into a mechanism observed on a field that is read. The second
    finding split the sweep's comment category: a comment stating WHERE AUTHORITY LIVES is not a comment
    mentioning a version in passing, six occurrences are the former and move with the retarget, and
    thirty-two are the latter and stay. `registry.ts` was filed as history while actively stating that
    the deleted file owns the field list, the enums and the `asked_when` conditions.

**Round 11.** **Applied four findings and opened one blocker.** The blocker is the collision on the next
    ruleset version, which is entry 18 and is not this spec's to resolve. The four: the count sweep was
    re-run for rules, advisories, fields and derived totals rather than scenarios alone, which found four
    more live contracts including `proposals.ts`'s "24 of the 37", where only the denominator moves; the
    category 4a test was re-run over comments naming a CONSTANT that Acceptance Criterion 8 moves rather
    than only the file path, which found a seventh; the blocker list was gating approval on this
    document's own corrections and on work it excludes, so entries are tagged PREREQUISITE, DEPENDENCY or
    RESOLVED and the numbering is frozen because the body and the review threads cite it; and the primary
    `yes` output would have shipped three copies of one confirmation instruction, of which the one inside
    this footprint is removed and the underlying double-render is reported and left.

**Round 12.** **Applied five findings, two of which put a gate on approval that the body had only
    described.** Round 11 made approval gating explicit and precise, and precision exposed two things
    that should gate approval and were not tagged: the choice of route for covering the explicit-`no`
    path, which left BOTH routes specified in an approvable document and two implementers reading the
    same approved text doing materially different work, and the assignment of an owner and an approver,
    which left the lane unowned at APPROVED. Both are now PREREQUISITE entries, 20 and 21, and neither
    decides the question it gates: the route preference is still a preference with its condition
    attached, and both options stay specified. The third finding is the same class as rounds 2, 4 and 9
    and is the reason the sweep unit changed again: the affirmative reduction claim those rounds removed
    from rendered output had survived in the ruleset's `provenance` string, which is published
    regulatory prose that nothing renders, so the sweep now runs over what the change PUBLISHES and each
    of the six such strings is recorded with its verdict. Two ambiguous restatements of the same
    prohibition, one in the emission table and one in the field-by-field pin, are rewritten as
    prohibitions rather than as claims. The last two are sweep-scope failures of the same shape: the
    scenario-count sweep had been run over directory lists rather than the repository root and missed
    three live requirements, `docs/ROADMAP.md:17`'s Phase 1 gate and two statements in
    `docs/ARCHITECTURE.md`, taking that list from eleven to fourteen; and the count sweep had been
    replacing numbers without asking whether each describes the CURRENT artifact or a named past version,
    which would have rewritten `docs/DESIGN.md:7`'s record of what `nyc.v2.1` contained. Eight of the
    nine count statements move and that one does not.

**Round 13.** **No review findings; a challenge to one of this document's own claims, and a rebase.**
    Round 12 reported two stale version pointers in `docs/DESIGN.md` and cited them by line number. The
    citation was challenged on the ground that those lines say something else, which is the right
    challenge to make of a document whose subject is stale references. Re-checked against `origin/main`
    rather than against a worktree: **both sentences are present and both name `nyc.v2.5`**, and the
    reason a line-number check missed them is that each sits at the END of a long line whose beginning
    says something else and correct. The finding stands and its citation does not, so it is restated by
    content, which is what this document already required of every other citation and had not applied to
    its own. The same current-versus-historical test was then run over that file's version pointers
    rather than only its counts: seven pointers, six naming the current artifact and one a past version
    as history, and the two stale ones are a partial retarget rather than an old document. The branch
    also rebased twenty-six commits onto main, which landed PRs #170, #177, #182 and #183 underneath it
    and moved three numbers this document states: the version mentions in `check-baseline-drift.mjs`, the
    count of files under `docs/proposals/` naming a version, and the number of v2.9 hypotheticals, whose
    line-number citations had all shifted within a day of being written. All three are re-derived against
    the rebased tree, and the reconciliation that wanted the next ruleset version is now a merged
    document on main rather than a pending PR.

**Round 14.** **A blocker that removed a claim from one section and left it standing in another.**
    Round 4 resolved the contradiction between forbidding F-102 Acceptance Criterion 6 and claiming
    to populate its branch table, and Approval Blocker 4 records the result in the form "the status
    of another spec's criteria is not asserted here". The UI section went on asserting it twice, on
    PR #170's finding: that the criterion is approved and never implemented, and that the branch
    data is not shown to an operator until it is. So the correction reached the blocker list and not
    the prose the blocker is about, which left this document contradicting its own resolved blocker
    at the point where a reader would act on it. Both sentences are removed and the section now says
    what this feature does, which is that it produces the branch data and renders none of it.
    Recorded because the defect is the shape of the fix rather than the finding: a blocker that
    states a conclusion does not sweep the document for the sentences that state the opposite, and
    round 3 recorded the same lesson about a narrowing whose consequence was not carried through.
