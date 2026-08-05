// The drain DEPLOY.md's release order asks for, driven against the process the host actually signals.
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
// sends: the process must stop accepting work, finish what it is holding, and exit of its own
// accord. Asserting on the file's text would prove only that a handler is written somewhere.
//
// AND IT DRIVES THE COMMAND THE RUNBOOK PUBLISHES, rather than one that resembles it. A drain is
// only reached by a process that receives the signal, so which process the host's SIGTERM lands on
// is part of the mechanism and not a deployment detail. A package runner in front of the api dies
// at its default disposition and leaves the api it started running, holding the inherited pipes:
// green in a test that spawns the api directly, no drain at all in production. The start command
// is therefore READ OUT OF `DEPLOY.md` and run through a shell exactly as the host runs it, so the
// runbook and this suite cannot drift apart — changing one without the other fails here.

import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { connect, createServer, type AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { rulesFilePath } from "./ruleset";

const databaseUrl = process.env.DATABASE_URL ?? "";
const repoRoot = fileURLToPath(new URL("../../..", import.meta.url));

/**
 * How long to let the api take before the test gives up on it and reports what it had.
 *
 * Inside the case timeout, so a shutdown that never completes fails as a shutdown that never
 * completed, with the process output attached, rather than as a bare "test timed out" naming
 * nothing. The first version of this file had no such bound and the CI failure it produced said
 * only that ninety seconds had passed.
 */
const GIVE_UP_MS = 60_000;

/**
 * The api start command as the runbook publishes it, which is the thing under test.
 *
 * Parsed rather than repeated, because a copy here would pass while the deployed command changed
 * underneath it, which is the exact failure this suite exists to catch.
 */
function deployedStartCommand(): string {
  const runbook = readFileSync(new URL("../../../DEPLOY.md", import.meta.url), "utf8");
  const command = /-\s+\*\*api\*\*:\s+start command\s+`([^`]+)`/.exec(runbook)?.[1];
  if (command === undefined) {
    throw new Error("DEPLOY.md no longer publishes an api start command this suite can run");
  }
  return command;
}

/** A port the api can have to itself, so the test can reach it while it is serving. */
function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.on("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address() as AddressInfo;
      probe.close(() => resolve(port));
    });
  });
}

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

type Shutdown = { code: number | null; signal: NodeJS.Signals | null; output: string };

/**
 * Boot the api the way the host does, wait until it is serving, then signal it and report how it
 * went out.
 *
 * `whileServing` straddles the signal: it is handed the port and the function that sends it, so a
 * case can have a request in flight at the moment the signal arrives.
 */
function bootThenSignal(
  signal: NodeJS.Signals,
  whileServing: (
    port: number,
    sendSignal: () => void,
    outputSoFar: () => string,
  ) => Promise<void> = async (_port, send) => send(),
): Promise<Shutdown> {
  return new Promise((settle, fail) => {
    void (async () => {
      const port = await freePort();
      // Through a shell, in its own process group, because that is the shape a host runs: the
      // command string is the container's entry process and the signal goes to it alone.
      const child = spawn("sh", ["-c", deployedStartCommand()], {
        cwd: repoRoot,
        detached: true,
        env: {
          ...process.env,
          RULES_FILE: rulesFilePath(),
          DATABASE_URL: databaseUrl,
          PORT: String(port),
        },
      });
      const killGroup = (): void => {
        if (child.pid === undefined) return;
        try {
          process.kill(-child.pid, "SIGKILL");
        } catch {
          // Already gone, which is the outcome this was asking for.
        }
      };
      let output = "";
      let signalled = false;
      const giveUp = setTimeout(() => {
        output += `\n[test] no exit ${GIVE_UP_MS}ms after boot; killing the process group\n`;
        killGroup();
      }, GIVE_UP_MS);
      const readyOrDone = (chunk: Buffer): void => {
        output += chunk.toString();
        // The listen callback, which is also where the poller starts: signalling before it means
        // testing a shutdown with nothing to drain.
        if (!signalled && output.includes("listening on")) {
          signalled = true;
          void whileServing(
            port,
            () => child.kill(signal),
            () => output,
          ).catch(fail);
        }
      };
      child.stdout.on("data", readyOrDone);
      child.stderr.on("data", readyOrDone);
      child.on("error", (error) => {
        clearTimeout(giveUp);
        fail(error);
      });
      // ON `exit` RATHER THAN `close`, because the defect this suite is for leaves a process alive
      // holding the inherited pipes. `close` waits for those pipes, so a runner that dies without
      // passing the signal on would report as a bare timeout naming nothing instead of as the
      // failed shutdown it is.
      child.on("exit", (code, closedBy) => {
        clearTimeout(giveUp);
        // Anything the command left behind goes with it, so one case cannot strand a port or a
        // database connection into the next.
        setTimeout(killGroup, 100);
        settle({ code, signal: closedBy, output });
      });
    })();
  });
}

/**
 * Hold one request open across the signal and report what the api answered.
 *
 * A DOCUMENT UPLOAD IS THE CASE THIS STANDS IN FOR. That request spends its long phase inside
 * `storage.put(...)` holding no database client, so ending the pools proves nothing about it: both
 * `end()` calls resolve immediately and an exit taken on them alone drops the organizer's upload
 * after the bytes were accepted and before the metadata was recorded. A body the test finishes
 * sending after the signal puts a request in exactly that state — accepted, unanswered, holding
 * nothing the pools know about — without needing a bucket.
 */
async function answerAcrossTheSignal(port: number, sendSignal: () => void): Promise<string> {
  const body = JSON.stringify({ still: "in flight" });
  const socket = connect(port, "127.0.0.1");
  await new Promise<void>((resolve, reject) => {
    socket.once("connect", resolve);
    socket.once("error", reject);
  });
  let answer = "";
  socket.on("data", (chunk: Buffer) => {
    answer += chunk.toString();
  });
  socket.write(
    `POST /health HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nContent-Type: application/json\r\n` +
      `Content-Length: ${body.length}\r\nConnection: close\r\n\r\n`,
  );
  // Headers only. The body parser is now waiting for the rest, which is what makes this a request
  // the server is holding rather than a socket sitting idle.
  socket.write(body.slice(0, 4));
  await delay(250);
  sendSignal();
  await delay(500);
  socket.write(body.slice(4));
  await new Promise<void>((resolve) => {
    socket.once("close", () => resolve());
    socket.once("error", () => resolve());
  });
  return answer;
}

/**
 * Hold one request open across the signal and report what the process had printed while it was
 * still holding it.
 *
 * The same shape as `answerAcrossTheSignal`, asking the other question: not whether the request is
 * answered, but what the shutdown got on with while it waited. The poller's stop is the work that
 * must not be queued behind an organizer's slow upload, because until it lands the interval keeps
 * claiming alerts and starting provider sends after SIGTERM — and a host that eventually gives up
 * on a long shutdown kills one of those mid-transaction, which is the unrecorded attempt this whole
 * branch exists to prevent.
 */
async function outputWhileARequestIsHeld(
  port: number,
  sendSignal: () => void,
  outputSoFar: () => string,
  // Reported as it is read rather than returned, because the process exits once the request is
  // let go and `bootThenSignal` settles on that exit, which can be before this function returns.
  report: (printedWhileHeld: string) => void,
): Promise<void> {
  const body = JSON.stringify({ still: "in flight" });
  const socket = connect(port, "127.0.0.1");
  await new Promise<void>((resolve, reject) => {
    socket.once("connect", resolve);
    socket.once("error", reject);
  });
  socket.write(
    `POST /health HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nContent-Type: application/json\r\n` +
      `Content-Length: ${body.length}\r\nConnection: close\r\n\r\n`,
  );
  socket.write(body.slice(0, 4));
  await delay(250);
  sendSignal();
  // Long enough for a shutdown that stops the poller first to have said so, and short enough that
  // this is still the same request the server is holding.
  await delay(3_000);
  report(outputSoFar());
  socket.write(body.slice(4));
  await new Promise<void>((resolve) => {
    socket.once("close", () => resolve());
    socket.once("error", () => resolve());
  });
}

describe.runIf(databaseUrl.length > 0)("the api drains before it exits", () => {
  it("stops the alert poller and waits for the tick in flight on SIGTERM", async () => {
    const result = await bootThenSignal("SIGTERM");

    // Exited on its own rather than being torn down where it stood. A default-disposition SIGTERM
    // reports no exit code and the signal instead, which is the state that can strand a send.
    // The output rides along on the failure so a bad shutdown says what the process did.
    expect(result.signal, result.output).toBeNull();
    expect(result.code, result.output).toBe(0);
    expect(result.output).toMatch(/draining/i);
    expect(result.output).toMatch(/alert poller drained; exiting/i);
  }, 90_000);

  it("drains on SIGINT too, which is what a local run and some hosts send", async () => {
    const result = await bootThenSignal("SIGINT");

    expect(result.signal, result.output).toBeNull();
    expect(result.code, result.output).toBe(0);
    expect(result.output).toMatch(/draining/i);
    expect(result.output).toMatch(/alert poller drained; exiting/i);
  }, 90_000);

  it("stops claiming alerts without waiting for a slow request to finish", async () => {
    // THE POLLER'S STOP IS NOT QUEUED BEHIND THE HTTP DRAIN. Both are shutdown work and neither
    // depends on the other, but ordered one after the other the poller keeps its interval running
    // for as long as the slowest request takes: it goes on claiming alerts and handing them to a
    // provider after the host has already asked the process to go. The host's patience is finite,
    // and what it eventually kills is a send that started after SIGTERM, mid-transaction, leaving
    // exactly the unrecorded attempt this branch is about.
    let printedWhileHeld = "";
    const result = await bootThenSignal("SIGTERM", async (port, sendSignal, outputSoFar) => {
      await outputWhileARequestIsHeld(port, sendSignal, outputSoFar, (printed) => {
        printedWhileHeld = printed;
      });
    });

    expect(printedWhileHeld, result.output).toMatch(/alert poller stopped claiming alerts/i);
    expect(result.signal, result.output).toBeNull();
    expect(result.code, result.output).toBe(0);
  }, 90_000);

  it("answers a request that was in flight when the signal arrived", async () => {
    let answer = "";
    const result = await bootThenSignal("SIGTERM", async (port, sendSignal) => {
      answer = await answerAcrossTheSignal(port, sendSignal);
    });

    // The organizer's request got a reply rather than a dropped socket. Which reply does not
    // matter — `POST /health` is not a route — only that the process stayed to give one.
    expect(answer, result.output).toMatch(/^HTTP\/1\.1 \d{3}/);
    expect(result.signal, result.output).toBeNull();
    expect(result.code, result.output).toBe(0);
  }, 90_000);
});
