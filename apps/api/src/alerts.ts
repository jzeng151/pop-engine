// F-203 deadline alerts: what gets scheduled when a checklist is materialized, and the in-process
// poller that sends it (ARCHITECTURE "Alert Scheduling (no Redis)", AD-1, AD-4).
//
// Three things this file is careful about, because getting any of them wrong is a regulatory
// failure rather than a bug:
//
// 1. NOTHING IS INVENTED. An alert is scheduled from a date the engine computed, or it is not
//    scheduled at all. A finding whose deadline is `research_required`, or whose business-day
//    window cannot be computed against an unpublished holiday calendar, has no
//    `latest_apply_date` — so it gets no reminder, and the checklist keeps listing it as "confirm
//    with agency" (spec AC 1). There is no fallback date anywhere in this file.
// 2. THE OFFSETS ARE POPENGINE POLICY. `config.alert_offsets.deadline_reminder.days_before` is a
//    product decision, and the ruleset's own note says alert copy must never present an offset as
//    an agency deadline. Every reminder therefore states both: the agency's published deadline
//    text verbatim, and separately that the reminder timing is ours. Same treatment
//    `slack_warning_days` already gets ("internal planning buffer, NOT an official threshold").
// 3. A HARD FLOOR IS NEVER SOFTENED (AC 3). A composite deadline's floor is a cliff, so reminder
//    copy for one carries the floor sentence as well as the date.

import { createHash, randomUUID } from "node:crypto";
import { Router, type NextFunction, type Request, type Response } from "express";
import { Pool } from "pg";
import type { PoolClient, QueryResult, QueryResultRow } from "pg";
import { CONFIRM_WITH_AGENCY, DEPENDENCY_SEQUENCING_BINDINGS } from "@pop-engine/engine";
import type {
  Deadline,
  DeadlineStatus,
  Disposition,
  FindingRoute,
  VerificationStatus,
} from "@pop-engine/engine";
import {
  ALERT_CHANNELS,
  AlertDeliveryError,
  PROVIDER_TIMEOUT_MS,
  type AlertChannel,
  type AlertDelivery,
  type AlertSenders,
} from "./alert-delivery";
import {
  instantAtLocalHour,
  jurisdictionDayInSql,
  jurisdictionTimeZone,
  todayInJurisdiction,
} from "./calendar";
import { canonicalOptionalPhone } from "./contact";
import {
  calendarDateFrom,
  FILING_ORDER_DATE,
  FILING_ORDER_JOIN,
  renderingKey,
  type FindingRendering,
} from "./plan";

/** Mirrors the `alerts.alert_type` CHECK in migration 001. */
export const ALERT_TYPES = ["deadline_reminder", "slack_warning", "dependency_unlocked"] as const;
export type AlertType = (typeof ALERT_TYPES)[number];

/** Mirrors the `alerts.status` CHECK in migration 001. */
export const ALERT_STATUSES = ["pending", "sent", "failed", "cancelled"] as const;
export type AlertStatus = (typeof ALERT_STATUSES)[number];

/**
 * The local hour a dated alert is sent at. An engineering choice, not a published one: agency
 * deadlines are calendar days, and a day has to become an instant somewhere. Morning in the
 * jurisdiction's own timezone is the working day the reminder names.
 */
const SEND_HOUR_LOCAL = 9;

/** ARCHITECTURE: "an in-process poller in Express ticks every 60s". AC 2 allows 2 minutes. */
export const POLL_INTERVAL_MS = 60_000;

/** AC 2: "the poller sends due alerts within 2 minutes of `send_at`". Named so it can be reasoned with. */
export const DELIVERY_BOUND_MS = 120_000;

/**
 * How long a failed alert waits before it is eligible again.
 *
 * Not a cap on retries — the spec's outage edge case is explicit that nothing is dropped and the
 * poller keeps trying. It is a cap on how much of the batch a destination that will never accept
 * anything is allowed to consume. The first retry is immediate, because one failure is usually a
 * blip and delaying it would itself spend the delivery budget; from the second it grows fast,
 * because by then the evidence says otherwise.
 */
const RETRY_BACKOFF = `CASE
       WHEN alerts.failure_count + 1 <= 1 THEN interval '0'
       WHEN alerts.failure_count + 1 = 2 THEN interval '1 minute'
       WHEN alerts.failure_count + 1 = 3 THEN interval '5 minutes'
       ELSE interval '15 minutes'
     END`;

/**
 * How many sends are in flight at once, and how long a tick may keep starting new ones.
 *
 * TWO REQUIREMENTS CONSTRAIN EACH OTHER HERE AND BOTH ARE REAL. A dead provider must not stall the
 * poller (the previous round's finding), and a healthy one must clear the due set inside AC 2's
 * two-minute bound (this one). Bounding the batch fixed the first and, on its own, broke the
 * second: a cap on how much a tick processes is also a cap on throughput, so a large enough due
 * set missed the bound by design rather than by failure. The arithmetic, written down because the
 * temptation is to raise a number until it happens to work:
 *
 *   At concurrency C with per-send duration d, a tick starts C × ⌊B/d⌋ sends before the budget B
 *   stops it. A FAILING send costs d = `PROVIDER_TIMEOUT_MS`; a healthy one costs a fraction of a
 *   second. So the same tick that clears the `MAX_ALERTS_PER_TICK` scan in a couple of seconds
 *   against a live provider gets through C × 3 against a dead one.
 *
 * The fix is not a bigger C. It is that the poller no longer waits out the interval when it knows
 * work is left: a tick that abandons rows re-runs immediately (`start`), so the interval became a
 * floor for an IDLE poller instead of a ceiling on a busy one. Throughput stops being
 * "C × ⌊B/d⌋ per I" and becomes "C/d, continuously", which is the same quantity the provider
 * itself can absorb.
 *
 *   HEALTHY (d ≈ 0.2s, C = 8): ~40 alerts a second sustained. The scan cap, not the clock, is what
 *   a tick hits, and the backlog drains at the rate the provider accepts work.
 *   FULLY DEAD (d = 10s, C = 8): 24 attempts per ~40-second tick, back-to-back — nothing is
 *   delivered because nothing can be, and the spec's outage edge case governs: retry, lose
 *   nothing.
 *   PARTIAL OUTAGE, which is the case that matters: a deliverable alert behind K untried dead ones
 *   is reached after K/C × d ≈ K × 1.25s, so the two-minute bound holds for K up to ~96. Past that
 *   it is a single-tick transient, not a standing condition, because `failure_count` ordering puts
 *   every attempted dead row behind every untried one from the next scan onward.
 *
 * NONE OF THOSE FIGURES DEPEND ON HOW THE DUE SET IS DISTRIBUTED ACROSS EVENTS, and that is a
 * correction rather than a restatement. While ownership was taken exclusively, C applied across
 * events only: one checklist's own reminders queued behind each other, so an event with N due
 * alerts took N × d however idle the other seven workers were — four dated items on two channels
 * is sixteen slots, which at a timing-out provider is 160 seconds for one organizer. With the
 * event held in SHARED mode the workers stop excluding each other and N alerts for one event cost
 * exactly what N alerts spread over N events cost: N/C × d. The same sixteen now take 0.4s
 * healthy, or 20s with every one of them timing out, inside a single budget.
 *
 * MAXIMUM SUSTAINABLE DUE-RATE: ~40 alerts/second with a live provider, whether they belong to one
 * event or forty. One checklist schedules on the order of ten alerts and they are spread across
 * calendar days, so the instantaneous due set is single or double digits — three orders of
 * magnitude of headroom.
 *
 * WORST-CASE TICK is unchanged at `TICK_BUDGET_MS` + `PROVIDER_TIMEOUT_MS` = 40 seconds, and the
 * budget's job has changed rather than gone: it no longer exists to fit inside the interval (the
 * `runningTick` guard is what guarantees that) but to force a re-scan often enough that the
 * `failure_count` ordering stays current and newly-cancelled rows stop being sent.
 *
 * C is eight against the poller's OWN pool (`index.ts`), not the API's. Sharing the API's ten
 * connections was what pinned it at four; a dedicated pool removes the coupling, so the API keeps
 * every connection it had while a provider times out.
 */
/**
 * Alerts whose plan the event has been edited past, which must not go out.
 *
 * THE WORST FAILURE ON THIS PR, and unlike every other one it is not about an alert missing,
 * duplicating or arriving incomplete. Editing an event increments `events.revision_counter` and
 * nothing else; the alert rows still hang off checklist items pointing at the OLD plan, and they
 * were delivered on time, looking entirely correct, carrying a filing date the current event does
 * not have. Telling an organizer a deadline that is not theirs is the failure this product exists
 * to prevent, and the exposure lasted until they happened to regenerate.
 *
 * HELD, NOT CANCELLED, and the spec decides that rather than a new principle. AC 2 says
 * "regeneration cancels obsolete pending alerts (status `cancelled`)", and the Edge Cases row says
 * "pending alerts recomputed on regeneration; stale pending alerts for removed items are
 * cancelled". Both assign the cancelling to the REVIEW. A poller that cancelled here would be
 * deciding on its own authority that PopEngine no longer intends to send something, when in fact
 * the edit may not have touched the date at all and the next review may schedule the identical
 * alert. So these rows stay pending and simply stop being claimable: the review then either
 * confirms them, or the reconciler cancels them for not being in the recomputed set, which is where
 * the spec puts that decision. If the organizer never regenerates, nothing is delivered either way
 * — the difference is only whether the row lies about having been withdrawn.
 *
 * TWO BRANCHES, because two kinds of row reach their plan differently.
 *
 * Most alerts hang off a checklist item, so the plan is a join away and the join reads the plan's
 * LIVE revision, which is better than any snapshot.
 *
 * The plan-level slack warning has no checklist item, and the previous round left it out on the
 * argument that it is scheduled with `send_at` of now and therefore goes out seconds later, leaving
 * no window for an edit. That half of the argument was wrong. A warning whose send FAILS goes into
 * backoff — up to fifteen minutes by `RETRY_BACKOFF` — and stays pending or failed for as long as
 * delivery is broken. So the sequence is: the warning fails, the organizer edits the event,
 * delivery recovers before they regenerate, and the old plan's slack figure goes out. The window is
 * not seconds, it is however long the outage lasts.
 *
 * The other half of that argument does still stand, and the distinction is worth keeping rather
 * than flattening: a slack warning states a risk figure and an evaluation date, NOT an agency
 * deadline. It cannot deliver a wrong filing date, which is what made the checklist-backed case
 * severe. This is a correctness fix, not that one again.
 *
 * WHY THE PAYLOAD AND NOT A COLUMN. The warning is scheduled from the plan row, which already
 * carries `event_revision`, so the number is in hand at the moment the row is written and costs a
 * jsonb field rather than a migration. The payload is already read for facts rather than only copy
 * — `payload->>'test'` is what keeps demo sends out of the reconciler and out of the failure count
 * — so this is the existing pattern rather than a new use of the column. A real column was
 * available, 009 and 010 being unshipped, and would have bought nothing here.
 *
 * WHY NOT CANCEL IT INSTEAD, which was the cheapest option on the table. Cancelling needs a writer
 * that knows the event was edited, which means `events.ts` reaching into alerts on the intake path,
 * and it would give one class of problem two different answers: hold the checklist-backed rows,
 * cancel this one. The outcomes converge anyway — a cancelled warning is revived by the reconciler
 * if the next plan carries the same key — so the split would buy nothing and cost the single rule.
 *
 * Test sends carry no checklist item and no revision, so they are deliberately unaffected: a demo
 * alert is an operator action against no deadline.
 */
/**
 * Whether this alert's filing window has shut, as of the day passed in.
 *
 * WRITTEN ONCE AND ASKED TWICE, which is the point. The tick sweeps closed windows before it builds
 * its queue, and that queue then runs for up to `TICK_BUDGET_MS`, so a tick that sweeps just before
 * local midnight could start sending copy whose filing date had become yesterday while the queue
 * drained. The sweep was correct and the claim never re-asked.
 *
 * THE GENERAL RULE, because this is the third instance and a fourth is otherwise a matter of time:
 * A DECISION MADE ABOUT AN ALERT MUST BE REVALIDATED WHEREVER THE ALERT IS ACTED ON. Round 16 had
 * the tick treating a skipped alert as finished work while the alert itself knew better. Round 24
 * had scheduling refusing to CREATE an alert for a closed window while delivery never asked the
 * same question. This is sweep-versus-claim. Every one of them is a check that was right at one
 * layer and absent at the next, and the fix each time was to ask it again at the point of action
 * rather than to make the earlier check stronger.
 *
 * The claim is the point of action, and it is also the only safe point: it runs under the event
 * lock, so what it reads is a state no review is midway through changing.
 */
export const FILING_WINDOW_HAS_SHUT = (day: string): string => `(
       (
         alerts.payload->>'controlling_apply_by' IS NULL
         -- AND IT IS NOT A ROUTE-SCHEDULED ALERT, which is the other half of the same rule and was
         -- missing. The date below says which window this alert is about; this says the item column
         -- is not it. A route-scheduled dependency_unlocked, a gated route with an apply_after_date
         -- and no published filing deadline, has no date to carry, so it fell into this branch and
         -- was retired the day after a DIFFERENT route's window shut. Nothing had shut: the route
         -- it is about publishes no window at all.
         AND alerts.payload->>'route_scheduled' IS NULL
         AND EXISTS (
           SELECT 1
             FROM checklist_items AS closed_checklist
             JOIN permit_plan_items AS closed_item
               ON closed_item.id = closed_checklist.plan_item_id
            WHERE closed_checklist.id = alerts.checklist_item_id
              AND closed_item.latest_apply_date IS NOT NULL
              AND closed_item.latest_apply_date < ${day}::date
         )
       )
       -- coalesce, because this expression is now NEGATED at the claim as well as asserted at the
       -- sweep. Without it a row carrying no controlling date yields NULL rather than false, the
       -- sweep harmlessly does not match it, and NOT NULL makes it permanently unclaimable. A
       -- predicate that is only ever asserted can be three-valued; one that is also negated cannot.
       --
       -- THE PAYLOAD DATE WINS OVER THE ITEM COLUMN WHERE BOTH EXIST, which is why the first branch
       -- is guarded rather than left as a plain OR. An alert scheduled off one route of a merged
       -- dedupe line counts down to THAT route's published window, and the item column carries the
       -- window of whichever route the merged line reads. Read as a disjunction, a reminder for a
       -- route whose window is still open would be retired the day after a DIFFERENT route's window
       -- shut. The row that names its own controlling date is the row that knows which window this
       -- alert is about, so nothing else gets to answer for it.
       OR coalesce((alerts.payload->>'controlling_apply_by')::date < ${day}::date, false)
     )`;

/**
 * Whether this upsert is giving the row a FRESH SCHEDULE, as opposed to recomputing the same one.
 *
 * THE FOURTH TRANSITION RULE ON THIS CLAUSE, written where the other three are. Round 9 decided an
 * unchanged destination keeps its evidence. Round 11 decided a corrected address gets its own row.
 * Round 27 decided a derived value cannot outlive what it was derived from. This decides when the
 * schedule itself is new, and both schedule-derived columns read it so they cannot disagree; the
 * predicate used to be written out twice, which is how one of them acquired a branch the other
 * lacked.
 *
 * A REVIVAL IS A FRESH SCHEDULE. A cancelled row was not in the queue while it was cancelled, so
 * its stored `send_at` is not a record of having been due — it stopped being due. Returning it to
 * `pending` with a `send_at` from before the cancellation made it deliverable immediately, recorded
 * as blowing AC 2's bound by however long it sat, and sorted ahead of genuinely older work.
 *
 * A MISSING `intended_at` MEANS THE SCHEDULE DID NOT CHANGE, and that is a decision rather than an
 * accident of NULL comparison, so it is stated. The plan-level slack warning is the only alert with
 * no intended slot: it is due at the moment it is written, and `NULL IS DISTINCT FROM NULL` is
 * false, so it takes this branch on every review. That is the right answer for it. Such a warning
 * has been genuinely due since it was written, so keeping its `send_at` reports real lateness
 * rather than manufacturing freshness, and its backoff is evidence about a destination that has not
 * changed, which is round 9. The case where an old `send_at` is NOT a record of being due is
 * revival, and that is handled above rather than by widening this.
 */
const HAS_A_FRESH_SCHEDULE = `(
       alerts.status = 'cancelled'
       OR alerts.payload->>'intended_at' IS DISTINCT FROM EXCLUDED.payload->>'intended_at'
     )`;

const NOT_FROM_A_STALE_PLAN = `NOT EXISTS (
       SELECT 1
         FROM checklist_items AS stale_checklist
         JOIN permit_plan_items AS stale_item ON stale_item.id = stale_checklist.plan_item_id
         JOIN permit_plans AS stale_plan ON stale_plan.id = stale_item.plan_id
         JOIN events AS stale_event ON stale_event.id = stale_plan.event_id
        WHERE stale_checklist.id = alerts.checklist_item_id
          AND stale_plan.event_revision < stale_event.revision_counter
     )
     AND NOT EXISTS (
       SELECT 1
         FROM events AS plan_level_event
        WHERE plan_level_event.id = alerts.event_id
          AND (alerts.payload->>'event_revision') IS NOT NULL
          AND (alerts.payload->>'event_revision')::int < plan_level_event.revision_counter
     )`;

/**
 * How many alerts one tick hands to a provider at once.
 *
 * Exported because the budget arithmetic is checked against it. The check used to read the poller's
 * pool size instead, which was the same number until the pool was resized and then quietly said
 * sixteen waves where the poller runs eight.
 */
export const SEND_CONCURRENCY = 8;
/**
 * How long a tick waits between re-trying alerts a writer's lock made it skip, and for how long.
 *
 * THE WINDOW IS SMALL ON PURPOSE, and it is what keeps this a recovery rather than a wait. Taking
 * the event row with `SKIP LOCKED` instead of blocking is a deliberate choice made further down:
 * a review in progress is about to decide the alert's fate, and queueing behind it is how the
 * poller once delivered the very alert a cancellation existed to prevent. Retrying for the whole
 * tick budget would quietly undo that and, worse, hold one tick hostage to one event's writer while
 * every other event's alerts wait behind it.
 *
 * So this recovers the ORDINARY case — a review that commits in milliseconds, which is the case
 * :1064 is about — and leaves a genuinely long-held lock costing one tick, exactly as before. Two
 * seconds is sixty times shorter than `DELIVERY_BOUND_MS` and sixty times shorter than the interval
 * the skip used to cost.
 */
const SKIPPED_RETRY_WAIT_MS = 250;
const SKIPPED_RETRY_WINDOW_MS = 2_000;
/**
 * How long the poller waits before a follow-up scan when a whole tick was skipped.
 *
 * The tick's own retry window covers a writer that commits while the tick is running. This covers
 * the one that does not: the tick ends having attempted nothing, and waiting out the interval for
 * work that is sitting there is what puts a healthy provider past AC 2. Same shape as the retry
 * inside the tick, one level up, and bounded for the same reason.
 */
const SKIPPED_FOLLOW_UP_WAIT_MS = 2_000;
export const TICK_BUDGET_MS = 30_000;

/**
 * How many due alerts one scan will claim — DERIVED, because choosing it independently of the
 * concurrency and the timeout is what let the code claim coverage it did not have.
 *
 * The last of N simultaneously-due alerts waits `N × T / C` when every send times out. At C = 8
 * and T = 10s a scan of 100 therefore needed 125 seconds to reach its final row, past the bound
 * before any polling delay is added — the cap said 100 and the arithmetic supported 96. Tying them
 * together means the number cannot drift from what it can deliver again: raise the concurrency or
 * shorten the timeout and this rises with them.
 */
/**
 * How many alerts one pass may claim, sized to the budget that is actually LEFT when it starts.
 *
 * The bound this protects runs from `send_at`, and the tick's clock starts when the tick starts.
 * Those differ by up to a whole polling interval: an alert that falls due just after a scan has
 * already spent that interval waiting before anything looks at it. Sizing the batch against the
 * full `DELIVERY_BOUND_MS` therefore handed the provider a budget the alert no longer had, and a
 * pass of timing-out sends could run past the bound with every counter reporting health — 95 email
 * sends timing out at ten seconds each is eleven waves, and the healthy one behind them started at
 * about 170 seconds from its own `send_at`.
 *
 * Subtracting the maximum polling delay is what makes the arithmetic honest: a full first pass, at
 * the provider's worst case, now fits inside what remains of the bound rather than inside all of
 * it. The alert that waited the longest is the one the cap has to hold for.
 *
 * TWO BOUNDS, NOT ONE, and the second is the tighter of them today. The polling delay says how much
 * of the DELIVERY budget is left; `TICK_BUDGET_MS` says how long this tick may keep claiming at
 * all. Sizing against the first alone selected 48 rows when three ten-second waves at eight
 * concurrent sends can only attempt 24, so a scan routinely handed itself work it had to abandon,
 * and fresh alerts queued behind rows the previous pass had already taken its turn on. A cap should
 * never exceed what the tick can actually attempt: the scan and the budget now agree, and
 * `abandoned` goes back to meaning something unusual happened rather than being the normal state of
 * a busy tick.
 *
 * IT INTERACTS WITH `drained` AND THAT IS THE FIX WORKING. A smaller cap means more scans come back
 * at their limit, which reports not-drained and triggers the immediate rescan. Throughput is
 * unchanged because the rescan is immediate; what changes is that a wave of failures can be
 * demoted by `next_attempt_at` before the alerts behind them are attempted. It cannot spin: an
 * empty scan is not full and abandons nothing, so it reports drained and the timer takes over.
 */
export const MAX_ALERTS_PER_TICK = Math.floor(
  (SEND_CONCURRENCY * Math.min(DELIVERY_BOUND_MS - POLL_INTERVAL_MS, TICK_BUDGET_MS)) /
    PROVIDER_TIMEOUT_MS,
);

/** What the poller's own pool has to hold: every concurrent send, plus the scan that feeds them. */
export const ALERT_POLLER_CONNECTIONS = SEND_CONCURRENCY + 1;

/**
 * How long the email provider honours a repeated `Idempotency-Key`, per Resend's published
 * documentation. Inside it a retry of an attempt whose outcome was lost is deduplicated; outside
 * it the same retry is a second delivery to the same person.
 *
 * This is the number that makes an unresolved attempt reconcilable rather than sendable, so it is
 * named once and read by the scan, the claim and the tests.
 *
 * Migration 014's backfill carries a FROZEN COPY of this value rather than a read of it, because
 * what a migration did to a database it has already run against cannot depend on a number that is
 * still moving. Changing this constant does not change that seed, and is not meant to: a change to
 * the provider's window that has to reach existing rows is a new ordered migration.
 */
export const PROVIDER_DEDUP_WINDOW_HOURS = 24;

/**
 * How much of that window is kept in reserve rather than spent, because the decision and the
 * delivery are not the same moment.
 *
 * The predicate below is evaluated at the top of the claim transaction. What still has to happen
 * before the provider holds the request: the event lock, the claim SELECT, the expiry SELECT, a
 * connection from the attempt-writer's own pool, the intent INSERT, and then the request in flight.
 * Reading the cutoff exactly meant an attempt at 23h59m was ruled retryable and the repeated key
 * arrived after 24h, where the provider deduplicates nothing and the organizer gets a second copy
 * of the same reminder.
 *
 * `TICK_BUDGET_MS + PROVIDER_TIMEOUT_MS` is not a new number: it is the poller's worst-case tick,
 * already named at the top of this file. It is deliberately generous for a single claim, and it is
 * the right size because the SCAN uses this predicate too, and a scanned row can wait a whole tick
 * before its claim runs. One margin that is sound at both sites beats two that have to be kept in
 * step. Erring large costs a forty-second sliver of an otherwise-permitted retry window, which the
 * next tick re-offers as a hold; erring small costs a real person a duplicate.
 */
export const DEDUP_WINDOW_CLAIM_MARGIN_MS = TICK_BUDGET_MS + PROVIDER_TIMEOUT_MS;

/**
 * How long an attempt nobody saw the end of holds its alert before the alert is retried anyway.
 *
 * THE PRODUCT OWNER'S DECISION OF 2026-08-04, resolving SPEC-CONFLICT #240 against approved F-203
 * (`docs/BASELINE.md`). The hold used to have no end, so a provider outage presenting as timeouts
 * for longer than the dedup window withheld a filing reminder for good — the outcome F-203:59 and
 * AC 2 exist to prevent. Bounded, the hold keeps the suppression over the period where it can help
 * and gives the reminder back afterwards. This limit is the CEILING HALF OF AN EARLIER-OF: the
 * owner's same-day resolution of SPEC-CONFLICT #241 (`docs/BASELINE.md`) also ends the hold on the
 * last day a retry can still reach the organizer inside the filing window, so this number governs
 * every alert whose lead time outlasts it and the window edge governs the rest. The predicate
 * below carries both.
 *
 * DERIVED, not chosen round. Two things fix the range:
 *
 * - The FLOOR is `PROVIDER_DEDUP_WINDOW_HOURS` plus `DEDUP_WINDOW_CLAIM_MARGIN_MS`, because that is
 *   where the hold starts. A limit at or below it would mean no row is ever held: that is option 1
 *   in #240, which the owner did not take.
 * - The CEILING is the six days between F-203's two `deadline_reminder` offsets, 7 days before the
 *   deadline and 1 day before it. A reminder released later than that arrives after its own
 *   successor has already gone out, so the release can no longer restore any lead time and can only
 *   read as a duplicate.
 *
 * Between them the limit is also the maximum delay the release adds and, during an outage that
 * stays ambiguous, the maximum rate of possible duplicates: one per alert per limit, because each
 * retry opens its own attempt and re-enters the hold under it. Both argue for the smallest value
 * that still leaves a real reconciliation period, and a limit a few minutes above the floor leaves
 * none. Two dedup windows is the smallest whole multiple of the only interval the provider actually
 * publishes that clears the floor — one does not, by the claim margin — and it is a third of the
 * ceiling.
 *
 * WHAT EITHER SIDE OF IT COSTS AN ORGANIZER. Past it: possibly a second copy of a reminder that did
 * arrive, naming the same deadline, 48 hours after the first, and for a 7-day reminder still five
 * days before the filing date. Inside it: a reminder whose send never reached anyone is delayed by
 * up to 48 hours, which a 7-day reminder absorbs and a 1-day reminder does not; held to this limit
 * alone it would arrive after its deadline, and the window edge of the earlier-of is what releases
 * it on its last filing day instead. No limit above the floor saves the 1-day reminder from that
 * delay, because its whole lead time is shorter than the window the provider deduplicates within. That is the cost of holding at
 * all, and it is why this is the smallest multiple that works rather than a larger one.
 */
export const UNRESOLVED_ATTEMPT_HOLD_LIMIT_HOURS = PROVIDER_DEDUP_WINDOW_HOURS * 2;

/**
 * What the send boundary keeps back for the handoff it sits in front of.
 *
 * ASKING WITH NOTHING RESERVED WAS THE FOURTH DEFECT ON THIS MARGIN. Every earlier reader of the
 * cutoff decides and then waits, so each holds back enough of the window to cover what follows it;
 * the boundary check was written as the one that needs nothing, on the grounds that the request is
 * all that follows. The request is not free: `sender(...)` still has DNS, the TCP and TLS
 * handshakes and the body transmission in front of it, and `alert-delivery.ts` bounds that whole
 * thing — connection setup included — with `PROVIDER_TIMEOUT_MS`. A key permitted at 23h59m59s can
 * therefore reach Resend after 24 hours, where it deduplicates nothing.
 *
 * SO THE MARGIN IS STATED AS WHAT IT MUST COVER, and it is exactly two things: the bounded provider
 * request, and the in-process gap between this answer and the request leaving. The second is
 * `SEND_BOUNDARY_HANDOFF_BUDGET_MS`, and it is ASSERTED rather than assumed at the point of use, so
 * a fifth statement inserted between the boundary and the sender cannot silently consume the margin
 * the way the last three did. It fails closed: over budget, nothing is handed over.
 */
