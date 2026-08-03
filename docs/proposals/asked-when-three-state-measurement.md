# Measuring the three-state `asked_when` change (issue #108)

**Status:** PROPOSED

This document is a MEASUREMENT and proposes no change. It recommends no option, and the branch
carrying it contains no engine, spec, fixture, schema or manifest change. Issue #108 asks a
semantics question and says fixture impact needs measuring before it can be decided; this is that
measurement, and the decision is the product owner's. The status above is the governance §3 state,
which is about whether an artifact may be implemented, and there is nothing here to implement.

**Measurement basis.** Every number in this document was re-measured for round 5 on ONE tree:
merge-base `481e1f6` with `origin/main`, ruleset `nyc-rules.v2.8.json`, Node v24.18.0, PostgreSQL
16, suite size **1163**. The throwaway implementation described in section 2 is reverted before
publication; this branch contains no engine change.

**How to reproduce.** The provenance line has now been wrong or stale in three consecutive rounds,
so the recipe is written down rather than implied:

1. `git checkout 481e1f6` and `pnpm install --frozen-lockfile`.
2. `pnpm --filter api migrate up` against an empty database. Omitting this produces a large false
   failure count; the api suites are skipped without `DATABASE_URL` and fail against a stale schema.
3. Apply one attempt from the appendix, which carries all three patches verbatim. Each was
   generated at `481e1f6` and each is verified to apply cleanly there with `git apply --check`.
   Attempts 1 and 2 differ only in the body of the `!isInScope` branch of `resolveAnswer`; attempt 3
   is attempt 1 plus the `verdict.ts` branching change.
4. `pnpm vitest run` for the whole suite, and note that the fixture column in section 2's table
   depends on whether `battery_present: false` has been added to the two fixture objects named
   there.

If a future reader gets a different number, the tree or step 2 is the first thing to check.

**What has NOT been re-measured**, stated so nobody assumes otherwise: the answer-key impact of an
order-independent implementation of issue #108's semantics, and the answer-key impact of the
ruleset alternative in section 6. Attempt 3's existing-order result is not evidence for the first,
for the reason measured later in section 2.

---

## 1. How many fields are affected

**20 of 33, not 19.** The issue undercounts by one. This is not drift: the count was 20 at v2.5
when the issue was written, and at v2.6, v2.7 and v2.8. I did not find a reading of the registry
that gives 19.

The 20 gated fields, with the gate they depend on:

| Field                                     | Gate expression                                      |
| ----------------------------------------- | ---------------------------------------------------- |
| `obstructs_public_way`                    | `location_type in street/sidewalk/plaza`             |
| `sapo_event_type`                         | `obstructs_public_way != no`                         |
| `street_event_size`                       | `sapo_event_type = street_event`                     |
| `plaza_level`                             | `sapo_event_type = plaza_event`                      |
| `plaza_multiple_blocks`                   | `sapo_event_type = plaza_event`                      |
| `has_amusement_ride`                      | `sapo_event_type = block_party`                      |
| `food_vendor_count`                       | `food_present`                                       |
| `food_affinity_private_exception_claimed` | `food_present AND event_open_to_public != yes`       |
| `sound_audible_from_public_way`           | `amplified_sound AND location_type = private_venue`  |
| `tent_area_sqft`                          | `tent_canopy`                                        |
| `tent_days_in_place`                      | `tent_canopy`                                        |
| `stage_height_ft`                         | `stage_platform_scaffold`                            |
| `stage_area_sqft`                         | `stage_platform_scaffold`                            |
| `structure_over_10ft_tall`                | `structure_types != none`                            |
| `generator_gasoline_gallons`              | `generator_present`                                  |
| `generator_diesel_gallons`                | `generator_present`                                  |
| `generator_kw`                            | `generator_present`                                  |
| `battery_system_kwh`                      | `battery_present`                                    |
| `venue_license_covers_event_area`         | `alcohol AND location_type = private_venue`          |
| `venue_has_assembly_approval`             | `location_type = private_venue AND headcount gte 75` |

The other 13 are ungated roots: `borough`, `location_type`, `headcount`, `event_date`,
`event_open_to_public`, `food_present`, `selling_anything`, `amplified_sound`, `structure_types`,
`open_flame_or_cooking`, `generator_present`, `battery_present`, `alcohol`.

**The number that matters more is 11**, the fields that act _as_ a gate, because only those can
supply the "unanswered" state the change is about: `alcohol`, `amplified_sound`, `battery_present`,
`event_open_to_public`, `food_present`, `generator_present`, `headcount`, `location_type`,
`obstructs_public_way`, `sapo_event_type`, `structure_types`.

**All 11 are `nullable: false` IN THE REGISTRY.** The 8 registry-nullable fields are all leaf
quantities (`tent_area_sqft`, `tent_days_in_place`, `stage_height_ft`, `stage_area_sqft`,
`generator_gasoline_gallons`, `generator_diesel_gallons`, `generator_kw`, `battery_system_kwh`) and
none of them gates anything.

**The schema does not agree, and the first version of this document said "non-nullable" without
saying which.** That was wrong to write and it was read as a schema fact. Checked against a live
database after `migrate up`, not by reading migrations:

| Gate field                 | registry `nullable` | schema       |
| -------------------------- | ------------------- | ------------ |
| `alcohol`                  | false               | NOT NULL     |
| `amplified_sound`          | false               | NOT NULL     |
| `event_open_to_public`     | false               | NOT NULL     |
| `food_present`             | false               | NOT NULL     |
| `generator_present`        | false               | NOT NULL     |
| `headcount`                | false               | NOT NULL     |
| `location_type`            | false               | NOT NULL     |
| `structure_types`          | false               | NOT NULL     |
| **`battery_present`**      | false               | **nullable** |
| **`obstructs_public_way`** | false               | **nullable** |
| **`sapo_event_type`**      | false               | **nullable** |

So eight of the eleven are NOT NULL in the schema and **three are nullable**. Two of the thirteen
tokens that appear in `asked_when` expressions, `tent_canopy` and `stage_platform_scaffold`, are
_values_ of `structure_types` rather than fields, which is why the field count is 11 and not 13;
all 11 fields are columns.

The two nullable SAPO gates are nullable because they are themselves gated and are legitimately
NULL for a park. `battery_present` is nullable for the reason migration 006 records: test helpers
insert events with partial column lists, and a NOT NULL constraint would be enforcing a rule those
callers do not follow.

**Which claim does the work.** The registry claim is the one that makes the unanswered state
unreachable through the API, because `validateIntake` reads `nullable` from the registry and
requires every asked field that omits it. The schema claim is separate, and where this document
needs it, it is stated as a schema claim.

**Three gates already express "unknown" as a real answer.** `obstructs_public_way`,
`sapo_event_type` and `event_open_to_public` publish `unknown` in their `values`. For those, an
organizer who says so is handled correctly today: `obstructs_public_way = unknown` satisfies
`!= no`, so `sapo_event_type` is asked rather than scoped out.

**That does NOT confine the gap to the other eight, and rounds 1 to 4 said it did.** A published
`unknown` only helps a row that actually STORES it. An in-scope NULL, or an answer that is simply
missing, is a different state and the two-state `asked_when` collapses it exactly as it does for a
boolean. This document contradicts itself on the point: section 4's chained-gate table shows a NULL
`obstructs_public_way` scoping `sapo_event_type` out under today's semantics, and
`obstructs_public_way` is one of the three gates that declares `unknown`. Route 5 in section 3 is
the same fact again.

