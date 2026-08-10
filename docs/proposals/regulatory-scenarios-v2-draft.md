# PopEngine — Expanded Regulatory Scenario Suite v2

**Rules snapshot:** July 22, 2026
**Status:** Draft for rule-authoring and primary-source review
**Supersedes:** Part 2 of `test-scenario-answer-key.md`
**Purpose:** Define the executable regulatory test fixtures that determine which rules PopEngine must encode.

---

# 1. Test Authority and Review Hierarchy

The prior answer key stated that the key should override the engine until a primary source disproves it. That approach creates a risk that an incorrect authored scenario becomes the product’s ground truth.

The authority hierarchy must instead be:

1. Approved primary source
2. Reviewed and published rule
3. Executable scenario expectation
4. Rules-engine result
5. User-interface copy

When an engine result and scenario disagree:

- Compare the scenario against the published rule.
- Compare the rule against its primary source.
- Correct whichever lower-level artifact is wrong.
- Never change the engine merely to reproduce an unsupported answer key.

---

# 2. Scenario Types

Each material rule should have several types of tests.

| Type          | Purpose                                                              |
| ------------- | -------------------------------------------------------------------- |
| Positive      | Confirms that a requirement appears when all triggers are satisfied  |
| Negative      | Confirms that a requirement does not appear when a trigger is absent |
| Boundary      | Tests the exact threshold and one unit on either side                |
| Eligibility   | Tests whether the organizer or event qualifies for a permit class    |
| Deadline      | Tests before, exactly at, and after the published filing deadline    |
| Dependency    | Tests requirements that depend on another permission or application  |
| Unknown       | Confirms that missing information produces a conditional result      |
| Conflict      | Confirms that contradictory answers request clarification            |
| Unsupported   | Confirms that unmodeled complexity does not produce false certainty  |
| Recalculation | Confirms that changing event scope recomputes the complete plan      |
| Versioning    | Confirms that historical plans retain their original ruleset         |

---

# 3. Expected Status Vocabulary

Do not use a generic `FEASIBLE` status for regulatory filing results.

Use:

- `ON_TRACK`
- `DEADLINE_APPROACHING`
- `PUBLISHED_DEADLINE_MISSED`
- `CONDITIONAL`
- `CANNOT_DETERMINE`
- `OUTSIDE_VALIDATED_COVERAGE`
- `NO_NEW_REQUIREMENT_IDENTIFIED`

`DEADLINE_APPROACHING` is an internal PopEngine planning status. Its warning buffer must be configurable and must not be represented as an agency rule.

---

# 4. SAPO and Public-Space Scenarios

SAPO requirements depend on whether an activity interferes with normal use of a street, curb lane, sidewalk, or pedestrian plaza. Street Events have 14-, 30-, and 45-day deadlines based on size; Extra Large Events may require up to 60 days. Block Parties require 60 days, Single Block Festivals require 90 days, and plaza deadlines vary from 14 to 60 days based on plaza level and footprint.

## S-SAPO-01 — Public-Space Scope Gate

**Rules tested:** SAPO scope, obstruction, public-space footprint

### Variant A — Private Interior

**Inputs:**

- Private indoor venue
- No sidewalk or curb-lane use
- No outdoor queue, staging, equipment, or branding
- No procession

**Expected result:**

- No SAPO requirement identified.
- Continue evaluating private-venue, assembly, food, alcohol, sound, and fire rules.

### Variant B — Sidewalk Promotion

**Inputs:**

- Commercial product activation
- Branded display placed on a public sidewalk
- Pedestrian flow partially obstructed

**Expected result:**

- SAPO Street Event classification required.
- Request footprint and impact details to determine event size.

### Variant C — Non-Obstructive Load-In

**Inputs:**

- Curb-lane or sidewalk used only for event setup and breakdown
- No branding
- No pedestrian or vehicle impact
- Duration no longer than 15 consecutive days

**Expected result:**

- Evaluate as a Production Event rather than immediately classifying it as a Street Event.
- Published Production Event deadline: 10 days.

**Required rule changes:**

- Add `public_space_footprint`.
- Add `obstructs_normal_use`.
- Add `commercial_or_promotional`.
- Add `production_setup_only`.
- Add `pedestrian_impact`.
- Add `vehicle_impact`.

