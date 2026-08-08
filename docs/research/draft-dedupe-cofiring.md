# Dedupe co-firing in the v2 full draft, measured

## 0. What this document is, and what it is not

Read this before any number below.

**This is a measurement of a PROPOSED artifact that the engine cannot load.**
`rules/proposals/nyc-rules.v2-full-draft.json` is PROPOSED in `docs/BASELINE.md`. It does not load
through `parseEngineRuleset`, and the reason it does not is not cosmetic: it uses two trigger
operators (`is_null`, `lte`) that `packages/engine` has no case for, and three derived values that
the engine does not compute. Every number here was produced by a scratch harness that supplied
those five pieces itself. Section 3.2 states exactly what was supplied and on what basis, and
section 3.5 re-checks each one against the draft.

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
**Measured on:** commit `7b5f816`, branch `measure/draft-dedupe-cofiring`.
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

Completeness is therefore computed from the intake alone, by `isComplete` in the harness, which
consults the scope resolver and the answers and never looks at a trigger result. Sections 4.1, 4.2
and 4.3 report A, B and C over the same sweeps.

One caveat on the definition, stated because it changes counts: completeness is measured at the
**group** level, over every field any member of the group reads, not only the fields the
particular co-firing members read. Where the two readings differ, section 5 gives both.

## 3. Method, including every limitation

### 3.1 The draft does not load through `parseEngineRuleset`

It does not, and the reason is not one thing. Running the parser against successively adapted
in-memory copies (never against the file in `rules/`, which is never written) produces this
sequence of real error messages. The table is reproduced by `staging.test.ts` in the harness
(section 8), which applies each adaptation programmatically and prints what the parser says next:

| adaptation applied so far                                                                                                                                                                            | next error from `parseEngineRuleset`                                                                                                                                                                                               |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| none                                                                                                                                                                                                 | `ruleset.rules[4].output.deadline.type has unsupported value "conditional"`                                                                                                                                                        |
| drop the 6 deadlines whose type the engine has no case for (`conditional` x3, `official_conflict`, `fixed_annual_date`, `dependency`) and the 4 `published_minimum` deadlines not in `calendar_days` | `ruleset.rules[4].verification.status has unsupported value "VERIFIED_WITH_QUALIFICATION"`                                                                                                                                         |
| map `VERIFIED_WITH_QUALIFICATION` (33 rules) and `CONDITIONAL` (8 rules) onto statuses the engine knows                                                                                              | `ruleset.rules[8].trigger.all[1].any[3].op has unsupported value "is_null"`                                                                                                                                                        |
| map the 3 kinds the engine does not declare (`conditional_requirement` x4, `approval`, `certificate`) and publish `config.business_day_math.calendar`                                                | same `is_null` error                                                                                                                                                                                                               |
| DIAGNOSTIC ONLY, semantics-changing: rewrite the 7 `is_null` leaves and the 1 `lte` leaf                                                                                                             | `rule SAPO-BLOCK-PARTY-INELIGIBLE-001 references undeclared field "event_days"`                                                                                                                                                    |
| DIAGNOSTIC ONLY: declare the 3 derived values as intake fields                                                                                                                                       | `dedupe key "sapo_permit" mixes verification statuses "VERIFIED" and "OFFICIAL_CONFLICT"`                                                                                                                                          |
| DIAGNOSTIC ONLY: collapse every verification status                                                                                                                                                  | `intake field "event_address" is declared but no rule trigger, deadline, or scoping condition reads it, so answering it changes nothing. Give a rule that consumes it, or record why it is collected in UNCONSUMED_INTAKE_FIELDS.` |

Which dedupe key the sixth row names depends on which statuses the third row's mapping collapsed;
five of the nine multi-member groups mix statuses, so some key fails there under any such mapping.

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

`evalTrigger` (scratch, outside the repo tree) is a tri-state walker that:

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

**Agreement check.** Over the 2,400-intake control sweep, `evalTrigger` was compared against the
engine's `evaluateTrigger` for all 46 rules of the published ruleset: **110,400 comparisons, 0
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

Value domains, applied uniformly by `domainFor` in the harness:

- **enum / boolean:** every value the artifact declares, plus `null` when it marks the field
  nullable. Note that several enums declare `"unknown"` as a member, and the engine treats the
  literal string `"unknown"` as the explicit-unknown answer (`conditions.ts:242`), so that value is
  a genuine tri-state input rather than a plain option, and is distinct from `null`.
