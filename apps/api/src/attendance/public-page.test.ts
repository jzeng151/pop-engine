import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { Pool, type PoolClient } from "pg";
import {
  parseEngineRuleset,
  parseIntakeContract,
  type EngineRuleset,
  type IntakeContract,
} from "@pop-engine/engine";
import {
  FIXTURE_TODAY,
  SCENARIO_INTAKE_FIXTURES,
  fixtureSubmission,
} from "@pop-engine/engine/fixtures";
import { createApp } from "../app";
import { mapUrlForVenue } from "./public-page";
import { loadRuleset } from "../ruleset";
import { createPlanService } from "../planning/plan";

const databaseUrl = process.env.DATABASE_URL ?? "";

const scenarioA = (): Record<string, unknown> => {
  const fixture = SCENARIO_INTAKE_FIXTURES.find((candidate) => candidate.scenario === "A");
  if (fixture === undefined) throw new Error("no fixture A");
  return fixtureSubmission(fixture);
};

const scenarioD = (): Record<string, unknown> => {
  const fixture = SCENARIO_INTAKE_FIXTURES.find((candidate) => candidate.scenario === "D");
  if (fixture === undefined) throw new Error("no fixture D");
  return fixtureSubmission(fixture);
};

describe("mapUrlForVenue", () => {
  it("builds a Google Maps search link without a maps API", () => {
    expect(mapUrlForVenue("Bushwick Lot", "brooklyn")).toBe(
      "https://maps.google.com/?q=Bushwick%20Lot%2C%20brooklyn%2C%20NYC",
    );
  });

  it("returns null when there is no venue address", () => {
    expect(mapUrlForVenue(null, "brooklyn")).toBeNull();
    expect(mapUrlForVenue("   ", "brooklyn")).toBeNull();
  });
});

