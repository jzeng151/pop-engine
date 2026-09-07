# F-202 · Compliance Checklist & Status Tracker

**Status:** APPROVED (2026-07-25; amendments preserved in [Approval history](#approval-history)) · **Reviewer/approver:** product owner · **Owner:** see Lane below · see `docs/BASELINE.md`.
**Phase:** 1 (core, week 2) · **Lane:** Dev 3 · **Depends on:** F-201 · **Feeds:** F-203 (alert scheduling), F-204 (portal links render on checklist items)

**Amendment 2026-08-30:** product-owner approved via issue #286. Acceptance Criterion 11 defines the checklist's blocker, task, and read-only context groups.

## User story

As an independent organizer, I turn my permit plan into a living checklist where I track each application's status and keep its documents, so execution has one home instead of seven agency portals.

## Inputs

- Latest `permit_plans` + `permit_plan_items` for the event.
- User actions: status changes, notes, file uploads.
- On a conversion or review, the id of the plan the organizer was being shown. Required, not
  optional: Acceptance Criterion 10 turns on the server being able to tell which plan was read, and
  a caller that does not say cannot have that checked.

## Outputs

- `POST /api/events/:id/checklist` → `checklist_items` rows (one per permit/insurance plan item). The checklist presentation gives `PROHIBITED_OR_INELIGIBLE` priority over finding kind, so blockers render read-only rather than as trackable tasks. Creation also schedules F-203 alerts.
  - Takes a JSON body naming the plan being displayed (`planId`). Absent or malformed, the request is refused (400) rather than defaulted to the latest plan, because defaulting is the behaviour Acceptance Criterion 10 exists to remove.
  - Where that plan is no longer the latest, the request is refused (409) and the response carries the newer plan's checklist so the organizer can be re-presented with it. Nothing is materialised and no review is recorded (Acceptance Criterion 10).
  - The pre-existing refusal when the EVENT has moved past the plan is unchanged and is also a 409; the two are distinguished by the stale-plan case naming the superseded plan id.
- `PATCH /api/checklist-items/:id` → status/notes update.
- `POST /api/checklist-items/:id/documents` → upload streamed to S3-compatible storage; metadata row in `documents`.
- `GET /api/documents/:id/url` → short-lived signed download URL.

## Acceptance Criteria

1. One click converts the latest plan into a checklist; each item stays linked to its plan item (and thus rule, deadline, citation, portal).
2. Statuses: not_started → in_progress → submitted → approved / rejected; any transition is allowed (agencies are messy), current status is always visible per item, and the event rollup counts current-plan items only. Retained items from an earlier plan are counted and labeled separately so the rollup never appears to omit visible rows.
3. Document upload accepts PDF/PNG/JPG up to 10 MB; the file lands in object storage; download works via signed URL; nothing binary in Postgres.
4. Notes persist per item.
5. Checklist shows each item's `latest_apply_date` (and `apply_after_date` when gated) so the deadline context lives where the work happens.
6. Regenerating the plan (rescope) prompts: existing checklist is kept but flagged "plan has changed; review items" with items no longer in the new plan struck through, new items appended. Nothing is silently deleted.
7. Demo path: Scenario A rescope → plan passes → checklist created → one status flipped and one document uploaded live.
8. The checklist response exposes each item's source-plan `ruleset_version` and `snapshot_date` through its existing plan-item relationship. Never copy these values from the live rules file or duplicate them in checklist storage.

   A row that is not struck through displays the latest plan item's values and provenance. A struck-through row displays its persisted plan item's values and provenance, even if a later plan raises the same requirement again. Read both values and provenance from the same item. F-206 Acceptance Criterion 4 uses this same distinction.

   The implementation derives terminal strike state from immutable intervening plan history, matching the complete rule-id set and kind. The lifecycle regressions in `apps/api/src/planning/checklist.test.ts` cover retained provenance, kind changes, returning identities, and unreviewed intervening plans.

9. **Moved computed deadline.** Compare the previous and current deadline only for an active task whose requirement survives in the latest plan. Show a notice when its date or deadline state changes, under the rules below.

   **Task identity and terminality**

   A requirement's identity is its complete rule-id set and kind. If a plan drops that identity or changes its kind, retain the old task struck through with its status, notes, documents, values, and source-plan provenance. A review never re-points that task, and it carries no moved-deadline notice.

   A struck-through task is terminal. If the identity returns, append a new unstarted task for a permit or insurance item; render other kinds as current read-only context. Never revive the old task or transfer its work to the replacement. This applies to both permit-to-insurance and permit-to-advisory changes, including a later return to permit, and to changes in intervening plans the organizer did not review. The requirement identity needs no third component. The existing UNIQUE `checklist_items.plan_item_id` prevents two tasks from pointing at one plan item.

   **Comparison inputs**

   The previous item is the one reached through `checklist_items.plan_item_id`, from the last conversion or review. The current item is the latest plan item with the same complete rule-id set and kind. Read both snapshots separately. Do not copy their dates into checklist storage or read them from the live rules file. The active row continues to display current values under F-206 Acceptance Criterion 4.

   Compare:

   - `latest_apply_date`. A date on only one side is a change; two absent dates are unchanged. Label the values previous and current, since the current date can fall before or after the previous date.
   - The complete stored deadline object: `type`, `qualification`, `display`, `boundary`, `calendarDays`, `businessDays`, `levels`, `unknownLevelBehavior`, `hardFloorDays`, and `processingRangeDays`. A new stored deadline field must join this comparison. Compare fields even when `type` is unchanged or neither snapshot has a calculable date.
   - `deadline_status`, grouped as dated, `not_calculable`, or `not_applicable`; `timeline_unresolved_reason`; `deadline_unknown_fields`; and `deadline_display`.
   - The presence of `apply_after_date`, which distinguishes a gated task from one with no gate. Read its sequencing explanation from stored `finding_renderings`.

   Read absent-date meanings from the engine. `not_applicable` means no independent dated filing window applies, including a `before_issuance` deadline listed with its parent permit. `not_calculable` means a window applies but cannot be dated, including an unpublished holiday calendar for `business_days_minimum` or a `research_required` lead time. Carry `timeline_unresolved_reason` or `deadline_unknown_fields` when present; otherwise show "confirm with agency". SPEC-CONFLICT #130 retains this production calendar fallback.

   `deadline_display`, `qualification`, and `display` carry substantive deadline information. For example, DOB-ASSEMBLY-001's three-business-day processing floor is stored in `output.deadline.qualification` and `output.deadline.display` in the published ruleset. Treat those strings as compared values.

   **Comparison exclusions**

   - `level_field` and `multi_block_field` are parsed into rule-level bindings and are absent from the stored deadline. A binding-only change that moves no compared value produces no notice.
   - Compare `apply_after_date` by presence, not its date value. Its value advances with `today` and the upstream decision window. An upstream `processingRangeDays` change is reported on the upstream row; a change that only narrows downstream slack does not produce a notice on the gated row.
   - Changes among `on_track`, `deadline_approaching`, and `published_deadline_missed` alone are countdown changes, not deadline-state changes. Acceptance Criterion 5 already displays them.

   **Notice output**

   |                | State unchanged        | State changed                     |
   | -------------- | ---------------------- | --------------------------------- |
   | Date unchanged | No notice              | State what changed                |
   | Date changed   | State both date values | State both date and state changes |

   Render date changes as follows:

   - A date on both sides: name the previous and current computed deadlines.
   - A previous date and a current `not_calculable` state: name the previous date, say the filing window cannot now be dated, and show the engine's reason or "confirm with agency" fallback.
   - A previous date and a current `not_applicable` state: name the previous date and say the requirement no longer has its own filing date. Do not describe this as a computation failure.
   - No previous date and a current date: say a deadline can now be computed and name it.

   State changes identify the previous and current states even when both dates are absent or unchanged. These include a change between `not_applicable` and `not_calculable`, a changed unresolved reason, or a changed published deadline type. Never describe an unchanged date as moved.

   **Previous-value provenance**

   Whenever a notice renders a previous date or deadline state, include that value's own `verification_status`, nullable `last_verified_date`, immutable `sources` snapshot with its citation and every URL, primary `source_url`, `conflict_text` when present, and source-plan `ruleset_version` and `snapshot_date`. Label these as previous values. Preserve `RESEARCH_REQUIRED` and `OFFICIAL_CONFLICT` on undated previous states as well as dated ones. An absent `last_verified_date` renders no verification date; never substitute `snapshot_date`.

   This is F-206's complete provenance set. Exclude deprecated `verified_status` and applicability-only `triggered_by`. Read the existing plan item, its source plan, and that plan's stored `finding_renderings`; this criterion adds no storage. Current provenance continues to follow F-206 Acceptance Criterion 4.

   **Clearing and limits**

   A successful review re-points active tasks to the acknowledged latest plan and clears the notice. If the snapshots pin different `ruleset_version`s, the notice may name both versions. It must not identify that difference as the cause: regeneration can include both an intake edit and a ruleset change.

   A computed deadline change establishes nothing about an application already filed with an agency. The notice must not state, imply, or link to a claim that a filing needs amendment, agency contact, re-application, or other action. It must also not claim that no action is required or that the filing is unaffected. Determining those obligations is outside F-202's approved scope, as resolved in SPEC-CONFLICT #121.

10. **A review acknowledges the displayed plan.** First conversion and every later review require the displayed `planId` under the Outputs contract. Missing or malformed IDs return 400. A conversion commits only if the displayed plan remains the latest and matches the event's current revision.

    If the displayed plan is superseded, return 409 with the newer plan's checklist, invite the organizer to review it, and materialize nothing and record no acknowledgement. Never silently substitute an unseen plan. If the event revision has moved past the plan, also return 409 and require regeneration. The superseded-plan response names the superseded plan ID so callers can distinguish these cases.

    On success, the plan acknowledged is the plan used to materialize and re-point active tasks. This preserves Acceptance Criteria 1, 6, 8, and 9. The superseded-plan and acknowledgement regressions in `apps/api/src/planning/checklist.test.ts` verify the refusal and successful-review paths. The old claim that superseded displayed plans were accepted is corrected under issue #319.

11. **Checklist groups state regulatory strength without changing the underlying plan.** The rendered checklist classifies a row by disposition before finding kind. Every `PROHIBITED_OR_INELIGIBLE` row appears in a visible `Blockers` section, including a permit or insurance row returned through the existing task list. A blocker shows its disposition and plan context but no status, notes, document, reminder, or completion control. A retained blocker keeps Acceptance Criteria 6 and 9's struck-through style and terminal notice so it cannot look current.

    Remaining permit and insurance rows appear under `Permit and insurance tasks`. A `MAY_BE_REQUIRED` task keeps every existing task control and visibly says `May be required`. Remaining read-only context appears under `Advisories and notifications`. The sections render in that order, use semantic headings, and disappear when empty. The checklist does not add a `No blockers` or other completeness claim when the blocker section is empty.

    The visible status rollup counts current rows from `Permit and insurance tasks` only. Retained task rows keep Acceptance Criterion 2's separate count, while blocker rows contribute no visible task status. This grouping changes presentation only. It changes no rule, trigger, disposition, verification status, verdict, API response, table, migration, task identity, stored status, document, reminder, or alert behavior.

## Edge cases

- Checklist created twice: idempotent; second call returns the existing checklist rather than duplicating.
- Upload failure (S3 unreachable): item keeps state, user sees a retryable error; no orphan metadata row.
- Plan with zero trackable permit/insurance items (synthetic edge case, not Scenario B): checklist creation is offered but produces an empty state with read-only context shown ("nothing to track; keep confirmation notes here if you like").

## Answer-key scenarios exercised

- A (demo path: rescoped plan → checklist).
- B (one conditional DOHMH permit item plus read-only context).
- C (gated item shows apply_after date on the checklist).

## Approval history

The original approval record is preserved below. Current criteria above incorporate those amendments. The 2026-09-06 readability cleanup and stale AC 10 correction are tracked in issue #319.

> **Status:** APPROVED (2026-07-25; moved-filing-date notice criteria added 2026-07-26, product-owner approved, resolving SPEC-CONFLICT #121; review-acknowledgement criterion added 2026-07-26, product-owner approved; AC 9 provenance floor and the AC 10 request contract recorded 2026-07-27, product-owner approved; AC 9 provenance floor rekeyed to a rendered previous state and the kind-transition outcome defined 2026-07-27, product-owner approved; that outcome rekeyed from trackability to kind identity 2026-07-27, product-owner approved; a struck-through task made terminal, the dependency gate added to the comparison and the provenance floor closed against F-206's enumeration 2026-07-27, product-owner approved; AC 8's attribution rekeyed to whether a row is struck through 2026-07-27, product-owner approved; two cross-references to F-206 Acceptance Criterion 4 corrected 2026-07-27, product-owner approved, one person holding every lane: one said F-206 still keys attribution on whether the latest plan raises the requirement and that its amendment was deliberately not made, which its own amendment has since made false, and one named F-206's second case by the superseded "still-required" label, which is wrong for exactly the terminally struck row. Both were true when written and were falsified by a later merge. Pointers only: no criterion changes what it decides and no regulatory fact is asserted; Acceptance Criterion 9's citation for DOB-ASSEMBLY-001's three-business-day processing floor is changed 2026-07-27 from a ruleset line range to the two field paths that carry it, product-owner approved, one person holding every lane. It resolved correctly when written, and the nyc.v2.9 publication planned to re-attribute that rule's filing-lead source edits `deadline.qualification`, which was one of the two cited lines, so the numbers and the content would have moved together with nothing reporting it. Pointer only: the criterion's point, that `deadline_display` is compared and is not mere wording, is unchanged, and no regulatory fact is asserted) · **Reviewer/approver:** product owner + affected lane owners via the approval PR · **Owner:** see Lane below · see `docs/BASELINE.md`.