---

## S-SAPO-02 — Small Street Event Deadline

**Classification facts:**

- Low or minimal pedestrian and vehicle impact
- Limited coordination
- Commercial or promotional sidewalk or curb-lane activity

### Variant A

- Event is exactly 14 calendar days away.

**Expected result:** `ON_TRACK`, with deadline today.

### Variant B

- Event is 13 calendar days away.

**Expected result:** `PUBLISHED_DEADLINE_MISSED`.

### Variant C

- Event is 20 days away.

**Expected result:** `ON_TRACK`.

**Expected requirements:**

- Small Street Event
- $25 processing fee
- Applicable Street Event fee
- Site plan
- Run of show
- Minimum $1 million insurance

---

## S-SAPO-03 — Medium Street Event Deadline

**Classification facts:**

- Significant sidewalk and curb-lane setup
- Meaningful pedestrian or vehicle impact
- Structure or obstruction
- Significant interagency coordination

### Variants

- 30 days away → `ON_TRACK`, deadline today
- 29 days away → `PUBLISHED_DEADLINE_MISSED`
- 38 days away → `ON_TRACK`

**Rule purpose:** Distinguish Medium from Small based on impact and setup, not attendance alone.

---

## S-SAPO-04 — Large Street Event Deadline

**Classification facts:**

- Full one-block street closure
- Extensive community and traffic impact
- Significant setup
- Multiple agencies

### Variants

- 45 days away → `ON_TRACK`, deadline today
- 44 days away → `PUBLISHED_DEADLINE_MISSED`
- 55 days away → `ON_TRACK`

**Rule purpose:** Confirm that a full street closure does not inherit a universal 60-day deadline.

---

## S-SAPO-05 — Extra Large Classification Is Not a Universal Rule

### Variant A

**Inputs:**

- Multiple event locations
- Combination of pedestrian plaza and full street closure
- Significant setup
- 59 days away
- Exact plaza levels unknown

**Expected result:** `CANNOT_DETERMINE`.

**Explanation:**

- The event may be Extra Large.
- Its filing deadline may be up to 60 days.
- Exact plaza and location information is required.

### Variant B

- Same event
- Exact plaza levels and footprint resolved
- Calculated deadline is 60 days
- Event is 59 days away

**Expected result:** `PUBLISHED_DEADLINE_MISSED`.

**Rule purpose:** Prevent “Extra Large = always 60 days” from replacing the actual location-based determination.

---

## S-SAPO-06 — Valid Block Party

**Inputs:**

- One residential block
- One day
- Nine hours or fewer
- Open to all neighbors
- Organizer belongs to block association
- Neighbor permission received
- No sales
- No fundraising
- No commercial sponsor
- No alcohol
- No rain date
- Event 70 days away

**Expected result:**

- Block Party Permit
- `ON_TRACK`
- Ten days before the 60-day filing deadline
- Application processing fee only
- No automatic $1 million insurance requirement when no ride is present

Block Parties are limited to one block and one day, prohibit sales and fundraising, require block-association and neighbor support, and must be filed 60 days ahead.

---

## S-SAPO-07 — Block Party Eligibility Failures

### Variant A — Food Sales

- Same facts as S-SAPO-06
- Food is sold

**Expected result:**

- Event is not eligible as a Block Party.
- Suggest evaluating Single Block Festival or another applicable classification.

### Variant B — Fundraising

- Admission donation required

**Expected result:** Block Party classification rejected.

### Variant C — Private Birthday Party

- Event limited to invited guests

**Expected result:** Block Party classification rejected because it is not open to the block.

### Variant D — Rain Date Requested

**Expected result:** Rain-date request flagged as incompatible with the Block Party rules.

### Variant E — Commercial Branding

**Expected result:** Block Party classification rejected; evaluate Street Event.

---

## S-SAPO-08 — Single Block Festival Deadline

**Inputs:**

- Nonprofit community sponsor
- One block
- One day
- Licensed vendors selling goods
- Public event

### Variants

- 90 days away → `ON_TRACK`, deadline today
- 89 days away → `PUBLISHED_DEADLINE_MISSED`
- Organizer is not a nonprofit community sponsor → classification not established

**Required rule additions:**

