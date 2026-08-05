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
- F-710 draft editing and F-714 publication approvals, which `F606-AC-05` makes normative when it requires an accepted candidate to still pass the F-714 approvals before publication and the Scope's second In-scope line routes accepted research into the normal F-710 to F-714 human workflow. No earlier revision of this spec declared either, so an implementer confined to the declared dependencies would have consumed an undeclared publication gate or invented the human workflow locally, which `AGENTS.md` forbids. F-710 and F-714 are PROPOSED and in this same batch, so neither is an approved input today and this spec is not implementable against them until both are approved and listed in `docs/BASELINE.md`.
- Declaring F-710 and F-714 introduces no dependency cycle. F-714 depends on F-710, F-711, F-712, F-713, F-703, and F-701; F-710 depends on F-711, F-703, and F-701; F-711 depends on F-703 and F-701; F-712 depends on F-710 and F-703; F-713 depends on F-712 and F-703. No spec in that closure depends on F-606. `F-711`'s Dependencies line naming F-606 records the downstream consumers of an approved source record and is not a dependency of F-711 on this feature, in the same way F-710's line naming F-712 and F-714 as downstream consumers is not one. The F-702/F-411 cycle broken on this branch had F-702 and F-411 each naming the other as a required input; nothing here does, so the direction F-606 to F-714 stands with no local restatement needed.
- F-703 separate platform rules-admin role, which `F606-AC-10` requires at every run, candidate, snapshot, and diff read and at any export of one. No earlier revision of this spec declared it, which is why nothing here was bound by `F703-AC-04`. F-703 is PROPOSED, so that role is not an approved input today and this spec is not implementable against it until F-703 is approved.
- Verification-owner-approved source/cadence, fetch/archive, AI/tool, diff, retention, and triage policy.
- Baseline at draft time: PRD, Roadmap, Design, and Phase 0–1.5 Architecture approved 2026-07-22; `ARCHITECTURE-FUTURE.md` approved as a planning target 2026-07-25; NYC ruleset `nyc.v2.7`, rules schema `popengine-rules/v2`, and scenario fixtures v5 where regulatory output is consumed.
- Operand binding and replay ordering for client-supplied identities: `specs/F-411-staff-roles-credentialed-entry.md` F411-AC-08 states once, for this whole branch, that a client-supplied identity is committed with the operands that determine its recorded result and that a reuse carrying different operands is a conflict rather than a replay, and that a committed identity is resolved before any version, generation, state, or limit check whose answer the committed operation itself changed, while the acting actor's current authority is re-read at the replay and must still admit the operation before any stored outcome is returned. Every identity criterion below relies on it. F-411 is PROPOSED, so that rule is not an approved input today and this spec is not implementable against it until F-411 is approved or the rule is promoted to an approved shared invariant; F411-AC-08 records both paths.
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
7. **F606-AC-07:** Every run carries a stable execution identity, committed with the run under a uniqueness constraint scoped to the source. A manually started run takes a client-supplied request identity; a scheduled run takes the identity of its source/cadence occurrence, so a job delivered twice resolves to the one occurrence. A retry or redelivery presenting the same identity returns the original run with its evidence and candidates and performs no second fetch or analysis; a deliberate rerun of the same source sends a new identity. This is execution identity, never content uniqueness: two genuinely distinct runs that fetch identical bytes are both recorded, and a repeated identity is never rejected as a duplicate value. That identity binds its operands under the rule `F411-AC-08` states once for every client-supplied identity on this branch: it is committed together with the request fields that determine the recorded result, including every aggregate, version, and generation the request names, and a later request presenting the same identity with any different operand is refused as a conflict rather than being answered with the stored result. The identity is still the key and the operands are only a precondition on reusing it, so this is not the content uniqueness this criterion already forbids. That identity is resolved in the order `F411-AC-08` states once for every client-supplied identity on this branch, applied here rather than restated: a request presenting an already committed identity is resolved from that record before the version, generation, state, and limit checks this criterion requires, and returns the outcome that request originally recorded, because the commit the retry repeats is exactly what moved the state those checks read. The acting actor's current authority is not among the checks the identity is resolved past: the authority this feature requires for a first attempt is re-read server-side at the replay, and the stored outcome is returned only if it still admits the operation, so a replay presented after that authority is gone is refused and discloses no more than a first request would; the only exception is authority the committed operation itself removed, which `F411-AC-08` states once for this branch. A request whose identity resolves to no committed outcome is then held to every one of them, and a request refused by one of them commits no identity, so re-presenting it later is a first attempt and not a replay.

   AC-04 deduplicates the source changes a run produces, which sits downstream of the waste. Without a run identity, a lost manual start response or a twice-delivered scheduled job performs the fetch and the model analysis twice against a rate-limited provider, and records two runs for one intended execution. AC-04 then makes the pair look reconciled while the evidence trail still says the source was examined twice at a single occurrence.

