import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { Client } from "pg";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { addCalendarDays, differenceInCalendarDays, EvaluationError } from "@pop-engine/engine";
import {
  loadRuleset,
  MAX_PRODUCT_DAYS_BEFORE,
  publishedRulesFile,
  MAX_REPRESENTABLE_DAYS_BEFORE,
  syncPermitRules,
  validateRuleset,
  type PublishedRuleset,
} from "./ruleset";

type JsonObject = Record<string, unknown>;

const rulesFile = publishedRulesFile();
const packageFile = fileURLToPath(new URL("../../../package.json", import.meta.url));
const originalRulesFile = process.env.RULES_FILE;

async function readRawRuleset(): Promise<JsonObject> {
  return JSON.parse(await readFile(rulesFile, "utf8")) as JsonObject;
}

function object(value: unknown): JsonObject {
  return value as JsonObject;
}

function array(value: unknown): unknown[] {
  return value as unknown[];
}

function firstRule(ruleset: JsonObject): JsonObject {
  return object(array(ruleset.rules)[0]);
}

function firstCondition(ruleset: JsonObject): JsonObject {
  return object(array(object(firstRule(ruleset).trigger).all)[0]);
}

function alertOffsets(ruleset: JsonObject): JsonObject {
  return object(object(ruleset.config).alert_offsets);
}

function firstVerification(ruleset: JsonObject): JsonObject {
  return object(firstRule(ruleset).verification);
}

function ruleById(ruleset: JsonObject, id: string): JsonObject {
  const found = [...array(ruleset.rules), ...array(ruleset.advisories)]
    .map(object)
    .find((rule) => rule.id === id);
  if (found === undefined) {
    throw new Error(`fixture expects rule ${id} to exist in the published ruleset`);
  }
  return found;
}

afterEach(() => {
  if (originalRulesFile === undefined) {
    delete process.env.RULES_FILE;
  } else {
    process.env.RULES_FILE = originalRulesFile;
  }
});

