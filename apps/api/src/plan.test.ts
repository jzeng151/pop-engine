// F-201 API surface: POST /api/events/:id/plan and GET /api/events/:id/plan against a real
// database. Runs only when one is configured, matching the other schema-backed suites.

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
import { createApp } from "./app";
import { holidayCalendarWarning, pinnedCalendar, todayInJurisdiction } from "./calendar";
import { calendarDateFrom, createPlanService } from "./plan";
import { loadRuleset, rulesFilePath } from "./ruleset";

const databaseUrl = process.env.DATABASE_URL ?? "";
const TODAY = "2026-07-22";

/** Scenario A's intake as an events row, with every NOT NULL column answered. */
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

  // Production refuses to run without a published holiday list; the fixtures pin dates in windows
  // the answer key states carry no contested holidays (AD-11), so they inject the list explicitly
  // rather than relaxing that guard.
  const fixtureCalendar = (calendarId: string): HolidayCalendar => ({
    id: calendarId,
    holidays: [],
  });

  // The missing-list path, stated outright. These tests used to reach it by passing production's
  // own `pinnedCalendar`, which degrades only for as long as no list is published — so publishing
  // one would have flipped them from "exercises the missing-list path" to "fails", and the path
  // itself would have gone untested at the moment it mattered most. The behaviour under test is
  // "the calendar publishes no list", so the calendar says that.
  const unpublishedCalendar = (calendarId: string): HolidayCalendar => ({
    id: calendarId,
    holidays: null,
  });

  /**
   * What the pinned-calendar notification below says when it fails, since the failure is the whole
   * point of it. It must not read as "you broke something": publishing this list is one of the
   * resolutions SPEC-CONFLICT #130 records, and an approved criterion is unsatisfiable until one of
   * them happens.
   */
  const PUBLICATION_IS_A_RESOLUTION = [
    `A holiday list is now published for the ruleset's pinned calendar.`,
    `THIS IS AN EXPECTED RESOLUTION OF SPEC-CONFLICT #130, NOT A REGRESSION:`,
    `F-201 AC 10 and ARCHITECTURE AD-11 both require business-day math against this calendar, and`,
    `neither is satisfiable in production while no list exists. This assertion is a notification,`,
    `so that publishing lands in one visible place instead of silently moving four plan dates.`,
    `Before deleting it, read the doc comment on PUBLISHED_HOLIDAY_CALENDARS in`,
    `apps/api/src/calendar.ts: it records what blocked publication — no source consulted defines`,
    `"business day" for a filing lead, which is the independent reason, and one calendar id spans`,
    `a city agency and a state agency whose published STAFF holiday schedules differ, which matters`,
    `only if a staff closure stops a filing counter and nothing establishes that it does — and #130`,
    `records the resolutions and their costs. If those are answered, delete this test and close #130.`,
  ].join(" ");

  // The app serves the intake routes alongside the plan routes, so it takes their
  // dependencies too. These tests drive only the plan routes; the intake contract and
  // the pool are the same ones the api boots with.
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
    expect(response.body.rulesetVersion).toBe("nyc.v2.11");
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

    // The pair, not just the version: F-206 AC 4 renders both from the plan row, so a snapshot
    // date left NULL here is unrecoverable once the live file moves on.
    expect(rows[0]?.ruleset_version).toBe(ruleset.rulesetVersion);
    expect(rows[0]?.snapshot_date).toBe(ruleset.snapshotDate);
  });

  it("regenerates both F-110 answers into a new immutable intake snapshot only", async () => {
    const fixture = SCENARIO_INTAKE_FIXTURES.find(({ scenario }) => scenario === "F");
    if (fixture === undefined) throw new Error("Scenario F fixture is missing");
    const app = appWith();
    const created = await request(app).post("/api/events").send(fixtureSubmission(fixture));
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
    // Scenario A triggers no business-day rule, so its plan is fully computable. Withholding it
    // because some other rule would have needed a holiday list helps nobody.
    const eventId = await insertEvent();
    const response = await request(appWith(unpublishedCalendar)).post(
      `/api/events/${eventId}/plan`,
    );

    expect(response.status).toBe(201);
    expect(response.body.verdict).toBe("INFEASIBLE");
    expect(response.body.findings).toHaveLength(10);
    expect(response.body.findings[0].latestApplyDate).toBe("2026-07-12");
    // The only undated lines are ones the ruleset itself leaves undated: insurance is owed before
    // issuance and the DOHMH vendor lead time is research-required. Neither is a calendar gap, and
    // no business_days_minimum rule triggers here.
    const undated = response.body.findings.filter(
      (finding: { latestApplyDate: string | null; deadline: { type: string } | null }) =>
        finding.latestApplyDate === null && finding.deadline !== null,
    );
    expect(undated.map((finding: { deadline: { type: string } }) => finding.deadline.type)).toEqual(
      ["before_issuance", "research_required"],
    );
  });

  it("warns operators that the pinned calendar has no published holiday list", () => {
    // Plans still generate; the warning is how an operator learns why business-day lines are
    // undated, instead of an organizer discovering it.
    const warning = holidayCalendarWarning(unpublishedCalendar(ruleset.calendarId));
    expect(warning).toContain("no published holiday list");
    expect(warning).toContain(ruleset.calendarId);
    expect(holidayCalendarWarning({ id: "published@2026", holidays: [] })).toBeNull();
  });

  it("notifies when a list is published for the pinned calendar (SPEC-CONFLICT #130)", () => {
    // A notification, NOT an invariant. An empty pinned calendar is the current unresolved state,
    // not the correct steady one: F-201 AC 10 requires Scenario F's business-day count "against the
    // pinned calendar" and ARCHITECTURE AD-11 requires real business-day math against it, and
    // neither can happen while nothing is published. Publishing the list is one of the resolutions
    // SPEC-CONFLICT #130 records, so this failing means the conflict was resolved.
    //
    // It exists because that change would otherwise be silent. Every other test in this file now
    // states its own calendar, so publication moves four production plan dates and breaks nothing
    // — one visible failure carrying an explanation beats none, and it beats the two bare
    // NOT_CALCULABLE failures the old arrangement would have produced.
    expect(pinnedCalendar(ruleset.calendarId).holidays, PUBLICATION_IS_A_RESOLUTION).toBeNull();
  });

  it("derives today in the jurisdiction's own calendar, not UTC", () => {
    // 2026-08-12T02:30:00Z is still 2026-08-11 in New York. Reading the date off UTC would age the
    // plan a day early and could mark a window missed hours before it closes.
    const lateEvening = new Date("2026-08-12T02:30:00Z");
    expect(todayInJurisdiction("US-NY-NYC", lateEvening)).toBe("2026-08-11");
    expect(todayInJurisdiction("US-NY-NYC", new Date("2026-08-12T14:00:00Z"))).toBe("2026-08-12");
    expect(() => todayInJurisdiction("US-XX-NOWHERE")).toThrow(/no local time zone is mapped/);
  });

  it("moves the rollover with the offset rather than fixing it", () => {
    // The same boundary in January, when New York is UTC-5 rather than UTC-4. An intake
    // date and a plan deadline both read the day from here, so a fixed offset would put
    // one of the two on the wrong side of midnight for part of the year.
    expect(todayInJurisdiction("US-NY-NYC", new Date("2026-01-12T04:30:00Z"))).toBe("2026-01-11");
    expect(todayInJurisdiction("US-NY-NYC", new Date("2026-01-12T05:30:00Z"))).toBe("2026-01-12");
  });

  it("rejects a malformed event id without touching the database", async () => {
    const app = appWith();
    for (const route of ["post", "get"] as const) {
      const response = await request(app)[route]("/api/events/not-a-uuid/plan");
      expect(response.status).toBe(400);
      expect(response.body.error).toBe("event id must be a uuid");
      // No driver text: a 22P02 would otherwise arrive here as a 500 carrying Postgres detail.
      expect(JSON.stringify(response.body)).not.toContain("22P02");
      expect(response.body.detail).toBeUndefined();
    }
  });

  it("keeps a plan conditional and names the finding whose window it cannot date", async () => {
    // Rooftop with alcohol and no venue licence: SLA-ONEDAY-001 is a 15-business-day deadline.
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
      // Amplified and audible from the street on purpose, to keep this test's second half alive.
      // It used to read DOB-ASSEMBLY-001 as the finding that dates normally while the calendar is
      // unpublished; nyc.v2.11 carries that business-day rule, so without a sound permit this intake
      // has NO calendar-dated finding left and the "everything else still dates" guarantee would
      // have silently lost its subject rather than failed. NYPD-SOUND-001 publishes 5 calendar
      // days, needs no holiday list, and is therefore the subject that survives the bump.
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
    // The window is published and real, so the plan says so rather than quietly dropping it.
    expect(degraded.body.verdict).toBe("CONDITIONAL");
    expect(
      degraded.body.verdictDetail.unresolvedTimelines.map(
        (entry: { ruleIds: string[] }) => entry.ruleIds,
      ),
    ).toContainEqual(["SLA-ONEDAY-001"]);
    // DOB-ASSEMBLY-001 is now undatable here too, and that is the carried v2.8 correction rather than a
    // regression. It used to publish 10 CALENDAR days on an exclusive bound and dated to 2026-08-15
    // with no holiday list needed. v2.8 corrects the unit to 10 BUSINESS days on an inclusive bound
    // against TPPN #07/96 and AC Table 28-112.8, so it now needs the same unpublished calendar
    // SLA-ONEDAY-001 does and declines to date for the same reason. Asserted explicitly, both
    // fields, because "no date" is exactly what a broken deadline also looks like: the point is
    // that it is NOT silently dropped and NOT silently dated from weekday-only arithmetic.
    const assembly = degraded.body.findings.find((finding: { ruleIds: string[] }) =>
      finding.ruleIds.includes("DOB-ASSEMBLY-001"),
    );
    expect(assembly.latestApplyDate).toBeNull();
    expect(assembly.deadlineStatus).toBe("not_calculable");
    expect(assembly.notes).toContain("confirm with agency");
    // And the guarantee this half exists for, now carried by a rule the bump did not touch:
    // everything that needs no business-day math still carries its real date. NYPD-SOUND-001
    // publishes "at least 5 days", inclusive, so for an event on 2026-08-26 the last valid filing
    // day is the 21st.
    const sound = degraded.body.findings.find((finding: { ruleIds: string[] }) =>
      finding.ruleIds.includes("NYPD-SOUND-001"),
    );
    expect(sound.latestApplyDate).toBe("2026-08-21");
    expect(sound.deadlineStatus).toBe("on_track");

    // With a published list the same finding dates for real, which is what the fixtures exercise.
    const computed = await request(appWith()).post(`/api/events/${eventId}/plan`);
    const withList = computed.body.findings.find((finding: { ruleIds: string[] }) =>
      finding.ruleIds.includes("SLA-ONEDAY-001"),
    );
    expect(withList.latestApplyDate).toBe("2026-08-05");
    expect(withList.deadlineStatus).toBe("on_track");
  });

  it("reads a Postgres date as its stored calendar day, east of UTC included", async () => {
    // node-postgres builds a `date` at local midnight; toISOString() would move it back a day in
    // any timezone east of UTC and shift every deadline with it.
    const localMidnight = new Date(2026, 7, 26);
    expect(calendarDateFrom(localMidnight)).toBe("2026-08-26");
    expect(calendarDateFrom("2026-08-26")).toBe("2026-08-26");

    const eventId = await insertEvent();
    const generated = await request(appWith()).post(`/api/events/${eventId}/plan`);
    // Scenario A's event date is 2026-08-26 and the SAPO line is a 45-day published minimum.
    expect(generated.body.findings[0].latestApplyDate).toBe("2026-07-12");
    const fetched = await request(appWith()).get(`/api/events/${eventId}/plan`);
    expect(fetched.body.findings[0].latestApplyDate).toBe("2026-07-12");
  });

  it("fails the read rather than serving a plan whose items went missing (AC 5)", async () => {
    const eventId = await insertEvent();
    const app = appWith();
    const generated = await request(app).post(`/api/events/${eventId}/plan`);
    expect(generated.body.findings).toHaveLength(10);

    // Simulate a lost child row. The insert is transactional, so this cannot happen during normal
    // generation, but nothing in the schema enforces the item count afterwards.
    await pool.query(
      `DELETE FROM permit_plan_items WHERE plan_id = $1 AND rule_ids = ARRAY['NYPD-SOUND-001']::text[]`,
      [generated.body.id],
    );

    const fetched = await request(app).get(`/api/events/${eventId}/plan`);
    expect(fetched.status).toBe(500);
    expect(fetched.body.error).toBe("plan lookup failed");
    expect(fetched.body.detail).toContain("is incomplete");
    // The surviving nine findings are not served as if they were the whole plan.
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
      // No URL is published for this permit, so the instructions are the whole filing route.
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

  /**
   * F-201 AC 12: regeneration may not rebuild a plan from a ruleset older than the one the plan it
   * supersedes pinned. The stored plan was shown to an organizer; rebuilding it from superseded
   * rules can drop a requirement they were already told about, and the replacement looks
   * internally consistent, so nothing afterwards says the basis got worse.
   *
   * The service's ruleset is the axis under test, so these build a service on a stated version
   * rather than the one the repository happens to publish. The plan row each generation stores
   * pins whatever version its service ran.
   */
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
    // Diagnosable, not just refused: an operator reading this response learns which two versions
    // are involved and which way round they stand, which is what tells them the service is behind.
    expect(downgrade.body.rulesetVersion).toBe("nyc.v2.10");
    expect(downgrade.body.pinnedRulesetVersion).toBe("nyc.v2.11");
    expect(downgrade.body.standing).toBe("older");
    expect(downgrade.body.error).toContain("nyc.v2.11");
    // The refusal is the whole point: a rolled-back transaction leaves the plan the organizer has.
    expect(await storedPlanVersions(eventId)).toEqual(["nyc.v2.11"]);
  });

  it("regenerates on the same ruleset version, which is the ordinary case", async () => {
    const eventId = await insertEvent();
    const app = appOnRulesetVersion("nyc.v2.11");
    expect((await request(app).post(`/api/events/${eventId}/plan`)).status).toBe(201);

    // An organizer edits their event and regenerates while nothing has been published in between.
    // This is what the button is for, and the guard must not touch it.
    expect((await request(app).post(`/api/events/${eventId}/plan`)).status).toBe(201);
    expect(await storedPlanVersions(eventId)).toEqual(["nyc.v2.11", "nyc.v2.11"]);
  });

  it("regenerates on a newer ruleset version", async () => {
    const eventId = await insertEvent();
    expect(
      (await request(appOnRulesetVersion("nyc.v2.11")).post(`/api/events/${eventId}/plan`)).status,
    ).toBe(201);

    // Minor ordered as a number, not a string: v2.11 is newer than v2.9, and v3.0 newer than both.
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

    // A different jurisdiction and an unparseable version are the same situation: nothing
    // establishes that generating would not move the plan backwards, so it is refused. Fail-closed
    // is only defensible if an operator can tell it apart from a downgrade, so `standing` says so.
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
    // Nothing is stored yet, so the first generation is safe on any label and pins this one.
    expect((await request(app).post(`/api/events/${eventId}/plan`)).status).toBe(201);

    // Two artifacts both labelled `draft` are two unknown artifacts. The label being reused says
    // nothing about their regulatory content, so the pair is still unorderable and is refused.
    const refused = await request(app).post(`/api/events/${eventId}/plan`);

    expect(refused.status).toBe(409);
    expect(refused.body.standing).toBe("different");
    expect(refused.body.rulesetVersion).toBe("draft");
    expect(refused.body.pinnedRulesetVersion).toBe("draft");
    expect(refused.body.error).toContain("cannot be ordered");
    expect(await storedPlanVersions(eventId)).toEqual(["draft"]);
  });

  it("refuses when a newer-pinned plan is stored between the generation's read and its insert", async () => {
    // The race the browser check cannot close (#89 RULES_FILE skew): the generating request starts
    // when no newer plan exists, and another deployment commits one before it inserts.
    //
    // This DOES drive a real interleaving rather than approximating one, and it does so through the
    // guard's own serialization point: the competing transaction takes the events row lock first,
    // inserts its newer-pinned plan, and holds the lock uncommitted while the generation blocks on
    // it. The commit is what releases the generation, so the generation's read of the latest plan
    // provably happens after the competing insert is committed and visible.
    //
    // What it does NOT prove: that some other serialization scheme would refuse. The rendezvous is
    // the lock this implementation takes, so the test is evidence about this guard, not about the
    // ordering of two unsynchronized inserts in general.
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

      // Wait for the generation to be genuinely blocked on a lock before releasing it. Polling is
      // what makes the interleaving deterministic rather than timing-dependent: the commit below
      // happens only once the generation is known to be waiting.
      //
      // Scoped to this database and to the statement the generation blocks at, the way the F-202
      // checklist concurrency test is. Any-ungranted-lock-anywhere would report blocked for an
      // unrelated backend in the cluster, the competing transaction would commit before the
      // generation reached its lock, and the test would pass on the already-committed row without
      // ever exercising the serialization it exists to prove.
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
      // The generation's own row is the one that must not exist.
      expect(await storedPlanVersions(eventId)).toEqual(["nyc.v2.12"]);
    } finally {
      competing.release();
    }
  });

  /**
   * A pool whose generating connection stops between `BEGIN` and the events row lock. Nothing else
   * is intercepted: the generation runs its own real transaction, and the pause only decides when
   * it reaches the lock, which is what lets a transaction that STARTS LATER take the lock, insert
   * and commit first.
   *
   * The patched methods are restored on release because `pg` hands the same client object back out
   * on the next checkout.
   */
  type LooseQuery = (...args: unknown[]) => Promise<unknown>;
  const poolPausedBeforeLock = (onLock: () => void, released: Promise<void>): Pool =>
    ({
      connect: async (): Promise<PoolClient> => {
        const client = await pool.connect();
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
      query: (...args: unknown[]) => (pool.query as unknown as LooseQuery)(...args),
    }) as unknown as Pool;

  it("treats the plan inserted last under the lock as the latest, not the one whose transaction started first", async () => {
    // `generated_at` used to default to `current_timestamp`, which is the TRANSACTION START time,
    // so a generation that began first and inserted last carried the earlier stamp and lost the
    // ordering to a plan it supersedes. AC 12's comparison and `GET` both read that ordering.
    //
    // This drives the real interleaving rather than approximating one, and the rendezvous is not
    // the lock the guard already holds: the generation's own transaction is open and paused BEFORE
    // it takes the lock, the overtaking transaction then begins (later start time), locks, inserts
    // and commits, and only then is the generation released to lock and insert. Both halves are
    // deterministic, the pause because the generation cannot proceed until this test resolves it,
    // and the commit because it completes before the release.
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
      // Begins after the generation's transaction is already open, so the old column default
      // stamps this row LATER, and it still commits FIRST.
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

    // The claim, stated on the column itself: the row inserted second carries the later stamp.
    const { rows: stamps } = await pool.query<{ id: string; generated_at: Date }>(
      "SELECT id, generated_at FROM permit_plans WHERE event_id = $1 ORDER BY generated_at, id",
      [eventId],
    );
    expect(stamps.map((row) => row.id)).toEqual([overtakingId, generated.body.id]);

    // `GET` returns the plan the organizer just generated, not the row that committed first.
    const fetched = await request(app).get(`/api/events/${eventId}/plan`);
    expect(fetched.body.id).toBe(generated.body.id);
    expect(fetched.body.rulesetVersion).toBe("nyc.v2.12");

    // AC 12 reads the same ordering, which is what makes this a downgrade guard defect rather than
    // a display one: the guard must compare against nyc.v2.12, so a service still running
    // nyc.v2.11 is refused. Ordering by transaction start compares against the overtaking row's
    // nyc.v2.11 instead, calls it equal, and generates the downgrade AC 12 exists to refuse.
    const downgrade = await request(appOnRulesetVersion("nyc.v2.11")).post(
      `/api/events/${eventId}/plan`,
    );
    expect(downgrade.status).toBe(409);
    expect(downgrade.body.pinnedRulesetVersion).toBe("nyc.v2.12");
    expect(await storedPlanVersions(eventId)).toEqual(["nyc.v2.11", "nyc.v2.12"]);
  });
});