describe.runIf(databaseUrl.length > 0)("F-301 public page endpoints (database)", () => {
  let database: Pool;
  let api: ReturnType<typeof createApp>;
  let ruleset: EngineRuleset;
  let intakeContract: IntakeContract;
  const createdEventIds: string[] = [];

  beforeAll(async () => {
    database = new Pool({ connectionString: databaseUrl });
    const loadedRuleset = await loadRuleset();
    ruleset = parseEngineRuleset(loadedRuleset.document);
    intakeContract = parseIntakeContract(loadedRuleset.document);
    api = createApp({
      database,
      intakeContract,
      today: () => FIXTURE_TODAY,
    });
  });

  afterAll(async () => {
    if (createdEventIds.length > 0) {
      await database.query(
        `DELETE FROM permit_plan_items
          WHERE plan_id IN (SELECT id FROM permit_plans WHERE event_id = ANY($1))`,
        [createdEventIds],
      );
      await database.query("DELETE FROM permit_plans WHERE event_id = ANY($1)", [createdEventIds]);
      await database.query("DELETE FROM rsvps WHERE event_id = ANY($1)", [createdEventIds]);
      await database.query("DELETE FROM events WHERE id = ANY($1)", [createdEventIds]);
    }
    await database.end();
  });

  const createEvent = async (intake = scenarioA()) => {
    const response = await request(api)
      .post("/api/events")
      .set("Idempotency-Key", randomUUID())
      .send(intake);
    expect(response.status).toBe(201);
    const id: string = response.body.event.id;
    createdEventIds.push(id);
    return id;
  };

  const createPlan = async (
    eventId: string,
    verdict = "feasible",
    verdictDetail: Record<string, unknown> = {},
  ) => {
    await database.query(
      `INSERT INTO permit_plans (
         id, event_id, event_revision, ruleset_version, verdict, verdict_detail, intake_snapshot
       ) VALUES ($1, $2, 1, 'nyc.v2.13', $3, $4::jsonb, '{}'::jsonb)`,
      [randomUUID(), eventId, verdict, JSON.stringify(verdictDetail)],
    );
  };

  type LooseQuery = (...args: unknown[]) => Promise<unknown>;
  const poolPausedAfterEventLock = (onLock: () => void, released: Promise<void>): Pool =>
    ({
      connect: async (): Promise<PoolClient> => {
        const client = await database.connect();
        const query = client.query.bind(client) as unknown as LooseQuery;
        const release = client.release.bind(client);
        let paused = false;
        client.query = (async (...args: unknown[]) => {
          const result = await query(...args);
          if (!paused && String(args[0]).includes("FOR UPDATE")) {
            paused = true;
            onLock();
            await released;
          }
          return result;
        }) as unknown as PoolClient["query"];
        client.release = ((...args: unknown[]) => {
          client.query = query as unknown as PoolClient["query"];
          client.release = release;
          return (release as unknown as LooseQuery)(...args);
        }) as unknown as PoolClient["release"];
        return client;
      },
      query: (...args: unknown[]) => (database.query as unknown as LooseQuery)(...args),
    }) as unknown as Pool;

  it("404s the public URL until published, then returns promotion fields only", async () => {
    const eventId = await createEvent();
    await createPlan(eventId);
    const unpublished = await request(api).get(`/e/${eventId}`);
    expect(unpublished.status).toBe(404);
    expect(unpublished.body.error).toMatch(/not available/i);

    await database.query("UPDATE events SET location_name = $2 WHERE id = $1", [
      eventId,
      "Bushwick Lot",
    ]);

    const patched = await request(api).patch(`/api/events/${eventId}/public-page`).send({
      description: "A street night in Bushwick.",
      public_page_published: true,
    });
    expect(patched.status).toBe(200);
    expect(patched.body.public_page_published).toBe(true);
    expect(patched.body.description).toBe("A street night in Bushwick.");
    expect(patched.body.public_path).toBe(`/e/${eventId}`);
    expect(patched.body.map_url).toContain("maps.google.com");

    const published = await request(api).get(`/e/${eventId}`);
    expect(published.status).toBe(200);
    expect(published.body.title).toBeDefined();
    expect(published.body.description).toBe("A street night in Bushwick.");
    expect(published.body.rsvp_enabled).toBe(true);
    expect(published.body.map_url).toContain("maps.google.com");
    expect(JSON.stringify(published.body)).not.toMatch(/verdict|permit|checklist|document/i);

    await database.query("UPDATE events SET location_name = NULL WHERE id = $1", [eventId]);
    const noVenue = await request(api).get(`/e/${eventId}`);
    expect(noVenue.status).toBe(200);
    expect(noVenue.body.map_url).toBeNull();
  });

  it("shows an infeasible warning on the organizer view when the latest plan is infeasible", async () => {
    const eventId = await createEvent();
    await createPlan(eventId, "infeasible");

    const organizer = await request(api).get(`/api/events/${eventId}/public-page`);
    expect(organizer.status).toBe(200);
    expect(organizer.body.infeasible_warning).toBe(true);
    expect(organizer.body.plan_available).toBe(true);
    expect(organizer.body.publication_blocked).toBe(false);

    await request(api)
      .patch(`/api/events/${eventId}/public-page`)
      .send({ public_page_published: true });
    expect((await request(api).get(`/e/${eventId}`)).status).toBe(200);
  });

  it("refuses publication when the latest plan is blocked by a prohibition", async () => {
    const eventId = await createEvent();
    await createPlan(eventId, "infeasible", {
      blockingFinding: { disposition: "prohibited_or_ineligible" },
    });

    const organizer = await request(api).get(`/api/events/${eventId}/public-page`);
    expect(organizer.status).toBe(200);
    expect(organizer.body.publication_blocked).toBe(true);

    const refused = await request(api).patch(`/api/events/${eventId}/public-page`).send({
      description: "This must not be saved.",
      public_page_published: true,
    });
    expect(refused.status).toBe(409);
    expect(refused.body.error).toMatch(/published prohibition or ineligibility/i);

    const unchanged = await request(api).get(`/api/events/${eventId}/public-page`);
    expect(unchanged.body.public_page_published).toBe(false);
    expect(unchanged.body.description).toBeNull();

    await database.query("UPDATE events SET public_page_published = true WHERE id = $1", [eventId]);
    expect((await request(api).get(`/e/${eventId}`)).status).toBe(404);
  });

  it("waits for a blocking plan generation, then refuses publication without writing", async () => {
    const eventId = await createEvent(scenarioD());
    await createPlan(eventId);
    const edited = await request(api)
      .patch(`/api/events/${eventId}`)
      .send({ selling_anything: true });
    expect(edited.status).toBe(200);

    let reachedLock = (): void => {};
    const atLock = new Promise<void>((resolve) => {
      reachedLock = resolve;
    });
    let releaseGeneration = (): void => {};
    const released = new Promise<void>((resolve) => {
      releaseGeneration = resolve;
    });
    const publicationPool = new Pool({
      connectionString: databaseUrl,
      application_name: `f301-publication-${eventId}`,
    });
    const concurrentApi = createApp({
      database: publicationPool,
      intakeContract,
      today: () => FIXTURE_TODAY,
      planService: createPlanService(
        poolPausedAfterEventLock(reachedLock, released),
        ruleset,
        (calendarId) => ({ id: calendarId, holidays: [] }),
        () => FIXTURE_TODAY,
      ),
    });

    let generation: Promise<request.Response> | undefined;
    let publication: Promise<request.Response> | undefined;
    let publicationSettled = false;
    try {
      generation = request(concurrentApi)
        .post(`/api/events/${eventId}/plan`)
        .then((response) => response);
      void generation.catch(() => undefined);
      await atLock;

      publication = request(concurrentApi)
        .patch(`/api/events/${eventId}/public-page`)
        .send({
          description: "This must not survive the refused publish.",
          public_page_published: true,
        })
        .then((response) => {
          publicationSettled = true;
          return response;
        });
      void publication.catch(() => undefined);

      const deadline = Date.now() + 10_000;
      let blocked = false;
      while (!blocked && Date.now() < deadline && !publicationSettled) {
        const { rows } = await database.query(
          `SELECT 1 FROM pg_stat_activity
            WHERE datname = current_database()
              AND application_name = $1
              AND wait_event_type = 'Lock'
              AND query LIKE 'SELECT id FROM events WHERE id = $1 FOR UPDATE%'`,
          [`f301-publication-${eventId}`],
        );
        blocked = rows.length > 0;
        if (!blocked) await new Promise((resolve) => setTimeout(resolve, 25));
      }
      expect(blocked, "publication never waited on plan generation's event-row lock").toBe(true);
      expect(publicationSettled, "publication answered before plan generation committed").toBe(
        false,
      );

      releaseGeneration();
      const [generated, refused] = await Promise.all([generation, publication]);
      expect(generated.status).toBe(201);
      expect(generated.body.verdictDetail.blockingFinding.disposition).toBe(
        "prohibited_or_ineligible",
      );
      expect(refused.status).toBe(409);
      expect(refused.body.error).toMatch(/published prohibition or ineligibility/i);

      const organizer = await request(api).get(`/api/events/${eventId}/public-page`);
      expect(organizer.body.publication_blocked).toBe(true);
      expect(organizer.body.public_page_published).toBe(false);
      expect(organizer.body.description).toBeNull();
    } finally {
      releaseGeneration();
      await Promise.allSettled(
        [generation, publication].filter(
          (pending): pending is Promise<request.Response> => pending !== undefined,
        ),
      );
      await publicationPool.end();
    }
  });

  it("accepts an RSVP from the public flow once the page is published", async () => {
    const eventId = await createEvent();
    await createPlan(eventId);
    await request(api)
      .patch(`/api/events/${eventId}/public-page`)
      .send({ public_page_published: true, description: "Come through." });

    const rsvp = await request(api)
      .post(`/api/events/${eventId}/rsvps`)
      .send({ name: "Guest", email: "guest@example.com" });
    expect(rsvp.status).toBe(201);
  });

  it("updates only the fields supplied on PATCH so concurrent toggles cannot clobber each other", async () => {
    const eventId = await createEvent();
    await createPlan(eventId);
    await request(api)
      .patch(`/api/events/${eventId}/public-page`)
      .send({ public_page_published: true, description: "Original copy." });

    const descriptionOnly = await request(api)
      .patch(`/api/events/${eventId}/public-page`)
      .send({ description: "Updated copy." });
    expect(descriptionOnly.status).toBe(200);
    expect(descriptionOnly.body.description).toBe("Updated copy.");
    expect(descriptionOnly.body.public_page_published).toBe(true);

    const publishOnly = await request(api)
      .patch(`/api/events/${eventId}/public-page`)
      .send({ public_page_published: false });
    expect(publishOnly.status).toBe(200);
    expect(publishOnly.body.public_page_published).toBe(false);
    expect(publishOnly.body.description).toBe("Updated copy.");
  });

  it("refuses publication without a plan and writes none of the patch", async () => {
    const eventId = await createEvent();

    const refused = await request(api).patch(`/api/events/${eventId}/public-page`).send({
      description: "Not saved with a refused publish.",
      public_page_published: true,
    });
    expect(refused.status).toBe(409);
    expect(refused.body.error).toBe("Generate a permit plan before publishing this page.");

    const organizer = await request(api).get(`/api/events/${eventId}/public-page`);
    expect(organizer.status).toBe(200);
    expect(organizer.body.plan_available).toBe(false);
    expect(organizer.body.public_page_published).toBe(false);
    expect(organizer.body.description).toBeNull();

    const descriptionOnly = await request(api)
      .patch(`/api/events/${eventId}/public-page`)
      .send({ description: "Draft promotion copy." });
    expect(descriptionOnly.status).toBe(200);
    expect(descriptionOnly.body.description).toBe("Draft promotion copy.");
  });

  it("returns friendly errors for malformed public ids", async () => {
    const response = await request(api).get("/e/not-a-uuid");
    expect(response.status).toBe(400);
    expect(JSON.stringify(response.body)).not.toMatch(/postgres|stack|relation/i);
  });
});
