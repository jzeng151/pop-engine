import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { Pool } from "pg";
import { evaluate, parseEngineRuleset, parseIntakeContract } from "@pop-engine/engine";
import type { EventIntake, HolidayCalendar } from "@pop-engine/engine";
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
// the count does, unknown included. Both are read out of the published ruleset. Whether any PROSE
// here states an unsupported claim is issue #256's, split out of this branch on 2026-08-09.
//
// IT DECIDES BY WHAT THE ARTIFACT SAYS, NOT BY A SHAPE IT EXPECTS. Three findings were one defect:
// an unenumerated operand type, an agency spelling the regex lacked, and a field reference in the
// intake registry rather than a trigger. Each was a shape this test chose to look at. Detection
// now reads a rule's whole declaration plus the scoping of every field it names, and the agency
// labels are pinned rather than matched. Both fail closed.
describe("DOHMH findings do not move with headcount (#235)", () => {
  type PublishedRule = { id?: string; trigger?: unknown; output?: { agency?: string | null } };
  const published = JSON.parse(readFileSync(publishedRulesFile(), "utf8")) as {
    rules?: PublishedRule[];
    advisories?: PublishedRule[];
    intake_fields?: { field?: string; asked_when?: string }[];
  };
  const publishedRules = [...(published.rules ?? []), ...(published.advisories ?? [])];
  const ruleset = parseEngineRuleset(published);
  const calendar: HolidayCalendar = { id: ruleset.calendarId, holidays: [] };
  const declared = new Set(ruleset.intakeFields.map((field) => field.field));
  const COUNT_FIELD = "headcount";
  const names = (text: string, token: string) => new RegExp(`\\b${token}\\b`).test(text);

  // `output.agency` is free text, not an enum, so the labels are PARTITIONED below rather than
  // matched: a regex over today's spellings silently excludes the next one, and "Health
  // Department", which `docs/PRD.md` writes, was one of them.
  const CITY_HEALTH =
    /DOHMH|Health and Mental Hygiene|(?:NYC |City )?Health Department|NYC Health/i;
  const cityHealth = publishedRules.filter(
    (rule) => CITY_HEALTH.test(rule.id ?? "") || CITY_HEALTH.test(rule.output?.agency ?? ""),
  );
  const cityHealthIds = new Set(cityHealth.map((rule) => rule.id));

  /**
   * EVERYTHING THAT DECIDES WHETHER A RULE FIRES: its published declaration, plus the `asked_when`
   * scoping of every intake field that declaration names, to a fixed point because one field's
   * scoping may name another's. A rule triggered on a field the registry only asks when `headcount
   * gte 600` fires on the count as surely as a trigger comparing it does. Read as TEXT, so no
   * operator, operand or node shape hides a reference. Stated cost: a city health rule that merely
   * mentions the field in prose is reported, which is the right direction, and none does today.
   */
  const askedWhen = new Map(
    (published.intake_fields ?? []).map((field) => [field.field ?? "", field.asked_when ?? ""]),
  );
  const firingBasis = (rule: PublishedRule) => {
    let text = JSON.stringify(rule);
    for (let grew = true; grew;) {
      grew = false;
      for (const [field, when] of askedWhen) {
        if (when !== "" && names(text, field) && !text.includes(when)) {
          text += ` ${when}`;
          grew = true;
        }
      }
    }
    return text;
  };

  /**
   * WHAT A BOUNDARY IS, stated because it has been drawn around the wrong thing three times: a
   * value the artifact compares THE COUNT against, which is the operand PAIRED WITH a headcount
   * field reference and never a numeral in its vicinity. `headcount gte 75 AND tent_area_sqft gte
   * 400` publishes one count boundary, 75. A trigger condition pairs its own `field` and `value`;
   * an `asked_when` pairs by position, since `packages/engine/src/conditions.ts:52` splits on
   * " AND " and `:94`/`:113` read a clause as `field in a/b` or `field op operand`.
   */
  const boundariesIn = (node: unknown, into: number[] = []) => {
    if (Array.isArray(node)) for (const child of node) boundariesIn(child, into);
    else if (node !== null && typeof node === "object") {
      const record = node as Record<string, unknown>;
      if (record.field === COUNT_FIELD) {
        for (const value of [record.value].flat()) if (typeof value === "number") into.push(value);
      }
      for (const value of Object.values(record)) boundariesIn(value, into);
    }
    return into;
  };
  const CLAUSE = /^(\S+) (?:in (\S+)|\S+ (\S+))$/;
  const clauses = [...askedWhen.values()].flatMap((when) =>
    when.split(" AND ").map((clause) => clause.trim()),
  );
  const scopingBoundaries = clauses
    .map((clause) => CLAUSE.exec(clause))
    .filter((parsed) => parsed?.[1] === COUNT_FIELD)
    .flatMap((parsed) => (parsed?.[2] ?? parsed?.[3] ?? "").split("/").map(Number))
    .filter(Number.isFinite);

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
    const labels = [...new Set(publishedRules.map((rule) => rule.output?.agency).filter(Boolean))];
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

  it("publishes no city health rule that reads the attendee count", () => {
    expect(cityHealthIds.size, "the ruleset publishes city health rules").toBeGreaterThan(0);
    for (const rule of cityHealth) {
      expect(
        names(firingBasis(rule), COUNT_FIELD),
        `${rule.id} names no attendee count in its declaration or its scoping (#235)`,
      ).toBe(false);
    }
  });

  // The three shapes that got past a reader keyed on shape, asserted together: a non-numeric
  // operand, a scoping expression, and an agency label outside today's spellings.
  it("detects a count read whatever names it, and classifies a label it has not seen", () => {
    const reads = (rule: PublishedRule) => names(firingBasis(rule), COUNT_FIELD);
    for (const value of [75, "unknown", true, [20, 21], null, { at: 75 }]) {
      const rule = { id: "X", trigger: { any: [{ field: COUNT_FIELD, op: "eq", value }] } };
      expect(reads(rule), JSON.stringify(value) ?? "undefined").toBe(true);
    }
    // Scoped rather than compared: the rule names a field the registry only asks about above 600.
    askedWhen.set("venue_capacity_confirmed", `${COUNT_FIELD} gte 600`);
    expect(
      reads({ id: "X", trigger: { field: "venue_capacity_confirmed", op: "bool", value: true } }),
    ).toBe(true);
    askedWhen.delete("venue_capacity_confirmed");
    expect(CITY_HEALTH.test("Health Department"), "the label docs/PRD.md writes").toBe(true);
  });

  // Below, at and above every boundary, per AGENTS.md 59-60, with 500 far above and `null`
  // unknown.
  const ascending = (a: number, b: number) => a - b;
  const boundaries = [...new Set([...boundariesIn(published), ...scopingBoundaries])].sort(
    ascending,
  );
  const COMPARED = [...new Set([...boundaries.flatMap((at) => [at - 1, at, at + 1]), 500])].sort(
    ascending,
  );

  it("returns the same findings below, at, above and without a published headcount", () => {
    // Pinned, so a derivation that stopped reading the artifact fails here rather than running
    // over a shorter list. 20 is the Parks threshold, 75 the place-of-assembly one.
    // A clause that names the count and does not parse would contribute no boundary and narrow
    // the sweep in silence, so it fails here instead.
    expect(clauses.filter((c) => names(c, COUNT_FIELD) && !CLAUSE.test(c))).toEqual([]);
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
