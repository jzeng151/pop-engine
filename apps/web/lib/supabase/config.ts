export type SupabaseBrowserConfig = {
  url: string;
  publishableKey: string;
};

type Environment = Readonly<Record<string, string | undefined>>;

function httpUrl(value: string): URL | null {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url : null;
  } catch {
    return null;
  }
}

export function supabaseBrowserConfig(
  env: Environment = process.env,
): SupabaseBrowserConfig | null {
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey =
    env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  return url && publishableKey && httpUrl(url) ? { url, publishableKey } : null;
}

export function siteUrl(env: Environment = process.env): string | null {
  const value = env.NEXT_PUBLIC_SITE_URL;
  if (!value) return null;
  const url = httpUrl(value);
  // Callback configuration must be a bare origin: no credentials, path, query, or fragment.
  if (
    url === null ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  ) {
    return null;
  }
  return url.origin;
}
