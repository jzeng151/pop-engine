import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { Pool, type QueryResult, type QueryResultRow } from "pg";
import { parseIntakeContract } from "@pop-engine/engine";
import {
  FIXTURE_TODAY,
  SCENARIO_INTAKE_FIXTURES,
  fixtureSubmission,
} from "@pop-engine/engine/fixtures";
import { createApp } from "./app";
import { createCheckinsRouter, normalizeContact, recordCheckin, type CheckinRow } from "./checkins";
import { loadRuleset } from "./ruleset";

const databaseUrl = process.env.DATABASE_URL ?? "";

const scenarioA = (): Record<string, unknown> => {
  const fixture = SCENARIO_INTAKE_FIXTURES.find((candidate) => candidate.scenario === "A");
  if (fixture === undefined) throw new Error("no fixture A");
  return fixtureSubmission(fixture);
};

type ScriptedRow = QueryResultRow;

function scriptedDatabase(
  handlers: Array<{
    when: (sql: string, values: unknown[] | undefined) => boolean;
    rows: ScriptedRow[];
  }>,
) {
  return {
    async query<Row extends QueryResultRow>(
      text: string,
      values?: unknown[],
    ): Promise<QueryResult<Row>> {
      const handler = handlers.find((candidate) => candidate.when(text, values));
      if (handler === undefined) {
        throw new Error(`unexpected query: ${text}`);
      }
      return {
        rows: handler.rows as Row[],
        rowCount: handler.rows.length,
        command: "SELECT",
        oid: 0,
        fields: [],
      };
    },
  };
}

describe("normalizeContact", () => {
  it("lower-cases and trims emails", () => {
    expect(normalizeContact("  Alex@Example.COM ")).toEqual({
      ok: true,
      contact: "alex@example.com",
      kind: "email",
    });
  });

  it("keeps phone digits only so formatting variants share an identity", () => {
    expect(normalizeContact("(555) 123-4567")).toEqual({
      ok: true,
      contact: "5551234567",
      kind: "phone",
    });
    expect(normalizeContact("+1 555 123 4567")).toEqual({
      ok: true,
      contact: "15551234567",
      kind: "phone",
    });
    expect(normalizeContact("+123456789012345")).toEqual({
      ok: true,
      contact: "123456789012345",
      kind: "phone",
    });
  });

  it("rejects blank, malformed email, disallowed phone characters, and invalid digit counts", () => {
    expect(normalizeContact("").ok).toBe(false);
    expect(normalizeContact("not-an-email").ok).toBe(false);
    expect(normalizeContact("no-dot@domain").ok).toBe(false);
    expect(normalizeContact("555-123").ok).toBe(false);
    expect(normalizeContact("call-212-555-1212").ok).toBe(false);
    expect(normalizeContact("1234567890123456").ok).toBe(false);
  });
});

