// F-202 API surface against a real schema: materialization, status and notes, uploads, signed
// download urls, and what a rescope does to an existing checklist. Runs only when a database is
// configured, matching the other schema-backed suites (CI applies `migrate up` first).
//
// Object storage is a fake implementing the same `DocumentStorage` seam the S3 adapter does, so
// nothing here needs a bucket or a network. The adapter itself is tested in `storage.test.ts`.

import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { request as httpRequest } from "node:http";
import type { AddressInfo } from "node:net";
import type { Readable } from "node:stream";
import type { Express } from "express";
import { DatabaseError, Pool } from "pg";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  CHECKLIST_STATUSES,
  parseEngineRuleset,
  parseIntakeContract,
  type EngineRuleset,
  type HolidayCalendar,
  type IntakeContract,
} from "@pop-engine/engine";
import {
  FIXTURE_TODAY,
  SCENARIO_INTAKE_FIXTURES,
  fixtureSubmission,
} from "@pop-engine/engine/fixtures";
import { createAlertScheduler, type AlertScheduler } from "./alerts";
import { createApp } from "./app";
import { createPlanService } from "./plan";
import { deadlineReminderOffsets, loadRuleset, rulesFilePath } from "./ruleset";
import { attachmentDisposition, DocumentStorageError, type DocumentStorage } from "./storage";

const databaseUrl = process.env.DATABASE_URL ?? "";

/** The smallest byte sequences each accepted format is required to start with. */
const PDF = Buffer.concat([Buffer.from("%PDF-1.7"), Buffer.alloc(64, 0x20)]);
const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(64, 0),
]);

type StoredObject = {
  body: Buffer;
  contentType: string;
  sizeBytes: number;
  /** Whether the route handed over a stream rather than a fully-read buffer. */
  receivedStream: boolean;
};
type FakeStorage = DocumentStorage & { objects: Map<string, StoredObject> };

/** Drains the stream the route hands over, which is also how a real adapter consumes it. */
const collect = async (body: Readable): Promise<Buffer> => {
  const chunks: Buffer[] = [];
  for await (const chunk of body) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
};

const fakeStorage = (): FakeStorage => {
  const objects = new Map<string, StoredObject>();
  return {
    objects,
    put: async (key, body, contentType, sizeBytes) => {
      const receivedStream = typeof (body as { pipe?: unknown }).pipe === "function";
      objects.set(key, { body: await collect(body), contentType, sizeBytes, receivedStream });
    },
    signedDownloadUrl: async (key, expiresInSeconds, filename) =>
      `https://storage.test/${key}?X-Amz-Expires=${expiresInSeconds}` +
      `&response-content-disposition=${encodeURIComponent(attachmentDisposition(filename))}`,
    remove: async (key) => {
      objects.delete(key);
    },
  };
};

const unreachableStorage = (): DocumentStorage => ({
  put: async () => {
    throw new DocumentStorageError("document storage is unavailable");
  },
  signedDownloadUrl: async () => {
    throw new DocumentStorageError("document storage is unavailable");
  },
  remove: async () => {
    throw new DocumentStorageError("document storage is unavailable");
  },
});

const scenario = (id: string): Record<string, unknown> => {
  const fixture = SCENARIO_INTAKE_FIXTURES.find((candidate) => candidate.scenario === id);
  if (fixture === undefined) throw new Error(`no fixture ${id}`);
  return fixtureSubmission(fixture);
};

type ChecklistItemView = {
  id: string;
  planItemId: string;
  ruleIds: string[];
  status: string;
  notes: string | null;
  struckThrough: boolean;
  deadlineNotice: {
    dateChange: { kind: string; previous?: string; current?: string } | null;
    previousProvenance: {
      rulesetVersion: string;
      verificationStatus?: string;
      sources?: unknown[];
      sourceUrl?: string | null;
      conflictText?: string | null;
      snapshotDate?: string;
    };
    rulesetVersionsDiffer?: boolean;
  } | null;
  latestApplyDate: string | null;
  applyAfterDate: string | null;
  agency: string | null;
  permitName: string | null;
  userSummary: { heading: string } | null;
  kind: string;
  verificationStatus: string;
  lastVerifiedDate: string | null;
  deadlineStatus: string;
  portalUrl: string | null;
  publishedNotes: string[];
  noteText: string | null;
  conflictText: string | null;
  deadlineDisplay: string | null;
  sources: { ruleId: string; citation: string; urls: string[] }[];
  sourcePlan: { rulesetVersion: string; snapshotDate: string | null };
  documents: { id: string; filename: string; contentType: string; sizeBytes: number }[];
};

const ruleIdsOf = (items: ChecklistItemView[]): string[][] => items.map((item) => item.ruleIds);

/**
 * A POST with no `Content-Length`. Node falls back to chunked encoding when the length is not
 * declared, which supertest will not do — and a chunked body is exactly what the route refuses,
 * because sizing it would mean holding all of it.
 */
const chunkedUpload = (app: Express, path: string, body: Buffer): Promise<number> =>
  new Promise((resolve, reject) => {
    const server = app.listen(0, () => {
      const { port } = server.address() as AddressInfo;
      const outgoing = httpRequest(
        {
          host: "127.0.0.1",
          port,
          path,
          method: "POST",
          headers: { "content-type": "application/pdf" },
        },
        (response) => {
          response.resume();
          response.once("end", () => server.close(() => resolve(response.statusCode ?? 0)));
        },
      );
      outgoing.once("error", (error) => server.close(() => reject(error)));
      outgoing.write(body);
      outgoing.end();
    });
  });

