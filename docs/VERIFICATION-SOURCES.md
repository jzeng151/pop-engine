# PopEngine — Verification Source Dossier

**Purpose:** Primary-source research record for the regulatory items in `OPEN-QUESTIONS.md` §2, begun 2026-07-22. **Nothing in this document is a verification.** Only the verification owner (Dev 4) may promote a fact in a new immutable rules publication, per the process note. SUPPORT / CONTRADICT / NOT ADDRESS labels are researchers' candidate assessments of fetched text against the encoded claim, for triage only.

**Method:** Every URL below was fetched on 2026-07-22 and its content read before quoting; unfetched links were excluded. Note for re-verification: most nyc.gov, nycgovparks.org, and codelibrary.amlegal.com pages block generic fetchers (HTTP 403) and were retrieved with a browser user-agent; a normal browser will open them fine. Beware stale Fire Code PDFs: URLs without "-2022" in the filename serve the 2014 code.

---

## ⚠ Red Flags First: Primary Text That Appears to CONTRADICT Encoded Facts

These are the items where verification is likely to _change_ the rules file, not just confirm it. Team + Dev 4 should triage these before the green gate, because two touch the demo anchor.

| #    | Encoded claim                                                                               | What primary text says                                                                                                                                                                                                                                                                                                                                                                            | Impact if confirmed                                                                                                                                                                                                                                                    |
| ---- | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| RF-1 | R7: tent/structure permit "over 10x10 ft", DOB and/or FDNY                                  | CECM: structures **over 10 ft tall** need DOB permit. DOB: tent/canopy **over 400 gross sq ft** (or 30+ days in place) needs a DOB permit (Registered Design Professional files ≥15 business days ahead; $100 fee/30 days). FDNY's published permit list has **no tent category** (FDNY's role is flame-resistance + open-flame/fuel). The 10x10 figure matches **NY State** Parks rules, not NYC | R7's trigger threshold, agency, and lead time all change. Scenario E's 20x20 tent = exactly 400 sq ft, which is **not** "more than 400"; the expected R7 line may be wrong or hinge on height/duration instead                                                         |
| RF-2 | R1: SAPO ~60-day lead (all street events)                                                   | CECM FAQ publishes deadlines **by event type**: block parties/clean-ups/farmers markets/religious 60 days; **street events 14–45 days**; plaza events 14–60; press/rallies/productions 10 days; street festivals: December 31 of the **prior year**                                                                                                                                               | The backward-timeline math changes per event type. **Scenario A's INFEASIBLE verdict rests on the 60-day figure**; a sidewalk pop-up classed as a "street event" (14–45 days) might not be date-blocked at 35 days out. This is answer-key-level, team must rule on it |
| RF-3 | R10: $1M GL + City additional insured for street events (`[VERIFY]` "ALL SAPO event types") | 50 RCNY §1-08(b) (current, July 2026): required for all events **except block parties and press conferences/rallies/stationary demonstrations**, with a hardship waiver. CECM: block parties need insurance only with rides                                                                                                                                                                       | Scenario D's insurance line (block party) is likely wrong, exactly as the key's own `[VERIFY applicability to block parties]` suspected. R10 trigger needs an exception                                                                                                |
| RF-4 | A1: prepackaged free food → "confirm DOHMH exemption"                                       | Health Code Art. 88 §88.03(f): distributing prepackaged food at an event is **inside** the TFSE permit scope. Exemptions are narrow: affinity-group/private functions where the public is not invited; govt/nonprofit nutrition education                                                                                                                                                         | Scenario B's gallery pop-up (public invited) likely does NOT qualify for an exemption; A1's advisory wording holds up, but the answer may be "permit required," not "exempt"                                                                                           |
| RF-5 | A2: no sound permit on private property                                                     | Admin Code §10-108(b)(3): the permit reaches sound projected **outside a building or through windows/doorways** onto a public street. Only fully-indoor, non-projecting sound is out of scope                                                                                                                                                                                                     | A2's advisory should be scoped to "indoor/enclosed private events"; a rooftop DJ audible from the street (Scenario F!) may actually need the permit                                                                                                                    |
| RF-6 | (Not encoded at all)                                                                        | DOB/CECM: **Temporary Place of Assembly (TPA) permit** required where 75+ gather indoors or **200+ outdoors**; apply >10 days ahead; min fee $250, +$100/day if late                                                                                                                                                                                                                              | A possible missing requirement: Scenario E (300 on a plaza) and Scenario F (90 indoors) may both trigger TPA. Candidate new rule for the team to rule on; the current ruleset never mentions TPA                                                                       |
| RF-7 | R8 note: "no BBQ on beaches"                                                                | 311: barbecuing is allowed in **designated areas** of certain parks and beaches; the ban is on cooking outside them. Propane in parks: confirmed prohibited                                                                                                                                                                                                                                       | Note wording softens to "outside designated areas"                                                                                                                                                                                                                     |

---

## Item-by-Item Candidates (§2 numbering)

### 1. R7 — Tent threshold + issuing agency

- https://www.nyc.gov/site/cecm/permitting/permit-types/street-events.page ("Street Events - CECM"): "Structures such as tents, canopies, stage platforms, bleachers, or inflatables over 10 feet tall require a permit from the Department of Buildings ... Generators require a certificate from the New York Fire Department." — CONTRADICT (10x10 footprint claim)
- https://www.nyc.gov/site/cecm/support/department-of-buildings.page: DOB permit needed "if you intend to use a tent or canopy that is more than 400 gross square feet or if the tent or canopy will be in place for 30 days or more." — CONTRADICT (10x10)
- https://www.nyc.gov/site/buildings/industry/tup.page ("TUP - Buildings"): Temporary Use Permit filed by a Registered Design Professional "no later than 15 business days prior"; $100 initial 30 days, $130 per additional period. — SUPPORT (DOB as issuer, published lead time)
- https://www.nyc.gov/assets/buildings/pdf/code_notes_temp_place-of-assembly.pdf (DOB Code Notes): "Any tents or canopy more than 400 gross square feet or that will be in place for more than 30 days" requires a DOB work permit. — CONTRADICT (10x10)
- https://www.nyc.gov/assets/fdny/downloads/pdf/about/chapter-31-2022.pdf (2022 Fire Code ch. 31): tent permits "as set forth in FC 105.6"; FC 105.6 (chapter-1-2022.pdf) contains no tent permit category. — NOT ADDRESS (threshold); supports FDNY-not-structural-issuer
- Probable origin of "10x10": NY **State** Parks application (parks.ny.gov, lead, not fetched): tents larger than 10'x10' need a separate permit. Wrong jurisdiction for NYC events.

### 2. R8 — Open-flame permit class + lead time

- https://www.nyc.gov/site/fdny/business/all-certifications/per-openflames.page ("Open Flame Permit"): "To use open flame in any public assembly occupancy, place of public gathering, covered mall building. Cost of Permit Fee is $210.00 per set-up or vendor." — SUPPORT (class + fee); NOT ADDRESS (lead time)
- https://www.nyc.gov/site/cecm/support/new-york-city-fire-department.page: "Fuel Permit: to use and/or store fuel for cooking and/or equipment, including but not limited to kerosene, propane, charcoal/wood, etc. ... Open Flame Permit: to have candles, sternos or floor mounted café heaters." — SUPPORT (charcoal grills → **Fuel Permit**, not Open Flame; class distinction matters for Scenario D)
- 2022 Fire Code: FC 105.6 open-flame trigger (chapter-1-2022.pdf); FC 307 baseline open-fire prohibition with barbecue exceptions (chapter-3-2022.pdf); FC 6101.5.6 LPG at street fairs needs certificate-of-fitness supervision (chapter-61-2022.pdf). — SUPPORT
- Propane in parks: https://portal.311.nyc.gov/article/?kanumber=KA-02228: "Propane grills are prohibited." — SUPPORT. Flat "no BBQ on beaches": CONTRADICT (designated areas exist).
- Published lead time: no primary source found on any fetched page.

