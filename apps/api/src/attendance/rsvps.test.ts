import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { Pool } from "pg";
import {
  evaluate,
  parseEngineRuleset,
  parseIntakeContract,
  triggerFields,
} from "@pop-engine/engine";
import type {
  Condition,
  EngineRule,
  EventIntake,
  HolidayCalendar,
  IntakeFieldDefinition,
  TriggerNode,
} from "@pop-engine/engine";
import {
  FIXTURE_TODAY,
  SCENARIO_INTAKE_FIXTURES,
  fixtureSubmission,
} from "@pop-engine/engine/fixtures";
import type { ScenarioIntakeFixture } from "@pop-engine/engine/fixtures";
import { createApp } from "../app";
import { cancelRsvp, createRsvp, listRsvps, normalizeEmail, normalizeOptionalPhone } from "./rsvps";
import { loadRuleset, publishedRulesFile } from "../ruleset";

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
      await database.query("DELETE FROM permit_plans WHERE event_id = ANY($1)", [createdEventIds]);
      await database.query("DELETE FROM events WHERE id = ANY($1)", [createdEventIds]);
    }
    await database.end();
  });

  const createEvent = async (overrides: Record<string, unknown> = {}) => {
    const response = await request(api)
      .post("/api/events")
      .set("Idempotency-Key", randomUUID())
      .send({ ...scenarioA(), ...overrides });
    expect(response.status).toBe(201);
    const id: string = response.body.event.id;
    createdEventIds.push(id);

    await database.query(
      `INSERT INTO permit_plans (
         id, event_id, event_revision, ruleset_version, verdict, verdict_detail, intake_snapshot
       ) VALUES ($1, $2, 1, 'nyc.v2.12', 'feasible', '{}'::jsonb, '{}'::jsonb)`,
      [randomUUID(), id],
    );

    const published = await request(api)
      .patch(`/api/events/${id}/public-page`)
      .send({ public_page_published: true });
    expect(published.status).toBe(200);
    return { id, capacity: response.body.event.capacity as number | null };
  };

  it("refuses RSVPs while the public page is unpublished", async () => {
    const response = await request(api)
      .post("/api/events")
      .set("Idempotency-Key", randomUUID())
      .send(scenarioA());
    expect(response.status).toBe(201);
    const eventId: string = response.body.event.id;
    createdEventIds.push(eventId);

    const blocked = await request(api)
      .post(`/api/events/${eventId}/rsvps`)
      .send({ name: "Ada", email: "ada@example.com" });
    expect(blocked.status).toBe(404);
    expect(blocked.body.error).toMatch(/not available/i);
  });

  it("refuses RSVPs when a published event's latest plan becomes prohibition-blocked", async () => {
    const { id: eventId } = await createEvent();
    await database.query(
      `UPDATE permit_plans
          SET verdict = 'infeasible',
              verdict_detail = '{"blockingFinding":{"disposition":"prohibited_or_ineligible"}}'::jsonb
        WHERE event_id = $1`,
      [eventId],
    );

    const blocked = await request(api)
      .post(`/api/events/${eventId}/rsvps`)
      .send({ name: "Ada", email: "ada@example.com" });

    expect(blocked.status).toBe(404);
    expect(blocked.body.error).toMatch(/not available/i);
    const { rows } = await database.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM rsvps WHERE event_id = $1",
      [eventId],
    );
    expect(rows[0]?.count).toBe("0");
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

  it("serves the pre-rename headcount alongside capacity on the guest list", async () => {
    const { id: eventId } = await createEvent({ capacity: 5, headcount: 40 });

    const listed = await request(api).get(`/api/events/${eventId}/guests`);

    expect(listed.status).toBe(200);
    expect(listed.body.event.capacity).toBe(5);
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

  // SPEC-CONFLICT #209: null capacity means unlimited; headcount remains regulatory input.
  it("does not cap RSVPs when no capacity is confirmed", async () => {
    const { id: eventId, capacity } = await createEvent({ capacity: null, headcount: 1 });
    expect(capacity).toBeNull();

    const first = await request(api)
      .post(`/api/events/${eventId}/rsvps`)
      .send({ name: "One", email: "one@example.com" });
    expect(first.status).toBe(201);
    expect(first.body.capacity).toBeNull();

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

describe("DOHMH findings do not move with headcount (#235)", () => {
  const ruleset = parseEngineRuleset(JSON.parse(readFileSync(publishedRulesFile(), "utf8")));
  const calendar: HolidayCalendar = { id: ruleset.calendarId, holidays: [] };
  const declared = new Set(ruleset.intakeFields.map((field) => field.field));
  const COUNT_FIELD = "headcount";

  const CITY_HEALTH =
    /DOHMH|Health and Mental Hygiene|(?:NYC |City )?Health Department|NYC Health/i;
  const cityHealth = ruleset.rules.filter(
    (rule) => CITY_HEALTH.test(rule.id) || CITY_HEALTH.test(rule.agency ?? ""),
  );
  const cityHealthIds = new Set(cityHealth.map((rule) => rule.id));

  const scopingOf = (fields: readonly IntakeFieldDefinition[]) =>
    new Map(
      fields.map((field) => [
        field.field,
        (field.askedWhenClauses ?? []).map((clause) => clause.field),
      ]),
    );
  const scopedBy = scopingOf(ruleset.intakeFields);
  const dependsOn = (rule: EngineRule, scoping = scopedBy) => {
    const fields = new Set(triggerFields(rule.trigger));
    for (const field of fields) for (const owner of scoping.get(field) ?? []) fields.add(owner);
    return fields;
  };

  const conditionsOn = (node: TriggerNode, into: Condition[] = []) => {
    if ("field" in node) into.push(node);
    else for (const child of "all" in node ? node.all : node.any) conditionsOn(child, into);
    return into;
  };
  const operandsOf = (compared: object) =>
    Object.values(compared)
      .flat()
      .filter((value): value is number => typeof value === "number");
  const countBoundaries = [
    ...ruleset.rules.flatMap((rule) => conditionsOn(rule.trigger)),
    ...ruleset.intakeFields.flatMap((field) => field.askedWhenClauses ?? []),
  ]
    .filter((compared) => compared.field === COUNT_FIELD)
    .flatMap(operandsOf);

  const cityHealthFindings = (fixture: ScenarioIntakeFixture, headcount: number | null) => {
    const answers = { ...fixtureSubmission(fixture), headcount };
    const intake = Object.fromEntries(
      Object.entries(answers).filter(([field]) => declared.has(field)),
    ) as EventIntake;
    return evaluate(intake, ruleset, FIXTURE_TODAY, calendar).findings.filter((finding) =>
      finding.ruleIds.some((ruleId) => cityHealthIds.has(ruleId)),
    );
  };

  it("classifies every agency label the published ruleset carries", () => {
    const labels = [...new Set(ruleset.rules.map((rule) => rule.agency).filter(Boolean))];
    expect(
      labels.filter((label) => CITY_HEALTH.test(label ?? "")),
      "the city health labels",
    ).toEqual(["DOHMH"]);
    expect(labels.sort(), "every agency label this partition was written against").toEqual([
      "DOB",
      "DOB (+ FDNY Public Assembly Permit)",
      "DOHMH",
      "FDNY",
      "NY State Liquor Authority",
      "NYC DEP",
      "NYC Parks",
      "NYC Parks Revenue Division",
      "NYPD",
      "Requirement attached to SAPO permits (50 RCNY §1-08(b))",
      "SAPO (Mayor's Office CECM)",
    ]);
  });

  it("publishes no city health rule whose firing depends on the attendee count", () => {
    expect(cityHealthIds.size, "the ruleset publishes city health rules").toBeGreaterThan(0);
    for (const rule of cityHealth) {
      expect(
        [...dependsOn(rule)],
        `${rule.id} fires on no attendee count, directly or through scoping (#235)`,
      ).not.toContain(COUNT_FIELD);
    }
  });

  it("follows a bare member clause to the field that owns it", () => {
    const scoped = parseEngineRuleset({
      ...JSON.parse(readFileSync(publishedRulesFile(), "utf8")),
      intake_fields: [
        { field: COUNT_FIELD, type: "integer", collected: true },
        {
          field: "structure_types",
          type: "multi_enum",
          values: ["tent_canopy"],
          asked_when: `${COUNT_FIELD} gte 600`,
        },
        { field: "tent_area_sqft", type: "integer", asked_when: "tent_canopy" },
      ],
      rules: [
        {
          id: "HEALTH-TENT-001",
          kind: "permit",
          trigger: { field: "tent_area_sqft", op: "gt", value: 400 },
          output: { agency: "DOHMH", permit_name: "x" },
          verification: { status: "SOURCE_CONFIRMED" },
        },
      ],
      advisories: [],
    });
    const rule = scoped.rules[0] as EngineRule;
    expect(triggerFields(rule.trigger), "the trigger names one field").toEqual(["tent_area_sqft"]);
    expect(
      [...dependsOn(rule, scopingOf(scoped.intakeFields))],
      "tent_canopy resolves to structure_types, which the registry scopes on the count",
    ).toContain(COUNT_FIELD);
  });

  const ascending = (a: number, b: number) => a - b;
  const boundaries = [...new Set(countBoundaries)].sort(ascending);
  const COMPARED = [...new Set([...boundaries.flatMap((at) => [at - 1, at, at + 1]), 500])].sort(
    ascending,
  );

  it("returns the same findings below, at, above and without a published headcount", () => {
    expect(boundaries, "the published headcount boundaries").toEqual([20, 75]);
    expect(COMPARED).toEqual([19, 20, 21, 74, 75, 76, 500]);
    for (const fixture of SCENARIO_INTAKE_FIXTURES) {
      const baseline = cityHealthFindings(fixture, COMPARED[0] as number);
      for (const headcount of [...COMPARED, null]) {
        expect(
          cityHealthFindings(fixture, headcount),
          `scenario ${fixture.scenario} at ${headcount} against ${COMPARED[0]}`,
        ).toEqual(baseline);
      }
    }
  });

  it("reaches every published city health rule across the compared scenarios", () => {
    const reached = new Set(
      SCENARIO_INTAKE_FIXTURES.flatMap((fixture) =>
        cityHealthFindings(fixture, 20).flatMap((finding) =>
          finding.ruleIds.filter((ruleId) => cityHealthIds.has(ruleId)),
        ),
      ),
    );
    expect([...reached].sort()).toEqual([...cityHealthIds].sort());
  });
});
