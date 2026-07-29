import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "../../../lib/supabase/server";
import { safeReturnPath } from "../return-path";

function authError(request: Request, message: string) {
  const target = new URL("/auth", request.url);
  target.searchParams.set("error", message);
  return NextResponse.redirect(target);
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  if (!code) return authError(request, "The sign-in link is missing or expired. Please try again.");

  const supabase = await createServerSupabaseClient();
  if (supabase === null) {
    return authError(request, "Authentication is not configured for this environment.");
  }

  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) return authError(request, "The sign-in link is invalid or expired. Please try again.");
  return NextResponse.redirect(new URL(safeReturnPath(searchParams.get("next")), request.url));
}
