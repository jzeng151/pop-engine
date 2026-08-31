# F-701 · Authentication

**Status:** APPROVED (2026-07-28; actor-projection amendment approved 2026-08-30) · **Reviewer/approver:** product owner/user acting as product and architecture owner via PR #201 follow-up, with the 2026-08-30 amendment approved by the product owner · **Owner:** product owner · see `docs/BASELINE.md`.
**Phase:** 2 · **Issue:** [#26](https://github.com/jzeng151/pop-engine/issues/26) · **Provider decision:** `docs/ARCHITECTURE-FUTURE.md` AD-16

## Purpose and User Outcome

An organizer can establish, restore, recover, and end a secure identity session so later
workspace-scoped features can identify an actor without admitting users to an incompletely
authorized product.

## Scope

**In scope**

- Supabase Auth as the single identity and session provider.
- Supabase email/password sign-up and sign-in with email verification, password recovery, and
  password update.
- Google OAuth through the Supabase Google provider; Google does not create a second application
  session system.
- Next.js App Router server-side PKCE callback exchange and cookie-backed SSR session
  restoration/refresh.
- Allow-listed internal return paths, explicit unavailable/expired/error states, sign-out, and a
  minimal account/session surface proving actor resolution.
- A reusable Express bearer boundary that verifies Supabase claims for routes that explicitly opt
  in.

**Non-goals**

- Workspaces, memberships, roles, authorization of existing organizer aggregates, account
  profiles, provider-management UI, or user-owned event persistence.
- Globally protecting public RSVP/check-in routes.
- Replacing the Cloudflare Access demo gate or opening a production beta.
- Custom password storage, a second identity provider, application-managed provider tokens, or
  service-role credentials in browser code.

## Dependencies and Baseline

- `docs/ARCHITECTURE-FUTURE.md` AD-16 is the approved provider/session decision.
- F-701 is the first Phase 2 feature but remains one production rollout gate with unapproved
  F-702 and F-703.
- The current baseline is the manifest in `docs/BASELINE.md`; this feature does not consume or
  change the regulatory ruleset, fixtures, shared data contracts, or database schema.

## Inputs, Outputs, State, Validation, and Errors

- Inputs are email/password credentials, a Google authorization response, recovery proof, or a
  Supabase bearer token plus an allow-listed return location.
- Outputs are a Supabase-managed cookie session in the web app and a minimal server-derived actor
  projection at an explicitly protected API boundary. The projection includes the verified
  Supabase subject and explicit verified-email state. Only when that state confirms ownership does
  it include the verified email value that later features may use for identity matching. An absent,
  unverified, or unavailable state provides no email identity for matching.
- Session state is unauthenticated → authenticated → expired or signed out. Verification and
  recovery links exchange their one-time code server-side before establishing the session.
- Return locations are limited to `/`, `/account`, and `/auth/update-password`; any other value
  falls back to `/account`.
- Missing configuration and missing, expired, or invalid codes/tokens fail explicitly. Credentials
  and provider tokens are not logged, returned by the account/session proof, or stored in
  application `localStorage`.
- Recovery confirmation uses non-enumerating public copy. Supabase configuration and provider
  behavior govern password strength, rate limits, session lifetime, and administrative revocation.
  F-701 adds no competing policy, custom credential store, or application-level account-linking
  workflow; those settings require production review before the joint rollout gate opens.

## UI and Accessibility

- Sign-up, sign-in, Google sign-in, recovery, password update, expired-link, configuration-error,
  account/session, and sign-out states provide visible text and a safe next action.
- Forms use programmatic labels, semantic controls, keyboard-operable actions, and visible focus.
- Secret inputs are not repopulated after navigation or failure.

## System Impact

| Concern              | Impact                                                                                                                                                                                                                                                                                                                                                     |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| API                  | Adds protected `GET /api/session` as an actor-resolution proof; the reusable bearer boundary applies only where explicitly mounted. Its approved actor semantics include an optional verified email value and explicit verified-email state, but the exact OpenAPI shape requires separate product-owner approval before F-702 implementation consumes it. |
| Schema               | None. Supabase owns identity/session storage; PopEngine adds no migration.                                                                                                                                                                                                                                                                                 |
| Jobs                 | None. Supabase performs verification, recovery, and Google provider delivery.                                                                                                                                                                                                                                                                              |
| Providers            | Supabase Auth is the sole application identity/session provider; email/password and Google OAuth are authentication methods within it.                                                                                                                                                                                                                     |
| Privacy and security | SSR cookies and server-side code exchange; Supabase-supported claims verification; allow-listed return paths; no service-role browser key or exposed provider token.                                                                                                                                                                                       |

## Acceptance Criteria

1. **F701-AC-01:** Email/password sign-up initiates verification, verified credentials establish a
   Supabase session, and invalid or unavailable states do not create an application session.
2. **F701-AC-02:** Google sign-in starts through Supabase Auth and its callback establishes the same
   Supabase cookie session used by email/password sign-in.
3. **F701-AC-03:** The server exchanges callback codes, restores/refreshes the SSR cookie session,
   and rejects external or unlisted return locations.
4. **F701-AC-04:** Recovery initiates with non-enumerating copy, a valid recovery session can update
   the password, and sign-out ends the browser session.
5. **F701-AC-05:** The account surface and protected API proof resolve only the verified Supabase
   subject and explicit verified-email state. When that state confirms ownership, the projection
   includes the verified email value a later identity match may consume. An absent, unverified, or
   unavailable state provides no email identity for matching. Missing, malformed, expired, or
   unverifiable bearer credentials fail closed without exposing the token.
6. **F701-AC-06:** Existing public RSVP/check-in routes remain outside the F-701 bearer boundary,
   and F-701 makes no workspace, membership, ownership, or role claim.
7. **F701-AC-07:** Deploying F-701 alone leaves the Cloudflare demo gate, synthetic-data policy,
   authenticated user-owned persistence, and external beta restrictions in place until F-702 and
   F-703 are separately approved and shipped.

## Fixtures and Verification

- Automated tests map to F701-AC-01 through F701-AC-07 and cover email and Google initiation,
  callback success/failure, open-redirect rejection, session restoration/sign-out, missing
  configuration, API bearer verification/failure, verified, unverified, and unavailable email
  states, and unchanged public-route behavior.
- Regulatory fixtures: none; this feature does not define regulatory ground truth.

## Allowed Footprint and Coordination

- `apps/web` and `apps/api` authentication code and tests; placeholder-only environment examples;
  `DEPLOY.md`; this spec; and the directly related baseline/architecture records.
- Dependencies are limited to the current Supabase SSR and JavaScript clients.
- No migration, repository restructuring, or F-702/F-703 implementation is authorized. The
  2026-08-30 amendment approves the actor-projection semantics above, not an exact OpenAPI or shared
  schema shape. The runtime and reviewed machine contract must implement those semantics before
  F-702 can claim its invitation matching complete.

## Rollout and Fallback

- Deploy only as an authentication foundation behind the existing Cloudflare Access gate with
  synthetic data.
- Production activation and persistence of authenticated user-owned data remain disabled until
  F-702 workspace/membership tenancy and F-703 role enforcement are approved, implemented, and
  tested.
- Rollback removes the F-701 surface/configuration without changing event data, rulesets, plans, or
  migrations.
