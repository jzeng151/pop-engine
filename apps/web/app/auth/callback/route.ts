import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "../../../lib/supabase/server";
import { siteUrl } from "../../../lib/supabase/config";
import { safeReturnPath } from "../return-path";

function authError(origin: string, message: string) {
  const target = new URL("/auth", origin);
  target.searchParams.set("error", message);
  return NextResponse.redirect(target);
}

export async function GET(request: Request) {
  const origin = siteUrl();
  if (origin === null) {
    return NextResponse.json(
      { error: "Authentication callback URL is not configured for this environment." },
      { status: 503, headers: { "Cache-Control": "private, no-store" } },
    );
  }

  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  if (!code) return authError(origin, "The sign-in link is missing or expired. Please try again.");

  const supabase = await createServerSupabaseClient();
  if (supabase === null) {
    return authError(origin, "Authentication is not configured for this environment.");
  }

  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) return authError(origin, "The sign-in link is invalid or expired. Please try again.");
  return NextResponse.redirect(new URL(safeReturnPath(searchParams.get("next")), origin));
}
