// DEMO SCOPE. The obtained-permits read path and its one write, against a real schema. Runs only
// when a database is configured, matching the other schema-backed suites (CI applies `migrate up`
// first). Not F-208.
//
// Everything here goes through the same endpoints the browser calls: an event is created through
// intake, a plan is generated, the checklist is materialized, and an item is set to `approved`
// with F-202's own PATCH, which is how an already-obtained permit is representable today.

import type { Readable } from "node:stream";
import { Pool } from "pg";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
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
import { deadlineReminderOffsets, loadRuleset } from "./ruleset";
import { attachmentDisposition, type DocumentStorage } from "./storage";

const databaseUrl = process.env.DATABASE_URL ?? "";

const PDF = Buffer.concat([Buffer.from("%PDF-1.7"), Buffer.alloc(64, 0x20)]);

const collect = async (body: Readable): Promise<Buffer> => {
  const chunks: Buffer[] = [];
  for await (const chunk of body) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
};

const fakeStorage = (): DocumentStorage & { objects: Map<string, Buffer> } => {
  const objects = new Map<string, Buffer>();
  return {
    objects,
    put: async (key, body) => {
      objects.set(key, await collect(body));
    },
    signedDownloadUrl: async (key, expiresInSeconds, filename) =>
      `https://storage.test/${key}?X-Amz-Expires=${expiresInSeconds}` +
      `&response-content-disposition=${encodeURIComponent(attachmentDisposition(filename))}`,
    remove: async (key) => {
      objects.delete(key);
    },
  };
};

const scenario = (id: string): Record<string, unknown> => {
  const fixture = SCENARIO_INTAKE_FIXTURES.find((candidate) => candidate.scenario === id);
  if (fixture === undefined) throw new Error(`no fixture ${id}`);
  return fixtureSubmission(fixture);
};

type PermitView = {
  id: string;
  permitName: string | null;
  permitNumber: string | null;
  issuedOn: string | null;
  expiresOn: string | null;
  expired: boolean | null;
  documents: { id: string; filename: string }[];
};

