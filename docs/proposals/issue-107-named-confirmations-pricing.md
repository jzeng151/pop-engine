# Pricing brief: issue #107, named confirmations

**Status:** `PROPOSED`, which is one of governance section 3's five states. This document decides nothing; that is prose here rather than a status. Issue #107 says the line it proposes "is a proposal, not
a decision, and it is a rules-owner call", it needs a ruleset bump, and it moves approved answer-key
output. This document decides none of that. It prices it.

**Method:** every confirmation enumerated below follows from a published rule trigger or a published
intake field on `main` at `46971a0`. Nothing here was chosen because it reads well. No rule, ruleset,
spec, answer key, BASELINE row or engine file is changed by this document. Scenario and inventory
counts are historical measurements at that pinned commit, not claims about the active fixture on
current `main`: the shared issue #178 publication later applied issue #194's removal of
`food_affinity_private_exception_claimed` and F-110's replacement of
`venue_has_assembly_approval` with the PACO and FDNY permit-coverage fields.

**Headline, up front.** The proposed line largely does not reproduce Scenario B, the issue's own worked
example: three of the four absences that scenario names sit on a different axis from the one the line
measures, and one, sound, genuinely overlaps. It also makes the near-empty case noisier on every
measure. The API still requires a source snapshot, but the repository already records
SOURCE_CONFIRMED generator, battery and DEP threshold sources on FDNY-GENERATOR-001 and
DEP-GENERATOR-REG-001, backed by `VERIFICATION-SOURCES.md` Round 2 #10. Reuse, status and exact
confirmation text still needed regulatory approval at the pinned commit; source discovery for those
thresholds was not an unpaid cost. That approval has since completed: the current baseline and
nyc.v2.10 provenance record decision gate `msg_68b1f57ec560` for the exact source, status and text
contract. The framing and noise findings remain historical reasons to revisit the proposal; the
source correction reduced its cost without reopening the completed gate.

**Eighth revision.** The current baseline is now distinguished from the pinned pricing state:
decision gate `msg_68b1f57ec560` completed the source, status and confirmation-text approvals this
brief historically priced as pending, and nyc.v2.9 published the approved nine-rule result now
carried by nyc.v2.10.

**Seventh revision.** Four findings applied. The historical measured shape at `46971a0` now carries
all five qualifying unknown-valued fields across Scenarios E and F and all seventeen implementation
rules. The approval path has three independent classes, not four: the UI-copy row routes regulatory
claims to the regulatory-content class rather than adding another approval. Existing
SOURCE_CONFIRMED threshold sources remove the proposed source-research cost. Editing
`deadline.qualification` moves evaluated `notes` and triggers F-202's moved-deadline state notice
until checklist review, even though it moves no date, status or verdict.

**Sixth revision.** Two findings applied. The safe restriction covers TEN of seventeen rather than eight, which corrects a figure used in the decision recorded on issue #107. And consuming two of the seventeen fields fails API boot rather than a test, the second engine dependency found hiding inside a rules publication; a third is now named.

**Fifth revision.** Four further findings applied. One is NOT adopted as stated, and the document says why: the two conditionally asked booleans are safe, because a not-asked field makes its condition false rather than unknown, so nothing is emitted. One of my own sentences is withdrawn as having priced a field the registry does not contain. The 17-field inventory is now propagated to every downstream total with each derivation stated. A universal negative about agency publication is restated as what was searched and what was found, and the approval list is expanded beyond two, cited by row content rather than by a section number. The seventh revision corrects its final count to three.

**Fourth revision.** Four further findings applied, all verified through the guards named in section 3.
Two change conclusions: the count tables now describe the shape actually measured rather than a remedied
one, and the sequencing-bindings move is not publication-only, which changes whether the three v2.9 items
can share a bump. The inventory correction is the fourth, and this time the INCLUSION TEST is stated as
one sentence and applied to all 33 fields with every exclusion shown, because the previous three failures
came from an inconsistent rule rather than incomplete enumeration.

**Third revision.** Fifteen review findings across two rounds have been applied and each is marked
"Corrected in review" at the point it applies, so a reader who saw an earlier version can find what
moved. Two changed what the brief concludes: the overlap is one and not zero, and the near-empty
suppression is a pre-existing AC 4 defect rather than a cost of this proposal. This round adds section 0,
a defect in the proposed shape that outranks the costs, and it records a method change in section 3
after a verification failed the same way twice.

Counts that were guessed in earlier versions are now derived rather than spotted: the field inventory by
exhaustive enumeration over all 33 declared intake fields, and the answer-key item numbers by counting
each scenario's numbered findings. Both derivations are stated so they can be rerun.

---

## 0. A defect in the proposed shape, which outranks every cost below

**The mechanism can tell an organizer an absence was established when they answered that they did not
know.** Not a cost line: it is the invented-claim class, produced by the shape this brief is pricing,
and it is first because no cost matters if the shape states false things.

For an enum gate, `"unknown"` makes an `eq "no"` condition evaluate tri-state UNKNOWN,
`resolveFindings` emits every result other than false, and a classification rule carries a STATIC
`note_text`, so the sentence cannot hedge. Demonstrated with a synthetic confirmation rule keyed on
`event_open_to_public`, driven through `validateIntake` and then `evaluate`:

| answer | intake valid | confirmation emitted |
|---|---|---|
| `"no"` | yes | yes, correctly |
| `"unknown"` | yes | **yes**, stating "You told us this event is not open to the public" |
| `"yes"` | yes | no, correctly |

