import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const migrationsDir = fileURLToPath(new URL("../migrations", import.meta.url));

const read = (file: string): string => readFileSync(`${migrationsDir}/${file}`, "utf8");

describe("migrations as historical records", () => {
  it("seeds migration 014's backfill from a frozen interval", () => {
    expect(read("014_alert_send_attempts.ts")).toContain("interval '24 hours'");
  });

  it("reads no live application value in any migration", () => {
    const readingLiveCode = readdirSync(migrationsDir)
      .filter((file) => file.endsWith(".ts"))
      .filter((file) => /from\s+"\.\.\/src\//.test(read(file)));
    expect(readingLiveCode).toEqual([]);
  });
});
