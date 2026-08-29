import { afterEach, describe, expect, it } from "vitest";
import request from "supertest";
import { Pool } from "pg";
import { parseIntakeContract } from "@pop-engine/engine";
import { createApp } from "./app";
import { todayInJurisdiction } from "./calendar";
import { loadRuleset } from "./ruleset";

const dependencies = {
  database: new Pool({ connectionString: "postgresql://unused" }),
  intakeContract: parseIntakeContract((await loadRuleset()).document),

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

    expect(res.headers["access-control-allow-headers"]).toBe(
      "Authorization, Content-Type, Idempotency-Key, X-Filename, X-Upload-Key",
    );
  });

  it("returns a safe JSON error for malformed JSON", async () => {
    const response = await request(createScaffoldApp())
      .post("/api/events")
      .set("Content-Type", "application/json")
      .send('{"name":');

    expect(response.status).toBe(400);
    expect(response.headers["content-type"]).toMatch(/^application\/json/);
    expect(response.body).toEqual({ error: "body must be valid JSON" });
    expect(JSON.stringify(response.body)).not.toMatch(/syntax|stack|unexpected|apps\/api/i);
  });

  it("keeps the request-too-large status and returns JSON", async () => {
    const response = await request(createScaffoldApp())
      .post("/api/events")
      .set("Content-Type", "application/json")
      .send({ name: "x".repeat(101 * 1024) });

    expect(response.status).toBe(413);
    expect(response.headers["content-type"]).toMatch(/^application\/json/);
    expect(response.body).toEqual({ error: "request body is too large" });
    expect(JSON.stringify(response.body)).not.toMatch(/entity|limit|stack|apps\/api/i);
  });

  it("keeps unsupported request encodings as a JSON client error", async () => {
    const response = await request(createScaffoldApp())
      .post("/api/events")
      .set("Content-Type", "application/json")
      .set("Content-Encoding", "unsupported")
      .send("{}");

    expect(response.status).toBe(415);
    expect(response.headers["content-type"]).toMatch(/^application\/json/);
    expect(response.body).toEqual({ error: "request body is invalid" });
    expect(JSON.stringify(response.body)).not.toMatch(/encoding|stack|apps\/api/i);
  });

  it.each(["gzip", "deflate"])(
    "keeps corrupt %s request bodies as JSON client errors",
    async (encoding) => {
      const response = await request(createScaffoldApp())
        .post("/api/events")
        .set("Content-Type", "application/json")
        .set("Content-Encoding", encoding)
        .send(Buffer.from("not compressed JSON"));

      expect(response.status).toBe(400);
      expect(response.headers["content-type"]).toMatch(/^application\/json/);
      expect(response.body).toEqual({ error: "request body is invalid" });
      expect(JSON.stringify(response.body)).not.toMatch(
        /compression|header|stack|z_data|apps\/api/i,
      );
    },
  );
});
