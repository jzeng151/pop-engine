# PopEngine — Roadmap (Canonical)

**Status:** APPROVED (2026-07-22; F-109 retitled "Scope-Support Classification" and its concept renamed from "coverage states" to "scope support states" 2026-07-26, product-owner approved, resolving a three-way overload of "coverage"; the five state values are unchanged; standalone `Square/POS integrations` entry dropped from Phase 4 on 2026-07-28, product-owner approved, resolving SPEC-CONFLICT #127 item 2 by the narrowing branch, no F-id's meaning changed; F-705 Event Workspace Shell added to Phase 1.5 on 2026-08-02, product-owner approved, registering navigation scope that had shipped under a design-system amendment that excludes it, no F-id's meaning changed; see `docs/BASELINE.md`).
**Companion docs:** `PRD.md` (requirements) · `DESIGN.md` (lifecycle model, lanes, gates, demo plan, dependency graph) · `test-scenario-answer-key.md` (MVP ground truth).
**Feature IDs:** F-xxx IDs are permanent shared vocabulary; once assigned, an ID's meaning never changes. Full ID policy in `DESIGN.md`.

## Phase 0 — Foundation (days 1–2, all hands)

Prerequisites, not features:

- Ratify the `events` schema (the team's single integration point) — completed for the access-gated demo 2026-07-27 through PR #137's recorded overwrite; strict production ratification and later shared/core-table changes remain the product owner's under governance §6.
- Ratify `rules/nyc-rules.v2.11.json` (42 rules + 4 advisories: product-owner sign-off per `BASELINE.md`, which is the whole requirement under governance §6 even for a ruleset the product owner authored); boot validation loads it.
- Repo scaffold, deploy target, Twilio account + A2P registration started.

## Phase 1 — MVP Core (capstone; iron-clad, no mocks)

The permit-planning spine. Must pass all 6 answer-key scenarios; "iron-clad" is defined in `DESIGN.md`.

**Week 1:**

- **F-101 · Event Intake Questionnaire** — conditional intake mirroring the ruleset's field registry (location/obstruction, SAPO class + size/plaza level, headcount, date, audience, food, sales, sound, structures, fuel, generator/battery, alcohol/license, assembly); contradiction checks; "I don't know" on branching facts.
- **F-110 · Assembly Document Coverage Intake** — at private venues with headcount 75+, replace the coarse assembly-approval question with explicit tri-state PACO exact-event coverage and current FDNY Public Assembly Permit confirmations; persist through reload and plan snapshots without adding a regulatory or verdict branch.
- **F-201 · Permit Plan Generator** — rules-engine output: typed findings (permits, insurance, notifications, registrations, eligibility, prohibitions, advisories) with agencies, typed deadlines, fees, portals, citations + verification statuses; ruleset version stored per plan.
- **F-102 · Feasibility Verdict** — backward-computed timeline; per-finding deadline statuses under a four-state verdict (FEASIBLE / FEASIBLE-AT-RISK / CONDITIONAL / INFEASIBLE); INFEASIBLE = "published deadline missed as scoped"; rescopes are full re-evaluations; unknowns propagate to CONDITIONAL.
- **F-206 · Rules Snapshot Banner** — "Rules snapshot [version] · published [date]" in-product (never "verified as of"); per-line citations + verification status.

**Week 2:**

- **F-202 · Compliance Checklist & Status Tracker** — per-permit status, document upload, notes; generated from F-201.
- **F-203 · Deadline Alerts** — email/SMS (Twilio) on computed deadlines; deadline types stay distinct (published minimum, hard floor, business-day, dependency-gated).
- **F-204 · Portal Deep Links + Prepared Packages** — each permit links to its correct portal (E-Apply / Survey123 / precinct / FDNY Business) with its document list.

## Phase 1.5 — Stretch Track (parallel; the demo fallback)

Worked separately from the core per `DESIGN.md` Decision 10; doubles as the fallback demo if the core runs out of time. In order of demo value; anything unfinished is dropped from the demo, never mocked:

- **F-401 · App-less QR Check-in** — scan → 2-field mobile-web check-in (<20s, no install).
- **F-402 · Live Ops Dashboard** — real-time check-in counts + capacity gauge (check-ins only, never occupancy).
- **F-301 · Public Event Page** — auto-generated from intake; shareable URL with RSVP button.
- **F-302 · RSVP / Guest List** — capacity-aware; exports to check-in.
- **F-205 · Insurance Requirement Detector** — flags $1M liability + City-as-additional-insured where required (block parties without rides exempt); "borough office determines" note for parks.
- **F-705 · Event Workspace Shell** — the `/events/[id]` shell and overview route: one persistent navigation across the four lifecycle stages for a single event, a masthead naming the active event and labeling the demo, a disabled Planned group, and the theme control. Navigation and chrome only; no endpoint, table, or feature behavior. _Added 2026-08-02, product-owner approved, amending a phase set that was closed on 2026-07-22: the shell shipped with the 2026-07-29 UI work under the design-system amendment, whose scope clause excludes cross-feature navigation, so it is recorded here as the product scope it is. Assigned to F-7xx, the Platform horizontal, because it spans all four stages rather than attaching to one (`DESIGN.md` lifecycle model). No assigned ID's meaning changes._

## Phase 2 — Execution Hardening (post-capstone)

- **F-701 · Authentication** — identity and session foundation; implemented first, but never production-activated alone.
- **F-702 · Workspaces** — organizations, workspaces, and memberships; ships immediately after F-701.
- **F-703 · Roles & Permissions** — owner/admin/organizer/contributor/check-in staff/viewer/rules admin; ships after F-702 as the final part of the rollout gate. No user-owned product data is persisted for authenticated users, and no external beta begins, until F-701, F-702, and F-703 ship (the MVP demo remains single-tenant behind its access gate).
- **F-107 · Save & Resume** — save an incomplete intake/event and return later.
- **F-208 · Application Status Tracking** — application number, submitted date, agency status, revisions, inspection, decision, conditions.
- **F-209 · Fee & Document Ledger** — estimated/invoiced/paid fees; required vs. submitted documents; final permits + expirations.
- **F-212 · Calendar Export & Sync** — deadlines, inspections, milestones to external calendars.
- **F-303 · QR Marketing Assets** — printable QR poster/flyer for the event page; reuses F-401's QR infra. **Rehearsal use only** (product owner, 2026-08-04; scope statement in `PRD.md`, decision in `BASELINE.md`, closing `OPEN-QUESTIONS.md` T-7): the event page these assets point at is anonymously reachable only during the rehearsal/demo window, and an F-303 spec may not authorize production exposure of it.
- **F-304 · Announcement Composer** — AI-drafted event copy (IG caption, email, SMS) from intake data; composer, not publisher.
- **F-305 · Reminder Campaigns** — scheduled email/SMS to RSVPs (T-7, T-1, day-of); reuses F-203's Twilio plumbing.
- **F-403 · Lead Capture & Consent** — check-in doubles as opt-in lead collection; entry/marketing/SMS consent kept separate.
- **F-404 · Attendee CRM & Export** — attendee list across events; CSV export; repeat-attendee flag.
- **F-405 · Day-of Runbook** — auto-generated event-day sheet: permit numbers, load-in checklist, contacts, staff assignments.
- **F-203 (full)** — alert escalations, digests, team reminders.

## Phase 3 — Differentiation & Depth

- **F-103 · Scope Comparator** — side-by-side permit burden + earliest feasible date for two configurations.
- **F-104 · Budget Estimator** — permit fees + user-entered line items vs. target budget.
- **F-105 · Venue Shortlist** — personal candidate-venue list feeding F-101 (not a marketplace).
- **F-106 · Date Advisor** — given a target month, earliest feasible dates per scope; inverse of F-102.
- **F-210 · Insurance Certificate Tracking** — policy, coverage, additional-insured, certificate status, expiration.
- **F-211 · Site Plan Preparation** — site-plan checklist, dimensions, uploads, versions.
- **F-213 · Team Task Assignment** — assign requirements/tasks to workspace members.
- **F-214 · Vendor & Contractor Compliance** — vendor contacts, insurance, permits, arrival times, contract status.
- **F-306 · Waitlist** — auto-promote when capacity frees.
- **F-307 · Custom Registration Fields** — organizer-defined extra RSVP fields.
- **F-309 · Organizer Branding** — limited event-page branding.
- **F-406 · Post-Event P&L** — actuals vs. F-104 budget; revenue, cost rollup, margin.
- **F-407 · Post-Mortem Report** — attendance vs. RSVP, leads, P&L, permit timeline adherence; feeds next event's F-104.
- **F-409 · Offline-Tolerant Check-in** — tolerate connectivity loss; sync later.
- **F-410 · Entry/Exit Occupancy & Re-entry** — both-direction counting; only then may the dashboard show occupancy.
- **F-411 · Staff Roles & Credentialed Entry** — role-limited check-in controls; vendor/performer entry categories.
- **F-412 · Incident Log** — timestamped incidents with attachments.
- **F-413 · Emergency Messaging** — organizer-triggered attendee comms, consent-gated.
- **F-501 · Permit Performance Analytics** — late submissions, revisions, unexpected requirements, delays across events.
- **F-502 · Historical Event Comparison** — permit burden, cost, prep time, attendance across similar events.
- **F-503 · Event Templates & Reuse** — duplicate a past event; requirements recalculated against the current ruleset, never copied.
- **F-704 · Activity History** — answer changes, recalculations, rule version changes, uploads, status changes.

## Phase 4 — Platform, AI & Expansion

- **F-207 · Multi-Jurisdiction Rules Architecture (activated)** — city #2 as a data import, not a rewrite. (Architecture requirement from day 1; activation is Phase 4.)
- **F-108 · Location & Authority Resolution** — geocoding; park/plaza/precinct/community-board identification; confidence + manual correction.
- **F-109 · Scope-Support Classification** — fully/partially supported, unsupported, ambiguous, awaiting-information states (required once intake goes open-ended via F-601). Retitled from "Coverage-State Classification" 2026-07-26: "coverage" named this, the per-rule `COVERAGE_GAP` verification status, and `ARCHITECTURE-FUTURE.md` §7.1's per-result completeness, with nothing distinguishing them. This is the pre-evaluation gate on the scope the organizer described; the five values are unchanged. The F-id and its meaning are unchanged, per the ID policy above.
- **F-308 · Ticketing Integration** — integrate/export to established providers; no in-house payments.
- **F-408 · Inventory Low-Stock Alerts** — manual counts or Square webhook (deliberately last).
- **F-601 · Free-Text Event Intake** — description → proposed structured answers; user confirms before evaluation.
- **F-602 · Document Extraction** — application number, deadline, fee, status from uploads; user confirms.
- **F-603 · Email Ingestion** — match agency correspondence to the right event/application.
- **F-604 · Update Reconciliation** — detect when a later document changes a deadline, fee, or status.
- **F-605 · Agency Correspondence Drafting** — draft, never auto-send.
- **F-606 · Rule Research Assistant** — internal: flag possible source changes for human review.
- **F-710 · Rule Editor** — draft/edit rules as data.
- **F-711 · Source Manager** — source metadata, excerpts, archives, broken-link detection.
- **F-712 · Rule Test Runner** — run affected scenarios before publishing a rule change.
- **F-713 · Ruleset Version Comparison** — diff two ruleset versions.
- **F-714 · Publish & Rollback** — atomic ruleset publication; restore prior version.
- **F-715 · Reported-Issue Queue** — users flag wrong/missing/outdated requirements.

**Dropped 2026-07-28, product-owner approved (SPEC-CONFLICT #127 item 2, narrowing branch):** a
standalone `Square/POS integrations` entry sat here with no F-id and no spec, contradicting
`PRD.md:226`, which assigns the Square capability to F-408 and scopes it to the inventory low-stock
webhook. `ARCHITECTURE-FUTURE.md` §9.3 is not a second source for that scope: its row places F-408
in the generic External integrations module beside F-108, F-212 and F-308 and lists generic
integration entities, naming neither Square, nor inventory, nor a webhook. The broader standalone POS capability is DROPPED, not deferred
and not absorbed: F-408 keeps exactly its established meaning, Inventory Low-Stock Alerts, because
widening it would change an assigned ID's meaning against the policy above. Reintroducing the
broader capability is a new ID and a new product decision, not a restoration. Recorded here so the
absence reads as a decision rather than an omission.
