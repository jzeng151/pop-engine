import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { supabaseBrowserConfig } from "./config";

export async function requiresEmailConfirmation(): Promise<boolean> {
  const config = supabaseBrowserConfig();
  if (config === null) return false;

  try {
    const response = await fetch(new URL("/auth/v1/settings", config.url), {
      headers: { apikey: config.publishableKey },
      cache: "no-store",
    });
    if (!response.ok) return false;
    const settings: unknown = await response.json();
    return (
      typeof settings === "object" &&
      settings !== null &&
      "mailer_autoconfirm" in settings &&
      settings.mailer_autoconfirm === false
    );
  } catch {
    return false;
  }
}

export async function createServerSupabaseClient() {
  const config = supabaseBrowserConfig();
  if (config === null) return null;

  const cookieStore = await cookies();
  return createServerClient(config.url, config.publishableKey, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (cookiesToSet) => {
        try {
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          // Server Components cannot write cookies; middleware refreshes before they render.
        }
      },
    },
  });
}
