import type { ColumnDefinitions, MigrationBuilder } from "node-pg-migrate";

export const shorthands: ColumnDefinitions | undefined = undefined;

export function up(pgm: MigrationBuilder): void {
  // The published filing date this row was showing at the moment the organizer last worked it.
  //
  // The moved-filing-date notice needs to compare "the date they were working to" against "the
  // date now", and the first half was derived rather than recorded: read the row's `updated_at`,
  // find the latest plan generated at or before it, and take that plan's date for the requirement.
  // That derivation is not merely imprecise, it is unsound, and no choice of timestamp repairs it.
  // `permit_plans.generated_at` defaults to `current_timestamp`, which in Postgres is the
  // transaction's START time, while the plan becomes visible only at COMMIT. Every statement in
  // between sees a plan that already carries an earlier `generated_at` than anything it stamps.
  // So a checklist PATCH overlapping a regeneration writes an `updated_at` later than a plan the
  // organizer's screen could not have shown, and the derivation then reads that plan as what they
  // worked against and stays silent (#117 review round 2).
  //
  // Timestamps cannot separate committed from uncommitted, so the date is captured instead of
  // inferred: the PATCH that moves `updated_at` records, in the same transaction, the date visible
  // to that transaction. Under READ COMMITTED it can only see plans that have committed, which is
  // exactly the set the organizer could have been shown.
  //
  // Nullable, and null means "not recorded", which is a third answer rather than a missing one.
  // A row nobody has worked has no such date, and the notice stays silent for it. So does a row
  // worked before this column existed, deliberately: back-filling those from the plan history
  // would re-assert the derivation this column replaces, on exactly the rows where it cannot be
  // checked. No database is configured anywhere for this project, so this is expected to leave no
  // row null that any organizer will see; it is the honest value regardless.
  pgm.addColumn("checklist_items", {
    worked_against_date: {
      type: "date",
    },
  });
}
