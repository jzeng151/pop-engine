import type { MigrationBuilder } from "node-pg-migrate";
import { Client } from "pg";
import { describe, expect, it, vi } from "vitest";
import { up } from "../migrations/013_stale_assembly_document_plans";

const databaseUrl = process.env.DATABASE_URL ?? "";

const migrationSql = (): string => {
  const sql = vi.fn();
  up({ sql } as unknown as MigrationBuilder);
  return String(sql.mock.calls[0]?.[0]);
};

describe("migration 013", () => {
  it("only advances qualifying drafts whose two F-110 answers were backfilled", () => {
    const backfill = migrationSql();
    expect(backfill).toContain("revision_counter = revision_counter + 1");
    expect(backfill).toContain("updated_at = current_timestamp");
    expect(backfill).toContain("status = 'draft'");
    expect(backfill).toContain("location_type = 'private_venue'");
    expect(backfill).toContain("headcount >= 75");
    expect(backfill).toContain("venue_paco_covers_exact_event = 'unknown'");
    expect(backfill).toContain("venue_fdny_pa_permit_current_for_event_space = 'unknown'");
    expect(backfill).toContain("plan.intake_snapshot ? 'venue_paco_covers_exact_event'");
    expect(backfill).toContain(
      "plan.intake_snapshot ? 'venue_fdny_pa_permit_current_for_event_space'",
    );
    expect(backfill).toContain("ORDER BY plan.generated_at DESC, plan.id DESC");
  });
});

describe.runIf(databaseUrl.length > 0)("migration 013 correction after migration 012", () => {
  it("stales every latest plan whose snapshot is missing either F-110 key", async () => {
    const client = new Client({ connectionString: databaseUrl });
    await client.connect();
    try {
      await client.query(`
        CREATE TEMP TABLE events (
          id text,
          status text,
          location_type text,
          headcount integer,
          venue_paco_covers_exact_event text,
          venue_fdny_pa_permit_current_for_event_space text,
          revision_counter integer,
          updated_at timestamptz
        );
        INSERT INTO events VALUES
          ('legacy', 'draft', 'private_venue', 75, 'unknown', 'unknown', 4,
           '2026-01-01T00:00:00Z'),
          ('partial', 'draft', 'private_venue', 75, 'unknown', 'unknown', 4,
           '2026-01-01T00:00:00Z'),
          ('current', 'draft', 'private_venue', 75, 'unknown', 'unknown', 4,
           '2026-01-01T00:00:00Z');

        CREATE TEMP TABLE permit_plans (
          id text,
          event_id text,
          event_revision integer,
          intake_snapshot jsonb,
          generated_at timestamptz
        );
        INSERT INTO permit_plans VALUES
          ('legacy-plan', 'legacy', 4, '{}', '2026-01-02T00:00:00Z'),
          ('partial-plan', 'partial', 4,
           '{"venue_paco_covers_exact_event":"unknown"}', '2026-01-02T00:00:00Z'),
          ('current-old', 'current', 4, '{}', '2026-01-02T00:00:00Z'),
          ('current-new', 'current', 4,
           '{"venue_paco_covers_exact_event":"unknown",
             "venue_fdny_pa_permit_current_for_event_space":"unknown"}',
           '2026-01-03T00:00:00Z');
      `);

      await client.query(migrationSql());
      const { rows } = await client.query<{
        id: string;
        revision_counter: number;
        timestamp_advanced: boolean;
        plan_stale: boolean;
      }>(`
        SELECT e.id,
               e.revision_counter,
               e.updated_at > '2026-01-01T00:00:00Z'::timestamptz AS timestamp_advanced,
               latest.event_revision < e.revision_counter AS plan_stale
          FROM events e
          CROSS JOIN LATERAL (
            SELECT event_revision
              FROM permit_plans
             WHERE event_id = e.id
             ORDER BY generated_at DESC, id DESC
             LIMIT 1
          ) latest
         ORDER BY e.id
      `);

      expect(rows).toEqual([
        {
          id: "current",
          revision_counter: 4,
          timestamp_advanced: false,
          plan_stale: false,
        },
        {
          id: "legacy",
          revision_counter: 5,
          timestamp_advanced: true,
          plan_stale: true,
        },

        {
          id: "partial",
          revision_counter: 5,
          timestamp_advanced: true,
          plan_stale: true,
        },
      ]);
    } finally {
      await client.end();
    }
  });
});