const SEND_BOUNDARY_HANDOFF_BUDGET_MS = 1_000;
export const SEND_BOUNDARY_MARGIN_MS = PROVIDER_TIMEOUT_MS + SEND_BOUNDARY_HANDOFF_BUDGET_MS;

/**
 * An alert whose send was attempted and whose outcome nobody ever saw, long enough ago that a
 * provider holding it would no longer recognise the key.
 *
 * ATTEMPTED, WHICH IS WEAKER THAN HANDED OVER AND HAS TO STAY SO WHEREVER THIS IS DESCRIBED. The
 * attempt row is written before `sender(...)` is called, so a process that died between the two
 * leaves precisely what one that died mid-send leaves, and this predicate cannot tell them apart.
 * Every reader of it (the poller's telemetry, the organizer's notice) says "attempted" for that
 * reason, and the stronger claim has had to be taken back out of three of them.
 *
 * NOT AN AGE TEST ON THE ALERT, and that is the whole distinction issue #166 turns on. A pending
 * row with no recorded attempt is safe to send at any age — it cannot duplicate a delivery that
 * never happened, and suppressing it by age would convert one possible duplicate into systematic
 * non-delivery for a product whose purpose is that a filing deadline does not pass unnoticed. Only
 * a row that WAS attempted, and whose attempt has no recorded outcome, is ambiguous.
 *
 * Held rather than sent and rather than cancelled: sending may deliver a second copy, cancelling
 * would assert PopEngine no longer intends to send something when in fact nobody knows whether it
 * arrived. The tick counts these so they can be reconciled against the provider by a human.
 *
 * AND HELD FOR A BOUNDED TIME, which is the product owner's 2026-08-04 resolution of SPEC-CONFLICT
 * #240 (`docs/BASELINE.md`). Past `UNRESOLVED_ATTEMPT_HOLD_LIMIT_HOURS` the attempt stops holding
 * its alert and the alert is retried, because an unbounded hold is how F-203's outage edge case
 * ("nothing is lost") was being broken by the mechanism meant to protect a duplicate. The retry
 * opens an attempt of its own, so an outage that keeps producing unobserved outcomes re-enters the
 * hold under the new attempt rather than sending on every tick: at most one possible duplicate per
 * alert per limit.
 *
 * MEASURED FROM THE FIRST UNRESOLVED ATTEMPT, WHICH IS WHY THIS ASKS FOR A MINIMUM RATHER THAN FOR
 * ANY ROW. Nothing holds an alert for the dedup window after its first attempt, so an ambiguous
 * outage retries it on every tick of that window and each retry opens an attempt of its own. Asked
 * as "does SOME unresolved attempt sit between the two edges", the bound then restarts from the
 * newest of them: an attempt made just before the hold began kept the alert suppressed for nearly
 * another dedup window past the point the first attempt's own bound had run out, and every cycle
 * of a continuing outage moved that further out again. That is the open-ended suppression #240 was
 * raised about, arriving more slowly, and 48 hours from whichever retry ran last is not the 48
 * hours the owner approved. The oldest unresolved attempt is the one the hold is measured from, so
 * the alert is released no later than `UNRESOLVED_ATTEMPT_HOLD_LIMIT_HOURS` after it, whatever the
 * outage does in between.
 *
 * THAT ONLY STAYS A HOLD BECAUSE A RETRY RETIRES WHAT IT OVERTOOK: see `recordAttemptIntent`. An
 * attempt left unresolved past its bound would anchor every later bound in the past, so no attempt
 * could hold this alert again and the outage would send on every tick from then on.
 *
 * AND BY THE ALERT'S OWN REMAINING WINDOW, WHICHEVER OF THE TWO COMES FIRST. The limit is a fixed
 * number of hours and the thing it holds is a reminder that expires, so on any alert with less lead
 * time than the limit has hours the limit lands after the filing date: the released row reaches the
 * claim, its window has shut, and it is cancelled without the provider ever being called. That is
 * the one-day reminder exactly, and for it a 48-hour hold is not a hold but a silent drop — the
 * outcome F-203:59 and AC 2 exist to prevent, produced by the mechanism that was bounded to stop
 * producing it. A retry that cannot be delivered is not the retry the 2026-08-04 decision approved.
 *
 * So the hold also ends on the last day a retry can still reach the organizer while the filing date
 * can be met, which is `FILING_WINDOW_HAS_SHUT` asked about TOMORROW: while the window is still
 * open tomorrow, holding costs the organizer nothing they can still use; once it is not, today is
 * the last day the queue can do anything with this row and the hold ends here. The limit is
 * unchanged and still the ceiling — a seven-day reminder has six days of window and is held for the
 * full 48 hours — and nothing about its recorded approval moves. APPROVED BEHAVIOUR, not a
 * selected policy: the product owner's 2026-08-04 resolution of SPEC-CONFLICT #241
 * (`docs/BASELINE.md`) decides the earlier-of in favour of retrying, accepting that on the final
 * filing day, past the key's expiry, an organizer whose original send did arrive may receive one
 * correctly dated second copy.
 *
 * WHAT THE EARLIER RELEASE COSTS is the same cost the owner already priced at the limit, arriving
 * sooner: a possible second copy of a reminder that did arrive. The provider still deduplicates a
 * repeated key inside its own window, so the rate is unchanged at one possible duplicate per alert
 * per dedup window, and it is spent on the last day the reminder can be acted on rather than on a
 * day the deadline has already gone.
 *
 * WHAT IT DOES NOT REACH, recorded rather than claimed as conformance: an alert whose window shuts
 * before ANY tick can retry it — an attempt left unresolved in the last minutes of the filing date
 * — is cancelled by the next tick and nothing is delivered. No bound saves that row, because there
 * is no moment left to send it in. Whether PopEngine should say anything after a filing date has
 * gone is a product question and not this file's to answer; `docs/OPEN-QUESTIONS.md` T-10 carries it,
 * and the approved behaviour (a shut window is retired, not announced) stands until it is answered.
 *
 * A BACKFILLED `-infinity` IS PAST EVERY LIMIT, and that is the right reading of it rather than an
 * oversight. Migration 014 seeded that value precisely because the attempt time is unknowable, so
 * no bound measured from it can ever contain the row, and nothing will ever make it knowable. Those
 * rows were retried on every tick before this branch existed, which is what F-203 asks for.
 *
 * AN ATTEMPT SPEAKS FOR THE SCHEDULE IT WAS MADE FOR AND NOT FOR A LATER ONE, which is why
 * `superseded_at` is read here. Scoped to the alert id alone, this predicate outlived the queue
 * membership it belonged to: a regeneration cancelled a row carrying an unresolved attempt, a
 * later one revived it as a fresh schedule, and the old attempt then excluded the revived row from
 * every scan and every claim for good. That is not a duplicate avoided, it is a deadline reminder
 * that is never delivered — the outcome F-203 exists to prevent, and worse than the duplicate this
 * hold was added to avoid. The revival supersedes the attempt; the attempt row stays, still
 * unresolved, because nobody did find out what the provider did with it.
 */
const unresolvedAttemptPastTheCutoff = (now: string, marginMs: number, day: string): string => `(
     EXISTS (
       SELECT 1
         FROM alert_send_attempts AS attempt
        WHERE attempt.alert_id = alerts.id
          AND attempt.outcome_recorded_at IS NULL
          AND attempt.superseded_at IS NULL
       -- HAVING rather than a second WHERE clause, so this stays one boolean over one aggregate:
       -- an alert with no unresolved attempt produces a NULL minimum, the group is filtered out,
       -- and EXISTS is false. Written as a scalar subquery instead it would be NULL there, and
       -- every reader that NEGATES this predicate would drop the row rather than send it.
       HAVING min(attempt.attempted_at)
              < ${now} - interval '${PROVIDER_DEDUP_WINDOW_HOURS} hours'
                       + interval '${marginMs} milliseconds'
          AND min(attempt.attempted_at)
              >= ${now} - interval '${UNRESOLVED_ATTEMPT_HOLD_LIMIT_HOURS} hours'
     )
     -- THE SECOND BOUND, asked as the first one asked about tomorrow: a hold may keep this alert
     -- only while tomorrow is still a day the reminder could be sent on. An alert with no filing
     -- date has no such bound and is held by the limit alone, which is the same reading of a null
     -- the rest of this file takes: an absent date is not an expired one.
     AND NOT ${FILING_WINDOW_HAS_SHUT(`(${day}::date + 1)`)}
   )`;

/**
 * `statement_timestamp()` RATHER THAN `current_timestamp`, which is the same distinction the send
 * boundary draws and the same defect on the other side of it. `current_timestamp` is the
 * TRANSACTION's start, and this predicate is read from inside one: a checklist review holds a
 * transaction open across several reads so the checklist and its alerts commit together, so an
 * attempt that crosses the provider's dedup window WHILE the review runs is read as though the
 * review had only just begun. The response then calls the row a failure PopEngine keeps retrying
 * while the poller, on its own statement clock, reads the same row as one it has stopped on the
 * moment `COMMIT` releases the event lock.
 *
 * Not `clock_timestamp()` either, and that is not the arbitrary half of the choice: it advances
 * DURING a statement, this predicate appears four times in the health statement alone, and a
 * cutoff that could differ between two of them would let one statement disagree with itself,
 * which is exactly what `alertDeliveryHealth` was written as one statement to prevent.
 */
const hasAnUnresolvedAttempt = (day: string): string =>
  unresolvedAttemptPastTheCutoff("statement_timestamp()", DEDUP_WINDOW_CLAIM_MARGIN_MS, day);

/**
 * An alert the poller has stopped on, written once for both readers of it.
 *
 * THE ONLY DEFINITION OF A HOLD, because two of them disagreed. The tick counts a held alert to
 * warn an operator, and the checklist counts one to tell an organizer that PopEngine has paused a
 * filing reminder and that only a person checking with the sending service resolves it. Those are
 * the same claim about the same row, and they were two statements listing their own conditions:
 * the tick asked whether the alert was DUE and the checklist did not. A regeneration that moves a
 * previously attempted alert forward keeps the row and its unresolved attempt and rewrites
 * `send_at`, so the organizer was sent after the provider about a reminder the poller was doing
 * nothing but waiting for a date on, and if the bound passes first it simply sends, which makes
 * the reconciliation they were asked for a thing that was never happening. Copy an organizer reads
 * about a filing deadline does not get to be false in order to be present.
 *
 * A SECOND MATCHING FILTER WOULD BE THE SAME DEFECT AGAIN, one edit from now. Both readers take
 * this expression, so the next condition either side gains is a condition both sides gain.
 *
 * WHAT THE PRODUCT RETIRES BY ITSELF IS NOT A HOLD, which is what the staleness and shut-window
 * exclusions are for. Regeneration cancels a row the organizer's own edit has moved past, and the
 * next tick withdraws one whose filing window has closed; the scan and the claim let that second
 * one through deliberately so it can be cancelled without being sent. Saying that only a person
 * checking with the sending service resolves either would be a false alarm, and a false alarm on
 * every tick is also how a genuine hold gets buried. A demo send (AC 6) is excluded for the same
 * reason: nobody is waiting on it and no deadline is behind it.
 *
 * The day is a parameter because the two statements bind their time zone in different positions,
 * and it is the jurisdiction's day for the reason `FILING_WINDOW_HAS_SHUT` states: a hold is only
 * a hold while the deadline it is about still exists.
 */
const HELD_FOR_RECONCILIATION = (day: string): string => `(
       alerts.status IN ('pending', 'failed')
       AND alerts.send_at <= statement_timestamp()
       AND coalesce(alerts.payload->>'test', 'false') <> 'true'
       AND ${NOT_FROM_A_STALE_PLAN}
       AND NOT ${FILING_WINDOW_HAS_SHUT(day)}
       AND ${hasAnUnresolvedAttempt(day)}
     )`;

/**
 * The same question asked at the last statement before the provider, reserving what that statement
 * still has in front of it.
 *
 * WHAT THE MARGIN COVERS, STATED SO IT CAN BE CHECKED: the in-process gap between this answer and
 * `sender(...)` being called, which `SEND_BOUNDARY_HANDOFF_BUDGET_MS` bounds and
 * `handoffFitsTheMargin` asserts, plus the provider request itself, which `PROVIDER_TIMEOUT_MS`
 * bounds end to end including DNS and the TLS handshake. Nothing else may sit between the two, and
 * the assertion is what makes that a checked property of the code rather than a comment about it.
 * Reserving nothing here was the fourth defect on this margin: it read the request as instant.
 *
 * `clock_timestamp()` RATHER THAN `current_timestamp`, because this runs inside the sending
 * transaction and `current_timestamp` is that transaction's START. Reading it here would answer as
 * of the moment the claim opened and miss precisely the elapsed time this check exists to catch.
 *
 * ASKED AT THE BOUNDARY RATHER THAN BOUNDING EACH WAIT, which is the third time a step was added
 * between the revalidation and the send: the writer's connection, then the filing-window recheck.
 * Bounding them one at a time makes the next insertion the next defect. A statement placed in front
 * of the sender cannot reopen this, because the question is asked after all of them by
 * construction.
 */
const heldAtTheSendBoundary = (day: string): string =>
  unresolvedAttemptPastTheCutoff("clock_timestamp()", SEND_BOUNDARY_MARGIN_MS, day);

/**
 * The other half of that margin: that the handoff it reserved for is the only thing that happened.
 *
 * The margin covers a bounded request and a gap this side controls. Only the request is bounded by
 * anything outside this file, so the gap is the part a later edit can grow — the last three defects
 * on this margin were each a statement added in front of the sender. Checked at the point of use,
 * an insertion that spends more than the budget stops the send instead of taking the reservation
 * with it, and the case it protects (a duplicate reminder to a real organizer) cannot come back
 * silently.
 */
const handoffFitsTheMargin = (boundaryAskedAt: number, now: number): boolean =>
  now - boundaryAskedAt <= SEND_BOUNDARY_HANDOFF_BUDGET_MS;

/**
 * The last day the bounded handoff in front of the provider can still be running on.
 *
 * The invariant this serves is stated beside the one the dedup margin states, so the fifth defect
 * on a margin is not a sixth: THE FILING WINDOW MUST STILL BE OPEN WHEN THE REQUEST THAT THE
 * BOUNDARY PERMITS CAN LAST UNTIL.
 *
 * WHY THE BOUNDARY'S OWN ANSWER IS NOT ENOUGH. `FILING_WINDOW_HAS_SHUT` asked about today is true
 * or false of that whole day, so it says nothing about how much of the day is left. A final-day
 * reminder reaching the boundary in the last second before local midnight passes it, and
 * `sender(...)` then has DNS, the TCP and TLS handshakes and the body transmission in front of it,
 * bounded end to end by `PROVIDER_TIMEOUT_MS`. The message can reach Resend on the day after the
 * one the window was open on, telling an organizer to file by yesterday: the exact copy the
 * window check exists to prevent, produced by a check that returned the right answer.
 *
 * SO THE WINDOW IS ASKED ABOUT THIS DAY, NOT COMPARED TO IT, and that distinction is the whole of
 * what the day comparison got wrong. Requiring the handoff to finish on the day the boundary asked
 * about refuses EVERY alert in the last `SEND_BOUNDARY_MARGIN_MS` of every day, whatever its
 * deadline is and whether it has one at all: a reminder whose filing date is next week loses those
 * minutes of every day to a reservation held for the final-day one, and a row with no filing
 * window (an AC 6 demo, or a `dependency_unlocked` whose gated item has a null
 * `latest_apply_date`, which F-203 schedules deliberately) is refused to protect a date that does
 * not exist. A null filing date is not an expired one, here as everywhere else in this file. Only
 * the alert whose window actually shuts overnight is held back, and it is held back by the same
 * predicate that decides every other window question.
 *
 * NOT A NEW ALLOWANCE, which is the point of naming the quantity rather than subtracting one at
 * the point of use. What must fit is the bounded handoff, and that is already named:
 * `SEND_BOUNDARY_MARGIN_MS`, the same reservation the dedup edge keeps back, for the same two
 * things (the in-process gap and the request). One quantity, two edges; a change to what the
 * handoff costs moves both.
 *
 * DERIVED WHERE IT IS USED, like every other jurisdiction day this file reads: it is a function of
 * the clock, so a value computed before a wait is an answer about a day the wait may have ended.
 *
 * FAILS CLOSED, and nothing is owed afterwards when it does: the window is shutting, so there is
 * no later moment inside it for a retry to use, and the next tick retires the row.
 */
const dayTheHandoffCanLastUntil = (jurisdiction: string, now: number): string =>
  todayInJurisdiction(jurisdiction, new Date(now + SEND_BOUNDARY_MARGIN_MS));

/**
 * Ask the send boundary, stamping the margin's anchor as the question goes out.
 *
 * THE ANCHOR IS THE QUESTION AND NOT THE ARRIVAL OF THE ANSWER. The result of this statement has a
 * return trip and an event-loop turn in front of it, so a backend that has already computed
 * `clock_timestamp()` can have its answer read here appreciably later. Stamped when this frame
 * resumes, a delayed answer looks exactly as fresh as an instant one: `handoffFitsTheMargin` then
 * measures only what happened after the delay, passes, and the key reaches the provider outside
 * the window it deduplicates within — the duplicate reminder this boundary exists to prevent,
 * permitted by the reservation meant to prevent it.
 *
 * ONE CLOCK, DELIBERATELY, and this is the part not to re-derive. The other way to close it is to
 * return the database's own `clock_timestamp()` and measure from that, which is the moment the
 * answer is really about. It was not taken: it puts a Postgres clock and this process's clock on
 * either side of a `SEND_BOUNDARY_HANDOFF_BUDGET_MS` budget of one second, so ordinary NTP drift
 * or a container clock offset lands directly in the measurement and the guard starts refusing or
 * permitting sends for a reason that has nothing to do with the gap it exists to measure. A local
 * stamp taken BEFORE the statement is issued is guaranteed to be at or before the backend's
 * evaluation whatever the two clocks say, so it can only over-count the gap, and over-counting is
 * the safe direction for a check whose job is to refuse when the time it reserved has gone.
 *
 * STAMPED AND ISSUED IN ONE CALL, so that guarantee is a property of the code rather than a note
 * about it: there is no separate stamp for a later edit to leave behind when it moves the query,
 * and nothing can be inserted between the two.
 */
async function askTheSendBoundary(
  client: PoolClient,
  alertId: string,
  day: string,
  handoffDay: string,
): Promise<{ askedAt: number; shut: boolean; shutByTheHandoffsEnd: boolean; held: boolean }> {
  const askedAt = Date.now();
  const { rows } = await client.query<{
    shut: boolean;
    shut_by_the_handoffs_end: boolean;
    held: boolean;
  }>(
    // Both window questions in the one statement that already asks the cutoff, for the reason the
    // statement exists: what went wrong twice was not a question but the gap after it, and a
    // second round trip for the handoff's day would be a new gap in the place there is none left.
    `SELECT ${FILING_WINDOW_HAS_SHUT("$2")} AS shut,
            ${FILING_WINDOW_HAS_SHUT("$3")} AS shut_by_the_handoffs_end,
            ${heldAtTheSendBoundary("$2")} AS held
       FROM alerts WHERE id = $1`,
    [alertId, day, handoffDay],
  );
  return {
    askedAt,
    shut: rows[0]?.shut === true,
    shutByTheHandoffsEnd: rows[0]?.shut_by_the_handoffs_end === true,
    held: rows[0]?.held === true,
  };
}

/**
 * How long the test endpoint waits for a poller that claimed its row first.
 *
 * Derived from the delivery timeout rather than picked, because those are the same wait: the
 * endpoint is waiting for exactly one provider request, and it does not matter which side of the
 * process issued it. A fixed 600ms was shorter than a send is allowed to take, so a poller that
 * won the claim and then succeeded in a second produced a 502 moments before the send committed.
 */
const TEST_ALERT_CLAIM_WAIT_MS = 200;
const TEST_ALERT_CLAIM_ATTEMPTS = Math.ceil(PROVIDER_TIMEOUT_MS / TEST_ALERT_CLAIM_WAIT_MS) + 2;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Queryable = {
  query<Row extends QueryResultRow>(text: string, values?: unknown[]): Promise<QueryResult<Row>>;
};

/**
 * Where an event's alerts go. Entered at checklist creation and no earlier — there is no auth in
 * the MVP (AD-5), so there is no account to read an address off (spec Inputs).
 *
 * Deliberately not persisted on `events`: that schema is a shared contract and a column on it needs
 * the product owner's approval under governance §6 (AGENTS.md). The alert rows already carry `recipient` because AD-13 put
 * it there, so they are the record, and a regeneration that supplies no contact reads the
 * addresses back off the alerts already scheduled for the event.
 */
export type AlertContacts = { readonly email: string | null; readonly phone: string | null };

export const NO_CONTACTS: AlertContacts = { email: null, phone: null };

/**
 * A change to those contacts, where `undefined` means "the request said nothing about this" and
 * `null` means "clear it". The two are different instructions and collapsing them deletes data:
 * every checklist review that omits a field would wipe whatever is stored for it.
 */
export type AlertContactsUpdate = {
  readonly email?: string | null;
  readonly phone?: string | null;
};

export type AlertScheduleSummary = {
  /** New rows written by this call. */
  readonly scheduled: number;
  /** Pending or failed rows the recomputed set no longer contains (AC 7). */
  readonly cancelled: number;
  readonly channels: readonly AlertChannel[];
  /** Set when nothing could be scheduled, so a caller can say why rather than showing zero. */
  readonly reason: string | null;
};

/**
 * Recompute an event's alerts against the plan a checklist was just materialized from.
 *
 * Called inside the materialization transaction, so a checklist and its alerts land together or
 * not at all.
 */
export type AlertScheduler = (
  client: PoolClient,
  eventId: string,
  planId: string,
  contacts: AlertContactsUpdate,
) => Promise<AlertScheduleSummary>;

export type AlertSchedulerSettings = {
  /** `config.alert_offsets.deadline_reminder.days_before`, validated at boot by `ruleset.ts`. */
  readonly reminderDaysBefore: readonly number[];
  /** `config.slack_warning_days.value`, named in slack-warning copy as PopEngine's own buffer. */
  readonly slackWarningDays: number;
  /** The jurisdiction whose calendar day a send hour belongs to. */
  readonly jurisdiction: string;
  readonly now?: () => Date;
};

type PlanAlertRow = {
  checklist_item_id: string | null;
  rule_ids: string[];
  permit_name: string | null;
  agency: string | null;
  deadline: Deadline | null;
  latest_apply_date: Date | string | null;
  apply_after_date: Date | string | null;
  deadline_status: DeadlineStatus;
  fee_display: string | null;
  portal_name: string | null;
  portal_url: string | null;
  disposition: Disposition;
  verification_status: VerificationStatus;
};

type PlannedAlert = {
  readonly alertType: AlertType;
  readonly checklistItemId: string | null;
  readonly sendAt: Date;
  readonly subject: string;
  readonly body: string;
  /**
   * What makes this alert the same alert across regenerations. Combined with the channel into the
   * row's `idempotency_key`, which is what keeps a sent alert from being sent again (AC 7).
   */
  readonly identity: string;
  /**
   * The event revision this alert's plan was evaluated at, for the one row the staleness JOIN
   * cannot reach. Only the plan-level slack warning sets it; everything else finds its plan
   * through `checklist_item_id`, and reading the plan's live row beats trusting a snapshot.
   */
  readonly planEventRevision?: number;
  /**
   * The published window this alert is about, for rows the sweep cannot reach through an item.
   *
   * The plan-level slack warning sets it because it hangs off no checklist item at all. A
   * ROUTE-SCHEDULED alert sets it for the other half of the same reason: it does hang off an item,
   * but the item's `latest_apply_date` is the window of whichever route the merged line reads, and
   * this alert counts down to its OWN route's window. Where the merged line's binding route
   * publishes none the column is NULL, and `FILING_WINDOW_HAS_SHUT` reads only that column, so the
   * window never shut: a reminder held in retry backoff would still be delivered saying "file by
   * 2026-08-31" after that date had passed, which is the outcome that predicate exists to prevent
   * (#252 review). Two further readers inherit it — `HELD_FOR_RECONCILIATION` tells the organizer a
   * live filing reminder is paused about a deadline already gone, and
   * `unresolvedAttemptPastTheCutoff`'s earlier-of bound stops being reachable.
   *
   * Everything else still hangs off an item whose own `latest_apply_date` IS its window, which is
   * live rather than a snapshot, so it stays unset there.
   *
   * `null` is a VALUE here and `undefined` is the absence of one, and the two mean different things
   * to the upsert: it merges payloads, so only an explicit null can clear a date an earlier
   * generation wrote. A producer that controls this field writes null where its subject publishes
   * no window; a producer that does not control it leaves the field undefined and the key is never
   * written at all.
   */
  readonly controllingApplyBy?: string | null;
  /**
   * That this alert was scheduled off ONE route of a merged dedupe line, whether or not that route
   * published a window to record above.
   *
   * `controllingApplyBy` alone was not enough to say it. It is only written where the route has a
   * date, so a route-scheduled `dependency_unlocked` — a gate with an `apply_after_date` and no
   * `latest_apply_date` — carried nothing, and `FILING_WINDOW_HAS_SHUT` fell through to the item
   * column. That column is the window of whichever route the merged line READS, so this alert was
   * retired the day after a DIFFERENT route's window shut, which is the exact outcome that
   * predicate's own comment says must not happen. A gated route with no published filing deadline
   * has no window that can shut, and it must be able to say so.
   *
   * So the two are read together: the date answers where there is one, and this says the item
   * column may not answer where there is not. Absent on every alert that is not route-scheduled,
   * including every row written before this field existed, so those keep reading the column that
   * is genuinely theirs.
   */
  readonly routeScheduled?: true;
  /**
   * The slot this alert was MEANT for, before it was clamped forward if that moment had passed.
   *
   * Stored so a review can tell a genuine reschedule from recomputing an already-past slot. The
   * plan-level warning has none: it is due at the moment it is written, so there is no earlier
   * intent for it to differ from.
   */
  readonly intendedAt?: string;
  /**
   * The identity this same alert had BEFORE plans stored route lists, for a route-keyed alert only.
   *
   * THE DEPLOY BOUNDARY IS A RE-KEYING, and a re-keying is how this file delivers something twice.
   * A plan generated before the route list existed carries none, so `alertSubjects` returns the
   * merged line itself and its reminders are keyed without a route. The first regeneration after
   * the deploy expands that same line into its routes and keys each one, the reconciler will not
   * touch a `sent` row, and the route-keyed row is INSERTED and delivered — the same subject and
   * the same body to the same recipient, twice. That is the identical duplicate a merged line's
   * dated-route count crossing 1 to 2 produced, arriving through the deploy instead of through a
   * regeneration, and F-203 AC 7 forbids it just the same.
   *
   * So the row that already said those words is given the key of the alert that would say them
   * again, once, before the upsert runs. Matched on the STORED SUBJECT rather than on which route
   * is binding, because binding is not stable across generations and the subject is the thing the
   * organizer would receive a second time: whichever route reproduces the words, that is the alert
   * the old row is. Where no route reproduces them, nothing is adopted and nothing is duplicated,
   * because nothing is about to be sent in those words at all.
   *
   * Self-limiting. After one regeneration every row on the line is route-keyed, no legacy key
   * remains to match, and the adoption is a no-op for the rest of the deployment's life.
   */
  readonly legacyIdentity?: string;
};

