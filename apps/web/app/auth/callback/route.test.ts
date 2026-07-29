import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createServerSupabaseClient: vi.fn(),
}));

vi.mock("../../../lib/supabase/server", () => ({
  createServerSupabaseClient: mocks.createServerSupabaseClient,
}));

import { GET } from "./route";

afterEach(() => vi.clearAllMocks());

describe("Supabase auth callback", () => {
  it("exchanges a successful code and returns only to an allowed path", async () => {
    const exchangeCodeForSession = vi.fn().mockResolvedValue({ error: null });
    mocks.createServerSupabaseClient.mockResolvedValue({
      auth: { exchangeCodeForSession },
    });

    const response = await GET(
      new Request("https://web.example.com/auth/callback?code=valid&next=%2Faccount"),
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
      "https://web.example.com/auth/callback?code=expired",
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
});
