# F-701 · Authentication

**Status:** PROPOSED (2026-07-26) — ready for review; not implementable until approved and listed in `docs/BASELINE.md`.

**Phase:** 2 · **Issue:** [#26](https://github.com/jzeng151/pop-engine/issues/26) · **Owner:** TBD · **Reviewer:** product owner plus affected architecture, contract, security, and lane owners (TBD) · **Approval date:** —

## Purpose and User Outcome

An organizer can establish and end a secure identity session so later workspace-scoped features can identify an actor without admitting users to an incompletely authorized product.

## Scope

**In scope**

- Sign-in, session restoration, sign-out, expiration, revocation, and account-recovery behavior through one approved identity strategy.
- Server-derived actor identity for protected API requests.
- Security controls for credentials, sessions, CSRF, redirect targets, enumeration, and abuse.

**Non-goals**

- Workspaces, memberships, roles, user-owned event persistence, or external beta access.
- A custom identity provider, multiple sign-in strategies, social-profile features, or billing.

## Dependencies and Baseline

- F-701 is the first Phase 2 feature but is one production gate with F-702 and F-703.
- ADR: authentication provider/strategy, session lifetime, recovery, and account-linking policy.
- Baseline at draft time: PRD, Roadmap, Design, and Phase 0–1.5 Architecture approved 2026-07-22; `ARCHITECTURE-FUTURE.md` approved as a planning target 2026-07-25; NYC ruleset `nyc.v2.7`, rules schema `popengine-rules/v2`, and scenario fixtures v5 where regulatory output is consumed.
- The approval PR must re-pin any baseline version that changes before approval. A proposed or superseded input blocks implementation.

## Inputs, Outputs, State, Validation, and Errors

- Inputs are provider credentials or recovery proof plus an allow-listed return location; outputs are an opaque server-recognized session and a minimal actor projection.
- Session state is unauthenticated → authenticated → expired, revoked, or signed out; recovery changes credentials and revokes prior sessions according to the ADR.
- Authentication failure never reveals whether an account exists, and tokens, credentials, and recovery secrets never enter logs, URLs, analytics, or client-readable persistence.
- Missing or unresolved material data stays visibly unset, unknown, pending, or failed as appropriate; it never becomes a successful or complete result.
- Invalid input produces a field or action-specific error without partial mutation. Retriable external failures preserve the user's confirmed state and expose a safe retry.

## UI and Accessibility

- Sign-in, recovery, expired-session, and sign-out states return the user to a safe location and preserve no secret input.
- The complete workflow is keyboard operable, uses programmatic labels and visible focus, does not encode status by color alone, and announces asynchronous success or failure.
- Empty, loading, permission-denied, validation, provider-failure, and unavailable states have explicit copy and a safe next action.

## System Impact

| Concern              | Proposed impact                                                                                                                                                               |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| API                  | Protected routes derive actor identity from the session. Exact auth routes and error contracts require the F-701 OpenAPI change.                                              |
| Schema               | Forward migration for the approved identity/session model; no workspace-owned product rows are created.                                                                       |
| Jobs                 | Only recovery or verification delivery if required by the selected strategy; use the durable job contract once approved.                                                      |
| Providers            | One provider/strategy selected by ADR behind an adapter; no second provider until a scheduled feature requires it.                                                            |
| Privacy and security | Credential/session secrets are hashed or encrypted as appropriate, cookies use secure attributes, rate limits cover auth and recovery, and redirect targets are allow-listed. |

Exact HTTP, JSON Schema, migration, job, and provider shapes belong in their reviewed machine contracts; this proposal does not authorize parallel local types or edits to merged migrations.

## Acceptance Criteria

1. **F701-AC-01:** Valid credentials establish one session and protected requests resolve the correct actor without exposing a provider token.
2. **F701-AC-02:** Invalid credentials return the same public failure shape for existing and nonexistent accounts and create no session.
3. **F701-AC-03:** Sign-out, administrator revocation, credential recovery, and expiration each prevent reuse of the affected session.
4. **F701-AC-04:** Cross-site request, open-redirect, session-fixation, replay, brute-force, and secret-logging tests fail closed.
5. **F701-AC-05:** Deploying F-701 alone leaves authenticated user-owned persistence and external beta access disabled.

## Fixtures and Verification

- Planned automated fixture IDs are the acceptance IDs above; each must map one-to-one to a runnable test before approval can claim implementation readiness.
- Regulatory fixtures: none; this feature does not define regulatory ground truth.
- Security-sensitive and cross-workspace paths require negative authorization tests; provider paths require success, duplicate-delivery, retry, invalid-signature, and permanent-failure tests where applicable.

## Allowed Footprint and Coordination

- `apps/web` and `apps/api` feature code and tests.
- New ordered forward migrations and approved OpenAPI/JSON Schema changes required by this feature.
- No repository restructuring, speculative package, or unrelated feature edit.
- Shared contracts, migrations, provider adapters, engine/rules artifacts, consent policy, and cross-lane UI primitives require the approvals named in `docs/DOCUMENTATION-GOVERNANCE.md` §6.

## Rollout and Fallback

- Deploy behind the existing access gate with production activation disabled until F-702 and F-703 pass their joint gate.
- Rollback disables the new surface and workers/provider calls without deleting confirmed user data or rewriting immutable plans, rulesets, revisions, or history.

## Approval Blockers

- Approve the authentication ADR and threat model.
- Approve the auth OpenAPI contract, forward migration, secret-handling runbook, and production-gate check.
- Assign the owner and independent reviewer, approve this spec, and add it to `docs/BASELINE.md`.
