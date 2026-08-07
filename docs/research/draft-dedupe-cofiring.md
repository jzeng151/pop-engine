# Dedupe co-firing in the v2 full draft, measured

**Status:** MEASUREMENT. Not a proposal, not a decision, not a fix. Nothing in this document
changes engine behaviour, and nothing in it is a regulatory determination.

**Measured on:** commit `7a81bae`, branch `measure/draft-dedupe-cofiring`.
**Artifacts measured:** `rules/proposals/nyc-rules.v2-full-draft.json` (PROPOSED, 59 rules plus 4
advisories) and `rules/nyc-rules.v2.11.json` (published, 46 rules) as the control.

## 1. The question

The draft declares 25 dedupe groups. Nine hold more than one member. When two members of a group
both produce a finding for the same event, `findings.ts` merges them into one plan item and has to
pick which route supplies each scalar field. If every group's members are mutually exclusive
branches, that merge never faces a choice.

The question, per group: over an intake sweep, how many members co-fire on a single event? The
distribution, not the maximum.

## 2. What "produces a finding" means here

`resolveFindings` (`packages/engine/src/findings.ts:271-280`) skips a rule only when its trigger
evaluates `false`. A trigger that evaluates `unknown` produces a finding and enters the dedupe
merge exactly like a `true` one. So every count below is reported twice:

- **findings**, meaning trigger result `true` or `unknown`, which is what actually reaches the
  merge, and
- **true only**, meaning the members that fired on settled facts.

The distinction matters a lot. Several groups whose members are mutually exclusive on answered
facts merge four or fourteen members deep the moment the classifying question is unanswered.

## 3. Method, including every limitation

### 3.1 The draft does not load through `parseEngineRuleset`

It does not, and the reason is not one thing. Running the parser against successively adapted
scratch copies (never against the file in `rules/`) produces this sequence of real error messages:

| adaptation applied so far                                                                                                                                                                                                                                           | next error from `parseEngineRuleset`                                                                    |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| none                                                                                                                                                                                                                                                                | `ruleset.rules[4].output.deadline.type has unsupported value "conditional"`                             |
| drop the 6 deadlines whose type the engine has no case for (`conditional` x3, `official_conflict`, `fixed_annual_date`, `dependency`) and the 4 `published_minimum` deadlines written with `business_days` or `hard_floor_calendar_days` instead of `calendar_days` | `ruleset.rules[4].verification.status has unsupported value "VERIFIED_WITH_QUALIFICATION"`              |
| map `VERIFIED_WITH_QUALIFICATION` (33 rules) and `CONDITIONAL` (8 rules) onto statuses the engine knows                                                                                                                                                             | `ruleset.rules[8].trigger.all[1].any[3].op has unsupported value "is_null"`                             |
| map the 3 kinds the engine does not declare (`conditional_requirement` x4, `approval`, `certificate`) and publish `config.business_day_math.calendar`                                                                                                               | same `is_null` error                                                                                    |
| DIAGNOSTIC ONLY, semantics-changing: rewrite the 7 `is_null` leaves and the 1 `lte` leaf                                                                                                                                                                            | `rule SAPO-BLOCK-PARTY-INELIGIBLE-001 references undeclared field "event_days"`                         |
| DIAGNOSTIC ONLY: declare the 3 derived values as intake fields                                                                                                                                                                                                      | `dedupe key "block_party_eligibility" mixes verification statuses`                                      |
| DIAGNOSTIC ONLY: collapse every verification status                                                                                                                                                                                                                 | `intake field "event_address" is declared but no rule trigger, deadline, or scoping condition reads it` |

