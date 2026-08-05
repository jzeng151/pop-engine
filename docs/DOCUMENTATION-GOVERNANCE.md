# PopEngine — Documentation Governance

**Status:** APPROVED (adopted 2026-07-22; see `docs/BASELINE.md`). Authority-by-concern and the conflict protocol are in force.  
**Purpose:** Ensure humans and coding agents resolve scope and specification questions the same way.

## 1. There is no universal “one document wins” rule

Authority is assigned by concern:

| Concern                                        | Authoritative artifact                                       |
| ---------------------------------------------- | ------------------------------------------------------------ |
| Product problem, user, value, goals, non-goals | `docs/PRD.md`                                                |
| Feature ID, name, priority, and phase          | `docs/ROADMAP.md`                                            |
| Scheduled feature behavior and acceptance      | Approved `specs/F-xxx-*.md`                                  |
| Technical boundaries and invariants            | `docs/ARCHITECTURE.md` plus approved ADRs                    |
| Team lanes, gates, and demo sequence           | `docs/DESIGN.md`                                             |
| Regulatory fact                                | Approved primary source, then published immutable rule       |
| Executable regulatory expectation              | Approved fixture associated with a published rule            |
| HTTP shape                                     | `contracts/openapi.yaml`                                     |
| Event/rules data shape                         | Versioned JSON Schemas                                       |
| Database shape                                 | Merged ordered migrations                                    |
| Current approved versions                      | `docs/BASELINE.md`                                           |
| Unresolved matter                              | `docs/OPEN-QUESTIONS.md`; never authority for implementation |

Prose cannot override a machine contract within that contract's concern. A machine contract cannot create product scope that the PRD/roadmap/spec did not approve.

## 2. Regulatory authority hierarchy

1. Approved primary source.
2. Reviewed and published rule.
3. Approved executable scenario fixture.
4. Rules-engine result.
5. User-interface copy.

When levels disagree, inspect and correct the lower-authority artifact. Never alter an engine merely to reproduce an unsupported expected result. Research notes and AI output are not primary sources and cannot promote a fact.

## 3. Document states

Every controlled document begins with exactly one status:

- `DRAFT` — incomplete; not implementable.
- `PROPOSED` — ready for review; not implementable until approved.
- `APPROVED` — included in the current baseline and implementable.
- `SUPERSEDED` — replaced; retained only for history.
- `ARCHIVED` — historical research or migration evidence; never current authority.

`Canonical`, `current`, and `single source of truth` are not statuses. Only artifacts listed as `APPROVED` in `docs/BASELINE.md` are current.

## 4. Baseline manifest

`docs/BASELINE.md` lists, at minimum:

| Artifact                       | Version/path | Status | Approved by | Approval date | Checksum/commit |
| ------------------------------ | ------------ | ------ | ----------- | ------------- | --------------- |
| PRD                            |              |        |             |               |                 |
| Roadmap                        |              |        |             |               |                 |
| Delivery design                |              |        |             |               |                 |
| Architecture                   |              |        |             |               |                 |
| Rules schema                   |              |        |             |               |                 |
| Current NYC ruleset            |              |        |             |               |                 |
| Event Input schema             |              |        |             |               |                 |
| Regulatory fixture suite       |              |        |             |               |                 |
| OpenAPI                        |              |        |             |               |                 |
| Database schema/migration head |              |        |             |               |                 |

Old copies are moved beneath an `archive/` directory or removed from the active branch. Filenames such as `PRD(6).md` must not exist in the repository.

## 5. Conflict protocol

If any contributor or agent finds a disagreement:

1. Stop the affected implementation; unaffected work may continue.
2. Record a `SPEC-CONFLICT` issue with both exact artifact locations and the user-visible consequence.
3. Identify the concern and its authoritative artifact from the table above.
4. If the authoritative artifact is unclear, assign an owner and add a blocking item to `OPEN-QUESTIONS.md`.
5. Resolve the source artifact first.
6. Update all derived contracts/docs in the same reconciliation PR or explicitly track each follow-up.
7. Add a regression test or validation rule so the contradiction cannot silently return.

Contributors must not:

- silently select the version they prefer;
- reconcile a regulatory discrepancy using plausibility;
- change an established feature ID's meaning;
- edit an existing migration to make a branch pass;
- maintain two “temporary” enums or schemas for the same concept;
- implement a TODO from an unapproved document.

## 6. Change classes and approvals