describe("ruleset validation", () => {
  it("loads the approved published ruleset", async () => {
    delete process.env.RULES_FILE;
    const ruleset = await loadRuleset();

    expect(ruleset.schema).toBe("popengine-rules/v2");
    expect(ruleset.rulesetVersion).toBe("nyc.v2.10");
    expect(ruleset.snapshotDate).toBe("2026-07-29");
    expect(ruleset.intakeFields).toHaveLength(33);
    expect(ruleset.intakeFields).not.toContain("food_affinity_private_exception_claimed");
    expect(ruleset.intakeFields).not.toContain("venue_has_assembly_approval");
    expect(ruleset.intakeFields).toEqual(
      expect.arrayContaining([
        "venue_paco_covers_exact_event",
        "venue_fdny_pa_permit_current_for_event_space",
      ]),
    );
    expect(ruleset.rules).toHaveLength(42);
    expect(ruleset.advisories).toHaveLength(4);
  });

  it("pins which published rules are exempt from agency and source", async () => {
    // The exemptions are deliberate, so they are named here rather than merely
    // permitted. A future rule that quietly joins either list has to change this test.
    delete process.env.RULES_FILE;
    const { rules, advisories } = await loadRuleset();
    const all = [...rules, ...advisories];

    // Issue #77: advisory / note / classification describe a condition rather than a
    // filing, so they may omit the agency. Everything else must name one.
    expect(all.filter((rule) => rule.output.agency === undefined).map((rule) => rule.id)).toEqual([
      "SAPO-SCOPE-001",
      "PARKS-INSURANCE-NOTE-001",
      "DOHMH-EXEMPTION-001",
      "SLA-VENUE-LICENSE-001",
      "CONF-NO-FOOD-001",
      "CONF-NO-SALES-001",
      "CONF-NO-AMPLIFIED-SOUND-001",
      "CONF-NO-STRUCTURE-001",
      "CONF-NO-FLAME-001",
      "CONF-NO-GENERATOR-001",
      "CONF-NO-BATTERY-001",
      "CONF-NO-ALCOHOL-001",
      "CONF-NO-BLOCK-PARTY-RIDE-001",
      "ADV-ALCOHOL-PUBLIC-001",
      "ADV-SAPO-OTHER-CLASS-001",
      "ADV-NOISE-CODE-001",
      "ADV-VENUE-OCCUPANCY-001",
    ]);

    // Issue #75: only a COVERAGE_GAP advisory, which asserts nothing, may omit its source.
    expect(all.filter((rule) => rule.source === null).map((rule) => rule.id)).toEqual([
      "ADV-ALCOHOL-PUBLIC-001",
      "ADV-SAPO-OTHER-CLASS-001",
    ]);
  });

  it("honors RULES_FILE", async () => {
    process.env.RULES_FILE = rulesFile;
    await expect(loadRuleset()).resolves.toMatchObject({
      rulesetVersion: "nyc.v2.10",
    });
  });

  it("reports unreadable and structurally invalid files as boot failures", async () => {
    await expect(loadRuleset("/missing/rules.json")).rejects.toThrow(
      "Ruleset validation failed: cannot load",
    );
    await expect(loadRuleset(packageFile)).rejects.toThrow(
      "Ruleset validation failed: ruleset.schema",
    );
  });

  it("rejects non-object input", () => {
    expect(() => validateRuleset(null)).toThrow("ruleset must be an object");
  });

  it.each<{
    name: string;
    mutate: (ruleset: JsonObject) => void;
    error: RegExp;
  }>([
    {
      name: "wrong schema",
      mutate: (ruleset) => {
        ruleset.schema = "popengine-rules/v1";
      },
      error: /expected schema/,
    },
    {
      name: "wrong version",
      mutate: (ruleset) => {
        ruleset.ruleset_version = "nyc.v3";
      },
      error: /expected ruleset version/,
    },
    {
      name: "invalid snapshot date",
      mutate: (ruleset) => {
        ruleset.snapshot_date = "2026-02-31";
      },
      error: /snapshot_date must be an ISO date/,
    },
    {
      name: "year-zero snapshot date",
      mutate: (ruleset) => {
        ruleset.snapshot_date = "0000-01-01";
      },
      error: /snapshot_date has no year 0000/,
    },
    // F-203 states these offsets are config rather than code, so the artifact is the contract and
    // an unusable value has to be a boot failure. Left to runtime it is an api that starts clean
    // and then schedules nothing, or fires after the deadline it warns about, one organizer at a
    // time — the same deferred-failure shape as an unvalidated `last_verified_date`.
    {
      name: "alert offsets missing entirely",
      mutate: (ruleset) => {
        delete object(ruleset.config).alert_offsets;
      },
      error: /alert_offsets must be an object/,
    },
    {
      name: "alert offsets carrying no deadline_reminder",
      mutate: (ruleset) => {
        object(ruleset.config).alert_offsets = { note: "only metadata" };
      },
      error: /alert_offsets\.deadline_reminder is required/,
    },
    {
      // The closed half is about the NAMED entry, not about the map being nonempty: an artifact
      // configuring some other type still leaves F-203 with nothing to read at the path it uses.
      name: "alert offsets carrying a different type instead",
      mutate: (ruleset) => {
        object(ruleset.config).alert_offsets = {
          slack_warning: { days_before: [3] },
          note: "no deadline_reminder",
        };
      },
      error: /alert_offsets\.deadline_reminder is required/,
    },
    {
      name: "an alert type with no days_before",
      mutate: (ruleset) => {
        alertOffsets(ruleset).deadline_reminder = {};
      },
      error: /days_before must be an array/,
    },
    {
      name: "an empty days_before",
      mutate: (ruleset) => {
        alertOffsets(ruleset).deadline_reminder = { days_before: [] };
      },
      error: /days_before must not be empty/,
    },
    {
      name: "a string offset",
      mutate: (ruleset) => {
        alertOffsets(ruleset).deadline_reminder = { days_before: [7, "1"] };
      },
      error: /days_before\[1\] must be a positive whole number of days, received 1/,
    },
    {
      name: "a negative offset, which would fire after the deadline",
      mutate: (ruleset) => {
        alertOffsets(ruleset).deadline_reminder = { days_before: [7, -1] };
      },
      error: /days_before\[1\] must be a positive whole number of days, received -1/,
    },
    {
      name: "a zero offset, which is the deadline rather than a warning",
      mutate: (ruleset) => {
        alertOffsets(ruleset).deadline_reminder = { days_before: [7, 0] };
      },
      error: /days_before\[1\] must be a positive whole number of days, received 0/,
    },
    {
      name: "a fractional offset, which lands mid-day",
      mutate: (ruleset) => {
        alertOffsets(ruleset).deadline_reminder = { days_before: [7, 1.5] };
      },
      error: /days_before\[1\] must be a positive whole number of days, received 1.5/,
    },
    {
      // The reported case on #122: Number.isInteger(1e20) is true, so this passed boot and the
      // failure waited for the first reminder F-203 tried to schedule.
      name: "an offset the date arithmetic cannot represent (#122)",
      mutate: (ruleset) => {
        alertOffsets(ruleset).deadline_reminder = { days_before: [7, 1e20] };
      },
      // 1e20 interpolates as its full decimal expansion, not "1e+20", and the message names it
      // either way — the point of naming the value is that nobody has to hunt for it by hand.
      error:
        /days_before\[1\] is 100000000000000000000, beyond the 719528 days the calendar arithmetic can subtract/,
    },
    {
      // The first value past the MEASURED representable boundary, so the constant is pinned at its
      // edge rather than somewhere inside a range that happens to work.
      name: "the first offset past the representable boundary",
      mutate: (ruleset) => {
        alertOffsets(ruleset).deadline_reminder = { days_before: [719_529] };
      },
      error:
        /days_before\[0\] is 719529, beyond the 719528 days the calendar arithmetic can subtract/,
    },
    {
      // Representable but absurd: rejected by the product bound, and the message has to say so,
      // because "the arithmetic cannot hold it" would be false here and would send someone to the
      // wrong constant.
      name: "the first offset past the product bound",
      mutate: (ruleset) => {
        alertOffsets(ruleset).deadline_reminder = { days_before: [3_651] };
      },
      error: /days_before\[0\] is 3651, beyond the 3650-day maximum reminder offset/,
    },
    {
      name: "a representable offset that is still nonsense for a reminder",
      mutate: (ruleset) => {
        alertOffsets(ruleset).deadline_reminder = { days_before: [100_000] };
      },
      error: /days_before\[0\] is 100000, beyond the 3650-day maximum reminder offset/,
    },
    {
      name: "a duplicated offset, which would send twice",
      mutate: (ruleset) => {
        alertOffsets(ruleset).deadline_reminder = { days_before: [7, 1, 7] };
      },
      error: /repeats 7, which would send the same reminder twice/,
    },
    {
      name: "a later alert type whose days_before is unusable",
      mutate: (ruleset) => {
        // Unknown keys are alert types by design. The open half still checks the ONE shape this
        // file understands, so a future entry using `days_before` is held to the same rules.
        alertOffsets(ruleset).slack_warning = { days_before: ["soon"] };
      },
      error: /slack_warning\.days_before\[0\] must be a positive whole number/,
    },
    {
      name: "unapproved status",
      mutate: (ruleset) => {
        ruleset.status = "PROPOSED";
      },
      error: /status must be APPROVED/,
    },
    // Every one of these reaches `permit_plan_items.last_verified_date`, a `date` column, so a
    // validator that accepts them defers the failure to plan generation: the api boots clean and
    // then every affected write fails, per organizer. Impossible days are the ones a shape check
    // alone lets through, which is why the calendar round trip is the assertion.
    {
      name: "impossible verification date",
      mutate: (ruleset) => {
        firstVerification(ruleset).last_verified_date = "2026-13-45";
      },
      error: /last_verified_date must be an ISO date/,
    },
    {
      name: "non-date verification date",
      mutate: (ruleset) => {
        firstVerification(ruleset).last_verified_date = "soon";
      },
      error: /last_verified_date must be an ISO date/,
    },
    {
      name: "verification date that rolls forward",
      mutate: (ruleset) => {
        firstVerification(ruleset).last_verified_date = "2026-02-31";
      },
      error: /last_verified_date must be an ISO date/,
    },
    {
      name: "unpadded verification date",
      mutate: (ruleset) => {
        // Postgres would accept this and normalize it, so the generated response and the row read
        // back afterwards would disagree about the same date.
        firstVerification(ruleset).last_verified_date = "2026-7-18";
      },
      error: /last_verified_date must be an ISO date/,
    },
    {
      // The one value the shape check and the calendar round trip both accept and Postgres does
      // not: ISO 8601 has a year zero and ECMAScript implements it, so this passes every check the
      // validator made before this case existed and then fails at the INSERT — the deferred failure
      // the validator exists to stop, surviving inside the validator.
      name: "year-zero verification date",
      mutate: (ruleset) => {
        firstVerification(ruleset).last_verified_date = "0000-01-01";
      },
      error: /last_verified_date has no year 0000/,
    },
    {
      // Year zero is refused for being year zero, not for being an odd day: February 29 of year 0
      // is a real proleptic-Gregorian date that Postgres still has no year for.
      name: "year-zero leap day",
      mutate: (ruleset) => {
        firstVerification(ruleset).last_verified_date = "0000-02-29";
      },
      error: /last_verified_date has no year 0000/,
    },
    {
      name: "empty verification date",
      mutate: (ruleset) => {
        firstVerification(ruleset).last_verified_date = "";
      },
      error: /last_verified_date must be a non-empty string/,
    },
    {
      name: "duplicate intake field",
      mutate: (ruleset) => {
        const fields = array(ruleset.intake_fields);
        fields.push(structuredClone(fields[0]));
      },
      error: /intake field names must be unique/,
    },
    {
      name: "wrong rule count",
      mutate: (ruleset) => {
        array(ruleset.rules).pop();
      },
      error: /expected 42 rules/,
    },
    {
      name: "wrong advisory count",
      mutate: (ruleset) => {
        array(ruleset.advisories).pop();
      },
      error: /expected 4 advisories/,
    },
    {
      name: "unsupported kind",
      mutate: (ruleset) => {
        firstRule(ruleset).kind = "future_kind";
      },
      error: /kind has unsupported value/,
    },
    {
      name: "undeclared trigger field",
      mutate: (ruleset) => {
        firstCondition(ruleset).field = "undeclared";
      },
      error: /references undeclared field/,
    },
    {
      name: "unsupported condition operator",
      mutate: (ruleset) => {
        firstCondition(ruleset).op = "execute";
      },
      error: /op has unsupported value/,
    },
    {
      name: "mixed trigger node",
      mutate: (ruleset) => {
        firstRule(ruleset).trigger = {
          field: "borough",
          op: "eq",
          value: "brooklyn",
          all: [{ field: "undeclared", op: "eq", value: true }],
        };
      },
      error: /exactly one of all, any, or field/,
    },
    {
      name: "condition without a value",
      mutate: (ruleset) => {
        delete firstCondition(ruleset).value;
      },
      error: /\.value is required/,
    },
    {
      name: "empty trigger combinator",
      mutate: (ruleset) => {
        firstRule(ruleset).trigger = { all: [] };
      },
      error: /all must not be empty/,
    },
    {
      name: "duplicate rule id",
      mutate: (ruleset) => {
        const rules = array(ruleset.rules);
        object(rules[1]).id = object(rules[0]).id;
      },
      error: /duplicate rule id/,
    },
    {
      name: "missing rule source",
      mutate: (ruleset) => {
        delete firstRule(ruleset).source;
      },
      error: /source is required/,
    },
    {
      name: "source without a citation",
      mutate: (ruleset) => {
        firstRule(ruleset).source = {};
      },
      error: /source.citation must be a non-empty string/,
    },
    {
      name: "source without URLs",
      mutate: (ruleset) => {
        firstRule(ruleset).source = { citation: "Source", urls: [] };
      },
      error: /source.urls must not be empty/,
    },
    {
      name: "source with an invalid URL entry",
      mutate: (ruleset) => {
        firstRule(ruleset).source = { citation: "Source", urls: [null] };
      },
      error: /source.urls\[0\] must be a non-empty string/,
    },
    {
      name: "unsupported verification status",
      mutate: (ruleset) => {
        object(firstRule(ruleset).verification).status = "UNREVIEWED";
      },
      error: /verification.status has unsupported value/,
    },
    {
      // Issue #77: a finding that directs the organizer to act with a body must name it.
      name: "an agency-required kind with no agency",
      mutate: (ruleset) => {
        delete object(ruleById(ruleset, "PARKS-PROPANE-001").output).agency;
      },
      error: /output.agency must be a non-empty string/,
    },
    {
      // Issue #75: only a COVERAGE_GAP advisory, which asserts nothing, may omit its source.
      name: "a non-COVERAGE_GAP advisory with no source",
      mutate: (ruleset) => {
        delete ruleById(ruleset, "ADV-NOISE-CODE-001").source;
      },
      error: /source is required unless verification.status is COVERAGE_GAP/,
    },
  ])("rejects $name", async ({ mutate, error }) => {
    const ruleset = await readRawRuleset();
    mutate(ruleset);
    expect(() => validateRuleset(ruleset)).toThrow(error);
  });

  it("bounds the offset where the calendar arithmetic actually stops working", async () => {
    // The #114 precedent: measure the divergence rather than patch the reported value, and pin the
    // measurement so it fails if calendar.ts changes underneath this file. Every assertion below runs
    // the real `addCalendarDays`.
    //
    // What the measurement found is not what #122 assumed. A RangeError is only the OUTER boundary,
    // at ±100,000,000 days from the Unix epoch. Well inside it, `addCalendarDays` leaves the range
    // `toISOString` can format as a plain date, because `toISOString().slice(0, 10)` cuts
    // `-000001-12-31T…` down to `"-000001-12"`. That used to be RETURNED, with no error; it now
    // throws, because `fromEpochDay` tests its own output against ISO_DATE (#126). So the usable
    // boundary is where the RESULT leaves years 0000–9999, and it is date-dependent:
    // `epochDay(deadline) − epochDay(0000-01-01)`. MAX_REPRESENTABLE_DAYS_BEFORE is that value at the
    // Unix epoch, where it is smallest, and therefore safe for every later deadline.
    const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
    const EPOCH = "1970-01-01";

    // The bound itself still returns a real date from the tightest possible deadline...
    const atBound = addCalendarDays(EPOCH, -MAX_REPRESENTABLE_DAYS_BEFORE);
    expect(atBound, "the bound is reachable from the earliest deadline the product can hold").toBe(
      "0000-01-01",
    );
    expect(ISO_DATE.test(atBound)).toBe(true);

    // ...and one day further throws instead of returning `"-000001-12"` silently. The guard lives in
    // `fromEpochDay`, so this validator's bound and the arithmetic it protects now agree: the last
    // offset the validator admits is the last one that yields a date.
    const pastBound = (): string => addCalendarDays(EPOCH, -(MAX_REPRESENTABLE_DAYS_BEFORE + 1));
    expect(pastBound).toThrow(EvaluationError);
    expect(pastBound).toThrow(/epoch day -719529 is outside the representable calendar range/);

    // The outer RangeError boundary is a DIFFERENT boundary and still distinguishable by type: the
    // guard reports leaving years 0000–9999, while past ±8.64e15 ms `toISOString` throws RangeError
    // before the guard can run. -100,000,000 no longer returns `"-271821-04"`; it is inside the band
    // the guard now covers, which is why this assertion moved from `.not.toThrow()`.
    expect(() => addCalendarDays(EPOCH, -100_000_000)).toThrow(EvaluationError);
    expect(() => addCalendarDays(EPOCH, -100_000_001)).toThrow(RangeError);
    expect(() => addCalendarDays(EPOCH, -100_000_001)).not.toThrow(EvaluationError);

    // Every offset the validator admits stays well inside the usable range, from a real deadline.
    for (const deadline of ["1970-01-01", "2026-08-26", "2026-12-04"]) {
      const scheduled = addCalendarDays(deadline, -MAX_PRODUCT_DAYS_BEFORE);
      expect(ISO_DATE.test(scheduled), `${deadline} - ${MAX_PRODUCT_DAYS_BEFORE}`).toBe(true);
      expect(differenceInCalendarDays(scheduled, deadline)).toBe(MAX_PRODUCT_DAYS_BEFORE);
    }

    // And the product bound is the tighter of the two, which is what makes it the effective one.
    expect(MAX_PRODUCT_DAYS_BEFORE).toBeLessThan(MAX_REPRESENTABLE_DAYS_BEFORE);
  });

  it("accepts a later alert kind that schedules by something other than days_before", async () => {
    // The open half, asserted rather than described. The published note says each alert type owns an
    // object precisely so a kind scheduling by an absolute date or an hour offset can add its own
    // field, so requiring `days_before` of every entry rejected exactly the extension the artifact
    // invites — which is what F-305 and F-413 are named in that note to do.
    for (const futureEntry of [
      { at_time: "09:00", timezone: "America/New_York" },
      { hours_before: [48, 6] },
      { absolute_date: "2026-08-01" },
      // No recognised field at all: accepted rather than guessed at, since there is no field name to
      // require without predicting the mechanism.
      { pending_design: true },
    ]) {
      const ruleset = await readRawRuleset();
      alertOffsets(ruleset).f305_digest = futureEntry;
      expect(() => validateRuleset(ruleset), JSON.stringify(futureEntry)).not.toThrow();
    }
  });

  it("still requires deadline_reminder when a later kind is present", async () => {
    // The two halves at once: an artifact may add any kind it likes and still may not drop the one
    // F-203 reads. This is the case that fails if either half is collapsed into the other.
    const ruleset = await readRawRuleset();
    const offsets = alertOffsets(ruleset);
    offsets.f305_digest = { at_time: "09:00" };
    delete offsets.deadline_reminder;
    expect(() => validateRuleset(ruleset)).toThrow(/deadline_reminder is required/);
  });

  it("accepts the years either side of the one Postgres has no room for", async () => {
    // The boundary in the other direction, so the year-zero rejection cannot widen unnoticed.
    // Postgres stores 0001-01-01 and 9999-12-31 without complaint, so refusing either would reject
    // an artifact the column can hold — a validator that over-rejects fails a boot that should work.
    for (const date of ["0001-01-01", "0001-12-31", "9999-12-31"]) {
      const ruleset = await readRawRuleset();
      firstVerification(ruleset).last_verified_date = date;
      expect(() => validateRuleset(ruleset), date).not.toThrow();
    }
  });
});

