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

export function createAccessTokenVerifier(client: ClaimsClient): VerifyAccessToken {
  return async (token) => {
    try {
      const { data, error } = await client.auth.getClaims(token);
      if (error || !data?.claims.sub) return null;
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

  const client = createClient(url, publishableKey, {
    auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false },
  });
  return createAccessTokenVerifier(client);
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