So the three-state change reaches **all 11 gates**, not the 8 whose type cannot carry an explicit
unknown. What the declared `unknown` value buys is a way for an organizer to SAY they do not know;
what it does not buy is any handling of nobody having been asked. The two are different states and
only the second is what issue #108 is about.

## 2. Which fixtures move

I implemented the change on a throwaway commit, ran everything, and reverted it. The branch carries
no behaviour change.

**First attempt** (a gate that is in scope and unanswered makes its dependents indeterminate;
indeterminate resolves to `unknown` rather than `not_asked`):

| Suite                                                                             | Result            |
| --------------------------------------------------------------------------------- | ----------------- |
| `packages/engine/src/acceptance.test.ts` (answer key, scenarios A-F + boundaries) | **39/39 pass**    |
| `packages/engine/src/fixture-ruleset-agreement.test.ts`                           | 92/92 pass        |
| `packages/engine/src/intake/intake.test.ts`                                       | 76/76 pass        |
| `packages/engine/src/engine.test.ts`                                              | **11 of 74 fail** |
| `apps/api/src/plan.test.ts`                                                       | **4 of 21 fail**  |
| everything else                                                                   | pass              |

15 failures out of ~1000. Of the 15: 5 verdict flips toward `CONDITIONAL`, 1 extra `triggeredBy`
contribution, 4 plan-item count changes, and 5 `RangeError: Maximum call stack size exceeded`.

**The added finding is `FDNY-GENERATOR-001`** on a plan fixture that expects five findings and got
six. That is the same rule as the issue's worked example, and it is the only rule in the ruleset
whose trigger references `battery_system_kwh`.

**Then I traced the cause.** Every one of the 10 non-crash failures came from one thing: the
fixture objects in `engine.test.ts` (`parkIntake`) and `plan.test.ts` (`scenarioAEvent`) set
`generator_present: false` and `battery_system_kwh: 0` but **omit `battery_present`**, the field
v2.5 added.

**Two different fixture mechanisms, and the first version of this document ran them together.**
They are separated here because section 3 uses this provenance to argue about production
reachability, and a fixture shape is not evidence of a production route:

- The **4 `plan.test.ts` failures** come from SQL. `insertEvent` builds its column list from
  `Object.keys(row)`, so the omitted field is never named in the INSERT and the column is NULL in
  a real row. This is what migration 006's comment means by "test helpers insert events with
  partial column lists".
- The **11 `engine.test.ts` failures** never touch a database. `parkIntake` is an in-memory object
  passed straight to `evaluate`, so the field is simply absent from a JavaScript record. No row, no
  column, no NULL.

Neither is a production route. The first is a route the API does not use, since `events.ts` names
every registry column on every insert and update. The second is not a storage state at all.
Adding `battery_present: false` to those two fixture objects, one line each, cleared all 4
`plan.test.ts` failures and 6 of the 11 `engine.test.ts` failures.

**The residual 5 were all the stack overflow, and it is not a fixture artefact.**
`verdict.ts:evaluateConditional` resolves unknowns by substituting each candidate value and
recursing. It terminates today because every branch removes an unknown. Under the first attempt it
did not, because a field that is unknown _for want of its gate's answer_ is not resolved by
supplying that field's own value, so the resolver branched on a field it could not settle and the
unknown set stopped shrinking.

**Second attempt**, and rounds 1 and 2 of this document reported its result as the headline. It
added a rule that an indeterminate field whose own value _is_ present counts as answered. That
terminates and passes 1163/1163, **but it is a different and narrower change than issue #108 asks
for**, because under it the three states only diverge when the gate _and_ the dependent are both
unanswered. Reporting its number as "the answer key does not move" was measuring one thing and
quoting it about another, and the number was relayed to the product owner and to an external
reviewer on that basis.

**Third attempt, round 3: target #108's semantics and fix the immediate recursion.** The dependent
resolves unknown whatever its own stored value is, which is the requested behaviour for a
single-level gate. The non-termination was in `evaluateConditional` branching on a field it could
not settle. A dependent that is unknown _for want of its gate's answer_ is not resolved by
supplying the dependent's value, so that branch never shrank the unknown set. **Branching on the
blocking GATE does shrink that case**, because every branch answers a gate and there are finitely
many gates. It does not make the scope resolver order-independent or implement three-valued
conjunction; the cold-resolver measurements below disprove both stronger claims.

With that, plus the two fixture lines, under the rules' existing evaluation order:

> **Full suite: 1163/1163 pass for attempt 3 in the existing evaluation order.**

The result proves that the patch has an effect on the one-level battery case: with
`battery_present` absent, `FDNY-GENERATOR-001` lists where it previously did not; with
`battery_present: false` it does not list. It does **not** prove that issue #108's transitive
semantics leave the answer key unchanged. The cold-resolver probe below makes attempt 3
order-dependent and suppresses a deeper SAPO branch.

The measured throwaway diff for attempt 3 is **two files**:
`packages/engine/src/conditions.ts` (+33/-3) and
`packages/engine/src/verdict.ts` (+9/-2), plus the two fixture lines. Earlier rounds published
+47/-3 and +18/-2, which did not match the appendix patch. **The counts were stale, not the patch
incomplete**, and the difference matters for the reproducibility claim so it is stated rather than
quietly corrected: the appendix patch applies cleanly to this tree and the engine typechecks with it
applied, so nothing is missing from it, and `git apply --numstat` on it gives the figures above. `visibility.ts` needed no
change at all (see the note under 4).

**Two caveats on that number, because it is the one likely to be quoted.**

1. **`verdict.ts` is not optional.** The issue's "Scope if changed" list names `visibility.ts` and
   `conditions.ts`; the branching change belongs on it too, and without it the plan generator does
   not terminate. That is the finding rounds 1 and 2 buried by working around it in the semantics
   instead.
2. The suite passing is evidence about the fixtures, not about production rows. Every failure the
   change produced came from a state that, as measured in section 3, the API cannot create.

**Failure counts across the three attempts.** All six cells re-measured for round 5 on the one tree
named at the top, back to back, 1163 tests each:

| Attempt | Semantics                     | Branching   | Fixtures unedited | After 2 fixture lines | Non-termination |
| ------- | ----------------------------- | ----------- | ----------------- | --------------------- | --------------- |
| 1       | as #108 asks                  | original    | 15 fail           | 5 fail                | 5 fixtures      |
| 2       | narrower                      | original    | **0 fail**        | 0 fail                | none            |
| 3       | targets #108; order-dependent | on the gate | 6 fail            | **0 fail**            | none            |

**Attempt 2's first cell was wrong in rounds 3 and 4**, which reported 15 there. It is 0: under the
narrower rule a dependent that HAS a stored value counts as answered, and both fixture objects store
`battery_system_kwh: 0`, so the fixture gap those two lines close never bites. The 15 was carried
across from attempt 1 rather than measured. That is the fourth distinct defect found in this table,
and it is why round 5 re-ran every cell instead of the changed ones.

**ATTEMPT 3 DOES NOT IMPLEMENT THE TRANSITIVE SEMANTICS THIS DOCUMENT CLAIMS FOR IT, and the
numbers in the table above therefore describe something narrower than the semantics named in the
heading.** Measured on this tree with the appendix patch applied, on a street event whose
`obstructs_public_way` is unanswered, so `sapo_event_type` is indeterminate and `street_event_size`
depends on it:

