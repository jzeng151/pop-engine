# F-712 · Rules Admin: Rule Test Runner

**Status:** PROPOSED (2026-07-26) — ready for review; not implementable until approved and listed in `docs/BASELINE.md`.

**Phase:** 4 · **Issue:** [#65](https://github.com/jzeng151/pop-engine/issues/65) · **Owner:** TBD · **Reviewer:** product owner plus affected architecture, contract, security, and lane owners (TBD) · **Approval date:** —

## Purpose and User Outcome

Rules reviewers can run affected scenarios quickly and the full approved suite before publication, with immutable inputs and reproducible results.

## Scope

**In scope**

- Validate a draft artifact, select affected fixtures from declared coverage, run targeted and full suites, and retain deterministic results/diffs.
- Block publication unless the required full suite and policy checks pass for the exact candidate bytes.
- Expose fixture, engine, ruleset candidate checksum, calendar, `today`, and command/version provenance.

**Non-goals**

- Generating expected outputs from the candidate, auto-approving a semantic change, skipping full-suite publication gate, or mutating fixtures.
- Running arbitrary code supplied by rule data.

## Dependencies and Baseline

- F-710 drafts and approved engine/fixture contracts.
- F-714 is a downstream consumer of immutable F-712 run results, not a prerequisite for the runner.
- Approved isolated runner, resource limits, coverage mapping, and artifact checksum contract.
- Baseline at draft time: PRD, Roadmap, Design, and Phase 0–1.5 Architecture approved 2026-07-22; `ARCHITECTURE-FUTURE.md` approved as a planning target 2026-07-25; NYC ruleset `nyc.v2.7`, rules schema `popengine-rules/v2`, and scenario fixtures v5 where regulatory output is consumed.
- The approval PR must re-pin any baseline version that changes before approval. A proposed or superseded input blocks implementation.

## Inputs, Outputs, State, Validation, and Errors

- Inputs are exact candidate artifact, engine version, fixtures, calendar, and `today`; output is immutable per-fixture pass/fail/error/diff.
- Run state is queued → running → passed, failed, errored, or cancelled; an error never counts as pass.
- Changing any input invalidates approval and requires a new run.
- Missing or unresolved material data stays visibly unset, unknown, pending, or failed as appropriate; it never becomes a successful or complete result.
- Invalid input produces a field or action-specific error without partial mutation. Retriable external failures preserve the user's confirmed state and expose a safe retry.

## UI and Accessibility

- Results show targeted/full scope, progress, exact versions/checksum, pass/fail/error in text, structured diff, and rerun action.
- The complete workflow is keyboard operable, uses programmatic labels and visible focus, does not encode status by color alone, and announces asynchronous success or failure.
- Empty, loading, permission-denied, validation, provider-failure, and unavailable states have explicit copy and a safe next action.

## System Impact

| Concern              | Proposed impact                                                                                                                            |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| API                  | Test-run create/status/result/cancel operations require platform-admin OpenAPI contracts.                                                  |
| Schema               | Forward migrations for immutable run metadata/results/approvals; large logs/artifacts use controlled storage if needed.                    |
| Jobs                 | Isolated durable test jobs with resource/time limits, cancellation, deterministic environment, and no network.                             |
| Providers            | None.                                                                                                                                      |
| Privacy and security | Rules-admin scope, no eval/dynamic code/network, strict artifact validation, resource limits, redacted logs, and immutable result linkage. |

Exact HTTP, JSON Schema, migration, job, and provider shapes belong in their reviewed machine contracts; this proposal does not authorize parallel local types or edits to merged migrations.

## Acceptance Criteria

1. **F712-AC-01:** A run records exact candidate bytes/checksum, engine, fixture set/version, calendar, `today`, command, and result for every fixture.
2. **F712-AC-02:** Targeted selection follows approved coverage metadata and rejects the publication gate unless every changed or added semantic branch has an approved fixture that actually exercises it; numeric thresholds require below/at/above fixtures. Empty or stale coverage metadata fails even when the unchanged full suite passes, and F-714 still requires the full suite for the same candidate checksum.
3. **F712-AC-03:** Failure, evaluation error, timeout, cancellation, missing fixture, or changed input cannot count as a passing publication gate.
4. **F712-AC-04:** Expected outputs remain approved fixture data and are never regenerated from the candidate under test.
5. **F712-AC-05:** Identical inputs produce byte-stable result artifacts and no rule data executes as code.
6. **F712-AC-06:** Creating a run binds the request to a stable client-supplied request identity, committed with the run under a uniqueness constraint scoped to the candidate. A retry presenting the same identity returns the original run, and its result once complete, and enqueues no second job; a deliberate rerun of the same candidate sends a new identity. This is request identity, never content uniqueness: two genuinely distinct runs over one candidate checksum, engine, fixture set, calendar, and `today` are both recorded, and a repeated identity is never rejected as a duplicate value.

   AC-01 records the input tuple, which cannot tell a retry from a deliberate rerun because both carry the same tuple by construction. When the create transaction commits and its response is lost, the retry enqueues a second isolated full-suite job: runner capacity is spent twice, and two result artifacts exist for one intended run, each usable as an F-714 gate artifact for the same checksum.

## Fixtures and Verification

- Planned automated fixture IDs are the acceptance IDs above; each must map one-to-one to a runnable test before approval can claim implementation readiness.
- Regulatory fixtures: The complete approved regulatory fixture suite plus schema-invalid, unexercised semantic branch, missing numeric boundary, evaluation-error, timeout, and determinism runner fixtures.
- Security-sensitive and cross-workspace paths require negative authorization tests; provider paths require success, duplicate-delivery, retry, invalid-signature, and permanent-failure tests where applicable.

## Allowed Footprint and Coordination

- `apps/web` and `apps/api` feature code and tests.
- New ordered forward migrations and approved OpenAPI/JSON Schema changes required by this feature.
- No repository restructuring, speculative package, or unrelated feature edit.
- Shared contracts, migrations, provider adapters, engine/rules artifacts, consent policy, and cross-lane UI primitives require the approvals named in `docs/DOCUMENTATION-GOVERNANCE.md` §6.

## Rollout and Fallback

- Keep existing CLI/CI fixture command as fallback until the admin runner proves byte-equivalent.
- Rollback disables the new surface and workers/provider calls without deleting confirmed user data or rewriting immutable plans, rulesets, revisions, or history.

## Approval Blockers

- Approve runner isolation/resources, coverage metadata, result artifact, full-suite gate, and equivalence to existing CI.
- Assign the owner and independent reviewer, approve this spec, and add it to `docs/BASELINE.md`.
