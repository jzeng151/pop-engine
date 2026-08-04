# F-403 · Lead Capture and Consent

**Status:** PROPOSED (2026-07-26) — ready for review; not implementable until approved and listed in `docs/BASELINE.md`.

**Phase:** 2 · **Issue:** [#23](https://github.com/jzeng151/pop-engine/issues/23) · **Owner:** TBD · **Reviewer:** product owner plus affected architecture, contract, security, and lane owners (TBD) · **Approval date:** —

## Purpose and User Outcome

An attendee can check in while making separate, informed choices about event entry, email marketing, SMS marketing, and later emergency messaging.

## Scope

**In scope**

- Create or match a contact from F-401/F-302 and record purpose/channel-specific consent evidence.
- Support grant, withdrawal, suppression, and proof fields required by the approved policy.
- Keep event-entry processing separate from optional marketing choices.

**Non-goals**

- Assuming consent from attendance, bundling channels, buying contact lists, enrichment, or deciding a legal basis without policy approval.
- Cross-event CRM views owned by F-404.

## Dependencies and Baseline

- F-401 check-in, F-302 RSVP where present, and the F-701/F-702/F-703 gate.
- Approved consent copy, retention/export/correction/deletion policy, and contact identity rules.
- Baseline at draft time: PRD, Roadmap, Design, and Phase 0–1.5 Architecture approved 2026-07-22; `ARCHITECTURE-FUTURE.md` approved as a planning target 2026-07-25; NYC ruleset `nyc.v2.7`, rules schema `popengine-rules/v2`, and scenario fixtures v5 where regulatory output is consumed.
- The approval PR must re-pin any baseline version that changes before approval. A proposed or superseded input blocks implementation.

## Inputs, Outputs, State, Validation, and Errors

- Inputs are contact point, event-entry submission, and independent affirmative choices; outputs are contact/contact-point references plus immutable consent evidence.
- Consent state is absent → granted → withdrawn; a later grant creates new evidence and never rewrites the prior withdrawal. Every transition for one contact, purpose, channel, and contact point is ordered by a single consent generation for that exact key (F403-AC-08).
- Unknown identity matches remain separate or require organizer resolution; they never merge contact histories silently.
- Missing or unresolved material data stays visibly unset, unknown, pending, or failed as appropriate; it never becomes a successful or complete result.
- Invalid input produces a field or action-specific error without partial mutation. Retriable external failures preserve the user's confirmed state and expose a safe retry.

## UI and Accessibility

- Optional choices are unchecked by default, separately labeled by purpose/channel, and usable without consenting to marketing.
- The complete workflow is keyboard operable, uses programmatic labels and visible focus, does not encode status by color alone, and announces asynchronous success or failure.
- Empty, loading, permission-denied, validation, provider-failure, and unavailable states have explicit copy and a safe next action.

## System Impact

| Concern              | Proposed impact                                                                                                                                 |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| API                  | Public capture and authenticated consent-history/withdrawal operations require approved OpenAPI contracts and abuse controls.                   |
| Schema               | Forward migrations for contacts, contact points, consent records, and suppression records with workspace/event scope.                           |
| Jobs                 | None for capture; downstream delivery jobs must query central eligibility.                                                                      |
| Providers            | None.                                                                                                                                           |
| Privacy and security | Minimize contact data, rate-limit public capture, encrypt or restrict exports, redact logs, and implement approved retention/deletion behavior. |

Exact HTTP, JSON Schema, migration, job, and provider shapes belong in their reviewed machine contracts; this proposal does not authorize parallel local types or edits to merged migrations.

## Acceptance Criteria

1. **F403-AC-01:** Event entry succeeds when every optional consent choice, including email marketing, SMS marketing, and emergency messaging, is declined.
2. **F403-AC-02:** Each purpose/channel grant records exact copy/version, timestamp, source event, capture surface, and contact point without bundling another purpose.
3. **F403-AC-03:** Withdrawal creates durable evidence and immediately suppresses later eligible sends for that purpose/channel.
4. **F403-AC-04:** Duplicate submissions are idempotent and never manufacture a new consent grant.
5. **F403-AC-05:** Ambiguous contact matches never merge data or transfer consent without explicit authorized resolution.
6. **F403-AC-06:** Emergency-message consent can be granted and later withdrawn independently, with distinct evidence and immediate suppression, without changing event-entry or marketing consent.
7. **F403-AC-07:** Every grant provides an attendee-accessible, channel-appropriate withdrawal path authorized by an unguessable credential bound to that exact grant's contact, purpose, channel, and contact point, or by a provider-verified equivalent with the same scope, without requiring an account or organizer action. Invalid, cross-contact, cross-purpose, or cross-channel requests cannot withdraw consent, and success applies AC-03 only to the bound grant.
8. **F403-AC-08:** Grants, re-grants, and withdrawals for one contact, purpose, channel, and contact point are serialized on a single strictly increasing consent generation for that exact key. Each transition names the generation its request was composed against, commits only by compare-and-swap on that generation, and advances it; a request naming an earlier generation is rejected and creates no grant, so a capture composed before a withdrawal can never restore eligibility after it. A deliberate later re-grant is distinguished by being composed against the post-withdrawal generation and carrying its own capture identity, while a retry of the same capture carries that capture's identity, returns the original outcome under AC-04, and adds no evidence. Every eligibility decision reads the same generation, and a generation that is missing, stale, or undeterminable resolves as suppressed rather than eligible.

9. **F403-AC-09:** Public lead capture is rate limited per capture surface and per originating client, and a submission over that limit is refused without creating a contact, a consent grant, or a withdrawal, and without disclosing whether a contact point is already known. This belongs in a criterion rather than only under Privacy and security because the capture surface is public and unauthenticated and an implementation is built to the acceptance criteria: AC-04 makes duplicate submissions idempotent, which bounds what one repeated submission produces and not how many distinct submissions an unauthenticated caller may make, so without this criterion the surface is an open write path into contact and consent records. The exact limit and window are not established by any approved artifact today; they belong to the privacy/consent policy and contact identity contracts named in the Approval Blockers, so until those name them this criterion is testable only as "a configured finite limit is enforced and submissions over it are refused," not against a specific number.

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

- Do not enable lead reuse or campaigns until approved consent copy, retention, deletion, and suppression checks are live.
- Rollback disables the new surface and workers/provider calls without deleting confirmed user data or rewriting immutable plans, rulesets, revisions, or history.

## Approval Blockers

- Approve privacy/consent policy and copy with named owner.
- Approve contact identity, retention, export, correction, deletion, API, and migration contracts.
- Assign the owner and independent reviewer, approve this spec, and add it to `docs/BASELINE.md`.