| what is asked first               | `street_event_size` in scope | indeterminate | blockers               |
| --------------------------------- | ---------------------------- | ------------- | ---------------------- |
| the dependent, on a cold resolver | false                        | **false**     | **none**               |
| the parent, then the dependent    | false                        | true          | `obstructs_public_way` |

The cause is in `blockersFor`: it returns early on `!isInScope(clause.field)` WITHOUT re-reading
`indeterminate`, and that very call is what records the parent as indeterminate. So on a cold
resolver the parent's blockers exist by the time the line returns and are not read; the dependent is
cached out of scope with no indeterminacy recorded, and the SAPO size requirements behind it are
suppressed silently. Ask the parent first and the same tree reports correctly, because the early
`indeterminate.has` check then finds what the previous call stored.

**So attempt 3's result is order-dependent**, and the measured 6 describes the order the rules
happen to be evaluated in rather than the semantics #108 asks for. Every comparison in this document
that uses attempt 3 inherits that caveat, including the option cost comparison in section 6. This is
the harm class this whole document exists to measure appearing inside the document's own attempt 3,
and it was found by review rather than by the measurement, which is itself a finding about the
measurement.

**Attempt 3's 6 is not attempt 1's 15 minus the 5 crashes, and that is worth being explicit about
because the arithmetic invites the wrong inference.** The branching change is not semantics-neutral
for OUTPUT. It changes which field the conditional resolver branches on, so four plans that diverged
under attempt 1 converge under attempt 3: branching on `battery_present` reaches the same verdict on
both branches, and a fact that does not change the answer is not reported as missing. Measured, not
reasoned: attempt 1 gives 11 engine failures on this tree and attempt 3 gives 2, with the only
difference being the branching.

**WHAT THE GREEN FIXTURES ESTABLISH ABOUT CONJUNCTION, which is less than three-valued logic.** The
patch collects blockers from EVERY clause before evaluating any clause, so one missing conjunct
makes the field indeterminate even when another conjunct is already decisively false. Measured, on
`sound_audible_from_public_way`, whose `asked_when` is `amplified_sound AND location_type =
private_venue`, with `amplified_sound` false and `location_type` unanswered:

    in scope: false   indeterminate: TRUE   blockers: ["location_type"]

Under three-valued conjunction `false AND unknown` is false, so the field should be decisively out
of scope and nothing should be recorded as missing. The patch records `location_type` as a blocker
and resolves the dependent as unknown instead. The fixtures pass because no fixture pairs a false
conjunct with a missing one, so what they establish is that the patch propagates indeterminacy
through conjunctions whose other conjuncts are TRUE or absent, not that it implements three-valued
conjunction. A ruleset that added a second conjunct to any existing `asked_when` would meet the
difference immediately.

So the branching fix removes 9 of the 15, of which 5 are the non-termination and 4 are plans that
now settle. The remaining 6 are the 4 `plan.test.ts` and 2 `engine.test.ts` failures that the two
fixture lines clear.

## 3. Whether the case can arise today

**Not through the API.** Confirmed, and the confirmation is stronger than the issue claims.

- `validateIntake` requires every asked field that the REGISTRY does not mark `nullable`
  (`validate.ts:299`). All 11 gate fields omit it, so an asked gate cannot be submitted blank. This
  is a registry fact and does not depend on the schema, where three of the eleven do allow NULL.
- `insert` and `update` in `apps/api/src/events.ts` write **every** registry column from
  `validateIntake`'s output, so no column is skipped on write.
- `mergeIntakeEdit` clears answers whose question is no longer asked and then re-validates, so an
  edit cannot leave a gate in scope and unanswered either.
- `public-page.ts`'s UPDATE touches publication fields only, never intake.

A gate _is_ NULL whenever it was legitimately never asked: with `location_type = park`,
`obstructs_public_way` and `sapo_event_type` are both NULL. That is the correct outcome, not a
masquerade, and the current two-state behaviour gets it right.

The remaining routes to "in scope, unanswered" are:

1. **HYPOTHETICAL: a migration adding a gate column to existing rows without backfilling.** No such
   migration exists. **v2.5 is not an instance of this route, and the first version of this
   document wrongly presented it as one.** Migration 006 does the opposite: it backfills every
   existing row and says so. Verified by running its two statements against a live table rather
   than by reading them, over every value the column can hold:

   | `battery_system_kwh` | resulting `battery_present` |
   | -------------------- | --------------------------- |
   | NULL                 | false                       |
   | 0                    | false                       |
   | 5                    | true                        |
   | -1                   | **NULL**                    |

   Total over every value the API can produce, because `validateIntake` rejects a negative quantity
   on every submission. The negative is the one uncovered case, and migration 006's comment
   characterises it as "`> 0` reads it as no battery"; in fact neither statement matches it and the
   row would be left NULL. That is a detail of an already-merged migration, unreachable through the
   API, and it is recorded here rather than acted on.

   So v2.5 is evidence that this route can be CLOSED by a migration author who notices, not
   evidence that it happens. What migration 006 also records is that a migration facing real rows
   could not have written that backfill.

2. **Direct SQL that omits columns.** Real, and how the 4 `plan.test.ts` failures arose, but not a
   route the API uses: `events.ts` names every registry column on every insert and update.
3. **An in-memory intake record missing a key**, which is how the 11 `engine.test.ts` failures
   arose. This is not a storage state at all and reaches production only through a caller that
   builds an intake object by hand rather than loading a row.
4. A ruleset edit adding a new gate reduces to route 1, because `ruleset.test.ts` requires the
   events columns to equal the ruleset's intake fields plus the eight fixed columns, so a new field
   cannot land without a migration.
5. **WIDENING an existing gate's `asked_when`, which needs NO migration and NO direct SQL.** This
   route was missing from rounds 1 to 3 and it is the one that matters, because it is reachable by
   a supported, routine action rather than by a mistake or by hand-written SQL.

   A row keeps the NULL it legitimately stored while the gate was out of scope. Widen the scope and
   that same NULL is now in-scope-and-unanswered on the next regeneration, with nothing else having
   changed. **No migration is triggered**, verified against the guard rather than assumed:
   `ruleset.test.ts` compares the events column NAMES against the ruleset's intake field names, and
   a widened expression changes no field name, so the schema contract passes untouched.

   The exposure surface is exactly the gates that are both schema-nullable and themselves gated:
   `obstructs_public_way` and `sapo_event_type`. Under v2.8 a park or private-venue row stores NULL
   for `obstructs_public_way`, and any row where it is NULL or `no` stores NULL for
   `sapo_event_type`. Widening either expression exposes every one of those rows.
   `battery_present` is the third schema-nullable gate but has no `asked_when` at all, so it cannot
   be widened; a NULL `battery_present` is reachable by routes 1 and 2, the migration and the
   direct-SQL routes, which is what section 5 concludes and what the four `plan.test.ts` failures
   actually demonstrated. Rounds 1 to 6 said route 1 alone here while section 5 said both, so the
   analysis and the conclusion disagreed inside one document.

   **It is not a verification-owner action alone, and rounds 4's wording implied it was.** An
   `asked_when` expression decides what a trigger resolves to, so widening one is rule-scoping
   semantics: `DOCUMENTATION-GOVERNANCE.md` §6 "Change classes and approvals" gives the row "Rule
   trigger, dedupe, branch, deadline, or formula semantics" the approvers "Verification owner plus
   engine owner", and `AGENTS.md` says the same in the other direction: "Rule-semantics changes
   also need the engine owner's (Dev 1) review.". So route 5 needs the engine owner's review as a
   mandatory safeguard, not just a publication.

   That does not make it a mistake-only route, which was the substantive point: it is a supported
   path, taken deliberately, by people entitled to take it. It does mean the path has a reviewer
   whose specific job is to notice this consequence, which is a real mitigation and belongs beside
   the route rather than in a reader's assumptions.

