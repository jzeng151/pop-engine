# F-110 · Assembly Document Coverage Intake

**Status:** APPROVED (2026-07-29; migration 013 added to this spec 2026-08-02 as Acceptance Criterion 9 and the schema bullet below, approved by the product owner in the product, architecture, database, affected-lane, and all-lane capacities, one person holding every lane rather than independent sign-offs. The migration shipped with this feature in PR #204 and was not named in the 2026-07-29 approval, which enumerated migration 012's two columns and nothing else; this is its first approval, not an inherited one, and `docs/ARCHITECTURE.md` records the same decision.) · **Reviewer/approver:** product owner acting in the product, architecture, database, F-101, F-102, F-201, affected-lane, and all-lane capacities (issue #188; decision gate `msg_bed16d397a64`) · **Owner/Lane:** Dev 2, coordinated with Dev 1 and Dev 4.
**Phase:** 1 (core) · **Depends on:** F-101, F-102, F-201, ruleset nyc.v2.11, and events migrations 012 and 013 · **Feeds:** saved intake and immutable plan snapshots.

## User Story

As an organizer of a qualifying private-venue event, I can record whether the venue's PACO materials cover this exact event and whether the FDNY Public Assembly Permit is current for the same event space, without a generic approval answer being mistaken for either fact.

## Inputs and Meaning

Both fields use `yes / no / unknown` and are asked only when `location_type = private_venue AND headcount >= 75`:

- `venue_paco_covers_exact_event`: yes means the current or most recent PACO, certificate of occupancy, and DOB-approved primary or alternate plan identify the exact event space, authorize the event use and assembly classification, allow the event's maximum occupant load, and match its seating, furnishings, and layout.
- `venue_fdny_pa_permit_current_for_event_space`: yes means a current, unexpired FDNY Public Assembly Permit applies to that same space, PACO, and approved plan.

The PACO question renders those four component checks as an evidence checklist. They are guidance, not four persisted fields: any proved mismatch means no, every check proved means yes, and otherwise the organizer answers unknown.

## State, API, and Schema

- These fields replace `venue_has_assembly_approval` in the active intake registry. Its existing database column remains deprecated history and is never used to infer either new answer.
- `POST /api/events`, `GET /api/events/:id`, and `PATCH /api/events/:id` persist and reload both values through F-101's existing registry-derived flow.
- Editing either field increments `revision_counter`; regeneration writes both values into the new immutable plan's `intake_snapshot`.
- Migration 012 adds the two nullable enum-constrained columns and backfills qualifying existing draft rows to explicit `unknown`. It leaves other rows null and leaves the deprecated column unchanged.
- Migration 013 adds no column. It bumps `revision_counter` and `updated_at` on the drafts migration 012 backfilled whose latest plan snapshot is missing either new key, so a plan generated before these fields existed reads as stale and prompts regeneration — the same staleness rule an intake edit follows under AC 5. Its `down` is empty: decrementing would regress the event below a revision that may already have been evaluated, leaving the latest plan selected and read as current against the older event.

## Confirmation-Only Boundary

The two facts change no rule trigger, finding, deadline, branch, or verdict. They never imply that a temporary filing is or is not required, never select an amendment or other remedy, and never change a verification status. A known mismatch and an unknown answer remain confirmation context until separately approved published rule semantics make outcomes differ.

## Acceptance Criteria

1. The active registry declares exactly the two fields above with `yes / no / unknown`, the exact shared gate, and no rule trigger consuming either field; the coarse field is absent from the active registry.
2. At headcount 74 neither field is asked; at 75 and 76 both are asked for a private venue. Neither is asked at any headcount for another location type.
3. The UI shows the four PACO evidence checks, the fold guidance, and explicit Yes, No, and “I don't know” answers for both stored fields. It stores no silent default.
4. Create, read, edit, and later edit-form reload preserve each tri-state exactly. Values supplied outside the gate are rejected as not applicable.
5. Editing either answer bumps the event revision, marks an older plan stale, and regeneration stores both answers in the new plan's immutable intake snapshot without changing the finding set or verdict.
6. Scenario F fixture v7 replaces `venue_has_assembly_approval=unknown` with both new values as unknown. Its two material verdict branches, expected findings, deadlines, and CONDITIONAL verdict remain unchanged.
7. Migration 012 retains `venue_has_assembly_approval`, adds enum checks for both new columns, and backfills only in-scope existing drafts to unknown without deriving from the old value.
8. The shared nyc.v2.9 publication, baseline, PRD, roadmap, architecture, F-101, F-102, F-201, and fixture pointers move together; `nyc.v2.8` is never edited in place.
9. Migration 013 bumps `revision_counter` and `updated_at` on exactly the qualifying drafts whose latest plan snapshot is missing either new key — including a snapshot that carries one key and not the other — and leaves every other row, and every event whose latest snapshot carries both keys, untouched. It adds and drops no column, and its `down` performs no work.

## Non-Goals

- No no-TPA inference, new verdict branch, ruleset trigger, finding, deadline, remedy selection, unsupported regulatory copy, verification-status change, rooftop-height correction, component-field persistence, or mismatch-reason enum.
- No endpoint, response envelope, table, enum value, or dependency beyond the two approved columns and existing registry/API contracts.

## Fixtures and Tests

- Scenario F fixture v7.
- Private-venue threshold boundaries 74 / 75 / 76.
- All three values for both fields, out-of-scope rejection, API reload/edit, stale-plan regeneration snapshot, migration backfill, and unchanged Scenario F verdict branches.
- Migration 013's staleness bump over a snapshot missing both keys, a snapshot missing exactly one, and a snapshot carrying both.

## Allowed Footprint

The shared registry publication and its pins; `apps/api/migrations`, F-101 event/plan integration tests, the intake form and tests, scenario intake/acceptance fixtures, `docs/{PRD,ROADMAP,DESIGN,ARCHITECTURE,BASELINE,test-scenario-answer-key}.md`, and `specs/F-101`, `F-102`, `F-110`, and `F-201`.

## Rollout and Fallback

The registry, migration, API, UI, fixtures, and shared publication land atomically. If that coordinated publication cannot land, F-110 remains blocked; the product does not restore the coarse question or infer the new answers from it.