**Not hypothetical for the fixture suite pinned at `46971a0`.** Five fields in the corrected
historical inventory are answered `"unknown"`: `structure_over_10ft_tall` in Scenario E, and
`food_affinity_private_exception_claimed`, `sound_audible_from_public_way`,
`venue_license_covers_event_area` and `venue_has_assembly_approval` in Scenario F. A confirmation rule
on any of them would state a false absence in those two scenarios at that pinned commit. The first
and fourth Scenario F fields named here are superseded on current `main` as described in Method.

Options, unpriced and listed rather than recommended: an engine change so a classification emits only
on a TRUE trigger, which touches `resolveFindings` for every rule kind and needs the engine owner; a
rule-shape change carrying separate true and unknown text, which is a schema change needing its own
approved spec; restricting confirmations to boolean gates, which drops NINE of the seventeen fields, the seven
`"no"` enums plus both multi_enum fields, and drops exactly ONE of the issue's four named candidates,
`obstructs_public_way`, because `alcohol`, `generator_present` and `battery_present` are already
booleans. Corrected in review: an earlier version said five and two, which made this remedy look
cheaper on one axis and more destructive on the other. **Corrected in review, and the correction went further than the review did.** An earlier version said
this remedy is partial because "a nullable boolean left unanswered evaluates UNKNOWN". That priced a
field the registry does not contain: v2.8 carries exactly eight `nullable: true` fields and all eight are
numeric (`tent_area_sqft`, `tent_days_in_place`, `stage_height_ft`, `stage_area_sqft`,
`generator_gasoline_gallons`, `generator_diesel_gallons`, `generator_kw`, `battery_system_kwh`). No
boolean is nullable. Sentence withdrawn.

**Verified through the guards in order, and boolean-only turns out to be TOTAL for booleans rather than
partial.** Guard 1 `parseIntakeContract`, guard 2 `validateIntake`, guard 3 `evaluate`. All three routes
by which a boolean could reach an unknown state are closed:

| Route | Result | Where |
|---|---|---|
| asked, answered `"unknown"` | rejected `invalid_value` | `validateIntake` |
| asked, `null` | rejected `required` | `validateIntake` |
| asked, omitted | rejected `required` | `validateIntake`, the non-nullable branch |
| **not asked** | condition evaluates `"false"`, so the trigger is false and `resolveFindings` skips the rule: **silence, not a false confirmation** | `conditions.ts` `resolveAnswer` returns a `not_asked` state distinct from `unknown`, and the condition branch for it returns `"false"`; `findings.ts` continues on a false result |

So an asked boolean is necessarily `true` or `false`, and an unasked one produces nothing. Measured
directly: a synthetic confirmation rule on `plaza_multiple_blocks` and on `has_amusement_ride`, under
both `bool` and `eq` operators, emits NOTHING in Scenario A where neither is asked, while the same rule
on `alcohol`, which is asked and answered false, emits.

**A review finding is not adopted here, and this is why.** The review held that the two conditionally
asked booleans, `plaza_multiple_blocks` (asked when `sapo_event_type = plaza_event`) and
`has_amusement_ride` (asked when `= block_party`), are unsafe because an unasked field resolves FALSE
and so an `eq false` trigger would emit a false absence. The mechanism half is right, the consequence
does not follow: resolving false makes the CONDITION false, which makes the trigger false, which is
exactly the case `resolveFindings` skips. Nothing is emitted, so there is no false confirmation by that
route. The engine distinguishes "never asked" from "answered no" and the shape reads the distinction
correctly.

**The useful consequence, which cuts toward the proposal rather than against it.** The `not_asked` state
already implements the issue's own second half, stay silent when the absence follows from something the
organizer never mentioned, at the engine level and without a rule change. Whatever line is chosen, that
half is free for any gate whose `asked_when` is not satisfied.

**Corrected in review, and this changes a figure the product owner has already used.** An earlier
version said the safe restriction covers eight fields and drops nine. It covers **ten and drops seven**,
because both multi_enum fields are safe by the same argument as the booleans and were wrongly grouped
with the enums.

`structure_types` and `open_flame_or_cooking` are always asked, non-nullable, and neither declares
`"unknown"` among its values. Verified through the guards in order, guard 1 `parseIntakeContract`,
guard 2 `validateIntake`, guard 3 `evaluate`, every route to an unknown state is closed on both:

| Route | structure_types | open_flame_or_cooking |
|---|---|---|
| explicit `"unknown"` | `invalid_value` | `invalid_value` |
| `["unknown"]` | `invalid_value` | `invalid_value` |
| `null` | `required` | `required` |
| omitted | `required` | `required` |
| `[]` empty | `invalid_value` | `invalid_value` |
| answered `["none"]` | confirmation emits correctly | confirmation emits correctly |

**So the safe split is ten of seventeen covered and seven dropped, and the seven dropped are exactly the
seven unknown-capable enums.** The seven are `obstructs_public_way`, `event_open_to_public`,
`food_affinity_private_exception_claimed`, `sound_audible_from_public_way`, `structure_over_10ft_tall`,
`venue_license_covers_event_area` and `venue_has_assembly_approval`. That is a cleaner boundary than the
earlier figures suggested: the restriction drops precisely the fields section 0's defect can reach, and
nothing else.

**This figure is recorded elsewhere.** The decision recorded on issue #107 used the eight-and-nine split.
On the corrected numbers the remedy costs two fewer fields than that record assumes, which is stated
here so the record can be amended against it rather than left to be rediscovered.

What remains partial is coverage, not safety; or accepting that the proposal does not work for enum gates
as shaped.

## 1. The proposed line, applied

