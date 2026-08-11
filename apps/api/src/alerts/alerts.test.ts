import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { MigrationBuilder } from "node-pg-migrate";
import { Client, Pool } from "pg";
import type { ClientBase, ClientConfig, PoolClient } from "pg";
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
import { up as migration014 } from "../../migrations/014_alert_send_attempts";
import {
  simulatedDeliveries,
  alertDeliveryHealth,
  createAlertPoller,
  createAlertScheduler,
  FILING_WINDOW_HAS_SHUT,
  failedDeliveries,
  reconciliationHolds,
  ALERT_POLLER_CONNECTIONS,
  DEDUP_WINDOW_CLAIM_MARGIN_MS,
  DELIVERY_BOUND_MS,
  MAX_ALERTS_PER_TICK,
  POLL_INTERVAL_MS,
  PROVIDER_DEDUP_WINDOW_HOURS,
  SEND_BOUNDARY_MARGIN_MS,
  SEND_CONCURRENCY,
  TICK_BUDGET_MS,
  UNRESOLVED_ATTEMPT_HOLD_LIMIT_HOURS,
  type AlertScheduler,
  type AlertStatus,
} from "./alerts";
import { createApp } from "../app";
import { instantAtLocalHour, todayInJurisdiction } from "../calendar";
import { createPlanService } from "../planning/plan";
import { deadlineReminderOffsets, loadRuleset, rulesFilePath } from "../ruleset";
import type { DocumentStorage } from "../planning/storage";

const databaseUrl = process.env.DATABASE_URL ?? "";

const storage: DocumentStorage = {
  put: async () => undefined,
  signedDownloadUrl: async () => "https://storage.test/unused",
  remove: async () => undefined,
};

