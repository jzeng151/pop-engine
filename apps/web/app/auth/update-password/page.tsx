import { redirect } from "next/navigation";
import { createServerSupabaseClient } from "../../../lib/supabase/server";
import { updatePassword } from "../actions";
import { hasRecoveryAuthentication } from "../recovery";

export const dynamic = "force-dynamic";

export default async function UpdatePasswordPage() {
  const supabase = await createServerSupabaseClient();
  if (supabase === null) {
    return (
      <main className="auth">
        <h1>Choose a new password</h1>
        <p className="auth__notice" role="alert">
          Authentication is not configured for this environment.
        </p>
        <p>
          <a href="/">Return home</a>
        </p>
      </main>
    );
  }

  const { data, error } = await supabase.auth.getClaims();
  if (error || !data?.claims.sub || !hasRecoveryAuthentication(data.claims)) {
    redirect("/auth?error=The%20password%20reset%20link%20is%20invalid%20or%20expired.");
  }

  return (
    <main className="auth">
      <h1>Choose a new password</h1>
      <form action={updatePassword} className="auth__form auth__panel">
        <label>
          New password
          <input name="password" type="password" autoComplete="new-password" required />
        </label>
        <button type="submit">Update password</button>
      </form>
    </main>
  );
}