describe("recordCheckin (scripted)", () => {
  const eventId = "11111111-1111-4111-8111-111111111111";
  const rsvpId = "22222222-2222-4222-8222-222222222222";
  const openEvent = { id: eventId, name: "Event", event_date: FIXTURE_TODAY };
  const record = (database: ReturnType<typeof scriptedDatabase>, id: string, body: unknown) =>
    recordCheckin(database, id, body, FIXTURE_TODAY);

  it("links a walk-in when no RSVP contact matches", async () => {
    const database = scriptedDatabase([
      {
        when: (sql) => sql.includes("FROM events"),
        rows: [openEvent],
      },
      { when: (sql) => sql.includes("FROM rsvps"), rows: [] },
      {
        when: (sql) => sql.includes("INSERT INTO checkins"),
        rows: [
          {
            id: "33333333-3333-4333-8333-333333333333",
            event_id: eventId,
            rsvp_id: null,
            name: "Walk In",
            contact: "walkin@example.com",
            checked_in_at: "2026-07-25T12:00:00.000Z",
            was_inserted: true,
          },
        ],
      },
    ]);

    const result = await record(database, eventId, {
      name: "Walk In",
      contact: "walkin@example.com",
    });
    expect(result.status).toBe(201);
    if (result.status !== 201) return;
    expect(result.body.checkin.rsvp_id).toBeNull();
    expect(result.body.checkin.contact).toBe("walkin@example.com");
  });

  it("links an RSVP when the normalized contact matches", async () => {
    const database = scriptedDatabase([
      {
        when: (sql) => sql.includes("FROM events"),
        rows: [openEvent],
      },
      { when: (sql) => sql.includes("FROM rsvps"), rows: [{ id: rsvpId }] },
      {
        when: (sql) => sql.includes("INSERT INTO checkins"),
        rows: [
          {
            id: "33333333-3333-4333-8333-333333333333",
            event_id: eventId,
            rsvp_id: rsvpId,
            name: "Guest",
            contact: "guest@example.com",
            checked_in_at: "2026-07-25T12:00:00.000Z",
            was_inserted: true,
          },
        ],
      },
    ]);

    const result = await record(database, eventId, {
      name: "Guest",
      contact: "Guest@Example.com",
    });
    expect(result.status).toBe(201);
    if (result.status !== 201) return;
    expect(result.body.checkin.rsvp_id).toBe(rsvpId);
  });

  it("updates rather than double-counting the same contact", async () => {
    const database = scriptedDatabase([
      {
        when: (sql) => sql.includes("FROM events"),
        rows: [openEvent],
      },
      { when: (sql) => sql.includes("FROM rsvps"), rows: [] },
      {
        when: (sql) => sql.includes("INSERT INTO checkins"),
        rows: [
          {
            id: "33333333-3333-4333-8333-333333333333",
            event_id: eventId,
            rsvp_id: null,
            name: "Updated Name",
            contact: "dup@example.com",
            checked_in_at: "2026-07-25T13:00:00.000Z",
            was_inserted: false,
          },
        ],
      },
    ]);

    const result = await record(database, eventId, {
      name: "Updated Name",
      contact: "dup@example.com",
    });
    expect(result.status).toBe(200);
    if (result.status !== 200) return;
    expect(result.body.checkin.name).toBe("Updated Name");
  });

  it("rejects a malformed event id without querying the database", async () => {
    const database = scriptedDatabase([]);
    const result = await record(database, "not-a-uuid", {
      name: "A",
      contact: "a@example.com",
    });
    expect(result).toEqual({
      status: 400,
      body: { error: "That check-in link is not valid." },
    });
  });

  it("returns a friendly 404 when the event is unknown", async () => {
    const database = scriptedDatabase([{ when: (sql) => sql.includes("FROM events"), rows: [] }]);
    const result = await record(database, eventId, {
      name: "A",
      contact: "a@example.com",
    });
    expect(result).toEqual({
      status: 404,
      body: { error: "That event was not found." },
    });
  });

  it("rejects a missing name", async () => {
    const database = scriptedDatabase([]);
    const result = await record(database, eventId, { contact: "a@example.com" });
    expect(result.status).toBe(400);
    if (result.status !== 400) return;
    expect(result.body.error).toMatch(/name/i);
  });

  it("rejects a non-object body and a non-string contact", async () => {
    const database = scriptedDatabase([]);
    expect(await record(database, eventId, null)).toEqual({
      status: 400,
      body: { error: "body must be a JSON object" },
    });
    expect(await record(database, eventId, { name: "A", contact: 12 })).toEqual({
      status: 400,
      body: { error: "contact is required" },
    });
  });

  it("rejects a malformed contact after the body parses", async () => {
    const database = scriptedDatabase([]);
    const result = await record(database, eventId, {
      name: "A",
      contact: "not-valid",
    });
    expect(result.status).toBe(400);
    if (result.status !== 400) return;
    expect(result.body.error).toMatch(/email or phone/i);
  });

  it("fails softly when INSERT returns no row", async () => {
    const database = scriptedDatabase([
      {
        when: (sql) => sql.includes("FROM events"),
        rows: [openEvent],
      },
      { when: (sql) => sql.includes("FROM rsvps"), rows: [] },
      { when: (sql) => sql.includes("INSERT INTO checkins"), rows: [] },
    ]);
    await expect(
      record(database, eventId, { name: "A", contact: "a@example.com" }),
    ).resolves.toEqual({
      status: 400,
      body: { error: "Check-in could not be recorded." },
    });
  });
});

