# PopEngine — Scenario Fixtures v7 (derived from ruleset nyc.v2.11)

**Status:** APPROVED — fixtures v3 team-ratified 2026-07-22 with ruleset v2.1 (OPEN-QUESTIONS B-2, all four devs); they remain the green-gate suite against nyc.v2.11; the v2.2, v2.3, v2.4 and v2.5 changes were product-owner authorized 2026-07-25 and moved no expected output, as did v2.7 on 2026-07-26, which published the alert offsets F-203 requires as config and no rule. v2.5 changed evaluated output without changing this document: it removed an FDNY-GENERATOR-001 finding that five scenarios were reporting and none of their expected-findings blocks ever listed. v4 (product-owner authorized 2026-07-25) writes down 11 scenario-field answers, across 5 distinct fields, that the fixtures have been evaluating on since v3 while this document never stated them — `battery_present` in A, B, D and F (4 answers); `structure_types` in D and F (2); `generator_present` in D and F (2); `open_flame_or_cooking` in E and F (2); `food_vendor_count` in F (1) — and moves no expected finding, no verdict and no deadline. See `docs/BASELINE.md`. **v5 (product-owner authorized 2026-07-25) MOVES APPROVED EXPECTED OUTPUT** — the first revision of this document that does. Every earlier one either restated what the fixtures already evaluated or followed a ruleset change that removed a finding this key never listed. v5 closes the three surviving artifact contradictions in #89, and two of the three change what an organizer is shown: the `street_event_size=unknown` ladder gains its fourth branch (#89 item 1 — the 60-day `extra_large` window, the only branch that is not FEASIBLE), and Scenario F gains `ADV-VENUE-OCCUPANCY-001` (#89 item 5 — the advisory fires on F's inputs and names F in its own metadata). The third (#89 item 6) moved the RULESET, not this document: Scenario E's item 8 has folded two rule ids into one finding since v3, and nyc.v2.6 wired the `dob-structure` dedupe key that only one of the two rules declared, so the plan now renders the eight findings this block has always specified. See `docs/BASELINE.md`. Now the green-gate acceptance suite. **Retargeted to nyc.v2.8 on 2026-07-26 with a TEXT correction and no output move**: Scenario F item 1 restates DOB-ASSEMBLY-001's TPA lead as ten BUSINESS days on an inclusive bound, which is what v2.8 publishes against two primary sources, replacing the "earlier than 10 days" calendar reading and the wording-variance flag this document had carried since v3. No expected finding, verdict, deadline, status or count in this document moves — the key never stated a `latest_apply_date` for that finding, and it does not state one now. **v6 (product-owner and architecture-owner authorized 2026-07-28 under issue #89) corrects Scenario F's material branch contract and rationale:** license coverage and sound audibility are the only verdict branches, so the documented follow-up count moves from three to two. `venue_has_assembly_approval` remains an input and collected confirmation context, but it records only that an approval exists and cannot establish whether the current PACO and PA permit cover the exact event space, use, occupancy, and layout. Whether exact coverage removes the temporary filing is not published either way; confirm with DOB. Inconsistent conditions require amendment or separate authorization. Objective coverage-specific modeling is rehomed to SPEC-CONFLICT #188. The CONDITIONAL verdict, findings, deadlines, ruleset and engine output do not change, and this approval authorizes no trigger or new regulatory claim. Individual regulatory facts still promote SOURCE_CONFIRMED → VERIFIED during the build via the ruleset's `verification` blocks (OPEN-QUESTIONS §2); that promotion is the product owner's, per CONTRIBUTING Golden Rule 2, and a promotion the product owner authored still needs the second signatory `docs/DOCUMENTATION-GOVERNANCE.md` §6's closing paragraph requires.
**Supersedes:** fixtures v5 (same six scenarios, recoverable at git `ae6a623`), fixtures v4 (same six scenarios, recoverable at git `81320c7`), fixtures v3 (recoverable at git `52ce21e`), the v1 answer key (six scenarios, R1–R13; recoverable at git `28e937d`) and the unapproved v2 draft suite (preserved at `docs/proposals/regulatory-scenarios-v2-draft.md`).
**Authority hierarchy:** approved primary source → published rule (`nyc-rules.v2.11.json`) → this fixture suite → engine output → UI copy. **This document is derived from the ruleset, not an independent authority.** If a fixture and the published ruleset disagree, the fixture is wrong; if the ruleset and a primary source disagree, the ruleset is wrong. Fix the lower authority.

