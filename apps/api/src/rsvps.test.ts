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
import { createApp } from "./app";
import { cancelRsvp, createRsvp, listRsvps, normalizeEmail, normalizeOptionalPhone } from "./rsvps";
import { loadRuleset, publishedRulesFile } from "./ruleset";

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
  //
  // Issue #236, decided 2026-08-05 by the product owner: the compatibility field carries the limit
  // this API ENFORCES, not the `events.headcount` column. Serving the column made an api-first
  // deploy show an organizer a denominator nothing applied. `events.headcount` keeps its own
  // meaning everywhere it is a regulatory input; this response is not one of those places.
  it("serves the enforced limit under the pre-rename headcount on the guest list", async () => {
    const { id: eventId } = await createEvent({ capacity: 3, headcount: 40 });

    const listed = await request(api).get(`/api/events/${eventId}/guests`);

    expect(listed.status).toBe(200);
    expect(listed.body.event.capacity).toBe(3);
    expect(listed.body.event.headcount).toBe(3);

    // Asserted against admission rather than against a constant: a legacy page renders this number
    // as the denominator, so it has to be the number the fourth RSVP is refused at.
    for (const guest of ["x", "y", "z"]) {
      const seated = await request(api)
        .post(`/api/events/${eventId}/rsvps`)
        .send({ name: guest, email: `${guest}@example.com` });
      expect(seated.status).toBe(201);
    }
    const refused = await request(api)
      .post(`/api/events/${eventId}/rsvps`)
      .send({ name: "Extra", email: "extra@example.com" });
    expect(refused.status).toBe(400);
    expect(refused.body.error).toBe("event is full");
  });

  // A null capacity means no confirmed limit and never refuses (spec AC 2). The pre-rename shape
  // cannot express that: it carries a number, and any number put there is read as an enforced
  // limit that nothing enforces. So the field states no limit, the same fact `capacity` states,
  // and a legacy page that can only render a number fails visibly instead of showing one that is
  // false. The regulatory `events.headcount` is never what this response reports.
  it("reports no limit rather than a finite one when no capacity is confirmed", async () => {
    const { id: eventId } = await createEvent({ capacity: null, headcount: 40 });

    const listed = await request(api).get(`/api/events/${eventId}/guests`);

    expect(listed.status).toBe(200);
    expect(listed.body.event.capacity).toBeNull();
    expect(listed.body.event.headcount).toBeNull();
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
  // means no enforced limit. `headcount` is a regulatory input — it drives the 75+ assembly gate
  // and the Parks exactly-20 conflict — so admitting against it would let a marketing decision
  // move a permit finding.
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

// THE REGRESSION TEST FOR THE FACT ISSUE #235 CORRECTED, and nothing wider. #235 removed an
// invented DOHMH headcount trigger, so what must not come back is that: no published city health
// rule may READ the attendee count, and the DOHMH findings an organizer sees must not move when
// the count does, unknown included. Whether any PROSE here states an unsupported claim is issue
// #256's, split out of this branch on 2026-08-09.
//
// IT READS THE ENGINE'S OWN PARSE AND MATCHES NOTHING. Four rounds were one defect: an operand
// type, an agency spelling, a registry field reference, and a bare enum member owned by another
// field. Each fix widened what a walk over names and text MATCHED, and each time a form it did
// not match reopened it. There is no walk over text now: `triggerFields` is the engine's reader
// for the fields a trigger names, and `askedWhenClauses` is the registry's scoping AS PARSED, in
// which a member clause already carries its owning field. What that makes impossible: this test
// and the engine cannot disagree about what a rule reads, because there is one reading. A form
// the engine accepts is traversed, a form it rejects fails at `parseEngineRuleset` before any
// assertion runs, and a clause kind added without a `field` fails to compile here. Stated
// narrowing: a rule that only MENTIONS the count in prose is no longer reported, which is the
// correction record's and #256's ground, not this one's.
describe("DOHMH findings do not move with headcount (#235)", () => {
  const ruleset = parseEngineRuleset(JSON.parse(readFileSync(publishedRulesFile(), "utf8")));
  const calendar: HolidayCalendar = { id: ruleset.calendarId, holidays: [] };
  const declared = new Set(ruleset.intakeFields.map((field) => field.field));
  const COUNT_FIELD = "headcount";

  // `agency` is free text, not an enum, so the labels are PARTITIONED below rather than matched: a
  // regex over today's spellings silently excludes the next one, and "Health Department", which
  // `docs/PRD.md` writes, was one of them.
  const CITY_HEALTH =
    /DOHMH|Health and Mental Hygiene|(?:NYC |City )?Health Department|NYC Health/i;
  const cityHealth = ruleset.rules.filter(
    (rule) => CITY_HEALTH.test(rule.id) || CITY_HEALTH.test(rule.agency ?? ""),
  );
  const cityHealthIds = new Set(cityHealth.map((rule) => rule.id));

  /**
   * Every field a rule's FIRING depends on: the fields its trigger names, closed over the
   * registry's scoping, since a field the registry only asks under a condition carries that
   * condition's fields into the rule that reads it.
   *
   * Both halves are the engine's: `triggerFields` is the reader `packages/engine/src/ruleset.ts`
   * uses, and `askedWhenClauses` is the parsed scoping every clause kind of which carries the
   * field it constrains, a bare member resolved to its owner by `conditions.ts:154-173`. A Set
   * iterator visits entries added while it runs, so the loop closes transitively.
   */
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

  /**
   * WHAT A BOUNDARY IS: a value the artifact compares THE COUNT against, so the sweep can run
   * below, at and above it. It is the operand OF A CONDITION ON THE COUNT, never a numeral near
   * one, which is what `headcount gte 75 AND tent_area_sqft gte 400` publishing only 75 means.
   * The operands are whatever numbers the parsed condition or clause carries, so no operator or
   * clause kind is enumerated here.
   */
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

  // `null` is the unknown answer: an absent or null key is "asked, not answered"
  // (`packages/engine/src/types.ts:8-11`), and a numeric field has no other way to be unknown.
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
    // Pinned, so a label added later fails HERE until somebody classifies it, rather than being
    // silently excluded by a regex written before it existed.
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

  // The dependency the four rounds of this finding were about, through the longest form the
  // registry can write it: a rule triggered on a field the registry asks only for a bare enum
  // member, whose OWNING field is scoped on the count. Built through the engine's own parser, so
  // what is asserted is that the traversal follows what the engine resolved.
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
    const owners = new Map(
      scoped.intakeFields.map((field) => [
        field.field,
        (field.askedWhenClauses ?? []).map((clause) => clause.field),
      ]),
    );
    const fields = new Set(triggerFields(rule.trigger));
    for (const field of fields) for (const owner of owners.get(field) ?? []) fields.add(owner);
    expect(
      [...fields],
      "tent_canopy resolves to structure_types, which is scoped on the count",
    ).toContain(COUNT_FIELD);
  });

  // Below, at and above every boundary, per AGENTS.md 59-60, with 500 far above and `null`
  // unknown.
  const ascending = (a: number, b: number) => a - b;
  const boundaries = [...new Set(countBoundaries)].sort(ascending);
  const COMPARED = [...new Set([...boundaries.flatMap((at) => [at - 1, at, at + 1]), 500])].sort(
    ascending,
  );

  it("returns the same findings below, at, above and without a published headcount", () => {
    // Pinned, so a derivation that stopped reading the artifact fails here rather than running
    // over a shorter list. 20 is the Parks threshold, 75 the place-of-assembly one.
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

  // What makes the comparison worth running: a rule no scenario reaches is one it says nothing
  // about, while looking green.
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