PopEngine is a solo project, so approvals name one capacity. The product owner approves; no row names a separate architecture, security, database, verification, rules-reviewer or lane-owner capacity (product owner, 2026-08-04; recorded in `docs/BASELINE.md`). This says which capacity a future approval requires. It does not license approving alone where this section forbids it: the first sentence of this section's closing paragraph is unconditional and is not relaxed by the table.

| Change                                                       | Required approval                          |
| ------------------------------------------------------------ | ------------------------------------------ |
| Regulatory source/status/content                             | Product owner                              |
| Rule trigger, dedupe, branch, deadline, or formula semantics | Product owner                              |
| Event Input, rules schema, OpenAPI, shared enum              | Product owner                              |
| Database migration touching shared/core tables               | Product owner                              |
| Product scope, feature meaning, phase                        | Product owner                              |
| Durable architecture decision or dependency                  | Product owner, recorded as an approved ADR |
| UI copy that makes no regulatory claim                       | Product owner                              |

This table states what a future approval requires. It does not restate an approval already given: an approval recorded in named capacities under the rules then in force stays on the record in the words it was given.

Two rows carry a requirement that is not a capacity, and naming one approver does not reach either.

A durable architecture decision is still recorded as an approved ADR. The capacity that signs it is the product owner; the record the decision has to leave is unchanged, and an approval that leaves no ADR does not satisfy that row.

Copy-only is a statement about the change, not about the file it lands in. A UI-text change that itself states a permit, agency, trigger, deadline, fee, document, portal, exception, verification status, or plan-completeness fact is regulatory content: it takes the first row, and it is a regulatory publication, so the closing paragraph's first sentence applies and the product owner who wrote that copy is not enough on their own. UI copy is the last level of §2's authority hierarchy, not outside it, and an organizer reading an alert or a checklist reads it as the system's regulatory answer. The copy-only row covers copy that asserts no such fact: navigation and field labels, headings, button text, empty states, and messages about the application itself.

**Recorded demo overwrite — PR #137 only (2026-07-27).** After the other lane owners were unavailable, `@jzeng151` explicitly invoked a one-time product-owner overwrite of the all-lane and teammate-review requirements for the initial Event and Event Revision ratification. It authorizes access-gated synthetic-data demo implementation against that bounded contract. It attributes no approval to another account, creates no precedent for later contract or migration changes, and does not authorize production activation. Strict ratification remains due before the F-701–F-703 production gate can open; the sentences above record what happened on 2026-07-27, and who must sign that ratification is now the table above, the product owner.

No person approves their own regulatory publication alone. The author and source reviewer should be distinct whenever the team size permits.

## 7. Feature specification lifecycle

Every scheduled F-id receives one spec containing:

- purpose and user outcome;
- in-scope and explicit non-goals;
- dependencies and baseline contract versions;
- inputs, outputs, state transitions, validation, unknown/conflict behavior, and errors;
- UI states and accessibility requirements;
- API, schema, job, provider, privacy, and security impact;
- exact acceptance criteria and fixture IDs;
- allowed file footprint and shared files requiring coordination;
- rollout/fallback behavior;
- owner, reviewer, status, and approval date.

A spec may clarify but may not silently expand its Roadmap feature. Scope expansion returns to the PRD/Roadmap decision process.

## 8. Generated and derived artifacts

Generated artifacts identify their source and generation command. Do not hand-edit them.

Examples:

- TypeScript API client generated from OpenAPI;
- shared TypeScript types generated from JSON Schema;
- database read model seeded from a published rules artifact;
- human-readable fixture report generated from JSON fixtures.

CI regenerates or verifies generated artifacts and fails on drift.

## 9. Review cadence

- Before a phase starts: approve its specs and update the baseline.
- Before every merge: confirm the PR cites its F-id/spec and baseline versions.
- After a regulatory publish: run the entire regulatory suite, update changelog, and verify historical replay.
- Weekly during active build: close or re-date blocking open questions; remove resolved items from the active register.
- Before demo/release: freeze ruleset, fixture, engine, calendar, deployment, and demo-script versions.

## 10. Definition of documentation-ready

Parallel coding may begin only when:

- one approved baseline exists;
- no active file references a superseded ruleset or status vocabulary;
- the Event Input and rules schemas validate;
- scheduled feature specs are approved;
- shared API/database contracts are merged;
- unresolved decisions have owners and do not require agents to guess;
- each lane knows its allowed file footprint, required upstream version, reviewer, and merge order.
