# F-101 · Event Intake Questionnaire

**Status:** APPROVED (2026-07-24) · **Reviewer/approver:** product owner · **Owner:** see Lane below · see `docs/BASELINE.md`.
**Phase:** 1 (core, week 1) · **Lane:** Dev 2 · **Depends on:** events schema (Phase 0), ruleset nyc.v2.11 ratified (BASELINE.md) · **Feeds:** everything (single source of truth)
**Updated:** 2026-07-22 against nyc.v2.1; retargeted through nyc.v2.8 for the changes recorded in `docs/BASELINE.md`, to nyc.v2.9 on 2026-07-29, to nyc.v2.10 the same day for issue #181's citation-only correction, and to nyc.v2.11 for organizer summaries. The shared issue #178 publication adds the nine issue #107 named confirmations, replaces the coarse assembly-approval question with F-110's two document-specific tri-states under the same private-venue/headcount gate, and removes the issue #194 food-exception claim from active intake. The superseded database columns remain historical storage; no rule or verdict reinterprets them. The v2.10 and v2.11 retargets change no field, trigger, finding, status, or verdict.

## User Story

As an independent organizer, I describe my event once in plain language, so PopEngine can tell me which permits my specific event requires and whether my date works.

## Inputs

The field list, enums, and asked-when conditions come from the ruleset's `intake_fields` registry (`rules/nyc-rules.v2.11.json`) — **the registry is authoritative; do not duplicate or drift from it.** Field groups (mirrored by the `events` table in ARCHITECTURE.md):

1. **Identity:** name, borough, location_type, location_name
2. **SAPO classification** (public-way locations only): obstructs_public_way; sapo_event_type; street_event_size OR plaza_level + plaza_multiple_blocks; has_amusement_ride (block parties)
3. **Scale + date:** headcount, capacity (optional), event_date
4. **Audience + food:** event_open_to_public; food_present → food_vendor_count; selling_anything
5. **Sound:** amplified_sound → sound_audible_from_public_way (private venues only)
6. **Structures:** structure_types multi-select → per-type dimensions (tent area/duration, stage height/area), structure_over_10ft_tall
7. **Flame + power:** open_flame_or_cooking multi-select; generator_present → gasoline/diesel gallons, kW; battery_present → battery_system_kwh
8. **Alcohol + assembly** (private venues): alcohol → venue_license_covers_event_area; headcount ≥ 75 → venue_paco_covers_exact_event + venue_fdny_pa_permit_current_for_event_space

## Outputs

- `POST /api/events` → created event row (revision_counter = 1); per-field validation errors.
- `GET /api/events/:id` → the stored event row, so a saved event can be reloaded for viewing or editing (`ARCHITECTURE.md` API Surface assigns this route to F-101).
- `PATCH /api/events/:id` → updated row; server bumps `revision_counter` and marks any existing plan stale.

## Acceptance Criteria

1. All six fixture scenarios (`docs/test-scenario-answer-key.md` v7) are enterable exactly as specified; each produces an event row with the mapped values.
2. Conditional fields appear only when triggered, per the registry's `asked_when` conditions, which are authoritative: SAPO classification whenever `obstructs_public_way != no` (so `unknown` still asks it — a material unknown must not be hidden); street size only for street events; plaza level only for plazas; dimensions only for selected structure types; audibility only for private-venue sound; license/assembly questions only when relevant. Both F-110 fields use `location_type = private_venue AND headcount >= 75`, including the 74/75/76 boundary. Question count follows from the registry, not from a target; fields whose registry entry has no `asked_when` are always asked.
3. "I don't know" is accepted on **every** field whose registry entry declares an `unknown` value, and stored as `unknown`, never silently defaulted. This spec deliberately does not enumerate them: the registry is the list, and a prose copy of it drifts (it has, twice). Derive the set from `intake_fields` at build time. Numeric fields on a selected structure/generator may be left blank (stored NULL → engine evaluates unknown).
4. Contradiction checks block submission with a specific message, never silently resolve:
   - dimensions entered for an unselected structure type
   - sapo_event_type = block_party while selling_anything or alcohol is true → warn inline that this conflicts with block-party eligibility (submission allowed; the plan will show PROHIBITED_OR_INELIGIBLE)
   - generator specs without generator_present; a battery kWh without battery_present; license/assembly-document answers without their trigger conditions
   - event_date in the past; headcount ≤ 0
5. Coverage warning (inline, non-blocking): alcohol + public location renders `ADV-ALCOHOL-PUBLIC-001`'s published `advisory_text` verbatim, alongside its `verification.status`. The rule is the source of the wording; this spec does not paraphrase it (authority order: primary source → published rule → fixture → engine → UI). The plan additionally carries the same advisory.
6. Intake completes in under 2 minutes for a typical event (rehearsal-timed; PRD metric).
7. Works on mobile and desktop viewports.
8. Editing any field after a plan exists bumps `revision_counter` server-side, marks the plan stale in the UI, and offers one-click regeneration. The criterion names no surface and is unchanged. It is recorded here that since 2026-08-02 the notice and the control render on the event overview (`specs/F-705`), not on this form: the save added on 2026-07-29 redirects there, which unmounted the form's own notice before an organizer could see it, and a criterion whose affordance is unreachable is failed rather than moved. It is further recorded that between 2026-08-03 and 2026-08-04 the overview rendered the notice WITHOUT the control, so the criterion's one click was unmet there: no check a browser can make holds across the write it would authorise, and the precondition belongs in the request that generates the plan (`docs/OPEN-QUESTIONS.md` T-5). It is recorded that on 2026-08-04 the control returned to the overview (`apps/web/app/events/[id]/plan-stale-notice.tsx`) and the criterion is met there again, on the mechanism F-201 AC 12 added: the notice attempts `POST /api/events/:id/plan` and reports the answer, and that endpoint refuses a ruleset downgrade inside the transaction that inserts, under a row lock. The notice makes no precondition check of its own, so nothing here decides a write and then issues it. A 409 refusal renders both ruleset versions and which way round they stand, and leaves no retry, the same request to the same deployment being refused identically. The criterion is not amended by any of this, which records where and how it is met rather than reading a surface into it. No new approval is recorded: AC 12's is already signed, and this implements an already approved criterion.

## Edge Cases

- headcount exactly 20 in a park: stored as-is; the engine renders the OFFICIAL_CONFLICT finding (fixture in the answer key). 19/20/21 boundary is an engine test, not an intake concern.
- structure selected with blank dimensions: accepted; downstream conditional finding requests them (do not force entry).
- tent_area_sqft exactly 400: accepted; the boundary CONDITIONAL is the engine's job.
- sapo_event_type = other_sapo_class: accepted; plan renders the coverage advisory with reference deadlines.
- Rapid PATCH before plan generation completes: last write wins; the plan pins the `revision_counter` it evaluated.

## Fixture Scenarios Exercised

All six (A–F) as input fixtures. A exercises street size classification; D exercises block-party fields; E exercises plaza level, structures, and generator specs; F exercises the license-coverage and sound-audibility verdict branches while retaining both F-110 assembly-document facts as non-branching confirmation context.
