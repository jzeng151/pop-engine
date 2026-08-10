import { createClient } from "@supabase/supabase-js";
import type { RequestHandler } from "express";

export type AuthActor = {
  id: string;
  email?: string;
};

export type VerifyAccessToken = (token: string) => Promise<AuthActor | null>;

type ClaimsClient = {
  auth: {
    getClaims(token: string): Promise<{
      data: { claims: { sub: string; email?: string } } | null;
      error: unknown;
    }>;
  };
};

export function createAccessTokenVerifier(
  client: ClaimsClient,
  settingsUrl: URL,
  publishableKey: string,
  fetchSettings: typeof fetch = fetch,
): VerifyAccessToken {
  return async (token) => {
    try {
      const { data, error } = await client.auth.getClaims(token);
      if (error || !data?.claims.sub) return null;
      const response = await fetchSettings(settingsUrl, {
        headers: { apikey: publishableKey, "Cache-Control": "no-store" },
      });
      if (!response.ok) return null;
      const settings: unknown = await response.json();
      // Fail closed unless email auto-confirm is disabled; authenticated sessions still require verification.
      if (
        typeof settings !== "object" ||
        settings === null ||
        !("mailer_autoconfirm" in settings) ||
        settings.mailer_autoconfirm !== false
      ) {
        return null;
      }
      return {
        id: data.claims.sub,
        ...(data.claims.email ? { email: data.claims.email } : {}),
      };
    } catch {
      return null;
    }
  };
}

export function supabaseAccessTokenVerifier(
  env: NodeJS.ProcessEnv = process.env,
): VerifyAccessToken | null {
  const url = env.SUPABASE_URL;
  const publishableKey = env.SUPABASE_PUBLISHABLE_KEY ?? env.SUPABASE_ANON_KEY;
  if (!url || !publishableKey) return null;

  try {
    const providerUrl = new URL(url);
    if (providerUrl.protocol !== "http:" && providerUrl.protocol !== "https:") return null;
    const client = createClient(url, publishableKey, {
      auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false },
    });
    return createAccessTokenVerifier(
      client,
      new URL("/auth/v1/settings", providerUrl),
      publishableKey,
    );
  } catch {
    return null;
  }
}

export function requireSupabaseAuth(verifyAccessToken: VerifyAccessToken): RequestHandler {
  return (req, res, next) => {
    const match = /^Bearer ([^\s]+)$/i.exec(req.get("authorization") ?? "");
    if (!match?.[1]) {
      res.setHeader("WWW-Authenticate", "Bearer");
      res.status(401).json({ error: "A valid Supabase access token is required." });
      return;
    }

    verifyAccessToken(match[1])
      .then((actor) => {
        if (actor === null) {
          res.setHeader("WWW-Authenticate", 'Bearer error="invalid_token"');
          res.status(401).json({ error: "The Supabase access token is invalid or expired." });
          return;
        }
        res.locals.actor = actor;
        next();
      })
      .catch(next);
  };
}
