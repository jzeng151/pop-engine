# Dedupe co-firing in the v2 full draft, measured

## 0. What this document is, and what it is not

Read this before any number below.

**This is a measurement of a PROPOSED artifact that the engine cannot load.**
`rules/proposals/nyc-rules.v2-full-draft.json` is PROPOSED in `docs/BASELINE.md`. It does not load
through `parseEngineRuleset`, and the reason it does not is not cosmetic: it uses two trigger
operators (`is_null`, `lte`) that `packages/engine` has no case for, and three derived values that
the engine does not compute. Every number here was produced by the harness in
`scripts/dedupe-cofiring/`, which supplied those five pieces itself. Section 3.2 states exactly what
was supplied and on what basis, and section 3.5 re-checks each one against the draft.

**What that means for how these numbers may be used.**

- This document establishes **no regulatory fact**. It is not a source under the authority order in
  `AGENTS.md`, and it never becomes one. No permit name, deadline, fee, agency, portal or
  disposition quoted below is confirmed by this document; each is quoted as _published draft data_,
  to answer the question "would co-firing members disagree", and for no other purpose.
- This document **approves nothing** and changes nothing. It is not a proposal, not a decision, not
  a fix. No engine, ruleset, app or test file is touched by the PR that carries it.
- The draft's status is unchanged by this measurement. `AGENTS.md` says to stop when a feature's
  inputs are PROPOSED, and that instruction stands: **nothing in this document licenses
  implementing the draft, and no figure here should be cited as evidence that the draft is safe to
  load, adapt or ship.** What it supports is narrower: a claim about how many members of a dedupe
  group can reach the same merged plan item, under the draft's triggers as this harness read them.
- Two of the five supplied semantics are **weaker than section 3.2 previously claimed**. The three
  derived-value formulas are published by the draft, with formula text and null behaviour. `is_null`
  and `lte` are **not**: the draft lists their names in `engine_operators` and publishes no
  semantics for either. Their behaviour here is this harness's reading, not the draft's declaration.
  Section 3.5 says which conclusions depend on that reading.

**Status:** MEASUREMENT.
**Measured by:** `scripts/dedupe-cofiring/`, on branch `measure/draft-dedupe-cofiring`. Every figure
below is asserted by `pnpm test:cofiring`, which runs in `pnpm test`, so the commit this was
measured on is any commit that command passes on. Section 8 maps each table to its command.
**Artifacts measured:** `rules/proposals/nyc-rules.v2-full-draft.json` (PROPOSED, 59 rules plus 4
advisories) and `rules/nyc-rules.v2.11.json` (published, 46 rules) as the control.

## 1. The question

The draft declares 25 dedupe groups. Nine hold more than one member. When two members of a group
both produce a finding for the same event, `findings.ts` merges them into one plan item and has to
pick which route supplies each scalar field. If every group's members are mutually exclusive
branches, that merge never faces a choice.

The question, per group: over an intake sweep, how many members co-fire on a single event? The
distribution, not the maximum.

## 2. Three different properties, kept apart

The previous revision of this document conflated two of these. They are measured separately now.

**Property A, does the member reach the merge.** `resolveFindings`
(`packages/engine/src/findings.ts:271-280`) skips a rule only when its trigger evaluates `false`. A
trigger that evaluates `unknown` produces a finding and enters the dedupe merge exactly like a
`true` one. Call this **findings**: trigger result `true` or `unknown`.

**Property B, is the member's trigger decisive.** Trigger result `true` alone. Call this **true
only**.

**Property C, were the facts answered.** A field is **settled** for an intake when it is out of
scope for that intake (the draft never asks it, so it is not a material fact for that event) or
when it holds a definite answer: not absent, not `null`, and not the engine's explicit-unknown
answer (`conditions.ts:242`). An intake is **complete** for a group when every raw intake field
that any member of that group reads is settled. Call this **complete**.

**One `null` is an answer, and it is counted as one.** The rule above says a `null` is unanswered.
That is right for every raw field in this draft except one: `event_days` publishes the null
behaviour `"1 when event_end_date is null"`, so a blank end date is the draft's declared way of
saying "one day", not a fact nobody supplied. Section 3.3 confirms it deterministically yields
`event_days = 1`. Excluding it would label an input as materially unanswered while every trigger
consuming it has a definite result, so `event_end_date = null` counts as settled. No other published
null behaviour names a definite value: `structure_area_sqft` is `"unknown if either dimension is
missing"`, and the `is_null` leaves exist precisely to flag a fact nobody supplied. This is a
correction; the previous revision counted `event_end_date = null` as unanswered, and section 4.3
gives the figure it moves.

**C is not B, in either direction, and both directions occur in the measurements below.**

- A trigger can be `true` on an unsettled fact. `SAPO-BLOCK-PARTY-ELIGIBILITY-UNKNOWN-001` reads
  `organizer_type eq "unknown"`, and the engine answers a rule that names `unknown` among its
  accepted values rather than blocking on it (`conditions.ts:316-325`). So the trigger returns
  `true` precisely because the organizer type was not settled. Its other four branches are
  `is_null` and `eq "unknown"` leaves, with the same shape.
- A trigger can be `unknown` on a fully settled intake. The published control's `DOB-TENT-001`
  reads `tent_area_sqft gt 400` with `boundary: "conditional"`, which the engine reads as `unknown`
  at exactly 400 (`conditions.ts:277`). On 16 of the control's complete intakes the answer is 400
  and the trigger is `unknown` with nothing unanswered.

Completeness is therefore computed from the intake alone, by `isSettled` in the harness, which
consults the scope resolver and the answers and never looks at a trigger result. Sections 4.1, 4.2
and 4.3 report A, B and C over the same sweeps.

One caveat on the definition, stated because it changes counts: completeness is measured at the
**group** level, over every field any member of the group reads, not only the fields the
particular co-firing members read. Where the two readings differ, section 5 gives both.

## 3. Method, including every limitation

### 3.1 The draft does not load through `parseEngineRuleset`

It does not, and the reason is not one thing. Running the parser against successively adapted
in-memory copies (never against the file in `rules/`, which is never written) produces this
sequence of real error messages. The table is reproduced by `scripts/dedupe-cofiring/staging.mjs`,
which applies each adaptation programmatically and reports what the parser says next:

| adaptation applied so far                                                                                                                                                                            | next error from `parseEngineRuleset`                                                                                                                                                                                               |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| none                                                                                                                                                                                                 | `ruleset.rules[4].output.deadline.type has unsupported value "conditional"`                                                                                                                                                        |
| drop the 6 deadlines whose type the engine has no case for (`conditional` x3, `official_conflict`, `fixed_annual_date`, `dependency`) and the 4 `published_minimum` deadlines not in `calendar_days` | `ruleset.rules[4].verification.status has unsupported value "VERIFIED_WITH_QUALIFICATION"`                                                                                                                                         |
| map `VERIFIED_WITH_QUALIFICATION` (33 rules) and `CONDITIONAL` (8 rules) onto statuses the engine knows                                                                                              | `ruleset.rules[8].trigger.all[1].any[3].op has unsupported value "is_null"`                                                                                                                                                        |
| map the 3 kinds the engine does not declare (`conditional_requirement` x4, `approval`, `certificate`) and publish `config.business_day_math.calendar`                                                | same `is_null` error                                                                                                                                                                                                               |
| DIAGNOSTIC ONLY, semantics-changing: rewrite the 7 `is_null` leaves and the 1 `lte` leaf                                                                                                             | `rule SAPO-BLOCK-PARTY-INELIGIBLE-001 references undeclared field "event_days"`                                                                                                                                                    |
| DIAGNOSTIC ONLY: declare the 3 derived values as intake fields                                                                                                                                       | `dedupe key "block_party_eligibility" mixes verification statuses "VERIFIED" and "RESEARCH_REQUIRED"`                                                                                                                              |
| DIAGNOSTIC ONLY: collapse every verification status                                                                                                                                                  | `intake field "event_address" is declared but no rule trigger, deadline, or scoping condition reads it, so answering it changes nothing. Give a rule that consumes it, or record why it is collected in UNCONSUMED_INTAKE_FIELDS.` |