- **multi_enum:** the full power set of the declared values.
- **numeric:** `0`, plus `t-1`, `t`, `t+1` for every threshold `t` any member compares the field
  against, plus `null` when nullable.
- **dates:** `event_date` is fixed at `2026-09-01`; `event_end_date` ranges over `{null,
2026-09-01, 2026-09-02}`, giving `event_days` of 1, 1 and 2, which covers the only threshold
  (`event_days gt 1`) below, on and above.
- **`structure_length_ft` and `structure_width_ft`** are the one hand-set domain, `{null, 10, 12,
20, 21}`, because their thresholds are on their product: those products straddle both published
  area thresholds (120 and 400) on all three sides.

Sweep sizes: from 36 to 24,330,240 intakes per group, **24,352,216** draft intakes in total, plus
**2,400** control intakes. Every one was evaluated; nothing was truncated.

**Two sweep sizes changed from the previous revision of this document, and one control size.** The
rule above is now applied uniformly, and the previous run did not apply it uniformly: it omitted
`0` from the domains of `structure_height_ft` and `event_duration_hours` while including it
everywhere else, and it added `null` to the control's `structure_over_10ft_tall`, which
`rules/nyc-rules.v2.11.json` does not declare nullable. So `dob_temporary_structure` is 10,000
rather than 8,750, `block_party_eligibility` is 24,330,240 rather than 19,464,192, the control is
2,400 rather than 3,200, and the agreement check is 110,400 comparisons rather than 147,200. Every
percentage that has a sweep size in its denominator therefore moved. No qualitative conclusion in
this document turns on those three domain corrections; the ones that changed are in section 4.3,
and they changed because completeness is now measured at all.

### 3.4 Limitations, stated plainly

Each of these was re-derived from the draft by enumeration, not by re-reading the prose. Limitation
5 was wrong in the previous revision and is corrected here; the others were checked the same way
and are stated as the enumeration found them.

1. **This measures triggers, not rendered plan items.** The draft cannot run through
   `resolveFindings`, so the merged line's actual text was not produced. What is measured is which
   members reach the merge and what each one publishes.
2. **Two trigger operators are this harness's reading, not the draft's declarations, and three
   derived formulas are the draft's.** See sections 3.2 and 3.5. `is_null` and `lte` do not exist
   in `packages/engine` and are not defined by the draft. If `is_null` is eventually implemented as
   also matching an explicit `"unknown"` answer, the `block_party_eligibility` numbers shift.
   Section 3.5 states what does and does not depend on this.
3. **Numeric domains are threshold-local.** They prove behaviour below, on and above every
   threshold, and cannot surface a discontinuity that exists nowhere near a threshold. Enumerated:
   every leaf in the draft that reads a numeric field uses `gt`, `gte`, `lte`, `eq` or `is_null`,
   and every one of them names its own constant, so there is no construct that discriminates away
   from a swept value. The `0` in each numeric domain is the only non-threshold point swept.
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
| `is_null`              | the name, in the `engine_operators` array. No semantics anywhere in the file.                                                           | **No, weaker than claimed.** The draft never says whether an explicit `"unknown"` answer is null. The harness says it is not.                                                                   |

**What depends on the `is_null` reading.** `is_null` appears on 7 leaves, all on nullable numeric
fields (`block_count`, `event_duration_hours`, `generator_aggregate_tank_gallons`,
`structure_length_ft`, `structure_width_ft`, `structure_height_ft`, `structure_duration_days`),
none of which declares an `unknown` enum member, so under this harness's domains the question never
arises: those fields are swept over numbers and `null`, and never over the string `"unknown"`. Of
the 7, only 2 are in a multi-member group, both in `SAPO-BLOCK-PARTY-ELIGIBILITY-UNKNOWN-001`. So
the reading affects `block_party_eligibility` and nothing else, and within that group it affects
only how often the advisory fires, not the section 4.3 result that the group never co-fires on a
complete intake: every branch of that rule's `any` requires an unsettled fact under either reading.

## 4. Results

### 4.1 Property A, findings per event (trigger `true` or `unknown`), draft