describe.runIf(databaseUrl.length > 0)("demo obtained permits", () => {
  let pool: Pool;
  let ruleset: EngineRuleset;
  let intakeContract: IntakeContract;
  const createdEventIds: string[] = [];

  let reminderOffsets: readonly number[] = [];

  const fixtureCalendar = (calendarId: string): HolidayCalendar => ({ id: calendarId, holidays: [] });

  /**
   * F-203 runs inside the materialization these tests drive. No test here supplies a contact, so
   * the scheduler resolves no channel and writes no alert row.
   */
  const scheduleAlerts: AlertScheduler = (...args) =>
    createAlertScheduler({
      reminderDaysBefore: reminderOffsets,
      slackWarningDays: ruleset.slackWarningDays,
      jurisdiction: ruleset.jurisdiction,
    })(...args);

  const api = (storage: DocumentStorage = fakeStorage()) =>
    createApp({
      database: pool,
      intakeContract,
      today: () => FIXTURE_TODAY,
      planService: createPlanService(pool, ruleset, fixtureCalendar, () => FIXTURE_TODAY),
      checklist: { database: pool, storage, scheduleAlerts },
    });

  /** An event with a materialized checklist, and the ids of its items. */
  const eventWithChecklist = async (app = api()): Promise<{ eventId: string; itemIds: string[] }> => {
    const created = await request(app).post("/api/events").send(scenario("A"));
    expect(created.status).toBe(201);
    const eventId = created.body.event.id as string;
    createdEventIds.push(eventId);
    expect((await request(app).post(`/api/events/${eventId}/plan`)).status).toBe(201);
    const shown = await request(app).get(`/api/events/${eventId}/checklist`);
    const review = await request(app)
      .post(`/api/events/${eventId}/checklist`)
      .send({ planId: shown.body.planId });
    expect(review.status).toBe(201);
    return {
      eventId,
      itemIds: (review.body.items as { id: string }[]).map((item) => item.id),
    };
  };

  const approve = async (app: ReturnType<typeof api>, itemId: string): Promise<void> => {
    const response = await request(app).patch(`/api/checklist-items/${itemId}`).send({
      status: "approved",
    });
    expect(response.status).toBe(200);
  };

  const permitsOf = async (app: ReturnType<typeof api>, eventId: string): Promise<PermitView[]> => {
    const response = await request(app).get(`/api/events/${eventId}/obtained-permits`);
    expect(response.status).toBe(200);
    return response.body.items as PermitView[];
  };

  beforeAll(async () => {
    pool = new Pool({ connectionString: databaseUrl });
    const loaded = await loadRuleset();
    ruleset = parseEngineRuleset(loaded.document);
    intakeContract = parseIntakeContract(loaded.document);
    reminderOffsets = deadlineReminderOffsets(loaded);
  });

  afterAll(async () => {
    if (createdEventIds.length > 0) {
      // Same order the F-202 suite tears down in: alerts and contacts, then documents, items,
      // plan items, the acknowledgement whose composite key references a plan, then the plans
      // and the events.
      await pool.query("DELETE FROM alerts WHERE event_id = ANY($1)", [createdEventIds]);
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
      await pool.query("DELETE FROM checklist_acknowledgements WHERE event_id = ANY($1)", [
        createdEventIds,
      ]);
      await pool.query("DELETE FROM permit_plans WHERE event_id = ANY($1)", [createdEventIds]);
      await pool.query("DELETE FROM events WHERE id = ANY($1)", [createdEventIds]);
    }
    await pool.end();
  });

  it("lists nothing for an event whose items are none of them approved", async () => {
    const app = api();
    const { eventId, itemIds } = await eventWithChecklist(app);
    expect(itemIds.length).toBeGreaterThan(0);

    expect(await permitsOf(app, eventId)).toEqual([]);
  });

  it("lists an approved item with every recorded field null until the organizer enters one", async () => {
    const app = api();
    const { eventId, itemIds } = await eventWithChecklist(app);
    await approve(app, itemIds[0] as string);

    const items = await permitsOf(app, eventId);
    expect(items).toHaveLength(1);
    const [permit] = items;
    expect(permit?.permitNumber).toBeNull();
    expect(permit?.issuedOn).toBeNull();
    // Null rather than false: nothing is inferred from an expiry the organizer never recorded.
    expect(permit?.expiresOn).toBeNull();
    expect(permit?.expired).toBeNull();
    expect(permit?.documents).toEqual([]);
  });

  it("records what the organizer enters and reads it back unchanged", async () => {
    const app = api();
    const { eventId, itemIds } = await eventWithChecklist(app);
    const itemId = itemIds[0] as string;
    await approve(app, itemId);

    const recorded = await request(app)
      .patch(`/api/checklist-items/${itemId}/permit-record`)
      .send({ permitNumber: "SAPO-2026-4471", issuedOn: "2026-01-05", expiresOn: "2027-01-04" });
    expect(recorded.status).toBe(200);

    const [permit] = await permitsOf(app, eventId);
    expect(permit?.permitNumber).toBe("SAPO-2026-4471");
    expect(permit?.issuedOn).toBe("2026-01-05");
    expect(permit?.expiresOn).toBe("2027-01-04");
    expect(permit?.expired).toBe(false);
  });

  it("reports an expiry before today as expired, against the injected clock", async () => {
    const app = api();
    const { eventId, itemIds } = await eventWithChecklist(app);
    const itemId = itemIds[0] as string;
    await approve(app, itemId);
    await request(app)
      .patch(`/api/checklist-items/${itemId}/permit-record`)
      .send({ expiresOn: "2020-03-01" });

    const [permit] = await permitsOf(app, eventId);
    expect(permit?.expiresOn).toBe("2020-03-01");
    expect(permit?.expired).toBe(true);
  });

  it("clears a recorded value back to null and leaves the fields it was not sent alone", async () => {
    const app = api();
    const { eventId, itemIds } = await eventWithChecklist(app);
    const itemId = itemIds[0] as string;
    await approve(app, itemId);
    await request(app)
      .patch(`/api/checklist-items/${itemId}/permit-record`)
      .send({ permitNumber: "A-1", issuedOn: "2026-02-02" });

    await request(app)
      .patch(`/api/checklist-items/${itemId}/permit-record`)
      .send({ permitNumber: "  " });

    const [permit] = await permitsOf(app, eventId);
    expect(permit?.permitNumber).toBeNull();
    expect(permit?.issuedOn).toBe("2026-02-02");
  });

  it("round trips an attached document to a signed download url", async () => {
    const storage = fakeStorage();
    const app = api(storage);
    const { eventId, itemIds } = await eventWithChecklist(app);
    const itemId = itemIds[0] as string;
    await approve(app, itemId);

    const uploaded = await request(app)
      .post(`/api/checklist-items/${itemId}/documents`)
      .set("Content-Type", "application/pdf")
      .set("X-Filename", "permit.pdf")
      .send(PDF);
    expect(uploaded.status).toBe(201);

    const [permit] = await permitsOf(app, eventId);
    expect(permit?.documents).toHaveLength(1);
    const documentId = permit?.documents[0]?.id as string;
    expect(permit?.documents[0]?.filename).toBe("permit.pdf");

    const link = await request(app).get(`/api/documents/${documentId}/url`);
    expect(link.status).toBe(200);
    expect(link.body.url).toContain("https://storage.test/");
    const key = new URL(link.body.url as string).pathname.slice(1);
    expect(storage.objects.get(key)).toEqual(PDF);
  });

  it("refuses ids and values it will not store", async () => {
    const app = api();
    const { eventId, itemIds } = await eventWithChecklist(app);
    const itemId = itemIds[0] as string;

    expect((await request(app).get("/api/events/not-a-uuid/obtained-permits")).status).toBe(400);
    expect(
      (await request(app).get("/api/events/2f1c9d64-0f66-4d4f-9c7f-9a2d3e4b5c60/obtained-permits"))
        .status,
    ).toBe(404);
    expect(
      (await request(app).patch("/api/checklist-items/not-a-uuid/permit-record").send({}))
        .status,
    ).toBe(400);
    expect(
      (await request(app).patch(`/api/checklist-items/${itemId}/permit-record`).send([])).status,
    ).toBe(400);
    expect(
      (await request(app).patch(`/api/checklist-items/${itemId}/permit-record`).send({})).status,
    ).toBe(400);
    expect(
      (
        await request(app)
          .patch(`/api/checklist-items/${itemId}/permit-record`)
          .send({ permitNumber: 7 })
      ).status,
    ).toBe(400);
    // A well-formed string that names no day. Storing it would show a date nobody typed.
    expect(
      (
        await request(app)
          .patch(`/api/checklist-items/${itemId}/permit-record`)
          .send({ issuedOn: "2026-02-30" })
      ).status,
    ).toBe(400);
    expect(
      (
        await request(app)
          .patch(`/api/checklist-items/${itemId}/permit-record`)
          .send({ expiresOn: "next tuesday" })
      ).status,
    ).toBe(400);
    expect(
      (
        await request(app)
          .patch("/api/checklist-items/2f1c9d64-0f66-4d4f-9c7f-9a2d3e4b5c60/permit-record")
          .send({ permitNumber: "A-1" })
      ).status,
    ).toBe(404);
    expect(eventId).toBeTruthy();
  });
});