describe("F-401 route wiring", () => {
  it("returns only the public event identity needed by the form", async () => {
    const eventId = "11111111-1111-4111-8111-111111111111";
    const database = scriptedDatabase([
      {
        when: (sql) => sql.includes("SELECT id, name, event_date::text"),
        rows: [
          {
            id: eventId,
            name: "Bushwick Night",
            event_date: FIXTURE_TODAY,
            private_answer: "not returned",
          },
        ],
      },
    ]);
    const app = createApp({
      database: database as unknown as Pool,
      intakeContract: parseIntakeContract((await loadRuleset()).document),
      today: () => FIXTURE_TODAY,
    });
    const response = await request(app).get(`/api/events/${eventId}/checkins`);
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ event: { id: eventId, name: "Bushwick Night" } });
  });

  it("answers through the mounted router", async () => {
    const eventId = "11111111-1111-4111-8111-111111111111";
    const database = scriptedDatabase([
      {
        when: (sql) => sql.includes("FROM events"),
        rows: [{ id: eventId, name: "Event", event_date: FIXTURE_TODAY }],
      },
      { when: (sql) => sql.includes("FROM rsvps"), rows: [] },
      {
        when: (sql) => sql.includes("INSERT INTO checkins"),
        rows: [
          {
            id: randomUUID(),
            event_id: eventId,
            rsvp_id: null,
            name: "Route Guest",
            contact: "route@example.com",
            checked_in_at: "2026-07-25T12:00:00.000Z",
            was_inserted: true,
          } satisfies CheckinRow & { was_inserted: boolean },
        ],
      },
    ]);

    const app = createApp({
      database: database as unknown as Pool,
      intakeContract: parseIntakeContract((await loadRuleset()).document),
      today: () => FIXTURE_TODAY,
    });

    const response = await request(app)
      .post(`/api/events/${eventId}/checkins`)
      .send({ name: "Route Guest", contact: "route@example.com" });
    expect(response.status).toBe(201);
    expect(response.body.checkin.contact).toBe("route@example.com");
  });

  it("exposes the router factory for dedicated mounting", () => {
    const router = createCheckinsRouter({
      database: scriptedDatabase([]) as unknown as Pool,
      today: () => FIXTURE_TODAY,
    });
    expect(router).toBeDefined();
  });

  it("rejects an expired event on both the public lookup and direct submission", async () => {
    const eventId = "11111111-1111-4111-8111-111111111111";
    const database = scriptedDatabase([
      {
        when: (sql) => sql.includes("FROM events"),
        rows: [{ id: eventId, name: "Ended event", event_date: "2026-07-21" }],
      },
    ]);
    const app = createApp({
      database: database as unknown as Pool,
      intakeContract: parseIntakeContract((await loadRuleset()).document),
      today: () => FIXTURE_TODAY,
    });

    const lookup = await request(app).get(`/api/events/${eventId}/checkins`);
    const submission = await request(app)
      .post(`/api/events/${eventId}/checkins`)
      .send({ name: "Late Guest", contact: "late@example.com" });

    expect(lookup.status).toBe(410);
    expect(submission.status).toBe(410);
    expect(lookup.body.error).toMatch(/ended/i);
    expect(submission.body.error).toMatch(/ended/i);
  });
});

