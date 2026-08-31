# F-701 · Authentication

**Status:** APPROVED (2026-07-28; actor-projection and account-deletion amendments approved 2026-08-30) · **Reviewer/approver:** product owner/user acting as product and architecture owner via PR #201 follow-up, with the 2026-08-30 amendments approved by the product owner · **Owner:** product owner · see `docs/BASELINE.md`.
**Phase:** 2 · **Issue:** [#26](https://github.com/jzeng151/pop-engine/issues/26) · **Provider decision:** `docs/ARCHITECTURE-FUTURE.md` AD-16

## Purpose and User Outcome

An organizer can establish, restore, recover, and end a secure identity session, and can delete the
account without leaving partial workspace membership changes, so later workspace-scoped features
can identify an actor without admitting users to an incompletely authorized product.

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
- Authenticated account deletion as an F-701 operation. Once F-702 ships, it composes the actor's
  F702-AC-11 M-06 self-leave across every active membership as one all-or-nothing operation.

**Non-goals**

- Defining workspaces, memberships, roles, authorization of existing organizer aggregates, account
  profiles, provider-management UI, or user-owned event persistence. Account deletion only
  composes F-702's approved self-leave semantics.
- Globally protecting public RSVP/check-in routes.
- Replacing the Cloudflare Access demo gate or opening a production beta.
- Custom password storage, a second identity provider, application-managed provider tokens, or
  service-role credentials in browser code.

## Dependencies and Baseline

- `docs/ARCHITECTURE-FUTURE.md` AD-16 is the approved provider/session decision.
- F-701 is the first Phase 2 feature but remains one production rollout gate with approved but
  unshipped F-702 and proposed, unapproved F-703.
- The current baseline is the manifest in `docs/BASELINE.md`; this feature does not consume or
  change the regulatory ruleset or fixtures. Account deletion consumes F-702's approved M-06
  behavior, but its exact shared API and database contracts remain deferred and unapproved.

## Inputs, Outputs, State, Validation, and Errors

- Inputs are email/password credentials, a Google authorization response, recovery proof, a
  Supabase bearer token plus an allow-listed return location, or an authenticated account-deletion
  request with a stable client-supplied request identity.
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
- Account deletion binds a stable client-supplied request identity to its outcome. Before changing
  any membership, it performs one preflight over every active membership and applies F702-AC-11
  M-06's last-owner invariant to each. If any membership would lose its last active owner, the
  whole deletion is refused and changes no account, session, membership, audit, or provider state.
  Otherwise the membership leaves commit together with the recorded deletion outcome. A matching
  retry returns that outcome without a second leave or audit record. The operation never assigns a
  replacement owner and never exposes a separate F-702 membership transition.

## UI and Accessibility

- Sign-up, sign-in, Google sign-in, recovery, password update, expired-link, configuration-error,
  account/session, sign-out, and account-deletion success or refusal states provide visible text
  and a safe next action.
- Forms use programmatic labels, semantic controls, keyboard-operable actions, and visible focus.
- Secret inputs are not repopulated after navigation or failure.

## System Impact

| Concern              | Impact                                                                                                                                                                                                                                                                                                                                                                         |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| API                  | Adds protected `GET /api/session` as an actor-resolution proof and requires an authenticated account-deletion operation. The actor semantics include an optional verified email value and explicit verified-email state. Exact session and deletion OpenAPI shapes require separate product-owner approval before F-702 invitation matching or account deletion consumes them. |
| Schema               | Supabase owns identity/session storage. Account-deletion replay requires a durable recorded outcome and composes F-702 membership writes, but this amendment approves no exact table, column, constraint, or migration shape.                                                                                                                                                  |
| Jobs                 | None approved. Supabase performs verification, recovery, and Google provider delivery. Any account-deletion provider sequencing belongs in the later reviewed machine contract.                                                                                                                                                                                                |
| Providers            | Supabase Auth is the sole application identity/session provider and owns identity deletion; email/password and Google OAuth are authentication methods within it. The exact deletion sequence remains deferred to the reviewed machine contract.                                                                                                                               |
| Privacy and security | SSR cookies and server-side code exchange; Supabase-supported claims verification; allow-listed return paths; no service-role browser key or exposed provider token. Account deletion preflights every active membership and either commits every permitted self-leave with its recorded outcome or changes none.                                                              |

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
   and F-701 infers no workspace, membership, ownership, or role claim. Account deletion may invoke
   only the stored-membership checks and self-leave composition F701-AC-08 names; it grants no
   workspace authority.
7. **F701-AC-07:** Deploying F-701 alone leaves the Cloudflare demo gate, synthetic-data policy,
   authenticated user-owned persistence, and external beta restrictions in place until approved
   F-702 and proposed F-703 are both shipped, with F-703 first approved.
8. **F701-AC-08:** An authenticated account-deletion request binds a stable client-supplied request
   identity to the actor and the original outcome. Inside one serialized transaction, a single
   preflight reads the complete set of active memberships and applies F702-AC-11 M-06's self-leave
   and last-owner rule to each. If any leave would remove the last active owner, the whole deletion
   is refused and changes no account, session, membership, audit, or provider state. Otherwise every
   self-leave and the durable deletion outcome commit as one all-or-nothing operation. A matching
   retry resolves and returns that recorded outcome before current membership-state checks, creates
   no second effect, and reveals nothing beyond the first request. No partial membership deletion or
   automatic owner reassignment is allowed. This is an F-701 composition of M-06, not a new public
   F-702 transition. The exact endpoint, request, response, durable-outcome storage, locking order,
   and provider sequence require later product-owner approval in the reviewed OpenAPI and schema
   contracts.

## Fixtures and Verification

- Automated tests map to F701-AC-01 through F701-AC-08 and cover email and Google initiation,
  callback success/failure, open-redirect rejection, session restoration/sign-out, missing
  configuration, API bearer verification/failure, verified, unverified, and unavailable email
  states, and unchanged public-route behavior.
- F701-AC-08 includes three integration fixtures. The success fixture gives the actor active
  memberships in several workspaces, with another active owner in every workspace where the actor
  is an owner, and proves one request ends every membership and records one deletion outcome. The
  refusal fixture makes the actor the last owner of one workspace and proves the single preflight
  leaves the account, session, every membership, every audit stream, and provider state unchanged.
  The replay fixture loses the successful response and proves the matching request identity returns
  the recorded outcome without another leave, audit entry, or provider effect.
- Regulatory fixtures: none; this feature does not define regulatory ground truth.

## Allowed Footprint and Coordination

- `apps/web` and `apps/api` authentication code and tests; placeholder-only environment examples;
  `DEPLOY.md`; this spec; and the directly related baseline/architecture records.
- Dependencies are limited to the current Supabase SSR and JavaScript clients.
- No repository restructuring or F-702/F-703 implementation is authorized. The 2026-08-30
  amendments approve the actor-projection and account-deletion semantics above, not an exact
  OpenAPI, shared-schema, migration, or provider shape. Reviewed machine contracts must implement
  those semantics before F-702 invitation matching or account deletion can claim completion.

## Rollout and Fallback

- Deploy only as an authentication foundation behind the existing Cloudflare Access gate with
  synthetic data.
- Keep account deletion unavailable until F-702 and the reviewed deletion machine contracts ship.
- Production activation and persistence of authenticated user-owned data remain disabled until
  F-702 workspace/membership tenancy and F-703 role enforcement are approved, implemented, and
  tested.
- Rollback removes the F-701 surface/configuration without changing event data, rulesets, plans, or
  migrations.
- Once account deletion ships, rollback disables new deletion requests. It never recreates an
  account or membership whose deletion completed.