The line: name an absence when the organizer answered a question specifically to establish it, and
stay silent when the absence follows from something they never mentioned.

### The issue's four candidates are not the complete set under that test

Read as "a declared intake field the organizer is asked, whose negative answer establishes an
absence", the ruleset has **seventeen** such fields, not four.

**Corrected in review for the FOURTH time, and the previous three failed for a reason worth naming: the
enumeration was exhaustive but the INCLUSION RULE was not consistent.** Round 3 included
`generator_present` and `battery_present` although no trigger reads them, then excluded
`venue_has_assembly_approval` for exactly that condition. A rule applied inconsistently cannot be
saved by enumerating harder, which is why round 3's derivation still missed three fields.

**The test, in one sentence, and it is the only criterion used.** A field qualifies when the organizer
is asked it AND its declared domain contains a value whose meaning is the absence of the thing the
field names. Deliberately independent of whether any trigger reads it, which is the inconsistency
above.

Applied mechanically to all 33 declared fields: **17 qualify**. The 16 that do not are listed below
WITH their test result, so a fifth correction has nowhere to hide:

| Excluded field | Type | Why it fails the test |
|---|---|---|
| `borough`, `location_type`, `sapo_event_type`, `street_event_size`, `plaza_level` | enum | no value in the declared domain means absence; every value names a thing that is present |
| `headcount`, `event_date`, `food_vendor_count`, `tent_area_sqft`, `tent_days_in_place`, `stage_height_ft`, `stage_area_sqft`, `generator_gasoline_gallons`, `generator_diesel_gallons`, `generator_kw`, `battery_system_kwh` | integer, number, date | no absence value in the domain; zero is a quantity, not an absence |

The three fields this pass adds over round 3 are `venue_has_assembly_approval`, which the review named,
plus `plaza_multiple_blocks` and `food_affinity_private_exception_claimed`, which it did not. The
earlier derivation method is kept below because it is still how the rule-out column was computed, but
it is no longer what decides inclusion.

**The superseded method, retained because the rule-out column still uses it.** For all 33 declared intake fields, take each field's negative values from its DECLARED domain
only (`false` for a boolean, `["none"]` for a multi_enum that declares `none`, `"no"` for an enum that
declares it). Then for every condition in every rule trigger that reads that field, decide
mechanically whether the negative makes the condition false, which rules the rule out, or true, which
triggers it. That is exhaustive over the field list rather than over the fields anyone happened to
notice, and it is why this pass found `venue_license_covers_event_area`, which neither the earlier
versions nor the review named.

The result is 11 fields whose negative rules out at least one rule, plus 3 that establish an absence
while ruling out nothing because no trigger reads them (`obstructs_public_way`, whose `"no"` TRIGGERS
SAPO-SCOPE-001 rather than ruling anything out, and `generator_present` and `battery_present`).
Fourteen in total. Four are MIXED, ruling one thing out while triggering another:
`event_open_to_public`, `sound_audible_from_public_way`, `venue_license_covers_event_area`, and
`obstructs_public_way` in the pure-trigger direction.

| Field | Negative value | In the issue? | Rules whose trigger reads it |
|---|---|---|---|
| `obstructs_public_way` | `"no"` | yes | 1: SAPO-SCOPE-001 |
| `alcohol` | `false` | yes | 5: ADV-ALCOHOL-PUBLIC-001, SAPO-BLOCK-PARTY-ELIG-001, SLA-CATERING-001, SLA-ONEDAY-001, SLA-VENUE-LICENSE-001 |
| `generator_present` | `false` | yes | **0** |
| `battery_present` | `false` | yes | **0** |
| `food_present` | `false` | **no** | 3: DOHMH-EXEMPTION-001, DOHMH-ORGANIZER-NOTIFY-001, DOHMH-VENDOR-PERMIT-001 |
| `selling_anything` | `false` | **no** | 2: PARKS-TUA-001, SAPO-BLOCK-PARTY-ELIG-001 |
| `amplified_sound` | `false` | **no** | 3: ADV-NOISE-CODE-001, NYPD-SOUND-001, NYPD-SOUND-PARKS-DEP-001 |
| `structure_types` | `["none"]` | **no** | 4: DOB-PROP-TRUSS-001, DOB-STAGE-001, DOB-TALL-STRUCTURE-001, DOB-TENT-001 |
| `open_flame_or_cooking` | `["none"]` | **no** | 3: FDNY-FUEL-001, FDNY-OPENFLAME-001, PARKS-PROPANE-001 |
| `has_amusement_ride` | `false` | **no** | 1: SAPO-INSURANCE-BLOCK-PARTY-RIDE-001 |
| `event_open_to_public` | `"no"` | **no** | 2 ruled out of 3 that read it: DOHMH-VENDOR-PERMIT-001 and DOHMH-ORGANIZER-NOTIFY-001 both require `"yes"`; DOHMH-EXEMPTION-001 fires ON `"no"` |
| `sound_audible_from_public_way` | `"no"` | **no** | 1: NYPD-SOUND-001's private-venue branch. MIXED: also triggers ADV-NOISE-CODE-001 |
| `structure_over_10ft_tall` | `"no"` | **no** | 1: DOB-TALL-STRUCTURE-001, when its structure condition holds |
| `venue_license_covers_event_area` | `"no"` | **no** | 1: SLA-VENUE-LICENSE-001. MIXED: also triggers SLA-CATERING-001 and SLA-ONEDAY-001 |

Three observations, each verified rather than inferred:

