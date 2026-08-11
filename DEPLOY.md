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

- **api**: start command `cd apps/api && pnpm migrate up && exec node --import tsx src/index.ts`. No build step (the tsx loader runs the TypeScript source in process).
- **web**: build command `pnpm --filter web build`, start command `pnpm --filter web start`.

The api command is written that way because of which process receives the host's `SIGTERM`. The
api's drain (below, and `apps/api/src/index.ts`) only runs in the process that gets the signal, and
`pnpm --filter api start` puts pnpm and the lifecycle shell it spawns in front of the api: pnpm
takes the signal at its default disposition and the api it started keeps running until the host
kills it, so the drain never happens and a send can be stranded exactly as the release order below
describes. `exec` makes the api itself the process the host started, with no runner left in front of
it. Migrations still run first and finish before the `exec`. `apps/api/src/shutdown.test.ts` reads
this command out of this file and signals it, so the two cannot drift apart.

1. New Project, Deploy from GitHub repo, `jzeng151/pop-engine`.
2. Add the two services with the commands above.
3. Set env vars per service from `apps/api/.env.example` and `apps/web/.env.example`. Point `WEB_ORIGIN` (api) at the web URL, `NEXT_PUBLIC_API_BASE_URL` (web) at the api URL, and `NEXT_PUBLIC_SITE_URL` at the exact public web origin.
4. Connect the deploy branch. The demo environment is seeded once and not redeployed after final rehearsal.

### Release order

The two services deploy separately and the api runs `pnpm migrate up` as it starts, so a rollout is
a window in which two builds and one schema are all live at once. The F-302 capacity rename and two
F-203 guarantees hold only if that window is opened in this order. All are one-off constraints for
their contract transition; the conditions for dropping each are stated with it.