The decisive one is the third row. Everything above it is outside trigger evaluation: deadline
types, verification statuses, rule kinds, and the holiday-calendar key are all read after
`parseTrigger` has run, so adapting them could not change which rules fire. `is_null` and `lte` are
trigger operators, and the draft's three `derived_values` are trigger operands. There is no way to
express them in the engine's current condition vocabulary without asserting semantics the engine
does not have. `is_null` has no engine equivalent at all: the closest rewrite, `eq "unknown"`, means
a different thing (the engine's explicit-unknown answer, not an absent one), and `lte` cannot be
written as a negated `gt` because the trigger grammar has no negation.

So this measurement took route (b) from the brief: **the triggers were evaluated directly, not
through the full pipeline.** The draft file was never modified.

### 3.2 The harness

`evalTrigger` (scratch, outside the repo tree) is a tri-state walker that:

- delegates **every** node the engine supports to the engine's own
  `evaluateTrigger`/`createScopeResolver` (`packages/engine/src/conditions.ts`), so operator
  semantics, the explicit-`unknown` answer, out-of-scope handling, and the multi-select `in` rule
  are the engine's, not a reimplementation;
- reproduces the engine's `all`/`any` tri-state combinator (decisive child wins, otherwise any
  `unknown` child makes the node `unknown`), which is the only engine logic restated;
- implements the three pieces the engine does not have, each from the draft's own published
  declaration:
  - `lte`: numeric `<=`, `unknown` when the answer is absent or explicitly unknown;
  - `is_null`: true when the field is in scope and its answer is absent. An explicit `"unknown"`
    answer is **not** treated as null. All seven `is_null` uses are on nullable numeric fields that
    declare no `unknown` member, so the two states are distinguishable there;
  - `derived_values`, per the formulas the draft publishes: `structure_area_sqft =
structure_length_ft * structure_width_ft`, `unknown` if either dimension is missing;
    `event_days = inclusive_days(event_date, event_end_date ?? event_date)`, 1 when the end date is
    null; `effective_fuel_types = union(fuel_types, generator_fuel_type when not in
['none','unknown'])`.

**Agreement check.** Over the 3,200-intake control sweep, `evalTrigger` was compared against the
engine's `evaluateTrigger` for all 46 rules of the published ruleset: 147,200 comparisons, **0
mismatches**. That tests the combinator and the delegation, not the three additions above, which
have no engine counterpart to compare against.

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
unknown. For every other group, no field involved carries an `asked_when`, so scoping is a no-op and
the sweep used a resolver that throws if a scoped field is ever consulted, which proves the shortcut
sound rather than assuming it.

### 3.3 How the sweep was built

Built from the **draft's own** 63 declared `intake_fields`, not the published ruleset's 33.

The full 63-field factorial is not enumerable: the 43 enum, boolean and multi_enum fields alone
multiply out to 1.9 x 10^28 combinations, before any of the 17 numeric, 2 date or 1 string fields. It was not sampled either. Instead each group was swept **exhaustively over the
fields its own members read**, expanded through derived-value inputs. This is exact rather than a
sample, because no draft rule reads a field outside its own trigger, no field read by any of these
groups carries an `asked_when` clause naming a field outside the swept set (the one exception,
`sound_audible_in_public_space`, has its gating fields `amplified_sound` and `location_type` inside
the `nypd_sound` set), and the merge for a group depends only on that group's members. Fields
outside a group's set are held unanswered and cannot change that group's result.

Value domains:

- **enum / boolean / multi_enum:** every value the draft declares, plus `null` when the draft marks
  the field nullable. Note that several enums declare `"unknown"` as a member, and the engine treats
  the literal string `"unknown"` as the explicit-unknown answer
  (`conditions.ts:242`), so that value is a genuine tri-state input rather than a plain option.
- **numeric:** for each threshold any member compares the field against, `t-1`, `t`, `t+1`, plus 0,
  plus `null` when nullable. `structure_length_ft` and `structure_width_ft` use `{null, 10, 12, 20,
21}`, whose products straddle both published area thresholds (120 and 400) on all three sides.
- **dates:** `event_date` is fixed at `2026-09-01`; `event_end_date` ranges over `{null,
2026-09-01, 2026-09-02}`, giving `event_days` of 1, 1 and 2, which covers the only threshold
  (`event_days gt 1`) below, on and above.
- **multi_enum in the control:** the full power set of the 5 declared `structure_types` values.

Sweep sizes: from 36 to 19,464,192 intakes per group, 19,484,918 draft intakes in total, plus 3,200
control intakes. Every one was evaluated; nothing was truncated.

