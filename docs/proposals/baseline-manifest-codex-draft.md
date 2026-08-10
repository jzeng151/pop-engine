# PopEngine — Baseline Manifest

**Status:** PROPOSED  
**Implementation state:** FROZEN pending reconciliation approval  
**Last reviewed:** 2026-07-22

This file is the entry point for humans and coding agents. An artifact is implementable only when its row is `APPROVED`. A blank approval or checksum is not permission to infer a value.

## Current reconciliation baseline

| Concern                     | Artifact                                    | Version/status                                                            | Approval | Checksum/commit |
| --------------------------- | ------------------------------------------- | ------------------------------------------------------------------------- | -------- | --------------- |
| Product requirements        | `docs/PRD.md`                               | Existing file: `SUPERSEDED_PENDING_REWRITE` because it describes `nyc.v1` | —        | —               |
| Feature registry/phasing    | `docs/ROADMAP.md`                           | `PROPOSED_PENDING_V2_RECONCILIATION`                                      | —        | —               |
| Delivery lanes/gates/demo   | `docs/DESIGN.md`                            | `SUPERSEDED_PENDING_REWRITE`                                              | —        | —               |
| Technical architecture      | `docs/ARCHITECTURE.md`                      | Use reconciled proposal for review; not yet implementable                 | —        | —               |
| Documentation governance    | `docs/DOCUMENTATION-GOVERNANCE.md`          | `PROPOSED`                                                                | —        | —               |
| Agent instructions          | `/AGENTS.md`                                | `PROPOSED`                                                                | —        | —               |
| Open questions              | `docs/OPEN-QUESTIONS.md`                    | Existing v1 register: `ARCHIVED_PENDING_V2_REGISTER`                      | —        | —               |
| Regulatory research dossier | `docs/archive/v1/VERIFICATION-SOURCES.md`   | `ARCHIVED_MIGRATION_EVIDENCE`                                             | —        | —               |
| Rules schema                | `rules/schemas/ruleset.v2.schema.json`      | `MISSING_BLOCKER`                                                         | —        | —               |
| Event Input schema          | `contracts/event-input.v2.schema.json`      | `MISSING_BLOCKER`                                                         | —        | —               |
| NYC rules content           | `rules/published/nyc.v2.json`               | Supplied content: `PROPOSED_PENDING_SCHEMA_AND_REVIEW`                    | —        | —               |
| Regulatory scenarios        | `docs/regulatory-scenarios.v2.md`           | Supplied suite explicitly says `Draft`                                    | —        | —               |
| Executable fixtures         | `rules/fixtures/v2/*.json`                  | `MISSING_BLOCKER`                                                         | —        | —               |
| HTTP contract               | `contracts/openapi.yaml`                    | `MISSING_BLOCKER`                                                         | —        | —               |
| Database contract           | migration head                              | `MISSING_BLOCKER`                                                         | —        | —               |
| Phase 1 feature specs       | `specs/F-101` through scheduled Phase 1 IDs | `MISSING_BLOCKER`                                                         | —        | —               |

## Proposed version conventions

- Jurisdiction rules content: `us-ny-nyc@MAJOR.MINOR.PATCH`
- Rules artifact schema: `popengine-rules/vMAJOR`
- Event Input schema: `popengine-event-input/vMAJOR`
- Engine: package semantic version plus build commit
- Calendar: named artifact and version/checksum, e.g. `us-ny-business-days@YYYY.REVISION`
- API: path major (`/api/v1`) plus OpenAPI document version

The team may choose another format through an ADR, but all active artifacts must use one format consistently.

## Approval checklist

- [ ] Product owner approves qualified completeness promise and two-pass intake.
- [ ] Team approves v2 status model and replacement flagship demo.
- [ ] Verification owner reviews unresolved v2 facets and conflicting Parks beach copy.
- [ ] V2 scenario suite is corrected, reviewed, and approved.
- [ ] Ruleset and Event Input JSON Schemas exist and validate supplied data.
- [ ] Tier 1 scenarios have exact executable JSON fixtures.
- [ ] Reconciled PRD, roadmap, design, architecture, contributing guide, and README contain no v1 references.
- [ ] Blocking architecture ADRs are approved.
- [ ] Event/Event Revision, ruleset/plan, and OpenAPI contracts are merged.
- [ ] Phase 1 feature specs are approved and assigned.
- [ ] Every approved artifact row above records approver, date, and checksum/commit.

When all required rows are approved, change **Implementation state** from `FROZEN` to the current phase and commit this manifest before opening feature branches.
