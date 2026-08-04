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
