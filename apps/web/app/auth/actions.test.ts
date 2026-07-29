import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createServerSupabaseClient: vi.fn(),
  redirect: vi.fn((target: string) => {
    throw new Error(`redirect:${target}`);
  }),
  siteUrl: vi.fn<() => string | null>(() => "https://web.example.com"),
}));

vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("../../lib/supabase/server", () => ({
  createServerSupabaseClient: mocks.createServerSupabaseClient,
}));
vi.mock("../../lib/supabase/config", () => ({ siteUrl: mocks.siteUrl }));

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

const client = {
  auth: {
    resetPasswordForEmail: vi.fn(),
    signInWithOAuth: vi.fn(),
    signInWithPassword: vi.fn(),
    signOut: vi.fn(),
    signUp: vi.fn(),
    updateUser: vi.fn(),
  },
};

beforeEach(() => {
  mocks.createServerSupabaseClient.mockResolvedValue(client);
  mocks.siteUrl.mockReturnValue("https://web.example.com");
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

afterEach(() => vi.clearAllMocks());

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
    expect(client.auth.signOut).toHaveBeenCalledOnce();
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
