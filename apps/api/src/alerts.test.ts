// F-203 deadline alerts, against the real schema. Each `describe` names the acceptance criterion
// it covers; the edge cases from the spec have their own block at the end.
//
// Two clocks are in play and the suite keeps them apart on purpose. Scenario plans are evaluated
// against the answer key's clock (`FIXTURE_TODAY`), so their alerts are dated in that future and
// no tick can send them — which is what makes the scheduling assertions stable. The poller is
// driven instead by plans written directly with dates in the real past, so "due" is true on any
// machine at any time rather than only while the wall clock sits in a particular week.

import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { MigrationBuilder } from "node-pg-migrate";
import { Pool } from "pg";
import request from "supertest";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { CONFIRM_WITH_AGENCY, parseEngineRuleset, parseIntakeContract } from "@pop-engine/engine";
import type { Deadline, EngineRuleset, HolidayCalendar, IntakeContract } from "@pop-engine/engine";
import {
  FIXTURE_TODAY,
  SCENARIO_INTAKE_FIXTURES,
  fixtureSubmission,
} from "@pop-engine/engine/fixtures";
import {
  AlertDeliveryError,
  createResendEmailSender,
  createSimulatedSmsSender,
  sendersFromEnv,
  unconfiguredEmailSender,
  PROVIDER_TIMEOUT_MS,
  SIMULATED_SMS_LABEL,
  type AlertMessage,
  type AlertChannel,
  type AlertSenders,
} from "./alert-delivery";
import { up as migration014 } from "../migrations/014_alert_send_attempts";
import {
  simulatedDeliveries,
  alertDeliveryHealth,
  createAlertPoller,
  createAlertScheduler,
  failedDeliveries,
  reconciliationHolds,
  ALERT_POLLER_CONNECTIONS,
  DEDUP_WINDOW_CLAIM_MARGIN_MS,
  DELIVERY_BOUND_MS,
  MAX_ALERTS_PER_TICK,
  POLL_INTERVAL_MS,
  PROVIDER_DEDUP_WINDOW_HOURS,
  SEND_CONCURRENCY,
  TICK_BUDGET_MS,
  type AlertScheduler,
  type AlertStatus,
} from "./alerts";
import { createApp } from "./app";
import { instantAtLocalHour, todayInJurisdiction } from "./calendar";
import { createPlanService } from "./plan";
import { deadlineReminderOffsets, loadRuleset, rulesFilePath } from "./ruleset";
import type { DocumentStorage } from "./storage";

const databaseUrl = process.env.DATABASE_URL ?? "";

const storage: DocumentStorage = {
  put: async () => undefined,
  signedDownloadUrl: async () => "https://storage.test/unused",
  remove: async () => undefined,
};

/**
 * A provider that remembers every message and, like Resend, treats a repeated `Idempotency-Key` as
 * the same send. That last part is the whole point: it is what a re-send after a lost mark-sent
 * lands on, so the fake has to model it or the crash test proves nothing.
 */
type FakeProvider = {
  readonly senders: AlertSenders;
  /** One entry per DELIVERED message, deduplicated by idempotency key. */
  readonly delivered: AlertMessage[];
  /** Every attempt, including ones the provider deduplicated away. */
  readonly attempts: AlertMessage[];
  fail: string | null;
  /** Fails only for this destination, so one dead address can be modelled beside a live one. */
  failFor: string | null;
  /** Runs before each send resolves, for modelling a provider that takes measurable time. */
  beforeSend: (() => Promise<void>) | null;
};

const fakeProvider = (): FakeProvider => {
  const delivered: AlertMessage[] = [];
  const attempts: AlertMessage[] = [];
  const provider: FakeProvider = {
    senders: {} as AlertSenders,
    delivered,
    attempts,
    fail: null,
    failFor: null,
    beforeSend: null,
  };
  const send = (simulated: boolean) => async (message: AlertMessage) => {
    attempts.push(message);
    if (provider.beforeSend !== null) await provider.beforeSend();
    if (provider.fail !== null) throw new AlertDeliveryError(provider.fail);
    if (provider.failFor === message.recipient) {
      throw new AlertDeliveryError(`email provider rejected the send with status 550`);
    }
    if (!delivered.some((sent) => sent.idempotencyKey === message.idempotencyKey)) {
      delivered.push(message);
    }
    return {
      simulated,
      label: simulated ? SIMULATED_SMS_LABEL : null,
      provider: simulated ? "simulated" : "fake",
    };
  };
  return Object.assign(provider, {
    senders: {
      email: send(false),
      // Marked exactly as the shipped SMS sender is, because the fake stands in for it: it renders
      // in-product and hands nothing to a provider. Leaving the marker off would model an SMS
      // channel this product does not have (`sendersFromEnv`, pinned in the AC 5 suite).
      sms: Object.assign(send(true), { reachesAProvider: false }),
    } satisfies AlertSenders,
  });
};

const scenario = (id: string): Record<string, unknown> => {
  const fixture = SCENARIO_INTAKE_FIXTURES.find((candidate) => candidate.scenario === id);
  if (fixture === undefined) throw new Error(`no fixture ${id}`);
  return fixtureSubmission(fixture);
};

type AlertRow = {
  id: string;
  checklist_item_id: string | null;
  alert_type: string;
  channel: string;
  recipient: string;
  idempotency_key: string;
  send_at: Date;
  status: string;
  sent_at: Date | null;
  failure_count: number;
  next_attempt_at: Date | null;
  payload: {
    subject?: string;
    body?: string;
    delivery?: { simulated: boolean; label: string | null };
    last_error?: string;
    test?: boolean;
    controlling_apply_by?: string;
    intended_at?: string;
  };
};

type AttemptRow = {
  id: string;
  alert_id: string;
  idempotency_key: string;
  attempted_at: Date;
  outcome_recorded_at: Date | null;
  superseded_at: Date | null;
};

