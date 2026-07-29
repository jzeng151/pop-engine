import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const createServerClient = vi.hoisted(() => vi.fn());
vi.mock("@supabase/ssr", () => ({ createServerClient }));

import { middleware } from "../../middleware";

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});

describe("Supabase SSR session refresh", () => {
  it("restores request cookies and writes refreshed cookies with no-store headers", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://project.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_placeholder");
    createServerClient.mockImplementation(
      (
        _url: string,
        _key: string,
        options: {
          cookies: {
            getAll(): { name: string; value: string }[];
            setAll(
              values: { name: string; value: string; options: Record<string, unknown> }[],
              headers: Record<string, string>,
            ): void;
          };
        },
      ) => ({
        auth: {
          getClaims: vi.fn(async () => {
            expect(options.cookies.getAll()).toEqual([
              { name: "sb-session", value: "old-session" },
            ]);
            options.cookies.setAll(
              [{ name: "sb-session", value: "refreshed-session", options: { path: "/" } }],
              { "Cache-Control": "private, no-store" },
            );
          }),
        },
      }),
    );

    const response = await middleware(
      new NextRequest("https://web.example.com/account", {
        headers: { cookie: "sb-session=old-session" },
      }),
    );

    expect(response.cookies.get("sb-session")?.value).toBe("refreshed-session");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });

  it("leaves public routes available when auth configuration is absent", async () => {
    const response = await middleware(new NextRequest("https://web.example.com/e/public-event"));
    expect(response.status).toBe(200);
    expect(createServerClient).not.toHaveBeenCalled();
  });

  it.each(["https://<project-ref>.supabase.co", "ftp://project.supabase.co"])(
    "leaves public routes available when the provider URL is invalid: %s",
    async (url) => {
      vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", url);
      vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_placeholder");

      const response = await middleware(new NextRequest("https://web.example.com/e/public-event"));

      expect(response.status).toBe(200);
      expect(createServerClient).not.toHaveBeenCalled();
    },
  );
});
