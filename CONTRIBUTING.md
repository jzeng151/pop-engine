# Contributing to PopEngine

**Status:** APPROVED (2026-07-22; PR #137-only access-gated-demo overwrite recorded 2026-07-27; see `docs/BASELINE.md`)

This guide is the contract for how we build. It's written for everyone, including teammates using AI assistants for most of their code. Read it once fully; re-read the Golden Rules before every PR.

## Read This Before Writing Any Code

In order:

1. `docs/PRD.md` — what we're building and why (skim; deep-read your feature's section)
2. `docs/ROADMAP.md` — what ships when; your feature's phase
3. `docs/DESIGN.md` — lanes, the green gate, demo rules
4. `docs/ARCHITECTURE.md` — the schema, the engine design, the API surface
5. `specs/F-xxx-*.md` for YOUR feature — this is your actual task. The acceptance criteria in the spec are the definition of done. If the issue and the spec ever disagree, the spec wins; say so in the issue.

## Golden Rules (project-specific, non-negotiable)

1. **Never invent a permit fact.** Every lead time, fee, agency, and requirement comes from `rules/nyc-rules.v2.11.json`. If data is missing, the UI says "confirm with agency" (RESEARCH_REQUIRED) and you flag it in `docs/OPEN-QUESTIONS.md`. Making up a plausible number is the one unforgivable failure in this project. This applies doubly to AI assistants: they will happily invent city regulations that sound real. Reject that output. (This has already happened once in this project's history; the recovery took a full day.)
2. **Never edit verification statuses.** The `verification` blocks in the rules file (SOURCE_CONFIRMED / OFFICIAL_CONFLICT / RESEARCH_REQUIRED / VERIFIED) are changed by exactly one person (the verification owner, Dev 4) after checking a primary source. Not by you, not by your AI.
3. **The `events` contract is frozen for the access-gated demo.** PR #137 ratified the cumulative Phase 1 schema and `docs/EVENT-REVISION-CONTRACT.md` under its recorded one-time product-owner overwrite. That is not teammate approval: strict all-lane ratification remains required before production activation. Every later shared/core-table change requires `docs/DOCUMENTATION-GOVERNANCE.md` §6; never add a column in a feature branch without it.
4. **No mocks in the core path.** F-101 through F-204 must be real. Permitted demo fallbacks for stretch features are listed in `docs/DESIGN.md`; nothing else gets faked.
5. **Stay inside your spec.** If you notice something broken elsewhere, open an issue; don't fix it in your feature branch. PRs that touch files outside their feature's footprint get bounced back.
6. **Authority runs downhill.** Approved primary source → published rule (`rules/nyc-rules.v2.11.json`) → fixture suite (`docs/test-scenario-answer-key.md`) → engine output → UI copy. When two levels disagree, the lower one is wrong: fix the fixture to match the rule, fix the rule to match the source (through Dev 4). Never bend the engine to reproduce a broken expectation, and never resolve a disagreement by picking the version you prefer — file a `SPEC-CONFLICT` issue (see `docs/DOCUMENTATION-GOVERNANCE.md` §5).

## Workflow

- **Branch per feature:** `F-101-event-intake`, `F-201-plan-generator`, etc. Branch from `main`, keep branches short-lived.
- **Small PRs.** One feature, or one coherent slice of a feature. A PR that can't be reviewed in 15 minutes is too big.
- **Every PR needs:** a link to its issue, all tests passing, coverage at threshold, and one teammate's review. You cannot merge your own PR unreviewed.
- **`main` stays green.** If you break `main`, fixing it is your top priority.
- **Commit messages:** one line, present tense, say what changed: `Add slack warning to verdict computation`, not `fixes` or `wip`. No AI attributions or tool signatures in commits or PRs.

## Code Style

**Language:** TypeScript everywhere (ARCHITECTURE AD-8). In Phase 0–1.5, the engine package (`packages/engine`) exports the shared types; import them, never redefine them. The approved Phase 2 code-generation handoff moves schema-derived contract types to `packages/contracts` and updates all imports plus this guide and `AGENTS.md` in one PR; until then, the engine remains authoritative and no duplicate definitions are allowed.

**Semantic names.** Names must say what a thing is or does, in full words. The reviewer should understand a line without scrolling.

| Bad                        | Good                                                 |
| -------------------------- | ---------------------------------------------------- |
| `d1`, `tmp`, `data2`       | `latestApplyDate`, `pendingAlerts`, `rescopedIntake` |
| `check(e)`                 | `computeFeasibilityVerdict(event)`                   |
| `flag`, `ok`               | `isFeasible`, `hasHardFloorBreach`                   |
| `proc()`                   | `scheduleDeadlineAlerts()`                           |
| `x.filter(y => y.s === 2)` | `planItems.filter(item => item.kind === "permit")`   |

Conventions: booleans read as questions (`is…`, `has…`, `needs…`); functions are verb phrases; constants that mirror rules data use the rules file's names (`slack_warning_days` → `SLACK_WARNING_DAYS`); database columns are snake_case, TypeScript is camelCase, and the mapping happens in one place (the data layer), not scattered.

**Other style rules:**

- Small functions that do one thing. If you need a comment to explain _what_ a block does, extract it into a well-named function instead.
- Comments only for things code can't say: constraints, gotchas, links to the spec or an OPEN-QUESTIONS item (e.g. `// hard floor is a cliff, not a gradient — see F-102 spec #3`).
- No dead code, no commented-out blocks, no `console.log` left behind.
- No new dependencies without asking the team. Beginners + AI assistants tend to accumulate packages; every dependency is a liability we all inherit.
- The engine stays pure: no database, no HTTP, no `Date.now()` inside `packages/engine`. `today` is always a parameter.

## Testing — 90% Coverage, Enforced

- **Tooling:** Vitest across the monorepo. `pnpm test` runs everything; `pnpm test --coverage` shows coverage.
- **Threshold:** 90% minimum for statements, branches, functions, and lines, enforced in the Vitest config and in CI. PRs that drop coverage below 90% fail automatically. Don't game it with meaningless tests; a test that asserts nothing real will get flagged in review.
- **The engine is held higher:** the full fixture suite (6 scenarios + boundary fixtures in `docs/test-scenario-answer-key.md`, `today = 2026-07-22`) runs as the engine's test suite and must always pass. Aim for 100% on verdict logic; a rules engine with an untested branch is a rules engine that lies.
- **Write tests from the spec, before or with the code.** Each acceptance criterion in your spec becomes at least one test. If you can't figure out how to test a criterion, that's a design question; ask before coding around it.
- **What kind of test where:** engine and utilities → unit tests; API routes → integration tests (supertest against the Express app with a test database); UI → component tests with Testing Library for logic-bearing components. Don't write snapshot tests as a substitute for asserting behavior.
- **Edge cases from the spec are tests**, not comments. Boundary tests are mandatory where the spec names one (headcount 19/20/21, the 21-day cliff at 20/21/22 days out).

## Working With AI Assistants

Most of us build with AI. That's fine and expected; here's how to do it without wrecking the project:

1. **Feed it the right context.** Paste your feature's spec and the relevant ARCHITECTURE section into the conversation before asking for code. Code generated without the spec will drift from the plan.
2. **You are the author.** Read and understand every line before you commit it. If you can't explain a line in review, don't ship it; ask the AI to explain it first, and simplify it if the explanation is complicated.
3. **Reject scope creep.** AI output loves adding options, abstractions, extra endpoints, and "improvements." If it isn't in the spec, delete it before the PR.
4. **Never accept regulatory content from an AI.** Permit names, lead times, fees: rules file only (Golden Rule 1).
5. **Don't let it restructure.** The repo shape, schema, and API are decided (ARCHITECTURE). Prompt with "follow the existing structure"; reject output that moves files or renames established concepts.
6. **Tests are not optional AI output.** Ask for tests against the spec's acceptance criteria, then verify the tests actually assert the criteria, not just "it renders."

## When You're Stuck

Thirty-minute rule: if you're blocked for 30 minutes, post in the team channel with what you tried. Losing an hour to pride is how a 2-week timeline dies. "I don't understand what the spec means by X" is a great message; the spec might be wrong, and finding that out fast is a contribution.

## Definition of Done (every feature)

- [ ] All acceptance criteria in the spec demonstrably met
- [ ] Tests written from those criteria; `pnpm test --coverage` ≥ 90%, everything passing
- [ ] Engine scenario suite still green (all six)
- [ ] No new dependencies without team sign-off
- [ ] No schema changes (or team-approved if unavoidable)
- [ ] PR reviewed by a teammate and linked to its issue
- [ ] Your lane's verification check from `docs/DESIGN.md` passes
