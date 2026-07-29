import type { ColumnDefinitions, MigrationBuilder } from "node-pg-migrate";

export const shorthands: ColumnDefinitions | undefined = undefined;

const assemblyCoverage = (column: string) => ({
  type: "text",
  check: `"${column}" IN ('yes', 'no', 'unknown')`,
});

/**
 * F-110 replaces the coarse assembly-approval question in the active intake registry with two
 * objective document confirmations. The old column stays untouched as deprecated history; an old
 * yes cannot establish exact PACO or FDNY Public Assembly Permit coverage.
 *
 * Number 013 follows every current local and remote migration claim inspected on 2026-07-29:
 * main ends at 011 and `jzeng151/demo-obtained-permits` claims 012.
 */
export function up(pgm: MigrationBuilder): void {
  pgm.addColumns("events", {
    venue_paco_covers_exact_event: assemblyCoverage("venue_paco_covers_exact_event"),
    venue_fdny_pa_permit_current_for_event_space: assemblyCoverage(
      "venue_fdny_pa_permit_current_for_event_space",
    ),
  });

  // Only qualifying drafts are safe to keep editable under the new required intake contract.
  // Unknown is explicit: no conclusion is inferred from the deprecated column.
  pgm.sql(`
    UPDATE events
       SET venue_paco_covers_exact_event = 'unknown',
           venue_fdny_pa_permit_current_for_event_space = 'unknown'
     WHERE status = 'draft'
       AND location_type = 'private_venue'
       AND headcount >= 75
  `);
}

export function down(pgm: MigrationBuilder): void {
  pgm.dropColumns("events", [
    "venue_paco_covers_exact_event",
    "venue_fdny_pa_permit_current_for_event_space",
  ]);
}
