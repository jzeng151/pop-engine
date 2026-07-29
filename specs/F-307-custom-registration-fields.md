# F-307 · Custom Registration Fields

**Status:** PROPOSED (2026-07-26) — ready for review; not implementable until approved and listed in `docs/BASELINE.md`.

**Phase:** 3 · **Issue:** [#37](https://github.com/jzeng151/pop-engine/issues/37) · **Owner:** TBD · **Reviewer:** product owner plus affected architecture, contract, security, and lane owners (TBD) · **Approval date:** —

## Purpose and User Outcome

An organizer can collect a small, safe set of extra RSVP answers without adding arbitrary code, files, payments, or sensitive-data workflows.

## Scope

**In scope**

- Organizer-defined short text, long text, single-select, and checkbox fields with an approved allow-listed non-sensitive purpose, label, required flag, order, and optional help text.
- Publish a versioned registration form and preserve answers against the exact field version shown.
- CSV export through F-404 with safe column names and values.

**Non-goals**

- Arbitrary HTML, scripts, formulas, file uploads, payments, medical/identity-document fields, branching logic, or a general form builder.
- Changing F-101 intake or rules-engine inputs.

## Dependencies and Baseline

- F-302 registration, F-404 export where available, and the F-701/F-702/F-703 gate.
- Approved field limits, prohibited-data policy, retention, and form-version contract.
- F-306 and F-307 cannot be enabled together for a form with required custom answers until an approved shared waitlist answer/form-version contract exists.
- Baseline at draft time: PRD, Roadmap, Design, and Phase 0–1.5 Architecture approved 2026-07-22; `ARCHITECTURE-FUTURE.md` approved as a planning target 2026-07-25; NYC ruleset `nyc.v2.7`, rules schema `popengine-rules/v2`, and scenario fixtures v5 where regulatory output is consumed.
- The approval PR must re-pin any baseline version that changes before approval. A proposed or superseded input blocks implementation.

## Inputs, Outputs, State, Validation, and Errors

- Inputs are bounded field definitions using an approved purpose key; outputs are a versioned public form projection and validated answer set.
- Draft fields become active only on publish; changing an active definition creates a new version and preserves prior answers.
- Unknown field type/version, oversized text, invalid option, or omitted required answer rejects the submission without partial RSVP mutation.
- Missing or unresolved material data stays visibly unset, unknown, pending, or failed as appropriate; it never becomes a successful or complete result.
- Invalid input produces a field or action-specific error without partial mutation. Retriable external failures preserve the user's confirmed state and expose a safe retry.

## UI and Accessibility

- Builder and public form use programmatic labels/help/errors; organizer preview matches the published mobile form.
- The complete workflow is keyboard operable, uses programmatic labels and visible focus, does not encode status by color alone, and announces asynchronous success or failure.
- Empty, loading, permission-denied, validation, provider-failure, and unavailable states have explicit copy and a safe next action.

## System Impact

| Concern              | Proposed impact                                                                                                                               |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| API                  | Form definition/version and public answer operations require approved OpenAPI/JSON Schema contracts.                                          |
| Schema               | Forward migrations for versioned field definitions and answers; no executable expressions.                                                    |
| Jobs                 | None.                                                                                                                                         |
| Providers            | None.                                                                                                                                         |
| Privacy and security | Strict bounds/sanitization, prohibited-data warning, workspace scope, safe rendering/export, rate limits, and retention/deletion enforcement. |

Exact HTTP, JSON Schema, migration, job, and provider shapes belong in their reviewed machine contracts; this proposal does not authorize parallel local types or edits to merged migrations.

## Acceptance Criteria

1. **F307-AC-01:** Only the four approved field types and bounded label/help/option counts can be published.
2. **F307-AC-02:** A public submission compare-and-swaps the current active form version and validates required, length, and option membership atomically with RSVP; a retired version is rejected unless accompanied by an approved bounded server-issued in-flight grace token.
3. **F307-AC-03:** Editing a published definition creates a new version; earlier answers remain readable against their original labels/options.
4. **F307-AC-04:** User text renders and exports as data, never HTML, script, formula, or engine input.
5. **F307-AC-05:** Only approved non-sensitive purpose keys and supported field types can be published; organizer-controlled labels, help text, and options are validated against the approved prohibited-data policy, and disallowed definitions are rejected. The form displays mandatory prohibited-data guidance and applies the approved retention/deletion policy; the feature does not claim to classify arbitrary attendee answers.
6. **F307-AC-06:** While an active form has required custom answers, F-306 waitlist join and promotion remain unavailable unless an approved shared contract pins the exact form/answer versions to the waitlist entry, validates them at join and promotion, and atomically links the validated answer set to the promoted RSVP. The system cannot silently drop required answers or create unapproved waitlist-answer storage.

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

- Start with the four native field types; add a type only through a Roadmap/spec change with privacy and export behavior.
- Rollback disables the new surface and workers/provider calls without deleting confirmed user data or rewriting immutable plans, rulesets, revisions, or history.

## Approval Blockers

- Approve the non-sensitive purpose allow-list, field/length/option limits, prohibited-data copy, versioning, and retention policy.
- Approve the shared F-306/F-307 waitlist answer/form-version contract before enabling both features together.
- Assign the owner and independent reviewer, approve this spec, and add it to `docs/BASELINE.md`.
