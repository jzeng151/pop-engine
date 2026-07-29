import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createServerSupabaseClient: vi.fn(),
  redirect: vi.fn((target: string) => {
    throw new Error(`redirect:${target}`);
  }),
  siteUrl: vi.fn<() => string | null>(() => "https://web.example.com"),
  supabaseBrowserConfig: vi.fn(() => ({
    url: "https://project.supabase.co",
    publishableKey: "sb_publishable_placeholder",
  })),
}));

vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("../../lib/supabase/server", () => ({
  createServerSupabaseClient: mocks.createServerSupabaseClient,
}));
vi.mock("../../lib/supabase/config", () => ({
  siteUrl: mocks.siteUrl,
  supabaseBrowserConfig: mocks.supabaseBrowserConfig,
}));

import {
  requestPasswordReset,
  signIn,
  signInWithGoogle,
  signOut,
  signUp,
  updatePassword,
} from "./actions";
import { safeReturnPath } from "./return-path";

const form = (values: Record<string, string>) => {
  const data = new FormData();
  Object.entries(values).forEach(([name, value]) => data.set(name, value));
  return data;
};

const fetchSettings = vi.fn();

const client = {
  auth: {
    getClaims: vi.fn(),
    resetPasswordForEmail: vi.fn(),
    signInWithOAuth: vi.fn(),
    signInWithPassword: vi.fn(),
    signOut: vi.fn(),
    signUp: vi.fn(),
    updateUser: vi.fn(),
  },
};

