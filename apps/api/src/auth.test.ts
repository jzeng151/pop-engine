import { afterEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { Pool } from "pg";
import { parseIntakeContract } from "@pop-engine/engine";

const createClient = vi.hoisted(() => vi.fn());
vi.mock("@supabase/supabase-js", () => ({ createClient }));

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

const settingsUrl = new URL("https://project.supabase.co/auth/v1/settings");
const settingsResponse = (settings: unknown, status = 200) =>
  new Response(JSON.stringify(settings), {
    status,
    headers: { "Content-Type": "application/json" },
  });

afterEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

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

  it.each(["https://<project-ref>.supabase.co", "ftp://project.supabase.co"])(
    "keeps the API available when the provider URL is invalid: %s",
    async (url) => {
      const verifyAccessToken = supabaseAccessTokenVerifier({
        SUPABASE_URL: url,
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
    },
  );

  it("uses the provider claims verifier and ignores failed claims", async () => {
    const getClaims = vi
      .fn()
      .mockResolvedValueOnce({
        data: { claims: { sub: "actor-2", email: "verified@example.com" } },
        error: null,
      })
      .mockResolvedValueOnce({ data: null, error: new Error("bad token") });
    const fetchSettings = vi
      .fn<typeof fetch>()
      .mockResolvedValue(settingsResponse({ mailer_autoconfirm: false }));
    const verify = createAccessTokenVerifier(
      { auth: { getClaims } },
      settingsUrl,
      "sb_publishable_placeholder",
      fetchSettings,
    );

    await expect(verify("valid")).resolves.toEqual({
      id: "actor-2",
      email: "verified@example.com",
    });
    await expect(verify("invalid")).resolves.toBeNull();
    expect(fetchSettings).toHaveBeenCalledOnce();
    expect(fetchSettings).toHaveBeenCalledWith(settingsUrl, {
      headers: {
        apikey: "sb_publishable_placeholder",
        "Cache-Control": "no-store",
      },
    });
  });

  it("detects mailer autoconfirm drift in the production bearer verifier", async () => {
    const getClaims = vi.fn().mockResolvedValue({
      data: { claims: { sub: "actor-2", email: "verified@example.com" } },
      error: null,
    });
    const fetchSettings = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(settingsResponse({ mailer_autoconfirm: false }))
      .mockResolvedValueOnce(settingsResponse({ mailer_autoconfirm: true }));
    createClient.mockReturnValue({ auth: { getClaims } });
    vi.stubGlobal("fetch", fetchSettings);
    const verify = supabaseAccessTokenVerifier({
      SUPABASE_URL: "https://project.supabase.co",
      SUPABASE_PUBLISHABLE_KEY: "sb_publishable_placeholder",
    });

    expect(verify).not.toBeNull();

    await expect(verify?.("verified")).resolves.toEqual({
      id: "actor-2",
      email: "verified@example.com",
    });
    await expect(verify?.("direct-signup")).resolves.toBeNull();
    expect(fetchSettings).toHaveBeenCalledTimes(2);
  });

  it("rejects identity when provider settings are malformed or unavailable", async () => {
    const getClaims = vi.fn().mockResolvedValue({
      data: { claims: { sub: "actor-2" } },
      error: null,
    });
    const fetchSettings = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(settingsResponse({}))
      .mockResolvedValueOnce(settingsResponse({}, 503))
      .mockRejectedValueOnce(new Error("provider unavailable"));
    const verify = createAccessTokenVerifier(
      { auth: { getClaims } },
      settingsUrl,
      "sb_publishable_placeholder",
      fetchSettings,
    );

    await expect(verify("malformed-settings")).resolves.toBeNull();
    await expect(verify("failed-settings")).resolves.toBeNull();
    await expect(verify("unavailable-settings")).resolves.toBeNull();
  });

  it("keeps public routes available when settings verification fails", async () => {
    const getClaims = vi.fn().mockResolvedValue({
      data: { claims: { sub: "actor-2" } },
      error: null,
    });
    const verifyAccessToken = createAccessTokenVerifier(
      { auth: { getClaims } },
      settingsUrl,
      "sb_publishable_placeholder",
      vi.fn<typeof fetch>().mockRejectedValue(new Error("provider unavailable")),
    );
    const app = createApp({ ...baseDependencies, verifyAccessToken });

    const [session, publicRoute] = await Promise.all([
      request(app).get("/api/session").set("Authorization", "Bearer signed.jwt.value"),
      request(app).post("/api/events/not-a-uuid/rsvps").send({}),
    ]);

    expect(session.status).toBe(401);
    expect(publicRoute.status).toBe(400);
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