describe.skipIf(databaseUrl === "")("F-203 deadline alerts", () => {
  let pool: Pool;
  let ruleset: EngineRuleset;
  let intakeContract: IntakeContract;
  let reminderOffsets: number[];
  const createdEventIds: string[] = [];

  // The answer key's fixtures are dated in windows with no contested holidays (AD-11), so the
  // calendar is injected rather than the missing-list guard relaxed.
  const fixtureCalendar = (calendarId: string): HolidayCalendar => ({
    id: calendarId,
    holidays: [],
  });

  const schedulerWith = (now?: () => Date): AlertScheduler =>
    createAlertScheduler({
      reminderDaysBefore: reminderOffsets,
      slackWarningDays: ruleset.slackWarningDays,
      jurisdiction: ruleset.jurisdiction,
      now,
    });

  const appWith = (provider: FakeProvider, today = FIXTURE_TODAY) =>
    createApp({
      database: pool,
      intakeContract,
      today: () => today,
      planService: createPlanService(pool, ruleset, fixtureCalendar, () => today),
      // The scheduler reads the real clock to decide whether a filing date has passed, so the
      // scenario suites pin it to the answer key's day exactly as the plan service is pinned.
      // Without that, every assertion below about a fixture's alert set would start changing on
      // the day the wall clock overtook the fixture's dates.
      checklist: {
        database: pool,
        storage,
        scheduleAlerts: schedulerWith(() => new Date(`${today}T13:00:00Z`)),
      },
      alerts: { jurisdiction: ruleset.jurisdiction, database: pool, senders: provider.senders },
    });

  const createEvent = async (submission: Record<string, unknown>): Promise<string> => {
    const response = await request(appWith(fakeProvider())).post("/api/events").send(submission);
    expect(response.status).toBe(201);
    const eventId = response.body.event.id as string;
    createdEventIds.push(eventId);
    return eventId;
  };

  /** An event with a plan and a checklist, alerts scheduled against the supplied contacts. */
  const materialize = async (
    eventId: string,
    contacts: Record<string, unknown> = { contactEmail: "organizer@example.test" },
    today = FIXTURE_TODAY,
  ) => {
    const app = appWith(fakeProvider(), today);
    expect((await request(app).post(`/api/events/${eventId}/plan`)).status).toBe(201);
    // The plan the organizer was shown, read off a GET exactly as the browser does before it
    // submits: a review records WHICH plan was read, so the api refuses to choose one itself.
    const shown = (await request(app).get(`/api/events/${eventId}/checklist`)).body
      .planId as string;
    const response = await request(app)
      .post(`/api/events/${eventId}/checklist`)
      .send({ planId: shown, ...contacts });
    return response;
  };

  const alertsOf = async (eventId: string): Promise<AlertRow[]> => {
    const { rows } = await pool.query<AlertRow>(
      `SELECT a.* FROM alerts AS a WHERE a.event_id = $1 ORDER BY a.send_at, a.alert_type, a.channel`,
      [eventId],
    );
    return rows;
  };

  /** What this alert's send was recorded as having ATTEMPTED, whatever came of it (migration 014). */
  const attemptsOf = async (alertId: string): Promise<AttemptRow[]> => {
    const { rows } = await pool.query<AttemptRow>(
      `SELECT * FROM alert_send_attempts WHERE alert_id = $1 ORDER BY attempted_at`,
      [alertId],
    );
    return rows;
  };

  /** The rule ids behind the checklist item an alert hangs off, for readable assertions. */
  const ruleIdsFor = async (checklistItemId: string): Promise<string[]> => {
    const { rows } = await pool.query<{ rule_ids: string[] }>(
      `SELECT item.rule_ids FROM checklist_items AS checklist
         JOIN permit_plan_items AS item ON item.id = checklist.plan_item_id
        WHERE checklist.id = $1`,
      [checklistItemId],
    );
    return rows[0]?.rule_ids ?? [];
  };

  const describeAlerts = async (eventId: string): Promise<string[]> => {
    const rows = await alertsOf(eventId);
    return Promise.all(
      rows.map(async (row) => {
        const rules =
          row.checklist_item_id === null
            ? "plan"
            : (await ruleIdsFor(row.checklist_item_id)).join("+");
        return `${row.send_at.toISOString().slice(0, 10)} ${row.alert_type} ${rules} ${row.channel} ${row.status}`;
      }),
    );
  };

  /** A calendar day in the jurisdiction, offset from the real clock the scheduler reads. */
  const dayFromToday = (days: number): string => {
    const day = new Date(`${todayInJurisdiction("US-NY-NYC")}T00:00:00Z`);
    day.setUTCDate(day.getUTCDate() + days);
    return day.toISOString().slice(0, 10);
  };

  /**
   * A plan written directly, dated relative to the real clock rather than to a fixed year.
   *
   * The poller needs alerts that are genuinely due wherever this runs, and the fixture scenarios
   * are dated against the answer key's clock. A back-dated plan was the first attempt and was
   * wrong for a reason worth keeping written down: alerts are only scheduled for filing dates that
   * are still ahead, so a 2020 deadline now correctly schedules nothing. The shape that IS due is
   * the spec's own edge case — a checklist created inside the reminder window — so that is what
   * this builds: the filing date is today, which is still a day an organizer can file on, and
   * every published offset counts back from it to a day that has already gone.
   */
  const insertDuePlan = async (
    eventId: string,
    options: {
      latestApplyDate?: string | null;
      deadline?: Deadline | null;
      planToday?: string;
      applyAfterDate?: string | null;
      disposition?: string;
      verdict?: string;
      minSlackDays?: number | null;
      conflictText?: string | null;
      deadlineDisplay?: string;
      portalInstructions?: string | null;
      /**
       * Re-point this existing task at the new plan's item instead of creating another, which is
       * what `materialize` does on a regeneration. A test about identity ACROSS plans has to do
       * it: a fresh task per plan gives every alert a fresh key, so no key can ever collide and
       * the collision under test cannot happen.
       */
      reuseChecklistItemId?: string;
      /**
       * A SECOND dated requirement with more slack than the first, for the case where the
       * requirement that produced minSlackDays expires while a later one stays open.
       */
      laterDated?: { latestApplyDate: string; slackDays: number; applyAfterDate?: string };
    } = {},
  ): Promise<{ planId: string; checklistItemId: string }> => {
    const {
      latestApplyDate = dayFromToday(0),
      deadline = null,
      planToday = todayInJurisdiction("US-NY-NYC"),
      applyAfterDate = null,
      disposition = "required",
      verdict = "feasible",
      minSlackDays = null,
      conflictText = null,
      deadlineDisplay = "file at least 5 days before use",
      portalInstructions = null,
      reuseChecklistItemId,
      laterDated,
    } = options;
    const planId = randomUUID();
    const itemId = randomUUID();
    const checklistItemId = reuseChecklistItemId ?? randomUUID();
    await pool.query(
      `INSERT INTO permit_plans (id, event_id, event_revision, ruleset_version, snapshot_date,
                                 verdict, verdict_detail, intake_snapshot, generated_at)
       VALUES ($1, $2, 1, $3, $4, $6, $5::jsonb, '{}'::jsonb, current_timestamp)`,
      [
        planId,
        eventId,
        ruleset.rulesetVersion,
        ruleset.snapshotDate,
        JSON.stringify({
          today: planToday,
          minSlackDays,
          finding_renderings: [
            {
              rule_ids: ["NYPD-SOUND-001"],
              notes: [],
              note_text: null,
              conflict_text: conflictText,
              deadline_display: deadlineDisplay,
              // The engine's own per-finding slack, which is what identifies the requirement the
              // plan's minSlackDays came from. Null here would make the fixture incoherent: a
              // verdict quoting a number no finding claims.
              slack_days: minSlackDays,
              deadline_unknown_fields: [],
              timeline_unresolved_reason: null,
              portal_instructions: portalInstructions,
            },
            ...(applyAfterDate === null
              ? []
              : [
                  {
                    rule_ids: ["PARKS-EVENT-001"],
                    notes: [],
                    note_text: null,
                    conflict_text: null,
                    deadline_display: "apply at least 21 days ahead",
                    slack_days: null,
                    deadline_unknown_fields: [],
                    timeline_unresolved_reason: null,
                    portal_instructions: null,
                  },
                ]),
            ...(laterDated === undefined
              ? []
              : [
                  {
                    rule_ids: ["PARKS-EVENT-001"],
                    notes: [],
                    note_text: null,
                    conflict_text: null,
                    deadline_display: "apply at least 21 days ahead",
                    slack_days: laterDated.slackDays,
                    deadline_unknown_fields: [],
                    timeline_unresolved_reason: null,
                    portal_instructions: null,
                  },
                ]),
          ],
        }),
        verdict,
      ],
    );
    const laterItemId = randomUUID();
    if (laterDated !== undefined) {
      // A second dated requirement, later and with more slack than the one the verdict quotes.
      await pool.query(
        `INSERT INTO permit_plan_items (id, plan_id, rule_ids, triggered_by, permit_name, agency,
                                        latest_apply_date, apply_after_date, sources, kind, disposition,
                                        deadline_status, verification_status)
         VALUES ($1, $2, ARRAY['PARKS-EVENT-001'], '[]'::jsonb, 'Special Event Permit',
                 'NYC Parks', $3, $4, '[]'::jsonb, 'permit', 'required', 'on_track',
                 'SOURCE_CONFIRMED')`,
        [laterItemId, planId, laterDated.latestApplyDate, laterDated.applyAfterDate ?? null],
      );
      // It becomes a task like any other dated permit, so it really does schedule reminders.
      await pool.query(
        "INSERT INTO checklist_items (id, plan_item_id, cohort_position) VALUES ($1, $2, 1)",
        [randomUUID(), laterItemId],
      );
    }
    if (applyAfterDate !== null) {
      // The upstream half of the dependency. An unlock alert is only scheduled when the plan
      // carries the requirement the gated one waits on — `DEPENDENCY_SEQUENCING_BINDINGS` names
      // both ends, and an unlock that cannot name its dependency is not scheduled at all.
      await pool.query(
        `INSERT INTO permit_plan_items (id, plan_id, rule_ids, triggered_by, permit_name, agency,
                                        latest_apply_date, deadline, sources, kind, disposition,
                                        deadline_status, verification_status)
         VALUES ($1, $2, ARRAY['PARKS-EVENT-001'], '[]'::jsonb, 'Special Event Permit',
                 'NYC Parks', $3, $4::jsonb, '[]'::jsonb, 'permit', 'required', 'on_track',
                 'SOURCE_CONFIRMED')`,
        [
          randomUUID(),
          planId,
          latestApplyDate,
          JSON.stringify({
            type: "composite",
            hardFloorDays: 21,
            processingRangeDays: [21, 30],
            display: "apply at least 21 days ahead",
            qualification: null,
            boundary: "inclusive",
          }),
        ],
      );
      // The sequencing detail itself, which is a plan item like the two it sits between and is
      // where the unlock alert's third verification state comes from. It becomes no checklist
      // task, so it schedules nothing of its own — it is read, not alerted on.
      await pool.query(
        `INSERT INTO permit_plan_items (id, plan_id, rule_ids, triggered_by, permit_name, agency,
                                        sources, kind, disposition, deadline_status,
                                        verification_status)
         VALUES ($1, $2, ARRAY['NYPD-SOUND-PARKS-DEP-001'], '[]'::jsonb, 'Sound after Parks',
                 'NYPD', '[]'::jsonb, 'dependency', 'required', 'on_track', 'RESEARCH_REQUIRED')`,
        [randomUUID(), planId],
      );
    }
    await pool.query(
      `INSERT INTO permit_plan_items (id, plan_id, rule_ids, triggered_by, permit_name, agency,
                                      latest_apply_date, deadline, apply_after_date, sources, kind,
                                      disposition, deadline_status, verification_status)
       VALUES ($1, $2, ARRAY['NYPD-SOUND-001'], '[]'::jsonb, 'Sound Device Permit', 'NYPD', $3,
               $4::jsonb, $5, '[]'::jsonb, 'permit', $6, 'on_track', 'SOURCE_CONFIRMED')`,
      [
        itemId,
        planId,
        latestApplyDate,
        deadline === null ? null : JSON.stringify(deadline),
        applyAfterDate,
        disposition,
      ],
    );
    await pool.query(
      // The re-point `materialize` performs on a regeneration: the task survives, and only the
      // plan item it points at changes.
      `INSERT INTO checklist_items (id, plan_item_id, cohort_position) VALUES ($1, $2, 0)
       ON CONFLICT (id) DO UPDATE SET plan_item_id = EXCLUDED.plan_item_id`,
      [checklistItemId, itemId],
    );
    return { planId, checklistItemId };
  };

  /**
   * An event whose alerts are due right now. `offsets` is narrowed to one in the tests that count
   * provider attempts, so the count is about the poller rather than about how many offsets the
   * ruleset happens to publish.
   */
  const schedulePastDue = async (eventId: string, offsets = reminderOffsets): Promise<number> => {
    // Offsets that all land behind today, against a filing date that is still ahead: every alert
    // this writes is due immediately, and none of them names a date that has passed.
    const { planId } = await insertDuePlan(eventId);
    const client = await pool.connect();
    try {
      const summary = await createAlertScheduler({
        reminderDaysBefore: offsets,
        slackWarningDays: ruleset.slackWarningDays,
        jurisdiction: ruleset.jurisdiction,
      })(client, eventId, planId, { email: "organizer@example.test", phone: null });
      return summary.scheduled;
    } finally {
      client.release();
    }
  };

  beforeAll(async () => {
    pool = new Pool({ connectionString: databaseUrl });
    ruleset = parseEngineRuleset(JSON.parse(await readFile(rulesFilePath(), "utf8")));
    const published = await loadRuleset();
    intakeContract = parseIntakeContract(published.document);
    reminderOffsets = deadlineReminderOffsets(published);
  });

  /**
   * A tick sends everything due in the database, not everything due for one event, so an alert
   * one test left pending would be picked up by the next test's poller and counted there. Due
   * leftovers are retired between tests; future-dated ones are what the scheduling tests assert
   * on and are left alone.
   */
  afterEach(async () => {
    await pool.query(
      `UPDATE alerts SET status = 'cancelled'
        WHERE status IN ('pending', 'failed') AND send_at <= current_timestamp`,
    );
  });

  afterAll(async () => {
    if (createdEventIds.length > 0) {
      await pool.query("DELETE FROM alerts WHERE event_id = ANY($1)", [createdEventIds]);
      // Before the events they key on: contacts are event-scoped (migration 009).
      await pool.query("DELETE FROM event_alert_contacts WHERE event_id = ANY($1)", [
        createdEventIds,
      ]);
      await pool.query(
        `DELETE FROM checklist_items WHERE plan_item_id IN (
           SELECT item.id FROM permit_plan_items AS item
             JOIN permit_plans AS plan ON plan.id = item.plan_id
            WHERE plan.event_id = ANY($1))`,
        [createdEventIds],
      );
      await pool.query(
        `DELETE FROM permit_plan_items WHERE plan_id IN (
           SELECT id FROM permit_plans WHERE event_id = ANY($1))`,
        [createdEventIds],
      );
      await pool.query("DELETE FROM checklist_acknowledgements WHERE event_id = ANY($1)", [
        createdEventIds,
      ]);
      await pool.query("DELETE FROM permit_plans WHERE event_id = ANY($1)", [createdEventIds]);
      await pool.query("DELETE FROM events WHERE id = ANY($1)", [createdEventIds]);
    }
    await pool.end();
  });

  describe("AC 1 — materializing a checklist schedules the plan's alert set", () => {
    it("schedules a reminder per published offset for every dated permit, and nothing else", async () => {
      const eventId = await createEvent(scenario("C"));
      const response = await materialize(eventId);

      expect(response.status).toBe(201);
      expect(response.body.alerts).toMatchObject({
        cancelled: 0,
        channels: ["email"],
        reason: null,
      });
      // Two Parks reminders, two NYPD reminders, one dependency unlock.
      expect(response.body.alerts.scheduled).toBe(5);
      expect((await describeAlerts(eventId)).sort()).toEqual(
        [
          // Parks: latest_apply 2026-08-26, offsets 7 and 1.
          "2026-08-19 deadline_reminder PARKS-EVENT-001 email pending",
          "2026-08-25 deadline_reminder PARKS-EVENT-001 email pending",
          // NYPD is gated on the Parks decision window (AC 4), then reminds against its own date.
          "2026-08-12 dependency_unlocked NYPD-SOUND-001 email pending",
          "2026-09-04 deadline_reminder NYPD-SOUND-001 email pending",
          "2026-09-10 deadline_reminder NYPD-SOUND-001 email pending",
        ].sort(),
      );
    });

    it("schedules the offsets the ruleset publishes rather than a hardcoded pair", async () => {
      // The artifact is the contract (F-203 Outputs: config, not code).
      expect(reminderOffsets).toEqual([7, 1]);
      const eventId = await createEvent(scenario("C"));
      await materialize(eventId);
      const parks = (await alertsOf(eventId)).filter(
        (row) => row.alert_type === "deadline_reminder",
      );
      const parksDays = await Promise.all(
        parks.map(async (row) => ({
          rules: (await ruleIdsFor(row.checklist_item_id ?? "")).join("+"),
          day: row.send_at.toISOString().slice(0, 10),
        })),
      );
      expect(
        parksDays
          .filter((row) => row.rules === "PARKS-EVENT-001")
          .map((row) => row.day)
          .sort(),
      ).toEqual(["2026-08-19", "2026-08-25"]);
    });

    it("schedules nothing for a finding whose deadline the engine declines to date", async () => {
      // Scenario D carries FDNY-FUEL-001, a research_required lead time: no agency publishes one,
      // so there is no date to schedule against and none is invented.
      const eventId = await createEvent(scenario("D"));
      const response = await materialize(eventId);

      const undated = response.body.items.filter(
        (item: { latestApplyDate: string | null }) => item.latestApplyDate === null,
      );
      expect(undated.length).toBeGreaterThan(0);
      // The published "confirm the lead time with the agency" rendering, whatever the rule words it
      // as — FDNY names itself. The point is that the row says confirm, and carries no date.
      expect(undated[0].deadlineDisplay).toMatch(/confirm with/);
      const scheduledFor = await Promise.all(
        (await alertsOf(eventId))
          .filter((row) => row.checklist_item_id !== null)
          .map((row) => ruleIdsFor(row.checklist_item_id ?? "")),
      );
      expect(scheduledFor.flat()).not.toContain("FDNY-FUEL-001");
    });

    it("fires the slack warning immediately when the plan is at risk, labeled as PopEngine policy", async () => {
      const eventId = await createEvent(scenario("D"));
      await materialize(eventId);

      const warning = (await alertsOf(eventId)).find((row) => row.alert_type === "slack_warning");
      expect(warning?.checklist_item_id).toBeNull();
      // The answer key pins Scenario D at "apply within 10 days", and that phrase is intact: the
      // number is the verdict's and is not recomputed. What is added is the date it was measured
      // from, because a bare count decays and this subject is read whenever the alert arrives.
      // `specs/F-102` AC 5 is about the VERDICT's rendering and is satisfied by
      // `apps/web/app/plan/verdict-copy.ts`, which is untouched.
      expect(warning?.payload.subject).toContain("apply within 10 days");
      expect(warning?.payload.subject).toBe("At risk — apply within 10 days of 2026-07-22");
      expect(warning?.payload.body).toContain(
        "14-day threshold is PopEngine's internal planning buffer, not an official threshold",
      );
      expect(warning?.send_at.getTime()).toBeLessThanOrEqual(Date.now());
    });

    it("says what the slack number is, rather than calling it time remaining", async () => {
      const eventId = await createEvent(scenario("D"));
      await materialize(eventId);

      const warning = (await alertsOf(eventId)).find((row) => row.alert_type === "slack_warning");
      // The number is a minimum across findings, measured from the plan's evaluation date — not
      // the distance from today, and for a gated finding not a distance at all.
      expect(warning?.payload.body).toContain(
        "the narrowest slack across its dated requirements is 10 days, measured from the plan's " +
          "evaluation date 2026-07-22",
      );
      expect(warning?.payload.body).not.toContain("days away");
      // Scenario D has no gated filing, so the window-width qualifier would be noise.
      expect(warning?.payload.body).not.toContain("width of the window");
    });

    it("does not describe gated slack as time until filing", async () => {
      // The reviewer's case: a filing window nine days wide that cannot be entered for another
      // three weeks. "Nine days away" would tell the organizer they have three weeks less runway
      // than they do.
      const eventId = await createEvent(scenario("C"));
      const { planId } = await insertDuePlan(eventId, {
        verdict: "feasible_at_risk",
        minSlackDays: 9,
        latestApplyDate: dayFromToday(30),
        applyAfterDate: dayFromToday(21),
      });
      const client = await pool.connect();
      try {
        await schedulerWith()(client, eventId, planId, {
          email: "organizer@example.test",
          phone: null,
        });
      } finally {
        client.release();
      }

      const warning = (await alertsOf(eventId)).find((row) => row.alert_type === "slack_warning");
      expect(warning?.payload.body).toContain(
        "the number is the WIDTH of the window it can be filed in, not time remaining and not " +
          "measured from any date",
      );
      expect(warning?.payload.body).not.toContain("days away");
      // AND THE FIRST LINE NO LONGER CONTRADICTS IT. It used to say the number was measured from
      // the plan's evaluation date and then correct itself two lines later, so the body disagreed
      // with itself in exactly the case the qualification exists to describe.
      expect(warning?.payload.body).not.toContain("measured from the plan's evaluation date");
    });

    it("does not warn twice when an identical plan is regenerated", async () => {
      // The slack warning used to carry the plan's UUID, which is minted fresh by every generation,
      // so regenerating an IDENTICAL plan produced a second immediately-due warning to the same
      // address while the first sat there already sent. That is a different attempt to one
      // destination, which is what AC 7 forbids in the words this PR gave it.
      const eventId = await createEvent(scenario("C"));
      const atRisk = {
        verdict: "feasible_at_risk",
        minSlackDays: 9,
        latestApplyDate: dayFromToday(30),
      };
      const warn = async (options: Record<string, unknown>) => {
        const { planId } = await insertDuePlan(eventId, options);
        const client = await pool.connect();
        try {
          await schedulerWith()(client, eventId, planId, {
            email: "organizer@example.test",
            phone: null,
          });
        } finally {
          client.release();
        }
      };

      await warn(atRisk);
      const first = (await alertsOf(eventId)).filter((row) => row.alert_type === "slack_warning");
      expect(first).toHaveLength(1);
      // Sent, so a second row would be a second delivery rather than a rewrite of a pending one.
      await pool.query(
        "UPDATE alerts SET status = 'sent', sent_at = clock_timestamp() WHERE id = $1",
        [first[0]?.id],
      );

      // A new plan row, same event, same risk. Nothing an organizer would read as new.
      await warn(atRisk);

      const after = (await alertsOf(eventId)).filter((row) => row.alert_type === "slack_warning");
      expect(after).toHaveLength(1);
      expect(after[0]?.id).toBe(first[0]?.id);
      expect(after[0]?.status).toBe("sent");
    });

    it("does not warn a second time when the slack value changes", async () => {
      // The product owner's decision, and it reverses what this test used to assert. Keying the
      // identity on the number looked like "warn again only when the risk changed" and is not:
      // ungated slackDays is measured from the PLAN'S EVALUATION DATE, so regenerating an
      // unchanged, still-at-risk event a week later yields a smaller number and a fresh identity.
      // That re-warns on most regenerations, which is close to the plan-UUID defect it replaced.
      //
      // What settles it is what the alert is. The copy says the threshold is PopEngine's internal
      // buffer and not an official one, and the warning names no agency deadline; the deadline
      // reminders fire on their own dates regardless. So a suppressed duplicate cannot let a filing
      // deadline pass unnoticed, and the repeat is what AC 7 forbids.
      //
      // The trade is real and is named in the code beside the identity: an organizer whose buffer
      // genuinely worsens is not warned twice, and that case wants a designed escalation rather
      // than an identity that happens to change.
      const eventId = await createEvent(scenario("C"));
      const warn = async (minSlackDays: number) => {
        const { planId } = await insertDuePlan(eventId, {
          verdict: "feasible_at_risk",
          minSlackDays,
          latestApplyDate: dayFromToday(30),
        });
        const client = await pool.connect();
        try {
          await schedulerWith()(client, eventId, planId, {
            email: "organizer@example.test",
            phone: null,
          });
        } finally {
          client.release();
        }
      };

      // The first warning is sent, so a second ROW would be a second delivery to one destination
      // rather than a rewrite of something still pending.
      await warn(9);
      const first = (await alertsOf(eventId)).filter((row) => row.alert_type === "slack_warning");
      expect(first).toHaveLength(1);
      expect(String(first[0]?.payload.body)).toContain("9 days");
      await pool.query(
        "UPDATE alerts SET status = 'sent', sent_at = clock_timestamp() WHERE id = $1",
        [first[0]?.id],
      );

      await warn(2);

      const after = (await alertsOf(eventId)).filter((row) => row.alert_type === "slack_warning");
      expect(after).toHaveLength(1);
      expect(after[0]?.id).toBe(first[0]?.id);
      expect(after[0]?.status).toBe("sent");
      // NOT vacuous: the row is still the one that was sent, carrying the copy it was sent with.
      // A suppression that worked by never producing the second warning at all would leave the same
      // count, so the body is asserted too — under the previous identity a second row exists here
      // saying 2 days, and this line is what refuses it.
      expect(String(after[0]?.payload.body)).toContain("9 days");
    });

    it("carries the controlling requirement's verification state and its published caveats", async () => {
      // THE THIRD BUILDER. AGENTS.md keeps published verification states visible end to end and a
      // notification is an end; reminders got this in round 7 and dependency alerts in round 10.
      // The verdict does not exclude unsettled findings from its minimum, so a plan whose tightest
      // requirement is OFFICIAL_CONFLICT produced an apparently settled "apply within N days" from
      // a rule that is not settled.
      const eventId = await createEvent(scenario("C"));
      const { planId } = await insertDuePlan(eventId, {
        verdict: "feasible_at_risk",
        minSlackDays: 9,
        latestApplyDate: dayFromToday(9),
        conflictText: "Two published readings disagree on whether this applies.",
      });
      await pool.query(
        `UPDATE permit_plan_items SET verification_status = 'OFFICIAL_CONFLICT'
          WHERE plan_id = $1 AND rule_ids = ARRAY['NYPD-SOUND-001']`,
        [planId],
      );
      const client = await pool.connect();
      try {
        await schedulerWith()(client, eventId, planId, {
          email: "organizer@example.test",
          phone: null,
        });
      } finally {
        client.release();
      }

      const warning = (await alertsOf(eventId)).find((row) => row.alert_type === "slack_warning");
      expect(String(warning?.payload.body)).toContain(
        "Verification of your Sound Device Permit (NYPD): OFFICIAL CONFLICT",
      );
      // And the published prose, quoted rather than summarised.
      expect(String(warning?.payload.body)).toContain(
        "Two published readings disagree on whether this applies.",
      );
    });

    it("carries every tied controlling requirement's state, not just the first", async () => {
      // Round 22 established the tie can hold several and that they can differ. A status is not a
      // summary: quoting one while another tied requirement says something else is picking a
      // reading.
      const eventId = await createEvent(scenario("C"));
      const { planId } = await insertDuePlan(eventId, {
        verdict: "feasible_at_risk",
        minSlackDays: 9,
        latestApplyDate: dayFromToday(9),
        laterDated: { latestApplyDate: dayFromToday(20), slackDays: 9 },
      });
      await pool.query(
        `UPDATE permit_plan_items SET verification_status = 'RESEARCH_REQUIRED'
          WHERE plan_id = $1 AND rule_ids = ARRAY['PARKS-EVENT-001']`,
        [planId],
      );
      const client = await pool.connect();
      try {
        await schedulerWith()(client, eventId, planId, {
          email: "organizer@example.test",
          phone: null,
        });
      } finally {
        client.release();
      }

      const body = String(
        (await alertsOf(eventId)).find((row) => row.alert_type === "slack_warning")?.payload.body,
      );
      expect(body).toContain("Verification of your Sound Device Permit (NYPD): SOURCE CONFIRMED");
      expect(body).toContain(
        "Verification of your Special Event Permit (NYC Parks): RESEARCH REQUIRED",
      );
      expect(body).toContain("Special Event Permit (NYC Parks): confirm with agency");
      expect(body.split(CONFIRM_WITH_AGENCY)).toHaveLength(2);
    });

    it("keeps a tied gated controller in the copy after its own window has shut", async () => {
      // ONE FILTER WAS ANSWERING TWO QUESTIONS. Openness decides whether the warning may still be
      // sent; it should not also decide which findings produced the number being described. Here a
      // gated and an ungated requirement tie at 9, the gated one's filing date has passed and the
      // ungated one's has not, so the warning is still legitimately sent — and the gated controller
      // was dropped from the copy, which described the number purely as an evaluation-date
      // countdown even though that same value was ALSO computed as a filing-window width.
      //
      // The round 22 tie principle decides it: break the tie in the direction that cannot harm the
      // organizer, and turning a width into a countdown states a filing date no source publishes.
      const eventId = await createEvent(scenario("C"));
      const { planId } = await insertDuePlan(eventId, {
        verdict: "feasible_at_risk",
        minSlackDays: 9,
        // The UNGATED controller, still open, which is what keeps the warning sendable.
        latestApplyDate: dayFromToday(9),
        // The GATED controller, tied at 9, whose own window has already shut.
        laterDated: {
          latestApplyDate: dayFromToday(-3),
          slackDays: 9,
          applyAfterDate: dayFromToday(-20),
        },
      });
      await pool.query(
        `UPDATE permit_plan_items SET verification_status = 'RESEARCH_REQUIRED'
          WHERE plan_id = $1 AND rule_ids = ARRAY['PARKS-EVENT-001']`,
        [planId],
      );
      const client = await pool.connect();
      try {
        await schedulerWith()(client, eventId, planId, {
          email: "organizer@example.test",
          phone: null,
        });
      } finally {
        client.release();
      }

      const warning = (await alertsOf(eventId)).find((row) => row.alert_type === "slack_warning");
      // Openness still permitted it, which is what makes this about the copy and not the guard.
      expect(warning).toBeDefined();
      // A width, not an anchored countdown, because one of the tied controllers is gated.
      expect(warning?.payload.subject).toBe("At risk — the narrowest filing window is 9 days wide");
      expect(String(warning?.payload.subject)).not.toMatch(/\d{4}-\d{2}-\d{2}/);
      // And that controller's published state travels, which it could not while it was filtered out.
      expect(String(warning?.payload.body)).toContain(
        "Verification of your Special Event Permit (NYC Parks): RESEARCH REQUIRED",
      );
    });

    it("does not warn about slack on a plan that is not at risk", async () => {
      const eventId = await createEvent(scenario("C"));
      await materialize(eventId);
      expect((await alertsOf(eventId)).some((row) => row.alert_type === "slack_warning")).toBe(
        false,
      );
    });

    it("schedules no reminder for a filing date the plan's own clock has already passed", async () => {
      // Scenario A's SAPO street permit closed on 2026-07-12, ten days before the fixture clock.
      // A countdown to it would read "file by" a day that has gone.
      const eventId = await createEvent(scenario("A"));
      await materialize(eventId);
      const scheduledFor = await Promise.all(
        (await alertsOf(eventId))
          .filter((row) => row.checklist_item_id !== null)
          .map((row) => ruleIdsFor(row.checklist_item_id ?? "")),
      );
      expect(scheduledFor.flat()).not.toContain("SAPO-STREET-LARGE-001");
      expect(scheduledFor.flat()).toContain("NYPD-SOUND-001");
    });

    it("reads filing dates against the day scheduling happens, not the day the plan was evaluated", async () => {
      // A plan generated five weeks ago and converted today. Its filing date closed a week ago.
      // The plan's own `today` still sits behind that date, so a guard reading the plan's clock
      // sees a deadline that is comfortably ahead and schedules a reminder that is immediately
      // due and says "file by" a day that has gone.
      const eventId = await createEvent(scenario("C"));
      const { planId } = await insertDuePlan(eventId, {
        planToday: dayFromToday(-35),
        latestApplyDate: dayFromToday(-7),
      });

      const client = await pool.connect();
      try {
        const summary = await schedulerWith()(client, eventId, planId, {
          email: "organizer@example.test",
          phone: null,
        });
        expect(summary.scheduled).toBe(0);
      } finally {
        client.release();
      }
      expect(await alertsOf(eventId)).toEqual([]);
    });

    it("sends nothing anywhere when no contact was entered, and says so", async () => {
      const eventId = await createEvent(scenario("C"));
      const response = await materialize(eventId, {});

      expect(response.body.alerts).toMatchObject({
        scheduled: 0,
        channels: [],
        reason: "no contact was supplied for this event, so no alerts were scheduled",
      });
      expect(await alertsOf(eventId)).toEqual([]);
    });

    it("schedules on every channel a contact was entered for", async () => {
      const eventId = await createEvent(scenario("C"));
      await materialize(eventId, {
        contactEmail: "organizer@example.test",
        contactPhone: "+15555550123",
      });
      const rows = await alertsOf(eventId);
      expect(new Set(rows.map((row) => row.channel))).toEqual(new Set(["email", "sms"]));
      expect(rows.filter((row) => row.channel === "sms")).toHaveLength(5);
      // AD-13: every row carries the destination and its own key.
      expect(rows.every((row) => row.recipient !== "" && row.idempotency_key !== "")).toBe(true);
      expect(new Set(rows.map((row) => row.idempotency_key)).size).toBe(rows.length);
    });

    it("refuses a contact that is not an address", async () => {
      const eventId = await createEvent(scenario("C"));
      const response = await materialize(eventId, { contactEmail: "not-an-address" });
      expect(response.status).toBe(400);
      expect(response.body.error).toBe("contactEmail must be an email address");
      expect(await alertsOf(eventId)).toEqual([]);
    });

    it("refuses a contact phone that is empty", async () => {
      const eventId = await createEvent(scenario("C"));
      const response = await materialize(eventId, { contactPhone: "   " });
      expect(response.status).toBe(400);
      expect(response.body.error).toBe("contactPhone must be a non-empty string");
    });
  });

  describe("AC 3 — a hard floor is never softened", () => {
    it("states the Parks floor and the published deadline text in the reminder itself", async () => {
      const eventId = await createEvent(scenario("C"));
      await materialize(eventId);

      const rows = await alertsOf(eventId);
      const parks: AlertRow[] = [];
      for (const row of rows) {
        if (row.checklist_item_id === null) continue;
        if ((await ruleIdsFor(row.checklist_item_id)).includes("PARKS-EVENT-001")) parks.push(row);
      }
      expect(parks).toHaveLength(2);
      for (const alert of parks) {
        expect(alert.payload.body).toContain(
          "Applications within 21 days of the event are not accepted.",
        );
        // The agency's own words, quoted from the rule rather than paraphrased.
        expect(alert.payload.body).toContain(
          "apply at least 21 days ahead (applications inside 21 days are not accepted); processing 21–30 days",
        );
      }
    });

    it("states the verification state on every reminder, not only where prose mentions it", async () => {
      // AGENTS.md keeps the verification states visible END TO END, and a notification is an end.
      // Copying an OFFICIAL_CONFLICT rule's prose covered one status and left the ordinary
      // confirmed case saying nothing at all, which is the case where silence reads as settled.
      const eventId = await createEvent(scenario("C"));
      await materialize(eventId);

      const rows = await alertsOf(eventId);
      const reminders = rows.filter((row) => row.alert_type === "deadline_reminder");
      expect(reminders.length).toBeGreaterThan(0);
      for (const alert of reminders) {
        const ruleIds = await ruleIdsFor(alert.checklist_item_id ?? "");
        // The state the plan item stored, humanised the way the checklist row humanises it.
        const stored = await pool.query<{ verification_status: string }>(
          `SELECT item.verification_status
             FROM checklist_items AS checklist
             JOIN permit_plan_items AS item ON item.id = checklist.plan_item_id
            WHERE checklist.id = $1`,
          [alert.checklist_item_id],
        );
        const expected = (stored.rows[0]?.verification_status ?? "").replace(/_/g, " ");
        expect(expected).not.toBe("");
        expect(alert.payload.body, `reminder for ${ruleIds.join("+")}`).toContain(
          `Verification: ${expected}`,
        );
      }
      // Scenario C's permits are SOURCE_CONFIRMED, which is exactly the case that used to be silent.
      expect(
        reminders.some((row) => row.payload.body?.includes("Verification: SOURCE CONFIRMED")),
      ).toBe(true);
    });

    it("tells a dated research-required reminder to confirm with the agency", async () => {
      const eventId = await createEvent(scenario("C"));
      const { planId } = await insertDuePlan(eventId, {
        latestApplyDate: dayFromToday(7),
        deadline: {
          type: "published_minimum",
          calendarDays: 5,
          display: CONFIRM_WITH_AGENCY,
          qualification: null,
          boundary: "inclusive",
        },
        deadlineDisplay: CONFIRM_WITH_AGENCY,
      });
      await pool.query(
        `UPDATE permit_plan_items SET verification_status = 'RESEARCH_REQUIRED'
          WHERE plan_id = $1 AND rule_ids = ARRAY['NYPD-SOUND-001']`,
        [planId],
      );
      const client = await pool.connect();
      try {
        await schedulerWith()(client, eventId, planId, {
          email: "organizer@example.test",
          phone: null,
        });
      } finally {
        client.release();
      }

      const reminder = (await alertsOf(eventId)).find(
        (row) => row.alert_type === "deadline_reminder",
      );
      expect(reminder?.payload.body).toContain("Verification: RESEARCH REQUIRED");
      expect(reminder?.payload.body).toContain(`Published deadline: ${CONFIRM_WITH_AGENCY}`);
      expect(reminder?.payload.body?.split(CONFIRM_WITH_AGENCY)).toHaveLength(2);
    });

    it("coalesces confirmation published in a reminder's portal instructions", async () => {
      const eventId = await createEvent(scenario("C"));
      const { planId } = await insertDuePlan(eventId, {
        latestApplyDate: dayFromToday(7),
        portalInstructions: CONFIRM_WITH_AGENCY,
      });
      await pool.query(
        `UPDATE permit_plan_items SET verification_status = 'RESEARCH_REQUIRED'
          WHERE plan_id = $1 AND rule_ids = ARRAY['NYPD-SOUND-001']`,
        [planId],
      );
      const client = await pool.connect();
      try {
        await schedulerWith()(client, eventId, planId, {
          email: "organizer@example.test",
          phone: null,
        });
      } finally {
        client.release();
      }

      const reminder = (await alertsOf(eventId)).find(
        (row) => row.alert_type === "deadline_reminder",
      );
      expect(reminder?.payload.body).toContain("Verification: RESEARCH REQUIRED");
      expect(reminder?.payload.body?.split(CONFIRM_WITH_AGENCY)).toHaveLength(2);
      expect(reminder?.payload.body).not.toContain(
        `Sound Device Permit (NYPD): ${CONFIRM_WITH_AGENCY}`,
      );
    });

    it("carries the published qualification beside the date it qualifies", async () => {
      // A deadline's number is not the whole published answer. DOB-ASSEMBLY-001 states the unit,
      // the bound and what remains unestablished in the deadline's own `qualification` and the
      // verification's, and `findings.ts` flattens both into `notes` with nothing marking which
      // is which. A builder reading only `deadline_display` dropped them, so the reminder gave a
      // computed date as though the lead were settled.
      //
      // The expected strings are READ FROM THE PUBLISHED RULE rather than written here. The first
      // version quoted v2.7's wording, and v2.8 rewrote it: the assertion broke while the code was
      // still correct, which is a test pinning prose instead of behaviour.
      const rule = ruleset.rules.find((candidate) => candidate.id === "DOB-ASSEMBLY-001");
      const qualification = rule?.deadline?.qualification;
      const verificationQualification = rule?.verificationQualification;
      expect(typeof qualification).toBe("string");
      expect(typeof verificationQualification).toBe("string");

      // Scenario F, which the rule's own `exercised_by_scenarios` names.
      const eventId = await createEvent(scenario("F"));
      await materialize(eventId);

      const assembly: AlertRow[] = [];
      for (const row of await alertsOf(eventId)) {
        if (row.checklist_item_id === null) continue;
        if ((await ruleIdsFor(row.checklist_item_id)).includes("DOB-ASSEMBLY-001")) {
          assembly.push(row);
        }
      }
      expect(assembly.length).toBeGreaterThan(0);
      for (const alert of assembly) {
        // Quoted from the rule, not summarised by this repo.
        expect(alert.payload.body).toContain(qualification as string);
        expect(alert.payload.body).toContain(verificationQualification as string);
      }
    });

    it("keeps a may-be-required line conditional instead of turning it into a filing order", async () => {
      // A park event that sells: PARKS-TUA-001 fires, and it is dated, MAY_BE_REQUIRED, and
      // carries a published OFFICIAL_CONFLICT about whether it is triggered at all. An imperative
      // "file by" over that converts the ruleset's own uncertainty into a PopEngine requirement.
      const eventId = await createEvent({ ...scenario("C"), selling_anything: true });
      await materialize(eventId);

      const rows = await alertsOf(eventId);
      const tua: AlertRow[] = [];
      for (const row of rows) {
        if (row.checklist_item_id === null) continue;
        if ((await ruleIdsFor(row.checklist_item_id)).includes("PARKS-TUA-001")) tua.push(row);
      }
      expect(tua).toHaveLength(2);
      for (const alert of tua) {
        expect(alert.payload.subject).toMatch(/may be required — file by .* if it applies$/);
        expect(alert.payload.body).toContain("may be required for your event. If it applies");
        // The published conflict travels with the date rather than being dropped beside it.
        expect(alert.payload.body).toContain("OFFICIAL CONFLICT on the trigger");
        expect(alert.payload.body).toContain("confirm with the Revenue Division");
      }
    });

    it("still gives a settled requirement the plain filing instruction", async () => {
      const eventId = await createEvent(scenario("C"));
      await materialize(eventId);
      const rows = await alertsOf(eventId);
      const parks: AlertRow[] = [];
      for (const row of rows) {
        if (row.checklist_item_id === null) continue;
        if ((await ruleIdsFor(row.checklist_item_id)).includes("PARKS-EVENT-001")) parks.push(row);
      }
      expect(parks[0]?.payload.subject).toBe("File your Special Event Permit by 2026-08-26");
      expect(parks[0]?.payload.body).toContain(
        "Special Event Permit (NYC Parks): file by 2026-08-26.",
      );
    });

    it("labels the reminder timing as PopEngine's, never as the agency's", async () => {
      const eventId = await createEvent(scenario("C"));
      await materialize(eventId);
      const bodies = (await alertsOf(eventId))
        .filter((row) => row.alert_type === "deadline_reminder")
        .map((row) => row.payload.body ?? "");
      expect(bodies).toHaveLength(4);
      for (const body of bodies) {
        expect(body).toMatch(
          /PopEngine sends this reminder \d+ days? before the filing date\. That reminder schedule is PopEngine policy, not an agency deadline\./,
        );
      }
    });
  });

  describe("AC 4 — dependency alerts fire in sequence", () => {
    it("gates the sound permit on the Parks timeline and names the dependency in the copy", async () => {
      const eventId = await createEvent(scenario("C"));
      await materialize(eventId);

      const rows = await alertsOf(eventId);
      const unlock = rows.find((row) => row.alert_type === "dependency_unlocked");
      expect(unlock).toBeDefined();
      expect(await ruleIdsFor(unlock?.checklist_item_id ?? "")).toEqual(["NYPD-SOUND-001"]);
      // apply_after = today + the Parks rule's own earliest decision (21 days), 2026-07-22 → 08-12.
      expect(unlock?.send_at.toISOString().slice(0, 10)).toBe("2026-08-12");
      // Names both ends of the dependency and says what the date is: the EARLIEST a decision could
      // come back, from the upstream rule's own published range. Not that one has come back.
      expect(unlock?.payload.body).toContain(
        "2026-08-12 is the earliest a decision on your Special Event Permit (NYC Parks) could " +
          "come back, from its published 21–30 day processing range. That date has arrived. It " +
          "is not confirmation that a decision has been made.",
      );
      expect(unlock?.payload.body).toContain(
        "Confirm the outcome with NYC Parks before you file your Sound Device Permit (NYPD).",
      );
      expect(unlock?.payload.body).not.toContain("decision window has passed");
      // NEITHER READING IS ASSERTED, and both halves of that are the finding. The alert must not
      // say a decision arrived, because the date is the soonest one COULD, and it must not say the
      // organizer may not file yet, because the published rule marks the sequencing itself
      // RESEARCH_REQUIRED and closing a window on an unconfirmed sequence would invent a blocker.
      expect(unlock?.payload.body).not.toContain("can now pursue");
      expect(unlock?.payload.subject).not.toContain("can now pursue");
      expect(String(unlock?.payload.body)).not.toMatch(/do not file|cannot file|must wait/i);
      // The published filing route, and the published caveat: the ordering itself is not confirmed.
      expect(unlock?.payload.body).toContain("File at the precinct where the device will be used");
      expect(unlock?.payload.body).toContain(
        "A strict issued-before-filed sequence is not confirmed by located primary text",
      );
    });

    it("names the sequence on a reminder that lands exactly on the expected decision day", async () => {
      // The boundary. A gated window exactly one reminder offset wide puts the unlock and the
      // reminder on the same day, and `sendOn < openOn` dropped the sequencing note on precisely
      // the case where the two arrive together and the organizer most needs to be told which one
      // waits on the other. The window OPENS that day; it does not close the day before.
      const eventId = await createEvent(scenario("C"));
      const offset = reminderOffsets[0] ?? 7;
      const { planId } = await insertDuePlan(eventId, {
        latestApplyDate: dayFromToday(30),
        applyAfterDate: dayFromToday(30 - offset),
      });
      const client = await pool.connect();
      try {
        await schedulerWith()(client, eventId, planId, {
          email: "organizer@example.test",
          phone: null,
        });
      } finally {
        client.release();
      }

      const rows = await alertsOf(eventId);
      const unlock = rows.find((row) => row.alert_type === "dependency_unlocked");
      const reminder = rows.find(
        (row) =>
          row.alert_type === "deadline_reminder" &&
          row.send_at.getTime() === unlock?.send_at.getTime(),
      );
      expect(reminder).toBeDefined();
      expect(String(reminder?.payload.body)).toContain("This filing is sequenced after your");
    });

    it("names the sequence on a reminder that lands before the upstream decision is expected", async () => {
      // ~28 days of runway: the sound permit's own filing date is 2026-08-14, so its seven-day
      // reminder falls on 08-07 — five days before 08-12, the earliest the Parks decision could
      // come back. Without the sequence the organizer is told to file, and only later told they
      // can pursue it.
      const eventId = await createEvent({ ...scenario("C"), event_date: "2026-08-19" });
      await materialize(eventId);

      const gated: AlertRow[] = [];
      for (const row of await alertsOf(eventId)) {
        if (row.alert_type !== "deadline_reminder" || row.checklist_item_id === null) continue;
        if ((await ruleIdsFor(row.checklist_item_id)).includes("NYPD-SOUND-001")) gated.push(row);
      }
      const early = gated.find((row) => row.send_at.toISOString().slice(0, 10) === "2026-08-07");
      const late = gated.find((row) => row.send_at.toISOString().slice(0, 10) === "2026-08-13");

      expect(early?.payload.body).toContain(
        "This filing is sequenced after your Special Event Permit (NYC Parks), whose decision is " +
          "expected no earlier than 2026-08-12.",
      );
      // Not moved and not dropped: `apply_after_date` is the earliest a decision could come back,
      // and the dependency rule says a strict issued-before-filed order is unconfirmed, so
      // clamping the reminder to it would assert a bar on filing early that nothing publishes.
      expect(early?.payload.body).toContain("Filing before then may still be possible");
      expect(early?.payload.body).toContain("file by 2026-08-14");
      // The later reminder is past the gate, so the sequence is no longer news.
      expect(late?.payload.body).not.toContain("This filing is sequenced after");
    });

    it("puts the unlock before the gated permit's own reminders", async () => {
      const eventId = await createEvent(scenario("C"));
      await materialize(eventId);
      const rows = await alertsOf(eventId);
      const unlock = rows.find((row) => row.alert_type === "dependency_unlocked");
      const gated: AlertRow[] = [];
      for (const row of rows) {
        if (row.alert_type !== "deadline_reminder" || row.checklist_item_id === null) continue;
        if ((await ruleIdsFor(row.checklist_item_id)).includes("NYPD-SOUND-001")) gated.push(row);
      }
      expect(gated).toHaveLength(2);
      for (const reminder of gated) {
        expect(unlock?.send_at.getTime()).toBeLessThan(reminder.send_at.getTime());
      }
    });
  });

  describe("AC 2 — the poller sends what is due, marks it, and retries what failed", () => {
    it("sends a due alert, marks it sent, and records how it was delivered", async () => {
      const eventId = await createEvent(scenario("C"));
      await schedulePastDue(eventId);
      const provider = fakeProvider();

      const summary = await createAlertPoller({
        database: pool,
        senders: provider.senders,
        jurisdiction: ruleset.jurisdiction,
      }).tick();

      expect(summary.sent).toBeGreaterThanOrEqual(2);
      const rows = await alertsOf(eventId);
      expect(rows.every((row) => row.status === "sent")).toBe(true);
      expect(rows.every((row) => row.sent_at !== null)).toBe(true);
      expect(rows[0]?.payload.delivery).toMatchObject({ simulated: false });
      expect(provider.delivered.map((message) => message.recipient)).toContain(
        "organizer@example.test",
      );
    });

    it("marks a failed send failed, counts it, and sends it on a later tick", async () => {
      const eventId = await createEvent(scenario("C"));
      await schedulePastDue(eventId);
      const provider = fakeProvider();
      provider.fail = "email provider unreachable: socket hang up";
      const poller = createAlertPoller({
        database: pool,
        senders: provider.senders,
        jurisdiction: ruleset.jurisdiction,
      });

      const failedTick = await poller.tick();
      expect(failedTick.failed).toBeGreaterThanOrEqual(2);
      const afterFailure = await alertsOf(eventId);
      expect(afterFailure.every((row) => row.status === "failed")).toBe(true);
      expect(afterFailure.every((row) => row.failure_count === 1)).toBe(true);
      expect(afterFailure[0]?.payload.last_error).toContain("socket hang up");

      provider.fail = null;
      await poller.tick();
      const afterRetry = await alertsOf(eventId);
      expect(afterRetry.every((row) => row.status === "sent")).toBe(true);
      // Nothing was lost and nothing was duplicated by the retry.
      expect(afterRetry).toHaveLength(afterFailure.length);
    });

    it("does not send twice when the process dies between the send and the mark", async () => {
      const eventId = await createEvent(scenario("C"));
      expect(await schedulePastDue(eventId, [1])).toBe(1);
      const provider = fakeProvider();

      // The failure a crash looks like from here: the provider took the message and the row never
      // got marked. Everything else about the transaction is real.
      // A pool of its own, because the sabotage below patches a connection and a patched
      // connection goes back into the pool it came from.
      const doomed = new Pool({ connectionString: databaseUrl });
      const crashing = Object.create(pool) as Pool;
      // The scan runs on the shared pool, bound rather than inherited: `Pool.query` reaches for
      // `this.connect` with a callback, and the promise-only override below would strand it.
      crashing.query = pool.query.bind(pool) as Pool["query"];
      // The connection dies after the provider already has the message: every write that would
      // have recorded the outcome fails, exactly as a process that stopped existing would.
      crashing.connect = (async () => {
        const client = await doomed.connect();
        const query = client.query.bind(client);
        client.query = ((...args: unknown[]) =>
          typeof args[0] === "string" && args[0].includes("UPDATE alerts")
            ? Promise.reject(new Error("connection terminated unexpectedly"))
            : query(...(args as Parameters<typeof query>))) as typeof client.query;
        return client;
      }) as Pool["connect"];

      const crashed = await createAlertPoller({
        jurisdiction: ruleset.jurisdiction,
        database: crashing,
        senders: provider.senders,
      }).tick();
      await doomed.end();
      expect(crashed.sent).toBe(0);
      // The row is untouched, so it is still due.
      expect((await alertsOf(eventId)).every((row) => row.status === "pending")).toBe(true);
      expect(provider.delivered).toHaveLength(1);

      await createAlertPoller({
        database: pool,
        senders: provider.senders,
        jurisdiction: ruleset.jurisdiction,
      }).tick();

      expect((await alertsOf(eventId)).every((row) => row.status === "sent")).toBe(true);
      // Two attempts, one delivery: the repeated attempt carried the same key, and the provider
      // recognised it (AD-13).
      expect(provider.attempts).toHaveLength(2);
      expect(provider.attempts[0]?.idempotencyKey).toBe(provider.attempts[1]?.idempotencyKey);
      expect(provider.delivered).toHaveLength(1);
    });

    describe("an attempt is recorded before the send, so a crash is not a non-attempt", () => {
      /**
       * A due alert written straight in, with no attempt behind it and no plan to go stale.
       *
       * Written rather than scheduled because these tests are about how OLD a row is allowed to
       * be: the scheduler only writes alerts for filing dates that are still ahead, so it cannot
       * produce a row that has been due for a month.
       */
      const insertDueAlert = async (
        eventId: string,
        recipient: string,
        dueDaysAgo: number,
        row: {
          readonly channel?: AlertChannel;
          readonly status?: AlertStatus;
          /** What the last send recorded on the row, which is the only evidence of WHY it failed. */
          readonly lastError?: string;
        } = {},
      ): Promise<string> => {
        const alertId = randomUUID();
        await pool.query(
          `INSERT INTO alerts (id, event_id, alert_type, channel, recipient, idempotency_key,
                               send_at, status, failure_count, payload)
           VALUES ($1, $2, 'deadline_reminder', $6, $3, $5,
                   current_timestamp - ($4 || ' days')::interval, $7,
                   CASE WHEN $7 = 'failed' THEN 1 ELSE 0 END,
                   '{"subject":"file it","body":"file it"}'::jsonb || $8::jsonb)`,
          [
            alertId,
            eventId,
            recipient,
            dueDaysAgo,
            alertId,
            row.channel ?? "email",
            row.status ?? "pending",
            JSON.stringify(row.lastError === undefined ? {} : { last_error: row.lastError }),
          ],
        );
        return alertId;
      };

      /**
       * Migration 014's own data step, replayed over rows that predate it.
       *
       * The upgrade state cannot occur in a test database otherwise: every alert here was written
       * after the table existed, so the one population the migration has to decide about — rows
       * attempted by code that recorded nothing — has to be built and then handed to the
       * migration's own SQL rather than to a re-statement of it.
       */
      const seedLegacyAttempts = async (): Promise<void> => {
        const sql = vi.fn();
        migration014({
          sql,
          createTable: vi.fn(),
          createIndex: vi.fn(),
          func: vi.fn(),
        } as unknown as MigrationBuilder);
        for (const [statement] of sql.mock.calls) await pool.query(String(statement));
      };

      const recordAttempt = async (
        alertId: string,
        hoursAgo: number,
        observed: boolean,
      ): Promise<void> => {
        await pool.query(
          `INSERT INTO alert_send_attempts (alert_id, idempotency_key, attempted_at,
                                            outcome_recorded_at)
           VALUES ($1, $4, current_timestamp - ($2 || ' hours')::interval,
                   CASE WHEN $3 THEN current_timestamp - ($2 || ' hours')::interval END)`,
          [alertId, hoursAgo, observed, alertId],
        );
      };

      /** The same, at millisecond resolution, for the cases that turn on the margin. */
      const recordAttemptMsAgo = async (
        alertId: string,
        msAgo: number,
        idempotencyKey: string = alertId,
      ): Promise<void> => {
        await pool.query(
          `INSERT INTO alert_send_attempts (alert_id, idempotency_key, attempted_at)
           VALUES ($1, $3, current_timestamp - ($2 || ' milliseconds')::interval)`,
          [alertId, msAgo, idempotencyKey],
        );
      };

      it("leaves a crashed send distinguishable from an alert that was never tried", async () => {
        // THE FAILING TEST FOR ISSUE #166. The provider took the message and the process died
        // before the COMMIT, so the alert row rolls back to exactly what it was. Beside it sits an
        // alert nobody has ever tried. Until an attempt was recorded before the handoff, those two
        // rows were identical, and every later decision about them had to be made blind.
        const eventId = await createEvent(scenario("C"));
        expect(await schedulePastDue(eventId, [1])).toBe(1);
        const attempted = (await alertsOf(eventId))[0]?.id ?? "";
        const provider = fakeProvider();

        const doomed = new Pool({ connectionString: databaseUrl });
        const crashing = Object.create(pool) as Pool;
        crashing.query = pool.query.bind(pool) as Pool["query"];
        crashing.connect = (async () => {
          const client = await doomed.connect();
          const query = client.query.bind(client);
          client.query = ((...args: unknown[]) =>
            typeof args[0] === "string" && args[0].includes("UPDATE alerts")
              ? Promise.reject(new Error("connection terminated unexpectedly"))
              : query(...(args as Parameters<typeof query>))) as typeof client.query;
          return client;
        }) as Pool["connect"];

        await createAlertPoller({
          jurisdiction: ruleset.jurisdiction,
          database: crashing,
          senders: provider.senders,
        }).tick();
        await doomed.end();

        // The row is pending and due, which is the entire state that used to be readable — the
        // same state a row the poller has never reached is in.
        const untried = await insertDueAlert(eventId, "untried@example.test", 1);
        const rows = await alertsOf(eventId);
        expect(rows.every((row) => row.status === "pending")).toBe(true);
        expect(provider.delivered).toHaveLength(1);
        // The one that reached the provider says so, and says nobody saw what came of it.
        const recorded = await attemptsOf(attempted);
        expect(recorded).toHaveLength(1);
        expect(recorded[0]?.outcome_recorded_at).toBeNull();
        expect(recorded[0]?.idempotency_key).toBe(
          rows.find((row) => row.id === attempted)?.idempotency_key,
        );
        // The one that did not is not carrying an attempt it never made.
        expect(await attemptsOf(untried)).toHaveLength(0);
      });

      it("records the outcome when the send completes, so the attempt is not left open", async () => {
        const eventId = await createEvent(scenario("C"));
        expect(await schedulePastDue(eventId, [1])).toBe(1);
        const provider = fakeProvider();

        await createAlertPoller({
          database: pool,
          senders: provider.senders,
          jurisdiction: ruleset.jurisdiction,
        }).tick();

        const [alert] = await alertsOf(eventId);
        expect(alert?.status).toBe("sent");
        const recorded = await attemptsOf(alert?.id ?? "");
        expect(recorded).toHaveLength(1);
        expect(recorded[0]?.outcome_recorded_at).not.toBeNull();
      });

      it("sends a pending alert with no recorded attempt however long it has been due", async () => {
        // THE CONSTRAINT ISSUE #166 MEASURED. Suppressing by age alone is the cheap version of
        // this fix and it is the wrong trade: it turns one possible duplicate into systematic
        // non-delivery, for a product whose whole purpose is that a filing deadline does not pass
        // unnoticed. A row nobody ever handed to a provider cannot be a duplicate at any age.
        const eventId = await createEvent(scenario("C"));
        const alertId = await insertDueAlert(eventId, "long-overdue@example.test", 30);
        const provider = fakeProvider();

        await createAlertPoller({
          database: pool,
          senders: provider.senders,
          jurisdiction: ruleset.jurisdiction,
        }).tick();

        expect(provider.delivered.map((message) => message.recipient)).toContain(
          "long-overdue@example.test",
        );
        const { rows } = await pool.query<{ status: string }>(
          "SELECT status FROM alerts WHERE id = $1",
          [alertId],
        );
        expect(rows[0]?.status).toBe("sent");
      });

      it("holds an attempt nobody saw the end of once the provider's dedup window has passed", async () => {
        // Past the window the provider no longer recognises the key, so a retry is a second
        // delivery rather than a deduplicated one. It is neither sent nor forgotten: it stops
        // being claimable and is counted, so a human can reconcile it against the provider.
        const eventId = await createEvent(scenario("C"));
        const alertId = await insertDueAlert(eventId, "unreconciled@example.test", 2);
        await recordAttempt(alertId, PROVIDER_DEDUP_WINDOW_HOURS + 1, false);
        const provider = fakeProvider();

        const summary = await createAlertPoller({
          database: pool,
          senders: provider.senders,
          jurisdiction: ruleset.jurisdiction,
        }).tick();

        expect(provider.attempts.map((message) => message.recipient)).not.toContain(
          "unreconciled@example.test",
        );
        expect(summary.heldForReconciliation).toBeGreaterThanOrEqual(1);
        const { rows } = await pool.query<{ status: string }>(
          "SELECT status FROM alerts WHERE id = $1",
          [alertId],
        );
        expect(rows[0]?.status).toBe("pending");
      });

      it("does not report an obsolete alert's aged attempt as needing a human", async () => {
        // A HOLD IS A CLAIM THAT ONLY A PERSON CAN CLEAR, so it must not be made about a row the
        // product can clear itself. The scan already refuses alerts whose plan the event has been
        // edited past, because regeneration cancels them; the hold count did not, so every tick
        // reported an obsolete row as awaiting a manual reconciliation against the provider. False
        // warnings on a counter whose whole value is that it is rare, with the genuine holds
        // buried among them.
        const eventId = await createEvent(scenario("C"));
        expect(await schedulePastDue(eventId, [reminderOffsets[0] ?? 7])).toBe(1);
        const alertId = (await alertsOf(eventId))[0]?.id ?? "";
        await recordAttempt(alertId, PROVIDER_DEDUP_WINDOW_HOURS + 1, false);
        const poller = createAlertPoller({
          database: pool,
          senders: fakeProvider().senders,
          jurisdiction: ruleset.jurisdiction,
        });
        // While the plan is current the hold is real: nothing but a person can resolve it.
        expect((await poller.tick()).heldForReconciliation).toBe(1);

        // The organizer edits the event. The alert now answers an intake they have moved on from,
        // and regenerating the plan cancels it without anyone asking the provider anything.
        await pool.query(
          "UPDATE events SET revision_counter = revision_counter + 1 WHERE id = $1",
          [eventId],
        );

        expect((await poller.tick()).heldForReconciliation).toBe(0);
      });

      it("keeps retrying an attempt the provider answered, however old that answer is", async () => {
        // The spec's outage edge case: nothing is dropped and the poller keeps trying. An answered
        // attempt is not the ambiguous case — this side knows what happened to it — so age alone
        // must not retire it.
        const eventId = await createEvent(scenario("C"));
        const alertId = await insertDueAlert(eventId, "answered@example.test", 2);
        await recordAttempt(alertId, PROVIDER_DEDUP_WINDOW_HOURS + 1, true);
        const provider = fakeProvider();

        await createAlertPoller({
          database: pool,
          senders: provider.senders,
          jurisdiction: ruleset.jurisdiction,
        }).tick();

        const { rows } = await pool.query<{ status: string }>(
          "SELECT status FROM alerts WHERE id = $1",
          [alertId],
        );
        expect(rows[0]?.status).toBe("sent");
        expect(await attemptsOf(alertId)).toHaveLength(2);
      });

      it("leaves the attempt open when the provider never answered at all", async () => {
        // A timeout is not an answer: the provider may have accepted the message. Retried inside
        // the dedup window like any other failure, and held rather than blind-retried outside it,
        // which is the same rule the crash gets because it is the same uncertainty.
        const eventId = await createEvent(scenario("C"));
        expect(await schedulePastDue(eventId, [1])).toBe(1);
        const provider = fakeProvider();
        const timingOut: AlertSenders = {
          sms: provider.senders.sms,
          email: async () => {
            throw new AlertDeliveryError("email provider did not respond within 10000ms", {
              outcomeObserved: false,
            });
          },
        };

        await createAlertPoller({
          database: pool,
          senders: timingOut,
          jurisdiction: ruleset.jurisdiction,
        }).tick();

        const [alert] = await alertsOf(eventId);
        expect(alert?.status).toBe("failed");
        const recorded = await attemptsOf(alert?.id ?? "");
        expect(recorded).toHaveLength(1);
        expect(recorded[0]?.outcome_recorded_at).toBeNull();
      });

      it("holds a retry that would reach the provider after the window closed mid-claim", async () => {
        // THE CUTOFF IS NOT THE MOMENT THE DECISION IS MADE. Between this predicate and the
        // provider receiving the request there is the event lock, the claim, the expiry query, the
        // attempt-writer's own connection and insert, and then the request itself. An attempt that
        // is inside the window when the claim reads it can be outside it when the message lands,
        // and then the provider deduplicates nothing and the organizer gets the alert twice.
        const eventId = await createEvent(scenario("C"));
        const alertId = await insertDueAlert(eventId, "just-inside@example.test", 2);
        await recordAttemptMsAgo(
          alertId,
          PROVIDER_DEDUP_WINDOW_HOURS * 3_600_000 - DEDUP_WINDOW_CLAIM_MARGIN_MS / 2,
        );
        const provider = fakeProvider();

        const summary = await createAlertPoller({
          database: pool,
          senders: provider.senders,
          jurisdiction: ruleset.jurisdiction,
        }).tick();

        expect(provider.attempts.map((message) => message.recipient)).not.toContain(
          "just-inside@example.test",
        );
        expect(summary.heldForReconciliation).toBeGreaterThanOrEqual(1);
      });

      it("still retries an attempt with the whole margin left before the window closes", async () => {
        // The other side of the same line, so the margin cannot be widened into an age test. Well
        // inside the window a retry is what the provider deduplicates, and withholding it would
        // turn a recoverable lost outcome into a missed filing deadline.
        const eventId = await createEvent(scenario("C"));
        const alertId = await insertDueAlert(eventId, "well-inside@example.test", 2);
        await recordAttemptMsAgo(
          alertId,
          PROVIDER_DEDUP_WINDOW_HOURS * 3_600_000 - DEDUP_WINDOW_CLAIM_MARGIN_MS * 4,
        );
        const provider = fakeProvider();

        await createAlertPoller({
          database: pool,
          senders: provider.senders,
          jurisdiction: ruleset.jurisdiction,
        }).tick();

        expect(provider.attempts.map((message) => message.recipient)).toContain(
          "well-inside@example.test",
        );
        const { rows } = await pool.query<{ status: string }>(
          "SELECT status FROM alerts WHERE id = $1",
          [alertId],
        );
        expect(rows[0]?.status).toBe("sent");
      });

      it("delivers a revived alert instead of holding it on the withdrawn schedule's attempt", async () => {
        // THE HOLD OUTLIVING ITS SCHEDULE, which is the worse failure of the two this predicate
        // can produce. A regeneration cancels an alert whose attempt nobody saw the end of; a
        // later regeneration brings the same row back once that attempt is older than the dedup
        // window. The upsert resets the row to a fresh schedule, but the attempt is scoped to the
        // alert id alone, so the scan and the claim both keep excluding it — and the reappearing
        // deadline is never delivered at all. That is the outcome F-203 exists to prevent, and it
        // is worse than the duplicate the hold was added to avoid.
        const eventId = await createEvent(scenario("C"));
        const contacts = { email: "revived@example.test", phone: null };
        const dated = await insertDuePlan(eventId, { latestApplyDate: dayFromToday(1) });
        const client = await pool.connect();
        try {
          await schedulerWith()(client, eventId, dated.planId, contacts);
          const reminder = (await alertsOf(eventId)).find(
            (row) => row.alert_type === "deadline_reminder",
          );
          // Handed to the provider, outcome never observed, and now old enough that the provider
          // would no longer recognise the key.
          await recordAttemptMsAgo(
            reminder?.id ?? "",
            PROVIDER_DEDUP_WINDOW_HOURS * 3_600_000 + 3_600_000,
            reminder?.idempotency_key,
          );

          // The dated requirement disappears, so its reminders are withdrawn.
          const undated = await insertDuePlan(eventId, {
            latestApplyDate: null,
            reuseChecklistItemId: dated.checklistItemId,
          });
          await schedulerWith()(client, eventId, undated.planId, contacts);
          expect((await alertsOf(eventId)).find((row) => row.id === reminder?.id)?.status).toBe(
            "cancelled",
          );

          // And the deadline comes back.
          const redated = await insertDuePlan(eventId, {
            latestApplyDate: dayFromToday(1),
            reuseChecklistItemId: dated.checklistItemId,
          });
          await schedulerWith()(client, eventId, redated.planId, contacts);
          expect((await alertsOf(eventId)).find((row) => row.id === reminder?.id)?.status).toBe(
            "pending",
          );

          const provider = fakeProvider();
          await createAlertPoller({
            database: pool,
            senders: provider.senders,
            jurisdiction: ruleset.jurisdiction,
          }).tick();

          expect(provider.delivered.map((message) => message.recipient)).toContain(
            "revived@example.test",
          );
          expect((await alertsOf(eventId)).find((row) => row.id === reminder?.id)?.status).toBe(
            "sent",
          );
          // The attempt itself is kept, unresolved as it always was: superseding it says which
          // schedule it belonged to, never that anyone found out what the provider did with it.
          const kept = await attemptsOf(reminder?.id ?? "");
          expect(kept[0]?.outcome_recorded_at).toBeNull();
          expect(kept[0]?.superseded_at).not.toBeNull();
        } finally {
          client.release();
        }
      });

      it("holds the failures an upgrade finds behind no attempt, and only those", async () => {
        // WHAT MIGRATION 014 MEETS WHEN IT IS NOT A CLEAN INSTALL. An alert that failed before
        // this table existed was attempted by code that recorded nothing, so the absence of an
        // attempt row — which every predicate here reads as "never tried, safe to send" — is
        // false of it. Its last attempt may have been the unobserved kind and its key may be far
        // older than the provider's dedup window, which is exactly the pair that makes a retry a
        // second delivery. The migration seeds those rows so the upgrade starts from what is
        // known rather than from the reading that happens to be permissive.
        //
        // THE OTHER TWO ROWS ARE THE SCOPE, and they are here because a seed that took them would
        // be worse than the gap it closes. A legacy PENDING row has no evidence of ever having
        // been attempted, and holding the whole queue on a guess is the systematic non-delivery
        // this feature exists to prevent. A legacy SMS row was rendered in-product by the
        // simulation, which has no provider a duplicate could reach.
        const eventId = await createEvent(scenario("C"));
        const failedEmail = await insertDueAlert(eventId, "legacy-failed@example.test", 30, {
          status: "failed",
        });
        await insertDueAlert(eventId, "legacy-untried@example.test", 30);
        await insertDueAlert(eventId, "+15555550199", 30, { channel: "sms", status: "failed" });

        await seedLegacyAttempts();

        const provider = fakeProvider();
        const summary = await createAlertPoller({
          database: pool,
          senders: provider.senders,
          jurisdiction: ruleset.jurisdiction,
        }).tick();

        expect(provider.attempts.map((message) => message.recipient)).not.toContain(
          "legacy-failed@example.test",
        );
        expect(summary.heldForReconciliation).toBe(1);
        expect(await reconciliationHolds(pool, eventId)).toEqual([
          { channel: "email", heldCount: 1 },
        ]);
        // Seeded unresolved, because nobody did find out what the provider did with it: the row
        // is what a reconciliation reads, not a claim that anything was observed.
        const seeded = await attemptsOf(failedEmail);
        expect(seeded).toHaveLength(1);
        expect(seeded[0]?.outcome_recorded_at).toBeNull();
        expect(provider.delivered.map((message) => message.recipient).sort()).toEqual([
          "+15555550199",
          "legacy-untried@example.test",
        ]);
      });

      it("leaves an upgrade's locally-unconfigured failures out of the backfill", async () => {
        // WHAT THE SEED IS ALLOWED TO ASSUME, and this row breaks the assumption. The backfill
        // reads `failed` as proof that a provider was handed something, which is true of every
        // failure that reached one. It is not true of a database that ran without RESEND_API_KEY
        // or SMTP_FROM: `unconfiguredEmailSender` throws inside this process, so those rows failed
        // without any provider ever seeing the message. Seeding one gives it an unresolved
        // `-infinity` attempt, and the hold predicate then stops it for good — so configuring the
        // credentials later delivers nothing, which is the systematic non-delivery this whole
        // mechanism exists to avoid. The row's own recorded error is the proof, so it is read.
        const eventId = await createEvent(scenario("C"));
        const unconfigured = await insertDueAlert(eventId, "no-credentials@example.test", 30, {
          status: "failed",
          lastError: await unconfiguredEmailSender()({
            recipient: "no-credentials@example.test",
            subject: "",
            body: "",
            idempotencyKey: "",
          }).then(
            () => "",
            (error: Error) => error.message,
          ),
        });
        const reachedAProvider = await insertDueAlert(eventId, "provider@example.test", 30, {
          status: "failed",
          lastError: "email provider did not respond within 10000ms",
        });

        await seedLegacyAttempts();

        expect(await attemptsOf(unconfigured)).toEqual([]);
        expect(await attemptsOf(reachedAProvider)).toHaveLength(1);

        // And the alert goes out the moment credentials exist, rather than being held forever.
        const provider = fakeProvider();
        await createAlertPoller({
          database: pool,
          senders: provider.senders,
          jurisdiction: ruleset.jurisdiction,
        }).tick();

        expect(provider.delivered.map((message) => message.recipient)).toContain(
          "no-credentials@example.test",
        );
      });

      it("records no provider attempt for an email channel with no credentials", async () => {
        // THE LIVE HALF OF THE SAME ROOT CAUSE. `unconfiguredEmailSender` throws without opening a
        // socket, so no provider can be holding this message — but an intent was written before it
        // was called, and a process that dies before the outcome update commits leaves that intent
        // unresolved. It then ages past the dedup window and holds the alert out of every poll, so
        // adding credentials later delivers nothing. A sender that reaches nobody says so, exactly
        // as the SMS simulation does.
        const eventId = await createEvent(scenario("C"));
        const alertId = await insertDueAlert(eventId, "unconfigured@example.test", 2);

        const summary = await createAlertPoller({
          database: pool,
          senders: { email: unconfiguredEmailSender(), sms: fakeProvider().senders.sms },
          jurisdiction: ruleset.jurisdiction,
        }).tick();

        expect(summary.failed).toBe(1);
        expect(await attemptsOf(alertId)).toEqual([]);
      });

      it("records no provider attempt for an SMS the product only simulates", async () => {
        // A LABELLED SIMULATION HAS NO PROVIDER, so it can never have an outcome nobody observed:
        // a crash between the intent and the sending transaction loses nothing a retry could
        // duplicate. Recording an intent for one buys nothing and costs a false hold — the tick
        // warns that a message needs reconciling against a provider, and the checklist tells the
        // organizer their text alerts were handed to a sending service, about a send that never
        // left the process.
        //
        // Decided at the write rather than filtered at the read, so a live SMS sender records
        // intents like any other provider on the day A2P approval lands.
        const eventId = await createEvent(scenario("C"));
        const alertId = await insertDueAlert(eventId, "+12125550100", 2, { channel: "sms" });
        const provider = fakeProvider();

        const summary = await createAlertPoller({
          database: pool,
          senders: provider.senders,
          jurisdiction: ruleset.jurisdiction,
        }).tick();

        expect(summary.sent).toBe(1);
        expect(await attemptsOf(alertId)).toEqual([]);
        expect(summary.heldForReconciliation).toBe(0);
        expect(await reconciliationHolds(pool, eventId)).toEqual([]);
      });
    });

    it("hands the same alert to only one of two concurrent ticks", async () => {
      const eventId = await createEvent(scenario("C"));
      expect(await schedulePastDue(eventId, [1])).toBe(1);
      const provider = fakeProvider();
      const poller = createAlertPoller({
        database: pool,
        senders: provider.senders,
        jurisdiction: ruleset.jurisdiction,
      });

      await Promise.all([poller.tick(), poller.tick()]);

      // One row, one attempt: the loser of the `FOR UPDATE SKIP LOCKED` claim finds nothing.
      expect(provider.attempts).toHaveLength(1);
      expect((await alertsOf(eventId)).every((row) => row.status === "sent")).toBe(true);
    });

    it("serves a fresh alert even when a full batch of dead destinations is due", async () => {
      // The starvation shape: enough permanently-failing alerts to fill the scan on their own,
      // every one of them due earlier than the alert behind them. Ordering by due time alone
      // re-selects exactly this batch on every tick, forever, so the fresh alert is never claimed
      // even while the provider is delivering perfectly well to everyone else.
      const eventId = await createEvent(scenario("C"));
      expect(await schedulePastDue(eventId, [1])).toBe(1);
      // Staged after scheduling, not before: reconciliation cancels anything pending the current
      // plan does not call for, so a backlog written first would be cancelled rather than queued.
      await pool.query(
        `INSERT INTO alerts (id, event_id, alert_type, channel, recipient, idempotency_key,
                             send_at, status, failure_count, payload)
         SELECT gen_random_uuid(), $1::uuid, 'deadline_reminder', 'email', 'dead@example.test',
                -- Every one of them due LONGER ago than the fresh alert above, which is what puts
                -- them all ahead of it under a due-time ordering.
                $2::text || ':starve:' || n, current_timestamp - ((n + 2) || ' days')::interval,
                'failed', 1, '{"subject":"queued","body":"queued"}'::jsonb
           FROM generate_series(1, 100) AS n`,
        [eventId, eventId],
      );
      const provider = fakeProvider();
      provider.failFor = "dead@example.test";

      await createAlertPoller({
        database: pool,
        senders: provider.senders,
        jurisdiction: ruleset.jurisdiction,
      }).tick();

      const fresh = (await alertsOf(eventId)).filter(
        (row) => row.recipient === "organizer@example.test",
      );
      expect(fresh).toHaveLength(1);
      expect(fresh[0]?.status).toBe("sent");
    });

    it("sends across events concurrently instead of serialising the whole batch", async () => {
      // A per-request timeout bounds one send. It does not bound a batch: due alerts at ten
      // seconds each add up in a row while everything behind them misses AC 2's two-minute bound,
      // and the poller looks busy rather than broken.
      const events = await Promise.all(
        Array.from({ length: 6 }, async () => {
          const eventId = await createEvent(scenario("C"));
          await schedulePastDue(eventId, [1]);
          return eventId;
        }),
      );
      const provider = fakeProvider();
      let inFlight = 0;
      let peakInFlight = 0;
      provider.beforeSend = async () => {
        inFlight += 1;
        peakInFlight = Math.max(peakInFlight, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 80));
        inFlight -= 1;
      };

      const startedAt = Date.now();
      const summary = await createAlertPoller({
        database: pool,
        senders: provider.senders,
        jurisdiction: ruleset.jurisdiction,
      }).tick();
      const elapsed = Date.now() - startedAt;

      expect(summary.sent).toBe(events.length);
      expect(peakInFlight).toBe(events.length);
      // Six sends of 80ms are 480ms in a row and one wave otherwise.
      expect(elapsed).toBeLessThan(400);
    });

    it("sends one event's own alerts in parallel, not behind each other", async () => {
      // One checklist can have several reminders due at once — four dated items across two
      // channels is eight slots. While ownership of the event was taken exclusively, they queued
      // behind each other however idle the other workers were, and at a timing-out provider that
      // is minutes for a single organizer. Ownership is event-scoped; delivery is not.
      const eventId = await createEvent(scenario("C"));
      expect(await schedulePastDue(eventId, [7, 6, 5, 4, 3, 2])).toBe(6);
      const provider = fakeProvider();
      let inFlight = 0;
      let peakInFlight = 0;
      provider.beforeSend = async () => {
        inFlight += 1;
        peakInFlight = Math.max(peakInFlight, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 80));
        inFlight -= 1;
      };

      const startedAt = Date.now();
      const summary = await createAlertPoller({
        database: pool,
        senders: provider.senders,
        jurisdiction: ruleset.jurisdiction,
      }).tick();
      const elapsed = Date.now() - startedAt;

      expect(summary.sent).toBe(6);
      expect(peakInFlight).toBe(6);
      // Six sends of 80ms are 480ms one after another and one wave otherwise.
      expect(elapsed).toBeLessThan(400);
    });

    it("stops claiming once the tick budget is spent, and leaves the rest due", async () => {
      const eventId = await createEvent(scenario("C"));
      await schedulePastDue(eventId, [7, 6, 5, 4, 3, 2, 1, 14]);
      const provider = fakeProvider();
      // A clock that reports the budget spent once the first wave has been claimed, so the bound
      // is exercised without spending thirty real seconds on it.
      let reads = 0;
      const clock = (): number => {
        reads += 1;
        return reads <= 5 ? 0 : 30_000;
      };

      const summary = await createAlertPoller({
        jurisdiction: ruleset.jurisdiction,
        database: pool,
        senders: provider.senders,
        clock,
      }).tick();

      expect(summary.abandoned).toBeGreaterThan(0);
      expect(summary.sent + summary.abandoned).toBe(8);
      // Abandoned means untouched, not failed: the rows never left the queue, so they are still
      // due and carry no attempt against them.
      const untouched = (await alertsOf(eventId)).filter((row) => row.status === "pending");
      expect(untouched).toHaveLength(summary.abandoned);
      expect(untouched.every((row) => row.failure_count === 0)).toBe(true);
    });

    it("records sent_at when the provider finished, not when the transaction opened", async () => {
      const eventId = await createEvent(scenario("C"));
      await schedulePastDue(eventId, [1]);
      const provider = fakeProvider();
      provider.beforeSend = () => new Promise((resolve) => setTimeout(resolve, 300));
      const { rows } = await pool.query<{ now: Date }>("SELECT clock_timestamp() AS now");
      const beforeTick = rows[0]?.now as Date;

      await createAlertPoller({
        database: pool,
        senders: provider.senders,
        jurisdiction: ruleset.jurisdiction,
      }).tick();

      const alert = (await alertsOf(eventId))[0];
      // `current_timestamp` is the transaction's start, which is before the send; the row would be
      // audited as delivered 300ms earlier than it was, and that gap is exactly what a check of
      // AC 2's two-minute bound measures.
      expect((alert?.sent_at as Date).getTime() - beforeTick.getTime()).toBeGreaterThanOrEqual(250);
    });

    it("stops a dead backlog consuming every scan, so a later alert is served at once", async () => {
      // The reviewer's case. A backlog of dead destinations kept its original `send_at`, so it
      // stayed due forever and was re-attempted on every scan; at ten seconds a send it filled
      // each one, and an alert that became due behind it waited scan after scan. `failure_count`
      // ordering ranks rows WITHIN a scan and cannot remove them from it — that is what the retry
      // time does.
      const dead = await createEvent(scenario("C"));
      await schedulePastDue(dead, [7, 6, 5, 4]);
      const provider = fakeProvider();
      provider.failFor = "organizer@example.test";
      const poller = createAlertPoller({
        database: pool,
        senders: provider.senders,
        jurisdiction: ruleset.jurisdiction,
      });

      // Two passes: the first attempt, then the immediate retry a blip deserves.
      await poller.tick();
      await poller.tick();
      expect((await alertsOf(dead)).every((row) => row.failure_count === 2)).toBe(true);
      const attemptsOnBacklog = provider.attempts.length;

      // A deliverable alert arrives afterwards, on another event.
      const live = await createEvent(scenario("C"));
      await schedulePastDue(live, [1]);
      provider.failFor = "nobody@example.test";

      await poller.tick();

      // Sent on the very next scan: the dead rows are backed off and no longer in the batch.
      expect((await alertsOf(live)).every((row) => row.status === "sent")).toBe(true);
      expect(provider.attempts.length).toBe(attemptsOnBacklog + 1);
      // And nothing was lost — the backlog is still there, still failed, still counted.
      expect((await alertsOf(dead)).every((row) => row.status === "failed")).toBe(true);
    });

    it("leaves an alert that is not due yet alone", async () => {
      const eventId = await createEvent(scenario("C"));
      await materialize(eventId);
      const provider = fakeProvider();

      await createAlertPoller({
        database: pool,
        senders: provider.senders,
        jurisdiction: ruleset.jurisdiction,
      }).tick();

      expect(provider.attempts).toHaveLength(0);
      expect((await alertsOf(eventId)).every((row) => row.status === "pending")).toBe(true);
    });

    it("keeps draining without waiting out the interval when a tick left work behind", async () => {
      // The budget bounds ONE tick. Waiting the full interval after a tick that ran out of budget
      // would turn that into a bound on throughput, which is how a large due set misses AC 2's
      // two-minute delivery bound by design rather than by failure. The interval is how often to
      // look when there is nothing to do, not how fast work may be done when there is.
      const eventId = await createEvent(scenario("C"));
      expect(await schedulePastDue(eventId, [7, 6, 5, 4, 3, 2])).toBe(6);
      const provider = fakeProvider();
      provider.beforeSend = () => new Promise((resolve) => setTimeout(resolve, 30));
      // A clock running 200x fast, so the 30-second budget expires a few sends into every tick and
      // the test still finishes in well under a second. Real durations, accelerated readings.
      const base = Date.now();
      const clock = (): number => (Date.now() - base) * 200;
      const poller = createAlertPoller({
        jurisdiction: ruleset.jurisdiction,
        database: pool,
        senders: provider.senders,
        // Far longer than this test will wait: anything delivered after the first tick proves the
        // drain re-ran on its own rather than on the timer.
        intervalMs: 60_000,
        clock,
      });

      poller.start();
      await new Promise((resolve) => setTimeout(resolve, 700));
      poller.stop();

      const rows = await alertsOf(eventId);
      expect(rows).toHaveLength(6);
      expect(rows.every((row) => row.status === "sent")).toBe(true);
    });

    it("keeps ticking on a schedule and can be stopped", async () => {
      const eventId = await createEvent(scenario("C"));
      await schedulePastDue(eventId);
      const provider = fakeProvider();
      const poller = createAlertPoller({
        jurisdiction: ruleset.jurisdiction,
        database: pool,
        senders: provider.senders,
        intervalMs: 5,
      });

      poller.start();
      poller.start(); // idempotent: a second start must not run two timers
      await new Promise((resolve) => setTimeout(resolve, 100));
      poller.stop();
      poller.stop();

      expect(provider.delivered).toHaveLength(2);
      expect((await alertsOf(eventId)).every((row) => row.status === "sent")).toBe(true);
    });
  });

  describe("AC 7 — regeneration recomputes pending alerts and never re-sends a sent one", () => {
    it("cancels what the new plan no longer calls for, keeps what it still does, and leaves sent alerts alone", async () => {
      const eventId = await createEvent(scenario("C"));
      await materialize(eventId);
      const before = await alertsOf(eventId);
      // A reminder that has already gone out. Its filing date is about to move, so the recomputed
      // set will not contain it — which is exactly the row AC 7 says must not be touched.
      const sentAlready = before.find((row) => row.alert_type === "deadline_reminder");
      await pool.query(
        "UPDATE alerts SET status = 'sent', sent_at = current_timestamp WHERE id = $1",
        [sentAlready?.id],
      );

      // The organizer moves the event, so every filing date moves with it.
      const patch = await request(appWith(fakeProvider()))
        .patch(`/api/events/${eventId}`)
        .send({ event_date: "2026-10-16" });
      expect(patch.status).toBe(200);
      const response = await materialize(eventId);
      expect(response.status).toBe(200);

      const after = await alertsOf(eventId);
      const byKey = new Map(after.map((row) => [row.idempotency_key, row]));
      // The alert that already went out is untouched: still sent, never re-sent, never cancelled.
      expect(byKey.get(sentAlready?.idempotency_key ?? "")?.status).toBe("sent");
      // AND IT IS NOT REPLACED. Under the previous identity the moved date minted a new key, so a
      // fresh row went out to the same address for the same offset. A reminder is identified by its
      // requirement and its offset now, so the moved date updates the rows that already exist and
      // the sent one keeps its slot.
      expect(after.filter((row) => row.alert_type === "deadline_reminder")).toHaveLength(
        before.filter((row) => row.alert_type === "deadline_reminder").length,
      );
      // The three unsent reminders of the old timeline are MOVED rather than cancelled and
      // recreated: same row, same key, new day and new copy.
      const oldReminders = before.filter(
        (row) => row.alert_type === "deadline_reminder" && row.id !== sentAlready?.id,
      );
      expect(oldReminders).toHaveLength(3);
      for (const row of oldReminders) {
        const moved = byKey.get(row.idempotency_key);
        expect(moved?.status).toBe("pending");
        expect(moved?.id).toBe(row.id);
        expect(moved?.send_at.getTime()).not.toBe(row.send_at.getTime());
      }
      // The dependency unlock is unmoved and untouched: it is dated from the plan's clock and the
      // upstream processing range, neither of which the event date changed.
      const unlock = before.find((row) => row.alert_type === "dependency_unlocked");
      expect(byKey.get(unlock?.idempotency_key ?? "")?.status).toBe("pending");
      // Three moved reminders plus the unmoved unlock. The fourth reminder is the sent one, which
      // stays sent and is not replaced.
      expect(after.filter((row) => row.status === "pending")).toHaveLength(4);
      // Nothing new was scheduled and nothing was cancelled, because the recomputed set is the
      // same set of alerts on different days.
      expect(response.body.alerts).toMatchObject({ scheduled: 0, cancelled: 0 });
    });

    it("does not remind twice when the filing date moves", async () => {
      // AC 7 as this PR amended it and the product owner approved it: a re-send is legitimate when
      // the DESTINATION differs, not when the attempt does. A moved filing date is not a different
      // destination. With the send day in the identity it minted a new key, the already-sent
      // reminder was correctly left alone, and a fresh row went out to the same address for the
      // same offset. Same ruling the product owner made for the slack warning in round 15.
      const eventId = await createEvent(scenario("C"));
      const contacts = { email: "organizer@example.test", phone: null };
      const first = await insertDuePlan(eventId, { latestApplyDate: dayFromToday(30) });
      const client = await pool.connect();
      try {
        await schedulerWith()(client, eventId, first.planId, contacts);
        const scheduled = await alertsOf(eventId);
        // The seven-day reminder has gone out.
        const sentAlready = scheduled.find(
          (row) => row.send_at.toISOString().slice(0, 10) === dayFromToday(23),
        );
        expect(sentAlready).toBeDefined();
        await pool.query(
          "UPDATE alerts SET status = 'sent', sent_at = clock_timestamp() WHERE id = $1",
          [sentAlready?.id],
        );

        // The organizer moves the event out, so every filing date moves with it.
        const second = await insertDuePlan(eventId, {
          latestApplyDate: dayFromToday(45),
          reuseChecklistItemId: first.checklistItemId,
        });
        await schedulerWith()(client, eventId, second.planId, contacts);

        const after = await alertsOf(eventId);
        // The sent reminder keeps its slot and is not replaced: one row for that offset, still sent.
        const sameOffset = after.filter(
          (row) => row.idempotency_key === sentAlready?.idempotency_key,
        );
        expect(sameOffset).toHaveLength(1);
        expect(sameOffset[0]?.status).toBe("sent");
        // And no second reminder was minted for it. The one-day reminder is the only pending one.
        expect(after.filter((row) => row.status === "pending")).toHaveLength(1);
      } finally {
        client.release();
      }
    });

    it("does not suppress a new reminder that lands on a sent reminder's day", async () => {
      // The published offsets are 7 and 1, so a filing date that moves by exactly six days puts
      // the NEW seven-day reminder on the day the OLD one-day reminder already occupies. Keyed on
      // the send day alone they are the same alert, and since a sent row is correctly left
      // immutable, the reminder carrying the corrected filing date was dropped in silence.
      const eventId = await createEvent(scenario("C"));
      const contacts = { email: "organizer@example.test", phone: null };
      const first = await insertDuePlan(eventId, { latestApplyDate: dayFromToday(30) });
      const client = await pool.connect();
      try {
        await schedulerWith()(client, eventId, first.planId, contacts);
        const collisionDay = dayFromToday(29);
        const sentAlready = (await alertsOf(eventId)).find(
          (row) => row.send_at.toISOString().slice(0, 10) === collisionDay,
        );
        expect(sentAlready).toBeDefined();
        await pool.query(
          "UPDATE alerts SET status = 'sent', sent_at = clock_timestamp() WHERE id = $1",
          [sentAlready?.id],
        );

        // The organizer moves the event out by six days, so every filing date moves with it.
        // Same task, new plan — the regeneration shape, and the only one where two plans' alerts
        // can share a key at all.
        const second = await insertDuePlan(eventId, {
          latestApplyDate: dayFromToday(36),
          reuseChecklistItemId: first.checklistItemId,
        });
        await schedulerWith()(client, eventId, second.planId, contacts);

        const onCollisionDay = (await alertsOf(eventId)).filter(
          (row) => row.send_at.toISOString().slice(0, 10) === collisionDay,
        );
        expect(onCollisionDay).toHaveLength(2);
        expect(onCollisionDay.filter((row) => row.status === "sent")).toHaveLength(1);
        const fresh = onCollisionDay.find((row) => row.status === "pending");
        // The point of the new reminder: it carries the corrected filing date.
        expect(fresh?.payload.body).toContain(`file by ${dayFromToday(36)}`);
      } finally {
        client.release();
      }
    });

    it("re-reviewing the same plan schedules nothing new and cancels nothing", async () => {
      const eventId = await createEvent(scenario("C"));
      await materialize(eventId);
      const first = await alertsOf(eventId);

      const second = await materialize(eventId);

      expect(second.body.alerts).toMatchObject({ scheduled: 0, cancelled: 0 });
      expect(await alertsOf(eventId)).toHaveLength(first.length);
    });

    it("keeps using the contact already on file when a later review supplies none", async () => {
      const eventId = await createEvent(scenario("C"));
      await materialize(eventId, { contactEmail: "organizer@example.test" });

      const second = await materialize(eventId, {});

      expect(second.body.alerts.channels).toEqual(["email"]);
      expect(
        (await alertsOf(eventId)).every((row) => row.recipient === "organizer@example.test"),
      ).toBe(true);
    });

    it("keeps a contact entered against a plan that scheduled nothing", async () => {
      // Scenario B's only dated finding cannot be dated at all, so the first checklist schedules
      // no alerts. With the contact living on the alert rows there was nowhere to put it, and a
      // later rescope that DID produce a dated requirement resolved no channel and silently
      // scheduled nothing — for an organizer who had entered their address.
      const eventId = await createEvent(scenario("B"));
      const first = await materialize(eventId, { contactEmail: "organizer@example.test" });
      expect(first.body.alerts.scheduled).toBe(0);
      expect(await alertsOf(eventId)).toEqual([]);

      // The contact survives the fact that nothing was written to send.
      expect(first.body.alertContacts).toEqual({ email: "organizer@example.test", phone: null });
      const planId = (await insertDuePlan(eventId, { latestApplyDate: dayFromToday(30) })).planId;
      const client = await pool.connect();
      try {
        // A later review that re-states nothing about contacts still finds one.
        const summary = await schedulerWith()(client, eventId, planId, {});
        expect(summary.channels).toEqual(["email"]);
        expect(summary.scheduled).toBeGreaterThan(0);
      } finally {
        client.release();
      }
      expect(
        (await alertsOf(eventId)).every((row) => row.recipient === "organizer@example.test"),
      ).toBe(true);
    });

    it("never treats a test send's destination as the organizer's address", async () => {
      // The demo utility takes a recipient for one message. Reading contacts back off the alert
      // log made that tester's address the event's, and every real deadline alert went there.
      const eventId = await createEvent(scenario("C"));
      const provider = fakeProvider();
      await request(appWith(provider))
        .post(`/api/events/${eventId}/alerts/test`)
        .send({ channel: "email", recipient: "tester@example.test" });

      const response = await materialize(eventId, {});

      expect(response.body.alertContacts).toEqual({ email: null, phone: null });
      expect(response.body.alerts).toMatchObject({ scheduled: 0, channels: [] });
    });

    it("gives a corrected address a clean start rather than the old one's punishment", async () => {
      // The other half of making a contact correctable. The row keeps its identity across a
      // recipient change, so the failure evidence carried over — and that evidence was about an
      // address that is no longer there. The corrected destination was ordered behind fresh
      // alerts, and its FIRST failure read the retained count and jumped straight to the maximum
      // backoff.
      const eventId = await createEvent(scenario("C"));
      await materialize(eventId, { contactEmail: "typo@example.test" });
      const before = await alertsOf(eventId);
      expect(before.length).toBeGreaterThan(0);
      // Three attempts against the typo, which is enough to reach the longest backoff step.
      await pool.query(
        `UPDATE alerts SET status = 'failed', failure_count = 3,
                           next_attempt_at = clock_timestamp() + interval '15 minutes'
          WHERE event_id = $1`,
        [eventId],
      );

      await materialize(eventId, { contactEmail: "organizer@example.test" });

      // Round 11 changed HOW this holds and not WHETHER it does. The destination is part of the
      // row key now, so the corrected address does not inherit a row at all — it gets its own,
      // which starts at zero with no backoff by definition. The assertion is scoped to those rows
      // because the superseded ones are still here on purpose, cancelled and carrying their
      // evidence, which is the audit fact the test below this one covers.
      const corrected = (await alertsOf(eventId)).filter(
        (row) => row.recipient === "organizer@example.test",
      );
      expect(corrected.length).toBeGreaterThan(0);
      // Ordered as fresh: `ORDER BY failure_count, send_at, id` puts a non-zero count behind every
      // untried alert, so a corrected address would have queued behind them.
      expect(corrected.every((row) => row.failure_count === 0)).toBe(true);
      // And eligible now, rather than serving out a backoff the old address earned.
      expect(corrected.every((row) => row.next_attempt_at === null)).toBe(true);
      expect(corrected.every((row) => row.status === "pending")).toBe(true);
    });

    it("treats a domain case change as the same destination", async () => {
      // The domain is case-insensitive by RFC, so these reach the same mailbox. Stored as typed
      // they hashed differently, so the reconciler saw a different destination, inserted new
      // pending rows and sent the same reminders again — which AC 7 permits only for a genuinely
      // different destination, and a case change is not one.
      const eventId = await createEvent(scenario("C"));
      await materialize(eventId, { contactEmail: "person@example.test" });
      const before = await alertsOf(eventId);
      expect(before.length).toBeGreaterThan(0);
      await pool.query(
        "UPDATE alerts SET status = 'sent', sent_at = clock_timestamp() WHERE event_id = $1",
        [eventId],
      );

      await materialize(eventId, { contactEmail: "person@EXAMPLE.TEST" });

      const after = await alertsOf(eventId);
      // Same rows, still sent. No second delivery to the same mailbox.
      expect(after).toHaveLength(before.length);
      expect(after.every((row) => row.status === "sent")).toBe(true);
      // Stored canonically, so every later comparison agrees with this one.
      expect(after.every((row) => row.recipient === "person@example.test")).toBe(true);
    });

    it("keeps a local-part case change as a different destination", async () => {
      // The other half, and the reason this canonicalises the domain ONLY. The local part is
      // case-sensitive by RFC 5321, so folding it could send one organizer's filing deadlines to
      // another mailbox. Over-normalising an address is its own defect and a worse one.
      const eventId = await createEvent(scenario("C"));
      await materialize(eventId, { contactEmail: "person@example.test" });
      const before = await alertsOf(eventId);

      await materialize(eventId, { contactEmail: "Person@example.test" });

      const after = await alertsOf(eventId);
      expect(after.some((row) => row.recipient === "Person@example.test")).toBe(true);
      expect(after.length).toBeGreaterThan(before.length);
    });

    it("accepts an address the organizer pasted with surrounding whitespace", async () => {
      // The regex forbids whitespace and ran before the trimming canonicalEmail documents, and the
      // checklist submits with a click handler rather than a native form, so the browser never
      // caught it either. A pasted address with a trailing space failed the whole review with a 400
      // and took every email reminder for the event with it.
      const eventId = await createEvent(scenario("C"));

      const response = await materialize(eventId, { contactEmail: " organizer@example.test " });

      // Not rejected: the first conversion answers 201, and the defect was a 400 here.
      expect(response.status).toBeLessThan(300);
      const rows = await alertsOf(eventId);
      expect(rows.length).toBeGreaterThan(0);
      // Stored as validated, so nothing downstream sees a form the check did not accept.
      expect(rows.every((row) => row.recipient === "organizer@example.test")).toBe(true);
    });

    it("treats a reformatted phone number as the same destination", async () => {
      // The asymmetry was on one line: the email went through a canonical form and the number
      // beside it did not, so two spellings of one number hashed as two destinations. Under AC 7's
      // destination rule that minted a replacement set and left the sent rows intact, so every
      // already-due SMS rendered again and would deliver again once live SMS is on.
      const eventId = await createEvent(scenario("C"));
      await materialize(eventId, { contactPhone: "+12125550100" });
      const before = await alertsOf(eventId);
      expect(before.some((row) => row.channel === "sms")).toBe(true);
      await pool.query(
        "UPDATE alerts SET status = 'sent', sent_at = clock_timestamp() WHERE event_id = $1",
        [eventId],
      );

      // The same number, retyped the way a person writes one.
      await materialize(eventId, { contactPhone: "+1 (212) 555-0100" });

      const after = await alertsOf(eventId);
      // No replacement set: same rows, still sent, nothing re-rendered.
      expect(after).toHaveLength(before.length);
      expect(after.every((row) => row.status === "sent")).toBe(true);
      // Stored canonically, so every later comparison agrees with this one.
      expect(
        after
          .filter((row) => row.channel === "sms")
          .every((row) => row.recipient === "12125550100"),
      ).toBe(true);
    });

    it("keeps the evidence when a review changes nothing about the destination", async () => {
      // The mirror of the same rule, and the reason the reset is conditional rather than blanket.
      // This upsert runs on EVERY checklist review, so clearing unconditionally would let an
      // organizer wipe a genuinely dead address's backoff simply by pressing review, putting it
      // back at the head of the batch — the monopolisation migration 010 exists to stop.
      const eventId = await createEvent(scenario("C"));
      await materialize(eventId, { contactEmail: "dead@example.test" });
      await pool.query(
        `UPDATE alerts SET status = 'failed', failure_count = 3,
                           next_attempt_at = clock_timestamp() + interval '15 minutes'
          WHERE event_id = $1`,
        [eventId],
      );

      // Same address, reviewed again.
      await materialize(eventId, { contactEmail: "dead@example.test" });

      const after = await alertsOf(eventId);
      expect(after.every((row) => row.failure_count === 3)).toBe(true);
      expect(after.every((row) => row.next_attempt_at !== null)).toBe(true);
    });

    it("applies a corrected address to alerts that have not gone out", async () => {
      const eventId = await createEvent(scenario("C"));
      await materialize(eventId, { contactEmail: "typo@example.test" });
      // One row has already gone, and one has already failed against the bad address.
      const before = await alertsOf(eventId);
      await pool.query(
        "UPDATE alerts SET status = 'sent', sent_at = clock_timestamp() WHERE id = $1",
        [before[0]?.id],
      );
      await pool.query("UPDATE alerts SET status = 'failed', failure_count = 1 WHERE id = $1", [
        before[1]?.id,
      ]);

      await materialize(eventId, { contactEmail: "organizer@example.test" });

      const rows = await alertsOf(eventId);
      const after = new Map(rows.map((row) => [row.id, row]));
      // The sent row is the record of where a message actually went, and does not move.
      expect(after.get(before[0]?.id ?? "")?.recipient).toBe("typo@example.test");
      // Round 11: the correction reaches the same alerts, by superseding them rather than by
      // rewriting them. Every row that was still to go is now cancelled and still says where it
      // was addressed, and the same alerts exist again against the corrected address.
      for (const row of before.slice(1)) {
        expect(after.get(row.id)?.recipient).toBe("typo@example.test");
        expect(after.get(row.id)?.status).toBe("cancelled");
      }
      const queued = rows.filter((row) => row.status === "pending");
      expect(queued.every((row) => row.recipient === "organizer@example.test")).toBe(true);
      // INCLUDING THE ONE THAT WAS ALREADY SENT, which is the consequence worth stating out loud
      // rather than discovering. AC 7 says a sent alert is never re-sent, and with the destination
      // in the key that reads as never re-sent TO THE SAME DESTINATION. A reminder that went to a
      // typo did not reach the organizer, and refusing to deliver it to the address they just
      // corrected would mean a correction can never repair anything already attempted — in a
      // feature whose whole purpose is that a filing deadline does not pass unnoticed. The sent row
      // itself is still immutable, and the same message can still never go twice to one address.
      expect(queued.length).toBe(before.length);
    });

    it("never rewrites where an attempt was already made", async () => {
      // THE AUDIT FACT A WHOLE TABLE EXISTS TO PROTECT. `event_alert_contacts` was justified on
      // the distinction between where this event's alerts GO — per-event, correctable — and where
      // one MESSAGE went — per-row, immutable. The upsert then rewrote `recipient` in place, which
      // is that argument's own sentence pointing the other way.
      //
      // The damage is worst exactly where the row is least sure of itself: Resend accepts a
      // request, the api times out before it sees the response, the row is marked failed although
      // a message may have reached the old address. Rewriting the recipient there leaves the only
      // record of that attempt naming an address it was never sent to.
      const eventId = await createEvent(scenario("C"));
      await materialize(eventId, { contactEmail: "typo@example.test" });
      const attempted = (await alertsOf(eventId))[0];
      await pool.query(
        `UPDATE alerts SET status = 'failed', failure_count = 1,
                           payload = payload || '{"last_error":"provider timed out"}'::jsonb
          WHERE id = $1`,
        [attempted?.id],
      );

      await materialize(eventId, { contactEmail: "organizer@example.test" });

      const rows = new Map((await alertsOf(eventId)).map((row) => [row.id, row]));
      const preserved = rows.get(attempted?.id ?? "");
      // Where the attempt went, what it cost, and why it failed: all still true afterwards.
      expect(preserved?.recipient).toBe("typo@example.test");
      expect(preserved?.failure_count).toBe(1);
      expect(preserved?.payload.last_error).toBe("provider timed out");
      // And it stops retrying, because nobody intends to send it any more. Cancelled is the word
      // this file already uses for that, rather than a new state for the same fact.
      expect(preserved?.status).toBe("cancelled");
    });

    it("gives the provider a new identity when the address is corrected", async () => {
      // THE LAST LAYER THE CORRECTION COULD STILL BE DEFEATED AT, and the only one outside this
      // database. Round 7 made the contact correctable, round 9 stopped the corrected address
      // inheriting the old one's failures, and the request still reached Resend under the key of
      // the message it replaced — so the provider was entitled to answer with its stored result
      // for the original, or to reject the altered one. The corrected address received nothing.
      //
      // The window is reproduced exactly as reported: the provider ACCEPTS and records the key,
      // the api never sees the response and marks the row failed. The fake dedupes on the key the
      // way Resend does, which is what makes this test able to fail at all.
      const eventId = await createEvent(scenario("C"));
      const { planId } = await insertDuePlan(eventId);
      const scheduleTo = async (email: string) => {
        const client = await pool.connect();
        try {
          await schedulerWith()(client, eventId, planId, { email, phone: null });
        } finally {
          client.release();
        }
      };
      await scheduleTo("typo@example.test");
      const provider = fakeProvider();
      const poller = createAlertPoller({
        database: pool,
        senders: provider.senders,
        jurisdiction: ruleset.jurisdiction,
      });

      await poller.tick();
      expect(provider.delivered.some((sent) => sent.recipient === "typo@example.test")).toBe(true);

      // The api timed out after the provider accepted: the mark-sent is lost, the key is not.
      await pool.query(
        `UPDATE alerts SET status = 'failed', sent_at = NULL, failure_count = 1,
                           next_attempt_at = NULL
          WHERE event_id = $1`,
        [eventId],
      );

      await scheduleTo("organizer@example.test");
      await poller.tick();

      // Reusing the key, the fake deduplicates this away and nothing reaches the new address —
      // which is precisely what the organizer would have experienced.
      expect(provider.delivered.some((sent) => sent.recipient === "organizer@example.test")).toBe(
        true,
      );
    });

    it("keeps one identity across retries to an unchanged address", async () => {
      // The half that must NOT change, and the reason the new key is derived rather than random.
      // AC 2's crash requirement rests on the provider seeing the same key twice and delivering
      // once; a key that rotated on every attempt would turn every lost mark-sent into a second
      // message. This passes before the change as well as after — it is here to catch a fix that
      // over-rotates, not as evidence for the one above.
      const eventId = await createEvent(scenario("C"));
      await schedulePastDue(eventId, [reminderOffsets[0] ?? 7]);
      const provider = fakeProvider();
      provider.fail = "email provider unreachable: ECONNREFUSED";
      const poller = createAlertPoller({
        database: pool,
        senders: provider.senders,
        jurisdiction: ruleset.jurisdiction,
      });

      await poller.tick();
      await poller.tick();

      const keys = new Set(provider.attempts.map((attempt) => attempt.idempotencyKey));
      expect(provider.attempts.length).toBeGreaterThan(1);
      expect(keys.size).toBe(1);
    });

    it("keeps warning about a failed channel when a review changes nothing", async () => {
      // Round 9's consequence, and it landed on the one surface an organizer actually reads.
      // Retaining failure_count and next_attempt_at while flipping the status to pending told
      // `failedDeliveries` there was nothing to report — no new attempt had been made, the same
      // dead address was still in backoff, and the warning disappeared because the row stopped
      // using the word for what it knew.
      const eventId = await createEvent(scenario("C"));
      await materialize(eventId, { contactEmail: "dead@example.test" });
      await pool.query(
        `UPDATE alerts SET status = 'failed', failure_count = 2,
                           next_attempt_at = clock_timestamp() + interval '15 minutes'
          WHERE event_id = $1`,
        [eventId],
      );
      const warned = await failedDeliveries(pool, eventId);
      expect(warned).toHaveLength(1);

      // Save pressed, nothing changed.
      await materialize(eventId, { contactEmail: "dead@example.test" });

      expect(await failedDeliveries(pool, eventId)).toEqual(warned);
    });

    it("stops warning once the address itself is corrected", async () => {
      // The mirror, and what keeps the status honest in the other direction: a fresh destination
      // has no attempts against it, so there is no failure to report. Same rule as the count and
      // the backoff, applied to the word.
      const eventId = await createEvent(scenario("C"));
      await materialize(eventId, { contactEmail: "typo@example.test" });
      await pool.query(
        `UPDATE alerts SET status = 'failed', failure_count = 2 WHERE event_id = $1`,
        [eventId],
      );
      expect(await failedDeliveries(pool, eventId)).toHaveLength(1);

      await materialize(eventId, { contactEmail: "organizer@example.test" });

      expect(await failedDeliveries(pool, eventId)).toEqual([]);
    });

    it("does not unlock a window whose filing deadline has already passed", async () => {
      // Materializing an older plan: the reminder guard correctly skips a filing date behind us,
      // and this scheduled the unlock anyway. The poller then sent "You can now pursue" about a
      // window the same plan reports as missed, so the notification contradicted the checklist on
      // one requirement and the notification was the surface that was wrong.
      const eventId = await createEvent(scenario("C"));
      const { planId } = await insertDuePlan(eventId, {
        latestApplyDate: dayFromToday(-3),
        applyAfterDate: dayFromToday(-10),
      });
      const client = await pool.connect();
      try {
        await schedulerWith()(client, eventId, planId, {
          email: "organizer@example.test",
          phone: null,
        });
      } finally {
        client.release();
      }

      const rows = await alertsOf(eventId);
      expect(rows.some((row) => row.alert_type === "dependency_unlocked")).toBe(false);
    });

    it("still unlocks a gated item that has no filing deadline at all", async () => {
      // The criterion this pins is the one most likely to be "fixed" by someone reading the guard
      // above. A null latest_apply_date is not an expired one: the pinned holiday list is
      // deliberately unpublished, so null is the NORMAL state for every business_days_minimum
      // finding, and reading it as expired would suppress unlocks across most of the live ruleset
      // while looking like correctness.
      const eventId = await createEvent(scenario("C"));
      const { planId } = await insertDuePlan(eventId, {
        latestApplyDate: null,
        applyAfterDate: dayFromToday(3),
      });
      const client = await pool.connect();
      try {
        await schedulerWith()(client, eventId, planId, {
          email: "organizer@example.test",
          phone: null,
        });
      } finally {
        client.release();
      }

      const rows = await alertsOf(eventId);
      expect(rows.some((row) => row.alert_type === "dependency_unlocked")).toBe(true);
      // And no reminder, because there is no filing date to count back from. Nothing is invented.
      expect(rows.some((row) => row.alert_type === "deadline_reminder")).toBe(false);
    });

    it("still unlocks while the filing deadline is ahead", async () => {
      // The guard is about a date that has gone, not about a gate that opened in the past: an
      // organizer converting a plan a week late is exactly who the unlock is for, as long as they
      // can still file. Here to stop the fix above being written as "no past apply_after_date".
      const eventId = await createEvent(scenario("C"));
      const { planId } = await insertDuePlan(eventId, {
        latestApplyDate: dayFromToday(7),
        applyAfterDate: dayFromToday(-10),
      });
      const client = await pool.connect();
      try {
        await schedulerWith()(client, eventId, planId, {
          email: "organizer@example.test",
          phone: null,
        });
      } finally {
        client.release();
      }

      const rows = await alertsOf(eventId);
      expect(rows.some((row) => row.alert_type === "dependency_unlocked")).toBe(true);
    });

    it("carries all three verification states on an unlock alert", async () => {
      // AGENTS.md keeps these states visible END TO END and a notification is an end. The reminder
      // builder was fixed for that; this builder was not, so the one alert that asserts a SEQUENCE
      // between two agencies arrived with no verification state at all.
      //
      // The third line is the one a single status cannot carry. The sequencing rule publishes
      // RESEARCH_REQUIRED on the order itself — issued-before-filed is not confirmed — and "You
      // can now pursue" reads as a start date the agencies agree on. Without it, the unconfirmed
      // part of the claim is the part the organizer cannot see.
      const eventId = await createEvent(scenario("C"));
      const { planId } = await insertDuePlan(eventId, {
        latestApplyDate: dayFromToday(7),
        applyAfterDate: dayFromToday(3),
      });
      const client = await pool.connect();
      try {
        await schedulerWith()(client, eventId, planId, {
          email: "organizer@example.test",
          phone: null,
        });
      } finally {
        client.release();
      }

      const unlock = (await alertsOf(eventId)).find(
        (row) => row.alert_type === "dependency_unlocked",
      );
      const body = unlock?.payload.body ?? "";
      expect(body).toContain("Verification of your Sound Device Permit (NYPD): SOURCE CONFIRMED");
      expect(body).toContain(
        "Verification of your Special Event Permit (NYC Parks): SOURCE CONFIRMED",
      );
      expect(body).toContain("Verification of the sequencing between them: RESEARCH REQUIRED");
      expect(body).toContain("Sequencing between them: confirm with agency");
      expect(body.split(CONFIRM_WITH_AGENCY)).toHaveLength(2);
    });

    it("coalesces confirmation published in an unlock's portal instructions", async () => {
      const eventId = await createEvent(scenario("C"));
      const { planId } = await insertDuePlan(eventId, {
        latestApplyDate: dayFromToday(7),
        applyAfterDate: dayFromToday(3),
        portalInstructions: CONFIRM_WITH_AGENCY,
      });
      await pool.query(
        `UPDATE permit_plan_items SET verification_status = 'RESEARCH_REQUIRED'
          WHERE plan_id = $1 AND rule_ids = ARRAY['NYPD-SOUND-001']`,
        [planId],
      );
      const client = await pool.connect();
      try {
        await schedulerWith()(client, eventId, planId, {
          email: "organizer@example.test",
          phone: null,
        });
      } finally {
        client.release();
      }

      const unlock = (await alertsOf(eventId)).find(
        (row) => row.alert_type === "dependency_unlocked",
      );
      const body = unlock?.payload.body ?? "";
      expect(body).toContain("Verification of your Sound Device Permit (NYPD): RESEARCH REQUIRED");
      expect(body).not.toContain(`Sound Device Permit (NYPD): ${CONFIRM_WITH_AGENCY}`);
      expect(body).toContain(`Sequencing between them: ${CONFIRM_WITH_AGENCY}`);
      expect(body.split(CONFIRM_WITH_AGENCY)).toHaveLength(3);
    });

    it("does not announce a second unlock when regeneration recomputes the same gate", async () => {
      // `apply_after_date` is the plan's own `today` plus the upstream processing range, so it
      // moves every time the plan is regenerated on a later day even though the event, the
      // requirement and the upstream have not changed. Keyed on that date, the sent unlock did not
      // conflict with the recomputed one and the organizer was told a second time that they may
      // now pursue something they had already been told was open.
      const eventId = await createEvent(scenario("C"));
      const contacts = { email: "organizer@example.test", phone: null };
      const first = await insertDuePlan(eventId, {
        latestApplyDate: dayFromToday(40),
        applyAfterDate: dayFromToday(21),
      });
      const client = await pool.connect();
      try {
        await schedulerWith()(client, eventId, first.planId, contacts);
        const unlock = (await alertsOf(eventId)).find(
          (row) => row.alert_type === "dependency_unlocked",
        );
        expect(unlock).toBeDefined();
        await pool.query(
          "UPDATE alerts SET status = 'sent', sent_at = clock_timestamp() WHERE id = $1",
          [unlock?.id],
        );

        // Regenerated a week later: the gate is recomputed from the new clock and lands elsewhere.
        const second = await insertDuePlan(eventId, {
          latestApplyDate: dayFromToday(40),
          applyAfterDate: dayFromToday(28),
          reuseChecklistItemId: first.checklistItemId,
        });
        await schedulerWith()(client, eventId, second.planId, contacts);

        const unlocks = (await alertsOf(eventId)).filter(
          (row) => row.alert_type === "dependency_unlocked",
        );
        // One unlock per gated requirement, ever. It stays sent and no second one is queued.
        expect(unlocks).toHaveLength(1);
        expect(unlocks[0]?.status).toBe("sent");
      } finally {
        client.release();
      }
    });

    it("moves an unsent unlock to the recomputed date rather than leaving it on the old one", async () => {
      // The other half of dropping the date from the identity: the row keeps its identity while
      // its date changes, so reconciliation has to move the row it already owns.
      const eventId = await createEvent(scenario("C"));
      const contacts = { email: "organizer@example.test", phone: null };
      const first = await insertDuePlan(eventId, {
        latestApplyDate: dayFromToday(40),
        applyAfterDate: dayFromToday(21),
      });
      const client = await pool.connect();
      try {
        await schedulerWith()(client, eventId, first.planId, contacts);
        const second = await insertDuePlan(eventId, {
          latestApplyDate: dayFromToday(40),
          applyAfterDate: dayFromToday(28),
          reuseChecklistItemId: first.checklistItemId,
        });
        await schedulerWith()(client, eventId, second.planId, contacts);

        const unlocks = (await alertsOf(eventId)).filter(
          (row) => row.alert_type === "dependency_unlocked",
        );
        expect(unlocks).toHaveLength(1);
        expect(unlocks[0]?.status).toBe("pending");
        expect(unlocks[0]?.send_at.toISOString().slice(0, 10)).toBe(dayFromToday(28));
      } finally {
        client.release();
      }
    });

    it("does not send an alert a regeneration rescheduled between the scan and the claim", async () => {
      // The scan-to-claim window, seen from the other side of the same race the event lock was
      // introduced for. An unlock keeps its identity across a recomputed `apply_after_date` — that
      // is what stops it announcing itself twice — so reconciliation rewrites `send_at` on a row
      // that stays pending and keeps the id the scan already picked up. Claiming on status alone
      // then sends a rescheduled alert at the old moment: "you can now pursue this" days early.
      const eventId = await createEvent(scenario("C"));
      const contacts = { email: "organizer@example.test", phone: null };
      const plan = await insertDuePlan(eventId, {
        latestApplyDate: dayFromToday(40),
        applyAfterDate: dayFromToday(-1),
      });
      const client = await pool.connect();
      try {
        await schedulerWith()(client, eventId, plan.planId, contacts);
      } finally {
        client.release();
      }
      const unlock = (await alertsOf(eventId)).find(
        (row) => row.alert_type === "dependency_unlocked",
      );
      expect(unlock?.send_at.getTime()).toBeLessThan(Date.now());

      const provider = fakeProvider();
      // The regeneration lands between the scan and the claim: same row, same identity, a gate
      // that has moved into the future.
      const racing = Object.create(pool) as Pool;
      racing.connect = pool.connect.bind(pool) as Pool["connect"];
      racing.query = (async (text: string, values?: unknown[]) => {
        const result = await pool.query(text as never, values as never);
        if (typeof text === "string" && text.includes("ORDER BY failure_count")) {
          const later = await insertDuePlan(eventId, {
            latestApplyDate: dayFromToday(40),
            applyAfterDate: dayFromToday(9),
            reuseChecklistItemId: plan.checklistItemId,
          });
          const reviewer = await pool.connect();
          try {
            await schedulerWith()(reviewer, eventId, later.planId, contacts);
          } finally {
            reviewer.release();
          }
        }
        return result;
      }) as Pool["query"];

      await createAlertPoller({
        jurisdiction: ruleset.jurisdiction,
        database: racing,
        senders: provider.senders,
      }).tick();

      const after = (await alertsOf(eventId)).find(
        (row) => row.alert_type === "dependency_unlocked",
      );
      // Still the one row, still pending, now waiting for the date the plan actually computed.
      expect(after?.id).toBe(unlock?.id);
      expect(after?.status).toBe("pending");
      expect(after?.send_at.toISOString().slice(0, 10)).toBe(dayFromToday(9));
      expect(provider.attempts.map((message) => message.subject)).not.toContain(
        after?.payload.subject,
      );
    });

    it("does not deliver an obsolete alert while a checklist review is cancelling it", async () => {
      // The reconciler and the poller both reach for the same row. Locking the alert row alone put
      // the cancellation in a queue BEHIND the claim: it woke to a row that had become `sent` and
      // skipped it, having waited for exactly the delivery it existed to prevent.
      const eventId = await createEvent(scenario("C"));
      const contacts = { email: "organizer@example.test", phone: null };
      const first = await insertDuePlan(eventId, { latestApplyDate: dayFromToday(0) });
      const review = await pool.connect();
      const provider = fakeProvider();
      try {
        const client = await pool.connect();
        try {
          await schedulerWith()(client, eventId, first.planId, contacts);
        } finally {
          client.release();
        }
        expect((await alertsOf(eventId)).every((row) => row.status === "pending")).toBe(true);

        // A checklist review, holding the event exactly as `POST /checklist` does, mid-flight.
        await review.query("BEGIN");
        await review.query("SELECT id FROM events WHERE id = $1 FOR UPDATE", [eventId]);

        await createAlertPoller({
          database: pool,
          senders: provider.senders,
          jurisdiction: ruleset.jurisdiction,
        }).tick();

        // Nothing went out: the review owns the event, and the alerts it is about to reconcile are
        // not delivered out from under it.
        expect(provider.attempts).toHaveLength(0);
        await review.query(
          `UPDATE alerts SET status = 'cancelled' WHERE event_id = $1 AND status IN ('pending', 'failed')`,
          [eventId],
        );
        await review.query("COMMIT");
      } finally {
        review.release();
      }

      expect((await alertsOf(eventId)).every((row) => row.status === "cancelled")).toBe(true);
      // And once the review is done the poller is free again, with nothing left to send.
      await createAlertPoller({
        database: pool,
        senders: provider.senders,
        jurisdiction: ruleset.jurisdiction,
      }).tick();
      expect(provider.attempts).toHaveLength(0);
    });

    it("brings a cancelled alert back when the requirement returns", async () => {
      // Driven by a requirement APPEARING and DISAPPEARING rather than by a date moving. Moving a
      // date no longer cancels anything, because a reminder keeps its identity across the move, so
      // a date-driven version of this would be testing the reconciler on a set it never changes.
      const eventId = await createEvent(scenario("C"));
      const contacts = { email: "organizer@example.test", phone: null };
      const gated = await insertDuePlan(eventId, {
        latestApplyDate: dayFromToday(30),
        applyAfterDate: dayFromToday(21),
      });
      const client = await pool.connect();
      try {
        await schedulerWith()(client, eventId, gated.planId, contacts);
        const unlock = (await alertsOf(eventId)).find(
          (row) => row.alert_type === "dependency_unlocked",
        );
        expect(unlock).toBeDefined();

        // A regeneration in which the requirement is no longer gated, so the unlock is not called
        // for at all.
        const ungated = await insertDuePlan(eventId, {
          latestApplyDate: dayFromToday(30),
          reuseChecklistItemId: gated.checklistItemId,
        });
        await schedulerWith()(client, eventId, ungated.planId, contacts);
        expect((await alertsOf(eventId)).find((row) => row.id === unlock?.id)?.status).toBe(
          "cancelled",
        );

        // And back: the gate returns, so the alert scheduled for it does too.
        const regated = await insertDuePlan(eventId, {
          latestApplyDate: dayFromToday(30),
          applyAfterDate: dayFromToday(21),
          reuseChecklistItemId: gated.checklistItemId,
        });
        await schedulerWith()(client, eventId, regated.planId, contacts);

        const revived = (await alertsOf(eventId)).find((row) => row.id === unlock?.id);
        expect(revived?.status).toBe("pending");
        expect(revived?.idempotency_key).toBe(unlock?.idempotency_key);
      } finally {
        client.release();
      }
    });
  });

  describe("AC 6 — the test-alert endpoint", () => {
    it("fires one real alert immediately, labeled a test", async () => {
      const eventId = await createEvent(scenario("C"));
      const provider = fakeProvider();

      const response = await request(appWith(provider))
        .post(`/api/events/${eventId}/alerts/test`)
        .send({ channel: "email", recipient: "organizer@example.test" });

      expect(response.status).toBe(201);
      expect(response.body.alert.status).toBe("sent");
      expect(response.body.alert.payload.test).toBe(true);
      expect(response.body.alert.payload.subject).toBe("[TEST] PopEngine alert test");
      expect(provider.delivered).toHaveLength(1);
      expect(provider.delivered[0]?.body).toContain("TEST ALERT");
      expect(provider.delivered[0]?.body).toContain(
        "states no deadline, requirement or agency position",
      );
      // The recipient is not echoed back: the caller supplied it, and it is contact data.
      expect(response.body.alert.recipient).toBeUndefined();
    });

    it("answers on a pool with no second connection for the attempt-intent write", async () => {
      // A LIVENESS TEST, not a sizing one. The send holds one client for as long as the provider
      // takes, and the attempt record has to commit while that transaction is still open, so it
      // needs a second connection. Drawn from the same pool, concurrent test sends each hold one
      // and wait for another, none can release the one it holds, and the endpoint stops answering.
      // On the API's shared pool, which the poller's connection count does not size.
      //
      // A pool of one is that deadlock with no timing to arrange: either the intent has somewhere
      // else to be written or this request never comes back.
      const eventId = await createEvent(scenario("C"));
      const provider = fakeProvider();
      const oneConnection = new Pool({ connectionString: databaseUrl, max: 1 });

      try {
        const response = await request(
          createApp({
            database: pool,
            intakeContract,
            today: () => FIXTURE_TODAY,
            alerts: {
              jurisdiction: ruleset.jurisdiction,
              database: oneConnection,
              senders: provider.senders,
            },
          }),
        )
          .post(`/api/events/${eventId}/alerts/test`)
          .send({ channel: "email", recipient: "organizer@example.test" });

        expect(response.status).toBe(201);
        expect(response.body.alert.status).toBe("sent");
        expect(provider.delivered).toHaveLength(1);
      } finally {
        await oneConnection.end();
      }
    });

    it("reports success when the poller delivered the test row first", async () => {
      // The test row is written due immediately, so the poller can claim it in the gap before the
      // endpoint sends it. The endpoint's own claim then returns nothing out of SKIP LOCKED — not
      // because the alert failed, but because someone else was already delivering it.
      const eventId = await createEvent(scenario("C"));
      const provider = fakeProvider();
      const racing = Object.create(pool) as Pool;
      racing.connect = pool.connect.bind(pool) as Pool["connect"];
      racing.query = (async (text: string, values?: unknown[]) => {
        const result = await pool.query(text as never, values as never);
        if (typeof text === "string" && text.includes("INSERT INTO alerts")) {
          // Exactly the race, made deterministic: the poller takes the row before the endpoint
          // gets to it, and delivers it.
          await createAlertPoller({
            database: pool,
            senders: provider.senders,
            jurisdiction: ruleset.jurisdiction,
          }).tick();
        }
        return result;
      }) as Pool["query"];

      const response = await request(
        createApp({
          database: pool,
          intakeContract,
          today: () => FIXTURE_TODAY,
          alerts: {
            jurisdiction: ruleset.jurisdiction,
            database: racing,
            senders: provider.senders,
          },
        }),
      )
        .post(`/api/events/${eventId}/alerts/test`)
        .send({ channel: "email", recipient: "organizer@example.test" });

      expect(response.status).toBe(201);
      expect(response.body.alert.status).toBe("sent");
      // Delivered once, by the poller. The endpoint reports the row, not its own part in it.
      expect(provider.delivered).toHaveLength(1);
    });

    it("waits out a poller that is still mid-send rather than calling it a failure", async () => {
      // The narrower half of the same race: the poller holds the row and has not finished. A
      // single look sees `pending` and would report a test that is on its way as undeliverable.
      const eventId = await createEvent(scenario("C"));
      const holder = await pool.connect();
      const claiming = Object.create(pool) as Pool;
      claiming.connect = pool.connect.bind(pool) as Pool["connect"];
      claiming.query = (async (text: string, values?: unknown[]) => {
        const result = await pool.query(text as never, values as never);
        if (typeof text === "string" && text.includes("INSERT INTO alerts")) {
          await holder.query("BEGIN");
          await holder.query("SELECT id FROM alerts WHERE event_id = $1 FOR UPDATE", [eventId]);
          setTimeout(() => {
            void (async () => {
              await holder.query(
                "UPDATE alerts SET status = 'sent', sent_at = clock_timestamp() WHERE event_id = $1",
                [eventId],
              );
              await holder.query("COMMIT");
              holder.release();
            })();
          }, 250);
        }
        return result;
      }) as Pool["query"];

      const response = await request(
        createApp({
          database: pool,
          intakeContract,
          today: () => FIXTURE_TODAY,
          alerts: {
            jurisdiction: ruleset.jurisdiction,
            database: claiming,
            senders: fakeProvider().senders,
          },
        }),
      )
        .post(`/api/events/${eventId}/alerts/test`)
        .send({ channel: "email", recipient: "organizer@example.test" });

      expect(response.status).toBe(201);
      expect(response.body.alert.status).toBe("sent");
    });

    it("does not call a test undelivered because a review held the event", async () => {
      // `sendOne` reports `skipped` when a checklist review or an intake edit holds the event row.
      // The poller learned to retry that in round 13; this endpoint treated it as a final outcome,
      // answered 502 and reported a failure without ever attempting delivery. It is a demo path,
      // and a demo that reports a failure that did not happen is worse than most real bugs.
      //
      // The lock is taken AFTER the row is inserted, which is the only interleaving that reaches
      // the skip: taken before, the insert's own foreign-key check waits on the event row and the
      // request simply blocks until the review commits. A review that starts while a test send is
      // being delivered is the ordinary case, and it is this one.
      const eventId = await createEvent(scenario("C"));
      const reviewer = await pool.connect();
      const inserting = Object.create(pool) as Pool;
      inserting.connect = pool.connect.bind(pool) as Pool["connect"];
      inserting.query = (async (text: string, values?: unknown[]) => {
        const result = await pool.query(text as never, values as never);
        if (typeof text === "string" && text.includes("INSERT INTO alerts")) {
          await reviewer.query("BEGIN");
          await reviewer.query("SELECT id FROM events WHERE id = $1 FOR UPDATE", [eventId]);
          setTimeout(() => {
            void reviewer.query("COMMIT");
          }, 300);
        }
        return result;
      }) as Pool["query"];

      try {
        const response = await request(
          createApp({
            database: pool,
            intakeContract,
            today: () => FIXTURE_TODAY,
            alerts: {
              jurisdiction: ruleset.jurisdiction,
              database: inserting,
              senders: fakeProvider().senders,
            },
          }),
        )
          .post(`/api/events/${eventId}/alerts/test`)
          .send({ channel: "email", recipient: "organizer@example.test" });

        expect(response.status).toBe(201);
        expect(response.body.alert.status).toBe("sent");
      } finally {
        reviewer.release();
      }
    });

    it("waits as long as a send is allowed to take before calling a test undelivered", async () => {
      // The retry budget used to be a flat 600ms while the same delivery path allows a request to
      // stay in flight for ten seconds. A poller that won the claim and then succeeded after a
      // second produced a 502 moments before the successful send committed — the endpoint giving
      // up sooner than the thing it is waiting for is allowed to take.
      const eventId = await createEvent(scenario("C"));
      const holder = await pool.connect();
      const claiming = Object.create(pool) as Pool;
      claiming.connect = pool.connect.bind(pool) as Pool["connect"];
      claiming.query = (async (text: string, values?: unknown[]) => {
        const result = await pool.query(text as never, values as never);
        if (typeof text === "string" && text.includes("INSERT INTO alerts")) {
          await holder.query("BEGIN");
          await holder.query("SELECT id FROM alerts WHERE event_id = $1 FOR UPDATE", [eventId]);
          // Well past the old 600ms budget, and well inside what a provider request may take.
          setTimeout(() => {
            void (async () => {
              await holder.query(
                "UPDATE alerts SET status = 'sent', sent_at = clock_timestamp() WHERE event_id = $1",
                [eventId],
              );
              await holder.query("COMMIT");
              holder.release();
            })();
          }, 1_500);
        }
        return result;
      }) as Pool["query"];

      const response = await request(
        createApp({
          database: pool,
          intakeContract,
          today: () => FIXTURE_TODAY,
          alerts: {
            jurisdiction: ruleset.jurisdiction,
            database: claiming,
            senders: fakeProvider().senders,
          },
        }),
      )
        .post(`/api/events/${eventId}/alerts/test`)
        .send({ channel: "email", recipient: "organizer@example.test" });

      expect(response.status).toBe(201);
      expect(response.body.alert.status).toBe("sent");
    }, 20_000);

    it("reports a delivery failure instead of claiming a send", async () => {
      const eventId = await createEvent(scenario("C"));
      const provider = fakeProvider();
      provider.fail = "email provider rejected the send with status 422";

      const response = await request(appWith(provider))
        .post(`/api/events/${eventId}/alerts/test`)
        .send({ channel: "email", recipient: "organizer@example.test" });

      expect(response.status).toBe(502);
      expect(response.body.alert.status).toBe("failed");
      expect(response.body.alert.failureCount).toBe(1);
    });

    it("renders an SMS test as a labeled simulation rather than claiming delivery", async () => {
      const eventId = await createEvent(scenario("C"));

      const response = await request(appWith(fakeProvider()))
        .post(`/api/events/${eventId}/alerts/test`)
        .send({ channel: "sms", recipient: "+15555550123" });

      expect(response.status).toBe(201);
      expect(response.body.alert.payload.delivery).toMatchObject({
        simulated: true,
        label: SIMULATED_SMS_LABEL,
      });
    });

    it("does not overwrite a delivery the poller won while the cancel was in flight", async () => {
      // THE OTHER SIDE OF ROUND 27'S CHOICE. Cancelling from the endpoint was right, and the cancel
      // was an unguarded UPDATE by id outside the delivery transaction. The retired row is
      // immediately eligible, because the first retry's backoff is zero, so the poller could claim
      // it after the endpoint read it and before the cancel ran: the retry SUCCEEDS, the cancel
      // then waits on that claim and writes cancelled over sent, and the caller keeps a 502 for a
      // message that was delivered.
      //
      // THE INTERLEAVING IS FORCED, not hoped for. The router's pool is proxied so that when it
      // sees the retiring UPDATE it first runs a full poller tick to completion — which claims the
      // failed row and delivers it — and only then lets the UPDATE through. That is exactly the
      // reported ordering, every time.
      const eventId = await createEvent(scenario("C"));
      const failing = fakeProvider();
      failing.fail = "provider down";
      const recovered = fakeProvider();

      const racing = Object.create(pool) as Pool;
      racing.connect = pool.connect.bind(pool) as Pool["connect"];
      racing.query = (async (text: string, values?: unknown[]) => {
        if (typeof text === "string" && text.includes("SET status = 'cancelled' WHERE id")) {
          await createAlertPoller({
            database: pool,
            senders: recovered.senders,
            jurisdiction: ruleset.jurisdiction,
          }).tick();
        }
        return pool.query(text as never, values as never);
      }) as Pool["query"];

      const response = await request(
        createApp({
          database: pool,
          intakeContract,
          today: () => FIXTURE_TODAY,
          alerts: {
            jurisdiction: ruleset.jurisdiction,
            database: racing,
            senders: failing.senders,
          },
        }),
      )
        .post(`/api/events/${eventId}/alerts/test`)
        .send({ channel: "email", recipient: "organizer@example.test" });

      // The poller really did deliver it, which is what makes this a race rather than a no-op.
      expect(recovered.delivered).toHaveLength(1);
      const test = (await alertsOf(eventId)).find((row) => row.payload.test === true);
      // Not overwritten.
      expect(test?.status).toBe("sent");
      // And the caller is told what happened rather than a 502 that was true a moment earlier.
      expect(response.status).toBe(201);
      expect(response.body.alert.status).toBe("sent");
    });

    it("does not let the poller deliver a test the endpoint already called failed", async () => {
      // The endpoint reports 502 and the row stayed failed with an eligible next_attempt_at, and
      // the scan takes any due row. A transient outage then delivered a demo message after the
      // caller had been told it failed, and a caller who retried got both.
      const eventId = await createEvent(scenario("C"));
      const failing = fakeProvider();
      failing.fail = "provider down";
      const response = await request(appWith(failing))
        .post(`/api/events/${eventId}/alerts/test`)
        .send({ channel: "email", recipient: "organizer@example.test" });
      expect(response.status).toBe(502);
      // The response still reports the attempt truthfully; the row records the intent afterwards.
      expect(response.body.alert.status).toBe("failed");

      // The provider recovers and the poller runs.
      const recovered = fakeProvider();
      await createAlertPoller({
        database: pool,
        senders: recovered.senders,
        jurisdiction: ruleset.jurisdiction,
      }).tick();

      expect(recovered.attempts).toHaveLength(0);
      const test = (await alertsOf(eventId)).find((row) => row.payload.test === true);
      expect(test?.status).toBe("cancelled");
    });

    it("survives a later regeneration rather than being cancelled with the plan's alerts", async () => {
      const eventId = await createEvent(scenario("C"));
      const provider = fakeProvider();
      provider.fail = "provider down";
      await request(appWith(provider))
        .post(`/api/events/${eventId}/alerts/test`)
        .send({ channel: "email", recipient: "organizer@example.test" });

      // Retired by the endpoint that reported the failure, so the poller will not deliver a demo
      // message after the caller was told it failed.
      const before = (await alertsOf(eventId)).find((row) => row.payload.test === true);
      expect(before?.status).toBe("cancelled");

      await materialize(eventId);

      // And the regeneration leaves it exactly as it was, which is what this test is about: the
      // reconciler sweeps the plan's alerts and does not touch a demo row.
      const after = (await alertsOf(eventId)).find((row) => row.payload.test === true);
      expect(after?.id).toBe(before?.id);
      expect(after?.status).toBe(before?.status);
      expect(after?.failure_count).toBe(before?.failure_count);
    });

    it("answers in JSON when the request fails outright", async () => {
      const failing = Object.create(pool) as Pool;
      failing.query = (() =>
        Promise.reject(new Error("connection terminated unexpectedly"))) as Pool["query"];
      const response = await request(
        createApp({
          database: pool,
          intakeContract,
          today: () => FIXTURE_TODAY,
          alerts: {
            jurisdiction: ruleset.jurisdiction,
            database: failing,
            senders: fakeProvider().senders,
          },
        }),
      )
        .post(`/api/events/${randomUUID()}/alerts/test`)
        .send({ channel: "email", recipient: "organizer@example.test" });

      expect(response.status).toBe(500);
      expect(response.body).toEqual({ error: "alert request failed" });
    });

    it("rejects a request that names no valid channel, recipient or event", async () => {
      const eventId = await createEvent(scenario("C"));
      const app = appWith(fakeProvider());

      expect((await request(app).post("/api/events/not-a-uuid/alerts/test").send({})).status).toBe(
        400,
      );
      expect(
        (
          await request(app)
            .post(`/api/events/${eventId}/alerts/test`)
            .send({ channel: "carrier-pigeon" })
        ).body.error,
      ).toBe("channel must be one of email, sms");
      expect(
        (
          await request(app)
            .post(`/api/events/${eventId}/alerts/test`)
            .send({ channel: "email", recipient: " " })
        ).body.error,
      ).toBe("recipient must be a non-empty string");
      expect(
        (
          await request(app)
            .post(`/api/events/${randomUUID()}/alerts/test`)
            .send({ channel: "email", recipient: "organizer@example.test" })
        ).status,
      ).toBe(404);
      expect(
        (await request(app).post(`/api/events/${eventId}/alerts/test`).send("[]").type("json"))
          .status,
      ).toBe(400);
    });
  });

  describe("a channel that tried to send and failed is reported as such", () => {
    it("counts alerts whose attempt failed, per channel, and says nothing about why", async () => {
      const eventId = await createEvent(scenario("C"));
      await schedulePastDue(eventId, [7, 1]);
      const provider = fakeProvider();
      provider.fail = "email provider rejected the send with status 550";

      await createAlertPoller({
        database: pool,
        senders: provider.senders,
        jurisdiction: ruleset.jurisdiction,
      }).tick();

      const failures = await failedDeliveries(pool, eventId);
      expect(failures).toEqual([{ channel: "email", failedCount: 2, heldForReview: false }]);
      // The provider's words stay on the row for an operator; they can name a recipient.
      expect(JSON.stringify(failures)).not.toContain("550");
    });

    it("reports nothing when alerts exist but none has been attempted", async () => {
      // The distinction the rows DO support: pending is "not due yet", not "failed". Reporting a
      // zero here, or anything at all, would be inventing evidence out of an absence.
      const eventId = await createEvent(scenario("C"));
      await materialize(eventId);
      expect((await alertsOf(eventId)).every((row) => row.status === "pending")).toBe(true);

      expect(await failedDeliveries(pool, eventId)).toEqual([]);
    });

    it("stops reporting a failure once the alert gets through", async () => {
      const eventId = await createEvent(scenario("C"));
      await schedulePastDue(eventId, [1]);
      const provider = fakeProvider();
      provider.fail = "email provider unreachable: ECONNREFUSED";
      const poller = createAlertPoller({
        database: pool,
        senders: provider.senders,
        jurisdiction: ruleset.jurisdiction,
      });
      await poller.tick();
      expect(await failedDeliveries(pool, eventId)).toEqual([
        { channel: "email", failedCount: 1, heldForReview: false },
      ]);

      provider.fail = null;
      await poller.tick();

      // Delivered on the retry, so it is no longer a failure to report — the count follows the
      // rows rather than remembering a state they have left.
      expect(await failedDeliveries(pool, eventId)).toEqual([]);
    });

    it("does not count a demo test send as a text message for the event", async () => {
      // The mirror of the failed-delivery exclusion, in the other direction. There, counting a demo
      // told an organizer their reminders were failing when they were not. Here it tells them
      // PopEngine recorded a text-message alert for their event when the only SMS was the demo
      // they explicitly asked for.
      const eventId = await createEvent(scenario("C"));
      const provider = fakeProvider();
      const response = await request(
        createApp({
          database: pool,
          intakeContract,
          today: () => FIXTURE_TODAY,
          alerts: { jurisdiction: ruleset.jurisdiction, database: pool, senders: provider.senders },
        }),
      )
        .post(`/api/events/${eventId}/alerts/test`)
        .send({ channel: "sms", recipient: "+15550000000" });
      expect(response.status).toBe(201);
      // The demo really was a simulated SMS, so this is the row that would be miscounted.
      expect(response.body.alert.status).toBe("sent");

      expect(await simulatedDeliveries(pool, eventId)).toEqual([]);
    });

    it("does not count a demo test send against the organizer's own alerts", async () => {
      // A test fired at a deliberately bogus address is an operator action against no deadline.
      // Counting it would tell an organizer their reminders are failing when they are not.
      const eventId = await createEvent(scenario("C"));
      const provider = fakeProvider();
      provider.fail = "email provider rejected the send with status 422";
      const response = await request(appWith(provider))
        .post(`/api/events/${eventId}/alerts/test`)
        .send({ channel: "email", recipient: "tester@example.test" });
      expect(response.status).toBe(502);

      expect(await failedDeliveries(pool, eventId)).toEqual([]);
    });
  });

  describe("an alert the poller has permanently stopped on is reported as stopped", () => {
    /**
     * The state a crash or a lost answer leaves once the provider's dedup window has closed on it:
     * a due alert, an attempt nobody saw the end of, and no tick that will ever take it again.
     *
     * Written directly because the AGE is the point and nothing in the product produces a day-old
     * attempt inside a test.
     */
    const insertHeldAlert = async (
      eventId: string,
      status: "pending" | "failed",
    ): Promise<string> => {
      const alertId = randomUUID();
      await pool.query(
        `INSERT INTO alerts (id, event_id, alert_type, channel, recipient, idempotency_key,
                             send_at, status, failure_count, payload)
         VALUES ($1, $2, 'deadline_reminder', 'email', 'organizer@example.test', $3,
                 current_timestamp - interval '2 days', $4,
                 CASE WHEN $4 = 'failed' THEN 1 ELSE 0 END,
                 '{"subject":"file it","body":"file it"}'::jsonb)`,
        [alertId, eventId, alertId, status],
      );
      await pool.query(
        `INSERT INTO alert_send_attempts (alert_id, idempotency_key, attempted_at)
         VALUES ($1, $2, current_timestamp - ($3 || ' hours')::interval)`,
        [alertId, alertId, PROVIDER_DEDUP_WINDOW_HOURS + 1],
      );
      return alertId;
    };

    it("tells the organizer a crashed send stopped, where nothing told them anything", async () => {
      // THE SILENT HALF. A crash between the provider accepting the message and the COMMIT rolls
      // the row back to `pending`, so `failedDeliveries` says nothing — correctly, because pending
      // is not a failure — and the organizer's checklist looked exactly like an event whose
      // reminders are simply not due yet. The poller had in fact stopped on it for good.
      const eventId = await createEvent(scenario("C"));
      await insertHeldAlert(eventId, "pending");

      expect(await failedDeliveries(pool, eventId)).toEqual([]);
      expect(await reconciliationHolds(pool, eventId)).toEqual([
        { channel: "email", heldCount: 1 },
      ]);
    });

    it("stops counting a stopped alert among the failures it says are being retried", async () => {
      // THE WORSE HALF. A lost answer leaves the row `failed`, so it was reported as an ordinary
      // current-plan failure under copy that says PopEngine keeps retrying it. The poller has
      // permanently stopped on that row, so the organizer was told delivery continues when it had
      // ended — for a product whose purpose is that a filing deadline does not pass unnoticed.
      const eventId = await createEvent(scenario("C"));
      await insertHeldAlert(eventId, "failed");

      expect(await failedDeliveries(pool, eventId)).toEqual([]);
      expect(await reconciliationHolds(pool, eventId)).toEqual([
        { channel: "email", heldCount: 1 },
      ]);
    });

    it("leaves a failure the poller is still retrying exactly where it was", async () => {
      // The other side of the line, so the hold cannot widen into "every failure is hopeless". A
      // failed attempt inside the dedup window is retried on the next tick, and the notice that
      // says so is true of it.
      const eventId = await createEvent(scenario("C"));
      await schedulePastDue(eventId, [reminderOffsets[0] ?? 7]);
      const provider = fakeProvider();
      provider.fail = "email provider unreachable: ECONNREFUSED";
      await createAlertPoller({
        database: pool,
        senders: provider.senders,
        jurisdiction: ruleset.jurisdiction,
      }).tick();

      expect(await failedDeliveries(pool, eventId)).toEqual([
        { channel: "email", failedCount: 1, heldForReview: false },
      ]);
      expect(await reconciliationHolds(pool, eventId)).toEqual([]);
    });

    it("says nothing about an alert the organizer's own edit has already retired", async () => {
      // Same predicate the tick's count now applies, and the same reason: regeneration cancels
      // this row, so calling it a hold would send the organizer after the provider about a
      // reminder they have already superseded.
      const eventId = await createEvent(scenario("C"));
      await schedulePastDue(eventId, [reminderOffsets[0] ?? 7]);
      const alertId = (await alertsOf(eventId))[0]?.id ?? "";
      await pool.query(
        `INSERT INTO alert_send_attempts (alert_id, idempotency_key, attempted_at)
         VALUES ($1, $2, current_timestamp - ($3 || ' hours')::interval)`,
        [alertId, alertId, PROVIDER_DEDUP_WINDOW_HOURS + 1],
      );
      await pool.query("UPDATE events SET revision_counter = revision_counter + 1 WHERE id = $1", [
        eventId,
      ]);

      expect(await reconciliationHolds(pool, eventId)).toEqual([]);
    });

    it("never puts one alert under both notices at once", async () => {
      // TWO QUERIES, TWO SNAPSHOTS, TWO CONTRADICTORY ANSWERS. The hold is a fact about how old an
      // attempt is, so it becomes true with the passage of time — including between two sequential
      // pool queries, each of which runs in its own autocommit snapshot. A failed alert counted as
      // a failure by the first and as a hold by the second reaches the organizer under both the
      // notice that says PopEngine keeps retrying and the notice that says retrying has stopped,
      // and the page keeps both until it is reloaded. One statement cannot disagree with itself.
      //
      // THE CROSSING IS FORCED: the pool is proxied so the attempt ages past the cutoff the moment
      // a statement that reads the alerts table has run. Under two statements that lands between
      // them, which is the reported ordering exactly.
      const eventId = await createEvent(scenario("C"));
      const alertId = await insertHeldAlert(eventId, "failed");
      await pool.query(
        `UPDATE alert_send_attempts SET attempted_at = current_timestamp WHERE alert_id = $1`,
        [alertId],
      );

      let crossed = false;
      const crossing = Object.create(pool) as Pool;
      crossing.query = (async (text: string, values?: unknown[]) => {
        const result = await pool.query(text as never, values as never);
        if (!crossed && typeof text === "string" && text.includes("FROM alerts")) {
          crossed = true;
          await pool.query(
            `UPDATE alert_send_attempts
                SET attempted_at = current_timestamp - ($2 || ' hours')::interval
              WHERE alert_id = $1`,
            [alertId, PROVIDER_DEDUP_WINDOW_HOURS + 1],
          );
        }
        return result;
      }) as Pool["query"];

      const health = await alertDeliveryHealth(crossing, eventId);

      expect(crossed).toBe(true);
      expect(health.failedDeliveries.length === 0 || health.reconciliationHolds.length === 0).toBe(
        true,
      );
    });

    it("reaches the checklist an organizer actually reads", async () => {
      // Through the real delivery path: the provider never answers, the attempt stays open, and
      // the window closes on it. The count has to arrive on the surface the organizer uses, not
      // only in a server log they will never see.
      const eventId = await createEvent(scenario("C"));
      await schedulePastDue(eventId, [reminderOffsets[0] ?? 7]);
      const silentProvider: AlertSenders = {
        sms: fakeProvider().senders.sms,
        email: async () => {
          throw new AlertDeliveryError("email provider did not respond within 10000ms", {
            outcomeObserved: false,
          });
        },
      };
      await createAlertPoller({
        database: pool,
        senders: silentProvider,
        jurisdiction: ruleset.jurisdiction,
      }).tick();
      const alertId = (await alertsOf(eventId))[0]?.id ?? "";
      // The window closes while nobody is looking, which no test can wait out in real time.
      await pool.query(
        `UPDATE alert_send_attempts
            SET attempted_at = current_timestamp - ($2 || ' hours')::interval
          WHERE alert_id = $1`,
        [alertId, PROVIDER_DEDUP_WINDOW_HOURS + 1],
      );

      const response = await request(appWith(fakeProvider())).get(
        `/api/events/${eventId}/checklist`,
      );

      expect(response.status).toBe(200);
      expect(response.body.alertsHeldForReconciliation).toEqual([
        { channel: "email", heldCount: 1 },
      ]);
      expect(response.body.failedAlertDeliveries).toEqual([]);
    });
  });

  describe("AC 5 — a simulated send is visible as one", () => {
    it("reports the SMS simulation label on the checklist an organizer reads", async () => {
      // AGENTS.md permits the simulation only while it is labeled. The label lived on the alert
      // row and nothing an organizer can reach read it back, so in the A2P-pending configuration
      // every SMS was recorded `sent` and looked delivered from every surface a person uses.
      const eventId = await createEvent(scenario("C"));
      const { planId } = await insertDuePlan(eventId);
      const client = await pool.connect();
      try {
        await schedulerWith()(client, eventId, planId, { email: null, phone: "+15555550123" });
      } finally {
        client.release();
      }
      const provider = fakeProvider();
      const before = await request(appWith(provider)).get(`/api/events/${eventId}/checklist`);
      expect(before.body.simulatedAlertDeliveries).toEqual([]);

      await createAlertPoller({
        database: pool,
        senders: provider.senders,
        jurisdiction: ruleset.jurisdiction,
      }).tick();

      const after = await request(appWith(provider)).get(`/api/events/${eventId}/checklist`);
      expect(after.body.simulatedAlertDeliveries).toEqual([
        { channel: "sms", label: SIMULATED_SMS_LABEL, sentCount: 2 },
      ]);
    });

    it("says nothing when every send was live", async () => {
      const eventId = await createEvent(scenario("C"));
      await schedulePastDue(eventId);
      await createAlertPoller({
        jurisdiction: ruleset.jurisdiction,
        database: pool,
        senders: fakeProvider().senders,
      }).tick();

      const response = await request(appWith(fakeProvider())).get(
        `/api/events/${eventId}/checklist`,
      );
      expect(response.body.simulatedAlertDeliveries).toEqual([]);
    });
  });

  describe("spec edge cases", () => {
    it("says a catch-up reminder is late rather than claiming its configured timing", async () => {
      // A checklist created inside the window sends the seven-day reminder immediately — which is
      // correct, and means it is NOT going out seven days before anything. Saying it is would be a
      // claim about PopEngine's own behaviour that the row itself contradicts.
      const eventId = await createEvent(scenario("C"));
      await schedulePastDue(eventId, [7]);

      const alert = (await alertsOf(eventId))[0];
      expect(alert?.payload.body).toContain(
        "This is PopEngine's 7 days-before reminder, sent now because your checklist was created " +
          "after that day had already passed.",
      );
      expect(alert?.payload.body).not.toContain("PopEngine sends this reminder 7 days before");
      // The policy label survives the rewording: that part is required whatever the timing.
      expect(alert?.payload.body).toContain("not an agency deadline");
    });

    it("keeps the plain wording on a reminder that will go out on its own day", async () => {
      const eventId = await createEvent(scenario("C"));
      await materialize(eventId);
      const reminder = (await alertsOf(eventId)).find(
        (row) => row.alert_type === "deadline_reminder",
      );
      expect(reminder?.payload.body).toContain("PopEngine sends this reminder");
      expect(reminder?.payload.body).not.toContain("sent now because your checklist");
    });

    it("sends a reminder whose send_at has already passed once, instead of dropping it", async () => {
      // A checklist created inside the reminder window: the filing date is still ahead, the
      // reminder day is behind.
      const eventId = await createEvent(scenario("C"));
      await schedulePastDue(eventId);
      const rows = await alertsOf(eventId);
      expect(rows).toHaveLength(2);
      expect(rows.every((row) => row.send_at.getTime() < Date.now())).toBe(true);
      const provider = fakeProvider();

      const poller = createAlertPoller({
        database: pool,
        senders: provider.senders,
        jurisdiction: ruleset.jurisdiction,
      });
      await poller.tick();
      await poller.tick();

      expect(provider.attempts).toHaveLength(2);
      expect((await alertsOf(eventId)).every((row) => row.status === "sent")).toBe(true);
    });

    it("delivers inside the bound when a review holds the event during a tick", async () => {
      // THE BOUND, NOT THE MECHANISM. `SKIP LOCKED` returns nothing while a checklist review or an
      // intake edit holds the event row, and the poller banked that as a completed alert. The row
      // then waited a full 60-second interval, and with the interval's own wait ahead of the tick a
      // perfectly healthy provider could deliver outside AC 2's two-minute window. A review that
      // overlaps a tick is ordinary use, so this is reachable today rather than eventually.
      const eventId = await createEvent(scenario("C"));
      await schedulePastDue(eventId, [reminderOffsets[0] ?? 7]);
      const due = await alertsOf(eventId);
      expect(due).toHaveLength(1);
      const provider = fakeProvider();
      const poller = createAlertPoller({
        database: pool,
        senders: provider.senders,
        jurisdiction: ruleset.jurisdiction,
      });

      // A review in progress: the event row is held exactly as `checklist.ts` holds it.
      const reviewer = await pool.connect();
      let summary;
      // The bound is measured from when the tick began, because these fixture alerts are
      // deliberately back-dated: `send_at` is days behind, so lateness against it measures the
      // fixture rather than the poller. What AC 2 constrains here is how long the poller takes once
      // the alert is claimable, and the failure being tested is a wait of one full interval.
      const tickStartedAt = Date.now();
      try {
        await reviewer.query("BEGIN");
        await reviewer.query("SELECT id FROM events WHERE id = $1 FOR UPDATE", [eventId]);
        const ticking = poller.tick();
        // The review commits while the tick is running, which is the ordinary case.
        await new Promise((resolve) => setTimeout(resolve, 300));
        await reviewer.query("COMMIT");
        summary = await ticking;
      } finally {
        reviewer.release();
      }

      // ONE tick delivered it. Without the fix the tick returns having sent nothing and the alert
      // waits for the next interval.
      expect(summary.sent).toBe(1);
      const [delivered] = await alertsOf(eventId);
      expect(delivered?.status).toBe("sent");
      const tookMs = (delivered?.sent_at?.getTime() ?? 0) - tickStartedAt;
      expect(tookMs).toBeLessThan(DELIVERY_BOUND_MS);
      // And the sharper statement, which is the actual defect: it did not wait out an interval.
      expect(tookMs).toBeLessThan(POLL_INTERVAL_MS);
    });

    it("does not deliver an alert whose plan the event has been edited past", async () => {
      // THE WORST OF THEM, and different in kind from every other alert defect on this PR. The
      // others were an alert missing, arriving twice, or arriving with a state left out. This one
      // arrives on time, looking correct, carrying a filing date the current event does not have.
      // Editing an event increments revision_counter and nothing else, so until the organizer
      // regenerates AND reviews, the alert rows still point through their checklist items at the
      // old plan.
      const eventId = await createEvent(scenario("C"));
      await schedulePastDue(eventId, [reminderOffsets[0] ?? 7]);
      const provider = fakeProvider();
      const poller = createAlertPoller({
        database: pool,
        senders: provider.senders,
        jurisdiction: ruleset.jurisdiction,
      });

      // The organizer edits the event. Nothing else happens: no regeneration, no review.
      await pool.query("UPDATE events SET revision_counter = revision_counter + 1 WHERE id = $1", [
        eventId,
      ]);

      const summary = await poller.tick();

      expect(summary.sent).toBe(0);
      expect(provider.attempts).toHaveLength(0);
      // HELD, NOT CANCELLED: the spec gives the cancelling to regeneration (AC 2 and the Edge
      // Cases row), so the poller declines to send and leaves the row for the review to decide.
      expect((await alertsOf(eventId)).every((row) => row.status === "pending")).toBe(true);
    });

    it("delivers again once the review has caught the plan up", async () => {
      // The other half: holding is not dropping. Once the checklist is reviewed against a plan
      // evaluated at the current revision, the same alerts are deliverable again. Without this the
      // fix would be indistinguishable from switching the organizer's reminders off.
      const eventId = await createEvent(scenario("C"));
      await schedulePastDue(eventId, [reminderOffsets[0] ?? 7]);
      await pool.query("UPDATE events SET revision_counter = revision_counter + 1 WHERE id = $1", [
        eventId,
      ]);
      const provider = fakeProvider();
      const poller = createAlertPoller({
        database: pool,
        senders: provider.senders,
        jurisdiction: ruleset.jurisdiction,
      });
      expect((await poller.tick()).sent).toBe(0);

      // The review: the plan the alerts hang off now names the event's current revision.
      await pool.query(
        `UPDATE permit_plans SET event_revision = (SELECT revision_counter FROM events WHERE id = $1)
          WHERE event_id = $1`,
        [eventId],
      );

      expect((await poller.tick()).sent).toBe(1);
      expect(provider.delivered).toHaveLength(1);
    });

    it("does not deliver a plan-level slack warning once the event has moved on", async () => {
      // The hole in last round's scope, and the argument that put it there was half wrong. A slack
      // warning has no checklist item, so the staleness JOIN cannot see it, and it was left out on
      // the grounds that it goes out seconds after being written. That holds only while delivery
      // works. A warning whose send FAILS sits in backoff for as long as the outage lasts, so the
      // real sequence is: the send fails, the organizer edits the event, delivery recovers before
      // they regenerate, and the OLD plan's slack figure goes out.
      //
      // Still a correctness fix rather than the severe one: this states a risk figure and an
      // evaluation date, never an agency deadline, so it cannot deliver a wrong filing date.
      const eventId = await createEvent(scenario("C"));
      // Far enough out that no reminder is due, so only the warning is in play here.
      const { planId } = await insertDuePlan(eventId, {
        verdict: "feasible_at_risk",
        minSlackDays: 9,
        latestApplyDate: dayFromToday(30),
      });
      const client = await pool.connect();
      try {
        await schedulerWith()(client, eventId, planId, {
          email: "organizer@example.test",
          phone: null,
        });
      } finally {
        client.release();
      }
      const warning = (await alertsOf(eventId)).find((row) => row.alert_type === "slack_warning");
      expect(warning).toBeDefined();
      // The send failed, which is what gives the edit a window to land in.
      await pool.query("UPDATE alerts SET status = 'failed', failure_count = 1 WHERE id = $1", [
        warning?.id,
      ]);

      await pool.query("UPDATE events SET revision_counter = revision_counter + 1 WHERE id = $1", [
        eventId,
      ]);

      const provider = fakeProvider();
      await createAlertPoller({
        database: pool,
        senders: provider.senders,
        jurisdiction: ruleset.jurisdiction,
      }).tick();

      expect(provider.attempts).toHaveLength(0);
      const after = (await alertsOf(eventId)).find((row) => row.alert_type === "slack_warning");
      // Held for the review to decide, exactly as the checklist-backed rows are.
      expect(after?.status).toBe("failed");
    });

    it("delivers the slack warning again once its plan names the current revision", async () => {
      // Holding is not dropping, the same half this needed for the checklist-backed case.
      const eventId = await createEvent(scenario("C"));
      const { planId } = await insertDuePlan(eventId, {
        verdict: "feasible_at_risk",
        minSlackDays: 9,
        latestApplyDate: dayFromToday(30),
      });
      const client = await pool.connect();
      try {
        await schedulerWith()(client, eventId, planId, {
          email: "organizer@example.test",
          phone: null,
        });
      } finally {
        client.release();
      }
      await pool.query("UPDATE events SET revision_counter = revision_counter + 1 WHERE id = $1", [
        eventId,
      ]);
      const provider = fakeProvider();
      const poller = createAlertPoller({
        database: pool,
        senders: provider.senders,
        jurisdiction: ruleset.jurisdiction,
      });
      expect((await poller.tick()).sent).toBe(0);

      await pool.query(
        `UPDATE permit_plans SET event_revision = (SELECT revision_counter FROM events WHERE id = $1)
          WHERE event_id = $1`,
        [eventId],
      );
      // The review rewrites the payload, revision included, which is what makes it current again.
      const reviewing = await pool.connect();
      try {
        await schedulerWith()(reviewing, eventId, planId, {
          email: "organizer@example.test",
          phone: null,
        });
      } finally {
        reviewing.release();
      }

      expect((await poller.tick()).sent).toBe(1);
      expect(provider.delivered).toHaveLength(1);
    });

    it("delivers inside the bound when a whole tick was skipped", async () => {
      // Round 13 taught the tick that a skipped alert is not a completed one. This is the same
      // distinction one layer up, at the poller: a tick where EVERY due alert was skipped comes
      // back with no sends, and the respawn guard read that as "nothing to do" and waited out
      // the interval. So an alert falling due just after an idle scan waited nearly a full
      // interval for the tick, was skipped, and then waited another whole interval before a
      // healthy provider was ever asked. Past AC 2 with nothing failing.
      //
      // THE BOUND IS THE ASSERTION. The interval is pinned at its default here, so the only way
      // to land inside AC 2's window is the follow-up scan; waiting for the timer would blow the
      // deadline by itself.
      const eventId = await createEvent(scenario("C"));
      await schedulePastDue(eventId, [reminderOffsets[0] ?? 7]);
      const provider = fakeProvider();
      const poller = createAlertPoller({
        database: pool,
        senders: provider.senders,
        jurisdiction: ruleset.jurisdiction,
      });
      const reviewer = await pool.connect();
      const startedAt = Date.now();
      try {
        // Held past the tick's own retry window, so the tick ends having attempted nothing.
        await reviewer.query("BEGIN");
        await reviewer.query("SELECT id FROM events WHERE id = $1 FOR UPDATE", [eventId]);
        poller.start();
        await new Promise((resolve) => setTimeout(resolve, 3_000));
        await reviewer.query("COMMIT");

        await vi.waitFor(
          async () => {
            const [row] = await alertsOf(eventId);
            expect(row?.status).toBe("sent");
          },
          { timeout: 20_000, interval: 250 },
        );
      } finally {
        poller.stop();
        reviewer.release();
      }

      const [delivered] = await alertsOf(eventId);
      const tookMs = (delivered?.sent_at?.getTime() ?? 0) - startedAt;
      expect(tookMs).toBeLessThan(DELIVERY_BOUND_MS);
      // The sharper statement: it did not wait for the next scheduled scan.
      expect(tookMs).toBeLessThan(POLL_INTERVAL_MS);
    }, 30_000);

    it("does not warn about slack once every filing date has passed", async () => {
      // The stale-plan class again, keyed on DATES rather than on revision. Nothing was edited, so
      // the plan is revision-current and round 14's predicate cannot see this. A plan generated
      // while feasible-at-risk and materialized only after its filing dates have gone still queued
      // an immediate "apply within N days" over a window that had closed.
      const eventId = await createEvent(scenario("C"));
      const { planId } = await insertDuePlan(eventId, {
        verdict: "feasible_at_risk",
        minSlackDays: 9,
        latestApplyDate: dayFromToday(-3),
      });
      const client = await pool.connect();
      try {
        await schedulerWith()(client, eventId, planId, {
          email: "organizer@example.test",
          phone: null,
        });
      } finally {
        client.release();
      }

      const rows = await alertsOf(eventId);
      expect(rows.some((row) => row.alert_type === "slack_warning")).toBe(false);
      // The reminder loop already refused the past date, which is what left this branch alone.
      expect(rows.some((row) => row.alert_type === "deadline_reminder")).toBe(false);
    });

    it("does not warn when the requirement the number describes has expired", async () => {
      // Round 17 asked whether ANY window is open. The number in the copy comes from ONE
      // requirement, so on a plan with several dated ones the requirement that PRODUCED the
      // minimum can expire while a later one holds the guard true, and the warning goes out
      // counting down a deadline already missed.
      //
      // Here the controlling requirement had 9 days of slack and its filing date has gone; a
      // second requirement with 40 days of slack is still open. "Apply within 9 days" describes
      // the expired one.
      const eventId = await createEvent(scenario("C"));
      const { planId } = await insertDuePlan(eventId, {
        verdict: "feasible_at_risk",
        minSlackDays: 9,
        latestApplyDate: dayFromToday(-3),
        laterDated: { latestApplyDate: dayFromToday(40), slackDays: 40 },
      });
      const client = await pool.connect();
      try {
        await schedulerWith()(client, eventId, planId, {
          email: "organizer@example.test",
          phone: null,
        });
      } finally {
        client.release();
      }

      const rows = await alertsOf(eventId);
      expect(rows.some((row) => row.alert_type === "slack_warning")).toBe(false);
      // Not vacuous: the later requirement really is open, so the round 17 guard passes here and
      // reminders for it really are scheduled. Only the warning is withheld.
      expect(rows.some((row) => row.alert_type === "deadline_reminder")).toBe(true);
    });

    it("warns when the requirement the number describes is the one still open", async () => {
      // The mirror, so the narrowing cannot be rewritten as "never warn on a plan with a passed
      // date". Here the controlling requirement is the one that is still ahead.
      const eventId = await createEvent(scenario("C"));
      const { planId } = await insertDuePlan(eventId, {
        verdict: "feasible_at_risk",
        minSlackDays: 9,
        latestApplyDate: dayFromToday(9),
        laterDated: { latestApplyDate: dayFromToday(40), slackDays: 40 },
      });
      const client = await pool.connect();
      try {
        await schedulerWith()(client, eventId, planId, {
          email: "organizer@example.test",
          phone: null,
        });
      } finally {
        client.release();
      }

      expect((await alertsOf(eventId)).some((row) => row.alert_type === "slack_warning")).toBe(
        true,
      );
    });

    it("still warns about slack while a filing date is ahead", async () => {
      // The other half, so the guard cannot be written as "never warn on an old plan".
      const eventId = await createEvent(scenario("C"));
      const { planId } = await insertDuePlan(eventId, {
        verdict: "feasible_at_risk",
        minSlackDays: 9,
        latestApplyDate: dayFromToday(30),
      });
      const client = await pool.connect();
      try {
        await schedulerWith()(client, eventId, planId, {
          email: "organizer@example.test",
          phone: null,
        });
      } finally {
        client.release();
      }

      expect((await alertsOf(eventId)).some((row) => row.alert_type === "slack_warning")).toBe(
        true,
      );
    });

    it("does not deliver a reminder for a filing date that passed during an outage", async () => {
      // The system already holds this opinion: `plannedAlerts` refuses to CREATE a reminder for a
      // filing date that has gone. The claim never asked the same question, so an outage spanning
      // the deadline left the row eligible and the poller delivered "file by <a day that has
      // passed>" on recovery. One question, two answers, and the one that shipped never asked.
      const eventId = await createEvent(scenario("C"));
      await schedulePastDue(eventId, [reminderOffsets[0] ?? 7]);
      const before = await alertsOf(eventId);
      expect(before).toHaveLength(1);
      // The provider was down while the deadline went by.
      await pool.query("UPDATE alerts SET status = 'failed', failure_count = 2 WHERE id = $1", [
        before[0]?.id,
      ]);
      await pool.query(
        `UPDATE permit_plan_items SET latest_apply_date = current_date - 5
          WHERE plan_id IN (SELECT plan_id FROM permit_plan_items WHERE id IN (
            SELECT plan_item_id FROM checklist_items WHERE id = $1))`,
        [before[0]?.checklist_item_id],
      );
      const provider = fakeProvider();

      await createAlertPoller({
        database: pool,
        senders: provider.senders,
        jurisdiction: ruleset.jurisdiction,
      }).tick();

      expect(provider.attempts).toHaveLength(0);
      // Cancelled rather than held: unlike a stale plan, no future review can revive this, because
      // the scheduler refuses to re-create an alert for a window that has shut. Leaving it pending
      // would also report it to the organizer as a delivery still being retried.
      expect((await alertsOf(eventId))[0]?.status).toBe("cancelled");
    });

    it("still delivers a reminder whose filing date is ahead", async () => {
      // The mirror, so the guard cannot be written as "never deliver a failed reminder".
      const eventId = await createEvent(scenario("C"));
      await schedulePastDue(eventId, [reminderOffsets[0] ?? 7]);
      await pool.query(
        "UPDATE alerts SET status = 'failed', failure_count = 2 WHERE event_id = $1",
        [eventId],
      );
      const provider = fakeProvider();

      await createAlertPoller({
        database: pool,
        senders: provider.senders,
        jurisdiction: ruleset.jurisdiction,
      }).tick();

      expect(provider.delivered).toHaveLength(1);
      expect((await alertsOf(eventId))[0]?.status).toBe("sent");
    });

    it("does not anchor a gated slack figure to a date", async () => {
      // A REGRESSION FROM ROUND 19, and this file's own argument refutes it. Anchoring "apply
      // within N days" to a date is right when N counts down from that date. It is wrong when N is
      // a WIDTH: F-102 fixes gated slack as latest_apply minus apply_after, so anchoring it
      // instructs the organizer to act by a day that may fall before the window even opens. That
      // is a filing date no source publishes, in the one line most organizers read.
      const eventId = await createEvent(scenario("C"));
      const { planId } = await insertDuePlan(eventId, {
        verdict: "feasible_at_risk",
        minSlackDays: 9,
        latestApplyDate: dayFromToday(30),
        applyAfterDate: dayFromToday(21),
      });
      const client = await pool.connect();
      try {
        await schedulerWith()(client, eventId, planId, {
          email: "organizer@example.test",
          phone: null,
        });
      } finally {
        client.release();
      }

      const warning = (await alertsOf(eventId)).find((row) => row.alert_type === "slack_warning");
      expect(warning?.payload.subject).toBe("At risk — the narrowest filing window is 9 days wide");
      // The anchor is the specific harm: it is what turns a width into a deadline.
      expect(String(warning?.payload.subject)).not.toContain("apply within");
      // No date anywhere in it: an anchor is what turns the width into a deadline.
      expect(String(warning?.payload.subject)).not.toMatch(/\d{4}-\d{2}-\d{2}/);
    });

    it("does not cancel a held stale-plan alert on the old plan's date", async () => {
      // Two of my own fixes disagreed. Round 14 HOLDS a stale-plan alert so the review can decide
      // it; round 19's sweep then cancelled it using the obsolete plan's filing date, deciding it
      // was withdrawn before regeneration had established whether its replacement is required, and
      // taking the failure evidence off the organizer's screen on the way.
      const eventId = await createEvent(scenario("C"));
      await schedulePastDue(eventId, [reminderOffsets[0] ?? 7]);
      const before = await alertsOf(eventId);
      await pool.query("UPDATE alerts SET status = 'failed', failure_count = 1 WHERE id = $1", [
        before[0]?.id,
      ]);
      // The old plan's filing date has passed AND the event has been edited past that plan.
      await pool.query(
        `UPDATE permit_plan_items SET latest_apply_date = current_date - 5
          WHERE id IN (SELECT plan_item_id FROM checklist_items WHERE id = $1)`,
        [before[0]?.checklist_item_id],
      );
      await pool.query("UPDATE events SET revision_counter = revision_counter + 1 WHERE id = $1", [
        eventId,
      ]);
      const provider = fakeProvider();

      await createAlertPoller({
        database: pool,
        senders: provider.senders,
        jurisdiction: ruleset.jurisdiction,
      }).tick();

      expect(provider.attempts).toHaveLength(0);
      // Held for the review, not cancelled by the poller on a date that belongs to the old event.
      expect((await alertsOf(eventId))[0]?.status).toBe("failed");
    });

    it("cancels a reminder whose filing date passed yesterday, with no grace day", async () => {
      // Round 19 compared against UTC yesterday because the poller had no jurisdiction, which meant
      // a "file by yesterday" reminder stayed eligible for a further day and an outage recovery
      // delivered copy already known to be stale. The jurisdiction clock is the one index.ts
      // already uses for `today`, so there is no trade to make here.
      const eventId = await createEvent(scenario("C"));
      await schedulePastDue(eventId, [reminderOffsets[0] ?? 7]);
      const before = await alertsOf(eventId);
      await pool.query("UPDATE alerts SET status = 'failed', failure_count = 1 WHERE id = $1", [
        before[0]?.id,
      ]);
      await pool.query(
        `UPDATE permit_plan_items SET latest_apply_date = $2::date
          WHERE id IN (SELECT plan_item_id FROM checklist_items WHERE id = $1)`,
        [before[0]?.checklist_item_id, dayFromToday(-1)],
      );
      const provider = fakeProvider();

      await createAlertPoller({
        database: pool,
        senders: provider.senders,
        jurisdiction: ruleset.jurisdiction,
      }).tick();

      expect(provider.attempts).toHaveLength(0);
      expect((await alertsOf(eventId))[0]?.status).toBe("cancelled");
    });

    it("makes a reminder created inside its own window due now rather than in the past", async () => {
      // AC 2 measures delivery from `send_at`. Persisting the original offset day for a checklist
      // materialized INSIDE the reminder window put that instant days behind, so the row failed the
      // two-minute bound by arithmetic before the poller had done anything: an empty queue and a
      // healthy provider still recorded it late. The spec's edge case says it goes out immediately,
      // and this is what immediately means.
      const startedAt = Date.now();
      const eventId = await createEvent(scenario("C"));
      await schedulePastDue(eventId, [reminderOffsets[0] ?? 7]);

      const [reminder] = await alertsOf(eventId);
      expect(reminder?.alert_type).toBe("deadline_reminder");
      expect(reminder?.send_at.getTime()).toBeGreaterThanOrEqual(startedAt - 1_000);
      expect(reminder?.send_at.getTime()).toBeLessThanOrEqual(Date.now() + 1_000);
      // The intended slot still decides identity and copy: it is a catch-up and still says so.
      expect(String(reminder?.payload.body)).toContain(
        "sent now because your checklist was created after that day had already passed",
      );
    });

    it("calls an ungated controlling minimum a countdown even when the plan has a gated row", async () => {
      // THE CASE THE PROXY GETS WRONG. `planHasGatedFiling` is true if ANY row is gated; the
      // question is whether the row that PRODUCED the number is. A park event with a closer
      // ordinary filing deadline has both, and the copy then called an ungated countdown a window
      // width. Here the controlling minimum is 5 days from an UNGATED requirement, while a gated
      // one sits behind it at 40.
      const eventId = await createEvent(scenario("C"));
      const { planId } = await insertDuePlan(eventId, {
        verdict: "feasible_at_risk",
        minSlackDays: 40,
        latestApplyDate: dayFromToday(30),
        applyAfterDate: dayFromToday(21),
        laterDated: { latestApplyDate: dayFromToday(5), slackDays: 5 },
      });
      await pool.query(
        `UPDATE permit_plans SET verdict_detail = jsonb_set(verdict_detail, '{minSlackDays}', '5')
          WHERE id = $1`,
        [planId],
      );
      const client = await pool.connect();
      try {
        await schedulerWith()(client, eventId, planId, {
          email: "organizer@example.test",
          phone: null,
        });
      } finally {
        client.release();
      }

      const warning = (await alertsOf(eventId)).find((row) => row.alert_type === "slack_warning");
      // The controlling requirement is ungated, so the number IS a countdown and is anchored.
      expect(warning?.payload.subject).toBe(
        `At risk — apply within 5 days of ${todayInJurisdiction("US-NY-NYC")}`,
      );
      expect(String(warning?.payload.body)).toContain("measured from the plan's evaluation date");
      expect(String(warning?.payload.body)).not.toContain("WIDTH of the window");
    });

    it("cancels a slack warning whose controlling window shut during an outage", async () => {
      // The sweep excluded this by TYPE, because a plan-level warning has no checklist item to join
      // through. So an immediate warning that failed during an outage, whose window shut before
      // delivery recovered, was still selected by the due query and went out saying "apply within N
      // days" that scheduling would now refuse to create. The type filter was a way of not asking
      // the question; the warning now carries its own controlling date so it can be asked.
      const eventId = await createEvent(scenario("C"));
      const { planId } = await insertDuePlan(eventId, {
        verdict: "feasible_at_risk",
        minSlackDays: 9,
        latestApplyDate: dayFromToday(9),
      });
      const client = await pool.connect();
      try {
        await schedulerWith()(client, eventId, planId, {
          email: "organizer@example.test",
          phone: null,
        });
      } finally {
        client.release();
      }
      const warning = (await alertsOf(eventId)).find((row) => row.alert_type === "slack_warning");
      expect(warning).toBeDefined();
      await pool.query("UPDATE alerts SET status = 'failed', failure_count = 1 WHERE id = $1", [
        warning?.id,
      ]);
      // The outage outlasted the window the number counted down to.
      await pool.query(
        `UPDATE alerts SET payload = payload || jsonb_build_object('controlling_apply_by', $2::text)
          WHERE id = $1`,
        [warning?.id, dayFromToday(-1)],
      );
      const provider = fakeProvider();

      await createAlertPoller({
        database: pool,
        senders: provider.senders,
        jurisdiction: ruleset.jurisdiction,
      }).tick();

      expect(provider.attempts).toHaveLength(0);
      const after = (await alertsOf(eventId)).find((row) => row.alert_type === "slack_warning");
      expect(after?.status).toBe("cancelled");
    });

    it("does not make a full batch wait an interval for the rest", async () => {
      // THE THIRD TIME THIS SHAPE HAS BITTEN, so the fix is the distinction rather than the case.
      // The scan is capped, so a tick that fills its batch has NOT reached the end of the work —
      // but with every send succeeding it reported no shortfall at all, `start` read that as a
      // finished tick, and the overflow waited a whole interval. Round 16 was the same missing
      // distinction with an all-skipped tick. The summary now says whether it drained the queue,
      // so both cases and any future one collapse into one question.
      const eventId = await createEvent(scenario("C"));
      const overflow = 97;
      await pool.query(
        `INSERT INTO alerts (id, event_id, alert_type, channel, recipient, idempotency_key,
                               send_at, status, payload)
           SELECT gen_random_uuid(), $1, 'slack_warning', 'email', 'organizer@example.test',
                  $2 || ':batch:' || step, current_timestamp - interval '1 minute', 'pending',
                  '{"subject":"s","body":"b"}'::jsonb
             FROM generate_series(1, $3) AS step`,
        [eventId, `${eventId}`, overflow],
      );
      const provider = fakeProvider();
      const poller = createAlertPoller({
        database: pool,
        senders: provider.senders,
        jurisdiction: ruleset.jurisdiction,
      });
      const startedAt = Date.now();

      poller.start();
      try {
        await vi.waitFor(
          async () => {
            const { rows } = await pool.query<{ pending: string }>(
              "SELECT count(*)::text AS pending FROM alerts WHERE event_id = $1 AND status <> 'sent'",
              [eventId],
            );
            expect(rows[0]?.pending).toBe("0");
          },
          { timeout: 30_000, interval: 250 },
        );
      } finally {
        poller.stop();
      }

      // The whole set went out without waiting for the next scheduled scan, which is the bound
      // the overflow used to miss with a healthy provider and an otherwise empty queue.
      expect(Date.now() - startedAt).toBeLessThan(POLL_INTERVAL_MS);
      expect(provider.delivered.length).toBe(overflow);
    }, 45_000);

    it("reports a full batch as not drained", async () => {
      // The statement the poller now reads, asserted directly so the classification is pinned and
      // not only its consequence.
      const eventId = await createEvent(scenario("C"));
      await pool.query(
        `INSERT INTO alerts (id, event_id, alert_type, channel, recipient, idempotency_key,
                             send_at, status, payload)
         SELECT gen_random_uuid(), $1, 'slack_warning', 'email', 'organizer@example.test',
                $2 || ':full:' || step, current_timestamp - interval '1 minute', 'pending',
                '{"subject":"s","body":"b"}'::jsonb
           FROM generate_series(1, 97) AS step`,
        [eventId, `${eventId}`],
      );
      const provider = fakeProvider();

      const summary = await createAlertPoller({
        database: pool,
        senders: provider.senders,
        jurisdiction: ruleset.jurisdiction,
      }).tick();

      expect(summary.sent).toBeGreaterThan(0);
      expect(summary.abandoned).toBe(0);
      // Everything it claimed succeeded, and it still did not reach the end.
      expect(summary.drained).toBe(false);
    });

    it("sizes a first pass to the budget left after the polling delay", async () => {
      // THE BOUND, IN TIME, not the formula restated. AC 2 runs from `send_at`; the tick's clock
      // starts at the tick. An alert that fell due just after a scan has already spent a whole
      // polling interval before anything looks at it, so a pass sized against the FULL bound hands
      // the provider a budget the alert no longer has. Ninety-five email sends timing out at ten
      // seconds each is eleven waves, and the healthy one behind them started about 170 seconds
      // from its own send_at with every counter reporting health.
      //
      // What must hold is that a full first pass, at the provider's worst case, fits inside what
      // REMAINS of the bound. This is that sentence in milliseconds, and it fails for any cap that
      // breaks it rather than for one particular arithmetic.
      //
      // READ FROM THE SEND CONCURRENCY, not from the pool size. Those were the same number until
      // the pool was resized, and then this assertion silently doubled the concurrency it was
      // checking against (sixteen waves where the poller runs eight), so a scan-cap change that
      // broke the budget would have left it green.
      const worstCaseFirstPassMs =
        Math.ceil(MAX_ALERTS_PER_TICK / SEND_CONCURRENCY) * PROVIDER_TIMEOUT_MS;

      expect(worstCaseFirstPassMs).toBeLessThanOrEqual(DELIVERY_BOUND_MS - POLL_INTERVAL_MS);
      // AND INSIDE THE BUDGET THE TICK ACTUALLY HAS. Two bounds, and this is the tighter one today.
      // A cap larger than the tick can attempt makes the scan hand itself work it must abandon, so
      // fresh alerts queue behind rows the previous pass already had its turn on.
      expect(worstCaseFirstPassMs).toBeLessThanOrEqual(TICK_BUDGET_MS);
      // And it is not trivially small: a cap of nothing would satisfy the lines above.
      expect(MAX_ALERTS_PER_TICK).toBeGreaterThanOrEqual(SEND_CONCURRENCY);
      // The pool still has to hold every send at once plus the scan that feeds them. Asserted
      // here because the arithmetic above no longer reads it and would not notice it shrinking.
      expect(ALERT_POLLER_CONNECTIONS).toBeGreaterThan(SEND_CONCURRENCY);
    });

    it("delivers more than one pass worth without waiting an interval", async () => {
      // The smaller cap costs no throughput, because a scan that comes back at its limit reports
      // not-drained and the rescan is immediate. Passes before and after the cap change and is
      // here to catch a cap reduction that quietly halves delivery rate, not as evidence for it.
      const eventId = await createEvent(scenario("C"));
      const overflow = MAX_ALERTS_PER_TICK + 5;
      await pool.query(
        `INSERT INTO alerts (id, event_id, alert_type, channel, recipient, idempotency_key,
                             send_at, status, payload)
         SELECT gen_random_uuid(), $1, 'slack_warning', 'email', 'organizer@example.test',
                $2 || ':budget:' || step, current_timestamp - interval '1 minute', 'pending',
                '{"subject":"s","body":"b"}'::jsonb
           FROM generate_series(1, $3) AS step`,
        [eventId, `${eventId}`, overflow],
      );
      const provider = fakeProvider();
      const poller = createAlertPoller({
        database: pool,
        senders: provider.senders,
        jurisdiction: ruleset.jurisdiction,
      });
      const startedAt = Date.now();

      poller.start();
      try {
        await vi.waitFor(
          async () => {
            const { rows } = await pool.query<{ pending: string }>(
              "SELECT count(*)::text AS pending FROM alerts WHERE event_id = $1 AND status <> 'sent'",
              [eventId],
            );
            expect(rows[0]?.pending).toBe("0");
          },
          { timeout: 20_000, interval: 250 },
        );
      } finally {
        poller.stop();
      }

      expect(Date.now() - startedAt).toBeLessThan(POLL_INTERVAL_MS);
      expect(provider.delivered.length).toBe(overflow);
    }, 30_000);

    it("reports an empty scan as drained, so the rescan cannot spin", async () => {
      // The interaction to confirm rather than assume: a smaller cap fills more scans, and a full
      // scan respawns immediately. An empty one must not, or the poller would chase itself.
      const provider = fakeProvider();

      const summary = await createAlertPoller({
        database: pool,
        senders: provider.senders,
        jurisdiction: ruleset.jurisdiction,
      }).tick();

      expect(summary.sent + summary.failed).toBe(0);
      expect(summary.abandoned).toBe(0);
      expect(summary.drained).toBe(true);
    });

    it("keeps a tied slack warning alive until every controlling window has closed", async () => {
      // The same tie as the copy's, resolved the OTHER way, and both are the same rule: break it in
      // the direction that cannot harm the organizer. For copy that means never asserting a
      // deadline the sources do not publish. Here it means never silencing a warning that is still
      // true. Taking the earliest tied date cancelled the warning the moment the first requirement
      // expired, while another controlling window was still open — and the next scheduling pass
      // would recreate exactly what had just been cancelled, so after a long outage the at-risk
      // alert simply disappeared.
      //
      // BOTH must be open when the warning is written, or there is no tie to break: a requirement
      // that has already closed is not a controlling candidate at all.
      const eventId = await createEvent(scenario("C"));
      const { planId } = await insertDuePlan(eventId, {
        verdict: "feasible_at_risk",
        minSlackDays: 9,
        latestApplyDate: dayFromToday(1),
        laterDated: { latestApplyDate: dayFromToday(20), slackDays: 9 },
      });
      const client = await pool.connect();
      try {
        await schedulerWith()(client, eventId, planId, {
          email: "organizer@example.test",
          phone: null,
        });
      } finally {
        client.release();
      }

      const warning = (await alertsOf(eventId)).find((row) => row.alert_type === "slack_warning");
      expect(warning).toBeDefined();
      // The LAST of the tied dates, which is the day the number stops being true of anything. With
      // the earliest, tomorrow's expiry would cancel a warning whose other controlling window has
      // nineteen days left.
      expect(warning?.payload.controlling_apply_by).toBe(dayFromToday(20));
    });

    it("keeps one provider identity when a review rewrites a pending alert's copy", async () => {
      // THE CRASH WINDOW, DEFEATED BY THE MECHANISM COVERING IT. The provider accepts, the process
      // dies before COMMIT so the whole transaction rolls back and the row is byte-identical to
      // before the attempt, a checklist review then rewrites that pending row's subject and body,
      // and the retry used to present a different provider identity. The provider could not
      // recognise it and the same person was messaged twice, which is exactly what AC 2 says a
      // crash between send and mark-sent must not cause.
      const eventId = await createEvent(scenario("C"));
      await schedulePastDue(eventId, [reminderOffsets[0] ?? 7]);
      const [before] = await alertsOf(eventId);
      const provider = fakeProvider();
      const poller = createAlertPoller({
        database: pool,
        senders: provider.senders,
        jurisdiction: ruleset.jurisdiction,
      });

      await poller.tick();
      expect(provider.delivered).toHaveLength(1);
      const firstKey = provider.attempts[0]?.idempotencyKey;

      // The crash: the mark-sent is rolled back and the row is exactly as it was.
      await pool.query("UPDATE alerts SET status = 'pending', sent_at = NULL WHERE id = $1", [
        before?.id,
      ]);
      // A review recomputes the copy on that pending row.
      await pool.query(
        `UPDATE alerts SET payload = payload || '{"subject":"moved","body":"file by a new date"}'::jsonb
          WHERE id = $1`,
        [before?.id],
      );

      await poller.tick();

      // Same identity, so the provider recognises the retry and the organizer is messaged once.
      expect(provider.attempts).toHaveLength(2);
      expect(provider.attempts[1]?.idempotencyKey).toBe(firstKey);
      expect(provider.delivered).toHaveLength(1);
    });

    it("gives a revived alert a fresh send_at rather than its pre-cancellation one", async () => {
      // The transition set was incomplete when send_at started keying on the intended slot. A
      // cancelled row was NOT in the queue while it was cancelled, so its stored send_at is not a
      // record of having been due; returning it to pending with that value made it deliverable
      // immediately, recorded as blowing AC 2's bound by however long it sat, and sorted ahead of
      // genuinely older work.
      const eventId = await createEvent(scenario("C"));
      const contacts = { email: "organizer@example.test", phone: null };
      const gated = await insertDuePlan(eventId, {
        latestApplyDate: dayFromToday(30),
        applyAfterDate: dayFromToday(21),
      });
      const client = await pool.connect();
      try {
        await schedulerWith()(client, eventId, gated.planId, contacts);
        const unlock = (await alertsOf(eventId)).find(
          (row) => row.alert_type === "dependency_unlocked",
        );
        // Days in the past, as a long-cancelled row's stored slot would be.
        await pool.query(
          "UPDATE alerts SET send_at = clock_timestamp() - interval '9 days' WHERE id = $1",
          [unlock?.id],
        );
        const stale = (await alertsOf(eventId)).find((row) => row.id === unlock?.id);

        // The requirement disappears, so the alert is cancelled.
        const ungated = await insertDuePlan(eventId, {
          latestApplyDate: dayFromToday(30),
          reuseChecklistItemId: gated.checklistItemId,
        });
        await schedulerWith()(client, eventId, ungated.planId, contacts);
        expect((await alertsOf(eventId)).find((row) => row.id === unlock?.id)?.status).toBe(
          "cancelled",
        );

        // And returns.
        const regated = await insertDuePlan(eventId, {
          latestApplyDate: dayFromToday(30),
          applyAfterDate: dayFromToday(21),
          reuseChecklistItemId: gated.checklistItemId,
        });
        await schedulerWith()(client, eventId, regated.planId, contacts);

        const revived = (await alertsOf(eventId)).find((row) => row.id === unlock?.id);
        expect(revived?.status).toBe("pending");
        expect(revived?.send_at.getTime()).not.toBe(stale?.send_at.getTime());
        // Not days behind: a revival is a fresh schedule, so the bound is measurable from it.
        expect(Date.now() - (revived?.send_at.getTime() ?? 0)).toBeLessThan(DELIVERY_BOUND_MS);
      } finally {
        client.release();
      }
    });

    it("keeps a slack warning's send_at and backoff across a review", async () => {
      // The plan-level warning is the only alert with no intended slot, so both sides of the
      // comparison are NULL and it takes the unchanged branch on every review. That is deliberate
      // rather than an accident of NULL comparison: the warning has been genuinely due since it was
      // written, so keeping its send_at reports real lateness instead of manufacturing freshness,
      // and its backoff is evidence about a destination that has not changed, which is round 9.
      const eventId = await createEvent(scenario("C"));
      const contacts = { email: "dead@example.test", phone: null };
      const { planId } = await insertDuePlan(eventId, {
        verdict: "feasible_at_risk",
        minSlackDays: 9,
        latestApplyDate: dayFromToday(9),
      });
      const client = await pool.connect();
      try {
        await schedulerWith()(client, eventId, planId, contacts);
        const warning = (await alertsOf(eventId)).find((row) => row.alert_type === "slack_warning");
        expect(warning?.payload.intended_at).toBeUndefined();
        await pool.query(
          `UPDATE alerts SET status = 'failed', failure_count = 3,
                             next_attempt_at = clock_timestamp() + interval '15 minutes'
            WHERE id = $1`,
          [warning?.id],
        );
        await new Promise((resolve) => setTimeout(resolve, 25));

        await schedulerWith()(client, eventId, planId, contacts);

        const after = (await alertsOf(eventId)).find((row) => row.id === warning?.id);
        expect(after?.send_at.getTime()).toBe(warning?.send_at.getTime());
        expect(after?.next_attempt_at).not.toBeNull();
      } finally {
        client.release();
      }
    });

    it("does not carry a withdrawn lifecycle's provider error into a revived alert", async () => {
      // Round 33 decided a revival is a fresh schedule because a cancelled row was not in the queue
      // while it was cancelled. last_error is evidence from exactly that ended membership, so it
      // goes with the failure_count that branch already cleared. Left behind, a revived pending row
      // and later a successfully sent one kept reporting a provider error from a finished lifecycle.
      const eventId = await createEvent(scenario("C"));
      const contacts = { email: "organizer@example.test", phone: null };
      const gated = await insertDuePlan(eventId, {
        latestApplyDate: dayFromToday(30),
        applyAfterDate: dayFromToday(21),
      });
      const client = await pool.connect();
      try {
        await schedulerWith()(client, eventId, gated.planId, contacts);
        const unlock = (await alertsOf(eventId)).find(
          (row) => row.alert_type === "dependency_unlocked",
        );
        await pool.query(
          `UPDATE alerts SET status = 'failed', failure_count = 2,
                             payload = payload || '{"last_error":"provider rejected 550"}'::jsonb
            WHERE id = $1`,
          [unlock?.id],
        );

        // The requirement disappears, so the alert is withdrawn.
        const ungated = await insertDuePlan(eventId, {
          latestApplyDate: dayFromToday(30),
          reuseChecklistItemId: gated.checklistItemId,
        });
        await schedulerWith()(client, eventId, ungated.planId, contacts);
        expect((await alertsOf(eventId)).find((row) => row.id === unlock?.id)?.status).toBe(
          "cancelled",
        );

        // And returns.
        const regated = await insertDuePlan(eventId, {
          latestApplyDate: dayFromToday(30),
          applyAfterDate: dayFromToday(21),
          reuseChecklistItemId: gated.checklistItemId,
        });
        await schedulerWith()(client, eventId, regated.planId, contacts);

        const revived = (await alertsOf(eventId)).find((row) => row.id === unlock?.id);
        expect(revived?.status).toBe("pending");
        expect(revived?.payload.last_error).toBeUndefined();
        // The copy is still recomputed, so this is not passing by the payload having been frozen.
        expect(revived?.payload.subject).toBeDefined();
      } finally {
        client.release();
      }
    });

    it("keeps the failure reason on a failed row the review did not withdraw", async () => {
      // The other half. A reminder that stayed in the queue keeps its evidence, which is round 9
      // and round 27, so the rule above cannot be rewritten as always clearing.
      const eventId = await createEvent(scenario("C"));
      await materialize(eventId, { contactEmail: "dead@example.test" });
      await pool.query(
        `UPDATE alerts SET status = 'failed', failure_count = 1,
                           payload = payload || '{"last_error":"provider rejected 550"}'::jsonb
          WHERE event_id = $1`,
        [eventId],
      );

      await materialize(eventId, { contactEmail: "dead@example.test" });

      const after = await alertsOf(eventId);
      expect(after.every((row) => row.payload.last_error === "provider rejected 550")).toBe(true);
    });

    it("clears the retry state when a cancelled alert is revived", async () => {
      // The third transition this clause has had to answer. Round 9 decided an unchanged
      // destination keeps its evidence and round 11 decided a corrected address gets its own row,
      // so it starts fresh by construction. Cancelled-then-revived is neither: the requirement went
      // away and came back, and the row that returns is the one that was withdrawn. Keeping the old
      // counters made an immediately due revived alert sit out a fifteen-minute backoff earned
      // before it was cancelled, and scored its next failure as a high-count retry.
      const eventId = await createEvent(scenario("C"));
      const contacts = { email: "organizer@example.test", phone: null };
      const gated = await insertDuePlan(eventId, {
        latestApplyDate: dayFromToday(30),
        applyAfterDate: dayFromToday(21),
      });
      const client = await pool.connect();
      try {
        await schedulerWith()(client, eventId, gated.planId, contacts);
        const unlock = (await alertsOf(eventId)).find(
          (row) => row.alert_type === "dependency_unlocked",
        );
        // It failed its way into the longest backoff before the requirement disappeared.
        await pool.query(
          `UPDATE alerts SET status = 'failed', failure_count = 3,
                             next_attempt_at = clock_timestamp() + interval '15 minutes'
            WHERE id = $1`,
          [unlock?.id],
        );

        // The requirement disappears, so the alert is cancelled.
        const ungated = await insertDuePlan(eventId, {
          latestApplyDate: dayFromToday(30),
          reuseChecklistItemId: gated.checklistItemId,
        });
        await schedulerWith()(client, eventId, ungated.planId, contacts);
        expect((await alertsOf(eventId)).find((row) => row.id === unlock?.id)?.status).toBe(
          "cancelled",
        );

        // And returns.
        const regated = await insertDuePlan(eventId, {
          latestApplyDate: dayFromToday(30),
          applyAfterDate: dayFromToday(21),
          reuseChecklistItemId: gated.checklistItemId,
        });
        await schedulerWith()(client, eventId, regated.planId, contacts);

        const revived = (await alertsOf(eventId)).find((row) => row.id === unlock?.id);
        expect(revived?.status).toBe("pending");
        expect(revived?.failure_count).toBe(0);
        expect(revived?.next_attempt_at).toBeNull();
      } finally {
        client.release();
      }
    });

    it("clears a stale backoff when regeneration moves the alert", async () => {
      // The fourth transition, and the reason it is one rule rather than a fourth branch:
      // failure_count is EVIDENCE about a destination and survives what the plan recomputes, while
      // next_attempt_at is DERIVED from that evidence at a moment and cannot outlive the schedule
      // it was anchored to. A row in the fifteen-minute backoff, recomputed as due now, was staying
      // ineligible for the rest of a delay measured against a send time that no longer exists.
      const eventId = await createEvent(scenario("C"));
      const contacts = { email: "organizer@example.test", phone: null };
      const first = await insertDuePlan(eventId, { latestApplyDate: dayFromToday(30) });
      const client = await pool.connect();
      try {
        await schedulerWith()(client, eventId, first.planId, contacts);
        const before = (await alertsOf(eventId))[0];
        await pool.query(
          `UPDATE alerts SET status = 'failed', failure_count = 3,
                             next_attempt_at = clock_timestamp() + interval '15 minutes'
            WHERE id = $1`,
          [before?.id],
        );

        // The filing date moves, so this alert's send time is recomputed.
        const second = await insertDuePlan(eventId, {
          latestApplyDate: dayFromToday(20),
          reuseChecklistItemId: first.checklistItemId,
        });
        await schedulerWith()(client, eventId, second.planId, contacts);

        const moved = (await alertsOf(eventId)).find((row) => row.id === before?.id);
        expect(moved?.send_at.getTime()).not.toBe(before?.send_at.getTime());
        // The derivation goes with the anchor.
        expect(moved?.next_attempt_at).toBeNull();
        // The evidence stays, because attempts against this address really happened.
        expect(moved?.failure_count).toBe(3);
      } finally {
        client.release();
      }
    });

    it("keeps a backoff when the review changes nothing about the schedule", async () => {
      // Round 9, unchanged, and here so the rule above cannot be rewritten as "always clear".
      const eventId = await createEvent(scenario("C"));
      await materialize(eventId, { contactEmail: "dead@example.test" });
      await pool.query(
        `UPDATE alerts SET status = 'failed', failure_count = 3,
                           next_attempt_at = clock_timestamp() + interval '15 minutes'
          WHERE event_id = $1`,
        [eventId],
      );

      await materialize(eventId, { contactEmail: "dead@example.test" });

      const after = await alertsOf(eventId);
      expect(after.every((row) => row.failure_count === 3)).toBe(true);
      expect(after.every((row) => row.next_attempt_at !== null)).toBe(true);
    });

    it("serves a healthy channel without waiting out a failing channel's backlog", async () => {
      // The queue policy. failure_count already puts every untried alert ahead of every retried
      // one, so this was never an eligibility problem: it is that a backlog of emails timing out at
      // ten seconds each fills scan after scan while the healthy SMS behind them waits its turn in
      // send_at order. Nothing demoted the failing CHANNEL, and an outage here is per-channel.
      const eventId = await createEvent(scenario("C"));
      await pool.query(
        `INSERT INTO alerts (id, event_id, alert_type, channel, recipient, idempotency_key,
                             send_at, status, payload)
         SELECT gen_random_uuid(), $1, 'slack_warning', 'email', 'dead@example.test',
                $2 || ':email:' || step, current_timestamp - interval '5 minutes', 'pending',
                '{"subject":"s","body":"b"}'::jsonb
           FROM generate_series(1, 40) AS step`,
        [eventId, `${eventId}`],
      );
      // Written LAST, so in send_at order it sits behind the whole email backlog.
      await pool.query(
        `INSERT INTO alerts (id, event_id, alert_type, channel, recipient, idempotency_key,
                             send_at, status, payload)
         VALUES (gen_random_uuid(), $1, 'slack_warning', 'sms', '+15550000000', $2 || ':sms',
                 current_timestamp - interval '1 minute', 'pending',
                 '{"subject":"s","body":"b"}'::jsonb)`,
        [eventId, `${eventId}`],
      );
      const provider = fakeProvider();
      provider.failFor = "dead@example.test";

      await createAlertPoller({
        database: pool,
        senders: provider.senders,
        jurisdiction: ruleset.jurisdiction,
      }).tick();

      // The one healthy channel went out in the first scan rather than queueing behind 40 emails.
      const sms = (await alertsOf(eventId)).find((row) => row.channel === "sms");
      expect(sms?.status).toBe("sent");
    });

    it("does not deliver a filing date that expired while the queue was draining", async () => {
      // The sweep validates the window at tick start and the queue then runs for up to the whole
      // budget, so a tick that swept just before local midnight could begin sending copy whose
      // filing date had become yesterday. The claim rechecked status, backoff and plan staleness
      // and not the window.
      //
      // THE INTERLEAVING IS FORCED: the pool is proxied so that the moment the tick's scan has
      // run, the filing date is moved into the past. The claim that follows therefore meets a
      // window that shut after the row was selected, which is the reported ordering exactly.
      const eventId = await createEvent(scenario("C"));
      await schedulePastDue(eventId, [reminderOffsets[0] ?? 7]);
      const [row] = await alertsOf(eventId);
      const provider = fakeProvider();

      let closed = false;
      const closing = Object.create(pool) as Pool;
      closing.connect = pool.connect.bind(pool) as Pool["connect"];
      closing.query = (async (text: string, values?: unknown[]) => {
        const result = await pool.query(text as never, values as never);
        if (!closed && typeof text === "string" && text.includes("SELECT id FROM alerts")) {
          closed = true;
          await pool.query(
            `UPDATE permit_plan_items SET latest_apply_date = current_date - 5
              WHERE id IN (SELECT plan_item_id FROM checklist_items WHERE id = $1)`,
            [row?.checklist_item_id],
          );
        }
        return result;
      }) as Pool["query"];

      await createAlertPoller({
        database: closing,
        senders: provider.senders,
        jurisdiction: ruleset.jurisdiction,
      }).tick();

      // The scan selected it and the claim caught it, under the event lock.
      expect(provider.attempts).toHaveLength(0);
      // Retired there rather than by a bulk sweep that took no lock at all.
      expect((await alertsOf(eventId))[0]?.status).toBe("cancelled");
    });

    it("retires a held alert whose filing window has since shut", async () => {
      // A HOLD IS ABOUT SENDING, NOT ABOUT EXISTING. An unresolved attempt stops a retry because a
      // retry might be a second delivery — nothing about that reasoning applies to a cancellation,
      // which delivers nothing. The predicate sat above the window check in both the scan and the
      // claim, so once the window shut the row could no longer reach the path that retires it: it
      // stayed pending forever and was reported as needing a human to reconcile it against a
      // provider, about a deadline that can no longer be reminded at all.
      const eventId = await createEvent(scenario("C"));
      await schedulePastDue(eventId, [reminderOffsets[0] ?? 7]);
      const [row] = await alertsOf(eventId);
      const alertId = row?.id ?? "";
      await pool.query(
        `INSERT INTO alert_send_attempts (alert_id, idempotency_key, attempted_at)
         VALUES ($1, $2, current_timestamp - ($3 || ' hours')::interval)`,
        [alertId, alertId, PROVIDER_DEDUP_WINDOW_HOURS + 1],
      );
      await pool.query(
        `UPDATE permit_plan_items SET latest_apply_date = current_date - 5
          WHERE id IN (SELECT plan_item_id FROM checklist_items WHERE id = $1)`,
        [row?.checklist_item_id],
      );

      const provider = fakeProvider();
      const summary = await createAlertPoller({
        database: pool,
        senders: provider.senders,
        jurisdiction: ruleset.jurisdiction,
      }).tick();

      // Retired, not delivered: the hold still refuses the send it was written to refuse.
      expect(provider.attempts).toHaveLength(0);
      expect((await alertsOf(eventId))[0]?.status).toBe("cancelled");
      // And it stops being reported as something a person has to chase a provider about.
      expect(summary.heldForReconciliation).toBe(0);
      expect(await reconciliationHolds(pool, eventId)).toEqual([]);
    });

    it("keeps a backoff when the same checklist is submitted twice", async () => {
      // Round 27's rule was right and its trigger was wrong. send_at is recomputed from the request
      // clock whenever the slot has already gone, so it differs on EVERY review of an overdue
      // alert even though nothing was rescheduled — and keying the clear on it let a repeated
      // submission grant repeated immediate retries and made an old alert look newly scheduled.
      // The slot has to be ALREADY PAST for this to be reachable at all: a future slot is not
      // clamped, so send_at is identical on both submissions and the old trigger looked correct.
      // My first version of this test used a future date and passed against the unfixed code.
      const eventId = await createEvent(scenario("C"));
      const contacts = { email: "dead@example.test", phone: null };
      const { planId } = await insertDuePlan(eventId, { latestApplyDate: dayFromToday(0) });
      const client = await pool.connect();
      try {
        await schedulerWith()(client, eventId, planId, contacts);
        const [before] = await alertsOf(eventId);
        // Still an already-past slot, which is what makes the clamp reachable at all: a future slot
        // is never clamped, so this case cannot be reproduced with one.
        expect(before?.send_at.getTime()).toBeLessThanOrEqual(Date.now());
        await pool.query(
          `UPDATE alerts SET status = 'failed', failure_count = 3,
                             next_attempt_at = clock_timestamp() + interval '15 minutes'
            WHERE id = $1`,
          [before?.id],
        );
        await new Promise((resolve) => setTimeout(resolve, 25));

        // The same checklist, submitted again. Nothing about the schedule changed, but the clamped
        // send_at is recomputed from a later clock.
        await schedulerWith()(client, eventId, planId, contacts);

        const after = (await alertsOf(eventId)).find((row) => row.id === before?.id);
        // THE RULE, not the mechanism. An unchanged intended slot keeps its stored send_at for the
        // same reason it keeps its backoff: nothing about the schedule changed, so neither derived
        // value moves.
        //
        // This assertion used to read `not.toBe(before.send_at)`, and it is worth saying why so
        // that a future round does not restore it. It was written to prove the recomputed instant
        // really did move, which is what made the OLD trigger fire and therefore what made that
        // round's test discriminate. It pinned the mechanism the fix was reaching through rather
        // than the behaviour the fix was for, and once send_at stopped moving it was pinning the
        // defect: AC 2 measures delivery latency from this column, so a rewritten send_at makes an
        // old or late alert look newly scheduled and can leave a fifteen-minute next_attempt_at
        // sitting far outside its apparent window.
        expect(after?.send_at.getTime()).toBe(before?.send_at.getTime());
        expect(after?.next_attempt_at).not.toBeNull();
        expect(after?.failure_count).toBe(3);
      } finally {
        client.release();
      }
    });

    it("keeps the failure reason when an unchanged review recomputes the copy", async () => {
      // The payload is where this module stores last_error and nowhere else, and wholesale
      // assignment of the newly rendered subject and body dropped it: an operator saw that
      // delivery failed and lost the only record of why, on a row still failed with its count.
      const eventId = await createEvent(scenario("C"));
      const contacts = { email: "dead@example.test", phone: null };
      const { planId } = await insertDuePlan(eventId, { latestApplyDate: dayFromToday(30) });
      const client = await pool.connect();
      try {
        await schedulerWith()(client, eventId, planId, contacts);
        const [before] = await alertsOf(eventId);
        await pool.query(
          `UPDATE alerts SET status = 'failed', failure_count = 1,
                             payload = payload || '{"last_error":"provider rejected 550"}'::jsonb
            WHERE id = $1`,
          [before?.id],
        );

        await schedulerWith()(client, eventId, planId, contacts);

        const after = (await alertsOf(eventId)).find((row) => row.id === before?.id);
        expect(after?.payload.last_error).toBe("provider rejected 550");
        // And the copy really was recomputed, so this is not passing by nothing having happened.
        expect(after?.payload.subject).toBeDefined();
      } finally {
        client.release();
      }
    });

    it("counts an alert whose transaction threw as work it did not reach", async () => {
      // drained tells "no more work" from "more work I did not reach", and a throw is the second:
      // the row is untouched and still due. Reported as drained, the tick waited out a whole
      // interval and the retry could pass the bound.
      const eventId = await createEvent(scenario("C"));
      await schedulePastDue(eventId, [reminderOffsets[0] ?? 7]);
      const provider = fakeProvider();

      // Forced, not hoped for: the connection every claim needs is made to fail, which is exactly
      // the transaction failure the catch is there for and leaves the row untouched and still due.
      const throwing = Object.create(pool) as Pool;
      throwing.query = pool.query.bind(pool) as Pool["query"];
      throwing.connect = (() =>
        Promise.reject(new Error("connection terminated unexpectedly"))) as Pool["connect"];

      const summary = await createAlertPoller({
        database: throwing,
        senders: provider.senders,
        jurisdiction: ruleset.jurisdiction,
      }).tick();

      expect(summary.sent + summary.failed).toBe(0);
      expect(summary.abandoned).toBeGreaterThan(0);
      expect(summary.drained).toBe(false);
    });

    it("keeps a first attempt first inside its channel as well as across channels", async () => {
      // The rank undid the priority it sits inside. The outer key puts every untried alert ahead of
      // every retried one, and a rank counted over the WHOLE channel gave a new email sitting
      // behind a backlog of retryable failures a rank in the hundreds — so inside the untried band
      // it lost to rank-one rows of another channel and was excluded from the scan altogether,
      // while its own provider was healthy.
      const eventId = await createEvent(scenario("C"));
      // A backlog of already-failed emails, older than everything else and eligible now.
      await pool.query(
        `INSERT INTO alerts (id, event_id, alert_type, channel, recipient, idempotency_key,
                             send_at, status, failure_count, payload)
         SELECT gen_random_uuid(), $1, 'slack_warning', 'email', 'dead@example.test',
                $2 || ':old:' || step, current_timestamp - interval '30 minutes', 'failed', 1,
                '{"subject":"s","body":"b"}'::jsonb
           FROM generate_series(1, 30) AS step`,
        [eventId, `${eventId}`],
      );
      // Enough untried SMS to fill the cap on their own.
      await pool.query(
        `INSERT INTO alerts (id, event_id, alert_type, channel, recipient, idempotency_key,
                             send_at, status, payload)
         SELECT gen_random_uuid(), $1, 'slack_warning', 'sms', '+15550000000',
                $2 || ':sms:' || step, current_timestamp - interval '20 minutes', 'pending',
                '{"subject":"s","body":"b"}'::jsonb
           FROM generate_series(1, $3) AS step`,
        [eventId, `${eventId}`, MAX_ALERTS_PER_TICK],
      );
      // And the new email, newest of all, which is the row the rank was burying.
      await pool.query(
        `INSERT INTO alerts (id, event_id, alert_type, channel, recipient, idempotency_key,
                             send_at, status, payload)
         VALUES (gen_random_uuid(), $1, 'slack_warning', 'email', 'organizer@example.test',
                 $2 || ':new', current_timestamp - interval '1 minute', 'pending',
                 '{"subject":"s","body":"b"}'::jsonb)`,
        [eventId, `${eventId}`],
      );
      const provider = fakeProvider();

      await createAlertPoller({
        database: pool,
        senders: provider.senders,
        jurisdiction: ruleset.jurisdiction,
      }).tick();

      // ONE tick. Under the old rank the new email was not even selected, so it could not be sent.
      expect(provider.delivered.some((sent) => sent.recipient === "organizer@example.test")).toBe(
        true,
      );
      // Not vacuous: the untried SMS really did fill the cap alongside it, which is the crowding
      // that made this reachable.
      expect(
        provider.delivered.filter((sent) => sent.recipient === "+15550000000").length,
      ).toBeGreaterThan(0);
    });

    it("keeps retrying through a provider outage without losing an alert", async () => {
      const eventId = await createEvent(scenario("C"));
      await schedulePastDue(eventId);
      const provider = fakeProvider();
      provider.fail = "email provider unreachable: ECONNREFUSED";
      const poller = createAlertPoller({
        database: pool,
        senders: provider.senders,
        jurisdiction: ruleset.jurisdiction,
      });

      // The first retry is immediate: one failure is usually a blip, and waiting on it would spend
      // the delivery budget on a provider that is probably fine.
      await poller.tick();
      await poller.tick();

      const outage = await alertsOf(eventId);
      expect(outage.every((row) => row.status === "failed")).toBe(true);
      expect(outage.every((row) => row.failure_count === 2)).toBe(true);

      // From the second failure the row steps out of the batch for a while, so a destination that
      // will never accept anything stops consuming every scan. Nothing is dropped — the row is
      // still there, still failed, still carrying its count.
      await poller.tick();
      expect((await alertsOf(eventId)).every((row) => row.failure_count === 2)).toBe(true);

      // And it comes straight back the moment it is eligible again, which is what the spec's
      // outage edge case asks for: the poller keeps retrying and nothing is lost.
      await pool.query("UPDATE alerts SET next_attempt_at = NULL WHERE event_id = $1", [eventId]);
      provider.fail = null;
      await poller.tick();
      expect((await alertsOf(eventId)).every((row) => row.status === "sent")).toBe(true);
    });
  });
});

