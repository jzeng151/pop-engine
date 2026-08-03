import type { ColumnDefinitions, MigrationBuilder } from "node-pg-migrate";

export const shorthands: ColumnDefinitions | undefined = undefined;

/**
 * That PopEngine handed an alert to a provider, recorded BEFORE the handoff.
 *
 * Until now nothing was written until a send had already succeeded, so a process that died between
 * the provider accepting the message and the COMMIT left a row byte-identical to one that had never
 * been tried. Those two states need opposite treatment — the untried row must go out, the other one
 * may already have reached the recipient — and no column on `alerts` could tell them apart.
 *
 * A TABLE RATHER THAN A COLUMN, for a mechanical reason rather than a modelling preference. The
 * intent has to survive a transaction that is about to roll back, so it is written on a second
 * connection and committed on its own. The sending transaction holds the `alerts` row locked for
 * the whole send, so a second connection cannot write to that row at all; it can insert a child row,
 * because a foreign key takes only FOR KEY SHARE on the parent (`alerts.ts` claims the row FOR NO
 * KEY UPDATE for exactly this reason).
 *
 * `outcome_recorded_at` NULL is the whole point: it means nobody ever observed what the provider
 * did with this attempt. A crash leaves it null forever, and so does a request that timed out —
 * a timeout is not an answer. It is set when the provider answered, delivery or refusal alike,
 * because either answer tells this side what happened.
 *
 * The key is stored because it is what a reconciliation would look the message up by at the
 * provider. It is a digest of the destination, never the destination itself (AGENTS.md: no
 * unredacted contact data).
 */
export function up(pgm: MigrationBuilder): void {
  pgm.createTable("alert_send_attempts", {
    id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
    alert_id: {
      type: "uuid",
      notNull: true,
      references: "alerts",
      onDelete: "CASCADE",
    },
    idempotency_key: { type: "text", notNull: true },
    attempted_at: { type: "timestamptz", notNull: true, default: pgm.func("clock_timestamp()") },
    outcome_recorded_at: { type: "timestamptz" },
  });
  // The one question asked of this table on every scan: does this alert have an attempt nobody ever
  // saw the end of. Partial, because a resolved attempt is history and never selected.
  pgm.createIndex("alert_send_attempts", ["alert_id"], {
    name: "alert_send_attempts_unresolved_idx",
    where: "outcome_recorded_at IS NULL",
  });
}

export function down(pgm: MigrationBuilder): void {
  pgm.dropTable("alert_send_attempts");
}