- Applicant nonprofit status
- Community association
- Vendor participation
- One-block and one-day limits
- 90-day deadline
- Vendor-fee-based SAPO fee

---

## S-SAPO-09 — Street Festival Eligibility

**Inputs:**

- Nonprofit community organization
- Multiple blocks
- Vendors
- Proposed new annual festival
- No qualifying historical event

**Expected result:**

- Do not produce an ordinary filing plan.
- Flag the Street Festival eligibility restriction.
- Require agency confirmation or place outside MVP coverage.

The current official page states that Street Festival applications are due by December 31 of the prior year and that applicants may apply only for qualifying historically established events.

**Rule purpose:** Test fixed annual deadlines and eligibility restrictions, not merely days-before-event calculations.

---

## S-SAPO-10 — Plaza Deadline Matrix

### Variant A — Level D, Small, One Plaza Block

- Event 14 days away → `ON_TRACK`
- Event 13 days away → `PUBLISHED_DEADLINE_MISSED`

### Variant B — Level B, Medium, One Plaza Block

- Event 30 days away → `ON_TRACK`
- Event 29 days away → `PUBLISHED_DEADLINE_MISSED`

### Variant C — Level A, One Plaza Block

- Event 45 days away → `ON_TRACK`
- Event 44 days away → `PUBLISHED_DEADLINE_MISSED`

### Variant D — Level A, Multiple Plaza Blocks

- Event 60 days away → `ON_TRACK`
- Event 59 days away → `PUBLISHED_DEADLINE_MISSED`

**Required inputs:**

- Exact plaza
- Plaza level
- Percentage of plaza footprint
- Percentage of plaza capacity
- Number of plaza blocks
- Event size
- Borough

---

## S-SAPO-11 — Insurance Branches

### Variant A — Street Event

**Expected result:** Minimum $1 million liability insurance.

### Variant B — Plaza Event

**Expected result:** Minimum $1 million liability insurance.

### Variant C — Block Party Without Ride

**Expected result:** Do not automatically require the $1 million SAPO insurance rule.

### Variant D — Block Party With Ride

**Expected result:** Insurance required.

**Rule purpose:** Replace universal R10 with permit-class-specific insurance rules.

---

## S-SAPO-12 — Alcohol Prohibition

### Variants

- Block Party with alcohol
- Street Event with alcohol
- Street Festival with alcohol

**Expected result:**

- Flag the alcohol element as incompatible with the selected SAPO event type.
- Do not merely add an SLA permit to the plan.

CECM states that alcohol is prohibited at parades, Block Parties, Street Events, and Street Festivals.

---

# 5. NYC Parks Scenarios

NYC Parks requires a Special Event Permit for events with more than 20 attendees. Applications fewer than 21 days before the event are not accepted, the processing fee is $25, and normal processing is approximately 21–30 days. Parks separately reviews amplified sound, generators, temporary structures, commercial activity, and sales.

## S-PARKS-01 — Attendance Threshold

### Variants

- 20 attendees, no reserved space or special elements
- 21 attendees, same event

**Expected result:**

- 20 attendees → no mandatory attendance-based permit identified; show optional reservation guidance.
- 21 attendees → Parks Special Event Permit required.

**Rule purpose:** Encode `attendance > 20`, not `attendance >= 20`.

---

## S-PARKS-02 — Filing Hard Floor

### Variants

- Event exactly 21 days away → application accepted under the published timing rule
- Event 20 days away → `PUBLISHED_DEADLINE_MISSED`
- Event 30 days away → `ON_TRACK`

**Expected plan copy:**

> Apply at least 21 days ahead. Parks reports a typical processing period of approximately 21–30 days.

Do not encode 30 days as a hard deadline.

---

## S-PARKS-03 — Event Below Attendance Threshold With Special Elements

**Inputs:**

- 12 attendees
- Amplified speaker
- Small generator
- Temporary canopy

**Expected result:**

- Do not return “no permit needed” based solely on attendance.
- Return `CONDITIONAL`.
- Explain that Parks reviews events involving amplified sound, generators, or temporary structures regardless of attendance.
- Require the organizer to seek Parks approval.

**Rule purpose:** Separate the clear attendance mandate from element-based Parks review language.

---

## S-PARKS-04 — Sales and Temporary Use Authorization

### Variant A

- 500 attendees
- Merchandise sales