**So the state is not reachable through the API, and no route to it has ever been taken.** Routes 2
and 3 are fixture mechanisms; they produced every failure this measurement observed, and none is a
thing the API can do.

**But routes 1 and 5 are not the same kind of thing, and rounds 1 to 3 of this document framed the
whole question as though only route 1 existed.** Route 1 needs a migration author to add a gate
column and forget to backfill it. Route 5 needs only a published ruleset whose `asked_when` is
wider than the previous one, which requires the engine owner's review as well as the verification
owner's, because widening `asked_when` changes rule-scoping semantics rather than only a status, and
involves no
migration, no backfill decision and no SQL. Describing the state as reachable only by a mistake or
by hand-written SQL was wrong, and it was the central argument for doing nothing.

**Is route 5 reachable TODAY, or only on a future ruleset? Only on a future one, and it has never
happened.** Checked across every published version rather than assumed: comparing the `asked_when`
of every field from v2.3 through v2.8, the only change in six versions is v2.4 to v2.5, and it is a
NARROWING (`battery_system_kwh` went from always-asked to gated on the new `battery_present`). No
expression has ever been widened. A narrowing is safe in this respect, because it moves fields OUT
of scope rather than in.

So route 5 is a FUTURE gap rather than a live one, and that is the honest reading. What changes is
its character, not its status: the trigger is a normal ruleset publication rather than a migration
error, so "this cannot happen without someone making a mistake" is not a defence the evidence
supports.

## 4. What `IntakeValue` would need

`IntakeValue` is `string | number | boolean | readonly string[] | null` and is **declared twice**,
identically, in `packages/engine/src/types.ts` and `packages/engine/src/intake/visibility.ts`, with
`index.ts` re-exporting the `visibility.ts` one.

**Rounds 1 to 3 budgeted two coordinated edits for that. That was the wrong reading: the duplicate
is a defect, not a cost to plan around.** `AGENTS.md:42` requires shared types to be imported from
`packages/engine` and never redefined, and the same authority argument applies inside the engine:
budgeting both edits preserves a second declaration of a type that should have exactly one. Nothing
in either site needs a separate definition, and they have not drifted only because nobody has edited
one of them yet.

So the correct entry is: keep the declaration in `types.ts`, have `visibility.ts` import it, and
then the three-state work touches one declaration. That is a tidy-up this measurement identifies
rather than proposes, and it is independent of whether issue #108 is acted on at all.

Today `null` carries at least four meanings, and they are only distinguishable by asking the
registry and the scope resolver, never by looking at the value:

1. never asked (out of scope);
2. asked, nullable, deliberately left blank;
3. asked and unanswered (unreachable via the API, per section 3);
4. absent from a partial insert.

The measured change did **not** need `IntakeValue` altered, which is worth stating plainly because
the issue lists it as likely scope. The distinction was carried in the scope resolver as a separate
set, not in the value. Adding a distinct "unanswered" member instead would reach: the type
declaration, `EventIntake`, `resolveAnswer`, `compareAnswer`, `evaluateClause` and `termHolds`,
`validate.ts`'s reader functions and its persistence loop, `apps/api/src/plan.ts`, and every
`?? null` that currently flattens the distinction on the way to Postgres.

**NO DATABASE CHANGE IS NEEDED, and the first version of this document said one was.** That was
wrong and it overstated the cost of an option, which argues against it on grounds that are not real.
A NULL column plus the ruleset already determines the answer: a NULL the registry resolves as IN
SCOPE is unanswered, and the same NULL under a false `asked_when` is not-asked. The API loader can
derive an `unanswered` member on the way in, exactly as the measured scope resolver derives it now.

The derivation is unambiguous for **every one of the 11 gates**, checked rather than assumed. The
table below is stated **under the proposed three-state semantics**, which matters: rounds 1 and 2
of this document printed it under TODAY's semantics, where an unanswered gate collapses to false,
and then used it to argue for the new representation. That reused the collapse the change exists to
remove, and it understated the runtime state.

For `location_type = street` with `obstructs_public_way` NULL:

| Field                  | Today (two-state)                      | Proposed (three-state)                           |
| ---------------------- | -------------------------------------- | ------------------------------------------------ |
| `battery_present`      | in scope, NULL -> unknown              | in scope, NULL -> **unanswered**                 |
| `obstructs_public_way` | in scope, NULL -> unknown              | in scope, NULL -> **unanswered**                 |
| `sapo_event_type`      | gate `!= no` is false -> **not asked** | gate `!= no` is **unknown** -> **scope unknown** |

For `location_type = park`, where `obstructs_public_way` is legitimately out of scope, both columns
agree: `obstructs_public_way` and `sapo_event_type` are not asked, and `battery_present` is
unanswered.

**The third row is the correction.** Under three-state, `sapo_event_type` is neither in scope nor
out of it; its scope depends on an answer nobody gave, which is exactly the engine's own tri-state
invariant applied one level up. Calling it "not asked" was the old collapse wearing the new label,
and it is also what a chained gate looks like in general: indeterminacy propagates down the chain
rather than stopping at the first dependent.

**What that costs the loader**, corrected upward from rounds 1 and 2:

- scope becomes three-valued, not two, so a loader deriving `unanswered` must derive
  `scope unknown` as well and cannot answer with a boolean `isInScope`;
- the derivation must be transitive, since a dependent of an indeterminate gate is itself
  indeterminate, which is the fixed point the measured `blockersFor` walk computes;
- the blocking gate must be carried, not just the fact of indeterminacy, because that is what
  `verdict.ts` branches on (section 2).

The ambiguous case would be a field that is in scope, NULL, and registry-nullable, where NULL could
equally mean "asked and deliberately left blank". **No gate is registry-nullable**, so no gate is
ambiguous. The 8 registry-nullable fields are all leaves and none of them gates anything, so their
ambiguity is pre-existing and is not what the three-state change is about.

None of this changes the conclusion of this section, which is that no DATABASE change is needed: the
row still carries only NULL and the ruleset still supplies the rest. It does mean the derivation is
a three-valued transitive walk rather than a two-valued lookup, and rounds 1 and 2 described the
cheaper thing.

**This argument depends on the registry-versus-schema divergence from section 1, not despite it.**
Both halves are needed: the schema must PERMIT NULL for the state to be storable at all, which it
does for exactly the three gates above, and the registry must say whether that NULL is in scope,
which is what makes it interpretable. The same divergence that made the original sentence wrong is
what makes this option cheap.

One corollary, since it follows from the same fact: a NOT NULL constraint on those three columns
would close route 1 at the database. It is not available for two of them, because
`obstructs_public_way` and `sapo_event_type` are legitimately NULL for a park, and migration 006
records why it is not taken for `battery_present` either.

**Offered as a fact rather than advice:** the scope resolver already knows which of the four
meanings applies, so representing it in `IntakeValue` buys nothing the measured implementation
needed. What it would buy is making the distinction legible at the API boundary rather than only
inside the engine, which is a readability argument and not a capability one.

## 5. The v2.5 risk, concretely

**What v2.5 changed to EVALUATED CONTENT:** one field added, `battery_present`; one field regated,
`battery_system_kwh` from `asked_when: null` to `asked_when: "battery_present"`. **No rule or
advisory object changed at all**, verified by diffing the two artifacts object by object rather
than by reading the provenance summary.

