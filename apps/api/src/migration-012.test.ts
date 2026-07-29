import type { MigrationBuilder } from "node-pg-migrate";
import { Client } from "pg";
import { describe, expect, it, vi } from "vitest";
import { down, up } from "../migrations/012_events_assembly_document_coverage";

const databaseUrl = process.env.DATABASE_URL ?? "";

describe("migration 013", () => {
  it("adds both tri-states and invalidates plans only for backfilled drafts", () => {
    const addColumns = vi.fn();
    const sql = vi.fn();
    up({ addColumns, sql } as unknown as MigrationBuilder);

    expect(addColumns).toHaveBeenCalledWith(
      "events",
      expect.objectContaining({
        venue_paco_covers_exact_event: expect.objectContaining({ type: "text" }),
        venue_fdny_pa_permit_current_for_event_space: expect.objectContaining({ type: "text" }),
      }),
    );
    const backfill = String(sql.mock.calls[0]?.[0]);
    expect(backfill).toContain("venue_paco_covers_exact_event = 'unknown'");
    expect(backfill).toContain("venue_fdny_pa_permit_current_for_event_space = 'unknown'");
    expect(backfill).toContain("status = 'draft'");
    expect(backfill).toContain("location_type = 'private_venue'");
    expect(backfill).toContain("headcount >= 75");
    expect(backfill).toContain("revision_counter = revision_counter + 1");
    expect(backfill).toContain("updated_at = current_timestamp");
    expect(backfill).not.toContain("venue_has_assembly_approval");
  });

  it("removes only the two new columns on rollback", () => {
    const dropColumns = vi.fn();
    down({ dropColumns } as unknown as MigrationBuilder);
    expect(dropColumns).toHaveBeenCalledWith("events", [
      "venue_paco_covers_exact_event",
      "venue_fdny_pa_permit_current_for_event_space",
    ]);
  });
});

describe.runIf(databaseUrl.length > 0)("migration 013 backfill", () => {
  it("bumps the revision and timestamp so a qualifying draft's existing plan is stale", async () => {
    const sql = vi.fn();
    up({ addColumns: vi.fn(), sql } as unknown as MigrationBuilder);
    const backfill = String(sql.mock.calls[0]?.[0]);
    const client = new Client({ connectionString: databaseUrl });
    await client.connect();
    try {
      await client.query(`
        CREATE TEMP TABLE events AS SELECT
          'qualifying'::text AS id,
          'draft'::text AS status,
          'private_venue'::text AS location_type,
          75::integer AS headcount,
          NULL::text AS venue_paco_covers_exact_event,
          NULL::text AS venue_fdny_pa_permit_current_for_event_space,
          4::integer AS revision_counter,
          '2026-01-01T00:00:00Z'::timestamptz AS updated_at;
        CREATE TEMP TABLE permit_plans AS SELECT
          'qualifying'::text AS event_id,
          4::integer AS event_revision;
      `);

      await client.query(backfill);
      const { rows } = await client.query<{
        revision_counter: number;
        paco: string;
        fdny: string;
        timestamp_advanced: boolean;
        plan_stale: boolean;
      }>(`
        SELECT e.revision_counter,
               e.venue_paco_covers_exact_event AS paco,
               e.venue_fdny_pa_permit_current_for_event_space AS fdny,
               e.updated_at > '2026-01-01T00:00:00Z'::timestamptz AS timestamp_advanced,
               p.event_revision < e.revision_counter AS plan_stale
          FROM events e
          JOIN permit_plans p ON p.event_id = e.id
      `);

      expect(rows).toEqual([
        {
          revision_counter: 5,
          paco: "unknown",
          fdny: "unknown",
          timestamp_advanced: true,
          plan_stale: true,
        },
      ]);
    } finally {
      await client.end();
    }
  });
});