Which dedupe key the sixth row names depends on which statuses the third row's mapping collapsed.
**Six** of the nine multi-member groups mix statuses, so some key fails there under any such
mapping. Grouping all rules and advisories by `output.dedupe_key` and counting distinct
`verification.status` values gives `sapo_permit`, `block_party_eligibility`, `sapo_insurance`,
`parks_special_event`, `nypd_sound` and `sla_alcohol`. The previous revision said five and omitted
`sla_alcohol`, which understated both the loader-blocker inventory and the set of groups that can
reach `rejectMixedDedupeVerificationStatuses`.

The decisive row is the third. Everything above it is outside trigger evaluation: deadline types,
verification statuses, rule kinds, and the holiday-calendar key are all read after `parseTrigger`
has run, so adapting them could not change which rules fire. `is_null` and `lte` are trigger
operators, and the draft's three trigger-read `derived_values` are trigger operands. There is no
way to express them in the engine's current condition vocabulary without asserting semantics the
engine does not have. `is_null` has no engine equivalent at all: the closest rewrite, `eq
"unknown"`, means a different thing (the engine's explicit-unknown answer, not an absent one), and
`lte` cannot be written as a negated `gt` because the trigger grammar has no negation.

So this measurement took route (b) from the brief: **the triggers were evaluated directly, not
through the full pipeline.** The draft file was never modified.

### 3.2 The harness

`evalTrigger` (`scripts/dedupe-cofiring/harness.mjs`) is a tri-state walker that:

- delegates **every** node the engine supports to the engine's own
  `evaluateTrigger`/`createScopeResolver` (`packages/engine/src/conditions.ts`), so operator
  semantics, the explicit-`unknown` answer, out-of-scope handling, the declared conditional
  boundary and the multi-select `in` rule are the engine's, not a reimplementation;
- reproduces the engine's `all`/`any` tri-state combinator (decisive child wins, otherwise any
  `unknown` child makes the node `unknown`), which is the only engine logic restated;
- computes the three derived values the draft's triggers read and puts them in the intake as
  declared pseudo-fields, so that the comparisons **on** them (`gt`, `gte`, `contains`,
  `contains_any`) also run through the engine's operator table rather than a second one;
- supplies the two operators the engine does not have, `is_null` and `lte`.

**What is the draft's and what is the harness's.** The three derived values are published by the
draft with a formula and a null behaviour, quoted verbatim in section 3.5, and the harness
implements what they say. `is_null` and `lte` are **not** published with semantics: the draft's
`engine_operators` array lists ten operator names and nothing else, and no other part of the draft
defines them. What the harness does with them is therefore its own reading:

- `lte`: numeric `<=`; `unknown` when the answer is absent or explicitly unknown. The comparison
  follows from the operator's name and its company (`lt`, `gt`, `gte`); the tri-state behaviour is
  copied from how the engine treats every other numeric comparison, not from the draft.
- `is_null`: `true` when the field is in scope and its answer is absent; `false` otherwise, never
  `unknown`. An explicit `"unknown"` answer is **not** treated as null. Nothing in the draft says
  this. It is the reading that makes `is_null` distinct from the `eq "unknown"` leaves that sit
  beside it in the same `any` block; the alternative reading is discussed in section 3.5.

**Agreement check.** Over the 622-intake control sweep, `evalTrigger` was compared against the
engine's `evaluateTrigger` for all 46 rules of the published ruleset: **28,612 comparisons, 0
mismatches**. That tests the combinator and the delegation. It cannot test `is_null`, `lte` or the
derived values, which have no engine counterpart to compare against.

**The one intake-contract translation.** The draft publishes `asked_when` as a condition object.
The engine's registry grammar is a string, and `parseIntakeField` reads it with `optionalString`,
so an object silently becomes `null` and the field would be unconditionally in scope. Both draft
expressions are exactly expressible in the engine's grammar, so both were translated rather than
dropped:

- `public_space_interference` becomes `location_type in street/sidewalk/curb_lane/plaza`
- `sound_audible_in_public_space` becomes
  `amplified_sound AND location_type in private_indoor/private_rooftop/private_outdoor`

and then parsed with the engine's own `parseAskedWhen`. This is load-bearing for exactly one group:
it is why `NYPD-SOUND-PUBLIC-001` and `NYPD-SOUND-PRIVATE-AUDIBLE-001` never co-fire (see 5.5). Had
the scoping been dropped, that pair would have appeared to co-fire whenever `location_type` was
unknown. Only two of the draft's 63 intake fields carry an `asked_when` at all, and for every group
other than `nypd_sound` neither is in the swept set, so scoping is a no-op there and those sweeps
used a resolver that **throws** if a scoped field is ever consulted, which proves the shortcut
sound rather than assuming it.

### 3.3 How the sweep was built

Built from the **draft's own** 63 declared `intake_fields`, not the published ruleset's 33.

The full 63-field factorial is not enumerable: the 43 enum, boolean and multi_enum fields alone
multiply out to 1.90 x 10^28 combinations, before any of the 17 numeric, 2 date or 1 string fields.
It was not sampled either. Instead each group was swept **exhaustively over the fields its own
members read**, expanded through derived-value inputs. This is exact rather than a sample, because
no draft rule reads a field outside its own trigger, no field read by any of these groups carries
an `asked_when` clause naming a field outside the swept set (the one exception,
`sound_audible_in_public_space`, has its gating fields `amplified_sound` and `location_type` inside
the `nypd_sound` set), and the merge for a group depends only on that group's members. Fields
outside a group's set are held unanswered and cannot change that group's result.

**Only selections and answers the intake contract admits are enumerated.** Two rules follow from
`validateIntake`, and both were missing from the previous revision:

- A `multi_enum` domain is its **valid selections**, not its power set. `validateIntake`
  (`packages/engine/src/intake/validate.ts:88-101`) rejects the empty selection and any selection
  that combines the exclusive `none` option with another value, so a 5-option field has 16 valid
  selections rather than 32. Sweeping the power set counted submissions the contract refuses.
- A field the event is **not asked** is omitted, and carries exactly one value in the sweep rather
  than its whole domain. `validateIntake` rejects a supplied value for an out-of-scope field with
  `not_applicable` (`validate.ts:285-300`). Enumerating an out-of-scope field's domain counts one
  event several times over: for a public `location_type` such as `street`,
  `sound_audible_in_public_space` is out of scope, so the previous revision counted the
  public-plus-prohibition pair 15 times rather than once for each of the five public locations.

Value domains, applied uniformly by `domainFor` in the harness:

- **enum / boolean:** every value the artifact declares, plus `null` when it marks the field
  nullable. Note that several enums declare `"unknown"` as a member, and the engine treats the
  literal string `"unknown"` as the explicit-unknown answer (`conditions.ts:242`), so that value is
  a genuine tri-state input rather than a plain option, and is distinct from `null`.
- **multi_enum:** every valid selection, per the rule above. No draft group swept below reads a
  `multi_enum` field, so this rule binds only on the control's `structure_types`.
- **numeric:** `0`, plus `t-1`, `t`, `t+1` for every threshold `t` any member compares the field
  against, plus `null` when nullable, less any value the intake contract refuses. `validateIntake`
  rejects a headcount at or below zero (`packages/engine/src/intake/validate.ts:316-317`), so
  `headcount` sweeps `{19, 20, 21}` and not `{0, 19, 20, 21}`. It is the only numeric field the
  engine gives a minimum, so no other numeric domain is filtered.
- **dates:** `event_date` is fixed at `2026-09-01`; `event_end_date` ranges over `{null,
2026-09-01, 2026-09-02}`, giving `event_days` of 1, 1 and 2, which covers the only threshold
  (`event_days gt 1`) below, on and above.
- **`structure_length_ft` and `structure_width_ft`** are the one hand-set domain, `{null, 10, 12,
20, 21}`, because their thresholds are on their product: those products straddle both published
  area thresholds (120 and 400) on all three sides.

Sweep sizes: from 36 to 24,330,240 intakes per group, **24,351,972** draft intakes in total, plus
**622** control intakes. Every one was evaluated; nothing was truncated.