"In full" was the wording through round 6 and it was too strong. The rest of the v2.5 change:
`ruleset_version`, `status` and `provenance` scalars, and **schema acceptance of an optional
`verification.last_verified_date`**, which the artifact records only in its provenance prose. No
rule carries the field in v2.5, so it adds no evaluated content, but it is a schema change and the
claim as written excluded it.

`DOB-ASSEMBLY-001`, `ADV-NOISE-CODE-001` and `ADV-VENUE-OCCUPANCY-001` DID gain rescope coverage
metadata in v2.5, so it belongs to the v2.4-to-v2.5 transition this section describes. An earlier
round said the opposite and was wrong; the correction and the method that produced the error are in
the revision note.

**The counting basis, stated because it is what went wrong.** A published version is not a single
artifact: `rules/nyc-rules.v2.5.json` has an initial publication and a later same-version edit
before it is renamed forward. Every per-version count in this document measures the FINAL artifact
of that version, not the commit that first published it, because the final artifact is what the
version shipped as and what any later reader loads. Measured that way, objects carrying `rescope`:

| version | revisions | initial publication | final artifact |
| ------- | --------- | ------------------- | -------------- |
| v2.3    | 2         | 3                   | 3              |
| v2.4    | 1         | 3                   | 3              |
| v2.5    | 2         | 3                   | **6**          |
| v2.6    | 1         | 6                   | 6              |
| v2.7    | 2         | 6                   | 6              |
| v2.8    | 2         | 6                   | 6              |

Re-derived on that basis, **v2.5 is the only version whose count moves**: 4e15440 publishes it with
the three SAPO rules, and 11a552c adds the other three within the same version. v2.3, v2.7 and v2.8
also have more than one revision, and their counts are unchanged across it, so the sequence is
3/3/6/6/6/6 rather than the 3/3/3/6/6/6 an initial-publication count produces.

Before v2.5, `battery_system_kwh` was always asked and is nullable, so an event with no battery
left it blank, which resolved to `unknown` and made **`FDNY-GENERATOR-001`** conditional on every
such plan. That is the spurious conditional v2.5 removed, and `FDNY-GENERATOR-001` is the single
rule in the ruleset whose trigger references the field.

**Would the three-state change bring it back? Yes, on exactly that rule, and only when
`battery_present` is itself NULL.** This is not a theoretical answer: the measurement produced
precisely that finding, on precisely that rule, on the two fixtures where `battery_present` is
absent. Since section 3 shows the API cannot produce a NULL `battery_present`, the reintroduction is
confined to rows created by **routes 1 and 2 only**, and rounds 1 to 4 listed more than that.
Route 5 cannot reach it: `battery_present` has no `asked_when` to widen, as route 5's own entry
says. Route 3 is an in-memory record and never a row at all, so it can reproduce the finding in a
test but cannot put one in a database. Neither remaining route is something the API can do.

So the argument against in the issue is correct in mechanism and narrow in reach: it is the same
rule and the same shape, reachable only where an answer is genuinely missing.

## 6. An option the issue does not list

Three gates already carry `unknown` in their published `values` and the engine already handles it
correctly. Extending that to the gates that cannot express it would move the 5 boolean gates to
enums with `yes/no/unknown`.

**This option is PARTIAL, and rounds 1 to 3 described it as though it were complete.** Section 1
identifies eight gates that cannot carry `unknown`: the five booleans plus `location_type`,
`headcount` and `structure_types`. Converting the booleans reaches five of the eight. The other
three are harder in different ways and none of their costs is priced below:

- `location_type` is an enum already, so adding `unknown` to its values is cheap in the schema but
  every `asked_when` and trigger comparing it must decide what an unknown location means;
- `headcount` is an integer, so it has no room for a sentinel without changing the column type and
  every numeric comparison and threshold that reads it;
- `structure_types` is a multi-enum whose `none` option already carries "no structures", so an
  `unknown` member has to be given a meaning against `none` and against membership tests.

So the honest framing is that this option makes the distinction expressible for the five gates it
converts, not for all eight.

**The first version of this document priced this as leaving `asked_when` untouched. That is wrong:
the ruleset does not load.** `parseAskedWhenClause` accepts a bare token as a flag only when the
field is boolean, so changing the type without changing the expression fails at load with:

```
Intake contract invalid: ruleset.intake_fields[12].asked_when is unusable:
asked_when clause "food_present" reads "food_present" as a flag, but it is a enum field
```

Verified by building the mutated ruleset in memory and parsing it, not by reading the parser. The
corrected price:

1. **8 `asked_when` expressions rewritten** to explicit comparisons, with the unknown semantics
   decided for each. Today `food_present` means "true"; `food_present = yes` and
   `food_present != no` are different rules and the difference is the whole point of the option,
   so this is a regulatory decision per expression and not a mechanical edit. The 8:
   `food_vendor_count`, `food_affinity_private_exception_claimed`, `sound_audible_from_public_way`,
   `generator_gasoline_gallons`, `generator_diesel_gallons`, `generator_kw`, `battery_system_kwh`,
   `venue_license_covers_event_area`.
2. **11 published objects, 12 trigger conditions** that compare one of these fields to a boolean.
   Rounds 1 to 3 said 9 and 10, because the walk that produced them iterated the ruleset's `rules`
   array and the ruleset also has an `advisories` array. Corrected by walking every top-level array
   that carries an `id`:

   - **9 rules**: `SAPO-BLOCK-PARTY-ELIG-001`, `NYPD-SOUND-001` (2 conditions),
     `NYPD-SOUND-PARKS-DEP-001`, `DOHMH-VENDOR-PERMIT-001`, `DOHMH-ORGANIZER-NOTIFY-001`,
     `DOHMH-EXEMPTION-001`, `SLA-VENUE-LICENSE-001`, `SLA-ONEDAY-001`, `SLA-CATERING-001`.
   - **2 advisories**, missed entirely: `ADV-ALCOHOL-PUBLIC-001` (`alcohol bool true`) and
     `ADV-NOISE-CODE-001` (`amplified_sound bool true`). Losing the first drops the public-alcohol
     COVERAGE_GAP, which is the ruleset telling an organizer it does not cover their situation.

   These fail QUIETLY: a trigger comparing `bool true` against a stored `"yes"` stops matching, and
   every finding behind it leaves the plan with no error anywhere.

3. **`packages/engine/src/intake/validate.ts`**, also missed. `intakeWarnings` has two direct
   `applicable("alcohol") === true` checks, at the block-party eligibility conflict and the
   alcohol-in-public-space coverage gap. With enum strings both stop firing, silently, so the two
   inline warnings the spec requires at submission time disappear as well as the findings.