1. **Two of the four named candidates are read by no trigger at all.** `generator_present` and
   `battery_present` appear in no rule's trigger. FDNY-GENERATOR-001 reads
   `generator_gasoline_gallons`, `generator_diesel_gallons` and `battery_system_kwh`;
   DEP-GENERATOR-REG-001 reads `generator_kw`. The two `_present` booleans are consumed only by
   *scoping* those quantity questions, which is what nyc.v2.5 added them for, and is why they are
   absent from `UNCONSUMED_INTAKE_FIELDS`. A confirmation rule keyed on either would be the first
   trigger in the ruleset to read it. That is mechanically fine, and it means the confirmation's
   warrant is "you told us there is none, so the quantity question was never asked" rather than "this
   answer ruled out rule X".
2. **One of the four is already implemented.** `obstructs_public_way = "no"` is exactly
   SAPO-SCOPE-001's second trigger condition. That confirmation exists today.
3. **Thirteen fields that pass the same test are not named.** Corrected in review: this said seven,
   which was left on the pre-correction inventory. Derivation: 17 qualifying fields minus the issue's
   four named candidates. Of the 13, nine have at least one rule their negative rules out; the other
   four qualify on the inclusion test while no trigger reads them.
4. **`event_open_to_public = "no"` is a mixed case and belongs in the inventory with that stated.** It
   rules out the two DOHMH rules that require `"yes"` and simultaneously TRIGGERS
   DOHMH-EXEMPTION-001, which fires on `"no"` or `"unknown"`. So one answer both establishes an
   absence and produces a finding. An earlier version of this brief excluded it for the second half of
   that and lost the first half, which was wrong: the test asks whether an answer established an
   absence, not whether it did only that.

### Confirmations per scenario

Fixture answers read from `packages/engine/src/intake/scenario-intake-fixtures.ts` at `46971a0`. A
field contributes only when its answer is the negative value and the field was in scope.

Under the **seventeen-field** reading:

| Scenario | Confirmation set | Count |
|---|---|---|
| A | alcohol, structures, open flame, generator, battery | 5 |
| B | alcohol, selling, amplified sound, structures, open flame, generator, battery | 7 |
| C | alcohol, food, selling, structures, open flame, generator, battery | 7 |
| D | alcohol, food, selling, structures, generator, battery, **amusement ride** | 7 |
| E | alcohol, selling, open flame, battery, **multiple plaza blocks** | 5 |
| F | selling, structures, open flame, generator, battery, **not open to the public** | 6 |

**Corrected in review, and this is the correction that matters most for the noise argument.** The
earlier tables treated the unknown-answered fields as contributing nothing. Section 0 establishes, by
driving it through the guards, that an `eq "no"` trigger on an `"unknown"` answer STILL EMITS. Those two
cannot both stand, and treating the unknowns as silent assumed one of the four remedies section 0 lists
as UNPRICED. So the table below is **the shape actually measured**, with no remedy assumed:

| Scenario | true confirmations | FALSE confirmations, from an unknown answer | total lines | rendered sentences |
|---|---|---|---|---|
| A | 5 | 0 | 5 | 10 |
| B | 7 | 0 | 7 | 14 |
| C | 7 | 0 | 7 | 14 |
| D | 7 | 0 | 7 | 14 |
| E | 5 | 1 (`structure_over_10ft_tall`) | 6 | 12 |
| F | 6 | **4** (`food_affinity_private_exception_claimed`, `sound_audible_from_public_way`, `venue_license_covers_event_area`, `venue_has_assembly_approval`) | **10** | **20** |

Mean 7.0 lines, range 5 to 10, and 14 rendered sentences on average once section 3's duplication is
included.

**Two things this changes.** At the pinned commit, Scenario F carries four false statements out of ten
confirmations, so the defect is not a corner case in that suite but 40 percent of one scenario's
confirmations. And the two review findings compound: the inventory correction and the unknown
correction each add to F, so fixing either alone would still have understated it. The earlier figures
of 4 and 6 for E and F were low on both axes.

A table for a REMEDIED shape, in which unknown answers emit nothing, is the true column of the table
above: A 5, B 7, C 7, D 7, E 5, F 6. Corrected in review: an earlier version gave E 4 and F 6, which
predated the 17-field inventory; E gains `plaza_multiple_blocks` and F gains `event_open_to_public` as
true confirmations. It is **conditional on a remedy nobody has chosen** and is labelled that
way rather than presented as the measurement.

**The rule count and fixture count are different numbers.** Five qualifying fields are answered
`"unknown"` across Scenarios E and F, so they contribute five false confirmations in the measured
unsafe shape and no confirmations in a remedied shape. An implementation of the full inclusion test
must carry SEVENTEEN rules, while the fixtures display 5 to 10 lines in the measured shape and 5 to 7
in a remedied one. Derivation: the rule count is the inclusion test's 17; the line counts are the
totals column and the true column of the table above. The gap matters twice: it is unmeasured noise for
any real organizer who answers those fields negatively, and under section 0 it is exactly where a
false confirmation would be stated in Scenarios E and F.

Under the issue's **four-field** reading:

| Scenario | Confirmation set | Count |
|---|---|---|
| A | alcohol, generator, battery | 3 |
| B | alcohol, generator, battery | 3 |
| C | alcohol, generator, battery | 3 |
| D | alcohol, generator, battery | 3 |
| E | alcohol, battery | 2 |
| F | generator, battery | 2 |

Mean 2.7, range 2 to 3.

