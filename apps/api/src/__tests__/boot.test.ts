import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { rulesFilePath } from "../ruleset";

const databaseUrl = process.env.DATABASE_URL ?? "";
const apiDirectory = fileURLToPath(new URL("../..", import.meta.url));
const PROBE_DATABASE = "pop_engine_boot_probe";

const probeUrl = (): string => {
  const url = new URL(databaseUrl);
  url.pathname = `/${PROBE_DATABASE}`;
  return url.toString();
};

async function cyclicRulesetFile(): Promise<string> {
  const published: { intake_fields: unknown[] } = JSON.parse(
    await readFile(rulesFilePath(), "utf8"),
  );
  published.intake_fields = [
    ...published.intake_fields,
    { field: "left_gate", type: "boolean", asked_when: "right_gate" },
    { field: "right_gate", type: "boolean", asked_when: "left_gate" },
  ];
  const file = join(mkdtempSync(join(tmpdir(), "pop-engine-boot-")), "cyclic.json");
  writeFileSync(file, JSON.stringify(published));
  return file;
}

async function verificationDateRulesetFile(date: string, name: string): Promise<string> {
  const published: { rules: { verification: { last_verified_date?: string } }[] } = JSON.parse(
    await readFile(rulesFilePath(), "utf8"),
  );
  const rule = published.rules[0];
  if (rule === undefined) throw new Error("published ruleset has no rules");
  rule.verification.last_verified_date = date;
  const file = join(mkdtempSync(join(tmpdir(), "pop-engine-boot-")), name);
  writeFileSync(file, JSON.stringify(published));
  return file;
}

async function badAlertOffsetRulesetFile(): Promise<string> {
  const published: { config: { alert_offsets: { deadline_reminder: unknown } } } = JSON.parse(
    await readFile(rulesFilePath(), "utf8"),
  );
  published.config.alert_offsets.deadline_reminder = { days_before: [7, -1] };
  const file = join(mkdtempSync(join(tmpdir(), "pop-engine-boot-")), "bad-alert-offset.json");
  writeFileSync(file, JSON.stringify(published));
  return file;
}

function runBoot(rulesFile: string): Promise<{ code: number | null; stderr: string }> {
  return new Promise((settle) => {
    const child = spawn("npx", ["tsx", "src/index.ts"], {
      cwd: apiDirectory,
      env: { ...process.env, RULES_FILE: rulesFile, DATABASE_URL: probeUrl(), PORT: "0" },
    });
    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString()));
    child.on("close", (code) => settle({ code, stderr }));
  });
}

describe.runIf(databaseUrl.length > 0)("boot refuses a malformed ruleset before writing", () => {
  let admin: Client;

  beforeAll(async () => {
    admin = new Client({ connectionString: databaseUrl });
    await admin.connect();
    await admin.query(`DROP DATABASE IF EXISTS ${PROBE_DATABASE}`);
    await admin.query(`CREATE DATABASE ${PROBE_DATABASE}`);
  }, 30_000);

  afterAll(async () => {
    await admin.query(`DROP DATABASE IF EXISTS ${PROBE_DATABASE}`);
    await admin.end();
  }, 30_000);

  it("fails on the artifact and never reaches the read model", async () => {
    const result = await runBoot(await cyclicRulesetFile());

    expect(result.code).not.toBe(0);
    expect(result.stderr).toMatch(/scoping is cyclic/);
    expect(result.stderr).not.toMatch(/permit_rules/);
  }, 90_000);

  it("fails on a verification date no calendar has, before any plan could be written", async () => {
    const result = await runBoot(await verificationDateRulesetFile("2026-13-45", "bad-date.json"));

    expect(result.code).not.toBe(0);
    expect(result.stderr).toMatch(/last_verified_date must be an ISO date/);
    expect(result.stderr).not.toMatch(/permit_rules/);
  }, 90_000);

  it("fails on ISO year zero, which the calendar round trip alone lets through", async () => {
    const result = await runBoot(await verificationDateRulesetFile("0000-01-01", "year-zero.json"));

    expect(result.code).not.toBe(0);
    expect(result.stderr).toMatch(/last_verified_date has no year 0000/);
    expect(result.stderr).not.toMatch(/permit_rules/);
  }, 90_000);

  it("fails on a reminder offset that would fire after the deadline", async () => {
    const result = await runBoot(await badAlertOffsetRulesetFile());

    expect(result.code).not.toBe(0);
    expect(result.stderr).toMatch(/days_before\[1\] must be a positive whole number/);
    expect(result.stderr).not.toMatch(/permit_rules/);
  }, 90_000);

  it("does reach the read model once the artifact is valid", async () => {
    const result = await runBoot(rulesFilePath());

    expect(result.code).not.toBe(0);
    expect(result.stderr).toMatch(/permit_rules/);
    expect(result.stderr).not.toMatch(/scoping is cyclic/);
  }, 90_000);
});