describe.runIf(databaseUrl.length > 0)("F-401 check-in endpoints (database)", () => {
  let database: Pool;
  let api: ReturnType<typeof createApp>;
  const createdEventIds: string[] = [];

  beforeAll(async () => {
    database = new Pool({ connectionString: databaseUrl });
    api = createApp({
      database,
      intakeContract: parseIntakeContract((await loadRuleset()).document),
      today: () => FIXTURE_TODAY,
    });
  });

  afterAll(async () => {
    if (createdEventIds.length > 0) {
      await database.query("DELETE FROM checkins WHERE event_id = ANY($1)", [createdEventIds]);
      await database.query("DELETE FROM rsvps WHERE event_id = ANY($1)", [createdEventIds]);
      await database.query("DELETE FROM events WHERE id = ANY($1)", [createdEventIds]);
    }
    await database.end();
  });

  const createEvent = async (overrides: Record<string, unknown> = {}) => {
    const response = await request(api)
      .post("/api/events")
      .send({ ...scenarioA(), ...overrides });
    expect(response.status).toBe(201);
    const id: string = response.body.event.id;
    createdEventIds.push(id);
    return { id };
  };

  const insertRsvp = async (
    eventId: string,
    guest: { name: string; email: string; phone?: string | null },
  ) => {
    const id = randomUUID();
    await database.query(
      `INSERT INTO rsvps (id, event_id, name, email, phone, status)
       VALUES ($1, $2, $3, $4, $5, 'confirmed')`,
      [id, eventId, guest.name, guest.email, guest.phone ?? null],
    );
    return id;
  };

  it("matches an RSVP by email contact", async () => {
    const { id: eventId } = await createEvent();
    const rsvpId = await insertRsvp(eventId, {
      name: "Sam Guest",
      email: "sam.guest@example.com",
    });

    const response = await request(api)
      .post(`/api/events/${eventId}/checkins`)
      .send({ name: "Sam Guest", contact: "Sam.Guest@Example.com" });

    expect(response.status).toBe(201);
    expect(response.body.checkin.rsvp_id).toBe(rsvpId);
    expect(response.body.checkin.contact).toBe("sam.guest@example.com");
  });

  it("matches an RSVP by phone contact and records a walk-in otherwise", async () => {
    const { id: eventId } = await createEvent();
    const rsvpId = await insertRsvp(eventId, {
      name: "Pat Phone",
      email: "pat.phone@example.com",
      phone: "(555) 987-6543",
    });

    const matched = await request(api)
      .post(`/api/events/${eventId}/checkins`)
      .send({ name: "Pat Phone", contact: "555-987-6543" });
    expect(matched.status).toBe(201);
    expect(matched.body.checkin.rsvp_id).toBe(rsvpId);
    expect(matched.body.checkin.contact).toBe("5559876543");

    const walkIn = await request(api)
      .post(`/api/events/${eventId}/checkins`)
      .send({ name: "Walk In", contact: "walkin@example.com" });
    expect(walkIn.status).toBe(201);
    expect(walkIn.body.checkin.rsvp_id).toBeNull();
  });

  it("updates a duplicate submission instead of double-counting", async () => {
    const { id: eventId } = await createEvent();
    const first = await request(api)
      .post(`/api/events/${eventId}/checkins`)
      .send({ name: "First", contact: "dup@example.com" });
    expect(first.status).toBe(201);

    const second = await request(api)
      .post(`/api/events/${eventId}/checkins`)
      .send({ name: "Second", contact: "dup@example.com" });
    expect(second.status).toBe(200);
    expect(second.body.checkin.id).toBe(first.body.checkin.id);
    expect(second.body.checkin.name).toBe("Second");

    const { rows } = await database.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM checkins WHERE event_id = $1 AND contact = $2",
      [eventId, "dup@example.com"],
    );
    expect(rows[0]?.count).toBe("1");
  });

  it("treats the same name with different contacts as distinct attendees", async () => {
    const { id: eventId } = await createEvent();
    const one = await request(api)
      .post(`/api/events/${eventId}/checkins`)
      .send({ name: "Alex", contact: "alex-a@example.com" });
    const two = await request(api)
      .post(`/api/events/${eventId}/checkins`)
      .send({ name: "Alex", contact: "alex-b@example.com" });
    expect(one.status).toBe(201);
    expect(two.status).toBe(201);
    expect(one.body.checkin.id).not.toBe(two.body.checkin.id);

    const { rows } = await database.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM checkins WHERE event_id = $1",
      [eventId],
    );
    expect(rows[0]?.count).toBe("2");
  });

  it("still records when the event is already over capacity or headcount", async () => {
    const { id: eventId } = await createEvent({ capacity: 1, headcount: 1 });
    for (const contact of ["a@example.com", "b@example.com", "c@example.com"]) {
      const response = await request(api)
        .post(`/api/events/${eventId}/checkins`)
        .send({ name: "Guest", contact });
      expect(response.status).toBe(201);
    }
    const { rows } = await database.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM checkins WHERE event_id = $1",
      [eventId],
    );
    expect(rows[0]?.count).toBe("3");
  });

  it("returns friendly errors for malformed and unknown event ids", async () => {
    const malformed = await request(api)
      .post("/api/events/not-a-uuid/checkins")
      .send({ name: "A", contact: "a@example.com" });
    expect(malformed.status).toBe(400);
    expect(malformed.body.error).toMatch(/not valid/i);
    expect(JSON.stringify(malformed.body)).not.toMatch(/postgres|stack|relation/i);

    const unknown = await request(api)
      .post(`/api/events/${randomUUID()}/checkins`)
      .send({ name: "A", contact: "a@example.com" });
    expect(unknown.status).toBe(404);
    expect(unknown.body.error).toMatch(/not found/i);
    expect(JSON.stringify(unknown.body)).not.toMatch(/postgres|stack|relation/i);
  });
});
