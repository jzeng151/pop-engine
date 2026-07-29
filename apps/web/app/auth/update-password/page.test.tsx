// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

const mocks = vi.hoisted(() => ({
  createServerSupabaseClient: vi.fn(),
}));

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

    render(await UpdatePasswordPage());

    expect(screen.getByRole("alert").textContent).toMatch(/not configured/i);
    expect(screen.getByRole("link", { name: "Return home" }).getAttribute("href")).toBe("/");
  });
});
