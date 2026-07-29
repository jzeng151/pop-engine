import type { ColumnDefinitions, MigrationBuilder } from "node-pg-migrate";

export const shorthands: ColumnDefinitions | undefined = undefined;

/**
 * When a failed alert becomes eligible again, as opposed to when it was scheduled.
 *
 * `send_at` is the schedule and must not move: it is what AC 2's two-minute bound is measured
 * against, and rewriting it on a failure would make every late delivery look punctual. So the
 * retry time is its own fact.
 *
 * Without one, a failed alert is due again immediately and stays due forever, so a backlog of
 * dead destinations was re-attempted on every scan — at ten seconds a send, consuming the whole
 * batch each time and pushing everything behind it past the delivery bound. `failure_count`
 * ordering demotes those rows within a scan but cannot remove them from it; this can.
 *
 * Nullable, and null means "never failed, eligible now", which is what every existing row is.
 */
export function up(pgm: MigrationBuilder): void {
  pgm.addColumn("alerts", { next_attempt_at: { type: "timestamptz" } });
}

export function down(pgm: MigrationBuilder): void {
  pgm.dropColumn("alerts", "next_attempt_at");
}