| group                     | members | sweep      | 0          | 1       | 2         | 3   | 4   | 5   | 6+  | max    | share >= 2 |
| ------------------------- | ------- | ---------- | ---------- | ------- | --------- | --- | --- | --- | --- | ------ | ---------- |
| `sapo_permit`             | 14      | 6,480      | 1,034      | 4,332   | 100       | 144 | 100 | 34  | 736 | **14** | 17.2%      |
| `dob_temporary_structure` | 5       | 10,000     | 4,480      | 3,096   | 1,902     | 270 | 180 | 72  | 0   | **5**  | 24.2%      |
| `sla_alcohol`             | 5       | 60         | 37         | 11      | 2         | 4   | 2   | 4   | 0   | **5**  | 20.0%      |
| `sapo_insurance`          | 4       | 36         | 4          | 26      | 2         | 2   | 2   | 0   | 0   | **4**  | 16.7%      |
| `nypd_sound`              | 4       | 360        | 216        | 63      | 72        | 9   | 0   | 0   | 0   | **3**  | 22.5%      |
| `parks_special_event`     | 3       | 160        | 132        | 28      | 0         | 0   | 0   | 0   | 0   | **1**  | 0.0%       |
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
| `nypd_sound`              | 234        | 108     | 18        | **2** | 5.0%       |
| `parks_special_event`     | 146        | 14      | 0         | **1** | 0.0%       |
| `fdny_generator`          | 3,913      | 852     | 35        | **2** | 0.7%       |
| `dob_assembly`            | 68         | 12      | 0         | **1** | 0.0%       |
| `block_party_eligibility` | 21,627,024 | 830,448 | 1,872,768 | **2** | 7.7%       |

Five of the nine groups never reach 2 decisive triggers at all. Four do. **This table does not say
that those four reach 2 with the facts settled**, which is what the previous revision read it as
saying, and which section 4.3 shows is false for one of them.

### 4.3 Property C, completeness, measured independently of any trigger result

`complete` counts intakes in which every field any member of the group reads is settled. It is
computed from the intake and the scope resolver alone.

| group                     | sweep      | complete | complete share | complete AND >= 2 findings | complete AND >= 2 true |
| ------------------------- | ---------- | -------- | -------------- | -------------------------- | ---------------------- |
| `sapo_permit`             | 6,480      | 1,536    | 23.7%          | **0**                      | **0**                  |
| `dob_temporary_structure` | 10,000     | 4,032    | 40.3%          | **444**                    | **444**                |
| `sla_alcohol`             | 60         | 24       | 40.0%          | **0**                      | **0**                  |
| `sapo_insurance`          | 36         | 16       | 44.4%          | **0**                      | **0**                  |
| `nypd_sound`              | 360        | 204      | 56.7%          | **18**                     | **18**                 |
| `parks_special_event`     | 160        | 144      | 90.0%          | **0**                      | **0**                  |
| `fdny_generator`          | 4,800      | 2,016    | 42.0%          | **35**                     | **35**                 |
| `dob_assembly`            | 80         | 63       | 78.8%          | **0**                      | **0**                  |
| `block_party_eligibility` | 24,330,240 | 983,040  | 4.0%           | **0**                      | **0**                  |

**Three groups of the nine co-fire on a complete intake: `dob_temporary_structure` (444 of 4,032
complete intakes, 11.0%), `nypd_sound` (18 of 204, 8.8%) and `fdny_generator` (35 of 2,016, 1.7%).
The other six never do.**

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
`DOB-TALL-STRUCTURE-001`. Sweep: the power set of `structure_types` (32) x `tent_area_sqft` (5) x
`tent_days_in_place` (5) x `structure_over_10ft_tall` (3) = 2,400 intakes, run through the real
`parseEngineRuleset` and the engine's own `evaluateTrigger`.

|                                | 0     | 1     | 2   | share >= 2                             |
| ------------------------------ | ----- | ----- | --- | -------------------------------------- |
| findings (`true` or `unknown`) | 1,028 | 1,036 | 336 | **14.0%**                              |
| `true` only                    | 1,530 | 766   | 104 | **4.3%**                               |
| complete intakes only          | 978   | 566   | 96  | **5.9%** of the 1,640 complete intakes |
| complete AND `true` only       | 1,042 | 518   | 80  | **4.9%** of the 1,640 complete intakes |

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

**The baseline is not "the merge never has a choice".** It has one on 14.0% of this sweep, and on
5.9% of its complete intakes. The two published members do disagree: `DOB-TENT-001` publishes a
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
| `NYPD-SOUND-PUBLIC-001` + `NYPD-SOUND-COMMERCIAL-ADVERTISING-PROHIBITED-001`          | 15    | 15       | `amplified_sound=true`, `location_type=street`, `sound_purpose=commercial_advertising`, `sound_audible_in_public_space=yes`         |
| `NYPD-SOUND-PRIVATE-AUDIBLE-001` + `NYPD-SOUND-COMMERCIAL-ADVERTISING-PROHIBITED-001` | 3     | 3        | `amplified_sound=true`, `location_type=private_indoor`, `sound_purpose=commercial_advertising`, `sound_audible_in_public_space=yes` |