**`obstructs_public_way` produces zero confirmations in all six scenarios.** It is `"yes"` in A, D and
E, and out of scope in B, C and F, which are private venue and park. That is the same reason
SAPO-SCOPE-001 carries `exercised_by_scenarios: []`: no fixture has a street activity with no
obstruction. So of the four named candidates, one never fires in the suite and two are read by no
trigger.

---

## 2. What the answer key would gain, per scenario

The text below is what would be added, in the key's existing register. It is illustrative of the
movement, not proposed wording, since the wording is part of the decision.

**Corrected in review: the shape does not produce one combined sentence.** `resolveFindings` emits one
finding per triggered rule and `PlanView` renders each as its own `PlanLine`, so three confirmation
rules produce THREE plan lines, not the single line illustrated below. A shared `dedupe_key` does not
combine them either: `mergeFindings` spreads the first finding and takes `noteText: first.noteText ??
second.noteText`, so the first rule's `name` and `noteText` win and the others' text is dropped rather
than concatenated.

So the one-line-per-scenario illustration below is what an AGGREGATED rendering would look like, and
aggregation does not exist. Producing it needs one of: a rendering change that groups
`no_new_requirement` notes into a single line, an engine change that aggregates them into one finding,
or a new contract shape for a multi-text finding. That is unpriced engineering work on top of the
rules, and it is additional to the answer-key movement. What the current shape renders instead is one
plan line per confirmation, each with the note text in its title position.

With that caveat, under the four-field reading each scenario's expected-findings block gains, in
aggregated form:

- **A:** `6. Confirmations: no alcohol, no generator, no battery system stated in your answers.`
- **B:** `5. Confirmations: no alcohol, no generator, no battery system stated in your answers.`
- **C:** `5. Confirmations: no alcohol, no generator, no battery system stated in your answers.`
- **D:** `6. Confirmations: no alcohol, no generator, no battery system stated in your answers.`
- **E:** `9. Confirmations: no alcohol, no battery system stated in your answers.`
- **F:** `6. Confirmations: no generator, no battery system stated in your answers.`

Under the seventeen-field reading the same line carries 5 to 10 items instead of 2 to 3, or 5 to 10
separate plan lines in the shape measured at `46971a0`, doubling to 10 to 20 rendered sentences once
section 3's duplication is included. Corrected in review: this said eleven-field and 4 to 7.

### It contradicts an APPROVED artifact, which is a SPEC-CONFLICT rather than answer-key movement

`docs/DESIGN.md`'s demo plan requires Scenario B to render "no new city event requirement identified
from your answers" plus **exactly two confirmations**. The four-field interpretation produces three for
Scenario B; the seventeen-field reading produces seven true confirmations for B, and ten lines for F once false ones are counted. Both contradict an approved document, and under
governance section 5 that is filed and resolved rather than priced as movement.

**One ambiguity has to be resolved first, and it may be the whole of it.** DESIGN's sentence continues
"The system that says 'almost nothing, and here's what to confirm' is the system you trust", which reads
as the two things Scenario B tells the organizer to CONFIRM, its occupancy question and its DOHMH
question, and not as two named absences. F-201 AC 4 uses "named confirmations" for the absences. Neither
document defines the term, and nothing else in PRD, DESIGN or F-201 uses it. So there are three branches,
all decisions:

- the two uses mean the same thing, and DESIGN's "exactly two" contradicts the proposal directly;
- they mean different things, and two approved artifacts use one word for two concepts, which is the
  same defect shape #136 resolved for "coverage";
- the term is defined, which settles both.

Recorded as a conflict either way, because on the first reading the count is wrong and on the second the
vocabulary is.

Two consequences for the key that are not optional:

- Scenario B's finding 4, "No SAPO, no sound permit, no assembly permit, no insurance findings",
  and its verdict copy, "No street, park, sound, or assembly permits identified from your answers",
  both become inconsistent with the generated set. See section 5; they name absences the proposed
  line would not produce.
- `exercised_by_scenarios` on each new rule must list every scenario it fires in, and
  `fixture-ruleset-agreement.test.ts` checks that in **both** directions, with named cases for
  "claims-scenario-it-cannot-reach" and "reaches-scenario-it-omits". A confirmation rule firing in all
  six must list all six.
- **Corrected in review: that metadata is not sufficient.** The guard's
  "Scenario %s reaches nothing the answer key omits" case extracts rule IDs from each scenario's
  expected-findings block and fails on any rule `reachedIn(scenario)` returns that the block does not
  NAME. The illustrated `Confirmations:` lines carry no rule IDs, so every confirmation rule fails that
  case even with perfect coverage metadata. So the key must name each confirmation rule by ID, which
  makes the added text longer than illustrated and multiplies the answer-key movement by the rule count,
  or the comparison itself needs an approved change. Both are costs and neither was priced.

---

## 3. Is the shape followable? Yes, and one thing is registered by name

**Corrected in review: the earlier verification here was invalid, and this is the SECOND time the same
method failed.** Flipping Scenario A's `obstructs_public_way` to `"no"` leaves `sapo_event_type` and
`street_event_size` in the submission, but the registry stops asking them once obstruction is no, so
`validateIntake` rejects it. Rerun through the guarded path, that intake produces two errors:

```
sapo_event_type      not_applicable: only asked when obstructs_public_way != no
street_event_size    not_applicable: only asked when sapo_event_type = street_event
```

So "verified by evaluating a real intake" was not established. Removing the two now-unasked answers
gives an intake `validateIntake` accepts with zero errors, and on THAT intake the shape does reach the
plan:

