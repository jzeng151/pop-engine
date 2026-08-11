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
import { loadRuleset } from "./ruleset";

const databaseUrl = process.env.DATABASE_URL ?? "";

const scenario = (id: string): Record<string, unknown> => {
  const fixture = SCENARIO_INTAKE_FIXTURES.find((candidate) => candidate.scenario === id);
  if (fixture === undefined) throw new Error(`no fixture ${id}`);
  return fixtureSubmission(fixture);
};

const SCENARIO_CASES = SCENARIO_INTAKE_FIXTURES.map((fixture) => ({
  ...fixture,
  submission: fixtureSubmission(fixture),
  provenance:
    fixture.inferred === undefined
      ? "exactly as the answer key specifies"
      : `with ${Object.keys(fixture.inferred).join(", ")} inferred (SPEC-CONFLICT #${Object.values(
          fixture.inferred,
        )
          .map((entry) => entry.conflictIssue)
          .join(", #")})`,
}));

describe.runIf(databaseUrl.length > 0)("F-101 event intake endpoints", () => {
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
      await database.query("DELETE FROM permit_plans WHERE event_id = ANY($1)", [createdEventIds]);
      await database.query("DELETE FROM events WHERE id = ANY($1)", [createdEventIds]);
    }
    await database.end();
  });

  const post = async (intake: Record<string, unknown>, key = randomUUID()) => {
    const response = await request(api)
      .post("/api/events")
      .set("Idempotency-Key", key)
      .send(intake);
    const id: unknown = response.body?.event?.id;
    if (typeof id === "string") createdEventIds.push(id);
    return response;
  };

  const errorCodes = (body: { errors?: { field: string; code: string }[] }) =>
    Object.fromEntries((body.errors ?? []).map((error) => [error.field, error.code]));

  describe("POST /api/events", () => {
    it.each(SCENARIO_CASES)("stores scenario $scenario ($title), $provenance", async (fixture) => {
      const response = await post(fixture.submission);
      expect(response.status).toBe(201);
      for (const [field, value] of Object.entries(fixture.submission)) {
        expect(response.body.event[field], field).toEqual(value);
      }
      expect(response.body.event.revision_counter).toBe(1);
      expect(response.body.event.status).toBe("draft");
      expect(response.body.plan_stale).toBe(false);
    });

    it("returns the original event when the same create is replayed", async () => {
      const key = randomUUID();
      const intake = { ...scenario("C"), name: `idempotent-${randomUUID()}` };
      const first = await post(intake, key);
      const replay = await post(intake, key);

      expect(first.status).toBe(201);
      expect(replay.status).toBe(200);
      expect(replay.body.event.id).toBe(first.body.event.id);
      expect(replay.body.event).not.toHaveProperty("create_idempotency_key");
      expect(replay.body.event).not.toHaveProperty("create_request_body");
      const stored = await database.query<{ count: string }>(
        "SELECT count(*)::text AS count FROM events WHERE create_idempotency_key = $1",
        [key],
      );
      expect(stored.rows[0]?.count).toBe("1");
    });

    it("serializes concurrent copies of one create request", async () => {
      const key = randomUUID();
      const intake = { ...scenario("C"), name: `concurrent-idempotent-${randomUUID()}` };
      const copies = await Promise.all([post(intake, key), post(intake, key)]);

      expect(copies.map(({ status }) => status).sort()).toEqual([200, 201]);
      expect(copies[0]?.body.event.id).toBe(copies[1]?.body.event.id);
    });

    it("rejects reuse of a committed key with a different body", async () => {
      const key = randomUUID();
      const intake: Record<string, unknown> = {
        ...scenario("C"),
        name: `key-conflict-${randomUUID()}`,
      };
      const first = await post(intake, key);
      const conflict = await post({ ...intake, headcount: 151 }, key);

      expect(first.status).toBe(201);
      expect(conflict.status).toBe(409);
      expect(conflict.body.error).toBe("Idempotency-Key was already used with a different body");
      const stored = await request(api).get(`/api/events/${first.body.event.id}`);
      expect(stored.body.event.headcount).toBe(intake["headcount"]);
    });

    it("resolves a replay before validation against the current date", async () => {
      let currentToday = "2026-07-22";
      const replayApi = createApp({
        database,
        intakeContract: parseIntakeContract((await loadRuleset()).document),
        today: () => currentToday,
      });
      const key = randomUUID();
      const intake = { ...scenario("C"), event_date: "2026-07-23" };
      const send = () =>
        request(replayApi).post("/api/events").set("Idempotency-Key", key).send(intake);

      const first = await send();
      currentToday = "2026-07-24";
      const replay = await send();

      expect(first.status).toBe(201);
      expect(replay.status).toBe(200);
      expect(replay.body.event.id).toBe(first.body.event.id);
      createdEventIds.push(first.body.event.id as string);
    });

    it("requires a UUID idempotency key before writing", async () => {
      const intake = { ...scenario("C"), name: `missing-key-${randomUUID()}` };
      const missing = await request(api).post("/api/events").send(intake);
      const malformed = await request(api)
        .post("/api/events")
        .set("Idempotency-Key", "not-a-uuid")
        .send(intake);

      expect(errorCodes(missing.body)).toEqual({ "Idempotency-Key": "required" });
      expect(errorCodes(malformed.body)).toEqual({ "Idempotency-Key": "invalid_value" });
      const stored = await database.query<{ count: string }>(
        "SELECT count(*)::text AS count FROM events WHERE name = $1",
        [intake.name],
      );
      expect(stored.rows[0]?.count).toBe("0");
    });

    it("stores unknown answers and blank dimensions as the answer key writes them", async () => {
      const rooftop = scenario("F");
      const { body } = await post({ ...rooftop });
      expect(body.event.venue_license_covers_event_area).toBe("unknown");
      expect(body.event.venue_paco_covers_exact_event).toBe("unknown");
      expect(body.event.venue_fdny_pa_permit_current_for_event_space).toBe("unknown");
      expect(body.event.sound_audible_from_public_way).toBe("unknown");

      const plaza = scenario("E");
      const blank = await post({ ...plaza, tent_area_sqft: null, generator_kw: null });
      expect(blank.body.event.tent_area_sqft).toBeNull();
      expect(blank.body.event.generator_kw).toBeNull();
      expect(blank.body.event.structure_over_10ft_tall).toBe("unknown");
    });

    it("leaves every question the event was not asked null", async () => {
      const park = scenario("C");
      const { body } = await post({ ...park });
      expect(body.event.obstructs_public_way).toBeNull();
      expect(body.event.street_event_size).toBeNull();
      expect(body.event.food_vendor_count).toBeNull();
      expect(body.event.capacity).toBeNull();
    });

    it("rejects a contradictory submission with a per-field error and stores nothing", async () => {
      const street = { ...scenario("A"), name: `reject-contradiction-${randomUUID()}` };
      const response = await post({ ...street, tent_area_sqft: 200, headcount: 0 });
      expect(response.status).toBe(400);
      expect(errorCodes(response.body)).toEqual({
        tent_area_sqft: "not_applicable",
        headcount: "must_be_positive",
      });
      const stored = await database.query<{ count: string }>(
        "SELECT count(*)::text AS count FROM events WHERE name = $1",
        [street.name],
      );
      expect(stored.rows[0]?.count).toBe("0");
    });

    it("rejects an event date in the past against the injected clock", async () => {
      const park = scenario("C");
      const response = await post({ ...park, event_date: "2026-07-21" });
      expect(response.status).toBe(400);
      expect(errorCodes(response.body)).toEqual({ event_date: "in_the_past" });
    });

    it("rejects a body that is not a JSON object", async () => {
      const response = await request(api)
        .post("/api/events")
        .set("Idempotency-Key", randomUUID())
        .send([]);
      expect(response.status).toBe(400);
      expect(errorCodes(response.body)).toEqual({ body: "invalid_body" });
    });

    it("rejects the deprecated food-exception claim as active input", async () => {
      const response = await post({
        ...scenario("F"),
        food_affinity_private_exception_claimed: "unknown",
      });
      expect(response.status).toBe(400);
      expect(errorCodes(response.body)).toEqual({
        food_affinity_private_exception_claimed: "unknown_field",
      });
    });

    it("keeps retired historical answers out of active create and read responses", async () => {
      const created = await post(scenario("F"));
      expect(created.body.event).not.toHaveProperty("food_affinity_private_exception_claimed");
      expect(created.body.event).not.toHaveProperty("venue_has_assembly_approval");
      await database.query(
        `UPDATE events
            SET food_affinity_private_exception_claimed = 'yes',
                venue_has_assembly_approval = 'yes'
          WHERE id = $1`,
        [created.body.event.id],
      );
      const response = await request(api).get(`/api/events/${created.body.event.id}`);
      expect(response.status).toBe(200);
      expect(response.body.event).not.toHaveProperty("food_affinity_private_exception_claimed");
      expect(response.body.event).not.toHaveProperty("venue_has_assembly_approval");
    });

    it("warns inline that a selling block party conflicts with eligibility, and stores it", async () => {
      const blockParty = scenario("D");
      const response = await post({ ...blockParty, selling_anything: true });
      expect(response.status).toBe(201);
      expect(response.body.event.selling_anything).toBe(true);
      expect(response.body.warnings).toHaveLength(1);
      expect(response.body.warnings[0].code).toBe("block_party_eligibility_conflict");
    });

    it("renders the coverage warning for alcohol in public space", async () => {
      const park = scenario("C");
      const response = await post({ ...park, alcohol: true });
      expect(response.status).toBe(201);
      expect(response.body.warnings[0].code).toBe("coverage_gap");
      expect(response.body.warnings[0].message).toContain("Confirm with the relevant agency.");
    });
  });

  describe("GET /api/events/:id", () => {
    it("returns the stored event and repeats any standing warning", async () => {
      const park = scenario("C");
      const created = await post({ ...park, alcohol: true });
      const response = await request(api).get(`/api/events/${created.body.event.id}`);
      expect(response.status).toBe(200);
      expect(response.body.event).toEqual(created.body.event);
      expect(response.body.warnings[0].code).toBe("coverage_gap");
    });

    it("returns 404 for an unknown or malformed id", async () => {
      expect((await request(api).get(`/api/events/${randomUUID()}`)).status).toBe(404);
      expect((await request(api).get("/api/events/not-an-id")).status).toBe(404);
    });
  });

  describe("PATCH /api/events/:id", () => {
    const createStreetEvent = async () => {
      const street = scenario("A");
      const created = await post({ ...street });
      return created.body.event as Record<string, unknown> & { id: string };
    };

    it("bumps the revision counter on every accepted edit", async () => {
      const event = await createStreetEvent();
      const first = await request(api)
        .patch(`/api/events/${event.id}`)
        .send({ street_event_size: "medium" });
      expect(first.status).toBe(200);
      expect(first.body.event.street_event_size).toBe("medium");
      expect(first.body.event.revision_counter).toBe(2);

      const second = await request(api).patch(`/api/events/${event.id}`).send({ headcount: 90 });
      expect(second.body.event.revision_counter).toBe(3);
      expect(second.body.event.street_event_size).toBe("medium");
    });

    it("marks an existing plan stale once the event moves past the revision it evaluated", async () => {
      const event = await createStreetEvent();
      await database.query(
        `INSERT INTO permit_plans (id, event_id, event_revision, ruleset_version, verdict,
                                   verdict_detail, intake_snapshot)
         VALUES ($1, $2, 1, 'nyc.v2.2', 'infeasible', '{}'::jsonb, '{}'::jsonb)`,
        [randomUUID(), event.id],
      );

      expect((await request(api).get(`/api/events/${event.id}`)).body.plan_stale).toBe(false);
      const edited = await request(api)
        .patch(`/api/events/${event.id}`)
        .send({ street_event_size: "small" });
      expect(edited.body.plan_stale).toBe(true);
      expect((await request(api).get(`/api/events/${event.id}`)).body.plan_stale).toBe(true);
    });

    it("leaves the revision and the plan alone when a save changes nothing", async () => {
      const event = await createStreetEvent();
      await database.query(
        `INSERT INTO permit_plans (id, event_id, event_revision, ruleset_version, verdict,
                                   verdict_detail, intake_snapshot)
         VALUES ($1, $2, 1, 'nyc.v2.2', 'feasible', '{}'::jsonb, '{}'::jsonb)`,
        [randomUUID(), event.id],
      );
      await database.query(
        `UPDATE events
            SET food_affinity_private_exception_claimed = 'yes',
                venue_has_assembly_approval = 'yes'
          WHERE id = $1`,
        [event.id],
      );

      const stored = await request(api).get(`/api/events/${event.id}`);
      expect(stored.body.event).not.toHaveProperty("food_affinity_private_exception_claimed");
      expect(stored.body.event).not.toHaveProperty("venue_has_assembly_approval");
      const resaved = await request(api)
        .patch(`/api/events/${event.id}`)
        .send(
          Object.fromEntries(
            Object.entries(stored.body.event).filter(
              ([column]) =>
                ![
                  "id",
                  "status",
                  "revision_counter",
                  "created_at",
                  "updated_at",
                  "description",
                  "public_page_published",
                ].includes(column),
            ),
          ),
        );

      expect(resaved.status, JSON.stringify(resaved.body)).toBe(200);
      expect(resaved.body.event.revision_counter).toBe(1);
      expect(resaved.body.plan_stale).toBe(false);
      expect(resaved.body.event.updated_at).toBe(stored.body.event.updated_at);
      expect(resaved.body.event).not.toHaveProperty("food_affinity_private_exception_claimed");
      expect(resaved.body.event).not.toHaveProperty("venue_has_assembly_approval");
      expect((await request(api).get(`/api/events/${event.id}`)).body.plan_stale).toBe(false);
    });

    it("waits for a concurrent edit rather than answering from a row it read first", async () => {
      const event = await createStreetEvent();
      await database.query(
        `INSERT INTO permit_plans (id, event_id, event_revision, ruleset_version, verdict,
                                   verdict_detail, intake_snapshot)
         VALUES ($1, $2, 1, 'nyc.v2.2', 'feasible', '{}'::jsonb, '{}'::jsonb)`,
        [randomUUID(), event.id],
      );
      const stored = await request(api).get(`/api/events/${event.id}`);
      expect(stored.body.plan_stale).toBe(false);
      const noOpIntake = Object.fromEntries(
        Object.entries(stored.body.event).filter(
          ([column]) =>
            ![
              "id",
              "status",
              "revision_counter",
              "created_at",
              "updated_at",
              "description",
              "public_page_published",
            ].includes(column),
        ),
      );

      const holder = await database.connect();
      let settled = false;
      let resaved: request.Response;
      try {
        await holder.query("BEGIN");
        await holder.query("SELECT * FROM events WHERE id = $1 FOR UPDATE", [event.id]);

        const inFlight = request(api)
          .patch(`/api/events/${event.id}`)
          .send(noOpIntake)
          .then((response) => {
            settled = true;
            return response;
          });

        await holder.query(
          "UPDATE events SET headcount = 175, revision_counter = revision_counter + 1 WHERE id = $1",
          [event.id],
        );
        await new Promise((resolve) => setTimeout(resolve, 150));
        expect(settled, "the PATCH answered before the concurrent edit committed").toBe(false);

        await holder.query("COMMIT");
        resaved = await inFlight;
      } finally {
        holder.release();
      }

      expect(resaved.status, JSON.stringify(resaved.body)).toBe(200);
      expect(resaved.body.event.revision_counter).toBeGreaterThan(1);
      expect(resaved.body.plan_stale).toBe(true);
      const afterwards = await request(api).get(`/api/events/${event.id}`);
      expect(afterwards.body.event.revision_counter).toBe(resaved.body.event.revision_counter);
      expect(afterwards.body.plan_stale).toBe(true);
    });

    it("answers only once its own write is durable", async () => {
      const event = await createStreetEvent();
      const edited = await request(api).patch(`/api/events/${event.id}`).send({ headcount: 90 });
      const readBack = await request(api).get(`/api/events/${event.id}`);

      expect(edited.body.event.revision_counter).toBe(2);
      expect(readBack.body.event.revision_counter).toBe(2);
      expect(readBack.body.event.headcount).toBe(90);
    });

    it("rolls the transaction back when the write fails, leaving the event untouched", async () => {
      const event = await createStreetEvent();
      const failed = await request(api)
        .patch(`/api/events/${event.id}`)
        .send({ headcount: 3_000_000_000 });
      expect(failed.status).toBe(500);

      const afterwards = await request(api).get(`/api/events/${event.id}`);
      expect(afterwards.status).toBe(200);
      expect(afterwards.body.event.revision_counter).toBe(1);
      expect(afterwards.body.event.headcount).toBe(75);

      const stillEditable = await request(api)
        .patch(`/api/events/${event.id}`)
        .send({ headcount: 76 });
      expect(stillEditable.status).toBe(200);
      expect(stillEditable.body.event.revision_counter).toBe(2);
    });

    it("reads a re-ticked multi-select as unchanged but a different one as an edit", async () => {
      const event = await createStreetEvent();
      const reordered = await request(api)
        .patch(`/api/events/${event.id}`)
        .send({ open_flame_or_cooking: ["none"] });
      expect(reordered.body.event.revision_counter).toBe(1);

      const changed = await request(api)
        .patch(`/api/events/${event.id}`)
        .send({ open_flame_or_cooking: ["charcoal_wood"] });
      expect(changed.body.event.revision_counter).toBe(2);
    });

    it("saves a rescope that hides questions, without the client clearing them", async () => {
      const event = await createStreetEvent();
      const response = await request(api)
        .patch(`/api/events/${event.id}`)
        .send({ location_type: "park" });

      expect(response.status).toBe(200);
      expect(response.body.event.location_type).toBe("park");
      expect(response.body.event.obstructs_public_way).toBeNull();
      expect(response.body.event.sapo_event_type).toBeNull();
      expect(response.body.event.street_event_size).toBeNull();
      expect(response.body.event.revision_counter).toBe(2);
      expect(response.body.event.headcount).toBe(75);
      expect(response.body.event.food_vendor_count).toBe(1);
    });

    it("still rejects an inapplicable answer the edit supplies on purpose", async () => {
      const event = await createStreetEvent();
      const response = await request(api)
        .patch(`/api/events/${event.id}`)
        .send({ location_type: "park", sapo_event_type: "street_event" });

      expect(response.status).toBe(400);
      expect(errorCodes(response.body)).toEqual({ sapo_event_type: "not_applicable" });
      const unchanged = await request(api).get(`/api/events/${event.id}`);
      expect(unchanged.body.event.revision_counter).toBe(1);
      expect(unchanged.body.event.location_type).toBe("street");
    });

    it("asks the questions a rescope reveals before it will save", async () => {
      const event = await createStreetEvent();
      const missing = await request(api)
        .patch(`/api/events/${event.id}`)
        .send({ location_type: "private_venue" });
      expect(missing.status).toBe(400);
      expect(errorCodes(missing.body)).toEqual({
        sound_audible_from_public_way: "required",
        venue_paco_covers_exact_event: "required",
        venue_fdny_pa_permit_current_for_event_space: "required",
      });

      const response = await request(api).patch(`/api/events/${event.id}`).send({
        location_type: "private_venue",
        sound_audible_from_public_way: "unknown",
        venue_paco_covers_exact_event: "unknown",
        venue_fdny_pa_permit_current_for_event_space: "unknown",
      });
      expect(response.status).toBe(200);
      expect(response.body.event.location_type).toBe("private_venue");
      expect(response.body.event.street_event_size).toBeNull();
      expect(response.body.event.venue_paco_covers_exact_event).toBe("unknown");
      expect(response.body.event.venue_fdny_pa_permit_current_for_event_space).toBe("unknown");
      expect(response.body.event.revision_counter).toBe(2);
    });

    it.each([
      ["venue_paco_covers_exact_event", "venue_fdny_pa_permit_current_for_event_space", "yes"],
      ["venue_paco_covers_exact_event", "venue_fdny_pa_permit_current_for_event_space", "no"],
      ["venue_paco_covers_exact_event", "venue_fdny_pa_permit_current_for_event_space", "unknown"],
      ["venue_fdny_pa_permit_current_for_event_space", "venue_paco_covers_exact_event", "yes"],
      ["venue_fdny_pa_permit_current_for_event_space", "venue_paco_covers_exact_event", "no"],
      ["venue_fdny_pa_permit_current_for_event_space", "venue_paco_covers_exact_event", "unknown"],
    ] as const)(
      "edits only %s to %s, bumps the revision, and reloads it exactly",
      async (field, otherField, value) => {
        const initialValue = value === "unknown" ? "yes" : "unknown";
        const created = await post({ ...scenario("F"), [field]: initialValue });
        expect(created.status).toBe(201);
        expect(created.body.event).toMatchObject({
          [field]: initialValue,
          [otherField]: "unknown",
        });
        const id = created.body.event.id as string;

        const edited = await request(api)
          .patch(`/api/events/${id}`)
          .send({ [field]: value });
        expect(edited.status).toBe(200);
        expect(edited.body.event).toMatchObject({
          revision_counter: 2,
          [field]: value,
          [otherField]: "unknown",
        });

        const reloaded = await request(api).get(`/api/events/${id}`);
        expect(reloaded.status).toBe(200);
        expect(reloaded.body.event).toMatchObject({
          revision_counter: 2,
          [field]: value,
          [otherField]: "unknown",
        });
      },
    );

    it("warns inline on an edit that creates a coverage gap", async () => {
      const park = scenario("C");
      const created = await post({ ...park });
      const response = await request(api)
        .patch(`/api/events/${created.body.event.id}`)
        .send({ alcohol: true });
      expect(response.status).toBe(200);
      expect(response.body.warnings[0].code).toBe("coverage_gap");
    });

    it("returns 404 for an unknown id and 400 for a body that is not an object", async () => {
      expect((await request(api).patch(`/api/events/${randomUUID()}`).send({})).status).toBe(404);
      expect((await request(api).patch("/api/events/not-an-id").send({})).status).toBe(404);
      const event = await createStreetEvent();
      expect(
        (await request(api).patch(`/api/events/${event.id}`).type("json").send("[]")).status,
      ).toBe(400);
    });

    it("rejects a field the registry does not declare", async () => {
      const event = await createStreetEvent();
      const response = await request(api)
        .patch(`/api/events/${event.id}`)
        .send({ attendee_wifi: true });
      expect(response.status).toBe(400);
      expect(errorCodes(response.body)).toEqual({ attendee_wifi: "unknown_field" });
    });
  });
});