4. **Every fixture that submits one of these fields as a boolean, which must land BEFORE the
   answer-key impact can be measured at all.** `readFieldValue` accepts an enum only as a declared
   string (`validate.ts:85`), so `food_present: true` stops validating the moment the type changes.
   This is 132 boolean literals across 9 files: `scenario-intake-fixtures.ts` (30),
   `acceptance.test.ts` (19), `engine.test.ts` (17), `intake/intake.test.ts` (14),
   `plan.test.ts` (11), `rules-snapshot.test.ts` (10), `intake-form.test.tsx` (8) and
   `events.test.ts` (3), plus 20 positional SQL values across five event inserts in
   `ruleset.test.ts`. Those inserts name `food_present`, `amplified_sound`,
   `generator_present`, and `alcohol` as columns but supply their values positionally, so a scan for
   named fixture literals misses them.

   **`apps/api/migrations/006_events_battery_present.ts` is deliberately NOT in that list**, and it
   was until this round. It is a migration, not a fixture and not an enum submission: it adds
   `battery_present` as a boolean and backfills it, so its literal is a boolean written against the
   column shape that exists at that point in the sequence. Editing it to an enum string fails on a
   fresh database, because the migration runs before any later migration could change the column.
   Editing a merged migration is also forbidden outright (`CONTRIBUTING.md`: never edit a merged
   migration); the shape change belongs in the new forward migration point 5 already requires.
   Nothing else in the list is a migration, checked file by file: the other eight are engine and app
   fixtures and component tests.

   **The blanket replacement these edits describe would break historical replay, so the work is
   larger than a substitution.** `packages/engine/src/engine.test.ts` evaluates the same intake
   objects against BOTH `__fixtures__/nyc-rules.v2.3.json` and the current ruleset, to verify that
   old plans still replay under the semantics they were made with (governance §9). v2.3 declares
   `food_present`, `selling_anything`, `amplified_sound` and `alcohol` as `boolean`, so rewriting
   those fixtures to enum strings makes v2.3's `bool` triggers stop matching and the replay
   assertions compare two different worlds. The implementation must therefore split or normalize
   fixtures BY RULESET VERSION rather than replace values globally, which is design work this
   inventory did not previously account for.

   Rounds 1 to 6 listed trigger, validator, and schema work and omitted this entirely. It is
   the item that gates the others: point 6 below says this option's answer-key impact has never been
   measured, and it cannot be measured until the fixtures submit strings, because every scenario
   fails validation first.

5. A new published ruleset version and a migration per changed column (boolean to text). The form
   control does **not** change: `Control` already renders every declared enum value as a radio option
   and returns the selected string.
6. Answer-key impact, which this document has **not** measured for this option. Attempt 3 was
   measured only under the engine's existing evaluation order; this option changes 12 trigger
   conditions across 11 published objects plus two validator checks, and neither option can be
   assumed to move nothing.

What it buys: the distinction is expressible by an organizer who genuinely does not know, which is a
case the engine change does _not_ address, because that change only helps where nobody was asked at
all.

**What it DOES do for route 1, which rounds 1 to 4 denied.** A gate introduced as an enum carrying
`unknown` gives its migration a third option: write `unknown` for rows the registry puts in scope,
and leave legitimately out-of-scope rows NULL. That is a real answer meaning "not known", which the
engine already handles as an explicit unknown, so the uncertainty survives the migration instead of
being asserted away. Migration 006 is the worked example running the other way: it had to write
`false` for every NULL `battery_present` and says in its own comment that this asserts an answer
nobody gave. Had `battery_present` been an enum with `unknown`, that backfill could have preserved
the state, and `FDNY-GENERATOR-001` would have gone conditional rather than silently false.

So the column type does bear on route 1, and the engine change is not the only option that
preserves uncertainty there. The scope of that is narrow and worth stating exactly: it works for a
gate introduced AS an enum, at the moment of introduction. It does nothing for the five booleans
converted later, because their existing rows already hold `true` or `false` and there is no
uncertainty left to preserve. And it does nothing for route 5, where the row's NULL predates any
migration and no backfill is running.

What it still does not reach: route 5, and any gate whose unanswered state arrives without a
migration to write into.

**On the corrected inventory this option is still broad.** It is 8 regulatory decisions, 11
published objects and 2 validator checks at risk of silent non-matching, 132 fixture inputs, a
ruleset publication, a migration, an unmeasured answer key, and it reaches only five of the eight
gates that need it. Attempt 3's two-file throwaway diff is not a reliable implementation estimate
for the engine option because its resolver is order-dependent. I am still not recommending either.

## 7. What the measurement does and does not force

It does not force an answer. It also does not establish the load-bearing result earlier rounds
claimed. Attempt 3 passes 1163 tests only under the current evaluation order, while a cold
transitive lookup silently suppresses a deeper branch and `false AND unknown` is not evaluated as
three-valued conjunction. The answer-key impact and implementation size of a correct,
order-independent implementation therefore remain unmeasured.

The two facts a decision should turn on, neither of which is about fixtures:

- The state being protected against is **not reachable through the API today** (section 3), and no
  route to it has ever been taken. But **route 5, a widened `asked_when`, needs no migration and no
  SQL**, so this is insurance against a supported publication path rather than only against a
  migration error. Rounds 1 to 3 said the latter, and the product owner and an external reviewer
  weighed it. Two qualifiers, both of which cut against acting: no expression has ever been widened
  across six published versions, so the gap is future rather than live; and the path requires the
  engine owner's review as well as the verification owner's, so it has a mandatory reviewer whose
  job includes noticing exactly this.
- The change is **larger than the issue scopes it**: `verdict.ts` must change too, or the plan
  generator does not terminate, and `conditions.ts` still needs an order-independent transitive
  resolver with correct conjunction semantics (section 2). Those correctness details must be
  implemented and re-measured before comparing costs or fixture movement.

The ruleset alternative remains broad for the reasons in section 6, but this measurement no longer
supports calling the engine alternative cheaper or output-neutral. Those comparisons inherited
attempt 3's invalid premise.

It still does not force an answer. The independent production-reachability finding remains: the
engine change buys correctness in a state the API cannot currently produce.

If the deployment gains real rows before the next ruleset version that widens a gate, route 5
becomes live and the calculus changes, and route 5 needs no migration to arrive. Until then the
reachability evidence supports deferring, without forcing it. What the measurement no longer
supports is a decision based on zero answer-key movement, a two-file implementation estimate, or
the sentence rounds 1 to 3 offered for deferring: that reaching this state requires a mistake.

---

## Revision note

Round 2 corrected four things in this document. They are recorded rather than silently edited,
because three of them were errors in the direction of the conclusion.

1. **"All 11 gates are non-nullable" was written without saying registry or schema**, and was read
   as a schema claim. In the schema three of the eleven are nullable. The registry claim is the one
   that carries the argument and it stands (section 1).
2. **v2.5 was presented as an observed instance of the unbackfilled-migration route.** It is the
   opposite: migration 006 backfills every row it can reach. Route 1 has never occurred (section 3).
3. **The two fixture mechanisms were run together**, and one of them was used as evidence about
   production reachability. SQL inserts omitting columns and in-memory records missing keys are
   different things, and neither is a production route (sections 2 and 3).
4. **The alternative was underpriced and the engine change overpriced.** The ruleset option does not
   load without rewriting 8 expressions and auditing 11 published objects; the engine option needs
   no database change at all (sections 4 and 6).

Errors 1, 2 and 4 each made the engine change look worse or the alternative look better than the
evidence supports. Corrected, the two options are closer than the first version implied.

### Round 3

Three more, and the first is the most serious error in the history of this document.

5. **The headline number was measured on the wrong change.** The zero-failure result was the second attempt's
   result, which added a rule that a stored dependent answer overrides its unanswered gate. That is
   narrower than #108's semantics, the document said so in a later caveat, and the headline did not.
   It was quoted as the central fact to the product owner and to a cross-model reviewer.

   Round 3 took the option of fixing rather than qualifying: the recursion is fixed in `verdict.ts`
   by branching on the blocking gate, #108's semantics are preserved exactly, and the suite passes
   with no failures. So the headline survives, but on a re-measurement rather than on the
   evidence originally offered for it, and the scope grew by a file. **The non-termination was
   never a property of the semantics.** It was a property of branching on a field that could not
   settle the unknown, and rounds 1 and 2 mistook the second for the first and weakened the
   semantics to avoid it.

