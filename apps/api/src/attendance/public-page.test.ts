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
import { mapUrlForVenue } from "./public-page";
import { loadRuleset } from "../ruleset";

const databaseUrl = process.env.DATABASE_URL ?? "";

const scenarioA = (): Record<string, unknown> => {
  const fixture = SCENARIO_INTAKE_FIXTURES.find((candidate) => candidate.scenario === "A");
  if (fixture === undefined) throw new Error("no fixture A");
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
      await database.query("DELETE FROM rsvps WHERE event_id = ANY($1)", [createdEventIds]);
      await database.query("DELETE FROM events WHERE id = ANY($1)", [createdEventIds]);
    }
    await database.end();
  });

  const createEvent = async () => {
    const response = await request(api)
      .post("/api/events")
      .set("Idempotency-Key", randomUUID())
      .send(scenarioA());
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
