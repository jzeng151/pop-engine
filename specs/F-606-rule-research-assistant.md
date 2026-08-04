# F-606 · Rule Research Assistant

**Status:** PROPOSED (2026-07-26) — ready for review; not implementable until approved and listed in `docs/BASELINE.md`.

**Phase:** 4 · **Issue:** [#62](https://github.com/jzeng151/pop-engine/issues/62) · **Owner:** TBD · **Reviewer:** product owner plus affected architecture, contract, security, and lane owners (TBD) · **Approval date:** —

## Purpose and User Outcome

The verification team can receive source-change candidates for human review while no AI observation changes a rule, verification status, or published artifact.

## Scope

**In scope**

- Monitor an approved source list on an approved cadence and create review candidates with snapshot/diff/provenance.
- Deduplicate candidates, allow triage, and route accepted research into the normal F-710–F-714 human workflow.
- Preserve source fetch and model/tool versions.

**Non-goals**

- Automatic rule edits, verification promotion, legal interpretation, publication, broad web research, or treating AI as a source.
- Monitoring sources without permission/retention review.

## Dependencies and Baseline

- F-711 source records and F-715 review queue semantics; approved jobs/outbox.
- Verification-owner-approved source/cadence, fetch/archive, AI/tool, diff, retention, and triage policy.
- Baseline at draft time: PRD, Roadmap, Design, and Phase 0–1.5 Architecture approved 2026-07-22; `ARCHITECTURE-FUTURE.md` approved as a planning target 2026-07-25; NYC ruleset `nyc.v2.7`, rules schema `popengine-rules/v2`, and scenario fixtures v5 where regulatory output is consumed.
- The approval PR must re-pin any baseline version that changes before approval. A proposed or superseded input blocks implementation.

## Inputs, Outputs, State, Validation, and Errors

- Inputs are an approved source record/version, prior snapshot, and one approved comparator: exact bytes or a named version of deterministic normalization. Equality under that comparator determines no-change; any comparator difference produces a non-authoritative review candidate or explicit failure.
- Candidate state is new → triaged → accepted-for-research, dismissed, or superseded; none changes rule data.
- Unavailable/blocked/ambiguous sources stay failed or research-required and never imply no change.
- Missing or unresolved material data stays visibly unset, unknown, pending, or failed as appropriate; it never becomes a successful or complete result.
- Invalid input produces a field or action-specific error without partial mutation. Retriable external failures preserve the user's confirmed state and expose a safe retry.

## UI and Accessibility

- Review shows exact source/snapshot/diff/fetch time/tool limits and requires human disposition without a publish shortcut.
- The complete workflow is keyboard operable, uses programmatic labels and visible focus, does not encode status by color alone, and announces asynchronous success or failure.
- Empty, loading, permission-denied, validation, provider-failure, and unavailable states have explicit copy and a safe next action.

## System Impact

| Concern              | Proposed impact                                                                                                                                           |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| API                  | Research-run/candidate/triage operations require approved internal OpenAPI contracts.                                                                     |
| Schema               | Forward migrations for source snapshots/research runs/candidates/triage linked to F-711 records.                                                          |
| Jobs                 | Durable scheduled fetch/diff/analysis with rate limits, dedupe, bounded retry, robots/terms controls, and dead-letter state.                              |
| Providers            | Approved fetch/archive and optional AI adapter; neither is regulatory authority.                                                                          |
| Privacy and security | Rules-admin-only access, SSRF-safe allow-listed fetching, content-size/type bounds, prompt-injection isolation, credential protection, and redacted logs. |

Exact HTTP, JSON Schema, migration, job, and provider shapes belong in their reviewed machine contracts; this proposal does not authorize parallel local types or edits to merged migrations.

## Acceptance Criteria

1. **F606-AC-01:** Only an approved allow-listed source/cadence can start a run, and every candidate links to exact prior/current snapshots and tool versions.
2. **F606-AC-02:** No run or candidate edits a rule, source verification status, ruleset pointer, or published artifact.
3. **F606-AC-03:** Fetch failure, blocked access, ambiguous change, model failure, or any difference under the run's approved comparator remains visible and cannot be recorded as no change. When versioned normalization is the comparator, a raw-byte-only difference remains visible in evidence but does not itself create a candidate.
4. **F606-AC-04:** Duplicate source changes deduplicate without erasing separate review decisions or evidence.
5. **F606-AC-05:** An accepted candidate enters normal human research/review and still requires F-714 approvals before publication.
6. **F606-AC-06:** No-change is emitted only by deterministic equality under the run's exact-byte or approved versioned-normalization comparator, whose identity and result are recorded with both raw snapshots. AI may summarize or prioritize a comparator difference but cannot suppress its review candidate.
7. **F606-AC-07:** Every run carries a stable execution identity, committed with the run under a uniqueness constraint scoped to the source. A manually started run takes a client-supplied request identity; a scheduled run takes the identity of its source/cadence occurrence, so a job delivered twice resolves to the one occurrence. A retry or redelivery presenting the same identity returns the original run with its evidence and candidates and performs no second fetch or analysis; a deliberate rerun of the same source sends a new identity. This is execution identity, never content uniqueness: two genuinely distinct runs that fetch identical bytes are both recorded, and a repeated identity is never rejected as a duplicate value.

   AC-04 deduplicates the source changes a run produces, which sits downstream of the waste. Without a run identity, a lost manual start response or a twice-delivered scheduled job performs the fetch and the model analysis twice against a rate-limited provider, and records two runs for one intended execution. AC-04 then makes the pair look reconciled while the evidence trail still says the source was examined twice at a single occurrence.

8. **F606-AC-08:** Every candidate triage transition names the exact expected candidate and current triage version and commits only by compare-and-swap on them, in the same transaction as any downstream work it causes. That is accept, dismiss, and supersede alike, not only the accept that downstream research hangs off: each binds a stable client-supplied request identity, and success atomically records the actor, time, and reason, advances the candidate state and triage version, and creates the accepted-for-research work AC-05 routes into the human workflow where the transition is an accept. A recognized retry returns that original result and creates no second research item; a version mismatch records no decision, creates no downstream work, and returns the current candidate for the administrator to review again. AC-07 gives a run its execution identity and stops at run creation, so the review decisions in front of the candidate are unguarded: two rules administrators accepting and dismissing one candidate from the same observed state both report success, and accepted-for-research work can exist under a candidate whose visible disposition is dismissed, or one administrator's recorded decision is silently erased by the other's.

9. **F606-AC-09:** Fetching cannot access private network targets, unsupported protocols, unbounded content, or execute remote content. This is the rule `F711-AC-05` already states for source fetching, restated here because this feature schedules its own fetches on an approved cadence and an implementation is built to its own spec's criteria: AC-01 restricts which source and cadence may start a run and says nothing about what the fetch may then pull in, so an allow-listed host that redirects, or that returns an unbounded or executable response, otherwise reaches the comparator and the model adapter unchecked. The exact content-size and content-type bounds are not established by any approved artifact today; they belong to the SSRF and archive controls named in the Approval Blockers, so until that approval names them this criterion is testable only as "configured finite size and type bounds are enforced and a response outside them is recorded as a visible fetch failure under AC-03," not against a specific number or type list.

## Fixtures and Verification

- Planned automated fixture IDs are the acceptance IDs above; each must map one-to-one to a runnable test before approval can claim implementation readiness.
- Regulatory fixtures: Synthetic archived source-change fixtures plus unchanged/blocked/ambiguous/adversarial content; no AI output is ground truth.
- Security-sensitive and cross-workspace paths require negative authorization tests; provider paths require success, duplicate-delivery, retry, invalid-signature, and permanent-failure tests where applicable.

## Allowed Footprint and Coordination

- `apps/web` and `apps/api` feature code and tests.
- New ordered forward migrations and approved OpenAPI/JSON Schema changes required by this feature.
- No repository restructuring, speculative package, or unrelated feature edit.
- Shared contracts, migrations, provider adapters, engine/rules artifacts, consent policy, and cross-lane UI primitives require the approvals named in `docs/DOCUMENTATION-GOVERNANCE.md` §6.

## Rollout and Fallback

- Start with manual runs on a tiny allow-list; scheduling stays disabled until false-positive and fetch-safety review passes.
- Rollback disables the new surface and workers/provider calls without deleting confirmed user data or rewriting immutable plans, rulesets, revisions, or history.

## Approval Blockers

- Approve source/cadence/terms, SSRF/archive controls, AI/tool policy, evaluation corpus, and verification-owner workflow.
- Assign the owner and independent reviewer, approve this spec, and add it to `docs/BASELINE.md`.
