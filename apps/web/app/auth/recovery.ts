import type { JwtPayload } from "@supabase/supabase-js";

export function hasRecoveryAuthentication(claims: JwtPayload): boolean {
  return (
    claims.amr?.some((method) =>
      typeof method === "string" ? method === "recovery" : method.method === "recovery",
    ) ?? false
  );
}