**Expected result:**

- Parks permit required.
- Revenue-generating activity requires Parks review.
- Do not automatically assert TUA based solely on attendance.

### Variant B

- 501 attendees
- Merchandise sales

**Expected result:**

- Parks permit required.
- Conditional TUA output: “A Temporary Use Authorization may be required.”
- Vendor list, items, and prices required for Revenue Division review.

Parks states that sales at events with attendance over 500 may require a TUA.

---

## S-PARKS-05 — Parks Insurance

### Variants

- Basic 50-person picnic
- 400-person event with structures and vendors

**Expected result for both:**

- Do not automatically require insurance.
- Output: “The Parks borough permit office will determine whether insurance or a bond is required.”

The second event may be more likely to receive an insurance requirement, but PopEngine should not convert that likelihood into a rule.

---

## S-PARKS-06 — Parks Amplified Sound

**Inputs:**

- Park event
- 150 attendees
- Amplified speeches and music
- 56 days away

**Expected requirements:**

- Parks Special Event Permit
- Parks amplified-sound review
- NYPD Sound Device Permit
- Case-by-case Parks insurance notice

**Expected status:** `ON_TRACK`.

**Dependency output:**

- Parks permission is required for amplified sound.
- Exact sequencing with the precinct remains an agency-confirmation item unless a primary source establishes a universal filing sequence.

---

# 6. Food-Service Scenarios

NYC Health requires organizers of public temporary events to ensure every food vendor has an acceptable permit and to notify the Health Department 30 days before the event. The requirement applies whether food is sold or given away. Events not open to the public, such as certain neighborhood, school, religious, affinity, business, or social functions, may fall under an exception.

## S-FOOD-01 — Hot Food Sold to the Public

**Inputs:**

- Public street event
- One hot-food vendor
- Food sold
- Event 45 days away
- Vendor claims to hold an MFV permit

**Expected requirements:**

- Verify acceptable vendor permit
- Record vendor permit number
- Organizer DOHMH notification
- Notification deadline 30 days before the event
- Waste, wastewater, handwashing, and sanitation planning prompts

**Expected status:** `ON_TRACK`, subject to credential verification.

---

## S-FOOD-02 — Free Public Sampling

**Inputs:**

- Public brand activation
- Free food samples
- No sale
- Event 45 days away

**Expected result:**

- Do not classify sampling as exempt merely because it is free.
- Require acceptable food-vendor coverage.
- Require organizer’s 30-day notification.
- Do not invent a separate generic “DOHMH sampling permit.”

---

## S-FOOD-03 — Food Notification Boundary

### Variants

- Public food event exactly 30 days away → notification deadline today
- Public food event 29 days away → published organizer-notification deadline missed
- Public food event 45 days away → on track

**Expected result at 29 days:**

- `PUBLISHED_DEADLINE_MISSED`
- Direct organizer to contact DOHMH
- Do not automatically claim that the entire event is impossible

---

## S-FOOD-04 — Private Affinity-Group Exception

**Inputs:**

- Private religious, school, neighborhood, or affinity-group event
- General public not invited
- Food prepared or served
- No public advertising

**Expected result:**

- Display the DOHMH temporary-event exception.
- Confirm that the event is genuinely not open to the public.
- Continue evaluating venue and food-safety obligations.

---

## S-FOOD-05 — Public Gallery Event With Free Snacks

**Inputs:**

- Private gallery venue
- Event publicly advertised
- Anyone may attend
- Free prepackaged snacks

**Expected result:**

- Do not apply the private-function exception.
- Ask whether food service is covered by an existing FSE or participating permitted vendor.
- Evaluate organizer notification.

**Rule purpose:** “Private property” and “private event” must be separate data fields.

---

# 7. Place-of-Assembly Scenarios

NYC generally requires a Place of Assembly Certificate of Operation where 75 or more people gather indoors or on a rooftop or rooftop terrace, or 200 or more gather outdoors. Temporary events may require a Temporary Place of Assembly filing. The published TPA filing target is ten business days, with a $250 base fee and late surcharges.

## S-DOB-01 — Indoor Assembly Boundary

### Variants

- 74 people indoors
- 75 people indoors

**Expected result:**

