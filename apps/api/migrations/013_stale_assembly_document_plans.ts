import type { ColumnDefinitions, MigrationBuilder } from "node-pg-migrate";

export const shorthands: ColumnDefinitions | undefined = undefined;

export function up(pgm: MigrationBuilder): void {
  pgm.sql(`
    UPDATE events AS event
       SET revision_counter = revision_counter + 1,
           updated_at = current_timestamp
     WHERE event.status = 'draft'
       AND event.location_type = 'private_venue'
       AND event.headcount >= 75
       AND event.venue_paco_covers_exact_event = 'unknown'
       AND event.venue_fdny_pa_permit_current_for_event_space = 'unknown'
       AND (
         SELECT NOT (
           plan.intake_snapshot ? 'venue_paco_covers_exact_event'
           AND plan.intake_snapshot ? 'venue_fdny_pa_permit_current_for_event_space'
         )
           FROM permit_plans AS plan
          WHERE plan.event_id = event.id
          ORDER BY plan.generated_at DESC, plan.id DESC
          LIMIT 1
       )
  `);
}

// The previous revision may already have been evaluated after this migration ran, so rollback
// cannot safely decrement it.
export function down(_pgm: MigrationBuilder): void {}