6. **The chained-gate table was stated under today's semantics while arguing for the new ones**
   (section 4). Under three-state a NULL `obstructs_public_way` makes `sapo_event_type`'s scope
   unknown, not "not asked". The corrected table costs the loader a three-valued transitive walk
   rather than a two-valued lookup. The section's conclusion, that no database change is needed,
   is unaffected.
7. **The status was `MEASUREMENT ONLY`, which is not a governance §3 state**, so the document sat
   outside the approval protocol. It is `PROPOSED`, with the measurement-only qualifier kept as
   prose.

Error 5 is the one to weigh: for two rounds this document's most quoted sentence was evidence about
a change nobody had proposed.

### Round 4

Six more. The first changes an argument the product owner and an external reviewer have been
reasoning from.

8. **A route to the state was missing, and it is the one that needs no migration and no SQL**
   (section 3, route 5). Widening an existing gate's `asked_when` leaves a legitimately-NULL row
   in scope and unanswered on the next regeneration, and no migration is triggered because the
   schema contract compares field NAMES. Rounds 1 to 3 framed the state as reachable only by a
   migration error or hand-written SQL, and that was the central argument for doing nothing.
   Checked across v2.3 to v2.8: no expression has ever been widened, so the gap is future rather
   than live. What changes is that its trigger is a routine publication, not a mistake.
9. **The comparison still quoted `+32/-3` for the engine option** after section 2 had been
   corrected to two files. Fixed in section 6 and in the round 2 summary, not only where it was
   flagged.
10. **The enum option's blast radius missed the `advisories` array and the validator.** The walk
    that produced "9 rules, 10 conditions" iterated `rules` only. It is 11 published objects and 12
    conditions, adding `ADV-ALCOHOL-PUBLIC-001` and `ADV-NOISE-CODE-001`, plus two
    `applicable("alcohol") === true` checks in `intake/validate.ts` (section 6).
11. **That option is partial and was described as complete.** It reaches 5 of the 8 gates that
    cannot carry `unknown`; `location_type`, `headcount` and `structure_types` are unpriced
    (section 6).
12. **The duplicate `IntakeValue` was budgeted as a coordination cost.** It is a defect against
    `AGENTS.md:42`; the entry is now one declaration plus an import (section 4).
13. **The attempt table needed its measurement basis stated** (section 2). Attempt 3's 6 is not
    attempt 1's 15 minus the crashes: the branching change also settles 4 plans that previously
    diverged. Re-measured on one tree so the rows compare.

Finding 8 is the one that matters. Nine of the thirteen corrections in this document have run in
the direction of its own conclusion, which is worth stating plainly given that its conclusion is
"the measurement supports deferring".

### Round 5

Five more, and the first is the third consecutive round in which this document's primary evidence
was not reproducible.

14. **The provenance line and the headline count disagreed** (top of document). The line named the
    pre-rebase base `46971a0` while section 2 described a post-rebase 1163-test tree, and the
    headline still said 1161. Round 5 re-measured all six cells of section 2's table on ONE tree at
    merge-base `481e1f6`, and added a reproduction recipe, because a number that has been wrong in
    three different ways is not yet decidable evidence. **Re-running found a fourth defect in that
    table**: attempt 2's unedited-fixture cell was 15 and is 0, carried across from attempt 1 rather
    than measured.
15. **Route 5 was described as a verification-owner action alone** (section 3). It is rule-scoping
    semantics, so the "Rule trigger, dedupe, branch, deadline, or formula semantics" row of
    `DOCUMENTATION-GOVERNANCE.md` §6 "Change classes and approvals", and `AGENTS.md` on
    rule-semantics changes, both require the engine owner's review too. Still a supported path
    rather than a mistake; now with its safeguard stated.
16. **The battery-row claim listed routes that cannot produce one** (section 5). Route 5 cannot
    reach `battery_present`, which has no `asked_when`, and route 3 is an in-memory record rather
    than a row. It is routes 1 and 2.
17. **"The gap is confined to the eight gates whose type cannot carry unknown" was wrong**
    (section 1), and contradicted section 4's own table. A published `unknown` helps a row that
    STORES it; an in-scope NULL is a different state and collapses identically. The change reaches
    all 11 gates.
18. **"The enum option does not help route 1" was also wrong** (section 6), in the opposite
    direction. A gate introduced as an enum with `unknown` lets its migration write `unknown` for
    in-scope rows instead of inventing an answer, which is exactly what migration 006 could not do.

17 and 18 are the same comparison wrong in both directions at once, which is worse than a lean.
Across five rounds this document has taken 18 corrections, and eleven of them have favoured its own
conclusion.

### Round 7

Four, and the first is the second round in which the headline's reproducibility was the finding.

19. **The recipe could not be run.** Section 2 described the three attempts and the published commit
    reverted them, so step 3 pointed at nothing. The patches are now carried in an appendix, each
    generated at `481e1f6` and each checked with `git apply --check` at that commit. Round 5 fixed
    the sentence that named the base; this fixes the cause, which is that a measurement whose
    inputs are not published is an argument.
20. **A route claim contradicted section 5 inside the same file** (section 3). A NULL
    `battery_present` is reachable by routes 1 and 2, not route 1 alone. Section 5 had said so since
    round 5 and the analysis feeding it had not been updated. The other two route claims in the
    document were checked and both already say routes 1 and 2.
21. **The enum option omitted the fixture input migrations** (section 6), which are the item that
    gates the rest: `readFieldValue` rejects a boolean for an enum, so 113 boolean literals across
    9 files stop validating, and the answer-key impact this document flags as unmeasured cannot be
    measured until they are converted.
22. **"What v2.5 changed, in full" was too strong** (section 5). It omitted schema acceptance of
    `verification.last_verified_date`. It is now scoped to evaluated content, with the rest listed.

**One correction was rejected and the rejection was WRONG, and it is the most serious defect in this
document's history because of how it was wrong rather than that it was.** Round 7 turned down the
finding that `DOB-ASSEMBLY-001`, `ADV-NOISE-CODE-001` and `ADV-VENUE-OCCUPANCY-001` gained rescope
metadata in v2.5, on a count of 3/3/3/6/6/6 across v2.3 to v2.8, and presented the rejection as
evidence of the document's disposition to weigh findings on their merits. It was then independently
verified by a second reader who reached the same numbers and certified it.

Both counts were taken from the commit that ADDED each artifact, which is the initial publication
rather than what the version shipped as. `rules/nyc-rules.v2.5.json` has two revisions: 4e15440
publishes it with three SAPO rules, and 11a552c adds the other three within the same version, before
c8e06e5 renames it forward. The finding was right, the metadata landed inside v2.5, and it belongs to
the transition section 5 describes. It is applied there, together with the counting basis this
document now states, and re-derivation on the final-artifact basis moves v2.5 and no other version.

Two checks agreed because they shared a method, not because the method was sound. A wrong rejection
that reads as careful is worse than one that reads as careless: it spends the credibility of having
weighed something. This document no longer claims a rejected correction as evidence of anything, and
the standing rule that replaced it is in section 5: every per-version count states its basis and is
taken from the final artifact of the version.

Across seven rounds: 23 corrections applied, one declined and then found to have been declined
wrongly, and twelve of the applied ones have favoured this document's own conclusion.

### Round 8

Issue #174 corrected three remaining findings:

