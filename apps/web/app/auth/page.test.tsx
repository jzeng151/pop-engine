// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import AuthPage from "./page";

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

describe("authentication page", () => {
  it("renders accessible email, Google, and recovery controls", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://project.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_placeholder");
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://web.example.com");

    render(await AuthPage({ searchParams: Promise.resolve({}) }));

    expect(screen.getByRole("heading", { name: "Sign in to PopEngine" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Sign in" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Create account" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Continue with Google" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Send reset link" })).toBeDefined();
    expect(document.querySelectorAll('input[type="email"]')).toHaveLength(3);
  });

  it("labels missing configuration and disables authentication controls", async () => {
    render(await AuthPage({ searchParams: Promise.resolve({}) }));

    expect(screen.getByRole("alert").textContent).toMatch(/not configured/i);
    expect(screen.getByRole("group", { name: "Authentication methods" })).toHaveProperty(
      "disabled",
      true,
    );
  });
});
