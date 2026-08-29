# F-707 · Production Dependency Security

**Status:** APPROVED (2026-08-29, product-owner approval in issue #304) · **Reviewer/approver:** product owner · **Owner:** product owner · see `docs/BASELINE.md`.
**Phase:** 0 foundation · **Horizontal:** Platform & Rules Administration · **Issue:** [#304](https://github.com/jzeng151/pop-engine/issues/304)

## Purpose and user outcome

PopEngine's deployed services install a production dependency graph with no known advisories. A
dependency fix must also preserve the frozen install and the production build used for deployment.

## Scope

In scope:

- override the exact PostCSS 8.4.31 transitive dependency to 8.5.23;
- override the exact Sharp 0.34.5 transitive dependency to 0.35.3;
- regenerate `pnpm-lock.yaml` with pnpm 11.5.3; and
- verify the resulting production dependency graph, frozen install, build, and existing repository
  behavior.

Non-goals:

- no new package, direct dependency range, package manager, or Next major or minor upgrade;
- no general dependency-update automation or policy for future advisories;
- no application behavior, API, schema, migration, ruleset, fixture, regulatory output, or UI
  change; and
- no override for a version that the installed Next dependency graph does not request.

## Dependencies and baseline

- Next 15.5.21 is the installed framework version and requests the affected transitive versions.
- Node 22 and pnpm 11.5.3 are the repository and CI toolchain.
- The current artifact versions remain those in `docs/BASELINE.md`. This feature consumes no
  ruleset, regulatory fixture, provider, or shared application contract.
- This feature adds no dependency, so it does not create the new-dependency ADR required by
  `CONTRIBUTING.md`.

## Inputs, outputs, validation, and errors

The inputs are `pnpm-workspace.yaml`, the workspace package manifests, and the npm advisory data
read by `pnpm audit --prod`. The output is the frozen dependency graph in `pnpm-lock.yaml`.

The accepted state has both exact overrides, a lockfile generated from them, no known production
advisory, and a successful Next production build on Node 22. A missing override, a stale lockfile,
an advisory, an install failure, or a build failure rejects the change. A registry or audit-service
error is not a clean audit and must not be reported as one.

There is no user-visible state or accessibility impact.

## System impact

| Concern              | Impact                                                                                                                                     |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Runtime              | No feature logic changes. Next loads the updated Sharp transitive version during image optimization.                                       |
| API and schema       | None. No endpoint, contract, table, column, or migration changes.                                                                          |
| Jobs and providers   | None. No job or application provider changes. The package registry is contacted only by install and audit tooling.                         |
| Privacy and security | Removes known production dependency advisories without weakening an application security control. No secret or user data handling changes. |
| Regulatory output    | None. No rule, source, fixture, finding, verdict, or verification status changes.                                                          |

## Acceptance criteria

1. **F707-AC-01:** `pnpm install --frozen-lockfile` succeeds with pnpm 11.5.3 on Node 22.
2. **F707-AC-02:** `pnpm audit --prod` succeeds and reports no known production dependency
   advisories. An audit-service error fails this criterion.
3. **F707-AC-03:** `pnpm-workspace.yaml` overrides only PostCSS 8.4.31 to 8.5.23 and Sharp 0.34.5
   to 0.35.3. Direct dependency ranges and the installed Next version do not change.
4. **F707-AC-04:** `pnpm-lock.yaml` records the same overrides and contains no stale locked
   PostCSS 8.4.31 or Sharp 0.34.5 package entry.
5. **F707-AC-05:** `pnpm build` succeeds on Node 22 with the updated Sharp package and produces the
   existing web application routes.
6. **F707-AC-06:** Baseline drift, formatting, lint, type checking, database migrations, and the
   full test suite pass. Coverage remains at or above the repository's 90 percent threshold.

## Fixtures and verification

There are no regulatory fixtures. The runnable checks are:

```text
pnpm install --frozen-lockfile
pnpm audit --prod
pnpm check:baseline
pnpm format:check
pnpm lint
pnpm typecheck
pnpm --filter api migrate up
pnpm test:coverage
pnpm build
```

The lockfile and workspace configuration are the direct fixtures for F707-AC-01 through
F707-AC-04. The existing build and test suites cover F707-AC-05 and F707-AC-06.

## Allowed file footprint and coordination

Implementation is limited to `pnpm-workspace.yaml` and the generated `pnpm-lock.yaml`. This spec,
`docs/ROADMAP.md`, and `docs/BASELINE.md` record its approved scope. Both package files are shared
repository inputs and require coordination with any concurrent dependency update.

## Rollout and fallback

Deploy through the normal CI path only after every acceptance check passes. If either override
breaks installation or the production build, do not deploy the dependency change. Revert it while
issue #304 remains open rather than restoring a vulnerable graph and calling the feature complete.

Remove an override when a compatible Next release no longer requests its vulnerable source
version. Regenerate the lockfile and rerun every acceptance check before merging that removal.