```
findings total = 4
SAPO-SCOPE-001 present as a finding = true
  kind = "note"            (the engine maps classification to note)
  disposition = "no_new_requirement"
  deadlineStatus = "not_applicable"
  name = the full note_text
  noteText = the full note_text
  agency = null, deadline = null, latestApplyDate = null, feeDisplay = null
  sources = 1, carrying the rule's citation and URL
```

So a new rule of that shape validates, evaluates, becomes `kind: note`, carries its message, and
arrives as a finding with a source. Nothing about the path is special-cased. The conclusion survives the
corrected experiment; the earlier evidence for it did not.

### The method that keeps proving less than it appears to, and what I am changing

Twice now a verification here has used an engine-level call in place of a path the API guards. Round 2
found the first instance, `parseEngineRuleset` exercising the laxer of two parsers and hiding the source
requirement. Round 3 found the second, a direct `evaluate` call hiding `validateIntake`. Same shape both
times, and a method that fails the same way twice deserves more attention than any number it produced.

What changes, stated so it can be held against me: **any claim in this brief about what the product does
is driven through the guards the product uses, in order, and the claim names which guards it passed.**
For a ruleset claim that is the API's `validateRuleset` rather than the engine's parser. For an intake
claim it is `parseIntakeContract` plus `validateIntake` before `evaluate`, and an intake that fails
validation is reported as a failure rather than worked around. Where a claim is genuinely about engine
behaviour alone, as section 0's tri-state demonstration is, it says so and says why the guard does not
apply. Every experiment in this revision was rerun on that basis, which is how the intake in section 0
turned out to need `food_affinity_private_exception_claimed` supplied before it would validate at all.

Four costs are registered rather than automatic, and each is a deliberate guard:

1. **`apps/api/src/ruleset.ts` pins `EXPECTED_RULE_COUNT = 33`** and boot fails on any other count.
   Each added rule changes it.
2. **The agency exemption is pinned by exact equality.** `apps/api/src/ruleset.test.ts` asserts the
   list of rules that may omit `agency` with `.toEqual([...])`, and its comment says "A future rule
   that quietly joins either list has to change this test." A confirmation rule has no agency, so
   every one must be added there by name.
3. **`apps/api/src/ruleset.test.ts` pins `rules` at 33 and `advisories` at 4.**
4. **The fixture-agreement guard checks `exercised_by_scenarios` both ways**, as above.

### Source boot cost: required, but the relevant source research is already on file

**These rules cannot boot without an approved regulatory source.** `apps/api/src/ruleset.ts` refuses a
rule whose `source` is absent unless its verification status is COVERAGE_GAP, and `parseSource`
requires a nonempty `citation` string plus a `urls` array with at least one non-empty entry. F-201
permits an empty source snapshot only for a source-less coverage gap.

The earlier version priced source discovery for `generator_present` and `battery_present`. That cost
is already paid for the threshold paths the confirmations summarize:

- FDNY-GENERATOR-001 publishes SOURCE_CONFIRMED gasoline, diesel and battery thresholds with a source
  snapshot and evidence `VS Round2 #10`;
- DEP-GENERATOR-REG-001 publishes the SOURCE_CONFIRMED 40 kW registration threshold with the same
  evidence; and
- `docs/VERIFICATION-SOURCES.md` Round 2 #10 records the fetched FDNY, battery and DEP threshold text.

Those records do not make arbitrary absence copy safe. They do mean a cautiously bounded
"no published generator/battery path identified from these answers" classification can reuse existing
source work rather than commissioning new threshold research. At `46971a0`, the verification owner
and rules reviewer still needed to approve the exact source reuse, verification state and
organizer-visible text. That historical cost is now complete: `docs/BASELINE.md`'s 2026-07-29 issue
#107 decision and nyc.v2.10's provenance both record decision gate `msg_68b1f57ec560`, and the
published confirmation rules carry the approved source, status and text. A broader exemption claim
would still exceed those sources and require separate evidence.

The SAPO experiment still exposes a real engineering constraint: it used `parseEngineRuleset`, whose
`parseSource` accepts an absent source, while API boot rejects one. Confirmation rules therefore must
carry the approved snapshot; the correction is that suitable source records already exist, not that
the API requirement disappears.

**Corrected in review: each confirmation renders its sentence TWICE.** The parser sets both `name` and
`noteText` from `output.note_text`, verified on the corrected experiment above where `name === noteText`
was true, and `PlanLine` renders `name` in the heading and `noteText` again in the note paragraph, gated
only on `noteText !== null && noteText !== conflictText`. So the volume is double what the earlier
measurement reported:

| Scenario | confirmations | rendered sentences |
|---|---|---|
| A | 5 | 10 |
| B | 7 | 14 |
| C | 7 | 14 |
| D | 7 | 14 |
| E | 6 | 12 |
| F | 10 | 20 |

Scenario B therefore carries **14 rendered absence sentences beside 3 substantive findings** unless the
rule shape or the renderer changes, which compounds rather than qualifies the noise finding in section 5.
Avoiding it means either a rule shape that separates a short title from the sentence, or a renderer that
suppresses `noteText` when it equals `name`. Both are unpriced.

One further presentational consequence of the same mapping: the heading is the whole sentence, so the
line has no short title at all. SAPO-SCOPE-001's is two sentences and reads as a paragraph in the title position. Short
confirmation text is therefore a UI requirement, not a style preference.

---

## 4. F-102 drift: the premise needs correcting

The issue says F-102's verdict copy "should stop hand-writing the list and render the confirmations
instead". There is no hand-written list in F-102 or in any code to stop hand-writing.

- The only place the list exists is `docs/test-scenario-answer-key.md`, in Scenario B's verdict copy.
  It is a fixture expectation.