### 3. R4 — DOHMH permit classes (sold / sampling / prepackaged)

- https://www.nyc.gov/site/doh/business/food-operators/temporary-food-service-establishments.page ("Food Vending at Temporary Events"): "Acceptable permits include valid Temporary Food Service Establishment (TFSE), standard Food Service Establishment (FSE) and Mobile Food Vendor (MFV)." Permit needed "no matter how the food is offered ... whether the event is held on private property, a public street or in a park." — SUPPORT (classes)
- https://www.nyc.gov/assets/doh/downloads/pdf/about/healthcode/health-code-article88.pdf (Health Code Art. 88): §88.05(c) permit per operator; §88.03(a) "Event" includes "food samples ... distributed to the public, with or without charge" (— free sampling is in scope); §88.03(f) prepackaged distribution is in scope; §88.03(f)(2)-(4) narrow exemptions (affinity/private functions, govt/nonprofit education). — SUPPORT for sampling-needs-permit; CONTRADICT for any general prepackaged-free exemption (see RF-4)
- https://nyc-business.nyc.gov/nycbusiness/description/temporary-food-service-establishment-permit: "$70 for an annual permit ... A supervising manager with a Food Protection Certificate must be on site at all times." — SUPPORT (fee detail)
- SAPO-side sampling nuance (CECM FAQ, https://www.nyc.gov/site/cecm/support/frequently-asked-questions.page): no **SAPO** permit for on-person sampling with no table/street footprint. That is the street permit, not the health permit; do not conflate.
- Food trucks: https://www.nyc.gov/site/doh/business/food-operators/mobile-and-temporary-food-vendors.page + MFV application PDF (https://www.nyc.gov/assets/doh/downloads/pdf/rii/mobile-food-vending-permit.pdf): insurance requirements are Workers' Comp/Disability; **no auto-insurance-copy requirement found anywhere** — NOT ADDRESS; the key's auto-insurance clause has no located source.

### 4. R10 — Insurance scope for SAPO events

- https://codelibrary.amlegal.com/codes/newyorkcity/latest/NYCrules/0-0-0-84731 (50 RCNY §1-08, "July 2026 (current)"): "All events except for block parties and any Press Conference/Rally/Stationary Demonstration are required to have liability insurance in the amount of one million dollars ($1,000,000) per occurrence naming the City of New York as an additional insured ... The Director of SAPO shall have the authority to waive the insurance requirement ... unreasonable hardship." — SUPPORT ($1M + additional insured); CONTRADICT ("ALL SAPO event types"; see RF-3)
- https://www.nyc.gov/site/cecm/support/frequently-asked-questions.page: "SAPO requires insurance for all commercial/promotional events and all Street Festivals. Block parties wishing to have rides must also provide insurance." — SUPPORT (exception detail)
- Per-type confirmation pages fetched: street-events.page, street-festivals.page, open-culture.page (all state $1M + City additional insured; Open Culture requires insurance despite fee exemption); block-parties.page lists **no** organizer liability insurance.
- Wording caution: the codified rule says "liability insurance"; the exact phrase "commercial general liability" was not found in fetched primary text.

### 5. R9 — SLA instrument per format

- https://sla.ny.gov/permits-available-online: **One-Day Alcohol Event Permit** ("sale and/or service of wine, beer, cider and liquor ... for a period of 24 hours"; "minimum of 15 business days prior"; $36/point of sale/day). **Catering Permit** (licensed on-premises retailer at private off-premises events; "minimum of 15 business days prior"; $48). — SUPPORT (two-instrument mapping AND the verbatim 15-business-day lead)
- https://sla.ny.gov/temporary-operating-permit-application-retailers (ST permit PDF): 180-day operating permit for premises awaiting license. — NOT ADDRESS (do not map to one-off events)
- Encoding note: if any copy says "temporary beer/wine permit," that instrument (TP-820) appears superseded by the One-Day Alcohol Event Permit. Supports interpretation I-1's structure: the venue-license path involves no SLA filing; the 15-business-day lead attaches to the SLA permits.

### 6. R13 — Place-of-assembly threshold

- https://www.nyc.gov/site/buildings/dob/project-categories-paco.page: "New York City requires a Place of Assembly Certificate of Operation (PACO) ... where 75 or more people gather indoors or on roof terraces; or where 200 or more people gather outdoors." — SUPPORT (the ~75 indoors claim, plus a 200-outdoors figure the ruleset doesn't carry)
- https://www.nyc.gov/assets/buildings/pdf/code_notes_temp_place-of-assembly.pdf: "A TPA is issued where there are 75 or more people within an indoor space or 200 or more in an exterior open space." TPA filed ">10 days before the event"; min fee $250; +$100/day late. — SUPPORT + new candidate requirement (see RF-6)
- FDNY side: https://www.nyc.gov/site/fdny/business/all-certifications/per-assemblyoccupancy2.page (Public Assembly Permit; fee table starts "Occupancy 75 to 149 — $415.00"). — SUPPORT
- Scenario F note: "roof terraces" appear explicitly in the 75+ indoor class; relevant to the rooftop fixture.

### 7. R1 — SAPO fee schedule by event type

- https://www.nyc.gov/site/cecm/permitting/fees.page ("Fees - CECM"): $25 processing all types; "Block Parties — Application fee only ... Plaza Events — $1,000 to $31,000 ... Street Event - Small — $3,100; Medium — $11,000; Large — $25,000 ... Street Festival — 20% of the total fees paid by vendors". — SUPPORT (a published per-type schedule exists; the "varies" display can become concrete)
- https://codelibrary.amlegal.com/codes/newyorkcity/latest/NYCrules/0-0-0-84731 (50 RCNY §1-08): codified fee + deadline table matching the CECM page. — SUPPORT
- Lead times (same FAQ page as item 4): per-type deadlines, 10 days to prior-year Dec 31. — CONTRADICT for a universal "~60 days" (see RF-2)

### 8. R5 — TUA trigger reconciliation

- Any-sale trigger, three pages: https://www.nycgovparks.org/permits/special-events/vendors ("In order to sell anything on parkland, you'll need a Temporary Use Authorization"), .../guide (TUA needed to sell food/beverages and for merchandise fundraising; Revenue Division (212) 360-1397), .../large-events ("all events where food, merchandise, or other items are sold onsite require a Temporary Use Authorization (TUA)"). — SUPPORT (any-vending version)
- 500+ version, one page: https://www.nycgovparks.org/permits/special-events/faq ("If you want to sell items (food or materials) at an event with attendance over 500 people, you **may** need a Temporary Use Authorization"). — SUPPORT (hedged; only source tying TUA to 500)
- Triage read: three unhedged pages vs. one hedged FAQ favors the any-vending trigger (as encoded); Dev 4 should confirm with the Revenue Division. Bonus facts: TUA info due "at least two weeks prior"; fee "as low as $50 per vendor ... will not exceed $150 per vendor" (2026). Unextracted candidate: https://www.nycgovparks.org/pagefiles/76/TUA-FAQ.pdf

### 9. Portal URLs

- SAPO E-Apply: https://www.nyc.gov/site/cecm/e-apply/e-apply.page → live portal at **https://nyceventpermits.nyc.gov/cems/Login** ("E-Apply - Login"; $25 fee text). Note: `/sapo/` path 404s; the login page shows stale 2021 COVID copy. — SUPPORT
- Parks: **https://nyceventpermits.nyc.gov/parks** confirmed live ("Special Events Permits : NYC Parks", login + "Request a Permit"), linked from https://portal.311.nyc.gov/article/?kanumber=KA-02071. — SUPPORT (matches the rules file's URL)
- FDNY Business: https://www.nyc.gov/site/fdny/business/support/fdny-business.page ("All services must now be filed online") → portal at **https://fires.fdnycloud.org/CitizenAccess/Default.aspx** (Accela; JS-heavy). — SUPPORT
- DOHMH application path: permit pages found (item 3); a single online application entry point was not identified. — remaining gap for Dev 4.
- NYPD sound (bonus): https://www.nyc.gov/site/nypd/services/law-enforcement/permits-licenses-permits.page: "filed at the precinct where the device is to be used no less than five days before the event. There is a $45 fee, payable by certified check or money order." + application form PDF https://www.nyc.gov/assets/nypd/downloads/pdf/form_sounddevice.pdf. — SUPPORT for R3's encoding (nuance: $45 is the first day; +$5/day up to 4 more, Admin Code §10-108(h))

### 10. A2 — Sound permit on private property

- https://codelibrary.amlegal.com/codes/newyorkcity/latest/NYCadmin/0-0-0-6027 (Admin Code §10-108): permit trigger is use "in, on, near or adjacent to any public street, park or place"; §10-108(b)(3) extends it to sound projected outside a building or through openings onto the street. — SUPPORT for fully-indoor events; CONTRADICT for a flat "private property" exemption (see RF-5)
- Noise code applies regardless: §24-244 (https://codelibrary.amlegal.com/codes/newyorkcity/latest/NYCadmin/0-0-0-209196, "no person shall operate ... any sound reproduction device in such a manner as to create unreasonable noise") and §24-231 commercial music 42 dB(A) inside receiving dwellings (0-0-0-209184). — SUPPORT (advisory's noise-code half)

### 11. R2 — Site diagram + core Parks claims

- Core claims all supported verbatim at https://www.nycgovparks.org/permits/special-events/faq: "required for events/activities where twenty or more people will be present"; "$25.00 nonrefundable administrative processing fee, and permits require at least 30 days for processing"; "We do not accept applications submitted inside the 21 day threshold." — SUPPORT (R2's VERIFIED facts re-confirmed with quotable text)
- Site diagram: .../basic-events: "Depending upon the scale of the event, you **may** be asked for ... a site map." .../large-events: 500+ events "typically require ... a preliminary site map." — the universal-requirement reading is CONTRADICTED; conditional/scale-dependent is what primary text supports. Rules-file wording should become "site map may be requested (scale-dependent)" once Dev 4 confirms.

---

## Round 2 — 2026-07-22 (verification of the external rules-v1 critique)

A second fetch-confirmed pass run to verify the external (Codex) assessment of ruleset v1. Same method and caveats as Round 1. These findings are the evidence basis for `rules/nyc-rules.v2.8.json`.

### Confirmed (quote on file, URL fetched)

1. **SAPO street-event deadline mapping**: Small = 14 days / Medium = 30 / Large = 45 / Extra Large = up to 60 ("depends on plaza levels"), stated explicitly on `nyc.gov/site/cecm/permitting/permit-types/street-events.page` AND `nyc.gov/site/cecm/permitting/permit-deadlines.page`.
2. **SAPO trigger definition**: 50 RCNY §1-01 (2026 SAPO rules PDF, nyc.gov-hosted): "street event" = activity that "will interfere with or obstruct the regular use" of street/curb/sidewalk; §1-03(a) requires the permit for any defined event.
3. **Plaza deadlines by level** (`permit-deadlines.page`, `plaza-fees.page`): Level A 45 (60 if multiple plaza blocks) · B 30 (45 multi) · C 30 · D 14 · Extra Large up to 60.
4. **Open Culture**: 15 days (`open-culture.page` + deadlines page).
5. **Single Block Festival OFFICIAL CONFLICT**: `single-block-festivals.page` + deadlines page say 90 days; the CECM FAQ says December 31 of the preceding year. Both live.
6. **Block party** (`block-parties.page`): community-sponsored public event, "no sales of goods or services"; "Alcohol, vendors, commercial branding and sponsorships are not permitted"; applicant "must be a member of a block association and given permission by their neighbors"; 60-day deadline. Community-board recommendation per SAPO rules §1-04(h).
7. **DOB structure triggers** (`support/department-of-buildings.page`): stage/press platform/scaffolding "exceeds two feet in height and covers an area of 120 square feet or more"; "prop or a truss ... higher than 10 feet"; tent/canopy > 400 gross sq ft; 30-days-or-more duration; TPA 75 indoor / 200 outdoor. Separate CECM permit-type pages add "tents, canopies, stage platforms, bleachers, or inflatables over 10 feet tall require a permit from the Department of Buildings."
8. **Parks threshold OFFICIAL CONFLICT**: portal (`nyceventpermits.nyc.gov/parks`): "We require a permit for any event with more than 20 attendees"; NYC311 KA-02071: "more than 20 people"; Parks FAQ: "twenty or more people." Exactly 20 is ambiguous.
9. **DOHMH organizer/sponsor obligations** (sponsor-guidelines PDF `temp-vendors.pdf` + DOHMH temporary-events page): "At least 30 days prior to the event, the event sponsor/organizer must submit to the DOHMH" a participating-vendor list with TFSE permit numbers/expirations/food types; private property requires "a signed contract with the property owner." A wholesale omission in ruleset v1.
10. **Generator/battery/DEP thresholds** (CECM FDNY page + CECM DEP page + Parks guide): FDNY permit for portable generators with aggregate fuel storage "exceeding two and half gallons of gasoline and/or 10 gallons of diesel"; "outdoor battery systems with an aggregate rated energy capacity exceeding 20 kWh"; DEP: "generator that is 40KW or greater ... required to register" (registration, inclusive threshold).
11. **SLA Catering Permit requires food** (`sla.ny.gov/permits-available-online`, WebFetch-relayed): "The applicant must provide food ... Pretzels and potato chips do not meet minimum requirements."

### Contradicted / corrected against the critique

12. **R5 (TUA)**: the critique's "incorrect as a universal rule" verdict is one-sided. Re-fetched 2026-07-22: `.../vendors`: "In order to sell anything on parkland, you'll need a Temporary Use Authorization" (no attendance qualifier); `.../guide`: TUA needed to sell food/beverages and for merchandise fundraising. Only the FAQ hedges with 500+. Encode as OFFICIAL_CONFLICT leaning any-sale, not as 500+-only.
13. **Authority hierarchy as stated in the critique** ("primary source → engine result → test expectation") is mis-ordered; fixtures must outrank engine output. Correct order: primary source → published rule → approved fixture → engine output → UI copy.

### Still unresolved (carried into v2.1 as RESEARCH_REQUIRED / OFFICIAL_CONFLICT)

- FDNY fuel/open-flame/generator lead times: no published universal lead located in either pass (the v1 "45–60 days" citation to the Parks special-event guide was not specifically re-checked; one targeted look pending).
- Parks→NYPD sound sequencing: Parks permission precedes the NYPD pursuit; a strict issued-before-filed rule has no located primary text.
- SAPO street-event size _criteria_ (what makes an event Small vs Medium vs Large) are not defined on the fetched pages; only the deadline/fee mapping per size label is.
- TPA lead wording: DOB code notes say "earlier than 10 days"; the critique says "10 business days." Pin down before UI copy.
- Exact SAPO insurance certificate-holder wording per class.

## Round 3 — 2026-07-24 (full CECM fee schedule capture)

**Purpose:** complete transcription of the CECM fee table, expanding Round 1 item 7 (which quoted only a partial set). **This is fetched evidence, not a status promotion.** No `verification` block or answer-key status changes on the basis of this capture.

**Method:** `https://www.nyc.gov/site/cecm/permitting/fees.page` ("Fees - CECM"), retrieved 2026-07-24 with a browser user-agent (plain fetch returns HTTP 403). The page shows **no "last updated" date**; treat the retrieval date as the as-of date and re-check before demo.

**Verbatim intro:** "All applicants are required to pay a non-refundable processing fee of $25." / "Additional fees occur for Farmers Markets, Production Events, Plaza Events and Street Events. Single Block Festivals and Street Festivals have fees determined by the vendor's participation fee."

**Full "Street Activity Permit Fees" table (Event Type — Fee — Notes), verbatim:**

| Event Type                                          | Fee                                                  | Notes                                                          |
| --------------------------------------------------- | ---------------------------------------------------- | -------------------------------------------------------------- |
| Block Parties                                       | Application fee only                                 |                                                                |
| Clean Ups                                           | Application fee only                                 |                                                                |
| Farmers Markets                                     | $15 per day                                          |                                                                |
| Health Fairs                                        | Application fee only                                 |                                                                |
| Plaza Events                                        | $1,000 to $31,000                                    | Fees based on Plaza Level and Event Size (see Plaza Fees page) |
| Press Conference, Rally or Stationary Demonstration | Application fee only                                 |                                                                |
| Production Events (with curb lane or sidewalk only) | $290 per day                                         | Capped at $1,000 if over 3 days                                |
| Production Events (with curb lane and sidewalk)     | $700 per day                                         |                                                                |
| Street Event - Small                                | $3,100                                               |                                                                |
| Street Event - Medium                               | $11,000                                              |                                                                |
| Street Event - Large                                | $25,000                                              |                                                                |
| Extra Large Event                                   | Up to $66,000                                        |                                                                |
| Single Block Festival                               | 20% of the total fees paid by vendors to participate |                                                                |
| Street Festival                                     | 20% of the total fees paid by vendors to participate |                                                                |
| Open Culture Event                                  | Application fee only                                 |                                                                |

**Findings for rule authoring (candidate, not promoted):**

- **Application-fee-only types** (the $25 processing fee is the entire charge, no additional fee): Block Parties, Clean Ups, Health Fairs, Press Conference/Rally/Stationary Demonstration, Open Culture Event. Distinct from `SAPO-SCOPE-001` (no permit and therefore no $25 at all): these are real permits that happen to carry no fee beyond the application fee.
- **Farmers Markets is its own event-type category** on this schedule ($15 per day), listed alongside Street Events / Block Parties, not as a Street Event size. Ruleset v2.1 does not model it separately; it currently folds into `other_sapo_class`. Breaking it out is a candidate for the post-capstone 59-rule set, sourced here.
- Cross-check on file: 50 RCNY §1-08 (codelibrary.amlegal.com) codifies a matching fee/deadline table (Round 1 item 7). Both were fetched; align any concrete fee added to a rule against both.

## Round 4 — 2026-07-24 (agency attribution for the 13 rules missing `output.agency`, issue #77)

**Purpose:** locate published agency attribution for the 13 published rules/advisories whose `output.agency` is absent, so issue #77 can be decided against fetched text rather than inference. **This is fetched evidence, not a status promotion.** No `verification` block, `output.agency` value, or answer-key entry is changed here.

**Method:** four pages retrieved 2026-07-24 with a browser user-agent (nyc.gov and nycgovparks.org return HTTP 403 to plain fetchers). None of the four shows a "last updated" date; treat the retrieval date as the as-of date.

- `https://www.nyc.gov/site/cecm/support/supporting-permitting-agencies.page` ("Supporting Permitting Agencies")
- `https://www.nyc.gov/site/cecm/permitting/permit-types/block-parties.page` ("Block Parties - CECM")
- `https://www.nycgovparks.org/permits/special-events/faq` and `/guide` (NYC Parks special events)
- `https://portal.311.nyc.gov/article/?kanumber=KA-02228` ("Barbecuing - NYC311", already on file from Round 1)

**Primary find: CECM publishes its own agency-to-requirement map.** The Supporting Permitting Agencies page attributes each supporting requirement to a named agency, verbatim:

- **DOB** — "You must obtain a DOB permit if you intend to build a stage over two feet tall or erect a temporary structure over 10 feet tall. Also if your event expects 200 or more people to gather in a tent outdoors, then you must also obtain a DOB Temporary Place of Assembly permit. **If your event has a ride or inflatable, you must provide a DOB Inspection Certificate and insurance.**"
- **DEP** — "If you are interested using a fire hydrant or a generator over 40kw for your event, you must obtain a permit from the Department of Environmental Protection."
- **FDNY** — "When your event uses dangerous flammable materials such as fuel, generators, or pyrotechnics, you must obtain a permit from FDNY."
- **DOHMH** — "If your event will serve food or will have petting zoos, pony rides, and other animal exhibits, a permit from DOHMH is required."
- **NYPD** — "When using amplified sound for a musical performance or speaking program, you will also need to obtain a sound permit from the NYPD."
- **SLA** — "If your event includes selling or distributing alcohol, you must have a special event permit from The New York State Liquor Authority SLA."
- Also named, not currently modeled in v2.1: **DCWP** (games of chance), **DSNY** (no permits issued; billed for post-event cleanup), **DOT** (oversized trucks, cranes, electrical wiring, horse drawn carriages, banners), **HRA** (soliciting charitable funds; nonprofit street-fair vendors), **SDOH** (New York State Department of Health, "peak attendance will reach 5,000 attendees").

**Per-rule attribution located (candidate, not promoted):**

| Rule                                  | Published text located                                                                                                                                                                                                                                                                                                                                                                                         | Candidate agency                                                                                         |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `SAPO-BLOCK-PARTY-ELIG-001`           | Block Parties: "A block party is a community sponsored, public event where there are no sales of goods or services"; "Alcohol, vendors, commercial branding and sponsorships are not permitted at block parties"                                                                                                                                                                                               | SAPO (Mayor's Office CECM)                                                                               |
| `SAPO-BLOCK-PARTY-SPONSOR-001`        | Block Parties, verbatim: "Applicants must be a member of a block association and given permission by their neighbors"                                                                                                                                                                                                                                                                                          | SAPO (Mayor's Office CECM)                                                                               |
| `SAPO-INSURANCE-BLOCK-PARTY-RIDE-001` | Block Parties: "Rides and inflatables, such as truck mounted rides and bounce houses require a DOB Inspection Certificate and insurance. The ride company that you hire should provide this documentation." Supporting Agencies repeats the DOB certificate. The insurance condition attaches to the SAPO permit ("All other agency permits must be obtained before we can grant your street activity permit") | SAPO (Mayor's Office CECM) imposes the insurance; the certificate is DOB's — see the coverage note below |
| `NYPD-SOUND-PARKS-DEP-001`            | Parks FAQ: "there are restrictions on where and when we can grant permission to apply for amplified Sound Permits with the NYPD." Parks guide: "you will need to get a Sound Permit from the New York City Police Department (NYPD) in person at the local precinct"                                                                                                                                           | NYC Parks (the action this finding directs; the NYPD filing is already carried by `NYPD-SOUND-001`)      |
| `PARKS-INSURANCE-NOTE-001`            | Parks FAQ, verbatim: "Not necessarily, the borough permit offices will let you know if insurance or a bond is required for your event"                                                                                                                                                                                                                                                                         | NYC Parks                                                                                                |
| `PARKS-PROPANE-001`                   | NYC311 KA-02228: "Barbecuing is only allowed in designated areas of certain City parks... Propane grills are prohibited." "The Department of Parks and Recreation has designated areas for barbecuing in certain parks and beaches"                                                                                                                                                                            | NYC Parks                                                                                                |
| `DOHMH-EXEMPTION-001`                 | Health Code Art. 88 is DOHMH's own code (already on file, Round 1 §3); the exemption is DOHMH's to apply                                                                                                                                                                                                                                                                                                       | DOHMH                                                                                                    |
| `SLA-VENUE-LICENSE-001`               | On-premises licensing is SLA's; matches the string already used by `SLA-ONEDAY-001` / `SLA-CATERING-001`                                                                                                                                                                                                                                                                                                       | NY State Liquor Authority                                                                                |
| `ADV-VENUE-OCCUPANCY-001`             | Certificate of occupancy / legal use is DOB-issued (Supporting Agencies, DOB entry)                                                                                                                                                                                                                                                                                                                            | DOB                                                                                                      |
| `SAPO-SCOPE-001`                      | Rule's own note text directs "confirm scope with SAPO for borderline setups"                                                                                                                                                                                                                                                                                                                                   | SAPO (Mayor's Office CECM), if a `classification` finding carries one at all                             |
| `ADV-SAPO-OTHER-CLASS-001`            | Advisory's own text directs "Confirm with SAPO"                                                                                                                                                                                                                                                                                                                                                                | SAPO (Mayor's Office CECM), if a COVERAGE_GAP advisory carries one at all                                |

**No single agency located (2 of 13):**

- `ADV-NOISE-CODE-001` — DEP and NYPD share Noise Code enforcement (DEP primary for commercial and vehicle noise, NYPD for residential and by-ear complaints). The advisory directs no filing, so no acting agency is named. Not located: any published text assigning a single agency to §24-244 / §24-231 compliance for events.
- `ADV-ALCOHOL-PUBLIC-001` — COVERAGE_GAP whose own text says "Confirm with the relevant agency" precisely because the path was not evaluated. Naming an agency would assert coverage this ruleset version does not have.

**Notes for rule authoring (candidate, not promoted):**

- **Possible missing DOB rule.** The DOB Inspection Certificate for rides and inflatables is published as a requirement in its own right on two CECM pages, but v2.1 mentions it only inside `SAPO-INSURANCE-BLOCK-PARTY-RIDE-001`'s note text. There is no DOB ride/inflatable rule alongside `DOB-TENT-001` / `DOB-STAGE-001` / `DOB-PROP-TRUSS-001` / `DOB-TALL-STRUCTURE-001` / `DOB-ASSEMBLY-001`. Candidate new rule for the team; adding one is an answer-key change (Scenario D has a ride).
- **`SAPO-INSURANCE-001` carries prose, not an agency.** Its current value is `Requirement attached to SAPO permits (50 RCNY §1-08(b))`. If `agency` is rendered as a label, that value will not read like the others (`DOB`, `FDNY`, `NYPD`). Normalizing it is a display decision, not a regulatory one; the citation belongs in `source`, which already holds it.
- **Agency vocabulary in use**, for anyone adding values: `SAPO (Mayor's Office CECM)`, `DOB`, `DOB (+ FDNY Public Assembly Permit)`, `FDNY`, `NYC Parks`, `NYC Parks Revenue Division`, `DOHMH`, `NYPD`, `NYC DEP`, `NY State Liquor Authority`.
- Four agencies named by CECM are unmodeled in v2.1 (DCWP, DOT, HRA, SDOH). The SDOH 5,000-attendee threshold in particular has no corresponding rule and no intake field. Candidates for the post-capstone 59-rule set, sourced here.

## Round 5 — 2026-07-26 (does a published agency closure stop that agency's filing counter? DOB and SLA — SPEC-CONFLICT #130)

**Purpose:** `OPEN-QUESTIONS.md` §2 item R-10 (holiday-calendar source for `us-ny-business-days@2026`), and the prior question R-10 turns on — whether any published source defines "business day" for a DOB or SLA filing lead. Recorded so the reasoning in `apps/api/src/calendar.ts` rests on a dossier entry rather than on a doc comment alone. **Nothing here is a verification and nothing is promoted.** `PUBLISHED_HOLIDAY_CALENDARS` stays empty, the four business-day rules keep rendering NOT_CALCULABLE, and no holiday date is published by this round.

**Note on a gap this closes.** Neither pass below was in this dossier before 2026-07-26, though R-10 has been in scope since Round 1: the research lived only in the `calendar.ts` doc comment across PR #129 (`d692e24`, `8a5bd4a`, `44e25b8`) and PR #133. That was the pre-existing state, not something either PR introduced, and this entry is where it stops being true.

**The question, unchanged since Round 4's successor pass:** does an agency's published closure stop that agency's _filing_ counter? Every candidate holiday list depends on it. Pass A compared staff schedules and statutes; it did not fetch a DOB or SLA closure source. Pass B assessed DOB's TUP path against a DOB closure source. For SLA's One-Day Alcohol Event and Catering Permit paths, Pass B examined permit and statutory-holiday sources but no SLA-published closure source. Neither pass assessed DOB's separate TPA path.

**Outcome:** DOB TUP — NOT PUBLISHED from the Pass B source set, fetched below. Pass A establishes only the staff-schedule/statute gap and is not an independent DOB-closure assessment. SLA statutory-holiday sources — no counter connection published; SLA agency-closure question — NOT ASSESSED. DOB TPA — NOT ASSESSED.

**Pass A** (PR #129) — the city Office of Payroll Administration holiday list, the state Civil Service pass-day treatment, DCAS PSB 440-2, the federal OPM schedule, General Construction Law §24 and §25-a, and Public Officers Law §62. Result: staff-holiday divergence established; the filing-counter link not established. Two leads left open (GCL §25-a, POL §62) and recorded as leads in `calendar.ts`, not as answers.

**Pass B** (2026-07-26, this round) — a pass over the DOB TUP page, the DOB closure calendar, ABC Law §97 and §98, and 9 NYCRR Part 29. DOB TUP result: NOT PUBLISHED. For SLA, the pass examined permit and statutory sources but no SLA-published closure source, so it did not assess the agency-closure question. **Auditing caveat, stated because it bounds what this pass is worth:** pass B's own retrievals were reported to this round, not re-fetched here, and no quoted text or retrieval metadata was carried over for the closure calendar, ABC §97/§98 or 9 NYCRR Part 29. Those four are therefore an _uncorroborated reported result_, not fetched evidence on file. Anyone promoting anything on the strength of pass B must fetch them first. They are named rather than omitted so that whoever retrieves them knows where to start, but under this dossier's own method rule above — "unfetched links were excluded" — they are not eligible to be cited as evidence, and this entry does not cite them as such. Pass B also treated POL §62 as a general lead; `calendar.ts` keeps the narrower statement, that §62 reaches state and county offices but not DOB, a city agency.

**Fetched first-hand in this round (quote on file, URL retrieved 2026-07-26 with a browser user-agent):**

- `https://www.nyc.gov/assets/buildings/codes-pdf/cons_codes_2022/2022BC_Chapter33_Con_DemoSafetyWBwm.pdf` — DOB's own published Building Code Chapter 33, as amended by Local Law 77 of 2023. The amlegal mirror of §3306.3.1 (`codelibrary.amlegal.com/codes/newyorkcity/latest/NYCadmin/0-0-0-185903`) carries the same section but returns HTTP 403 to automated retrieval, so the DOB PDF is the copy on file.
- `https://www.nyc.gov/site/buildings/industry/tup.page` — the Temporary Use Permit page.
- `https://www.nyc.gov/assets/buildings/pdf/tup-formchecklist.pdf` — the TUP intake form and checklist.
- `https://www.nyc.gov/assets/buildings/pdf/tup-sn.pdf` — the TUP service notice.

**What Chapter 33 publishes, verbatim.** DOB publishes an explicit weekend-and-holiday rule for a backward-counted notice in three places, each attached to a 24-48 hour notice counted back from a commencement date:

| Section     | Notice                                        | Published weekend/holiday rule                                                                                                                                                                                                                                                               |
| ----------- | --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| §3306.3.1   | Demolition, notice to the department          | "If the notification date falls on a weekend or official holiday, the permit holder shall notify the department on the last business day before the commencement date."                                                                                                                      |
| §3304.3.1   | Soil and foundation work                      | "Should the notification date fall on a weekend or official holiday, the permit holder ... shall notify the department on the last business day before the commencement date." Its cancellation notice rolls the other way, to "the next business day after the intended commencement date." |
| §3314.4.1.5 | Adjustable suspended scaffold install/removal | "Should the notification date fall on a weekend or official holiday, the notification shall be made on the last business day before the commencement date of the installation or removal."                                                                                                   |

**What the TUP materials publish, per source.** Stated separately because they do not say the same things, and an earlier version of this entry wrongly attributed the lead to all three at once (corrected 2026-07-26, PR #133 review):

| Source                                                  | States the 15-business-day lead?                                                                                                                                                | Defines "business day"? | Weekend/holiday rule? | Cross-refs §3306.3.1, §3304.3.1 or §3314.4.1.5? |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- | --------------------- | ----------------------------------------------- |
| TUP page (`tup.page`)                                   | Yes, verbatim: an RDP must email the application "no later than 15 business days prior to the construction of the temporary structure or the commencement of the temporary use" | No                      | No                    | No                                              |
| TUP service notice (`tup-sn.pdf`)                       | Yes, same phrasing: "no later than 15 business days prior to the construction of the"                                                                                           | No                      | No                    | No                                              |
| TUP intake form and checklist (`tup-formchecklist.pdf`) | **No — it states no lead time at all.** It is a document checklist plus fees and submission mechanics                                                                           | No                      | No                    | No                                              |

The checklist's text extracts cleanly (2,141 characters, not a scanned image) and contains no instance of "business day", "holiday", "weekend", "prior", or any figure other than the fee and duration amounts. So the deadline itself is substantiated by two of the three artifacts, the page and the service notice; the checklist neither states nor qualifies it.

**Candidate assessment (NOT ADDRESS, for triage only):** none of the three Chapter 33 sections addresses the TUP filing lead. Each governs a different notification, each is counted in clock hours rather than business days, and the TUP materials incorporate none of them. Chapter 33 uses "business day" in all three rules and never defines it, so it does not close the definitional gap either. **What the omission means is not established:** no located source speaks to whether the TUP silence was considered or simply never addressed, and the clock-hour framing of all three analogues is a complete innocent explanation on its own. An earlier draft of the `calendar.ts` comment called the omission a "deliberate silence"; that inferred agency intent from absent text and was withdrawn in review of PR #133. What the evidence does establish is narrower and still useful: DOB has a published practice of writing such rules, so the TUP omission is not explained by DOB lacking a mechanism for one.

### Follow-up — 2026-07-27 (named leads and Pass B retrievals)

**Question:** for a filing lead counted in business days, does a given agency's published closure stop that agency's filing counter? DOB and SLA are separate. This follow-up assesses DOB's 15-business-day TUP path against a fetched DOB closure source. For SLA's 15-business-day One-Day Alcohol Event and Catering Permit paths, it fetches permit and statutory-holiday sources but no SLA-published closure source. It does not assess DOB-ASSEMBLY-001's separate 10-business-day TPA path and did not collect or assess another holiday-date list.

**Outcome:** DOB TUP — **NOT PUBLISHED**: the fetched DOB closure source is not connected to the TUP counter. SLA statutory-holiday sources — **NOT PUBLISHED**: none connects the statutory treatment to either permit counter. SLA agency-closure question — **NOT ASSESSED**: no SLA-published closure source was fetched. DOB TPA — **NOT ASSESSED**.

**GCL §25-a lead — fetched 2026-07-27:**

- `https://www.nysenate.gov/legislation/laws/GCN/25-A` (retrieved 2026-07-27) — the statute reaches a period "within which or after which or before which an act is authorized or required to be done" and permits the act on the next succeeding business day when that period ends on a Saturday, Sunday, or public holiday.
- `https://www.nysenate.gov/legislation/laws/GCN/110` (retrieved 2026-07-27) — "This chapter is applicable to every statute" unless its object, context, or other provisions require a different application.
- `https://www.nycourts.gov/Reporter/3dseries/2022/2022_22226.htm` (retrieved 2026-07-27) — in _208 W 20th St. LLC v Blanchard_, the court addressed a filing governed both by a terminal three-day filing period and by a separate requirement that service occur "at least ten and not more than seventeen days before" the appearance. The court states that the filing was timely when §25-a was applied, but dismissed because the petitioner "did not strictly comply with the requirements of RPAPL 733 (1)." The opinion also describes the First Department's _Berkeley_ result: §25-a made the terminal filing timely, but did not cure the resulting short minimum-notice period.
- `https://www.nycourts.gov/Reporter/3dseries/2025/2025_25084.htm` (retrieved 2026-07-27) — in _Matter of AMH Resources Corp v French_, a later court considering the same backward-counted notice scheme found that "service of the notice and petition was effected at least 10 days before" the return date; it treated the later affidavit filing as a non-prejudicial procedural defect under CPLR 2001 and remitted the matter.

**What the §25-a lead establishes:** §25-a can govern the day on which a filing act is timely even when that filing sits inside a separate backward-counted minimum-notice scheme. The fetched cases do not state that a holiday or agency closure inside a minimum-notice period is omitted from that period's count. Neither case concerns DOB, SLA, TUP, a one-day alcohol permit, a catering permit, or a lead expressed in business days.

**DOB Pass B sources — re-fetched 2026-07-27:**

- `https://www.nyc.gov/site/buildings/industry/tup.page` (retrieved 2026-07-27) — "email the completed form ... no later than 15 business days prior" to construction of the temporary structure or commencement of the temporary use. The page does not define "business day" or mention the closure page.
- `https://www.nyc.gov/site/buildings/dob/holidays-office-closings.page` (retrieved 2026-07-27) — "The Department of Buildings will be closed on the following dates." The page does not mention TUP, filing deadlines, or business-day computation.

**DOB result:** the TUP page establishes the filing lead and the closure page establishes that DOB closes. Neither source connects the closure page to the TUP counter. The §25-a sources above establish a rule for a terminal filing day in periods governed by statute; they do not state that DOB's published closures are excluded throughout the TUP lead. **NOT PUBLISHED.**

**SLA permit and statutory-holiday sources — re-fetched 2026-07-27:**

- `https://sla.ny.gov/permits-available-online` (retrieved 2026-07-27) — "The application for a One-Day Alcohol Event Permit must be received ... a minimum of 15 business days prior to the event." The page states the same minimum for a Catering Permit. It does not define "business day", identify a holiday calendar, or state a closure rule.
- `https://www.nysenate.gov/legislation/laws/PBO/62` (retrieved 2026-07-27) — for state offices, "Holidays and Saturdays shall be considered as Sunday for all purposes relating to the transaction of business". The only express extension in §62 is for a last filing or performance day that expires on Saturday. The section does not mention SLA, its permits, a backward-counted lead, or an agency-published closure that is not otherwise a holiday under law.
- `https://www.nysenate.gov/legislation/laws/ABC/97` (retrieved 2026-07-27) — §97 authorizes SLA to issue a temporary permit, "effective for a period not to exceed twenty-four consecutive hours". It does not state the 15-business-day filing lead or a closure rule.
- `https://www.nysenate.gov/legislation/laws/ABC/98` (retrieved 2026-07-27) — §98 authorizes a caterer's permit "effective for a period not to exceed twenty-four consecutive hours". It does not state the 15-business-day filing lead or a closure rule.
- `https://www.law.cornell.edu/regulations/new-york/title-9/subtitle-B/chapter-I/subchapter-A/part-29` (retrieved 2026-07-27) — the current quarterly text of 9 NYCRR Part 29 contains §§29.1–29.3: persons eligible, sale and delivery, and functions on licensed premises. Section 29.1 states, "A permit will be issued only to an on-premises liquor, wine or beer licensee"; §§29.2–29.3 govern authorized beverages, duration, delivery, and licensed-premises limits. Part 29 does not state the 15-business-day filing lead or a closure rule. The State's online NYCRR publisher at `https://govt.westlaw.com/nycrr/Browse/Home/NewYork/UnofficialNewYorkCodesRulesandRegulations?guid=I8256f7f0b72a11ddba5e846354f3a78d` exposed the same three-section table of contents to search retrieval but returned HTTP 403 to direct retrieval, so the Cornell quarterly text is the fetched section text on file.
- `https://sla.ny.gov/system/files/documents/2022/12/advisory_2022-36_-_caterers_permits.pdf` (retrieved 2026-07-27) — SLA Advisory 2022-36 says, "The issuance of Caterer's Permits is covered by §98 of the ABC Law and Part 29". Its published guidance addresses eligibility, licensed premises, authorized beverages, and conditions of use; it does not state a holiday or closure rule.

**SLA result:** POL §62 establishes how holidays and Saturdays are treated for transacting business in state offices. It does not define SLA's 15-business-day unit or connect that treatment to either backward count. The permit page, ABC Law §§97–98, current Part 29, and Advisory 2022-36 do not supply that connection. **NOT PUBLISHED for the statutory-holiday source set.** No SLA-published closure source was fetched, so whether an SLA-published closure stops either permit counter is **NOT ASSESSED**.

**Now established:** DOB publishes a TUP filing lead and a DOB closure page; SLA publishes two 15-business-day filing leads; POL §62 governs transaction of business in state offices on holidays and Saturdays; and §25-a has been applied to a terminal filing day in a backward-counted minimum-notice setting without thereby supplying a general rule that internal holidays are removed from the minimum period.

**Not established:** the contents of either agency's filing calendar; a definition of "business day" for any of the three examined rules; that a DOB closure stops the DOB TUP counter; that an SLA closure stops either SLA permit counter; or that an agency's closure list supplies the holidays to which §25-a or POL §62 applies. No SLA-published closure source was fetched. This follow-up also does not establish whether a DOB closure stops DOB-ASSEMBLY-001's separate TPA counter. No rule, calendar, verification status, or spec is promoted by this follow-up.

**What would unblock DOB TUP**, unchanged by this round: a source establishing that DOB's published closure stops the TUP filing counter. Not a better list of dates. **What SLA still needs:** an applicable SLA-published closure source, then a source establishing its effect on the two permit counters. That would not by itself support publishing the shared calendar: DOB-ASSEMBLY-001's TPA path consumes the same calendar and remains outside this follow-up.

## Round 6 — 2026-07-27 (DOB-ASSEMBLY-001 one-off FDNY fee and DOB TPA fee row)

**Purpose:** resolve the two `NOT ESTABLISHED` fee questions in `DOB-ASSEMBLY-001` without changing published ruleset `nyc.v2.8`. This is an evidence-only pass. It does not change a verification status, rule, fixture, or rendered amount. All URLs below were retrieved 2026-07-27.

### Question A — which Appendix A line does FDNY bill for a one-off event?

**Outcome: NOT ESTABLISHED. The current rendering stands:** “FDNY's charge for a one-off event is not published as an amount — confirm with FDNY.”

The current City event guide adds a useful fact but does not name an Appendix A line or dollar amount:

- `https://www.nyc.gov/assets/cecm/downloads/pdf/CECM-Comprehensive-Event-Permitting-Guide-2024_final.pdf` — the FDNY table names a “Temporary Public Assembly Permit” and states “Permit fees based on occupancy.” Its instructions say: “The promoter or sponsor of the event shall make an application for a Fire Department Permit thru the FDNY public portal.” This establishes that the event promoter or sponsor applies and that FDNY describes the fee as occupancy-based. It does **not** state A03.1(4), A03.1(68), `$415`, or `$210 per hour`.
- `https://www.nyc.gov/site/fdny/business/all-certifications/per-assemblyoccupancy2.page` — “To maintain or operate a place of assembly”; “Fee varies based on the number of occupants”; “Not to exceed 1 year.” The page does not distinguish permanent from temporary public assembly fees and states no amount.
- `https://www.nyc.gov/assets/fdny/downloads/pdf/about/appendix-a-2022.pdf` — A03.1 says: “All such fees are per year, except when based on frequency of inspection or hourly rate, as indicated.” Item (4) states “Assembly occupancies (places of assembly)” and “Fire safety inspection/permit (frequency of inspection as required by code or rule),” with “Occupancy 75 to 149” at `$415.00`. Item (68) states “Street fairs and other public gatherings or gathering places,” with “Review of site plan (per hour)” and “Fire safety inspection (per hour)” each at `$210.00`.
- `https://www.nyc.gov/assets/fdny/downloads/pdf/about/chapter-1-2022.pdf` — FC 105.6 states: “A permit is required to establish and operate a place of assembly. The term of such permit shall be for a period not to exceed 1 year.”
- `https://www.nyc.gov/site/buildings/dob/project-categories-paco.page` — DOB states: “The Fire Code has operational requirements for a TPA, also referred to in the Fire Code as a public gathering.”

No retrieved source says that a one-off TPA inspection or permit is billed under A03.1(4), under A03.1(68), or under both. The City guide's “based on occupancy” wording cannot be converted into A03.1(4)'s dollar amount without supplying the missing cross-reference by inference. A03.1(68) remains textually applicable to public gatherings, while DOB expressly uses that term for a TPA. The exact line and amount therefore remain unpublished.

### Question B — which Table 28-112.8 row does DOB NOW bill for a TPA?

**Outcome: the current operational charge is established as `$250` per TPA application; the table-label reconciliation remains NOT ESTABLISHED.** No current source retrieved in this pass says that the same filing also draws the adjacent `$130` certificate charge.

Current operational sources:

- `https://nyc-business.nyc.gov/nycbusiness/description/temporary-place-of-assembly-certificate-of-operation` — “The fee for a TPA is $250.” It also states: “If the event is less than 10 business days away, you must pay an extra $100 per day” and “You pay the fee online through the DOB NOW system by credit card or e-check.”
- `https://www.nyc.gov/assets/buildings/pdf/build_pa_presentation.pdf` — under “Temporary Place of Assembly Filing Fees”: “$250 Fee for each Temporary Place of Assembly application” and “A Late Fee of $100/day is charged for each day the TPA filing fee is late.” This presentation remains linked from DOB's current PA/TPA resources page at `https://www.nyc.gov/site/buildings/industry/dob-now-build-resources-pa.page`.
- `https://www.nyc.gov/assets/cecm/downloads/pdf/CECM-Comprehensive-Event-Permitting-Guide-2024_final.pdf` — “Applicants for a TPA pay a fee of $250. If the event is less than 10 business days away, applicants must pay an additional $100 per day. ... The fee is paid online through the DOB NOW system by credit card or e-check.” Its fee summary separately states: “Temporary Place of Assembly Certificate of Operation carries a minimum fee of $250.”

The statute still uses two labels:

- `https://codelibrary.amlegal.com/codes/newyorkcity/latest/NYCadmin/0-0-0-156729` — Table 28-112.8 lists “Temporary place of assembly certificate of operation” at `$130` filing and `$130` renewal, then “Temporary use letter for place of assembly” at `$250`, with the comment: “Application shall be submitted at least ten work days prior to the event; late fees shall be imposed at $100 for each day following required submission date that the application is received by the department.”

No current 1 RCNY bridge was located:

- `https://www.nyc.gov/assets/buildings/rules/1_RCNY_101-03.pdf` — the current ten-page fee rule contains no “place of assembly,” “temporary place,” or `TPA` entry.
- `https://www.nyc.gov/assets/buildings/rules/1_RCNY_14-04.pdf` — “§14-04 Fees Payable to the Department of Buildings. [REPEALED] Please see Title 28 of the Administrative Code for new provisions.”
- `https://www.nyc.gov/site/buildings/codes/oppn0298.page` is historical only. It said: “When an applicant files for a Temporary Place of Assembly Permit for a Temporary Event, the Borough office will collect a $250.00 fee.” The page is marked “RESCINDED BY BUILDINGS BULLETIN 2017-007.”
- `https://www.nyc.gov/assets/buildings/bldgs_bulletins/bb_2017-007.pdf` says OPPN 2/98 was among notices “no longer applicable under any Code” and that rescinded documents “will not be applicable to any projects after the issuance date of this Bulletin.”

The operational question is therefore answered only to the amount DOB currently publishes and describes as the TPA application fee: `$250`, plus the published late fee when applicable. The retrieved sources do not name the Table 28-112.8 row DOB NOW maps that payment to, and none expressly says whether the `$130` certificate row can never be charged separately. Do not rewrite the statute's labels or claim that a rule reconciles them.

### Future ruleset follow-up flag — not included in v2.10

`DOB-ASSEMBLY-001.output.deadline.qualification` currently cites Table 28-112.8's “at least ten work days prior to the event” comment as one source for the ten-day unit. That comment is on the “Temporary use letter for place of assembly” row, not the “Temporary place of assembly certificate of operation” row. The current operational pages independently publish ten business days for a TPA, but the table attribution should not be presented as belonging to the TPA certificate row unless a source reconciles the labels. Correcting that attribution requires a new immutable rules publication after `nyc.v2.10`; it is deliberately not attempted here.

## Round 7 — 2026-07-29 (shared issue #178 publication)

**Approval record, not a new research pass.** The product owner approved the nine-gate product set, meaning boundary, near-empty predicate/copy, and Scenario B correction. In decision gate `msg_68b1f57ec560`, the same owner separately approved the exact source/status/copy contract as verification owner and rules reviewer, and the exact triggers as verification owner and engine owner. This records one person's approvals in four named capacities; it does not imply independent reviewers.

The same immutable publication carries F-110's approved assembly-document registry replacement and issue #194's approved removal of the organizer-claimed food exception from active intake. Those registry deltas change no rule, trigger, finding, deadline, branch, verdict, source, or verification status; the two F-110 fields are confirmation-only and support no temporary-filing inference, and the removed food claim remains inert in historical replay.

The approved publication reuses only source URLs already published by nyc.v2.8 and the evidence sections named below. It adds no agency, deadline, fee, portal, threshold, exception, or new source:

| Rule                         | Status            | Evidence                                                    |
| ---------------------------- | ----------------- | ----------------------------------------------------------- |
| CONF-NO-FOOD-001             | SOURCE_CONFIRMED  | VS §3 Round 1 + Round2 #9                                   |
| CONF-NO-SALES-001            | OFFICIAL_CONFLICT | VS §8 Round 1 + Round2 #6/#12                               |
| CONF-NO-AMPLIFIED-SOUND-001  | SOURCE_CONFIRMED  | VS §9-10 Round 1 + Round2 unresolved list                   |
| CONF-NO-STRUCTURE-001        | SOURCE_CONFIRMED  | VS §1 Round 1 + Round2 #7                                   |
| CONF-NO-FLAME-001            | SOURCE_CONFIRMED  | VS §2 Round 1                                               |
| CONF-NO-GENERATOR-001        | SOURCE_CONFIRMED  | VS Round2 #10                                               |
| CONF-NO-BATTERY-001          | SOURCE_CONFIRMED  | VS Round2 #10                                               |
| CONF-NO-ALCOHOL-001          | SOURCE_CONFIRMED  | VS §5 Round 1 + Round2 #6/#11 + Round3 unit re-verification |
| CONF-NO-BLOCK-PARTY-RIDE-001 | SOURCE_CONFIRMED  | VS §4 Round 1                                               |

Organizer-visible text and the complete official URL snapshots are published verbatim in `rules/nyc-rules.v2.10.json`; that immutable artifact is the authoritative copy.

## Round 8 — 2026-07-29 (issue #181 citation attribution)

**Purpose:** independently re-check the primary page already cited by `SAPO-BLOCK-PARTY-ELIG-001` before narrowing its citation label to the source URL the artifact carries. This is a publication record, not a verification pass, and it does not promote the rule from SOURCE_CONFIRMED.

- `https://www.nyc.gov/site/cecm/permitting/permit-types/block-parties.page` (retrieved 2026-07-29) publishes both parts of the encoded eligibility rule: a block party has no sales of goods or services, and alcohol, vendors, commercial branding, and sponsorships are prohibited.
- The rule's sole URL already points to that page, while its citation label additionally named the CECM FAQ without carrying a corresponding FAQ URL. nyc.v2.10 drops that redundant, unlinked attribution so the label matches the artifact's source list. This does **not** claim that the FAQ lacked the prohibition: the 2026-07-28 fetch recorded in `docs/proposals/advisory-144-bounded-refetch-results.md` found that the current FAQ carries it, while its historical state remains indeterminable. The URL, rule, output, status, and evidence reference do not change.

## Suggested Dev 4 Workflow

1. Triage the red flags (RF-1, RF-2 first: they touch Scenario E and the demo anchor). Anything that changes an expected scenario output is an answer-key change and needs a team decision, not a quiet edit.
2. For each item: open the candidate URL in a browser, confirm the quote, then publish a new immutable ruleset version from the current artifact named in `BASELINE.md`; never edit the published file in place. Only Dev 4 updates the fact's `verification` metadata: set `status`, set `last_verified_date` when the verification date is evidenced, and update `qualification` or `evidence` when the checked record requires it. The v2 schema has no `facet`, `todos`, or `status_verbatim` fields. Source metadata is separate: update `source.citation` and `source.urls` in the same new artifact when the confirmed attribution changes; never put a URL in `verification`.
3. Where this dossier found concrete values the rules file displays as "varies" (SAPO fee table, TFSE $70, Open Flame $210, TPA $250, SLA $36/$48), adding them is a rules-data change with the fetched URL as source — after confirmation, never from this dossier alone.
4. Log every check: URL + date checked, per the answer key's method. Unresolvable → keep "confirm with agency."
