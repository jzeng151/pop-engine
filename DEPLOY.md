# PopEngine — Deployment Runbook (Phase 0)

**Status:** APPROVED (2026-07-23, issue #1; see `docs/BASELINE.md`)

Provider baseline (`docs/BASELINE.md`): **Railway** (host) · **Supabase** (Postgres,
S3-compatible storage, and Auth) · **Resend** (email) · **Twilio** (SMS) · **Cloudflare Access**
(demo gate, AD-12). Synthetic data only until the joint F-701/F-702/F-703 production gate ships.

The scaffold builds and tests locally with no cloud accounts. This runbook provisions the gated demo environment. Every step needs your own account and secrets; nothing here is automated.

## 0. Prerequisites

- Accounts: Railway, Supabase, Resend, Twilio, Cloudflare (free tiers cover the demo).
- The repo pushed to GitHub.

## 1. Supabase (Postgres + storage + auth foundation)

1. Create a project. Copy the connection string into `DATABASE_URL`.
2. Storage, create a private bucket `pop-engine-documents`.
3. Project Settings, Storage, S3 access keys, generate a keypair. Fill `S3_ENDPOINT` (`https://<project-ref>.supabase.co/storage/v1/s3`), `S3_REGION`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_BUCKET`. The api signs standard SigV4 URLs, so F-202 storage code stays vendor-neutral.

Authentication is the approved F-701 foundation (`specs/F-701-authentication.md`, AD-16):
Supabase Auth is the single identity/session provider, with email/password and Google OAuth as its
two authentication methods. It establishes only a Supabase actor and cookie session; it does not
replace the Cloudflare demo gate and is not production-ready until F-702/F-703 tenancy and role
contracts and enforcement are separately approved and ship.

4. Project Settings, API: copy the project URL and publishable key into the web service as
   `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, and into the API service as
   `SUPABASE_URL` / `SUPABASE_PUBLISHABLE_KEY`. Legacy projects can use the documented anon-key
   aliases. Never use a service-role or secret key in browser configuration.
5. Authentication, URL Configuration:
   - Site URL: `https://<web-host>`
   - Redirect URLs: `http://localhost:3000/auth/callback` and
     `https://<web-host>/auth/callback`
   - Set `NEXT_PUBLIC_SITE_URL` to the matching web origin, with no path.
6. Authentication, Providers, Email: enable email/password and keep email confirmation enabled.
   Confirm the signup and recovery templates use the redirect URL supplied by the application.
7. Google Auth Platform, create a Web application OAuth client:
   - Authorized JavaScript origins: `http://localhost:3000` for local development and
     `https://<web-host>` for the deployed environment.
   - Authorized redirect URI: the exact Supabase callback shown on the Supabase Google provider
     page, normally `https://<project-ref>.supabase.co/auth/v1/callback` (or
     `http://127.0.0.1:54321/auth/v1/callback` for a local Supabase stack).
8. Supabase Authentication, Providers, Google: enable Google and add that OAuth client's ID and
   secret. The Google secret stays in the Supabase dashboard and never enters this repository.

## 2. Resend (email)

1. Create an account, add and verify a sending domain (or use the onboarding domain for the demo).
2. Create an API key into `RESEND_API_KEY`. Set `SMTP_FROM` to a verified sender.

## 3. Twilio (SMS), start today (T-1)

1. Create an account, buy a number: `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER`.
2. Start A2P 10DLC registration now. Until it clears, email sends live and SMS renders as a labeled in-product simulation (`docs/DESIGN.md` fallback). Track the approval date.

## 4. Railway (host, two services)

One project, two services from this monorepo. Set each service's root directory to the repo root; Railway installs the pnpm workspace.

- **api**: start command `pnpm --filter api start`. No build step (runs via tsx).
- **web**: build command `pnpm --filter web build`, start command `pnpm --filter web start`.

1. New Project, Deploy from GitHub repo, `jzeng151/pop-engine`.
2. Add the two services with the commands above.
3. Set env vars per service from `apps/api/.env.example` and `apps/web/.env.example`. Point `WEB_ORIGIN` (api) at the web URL, `NEXT_PUBLIC_API_BASE_URL` (web) at the api URL, and `NEXT_PUBLIC_SITE_URL` at the exact public web origin.
4. Connect the deploy branch. The demo environment is seeded once and not redeployed after final rehearsal.

### Release order

The two services deploy separately and the api runs `pnpm migrate up` as it starts, so a rollout is
a window in which two builds and one schema are all live at once. Two F-203 guarantees hold only if
that window is opened in this order. Both are one-off constraints for the release that introduces
the alert attempt record; the conditions for dropping each are stated with it.

1. **Deploy the web service first, then the api.** The api stops counting an alert it has
   permanently stopped on among the failures it says are being retried, and reports it under
   `alertsHeldForReconciliation` instead. A web build older than that field renders neither, so an
   alert nobody will send again would have no organizer-facing warning at all until the web service
   catches up. Deployed web-first the window is empty: this web build reads an absent
   `alertsHeldForReconciliation` as none and renders the rest of the checklist normally, which is
   what makes it safe against an api that does not send the field yet. Drop this step once the web
   deployment carrying the field is the oldest one in service.
2. **Stop the running api before the new one applies migration 014**, rather than letting the new
   deployment start beside it. Scale the api service to zero (or stop the current deployment), let
   it drain, then start the new build; confirm no api process from the previous build is still
   running when the migration executes, and `Migrations complete!` in the new build's logs before
   returning the service to traffic. Migration 014 creates `alert_send_attempts` and seeds it from
   the alerts that had already failed, and from then on every reader treats an alert with no attempt
   row as one nothing was ever handed over for. An api process from the previous build sends without
   writing attempt rows, so anything it sends after the backfill commits is invisible to that
   record for good: a crash or a lost response on such a send leaves an alert the new poller reads
   as never attempted and may deliver again after the provider's deduplication window has closed,
   which for an organizer is the same deadline reminder arriving twice. The backfill is a
   point-in-time sweep and cannot cover it; only the ordering can. Drop this step once
   `014_alert_send_attempts` has been applied to the environment.

## 5. Cloudflare Access (demo gate, AD-12)

The gate remains host-level. The F-701 Supabase foundation does not authorize workspaces or roles
and therefore cannot replace it.

1. Put both Railway URLs behind Cloudflare (proxy the hostnames, or use a Cloudflare Tunnel to the Railway URLs).
2. Zero Trust, Access, Applications: add a self-hosted app per hostname.
3. Policy: allow the team's emails (email-OTP), or an IP allowlist. Everything else is denied.
4. For the rehearsal and demo window only, create separate, more-specific self-hosted Access applications for the attendee paths: the web app's `/e/*` pages; the API host's `/e/*` public-page read; and the API paths `/api/events/*/rsvps` (POST only) and `/api/events/*/checkins` (name-only event GET plus check-in POST). Give only those path applications a Bypass/Everyone policy; their more-specific paths take precedence over the hostname applications. Never bypass organizer routes such as `/api/events/*/guests*`, public-page controls, plans, checklists, or documents. `public_page_published` controls content visibility inside the window; it does not replace Access.
5. Record who opens the window and its closing time. Remove the attendee path applications or their bypass policies immediately after rehearsal/demo so the hostname applications protect those paths again. Outside that window an anonymous request must be challenged or denied by Access before it reaches either origin.
6. Because the api sits on a different hostname from the web app, browser JSON calls send CORS preflights, and Access returns 403 on `OPTIONS` by default. On the api's Access application enable the CORS settings (allow the web origin, allow credentials so the `CF_Authorization` cookie passes) or bypass `OPTIONS` to the origin. Without this the Express CORS handler never runs and cross-origin POST/PATCH/DELETE fail behind the gate even though they pass locally. See Cloudflare's authorization-cookie CORS guide.
7. Disable caching for `/auth/*` and authenticated responses. Supabase session refresh responses
   set private/no-store headers; the Cloudflare cache policy must honor them and must never cache a
   `Set-Cookie` response.

## 6. Verify

- `GET https://<api-host>/health` returns `{"status":"ok",...}` behind the gate. This is a liveness probe: it reports that the process is up, not which ruleset that process loaded. Boot-time ruleset validation has been in place since the Phase 0 events schema (`apps/api/src/ruleset.ts`): the api refuses to start when the file is missing, fails its schema check, or is not the expected `ruleset_version` (`docs/ARCHITECTURE.md`, "Rules loading"). So a process that is answering has loaded a ruleset that passed those checks — but `/health` does not report which file it read, so confirming a deployment is serving the intended `RULES_FILE` still needs to be done another way (open on issue #89).
- The web service loads behind the gate.
- `/auth` supports verified email signup/sign-in, Google initiation, and recovery; `/account`
  restores the session after a reload and sign-out returns to a signed-out state without exposing
  a provider token.
- With a valid Supabase access token, API `GET /api/session` returns only the verified actor ID and
  optional email. Missing/invalid tokens return 401; missing API auth configuration returns 503.
- Before opening the attendee window, confirm external unauthenticated requests cannot reach the web or API `GET /e/<synthetic-event-id>` paths, `GET /api/events/<synthetic-event-id>/checkins`, `POST /api/events/<synthetic-event-id>/rsvps`, or `POST /api/events/<synthetic-event-id>/checkins`, and confirm no RSVP/check-in row was created.
- During the window, confirm both public-page paths and the name-only check-in lookup load, then submit one synthetic RSVP and one synthetic check-in using organizer-provided aliases rather than attendee identities; organizer `/guests` remains behind Access.
- After removing the bypass policies, repeat every listed external unauthenticated check and confirm both writes are blocked and create no rows.
- A seeded deadline fires a real email (SMS labeled-simulation until A2P clears).

## Env reference

`apps/api/.env.example` and `apps/web/.env.example` are the source of truth for variable names. Never commit real secrets; synthetic data only (AD-12).