- What ships is `apps/web/app/plan/plan-view.tsx`, which renders one generic sentence, "No new city
  event requirement identified from your answers.", with **no list of absent permit types**. A repo
  search for any code emitting such a list returns nothing.
- So Scenario B's approved copy is currently unimplemented, which is consistent with the issue's
  overall claim, but the work is *adding* a capability rather than replacing existing product copy.

### A pre-existing AC 4 defect, which this proposal does not cause

**Corrected in review. This is not a cost of the proposal.** That sentence renders only when
`plan.findings.length === 0`, and Scenario B already produces THREE engine findings today, so the
near-empty sentence is already suppressed for the very scenario F-201 AC 4 cites as its example.
Measured on the published ruleset: DOHMH-VENDOR-PERMIT-001, DOHMH-ORGANIZER-NOTIFY-001 and
ADV-VENUE-OCCUPANCY-001. So the near-empty definition is already broken and confirmations would not
newly switch off a working path. An earlier version of this brief presented it as the proposal's
sharpest implementation cost, which was wrong.

It is still a real defect and still worth knowing, and it belongs to AC 4's current implementation as
independent work. Two specifics for whoever picks it up:

- The obvious fix does not work either. A near-empty test counting only findings with a requirement
  disposition would still be suppressed for Scenario B, because DOHMH-VENDOR-PERMIT-001's disposition
  is `required`. Measured, not assumed.
- What confirmations WOULD add is volume to a path that is already not rendering, so the interaction is
  additive to an existing defect rather than causal of a new one.

---

## 5. THE QUESTION: does Scenario B get clearer or noisier? Noisier, and the line misses it entirely

**Volume.** Scenario B has three substantive findings today. Under the four-field reading it becomes
three findings plus three confirmations, so half the plan is absences. Under the seventeen-field reading it
becomes three plus seven, so 70 percent of the plan is absences. There is no reading under which the
near-empty case gets shorter, and the case whose entire purpose is to look trustworthy when almost
nothing applies is the case that grows most, because it has the most negative answers.

**Worse than volume: the sets do not match.** Scenario B's approved output names four absences. Here
is what the proposed line does with each:

| Absence the approved copy names | Where it comes from | Proposed line |
|---|---|---|
| street / SAPO | `location_type = private_venue` | **silent**, the organizer never mentioned a street |
| park | `location_type = private_venue` | **silent**, same |
| sound | `amplified_sound = false` | named only under the seventeen-field reading, not among the issue's four |
| assembly | `headcount = 60`, below the 75 threshold | **silent**, a threshold rather than an absence answer |

**Under the broad seventeen-field reading the overlap is one of four:** sound, via
`amplified_sound = false`. Under the issue's four named fields it is zero, because `amplified_sound`
is not one of them, so that reading would produce alcohol, generator and battery, none of which the
copy mentions, and would omit all four that it does. The one-of-four figure is the one to quote,
because it is the best case for the proposal.

So the proposed line, applied to the issue's own worked example, largely does not reproduce it.
**Corrected in review: the overlap is one, not zero.** THREE of the four absences Scenario B names
follow from `location_type` and `headcount`, which the organizer did supply but which the proposed
line's own test treats as "something they never mentioned", because they never mentioned a street, a
park, or an assembly. The fourth, sound, follows from an explicit `amplified_sound = false` answer, so
under the broad reading it is a genuine overlap. An earlier version of this brief said all four follow
from location and scale, which its own table above contradicts.

That weakens the claim rather than destroying it: three of four still sit on a different axis. The test
keys on whether a question was answered to establish an absence; Scenario B's copy keys on whether a
permit family was ruled out.

**Those are two different axes**, and the issue's framing conflates them. That is the finding: on the
issue's own success criterion, the proposal is not merely noisy, it is measuring something else.

Stated as an observation and not a recommendation, since this is the rules-owner's call: a line that
would reproduce Scenario B keys on permit families ruled out by location and scale, which is
per-agency rather than per-question, and which the seventeen-field enumeration above does not describe at
all. Deciding between the two axes looks like the actual decision hiding inside #107.

---

## 6. The v2.9 question, as priced at `46971a0`

At the pinned commit, three changes were pending for one bump. This table preserves that historical
pricing state. Named confirmations are no longer pending on current `main`: decision gate
`msg_68b1f57ec560` completed the approvals, and nyc.v2.9 published nine named-confirmation rules now
carried by nyc.v2.10.

| Change | Adds or edits | Moves evaluated output? | Needs a decision first? |
|---|---|---|---|
| TPA source re-attribution on DOB-ASSEMBLY-001 | edits `deadline.qualification` | **yes**: `buildFinding` copies the qualification into persisted and rendered `notes`; F-202 AC 9 also compares it in the stored deadline snapshot, so an older checklist emits a moved-deadline state notice until review re-points it; no date, status or verdict moves | **yes**: evaluated regulatory source and content, needing the verification owner plus rules reviewer |
| `DEPENDENCY_SEQUENCING_BINDINGS` into the ruleset | adds published data, removes an engine constant | only if the published table differs from the constant | **yes**: `proposals.ts` carries an explicit "PROPOSAL — NOT YET APPROVED" header requiring verification-owner plus engine-owner sign-off, and publishing the machine-readable binding IS approving the sequencing semantics |
| Named confirmations | historical proposal: adds N rules; published outcome: nine rules | **yes, moves approved answer-key output** | **historical:** undecided, with THREE independent approval classes rather than two; **current:** complete under `msg_68b1f57ec560` and published in nyc.v2.9 |

