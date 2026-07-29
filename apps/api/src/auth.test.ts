import { afterEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { Pool } from "pg";
import { parseIntakeContract } from "@pop-engine/engine";
import { createApp } from "./app";
import {
  createAccessTokenVerifier,
  supabaseAccessTokenVerifier,
  type VerifyAccessToken,
} from "./auth";
import { loadRuleset } from "./ruleset";

const baseDependencies = {
  database: new Pool({ connectionString: "postgresql://unused" }),
  intakeContract: parseIntakeContract((await loadRuleset()).document),
  today: () => "2026-07-28",
};

afterEach(() => vi.restoreAllMocks());

describe("Supabase bearer authentication", () => {
  it("resolves a verified Supabase subject without exposing its token", async () => {
    const verifyAccessToken: VerifyAccessToken = vi
      .fn()
      .mockResolvedValue({ id: "actor-1", email: "person@example.com" });
    const app = createApp({ ...baseDependencies, verifyAccessToken });

    const response = await request(app)
      .get("/api/session")
      .set("Authorization", "Bearer signed.jwt.value");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      actor: { id: "actor-1", email: "person@example.com" },
    });
    expect(response.text).not.toContain("signed.jwt.value");
    expect(verifyAccessToken).toHaveBeenCalledWith("signed.jwt.value");
  });

  it.each([
    ["missing", undefined],
    ["malformed", "Basic credentials"],
    ["whitespace", "Bearer token with spaces"],
  ])("rejects a %s bearer credential", async (_name, authorization) => {
    const verifyAccessToken: VerifyAccessToken = vi.fn();
    const app = createApp({ ...baseDependencies, verifyAccessToken });
    const call = request(app).get("/api/session");
    if (authorization) call.set("Authorization", authorization);

    const response = await call;

    expect(response.status).toBe(401);
    expect(response.headers["www-authenticate"]).toContain("Bearer");
    expect(verifyAccessToken).not.toHaveBeenCalled();
  });

  it("fails closed when Supabase rejects or cannot verify a token", async () => {
    const app = createApp({
      ...baseDependencies,
      verifyAccessToken: vi.fn().mockResolvedValue(null),
    });
    const response = await request(app)
      .get("/api/session")
      .set("Authorization", "Bearer expired.jwt.value");

    expect(response.status).toBe(401);
    expect(response.body.error).toMatch(/invalid or expired/i);
  });

  it("returns a clear state when provider configuration is absent", async () => {
    expect(supabaseAccessTokenVerifier({})).toBeNull();
    const response = await request(createApp(baseDependencies)).get("/api/session");
    expect(response.status).toBe(503);
    expect(response.body.error).toMatch(/not configured/i);
  });

  it("keeps the API available when the provider URL is malformed", async () => {
    const verifyAccessToken = supabaseAccessTokenVerifier({
      SUPABASE_URL: "https://<project-ref>.supabase.co",
      SUPABASE_PUBLISHABLE_KEY: "sb_publishable_placeholder",
    });
    expect(verifyAccessToken).toBeNull();

    const app = createApp(baseDependencies);
    const [session, publicRoute] = await Promise.all([
      request(app).get("/api/session"),
      request(app).post("/api/events/not-a-uuid/rsvps").send({}),
    ]);

    expect(session.status).toBe(503);
    expect(publicRoute.status).toBe(400);
  });

  it("uses the provider claims verifier and ignores failed claims", async () => {
    const getClaims = vi
      .fn()
      .mockResolvedValueOnce({
        data: { claims: { sub: "actor-2", email: "verified@example.com" } },
        error: null,
      })
      .mockResolvedValueOnce({ data: null, error: new Error("bad token") });
    const verify = createAccessTokenVerifier({ auth: { getClaims } });

    await expect(verify("valid")).resolves.toEqual({
      id: "actor-2",
      email: "verified@example.com",
    });
    await expect(verify("invalid")).resolves.toBeNull();
  });

  it("does not apply the auth boundary to public RSVP or check-in routes", async () => {
    const verifyAccessToken: VerifyAccessToken = vi.fn().mockResolvedValue(null);
    const app = createApp({ ...baseDependencies, verifyAccessToken });

    const [rsvp, checkin] = await Promise.all([
      request(app).post("/api/events/not-a-uuid/rsvps").send({}),
      request(app).post("/api/events/not-a-uuid/checkins").send({}),
    ]);

    expect(rsvp.status).toBe(400);
    expect(checkin.status).toBe(400);
    expect(verifyAccessToken).not.toHaveBeenCalled();
  });
});
