"use server";

import { redirect } from "next/navigation";
import { createServerSupabaseClient } from "../../lib/supabase/server";
import { siteUrl, supabaseBrowserConfig } from "../../lib/supabase/config";
import { hasRecoveryAuthentication } from "./recovery";
import { safeReturnPath, type AuthReturnPath } from "./return-path";

function authRedirect(kind: "error" | "message", text: string): never {
  redirect(`/auth?${kind}=${encodeURIComponent(text)}`);
}

function credentials(formData: FormData): { email: string; password: string } | null {
  const email = formData.get("email");
  const password = formData.get("password");
  if (typeof email !== "string" || !email.trim() || typeof password !== "string" || !password) {
    return null;
  }
  return { email: email.trim(), password };
}

async function configuredClient() {
  const supabase = await createServerSupabaseClient();
  if (supabase === null) {
    authRedirect("error", "Authentication is not configured for this environment.");
  }
  return supabase;
}

function callbackUrl(next: AuthReturnPath): string {
  const origin = siteUrl();
  if (origin === null) {
    authRedirect("error", "Authentication callback URL is not configured for this environment.");
  }
  return `${origin}/auth/callback?next=${encodeURIComponent(next)}`;
}

async function requiresEmailConfirmation(): Promise<boolean> {
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

export async function signUp(formData: FormData): Promise<never> {
  const values = credentials(formData);
  if (values === null) authRedirect("error", "Email and password are required.");

  const supabase = await configuredClient();
  if (!(await requiresEmailConfirmation())) {
    authRedirect("error", "Email verification is not configured correctly for this environment.");
  }
  const { data, error } = await supabase.auth.signUp({
    ...values,
    options: { emailRedirectTo: callbackUrl("/account") },
  });
  if (error) authRedirect("error", error.message);
  if (data.session) {
    await supabase.auth.signOut({ scope: "local" });
    authRedirect("error", "Email verification is not configured correctly for this environment.");
  }
  authRedirect("message", "Check your email to verify your address, then return to sign in.");
}

export async function signIn(formData: FormData): Promise<never> {
  const values = credentials(formData);
  if (values === null) authRedirect("error", "Email and password are required.");

  const supabase = await configuredClient();
  const { error } = await supabase.auth.signInWithPassword(values);
  if (error) authRedirect("error", error.message);
  if (!(await requiresEmailConfirmation())) {
    await supabase.auth.signOut({ scope: "local" });
    authRedirect("error", "Email verification is not configured correctly for this environment.");
  }
  redirect(safeReturnPath(formData.get("next") as string | null));
}

export async function signInWithGoogle(formData: FormData): Promise<never> {
  const supabase = await configuredClient();
  const next = safeReturnPath(formData.get("next") as string | null);
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: callbackUrl(next) },
  });
  if (error || !data.url) {
    authRedirect("error", error?.message ?? "Google sign-in could not be started.");
  }
  redirect(data.url);
}

export async function requestPasswordReset(formData: FormData): Promise<never> {
  const email = formData.get("email");
  if (typeof email !== "string" || !email.trim()) {
    authRedirect("error", "Email is required.");
  }
  const supabase = await configuredClient();
  const redirectTo = callbackUrl("/auth/update-password");
  try {
    await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo });
  } catch {
    // Recovery initiation must not disclose provider or account-specific failure details.
  }
  authRedirect("message", "If that address has an account, a password reset link is on its way.");
}

export async function updatePassword(formData: FormData): Promise<never> {
  const password = formData.get("password");
  if (typeof password !== "string" || !password) {
    authRedirect("error", "A new password is required.");
  }
  const supabase = await configuredClient();
  const { data: claims, error: claimsError } = await supabase.auth.getClaims();
  if (claimsError || !claims?.claims.sub || !hasRecoveryAuthentication(claims.claims)) {
    authRedirect("error", "The password reset link is invalid or expired.");
  }
  const { error } = await supabase.auth.updateUser({ password });
  if (error) authRedirect("error", error.message);
  redirect("/account?message=Password%20updated.");
}

export async function signOut(): Promise<never> {
  const supabase = await configuredClient();
  const { error } = await supabase.auth.signOut({ scope: "local" });
  if (error) authRedirect("error", error.message);
  authRedirect("message", "You are signed out.");
}
