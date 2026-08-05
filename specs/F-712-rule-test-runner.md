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
- F-703 separate platform rules-admin role, which `F712-AC-07` requires at every run status read, result read, and export. No earlier revision of this spec declared it, which is why nothing here was bound by `F703-AC-04`. F-703 is PROPOSED, so that role is not an approved input today and this spec is not implementable against it until F-703 is approved.
- F-714 is a downstream consumer of immutable F-712 run results, not a prerequisite for the runner.
- Approved isolated runner, resource limits, coverage mapping, and artifact checksum contract.
- Baseline at draft time: PRD, Roadmap, Design, and Phase 0–1.5 Architecture approved 2026-07-22; `ARCHITECTURE-FUTURE.md` approved as a planning target 2026-07-25; NYC ruleset `nyc.v2.7`, rules schema `popengine-rules/v2`, and scenario fixtures v5 where regulatory output is consumed.
- Operand binding and replay ordering for client-supplied identities: `specs/F-411-staff-roles-credentialed-entry.md` F411-AC-08 states once, for this whole branch, that a client-supplied identity is committed with the operands that determine its recorded result and that a reuse carrying different operands is a conflict rather than a replay, and that a committed identity is resolved before any version, generation, state, authority, or limit check whose answer the committed operation itself changed. Every identity criterion below relies on it. F-411 is PROPOSED, so that rule is not an approved input today and this spec is not implementable against it until F-411 is approved or the rule is promoted to an approved shared invariant; F411-AC-08 records both paths.
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

   A run reaches exactly one terminal state. A run is in exactly one of `queued`, `running`, `passed`, `failed`, `errored`, or `cancelled`; the last four are terminal, and no transition leaves a terminal state. Every transition in the table below, cancellation included, names the run state and version it read and compare-and-swaps that version inside the transaction that performs it, so for every pair of transitions competing on one run exactly one wins and the loser reports the state that won rather than its own outcome.

   | ID   | Transition                            | Who performs it                      | From      | To                                                                                | Effect of losing the compare-and-swap                                                                           |
   | ---- | ------------------------------------- | ------------------------------------ | --------- | --------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
   | R-01 | Create                                | an authorized platform administrator | absent    | `queued`                                                                          | no run version exists to compare; the F712-AC-06 request identity is unique within the candidate                |
   | R-02 | Claim                                 | one worker                           | `queued`  | `running`                                                                         | the losing worker starts nothing, runs no fixture, and consumes no runner capacity                              |
   | R-03 | Cancel before the run starts          | an authorized platform administrator | `queued`  | `cancelled`                                                                       | the cancellation is refused and reports `running`; the administrator cancels again against `running` under R-04 |
   | R-04 | Cancel after the run starts           | an authorized platform administrator | `running` | `cancelled`                                                                       | the cancellation is refused and reports the terminal result that committed first; it overwrites nothing         |
   | R-05 | Complete                              | the claiming worker                  | `running` | `passed`, `failed`, or `errored`                                                  | the worker's write is rejected, it records no result, and the cancelled state stands                            |
   | R-06 | Time out                              | the runner's own bound               | `running` | one of `failed`, `errored`, or `cancelled` under the approved timeout disposition | as R-05; a timeout terminates the run in exactly one named state and never leaves it in none                    |
   | R-07 | Cancel a run that is already terminal | nobody; the request is rejected      | terminal  | none                                                                              | the version is read, compared, and rejected before any write; the run keeps the state it reached                |

   R-03 is what makes cancellation reachable before a worker claims the run. Without it the only transition competing on the queued version is R-02, so a cancellation issued while the run is still `queued` either has no defined effect or is recorded somewhere the worker does not read, and the worker claims and runs anyway; the administrator is told the run was cancelled and F-714 later finds a result artifact for that candidate checksum. R-03 and R-02 compare and swap the same queued version, so exactly one of them wins: either the run is cancelled and no worker ever claims it and no runner capacity is spent, or the worker claims it first and the administrator's cancellation is refused with `running`, which is a state R-04 already covers. Enumerating the whole lifecycle here, rather than fencing the queued case beside the running one, is what stops a fourth round: every state a run can be in and every transition out of it is named above, and any state later added to the state prose has to arrive with its row.

   Which of `failed`, `errored`, or `cancelled` a timeout records is not established by any approved artifact today; it belongs to the runner isolation and resource limits named in the Approval Blockers, which must name it. Until that approval does, R-06 is testable only as "a timed-out run reaches exactly one terminal state, that state is never `passed`, and no publication gate accepts it," not against a specific disposition.

   The earlier round on this spec fixed run creation: F712-AC-06 binds a stable request identity so a lost response cannot enqueue a second job for one intended run. That covered the entry to the lifecycle and left the exit, where this criterion listed cancellation among the outcomes that cannot pass but never made the terminal writes compete. Both sides could read `running`, so a worker could record a passing result after an administrator cancelled and F-714 could consume as a gate artifact for that candidate checksum a run the administrator was told was cancelled, which is the outcome this criterion exists to forbid; equally, a late cancellation could overwrite a result already reported as passed. Naming the whole terminal set on one version, rather than fencing cancellation alone beside the existing rule, is what keeps the next outcome added to the state prose from arriving unfenced.