**What is still not a whole valid submission.** A sweep answers a group's own fields and holds the
other 49-odd draft fields unanswered. `validateIntake` would reject that as a submission, because it
requires an answer to every in-scope non-nullable field. It is not a defect in the counts, and the
reason is the one given above: the merge for a group depends only on that group's members, no rule
reads a field outside its own trigger, and no field read by these groups is scoped by a field
outside the swept set. What the sweeps are is the exact enumeration of a group's own decision space
under the contract's rules for the fields that space is built from, not a catalogue of complete
questionnaires.

**Three sweep sizes changed in this revision, and all three are the intake-contract corrections
above.** `parks_special_event` is **120** rather than 160, because `headcount = 0` is not an answer
the contract admits and is no longer swept; that removes 40 rows, one for each combination of the
group's other three fields, and it is the correction the paragraph below retracts in part.
`nypd_sound` is **156** rather than 360, because `sound_audible_in_public_space` is now omitted on
the intakes that do not ask it. The control is **622** rather than 2,400, because `structure_types`
now ranges over its 16 valid selections rather than 32 power-set members and because
`tent_area_sqft`, `tent_days_in_place` and `structure_over_10ft_tall` are omitted where they are out
of scope. The agreement check is therefore 28,612 comparisons rather than 110,400. Every percentage
with either sweep size in its denominator moved; sections 4.1 to 4.4, 5.5, 6 and 7 give the new
values and say which sentences they change.

An earlier revision's domain corrections still stand, with one narrowed, and are recorded here so
the history is readable: `0` belongs in the domain of every numeric field **the contract admits it
for**, and `structure_over_10ft_tall` is not nullable in `rules/nyc-rules.v2.11.json`. That is why
`dob_temporary_structure` is 10,000 rather than 8,750 and `block_party_eligibility` is 24,330,240
rather than 19,464,192. The narrowing is `headcount`, above: the earlier statement was made about
numeric domains in general and was never checked against `validateIntake`'s per-field minimum.

### 3.4 Limitations, stated plainly

Each of these was re-derived from the draft by enumeration, not by re-reading the prose. Limitations
2 and 5 were wrong in earlier revisions and are corrected here; the others were checked the same way
and are stated as the enumeration found them.

1. **This measures triggers, not rendered plan items.** The draft cannot run through
   `resolveFindings`, so the merged line's actual text was not produced. What is measured is which
   members reach the merge and what each one publishes.
2. **Two trigger operators are this harness's reading, not the draft's declarations, and three
   derived formulas are the draft's.** See sections 3.2 and 3.5. `is_null` and `lte` do not exist
   in `packages/engine` and are not defined by the draft. **The measured results are insensitive to
   the `is_null` reading**, which the previous revision got wrong: it claimed the
   `block_party_eligibility` numbers would shift if `is_null` also matched an explicit `"unknown"`
   answer, and they do not. Section 3.5 shows why, and what would have to change for the ambiguity
   to matter.
3. **Numeric domains are threshold-local.** They prove behaviour below, on and above every
   threshold, and cannot surface a discontinuity that exists nowhere near a threshold. Enumerated:
   every leaf in the draft that reads a numeric field uses `gt`, `gte`, `lte`, `eq` or `is_null`,
   and every one of them names its own constant, so there is no construct that discriminates away
   from a swept value. The `0` in each numeric domain is the only non-threshold point swept, and it
   is dropped for `headcount`, where the contract refuses it (section 3.3).
4. **The date axis is minimal.** Enumerated: `event_days` is the only date-derived value any
   trigger in the draft reads, in any group, multi-member or not; the draft's other date-derived
   value, `business_days_until_event`, is read by no trigger. `event_days` has a single threshold,
   `gt 1`.
5. **`fuel_types` and `open_flame_types` are not swept.** No multi-member group reads them.
   Enumerated, they feed exactly three rules, each in a single-member dedupe group:
   `FDNY-FUEL-001` (`fdny_fuel`) and `PARKS-PROPANE-PROHIBITION-001` (`parks_propane`), both via
   the derived `effective_fuel_types`, and `FDNY-OPEN-FLAME-001` (`fdny_open_flame`), which reads
   `open_flame_types` directly. The previous revision omitted `FDNY-OPEN-FLAME-001`. The other
   input to `effective_fuel_types`, `generator_fuel_type`, **is** swept, in `fdny_generator`.
6. **Frequencies are per uniform sweep, not per real-world intake.** A percentage here is the share
   of enumerated combinations, and says nothing about how often organizers submit that shape.
7. **The draft's `status`, `severity` and `paths` fields are not engine inputs today.** Checked by
   grep over `packages/engine/src`: no non-test source reads any of the three. They are reported
   below as published data because the brief asks whether co-firing members disagree, and they are
   where several disagreements live.
8. **Completeness is a group-level property.** An intake is complete for a group when every field
   any member reads is settled, so an intake can be incomplete for the group while every field the
   two actually-co-firing members read is settled. Section 5 reports both counts wherever they
   differ.
9. **Three sweeps are unconstrained products over classifications the draft derives, not counts of
   reachable events.** The draft marks `sapo_event_type`, `street_event_size`, `plaza_level`,
   `plaza_size` and `plaza_block_count` `derived: true`. They are not answers an organizer gives;
   they are produced from raw public-space facts by `classify_sapo_event`, which the draft
   publishes as prose rather than as an algorithm, and which
   `docs/proposals/documentation-audit-2026-07-22.md:56` records as having no complete
   deterministic derivation in the supplied file. With no derivation to run and no approved
   reachability constraint to apply, this harness enumerates each of them over its declared enum
   independently. **The products therefore contain classification combinations that may be jointly
   unreachable**, so every figure for a group in the table below is an upper bound over a product,
   not a count of events the classifier can produce. Supplying a classifier here would be inventing
   rule semantics, which `AGENTS.md` forbids and which no approved artifact supports, so the fact
   is stated rather than repaired.

   | group                     | derived fields swept                                                                     |
   | ------------------------- | ---------------------------------------------------------------------------------------- |
   | `sapo_permit`             | `sapo_event_type`, `street_event_size`, `plaza_level`, `plaza_block_count`, `plaza_size` |
   | `block_party_eligibility` | `sapo_event_type`                                                                        |
   | `sapo_insurance`          | `sapo_event_type`                                                                        |

   The list is read off the artifact's `derived: true` flags rather than written down here, so a
   draft that lands a real derivation and drops a flag moves the qualification with it. The other
   six groups sweep no derived field and carry no such qualification, and neither does the control:
   `rules/nyc-rules.v2.11.json` derives no intake field. What this limitation does **not** touch is
   which members share a `dedupe_key`, which is published data, or the sets in section 5, which
   name the combinations rather than counting them; it bears on the sweep sizes, the distributions,
   the completeness counts and every percentage over them for those three groups.

### 3.5 The supplied semantics, re-checked against the draft

Re-read from `rules/proposals/nyc-rules.v2-full-draft.json` after the measurement, to answer
whether each still reads the same way. Reproduce with
`jq '.engine_operators, .derived_values' rules/proposals/nyc-rules.v2-full-draft.json`.

| supplied piece         | what the draft publishes                                                                                                                | still reads the same way?                                                                                                                                                                       |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `structure_area_sqft`  | formula `structure_length_ft * structure_width_ft`; null behaviour `"unknown if either dimension is missing"`                           | Yes. Published in full; the harness implements exactly this.                                                                                                                                    |
| `event_days`           | formula `inclusive_days(event_date, event_end_date ?? event_date)`; null behaviour `"1 when event_end_date is null"`                    | Yes. Published in full; the harness implements exactly this.                                                                                                                                    |
| `effective_fuel_types` | formula `union(fuel_types, generator_fuel_type when generator_fuel_type not in ['none','unknown'])`; null behaviour `"fuel_types only"` | Yes. Published in full. Not load-bearing here: no multi-member group reads it (limitation 5).                                                                                                   |
| `lte`                  | the name, in the `engine_operators` array, beside `lt`, `gt`, `gte`. No semantics anywhere in the file.                                 | **No, weaker than claimed.** The comparison is unambiguous by convention. The tri-state behaviour on an absent or explicitly-unknown answer is copied from the engine, not read from the draft. |
| `is_null`              | the name, in the `engine_operators` array. No semantics anywhere in the file.                                                           | **No, weaker than claimed.** The draft never says whether an explicit `"unknown"` answer is null. The harness says it is not, and no measured figure depends on that choice (below).            |

