# PopEngine — PRD (Canonical Single Source of Truth)

**Build name:** PopEngine
**Owner:** Naquan McKune, Jason Zeng, Adedoyin Ahoton, Bo Moldenhauer
**Date:** July 21, 2026
**Status:** APPROVED 2026-07-22 against nyc.v2.1; pointer retargeted to nyc.v2.5 on 2026-07-25, to nyc.v2.6 on 2026-07-25, and to nyc.v2.7 on 2026-07-26, none with a regulatory change; retargeted to nyc.v2.8 on 2026-07-26, which DOES carry a regulatory change — DOB-ASSEMBLY-001's TPA filing lead is corrected to ten BUSINESS days on an inclusive bound against two primary sources; F-109's concept renamed from "coverage states" to "scope support states" 2026-07-26, product-owner approved, resolving a three-way overload of "coverage" (its five state values are unchanged) (see `docs/BASELINE.md`); the COVERAGE_GAP clause is amended 2026-07-27 under `docs/DOCUMENTATION-GOVERNANCE.md` §2 against the published legend, and is approved under §6 ("Regulatory source/status/content") by the product owner acting as verification owner and rules reviewer. ONE person signed in THREE capacities, all lanes being currently held by one person. §6 states two things about that, and the first is unconditional: "No person approves their own regulatory publication alone. The author and source reviewer should be distinct whenever the team size permits." The first sentence does not bite here because there is no regulatory publication to approve: the amendment asserts no new regulatory fact, changes no rule, trigger, threshold, deadline or verification status, and conforms a lower-authority artifact to the legend already published in `rules/nyc-rules.v2.8.json` under §2's authority hierarchy. The second sentence is the one that applies, and its "whenever the team size permits" is what a single-person team cannot satisfy. Recorded so the sole-approver fact is visible rather than implied. F-204 portal scope reduced to published `output.portal` fields 2026-07-27, product-owner approved, resolving SPEC-CONFLICT #149. All earlier phases of this PRD are superseded in full by this document.
**Scope of this document:** the full product vision. The iron-clad MVP (permit planning) carries detailed, demo-observable requirements; everything else is planned scope, phased in `ROADMAP.md`. Completing the full vision by the capstone demo is explicitly not a commitment.
**Issue #127 amendment (2026-07-29):** F-203 retains alert escalations, digests, team reminders, and per-user preferences as planned, unscheduled Phase 2 depth. Item 2 remains resolved by dropping standalone Square/POS integration scope while F-408 keeps only its inventory webhook.
**Issue #107 amendment (2026-07-29):** retargeted to nyc.v2.9, which publishes nine approved named confirmations and the disposition-based near-empty contract. Product owner, verification owner, rules reviewer, and engine owner approval are recorded in `docs/BASELINE.md`.
**Issue #181 amendment (2026-07-29):** retargeted to nyc.v2.10, which narrows SAPO-BLOCK-PARTY-ELIG-001's citation label to the CECM block-parties page already carried as its sole source URL. It drops a redundant, unlinked FAQ attribution without claiming the FAQ lacked the prohibition. No source URL, rule behavior, verification status, fixture output, or verdict changes.
**Companion docs:** `BASELINE.md` (current artifact versions) · `ROADMAP.md` (phases + features) · `DESIGN.md` (lanes, gates, demo plan) · `ARCHITECTURE.md` (technical design) · `ARCHITECTURE-FUTURE.md` (Phase 2+ target) · `test-scenario-answer-key.md` (scenario fixtures v7) · `rules/nyc-rules.v2.10.json` (published ruleset).
**Permit facts:** every permit fact traces to `rules/nyc-rules.v2.10.json`, whose facts carry evidence references to fetch-confirmed quotes in `VERIFICATION-SOURCES.md`. Verification statuses (SOURCE_CONFIRMED / OFFICIAL_CONFLICT / RESEARCH_REQUIRED / COVERAGE_GAP) render honestly in-product. No permit fact is ever invented.

