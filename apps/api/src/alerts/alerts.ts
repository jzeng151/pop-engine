// F-203 deadline alerts: what gets scheduled when a checklist is materialized, and the in-process poller that sends it (ARCHITECTURE "Alert Scheduling (no Redis)", AD-1, AD-4).

import { createHash, randomUUID } from "node:crypto";
import { Router, type NextFunction, type Request, type Response } from "express";
import { Pool } from "pg";
import type { PoolClient, QueryResult, QueryResultRow } from "pg";
import {
  CONFIRM_WITH_AGENCY,
  DEPENDENCY_SEQUENCING_BINDINGS,
  offersAFilingAction,
} from "@pop-engine/engine";
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
} from "../calendar";
import { canonicalOptionalPhone } from "../contact";
import {
  calendarDateFrom,
  FILING_ORDER_DATE,
  FILING_ORDER_JOIN,
  renderingKey,
  type FindingRendering,
} from "../planning/plan";

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

/** How long a failed alert waits before it is eligible again. */
const RETRY_BACKOFF = `CASE
       WHEN alerts.failure_count + 1 <= 1 THEN interval '0'
       WHEN alerts.failure_count + 1 = 2 THEN interval '1 minute'
       WHEN alerts.failure_count + 1 = 3 THEN interval '5 minutes'
       ELSE interval '15 minutes'
     END`;

/** Whether this alert's filing window has shut, as of the day passed in. */
export const FILING_WINDOW_HAS_SHUT = (day: string): string => `(
       (
         alerts.payload->>'controlling_apply_by' IS NULL
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
       OR coalesce((alerts.payload->>'controlling_apply_by')::date < ${day}::date, false)
     )`;

/** Whether this upsert is giving the row a FRESH SCHEDULE, as opposed to recomputing the same one. */
const HAS_A_FRESH_SCHEDULE = `(
       alerts.status = 'cancelled'
       OR alerts.payload->>'intended_at' IS DISTINCT FROM EXCLUDED.payload->>'intended_at'
     )`;

/** Holds alerts created from a plan older than the event's current revision. */
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

/** How many alerts one tick hands to a provider at once. */
export const SEND_CONCURRENCY = 8;
/** How long a tick waits between re-trying alerts a writer's lock made it skip, and for how long. */
const SKIPPED_RETRY_WAIT_MS = 250;
const SKIPPED_RETRY_WINDOW_MS = 2_000;
/** How long the poller waits before a follow-up scan when a whole tick was skipped. */
const SKIPPED_FOLLOW_UP_WAIT_MS = 2_000;
export const TICK_BUDGET_MS = 30_000;

/** Scan capacity derived from concurrency, timeout, and the remaining delivery budget. */
export const MAX_ALERTS_PER_TICK = Math.floor(
  (SEND_CONCURRENCY * Math.min(DELIVERY_BOUND_MS - POLL_INTERVAL_MS, TICK_BUDGET_MS)) /
    PROVIDER_TIMEOUT_MS,
);

/** What the poller's own pool has to hold: every concurrent send, plus the scan that feeds them. */
export const ALERT_POLLER_CONNECTIONS = SEND_CONCURRENCY + 1;

/** How long the email provider honours a repeated `Idempotency-Key`, per Resend's published documentation. */
export const PROVIDER_DEDUP_WINDOW_HOURS = 24;

/** How much of that window is kept in reserve rather than spent, because the decision and the delivery are not the same moment. */
export const DEDUP_WINDOW_CLAIM_MARGIN_MS = TICK_BUDGET_MS + PROVIDER_TIMEOUT_MS;

/** How long an attempt nobody saw the end of holds its alert before the alert is retried anyway. */
export const UNRESOLVED_ATTEMPT_HOLD_LIMIT_HOURS = PROVIDER_DEDUP_WINDOW_HOURS * 2;

/** What the send boundary keeps back for the handoff it sits in front of. */
const SEND_BOUNDARY_HANDOFF_BUDGET_MS = 1_000;
export const SEND_BOUNDARY_MARGIN_MS = PROVIDER_TIMEOUT_MS + SEND_BOUNDARY_HANDOFF_BUDGET_MS;

/** An alert whose send was attempted and whose outcome nobody ever saw, long enough ago that a provider holding it would no longer recognise the key. */
const unresolvedAttemptPastTheCutoff = (now: string, marginMs: number, day: string): string => `(
     EXISTS (
       SELECT 1
         FROM alert_send_attempts AS attempt
        WHERE attempt.alert_id = alerts.id
          AND attempt.outcome_recorded_at IS NULL
          AND attempt.superseded_at IS NULL
       HAVING min(attempt.attempted_at)
              < ${now} - interval '${PROVIDER_DEDUP_WINDOW_HOURS} hours'
                       + interval '${marginMs} milliseconds'
          AND min(attempt.attempted_at)
              >= ${now} - interval '${UNRESOLVED_ATTEMPT_HOLD_LIMIT_HOURS} hours'
     )
     AND NOT ${FILING_WINDOW_HAS_SHUT(`(${day}::date + 1)`)}
   )`;

