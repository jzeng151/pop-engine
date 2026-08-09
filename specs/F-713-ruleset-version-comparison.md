# F-713 · Rules Admin: Ruleset Version Comparison

**Status:** PROPOSED (2026-07-26) — ready for review; not implementable until approved and listed in `docs/BASELINE.md`.

**Phase:** 4 · **Issue:** [#66](https://github.com/jzeng151/pop-engine/issues/66) · **Owner:** TBD · **Reviewer:** product owner · **Approval date:** —

## Purpose and User Outcome

Rules reviewers can compare two immutable ruleset versions by stable identity and see structural and semantic field changes without guessing their user impact.

## Scope

**In scope**

- Diff metadata/config/intake/rule/advisory/source/verification facets by stable `rule_id`, using an explicitly reviewed lineage mapping that declares the exact artifact lineage and the exact version endpoints being compared, for renamed, split, or merged rules, and stable field paths. `(ruleset_version, rule_id)` identifies a stored rule within one version; it does not match rules across versions.
- Show added, removed, and changed data plus linked F-712 result differences when available.
- Export a bounded machine-readable/human-readable diff with exact checksums.

**Non-goals**

- Editing, publishing, declaring semantic equivalence, legal interpretation, or generating changelog claims without review.
- Diffing arbitrary unvalidated JSON as a ruleset.

## Dependencies and Baseline

- Immutable published artifact storage, F-712 results where impact is shown, and approved stable identity/diff rules.
- F-703 separate platform rules-admin role, which `F713-AC-07` requires at every comparison, result read, and export. No earlier revision of this spec declared it, which is why nothing here was bound by `F703-AC-04`. F-703 is PROPOSED, so that role is not an approved input today and this spec is not implementable against it until F-703 is approved.
- Both compared artifacts must validate under their recorded schemas.
- Baseline at draft time: PRD, Roadmap, Design, and Phase 0–1.5 Architecture approved 2026-07-22; `ARCHITECTURE-FUTURE.md` approved as a planning target 2026-07-25; NYC ruleset `nyc.v2.7`, rules schema `popengine-rules/v2`, and scenario fixtures v5 where regulatory output is consumed.
- The approval PR must re-pin any baseline version that changes before approval. A proposed or superseded input blocks implementation.

## Inputs, Outputs, State, Validation, and Errors

- Inputs are two exact immutable artifact versions/checksums plus an exact immutable lineage-mapping version/checksum whose declared lineage and version endpoints are those two artifacts, in the order they are being compared; output is a deterministic structured diff that records all three identities.
- Comparison state is valid, incompatible-schema, missing-artifact, or failed; missing/invalid input never produces no changes.
- Field changes are reported as data; user-visible/evaluated impact is shown only from an actual linked test run.
- Missing or unresolved material data stays visibly unset, unknown, pending, or failed as appropriate; it never becomes a successful or complete result.
- Invalid input produces a field or action-specific error without partial mutation. Retriable external failures preserve the user's confirmed state and expose a safe retry.

## UI and Accessibility

- Diff supports keyboard navigation/filtering, text add/remove/change labels, source/status context, and exact version/checksum headers.
- The complete workflow is keyboard operable, uses programmatic labels and visible focus, does not encode status by color alone, and announces asynchronous success or failure.
- Empty, loading, permission-denied, validation, provider-failure, and unavailable states have explicit copy and a safe next action.

## System Impact

| Concern              | Proposed impact                                                                                                  |
| -------------------- | ---------------------------------------------------------------------------------------------------------------- |
| API                  | Artifact comparison/result operations require platform-admin OpenAPI contracts.                                  |
| Schema               | No new regulatory schema; persist comparison artifacts only if audit/approval requires them.                     |
| Jobs                 | None for bounded artifacts; asynchronous diff only if measured size requires it.                                 |
| Providers            | None.                                                                                                            |
| Privacy and security | Rules-admin read scope, immutable artifact verification, bounded parsing, no dynamic execution, and safe export. |

Exact HTTP, JSON Schema, migration, job, and provider shapes belong in their reviewed machine contracts; this proposal does not authorize parallel local types or edits to merged migrations.

## Acceptance Criteria

1. **F713-AC-01:** The comparison verifies and displays both exact versions/checksums before diffing.
2. **F713-AC-02:** Added, removed, and changed registry/rule/advisory/source/verification/config fields are deterministically matched across versions by stable `rule_id` or the exact immutable approved lineage mapping and are path-addressable; ruleset version is not part of the cross-version match key.

   The lineage mapping is bound to the pair being compared and is not selected by identity and approval alone. Every mapping version declares the exact artifact lineage and the exact from-version and to-version endpoints it was created for, and each of its rename, split, and merge entries declares the same, so a mapping is usable in a comparison only when its declared lineage and both declared endpoints equal the lineage and the two exact artifact versions `F713-AC-01` verified, and an individual entry is applied only when its own declared endpoints equal them too. Direction is part of the match: the swap `F713-AC-05` defines reverses the comparison, so the mapping applied to a reversed comparison is the one declaring those endpoints in the reversed order, and a mapping is never applied to a pair it does not name in the order it names them.

   Exactness and approval are what an earlier revision checked, and neither is a binding. A mapping created for a different lineage, or for a different version interval within the same lineage, is exact, immutable, approved, and checksum-recorded, so a caller comparing artifact versions A and B could select it and every check in this spec would pass: `F713-AC-01` verifies A's and B's checksums and says nothing about the mapping, and `F713-AC-06` records the mapping's checksum, which proves which mapping was used and not that it belonged here. Its rename, split, and merge entries would then join rule identities that were never the same rule across A and B, so the diff would report unrelated rules as changed and hide real additions and removals as renames, silently and with every checksum in the result correct. A comparison whose selected mapping fails this binding is an explicit failure under `F713-AC-03`, naming the mapping's declared endpoints and the pair requested; it never falls back to `rule_id`-only matching, because that fallback would report every renamed rule as one removal and one addition and present it as a successful diff.
3. **F713-AC-03:** Missing, invalid, checksum-mismatched, or incompatible artifacts, and a lineage mapping that is missing, invalid, checksum-mismatched, or not bound to the compared pair under `F713-AC-02`, produce an explicit failure and never 'no changes' and never a partially matched diff.
4. **F713-AC-04:** The UI makes no evaluated/user-impact claim unless linked F-712 runs use the exact artifacts and byte-identical engine version, fixture set, calendar, `today`, and other evaluation inputs; mismatched runs are labeled incomparable with every differing input exposed.
5. **F713-AC-05:** Swapping versions preserves changed values and reverses only before/after and add/remove direction.
6. **F713-AC-06:** Every result/export records the lineage-mapping version/checksum together with the lineage and version endpoints that mapping declares, so a reader can check the binding `F713-AC-02` requires rather than only that some approved mapping was used; changing a mapping creates a new immutable mapping version and a separately identifiable comparison result.

7. **F713-AC-07:** Comparison, result read, and export are rules-admin functions and are admitted only by the separate platform rules-admin role, on the terms `F703-AC-04` states for every such function rather than on a second formulation stated here. The acting actor's current platform authority is read server-side at the operation that computes the diff and again at every later read or export of its result, never from the session, a client-supplied role claim, or the authority held when the comparison was requested. That authority never derives from a workspace role: F-703's deny-by-default state rule says platform rules-admin checks never derive from one and `F703-AC-04` keeps the role separate from and ungrantable by a workspace owner, which is the reading `F711-AC-06` already takes for a platform surface, so naming a workspace, holding any workspace role, or owning a workspace admits nothing here. A refused request computes no diff, writes no export artifact, and returns a response that does not distinguish a missing artifact version, lineage mapping, or checksum from one the actor may not see. Authority lost after a comparison is computed blocks every later read and export of that result, including a retained one.

   AC-01 through AC-06 all pass for a diff computed and exported for an ordinary workspace member. They verify both checksums, match fields across versions, refuse a failed comparison, bound the impact claim to a matching F-712 run, and keep the result and its lineage mapping identifiable, and not one of them asks who the actor is. The only platform-admin wording in this spec was the System Impact API row and the rules-admin read scope beside it, and System Impact creates no acceptance criterion, so an implementation built to the criteria could ship the whole surface ungated and still conform. What that exposes is not a harmless read: the diff carries the source, verification, and configuration facets of two rulesets, including which sources changed and which verification decisions moved, and the export carries them off the surface in a machine-readable file. Disclosure is the harm even though nothing is written, which is why no write-shaped criterion elsewhere on this branch reaches it.

   F-703 is PROPOSED and is not listed in `docs/BASELINE.md`, so the role this criterion names is not an approved artifact today and no criterion here can be implemented against a named role identifier or grant path. Until F-703 is approved this criterion is testable only as "every comparison, result read, and export is refused unless the acting actor holds the separate platform rules-admin role, read server-side at that operation, and a refusal discloses nothing about what exists", not against a specific role name, matrix entry, or administration path. Those belong to F-703's own approval blockers, which name the role/action matrix and the platform-role administration path.

## Fixtures and Verification

- Planned automated fixture IDs are the acceptance IDs above; each must map one-to-one to a runnable test before approval can claim implementation readiness.
- F713-AC-02 and F713-AC-03 include a fixture in which two approved lineage mappings exist and the comparison of artifact versions A and B selects the one declaring a different lineage: the comparison fails explicitly under AC-03, naming that mapping's declared endpoints, and produces no diff, no 'no changes' result, and no `rule_id`-only fallback. A second fixture does the same for a mapping declaring the correct lineage but a different version interval, a third for a correctly bound mapping carrying one entry whose own declared endpoints do not match the pair, so that entry is not applied, and a fourth reverses the comparison under AC-05 and proves the mapping declaring the endpoints in the reversed order is the one applied. A control fixture compares A and B with the mapping declaring exactly that lineage and those two endpoints and produces the expected renames, splits, and merges.
- F713-AC-07 includes a negative fixture per operation in which an authenticated actor holding no platform rules-admin role, including a workspace owner, is refused a comparison, a result read, and an export, with no diff computed, no export artifact written, and a response indistinguishable from the one for artifacts that do not exist; and a fixture in which the role is revoked after a comparison completes and the later read and export of that result are refused.
- Regulatory fixtures: Known immutable artifact pairs covering add/remove/change, schema-version mismatch, checksum failure, and no-change.
- Security-sensitive and cross-workspace paths require negative authorization tests; provider paths require success, duplicate-delivery, retry, invalid-signature, and permanent-failure tests where applicable.

## Allowed Footprint and Coordination

- `apps/web` and `apps/api` feature code and tests.
- New ordered forward migrations and approved OpenAPI/JSON Schema changes required by this feature.
- No repository restructuring, speculative package, or unrelated feature edit.
- Shared contracts, migrations, provider adapters, engine/rules artifacts, consent policy, and cross-lane UI primitives require the approvals named in `docs/DOCUMENTATION-GOVERNANCE.md` §6.

## Rollout and Fallback

- Compute on demand; retain a diff only when linked to review/publish evidence.
- Rollback disables the new surface and workers/provider calls without deleting confirmed user data or rewriting immutable plans, rulesets, revisions, or history.

## Approval Blockers

- Approve stable identity/path diff rules, including the lineage and version endpoints a mapping version and each of its entries declares under `F713-AC-02`, schema compatibility policy, export format, and impact wording.
- Approve F-703, whose role/action matrix and platform-role administration path are what make `F713-AC-07` testable against a named role rather than against the shape of a check.
- Assign the owner, approve this spec, and add it to `docs/BASELINE.md`. The reviewer and approver is the product owner (`docs/DOCUMENTATION-GOVERNANCE.md` §6), which is what this spec's header records, and that is the whole requirement: the independent-reviewer element this blocker used to carry was retired on 2026-08-05 (product owner; see §6 and `docs/BASELINE.md`). Until those three things are done this blocker is not satisfied and this spec is not approved: it stays PROPOSED under governance §3, its Approval date stays `—`, and it is not implementable and not listed in `docs/BASELINE.md`. Retiring the reviewer element made this spec approvable; it did not approve it.