describe("the day an alert is sent on", () => {
  it("sends in the jurisdiction's morning rather than at UTC midnight", () => {
    // A deadline is a calendar day in the city that publishes it. 09:00 in New York is 13:00Z in
    // summer and 14:00Z in winter, and neither is the previous evening — which UTC midnight is.
    expect(instantAtLocalHour("US-NY-NYC", "2026-08-19", 9).toISOString()).toBe(
      "2026-08-19T13:00:00.000Z",
    );
    expect(instantAtLocalHour("US-NY-NYC", "2026-01-19", 9).toISOString()).toBe(
      "2026-01-19T14:00:00.000Z",
    );
  });

  it("refuses a jurisdiction with no mapped clock rather than assuming UTC", () => {
    expect(() => instantAtLocalHour("US-CA-LA", "2026-08-19", 9)).toThrow(
      'no local time zone is mapped for jurisdiction "US-CA-LA"',
    );
  });
});

// The delivery adapters need no database: they are the seam between the poller and a provider.
describe("migration 014's backfill exclusions", () => {
  it("excludes exactly the error the unconfigured email sender records", async () => {
    // THE DRIFT GUARD FOR A LITERAL THAT CANNOT BE IMPORTED. A merged migration has to keep
    // meaning what it meant on the day it ran, so it carries the text rather than a reference to
    // a constant a later PR could reword. This is what stops the two silently parting company:
    // reword the sender and the backfill starts seeding rows it was written to skip.
    const sql = vi.fn();
    migration014({
      sql,
      createTable: vi.fn(),
      createIndex: vi.fn(),
      func: vi.fn(),
    } as unknown as MigrationBuilder);
    const recorded = await unconfiguredEmailSender()({
      recipient: "organizer@example.test",
      subject: "",
      body: "",
      idempotencyKey: "",
    }).then(
      () => "",
      (error: Error) => error.message,
    );

    expect(String(sql.mock.calls[0]?.[0])).toContain(`<> $$${recorded}$$`);
  });
});