1. **Deploy the web service first, verify it is live, remove older web rollback targets, then deploy
   the api.** Two contract changes require this order.

   **F-302 capacity rename (issue #236).** Before deploying the api that admits RSVPs against
   `capacity`, deploy the web build that reads a present `capacity` and falls back to `headcount`
   only when that field is absent. Verify that build can load and cancel from a synthetic guest list
   against the still-running old api. Then confirm no web build or selectable rollback target
   predating the rename remains in service. Only then deploy the api.

   The response shape alone does not make api-first safe. The compatibility response carries both
   fields, but a pre-rename page treats `headcount` as the enforced limit while the new api enforces
   `capacity`. With different numeric values it displays the wrong limit; with `capacity = null` it
   displays a finite limit enforced nowhere. Web-first removes that semantic window: the new web
   reads the old api's `headcount`, which that api enforces, then reads `capacity` after the api
   deploys. `apps/api/src/deployment-order.test.ts` fails if this instruction disappears while the
   shape-only response remains. Drop this F-302 constraint only after the rename is the oldest web
   build in service and no older rollback target is selectable.

   **F-203 reconciliation notice.** The api stops counting an alert it has permanently stopped on
   among the failures it says are being retried, and reports it under
   `alertsHeldForReconciliation` instead. A web build older than that field renders neither, so an
   alert nobody will send again would have no organizer-facing warning at all until the web service
   catches up. Deployed web-first the window is empty: this web build reads an absent
   `alertsHeldForReconciliation` as none and renders the rest of the checklist normally, which is
   what makes it safe against an api that does not send the field yet. Drop this F-203 constraint
   once the web deployment carrying the field is the oldest one in service.

2. **Empty the api's alert queue, then stop the running api, before the new one applies migration
   014**, rather than letting the new deployment start beside it.

   **The invariant every step below is checked against: no alert can have been handed to a provider
   before the instant this rollout's protection for it begins.** Three findings in a row on this
   section each moved a protection one step earlier and left the same gap, so the order here is the
   invariant, then the procedure, then the check of the procedure against the invariant rather than
   against the previous wording.

   **Why the protection cannot be a stamped attempt row.** A send the old build was killed in the
   middle of (accepted by the provider, its transaction never committed) is left `pending`, and a
   build that predates `alert_send_attempts` writes no attempt row for it, so nothing anywhere
   records when the provider was reached; migration 014's backfill covers `failed` rows only. Any
   attempt row this rollout writes for such an alert is a guess at that instant, and both directions
   of the guess fail the invariant. Stamped at the moment the last old process was gone, the hold
   begins after Resend may already have forgotten the key, which is a window in which a send
   happened and nothing records it. Stamped early enough to be a true lower bound on an unknowable
   handoff, it is already past `UNRESOLVED_ATTEMPT_HOLD_LIMIT_HOURS` and the first tick retries the
   row rather than holding it. The bound is the product owner's decision of 2026-08-04 and is not
   this runbook's to widen. So the rollout satisfies the invariant by leaving nothing in flight to
   protect, rather than by protecting something whose handoff time it cannot know.

   **a. Pause the alert queue while the old api is still running.** Pick `<T_resume>`, any UTC
   timestamp at least 24 hours ahead of the rollout, and write it down; it is a marker, not a
   deadline. Then run, against the environment's database:

   ```sql
   UPDATE alerts
      SET next_attempt_at = TIMESTAMPTZ '<T_resume>'
    WHERE status IN ('pending', 'failed')
      AND channel = 'email';
   ```

   The old build claims an alert only while its status is `pending` or `failed`, its `send_at` has
   passed, and its `next_attempt_at` is null or past; it re-reads all three under a row lock at the
   moment of the claim, and holds that lock across the provider call, which
   `apps/api/src/alerts/alert-delivery.ts` bounds at ten seconds. So this statement cannot return until
   every send that was in flight has committed its outcome, and no send can start after it returns.
   It can block for a few seconds per alert that is mid-send and **must not be cancelled**; it
   finishes because every row it has passed stays locked by it until it commits, and the poller's
   claim skips locked rows. No retry backoff reaches 24 hours, so it moves every row later and none
   earlier. **Write down the row count it reports**; step e has to report the same one.

   If the statement errors, or the old api dies while it is running, it has guaranteed nothing:
   re-run it, and if the process is already gone treat every pending or failed email alert as an
   escape in step c.

   **b. Stop the api.** Scale the api service to zero (or stop the current deployment), wait for the
   process to go, then confirm no api process from the previous build is still running when the
   migration executes. **Write down the UTC time at which you confirmed the last previous-build
   process was gone**, to the second; step c calls it `T_stop`.

   On this rollout the api you are stopping cannot drain, and you must not wait for it to. The drain
   ships in the build that carries migration 014, so the process being stopped predates the handler:
   it takes `SIGTERM` (or `SIGINT`) at its default disposition and dies where it stands. From the
   next rollout on, the running api stops accepting requests, finishes the ones it is already
   holding, stops its alert poller, waits for the send in flight to finish recording its outcome,
   exits 0, and logs a line naming the signal and then `alert poller drained; exiting`; wait for
   that second line then, and steps a, c and e are no longer needed. For this one, wait only for the
   process to be gone.

   **c. Confirm nothing escaped the pause.** With both recorded values substituted:

   ```sql
   SELECT id, idempotency_key, send_at
     FROM alerts
    WHERE status IN ('pending', 'failed')
      AND channel = 'email'
      AND (next_attempt_at IS NULL OR next_attempt_at <> TIMESTAMPTZ '<T_resume>')
      AND send_at <= TIMESTAMPTZ '<T_stop>';
   ```

   This lists the email alerts that became claimable after the pause committed and before the
   process was gone, which a checklist created or regenerated in that gap is the only way to
   produce. **The count must be 0.** Each row it does return is one the stopped build may have
   handed over, and no stamp can say when, so it is resolved the way any alert in that state is
   resolved: a person checks the sending service for a message to the recipient on that row, in that
   gap, and then marks the alert sent or leaves it to send. Do that before returning the service to
   traffic. Resend honours a repeated `Idempotency-Key` for 24 hours from the actual handoff, so it
   cannot be deferred.

   **d. Start the new build** and confirm `Migrations complete!` in its logs.

   **e. Un-pause the queue**, as soon as `Migrations complete!` has appeared:

   ```sql
   UPDATE alerts
      SET next_attempt_at = NULL
    WHERE next_attempt_at = TIMESTAMPTZ '<T_resume>';
   ```

   It must report the count step a reported, less any row step c listed: a regeneration in that gap
   clears the pause along with the rest of that row's schedule, which is what put it on step c's
   list. Then

   ```sql
   SELECT count(*) FROM alerts WHERE next_attempt_at = TIMESTAMPTZ '<T_resume>';
   ```

   must be 0. Until this has run, every email alert step a paused is scheduled past the end of the
   rollout and none of them will send. Only then return the service to traffic.

   The cost is stated so it is not a surprise: a failed alert partway through a retry backoff loses
   the remainder of it and gets one immediate attempt instead. That is the same trade the scheduler
   already makes when a regeneration moves a row's `send_at`, and the most it can cost is the
   fifteen-minute backoff step.

   **Why this satisfies the invariant.** After step a commits, no send is in flight and no email
   alert can be claimed by the old build, so every alert it did hand over has its outcome recorded
   and is `sent` or `failed` rather than a row the new poller reads as never attempted. The only
   alerts that can escape are the ones step c lists, and they are resolved by a person rather than
   by a guess at their handoff time. Nothing is stamped at an instant this rollout cannot know, so
   there is no window left in which a send happened and nothing records it.

   **Why not a drain-capable precursor**, which would satisfy the invariant the same way. It would
   be a build carrying the shutdown handler in `apps/api/src/index.ts` and the poller `stop()` that
   awaits the tick in flight, and carrying neither migration 014 nor any reader of
   `alert_send_attempts`. No such build has been released, and cutting one is its own release rather
   than a step in this one. Step a gets the same property from the database side, out of the build
   that is actually running, which is why it is written as a statement rather than as a deployment.

   Drop this step at the same time as the rest of step 2, once `014_alert_send_attempts` has been
   applied to the environment. From the next rollout on the drain does this in the process, by
   leaving no send in flight at all.

   Migration 014 creates `alert_send_attempts` and seeds it from
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