**What depends on the `is_null` reading: nothing measured here.** `is_null` appears on 7 leaves, all
on nullable numeric fields (`block_count`, `event_duration_hours`,
`generator_aggregate_tank_gallons`, `structure_length_ft`, `structure_width_ft`,
`structure_height_ft`, `structure_duration_days`). None of them declares an `unknown` enum member,
and section 3.3 sweeps a numeric field over numbers and `null` only, never over the literal string
`"unknown"`. So the alternative reading, that `is_null` also matches an explicit unknown, changes no
evaluated intake in any sweep above, `block_party_eligibility` included: there is no intake in the
domain on which the two readings differ.

The previous revision said this ambiguity moved the `block_party_eligibility` counts. That was
wrong, and it was wrong in a way this document's own domains make plain two paragraphs earlier. The
honest statement is that the measurement is **insensitive** to the ambiguity, not that it resolves
it. Making it sensitive would take a change to the artifact, not to the sweep: one of those seven
fields would have to admit an explicit-unknown value, which would mean the draft declaring it as
something other than a bare number. Until it does, the reading is unfalsifiable here, and no figure
in section 4 or 5 rests on it.

What does still rest on the reading is a claim about _reachability_, and it survives either way:
every branch of `SAPO-BLOCK-PARTY-ELIGIBILITY-UNKNOWN-001`'s `any` block requires an unsettled fact
under both readings, which is why section 4.3 finds the group never co-fires on a complete intake.

## 4. Results

**Read the `sapo_permit`, `block_party_eligibility` and `sapo_insurance` rows against limitation 9.**
Those three sweep fields the draft derives with `classify_sapo_event`, which it publishes as prose
rather than as an algorithm, so their rows are unconstrained products over the declared enums and
are upper bounds rather than counts of reachable events. The other six groups and the control sweep
only fields an organizer answers, and carry no such qualification.

### 4.1 Property A, findings per event (trigger `true` or `unknown`), draft

| group                     | members | sweep      | 0          | 1       | 2         | 3   | 4   | 5   | 6+  | max    | share >= 2 |
| ------------------------- | ------- | ---------- | ---------- | ------- | --------- | --- | --- | --- | --- | ------ | ---------- |
| `sapo_permit`             | 14      | 6,480      | 1,034      | 4,332   | 100       | 144 | 100 | 34  | 736 | **14** | 17.2%      |
| `dob_temporary_structure` | 5       | 10,000     | 4,480      | 3,096   | 1,902     | 270 | 180 | 72  | 0   | **5**  | 24.2%      |
| `sla_alcohol`             | 5       | 60         | 37         | 11      | 2         | 4   | 2   | 4   | 0   | **5**  | 20.0%      |
| `sapo_insurance`          | 4       | 36         | 4          | 26      | 2         | 2   | 2   | 0   | 0   | **4**  | 16.7%      |
| `nypd_sound`              | 4       | 156        | 84         | 27      | 36        | 9   | 0   | 0   | 0   | **3**  | 28.8%      |
| `parks_special_event`     | 3       | 120        | 98         | 22      | 0         | 0   | 0   | 0   | 0   | **1**  | 0.0%       |
| `fdny_generator`          | 3       | 4,800      | 2,686      | 1,706   | 344       | 64  | 0   | 0   | 0   | **3**  | 8.5%       |
| `dob_assembly`            | 3       | 80         | 59         | 15      | 3         | 3   | 0   | 0   | 0   | **3**  | 7.5%       |
| `block_party_eligibility` | 2       | 24,330,240 | 18,923,544 | 737,256 | 4,669,440 | 0   | 0   | 0   | 0   | **2**  | 19.2%      |

The `sapo_permit` 6+ column expands to 6: 212, 7: 200, 8: 94, 9: 80, 10: 80, 11: 10, 12: 50, 14: 10.

### 4.2 Property B, the same sweeps counting only `true` triggers

| group                     | 0          | 1       | 2         | max   | share >= 2 |
| ------------------------- | ---------- | ------- | --------- | ----- | ---------- |
| `sapo_permit`             | 2,268      | 4,212   | 0         | **1** | 0.0%       |
| `dob_temporary_structure` | 7,066      | 2,478   | 456       | **2** | 4.6%       |
| `sla_alcohol`             | 43         | 17      | 0         | **1** | 0.0%       |
| `sapo_insurance`          | 9          | 27      | 0         | **1** | 0.0%       |
| `nypd_sound`              | 90         | 58      | 8         | **2** | 5.1%       |
| `parks_special_event`     | 109        | 11      | 0         | **1** | 0.0%       |
| `fdny_generator`          | 3,913      | 852     | 35        | **2** | 0.7%       |
| `dob_assembly`            | 68         | 12      | 0         | **1** | 0.0%       |
| `block_party_eligibility` | 21,627,024 | 830,448 | 1,872,768 | **2** | 7.7%       |

Five of the nine groups never reach 2 decisive triggers at all. Four do. **This table does not say
that those four reach 2 with the facts settled**, which is what the previous revision read it as
saying, and which section 4.3 shows is false for one of them.

### 4.3 Property C, completeness, measured independently of any trigger result

`complete` counts intakes in which every field any member of the group reads is settled. It is
computed from the intake and the scope resolver alone.

| group                     | sweep      | complete  | complete share | complete AND >= 2 findings | complete AND >= 2 true |
| ------------------------- | ---------- | --------- | -------------- | -------------------------- | ---------------------- |
| `sapo_permit`             | 6,480      | 1,536     | 23.7%          | **0**                      | **0**                  |
| `dob_temporary_structure` | 10,000     | 4,032     | 40.3%          | **444**                    | **444**                |
| `sla_alcohol`             | 60         | 24        | 40.0%          | **0**                      | **0**                  |
| `sapo_insurance`          | 36         | 16        | 44.4%          | **0**                      | **0**                  |
| `nypd_sound`              | 156        | 84        | 53.8%          | **8**                      | **8**                  |
| `parks_special_event`     | 120        | 108       | 90.0%          | **0**                      | **0**                  |
| `fdny_generator`          | 4,800      | 2,016     | 42.0%          | **35**                     | **35**                 |
| `dob_assembly`            | 80         | 63        | 78.8%          | **0**                      | **0**                  |
| `block_party_eligibility` | 24,330,240 | 1,474,560 | 6.1%           | **0**                      | **0**                  |

**Three groups of the nine co-fire on a complete intake: `dob_temporary_structure` (444 of 4,032
complete intakes, 11.0%), `nypd_sound` (8 of 84, 9.5%) and `fdny_generator` (35 of 2,016, 1.7%).
The other six never do.** Which three, and the fact that the other six never do, is unchanged from
the previous revision; the two `nypd_sound` counts and the `block_party_eligibility` complete count
moved for the reasons in section 3.3 and section 2.

**`block_party_eligibility` completeness moved and its conclusion did not.** Counting
`event_end_date = null` as the declared one-day answer raises the group's complete intakes from
983,040 to **1,474,560**, exactly half again, because that field's three-value domain holds two
settled one-day forms rather than one. Its complete share rises from 4.0% to 6.1%. The
complete-and-co-firing count is **0** either way, so the withdrawal below stands on the larger
denominator too.

Two things follow, and both are corrections.

- **`block_party_eligibility` does not reach its conflict on answered facts.** It reaches two
  `true` triggers on 1,872,768 intakes, and **zero** of them are complete. The reason is structural
  rather than a sampling artifact: every branch of `SAPO-BLOCK-PARTY-ELIGIBILITY-UNKNOWN-001`'s
  `any` block is either `eq "unknown"` or `is_null`, so the rule cannot fire `true` unless
  `organizer_type`, `open_to_all_block_neighbors`, `neighbor_permission_received`, `block_count` or
  `event_duration_hours` is unsettled. The previous revision's claim that this group "conflicts on
  fully answered facts, on 7.9% of its factorial" is **withdrawn**. The 7.7% figure in section 4.2
  is real, and it is a co-firing rate on intakes at least one of whose material facts is missing.
- **`sapo_permit`'s co-firing is not driven only by an unknown classification.** Of its 1,114
  co-firing events, 720 have `sapo_event_type = "unknown"`; the remaining 394 have a settled event
  type and an unsettled `plaza_level`, `plaza_size`, `plaza_block_count` or `street_event_size`.
  All 1,114 have at least one unsettled field, which is the same statement as the 0 in the table.