const isoDate = (value: Date | string | null): string | null =>
  value === null ? null : calendarDateFrom(value);

/**
 * The published deadline text and portal instructions the plan stored per finding. Reminder copy
 * quotes them rather than restating them, so an organizer reads the agency's own words.
 */
async function renderingsForPlan(
  database: Queryable,
  planId: string,
): Promise<Map<string, FindingRendering>> {
  const { rows } = await database.query<{ finding_renderings: FindingRendering[] | null }>(
    "SELECT verdict_detail->'finding_renderings' AS finding_renderings FROM permit_plans WHERE id = $1",
    [planId],
  );
  return new Map(
    (rows[0]?.finding_renderings ?? []).map((rendering) => [
      renderingKey(rendering.rule_ids),
      rendering,
    ]),
  );
}

type PlanVerdictRow = {
  verdict: string;
  verdict_detail: { minSlackDays?: number | null };
  today: string;
  event_revision: number;
};

async function planVerdict(database: Queryable, planId: string): Promise<PlanVerdictRow | null> {
  const { rows } = await database.query<PlanVerdictRow>(
    `SELECT verdict, verdict_detail, verdict_detail->>'today' AS today, event_revision
       FROM permit_plans WHERE id = $1`,
    [planId],
  );
  return rows[0] ?? null;
}

/**
 * The plan's requirements with the checklist row each became, in filing order.
 *
 * A LEFT JOIN because only permit and insurance lines become tasks (F-202): an advisory has no
 * checklist row, and an alert about a line the organizer is not tracking is noise. Rows with no
 * task are skipped rather than scheduled against a null `checklist_item_id`, which is reserved for
 * the plan-level slack warning.
 *
 * FILING ORDER IS THE DATE THE ROW RENDERS, not the column. `item.latest_apply_date` is the binding
 * route's, and a merged dedupe line whose binding route publishes no window leaves it NULL while
 * the line still files under another route's dated one. Ordering on the column alone sorted such a
 * line last under a docstring promising filing order, which is the last surviving instance of the
 * read-the-column class this branch removed everywhere else. It is decorative here — nothing about
 * an alert's content or identity depends on the order these rows arrive in — and it is corrected
 * anyway, because the next reader of this function has no way to tell a deliberate exception from
 * the four places that were defects. Same join and same expression the checklist orders by, so the
 * two surfaces cannot drift.
 */
async function planAlertRows(database: Queryable, planId: string): Promise<PlanAlertRow[]> {
  const { rows } = await database.query<PlanAlertRow>(
    `SELECT checklist.id AS checklist_item_id, item.rule_ids, item.permit_name, item.agency,
            item.deadline, item.latest_apply_date, item.apply_after_date, item.deadline_status,
            item.fee_display, item.portal_name,
            item.portal_url, item.disposition, item.verification_status
       FROM permit_plan_items AS item
       LEFT JOIN checklist_items AS checklist ON checklist.plan_item_id = item.id
       ${FILING_ORDER_JOIN}
      WHERE item.plan_id = $1
      ORDER BY ${FILING_ORDER_DATE} NULLS LAST, item.permit_name, item.rule_ids`,
    [planId],
  );
  return rows;
}

/**
 * One scheduling subject: a plan row read through ONE of its published routes.
 *
 * A merged dedupe line has one `latest_apply_date` column and one `permit_name`, and both belong to
 * the binding route. Where that route publishes no window the columns carry none, so scheduling off
 * them dropped every reminder for a requirement whose OTHER route publishes a dated window — on the
 * shipped ruleset that is DOB-TENT-001's 15-business-day window on every plan where
 * DOB-TALL-STRUCTURE-001 binds, and it deleted both of the organizer's reminders (#252 review).
 *
 * Each route schedules on its own window and is named by its own rule, so no reminder quotes one
 * route's date under another route's name. `routeRuleId` is null for an unmerged row, which is
 * every row on a plan with no dedupe group: those are the row itself, unchanged in every field.
 */
type AlertSubject = {
  readonly row: PlanAlertRow;
  readonly rendering: FindingRendering | undefined;
  readonly routeRuleId: string | null;
};

const subjectFromRoute = (
  row: PlanAlertRow,
  rendering: FindingRendering | undefined,
  route: FindingRoute,
): AlertSubject => ({
  row: {
    ...row,
    rule_ids: [route.ruleId],
    permit_name: route.name,
    agency: route.agency,
    deadline: route.deadline,
    latest_apply_date: route.latestApplyDate,
    apply_after_date: route.applyAfterDate,
    deadline_status: route.deadlineStatus,
    fee_display: route.feeDisplay,
    portal_name: route.portalName,
    portal_url: route.portalUrl,
    // THE GRAMMAR COMES FROM THE SAME ROUTE AS THE NOUNS. `isSettledRequirement` reads this column
    // to choose between "file by <date>" and "may be required ... if it applies", and leaving the
    // merged line's value here paired ONE route's name and date with the GROUP's certainty. The
    // group's disposition is the strongest any route offers, so a `may_be_required` route was
    // reminded imperatively wherever any sibling was `required` — PopEngine asserting a requirement
    // the ruleset hedges — and a `required` route was softened to "may be required" wherever the
    // group's headline was capped by an unresolved sibling.
    //
    // `verification_status` is NOT taken per route, and that is not an omission:
    // `rejectMixedDedupeVerificationStatuses` refuses at load any dedupe key whose members mix
    // statuses, so the group's value is the route's value and `FindingRoute` carries none.
    disposition: route.disposition,
  },
  rendering:
    rendering === undefined
      ? undefined
      : {
          ...rendering,
          deadline_display: route.deadlineDisplay,
          slack_days: route.slackDays,
          portal_instructions: route.portalInstructions,
        },
  routeRuleId: route.ruleId,
});

/**
 * The routes a row schedules from. An unmerged row is itself, so nothing about its alerts moves;
 * only a row that stored a route list expands, and only into routes that publish a date to schedule
 * against.
 */
function alertSubjects(row: PlanAlertRow, rendering: FindingRendering | undefined): AlertSubject[] {
  const routes = rendering?.routes;
  if (routes == null || routes.length < 2) return [{ row, rendering, routeRuleId: null }];
  return routes
    .filter((route) => route.latestApplyDate !== null || route.applyAfterDate !== null)
    .map((route) => subjectFromRoute(row, rendering, route));
}

const requirementLabel = (row: PlanAlertRow): string => row.permit_name ?? row.rule_ids.join(", ");

const withAgency = (row: PlanAlertRow): string =>
  row.agency === null ? requirementLabel(row) : `${requirementLabel(row)} (${row.agency})`;

/** The filing route, published as a portal, an instruction, or both. */
function filingRoute(row: PlanAlertRow, rendering: FindingRendering | undefined): string[] {
  const lines: string[] = [];
  if (row.portal_name !== null) {
    lines.push(
      row.portal_url === null ? row.portal_name : `${row.portal_name} — ${row.portal_url}`,
    );
  }
  if (rendering?.portal_instructions != null) lines.push(rendering.portal_instructions);
  return lines;
}

/**
 * AC 3. A composite deadline's `hard_floor_days` is a cliff the ruleset states applications inside
 * are not accepted, so a reminder that only counts down to a date would soften it by omission.
 * Both the floor sentence and the rule's own published display string travel with every reminder
 * for such a deadline; the number comes from the rule, never from this file.
 */
function hardFloorSentence(deadline: Deadline | null): string | null {
  if (deadline === null || deadline.type !== "composite") return null;
  return `Applications within ${deadline.hardFloorDays} days of the event are not accepted.`;
}

/**
 * The one sentence that keeps a PopEngine reminder from reading as an agency requirement. The
 * ruleset's `alert_offsets` note requires it in these words' substance: "PopEngine reminder policy,
 * NOT an agency deadline; UI and alert copy must never present an offset as one."
 *
 * `late` is the case the first version got wrong. An offset only describes when the reminder is
 * SENT if the checklist existed on that day. Create one three days before filing and the 7-day
 * reminder goes out immediately — three days before, while the words claimed seven. The offset is
 * still the honest name for which reminder this is, so it stays; what changes is that the sentence
 * stops asserting a delivery time it can see is untrue.
 */
const offsetPolicyNote = (days: number, late: boolean): string => {
  const slot = `${days} ${days === 1 ? "day" : "days"}`;
  return late
    ? `This is PopEngine's ${slot}-before reminder, sent now because your checklist was created ` +
        `after that day had already passed. The reminder schedule is PopEngine policy, not an ` +
        `agency deadline.`
    : `PopEngine sends this reminder ${slot} before the filing date. That reminder schedule is ` +
        `PopEngine policy, not an agency deadline.`;
};

/**
 * What a reminder must say when it arrives before the gated item's window is expected to open.
 *
 * THE ORDERING PROBLEM IS REAL AND THE OBVIOUS FIX REPEATS LAST ROUND'S MISTAKE. With ~26–32 days
 * of runway the 7-day reminder for a gated permit falls before `apply_after_date`, so an
 * organizer is told to file and only later told they can pursue it. Two messages, contradictory
 * order.
 *
 * The tempting repair is to move the reminder to `apply_after_date`, or drop it. Both assert that
 * the date is a gate on FILING, and it is not: it is today plus the EARLIEST end of the upstream's
 * published processing range — the soonest a decision could come back. The dependency rule's own
 * verification block says a strict issued-before-filed sequence is NOT confirmed by located
 * primary text, and `proposals.ts` §7 says the same in as many words: "never as a prohibition on
 * filing sooner". This is the identical misreading that put "your decision window has passed"
 * into the unlock copy last round, arriving from the other side — there it turned an expected
 * date into an observed outcome, here it would turn it into a bar on acting early.
 *
 * So the reminder keeps its date and gains the sequence it sits inside. The organizer learns both
 * things at once instead of learning them in a contradictory order, and PopEngine still asserts
 * nothing about the ordering that the rule declines to confirm.
 */
const sequenceNote = (upstream: PlanAlertRow, openOn: string): string =>
  `This filing is sequenced after your ${withAgency(upstream)}, whose decision is expected no ` +
  `earlier than ${openOn}. Filing before then may still be possible — the order is not confirmed ` +
  `by published text, so confirm it with the agency.`;

/**
 * Whether the plan says this requirement applies, or only that it might.
 *
 * A dated finding is not the same as a settled one. `MAY_BE_REQUIRED` is what the engine assigns
 * when a trigger came back `unknown` or a rule publishes the hedge itself, and the date beside it
 * is the deadline that would apply IF it applies. An imperative "file by" over that turns the
 * ruleset's uncertainty into a requirement PopEngine invented, which is the failure AGENTS.md
 * names: an unresolved state stays visible end to end.
 */
const isSettledRequirement = (row: PlanAlertRow): boolean => row.disposition === "required";

/**
 * A published enum token as an organizer reads it. The same transformation the checklist row
 * applies, so one requirement does not arrive named two ways on two surfaces.
 */
const humanizeToken = (token: string): string => token.replace(/_/g, " ");

/**
 * A published verification state, attributed to the requirement it belongs to.
 *
 * ONE FORMAT, THREE BUILDERS, and this is the shared half rather than the whole of it. The
 * dependency alert and the slack warning both name several requirements, so both have to say WHOSE
 * status each one is, and writing that format out by hand in two places is how the third finding on
 * this requirement got written. The reminder keeps its own unlabelled `Verification: X`, because it
 * is about one requirement that the whole message already names, and labelling it would change
 * shipped copy for no gain. That difference is a copy decision rather than a duplication, and it is
 * recorded here so the next reader can tell the two apart.
 */
const verificationLine = (subject: string, status: VerificationStatus): string =>
  `Verification of your ${subject}: ${humanizeToken(status)}`;

const confirmationLine = (
  subject: string,
  status: VerificationStatus,
  rendered: readonly (string | null | undefined)[] = [],
): string | null =>
  status === "RESEARCH_REQUIRED" && !rendered.some((line) => line?.includes(CONFIRM_WITH_AGENCY))
    ? `${subject}: ${CONFIRM_WITH_AGENCY}`
    : null;

function reminderCopy(
  row: PlanAlertRow,
  rendering: FindingRendering | undefined,
  applyBy: string,
  daysBefore: number,
  timing: {
    readonly late: boolean;
    readonly pendingUpstream: PlanAlertRow | null;
    readonly openOn: string | null;
  },
): { subject: string; body: string } {
  const settled = isSettledRequirement(row);
  const body = [
    settled
      ? `${withAgency(row)}: file by ${applyBy}.`
      : `${withAgency(row)} may be required for your event. If it applies, file by ${applyBy}.`,
    rendering?.deadline_display == null
      ? null
      : `Published deadline: ${rendering.deadline_display}`,
    hardFloorSentence(row.deadline),
    // THE VERIFICATION STATE, on every reminder rather than only where prose happens to mention
    // it. AGENTS.md keeps SOURCE_CONFIRMED, OFFICIAL_CONFLICT, RESEARCH_REQUIRED and COVERAGE_GAP
    // visible END TO END, and a notification is an end: it is the copy an organizer acts on, and
    // for a reminder that arrives by SMS it may be the only place they read the requirement at
    // all. Carrying the conflict prose covered exactly one status and left the ordinary confirmed
    // case saying nothing, which is the case where silence reads as "this is settled" — true for
    // SOURCE_CONFIRMED and wrong for the rest. The checklist row already shows the same token
    // (`checklist-item.tsx`), humanised the same way, so the two surfaces agree.
    `Verification: ${humanizeToken(row.verification_status)}`,
    confirmationLine(withAgency(row), row.verification_status, [
      rendering?.deadline_display,
      ...(rendering?.notes ?? []),
      rendering?.conflict_text,
      ...filingRoute(row, rendering),
    ]),
    // EVERY PUBLISHED NOTE, because the qualification IS one of them and nothing here can tell
    // which. `findings.ts` builds this array as the rule's own notes, then the DEADLINE's and
    // VERIFICATION's qualifications, all flattened, with no marker separating the caveat about a
    // date from a note about anything else. Reading only `deadline_display` therefore dropped the
    // caveat silently, and dropped it
    // hardest exactly where it matters most: DOB-ASSEMBLY-001 publishes no display string at all,
    // so its reminder stated a computed calendar date with no hint that the published lead may be
    // ten BUSINESS days and that the wording is unpinned. A date presented without the doubt the
    // ruleset attaches to it is a resolved requirement PopEngine invented (AGENTS.md: an
    // unresolved state stays visible end to end).
    //
    // Quoted, never summarised. Picking which notes "belong to" the deadline would be this file
    // deciding which published qualifications an organizer needs, which is the ruleset's call.
    ...(rendering?.notes ?? []),
    // Both readings of an OFFICIAL_CONFLICT rule, verbatim. PARKS-TUA-001 is dated and carries a
    // published conflict about whether it is triggered at all; a reminder that quotes the date and
    // drops the conflict renders an unresolved requirement as a resolved one.
    rendering?.conflict_text ?? null,
    timing.pendingUpstream === null || timing.openOn === null
      ? null
      : sequenceNote(timing.pendingUpstream, timing.openOn),
    ...filingRoute(row, rendering),
    offsetPolicyNote(daysBefore, timing.late),
  ].filter((line): line is string => line !== null);
  return {
    subject: settled
      ? `File your ${requirementLabel(row)} by ${applyBy}`
      : `${requirementLabel(row)} may be required — file by ${applyBy} if it applies`,
    body: body.join("\n"),
  };
}

/**
 * AC 4. The gated requirement's window opens at `apply_after_date`, which the engine computed from
 * the upstream rule's own published processing range. The copy names the dependency — both ends of
 * it — and carries the dependency rule's published caveat, because that rule's verification block
 * says a strict issued-before-filed order is NOT confirmed. Announcing the sequence as settled
 * would assert something no source states.
 *
 * WHAT THIS DATE IS, precisely, because the obvious sentence is wrong. `apply_after_date` is
 * today plus the EARLIEST end of the upstream's published processing range — the soonest a
 * decision could come back, not the day one did. F-203's own AC 4 sketches the copy as "your
 * Parks permit decision window has passed", and that sentence asserts an agency outcome nothing
 * observed: on day 21 of a published 21–30 day range, the decision may well still be pending.
 * The spec text is UI copy and the rule's processing range is published data, and AGENTS.md
 * ranks published rule above UI copy when they disagree, so the criterion's substance is kept —
 * the alert fires on the gated date and names the dependency at both ends — and its example
 * sentence is not.
 *
 * AND "YOU CAN NOW PURSUE" WAS THE SAME MISTAKE THE SAME COMMENT HAD JUST REJECTED. The paragraph
 * above threw out the spec's example sentence for asserting an agency outcome nothing observed,
 * and the copy then asserted the consequence of that outcome instead. It said the organizer may
 * now go ahead, which is true only if a decision arrived AND the sequencing holds — and the
 * published rule qualifies its own sequencing as RESEARCH_REQUIRED, saying a strict
 * issued-before-filed order is not confirmed by located primary text. The alert therefore picked
 * one reading of an unresolved question and stated it to an organizer as fact, three lines above
 * the note that says it is unresolved.
 *
 * WHAT IS ACTUALLY SUPPORTED, and all this now says: a date computed from published numbers has
 * arrived, that is not evidence a decision was made, and the published note's own instruction is
 * to confirm with the agency. Every one of those is a fact the sources establish.
 *
 * IT DOES NOT SWING TO THE OTHER READING EITHER, which would be its own invention. Nothing here
 * tells the organizer they may not file yet. `proposals.ts` is explicit that closing a window on
 * the strength of an unconfirmed sequence would invent a blocker, so the copy asks them to confirm
 * and stops. Neither "you may go" nor "you may not" is available; "here is the date, here is what
 * it does and does not mean, confirm it" is.
 */
function dependencyCopy(
  gated: PlanAlertRow,
  upstream: PlanAlertRow,
  dependency: PlanAlertRow | undefined,
  gatedRendering: FindingRendering | undefined,
  dependencyNote: string | null,
  openOn: string,
): { subject: string; body: string } {
  const range =
    upstream.deadline?.type === "composite" ? upstream.deadline.processingRangeDays : null;
  const body = [
    `${openOn} is the earliest a decision on your ${withAgency(upstream)} could come back` +
      (range === null ? "" : `, from its published ${range[0]}–${range[1]} day processing range`) +
      `. That date has arrived. It is not confirmation that a decision has been made.`,
    `Confirm the outcome with ${upstream.agency ?? "the agency"} before you file your ` +
      `${withAgency(gated)}.`,
    // THREE VERIFICATION STATES, because this alert is a claim about three published things and
    // the reminder's single line does not cover it. AGENTS.md keeps those states visible END TO
    // END and a notification is an end; the reminder builder was fixed for that and this builder
    // was not, so the one alert that asserts a SEQUENCE between two agencies was the one arriving
    // with no verification state at all.
    //
    // The third line is the one that matters most and the one a single-status shape cannot carry.
    // `NYPD-SOUND-PARKS-DEP-001` publishes RESEARCH_REQUIRED on the sequencing itself: a strict
    // issued-before-filed order is NOT confirmed. "You can now pursue" reads as a start date the
    // agencies agree on, and without this line the unconfirmed part of the claim is the part the
    // organizer cannot see. Every token is read off the plan item, never named here.
    verificationLine(withAgency(gated), gated.verification_status),
    confirmationLine(
      withAgency(gated),
      gated.verification_status,
      filingRoute(gated, gatedRendering),
    ),
    verificationLine(withAgency(upstream), upstream.verification_status),
    confirmationLine(withAgency(upstream), upstream.verification_status),
    dependency === undefined
      ? null
      : `Verification of the sequencing between them: ` +
        `${humanizeToken(dependency.verification_status)}`,
    dependency === undefined
      ? null
      : confirmationLine("Sequencing between them", dependency.verification_status, [
          dependencyNote,
        ]),
    ...filingRoute(gated, gatedRendering),
    dependencyNote,
  ].filter((line): line is string => line !== null);
  return {
    subject: `Check your ${requirementLabel(upstream)} before filing your ${requirementLabel(gated)}`,
    body: body.join("\n"),
  };
}

/**
 * AC 1's slack warning, fired at checklist creation rather than on a date. The threshold is named
 * as PopEngine's own, exactly as `config.slack_warning_days` requires and as the plan verdict copy
 * already does.
 *
 * WHAT `minSlackDays` IS NOT: a countdown. The engine takes the minimum of every dated finding's
 * `slackDays`, and that field means two different things depending on the finding. Ungated, it is
 * the distance from the PLAN'S evaluation date to the filing date — not from today, and the two
 * differ by however long the organizer waited before materializing. Gated, `findings.ts` replaces
 * it with `latest_apply − apply_after`: the WIDTH of the window the item can be filed in. A park
 * event 35 days out has nine days of gated slack and cannot pursue the sound permit for another
 * 21, so "the soonest filing date is nine days away" — the sentence this used to send — told the
 * organizer they had three weeks less runway than they do, and in the other direction it can tell
 * them they have more. Neither reading survives being called "days away", so the copy now says
 * what the number is and points at the dates that ARE the countdown.
 *
 * NO VERIFICATION STATE ON THIS ONE, and the asymmetry is the answer rather than an omission. The
 * reminder and dependency builders both carry the published states because both name a REQUIREMENT,
 * and a state belongs to a rule. This copy names none: it reports the narrowest slack across every
 * dated finding in the plan and PopEngine's own threshold, and there is no single rule whose status
 * could attach to that. Picking one would be inventing an association the plan does not make, which
 * is the failure AGENTS.md:28 exists to prevent rather than an instance of the rule it states. The
 * test-alert copy is silent for the same reason and more simply: it asserts no regulatory fact at
 * all.
 *
 * "apply within N days" stays in the subject: that phrasing is fixed for FEASIBLE-AT-RISK by the
 * answer key's verdict model and `specs/F-102`, and `apps/web/app/plan/verdict-copy.ts` already
 * renders it. Restating it differently here would put two vocabularies on one verdict.
 *
 * AND IT IS ANCHORED TO THE DATE IT WAS MEASURED FROM, which is the whole of the :851 fix. `N` is
 * frozen at plan generation, so a plan made with nine days of slack and converted eight days later
 * sent "apply within 9 days" while the filing date was tomorrow, contradicting the reminder
 * scheduled beside it. The body never had this problem: it says "measured from the plan's
 * evaluation date", so it is a statement about a plan and stays true however late it arrives. The
 * subject was the same claim with the anchor removed, which turned it into a present-tense
 * instruction that decays. It now carries the anchor the body already had.
 *
 * RECOMPUTING N AGAINST TODAY WAS THE OBVIOUS FIX AND IS WRONG TWICE. `N` is the VERDICT's number,
 * not a countdown: `verdict-copy.ts` renders the same figure on the plan page, so recomputing here
 * would put two different numbers on one verdict, which is the thing the paragraph above exists to
 * prevent. And `specs/F-102` fixes slack for a GATED finding as `latest_apply − apply_after`, the
 * WIDTH of the filing window, so "days from today until the deadline" is a different quantity
 * entirely — the paragraph above spends itself explaining that the number is not time remaining,
 * and recomputing it as time remaining would make that explanation false.
 *
 * REQUIRING REGENERATION was the third option and costs the most: an organizer who converts late
 * would be told nothing at all, suppressing a true at-risk signal to avoid a stale number in it.
 *
 * What the chosen fix costs is a longer subject line. That is the whole price.
 */
const slackWarningCopy = (
  minSlackDays: number,
  slackWarningDays: number,
  evaluatedOn: string,
  /** Whether the requirement that PRODUCED this number waits on another agency's decision. */
  controllingIsGated: boolean,
  /**
   * Every requirement whose slack IS this number, with what the ruleset says about each.
   *
   * All of them, not the first: round 22 established the tie can hold several and that they can
   * differ, and a status is not a summary — quoting one requirement's while another tied one says
   * something else would be picking a reading.
   */
  controllingFindings: readonly {
    readonly subject: string;
    readonly verificationStatus: VerificationStatus;
    readonly notes: readonly string[];
    readonly conflictText: string | null;
  }[],
): { subject: string; body: string } => ({
  // THE SUBJECT BRANCHES TOO, and not branching it was a regression this file's own argument had
  // already refuted. Anchoring "apply within N days" to a date is right when N is a countdown from
  // that date, which is what ungated slack is. It is wrong when N is a WIDTH: `specs/F-102` fixes
  // gated slack as `latest_apply − apply_after`, so anchoring it instructs the organizer to act by
  // a day that may fall before the window opens at all. That is a filing date the sources do not
  // publish, stated in the one line most organizers read and the only one the body's qualification
  // cannot reach.
  //
  // A width needs no anchor, which is why the gated subject carries none: both dates come from the
  // plan and neither moves, so unlike a countdown it does not decay and there is nothing to fix by
  // dating it. It says what the number is instead, which is what F-102 calls it.
  //
  // BRANCHED ON THE CONTROLLING FINDING, not on whether the plan has any gated row. The first
  // version of this asked the plan-level question, which is a proxy: a park event with a closer
  // ordinary filing deadline has a gated row AND an ungated controlling minimum, and the proxy
  // then called an ungated countdown a window width. The caller identifies the requirement that
  // produced the number and passes that, so one value decides every sentence here.
  subject: controllingIsGated
    ? `At risk — the narrowest filing window is ${minSlackDays} days wide`
    : `At risk — apply within ${minSlackDays} days of ${evaluatedOn}`,
  body: [
    // THE FIRST LINE BRANCHES TOO, because it was contradicting the qualification below it. It
    // said the number was measured from the evaluation date while the next line said it was a
    // width, so the body disagreed with itself in exactly the case the qualification exists to
    // describe. A width is not measured from a date at all, so the gated sentence says what the
    // number is once rather than stating it wrongly and then correcting it.
    controllingIsGated
      ? `Your plan is FEASIBLE-AT-RISK: the narrowest slack across its dated requirements is ` +
        `${minSlackDays} days. That requirement waits on another agency's decision, so the number ` +
        `is the WIDTH of the window it can be filed in, not time remaining and not measured from ` +
        `any date. Its own start and filing dates are on your checklist.`
      : `Your plan is FEASIBLE-AT-RISK: the narrowest slack across its dated requirements is ` +
        `${minSlackDays} days, measured from the plan's evaluation date ${evaluatedOn}.`,
    // THE THIRD BUILDER TO NEED THIS. AGENTS.md keeps the published verification states visible END
    // TO END and a notification is an end; reminders got it in round 7, dependency alerts in round
    // 10, and this one published a risk and a number while saying nothing about the status of the
    // rule the number came from. The verdict does not exclude unsettled findings from its minimum,
    // so a plan whose tightest requirement is OFFICIAL_CONFLICT produced an apparently settled
    // "apply within N days" from a rule that is not settled.
    //
    // Every tied controlling requirement, with its own published notes and both readings of a
    // conflict, quoted rather than summarised. Which qualifications belong to a number is the
    // ruleset's call, not this file's.
    ...controllingFindings.flatMap((finding) => [
      verificationLine(finding.subject, finding.verificationStatus),
      confirmationLine(finding.subject, finding.verificationStatus, [
        ...finding.notes,
        finding.conflictText,
      ]),
      ...finding.notes,
      finding.conflictText,
    ]),
    `The ${slackWarningDays}-day threshold is PopEngine's internal planning buffer, not an ` +
      `official threshold.`,
  ]
    .filter((line): line is string => line !== null)
    .join("\n"),
});

/**
 * Every alert this plan calls for, before channels are applied.
 *
 * Scheduling reads dates only. A requirement with no `latest_apply_date` — a `research_required`
 * lead time, or a business-day window with no published holiday calendar — contributes nothing
 * here, which is spec AC 1 and the reason there is no `?? today` anywhere below.
 */
