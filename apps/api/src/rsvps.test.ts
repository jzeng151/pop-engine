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
import { cityHealthRule } from "../../../scripts/spec-conflict-scan.mjs";
import type { PublishedRuleShape } from "../../../scripts/spec-conflict-scan.mjs";
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

// The regression test for the fact issue #235 corrected. No published DOHMH rule's trigger reads
// `headcount` (all three key on `food_present` and `event_open_to_public`, and
// `DOHMH-ORGANIZER-NOTIFY-001` also reads `food_vendor_count`), so the DOHMH findings a plan
// carries cannot move when the count does. That was asserted only against the artifact until now,
// by `scripts/spec-conflict-resolutions.test.mjs`; this asserts it against evaluated output, which
// is what an organizer actually sees.
//
// guard: asserts-independence
//
// The marker above is the opt-out `scripts/spec-conflict-scan.mjs` honours in every scanned code
// extension (`.ts`, `.tsx`, `.mjs` and `.js`; it said `.ts` and `.tsx` until the fifth PR #247
// review round widened it, and this sentence was left behind). This block has to name the agency and vary the count, which is exactly the co-occurrence
// that scan flags; it reads co-occurrence and not stance, and `headcount` is the literal field name
// in the intake type, so the "F-101 intake field" circumlocution the correction records use is not
// available here. The marker carries an obligation rather than a licence: the block it marks must
// assert the independence, which is what the assertions below do.
//
// WHICH FINDINGS ARE THE AGENCY'S IS THE ARTIFACT'S ANSWER AND NOT A PREFIX, which is the
// sixteenth PR #247 round. This filtered on `DOHMH-`, while the structural guard next door
// classifies the same rule by its id OR its published `output.agency` (`cityHealthRule` in
// `scripts/spec-conflict-scan.mjs`), and `specs/F-201-permit-plan-generator.md:22` makes the
// published agency authoritative. A future city-health rule published under `NYC Health` with an
// id carrying no prefix was therefore invisible HERE and visible THERE, so its finding could move
// with `headcount` and leave this regression green: it need not even read the count itself, since
// deduplication against a count-sensitive rule is enough to move it. The classification is
// imported rather than restated, so the two guards cannot disagree about whose rule it is.
describe("DOHMH findings do not move with headcount (#235)", () => {
  const published = JSON.parse(readFileSync(publishedRulesFile(), "utf8")) as {
    rules?: PublishedRuleShape[];
    advisories?: PublishedRuleShape[];
  };
  const ruleset = parseEngineRuleset(published);
  const calendar: HolidayCalendar = { id: ruleset.calendarId, holidays: [] };
  const declared = new Set(ruleset.intakeFields.map((field) => field.field));
  const cityHealthIds = new Set(
    [...(published.rules ?? []), ...(published.advisories ?? [])]
      .filter((rule) => cityHealthRule(rule))
      .map((rule) => rule.id),
  );
  const cityHealthFindings = (fixture: ScenarioIntakeFixture, headcount: number) => {
    const answers = { ...fixtureSubmission(fixture), headcount };
    const intake = Object.fromEntries(
      Object.entries(answers).filter(([field]) => declared.has(field)),
    ) as EventIntake;
    return evaluate(intake, ruleset, FIXTURE_TODAY, calendar).findings.filter((finding) =>
      finding.ruleIds.some((ruleId) => cityHealthIds.has(ruleId)),
    );
  };
  // EVERY PUBLISHED BOUNDARY, BELOW AND AT AND ABOVE, which is the eighteenth PR #247 round. The
  // comparison ran at 20, 75 and 500, so every value it compared was AT OR ABOVE the lowest
  // published headcount boundary and the below-20 state was never evaluated: at 19 neither
  // `PARKS-EVENT-001` (`gt` 20) nor `PARKS-EXACTLY-20-001` (`eq` 20) contributes, and those two
  // routes are mutually exclusive, so a city health finding sharing a dedupe key with both of them
  // can produce byte-identical output at 20, 75 and 500 and different output at 19. The reachability
  // assertion below says nothing about it either: it evaluates one headcount and asks which rules
  // were reached, not which thresholds were crossed. `AGENTS.md` lines 59-60 already required this
  // shape ("numeric rule thresholds require below/at/above boundary tests") and
  // `specs/F-201-permit-plan-generator.md` criterion 8 names `park headcount 19/20/21` as a fixture.
  //
  // THE BOUNDARIES ARE READ OUT OF THE PUBLISHED TRIGGERS rather than written here, so a
  // publication that moves a threshold moves this comparison with it instead of leaving it testing
  // last year's numbers. 500 stays as the far-above value the earlier rounds compared at, above
  // every published boundary rather than beside one.
  const COUNT_FIELD = "headcount";
  const publishedCountThresholds = (node: unknown, into = new Set<number>()): Set<number> => {
    if (Array.isArray(node)) for (const child of node) publishedCountThresholds(child, into);
    else if (node !== null && typeof node === "object") {
      const record = node as Record<string, unknown>;
      if (record.field === COUNT_FIELD && typeof record.value === "number") into.add(record.value);
      for (const value of Object.values(record)) publishedCountThresholds(value, into);
    }
    return into;
  };
  const ascending = (a: number, b: number) => a - b;
  const publishedBoundaries = [...publishedCountThresholds(published)].sort(ascending);
  const COMPARED_HEADCOUNTS = [
    ...new Set([...publishedBoundaries.flatMap((at) => [at - 1, at, at + 1]), 500]),
  ].sort(ascending);
  // EVERY SCENARIO AND NOT SCENARIO A ALONE, which is the seventeenth PR #247 round. Comparing one
  // intake compares only the branches that intake reaches, and A is `event_open_to_public: "yes"`,
  // so `DOHMH-EXEMPTION-001`, whose published trigger reads `no` or `unknown`, contributed no
  // finding at any of the three headcounts. All three assertions were green on a rule the
  // comparison never evaluated, and a future count-sensitive rule that deduplicates with that
  // advisory for private events only would have moved city health output with all three still
  // green. That is the same defect this file's own comment names one level down: a rule need not
  // read the count itself for deduplication to move its finding.
  //
  // The scenarios are the approved fixtures rather than intakes written here, so the comparison
  // rests on the answer key instead of on hand-built inputs, and the assertion under it is what
  // makes the coverage a fact rather than a hope.
  it("returns the same findings below, at and above every published headcount boundary", () => {
    // The derivation is pinned, so a comparison that quietly stopped reading the artifact's
    // thresholds fails here rather than running over a shorter list. 20 is the Parks special event
    // threshold (`gt` and `eq`), 75 the place-of-assembly one (`gte`).
    expect(publishedBoundaries, "the published headcount thresholds").toEqual([20, 75]);
    expect(COMPARED_HEADCOUNTS).toEqual([19, 20, 21, 74, 75, 76, 500]);
    for (const fixture of SCENARIO_INTAKE_FIXTURES) {
      const [first, ...rest] = COMPARED_HEADCOUNTS;
      const baseline = cityHealthFindings(fixture, first);
      for (const headcount of rest) {
        expect(
          cityHealthFindings(fixture, headcount),
          `scenario ${fixture.scenario} at ${headcount} against ${first}`,
        ).toEqual(baseline);
      }
    }
  });
  // What makes the comparison above worth running: a published city health rule no scenario reaches
  // is a rule this regression cannot say anything about, and it would go on saying nothing while
  // looking green. Asserted by id rather than by count, so a rule added to the artifact fails here
  // until a fixture reaches it.
  it("reaches every published city health rule across the compared scenarios", () => {
    const reached = new Set(
      SCENARIO_INTAKE_FIXTURES.flatMap((fixture) =>
        cityHealthFindings(fixture, 20).flatMap((finding) =>
          finding.ruleIds.filter((ruleId) => cityHealthIds.has(ruleId)),
        ),
      ),
    );
    expect([...reached].sort(), "every published city health rule is compared").toEqual(
      [...cityHealthIds].sort(),
    );
  });
  // What drives the classification above, since the artifact cannot: all three of this ruleset's
  // city health rules carry the prefix today, so the two readings agree on it and no assertion
  // over the real rules can tell them apart. The case that separates them is asserted directly.
  it("classifies a city health rule by its published agency, prefix or no prefix", () => {
    const byAgencyAlone = { id: "ASSEMBLY-CAPACITY-001", output: { agency: "NYC Health" } };
    expect(byAgencyAlone.id.startsWith("DOHMH-"), "the id alone would miss it").toBe(false);
    expect(cityHealthRule(byAgencyAlone), "the published agency classifies it").toBe(true);
    expect(cityHealthIds.has("DOHMH-EXEMPTION-001"), "and the id still classifies").toBe(true);
  });
});