### 3.4 Limitations, stated plainly

1. **This measures triggers, not rendered plan items.** The draft cannot run through
   `resolveFindings`, so the merged line's actual text was not produced. What is measured is which
   members reach the merge and what each one publishes.
2. **Three trigger semantics are the draft's declarations as I read them, not engine behaviour.**
   `is_null`, `lte`, and the derived formulas do not exist in `packages/engine`. If the eventual
   implementation reads `is_null` as also matching an explicit `"unknown"` answer, the
   `block_party_eligibility` numbers shift. Nothing else depends on those three.
3. **Numeric domains are threshold-local.** They prove behaviour below, on and above every published
   threshold, and cannot surface a discontinuity that exists nowhere near a threshold. The triggers
   contain no such construct.
4. **The date axis is minimal.** `event_days` is the only date-derived trigger operand in any
   multi-member group, and it has a single threshold.
5. **`fuel_types` and `open_flame_types` are not swept.** No multi-member group reads them; they
   feed `FDNY-FUEL-001` and `PARKS-PROPANE-PROHIBITION-001`, both single-member groups.
6. **Frequencies are per uniform sweep, not per real-world intake.** A percentage here is the share
   of enumerated combinations, and says nothing about how often organizers submit that shape.
7. **The draft's `status`, `severity`, and `paths` fields are not engine inputs today.** They are
   reported below as published data because the brief asks whether co-firing members disagree, and
   they are where several disagreements live.

## 4. Results

### 4.1 Findings per event (trigger `true` or `unknown`), draft

| group                     | members | sweep      | 0          | 1       | 2         | 3   | 4   | 5   | 6+  | max    | share >= 2 |
| ------------------------- | ------- | ---------- | ---------- | ------- | --------- | --- | --- | --- | --- | ------ | ---------- |
| `sapo_permit`             | 14      | 6,480      | 1,034      | 4,332   | 100       | 144 | 100 | 34  | 736 | **14** | 17.2%      |
| `dob_temporary_structure` | 5       | 8,750      | 3,752      | 2,721   | 1,791     | 234 | 180 | 72  | 0   | **5**  | 26.0%      |
| `sla_alcohol`             | 5       | 60         | 37         | 11      | 2         | 4   | 2   | 4   | 0   | **5**  | 20.0%      |
| `sapo_insurance`          | 4       | 36         | 4          | 26      | 2         | 2   | 2   | 0   | 0   | **4**  | 16.7%      |
| `nypd_sound`              | 4       | 360        | 216        | 63      | 72        | 9   | 0   | 0   | 0   | **3**  | 22.5%      |
| `parks_special_event`     | 3       | 160        | 132        | 28      | 0         | 0   | 0   | 0   | 0   | **1**  | 0.0%       |
| `fdny_generator`          | 3       | 4,800      | 2,686      | 1,706   | 344       | 64  | 0   | 0   | 0   | **3**  | 8.5%       |
| `dob_assembly`            | 3       | 80         | 59         | 15      | 3         | 3   | 0   | 0   | 0   | **3**  | 7.5%       |
| `block_party_eligibility` | 2       | 19,464,192 | 15,138,832 | 552,944 | 3,772,416 | 0   | 0   | 0   | 0   | **2**  | 19.4%      |

The `sapo_permit` 6+ column expands to 6: 212, 7: 200, 8: 94, 9: 80, 10: 80, 11: 10, 12: 50, 14: 10.

### 4.2 The same sweeps counting only `true` triggers