type FakeProvider = {
  readonly senders: AlertSenders;

  readonly delivered: AlertMessage[];

  readonly attempts: AlertMessage[];
  fail: string | null;

  failFor: string | null;

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
    route_scheduled?: boolean;
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
      checklist: {
        database: pool,
        storage,
        scheduleAlerts: schedulerWith(() => new Date(`${today}T13:00:00Z`)),
        jurisdiction: ruleset.jurisdiction,
      },
      alerts: { jurisdiction: ruleset.jurisdiction, database: pool, senders: provider.senders },
    });

  const createEvent = async (submission: Record<string, unknown>): Promise<string> => {
    const response = await request(appWith(fakeProvider()))
      .post("/api/events")
      .set("Idempotency-Key", randomUUID())
      .send(submission);
    expect(response.status).toBe(201);
    const eventId = response.body.event.id as string;
    createdEventIds.push(eventId);
    return eventId;
  };

  const materialize = async (
    eventId: string,
    contacts: Record<string, unknown> = { contactEmail: "organizer@example.test" },
    today = FIXTURE_TODAY,
  ) => {
    const app = appWith(fakeProvider(), today);
    expect((await request(app).post(`/api/events/${eventId}/plan`)).status).toBe(201);
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

  const attemptsOf = async (alertId: string): Promise<AttemptRow[]> => {
    const { rows } = await pool.query<AttemptRow>(
      `SELECT * FROM alert_send_attempts WHERE alert_id = $1 ORDER BY attempted_at`,
      [alertId],
    );
    return rows;
  };

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

  const dayFromToday = (days: number): string => {
    const day = new Date(`${todayInJurisdiction("US-NY-NYC")}T00:00:00Z`);
    day.setUTCDate(day.getUTCDate() + days);
    return day.toISOString().slice(0, 10);
  };

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
      reuseChecklistItemId?: string;
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
      await pool.query(
        `INSERT INTO permit_plan_items (id, plan_id, rule_ids, triggered_by, permit_name, agency,
                                        latest_apply_date, apply_after_date, sources, kind, disposition,
                                        deadline_status, verification_status)
         VALUES ($1, $2, ARRAY['PARKS-EVENT-001'], '[]'::jsonb, 'Special Event Permit',
                 'NYC Parks', $3, $4, '[]'::jsonb, 'permit', 'required', 'on_track',
                 'SOURCE_CONFIRMED')`,
        [laterItemId, planId, laterDated.latestApplyDate, laterDated.applyAfterDate ?? null],
      );
      await pool.query(
        "INSERT INTO checklist_items (id, plan_item_id, cohort_position) VALUES ($1, $2, 1)",
        [randomUUID(), laterItemId],
      );
    }
    if (applyAfterDate !== null) {
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
      `INSERT INTO checklist_items (id, plan_item_id, cohort_position) VALUES ($1, $2, 0)
       ON CONFLICT (id) DO UPDATE SET plan_item_id = EXCLUDED.plan_item_id`,
      [checklistItemId, itemId],
    );
    return { planId, checklistItemId };
  };

  const schedulePastDue = async (eventId: string, offsets = reminderOffsets): Promise<number> => {
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

  const moveFilingDateOut = async (alertId: string, days: number): Promise<void> => {
    await pool.query(
      `UPDATE permit_plan_items SET latest_apply_date = current_date + $2::int
        WHERE id IN (SELECT plan_item_id FROM checklist_items
                      WHERE id = (SELECT checklist_item_id FROM alerts WHERE id = $1))`,
      [alertId, days],
    );
  };

  beforeAll(async () => {
    pool = new Pool({ connectionString: databaseUrl });
    ruleset = parseEngineRuleset(JSON.parse(await readFile(rulesFilePath(), "utf8")));
    const published = await loadRuleset();
    intakeContract = parseIntakeContract(published.document);
    reminderOffsets = deadlineReminderOffsets(published);
  });

  afterEach(async () => {
    await pool.query(
      `UPDATE alerts SET status = 'cancelled'
        WHERE status IN ('pending', 'failed') AND send_at <= current_timestamp`,
    );
  });

  afterAll(async () => {
    if (createdEventIds.length > 0) {
      await pool.query("DELETE FROM alerts WHERE event_id = ANY($1)", [createdEventIds]);
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
      expect(response.body.alerts.scheduled).toBe(5);
      expect((await describeAlerts(eventId)).sort()).toEqual(
        [
          "2026-08-19 deadline_reminder PARKS-EVENT-001 email pending",
          "2026-08-25 deadline_reminder PARKS-EVENT-001 email pending",
          "2026-08-12 dependency_unlocked NYPD-SOUND-001 email pending",
          "2026-09-04 deadline_reminder NYPD-SOUND-001 email pending",
          "2026-09-10 deadline_reminder NYPD-SOUND-001 email pending",
        ].sort(),
      );
    });

    it("schedules the offsets the ruleset publishes rather than a hardcoded pair", async () => {
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
      const eventId = await createEvent(scenario("D"));
      const response = await materialize(eventId);

      const undated = response.body.items.filter(
        (item: { latestApplyDate: string | null }) => item.latestApplyDate === null,
      );
      expect(undated.length).toBeGreaterThan(0);
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
      expect(warning?.payload.body).toContain(
        "Counting from 2026-07-22, the requirement with the least room leaves 10 days to apply.",
      );
      expect(warning?.payload.body).not.toContain("days away");
      expect(warning?.payload.body).not.toContain("window 10 days wide");
      expect(warning?.payload.body).not.toContain("slack");
      expect(warning?.payload.body).not.toContain("FEASIBLE");
    });

    it("does not describe gated slack as time until filing", async () => {
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
        "The requirement with the least room can only be applied for during a window 9 days wide.",
      );
      expect(warning?.payload.body).not.toContain("days away");
      expect(warning?.payload.body).not.toContain("Counting from");
      expect(warning?.payload.body).not.toContain("slack");
      expect(warning?.payload.body).not.toContain("FEASIBLE");
    });

    it("does not turn a non-filing controlling window into an instruction to file", async () => {
      const eventId = await createEvent(scenario("C"));
      const { planId } = await insertDuePlan(eventId, {
        verdict: "feasible_at_risk",
        minSlackDays: 9,
        latestApplyDate: dayFromToday(9),
        disposition: "advisory",
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
      expect(warning?.payload.subject).toBe("At risk — the narrowest published window is 9 days");
      expect(String(warning?.payload.body)).toContain(
        `Counting from ${todayInJurisdiction("US-NY-NYC")}, the requirement with the least room ` +
          `leaves 9 days. Nothing needs to be filed for it: that is a date the rule publishes, ` +
          `not a deadline to apply by.`,
      );
      expect(String(warning?.payload.subject)).not.toContain("apply within");
      expect(String(warning?.payload.body)).not.toContain("to apply.");
      expect(String(warning?.payload.body)).not.toContain("applied for during a window");
      expect(String(warning?.payload.body)).toContain(
        "internal planning buffer, not an official threshold",
      );
    });

    it("describes one controlling requirement when a tie splits the two flags", async () => {
      const eventId = await createEvent(scenario("C"));
      const { planId } = await insertDuePlan(eventId, {
        verdict: "feasible_at_risk",
        minSlackDays: 9,
        latestApplyDate: dayFromToday(30),
        applyAfterDate: dayFromToday(21),
        disposition: "advisory",
        laterDated: { latestApplyDate: dayFromToday(9), slackDays: 9 },
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
      expect(warning?.payload.subject).toBe(
        `At risk — apply within 9 days of ${todayInJurisdiction("US-NY-NYC")}`,
      );
      expect(String(warning?.payload.body)).toContain("leaves 9 days to apply.");
      expect(String(warning?.payload.body)).not.toContain("days wide");
      expect(String(warning?.payload.body)).not.toContain("Nothing needs to be filed");
    });

    it("describes a gated non-filing window as a width rather than a countdown", async () => {
      const eventId = await createEvent(scenario("C"));
      const { planId } = await insertDuePlan(eventId, {
        verdict: "feasible_at_risk",
        minSlackDays: 9,
        latestApplyDate: dayFromToday(30),
        applyAfterDate: dayFromToday(21),
        disposition: "advisory",
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
      expect(String(warning?.payload.body)).toContain(
        "The requirement with the least room publishes a window 9 days wide. Nothing needs to be " +
          "filed for it: the window is a range the rule publishes, not time to apply.",
      );
      expect(String(warning?.payload.body)).not.toContain("Counting from");
      expect(String(warning?.payload.body)).not.toContain("can only be applied for");
      expect(String(warning?.payload.body)).not.toContain("slack");
      expect(String(warning?.payload.body)).not.toContain("FEASIBLE");
    });

    it("does not warn twice when an identical plan is regenerated", async () => {
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
      await pool.query(
        "UPDATE alerts SET status = 'sent', sent_at = clock_timestamp() WHERE id = $1",
        [first[0]?.id],
      );

      await warn(atRisk);

      const after = (await alertsOf(eventId)).filter((row) => row.alert_type === "slack_warning");
      expect(after).toHaveLength(1);
      expect(after[0]?.id).toBe(first[0]?.id);
      expect(after[0]?.status).toBe("sent");
    });

    it("does not warn a second time when the slack value changes", async () => {
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
      expect(String(after[0]?.payload.body)).toContain("9 days");
    });

    it("carries the controlling requirement's verification state and its published caveats", async () => {
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
      expect(String(warning?.payload.body)).toContain(
        "Two published readings disagree on whether this applies.",
      );
    });

    it("carries every tied controlling requirement's state, not just the first", async () => {
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
      const eventId = await createEvent(scenario("C"));
      const { planId } = await insertDuePlan(eventId, {
        verdict: "feasible_at_risk",
        minSlackDays: 9,
        latestApplyDate: dayFromToday(9),
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
      expect(warning).toBeDefined();
      expect(warning?.payload.subject).toBe("At risk — the narrowest filing window is 9 days wide");
      expect(String(warning?.payload.subject)).not.toMatch(/\d{4}-\d{2}-\d{2}/);
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
        expect(alert.payload.body).toContain(
          "apply at least 21 days ahead (applications inside 21 days are not accepted); processing 21–30 days",
        );
      }
    });

    it("states the verification state on every reminder, not only where prose mentions it", async () => {
      const eventId = await createEvent(scenario("C"));
      await materialize(eventId);

      const rows = await alertsOf(eventId);
      const reminders = rows.filter((row) => row.alert_type === "deadline_reminder");
      expect(reminders.length).toBeGreaterThan(0);
      for (const alert of reminders) {
        const ruleIds = await ruleIdsFor(alert.checklist_item_id ?? "");
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
      const rule = ruleset.rules.find((candidate) => candidate.id === "DOB-ASSEMBLY-001");
      const qualification = rule?.deadline?.qualification;
      const verificationQualification = rule?.verificationQualification;
      expect(typeof qualification).toBe("string");
      expect(typeof verificationQualification).toBe("string");

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
        expect(alert.payload.body).toContain(qualification as string);
        expect(alert.payload.body).toContain(verificationQualification as string);
      }
    });

    it("keeps a may-be-required line conditional instead of turning it into a filing order", async () => {
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
      expect(unlock?.send_at.toISOString().slice(0, 10)).toBe("2026-08-12");
      expect(unlock?.payload.body).toContain(
        "2026-08-12 is the earliest a decision on your Special Event Permit (NYC Parks) could " +
          "come back, from its published 21–30 day processing range. That date has arrived. It " +
          "is not confirmation that a decision has been made.",
      );
      expect(unlock?.payload.body).toContain(
        "Confirm the outcome with NYC Parks before you file your Sound Device Permit (NYPD).",
      );
      expect(unlock?.payload.body).not.toContain("decision window has passed");
      expect(unlock?.payload.body).not.toContain("can now pursue");
      expect(unlock?.payload.subject).not.toContain("can now pursue");
      expect(String(unlock?.payload.body)).not.toMatch(/do not file|cannot file|must wait/i);
      expect(unlock?.payload.body).toContain("File at the precinct where the device will be used");
      expect(unlock?.payload.body).toContain(
        "A strict issued-before-filed sequence is not confirmed by located primary text",
      );
    });

    it("names the sequence on a reminder that lands exactly on the expected decision day", async () => {
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
      expect(early?.payload.body).toContain("Filing before then may still be possible");
      expect(early?.payload.body).toContain("file by 2026-08-14");
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
      expect(afterRetry).toHaveLength(afterFailure.length);
    });

    it("does not send twice when the process dies between the send and the mark", async () => {
      const eventId = await createEvent(scenario("C"));
      expect(await schedulePastDue(eventId, [1])).toBe(1);
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

      const crashed = await createAlertPoller({
        jurisdiction: ruleset.jurisdiction,
        database: crashing,
        senders: provider.senders,
      }).tick();
      await doomed.end();
      expect(crashed.sent).toBe(0);
      expect((await alertsOf(eventId)).every((row) => row.status === "pending")).toBe(true);
      expect(provider.delivered).toHaveLength(1);

      await createAlertPoller({
        database: pool,
        senders: provider.senders,
        jurisdiction: ruleset.jurisdiction,
      }).tick();

      expect((await alertsOf(eventId)).every((row) => row.status === "sent")).toBe(true);
      expect(provider.attempts).toHaveLength(2);
      expect(provider.attempts[0]?.idempotencyKey).toBe(provider.attempts[1]?.idempotencyKey);
      expect(provider.delivered).toHaveLength(1);
    });

    describe("an attempt is recorded before the send, so a crash is not a non-attempt", () => {
      const insertDueAlert = async (
        eventId: string,
        recipient: string,
        dueDaysAgo: number,
        row: {
          readonly channel?: AlertChannel;
          readonly status?: AlertStatus;
          readonly lastError?: string;
          readonly failureCount?: number;
          readonly test?: boolean;
        } = {},
      ): Promise<string> => {
        const alertId = randomUUID();
        await pool.query(
          `INSERT INTO alerts (id, event_id, alert_type, channel, recipient, idempotency_key,
                               send_at, status, failure_count, payload)
           VALUES ($1, $2, 'deadline_reminder', $6, $3, $5,
                   current_timestamp - ($4 || ' days')::interval, $7, $9,
                   '{"subject":"file it","body":"file it"}'::jsonb || $8::jsonb)`,
          [
            alertId,
            eventId,
            recipient,
            dueDaysAgo,
            alertId,
            row.channel ?? "email",
            row.status ?? "pending",
            JSON.stringify({
              ...(row.lastError === undefined ? {} : { last_error: row.lastError }),
              ...(row.test === true ? { test: true } : {}),
            }),
            row.failureCount ?? (row.status === "failed" ? 1 : 0),
          ],
        );
        return alertId;
      };

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

        const untried = await insertDueAlert(eventId, "untried@example.test", 1);
        const rows = await alertsOf(eventId);
        expect(rows.every((row) => row.status === "pending")).toBe(true);
        expect(provider.delivered).toHaveLength(1);
        const recorded = await attemptsOf(attempted);
        expect(recorded).toHaveLength(1);
        expect(recorded[0]?.outcome_recorded_at).toBeNull();
        expect(recorded[0]?.idempotency_key).toBe(
          rows.find((row) => row.id === attempted)?.idempotency_key,
        );
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

      it("keeps a proven non-delivery recorded when the sending transaction dies with it", async () => {
        const eventId = await createEvent(scenario("C"));
        expect(await schedulePastDue(eventId, [1])).toBe(1);
        const alertId = (await alertsOf(eventId))[0]?.id ?? "";
        const refused: AlertSenders = {
          sms: fakeProvider().senders.sms,
          email: async () => {
            throw new AlertDeliveryError("email provider unreachable: ECONNREFUSED");
          },
        };

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
          senders: refused,
        }).tick();
        await doomed.end();

        const recorded = await attemptsOf(alertId);
        expect(recorded).toHaveLength(1);
        expect(recorded[0]?.outcome_recorded_at).not.toBeNull();

        await pool.query(
          `UPDATE alert_send_attempts
              SET attempted_at = current_timestamp - ($2 || ' hours')::interval
            WHERE alert_id = $1`,
          [alertId, PROVIDER_DEDUP_WINDOW_HOURS + 1],
        );
        const provider = fakeProvider();
        const summary = await createAlertPoller({
          database: pool,
          senders: provider.senders,
          jurisdiction: ruleset.jurisdiction,
        }).tick();

        expect(summary.heldForReconciliation).toBe(0);
        expect((await alertsOf(eventId))[0]?.status).toBe("sent");
      });

      const poolRefusingTheFirstOutcomeWrite = (label: string): Pool => {
        let refused = false;
        class RefusesTheOutcome extends Client {
          constructor(config?: ClientConfig) {
            super(config);
            const query = this.query.bind(this) as (...args: unknown[]) => Promise<unknown>;
            this.query = ((...args: unknown[]) => {
              const text = args[0];
              const outcome =
                typeof text === "string" &&
                text.includes("UPDATE alert_send_attempts SET outcome_recorded_at");
              if (!outcome || refused) return query(...args);
              refused = true;
              return query("SELECT refused_by_the_database()");
            }) as typeof this.query;
          }
        }
        return new Pool({
          connectionString: `${databaseUrl}${databaseUrl.includes("?") ? "&" : "?"}application_name=${label}`,
          Client: RefusesTheOutcome as unknown as new () => ClientBase,
        });
      };

      it("writes a proven non-delivery again when the first write is refused", async () => {
        const eventId = await createEvent(scenario("C"));
        const alertId = await insertDueAlert(eventId, "refused-outcome@example.test", 2);
        const unreachable: AlertSenders = {
          sms: fakeProvider().senders.sms,
          email: async () => {
            throw new AlertDeliveryError("email provider unreachable: ECONNREFUSED");
          },
        };
        const refusing = poolRefusingTheFirstOutcomeWrite("refused_outcome");

        const summary = await createAlertPoller({
          database: refusing,
          senders: unreachable,
          jurisdiction: ruleset.jurisdiction,
        }).tick();
        await refusing.end();

        expect(summary.failed).toBe(1);
        expect((await alertsOf(eventId))[0]?.status).toBe("failed");
        const recorded = await attemptsOf(alertId);
        expect(recorded).toHaveLength(1);
        expect(recorded[0]?.outcome_recorded_at).not.toBeNull();

        await pool.query(
          `UPDATE alert_send_attempts
              SET attempted_at = current_timestamp - ($2 || ' hours')::interval
            WHERE alert_id = $1`,
          [alertId, PROVIDER_DEDUP_WINDOW_HOURS + 1],
        );
        const provider = fakeProvider();
        const after = await createAlertPoller({
          database: pool,
          senders: provider.senders,
          jurisdiction: ruleset.jurisdiction,
        }).tick();

        expect(after.heldForReconciliation).toBe(0);
        expect((await alertsOf(eventId))[0]?.status).toBe("sent");
      });

      const poolWhoseNextConnectionTimesOut = (
        label: string,
      ): { readonly pool: Pool; readonly timeOutTheNextConnection: () => void } => {
        let refusalsLeft = 0;
        class TimesOutConnecting extends Client {
          constructor(config?: ClientConfig) {
            super(config);
            const connect = this.connect.bind(this) as (...args: unknown[]) => unknown;
            this.connect = ((...args: unknown[]) => {
              if (refusalsLeft === 0) return connect(...args);
              refusalsLeft -= 1;
              const refusal = Object.assign(new Error("timeout expired"), { code: "ETIMEDOUT" });
              const callback = args[0];
              if (typeof callback !== "function") return Promise.reject(refusal);
              queueMicrotask(() => (callback as (error: Error) => void)(refusal));
              return undefined;
            }) as typeof this.connect;
          }
        }
        return {
          pool: new Pool({
            connectionString: `${databaseUrl}${databaseUrl.includes("?") ? "&" : "?"}application_name=${label}`,
            maxUses: 1,
            Client: TimesOutConnecting as unknown as new () => ClientBase,
          }),
          timeOutTheNextConnection: () => {
            refusalsLeft = 1;
          },
        };
      };

      it("settles a proven non-delivery when the recovery cannot get a connection", async () => {
        const eventId = await createEvent(scenario("C"));
        const alertId = await insertDueAlert(eventId, "recovery-connect@example.test", 2);
        const writer = poolWhoseNextConnectionTimesOut("recovery_connect");
        const unreachable: AlertSenders = {
          sms: fakeProvider().senders.sms,
          email: async () => {
            writer.timeOutTheNextConnection();
            throw new AlertDeliveryError("email provider unreachable: ECONNREFUSED");
          },
        };

        const summary = await createAlertPoller({
          database: writer.pool,
          senders: unreachable,
          jurisdiction: ruleset.jurisdiction,
        }).tick();
        await writer.pool.end();

        expect(summary.failed).toBe(1);
        expect((await alertsOf(eventId))[0]?.status).toBe("failed");
        const recorded = await attemptsOf(alertId);
        expect(recorded).toHaveLength(1);
        expect(recorded[0]?.outcome_recorded_at).not.toBeNull();

        await pool.query(
          `UPDATE alert_send_attempts
              SET attempted_at = current_timestamp - ($2 || ' hours')::interval
            WHERE alert_id = $1`,
          [alertId, PROVIDER_DEDUP_WINDOW_HOURS + 1],
        );
        const provider = fakeProvider();
        const after = await createAlertPoller({
          database: pool,
          senders: provider.senders,
          jurisdiction: ruleset.jurisdiction,
        }).tick();

        expect(after.heldForReconciliation).toBe(0);
        expect((await alertsOf(eventId))[0]?.status).toBe("sent");
      });

      const poolCrossingMidnightOnTheIntent = (label: string): Pool => {
        let crossed = false;
        class CrossesMidnight extends Client {
          constructor(config?: ClientConfig) {
            super(config);
            const query = this.query.bind(this) as (...args: unknown[]) => Promise<unknown>;
            this.query = ((...args: unknown[]) => {
              const text = args[0];
              const intent =
                typeof text === "string" &&
                text.includes("INSERT INTO alert_send_attempts") &&
                text.includes("RETURNING id");
              if (intent && !crossed) {
                crossed = true;
                vi.setSystemTime(Date.now() + 24 * 60 * 60 * 1000);
              }
              return query(...args);
            }) as typeof this.query;
          }
        }
        return new Pool({
          connectionString: `${databaseUrl}${databaseUrl.includes("?") ? "&" : "?"}application_name=${label}`,
          Client: CrossesMidnight as unknown as new () => ClientBase,
        });
      };

      it("asks again whether the filing window is still open after waiting for the writer", async () => {
        const eventId = await createEvent(scenario("C"));
        const alertId = await insertDueAlert(eventId, "past-midnight@example.test", 2);
        await pool.query(
          `UPDATE alerts SET payload = payload || jsonb_build_object('controlling_apply_by', $2::text)
            WHERE id = $1`,
          [alertId, dayFromToday(0)],
        );
        const provider = fakeProvider();
        const crossingMidnight = poolCrossingMidnightOnTheIntent("crossing_midnight");

        vi.useFakeTimers({ toFake: ["Date"] });
        let summary;
        try {
          summary = await createAlertPoller({
            database: crossingMidnight,
            senders: provider.senders,
            jurisdiction: ruleset.jurisdiction,
          }).tick();
        } finally {
          vi.useRealTimers();
          await crossingMidnight.end();
        }

        expect(provider.attempts).toHaveLength(0);
        expect(summary.sent).toBe(0);
        expect(summary.failed).toBe(0);
        expect((await alertsOf(eventId))[0]?.status).toBe("cancelled");
        const recorded = await attemptsOf(alertId);
        expect(recorded).toHaveLength(1);
        expect(recorded[0]?.outcome_recorded_at).not.toBeNull();
      });

      const poolCrossingMidnightAndLosingTheCommit = (label: string): Pool => {
        let crossed = false;
        class CrossesMidnightThenLosesTheCommit extends Client {
          constructor(config?: ClientConfig) {
            super(config);
            const query = this.query.bind(this) as (...args: unknown[]) => Promise<unknown>;
            this.query = ((...args: unknown[]) => {
              const text = args[0];
              if (text === "COMMIT") {
                return Promise.reject(new Error("connection terminated unexpectedly"));
              }
              const intent =
                typeof text === "string" &&
                text.includes("INSERT INTO alert_send_attempts") &&
                text.includes("RETURNING id");
              if (intent && !crossed) {
                crossed = true;
                vi.setSystemTime(Date.now() + 24 * 60 * 60 * 1000);
              }
              return query(...args);
            }) as typeof this.query;
          }
        }
        return new Pool({
          connectionString: `${databaseUrl}${databaseUrl.includes("?") ? "&" : "?"}application_name=${label}`,
          Client: CrossesMidnightThenLosesTheCommit as unknown as new () => ClientBase,
        });
      };

      it("settles a shut-window attempt where the sending transaction cannot", async () => {
        const eventId = await createEvent(scenario("C"));
        const alertId = await insertDueAlert(eventId, "shut-window-lost-commit@example.test", 2);
        await pool.query(
          `UPDATE alerts SET payload = payload || jsonb_build_object('controlling_apply_by', $2::text)
            WHERE id = $1`,
          [alertId, dayFromToday(0)],
        );
        const provider = fakeProvider();
        const losingTheCommit = poolCrossingMidnightAndLosingTheCommit("shut_lost_commit");

        vi.useFakeTimers({ toFake: ["Date"] });
        try {
          await createAlertPoller({
            database: losingTheCommit,
            senders: provider.senders,
            jurisdiction: ruleset.jurisdiction,
          }).tick();
        } finally {
          vi.useRealTimers();
          await losingTheCommit.end();
        }

        expect(provider.attempts).toHaveLength(0);
        expect((await alertsOf(eventId))[0]?.status).toBe("pending");
        const recorded = await attemptsOf(alertId);
        expect(recorded).toHaveLength(1);
        expect(recorded[0]?.outcome_recorded_at).not.toBeNull();
      });

      const poolCrossingMidnightOnTheSendBoundary = (label: string): Pool => {
        let crossed = false;
        class CrossesMidnight extends Client {
          constructor(config?: ClientConfig) {
            super(config);
            const query = this.query.bind(this) as (...args: unknown[]) => Promise<unknown>;
            this.query = ((...args: unknown[]) => {
              const text = args[0];
              const boundary =
                typeof text === "string" && text.includes("AS shut") && text.includes("AS held");
              if (boundary && !crossed) {
                crossed = true;
                vi.setSystemTime(Date.now() + 24 * 60 * 60 * 1000);
              }
              return query(...args);
            }) as typeof this.query;
          }
        }
        return new Pool({
          connectionString: `${databaseUrl}${databaseUrl.includes("?") ? "&" : "?"}application_name=${label}`,
          Client: CrossesMidnight as unknown as new () => ClientBase,
        });
      };

      it("does not send on a day the send boundary answered about a different one", async () => {
        const eventId = await createEvent(scenario("C"));
        const alertId = await insertDueAlert(eventId, "boundary-midnight@example.test", 2);
        await pool.query(
          `UPDATE alerts SET payload = payload || jsonb_build_object('controlling_apply_by', $2::text)
            WHERE id = $1`,
          [alertId, dayFromToday(0)],
        );
        const provider = fakeProvider();
        const crossingMidnight = poolCrossingMidnightOnTheSendBoundary("crossing_boundary");

        vi.useFakeTimers({ toFake: ["Date"] });
        let summary;
        try {
          summary = await createAlertPoller({
            database: crossingMidnight,
            senders: provider.senders,
            jurisdiction: ruleset.jurisdiction,
          }).tick();
        } finally {
          vi.useRealTimers();
          await crossingMidnight.end();
        }

        expect(provider.attempts).toHaveLength(0);
        expect(summary.sent).toBe(0);
        expect(summary.failed).toBe(0);
        expect(summary.skipped).toBe(1);
        expect(summary.drained).toBe(false);
        expect((await alertsOf(eventId))[0]?.status).toBe("pending");
        const recorded = await attemptsOf(alertId);
        expect(recorded).toHaveLength(1);
        expect(recorded[0]?.outcome_recorded_at).not.toBeNull();
      });

      const poolShuttingTheWindowOnTheClaim = (label: string, planItemId: () => string): Pool => {
        let shut = false;
        class ShutsTheWindow extends Client {
          constructor(config?: ClientConfig) {
            super(config);
            const query = this.query.bind(this) as (...args: unknown[]) => Promise<unknown>;
            this.query = ((...args: unknown[]) => {
              const text = args[0];
              const claim =
                typeof text === "string" && text.includes("FOR NO KEY UPDATE SKIP LOCKED");
              if (!claim || shut) return query(...args);
              shut = true;
              return query(...args).then(async (result) => {
                await pool.query(
                  "UPDATE permit_plan_items SET latest_apply_date = $2::date WHERE id = $1",
                  [planItemId(), dayFromToday(-1)],
                );
                return result;
              });
            }) as typeof this.query;
          }
        }
        return new Pool({
          connectionString: `${databaseUrl}${databaseUrl.includes("?") ? "&" : "?"}application_name=${label}`,
          Client: ShutsTheWindow as unknown as new () => ClientBase,
        });
      };

      it("retires a window that shut while the claim was in flight, on a channel with no provider", async () => {
        const eventId = await createEvent(scenario("C"));
        const { checklistItemId } = await insertDuePlan(eventId, {
          latestApplyDate: dayFromToday(2),
        });
        const alertId = await insertDueAlert(eventId, "+15550000166", 2, { channel: "sms" });
        await pool.query("UPDATE alerts SET checklist_item_id = $2 WHERE id = $1", [
          alertId,
          checklistItemId,
        ]);
        const { rows: planItems } = await pool.query<{ plan_item_id: string }>(
          "SELECT plan_item_id FROM checklist_items WHERE id = $1",
          [checklistItemId],
        );
        const provider = fakeProvider();
        const shuttingMidClaim = poolShuttingTheWindowOnTheClaim(
          "shutting_claim",
          () => planItems[0]?.plan_item_id ?? "",
        );

        let summary;
        try {
          summary = await createAlertPoller({
            database: shuttingMidClaim,
            senders: provider.senders,
            jurisdiction: ruleset.jurisdiction,
          }).tick();
        } finally {
          await shuttingMidClaim.end();
        }

        expect(provider.attempts).toHaveLength(0);
        expect(summary.sent).toBe(0);
        expect((await alertsOf(eventId))[0]?.status).toBe("cancelled");
      });

      const poolLosingTheIntentAcknowledgement = (label: string, committed: boolean): Pool => {
        let lost = false;
        class LosesTheAcknowledgement extends Client {
          constructor(config?: ClientConfig) {
            super(config);
            const query = this.query.bind(this) as (...args: unknown[]) => Promise<unknown>;
            this.query = ((...args: unknown[]) => {
              const text = args[0];
              const intent =
                typeof text === "string" && text.includes("INSERT INTO alert_send_attempts");
              if (!intent || lost) return query(...args);
              lost = true;
              const gone = new Error("Connection terminated unexpectedly");
              if (!committed) return Promise.reject(gone);
              return query(...args).then(() => {
                throw gone;
              });
            }) as typeof this.query;
          }
        }
        return new Pool({
          connectionString: `${databaseUrl}${databaseUrl.includes("?") ? "&" : "?"}application_name=${label}`,
          Client: LosesTheAcknowledgement as unknown as new () => ClientBase,
        });
      };

      it("resolves an attempt whose insert acknowledgement is lost", async () => {
        const eventId = await createEvent(scenario("C"));
        const alertId = await insertDueAlert(eventId, "lost-ack@example.test", 2);
        const provider = fakeProvider();
        const losing = poolLosingTheIntentAcknowledgement("lost_ack_committed", true);

        await createAlertPoller({
          database: losing,
          senders: provider.senders,
          jurisdiction: ruleset.jurisdiction,
        }).tick();
        await losing.end();

        expect(provider.attempts).toHaveLength(0);
        const recorded = await attemptsOf(alertId);
        expect(recorded).toHaveLength(1);
        expect(recorded[0]?.outcome_recorded_at).not.toBeNull();

        await pool.query(
          `UPDATE alert_send_attempts
              SET attempted_at = current_timestamp - ($2 || ' hours')::interval
            WHERE alert_id = $1`,
          [alertId, PROVIDER_DEDUP_WINDOW_HOURS + 1],
        );
        const summary = await createAlertPoller({
          database: pool,
          senders: provider.senders,
          jurisdiction: ruleset.jurisdiction,
        }).tick();

        expect(summary.heldForReconciliation).toBe(0);
        expect((await alertsOf(eventId))[0]?.status).toBe("sent");
      });

      it("settles an intent whose row this process never saw arrive", async () => {
        const eventId = await createEvent(scenario("C"));
        const alertId = await insertDueAlert(eventId, "no-ack@example.test", 2);
        const provider = fakeProvider();
        const losing = poolLosingTheIntentAcknowledgement("lost_ack_uncommitted", false);

        await createAlertPoller({
          database: losing,
          senders: provider.senders,
          jurisdiction: ruleset.jurisdiction,
        }).tick();
        await losing.end();

        expect(provider.attempts).toHaveLength(0);
        const recorded = await attemptsOf(alertId);
        expect(recorded).toHaveLength(1);
        expect(recorded[0]?.outcome_recorded_at).not.toBeNull();
        expect(recorded[0]?.idempotency_key).toBe(alertId);
      });

      const poolRefusingEveryIntent = (label: string, atOnce: number): Pool => {
        let arrived = 0;
        let allHaveArrived: () => void = () => {};
        const everyIntentIsHolding = new Promise<void>((resolve) => {
          allHaveArrived = resolve;
        });
        class RefusesTheIntent extends Client {
          constructor(config?: ClientConfig) {
            super(config);
            const query = this.query.bind(this) as (...args: unknown[]) => Promise<unknown>;
            this.query = ((...args: unknown[]) => {
              const text = args[0];
              const intent =
                typeof text === "string" &&
                text.includes("INSERT INTO alert_send_attempts") &&
                text.includes("RETURNING id");
              if (!intent) return query(...args);
              arrived += 1;
              if (arrived === atOnce) allHaveArrived();
              return everyIntentIsHolding.then(() => query("SELECT refused_by_the_database()"));
            }) as typeof this.query;
          }
        }
        return new Pool({
          connectionString: `${databaseUrl}${databaseUrl.includes("?") ? "&" : "?"}application_name=${label}`,
          Client: RefusesTheIntent as unknown as new () => ClientBase,
        });
      };

      it("settles a whole tick of refused intents without waiting on the connections it holds", async () => {
        const label = "intent_refused_by_database";
        const eventId = await createEvent(scenario("C"));
        const alertIds: string[] = [];
        for (let index = 0; index < SEND_CONCURRENCY; index += 1)
          alertIds.push(await insertDueAlert(eventId, `refused-${index}@example.test`, 2));
        const provider = fakeProvider();
        const refusing = poolRefusingEveryIntent(label, SEND_CONCURRENCY);

        const tick = createAlertPoller({
          database: refusing,
          senders: provider.senders,
          jurisdiction: ruleset.jurisdiction,
        }).tick();
        let wedged: ReturnType<typeof setTimeout> | undefined;
        try {
          await Promise.race([
            tick,
            new Promise((_resolve, reject) => {
              wedged = setTimeout(
                () =>
                  reject(
                    new Error(
                      "the tick never finished: the attempt writer starved its own recovery",
                    ),
                  ),
                20_000,
              );
            }),
          ]);
        } catch (error) {
          await pool.query(
            "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE application_name = $1",
            [label],
          );
          throw error;
        } finally {
          clearTimeout(wedged);
        }
        await refusing.end();

        expect(provider.attempts).toHaveLength(0);
        for (const alertId of alertIds) {
          const recorded = await attemptsOf(alertId);
          expect(recorded).toHaveLength(1);
          expect(recorded[0]?.outcome_recorded_at).not.toBeNull();
        }
        const after = await alertsOf(eventId);
        expect(after).toHaveLength(SEND_CONCURRENCY);
        expect(after.every((row) => row.status === "pending")).toBe(true);
      }, 30_000);

      it("sends a pending alert with no recorded attempt however long it has been due", async () => {
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

      it("does not report a stranded demo send as needing a human", async () => {
        const eventId = await createEvent(scenario("C"));
        const demo = await insertDueAlert(eventId, "demo@example.test", 2, { test: true });
        const real = await insertDueAlert(eventId, "unreconciled@example.test", 2);
        await recordAttempt(demo, PROVIDER_DEDUP_WINDOW_HOURS + 1, false);
        await recordAttempt(real, PROVIDER_DEDUP_WINDOW_HOURS + 1, false);
        const warned = vi.spyOn(console, "warn").mockImplementation(() => {});

        const summary = await createAlertPoller({
          database: pool,
          senders: fakeProvider().senders,
          jurisdiction: ruleset.jurisdiction,
        }).tick();

        expect(summary.heldForReconciliation).toBe(1);
        const logged = warned.mock.calls.map((call) => String(call[0])).join("\n");
        warned.mockRestore();
        expect(logged).toContain(real);
        expect(logged).not.toContain(demo);
      });

      it("does not tell the operator a held alert reached a provider", async () => {
        const eventId = await createEvent(scenario("C"));
        const alertId = await insertDueAlert(eventId, "unreconciled@example.test", 2);
        await recordAttempt(alertId, PROVIDER_DEDUP_WINDOW_HOURS + 1, false);
        const warned = vi.spyOn(console, "warn").mockImplementation(() => {});

        await createAlertPoller({
          database: pool,
          senders: fakeProvider().senders,
          jurisdiction: ruleset.jurisdiction,
        }).tick();

        const logged = warned.mock.calls.map((call) => String(call[0])).join("\n");
        warned.mockRestore();
        const hold = logged.split("\n").find((line) => line.includes(alertId)) ?? "";
        expect(hold, "the hold is still reported").not.toBe("");
        expect(hold).toMatch(/attempted/i);
        expect(hold).not.toMatch(/were handed to a provider/i);
      });

      it("does not report an obsolete alert's aged attempt as needing a human", async () => {
        const eventId = await createEvent(scenario("C"));
        expect(await schedulePastDue(eventId, [reminderOffsets[0] ?? 7])).toBe(1);
        const alertId = (await alertsOf(eventId))[0]?.id ?? "";
        await moveFilingDateOut(alertId, 6);
        await recordAttempt(alertId, PROVIDER_DEDUP_WINDOW_HOURS + 1, false);
        const poller = createAlertPoller({
          database: pool,
          senders: fakeProvider().senders,
          jurisdiction: ruleset.jurisdiction,
        });
        expect((await poller.tick()).heldForReconciliation).toBe(1);

        await pool.query(
          "UPDATE events SET revision_counter = revision_counter + 1 WHERE id = $1",
          [eventId],
        );

        expect((await poller.tick()).heldForReconciliation).toBe(0);
      });

      it("keeps retrying an attempt the provider answered, however old that answer is", async () => {
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

      it("refuses the send when the writer connection took the margin the claim reserved", async () => {
        const eventId = await createEvent(scenario("C"));
        const alertId = await insertDueAlert(eventId, "margin-eaten@example.test", 2);
        await recordAttemptMsAgo(
          alertId,
          PROVIDER_DEDUP_WINDOW_HOURS * 3_600_000 - DEDUP_WINDOW_CLAIM_MARGIN_MS * 4,
        );
        const provider = fakeProvider();

        const connect = Pool.prototype.connect as (...args: unknown[]) => unknown;
        const isTheAttemptWriter = (candidate: Pool): boolean =>
          candidate.options.max === SEND_CONCURRENCY && candidate.options.allowExitOnIdle === true;
        const spy = vi.spyOn(Pool.prototype, "connect").mockImplementation(function (
          this: Pool,
          ...args: unknown[]
        ) {
          if (!isTheAttemptWriter(this)) return connect.apply(this, args);
          return (async (): Promise<PoolClient> => {
            await pool.query(
              `UPDATE alert_send_attempts
                    SET attempted_at = current_timestamp - ($2 || ' hours')::interval
                  WHERE alert_id = $1`,
              [alertId, PROVIDER_DEDUP_WINDOW_HOURS + 1],
            );
            return connect.apply(this, args) as Promise<PoolClient>;
          })();
        } as typeof Pool.prototype.connect);
        try {
          await createAlertPoller({
            database: pool,
            senders: provider.senders,
            jurisdiction: ruleset.jurisdiction,
          }).tick();
        } finally {
          spy.mockRestore();
        }

        expect(provider.attempts.map((message) => message.recipient)).not.toContain(
          "margin-eaten@example.test",
        );
        const { rows } = await pool.query<{ status: string }>(
          "SELECT status FROM alerts WHERE id = $1",
          [alertId],
        );
        expect(rows[0]?.status).toBe("pending");
        expect(await attemptsOf(alertId)).toHaveLength(1);
        expect(
          (
            await createAlertPoller({
              database: pool,
              senders: provider.senders,
              jurisdiction: ruleset.jurisdiction,
            }).tick()
          ).heldForReconciliation,
        ).toBeGreaterThanOrEqual(1);
      });

      it("refuses the send when the last wait before the provider took the rest of the window", async () => {
        const eventId = await createEvent(scenario("C"));
        const alertId = await insertDueAlert(eventId, "boundary@example.test", 2);
        await recordAttemptMsAgo(
          alertId,
          PROVIDER_DEDUP_WINDOW_HOURS * 3_600_000 - DEDUP_WINDOW_CLAIM_MARGIN_MS * 4,
        );
        const provider = fakeProvider();

        const query = Client.prototype.query as (...args: unknown[]) => unknown;
        const spy = vi.spyOn(Client.prototype, "query").mockImplementation(function (
          this: Client,
          ...args: unknown[]
        ) {
          const first = args[0];
          const text =
            typeof first === "string" ? first : ((first as { text?: string })?.text ?? "");
          if (!text.includes("controlling_apply_by")) return query.apply(this, args);
          return (async () => {
            const { rows } = await pool.query<{ open: number }>(
              `SELECT count(*)::int AS open FROM alert_send_attempts
                  WHERE alert_id = $1 AND outcome_recorded_at IS NULL`,
              [alertId],
            );
            if ((rows[0]?.open ?? 0) >= 2) {
              await pool.query(
                `UPDATE alert_send_attempts
                      SET attempted_at = current_timestamp - ($2 || ' hours')::interval
                    WHERE alert_id = $1
                      AND attempted_at < current_timestamp - interval '1 hour'`,
                [alertId, PROVIDER_DEDUP_WINDOW_HOURS + 1],
              );
            }
            return query.apply(this, args);
          })();
        } as typeof Client.prototype.query);
        try {
          await createAlertPoller({
            database: pool,
            senders: provider.senders,
            jurisdiction: ruleset.jurisdiction,
          }).tick();
        } finally {
          spy.mockRestore();
        }

        expect(provider.attempts.map((message) => message.recipient)).not.toContain(
          "boundary@example.test",
        );
        const { rows } = await pool.query<{ status: string }>(
          "SELECT status FROM alerts WHERE id = $1",
          [alertId],
        );
        expect(rows[0]?.status).toBe("pending");
        const recorded = await attemptsOf(alertId);
        expect(recorded).toHaveLength(2);
        expect(recorded.filter((attempt) => attempt.outcome_recorded_at === null)).toHaveLength(1);
      });

      it("still retries an attempt with the whole margin left before the window closes", async () => {
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

      it("refuses the send when the handoff outlived the margin the boundary reserved", async () => {
        const eventId = await createEvent(scenario("C"));
        const alertId = await insertDueAlert(eventId, "slow-handoff@example.test", 2);
        const provider = fakeProvider();

        const realNow = Date.now.bind(Date);
        let answered = false;
        let refused = false;
        const query = Client.prototype.query as (...args: unknown[]) => unknown;
        const querySpy = vi.spyOn(Client.prototype, "query").mockImplementation(function (
          this: Client,
          ...args: unknown[]
        ) {
          const first = args[0];
          const text =
            typeof first === "string" ? first : ((first as { text?: string })?.text ?? "");
          const result = query.apply(this, args) as Promise<unknown>;
          if (!text.includes("AS shut")) {
            answered = false;
            return result;
          }
          return result.then((rows) => {
            answered = true;
            refused = true;
            return rows;
          });
        } as typeof Client.prototype.query);
        const clockSpy = vi
          .spyOn(Date, "now")
          .mockImplementation(() => (answered ? realNow() + SEND_BOUNDARY_MARGIN_MS : realNow()));
        try {
          await createAlertPoller({
            database: pool,
            senders: provider.senders,
            jurisdiction: ruleset.jurisdiction,
            clock: () => (refused ? realNow() + TICK_BUDGET_MS : realNow()),
          }).tick();
        } finally {
          clockSpy.mockRestore();
          querySpy.mockRestore();
        }

        expect(provider.attempts.map((message) => message.recipient)).not.toContain(
          "slow-handoff@example.test",
        );
        const recorded = await attemptsOf(alertId);
        expect(recorded.length).toBeGreaterThanOrEqual(1);
        expect(recorded.filter((attempt) => attempt.outcome_recorded_at === null)).toHaveLength(0);
        const { rows } = await pool.query<{ status: string }>(
          "SELECT status FROM alerts WHERE id = $1",
          [alertId],
        );
        expect(rows[0]?.status).toBe("pending");
      });

      it("counts the wait for the boundary answer against the margin it reserved", async () => {
        const eventId = await createEvent(scenario("C"));
        const alertId = await insertDueAlert(eventId, "stalled-answer@example.test", 2);
        const provider = fakeProvider();

        const realNow = Date.now.bind(Date);
        let issued = false;
        let refused = false;
        const query = Client.prototype.query as (...args: unknown[]) => unknown;
        const querySpy = vi.spyOn(Client.prototype, "query").mockImplementation(function (
          this: Client,
          ...args: unknown[]
        ) {
          const first = args[0];
          const text =
            typeof first === "string" ? first : ((first as { text?: string })?.text ?? "");
          issued = text.includes("AS shut");
          refused ||= issued;
          return query.apply(this, args) as Promise<unknown>;
        } as typeof Client.prototype.query);
        const clockSpy = vi
          .spyOn(Date, "now")
          .mockImplementation(() => (issued ? realNow() + SEND_BOUNDARY_MARGIN_MS : realNow()));
        try {
          await createAlertPoller({
            database: pool,
            senders: provider.senders,
            jurisdiction: ruleset.jurisdiction,
            clock: () => (refused ? realNow() + TICK_BUDGET_MS : realNow()),
          }).tick();
        } finally {
          clockSpy.mockRestore();
          querySpy.mockRestore();
        }

        expect(provider.attempts.map((message) => message.recipient)).not.toContain(
          "stalled-answer@example.test",
        );
        const { rows } = await pool.query<{ status: string }>(
          "SELECT status FROM alerts WHERE id = $1",
          [alertId],
        );
        expect(rows[0]?.status).toBe("pending");
        const recorded = await attemptsOf(alertId);
        expect(recorded.length).toBeGreaterThanOrEqual(1);
        expect(recorded.filter((attempt) => attempt.outcome_recorded_at === null)).toHaveLength(0);
      });

      it("chases a margin refusal inside the same tick instead of banking it as done", async () => {
        const eventId = await createEvent(scenario("C"));
        const alertId = await insertDueAlert(eventId, "chased-handoff@example.test", 2);
        const provider = fakeProvider();

        const realNow = Date.now.bind(Date);
        let boundaryAnswers = 0;
        const query = Client.prototype.query as (...args: unknown[]) => unknown;
        const querySpy = vi.spyOn(Client.prototype, "query").mockImplementation(function (
          this: Client,
          ...args: unknown[]
        ) {
          const first = args[0];
          const text =
            typeof first === "string" ? first : ((first as { text?: string })?.text ?? "");
          const result = query.apply(this, args) as Promise<unknown>;
          if (!text.includes("AS shut")) return result;
          return result.then((rows) => {
            boundaryAnswers += 1;
            return rows;
          });
        } as typeof Client.prototype.query);
        const clockSpy = vi
          .spyOn(Date, "now")
          .mockImplementation(() =>
            boundaryAnswers === 1 ? realNow() + SEND_BOUNDARY_MARGIN_MS : realNow(),
          );
        let summary;
        try {
          summary = await createAlertPoller({
            database: pool,
            senders: provider.senders,
            jurisdiction: ruleset.jurisdiction,
          }).tick();
        } finally {
          clockSpy.mockRestore();
          querySpy.mockRestore();
        }

        expect(provider.attempts.map((message) => message.recipient)).toContain(
          "chased-handoff@example.test",
        );
        expect(summary.sent).toBe(1);
        const { rows } = await pool.query<{ status: string }>(
          "SELECT status FROM alerts WHERE id = $1",
          [alertId],
        );
        expect(rows[0]?.status).toBe("sent");
        const recorded = await attemptsOf(alertId);
        expect(recorded).toHaveLength(2);
        expect(recorded.filter((attempt) => attempt.outcome_recorded_at === null)).toHaveLength(0);
      });

      const lastInstantOfToday = (msBefore: number): Date =>
        new Date(
          instantAtLocalHour(
            ruleset.jurisdiction,
            todayInJurisdiction(ruleset.jurisdiction),
            24,
          ).getTime() - msBefore,
        );

      it("refuses a final-day send with less filing-window time left than the handoff needs", async () => {
        const eventId = await createEvent(scenario("C"));
        const alertId = await insertDueAlert(eventId, "window-edge@example.test", 2);
        await pool.query(
          `UPDATE alerts SET payload = payload || jsonb_build_object('controlling_apply_by', $2::text)
            WHERE id = $1`,
          [alertId, dayFromToday(0)],
        );
        const provider = fakeProvider();

        vi.useFakeTimers({ toFake: ["Date"] });
        vi.setSystemTime(lastInstantOfToday(SEND_BOUNDARY_MARGIN_MS / 2));
        try {
          await createAlertPoller({
            database: pool,
            senders: provider.senders,
            jurisdiction: ruleset.jurisdiction,
          }).tick();
        } finally {
          vi.useRealTimers();
        }

        expect(provider.attempts).toHaveLength(0);
        const { rows } = await pool.query<{ status: string }>(
          "SELECT status FROM alerts WHERE id = $1",
          [alertId],
        );
        expect(rows[0]?.status).toBe("pending");
        const recorded = await attemptsOf(alertId);
        expect(recorded).toHaveLength(1);
        expect(recorded[0]?.outcome_recorded_at).not.toBeNull();
      });

      it("still sends on the final day while the whole handoff fits inside it", async () => {
        const eventId = await createEvent(scenario("C"));
        const alertId = await insertDueAlert(eventId, "window-edge-fits@example.test", 2);
        await pool.query(
          `UPDATE alerts SET payload = payload || jsonb_build_object('controlling_apply_by', $2::text)
            WHERE id = $1`,
          [alertId, dayFromToday(0)],
        );
        const provider = fakeProvider();

        vi.useFakeTimers({ toFake: ["Date"] });
        vi.setSystemTime(lastInstantOfToday(SEND_BOUNDARY_MARGIN_MS * 3));
        try {
          await createAlertPoller({
            database: pool,
            senders: provider.senders,
            jurisdiction: ruleset.jurisdiction,
          }).tick();
        } finally {
          vi.useRealTimers();
        }

        expect(provider.attempts.map((message) => message.recipient)).toContain(
          "window-edge-fits@example.test",
        );
        const { rows } = await pool.query<{ status: string }>(
          "SELECT status FROM alerts WHERE id = $1",
          [alertId],
        );
        expect(rows[0]?.status).toBe("sent");
      });

      it("sends in the same last minutes of the day when the window is open past today", async () => {
        const eventId = await createEvent(scenario("C"));
        const alertId = await insertDueAlert(eventId, "window-open-tomorrow@example.test", 2);
        await pool.query(
          `UPDATE alerts SET payload = payload || jsonb_build_object('controlling_apply_by', $2::text)
            WHERE id = $1`,
          [alertId, dayFromToday(1)],
        );
        const provider = fakeProvider();

        vi.useFakeTimers({ toFake: ["Date"] });
        vi.setSystemTime(lastInstantOfToday(SEND_BOUNDARY_MARGIN_MS / 2));
        try {
          await createAlertPoller({
            database: pool,
            senders: provider.senders,
            jurisdiction: ruleset.jurisdiction,
          }).tick();
        } finally {
          vi.useRealTimers();
        }

        expect(provider.attempts.map((message) => message.recipient)).toContain(
          "window-open-tomorrow@example.test",
        );
        const { rows } = await pool.query<{ status: string }>(
          "SELECT status FROM alerts WHERE id = $1",
          [alertId],
        );
        expect(rows[0]?.status).toBe("sent");
      });

      it("sends in those minutes for an alert whose gated item has no filing date", async () => {
        const eventId = await createEvent(scenario("C"));
        const { checklistItemId } = await insertDuePlan(eventId, { latestApplyDate: null });
        const alertId = await insertDueAlert(eventId, "no-filing-window@example.test", 2);
        await pool.query("UPDATE alerts SET checklist_item_id = $2 WHERE id = $1", [
          alertId,
          checklistItemId,
        ]);
        const provider = fakeProvider();

        vi.useFakeTimers({ toFake: ["Date"] });
        vi.setSystemTime(lastInstantOfToday(SEND_BOUNDARY_MARGIN_MS / 2));
        try {
          await createAlertPoller({
            database: pool,
            senders: provider.senders,
            jurisdiction: ruleset.jurisdiction,
          }).tick();
        } finally {
          vi.useRealTimers();
        }

        expect(provider.attempts.map((message) => message.recipient)).toContain(
          "no-filing-window@example.test",
        );
        const { rows } = await pool.query<{ status: string }>(
          "SELECT status FROM alerts WHERE id = $1",
          [alertId],
        );
        expect(rows[0]?.status).toBe("sent");
      });

      it("retries an alert whose unresolved attempt is older than the hold limit", async () => {
        const eventId = await createEvent(scenario("C"));
        const alertId = await insertDueAlert(eventId, "past-the-bound@example.test", 2);
        await recordAttempt(alertId, UNRESOLVED_ATTEMPT_HOLD_LIMIT_HOURS + 1, false);
        const provider = fakeProvider();

        const summary = await createAlertPoller({
          database: pool,
          senders: provider.senders,
          jurisdiction: ruleset.jurisdiction,
        }).tick();

        expect(provider.attempts.map((message) => message.recipient)).toContain(
          "past-the-bound@example.test",
        );
        expect(summary.heldForReconciliation).toBe(0);
        const { rows } = await pool.query<{ status: string }>(
          "SELECT status FROM alerts WHERE id = $1",
          [alertId],
        );
        expect(rows[0]?.status).toBe("sent");
      });

      it("still holds an alert whose unresolved attempt is inside the hold limit", async () => {
        const eventId = await createEvent(scenario("C"));
        const alertId = await insertDueAlert(eventId, "inside-the-bound@example.test", 2);
        await recordAttempt(alertId, UNRESOLVED_ATTEMPT_HOLD_LIMIT_HOURS - 1, false);
        const provider = fakeProvider();

        const summary = await createAlertPoller({
          database: pool,
          senders: provider.senders,
          jurisdiction: ruleset.jurisdiction,
        }).tick();

        expect(provider.attempts.map((message) => message.recipient)).not.toContain(
          "inside-the-bound@example.test",
        );
        expect(summary.heldForReconciliation).toBeGreaterThanOrEqual(1);
        const { rows } = await pool.query<{ status: string }>(
          "SELECT status FROM alerts WHERE id = $1",
          [alertId],
        );
        expect(rows[0]?.status).toBe("pending");
      });

      const poolRefusingTheSendBoundary = (label: string): Pool => {
        class RefusesTheBoundary extends Client {
          constructor(config?: ClientConfig) {
            super(config);
            const query = this.query.bind(this) as (...args: unknown[]) => Promise<unknown>;
            this.query = ((...args: unknown[]) => {
              const text = args[0];
              const boundary =
                typeof text === "string" && text.includes("AS shut") && text.includes("AS held");
              if (!boundary) return query(...args);
              return query("SELECT refused_by_the_database()");
            }) as typeof this.query;
          }
        }
        return new Pool({
          connectionString: `${databaseUrl}${databaseUrl.includes("?") ? "&" : "?"}application_name=${label}`,
          Client: RefusesTheBoundary as unknown as new () => ClientBase,
        });
      };

      it("settles the intent when the send boundary itself is refused", async () => {
        const eventId = await createEvent(scenario("C"));
        const alertId = await insertDueAlert(eventId, "refused-boundary@example.test", 2);
        const provider = fakeProvider();
        const refusing = poolRefusingTheSendBoundary("refused_boundary");

        try {
          await createAlertPoller({
            database: refusing,
            senders: provider.senders,
            jurisdiction: ruleset.jurisdiction,
          }).tick();
        } finally {
          await refusing.end();
        }

        expect(provider.attempts).toHaveLength(0);
        const recorded = await attemptsOf(alertId);
        expect(recorded).toHaveLength(1);
        expect(recorded[0]?.outcome_recorded_at).not.toBeNull();
        const { rows } = await pool.query<{ status: string }>(
          "SELECT status FROM alerts WHERE id = $1",
          [alertId],
        );
        expect(rows[0]?.status).toBe("pending");
      });

      it("retries a one-day reminder inside its own window rather than holding it past the deadline", async () => {
        const eventId = await createEvent(scenario("C"));
        const alertId = await insertDueAlert(eventId, "one-day@example.test", 1);
        await pool.query(
          `UPDATE alerts SET payload = payload || jsonb_build_object('controlling_apply_by', $2::text)
            WHERE id = $1`,
          [alertId, dayFromToday(0)],
        );
        await recordAttempt(alertId, PROVIDER_DEDUP_WINDOW_HOURS + 1, false);
        const provider = fakeProvider();

        const summary = await createAlertPoller({
          database: pool,
          senders: provider.senders,
          jurisdiction: ruleset.jurisdiction,
        }).tick();

        expect(provider.attempts.map((message) => message.recipient)).toContain(
          "one-day@example.test",
        );
        expect(summary.heldForReconciliation).toBe(0);
        const { rows } = await pool.query<{ status: string }>(
          "SELECT status FROM alerts WHERE id = $1",
          [alertId],
        );
        expect(rows[0]?.status).toBe("sent");
      });

      it("still holds a long-lead reminder whose window outlasts the hold limit", async () => {
        const eventId = await createEvent(scenario("C"));
        const alertId = await insertDueAlert(eventId, "long-lead@example.test", 1);
        await pool.query(
          `UPDATE alerts SET payload = payload || jsonb_build_object('controlling_apply_by', $2::text)
            WHERE id = $1`,
          [alertId, dayFromToday(6)],
        );
        await recordAttempt(alertId, PROVIDER_DEDUP_WINDOW_HOURS + 1, false);
        const provider = fakeProvider();

        const summary = await createAlertPoller({
          database: pool,
          senders: provider.senders,
          jurisdiction: ruleset.jurisdiction,
        }).tick();

        expect(provider.attempts.map((message) => message.recipient)).not.toContain(
          "long-lead@example.test",
        );
        expect(summary.heldForReconciliation).toBeGreaterThanOrEqual(1);
        const { rows } = await pool.query<{ status: string }>(
          "SELECT status FROM alerts WHERE id = $1",
          [alertId],
        );
        expect(rows[0]?.status).toBe("pending");
      });

      it("deduplicates a last-day retry whose idempotency key is still live rather than delivering twice", async () => {
        const eventId = await createEvent(scenario("C"));
        const alertId = await insertDueAlert(eventId, "live-key@example.test", 1);
        await pool.query(
          `UPDATE alerts SET payload = payload || jsonb_build_object('controlling_apply_by', $2::text)
            WHERE id = $1`,
          [alertId, dayFromToday(0)],
        );
        await recordAttempt(alertId, 1, false);
        const provider = fakeProvider();
        provider.delivered.push({
          recipient: "live-key@example.test",
          subject: "file it",
          body: "file it",
          idempotencyKey: alertId,
        });

        await createAlertPoller({
          database: pool,
          senders: provider.senders,
          jurisdiction: ruleset.jurisdiction,
        }).tick();

        const retried = provider.attempts.filter(
          (message) => message.recipient === "live-key@example.test",
        );
        expect(retried).toHaveLength(1);
        expect(retried[0]?.idempotencyKey).toBe(alertId);
        expect(
          provider.delivered.filter((message) => message.idempotencyKey === alertId),
        ).toHaveLength(1);
      });

      it("releases an outage at the bound measured from the first unresolved attempt", async () => {
        const eventId = await createEvent(scenario("C"));
        const alertId = await insertDueAlert(eventId, "outage@example.test", 2);
        await recordAttempt(alertId, UNRESOLVED_ATTEMPT_HOLD_LIMIT_HOURS + 1, false);
        for (
          let hoursAgo = UNRESOLVED_ATTEMPT_HOLD_LIMIT_HOURS - 1;
          hoursAgo > PROVIDER_DEDUP_WINDOW_HOURS;
          hoursAgo -= 1
        ) {
          await recordAttempt(alertId, hoursAgo, false);
        }
        const provider = fakeProvider();

        const summary = await createAlertPoller({
          database: pool,
          senders: provider.senders,
          jurisdiction: ruleset.jurisdiction,
        }).tick();

        expect(provider.attempts.map((message) => message.recipient)).toContain(
          "outage@example.test",
        );
        expect(summary.heldForReconciliation).toBe(0);
        const { rows } = await pool.query<{ status: string }>(
          "SELECT status FROM alerts WHERE id = $1",
          [alertId],
        );
        expect(rows[0]?.status).toBe("sent");
        const attempts = await attemptsOf(alertId);
        expect(
          attempts.filter(
            (attempt) => attempt.outcome_recorded_at === null && attempt.superseded_at === null,
          ),
        ).toEqual([]);
      });

      it("keeps back enough of the window for the provider request itself", async () => {
        const eventId = await createEvent(scenario("C"));
        const alertId = await insertDueAlert(eventId, "handoff@example.test", 2);
        await recordAttemptMsAgo(
          alertId,
          PROVIDER_DEDUP_WINDOW_HOURS * 3_600_000 - DEDUP_WINDOW_CLAIM_MARGIN_MS * 4,
        );
        const provider = fakeProvider();
        const insideTheHandoffMargin = `${PROVIDER_DEDUP_WINDOW_HOURS * 3_600_000 - SEND_BOUNDARY_MARGIN_MS / 2} milliseconds`;

        const query = Client.prototype.query as (...args: unknown[]) => unknown;
        const spy = vi.spyOn(Client.prototype, "query").mockImplementation(function (
          this: Client,
          ...args: unknown[]
        ) {
          const first = args[0];
          const text =
            typeof first === "string" ? first : ((first as { text?: string })?.text ?? "");
          if (!text.includes("controlling_apply_by")) return query.apply(this, args);
          return (async () => {
            const { rows } = await pool.query<{ open: number }>(
              `SELECT count(*)::int AS open FROM alert_send_attempts
                  WHERE alert_id = $1 AND outcome_recorded_at IS NULL`,
              [alertId],
            );
            if ((rows[0]?.open ?? 0) >= 2) {
              await pool.query(
                `UPDATE alert_send_attempts
                      SET attempted_at = current_timestamp - $2::interval
                    WHERE alert_id = $1
                      AND attempted_at < current_timestamp - interval '1 hour'`,
                [alertId, insideTheHandoffMargin],
              );
            }
            return query.apply(this, args);
          })();
        } as typeof Client.prototype.query);
        try {
          await createAlertPoller({
            database: pool,
            senders: provider.senders,
            jurisdiction: ruleset.jurisdiction,
          }).tick();
        } finally {
          spy.mockRestore();
        }

        expect(provider.attempts.map((message) => message.recipient)).not.toContain(
          "handoff@example.test",
        );
        const { rows } = await pool.query<{ status: string }>(
          "SELECT status FROM alerts WHERE id = $1",
          [alertId],
        );
        expect(rows[0]?.status).toBe("pending");
      });

      it("delivers a revived alert instead of holding it on the withdrawn schedule's attempt", async () => {
        const eventId = await createEvent(scenario("C"));
        const contacts = { email: "revived@example.test", phone: null };
        const dated = await insertDuePlan(eventId, { latestApplyDate: dayFromToday(1) });
        const client = await pool.connect();
        try {
          await schedulerWith()(client, eventId, dated.planId, contacts);
          const reminder = (await alertsOf(eventId)).find(
            (row) => row.alert_type === "deadline_reminder",
          );
          await recordAttemptMsAgo(
            reminder?.id ?? "",
            PROVIDER_DEDUP_WINDOW_HOURS * 3_600_000 + 3_600_000,
            reminder?.idempotency_key,
          );

          const undated = await insertDuePlan(eventId, {
            latestApplyDate: null,
            reuseChecklistItemId: dated.checklistItemId,
          });
          await schedulerWith()(client, eventId, undated.planId, contacts);
          expect((await alertsOf(eventId)).find((row) => row.id === reminder?.id)?.status).toBe(
            "cancelled",
          );

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
          const kept = await attemptsOf(reminder?.id ?? "");
          expect(kept[0]?.outcome_recorded_at).toBeNull();
          expect(kept[0]?.superseded_at).not.toBeNull();
        } finally {
          client.release();
        }
      });

      it("holds the failures an upgrade finds behind no attempt, and only those", async () => {
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
        expect(await reconciliationHolds(pool, eventId, ruleset.jurisdiction)).toEqual([
          { channel: "email", heldCount: 1 },
        ]);
        const seeded = await attemptsOf(failedEmail);
        expect(seeded).toHaveLength(1);
        expect(seeded[0]?.outcome_recorded_at).toBeNull();
        expect(provider.delivered.map((message) => message.recipient).sort()).toEqual([
          "+15555550199",
          "legacy-untried@example.test",
        ]);
      });

      it("holds a backfilled attempt for the provider's window and then retries it", async () => {
        const eventId = await createEvent(scenario("C"));
        const backfilled = await insertDueAlert(eventId, "backfilled@example.test", 30, {
          status: "failed",
        });

        await seedLegacyAttempts();

        const atUpgrade = fakeProvider();
        const held = await createAlertPoller({
          database: pool,
          senders: atUpgrade.senders,
          jurisdiction: ruleset.jurisdiction,
        }).tick();
        expect
          .soft(atUpgrade.attempts.map((message) => message.recipient))
          .not.toContain("backfilled@example.test");
        expect.soft(held.heldForReconciliation).toBe(1);

        await pool.query(
          `UPDATE alert_send_attempts
              SET attempted_at = attempted_at - ($2 || ' hours')::interval
            WHERE alert_id = $1`,
          [backfilled, PROVIDER_DEDUP_WINDOW_HOURS + 1],
        );
        const later = fakeProvider();
        const retried = await createAlertPoller({
          database: pool,
          senders: later.senders,
          jurisdiction: ruleset.jurisdiction,
        }).tick();

        expect
          .soft(later.delivered.map((message) => message.recipient))
          .toContain("backfilled@example.test");
        expect(retried.heldForReconciliation).toBe(0);
      });

      it("backfills a single local failure, whose count cannot rule out a crashed attempt", async () => {
        const eventId = await createEvent(scenario("C"));
        const localError = await unconfiguredEmailSender()({
          recipient: "no-credentials@example.test",
          subject: "",
          body: "",
          idempotencyKey: "",
        }).then(
          () => "",
          (error: Error) => error.message,
        );
        const crashedThenLocal = await insertDueAlert(eventId, "crash-window@example.test", 30, {
          status: "failed",
          lastError: localError,
          failureCount: 1,
        });

        await seedLegacyAttempts();

        expect(await attemptsOf(crashedThenLocal)).toHaveLength(1);

        const provider = fakeProvider();
        const summary = await createAlertPoller({
          database: pool,
          senders: provider.senders,
          jurisdiction: ruleset.jurisdiction,
        }).tick();

        expect(provider.delivered.map((message) => message.recipient)).not.toContain(
          "crash-window@example.test",
        );
        expect(summary.heldForReconciliation).toBe(1);
      });

      it("records no provider attempt for an email channel with no credentials", async () => {
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
        expect(await reconciliationHolds(pool, eventId, ruleset.jurisdiction)).toEqual([]);
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

      expect(provider.attempts).toHaveLength(1);
      expect((await alertsOf(eventId)).every((row) => row.status === "sent")).toBe(true);
    });

    it("serves a fresh alert even when a full batch of dead destinations is due", async () => {
      const eventId = await createEvent(scenario("C"));
      expect(await schedulePastDue(eventId, [1])).toBe(1);
      await pool.query(
        `INSERT INTO alerts (id, event_id, alert_type, channel, recipient, idempotency_key,
                             send_at, status, failure_count, payload)
         SELECT gen_random_uuid(), $1::uuid, 'deadline_reminder', 'email', 'dead@example.test',
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

      const summary = await createAlertPoller({
        database: pool,
        senders: provider.senders,
        jurisdiction: ruleset.jurisdiction,
      }).tick();

      expect(summary.sent).toBe(events.length);
      expect(peakInFlight).toBe(events.length);
    });

    it("sends one event's own alerts in parallel, not behind each other", async () => {
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

      const summary = await createAlertPoller({
        database: pool,
        senders: provider.senders,
        jurisdiction: ruleset.jurisdiction,
      }).tick();

      expect(summary.sent).toBe(6);
      expect(peakInFlight).toBe(6);
    });

    it("stops claiming once the tick budget is spent, and leaves the rest due", async () => {
      const eventId = await createEvent(scenario("C"));
      await schedulePastDue(eventId, [7, 6, 5, 4, 3, 2, 1, 14]);
      const provider = fakeProvider();
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
      expect((alert?.sent_at as Date).getTime() - beforeTick.getTime()).toBeGreaterThanOrEqual(250);
    });

    it("stops a dead backlog consuming every scan, so a later alert is served at once", async () => {
      const dead = await createEvent(scenario("C"));
      await schedulePastDue(dead, [7, 6, 5, 4]);
      const provider = fakeProvider();
      provider.failFor = "organizer@example.test";
      const poller = createAlertPoller({
        database: pool,
        senders: provider.senders,
        jurisdiction: ruleset.jurisdiction,
      });

      await poller.tick();
      await poller.tick();
      expect((await alertsOf(dead)).every((row) => row.failure_count === 2)).toBe(true);
      const attemptsOnBacklog = provider.attempts.length;

      const live = await createEvent(scenario("C"));
      await schedulePastDue(live, [1]);
      provider.failFor = "nobody@example.test";

      await poller.tick();

      expect((await alertsOf(live)).every((row) => row.status === "sent")).toBe(true);
      expect(provider.attempts.length).toBe(attemptsOnBacklog + 1);
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
      const eventId = await createEvent(scenario("C"));
      expect(await schedulePastDue(eventId, [7, 6, 5, 4, 3, 2])).toBe(6);
      const provider = fakeProvider();
      provider.beforeSend = () => new Promise((resolve) => setTimeout(resolve, 30));
      const base = Date.now();
      const clock = (): number => (Date.now() - base) * 200;
      const poller = createAlertPoller({
        jurisdiction: ruleset.jurisdiction,
        database: pool,
        senders: provider.senders,
        intervalMs: 60_000,
        clock,
      });

      poller.start();
      await new Promise((resolve) => setTimeout(resolve, 700));
      await poller.stop();

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
      await poller.stop();
      await poller.stop();

      expect(provider.delivered).toHaveLength(2);
      expect((await alertsOf(eventId)).every((row) => row.status === "sent")).toBe(true);
    });

    it("finishes the send already in flight before it reports itself stopped", async () => {
      const eventId = await createEvent(scenario("C"));
      expect(await schedulePastDue(eventId, [reminderOffsets[0] ?? 7])).toBe(1);
      const provider = fakeProvider();
      provider.beforeSend = () => new Promise((resolve) => setTimeout(resolve, 300));
      const poller = createAlertPoller({
        jurisdiction: ruleset.jurisdiction,
        database: pool,
        senders: provider.senders,
        intervalMs: 5,
      });

      poller.start();
      await new Promise((resolve) => setTimeout(resolve, 60));
      await poller.stop();

      expect(provider.delivered).toHaveLength(1);
      expect((await alertsOf(eventId)).every((row) => row.status === "sent")).toBe(true);
    });
  });

  describe("the rollout pause DEPLOY.md runs before migration 014", () => {
    it("waits for the send in flight, stops the queue, and gives it back on the un-pause", async () => {
      const eventId = await createEvent(scenario("C"));
      const writeDueAlert = async (recipient: string): Promise<string> => {
        const alertId = randomUUID();
        await pool.query(
          `INSERT INTO alerts (id, event_id, alert_type, channel, recipient, idempotency_key,
                               send_at, status, payload)
           VALUES ($1, $2, 'deadline_reminder', 'email', $3, $4,
                   current_timestamp - interval '1 hour', 'pending',
                   '{"subject":"file it","body":"file it"}'::jsonb)`,
          [alertId, eventId, recipient, alertId],
        );
        return alertId;
      };
      const statusOf = async (alertId: string): Promise<string> =>
        (await pool.query<{ status: string }>("SELECT status FROM alerts WHERE id = $1", [alertId]))
          .rows[0]?.status ?? "";

      const inFlight = await writeDueAlert("in-flight@example.test");
      const provider = fakeProvider();
      let releaseTheSend = (): void => {};
      const handedOver = new Promise<void>((entered) => {
        provider.beforeSend = () =>
          new Promise<void>((resume) => {
            releaseTheSend = resume;
            entered();
          });
      });
      const poller = createAlertPoller({
        database: pool,
        senders: provider.senders,
        jurisdiction: ruleset.jurisdiction,
      });
      const tickHoldingTheSend = poller.tick();
      await handedOver;

      const queued = await writeDueAlert("queued@example.test");

      const resumeAt = "2099-01-01T00:00:00Z";
      let pauseReturned = false;
      const pause = pool
        .query(
          `UPDATE alerts SET next_attempt_at = $1
            WHERE status IN ('pending', 'failed') AND channel = 'email'`,
          [resumeAt],
        )
        .then((result) => {
          pauseReturned = true;
          return result;
        });

      await new Promise((settle) => setTimeout(settle, 250));
      expect(pauseReturned).toBe(false);

      releaseTheSend();
      await tickHoldingTheSend;
      await pause;

      expect(await statusOf(inFlight)).toBe("sent");
      expect(provider.delivered).toHaveLength(1);

      provider.beforeSend = null;
      await poller.tick();
      expect(provider.delivered).toHaveLength(1);
      expect(await statusOf(queued)).toBe("pending");

      await pool.query("UPDATE alerts SET next_attempt_at = NULL WHERE next_attempt_at = $1", [
        resumeAt,
      ]);
      await poller.tick();
      expect(provider.delivered).toHaveLength(2);
      expect(await statusOf(queued)).toBe("sent");
    });
  });

  describe("AC 7 — regeneration recomputes pending alerts and never re-sends a sent one", () => {
    it("cancels what the new plan no longer calls for, keeps what it still does, and leaves sent alerts alone", async () => {
      const eventId = await createEvent(scenario("C"));
      await materialize(eventId);
      const before = await alertsOf(eventId);
      const sentAlready = before.find((row) => row.alert_type === "deadline_reminder");
      await pool.query(
        "UPDATE alerts SET status = 'sent', sent_at = current_timestamp WHERE id = $1",
        [sentAlready?.id],
      );

      const patch = await request(appWith(fakeProvider()))
        .patch(`/api/events/${eventId}`)
        .send({ event_date: "2026-10-16" });
      expect(patch.status).toBe(200);
      const response = await materialize(eventId);
      expect(response.status).toBe(200);

      const after = await alertsOf(eventId);
      const byKey = new Map(after.map((row) => [row.idempotency_key, row]));
      expect(byKey.get(sentAlready?.idempotency_key ?? "")?.status).toBe("sent");
      expect(after.filter((row) => row.alert_type === "deadline_reminder")).toHaveLength(
        before.filter((row) => row.alert_type === "deadline_reminder").length,
      );
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
      const unlock = before.find((row) => row.alert_type === "dependency_unlocked");
      expect(byKey.get(unlock?.idempotency_key ?? "")?.status).toBe("pending");
      expect(after.filter((row) => row.status === "pending")).toHaveLength(4);
      expect(response.body.alerts).toMatchObject({ scheduled: 0, cancelled: 0 });
    });

    it("does not remind twice when a route joins or leaves the group", async () => {
      const merged = {
        ...scenario("A"),
        structure_types: ["tent_canopy"],
        structure_over_10ft_tall: "yes",
        tent_area_sqft: 500,
        tent_days_in_place: 40,
      };
      const eventId = await createEvent(merged);
      await materialize(eventId);

      const before = await alertsOf(eventId);
      const dobReminders = before.filter(
        (row) =>
          row.alert_type === "deadline_reminder" && String(row.payload.body).includes("DOB permit"),
      );
      expect(dobReminders.length).toBeGreaterThan(0);
      const sentAlready = dobReminders[0] as AlertRow;
      await pool.query(
        "UPDATE alerts SET status = 'sent', sent_at = current_timestamp WHERE id = $1",
        [sentAlready.id],
      );

      const patch = await request(appWith(fakeProvider()))
        .patch(`/api/events/${eventId}`)
        .send({ structure_over_10ft_tall: "no" });
      expect(patch.status).toBe(200);
      expect([200, 201]).toContain((await materialize(eventId)).status);

      const after = await alertsOf(eventId);
      const taskIds = new Set(
        after
          .filter((row) => row.alert_type === "deadline_reminder" && row.checklist_item_id !== null)
          .map((row) => row.checklist_item_id),
      );
      expect(taskIds.has(sentAlready.checklist_item_id)).toBe(true);

      const sameWords = after.filter(
        (row) =>
          row.alert_type === "deadline_reminder" &&
          row.recipient === sentAlready.recipient &&
          row.payload.subject === sentAlready.payload.subject &&
          row.payload.body === sentAlready.payload.body,
      );
      expect(sameWords).toHaveLength(1);
      expect(sameWords[0]?.id).toBe(sentAlready.id);
      expect(sameWords[0]?.status).toBe("sent");
    });

    it("does not adopt a terminal task's delivered reminder onto a restored requirement", async () => {
      const eventId = await createEvent(scenario("C"));
      const firstTask = randomUUID();
      const restoredTask = randomUUID();
      const applyBy = dayFromToday(9);
      const generation = async (taskId: string | null): Promise<string> => {
        const planId = randomUUID();
        const itemId = randomUUID();
        await pool.query(
          `INSERT INTO permit_plans (id, event_id, event_revision, ruleset_version, snapshot_date,
                                     verdict, verdict_detail, intake_snapshot, generated_at)
           VALUES ($1, $2, 1, $3, $4, 'conditional', $5::jsonb, '{}'::jsonb, clock_timestamp())`,
          [
            planId,
            eventId,
            ruleset.rulesetVersion,
            ruleset.snapshotDate,
            JSON.stringify({
              today: todayInJurisdiction("US-NY-NYC"),
              minSlackDays: null,
              finding_renderings: [
                {
                  rule_ids: taskId === null ? ["PARKS-EVENT-001"] : ["DOB-TENT-001"],
                  notes: [],
                  note_text: null,
                  conflict_text: null,
                  deadline_display: null,
                  slack_days: null,
                  deadline_unknown_fields: [],
                  timeline_unresolved_reason: null,
                  portal_instructions: null,
                },
              ],
            }),
          ],
        );
        await pool.query(
          `INSERT INTO permit_plan_items (id, plan_id, rule_ids, triggered_by, permit_name, agency,
                                          latest_apply_date, sources, kind, disposition,
                                          deadline_status, verification_status)
           VALUES ($1, $2, $3, '[]'::jsonb, $4, 'DOB', $5, '[]'::jsonb, 'permit',
                   'required', 'deadline_approaching', 'SOURCE_CONFIRMED')`,
          [
            itemId,
            planId,
            taskId === null ? ["PARKS-EVENT-001"] : ["DOB-TENT-001"],
            taskId === null ? "Special Event Permit" : "Tent permit",
            applyBy,
          ],
        );
        await pool.query(
          "INSERT INTO checklist_items (id, plan_item_id, cohort_position) VALUES ($1, $2, 0)",
          [taskId ?? randomUUID(), itemId],
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
        return planId;
      };

      await generation(firstTask);
      const first = (await alertsOf(eventId)).find(
        (row) => row.alert_type === "deadline_reminder",
      ) as AlertRow;
      expect(first).toBeDefined();
      await pool.query(
        "UPDATE alerts SET status = 'sent', sent_at = current_timestamp WHERE id = $1",
        [first.id],
      );

      await generation(null);
      await generation(restoredTask);

      const reminders = (await alertsOf(eventId)).filter(
        (row) => row.alert_type === "deadline_reminder",
      );
      const restored = reminders.filter(
        (row) => row.idempotency_key.includes(restoredTask) && row.status === "pending",
      );
      expect(restored.length).toBeGreaterThan(0);
      expect(first.id).not.toBe(restored[0]?.id);
      const delivered = reminders.find((row) => row.id === first.id) as AlertRow;
      expect(delivered.status).toBe("sent");
      expect(delivered.idempotency_key).toContain(firstTask);
      expect(delivered.idempotency_key).not.toContain(restoredTask);
    });

    it("does not swap reminders between routes when a route joins the group", async () => {
      const eventId = await createEvent(scenario("C"));
      const firstTask = randomUUID();
      const secondTask = randomUUID();
      const tentApplyBy = dayFromToday(9);
      const tallApplyBy = dayFromToday(6);
      const route = (overrides: Record<string, unknown>) => ({
        triggerResult: "true",
        unknownFields: [],
        disposition: "required",
        agency: "DOB",
        deadline: null,
        deadlineDisplay: null,
        latestApplyDate: null,
        applyAfterDate: null,
        deadlineStatus: "deadline_approaching",
        slackDays: null,
        feeDisplay: null,
        portalName: null,
        portalUrl: null,
        portalInstructions: null,
        notes: [],
        ...overrides,
      });
      const insertGeneration = async (
        taskId: string,
        ruleIds: string[],
        routes: Record<string, unknown>[] | null,
      ): Promise<string> => {
        const planId = randomUUID();
        const itemId = randomUUID();
        await pool.query(
          `INSERT INTO permit_plans (id, event_id, event_revision, ruleset_version, snapshot_date,
                                     verdict, verdict_detail, intake_snapshot, generated_at)
           VALUES ($1, $2, 1, $3, $4, 'conditional', $5::jsonb, '{}'::jsonb, current_timestamp)
           ON CONFLICT (id) DO UPDATE SET verdict_detail = EXCLUDED.verdict_detail`,
          [
            planId,
            eventId,
            ruleset.rulesetVersion,
            ruleset.snapshotDate,
            JSON.stringify({
              today: todayInJurisdiction("US-NY-NYC"),
              minSlackDays: null,
              finding_renderings: [
                {
                  rule_ids: ruleIds,
                  notes: [],
                  note_text: null,
                  conflict_text: null,
                  deadline_display: null,
                  slack_days: null,
                  deadline_unknown_fields: [],
                  timeline_unresolved_reason: null,
                  portal_instructions: null,
                  ...(routes === null ? {} : { headline_mode: "applies_together", routes }),
                },
              ],
            }),
          ],
        );
        await pool.query(
          `INSERT INTO permit_plan_items (id, plan_id, rule_ids, triggered_by, permit_name, agency,
                                          latest_apply_date, sources, kind, disposition,
                                          deadline_status, verification_status)
           VALUES ($1, $2, $3, '[]'::jsonb, 'Tent permit', 'DOB', $4, '[]'::jsonb, 'permit',
                   'required', 'deadline_approaching', 'SOURCE_CONFIRMED')`,
          [itemId, planId, ruleIds, tentApplyBy],
        );
        await pool.query(
          "INSERT INTO checklist_items (id, plan_item_id, cohort_position) VALUES ($1, $2, 0)",
          [taskId, itemId],
        );
        return planId;
      };
      const schedule = async (planId: string) => {
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

      await schedule(await insertGeneration(firstTask, ["DOB-TENT-001"], null));
      const before = await alertsOf(eventId);
      const sentAlready = before.find((row) => row.alert_type === "deadline_reminder") as AlertRow;
      expect(sentAlready).toBeDefined();
      await pool.query(
        "UPDATE alerts SET status = 'sent', sent_at = current_timestamp WHERE id = $1",
        [sentAlready.id],
      );

      await schedule(
        await insertGeneration(
          secondTask,
          ["DOB-TENT-001", "DOB-TALL-STRUCTURE-001"],
          [
            route({
              ruleId: "DOB-TALL-STRUCTURE-001",
              name: "Tall structure permit",
              latestApplyDate: tallApplyBy,
            }),
            route({
              ruleId: "DOB-TENT-001",
              name: "Tent permit",
              latestApplyDate: tentApplyBy,
            }),
          ],
        ),
      );

      const after = await alertsOf(eventId);
      const reminders = after.filter((row) => row.alert_type === "deadline_reminder");
      const delivered = reminders.filter(
        (row) =>
          row.payload.subject === sentAlready.payload.subject &&
          row.payload.body === sentAlready.payload.body,
      );
      expect(delivered).toHaveLength(1);
      expect(delivered[0]?.id).toBe(sentAlready.id);
      expect(delivered[0]?.status).toBe("sent");
      expect(
        reminders.some((row) => String(row.payload.body).includes("Tall structure permit")),
      ).toBe(true);
      expect(
        reminders.filter(
          (row) =>
            row.status === "sent" &&
            row.payload.subject === sentAlready.payload.subject &&
            row.payload.body === sentAlready.payload.body,
        ),
      ).toHaveLength(1);
      expect(delivered[0]?.idempotency_key).toContain("DOB-TENT-001");
      expect(delivered[0]?.idempotency_key).not.toContain("DOB-TALL-STRUCTURE-001");
      expect(
        reminders.filter(
          (row) =>
            row.status === "pending" &&
            row.payload.subject === sentAlready.payload.subject &&
            row.payload.body === sentAlready.payload.body,
        ),
      ).toHaveLength(0);
    });

    it("does not remind twice when the filing date moves", async () => {
      const eventId = await createEvent(scenario("C"));
      const contacts = { email: "organizer@example.test", phone: null };
      const first = await insertDuePlan(eventId, { latestApplyDate: dayFromToday(30) });
      const client = await pool.connect();
      try {
        await schedulerWith()(client, eventId, first.planId, contacts);
        const scheduled = await alertsOf(eventId);
        const sentAlready = scheduled.find(
          (row) => row.send_at.toISOString().slice(0, 10) === dayFromToday(23),
        );
        expect(sentAlready).toBeDefined();
        await pool.query(
          "UPDATE alerts SET status = 'sent', sent_at = clock_timestamp() WHERE id = $1",
          [sentAlready?.id],
        );

        const second = await insertDuePlan(eventId, {
          latestApplyDate: dayFromToday(45),
          reuseChecklistItemId: first.checklistItemId,
        });
        await schedulerWith()(client, eventId, second.planId, contacts);

        const after = await alertsOf(eventId);
        const sameOffset = after.filter(
          (row) => row.idempotency_key === sentAlready?.idempotency_key,
        );
        expect(sameOffset).toHaveLength(1);
        expect(sameOffset[0]?.status).toBe("sent");
        expect(after.filter((row) => row.status === "pending")).toHaveLength(1);
      } finally {
        client.release();
      }
    });

    it("does not suppress a new reminder that lands on a sent reminder's day", async () => {
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
      const eventId = await createEvent(scenario("B"));
      const first = await materialize(eventId, { contactEmail: "organizer@example.test" });
      expect(first.body.alerts.scheduled).toBe(0);
      expect(await alertsOf(eventId)).toEqual([]);

      expect(first.body.alertContacts).toEqual({ email: "organizer@example.test", phone: null });
      const planId = (await insertDuePlan(eventId, { latestApplyDate: dayFromToday(30) })).planId;
      const client = await pool.connect();
      try {
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
      const eventId = await createEvent(scenario("C"));
      await materialize(eventId, { contactEmail: "typo@example.test" });
      const before = await alertsOf(eventId);
      expect(before.length).toBeGreaterThan(0);
      await pool.query(
        `UPDATE alerts SET status = 'failed', failure_count = 3,
                           next_attempt_at = clock_timestamp() + interval '15 minutes'
          WHERE event_id = $1`,
        [eventId],
      );

      await materialize(eventId, { contactEmail: "organizer@example.test" });

      const corrected = (await alertsOf(eventId)).filter(
        (row) => row.recipient === "organizer@example.test",
      );
      expect(corrected.length).toBeGreaterThan(0);
      expect(corrected.every((row) => row.failure_count === 0)).toBe(true);
      expect(corrected.every((row) => row.next_attempt_at === null)).toBe(true);
      expect(corrected.every((row) => row.status === "pending")).toBe(true);
    });

    it("treats a domain case change as the same destination", async () => {
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
      expect(after).toHaveLength(before.length);
      expect(after.every((row) => row.status === "sent")).toBe(true);
      expect(after.every((row) => row.recipient === "person@example.test")).toBe(true);
    });

    it("keeps a local-part case change as a different destination", async () => {
      const eventId = await createEvent(scenario("C"));
      await materialize(eventId, { contactEmail: "person@example.test" });
      const before = await alertsOf(eventId);

      await materialize(eventId, { contactEmail: "Person@example.test" });

      const after = await alertsOf(eventId);
      expect(after.some((row) => row.recipient === "Person@example.test")).toBe(true);
      expect(after.length).toBeGreaterThan(before.length);
    });

    it("accepts an address the organizer pasted with surrounding whitespace", async () => {
      const eventId = await createEvent(scenario("C"));

      const response = await materialize(eventId, { contactEmail: " organizer@example.test " });

      expect(response.status).toBeLessThan(300);
      const rows = await alertsOf(eventId);
      expect(rows.length).toBeGreaterThan(0);
      expect(rows.every((row) => row.recipient === "organizer@example.test")).toBe(true);
    });

    it("treats a reformatted phone number as the same destination", async () => {
      const eventId = await createEvent(scenario("C"));
      await materialize(eventId, { contactPhone: "+12125550100" });
      const before = await alertsOf(eventId);
      expect(before.some((row) => row.channel === "sms")).toBe(true);
      await pool.query(
        "UPDATE alerts SET status = 'sent', sent_at = clock_timestamp() WHERE event_id = $1",
        [eventId],
      );

      await materialize(eventId, { contactPhone: "+1 (212) 555-0100" });

      const after = await alertsOf(eventId);
      expect(after).toHaveLength(before.length);
      expect(after.every((row) => row.status === "sent")).toBe(true);
      expect(
        after
          .filter((row) => row.channel === "sms")
          .every((row) => row.recipient === "12125550100"),
      ).toBe(true);
    });

    it("keeps the evidence when a review changes nothing about the destination", async () => {
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

    it("applies a corrected address to alerts that have not gone out", async () => {
      const eventId = await createEvent(scenario("C"));
      await materialize(eventId, { contactEmail: "typo@example.test" });
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
      expect(after.get(before[0]?.id ?? "")?.recipient).toBe("typo@example.test");
      for (const row of before.slice(1)) {
        expect(after.get(row.id)?.recipient).toBe("typo@example.test");
        expect(after.get(row.id)?.status).toBe("cancelled");
      }
      const queued = rows.filter((row) => row.status === "pending");
      expect(queued.every((row) => row.recipient === "organizer@example.test")).toBe(true);
      expect(queued.length).toBe(before.length);
    });

    it("never rewrites where an attempt was already made", async () => {
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
      expect(preserved?.recipient).toBe("typo@example.test");
      expect(preserved?.failure_count).toBe(1);
      expect(preserved?.payload.last_error).toBe("provider timed out");
      expect(preserved?.status).toBe("cancelled");
    });

    it("gives the provider a new identity when the address is corrected", async () => {
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

      await pool.query(
        `UPDATE alerts SET status = 'failed', sent_at = NULL, failure_count = 1,
                           next_attempt_at = NULL
          WHERE event_id = $1`,
        [eventId],
      );

      await scheduleTo("organizer@example.test");
      await poller.tick();

      expect(provider.delivered.some((sent) => sent.recipient === "organizer@example.test")).toBe(
        true,
      );
    });

    it("keeps one identity across retries to an unchanged address", async () => {
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
      const eventId = await createEvent(scenario("C"));
      await materialize(eventId, { contactEmail: "dead@example.test" });
      await pool.query(
        `UPDATE alerts SET status = 'failed', failure_count = 2,
                           next_attempt_at = clock_timestamp() + interval '15 minutes'
          WHERE event_id = $1`,
        [eventId],
      );
      const warned = await failedDeliveries(pool, eventId, ruleset.jurisdiction);
      expect(warned).toHaveLength(1);

      await materialize(eventId, { contactEmail: "dead@example.test" });

      expect(await failedDeliveries(pool, eventId, ruleset.jurisdiction)).toEqual(warned);
    });

    it("stops warning once the address itself is corrected", async () => {
      const eventId = await createEvent(scenario("C"));
      await materialize(eventId, { contactEmail: "typo@example.test" });
      await pool.query(
        `UPDATE alerts SET status = 'failed', failure_count = 2 WHERE event_id = $1`,
        [eventId],
      );
      expect(await failedDeliveries(pool, eventId, ruleset.jurisdiction)).toHaveLength(1);

      await materialize(eventId, { contactEmail: "organizer@example.test" });

      expect(await failedDeliveries(pool, eventId, ruleset.jurisdiction)).toEqual([]);
    });

    it("does not unlock a window whose filing deadline has already passed", async () => {
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
      expect(rows.some((row) => row.alert_type === "deadline_reminder")).toBe(false);
    });

    it("still unlocks while the filing deadline is ahead", async () => {
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
        expect(unlocks[0]?.status).toBe("sent");
      } finally {
        client.release();
      }
    });

    it("moves an unsent unlock to the recomputed date rather than leaving it on the old one", async () => {
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
      expect(after?.id).toBe(unlock?.id);
      expect(after?.status).toBe("pending");
      expect(after?.send_at.toISOString().slice(0, 10)).toBe(dayFromToday(9));
      expect(provider.attempts.map((message) => message.subject)).not.toContain(
        after?.payload.subject,
      );
    });

    it("does not deliver an obsolete alert while a checklist review is cancelling it", async () => {
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

        await review.query("BEGIN");
        await review.query("SELECT id FROM events WHERE id = $1 FOR UPDATE", [eventId]);

        await createAlertPoller({
          database: pool,
          senders: provider.senders,
          jurisdiction: ruleset.jurisdiction,
        }).tick();

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
      await createAlertPoller({
        database: pool,
        senders: provider.senders,
        jurisdiction: ruleset.jurisdiction,
      }).tick();
      expect(provider.attempts).toHaveLength(0);
    });

    it("brings a cancelled alert back when the requirement returns", async () => {
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

        const ungated = await insertDuePlan(eventId, {
          latestApplyDate: dayFromToday(30),
          reuseChecklistItemId: gated.checklistItemId,
        });
        await schedulerWith()(client, eventId, ungated.planId, contacts);
        expect((await alertsOf(eventId)).find((row) => row.id === unlock?.id)?.status).toBe(
          "cancelled",
        );

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
      expect(response.body.alert.recipient).toBeUndefined();
    });

    it("answers on a pool with no second connection for the attempt-intent write", async () => {
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
      const eventId = await createEvent(scenario("C"));
      const provider = fakeProvider();
      const racing = Object.create(pool) as Pool;
      racing.connect = pool.connect.bind(pool) as Pool["connect"];
      racing.query = (async (text: string, values?: unknown[]) => {
        const result = await pool.query(text as never, values as never);
        if (typeof text === "string" && text.includes("INSERT INTO alerts")) {
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
      expect(provider.delivered).toHaveLength(1);
    });

    it("waits out a poller that is still mid-send rather than calling it a failure", async () => {
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

      expect(recovered.delivered).toHaveLength(1);
      const test = (await alertsOf(eventId)).find((row) => row.payload.test === true);
      expect(test?.status).toBe("sent");
      expect(response.status).toBe(201);
      expect(response.body.alert.status).toBe("sent");
    });

    it("does not let the poller deliver a test the endpoint already called failed", async () => {
      const eventId = await createEvent(scenario("C"));
      const failing = fakeProvider();
      failing.fail = "provider down";
      const response = await request(appWith(failing))
        .post(`/api/events/${eventId}/alerts/test`)
        .send({ channel: "email", recipient: "organizer@example.test" });
      expect(response.status).toBe(502);
      expect(response.body.alert.status).toBe("failed");

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

      const before = (await alertsOf(eventId)).find((row) => row.payload.test === true);
      expect(before?.status).toBe("cancelled");

      await materialize(eventId);

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

      const failures = await failedDeliveries(pool, eventId, ruleset.jurisdiction);
      expect(failures).toEqual([
        { channel: "email", failedCount: 2, heldForReview: false, attemptedWithoutOutcome: false },
      ]);
      expect(JSON.stringify(failures)).not.toContain("550");
    });

    it("reports nothing when alerts exist but none has been attempted", async () => {
      const eventId = await createEvent(scenario("C"));
      await materialize(eventId);
      expect((await alertsOf(eventId)).every((row) => row.status === "pending")).toBe(true);

      expect(await failedDeliveries(pool, eventId, ruleset.jurisdiction)).toEqual([]);
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
      expect(await failedDeliveries(pool, eventId, ruleset.jurisdiction)).toEqual([
        { channel: "email", failedCount: 1, heldForReview: false, attemptedWithoutOutcome: false },
      ]);

      provider.fail = null;
      await poller.tick();

      expect(await failedDeliveries(pool, eventId, ruleset.jurisdiction)).toEqual([]);
    });

    it("does not count a demo test send as a text message for the event", async () => {
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
      expect(response.body.alert.status).toBe("sent");

      expect(await simulatedDeliveries(pool, eventId)).toEqual([]);
    });

    it("does not count a demo test send against the organizer's own alerts", async () => {
      const eventId = await createEvent(scenario("C"));
      const provider = fakeProvider();
      provider.fail = "email provider rejected the send with status 422";
      const response = await request(appWith(provider))
        .post(`/api/events/${eventId}/alerts/test`)
        .send({ channel: "email", recipient: "tester@example.test" });
      expect(response.status).toBe(502);

      expect(await failedDeliveries(pool, eventId, ruleset.jurisdiction)).toEqual([]);
    });
  });

  describe("an alert the poller has permanently stopped on is reported as stopped", () => {
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
      const eventId = await createEvent(scenario("C"));
      await insertHeldAlert(eventId, "pending");

      expect(await failedDeliveries(pool, eventId, ruleset.jurisdiction)).toEqual([]);
      expect(await reconciliationHolds(pool, eventId, ruleset.jurisdiction)).toEqual([
        { channel: "email", heldCount: 1 },
      ]);
    });

    it("stops counting a stopped alert among the failures it says are being retried", async () => {
      const eventId = await createEvent(scenario("C"));
      await insertHeldAlert(eventId, "failed");

      expect(await failedDeliveries(pool, eventId, ruleset.jurisdiction)).toEqual([]);
      expect(await reconciliationHolds(pool, eventId, ruleset.jurisdiction)).toEqual([
        { channel: "email", heldCount: 1 },
      ]);
    });

    it("leaves a failure the poller is still retrying exactly where it was", async () => {
      const eventId = await createEvent(scenario("C"));
      await schedulePastDue(eventId, [reminderOffsets[0] ?? 7]);
      const provider = fakeProvider();
      provider.fail = "email provider unreachable: ECONNREFUSED";
      await createAlertPoller({
        database: pool,
        senders: provider.senders,
        jurisdiction: ruleset.jurisdiction,
      }).tick();

      expect(await failedDeliveries(pool, eventId, ruleset.jurisdiction)).toEqual([
        { channel: "email", failedCount: 1, heldForReview: false, attemptedWithoutOutcome: false },
      ]);
      expect(await reconciliationHolds(pool, eventId, ruleset.jurisdiction)).toEqual([]);
    });

    it("says nothing about an alert the organizer's own edit has already retired", async () => {
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

      expect(await reconciliationHolds(pool, eventId, ruleset.jurisdiction)).toEqual([]);
    });

    it("says nothing about an attempted alert the poller is only waiting for the date on", async () => {
      const eventId = await createEvent(scenario("C"));
      const alertId = randomUUID();
      await pool.query(
        `INSERT INTO alerts (id, event_id, alert_type, channel, recipient, idempotency_key,
                             send_at, status, failure_count, payload)
         VALUES ($1, $2, 'deadline_reminder', 'email', 'organizer@example.test', $3,
                 current_timestamp + interval '3 days', 'pending', 0,
                 '{"subject":"file it","body":"file it"}'::jsonb)`,
        [alertId, eventId, alertId],
      );
      await pool.query(
        `INSERT INTO alert_send_attempts (alert_id, idempotency_key, attempted_at)
         VALUES ($1, $2, current_timestamp - ($3 || ' hours')::interval)`,
        [alertId, alertId, PROVIDER_DEDUP_WINDOW_HOURS + 1],
      );
      const provider = fakeProvider();

      const summary = await createAlertPoller({
        database: pool,
        senders: provider.senders,
        jurisdiction: ruleset.jurisdiction,
      }).tick();

      expect(summary.heldForReconciliation).toBe(0);
      expect(await reconciliationHolds(pool, eventId, ruleset.jurisdiction)).toEqual([]);
    });

    it("does not promise a review will restart a stale alert whose outcome was never observed", async () => {
      const eventId = await createEvent(scenario("C"));
      await schedulePastDue(eventId, [reminderOffsets[0] ?? 7]);
      const alertId = (await alertsOf(eventId))[0]?.id ?? "";
      await pool.query("UPDATE alerts SET status = 'failed', failure_count = 1 WHERE id = $1", [
        alertId,
      ]);
      await moveFilingDateOut(alertId, 6);
      await pool.query(
        `INSERT INTO alert_send_attempts (alert_id, idempotency_key, attempted_at)
         VALUES ($1, $2, current_timestamp - ($3 || ' hours')::interval)`,
        [alertId, alertId, PROVIDER_DEDUP_WINDOW_HOURS + 1],
      );
      await pool.query("UPDATE events SET revision_counter = revision_counter + 1 WHERE id = $1", [
        eventId,
      ]);

      expect(await failedDeliveries(pool, eventId, ruleset.jurisdiction)).toEqual([
        {
          channel: "email",
          failedCount: 1,
          heldForReview: true,
          attemptedWithoutOutcome: true,
        },
      ]);
    });

    it("still promises the review for a stale failure that was never attempted blind", async () => {
      const eventId = await createEvent(scenario("C"));
      await schedulePastDue(eventId, [reminderOffsets[0] ?? 7]);
      const alertId = (await alertsOf(eventId))[0]?.id ?? "";
      await pool.query("UPDATE alerts SET status = 'failed', failure_count = 1 WHERE id = $1", [
        alertId,
      ]);
      await pool.query("UPDATE events SET revision_counter = revision_counter + 1 WHERE id = $1", [
        eventId,
      ]);

      expect(await failedDeliveries(pool, eventId, ruleset.jurisdiction)).toEqual([
        {
          channel: "email",
          failedCount: 1,
          heldForReview: true,
          attemptedWithoutOutcome: false,
        },
      ]);
    });

    it("never puts one alert under both notices at once", async () => {
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

      const health = await alertDeliveryHealth(crossing, eventId, ruleset.jurisdiction);

      expect(crossed).toBe(true);
      expect(health.failedDeliveries.length === 0 || health.reconciliationHolds.length === 0).toBe(
        true,
      );
    });

    it("reaches the checklist an organizer actually reads", async () => {
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
      await moveFilingDateOut(alertId, 2);
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

    it("keeps the classification on the statement's clock when the process clock runs ahead", async () => {
      const eventId = await createEvent(scenario("C"));
      await schedulePastDue(eventId, [reminderOffsets[0] ?? 7]);
      const alertId = (await alertsOf(eventId))[0]?.id ?? "";
      await moveFilingDateOut(alertId, 1);
      await pool.query(
        `INSERT INTO alert_send_attempts (alert_id, idempotency_key, attempted_at)
         VALUES ($1, $2, current_timestamp - ($3 || ' hours')::interval)`,
        [alertId, alertId, PROVIDER_DEDUP_WINDOW_HOURS + 1],
      );

      let crossed = false;
      const crossing = Object.create(pool) as Pool;
      crossing.query = (async (text: string, values?: unknown[]) => {
        const result = await pool.query(text as never, values as never);
        if (!crossed && typeof text === "string" && text.includes("FROM checklist_items")) {
          crossed = true;
          vi.setSystemTime(Date.now() + 24 * 60 * 60 * 1000);
        }
        return result;
      }) as Pool["query"];

      vi.useFakeTimers({ toFake: ["Date"] });
      let response;
      try {
        response = await request(
          createApp({
            database: crossing,
            intakeContract,
            today: () => todayInJurisdiction(ruleset.jurisdiction),
            planService: createPlanService(pool, ruleset, fixtureCalendar, () => FIXTURE_TODAY),
            checklist: {
              database: crossing,
              storage,
              scheduleAlerts: schedulerWith(() => new Date(`${FIXTURE_TODAY}T13:00:00Z`)),
              jurisdiction: ruleset.jurisdiction,
            },
            alerts: {
              jurisdiction: ruleset.jurisdiction,
              database: pool,
              senders: fakeProvider().senders,
            },
          }),
        ).get(`/api/events/${eventId}/checklist`);
      } finally {
        vi.useRealTimers();
      }

      expect(crossed).toBe(true);
      expect(response.status).toBe(200);
      expect(response.body.alertsHeldForReconciliation).toEqual([
        { channel: "email", heldCount: 1 },
      ]);
    });

    it("derives the health statement's day at the statement rather than in front of it", async () => {
      const eventId = await createEvent(scenario("C"));
      await schedulePastDue(eventId, [reminderOffsets[0] ?? 7]);
      const alertId = (await alertsOf(eventId))[0]?.id ?? "";
      await pool.query(
        `INSERT INTO alert_send_attempts (alert_id, idempotency_key, attempted_at)
         VALUES ($1, $2, current_timestamp - ($3 || ' hours')::interval)`,
        [alertId, alertId, PROVIDER_DEDUP_WINDOW_HOURS + 1],
      );

      const issuedOnTheDayBefore = Date.now();
      let crossed = false;
      const crossing = Object.create(pool) as Pool;
      crossing.query = (async (text: string, values?: unknown[]) => {
        if (!crossed && typeof text === "string" && text.includes("AS hold_count")) {
          crossed = true;
          vi.setSystemTime(issuedOnTheDayBefore);
        }
        return pool.query(text as never, values as never);
      }) as Pool["query"];

      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(issuedOnTheDayBefore - 24 * 60 * 60 * 1000);
      let response;
      try {
        response = await request(
          createApp({
            database: crossing,
            intakeContract,
            today: () => todayInJurisdiction(ruleset.jurisdiction),
            planService: createPlanService(pool, ruleset, fixtureCalendar, () => FIXTURE_TODAY),
            checklist: {
              database: crossing,
              storage,
              scheduleAlerts: schedulerWith(() => new Date(`${FIXTURE_TODAY}T13:00:00Z`)),
              jurisdiction: ruleset.jurisdiction,
            },
            alerts: {
              jurisdiction: ruleset.jurisdiction,
              database: pool,
              senders: fakeProvider().senders,
            },
          }),
        ).get(`/api/events/${eventId}/checklist`);
      } finally {
        vi.useRealTimers();
      }

      expect(crossed).toBe(true);
      expect(response.status).toBe(200);
      expect(response.body.alertsHeldForReconciliation).toEqual([]);
    });

    it("classifies the health of a slow review against the statement clock, not the transaction's", async () => {
      const eventId = await createEvent(scenario("C"));
      await schedulePastDue(eventId, [reminderOffsets[0] ?? 7]);
      const alertId = (await alertsOf(eventId))[0]?.id ?? "";
      await moveFilingDateOut(alertId, 3);
      await pool.query(
        `INSERT INTO alert_send_attempts (alert_id, idempotency_key, attempted_at)
         VALUES ($1, $2, current_timestamp - interval '1 hour')`,
        [alertId, alertId],
      );
      const shown = (await request(appWith(fakeProvider())).get(`/api/events/${eventId}/checklist`))
        .body.planId as string;

      const reviewing = new Pool({ connectionString: databaseUrl });
      const connect = reviewing.connect.bind(reviewing);
      let heldBack = false;
      reviewing.connect = (async () => {
        const client = await connect();
        const query = client.query.bind(client);
        client.query = (async (...args: unknown[]) => {
          const text = args[0];
          const result = await query(...(args as Parameters<typeof query>));
          if (text === "BEGIN") {
            await pool.query(
              `UPDATE alert_send_attempts
                  SET attempted_at = clock_timestamp() - interval '${PROVIDER_DEDUP_WINDOW_HOURS} hours'
                                     + interval '${DEDUP_WINDOW_CLAIM_MARGIN_MS} milliseconds'
                                     + interval '1 second'
                WHERE alert_id = $1`,
              [alertId],
            );
          }
          if (typeof text === "string" && text.includes("AS hold_count") && !heldBack) {
            heldBack = true;
            await new Promise((resolve) => setTimeout(resolve, 2_000));
            return query(...(args as Parameters<typeof query>));
          }
          return result;
        }) as typeof client.query;
        return client;
      }) as Pool["connect"];

      let response;
      try {
        response = await request(
          createApp({
            database: pool,
            intakeContract,
            today: () => todayInJurisdiction(ruleset.jurisdiction),
            planService: createPlanService(pool, ruleset, fixtureCalendar, () => FIXTURE_TODAY),
            checklist: {
              database: reviewing,
              storage,
              scheduleAlerts: schedulerWith(),
              jurisdiction: ruleset.jurisdiction,
            },
            alerts: {
              jurisdiction: ruleset.jurisdiction,
              database: pool,
              senders: fakeProvider().senders,
            },
          }),
        )
          .post(`/api/events/${eventId}/checklist`)
          .send({ planId: shown, contactEmail: "organizer@example.test" });
      } finally {
        await reviewing.end();
      }

      expect(heldBack).toBe(true);
      expect(response.status).toBe(200);
      expect(response.body.alertsHeldForReconciliation).toEqual([
        { channel: "email", heldCount: 1 },
      ]);
      expect(response.body.failedAlertDeliveries).toEqual([]);
    }, 30_000);
  });

  describe("AC 5 — a simulated send is visible as one", () => {
    it("reports the SMS simulation label on the checklist an organizer reads", async () => {
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
      const eventId = await createEvent(scenario("C"));
      await schedulePastDue(eventId, [7]);

      const alert = (await alertsOf(eventId))[0];
      expect(alert?.payload.body).toContain(
        "This is PopEngine's 7 days-before reminder, sent now because your checklist was created " +
          "after that day had already passed.",
      );
      expect(alert?.payload.body).not.toContain("PopEngine sends this reminder 7 days before");
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

      const reviewer = await pool.connect();
      let summary;
      const tickStartedAt = Date.now();
      try {
        await reviewer.query("BEGIN");
        await reviewer.query("SELECT id FROM events WHERE id = $1 FOR UPDATE", [eventId]);
        const ticking = poller.tick();
        await new Promise((resolve) => setTimeout(resolve, 300));
        await reviewer.query("COMMIT");
        summary = await ticking;
      } finally {
        reviewer.release();
      }

      expect(summary.sent).toBe(1);
      const [delivered] = await alertsOf(eventId);
      expect(delivered?.status).toBe("sent");
      const tookMs = (delivered?.sent_at?.getTime() ?? 0) - tickStartedAt;
      expect(tookMs).toBeLessThan(DELIVERY_BOUND_MS);
      expect(tookMs).toBeLessThan(POLL_INTERVAL_MS);
    });

    it("does not deliver an alert whose plan the event has been edited past", async () => {
      const eventId = await createEvent(scenario("C"));
      await schedulePastDue(eventId, [reminderOffsets[0] ?? 7]);
      const provider = fakeProvider();
      const poller = createAlertPoller({
        database: pool,
        senders: provider.senders,
        jurisdiction: ruleset.jurisdiction,
      });

      await pool.query("UPDATE events SET revision_counter = revision_counter + 1 WHERE id = $1", [
        eventId,
      ]);

      const summary = await poller.tick();

      expect(summary.sent).toBe(0);
      expect(provider.attempts).toHaveLength(0);
      expect((await alertsOf(eventId)).every((row) => row.status === "pending")).toBe(true);
    });

    it("delivers again once the review has caught the plan up", async () => {
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

      await pool.query(
        `UPDATE permit_plans SET event_revision = (SELECT revision_counter FROM events WHERE id = $1)
          WHERE event_id = $1`,
        [eventId],
      );

      expect((await poller.tick()).sent).toBe(1);
      expect(provider.delivered).toHaveLength(1);
    });

    it("does not deliver a plan-level slack warning once the event has moved on", async () => {
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
      const warning = (await alertsOf(eventId)).find((row) => row.alert_type === "slack_warning");
      expect(warning).toBeDefined();
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
      expect(after?.status).toBe("failed");
    });

    it("delivers the slack warning again once its plan names the current revision", async () => {
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
        await poller.stop();
        reviewer.release();
      }

      const [delivered] = await alertsOf(eventId);
      const tookMs = (delivered?.sent_at?.getTime() ?? 0) - startedAt;
      expect(tookMs).toBeLessThan(DELIVERY_BOUND_MS);
      expect(tookMs).toBeLessThan(POLL_INTERVAL_MS);
    }, 30_000);

    it("does not warn about slack once every filing date has passed", async () => {
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
      expect(rows.some((row) => row.alert_type === "deadline_reminder")).toBe(false);
    });

    it("does not warn when the requirement the number describes has expired", async () => {
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
      expect(rows.some((row) => row.alert_type === "deadline_reminder")).toBe(true);
    });

    it("warns when the requirement the number describes is the one still open", async () => {
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

    it("schedules no filing reminder for a route of a candidate group", async () => {
      const eventId = await createEvent(scenario("C"));
      const planId = randomUUID();
      const itemId = randomUUID();
      const applyBy = dayFromToday(9);
      const route = (overrides: Record<string, unknown>) => ({
        triggerResult: "true",
        unknownFields: [] as string[],
        agency: "NYPD",
        deadline: null,
        deadlineDisplay: null,
        latestApplyDate: null,
        applyAfterDate: null,
        deadlineStatus: "not_applicable",
        slackDays: null,
        feeDisplay: null,
        portalName: null,
        portalUrl: null,
        portalInstructions: null,
        ...overrides,
      });
      const detailFor = (headlineMode: string) =>
        JSON.stringify({
          today: todayInJurisdiction("US-NY-NYC"),
          minSlackDays: null,
          finding_renderings: [
            {
              rule_ids: ["NYPD-SOUND-001", "PARKS-EVENT-001"],
              notes: [],
              note_text: null,
              conflict_text: null,
              deadline_display: null,
              slack_days: null,
              deadline_unknown_fields: [],
              timeline_unresolved_reason: null,
              portal_instructions: null,
              headline_mode: headlineMode,
              routes: [
                route({
                  ruleId: "NYPD-SOUND-001",
                  disposition: "required",
                  name: "Sound Device Permit",
                  latestApplyDate: applyBy,
                  deadlineStatus: "on_track",
                }),
                route({
                  ruleId: "PARKS-EVENT-001",
                  disposition: "may_be_required",
                  name: "Special Event Permit",
                  ...(headlineMode === "candidate"
                    ? { triggerResult: "unknown", unknownFields: ["sapo_event_type"] }
                    : {}),
                }),
              ],
            },
          ],
        });
      await pool.query(
        `INSERT INTO permit_plans (id, event_id, event_revision, ruleset_version, snapshot_date,
                                   verdict, verdict_detail, intake_snapshot, generated_at)
         VALUES ($1, $2, 1, $3, $4, 'conditional', $5::jsonb, '{}'::jsonb, current_timestamp)`,
        [planId, eventId, ruleset.rulesetVersion, ruleset.snapshotDate, detailFor("candidate")],
      );
      await pool.query(
        `INSERT INTO permit_plan_items (id, plan_id, rule_ids, triggered_by, permit_name, agency,
                                        sources, kind, disposition, deadline_status,
                                        verification_status)
         VALUES ($1, $2, ARRAY['NYPD-SOUND-001','PARKS-EVENT-001'], '[]'::jsonb,
                 'Sound Device Permit', 'NYPD', '[]'::jsonb, 'permit', 'required',
                 'not_applicable', 'SOURCE_CONFIRMED')`,
        [itemId, planId],
      );
      await pool.query(
        "INSERT INTO checklist_items (id, plan_item_id, cohort_position) VALUES ($1, $2, 0)",
        [randomUUID(), itemId],
      );
      const insert = async (headlineMode: string) => {
        await pool.query("DELETE FROM alerts WHERE event_id = $1", [eventId]);
        await pool.query("UPDATE permit_plans SET verdict_detail = $2::jsonb WHERE id = $1", [
          planId,
          detailFor(headlineMode),
        ]);
        const client = await pool.connect();
        try {
          await schedulerWith()(client, eventId, planId, {
            email: "organizer@example.test",
            phone: null,
          });
        } finally {
          client.release();
        }
        return (await alertsOf(eventId)).filter((row) => row.alert_type === "deadline_reminder");
      };

      expect(await insert("candidate")).toHaveLength(0);
      expect((await insert("applies_together")).length).toBeGreaterThan(0);
    });

    it("warns off a route's slack when the merged line it sits on carries none", async () => {
      const eventId = await createEvent(scenario("C"));
      const planId = randomUUID();
      const itemId = randomUUID();
      const applyBy = dayFromToday(9);
      const route = (overrides: Record<string, unknown>) => ({
        triggerResult: "true",
        unknownFields: [],
        agency: "NYPD",
        deadline: null,
        deadlineDisplay: null,
        latestApplyDate: null,
        applyAfterDate: null,
        deadlineStatus: "not_applicable",
        slackDays: null,
        feeDisplay: null,
        portalName: null,
        portalUrl: null,
        portalInstructions: null,
        ...overrides,
      });
      await pool.query(
        `INSERT INTO permit_plans (id, event_id, event_revision, ruleset_version, snapshot_date,
                                   verdict, verdict_detail, intake_snapshot, generated_at)
         VALUES ($1, $2, 1, $3, $4, 'feasible_at_risk', $5::jsonb, '{}'::jsonb, current_timestamp)`,
        [
          planId,
          eventId,
          ruleset.rulesetVersion,
          ruleset.snapshotDate,
          JSON.stringify({
            today: todayInJurisdiction("US-NY-NYC"),
            minSlackDays: 9,
            finding_renderings: [
              {
                rule_ids: ["NYPD-SOUND-001", "PARKS-EVENT-001"],
                notes: [],
                note_text: null,
                conflict_text: null,
                deadline_display: null,
                slack_days: null,
                deadline_unknown_fields: [],
                timeline_unresolved_reason: null,
                portal_instructions: null,
                headline_mode: "applies_together",
                routes: [
                  route({
                    ruleId: "NYPD-SOUND-001",
                    disposition: "required",
                    name: "Sound Device Permit",
                  }),
                  route({
                    ruleId: "PARKS-EVENT-001",
                    disposition: "may_be_required",
                    name: "Special Event Permit",
                    latestApplyDate: applyBy,
                    deadlineStatus: "deadline_approaching",
                    slackDays: 9,
                  }),
                ],
              },
            ],
          }),
        ],
      );
      await pool.query(
        `INSERT INTO permit_plan_items (id, plan_id, rule_ids, triggered_by, permit_name, agency,
                                        sources, kind, disposition, deadline_status,
                                        verification_status)
         VALUES ($1, $2, ARRAY['NYPD-SOUND-001','PARKS-EVENT-001'], '[]'::jsonb,
                 'Sound Device Permit', 'NYPD', '[]'::jsonb, 'permit', 'required',
                 'not_applicable', 'SOURCE_CONFIRMED')`,
        [itemId, planId],
      );
      await pool.query(
        "INSERT INTO checklist_items (id, plan_item_id, cohort_position) VALUES ($1, $2, 0)",
        [randomUUID(), itemId],
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

      const rows = await alertsOf(eventId);
      const warning = rows.find((row) => row.alert_type === "slack_warning");
      expect(warning).toBeDefined();
      expect(warning?.payload.subject).toContain("9 days");
      expect(warning?.payload.controlling_apply_by).toBe(applyBy);
      expect(rows.filter((row) => row.alert_type === "deadline_reminder").length).toBeGreaterThan(
        0,
      );
    });

    it("warns off a dated advisory route that holds the minimum slack (#252)", async () => {
      const eventId = await createEvent(scenario("C"));
      const planId = randomUUID();
      const itemId = randomUUID();
      const applyBy = dayFromToday(9);
      const route = (overrides: Record<string, unknown>) => ({
        triggerResult: "true",
        unknownFields: [],
        agency: "NYPD",
        deadline: null,
        deadlineDisplay: null,
        latestApplyDate: null,
        applyAfterDate: null,
        deadlineStatus: "not_applicable",
        slackDays: null,
        feeDisplay: null,
        portalName: null,
        portalUrl: null,
        portalInstructions: null,
        notes: [],
        ...overrides,
      });
      await pool.query(
        `INSERT INTO permit_plans (id, event_id, event_revision, ruleset_version, snapshot_date,
                                   verdict, verdict_detail, intake_snapshot, generated_at)
         VALUES ($1, $2, 1, $3, $4, 'feasible_at_risk', $5::jsonb, '{}'::jsonb, current_timestamp)`,
        [
          planId,
          eventId,
          ruleset.rulesetVersion,
          ruleset.snapshotDate,
          JSON.stringify({
            today: todayInJurisdiction("US-NY-NYC"),
            minSlackDays: 9,
            finding_renderings: [
              {
                rule_ids: ["NYPD-SOUND-001", "PARKS-EVENT-001"],
                notes: [],
                note_text: null,
                conflict_text: null,
                deadline_display: null,
                slack_days: null,
                deadline_unknown_fields: [],
                timeline_unresolved_reason: null,
                portal_instructions: null,
                headline_mode: "applies_together",
                routes: [
                  route({
                    ruleId: "NYPD-SOUND-001",
                    disposition: "required",
                    name: "Sound Device Permit",
                  }),
                  route({
                    ruleId: "PARKS-EVENT-001",
                    disposition: "advisory",
                    name: "Amplified sound advisory",
                    latestApplyDate: applyBy,
                    deadlineStatus: "deadline_approaching",
                    slackDays: 9,
                  }),
                ],
              },
            ],
          }),
        ],
      );
      await pool.query(
        `INSERT INTO permit_plan_items (id, plan_id, rule_ids, triggered_by, permit_name, agency,
                                        sources, kind, disposition, deadline_status,
                                        verification_status)
         VALUES ($1, $2, ARRAY['NYPD-SOUND-001','PARKS-EVENT-001'], '[]'::jsonb,
                 'Sound Device Permit', 'NYPD', '[]'::jsonb, 'permit', 'required',
                 'not_applicable', 'SOURCE_CONFIRMED')`,
        [itemId, planId],
      );
      await pool.query(
        "INSERT INTO checklist_items (id, plan_item_id, cohort_position) VALUES ($1, $2, 0)",
        [randomUUID(), itemId],
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

      const rows = await alertsOf(eventId);
      const warning = rows.find((row) => row.alert_type === "slack_warning");
      expect(warning).toBeDefined();
      expect(warning?.payload.subject).toContain("9 days");
      expect(warning?.payload.controlling_apply_by).toBe(applyBy);
      const reminders = rows.filter((row) => row.alert_type === "deadline_reminder");
      for (const row of reminders) {
        expect(row.payload.body).not.toContain("Amplified sound advisory");
      }
    });

    it("gives each route's reminder that route's own disposition, not the line's (#252)", async () => {
      const eventId = await createEvent(scenario("C"));
      const planId = randomUUID();
      const itemId = randomUUID();
      const applyBy = dayFromToday(9);
      const hedgedApplyBy = dayFromToday(12);
      const route = (overrides: Record<string, unknown>) => ({
        triggerResult: "true",
        unknownFields: [],
        agency: "NYPD",
        deadline: null,
        deadlineDisplay: null,
        latestApplyDate: null,
        applyAfterDate: null,
        deadlineStatus: "not_applicable",
        slackDays: null,
        feeDisplay: null,
        portalName: null,
        portalUrl: null,
        portalInstructions: null,
        ...overrides,
      });
      await pool.query(
        `INSERT INTO permit_plans (id, event_id, event_revision, ruleset_version, snapshot_date,
                                   verdict, verdict_detail, intake_snapshot, generated_at)
         VALUES ($1, $2, 1, $3, $4, 'conditional', $5::jsonb, '{}'::jsonb, current_timestamp)`,
        [
          planId,
          eventId,
          ruleset.rulesetVersion,
          ruleset.snapshotDate,
          JSON.stringify({
            today: todayInJurisdiction("US-NY-NYC"),
            minSlackDays: null,
            finding_renderings: [
              {
                rule_ids: ["NYPD-SOUND-001", "PARKS-EVENT-001"],
                notes: [],
                note_text: null,
                conflict_text: null,
                deadline_display: null,
                slack_days: null,
                deadline_unknown_fields: [],
                timeline_unresolved_reason: null,
                portal_instructions: null,
                headline_mode: "applies_together",
                routes: [
                  route({
                    ruleId: "NYPD-SOUND-001",
                    disposition: "required",
                    name: "Sound Device Permit",
                    latestApplyDate: applyBy,
                    deadlineStatus: "deadline_approaching",
                  }),
                  route({
                    ruleId: "PARKS-EVENT-001",
                    disposition: "may_be_required",
                    name: "Special Event Permit",
                    latestApplyDate: hedgedApplyBy,
                    deadlineStatus: "deadline_approaching",
                  }),
                ],
              },
            ],
          }),
        ],
      );
      await pool.query(
        `INSERT INTO permit_plan_items (id, plan_id, rule_ids, triggered_by, permit_name, agency,
                                        latest_apply_date, sources, kind, disposition,
                                        deadline_status, verification_status)
         VALUES ($1, $2, ARRAY['NYPD-SOUND-001','PARKS-EVENT-001'], '[]'::jsonb,
                 'Sound Device Permit', 'NYPD', $3, '[]'::jsonb, 'permit', 'required',
                 'deadline_approaching', 'SOURCE_CONFIRMED')`,
        [itemId, planId, applyBy],
      );
      await pool.query(
        "INSERT INTO checklist_items (id, plan_item_id, cohort_position) VALUES ($1, $2, 0)",
        [randomUUID(), itemId],
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

      const reminders = (await alertsOf(eventId)).filter(
        (row) => row.alert_type === "deadline_reminder",
      );
      const hedged = reminders.filter((row) =>
        String(row.payload.body).includes("Special Event Permit"),
      );
      const settled = reminders.filter((row) =>
        String(row.payload.body).includes("Sound Device Permit"),
      );
      expect(hedged.length).toBeGreaterThan(0);
      expect(settled.length).toBeGreaterThan(0);
      for (const row of hedged) {
        expect(row.payload.body).toContain(
          `Special Event Permit (NYPD) may be required for your event. If it applies, file by ${hedgedApplyBy}.`,
        );
      }
      for (const row of settled) {
        expect(row.payload.body).toContain(`Sound Device Permit (NYPD): file by ${applyBy}.`);
        expect(row.payload.body).not.toContain("may be required");
      }
    });

    it("quotes only the route's own published notes in its reminder (#252)", async () => {
      const eventId = await createEvent(scenario("C"));
      const planId = randomUUID();
      const itemId = randomUUID();
      const applyBy = dayFromToday(9);
      const otherApplyBy = dayFromToday(12);
      const route = (overrides: Record<string, unknown>) => ({
        triggerResult: "true",
        unknownFields: [],
        agency: "NYPD",
        deadline: null,
        deadlineDisplay: null,
        latestApplyDate: null,
        applyAfterDate: null,
        deadlineStatus: "not_applicable",
        slackDays: null,
        feeDisplay: null,
        portalName: null,
        portalUrl: null,
        portalInstructions: null,
        notes: [],
        ...overrides,
      });
      await pool.query(
        `INSERT INTO permit_plans (id, event_id, event_revision, ruleset_version, snapshot_date,
                                   verdict, verdict_detail, intake_snapshot, generated_at)
         VALUES ($1, $2, 1, $3, $4, 'conditional', $5::jsonb, '{}'::jsonb, current_timestamp)`,
        [
          planId,
          eventId,
          ruleset.rulesetVersion,
          ruleset.snapshotDate,
          JSON.stringify({
            today: todayInJurisdiction("US-NY-NYC"),
            minSlackDays: null,
            finding_renderings: [
              {
                rule_ids: ["NYPD-SOUND-001", "PARKS-EVENT-001"],
                notes: ["sound: confirm the precinct form number", "parks: over 400 sq ft only"],
                note_text: null,
                conflict_text: null,
                deadline_display: null,
                slack_days: null,
                deadline_unknown_fields: [],
                timeline_unresolved_reason: null,
                portal_instructions: null,
                headline_mode: "applies_together",
                routes: [
                  route({
                    ruleId: "NYPD-SOUND-001",
                    disposition: "required",
                    name: "Sound Device Permit",
                    latestApplyDate: applyBy,
                    deadlineStatus: "deadline_approaching",
                    notes: ["sound: confirm the precinct form number"],
                  }),
                  route({
                    ruleId: "PARKS-EVENT-001",
                    disposition: "required",
                    name: "Special Event Permit",
                    latestApplyDate: otherApplyBy,
                    deadlineStatus: "deadline_approaching",
                    notes: ["parks: over 400 sq ft only"],
                  }),
                ],
              },
            ],
          }),
        ],
      );
      await pool.query(
        `INSERT INTO permit_plan_items (id, plan_id, rule_ids, triggered_by, permit_name, agency,
                                        latest_apply_date, sources, kind, disposition,
                                        deadline_status, verification_status)
         VALUES ($1, $2, ARRAY['NYPD-SOUND-001','PARKS-EVENT-001'], '[]'::jsonb,
                 'Sound Device Permit', 'NYPD', $3, '[]'::jsonb, 'permit', 'required',
                 'deadline_approaching', 'SOURCE_CONFIRMED')`,
        [itemId, planId, applyBy],
      );
      await pool.query(
        "INSERT INTO checklist_items (id, plan_item_id, cohort_position) VALUES ($1, $2, 0)",
        [randomUUID(), itemId],
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

      const reminders = (await alertsOf(eventId)).filter(
        (row) => row.alert_type === "deadline_reminder",
      );
      const sound = reminders.filter((row) =>
        String(row.payload.body).includes("Sound Device Permit"),
      );
      const parks = reminders.filter((row) =>
        String(row.payload.body).includes("Special Event Permit"),
      );
      expect(sound.length).toBeGreaterThan(0);
      expect(parks.length).toBeGreaterThan(0);
      for (const row of sound) {
        expect(row.payload.body).toContain("sound: confirm the precinct form number");
        expect(row.payload.body).not.toContain("over 400 sq ft only");
      }
      for (const row of parks) {
        expect(row.payload.body).toContain("parks: over 400 sq ft only");
        expect(row.payload.body).not.toContain("confirm the precinct form number");
      }
    });

    it("schedules no filing reminder for an advisory route of a merged line (#252)", async () => {
      const eventId = await createEvent(scenario("C"));
      const planId = randomUUID();
      const itemId = randomUUID();
      const applyBy = dayFromToday(9);
      const advisoryApplyBy = dayFromToday(12);
      const route = (overrides: Record<string, unknown>) => ({
        triggerResult: "true",
        unknownFields: [],
        agency: "NYPD",
        deadline: null,
        deadlineDisplay: null,
        latestApplyDate: null,
        applyAfterDate: null,
        deadlineStatus: "not_applicable",
        slackDays: null,
        feeDisplay: null,
        portalName: null,
        portalUrl: null,
        portalInstructions: null,
        notes: [],
        ...overrides,
      });
      await pool.query(
        `INSERT INTO permit_plans (id, event_id, event_revision, ruleset_version, snapshot_date,
                                   verdict, verdict_detail, intake_snapshot, generated_at)
         VALUES ($1, $2, 1, $3, $4, 'conditional', $5::jsonb, '{}'::jsonb, current_timestamp)`,
        [
          planId,
          eventId,
          ruleset.rulesetVersion,
          ruleset.snapshotDate,
          JSON.stringify({
            today: todayInJurisdiction("US-NY-NYC"),
            minSlackDays: null,
            finding_renderings: [
              {
                rule_ids: ["NYPD-SOUND-001", "PARKS-EVENT-001"],
                notes: [],
                note_text: null,
                conflict_text: null,
                deadline_display: null,
                slack_days: null,
                deadline_unknown_fields: [],
                timeline_unresolved_reason: null,
                portal_instructions: null,
                headline_mode: "applies_together",
                routes: [
                  route({
                    ruleId: "NYPD-SOUND-001",
                    disposition: "required",
                    name: "Sound Device Permit",
                    latestApplyDate: applyBy,
                    deadlineStatus: "deadline_approaching",
                  }),
                  route({
                    ruleId: "PARKS-EVENT-001",
                    disposition: "advisory",
                    name: "Amplified sound advisory",
                    latestApplyDate: advisoryApplyBy,
                    deadlineStatus: "deadline_approaching",
                  }),
                ],
              },
            ],
          }),
        ],
      );
      await pool.query(
        `INSERT INTO permit_plan_items (id, plan_id, rule_ids, triggered_by, permit_name, agency,
                                        latest_apply_date, sources, kind, disposition,
                                        deadline_status, verification_status)
         VALUES ($1, $2, ARRAY['NYPD-SOUND-001','PARKS-EVENT-001'], '[]'::jsonb,
                 'Sound Device Permit', 'NYPD', $3, '[]'::jsonb, 'permit', 'required',
                 'deadline_approaching', 'SOURCE_CONFIRMED')`,
        [itemId, planId, applyBy],
      );
      await pool.query(
        "INSERT INTO checklist_items (id, plan_item_id, cohort_position) VALUES ($1, $2, 0)",
        [randomUUID(), itemId],
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

      const reminders = (await alertsOf(eventId)).filter(
        (row) => row.alert_type === "deadline_reminder",
      );
      expect(reminders.length).toBeGreaterThan(0);
      for (const row of reminders) {
        expect(row.payload.body).toContain("Sound Device Permit");
        expect(row.payload.body).not.toContain("Amplified sound advisory");
        expect(row.payload.body).not.toContain(advisoryApplyBy);
      }
    });

    it("quotes only the route's own conflict text in its reminder (#252)", async () => {
      const eventId = await createEvent(scenario("C"));
      const planId = randomUUID();
      const itemId = randomUUID();
      const applyBy = dayFromToday(9);
      const otherApplyBy = dayFromToday(12);
      const route = (overrides: Record<string, unknown>) => ({
        triggerResult: "true",
        unknownFields: [],
        disposition: "required",
        agency: "NYPD",
        deadline: null,
        deadlineDisplay: null,
        latestApplyDate: null,
        applyAfterDate: null,
        deadlineStatus: "not_applicable",
        slackDays: null,
        feeDisplay: null,
        portalName: null,
        portalUrl: null,
        portalInstructions: null,
        notes: [],
        conflictText: null,
        ...overrides,
      });
      await pool.query(
        `INSERT INTO permit_plans (id, event_id, event_revision, ruleset_version, snapshot_date,
                                   verdict, verdict_detail, intake_snapshot, generated_at)
         VALUES ($1, $2, 1, $3, $4, 'conditional', $5::jsonb, '{}'::jsonb, current_timestamp)`,
        [
          planId,
          eventId,
          ruleset.rulesetVersion,
          ruleset.snapshotDate,
          JSON.stringify({
            today: todayInJurisdiction("US-NY-NYC"),
            minSlackDays: null,
            finding_renderings: [
              {
                rule_ids: ["NYPD-SOUND-001", "PARKS-EVENT-001"],
                notes: [],
                note_text: null,
                conflict_text: "parks: two published readings of the exactly-20 threshold",
                deadline_display: null,
                slack_days: null,
                deadline_unknown_fields: [],
                timeline_unresolved_reason: null,
                portal_instructions: null,
                headline_mode: "applies_together",
                routes: [
                  route({
                    ruleId: "NYPD-SOUND-001",
                    name: "Sound Device Permit",
                    latestApplyDate: applyBy,
                    deadlineStatus: "deadline_approaching",
                  }),
                  route({
                    ruleId: "PARKS-EVENT-001",
                    name: "Special Event Permit",
                    latestApplyDate: otherApplyBy,
                    deadlineStatus: "deadline_approaching",
                    conflictText: "parks: two published readings of the exactly-20 threshold",
                  }),
                ],
              },
            ],
          }),
        ],
      );
      await pool.query(
        `INSERT INTO permit_plan_items (id, plan_id, rule_ids, triggered_by, permit_name, agency,
                                        latest_apply_date, sources, kind, disposition,
                                        deadline_status, verification_status)
         VALUES ($1, $2, ARRAY['NYPD-SOUND-001','PARKS-EVENT-001'], '[]'::jsonb,
                 'Sound Device Permit', 'NYPD', $3, '[]'::jsonb, 'permit', 'required',
                 'deadline_approaching', 'SOURCE_CONFIRMED')`,
        [itemId, planId, applyBy],
      );
      await pool.query(
        "INSERT INTO checklist_items (id, plan_item_id, cohort_position) VALUES ($1, $2, 0)",
        [randomUUID(), itemId],
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

      const reminders = (await alertsOf(eventId)).filter(
        (row) => row.alert_type === "deadline_reminder",
      );
      const sound = reminders.filter((row) =>
        String(row.payload.body).includes("Sound Device Permit"),
      );
      const parks = reminders.filter((row) =>
        String(row.payload.body).includes("Special Event Permit"),
      );
      expect(sound.length).toBeGreaterThan(0);
      expect(parks.length).toBeGreaterThan(0);
      for (const row of sound) {
        expect(row.payload.body).not.toContain("two published readings");
      }
      for (const row of parks) {
        expect(row.payload.body).toContain("two published readings");
      }
    });

    it("schedules no filing reminder for a barred route of a merged line (#252)", async () => {
      const eventId = await createEvent(scenario("C"));
      const planId = randomUUID();
      const itemId = randomUUID();
      const applyBy = dayFromToday(9);
      const barredApplyBy = dayFromToday(12);
      const route = (overrides: Record<string, unknown>) => ({
        triggerResult: "true",
        unknownFields: [],
        agency: "NYPD",
        deadline: null,
        deadlineDisplay: null,
        latestApplyDate: null,
        applyAfterDate: null,
        deadlineStatus: "not_applicable",
        slackDays: null,
        feeDisplay: null,
        portalName: null,
        portalUrl: null,
        portalInstructions: null,
        ...overrides,
      });
      await pool.query(
        `INSERT INTO permit_plans (id, event_id, event_revision, ruleset_version, snapshot_date,
                                   verdict, verdict_detail, intake_snapshot, generated_at)
         VALUES ($1, $2, 1, $3, $4, 'conditional', $5::jsonb, '{}'::jsonb, current_timestamp)`,
        [
          planId,
          eventId,
          ruleset.rulesetVersion,
          ruleset.snapshotDate,
          JSON.stringify({
            today: todayInJurisdiction("US-NY-NYC"),
            minSlackDays: null,
            finding_renderings: [
              {
                rule_ids: ["NYPD-SOUND-001", "PARKS-EVENT-001"],
                notes: [],
                note_text: null,
                conflict_text: null,
                deadline_display: null,
                slack_days: null,
                deadline_unknown_fields: [],
                timeline_unresolved_reason: null,
                portal_instructions: null,
                headline_mode: "applies_together",
                routes: [
                  route({
                    ruleId: "NYPD-SOUND-001",
                    disposition: "required",
                    name: "Sound Device Permit",
                    latestApplyDate: applyBy,
                    deadlineStatus: "deadline_approaching",
                  }),
                  route({
                    ruleId: "PARKS-EVENT-001",
                    disposition: "prohibited_or_ineligible",
                    name: "Commercial advertising by sound device",
                    latestApplyDate: barredApplyBy,
                    deadlineStatus: "deadline_approaching",
                  }),
                ],
              },
            ],
          }),
        ],
      );
      await pool.query(
        `INSERT INTO permit_plan_items (id, plan_id, rule_ids, triggered_by, permit_name, agency,
                                        latest_apply_date, sources, kind, disposition,
                                        deadline_status, verification_status)
         VALUES ($1, $2, ARRAY['NYPD-SOUND-001','PARKS-EVENT-001'], '[]'::jsonb,
                 'Sound Device Permit', 'NYPD', $3, '[]'::jsonb, 'permit', 'required',
                 'deadline_approaching', 'SOURCE_CONFIRMED')`,
        [itemId, planId, applyBy],
      );
      await pool.query(
        "INSERT INTO checklist_items (id, plan_item_id, cohort_position) VALUES ($1, $2, 0)",
        [randomUUID(), itemId],
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

      const reminders = (await alertsOf(eventId)).filter(
        (row) => row.alert_type === "deadline_reminder",
      );
      expect(reminders.length).toBeGreaterThan(0);
      for (const row of reminders) {
        expect(row.payload.body).toContain("Sound Device Permit");
        expect(row.payload.body).not.toContain("Commercial advertising by sound device");
        expect(row.payload.body).not.toContain(barredApplyBy);
      }
    });

    describe("a merged line's dated-route count crossing 1 to 2 (#252)", () => {
      const mergedRoute = (overrides: Record<string, unknown>) => ({
        triggerResult: "true",
        unknownFields: [],
        agency: "NYPD",
        deadline: null,
        deadlineDisplay: null,
        latestApplyDate: null,
        applyAfterDate: null,
        deadlineStatus: "not_applicable",
        slackDays: null,
        feeDisplay: null,
        portalName: null,
        portalUrl: null,
        portalInstructions: null,
        ...overrides,
      });

      const routeList = (
        routes: Record<string, unknown>[],
        options: { reverseRouteOrder?: boolean; triggerResults?: Record<string, string> },
      ): Record<string, unknown>[] => {
        const resolved = routes.map((route) => ({
          ...route,
          ...(options.triggerResults?.[route.ruleId as string] === undefined
            ? {}
            : { triggerResult: options.triggerResults[route.ruleId as string] }),
        }));
        return options.reverseRouteOrder === true ? [...resolved].reverse() : resolved;
      };

      const insertMergedPlan = async (
        eventId: string,
        options: {
          secondRouteDated: boolean;
          checklistItemId: string;
          secondRouteIdentical?: boolean;
          secondRouteSameSubject?: boolean;
          reverseRouteOrder?: boolean;
          triggerResults?: Record<string, string>;
          firstRouteName?: string;
        },
      ): Promise<string> => {
        const planId = randomUUID();
        const itemId = randomUUID();
        const applyBy = dayFromToday(0);
        await pool.query(
          `INSERT INTO permit_plans (id, event_id, event_revision, ruleset_version, snapshot_date,
                                     verdict, verdict_detail, intake_snapshot, generated_at)
           VALUES ($1, $2, 1, $3, $4, 'feasible', $5::jsonb, '{}'::jsonb, clock_timestamp())`,
          [
            planId,
            eventId,
            ruleset.rulesetVersion,
            ruleset.snapshotDate,
            JSON.stringify({
              today: todayInJurisdiction("US-NY-NYC"),
              minSlackDays: null,
              finding_renderings: [
                {
                  rule_ids: ["NYPD-SOUND-001", "PARKS-EVENT-001"],
                  notes: [],
                  note_text: null,
                  conflict_text: null,
                  deadline_display: "file at least 5 days before use",
                  slack_days: null,
                  deadline_unknown_fields: [],
                  timeline_unresolved_reason: null,
                  portal_instructions: null,
                  headline_mode: "applies_together",
                  routes: routeList(
                    [
                      mergedRoute({
                        ruleId: "NYPD-SOUND-001",
                        disposition: "required",
                        name: options.firstRouteName ?? "Sound Device Permit",
                        latestApplyDate: applyBy,
                        deadlineStatus: "deadline_approaching",
                        deadlineDisplay: "file at least 5 days before use",
                      }),
                      mergedRoute({
                        ruleId: "PARKS-EVENT-001",
                        ...(options.secondRouteIdentical === true
                          ? {
                              disposition: "required",
                              name: "Sound Device Permit",
                              latestApplyDate: applyBy,
                              deadlineStatus: "deadline_approaching",
                              deadlineDisplay: "file at least 5 days before use",
                            }
                          : options.secondRouteSameSubject === true
                            ? {
                                disposition: "required",
                                name: "Sound Device Permit",
                                agency: "DOT",
                                latestApplyDate: applyBy,
                                deadlineStatus: "deadline_approaching",
                                deadlineDisplay: "file at least 5 days before use",
                              }
                            : {
                                disposition: "may_be_required",
                                name: "Special Event Permit",
                                ...(options.secondRouteDated
                                  ? {
                                      latestApplyDate: dayFromToday(1),
                                      deadlineStatus: "deadline_approaching",
                                      deadlineDisplay: "apply at least 21 days ahead",
                                    }
                                  : {}),
                              }),
                      }),
                    ],
                    options,
                  ),
                },
              ],
            }),
          ],
        );
        await pool.query(
          `INSERT INTO permit_plan_items (id, plan_id, rule_ids, triggered_by, permit_name, agency,
                                          latest_apply_date, sources, kind, disposition,
                                          deadline_status, verification_status)
           VALUES ($1, $2, ARRAY['NYPD-SOUND-001','PARKS-EVENT-001'], '[]'::jsonb,
                   'Sound Device Permit', 'NYPD', $3, '[]'::jsonb, 'permit', 'required',
                   'deadline_approaching', 'SOURCE_CONFIRMED')`,
          [itemId, planId, applyBy],
        );
        await pool.query(
          `INSERT INTO checklist_items (id, plan_item_id, cohort_position) VALUES ($1, $2, 0)
             ON CONFLICT (id) DO UPDATE SET plan_item_id = EXCLUDED.plan_item_id`,
          [options.checklistItemId, itemId],
        );
        return planId;
      };

      const schedule = async (eventId: string, planId: string): Promise<void> => {
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

      it("delivers the reminder once across the regeneration that dates the second route", async () => {
        const eventId = await createEvent(scenario("C"));
        const checklistItemId = randomUUID();
        const provider = fakeProvider();
        const poller = () =>
          createAlertPoller({
            database: pool,
            senders: provider.senders,
            jurisdiction: ruleset.jurisdiction,
          }).tick();

        await schedule(
          eventId,
          await insertMergedPlan(eventId, {
            secondRouteDated: false,
            checklistItemId,
          }),
        );
        await poller();
        const afterFirst = await alertsOf(eventId);
        const firstReminders = afterFirst.filter((row) => row.alert_type === "deadline_reminder");
        expect(firstReminders.length).toBeGreaterThan(0);
        expect(firstReminders.every((row) => row.status === "sent")).toBe(true);
        const deliveredFirst = provider.delivered.length;

        await schedule(
          eventId,
          await insertMergedPlan(eventId, {
            secondRouteDated: true,
            checklistItemId,
          }),
        );
        await poller();

        const soundReminders = (await alertsOf(eventId)).filter(
          (row) =>
            row.alert_type === "deadline_reminder" &&
            row.idempotency_key.includes("NYPD-SOUND-001"),
        );
        expect(soundReminders).toHaveLength(reminderOffsets.length);
        expect(new Set(soundReminders.map((row) => row.idempotency_key)).size).toBe(
          soundReminders.length,
        );

        const seen = new Set<string>();
        for (const message of provider.delivered) {
          const key = `${message.recipient}|${message.subject}|${message.body}`;
          expect(seen.has(key)).toBe(false);
          seen.add(key);
        }
        expect(provider.delivered.length).toBeGreaterThan(deliveredFirst);
      });

      it("keys an unmerged row exactly as it did before, so its sent reminder is untouched", async () => {
        const eventId = await createEvent(scenario("C"));
        const { planId, checklistItemId } = await insertDuePlan(eventId);
        await schedule(eventId, planId);
        const before = await alertsOf(eventId);
        expect(before.length).toBeGreaterThan(0);
        expect(before.every((row) => !row.idempotency_key.includes("NYPD-SOUND-001"))).toBe(true);

        const { planId: regenerated } = await insertDuePlan(eventId, {
          reuseChecklistItemId: checklistItemId,
        });
        await schedule(eventId, regenerated);
        const after = await alertsOf(eventId);
        expect(after.map((row) => row.idempotency_key).sort()).toEqual(
          before.map((row) => row.idempotency_key).sort(),
        );
      });

      it("delivers one reminder where two routes publish byte-identical copy (#252)", async () => {
        const eventId = await createEvent(scenario("C"));
        const checklistItemId = randomUUID();
        await schedule(
          eventId,
          await insertMergedPlan(eventId, {
            secondRouteDated: true,
            secondRouteIdentical: true,
            checklistItemId,
          }),
        );

        const reminders = (await alertsOf(eventId)).filter(
          (row) => row.alert_type === "deadline_reminder",
        );
        expect(reminders).toHaveLength(reminderOffsets.length);

        const provider = fakeProvider();
        await createAlertPoller({
          database: pool,
          senders: provider.senders,
          jurisdiction: ruleset.jurisdiction,
        }).tick();

        const words = provider.attempts.map(
          (message) => `${message.recipient}|${message.subject}|${message.body}`,
        );
        expect(new Set(words).size).toBe(words.length);
        expect(words).toHaveLength(reminderOffsets.length);
      });

      it("delivers once when the date moves and the canonical route moves together (#252)", async () => {
        const eventId = await createEvent(scenario("C"));
        const checklistItemId = randomUUID();

        const insertPlan = async (applyBy: string, tentMatches: boolean): Promise<string> => {
          const planId = randomUUID();
          const itemId = randomUUID();
          const sound = mergedRoute({
            ruleId: "NYPD-SOUND-001",
            disposition: "required",
            name: "Sound Device Permit",
            latestApplyDate: applyBy,
            deadlineStatus: "deadline_approaching",
            deadlineDisplay: "file at least 5 days before use",
          });
          await pool.query(
            `INSERT INTO permit_plans (id, event_id, event_revision, ruleset_version, snapshot_date,
                                       verdict, verdict_detail, intake_snapshot, generated_at)
             VALUES ($1, $2, 1, $3, $4, 'feasible', $5::jsonb, '{}'::jsonb, clock_timestamp())`,
            [
              planId,
              eventId,
              ruleset.rulesetVersion,
              ruleset.snapshotDate,
              JSON.stringify({
                today: todayInJurisdiction("US-NY-NYC"),
                minSlackDays: null,
                finding_renderings: [
                  {
                    rule_ids: ["NYPD-SOUND-001", "DOB-TENT-001"],
                    notes: [],
                    note_text: null,
                    conflict_text: null,
                    deadline_display: "file at least 5 days before use",
                    slack_days: null,
                    deadline_unknown_fields: [],
                    timeline_unresolved_reason: null,
                    portal_instructions: null,
                    headline_mode: "applies_together",
                    routes: [
                      sound,
                      tentMatches
                        ? { ...sound, ruleId: "DOB-TENT-001" }
                        : mergedRoute({
                            ruleId: "DOB-TENT-001",
                            disposition: "may_be_required",
                            name: "Temporary Use Permit",
                            agency: "DOB",
                          }),
                    ],
                  },
                ],
              }),
            ],
          );
          await pool.query(
            `INSERT INTO permit_plan_items (id, plan_id, rule_ids, triggered_by, permit_name,
                                            agency, latest_apply_date, sources, kind, disposition,
                                            deadline_status, verification_status)
             VALUES ($1, $2, ARRAY['NYPD-SOUND-001','DOB-TENT-001'], '[]'::jsonb,
                     'Sound Device Permit', 'NYPD', $3, '[]'::jsonb, 'permit', 'required',
                     'deadline_approaching', 'SOURCE_CONFIRMED')`,
            [itemId, planId, applyBy],
          );
          await pool.query(
            `INSERT INTO checklist_items (id, plan_item_id, cohort_position) VALUES ($1, $2, 0)
               ON CONFLICT (id) DO UPDATE SET plan_item_id = EXCLUDED.plan_item_id`,
            [checklistItemId, itemId],
          );
          return planId;
        };

        const provider = fakeProvider();
        const poller = () =>
          createAlertPoller({
            database: pool,
            senders: provider.senders,
            jurisdiction: ruleset.jurisdiction,
          }).tick();

        await schedule(eventId, await insertPlan(dayFromToday(0), false));
        await poller();
        const sent = (await alertsOf(eventId)).filter(
          (row) => row.alert_type === "deadline_reminder",
        );
        expect(sent.length).toBeGreaterThan(0);
        expect(sent.every((row) => row.status === "sent")).toBe(true);
        expect(sent.every((row) => row.idempotency_key.includes("NYPD-SOUND-001"))).toBe(true);
        const deliveredFirst = provider.delivered.length;

        await schedule(eventId, await insertPlan(dayFromToday(1), true));
        await poller();

        const reminders = (await alertsOf(eventId)).filter(
          (row) => row.alert_type === "deadline_reminder",
        );
        expect(reminders).toHaveLength(reminderOffsets.length);
        expect(reminders.every((row) => row.idempotency_key.includes("DOB-TENT-001"))).toBe(true);
        expect(reminders.every((row) => row.status === "sent")).toBe(true);
        expect(provider.delivered.length).toBe(deliveredFirst);
        const seen = new Set<string>();
        for (const message of provider.delivered) {
          const key = `${message.recipient}|${message.subject}|${message.body}`;
          expect(seen.has(key)).toBe(false);
          seen.add(key);
        }
      });

      it("delivers both reminders where two routes share a subject and differ in body (#252)", async () => {
        const eventId = await createEvent(scenario("C"));
        const checklistItemId = randomUUID();
        await schedule(
          eventId,
          await insertMergedPlan(eventId, {
            secondRouteDated: true,
            secondRouteSameSubject: true,
            checklistItemId,
          }),
        );

        const reminders = (await alertsOf(eventId)).filter(
          (row) => row.alert_type === "deadline_reminder",
        );
        expect(reminders).toHaveLength(reminderOffsets.length * 2);

        const provider = fakeProvider();
        await createAlertPoller({
          database: pool,
          senders: provider.senders,
          jurisdiction: ruleset.jurisdiction,
        }).tick();

        const subjects = new Set(provider.attempts.map((message) => message.subject));
        expect(subjects.size).toBe(1);
        const bodies = provider.attempts.map((message) => message.body);
        expect(bodies).toHaveLength(reminderOffsets.length * 2);
        expect(new Set(bodies).size).toBe(bodies.length);
        expect(bodies.some((body) => body.includes("Sound Device Permit (NYPD)"))).toBe(true);
        expect(bodies.some((body) => body.includes("Sound Device Permit (DOT)"))).toBe(true);
      });

      it("keeps a coalesced reminder's identity when the binding route changes (#252)", async () => {
        const eventId = await createEvent(scenario("C"));
        const checklistItemId = randomUUID();
        const provider = fakeProvider();
        const poller = () =>
          createAlertPoller({
            database: pool,
            senders: provider.senders,
            jurisdiction: ruleset.jurisdiction,
          }).tick();

        await schedule(
          eventId,
          await insertMergedPlan(eventId, {
            secondRouteDated: true,
            secondRouteIdentical: true,
            checklistItemId,
            reverseRouteOrder: true,
            triggerResults: { "NYPD-SOUND-001": "unknown" },
          }),
        );
        await poller();
        const first = await alertsOf(eventId);
        const deliveredFirst = provider.delivered.length;
        expect(deliveredFirst).toBeGreaterThan(0);

        await schedule(
          eventId,
          await insertMergedPlan(eventId, {
            secondRouteDated: true,
            secondRouteIdentical: true,
            checklistItemId,
          }),
        );
        await poller();

        const after = await alertsOf(eventId);
        expect(after.map((row) => row.idempotency_key).sort()).toEqual(
          first.map((row) => row.idempotency_key).sort(),
        );
        expect(provider.delivered.length).toBe(deliveredFirst);
        const words = provider.delivered.map(
          (message) => `${message.recipient}|${message.subject}|${message.body}`,
        );
        expect(new Set(words).size).toBe(words.length);
      });

      it("delivers a split coalesced reminder's corrected copy in the generation that corrects it (#252)", async () => {
        const eventId = await createEvent(scenario("C"));
        const checklistItemId = randomUUID();
        const provider = fakeProvider();
        const poller = () =>
          createAlertPoller({
            database: pool,
            senders: provider.senders,
            jurisdiction: ruleset.jurisdiction,
          }).tick();

        await schedule(
          eventId,
          await insertMergedPlan(eventId, {
            secondRouteDated: true,
            secondRouteIdentical: true,
            checklistItemId,
          }),
        );
        await poller();
        const corrected = () =>
          provider.attempts.filter((message) => message.subject.includes("(corrected)")).length;
        expect(provider.attempts.length).toBeGreaterThan(0);
        expect(corrected()).toBe(0);

        const split = {
          secondRouteDated: true,
          secondRouteIdentical: true,
          checklistItemId,
          firstRouteName: "Sound Device Permit (corrected)",
        };
        await schedule(eventId, await insertMergedPlan(eventId, split));
        await poller();
        expect(corrected()).toBeGreaterThan(0);
        const afterSplit = provider.attempts.length;

        await schedule(eventId, await insertMergedPlan(eventId, split));
        await poller();
        expect(provider.attempts.length).toBe(afterSplit);

        const rows = await alertsOf(eventId);
        expect(rows.every((row) => row.status === "sent")).toBe(true);
        expect(
          rows.filter((row) => row.idempotency_key.includes(":NYPD-SOUND-001:")).length,
        ).toBeGreaterThan(0);
        expect(
          rows.filter((row) => row.idempotency_key.includes(":PARKS-EVENT-001:")).length,
        ).toBeGreaterThan(0);
      });

      it("presents the key already in flight after adoption re-keys an attempted row (#252)", async () => {
        const eventId = await createEvent(scenario("C"));
        const checklistItemId = randomUUID();
        const applyBy = dayFromToday(3);
        const generate = async (routes: unknown[] | undefined): Promise<void> => {
          const planId = randomUUID();
          const itemId = randomUUID();
          await pool.query(
            `INSERT INTO permit_plans (id, event_id, event_revision, ruleset_version, snapshot_date,
                                       verdict, verdict_detail, intake_snapshot, generated_at)
             VALUES ($1, $2, 1, $3, $4, 'feasible', $5::jsonb, '{}'::jsonb, clock_timestamp())`,
            [
              planId,
              eventId,
              ruleset.rulesetVersion,
              ruleset.snapshotDate,
              JSON.stringify({
                today: todayInJurisdiction("US-NY-NYC"),
                minSlackDays: null,
                finding_renderings: [
                  {
                    rule_ids: ["NYPD-SOUND-001", "PARKS-EVENT-001"],
                    notes: [],
                    note_text: null,
                    conflict_text: null,
                    deadline_display: "file at least 5 days before use",
                    slack_days: null,
                    deadline_unknown_fields: [],
                    timeline_unresolved_reason: null,
                    portal_instructions: null,
                    ...(routes === undefined ? {} : { headline_mode: "applies_together", routes }),
                  },
                ],
              }),
            ],
          );
          await pool.query(
            `INSERT INTO permit_plan_items (id, plan_id, rule_ids, triggered_by, permit_name,
                                            agency, latest_apply_date, sources, kind, disposition,
                                            deadline_status, verification_status)
             VALUES ($1, $2, ARRAY['NYPD-SOUND-001','PARKS-EVENT-001'], '[]'::jsonb,
                     'Sound Device Permit', 'NYPD', $3, '[]'::jsonb, 'permit', 'required',
                     'deadline_approaching', 'SOURCE_CONFIRMED')`,
            [itemId, planId, applyBy],
          );
          await pool.query(
            `INSERT INTO checklist_items (id, plan_item_id, cohort_position) VALUES ($1, $2, 0)
               ON CONFLICT (id) DO UPDATE SET plan_item_id = EXCLUDED.plan_item_id`,
            [checklistItemId, itemId],
          );
          await schedule(eventId, planId);
        };

        const provider = fakeProvider();
        const presented: AlertMessage[] = [];
        const timingOut: AlertSenders = {
          sms: provider.senders.sms,
          email: async (message) => {
            presented.push(message);
            throw new AlertDeliveryError("email provider did not respond within 10000ms", {
              outcomeObserved: false,
            });
          },
        };

        await generate(undefined);
        await createAlertPoller({
          database: pool,
          senders: timingOut,
          jurisdiction: ruleset.jurisdiction,
        }).tick();

        const failed = (await alertsOf(eventId)).filter(
          (row) => row.alert_type === "deadline_reminder" && row.status === "failed",
        );
        expect(failed).toHaveLength(1);
        const alertId = failed[0]?.id ?? "";
        const firstAttempt = await attemptsOf(alertId);
        expect(firstAttempt).toHaveLength(1);
        expect(firstAttempt[0]?.outcome_recorded_at).toBeNull();
        expect(presented).toHaveLength(1);
        const inFlightKey = presented[0]?.idempotencyKey;
        expect(firstAttempt[0]?.idempotency_key).toBe(inFlightKey);
        await pool.query("UPDATE alerts SET next_attempt_at = NULL WHERE id = $1", [alertId]);

        await generate([
          mergedRoute({
            ruleId: "NYPD-SOUND-001",
            disposition: "required",
            name: "Sound Device Permit",
            latestApplyDate: applyBy,
            deadlineStatus: "deadline_approaching",
            deadlineDisplay: "file at least 5 days before use",
          }),
          mergedRoute({
            ruleId: "PARKS-EVENT-001",
            disposition: "required",
            name: "Special Event Permit",
            latestApplyDate: dayFromToday(5),
            deadlineStatus: "deadline_approaching",
          }),
        ]);
        const adopted = (await alertsOf(eventId)).find((row) => row.id === alertId);
        expect(adopted?.idempotency_key).toContain("NYPD-SOUND-001");
        expect(adopted?.idempotency_key).not.toBe(inFlightKey);

        await createAlertPoller({
          database: pool,
          senders: provider.senders,
          jurisdiction: ruleset.jurisdiction,
        }).tick();

        const retry = provider.attempts.find(
          (message) => message.subject === presented[0]?.subject,
        );
        expect(retry?.idempotencyKey).toBe(inFlightKey);
        expect((await attemptsOf(alertId)).map((row) => row.idempotency_key)).toEqual([
          inFlightKey,
          inFlightKey,
        ]);
      });
    });

    it("does not retire a gated route's unlock on another route's closed window (#252)", async () => {
      const eventId = await createEvent(scenario("C"));
      const planId = randomUUID();
      const itemId = randomUUID();
      const closedYesterday = dayFromToday(-1);
      const route = (overrides: Record<string, unknown>) => ({
        triggerResult: "true",
        unknownFields: [],
        agency: "NYPD",
        deadline: null,
        deadlineDisplay: null,
        latestApplyDate: null,
        applyAfterDate: null,
        deadlineStatus: "not_applicable",
        slackDays: null,
        feeDisplay: null,
        portalName: null,
        portalUrl: null,
        portalInstructions: null,
        ...overrides,
      });
      await pool.query(
        `INSERT INTO permit_plans (id, event_id, event_revision, ruleset_version, snapshot_date,
                                   verdict, verdict_detail, intake_snapshot, generated_at)
         VALUES ($1, $2, 1, $3, $4, 'conditional', $5::jsonb, '{}'::jsonb, current_timestamp)`,
        [
          planId,
          eventId,
          ruleset.rulesetVersion,
          ruleset.snapshotDate,
          JSON.stringify({
            today: todayInJurisdiction("US-NY-NYC"),
            minSlackDays: null,
            finding_renderings: [
              {
                rule_ids: ["NYPD-SOUND-001", "PARKS-EVENT-001"],
                notes: [],
                note_text: null,
                conflict_text: null,
                deadline_display: null,
                slack_days: null,
                deadline_unknown_fields: [],
                timeline_unresolved_reason: null,
                portal_instructions: null,
                headline_mode: "applies_together",
                routes: [
                  route({
                    ruleId: "NYPD-SOUND-001",
                    disposition: "required",
                    name: "Sound Device Permit",
                    applyAfterDate: dayFromToday(-1),
                  }),
                  route({
                    ruleId: "PARKS-EVENT-001",
                    disposition: "may_be_required",
                    name: "Special Event Permit",
                    latestApplyDate: closedYesterday,
                    deadlineStatus: "published_deadline_missed",
                  }),
                ],
              },
            ],
          }),
        ],
      );
      await pool.query(
        `INSERT INTO permit_plan_items (id, plan_id, rule_ids, triggered_by, permit_name, agency,
                                        latest_apply_date, sources, kind, disposition,
                                        deadline_status, verification_status)
         VALUES ($1, $2, ARRAY['NYPD-SOUND-001','PARKS-EVENT-001'], '[]'::jsonb,
                 'Special Event Permit', 'NYPD', $3, '[]'::jsonb, 'permit', 'required',
                 'published_deadline_missed', 'SOURCE_CONFIRMED')`,
        [itemId, planId, closedYesterday],
      );
      await pool.query(
        "INSERT INTO checklist_items (id, plan_item_id, cohort_position) VALUES ($1, $2, 0)",
        [randomUUID(), itemId],
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
      expect(unlock).toBeDefined();
      expect(unlock?.payload.controlling_apply_by).toBeNull();
      expect(unlock?.payload.route_scheduled).toBe(true);

      const { rows } = await pool.query<{ shut: boolean }>(
        `SELECT ${FILING_WINDOW_HAS_SHUT("$2")} AS shut FROM alerts WHERE id = $1`,
        [unlock?.id, dayFromToday(0)],
      );
      expect(rows[0]?.shut).toBe(false);

      const provider = fakeProvider();
      await createAlertPoller({
        database: pool,
        senders: provider.senders,
        jurisdiction: ruleset.jurisdiction,
      }).tick();
      const afterTick = (await alertsOf(eventId)).find(
        (row) => row.alert_type === "dependency_unlocked",
      );
      expect(afterTick?.status).toBe("sent");
    });

    it("clears a route's controlling window when the route stops publishing one (#252)", async () => {
      const eventId = await createEvent(scenario("C"));
      const checklistItemId = randomUUID();
      const openedOn = dayFromToday(-4);
      const shutSince = dayFromToday(-3);
      const stillOpen = dayFromToday(20);
      const route = (overrides: Record<string, unknown>) => ({
        triggerResult: "true",
        unknownFields: [],
        agency: "NYPD",
        deadline: null,
        deadlineDisplay: null,
        latestApplyDate: null,
        applyAfterDate: null,
        deadlineStatus: "not_applicable",
        slackDays: null,
        feeDisplay: null,
        portalName: null,
        portalUrl: null,
        portalInstructions: null,
        ...overrides,
      });
      const generate = async (gatedApplyBy: string | null, at: () => Date): Promise<void> => {
        const planId = randomUUID();
        const itemId = randomUUID();
        await pool.query(
          `INSERT INTO permit_plans (id, event_id, event_revision, ruleset_version, snapshot_date,
                                     verdict, verdict_detail, intake_snapshot, generated_at)
           VALUES ($1, $2, 1, $3, $4, 'conditional', $5::jsonb, '{}'::jsonb, current_timestamp)`,
          [
            planId,
            eventId,
            ruleset.rulesetVersion,
            ruleset.snapshotDate,
            JSON.stringify({
              today: todayInJurisdiction("US-NY-NYC"),
              minSlackDays: null,
              finding_renderings: [
                {
                  rule_ids: ["NYPD-SOUND-001", "PARKS-EVENT-001"],
                  notes: [],
                  note_text: null,
                  conflict_text: null,
                  deadline_display: null,
                  slack_days: null,
                  deadline_unknown_fields: [],
                  timeline_unresolved_reason: null,
                  portal_instructions: null,
                  headline_mode: "applies_together",
                  routes: [
                    route({
                      ruleId: "NYPD-SOUND-001",
                      disposition: "required",
                      name: "Sound Device Permit",
                      applyAfterDate: openedOn,
                      latestApplyDate: gatedApplyBy,
                    }),
                    route({
                      ruleId: "PARKS-EVENT-001",
                      disposition: "required",
                      name: "Special Event Permit",
                      latestApplyDate: stillOpen,
                    }),
                  ],
                },
              ],
            }),
          ],
        );
        await pool.query(
          `INSERT INTO permit_plan_items (id, plan_id, rule_ids, triggered_by, permit_name, agency,
                                          latest_apply_date, sources, kind, disposition,
                                          deadline_status, verification_status)
           VALUES ($1, $2, ARRAY['NYPD-SOUND-001','PARKS-EVENT-001'], '[]'::jsonb,
                   'Special Event Permit', 'NYPD', $3, '[]'::jsonb, 'permit', 'required',
                   'on_track', 'SOURCE_CONFIRMED')`,
          [itemId, planId, stillOpen],
        );
        await pool.query(
          `INSERT INTO checklist_items (id, plan_item_id, cohort_position) VALUES ($1, $2, 0)
             ON CONFLICT (id) DO UPDATE SET plan_item_id = EXCLUDED.plan_item_id`,
          [checklistItemId, itemId],
        );
        const client = await pool.connect();
        try {
          await schedulerWith(at)(client, eventId, planId, {
            email: "organizer@example.test",
            phone: null,
          });
        } finally {
          client.release();
        }
      };

      await generate(shutSince, () => new Date(`${dayFromToday(-5)}T13:00:00Z`));
      const first = (await alertsOf(eventId)).find(
        (row) => row.alert_type === "dependency_unlocked",
      );
      expect(first?.payload.controlling_apply_by).toBe(shutSince);

      await generate(null, () => new Date());
      const second = (await alertsOf(eventId)).find(
        (row) => row.alert_type === "dependency_unlocked",
      );
      expect(second?.id).toBe(first?.id);
      expect(second?.status).toBe("pending");
      expect(second?.payload.controlling_apply_by).toBeNull();
      const { rows } = await pool.query<{ shut: boolean }>(
        `SELECT ${FILING_WINDOW_HAS_SHUT("$2")} AS shut FROM alerts WHERE id = $1`,
        [second?.id, dayFromToday(0)],
      );
      expect(rows[0]?.shut).toBe(false);

      const provider = fakeProvider();
      await createAlertPoller({
        database: pool,
        senders: provider.senders,
        jurisdiction: ruleset.jurisdiction,
      }).tick();
      const delivered = (await alertsOf(eventId)).find(
        (row) => row.alert_type === "dependency_unlocked",
      );
      expect(delivered?.status).toBe("sent");
      expect(provider.attempts.map((message) => message.subject)).toContain(
        second?.payload.subject,
      );
    });

    it("does not re-deliver a merged line's reminder across the route-list deploy (#252)", async () => {
      const eventId = await createEvent(scenario("C"));
      const checklistItemId = randomUUID();
      const bindingApplyBy = dayFromToday(3);
      const otherApplyBy = dayFromToday(5);
      const route = (overrides: Record<string, unknown>) => ({
        triggerResult: "true",
        unknownFields: [],
        agency: "NYPD",
        deadline: null,
        deadlineDisplay: null,
        latestApplyDate: null,
        applyAfterDate: null,
        deadlineStatus: "on_track",
        slackDays: null,
        feeDisplay: null,
        portalName: null,
        portalUrl: null,
        portalInstructions: null,
        ...overrides,
      });
      const generate = async (routes: unknown[] | undefined): Promise<void> => {
        const planId = randomUUID();
        const itemId = randomUUID();
        await pool.query(
          `INSERT INTO permit_plans (id, event_id, event_revision, ruleset_version, snapshot_date,
                                     verdict, verdict_detail, intake_snapshot, generated_at)
           VALUES ($1, $2, 1, $3, $4, 'feasible', $5::jsonb, '{}'::jsonb, current_timestamp)`,
          [
            planId,
            eventId,
            ruleset.rulesetVersion,
            ruleset.snapshotDate,
            JSON.stringify({
              today: todayInJurisdiction("US-NY-NYC"),
              minSlackDays: null,
              finding_renderings: [
                {
                  rule_ids: ["NYPD-SOUND-001", "PARKS-EVENT-001"],
                  notes: [],
                  note_text: null,
                  conflict_text: null,
                  deadline_display: null,
                  slack_days: null,
                  deadline_unknown_fields: [],
                  timeline_unresolved_reason: null,
                  portal_instructions: null,
                  ...(routes === undefined ? {} : { headline_mode: "applies_together", routes }),
                },
              ],
            }),
          ],
        );
        await pool.query(
          `INSERT INTO permit_plan_items (id, plan_id, rule_ids, triggered_by, permit_name, agency,
                                          latest_apply_date, sources, kind, disposition,
                                          deadline_status, verification_status)
           VALUES ($1, $2, ARRAY['NYPD-SOUND-001','PARKS-EVENT-001'], '[]'::jsonb,
                   'Sound Device Permit', 'NYPD', $3, '[]'::jsonb, 'permit', 'required',
                   'on_track', 'SOURCE_CONFIRMED')`,
          [itemId, planId, bindingApplyBy],
        );
        await pool.query(
          `INSERT INTO checklist_items (id, plan_item_id, cohort_position) VALUES ($1, $2, 0)
             ON CONFLICT (id) DO UPDATE SET plan_item_id = EXCLUDED.plan_item_id`,
          [checklistItemId, itemId],
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
      };

      const provider = fakeProvider();
      const tick = async (): Promise<void> => {
        await createAlertPoller({
          database: pool,
          senders: provider.senders,
          jurisdiction: ruleset.jurisdiction,
        }).tick();
      };

      await generate(undefined);
      await tick();
      const deliveredBefore = provider.attempts.length;
      expect(deliveredBefore).toBeGreaterThan(0);

      await generate([
        route({
          ruleId: "NYPD-SOUND-001",
          disposition: "required",
          name: "Sound Device Permit",
          latestApplyDate: bindingApplyBy,
        }),
        route({
          ruleId: "PARKS-EVENT-001",
          disposition: "required",
          name: "Special Event Permit",
          latestApplyDate: otherApplyBy,
        }),
      ]);
      await tick();

      const sent = provider.attempts.map((message) => `${message.subject} ${message.body}`);
      expect(new Set(sent).size).toBe(sent.length);
      expect(provider.attempts.some((message) => message.subject.includes("Special Event"))).toBe(
        true,
      );
    });

    it("still warns about slack while a filing date is ahead", async () => {
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
      const eventId = await createEvent(scenario("C"));
      await schedulePastDue(eventId, [reminderOffsets[0] ?? 7]);
      const before = await alertsOf(eventId);
      expect(before).toHaveLength(1);
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
      expect((await alertsOf(eventId))[0]?.status).toBe("cancelled");
    });

    it("still delivers a reminder whose filing date is ahead", async () => {
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
      expect(String(warning?.payload.subject)).not.toContain("apply within");
      expect(String(warning?.payload.subject)).not.toMatch(/\d{4}-\d{2}-\d{2}/);
    });

    it("does not cancel a held stale-plan alert on the old plan's date", async () => {
      const eventId = await createEvent(scenario("C"));
      await schedulePastDue(eventId, [reminderOffsets[0] ?? 7]);
      const before = await alertsOf(eventId);
      await pool.query("UPDATE alerts SET status = 'failed', failure_count = 1 WHERE id = $1", [
        before[0]?.id,
      ]);
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
      expect((await alertsOf(eventId))[0]?.status).toBe("failed");
    });

    it("cancels a reminder whose filing date passed yesterday, with no grace day", async () => {
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
      const startedAt = Date.now();
      const eventId = await createEvent(scenario("C"));
      await schedulePastDue(eventId, [reminderOffsets[0] ?? 7]);

      const [reminder] = await alertsOf(eventId);
      expect(reminder?.alert_type).toBe("deadline_reminder");
      expect(reminder?.send_at.getTime()).toBeGreaterThanOrEqual(startedAt - 1_000);
      expect(reminder?.send_at.getTime()).toBeLessThanOrEqual(Date.now() + 1_000);
      expect(String(reminder?.payload.body)).toContain(
        "sent now because your checklist was created after that day had already passed",
      );
    });

    it("calls an ungated controlling minimum a countdown even when the plan has a gated row", async () => {
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
      expect(warning?.payload.subject).toBe(
        `At risk — apply within 5 days of ${todayInJurisdiction("US-NY-NYC")}`,
      );
      expect(String(warning?.payload.body)).toContain("Counting from");
      expect(String(warning?.payload.body)).not.toContain("window 5 days wide");
    });

    it("cancels a slack warning whose controlling window shut during an outage", async () => {
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
          { timeout: POLL_INTERVAL_MS, interval: 250 },
        );
      } finally {
        await poller.stop();
      }

      expect(Date.now() - startedAt).toBeLessThan(POLL_INTERVAL_MS);
      expect(provider.delivered.length).toBe(overflow);
    }, POLL_INTERVAL_MS + 15_000);

    it("reports a full batch as not drained", async () => {
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
      expect(summary.drained).toBe(false);
    });

    it("sizes a first pass to the budget left after the polling delay", async () => {
      const worstCaseFirstPassMs =
        Math.ceil(MAX_ALERTS_PER_TICK / SEND_CONCURRENCY) * PROVIDER_TIMEOUT_MS;

      expect(worstCaseFirstPassMs).toBeLessThanOrEqual(DELIVERY_BOUND_MS - POLL_INTERVAL_MS);
      expect(worstCaseFirstPassMs).toBeLessThanOrEqual(TICK_BUDGET_MS);
      expect(MAX_ALERTS_PER_TICK).toBeGreaterThanOrEqual(SEND_CONCURRENCY);
      expect(ALERT_POLLER_CONNECTIONS).toBeGreaterThan(SEND_CONCURRENCY);
    });

    it("delivers more than one pass worth without waiting an interval", async () => {
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
        await poller.stop();
      }

      expect(Date.now() - startedAt).toBeLessThan(POLL_INTERVAL_MS);
      expect(provider.delivered.length).toBe(overflow);
    }, 30_000);

    it("reports an empty scan as drained, so the rescan cannot spin", async () => {
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
      expect(warning?.payload.controlling_apply_by).toBe(dayFromToday(20));
    });

    it("keeps one provider identity when a review rewrites a pending alert's copy", async () => {
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

      await pool.query("UPDATE alerts SET status = 'pending', sent_at = NULL WHERE id = $1", [
        before?.id,
      ]);
      await pool.query(
        `UPDATE alerts SET payload = payload || '{"subject":"moved","body":"file by a new date"}'::jsonb
          WHERE id = $1`,
        [before?.id],
      );

      await poller.tick();

      expect(provider.attempts).toHaveLength(2);
      expect(provider.attempts[1]?.idempotencyKey).toBe(firstKey);
      expect(provider.delivered).toHaveLength(1);
    });

    it("gives a revived alert a fresh send_at rather than its pre-cancellation one", async () => {
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
          "UPDATE alerts SET send_at = clock_timestamp() - interval '9 days' WHERE id = $1",
          [unlock?.id],
        );
        const stale = (await alertsOf(eventId)).find((row) => row.id === unlock?.id);

        const ungated = await insertDuePlan(eventId, {
          latestApplyDate: dayFromToday(30),
          reuseChecklistItemId: gated.checklistItemId,
        });
        await schedulerWith()(client, eventId, ungated.planId, contacts);
        expect((await alertsOf(eventId)).find((row) => row.id === unlock?.id)?.status).toBe(
          "cancelled",
        );

        const regated = await insertDuePlan(eventId, {
          latestApplyDate: dayFromToday(30),
          applyAfterDate: dayFromToday(21),
          reuseChecklistItemId: gated.checklistItemId,
        });
        await schedulerWith()(client, eventId, regated.planId, contacts);

        const revived = (await alertsOf(eventId)).find((row) => row.id === unlock?.id);
        expect(revived?.status).toBe("pending");
        expect(revived?.send_at.getTime()).not.toBe(stale?.send_at.getTime());
        expect(Date.now() - (revived?.send_at.getTime() ?? 0)).toBeLessThan(DELIVERY_BOUND_MS);
      } finally {
        client.release();
      }
    });

    it("keeps a slack warning's send_at and backoff across a review", async () => {
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

        const ungated = await insertDuePlan(eventId, {
          latestApplyDate: dayFromToday(30),
          reuseChecklistItemId: gated.checklistItemId,
        });
        await schedulerWith()(client, eventId, ungated.planId, contacts);
        expect((await alertsOf(eventId)).find((row) => row.id === unlock?.id)?.status).toBe(
          "cancelled",
        );

        const regated = await insertDuePlan(eventId, {
          latestApplyDate: dayFromToday(30),
          applyAfterDate: dayFromToday(21),
          reuseChecklistItemId: gated.checklistItemId,
        });
        await schedulerWith()(client, eventId, regated.planId, contacts);

        const revived = (await alertsOf(eventId)).find((row) => row.id === unlock?.id);
        expect(revived?.status).toBe("pending");
        expect(revived?.payload.last_error).toBeUndefined();
        expect(revived?.payload.subject).toBeDefined();
      } finally {
        client.release();
      }
    });

    it("keeps the failure reason on a failed row the review did not withdraw", async () => {
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
          `UPDATE alerts SET status = 'failed', failure_count = 3,
                             next_attempt_at = clock_timestamp() + interval '15 minutes'
            WHERE id = $1`,
          [unlock?.id],
        );

        const ungated = await insertDuePlan(eventId, {
          latestApplyDate: dayFromToday(30),
          reuseChecklistItemId: gated.checklistItemId,
        });
        await schedulerWith()(client, eventId, ungated.planId, contacts);
        expect((await alertsOf(eventId)).find((row) => row.id === unlock?.id)?.status).toBe(
          "cancelled",
        );

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

        const second = await insertDuePlan(eventId, {
          latestApplyDate: dayFromToday(20),
          reuseChecklistItemId: first.checklistItemId,
        });
        await schedulerWith()(client, eventId, second.planId, contacts);

        const moved = (await alertsOf(eventId)).find((row) => row.id === before?.id);
        expect(moved?.send_at.getTime()).not.toBe(before?.send_at.getTime());
        expect(moved?.next_attempt_at).toBeNull();
        expect(moved?.failure_count).toBe(3);
      } finally {
        client.release();
      }
    });

    it("keeps a backoff when the review changes nothing about the schedule", async () => {
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

      const sms = (await alertsOf(eventId)).find((row) => row.channel === "sms");
      expect(sms?.status).toBe("sent");
    });

    it("does not deliver a filing date that expired while the queue was draining", async () => {
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

      expect(provider.attempts).toHaveLength(0);
      expect((await alertsOf(eventId))[0]?.status).toBe("cancelled");
    });

    it("retires a held alert whose filing window has since shut", async () => {
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

      expect(provider.attempts).toHaveLength(0);
      expect((await alertsOf(eventId))[0]?.status).toBe("cancelled");
      expect(summary.heldForReconciliation).toBe(0);
      expect(await reconciliationHolds(pool, eventId, ruleset.jurisdiction)).toEqual([]);
    });

    it("does not tell the organizer to chase a provider about a row the next tick retires", async () => {
      const eventId = await createEvent(scenario("C"));
      await schedulePastDue(eventId, [reminderOffsets[0] ?? 7]);
      const [row] = await alertsOf(eventId);
      const alertId = row?.id ?? "";
      await moveFilingDateOut(alertId, 6);
      await pool.query(
        `INSERT INTO alert_send_attempts (alert_id, idempotency_key, attempted_at)
         VALUES ($1, $2, current_timestamp - ($3 || ' hours')::interval)`,
        [alertId, alertId, PROVIDER_DEDUP_WINDOW_HOURS + 1],
      );

      expect(await reconciliationHolds(pool, eventId, ruleset.jurisdiction)).toEqual([
        { channel: "email", heldCount: 1 },
      ]);

      await pool.query(
        `UPDATE permit_plan_items SET latest_apply_date = current_date - 5
          WHERE id IN (SELECT plan_item_id FROM checklist_items WHERE id = $1)`,
        [row?.checklist_item_id],
      );

      expect(await reconciliationHolds(pool, eventId, ruleset.jurisdiction)).toEqual([]);
      expect(await failedDeliveries(pool, eventId, ruleset.jurisdiction)).toEqual([]);
    });

    it("keeps a backoff when the same checklist is submitted twice", async () => {
      const eventId = await createEvent(scenario("C"));
      const contacts = { email: "dead@example.test", phone: null };
      const { planId } = await insertDuePlan(eventId, { latestApplyDate: dayFromToday(0) });
      const client = await pool.connect();
      try {
        await schedulerWith()(client, eventId, planId, contacts);
        const [before] = await alertsOf(eventId);
        expect(before?.send_at.getTime()).toBeLessThanOrEqual(Date.now());
        await pool.query(
          `UPDATE alerts SET status = 'failed', failure_count = 3,
                             next_attempt_at = clock_timestamp() + interval '15 minutes'
            WHERE id = $1`,
          [before?.id],
        );
        await new Promise((resolve) => setTimeout(resolve, 25));

        await schedulerWith()(client, eventId, planId, contacts);

        const after = (await alertsOf(eventId)).find((row) => row.id === before?.id);
        expect(after?.send_at.getTime()).toBe(before?.send_at.getTime());
        expect(after?.next_attempt_at).not.toBeNull();
        expect(after?.failure_count).toBe(3);
      } finally {
        client.release();
      }
    });

    it("keeps the failure reason when an unchanged review recomputes the copy", async () => {
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
        expect(after?.payload.subject).toBeDefined();
      } finally {
        client.release();
      }
    });

    it("counts an alert whose transaction threw as work it did not reach", async () => {
      const eventId = await createEvent(scenario("C"));
      await schedulePastDue(eventId, [reminderOffsets[0] ?? 7]);
      const provider = fakeProvider();

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
      const eventId = await createEvent(scenario("C"));
      await pool.query(
        `INSERT INTO alerts (id, event_id, alert_type, channel, recipient, idempotency_key,
                             send_at, status, failure_count, payload)
         SELECT gen_random_uuid(), $1, 'slack_warning', 'email', 'dead@example.test',
                $2 || ':old:' || step, current_timestamp - interval '30 minutes', 'failed', 1,
                '{"subject":"s","body":"b"}'::jsonb
           FROM generate_series(1, 30) AS step`,
        [eventId, `${eventId}`],
      );
      await pool.query(
        `INSERT INTO alerts (id, event_id, alert_type, channel, recipient, idempotency_key,
                             send_at, status, payload)
         SELECT gen_random_uuid(), $1, 'slack_warning', 'sms', '+15550000000',
                $2 || ':sms:' || step, current_timestamp - interval '20 minutes', 'pending',
                '{"subject":"s","body":"b"}'::jsonb
           FROM generate_series(1, $3) AS step`,
        [eventId, `${eventId}`, MAX_ALERTS_PER_TICK],
      );
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

      expect(provider.delivered.some((sent) => sent.recipient === "organizer@example.test")).toBe(
        true,
      );
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

      await poller.tick();
      await poller.tick();

      const outage = await alertsOf(eventId);
      expect(outage.every((row) => row.status === "failed")).toBe(true);
      expect(outage.every((row) => row.failure_count === 2)).toBe(true);

      await poller.tick();
      expect((await alertsOf(eventId)).every((row) => row.failure_count === 2)).toBe(true);

      await pool.query("UPDATE alerts SET next_attempt_at = NULL WHERE event_id = $1", [eventId]);
      provider.fail = null;
      await poller.tick();
      expect((await alertsOf(eventId)).every((row) => row.status === "sent")).toBe(true);
    });
  });
});

describe("the day an alert is sent on", () => {
  it("sends in the jurisdiction's morning rather than at UTC midnight", () => {
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

describe("F-203 delivery channels (AC 5)", () => {
  const message: AlertMessage = {
    recipient: "organizer@example.test",
    subject: "File your Special Event Permit by 2026-08-26",
    body: "…",
    idempotencyKey: "event:item:deadline_reminder:email:2026-08-19",
  };

  it.runIf(databaseUrl !== "")("gives the due-alert scan a partial index to walk", async () => {
    const pool = new Pool({ connectionString: databaseUrl });
    try {
      const { rows } = await pool.query<{ indexdef: string }>(
        "SELECT indexdef FROM pg_indexes WHERE tablename = 'alerts' AND indexname = $1",
        ["alerts_due_queue_idx"],
      );
      const definition = rows[0]?.indexdef ?? "";
      expect(definition).toContain("failure_count");
      expect(definition).toContain("send_at");
      expect(definition).toContain("WHERE");
      expect(definition).toMatch(/pending/);
      expect(definition).toMatch(/failed/);
    } finally {
      await pool.end();
    }
  });

  it("releases the response body on both the accepted and the rejected path", async () => {
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

    const error = await sender(message).catch((thrown: unknown) => thrown);
    expect(error).toBeInstanceOf(AlertDeliveryError);
    expect((error as AlertDeliveryError).outcomeObserved).toBe(true);
    expect((error as Error).message).toContain("422");
  });

  it("resolves the attempt for every failure proven to precede the handoff", async () => {
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

  it("resolves the attempt for every certificate-verification verdict Node can report", async () => {
    const verificationCodes = [
      "UNABLE_TO_GET_ISSUER_CERT",
      "UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
      "UNABLE_TO_GET_CRL",
      "UNABLE_TO_DECRYPT_CERT_SIGNATURE",
      "UNABLE_TO_DECRYPT_CRL_SIGNATURE",
      "UNABLE_TO_DECODE_ISSUER_PUBLIC_KEY",
      "CERT_SIGNATURE_FAILURE",
      "CRL_SIGNATURE_FAILURE",
      "CERT_NOT_YET_VALID",
      "CERT_HAS_EXPIRED",
      "CRL_NOT_YET_VALID",
      "CRL_HAS_EXPIRED",
      "ERROR_IN_CERT_NOT_BEFORE_FIELD",
      "ERROR_IN_CERT_NOT_AFTER_FIELD",
      "ERROR_IN_CRL_LAST_UPDATE_FIELD",
      "ERROR_IN_CRL_NEXT_UPDATE_FIELD",
      "OUT_OF_MEM",
      "DEPTH_ZERO_SELF_SIGNED_CERT",
      "SELF_SIGNED_CERT_IN_CHAIN",
      "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
      "CERT_CHAIN_TOO_LONG",
      "CERT_REVOKED",
      "INVALID_CA",
      "PATH_LENGTH_EXCEEDED",
      "INVALID_PURPOSE",
      "CERT_UNTRUSTED",
      "CERT_REJECTED",
      "HOSTNAME_MISMATCH",
    ];

    const senderFor = (code: string) =>
      createResendEmailSender({
        apiKey: "re_test",
        from: "PopEngine <noreply@example.test>",
        fetch: (async () => {
          const cause = Object.assign(new Error("certificate verification failed"), { code });
          throw Object.assign(new TypeError("fetch failed"), { cause });
        }) as unknown as typeof globalThis.fetch,
      });

    for (const code of verificationCodes) {
      const error = await senderFor(code)
        .call(null, message)
        .catch((thrown: unknown) => thrown);
      expect((error as AlertDeliveryError).outcomeObserved, code).toBe(true);
    }

    const unspecified = await senderFor("UNSPECIFIED")
      .call(null, message)
      .catch((thrown: unknown) => thrown);
    expect(
      (unspecified as AlertDeliveryError).outcomeObserved,
      "UNSPECIFIED stays unresolved",
    ).toBe(false);
  });

  it("resolves the attempt when the connection attempt itself timed out", async () => {
    const sender = createResendEmailSender({
      apiKey: "re_test",
      from: "PopEngine <noreply@example.test>",
      fetch: (async () => {
        const cause = Object.assign(
          new Error("Connect Timeout Error (attempted address: 192.0.2.1:443, timeout: 10000ms)"),
          { name: "ConnectTimeoutError", code: "UND_ERR_CONNECT_TIMEOUT" },
        );
        throw Object.assign(new TypeError("fetch failed"), { cause });
      }) as unknown as typeof globalThis.fetch,
    });

    const error = await sender(message).catch((thrown: unknown) => thrown);
    expect(error).toBeInstanceOf(AlertDeliveryError);
    expect((error as AlertDeliveryError).outcomeObserved).toBe(true);
  });

  it("reads every address a dual-stack connect tried, not just the first", async () => {
    const aggregate = (codes: readonly string[]) => {
      const errors = codes.map((code) =>
        Object.assign(new Error(`connect ${code} 203.0.113.7:443`), { code }),
      );
      const combined = Object.assign(new AggregateError(errors), { code: errors[0]?.code });
      return Object.assign(new TypeError("fetch failed"), { cause: combined });
    };
    const senderFor = (codes: readonly string[]) =>
      createResendEmailSender({
        apiKey: "re_test",
        from: "PopEngine <noreply@example.test>",
        fetch: (async () => {
          throw aggregate(codes);
        }) as unknown as typeof globalThis.fetch,
      });
    const observed = async (codes: readonly string[]) =>
      (
        (await senderFor(codes)
          .call(null, message)
          .catch((thrown: unknown) => thrown)) as AlertDeliveryError
      ).outcomeObserved;

    expect(await observed(["ECONNREFUSED", "ECONNREFUSED"]), "all refused").toBe(true);
    expect(await observed(["ENETUNREACH", "ECONNREFUSED"]), "all proven, mixed codes").toBe(true);
    expect(await observed(["ECONNREFUSED", "ECONNRESET"]), "one unproven attempt").toBe(false);
  });

  it("resolves the attempt when an address inside the connect aggregate timed out", async () => {
    const connectAggregate = (codes: readonly string[]) => {
      const errors = codes.map((code) =>
        Object.assign(new Error(`connect ${code} 203.0.113.7:443`), {
          code,
          syscall: "connect",
        }),
      );
      const combined = Object.assign(new AggregateError(errors), { code: errors[0]?.code });
      return Object.assign(new TypeError("fetch failed"), { cause: combined });
    };
    const observed = async (thrown: unknown) =>
      (
        (await createResendEmailSender({
          apiKey: "re_test",
          from: "PopEngine <noreply@example.test>",
          fetch: (async () => {
            throw thrown;
          }) as unknown as typeof globalThis.fetch,
        })
          .call(null, message)
          .catch((error: unknown) => error)) as AlertDeliveryError
      ).outcomeObserved;

    expect(await observed(connectAggregate(["ETIMEDOUT"])), "the only address timed out").toBe(
      true,
    );
    expect(
      await observed(connectAggregate(["ETIMEDOUT", "ETIMEDOUT"])),
      "every address timed out",
    ).toBe(true);
    expect(
      await observed(connectAggregate(["ECONNREFUSED", "ETIMEDOUT"])),
      "one refused, one timed out, both before any byte",
    ).toBe(true);
    expect(
      await observed(
        Object.assign(new TypeError("fetch failed"), {
          cause: Object.assign(new Error("read ETIMEDOUT"), { code: "ETIMEDOUT" }),
        }),
      ),
      "ETIMEDOUT outside the aggregate stays unresolved",
    ).toBe(false);
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
    expect((error as Error).message).not.toContain("organizer@example.test");
  });

  it("abandons a provider that accepts the connection and never answers", async () => {
    const sender = createResendEmailSender({
      apiKey: "re_test",
      from: "PopEngine <noreply@example.test>",
      timeoutMs: 25,
      fetch: ((_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
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

  const transportFailure = (code: string, detail: string) =>
    (async () => {
      throw new TypeError("fetch failed", {
        cause: Object.assign(new Error(detail), { code }),
      });
    }) as unknown as typeof globalThis.fetch;

  it("leaves a connection that died mid-request unresolved rather than calling it an outage", async () => {
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

    const configured = sendersFromEnv({ RESEND_API_KEY: "re_test", SMTP_FROM: "a@b.test" });
    expect(configured.email).not.toBe(unconfigured.email);
    expect((await configured.sms(message)).simulated).toBe(true);
  });
});
