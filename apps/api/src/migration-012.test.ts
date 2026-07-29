import type { MigrationBuilder } from "node-pg-migrate";
import { describe, expect, it, vi } from "vitest";
import { down, up } from "../migrations/012_events_assembly_document_coverage";

describe("migration 012", () => {
  it("adds both tri-states and backfills only qualifying drafts without reading the old column", () => {
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
