# PopEngine Documentation Reconciliation Audit

**Review date:** 2026-07-22  
**Scope:** `PRD.md`, `ROADMAP.md`, `DESIGN.md`, `ARCHITECTURE.md`, `OPEN-QUESTIONS.md`, `CONTRIBUTING.md`, `README.md`, `VERIFICATION-SOURCES.md`, `nyc-rules.v2.json`, its changelog, and the Expanded Regulatory Scenario Suite v2.  
**Review type:** Internal consistency, implementation readiness, architecture coverage, and multi-agent drift risk. This is not an independent legal verification of NYC rules.

## Executive verdict

**Do not begin parallel feature implementation from the supplied set yet.**

The product direction is coherent and the regulatory-safety principles are unusually strong. The documentation set, however, contains two incompatible baselines:

- The PRD, roadmap, delivery design, architecture, contribution guide, open-questions register, and verification dossier describe the original `nyc.v1` model: 13 broad rules, six scenarios, a small intake, approximate business-day math, and `FEASIBLE`-style verdicts.
- `nyc-rules.v2.json`, its changelog, and the Expanded Regulatory Scenario Suite v2 describe a materially different model: 59 granular rules, four advisories, at least 50 scenario groups with many variants, 57 collected inputs plus six declared derived fields, actual business-day math, coverage/conflict states, per-class SAPO deadlines, and no generic `FEASIBLE` result.

This is not a filename cleanup. It changes the product contract, flagship demo, data model, engine interface, test suite, and UI vocabulary. Four agents using the current set could each follow an apparently canonical document and still build mutually incompatible software.

The correct recovery is:

1. Ratify one baseline, recommended: ruleset `nyc.v2` plus a corrected and approved v2 scenario suite.
2. Reconcile the PRD, roadmap, design, architecture, contribution guide, open questions, and demo plan to that baseline.
3. Create machine-readable contracts and fixtures before splitting work across four lanes.
4. Approve the revised Event/input contract and only then start feature branches.

## Blocking conflicts

