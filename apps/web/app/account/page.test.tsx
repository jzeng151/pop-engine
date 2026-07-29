// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

const mocks = vi.hoisted(() => ({
  createServerSupabaseClient: vi.fn(),
  redirect: vi.fn((target: string) => {
    throw new Error(`redirect:${target}`);
  }),
}));

vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("../../lib/supabase/server", () => ({
  createServerSupabaseClient: mocks.createServerSupabaseClient,
}));

import AccountPage from "./page";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("protected account session", () => {
  it("renders only the verified Supabase actor claims", async () => {
    mocks.createServerSupabaseClient.mockResolvedValue({
      auth: {
        getClaims: vi.fn().mockResolvedValue({
          data: { claims: { sub: "actor-1", email: "person@example.com" } },
          error: null,
        }),
      },
    });

    render(await AccountPage({ searchParams: Promise.resolve({}) }));

    expect(screen.getByText("actor-1")).toBeDefined();
    expect(screen.getByText("person@example.com")).toBeDefined();
    expect(screen.getByText(/No workspace, membership, ownership, or role/)).toBeDefined();
    expect(screen.getByRole("button", { name: "Sign out" })).toBeDefined();
  });

  it("shows missing configuration and rejects an expired session", async () => {
    mocks.createServerSupabaseClient.mockResolvedValueOnce(null);
    render(await AccountPage({ searchParams: Promise.resolve({}) }));
    expect(screen.getByRole("alert").textContent).toMatch(/not configured/i);
    expect(screen.getByRole("link", { name: "Return home" }).getAttribute("href")).toBe("/");
    cleanup();

    mocks.createServerSupabaseClient.mockResolvedValueOnce({
      auth: {
        getClaims: vi.fn().mockResolvedValue({
          data: null,
          error: new Error("expired"),
        }),
      },
    });
    await expect(AccountPage({ searchParams: Promise.resolve({}) })).rejects.toThrow(
      /session%20is%20missing%20or%20expired/,
    );
  });
});
