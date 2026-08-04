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
import { createApp } from "./app";
import { cancelRsvp, createRsvp, listRsvps, normalizeEmail, normalizeOptionalPhone } from "./rsvps";
import { loadRuleset } from "./ruleset";

const databaseUrl = process.env.DATABASE_URL ?? "";

const scenarioA = (): Record<string, unknown> => {
  const fixture = SCENARIO_INTAKE_FIXTURES.find((candidate) => candidate.scenario === "A");
  if (fixture === undefined) throw new Error("no fixture A");
  return fixtureSubmission(fixture);
};

describe("normalizeEmail / normalizeOptionalPhone", () => {
  it("lower-cases emails and rejects malformed ones", () => {
    expect(normalizeEmail("  Guest@Example.COM ")).toEqual({
      ok: true,
      email: "guest@example.com",
    });
    expect(normalizeEmail("no-dot@domain").ok).toBe(false);
    expect(normalizeEmail("").ok).toBe(false);
  });

  it("keeps optional phone as digits or null", () => {
    expect(normalizeOptionalPhone(undefined)).toEqual({ ok: true, phone: null });
    expect(normalizeOptionalPhone("(555) 123-4567")).toEqual({ ok: true, phone: "5551234567" });
    expect(normalizeOptionalPhone("555").ok).toBe(false);
  });
});