async function plannedAlerts(
  client: PoolClient,
  planId: string,
  settings: AlertSchedulerSettings,
  now: Date,
): Promise<PlannedAlert[]> {
  const plan = await planVerdict(client, planId);
  if (plan === null) return [];
  const rows = await planAlertRows(client, planId);
  const renderings = await renderingsForPlan(client, planId);
  // KEYED BY EVERY CONTRIBUTING RULE ID, AND BY EVERY ROUTE, not by `rule_ids[0]`. After a merge
  // `rule_ids` concatenates in contributing order, so the first entry is whichever member sits
  // earlier in the published file: keying on it made an upstream or dependency rule findable only
  // when it happened to be listed first, which is the #244 defect class. Each route resolves to its
  // OWN window here, so a dependency reads the date published by the rule that names it rather than
  // the date on whichever route the merged line reads.
  const byRuleId = new Map<string, PlanAlertRow>();
  for (const row of rows) {
    const rendering = renderings.get(renderingKey(row.rule_ids));
    for (const subject of alertSubjects(row, rendering)) {
      for (const ruleId of subject.row.rule_ids) byRuleId.set(ruleId, subject.row);
    }
    for (const ruleId of row.rule_ids) if (!byRuleId.has(ruleId)) byRuleId.set(ruleId, row);
  }
  // THE DAY SCHEDULING HAPPENS, not the day the plan was evaluated. A plan pins `today` at
  // generation, and an organizer can generate one on Monday and convert it on Friday: read against
  // the plan's clock, a filing date that closed on Wednesday still looks like it is ahead, and the
  // guard below would schedule a reminder that is immediately due and reads "file by" a day that
  // has gone — the exact output the guard exists to prevent. The plan's own clock is still the
  // right answer for what the plan CALCULATED (it is what the slack figure was measured from, and
  // the copy says so); it is the wrong answer for what has happened since.
  const schedulingToday = todayInJurisdiction(settings.jurisdiction, now);
  /**
   * The moment an alert for `day` is actually due, which is never in the past.
   *
   * A checklist materialized INSIDE a reminder window persisted the original offset day as
   * `send_at`, an instant that had already gone. AC 2 measures delivery from `send_at`, so such a
   * row failed the two-minute bound by arithmetic before the poller had done anything wrong — an
   * empty queue and a healthy provider still recorded it late. The spec's own edge case says that
   * row should go out immediately, and "immediately" is what this makes it: due now rather than
   * due at a time that has passed.
   *
   * IDENTITY IS UNAFFECTED, which is what makes this safe to move. A reminder is identified by
   * `${checklist_item_id}:deadline_reminder:${daysBefore}:${sendOn}`, the INTENDED day, not by
   * `send_at`; the unlock carries no date at all. So the intended slot is still what decides
   * whether two alerts are the same alert, and moving the due instant cannot mint a duplicate.
   * The copy is unaffected too: `late` is decided from `sendOn` against the scheduling day, so a
   * catch-up reminder still says it is one.
   */
  const dueAt = (day: string): { at: Date; intended: string } => {
    const scheduled = instantAtLocalHour(settings.jurisdiction, day, SEND_HOUR_LOCAL);
    // The INTENDED slot travels beside the clamped one, because the two answer different
    // questions and round 27's rule needs the first. `send_at` is recomputed from the request
    // clock whenever the slot has already gone, so it differs on EVERY review even when nothing
    // about the schedule changed — and a rule that keys on "the value changed" then cleared the
    // backoff each time, letting a repeated submission drive repeated immediate retries.
    return {
      at: scheduled.getTime() < now.getTime() ? now : scheduled,
      intended: scheduled.toISOString(),
    };
  };
  const planned: PlannedAlert[] = [];

  for (const planRow of rows) {
    if (planRow.checklist_item_id === null) continue;
    const planRendering = renderings.get(renderingKey(planRow.rule_ids));
    const subjects = alertSubjects(planRow, planRendering);
    // THE ROUTE ENTERS A MERGED ROW'S ALERT IDENTITY UNCONDITIONALLY, and it has to be
    // unconditional to be stable. The first version keyed the route in only while the row scheduled
    // from more than one, which made the key depend on HOW MANY of the group's routes happened to
    // publish a date on the day the plan was generated. A merged line whose second route gains a
    // window between two regenerations — a ruleset publishing the missing deadline, a holiday list
    // arriving so a business-day window becomes calculable — crossed that count from 1 to 2 and
    // re-keyed every reminder the line already owned. The reconciler will not touch a `sent` row,
    // so the re-keyed reminder was INSERTED rather than matched, and the organizer was reminded a
    // second time in identical words. That is the duplicate delivery F-203 AC 7 forbids and the
    // comment below already describes this file fixing once.
    //
    // `routeRuleId` is null for an unmerged row and non-null for every route of a merged one, so
    // this adds nothing to the key of any row that has no dedupe group; those keys are untouched.
    for (const { row, rendering, routeRuleId } of subjects) {
      const routeKey = routeRuleId !== null ? `:${routeRuleId}` : "";
      const applyBy = isoDate(row.latest_apply_date);
      // The window this alert counts down to, recorded on the row wherever it is NOT the window the
      // sweep would find through the checklist item, together with the fact that this alert is
      // route-scheduled at all. The second half carries the cases the first cannot: a route with a
      // gate and no filing deadline has no date to record and still must not be answered for by
      // another route's. See `PlannedAlert.controllingApplyBy` and `routeScheduled`.
      //
      // WRITTEN AS null WHERE THERE IS NO WINDOW, NOT OMITTED, because the upsert MERGES payloads
      // and an absent key is what a merge reads as "unchanged". A route that published a window on
      // one generation and none on the next kept the old date, `FILING_WINDOW_HAS_SHUT` answered
      // off a window the plan no longer publishes, and a live alert was cancelled. F-203's Outputs
      // suppress on a date that has GONE, never on the ABSENCE of one.
      const routeApplyBy =
        routeRuleId === null ? {} : { routeScheduled: true as const, controllingApplyBy: applyBy };

      const openOn = isoDate(row.apply_after_date);
      const binding = DEPENDENCY_SEQUENCING_BINDINGS.find(
        (candidate) => candidate.gatedRuleId === (row.rule_ids[0] ?? ""),
      );
      const upstream = binding === undefined ? undefined : byRuleId.get(binding.upstreamRuleId);

      // A filing date already behind is not something to remind anyone to meet. The reminder would
      // read "file by <a day that has passed>", which is the one thing a missed window must never be
      // dressed up as. The checklist still shows the missed status.
      if (applyBy !== null && applyBy >= schedulingToday) {
        for (const daysBefore of settings.reminderDaysBefore) {
          const sendOn = shiftDays(applyBy, -daysBefore);
          const { subject, body } = reminderCopy(row, rendering, applyBy, daysBefore, {
            // Its day has already gone, so it goes out on the next tick and says so.
            late: sendOn < schedulingToday,
            // Named only while the upstream decision is still ahead of this reminder. Once the
            // window has opened the sequence is no longer news, and the unlock alert has said it.
            // `<=`, not `<`. A reminder landing exactly ON the day the upstream decision is first
            // expected still lands before that decision is known — the window opens that day, it
            // does not close the day before. The strict form dropped the sequencing note on precisely
            // the case where the two alerts arrive together and the organizer most needs to be told
            // which one waits on the other.
            pendingUpstream: openOn !== null && sendOn <= openOn ? (upstream ?? null) : null,
            openOn,
          });
          planned.push({
            alertType: "deadline_reminder",
            checklistItemId: row.checklist_item_id,
            ...routeApplyBy,
            // Already past at scheduling time — a checklist created inside the reminder window —
            // is due NOW rather than at a moment that has gone (spec edge case, and AC 2's bound is
            // measured from this field).
            sendAt: dueAt(sendOn).at,
            intendedAt: dueAt(sendOn).intended,
            subject,
            body,
            // THE OFFSET IS PART OF WHICH REMINDER THIS IS, and the send day alone does not carry
            // it. The published offsets are 7 and 1, so a regeneration that moves a filing date by
            // exactly their difference lands the new 7-day reminder on the day the old 1-day
            // reminder already occupies. Same item, same type, same day — the same key. If the old
            // one had been sent, the conflict clause correctly refuses to touch a sent row, and the
            // new reminder carrying the CORRECTED filing date was silently dropped on the floor.
            // THE OFFSET IS WHICH REMINDER THIS IS, AND THE DAY IS NOT PART OF IT. The send day used
            // to be in here, which meant an event edit that moved the filing date minted a new key:
            // the reminder already SENT was correctly left alone, a fresh row was inserted for the
            // same channel and the same recipient, and the organizer was reminded twice. AC 7, as
            // this PR amended it and the product owner approved it, says a re-send is legitimate when
            // the DESTINATION differs, not when the attempt does. A moved date is not a different
            // destination. Same ruling the product owner made for the slack warning in round 15,
            // arriving on the reminder.
            //
            // The offset stays, and on its own it is enough. The day was added to tell the 7-day
            // reminder from the 1-day one when a moved date landed them on the same calendar day; a
            // key of item plus offset cannot collide between offsets at all, so that case is closed
            // by construction rather than by a second component.
            //
            // What a moved date does now is UPDATE the unsent row it already owns — new send day, new
            // copy, same identity — which is the same treatment round 20 gave `send_at`. The intended
            // day still decides the copy and whether the reminder is a catch-up; it just no longer
            // decides whether this is the same reminder.
            //
            // WHICH ROUTE joins it on every merged row, whatever the row's dated-route count is on
            // the day it is generated. An unmerged row adds nothing and keeps the key it had.
            identity: `${row.checklist_item_id}:deadline_reminder:${daysBefore}${routeKey}`,
            // The key this same reminder had on a plan written before route lists existed. See
            // `PlannedAlert.legacyIdentity`.
            ...(routeKey === ""
              ? {}
              : {
                  legacyIdentity: `${row.checklist_item_id}:deadline_reminder:${daysBefore}`,
                }),
          });
        }
      }

      // A FILING DEADLINE THAT HAS PASSED CLOSES THE UNLOCK TOO, and the reminder guard above was
      // not enough on its own. Materializing an older plan after the gated item's latest apply date
      // correctly skips the reminder and then scheduled this anyway, on a day already behind, so the
      // next tick sent "You can now pursue" about a window the same plan reports as missed. Two
      // surfaces contradicting each other on one requirement, with the notification the one that is
      // wrong.
      //
      // A NULL latest apply date is allowed through, deliberately. That is a gated requirement with
      // no published filing deadline at all — nothing has closed, so there is nothing to contradict,
      // and suppressing it would drop a true alert to guard against a state that cannot arise. The
      // guard is about a date that has gone, not about the absence of one.
      const filingStillOpen = applyBy === null || applyBy >= schedulingToday;

      // No binding or no upstream row means nothing published names what this waits on, and an
      // unlock alert that cannot name its dependency is not the alert AC 4 asks for.
      if (openOn !== null && binding !== undefined && upstream !== undefined && filingStillOpen) {
        const { subject, body } = dependencyCopy(
          row,
          upstream,
          byRuleId.get(binding.dependencyRuleId),
          rendering,
          renderings.get(renderingKey([binding.dependencyRuleId]))?.note_text ?? null,
          openOn,
        );
        planned.push({
          alertType: "dependency_unlocked",
          checklistItemId: row.checklist_item_id,
          ...routeApplyBy,
          // Same treatment as a reminder, and for the same reason: an unlock whose gate opened
          // before the plan was materialized is due now, not at a past instant that would score it
          // late against AC 2 the moment it was written.
          sendAt: dueAt(openOn).at,
          intendedAt: dueAt(openOn).intended,
          subject,
          body,
          // NO DATE IN THIS ONE, and that is the difference between it and a reminder. A reminder is
          // one of several per requirement and its day is what tells them apart; an unlock is a
          // single announcement per gated requirement — "the window you were waiting on is open" —
          // and it can only be true once.
          //
          // `apply_after_date` is today plus the upstream processing range, so it moves every time
          // the plan is regenerated on a later day, even when the event, the requirement and the
          // upstream have not changed at all. Keyed on that date, a regeneration minted a second
          // unlock whose predecessor was already sent and therefore correctly untouchable, and the
          // organizer was told a second time that they may now pursue something they had already
          // been told was open.
          identity: `${row.checklist_item_id}:dependency_unlocked${routeKey}`,
          ...(routeKey === ""
            ? {}
            : { legacyIdentity: `${row.checklist_item_id}:dependency_unlocked` }),
        });
      }
    }
  }

  const minSlackDays = plan.verdict_detail.minSlackDays;
  // WHAT HAS TO BE TRUE FOR THIS SENTENCE TO BE HONEST, asked once rather than approached again.
  //
  // Three rounds have narrowed this guard and each was right: which identity the warning uses, then
  // whether a window is open, now WHICH window. That is a sign worth naming rather than a fourth
  // condition to add quietly. The three are not three problems. They are one question — is the
  // plan's conclusion still the conclusion? — asked about three different inputs, and the guard has
  // been approximating it a clause at a time.
  //
  // The body is a statement ABOUT A PLAN and is true forever: as of the evaluation date, the
  // narrowest slack was N. The SUBJECT is a present-tense instruction, "apply within N days", and
  // that is what decays. So the condition is not about the plan's provenance, it is that the
  // requirement the number DESCRIBES must still be one the organizer can act on. Everything else
  // this guard has accumulated follows from that, which is why the shape can express it: one
  // question about one number, not a conjunction of freshness tests.
  //
  // `rows.some(open)` was too weak for exactly that reason. It asked whether ANY window is open
  // while the number comes from ONE requirement, so on a plan with several dated requirements the
  // one that PRODUCED the minimum could expire while a later one held the guard true, and the
  // warning went out counting down a deadline already missed.
  //
  // The engine's own per-finding `slackDays` is already in hand — `renderingsForPlan` loads it for
  // the reminder copy — so the controlling requirement is identified rather than recomputed. That
  // matters beyond cost: `findings.ts` replaces a GATED finding's slack with the width of its
  // filing window rather than the distance to its deadline, so re-deriving slack here from dates
  // would quietly disagree with the number in the copy.
  //
  // Expressed as "the tightest still-open requirement is the one the number describes" rather than
  // by picking a row, which handles ties without choosing between them: if the controlling
  // requirement has expired, the minimum across what remains is necessarily larger than the number
  // the copy states.
  // ONE VALUE DECIDES THE GUARD, THE SUBJECT AND THE BODY, so they cannot disagree again.
  //
  // Round 18 identified the requirement that PRODUCED the minimum in order to narrow the guard,
  // and that identity stopped at the guard. Round 20 then asked the copy a different question —
  // does the plan have ANY gated row — which is a proxy that agrees in the common case and not in
  // the one that matters: a park event with a closer ordinary filing deadline has a gated row and
  // an ungated controlling minimum, and the copy then called an ungated countdown a window width.
  // Same shape as the defect round 18 fixed, one layer over. So the controlling row is carried
  // rather than re-approximated, and everything the copy says about the number reads from it.
  // TWO QUESTIONS, TWO SETS, because one filter was answering both and they are not the same
  // question. "May this warning still be sent" is about which requirements are still OPEN. "Which
  // findings produced the number we are describing" is about which requirements the verdict's
  // minimum came from, open or not. Deriving the second from the first quietly narrowed it.
  //
  // The case it lost: a gated and an ungated requirement tie for the minimum, and the checklist is
  // materialized after the gated filing date but before the ungated one. Openness dropped the
  // gated controller while still permitting the warning, so the copy described the number purely as
  // an evaluation-date countdown and dropped that finding's verification qualifications — even
  // though the same verdict value was ALSO computed as its filing-window WIDTH.
  //
  // The round 22 tie principle already decides which way this goes, and it is worth saying here
  // rather than leaving it to be re-derived: break the tie in the direction that cannot harm the
  // organizer. Dropping a gated controller from the copy is the harm direction, because it turns a
  // width into a countdown and states a filing date the sources do not publish. So every tied
  // controller is retained for the copy and the status, and openness decides only whether the
  // warning may go out at all.
  // READ PER ROUTE, BECAUSE THE NUMBER IS COMPUTED PER ROUTE. `computeWindowVerdict` takes
  // `minSlackDays` from every route of every finding, and a merged dedupe line's own `slack_days`
  // is the binding route's alone. Where that route publishes no window the line's slack is null and
  // no row here matched it at all, so `controllingFilingStillOpen` was false and the warning was
  // suppressed on a plan the verdict had already called FEASIBLE_AT_RISK — the at-risk alert simply
  // did not exist. Confirmed on a synthetic ruleset whose binding route is undated: verdict
  // FEASIBLE_AT_RISK, `minSlackDays` 9 off the dated route, merged `slack_days` null (#252 review).
  // The same expansion the reminders take, so the two cannot disagree about which windows a plan has.
  const dated = rows
    .flatMap((row) => alertSubjects(row, renderings.get(renderingKey(row.rule_ids))))
    .map((subject) => ({ subject, slack: subject.rendering?.slack_days }))
    .filter(
      (entry): entry is { subject: AlertSubject; slack: number } => typeof entry.slack === "number",
    );
  /** Openness, and nothing else: whether the requirement the number describes can still be filed. */
  const openDated = dated.filter((entry) => {
    const applyBy = isoDate(entry.subject.row.latest_apply_date);
    return applyBy !== null && applyBy >= schedulingToday;
  });
  const controllingFilingStillOpen =
    openDated.length > 0 && Math.min(...openDated.map((entry) => entry.slack)) === minSlackDays;
  /**
   * EVERY requirement whose slack IS the number the copy quotes, open or not.
   *
   * The expiry date below is unaffected by widening this, and that is worth knowing rather than
   * assuming: it takes the LAST of the tied dates, an expired controller's date is necessarily
   * earlier than an open one's, and this is only ever read when at least one tied controller is
   * still open. Same value, computed from the set that actually answers the question.
   */
  const controlling = dated.filter((entry) => entry.slack === minSlackDays);
  // ONE RULE, TWO OPPOSITE TIE-BREAKS, and they are written here together because apart they look
  // like a contradiction and someone will eventually "unify" them.
  //
  // The rule is: break the tie in the direction that cannot harm the organizer. The two harms point
  // opposite ways, so the two tie-breaks do too.
  //
  //   COPY, below: gated if ANY tied candidate is gated. The harm to avoid is asserting a filing
  //   deadline the sources do not publish, which is what calling a width a countdown does. Calling
  //   a countdown a width only loses an anchor, so that is the direction to fall.
  //
  //   EXPIRY, below that: the LAST of the tied dates, not the first. The harm to avoid is silencing
  //   a warning that is still true. Taking the earliest cancels a failed warning the moment the
  //   first tied requirement expires, while another controlling window is still open — and a fresh
  //   scheduling pass would then recreate the very warning that was just cancelled, so after a long
  //   outage the at-risk alert simply disappears.
  //
  // Same rule, and the reason it produces opposite answers is that one side risks saying too much
  // and the other risks saying nothing at all.
  const controllingIsGated = controlling.some(
    (dated) => dated.subject.row.apply_after_date !== null,
  );
  /**
   * The day the LAST of the controlling requirements closes, for the poller to compare.
   *
   * Ties differ in date even when they agree on slack, because ungated slack is measured from the
   * evaluation date and gated slack is a window width. So the number stays true until every tied
   * requirement has expired, and this is the day that happens.
   */
  const controllingApplyBy = controlling
    .map((dated) => isoDate(dated.subject.row.latest_apply_date))
    .filter((day): day is string => day !== null)
    .sort()
    .at(-1);
  if (
    plan.verdict === "feasible_at_risk" &&
    typeof minSlackDays === "number" &&
    controllingFilingStillOpen
  ) {
    const { subject, body } = slackWarningCopy(
      minSlackDays,
      settings.slackWarningDays,
      plan.today,
      controllingIsGated,
      controlling.map((dated) => ({
        // The route's own name, so the copy names the rule whose window produced the number.
        subject: withAgency(dated.subject.row),
        verificationStatus: dated.subject.row.verification_status,
        notes: dated.subject.rendering?.notes ?? [],
        conflictText: dated.subject.rendering?.conflict_text ?? null,
      })),
    );
    planned.push({
      alertType: "slack_warning",
      checklistItemId: null,
      // "Immediately at checklist creation" (spec Outputs): due the moment it is written.
      sendAt: now,
      subject,
      body,
      // The plan's own `event_revision`, carried because this row has no `checklist_item_id` for
      // the staleness check to join through. Reasoned about on `NOT_FROM_A_STALE_PLAN`. The
      // identity below is deliberately untouched.
      planEventRevision: plan.event_revision,
      // The controlling requirement's own filing date. Carried for the same reason the revision is:
      // this row has no `checklist_item_id`, so the poller has nothing to join through, and without
      // it the sweep had to exclude the type instead of asking the question.
      controllingApplyBy,
      // KEYED ON THE RISK, not on the plan row. A plan UUID is minted fresh by every generation,
      // so an identical regeneration produced a second identity, a second immediately-due warning
      // and a second send to the same address while the first sat there already sent. That is a
      // different attempt to one destination, which is exactly what AC 7 forbids in the words this
      // PR gave it: a re-send is legitimate when the DESTINATION differs, not when the attempt does.
      //
      // What makes this warning the warning it is, is the number it asserts. The copy says the
      // narrowest slack across the plan's dated requirements is N days, so two generations that
      // both say N days are the same statement however many times the plan is rebuilt, and a
      // generation that says a different N is a different statement and worth sending. That is the
      // same rule the other two identities already follow from opposite ends: a reminder carries
      // its offset and day because a moved filing date makes it a different reminder, and an unlock
      // carries neither because "the window is open" can only be true once.
      //
      // NEITHER THE NUMBER NOR THE DATE IS IN HERE. One warning per event, full stop. Both were
      // tried and both re-warn far more often than "the risk changed" suggests.
      //
      // The number is the sharper trap of the two, and the reason is a few lines up in this file:
      // ungated `slackDays` is the distance from the PLAN'S EVALUATION DATE to the filing date, not
      // from today. So regenerating an unchanged, still-at-risk event a week later yields a SMALLER
      // number and a fresh identity, with nothing about the event having changed. The plan-UUID
      // version re-warned on every regeneration; keying on the number re-warns on most of them.
      // That is nearer the defect it replaced than it looks.
      //
      // WHAT DECIDES IT is what this alert is. The copy says in as many words that the threshold is
      // PopEngine's internal planning buffer and NOT an official threshold, and the warning states
      // no agency deadline. The deadline reminders fire on their own dates regardless of it. So a
      // suppressed duplicate warning cannot cause a filing deadline to pass unnoticed, which is the
      // thing F-203 exists to prevent — the cost of being strict is bounded, and the cost of being
      // loose is the repeat AC 7 forbids.
      //
      // THE TRADE, NAMED RATHER THAN LOST: an organizer whose buffer genuinely worsens, nine days
      // to two on an event that really did change, is not warned a second time. That case deserves
      // a DESIGNED escalation — its own alert type, fired on a crossing the ruleset or the product
      // defines, with an identity built for it — and not an identity that happens to change when a
      // number does. Until that exists the worsening is visible where the numbers already live: the
      // checklist shows the verdict and the slack figure on every visit, so the signal is unpushed
      // rather than absent. Reaching for a cheap version of it here is what produced both of the
      // identities this replaces.
      //
      // The evaluation date rides the payload, so a pending warning is rewritten with the current
      // date and a sent one is left alone.
      identity: "slack_warning",
    });
  }

  return coalesceIdenticalReminders(planned);
}

/**
 * Rule 1 of the identity block above, applied where the identities are minted: two schedulings that
 * would deliver the same words about the same task are ONE reminder.
 *
 * WHAT PRODUCES TWO OF THEM. A merged dedupe line expands into one scheduling subject per route,
 * and routes of one group can publish the same name, disposition, deadline text, filing date and
 * portal data — three of the nine multi-member groups in the v2 full draft publish byte-identical
 * outputs, and those are the groups that merge most often
 * (`docs/research/draft-dedupe-cofiring.md` §5.2, §5.7, §5.8). Their route ids differ, so the keys
 * differ, so both rows were inserted and the organizer received the same reminder twice — which is
 * the duplicate F-203 AC 7 forbids, arriving through the very groups this branch was written to
 * support (#252 review).
 *
 * THE TEST IS THE WORDS, NOT THE FIELDS THEY CAME FROM. Every difference between two routes that an
 * organizer could act on is in the copy by construction: the name, the agency, the date, the fee,
 * the portal and the published deadline text are all rendered into the subject or the body. Two
 * routes whose copy is identical are therefore indistinguishable to the person receiving it, and
 * comparing the rendered strings needs no list of fields to be kept in step with `reminderCopy`.
 *
 * SCOPED TO ONE CHECKLIST TASK, so this can never merge two requirements. Two tasks with identical
 * copy are still two things to file, and nothing here may decide otherwise; the type is in the key
 * for the same reason.
 *
 * FIRST WINS, and that is stable rather than incidental: routes arrive in binding order, the engine
 * is byte-stable for the same inputs, and the surviving alert therefore keeps the same route key
 * across regenerations. Rule 2 then applies to it like any other reminder.
 */
function coalesceIdenticalReminders(planned: readonly PlannedAlert[]): PlannedAlert[] {
  const delivered = new Set<string>();
  return planned.filter((alert) => {
    const words = JSON.stringify([
      alert.alertType,
      alert.checklistItemId,
      alert.subject,
      alert.body,
    ]);
    if (delivered.has(words)) return false;
    delivered.add(words);
    return true;
  });
}

/** A calendar day shifted by whole days, in UTC so no timezone can move the day itself. */
function shiftDays(day: string, days: number): string {
  const shifted = new Date(`${day}T00:00:00Z`);
  shifted.setUTCDate(shifted.getUTCDate() + days);
  return shifted.toISOString().slice(0, 10);
}

/**
 * WHAT A REMINDER IS, ACROSS EVERY TRANSITION IT CAN MAKE. Written once, because four rounds have
 * patched this key one case at a time and a duplicate delivery came back after each of them.
 *
 * A REMINDER IS A MESSAGE AN ORGANIZER RECEIVES: one requirement's words, on one channel, at one
 * destination. Everything else a row carries — which route produced it, which rule ids, which plan
 * generation, which offset, which day it is due — is PROVENANCE. Provenance is how PopEngine finds
 * the message again; it is not what makes two messages the same message. Two sentences follow, and
 * every defect this file has had is a violation of one of them:
 *
 *   1. Two schedulings that would deliver the same words to the same destination are ONE reminder,
 *      whatever produced them.
 *   2. A reminder keeps its identity while its provenance changes, because the organizer receives
 *      the same message either way.
 *
 * The transitions, and what holds the rule at each:
 *
 *   A merged line's dated-route count crossing 1 to 2 re-keyed reminders the line already owned
 *   (rule 2). Held by keying the route in UNCONDITIONALLY on every merged row, so the key cannot
 *   depend on how many routes happened to publish a date that day.
 *
 *   The deploy boundary: a plan written before route lists existed keys without a route, and the
 *   first regeneration keys the same words with one (rule 2). Held by `legacyIdentity`, which gives
 *   the row that already said those words the key the new one would say them under.
 *
 *   Two routes of one merged line publishing byte-identical copy (rule 1). Held by
 *   `coalesceIdenticalReminders`, which collapses them before any identity is assigned, rather than
 *   by letting two identities exist and hoping something downstream matches them.
 *
 *   A moved filing date, a corrected destination, a cancellation and revival: rounds 9, 11, 20, 27
 *   and 33, each decided on the upsert clause that carries it and not reopened here.
 *
 * AND THERE ARE TWO IDENTITIES, WHICH IS THE PART EVERY ROUND MISSED. The row key below says which
 * reminder this is TO POPENGINE, and it is recomputed from the current plan. The provider key says
 * which message is already IN FLIGHT AT THE PROVIDER, and it is fixed by the first handoff. They
 * coincide until something re-keys a row that has already been attempted, which is exactly what the
 * adoption above does — so `providerKey` reads the attempt rather than the row.
 */