- 74 → no PA threshold triggered solely by attendance; confirm legal occupancy and venue use.
- 75 → require confirmation of existing PACO or evaluate TPA.

---

## S-DOB-02 — Rooftop Assembly Boundary

### Variants

- 74 people on rooftop terrace
- 75 people on rooftop terrace

**Expected result:**

- 74 → no PA threshold triggered solely by attendance.
- 75 → existing PACO or TPA consideration required.

**Rule purpose:** Rooftops must not be treated as ordinary outdoor spaces for the attendance threshold.

---

## S-DOB-03 — Outdoor Assembly Boundary

### Variants

- 199 people outdoors
- 200 people outdoors

**Expected result:**

- 199 → no PA threshold based solely on attendance.
- 200 → existing outdoor PA approval or TPA consideration.

---

## S-DOB-04 — TPA Filing Boundary

### Variants

- TPA path required; exactly ten business days remain
- TPA path required; nine business days remain

**Expected result:**

- Ten business days → standard filing target met
- Nine business days → late filing with one day of surcharge, subject to DOB review

**Expected fee calculation:**

- Base fee: $250
- Late surcharge: $100 per day inside the ten-business-day target

Business-day fixtures must use concrete dates and the selected New York holiday calendar in automated tests.

---

# 8. Temporary Structure Scenarios

DOB identifies triggers including a tent or canopy over 400 gross square feet or in place for 30 days or more; a stage, platform, or scaffolding over two feet high and at least 120 square feet; and a prop or truss over ten feet high.

## S-STRUCT-01 — Tent Area Boundary

### Variants

- 20×20 tent, exactly 400 square feet, installed one day
- Tent totaling 401 square feet, installed one day

**Expected result:**

- 400 square feet → no DOB area trigger based solely on published “more than 400” threshold
- 401 square feet → temporary-structure permit requirement

**Important:** Continue evaluating fire, location-owner, Parks, and SAPO approvals.

---

## S-STRUCT-02 — Tent Duration Boundary

### Variants

- 300-square-foot tent installed for 29 days
- 300-square-foot tent installed for 30 days

**Expected result:**

- 29 days → no DOB duration trigger based solely on duration
- 30 days → temporary-structure permit requirement

---

## S-STRUCT-03 — Stage Boundary

### Variants

- Stage 2 feet high and 120 square feet
- Stage 2.1 feet high and 119 square feet
- Stage 2.1 feet high and 120 square feet

**Expected result:**

- First → no trigger because height does not exceed two feet
- Second → no trigger because area is below 120 square feet
- Third → temporary-structure permit requirement

**Rule purpose:** Test compound conditions rather than treating either dimension as independently sufficient.

---

## S-STRUCT-04 — Truss Height Boundary

### Variants

- Truss exactly ten feet high
- Truss 10.1 feet high

**Expected result:**

- Ten feet → no published height trigger
- Over ten feet → temporary-structure permit requirement

---

# 9. FDNY and Power Scenarios

FDNY publishes separate permit categories for generator or battery systems, fuel, and open flame. Generator thresholds include aggregate fuel storage exceeding 2.5 gallons of gasoline or ten gallons of diesel; outdoor battery systems exceeding 20 kWh also trigger the published permit category.

## S-FDNY-01 — Gasoline Generator Boundary

### Variants

- Aggregate gasoline tank capacity exactly 2.5 gallons
- Aggregate gasoline tank capacity 2.6 gallons

**Expected result:**

- 2.5 gallons → no threshold trigger under “exceeding 2.5 gallons”
- 2.6 gallons → FDNY generator/battery permit requirement

---

## S-FDNY-02 — Diesel Generator Boundary

### Variants

- Aggregate diesel tank capacity exactly ten gallons
- Aggregate diesel tank capacity 10.1 gallons

**Expected result:**

- Ten gallons → no threshold trigger under “exceeding ten gallons”
- 10.1 gallons → FDNY generator/battery permit requirement

---

## S-FDNY-03 — Outdoor Battery Boundary

### Variants

- Outdoor battery system exactly 20 kWh
- Outdoor battery system 20.1 kWh

**Expected result:**

- 20 kWh → no threshold trigger under “exceeding 20 kWh”
- 20.1 kWh → FDNY generator/battery permit requirement

---

## S-FDNY-04 — Fuel Versus Open Flame