describe("F-203 delivery channels (AC 5)", () => {
  const message: AlertMessage = {
    recipient: "organizer@example.test",
    subject: "File your Special Event Permit by 2026-08-26",
    body: "…",
    idempotencyKey: "event:item:deadline_reminder:email:2026-08-19",
  };

  it.runIf(databaseUrl !== "")("gives the due-alert scan a partial index to walk", async () => {
    // Issue #151. `alerts` had only its primary key and the idempotency unique index, so the scan
    // that runs every sixty seconds read the whole table — and sent and cancelled rows are kept
    // indefinitely because they are the audit record, so the table grows while the queue does not.
    //
    // WHAT THIS PINS AND WHAT IT DOES NOT. It pins that the index exists, is partial to the queued
    // statuses, and leads on the columns the scan orders by. It does NOT assert that the planner
    // chooses it, because on the empty table CI runs against a sequential scan is the correct plan
    // and a test demanding otherwise would be asserting a lie. The planner's choice was measured
    // instead, on 200000 rows with 200 queued: parallel sequential scan at 23.2ms with 66600 rows
    // discarded per worker, against an index scan at 1.3ms, with the partial index at 16kB beside
    // a 79MB table. That number belongs in the review record rather than in an assertion.
    const pool = new Pool({ connectionString: databaseUrl });
    try {
      const { rows } = await pool.query<{ indexdef: string }>(
        "SELECT indexdef FROM pg_indexes WHERE tablename = 'alerts' AND indexname = $1",
        ["alerts_due_queue_idx"],
      );
      const definition = rows[0]?.indexdef ?? "";
      expect(definition).toContain("failure_count");
      expect(definition).toContain("send_at");
      // Partial, which is what keeps it proportional to the QUEUE rather than to the audit trail.
      expect(definition).toContain("WHERE");
      expect(definition).toMatch(/pending/);
      expect(definition).toMatch(/failed/);
    } finally {
      await pool.end();
    }
  });

  it("releases the response body on both the accepted and the rejected path", async () => {
    // Undici holds a connection open until its body is consumed or cancelled, so a body nobody
    // reads keeps its socket until garbage collection. The poller sends eight at a time and retries
    // through outages, which is the shape that accumulates them: the concurrency bound limits
    // requests in flight, not sockets left behind by requests that finished.
    const cancelled: string[] = [];
    const bodyFor = (label: string) =>
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('{"id":"x"}'));
          controller.close();
        },
        cancel() {
          cancelled.push(label);
        },
      });

    const accepted = createResendEmailSender({
      apiKey: "k",
      from: "a@b.test",
      fetch: async () => new Response(bodyFor("accepted"), { status: 200 }),
    });
    await accepted({
      recipient: "organizer@example.test",
      subject: "s",
      body: "b",
      idempotencyKey: "k1",
    });
    expect(cancelled).toContain("accepted");

    // The throwing path is the one that gets forgotten.
    const rejected = createResendEmailSender({
      apiKey: "k",
      from: "a@b.test",
      fetch: async () => new Response(bodyFor("rejected"), { status: 422 }),
    });
    await expect(
      rejected({
        recipient: "organizer@example.test",
        subject: "s",
        body: "b",
        idempotencyKey: "k2",
      }),
    ).rejects.toBeInstanceOf(AlertDeliveryError);
    expect(cancelled).toContain("rejected");
  });

  // Both added 2026-08-03 from the #228 review. They are about one thing: an attempt is only left
  // OPEN when this side genuinely does not know what the provider did. Leaving it open when the
  // outcome was knowable holds the alert permanently once it ages past the dedup window.
  it("keeps the observed status when releasing the response body fails", async () => {
    const sender = createResendEmailSender({
      apiKey: "re_test",
      from: "PopEngine <noreply@example.test>",
      fetch: (async () =>
        new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(new TextEncoder().encode("{}"));
              controller.close();
            },
            cancel() {
              throw new Error("socket teardown failed");
            },
          }),
          { status: 422 },
        )) as unknown as typeof globalThis.fetch,
    });

    // The provider answered 422. Teardown failing afterwards is socket hygiene, not evidence about
    // delivery, so the rejection must still report the outcome as observed.
    const error = await sender(message).catch((thrown: unknown) => thrown);
    expect(error).toBeInstanceOf(AlertDeliveryError);
    expect((error as AlertDeliveryError).outcomeObserved).toBe(true);
    expect((error as Error).message).toContain("422");
  });

  it("resolves the attempt for every failure proven to precede the handoff", async () => {
    // Routing and TLS failures happen before any HTTP byte is written, so no duplicate is
    // possible and the alert must stay retryable through the outage. ECONNRESET is the
    // counter-example and must stay unresolved: it can arrive after the body was accepted.
    const provenCodes = [
      "ENOTFOUND",
      "EAI_AGAIN",
      "ECONNREFUSED",
      "ENETUNREACH",
      "EHOSTUNREACH",
      "ERR_TLS_CERT_ALTNAME_INVALID",
      "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
      "DEPTH_ZERO_SELF_SIGNED_CERT",
      "SELF_SIGNED_CERT_IN_CHAIN",
      "CERT_HAS_EXPIRED",
    ];

    const senderFor = (code: string) =>
      createResendEmailSender({
        apiKey: "re_test",
        from: "PopEngine <noreply@example.test>",
        fetch: (async () => {
          const cause = Object.assign(new Error("transport"), { code });
          throw Object.assign(new TypeError("fetch failed"), { cause });
        }) as unknown as typeof globalThis.fetch,
      });

    for (const code of provenCodes) {
      const error = await senderFor(code)
        .call(null, message)
        .catch((thrown: unknown) => thrown);
      expect((error as AlertDeliveryError).outcomeObserved, code).toBe(true);
    }

    const reset = await senderFor("ECONNRESET")
      .call(null, message)
      .catch((thrown: unknown) => thrown);
    expect((reset as AlertDeliveryError).outcomeObserved, "ECONNRESET stays unresolved").toBe(
      false,
    );
  });

  it("sends email through Resend and hands it the idempotency key", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const sender = createResendEmailSender({
      apiKey: "re_test",
      from: "PopEngine <noreply@example.test>",
      fetch: (async (url: string, init: RequestInit) => {
        calls.push({ url, init });
        return new Response("{}", { status: 200 });
      }) as unknown as typeof globalThis.fetch,
    });

    expect(await sender(message)).toEqual({ simulated: false, label: null, provider: "resend" });
    expect(calls[0]?.url).toBe("https://api.resend.com/emails");
    expect((calls[0]?.init.headers as Record<string, string>)["Idempotency-Key"]).toBe(
      message.idempotencyKey,
    );
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({
      from: "PopEngine <noreply@example.test>",
      to: ["organizer@example.test"],
      subject: message.subject,
      text: message.body,
    });
  });

  it("treats a provider rejection as a retryable failure and echoes no provider body", async () => {
    const sender = createResendEmailSender({
      apiKey: "re_test",
      from: "PopEngine <noreply@example.test>",
      fetch: (async () =>
        new Response(JSON.stringify({ message: "organizer@example.test is suppressed" }), {
          status: 422,
        })) as unknown as typeof globalThis.fetch,
    });

    const error = await sender(message).catch((thrown: unknown) => thrown);
    expect(error).toBeInstanceOf(AlertDeliveryError);
    expect((error as Error).message).toBe("email provider rejected the send with status 422");
    // The provider's body can echo the recipient; it is contact data and does not go in a log.
    expect((error as Error).message).not.toContain("organizer@example.test");
  });

  it("abandons a provider that accepts the connection and never answers", async () => {
    // The poller sends sequentially with the row's transaction open, so an unbounded request does
    // not stall one alert — it stalls every alert behind it, past the two-minute delivery bound.
    const sender = createResendEmailSender({
      apiKey: "re_test",
      from: "PopEngine <noreply@example.test>",
      timeoutMs: 25,
      fetch: ((_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          // What a real half-open socket does under an abort signal: nothing, until the abort.
          init.signal?.addEventListener("abort", () => reject(init.signal?.reason));
        })) as unknown as typeof globalThis.fetch,
    });

    const started = Date.now();
    const error = await sender(message).catch((thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(AlertDeliveryError);
    expect((error as Error).message).toBe("email provider did not respond within 25ms");
    expect(Date.now() - started).toBeLessThan(2_000);
  });

  it("treats an unreachable provider as a retryable failure", async () => {
    const sender = createResendEmailSender({
      apiKey: "re_test",
      from: "PopEngine <noreply@example.test>",
      fetch: (async () => {
        throw new Error("socket hang up");
      }) as unknown as typeof globalThis.fetch,
    });

    await expect(sender(message)).rejects.toThrow("email provider unreachable: socket hang up");
  });

  /** What `fetch` throws for a transport failure: a wrapper whose cause carries the errno. */
  const transportFailure = (code: string, detail: string) =>
    (async () => {
      throw new TypeError("fetch failed", {
        cause: Object.assign(new Error(detail), { code }),
      });
    }) as unknown as typeof globalThis.fetch;

  it("leaves a connection that died mid-request unresolved rather than calling it an outage", async () => {
    // THE CASE THAT DEFEATS ISSUE #166'S OWN FIX. A reset can arrive after the request body was
    // written and the provider accepted it, so a message may be on its way that this side will
    // never hear about. Reading that as "nothing was delivered" closes the attempt, and a closed
    // attempt goes on being retried past the provider's dedup window, which is the second
    // delivery to the same person that the attempt record exists to prevent.
    const sender = createResendEmailSender({
      apiKey: "re_test",
      from: "PopEngine <noreply@example.test>",
      fetch: transportFailure("ECONNRESET", "read ECONNRESET"),
    });

    const error = await sender(message).catch((thrown: unknown) => thrown);
    expect(error).toBeInstanceOf(AlertDeliveryError);
    expect((error as AlertDeliveryError).outcomeObserved).toBe(false);
  });

  it("resolves the attempt only for a failure that proves the request never left", async () => {
    // The other half, and why this is a list rather than a "not a timeout" test: a name that does
    // not resolve and a socket that is refused both happen before anything is handed over, so
    // nothing can be in flight. Those keep the spec's outage behaviour: retried for as long as
    // the outage lasts, nothing held, nothing lost.
    for (const code of ["ENOTFOUND", "EAI_AGAIN", "ECONNREFUSED"]) {
      const sender = createResendEmailSender({
        apiKey: "re_test",
        from: "PopEngine <noreply@example.test>",
        fetch: transportFailure(code, `connect ${code} api.resend.com`),
      });

      const error = await sender(message).catch((thrown: unknown) => thrown);
      expect(error).toBeInstanceOf(AlertDeliveryError);
      expect((error as AlertDeliveryError).outcomeObserved).toBe(true);
    }
  });

  it("leaves a transport failure it cannot classify unresolved", async () => {
    // The default direction is the safe one. An unrecognised throw says nothing about whether the
    // request reached the provider, and holding an alert for a human to reconcile is recoverable
    // where a duplicate delivery is not.
    const sender = createResendEmailSender({
      apiKey: "re_test",
      from: "PopEngine <noreply@example.test>",
      fetch: (async () => {
        throw new Error("socket hang up");
      }) as unknown as typeof globalThis.fetch,
    });

    const error = await sender(message).catch((thrown: unknown) => thrown);
    expect((error as AlertDeliveryError).outcomeObserved).toBe(false);
  });

  it("fails rather than simulating when email is not configured", async () => {
    await expect(unconfiguredEmailSender()(message)).rejects.toThrow(AlertDeliveryError);
  });

  it("renders SMS as a labeled simulation while A2P registration is outstanding", async () => {
    const seen: AlertMessage[] = [];
    const delivery = await createSimulatedSmsSender((sent) => seen.push(sent))(message);

    expect(delivery).toEqual({
      simulated: true,
      label: SIMULATED_SMS_LABEL,
      provider: "simulated",
    });
    expect(SIMULATED_SMS_LABEL).toContain("not delivered");
    expect(seen).toEqual([message]);
    // And it says so where the poller asks, which is what keeps a simulated send out of the
    // provider-reconciliation machinery: nothing left this process, so no provider can be holding
    // a message whose outcome nobody saw. The live email sender says nothing and is treated as
    // reaching one, which is the direction that cannot go wrong.
    expect(createSimulatedSmsSender().reachesAProvider).toBe(false);
    expect(sendersFromEnv({}).sms.reachesAProvider).toBe(false);
    expect(
      createResendEmailSender({ apiKey: "re_test", from: "a@b.test" }).reachesAProvider,
    ).toBeUndefined();
  });

  it("picks live email only when both credentials are present, and always simulates SMS", async () => {
    const unconfigured = sendersFromEnv({});
    await expect(unconfigured.email(message)).rejects.toThrow("RESEND_API_KEY");
    await expect(sendersFromEnv({ RESEND_API_KEY: "re_test" }).email(message)).rejects.toThrow(
      "RESEND_API_KEY",
    );
    expect((await unconfigured.sms(message)).simulated).toBe(true);

    // Configured means a live sender rather than the refusing one. It is not called here: the
    // live adapter is covered above against an injected fetch, and this suite makes no network
    // requests.
    const configured = sendersFromEnv({ RESEND_API_KEY: "re_test", SMTP_FROM: "a@b.test" });
    expect(configured.email).not.toBe(unconfigured.email);
    expect((await configured.sms(message)).simulated).toBe(true);
  });
});
