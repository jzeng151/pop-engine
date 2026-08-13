# F-203 · Deadline Alerts

**Status:** APPROVED (2026-07-25; maximum reminder offset ratified 2026-07-26, product-owner approved, resolving the P1 on PR #125; outputs amended 2026-07-27 to name `event_alert_contacts`, product-owner approved on PR #131; AC 7 and the `dependency_unlocked` row amended 2026-07-27 to carry the destination and null `latest_apply_date` qualifiers the implementation already had, product-owner approved on PR #131) · **Reviewer/approver:** product owner + affected lane owners via the approval PR · **Owner:** see Lane below · see `docs/BASELINE.md`.
**Decision 2026-08-12:** APPROVED by the product owner under issue #258: an overall blocked plan never receives the FEASIBLE-AT-RISK slack-warning email.
**Decision 2026-08-12:** APPROVED by the product owner under issue #262: checklist-alert identity is event + alert type + published reminder offset where applicable + published rule + channel + canonical recipient, independent of generated task IDs and rendered copy. Migration 016 records the rule structurally and refuses ambiguous historical attribution rather than guessing.
**Phase:** 1 (core, week 2; happy path) · **Lane:** Dev 4 · **Depends on:** F-202 (scheduling happens at checklist creation) · **Feeds:** F-305/F-413 reuse the plumbing (post-MVP)

## User Story

As an independent organizer, I get an email/SMS before each filing deadline, including the ones that only unlock after another permit lands, so no agency window closes on me silently.

## Inputs

- `checklist_items` + their plan items' typed deadlines.
- Channels: SMTP (email), Twilio (SMS). Contact fields entered at checklist creation (no auth in MVP).

## Outputs

`alerts` rows, sent by the in-process poller (60s tick, ARCHITECTURE), plus one `event_alert_contacts` row per event holding where those alerts are sent (amended 2026-07-27, product-owner approved under governance §6; see `docs/BASELINE.md`).

The contact is a separate table rather than columns on an existing row because `alerts.recipient` has to stay the immutable record of where one message actually went, while "where do this event's alerts go" is a single mutable value per channel that exists before any message does and must survive a correction; `checklist_acknowledgements` was the real alternative, being already one row per event written by the same conversion, and it was not taken because a row that records which plan an organizer reviewed is not the place to keep an address they can edit afterwards.

`alerts` rows, by type:

| alert_type          | When scheduled                                                                                      |
| ------------------- | --------------------------------------------------------------------------------------------------- |
| deadline_reminder   | `latest_apply_date − 7 days` and `latest_apply_date − 1 day` per dated permit item                  |
| slack_warning       | immediately at checklist creation when the plan verdict is FEASIBLE-AT-RISK ("apply within N days") |
| dependency_unlocked | at `apply_after_date` for gated items (Parks→NYPD), null `latest_apply_date` included               |

A gated item with NO `latest_apply_date` still unlocks, and the reason it must is the load-bearing
part of this row. A null filing date is not an expired one. Under the product owner's decision on
the holiday calendar the pinned list is deliberately unpublished, so a null `latest_apply_date` is
the NORMAL state for every `business_days_minimum` finding rather than an edge case: reading null as
expired would silently suppress unlocks across most of the live ruleset, and it would look like
correctness. The complement is also true and is where the line actually falls: an unlock is NOT
scheduled once the gated item's `latest_apply_date` has passed, because that window has closed and
the plan already reports it as missed, so announcing it would put two surfaces on one requirement in
contradiction. Suppress on a date that has gone; never on the absence of one.

Reminder offsets (7/1) are config, not code: they are published at `config.alert_offsets.deadline_reminder.days_before` in the ruleset (nyc.v2.7 onward), keyed by `alert_type`. A later reminder kind therefore needs no change to the ruleset's own schema, only a new key — but that is a claim about the ruleset and not about persistence: migration 001 constrains `alerts.alert_type` to exactly `deadline_reminder`, `slack_warning` and `dependency_unlocked`, so a new kind cannot be inserted until an ordered forward migration widens that CHECK. Both steps are needed and the config shape only removes one of them. The offsets are PopEngine policy and never an agency deadline, which alert copy must not blur. A published offset must be a whole number of days from 1 to 3650. The ceiling is PopEngine policy, not an agency limit: it sits far above the longest window the ruleset publishes (60 days) so it never binds on a real deadline, while refusing values the calendar arithmetic cannot represent.

## Acceptance Criteria

1. Materializing a checklist schedules the correct alert set from the plan's typed deadlines; findings with `research_required` deadlines schedule nothing (no invented dates) and are listed in the checklist as "confirm lead time with agency."
2. The poller sends due alerts within 2 minutes of `send_at`, marks sent/failed, and retries failures on later ticks. Every alert row carries a `recipient` and an `idempotency_key`; a crash between send and mark-sent cannot double-send, and regeneration cancels obsolete pending alerts (status `cancelled`) rather than deleting them.
3. Hard floors are never softened: reminder copy for Parks-derived deadlines states "applications within 21 days of the event are not accepted."
4. Dependency alerts fire in sequence: for Scenario C's fixture, the sound-permit alert is gated on the Parks timeline, and copy names the dependency ("your Parks permit decision window has passed; file your NYPD sound permit at the precinct now").
5. Email path works end-to-end live. SMS: if Twilio A2P approval is in hand, live send; otherwise the in-product labeled simulation (DESIGN.md fallback; decision deadline end of week 1 per OPEN-QUESTIONS P-2).
6. `POST /api/events/:id/alerts/test` fires one real alert immediately (demo utility, visibly labeled "test").
7. Rescheduling: plan regeneration + checklist review recomputes pending alerts; a sent alert is never re-sent TO THE DESTINATION IT WAS SENT TO. A checklist alert's stable identity is its event, alert type, published reminder offset where applicable, published rule, channel, and canonical recipient — never its generated checklist task, date, disposition, or rendered copy. Membership, date, copy, disposition, and route-list changes therefore update or preserve that rule's row without adopting another rule's sent state. What makes a re-send legitimate is a different destination: a message addressed to a contact the organizer has since corrected never reached the corrected address, so that destination receives its own row. The sent row remains the delivery record; migration 016 may make it the canonical row when historical task identities converge, but does not rewrite its delivery state or content.
8. A `slack_warning` is scheduled only when the overall plan verdict is FEASIBLE-AT-RISK. An overall blocked/INFEASIBLE plan receives no at-risk warning even if its stored detail carries a numeric `minSlackDays`; per-finding deadline reminders remain governed by their own existing criteria.

## Phase 1 Scope Cut

Happy path only. Escalations, digests, team reminders, per-user preferences: Phase 2 (F-203 full, per ROADMAP).

## Edge Cases

- `send_at` already past at scheduling time (e.g. checklist created inside the 7-day window): send the reminder immediately once, don't drop it.
- Event date edited after scheduling: pending alerts recomputed on regeneration; stale pending alerts for removed items are cancelled.
- Twilio/SMTP outage: alerts stay pending with failure count; poller keeps retrying; nothing is lost.

## Answer-Key Scenarios Exercised

- C (dependency_unlocked sequencing).
- D (slack_warning: "apply within 10 days").
- A-rescoped (standard deadline_reminders on the private-venue plan).