### Variant A — Charcoal Grill

**Expected result:** Evaluate under FDNY Fuel Permit.

### Variant B — Propane Cooking

**Expected result:**

- Evaluate under FDNY Fuel Permit.
- Collect propane quantity.
- Apply location-specific prohibitions, including Parks restrictions where relevant.

### Variant C — Sternos

**Expected result:** Evaluate under FDNY Open Flame Permit.

### Variant D — Candles

**Expected result:** Evaluate under FDNY Open Flame Permit.

### Variant E — Floor-Mounted Café Heater

**Expected result:** Evaluate under FDNY Open Flame Permit.

**Rule purpose:** Remove the single combined “open flame/cooking permit” rule.

---

## S-FDNY-05 — Generator Over 40 kW

### Variants

- Generator rated at 40 kW
- Generator rated at 40.1 kW

**Expected result:**

- Evaluate FDNY permit from fuel specifications in both cases.
- Over 40 kW → additionally flag the published DEP certificate requirement.

CECM identifies an additional DEP requirement for generators over 40 kW.

---

# 10. Sound Scenarios

NYPD requires a Sound Device Permit application to be filed with the local precinct no fewer than five days before the event. The listed fee begins at $45.

## S-SOUND-01 — Filing Boundary

### Variants

- Amplified sound exactly five days away
- Amplified sound four days away
- Amplified sound ten days away

**Expected result:**

- Five days → deadline today
- Four days → `PUBLISHED_DEADLINE_MISSED`
- Ten days → `ON_TRACK`

---

## S-SOUND-02 — Precinct Resolution

**Inputs:**

- Amplified sound
- Exact address known
- Precinct not yet resolved

**Expected result:**

- Sound requirement identified.
- Plan remains incomplete until the correct precinct is resolved.
- Application must link to the precinct serving the event location.

---

## S-SOUND-03 — Private-Property Sound Ambiguity

### Variant A

- Enclosed indoor venue
- Amplified sound
- Sound not audible from adjacent public space

### Variant B

- Rooftop DJ
- Sound audible from adjacent street or park

**Expected result:**

- Do not apply a simplistic `private_property = no sound permit` rule.
- Until the governing primary legal interpretation is encoded, return a conditional sound-permit determination.
- Variant B should receive a stronger agency-confirmation warning.

**Research task:** Establish the authoritative operational scope for sound devices used on private property.

---

# 11. Alcohol Scenarios

The State Liquor Authority requires One-Day Alcohol Event and Catering Permit applications at least 15 business days before the event. The One-Day Alcohol Event Permit costs $36 per point of sale per day; the Catering Permit costs $48 per point of sale per day and is limited to active on-premises retail licensees providing food at qualifying private off-premises events.

## S-ALCOHOL-01 — One-Day Alcohol Event Permit

### Variants

- 15 business days remain
- 14 business days remain
- Two points of sale for one day

**Expected result:**

- 15 business days → deadline today
- 14 business days → `PUBLISHED_DEADLINE_MISSED`
- Two points of sale → $72 permit fee

**Additional checks:**

- Exact licensed event area
- Location’s annual one-day-permit count
- Landlord or property authorization
- Whether the selected SAPO event class prohibits alcohol

---

## S-ALCOHOL-02 — Catering Permit

**Inputs:**

- Active on-premises retail licensee
- Private event away from licensed premises
- Caterer provides qualifying food
- Two points of sale
- 16 business days away

**Expected result:**

- Catering Permit
- `ON_TRACK`
- Fee: $96
- Food-provision requirement displayed

### Negative variants

- Applicant is not an active on-premises retail licensee
- Applicant is catering its own off-premises event
- Only chips and pretzels are provided

**Expected result:** Catering Permit eligibility not established.

---

## S-ALCOHOL-03 — Existing Venue Licence

**Inputs:**

- Venue says it has an existing liquor licence
- Event is on a rooftop or secondary event area
- Exact licensed boundaries unknown

**Expected result:**

- Do not automatically remove the temporary-alcohol path.
- Return `CONDITIONAL`.
- Require confirmation that the venue’s licence covers the exact event area and proposed service.

---

# 12. Cross-Cutting Safety Scenarios

## S-SAFE-01 — Unknown Location Authority

**Inputs:**