/** Statement time avoids stale transaction timestamps without drifting within one query. */
const hasAnUnresolvedAttempt = (day: string): string =>
  unresolvedAttemptPastTheCutoff("statement_timestamp()", DEDUP_WINDOW_CLAIM_MARGIN_MS, day);

/** An alert the poller has stopped on, written once for both readers of it. */
const HELD_FOR_RECONCILIATION = (day: string): string => `(
       alerts.status IN ('pending', 'failed')
       AND alerts.send_at <= statement_timestamp()
       AND coalesce(alerts.payload->>'test', 'false') <> 'true'
       AND ${NOT_FROM_A_STALE_PLAN}
       AND NOT ${FILING_WINDOW_HAS_SHUT(day)}
       AND ${hasAnUnresolvedAttempt(day)}
     )`;

/** The same question asked at the last statement before the provider, reserving what that statement still has in front of it. */
const heldAtTheSendBoundary = (day: string): string =>
  unresolvedAttemptPastTheCutoff("clock_timestamp()", SEND_BOUNDARY_MARGIN_MS, day);

/** The other half of that margin: that the handoff it reserved for is the only thing that happened. */
const handoffFitsTheMargin = (boundaryAskedAt: number, now: number): boolean =>
  now - boundaryAskedAt <= SEND_BOUNDARY_HANDOFF_BUDGET_MS;

/** The last day the bounded handoff in front of the provider can still be running on. */
const dayTheHandoffCanLastUntil = (jurisdiction: string, now: number): string =>
  todayInJurisdiction(jurisdiction, new Date(now + SEND_BOUNDARY_MARGIN_MS));

/** Ask the send boundary, stamping the margin's anchor as the question goes out. */
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
    // Both window questions in the one statement that already asks the cutoff, for the reason the statement exists: what went wrong twice was not a question but the gap after it, and a second round trip for the handoff's day.
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

/** How long the test endpoint waits for a poller that claimed its row first. */
const TEST_ALERT_CLAIM_WAIT_MS = 200;
const TEST_ALERT_CLAIM_ATTEMPTS = Math.ceil(PROVIDER_TIMEOUT_MS / TEST_ALERT_CLAIM_WAIT_MS) + 2;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Queryable = {
  query<Row extends QueryResultRow>(text: string, values?: unknown[]): Promise<QueryResult<Row>>;
};

/** Where an event's alerts go. */
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
  /** The published rule whose deadline or dependency produced this alert. */
  readonly ruleId: string | null;
  readonly sendAt: Date;
  readonly subject: string;
  readonly body: string;
  /** Stable across plan and checklist regeneration; channel and destination join it in the row key. */
  readonly identity: string;
  /**
   * The event revision this alert's plan was evaluated at, for the one row the staleness JOIN
   * cannot reach. Only the plan-level slack warning sets it; everything else finds its plan
   * through `checklist_item_id`, and reading the plan's live row beats trusting a snapshot.
   */
  readonly planEventRevision?: number;
  /** The published window this alert is about, for rows the sweep cannot reach through an item. */
  readonly controllingApplyBy?: string | null;
  /** That this alert was scheduled off ONE route of a merged dedupe line, whether or not that route published a window to record above. */
  readonly routeScheduled?: true;
  /** The slot this alert was MEANT for, before it was clamped forward if that moment had passed. */
  readonly intendedAt?: string;
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

/** The plan's requirements with the checklist row each became, in filing order. */
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

/** One scheduling subject: a plan row read through ONE of its published routes. */
type AlertSubject = {
  readonly row: PlanAlertRow;
  readonly rendering: FindingRendering | undefined;
  readonly ruleId: string | null;
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
    // THE GRAMMAR COMES FROM THE SAME ROUTE AS THE NOUNS.
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
          // THE NOTES ARE THIS ROUTE'S, WHERE THE PLAN RECORDED WHOSE THEY ARE.
          ...(route.notes === undefined ? {} : { notes: route.notes }),
          // THE SAME NARROWING, ON THE LAST PUBLISHED STRING THAT WAS STILL THE LINE'S.
          ...(route.conflictText === undefined ? {} : { conflict_text: route.conflictText }),
        },
  ruleId: route.ruleId,
});

/** Whether this scheduling subject is one an organizer can be told to act on. */
const isFilingSubject = (subject: AlertSubject): boolean =>
  offersAFilingAction(
    { disposition: subject.row.disposition },
    subject.rendering?.headline_mode ?? null,
  );

