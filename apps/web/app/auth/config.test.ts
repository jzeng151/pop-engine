import { describe, expect, it } from "vitest";
import { siteUrl, supabaseBrowserConfig } from "../../lib/supabase/config";

describe("Supabase web configuration", () => {
  it("accepts publishable and legacy anon project keys", () => {
    expect(
      supabaseBrowserConfig({
        NEXT_PUBLIC_SUPABASE_URL: "https://project.supabase.co",
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_placeholder",
      }),
    ).toEqual({
      url: "https://project.supabase.co",
      publishableKey: "sb_publishable_placeholder",
    });
    expect(
      supabaseBrowserConfig({
        NEXT_PUBLIC_SUPABASE_URL: "https://project.supabase.co",
        NEXT_PUBLIC_SUPABASE_ANON_KEY: "legacy-placeholder",
      }),
    ).toEqual({
      url: "https://project.supabase.co",
      publishableKey: "legacy-placeholder",
    });
  });

  it.each([
    "https://<project-ref>.supabase.co",
    "not a URL",
    "ftp://project.supabase.co",
    "javascript:alert(1)",
  ])("rejects a malformed or non-HTTP(S) provider URL: %s", (url) => {
    expect(
      supabaseBrowserConfig({
        NEXT_PUBLIC_SUPABASE_URL: url,
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_placeholder",
      }),
    ).toBeNull();
  });

  it("requires a plain HTTP(S) site origin for callback construction", () => {
    expect(siteUrl({ NEXT_PUBLIC_SITE_URL: "https://web.example.com/" })).toBe(
      "https://web.example.com",
    );
    expect(siteUrl({ NEXT_PUBLIC_SITE_URL: "https://web.example.com/unlisted-path" })).toBeNull();
    expect(siteUrl({ NEXT_PUBLIC_SITE_URL: "javascript:alert(1)" })).toBeNull();
  });
});
