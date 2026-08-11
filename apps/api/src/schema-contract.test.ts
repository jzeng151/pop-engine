import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { publishedRulesFile, RULE_KINDS, VERIFICATION_STATUSES } from "./ruleset";

const databaseUrl = process.env.DATABASE_URL ?? "";

const repoFile = (relativePath: string): string =>
  fileURLToPath(new URL(`../../../${relativePath}`, import.meta.url));

const MUST_BE_DOCUMENTED = [
  "permit_rules.kind",
  "permit_plan_items.kind",
  "permit_plan_items.disposition",
  "permit_plan_items.deadline_status",
  "permit_plan_items.verification_status",
  "permit_plans.verdict",
];

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
