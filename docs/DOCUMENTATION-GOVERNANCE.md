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
- `APPROVED` — authoritative and included in the current baseline. Implementation also requires clearing every gate recorded for that artifact.
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
7. Add the smallest practical guard against the contradiction returning, and document its coverage and limits. Use structural validation when the authoritative artifact is machine-readable. A prose check is partial: it must name the files and claim patterns it covers, and neither the check nor any record citing it may claim that arbitrary rewordings are prevented.

Contributors must not:

- silently select the version they prefer;
- reconcile a regulatory discrepancy using plausibility;
- change an established feature ID's meaning;
- edit an existing migration to make a branch pass;
- maintain two “temporary” enums or schemas for the same concept;
- implement a TODO from an unapproved document.

## 6. Change classes and approvals

The product owner approves every change class below and may approve a change they authored. A durable architecture decision or dependency also requires an approved ADR. The dated records below preserve the earlier approval rules and their retirement.

| Change                                                       | Required approval                          |
| ------------------------------------------------------------ | ------------------------------------------ |
| Regulatory source/status/content                             | Product owner                              |
| Rule trigger, dedupe, branch, deadline, or formula semantics | Product owner                              |
| Event Input, rules schema, OpenAPI, shared enum              | Product owner                              |
| Database migration touching shared/core tables               | Product owner                              |
| Product scope, feature meaning, phase                        | Product owner                              |
| Durable architecture decision or dependency                  | Product owner, recorded as an approved ADR |
| UI copy that makes no regulatory claim                       | Product owner                              |

Classify UI text by the facts it states. Text asserting a permit, agency, trigger, deadline, fee, document, portal, exception, verification status, or plan-completeness fact is regulatory content and follows §2. Copy that asserts no regulatory fact, such as navigation, labels, headings, buttons, empty states, and application messages, uses the copy-only row.

Removing an approval requirement does not approve an artifact. An unapproved artifact still needs its owner, approval, and baseline entry before implementation, along with any recorded gates. Existing approvals remain recorded in their original words and capacities.

<details>
<summary>Historical approval rules, demo exception, and second-party retirement</summary>

**Recorded demo overwrite — PR #137 only (2026-07-27).** After the other lane owners were unavailable, `@jzeng151` explicitly invoked a one-time product-owner overwrite of the all-lane and teammate-review requirements for the initial Event and Event Revision ratification. It authorizes access-gated synthetic-data demo implementation against that bounded contract. It attributes no approval to another account, creates no precedent for later contract or migration changes, and does not authorize production activation. Strict ratification remains due before the F-701–F-703 production gate can open; the sentences above record what happened on 2026-07-27, and who must sign that ratification is now the table above, the product owner.

**Second-party review retired (2026-08-05).** Requirements that some other party review, approve, verify, witness or sign something are one class, and the product owner has retired that class repo-wide. It is retired, not satisfied and not recorded as unmet. PopEngine is a one-person project, so the requirement can never be met, and carrying it as permanently unmet produced contradictory instructions across the artifacts that cited it. Three things were covered and all three go. First, the second signatory this section's closing paragraph required for a regulatory publication or a verification status. Second, the independent spec reviewer in the Approval Blockers of `specs/F-103-scope-comparator.md`, `specs/F-107-save-resume.md`, `specs/F-306-waitlist.md`, `specs/F-405-day-of-runbook.md` and `specs/F-502-historical-event-comparison.md`, and AD-15's coordinated review of shared contract changes in `docs/ARCHITECTURE-FUTURE.md`. Third, the merge gate that is not an approval recorded in a document at all, `CONTRIBUTING.md`'s "one teammate's review. You cannot merge your own PR unreviewed" and its matching PR-checklist line. One person, the product owner, may now approve any change this section covers, including a regulatory publication and a verification status, may approve a change they authored, and may merge their own pull request. This record supersedes the 2026-08-05 second-party record in `docs/BASELINE.md`, which recorded the same class as UNMET.

**Retiring the requirement approves nothing.** No artifact becomes approved because a requirement it carried was retired. The five specs above become approvable by the product owner and are not approved: each stays `PROPOSED` with an approval date of `—` under §3 until the product owner assigns its owner, approves it and lists it in `docs/BASELINE.md`, and none is implementable before that. Every other approval this section routes still has to be given; retirement removes a second signatory, not the first one. Records of second-party review already given, and approvals recorded in the capacities the rules then in force named, stay on the record in the words they were given.

</details>

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
