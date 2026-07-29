import type { ColumnDefinitions, MigrationBuilder } from "node-pg-migrate";

export const shorthands: ColumnDefinitions | undefined = undefined;

/**
 * Where an event's alerts are sent, as a fact about the EVENT rather than about any message.
 *
 * `alerts.recipient` was carrying both, and the two have different lifetimes. "Where did this
 * message go" is message-scoped and immutable — it is the audit record, and rewriting it on a
 * sent row would falsify what was delivered. "Where do this event's alerts go" is event-scoped and
 * mutable, has exactly one value per channel, and exists whether or not any message has been sent
 * yet. Reading the second off the first meant projecting an answer out of the message log, and
 * every way that projection could be wrong was a separate defect: a test send polluted it, an
 * empty log had no answer at all, and correcting an address meant rewriting history. One table
 * makes all three stop being races and become a row.
 *
 * ADDITIVE. It references `events` and does not alter it: the events schema is the four-lane
 * contract (AGENTS.md) and nothing here touches its columns, constraints or triggers.
 *
 * Two nullable columns rather than a row per channel, deliberately. A `(event_id, channel)` shape
 * would need its own CHECK listing the channels, which is a second copy of the enum
 * `alerts.channel` already holds — the exact hand-copied-contract problem issues #70, #73 and #76
 * were about. Channels change by migration either way, so the columnar shape costs nothing and
 * carries no duplicate vocabulary.
 */
export function up(pgm: MigrationBuilder): void {
  pgm.createTable("event_alert_contacts", {
    event_id: {
      type: "uuid",
      primaryKey: true,
      references: "events",
    },
    // Both nullable and both meaningful: an organizer may give an email and no phone, and "no
    // phone" is an answer rather than a missing one. A row with neither is not written.
    email: { type: "text" },
    phone: { type: "text" },
    updated_at: {
      type: "timestamptz",
      notNull: true,
      default: pgm.func("current_timestamp"),
    },
  });
}

export function down(pgm: MigrationBuilder): void {
  pgm.dropTable("event_alert_contacts");
}
