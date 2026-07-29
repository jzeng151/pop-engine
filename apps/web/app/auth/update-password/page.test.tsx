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
vi.mock("../../../lib/supabase/server", () => ({
  createServerSupabaseClient: mocks.createServerSupabaseClient,
}));

import UpdatePasswordPage from "./page";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("password update page", () => {
  it("offers a safe exit when authentication is not configured", async () => {
    mocks.createServerSupabaseClient.mockResolvedValue(null);

    render(await UpdatePasswordPage({ searchParams: Promise.resolve({}) }));

    expect(screen.getByRole("alert").textContent).toMatch(/not configured/i);
    expect(screen.getByRole("link", { name: "Return home" }).getAttribute("href")).toBe("/");
  });

  it("displays a provider password-policy error beside the update form", async () => {
    mocks.createServerSupabaseClient.mockResolvedValue({
      auth: {
        getClaims: vi.fn().mockResolvedValue({
          data: {
            claims: {
              sub: "actor-1",
              amr: [{ method: "recovery", timestamp: 1_775_000_000 }],
            },
          },
          error: null,
        }),
      },
    });

    render(
      await UpdatePasswordPage({
        searchParams: Promise.resolve({ error: "Password must include & and +" }),
      }),
    );

    expect(screen.getByRole("alert").textContent).toBe("Password must include & and +");
    expect(screen.getByLabelText("New password")).toBeDefined();
    expect(screen.getByRole("button", { name: "Update password" })).toBeDefined();
  });

  it("still rejects a session without recovery proof", async () => {
    mocks.createServerSupabaseClient.mockResolvedValue({
      auth: {
        getClaims: vi.fn().mockResolvedValue({
          data: { claims: { sub: "actor-1", amr: ["token_refresh"] } },
          error: null,
        }),
      },
    });

    await expect(
      UpdatePasswordPage({ searchParams: Promise.resolve({ error: "ignored" }) }),
    ).rejects.toThrow(
      "redirect:/auth?error=The%20password%20reset%20link%20is%20invalid%20or%20expired.",
    );
  });
});