8. **F606-AC-08:** Every candidate triage transition names the exact expected candidate and current triage version and commits only by compare-and-swap on them, in the same transaction as any downstream work it causes. That is accept, dismiss, and supersede alike, not only the accept that downstream research hangs off: each binds a stable client-supplied request identity, committed under a uniqueness constraint scoped to the candidate it triages, and success atomically records the actor, time, and reason, advances the candidate state and triage version, and creates the accepted-for-research work AC-05 routes into the human workflow where the transition is an accept. A recognized retry returns that original result and creates no second research item; a version mismatch records no decision, creates no downstream work, and returns the current candidate for the administrator to review again. AC-07 gives a run its execution identity and stops at run creation, so the review decisions in front of the candidate are unguarded: two rules administrators accepting and dismissing one candidate from the same observed state both report success, and accepted-for-research work can exist under a candidate whose visible disposition is dismissed, or one administrator's recorded decision is silently erased by the other's. That identity binds its operands under the rule `F411-AC-08` states once for every client-supplied identity on this branch: it is committed together with the request fields that determine the recorded result, including every aggregate, version, and generation the request names, and a later request presenting the same identity with any different operand is refused as a conflict rather than being answered with the stored result. The identity is still the key and the operands are only a precondition on reusing it, so this is not the content uniqueness this criterion already forbids. That identity is resolved in the order `F411-AC-08` states once for every client-supplied identity on this branch, applied here rather than restated: a request presenting an already committed identity is resolved from that record before the version, generation, state, and limit checks this criterion requires, and returns the outcome that request originally recorded, because the commit the retry repeats is exactly what moved the state those checks read. The acting actor's current authority is not among the checks the identity is resolved past: the authority this feature requires for a first attempt is re-read server-side at the replay, and the stored outcome is returned only if it still admits the operation, so a replay presented after that authority is gone is refused and discloses no more than a first request would; the only exception is authority the committed operation itself removed, which `F411-AC-08` states once for this branch. A request whose identity resolves to no committed outcome is then held to every one of them, and a request refused by one of them commits no identity, so re-presenting it later is a first attempt and not a replay.

9. **F606-AC-09:** Fetching cannot access private network targets, unsupported protocols, unbounded content, or execute remote content. This is the rule `F711-AC-05` already states for source fetching, restated here because this feature schedules its own fetches on an approved cadence and an implementation is built to its own spec's criteria: AC-01 restricts which source and cadence may start a run and says nothing about what the fetch may then pull in, so an allow-listed host that redirects, or that returns an unbounded or executable response, otherwise reaches the comparator and the model adapter unchecked. The exact content-size and content-type bounds are not established by any approved artifact today; they belong to the SSRF and archive controls named in the Approval Blockers, so until that approval names them this criterion is testable only as "configured finite size and type bounds are enforced and a response outside them is recorded as a visible fetch failure under AC-03," not against a specific number or type list.

10. **F606-AC-10:** Starting or scheduling a run, triaging a candidate, and reading or exporting any run, candidate, snapshot, diff, or provenance record are rules-admin functions and are admitted only by the separate platform rules-admin role, on the terms `F703-AC-04` states for every such function rather than on a second formulation stated here. The acting actor's current platform authority is read server-side at each of those operations, for a triage transition inside the same transaction that commits it under AC-08, never from the session or a client-supplied role claim, and never derived from a workspace role, per F-703's deny-by-default state rule and the separation `F703-AC-04` keeps. A refusal starts no run, records no decision, returns no candidate or snapshot, and does not distinguish a record the actor may not see from one that does not exist.

    AC-01 through AC-09 all pass for an ordinary workspace member. They restrict which source and cadence may start a run, forbid any write to a rule or published artifact, keep no-change deterministic, bound the fetch, and serialize triage, and not one of them asks who the actor is. AC-08 names a rules administrator only in its explanation of the race, not in what it requires. The rules-admin-only access was written in the System Impact row alone, which creates no acceptance criterion, so an implementation built to the criteria could expose every archived source snapshot, comparator diff, model and tool version, and pending review decision to any authenticated user, and let one start monitoring runs against the approved source list. Disclosure is the harm on the read half even though the feature writes no rule.

    F-703 is PROPOSED and is not listed in `docs/BASELINE.md`, so until it is approved this criterion is testable only as "every run start, triage transition, read, and export is refused unless the acting actor holds the separate platform rules-admin role, read server-side at that operation, and a refusal discloses nothing about what exists", not against a named role identifier, matrix entry, or grant path, which F-703's own approval blockers reserve. The verification-owner authority AC-05 and F-711 rely on is a separate approval named in the blockers below and is not what this criterion establishes.

## Fixtures and Verification

- Planned automated fixture IDs are the acceptance IDs above; each must map one-to-one to a runnable test before approval can claim implementation readiness.
- F606-AC-10 includes a negative fixture per operation in which an authenticated actor holding no platform rules-admin role, including a workspace owner, is refused a run start, a triage transition, a candidate or snapshot read, and an export, with no run started, no decision recorded, and a response indistinguishable from the one for a record that does not exist; and a fixture in which the role is revoked between a candidate read and the triage transition composed from it, so that the transition is refused at commit.
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
- Approve F-710 and F-714, whose draft-editing and publication-approval workflow `F606-AC-05` requires an accepted candidate to pass before publication. Until both are approved that workflow is not an approved input and this spec may not restate or replace it locally.
- Approve F-703, whose role/action matrix and platform-role administration path are what make `F606-AC-10` testable against a named role rather than against the shape of a check.
- Assign the owner and independent reviewer, approve this spec, and add it to `docs/BASELINE.md`.
