import { afterEach, describe, expect, it } from "vitest";
import request from "supertest";
import { Pool } from "pg";
import { parseIntakeContract } from "@pop-engine/engine";
import { createApp } from "./app";
import { todayInJurisdiction } from "./calendar";
import { loadRuleset } from "./ruleset";

// The scaffold routes need the app's dependencies but never reach them: the pool is
// constructed lazily by pg and opens no connection until a query runs.
const dependencies = {
  database: new Pool({ connectionString: "postgresql://unused" }),
  intakeContract: parseIntakeContract((await loadRuleset()).document),
  // The api has one clock, wired at boot from the jurisdiction the ruleset declares
  // (index.ts). These routes never read it; it is here because the events routes need it.
  today: () => todayInJurisdiction("US-NY-NYC"),
};
const createScaffoldApp = () => createApp(dependencies);

describe("api scaffold", () => {
  afterEach(() => {
    delete process.env.WEB_ORIGIN;
  });

  it("GET /health returns ok and resolves the engine package", async () => {
    const res = await request(createScaffoldApp()).get("/health");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      status: "ok",
      service: "pop-engine-api",
      engine: "pop-engine-engine ready",
    });
  });

  it("allows the configured web origin on browser requests", async () => {
    process.env.WEB_ORIGIN = "https://web.example.com";
    const res = await request(createScaffoldApp()).get("/health");
    expect(res.headers["access-control-allow-origin"]).toBe("https://web.example.com");
    expect(res.headers["access-control-allow-credentials"]).toBe("true");
  });

  it("defaults the allowed origin to the local web dev server", async () => {
    const res = await request(createScaffoldApp()).get("/health");
    expect(res.headers["access-control-allow-origin"]).toBe("http://localhost:3000");
  });

  it("answers preflight requests", async () => {
    const res = await request(createScaffoldApp()).options("/health");
    expect(res.status).toBe(204);
    expect(res.headers["access-control-allow-methods"]).toContain("POST");
    // X-Filename carries a document upload's display name and X-Upload-Key its idempotency key
    // (F-202); a header the allowlist omits fails the browser's preflight before any route runs,
    // and a dropped upload key silently turns every repeat back into a second document.
    expect(res.headers["access-control-allow-headers"]).toBe(
      "Authorization, Content-Type, X-Filename, X-Upload-Key",
    );
  });
});