const databaseUrl = process.env.DATABASE_URL ?? "";

describe.runIf(databaseUrl.length > 0)("migration 001 and rules sync", () => {
  let database: Client;
  let ruleset: PublishedRuleset;

  beforeAll(async () => {
    database = new Client({ connectionString: databaseUrl });
    await database.connect();
    ruleset = await loadRuleset(rulesFile);
  });

  afterAll(async () => {
    await database.end();
  });

  it("creates every approved table and mirrors the intake registry", async () => {
    const tables = await database.query<{ table_name: string }>(
      `SELECT table_name
       FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name <> 'pgmigrations'
       ORDER BY table_name`,
    );
    expect(tables.rows.map(({ table_name }) => table_name)).toEqual(
      [
        "alerts",
        "checkins",
        "checklist_acknowledgements",
        "checklist_items",
        "documents",
        // F-203: where an event's alerts go, which is an event-scoped mutable fact and not the
        // per-message record `alerts.recipient` holds (migration 009).
        "event_alert_contacts",
        "events",
        "permit_plan_items",
        "permit_plans",
        "permit_rules",
        "rsvps",
      ].sort(),
    );

    const eventColumns = await database.query<{ column_name: string }>(
      `SELECT column_name
       FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'events'
       ORDER BY column_name`,
    );
    expect(eventColumns.rows.map(({ column_name }) => column_name)).toEqual(
      [
        ...ruleset.intakeFields,
        "id",
        "name",
        "location_name",
        "capacity",
        "status",
        "revision_counter",
        "created_at",
        "updated_at",
        // F-110 migration 012 retains the coarse answer as deprecated history. It is deliberately
        // absent from the active registry and never used to infer either replacement value.
        "venue_has_assembly_approval",
        // #194 keeps the removed organizer claim only for historical rows and replay.
        "food_affinity_private_exception_claimed",
        // F-301 promotion fields (migration 005 / SPEC-CONFLICT #100) — not intake.
        "description",
        "public_page_published",
      ].sort(),
    );
  });

  it("enforces event enums and lifecycle defaults", async () => {
    const values = [
      randomUUID(),
      "Schema test",
      "brooklyn",
      "private_venue",
      60,
      "2026-08-12",
      "yes",
      false,
      false,
      false,
      ["none"],
      ["none"],
      false,
      false,
    ];
    const insert = `INSERT INTO events
      (id, name, borough, location_type, headcount, event_date,
       event_open_to_public, food_present, selling_anything, amplified_sound,
       structure_types, open_flame_or_cooking, generator_present, alcohol)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
      RETURNING status, revision_counter, capacity`;

    const inserted = await database.query<{
      status: string;
      revision_counter: number;
      capacity: number | null;
    }>(insert, values);
    expect(inserted.rows[0]).toEqual({
      status: "draft",
      revision_counter: 1,
      capacity: null,
    });

    await expect(
      database.query(insert, [
        randomUUID(),
        ...values.slice(1, 3),
        "invalid_location",
        ...values.slice(4),
      ]),
    ).rejects.toThrow(/check constraint/);

    const invalidMultiSelects: Array<[string[], string[]]> = [
      [[], ["none"]],
      [["none", "tent_canopy"], ["none"]],
      [["none"], []],
      [["none"], ["none", "charcoal_wood"]],
    ];
    for (const [structureTypes, flameTypes] of invalidMultiSelects) {
      const invalidValues = [...values];
      invalidValues[0] = randomUUID();
      invalidValues[10] = structureTypes;
      invalidValues[11] = flameTypes;
      await expect(database.query(insert, invalidValues)).rejects.toThrow(/check constraint/);
    }
  });

  it("supports cancelled alerts, unique sends, and walk-in check-ins", async () => {
    const eventId = randomUUID();
    await database.query(
      `INSERT INTO events
        (id, name, borough, location_type, headcount, event_date,
         event_open_to_public, food_present, selling_anything, amplified_sound,
         structure_types, open_flame_or_cooking, generator_present, alcohol)
       VALUES ($1, 'Ops test', 'queens', 'street', 200, '2026-09-30',
               'yes', false, false, true, ARRAY['none'], ARRAY['none'], false, false)`,
      [eventId],
    );

    const idempotencyKey = `${eventId}:deadline`;
    await database.query(
      `INSERT INTO alerts
        (id, event_id, alert_type, channel, recipient, idempotency_key, send_at, status, payload)
       VALUES ($1, $2, 'deadline_reminder', 'email', 'demo@example.com', $3,
               current_timestamp, 'cancelled', '{}'::jsonb)`,
      [randomUUID(), eventId, idempotencyKey],
    );
    await expect(
      database.query(
        `INSERT INTO alerts
          (id, event_id, alert_type, channel, recipient, idempotency_key, send_at, payload)
         VALUES ($1, $2, 'deadline_reminder', 'email', 'demo@example.com', $3,
                 current_timestamp, '{}'::jsonb)`,
        [randomUUID(), eventId, idempotencyKey],
      ),
    ).rejects.toThrow(/unique constraint/);

    const walkIn = await database.query<{ rsvp_id: string | null }>(
      `INSERT INTO checkins (id, event_id, name, contact)
       VALUES ($1, $2, 'Walk In', 'walkin@example.com')
       RETURNING rsvp_id`,
      [randomUUID(), eventId],
    );
    expect(walkIn.rows[0]?.rsvp_id).toBeNull();
  });

  it("stores plan provenance and rejects duplicate checklist and attendee identities", async () => {
    const eventId = randomUUID();
    await database.query(
      `INSERT INTO events
        (id, name, borough, location_type, headcount, event_date,
         event_open_to_public, food_present, selling_anything, amplified_sound,
         structure_types, open_flame_or_cooking, generator_present, alcohol)
       VALUES ($1, 'Constraint test', 'manhattan', 'private_venue', 100, '2026-10-01',
               'yes', false, false, false, ARRAY['none'], ARRAY['none'], false, false)`,
      [eventId],
    );

    const planId = randomUUID();
    await database.query(
      `INSERT INTO permit_plans
        (id, event_id, event_revision, ruleset_version, verdict, verdict_detail, intake_snapshot)
       VALUES ($1, $2, 1, $3, 'feasible', '{}'::jsonb, '{}'::jsonb)`,
      [planId, eventId, ruleset.rulesetVersion],
    );

    const contributingRules = ruleset.rules.filter(({ id }) =>
      ["DOB-TENT-001", "DOB-TALL-STRUCTURE-001"].includes(id),
    );
    expect(contributingRules).toHaveLength(2);
    const ruleIds = contributingRules.map(({ id }) => id);
    const triggeredBy = [
      { field: "structure_types", value: ["tent_canopy"] },
      { field: "structure_over_10ft_tall", value: "yes" },
    ];
    const sources = contributingRules.map(({ id, source }) => ({ rule_id: id, source }));
    const planItemId = randomUUID();
    const planItem = await database.query<{
      rule_ids: string[];
      sources: JsonObject[];
      triggered_by: JsonObject[];
    }>(
      `INSERT INTO permit_plan_items
        (id, plan_id, rule_ids, triggered_by, sources, kind, disposition,
         deadline_status, verification_status)
       VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, 'permit', 'may_be_required',
               'not_applicable', 'SOURCE_CONFIRMED')
       RETURNING rule_ids, triggered_by, sources`,
      [planItemId, planId, ruleIds, JSON.stringify(triggeredBy), JSON.stringify(sources)],
    );
    expect(planItem.rows[0]).toEqual({
      rule_ids: ruleIds,
      triggered_by: triggeredBy,
      sources,
    });

    const checklistItemId = randomUUID();
    await database.query(
      `INSERT INTO checklist_items (id, plan_item_id)
       VALUES ($1, $2)`,
      [checklistItemId, planItemId],
    );
    const checklistEvent = await database.query<{ event_id: string }>(
      `SELECT plans.event_id
       FROM checklist_items AS checklist
       JOIN permit_plan_items AS items ON items.id = checklist.plan_item_id
       JOIN permit_plans AS plans ON plans.id = items.plan_id
       WHERE checklist.id = $1`,
      [checklistItemId],
    );
    expect(checklistEvent.rows[0]?.event_id).toBe(eventId);

    await expect(
      database.query(
        `INSERT INTO checklist_items (id, plan_item_id)
         VALUES ($1, $2)`,
        [randomUUID(), planItemId],
      ),
    ).rejects.toThrow(/unique constraint/);

    const otherEventId = randomUUID();
    await database.query(
      `INSERT INTO events
        (id, name, borough, location_type, headcount, event_date,
         event_open_to_public, food_present, selling_anything, amplified_sound,
         structure_types, open_flame_or_cooking, generator_present, alcohol)
       VALUES ($1, 'Other event', 'brooklyn', 'private_venue', 50, '2026-10-02',
               'yes', false, false, false, ARRAY['none'], ARRAY['none'], false, false)`,
      [otherEventId],
    );

    // `cancelled`, like the row above, so it is never DUE. This suite and the F-203 poller suite
    // share one database and vitest runs their files in parallel: a row left `pending` with
    // `send_at = current_timestamp` is a real due alert, and a tick running in the other worker
    // will claim and deliver it. What is under test here is the trigger, which does not care
    // about status.
    await database.query(
      `INSERT INTO alerts
        (id, event_id, checklist_item_id, alert_type, channel, recipient,
         idempotency_key, send_at, status, payload)
       VALUES ($1, $2, $3, 'deadline_reminder', 'email', 'demo@example.com',
               $4, current_timestamp, 'cancelled', '{}'::jsonb)`,
      [randomUUID(), eventId, checklistItemId, `${eventId}:checklist`],
    );
    await expect(
      database.query(
        `INSERT INTO alerts
          (id, event_id, checklist_item_id, alert_type, channel, recipient,
           idempotency_key, send_at, status, payload)
         VALUES ($1, $2, $3, 'deadline_reminder', 'email', 'demo@example.com',
                 $4, current_timestamp, 'cancelled', '{}'::jsonb)`,
        [randomUUID(), otherEventId, checklistItemId, `${otherEventId}:wrong-checklist`],
      ),
    ).rejects.toThrow(/alert checklist item must belong to event/);

    const email = "guest@example.com";
    const rsvpId = randomUUID();
    await database.query(
      `INSERT INTO rsvps (id, event_id, name, email)
       VALUES ($1, $2, 'Guest', $3)`,
      [rsvpId, eventId, email],
    );
    await expect(
      database.query(
        `INSERT INTO rsvps (id, event_id, name, email)
         VALUES ($1, $2, 'Duplicate Guest', $3)`,
        [randomUUID(), eventId, email],
      ),
    ).rejects.toThrow(/unique constraint/);

    await database.query(
      `INSERT INTO checkins (id, event_id, rsvp_id, name, contact)
       VALUES ($1, $2, $3, 'Guest', $4)`,
      [randomUUID(), eventId, rsvpId, email],
    );
    await expect(
      database.query(
        `INSERT INTO checkins (id, event_id, rsvp_id, name, contact)
         VALUES ($1, $2, $3, 'Wrong Event Guest', 'wrong-event@example.com')`,
        [randomUUID(), otherEventId, rsvpId],
      ),
    ).rejects.toThrow(/foreign key constraint/);

    const contact = "walkin@example.com";
    await database.query(
      `INSERT INTO checkins (id, event_id, name, contact)
       VALUES ($1, $2, 'Walk In', $3)`,
      [randomUUID(), eventId, contact],
    );
    await expect(
      database.query(
        `INSERT INTO checkins (id, event_id, name, contact)
         VALUES ($1, $2, 'Duplicate Walk In', $3)`,
        [randomUUID(), eventId, contact],
      ),
    ).rejects.toThrow(/unique constraint/);
  });

  it("refuses an acknowledgement naming another event's plan", async () => {
    const [ownEventId, otherEventId] = [randomUUID(), randomUUID()];
    for (const id of [ownEventId, otherEventId]) {
      await database.query(
        `INSERT INTO events
          (id, name, borough, location_type, headcount, event_date,
           event_open_to_public, food_present, selling_anything, amplified_sound,
           structure_types, open_flame_or_cooking, generator_present, alcohol)
         VALUES ($1, 'Acknowledgement test', 'manhattan', 'private_venue', 50, '2026-10-01',
                 'yes', false, false, false, ARRAY['none'], ARRAY['none'], false, false)`,
        [id],
      );
    }

    const otherPlanId = randomUUID();
    await database.query(
      `INSERT INTO permit_plans
        (id, event_id, event_revision, ruleset_version, verdict, verdict_detail, intake_snapshot)
       VALUES ($1, $2, 1, $3, 'feasible', '{}'::jsonb, '{}'::jsonb)`,
      [otherPlanId, otherEventId, ruleset.rulesetVersion],
    );

    // Both foreign keys are individually satisfiable — the event exists and the plan exists —
    // so only the pairwise constraint can reject this. Without it the row lands and F-202
    // answers "has your plan changed" against a plan this organizer never saw.
    await expect(
      database.query(`INSERT INTO checklist_acknowledgements (event_id, plan_id) VALUES ($1, $2)`, [
        ownEventId,
        otherPlanId,
      ]),
    ).rejects.toThrow(/foreign key constraint/);

    const ownPlanId = randomUUID();
    await database.query(
      `INSERT INTO permit_plans
        (id, event_id, event_revision, ruleset_version, verdict, verdict_detail, intake_snapshot)
       VALUES ($1, $2, 1, $3, 'feasible', '{}'::jsonb, '{}'::jsonb)`,
      [ownPlanId, ownEventId, ruleset.rulesetVersion],
    );
    await database.query(
      `INSERT INTO checklist_acknowledgements (event_id, plan_id) VALUES ($1, $2)`,
      [ownEventId, ownPlanId],
    );

    // One row per event: re-acknowledging a later plan replaces the earlier answer rather than
    // accumulating rows a "latest acknowledgement" read would have to disambiguate.
    const laterPlanId = randomUUID();
    await database.query(
      `INSERT INTO permit_plans
        (id, event_id, event_revision, ruleset_version, verdict, verdict_detail, intake_snapshot)
       VALUES ($1, $2, 2, $3, 'feasible', '{}'::jsonb, '{}'::jsonb)`,
      [laterPlanId, ownEventId, ruleset.rulesetVersion],
    );
    // acknowledged_at must be reapplied explicitly: Postgres does not re-evaluate a column
    // default on conflict, so an upsert that sets only plan_id keeps reporting the time of the
    // first review forever. Asserting the row count and plan_id alone would not notice.
    const { rows: before } = await database.query<{ acknowledged_at: Date }>(
      `SELECT acknowledged_at FROM checklist_acknowledgements WHERE event_id = $1`,
      [ownEventId],
    );
    await database.query(
      `INSERT INTO checklist_acknowledgements (event_id, plan_id) VALUES ($1, $2)
       ON CONFLICT (event_id)
         DO UPDATE SET plan_id = EXCLUDED.plan_id, acknowledged_at = current_timestamp`,
      [ownEventId, laterPlanId],
    );
    const acknowledged = await database.query<{ plan_id: string; acknowledged_at: Date }>(
      `SELECT plan_id, acknowledged_at FROM checklist_acknowledgements WHERE event_id = $1`,
      [ownEventId],
    );
    expect(acknowledged.rows).toHaveLength(1);
    expect(acknowledged.rows[0]?.plan_id).toBe(laterPlanId);
    expect(acknowledged.rows[0]?.acknowledged_at.getTime()).toBeGreaterThan(
      (before[0]?.acknowledged_at ?? new Date(0)).getTime(),
    );
  });

  it("syncs all 46 rules and repairs same-version drift", async () => {
    await syncPermitRules(database, ruleset);

    const count = await database.query<{ count: string }>(
      "SELECT count(*) FROM permit_rules WHERE ruleset_version = $1",
      [ruleset.rulesetVersion],
    );
    expect(Number(count.rows[0]?.count)).toBe(46);

    await database.query(
      `UPDATE permit_rules
       SET kind = 'note'
       WHERE ruleset_version = $1 AND rule_id = 'SAPO-STREET-LARGE-001'`,
      [ruleset.rulesetVersion],
    );
    await syncPermitRules(database, ruleset);

    const repaired = await database.query<{
      kind: string;
      verification_status: string;
    }>(
      `SELECT kind, verification->>'status' AS verification_status
       FROM permit_rules
       WHERE ruleset_version = $1 AND rule_id = 'SAPO-STREET-LARGE-001'`,
      [ruleset.rulesetVersion],
    );
    expect(repaired.rows[0]).toEqual({
      kind: "permit",
      verification_status: "SOURCE_CONFIRMED",
    });
  });

  it("serializes concurrent same-version rules syncs", async () => {
    await syncPermitRules(database, ruleset);
    const concurrentDatabase = new Client({ connectionString: databaseUrl });
    await concurrentDatabase.connect();
    try {
      await Promise.all([
        syncPermitRules(database, ruleset),
        syncPermitRules(concurrentDatabase, ruleset),
      ]);
    } finally {
      await concurrentDatabase.end();
    }

    const count = await database.query<{ count: string }>(
      "SELECT count(*) FROM permit_rules WHERE ruleset_version = $1",
      [ruleset.rulesetVersion],
    );
    expect(Number(count.rows[0]?.count)).toBe(46);
  });

  it("rolls back a failed sync without erasing the prior read model", async () => {
    const invalidRuleset: PublishedRuleset = {
      ...ruleset,
      rules: ruleset.rules.map((rule, index) =>
        index === 0 ? { ...rule, kind: "invalid_kind" } : rule,
      ),
    };

    await expect(syncPermitRules(database, invalidRuleset)).rejects.toThrow(/check constraint/);
    const count = await database.query<{ count: string }>(
      "SELECT count(*) FROM permit_rules WHERE ruleset_version = $1",
      [ruleset.rulesetVersion],
    );
    expect(Number(count.rows[0]?.count)).toBe(46);
  });
});