**Corrected in review: at `46971a0`, none of the three was decision-free, so there were no ready
passengers.** An earlier version of this brief described the first two that way, and I relayed it.
What was true at that point was weaker: the first two were decided in principle and not yet approved
as publications. The
re-attribution changes evaluated `notes` through `ruleNotes`; those notes are persisted and rendered
as organizer-visible regulatory text. It also changes the deadline snapshot F-202 AC 9 compares, so
an existing checklist reports a deadline state change until the organizer reviews the latest plan and
the row is re-pointed. That is governance's "Regulatory source/status/content" row, verification owner
plus rules reviewer. The binding sits under a file-level header naming its own approval class as
verification owner plus engine owner, and publishing it is the approval, not a consequence of one.

Nothing about the three conflicts technically: one edits a field, one adds a root key, one adds rules,
and the provenance block already separates per-change consequences this way for v2.6 and v2.7. The
difference between them is how many owners each needs and whether the underlying question is settled.
At `46971a0`, the confirmations needed two calls that had not been made, the rules-owner call on the
line and the product-owner call on moving approved output, so bundling them would have made the other
two wait on the least settled item. The current baseline records those calls as complete and the
published v2.9 outcome as nine rules; this paragraph does not reopen either.

**Corrected in review: two owner sets were listed and three independent approval classes are
required for the proposed publication.** Governance's
"Change classes and approvals" table is cited here by the row rather than by a section number, because
a number behind a sigil is the citation shape this session has had to correct four times. Every named
confirmation adds a rule trigger and organizer-visible regulatory text, so it lands on three rows:

| Change class row | Required approval, quoted from the row |
|---|---|
| Product scope, feature meaning, phase | "Product owner/team decision" |
| Rule trigger, dedupe, branch, deadline, or formula semantics | "Verification owner plus engine owner" |
| Regulatory source/status/content | "Verification owner plus rules reviewer" |

The "UI copy only" row does not add a fourth class: its own exception routes a regulatory claim to the
regulatory source/content approval above. At the pinned commit, listing only the rules-owner and
product-owner calls understated the critical path and could have let a v2.9 publication proceed
without the engine and verification reviews. The completed decision gate records all three classes.
The engine owner was reachable here in particular because section 0's remedies include changing
`resolveFindings`.

Two specifics worth having:

- **The sequencing bindings do not fit `engine_conventions` as it stands.** That key is an array of
  seven prose strings. A structured table of `dependencyRuleId` / `upstreamRuleId` / `gatedRuleId`
  needs either a new root key, `config.dependency_sequencing` being the obvious shape, or a schema
  change to `engine_conventions`.
- **Corrected in review: the move is NOT publication-only, and cannot be, even with a byte-identical
  table.** Verified through both guards in order. `apps/api`'s `validateRuleset` and the engine's
  `parseEngineRuleset` both ACCEPT an added root key and an added `config` member, so publishing the
  data breaks no boot. But the key does not survive parsing: `EngineRuleset` carries exactly
  `rulesetVersion`, `jurisdiction`, `snapshotDate`, `slackWarningDays`, `calendarId`, `intakeFields` and
  `rules`, with no sequencing field, and `findings.ts` imports `DEPENDENCY_SEQUENCING_BINDINGS` directly
  and iterates it. So publishing the data alone leaves behaviour on the in-code constant, and deleting
  the constant alone breaks its consumer.

  The handoff therefore costs, before it is a publication at all: a field on `EngineRuleset` in
  `types.ts`; parsing and validation for it in the engine's `ruleset.ts`, and a decision about whether
  `apps/api` validates it too; `findings.ts` reading the binding from the ruleset instead of the import;
  removal of the constant and of `proposals.ts` §7; and tests, including the fixture-agreement and
  sequencing coverage that currently exercises the constant. **That changes the v2.9 answer:** this item
  is not a passenger on a publication, it is an engine change that a publication then depends on, so it
  cannot share a bump with the other two until the engine work lands and is approved under the same
  verification-owner plus engine-owner class its own file header names.

- **Is there a third code change hiding inside a publication? Yes, and it is in `apps/api` rather than
  the engine.** The first was the sequencing bindings; the second is the `UNCONSUMED_INTAKE_FIELDS`
  removal in section 3. The third is `EXPECTED_RULE_COUNT` in `apps/api/src/ruleset.ts`, which boot
  validation compares against the published rule count and rejects on mismatch, so adding N confirmation
  rules fails API boot until that constant moves too. Three so far, on three different files, and each
  was found by driving a proposed change through the guards rather than by reading the ruleset. A fourth
  is conditional rather than certain: if section 0's chosen remedy is the one that emits only on a TRUE
  trigger, that is `resolveFindings`, which is engine source again.
- **The TPA re-attribution's ordering dependency is already satisfied.** It edits
  `deadline.qualification`, which was one of the two lines `specs/F-202` cited by number. PR #163 has
  MERGED, so F-202 now cites the field paths and this edit can no longer silently falsify the spec.
  Corrected in review; the earlier version described #163 as open.

---

## 7. What could not be established at `46971a0`

- Whether the published sequencing table would be byte-identical to the current constant, which is
  what the published table would say. It had one entry at that commit, so the comparison was small,
  but the target shape was undecided. Note this no longer decides whether the move is
  publication-only: the correction above establishes that it is not, whatever the table contains.
- Whether the product owner at that commit read Scenario B's four named absences as the specification
  for named confirmations or as one scenario's copy. Section 5's finding depended on which, and the
  answer keys were silent on it.