`NYPD-SOUND-PUBLIC-001` and `NYPD-SOUND-PRIVATE-AUDIBLE-001` **never** co-fire, in any of the 360
intakes, including when `location_type=unknown`: the private rule's third condition reads
`sound_audible_in_public_space`, which the draft only asks when `location_type` is one of the three
private values, so an unknown location puts it out of scope and the engine reads an out-of-scope
condition as `false` (`conditions.ts:314`). Their outputs are byte-identical anyway.

**Do they disagree? Yes.** The group publishes 3 distinct `output` objects across its 4 members.
See section 6; this is the shape the brief asked about, and it is the only group of the nine that
reaches a genuine disagreement with every material fact answered.

### 5.6 `parks_special_event`, 3 members, max 1

**Never co-fires.** Zero events in 160 produced two findings, and zero of the 144 complete intakes
did. `PARKS-SPECIAL-EVENT-001` needs `headcount gt 20`, `PARKS-SPECIAL-ELEMENT-001` needs
`headcount lte 20` plus sound or structures, and `PARKS-EXACT-20-CONFLICT-001` needs exactly 20
with neither sound nor structures. The three partition the space cleanly, including at the
boundary, and no unknown reopens it: `headcount` is non-nullable in the draft, so it has no
unanswered state to sweep.

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
983,040 complete intakes produce a co-firing event of any kind.

**Do they disagree? Yes.** `SAPO-BLOCK-PARTY-INELIGIBLE-001` publishes
`status: CLASSIFICATION_INELIGIBLE`, `severity: blocking`, and the message "The event does not
qualify as a Block Party under the supplied facts. Reclassify it before calculating the permit plan",
with `suggested_classes`. `SAPO-BLOCK-PARTY-ELIGIBILITY-UNKNOWN-001` publishes `status: CONDITIONAL`
and an advisory to confirm the same facts before treating the event as an eligible block party.
Neither publishes a deadline, fee, portal or permit name, so the conflict is confined to
disposition: "you are disqualified" merged with "we cannot yet tell whether you are eligible". It
is a real disagreement, on a line the organizer will see, and it arrives on 7.7% of the sweep. It
is **not** a disagreement about settled facts. The group also mixes `VERIFIED` and `CONDITIONAL`
verification statuses, which `ruleset.ts:665` refuses on load.

## 6. The blocker-plus-window shape

The brief singles out one shape: a co-firing set where one member is a blocker (kind `eligibility`,
or a prohibited disposition) and another is a permit with a filing window, because the merged line
then reads as prohibited while quoting the permit's deadline.

**Verified: `nypd_sound` is the only group of the nine with that shape, and it is the only group of
the nine that reaches a disagreement on a complete intake.**

`NYPD-SOUND-COMMERCIAL-ADVERTISING-PROHIBITED-001` is `kind: eligibility`, `severity: blocking`,
`status: PROHIBITED_USE`, publishing NYC Administrative Code section 10-108 and no permit name, no
deadline, no fee and no portal. It co-fires `true`-with-`true` against:

