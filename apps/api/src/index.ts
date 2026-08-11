import { readFile } from "node:fs/promises";
import { Client, Pool } from "pg";
import { parseEngineRuleset, parseIntakeContract } from "@pop-engine/engine";
import { sendersFromEnv } from "./alerts/alert-delivery";
import { ALERT_POLLER_CONNECTIONS, createAlertPoller, createAlertScheduler } from "./alerts/alerts";
import { createApp } from "./app";
import { holidayCalendarWarning, pinnedCalendar, todayInJurisdiction } from "./calendar";
import { createPlanService } from "./planning/plan";
import { deadlineReminderOffsets, loadRuleset, rulesFilePath, syncPermitRules } from "./ruleset";
import {
  createS3DocumentStorage,
  s3ClientFor,
  s3SettingsFromEnv,
  unconfiguredDocumentStorage,
} from "./planning/storage";
import { supabaseAccessTokenVerifier } from "./auth";

// Long-lived process (ARCHITECTURE.md AD-1).
const PORT = Number(process.env.PORT ?? 3001);

const ruleset = await loadRuleset();
// The engine reads the same published file the boot validator just checked (AD-2), and it runs BEFORE anything is written.
const engineRuleset = parseEngineRuleset(JSON.parse(await readFile(rulesFilePath(), "utf8")));

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL is required");
}

const database = new Client({ connectionString: databaseUrl });
await database.connect();
try {
  await syncPermitRules(database, ruleset);
} finally {
  await database.end();
}
const pool = new Pool({ connectionString: databaseUrl });

// One clock for the whole api: an intake date and a plan deadline are both calendar days in the jurisdiction the ruleset declares, so both read the day from the same function rather than each deciding what "today" means.
const today = () => todayInJurisdiction(engineRuleset.jurisdiction);
const planService = createPlanService(pool, engineRuleset, pinnedCalendar, today);

// Plans still generate without a published holiday list; the business-day lines in them do not
// get dates. Operators should know that before an organizer asks why.
const calendarWarning = holidayCalendarWarning(pinnedCalendar(engineRuleset.calendarId));
if (calendarWarning !== null) console.warn(calendarWarning);

// The bucket is optional at boot so the api still runs against a bare local database (DEPLOY.md: the scaffold needs no cloud accounts).
const s3Settings = s3SettingsFromEnv(process.env);
if (s3Settings === null) {
  console.warn("S3_* is not configured; F-202 document upload and download will return 503");
}
const documentStorage =
  s3Settings === null
    ? unconfiguredDocumentStorage()
    : createS3DocumentStorage(s3ClientFor(s3Settings), s3Settings.bucket);

// F-203.
const senders = sendersFromEnv(process.env);
if (!process.env.RESEND_API_KEY || !process.env.SMTP_FROM) {
  console.warn("RESEND_API_KEY / SMTP_FROM are not configured; email alerts will stay pending");
}
console.warn("SMS alerts render as a labeled in-product simulation (Twilio A2P 10DLC pending)");
const scheduleAlerts = createAlertScheduler({
  reminderDaysBefore: deadlineReminderOffsets(ruleset),
  slackWarningDays: engineRuleset.slackWarningDays,
  jurisdiction: engineRuleset.jurisdiction,
});
// A pool of the poller's own, because a send holds its connection for as long as the provider takes and the API must not be competing for what is left.
const alertPool = new Pool({
  connectionString: databaseUrl,
  max: ALERT_POLLER_CONNECTIONS,
});
const alertPoller = createAlertPoller({
  database: alertPool,
  senders,
  jurisdiction: engineRuleset.jurisdiction,
});
const verifyAccessToken = supabaseAccessTokenVerifier();
if (verifyAccessToken === null) {
  console.warn(
    "SUPABASE_URL / SUPABASE_PUBLISHABLE_KEY is not configured; /api/session returns 503",
  );
}

const server = createApp({
  database: pool,
  intakeContract: parseIntakeContract(ruleset.document),
  today,
  planService,
  checklist: {
    database: pool,
    storage: documentStorage,
    scheduleAlerts,
    jurisdiction: engineRuleset.jurisdiction,
  },
  alerts: { jurisdiction: engineRuleset.jurisdiction, database: pool, senders },
  rulesMeta: { rulesetVersion: ruleset.rulesetVersion, snapshotDate: ruleset.snapshotDate },
  ...(verifyAccessToken ? { verifyAccessToken } : {}),
}).listen(PORT, () => {
  console.log(`pop-engine-api listening on :${PORT}`);
  // In-process, in the long-lived api (AD-1/AD-4): no queue, no second service.
  alertPoller.start();
});

// THE DRAIN DEPLOY.md'S RELEASE ORDER ASKS FOR, FROM THE ROLLOUT AFTER THIS ONE.
const drainThenExit = (signal: NodeJS.Signals): void => {
  void (async () => {
    console.log(`${signal} received; draining in-flight requests and the alert poller before exit`);
    // AWAITED, BECAUSE `close()` ONLY STARTS THIS.
    const pollerStopped = alertPoller.stop().then(() => {
      // Said out loud, because "the poller stopped taking work" is the fact a deployer watching a
      // long shutdown needs and the exit line below cannot give them: it comes after both.
      console.log("alert poller stopped claiming alerts");
    });
    await Promise.all([
      new Promise<void>((drained) => {
        server.close(() => drained());
        server.closeIdleConnections();
      }),
      pollerStopped,
    ]);
    await Promise.all([alertPool.end(), pool.end()]);
    console.log("alert poller drained; exiting");
    process.exit(0);
  })();
};
process.once("SIGTERM", drainThenExit);
process.once("SIGINT", drainThenExit);
