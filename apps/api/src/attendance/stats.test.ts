import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { Pool } from "pg";
import { parseIntakeContract } from "@pop-engine/engine";
import {
  FIXTURE_TODAY,
  SCENARIO_INTAKE_FIXTURES,
  fixtureSubmission,
} from "@pop-engine/engine/fixtures";
import { createApp } from "../app";
import { loadRuleset } from "../ruleset";
import { readEventStats } from "./stats";

const databaseUrl = process.env.DATABASE_URL ?? "";

const scenarioA = (): Record<string, unknown> => {
  const fixture = SCENARIO_INTAKE_FIXTURES.find((candidate) => candidate.scenario === "A");
  if (fixture === undefined) throw new Error("no fixture A");
  return fixtureSubmission(fixture);
};

describe.runIf(databaseUrl.length > 0)("F-402 event stats", () => {
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
    return { id, capacity: response.body.event.capacity as number | null };
  };

  const insertRsvp = async (
    eventId: string,
    guest: { name: string; email: string; status?: "confirmed" | "cancelled" },
  ) => {
    const id = randomUUID();
    await database.query(
      `INSERT INTO rsvps (id, event_id, name, email, phone, status)
       VALUES ($1, $2, $3, $4, NULL, $5)`,
      [id, eventId, guest.name, guest.email, guest.status ?? "confirmed"],
    );
    return id;
  };

  it("returns zeros and null capacity when nothing has been recorded", async () => {
    const { id: eventId } = await createEvent({ capacity: null });

    const response = await request(api).get(`/api/events/${eventId}/stats`);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      checkins_total: 0,
      checkins_registered: 0,
      checkins_walk_in: 0,
      rsvps_total: 0,
      capacity: null,
      checkins_last_10min: 0,
    });
  });

  it("counts check-ins, registered vs walk-in, confirmed RSVPs, capacity, and the last-10-minute window", async () => {
    const { id: eventId } = await createEvent({ capacity: 50, headcount: 50 });
    await insertRsvp(eventId, { name: "Confirmed", email: "confirmed@example.com" });
    await insertRsvp(eventId, {
      name: "Cancelled",
      email: "cancelled@example.com",
      status: "cancelled",
    });

    const recent = await request(api)
      .post(`/api/events/${eventId}/checkins`)
      .send({ name: "Recent", contact: "confirmed@example.com" });
    expect(recent.status).toBe(201);
    expect(recent.body.checkin.rsvp_id).toEqual(expect.any(String));

    const walkIn = await request(api)
      .post(`/api/events/${eventId}/checkins`)
      .send({ name: "Walk-in", contact: "walkin@example.com" });
    expect(walkIn.status).toBe(201);
    expect(walkIn.body.checkin.rsvp_id).toBeNull();

    const olderId = randomUUID();
    await database.query(
      `INSERT INTO checkins (id, event_id, rsvp_id, name, contact, checked_in_at)
       VALUES ($1, $2, NULL, 'Older', 'older@example.com', now() - interval '11 minutes')`,
      [olderId, eventId],
    );

    const response = await request(api).get(`/api/events/${eventId}/stats`);
    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      checkins_total: 3,
      checkins_registered: 1,
      checkins_walk_in: 2,
      rsvps_total: 1,
      capacity: 50,
      checkins_last_10min: 2,
    });
  });

  it("does not double-count a repeated check-in contact", async () => {
    const { id: eventId } = await createEvent({ capacity: 10 });
    await request(api)
      .post(`/api/events/${eventId}/checkins`)
      .send({ name: "First", contact: "dup@example.com" });
    await request(api)
      .post(`/api/events/${eventId}/checkins`)
      .send({ name: "Second", contact: "dup@example.com" });

    const response = await request(api).get(`/api/events/${eventId}/stats`);
    expect(response.status).toBe(200);
    expect(response.body.checkins_total).toBe(1);
    expect(response.body.checkins_walk_in).toBe(1);
    expect(response.body.checkins_registered).toBe(0);
    expect(response.body.checkins_last_10min).toBe(1);
  });

  it("rejects a malformed id and answers 404 for an unknown event", async () => {
    const bad = await request(api).get("/api/events/not-a-uuid/stats");
    expect(bad.status).toBe(400);

    const missing = await request(api).get(`/api/events/${randomUUID()}/stats`);
    expect(missing.status).toBe(404);
  });

  it("readEventStats matches the HTTP body for an empty event", async () => {
    const { id: eventId } = await createEvent({ capacity: 3 });
    const result = await readEventStats(database, eventId);
    expect(result).toEqual({
      status: 200,
      body: {
        checkins_total: 0,
        checkins_registered: 0,
        checkins_walk_in: 0,
        rsvps_total: 0,
        capacity: 3,
        checkins_last_10min: 0,
      },
    });
  });
});