| ID   | Conflict                                                                   | Evidence in supplied set                                                                                                                                                                                                                                                                                                                                                   | Required resolution                                                                                                                                                                                                                                                                                                      |
| ---- | -------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| B-01 | **Rules baseline is split between v1 and v2.**                             | Most prose names `rules/nyc-rules.v1.json`, R1–R13, and six scenarios. The supplied rules file says it supersedes `nyc.v1` with `nyc.v2`, 59 rules, and four advisories.                                                                                                                                                                                                   | Declare one current rules artifact in a baseline manifest. Update every path, rule-count assertion, test reference, environment default, boot validation, and contribution rule. Archive v1-era docs rather than leaving them beside current files.                                                                      |
| B-02 | **The primary product status model changed.**                              | PRD/roadmap/architecture specify `FEASIBLE`, `FEASIBLE-AT-RISK`, `CONDITIONAL`, `INFEASIBLE`. Scenario Suite v2 explicitly says not to use generic `FEASIBLE` and defines `ON_TRACK`, `DEADLINE_APPROACHING`, `PUBLISHED_DEADLINE_MISSED`, `CONDITIONAL`, `CANNOT_DETERMINE`, `OUTSIDE_VALIDATED_COVERAGE`, and `NO_NEW_REQUIREMENT_IDENTIFIED`.                           | Replace F-102's flat feasibility enum with separate coverage, finding, and deadline status dimensions. Update UI copy, database constraints, API types, tests, metrics, and demo script together. Do not alias old and new enums.                                                                                        |
| B-03 | **The flagship Scenario A is invalid under v2.**                           | PRD/DESIGN demo a 35-day sidewalk event as definitely blocked by a universal 60-day SAPO lead. The v2 suite says not to use that demo; Street Event deadlines are class-specific and recommends a 29-day Medium Street Event or the Parks 21-day hard floor.                                                                                                               | Replace the anchor demo and all acceptance copy. Recommended: Medium Street Event at 29 days for a definite missed 30-day deadline, plus the rooftop scenario to demonstrate conditional reasoning.                                                                                                                      |
| B-04 | **The intake promise and intake contract cannot both be true.**            | F-101 promises a short questionnaire completed in under two minutes. v2 declares 57 collected inputs covering classification, sales, sponsorship, sound, food vendors, alcohol paths, structures, fuel, power, assembly, and routes. The current `events` table represents only a small subset and uses incompatible enums.                                                | Use a two-pass intake: a sub-two-minute initial triage followed by only the material follow-ups triggered by the event. Change the value proposition from “complete for every event in two minutes” to “initial triage in two minutes; complete within the declared coverage envelope after required follow-ups.”        |
| B-05 | **The test authority is contradictory.**                                   | CONTRIBUTING and DESIGN say “the answer key wins.” Scenario Suite v2 reverses that: approved primary source, then published rule, then scenario expectation, then engine output, then UI. The v2 suite is itself marked `Draft`.                                                                                                                                           | Adopt the v2 authority hierarchy everywhere. Give the scenario suite an approval status and reviewer. No draft scenario may be a green-gate acceptance test.                                                                                                                                                             |
| B-06 | **The architecture cannot evaluate the supplied rules.**                   | Current architecture supports a limited operator set, R1–R13, approximate business days, four item kinds, top-level rule fields, and a narrow event schema. v2 requires ten operators, deduplication, branch paths, actual New York business-day calculation, official conflicts, coverage gaps, 11 rule kinds, per-facet verification, and outputs nested under `output`. | Replace the architecture with the reconciled architecture delivered alongside this audit. The engine and persistence types must derive from a formal v2 schema rather than the old prose table.                                                                                                                          |
| B-07 | **No-auth MVP handles uploads, email/SMS destinations, and attendee PII.** | F-202 uploads documents, F-203 sends alerts, and Phase 1.5 stores RSVP/check-in contact data, while AD-5 says no auth and CORS is the only stated boundary. The alerts schema does not even store a recipient.                                                                                                                                                             | Either move minimal authentication/access control into Phase 1 or explicitly constrain Phase 1 to a gated, synthetic-data-only capstone environment. Authentication must precede any external beta or real document/PII storage. Add recipients, consent, suppression, retention, and tenant authorization to the model. |

## Major inconsistencies and omissions

### Product and roadmap

1. **“Complete and correct” is overclaimed.** v2 intentionally contains official conflicts, research-required deadlines, conditional outcomes, and a waterfront coverage gap. The promise must be “complete within validated coverage,” with visible incompleteness otherwise.
2. **MVP metrics are obsolete.** The six-scenario target no longer matches the 50-group v2 suite. Measure exact finding-set match, deadline/status correctness, source correctness, and false additions as well as false omissions across approved executable fixtures.
3. **F-109 is needed now, not only in Phase 4.** v2's safety scenarios and rules conventions already require `CANNOT_DETERMINE` and `OUTSIDE_VALIDATED_COVERAGE`. Move a minimal coverage-state capability into F-102/F-201 for Phase 1; Phase 4 can expand it for open-ended intake.
4. **F-108 has an MVP-sized prerequisite.** F-204 promises the correct precinct/authority link, while automatic authority resolution is deferred to Phase 4. Phase 1 needs either a manual authority/precinct confirmation step or a narrower portal-link promise.
5. **F-205 duplicates existing behavior.** v2 already emits SAPO and Parks insurance findings through F-201. Redefine F-205 as an insurance workflow/summary with added user value, or remove it from stretch; do not build a second detector.
6. **Phase 1.5 order conflicts with its dependency graph.** Roadmap prioritizes F-401/F-402 before F-301/F-302, while DESIGN states F-301 → F-302 → F-401. The current schema makes `rsvp_id` optional, so F-401 can support walk-ins independently. Document that model and change the graph.
7. **Phase 2 persistence precedes identity.** Save/resume, application tracking, attendee CRM, and durable messaging are listed before or alongside F-701. Move F-701 to the front of Phase 2 and require it before real-user persistence.
8. **Team features precede the team model.** Phase 2 includes team reminders and staff assignments, while workspaces, membership, roles, and team task assignment are Phase 3. Move the team-dependent portions or bring the workspace foundation forward.
9. **`headcount` is not capacity.** F-402 compares check-ins to F-101 headcount and calls it a capacity gauge. Add a separate confirmed venue/event capacity field. The v2 safety suite also uses `venue capacity`, but v2's declared intake fields omit it.
10. **Several dependencies are absent.** F-303 also depends on F-301; F-305 depends on F-302 plus messaging; F-404 requires identity/tenancy; F-405 needs application, document, contact, and assignment data; cross-event analytics require multiple retained events and a workspace boundary.

