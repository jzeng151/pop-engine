import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { publishedRulesFile, RULE_KINDS, VERIFICATION_STATUSES } from "./ruleset";

// Regression guard for the root cause behind issues #70, #73 and #76: one contract
// is hand-copied into four places (the published ruleset, ARCHITECTURE.md, the F-2xx
// specs, and the migration) and nothing compared the copies. #73 and #76 were both a
// doc copy disagreeing with the schema, and both were repaired by hand.
//
// This suite compares the copies a machine can compare: every `CHECK IN (...)` list
// ARCHITECTURE.md publishes must equal the constraint the schema actually enforces,
// and the enum literals the boot validator holds must equal the same. It deliberately
// introduces no new canonical list, which would just be a fifth copy.
//
// Constraints are read from the live database after the full migration chain has run
// (CI applies `migrate up` before tests), not from migration 001, so a correctly-added
// future migration is honored and nobody is pushed to edit a merged migration
// (AGENTS.md). Runs only when a database is configured, matching the other
// schema-backed suites.

const databaseUrl = process.env.DATABASE_URL ?? "";

const repoFile = (relativePath: string): string =>
  fileURLToPath(new URL(`../../../${relativePath}`, import.meta.url));

// Deleting a documented enum is the cheap way to make this suite pass, so the columns
// the spec conflicts were about must stay documented.
const MUST_BE_DOCUMENTED = [
  "permit_rules.kind",
  "permit_plan_items.kind",
  "permit_plan_items.disposition",
  "permit_plan_items.deadline_status",
  "permit_plan_items.verification_status",
  "permit_plans.verdict",
];

// Words that appear alongside a column name in the doc's Type/Notes prose.
const TYPE_WORDS = new Set([
  "text",
  "date",
  "integer",
  "uuid",
  "jsonb",
  "numeric",
  "boolean",
  "timestamptz",
  "not",
  "null",
  "nullable",
  "pk",
  "fk",
]);

type DocumentedEnum = { key: string; values: string[]; line: number };

/**
 * Collect every `CHECK IN (...)` list in ARCHITECTURE.md, keyed `table.column`.
 * The table comes from the enclosing `### <table>` heading. The column is the last
 * identifier before `CHECK IN`, which handles both the one-row-per-column tables
 * (`| kind | text CHECK IN (...) |`) and the grouped/inline rows the events and
 * rsvps sections use (`... location_type CHECK IN (...)`).
 */
function parseDocumentedEnums(markdown: string): DocumentedEnum[] {
  const documented: DocumentedEnum[] = [];
  let table = "";
  markdown.split("\n").forEach((line, index) => {
    const heading = /^### (\w+)/.exec(line);
    if (heading?.[1] !== undefined) table = heading[1];
    const check = /CHECK IN \(([^)]*)\)/.exec(line);
    if (check?.[1] === undefined || table === "") return;
    const column = (line.slice(0, check.index).match(/[a-z][a-z_]+/g) ?? [])
      .filter((word) => !TYPE_WORDS.has(word))
      .at(-1);
    if (column === undefined) return;
    documented.push({
      key: `${table}.${column}`,
      values: check[1]
        .split(",")
        .map((value) => value.trim())
        .filter((value) => value !== ""),
      line: index + 1,
    });
  });
  return documented;
}

/** Read every single-column enum CHECK constraint from the current schema. */
async function readSchemaEnums(db: Client): Promise<Map<string, string[]>> {
  const { rows } = await db.query<{ table_name: string; column_name: string; def: string }>(
    `SELECT t.relname AS table_name, a.attname AS column_name, pg_get_constraintdef(c.oid) AS def
       FROM pg_constraint c
       JOIN pg_class t ON t.oid = c.conrelid
       JOIN pg_namespace n ON n.oid = t.relnamespace
       JOIN LATERAL unnest(c.conkey) AS k(attnum) ON true
       JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = k.attnum
      WHERE c.contype = 'c' AND n.nspname = 'public'`,
  );
  const enums = new Map<string, string[]>();
  for (const { table_name, column_name, def } of rows) {
    if (!def.includes("= ANY ")) continue;
    const values = [...def.matchAll(/'([^']*)'/g)].map((match) => match[1] ?? "");
    enums.set(`${table_name}.${column_name}`, [...new Set(values)].sort());
  }
  return enums;
}

const sorted = (values: Iterable<string>): string[] => [...new Set(values)].sort();

describe.runIf(databaseUrl.length > 0)("shared enum contracts do not drift", () => {
  let db: Client;
  let schemaEnums: Map<string, string[]>;
  let documented: DocumentedEnum[];

  beforeAll(async () => {
    db = new Client({ connectionString: databaseUrl });
    await db.connect();
    schemaEnums = await readSchemaEnums(db);
    documented = parseDocumentedEnums(readFileSync(repoFile("docs/ARCHITECTURE.md"), "utf8"));
  });

  afterAll(async () => {
    await db.end();
  });

  it("finds the documented enums it is meant to check", () => {
    // Guards the parser itself: a doc reformat that stops matching would otherwise
    // turn this whole suite into a no-op that still reports green.
    expect(documented.length).toBeGreaterThanOrEqual(MUST_BE_DOCUMENTED.length);
    const keys = documented.map((entry) => entry.key);
    for (const key of MUST_BE_DOCUMENTED) {
      expect(keys, `ARCHITECTURE.md must document the ${key} enum`).toContain(key);
    }
  });

  it("documents every CHECK IN list exactly as the schema enforces it", () => {
    for (const { key, values, line } of documented) {
      const enforced = schemaEnums.get(key);
      expect(
        enforced,
        `ARCHITECTURE.md:${line} documents ${key}, which has no enum CHECK`,
      ).toBeDefined();
      expect(sorted(values), `ARCHITECTURE.md:${line} disagrees with the ${key} CHECK`).toEqual(
        enforced,
      );
    }
  });

  it("keeps the boot validator's enum literals equal to the schema", () => {
    // The validator cannot read these from the database — it runs before the ruleset
    // is synced, and the engine tests run with no database at all (AD-2/AD-6). So the
    // literals stay, and this asserts they still match.
    expect(sorted(RULE_KINDS), "ruleset.ts RULE_KINDS vs permit_rules.kind").toEqual(
      schemaEnums.get("permit_rules.kind"),
    );
    expect(
      sorted(VERIFICATION_STATUSES),
      "ruleset.ts VERIFICATION_STATUSES vs permit_plan_items.verification_status",
    ).toEqual(schemaEnums.get("permit_plan_items.verification_status"));
  });

  it("keeps the published status_legend equal to the verification-status enum", () => {
    const ruleset: { status_legend: Record<string, string> } = JSON.parse(
      readFileSync(publishedRulesFile(), "utf8"),
    );
    expect(
      sorted(Object.keys(ruleset.status_legend)),
      "ruleset status_legend vs permit_plan_items.verification_status",
    ).toEqual(schemaEnums.get("permit_plan_items.verification_status"));
  });
});