describe.runIf(databaseUrl.length > 0)("F-302 RSVP endpoints (database)", () => {
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
    // Public RSVP requires F-301 publish; publish by default so capacity tests stay focused.
    const published = await request(api)
      .patch(`/api/events/${id}/public-page`)
      .send({ public_page_published: true });
    expect(published.status).toBe(200);
    return { id, capacity: response.body.event.capacity as number | null };
  };

  it("refuses RSVPs while the public page is unpublished", async () => {
    const response = await request(api).post("/api/events").send(scenarioA());
    expect(response.status).toBe(201);
    const eventId: string = response.body.event.id;
    createdEventIds.push(eventId);

    const blocked = await request(api)
      .post(`/api/events/${eventId}/rsvps`)
      .send({ name: "Ada", email: "ada@example.com" });
    expect(blocked.status).toBe(404);
    expect(blocked.body.error).toMatch(/not available/i);
  });

  it("creates an RSVP and lists it on the guest list with count vs capacity", async () => {
    const { id: eventId, capacity } = await createEvent({ capacity: 5 });
    const created = await request(api)
      .post(`/api/events/${eventId}/rsvps`)
      .send({ name: "Ada", email: "Ada@Example.com", phone: "(555) 111-2222" });
    expect(created.status).toBe(201);
    expect(created.body.rsvp.email).toBe("ada@example.com");
    expect(created.body.rsvp.phone).toBe("5551112222");
    expect(created.body.confirmed_count).toBe(1);
    expect(created.body.capacity).toBe(capacity);

    const listed = await request(api).get(`/api/events/${eventId}/guests`);
    expect(listed.status).toBe(200);
    expect(listed.body.confirmed_count).toBe(1);
    expect(listed.body.event.capacity).toBe(5);
    expect(listed.body.rsvps).toHaveLength(1);
  });

  // `docs/ARCHITECTURE.md:9` rolls web and API independently, so between the two deployments one
  // side speaks the pre-rename contract. A web build that predates this change reads
  // `event.headcount` and rejects the whole response without it, which takes the guest list and
  // its cancel controls down until the second deployment finishes. The guest list therefore
  // serves both generations until the web rollout is complete; see the removal preconditions in
  // `specs/F-302-rsvp-guest-list.md`.
  it("serves the pre-rename headcount alongside capacity on the guest list", async () => {
    const { id: eventId } = await createEvent({ capacity: 5, headcount: 40 });

    const listed = await request(api).get(`/api/events/${eventId}/guests`);

    expect(listed.status).toBe(200);
    expect(listed.body.event.capacity).toBe(5);
    // The legacy field keeps its own meaning: the `events.headcount` column, which is what the
    // pre-rename API returned and what a pre-rename client renders. It is not capacity under an
    // old name — `headcount` is a regulatory input and must not be made to carry another value.
    expect(listed.body.event.headcount).toBe(40);
  });

  it("still serves headcount on the guest list when no capacity is confirmed", async () => {
    const { id: eventId } = await createEvent({ capacity: null, headcount: 40 });

    const listed = await request(api).get(`/api/events/${eventId}/guests`);

    expect(listed.status).toBe(200);
    expect(listed.body.event.capacity).toBeNull();
    expect(listed.body.event.headcount).toBe(40);
  });

  it("updates a duplicate email instead of double-counting", async () => {
    const { id: eventId } = await createEvent({ capacity: 5 });
    const first = await request(api)
      .post(`/api/events/${eventId}/rsvps`)
      .send({ name: "First", email: "dup@example.com" });
    expect(first.status).toBe(201);

    const second = await request(api)
      .post(`/api/events/${eventId}/rsvps`)
      .send({ name: "Second", email: "DUP@example.com", phone: "5559998888" });
    expect(second.status).toBe(200);
    expect(second.body.rsvp.id).toBe(first.body.rsvp.id);
    expect(second.body.rsvp.name).toBe("Second");
    expect(second.body.confirmed_count).toBe(1);

    const { rows } = await database.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM rsvps WHERE event_id = $1",
      [eventId],
    );
    expect(rows[0]?.count).toBe("1");
  });

  it("refuses a new RSVP when confirmed guests already meet capacity", async () => {
    const { id: eventId } = await createEvent({ capacity: 1 });
    const first = await request(api)
      .post(`/api/events/${eventId}/rsvps`)
      .send({ name: "Only", email: "only@example.com" });
    expect(first.status).toBe(201);

    const full = await request(api)
      .post(`/api/events/${eventId}/rsvps`)
      .send({ name: "Extra", email: "extra@example.com" });
    expect(full.status).toBe(400);
    expect(full.body.error).toBe("event is full");
  });

  // SPEC-CONFLICT #209, resolved 2026-08-03: admission is `capacity`, and a null capacity
  // means no enforced limit. `headcount` is a regulatory input — it drives the 75+ assembly gate,
  // the DOHMH thresholds and the Parks exactly-20 conflict — so admitting against it would let a
  // marketing decision move a permit finding.
  it("does not cap RSVPs when no capacity is confirmed", async () => {
    const { id: eventId, capacity } = await createEvent({ capacity: null, headcount: 1 });
    expect(capacity).toBeNull();

    const first = await request(api)
      .post(`/api/events/${eventId}/rsvps`)
      .send({ name: "One", email: "one@example.com" });
    expect(first.status).toBe(201);
    expect(first.body.capacity).toBeNull();

    // Past `headcount`, which must not be the limit.
    const second = await request(api)
      .post(`/api/events/${eventId}/rsvps`)
      .send({ name: "Two", email: "two@example.com" });
    expect(second.status).toBe(201);
    expect(second.body.confirmed_count).toBe(2);
  });

  it("admits against capacity even when headcount is smaller", async () => {
    const { id: eventId } = await createEvent({ capacity: 3, headcount: 1 });
    for (const guest of ["a", "b", "c"]) {
      const seated = await request(api)
        .post(`/api/events/${eventId}/rsvps`)
        .send({ name: guest, email: `${guest}@example.com` });
      expect(seated.status).toBe(201);
    }
    const full = await request(api)
      .post(`/api/events/${eventId}/rsvps`)
      .send({ name: "Extra", email: "extra@example.com" });
    expect(full.status).toBe(400);
    expect(full.body.error).toBe("event is full");
  });

  it("cancels an RSVP and frees capacity for a new guest", async () => {
    const { id: eventId } = await createEvent({ capacity: 1 });
    const first = await request(api)
      .post(`/api/events/${eventId}/rsvps`)
      .send({ name: "Only", email: "seat@example.com" });
    expect(first.status).toBe(201);

    const cancelled = await request(api)
      .patch(`/api/events/${eventId}/guests/${first.body.rsvp.id}`)
      .send({ status: "cancelled" });
    expect(cancelled.status).toBe(200);
    expect(cancelled.body.rsvp.status).toBe("cancelled");
    expect(cancelled.body.confirmed_count).toBe(0);

    const replacement = await request(api)
      .post(`/api/events/${eventId}/rsvps`)
      .send({ name: "Next", email: "next@example.com" });
    expect(replacement.status).toBe(201);
    expect(replacement.body.confirmed_count).toBe(1);
  });

  it("refuses RSVPs after the event date", async () => {
    // Intake refuses a past event_date at create time, so move the stored date after insert.
    const { id: eventId } = await createEvent({ capacity: 10 });
    await database.query("UPDATE events SET event_date = $2 WHERE id = $1", [
      eventId,
      "2026-07-01",
    ]);
    const response = await request(api)
      .post(`/api/events/${eventId}/rsvps`)
      .send({ name: "Late", email: "late@example.com" });
    expect(response.status).toBe(400);
    expect(response.body.error).toBe("this event has passed.");
  });

  it("returns friendly errors for malformed and unknown event ids", async () => {
    const malformed = await request(api)
      .post("/api/events/not-a-uuid/rsvps")
      .send({ name: "A", email: "a@example.com" });
    expect(malformed.status).toBe(400);
    expect(JSON.stringify(malformed.body)).not.toMatch(/postgres|stack|relation/i);

    const unknown = await request(api)
      .post(`/api/events/${randomUUID()}/rsvps`)
      .send({ name: "A", email: "a@example.com" });
    expect(unknown.status).toBe(404);
    expect(unknown.body.error).toMatch(/not found/i);
  });

  it("exposes create/list/cancel helpers used by the router", async () => {
    const { id: eventId } = await createEvent({ capacity: 2 });
    const created = await createRsvp(
      database,
      eventId,
      { name: "Helper", email: "helper@example.com" },
      FIXTURE_TODAY,
    );
    expect(created.status).toBe(201);

    const listed = await listRsvps(database, eventId);
    expect(listed.status).toBe(200);
    if (listed.status !== 200) return;
    expect(listed.body.confirmed_count).toBe(1);

    if (created.status !== 201) return;
    const cancelled = await cancelRsvp(database, eventId, created.body.rsvp.id);
    expect(cancelled.status).toBe(200);
    if (cancelled.status !== 200) return;
    expect(cancelled.body.confirmed_count).toBe(0);
  });

  it("refuses reactivating a cancelled RSVP when the event is full", async () => {
    const { id: eventId } = await createEvent({ capacity: 1 });
    const first = await request(api)
      .post(`/api/events/${eventId}/rsvps`)
      .send({ name: "A", email: "a@example.com" });
    expect(first.status).toBe(201);
    await request(api)
      .patch(`/api/events/${eventId}/guests/${first.body.rsvp.id}`)
      .send({ status: "cancelled" });

    const seat = await request(api)
      .post(`/api/events/${eventId}/rsvps`)
      .send({ name: "B", email: "b@example.com" });
    expect(seat.status).toBe(201);

    const blocked = await request(api)
      .post(`/api/events/${eventId}/rsvps`)
      .send({ name: "A again", email: "a@example.com" });
    expect(blocked.status).toBe(400);
    expect(blocked.body.error).toBe("event is full");
  });

  it("rejects a cancel with an unsupported status and an unknown RSVP id", async () => {
    const { id: eventId } = await createEvent({ capacity: 2 });
    const badStatus = await request(api)
      .patch(`/api/events/${eventId}/guests/${randomUUID()}`)
      .send({ status: "confirmed" });
    expect(badStatus.status).toBe(400);
    expect(badStatus.body.error).toMatch(/cancelled/i);

    const missing = await request(api)
      .patch(`/api/events/${eventId}/guests/${randomUUID()}`)
      .send({ status: "cancelled" });
    expect(missing.status).toBe(404);
  });

  it("rejects a malformed RSVP body", async () => {
    const { id: eventId } = await createEvent({ capacity: 2 });
    const response = await request(api)
      .post(`/api/events/${eventId}/rsvps`)
      .send({ name: "", email: "bad" });
    expect(response.status).toBe(400);
  });
});
