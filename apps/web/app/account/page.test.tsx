// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

const mocks = vi.hoisted(() => ({
  createServerSupabaseClient: vi.fn(),
  redirect: vi.fn((target: string) => {
    throw new Error(`redirect:${target}`);
  }),
  supabaseBrowserConfig: vi.fn(),
}));

vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("../../lib/supabase/config", () => ({
  supabaseBrowserConfig: mocks.supabaseBrowserConfig,
}));
vi.mock("../../lib/supabase/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/supabase/server")>()),
  createServerSupabaseClient: mocks.createServerSupabaseClient,
}));

import AccountPage from "./page";

const fetchSettings = vi.fn();
const client = {
  auth: {
    getClaims: vi.fn(),
    signOut: vi.fn(),
  },
};

beforeEach(() => {
  vi.stubGlobal("fetch", fetchSettings);
  mocks.supabaseBrowserConfig.mockReturnValue({
    url: "https://project.supabase.co",
    publishableKey: "sb_publishable_placeholder",
  });
  mocks.createServerSupabaseClient.mockResolvedValue(client);
  fetchSettings.mockResolvedValue({
    ok: true,
    json: vi.fn().mockResolvedValue({ mailer_autoconfirm: false }),
  });
  client.auth.getClaims.mockResolvedValue({
    data: { claims: { sub: "actor-1", email: "person@example.com" } },
    error: null,
  });
  client.auth.signOut.mockResolvedValue({ error: null });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("protected account session", () => {
  it("renders only the verified Supabase actor claims", async () => {
    render(await AccountPage({ searchParams: Promise.resolve({}) }));

    expect(screen.getByText("actor-1")).toBeDefined();
    expect(screen.getByText("person@example.com")).toBeDefined();
    expect(screen.getByText(/No workspace, membership, ownership, or role/)).toBeDefined();
    expect(screen.getByRole("button", { name: "Sign out" })).toBeDefined();
    expect(fetchSettings).toHaveBeenCalledWith(
      new URL("https://project.supabase.co/auth/v1/settings"),
      {
        headers: { apikey: "sb_publishable_placeholder" },
        cache: "no-store",
      },
    );
    expect(client.auth.signOut).not.toHaveBeenCalled();
  });

  it.each([
    [
      "disabled",
      {
        ok: true,
        json: vi.fn().mockResolvedValue({ mailer_autoconfirm: true }),
      },
    ],
    ["malformed", { ok: true, json: vi.fn().mockResolvedValue({}) }],
    ["unavailable", new Error("provider unavailable")],
  ])("rejects a valid session when email confirmation settings are %s", async (_name, result) => {
    if (result instanceof Error) {
      fetchSettings.mockRejectedValueOnce(result);
    } else {
      fetchSettings.mockResolvedValueOnce(result);
    }

    await expect(AccountPage({ searchParams: Promise.resolve({}) })).rejects.toThrow(
      /Email%20verification%20is%20not%20configured%20correctly/,
    );

    expect(client.auth.signOut).toHaveBeenCalledWith({ scope: "local" });
    expect(mocks.redirect).not.toHaveBeenCalledWith("/account");
  });

  it("shows missing configuration and rejects an expired session", async () => {
    mocks.createServerSupabaseClient.mockResolvedValueOnce(null);
    render(await AccountPage({ searchParams: Promise.resolve({}) }));
    expect(screen.getByRole("alert").textContent).toMatch(/not configured/i);
    expect(screen.getByRole("link", { name: "Return home" }).getAttribute("href")).toBe("/");
    cleanup();

    client.auth.getClaims.mockResolvedValueOnce({
      data: null,
      error: new Error("expired"),
    });
    await expect(AccountPage({ searchParams: Promise.resolve({}) })).rejects.toThrow(
      /session%20is%20missing%20or%20expired/,
    );
    expect(fetchSettings).not.toHaveBeenCalled();
  });
});