- Event described as occurring at “the waterfront near Pier X”
- Exact parcel and operator unknown

**Expected result:** `CANNOT_DETERMINE`.

The system must not assume NYC Parks, SAPO, or another authority.

---

## S-SAFE-02 — Missing Equipment Specifications

**Inputs:**

- “Large tent”
- “Generator”
- No dimensions, duration, fuel type, fuel capacity, power, or battery capacity

**Expected result:**

- Tent and generator requirements shown as unresolved.
- System asks the necessary follow-up questions.
- No definitive negative or positive determination.

---

## S-SAFE-03 — Contradictory Attendance

**Inputs:**

- Total attendance: 60
- Peak concurrent attendance: 90
- Venue capacity answer: 70

**Expected result:**

- Intake conflict displayed.
- Plan generation blocked until clarified.

---

## S-SAFE-04 — Public Versus Private Conflict

**Inputs:**

- Event marked “private”
- Publicly advertised
- Anyone may RSVP
- Free public food sampling

**Expected result:**

- System identifies the conflict.
- DOHMH private-function exception is not applied without clarification.

---

## S-SAFE-05 — Unsupported Event Element

**Inputs:**

- Fireworks
- Moving parade route
- Multiple waterfront locations
- Temporary grandstand
- 8,000 attendees

**Expected result:**

- `OUTSIDE_VALIDATED_COVERAGE`
- Supported portions may be shown separately.
- Plan cannot be described as complete.

---

## S-SAFE-06 — Scope Recalculation

**Initial event:**

- Public sidewalk
- Amplified sound
- Public food sampling
- 35 days away

**Updated event:**

- Private indoor venue
- No public-space footprint
- No amplified sound
- Public food sampling retained

**Expected result:**

- SAPO and NYPD requirements removed if supported by the confirmed new facts.
- Food requirements retained.
- Assembly requirement recalculated using venue attendance and occupancy.
- Original plan preserved in history.
- Changed requirements identified.

---

## S-SAFE-07 — Ruleset Version Preservation

**Steps:**

1. Generate a plan using ruleset `nyc-1.0`.
2. Publish `nyc-1.1` with a changed deadline or source.
3. Open the historical plan.

**Expected result:**

- Historical plan still displays its `nyc-1.0` result.
- User is notified that a newer ruleset exists.
- Recalculation creates a new plan version.
- Material changes are shown.

---

## S-SAFE-08 — Source Dispute

**Inputs:**

- Two official pages appear to conflict.
- One says “more than 20.”
- Another says “20 or more.”

**Expected result:**

- Rule is marked disputed.
- Boundary case returns `CONDITIONAL`.
- Nonboundary cases continue to use the unambiguous portion of the rule.
- Source conflict is visible to rules administrators.

---

# 13. Rule Backlog Produced by the Scenarios

The scenario suite requires replacing R1–R13 with smaller, independently testable rules.

## SAPO

- `SAPO-SCOPE-001` — Public-space interference or obstruction
- `SAPO-PRODUCTION-001` — Production Event scope
- `SAPO-STREET-SMALL-001`
- `SAPO-STREET-MEDIUM-001`
- `SAPO-STREET-LARGE-001`
- `SAPO-EXTRA-LARGE-001`
- `SAPO-BLOCK-PARTY-ELIGIBILITY-001`
- `SAPO-BLOCK-PARTY-DEADLINE-001`
- `SAPO-SINGLE-BLOCK-FESTIVAL-001`
- `SAPO-STREET-FESTIVAL-001`
- `SAPO-PLAZA-LEVEL-A-001`
- `SAPO-PLAZA-LEVEL-B-001`
- `SAPO-PLAZA-LEVEL-C-001`
- `SAPO-PLAZA-LEVEL-D-001`
- `SAPO-INSURANCE-STREET-001`
- `SAPO-INSURANCE-PLAZA-001`
- `SAPO-INSURANCE-BLOCK-RIDE-001`
- `SAPO-ALCOHOL-PROHIBITION-001`

## Parks

- `PARKS-ATTENDANCE-001`
- `PARKS-DEADLINE-001`
- `PARKS-ELEMENT-REVIEW-001`
- `PARKS-SALES-REVIEW-001`
- `PARKS-TUA-001`
- `PARKS-INSURANCE-001`
- `PARKS-AMPLIFIED-SOUND-001`

