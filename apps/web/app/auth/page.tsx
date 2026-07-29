import { requestPasswordReset, signIn, signInWithGoogle, signUp } from "./actions";
import { siteUrl, supabaseBrowserConfig } from "../../lib/supabase/config";

type AuthPageProps = {
  searchParams: Promise<{ error?: string; message?: string }>;
};

export default async function AuthPage({ searchParams }: AuthPageProps) {
  const { error, message } = await searchParams;
  const isConfigured = supabaseBrowserConfig() !== null && siteUrl() !== null;

  return (
    <main className="auth">
      <p className="auth__eyebrow">Authentication foundation</p>
      <h1>Sign in to PopEngine</h1>
      <p>
        This verifies identity and restores a session through Supabase Auth. Workspace ownership and
        roles are not available until F-702 and F-703.
      </p>

      {!isConfigured && (
        <p className="auth__notice" role="alert">
          Authentication is not configured for this environment. Add the documented Supabase and
          site URL settings to enable these forms.
        </p>
      )}
      {error && (
        <p className="auth__error" role="alert">
          {error}
        </p>
      )}
      {message && (
        <p className="auth__notice" role="status">
          {message}
        </p>
      )}

      <fieldset className="auth__sections" disabled={!isConfigured}>
        <legend className="sr-only">Authentication methods</legend>

        <section className="auth__panel" aria-labelledby="sign-in-heading">
          <h2 id="sign-in-heading">Email and password</h2>
          <form action={signIn} className="auth__form">
            <label>
              Email
              <input name="email" type="email" autoComplete="email" required />
            </label>
            <label>
              Password
              <input name="password" type="password" autoComplete="current-password" required />
            </label>
            <input type="hidden" name="next" value="/account" />
            <button type="submit">Sign in</button>
          </form>

          <form action={signUp} className="auth__form">
            <label>
              Email
              <input name="email" type="email" autoComplete="email" required />
            </label>
            <label>
              Password
              <input name="password" type="password" autoComplete="new-password" required />
            </label>
            <button type="submit">Create account</button>
          </form>
        </section>

        <section className="auth__panel" aria-labelledby="google-heading">
          <h2 id="google-heading">Google</h2>
          <form action={signInWithGoogle}>
            <input type="hidden" name="next" value="/account" />
            <button type="submit">Continue with Google</button>
          </form>
        </section>

        <section className="auth__panel" aria-labelledby="recovery-heading">
          <h2 id="recovery-heading">Forgot your password?</h2>
          <form action={requestPasswordReset} className="auth__form">
            <label>
              Account email
              <input name="email" type="email" autoComplete="email" required />
            </label>
            <button type="submit">Send reset link</button>
          </form>
        </section>
      </fieldset>

      <p className="auth__demo">
        The existing Cloudflare Access gate and synthetic-data-only demo policy still apply. This
        page is not a production rollout gate.
      </p>
    </main>
  );
}