**v7 (2026-07-29, shared issue #178 publication):** product-owner, verification-owner, rules-reviewer, and engine-owner approval adds the nine issue #107 field-scoped named confirmations published by nyc.v2.9. The same atomic publication applies F-110's approved assembly-document registry replacement and removes issue #194's organizer-claimed food exception from active intake; neither registry delta changes a rule, finding, verdict, deadline, or boundary outcome. Scenario B is recorded as low identified burden rather than near-empty because its definite `DOHMH-VENDOR-PERMIT-001` finding remains `required` even though its deadline is `not_calculable`.

**nyc.v2.10 retarget (2026-07-29, issue #181):** SAPO-BLOCK-PARTY-ELIG-001's citation now names only the CECM block-parties page already carried as its sole source URL. This drops a redundant, unlinked FAQ attribution without deciding whether the FAQ carried the prohibition historically. It is citation metadata only: no fixture input, expected finding, verification status, deadline, count, or verdict changes, so the fixture document remains v7.

**nyc.v2.11 retarget (2026-07-29):** Organizer summaries were added to every published rule and advisory. No fixture input, trigger, expected finding, verification status, deadline, count, or verdict changes, so the fixture document remains v7.
**Evidence:** every regulatory fact traces via the ruleset's `evidence` refs to fetch-confirmed quotes in `VERIFICATION-SOURCES.md` (Rounds 1–2, 2026-07-22).
**Fixture clock:** `today = 2026-07-22` (Wednesday). All dates computed from it. Business-day math is actual-calendar (no holidays fall in any fixture window; the pinned holiday calendar is a RESEARCH item for other dates).

## Verdict model (approved 2026-07-22)

Top-level verdict stays four-state; per-finding deadline statuses (ON_TRACK / DEADLINE_APPROACHING / PUBLISHED_DEADLINE_MISSED / NOT_CALCULABLE / NOT_APPLICABLE) sit underneath:

| Verdict          | Computed when                                                                       | Demo copy                                                                                              |
| ---------------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| FEASIBLE         | all dated findings ON_TRACK, no material unknowns                                   | "On track"                                                                                             |
| FEASIBLE-AT-RISK | min slack < 14 days (labeled _internal planning buffer_, not an official threshold) | "At risk — apply within N days"                                                                        |
| CONDITIONAL      | a material unknown changes the outcome; branches shown                              | "Depends on: [fact]"                                                                                   |
| INFEASIBLE       | a definitively-required finding is PUBLISHED_DEADLINE_MISSED                        | "Published deadline missed as scoped" — a missed filing window, **not** a claim of legal impossibility |

## Scenario A — "Bushwick Street Activation" (THE DEMO ANCHOR, re-anchored)

_Replaces the v1 anchor, whose universal 60-day SAPO lead was contradicted by primary sources (VS RF-2). Same story: commercial street activation, 35 days out; now classified._

**Inputs:** brooklyn · location_type=street · obstructs_public_way=yes · sapo_event_type=street_event · **street_event_size=large** (multi-block activation) · headcount=75 · event_date=**2026-08-26** (35 days out) · open_to_public=yes · food_present=yes, food_vendor_count=1 · selling_anything=yes · amplified_sound=yes · no structures · no flame · no generator · battery none · no alcohol

**Expected findings:**

1. SAPO-STREET-LARGE-001 — Street Event Permit (Large), 45-day deadline = **2026-07-12, already passed** → PUBLISHED_DEADLINE_MISSED
2. NYPD-SOUND-001 — Sound Device Permit, $45 first day + $5/addl day, precinct, ≥5 days → ON_TRACK
3. DOHMH-VENDOR-PERMIT-001 — acceptable permit per vendor (TFSE $70/yr) → NOT_CALCULABLE (lead: confirm with agency)
4. DOHMH-ORGANIZER-NOTIFY-001 — organizer notifies DOHMH ≥30 days = by **2026-07-27** → DEADLINE_APPROACHING (5 days)
5. SAPO-INSURANCE-001 — $1M liability, City additional insured, before issuance

**Named confirmations:** CONF-NO-STRUCTURE-001, CONF-NO-FLAME-001, CONF-NO-GENERATOR-001, CONF-NO-BATTERY-001, CONF-NO-ALCOHOL-001.

**EXPECTED VERDICT: ✗ INFEASIBLE (as scoped)** — blocking finding: Street Event Permit (Large); copy: "the published 45-day filing deadline passed on July 12."
**Expected rescopes (each a full re-evaluation):**

- (a) **size=medium** → 30-day deadline = 2026-07-27 → FEASIBLE-AT-RISK, "apply within 5 days" (DOHMH notification also lands 07-27)
- (b) **size=small** → 14-day deadline = 2026-08-12 (ON_TRACK) but DOHMH notification still 5 days out → FEASIBLE-AT-RISK, "notify DOHMH within 5 days"
- (c) **private venue** → SAPO + insurance findings drop; venue-occupancy advisory + DOHMH findings remain
  **Demo notes:** the size-classification question IS the demo beat ("what counts as Large? that's why nobody can navigate this"). The rescope to (a) shows the deadline ladder live. Size _criteria_ are not published on fetched pages (VS Round 2, unresolved) — the intake asks the user to classify per SAPO guidance, and `unknown` renders CONDITIONAL listing all four deadlines (v5: the `extra_large` 60-day window was missing here too).

## Scenario B — "Gallery Pop-up" (FALSE-POSITIVE / LOW-BURDEN TEST)

**Inputs:** manhattan · private_venue · headcount=60 · event_date=2026-08-12 (21 days out) · open_to_public=yes · food_present=yes (prepackaged snacks, free), food_vendor_count=1 (the gallery itself) · selling_anything=no · amplified_sound=no · no structures/flame/generator/alcohol · battery none

**Expected findings:**

1. ADV-VENUE-OCCUPANCY-001 — CoO/legal use governs capacity; 60 < 75 assembly threshold [thresholds source-confirmed]
2. DOHMH-VENDOR-PERMIT-001 — MAY apply: prepackaged free distribution to an invited public is _inside_ Health Code Art. 88 scope (no general free-prepackaged exemption; VS RF-4) → NOT_CALCULABLE, "confirm with DOHMH"
3. DOHMH-ORGANIZER-NOTIFY-001 — the 30-day notification date (2026-07-13) is already past **if** DOHMH treats the host as a food-service operator → surfaced inside the conditional, not as a definitive miss
4. Named confirmations: CONF-NO-SALES-001, CONF-NO-AMPLIFIED-SOUND-001, CONF-NO-STRUCTURE-001, CONF-NO-FLAME-001, CONF-NO-GENERATOR-001, CONF-NO-BATTERY-001, CONF-NO-ALCOHOL-001.

**EXPECTED VERDICT: ⚠ CONDITIONAL — LOW IDENTIFIED PERMIT BURDEN.** Show the food findings, venue advisory, and seven named confirmations. Do not render the global no-definite-requirement sentence: DOHMH-VENDOR-PERMIT-001 is a definite `required` finding whose `not_calculable` deadline changes only whether PopEngine can date it.
**Test purpose:** low burden stays trustworthy without treating an undated requirement as absent. (v1 expected a flat NONE; corrected per Art. 88.)

## Scenario C — "Prospect Park Community Day" (DEPENDENCY-CHAIN TEST — strongest carryover)

**Inputs:** brooklyn · park · headcount=150 · event_date=2026-09-16 (56 days out) · open_to_public=yes · no food · selling_anything=no · amplified_sound=yes · nothing else

**Expected findings:**

1. PARKS-EVENT-001 — Special Event Permit, $25; hard floor 21 days (latest 2026-08-26); processing 21–30 days → ON_TRACK
2. NYPD-SOUND-001 — Sound Device Permit → ON_TRACK, gated
3. NYPD-SOUND-PARKS-DEP-001 — Parks amplified-sound permission first; strict sequencing unconfirmed → rendered as sequenced timeline: apply Parks now → decision ~day 21–30 → pursue sound permit → buffer
4. PARKS-INSURANCE-NOTE-001 — "determined by borough office at review," never hard-required

**Named confirmations:** CONF-NO-FOOD-001, CONF-NO-SALES-001, CONF-NO-STRUCTURE-001, CONF-NO-FLAME-001, CONF-NO-GENERATOR-001, CONF-NO-BATTERY-001, CONF-NO-ALCOHOL-001.

**EXPECTED VERDICT: ✓ FEASIBLE.** Timeline renders the dependency chain; the sequencing caveat appears as a note, not a verdict change.
**Test purpose:** sequenced deadlines. (150 > 20, so the exactly-20 OFFICIAL_CONFLICT rule stays dormant; a separate unit fixture pins headcount=20.)

## Scenario D — "Queens Block Party" (TIGHT-BUT-FEASIBLE + ELIGIBILITY TEST)

**Inputs:** queens · street · obstructs_public_way=yes · sapo_event_type=block_party · has_amusement_ride=no · headcount=200 · event_date=2026-09-30 (70 days out) · open_to_public=yes · no public food service (neighbors' own grills; food_present=no) · selling_anything=no · amplified_sound=yes · no structures · open_flame_or_cooking=[charcoal_wood] · no generator · battery none · no alcohol

**Expected findings:**

1. SAPO-BLOCK-PARTY-001 — Block Party Permit, 60-day deadline = **2026-08-01** → DEADLINE_APPROACHING (10 days); community-board recommendation note
2. SAPO-BLOCK-PARTY-SPONSOR-001 — block-association membership + neighbor permission → confirm
3. NYPD-SOUND-001 — Sound Device Permit → ON_TRACK
4. FDNY-FUEL-001 — Fuel Permit for charcoal (NOT an open-flame permit; v1 corrected) → NOT_CALCULABLE, confirm lead
5. **No insurance finding** — block party without a ride is exempt (50 RCNY §1-08(b); v1's R10 line removed)

**Named confirmations:** CONF-NO-FOOD-001, CONF-NO-SALES-001, CONF-NO-STRUCTURE-001, CONF-NO-GENERATOR-001, CONF-NO-BATTERY-001, CONF-NO-ALCOHOL-001, CONF-NO-BLOCK-PARTY-RIDE-001.

**EXPECTED VERDICT: ✓ FEASIBLE-AT-RISK** — "apply within 10 days" (14-day internal buffer, labeled as PopEngine policy).
**Fixture guard:** `selling_anything=no` and `alcohol=no` are load-bearing — a block party with either becomes PROHIBITED_OR_INELIGIBLE via SAPO-BLOCK-PARTY-ELIG-001 (separate unit fixture). `food_present=no` is deliberate: neighbors grilling their own food is not public food service; do not "enrich" this fixture.

## Scenario E — "Plaza Brand Activation" (MAX-COMPLEXITY TEST)

**Inputs:** manhattan · plaza · obstructs_public_way=yes · sapo_event_type=plaza_event · **plaza_level=a** · plaza_multiple_blocks=no · headcount=300 · event_date=**2026-12-04** (135 days out) · open_to_public=yes · food_present=yes (free sampling), food_vendor_count=2 · selling_anything=no · amplified_sound=yes · structure_types=[tent_canopy], tent_area_sqft=**400** (20×20), tent_days_in_place=1, structure_over_10ft_tall=unknown · no flame · generator_present=yes (gasoline 5 gal, 50 kW) · battery none · no alcohol

**Expected findings:**

1. SAPO-PLAZA-001 — Plaza Event Permit, Level A single-block = 45-day deadline (2026-10-20) → ON_TRACK (~90 days slack)
2. SAPO-INSURANCE-001 — $1M liability, City additional insured
3. NYPD-SOUND-001 — Sound Device Permit → ON_TRACK
4. DOHMH-VENDOR-PERMIT-001 (2 vendors; sampling is food service — no separate "sampling permit" class exists; v1 corrected) → NOT_CALCULABLE lead
5. DOHMH-ORGANIZER-NOTIFY-001 — notify by 2026-11-04 → ON_TRACK
6. FDNY-GENERATOR-001 — 5 gal gasoline > 2.5 → permit; lead NOT_CALCULABLE (v1's universal 45–60d removed)
7. DEP-GENERATOR-REG-001 — 50 kW ≥ 40 → DEP registration
8. DOB-TENT-001 — **CONDITIONAL at the boundary**: 400 sq ft is not "more than 400"; render "confirm footprint calculation with DOB"; structure_over_10ft_tall=unknown keeps DOB-TALL-STRUCTURE-001 conditional too. **One finding carrying both rule ids**, which is why the substantive count is eight and not nine: they are two published routes to one DOB temporary-structure permit. This document has said so since v3, but until nyc.v2.6 only DOB-TALL-STRUCTURE-001 declared the `dob-structure` dedupe key, so the plan rendered two lines. The ruleset was corrected to match this block rather than the other way round (#89 item 6).

**Named confirmations:** CONF-NO-SALES-001, CONF-NO-FLAME-001, CONF-NO-BATTERY-001, CONF-NO-ALCOHOL-001. The plan has twelve findings total: eight substantive findings plus four confirmations.

**EXPECTED VERDICT: ⚠ CONDITIONAL — ALL DATED DEADLINES ON TRACK.** Copy: "Every published deadline clears with ~90 days of slack; two items need confirmation (tent footprint at the 400 sq ft boundary; FDNY lead times)."
**Test purpose:** volume + boundary honesty: eight findings, one coherent timeline, and the engine refuses to guess at an exact-boundary trigger.

## Scenario F — "Rooftop Launch Party" (CONDITIONAL-BRANCH TEST, expanded)

**Inputs:** manhattan · private_venue (rooftop) · headcount=90 · event_date=**2026-08-11** (20 days out) · open_to_public=no (invite-only) · food catered, nothing sold (food_present=yes), food_vendor_count=1 (the caterer) · selling_anything=no · amplified_sound=yes, sound_audible_from_public_way=**unknown** · alcohol=yes, venue_license_covers_event_area=**unknown** · venue_paco_covers_exact_event=**unknown**, venue_fdny_pa_permit_current_for_event_space=**unknown** · no structures · no flame · no generator · battery none

**Expected findings:**

1. DOB-ASSEMBLY-001 — 90 ≥ 75 **on a roof terrace** counts against the indoor threshold → PACO/TPA consideration. **That threshold is conditional and the fixtures do not model the condition**: BC 303.7(1) sweeps roofs and roof terraces onto the 75-person indoor side only as "open spaces at 20 feet (6096 mm) or more above or below grade plane", and under 20 feet BC 303.7(2)'s 200-person outdoor threshold governs, where 90 people would not trip it. F's rooftop has no recorded height, the intake collects none, and the trigger reads `location_type` and `headcount` only, so the engine treats any rooftop as indoor. Right for a typical multi-storey roof, over-inclusive for a low terrace. Narrowing it is a trigger and intake-registry change and is deliberately not made; this line records the conditional rather than restating the webpage bullet that drops it. TPA lead time is **ten business days**, resolved against two independent primary sources: TPPN #07/96 "at least ten (10) business days in advance of the planned event" and AC Table 28-112.8 "at least ten work days prior to the event" (that comment sits on the table's "Temporary use letter for place of assembly" row, which is also where the $250 and the $100/day sit; DOB's public TPA page attributes all three to the TPA). The earlier "earlier than 10 days" reading came from the 12.2016 code notes, which say "10 days" and never "calendar", disclaim their own authority and name TPPN #07/96 as governing; the wording variance is closed. The bound is **inclusive** — "at least ten (10)", and DOB's filing page adds that the filing date of the online request counts as one of the days — so the deadline moves EARLIER on both counts, not later. Unit and boundary landed together in nyc.v2.8 for that reason: the boundary alone would have moved this window one day LATER than a value already known wrong. A filing three business days or less before the event is not guaranteed processing; that floor is published as `deadline.display` TEXT anchored to the EVENT and is deliberately not computed, following the Parks special-event permit's one-string precedent, because no deadline type expresses a business-day floor and inventing one needs a spec. Fee is $250 to DOB + $100/day late; the statute's row literally named "temporary place of assembly certificate of operation" reads $130 and which row DOB NOW bills is not established. **No FDNY amount is stated as this event's cost.** The $415 this rule used to display beside the TPA is the venue's own place-of-assembly permit under FC 105.6, not an organizer's event fee, and FDNY's public-gathering line is hourly; which line FDNY bills for a one-off event is not published. **The running product declines to date this finding at all**: `business_days_minimum` needs the holiday calendar `config.business_day_math` pins, that calendar is deliberately unpublished (SPEC-CONFLICT #130), and the api therefore returns a null `latest_apply_date` with "confirm with agency". This fixture suite supplies an empty holiday list and so does compute a date; a green suite is not evidence this rule dates correctly in production. The active registry records `venue_paco_covers_exact_event` and `venue_fdny_pa_permit_current_for_event_space` under the same private-venue/headcount gate. Neither is read by a published trigger, neither changes this finding or verdict, and neither supports a temporary-filing inference.
2. Alcohol branch on venue_license_covers_event_area:
   - yes → SLA-VENUE-LICENSE-001: no new permit; confirm the license covers the exact rooftop area
   - no → SLA-ONEDAY-001: 15 business days required; **only 14 business days remain to 2026-08-11** (actual count, no holidays in window) → PUBLISHED_DEADLINE_MISSED on this branch; SLA-CATERING-001 same window (and requires real food + a currently licensed caterer)
3. NYPD-SOUND-001 — conditional on sound_audible_from_public_way: yes → permit in scope (§10-108(b)(3)); no → ADV-NOISE-CODE-001 advisory (noise code still applies) — a rooftop DJ is NOT automatically exempt (v1 corrected)
4. DOHMH-EXEMPTION-001 — invite-only + catered → private-function exemption may apply; confirm
5. ADV-VENUE-OCCUPANCY-001 — the venue's certificate of occupancy / legal use governs capacity regardless of permits; confirm the permitted use and occupancy. Added in v5: the advisory triggers on `location_type = private_venue` alone, names F in its own `exercised_by_scenarios`, and at 90 on a roof terrace the C-of-O question is the live one — `DOB-ASSEMBLY-001` counts roof terraces against the 75 indoor threshold, so the permit and the occupancy limit are separate constraints and the plan states both. Scenario B already listed this advisory on the same trigger.

**Named confirmations:** CONF-NO-SALES-001, CONF-NO-STRUCTURE-001, CONF-NO-FLAME-001, CONF-NO-GENERATOR-001, CONF-NO-BATTERY-001.

**EXPECTED VERDICT: ⚠ CONDITIONAL** — material branch facts: `venue_license_covers_event_area`, `sound_audible_from_public_way`. Branch table rendered: [license covers rooftop] → feasible path; [no license coverage] → infeasible path (SLA window missed by one business day); [sound audible from street] → add sound permit. Two material follow-up questions; the two F-110 assembly-document answers remain collected confirmation context outside the verdict branches.
**Test purpose:** the hardest behavior: verdicts hinging on multiple user-confirmable facts, with real business-day math.

## Boundary & Unit Fixtures (engine test suite, beyond the six)

- headcount 20 in a park → PARKS-EVENT-EXACTLY-20-001 OFFICIAL_CONFLICT rendering; 21 → permit required; 19 → nothing.
- Block party + selling_anything → PROHIBITED_OR_INELIGIBLE; block party + ride → insurance finding appears.
- tent_area_sqft 401 → DOB-TENT-001 REQUIRED; 400 → CONDITIONAL; 399 → nothing (absent other triggers).
- stage 2.0 ft / 120 sqft → no DOB-STAGE-001 (needs > 2 ft); 2.5 ft / 119 sqft → no; 2.5 ft / 120 sqft → yes.
- generator 2.5 gal gasoline → no FDNY permit (needs > 2.5); 2.6 → yes; 39.9 kW → no DEP registration; 40 kW → yes (inclusive).
- battery 20 kWh → no; 20.1 kWh → yes; no battery at all → no. The third case is expressible from nyc.v2.5: `battery_present` is asked of every event and `battery_system_kwh` only when it is yes, so "no battery" and "a battery of zero" are different answers. Before, an unanswered kWh was a material unknown, and FDNY-GENERATOR-001 read MAY_BE_REQUIRED for every event with no generator either.
- street_event_size=unknown → CONDITIONAL listing the 14/30/45/60-day ladder — all four sizes the registry permits, `extra_large` included. It is the only branch that is not FEASIBLE (60 days is the longest published window, so it is the one an organizer can already be late for), which is exactly why omitting it hid the case that matters: an organizer who does not know their size was never shown the longest window that might apply. Corrected in v5; `SAPO-STREET-XL-001` publishes the 60-day window and the ladder row of the v1 → v3 table below has said "street 14/30/45/up-to-60 by size" since v3.
- sapo_event_type=other_sapo_class → ADV-SAPO-OTHER-CLASS-001 coverage advisory with reference deadlines (incl. the Single Block Festival OFFICIAL_CONFLICT).
- obstructs_public_way=no on a sidewalk → SAPO-SCOPE-001 no-new-requirement note.
- Every negative-answer boundary retains its substantive result and also emits the applicable nyc.v2.11 confirmation; the acceptance suite compares substantive rule IDs separately from confirmation IDs so neither can hide a regression in the other.

## v1 → v3 Correction Ledger (what changed and why)

| v1 assertion                                  | v3 treatment                                                                                                                      | Basis                              |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| Universal ~60-day SAPO lead (R1)              | Per-class deadlines: street 14/30/45/up-to-60 by size; plaza by level; block party 60                                             | VS Round 2 #1, #3                  |
| Scenario A INFEASIBLE via 60-day lead         | Re-anchored: Large street event misses its 45-day deadline; size classification explicit                                          | VS Round 2 #1                      |
| R10 insurance for all street events           | Block party without ride exempt; press/rally exempt; hardship waiver exists                                                       | VS §4                              |
| R7 tent "over 10x10 ft"                       | DOB triggers: >400 sq ft, ≥30 days, stage >2 ft & ≥120 sqft, prop/truss >10 ft, >10 ft tall; 10x10 was NY State parks             | VS §1, Round 2 #7                  |
| R8 one "open-flame permit" for grills         | FDNY Fuel Permit (charcoal/propane) split from Open Flame Permit (sterno/candles, $210)                                           | VS §2                              |
| R6 universal 45–60d lead, any generator       | Thresholds: >2.5 gal gas / >10 gal diesel / >20 kWh battery; DEP registration ≥40 kW; lead RESEARCH_REQUIRED                      | VS Round 2 #10                     |
| (absent from v1)                              | DOHMH 30-day organizer notification + vendor list + private-property contract — new requirement class                             | VS Round 2 #9                      |
| R5 TUA any-sale (reconcile note)              | Kept as OFFICIAL_CONFLICT leaning any-sale (3 unhedged pages vs 1 hedged FAQ); the external critique's 500+-only reading rejected | VS Round 2 #12                     |
| R13 flat "no city permits" for private venues | Conditional low-burden result + occupancy/assembly/food/sound confirmations                                                       | VS §6, RF-4/RF-5                   |
| Sound permit never on private property        | In scope when audible on a public way (§10-108(b)(3)); fully-indoor non-projecting exempt, noise code applies                     | VS §10                             |
| "The key wins"                                | This suite is derived from the ruleset; primary source > rule > fixture > engine > UI                                             | Governance §2 (corrected ordering) |