## Food

- `DOHMH-PUBLIC-FOOD-VENDOR-001`
- `DOHMH-ORGANIZER-NOTIFICATION-001`
- `DOHMH-PRIVATE-EVENT-EXCEPTION-001`
- `DOHMH-PRIVATE-PROPERTY-CONTRACT-001`

## DOB

- `DOB-PA-INDOOR-001`
- `DOB-PA-ROOFTOP-001`
- `DOB-PA-OUTDOOR-001`
- `DOB-TPA-DEADLINE-001`
- `DOB-TPA-FEE-001`
- `DOB-TENT-AREA-001`
- `DOB-TENT-DURATION-001`
- `DOB-STAGE-001`
- `DOB-TRUSS-001`

## FDNY and DEP

- `FDNY-GENERATOR-GASOLINE-001`
- `FDNY-GENERATOR-DIESEL-001`
- `FDNY-BATTERY-001`
- `FDNY-FUEL-001`
- `FDNY-OPEN-FLAME-001`
- `DEP-GENERATOR-POWER-001`

## NYPD

- `NYPD-SOUND-DEADLINE-001`
- `NYPD-SOUND-PRECINCT-001`
- `NYPD-SOUND-PRIVATE-PROPERTY-001`

## Alcohol

- `SLA-ONE-DAY-EVENT-001`
- `SLA-CATERING-001`
- `SLA-EXISTING-LICENSE-AREA-001`
- `SLA-BUSINESS-DAY-CALENDAR-001`

## Platform Safety

- `COVERAGE-STATUS-001`
- `UNKNOWN-PROPAGATION-001`
- `CONFLICT-DETECTION-001`
- `RULESET-VERSIONING-001`
- `SOURCE-DISPUTE-001`

---

# 14. Rule Acceptance Standard

A rule is not ready for publication until it has:

- A unique rule ID
- A plain-language description
- Structured trigger conditions
- Explicit negative conditions
- Exceptions
- Required input fields
- Output requirement
- Deadline logic
- Fee logic
- Dependency logic
- Coverage behavior
- At least one primary source
- Source excerpt
- Retrieval date
- Effective date when available
- Positive test
- Negative test
- Boundary test when numerical
- Unknown-input test
- Reviewer
- Publication status

---

# 15. Recommended Implementation Order

## Tier 1 — Demo-Critical

1. SAPO scope and Street Event size
2. SAPO deadline matrix
3. Parks threshold and hard floor
4. NYPD sound deadline
5. DOHMH organizer notification and vendor permits
6. Assembly thresholds
7. Unknown and unsupported states
8. Scope recalculation

## Tier 2 — High-Value Complexity

1. Plaza levels
2. Block Party eligibility
3. Temporary structures
4. Generator and battery thresholds
5. Fuel versus open flame
6. Alcohol branching
7. Insurance exceptions
8. Ruleset versioning

## Tier 3 — Expanded Coverage

1. Single Block Festivals
2. Street Festivals
3. Health Fairs
4. Farmers Markets
5. Open Culture events
6. Parades and processions
7. Waterfront events
8. Highly specialized structures

---

# 16. Updated Demo Recommendation

Do not use the existing 35-day sidewalk scenario to demonstrate a definite 60-day failure.

A safer flagship demo would use one of these:

### Option A — Medium Street Event Boundary

- Commercial sidewalk and curb-lane activation
- Significant setup
- Clearly classified Medium
- Event 29 days away

**Magic moment:** Published 30-day deadline missed.

### Option B — Parks Hard Floor

- Park event
- More than 20 attendees
- Event 20 days away

**Magic moment:** Parks will not accept an application inside 21 days.

### Option C — Block Party Eligibility Transformation

- Initially includes food sales and fundraising
- PopEngine rejects Block Party classification
- Organizer removes sales and fundraising
- Event becomes eligible, but 60-day deadline is evaluated

### Option D — Conditional Rooftop Event

- 90-person rooftop event
- Alcohol
- Existing venue approvals unknown

**Magic moment:** PopEngine identifies the exact facts that must be confirmed instead of fabricating certainty.

The strongest end-to-end demonstration may combine Option A or B as the hard deadline failure with Option D as the conditional-logic demonstration.
