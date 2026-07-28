import type { ColumnDefinitions, MigrationBuilder } from "node-pg-migrate";

export const shorthands: ColumnDefinitions | undefined = undefined;

export function up(pgm: MigrationBuilder): void {
  // DEMO SCOPE. What the organizer typed off a permit they already hold, so the obtained-permits
  // view can display it back to them. This is not F-208 and will be superseded by it.
  //
  // Every column is nullable and none is defaulted, because a value here is only ever one the
  // organizer entered. A default would put a number, an issue date or an expiry on a record
  // nobody supplied one for, and the view would then state a permit fact the product cannot back.
  // Null means "not recorded", and the view says exactly that.
  //
  // `workspace_id` is deliberately read by nothing in this change, and that is the point of
  // adding it now. F-702's tenancy work backfills a workspace onto existing rows; if this column
  // is absent then, that backfill becomes a schema migration over live administrative records
  // rather than an UPDATE. No foreign key: the workspaces table does not exist yet, and a
  // reference to a table that is not there would not apply.
  pgm.addColumn("checklist_items", {
    permit_number: { type: "text" },
    issued_on: { type: "date" },
    expires_on: { type: "date" },
    workspace_id: { type: "uuid" },
  });
}