---

## 1. PROBLEM

Independent pop-up and event organizers in New York City must navigate a permit maze spread across at least seven agencies (SAPO, NYC Parks, NYPD for sound and crowd control, DOT, FDNY, DOB, and the Health Department), each with its own portal, lead time, fees, and requirements. A single activation touching a sidewalk, serving food, and playing music can require four separate permits with lead times ranging from 5 days to more than a year ahead (street festival applications close on December 31 of the preceding year), and no system tells the organizer which permits apply or whether their timeline is even feasible. Organizers discover missing permits late, causing cancellations, fines, or events pushed months out.

### Supporting Context

- Reporting from THE CITY (March 2026) documents organizers pressuring City Hall to simplify the process: thousands of groups stage events in public space yearly, and organizers with a decade of experience describe the system as a maze with no clear starting point. _(thecity.nyc, 2026-03-10)_
- The process is structurally fragmented: DOT Open Streets applications run through Survey123 while SAPO, NYPD, Parks, and Media & Entertainment use E-Apply. A civic proposal (Neighborhood Commons) formally asks the city to unify them, which has not happened. _(neighborhoodcommons.nyc)_
- Real lead-time spread, per official sources: SAPO deadlines run 14–60 days depending on event class and size (festival classes close the prior December 31); Parks special event permits (20+ guests) carry a 21-day hard floor and 21–30-day processing; NYPD precinct sound permits need 5+ days; liquor permits require 15 business days; large tents, stages, open flame, generators, and public food each trigger additional agency requirements. _(nyc.gov/cecm; nycgovparks.org; sla.ny.gov — see VERIFICATION-SOURCES.md)_
- Today this navigation is sold as human expertise: NYC event-production agencies market permit navigation as a core professional service, noting that major event permits require 3–6 months of lead time and that requirements shift seasonally and by neighborhood. _(ideko.com)_

### 1a. Opportunity

Give independent organizers, in two minutes, what currently requires a production agency or years of trial and error: a complete, source-transparent permit plan for their specific event, with a feasibility check on their date. Published requirements carry citations; source-less coverage gaps stay explicit and assert nothing. Compress "weeks of figuring out who to call" into a generated checklist with deadlines, and make PopEngine the system of record for executing it. From that trust foundation, the product grows outward across the whole organizer lifecycle: execution tracking, promotion, event-day operations, and post-event intelligence that makes the next event easier than the last.

#### Market Opportunity

- Thousands of groups apply for NYC public-event permits annually (THE CITY, 2026), before counting private-venue pop-ups that still trigger sound, food, tent, or fire permits.
- The only alternatives are production agencies (priced for brand activations, not independents) and static blog guides that cannot evaluate a specific event. The bottom of the market has no software.
- NYC-first is a feature, not a limitation: rules are jurisdiction-specific, so depth in one city beats shallow national coverage, and the model extends city-by-city (F-207).

### 1b. Users & Needs