- `NYPD-SOUND-PUBLIC-001` on 15 of 360 intakes, all 15 complete. That rule publishes the Sound
  Device Permit, a `published_minimum` of 5 calendar days ("File at the precinct no fewer than five
  days before use"), a fee of "$45 per sound device for the first day, plus $5 per device for each
  additional day", and the NYPD precinct portal.
- `NYPD-SOUND-PRIVATE-AUDIBLE-001` on 3 of 360 intakes, all 3 complete, with an identical output
  object.

It also co-fires `unknown`-side on a further 54 intakes (30 + 9 + 6 + 9), none of them complete,
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
   happened. Both start from the same measured fact: on 18 of 360 intakes, both rules fire `true`,
   both reach the same merged line, and every field either rule reads is answered.

The other groups holding a blocker do not have the shape. The draft has four `severity: blocking`
rules, all of them `kind: eligibility`: this one, `SAPO-BLOCK-PARTY-INELIGIBLE-001`,
`SAPO-ALCOHOL-PROHIBITION-001` and `PARKS-PROPANE-PROHIBITION-001`. `block_party_eligibility` pairs
its blocker with an advisory that publishes no window. `sapo_alcohol` and `parks_propane` are
single-member dedupe groups and never merge with anything.

## 7. Which groups present a merge conflict

Stated plainly, from the numbers above.

**Merges with a real conflict to resolve, five groups:**

- `sapo_permit`. Up to 14 members on one line, disagreeing on permit name, deadline type, window
  length, and fee. Never on a complete intake.
- `sla_alcohol`. Up to 5 members, disagreeing on permit name and fee against a common window, with
  a note member asserting no permit is needed. Never on a complete intake.
- `sapo_insurance`. Up to 4 members, one requiring a $1 million certificate and another stating the
  requirement does not apply. Never on a complete intake.
- `block_party_eligibility`. Two members, disagreeing on disposition, on 7.7% of a 24.3-million
  intake factorial. Never on a complete intake.
- `nypd_sound`. Up to 3 members, pairing a section 10-108 prohibition with a dated, priced permit.
  **On a complete intake, on 18 of its 204 complete intakes.**

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

- `parks_special_event`. Zero co-firing events in 160. A genuine partition, boundary included.

**Control, for comparison:** the published ruleset's one group merges on 14.0% of its sweep and on
5.9% of its complete intakes, and its two members do differ in name, disposition, deadline and fee.
The published baseline is a smaller version of the same behaviour, not an absence of it.

**What this does and does not say about the engine design that cites this document.** The
discriminator that design uses is each route's own trigger result, resolved versus unknown. Nothing
here bears on that: sections 4.1 and 4.2 measure exactly that property, they are unchanged, and a
route whose trigger came back `unknown` is correctly treated as undecided whatever the intake looks
like. What changed is this document's characterisation of when the groups genuinely overlap. On the
corrected measurement, a merged line with two decisive members and no missing facts happens in
three of the nine draft groups, and in only one of them do the members disagree about anything.

## 8. Reproducing this

Every table above comes from one of five artifacts. The harness is scratch code outside the
repository and is not committed; nothing under `rules/`, `packages/engine/src/` or `apps/` was
modified by the PR carrying this document.

| table                                                                     | produced by                                                                                                   |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| 3.1, the load-staging errors                                              | `staging.test.ts`: applies each adaptation to an in-memory clone and prints `parseEngineRuleset`'s next error |
| 3.5, the supplied semantics                                               | `jq '.engine_operators, .derived_values' rules/proposals/nyc-rules.v2-full-draft.json`                        |
| 4.1, 4.2, 4.3 and every table in section 5                                | `draft.test.ts`: the nine group sweeps, 24,352,216 intakes in 62 seconds, writing `draft-results.json`        |
| 4.4 and the agreement check                                               | `control.test.ts`: the published ruleset through the real parser                                              |
| 5.1's SAPO inventory and the output-identity claims in 5.2, 5.5, 5.7, 5.8 | `inventory.mjs`, a plain `node` script over the draft JSON (below)                                            |
| 5.1's unsettled-field breakdown                                           | `sapo.test.ts`: recounts the 6,480 `sapo_permit` intakes by which fields were unsettled                       |

Nothing above was read off by eye. Where an earlier revision of this document stated a count from
reading the draft, that count has been re-derived by parsing it: the SAPO deadline and permit-name
inventory (5.1), the `fuel_types`/`open_flame_types` reader list (limitation 5), the byte-identity
claims (5.2, 5.5, 5.7, 5.8), the numeric-operator and date-operand audits (limitations 3 and 4),
and the `severity: blocking` list (section 6). Three of those enumerations were wrong and are
corrected above.

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

To rebuild the harness: load the two JSON artifacts, build `IntakeFieldDefinition`s from the
draft's `intake_fields` with the two `asked_when` translations from 3.2, add the three derived
values as declared pseudo-fields, walk each rule's trigger delegating every supported node to
`packages/engine/src/conditions.ts#evaluateTrigger` with a `createScopeResolver` built per intake,
supply `is_null` and `lte` per 3.2, enumerate each group's field factorial per 3.3, and compute
completeness per section 2 from the intake and the scope resolver alone, never from a trigger
result.

`docs/research/` did not exist before this document and is **not** gitignored: `git check-ignore -v
docs/research` exits 1 with no match, and the `.gitignore` entries covering documentation
(`.impeccable/`, `apps/web/DESIGN.md`, `apps/web/PRODUCT.md`) do not reach it. This file is
therefore tracked normally.