/**
 * The row's identity, per ARCHITECTURE's `{event_id}:{checklist_item_id}:{alert_type}:{send_at}`
 * with three deviations the schema forces and the example (an "e.g.") does not cover: the channel
 * is part of it, because `idempotency_key` is UNIQUE and the same alert on email and SMS is two
 * rows; the plan-level slack warning is keyed on its plan instead of a send time it shares with the
 * clock; and the DESTINATION is part of it, which is the third and is explained below.
 *
 * ONE ROW PER ALERT PER DESTINATION, because `alerts.recipient` is an audit fact and a row cannot
 * hold two of them. `event_alert_contacts` exists on exactly this distinction: where this event's
 * alerts GO is per-event and correctable, and where one MESSAGE went is per-row and immutable. The
 * upsert then rewrote `recipient` in place, which is that argument's own sentence pointing the
 * other way — a row that had already been attempted came out claiming the attempt targeted an
 * address it was never sent to. Resend accepts a request, the api times out before it sees the
 * response, the row is marked failed although a message may have reached the OLD address, and
 * correcting the contact rewrote the only record of where that attempt went.
 *
 * Putting the destination in the key means a correction cannot rewrite anything: the corrected
 * request finds no row to conflict with and INSERTs its own, and the row that was attempted keeps
 * its recipient, its count and its error for good. The reconciler below then cancels it in the same
 * statement it already used for every other superseded alert, because its key is no longer in the
 * set the plan calls for. Cancelled is the right word rather than a new one — PopEngine intended to
 * send it and no longer does, which is what that status has always meant here (AC 2). A SENT row is
 * matched by neither the upsert nor the cancel, so the record of a delivered message is untouched.
 *
 * HASHED, NOT WRITTEN IN. The key is stored on every row and travels to the provider in a header,
 * and an email address or a phone number in it would be contact data in two more places for no
 * gain (AGENTS.md: do not log unredacted contact data). A digest changes exactly when the
 * destination changes, which is all the key needs from it.
 *
 * No migration: this changes what goes IN the column, not the column or its UNIQUE constraint.
 * Existing rows keep their keys and are superseded by the reconciler on the next review like any
 * other stale alert, so there is nothing to backfill.
 */
const idempotencyKey = (
  eventId: string,
  identity: string,
  channel: AlertChannel,
  recipient: string,
): string =>
  `${eventId}:${identity}:${channel}:` +
  createHash("sha256").update(recipient).digest("hex").slice(0, 12);

/**
 * THE KEY ALREADY IN FLIGHT, and the row's own only where there is none.
 *
 * WHY THE ROW'S KEY IS NOT ENOUGH BY ITSELF. `idempotency_key` is recomputed from the current plan,
 * and one path deliberately REWRITES it on a row that already exists: the legacy adoption above,
 * which hands a pre-route-list row the key its route-keyed successor would use. A row can be sitting
 * in that state with an unresolved attempt against it — the provider accepted, this side timed out
 * and marked the row failed — and the retry then falls inside the provider's dedup window. Handed
 * the NEW key, the provider has nothing to match it against and delivers the reminder a second time:
 * the adoption written to close a duplicate opening one, one layer down (#252 review).
 *
 * SO THE TWO IDENTITIES ARE READ FROM THE TWO PLACES THAT HOLD THEM. The row says which reminder
 * PopEngine means; the oldest unresolved, unsuperseded attempt says which message the provider may
 * be holding, and that is the key that has to go back. `alert_send_attempts.idempotency_key` has
 * recorded it since migration 014 precisely so a reconciliation could look the message up by it.
 *
 * NO TIME BOUND ON THE ATTEMPT, deliberately. Inside the provider's window the repeated key is what
 * deduplicates; outside it the provider treats it as a fresh message, which is the same outcome as
 * sending the row's own key, so bounding this would add a branch that changes nothing. Superseded
 * attempts are excluded for the reason `unresolvedAttemptPastTheCutoff` excludes them: they speak
 * for a schedule that has ended. A RESOLVED attempt is excluded because this side learned what
 * happened to it — either it was delivered, and the row is sent and never retried, or the provider
 * was proven never to have been reached, and there is nothing to deduplicate against.
 *
 * WHAT THIS DOES NOT CHANGE is the trade recorded below: a corrected wording may still be
 * deduplicated away inside the window. That was already true of every row whose key did not move,
 * and it is the trade this file has taken since round 19.
 *
 * WHY THE PROVIDER IS SIMPLY HANDED THE ROW'S KEY, with no digest of the copy on the end.
 *
 * Round 10 added that digest so a CHANGED request would get a fresh provider identity: a corrected
 * recipient had to actually reach the new address rather than being deduplicated onto the old one.
 * Round 11 then moved the destination INTO the row key, and round 19 narrowed the digest to the
 * copy alone because the recipient no longer needed covering here. What was left was a mechanism
 * whose only remaining effect is inside the one window it was supposed to protect.
 *
 * TRACE THE CASES. The digest can only matter when the provider holds a record of an attempt and
 * this side does not, because that is the only time the key is presented twice. There are exactly
 * two such states, and the copy digest is wrong in both:
 *
 *   The crash window. The provider accepts, the process dies before COMMIT, and the whole
 *   transaction rolls back — so the row is byte-identical to before the attempt. A checklist review
 *   then rewrites that pending row's subject or body, the retry presents a different digest, the
 *   provider cannot recognise it, and the same person is messaged twice. That is precisely the
 *   double-send AC 2 says a crash between send and mark-sent must not cause.
 *
 *   The timed-out accept. The provider accepts, this side times out and marks the row failed. A
 *   corrected ADDRESS is already handled, because it is a different row with a different key. A
 *   corrected copy hits the same defect as above.
 *
 * So the digest bought nothing the row key does not already provide, and cost the guarantee it sat
 * beside. Removed rather than conditioned.
 *
 * THE OTHER PROPOSED FIX CANNOT WORK, and it is worth recording why rather than leaving it to be
 * suggested again: "do not rewrite an ATTEMPTED row's payload", by analogy with rounds 11 and 12
 * refusing to rewrite an attempted row's recipient. Those rounds could identify the row because a
 * failed attempt records itself. The crash window records nothing, by definition — that is what
 * makes it the crash window — so there is no attempted row to recognise. The analogy holds for the
 * failure case and misses the case actually reported.
 *
 * WHAT THIS COSTS, stated rather than implied: if the provider accepted a message and a later
 * regeneration changed that alert's wording, the corrected wording may be deduplicated away. The
 * organizer did receive the message, on the same requirement and the same channel, and the
 * checklist carries the corrected dates on every visit. Delivering one message twice to the same
 * person is the harm the spec names; delivering the earlier wording of a message they already have
 * is not.
 */
const providerKey = (row: DueAlertRow): string => row.in_flight_key ?? row.idempotency_key;

/**
 * The addresses to schedule to: what the organizer just entered, falling back to what this event's
 * existing alerts were already addressed to. The fallback is what makes a regeneration keep
 * working — F-202's "review items" is the same idempotent POST, and it should not need the contact
 * details re-typed to keep the reminders alive.
 */
/**
 * Store what the organizer just entered, and return where this event's alerts go.
 *
 * A field the request did not mention is left alone; a field it sent as null is cleared. That
 * distinction is why `AlertContactsUpdate` keeps `undefined` and `null` apart — collapsing them
 * would make every checklist review that omits a phone number silently delete the one on file.
 */
/**
 * An email address as a destination rather than as typed, so one mailbox is one destination.
 *
 * `person@example.com` and `person@EXAMPLE.COM` reach the same mailbox. Stored as typed they hash
 * differently, so the reconciler saw a different destination, inserted new pending rows and sent
 * the same reminders again — which AC 7 permits only for a genuinely different destination, and a
 * case change is not one.
 *
 * WHAT IS CANONICALISED: surrounding whitespace, and the DOMAIN lowercased. RFC 1035 makes the
 * domain case-insensitive, so those two really are one destination and treating them as two is a
 * defect.
 *
 * WHAT IS DELIBERATELY NOT, because over-normalising an address is its own defect and a worse one:
 * the LOCAL part is case-sensitive by RFC 5321, so `Person@` and `person@` may be different
 * mailboxes and folding them would send one organizer's filing deadlines to another. Nor are dots
 * stripped or plus-tags removed: those are conventions of particular providers, not properties of
 * an address, and applying them generally merges mailboxes that are not the same. An address with
 * no `@` is left exactly as typed rather than guessed at.
 */
const canonicalEmail = (value: string | null): string | null => {
  if (value === null) return null;
  const trimmed = value.trim();
  const at = trimmed.lastIndexOf("@");
  if (at === -1) return trimmed;
  return `${trimmed.slice(0, at)}@${trimmed.slice(at + 1).toLowerCase()}`;
};

async function resolveContacts(
  client: PoolClient,
  eventId: string,
  supplied: AlertContactsUpdate,
): Promise<AlertContacts> {
  const setsEmail = supplied.email !== undefined;
  const setsPhone = supplied.phone !== undefined;
  if (setsEmail || setsPhone) {
    await client.query(
      `INSERT INTO event_alert_contacts (event_id, email, phone)
         VALUES ($1, $2, $3)
       ON CONFLICT (event_id) DO UPDATE
         SET email = CASE WHEN $4 THEN EXCLUDED.email ELSE event_alert_contacts.email END,
             phone = CASE WHEN $5 THEN EXCLUDED.phone ELSE event_alert_contacts.phone END,
             updated_at = current_timestamp`,
      // BOTH COLUMNS, NOT ONE. The email went through a canonical form and the phone did not, on
      // this line, so `+1 (212) 555-0100` and `+12125550100` hashed as different destinations: a
      // retyped number minted a replacement set of alerts and, under AC 7's destination rule, left
      // every already-sent row intact while re-sending each already-due SMS. Whatever reasoning
      // canonicalized the email applies unchanged to the number beside it.
      //
      // `normalizeOptionalPhone` already existed and `rsvps.ts` already used it, so this reuses it
      // rather than inventing a second answer. Moved into `contact.ts` instead of imported across,
      // because alerts reaching into the RSVP module for a helper would couple two features that
      // share nothing else.
      [
        eventId,
        canonicalEmail(supplied.email ?? null),
        canonicalOptionalPhone(supplied.phone ?? null),
        setsEmail,
        setsPhone,
      ],
    );
  }
  const { rows } = await client.query<{ email: string | null; phone: string | null }>(
    "SELECT email, phone FROM event_alert_contacts WHERE event_id = $1",
    [eventId],
  );
  return { email: rows[0]?.email ?? null, phone: rows[0]?.phone ?? null };
}

/** Where this event's alerts go, for a caller that is only reading. */
export async function alertContacts(database: Queryable, eventId: string): Promise<AlertContacts> {
  const { rows } = await database.query<{ email: string | null; phone: string | null }>(
    "SELECT email, phone FROM event_alert_contacts WHERE event_id = $1",
    [eventId],
  );
  return { email: rows[0]?.email ?? null, phone: rows[0]?.phone ?? null };
}

const recipientFor = (contacts: AlertContacts, channel: AlertChannel): string | null =>
  channel === "email" ? contacts.email : contacts.phone;

export function createAlertScheduler(settings: AlertSchedulerSettings): AlertScheduler {
  const clock = settings.now ?? (() => new Date());

  return async (client, eventId, planId, supplied) => {
    const contacts = await resolveContacts(client, eventId, supplied);
    const channels = ALERT_CHANNELS.filter((channel) => recipientFor(contacts, channel) !== null);
    const planned =
      channels.length === 0 ? [] : await plannedAlerts(client, planId, settings, clock());

    let scheduled = 0;
    const keys: string[] = [];
    /** Alerts this review brought back from `cancelled`, whose attempts belong to what it ended. */
    const revived: string[] = [];
    for (const alert of planned) {
      for (const channel of channels) {
        // Non-null: `channels` is filtered on exactly this.
        const recipient = recipientFor(contacts, channel) ?? "";
        const key = idempotencyKey(eventId, alert.identity, channel, recipient);
        keys.push(key);
        // THE ROW THAT ALREADY SAID THESE WORDS TAKES THIS KEY, before the upsert can mint a second
        // one beside it. `legacyIdentity` explains why the boundary exists; what it needs here is
        // one statement. The subject match is the whole test: this row is about to be delivered
        // saying exactly what that row was delivered saying, so they are one alert and one of them
        // has already gone out. `NOT EXISTS` because two routes of one line can publish the same
        // name and the same window, and only the first of them may adopt.
        if (alert.legacyIdentity !== undefined) {
          await client.query(
            `UPDATE alerts SET idempotency_key = $2
              WHERE idempotency_key = $1
                AND payload->>'subject' = $3
                AND NOT EXISTS (SELECT 1 FROM alerts held WHERE held.idempotency_key = $2)`,
            [idempotencyKey(eventId, alert.legacyIdentity, channel, recipient), key, alert.subject],
          );
        }
        const { rows } = await client.query<{ id: string; inserted: boolean; revived: boolean }>(
          // The status BEFORE this statement, which `RETURNING` cannot see: it returns the row as
          // written, and a revival is only recognisable by what the row was. Read in a CTE, so it
          // is the same statement's snapshot rather than a second round trip that another
          // transaction could commit inside.
          `WITH prior_status AS (
             SELECT status FROM alerts WHERE idempotency_key = $7
           )
           INSERT INTO alerts (id, event_id, checklist_item_id, alert_type, channel, recipient,
                               idempotency_key, send_at, status, payload)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'pending', $9::jsonb)
           ON CONFLICT (idempotency_key) DO UPDATE
             -- SAME ALERT, SAME DESTINATION, RECOMPUTED — and the destination is now part of what
             -- "same" means, because it is part of the key. A pending row takes the new copy; a row
             -- cancelled by an earlier regeneration comes back if the requirement did. A SENT row is
             -- matched by the WHERE and left exactly as it is: AC 7's "sent alerts are never
             -- re-sent". send_at moves with the payload, because an alert keeps its identity while
             -- its date changes: the unlock is keyed on the requirement rather than on the day it
             -- fires, so a regeneration that recomputes that day has to move the row it already owns
             -- instead of leaving it pointing at the old one.
             --
             -- RECIPIENT IS NOT SET HERE, AND NOTHING ELSE NEEDS TO KEY ON IT EITHER. This clause
             -- used to rewrite it, and to reset failure_count and next_attempt_at whenever it
             -- changed, because a correction had to reach a row that already existed. It does not
             -- any more: a corrected address hashes to a different key, so it INSERTs a fresh row
             -- that starts at count 0 with no backoff by definition, and the row it replaces is
             -- cancelled by the reconciler below and keeps every fact its attempts established.
             -- Three mechanisms became one, and the two that went were not merely still-correct —
             -- they were unreachable, since a row this statement conflicts with now necessarily has
             -- the same recipient as the one being scheduled.
             --
             -- WHAT SURVIVES IS THE STATUS, and only the half of it that was never about the
             -- recipient. A failed row whose review changed nothing must keep saying failed, or
             -- failedDeliveries stops counting it and the organizer's warning disappears with no
             -- new attempt made and the same dead address still in backoff. A cancelled row coming
             -- back must go to pending. The recipient half of that condition is gone with the rest.
             --
             -- Kept on the status rather than derived from failure_count in failedDeliveries: a row
             -- that failed twice and then sent keeps a non-zero count forever, so a derived warning
             -- would outlive the problem, and excluding sent rows to fix that just rebuilds status
             -- out of two columns. One meaning for one word.
             --
             -- Every other reader already accepts 'failed' and is unaffected: the poller's scan and
             -- claim both match ('pending', 'failed'), the reconciler's cancel matches both, and
             -- this clause's own WHERE matches both. Checked rather than assumed.
             -- MERGED, NOT REPLACED. Wholesale assignment took the newly rendered subject and
             -- body and dropped everything the delivery path had written, so an unchanged review
             -- wiped last_error while leaving the row failed with its count and its backoff:
             -- an operator saw that delivery failed and lost the only record of why, which this
             -- module keeps in the payload and nowhere else. The right-hand side wins on every
             -- key it carries, so the copy is still recomputed; keys only the delivery path
             -- writes survive because nothing on the right names them.
             -- send_at KEYS ON THE SAME FACT THE BACKOFF DOES, which is the rule one field over.
             -- Rewriting it on every review made an old or late alert look newly scheduled, and
             -- AC 2 measures delivery latency FROM this column, so a failed row could keep a
             -- fifteen-minute next_attempt_at that now sat far outside its apparent window. An
             -- unchanged intended slot keeps its stored send_at for exactly the reason it keeps its
             -- backoff: nothing about the schedule changed, so neither derived value should move.
             --
             -- I CHECKED THE REST OF THIS CLAUSE for the same shape, because rounds 16, 24 and 28
             -- were each one check present at one layer and absent at the next. payload must always
             -- update, since it carries the recomputed copy and the intended_at this comparison
             -- reads; status keys on the prior status rather than on the schedule; failure_count
             -- and next_attempt_at already key on it; and recipient is not set here at all, because
             -- round 11 made a changed destination a different row. send_at was the only field left
             -- that moved when nothing had.
             -- DELIVERY EVIDENCE DOES NOT SURVIVE A REVIVAL, which is the fourth transition rule on
             -- this clause and follows from the third rather than adding to it. Round 33 decided a
             -- revival is a fresh schedule because a cancelled row was not in the queue while it was
             -- cancelled; last_error is evidence from exactly that ended queue membership, so it
             -- goes with the failure_count the branch below already clears. Left behind, a revived
             -- pending row, and later a successfully sent one, kept reporting a provider error from
             -- a lifecycle that had finished.
             --
             -- CHECKED THE REST OF THE MERGED PAYLOAD, since this clause has now needed four rules.
             -- Exactly two keys are written by the delivery path rather than by the scheduler:
             -- last_error on failure and delivery on success. Everything else on the right-hand
             -- side, the copy and intended_at and event_revision and controlling_apply_by, is
             -- written by the scheduler and therefore refreshed on every upsert already. Both
             -- delivery keys are dropped here. A cancelled row cannot in fact be carrying delivery,
             -- because a sent row is cancelled by no path in this file, but stating that as a proof
             -- makes it something a later change has to keep true; dropping both costs one token
             -- and removes the obligation.
             --
             -- ON cancelled, NOT on a fresh schedule, and the distinction is the same one round 27
             -- drew. A reminder whose date moved kept its queue membership: the attempt really
             -- happened against that destination, so its evidence survives what the plan
             -- recomputes. Only a withdrawal ends the membership the evidence belongs to.
             SET payload = CASE
                   WHEN alerts.status = 'cancelled'
                     THEN (alerts.payload - 'last_error' - 'delivery') || EXCLUDED.payload
                   ELSE alerts.payload || EXCLUDED.payload
                 END,
                 -- Both schedule-derived columns read ONE predicate, so a branch cannot be added
                 -- to one and missed on the other. See HAS_A_FRESH_SCHEDULE for the rule and for
                 -- why a missing intended slot deliberately counts as unchanged.
                 send_at = CASE WHEN ${HAS_A_FRESH_SCHEDULE} THEN EXCLUDED.send_at
                                ELSE alerts.send_at END,
                 status = CASE WHEN alerts.status = 'failed' THEN 'failed' ELSE 'pending' END,
                 -- A REVIVED ALERT STARTS CLEAN, which is the third transition this clause has had
                 -- to answer and the one that was never given a rule. Round 9 decided an unchanged
                 -- destination keeps its evidence; round 11 decided a corrected address gets its
                 -- own row, so it starts fresh by construction. Cancelled-then-revived is neither:
                 -- the requirement went away and came back, and the row that returns is the one
                 -- that was withdrawn.
                 --
                 -- Keeping the old counters there meant an immediately due revived alert sat out a
                 -- fifteen-minute backoff earned before it was cancelled, and its next failure was
                 -- scored as a high-count retry rather than a first one. The evidence belonged to
                 -- an attempt at a requirement PopEngine had since decided not to send at all.
                 --
                 -- Only from 'cancelled'. A 'failed' row whose review changed nothing keeps
                 -- everything its attempts established, which is round 9 and is not reopened here.
                 -- ONE RULE RATHER THAN A FOURTH BRANCH, because four special cases is what
                 -- produced this finding. The rule is that these two columns are different KINDS
                 -- of thing and only one of them is a fact:
                 --
                 --   failure_count is EVIDENCE about a destination. It survives anything the plan
                 --   recomputes, because attempts against an address happened whatever the plan
                 --   now says. It is cleared in exactly one case, a row returning from cancelled,
                 --   because those attempts were made for a requirement PopEngine had since
                 --   decided not to send at all.
                 --
                 --   next_attempt_at is DERIVED from that evidence at a moment, as clock plus a
                 --   backoff step. A derived value is only valid while everything it was derived
                 --   from is unchanged, so it cannot outlive either the evidence being cleared or
                 --   the schedule it was anchored to being rewritten.
                 --
                 -- That covers all four transitions without naming them. Unchanged destination,
                 -- unchanged schedule: both survive, which is round 9. Corrected address: a
                 -- different key and therefore a different row, which is round 11 and never
                 -- reaches this clause. Cancelled and revived: evidence cleared, so the derivation
                 -- goes with it. Recomputed to a new send_at: the anchor moved, so the derivation
                 -- goes even though the evidence stays.
                 --
                 -- The cost of the last one, stated: a dead address whose alert is rescheduled
                 -- gets one immediate attempt rather than serving out its backoff. Round 9's
                 -- concern was that EVERY review wiped it; only a review that MOVES the row does
                 -- now, the retained count re-derives the right step on the next failure, and the
                 -- scan orders it behind untried work regardless.
                 failure_count = CASE WHEN alerts.status = 'cancelled' THEN 0
                                      ELSE alerts.failure_count END,
                 next_attempt_at = CASE WHEN ${HAS_A_FRESH_SCHEDULE} THEN NULL
                                        ELSE alerts.next_attempt_at END
             WHERE alerts.status IN ('pending', 'cancelled', 'failed')
           -- xmax = 0 is true only for a row this statement inserted, which is what separates a
           -- newly scheduled alert from one that already existed and was recomputed in place.
           RETURNING id, xmax = 0 AS inserted,
                     (SELECT status FROM prior_status) = 'cancelled' AS revived`,
          [
            randomUUID(),
            eventId,
            alert.checklistItemId,
            alert.alertType,
            channel,
            recipient,
            key,
            alert.sendAt.toISOString(),
            JSON.stringify({
              subject: alert.subject,
              body: alert.body,
              ...(alert.planEventRevision === undefined
                ? {}
                : { event_revision: alert.planEventRevision }),
              ...(alert.controllingApplyBy === undefined
                ? {}
                : { controlling_apply_by: alert.controllingApplyBy }),
              ...(alert.routeScheduled === undefined ? {} : { route_scheduled: true }),
              ...(alert.intendedAt === undefined ? {} : { intended_at: alert.intendedAt }),
            }),
          ],
        );
        if (rows[0]?.inserted === true) scheduled += 1;
        if (rows[0]?.revived === true && rows[0].id !== undefined) revived.push(rows[0].id);
      }
    }

    // WHAT THE REVIVAL OWES THE ROW IT BROUGHT BACK. The clause above already treats a return from
    // cancelled as a fresh schedule — new send_at, no failure count, no backoff, no last_error —
    // and an attempt made for the withdrawn schedule is the one piece of that lifecycle it could
    // not reach, because it lives on another table. Left behind, it kept the revived alert out of
    // every scan and every claim indefinitely once it aged past the provider's dedup window, so a
    // deadline that came back was never delivered at all.
    //
    // SUPERSEDED, NOT RESOLVED, and the two words are not interchangeable here. Writing
    // `outcome_recorded_at` would claim somebody observed what the provider did with that message,
    // which nobody did; the row stays unresolved and is still what a reconciliation would read.
    //
    // The trade is stated rather than hidden, because it is a real one: if that lost attempt did
    // arrive, the revived alert is a second copy. A duplicate reminder is a cost an organizer can
    // absorb, and a filing window that closes unannounced is the failure this feature exists to
    // prevent — so it is logged loudly and sent, not held forever.
    if (revived.length > 0) {
      const { rows: superseded } = await client.query<{ alert_id: string }>(
        `UPDATE alert_send_attempts SET superseded_at = clock_timestamp()
          WHERE alert_id = ANY($1::uuid[])
            AND outcome_recorded_at IS NULL
            AND superseded_at IS NULL
          RETURNING alert_id`,
        [revived],
      );
      if (superseded.length > 0) {
        // Ids only. The recipient is contact data and does not go in a log (AGENTS.md).
        console.warn(
          `${superseded.length} attempt(s) with no recorded outcome belonged to an alert schedule ` +
            `that was cancelled and has now been revived; they no longer hold it back, so the ` +
            `alert will be sent and may duplicate a delivery nobody observed: ` +
            `${superseded.map((row) => row.alert_id).join(", ")}`,
        );
      }
    }

    // Everything still waiting to go out that the recomputed set no longer contains: a requirement
    // the regeneration dropped, a date it moved, or — since the destination is part of the key — an
    // address the organizer corrected. Cancelled, never deleted; the row is the record that
    // PopEngine intended to send it, and for one that was attempted it is the record of where the
    // attempt went (AC 2, AC 7). `failed` is included because a failed row is still queued for the
    // next tick, and an alert nobody intends to send must stop retrying whether it is obsolete or
    // superseded. This one statement is now the whole of what a contact correction does to the
    // alerts that were already there.
    const { rowCount } = await client.query(
      `UPDATE alerts SET status = 'cancelled'
        WHERE event_id = $1
          AND status IN ('pending', 'failed')
          AND NOT (idempotency_key = ANY($2::text[]))
          AND coalesce(payload->>'test', 'false') <> 'true'`,
      [eventId, keys],
    );

    return {
      scheduled,
      cancelled: rowCount ?? 0,
      channels,
      reason:
        channels.length === 0
          ? "no contact was supplied for this event, so no alerts were scheduled"
          : null,
    };
  };
}

type DueAlertRow = {
  id: string;
  channel: AlertChannel;
  recipient: string;
  idempotency_key: string;
  /**
   * The key an earlier handoff already presented for this row, or null where none has been. See
   * `providerKey`: the row's key is what PopEngine currently calls this reminder, and this is what
   * the provider may already know it as.
   */
  in_flight_key: string | null;
  payload: { subject?: string; body?: string };
};

/**
 * The key of the attempt still speaking for this row, read as a column so `providerKey` needs no
 * second round trip inside the send. Ordered so a row holding several unresolved attempts presents
 * the FIRST key it ever presented, which is the one the provider's window is measured from.
 */
const IN_FLIGHT_KEY = `(
       SELECT attempt.idempotency_key
         FROM alert_send_attempts AS attempt
        WHERE attempt.alert_id = alerts.id
          AND attempt.outcome_recorded_at IS NULL
          AND attempt.superseded_at IS NULL
        ORDER BY attempt.attempted_at, attempt.id
        LIMIT 1
     )`;

/**
 * Where the attempt-intent write gets its connection, which must not be the pool the send already
 * holds one from.
 *
 * A SEND HOLDS ONE CONNECTION AND NEEDS A SECOND, so taking both from one pool deadlocks it: as
 * soon as concurrent sends fill the pool, every one of them holds a client and waits for another,
 * and none can release what it holds. The poller's own pool could be oversized around that; the
 * alerts router cannot, because `POST /events/:id/alerts/test` runs on the API's shared pool and
 * would take the whole API down with it rather than only itself.
 *
 * So intent writes have a pool of their own, derived from the source pool's own connection
 * settings. It can never be the side that starves: a connection is held for one INSERT and
 * released, never across a provider call.
 *
 * ONE PER DATABASE RATHER THAN PER POOL, because the scarce resource is the server's connection
 * limit and not the pool object. The api already points two pools at the same database, and giving
 * each of them a writer would reserve twice the connections for a write that is never the
 * bottleneck.
 */