- **Primary users:** Independent event organizers, including pop-up market runners, community arts organizers, and small brand founders, who stage 1–20 events per year without an ops team or agency. _(Persona model: the small-organization founders profiled in THE CITY's March 2026 reporting.)_
- **Secondary users:** Event attendees who check in on-site and expect a fast, app-less experience.

#### Key User Needs

- As an **independent organizer**, I need to know _which_ permits my specific event requires, because the requirements are scattered across seven agencies and I don't know what I don't know.
- As an **independent organizer**, I need to know _immediately_ whether my event date is feasible given permit lead times, because discovering a 60-day requirement 30 days out kills the event.
- As an **independent organizer**, I need one timeline tracking every application, fee, and document deadline, because each agency runs its own portal and nothing aggregates my obligations.
- As an **event attendee**, I need an instant, zero-friction mobile check-in, because long lines and form-heavy sign-ups destroy the event experience.

#### Later Personas (post-MVP hypotheses, not validated)

- **First-time organizer:** needs plain-language questions, definitions, and warnings about unsupported complexity (Phase 2+).
- **Small-organization operations lead:** needs collaboration, document storage, assignment, and exportable plans (F-213, F-702–F-704).
- **Event operations contractor:** needs multi-client workspaces, event duplication, and status reporting (F-503, F-702).

### 1c. Competitive Landscape

| Bucket         | Who                                                         | What they do                                  | Why the gap remains                                                                                 |
| -------------- | ----------------------------------------------------------- | --------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| City portals   | SAPO E-Apply, DOT Survey123, Parks, NYPD precinct forms     | Accept applications                           | Submission, not navigation: assume you already know which permits you need; no cross-agency view    |
| Human services | IDEKO and NYC production agencies, event planners           | Expert permit navigation as a service         | Priced for brand activations; unavailable to independents                                           |
| Static content | citylaws.org, venue/planner blog guides, nyc.gov info pages | Explain the rules generically                 | Cannot evaluate a specific event or generate a plan; no deadlines, no tracking                      |
| Event software | Eventeny, Eventbrite, Luma, Partiful                        | Ticketing, vendor management, RSVPs, check-in | None generates jurisdiction-aware permit requirements; document features are passive upload/storage |

**The empty intersection:** software ✕ organizer-side ✕ generative (event parameters → permit plan) ✕ NYC jurisdiction depth. No product found occupies it; the incumbents are human consultants and nyc.gov itself.

## 2. PROPOSED SOLUTION

PopEngine is a web-based platform that turns an event description into a compliant execution plan. The organizer answers a short questionnaire (borough, location type, headcount, date, food, amplified sound, structures, open flame, alcohol, power) and PopEngine generates the complete permit plan: every required permit and agency, official lead times and fees, required documents, and a timeline computed backward from the event date, with an immediate feasibility verdict. The plan becomes a live checklist with deadline alerts and portal deep links through event day. The full product extends the same Event record across the organizer lifecycle: promotion and RSVPs, app-less QR check-in, and post-event intelligence.

### 2a. Value Proposition

Independent NYC event organizers who can't afford production agencies use PopEngine, a permit navigation and event execution platform, to know in two minutes exactly which permits their event needs and whether their date is feasible. Unlike city portals (submission only), agencies (unaffordable), and blog guides (generic), it generates a source-transparent, deadline-tracked plan for their specific event.

### 2b. Top 3 MVP Value Props

- **The Vitamin (must-have baseline):** Live checklist, document tracker, and portal links for the generated plan: statuses, uploads, deadline alerts per permit. _(F-202, F-203, F-204)_
- **The Painkiller (solves core pain):** The permit navigator itself: a short intake producing a complete, source-transparent permit plan with agencies, lead times, fees, and required documents. _(F-101, F-201)_
- **The Steroid (the magic moment):** The instant feasibility verdict. Enter a Large street activation 35 days out and PopEngine flags "the published 45-day filing deadline has already passed," shows the deadline ladder by event size, then shows what changes (smaller event class, private venue) would make it work. _(F-102)_

### 2c. Product Principles

1. **Source before assertion.** Every asserted regulatory conclusion traces to a versioned rule and its official source. A source-less COVERAGE_GAP asserts nothing and remains visible.
2. **Unknown is better than wrong.** The system says "confirm with agency" or asks for the missing fact; it never guesses. Over-prescribing permits destroys trust as surely as omitting them.
3. **Deterministic compliance decisions.** Permit determinations come from versioned rules evaluated deterministically, never from unconstrained AI reasoning. AI (F-6xx) drafts and extracts; rules decide.
4. **Explain every recommendation.** What applies, why, which answer triggered it, what it costs, when it's due, and what could change the result.
5. **Filing eligibility is not approval.** Being inside a filing window never gets presented as a guaranteed permit.
6. **Recalculate, don't patch.** When the event changes, the whole plan is re-evaluated against the rules.
7. **Rules are versioned product data.** Rule updates are data changes, not code changes; every plan records the ruleset version that produced it.
8. **Mobile web first.** Attendees must never be forced to download an app store application to participate on-site, and organizers can run their event from a phone browser.

### 2d. Goals & Non-Goals

#### Goals

- Generate a complete, correct permit plan from event parameters in under 2 minutes, with every source-bearing requirement citing its official source and every source-less coverage gap explicit.
- Detect and flag infeasible event dates at intake, with actionable alternatives.
- Provide one unified deadline timeline across all required agencies, tracked to submission via checklist, alerts, and portal links.
- Grow the same Event record into promotion, check-in, and post-event intelligence (planned scope, Phases 1.5+).

#### Non-Goals

- **Auto-submission to city portals** (agencies require direct applicant filing; PopEngine deep-links to the correct portal with a prepared document package).
- **Guaranteed approval** (PopEngine reports published filing requirements; approval remains agency discretion).
- **Legal advice** (published requirements with available citations and last-verified dates when published, plus explicit coverage gaps; no edge-case interpretation).
- **Jurisdictions beyond NYC in the MVP** (rules architecture supports additional cities post-MVP; F-207).
- **Native iOS/Android apps** (mobile web / PWA only).
- **Foot-traffic sensing or hardware integrations** (attendance analytics derive from check-ins only).
- **In-house payment processing** (ticketing via integration/export only; F-308).
- **Unreviewed AI-generated rules** (no rule becomes authoritative without human review; F-606/F-714).

### 2e. Success Metrics

#### MVP (all observable in a live demo; no real-event denominators)

| Goal                                           | Signal                                | Metric                                                                                                                                             | Target                                                          |
| :--------------------------------------------- | :------------------------------------ | :------------------------------------------------------------------------------------------------------------------------------------------------- | :-------------------------------------------------------------- |
| Complete plan generation                       | Demo events produce correct plans     | Expected findings matched vs. the approved fixture suite (6 scenarios + boundary fixtures, derived from ruleset nyc.v2.10)                         | 100% of expected findings, 0 false omissions, 0 false additions |
| Trustworthy output                             | Every plan line is source-transparent | Verification status plus an official citation when published, or an explicit statement that the combination is not covered by this ruleset version | 100%                                                            |
| Feasibility detection                          | Infeasible dates caught at intake     | Scenarios with impossible timelines flagged, with reason                                                                                           | 100% of seeded cases, <5 sec                                    |
| Determinism                                    | Same input, same output               | Re-running any scenario against the same ruleset version                                                                                           | Identical plan, 100%                                            |
| Speed                                          | Organizer gets answers fast           | Intake start to rendered plan                                                                                                                      | <2 minutes                                                      |
| Check-in flow _(stretch: only if F-401 ships)_ | Attendee friction stays near zero     | QR scan to completed 2-field check-in                                                                                                              | <20 seconds, no app install                                     |

#### Post-MVP metric directions (qualitative until real usage exists; no invented targets)

- Organizer-reported time saved vs. manual research; corrections required per generated plan.
- Repeat usage: share of organizers who plan a second event.
- Plan-to-execution conversion: share of plans turned into tracked checklists and submitted applications.
- Rules freshness: share of rules within their verification window.

## 3. REQUIREMENTS — MVP CORE (iron-clad; Phase 1)

The eight features below must be complete, real, and demoable. No mocks in this path. Acceptance detail lives in `/specs`; the scenario + boundary fixtures in `test-scenario-answer-key.md` (v7, derived from ruleset nyc.v2.10) are the acceptance suite for F-201/F-102.

### F-101 · Event Intake Questionnaire [P0]

- User completes a conditional intake whose fields mirror the ruleset's `intake_fields` registry (`rules/nyc-rules.v2.10.json` is authoritative for the field list): borough; location type; whether the activity obstructs the public way; SAPO event class + size or plaza level where applicable; headcount; event date; open-to-public; food present + vendor count; selling anything; amplified sound (+ audibility from the public way at private venues); structures by type with dimensions; flame/fuel types; generator specs (fuel gallons, kW); whether a battery system is present and its kWh; alcohol + whether the venue's license covers the event area; exact PACO coverage and a current FDNY Public Assembly Permit at private venues with headcount 75+.
- Conditional follow-ups appear only when triggered; a typical event answers 10–15 questions. Target stays under 2 minutes for typical events.
- Branching facts allow "I don't know" (recorded as `unknown`, propagating to CONDITIONAL); unknowns are never silently defaulted.
- Contradictory inputs are challenged, not silently resolved (e.g., tent dimensions without a tent; a block party plus sales).
- Coverage warning: alcohol in public space triggers an inline "not covered by this ruleset version" warning (plus advisory ADV-ALCOHOL-PUBLIC-001 on the plan).
- Intake works on mobile and desktop.

### F-110 · Assembly Document Coverage Intake [P0]

- At a private venue with headcount 75+, intake records two explicit `yes / no / unknown` facts: whether the PACO materials cover this event's exact space, use, occupant load, and layout, and whether the FDNY Public Assembly Permit is current for the same event space.
- The PACO question presents the four approved component checks as an evidence checklist. Any proved mismatch means no; all four proved matches mean yes; otherwise the organizer answers “I don't know.” The component checks are not separately persisted.
- These facts replace the active coarse `venue_has_assembly_approval` question. Its database column remains deprecated history, and no old value is used to infer either answer.
- Both answers persist through create, edit, reload, and immutable plan regeneration, but remain confirmation context only. They add no rule trigger, finding, deadline, branch, verdict, remedy, or temporary-filing inference.

### F-201 · Permit Plan Generator [P0]

- System evaluates the published ruleset (`rules/nyc-rules.v2.10.json`: 42 rules + 4 advisories) against the intake and returns every applicable finding: kind (permit / insurance / notification / registration / eligibility / prohibition / advisory / note), disposition (required / may-be-required / prohibited-or-ineligible / advisory / no-new-requirement), name, agency, typed deadline, fee, portal, and the rule + triggering answers that produced it.
- Every line shows its verification status. A source-bearing line cites its official source; a COVERAGE_GAP finding that carries no citation visibly states that the combination is not covered by this ruleset version, and never invents a citation or implies a source is merely missing (that is RESEARCH_REQUIRED's meaning; the published legend calls COVERAGE_GAP "combination not modeled by this ruleset version"). RESEARCH_REQUIRED facts render "confirm with agency"; OFFICIAL_CONFLICT rules render both readings with their sources; the system never fills gaps with guesses or silently resolves conflicts.
- A near-empty result is first-class and honest: when no finding is `required` or `prohibited-or-ineligible`, render "No definite city event requirement identified from your answers," plus every advisory and named confirmation. A required finding remains definite when its deadline is not calculable; Scenario B is low burden, not near-empty.
- The ruleset version is stored with the generated plan; re-running the same event on the same version and date is deterministic.
- A rule-evaluation error fails visibly; a partial plan is never presented as complete.

### F-102 · Feasibility Verdict [P0]

- System computes the timeline backward from the event date, assigns each dated finding a deadline status (ON_TRACK / DEADLINE_APPROACHING / PUBLISHED_DEADLINE_MISSED / NOT_CALCULABLE / NOT_APPLICABLE), and renders one top-level verdict: **FEASIBLE / FEASIBLE-AT-RISK / CONDITIONAL / INFEASIBLE**.
- INFEASIBLE copy reads "published deadline missed as scoped" (a missed filing window, never a claim of legal impossibility) and names the blocking finding (Scenario A: SAPO Street Event Large, 45-day deadline passed). Rescopes are full re-evaluations, never pre-approved claims.
- FEASIBLE-AT-RISK renders when minimum slack falls below the 14-day threshold, labeled in-product as PopEngine's internal planning buffer, not an official threshold (Scenario D: "apply within 10 days").
- CONDITIONAL renders when material unknowns change the outcome, with every branch evaluated and shown (Scenario F: license coverage and sound audibility). Scenario F also records F-110's exact PACO and current FDNY Public Assembly Permit answers as confirmation context. No published trigger consumes either answer, so neither branches the verdict or supports a temporary-filing inference.
- Timeline honors the ruleset's deadline types: published minimums per SAPO class/size/plaza level, hard floors (Parks' 21-day cutoff is a cliff, not a gradient), processing ranges, actual business-day minimums against the pinned holiday calendar (SLA: 15 business days), before-issuance requirements, and sequenced dependencies (Parks amplified-sound permission precedes the NYPD pursuit). RESEARCH_REQUIRED deadlines are listed but excluded from verdict arithmetic.

### F-206 · Rules Snapshot Banner [P0]

- "Rules snapshot nyc.v2.10 · published July 29, 2026" renders on every plan. Never "verified as of": a snapshot date means published-on, not all-facts-verified-on.
- Per-line verification status renders honestly (SOURCE_CONFIRMED / OFFICIAL_CONFLICT / RESEARCH_REQUIRED / COVERAGE_GAP); published citations click through to official sources, while source-less gaps render no invented link.

### F-202 · Compliance Checklist & Status Tracker [P0]

- One click converts the plan into a live checklist: per-permit status (not started / in progress / submitted / approved / rejected), document upload, notes.
- Checklist items stay linked to their plan lines (and thus rules + sources).

### F-203 · Deadline Alerts [P0]

- Email/SMS (Twilio) alerts fire on computed deadlines, including dependency-sequenced ones (Parks before NYPD sound) and slack warnings.
- Deadline types stay distinct end-to-end; a hard floor is never softened into a recommendation.
- Demo fallback if SMS registration (A2P) is not approved in time: email alerts live, SMS simulated in-product and labeled as such (per `DESIGN.md` fallback rules).

### F-204 · Portal Deep Links + Prepared Packages [P0]

- Every finding that publishes an application path in the rules data links to it (E-Apply / Parks / precinct filing instructions / FDNY Business on the current ruleset). Findings without published portal fields render no portal block — never invent a DOHMH/SLA path or treat a citation URL as a filing destination.
- Prepared document lists and per-facet portal verification are out of scope until a future ruleset publish (SPEC-CONFLICT #149 resolved by scope reduction).
- The UI never implies PopEngine submits the application (non-goal): copy is "apply at [portal]", links open in a new tab.

## 4. REQUIREMENTS — DEMO STRETCH (Phase 1.5; parallel Track B, demo inclusion decided at the green gate)

- **F-401 · App-less QR Check-in [P1]:** attendee scans a physical QR code, gets a mobile-web page, completes a 2-field check-in (name, email/SMS) in under 20 seconds, no app install. The team's founding check-in concept; first stretch priority.
- **F-402 · Live Ops Dashboard [P1]:** real-time check-in counts + capacity gauge vs. the optional confirmed `events.capacity` value. Check-ins only; never presented as live occupancy (that requires F-410).
- **F-301 · Public Event Page [P1]:** auto-generated from the intake (title, date, venue, description, RSVP button, map) at a shareable URL.
- **F-302 · RSVP / Guest List [P1]:** capacity-aware RSVPs; guest list exports to check-in.
- **F-205 · Insurance Requirement Detector [P1]:** street/plaza events flag $1M liability with City as additional insured (SAPO-INSURANCE-001; block parties without rides are exempt per 50 RCNY §1-08(b)); parks events render "insurance determined by borough office at review" (PARKS-INSURANCE-NOTE-001), never hard-required. _(These rules ship in the day-one ruleset; F-205 is the dedicated UI surfacing.)_

## 5. REQUIREMENTS — PLANNED SCOPE (Phases 2–4; outlined for delegation, specs written when scheduled)

Phasing lives in `ROADMAP.md`. Requirement statements here are directional, one line each.

### Execution Hardening (Phase 2)

- **F-701** — Identity and sessions are implemented first, but are never production-activated alone.
- **F-702** — Workspaces and memberships follow immediately.
- **F-703** — Roles and permissions follow F-702; F-701, F-702, and F-703 jointly gate persistence of user-owned product data for authenticated users and external beta (the capstone demo remains single-tenant behind its access gate).
- **F-107** — User can save an incomplete intake and resume later.
- **F-208** — User can track each application: number, submitted date, agency status, revision requests, inspection, decision, approval conditions.
- **F-209** — User can track estimated/invoiced/paid fees and required vs. submitted documents, including final permits and expirations.
- **F-212** — User can export deadlines, inspections, and milestones to external calendars.
- **F-303** — User can print QR poster/flyer assets pointing at the event page.
- **F-304** — User can generate AI-drafted announcement copy (IG, email, SMS) from intake data, edit, and copy out; no social publishing.
- **F-305** — RSVPs receive scheduled reminders (T-7, T-1, day-of with directions).
- **F-403** — Check-in doubles as opt-in lead capture; entry, marketing-email, and SMS consent are separate; marketing consent is never required for entry.
- **F-404** — User can view attendees across events, flag repeats, and export CSV.
- **F-405** — User gets an auto-generated day-of runbook: permit numbers, load-in checklist, emergency contacts, staff assignments.
- **F-203 (full)** — alert escalations, digests, team reminders, and per-user preferences; planned, not scheduled.

### Differentiation & Depth (Phase 3)

- **F-103** — User can compare two event scopes side-by-side: permit burden + earliest feasible dates.
- **F-104** — User can roll up permit fees and entered line items against a target budget.
- **F-105** — User keeps a personal venue shortlist whose type tags feed F-101.
- **F-106** — Given a target month, user gets earliest feasible dates per scope (inverse of F-102).
- **F-210/F-211/F-213/F-214** — insurance certificate tracking; site-plan preparation; team task assignment; vendor/contractor compliance tracking.
- **F-306/F-307/F-309** — waitlist auto-promotion; custom registration fields; light event-page branding.
- **F-406/F-407** — post-event P&L (actuals vs. F-104); one-page post-mortem feeding the next event's estimates.
- **F-409–F-413** — offline-tolerant check-in; entry/exit occupancy + re-entry; staff roles + credentialed entry; incident log; consent-gated emergency messaging.
- **F-501/F-502/F-503** — permit performance analytics; historical event comparison; event templates with requirements recalculated (never copied) against the current ruleset.
- **F-704** — activity history, built on the Phase 2 identity, workspace, and role foundation.

### Platform, AI & Expansion (Phase 4)

- **F-207 (activated)** — city #2 ships as a new rules file + verification pass, not new code.
- **F-108** — address geocoding + park/plaza/precinct/authority resolution with confidence and manual correction.
- **F-109** — scope support states (fully/partially supported, unsupported, ambiguous, awaiting information); required once intake goes open-ended. Named for what it gates: whether the scope the organizer _described_ is one the published ruleset supports, decided before evaluation runs. Called "coverage states" until 2026-07-26, when "coverage" was found to name three different things — this, the per-rule `COVERAGE_GAP` verification status, and `ARCHITECTURE-FUTURE.md` §7.1's per-result completeness. The five values are unchanged.
- **F-308 / F-408** — ticketing integration/export; inventory low-stock alerts (manual counts or Square webhook; deliberately last).
- **F-601–F-606** — AI assist under the AI policy (`DESIGN.md`): free-text intake, document extraction, email ingestion, update reconciliation, correspondence drafting, rule research. AI proposes; rules decide; users confirm.
- **F-710–F-715** — rules administration: editor, source manager, test runner, version diff, atomic publish/rollback, reported-issue queue. Until then: rules JSON in git, answer key as test runner, PRs as review.

## 6. RISKS & MITIGATIONS

| Risk                                                              | Impact   | Mitigation                                                                                                                                                                                                                                                 |
| ----------------------------------------------------------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Incorrect regulatory determination                                | Critical | Deterministic rules; fixture acceptance suite; verification discipline (primary sources, evidence refs, one sign-off owner); "confirm with agency" over guessing; official conflicts rendered, never resolved silently                                     |
| Rules drift (seasonal/administrative change, documented by IDEKO) | High     | Verification status on every line; source when published or an explicit statement that the combination is not covered by this ruleset version; last-verified date when published; snapshot banner (F-206); ruleset versioning; re-verification before demo |
| Users read the plan as an approval guarantee                      | High     | "Filing eligibility is not approval" principle; explicit disclaimer wording in plan output                                                                                                                                                                 |
| Scope dilution in a 2-week build                                  | High     | Iron-clad core stays first for anyone holding a blocker; the green gate selects the demo narrative, and unfinished stretch is cut rather than mocked (`DESIGN.md`)                                                                                         |
| Twilio A2P/SMS registration delays                                | Medium   | Registration starts day 1 (Phase 0); email-first alerts; labeled SMS simulation as demo fallback                                                                                                                                                           |
| AI output treated as authority (future phases)                    | Critical | AI policy: extraction is proposed data, user-confirmed; rules published only via review (F-714)                                                                                                                                                            |

## 7. APPENDIX

- **Technical Stack:** React / Next.js (frontend), Node.js / Express (backend), PostgreSQL (main database + rules tables), Twilio (SMS deadline alerts). _(Redis removed from MVP: check-in volume at demo scale doesn't require a queue layer; re-add post-MVP if needed.)_
- **Rules Engine:** NYC permit logic encoded as data (conditions → findings), not hardcoded. Each rule stores kind, trigger, typed deadline (published minimum by class/size/level, hard floor, processing range, business-day, before-issuance), fee, portal, evidence reference, and verification status. Published ruleset: `rules/nyc-rules.v2.10.json` (42 rules + 4 advisories); scenario fixtures in `test-scenario-answer-key.md` derive from it. Rule updates are data changes, published per `DOCUMENTATION-GOVERNANCE.md`.
- **Known Risk & Mitigation:** Permit rules change seasonally and administratively _(IDEKO practitioner guidance)_. Every output shows its verification status, cites its source when published or states that the combination is not covered by this ruleset version, shows a last-verified date only when one is published, and states its rules snapshot date on screen (F-206).
- **Demo Script Anchor (Scenario A, re-anchored 2026-07-22):** Bushwick street activation, 75 people, DJ, food vendor, 35 days out, classified as a Large street event. The plan generates; the published 45-day SAPO deadline has already passed; PopEngine shows the deadline ladder (Small 14 / Medium 30 / Large 45) and re-evaluated rescopes (Medium → at-risk, private venue → SAPO drops); a checklist is created with portal links. Full demo sequence in `DESIGN.md`.

## Sources

- THE CITY, "Getting NYC Event Permits Is a Mess" (Mar 10, 2026): thecity.nyc/2026/03/10/permit-streets-party-concert-application-sapo/
- SAPO official scope + E-Apply: nyc.gov/sapo
- Practitioner lead-time guide: nyc-event-venues.com/the-society-brief/navigating-nycs-event-permits-what-you-need-to-know
- IDEKO agency permit-navigation service: ideko.com/insights/behind-the-permits-navigating-nycs-complex-approval-processes
- Neighborhood Commons unified-permitting proposal: neighborhoodcommons.nyc/Unified-Digital-and-Analog-Permit-Applications
- Manhattan barricade/crowd-control permit paths: us.citylaws.org/ny/manhattan/manhattan-event-barricade-and-crowd-control-permits