### Rules and scenario contract

1. **The v2 rules file has a schema label but no supplied JSON Schema.** `popengine-rules/v2` must be backed by an actual schema file and CI validation.
2. **The v2 scenario suite is human-readable, not executable.** Many cases omit complete input objects, exact `today` dates, stable IDs for variants, and exact structured expected outputs. Create JSON fixtures imported directly by engine tests.
3. **Derived classification is underspecified.** `sapo_event_type`, `street_event_size`, `plaza_level`, `plaza_size`, and `plaza_block_count` drive many rules, but the supplied file does not define a complete deterministic derivation from raw answers. `classify_sapo_event(raw public-space facts)` is prose, not an algorithm.
4. **Formula strings are not a safe executable contract.** Fee and derivation formulas mix expressions and English, such as `20% of total vendor participation fees` and `union(... when ...)`. Define a typed expression AST or implement named, versioned calculation functions. Never use JavaScript `eval`.
5. **The result shape is wider than the architecture.** v2 emits permit, insurance, note, advisory, eligibility, classification, conditional requirement, dependency, approval, certificate, and notification findings. The current four-value `item_kind` cannot preserve these.
6. **Verification is per facet, not per rule.** A rule may have verified scope but research-required deadline or portal. Plans and UI must carry status separately for scope, deadline, fee, documents, and portal.
7. **The rules artifact does not meet its own acceptance standard.** All 59 rules lack a source excerpt, named reviewer, explicit publication status, and effective date. If an effective date is unavailable, that absence should be explicit rather than omitted.
8. **Portal/package completeness is not met.** At least 16 permit-like or insurance/notification findings lack a portal, before considering missing document lists. F-204 cannot claim “every permit” until the facet is verified or visibly marked unavailable.
9. **One v2 output still conflicts with the supplied research dossier.** The Parks propane rule says barbecuing is not authorized on beaches, while the dossier says designated beach barbecue areas exist and recommends narrower wording. Re-review that sentence before publication.
10. **Scenario inputs exceed the declared intake schema.** Examples include venue capacity, publicly advertised/open registration conflicts, fireworks, multiple locations, and temporary grandstands. Either add structured fields, add a supported-elements screen, or narrow those scenarios until F-601 exists.
11. **Version syntax is inconsistent.** The files use `nyc.v2`, `nyc.v1`, `nyc-1.0`, and `nyc-1.1`. Adopt one immutable format, e.g. `us-ny-nyc@2.0.0`, and version the rule schema, rules content, engine, intake schema, and holiday calendar independently.
12. **“City #2 is only a new JSON file” is not yet credible.** NYC-specific derived classifiers are not declarative. Rephrase F-207 as “no core engine rewrite”; a new jurisdiction may still need a new questionnaire, declarative classifications, reference data, and verified fixtures.

### Architecture and runtime

