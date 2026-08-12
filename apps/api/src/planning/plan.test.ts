import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Pool, type PoolClient } from "pg";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  parseEngineRuleset,
  parseIntakeContract,
  type EngineRuleset,
  type HolidayCalendar,
  type IntakeContract,
} from "@pop-engine/engine";
import { SCENARIO_INTAKE_FIXTURES, fixtureSubmission } from "@pop-engine/engine/fixtures";
import { createApp } from "../app";
import { holidayCalendarWarning, pinnedCalendar, todayInJurisdiction } from "../calendar";
import {
  calendarDateFrom,
  createPlanService,
  filingRouteOf,
  storedRoutes,
  type FindingRendering,
  type StoredPlanItem,
} from "./plan";
import { loadRuleset, rulesFilePath } from "../ruleset";

const databaseUrl = process.env.DATABASE_URL ?? "";
const TODAY = "2026-07-22";

const scenarioAEvent = {
  name: "Bushwick Street Activation",
  borough: "brooklyn",
  location_type: "street",
  obstructs_public_way: "yes",
  sapo_event_type: "street_event",
  street_event_size: "large",
  headcount: 75,
  event_date: "2026-08-26",
  event_open_to_public: "yes",
  food_present: true,
  food_vendor_count: 1,
  selling_anything: true,
  amplified_sound: true,
  structure_types: ["none"],
  open_flame_or_cooking: ["none"],
  generator_present: false,
  battery_present: false,
  battery_system_kwh: 0,
  alcohol: false,
};

