# Issue #108 decision brief: three-state `asked_when`

**Status:** PROPOSED

This document recommends an action on issue #108. It changes no engine code, no ruleset, no
fixture, no schema and no manifest entry. The branch carrying it contains the document and nothing
else. Nothing here is implementable until the approvals named in section 7 are given.

**Relationship to the existing measurement.** `docs/proposals/asked-when-three-state-measurement.md`
is the prior artifact. It is pinned to merge-base `481e1f6` and ruleset **nyc.v2.8**, and the
ruleset has since moved to **nyc.v2.11**. That document is not superseded, and this one does not
repeat it. What this one does is:

- re-measure every load-bearing number on the current tree, because three of them have moved;
- run the throwaway implementation the earlier document could not validate, with all three
  correctness defects its own round 8 identified now fixed, and report what the approved fixtures
  actually do;
- state a recommendation, which the earlier document explicitly declined to do.

Where the two disagree, the disagreement is called out in place. Corrections to the earlier
document are collected in section 8 so its readers can find them.

**Which of issue #108's two inputs this document measures. Read this before any number below.**
The issue names one behaviour but there are two distinct inputs that produce it, and they do not
behave the same way.

- **Q1, the gate that is in scope and UNANSWERED**: raw `undefined` or `null`. Every failure
  count, prototype and plan diff in sections 3, 3a and 4 is Q1, and Q1 is the question PR #167
  measured.
- **Q2, the gate that was ASKED and ANSWERED `"unknown"`.** The merged
  `docs/proposals/unknown-gate-measurement.md:136-138` identifies Q2 as the case issue #108's own
  title describes, and distinguishes it from PR #167's. **The prototype in the appendix does not
  touch Q2.** Its blocker list (`blockersFor`) records a gate only when the raw value is `undefined`
  or `null`, so a gate answered `"unknown"` scopes its dependents out under the patch exactly as it
  does today. Verified by running the same intake on both trees: byte-identical plans
  (section 3b).

**Consequence, stated plainly: this document does not dispose of issue #108.** For Q1 it disposes of
the **engine** question and nothing wider. Sections 3, 3a and 4 measure what `packages/engine`
produces and what an engine-level change would cost; the Q1 probe in appendix A3 calls `evaluate`
directly, because a Q1 intake cannot be submitted through the API at all (section 4). That is an
engine measurement, not an end-to-end one, and this document does not claim to have run Q1 through
the product path: the questionnaire's own scoping in `visibility.ts` and `validate.ts`'s rejection
of an answer to an un-asked question are untouched by the prototype and left unresolved here
(section 3, section 7a item 4, section 8 item 2). What Q1 is disposed of is the semantics question
inside the engine and its cost; what the organizer would be asked and shown under a changed Q1 is
not measured anywhere below. For Q2 it publishes a measurement of the engine (section 3b), of
the plan's verdict-detail renderer (section 3c) and of the questionnaire (section 3d), and no more.
Those are three probes at three points, not one run along the path: no measurement in this document
crosses the API or the database, and the joins between the three are read from source (section 3d).
The six-failure count, the 1569/1569 result and the plan diffs say nothing about Q2 at all. Section
7 gives a separate recommendation for each, and issue #108 stays open on Q2 either way.

**Measurement basis.** Every number below was measured on commit `f8d6fc3` (this branch's merge-base
with `origin/main`), ruleset `rules/nyc-rules.v2.11.json`, Node v24, PostgreSQL 18.4, full suite
size **1569**.

**How to reproduce.** The earlier document's recipe was unrunnable for two rounds. This one is
short enough to state completely:

1. `git checkout f8d6fc3 && pnpm install --frozen-lockfile`.
2. Bring up an empty PostgreSQL, export `DATABASE_URL`, and run `pnpm --filter api migrate up`.
   **Without this, 347 of the 1569 tests skip silently**, including all 23 of `apps/api/src/plan.test.ts`,
   which is where the earlier document found 4 of its 15 failures. A run that reports
   "1222 passed | 347 skipped" has not measured the api lane at all.
3. Apply one of the two patches in the appendix (`git apply`), both generated at `f8d6fc3`:
   A1 for the attempt A failure count, A2 for the attempt B green run.
4. `pnpm test`.
5. For the plan diffs, write appendix A3 to `packages/engine/src/probe.test.ts`, run
   `npx vitest run packages/engine/src/probe.test.ts` on the patched and unpatched trees, and
   delete the file afterwards. It is a probe, not a fixture, and nothing on this branch adds it.
6. For section 3c's on-screen result, write appendix A4 to
   `apps/web/app/plan/render-probe.test.tsx`, run
   `npx vitest run apps/web/app/plan/render-probe.test.tsx` on the unpatched tree, and delete it
   afterwards. Same status: a probe, not a fixture.
7. For section 3d's questionnaire result, write appendix A5 to
   `apps/web/app/intake/questionnaire-probe.test.tsx`, run
   `npx vitest run apps/web/app/intake/questionnaire-probe.test.tsx` on the unpatched tree, and
   delete it afterwards.
8. For sections 4 and 7a's nullable-gate result, write appendix A6 to
   `packages/engine/src/intake/nullable-probe.test.ts`, run
   `npx vitest run packages/engine/src/intake/nullable-probe.test.ts` on the unpatched tree, and
   delete it afterwards.

---

## 1. How many intake fields have an `asked_when` gate

**20 of 33 at nyc.v2.11. The issue's "19 of 33" is wrong, and it has never been right.**

Measured over every published artifact, taking the final artifact of each version (`git log` newest
first per file), which is the basis the earlier document settled on:

| ruleset   | intake fields | gated | change to any `asked_when`                                       |
| --------- | ------------- | ----- | ---------------------------------------------------------------- |
| nyc.v1    | 16            | 2     | (structured object form, not the string grammar)                 |
| nyc.v2.1  | 32            | 19    | (first artifact carrying the string grammar)                     |
| nyc.v2.2  | 32            | 19    | none                                                             |
| nyc.v2.3  | 32            | 19    | none                                                             |
| nyc.v2.4  | 32            | 19    | none                                                             |
| nyc.v2.5  | 33            | 20    | `battery_system_kwh`: `null` → `battery_present` (**narrowing**) |
| nyc.v2.6  | 33            | 20    | none                                                             |
| nyc.v2.7  | 33            | 20    | none                                                             |
| nyc.v2.8  | 33            | 20    | none                                                             |
| nyc.v2.9  | 33            | 20    | two fields replaced, gates identical (below)                     |
| nyc.v2.10 | 33            | 20    | none                                                             |
| nyc.v2.11 | 33            | 20    | none                                                             |

So 19 gated fields existed only while the total was 32, and 33 total has always been 20 gated. The
issue pairs the gated count from one era with the total from another. This is not drift the issue
could have anticipated; it is simply not a reading any published artifact supports.

**A correction to this table's own scope, found by re-deriving it rather than carrying it
forward.** An earlier revision started at nyc.v2.3 and called that artifact the first to carry the
grammar. It is not: nyc.v2.1 and nyc.v2.2 carry the same string grammar with the same nineteen
expressions, byte-identical to v2.3's, and nyc.v1 carries two gates in an earlier structured-object
form (`{"field": "location_type", "op": "eq", ...}`) over sixteen fields. Twelve rulesets are
published, not nine. Adding the three does not move any conclusion in this section, and that is
worth saying explicitly rather than leaving the reader to check: 19-of-32 still belongs to the
32-field era, 20-of-33 still holds from v2.5 on, and the counts below are unchanged. What it does
change is what "checked across every published artifact" is entitled to mean in section 4, which
now covers eleven string-grammar artifacts and one structured-form artifact.

**What v2.9 did**, since it is the only composition change since the earlier document was written
and that document does not cover it: `food_affinity_private_exception_claimed` and
`venue_has_assembly_approval` were removed; `venue_paco_covers_exact_event` and
`venue_fdny_pa_permit_current_for_event_space` were added, both carrying
`location_type = private_venue AND headcount gte 75`, which is the gate the removed
`venue_has_assembly_approval` carried. Net gated count unchanged.

**The number that decides the blast radius is 10, not 20**: the fields that act _as_ a gate, since
only those can supply the unanswered state. **This is down from the earlier document's 11.**
Removing `food_affinity_private_exception_claimed` at v2.9 removed the only expression referencing
`event_open_to_public`, so that field no longer gates anything:

| gate field             | type       | registry `nullable` | `events` column | publishes `unknown`? | itself gated? |
| ---------------------- | ---------- | ------------------- | --------------- | -------------------- | ------------- |
| `alcohol`              | boolean    | not set             | NOT NULL        | no                   | no            |
| `amplified_sound`      | boolean    | not set             | NOT NULL        | no                   | no            |
| `battery_present`      | boolean    | not set             | **nullable**    | no                   | no            |
| `food_present`         | boolean    | not set             | NOT NULL        | no                   | no            |
| `generator_present`    | boolean    | not set             | NOT NULL        | no                   | no            |
| `headcount`            | integer    | not set             | NOT NULL        | no                   | no            |
| `location_type`        | enum       | not set             | NOT NULL        | no                   | no            |
| `obstructs_public_way` | enum       | not set             | **nullable**    | **yes**              | yes           |
| `sapo_event_type`      | enum       | not set             | **nullable**    | **yes**              | yes           |
| `structure_types`      | multi_enum | not set             | NOT NULL        | no                   | no            |

The schema column shows `is_nullable` read from `information_schema.columns` against a live database
after `pnpm --filter api migrate up`, not from reading migrations. Three of ten are nullable, and the
same three the earlier document named.

`tent_canopy` and `stage_platform_scaffold` appear in `asked_when` expressions as _values_ of
`structure_types`, not as fields, which is why the gate-field count is 10 and not 12.

None of the 10 is registry-`nullable`. The 8 registry-nullable fields are all leaf quantities
(`tent_area_sqft`, `tent_days_in_place`, `stage_height_ft`, `stage_area_sqft`,
`generator_gasoline_gallons`, `generator_diesel_gallons`, `generator_kw`, `battery_system_kwh`) and
none of them gates anything. That is what makes the state unreachable through the API (section 4).

## 2. The two code paths, as they behave today

There are two separate implementations of `asked_when` scoping. They are not shared code and they do
not have the same shape. Anyone changing one must change or consciously not change the other.

**`packages/engine/src/intake/visibility.ts`, the questionnaire's scoping.**
`askedFields` (line 43) grows an `asked` set to a fixed point. A field joins when _every_ clause
satisfies `asked.has(term.field) && termHolds(term, answers[term.field] ?? null)`, so a gate that has
not itself been asked, and a gate that was asked but is unanswered, both read the same: the clause is
false and the dependent stays hidden. `termHolds` (line 14) is total and boolean; there is no third
outcome anywhere in the file.

This is deliberate and documented in the file's own header comment (lines 3-6): "Visibility is
two-state on purpose: a question is either put to the organizer or it is not. Tri-state evaluation
belongs to the rules engine (F-201) ... An unanswered trigger keeps its dependent question hidden,
the organizer answers the trigger first." (the source uses a dash where this quotation uses a comma)

That comment is correct as UX and it is also load-bearing for validation:
`packages/engine/src/intake/validate.ts` calls `askedFieldNames` (line 285) and _rejects_ a
submission that supplies a field the registry does not consider asked, with a `not_applicable` error.

**`packages/engine/src/conditions.ts`, the engine's scoping.** `createScopeResolver` (line 176) is a
memoized recursive resolver over the parsed clauses, with a cycle guard. `isInScope` (line 212)
returns `definition.askedWhenClauses.every(evaluateClause)`, and `evaluateClause` reads through
`valueOf`, which returns `null` for an out-of-scope field. Again two-state.