| group                     | 0          | 1       | 2         | max   | share >= 2 |
| ------------------------- | ---------- | ------- | --------- | ----- | ---------- |
| `sapo_permit`             | 2,268      | 4,212   | 0         | **1** | 0.0%       |
| `dob_temporary_structure` | 6,084      | 2,222   | 444       | **2** | 5.1%       |
| `sla_alcohol`             | 43         | 17      | 0         | **1** | 0.0%       |
| `sapo_insurance`          | 9          | 27      | 0         | **1** | 0.0%       |
| `nypd_sound`              | 234        | 108     | 18        | **2** | 5.0%       |
| `parks_special_event`     | 146        | 14      | 0         | **1** | 0.0%       |
| `fdny_generator`          | 3,913      | 852     | 35        | **2** | 0.7%       |
| `dob_assembly`            | 68         | 12      | 0         | **1** | 0.0%       |
| `block_party_eligibility` | 17,301,600 | 622,860 | 1,539,732 | **2** | 7.9%       |

Five of the nine groups are genuinely mutually exclusive on answered facts, and reach 2 or more only
through unknowns. Four reach 2 with every material fact settled.

### 4.3 Control: the published `nyc-rules.v2.11.json`

Its one multi-member group is `dob-structure`, holding `DOB-TENT-001` and
`DOB-TALL-STRUCTURE-001`. Sweep: the power set of `structure_types` (32) x `tent_area_sqft` (5) x
`tent_days_in_place` (5) x `structure_over_10ft_tall` (4) = 3,200 intakes, run through the real
`parseEngineRuleset` and the engine's own `evaluateTrigger`.

|                                | 0     | 1     | 2   | share >= 2 |
| ------------------------------ | ----- | ----- | --- | ---------- |
| findings (`true` or `unknown`) | 1,310 | 1,386 | 504 | **15.8%**  |
| `true` only                    | 2,122 | 974   | 104 | **3.3%**   |

The four co-firing shapes, with the first intake in enumeration order that produces each:

| members and results                                   | count | intake                                                                                                                |
| ----------------------------------------------------- | ----- | --------------------------------------------------------------------------------------------------------------------- |
| `DOB-TENT-001` true, `DOB-TALL-STRUCTURE-001` unknown | 208   | `structure_types=[tent_canopy]`, `tent_days_in_place=30`, `tent_area_sqft=null`, `structure_over_10ft_tall=unknown`   |
| both unknown                                          | 128   | `structure_types=[tent_canopy]`, `tent_area_sqft=null`, `tent_days_in_place=null`, `structure_over_10ft_tall=unknown` |
| both true                                             | 104   | `structure_types=[tent_canopy]`, `tent_days_in_place=30`, `tent_area_sqft=null`, `structure_over_10ft_tall=yes`       |
| `DOB-TENT-001` unknown, `DOB-TALL-STRUCTURE-001` true | 64    | `structure_types=[tent_canopy]`, `tent_area_sqft=null`, `tent_days_in_place=null`, `structure_over_10ft_tall=yes`     |

**The baseline is not "the merge never has a choice".** It has one on 15.8% of this sweep, and on
3.3% with everything answered. The two published members do disagree: `DOB-TENT-001` publishes a
`business_days_minimum` of 15 with a fee display and no explicit disposition (so `permit` defaults to
`required`); `DOB-TALL-STRUCTURE-001` publishes `MAY_BE_REQUIRED`, a different permit name, no
deadline and no fee. `dedupe` keeps the first-listed rule's scalars, so today the merged line reads
as the tent permit's name, disposition, deadline and fee, with the tall-structure rule contributing
its rule id, notes and sources. That is what makes today's behaviour safe: two members, one shape,
and the surviving scalars are the stricter of the two.

## 5. The co-firing sets, group by group

Every set below was produced by an evaluation; each "one concrete intake" is the first intake in the
sweep's enumeration order that produced that exact set. Fields not listed were held unanswered.

### 5.1 `sapo_permit`, 14 members, max 14, never 2 on answered facts

Members are keyed on `sapo_event_type` and, for the six plaza rules, on `plaza_level` and
`plaza_block_count`. Every pair is disjoint on settled answers, and the `true`-only maximum of 1
confirms it across all 6,480 intakes.

All 1,114 co-firing events come from `sapo_event_type = "unknown"` (the engine's explicit-unknown
answer), and the plaza subsets additionally from an unknown or unanswered `plaza_level` or
`plaza_block_count`. The widest, 14 of 14, occurs 10 times:

