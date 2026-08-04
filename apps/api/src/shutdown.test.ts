// The drain DEPLOY.md's release order asks for, driven against the real process.
//
// Migration 014 backfills an attempt row for every already-failed email alert, and from then on
// every reader treats an alert with no attempt row as one nothing was ever handed over for. The
// runbook therefore has the deployer stop the old api before the new build applies it. Stopping is
// also the thing most likely to CREATE the send that record cannot see: kill the process after the
// provider accepts and before the row's transaction commits, and the alert stays `pending` — which
// the backfill does not touch, because it seeds only `failed` rows — so the new poller reads it as
// unattempted and can deliver it again once the provider's dedup window has closed.
//
// A runbook step the code cannot perform is worse than no step, because the deployer believes they
// performed it. So this drives the real bootstrap in a subprocess and sends it the signal a host
// sends: the process must stop the poller, wait for the tick in flight, and exit of its own accord.
// Asserting on the file's text would prove only that a handler is written somewhere.

import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { rulesFilePath } from "./ruleset";

const databaseUrl = process.env.DATABASE_URL ?? "";
const apiDirectory = fileURLToPath(new URL("..", import.meta.url));

/** Boot the api, wait until it is serving, then send `signal` and report how it went out. */
function bootThenSignal(signal: NodeJS.Signals): Promise<{
  code: number | null;
  signal: NodeJS.Signals | null;
  output: string;
}> {
  return new Promise((settle, fail) => {
    const child = spawn("npx", ["tsx", "src/index.ts"], {
      cwd: apiDirectory,
      env: {
        ...process.env,
        RULES_FILE: rulesFilePath(),
        DATABASE_URL: databaseUrl,
        PORT: "0",
      },
    });
    let output = "";
    let signalled = false;
    const readyOrDone = (chunk: Buffer): void => {
      output += chunk.toString();
      // The listen callback, which is also where the poller starts: signalling before it means
      // testing a shutdown with nothing to drain.
      if (!signalled && output.includes("listening on")) {
        signalled = true;
        child.kill(signal);
      }
    };
    child.stdout.on("data", readyOrDone);
    child.stderr.on("data", readyOrDone);
    child.on("error", fail);
    child.on("close", (code, closedBy) => settle({ code, signal: closedBy, output }));
  });
}

describe.runIf(databaseUrl.length > 0)("the api drains before it exits", () => {
  it("stops the alert poller and waits for the tick in flight on SIGTERM", async () => {
    const result = await bootThenSignal("SIGTERM");

    // Exited on its own rather than being torn down where it stood. A default-disposition SIGTERM
    // reports no exit code and the signal instead, which is the state that can strand a send.
    expect(result.signal).toBeNull();
    expect(result.code).toBe(0);
    expect(result.output).toMatch(/draining the alert poller/i);
  }, 90_000);

  it("drains on SIGINT too, which is what a local run and some hosts send", async () => {
    const result = await bootThenSignal("SIGINT");

    expect(result.signal).toBeNull();
    expect(result.code).toBe(0);
    expect(result.output).toMatch(/draining the alert poller/i);
  }, 90_000);
});
