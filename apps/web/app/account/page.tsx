import { redirect } from "next/navigation";
import { createServerSupabaseClient } from "../../lib/supabase/server";
import { signOut } from "../auth/actions";

export const dynamic = "force-dynamic";

type AccountPageProps = {
  searchParams: Promise<{ message?: string }>;
};

export default async function AccountPage({ searchParams }: AccountPageProps) {
  const supabase = await createServerSupabaseClient();
  if (supabase === null) {
    return (
      <main className="auth">
        <h1>Account session</h1>
        <p className="auth__notice" role="alert">
          Authentication is not configured for this environment.
        </p>
      </main>
    );
  }

  const { data, error } = await supabase.auth.getClaims();
  if (error || !data?.claims.sub) {
    redirect("/auth?error=Your%20session%20is%20missing%20or%20expired.%20Please%20sign%20in.");
  }

  const { message } = await searchParams;
  return (
    <main className="auth">
      <p className="auth__eyebrow">Verified Supabase actor</p>
      <h1>Account session</h1>
      {message && (
        <p className="auth__notice" role="status">
          {message}
        </p>
      )}
      <dl className="auth__claims">
        <div>
          <dt>Actor ID</dt>
          <dd>{data.claims.sub}</dd>
        </div>
        <div>
          <dt>Email</dt>
          <dd>{data.claims.email ?? "Not provided by the identity claim"}</dd>
        </div>
      </dl>
      <p>
        Identity is verified. No workspace, membership, ownership, or role is inferred on this
        foundation.
      </p>
      <form action={signOut}>
        <button type="submit">Sign out</button>
      </form>
    </main>
  );
}