1. **The `permit_rules` primary key loses versions.** `rule_id` alone cannot hold two ruleset versions for comparison or rollback. Use `(ruleset_id, rule_id)` and an immutable `rulesets` table.
2. **Client-side plan invalidation is insufficient.** Editing an event must create an immutable event revision or update a server-side revision counter. Every plan must reference the exact event revision it evaluated.
3. **Regeneration behavior is undefined.** Preserve the prior plan and checklist, compute a diff, cancel obsolete pending alerts, and require explicit user handling for carried workflow statuses. Do not silently rewrite an active checklist.
4. **Alert delivery is not idempotent.** “Retry next poll” can duplicate messages after a crash. Add a transactional outbox/job row, attempt records, bounded retry policy, idempotency key, recipient, provider ID, cancellation, and dead-letter state.
5. **A long-lived in-process poller is not a full-roadmap design.** Reminder campaigns, emergency messaging, document extraction, email ingestion, webhooks, and AI work need a worker boundary. It can remain PostgreSQL-backed; Redis is not required.
6. **Public URLs and RSVP/check-in concurrency are underspecified.** Use unguessable public slugs/tokens, an atomic capacity transaction, idempotency keys, duplicate policy, and separate check-in events rather than one mutable row.
7. **Dates need jurisdiction semantics.** Regulatory deadlines are local dates using a pinned holiday calendar. Public events and reminders need start/end timestamps plus IANA timezone. Store both concepts explicitly.
8. **The plan banner is misleading under v2.** “Rules verified as of” suggests every facet is verified. Use “Rules snapshot [version], published [date]” and show per-finding verification/qualification/conflict status.
9. **Provider/tooling choices remain ambiguous.** “Railway / Render / Fly,” “Neon / Supabase,” “S3 / R2,” and “plain SQL or a light tool” invite each agent to choose differently. Record one demo deployment, database migration tool, query layer, email provider, storage provider, Node version, package-manager version, and Next.js routing mode before scaffolding.

### Documentation governance and team workflow

