import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

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