/** The routes a row schedules from. */
function alertSubjects(row: PlanAlertRow, rendering: FindingRendering | undefined): AlertSubject[] {
  const routes = rendering?.routes;
  if (routes == null || routes.length < 2) {
    const ruleId =
      row.rule_ids.length === 1
        ? row.rule_ids[0]
        : rendering?.headline_rule_id != null && row.rule_ids.includes(rendering.headline_rule_id)
          ? rendering.headline_rule_id
          : null;
    return [{ row, rendering, ruleId }];
  }
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

/** AC 3. */
function hardFloorSentence(deadline: Deadline | null): string | null {
  if (deadline === null || deadline.type !== "composite") return null;
  return `Applications within ${deadline.hardFloorDays} days of the event are not accepted.`;
}

/** The one sentence that keeps a PopEngine reminder from reading as an agency requirement. */
const offsetPolicyNote = (days: number, late: boolean): string => {
  const slot = `${days} ${days === 1 ? "day" : "days"}`;
  return late
    ? `This is PopEngine's ${slot}-before reminder, sent now because your checklist was created ` +
        `after that day had already passed. The reminder schedule is PopEngine policy, not an ` +
        `agency deadline.`
    : `PopEngine sends this reminder ${slot} before the filing date. That reminder schedule is ` +
        `PopEngine policy, not an agency deadline.`;
};

/** What a reminder must say when it arrives before the gated item's window is expected to open. */
const sequenceNote = (upstream: PlanAlertRow, openOn: string): string =>
  `This filing is sequenced after your ${withAgency(upstream)}, whose decision is expected no ` +
  `earlier than ${openOn}. Filing before then may still be possible — the order is not confirmed ` +
  `by published text, so confirm it with the agency.`;

/** Whether the plan says this requirement applies, or only that it might. */
const isSettledRequirement = (row: PlanAlertRow): boolean => row.disposition === "required";

/**
 * A published enum token as an organizer reads it. The same transformation the checklist row
 * applies, so one requirement does not arrive named two ways on two surfaces.
 */
const humanizeToken = (token: string): string => token.replace(/_/g, " ");

/** A published verification state, attributed to the requirement it belongs to. */
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
    // THE VERIFICATION STATE, on every reminder rather than only where prose happens to mention it.
    `Verification: ${humanizeToken(row.verification_status)}`,
    confirmationLine(withAgency(row), row.verification_status, [
      rendering?.deadline_display,
      ...(rendering?.notes ?? []),
      rendering?.conflict_text,
      ...filingRoute(row, rendering),
    ]),
    // EVERY PUBLISHED NOTE, because the qualification IS one of them and nothing here can tell which.
    ...(rendering?.notes ?? []),
    // Both readings of an OFFICIAL_CONFLICT rule, verbatim.
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

/** AC 4. */
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
    // THREE VERIFICATION STATES, because this alert is a claim about three published things and the reminder's single line does not cover it.
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

/** AC 1's slack warning, fired at checklist creation rather than on a date. */
const slackWarningCopy = (
  minSlackDays: number,
  slackWarningDays: number,
  evaluatedOn: string,
  /** Whether the requirement that PRODUCED this number waits on another agency's decision. */
  controllingIsGated: boolean,
  /** Whether the requirement that produced this number publishes a filing at all. */
  controllingPublishesFiling: boolean,
  /** Every requirement whose slack IS this number, with what the ruleset says about each. */
  controllingFindings: readonly {
    readonly subject: string;
    readonly verificationStatus: VerificationStatus;
    readonly notes: readonly string[];
    readonly conflictText: string | null;
  }[],
): { subject: string; body: string } => ({
  // THE SUBJECT BRANCHES TOO, and not branching it was a regression this file's own argument had already refuted.
  subject: !controllingPublishesFiling
    ? `At risk — the narrowest published window is ${minSlackDays} days`
    : controllingIsGated
      ? `At risk — the narrowest filing window is ${minSlackDays} days wide`
      : `At risk — apply within ${minSlackDays} days of ${evaluatedOn}`,
  body: [
    // THE FIRST LINE BRANCHES TOO, because it was contradicting the qualification below it.
    !controllingPublishesFiling
      ? controllingIsGated
        ? `Your plan is at risk. The requirement with the least room publishes a window ` +
          `${minSlackDays} days wide. Nothing needs to be filed for it: the window is a range the ` +
          `rule publishes, not time to apply.`
        : `Your plan is at risk. Counting from ${evaluatedOn}, the requirement with the least ` +
          `room leaves ${minSlackDays} days. Nothing needs to be filed for it: that is a date the ` +
          `rule publishes, not a deadline to apply by.`
      : controllingIsGated
        ? `Your plan is at risk. The requirement with the least room can only be applied for ` +
          `during a window ${minSlackDays} days wide.`
        : `Your plan is at risk. Counting from ${evaluatedOn}, the requirement with the least ` +
          `room leaves ${minSlackDays} days to apply.`,
    // THE THIRD BUILDER TO NEED THIS.
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

/** Every alert this plan calls for, before channels are applied. */
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
  // KEYED BY EVERY CONTRIBUTING RULE ID, AND BY EVERY ROUTE, not by `rule_ids[0]`.
  const byRuleId = new Map<string, PlanAlertRow>();
  for (const row of rows) {
    const rendering = renderings.get(renderingKey(row.rule_ids));
    // UNFILTERED, because this map is a LOOKUP rather than a message.
    for (const subject of alertSubjects(row, rendering)) {
      for (const ruleId of subject.row.rule_ids) byRuleId.set(ruleId, subject.row);
    }
    for (const ruleId of row.rule_ids) if (!byRuleId.has(ruleId)) byRuleId.set(ruleId, row);
  }
  // THE DAY SCHEDULING HAPPENS, not the day the plan was evaluated.
  const schedulingToday = todayInJurisdiction(settings.jurisdiction, now);
  /** The moment an alert for `day` is actually due, which is never in the past. */
  const dueAt = (day: string): { at: Date; intended: string } => {
    const scheduled = instantAtLocalHour(settings.jurisdiction, day, SEND_HOUR_LOCAL);
    // The INTENDED slot travels beside the clamped one, because the two answer different questions and round 27's rule needs the first.
    return {
      at: scheduled.getTime() < now.getTime() ? now : scheduled,
      intended: scheduled.toISOString(),
    };
  };
  const planned: PlannedAlert[] = [];

  for (const planRow of rows) {
    if (planRow.checklist_item_id === null) continue;
    const planRendering = renderings.get(renderingKey(planRow.rule_ids));
    const subjects = alertSubjects(planRow, planRendering).filter(isFilingSubject);
    for (const { row, rendering, ruleId } of subjects) {
      const applyBy = isoDate(row.latest_apply_date);
      // The window this alert counts down to, recorded on the row wherever it is NOT the window the sweep would find through the checklist item, together with the fact that this alert is route-scheduled at all.
      const routeApplyBy =
        rendering?.routes != null && rendering.routes.length >= 2
          ? { routeScheduled: true as const, controllingApplyBy: applyBy }
          : {};

      const openOn = isoDate(row.apply_after_date);
      const binding = DEPENDENCY_SEQUENCING_BINDINGS.find(
        (candidate) => candidate.gatedRuleId === (row.rule_ids[0] ?? ""),
      );
      const upstream = binding === undefined ? undefined : byRuleId.get(binding.upstreamRuleId);

      // A filing date already behind is not something to remind anyone to meet.
      if (applyBy !== null && applyBy >= schedulingToday) {
        if (ruleId === null) {
          throw new Error(
            `cannot schedule alert for multi-rule item without recorded route attribution: ${row.rule_ids.join(", ")}`,
          );
        }
        for (const daysBefore of settings.reminderDaysBefore) {
          const sendOn = shiftDays(applyBy, -daysBefore);
          const { subject, body } = reminderCopy(row, rendering, applyBy, daysBefore, {
            // Its day has already gone, so it goes out on the next tick and says so.
            late: sendOn < schedulingToday,
            // Named only while the upstream decision is still ahead of this reminder.
            pendingUpstream: openOn !== null && sendOn <= openOn ? (upstream ?? null) : null,
            openOn,
          });
          planned.push({
            alertType: "deadline_reminder",
            checklistItemId: row.checklist_item_id,
            ruleId,
            ...routeApplyBy,
            // Already past at scheduling time — a checklist created inside the reminder window — is due NOW rather than at a moment that has gone (spec edge case, and AC 2's bound is measured from this field).
            sendAt: dueAt(sendOn).at,
            intendedAt: dueAt(sendOn).intended,
            subject,
            body,
            identity: `deadline_reminder:${daysBefore}:${ruleId}`,
          });
        }
      }

      // A FILING DEADLINE THAT HAS PASSED CLOSES THE UNLOCK TOO, and the reminder guard above was not enough on its own.
      const filingStillOpen = applyBy === null || applyBy >= schedulingToday;

      // No binding or no upstream row means nothing published names what this waits on, and an
      // unlock alert that cannot name its dependency is not the alert AC 4 asks for.
      if (openOn !== null && binding !== undefined && upstream !== undefined && filingStillOpen) {
        if (ruleId === null) {
          throw new Error(
            `cannot schedule alert for multi-rule item without recorded route attribution: ${row.rule_ids.join(", ")}`,
          );
        }
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
          ruleId,
          ...routeApplyBy,
          // Same treatment as a reminder, and for the same reason: an unlock whose gate opened before the plan was materialized is due now, not at a past instant that would score it late against AC 2 the moment it was written.
          sendAt: dueAt(openOn).at,
          intendedAt: dueAt(openOn).intended,
          subject,
          body,
          identity: `dependency_unlocked:${ruleId}`,
        });
      }
    }
  }

  const minSlackDays = plan.verdict_detail.minSlackDays;
  // WHAT HAS TO BE TRUE FOR THIS SENTENCE TO BE HONEST, asked once rather than approached again.
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
  /** EVERY requirement whose slack IS the number the copy quotes, open or not. */
  const controlling = dated.filter((entry) => entry.slack === minSlackDays);
  // ONE RULE, TWO OPPOSITE TIE-BREAKS, and they are written here together because apart they look like a contradiction and someone will eventually "unify" them.
  const isGated = (dated: { subject: AlertSubject }) => dated.subject.row.apply_after_date !== null;
  const controllingRoute =
    controlling.find((dated) => isFilingSubject(dated.subject) && isGated(dated)) ??
    controlling.find((dated) => isFilingSubject(dated.subject)) ??
    controlling.find(isGated) ??
    controlling[0];
  const controllingIsGated = controllingRoute !== undefined && isGated(controllingRoute);
  /** The day the LAST of the controlling requirements closes, for the poller to compare. */
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
      controllingRoute !== undefined && isFilingSubject(controllingRoute.subject),
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
      ruleId: null,
      // "Immediately at checklist creation" (spec Outputs): due the moment it is written.
      sendAt: now,
      subject,
      body,
      // The plan's own `event_revision`, carried because this row has no `checklist_item_id` for the staleness check to join through.
      planEventRevision: plan.event_revision,
      // The controlling requirement's own filing date.
      controllingApplyBy,
      // KEYED ON THE RISK, not on the plan row.
      identity: "slack_warning",
    });
  }

  return planned;
}