const attemptWriters = new Map<string, Pool>();

/** What makes two pools the same database, so they can share one writer. */
function connectionTarget(options: Pool["options"]): string {
  return JSON.stringify([
    options.connectionString ?? null,
    options.host ?? null,
    options.port ?? null,
    options.database ?? null,
    options.user ?? null,
  ]);
}

function attemptWriterFor(database: Pool): Pool {
  const target = connectionTarget(database.options);
  const existing = attemptWriters.get(target);
  if (existing !== undefined) return existing;
  const writer = new Pool({
    ...database.options,
    // Every send can be recording its intent at once, because none of them may wait on another's
    // provider call to reach the provider at all.
    max: SEND_CONCURRENCY,
    // Nothing owns this pool's lifetime, since it is derived from another pool rather than built
    // by a composition root that would close it, so it must not be what keeps a process alive.
    allowExitOnIdle: true,
  });
  attemptWriters.set(target, writer);
  return writer;
}

/**
 * Record that this alert is ABOUT to be handed to a provider, in a transaction of its own.
 *
 * ITS OWN CONNECTION, which is the mechanical heart of issue #166. The point of the record is to
 * survive the transaction that is sending, so it cannot be written by that transaction: a crash
 * before its COMMIT takes the intent down with the mark-sent it was meant to outlive. A second
 * connection commits immediately and independently.
 *
 * It cannot write to the `alerts` row either — the claim holds it — so the intent is a child row.
 * A foreign key takes only FOR KEY SHARE on the parent, which is compatible with the claim's
 * FOR NO KEY UPDATE, so the insert does not queue behind the send it is recording.
 *
 * AND THE CUTOFF IS ASKED AGAIN HERE, because getting this connection is the one step between the
 * claim and the provider that no arithmetic bounds. Everything else the margin covers is a
 * statement on a connection the sending transaction already holds; this one is taken from a second
 * pool, so it can queue behind `SEND_CONCURRENCY` other sends or wait on a new backend, for as
 * long as that takes. `DEDUP_WINDOW_CLAIM_MARGIN_MS` is what the claim reserved for the rest of the
 * work, and a wait that outlasts it puts the repeated key at the provider after the 24 hours it
 * deduplicates within — the second delivery the hold exists to prevent, arriving through the very
 * statement that records it. Re-asking is the answer rather than a timeout on the wait: a bound
 * would only make the overrun shorter, while the predicate says whether this send is still the one
 * the claim permitted. Returning null means it is not, and nothing is sent.
 *
 * Asked INSIDE the insert, so there is no second gap between the question and the record.
 *
 * THE ID IS GENERATED HERE RATHER THAN BY THE DATABASE, so the row can be named without the
 * answer. An autocommit INSERT commits before its result is written back, so a connection that
 * drops in between leaves a committed, unresolved attempt and a rejected promise: the send never
 * happened, and with a server-side default nothing in this process knew which row to say so about.
 * Aged past the cutoff, that attempt excluded the alert from every scan for good — a reminder
 * nobody ever handed over, never delivered.
 *
 * AND IT RETIRES WHAT THIS SEND OVERTOOK, which is what leaves the next hold something to be
 * measured from. The hold is measured from the alert's FIRST unresolved attempt (see
 * `unresolvedAttemptPastTheCutoff`), so an attempt whose provider window closed before this send
 * was made can no longer be duplicated by anything and can no longer say anything about the
 * alert. Left unresolved it would anchor every later bound in the past, no attempt could hold the
 * row again, and an outage that keeps producing unobserved outcomes would send on every tick. This
 * send is the one that speaks for the alert now, so those attempts are superseded by it, in the
 * same sense and the same column a revived schedule uses. They stay UNRESOLVED, because nobody did
 * find out what the provider did with them.
 *
 * CONDITIONAL ON THE INSERT, and in one statement with it. A held alert is exactly one whose oldest
 * unresolved attempt sits between the two edges, so a retirement that ran when the insert was
 * refused would clear the hold it was refused by. Made to depend on the inserted row, it runs only
 * where a send is actually being recorded, and it commits or is lost with it.
 */
async function recordAttemptIntent(
  database: Pool,
  row: DueAlertRow,
  /**
   * The jurisdiction's ZONE, because the hold this insert asks about is bounded by the alert's own
   * filing window as well as by the limit. Supplied by the caller for the same reason every other
   * reader of a day takes it from one: this file has no honest default for which jurisdiction it is.
   *
   * DERIVED BY THE STATEMENT, not at the call and not at the parameter list. Getting this writer's
   * connection is the wait nothing bounds, the one every comment on this path is about, and issuing
   * the insert afterwards is another; a day materialized on either side of them can be yesterday by
   * the time PostgreSQL evaluates the hold's window edge. Sending the zone leaves nothing to go
   * stale.
   */
  timeZone: string,
): Promise<string | null> {
  const writer = attemptWriterFor(database);
  const attemptId = randomUUID();
  const client = await writer.connect();
  let recorded: string | null;
  try {
    const { rows } = await client.query<{ id: string }>(
      `WITH recorded AS (
         INSERT INTO alert_send_attempts (id, alert_id, idempotency_key)
              SELECT $3, alerts.id, $2 FROM alerts
               WHERE alerts.id = $1 AND NOT ${hasAnUnresolvedAttempt(jurisdictionDayInSql("$4"))}
           RETURNING id
       ), overtaken AS (
         UPDATE alert_send_attempts AS attempt
            SET superseded_at = clock_timestamp()
          WHERE attempt.alert_id = $1
            AND attempt.outcome_recorded_at IS NULL
            AND attempt.superseded_at IS NULL
            AND attempt.attempted_at
                < clock_timestamp() - interval '${PROVIDER_DEDUP_WINDOW_HOURS} hours'
            AND EXISTS (SELECT 1 FROM recorded)
       )
       SELECT id FROM recorded`,
      // THE KEY THIS SEND WILL PRESENT, not the row's, so the record says what the provider was
      // actually handed. They differ on exactly one row — one whose key was rewritten after an
      // earlier handoff — and recording the row's there would lose the only copy of the key a
      // reconciliation could look the message up by.
      [row.id, providerKey(row), attemptId, timeZone],
    );
    recorded = rows[0]?.id ?? null;
  } catch (error) {
    // GIVEN BACK BEFORE THE RECOVERY ASKS FOR ONE, which is the difference between recovering and
    // wedging. This pool holds `SEND_CONCURRENCY` connections and a tick starts that many workers,
    // so a refusal that comes from the database rather than from a dropped connection (a
    // statement, permission or timeout error) leaves every worker holding a live client that
    // `pg` has no reason to evict. Settling first meant all of them waited on a pool none of them
    // could return anything to, with the poller's alert transactions open for as long as that
    // lasted: no reminder sent, by the path added to stop reminders being lost.
    //
    // NOTHING THE SETTLEMENT NEEDS GOES BACK WITH IT. It resolves `attemptId`, generated in this
    // process, against a row named by `row`, both values this frame holds, and it has always
    // written them on a second connection of its own, so this one never carried any of its state.
    // There is no open transaction to abandon either: the insert is autocommit, and the answer that
    // rejected it is the server's, so the statement is finished on the backend before this runs.
    client.release();
    await settleUnacknowledgedIntent(writer, row, attemptId);
    throw error;
  }
  client.release();
  return recorded;
}

/**
 * Close an intent whose insert this process never got an answer for.
 *
 * RESOLVED RATHER THAN HELD, which is the opposite of what migration 014 does with its own
 * unknowns and is the right way round for this one. A hold says nobody can tell what a provider
 * did with the message; here the sender has not run, so there is no message and no provider to ask
 * — the state is not ambiguous, only the acknowledgement was. Left open, it would be a hold this
 * side could have ruled out, on a filing reminder that never left the process.
 *
 * WRITTEN AS AN INSERT OF THE KNOWN ID, not an update of whatever can be found. The connection can
 * go away while the backend is still running the original statement, so a search for the row can
 * miss it and the attempt then lands unresolved a moment later — the same permanent exclusion, one
 * race further on. Inserting that id either records the resolved attempt or queues on the one in
 * flight and resolves it, so neither ordering leaves the alert held.
 *
 * A ROW THIS WRITES WHERE THE ORIGINAL NEVER LANDED IS TRUE OF WHAT HAPPENED: an attempt was
 * begun, and nothing was handed over. It is resolved, so no scan, claim or hold count reads it.
 *
 * Its own connection, for the reason every write here takes one: the sending transaction is still
 * open, and this has to commit whatever becomes of it.
 */
async function settleUnacknowledgedIntent(
  writer: Pool,
  row: DueAlertRow,
  attemptId: string,
): Promise<void> {
  const client = await writer.connect();
  try {
    await client.query(
      `INSERT INTO alert_send_attempts (id, alert_id, idempotency_key, outcome_recorded_at)
            VALUES ($1, $2, $3, clock_timestamp())
       ON CONFLICT (id) DO UPDATE SET outcome_recorded_at = clock_timestamp()`,
      [attemptId, row.id, providerKey(row)],
    );
  } finally {
    client.release();
  }
}

/**
 * Send one claimed alert and record what happened, in the transaction that claimed it.
 *
 * The claim is `FOR NO KEY UPDATE SKIP LOCKED`, so two ticks (or two api instances) cannot both
 * hold the same row. Marking happens inside the same transaction as the send, so the only window
 * left is a crash between the provider accepting the message and the COMMIT — after which the row
 * is still pending and the next tick sends the same `idempotency_key` again. That is why the key
 * goes to the provider (AD-13): this side cannot distinguish "never sent" from "sent, mark lost",
 * and the provider can.
 *
 * THAT DEFERRAL EXPIRES, which is what the intent record above is for. The provider only honours a
 * repeated key for `PROVIDER_DEDUP_WINDOW_HOURS`; past that the same retry is a second delivery.
 * So the attempt is written before the send and resolved after it, and a resolution that never
 * arrives is what a later scan reads to hold the row instead of retrying it blind.
 */
async function deliverClaimed(
  client: PoolClient,
  row: DueAlertRow,
  senders: AlertSenders,
  database: Pool,
  jurisdiction: string,
): Promise<SendOutcome | null> {
  const sender = senders[row.channel];
  // NOTHING TO RECONCILE WHERE NOTHING IS HANDED OVER. The intent exists to catch one state: a
  // provider holding a message whose outcome this side never learned. The SMS channel is the
  // labelled in-product simulation while A2P registration is outstanding, so it has no provider,
  // no key anyone could look a message up by, and no way for a retry to duplicate a delivery —
  // the crash this record survives loses nothing but a render. Writing one anyway meant a crash
  // between the intent and the sending transaction eventually took the alert permanently out of
  // the queue and told the organizer their text alerts were handed to a sending service, both
  // about a message that never left the process.
  //
  // ASKED OF THE SENDER, not of the channel. `alerts.ts` reads the channel everywhere and could
  // have excluded `sms` in a word, but that word is a claim about configuration this file cannot
  // see — the same inference `alert-delivery.ts` refuses when it records what a send actually was
  // on the row rather than leaving a reader to work it out. A live SMS sender is marked as
  // reaching a provider by saying nothing, so this needs no edit on the day one lands.
  let attemptId: string | null = null;
  if (sender.reachesAProvider !== false) {
    attemptId = await recordAttemptIntent(database, row, jurisdictionTimeZone(jurisdiction));
    // The claim permitted this send and the wait for the writer's connection outlived what the
    // claim reserved, so the permission has expired: the key would reach the provider outside the
    // window it deduplicates within. Nothing is sent and nothing is marked, so the row is exactly
    // what it was and the next tick reads it as the hold it has become.
    if (attemptId === null) return null;
  }
  const resolveAttempt = async (queryable: Queryable): Promise<void> => {
    if (attemptId === null) return;
    await queryable.query(
      "UPDATE alert_send_attempts SET outcome_recorded_at = clock_timestamp() WHERE id = $1",
      [attemptId],
    );
  };
  // A DELIVERY IS RECORDED IN THE SENDING TRANSACTION, so a crash that loses the mark-sent loses
  // this too. That is the correct outcome rather than a limitation: the provider is holding a
  // message this side never confirmed, and both writes describe that same lost knowledge.
  const recordDelivery = async (): Promise<void> => resolveAttempt(client);
  // A PROVEN NON-DELIVERY IS NOT, and the difference is which way the loss falls. This side knows
  // the provider was never reached, so nothing can be duplicated by a retry and the attempt is
  // closed. Written on the sending connection, that knowledge rolled back with the mark-failed
  // whenever the process died holding it, and an outage lasting past the provider's dedup window
  // then left the next process reading a KNOWN non-delivery as an unresolved attempt: the alert is
  // held out of every poll and named as a message someone must reconcile against a provider that
  // never had it. A hold is the one state nothing in this product clears by itself, so the
  // evidence that rules it out has to survive independently of the transaction that learned it.
  //
  // ON THE ATTEMPT WRITER'S CONNECTION, the same one the intent was written on and for the same
  // mechanical reason: it commits on its own, immediately, and cannot be rolled back by the send.
  // It updates no key column, so it takes no lock on the `alerts` row the claim is holding.
  //
  // AND WRITTEN AGAIN IF THE FIRST WRITE IS REFUSED, because a single statement is not somewhere
  // knowledge that must survive can be left. A dropped writer connection, or a database that
  // answers this UPDATE with an error, threw out of the delivery: the sending transaction rolled
  // back with the mark-failed still inside it, and the attempt stayed unresolved even though this
  // side had already proved the provider was never reached. No later tick repairs that row (a
  // retry opens its own attempt and resolves that one), so the unresolved row ages until it passes
  // the cutoff and holds the alert out of every scan for good, over exactly the outage the poller
  // is supposed to ride out.
  //
  // A FRESH CONNECTION FOR THE SECOND WRITE, which is what the intent-insert acknowledgement path
  // already does after the same kind of refusal, and with the same statement: an idempotent write
  // of a known id can only reach the state it was trying to reach, however many times it runs. The
  // first connection goes back before the second is asked for, for the reason recorded on that
  // path: this pool holds `SEND_CONCURRENCY` connections and a tick starts that many workers, so a
  // refusal answered by a live backend leaves every worker holding a client none of them may wait
  // on a pool for.
  //
  // AND GETTING THE CONNECTION IS PART OF WHAT IS RECOVERED, which is where this was wrong. The
  // second write exists because the first one can be refused, and it was written to cover the
  // statement while leaving the acquisition in front of it: this pool holds no connection open
  // across a provider call, so between the intent and here its client can be dropped and the
  // reconnect is a fresh wait on the database, the transient connect timeout the sending client
  // never sees, because it is holding its own connection throughout. Raised outside the `try`,
  // that rejection carried a committed intent out of the delivery, the sending transaction rolled
  // back with the mark-failed still in it, and a non-delivery this side had PROVED was left
  // unresolved: the one state nothing clears by itself, reached over exactly the outage the poller
  // is supposed to ride out.
  //
  // The settlement is what recovers it, on a connection it asks for itself, so a pool that has one
  // to give a moment later still records what happened.
  const recordProvenNonDelivery = async (): Promise<void> => {
    if (attemptId === null) return;
    const writerPool = attemptWriterFor(database);
    let writer: PoolClient | null = null;
    try {
      writer = await writerPool.connect();
      await resolveAttempt(writer);
    } catch {
      // Only where one was actually taken: a refused acquisition leaves nothing to give back, and
      // the settlement asks this pool for a connection either way.
      writer?.release();
      await settleUnacknowledgedIntent(writerPool, row, attemptId);
      return;
    }
    writer.release();
  };
  // THE SEND BOUNDARY: the last statement before the provider, and the place both decisions about
  // this send are now made.
  //
  // BOTH IN ONE STATEMENT, because what went wrong twice was not either question but the gap after
  // it. The window was asked, then a connection was taken and an intent written; the cutoff was
  // asked, then the window was asked again. Each answer was correct where it was given and stale by
  // the time it was used, and each fix bounded one more wait. Asked here there is no gap left to
  // insert one into: after this line the next thing that happens is the request.
  //
  // THE WINDOW, because getting the writer's connection is a wait no arithmetic bounds — it can
  // queue behind `SEND_CONCURRENCY` other sends or wait on a new backend — so a claim that passed
  // just before local midnight could hand over copy naming a deadline that has since gone, a
  // reminder telling an organizer to file by yesterday, issued by the path whose job is to retire
  // that row. `today` is recomputed rather than reused: the stale value is the whole defect.
  // Retired here rather than only left alone, because that is what the claim does with a window it
  // finds already shut, and the two are the same decision made at two moments.
  //
  // THE CUTOFF, because that same wait spends the margin the claim reserved for it. Past the
  // provider's dedup window the repeated key is deduplicated by nobody and the organizer gets a
  // second copy of the same reminder. Nothing is sent and nothing is marked, so the row is exactly
  // what it was and the next tick reads it as the hold it has become.
  //
  // THE INTENT IS CLOSED ON BOTH PATHS. Nothing was handed over, so an attempt left open would ask
  // a person to reconcile a message that never left this process — and would itself become a hold
  // 24 hours later, recorded by the statement that refused to send.
  //
  // AND ON THE PATH WHERE THE QUESTION ITSELF IS REFUSED, which is the same statement failing
  // rather than answering. A rejection here — a dropped connection, a cancelled statement — is
  // PROOF that the provider was never reached, because the sender is on the other side of this
  // line, so it is exactly the proven non-delivery every other branch settles. Left to unwind,
  // the exception carried a committed intent out of `sendOne` and that attempt paused the alert
  // for the whole hold while no provider could possibly have been holding it.
  if (attemptId !== null) {
    const boundaryDay = todayInJurisdiction(jurisdiction, new Date());
    const handoffDay = dayTheHandoffCanLastUntil(jurisdiction, Date.now());
    // Stamped by the ask itself, for the reason `askTheSendBoundary` records: an anchor taken when
    // this frame resumes cannot see the wait it is supposed to be measuring.
    const boundary = await askTheSendBoundary(client, row.id, boundaryDay, handoffDay).catch(
      async (error: unknown) => {
        await recordProvenNonDelivery();
        throw error;
      },
    );
    // THE DAY THE ANSWER WAS ABOUT, which is not necessarily the day it arrived on. The cutoff
    // half of this statement reads `clock_timestamp()` and is therefore evaluated whenever the
    // backend gets to it, but the window half is asked about `$2`, a calendar day this process
    // computed before the statement was issued — and issuing it is another wait nothing bounds: a
    // stalled backend or a connection that has to be re-established can carry it over local
    // midnight. Answered then, `FILING_WINDOW_HAS_SHUT` says false about yesterday and the
    // reminder goes to the provider naming a filing date the organizer can no longer meet.
    //
    // RECOMPUTED AND COMPARED rather than trusted, which is the same treatment the margin
    // assertion below gives the same kind of wait. A day that turned over means the answer is not
    // about this send, so it is not used at all — not even to cancel, since a decision taken on
    // the wrong day is wrong in both directions. Fails closed: nothing is handed over, the intent
    // is closed because nothing was, and the next tick asks both questions again on the day it is
    // then.
    //
    // BOTH DAYS THE ANSWER WAS ABOUT, since the statement now asks the window twice: once about
    // the day the boundary is on and once about the day the handoff it permits can last until.
    // The second turns over first, in the last `SEND_BOUNDARY_MARGIN_MS` of every day, and an
    // answer computed before that instant says the window is open at a moment it is not.
    if (
      todayInJurisdiction(jurisdiction, new Date()) !== boundaryDay ||
      dayTheHandoffCanLastUntil(jurisdiction, Date.now()) !== handoffDay
    ) {
      console.warn(
        `alert ${row.id} crossed a jurisdiction day boundary while the send boundary was in ` +
          `flight, so its filing-window answer is about ${boundaryDay} and not about the day ` +
          `this send would happen on; nothing was sent`,
      );
      await recordProvenNonDelivery();
      // SKIPPED, for the reason the margin refusal below is: this exit takes no decision at all —
      // not even to cancel — so it leaves the row exactly as due as it found it, with its intent
      // closed and nothing claiming it. What it needs is the same two questions asked again on the
      // day it is now, which is one claim away, and reporting it as handled makes the tick wait
      // out an interval first. On a row whose window is still open that is a delivery delayed for
      // no reason; on one whose window has shut it is a retirement delayed the same way.
      return { status: "skipped" };
    }
    if (boundary.shut) {
      // SETTLED WHERE THE SETTLEMENT CAN SURVIVE, which is not here. This statement is the
      // strongest proof this file ever has that the provider was never reached — the sender is on
      // the other side of it — and recorded on the sending connection that proof went back with
      // the transaction whenever the transaction went back. What was left was the alert still
      // pending and still carrying an unresolved attempt about a message no provider could be
      // holding: the one state nothing in this product clears by itself, and one an organizer's
      // own regeneration then carries onto the refreshed reminder, where it can hold that too.
      //
      // The independent writer is what every other pre-handoff exit here uses, and this was the
      // one that did not.
      await recordProvenNonDelivery();
      // The cancellation stays in the sending transaction, which is where it belongs: it is a
      // decision about the alert row this transaction holds the claim on, and if the transaction
      // is lost the row is simply still due and the next tick retires it on the same answer.
      await client.query("UPDATE alerts SET status = 'cancelled' WHERE id = $1", [row.id]);
      return null;
    }
    if (boundary.held) {
      // On the writer's own connection, for the reason `recordProvenNonDelivery` records: this
      // transaction is about to be rolled back to nothing, and the knowledge that no message left
      // has to survive that.
      await recordProvenNonDelivery();
      return null;
    }
    // THE ASSERTION THE MARGIN RESTS ON. Everything above reserved room for one bounded request and
    // for getting to it; if getting to it took longer than that reservation, the answer above is no
    // longer the answer for this send and the key could reach the provider outside the window it
    // deduplicates within. Fails closed, like every other boundary decision here: nothing is handed
    // over, the intent is closed because nothing was, and the next tick reads the row as it stands.
    if (!handoffFitsTheMargin(boundary.askedAt, Date.now())) {
      console.warn(
        `alert ${row.id} spent more than ${SEND_BOUNDARY_HANDOFF_BUDGET_MS}ms between the send ` +
          `boundary and the provider handoff, which is the margin the boundary reserved for it; ` +
          `nothing was sent`,
      );
      await recordProvenNonDelivery();
      // SKIPPED RATHER THAN NULL, because this refusal leaves work nobody is doing. The row is
      // pending, unmarked and immediately retryable — it was not cancelled, not rescheduled and
      // not taken by another worker, which is everything `null` is allowed to mean here. Reported
      // as nothing to do, a non-full scan reads as drained and the poller waits out a whole
      // interval before asking again; an alert that had already waited nearly one interval before
      // this tick claimed it then misses AC 2's two-minute bound over an event-loop pause of a
      // second, with a healthy provider on the other end. Reported as unfinished, the tick's own
      // skip retry chases it, which is what it does with every other due-but-unclaimed row.
      //
      // Round 16 drew this distinction at the alert and round 31 at the tick; this is the same
      // distinction missing on the one exit that creates the condition itself rather than
      // discovering it.
      return { status: "skipped" };
    }
    // THE WINDOW EDGE, asked where the dedup margin is asserted and for the same reason. See
    // `dayTheHandoffCanLastUntil`: the answer above is true of the whole of `boundaryDay` and says
    // nothing about how much of it is left, so a final-day reminder can pass this boundary with
    // seconds to spare and still reach the provider after the window has shut, naming a filing
    // date the organizer can no longer meet. This is the same question asked about the last day
    // the request can still be running on, so it stops exactly that row and no other: an alert
    // whose window is open past today, and one that has no window at all, are unaffected by how
    // little of the day is left.
    if (boundary.shutByTheHandoffsEnd) {
      console.warn(
        `alert ${row.id} reached the send boundary with less than ${SEND_BOUNDARY_MARGIN_MS}ms of ` +
          `its filing window left in ${jurisdiction}, which is what the bounded handoff in front ` +
          `of the provider can cost, so the window could shut before the request lands; ` +
          `nothing was sent`,
      );
      await recordProvenNonDelivery();
      // Null rather than skipped, unlike the margin refusal above: that one is a gap this process
      // can be through on the very next attempt, and this one is the day ending. There is no later
      // moment inside the window for a retry to use, so nothing is owed and the next tick retires
      // the row rather than chasing it.
      return null;
    }
  }
  try {
    const delivery = await sender({
      recipient: row.recipient,
      subject: row.payload.subject ?? "",
      body: row.payload.body ?? "",
      idempotencyKey: providerKey(row),
    });
    await client.query(
      // `clock_timestamp()`, not `current_timestamp`: the latter is the TRANSACTION's start, and
      // this transaction opened before the provider was called. A send that took ten seconds would
      // be audited as having happened ten seconds earlier than it did, which is measured against
      // `send_at` to check AC 2's two-minute bound — so the one number that says whether the bound
      // was met would be the number flattering it.
      `UPDATE alerts
          SET status = 'sent', sent_at = clock_timestamp(), payload = payload || $2::jsonb
        WHERE id = $1`,
      [row.id, JSON.stringify({ delivery })],
    );
    await recordDelivery();
    return { status: "sent", delivery, error: null };
  } catch (error) {
    const message =
      error instanceof AlertDeliveryError ? error.message : "delivery failed for an unknown reason";
    if (!(error instanceof AlertDeliveryError))
      console.error(`alert ${row.id} delivery failed`, error);
    // A refusal and an unreachable host are answers, so the attempt is closed and the row keeps
    // being retried for as long as the outage lasts (spec edge case: nothing is lost). A timeout
    // is not an answer, and an unrecognised throw is not one either, so those are left open and
    // reconciled rather than retried once the provider's dedup window has passed.
    if (error instanceof AlertDeliveryError && error.outcomeObserved)
      await recordProvenNonDelivery();
    // Failed, counted, and left for the next tick. Nothing is lost while a provider is down
    // (spec edge case); the count is what distinguishes a blip from an address that never works.
    await client.query(
      `UPDATE alerts
          SET status = 'failed',
              failure_count = failure_count + 1,
              next_attempt_at = clock_timestamp() + (${RETRY_BACKOFF}),
              payload = payload || $2::jsonb
        WHERE id = $1`,
      [row.id, JSON.stringify({ last_error: message })],
    );
    return { status: "failed", delivery: null, error: message };
  }
}

/**
 * Claim one alert by id and send it. Returns null when another worker got there first or the row
 * stopped being due (cancelled by a regeneration between the scan and the claim).
 */
type SendOutcome =
  | { status: "sent" | "failed"; delivery: AlertDelivery | null; error: string | null }
  /**
   * The event row was held by a writer, so this alert was not attempted and is still due.
   *
   * Distinct from `null`, and the distinction is the whole of the :1064 fix. `null` means there was
   * nothing for this worker to do — the row was cancelled, rescheduled, or already claimed by
   * another worker who will finish it. A skip means the opposite: the work is outstanding and
   * nobody is doing it. Returning the same value for both made the poller count a skipped alert as
   * completed and leave it until the next 60-second tick, which with the interval's own wait can
   * put a HEALTHY provider outside AC 2's two-minute bound. A checklist review that overlaps a tick
   * is ordinary use, not scale, so this is reachable today rather than eventually.
   */
  | { status: "skipped" };

