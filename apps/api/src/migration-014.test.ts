import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// A migration is a historical record: once it has run somewhere, what it did there is fixed. A
// migration that reads a live application constant is not fixed, and nothing about it looks
// changed when it changes: a later edit to the constant rewrites what an already-applied migration
// is understood to have done, and a database migrated after that edit gets a different seed from
// one migrated before it, out of the same migration set. Migration 014 imported
// `PROVIDER_DEDUP_WINDOW_HOURS` for its backfill interval, which kept the seed and the window in
// step at the cost of both properties.
//
// So the VALUE is frozen and the DERIVATION stays written down, in 014's own prose and beside the
// constant in `alerts.ts`. A later change to the provider window is a new ordered migration
// (AGENTS.md: never edit a merged migration), not a silent re-reading of this one.

const migrationsDir = fileURLToPath(new URL("../migrations", import.meta.url));

const read = (file: string): string => readFileSync(`${migrationsDir}/${file}`, "utf8");

describe("migrations as historical records", () => {
  it("seeds migration 014's backfill from a frozen interval", () => {
    // The 24 hours Resend honoured a repeated `Idempotency-Key` for when this migration was
    // written, which is the claim the seeded stamp makes and is now this migration's own number.
    expect(read("014_alert_send_attempts.ts")).toContain("interval '24 hours'");
  });

  it("reads no live application value in any migration", () => {
    const readingLiveCode = readdirSync(migrationsDir)
      .filter((file) => file.endsWith(".ts"))
      .filter((file) => /from\s+"\.\.\/src\//.test(read(file)));
    expect(readingLiveCode).toEqual([]);
  });
});
