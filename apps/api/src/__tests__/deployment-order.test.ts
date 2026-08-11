import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { PROVIDER_DEDUP_WINDOW_HOURS } from "../alerts/alerts";

const repoFile = (relativePath: string): string =>
  fileURLToPath(new URL(`../../../../${relativePath}`, import.meta.url));

const read = (relativePath: string): string => readFileSync(repoFile(relativePath), "utf8");

const runbook = read("DEPLOY.md");
const releaseOrder = runbook.slice(runbook.indexOf("### Release order"));

describe("F-302 rollout constraint the runbook has to carry", () => {
  it("keeps the capacity rename web-first while the compatibility response is shape-only", () => {
    const api = read("apps/api/src/attendance/rsvps.ts");
    expect(api).toContain("SELECT id, name, capacity, headcount");
    expect(api).toContain("headcount: event.headcount");

    const web = read("apps/web/app/events/[id]/guests/guests-api.ts");
    expect(web).toContain('if ("capacity" in event)');
    expect(web).toContain('typeof event.headcount === "number"');

    const prose = releaseOrder.replace(/\s+/g, " ");
    expect(prose).toMatch(/F-302 capacity rename \(issue #236\)/i);
    expect(prose).toMatch(/verify it is live[\s\S]*no web build or selectable rollback target/i);
    expect(prose).toMatch(/different numeric values[\s\S]*wrong limit/i);
    expect(prose).toMatch(/capacity = null[\s\S]*finite limit enforced nowhere/i);
  });
});

describe("F-203 rollout constraints the runbook has to carry", () => {
  it("tells a deployer to stop the running api before migration 014's backfill lands", () => {
    const migration = read("apps/api/migrations/014_alert_send_attempts.ts");
    expect(migration).toContain("INSERT INTO alert_send_attempts");
    expect(read("apps/api/src/alerts/alerts.ts")).toContain("FROM alert_send_attempts AS attempt");

    expect(releaseOrder).toContain("alert_send_attempts");
    expect(releaseOrder.replace(/\s+/g, " ")).toMatch(
      /no api process from the previous build is still running/i,
    );
  });

  it("names a drain the api can actually perform", () => {
    const bootstrap = read("apps/api/src/index.ts");
    expect(bootstrap).toContain('process.once("SIGTERM"');
    expect(bootstrap).toContain("alertPoller.stop()");
    expect(bootstrap).toMatch(/await Promise\.all\(\[[\s\S]*pollerStopped[\s\S]*\]\)/);

    expect(releaseOrder).toContain("SIGTERM");
  });

  it("does not ask the previous build for a drain that ships with this one", () => {
    expect(read("apps/api/src/alerts/alerts.ts")).toContain("idempotencyKey: providerKey(row)");

    const prose = releaseOrder.replace(/\s+/g, " ");
    expect(prose).toMatch(/predates (this|that|the) (drain|handler)/i);
    expect(prose).toMatch(new RegExp(`${PROVIDER_DEDUP_WINDOW_HOURS}[- ]?hour`, "i"));
  });

  it("empties the old build's queue before the stop instead of anchoring a hold to it", () => {
    const alerts = read("apps/api/src/alerts/alerts.ts");
    expect(alerts).toContain(
      "AND (next_attempt_at IS NULL OR next_attempt_at <= statement_timestamp())",
    );
    expect(read("apps/api/migrations/014_alert_send_attempts.ts")).toContain(
      "WHERE status = 'failed'",
    );

    const prose = releaseOrder.replace(/\s+/g, " ");
    expect(prose).toMatch(/no alert can have been handed to a provider before the instant/i);
    expect(releaseOrder).toContain("T_stop");
    expect(releaseOrder).toContain("SET next_attempt_at = TIMESTAMPTZ '<T_resume>'");
    expect(releaseOrder).toContain("SET next_attempt_at = NULL");
    expect(prose).toMatch(/must be 0/i);
    expect(releaseOrder).not.toContain("INSERT INTO alert_send_attempts");
    expect(prose).not.toMatch(/anchored at `?T_stop/i);
    expect(prose).not.toMatch(/complete the rollout well inside 24 hours/i);
  });

  it("describes the attempt row as an intent rather than a completed handoff", () => {
    expect(read("apps/api/src/alerts/alerts.ts")).toContain(
      "Record that this alert is ABOUT to be handed",
    );

    const architecture = read("docs/ARCHITECTURE.md");
    const schemaSection = architecture.slice(
      architecture.indexOf("### alert_send_attempts"),
      architecture.indexOf("### event_alert_contacts"),
    );
    const prose = schemaSection.replace(/\s+/g, " ");
    expect(prose).not.toBe("");
    expect(prose).not.toMatch(/(was|were) handed to a provider/i);
    expect(prose).not.toMatch(/at the moment of the handoff/i);

    expect(read("apps/api/migrations/014_alert_send_attempts.ts").replace(/\s+/g, " ")).not.toMatch(
      /PopEngine handed an alert to a provider/i,
    );
  });

  it("describes the hold as bounded and released from the first unresolved attempt", () => {
    expect(read("apps/api/src/alerts/alerts.ts")).toContain("UNRESOLVED_ATTEMPT_HOLD_LIMIT_HOURS");

    const architecture = read("docs/ARCHITECTURE.md");
    const schemaSection = architecture.slice(
      architecture.indexOf("### alert_send_attempts"),
      architecture.indexOf("### event_alert_contacts"),
    );
    const prose = schemaSection.replace(/\s+/g, " ");
    expect(prose).toContain("UNRESOLVED_ATTEMPT_HOLD_LIMIT_HOURS");
    expect(prose).toMatch(/first unresolved attempt/i);
    expect(prose).not.toMatch(/held out of every scan permanently/i);
  });

  it("describes the attempt row the same way in the baseline as in the architecture record", () => {
    const baseline = read("docs/BASELINE.md").replace(/\s+/g, " ");
    const record = baseline.slice(
      baseline.indexOf("migration 014 adds a new"),
      baseline.indexOf("It adds no column to `events`"),
    );
    expect(record).not.toBe("");
    expect(record).not.toMatch(/table recording that an alert was handed to a provider/i);
    expect(record).toMatch(/intent/i);
    expect(record).toMatch(/two causes/i);

    const architecture = read("docs/ARCHITECTURE.md");
    const schemaSection = architecture
      .slice(
        architecture.indexOf("### alert_send_attempts"),
        architecture.indexOf("### event_alert_contacts"),
      )
      .replace(/\s+/g, " ");
    expect(schemaSection).not.toMatch(/set only when a cancelled alert is revived/i);
    expect(schemaSection).toMatch(/two causes/i);

    expect(read("apps/api/migrations/014_alert_send_attempts.ts").replace(/\s+/g, " ")).toMatch(
      /two causes/i,
    );
  });

  it("tells a deployer to deploy web before the api for the reconciliation notice", () => {
    expect(read("apps/api/src/planning/checklist.ts")).toContain("alertsHeldForReconciliation");
    expect(read("apps/web/app/checklist/checklist-api.ts")).toContain("withRolloutDefaults");

    expect(releaseOrder).toContain("alertsHeldForReconciliation");
    expect(releaseOrder).toMatch(/web (service )?(first|before)/i);
  });
});