> `sapo_event_type=unknown`, `street_event_size=unknown`, `plaza_level=unknown`,
> `plaza_size=small`, `plaza_block_count=null`

**Do they disagree? Yes, more than any other group.** Across the 14 members the published deadlines
are 14, 30, 45, 10, 60, 30, 45, 14 and 60 calendar days, plus one `conditional` (up to 60 days), one
`official_conflict` (90 days versus December 31 of the preceding year, unresolved) and one
`fixed_annual_date` (December 31, prior year). The permit names are six different instruments
(Street Event, Extra Large Street/Plaza, Production Event, Block Party, Single Block Festival,
Street Festival, Plaza Event). The fee displays range from "$25 processing fee, no additional SAPO
event fee" to "Up to $66,000 per location per day". Agency (`SAPO (CECM)`) and portal (E-Apply,
`https://nyceventpermits.nyc.gov/`) are the only fields all 14 share.

Also worth recording because the engine would refuse it before any of this matters: the group mixes
`VERIFIED`, `VERIFIED_WITH_QUALIFICATION` and `OFFICIAL_CONFLICT`, and
`rejectMixedDedupeVerificationStatuses` (`ruleset.ts:665`) fails a load on exactly that.

### 5.2 `dob_temporary_structure`, 5 members, max 5, reaches 2 on answered facts

18 distinct co-firing sets. The two that occur with every member `true`:

| members                                        | count | intake                                                                                                                           |
| ---------------------------------------------- | ----- | -------------------------------------------------------------------------------------------------------------------------------- |
| `DOB-STAGE-001` + `DOB-STRUCTURE-DURATION-001` | 360   | `structure_type=stage`, `structure_length_ft=10`, `structure_width_ft=12`, `structure_height_ft=3`, `structure_duration_days=30` |
| `DOB-TENT-AREA-001` + `DOB-TENT-DURATION-001`  | 84    | `structure_type=tent`, `structure_length_ft=20`, `structure_width_ft=21`, `structure_duration_days=30`                           |

Both are the obvious real case: a stage that is both large enough and long-lived enough, a tent that
is both over 400 sq ft and up for 30 days. The all-5 set (72 events) needs `structure_type=null`,
which makes every member `unknown`.

**Do they disagree? No.** All five members' `output` objects are byte-identical apart from nothing
at all: same `permit_name` ("DOB Alteration Type 2 or 3 Temporary Structure Permit"), same agency,
same `research_required` deadline with the same display text, no fee, no portal, same
`VERIFIED_WITH_QUALIFICATION`. This group merges frequently and has nothing to resolve.

### 5.3 `sla_alcohol`, 5 members, max 5, never 2 on answered facts

8 sets, all driven by `alcohol_service_path` being `"unknown"` or unanswered. The widest, 5 of 5,
occurs twice, once via the explicit unknown and once via the null:

> `alcohol=true`, `alcohol_service_path=unknown`, `venue_license_covers_event_area=unknown`
> giving `SLA-ALCOHOL-PATH-UNKNOWN-001` true and the other four unknown.

**Do they disagree? Yes.** `SLA-ONE-DAY-EVENT-001` and `SLA-CATERING-001` publish different permit
names and different fees ($36 versus $48 per point of sale per day) against the same 15-business-day
window and the same portal. `SLA-EXISTING-LICENSE-001` is a note saying no separate permit is
identified, and the two advisories publish no deadline, fee or portal at all. A merged line has to
choose between "One-Day Alcohol Event Permit, $36" and "Catering Permit, $48" while a third member
says neither may apply.

### 5.4 `sapo_insurance`, 4 members, max 4, never 2 on answered facts

5 sets, all requiring `sapo_event_type` unknown or `block_party_has_ride` unknown or unanswered. The
4-way set occurs twice:

> `sapo_event_type=unknown`, `block_party_has_ride=unknown`, all four members unknown.