In every one of the nine draft groups, the complete-intake findings distribution and the
complete-intake true distribution are **identical**: on a complete intake, no draft member's
trigger is ever `unknown`. That is a property of this draft, not a general one. It does not hold in
the control (4.4), where a declared conditional boundary produces `unknown` from a fully answered
intake, and it is the reason B and C have to be measured separately rather than inferred from each
other.

### 4.4 Control: the published `nyc-rules.v2.11.json`

Its one multi-member group is `dob-structure`, holding `DOB-TENT-001` and
`DOB-TALL-STRUCTURE-001`. Sweep: the **valid selections** of `structure_types` (16, not the 32-member
power set) x `tent_area_sqft` (5) x `tent_days_in_place` (5) x `structure_over_10ft_tall` (3), with
each of those three omitted on the selections that do not ask it, = **622** intakes, run through the
real `parseEngineRuleset` and the engine's own `evaluateTrigger`. The 622 breaks down as 8
tent-bearing selections x 75, 7 further non-`none` selections x 3, and the single `[none]`
selection, which asks none of the three.

|                                | 0   | 1   | 2   | share >= 2                            |
| ------------------------------ | --- | --- | --- | ------------------------------------- |
| findings (`true` or `unknown`) | 42  | 244 | 336 | **54.0%**                             |
| `true` only                    | 208 | 310 | 104 | **16.7%**                             |
| complete intakes only          | 41  | 134 | 96  | **35.4%** of the 271 complete intakes |
| complete AND `true` only       | 57  | 134 | 80  | **29.5%** of the 271 complete intakes |

**Every share in this table moved, and none of the co-firing counts did.** 336, 104, 96 and 80 are
the same four numbers the previous revision measured; what changed is the denominator, from 2,400
to 622 and from 1,640 complete to 271. The intakes the correction removed were almost all
non-co-firing, because an invalid selection combining `none` with a structure type puts
`structure_over_10ft_tall` out of scope and makes `DOB-TALL-STRUCTURE-001` false, and because the
out-of-scope tent answers were 25 copies of one event. So the merge faces a choice far more often
than this document previously reported: on 54.0% of the sweep rather than 14.0%, and on 35.4% of
complete intakes rather than 5.9%. The sentence that moves with it is in section 7 and is corrected
there.

The four co-firing shapes, with the first intake in enumeration order that produces each, and where
the shape occurs on a complete intake, the first complete one:

| members and results                                   | count | of which complete | first complete intake, or first intake                                                                                  |
| ----------------------------------------------------- | ----- | ----------------- | ----------------------------------------------------------------------------------------------------------------------- |
| both true                                             | 104   | 80                | complete: `structure_types=[tent_canopy]`, `tent_area_sqft=0`, `tent_days_in_place=30`, `structure_over_10ft_tall=yes`  |
| `DOB-TENT-001` true, `DOB-TALL-STRUCTURE-001` unknown | 104   | 0                 | `structure_types=[tent_canopy]`, `tent_area_sqft=0`, `tent_days_in_place=30`, `structure_over_10ft_tall=unknown`        |
| `DOB-TENT-001` unknown, `DOB-TALL-STRUCTURE-001` true | 64    | 16                | complete: `structure_types=[tent_canopy]`, `tent_area_sqft=400`, `tent_days_in_place=0`, `structure_over_10ft_tall=yes` |
| both unknown                                          | 64    | 0                 | `structure_types=[tent_canopy]`, `tent_area_sqft=0`, `tent_days_in_place=null`, `structure_over_10ft_tall=unknown`      |

The third row is the one worth pausing on: `tent_area_sqft` is answered, at exactly 400, and
`DOB-TENT-001` is still `unknown`, because the rule publishes `boundary: "conditional"` on that
threshold. Sixteen complete intakes reach the merge with an undecided member. That is the direct
counterexample to reading `unknown` as "unanswered".

**The baseline is not "the merge never has a choice".** It has one on 54.0% of this sweep, and on
35.4% of its complete intakes. The two published members do disagree: `DOB-TENT-001` publishes a
`business_days_minimum` of 15 with a fee display and no explicit disposition (so `permit` defaults
to `required`); `DOB-TALL-STRUCTURE-001` publishes `MAY_BE_REQUIRED`, a different permit name, no
deadline and no fee. `dedupe` keeps the first-listed rule's scalars, so today the merged line reads
as the tent permit's name, disposition, deadline and fee, with the tall-structure rule contributing
its rule id, notes and sources. That is what makes today's behaviour safe: two members, one shape,
and the surviving scalars are the stricter of the two.

## 5. The co-firing sets, group by group

Every set below was produced by an evaluation; each "one concrete intake" is the first intake in
the sweep's enumeration order that produced that exact set. Fields not listed were held unanswered.
`complete` is the group-level count from 4.3; where the set-level count differs, both are given.
The sets themselves name combinations rather than counting events, so limitation 9 bears on the
counts beside each set in 5.1, 5.4 and 5.9, not on which members appear together.

### 5.1 `sapo_permit`, 14 members, max 14, never 2 on a complete intake

Members are keyed on `sapo_event_type` and, for the six plaza rules, on `plaza_level` and
`plaza_block_count`. Every pair is disjoint on settled answers: the `true`-only maximum is 1 across
all 6,480 intakes, and 0 of the 1,536 complete intakes produce two findings.