describe.runIf(databaseUrl.length > 0)("F-202 compliance checklist", () => {
  let pool: Pool;
  let ruleset: EngineRuleset;
  let intakeContract: IntakeContract;
  /** `config.alert_offsets.deadline_reminder.days_before`, read from the artifact (F-203). */
  let reminderOffsets: number[] = [];
  const createdEventIds: string[] = [];

  // The answer key's scenarios are dated against its own clock, and the fixture windows carry no
  // contested holidays (AD-11), so the calendar is injected rather than the guard relaxed.
  const fixtureCalendar = (calendarId: string): HolidayCalendar => ({
    id: calendarId,
    holidays: [],
  });

  /** F-203 runs inside materialization; its clock is pinned to the fixture suite's date. */
  const scheduleAlerts: AlertScheduler = (...args) =>
    createAlertScheduler({
      reminderDaysBefore: reminderOffsets,
      slackWarningDays: ruleset.slackWarningDays,
      jurisdiction: ruleset.jurisdiction,
      now: () => new Date(`${FIXTURE_TODAY}T13:00:00Z`),
    })(...args);

  const appWith = (storage: DocumentStorage) =>
    createApp({
      database: pool,
      intakeContract,
      today: () => FIXTURE_TODAY,
      planService: createPlanService(pool, ruleset, fixtureCalendar, () => FIXTURE_TODAY),
      checklist: { database: pool, storage, scheduleAlerts, jurisdiction: ruleset.jurisdiction },
    });

  /** An event created through the intake endpoint, so it is exactly what F-101 would store. */
  const createEvent = async (submission: Record<string, unknown>): Promise<string> => {
    const response = await request(appWith(fakeStorage())).post("/api/events").send(submission);
    expect(response.status).toBe(201);
    const eventId = response.body.event.id as string;
    createdEventIds.push(eventId);
    return eventId;
  };

  const generatePlan = async (eventId: string): Promise<void> => {
    const response = await request(appWith(fakeStorage())).post(`/api/events/${eventId}/plan`);
    expect(response.status).toBe(201);
  };

  /**
   * Press review the way the page does: naming the plan the caller is currently being shown.
   *
   * The endpoint requires that id and refuses to choose one itself, because the acknowledgement it
   * writes is the record that the organizer reviewed THAT plan. Reading it off a GET first is
   * exactly what the browser does — it renders from a GET and hands back the id it rendered — so
   * these tests exercise the same two-step the real client performs rather than a shortcut only
   * the tests can take. A test that wants to review a DIFFERENT plan passes `planId` explicitly,
   * which is the stale-tab case.
   */
  const review = async (
    api: Express,
    eventId: string,
    planId?: string,
    contacts: { contactEmail?: string; contactPhone?: string } = {},
  ) => {
    const shown =
      planId ??
      ((await request(api).get(`/api/events/${eventId}/checklist`)).body.planId as string);
    return request(api)
      .post(`/api/events/${eventId}/checklist`)
      .send({ planId: shown, ...contacts });
  };

  /** The published name of a rule, so a hand-built plan item states no permit fact of its own. */
  const publishedName = (ruleId: string): string | null => {
    const rule = ruleset.rules.find((candidate) => candidate.id === ruleId);
    if (rule === undefined) throw new Error(`no published rule ${ruleId}`);
    return rule.name;
  };

  /**
   * A plan written directly, for shapes the six approved scenarios do not produce: a plan with no
   * trackable line, and a dedupe-merged line carrying two rule ids. `generatedAt` is explicit so
   * "the latest plan" is decided by the test rather than by insert timing.
   *
   * The finding renderings are written empty. These plans exist to exercise item identity, not
   * published text, and inventing notes for a real rule id would be worse than carrying none;
   * the rendering path is covered against engine-generated plans instead.
   */
  const insertPlan = async (
    eventId: string,
    items: readonly { ruleIds: string[]; kind: string; latestApplyDate?: string }[],
    generatedAt: string,
    eventRevision = 1,
    sourcePlan = {
      rulesetVersion: ruleset.rulesetVersion,
      snapshotDate: ruleset.snapshotDate,
    },
  ): Promise<string> => {
    const planId = randomUUID();
    await pool.query(
      `INSERT INTO permit_plans
         (id, event_id, event_revision, ruleset_version, snapshot_date, verdict, verdict_detail,
          intake_snapshot, generated_at)
       VALUES ($1, $2, $5, $3, $7, 'conditional', $6::jsonb, '{}'::jsonb, $4)`,
      [
        planId,
        eventId,
        sourcePlan.rulesetVersion,
        generatedAt,
        eventRevision,
        JSON.stringify({
          finding_renderings: items.map((item) => ({
            rule_ids: item.ruleIds,
            notes: [],
            note_text: null,
            conflict_text: null,
            deadline_display: null,
            slack_days: null,
            deadline_unknown_fields: [],
            timeline_unresolved_reason: null,
            portal_instructions: null,
          })),
        }),
        sourcePlan.snapshotDate,
      ],
    );
    for (const item of items) {
      await pool.query(
        `INSERT INTO permit_plan_items
           (id, plan_id, rule_ids, triggered_by, sources, kind, disposition, deadline_status,
            verification_status, permit_name, latest_apply_date)
         VALUES ($1, $2, $3, '[]'::jsonb, '[]'::jsonb, $4, $5, 'not_applicable',
                 'SOURCE_CONFIRMED', $6, $7)`,
        [
          randomUUID(),
          planId,
          item.ruleIds,
          item.kind,
          item.kind === "advisory" ? "advisory" : "required",
          publishedName(item.ruleIds[0] as string),
          item.latestApplyDate ?? null,
        ],
      );
    }
    return planId;
  };

  /**
   * The real pool, with `query` intercepted. Returning a promise from `intercept` replaces the
   * query; returning null lets it through. Used to stage the failures a document upload has to
   * survive without lying about what it stored.
   */
  const poolIntercepting = (
    intercept: (text: string, values: readonly unknown[]) => Promise<never> | null,
  ): Pool => {
    const proxy = Object.create(pool) as Pool;
    proxy.query = ((text: string, values?: unknown[]) => {
      const replaced = typeof text === "string" ? intercept(text, values ?? []) : null;
      return replaced ?? pool.query(text as never, values as never);
    }) as Pool["query"];
    return proxy;
  };

  /** An upload driven against a checklist item, with the database staged by the caller. */
  const uploadWith = (database: Pool, storage: DocumentStorage, checklistItemId: string) =>
    request(
      createApp({
        database: pool,
        intakeContract,
        today: () => FIXTURE_TODAY,
        checklist: { database, storage, scheduleAlerts, jurisdiction: ruleset.jurisdiction },
      }),
    )
      .post(`/api/checklist-items/${checklistItemId}/documents`)
      .set("Content-Type", "application/pdf")
      .send(PDF);

  /** A scenario event with its plan and checklist already materialized. */
  const checklistFor = async (
    scenarioId: string,
    storage: DocumentStorage = fakeStorage(),
  ): Promise<{
    eventId: string;
    body: { items: ChecklistItemView[] } & Record<string, unknown>;
  }> => {
    const eventId = await createEvent(scenario(scenarioId));
    await generatePlan(eventId);
    const response = await review(appWith(storage), eventId);
    expect(response.status).toBe(201);
    return { eventId, body: response.body };
  };

  beforeAll(async () => {
    pool = new Pool({ connectionString: databaseUrl });
    ruleset = parseEngineRuleset(JSON.parse(await readFile(rulesFilePath(), "utf8")));
    const published = await loadRuleset();
    intakeContract = parseIntakeContract(published.document);
    reminderOffsets = deadlineReminderOffsets(published);
  });

  afterAll(async () => {
    if (createdEventIds.length > 0) {
      // Before the checklist items they hang off: F-203 alerts reference both (migration 001).
      await pool.query("DELETE FROM alerts WHERE event_id = ANY($1)", [createdEventIds]);
      // Before the events they key on: contacts are event-scoped (migration 009).
      await pool.query("DELETE FROM event_alert_contacts WHERE event_id = ANY($1)", [
        createdEventIds,
      ]);
      await pool.query(
        `DELETE FROM documents WHERE checklist_item_id IN (
           SELECT checklist.id FROM checklist_items AS checklist
             JOIN permit_plan_items AS item ON item.id = checklist.plan_item_id
             JOIN permit_plans AS plan ON plan.id = item.plan_id
            WHERE plan.event_id = ANY($1))`,
        [createdEventIds],
      );
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
      // Before the plans it references: the acknowledgement's composite FK is what stops one
      // event's checklist naming another event's plan, and it holds here too.
      await pool.query("DELETE FROM checklist_acknowledgements WHERE event_id = ANY($1)", [
        createdEventIds,
      ]);
      await pool.query("DELETE FROM permit_plans WHERE event_id = ANY($1)", [createdEventIds]);
      await pool.query("DELETE FROM events WHERE id = ANY($1)", [createdEventIds]);
    }
    await pool.end();
  });

  describe("materializing a checklist from the latest plan (AC 1, AC 5)", () => {
    it("tracks every permit and insurance line and leaves other kinds as read-only context", async () => {
      const { body } = await checklistFor("A");
      const items = body.items;

      // Scenario A's permit and insurance findings, soonest published filing date first. Four
      // since nyc.v2.5: FDNY-GENERATOR-001 was here because an unanswered battery question made
      // its trigger unknown, and Scenario A has neither a generator nor a battery. The approved
      // answer key never listed it for A, so this list now matches the key it is derived from.
      expect(ruleIdsOf(items)).toEqual([
        ["SAPO-STREET-LARGE-001"],
        ["NYPD-SOUND-001"],
        ["DOHMH-VENDOR-PERMIT-001"],
        ["SAPO-INSURANCE-001"],
      ]);
      expect(items.every((item) => ["permit", "insurance"].includes(item.kind))).toBe(true);
      // Notification and named-confirmation lines are real context, not trackable tasks.
      expect((body.contextItems as { ruleIds: string[] }[]).map((item) => item.ruleIds)).toEqual([
        ["DOHMH-ORGANIZER-NOTIFY-001"],
        ["CONF-NO-ALCOHOL-001"],
        ["CONF-NO-BATTERY-001"],
        ["CONF-NO-FLAME-001"],
        ["CONF-NO-GENERATOR-001"],
        ["CONF-NO-STRUCTURE-001"],
      ]);
    });

    it("keeps each item linked to its plan item, so rule, agency, deadline and portal travel with it", async () => {
      const { body } = await checklistFor("A");
      const [blocking] = body.items;

      expect(blocking?.planItemId).toMatch(/^[0-9a-f-]{36}$/);
      expect(blocking?.agency).toBe("SAPO (Mayor's Office CECM)");
      expect(blocking?.userSummary?.heading).toBe(
        ruleset.rules.find((rule) => rule.id === "SAPO-STREET-LARGE-001")?.userSummary?.heading,
      );
      // Spec AC 5: the deadline context lives where the work happens.
      expect(blocking?.latestApplyDate).toBe("2026-07-12");
      expect(blocking?.verificationStatus).toBe("SOURCE_CONFIRMED");
      expect(blocking?.lastVerifiedDate).toBeNull();
      expect(blocking?.sourcePlan).toEqual({
        rulesetVersion: ruleset.rulesetVersion,
        snapshotDate: ruleset.snapshotDate,
      });
      expect(body.rulesetVersion).toBe(ruleset.rulesetVersion);
      expect(body.snapshotDate).toBe(ruleset.snapshotDate);
      expect(blocking?.portalUrl).not.toBeNull();
      expect(blocking?.status).toBe("not_started");

      const { rows } = await pool.query<{ plan_item_id: string }>(
        "SELECT plan_item_id FROM checklist_items WHERE id = $1",
        [blocking?.id],
      );
      expect(rows[0]?.plan_item_id).toBe(blocking?.planItemId);
    });

    it("attributes current and retained rows to the plan snapshot that supplies their context", async () => {
      const eventId = await createEvent(scenario("A"));
      const api = appWith(fakeStorage());
      await insertPlan(
        eventId,
        [
          { ruleIds: ["SAPO-STREET-LARGE-001"], kind: "permit" },
          { ruleIds: ["NYPD-SOUND-001"], kind: "permit" },
        ],
        "2026-07-22T10:00:00Z",
        1,
        { rulesetVersion: "test.v1", snapshotDate: "2026-07-20" },
      );
      await review(api, eventId);

      await insertPlan(
        eventId,
        [{ ruleIds: ["SAPO-STREET-LARGE-001"], kind: "permit" }],
        "2026-07-22T11:00:00Z",
        1,
        { rulesetVersion: "test.v2", snapshotDate: "2026-07-21" },
      );
      const read = await request(api).get(`/api/events/${eventId}/checklist`);
      const items = read.body.items as ChecklistItemView[];

      expect(read.body.rulesetVersion).toBe("test.v2");
      expect(read.body.snapshotDate).toBe("2026-07-21");
      expect(items.find((item) => item.ruleIds[0] === "SAPO-STREET-LARGE-001")?.sourcePlan).toEqual(
        { rulesetVersion: "test.v2", snapshotDate: "2026-07-21" },
      );
      expect(items.find((item) => item.ruleIds[0] === "NYPD-SOUND-001")?.sourcePlan).toEqual({
        rulesetVersion: "test.v1",
        snapshotDate: "2026-07-20",
      });
    });

    it("keeps a retained row's provenance with the dates it is actually showing", async () => {
      // The regression guard for F-206 Acceptance Criterion 4's mixed-checklist clause, which
      // distinguishes the two retained-row states explicitly: a dropped row is attributed to its
      // persisted plan item (asserted above), and a still-required row to the latest plan.
      //
      // A retained still-required row deliberately shows the LATEST plan's recalculated dates
      // before the organizer re-materializes (PRD principle 6; asserted on its own below).
      // Labelling those dates with the version and snapshot of a plan that did not produce them is
      // a pinned version beside data it never carried, which is what AC 4 forbids and what #93
      // fixed for the plan banner. So the three facts are asserted together: the row keeps its
      // persisted link, shows the new plan's date, and reports the new plan's provenance. Moving
      // `sourcePlan` alone to the persisted item fails here, as it should.
      //
      // This assertion was removed on #114 while F-202 AC 8 and F-206 read as contradicting each
      // other (SPEC-CONFLICT #115), because pinning either reading would have institutionalised the
      // losing side. The amendment resolved that in favour of what the code already did, so the
      // guard is back and cites the criterion rather than the issue.
      const eventId = await createEvent(scenario("A"));
      const api = appWith(fakeStorage());
      await insertPlan(
        eventId,
        [{ ruleIds: ["SAPO-STREET-LARGE-001"], kind: "permit", latestApplyDate: "2026-07-12" }],
        "2026-07-22T10:00:00Z",
        1,
        { rulesetVersion: "test.v1", snapshotDate: "2026-07-20" },
      );
      const created = await review(api, eventId);
      expect(created.status).toBe(201);
      const before = (created.body.items as ChecklistItemView[])[0];

      // Regenerated with the same requirement and a moved filing date, and NOT re-materialized.
      await insertPlan(
        eventId,
        [{ ruleIds: ["SAPO-STREET-LARGE-001"], kind: "permit", latestApplyDate: "2026-08-30" }],
        "2026-07-22T11:00:00Z",
        1,
        { rulesetVersion: "test.v2", snapshotDate: "2026-07-21" },
      );
      const read = await request(api).get(`/api/events/${eventId}/checklist`);
      const after = (read.body.items as ChecklistItemView[])[0];

      // Still the row the organizer has been working: same checklist item, same persisted link.
      expect(after?.id).toBe(before?.id);
      expect(after?.planItemId).toBe(before?.planItemId);
      expect(after?.struckThrough).toBe(false);
      // Showing the new plan's date...
      expect(after?.latestApplyDate).toBe("2026-08-30");
      // ...so it must say the new plan is where that date came from.
      expect(after?.sourcePlan).toEqual({ rulesetVersion: "test.v2", snapshotDate: "2026-07-21" });
      // F-202 AC 9: the previous date travels with the notice until a review re-points the row.
      expect(after?.deadlineNotice?.dateChange).toEqual({
        kind: "both",
        previous: "2026-07-12",
        current: "2026-08-30",
      });
      expect(after?.deadlineNotice?.previousProvenance.rulesetVersion).toBe("test.v1");
      expect(after?.deadlineNotice?.previousProvenance).toMatchObject({
        verificationStatus: "SOURCE_CONFIRMED",
        sources: [],
        sourceUrl: null,
        conflictText: null,
        snapshotDate: "2026-07-20",
      });
      expect(after?.deadlineNotice?.rulesetVersionsDiffer).toBe(true);
    });

    it("carries the apply_after date of a dependency-gated item (AC 5, Scenario C)", async () => {
      const { body } = await checklistFor("C");
      const gated = body.items.find((item) => item.ruleIds[0] === "NYPD-SOUND-001");

      expect(gated?.applyAfterDate).toBe("2026-08-12");
      expect(gated?.latestApplyDate).toBe("2026-09-11");
    });

    it("returns the existing checklist instead of duplicating it when called twice", async () => {
      const { eventId, body } = await checklistFor("A");

      const second = await review(appWith(fakeStorage()), eventId);

      expect(second.status).toBe(200);
      expect((second.body.items as ChecklistItemView[]).map((item) => item.id)).toEqual(
        body.items.map((item) => item.id),
      );
      expect(second.body.planChanged).toBe(false);
      const { rows } = await pool.query<{ count: string }>(
        `SELECT count(*) FROM checklist_items AS checklist
           JOIN permit_plan_items AS item ON item.id = checklist.plan_item_id
           JOIN permit_plans AS plan ON plan.id = item.plan_id
          WHERE plan.event_id = $1`,
        [eventId],
      );
      expect(Number(rows[0]?.count)).toBe(body.items.length);
    });

    it("serves the same checklist on GET, without materializing anything", async () => {
      const { eventId, body } = await checklistFor("A");

      const read = await request(appWith(fakeStorage())).get(`/api/events/${eventId}/checklist`);

      expect(read.status).toBe(200);
      expect(read.body.items).toEqual(body.items);
      expect(read.body.statusRollup).toEqual({
        not_started: body.items.length,
        in_progress: 0,
        submitted: 0,
        approved: 0,
        rejected: 0,
      });
    });

    it("offers an empty checklist for a plan with no permit or insurance line", async () => {
      // No approved scenario currently produces a plan without a permit line (SPEC-CONFLICT #92
      // covers the spec's stale claim that Scenario B does), so the case is built directly from
      // a published advisory rule rather than asserted of a scenario that does not have it.
      const eventId = await createEvent(scenario("B"));
      await insertPlan(
        eventId,
        [{ ruleIds: ["ADV-VENUE-OCCUPANCY-001"], kind: "advisory" }],
        "2026-07-22T10:00:00Z",
      );

      const response = await review(appWith(fakeStorage()), eventId);

      // Nothing was created, so the call is already idempotent on its first use.
      expect(response.status).toBe(200);
      expect(response.body.items).toEqual([]);
      expect(response.body.planChanged).toBe(false);
      expect(
        (response.body.contextItems as { ruleIds: string[] }[]).map((item) => item.ruleIds),
      ).toEqual([["ADV-VENUE-OCCUPANCY-001"]]);
    });
  });

  // A finding that shares a `dedupe_key` merges into one line carrying every contributing rule id
  // (engine `mergeFindings`). Today only DOB-TALL-STRUCTURE-001 publishes one, so no approved
  // scenario produces a merged line — but issue #89 is live on whether DOB-TENT-001 should carry
  // `dob-structure` too, and that change would turn two plan lines into one. These pin what the
  // checklist does about it, so the answer is not decided by accident by whoever edits the key.
  describe("requirement identity across plans", () => {
    const MERGED = ["DOB-TENT-001", "DOB-TALL-STRUCTURE-001"];

    it("matches a merged line whatever order the rule ids were written in", async () => {
      const eventId = await createEvent(scenario("A"));
      await insertPlan(eventId, [{ ruleIds: MERGED, kind: "permit" }], "2026-07-22T10:00:00Z");
      const api = appWith(fakeStorage());
      const first = await review(api, eventId);
      expect(first.status).toBe(201);

      // The same two rules, merged in the other order: the same requirement, not a new one.
      await insertPlan(
        eventId,
        [{ ruleIds: [...MERGED].reverse(), kind: "permit" }],
        "2026-07-22T11:00:00Z",
      );
      const second = await review(api, eventId);

      expect(second.status).toBe(200);
      expect(second.body.planChanged).toBe(false);
      const items = second.body.items as ChecklistItemView[];
      expect(items).toHaveLength(1);
      expect(items[0]?.id).toBe((first.body.items as ChecklistItemView[])[0]?.id);
      expect(items[0]?.struckThrough).toBe(false);
    });

    it("keeps and strikes a merged line when a later plan splits it, appending both new lines", async () => {
      const eventId = await createEvent(scenario("A"));
      await insertPlan(eventId, [{ ruleIds: MERGED, kind: "permit" }], "2026-07-22T10:00:00Z");
      const api = appWith(fakeStorage());
      const first = await review(api, eventId);
      const mergedItemId = (first.body.items as ChecklistItemView[])[0]?.id;
      await request(api)
        .patch(`/api/checklist-items/${mergedItemId}`)
        .send({ status: "submitted", notes: "one filing covered both" });

      // The dedupe key changes and the merged line becomes two.
      await insertPlan(
        eventId,
        MERGED.map((ruleId) => ({ ruleIds: [ruleId], kind: "permit" })),
        "2026-07-22T11:00:00Z",
      );
      const split = await review(api, eventId);

      expect(split.status).toBe(201);
      // Partial overlap is not a match, so "submitted" is not carried onto a line whose scope
      // just changed. This POST is the organizer accepting the new plan, so the prompt clears;
      // its rise and fall across every shape of regeneration is pinned below.
      expect(split.body.planChanged).toBe(false);
      const items = split.body.items as ChecklistItemView[];
      expect(items).toHaveLength(3);
      const [kept, ...appended] = items;
      expect(kept?.id).toBe(mergedItemId);
      expect(kept?.struckThrough).toBe(true);
      expect(kept?.status).toBe("submitted");
      expect(kept?.notes).toBe("one filing covered both");
      expect(appended.map((item) => item.ruleIds).sort()).toEqual(
        MERGED.map((ruleId) => [ruleId]).sort(),
      );
      expect(appended.every((item) => !item.struckThrough && item.status === "not_started")).toBe(
        true,
      );
    });

    it("strikes both tracked lines when a later plan merges them, and re-points neither", async () => {
      // `checklist_items.plan_item_id` is UNIQUE, and `materialize` re-points a tracked item at
      // the current plan's row. That is only safe because whole-set identity makes a match
      // strictly one-to-one: a merge is not a match, so two tracked items can never both claim
      // the one merged row. This test is what makes that load-bearing property fail loudly if
      // the identity rule is ever relaxed to partial overlap.
      const eventId = await createEvent(scenario("A"));
      await insertPlan(
        eventId,
        MERGED.map((ruleId) => ({ ruleIds: [ruleId], kind: "permit" })),
        "2026-07-22T10:00:00Z",
      );
      const api = appWith(fakeStorage());
      const separate = await review(api, eventId);
      const trackedIds = (separate.body.items as ChecklistItemView[]).map((item) => item.id);
      expect(trackedIds).toHaveLength(2);

      // The dedupe key changes and the two lines become one.
      await insertPlan(eventId, [{ ruleIds: MERGED, kind: "permit" }], "2026-07-22T11:00:00Z");
      const merged = await review(api, eventId);

      // No unique violation: the merged row is claimed by the new item, not fought over.
      expect(merged.status).toBe(201);
      const items = merged.body.items as ChecklistItemView[];
      expect(items).toHaveLength(3);
      const struck = items.filter((item) => trackedIds.includes(item.id));
      expect(struck).toHaveLength(2);
      expect(struck.every((item) => item.struckThrough)).toBe(true);
      // Neither was re-pointed: they still hold the rows of the plan that raised them.
      expect(struck.map((item) => item.planItemId).sort()).toEqual(
        (separate.body.items as ChecklistItemView[]).map((item) => item.planItemId).sort(),
      );
      expect(items.at(-1)?.ruleIds.slice().sort()).toEqual([...MERGED].sort());
      expect(items.at(-1)?.struckThrough).toBe(false);
      // Cleared by this POST: the merged row is now tracked and the two struck rows are history.
      expect(merged.body.planChanged).toBe(false);

      // And one checklist row per plan item, which is what the constraint exists to guarantee.
      const { rows } = await pool.query<{ count: string }>(
        `SELECT count(DISTINCT checklist.plan_item_id) FROM checklist_items AS checklist
           JOIN permit_plan_items AS item ON item.id = checklist.plan_item_id
           JOIN permit_plans AS plan ON plan.id = item.plan_id
          WHERE plan.event_id = $1`,
        [eventId],
      );
      expect(Number(rows[0]?.count)).toBe(3);
    });

    it("ends a task on a kind change and appends a new task when its identity returns", async () => {
      const storage = fakeStorage();
      const api = appWith(storage);
      const eventId = await createEvent(scenario("A"));
      const ruleIds = ["NYPD-SOUND-001"];
      await insertPlan(
        eventId,
        [{ ruleIds, kind: "permit", latestApplyDate: "2026-08-20" }],
        "2026-07-22T10:00:00Z",
        1,
        { rulesetVersion: "test.permit.v1", snapshotDate: "2026-07-20" },
      );
      const first = await review(api, eventId, undefined, {
        contactEmail: "organizer@example.test",
      });
      expect(first.status).toBe(201);
      const original = (first.body.items as ChecklistItemView[])[0] as ChecklistItemView;
      await request(api)
        .patch(`/api/checklist-items/${original.id}`)
        .send({ status: "approved", notes: "organizer evidence stays here" });
      const upload = await request(api)
        .post(`/api/checklist-items/${original.id}/documents`)
        .set("Content-Type", "application/pdf")
        .set("X-Filename", "permit-evidence.pdf")
        .send(PDF);
      expect(upload.status).toBe(201);

      await insertPlan(eventId, [{ ruleIds, kind: "insurance" }], "2026-07-22T11:00:00Z", 1, {
        rulesetVersion: "test.insurance.v2",
        snapshotDate: "2026-07-21",
      });
      expect(
        (
          await review(api, eventId, undefined, {
            contactEmail: "organizer@example.test",
          })
        ).status,
      ).toBe(201);

      await insertPlan(
        eventId,
        [{ ruleIds, kind: "permit", latestApplyDate: "2026-08-20" }],
        "2026-07-22T12:00:00Z",
        1,
        { rulesetVersion: "test.permit.v3", snapshotDate: "2026-07-22" },
      );
      const returned = await review(api, eventId, undefined, {
        contactEmail: "organizer@example.test",
      });

      expect(returned.status).toBe(201);
      const items = returned.body.items as ChecklistItemView[];
      expect(items.map((item) => item.kind)).toEqual(["permit", "insurance", "permit"]);
      const [endedPermit, endedInsurance, activePermit] = items as [
        ChecklistItemView,
        ChecklistItemView,
        ChecklistItemView,
      ];
      expect(endedPermit).toMatchObject({
        id: original.id,
        planItemId: original.planItemId,
        status: "approved",
        notes: "organizer evidence stays here",
        struckThrough: true,
        sourcePlan: { rulesetVersion: "test.permit.v1", snapshotDate: "2026-07-20" },
      });
      expect(endedPermit.documents).toEqual([
        expect.objectContaining({ filename: "permit-evidence.pdf" }),
      ]);
      expect(endedInsurance).toMatchObject({
        status: "not_started",
        struckThrough: true,
        sourcePlan: { rulesetVersion: "test.insurance.v2", snapshotDate: "2026-07-21" },
      });
      expect(activePermit).toMatchObject({
        status: "not_started",
        struckThrough: false,
        sourcePlan: { rulesetVersion: "test.permit.v3", snapshotDate: "2026-07-22" },
      });
      expect(activePermit.id).not.toBe(endedPermit.id);
      expect(new Set(items.map((item) => item.planItemId)).size).toBe(3);
      expect(returned.body.statusRollup).toMatchObject({ approved: 0, not_started: 1 });

      const { rows: alerts } = await pool.query<{
        checklist_item_id: string;
        status: string;
      }>(
        `SELECT checklist_item_id, status
           FROM alerts
          WHERE event_id = $1 AND alert_type = 'deadline_reminder'
          ORDER BY checklist_item_id, status`,
        [eventId],
      );
      expect(alerts.filter((alert) => alert.checklist_item_id === endedPermit.id)).toHaveLength(
        reminderOffsets.length,
      );
      expect(
        alerts
          .filter((alert) => alert.checklist_item_id === endedPermit.id)
          .every((alert) => alert.status === "cancelled"),
      ).toBe(true);
      expect(alerts.filter((alert) => alert.checklist_item_id === activePermit.id)).toHaveLength(
        reminderOffsets.length,
      );
      expect(
        alerts
          .filter((alert) => alert.checklist_item_id === activePermit.id)
          .every((alert) => alert.status === "pending"),
      ).toBe(true);
      expect(alerts.some((alert) => alert.checklist_item_id === endedInsurance.id)).toBe(false);
    });

    it("ends a task from an unreviewed intervening kind change", async () => {
      const api = appWith(fakeStorage());
      const eventId = await createEvent(scenario("A"));
      const ruleIds = ["NYPD-SOUND-001"];
      await insertPlan(eventId, [{ ruleIds, kind: "permit" }], "2026-07-22T10:00:00Z", 1, {
        rulesetVersion: "test.permit.v1",
        snapshotDate: "2026-07-20",
      });
      const first = await review(api, eventId);
      const original = (first.body.items as ChecklistItemView[])[0] as ChecklistItemView;

      await insertPlan(eventId, [{ ruleIds, kind: "insurance" }], "2026-07-22T11:00:00Z", 1, {
        rulesetVersion: "test.insurance.v2",
        snapshotDate: "2026-07-21",
      });
      await insertPlan(eventId, [{ ruleIds, kind: "permit" }], "2026-07-22T12:00:00Z", 1, {
        rulesetVersion: "test.permit.v3",
        snapshotDate: "2026-07-22",
      });
      const returned = await review(api, eventId);

      expect(returned.status).toBe(201);
      const items = returned.body.items as ChecklistItemView[];
      expect(items).toHaveLength(2);
      expect(items.map((item) => item.kind)).toEqual(["permit", "permit"]);
      expect(items[0]).toMatchObject({
        id: original.id,
        planItemId: original.planItemId,
        struckThrough: true,
        sourcePlan: { rulesetVersion: "test.permit.v1", snapshotDate: "2026-07-20" },
      });
      expect(items[1]).toMatchObject({
        struckThrough: false,
        sourcePlan: { rulesetVersion: "test.permit.v3", snapshotDate: "2026-07-22" },
      });
      expect(items[1]?.id).not.toBe(original.id);
    });
  });

  describe("status and notes (AC 2, AC 4)", () => {
    it("accepts every transition, including backwards, and never rejects one as illegal", async () => {
      const { body } = await checklistFor("A");
      const itemId = body.items[0]?.id;
      const api = appWith(fakeStorage());

      // Agencies are messy: the spec allows any transition, so the walk goes forward,
      // sideways, and back to the start.
      for (const status of ["submitted", "approved", "rejected", "in_progress", "not_started"]) {
        const response = await request(api)
          .patch(`/api/checklist-items/${itemId}`)
          .send({ status });
        expect(response.status).toBe(200);
        expect(response.body.status).toBe(status);
      }
    });

    it("persists notes per item and leaves the status alone", async () => {
      const { eventId, body } = await checklistFor("A");
      const itemId = body.items[1]?.id;
      const api = appWith(fakeStorage());

      await request(api).patch(`/api/checklist-items/${itemId}`).send({ status: "in_progress" });
      const noted = await request(api)
        .patch(`/api/checklist-items/${itemId}`)
        .send({ notes: "Called the precinct; they want the SAPO number first." });

      expect(noted.status).toBe(200);
      expect(noted.body.notes).toBe("Called the precinct; they want the SAPO number first.");
      expect(noted.body.status).toBe("in_progress");

      const read = await request(api).get(`/api/events/${eventId}/checklist`);
      const stored = (read.body.items as ChecklistItemView[]).find((item) => item.id === itemId);
      expect(stored?.notes).toBe("Called the precinct; they want the SAPO number first.");
      // AC 2: the rollup follows the per-item status.
      expect(read.body.statusRollup).toMatchObject({ in_progress: 1, not_started: 3 });
    });

    it("clears a note when notes is explicitly null", async () => {
      const { body } = await checklistFor("A");
      const itemId = body.items[0]?.id;
      const api = appWith(fakeStorage());

      await request(api).patch(`/api/checklist-items/${itemId}`).send({ notes: "draft" });
      const cleared = await request(api)
        .patch(`/api/checklist-items/${itemId}`)
        .send({ notes: null });

      expect(cleared.body.notes).toBeNull();
    });

    it("rejects an unknown status, a non-string note, an empty edit and a malformed body", async () => {
      const { body } = await checklistFor("A");
      const itemId = body.items[0]?.id;
      const api = appWith(fakeStorage());

      const unknownStatus = await request(api)
        .patch(`/api/checklist-items/${itemId}`)
        .send({ status: "escalated" });
      expect(unknownStatus.status).toBe(400);
      expect(unknownStatus.body.error).toContain("not_started");

      const badNotes = await request(api)
        .patch(`/api/checklist-items/${itemId}`)
        .send({ notes: { text: "no" } });
      expect(badNotes.status).toBe(400);

      const empty = await request(api).patch(`/api/checklist-items/${itemId}`).send({});
      expect(empty.status).toBe(400);

      const notAnObject = await request(api)
        .patch(`/api/checklist-items/${itemId}`)
        .send(["not", "an", "object"]);
      expect(notAnObject.status).toBe(400);
    });

    it("holds the same status vocabulary the schema enforces", async () => {
      // The same guard as schema-contract.test.ts, for the one enum this feature holds in code:
      // a hand-kept copy that nothing compares is what issues #70, #73 and #76 all were.
      const { rows } = await pool.query<{ def: string }>(
        `SELECT pg_get_constraintdef(c.oid) AS def
           FROM pg_constraint c
           JOIN pg_class t ON t.oid = c.conrelid
          WHERE c.contype = 'c' AND t.relname = 'checklist_items'
            AND pg_get_constraintdef(c.oid) ~ 'status'`,
      );
      const enforced = [...(rows[0]?.def.matchAll(/'([^']+)'/g) ?? [])].map((match) => match[1]);

      expect(enforced.length).toBeGreaterThan(0);
      expect([...CHECKLIST_STATUSES].sort()).toEqual(enforced.sort());
    });
  });

  describe("document upload and download (AC 3)", () => {
    it("stores the bytes in object storage and only the metadata in Postgres", async () => {
      const storage = fakeStorage();
      const { body } = await checklistFor("A", storage);
      const itemId = body.items[0]?.id as string;

      const upload = await request(appWith(storage))
        .post(`/api/checklist-items/${itemId}/documents`)
        .set("Content-Type", "application/pdf")
        .set("X-Filename", "sapo-application.pdf")
        .send(PDF);

      expect(upload.status).toBe(201);
      expect(upload.body).toMatchObject({
        filename: "sapo-application.pdf",
        contentType: "application/pdf",
        sizeBytes: PDF.byteLength,
      });
      const { rows } = await pool.query<{ storage_key: string; size_bytes: string }>(
        "SELECT storage_key, size_bytes FROM documents WHERE id = $1",
        [upload.body.id],
      );
      const storageKey = rows[0]?.storage_key as string;
      expect(storageKey).toMatch(new RegExp(`^checklist-items/${itemId}/[0-9a-f-]{36}\\.pdf$`));
      expect(storage.objects.get(storageKey)?.body).toEqual(PDF);
      // Nothing binary in Postgres: the row carries the key and the size, not the bytes.
      expect(Object.keys(rows[0] ?? {})).not.toContain("body");
    });

    it("lists uploaded documents on the checklist item", async () => {
      const storage = fakeStorage();
      const { eventId, body } = await checklistFor("A", storage);
      const itemId = body.items[0]?.id as string;
      const api = appWith(storage);

      await request(api)
        .post(`/api/checklist-items/${itemId}/documents`)
        .set("Content-Type", "image/png")
        .set("X-Filename", "site-map.png")
        .send(PNG);

      const read = await request(api).get(`/api/events/${eventId}/checklist`);
      const item = (read.body.items as ChecklistItemView[]).find((entry) => entry.id === itemId);
      expect(item?.documents).toEqual([
        expect.objectContaining({ filename: "site-map.png", contentType: "image/png" }),
      ]);
    });

    it("hands back a short-lived signed url for download", async () => {
      const storage = fakeStorage();
      const { body } = await checklistFor("A", storage);
      const api = appWith(storage);
      const upload = await request(api)
        .post(`/api/checklist-items/${body.items[0]?.id}/documents`)
        .set("Content-Type", "application/pdf")
        .send(PDF);

      const signed = await request(api).get(`/api/documents/${upload.body.id}/url`);

      expect(signed.status).toBe(200);
      expect(signed.body.expiresInSeconds).toBe(300);
      expect(signed.body.url).toContain("X-Amz-Expires=300");
    });

    it("refuses a type the spec does not allow and bytes that contradict the declared type", async () => {
      const storage = fakeStorage();
      const { body } = await checklistFor("A", storage);
      const itemId = body.items[0]?.id;
      const api = appWith(storage);

      const wrongType = await request(api)
        .post(`/api/checklist-items/${itemId}/documents`)
        .set("Content-Type", "application/zip")
        .send(Buffer.from("PK"));
      expect(wrongType.status).toBe(415);
      expect(wrongType.body.error).toContain("application/pdf");

      // A content type is a claim by the caller; an executable announced as a PDF is not one.
      const lyingBytes = await request(api)
        .post(`/api/checklist-items/${itemId}/documents`)
        .set("Content-Type", "application/pdf")
        .send(Buffer.from("MZ this is not a pdf"));
      expect(lyingBytes.status).toBe(400);

      const empty = await request(api)
        .post(`/api/checklist-items/${itemId}/documents`)
        .set("Content-Type", "application/pdf")
        .send(Buffer.alloc(0));
      expect(empty.status).toBe(400);

      expect(storage.objects.size).toBe(0);
    });

    it("refuses a document larger than 10 MB", async () => {
      const storage = fakeStorage();
      const { body } = await checklistFor("A", storage);
      const oversized = Buffer.concat([PDF, Buffer.alloc(10 * 1024 * 1024)]);

      const response = await request(appWith(storage))
        .post(`/api/checklist-items/${body.items[0]?.id}/documents`)
        .set("Content-Type", "application/pdf")
        .send(oversized);

      expect(response.status).toBe(413);
      expect(storage.objects.size).toBe(0);
    });

    it("treats a client filename as a display name only, never as a path", async () => {
      const storage = fakeStorage();
      const { body } = await checklistFor("A", storage);
      const itemId = body.items[0]?.id as string;

      const upload = await request(appWith(storage))
        .post(`/api/checklist-items/${itemId}/documents`)
        .set("Content-Type", "application/pdf")
        .set("X-Filename", "../../../etc/passwd")
        .send(PDF);

      expect(upload.status).toBe(201);
      expect(upload.body.filename).toBe("passwd");
      const [storedKey] = [...storage.objects.keys()];
      expect(storedKey).toBe(`checklist-items/${itemId}/${storedKey?.split("/")[2]}`);
      expect(storedKey).not.toContain("passwd");
    });

    // A header value is a ByteString, so the browser cannot send these names raw: the client
    // percent-encodes and this decodes. Letters and marks survive in any script; everything else
    // becomes `_`, which still excludes control characters, the invisible bidi/format characters
    // that can reverse how a name reads, and every path separator.
    it.each([
      ["Chinese", "%E7%94%B3%E8%AF%B7%E4%B9%A6.pdf", "\u7533\u8bf7\u4e66.pdf"],
      [
        "Cyrillic",
        "%D0%B7%D0%B0%D1%8F%D0%B2%D0%BA%D0%B0.pdf",
        "\u0437\u0430\u044f\u0432\u043a\u0430.pdf",
      ],
      ["emoji", "%F0%9F%98%80.pdf", "_.pdf"],
      ["a right-to-left override", "a%E2%80%AEb.pdf", "a_b.pdf"],
      ["an encoded path", "..%2F..%2Fetc%2Fpasswd", "passwd"],
      ["a plain ascii name", "sapo-application.pdf", "sapo-application.pdf"],
      ["an unencodable stray percent", "50%.pdf", "50_.pdf"],
    ])("decodes %s filename into a display name", async (_label, sent, expected) => {
      const storage = fakeStorage();
      const { body } = await checklistFor("A", storage);
      const itemId = body.items[0]?.id as string;

      const upload = await request(appWith(storage))
        .post(`/api/checklist-items/${itemId}/documents`)
        .set("Content-Type", "application/pdf")
        .set("X-Filename", sent)
        .send(PDF);

      expect(upload.status).toBe(201);
      expect(upload.body.filename).toBe(expected);
      // Whatever the name, it never reaches the storage key.
      const [storedKey] = [...storage.objects.keys()];
      expect(storedKey).toBe(`checklist-items/${itemId}/${storedKey?.split("/")[2]}`);
    });

    // The root of the duplicate-document defect, fixed at the write instead of at the read.
    // Three review rounds tried to stop the client repeating a request whose result it could not
    // observe; a client cannot know that, so the repeat is made harmless instead.
    it("stores one document however many times the same upload key arrives", async () => {
      const storage = fakeStorage();
      const { eventId, body } = await checklistFor("A", storage);
      const itemId = body.items[0]?.id as string;
      const send = () =>
        request(appWith(storage))
          .post(`/api/checklist-items/${itemId}/documents`)
          .set("Content-Type", "application/pdf")
          .set("X-Filename", "application.pdf")
          .set("X-Upload-Key", "1024-1769472000000-application.pdf")
          .send(PDF);

      const first = await send();
      const second = await send();
      // A third from a "different session": the key is derived from the file, so a reload and a
      // re-pick reproduce it. That is the case the read-side fixes could not cover.
      const third = await send();

      expect(first.status).toBe(201);
      // 200, not 201: nothing was created, which is the distinction the checklist endpoint draws.
      expect(second.status).toBe(200);
      expect(third.status).toBe(200);
      expect(second.body.id).toBe(first.body.id);
      expect(third.body.id).toBe(first.body.id);

      const { rows } = await pool.query<{ count: string }>(
        "SELECT count(*) FROM documents WHERE checklist_item_id = $1",
        [itemId],
      );
      expect(rows[0]?.count).toBe("1");
      // And one object, because the storage key is derived from the same id.
      expect(storage.objects.size).toBe(1);

      const listed = await request(appWith(storage)).get(`/api/events/${eventId}/checklist`);
      expect(
        (listed.body.items as ChecklistItemView[]).find((item) => item.id === itemId)?.documents,
      ).toHaveLength(1);
    });

    it("stores two documents for two different upload keys", async () => {
      const storage = fakeStorage();
      const { body } = await checklistFor("A", storage);
      const itemId = body.items[0]?.id as string;
      const send = (key: string) =>
        request(appWith(storage))
          .post(`/api/checklist-items/${itemId}/documents`)
          .set("Content-Type", "application/pdf")
          .set("X-Filename", "application.pdf")
          .set("X-Upload-Key", key)
          .send(PDF);

      // Same name, edited: a different size or timestamp is a different key and a different
      // document, which is what replacing a filed application looks like.
      const first = await send("1024-1769472000000-application.pdf");
      const second = await send("2048-1769558400000-application.pdf");

      expect(first.status).toBe(201);
      expect(second.status).toBe(201);
      expect(second.body.id).not.toBe(first.body.id);
      expect(storage.objects.size).toBe(2);
    });

    it("keeps minting a fresh document when a client sends no upload key", async () => {
      const storage = fakeStorage();
      const { body } = await checklistFor("A", storage);
      const itemId = body.items[0]?.id as string;
      const send = () =>
        request(appWith(storage))
          .post(`/api/checklist-items/${itemId}/documents`)
          .set("Content-Type", "application/pdf")
          .set("X-Filename", "application.pdf")
          .send(PDF);

      const first = await send();
      const second = await send();

      // Additive: a client that sends no key gets exactly the previous behaviour rather than an
      // error, and two uploads remain two documents.
      expect(first.status).toBe(201);
      expect(second.status).toBe(201);
      expect(second.body.id).not.toBe(first.body.id);
    });

    // Every accepted type is one a browser renders inline, so a plain signed GET previews the
    // document under a control labelled Download. The disposition is signed with the URL, so it
    // cannot be stripped by whoever holds the link.
    it("signs the download so it saves rather than previewing, under the stored name", async () => {
      const storage = fakeStorage();
      const { body } = await checklistFor("A", storage);
      const itemId = body.items[0]?.id as string;

      const upload = await request(appWith(storage))
        .post(`/api/checklist-items/${itemId}/documents`)
        .set("Content-Type", "application/pdf")
        .set("X-Filename", "%E7%94%B3%E8%AF%B7%E4%B9%A6.pdf")
        .send(PDF);
      const link = await request(appWith(storage)).get(
        `/api/documents/${upload.body.id as string}/url`,
      );

      expect(link.status).toBe(200);
      const disposition = new URL(link.body.url as string).searchParams.get(
        "response-content-disposition",
      );
      expect(disposition).toContain("attachment;");
      // Both forms: an ASCII fallback that cannot break out of the header, and the real name.
      expect(disposition).toContain(`filename="___.pdf"`);
      expect(disposition).toContain(
        `filename*=UTF-8''${encodeURIComponent("\u7533\u8bf7\u4e66.pdf")}`,
      );
    });

    it("keeps the item's state and writes no metadata row when storage is unreachable", async () => {
      const { body } = await checklistFor("A");
      const itemId = body.items[0]?.id as string;
      const api = appWith(unreachableStorage());

      const failed = await request(api)
        .post(`/api/checklist-items/${itemId}/documents`)
        .set("Content-Type", "application/pdf")
        .send(PDF);

      expect(failed.status).toBe(503);
      // The message is ours; no SDK, bucket or endpoint detail reaches the client.
      expect(failed.body).toEqual({ error: "document storage is unavailable", retryable: true });
      const { rows } = await pool.query("SELECT id FROM documents WHERE checklist_item_id = $1", [
        itemId,
      ]);
      expect(rows).toHaveLength(0);
      const { rows: item } = await pool.query<{ status: string }>(
        "SELECT status FROM checklist_items WHERE id = $1",
        [itemId],
      );
      expect(item[0]?.status).toBe("not_started");
    });

    it("reports an unsignable download without leaking why", async () => {
      const storage = fakeStorage();
      const { body } = await checklistFor("A", storage);
      const upload = await request(appWith(storage))
        .post(`/api/checklist-items/${body.items[0]?.id}/documents`)
        .set("Content-Type", "application/pdf")
        .send(PDF);

      const signed = await request(appWith(unreachableStorage())).get(
        `/api/documents/${upload.body.id}/url`,
      );

      expect(signed.status).toBe(503);
      expect(signed.body.error).toBe("document storage is unavailable");
    });
  });

  describe("regenerating the plan (AC 6)", () => {
    it("keeps the checklist, flags the change, strikes dropped items and appends new ones", async () => {
      const { eventId, body } = await checklistFor("A");
      const api = appWith(fakeStorage());
      const large = body.items.find((item) => item.ruleIds[0] === "SAPO-STREET-LARGE-001");
      await request(api)
        .patch(`/api/checklist-items/${large?.id}`)
        .send({ status: "submitted", notes: "filed 2026-07-10" });

      // The rescope the demo path uses: the same event, scoped down a size class.
      const edited = await request(api)
        .patch(`/api/events/${eventId}`)
        .send({ street_event_size: "medium" });
      expect(edited.status).toBe(200);
      await generatePlan(eventId);

      const rescoped = await review(api, eventId);

      expect(rescoped.status).toBe(201);
      // The rescope raised the prompt (asserted on the read below); this POST answers it.
      expect(rescoped.body.planChanged).toBe(false);
      const items = rescoped.body.items as ChecklistItemView[];
      // Nothing is deleted: the large-event line survives with its status and note intact,
      // marked as no longer in the plan so the UI can strike it through.
      const dropped = items.find((item) => item.ruleIds[0] === "SAPO-STREET-LARGE-001");
      expect(dropped?.struckThrough).toBe(true);
      expect(dropped?.status).toBe("submitted");
      expect(dropped?.notes).toBe("filed 2026-07-10");
      // The new requirement is appended rather than inserted among the tracked work.
      expect(items.at(-1)?.ruleIds).toEqual(["SAPO-STREET-MEDIUM-001"]);
      expect(items.at(-1)?.struckThrough).toBe(false);
      // Requirements the rescope did not change keep their identity, not a duplicate row.
      expect(items.filter((item) => item.ruleIds[0] === "NYPD-SOUND-001")).toHaveLength(1);
      // A struck item is not current work, so it does not count toward the rollup.
      expect(rescoped.body.statusRollup).toMatchObject({ submitted: 0 });
    });

    it("renders a still-required item against the latest plan's recalculated dates", async () => {
      const { eventId, body } = await checklistFor("A");
      const before = body.items.find((item) => item.ruleIds[0] === "NYPD-SOUND-001");
      const api = appWith(fakeStorage());

      // Moving the event moves every computed filing date with it (PRD principle 6).
      await request(api).patch(`/api/events/${eventId}`).send({ event_date: "2026-09-30" });
      await generatePlan(eventId);

      const read = await request(api).get(`/api/events/${eventId}/checklist`);
      const after = (read.body.items as ChecklistItemView[]).find(
        (item) => item.ruleIds[0] === "NYPD-SOUND-001",
      );
      expect(after?.id).toBe(before?.id);
      expect(after?.latestApplyDate).not.toBe(before?.latestApplyDate);
      expect(after?.struckThrough).toBe(false);
    });

    it("flags a plan change before the new items are materialized", async () => {
      const { eventId } = await checklistFor("A");
      const api = appWith(fakeStorage());

      await request(api).patch(`/api/events/${eventId}`).send({ street_event_size: "medium" });
      await generatePlan(eventId);

      const read = await request(api).get(`/api/events/${eventId}/checklist`);
      expect(read.body.planChanged).toBe(true);
      expect(
        (read.body.items as ChecklistItemView[]).some(
          (item) => item.ruleIds[0] === "SAPO-STREET-MEDIUM-001",
        ),
      ).toBe(false);
    });
  });

  describe("requests that name something that is not there", () => {
    it("answers 404 for an unknown event, an event with no plan, and unknown ids", async () => {
      const api = appWith(fakeStorage());
      const absent = randomUUID();

      // A plan id is supplied by hand for both 404s below. The helper reads one off a GET, and a
      // GET against an event that does not exist (or has no plan) has none to give — the request
      // would then be refused for a missing planId and never reach the lookup under test.
      expect((await review(api, absent, randomUUID())).status).toBe(404);
      expect((await request(api).get(`/api/events/${absent}/checklist`)).status).toBe(404);
      expect(
        (await request(api).patch(`/api/checklist-items/${absent}`).send({ status: "approved" }))
          .status,
      ).toBe(404);
      expect((await request(api).get(`/api/documents/${absent}/url`)).status).toBe(404);

      const planless = await createEvent(scenario("A"));
      const response = await review(api, planless, randomUUID());
      expect(response.status).toBe(404);
      expect(response.body.error).toContain("no plan generated");
    });

    it("answers 404 when uploading against a checklist item that does not exist", async () => {
      const storage = fakeStorage();
      const response = await request(appWith(storage))
        .post(`/api/checklist-items/${randomUUID()}/documents`)
        .set("Content-Type", "application/pdf")
        .send(PDF);

      expect(response.status).toBe(404);
      // The check runs before the upload, so an unknown item cannot leave bytes in the bucket.
      expect(storage.objects.size).toBe(0);
    });

    it("answers 400 for a malformed id rather than letting Postgres refuse the cast", async () => {
      const api = appWith(fakeStorage());

      for (const response of [
        await request(api).post("/api/events/not-a-uuid/checklist"),
        await request(api).get("/api/events/not-a-uuid/checklist"),
        await request(api).patch("/api/checklist-items/not-a-uuid").send({ status: "approved" }),
        await request(api).get("/api/documents/not-a-uuid/url"),
      ]) {
        expect(response.status).toBe(400);
        expect(response.body.error).toContain("must be a uuid");
      }
    });
  });

  // Review round 1, findings 1 and 2: a checklist may not present a plan that no longer answers
  // the current intake, and "the plan changed" must survive a regeneration that moved only dates.
  describe("a plan generated while a checklist is being created", () => {
    it("holds a generation behind the event lock the checklist takes", async () => {
      // The checklist decides which plan it is materializing under the event row lock and then
      // acknowledges that plan, so a generation committing inside that window would have the POST
      // acknowledge a superseded plan and answer planChanged: false while a newer one exists.
      // #92 read `plan.ts`, which takes no lock of its own, and concluded nothing prevents it.
      //
      // Postgres does. `permit_plans.event_id` references `events`, so every plan insert takes a
      // FOR KEY SHARE row lock on the parent event, and FOR UPDATE conflicts with it: the insert
      // waits for the checklist's transaction to end. Verified rather than assumed: under the
      // held lock the generation waits on `Lock: transactionid` at `INSERT INTO permit_plans`,
      // holding a tuple lock on `events`, and it commits only once the lock is released.
      //
      // So this pins the property rather than any one mechanism, because the mechanism is
      // implicit and two edits would remove it silently: dropping the foreign key, and weakening
      // this route's lock to FOR NO KEY UPDATE, which does NOT conflict with FOR KEY SHARE.
      //
      // It waits for the insert to be observably blocked rather than sleeping and assuming it is.
      // A fixed window is the vacuous pass this test exists to prevent: on a loaded worker the
      // request can still be starting up when the window closes, and "it has not finished" then
      // holds for a generation nothing is serializing at all, so the guard stays green through
      // the very edit it guards against. Not reaching the insert is a failure here, not a pass.
      //
      // The holder stands in for the checklist's own transaction: it takes exactly the lock the
      // POST takes, and holds it for as long as the test needs.
      const eventId = await createEvent(scenario("A"));
      await generatePlan(eventId);
      const api = appWith(fakeStorage());

      /**
       * The generation's own backend, waiting on a lock at either statement that can serialize it.
       *
       * F-201's regeneration downgrade guard now takes the same `events` row lock explicitly at the
       * start of the generating transaction, because its precondition is a read followed by a write
       * and the implicit FK lock arrives too late to serialize the read. So the generation blocks
       * there rather than at the insert. Both statements are matched: the property under test and
       * the non-vacuity assertion below are unchanged, and the test still fails if a future edit
       * removes both the explicit lock and the foreign key.
       */
      const blockedOnGeneration = async (): Promise<boolean> => {
        const { rows } = await pool.query(
          `SELECT 1 FROM pg_stat_activity
            WHERE datname = current_database()
              AND wait_event_type = 'Lock'
              AND (query LIKE 'INSERT INTO permit_plans%'
                   OR query LIKE 'SELECT id FROM events WHERE id = $1 FOR UPDATE%')`,
        );
        return rows.length > 0;
      };

      const holder = await pool.connect();
      let settled = false;
      let committed = false;
      let inFlight: Promise<request.Response> | undefined;
      try {
        await holder.query("BEGIN");
        await holder.query("SELECT id FROM events WHERE id = $1 FOR UPDATE", [eventId]);

        inFlight = request(api)
          .post(`/api/events/${eventId}/plan`)
          .then((response) => {
            settled = true;
            return response;
          });
        // An assertion below may fail before this is awaited, and an unhandled rejection would
        // then be reported instead of the assertion that actually failed.
        void inFlight.catch(() => undefined);

        const deadline = Date.now() + 10_000;
        let blocked = false;
        while (!blocked && Date.now() < deadline && !settled) {
          blocked = await blockedOnGeneration();
          if (!blocked) await new Promise((resolve) => setTimeout(resolve, 25));
        }
        expect(
          blocked,
          "the generation never blocked on a lock at its event-row lock or at INSERT INTO " +
            "permit_plans, so nothing serialized it and this test asserted nothing",
        ).toBe(true);

        const { rows } = await holder.query<{ count: string }>(
          "SELECT count(*) AS count FROM permit_plans WHERE event_id = $1",
          [eventId],
        );
        expect(settled, "the generation answered while the event row was locked").toBe(false);
        expect(rows[0]?.count, "a plan committed while the event row was locked").toBe("1");

        await holder.query("COMMIT");
        committed = true;
      } finally {
        // Releasing a client does not end its transaction: without this, a failed assertion
        // returns a connection to the pool idle in transaction, still holding the event-row lock,
        // and the blocked generation and the suite's cleanup both wait on it until the run times
        // out. A regression would then read as flake rather than as itself.
        if (!committed) await holder.query("ROLLBACK").catch(() => undefined);
        holder.release();
      }

      // Released, so it proceeds: serialized, not refused.
      const generated = await inFlight;
      expect(generated.status).toBe(201);
      const { rows } = await pool.query<{ count: string }>(
        "SELECT count(*) AS count FROM permit_plans WHERE event_id = $1",
        [eventId],
      );
      expect(rows[0]?.count).toBe("2");
    });
  });

  describe("a plan the event has moved past", () => {
    it("refuses to create a checklist from a plan older than the event's revision", async () => {
      const eventId = await createEvent(scenario("A"));
      await generatePlan(eventId);
      const api = appWith(fakeStorage());

      // The edit bumps revision_counter; the plan still pins the revision it evaluated.
      await request(api).patch(`/api/events/${eventId}`).send({ street_event_size: "medium" });
      const refused = await review(api, eventId);

      expect(refused.status).toBe(409);
      expect(refused.body.error).toContain("regenerate the plan first");
      const { rows } = await pool.query(
        `SELECT checklist.id FROM checklist_items AS checklist
           JOIN permit_plan_items AS item ON item.id = checklist.plan_item_id
           JOIN permit_plans AS plan ON plan.id = item.plan_id
          WHERE plan.event_id = $1`,
        [eventId],
      );
      expect(rows).toHaveLength(0);

      // Regenerating clears it, and the checklist then covers the rescoped requirements.
      await generatePlan(eventId);
      const created = await review(api, eventId);
      expect(created.status).toBe(201);
      expect(
        (created.body.items as ChecklistItemView[]).some(
          (item) => item.ruleIds[0] === "SAPO-STREET-MEDIUM-001",
        ),
      ).toBe(true);
    });

    it("says on read that the latest plan predates the current intake", async () => {
      const { eventId } = await checklistFor("A");
      const api = appWith(fakeStorage());

      const before = await request(api).get(`/api/events/${eventId}/checklist`);
      expect(before.body.planStale).toBe(false);

      await request(api).patch(`/api/events/${eventId}`).send({ street_event_size: "medium" });

      const after = await request(api).get(`/api/events/${eventId}/checklist`);
      expect(after.body.planStale).toBe(true);
    });

    it("flags a regeneration that changed only the filing dates, and clears it once re-created", async () => {
      const { eventId, body } = await checklistFor("A");
      const api = appWith(fakeStorage());
      const before = body.items.map((item) => item.latestApplyDate);

      // Moving the date regenerates every deadline while the requirement set stays identical:
      // the case a comparison of added and removed rule ids cannot see.
      await request(api).patch(`/api/events/${eventId}`).send({ event_date: "2026-10-14" });
      await generatePlan(eventId);

      const read = await request(api).get(`/api/events/${eventId}/checklist`);
      const after = (read.body.items as ChecklistItemView[]).map((item) => item.latestApplyDate);
      expect(ruleIdsOf(read.body.items as ChecklistItemView[])).toEqual(ruleIdsOf(body.items));
      expect(after).not.toEqual(before);
      expect(read.body.planChanged).toBe(true);

      // Re-creating the checklist is the organizer accepting the new plan, so the prompt clears
      // rather than latching on for the rest of the event's life.
      const accepted = await review(api, eventId);
      expect(accepted.status).toBe(200);
      expect(accepted.body.planChanged).toBe(false);
      expect((accepted.body.items as ChecklistItemView[]).map((item) => item.id)).toEqual(
        body.items.map((item) => item.id),
      );
    });

    it("carries status, notes and documents across the re-point", async () => {
      const storage = fakeStorage();
      const { eventId, body } = await checklistFor("A", storage);
      const api = appWith(storage);
      const itemId = body.items[0]?.id as string;
      await request(api)
        .patch(`/api/checklist-items/${itemId}`)
        .send({ status: "approved", notes: "approved by SAPO" });
      await request(api)
        .post(`/api/checklist-items/${itemId}/documents`)
        .set("Content-Type", "application/pdf")
        .send(PDF);

      await request(api).patch(`/api/events/${eventId}`).send({ event_date: "2026-10-14" });
      await generatePlan(eventId);
      const accepted = await review(api, eventId);

      const item = (accepted.body.items as ChecklistItemView[]).find(
        (candidate) => candidate.id === itemId,
      );
      expect(item?.status).toBe("approved");
      expect(item?.notes).toBe("approved by SAPO");
      expect(item?.documents).toHaveLength(1);
      // Re-pointed at the current plan's row, so the deadline it shows is the recalculated one.
      expect(item?.planItemId).not.toBe(body.items[0]?.planItemId);
      expect(item?.struckThrough).toBe(false);
    });
  });

  /**
   * THE STALE TAB. A review acknowledges a SPECIFIC plan, and the organizer must have been shown
   * the plan it acknowledges.
   *
   * The race is between requests, not inside one: the transaction-level race is covered above, and
   * it was never the reachable case. This one is — a tab renders plan A, anything at all
   * regenerates, and the click arrives minutes later. Choosing the plan server-side made that
   * click acknowledge plan B, so `checklist_acknowledgements` asserted a review that did not
   * happen and nothing downstream could tell. AC 6 reads that row to mean the organizer has
   * reviewed the changed items, which is exactly the claim it could not support.
   *
   * Asserted against the ROW rather than the response, both the plan id and the timestamp,
   * because "did not record" is the whole property and a response body cannot demonstrate it.
   */
  describe("a review is bound to the plan the organizer was shown", () => {
    const acknowledgement = async (eventId: string) =>
      (
        await pool.query<{ plan_id: string; acknowledged_at: Date }>(
          "SELECT plan_id, acknowledged_at FROM checklist_acknowledgements WHERE event_id = $1",
          [eventId],
        )
      ).rows[0];

    it("refuses a review naming a superseded plan, and records nothing", async () => {
      const { eventId, body } = await checklistFor("A");
      const api = appWith(fakeStorage());
      // What the organizer's tab is still displaying, captured before anything regenerates.
      const displayed = body.planId as string;
      const before = await acknowledgement(eventId);
      expect(before?.plan_id).toBe(displayed);

      // Another tab, or another device, moves the event on and regenerates.
      await request(api).patch(`/api/events/${eventId}`).send({ event_date: "2026-10-14" });
      await generatePlan(eventId);
      const current = await request(api).get(`/api/events/${eventId}/checklist`);
      expect(current.body.planId).not.toBe(displayed);

      // The organizer, who has seen none of that, presses review.
      const refused = await review(api, eventId, displayed);

      expect(refused.status).toBe(409);
      expect(refused.body.supersededPlanId).toBe(displayed);
      // NOTHING WAS RECORDED. Same plan and the same timestamp: had it re-acknowledged, the plan
      // id would have moved to the newer plan, and had it merely re-run, the timestamp would have.
      const after = await acknowledgement(eventId);
      expect(after?.plan_id).toBe(before?.plan_id);
      expect(after?.acknowledged_at.getTime()).toBe(before?.acknowledged_at.getTime());
      // Re-presented rather than merely refused: the newer plan comes back with the refusal, so
      // the organizer can read what they are being asked to acknowledge.
      expect(refused.body.checklist.planId).toBe(current.body.planId);
      expect(refused.body.checklist.planChanged).toBe(true);
    });

    it("records the acknowledgement when the review names the plan being shown", async () => {
      const { eventId, body } = await checklistFor("A");
      const api = appWith(fakeStorage());
      const first = await acknowledgement(eventId);
      expect(first?.plan_id).toBe(body.planId);

      await request(api).patch(`/api/events/${eventId}`).send({ event_date: "2026-10-14" });
      await generatePlan(eventId);
      // This time the organizer re-reads the page first, so the id they submit is the current one.
      const current = await request(api).get(`/api/events/${eventId}/checklist`);
      expect(current.body.planChanged).toBe(true);

      const accepted = await review(api, eventId, current.body.planId as string);

      expect(accepted.status).toBe(200);
      expect(accepted.body.planChanged).toBe(false);
      // The acknowledgement moved to the plan they actually read, which is the normal path this
      // guard must not break: refusing everything would satisfy the test above and nothing else.
      const after = await acknowledgement(eventId);
      expect(after?.plan_id).toBe(current.body.planId);
      expect(after?.acknowledged_at.getTime()).toBeGreaterThan(
        first?.acknowledged_at.getTime() as number,
      );
    });

    it("refuses a review that names no plan, rather than choosing one", async () => {
      const { eventId } = await checklistFor("A");
      const api = appWith(fakeStorage());
      const before = await acknowledgement(eventId);

      // Exactly the old client's request. Defaulting it to the latest plan is the defect, so the
      // absent id is refused rather than filled in.
      const bare = await request(api).post(`/api/events/${eventId}/checklist`).send({});
      const notAUuid = await request(api)
        .post(`/api/events/${eventId}/checklist`)
        .send({ planId: "the-one-i-was-looking-at" });

      for (const response of [bare, notAUuid]) {
        expect(response.status).toBe(400);
        expect(response.body.error).toContain("planId is required");
      }
      const after = await acknowledgement(eventId);
      expect(after?.acknowledged_at.getTime()).toBe(before?.acknowledged_at.getTime());
    });
  });

  /**
   * Every shape of regeneration, rise and fall, in one place.
   *
   * `planChanged` has now been wrong twice in opposite directions — a comparison of rule-id sets
   * missed a date-only regeneration, and a comparison of counts let a retained struck-through row
   * hold the prompt open forever. Both were correct about the case they were written for. These
   * cases are kept together so a future change cannot fix one shape and silently re-break another;
   * a fix that only satisfies its own case fails here.
   *
   * The plans are written directly so each shape is exactly one difference, rather than whatever
   * a rescope happens to produce.
   */
  describe("planChanged across every shape of regeneration", () => {
    const A = "SAPO-STREET-LARGE-001";
    const B = "NYPD-SOUND-001";
    const C = "DOHMH-VENDOR-PERMIT-001";
    const permits = (...ruleIds: string[]) =>
      ruleIds.map((id) => ({ ruleIds: [id], kind: "permit" }));

    /** An event whose checklist is materialized from a first synthetic plan. */
    const startedFrom = async (ruleIds: string[]) => {
      const eventId = await createEvent(scenario("A"));
      await insertPlan(eventId, permits(...ruleIds), "2026-07-22T10:00:00Z");
      const api = appWith(fakeStorage());
      const first = await review(api, eventId);
      expect(first.status).toBe(201);
      expect(first.body.planChanged).toBe(false);
      return { eventId, api };
    };

    const flagOn = async (api: ReturnType<typeof appWith>, eventId: string): Promise<boolean> =>
      (await request(api).get(`/api/events/${eventId}/checklist`)).body.planChanged;

    it("stays clear when nothing has been regenerated", async () => {
      const { eventId, api } = await startedFrom([A, B]);

      expect(await flagOn(api, eventId)).toBe(false);
      const again = await review(api, eventId);
      expect(again.status).toBe(200);
      expect(again.body.planChanged).toBe(false);
    });

    it("rises for a regeneration that changed nothing but the plan, and clears on re-materialize", async () => {
      const { eventId, api } = await startedFrom([A, B]);

      // The same requirements, new rows: the date-only rescope.
      await insertPlan(eventId, permits(A, B), "2026-07-22T11:00:00Z");

      expect(await flagOn(api, eventId)).toBe(true);
      expect((await review(api, eventId)).body.planChanged).toBe(false);
      expect(await flagOn(api, eventId)).toBe(false);
    });

    it("rises for an added requirement, and clears on re-materialize", async () => {
      const { eventId, api } = await startedFrom([A, B]);

      await insertPlan(eventId, permits(A, B, C), "2026-07-22T11:00:00Z");

      expect(await flagOn(api, eventId)).toBe(true);
      const accepted = await review(api, eventId);
      expect(accepted.status).toBe(201);
      expect(accepted.body.planChanged).toBe(false);
      expect(await flagOn(api, eventId)).toBe(false);
    });

    it("rises for a removed requirement, and clears on re-materialize even though the row is kept", async () => {
      const { eventId, api } = await startedFrom([A, B]);

      await insertPlan(eventId, permits(A), "2026-07-22T11:00:00Z");

      expect(await flagOn(api, eventId)).toBe(true);
      const accepted = await review(api, eventId);
      expect(accepted.body.planChanged).toBe(false);
      // The retained row is history, not a pending review: it must not hold the prompt open on
      // this read or any later one.
      expect(await flagOn(api, eventId)).toBe(false);
      expect((await review(api, eventId)).body.planChanged).toBe(false);

      // And it is still there, struck through, with nothing deleted (AC 6).
      const items = (await request(api).get(`/api/events/${eventId}/checklist`)).body
        .items as ChecklistItemView[];
      expect(items).toHaveLength(2);
      expect(items.find((item) => item.ruleIds[0] === B)?.struckThrough).toBe(true);
    });

    it("rises for a merge, and clears on re-materialize with both retained rows struck", async () => {
      const { eventId, api } = await startedFrom([A, B]);

      await insertPlan(eventId, [{ ruleIds: [A, B], kind: "permit" }], "2026-07-22T11:00:00Z");

      expect(await flagOn(api, eventId)).toBe(true);
      expect((await review(api, eventId)).body.planChanged).toBe(false);
      expect(await flagOn(api, eventId)).toBe(false);
    });

    it("appends a reintroduced requirement instead of sorting it by its first plan", async () => {
      // Three plans, because a two-plan sequence passes under both the old rule and the new one.
      // X, then Y with the checklist created against it, then X+Y. Ordering by first appearance in
      // any plan dates A from plan X — earlier than B, which the organizer has been working since
      // the checklist existed — and sorts the brand-new task above it. AC 6 appends.
      const eventId = await createEvent(scenario("A"));
      const api = appWith(fakeStorage());

      await insertPlan(eventId, permits(A), "2026-07-22T10:00:00Z");
      await insertPlan(eventId, permits(B), "2026-07-22T11:00:00Z");
      const created = await review(api, eventId);
      expect(created.status).toBe(201);
      expect((created.body.items as ChecklistItemView[]).map((item) => item.ruleIds[0])).toEqual([
        B,
      ]);

      await insertPlan(eventId, permits(A, B), "2026-07-22T12:00:00Z");
      const reviewed = await review(api, eventId);

      // B first: it became a task first, even though A appeared in an earlier plan.
      expect((reviewed.body.items as ChecklistItemView[]).map((item) => item.ruleIds[0])).toEqual([
        B,
        A,
      ]);
      // And the order is a property of the checklist, so a later read reproduces it.
      const read = await request(api).get(`/api/events/${eventId}/checklist`);
      expect((read.body.items as ChecklistItemView[]).map((item) => item.ruleIds[0])).toEqual([
        B,
        A,
      ]);
    });

    it("keeps a dropped item in its cohort instead of leading the list with it", async () => {
      // Every task of one materialization shares a `created_at`, because Postgres fixes
      // `current_timestamp` per transaction, so their relative order is decided entirely by the
      // query's tiebreak, and the tiebreak must not read the plan each row currently points at.
      // After this rescope the struck row still points at the plan it was raised by while its
      // cohort-mate has been re-pointed forward, so ordering on `plan.generated_at` puts the
      // struck row first and moves a row the organizer has been working.
      //
      // Three plans, so the plan a row points at, the plan a requirement first appeared in, and
      // the order the tasks were created are three different things. C appears in the first plan,
      // is absent when the checklist is created, and returns last; its published name sorts first,
      // so it can only come last by having become a task last.
      const eventId = await createEvent(scenario("A"));
      const api = appWith(fakeStorage());

      await insertPlan(eventId, permits(C), "2026-07-22T10:00:00Z");
      await insertPlan(eventId, permits(A, B), "2026-07-22T11:00:00Z");
      const created = await review(api, eventId);
      expect(created.status).toBe(201);
      // One transaction, so A and B tie on creation and the filing-date order decides.
      expect((created.body.items as ChecklistItemView[]).map((item) => item.ruleIds[0])).toEqual([
        B,
        A,
      ]);

      // Drops A, keeps B, brings C back.
      await insertPlan(eventId, permits(B, C), "2026-07-22T12:00:00Z");
      const reviewed = await review(api, eventId);
      expect(reviewed.status).toBe(201);

      const items = reviewed.body.items as ChecklistItemView[];
      expect(items.map((item) => item.ruleIds[0])).toEqual([B, A, C]);
      // A is the struck one, and it did not move: it is history in place, not a new first row.
      expect(items.find((item) => item.ruleIds[0] === A)?.struckThrough).toBe(true);
      const read = await request(api).get(`/api/events/${eventId}/checklist`);
      expect((read.body.items as ChecklistItemView[]).map((item) => item.ruleIds[0])).toEqual([
        B,
        A,
        C,
      ]);
    });

    it("does not reshuffle a cohort when a regeneration moves the filing dates", async () => {
      // The other half of the same defect. Rows created together share a `created_at`, so the
      // query's order decides between them, and reading a recalculated field there reshuffles the
      // list on regeneration just as reading the plan's timestamp did. A retained row is re-pointed
      // at the new plan's date while a dropped row keeps the last-known date of the plan that
      // raised it, so the two are not even measured against the same evaluation: here the retained
      // item's new date crosses the dropped item's historical one, which is the Scenario A rescope
      // ladder, and under a filing-date order the pair swaps.
      //
      // The order that must hold is the one the organizer learned: filing order as it stood when
      // the tasks were created, which `cohort_position` froze.
      const eventId = await createEvent(scenario("A"));
      const api = appWith(fakeStorage());

      await insertPlan(
        eventId,
        [
          { ruleIds: [A], kind: "permit", latestApplyDate: "2026-08-01" },
          { ruleIds: [B], kind: "permit", latestApplyDate: "2026-08-20" },
        ],
        "2026-07-22T10:00:00Z",
      );
      const created = await review(api, eventId);
      expect(created.status).toBe(201);
      const before = (created.body.items as ChecklistItemView[]).map((item) => item.ruleIds[0]);

      // Drops A, which keeps 2026-08-01, and recalculates B to a date ahead of it.
      await insertPlan(
        eventId,
        [{ ruleIds: [B], kind: "permit", latestApplyDate: "2026-07-25" }],
        "2026-07-22T11:00:00Z",
      );
      const reviewed = await review(api, eventId);
      expect(reviewed.status).toBe(200);

      const after = (reviewed.body.items as ChecklistItemView[]).map((item) => item.ruleIds[0]);
      expect(after, "the cohort was reordered by a date the regeneration moved").toEqual(before);
      // Named as well as unchanged, so "stable" cannot be satisfied by freezing a wrong order:
      // A led at creation because 2026-08-01 was the sooner deadline then.
      expect(after).toEqual([A, B]);
      expect(
        (reviewed.body.items as ChecklistItemView[]).find((item) => item.ruleIds[0] === A)
          ?.struckThrough,
      ).toBe(true);
    });

    it("does not reshuffle the list when the organizer works an item", async () => {
      // `created_at` rather than `updated_at`: a status change must not move a task's position.
      const { eventId, api } = await startedFrom([A, B]);
      const items = (await request(api).get(`/api/events/${eventId}/checklist`)).body
        .items as ChecklistItemView[];
      const first = items[0];
      expect(first).toBeDefined();

      await request(api)
        .patch(`/api/checklist-items/${first?.id}`)
        .send({ status: "submitted" })
        .set("Content-Type", "application/json");

      const after = (await request(api).get(`/api/events/${eventId}/checklist`)).body
        .items as ChecklistItemView[];
      expect(after.map((item) => item.ruleIds[0])).toEqual(items.map((item) => item.ruleIds[0]));
    });

    it("distinguishes a checklist that does not exist from one with nothing in it", async () => {
      // Both render zero items, and they are different states: one offers creation, the other says
      // there is nothing to track. Only the acknowledgement separates them.
      const uncreated = await createEvent(scenario("A"));
      await insertPlan(uncreated, permits(A), "2026-07-22T10:00:00Z");
      const api = appWith(fakeStorage());
      const beforeCreate = await request(api).get(`/api/events/${uncreated}/checklist`);
      expect(beforeCreate.status).toBe(200);
      expect(beforeCreate.body.created).toBe(false);
      expect(beforeCreate.body.items).toEqual([]);

      // A plan with no trackable line at all: created, and still empty (Scenario B).
      const emptyEvent = await createEvent(scenario("A"));
      await insertPlan(
        emptyEvent,
        [{ ruleIds: ["ADV-NOISE-CODE-001"], kind: "advisory" }],
        "2026-07-22T10:00:00Z",
      );
      await review(api, emptyEvent);
      const emptyCreated = await request(api).get(`/api/events/${emptyEvent}/checklist`);
      expect(emptyCreated.body.created).toBe(true);
      expect(emptyCreated.body.items).toEqual([]);

      // Creating flips it, so the flag tracks the checklist and not the plan's shape.
      await review(api, uncreated);
      expect((await request(api).get(`/api/events/${uncreated}/checklist`)).body.created).toBe(
        true,
      );
    });

    it("rises when the regeneration removes every trackable requirement", async () => {
      // The case that defeated all four earlier shapes. Each of them asked the checklist whether
      // the latest plan held a line it was not pointing at; with every requirement gone there is
      // no such line, so the answer was no and the largest possible change to a plan produced
      // silence. Scenario B is exactly this plan — advisories only, nothing to track.
      const { eventId, api } = await startedFrom([A, B]);

      await insertPlan(
        eventId,
        [{ ruleIds: ["ADV-NOISE-CODE-001"], kind: "advisory" }],
        "2026-07-22T11:00:00Z",
      );

      expect(await flagOn(api, eventId)).toBe(true);
      // Both retained rows are struck through and nothing is deleted, so an empty trackable set on
      // the new plan is not an empty checklist.
      const items = (await request(api).get(`/api/events/${eventId}/checklist`)).body
        .items as ChecklistItemView[];
      expect(items).toHaveLength(2);
      expect(items.every((item) => item.struckThrough)).toBe(true);

      expect((await review(api, eventId)).body.planChanged).toBe(false);
      expect(await flagOn(api, eventId)).toBe(false);
    });

    it("answers from the acknowledgement row and from nothing else", async () => {
      // Pins the mechanism rather than the outcome. If the flag were still being derived from the
      // checklist's own rows, removing the acknowledgement would leave it unchanged; instead the
      // question becomes unanswerable and the checklist reads as never reviewed.
      const { eventId, api } = await startedFrom([A, B]);
      await insertPlan(eventId, permits(A), "2026-07-22T11:00:00Z");
      expect(await flagOn(api, eventId)).toBe(true);

      const { rowCount } = await pool.query(
        "DELETE FROM checklist_acknowledgements WHERE event_id = $1",
        [eventId],
      );
      expect(rowCount).toBe(1);
      expect(await flagOn(api, eventId)).toBe(false);
    });

    it("moves the acknowledgement forward on every review rather than accumulating rows", async () => {
      // One row per event (migration 002), and `acknowledged_at` must actually advance: Postgres
      // does not re-evaluate the column default on conflict, so an upsert that sets only plan_id
      // would report the first review forever.
      const { eventId, api } = await startedFrom([A, B]);
      const acknowledgement = async () =>
        (
          await pool.query<{ plan_id: string; acknowledged_at: Date }>(
            "SELECT plan_id, acknowledged_at FROM checklist_acknowledgements WHERE event_id = $1",
            [eventId],
          )
        ).rows;

      const [first] = await acknowledgement();
      const secondPlan = await insertPlan(eventId, permits(A), "2026-07-22T11:00:00Z");
      await review(api, eventId);

      const rows = await acknowledgement();
      expect(rows).toHaveLength(1);
      expect(rows[0]?.plan_id).toBe(secondPlan);
      expect(rows[0]?.acknowledged_at.getTime()).toBeGreaterThan(
        first?.acknowledged_at.getTime() ?? 0,
      );
    });

    it("stays raised for as long as the organizer has not re-materialized", async () => {
      const { eventId, api } = await startedFrom([A, B]);

      await insertPlan(eventId, permits(A), "2026-07-22T11:00:00Z");

      // Reading the checklist is not reviewing it; only re-creating it clears the prompt.
      expect(await flagOn(api, eventId)).toBe(true);
      expect(await flagOn(api, eventId)).toBe(true);
    });
  });

  // Review round 1, finding 7: a date and a status are not the whole regulatory answer.
  describe("published regulatory content on checklist items", () => {
    it("carries the confirm-with-agency notes and sources of a research_required deadline", async () => {
      const { body } = await checklistFor("A");
      const vendor = body.items.find((item) => item.ruleIds[0] === "DOHMH-VENDOR-PERMIT-001");

      // No computable date: everything this line means is in the published text.
      expect(vendor?.latestApplyDate).toBeNull();
      expect(vendor?.deadlineStatus).toBe("not_calculable");
      expect(vendor?.publishedNotes.join(" ")).toContain("onfirm with");
      expect(vendor?.sources[0]?.citation).toBeTruthy();
      expect(vendor?.sources[0]?.urls.length).toBeGreaterThan(0);
    });

    it("carries both readings and every source of an OFFICIAL_CONFLICT permit", async () => {
      // The answer key's headcount=20 boundary, where the exactly-20 Parks rule stops being
      // dormant. Its verification status is OFFICIAL_CONFLICT in the published ruleset.
      const eventId = await createEvent({ ...scenario("C"), headcount: 20 });
      await generatePlan(eventId);
      const response = await review(appWith(fakeStorage()), eventId);

      const conflicted = (response.body.items as ChecklistItemView[]).find(
        (item) => item.ruleIds[0] === "PARKS-EVENT-EXACTLY-20-001",
      );
      expect(conflicted?.verificationStatus).toBe("OFFICIAL_CONFLICT");
      // Both readings ride on the item; nothing here resolves the conflict to one of them.
      expect(conflicted?.conflictText).toBeTruthy();
      expect(conflicted?.sources.length).toBeGreaterThan(0);
    });

    it("refuses to serve an item whose published text is missing rather than dropping it", async () => {
      const eventId = await createEvent(scenario("A"));
      await generatePlan(eventId);
      // Read while the plan still renders, because that is the honest order: the organizer had it
      // on screen and pressed review, and the renderings were lost underneath them. Reading it
      // afterwards is not possible anyway — the GET the helper uses fails for the same reason the
      // POST under test does.
      const shown = (await request(appWith(fakeStorage())).get(`/api/events/${eventId}/checklist`))
        .body.planId as string;
      // A plan whose renderings were lost is a partial answer, and F-201 AC 5 already settled
      // that a partial plan is never served as a complete one.
      await pool.query(
        `UPDATE permit_plans SET verdict_detail = verdict_detail - 'finding_renderings'
          WHERE event_id = $1`,
        [eventId],
      );

      const response = await review(appWith(fakeStorage()), eventId, shown);

      expect(response.status).toBe(500);
      expect(response.body.error).toBe("checklist request failed");
      // The client is told nothing about the database or the plan's internals.
      expect(JSON.stringify(response.body)).not.toContain("verdict_detail");
    });
  });

  // Review round 1, findings 3, 4 and 5.
  describe("how a document gets to the bucket", () => {
    it("hands storage the request stream and the declared length, never a buffer it read itself", async () => {
      const storage = fakeStorage();
      const { body } = await checklistFor("A", storage);
      // Several chunks' worth, so this exercises the streamed path and the pushed-back head
      // rather than a body that happened to arrive whole in one read.
      const large = Buffer.concat([PDF, Buffer.alloc(256 * 1024, 0x20)]);

      const upload = await request(appWith(storage))
        .post(`/api/checklist-items/${body.items[0]?.id}/documents`)
        .set("Content-Type", "application/pdf")
        .send(large);

      expect(upload.status).toBe(201);
      const [stored] = [...storage.objects.values()];
      expect(stored?.receivedStream).toBe(true);
      expect(stored?.sizeBytes).toBe(large.byteLength);
      // Every byte arrived, and the bytes peeked for the format check were not eaten.
      expect(stored?.body).toEqual(large);
      expect(upload.body.sizeBytes).toBe(large.byteLength);
    });

    it("stores a body that ends inside the format check, since that stream cannot be pushed back", async () => {
      const storage = fakeStorage();
      const { body } = await checklistFor("A", storage);
      // A JPEG's signature is its whole content here: the request ends before the peek is full.
      const tiny = Buffer.from([0xff, 0xd8, 0xff]);

      const upload = await request(appWith(storage))
        .post(`/api/checklist-items/${body.items[0]?.id}/documents`)
        .set("Content-Type", "image/jpeg")
        .send(tiny);

      expect(upload.status).toBe(201);
      expect([...storage.objects.values()][0]?.body).toEqual(tiny);
    });

    it("keeps every document on an item, oldest first", async () => {
      const storage = fakeStorage();
      const { eventId, body } = await checklistFor("A", storage);
      const itemId = body.items[0]?.id as string;
      const api = appWith(storage);

      for (const filename of ["application.pdf", "site-map.png"]) {
        await request(api)
          .post(`/api/checklist-items/${itemId}/documents`)
          .set("Content-Type", filename.endsWith(".pdf") ? "application/pdf" : "image/png")
          .set("X-Filename", filename)
          .send(filename.endsWith(".pdf") ? PDF : PNG);
      }

      const read = await request(api).get(`/api/events/${eventId}/checklist`);
      const item = (read.body.items as ChecklistItemView[]).find((entry) => entry.id === itemId);
      expect(item?.documents.map((document) => document.filename)).toEqual([
        "application.pdf",
        "site-map.png",
      ]);
      expect(storage.objects.size).toBe(2);
    });

    it("refuses an upload that declares no length, since sizing it would mean buffering it", async () => {
      const storage = fakeStorage();
      const { body } = await checklistFor("A", storage);

      const status = await chunkedUpload(
        appWith(storage),
        `/api/checklist-items/${body.items[0]?.id}/documents`,
        PDF,
      );

      expect(status).toBe(411);
      expect(storage.objects.size).toBe(0);
    });

    /**
     * What the api does with the bytes when the metadata write reports failure.
     *
     * A rejected query is not the same as a rejected statement: Postgres can commit the insert and
     * the connection can drop before the result gets back. Round 1 deleted the object after any
     * rejection, which turned that case into a `documents` row pointing at bytes that no longer
     * exist — a document the organizer can see and click and get nothing from. The rule these
     * cases pin is that the object is only deleted when the row is known to be absent, because an
     * orphaned object is a failure nobody sees and orphaned metadata is a visible lie.
     */
    it("deletes the object when the server rejected the statement outright", async () => {
      const storage = fakeStorage();
      const { body } = await checklistFor("A", storage);
      const rejected = new DatabaseError("insert or update violates foreign key", 1, "error");
      rejected.code = "23503";
      const failing = poolIntercepting((text) =>
        text.includes("INSERT INTO documents") ? Promise.reject(rejected) : null,
      );

      const response = await uploadWith(failing, storage, body.items[0]?.id as string);

      // The server answered, so the statement never committed and nothing can reference the bytes.
      expect(response.status).toBe(500);
      expect(storage.objects.size).toBe(0);
      expect(JSON.stringify(response.body)).not.toContain("foreign key");
      // Established as not stored, so it carries no unknown marker: resending here is safe and
      // the client must not be sent to reconcile a document that provably does not exist.
      expect(response.body.storedOutcome).toBeUndefined();
    });

    it("deletes the object when the connection failed and the row is confirmed absent", async () => {
      const storage = fakeStorage();
      const { body } = await checklistFor("A", storage);
      const failing = poolIntercepting((text) =>
        text.includes("INSERT INTO documents")
          ? Promise.reject(new Error("connection terminated unexpectedly"))
          : null,
      );

      const response = await uploadWith(failing, storage, body.items[0]?.id as string);

      expect(response.status).toBe(500);
      expect(storage.objects.size).toBe(0);
      const { rows } = await pool.query("SELECT id FROM documents WHERE checklist_item_id = $1", [
        body.items[0]?.id,
      ]);
      expect(rows).toHaveLength(0);
      // The driver's message never reaches the client.
      expect(JSON.stringify(response.body)).not.toContain("connection terminated");
    });

    it("reports the document it stored when the insert committed but the client never heard so", async () => {
      const storage = fakeStorage();
      const { eventId, body } = await checklistFor("A", storage);
      const itemId = body.items[0]?.id as string;
      // The row lands and the connection then drops before the result returns: the query rejects
      // while the metadata exists. The lookup settles that it exists, and a stored document
      // reported as a failure is a wrong answer the code already has the truth to avoid. The
      // organizer retries, and each retry generates new ids and a new key, so every one of them
      // writes another object and another row for the same upload.
      const failing = poolIntercepting((text, values) =>
        text.includes("INSERT INTO documents")
          ? pool
              .query(text, values as unknown[])
              .then(() => Promise.reject(new Error("connection terminated unexpectedly")))
          : null,
      );

      const response = await uploadWith(failing, storage, itemId);

      const { rows } = await pool.query<{ id: string; storage_key: string; filename: string }>(
        "SELECT id, storage_key, filename FROM documents WHERE checklist_item_id = $1",
        [itemId],
      );
      expect(rows).toHaveLength(1);
      // The same answer the success path gives, describing the row that is actually there.
      expect(response.status).toBe(201);
      expect(response.body.id).toBe(rows[0]?.id);
      expect(response.body.filename).toBe(rows[0]?.filename);
      expect(response.body.contentType).toBe("application/pdf");
      expect(response.body.sizeBytes).toBe(PDF.length);
      expect(typeof response.body.uploadedAt).toBe("string");
      // The row survived, so the bytes it names must too.
      expect(storage.objects.has(rows[0]?.storage_key as string)).toBe(true);
      expect(storage.objects.size).toBe(1);
      // And it is listed exactly once, not as a duplicate of a retry.
      const listed = await request(appWith(storage)).get(`/api/events/${eventId}/checklist`);
      expect(
        (listed.body.items as ChecklistItemView[]).find((item) => item.id === itemId)?.documents,
      ).toHaveLength(1);
    });

    it("keeps the object when nothing can say whether the row was written", async () => {
      const storage = fakeStorage();
      const { body } = await checklistFor("A", storage);
      // The insert fails ambiguously and the database cannot be reached to settle it either.
      const failing = poolIntercepting((text) =>
        text.includes("documents")
          ? Promise.reject(new Error("connection terminated unexpectedly"))
          : null,
      );

      const response = await uploadWith(failing, storage, body.items[0]?.id as string);

      expect(response.status).toBe(500);
      // Unknown is not the same as failed, so the bytes stay and the key is logged for cleanup.
      expect(storage.objects.size).toBe(1);
      // And the client is told it is unknown. Every other failure here stored nothing, so a bare
      // 500 reads as "safe to resend" — which in this one case duplicates a committed row.
      expect(response.body.storedOutcome).toBe("unknown");
    });

    it("still reports the write failure when the compensating delete also fails", async () => {
      const { body } = await checklistFor("A");
      const stubborn: DocumentStorage = {
        put: async () => {},
        signedDownloadUrl: async () => "",
        remove: async () => {
          throw new DocumentStorageError("document storage is unavailable");
        },
      };
      const failing = Object.create(pool) as Pool;
      failing.query = ((text: string, values?: unknown[]) =>
        typeof text === "string" && text.includes("INSERT INTO documents")
          ? Promise.reject(new Error("connection terminated unexpectedly"))
          : pool.query(text as never, values as never)) as Pool["query"];

      const response = await request(
        createApp({
          database: pool,
          intakeContract,
          today: () => FIXTURE_TODAY,
          checklist: {
            database: failing,
            storage: stubborn,
            scheduleAlerts,
            jurisdiction: ruleset.jurisdiction,
          },
        }),
      )
        .post(`/api/checklist-items/${body.items[0]?.id}/documents`)
        .set("Content-Type", "application/pdf")
        .send(PDF);

      // The orphan is logged for manual deletion; the client is told about the write, not the
      // cleanup, and no metadata row exists either way.
      expect(response.status).toBe(500);
      const { rows } = await pool.query("SELECT id FROM documents WHERE checklist_item_id = $1", [
        body.items[0]?.id,
      ]);
      expect(rows).toHaveLength(0);
    });

    it("lets a browser preflight the upload header it is told to send", async () => {
      // web and api are separately hosted, so an upload from the browser preflights first. A
      // header missing from the allowlist fails there, before any of this feature's code runs.
      const response = await request(appWith(fakeStorage()))
        .options("/api/checklist-items/00000000-0000-4000-8000-000000000000/documents")
        .set("Origin", "http://localhost:3000")
        .set("Access-Control-Request-Method", "POST")
        .set("Access-Control-Request-Headers", "content-type,x-filename,x-upload-key");

      expect(response.status).toBe(204);
      const allowed = (response.headers["access-control-allow-headers"] ?? "").toLowerCase();
      expect(allowed).toContain("x-filename");
      // Without this the browser drops the idempotency key on a cross-origin upload, and every
      // repeat becomes a new document again — the failure would be invisible from the api's side.
      expect(allowed).toContain("x-upload-key");
    });
  });

  /**
   * #252. A merged dedupe line reads as ONE route, its binding route, and where that route
   * publishes no window the line's own columns carry none. The checklist reads those columns, so
   * before this it rendered an undated, feeless task for a requirement whose OTHER route publishes
   * a 15-business-day window and a TUP fee, and F-203 scheduled nothing at all.
   *
   * This is the whole of the published ruleset's dedupe group, driven end to end through the real
   * API: `structure_over_10ft_tall: "yes"` resolves DOB-TALL-STRUCTURE-001, which publishes no
   * deadline, while DOB-TENT-001's area/duration question is unanswered so its trigger is unknown.
   * The resolved route binds and the dated one does not.
   */
  describe("a merged dedupe line whose binding route publishes no window (#252)", () => {
    /** The intake the review measured: the tall-structure route resolved, the tent route not. */
    const TALL_TENT = {
      ...scenario("A"),
      structure_types: ["tent_canopy"],
      structure_over_10ft_tall: "yes",
      tent_area_sqft: null,
      tent_days_in_place: null,
    };

    const dobItem = async (): Promise<ChecklistItemView & Record<string, unknown>> => {
      const eventId = await createEvent(TALL_TENT);
      await generatePlan(eventId);
      const response = await review(appWith(fakeStorage()), eventId);
      expect(response.status).toBe(201);
      const item = (response.body.items as ChecklistItemView[]).find((candidate) =>
        candidate.ruleIds.includes("DOB-TENT-001"),
      );
      expect(item).toBeDefined();
      return item as ChecklistItemView & Record<string, unknown>;
    };

    it("keeps the filing date, the fee and the status the other route publishes", async () => {
      const item = await dobItem();
      // Both rules merged onto one line, and the line reads as the resolved route.
      expect(item.ruleIds).toEqual(["DOB-TENT-001", "DOB-TALL-STRUCTURE-001"]);
      expect(item.permitName).toBe("DOB permit — structure over 10 feet tall");
      // None of these is on the line's own columns; every one is DOB-TENT-001's, and the row says
      // so rather than presenting them as the named route's.
      expect(item.latestApplyDate).toBe("2026-08-05");
      expect(item.deadlineStatus).toBe("on_track");
      expect(item.feeDisplay).toBe(
        "TUP: $100 initial 30 days, $130 per additional period — confirm instrument",
      );
      expect(item.filingRouteRuleId).toBe("DOB-TENT-001");
    });

    it("carries both routes, each with its own name, window and fee", async () => {
      const item = await dobItem();
      expect(item.headlineMode).toBe("candidate");
      const routes = item.routes as Record<string, unknown>[];
      // IN BINDING ORDER: the route the line reads first, not the order the rules sit in the file.
      expect(routes.map((route) => route.ruleId)).toEqual([
        "DOB-TALL-STRUCTURE-001",
        "DOB-TENT-001",
      ]);
      expect(routes[0]).toMatchObject({
        triggerResult: "true",
        disposition: "may_be_required",
        latestApplyDate: null,
        deadlineStatus: "not_applicable",
        feeDisplay: null,
      });
      expect(routes[1]).toMatchObject({
        triggerResult: "unknown",
        latestApplyDate: "2026-08-05",
        deadlineStatus: "on_track",
      });
      expect(routes[1]?.unknownFields).toEqual(
        expect.arrayContaining(["tent_area_sqft", "tent_days_in_place"]),
      );
    });

    it("schedules the reminders that route's window earns, naming that route", async () => {
      const eventId = await createEvent(TALL_TENT);
      await generatePlan(eventId);
      await review(appWith(fakeStorage()), eventId, undefined, {
        contactEmail: "organizer@example.test",
      });

      const { rows } = await pool.query<{
        subject: string;
        send_at: Date;
        alert_type: string;
      }>(
        `SELECT alert.alert_type, alert.payload->>'subject' AS subject, alert.send_at
           FROM alerts AS alert
           JOIN checklist_items AS checklist ON checklist.id = alert.checklist_item_id
           JOIN permit_plan_items AS item ON item.id = checklist.plan_item_id
          WHERE alert.event_id = $1 AND 'DOB-TENT-001' = ANY(item.rule_ids)
          ORDER BY alert.send_at`,
        [eventId],
      );

      // One per published offset, exactly as an unmerged dated requirement gets.
      expect(rows).toHaveLength(reminderOffsets.length);
      expect(rows.every((row) => row.alert_type === "deadline_reminder")).toBe(true);
      // The reminder names the route whose window it counts down to, not the route the line reads.
      expect(rows[0]?.subject).toContain("tent/canopy");
      expect(rows[0]?.subject).not.toContain("structure over 10 feet tall");
    });
  });
});