**Do they disagree? Yes, and substantively.** `SAPO-INSURANCE-GENERAL-001` publishes a $1,000,000
certificate requirement with a `dependency` deadline ("Must be provided before SAPO permit
issuance"). `SAPO-INSURANCE-BLOCK-EXEMPT-001` is a note whose entire content is that the general $1
million requirement **does not apply**. Those two co-fire on 1 intake in the sweep
(`sapo_event_type=unknown`, `block_party_has_ride=no`) and in the 4-way set. One line cannot be both.

### 5.5 `nypd_sound`, 4 members, max 3, reaches 2 on answered facts

7 sets. The pairs that co-fire with both members `true`:

| members                                                                               | count | intake                                                                                                                              |
| ------------------------------------------------------------------------------------- | ----- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `NYPD-SOUND-PUBLIC-001` + `NYPD-SOUND-COMMERCIAL-ADVERTISING-PROHIBITED-001`          | 15    | `amplified_sound=true`, `location_type=street`, `sound_purpose=commercial_advertising`, `sound_audible_in_public_space=yes`         |
| `NYPD-SOUND-PRIVATE-AUDIBLE-001` + `NYPD-SOUND-COMMERCIAL-ADVERTISING-PROHIBITED-001` | 3     | `amplified_sound=true`, `location_type=private_indoor`, `sound_purpose=commercial_advertising`, `sound_audible_in_public_space=yes` |

`NYPD-SOUND-PUBLIC-001` and `NYPD-SOUND-PRIVATE-AUDIBLE-001` **never** co-fire, in any of the 360
intakes, including when `location_type=unknown`: the private rule's third condition reads
`sound_audible_in_public_space`, which the draft only asks when `location_type` is one of the three
private values, so an unknown location puts it out of scope and the engine reads an out-of-scope
condition as `false` (`conditions.ts:314`). Their outputs are byte-identical anyway.

**Do they disagree? Yes.** See section 6, this is the shape the brief asked about.

### 5.6 `parks_special_event`, 3 members, max 1

**Never co-fires.** Zero events in 160 produced two findings. `PARKS-SPECIAL-EVENT-001` needs
`headcount gt 20`, `PARKS-SPECIAL-ELEMENT-001` needs `headcount lte 20` plus sound or structures, and
`PARKS-EXACT-20-CONFLICT-001` needs exactly 20 with neither sound nor structures. The three
partition the space cleanly, including at the boundary, and no unknown reopens it: `headcount` is
non-nullable in the draft, so it has no unanswered state to sweep.

This is the only group of the nine with no merge behaviour at all.

### 5.7 `fdny_generator`, 3 members, max 3, reaches 2 on answered facts

11 sets. Both `true`-only pairs are the battery rule alongside a fuel rule:

| members                                            | count | intake                                                                                                                                             |
| -------------------------------------------------- | ----- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `FDNY-GENERATOR-GASOLINE-001` + `FDNY-BATTERY-001` | 28    | `generator_present=true`, `generator_fuel_type=gasoline`, `generator_aggregate_tank_gallons=2.6`, `location_type=street`, `outdoor_battery_kwh=21` |
| `FDNY-GENERATOR-DIESEL-001` + `FDNY-BATTERY-001`   | 7     | as above with `diesel` and `11` gallons                                                                                                            |

The gasoline and diesel rules are mutually exclusive on `generator_fuel_type` and co-fire only when
it is unknown (136 events).

**Do they disagree? No.** All three members' `output` objects are byte-identical: same
"FDNY Generator/Battery Permit" name, same agency, same `research_required` deadline and display,
same fee display, no portal, same verification status.

### 5.8 `dob_assembly`, 3 members, max 3, never 2 on answered facts

2 sets, both requiring `location_type=unknown`:

| members                            | count | intake                                                     |
| ---------------------------------- | ----- | ---------------------------------------------------------- |
| all three, all unknown             | 3     | `location_type=unknown`, `peak_concurrent_attendance=null` |
| `INDOOR` + `ROOFTOP`, both unknown | 3     | `location_type=unknown`, `peak_concurrent_attendance=75`   |

The second set is the interesting one: at 75 attendees the indoor and rooftop rules would fire and
the outdoor rule (threshold 200) would not, but with the location unknown all that is decided is
that the outdoor rule is definitely not it.

**Do they disagree? No.** All three members' `output` objects are byte-identical, including the
three-branch `paths` array. They differ only in trigger.

### 5.9 `block_party_eligibility`, 2 members, max 2, reaches 2 on answered facts

Full factorial over all 14 fields the two members read: 19,464,192 intakes, 33 seconds. Four sets:

| members and results                                                                            | count     | share  |
| ---------------------------------------------------------------------------------------------- | --------- | ------ |
| `SAPO-BLOCK-PARTY-INELIGIBLE-001` unknown + `SAPO-BLOCK-PARTY-ELIGIBILITY-UNKNOWN-001` unknown | 1,886,280 | 9.7%   |
| both **true**                                                                                  | 1,539,732 | 7.9%   |
| `INELIGIBLE` true + `ELIGIBILITY-UNKNOWN` unknown                                              | 345,528   | 1.8%   |
| `INELIGIBLE` unknown + `ELIGIBILITY-UNKNOWN` true                                              | 876       | 0.004% |

The both-true case, first intake in enumeration order:

> `sapo_event_type=block_party`, `has_sales=true`, `has_fundraising=true`, `alcohol=true`,
> `has_vendors=true`, `branding_or_promotion=yes`, `commercial_sponsorship=true`,
> `rain_date_requested=true`, `open_to_all_block_neighbors=yes`, `neighbor_permission_received=yes`,
> `block_count=null`, `event_duration_hours=null`, `event_end_date=null`,
> `organizer_type=individual`

`organizer_type=individual` is in the ineligible list, so the disqualifier fires `true`; `block_count`
and `event_duration_hours` are unanswered, so the `is_null` branch of the unknown rule fires `true`
as well. Both are correct about their own question, and they arrive together on nearly 8% of the
sweep.

**Do they disagree? Yes.** `SAPO-BLOCK-PARTY-INELIGIBLE-001` publishes
`status: CLASSIFICATION_INELIGIBLE`, `severity: blocking`, and the message "The event does not
qualify as a Block Party under the supplied facts. Reclassify it before calculating the permit plan",
with `suggested_classes`. `SAPO-BLOCK-PARTY-ELIGIBILITY-UNKNOWN-001` publishes `status: CONDITIONAL`
and an advisory to confirm the same facts before treating the event as an eligible block party.
Neither publishes a deadline, fee, portal or permit name, so the conflict is confined to disposition:
"you are disqualified" merged with "we cannot yet tell whether you are eligible". The group also
mixes `VERIFIED` and `CONDITIONAL` verification statuses, which `ruleset.ts:665` refuses on load.

## 6. The blocker-plus-window shape

The brief singles out one shape: a co-firing set where one member is a blocker (kind `eligibility`,
or a prohibited disposition) and another is a permit with a filing window, because the merged line
then reads as prohibited while quoting the permit's deadline.

**Verified: `nypd_sound` is the only group of the nine with that shape, and it does co-fire on
answered facts.**

`NYPD-SOUND-COMMERCIAL-ADVERTISING-PROHIBITED-001` is `kind: eligibility`, `severity: blocking`,
`status: PROHIBITED_USE`, publishing NYC Administrative Code section 10-108 and no permit name, no
deadline, no fee and no portal. It co-fires `true`-with-`true` against:

- `NYPD-SOUND-PUBLIC-001` on 15 of 360 intakes. That rule publishes the Sound Device Permit, a
  `published_minimum` of 5 calendar days ("File at the precinct no fewer than five days before
  use"), a fee of "$45 per sound device for the first day, plus $5 per device for each additional
  day", and the NYPD precinct portal.
- `NYPD-SOUND-PRIVATE-AUDIBLE-001` on 3 of 360 intakes, with an identical output object.

It also co-fires `unknown`-side on a further 54 intakes (30 + 9 + 6 + 9), where the prohibition is
unknown because `sound_purpose` is unanswered while the permit fires `true`.

The permit rules are listed first in `rules[]` (indices 29 and 30, against 32 for the prohibition),
and `dedupe` (`findings.ts:153-166`) keeps the first finding's scalars, so under the current merge
the surviving name, deadline, fee and portal would all be the permit's.

Two qualifications, both important and neither speculative:

1. **The draft's blocker vocabulary is not engine-readable today.** `severity` and
   `status: PROHIBITED_USE` are fields no engine code reads, and the rule publishes no
   `output.disposition`. Under the current parser a `kind: eligibility` rule with no published
   disposition takes `DEFAULT_DISPOSITION_BY_RULE_KIND` (`proposals.ts:53`), which is
   `may_be_required`, not `prohibited_or_ineligible`. So on the code as it stands the merged line
   would not read "prohibited" at all; the prohibition's entire content would be dropped, because
   the rule contributes no `name`, no `note_text` and no scalar that survives the merge. It would
   contribute its rule id and its section 10-108 source, and nothing a reader sees as a
   prohibition.
2. **That is a statement about the current mapping, not about the draft's intent.** The draft
   plainly intends a blocker. Which of the two failure shapes actually occurs, a prohibition quoting
   a filing deadline or a prohibition silently disappearing, depends on schema work that has not
   happened. Both start from the same measured fact: on 18 of 360 intakes, both rules fire `true`
   and both reach the same merged line.

The other groups holding a blocker do not have the shape. `block_party_eligibility` pairs its
`eligibility` member with an advisory that publishes no window. `sapo_alcohol` and `parks_propane`,
the draft's other two `severity: blocking` rules, are single-member dedupe groups and never merge
with anything.

## 7. Which groups present a merge conflict

Stated plainly, from the numbers above.

**Merges with a real conflict to resolve, five groups:**

- `sapo_permit`. Up to 14 members on one line, disagreeing on permit name, deadline type, window
  length, and fee. Only under an unknown classification, which is also the single most likely thing
  for an organizer not to know.
- `sla_alcohol`. Up to 5 members, disagreeing on permit name and fee against a common window, with a
  note member asserting no permit is needed.
- `sapo_insurance`. Up to 4 members, one requiring a $1 million certificate and another stating the
  requirement does not apply.
- `nypd_sound`. Up to 3 members, pairing a section 10-108 prohibition with a dated, priced permit.
- `block_party_eligibility`. Two members, disagreeing on disposition, and unlike the four above this
  one reaches its conflict on fully answered facts, on 7.9% of its 19.5-million-intake factorial.

That is five. Four of them conflict only through unknowns; `block_party_eligibility` and
`nypd_sound` conflict on settled facts.

**Merges with nothing to resolve, three groups:**

- `dob_temporary_structure` (5 members, merges on 26.0% of its sweep, outputs byte-identical)
- `fdny_generator` (3 members, 8.5%, outputs byte-identical)
- `dob_assembly` (3 members, 7.5%, outputs byte-identical)

**Never merges, one group:**

- `parks_special_event`. Zero co-firing events in 160. A genuine partition, boundary included.

**Control, for comparison:** the published ruleset's one group merges on 15.8% of its sweep and on
3.3% with everything answered, and its two members do differ in name, disposition, deadline and fee.
The published baseline is a smaller version of the same behaviour, not an absence of it.

## 8. Reproducing this

The harness is scratch code outside the repository and is not committed; nothing under `rules/`,
`packages/engine/src/` or `apps/` was modified. To rebuild it: load the two JSON artifacts, build
`IntakeFieldDefinition`s from the draft's `intake_fields` with the two `asked_when` translations from
3.2, walk each rule's trigger delegating supported nodes to
`packages/engine/src/conditions.ts#evaluateTrigger` with a `createScopeResolver` built per intake,
implement `is_null`, `lte` and the three `derived_values` per 3.2, and enumerate each group's field
factorial per 3.3.

`docs/research/` did not exist before this document and is **not** gitignored: `git check-ignore -v
docs/research` exits 1 with no match, and the `.gitignore` entries covering documentation
(`.impeccable/`, `apps/web/DESIGN.md`, `apps/web/PRODUCT.md`) do not reach it. This file is
therefore tracked normally.