describe.runIf(databaseUrl.length > 0)("plan API (F-201)", () => {
  let pool: Pool;
  let ruleset: EngineRuleset;
  let intakeContract: IntakeContract;

  const insertEvent = async (overrides: Record<string, unknown> = {}): Promise<string> => {
    const row: Record<string, unknown> = { ...scenarioAEvent, ...overrides };
    const columns = Object.keys(row);
    const eventId = randomUUID();
    await pool.query(
      `INSERT INTO events (id, ${columns.join(", ")})
       VALUES ($1, ${columns.map((_column, index) => `$${index + 2}`).join(", ")})`,
      [eventId, ...columns.map((column) => row[column])],
    );
    return eventId;
  };

  const fixtureCalendar = (calendarId: string): HolidayCalendar => ({
    id: calendarId,
    holidays: [],
  });

  const unpublishedCalendar = (calendarId: string): HolidayCalendar => ({
    id: calendarId,
    holidays: null,
  });

  const PUBLICATION_REQUIRES_R10_RESOLUTION = [
    `A holiday list is now published for the ruleset's pinned calendar.`,
    `THIS REQUIRES RESOLVING OPEN-QUESTIONS R-10 AND THE CALENDAR-PUBLICATION ADR:`,
    `SPEC-CONFLICT #130 already reconciled F-201 AC 10 and ARCHITECTURE AD-11 by requiring`,
    `business-day math against an explicitly supplied calendar and NOT_CALCULABLE in production`,
    `while no list exists. This assertion is a notification,`,
    `so that publishing lands in one visible place instead of silently moving four plan dates.`,
    `Before deleting it, read the doc comment on PUBLISHED_HOLIDAY_CALENDARS in`,
    `apps/api/src/calendar.ts: it records what blocked publication — no source consulted defines`,
    `"business day" for a filing lead, which is the independent reason, and one calendar id spans`,
    `a city agency and a state agency whose published STAFF holiday schedules differ, which matters`,
    `only if a staff closure stops a filing counter and nothing establishes that it does. If those`,
    `are answered, delete this test through the approved R-10/calendar-publication change.`,
  ].join(" ");

  const appWith = (resolveCalendar = fixtureCalendar) =>
    createApp({
      database: pool,
      intakeContract,
      today: () => TODAY,
      planService: createPlanService(pool, ruleset, resolveCalendar, () => TODAY),
    });

  beforeAll(async () => {
    pool = new Pool({ connectionString: databaseUrl });
    ruleset = parseEngineRuleset(JSON.parse(await readFile(rulesFilePath(), "utf8")));
    intakeContract = parseIntakeContract((await loadRuleset()).document);
  });

  afterAll(async () => {
    await pool.end();
  });

  it("generates a plan whose findings carry rule ids, agency, sources, and verification status", async () => {
    const eventId = await insertEvent();
    const response = await request(appWith()).post(`/api/events/${eventId}/plan`);

    expect(response.status).toBe(201);
    expect(response.body.rulesetVersion).toBe("nyc.v2.13");
    expect(response.body.eventRevision).toBe(1);
    expect(response.body.verdict).toBe("INFEASIBLE");
    expect(response.body.findings.map((finding: { ruleIds: string[] }) => finding.ruleIds)).toEqual(
      [
        ["SAPO-STREET-LARGE-001"],
        ["SAPO-INSURANCE-001"],
        ["NYPD-SOUND-001"],
        ["DOHMH-VENDOR-PERMIT-001"],
        ["DOHMH-ORGANIZER-NOTIFY-001"],
        ["CONF-NO-STRUCTURE-001"],
        ["CONF-NO-FLAME-001"],
        ["CONF-NO-GENERATOR-001"],
        ["CONF-NO-BATTERY-001"],
        ["CONF-NO-ALCOHOL-001"],
      ],
    );
    const [blocking] = response.body.findings;
    expect(blocking.agency).toBe("SAPO (Mayor's Office CECM)");
    expect(blocking.latestApplyDate).toBe("2026-07-12");
    expect(blocking.verificationStatus).toBe("SOURCE_CONFIRMED");
    expect(blocking.lastVerifiedDate).toBeNull();
    expect(blocking.sources[0].urls.length).toBeGreaterThan(0);
    expect(blocking.triggeredBy).toEqual([
      { field: "sapo_event_type", value: "street_event" },
      { field: "street_event_size", value: "large" },
    ]);
    const noBattery = response.body.findings.find((entry: { ruleIds: string[] }) =>
      entry.ruleIds.includes("CONF-NO-BATTERY-001"),
    );
    expect(noBattery).toMatchObject({
      kind: "note",
      disposition: "no_new_requirement",
      agency: null,
      deadline: null,
      feeDisplay: null,
      portalName: null,
      verificationStatus: "SOURCE_CONFIRMED",
      triggeredBy: [{ field: "battery_present", value: false }],
      sources: [
        {
          ruleId: "CONF-NO-BATTERY-001",
          citation: "CECM FDNY page + Parks special-event guide",
          urls: [
            "https://www.nyc.gov/site/cecm/support/new-york-city-fire-department.page",
            "https://www.nycgovparks.org/permits/special-events/guide",
          ],
        },
      ],
    });
  });

  it("pins the ruleset version and its snapshot date together on the plan", async () => {
    const eventId = await insertEvent();
    await request(appWith()).post(`/api/events/${eventId}/plan`);

    const { rows } = await pool.query<{ ruleset_version: string; snapshot_date: string | null }>(
      `SELECT ruleset_version, to_char(snapshot_date, 'YYYY-MM-DD') AS snapshot_date
         FROM permit_plans WHERE event_id = $1`,
      [eventId],
    );

    expect(rows[0]?.ruleset_version).toBe(ruleset.rulesetVersion);
    expect(rows[0]?.snapshot_date).toBe(ruleset.snapshotDate);
  });

  it("regenerates both F-110 answers into a new immutable intake snapshot only", async () => {
    const fixture = SCENARIO_INTAKE_FIXTURES.find(({ scenario }) => scenario === "F");
    if (fixture === undefined) throw new Error("Scenario F fixture is missing");
    const app = appWith();
    const created = await request(app)
      .post("/api/events")
      .set("Idempotency-Key", randomUUID())
      .send(fixtureSubmission(fixture));
    expect(created.status).toBe(201);
    const eventId = created.body.event.id as string;

    const first = await request(app).post(`/api/events/${eventId}/plan`);
    expect(first.status).toBe(201);
    const edited = await request(app).patch(`/api/events/${eventId}`).send({
      venue_paco_covers_exact_event: "yes",
      venue_fdny_pa_permit_current_for_event_space: "no",
    });
    expect(edited.status).toBe(200);
    expect(edited.body.plan_stale).toBe(true);
    const regenerated = await request(app).post(`/api/events/${eventId}/plan`);

    expect(regenerated.status).toBe(201);
    expect(regenerated.body.eventRevision).toBe(2);
    expect(regenerated.body.verdict).toBe(first.body.verdict);
    expect(
      regenerated.body.findings.map((finding: { ruleIds: string[] }) => finding.ruleIds),
    ).toEqual(first.body.findings.map((finding: { ruleIds: string[] }) => finding.ruleIds));

    const { rows } = await pool.query<{ event_revision: number; intake_snapshot: unknown }>(
      `SELECT event_revision, intake_snapshot
         FROM permit_plans
        WHERE event_id = $1
        ORDER BY event_revision`,
      [eventId],
    );
    expect(rows).toEqual([
      {
        event_revision: 1,
        intake_snapshot: expect.objectContaining({
          venue_paco_covers_exact_event: "unknown",
          venue_fdny_pa_permit_current_for_event_space: "unknown",
        }),
      },
      {
        event_revision: 2,
        intake_snapshot: expect.objectContaining({
          venue_paco_covers_exact_event: "yes",
          venue_fdny_pa_permit_current_for_event_space: "no",
        }),
      },
    ]);
  });

  it("persists plan items with the columns the schema requires and leaves verified_status unwritten", async () => {
    const eventId = await insertEvent();
    await request(appWith()).post(`/api/events/${eventId}/plan`);

    const { rows } = await pool.query<{
      rule_ids: string[];
      kind: string;
      disposition: string;
      deadline_status: string;
      verification_status: string;
      verified_status: string | null;
      latest_apply_date: Date | null;
    }>(
      `SELECT item.* FROM permit_plan_items item
         JOIN permit_plans plan ON plan.id = item.plan_id
        WHERE plan.event_id = $1`,
      [eventId],
    );

    expect(rows).toHaveLength(10);
    expect(rows.every((row) => row.verified_status === null)).toBe(true);
    const notification = rows.find((row) => row.rule_ids[0] === "DOHMH-ORGANIZER-NOTIFY-001");
    expect(notification?.kind).toBe("notification");
    expect(notification?.disposition).toBe("may_be_required");
    expect(notification?.deadline_status).toBe("deadline_approaching");
    expect(notification?.verification_status).toBe("SOURCE_CONFIRMED");
  });

  it("persists and serves a published per-rule verification date", async () => {
    const datedRuleset = parseEngineRuleset({
      ruleset_version: "test.v1",
      jurisdiction: "US-NY-NYC",
      snapshot_date: "2026-07-22",
      config: {
        slack_warning_days: { value: 14 },
        business_day_math: { calendar: "test-calendar@2026" },
      },
      intake_fields: [
        { field: "event_date", type: "date" },
        { field: "headcount", type: "integer" },
      ],
      rules: [
        {
          id: "TEST-DATED-001",
          kind: "permit",
          trigger: { all: [{ field: "headcount", op: "gte", value: 1 }] },
          output: { permit_name: "Synthetic dated requirement", agency: "Test agency" },
          verification: {
            status: "SOURCE_CONFIRMED",
            last_verified_date: "2026-07-18",
          },
          source: { citation: "Synthetic source", urls: ["https://example.test/source"] },
        },
      ],
      advisories: [],
    });
    const eventId = await insertEvent();
    const app = createApp({
      database: pool,
      intakeContract,
      today: () => TODAY,
      planService: createPlanService(pool, datedRuleset, fixtureCalendar, () => TODAY),
    });

    const generated = await request(app).post(`/api/events/${eventId}/plan`);
    expect(generated.body.findings[0]?.lastVerifiedDate).toBe("2026-07-18");

    const { rows } = await pool.query<{ last_verified_date: string | null }>(
      `SELECT to_char(item.last_verified_date, 'YYYY-MM-DD') AS last_verified_date
         FROM permit_plan_items AS item
         JOIN permit_plans AS plan ON plan.id = item.plan_id
        WHERE plan.event_id = $1 AND item.rule_ids = ARRAY['TEST-DATED-001']::text[]`,
      [eventId],
    );
    expect(rows[0]?.last_verified_date).toBe("2026-07-18");

    const fetched = await request(app).get(`/api/events/${eventId}/plan`);
    expect(fetched.body.findings[0]?.lastVerifiedDate).toBe("2026-07-18");
  });

  it("writes an immutable new plan per generation and serves the latest one", async () => {
    const eventId = await insertEvent();
    const app = appWith();
    const first = await request(app).post(`/api/events/${eventId}/plan`);
    const second = await request(app).post(`/api/events/${eventId}/plan`);
    expect(first.body.id).not.toBe(second.body.id);

    const { rows } = await pool.query("SELECT id FROM permit_plans WHERE event_id = $1", [eventId]);
    expect(rows).toHaveLength(2);

    const latest = await request(app).get(`/api/events/${eventId}/plan`);
    expect(latest.status).toBe(200);
    expect(latest.body.id).toBe(second.body.id);
  });

  it("converges concurrent first-plan retries carrying the event create key", async () => {
    const createKey = randomUUID();
    const eventId = await insertEvent({
      create_idempotency_key: createKey,
      create_request_body: scenarioAEvent,
    });
    const app = appWith();

    const responses = await Promise.all([
      request(app)
        .post(`/api/events/${eventId}/plan`)
        .set("Idempotency-Key", createKey.toUpperCase()),
      request(app).post(`/api/events/${eventId}/plan`).set("Idempotency-Key", createKey),
    ]);

    expect(responses.map(({ status }) => status).sort()).toEqual([200, 201]);
    expect(responses[0]?.body.id).toBe(responses[1]?.body.id);
    const { rows } = await pool.query("SELECT id FROM permit_plans WHERE event_id = $1", [eventId]);
    expect(rows).toHaveLength(1);
  });

  it("returns the original first plan when a keyed retry follows manual regeneration", async () => {
    const createKey = randomUUID();
    const eventId = await insertEvent({
      create_idempotency_key: createKey,
      create_request_body: scenarioAEvent,
    });
    const app = appWith();

    const first = await request(app)
      .post(`/api/events/${eventId}/plan`)
      .set("Idempotency-Key", createKey);
    const regenerated = await request(app).post(`/api/events/${eventId}/plan`);
    const retried = await request(app)
      .post(`/api/events/${eventId}/plan`)
      .set("Idempotency-Key", createKey);

    expect(first.status).toBe(201);
    expect(regenerated.status).toBe(201);
    expect(retried.status).toBe(200);
    expect(retried.body.id).toBe(first.body.id);
    expect(retried.body.id).not.toBe(regenerated.body.id);
  });

  it("returns a stored keyed plan before consulting current evaluation dependencies", async () => {
    const createKey = randomUUID();
    const eventId = await insertEvent({
      create_idempotency_key: createKey,
      create_request_body: scenarioAEvent,
    });
    const first = await request(appWith())
      .post(`/api/events/${eventId}/plan`)
      .set("Idempotency-Key", createKey);
    let calendarReads = 0;
    const retry = await request(
      appWith(() => {
        calendarReads += 1;
        throw new Error("current calendar is unavailable");
      }),
    )
      .post(`/api/events/${eventId}/plan`)
      .set("Idempotency-Key", createKey);

    expect(first.status).toBe(201);
    expect(retry.status).toBe(200);
    expect(retry.body.id).toBe(first.body.id);
    expect(calendarReads).toBe(0);
  });

  it("rejects malformed or unrelated first-plan keys without writing", async () => {
    const createKey = randomUUID();
    const eventId = await insertEvent({
      create_idempotency_key: createKey,
      create_request_body: scenarioAEvent,
    });
    const app = appWith();

    const malformed = await request(app)
      .post(`/api/events/${eventId}/plan`)
      .set("Idempotency-Key", "not-a-uuid");
    const unrelated = await request(app)
      .post(`/api/events/${eventId}/plan`)
      .set("Idempotency-Key", randomUUID());

    expect(malformed.status).toBe(400);
    expect(unrelated.status).toBe(409);
    const { rows } = await pool.query("SELECT id FROM permit_plans WHERE event_id = $1", [eventId]);
    expect(rows).toHaveLength(0);
  });

  it("round-trips a stored plan identically to the plan it returned at generation (AC 3)", async () => {
    const eventId = await insertEvent();
    const app = appWith();
    const generated = await request(app).post(`/api/events/${eventId}/plan`);
    const fetched = await request(app).get(`/api/events/${eventId}/plan`);
    expect(fetched.body.findings).toEqual(generated.body.findings);
    expect(fetched.body.verdict).toBe(generated.body.verdict);
  });

  it("round-trips the PACO organizer summary through the immutable plan snapshot", async () => {
    const eventId = await insertEvent({ location_type: "private_venue", headcount: 90 });
    const app = appWith();
    const generated = await request(app).post(`/api/events/${eventId}/plan`);
    const generatedAssembly = generated.body.findings.find((finding: { ruleIds: string[] }) =>
      finding.ruleIds.includes("DOB-ASSEMBLY-001"),
    );

    expect(generatedAssembly.userSummary.heading).toBe("Place of Assembly approval (PACO / TPA)");

    const fetched = await request(app).get(`/api/events/${eventId}/plan`);
    const fetchedAssembly = fetched.body.findings.find((finding: { ruleIds: string[] }) =>
      finding.ruleIds.includes("DOB-ASSEMBLY-001"),
    );
    expect(fetchedAssembly.userSummary).toEqual(generatedAssembly.userSummary);
  });

  it("keeps the official conflict and its sources readable after storage (AC 2)", async () => {
    const eventId = await insertEvent({
      location_type: "park",
      obstructs_public_way: null,
      sapo_event_type: null,
      street_event_size: null,
      headcount: 150,
      selling_anything: true,
    });
    const app = appWith();
    await request(app).post(`/api/events/${eventId}/plan`);
    const fetched = await request(app).get(`/api/events/${eventId}/plan`);

    const tua = fetched.body.findings.find((finding: { ruleIds: string[] }) =>
      finding.ruleIds.includes("PARKS-TUA-001"),
    );
    expect(tua.disposition).toBe("may_be_required");
    expect(tua.verificationStatus).toBe("OFFICIAL_CONFLICT");
    expect(tua.conflictText).toContain("OFFICIAL CONFLICT");
    expect(tua.sources[0].urls).toHaveLength(4);
  });

  it("renders 'confirm with agency' on a research-required lead time after storage", async () => {
    const eventId = await insertEvent({ open_flame_or_cooking: ["charcoal_wood"] });
    const app = appWith();
    await request(app).post(`/api/events/${eventId}/plan`);
    const fetched = await request(app).get(`/api/events/${eventId}/plan`);

    const fuel = fetched.body.findings.find((finding: { ruleIds: string[] }) =>
      finding.ruleIds.includes("FDNY-FUEL-001"),
    );
    expect(fuel.deadlineStatus).toBe("not_calculable");
    expect(fuel.notes).toContain("confirm with agency");
  });

  it("returns an explicit error and stores nothing when evaluation fails (AC 5)", async () => {
    const eventId = await insertEvent();
    const response = await request(
      appWith((calendarId) => ({ id: `${calendarId}-mismatched`, holidays: [] })),
    ).post(`/api/events/${eventId}/plan`);

    expect(response.status).toBe(500);
    expect(response.body.error).toBe("plan generation failed");
    expect(response.body.detail).toContain("does not match the ruleset's pinned calendar");
    expect(response.body.findings).toBeUndefined();
    const { rows } = await pool.query("SELECT id FROM permit_plans WHERE event_id = $1", [eventId]);
    expect(rows).toHaveLength(0);
  });

  it("generates normally with no published holiday list when nothing needs business days", async () => {
    const eventId = await insertEvent();
    const response = await request(appWith(unpublishedCalendar)).post(
      `/api/events/${eventId}/plan`,
    );

    expect(response.status).toBe(201);
    expect(response.body.verdict).toBe("INFEASIBLE");
    expect(response.body.findings).toHaveLength(10);
    expect(response.body.findings[0].latestApplyDate).toBe("2026-07-12");
    const undated = response.body.findings.filter(
      (finding: { latestApplyDate: string | null; deadline: { type: string } | null }) =>
        finding.latestApplyDate === null && finding.deadline !== null,
    );
    expect(undated.map((finding: { deadline: { type: string } }) => finding.deadline.type)).toEqual(
      ["before_issuance", "research_required"],
    );
  });

  it("warns operators that the pinned calendar has no published holiday list", () => {
    const warning = holidayCalendarWarning(unpublishedCalendar(ruleset.calendarId));
    expect(warning).toContain("no published holiday list");
    expect(warning).toContain(ruleset.calendarId);
    expect(holidayCalendarWarning({ id: "published@2026", holidays: [] })).toBeNull();
  });

  it("notifies when a list is published for the pinned calendar (OPEN-QUESTIONS R-10)", () => {
    expect(
      pinnedCalendar(ruleset.calendarId).holidays,
      PUBLICATION_REQUIRES_R10_RESOLUTION,
    ).toBeNull();
  });

  it("derives today in the jurisdiction's own calendar, not UTC", () => {
    const lateEvening = new Date("2026-08-12T02:30:00Z");
    expect(todayInJurisdiction("US-NY-NYC", lateEvening)).toBe("2026-08-11");
    expect(todayInJurisdiction("US-NY-NYC", new Date("2026-08-12T14:00:00Z"))).toBe("2026-08-12");
    expect(() => todayInJurisdiction("US-XX-NOWHERE")).toThrow(/no local time zone is mapped/);
  });

  it("moves the rollover with the offset rather than fixing it", () => {
    expect(todayInJurisdiction("US-NY-NYC", new Date("2026-01-12T04:30:00Z"))).toBe("2026-01-11");
    expect(todayInJurisdiction("US-NY-NYC", new Date("2026-01-12T05:30:00Z"))).toBe("2026-01-12");
  });

  it("rejects a malformed event id without touching the database", async () => {
    const app = appWith();
    for (const route of ["post", "get"] as const) {
      const response = await request(app)[route]("/api/events/not-a-uuid/plan");
      expect(response.status).toBe(400);
      expect(response.body.error).toBe("event id must be a uuid");
      expect(JSON.stringify(response.body)).not.toContain("22P02");
      expect(response.body.detail).toBeUndefined();
    }
  });

  it("keeps a plan conditional and names the finding whose window it cannot date", async () => {
    const eventId = await insertEvent({
      location_type: "private_venue",
      obstructs_public_way: null,
      sapo_event_type: null,
      street_event_size: null,
      headcount: 90,
      event_open_to_public: "no",
      food_present: false,
      food_vendor_count: null,
      selling_anything: false,
      amplified_sound: true,
      sound_audible_from_public_way: "yes",
      alcohol: true,
      venue_license_covers_event_area: "no",
    });

    const degraded = await request(appWith(unpublishedCalendar)).post(
      `/api/events/${eventId}/plan`,
    );
    expect(degraded.status).toBe(201);
    const withoutList = degraded.body.findings.find((finding: { ruleIds: string[] }) =>
      finding.ruleIds.includes("SLA-ONEDAY-001"),
    );
    expect(withoutList.latestApplyDate).toBeNull();
    expect(withoutList.deadlineStatus).toBe("not_calculable");
    expect(withoutList.notes).toContain("confirm with agency");
    expect(degraded.body.verdict).toBe("CONDITIONAL");
    expect(
      degraded.body.verdictDetail.unresolvedTimelines.map(
        (entry: { ruleIds: string[] }) => entry.ruleIds,
      ),
    ).toContainEqual(["SLA-ONEDAY-001"]);
    const assembly = degraded.body.findings.find((finding: { ruleIds: string[] }) =>
      finding.ruleIds.includes("DOB-ASSEMBLY-001"),
    );
    expect(assembly.latestApplyDate).toBeNull();
    expect(assembly.deadlineStatus).toBe("not_calculable");
    expect(assembly.notes).toContain("confirm with agency");
    const sound = degraded.body.findings.find((finding: { ruleIds: string[] }) =>
      finding.ruleIds.includes("NYPD-SOUND-001"),
    );
    expect(sound.latestApplyDate).toBe("2026-08-21");
    expect(sound.deadlineStatus).toBe("on_track");

    const computed = await request(appWith()).post(`/api/events/${eventId}/plan`);
    const withList = computed.body.findings.find((finding: { ruleIds: string[] }) =>
      finding.ruleIds.includes("SLA-ONEDAY-001"),
    );
    expect(withList.latestApplyDate).toBe("2026-08-05");
    expect(withList.deadlineStatus).toBe("on_track");
  });

  it("reads a Postgres date as its stored calendar day, east of UTC included", async () => {
    const localMidnight = new Date(2026, 7, 26);
    expect(calendarDateFrom(localMidnight)).toBe("2026-08-26");
    expect(calendarDateFrom("2026-08-26")).toBe("2026-08-26");

    const eventId = await insertEvent();
    const generated = await request(appWith()).post(`/api/events/${eventId}/plan`);
    expect(generated.body.findings[0].latestApplyDate).toBe("2026-07-12");
    const fetched = await request(appWith()).get(`/api/events/${eventId}/plan`);
    expect(fetched.body.findings[0].latestApplyDate).toBe("2026-07-12");
  });

  it("fails the read rather than serving a plan whose items went missing (AC 5)", async () => {
    const eventId = await insertEvent();
    const app = appWith();
    const generated = await request(app).post(`/api/events/${eventId}/plan`);
    expect(generated.body.findings).toHaveLength(10);

    await pool.query(
      `DELETE FROM permit_plan_items WHERE plan_id = $1 AND rule_ids = ARRAY['NYPD-SOUND-001']::text[]`,
      [generated.body.id],
    );

    const fetched = await request(app).get(`/api/events/${eventId}/plan`);
    expect(fetched.status).toBe(500);
    expect(fetched.body.error).toBe("plan lookup failed");
    expect(fetched.body.detail).toContain("is incomplete");
    expect(fetched.body.findings).toBeUndefined();
  });

  it("persists the dependency-gated apply-after date for the Parks to NYPD sequence", async () => {
    const eventId = await insertEvent({
      location_type: "park",
      obstructs_public_way: null,
      sapo_event_type: null,
      street_event_size: null,
      headcount: 150,
      event_date: "2026-09-16",
      food_present: false,
      food_vendor_count: null,
      selling_anything: false,
      amplified_sound: true,
    });
    const app = appWith();
    await request(app).post(`/api/events/${eventId}/plan`);

    const { rows } = await pool.query<{ apply_after_date: Date | string | null }>(
      `SELECT item.apply_after_date FROM permit_plan_items item
         JOIN permit_plans plan ON plan.id = item.plan_id
        WHERE plan.event_id = $1 AND item.rule_ids = ARRAY['NYPD-SOUND-001']::text[]`,
      [eventId],
    );
    expect(rows).toHaveLength(1);
    expect(calendarDateFrom(rows[0]!.apply_after_date as Date)).toBe("2026-08-12");

    const fetched = await request(app).get(`/api/events/${eventId}/plan`);
    const sound = fetched.body.findings.find((finding: { ruleIds: string[] }) =>
      finding.ruleIds.includes("NYPD-SOUND-001"),
    );
    expect(sound.applyAfterDate).toBe("2026-08-12");
  });

  it("round-trips the published in-person filing instructions through storage", async () => {
    const eventId = await insertEvent({
      location_type: "park",
      obstructs_public_way: null,
      sapo_event_type: null,
      street_event_size: null,
      headcount: 150,
      food_present: false,
      food_vendor_count: null,
      selling_anything: false,
      amplified_sound: true,
    });
    const app = appWith();
    const generated = await request(app).post(`/api/events/${eventId}/plan`);
    const fetched = await request(app).get(`/api/events/${eventId}/plan`);

    for (const body of [generated.body, fetched.body]) {
      const sound = body.findings.find((finding: { ruleIds: string[] }) =>
        finding.ruleIds.includes("NYPD-SOUND-001"),
      );
      expect(sound.portalUrl).toBeNull();
      expect(sound.portalInstructions).toBe(
        "File at the precinct where the device will be used; application form PD 656-041A.",
      );
    }
  });

  it("404s for an unknown event and for an event with no plan yet", async () => {
    const app = appWith();
    const unknownId = randomUUID();
    expect((await request(app).post(`/api/events/${unknownId}/plan`)).status).toBe(404);
    expect((await request(app).get(`/api/events/${unknownId}/plan`)).status).toBe(404);

    const eventId = await insertEvent();
    const noPlanYet = await request(app).get(`/api/events/${eventId}/plan`);
    expect(noPlanYet.status).toBe(404);
    expect(noPlanYet.body.error).toContain("no plan generated");
  });

  const appOnRulesetVersion = (rulesetVersion: string) =>
    createApp({
      database: pool,
      intakeContract,
      today: () => TODAY,
      planService: createPlanService(
        pool,
        { ...ruleset, rulesetVersion },
        fixtureCalendar,
        () => TODAY,
      ),
    });

  const storedPlanVersions = async (eventId: string): Promise<string[]> => {
    const { rows } = await pool.query<{ ruleset_version: string }>(
      "SELECT ruleset_version FROM permit_plans WHERE event_id = $1 ORDER BY generated_at, id",
      [eventId],
    );
    return rows.map((row) => row.ruleset_version);
  };

  it("refuses to regenerate from a ruleset older than the stored plan pinned, and writes nothing", async () => {
    const eventId = await insertEvent();
    expect(
      (await request(appOnRulesetVersion("nyc.v2.11")).post(`/api/events/${eventId}/plan`)).status,
    ).toBe(201);

    const downgrade = await request(appOnRulesetVersion("nyc.v2.10")).post(
      `/api/events/${eventId}/plan`,
    );

    expect(downgrade.status).toBe(409);
    expect(downgrade.body.rulesetVersion).toBe("nyc.v2.10");
    expect(downgrade.body.pinnedRulesetVersion).toBe("nyc.v2.11");
    expect(downgrade.body.standing).toBe("older");
    expect(downgrade.body.error).toContain("nyc.v2.11");
    expect(await storedPlanVersions(eventId)).toEqual(["nyc.v2.11"]);
  });

  it("regenerates on the same ruleset version, which is the ordinary case", async () => {
    const eventId = await insertEvent();
    const app = appOnRulesetVersion("nyc.v2.11");
    expect((await request(app).post(`/api/events/${eventId}/plan`)).status).toBe(201);

    expect((await request(app).post(`/api/events/${eventId}/plan`)).status).toBe(201);
    expect(await storedPlanVersions(eventId)).toEqual(["nyc.v2.11", "nyc.v2.11"]);
  });

  it("regenerates on a newer ruleset version", async () => {
    const eventId = await insertEvent();
    expect(
      (await request(appOnRulesetVersion("nyc.v2.11")).post(`/api/events/${eventId}/plan`)).status,
    ).toBe(201);

    expect(
      (await request(appOnRulesetVersion("nyc.v2.12")).post(`/api/events/${eventId}/plan`)).status,
    ).toBe(201);
    expect(
      (await request(appOnRulesetVersion("nyc.v3.0")).post(`/api/events/${eventId}/plan`)).status,
    ).toBe(201);
    expect(await storedPlanVersions(eventId)).toEqual(["nyc.v2.11", "nyc.v2.12", "nyc.v3.0"]);
  });

  it("refuses a pair of versions that cannot be ordered, and says that is why", async () => {
    const eventId = await insertEvent();
    expect(
      (await request(appOnRulesetVersion("nyc.v2.11")).post(`/api/events/${eventId}/plan`)).status,
    ).toBe(201);

    for (const unorderable of ["bos.v1.0", "draft"]) {
      const refused = await request(appOnRulesetVersion(unorderable)).post(
        `/api/events/${eventId}/plan`,
      );
      expect(refused.status).toBe(409);
      expect(refused.body.standing).toBe("different");
      expect(refused.body.rulesetVersion).toBe(unorderable);
      expect(refused.body.pinnedRulesetVersion).toBe("nyc.v2.11");
      expect(refused.body.error).toContain("cannot be ordered");
    }
    expect(await storedPlanVersions(eventId)).toEqual(["nyc.v2.11"]);
  });

  it("refuses when both versions carry the same unparseable label", async () => {
    const eventId = await insertEvent();
    const app = appOnRulesetVersion("draft");
    expect((await request(app).post(`/api/events/${eventId}/plan`)).status).toBe(201);

    const refused = await request(app).post(`/api/events/${eventId}/plan`);

    expect(refused.status).toBe(409);
    expect(refused.body.standing).toBe("different");
    expect(refused.body.rulesetVersion).toBe("draft");
    expect(refused.body.pinnedRulesetVersion).toBe("draft");
    expect(refused.body.error).toContain("cannot be ordered");
    expect(await storedPlanVersions(eventId)).toEqual(["draft"]);
  });

  it("refuses when a newer-pinned plan is stored between the generation's read and its insert", async () => {
    const eventId = await insertEvent();
    const competing = await pool.connect();

    try {
      await competing.query("BEGIN");
      await competing.query("SELECT id FROM events WHERE id = $1 FOR UPDATE", [eventId]);
      await competing.query(
        `INSERT INTO permit_plans
           (id, event_id, event_revision, ruleset_version, verdict, verdict_detail, intake_snapshot)
         VALUES ($1, $2, 1, 'nyc.v2.12', 'conditional', $3::jsonb, '{}'::jsonb)`,
        [
          randomUUID(),
          eventId,
          JSON.stringify({ today: TODAY, calendar_id: ruleset.calendarId, finding_renderings: [] }),
        ],
      );

      const generation = request(appOnRulesetVersion("nyc.v2.11"))
        .post(`/api/events/${eventId}/plan`)
        .then((response) => response);

      const blockedOnEventLock = async (): Promise<boolean> => {
        const { rows } = await pool.query(
          `SELECT 1 FROM pg_stat_activity
            WHERE datname = current_database()
              AND wait_event_type = 'Lock'
              AND query LIKE 'SELECT id FROM events WHERE id = $1 FOR UPDATE%'`,
        );
        return rows.length > 0;
      };
      let blocked = false;
      for (let attempt = 0; attempt < 100 && !blocked; attempt += 1) {
        blocked = await blockedOnEventLock();
        if (!blocked) await new Promise((resolve) => setTimeout(resolve, 50));
      }
      expect(
        blocked,
        "the generation never blocked on the events row lock, so nothing serialized it and this " +
          "test asserted nothing about the interleaving",
      ).toBe(true);

      await competing.query("COMMIT");
      const response = await generation;

      expect(response.status).toBe(409);
      expect(response.body.standing).toBe("older");
      expect(response.body.pinnedRulesetVersion).toBe("nyc.v2.12");
      expect(await storedPlanVersions(eventId)).toEqual(["nyc.v2.12"]);
    } finally {
      competing.release();
    }
  });

  type LooseQuery = (...args: unknown[]) => Promise<unknown>;
  const poolPausedBeforeLock = (
    onLock: () => void,
    released: Promise<void>,
    base: Pool = pool,
  ): Pool =>
    ({
      connect: async (): Promise<PoolClient> => {
        const client = await base.connect();
        const query = client.query.bind(client) as unknown as LooseQuery;
        const release = client.release.bind(client);
        let paused = false;
        client.query = (async (...args: unknown[]) => {
          if (!paused && String(args[0]).includes("FOR UPDATE")) {
            paused = true;
            onLock();
            await released;
          }
          return query(...args);
        }) as unknown as PoolClient["query"];
        client.release = ((...args: unknown[]) => {
          client.query = query as unknown as PoolClient["query"];
          client.release = release;
          return (release as unknown as LooseQuery)(...args);
        }) as unknown as PoolClient["release"];
        return client;
      },
      query: (...args: unknown[]) => (base.query as unknown as LooseQuery)(...args),
    }) as unknown as Pool;

  it("treats the plan inserted last under the lock as the latest, not the one whose transaction started first", async () => {
    const eventId = await insertEvent();
    let reachedLock = (): void => {};
    const atLock = new Promise<void>((resolve) => {
      reachedLock = resolve;
    });
    let releaseGeneration = (): void => {};
    const released = new Promise<void>((resolve) => {
      releaseGeneration = resolve;
    });

    const app = createApp({
      database: pool,
      intakeContract,
      today: () => TODAY,
      planService: createPlanService(
        poolPausedBeforeLock(() => reachedLock(), released),
        { ...ruleset, rulesetVersion: "nyc.v2.12" },
        fixtureCalendar,
        () => TODAY,
      ),
    });
    const generation = request(app)
      .post(`/api/events/${eventId}/plan`)
      .then((response) => response);
    await atLock;

    const overtakingId = randomUUID();
    const overtaking = await pool.connect();
    try {
      await overtaking.query("BEGIN");
      await overtaking.query("SELECT id FROM events WHERE id = $1 FOR UPDATE", [eventId]);
      await overtaking.query(
        `INSERT INTO permit_plans
           (id, event_id, event_revision, ruleset_version, verdict, verdict_detail, intake_snapshot)
         VALUES ($1, $2, 1, 'nyc.v2.11', 'conditional', $3::jsonb, '{}'::jsonb)`,
        [
          overtakingId,
          eventId,
          JSON.stringify({ today: TODAY, calendar_id: ruleset.calendarId, finding_renderings: [] }),
        ],
      );
      await overtaking.query("COMMIT");
    } finally {
      overtaking.release();
    }

    releaseGeneration();
    const generated = await generation;
    expect(generated.status).toBe(201);
    expect(generated.body.rulesetVersion).toBe("nyc.v2.12");

    const { rows: stamps } = await pool.query<{ id: string; generated_at: Date }>(
      "SELECT id, generated_at FROM permit_plans WHERE event_id = $1 ORDER BY generated_at, id",
      [eventId],
    );
    expect(stamps.map((row) => row.id)).toEqual([overtakingId, generated.body.id]);

    const fetched = await request(app).get(`/api/events/${eventId}/plan`);
    expect(fetched.body.id).toBe(generated.body.id);
    expect(fetched.body.rulesetVersion).toBe("nyc.v2.12");

    const downgrade = await request(appOnRulesetVersion("nyc.v2.11")).post(
      `/api/events/${eventId}/plan`,
    );
    expect(downgrade.status).toBe(409);
    expect(downgrade.body.pinnedRulesetVersion).toBe("nyc.v2.12");
    expect(await storedPlanVersions(eventId)).toEqual(["nyc.v2.11", "nyc.v2.12"]);
  });

  const FROZEN_INSTANT = "2026-08-04 12:00:00+00";
  const frozenClockPool = async (): Promise<Pool> => {
    await pool.query("CREATE SCHEMA IF NOT EXISTS frozen_clock");
    await pool.query(
      `CREATE OR REPLACE FUNCTION frozen_clock.clock_timestamp() RETURNS timestamptz
         LANGUAGE sql IMMUTABLE AS $$ SELECT timestamptz '${FROZEN_INSTANT}' $$`,
    );
    return new Pool({
      connectionString: databaseUrl,
      options: "-c search_path=frozen_clock,pg_catalog,public",
    });
  };

  it("orders the plan inserted second under the lock after the first even when the clock returns the same instant for both", async () => {
    const eventId = await insertEvent();
    const frozen = await frozenClockPool();
    let reachedLock = (): void => {};
    const atLock = new Promise<void>((resolve) => {
      reachedLock = resolve;
    });
    let releaseGeneration = (): void => {};
    const released = new Promise<void>((resolve) => {
      releaseGeneration = resolve;
    });

    const onFrozenClock = (rulesetVersion: string, database: Pool) =>
      createApp({
        database: pool,
        intakeContract,
        today: () => TODAY,
        planService: createPlanService(
          database,
          { ...ruleset, rulesetVersion },
          fixtureCalendar,
          () => TODAY,
        ),
      });

    try {
      const secondApp = onFrozenClock(
        "nyc.v2.12",
        poolPausedBeforeLock(() => reachedLock(), released, frozen),
      );
      const second = request(secondApp)
        .post(`/api/events/${eventId}/plan`)
        .then((response) => response);
      await atLock;

      const first = await request(onFrozenClock("nyc.v2.11", frozen)).post(
        `/api/events/${eventId}/plan`,
      );
      expect(first.status).toBe(201);

      releaseGeneration();
      const generated = await second;
      expect(generated.status).toBe(201);

      const { rows: stamps } = await pool.query<{
        id: string;
        on_frozen_instant: boolean;
        one_microsecond_later: boolean;
      }>(
        `SELECT id,
                generated_at = timestamptz '${FROZEN_INSTANT}' AS on_frozen_instant,
                generated_at = timestamptz '${FROZEN_INSTANT}' + interval '1 microsecond'
                  AS one_microsecond_later
           FROM permit_plans WHERE event_id = $1 ORDER BY generated_at, id`,
        [eventId],
      );
      expect(stamps.map((row) => row.id)).toEqual([first.body.id, generated.body.id]);
      expect(stamps.map((row) => row.on_frozen_instant)).toEqual([true, false]);
      expect(stamps.map((row) => row.one_microsecond_later)).toEqual([false, true]);

      const fetched = await request(secondApp).get(`/api/events/${eventId}/plan`);
      expect(fetched.body.id).toBe(generated.body.id);
      expect(fetched.body.rulesetVersion).toBe("nyc.v2.12");

      const downgrade = await request(appOnRulesetVersion("nyc.v2.11")).post(
        `/api/events/${eventId}/plan`,
      );
      expect(downgrade.status).toBe(409);
      expect(downgrade.body.pinnedRulesetVersion).toBe("nyc.v2.12");
      expect(await storedPlanVersions(eventId)).toEqual(["nyc.v2.11", "nyc.v2.12"]);
    } finally {
      await frozen.end();
    }
  });
});