**The `not_asked` resolution** the issue points at is in two places, and the issue names neither
precisely (the issue says "around line 327"):

- `resolveAnswer` at **line 239**: `if (!scope.isInScope(field)) return { state: "not_asked" };`
- `evaluateCondition` at **line 314**:
  `if (answer.state === "not_asked") return { result: "false", unknownFields: [], triggeredBy: [] };`

Line 314 is the actual collapse. `not_asked` becomes the tristate `"false"`, contributes no
`unknownFields`, so nothing branches on it and nothing is reported as missing. An in-scope field that
is `null` or `undefined` takes the line-241 path instead and correctly resolves `unknown`. The whole
of issue #108 is which of these two paths a gated field takes when its gate is unanswered: today it
takes line 314's.

**A third path exists and the issue does not mention it.** `packages/engine/src/verdict.ts:273`
filters `resolved.unknownFields` to build the branch set. Since `not_asked` contributes no unknown
fields, a suppressed dependent never becomes a branchable fact either. This is why the change cannot
be confined to `conditions.ts` (section 3).

## 3. Blast radius on the approved fixtures (Q1)

**Headline: no approved expected value moves. Zero.** The full suite passes unchanged under the
tri-state Q1 semantics as attempt B implements them. "As attempt B implements them" is doing work in
that sentence: it is a statement about one prototype on the inputs measured, not about the semantics
in general (see the end of this section). This is the finding that changes the recommendation,
and it does not point the way the issue assumed. Everything in this section and in 3a is Q1;
section 3b is Q2 and none of these numbers carry over to it.

Baseline on `f8d6fc3` with `DATABASE_URL` set: **1569 passed, 0 failed, 61 files**.

**Attempt A, the Q1 semantics and nothing else.** The scope resolver records, per
field, the set of gates that blocked it; `resolveAnswer` returns `unknown` rather than `not_asked`
for a blocked field. Published in full as appendix A1. A gate is counted as blocking only when its
raw value is `undefined` or `null`, so this is Q1 and not Q2.

| Suite                                                                                | Result                     |
| ------------------------------------------------------------------------------------ | -------------------------- |
| `packages/engine/src/acceptance.test.ts` (answer key v7: scenarios A-F + boundaries) | 59 of 60 pass, **1 fails** |
| `packages/engine/src/engine.test.ts`                                                 | 77 of 82 pass, **5 fail**  |
| `packages/engine/src/fixture-ruleset-agreement.test.ts` (97)                         | all pass                   |
| `packages/engine/src/intake/intake.test.ts` (77)                                     | all pass                   |
| `apps/api/src/plan.test.ts` (23)                                                     | all pass                   |
| everything else                                                                      | pass                       |

**6 failures out of 1569, and every single one is `RangeError: Maximum call stack size exceeded`.
There is not one assertion failure in the run.** Verified by counting: the run reports 6 failed tests
and the file contains exactly 6 occurrences of `Maximum call stack size exceeded`, one per failing
test.

This is a materially different result from the earlier document's attempt 1 at v2.8, which produced
15 failures of which 10 were assertion failures (5 verdict flips, 1 extra `triggeredBy`, 4 plan-item
counts). Those 10 came from two fixture objects that omitted `battery_present`. Both have since been
fixed in the fixtures (`docs/test-scenario-answer-key.md` v4 records writing down `battery_present`
for scenarios A, B, D and F), so at v2.11 that class of failure is gone before the change is applied.

The non-termination is the same one the earlier document diagnosed and its diagnosis holds:
`verdict.ts:evaluateConditional` resolves unknowns by substituting candidate values and recursing. A
field that is unknown _for want of its gate's answer_ is not settled by supplying that field's own
value, so the unknown set stops shrinking.

**Attempt B, attempt A plus the three corrections.** Branch on the blocking gate rather than the
blocked field (`verdict.ts`); re-read the recorded indeterminacy after the `isInScope` call that
records it, so a cold resolver and a warm one agree; and evaluate the conjunction three-valued, so a
conjunct that is decisively false settles the expression instead of a blocked sibling
overriding it.

> **Full suite: 1569 / 1569 pass. `pnpm typecheck` clean. Zero expected values move.**

Published in full as appendix A2. Throwaway diff: `packages/engine/src/conditions.ts` **+52/-3**,
`packages/engine/src/verdict.ts` **+9/-2**. Two files, no fixture edit, no `IntakeValue` change, no
migration. `visibility.ts` is untouched, which makes +61/-5 a **lower bound** on implementation size
rather than the size of a complete implementation: leaving that file alone leaves the engine and the
questionnaire disagreeing about which questions were asked, which `conditions.ts:192-195` says they
must not do (section 7a item 4).

The three defects attempt B fixes are the three the earlier document's round 8 flagged as unmeasured
in its own attempt 3. Probes on the current tree, ruleset v2.11:

| probe                                                                                            | attempt A/prior attempt 3                                                                | attempt B                                                        |
| ------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| street event, `obstructs_public_way` unanswered, `street_event_size` resolved on a COLD resolver | indeterminate `false`, blockers `[]` (silent suppression)                                | indeterminate `true`, blockers `[obstructs_public_way]`          |
| same, resolved after the parent                                                                  | indeterminate `true`                                                                     | indeterminate `true`                                             |
| `sound_audible_from_public_way` with `amplified_sound: false` and `location_type` unanswered     | indeterminate `true`, blockers `[location_type]` (wrong: `false AND unknown` is `false`) | indeterminate `false`, blockers `[]`                             |
| `location_type: park`, `obstructs_public_way` and `sapo_event_type` NULL                         | not indeterminate                                                                        | not indeterminate (a legitimately un-asked field stays un-asked) |

So the order-dependence and the conjunction defect are fixable, they are fixed here, and fixing them
still moves no fixture.

**What 1569/1569 does and does not establish, because an earlier revision read it too widely.** It
establishes that attempt B moves no approved expected value on the fixtures and probes actually run.
It does not establish that attempt B is correct across the gate inventory, because the runs do not
cover the inventory. Every published intake (`CASE_0`-`CASE_3` in A3, and every approved fixture)
answers `structure_types`, the one multi-enum among the ten gates, so no measured run has ever put
attempt B in the position of treating a multi-enum as the blocking gate.

That gap is worth naming rather than leaving implicit, because reading the source suggests the
untested path is not benign. Source trace, not a measurement: with `structure_types` absent,
`blockersFor` (A2) records it as the blocker for `tent_area_sqft`, `tent_days_in_place`,
`stage_height_ft`, `stage_area_sqft` and `structure_over_10ft_tall`, and A2's `verdict.ts` change
puts a recorded blocker into the branchable set. `alternativeValues` (`verdict.ts:158-179`) turns a
field's declared `values` into **scalar** branch candidates, so each branch would substitute a
string where the ruleset's `contains`/`contains_any` conditions require an array
(`DOB-TENT-001`, `DOB-STAGE-001`, `DOB-PROP-TRUSS-001`, `CONF-NO-STRUCTURE-001`), and
`conditions.ts:286-295` throws `EvaluationError` on exactly that shape. Whether the throw actually
occurs, and whether anything upstream absorbs it, is **not measured here**: no probe in this
document omits `structure_types`, and I did not add one. It is recorded as an unmeasured risk
against attempt B, and it is why the size and green-run numbers above are stated as what a
two-file prototype produced on the inputs measured, not as a demonstrated correct implementation
(section 8 item 4).

### 3a. The change is not a no-op, and this is the part the fixtures cannot see

**Attempt B changes plan output materially in states no approved fixture covers.** Measured by
running the same intake through `evaluate` with and without the patch, ruleset v2.11,
`today = 2026-07-22`. The intakes and the harness are appendix A3; the counts below are that
harness's output and nothing was measured against an intake this document does not publish. (An
earlier revision reported 8 and 19 here from an intake it did not publish. The published intake
gives 9 and 20 (the same eleven-finding delta and the same finding set), and it is the published
one that this document stands behind.)

Case 1 (`CASE_1` in A3), a street event where nobody answered `obstructs_public_way` (and so nobody
answered `sapo_event_type`):

|           | findings                                                                                                                                                                                                                                                       | verdict     |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| today     | 9, of which **zero SAPO permits** (`SAPO-SCOPE-001` as `no_new_requirement`, plus eight `CONF-NO-*`)                                                                                                                                                            | CONDITIONAL |
| attempt B | 20, adding `SAPO-STREET-SMALL/MEDIUM/LARGE/XL-001`, `SAPO-BLOCK-PARTY-001`, `SAPO-BLOCK-PARTY-SPONSOR-001`, `SAPO-PLAZA-001`, `SAPO-INSURANCE-001`, `SAPO-INSURANCE-BLOCK-PARTY-RIDE-001` as `may_be_required`, `CONF-NO-BLOCK-PARTY-RIDE-001`, `ADV-SAPO-OTHER-CLASS-001` | CONDITIONAL |

**What today actually withholds, and what it does not.** The two plans are not indistinguishable
from the plan for a street event answered "no, it does not obstruct the public way" (`CASE_0` in
A3), and the earlier revision of this paragraph overstated the harm by saying they were. Measured,
the differences today are two: the answered-"no" plan is **FEASIBLE** and the unanswered plan is
**CONDITIONAL**, and the unanswered plan carries `obstructs_public_way` in `missingFacts` with two
branches, the `yes` branch reading

> adds SAPO event type not covered, Block party permit, Block association and neighbor approval,
> Liability insurance for a street or plaza permit, Plaza event permit; drops Street Activity Permit
> Office (SAPO) scope

So the plan does carry an explicit caveat naming the unresolved gate, and it names five of the
findings that answering `yes` would add. What it does **not** name is the four street-size permits:
`street_event_size` sits one level further down, is scoped out by the unanswered
`obstructs_public_way`, and no branch text on any missing fact mentions
`SAPO-STREET-SMALL/MEDIUM/LARGE/XL-001`. Under attempt B the same event names all four. That
narrower gap, a caveat that stops one level short of the permits at the bottom of the chain, is
the real difference, and it is what `AGENTS.md`'s engine invariant ("a material `unknown` never
silently becomes `false`") bears on, with the qualification that today the engine does not consider
the second-level field material.

Case 2 (`CASE_2` in A3), the issue's own worked example, a park event with a generator below both
fuel thresholds where `battery_present` is absent:

|           | findings | `FDNY-GENERATOR-001`       | verdict     |
| --------- | -------- | -------------------------- | ----------- |
| today     | 9        | absent                     | CONDITIONAL |
| attempt B | 10       | present, `may_be_required` | CONDITIONAL |

**The consequence for the decision is the important one.** The approved suite cannot distinguish the
two semantics. 1569 tests, six scenarios and the whole boundary list agree on every expected value
under both. So the fixture evidence is neutral: it neither supports nor blocks the change, and a
"the suite is green" argument for merging it would be an argument that no fixture exercises the
behavior being introduced. Any implementation would ship with zero regression coverage of its own
new behavior unless new fixtures land with it.

