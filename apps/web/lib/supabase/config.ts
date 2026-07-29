export type SupabaseBrowserConfig = {
  url: string;
  publishableKey: string;
};

type Environment = Readonly<Record<string, string | undefined>>;

export function supabaseBrowserConfig(
  env: Environment = process.env,
): SupabaseBrowserConfig | null {
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey =
    env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  return url && publishableKey ? { url, publishableKey } : null;
}

export function siteUrl(env: Environment = process.env): string | null {
  const value = env.NEXT_PUBLIC_SITE_URL;
  if (!value) return null;
  try {
    const url = new URL(value);
    if (
      (url.protocol !== "http:" && url.protocol !== "https:") ||
      url.username ||
      url.password ||
      url.pathname !== "/" ||
      url.search ||
      url.hash
    ) {
      return null;
    }
    return url.origin;
  } catch {
    return null;
  }
}
