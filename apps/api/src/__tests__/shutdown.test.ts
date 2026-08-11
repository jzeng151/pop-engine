import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { connect, createServer, type AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { rulesFilePath } from "../ruleset";

const databaseUrl = process.env.DATABASE_URL ?? "";
const repoRoot = fileURLToPath(new URL("../../../..", import.meta.url));

const GIVE_UP_MS = 60_000;

function deployedStartCommand(): string {
  const runbook = readFileSync(new URL("../../../../DEPLOY.md", import.meta.url), "utf8");
  const command = /-\s+\*\*api\*\*:\s+start command\s+`([^`]+)`/.exec(runbook)?.[1];
  if (command === undefined) {
    throw new Error("DEPLOY.md no longer publishes an api start command this suite can run");
  }
  return command;
}

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
      child.on("exit", (code, closedBy) => {
        clearTimeout(giveUp);
        setTimeout(killGroup, 100);
        settle({ code, signal: closedBy, output });
      });
    })();
  });
}

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

async function outputWhileARequestIsHeld(
  port: number,
  sendSignal: () => void,
  outputSoFar: () => string,
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

    expect(answer, result.output).toMatch(/^HTTP\/1\.1 \d{3}/);
    expect(result.signal, result.output).toBeNull();
    expect(result.code, result.output).toBe(0);
  }, 90_000);
});
