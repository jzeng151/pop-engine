# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

The primary user is an independent New York City event organizer who stages one to twenty events per year without a dedicated operations team or production agency. They use PopEngine while planning under deadline pressure, executing permit work, promoting the event, and coordinating event-day operations.

Secondary users are event attendees who reach public event, RSVP, and check-in surfaces from a shared link or QR code. These users need a fast mobile experience without an account or app install.

## Product Purpose

PopEngine turns one event record into a source-transparent permit plan and then carries that same record through compliance execution, promotion, check-in, operations, and post-event learning. Success means organizers can identify requirements and timeline risk quickly, understand the status and source of every regulatory output, and continue operating without re-entering the event.

## Positioning

PopEngine combines deterministic, versioned NYC permit evaluation with a single event-record workflow spanning planning and operations. The rules engine, not AI-generated copy, is the only authority for regulatory output.

## Operating Context

Organizers move between desktop planning and phone-based field work. The core path is event intake, feasibility verdict, permit plan, citations, checklist, portal handoff, and deadline alerts. Approved stretch surfaces include public promotion, RSVP and guest management, app-less QR check-in, and live check-in telemetry.

The requested product shell also exposes planned lifecycle modules for execution hardening, collaboration, day-of operations, cross-event intelligence, AI-assisted drafting and extraction, integrations, and rules administration. These future modules are scaffolded as clearly labeled planned capabilities until their production contracts are implemented.

## Capabilities and Constraints

- One Event is the source of truth across Ideate, Comply, Market, and Operate modules.
- Regulatory output comes only from the published ruleset and deterministic engine.
- Unknowns, official conflicts, research-required states, and ruleset coverage gaps remain visible.
- A partial plan is never presented as complete.
- Public attendee routes never expose organizer compliance details.
- Demo and mock data are synthetic and labeled where a person could mistake them for real data.
- Check-in telemetry is labeled as check-ins, not occupancy or foot traffic.
- AI may draft or extract proposed values but may not determine requirements or publish rules.
- Future modules may be represented in the information architecture before their full behavior exists.

## Evidence on Hand

- Approved product requirements, roadmap, delivery design, architecture, and feature specifications under `docs/` and `specs/`.
- Published regulatory ruleset at `rules/nyc-rules.v2.10.json`.
- Existing Next.js organizer, public event, RSVP, check-in, and dashboard surfaces under `apps/web/app`.
- Approved visual foundation at `docs/DESIGN-SYSTEM.md`, available as evidence but not binding for this redesign exploration.
- No validated customer testimonials, commercial pricing, production usage metrics, or real attendee data may be invented for the interface.

## Product Principles

1. Show the decision and its provenance together.
2. Keep one event moving forward instead of splitting the lifecycle across tools.
3. Make uncertainty explicit and actionable.
4. Adapt from desktop planning to phone-based field operation.
5. Demonstrate future breadth without presenting unfinished behavior as shipped.

## Accessibility & Inclusion

The web product must support keyboard navigation, visible focus, WCAG AA contrast, reduced motion, clear form labels and errors, 44-pixel minimum touch targets, responsive layouts, and plain-language explanations of regulatory states.