One inconsistency the probes surfaced that is worth recording and is **not** created by the change:
in case 2, `CONF-NO-BATTERY-001` fires as `no_new_requirement` both before and after. Under attempt B
the plan simultaneously tells the organizer that battery storage is unknown enough to make
`FDNY-GENERATOR-001` conditional, and confirms that no battery requirement applies. Whether a named
confirmation should fire off an unanswered field is a separate question about the CONF-NO-* rules
(F-201 / issue #107 territory), not about `asked_when`, and I am recording it rather than acting on
it.

### 3b. Q2: the gate that was asked and answered `"unknown"`

Everything above is Q1. This subsection is Q2, measured on its own inputs, because
`unknown-gate-measurement.md:136-138` identifies Q2 rather than Q1 as issue #108's own case.

**Only two of the ten gates can carry `"unknown"` at all.** From the registry's `values` lists
(section 1's table, "publishes `unknown`?" column): `obstructs_public_way`
(`yes`/`no`/`unknown`) and `sapo_event_type` (`street_event`/`block_party`/`plaza_event`/
`other_sapo_class`/`unknown`). The other eight declare no such value, and they are not
all booleans: **five** are (`alcohol`, `amplified_sound`, `battery_present`, `food_present`,
`generator_present`), one is an integer (`headcount`), one is an enum whose published values do not
include `unknown` (`location_type`), and one is a multi-enum (`structure_types`). That is section
1's table read down its type column; an earlier revision of this paragraph said seven booleans and
so contradicted the table immediately above it.

None of the eight can hold the string, but not for one reason: the five booleans and `headcount`
are typed `boolean` and `integer` in `events`, while `location_type` and `structure_types` are
`text` and `text[]` whose check constraints enumerate their published values with no `"unknown"`
among them (`apps/api/migrations/001_initial_schema.ts`). Their nullability is not uniform either:
four of the five booleans are `notNull` in `001_initial_schema.ts`, and `battery_present` is
nullable and was added later by `apps/api/migrations/006_events_battery_present.ts`. Section 1's
table is the authority for that column and this paragraph only reads it.

**The two behave differently, because their dependents use different operators.**

| gate answered `"unknown"` | clause on its dependent          | `evaluateClause` | dependents                                                                       |
| ------------------------- | -------------------------------- | ---------------- | -------------------------------------------------------------------------------- |
| `obstructs_public_way`    | `obstructs_public_way != no`     | **true**         | `sapo_event_type` stays in scope; nothing is suppressed                          |
| `sapo_event_type`         | `sapo_event_type = <class>` (×4) | **false**        | `street_event_size`, `plaza_level`, `plaza_multiple_blocks`, `has_amusement_ride` all leave scope |

`conditions.ts:200-202` is the reason: `=` is `value === clause.value`, and `"unknown"` equals no
declared class, while `!=` is `value !== null && value !== clause.value`, which `"unknown"`
satisfies. So Q2 reduces to one gate, `sapo_event_type`, and four dependents.

**Q2 is reachable, and the storage path is source-traced rather than measured, which is the
material difference from Q1.** `events.sapo_event_type` is a text column whose check is
`oneOf("sapo_event_type", [..., "unknown"])` (`apps/api/migrations/001_initial_schema.ts:34-36`),
`"unknown"` is a declared registry value so `validate.ts` accepts it, and `events.ts:151`/`:154`
writes every registry column as `values[column] ?? null` without special-casing it. Nothing in that
chain rejects it. Read as source, that is three files agreeing; no probe in this document submits a
Q2 intake to `POST /api/events` against PostgreSQL, so "storable" is an inference from those files
and is labelled as one everywhere it is used below. Section 4's "not reachable through the API"
finding is a **Q1** finding and does not extend to Q2.

**The prototype does not change Q2.** `CASE_3` in appendix A3 is a street event with
`obstructs_public_way: "yes"` and `sapo_event_type: "unknown"`. Run on the unpatched tree and on
attempt B it produces the same plan both times: 13 findings, verdict CONDITIONAL, one missing fact
(`sapo_event_type`) with four branches. Attempt B's `blockersFor` returns `[]` for any raw value
that is neither `undefined` nor `null`, so `"unknown"` never becomes a recorded blocker.

**What Q2 does today, measured.** The four dependents leave scope, so
`SAPO-STREET-SMALL/MEDIUM/LARGE/XL-001` and `SAPO-INSURANCE-BLOCK-PARTY-RIDE-001` do not fire. What
the organizer gets instead is `sapo_event_type` as a missing fact with a `street_event` branch
reading

> adds Large street event permit, Medium street event permit, Small street event permit,
> Extra-large street event permit; drops SAPO event type not covered, Block party permit, Block
> association and neighbor approval, Plaza event permit; Liability insurance for a street or plaza
> permit becomes required

plus `SAPO-BLOCK-PARTY-001`, `SAPO-BLOCK-PARTY-SPONSOR-001`, `SAPO-PLAZA-001` and
`SAPO-INSURANCE-001` as `may_be_required` findings in the plan itself.

**So the silent-omission harm issue #108 describes does not reproduce on Q2.** Every requirement the
scoping withholds is named in the branch table by its published label, on a plan the verdict already
marks CONDITIONAL. That agrees with `unknown-gate-measurement.md`'s own summary ("the requirement
does not vanish silently"), independently re-measured here at v2.11 rather than carried forward from
v2.8.

**What that does not settle.** Whether a branch table naming the four street permits is an adequate
presentation of them, or whether they should also appear as `may_be_required` findings the way
`SAPO-BLOCK-PARTY-001` does, is a product and engine-owner question about what "material" means one
level down. This document measures the behaviour and does not rule on it. Section 7 carries a
separate recommendation for Q2 on that basis.

### 3c. Q2 on screen: `CASE_3` through the plan's existing verdict-detail renderer

An earlier revision recorded Q2's on-screen presentation as undetermined and deferred it to a
future measurement. That was wrong: the product path already exists and is reachable from a test,
so it is measured here rather than deferred. `apps/web/app/plan/plan-view.tsx:416-420` passes the
plan's `verdictDetail` to `VerdictDetailPanel`, and `apps/web/app/plan/verdict-detail.tsx:121-139`
renders one row per branch of every missing fact with its value, its verdict copy and its reason.
`apps/web/app/plan/plan-view.test.tsx:1002-1039` is the approved coverage of that behaviour, and
`docs/test-scenario-answer-key.md:23` makes branches-shown the approved CONDITIONAL contract
("a material unknown changes the outcome; branches shown"), with `:144` naming the street-size
ladder specifically.

**How this was measured.** `CASE_3` (appendix A3, unchanged) was evaluated on the unpatched tree at
`f8d6fc3` and its `verdictDetail` and findings rendered through `VerdictDetailPanel` in jsdom, with
`rulesetReferences` built from `rules/nyc-rules.v2.11.json` exactly as `plan-view.test.tsx` builds
them. The harness is published as appendix A4. It is a probe, not a fixture: nothing on this branch
adds it, and it asserts nothing.

**What A4 renders, precisely.** `VerdictDetailPanel` on its own, with the plan object passed in
directly. It does not render `PlanView`, fetch a plan over HTTP, or read one back from the database.
That the page reaches this panel with this plan's `verdictDetail` is read from
`plan-view.tsx:416-420`, not exercised here. So "on screen" below means "rendered by the component
the page renders, given the engine's output for `CASE_3`", and the step from stored row to that
output is the source-traced part (section 3d).

**What the organizer actually sees.** One panel headed "What still depends on your answers", with
these regions:

| region                                | rendered text                                                                                                                                          |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| lede                                  | "Each unanswered fact below was evaluated on every published answer. Answering them may still leave the verdict conditional when a published filing window cannot be dated from the inputs supplied." |
| "Published windows that could not be dated" | "Plaza event permit (More information · Apply through E-Apply): the plan was never asked plaza_level, which this deadline keys on"                 |
| missing-fact heading                  | "sapo event type"                                                                                                                                      |

and one four-row branch table under it, columns "If answered", "Verdict", "Reason":

| If answered      | Verdict    | Reason                                                                                                                                                                                                              |
| ---------------- | ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| street event     | Depends on | adds Large street event permit, Medium street event permit, Small street event permit, Extra-large street event permit; drops SAPO event type not covered, Block party permit, Block association and neighbor approval, Plaza event permit; Liability insurance for a street or plaza permit becomes required |
| block party      | Depends on | adds Block-party ride insurance check, Insurance for a block party with a ride; drops SAPO event type not covered, Liability insurance for a street or plaza permit, Plaza event permit; Block party permit becomes required |
| plaza event      | Depends on | drops SAPO event type not covered, Block party permit, Block association and neighbor approval; Plaza event permit becomes required; Liability insurance for a street or plaza permit becomes required               |
| other sapo class | On track   | drops Block party permit, Block association and neighbor approval, Plaza event permit; Liability insurance for a street or plaza permit becomes required                                                            |

**So the four street-size permits are on screen, by their published organizer labels, in the
`street event` row.** The values are humanised (`street_event` renders as "street event"), the
verdicts go through `verdict-copy.ts` (CONDITIONAL renders "Depends on", FEASIBLE renders "On
track"), and the reason text is the engine's, rendered verbatim. Nothing in the panel drops a branch
it was given: the registry publishes five values for `sapo_event_type` and the panel renders four
rows, the fifth being the answered `"unknown"` itself, which `alternativeValues`
(`verdict.ts:158-179`) excludes before the panel sees it, on both of its grounds at once: it is the
current answer, and `RESCOPE_EXCLUDES_UNKNOWN_VALUES` is `true` (`proposals.ts:166`). So "four
rows" is the engine's branch list rendered in full, not the registry's value list rendered in full.

**What this changes in this document.** Section 7b's recommendation previously rested in part on a
measurement nobody had run. It no longer does: the panel that decides whether "the organizer was
told" is true for Q2 is measured, and given this plan it does tell them. That strengthens the same
recommendation rather than moving it. It does not settle the rest of the path, which section 3d
takes up.

### 3d. Q2 in the questionnaire: how `CASE_3`'s answers are actually entered

An earlier revision listed the questionnaire side as an outstanding measurement. It is not
outstanding; it is reachable from a test the same way section 3c's rendering was, so it is measured
here. `CASE_3` was entered through the shipped `IntakeForm` on a clean `f8d6fc3`, driving the real
component with the contract parsed from `rules/nyc-rules.v2.11.json`, exactly as
`apps/web/app/intake/intake-form.test.tsx` drives it. The harness is appendix A5. It is a probe, not
a fixture: nothing on this branch adds it, and it asserts nothing.

**What the organizer is asked, and what they can answer.**

| step                                                     | measured                                                                                                                        |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| after `location_type: street`, before answering the gate | no `sapo_event_type` question on screen                                                                                         |
| after `obstructs_public_way: yes`                        | the `sapo_event_type` question appears                                                                                          |
| its options                                              | Street event, Block party, Plaza event, Other sapo class, **I don't know** (all five registry values, none dropped)             |
| the form's lede                                          | "Answer what applies to your event. Questions appear as your answers make them relevant, and "I don't know" is a real answer, it is stored as unknown and carried into your plan." (the source uses a dash where this quotation uses a comma) |
| the submitted body after choosing it                     | `sapo_event_type: "unknown"`, sent verbatim, never `false` and never blank                                                       |

`intake-form.tsx:655-675` builds the radio options from `field.values`, the registry's list, with no
filter; `optionLabel` (`:50-51`) is the only special case and it renders `"unknown"` as "I don't
know". So the five options are the registry's five, and `"unknown"` is presented as a deliberate
answer rather than as a skip.

**So `CASE_3` is reachable through the organizer UI, not only through the API.** The shipped
questionnaire offers `"unknown"`, labels it in plain words, and sends it verbatim in the request
body.

**What A5 does not measure, stated because an earlier revision claimed it did.** A5 replaces
`fetch` with `echoSavedEvent`, so the request never leaves the browser environment: nothing in it
exercises the API's validation, the `events` insert, plan generation from the stored row, or
retrieval of that plan back into the UI. A3 calls `evaluate` directly and A4 renders a plan object
in isolation, so no probe in this document crosses those boundaries either. **No run measures the
Q2 path end to end.** What the three probes support is three separate observations at three points
on it: the form asks the question and submits `"unknown"` (A5), the engine scopes the four
dependents out on that value (A3), and the renderer puts the branch table on screen from such a
plan (A4). The joins between them are source-traced, not run: `validate.ts` accepts `"unknown"`
because the registry declares it, the `events` check constraint permits it
(`apps/api/migrations/001_initial_schema.ts:34-36`), and `events.ts:151`/`:154` writes the column
unchanged. Reading those three files is why this document expects the path to hold together; it is
not evidence that it does.

**One detail worth recording.** The submission carries the four suppressed dependents as explicit
`null` (`street_event_size`, `plaza_level`, `plaza_multiple_blocks`, `has_amusement_ride`), and
`validate.ts:143-144` counts an explicit `null` as not provided, so no `not_applicable` error
fires. That the columns then hold NULL follows from `events.ts:151`/`:154`, which writes
`values[column] ?? null` for every column; it is read off the source, not observed on a row. That is
today's behaviour and the prototype does not change it.

**What is still not measured, stated so the narrowing is honest.** Two things, of different kinds.
One is a measurement nobody has run: the product path itself, from `POST /api/events` through the
stored row and plan generation to the rendered page, described in the paragraph above. The other is
not a measurement at all: whether a branch table is the right presentation, as opposed to
`may_be_required` findings on the plan lines themselves, remains the product and engine-owner call
section 3b named. The probes settle what is asked at one end and what is shown at the other, not
what happens in between and not whether what is shown is enough.

## 4. Whether the Q1 state can arise at all

**Not through the API. Re-verified against current code, not carried forward. This section is Q1
only; Q2 is reachable and storable, per section 3b.**

- `packages/engine/src/intake/validate.ts:299`: `if (!isProvided(submission, field.field) && !field.nullable)` raises `required`. All 10 gate fields omit `nullable` in the registry (section 1), so an asked gate cannot be submitted blank.
- `apps/api/src/events.ts:151` and `:164`: both `INSERT` and `UPDATE` build their column list from `intakeColumnNames(intakeContract)`, the full registry, and pass `values[column] ?? null` for each. No column is ever skipped on write, so a partial-column insert cannot happen through the API.
- `validate.ts:285-297` rejects an answer to a question the registry does not consider asked, so a stale answer cannot revive a dependent either.

A gate _is_ NULL whenever it was legitimately never asked (`location_type = park` leaves
`obstructs_public_way` and `sapo_event_type` NULL). Attempt B leaves that case alone; the fourth
probe row in section 3 is exactly this check.

**No `asked_when` expression has ever been widened.** Checked across all twelve published artifacts
(section 1 table, re-derived to include v1, v2.1 and v2.2): within the string grammar, which runs
from v2.1, the one gate change in the project's history is `battery_system_kwh` at v2.5, and it is
a narrowing. The v1-to-v2.1 step is a registry rewrite from sixteen fields to thirty-two and from
the structured-object form to the string one, so it is not an expression-by-expression comparison
and this document does not treat it as one; nothing in it is a widening of a surviving expression
either, because neither of v1's two gated fields survives into v2.1 under the same name. The route
the earlier document identified as the one needing no migration and no SQL,
widening an existing expression so a legitimately-NULL row becomes in-scope-and-unanswered, remains
a future route that has never been taken. That finding stands at v2.11 and is unchanged by anything
here.

**Unreachability rests on the registry as published, not on the validator.** `validate.ts:299`
raises `required` only for a field that is not `nullable`, so the barrier is that none of the ten
gate fields carries `nullable: true` and none of the eight fields that do gates anything. An intake
contract that put those two facts together (a `nullable` gate, by either of the two forms section
7a names) would make the Q1 state reachable on a newly created row, with no prior row and no
widening. Appendix A6 measures one step of that: an in-scope registry-nullable field left
unanswered validates clean and is carried into the record to persist as `null`. The write itself is
source-traced through `events.ts:145` and `:154`, not run.

## 5. Whether `IntakeValue` can represent "unanswered"

**No.** `IntakeValue` is `string | number | boolean | readonly string[] | null` and `null` carries at
least four distinct meanings that only the registry plus the scope resolver can tell apart: never
asked; asked, nullable, deliberately blank; asked and unanswered; absent from a partial write.

**It is declared twice, identically**, at `packages/engine/src/types.ts:5` and
`packages/engine/src/intake/visibility.ts:11`, with `index.ts:20` re-exporting the `visibility.ts`
one. That is a defect against `AGENTS.md` ("never redefine intake, finding, verdict, or status types
locally") and it is independent of issue #108. It should be one declaration plus an import. I am
recording it, not fixing it, because it is not this task's scope.

**What it would cost if the distinction were pushed into the value:** the declaration, `EventIntake`,
`resolveAnswer`, `compareAnswer`, `evaluateClause`, `termHolds`, `validate.ts`'s reader functions and
its persistence loop, `apps/api/src/plan.ts`, and every `?? null` that flattens on the way to
Postgres, including the two in `events.ts:154` and `:170` (the insert's and the update's parameter
lists; an earlier revision cited these as `:157` and `:171`).

**Attempt B needed none of it, and no database change either.** The distinction lives in the scope
resolver as a side table (`Map<string, readonly string[]>` from field to blocking gates), which is
where the information already is: a NULL the registry resolves as in-scope is unanswered, and the
same NULL under a false `asked_when` is not-asked. The row carries only NULL and the ruleset supplies
the rest. So "change `IntakeValue`" is a legibility option, not a requirement, and pricing it as
required overstates the cost of the change.

## 6. The counter-argument, on its merits

**First, a citation correction, because the issue and this task both mis-cite it.** The sentence "a
field never asked is not a material unknown" is `specs/F-201-permit-plan-generator.md:48`, in the
**Edge Cases** section. It is not acceptance criterion 4; AC 4 (line 29) is the near-empty-result
criterion and says nothing about scoping. The sentence is still authoritative (an approved spec's
edge-case clause is approved feature behavior under governance §1), but it is not an acceptance
criterion, and citing it as one overstates its standing relative to the fixture suite.

**Does the sentence forbid the change? No, on a careful reading.** It says a field _never asked_ is
not material. Attempt B agrees with that: the park probe shows a legitimately un-asked field staying
un-asked and non-material. What attempt B changes is the case where the registry _cannot determine_
whether the field was asked, because the answer that would decide it is missing. "Never asked" and
"cannot tell whether it was asked" are different states, and the spec sentence addresses only the
first. The engine's own tri-state invariant, applied one level up to the scoping question, is what
attempt B implements.

That said, the sentence is close enough to the change that the engine owner should be the one to
rule on the reading. I am not treating my reading as settling it. Under governance §5 that ruling
comes **before** any implementation approval rather than alongside it, which is why section 7's
approvals table carries it as a prerequisite row rather than as a caveat.

**Second: would the change reintroduce what nyc.v2.5 removed? Yes, narrowly, and I can name the
rule.** This is not inference. `docs/test-scenario-answer-key.md` v7 records it in its own status
header: "v2.5 changed evaluated output without changing this document: it removed an
FDNY-GENERATOR-001 finding that five scenarios were reporting and none of their expected-findings
blocks ever listed." Before v2.5, `battery_system_kwh` was always asked and is nullable, so an event
with no battery left it blank, it resolved `unknown`, and `FDNY-GENERATOR-001` went conditional on
every such plan. v2.5 added `battery_present` and gated the quantity behind it.

Case 2 in section 3a is that exact finding coming back, on that exact rule, when `battery_present`
is itself absent. `FDNY-GENERATOR-001` is the only rule in the ruleset whose trigger references
`battery_system_kwh`.

**But the reach is narrow and the mechanism is not the same.** v2.5's spurious conditional fired on
events where the organizer _had answered everything they were asked_: the field was in scope, blank
was a legitimate answer, and the engine still called it unknown. Attempt B fires only where an answer
is genuinely missing. Those are different states, and v2.5 did not remove the second one; it removed
the first. So the honest statement is: the change would reintroduce the same finding on the same rule
in a strictly smaller set of cases, all of which are cases where something really is unknown.

Weighed against that: today's behavior on case 1 withholds four SAPO street-size permits from a
street event, and although the plan does name the unresolved gate and five other findings behind it
(section 3a), no branch text reaches the four street permits themselves. Spurious conditionals are a
real product harm, v2.5 exists because of them, but they are visible to the organizer and
recoverable by answering a question. A permit no branch text names is recoverable only by answering
a question the plan does not identify as the one that would produce it.

## 7. Recommendation

**This section recommends separately on Q1 and Q2 (see the scope statement at the top). It does not
dispose of issue #108: the Q2 decision is left open on a measurement, not closed.**

### 7a. Q1, the unanswered gate

**Do not implement the semantics change now. Defer it, with a named trigger and a named
precondition.**

The reasons, in the order they carry weight:

1. **The Q1 state is not reachable through the API and never has been** (section 4, re-verified at
   v2.11), and no published ruleset has ever widened a gate. The change buys correctness in a state
   the deployed system cannot currently produce. That is a statement about the registry as
   published, not about the validator: it holds because no gate field is `nullable`, and a
   published contract that made one `nullable` would make the state reachable on a newly created
   row (section 4, section 7a's trigger). This reason is Q1-specific; it does not transfer to Q2,
   which section 3b shows is reachable and storable.
2. **The approved fixtures cannot tell the two semantics apart** (section 3). Merging a semantics
   change that its own regression suite is blind to is the wrong order of operations regardless of
   which semantics is right. If the change is ever made, the fixtures that distinguish the semantics
   must be approved and land with it, and the two probe cases in section 3a are the natural
   candidates.
3. **The issue underscopes the change.** `verdict.ts` is not optional: without the branching change
   the plan generator does not terminate on six existing tests. Order-independence and three-valued
   conjunction are two further correctness requirements the issue does not mention. All three are
   fixable and are fixed in attempt B. So the issue's "Scope if changed" list, naming
   `visibility.ts` and `conditions.ts`, is incomplete: `verdict.ts` is required as well. It is
   **not** wrong to name `visibility.ts`: attempt B leaves that file untouched and thereby leaves
   the divergence in item 4 unresolved, so the two-file diff below is a lower bound on
   implementation size, not the size of a complete implementation.
4. **`visibility.ts` is an unresolved design question, not a saving.** Attempt B changes the engine's
   scoping and leaves the questionnaire's scoping two-state, so the two would disagree about the same
   event: the engine would call a dependent's scope unknown and material while the form does not ask
   it and `validate.ts` rejects an answer to it. That divergence is defensible (the file's header
   comment argues for it) but it should be decided deliberately, not inherited from a diff that
   happened not to touch the file.

**The trigger that should reopen this. There are two independent routes into the Q1 state, and an
earlier revision described only the first.**

**Route 1, rescoping an existing NULL, needs a conjunction.** Neither half alone is sufficient:

- **stored rows written while the narrower expression legitimately left a dependent NULL**: a row
  written under today's contract cannot supply the state on its own, because section 4 shows every
  asked non-nullable gate is populated on write; and
- **a later widening of that expression**, so a row's legitimate NULL is rescoped into
  in-scope-and-unanswered. A widening in a deployment holding no such rows has no old NULL to
  rescope, so it cannot supply the state on its own either.

**Route 2, a nullable gate, needs neither half and produces the state on a newly created row.** It
was missed by the earlier framing and it is the shorter route. `validate.ts:299` raises `required`
only `if (!isProvided(submission, field.field) && !field.nullable)`, and `isProvided`
(`validate.ts:143-144`) counts an explicit `null` as not provided. So the moment a gate field
carries `nullable: true` in the registry, an in-scope gate may be submitted blank, `events.ts:151`
and `:164` write the column as `values[column] ?? null`, and the row is created in-scope-and-NULL
with no prior row and no widening anywhere in its history. Two intake-contract changes reach that
state:

- **marking an existing gate `nullable`**; or
- **publishing an `asked_when` that references one of today's eight registry-nullable leaf fields**
  (`tent_area_sqft`, `tent_days_in_place`, `stage_height_ft`, `stage_area_sqft`,
  `generator_gasoline_gallons`, `generator_diesel_gallons`, `generator_kw`, `battery_system_kwh`),
  which turns a field that is already blank-able into a gate.

**Measured at the validator, source-traced past it.** Appendix A6 submits a park event with
`structure_types: ["tent_canopy"]` and no `tent_area_sqft` to `validateIntake` against the v2.11
contract on a clean `f8d6fc3`. It returns `errors: []` and `values.tent_area_sqft === null`: an
in-scope registry-nullable field, left unanswered, accepted and carried into the record as `null`.
The probe stops there. It never calls the events router and never executes an INSERT, so "and the
row is created NULL" is read off `events.ts:145` and `:154` (every registry column written as
`values[column] ?? null`) rather than reproduced. Route 2's validator half is measured, its
persistence half is inferred from those two lines, and the only thing today's registry withholds is
a gate in that position,
because none of the ten gate fields is `nullable` and none of the eight nullable fields gates
anything (section 1). What the engine then does with an in-scope NULL gate is not a new
measurement: it is `CASE_1` in section 3a, where the dependents collapse to `false` and four SAPO
street permits go unnamed.

**The reopening trigger, restated to cover both routes:** whichever comes first of

- the first ruleset publication that **widens** any existing `asked_when` expression;
- the deployment **acquiring real event rows**;
- the first intake-contract change that **creates a nullable gate**, by either of route 2's two
  forms.

The first two are deliberately the weaker halves of route 1's conjunction rather than the
conjunction itself, which is a conservative choice and not a claim that either alone makes the
state reachable. The third is not a weakened half of anything: on its own it makes the state
reachable on newly created rows.

**Only two of the three carry a reviewer, and an earlier revision said all three did.** A ruleset
publication that widens an expression is a rule-semantics change and a contract change that creates
a nullable gate is an Event Input/rules-schema change, so both land on §6's table and reach the same
reviewers who would have to weigh this document. Row acquisition does not. Ordinary
`POST /api/events` traffic creates rows, and no §6 row governs a deployment receiving traffic it was
built to receive; nobody reviews anything when the first real row lands. So the second trigger can
fire with nobody noticing that it fired, and treating change approval as the mitigation for it is
wrong. If the team wants that trigger to be real it needs its own mechanism, an operational check on
the events table or a tracked decision point at the point real data is first accepted, and this
document does not create either. What it can do is record which of the three has a reviewer and
which does not.

### 7b. Q2, the gate answered `"unknown"`

**Also do not implement a change now, but on entirely different evidence, and the question is not
closed.** Sections 3b, 3c and 3d measure Q2 and find:

- Q2 **is** reachable: the questionnaire offers `"unknown"` and the submission carries it (section
  3d). Whether the row then stores it is source-traced through `validate.ts`, the `events` check
  constraint and `events.ts`, not measured (section 3b). Either way 7a's reason 1, which turns on a
  state no submission can express at all, does not apply to Q2.
- The prototype in the appendix **does not address** Q2 at all, so 7a's reasons 2, 3 and 4, which
  are all statements about that prototype, do not apply to it either.
- The silent-omission harm issue #108 describes **does not reproduce** on Q2: every requirement the
  scoping withholds is named in the branch table by its published label, on a plan the verdict marks
  CONDITIONAL.
- That branch table **reaches the screen**. Section 3c runs `CASE_3` through the shipped
  `VerdictDetailPanel` and reports what it renders: four rows, one per published `sapo_event_type`
  value, the four street-size permits named by their organizer labels in the `street event` row.
  This is no longer an inference from engine output.
- The organizer **can enter it**. Section 3d walks `CASE_3` through the shipped `IntakeForm`: with
  `obstructs_public_way: "yes"` the `sapo_event_type` question appears, all five registry values are
  offered, `"unknown"` is labelled "I don't know", the lede says it is stored as unknown and carried
  into the plan, and the submission sends `"unknown"` verbatim. So Q2 is not a state only the API can
  reach; it is a state the questionnaire invites.

The last three points are the argument this document has for Q2, and they are an argument against a
change on the evidence available, not a demonstration that today's behaviour is right. Whether
naming the four street permits in a branch table rather than as `may_be_required` findings is the
correct presentation is an engine-owner and product call that no artifact in the repo answers.

**How strong that evidence is, stated exactly.** Three probes at three points on the path, not one
run through it. Nothing measured here submits a Q2 intake to the API, stores it, generates a plan
from the stored row and retrieves it into the page; the API, database and plan-retrieval joins are
source-traced (section 3d). A reader who wants the recommendation to rest on a product-path run
rather than on three isolated probes plus three files read should treat that as the outstanding
measurement it is.

**So: keep issue #108 open, and do not close it as won't-fix or as answered by this document.** Two
measurements an earlier revision made preconditions for a Q2 decision have now been run: the plan
rendering (section 3c) and the questionnaire (section 3d). Neither moved the recommendation. Each
strengthened it in the same direction, by replacing an unrun measurement with a measured one at the
point it covers. Two things are still outstanding on Q2, and they differ in kind: the product-path
run just described, which a measurement would settle, and whether a branch table is adequate
presentation, which no measurement settles.

**What I am explicitly not recommending, and why.** I am not recommending the ruleset alternative
(converting the boolean gates to enums carrying `unknown`) either. The earlier document prices it at
8 rewritten expressions, 11 published objects and 2 validator checks at risk of silent
non-matching, 132 fixture literals, a ruleset publication, a migration, and an unmeasured answer key,
reaching 5 of the 8 gates that need it. I did not re-price it at v2.11 and I do not claim its numbers
are current; I am declining to recommend an option whose cost is that large and whose answer-key
impact nobody has measured, not asserting the numbers.

One thing about it is decidable from section 3b's corrected inventory without re-pricing anything:
the alternative converts booleans, and only five of the eight gates that lack a published `unknown`
are booleans. `headcount` (integer), `location_type` (enum) and `structure_types` (multi-enum) are
not reachable by a boolean-to-enum conversion at all, so whatever that route costs, it does not
close the gap on those three.

### Approvals this decision would require

Under `docs/DOCUMENTATION-GOVERNANCE.md` §5 and §6:

| If the team decides to                    | Row of the §6 table                                                                         | Required approval                                                                                              |
| ----------------------------------------- | ------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Implement the tri-state semantics         | **§5 twice first** (the `F-201:48` reading is unresolved, section 8 item 1; the `ARCHITECTURE.md:83` boundary is contradicted, section 8 item 8), then "Rule trigger, dedupe, branch, deadline, or formula semantics", **plus "Product scope, feature meaning, phase" if resolving `F-201:48` changes what that approved spec requires, plus "Durable architecture decision" if resolving `ARCHITECTURE.md:83` moves that boundary** | **Two prerequisites, both under §5, both ahead of the signatures below: resolve `specs/F-201-permit-plan-generator.md:48`, and reconcile `docs/ARCHITECTURE.md:83` against a semantics that reads a raw NULL as materially unknown.** Only then verification owner (Dev 4) plus engine owner (Dev 1); plus the product owner/team decision if the F-201 resolution moves that spec's scheduled behaviour; plus the architecture owner's ADR approval if the `ARCHITECTURE.md:83` resolution moves that boundary rather than confirming it |
| Add fixtures distinguishing the semantics | "Executable regulatory expectation" is an approved fixture (§1); the answer key is APPROVED | Both prerequisites and the same pair, plus the answer key's own revision authorization                        |
| Take the ruleset alternative              | Regulatory source/status/content **and** rule semantics **and** shared enum **and** database migration touching shared/core tables | Verification owner plus rules reviewer, plus engine owner, plus all affected lane owners and the architecture owner for the shared enum, **plus the database owner** for the migration |
| Do nothing (this recommendation)          | none                                                                                        | none; the issue stays open                                                                                     |

**The `F-201:48` question is a prerequisite, not a detail, and an earlier revision of this table got
that wrong by listing only the two owners.** Section 8 item 1 says the brief cannot determine
whether the approved sentence at `specs/F-201-permit-plan-generator.md:48` ("a field never asked is
not a material unknown") forbids the tri-state behaviour. Section 6 gives a reading on which it does
not, and says the engine owner should be the one to rule; that is still my reading and it is not a
resolution. Governance §1 makes an approved `specs/F-xxx-*.md` authoritative for scheduled feature
behaviour, and `AGENTS.md:15` and governance §5 say what happens when an artifact in that position
is contradictory or unclear: stop the affected implementation, record a `SPEC-CONFLICT` with both
locations and the user-visible consequence, and **resolve the source artifact first**. §5 also names
what must not happen, that a contributor "silently select the version they prefer". Two lane owners
picking a reading of an approved spec between them is exactly that, so the verification and engine
signatures cannot be the mechanism that settles it. If the resolution turns out to change what F-201
requires rather than just to state which reading was always meant, §6's "Product scope, feature
meaning, phase" row adds the product-owner/team-decision capacity on top. This document does not
resolve `F-201:48`, does not decide which of the two routes the resolution takes, and records no
approval of either.

**There is a second prerequisite, and an earlier revision of this table missed it entirely: the
architecture boundary at `docs/ARCHITECTURE.md:83`.** That line, in an APPROVED document, reads:
"Unknown-capable active fields use explicit `unknown` values, never NULL-as-unknown." Attempt B does
the opposite. Its whole mechanism is to read a raw NULL on an in-scope gate as making the gate's
dependents materially unknown (`blockersFor` in appendix A2 records a blocker exactly when the raw
value is `undefined` or `null`), and the gate it does this to in `CASE_1` is
`obstructs_public_way`, which is one of the unknown-capable fields that sentence is about: it
publishes `yes`/`no`/`unknown` and `ARCHITECTURE.md:83` says its unknown is the explicit value, not
the NULL. So the semantics attempt B measures and the technical boundary the architecture document
approved are contradictory as written, and this is a different conflict from `F-201:48`: that one is
about scheduled feature behaviour under governance §1's "Approved `specs/F-xxx-*.md`" row, this one
is about "Technical boundaries and invariants", whose authoritative artifact is
`docs/ARCHITECTURE.md` plus approved ADRs.

Governance §5 applies to it the same way and in the same order: stop the affected implementation,
record a `SPEC-CONFLICT` naming both locations (`docs/ARCHITECTURE.md:83` and the semantics in
section 3) with the user-visible consequence, and **resolve the source artifact first**. That is why
it is a prerequisite row and not a caveat: a table that sequences only the `F-201:48` question could
authorise an implementation while an authoritative technical boundary still says the mechanism that
implementation depends on is not allowed. Two lane owners cannot settle it between them either, for
the same §5 reason. If the reconciliation confirms the boundary as written, the tri-state semantics
needs a different mechanism or does not proceed; if it moves the boundary, that is a durable
architecture decision and §6's "Durable architecture decision or dependency" row requires the
architecture owner's ADR approval on top of the verification and engine signatures. **This document
does not resolve `ARCHITECTURE.md:83`, does not say which way the reconciliation should go, and
records no approval of either outcome.** It records that the conflict exists and that it is due
before implementation approval.

**The database-owner row is not optional and is not held.** The ruleset alternative converts gate
columns in `events` from `boolean` to text carrying `"unknown"`, which is a forward migration on a
shared core table. `docs/DOCUMENTATION-GOVERNANCE.md:96` requires "Database owner plus all affected
lane owners" for that class, separately from the shared-enum row, and an earlier revision of this
table named only the lane and architecture owners. `docs/DESIGN.md:73` puts DB migrations in Dev 4's
lane, so the database owner and the verification owner are the same person here, which is exactly
why the capacity has to be named separately rather than assumed covered by the verification
signature already in the row. No such approval has been given, and nothing in this document should
be read as recording one. `AGENTS.md:44-45` is the standing constraint on the
same table: the `events` schema migration is the four-lane contract, PR #137's one-time overwrite is
the sole recorded exception and creates no precedent, and every later change requires the normal §6
team decision.

`AGENTS.md` states the semantics requirement from the other direction: "Rule-semantics changes also
need the engine owner's (Dev 1) review." Per `docs/DESIGN.md:70` and `:73`, Dev 1 owns engine
fidelity to the ruleset and the fixture suite, and Dev 4 owns verification sign-off. This document
holds none of the approvals in the table above and implements nothing.

## 8. What could not be determined

Stated plainly rather than left as silence:

1. **Whether the engine owner reads `F-201:48` as forbidding the change.** Section 6 gives my reading
   and the reason for it. It is a spec-interpretation call and it is theirs, not mine. Because
   `F-201` is approved and authoritative for scheduled feature behaviour (governance §1), §5 makes
   resolving it the first step rather than a parallel one, and section 7's approvals table states it
   as a prerequisite to any implementation approval.
2. **Whether the questionnaire should follow the engine into three-state.** Section 7a item 4. This
   is a product and UX decision as much as an engine one, and no artifact in the repo answers it.
   Until it is answered, `visibility.ts` stays in scope for any Q1 implementation and the +61/-5
   two-file figure below is a lower bound.
3. **The ruleset alternative's answer-key impact.** Unmeasured here and unmeasured in the earlier
   document. Measuring it requires converting 132 fixture literals first, because `readFieldValue`
   rejects a boolean for an enum field, so every scenario fails validation before any answer key is
   reached. I did not do that work and I do not have a number for it.
4. **Whether attempt B is correct across the gate inventory and across grammars the current ruleset
   does not use.** Two separate gaps, both unmeasured. First, the published `asked_when` grammar is
   conjunction-only, so attempt B's three-valued handling was exercised against conjunctions and
   nothing else; a future ruleset introducing disjunction or negation at the expression level would
   need the same analysis redone. Second, and nearer to hand: no run in this document omits
   `structure_types`, the only multi-enum among the ten gates, so attempt B has never been measured
   with a multi-enum as the blocking gate. Section 3 traces through the source why that path looks
   unsafe (scalar branch candidates meeting `contains` conditions) and records that neither the
   failure nor its absence has been reproduced. Until it is, the 1569/1569 and +61/-5 figures are
   claims about the measured inputs, not about a correct implementation.
5. **Whether any state, migration or fixture in a lane I did not run could reach the unanswered
   state.** I ran the full 1569-test suite against a live database, which covers every suite in the
   repo. I did not audit the seed or demo tooling.
6. **Whether Q2's branch-table presentation is adequate** (sections 3b, 3c and 3d). Three points on
   the path are measured: the questionnaire asks `sapo_event_type` and offers `"unknown"` as "I
   don't know", the engine scopes the four dependents out on that value, and `VerdictDetailPanel`
   renders the four street permits on screen by their published labels. What remains undetermined
   is the judgement, whether a branch table is the right place for them or whether they belong on
   the plan lines as `may_be_required` findings, and that is a product and engine-owner call rather
   than a measurement.
7. **Whether the Q2 path holds together end to end when actually run.** Separate from item 6 and
   settleable by measurement, which item 6 is not. A5 fakes `fetch`, A3 calls `evaluate` directly
   and A4 renders a plan object in isolation, so the API validation, the `events` insert, plan
   generation from the stored row and retrieval back into the page are read from source and not
   exercised (section 3d). Nothing in the source reading suggests they fail; nothing here shows they
   do not.
8. **How `docs/ARCHITECTURE.md:83` and a NULL-as-materially-unknown semantics are to be
   reconciled.** The approved line says unknown-capable active fields use explicit `unknown` values
   and "never NULL-as-unknown"; attempt B derives material unknownness from a raw NULL on
   `obstructs_public_way`, which is one of those fields. Section 7's approvals table carries the
   reconciliation as a §5 prerequisite ahead of the verification and engine-owner signatures. I did
   not resolve it, I do not have a preferred outcome on the record, and nothing here is an
   architecture approval.

## 9. Corrections to `asked-when-three-state-measurement.md`

Recorded so that document's readers can find them. None is a criticism of that document's method;
four of the five are the ruleset moving underneath it.

1. **"20 of 33, and it was 20 at v2.5, v2.6, v2.7 and v2.8"** (its section 1) is right for those
   versions and still right at v2.9, v2.10 and v2.11. Its added claim that it "did not find a
   reading of the registry that gives 19" is too strong: 19 is the count at v2.1, v2.2, v2.3 and
   v2.4, where the total is 32. The issue's error is the pairing, not the 19.
2. **"All 11 gates"** (its sections 1 and 4) is 10 at v2.11. `event_open_to_public` stopped gating
   anything when v2.9 removed `food_affinity_private_exception_claimed`.
3. **Its gated-field table** lists `food_affinity_private_exception_claimed` and
   `venue_has_assembly_approval`, both removed at v2.9, and omits `venue_paco_covers_exact_event` and
   `venue_fdny_pa_permit_current_for_event_space`, both added there.
4. **Its attempt-1 failure profile (15 failures, 10 of them assertion failures) no longer
   reproduces.** At v2.11 attempt A gives 6 failures, all non-termination, no assertion failures. The
   10 assertion failures came from two fixture objects omitting `battery_present`, which answer key
   v4 has since written down. Its "the two fixture lines" remedy is no longer needed.
5. **Its attempt 3 is order-dependent and mishandles `false AND unknown`**, which its own round 8
   records as unmeasured. Both are fixed in attempt B here and both fixes are measured; the suite
   still passes 1569/1569. Its section 7 conclusion that "the answer-key impact and implementation
   size of a correct, order-independent implementation therefore remain unmeasured" is now partly
   measured: zero answer-key movement on the inputs run, and two files at +61/-5 for the engine
   half. Both figures are bounded rather than settled. +61/-5 is a lower bound on size, because
   `visibility.ts` is left out and the divergence that creates is unresolved (section 7a item 4).
   And "a correct implementation" is not what was measured: attempt B is unexercised on a
   multi-enum gate (section 3, section 8 item 4), so that clause of the earlier document's
   conclusion still stands.

---

## Appendix: every input behind every number above

Six artifacts, all generated at `f8d6fc3` and all verified to apply or run there. **None is
applied on this branch and this document recommends applying none of them.** They are published
because the measurements' primary claims are counts, and a count whose input is not published is an
assertion rather than evidence. A1 produces the six-failure profile in section 3, A2 produces the
1569/1569 run in section 3, A3 produces every number in sections 3a and 3b, A4 produces the
rendered text in section 3c, A5 produces the questionnaire table in section 3d, and A6 produces the
nullable-gate result in sections 4 and 7a.

**What none of the six does.** None calls the API, opens a database connection or executes SQL. A3
and A6 call engine functions directly, A4 renders one React component with a plan object handed to
it, and A5 drives the real form with `fetch` replaced. Every claim in this document about what a
stored row holds, or about a value travelling from the questionnaire to a rendered plan, is a source
trace across the files named at that point, not one of these runs. The only measurement here that
touches PostgreSQL is the 1569-test suite itself, which is why the reproduction recipe insists on
a live database for it.

### A1: attempt A, the semantics issue #108's Q1 asks for and nothing else

Applies to a clean `f8d6fc3` on its own (not on top of A2). `pnpm typecheck` is clean; `pnpm test`
with `DATABASE_URL` set reports **1563 passed, 6 failed, 61 files**, and the six are:

| file                  | test                                                                                     |
| --------------------- | ---------------------------------------------------------------------------------------- |
| `acceptance.test.ts`  | Issue #107 named confirmations: keeps the UNKNOWN-capable `obstructs_public_way` field out of named-confirmation provenance |
| `engine.test.ts`      | business-day arithmetic: keeps an uncomputable published window conditional instead of dropping it |
| `engine.test.ts`      | determinism (AC 3): moves with `today`, which is a parameter and never the system clock  |
| `engine.test.ts`      | published bound inclusivity: leaves inclusive bounds alone                               |
| `engine.test.ts`      | typed deadlines: does not call direct filing open once the gated permit's own deadline has passed |
| `engine.test.ts`      | typed deadlines: treats the day inside the Parks floor as missed                         |

All six fail with `RangeError: Maximum call stack size exceeded` and there is not one assertion
failure in the run.

```diff
diff --git a/packages/engine/src/conditions.ts b/packages/engine/src/conditions.ts
index 21a68b8..4d9c32e 100644
--- a/packages/engine/src/conditions.ts
+++ b/packages/engine/src/conditions.ts
@@ -30,7 +30,11 @@ export type TriggerEvaluation = {
   readonly triggeredBy: readonly TriggeredBy[];
 };

-export type ScopeResolver = { isInScope: (field: string) => boolean };
+export type ScopeResolver = {
+  isInScope: (field: string) => boolean;
+  isIndeterminate?: (field: string) => boolean;
+  blockersOf?: (field: string) => readonly string[];
+};

 /**
  * Evaluate the registry's `asked_when` scoping. The published expressions are a closed set of
@@ -178,11 +182,21 @@ export function createScopeResolver(intake: EventIntake, ruleset: EngineRuleset)
   const cache = new Map<string, boolean>();
   const resolving = new Set<string>();

+  const indeterminate = new Map<string, readonly string[]>();
+
   const valueOf = (field: string): IntakeValue => {
     if (!isInScope(field)) return null;
     return intake[field] ?? null;
   };

+  const blockersFor = (clause: AskedWhenClause): readonly string[] => {
+    if (indeterminate.has(clause.field)) return indeterminate.get(clause.field) as readonly string[];
+    if (resolving.has(clause.field)) return [];
+    if (!isInScope(clause.field)) return indeterminate.get(clause.field) ?? [];
+    const raw = intake[clause.field];
+    return raw === undefined || raw === null ? [clause.field] : [];
+  };
+
   const evaluateClause = (clause: AskedWhenClause): boolean => {
     const value = valueOf(clause.field);
     switch (clause.kind) {
@@ -224,6 +238,15 @@ export function createScopeResolver(intake: EventIntake, ruleset: EngineRuleset)

     resolving.add(field);
     try {
+      const blocked = new Set<string>();
+      for (const clause of definition.askedWhenClauses) {
+        for (const blocker of blockersFor(clause)) blocked.add(blocker);
+      }
+      if (blocked.size > 0) {
+        indeterminate.set(field, [...blocked]);
+        cache.set(field, false);
+        return false;
+      }
       const inScope = definition.askedWhenClauses.every(evaluateClause);
       cache.set(field, inScope);
       return inScope;
@@ -232,11 +255,19 @@ export function createScopeResolver(intake: EventIntake, ruleset: EngineRuleset)
     }
   }

-  return { isInScope };
+  return {
+    isInScope,
+    isIndeterminate: (field: string) => indeterminate.has(field),
+    blockersOf: (field: string) => indeterminate.get(field) ?? [],
+  };
 }

 function resolveAnswer(field: string, intake: EventIntake, scope: ScopeResolver): ResolvedAnswer {
-  if (!scope.isInScope(field)) return { state: "not_asked" };
+  if (!scope.isInScope(field)) {
+    if (scope.isIndeterminate?.(field) === true)
+      return { state: "unknown", isExplicitUnknown: false };
+    return { state: "not_asked" };
+  }
   const value = intake[field];
   if (value === undefined || value === null) return { state: "unknown", isExplicitUnknown: false };
   if (value === UNKNOWN_ANSWER) return { state: "unknown", isExplicitUnknown: true };
```

`blockersFor` is where Q2 falls outside this measurement: a raw value that is neither `undefined`
nor `null` produces no blocker, so a gate answered `"unknown"` is unaffected by A1 and by A2 alike.

### A2: attempt B, attempt A plus the three corrections

Applies to a clean `f8d6fc3` (not on top of A1). `pnpm typecheck` is clean; `pnpm test` with
`DATABASE_URL` set reports **1569 passed, 0 failed, 61 files**.

```diff
diff --git a/packages/engine/src/conditions.ts b/packages/engine/src/conditions.ts
index 21a68b8..e668bb8 100644
--- a/packages/engine/src/conditions.ts
+++ b/packages/engine/src/conditions.ts
@@ -30,7 +30,11 @@ export type TriggerEvaluation = {
   readonly triggeredBy: readonly TriggeredBy[];
 };

-export type ScopeResolver = { isInScope: (field: string) => boolean };
+export type ScopeResolver = {
+  isInScope: (field: string) => boolean;
+  isIndeterminate?: (field: string) => boolean;
+  blockersOf?: (field: string) => readonly string[];
+};

 /**
  * Evaluate the registry's `asked_when` scoping. The published expressions are a closed set of
@@ -178,11 +182,21 @@ export function createScopeResolver(intake: EventIntake, ruleset: EngineRuleset)
   const cache = new Map<string, boolean>();
   const resolving = new Set<string>();

+  const indeterminate = new Map<string, readonly string[]>();
+
   const valueOf = (field: string): IntakeValue => {
     if (!isInScope(field)) return null;
     return intake[field] ?? null;
   };

+  const blockersFor = (clause: AskedWhenClause): readonly string[] => {
+    if (indeterminate.has(clause.field)) return indeterminate.get(clause.field) as readonly string[];
+    if (resolving.has(clause.field)) return [];
+    if (!isInScope(clause.field)) return indeterminate.get(clause.field) ?? [];
+    const raw = intake[clause.field];
+    return raw === undefined || raw === null ? [clause.field] : [];
+  };
+
   const evaluateClause = (clause: AskedWhenClause): boolean => {
     const value = valueOf(clause.field);
     switch (clause.kind) {
@@ -224,6 +238,25 @@ export function createScopeResolver(intake: EventIntake, ruleset: EngineRuleset)

     resolving.add(field);
     try {
+      // Three-valued conjunction: a conjunct that is decisively false settles the expression, so
+      // a blocked sibling is not material.
+      const blocked = new Set<string>();
+      let decisivelyFalse = false;
+      for (const clause of definition.askedWhenClauses) {
+        const clauseBlockers = blockersFor(clause);
+        if (clauseBlockers.length > 0) for (const b of clauseBlockers) blocked.add(b);
+        else if (!evaluateClause(clause)) decisivelyFalse = true;
+      }
+      if (decisivelyFalse) {
+        cache.set(field, false);
+        return false;
+      }
+      const blockers = [...blocked];
+      if (blockers.length > 0) {
+        indeterminate.set(field, blockers);
+        cache.set(field, false);
+        return false;
+      }
       const inScope = definition.askedWhenClauses.every(evaluateClause);
       cache.set(field, inScope);
       return inScope;
@@ -232,11 +265,27 @@ export function createScopeResolver(intake: EventIntake, ruleset: EngineRuleset)
     }
   }

-  return { isInScope };
+  const settle = (field: string): void => {
+    if (!resolving.has(field)) isInScope(field);
+  };
+  return {
+    isInScope,
+    isIndeterminate: (field: string) => {
+      settle(field);
+      return indeterminate.has(field);
+    },
+    blockersOf: (field: string) => {
+      settle(field);
+      return indeterminate.get(field) ?? [];
+    },
+  };
 }

 function resolveAnswer(field: string, intake: EventIntake, scope: ScopeResolver): ResolvedAnswer {
-  if (!scope.isInScope(field)) return { state: "not_asked" };
+  if (!scope.isInScope(field)) {
+    if (scope.isIndeterminate?.(field)) return { state: "unknown", isExplicitUnknown: false };
+    return { state: "not_asked" };
+  }
   const value = intake[field];
   if (value === undefined || value === null) return { state: "unknown", isExplicitUnknown: false };
   if (value === UNKNOWN_ANSWER) return { state: "unknown", isExplicitUnknown: true };
diff --git a/packages/engine/src/verdict.ts b/packages/engine/src/verdict.ts
index 14e12f2..a2ca1a8 100644
--- a/packages/engine/src/verdict.ts
+++ b/packages/engine/src/verdict.ts
@@ -7,7 +7,7 @@ import {
   MISSED_MAY_BE_REQUIRED_IS_CONDITIONAL,
   RESCOPE_EXCLUDES_UNKNOWN_VALUES,
 } from "./proposals";
-import { UNKNOWN_ANSWER } from "./conditions";
+import { UNKNOWN_ANSWER, createScopeResolver } from "./conditions";
 import { triggerFields } from "./ruleset";
 import type {
   EngineRuleset,
@@ -270,9 +270,16 @@ function evaluateConditional(
       reason: finding.timelineUnresolvedReason as string,
     }));

+  const scopeForBranching = createScopeResolver(intake, ruleset);
+  const branchable = new Set<string>();
+  for (const field of resolved.unknownFields) {
+    const blockers = scopeForBranching.blockersOf?.(field) ?? [];
+    if (blockers.length === 0) branchable.add(field);
+    else for (const blocker of blockers) branchable.add(blocker);
+  }
   const unknownFields = ruleset.intakeFields
     .map((definition) => definition.field)
-    .filter((field) => resolved.unknownFields.includes(field));
+    .filter((field) => branchable.has(field));

   const missingFacts: MissingFact[] = [];
   const pathVerdicts: Verdict[] = [];
```

### A3: the plan-diff probe harness and its four complete intakes

Written to `packages/engine/src/probe.test.ts`, run with
`npx vitest run packages/engine/src/probe.test.ts`, and deleted afterwards. It is a probe, not a
fixture: nothing on this branch adds it, and it asserts nothing. It prints, and the printed output
is what sections 3a and 3b report. Run it once on a clean `f8d6fc3` for the "today" column and once
with A2 applied for the "attempt B" column. `CASE_1` and `CASE_2` are not submittable through the
API (`validate.ts` raises `required` for a blank non-nullable gate in scope, which is section 4's
finding); the probe calls `evaluate` directly, which is the only way to reach the Q1 state at all.
`CASE_0` and `CASE_3` are submittable.

```ts
import { readFileSync } from "node:fs";
import { describe, it } from "vitest";
import { PUBLISHED_RULES_FILE } from "./__fixtures__/published-ruleset";
import { evaluate, parseEngineRuleset } from "./index";
import type { EventIntake, PublishedHolidayCalendar } from "./types";

const TODAY = "2026-07-22";
const raw: Record<string, unknown> = JSON.parse(readFileSync(PUBLISHED_RULES_FILE, "utf8"));
const ruleset = parseEngineRuleset(raw);
const calendar: PublishedHolidayCalendar = { id: ruleset.calendarId, holidays: [] };

const CASE_1: EventIntake = {
  name: "Probe case 1",
  borough: "manhattan",
  location_type: "street",
  headcount: 200,
  event_date: "2026-09-30",
  event_open_to_public: "yes",
  food_present: false,
  selling_anything: false,
  amplified_sound: false,
  structure_types: ["none"],
  open_flame_or_cooking: ["none"],
  generator_present: false,
  battery_present: false,
  alcohol: false,
};

const CASE_2: EventIntake = {
  name: "Probe case 2",
  borough: "manhattan",
  location_type: "park",
  headcount: 150,
  event_date: "2026-09-30",
  event_open_to_public: "yes",
  food_present: false,
  selling_anything: false,
  amplified_sound: false,
  structure_types: ["none"],
  open_flame_or_cooking: ["none"],
  generator_present: true,
  generator_gasoline_gallons: 1,
  generator_diesel_gallons: 0,
  generator_kw: 5,
  alcohol: false,
};

const CASE_0: EventIntake = { ...CASE_1, obstructs_public_way: "no" };

const CASE_3: EventIntake = { ...CASE_1, obstructs_public_way: "yes", sapo_event_type: "unknown" };

function show(label: string, intake: EventIntake): void {
  const plan = evaluate(intake, ruleset, TODAY, calendar);
  const p = plan as unknown as Record<string, unknown>;
  const detail = p.verdictDetail as Record<string, unknown>;
  const findings = p.findings as Array<Record<string, unknown>>;
  console.log(`\n===== ${label} =====`);
  console.log("verdict:", p.verdict, "| findings:", findings.length);
  console.log(
    "  " + findings.map((f) => `${JSON.stringify(f.ruleIds)}:${String(f.disposition)}`).join("\n  "),
  );
  console.log("missingFacts:", JSON.stringify(detail.missingFacts));
}

describe("probe", () => {
  it("runs", () => {
    show("CASE 0 street, obstructs_public_way ANSWERED no", CASE_0);
    show("CASE 1 street, obstructs_public_way UNANSWERED", CASE_1);
    show("CASE 2 park + generator, battery_present ABSENT", CASE_2);
    show("CASE 3 street, obstructs=yes, sapo_event_type ANSWERED unknown", CASE_3);
  });
});
```

**The four results, as printed.**

| case                                                          | today                                        | with A2                                      |
| ------------------------------------------------------------- | -------------------------------------------- | -------------------------------------------- |
| `CASE_0` street, `obstructs_public_way: "no"`                 | FEASIBLE, 9 findings, `missingFacts: []`     | identical                                    |
| `CASE_1` street, `obstructs_public_way` absent                | CONDITIONAL, 9 findings, 1 missing fact      | CONDITIONAL, 20 findings, 1 missing fact     |
| `CASE_2` park + generator, `battery_present` absent           | CONDITIONAL, 9 findings, no `FDNY-GENERATOR-001` | CONDITIONAL, 10 findings, `FDNY-GENERATOR-001` `may_be_required` |
| `CASE_3` street, `sapo_event_type: "unknown"`                 | CONDITIONAL, 13 findings, 1 missing fact     | **identical**, A2 does not reach Q2         |

### A4: the Q2 render probe, and the panel it renders through

Written to `apps/web/app/plan/render-probe.test.tsx`, run with
`npx vitest run apps/web/app/plan/render-probe.test.tsx` on a clean `f8d6fc3`, and deleted
afterwards. Nothing on this branch adds it and it asserts nothing; it evaluates `CASE_3` and prints
what `VerdictDetailPanel` renders from the result. Section 3c's tables are that printed output.
`CASE_3` here is the same intake as in A3, restated locally so the probe is self-contained.

```tsx
// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it } from "vitest";
import { render } from "@testing-library/react";
import { evaluate, parseEngineRuleset } from "@pop-engine/engine";
import type { EventIntake, PublishedHolidayCalendar } from "@pop-engine/engine";
import { publishedRulesFileIn } from "../rules-file";
import { VerdictDetailPanel } from "./verdict-detail";

const TODAY = "2026-07-22";
const rawText = readFileSync(resolve(publishedRulesFileIn("rules")), "utf8");
const raw: Record<string, unknown> = JSON.parse(rawText);
const publishedRuleset = raw as unknown as {
  ruleset_version: string;
  rules: PublishedRuleShape[];
  advisories: PublishedRuleShape[];
};
type PublishedRuleShape = {
  id: string;
  output: {
    user_summary?: { heading: string; points: { sources: { label: string; url: string }[] }[] };
    portal?: { name?: string; url?: string | null };
  };
};
const ruleset = parseEngineRuleset(raw);
const calendar: PublishedHolidayCalendar = { id: ruleset.calendarId, holidays: [] };

// Built exactly as `plan-view.test.tsx` builds them, so the panel humanises rule codes on this
// probe the same way it does on the page.
const rulesetReferences = [...publishedRuleset.rules, ...publishedRuleset.advisories].flatMap(
  (rule) => {
    if (rule.output.user_summary === undefined) return [];
    return [
      {
        ruleIds: [rule.id],
        label: rule.output.user_summary.heading,
        source: rule.output.user_summary.points.flatMap((point) => point.sources)[0] ?? null,
        portalName: rule.output.portal?.name ?? null,
        portalUrl: rule.output.portal?.url ?? null,
      },
    ];
  },
);

const CASE_1: EventIntake = {
  name: "Probe case 1",
  borough: "manhattan",
  location_type: "street",
  headcount: 200,
  event_date: "2026-09-30",
  event_open_to_public: "yes",
  food_present: false,
  selling_anything: false,
  amplified_sound: false,
  structure_types: ["none"],
  open_flame_or_cooking: ["none"],
  generator_present: false,
  battery_present: false,
  alcohol: false,
};

const CASE_3: EventIntake = { ...CASE_1, obstructs_public_way: "yes", sapo_event_type: "unknown" };

describe("render probe", () => {
  it("renders CASE_3 through VerdictDetailPanel", () => {
    const plan = evaluate(CASE_3, ruleset, TODAY, calendar);
    const p = plan as unknown as Record<string, never>;
    console.log("verdict:", plan.verdict, "findings:", plan.findings.length);
    console.log("verdictDetail:", JSON.stringify(plan.verdictDetail, null, 2));
    const { container } = render(
      <VerdictDetailPanel
        verdict={plan.verdict}
        detail={p.verdictDetail}
        findings={p.findings}
        rulesetReferences={rulesetReferences}
      />,
    );
    console.log("===== RENDERED TEXT =====");
    console.log(container.textContent);
    console.log("===== ROWS =====");
    for (const row of Array.from(container.querySelectorAll("tbody tr"))) {
      console.log(
        Array.from(row.querySelectorAll("td"))
          .map((cell) => cell.textContent)
          .join(" | "),
      );
    }
    console.log("===== HEADINGS =====");
    for (const h of Array.from(container.querySelectorAll("h2,h3"))) console.log(h.textContent);
  });
});
```

**The engine input the panel rendered, as printed:** verdict `CONDITIONAL`, 13 findings,
`minSlackDays: 10`, one missing fact (`sapo_event_type`, `thresholds: null`, four branches whose
reasons are quoted verbatim in section 3c's second table), and one unresolved timeline
(`SAPO-PLAZA-001`, "the plan was never asked plaza_level, which this deadline keys on"). No blocking
finding, no missed rule ids, no rescope suggestions.

### A5: the questionnaire probe, and the form it drives

Written to `apps/web/app/intake/questionnaire-probe.test.tsx`, run with
`npx vitest run apps/web/app/intake/questionnaire-probe.test.tsx` on a clean `f8d6fc3`, and deleted
afterwards. Nothing on this branch adds it and it asserts nothing; it enters `CASE_3`'s answers
through the shipped `IntakeForm` and prints what is on screen and what is submitted. Section 3d's
table is that printed output. The contract is parsed from `rules/nyc-rules.v2.11.json`, and only
`fetch` and `next/navigation` are faked, exactly as `apps/web/app/intake/intake-form.test.tsx`
fakes them.

```tsx
// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { parseIntakeContract } from "@pop-engine/engine";
import { publishedRulesFileIn } from "../rules-file";
import { IntakeForm } from "./intake-form";

const router = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));

const contract = parseIntakeContract(
  JSON.parse(readFileSync(resolve(publishedRulesFileIn("rules")), "utf8")),
);

const jsonResponse = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const echoSavedEvent = (status: number, init: RequestInit): Response =>
  jsonResponse(status, {
    event: { id: "event-1", revision_counter: 1, ...JSON.parse(String(init.body)) },
    warnings: [],
    plan_stale: false,
  });

const chooseOption = async (
  user: ReturnType<typeof userEvent.setup>,
  field: string,
  value: string,
) => {
  const option = document.querySelector<HTMLInputElement>(
    `input[name="${field}"][value="${value}"]`,
  );
  if (option === null) throw new Error(`no option ${field}=${value} on screen`);
  await user.click(option);
};

const fillField = async (
  user: ReturnType<typeof userEvent.setup>,
  field: string,
  value: string,
) => {
  const input = document.querySelector<HTMLInputElement>(`input[name="${field}"]`);
  if (input === null) throw new Error(`no input ${field} on screen`);
  await user.clear(input);
  await user.type(input, value);
};

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  router.push.mockReset();
  fetchMock = vi.fn(async (_url: string, init: RequestInit) => echoSavedEvent(201, init));
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("questionnaire probe", () => {
  it("walks CASE_3's answers through the shipped form", async () => {
    const user = userEvent.setup();
    render(
      <IntakeForm contract={contract} apiBaseUrl="https://api.example.com" eventId={undefined} />,
    );

    await fillField(user, "name", "Probe case 3");
    await chooseOption(user, "borough", "manhattan");
    await chooseOption(user, "location_type", "street");
    await fillField(user, "headcount", "200");
    await fillField(user, "event_date", "2026-09-30");
    await chooseOption(user, "event_open_to_public", "yes");
    await chooseOption(user, "food_present", "false");
    await chooseOption(user, "selling_anything", "false");
    await chooseOption(user, "amplified_sound", "false");
    await chooseOption(user, "structure_types", "none");
    await chooseOption(user, "open_flame_or_cooking", "none");
    await chooseOption(user, "generator_present", "false");
    await chooseOption(user, "battery_present", "false");
    await chooseOption(user, "alcohol", "false");

    console.log("=== after location_type=street, before obstructs answer ===");
    console.log(
      "sapo_event_type on screen:",
      document.querySelector('input[name="sapo_event_type"]') !== null,
    );

    await chooseOption(user, "obstructs_public_way", "yes");

    console.log("=== after obstructs_public_way=yes ===");
    const group = screen.queryByRole("group", { name: /Sapo event type/i });
    console.log("sapo_event_type question present:", group !== null);
    if (group !== null) {
      console.log("legend:", group.querySelector("legend")?.textContent);
      console.log(
        "options:",
        JSON.stringify(
          Array.from(group.querySelectorAll<HTMLInputElement>("input")).map((input) => ({
            value: input.value,
            label: input.parentElement?.textContent,
          })),
        ),
      );
      console.log("help text:", group.textContent);
    }
    console.log("lede:", document.querySelector(".intake__lede")?.textContent);

    await chooseOption(user, "sapo_event_type", "unknown");
    console.log(
      "'I don't know' present in group:",
      group !== null && within(group).queryByText("I don't know") !== null,
    );

    await user.click(screen.getByRole("button", { name: /^Save/ }));
    await waitFor(() => {
      if (fetchMock.mock.calls.length === 0) throw new Error("no submit yet");
    });
    const body = JSON.parse(String((fetchMock.mock.calls[0]?.[1] as RequestInit).body));
    console.log("=== submitted body ===");
    console.log(JSON.stringify(body, null, 2));
    console.log("dependents present in submission:", {
      street_event_size: "street_event_size" in body,
      plaza_level: "plaza_level" in body,
      plaza_multiple_blocks: "plaza_multiple_blocks" in body,
      has_amusement_ride: "has_amusement_ride" in body,
    });
  });
});
```

**What it printed:** before `obstructs_public_way` is answered, `sapo_event_type` is not on screen;
after answering `yes`, the question renders with options
`street_event`/`block_party`/`plaza_event`/`other_sapo_class`/`unknown` labelled "Street event",
"Block party", "Plaza event", "Other sapo class", "I don't know"; and the submitted body carries
`sapo_event_type: "unknown"` with the four dependents present as explicit `null`.

### A6: the nullable-gate probe

Written to `packages/engine/src/intake/nullable-probe.test.ts`, run with
`npx vitest run packages/engine/src/intake/nullable-probe.test.ts` on a clean `f8d6fc3`, and deleted
afterwards. Nothing on this branch adds it and it asserts nothing. It submits an event whose
`structure_types` includes `tent_canopy`, which puts the registry-nullable `tent_area_sqft` in
scope, and leaves that field unanswered.

```ts
import { readFileSync } from "node:fs";
import { describe, it } from "vitest";
import { PUBLISHED_RULES_FILE } from "../__fixtures__/published-ruleset";
import { parseIntakeContract } from "./registry";
import { validateIntake } from "./validate";

const raw: Record<string, unknown> = JSON.parse(readFileSync(PUBLISHED_RULES_FILE, "utf8"));
const contract = parseIntakeContract(raw);

const TENT_EVENT: Record<string, unknown> = {
  name: "Nullable probe",
  borough: "manhattan",
  location_type: "park",
  headcount: 150,
  event_date: "2026-09-30",
  event_open_to_public: "yes",
  food_present: false,
  selling_anything: false,
  amplified_sound: false,
  structure_types: ["tent_canopy"],
  structure_over_10ft_tall: "no",
  open_flame_or_cooking: ["none"],
  generator_present: false,
  battery_present: false,
  alcohol: false,
};

describe("nullable probe", () => {
  it("submits an in-scope registry-nullable field with no answer", () => {
    const result = validateIntake(contract, TENT_EVENT, "2026-07-22");
    console.log("errors:", JSON.stringify(result.errors));
    console.log(
      "tent_area_sqft in stored answers:",
      Object.prototype.hasOwnProperty.call(result.values ?? {}, "tent_area_sqft"),
      "| value:",
      JSON.stringify((result.values ?? {}).tent_area_sqft),
    );
    console.log("full result keys:", Object.keys(result));
  });
});
```

**What it printed:** `errors: []`, and `tent_area_sqft` present among `result.values` with the value
`null`.

**What that does and does not show.** It shows one thing: `validateIntake` accepts an in-scope
registry-nullable field left unanswered and puts it into the record it returns as `null`. The probe
calls `validateIntake` and prints `result.values`; it does not call the events router, open a
database connection or execute an INSERT, so it does not by itself show what a row holds.
`events.ts:145` builds the column list from `intakeColumnNames(intakeContract)` and `:154` passes
`values[column] ?? null` for every column, so the `null` in `result.values` reaches the INSERT
unchanged, and `events.tent_area_sqft` is a nullable `integer`
(`apps/api/migrations/001_initial_schema.ts:85`). That chain is a **source trace**, not a reproduced
measurement, and sections 4 and 7a state it that way: what is measured is validation acceptance,
what is inferred is the stored NULL. Either way the reason the Q1 state is unreachable today is
that no gate field is `nullable`, which this probe does not bear on at all.
