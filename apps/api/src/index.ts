import { readFile } from "node:fs/promises";
import { Client, Pool } from "pg";
import { parseEngineRuleset, parseIntakeContract } from "@pop-engine/engine";
import { sendersFromEnv } from "./alert-delivery";
import { ALERT_POLLER_CONNECTIONS, createAlertPoller, createAlertScheduler } from "./alerts";
import { createApp } from "./app";
import { holidayCalendarWarning, pinnedCalendar, todayInJurisdiction } from "./calendar";
import { createPlanService } from "./plan";
import { deadlineReminderOffsets, loadRuleset, rulesFilePath, syncPermitRules } from "./ruleset";
import {
  createS3DocumentStorage,
  s3ClientFor,
  s3SettingsFromEnv,
  unconfiguredDocumentStorage,
} from "./storage";
import { supabaseAccessTokenVerifier } from "./auth";

// Long-lived process (ARCHITECTURE.md AD-1). This server also hosts the in-process
// 60s alert poller once F-203 (issue #8) lands, which is why the api must stay on an
// always-on host and cannot go serverless.
const PORT = Number(process.env.PORT ?? 3001);

const ruleset = await loadRuleset();
// The engine reads the same published file the boot validator just checked (AD-2), and it runs
// BEFORE anything is written. The engine's parser is where scoping cycles and asked_when operands
// are validated, so parsing after the sync would let a malformed artifact delete and reseed
// permit_rules and only then abort: loud for the deploying process, silent for every other api
// instance still reading the read model it just replaced.
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

// One clock for the whole api: an intake date and a plan deadline are both calendar days
// in the jurisdiction the ruleset declares, so both read the day from the same function
// rather than each deciding what "today" means.
const today = () => todayInJurisdiction(engineRuleset.jurisdiction);
const planService = createPlanService(pool, engineRuleset, pinnedCalendar, today);

// Plans still generate without a published holiday list; the business-day lines in them do not
// get dates. Operators should know that before an organizer asks why.
const calendarWarning = holidayCalendarWarning(pinnedCalendar(engineRuleset.calendarId));
if (calendarWarning !== null) console.warn(calendarWarning);

// The bucket is optional at boot so the api still runs against a bare local database
// (DEPLOY.md: the scaffold needs no cloud accounts). Without it the upload and download routes
// answer 503 rather than accepting a document nowhere stores.
const s3Settings = s3SettingsFromEnv(process.env);
if (s3Settings === null) {
  console.warn("S3_* is not configured; F-202 document upload and download will return 503");
}
const documentStorage =
  s3Settings === null
    ? unconfiguredDocumentStorage()
    : createS3DocumentStorage(s3ClientFor(s3Settings), s3Settings.bucket);

// F-203. Email sends live when Resend is configured and fails loudly when it is not; SMS is the
// labeled in-product simulation until an A2P 10DLC approval date is recorded (BASELINE.md,
// OPEN-QUESTIONS T-1). The offsets come from the ruleset the boot validator just checked.
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
// A pool of the poller's own, because a send holds its connection for as long as the provider
// takes and the API must not be competing for what is left. Sized to the concurrency the poller
// actually runs at, plus one for the scan that picks the batch. Sharing the API's ten connections
// was what pinned that concurrency low enough to miss AC 2's delivery bound during an outage.
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
  checklist: { database: pool, storage: documentStorage, scheduleAlerts },
  alerts: { jurisdiction: engineRuleset.jurisdiction, database: pool, senders },
  rulesMeta: { rulesetVersion: ruleset.rulesetVersion, snapshotDate: ruleset.snapshotDate },
  ...(verifyAccessToken ? { verifyAccessToken } : {}),
}).listen(PORT, () => {
  console.log(`pop-engine-api listening on :${PORT}`);
  // In-process, in the long-lived api (AD-1/AD-4): no queue, no second service.
  alertPoller.start();
});

// THE DRAIN DEPLOY.md'S RELEASE ORDER ASKS FOR, FROM THE ROLLOUT AFTER THIS ONE. The runbook has
// the deployer stop the running api before the next build applies migration 014, because a send
// from a build that predates `alert_send_attempts` writes no attempt row and the backfill is a
// point-in-time sweep that cannot reach it. Stopping is also the moment most likely to produce such
// a send: killed between the provider accepting and the row's transaction committing, the alert
// stays `pending`, the backfill seeds only `failed` rows, and the new poller reads it as never
// attempted and can deliver it a second time once the provider's dedup window has closed.
//
// WHICH THIS HANDLER CANNOT PREVENT ON THE RELEASE THAT INTRODUCES IT, and saying so is the point.
// The process the runbook has stopped is running the PREVIOUS build. On this release that build
// predates this handler, so it has no drain to perform and no line to print, and a step telling a
// deployer to wait for one would be a step they believe they carried out. DEPLOY.md's release
// order says so and names what covers that one window instead: the stranded send is retried by the
// new poller under the same `Idempotency-Key`, which the provider deduplicates for 24 hours, so
// the rollout has to finish inside them. From the next rollout on, the process being stopped is
// one that ran this file, and this is what carries the instruction out.
//
// Stop taking new work, let the tick in flight finish recording what it did, and only then go.
// Nothing here retries or forces anything: `stop()` settles because a send is bounded by the
// provider timeout.
//
// SIGINT as well as SIGTERM: a host stopping the service sends SIGTERM and a local run sends
// SIGINT, and an alert mid-send does not care which arrived.
const drainThenExit = (signal: NodeJS.Signals): void => {
  void (async () => {
    console.log(`${signal} received; draining the alert poller before exit`);
    // New requests stop here; the poller's own work is what the await below is for.
    server.close();
    await alertPoller.stop();
    await Promise.all([alertPool.end(), pool.end()]);
    console.log("alert poller drained; exiting");
    process.exit(0);
  })();
};
process.once("SIGTERM", drainThenExit);
process.once("SIGINT", drainThenExit);