describe("the route a stored plan item reads its window off (#252)", () => {
  const rendering = (routes: FindingRendering["routes"]): FindingRendering => ({
    rule_ids: ["A", "B"],
    notes: [],
    note_text: null,
    conflict_text: null,
    deadline_display: null,
    slack_days: null,
    deadline_unknown_fields: [],
    timeline_unresolved_reason: null,
    portal_instructions: null,
    routes,
    headline_mode: "candidate",
  });

  const route = (overrides: Record<string, unknown>) =>
    ({
      ruleId: "A",
      triggerResult: "true",
      disposition: "may_be_required",
      unknownFields: [],
      name: "route A",
      agency: "DOB",
      deadline: null,
      deadlineDisplay: null,
      latestApplyDate: null,
      applyAfterDate: null,
      deadlineStatus: "not_applicable",
      slackDays: null,
      feeDisplay: null,
      portalName: null,
      portalUrl: null,
      portalInstructions: null,
      ...overrides,
    }) as NonNullable<FindingRendering["routes"]>[number];

  const item: StoredPlanItem = {
    rule_ids: ["A", "B"],
    permit_name: "route A",
    agency: "DOB",
    disposition: "may_be_required",
    deadline: null,
    latest_apply_date: null,
    apply_after_date: null,
    deadline_status: "not_applicable",
    fee_display: null,
    portal_name: null,
    portal_url: null,
  };

  it("reads the dated route when another route publishes a computable window", () => {
    const routes = [
      route({}),
      route({
        ruleId: "B",
        name: "route B",
        deadline: { type: "published_minimum", calendarDays: 30 },
        latestApplyDate: "2026-08-26",
        deadlineStatus: "on_track",
        feeDisplay: "$100",
      }),
    ];
    expect(filingRouteOf(item, rendering(routes))?.ruleId).toBe("B");
  });

  it("reads a route whose published window the engine could not date", () => {
    const routes = [
      route({}),
      route({
        ruleId: "B",
        name: "route B",
        deadline: { type: "business_days_minimum", businessDays: 15 },
        latestApplyDate: null,
        deadlineStatus: "not_calculable",
        feeDisplay: "TUP: $100 initial 30 days",
      }),
    ];
    const filing = filingRouteOf(item, rendering(routes));
    expect(filing?.ruleId).toBe("B");
    expect(filing?.feeDisplay).toBe("TUP: $100 initial 30 days");
    expect(filing?.deadlineStatus).toBe("not_calculable");
  });

  it("still names a route for a line that publishes no scalars of its own", () => {
    const routes = [
      route({ ruleId: "A", latestApplyDate: null }),
      route({
        ruleId: "B",
        name: "route B",
        triggerResult: "unknown",
        unknownFields: ["sidewalk_use"],
        deadline: { type: "published_minimum", calendarDays: 30 },
        latestApplyDate: "2026-08-26",
        deadlineStatus: "on_track",
        feeDisplay: "$1,050 licence fee",
      }),
    ];
    const unattributable: StoredPlanItem = {
      ...item,
      permit_name: null,
      agency: null,
      deadline_status: "not_calculable",
    };
    const filing = filingRouteOf(unattributable, rendering(routes));
    expect(filing?.ruleId).toBe("B");
    expect(filing?.feeDisplay).toBe("$1,050 licence fee");
  });

  it("skips a dated route that publishes no filing, and takes the next that does", () => {
    const routes = [
      route({}),
      route({
        ruleId: "ADVISORY-001",
        name: "advisory route",
        disposition: "advisory",
        deadline: { type: "published_minimum", calendarDays: 10 },
        latestApplyDate: "2026-08-01",
        deadlineStatus: "on_track",
      }),
      route({
        ruleId: "B",
        name: "route B",
        deadline: { type: "published_minimum", calendarDays: 30 },
        latestApplyDate: "2026-08-26",
        deadlineStatus: "on_track",
        feeDisplay: "$100",
      }),
    ];
    const filing = filingRouteOf(item, rendering(routes));
    expect(filing?.ruleId).toBe("B");
    expect(filing?.feeDisplay).toBe("$100");
  });

  it("selects nothing where the only dated routes publish no filing", () => {
    const routes = [
      route({}),
      route({
        ruleId: "NOTE-001",
        name: "note route",
        disposition: "no_new_requirement",
        latestApplyDate: "2026-08-01",
        deadlineStatus: "on_track",
      }),
    ];
    expect(filingRouteOf(item, rendering(routes))).toBeNull();
  });

  it("leaves a line that publishes its own window alone", () => {
    const dated = { ...item, deadline: { type: "published_minimum" } as never };
    expect(filingRouteOf(dated, rendering([route({}), route({ ruleId: "B" })]))).toBeNull();
  });

  it("treats an unmerged row as its own single route, and never reattributes it", () => {
    const unmerged: StoredPlanItem = { ...item, rule_ids: ["A"] };
    expect(storedRoutes(unmerged, undefined)).toHaveLength(1);
    expect(storedRoutes(unmerged, undefined)[0]?.ruleId).toBe("A");
    expect(filingRouteOf(unmerged, undefined)).toBeNull();
  });
});