beforeEach(() => {
  vi.stubGlobal("fetch", fetchSettings);
  fetchSettings.mockReset();
  fetchSettings.mockResolvedValue({
    ok: true,
    json: vi.fn().mockResolvedValue({ mailer_autoconfirm: false }),
  });
  mocks.createServerSupabaseClient.mockResolvedValue(client);
  mocks.siteUrl.mockReturnValue("https://web.example.com");
  mocks.supabaseBrowserConfig.mockReturnValue({
    url: "https://project.supabase.co",
    publishableKey: "sb_publishable_placeholder",
  });
  client.auth.getClaims.mockResolvedValue({
    data: {
      claims: {
        sub: "actor-1",
        amr: [{ method: "recovery", timestamp: 1_775_000_000 }],
      },
    },
    error: null,
  });
  client.auth.resetPasswordForEmail.mockResolvedValue({ error: null });
  client.auth.signInWithOAuth.mockResolvedValue({
    data: { url: "https://project.supabase.co/auth/v1/authorize" },
    error: null,
  });
  client.auth.signInWithPassword.mockResolvedValue({ error: null });
  client.auth.signOut.mockResolvedValue({ error: null });
  client.auth.signUp.mockResolvedValue({ data: { session: null }, error: null });
  client.auth.updateUser.mockResolvedValue({ error: null });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("email authentication actions", () => {
  it("starts email verification through the cookie-backed PKCE callback", async () => {
    await expect(
      signUp(form({ email: "person@example.com", password: "provider-policy-password" })),
    ).rejects.toThrow("redirect:");

    expect(client.auth.signUp).toHaveBeenCalledWith({
      email: "person@example.com",
      password: "provider-policy-password",
      options: {
        emailRedirectTo: "https://web.example.com/auth/callback?next=%2Faccount",
      },
    });
    expect(mocks.redirect).toHaveBeenCalledWith(expect.stringContaining("Check%20your%20email"));
  });

  it("clears and rejects a signup session created before email verification", async () => {
    client.auth.signUp.mockResolvedValueOnce({
      data: { session: { access_token: "unverified-session" } },
      error: null,
    });

    await expect(
      signUp(form({ email: "person@example.com", password: "provider-policy-password" })),
    ).rejects.toThrow(/verification%20is%20not%20configured%20correctly/);

    expect(client.auth.signOut).toHaveBeenCalledWith({ scope: "local" });
    expect(mocks.redirect).not.toHaveBeenCalledWith("/account");
  });

  it("does not create an account when email confirmation is disabled", async () => {
    fetchSettings.mockResolvedValueOnce({
      ok: true,
      json: vi.fn().mockResolvedValue({ mailer_autoconfirm: true }),
    });

    await expect(
      signUp(form({ email: "person@example.com", password: "provider-policy-password" })),
    ).rejects.toThrow(/verification%20is%20not%20configured%20correctly/);

    expect(client.auth.signUp).not.toHaveBeenCalled();
  });

  it("signs in with email and restores the allowed account destination", async () => {
    await expect(
      signIn(
        form({
          email: "person@example.com",
          password: "password",
          next: "/account",
        }),
      ),
    ).rejects.toThrow("redirect:/account");

    expect(client.auth.signInWithPassword).toHaveBeenCalledWith({
      email: "person@example.com",
      password: "password",
    });
    expect(fetchSettings).toHaveBeenCalledWith(
      new URL("https://project.supabase.co/auth/v1/settings"),
      {
        headers: { apikey: "sb_publishable_placeholder" },
        cache: "no-store",
      },
    );
  });

  it("clears and rejects password sign-in when email confirmation is disabled", async () => {
    fetchSettings.mockResolvedValueOnce({
      ok: true,
      json: vi.fn().mockResolvedValue({ mailer_autoconfirm: true }),
    });

    await expect(
      signIn(
        form({
          email: "person@example.com",
          password: "password",
          next: "/account",
        }),
      ),
    ).rejects.toThrow(/verification%20is%20not%20configured%20correctly/);

    expect(client.auth.signOut).toHaveBeenCalledWith({ scope: "local" });
    expect(mocks.redirect).not.toHaveBeenCalledWith("/account");
  });

  it("starts password recovery and updates a recovered password", async () => {
    await expect(requestPasswordReset(form({ email: "person@example.com" }))).rejects.toThrow(
      "redirect:",
    );
    expect(client.auth.resetPasswordForEmail).toHaveBeenCalledWith("person@example.com", {
      redirectTo: "https://web.example.com/auth/callback?next=%2Fauth%2Fupdate-password",
    });

    await expect(updatePassword(form({ password: "new-password" }))).rejects.toThrow(
      "redirect:/account",
    );
    expect(client.auth.updateUser).toHaveBeenCalledWith({ password: "new-password" });
  });

  it("returns the same public recovery response when the provider fails", async () => {
    await expect(requestPasswordReset(form({ email: "person@example.com" }))).rejects.toThrow(
      "redirect:",
    );
    const successRedirect = mocks.redirect.mock.calls.at(-1)?.[0];

    client.auth.resetPasswordForEmail.mockResolvedValueOnce({
      error: new Error("account-specific provider detail"),
    });
    await expect(requestPasswordReset(form({ email: "person@example.com" }))).rejects.toThrow(
      "redirect:",
    );

    expect(mocks.redirect.mock.calls.at(-1)?.[0]).toBe(successRedirect);
    client.auth.resetPasswordForEmail.mockRejectedValueOnce(new Error("provider unavailable"));
    await expect(requestPasswordReset(form({ email: "person@example.com" }))).rejects.toThrow(
      "redirect:",
    );
    expect(mocks.redirect.mock.calls.at(-1)?.[0]).toBe(successRedirect);
    expect(successRedirect).not.toContain("provider");
  });

  it("rejects password updates from an ordinary or refreshed login session", async () => {
    client.auth.getClaims.mockResolvedValueOnce({
      data: {
        claims: {
          sub: "actor-1",
          amr: ["token_refresh"],
        },
      },
      error: null,
    });

    await expect(updatePassword(form({ password: "new-password" }))).rejects.toThrow(
      /reset%20link%20is%20invalid%20or%20expired/,
    );
    expect(client.auth.updateUser).not.toHaveBeenCalled();
  });
});

describe("Google and session actions", () => {
  it("starts Google OAuth and rejects an unlisted return path", async () => {
    await expect(
      signInWithGoogle(form({ next: "https://attacker.example/steal" })),
    ).rejects.toThrow("redirect:https://project.supabase.co");

    expect(client.auth.signInWithOAuth).toHaveBeenCalledWith({
      provider: "google",
      options: {
        redirectTo: "https://web.example.com/auth/callback?next=%2Faccount",
      },
    });
    expect(safeReturnPath("//attacker.example")).toBe("/account");
    expect(safeReturnPath("/events/unguarded")).toBe("/account");
  });

  it("signs out the Supabase session", async () => {
    await expect(signOut()).rejects.toThrow("redirect:");
    expect(client.auth.signOut).toHaveBeenCalledWith({ scope: "local" });
    expect(mocks.redirect).toHaveBeenCalledWith(expect.stringContaining("signed%20out"));
  });

  it("reports missing provider and callback configuration", async () => {
    mocks.createServerSupabaseClient.mockResolvedValueOnce(null);
    await expect(signIn(form({ email: "a@b.co", password: "password" }))).rejects.toThrow(
      /not%20configured/,
    );

    mocks.siteUrl.mockReturnValueOnce(null);
    await expect(signInWithGoogle(form({ next: "/account" }))).rejects.toThrow(
      /callback%20URL%20is%20not%20configured/,
    );
  });
});
