import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { PROVIDER_DEDUP_WINDOW_HOURS } from "./alerts";

// F-203 issue #166. Two of this feature's guarantees are not properties of the code alone: they
// hold only while the two services and the migration are rolled out in a particular order, and
// `docs/ARCHITECTURE.md` deploys web and api independently. Nothing in this repository can force
// that order, because there is no deployment automation here and the process that has to be
// stopped is running the PREVIOUS build, which no code in this one can reach. What can be
// guaranteed is that the constraint stays written where the person doing the rollout works, next
// to the step it constrains, for as long as the code depends on it.
//
// So each case below asks the same two questions in the same order: does the code still rest on
// this constraint, and if it does, does the runbook still state it. A mechanism that is removed
// takes its runbook step with it and this suite stops asking; a mechanism that is kept while the
// step is deleted fails here rather than silently in a rollout.
//
// String matching rather than parsing, because the assertion is about a human instruction being
// present and legible, not about a machine-readable format that would then need its own contract.

const repoFile = (relativePath: string): string =>
  fileURLToPath(new URL(`../../../${relativePath}`, import.meta.url));

const read = (relativePath: string): string => readFileSync(repoFile(relativePath), "utf8");

const runbook = read("DEPLOY.md");
/** The runbook's own release-order section, so a mention somewhere else does not satisfy this. */
const releaseOrder = runbook.slice(runbook.indexOf("### Release order"));

