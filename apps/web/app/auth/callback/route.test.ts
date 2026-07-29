import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createServerSupabaseClient: vi.fn(),
  siteUrl: vi.fn<() => string | null>(() => "https://web.example.com"),
}));

vi.mock("../../../lib/supabase/server", () => ({
  createServerSupabaseClient: mocks.createServerSupabaseClient,
}));
vi.mock("../../../lib/supabase/config", () => ({ siteUrl: mocks.siteUrl }));

import { GET } from "./route";

afterEach(() => {
  vi.clearAllMocks();
  mocks.siteUrl.mockReturnValue("https://web.example.com");
});

describe("Supabase auth callback", () => {
  it("exchanges a successful code and returns only to an allowed path", async () => {
    const exchangeCodeForSession = vi.fn().mockResolvedValue({ error: null });
    mocks.createServerSupabaseClient.mockResolvedValue({
      auth: { exchangeCodeForSession },
    });

    const response = await GET(
      new Request("https://attacker.example/auth/callback?code=valid&next=%2Faccount"),
    );

    expect(exchangeCodeForSession).toHaveBeenCalledWith("valid");
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("https://web.example.com/account");
  });

  it("rejects an external return URL after a successful exchange", async () => {
    mocks.createServerSupabaseClient.mockResolvedValue({
      auth: { exchangeCodeForSession: vi.fn().mockResolvedValue({ error: null }) },
    });
    const response = await GET(
      new Request(
        "https://web.example.com/auth/callback?code=valid&next=https%3A%2F%2Fattacker.example",
      ),
    );

    expect(response.headers.get("location")).toBe("https://web.example.com/account");
  });

  it.each([
    ["missing code", "https://web.example.com/auth/callback", undefined],
    [
      "failed exchange",
      "https://attacker.example/auth/callback?code=expired",
      {
        auth: {
          exchangeCodeForSession: vi.fn().mockResolvedValue({ error: new Error("expired") }),
        },
      },
    ],
    ["missing configuration", "https://web.example.com/auth/callback?code=valid", null],
  ])("returns a clear auth error for %s", async (_name, url, configuredClient) => {
    mocks.createServerSupabaseClient.mockResolvedValue(configuredClient);
    const response = await GET(new Request(url));

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toMatch(/^https:\/\/web\.example\.com\/auth\?error=/);
  });

  it("fails without redirecting when the configured site origin is absent", async () => {
    mocks.siteUrl.mockReturnValue(null);
    const response = await GET(
      new Request("https://attacker.example/auth/callback?code=valid&next=%2Faccount"),
    );

    expect(response.status).toBe(503);
    expect(response.headers.get("location")).toBeNull();
    await expect(response.json()).resolves.toEqual({
      error: "Authentication callback URL is not configured for this environment.",
    });
    expect(mocks.createServerSupabaseClient).not.toHaveBeenCalled();
  });
});