/** A calendar day shifted by whole days, in UTC so no timezone can move the day itself. */
function shiftDays(day: string, days: number): string {
  const shifted = new Date(`${day}T00:00:00Z`);
  shifted.setUTCDate(shifted.getUTCDate() + days);
  return shifted.toISOString().slice(0, 10);
}

/** Event + alert occasion + rule + channel + canonical destination: stable across regeneration. */
const idempotencyKey = (
  eventId: string,
  identity: string,
  channel: AlertChannel,
  recipient: string,
): string =>
  `${eventId}:${identity}:${channel}:` +
  createHash("sha256").update(recipient).digest("hex").slice(0, 12);

/** THE KEY ALREADY IN FLIGHT, and the row's own only where there is none. */
const providerKey = (row: DueAlertRow): string => row.in_flight_key ?? row.idempotency_key;

/** An email address as a destination rather than as typed, so one mailbox is one destination. */
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
      // BOTH COLUMNS, NOT ONE.
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
        const { rows } = await client.query<{ id: string; inserted: boolean; revived: boolean }>(
          // The status BEFORE this statement, which `RETURNING` cannot see: it returns the row as written, and a revival is only recognisable by what the row was.
          `WITH prior_status AS (
             SELECT status FROM alerts WHERE idempotency_key = $8
           )
           INSERT INTO alerts (id, event_id, checklist_item_id, rule_id, alert_type, channel,
                               recipient, idempotency_key, send_at, status, payload)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'pending', $10::jsonb)
           ON CONFLICT (idempotency_key) DO UPDATE
             SET checklist_item_id = EXCLUDED.checklist_item_id,
                 rule_id = EXCLUDED.rule_id,
                 payload = CASE
                   WHEN alerts.status = 'cancelled'
                     THEN (alerts.payload - 'last_error' - 'delivery' - 'route_scheduled'
                           - 'controlling_apply_by' - 'intended_at') || EXCLUDED.payload
                   ELSE (alerts.payload - 'route_scheduled' - 'controlling_apply_by'
                         - 'intended_at') || EXCLUDED.payload
                 END,
                 send_at = CASE WHEN ${HAS_A_FRESH_SCHEDULE} THEN EXCLUDED.send_at
                                ELSE alerts.send_at END,
                 status = CASE WHEN alerts.status = 'failed' THEN 'failed' ELSE 'pending' END,
                 failure_count = CASE WHEN alerts.status = 'cancelled' THEN 0
                                      ELSE alerts.failure_count END,
                 next_attempt_at = CASE WHEN ${HAS_A_FRESH_SCHEDULE} THEN NULL
                                        ELSE alerts.next_attempt_at END
             WHERE alerts.status IN ('pending', 'cancelled', 'failed')
           RETURNING id, xmax = 0 AS inserted,
                     (SELECT status FROM prior_status) = 'cancelled' AS revived`,
          [
            randomUUID(),
            eventId,
            alert.checklistItemId,
            alert.ruleId,
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

    // WHAT THE REVIVAL OWES THE ROW IT BROUGHT BACK.
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

    // Everything still waiting to go out that the recomputed set no longer contains: a requirement the regeneration dropped, a date it moved, or — since the destination is part of the key — an address the organizer corrected.
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

/** Where the attempt-intent write gets its connection, which must not be the pool the send already holds one from. */
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

/** Record that this alert is ABOUT to be handed to a provider, in a transaction of its own. */
async function recordAttemptIntent(
  database: Pool,
  row: DueAlertRow,
  /** The jurisdiction's ZONE, because the hold this insert asks about is bounded by the alert's own filing window as well as by the limit. */
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
      // THE KEY THIS SEND WILL PRESENT, not the row's, so the record says what the provider was actually handed.
      [row.id, providerKey(row), attemptId, timeZone],
    );
    recorded = rows[0]?.id ?? null;
  } catch (error) {
    // GIVEN BACK BEFORE THE RECOVERY ASKS FOR ONE, which is the difference between recovering and wedging.
    client.release();
    await settleUnacknowledgedIntent(writer, row, attemptId);
    throw error;
  }
  client.release();
  return recorded;
}

