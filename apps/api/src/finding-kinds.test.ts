import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadRuleset } from "./ruleset";

const databaseUrl = process.env.DATABASE_URL ?? "";

const RULE_KIND_TO_FINDING_KIND: Record<string, string> = { classification: "note" };

async function allowedKinds(db: Client, table: string): Promise<Set<string>> {
  const { rows } = await db.query<{ def: string }>(
    `SELECT pg_get_constraintdef(c.oid) AS def
       FROM pg_constraint c
       JOIN pg_class t ON t.oid = c.conrelid
      WHERE c.contype = 'c' AND t.relname = $1
        AND pg_get_constraintdef(c.oid) ~ 'kind ='`,
    [table],
  );
  if (rows.length === 0) throw new Error(`no kind CHECK constraint found on ${table}`);
  const kinds = new Set<string>();
  for (const { def } of rows) {
    for (const match of def.matchAll(/'([^']+)'/g)) if (match[1]) kinds.add(match[1]);
  }
  return kinds;
}

describe.runIf(databaseUrl.length > 0)("rule kind vs persisted finding kind (#73)", () => {
  let db: Client;

  beforeAll(async () => {
    db = new Client({ connectionString: databaseUrl });
    await db.connect();
  });

  afterAll(async () => {
    await db.end();
  });

  it("keeps rule kinds and finding kinds consistent across ruleset and current schema", async () => {
    const ruleKindsDb = await allowedKinds(db, "permit_rules");
    const findingKinds = await allowedKinds(db, "permit_plan_items");

    const ruleset = await loadRuleset();
    const usedKinds = new Set([...ruleset.rules, ...ruleset.advisories].map((rule) => rule.kind));

    for (const kind of usedKinds) {
      expect(ruleKindsDb, `permit_rules.kind must accept "${kind}"`).toContain(kind);
    }

    for (const kind of usedKinds) {
      if (findingKinds.has(kind)) continue;
      const mapped = RULE_KIND_TO_FINDING_KIND[kind];
      expect(mapped, `rule kind "${kind}" is not a finding kind and has no mapping`).toBeDefined();
      expect(findingKinds, `mapping target "${mapped}" must be a finding kind`).toContain(mapped);
    }

    for (const source of Object.keys(RULE_KIND_TO_FINDING_KIND)) {
      expect(usedKinds, `mapping source "${source}" is unused by the ruleset`).toContain(source);
      expect(findingKinds, `mapping source "${source}" is already a finding kind`).not.toContain(
        source,
      );
    }

    expect(ruleKindsDb.has("classification")).toBe(true);
    expect(findingKinds.has("classification")).toBe(false);
  });
});
