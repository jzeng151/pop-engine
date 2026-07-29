import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { supabaseBrowserConfig } from "./config";

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