/** Close an intent whose insert this process never got an answer for. */
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

/** Send one claimed alert and record what happened, in the transaction that claimed it. */
async function deliverClaimed(
  client: PoolClient,
  row: DueAlertRow,
  senders: AlertSenders,
  database: Pool,
  jurisdiction: string,
): Promise<SendOutcome | null> {
  const sender = senders[row.channel];
  // NOTHING TO RECONCILE WHERE NOTHING IS HANDED OVER.
  let attemptId: string | null = null;
  if (sender.reachesAProvider !== false) {
    attemptId = await recordAttemptIntent(database, row, jurisdictionTimeZone(jurisdiction));
    // The claim permitted this send and the wait for the writer's connection outlived what the claim reserved, so the permission has expired: the key would reach the provider outside the window it deduplicates within.
    if (attemptId === null) return null;
  }
  const resolveAttempt = async (queryable: Queryable): Promise<void> => {
    if (attemptId === null) return;
    await queryable.query(
      "UPDATE alert_send_attempts SET outcome_recorded_at = clock_timestamp() WHERE id = $1",
      [attemptId],
    );
  };
  // A DELIVERY IS RECORDED IN THE SENDING TRANSACTION, so a crash that loses the mark-sent loses this too.
  const recordDelivery = async (): Promise<void> => resolveAttempt(client);
  // A PROVEN NON-DELIVERY IS NOT, and the difference is which way the loss falls.
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
  // THE SEND BOUNDARY: the last statement before the provider, and the place both decisions about this send are now made.
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
    // THE DAY THE ANSWER WAS ABOUT, which is not necessarily the day it arrived on.
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
      // SKIPPED, for the reason the margin refusal below is: this exit takes no decision at all — not even to cancel — so it leaves the row exactly as due as it found it, with its intent closed and nothing claiming it.
      return { status: "skipped" };
    }
    if (boundary.shut) {
      // SETTLED WHERE THE SETTLEMENT CAN SURVIVE, which is not here.
      await recordProvenNonDelivery();
      // Keep cancellation in the claim transaction so rollback leaves the alert due.
      await client.query("UPDATE alerts SET status = 'cancelled' WHERE id = $1", [row.id]);
      return null;
    }
    if (boundary.held) {
      // On the writer's own connection, for the reason `recordProvenNonDelivery` records: this transaction is about to be rolled back to nothing, and the knowledge that no message left has to survive that.
      await recordProvenNonDelivery();
      return null;
    }
    // THE ASSERTION THE MARGIN RESTS ON.
    if (!handoffFitsTheMargin(boundary.askedAt, Date.now())) {
      console.warn(
        `alert ${row.id} spent more than ${SEND_BOUNDARY_HANDOFF_BUDGET_MS}ms between the send ` +
          `boundary and the provider handoff, which is the margin the boundary reserved for it; ` +
          `nothing was sent`,
      );
      await recordProvenNonDelivery();
      // SKIPPED RATHER THAN NULL, because this refusal leaves work nobody is doing.
      return { status: "skipped" };
    }
    // THE WINDOW EDGE, asked where the dedup margin is asserted and for the same reason.
    if (boundary.shutByTheHandoffsEnd) {
      console.warn(
        `alert ${row.id} reached the send boundary with less than ${SEND_BOUNDARY_MARGIN_MS}ms of ` +
          `its filing window left in ${jurisdiction}, which is what the bounded handoff in front ` +
          `of the provider can cost, so the window could shut before the request lands; ` +
          `nothing was sent`,
      );
      await recordProvenNonDelivery();
      // Null rather than skipped, unlike the margin refusal above: that one is a gap this process can be through on the very next attempt, and this one is the day ending.
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
      // `clock_timestamp()`, not `current_timestamp`: the latter is the TRANSACTION's start, and this transaction opened before the provider was called.
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
    // A refusal and an unreachable host are answers, so the attempt is closed and the row keeps being retried for as long as the outage lasts (spec edge case: nothing is lost).
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
  /** The event row was held by a writer, so this alert was not attempted and is still due. */
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
    const { rows: owner } = await client.query(
      `SELECT event.id FROM events AS event
         JOIN alerts ON alerts.event_id = event.id
        WHERE alerts.id = $1
        FOR SHARE OF event SKIP LOCKED`,
      [alertId],
    );
    if (owner[0] === undefined) {
      await client.query("ROLLBACK");
      // Transient by construction: the writer holding this row commits in milliseconds, and when it does the alert is either cancelled or still due.
      return { status: "skipped" };
    }
    // DUE IS RE-ASKED HERE, not inherited from the scan.
    const timeZone = jurisdictionTimeZone(jurisdiction);
    const claimDay = jurisdictionDayInSql("$2");
    const { rows } = await client.query<DueAlertRow>(
      // The staleness check belongs HERE as well as in the scan, and for the same reason the due predicate is re-asked here: the event edit this guards against can commit in the window between the two.
      `SELECT id, channel, recipient, idempotency_key, payload,
              ${IN_FLIGHT_KEY} AS in_flight_key
         FROM alerts
        WHERE id = $1 AND status IN ('pending', 'failed') AND send_at <= statement_timestamp()
          AND (next_attempt_at IS NULL OR next_attempt_at <= statement_timestamp())
          AND ${NOT_FROM_A_STALE_PLAN}
          AND (NOT ${hasAnUnresolvedAttempt(claimDay)} OR ${FILING_WINDOW_HAS_SHUT(claimDay)})
        FOR NO KEY UPDATE SKIP LOCKED`,
      [alertId, timeZone],
    );
    const row = rows[0];
    if (row === undefined) {
      await client.query("ROLLBACK");
      return null;
    }
    // THE EXPIRY DECISION IS MADE HERE, under the lock, rather than in a bulk sweep that took no lock at all.
    const { rows: expired } = await client.query(
      `SELECT 1 FROM alerts WHERE id = $1 AND ${FILING_WINDOW_HAS_SHUT(jurisdictionDayInSql("$2"))}`,
      [alertId, timeZone],
    );
    if (expired[0] !== undefined) {
      // Cancelled rather than left pending, for round 19's reason: the scheduler will refuse to re-create an alert for a window that has shut, so nothing is undecided, and leaving it would report a delivery still being retried.
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
  /** Due alerts a writer's lock kept this tick from attempting at all, after its retry window. */
  readonly skipped: number;
  /** Due alerts whose send was attempted, whose outcome was never observed, and whose attempt is now older than the provider's dedup window. */
  readonly heldForReconciliation: number;
  /** Whether this tick reached the end of the work that was due, which is the ONE question the poller has to answer and has been inferring three different ways. */
  readonly drained: boolean;
};

export type AlertPoller = {
  /** One pass over everything due. Exposed so tests drive the poller without waiting on a timer. */
  tick(): Promise<AlertTickSummary>;
  start(): void;
  /** Stop taking work, and settle what is already in flight. */
  stop(): Promise<void>;
};

export function createAlertPoller(dependencies: {
  readonly database: Pool;
  readonly senders: AlertSenders;
  /** The jurisdiction whose calendar day decides whether a filing window has shut. */
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
    // EACH STATEMENT ASKS ABOUT THE DAY IT RUNS ON, which is the rule every other reader of a jurisdiction day in this file arrived at.
    const timeZone = jurisdictionTimeZone(jurisdiction);
    const day = jurisdictionDayInSql("$1");
    // Ids first, then one transaction per alert.
    const { rows } = await database.query<{ id: string }>(
      // `next_attempt_at` is what finally removes a dead destination from the batch rather than only demoting it.
      `SELECT id FROM alerts
        WHERE status IN ('pending', 'failed')
          AND send_at <= statement_timestamp()
          AND (next_attempt_at IS NULL OR next_attempt_at <= statement_timestamp())
          AND ${NOT_FROM_A_STALE_PLAN}
          AND (NOT ${hasAnUnresolvedAttempt(day)} OR ${FILING_WINDOW_HAS_SHUT(day)})
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
    // WHAT THE SCAN JUST REFUSED TO CLAIM, counted rather than left silent.
    const { rows: held } = await database.query<{ id: string }>(
      `SELECT id FROM alerts WHERE ${HELD_FOR_RECONCILIATION(day)}`,
      [timeZone],
    );
    if (held.length > 0) {
      // Ids only.
      console.warn(
        `${held.length} alert(s) were recorded as attempted sends whose outcome never came back, ` +
          `so this side cannot tell whether a provider ended up holding them, long enough ago ` +
          `that its ${PROVIDER_DEDUP_WINDOW_HOURS}h dedup window would have closed before a ` +
          `retry could land, so they are held rather than retried until they reach ` +
          `${UNRESOLVED_ATTEMPT_HOLD_LIMIT_HOURS}h, when they are retried anyway: ` +
          `${held.map((row) => row.id).join(", ")}`,
      );
    }
    // The expiry sweep that used to run here is gone.
    let sent = 0;
    let failed = 0;
    let abandoned = 0;
    /** Alerts a writer's lock made this tick skip. Still due, and nobody else is sending them. */
    const skipped: string[] = [];

    // ONE FLAT QUEUE OF ALERTS.
    const queue = rows.map(({ id }) => id);
    const startedAt = clock();
    const worker = async (): Promise<void> => {
      for (;;) {
        // Checked before claiming rather than after, so the budget bounds when the LAST request starts.
        if (stopped || clock() - startedAt >= TICK_BUDGET_MS) {
          abandoned += queue.length;
          queue.length = 0;
          return;
        }
        const id = queue.shift();
        if (id === undefined) return;
        // A row whose own transaction could not even record an outcome — the database went away mid-send — must not take the rest of the batch down with it.
        const outcome = await sendOne(database, id, senders, jurisdiction).catch(
          (error: unknown) => {
            console.error(`alert ${id} could not be recorded`, error);
            // COUNTED AS UNREACHED, not as nothing to do.
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

    // A SKIPPED ALERT IS RETRIED INSIDE THIS TICK, not left for the next one.
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
        // One tick at a time.
        if (timer === null || runningTick !== null) return;
        runningTick = tick();
        void runningTick
          .then((summary) => {
            // A tick that ran out of budget with rows still due does NOT wait out the interval.
            if (!summary.drained && summary.sent + summary.failed > 0) {
              chasingSince = null;
              setImmediate(run);
              return;
            }

            // AN ALL-SKIPPED TICK IS NOT A TICK WITH NOTHING TO DO, and the guard above read them as the same thing because both come back with no sends.
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
      // The flag as well as the timer: clearing the timer stops the NEXT tick, and a tick already running would otherwise work through its whole batch after the caller believes the poller is off — still claiming rows and still.
      stopped = true;
      // The follow-up as well, or a poller told to stop keeps waking up to chase skipped rows.
      if (followUp !== null) clearTimeout(followUp);
      followUp = null;
      chasingSince = null;
      if (timer !== null) clearInterval(timer);
      timer = null;
      // AND THEN THE SEND ALREADY IN FLIGHT, which the flag above cannot reach: it stops the worker taking the NEXT row, and the row in its hand is inside a provider call with its transaction open.
      await runningTick?.catch(() => undefined);
    },
  };
}

export type AlertsDependencies = {
  readonly database: Pool;
  readonly senders: AlertSenders;
  /** The jurisdiction whose calendar day decides whether a filing window has shut. */
  readonly jurisdiction: string;
};

/** Send the test alert and report what the ROW says, not what this request did. */
async function deliverTestAlert(
  database: Pool,
  alertId: string,
  senders: AlertSenders,
  jurisdiction: string,
): Promise<AlertView | null> {
  for (let attempt = 0; attempt < TEST_ALERT_CLAIM_ATTEMPTS; attempt += 1) {
    const outcome = await sendOne(database, alertId, senders, jurisdiction);
    const view = await alertView(database, alertId);
    // A SKIP IS NOT A RESULT, here for the same reason it is not one in the poller.
    if (outcome?.status === "skipped") {
      await new Promise((resolve) => setTimeout(resolve, TEST_ALERT_CLAIM_WAIT_MS));
      continue;
    }
    if (outcome !== null || view?.status === "sent") return view;
    await new Promise((resolve) => setTimeout(resolve, TEST_ALERT_CLAIM_WAIT_MS));
  }
  return alertView(database, alertId);
}

/** Stop a demo row the endpoint has already reported on, so the poller does not send it later. */
async function retireFailedTestAlert(
  database: Pool,
  view: AlertView | null,
): Promise<AlertView | null> {
  if (view === null || view.status !== "failed") return view;
  // GUARDED ON THE STATUS IT EXPECTS TO FIND, because the row it is retiring is immediately eligible: the first retry's backoff is zero, so the poller can claim it between this endpoint reading the row and this statement.
  const { rowCount } = await database.query(
    "UPDATE alerts SET status = 'cancelled' WHERE id = $1 AND status = 'failed'",
    [view.id],
  );
  // Nothing updated means somebody else moved it, and the only thing that can is a delivery.
  return rowCount === 0 ? alertView(database, view.id) : view;
}

/** AC 6's demo utility. */
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
      // Reported once, retried never: the poller must not deliver a demo message after this endpoint has told its caller it failed.
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

/** A channel that reported "sent" without delivering anything, and the label saying so. */
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
        AND coalesce(payload->>'test', 'false') <> 'true' 
      GROUP BY channel, payload->'delivery'->>'label'
      ORDER BY channel`,
    [eventId],
  );
  return rows.map((row) => ({ channel: row.channel, label: row.label, sentCount: row.count }));
}

/** A channel whose alerts tried to send and did not, counted from what the rows observed. */
export type FailedDelivery = {
  readonly channel: AlertChannel;
  /** Whether any of these rows is HELD because its own plan is behind the event. */
  readonly heldForReview: boolean;
  /** Whether any of these rows was attempted with no outcome ever recorded. */
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

/** A channel with alerts the poller will never take again, counted so the organizer is told. */
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

/** Both alert-delivery notices an organizer reads, classified in ONE statement. */
export async function alertDeliveryHealth(
  database: Queryable,
  eventId: string,
  /** The jurisdiction whose calendar day decides this, because a hold is only a hold while the deadline still exists. */
  jurisdiction: string,
): Promise<{
  readonly failedDeliveries: FailedDelivery[];
  readonly reconciliationHolds: ReconciliationHold[];
}> {
  // A HELD ALERT LEAVES THE FAILURE COUNT AND ARRIVES UNDER ITS OWN FIELD, which is a change of shape and therefore a rollout question rather than only an endpoint one.
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
            bool_or(${hasAnUnresolvedAttempt(day)}) FILTER (
              WHERE status = 'failed'
                AND NOT (${hasAnUnresolvedAttempt(day)} AND ${NOT_FROM_A_STALE_PLAN})
            ) AS attempted_without_outcome,
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
    // Never zero: absent instead, which is what both notices' "empty means nothing to say" relies on.
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
    // TRIMMED BEFORE IT IS VALIDATED, and the untrimmed version shipped a real failure.
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
  // A key the body never carried stays absent, so "said nothing" survives all the way to the store and only "sent null" clears anything.
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