24. **Attempt 3's headline result was not measured under the semantics it named.** The
    cold-resolver and conjunction probes already in section 2 show order-dependent suppression and
    incorrect `false AND unknown` handling. The 1163/1163 result is now scoped to that throwaway
    patch's existing evaluation order; correct answer-key impact and implementation size are
    explicitly unmeasured.
25. **The enum fixture inventory missed five positional SQL inserts.** Their four converted gate
    values add 20 literals in `ruleset.test.ts`, bringing the inventory to 132 literals across nine
    files.
26. **The enum option priced a form-control change that does not exist.** The shared `Control`
    already renders declared enum values and returns the selected string, so the cost is removed.

---

## Appendix: the three patches

The measurement's primary evidence is a set of failure counts, and small differences in
`resolveAnswer` and in the branching change those counts. Attempt 2's unedited-fixture cell read 15
for two rounds and measures 0, which is exactly the kind of error a reader can only catch by running
the thing. So the patches are carried here rather than described.

All three were generated at `481e1f6`, the commit the measurement is pinned to, and each is verified
to apply cleanly there with `git apply --check`. `481e1f6` is an ancestor of this branch, so it
survives rebases and is not subject to garbage collection while the branch exists.

They are throwaways. Nothing in this branch applies them, and this document recommends no option.

### Attempt 1: three-state semantics, original branching

```diff
diff --git a/packages/engine/src/conditions.ts b/packages/engine/src/conditions.ts
index 21a68b8..36873c9 100644
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
+    if (!isInScope(clause.field)) return [];
+    const raw = intake[clause.field];
+    return raw === undefined || raw === null ? [clause.field] : [];
+  };
+
   const evaluateClause = (clause: AskedWhenClause): boolean => {
     const value = valueOf(clause.field);
     switch (clause.kind) {
@@ -224,6 +238,12 @@ export function createScopeResolver(intake: EventIntake, ruleset: EngineRuleset)

     resolving.add(field);
     try {
+      const blockers = [...new Set(definition.askedWhenClauses.flatMap(blockersFor))];
+      if (blockers.length > 0) {
+        indeterminate.set(field, blockers);
+        cache.set(field, false);
+        return false;
+      }
       const inScope = definition.askedWhenClauses.every(evaluateClause);
       cache.set(field, inScope);
       return inScope;
@@ -232,11 +252,21 @@ export function createScopeResolver(intake: EventIntake, ruleset: EngineRuleset)
     }
   }

-  return { isInScope };
+  const settle = (field: string): void => {
+    if (!resolving.has(field)) isInScope(field);
+  };
+  return {
+    isInScope,
+    isIndeterminate: (field: string) => { settle(field); return indeterminate.has(field); },
+    blockersOf: (field: string) => { settle(field); return indeterminate.get(field) ?? []; },
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
```

### Attempt 2: narrower semantics, original branching

```diff
diff --git a/packages/engine/src/conditions.ts b/packages/engine/src/conditions.ts
index 21a68b8..fa65493 100644
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
+    if (!isInScope(clause.field)) return [];
+    const raw = intake[clause.field];
+    return raw === undefined || raw === null ? [clause.field] : [];
+  };
+
   const evaluateClause = (clause: AskedWhenClause): boolean => {
     const value = valueOf(clause.field);
     switch (clause.kind) {
@@ -224,6 +238,12 @@ export function createScopeResolver(intake: EventIntake, ruleset: EngineRuleset)

     resolving.add(field);
     try {
+      const blockers = [...new Set(definition.askedWhenClauses.flatMap(blockersFor))];
+      if (blockers.length > 0) {
+        indeterminate.set(field, blockers);
+        cache.set(field, false);
+        return false;
+      }
       const inScope = definition.askedWhenClauses.every(evaluateClause);
       cache.set(field, inScope);
       return inScope;
@@ -232,11 +252,25 @@ export function createScopeResolver(intake: EventIntake, ruleset: EngineRuleset)
     }
   }

-  return { isInScope };
+  const settle = (field: string): void => {
+    if (!resolving.has(field)) isInScope(field);
+  };
+  return {
+    isInScope,
+    isIndeterminate: (field: string) => { settle(field); return indeterminate.has(field); },
+    blockersOf: (field: string) => { settle(field); return indeterminate.get(field) ?? []; },
+  };
 }

 function resolveAnswer(field: string, intake: EventIntake, scope: ScopeResolver): ResolvedAnswer {
-  if (!scope.isInScope(field)) return { state: "not_asked" };
+  if (!scope.isInScope(field)) {
+    if (scope.isIndeterminate?.(field)) {
+      const own = intake[field];
+      if (own !== undefined && own !== null) return { state: "answered", value: own };
+      return { state: "unknown", isExplicitUnknown: false };
+    }
+    return { state: "not_asked" };
+  }
   const value = intake[field];
   if (value === undefined || value === null) return { state: "unknown", isExplicitUnknown: false };
   if (value === UNKNOWN_ANSWER) return { state: "unknown", isExplicitUnknown: true };
```

### Attempt 3: three-state semantics, branching on the gate

```diff
diff --git a/packages/engine/src/conditions.ts b/packages/engine/src/conditions.ts
index 21a68b8..36873c9 100644
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
+    if (!isInScope(clause.field)) return [];
+    const raw = intake[clause.field];
+    return raw === undefined || raw === null ? [clause.field] : [];
+  };
+
   const evaluateClause = (clause: AskedWhenClause): boolean => {
     const value = valueOf(clause.field);
     switch (clause.kind) {
@@ -224,6 +238,12 @@ export function createScopeResolver(intake: EventIntake, ruleset: EngineRuleset)

     resolving.add(field);
     try {
+      const blockers = [...new Set(definition.askedWhenClauses.flatMap(blockersFor))];
+      if (blockers.length > 0) {
+        indeterminate.set(field, blockers);
+        cache.set(field, false);
+        return false;
+      }
       const inScope = definition.askedWhenClauses.every(evaluateClause);
       cache.set(field, inScope);
       return inScope;
@@ -232,11 +252,21 @@ export function createScopeResolver(intake: EventIntake, ruleset: EngineRuleset)
     }
   }

-  return { isInScope };
+  const settle = (field: string): void => {
+    if (!resolving.has(field)) isInScope(field);
+  };
+  return {
+    isInScope,
+    isIndeterminate: (field: string) => { settle(field); return indeterminate.has(field); },
+    blockersOf: (field: string) => { settle(field); return indeterminate.get(field) ?? []; },
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
index 795a497..670b280 100644
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
@@ -182,9 +182,16 @@ function evaluateConditional(
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

---

## Corrections from the issue #108 decision brief

> **These corrections have a DIFFERENT measurement basis from the rest of this document.** Everything
> above was measured at merge-base `481e1f6`, ruleset `nyc-rules.v2.8.json`, suite size 1163, and the
> reproduction recipe in the header applies to it. The corrections below were measured at `f8d6fc3`,
> ruleset `nyc-rules.v2.11.json`, Node v24, PostgreSQL 18.4, suite size **1569**, and report v2.11
> results. Following this document's stated checkout will NOT reproduce them. The prototype patches
> and probe harnesses behind them are on the branch `archive/issue-108-probe-appendices`. This note
> exists because appending them without it would have made the header's provenance declaration false
> for part of its own document.

Added 2026-08-03. These corrections were written in `asked-when-three-state-decision.md` and are moved here, to the document they correct, when that brief was cut back to its decision. Nothing about them changed in the move.

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
