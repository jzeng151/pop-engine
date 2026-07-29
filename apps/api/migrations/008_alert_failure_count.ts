import type { ColumnDefinitions, MigrationBuilder } from "node-pg-migrate";

export const shorthands: ColumnDefinitions | undefined = undefined;

/**
 * F-203 edge case "Twilio/SMTP outage": a delivery failure leaves the alert to be retried on a
 * later tick, and nothing is lost. `status` already records that the last attempt failed; it
 * cannot say how many attempts an alert has taken, which is the difference between a provider
 * blip and an address that will never accept mail. The spec names the counter, so it is a column
 * rather than a number folded into `payload` — `payload` is the rendered message, and delivery
 * state does not belong inside the text being delivered.
 *
 * Migration 001 is merged and immutable (AGENTS.md), so this is an ordered forward migration.
 * It adds a column to `alerts` only: no CHECK is widened and the `events` four-lane contract is
 * untouched.
 */
export function up(pgm: MigrationBuilder): void {
  pgm.addColumn("alerts", {
    failure_count: { type: "integer", notNull: true, default: 0 },
  });
}

export function down(pgm: MigrationBuilder): void {
  pgm.dropColumn("alerts", "failure_count");
}