describe("F-203 rollout constraints the runbook has to carry", () => {
  it("tells a deployer to stop the running api before migration 014's backfill lands", () => {
    // WHY THE CODE NEEDS THIS. Migration 014 seeds one attempt row per already-failed email alert
    // and, from then on, every reader treats the absence of an attempt row as proof that nothing
    // was ever handed to a provider. That reading is only true if no process that predates the
    // table is still sending: an old api answering a poll a second after the backfill commits
    // writes exactly the row the backfill exists to prevent, and no later sweep would find it.
    const migration = read("apps/api/migrations/014_alert_send_attempts.ts");
    expect(migration).toContain("INSERT INTO alert_send_attempts");
    expect(read("apps/api/src/alerts.ts")).toContain("FROM alert_send_attempts AS attempt");

    expect(releaseOrder).toContain("alert_send_attempts");
    // Whitespace-tolerant: the runbook wraps its prose, so the sentence can carry a line break
    // anywhere in it and still be the sentence a deployer reads.
    expect(releaseOrder.replace(/\s+/g, " ")).toMatch(
      /no api process from the previous build is still running/i,
    );
  });

  it("names a drain the api can actually perform", () => {
    // THE OTHER DIRECTION OF THE SAME PAIRING. The two cases either side of this one ask whether
    // the runbook still states a constraint the code rests on. This one asks whether the code still
    // performs an action the runbook instructs, which is the failure that is worse than a missing
    // step: a deployer who reads "let it drain" and scales the service to zero believes they
    // drained it, and a process killed between the provider accepting and the row committing
    // leaves the `pending` alert migration 014's backfill does not cover. Whether the drain WORKS
    // is `shutdown.test.ts`, which signals the real process; this keeps the instruction and the
    // mechanism from drifting apart, and names the signal so the deployer can send it by hand.
    const bootstrap = read("apps/api/src/index.ts");
    expect(bootstrap).toContain('process.once("SIGTERM"');
    // Called, and awaited before the exit ALONGSIDE the HTTP drain rather than behind it. A stop
    // nobody waits for is the same missing drain; a stop queued behind the last request keeps the
    // interval claiming alerts and starting sends after the signal, which is how a host that gives
    // up on a long shutdown kills one of them mid-transaction. `shutdown.test.ts` drives both
    // properties against the real process; this keeps the runbook's instruction and the mechanism
    // it names from drifting apart.
    expect(bootstrap).toContain("alertPoller.stop()");
    expect(bootstrap).toMatch(/await Promise\.all\(\[[\s\S]*pollerStopped[\s\S]*\]\)/);

    expect(releaseOrder).toContain("SIGTERM");
  });

  it("does not ask the previous build for a drain that ships with this one", () => {
    // THE STEP AND THE RELEASE IT IS WRITTEN FOR. The case above pairs the drain in `index.ts`
    // with the runbook line that names it, and both are right, from the NEXT rollout on. The api
    // step 2 has a deployer stop is running the PREVIOUS build, and on this one release that build
    // predates the handler entirely: it has no drain, it dies where it stands, and a deployer
    // waiting for `alert poller drained; exiting` from it is waiting for a line nothing will
    // print. An instruction that cannot be carried out is worse than a missing one, because the
    // deployer believes they carried it out.
    //
    // SO THE RUNBOOK HAS TO NAME WHAT ACTUALLY MAKES THIS WINDOW SAFE, and it is not the drain. A
    // send the old build was killed in the middle of is left `pending` with no attempt row, so the
    // new poller reads it as due and retries it, carrying the SAME key to the provider, which
    // deduplicates it for `PROVIDER_DEDUP_WINDOW_HOURS`. Inside that window the retry is the same
    // delivery; outside it, it is a second copy of the reminder. That makes the bound on this
    // rollout a real number a deployer can work to, and it is the number this file pins.
    expect(read("apps/api/src/alerts.ts")).toContain("idempotencyKey: providerKey(row)");

    const prose = releaseOrder.replace(/\s+/g, " ");
    expect(prose).toMatch(/predates (this|that|the) (drain|handler)/i);
    expect(prose).toMatch(new RegExp(`${PROVIDER_DEDUP_WINDOW_HOURS}[- ]?hour`, "i"));
  });

  it("anchors the pre-migration hold to when the old api stopped", () => {
    // WHAT "COMPLETE THE ROLLOUT INSIDE 24 HOURS" DOES NOT BOUND. The window this step protects
    // starts when the old build handed a message to Resend, and the only thing the new build can
    // stamp is when IT tried. A send accepted at T whose transaction never committed is left
    // `pending` with no attempt row (migration 014's backfill covers `failed` rows only), so the
    // new poller retries it and stamps an attempt at T+delta. The hold is measured from that stamp,
    // so an outage that runs past T+24h and recovers before T+delta+24h reads as retryable when
    // Resend has already forgotten the key, and the organizer gets the reminder twice. Finishing
    // the deployment quickly makes delta small; it does not put the retry inside the original
    // send's window, because nothing here controls when the provider comes back.
    //
    // SO THE RUNBOOK HAS TO NAME THE ANCHOR AND AN ACTION THAT SETS IT. The latest moment any
    // pre-migration send can have reached the provider is the moment the old process was gone, and
    // the mechanism that turns that into behavior already exists: an unresolved attempt stamped at
    // that moment makes the alert freely retryable for one dedup window after it and held rather
    // than duplicated afterwards. That is a statement a deployer runs and a count they can check,
    // which is what this case pins.
    const alerts = read("apps/api/src/alerts.ts");
    // The hold is measured from the OLDEST unresolved attempt, which is what makes a stamped row
    // move the bound rather than be ignored behind a newer retry's own attempt.
    expect(alerts).toContain("min(attempt.attempted_at)");
    // And the population the backfill leaves uncovered, which is what the stamp is for.
    expect(read("apps/api/migrations/014_alert_send_attempts.ts")).toContain(
      "WHERE status = 'failed'",
    );

    const prose = releaseOrder.replace(/\s+/g, " ");
    // Named, so the deployer records it rather than inferring it from the deployment's duration.
    expect(releaseOrder).toContain("T_stop");
    // Performable: the statement that sets the anchor is written out, not described.
    expect(releaseOrder).toContain("INSERT INTO alert_send_attempts");
    // Verifiable: re-running it is the check, so the deployer can tell it landed.
    expect(prose).toMatch(/INSERT 0 0/);
    // And the claim that does not hold is gone rather than sitting beside the one that does.
    expect(prose).not.toMatch(/complete the rollout well inside 24 hours/i);
  });

  it("describes the attempt row as an intent rather than a completed handoff", () => {
    // THE FOURTH CORRECTION OF ONE CLAIM, which is why it is pinned rather than only fixed again.
    // The row is written BEFORE `sender(...)` is called and on its own connection, so a process
    // that dies in between leaves exactly what one that died mid-send leaves: an attempt whose
    // handoff is possible and not certain. The organizer's notice, the tick's telemetry and the
    // hold log each had the stronger reading taken back out of them; the authoritative schema
    // section still defined the row as proof the alert "was handed" over and dated it "at the
    // moment of the handoff", which is the description every future implementation reads first.
    //
    // ASSERTED AS THE ABSENCE OF THE OVERCLAIM rather than as a phrasing, because what must not
    // return is the certainty, not a particular sentence. The section may say whatever it likes
    // about an attempted send.
    expect(read("apps/api/src/alerts.ts")).toContain("Record that this alert is ABOUT to be handed");

    const architecture = read("docs/ARCHITECTURE.md");
    const schemaSection = architecture.slice(
      architecture.indexOf("### alert_send_attempts"),
      architecture.indexOf("### event_alert_contacts"),
    );
    const prose = schemaSection.replace(/\s+/g, " ");
    expect(prose).not.toBe("");
    expect(prose).not.toMatch(/(was|were) handed to a provider/i);
    expect(prose).not.toMatch(/at the moment of the handoff/i);
    // The migration's own header is the other place a reader meets this table first.
    expect(read("apps/api/migrations/014_alert_send_attempts.ts").replace(/\s+/g, " ")).not.toMatch(
      /PopEngine handed an alert to a provider/i,
    );
  });

  it("describes the hold as bounded and released from the first unresolved attempt", () => {
    // THE FIFTH CORRECTION OF THE SAME SHAPE, after the organizer's notice, the tick's telemetry,
    // the schema contract and the hold log: an authoritative artifact left saying what the system
    // used to do. The product owner bounded the hold on 2026-08-04, and the schema section still
    // said an unsuperseded attempt would hold a revived alert out of every scan permanently, which
    // is the description a contributor reads first and is required to implement against.
    //
    // PINNED AS THE TWO CLAIMS THE BOUND CONSISTS OF, not as a phrasing: the section may say what
    // it likes about the hold as long as it names the limit and says the release is measured from
    // the oldest unresolved attempt rather than the newest. The second is what stops an outage
    // extending suppression past the approved 48 hours, and it is the half a reader would drop.
    expect(read("apps/api/src/alerts.ts")).toContain("UNRESOLVED_ATTEMPT_HOLD_LIMIT_HOURS");

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
    // THE SIXTH AND SEVENTH CORRECTIONS OF ONE MECHANISM, pinned across BOTH artifacts because
    // fixing one at a time is what produced seven of them. `docs/BASELINE.md` is the entry point a
    // contributor is required to read first (AGENTS.md), so a row there saying the table records
    // an alert that "was handed to a provider" is an implementation input asserting the one thing
    // this side cannot know — and reconciliation built on it would treat an intent as provider-side
    // proof.
    //
    // AND SUPERSESSION HAS TWO CAUSES, which is the other half. A revival sets `superseded_at`,
    // and so does a retry made after the hold bound, on an alert nobody cancelled and whose
    // schedule never ended. An artifact naming only the first tells tooling that every superseded
    // attempt is evidence of a withdrawn schedule, which misclassifies every retry-overtaken row.
    //
    // ASSERTED AS THE ABSENCE OF THE OVERCLAIM AND THE PRESENCE OF THE SECOND CAUSE, not as a
    // phrasing: either artifact may say what it likes as long as it does not assert the handoff
    // and does not present revival as the only way the column is set.
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
    // The migration's own column note is the third place a reader meets this column.
    expect(read("apps/api/migrations/014_alert_send_attempts.ts").replace(/\s+/g, " ")).toMatch(
      /two causes/i,
    );
  });

  it("tells a deployer to deploy web before the api for the reconciliation notice", () => {
    // WHY THE CODE NEEDS THIS. The api stops counting a reconciliation-held alert among the
    // failures (the failure notice promises retries that have ended for it) and reports it under
    // `alertsHeldForReconciliation` instead. A web build that predates that field renders neither, so an alert the poller has permanently stopped on has NO organizer-facing warning
    // for the length of an api-first rollout. Deployed the other way round the window is empty:
    // this build's reader already treats the field as absent-means-none against an api that does
    // not send it yet, which is the case its own suite pins.
    expect(read("apps/api/src/checklist.ts")).toContain("alertsHeldForReconciliation");
    expect(read("apps/web/app/checklist/checklist-api.ts")).toContain("withRolloutDefaults");

    expect(releaseOrder).toContain("alertsHeldForReconciliation");
    expect(releaseOrder).toMatch(/web (service )?(first|before)/i);
  });
});