There are 72 distinct co-firing sets over 1,114 events. 720 of those events have `sapo_event_type =
"unknown"` (the engine's explicit-unknown answer); the other 394 come from an unsettled
`plaza_level`, `plaza_size`, `plaza_block_count` or `street_event_size`. The widest, 14 of 14,
occurs 10 times:

> `sapo_event_type=unknown`, `street_event_size=unknown`, `plaza_level=unknown`,
> `plaza_size=small`, `plaza_block_count=null`

**Do they disagree? Yes, more than any other group.** Re-derived by parsing the draft rather than
by reading it, with `jq` over the 14 members of the group (section 8 gives the command):

- **Deadlines.** 11 of the 14 publish a `published_minimum` in calendar days, and the 11 values are
  **14, 30, 45, 10, 60, 45, 30, 45, 30, 14, 60** in rule order (`SAPO-STREET-SMALL-001`,
  `-MEDIUM-`, `-LARGE-`, `SAPO-PRODUCTION-001`, `SAPO-BLOCK-PARTY-001`, `SAPO-PLAZA-A-ONE-001`,
  `-B-ONE-`, `-B-MULTI-`, `-C-`, `-D-`, `-A-MULTI-`), which is five distinct windows: 10, 14, 30, 45
  and 60 days. The remaining three are one `conditional` (`SAPO-STREET-EXTRA-LARGE-001`, up to 60
  days, `excluded_from_verdict_until_resolved`), one `official_conflict`
  (`SAPO-SINGLE-BLOCK-FESTIVAL-001`, `excluded_from_verdict`) and one `fixed_annual_date`
  (`SAPO-STREET-FESTIVAL-001`, December 31 of the preceding year). The previous revision listed
  nine calendar-day values and omitted two.
- **Permit names.** **Seven** distinct instruments, not six: Street Event Permit, Extra Large
  Street/Plaza Event Permit, Production Event Permit, Block Party Permit, Single Block Festival
  Permit, Street Festival Permit, Plaza Event Permit.
- **Fees.** All 14 publish a `$25` processing fee and nothing else in common. The event fee ranges
  from `"$25 nonrefundable processing fee; no additional SAPO event fee"` (`SAPO-BLOCK-PARTY-001`)
  to `"Up to $66,000 per location per day, plus $25 processing fee"`
  (`SAPO-STREET-EXTRA-LARGE-001`), by way of two `20% of total vendor participation fees` formulas,
  a two-row per-day matrix, three flat per-location-per-day figures (3,100 / 11,000 / 25,000), five
  "see the verified fee matrix" placeholders and one plaza-level-A variant naming $15,500 or $31,000.
- **What all 14 share.** Exactly two output fields are byte-identical across all 14, besides
  `dedupe_key` itself: `agency` (`"SAPO (CECM)"`) and `portal` (E-Apply,
  `https://nyceventpermits.nyc.gov/`, `VERIFIED`).

Also worth recording because the engine would refuse it before any of this matters: the group mixes
`VERIFIED`, `VERIFIED_WITH_QUALIFICATION` and `OFFICIAL_CONFLICT`, and
`rejectMixedDedupeVerificationStatuses` (`ruleset.ts:665`) fails a load on exactly that.

### 5.2 `dob_temporary_structure`, 5 members, max 5, reaches 2 on complete intakes

18 distinct co-firing sets. The two that occur with every member `true`:

| members                                        | count | group-complete | set-complete | intake                                                                                                                           |
| ---------------------------------------------- | ----- | -------------- | ------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| `DOB-STAGE-001` + `DOB-STRUCTURE-DURATION-001` | 360   | 360            | 360          | `structure_type=stage`, `structure_length_ft=10`, `structure_width_ft=12`, `structure_height_ft=3`, `structure_duration_days=30` |
| `DOB-TENT-AREA-001` + `DOB-TENT-DURATION-001`  | 96    | 84             | 96           | `structure_type=tent`, `structure_length_ft=20`, `structure_width_ft=21`, `structure_duration_days=30`, `structure_height_ft=0`  |

The two counts differ for the tent pair because `structure_height_ft` is read by
`DOB-STAGE-001`/`DOB-TRUSS-001` and so is in the group's field set, but neither tent rule reads it:
on 12 of the 96 the height is unanswered, which leaves the group incomplete while leaving every
fact the two firing members depend on settled.

Both are the obvious real case: a stage that is both large enough and long-lived enough, a tent
that is both over 400 sq ft and up for 30 days. The all-5 set (72 events) needs
`structure_type=null`, which makes every member `unknown` and the intake incomplete.

**Do they disagree? No.** All five members' `output` objects are byte-identical, checked by
comparing the serialised objects rather than by reading them: same `permit_name` ("DOB Alteration
Type 2 or 3 Temporary Structure Permit"), same agency, same `research_required` deadline with the
same display text, no fee, no portal, same `VERIFIED_WITH_QUALIFICATION`. This group merges
frequently, merges on complete intakes, and has nothing to resolve.

### 5.3 `sla_alcohol`, 5 members, max 5, never 2 on a complete intake

8 sets, all driven by `alcohol_service_path` or `venue_license_covers_event_area` being `"unknown"`
or unanswered. 0 of the 24 complete intakes produce two findings. The widest, 5 of 5, occurs twice,
once via the explicit unknown and once via the null:

> `alcohol=true`, `alcohol_service_path=unknown`, `venue_license_covers_event_area=unknown`
> giving `SLA-ALCOHOL-PATH-UNKNOWN-001` true and the other four unknown.

**Do they disagree? Yes.** All five publish distinct `output` objects. `SLA-ONE-DAY-EVENT-001` and
`SLA-CATERING-001` publish different permit names and different fees ($36 versus $48 per point of
sale per day) against the same 15-business-day window and the same portal.
`SLA-EXISTING-LICENSE-001` is a note saying no separate permit is identified, and the two
advisories publish no deadline, fee or portal at all. A merged line has to choose between "One-Day
Alcohol Event Permit, $36" and "Catering Permit, $48" while a third member says neither may apply.
That choice is only ever reached with a material fact missing.

### 5.4 `sapo_insurance`, 4 members, max 4, never 2 on a complete intake

5 sets, all requiring `sapo_event_type` unknown or `block_party_has_ride` unknown or unanswered. 0
of the 16 complete intakes produce two findings. The 4-way set occurs twice:

> `sapo_event_type=unknown`, `block_party_has_ride=unknown`, all four members unknown.

**Do they disagree? Yes, and substantively.** All four publish distinct `output` objects.
`SAPO-INSURANCE-GENERAL-001` publishes a $1,000,000 certificate requirement with a `dependency`
deadline ("Must be provided before SAPO permit issuance"). `SAPO-INSURANCE-BLOCK-EXEMPT-001` is a
note whose entire content is that the general $1 million requirement **does not apply**. Those two
co-fire on 1 intake in the sweep (`sapo_event_type=unknown`, `block_party_has_ride=no`) and in the
4-way set. One line cannot be both. Again, only ever with a material fact missing.

### 5.5 `nypd_sound`, 4 members, max 3, reaches 2 on complete intakes

7 sets. The pairs that co-fire with both members `true`, both of which are complete at group level
and at set level:

| members                                                                               | count | complete | intake                                                                                                                              |
| ------------------------------------------------------------------------------------- | ----- | -------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `NYPD-SOUND-PUBLIC-001` + `NYPD-SOUND-COMMERCIAL-ADVERTISING-PROHIBITED-001`          | 5     | 5        | `amplified_sound=true`, `location_type=street`, `sound_purpose=commercial_advertising`, `sound_audible_in_public_space` not asked   |
| `NYPD-SOUND-PRIVATE-AUDIBLE-001` + `NYPD-SOUND-COMMERCIAL-ADVERTISING-PROHIBITED-001` | 3     | 3        | `amplified_sound=true`, `location_type=private_indoor`, `sound_purpose=commercial_advertising`, `sound_audible_in_public_space=yes` |

The public pair's count is **5**, one for each public `location_type`, not the 15 the previous
revision reported. On a public location the draft never asks
`sound_audible_in_public_space`, and `validateIntake` rejects an answer to it, so the three answers
the old sweep enumerated were three spellings of one event. The private pair is unaffected, because
there the field is in scope and its answer is load-bearing.

`NYPD-SOUND-PUBLIC-001` and `NYPD-SOUND-PRIVATE-AUDIBLE-001` **never** co-fire, in any of the 156
intakes, including when `location_type=unknown`: the private rule's third condition reads
`sound_audible_in_public_space`, which the draft only asks when `location_type` is one of the three
private values, so an unknown location puts it out of scope and the engine reads an out-of-scope
condition as `false` (`conditions.ts:314`). Their outputs are byte-identical anyway.

**Do they disagree? Yes.** The group publishes 3 distinct `output` objects across its 4 members.
See section 6; this is the shape the brief asked about, and it is the only group of the nine that
reaches a genuine disagreement with every material fact answered.

### 5.6 `parks_special_event`, 3 members, max 1

**Never co-fires.** Zero events in 120 produced two findings, and zero of the 108 complete intakes
did. `PARKS-SPECIAL-EVENT-001` needs `headcount gt 20`, `PARKS-SPECIAL-ELEMENT-001` needs
`headcount lte 20` plus sound or structures, and `PARKS-EXACT-20-CONFLICT-001` needs exactly 20
with neither sound nor structures. The three partition the space cleanly, including at the
boundary, and no unknown reopens it: `headcount` is non-nullable in the draft, so it has no
unanswered state to sweep.

The sweep is 120 rather than the 160 an earlier revision reported because `headcount = 0` was in it,
and `validateIntake` rejects a headcount at or below one (`validate.ts:316-317`). The dropped 40
rows are 1 invalid headcount x 10 `location_type` values x 2 `amplified_sound` values x 2
`structures` values. The boundary the group turns on is untouched: 19, 20 and 21 are all still
swept, which is what the partition claim above rests on.

This is the only group of the nine with no merge behaviour at all.

### 5.7 `fdny_generator`, 3 members, max 3, reaches 2 on complete intakes

11 sets. Both `true`-only pairs are the battery rule alongside a fuel rule, and both are complete:

| members                                            | count | complete | intake                                                                                                                                             |
| -------------------------------------------------- | ----- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `FDNY-GENERATOR-GASOLINE-001` + `FDNY-BATTERY-001` | 28    | 28       | `generator_present=true`, `generator_fuel_type=gasoline`, `generator_aggregate_tank_gallons=3.5`, `location_type=street`, `outdoor_battery_kwh=21` |
| `FDNY-GENERATOR-DIESEL-001` + `FDNY-BATTERY-001`   | 7     | 7        | as above with `diesel` and `11` gallons                                                                                                            |

The gasoline and diesel rules are mutually exclusive on `generator_fuel_type` and co-fire only when
it is unknown (136 events, none of them complete).

**Do they disagree? No.** All three members' `output` objects are byte-identical: same
"FDNY Generator/Battery Permit" name, same agency, same `research_required` deadline and display,
same fee display, no portal, same verification status.

### 5.8 `dob_assembly`, 3 members, max 3, never 2 on a complete intake

2 sets, both requiring `location_type=unknown`, and neither complete:

| members                            | count | complete | intake                                                    |
| ---------------------------------- | ----- | -------- | --------------------------------------------------------- |
| `INDOOR` + `ROOFTOP`, both unknown | 3     | 0        | `location_type=unknown`, `peak_concurrent_attendance=75`  |
| all three, all unknown             | 3     | 0        | `location_type=unknown`, `peak_concurrent_attendance=200` |

The first set is the interesting one: at 75 attendees the indoor and rooftop rules would fire and
the outdoor rule (threshold 200) would not, but with the location unknown all that is decided is
that the outdoor rule is definitely not it.

**Do they disagree? No.** All three members' `output` objects are byte-identical, including the
three-branch `paths` array. They differ only in trigger.

### 5.9 `block_party_eligibility`, 2 members, max 2, never 2 on a complete intake

Full factorial over the 15 fields the two members read, one of which (`event_date`) is fixed:
24,330,240 intakes. Four sets, none of them complete:

| members and results                                                                            | count     | share  | complete |
| ---------------------------------------------------------------------------------------------- | --------- | ------ | -------- |
| `SAPO-BLOCK-PARTY-INELIGIBLE-001` unknown + `SAPO-BLOCK-PARTY-ELIGIBILITY-UNKNOWN-001` unknown | 2,334,828 | 9.6%   | **0**    |
| both **true**                                                                                  | 1,872,768 | 7.7%   | **0**    |
| `INELIGIBLE` true + `ELIGIBILITY-UNKNOWN` unknown                                              | 460,692   | 1.9%   | **0**    |
| `INELIGIBLE` unknown + `ELIGIBILITY-UNKNOWN` true                                              | 1,152     | 0.005% | **0**    |

The both-true case, first intake in enumeration order:

> `sapo_event_type=block_party`, `has_sales=true`, `has_fundraising=true`, `alcohol=true`,
> `has_vendors=true`, `branding_or_promotion=yes`, `commercial_sponsorship=true`,
> `rain_date_requested=true`, `open_to_all_block_neighbors=yes`, `neighbor_permission_received=yes`,
> `block_count=0`, `event_duration_hours=0`, `event_end_date=null`,
> `organizer_type=unknown`

`has_sales=true` is a disqualifier, so the ineligibility rule fires `true`; `organizer_type` is the
engine's explicit-unknown answer, which the advisory's `eq "unknown"` branch **accepts**, so it
fires `true` as well. Both are `true`, and the intake is **not** complete: the organizer type is
exactly the fact nobody has supplied. That is the whole shape of this group. The advisory's `any`
block holds five branches, three `eq "unknown"` and two `is_null`, so it cannot be decisive unless
something is missing, and the pair therefore cannot both be `true` on a complete intake. Zero of
1,474,560 complete intakes produce a co-firing event of any kind.

**Do they disagree? Yes in the draft, and no on the current mapping.** The disagreement is real as
published data. `SAPO-BLOCK-PARTY-INELIGIBLE-001` publishes `status: CLASSIFICATION_INELIGIBLE`,
`severity: blocking`, and the message "The event does not qualify as a Block Party under the
supplied facts. Reclassify it before calculating the permit plan", with `suggested_classes`.
`SAPO-BLOCK-PARTY-ELIGIBILITY-UNKNOWN-001` publishes `status: CONDITIONAL` and an advisory to
confirm the same facts before treating the event as an eligible block party. Neither publishes a
deadline, fee, portal or permit name, so as draft intent the conflict is confined to disposition:
"you are disqualified" merged with "we cannot yet tell whether you are eligible", arriving on 7.7%
of the sweep and never on settled facts.

**That organizer-visible line is draft intent, not something the current mapping produces**, and the
distinction matters because the previous revision asserted the conflict as an engine outcome.
`parseRule` (`packages/engine/src/ruleset.ts:484-520`) recognises `output.disposition` and derives a
name only from `permit_name`, `requirement_name`, `advisory_text` or `note_text`. The ineligibility
rule publishes none of those: `status`, `message` and `suggested_classes` are fields no engine code
reads. So the parser defaults this `kind: eligibility` rule to `may_be_required`
(`DEFAULT_DISPOSITION_BY_RULE_KIND`, `proposals.ts:53`), gives it a null name, and ignores its
message. It is also listed first in `rules[]`, ahead of the advisory in `advisories[]`, and `dedupe`
(`findings.ts:153-166`) retains the first finding's scalars, so its null name and defaulted
disposition survive and the later advisory's own text is dropped. The line the organizer would see
says neither "disqualified" nor "we cannot tell". The blocker disappears exactly as the sound
blocker does in section 6, and for the same reason. Qualifying this as draft intent is not a
softening of the finding; it is the finding, and it is the same one twice.

The group also mixes `VERIFIED` and `CONDITIONAL` verification statuses, which `ruleset.ts:665`
refuses on load.

## 6. The blocker-plus-window shape

The brief singles out one shape: a co-firing set where one member is a blocker (kind `eligibility`,
or a prohibited disposition) and another is a permit with a filing window, because the merged line
then reads as prohibited while quoting the permit's deadline.

**Verified: `nypd_sound` is the only group of the nine with that shape, and it is the only group of
the nine that reaches a disagreement on a complete intake.**

`NYPD-SOUND-COMMERCIAL-ADVERTISING-PROHIBITED-001` is `kind: eligibility`, `severity: blocking`,
`status: PROHIBITED_USE`, publishing NYC Administrative Code section 10-108 and no permit name, no
deadline, no fee and no portal. It co-fires `true`-with-`true` against:

- `NYPD-SOUND-PUBLIC-001` on 5 of 156 intakes, all 5 complete. That rule publishes the Sound
  Device Permit, a `published_minimum` of 5 calendar days ("File at the precinct no fewer than five
  days before use"), a fee of "$45 per sound device for the first day, plus $5 per device for each
  additional day", and the NYPD precinct portal.
- `NYPD-SOUND-PRIVATE-AUDIBLE-001` on 3 of 156 intakes, all 3 complete, with an identical output
  object.

It also co-fires `unknown`-side on a further 28 intakes (10 + 9 + 6 + 3), none of them complete,
where the prohibition is unknown because `sound_purpose` is unanswered while the permit fires
`true`.

The permit rules are listed first in `rules[]` (indices 29 and 30, against 32 for the prohibition),
and `dedupe` (`findings.ts:153-166`) keeps the first finding's scalars, so under the current merge
the surviving name, deadline, fee and portal would all be the permit's.

Two qualifications, both important and neither speculative:

1. **The draft's blocker vocabulary is not engine-readable today.** `severity` and
   `status: PROHIBITED_USE` are fields no engine code reads (limitation 7), and the rule publishes
   no `output.disposition`. Under the current parser a `kind: eligibility` rule with no published
   disposition takes `DEFAULT_DISPOSITION_BY_RULE_KIND` (`proposals.ts:53`), which is
   `may_be_required`, not `prohibited_or_ineligible`. So on the code as it stands the merged line
   would not read "prohibited" at all; the prohibition's entire content would be dropped, because
   the rule contributes no `name`, no `note_text` and no scalar that survives the merge. It would
   contribute its rule id and its section 10-108 source, and nothing a reader sees as a
   prohibition.
2. **That is a statement about the current mapping, not about the draft's intent.** The draft
   plainly intends a blocker. Which of the two failure shapes actually occurs, a prohibition quoting
   a filing deadline or a prohibition silently disappearing, depends on schema work that has not
   happened. Both start from the same measured fact: on 8 of 156 intakes, both rules fire `true`,
   both reach the same merged line, and every field either rule reads is answered.

The other groups holding a blocker do not have the shape. The draft has four `severity: blocking`
rules, all of them `kind: eligibility`: this one, `SAPO-BLOCK-PARTY-INELIGIBLE-001`,
`SAPO-ALCOHOL-PROHIBITION-001` and `PARKS-PROPANE-PROHIBITION-001`. `block_party_eligibility` pairs
its blocker with an advisory that publishes no window, and its blocker is unreadable to the current
mapping in exactly the way qualification 1 describes (section 5.9). `sapo_alcohol` and
`parks_propane` are single-member dedupe groups and never merge with anything.

## 7. Which groups present a merge conflict

Stated plainly, from the numbers above.

**Merges with a real conflict to resolve, five groups:**

- `sapo_permit`. Up to 14 members on one line, disagreeing on permit name, deadline type, window
  length, and fee. Never on a complete intake.
- `sla_alcohol`. Up to 5 members, disagreeing on permit name and fee against a common window, with
  a note member asserting no permit is needed. Never on a complete intake.
- `sapo_insurance`. Up to 4 members, one requiring a $1 million certificate and another stating the
  requirement does not apply. Never on a complete intake.
- `block_party_eligibility`. Two members, disagreeing on disposition as the draft publishes them, on
  7.7% of a 24.3-million intake factorial. Never on a complete intake, and not a conflict the
  current mapping would render at all (5.9).
- `nypd_sound`. Up to 3 members, pairing a section 10-108 prohibition with a dated, priced permit.
  **On a complete intake, on 8 of its 84 complete intakes.**

That is five conflicts. **Four of them are reachable only when a material fact is missing. One,
`nypd_sound`, is reachable with every material fact answered.** The previous revision named two
here, `nypd_sound` and `block_party_eligibility`; the second was an artifact of reading a `true`
aggregate as a settled fact, and is withdrawn.

**Merges with nothing to resolve, three groups:**

- `dob_temporary_structure` (5 members, merges on 24.2% of its sweep and on 11.0% of its complete
  intakes, outputs byte-identical)
- `fdny_generator` (3 members, 8.5% and 1.7%, outputs byte-identical)
- `dob_assembly` (3 members, 7.5% of its sweep and 0% of its complete intakes, outputs
  byte-identical)

**Never merges, one group:**

- `parks_special_event`. Zero co-firing events in 120. A genuine partition, boundary included.

**Control, for comparison:** the published ruleset's one group merges on 54.0% of its sweep and on
35.4% of its complete intakes, and its two members do differ in name, disposition, deadline and fee.
Both shares are several times what the previous revision reported, because that sweep counted
selections the intake contract rejects and out-of-scope answers nobody can give (3.3, 4.4). The
published baseline is therefore not a smaller version of the same behaviour: measured over valid
submissions only, the shipped ruleset's one dedupe group faces a merge choice **more** often than
any draft group does, and more often than it does on a complete intake than any of them.

**What this does and does not say about the engine design that cites this document.** The
discriminator that design uses is each route's own trigger result, resolved versus unknown. Nothing
here bears on that: sections 4.1 and 4.2 measure exactly that property, and a route whose trigger
came back `unknown` is correctly treated as undecided whatever the intake looks like. The
corrections in this revision are to how often each shape occurs, not to which shapes occur: no
co-firing set appeared or disappeared in any of the nine draft groups or in the control, and the
per-shape counts moved only in `nypd_sound`, where they fell because one event was previously
counted three times. What changed alongside them is this document's characterisation of when the
groups genuinely overlap. On the corrected measurement, a merged line with two decisive members and
no missing facts happens in three of the nine draft groups, and in only one of them do the members
disagree about anything. The one figure a reader of that design should re-read is the control's:
its group merges on 54.0% of valid submissions, not 14.0%.

## 8. Reproducing this

**The harness is committed.** It lives in `scripts/dedupe-cofiring/` and runs on one command:

```sh
pnpm test:cofiring                  # every figure in this document, asserted
PRINT_TABLES=1 pnpm test:cofiring   # the same run, printing the tables to diff against this file
```

It is four modules and one suite, all under 700 lines together:

| file                | what it is                                                                                                                                    |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `harness.mjs`       | field definitions, value domains, the valid-intake enumerator, `evalTrigger`, the group sweeps and the control sweep                          |
| `staging.mjs`       | the adaptations of section 3.1, applied to in-memory clones                                                                                   |
| `inventory.mjs`     | what the draft publishes, re-derived by parsing it: deadlines, permit names, output identity, blockers, mixed statuses, parser-visible output |
| `report.mjs`        | one `measure()` call that produces every table, plus the printer                                                                              |
| `cofiring.test.mjs` | 71 test cases, one or more per published figure                                                                                               |

Every table maps to a `describe` block with the same number:

| table                                     | assertion                                                                                                                                         |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| 3.1, the load-staging errors              | `describe("section 3.1, the load-staging errors")`                                                                                                |
| 3.2, the agreement check                  | `describe("section 3.2, what the harness supplies")`                                                                                              |
| 3.3, the sweep sizes and the domain rules | `describe("section 3.3, the sweep")`, whose headcount case runs `validateIntake` on the rejected value and the admitted one                       |
| 3.4, limitations 3, 4, 5 and 9            | `describe("section 3.4, the limitations")`                                                                                                        |
| 3.5, the supplied semantics               | `jq '.engine_operators, .derived_values' rules/proposals/nyc-rules.v2-full-draft.json`, and the `is_null`/`lte` half of `describe("section 3.2")` |
| 4.1, findings per event                   | `describe("section 4.1, findings per event")`                                                                                                     |
| 4.2, `true`-only                          | `describe("section 4.2, ...")`                                                                                                                    |
| 4.3, completeness                         | `describe("section 4.3, completeness")`                                                                                                           |
| 4.4, the control                          | `describe("section 4.4, the published control")`                                                                                                  |
| every table and count in section 5        | `describe("section 5, the co-firing sets")`                                                                                                       |
| section 6's blocker inventory and counts  | `describe("section 6, the blocker-plus-window shape")`                                                                                            |
| section 7                                 | restates 4.1, 4.2, 4.3 and 4.4; it publishes no figure of its own                                                                                 |

The whole run takes about six seconds, of which five are the 24,330,240-intake
`block_party_eligibility` sweep. It is not gated behind a flag and it is in the include list
`vitest.config.ts` already uses for `scripts/`, so `pnpm test` runs it. A change to the draft, to
`packages/engine`, or to the harness that moves any number in this document fails CI with the
number that moved.

Nothing above was read off by eye. Where an earlier revision of this document stated a count from
reading the draft, that count has been re-derived by parsing it: the SAPO deadline and permit-name
inventory (5.1), the `fuel_types`/`open_flame_types` reader list (limitation 5), the byte-identity
claims (5.2, 5.5, 5.7, 5.8), the numeric-operator and date-operand audits (limitations 3 and 4), the
`severity: blocking` list (section 6), the mixed-verification-status group list (3.1), and what
`parseRule` makes of a blocker's output (5.9 and 6). Four of those enumerations were wrong and are
corrected above.

Nothing under `rules/`, `packages/engine/src/` or `apps/` is modified by the PR carrying this
document. The harness reads both artifacts and writes nothing.

The one-liners that reproduce the section 5.1 inventory without the harness:

```sh
# the 11 published_minimum calendar-day values, in rule order
jq -r '[.rules[] | select(.output.dedupe_key=="sapo_permit")]
       | map(.output.deadline | select(.type=="published_minimum") | .calendar_days) | @csv' \
  rules/proposals/nyc-rules.v2-full-draft.json

# the deadline types, and the distinct permit names
jq -r '[.rules[] | select(.output.dedupe_key=="sapo_permit")]
       | (map(.output.deadline.type) | group_by(.) | map({(.[0]): length}) | add),
         (map(.output.permit_name) | unique)' \
  rules/proposals/nyc-rules.v2-full-draft.json

# every rule whose trigger reads open_flame_types or fuel_types, with its dedupe group
jq -r '[.rules[],.advisories[]]
       | map(select((tostring | test("open_flame_types|fuel_types"))))
       | .[] | "\(.id)\t\(.output.dedupe_key)"' \
  rules/proposals/nyc-rules.v2-full-draft.json
```

The previous revision printed a prose recipe here in place of the code. It was not enough to
reproduce these tables from, which is the reason the harness is committed now: a measurement nobody
can re-run is a measurement nobody can correct, and this document's figures are cited outside it.

`docs/research/` did not exist before this document and is **not** gitignored: `git check-ignore -v
docs/research` exits 1 with no match, and the `.gitignore` entries covering documentation
(`.impeccable/`, `apps/web/DESIGN.md`, `apps/web/PRODUCT.md`) do not reach it. This file is
therefore tracked normally.