async function sendOne(
  database: Pool,
  alertId: string,
  senders: AlertSenders,
  jurisdiction: string,
): Promise<SendOutcome | null> {
  const client = await database.connect();
  try {
    await client.query("BEGIN");
    // THE EVENT ROW IS WHO OWNS THE EVENT'S ALERTS, and it is taken before the alert itself.
    //
    // Checklist review already locks this row for its whole transaction, and reconciliation runs
    // inside it. Without taking it here the two collided on the alert row instead, and the alert
    // row is the wrong place to collide: the reconciler's cancel matches `pending`/`failed`, so
    // when it queued behind a claim the poller was holding, it woke up to a row that had become
    // `sent` and skipped it — having waited for precisely the delivery it existed to prevent. The
    // organizer's regenerated plan cancelled everything except the stale alert that was already
    // going out (AC 7).
    //
    // SKIP LOCKED rather than waiting, because a review in progress is about to decide this
    // alert's fate: not sending it costs one tick, and the row is either cancelled or still there
    // afterwards. The reverse order — a send already in flight when a review starts — is not a
    // race at all: that alert was current when it left, and the review's own lock wait bounds it
    // at one `PROVIDER_TIMEOUT_MS`.
    //
    // SHARED, NOT EXCLUSIVE, and that one word is what separates the claim boundary from the send
    // boundary. Taking it exclusively made the event the unit of concurrency too: two workers on
    // two alerts of the same event collided with each other, so an event's alerts had to be sent
    // one at a time and a checklist with several due reminders serialised behind itself. But the
    // poller's workers do not need to exclude EACH OTHER — they need to exclude the two writers
    // that can invalidate an alert mid-flight, and both of those (`events.ts` on an intake edit,
    // `checklist.ts` on a review) take this row FOR UPDATE. `FOR SHARE` conflicts with exactly
    // those and with nothing else, so ownership stays event-scoped while sending goes back to
    // being alert-scoped.
    //
    // It also strengthens the guarantee it was introduced for. A reviewer must now wait out every
    // in-flight send for its event before it can hold the row exclusively, so by the time its
    // cancellation runs there is no claim left for it to queue behind — the case that started
    // this cannot arise rather than being handled.
    const { rows: owner } = await client.query(
      `SELECT event.id FROM events AS event
         JOIN alerts ON alerts.event_id = event.id
        WHERE alerts.id = $1
        FOR SHARE OF event SKIP LOCKED`,
      [alertId],
    );
    if (owner[0] === undefined) {
      await client.query("ROLLBACK");
      // Transient by construction: the writer holding this row commits in milliseconds, and when it
      // does the alert is either cancelled or still due. Reported as a skip so the tick can come
      // back to it rather than banking it as done.
      return { status: "skipped" };
    }
    // DUE IS RE-ASKED HERE, not inherited from the scan. Between the two, a regeneration can
    // commit and move this row: an unlock alert keeps its identity across a recomputed
    // `apply_after_date` (that is what stops it announcing itself twice), so reconciliation
    // rewrites `send_at` on a row that stays pending and keeps the id the scan already picked up.
    // Claiming on status alone would then deliver a rescheduled alert at the old moment — telling
    // an organizer a window is open days before the plan says it is.
    //
    // The event lock above is what makes this recheck meaningful rather than another race: it is
    // held before this reads, so what it reads is a state no review is midway through changing.
    // The lock supplies the safe point; the predicate is still needed to use it.
    // The ZONE, not the day. This transaction has already waited on the event lock and is about
    // to wait on the row's, so a day derived here is a day bound into a statement with unbounded
    // waits behind it; `jurisdictionDayInSql` derives it where the predicates read it instead.
    const timeZone = jurisdictionTimeZone(jurisdiction);
    const claimDay = jurisdictionDayInSql("$2");
    const { rows } = await client.query<DueAlertRow>(
      // The staleness check belongs HERE as well as in the scan, and for the same reason the due
      // predicate is re-asked here: the event edit this guards against can commit in the window
      // between the two. The event row is held by then, so what this reads is a revision no writer
      // is midway through changing.
      `SELECT id, channel, recipient, idempotency_key, payload,
              ${IN_FLIGHT_KEY} AS in_flight_key
         FROM alerts
        WHERE id = $1 AND status IN ('pending', 'failed') AND send_at <= statement_timestamp()
          AND (next_attempt_at IS NULL OR next_attempt_at <= statement_timestamp())
          AND ${NOT_FROM_A_STALE_PLAN}
          -- RE-ASKED HERE for the same reason as everything else on this claim: an attempt can
          -- age past the dedup window between the scan and this, and the decision must be made
          -- where the alert is acted on.
          --
          -- A HOLD STOPS A SEND, NOT AN EXISTENCE. Written as a bare NOT, this predicate also
          -- stopped the row from reaching the expiry decision below, so a held alert whose filing
          -- window later shut could never be retired: it stayed pending and was reported as
          -- needing a person to reconcile it against a provider, about a deadline that can no
          -- longer be reminded at all. Nothing the hold protects is at risk on that path — a
          -- cancellation delivers nothing and cannot duplicate anything — so a closed window is
          -- let through to be retired, and the expiry check three statements down is what it
          -- reaches. It cannot reach a send: that branch returns before one.
          AND (NOT ${hasAnUnresolvedAttempt(claimDay)} OR ${FILING_WINDOW_HAS_SHUT(claimDay)})
          -- RE-ASKED HERE, not inherited from the sweep at the top of the tick. See
          -- FILING_WINDOW_HAS_SHUT: the queue this row came from can run for the whole budget,
          -- so a tick that swept before local midnight could deliver a filing date that had since
          -- become yesterday. Read under the event lock, which is what makes it a safe point
          -- rather than another race.
          --
          -- FOR NO KEY UPDATE rather than FOR UPDATE, which changes nothing about who may send
          -- this alert — the two conflict with each other and with every UPDATE, so one worker
          -- still excludes the others and the reconciler still queues behind a claim. What it
          -- stops excluding is FOR KEY SHARE, the lock a foreign key takes on the parent row, so
          -- the attempt-intent insert can commit on its own connection while this transaction is
          -- still open. Under FOR UPDATE that insert would wait for the send it is recording,
          -- which is the one thing it must not do.
        FOR NO KEY UPDATE SKIP LOCKED`,
      [alertId, timeZone],
    );
    const row = rows[0];
    if (row === undefined) {
      await client.query("ROLLBACK");
      return null;
    }
    // THE EXPIRY DECISION IS MADE HERE, under the lock, rather than in a bulk sweep that took no
    // lock at all. The sweep could read a pre-edit `revision_counter`, judge the old plan current,
    // and cancel its expired failed alerts before the edit committed — so a row that round 14 says
    // must be HELD for review was withdrawn instead, its failure warning disappeared, and the
    // regeneration revived it with its delivery evidence cleared.
    //
    // Deferred to this point rather than locked in bulk, which is the option that fits what is
    // already here: this is the per-alert safe point, the event row is held, the window recheck
    // lives here for the same reason, and the staleness predicate above is evaluated against a
    // revision no writer is midway through changing. One decision, one place, one lock.
    //
    // ASKED ABOUT THE DAY IT IS NOW, not the day the claim was computed for. The claim is a wait
    // like any other — the event lock, the row's own lock, the statement itself — so `today` can
    // be yesterday by the time this runs. On the simulated SMS channel this is the LAST filing
    // window check there is: nothing is handed to a provider, so no intent is recorded and the
    // send boundary that re-asks the question is never reached.
    const { rows: expired } = await client.query(
      `SELECT 1 FROM alerts WHERE id = $1 AND ${FILING_WINDOW_HAS_SHUT(jurisdictionDayInSql("$2"))}`,
      [alertId, timeZone],
    );
    if (expired[0] !== undefined) {
      // Cancelled rather than left pending, for round 19's reason: the scheduler will refuse to
      // re-create an alert for a window that has shut, so nothing is undecided, and leaving it
      // would report a delivery still being retried.
      await client.query("UPDATE alerts SET status = 'cancelled' WHERE id = $1", [alertId]);
      await client.query("COMMIT");
      return null;
    }

    const outcome = await deliverClaimed(client, row, senders, database, jurisdiction);
    await client.query("COMMIT");
    return outcome;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export type AlertTickSummary = {
  readonly sent: number;
  readonly failed: number;
  /** Due alerts the tick's time budget stopped it claiming. They stay due for the next tick. */
  readonly abandoned: number;
  /**
   * Due alerts a writer's lock kept this tick from attempting at all, after its retry window.
   *
   * A subset of `abandoned`, reported separately because the two mean opposite things to the
   * caller. Abandoned-with-sends is a tick that ran out of budget doing work. Skipped is a tick
   * that could not start: the work is still there and nobody is doing it.
   */
  readonly skipped: number;
  /**
   * Due alerts whose send was attempted, whose outcome was never observed, and whose attempt is
   * now older than the provider's dedup window. Attempted rather than handed over: the attempt is
   * recorded before the sender runs, so a process that died in between counts here too.
   *
   * NOT a subset of `abandoned`, and not work this tick failed to reach: no tick claims these
   * while they are held. Retrying one may deliver a second copy to the same person, so it waits
   * for a human to reconcile it against the provider, or for `UNRESOLVED_ATTEMPT_HOLD_LIMIT_HOURS`
   * to pass, after which it is retried anyway. Counted because a queue that stops moving with
   * nothing failing is otherwise indistinguishable from an empty one.
   */
  readonly heldForReconciliation: number;
  /**
   * Whether this tick reached the end of the work that was due, which is the ONE question the
   * poller has to answer and has been inferring three different ways.
   *
   * Round 16 taught it that an all-skipped tick is not an idle tick. A full batch then looked like
   * a finished one, because the scan is capped and 96 successful sends report no shortfall at all.
   * Both are the same missing distinction: "there is no more work" against "there is more work I
   * did not reach", inferred from counters that happen to correlate with it. A fourth condition
   * would have been a fourth correlation.
   *
   * So the tick states it instead. `false` when the scan came back at its cap, when the budget
   * stopped it with rows still queued, or when a writer's lock left rows unattempted. Anything
   * that later stops a tick short only has to set this, rather than teaching `start` a new shape.
   */
  readonly drained: boolean;
};

export type AlertPoller = {
  /** One pass over everything due. Exposed so tests drive the poller without waiting on a timer. */
  tick(): Promise<AlertTickSummary>;
  start(): void;
  /**
   * Stop taking work, and settle what is already in flight.
   *
   * Awaitable because a process that exits mid-send is how an alert acquires an attempt nothing
   * recorded: the provider accepts, the row's transaction never commits, and the alert is left
   * `pending`, which reads as never attempted to every later reader, including the one migration
   * 014 creates. DEPLOY.md's release order asks a deployer to drain the running api for exactly
   * that reason, and a drain nobody can await is an instruction the process cannot carry out. That
   * step applies from the rollout after the one introducing this: the build it stops on that one
   * predates the handler, and the runbook says what covers that single window instead.
   */
  stop(): Promise<void>;
};

export function createAlertPoller(dependencies: {
  readonly database: Pool;
  readonly senders: AlertSenders;
  /**
   * The jurisdiction whose calendar day decides whether a filing window has shut.
   *
   * Required rather than defaulted, because there is no honest default: a wrong jurisdiction here
   * cancels alerts on the wrong day, and a made-up one would be exactly the invented fact this
   * file refuses everywhere else. `index.ts` already computes `today` from
   * `engineRuleset.jurisdiction` two lines above where the poller is built.
   */
  readonly jurisdiction: string;
  readonly intervalMs?: number;
  /** Injected so a test can drive the tick budget without spending it in real time. */
  readonly clock?: () => number;
}): AlertPoller {
  const { database, senders, jurisdiction } = dependencies;
  const clock = dependencies.clock ?? (() => Date.now());
  let timer: NodeJS.Timeout | null = null;
  let runningTick: Promise<AlertTickSummary> | null = null;
  let stopped = false;

  const tick = async (): Promise<AlertTickSummary> => {
    // EACH STATEMENT ASKS ABOUT THE DAY IT RUNS ON, which is the rule every other reader of a
    // jurisdiction day in this file arrived at. One day pinned for the whole tick was the older
    // shape and it read as consistency: the scan can run for the whole budget, so a tick that
    // started before local midnight counted holds against a day that had gone and warned an
    // operator about rows the claims behind it, which re-read the day under the event lock, go
    // on to retire without anyone reconciling anything. The two statements do not need the same
    // value; they need the right one.
    // The ZONE, not the day: every statement below derives its own day where it reads it, so
    // there is no value here for an unbounded wait to make stale.
    const timeZone = jurisdictionTimeZone(jurisdiction);
    const day = jurisdictionDayInSql("$1");
    // Ids first, then one transaction per alert. One transaction for the whole batch would hold
    // every send under a single COMMIT, so a crash midway would re-send everything already
    // delivered in it; per row, only the row in flight is ever in doubt.
    //
    // FEWEST FAILURES FIRST, and only then oldest-due first. The scan is capped, so the ordering
    // decides who is served when more is due than one tick can take — and ordering by `send_at`
    // alone made that "whoever has been failing longest", permanently. A row that cannot be
    // delivered keeps its original `send_at` and stays eligible, so a full batch of dead
    // destinations was re-selected every tick and nothing behind them was ever claimed, however
    // long the queue grew and however well the provider was working for everyone else.
    //
    // `failure_count` is what breaks that: every attempt moves a failing row further back, so all
    // untried rows are served before any once-failed one, and no alert can be starved by another
    // alert's bad address. Retries still happen on every tick that has room, which is what the
    // spec's outage edge case asks for — nothing is dropped, it just stops being served first.
    const { rows } = await database.query<{ id: string }>(
      // `next_attempt_at` is what finally removes a dead destination from the batch rather than
      // only demoting it. `failure_count` ordering was the previous answer and cannot be the whole
      // one: it ranks rows within a scan, so a backlog that fails keeps being re-scanned and
      // re-attempted, and at ten seconds a send it consumes every scan indefinitely.
      // Excluded from the SCAN too, not only from the claim. A stale event's alerts stay pending
      // indefinitely, so leaving them selectable would have them consume a slot in every capped
      // scan for as long as the organizer takes to regenerate, pushing deliverable alerts behind
      // rows that can never be sent. Same reasoning as `next_attempt_at`, which removes a dead
      // destination from the batch rather than only demoting it.
      `SELECT id FROM alerts
        WHERE status IN ('pending', 'failed')
          AND send_at <= statement_timestamp()
          AND (next_attempt_at IS NULL OR next_attempt_at <= statement_timestamp())
          AND ${NOT_FROM_A_STALE_PLAN}
          -- Excluded from the scan as well as from the claim, so a row awaiting reconciliation
          -- does not consume a slot in every capped scan for as long as it goes unreconciled.
          -- Except where its window has shut, for the reason the claim states: a held row still
          -- has to be able to reach the one path that retires it, and that path sends nothing.
          AND (NOT ${hasAnUnresolvedAttempt(day)} OR ${FILING_WINDOW_HAS_SHUT(day)})
        -- SAME-INSTANT ROWS ARE ORDERED BY WHAT DEPENDS ON WHAT, not by uuid. A gated window
        -- exactly one reminder offset wide puts the dependency alert and the filing reminder on the
        -- same send_at, and the tiebreak then fell through to id, so which one an organizer saw
        -- first was random. The unlock is what tells them the filing waits on another agency, so it
        -- goes first.
        --
        -- STATED PLAINLY, BECAUSE THIS ORDERS THE CLAIM AND NOT THE DELIVERY: workers run
        -- concurrently, so the two can still be in flight together. Serialising them would mean
        -- holding a filing reminder behind a dependency alert that might be failing, trading a
        -- missed deadline for a sequencing nicety, and that is the wrong way round. What makes the
        -- remaining overlap harmless is the other half of this fix: at sendOn === openOn the
        -- reminder now carries the sequencing note itself, so it names the dependency whichever
        -- order the two arrive in.
        --
        -- NOT PINNED BY A TEST, and saying so is worth more than implying it is. Claim order is not
        -- observable through any surface this suite can read: two due rows are taken by two
        -- concurrent workers, and asserting which reached the provider first would be pinning a
        -- race rather than a guarantee. What IS pinned is the sequencing note, which is the thing
        -- an organizer actually receives. This line makes the order deterministic instead of
        -- uuid-random, costs nothing, and is defence rather than demonstrated behaviour.
        -- CHANNELS INTERLEAVE, so a channel that is timing out cannot consume the budget of one
        -- that is healthy. failure_count already demotes a failing ROW and puts every untried
        -- alert ahead of every retried one, which is why the reported case is not an eligibility
        -- problem: it is that 48 untried emails timing out at ten seconds each fill scan after
        -- scan while the healthy SMS behind them waits its turn in send_at order. Nothing demoted
        -- the failing CHANNEL, and a provider outage is per-channel here — email goes to Resend
        -- and SMS is rendered in-product — so taking the oldest of each channel in turn puts the
        -- healthy one in the first wave instead of behind the whole backlog.
        --
        -- WITHIN a channel the order is untouched: oldest first, exactly as before. This changes
        -- which channel is served next, never which alert within one.
        --
        -- PARTITIONED BY failure_count TOO, or the rank undoes the priority it sits inside. The
        -- outer key puts every untried alert ahead of every retried one; a rank counted over the
        -- whole channel gave a NEW email sitting behind a hundred retryable failures rank 101, so
        -- inside the untried band it lost to twenty-four rank-one rows of another channel and was
        -- excluded from the scan entirely while its own provider was healthy. Restarting the rank
        -- per attempt count means a first attempt stays a first attempt within its channel as well
        -- as across them, and the rank is only ever compared between rows the outer key has
        -- already put in the same band.
        --
        -- WHAT I DID NOT DO, because it trades against the bound it protects: give the first retry
        -- a real delay. RETRY_BACKOFF makes it immediate on purpose, one failure is usually a
        -- blip, and an alert that has already spent up to a polling interval waiting cannot also
        -- absorb a backoff step before its first retry and stay inside AC 2. Demoting the channel
        -- costs nothing an alert is owed.
        ORDER BY failure_count,
                 row_number() OVER (PARTITION BY channel, failure_count ORDER BY send_at, id),
                 send_at,
                 CASE alert_type WHEN 'dependency_unlocked' THEN 0 ELSE 1 END, id
        LIMIT ${MAX_ALERTS_PER_TICK}`,
      [timeZone],
    );
    const scanWasFull = rows.length === MAX_ALERTS_PER_TICK;
    if (scanWasFull) {
      // At the cap, so there may be more due than the delivery bound covers. Said out loud
      // because the alternative is a scan that silently serves a prefix of the queue.
      console.warn(
        `alert poll filled its ${MAX_ALERTS_PER_TICK}-row scan; alerts beyond it wait for the ` +
          `next scan and may exceed the ${DELIVERY_BOUND_MS}ms delivery bound`,
      );
    }
    // WHAT THE SCAN JUST REFUSED TO CLAIM, counted rather than left silent. A held row is due,
    // undelivered as far as this side knows, and no tick will move it while the hold lasts: the
    // ways out are a human checking the provider for the key and then either marking the alert
    // sent or clearing its attempt, or the hold limit passing, after which the poller retries it
    // and accepts the possible duplicate. Reporting nothing would make that look like an empty
    // queue, and the first of those two exits is the one that avoids the duplicate.
    //
    // NOT ROWS THE PRODUCT CAN RETIRE ITSELF, which is why the scan's staleness predicate is here
    // too. A hold asserts that only a person checking the provider can resolve this alert, and
    // that is false of one whose plan the event has been edited past: regeneration cancels it. The
    // count without the predicate warned about every obsolete row on every tick for as long as an
    // organizer took to regenerate, which is both a false alarm and the way a genuine hold gets
    // buried.
    //
    // A SHUT WINDOW IS THE OTHER THING THE PRODUCT RETIRES ITSELF, so it is excluded here for the
    // same reason staleness is. This tick is about to cancel that row rather than leave it for a
    // person, and warning that it needs reconciling in the same pass that retires it is the false
    // alarm the staleness predicate was added to stop.
    //
    // AND NEITHER IS A DEMO SEND, which migration 014 and the organizer's own notice already
    // refuse and this count did not. A test row whose intent committed before the api went down
    // never reaches `retireFailedTestAlert`, so it comes back due and unresolved and ages past the
    // cutoff like any other — and was then named on every tick as a permanent reconciliation. An
    // AC 6 demo is an operator action against no deadline: nobody is waiting on it, so warning
    // about one only buries the genuine holds this counter exists to make visible.
    const { rows: held } = await database.query<{ id: string }>(
      `SELECT id FROM alerts WHERE ${HELD_FOR_RECONCILIATION(day)}`,
      [timeZone],
    );
    if (held.length > 0) {
      // Ids only. The row's recipient is contact data and does not go in a log (AGENTS.md).
      //
      // ATTEMPTED, NOT HANDED OVER, and the difference is the whole of what the operator reading
      // this is about to go and find out. The attempt is recorded before `sender(...)` runs, so a
      // process that died in that gap leaves the same evidence as one that died mid-send; past the
      // cutoff both are this line. Asserting the handoff sends a reconciliation after a message
      // that may never have left this process, and says the one thing this side does not know.
      console.warn(
        `${held.length} alert(s) were recorded as attempted sends whose outcome never came back, ` +
          `so this side cannot tell whether a provider ended up holding them, long enough ago ` +
          `that its ${PROVIDER_DEDUP_WINDOW_HOURS}h dedup window would have closed before a ` +
          `retry could land, so they are held rather than retried until they reach ` +
          `${UNRESOLVED_ATTEMPT_HOLD_LIMIT_HOURS}h, when they are retried anyway: ` +
          `${held.map((row) => row.id).join(", ")}`,
      );
    }
    // The expiry sweep that used to run here is gone. It took no lock, so it could read a
    // pre-edit revision and cancel a row round 14 says must be held; the decision now happens at
    // the per-alert safe point in `sendOne`, where the event row is held. Scanning a shut-window
    // row costs one claim that retires it, which is what the sweep was doing anyway.
    let sent = 0;
    let failed = 0;
    let abandoned = 0;
    /** Alerts a writer's lock made this tick skip. Still due, and nobody else is sending them. */
    const skipped: string[] = [];

    // ONE FLAT QUEUE OF ALERTS. This was grouped by event for a while, because ownership of an
    // event's alerts is taken on the event row and two workers on one event collided over it —
    // which made the event the unit of concurrency and serialised a checklist's own reminders
    // behind each other. `sendOne` now takes that row in SHARED mode, so workers no longer exclude
    // each other and the grouping has nothing left to prevent. Claim boundary: the event. Send
    // boundary: the alert. They were only ever the same thing by accident of lock mode.
    const queue = rows.map(({ id }) => id);
    const startedAt = clock();
    const worker = async (): Promise<void> => {
      for (;;) {
        // Checked before claiming rather than after, so the budget bounds when the LAST request
        // starts. Anything left in the queue is untouched — not claimed, not marked — so it is
        // still due, and the next tick takes it with no state to unwind. `stopped` gets the same
        // treatment: a poller that has been shut down must stop TAKING work immediately rather
        // than finishing a scan it began, so at most the sends already in flight outlive the stop.
        if (stopped || clock() - startedAt >= TICK_BUDGET_MS) {
          abandoned += queue.length;
          queue.length = 0;
          return;
        }
        const id = queue.shift();
        if (id === undefined) return;
        // A row whose own transaction could not even record an outcome — the database went away
        // mid-send — must not take the rest of the batch down with it. It stays as it was, which
        // means it is still due on the next tick.
        const outcome = await sendOne(database, id, senders, jurisdiction).catch(
          (error: unknown) => {
            console.error(`alert ${id} could not be recorded`, error);
            // COUNTED AS UNREACHED, not as nothing to do. `drained` exists to tell "no more work"
            // from "more work I did not reach", and a transaction that threw is the second: the row
            // is untouched and still due. Reported as drained, the tick waited out a whole interval
            // and the retry could pass the bound.
            abandoned += 1;
            return null;
          },
        );
        if (outcome === null) continue;
        if (outcome.status === "skipped") {
          skipped.push(id);
          continue;
        }
        if (outcome.status === "sent") sent += 1;
        else failed += 1;
      }
    };
    const drain = async (): Promise<void> => {
      await Promise.all(
        Array.from({ length: Math.min(SEND_CONCURRENCY, queue.length) }, () => worker()),
      );
    };
    await drain();

    // A SKIPPED ALERT IS RETRIED INSIDE THIS TICK, not left for the next one. Waiting out the
    // interval spends 60 seconds of a 120-second budget on a lock that is held for milliseconds,
    // and with the interval's own wait before the tick a healthy provider could still miss AC 2.
    //
    // Bounded by its own short window rather than by the tick budget, per the note on
    // `SKIPPED_RETRY_WINDOW_MS`: a writer that holds the row longer than that still costs one tick,
    // which is the trade `SKIP LOCKED` was chosen for and is not being reopened here. Whatever is
    // still skipped is counted as abandoned below and stays due, the same honest reporting an
    // over-budget scan already gets.
    const retryUntil = clock() + SKIPPED_RETRY_WINDOW_MS;
    while (
      skipped.length > 0 &&
      !stopped &&
      clock() < retryUntil &&
      clock() - startedAt < TICK_BUDGET_MS
    ) {
      await new Promise((resolve) => setTimeout(resolve, SKIPPED_RETRY_WAIT_MS));
      queue.push(...skipped.splice(0));
      await drain();
    }
    const stillSkipped = skipped.length;
    abandoned += stillSkipped;
    // At the cap there may be more due than this scan could see, so a tick that filled its batch
    // has not reached the end however well every send in it went.
    const drained = !scanWasFull && abandoned === 0;

    if (abandoned > 0) {
      // Said out loud, because the alternative is a tick that quietly did a fraction of its work.
      console.warn(
        `alert poll stopped after ${TICK_BUDGET_MS}ms with ${abandoned} due alerts unclaimed; ` +
          `they stay due and are taken by the next tick`,
      );
    }
    return {
      sent,
      failed,
      abandoned,
      skipped: stillSkipped,
      heldForReconciliation: held.length,
      drained,
    };
  };

  /** Set while consecutive ticks keep reporting skipped work, so the chasing cannot run forever. */
  let chasingSince: number | null = null;
  let followUp: NodeJS.Timeout | null = null;

  return {
    tick,
    start() {
      if (timer !== null) return;
      stopped = false;
      const run = (): void => {
        // One tick at a time. The budget already keeps a tick inside the interval, but a timer
        // that fires regardless would turn any breach of that into two scans competing for the
        // same rows and the same connections — the pile-up this is all meant to prevent.
        if (timer === null || runningTick !== null) return;
        runningTick = tick();
        void runningTick
          .then((summary) => {
            // A tick that ran out of budget with rows still due does NOT wait out the interval.
            // Waiting is what turned a bound on one tick into a bound on throughput, and it is
            // idle time the due set is not getting: the interval is how often to LOOK when there
            // is nothing to do, not how fast work may be done when there is.
            //
            // ONE QUESTION, ASKED ONCE: did this tick reach the end of what was due. Everything
            // below reads `drained` rather than inferring it from a counter, which is what let a
            // full batch of successful sends look like a finished tick and leave the rest waiting
            // a whole interval.
            //
            // Still making progress, so go straight back for the rest.
            if (!summary.drained && summary.sent + summary.failed > 0) {
              chasingSince = null;
              setImmediate(run);
              return;
            }

            // AN ALL-SKIPPED TICK IS NOT A TICK WITH NOTHING TO DO, and the guard above read them
            // as the same thing because both come back with no sends. They are opposites: no work
            // means the queue was empty, skipped means the work is still waiting and nobody is
            // doing it. Round 13 drew exactly this distinction one layer down, at the alert; this
            // is the same distinction missing one layer up, at the tick.
            //
            // Left as it was, an alert that fell due just after an idle scan waited nearly a full
            // interval for the tick, spent the skip window being skipped, and then waited another
            // whole interval before a healthy provider was ever asked. Past AC 2's bound with
            // nothing having failed.
            //
            // BOUNDED THE SAME WAY AND FOR THE SAME REASON as the skip retry inside the tick: a
            // follow-up that chased indefinitely would hold the poller to one event's writer and
            // reverse the `SKIP LOCKED` decision. So the chasing runs for at most the window AC 2
            // gives the delivery in the first place, and then the interval takes over — by which
            // point a lock held that long is not a race, and no retry policy can send through it.
            // Not drained and nothing moved: a writer's lock, or a budget spent before the first
            // claim. Chased on a delay rather than immediately, because respawning a tick that
            // achieved nothing is a hot loop.
            if (!summary.drained) {
              chasingSince ??= clock();
              if (clock() - chasingSince < DELIVERY_BOUND_MS) {
                followUp = setTimeout(run, SKIPPED_FOLLOW_UP_WAIT_MS);
                followUp.unref();
                return;
              }
            }
            chasingSince = null;
          })
          .catch((error: unknown) => console.error("alert poll failed", error))
          .finally(() => {
            runningTick = null;
          });
      };
      timer = setInterval(run, dependencies.intervalMs ?? POLL_INTERVAL_MS);
      // Anything already due at boot is due now, not one interval from now. A restart is the one
      // moment a backlog is most likely, since nothing has been sending while the process was down.
      run();
      // The poller must never be the reason the process stays up.
      timer.unref();
    },
    async stop() {
      // The flag as well as the timer: clearing the timer stops the NEXT tick, and a tick already
      // running would otherwise work through its whole batch after the caller believes the poller
      // is off — still claiming rows and still sending them.
      stopped = true;
      // The follow-up as well, or a poller told to stop keeps waking up to chase skipped rows.
      if (followUp !== null) clearTimeout(followUp);
      followUp = null;
      chasingSince = null;
      if (timer !== null) clearInterval(timer);
      timer = null;
      // AND THEN THE SEND ALREADY IN FLIGHT, which the flag above cannot reach: it stops the
      // worker taking the NEXT row, and the row in its hand is inside a provider call with its
      // transaction open. Exiting there is what leaves a send nothing recorded: accepted by the
      // provider, `pending` in the database, invisible to the attempt record afterwards.
      //
      // The rejection is not this caller's to handle: `start` already logs a failed tick, and a
      // shutdown that threw because the last tick did would skip everything after it.
      await runningTick?.catch(() => undefined);
    },
  };
}

export type AlertsDependencies = {
  readonly database: Pool;
  readonly senders: AlertSenders;
  /**
   * The jurisdiction whose calendar day decides whether a filing window has shut.
   *
   * The test endpoint delivers through the same claim the poller uses, and that claim now
   * revalidates the window. Required rather than defaulted for the reason the poller's copy is: a
   * wrong jurisdiction rejects on the wrong day, and a made-up one is the invented fact this file
   * refuses everywhere else.
   */
  readonly jurisdiction: string;
};

/**
 * Send the test alert and report what the ROW says, not what this request did.
 *
 * A test alert is written due immediately, so the poller can claim it in the gap before the send
 * — and then the claim here returns null out of `SKIP LOCKED` having done nothing, because
 * someone else was already doing it. Answering off that produced "test alert could not be
 * delivered" for a message that was delivered, which is the one thing a delivery-check utility
 * must never say.
 *
 * The claim is retried rather than only re-read, because losing it means one of two things and
 * they need different handling: the poller is mid-send (the row settles to `sent` shortly, so
 * looking again answers it) or the poller already tried and failed it (the row is claimable
 * again, so trying again is what actually sends it). Bounded, because a demo utility may not hang
 * on a request.
 */
async function deliverTestAlert(
  database: Pool,
  alertId: string,
  senders: AlertSenders,
  jurisdiction: string,
): Promise<AlertView | null> {
  for (let attempt = 0; attempt < TEST_ALERT_CLAIM_ATTEMPTS; attempt += 1) {
    const outcome = await sendOne(database, alertId, senders, jurisdiction);
    const view = await alertView(database, alertId);
    // A SKIP IS NOT A RESULT, here for the same reason it is not one in the poller. `sendOne`
    // returns `skipped` when a checklist review or an intake edit holds the event row, which is an
    // ordinary concurrent write and not a delivery outcome. Treated as final it made this endpoint
    // answer 502 without having attempted anything, so a demo utility reported a failure that never
    // happened, in front of whoever the demo is for. Kept in the loop exactly like an in-flight
    // claim: the writer commits in milliseconds and the next attempt is the real one.
    if (outcome?.status === "skipped") {
      await new Promise((resolve) => setTimeout(resolve, TEST_ALERT_CLAIM_WAIT_MS));
      continue;
    }
    if (outcome !== null || view?.status === "sent") return view;
    await new Promise((resolve) => setTimeout(resolve, TEST_ALERT_CLAIM_WAIT_MS));
  }
  return alertView(database, alertId);
}

/**
 * Stop a demo row the endpoint has already reported on, so the poller does not send it later.
 *
 * The scan takes any due row and a test row is due immediately, which is deliberate: the poller
 * legitimately delivers one when it claims it in the gap before the endpoint does, and the endpoint
 * reports that as the success it is. What must not happen is the poller continuing to retry a row
 * whose outcome has ALREADY been reported as a failure to whoever asked for the test. A transient
 * outage would then deliver a demo message after the caller was told it failed, and a caller who
 * retried would get both.
 *
 * Cancelled rather than excluded from the poller, and the difference matters: excluding test rows
 * outright would break the race above, where the poller finishing a claim it won is the correct
 * outcome. Cancelling is narrower — it acts only once this endpoint has answered, which is exactly
 * when PopEngine stops intending to send it. Third exclusion of demo rows from an organizer-facing
 * mechanism, after `failedDeliveries` and the simulated count, and the same reason each time.
 *
 * The response still reports `failed`, because that is the truthful outcome of the attempt the
 * caller asked for. The row says cancelled, because that is PopEngine's intent afterwards. Those
 * are different questions.
 */
async function retireFailedTestAlert(
  database: Pool,
  view: AlertView | null,
): Promise<AlertView | null> {
  if (view === null || view.status !== "failed") return view;
  // GUARDED ON THE STATUS IT EXPECTS TO FIND, because the row it is retiring is immediately
  // eligible: the first retry's backoff is zero, so the poller can claim it between this endpoint
  // reading the row and this statement running. Unguarded, the update waited on that claim and then
  // wrote `cancelled` over a `sent` the poller had just committed — a message delivered, a row
  // saying it was withdrawn, and a caller told it failed. Round 27 chose to cancel here rather than
  // exclude test rows from the poller, and both halves of that reasoning still hold; what it missed
  // is that the choice opened a window it did not close.
  const { rowCount } = await database.query(
    "UPDATE alerts SET status = 'cancelled' WHERE id = $1 AND status = 'failed'",
    [view.id],
  );
  // Nothing updated means somebody else moved it, and the only thing that can is a delivery. Read
  // the row rather than reporting the view this function was handed, so the caller is told what
  // actually happened instead of a 502 that was true a moment ago.
  return rowCount === 0 ? alertView(database, view.id) : view;
}

/**
 * AC 6's demo utility. One real alert, immediately, through the same delivery path a scheduled
 * alert takes — and labeled a test in the copy itself, so nobody reading the message has to know
 * which endpoint produced it.
 *
 * It carries `alert_type = 'deadline_reminder'` because migration 001 constrains the column to the
 * three published types and a fourth would need an ordered forward migration widening that CHECK
 * (ruleset note, F-203 Outputs). `payload.test` is what marks it, and it is what keeps a later
 * regeneration from cancelling it.
 */
const TEST_ALERT_COPY = {
  subject: "[TEST] PopEngine alert test",
  body:
    "TEST ALERT — this message was sent from PopEngine's demo utility to prove the alert channel " +
    "works. It is not a filing reminder and states no deadline, requirement or agency position.",
};

export function createAlertsRouter(dependencies: AlertsDependencies): Router {
  const { database, jurisdiction, senders } = dependencies;
  const router = Router();

  router.post("/events/:id/alerts/test", (req, res, next) => {
    void (async () => {
      const eventId = req.params.id ?? "";
      if (!UUID.test(eventId)) {
        res.status(400).json({ error: "event id must be a uuid" });
        return;
      }
      const body: unknown = req.body;
      if (typeof body !== "object" || body === null || Array.isArray(body)) {
        res.status(400).json({ error: "body must be a JSON object" });
        return;
      }
      const { channel, recipient } = body as { channel?: unknown; recipient?: unknown };
      if (!isAlertChannel(channel)) {
        res.status(400).json({ error: `channel must be one of ${ALERT_CHANNELS.join(", ")}` });
        return;
      }
      if (typeof recipient !== "string" || recipient.trim() === "") {
        res.status(400).json({ error: "recipient must be a non-empty string" });
        return;
      }

      const { rows } = await database.query<{ id: string }>("SELECT id FROM events WHERE id = $1", [
        eventId,
      ]);
      if (rows[0] === undefined) {
        res.status(404).json({ error: `event ${eventId} not found` });
        return;
      }

      const alertId = randomUUID();
      await database.query(
        `INSERT INTO alerts (id, event_id, alert_type, channel, recipient, idempotency_key,
                             send_at, status, payload)
         VALUES ($1, $2, 'deadline_reminder', $3, $4, $5, current_timestamp, 'pending', $6::jsonb)`,
        [
          alertId,
          eventId,
          channel,
          recipient.trim(),
          // A test is a new send every time it is asked for, so its key is unique per request
          // rather than derived from a plan.
          `${eventId}:test:${alertId}`,
          JSON.stringify({ ...TEST_ALERT_COPY, test: true }),
        ],
      );

      const attempted = await deliverTestAlert(database, alertId, senders, jurisdiction);
      // Reported once, retried never: the poller must not deliver a demo message after this
      // endpoint has told its caller it failed. Returns the authoritative row, which differs from
      // what was handed in exactly when the poller won the race.
      const view = await retireFailedTestAlert(database, attempted);
      if (view?.status !== "sent") {
        res.status(502).json({ error: "test alert could not be delivered", alert: view });
        return;
      }
      res.status(201).json({ alert: view });
    })().catch(next);
  });

  router.use((error: unknown, _req: Request, res: Response, _next: NextFunction): void => {
    console.error("alert request failed", error);
    res.status(500).json({ error: "alert request failed" });
  });

  return router;
}

const isAlertChannel = (value: unknown): value is AlertChannel =>
  typeof value === "string" && (ALERT_CHANNELS as readonly string[]).includes(value);

/**
 * A channel that reported "sent" without delivering anything, and the label saying so.
 *
 * AGENTS.md forbids presenting a simulation as complete "unless the spec explicitly permits it and
 * the UI labels it". F-203 permits the SMS simulation; the labeling half was only half done. The
 * alert row carried the label and nothing an organizer can reach ever read it back, so in the
 * A2P-pending configuration — which is the configuration the repo's own artifacts select — every
 * SMS was recorded `sent` and looked delivered from every surface a person uses.
 *
 * This is the read that closes that. It rides on the checklist response because that is the
 * product flow the alerts belong to and it already exists; a dedicated endpoint would be one the
 * spec does not ask for. It reports what happened, so it stays empty until something is actually
 * simulated, and it goes to nothing on its own the day a live sender replaces the simulation.
 */
export type SimulatedDelivery = {
  readonly channel: AlertChannel;
  readonly label: string;
  readonly sentCount: number;
};

export async function simulatedDeliveries(
  database: Queryable,
  eventId: string,
): Promise<SimulatedDelivery[]> {
  const { rows } = await database.query<{ channel: AlertChannel; label: string; count: number }>(
    `SELECT channel, payload->'delivery'->>'label' AS label, count(*)::int AS count
       FROM alerts
      WHERE event_id = $1
        AND status = 'sent'
        AND (payload->'delivery'->>'simulated') = 'true'
        AND payload->'delivery'->>'label' IS NOT NULL
        -- Demo sends are not the organizer's alerts, and the same exclusion for the same reason
        -- failedDeliveries carries it. There the argument was that counting a demo fired at a
        -- bogus address tells an organizer their reminders are failing when they are not; here it
        -- runs the other way and tells them PopEngine recorded a text-message alert for their
        -- event when the only SMS was the demo they asked for. An AC 6 test send is an operator
        -- action against no deadline in both directions.
        AND coalesce(payload->>'test', 'false') <> 'true' 
      GROUP BY channel, payload->'delivery'->>'label'
      ORDER BY channel`,
    [eventId],
  );
  return rows.map((row) => ({ channel: row.channel, label: row.label, sentCount: row.count }));
}

/**
 * A channel whose alerts tried to send and did not, counted from what the rows observed.
 *
 * F-203 exists so a filing deadline does not pass unnoticed, and an alert that silently fails to
 * deliver is exactly that failure. Nothing an organizer can see reported it: the simulation notice
 * is an SMS fact and says nothing about email, and inferring email health from it was the overclaim
 * that notice had to have removed.
 *
 * WHAT THIS COUNTS, AND WHAT IT REFUSES TO SAY. Only `status = 'failed'`: an alert that was
 * attempted and whose latest attempt failed. It does not count `pending` rows, because "not
 * attempted yet" is not a failure — most pending alerts are simply not due. And an empty result is
 * reported as empty, never as "the channel is working": zero failures can equally mean nothing has
 * been attempted, and turning that silence into a reassurance would be the same error one field
 * over. The absence of evidence is not rendered at all.
 *
 * NO CAUSE, ONLY COUNT AND CHANNEL. `payload.last_error` carries provider text that can name a
 * recipient or expose internals, so it stays in the row for an operator and never reaches a page.
 *
 * Test sends are excluded. A demo alert fired at a deliberately bogus address is an operator
 * action against no deadline, and counting it would tell an organizer their own reminders are
 * failing when they are not. Same predicate the reconciler already uses to leave test rows alone.
 *
 * AND SO ARE THE ROWS THE POLLER HAS STOPPED ON, because this count is read under copy that says
 * retrying continues. An alert whose attempt outlived the provider's dedup window is not taken by
 * any tick while it is held, so counting it here told an organizer delivery was still being
 * attempted while it had in fact stopped. Those rows are reported by `reconciliationHolds` instead, which
 * says what is actually true of them. The stale-plan half of the pair stays HERE rather than
 * moving: the notice already has a paused branch that names regeneration, which is the action that
 * resolves it, and the reconciliation notice would send the organizer after the provider instead.
 * What that branch may NOT do is promise the review starts such a row again, which is what
 * `attemptedWithoutOutcome` below is for.
 */
export type FailedDelivery = {
  readonly channel: AlertChannel;
  /**
   * Whether any of these rows is HELD because its own plan is behind the event.
   *
   * Read from the plans the FAILED ROWS hang off, not from the latest plan. The page used to key
   * its "retrying is paused" wording on `planStale`, which describes the newest plan: after an edit
   * and a regeneration but before review, that is false while these rows still point at the old
   * revision and stay unclaimable, so the copy promised retries that were paused. The page cannot
   * work this out from anything else it is given, so it is answered here.
   */
  readonly heldForReview: boolean;
  /**
   * Whether any of these rows was attempted with no outcome ever recorded.
   *
   * WHAT IT QUALIFIES IS THE PROMISE, not the count. `heldForReview` names the action that resumes
   * a paused failure — regenerate the plan, review the checklist — and that action does resume an
   * ordinary stale failure. It does not resume one carrying an attempt nobody saw the end of: the
   * scheduler upserts a failed row in place, and a review supersedes an attempt only on a row
   * revived FROM `cancelled`, so the old attempt survives the review and the refreshed row becomes
   * a reconciliation hold instead of a retry. The organizer was being told to do something that
   * would not start it again. (`recordAttemptIntent` supersedes an overtaken attempt as well, but
   * that is the poller retrying past the hold bound rather than anything a review does.)
   *
   * ANSWERED HERE BECAUSE NOTHING A CLIENT IS GIVEN CAN SAY IT, which is why `heldForReview` is
   * answered here too: both turn on rows the page never sees. A row counted here with an
   * unresolved attempt is necessarily a stale one — a current-plan row in that state leaves this
   * count for `reconciliationHolds` — so this is the paused-and-will-not-resume case exactly.
   */
  readonly attemptedWithoutOutcome: boolean;
  /** Alerts on this channel whose most recent attempt failed. Never zero: absent instead. */
  readonly failedCount: number;
};

export async function failedDeliveries(
  database: Queryable,
  eventId: string,
  jurisdiction: string,
): Promise<FailedDelivery[]> {
  return (await alertDeliveryHealth(database, eventId, jurisdiction)).failedDeliveries;
}

/**
 * A channel with alerts the poller will never take again, counted so the organizer is told.
 *
 * THE DIFFERENCE BETWEEN "STILL TRYING" AND "STOPPED", which is the one distinction the checklist
 * could not draw. An alert whose send was attempted and whose answer nobody saw stops being claimable once
 * the provider's dedup window has closed on it, because a retry past that point is a second
 * delivery rather than a deduplicated one. Nothing in the poller moves it afterwards. Neither
 * surface reported that: a crash leaves the row `pending`, which `failedDeliveries` correctly says
 * nothing about, and a lost answer leaves it `failed`, where it was counted under copy promising
 * retries that had already ended. For a product whose purpose is that a filing deadline does not
 * pass unnoticed, telling an organizer delivery continues when it has stopped is the worst thing
 * available short of losing the alert.
 *
 * DERIVED, NOT PERSISTED, and that is deliberate rather than convenient. The hold is a fact about
 * how old an attempt is, so it becomes true with the passage of time and unwinds the moment
 * somebody records the outcome or supersedes the attempt. A status column would have to be written
 * by whichever tick happened to notice and then unwritten by hand, and the row would keep claiming
 * a hold after the thing that caused it was resolved. Reading it costs one query on a surface that
 * already runs several, and it cannot disagree with the predicate the poller actually uses because
 * it IS that predicate.
 *
 * Pending as well as failed, because the crash case is the silent one. Test rows are excluded for
 * the reason they are excluded everywhere else, stale-plan rows because regeneration cancels them
 * rather than a person reconciling them, and rows whose filing window has shut because the next
 * tick cancels those without asking anybody anything.
 */
export type ReconciliationHold = {
  readonly channel: AlertChannel;
  /** Alerts on this channel the poller has stopped on for now. Never zero: absent instead. */
  readonly heldCount: number;
};

export async function reconciliationHolds(
  database: Queryable,
  eventId: string,
  jurisdiction: string,
): Promise<ReconciliationHold[]> {
  return (await alertDeliveryHealth(database, eventId, jurisdiction)).reconciliationHolds;
}

/**
 * Both alert-delivery notices an organizer reads, classified in ONE statement.
 *
 * THE TWO ARE ONE QUESTION ASKED TWICE, and asking it twice is what let them contradict each other.
 * "Still being retried" and "stopped until a person checks with the provider" are complementary by
 * construction: the same predicate decides which side a row falls on. But the predicate turns on
 * how OLD an attempt is, so it flips with the passage of time — and two pool queries are two
 * autocommit snapshots with real time between them. An alert crossing the dedup cutoff in that gap
 * was counted as a failure by the first and as a hold by the second, so the checklist arrived
 * carrying both notices about one row: PopEngine keeps retrying this, and PopEngine has stopped
 * retrying this. The page holds that until it is reloaded.
 *
 * One statement cannot disagree with itself, so the classification happens once, over one snapshot,
 * and the two projections are taken from it. The exported pair above are kept as the narrow reads
 * for callers that want only one of them; neither restates the predicate.
 */
export async function alertDeliveryHealth(
  database: Queryable,
  eventId: string,
  /**
   * The jurisdiction whose calendar day decides this, because a hold is only a hold while the
   * deadline still exists.
   *
   * Passed in rather than read here for the reason the poller states: there is no honest default
   * for which jurisdiction's day this is, and a wrong one classifies holds on the wrong day.
   *
   * A JURISDICTION RATHER THAN A DAY, which is the rule the claim and the send boundary each
   * arrived at taken one wait further: A DAY IS DERIVED WHERE IT IS USED, and where it is used is
   * the statement. A day this process derives, even at the last instruction before the query,
   * is a value bound into a statement that has an unbounded wait in front of it, so a read
   * starting just before local midnight can reach PostgreSQL after it and classify a hold against
   * a day that has gone. What crosses the wire is the zone; `jurisdictionDayInSql` derives the day
   * where the predicate reads it.
   */
  jurisdiction: string,
): Promise<{
  readonly failedDeliveries: FailedDelivery[];
  readonly reconciliationHolds: ReconciliationHold[];
}> {
  // A HELD ALERT LEAVES THE FAILURE COUNT AND ARRIVES UNDER ITS OWN FIELD, which is a change of
  // shape and therefore a rollout question rather than only an endpoint one. Web and api deploy
  // separately (`docs/ARCHITECTURE.md`), so for the length of an api-first rollout a web build that
  // predates `alertsHeldForReconciliation` would render neither notice about such an alert: the
  // organizer would be told nothing at all about a reminder nobody will send again.
  //
  // ORDERED RATHER THAN PAPERED OVER, and the alternative is what decides it. The only field an
  // older web build renders here is the failure count, and every sentence it can put on one is a
  // promise about what happens next: PopEngine keeps retrying them, or retrying is paused until
  // the plan is regenerated. Both are false of an alert the poller has stopped on, and copy an
  // organizer reads about a filing deadline does not get to be false in order to be present. So the
  // window is closed instead of filled: `DEPLOY.md` "Release order" puts the web service first,
  // this build's reader already treats the field as absent-means-none for the converse order, and
  // `apps/api/src/deployment-order.test.ts` fails if that step is dropped while this split stands.
  const day = jurisdictionDayInSql("$2");
  const { rows } = await database.query<{
    channel: AlertChannel;
    failed_count: number;
    held_for_review: boolean | null;
    attempted_without_outcome: boolean | null;
    hold_count: number;
  }>(
    `SELECT channel,
            count(*) FILTER (
              WHERE status = 'failed'
                AND NOT (${hasAnUnresolvedAttempt(day)} AND ${NOT_FROM_A_STALE_PLAN})
            )::int AS failed_count,
            bool_or(NOT (${NOT_FROM_A_STALE_PLAN})) FILTER (
              WHERE status = 'failed'
                AND NOT (${hasAnUnresolvedAttempt(day)} AND ${NOT_FROM_A_STALE_PLAN})
            ) AS held_for_review,
            -- Over the same rows the count is taken from, so it qualifies that count and not some
            -- other population. See FailedDelivery.attemptedWithoutOutcome: a row reaching this
            -- filter with an unresolved attempt is a stale one by construction, and a review does
            -- not start it again.
            bool_or(${hasAnUnresolvedAttempt(day)}) FILTER (
              WHERE status = 'failed'
                AND NOT (${hasAnUnresolvedAttempt(day)} AND ${NOT_FROM_A_STALE_PLAN})
            ) AS attempted_without_outcome,
            -- THE TICK'S OWN DEFINITION OF A HOLD, taken rather than restated. This count and the
            -- one the poller logs are the same claim about the same row, and listing the
            -- conditions here a second time is what let them disagree: a shut window and a stale
            -- plan were excluded on both sides, and being DUE was excluded only on the tick's, so
            -- an alert a regeneration had moved into the future was named here as one PopEngine
            -- had paused. See HELD_FOR_RECONCILIATION for what each exclusion is for.
            count(*) FILTER (WHERE ${HELD_FOR_RECONCILIATION(day)})::int AS hold_count
       FROM alerts
      WHERE event_id = $1
        AND status IN ('pending', 'failed')
        AND coalesce(payload->>'test', 'false') <> 'true'
      GROUP BY channel
      ORDER BY channel`,
    // The ZONE, not the day: the day is derived by the statement above, so nothing about which
    // calendar day this is can go stale between here and PostgreSQL evaluating it.
    [eventId, jurisdictionTimeZone(jurisdiction)],
  );
  return {
    // Never zero: absent instead, which is what both notices' "empty means nothing to say" relies
    // on. The row is now per channel rather than per classification, so a channel can qualify for
    // one count and not the other.
    failedDeliveries: rows
      .filter((row) => row.failed_count > 0)
      .map((row) => ({
        channel: row.channel,
        failedCount: row.failed_count,
        heldForReview: row.held_for_review === true,
        attemptedWithoutOutcome: row.attempted_without_outcome === true,
      })),
    reconciliationHolds: rows
      .filter((row) => row.hold_count > 0)
      .map((row) => ({ channel: row.channel, heldCount: row.hold_count })),
  };
}

export type AlertView = {
  id: string;
  alertType: AlertType;
  channel: AlertChannel;
  status: AlertStatus;
  sendAt: string;
  sentAt: string | null;
  failureCount: number;
  payload: Record<string, unknown>;
};

/**
 * One alert as a client sees it. The recipient is deliberately not echoed: it is contact data, and
 * the caller supplied it (AGENTS.md "do not log unredacted contact data").
 */
async function alertView(database: Queryable, alertId: string): Promise<AlertView | null> {
  const { rows } = await database.query<{
    id: string;
    alert_type: AlertType;
    channel: AlertChannel;
    status: AlertStatus;
    send_at: Date;
    sent_at: Date | null;
    failure_count: number;
    payload: Record<string, unknown>;
  }>(
    `SELECT id, alert_type, channel, status, send_at, sent_at, failure_count, payload
       FROM alerts WHERE id = $1`,
    [alertId],
  );
  const row = rows[0];
  if (row === undefined) return null;
  return {
    id: row.id,
    alertType: row.alert_type,
    channel: row.channel,
    status: row.status,
    sendAt: row.send_at.toISOString(),
    sentAt: row.sent_at?.toISOString() ?? null,
    failureCount: row.failure_count,
    payload: row.payload,
  };
}

/**
 * The contact fields a checklist creation may carry. Both optional: a checklist is still worth
 * creating without them, and the response says no alerts were scheduled rather than pretending
 * some were.
 */
export function parseContacts(
  body: unknown,
): { contacts: AlertContactsUpdate } | { error: string } {
  if (typeof body !== "object" || body === null || Array.isArray(body)) return { contacts: {} };
  const { contactEmail, contactPhone } = body as {
    contactEmail?: unknown;
    contactPhone?: unknown;
  };
  if (contactEmail !== undefined && contactEmail !== null) {
    // TRIMMED BEFORE IT IS VALIDATED, and the untrimmed version shipped a real failure. The regex
    // forbids whitespace, `canonicalEmail` documents trimming as part of the canonical form, and
    // this ran first, so a pasted address with a trailing space was rejected here before the
    // trimming could ever apply. The checklist submits with a click handler rather than a native
    // form, so the browser's own email validation never sees it either: the organizer got a 400 on
    // saving the contact, and with it every email reminder for the event, with nothing on screen
    // naming a space as the cause.
    //
    // The phone branch below already had this shape, which is why only one of the two broke.
    if (
      typeof contactEmail !== "string" ||
      !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(contactEmail.trim())
    ) {
      return { error: "contactEmail must be an email address" };
    }
  }
  if (contactPhone !== undefined && contactPhone !== null) {
    if (typeof contactPhone !== "string" || contactPhone.trim() === "") {
      return { error: "contactPhone must be a non-empty string" };
    }
  }
  // A key the body never carried stays absent, so "said nothing" survives all the way to the
  // store and only "sent null" clears anything. An empty string is how a browser form reports a
  // field the organizer cleared, and that IS an instruction to clear it.
  return {
    contacts: {
      // The value that was validated is the value that is stored, so storage never sees a form the
      // check did not accept.
      ...(contactEmail === undefined
        ? {}
        : { email: contactEmail === null ? null : (contactEmail as string).trim() }),
      ...(contactPhone === undefined
        ? {}
        : { phone: contactPhone === null ? null : (contactPhone as string).trim() }),
    },
  };
}