// The validator's promise is "this survives the `date` column", and the mechanism is a JS check —
// so the two have to be shown to agree rather than assumed to. Year zero is where they did not:
// ISO 8601 has one, ECMAScript implements it, Postgres has none, so a value that passed every
// clause failed at the INSERT. Casting the boundaries through a real column is what keeps that
// claim honest; the sweep behind it covered every string the shape admits (the full year axis,
// the full month and day axes, February 28 and 29 of all 10,000 years, each month's last and
// first-invalid day) and found year 0000 to be the only disagreement, with no value that both
// accept stored as a different day.
describe.runIf((process.env.DATABASE_URL ?? "").length > 0)(
  "the date check agrees with the column it stands in for",
  () => {
    let client: Client;

    beforeAll(async () => {
      client = new Client({ connectionString: process.env.DATABASE_URL });
      await client.connect();
    }, 30_000);

    afterAll(async () => {
      await client.end();
    }, 30_000);

    /** Whether a Postgres `date` accepts the value, and what it stores if it does. */
    const asStoredDate = async (value: string): Promise<string | null> => {
      try {
        const { rows } = await client.query<{ d: string }>("SELECT ($1::date)::text AS d", [value]);
        return rows[0]?.d ?? null;
      } catch {
        return null;
      }
    };

    const validatorAccepts = async (date: string): Promise<boolean> => {
      const ruleset = await readRawRuleset();
      firstVerification(ruleset).last_verified_date = date;
      try {
        validateRuleset(ruleset);
        return true;
      } catch {
        return false;
      }
    };

    it.each([
      // Accepted by both, and stored as itself.
      "0001-01-01",
      "0001-12-31",
      "1582-10-04",
      "1582-10-15",
      "1900-02-28",
      "2000-02-29",
      "2024-02-29",
      "2026-07-18",
      "9999-12-31",
      // Rejected by both: impossible days inside the shape.
      "2026-02-29",
      "2026-02-31",
      "2026-13-45",
      "2026-00-01",
      "2026-01-00",
      // Rejected by both, and the reason differs on each side — the shape rejects these before the
      // round trip, while Postgres would accept several of them and reinterpret them entirely.
      "2026-7-18",
      "20260718",
      "2026-189",
      "today",
      "epoch",
      "infinity",
      "10000-01-01",
      // The one the validator had to be taught: legal ISO, no such Postgres date.
      "0000-01-01",
      "0000-02-29",
      "0000-12-31",
    ])("agrees about %s", async (date) => {
      const stored = await asStoredDate(date);
      const accepted = await validatorAccepts(date);
      // Equivalence in the direction that matters: nothing the validator accepts may fail the cast,
      // and nothing it accepts may be stored as a different day. The reverse — Postgres accepting
      // what the validator refuses — is deliberate and safe, so it is not asserted as equality.
      if (accepted) {
        expect(stored, `${date} passed the validator, so the column must take it`).toBe(date);
      }
    });

    it("rejects every year-zero day while accepting the years either side", async () => {
      // Stated as a pair so the fix cannot drift into rejecting year 1 or 9999, which the column
      // stores without complaint.
      for (const date of ["0000-01-01", "0000-02-29", "0000-06-15", "0000-12-31"]) {
        expect(await validatorAccepts(date), date).toBe(false);
        expect(await asStoredDate(date), date).toBeNull();
      }
      for (const date of ["0001-01-01", "9999-12-31"]) {
        expect(await validatorAccepts(date), date).toBe(true);
        expect(await asStoredDate(date), date).toBe(date);
      }
    });
  },
);
