import type { ColumnDefinitions, MigrationBuilder } from "node-pg-migrate";

export const shorthands: ColumnDefinitions | undefined = undefined;

const PAIR_CONSTRAINT = "events_create_request_pair";
const KEY_INDEX = "events_create_idempotency_key_unique";

export function up(pgm: MigrationBuilder): void {
  pgm.addColumns("events", {
    create_idempotency_key: { type: "uuid" },
    create_request_body: { type: "jsonb" },
  });
  pgm.addConstraint("events", PAIR_CONSTRAINT, {
    check: "(create_idempotency_key IS NULL) = (create_request_body IS NULL)",
  });
  pgm.createIndex("events", "create_idempotency_key", {
    name: KEY_INDEX,
    unique: true,
  });
}

export function down(pgm: MigrationBuilder): void {
  pgm.dropIndex("events", "create_idempotency_key", { name: KEY_INDEX });
  pgm.dropConstraint("events", PAIR_CONSTRAINT);
  pgm.dropColumns("events", ["create_idempotency_key", "create_request_body"]);
}