1. **Several files call themselves canonical without defining authority by concern.** The PRD says single source of truth, while ROADMAP, DESIGN, and ARCHITECTURE are also canonical. Add a governance document and baseline manifest.
2. **README is effectively empty.** It must orient agents to the baseline, document order, setup, commands, current phase, and stop conditions.
3. **The referenced `/specs` set was not supplied.** The docs say specs are the actual task and definition of done. Parallel coding should not begin until every Phase 1 feature has an approved spec.
4. **CONTRIBUTING contradicts OPEN-QUESTIONS on schema approval.** It says all four developers approved the Event schema; S-4 still says approval is open and ARCHITECTURE labels the schema proposed.
5. **Verification documents are historical but look current.** OPEN-QUESTIONS and VERIFICATION-SOURCES describe v1 facts as all open, while v2 encodes many as verified or qualified. Archive them under a v1 migration path or rewrite them into a v2 issue register.
6. **The verification owner and engine owner overlap ambiguously.** DESIGN assigns Dev 1 rules-file fidelity and Dev 4 verification status. Define CODEOWNER-style boundaries: Dev 1 owns evaluator code; Dev 4 owns source/review metadata; a rules change touching both requires both approvals.
7. **The 90% coverage gate lacks the E2E gate it claims.** Add Playwright (or the team's chosen equivalent) for the complete demo path, plus API contract, migration, authorization, and fixture-replay tests.

## File-by-file required edits

| File                         | Disposition                 | Minimum edit                                                                                                                                                                               |
| ---------------------------- | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `PRD.md`                     | Rewrite affected sections   | Adopt v2 coverage/status model, two-pass intake, new demo, qualified completeness claim, approved fixture metrics, and current rules references.                                           |
| `ROADMAP.md`                 | Reorder and refine          | Add Phase 1 coverage core and manual authority resolution; put authentication first in Phase 2; resolve walk-in check-in dependency; move team-dependent work behind workspace membership. |
| `DESIGN.md`                  | Rewrite gates/lanes/demo    | Replace six-scenario gate and “answer key wins”; use approved v2 fixture tiers; change flagship demo; define shared-file ownership and cross-lane review.                                  |
| `ARCHITECTURE.md`            | Replace                     | Use the full-roadmap architecture delivered with this audit.                                                                                                                               |
| `OPEN-QUESTIONS.md`          | Archive and recreate        | Close or migrate v1 interpretations; list only unresolved v2 facts and blocking technical decisions with owner/due date/decision record.                                                   |
| `CONTRIBUTING.md`            | Update                      | Point to v2 and approved fixtures; use the new authority hierarchy; correct schema approval status; add E2E, contract, migration, security, and shared-file review rules.                  |
| `README.md`                  | Replace                     | Add product summary, baseline, doc map, setup, commands, lane map, phase status, and safety warning.                                                                                       |
| `VERIFICATION-SOURCES.md`    | Archive or convert          | Preserve it as migration evidence, but do not present it as the current verification queue. Create a v2 source-review register.                                                            |
| `nyc-rules.v2.json`          | Correct and formalize       | Add/validate against JSON Schema; normalize formulas and output shapes; add source-review metadata; resolve the beach copy; close missing intake/coverage gaps or mark them explicitly.    |
| `nyc-rules.v2.changelog.md`  | Retain with qualification   | Link to the approval record, schema, migration map, and known deviations. Do not call validation equivalent to publication approval.                                                       |
| `regulatory-scenarios.v2.md` | Approve and make executable | Resolve remaining internal discrepancies; give every variant a stable ID; add matching JSON fixtures with exact inputs and outputs.                                                        |

## Documents and machine contracts to add

These are not optional for a four-agent build:

- Root `AGENTS.md`: concise instructions every coding agent must obey.
- `docs/BASELINE.md`: the only current document/rules/spec versions and their approval status.
- `docs/DOCUMENTATION-GOVERNANCE.md`: authority by concern and conflict protocol.
- `docs/adr/ADR-xxx-*.md`: one record per durable technical decision.
- `specs/F-xxx-*.md`: an approved spec for each scheduled feature, with inputs, outputs, states, errors, non-goals, dependencies, API/schema impact, acceptance fixtures, and file ownership.
- `contracts/openapi.yaml`: authoritative HTTP contract.
- `contracts/event-input.v2.schema.json`: authoritative event-answer contract.
- `rules/schemas/ruleset.v2.schema.json`: authoritative rules artifact contract.
- `rules/fixtures/v2/*.json`: executable regulatory fixtures.
- `docs/SECURITY-PRIVACY.md`: trust boundary, tenant authorization, upload controls, PII/consent, retention/deletion, audit, secrets, and demo-data policy.
- `docs/DEPLOYMENT.md`: one selected environment and exact build/run/migrate/worker procedures.
- `.env.example`, pinned Node/pnpm versions, lockfile, CI workflow, CODEOWNERS, PR template, and spec/ADR templates.

## Recommended reconciliation sequence

### Gate 0 — Freeze

- Do not start F-xxx implementation branches.
- Rename or archive old versions so there is only one discoverable current set.
- Create `docs/BASELINE.md` with every item marked `PROPOSED`, `APPROVED`, or `SUPERSEDED`.

### Gate 1 — Product and regulatory baseline

- Team approves v2 authority hierarchy and status vocabulary.
- Verification owner reviews the remaining disputed copy and unresolved facets.
- Product owner approves the two-pass intake promise and replacement demo.
- Scenario suite becomes approved and every demo-critical scenario gets an exact JSON fixture.

### Gate 2 — Technical contracts

- Approve the revised architecture and record unresolved tool/provider choices as ADRs.
- Publish the ruleset and event-input JSON Schemas.
- Approve the stable Event identity plus immutable Event Revision contract.
- Publish OpenAPI and database migration 001 from those contracts.

### Gate 3 — Feature delegation

- Write and approve Phase 1 specs.
- Assign each spec a primary owner, reviewer, allowed file footprint, upstream contract version, and merge order.
- Scaffold shared packages on one integration branch; feature branches start only after it merges.

### Gate 4 — Green gate

- Rules schema validation passes.
- All Tier 1 approved v2 fixtures pass as unit tests.
- API contract and migration tests pass.
- The selected flagship scenarios pass through the real UI in E2E tests.
- No core request can return a partial result labeled complete.
- The demo environment is access-gated and contains synthetic data only unless authentication has shipped.

## Final assessment

The product does not need a new vision. It needs one controlled baseline. The newer v2 work is directionally the right foundation because it corrects unsafe universal assumptions and explicitly models conflicts and coverage. But it must be propagated through the product contract and converted into executable schemas/fixtures before parallel coding begins.

The highest-leverage changes are: adopt v2 everywhere, replace the flat feasibility verdict, split the intake into triage plus follow-ups, approve machine-readable fixtures, and make Event Revision—not a mutable wide Event row—the engine input contract. Once those are done, the four coding lanes can be genuinely independent without diverging.