4. **F712-AC-04:** Expected outputs remain approved fixture data and are never regenerated from the candidate under test.
5. **F712-AC-05:** Identical inputs produce byte-stable result artifacts and no rule data executes as code.
6. **F712-AC-06:** Creating a run binds the request to a stable client-supplied request identity, committed with the run under a uniqueness constraint scoped to the candidate. A retry presenting the same identity returns the original run, and its result once complete, and enqueues no second job; a deliberate rerun of the same candidate sends a new identity. This is request identity, never content uniqueness: two genuinely distinct runs over one candidate checksum, engine, fixture set, calendar, and `today` are both recorded, and a repeated identity is never rejected as a duplicate value. That identity binds its operands under the rule `F411-AC-08` states once for every client-supplied identity on this branch: it is committed together with the request fields that determine the recorded result, including every aggregate, version, and generation the request names, and a later request presenting the same identity with any different operand is refused as a conflict rather than being answered with the stored result. The identity is still the key and the operands are only a precondition on reusing it, so this is not the content uniqueness this criterion already forbids. That identity is resolved in the order `F411-AC-08` states once for every client-supplied identity on this branch, applied here rather than restated: a request presenting an already committed identity is resolved from that record before the version, generation, state, authority, and limit checks this criterion requires, and returns the outcome that request originally recorded, because the commit the retry repeats is exactly what moved the state those checks read. A request whose identity resolves to no committed outcome is then held to every one of them, and a request refused by one of them commits no identity, so re-presenting it later is a first attempt and not a replay.

   AC-01 records the input tuple, which cannot tell a retry from a deliberate rerun because both carry the same tuple by construction. When the create transaction commits and its response is lost, the retry enqueues a second isolated full-suite job: runner capacity is spent twice, and two result artifacts exist for one intended run, each usable as an F-714 gate artifact for the same checksum.

7. **F712-AC-07:** Reading a run's status, reading its result, and exporting either are rules-admin functions and are admitted only by the separate platform rules-admin role, on the terms `F703-AC-04` states for every such function rather than on a second formulation stated here. The acting actor's current platform authority is read server-side at each of those operations, never from the session or a client-supplied role claim, and never derives from a workspace role, per F-703's deny-by-default state rule and the separation `F703-AC-04` keeps. A refusal returns no run, no result, no provenance, and no response that distinguishes a run the actor may not see from one that does not exist. Creating a run under R-01 and F712-AC-06 and cancelling one under R-03 or R-04 are admitted on the same terms: the acting actor's current platform authority is re-read server-side inside the same transaction that commits the queued run or the cancellation transition, so the authorized platform administrator AC-03's table names is this check rather than a separate formulation, and authority revoked while a create or cancel is in flight fails that write rather than committing it. The worker transitions R-02, R-05, and R-06 are performed by the system actor the runner itself supplies and remain explicitly outside this criterion; no user authority is read for them and none admits a user request.

   AC-03's transition table already names an authorized platform administrator for create and for both cancellations, so the writes are covered and the reads are not. AC-01 requires a run to record the exact candidate bytes and checksum, engine, fixture set and version, calendar, `today`, and command, and AC-05 makes the result artifact byte-stable, so the read path hands out the full provenance of an unpublished candidate ruleset and its per-fixture diffs. Every criterion in this spec passes for an ordinary workspace member reading that, because outside the transition table no criterion asks who the actor is. The rules-admin scope was written only in the System Impact row, which creates no acceptance criterion. For the writes, the table named who performs R-01, R-03, and R-04 without any criterion requiring that authority to be re-read at the commit, so a create or cancel composed under an authority since revoked could still commit; the sentences above close that gap without touching the table.

   F-703 is PROPOSED and is not listed in `docs/BASELINE.md`, so until it is approved this criterion is testable only as "every run status read, result read, and export is refused unless the acting actor holds the separate platform rules-admin role, read server-side at that operation, and a refusal discloses nothing about what exists", not against a named role identifier, matrix entry, or grant path, which F-703's own approval blockers reserve.

## Fixtures and Verification

- Planned automated fixture IDs are the acceptance IDs above; each must map one-to-one to a runnable test before approval can claim implementation readiness.
- F712-AC-07 includes a negative fixture per operation in which an authenticated actor holding no platform rules-admin role, including a workspace owner, is refused a run status read, a result read, and an export, with a response indistinguishable from the one for a run that does not exist; and a fixture in which the role is revoked after a run completes and the later result read and export are refused. It also includes a negative fixture in which such an actor is refused a run create and a cancel of a `queued` and of a `running` run, with no run created and no transition committed, and a fixture in which the role is revoked between reading a `queued` run and cancelling it, so the cancellation fails at commit rather than committing.
- F712-AC-03 includes a concurrent cancellation-versus-completion fixture in both orders, proving one terminal transition wins, that no cancelled run carries a result F-714 could consume, and that a late cancellation overwrites no committed result.
- F712-AC-03 also includes one fixture per transition in its table, and a concurrent R-02-versus-R-03 fixture in both orders proving that a cancellation of a `queued` run either prevents the worker claim entirely, with no runner capacity spent and no result recorded, or is refused with `running` and never both.
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

- Approve runner isolation/resources, coverage metadata, result artifact, full-suite gate, and equivalence to existing CI. The isolation and resource approval must name which terminal state a timeout records, which F712-AC-03's R-06 leaves unpinned.
- Approve F-703, whose role/action matrix and platform-role administration path are what make `F712-AC-07`, and the authorized platform administrator already named in F712-AC-03's table, testable against a named role rather than against the shape of a check.
- Assign the owner and independent reviewer, approve this spec, and add it to `docs/BASELINE.md`.
