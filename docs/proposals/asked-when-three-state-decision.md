# Issue #108 decision brief: three-state `asked_when`

**Status:** PROPOSED

This document recommends an action on issue #108. It changes no engine code, no ruleset, no
fixture, no schema and no manifest entry. The branch carrying it changes **two** documents: this
one, and `docs/proposals/asked-when-three-state-measurement.md`, which receives the corrections
this document used to carry in a section of its own — they correct that document, so they belong
in it. Nothing here is implementable until the approvals named in section 6 are given.

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
document are no longer collected here: they were moved into that document itself, which is where
its readers will find them.

**Which of issue #108's two inputs this document measures. Read this before any number below.**
The issue names one behaviour but there are two distinct inputs that produce it, and they do not
behave the same way.

- **Q1, the gate that is in scope and UNANSWERED**: raw `undefined` or `null`. Every failure
  count, prototype and plan diff in sections 2 and 4 is Q1, and Q1 is the question PR #167
  measured.
- **Q2, the gate that was ASKED and ANSWERED `"unknown"`.** The merged
  `docs/proposals/unknown-gate-measurement.md:136-138` identifies Q2 as the case issue #108's own
  title describes, and distinguishes it from PR #167's. **The prototype does not touch Q2.** Its blocker list (`blockersFor`) records a gate only when the raw value is `undefined`
  or `null`, so a gate answered `"unknown"` scopes its dependents out under the patch exactly as it
  does today. Verified by running the same intake on both trees: byte-identical plans
  (section 2).

**Consequence, stated plainly: this document does not dispose of issue #108, and it does not dispose
of the Q1 engine question either.** For Q1 it measures the engine and nothing wider. Sections 2 and
4 measure what `packages/engine` produces and what an engine-level change would cost; the Q1 probe
called `evaluate` directly, because a Q1 intake cannot be submitted through the API at all
(section 4). That is an engine measurement, not an end-to-end one, and this document does not claim
to have run Q1 through the product path: the questionnaire's own scoping in `visibility.ts` and
`validate.ts`'s rejection of an answer to an un-asked question are untouched by the prototype and
left unresolved here (section 4, section 6a item 4, section 7 item 2).

**What the Q1 prototype settled, and what it did not.** It settled that the approved fixture suite
cannot tell the two semantics apart, and that the change is nonetheless not a no-op on at least one
intake no fixture covers (section 2). It did not settle correctness across the gate inventory, and on two counts rather than one:
attempt B was never exercised with the multi-enum gate `structure_types` blocking, and the source
trace of why that path looks unsafe is not reproduced here, so neither the failure nor its absence
has been shown; and on the two gates that publish an `unknown` value, the unchanged branch filter at
`packages/engine/src/verdict.ts:154-160` strips that value even when the gate is unanswered, so the
branch table omits a path whose behaviour differs from every path it does enumerate (section 7
item 4). It did not settle the engine-package cost either: attempt B
leaves `visibility.ts` untouched, so its diff is a lower bound on implementation size rather than
the size of a complete implementation (section 6a item 3, section 7 item 2). The engine
investigation stays open on both counts; section 6a recommends deferring the change, not closing the
question. What the organizer would be asked and shown under a changed Q1 is not measured anywhere
below.

For Q2 this document publishes a measurement of the engine (section 2), of
the plan's verdict-detail renderer (section 2) and of the questionnaire (section 2), and no more.
Those are three probes at three points, not one run along the path: no measurement in this document
crosses the API or the database, and this document does not trace the steps between the three
either. The six-failure count, the 1577/1577 result and the plan diffs say nothing about Q2 at all.
Section 6 gives a separate recommendation for each, and issue #108 stays open on Q2 either way.

**Measurement basis.** Every number below was measured on commit `c700698` (this branch's merge-base
with `origin/main`), ruleset `rules/nyc-rules.v2.11.json`, Node v24.18.1, PostgreSQL 18.4, full suite
size **1577**.

**The basis moved, and the numbers were rerun rather than restated.** An earlier revision reported
every number against `f8d6fc3`, which is 18 commits older than this branch's merge base. The
intervening commits change `packages/engine/src/verdict.ts`, the plan's `VerdictDetailPanel` and
their tests, which are the paths this brief measures, so the older numbers described a different
tree. All four probes and both prototype runs were rerun on `c700698` on 2026-08-03. **Two figures
moved, and both are suite sizes**: the full suite is 1577 rather than 1569, and attempt A's passing
count is 1571 rather than 1563. Nothing else moved. Attempt A fails the same six tests, all
non-termination and no assertion failure; attempt B passes the whole suite with `pnpm typecheck`
clean; the street-event case still goes from 9 findings to 20 with the same four SAPO street-size
permits; the Q2 render probe still produces four branch rows; the nullable-gate probe still returns
`errors: []` with `tent_area_sqft` carried as `null`. The recommendation in section 6 is unchanged,
and nothing in the rerun contradicts it.

**How to reproduce.** Partly, and this document says which part.

Still runnable from what is written here:

1. `git checkout c700698 && pnpm install --frozen-lockfile`.
2. Bring up an empty PostgreSQL, export `DATABASE_URL`, and run `pnpm --filter api migrate up`.
   **Without this, 347 of the 1577 tests skip silently**, including all 23 of
   `apps/api/src/plan.test.ts`. A run reporting "1230 passed | 347 skipped" has not measured the
   api lane at all.
3. `pnpm test` gives the 1577-test baseline every number below is stated against.

Not runnable from this document: the two prototype patches and the four probe harnesses. They were
published here as appendices A1–A6 and were removed on 2026-08-03, when this brief was cut back to
its decision, because each published probe invited a claim about what it proved and four review
rounds went to correcting those claims rather than the recommendation. They are preserved on the
branch `archive/issue-108-probe-appendices`, pushed for that purpose so the reference survives a
force-push of this one, and can be read by fetching that branch first:

```
git fetch origin refs/heads/archive/issue-108-probe-appendices
git show FETCH_HEAD:docs/proposals/asked-when-three-state-decision.md
```

The fetch is not optional and an earlier revision of this paragraph left it out. A clone stores a
non-default branch under `refs/remotes/origin/`, so `git show archive/issue-108-probe-appendices:...`
resolves nothing and fails with `fatal: invalid object name`. The two commands above were run on
2026-08-03 in a fresh full clone and in a `--depth 1 --single-branch --branch main` clone, and both
printed the archived 1647-line document, whose appendix begins at its line 974.

The consequence, stated rather than left for a reader to discover: **the failure counts, the plan
diffs and the two Q2 probe results below cannot be re-derived from this document alone.** They were
measured, they are reported honestly, and re-deriving them means recovering the harnesses from that
commit. Anyone who wants the recommendation to rest on a fresh run should do that rather than treat
these numbers as reproduced.

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

## 2. Blast radius, and what the prototype does and does not settle

Everything in this section about Q1 is measured on the attempt-B prototype; the prototype is not on
this branch and this document does not publish it, so what it does is described only by its effects
here. The probe harnesses and
the full patches were published here until 2026-08-03 and were removed with the rest of the
appendices; they are on `archive/issue-108-probe-appendices` if a reader needs to re-derive a number.

**Q1, the unanswered gate. No approved expected value moves. Zero.** The full suite passes
unchanged under the tri-state Q1 semantics as attempt B implements them — 1577 passed, 61 files,
against a live database. "As attempt B implements them" is load-bearing: that is a statement about
one prototype on the inputs measured, not about the semantics in general. The semantics alone,
without attempt B's three corrections, give 6 failures, all non-termination in `verdict.ts` and no
assertion failures.

**It is nonetheless not a no-op, and this is the part no fixture can see.** Running one intake
through `evaluate` with and without the patch, at v2.11 and `today = 2026-07-22`: a street event
where nobody answered `obstructs_public_way` goes from 9 findings to 20, the added eleven including
four SAPO street-size permits as `may_be_required`. No approved fixture covers that state, which is
why the suite is silent about it.

**Q2, the gate answered `"unknown"`, is a different question and none of the Q1 numbers carry to
it.** `unknown-gate-measurement.md:136-138` identifies Q2 rather than Q1 as issue #108's own case.
Only two of the ten gates can carry `"unknown"` at all — `obstructs_public_way` and
`sapo_event_type`; of the remaining eight, five are booleans, one an integer, one an enum without
an `unknown` value, and one a multi-enum. Attempt B is unexercised on the multi-enum gate, so
"correct" is not established for the whole gate inventory.

**The Q2 engine probe, which is the first of the three points measured for Q2.** The same intake was
run through `evaluate` on both trees and produced byte-identical plans: a gate answered `"unknown"`
scopes its dependents out under the patch exactly as it does today, because `blockersFor` records a
gate only when the raw value is `undefined` or `null`. The four SAPO street-size permits that depend
on `sapo_event_type` are the dependents scoped out in the case measured.

**Q2 is already visible to an organizer, on both sides.** Measured through the shipped components
rather than deferred. The plan's `VerdictDetailPanel` renders one row per branch of every missing
fact with its verdict copy and reason (`plan-view.tsx:416-420`, `verdict-detail.tsx:121-139`,
covered by `plan-view.test.tsx:1002-1039`), and the answer key makes branches-shown the approved
CONDITIONAL contract. On the questionnaire side, the shipped `IntakeForm` asks `sapo_event_type`
once `obstructs_public_way` is `yes`, offers all five registry values with `"unknown"` labelled
"I don't know", and carries that answer into the submission verbatim.

## 3. Whether `IntakeValue` can distinguish "unanswered"

**It can represent it; it cannot distinguish it. An earlier revision answered "no" to the
representation question, and that was wrong:** `packages/engine/src/types.ts:8-12` assigns exactly
that meaning, an absent key or `null` means "asked, not answered". What the type cannot do is tell
that meaning apart from the others sharing the encoding. `IntakeValue` is
`string | number | boolean | readonly string[] | null`, and `null` carries at least four distinct
meanings that only the registry plus the scope resolver can tell apart: never asked; asked,
nullable, deliberately blank; asked and unanswered; absent from a partial write. So what is missing
is a discriminator, not a representation, and a change that added a second representation would be
answering the wrong question.

Recorded and not fixed, because it is out of this task's scope: the type is declared twice,
identically, at `packages/engine/src/types.ts:5` and
`packages/engine/src/intake/visibility.ts:11`, with `index.ts:20` re-exporting the second. That is
a defect against `AGENTS.md` ("never redefine intake, finding, verdict, or status types locally")
and it is independent of issue #108.

## 4. Whether the Q1 state can arise at all

**Not through the API. Re-verified against current code, not carried forward. This section is Q1
only; Q2 is reachable per section 2, and whether a Q2 answer is then stored is not established
anywhere in this document.**

- `packages/engine/src/intake/validate.ts:299`: `if (!isProvided(submission, field.field) && !field.nullable)` raises `required`. All 10 gate fields omit `nullable` in the registry (section 1), so an asked gate cannot be submitted blank.
- `apps/api/src/events.ts:151` and `:164`: both `INSERT` and `UPDATE` build their column list from `intakeColumnNames(intakeContract)`, the full registry, and pass `values[column] ?? null` for each. No column is ever skipped on write, so a partial-column insert cannot happen through the API.
- `validate.ts:285-297` rejects an answer to a question the registry does not consider asked, so a stale answer cannot revive a dependent either.

A gate _is_ NULL whenever it was legitimately never asked (`location_type = park` leaves
`obstructs_public_way` and `sapo_event_type` NULL). Attempt B leaves that case alone; the park probe
that checked it was removed with the appendices and its result is not reported here.

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
6a names) would make the Q1 state reachable on a newly created row, with no prior row and no
widening, **but only where the `events` column can hold the NULL, which for seven of the ten gates
it cannot** (section 6a, route 2). The nullable-gate probe measured one step of that: an in-scope
registry-nullable field left unanswered validates clean and is carried into the record to persist as
`null`. The write itself is source-traced through `events.ts:145` and `:154`, not run.

## 5. The counter-argument, on its merits

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
comes **before** any implementation approval rather than alongside it, which is why section 6's
approvals table carries it as a prerequisite row rather than as a caveat.

**Second: would the change reintroduce what nyc.v2.5 removed? Yes, narrowly, and I can name the
rule.** This is not inference. `docs/test-scenario-answer-key.md` v7 records it in its own status
header: "v2.5 changed evaluated output without changing this document: it removed an
FDNY-GENERATOR-001 finding that five scenarios were reporting and none of their expected-findings
blocks ever listed." Before v2.5, `battery_system_kwh` was always asked and is nullable, so an event
with no battery left it blank, it resolved `unknown`, and `FDNY-GENERATOR-001` went conditional on
every such plan. v2.5 added `battery_present` and gated the quantity behind it.

The battery case of the removed probe set is that exact finding coming back, on that exact rule,
when `battery_present` is itself absent; section 2 does not report it and this document does not
publish the run. `FDNY-GENERATOR-001` is the only rule in the ruleset whose trigger references
`battery_system_kwh`.

**But the reach is narrow and the mechanism is not the same.** v2.5's spurious conditional fired on
events where the organizer _had answered everything they were asked_: the field was in scope, blank
was a legitimate answer, and the engine still called it unknown. Attempt B fires only where an answer
is genuinely missing. Those are different states, and v2.5 did not remove the second one; it removed
the first. So the honest statement is: the change would reintroduce the same finding on the same rule
in a strictly smaller set of cases, all of which are cases where something really is unknown.

Weighed against that: today's behavior on case 1 withholds four SAPO street-size permits from a
street event, and although the plan does name the unresolved gate and five other findings behind it
(measured in the removed probe set, not reported here), no branch text reaches the four street
permits themselves. Spurious conditionals are a
real product harm, v2.5 exists because of them, but they are visible to the organizer and
recoverable by answering a question. A permit no branch text names is recoverable only by answering
a question the plan does not identify as the one that would produce it.

## 6. Recommendation

**This section recommends separately on Q1 and Q2 (see the scope statement at the top). It does not
dispose of issue #108: the Q2 decision is left open on a measurement, not closed, and the Q1 engine
question is deferred with two of its own gaps unmeasured (items 3 and 4 below).**

### 6a. Q1, the unanswered gate

**Do not implement the semantics change now. Defer it, with a named trigger and a named
precondition.**

The reasons, in the order they carry weight:

1. **The Q1 state is not reachable through the API and never has been** (section 4, re-verified at
   v2.11), and no published ruleset has ever widened a gate. The change buys correctness in a state
   the deployed system cannot currently produce. That is a statement about the registry as
   published, not about the validator: it holds because no gate field is `nullable`, and a
   published contract that made one `nullable` would make the state reachable on a newly created
   row wherever the `events` column can hold the NULL, which for three of the ten gates it can
   (section 4, section 6a's trigger). This reason is Q1-specific; it does not transfer to Q2,
   which section 2 shows is reachable.
2. **The approved fixtures cannot tell the two semantics apart** (section 2). Merging a semantics
   change that its own regression suite is blind to is the wrong order of operations regardless of
   which semantics is right. If the change is ever made, the fixtures that distinguish the semantics
   must be approved and land with it, and the street-event case in section 2 is the natural
   candidate.
3. **The issue underscopes the change.** `verdict.ts` is not optional: without the branching change
   the plan generator does not terminate on six existing tests. Order-independence and three-valued
   conjunction are two further correctness requirements the issue does not mention. All three are
   fixable and are fixed in attempt B. So the issue's "Scope if changed" list, naming
   `visibility.ts` and `conditions.ts`, is incomplete: `verdict.ts` is required as well. It is
   **not** wrong to name `visibility.ts`: attempt B leaves that file untouched and thereby leaves
   the divergence in item 4 unresolved, so attempt B's two-file diff, whose size this document no
   longer publishes, is a lower bound on implementation size rather than the size of a complete
   implementation.
4. **`visibility.ts` is an unresolved design question, not a saving.** Attempt B changes the engine's
   scoping and leaves the questionnaire's scoping two-state, so the two would disagree about the same
   event: the engine would call a dependent's scope unknown and material while the form does not ask
   it and `validate.ts` rejects an answer to it. That divergence is defensible (the file's header
   comment argues for it) but it should be decided deliberately, not inherited from a diff that
   happened not to touch the file. Because either outcome is organizer-visible F-101 behaviour, the
   approvals table below carries that decision as a prerequisite to any implementation approval.

**The trigger that should reopen this. There are two independent routes into the Q1 state, and an
earlier revision described only the first.**

**Route 1, rescoping an existing NULL, needs a conjunction.** Neither half alone is sufficient:

- **stored rows written while the narrower expression legitimately left a dependent NULL**: a row
  written under today's contract cannot supply the state on its own, because section 4 shows every
  asked non-nullable gate is populated on write; and
- **a later widening of that expression**, so a row's legitimate NULL is rescoped into
  in-scope-and-unanswered. A widening in a deployment holding no such rows has no old NULL to
  rescope, so it cannot supply the state on its own either.

**Route 2, a nullable gate, needs neither half and can produce the state on a newly created row,
but not for every gate, and an earlier revision of this section said it did.** It was missed by the
earlier framing and it is the shorter route where it is open at all. `validate.ts:299` raises
`required` only `if (!isProvided(submission, field.field) && !field.nullable)`, and `isProvided`
(`validate.ts:143-144`) counts an explicit `null` as not provided. So the moment a gate field
carries `nullable: true` in the registry, an in-scope gate may be submitted blank and `events.ts:151`
and `:164` write the column as `values[column] ?? null`.

**Where the route stops, and this is the correction.** Validation accepting the blank is not the
same as the row existing. The write sends SQL `NULL`, and seven of the ten gate columns are
`NOT NULL` in `events` (section 1's table, read from `information_schema.columns` against a live
database): `alcohol`, `amplified_sound`, `food_present`, `generator_present`, `headcount`,
`location_type` and `structure_types`. PostgreSQL rejects that INSERT, so the submission errors and
no in-scope-and-NULL row is created. Only `battery_present`, `obstructs_public_way` and
`sapo_event_type` can hold the state as the schema stands. Two intake-contract changes reach the
route, and they differ in what else they need:

- **marking an existing gate `nullable`**. This produces the persisted state by itself only for the
  three storage-nullable gates. For the other seven it also needs a forward migration relaxing the
  column, which is a change to a shared core table and carries its own review (`AGENTS.md:46-47`
  and the database-owner row of governance §6, as in the approvals table below); or
- **publishing an `asked_when` that references one of today's eight registry-nullable leaf fields**
  (`tent_area_sqft`, `tent_days_in_place`, `stage_height_ft`, `stage_area_sqft`,
  `generator_gasoline_gallons`, `generator_diesel_gallons`, `generator_kw`, `battery_system_kwh`),
  which turns a field that is already blank-able into a gate. All eight columns are nullable in
  `events`, so this form needs no migration and is the one route with nothing else in its way.

**Measured at the validator, source-traced past it.** The nullable-gate probe submitted a park event with
`structure_types: ["tent_canopy"]` and no `tent_area_sqft` to `validateIntake` against the v2.11
contract on a clean `c700698`. It returns `errors: []` and `values.tent_area_sqft === null`: an
in-scope registry-nullable field, left unanswered, accepted and carried into the record as `null`.
The probe stops there. It never calls the events router and never executes an INSERT, so "and the
row is created NULL" is read off `events.ts:145` and `:154` (every registry column written as
`values[column] ?? null`) plus the column's own nullability, rather than reproduced. `tent_area_sqft`
is nullable in `events`, so the inference holds for the field the probe used; it would not hold for
a `NOT NULL` gate column, which is the point above. Route 2's validator half is measured, its
persistence half is inferred, and the only thing today's registry withholds is
a gate in that position,
because none of the ten gate fields is `nullable` and none of the eight nullable fields gates
anything (section 1). What the engine then does with an in-scope NULL gate is not a new
measurement: it is the street-event case in section 2, where the dependents collapse to `false` and
four SAPO street permits go unnamed.

**The reopening trigger, restated to cover both routes:** whichever comes first of

- the first ruleset publication that **widens** any existing `asked_when` expression;
- the deployment **acquiring real event rows**;
- the first intake-contract change that **creates a nullable gate the schema can leave NULL**: route
  2's second form, or its first form on `battery_present`, `obstructs_public_way` or
  `sapo_event_type`, or its first form on any other gate **together with** a migration relaxing that
  column.

The first two are deliberately the weaker halves of route 1's conjunction rather than the
conjunction itself, which is a conservative choice and not a claim that either alone makes the
state reachable. The third is not a weakened half of anything, but it is narrower than an earlier
revision of this section claimed: a registry change alone makes the state reachable on newly created
rows for three of the ten gates, and for the other seven only in conjunction with a schema change.

**Only two of the three carry a reviewer, and an earlier revision said all three did.** A ruleset
publication that widens an expression is a rule-semantics change and a contract change that creates
a nullable gate is an Event Input/rules-schema change, so both land on §6's table and reach the same
reviewers who would have to weigh this document; where the third trigger also needs the column
relaxed, the migration adds the database owner on top, which is the same row the ruleset alternative
lands on. Row acquisition does not. Ordinary
`POST /api/events` traffic creates rows, and no §6 row governs a deployment receiving traffic it was
built to receive; nobody reviews anything when the first real row lands. So the second trigger can
fire with nobody noticing that it fired, and treating change approval as the mitigation for it is
wrong. If the team wants that trigger to be real it needs its own mechanism, an operational check on
the events table or a tracked decision point at the point real data is first accepted, and this
document does not create either. What it can do is record which of the three has a reviewer and
which does not.

### 6b. Q2, the gate answered `"unknown"`

**Also do not implement a change now, but on entirely different evidence, and the question is not
closed.** Section 2 summarises the three Q2 probes, whose harnesses were removed with the
appendices. They find:

- Q2 **is** reachable: the questionnaire offers `"unknown"` and the submission carries it (section
  2). Whether the row then stores it is neither measured nor traced here. Either way 6a's reason 1, which turns on a
  state no submission can express at all, does not apply to Q2.
- The prototype **does not address** Q2 at all, so 6a's reasons 2, 3 and 4, which
  are all statements about that prototype, do not apply to it either.
- The silent-omission harm issue #108 describes **does not reproduce** on Q2: every requirement the
  scoping withholds is named in the branch table by its published label, on a plan the verdict marks
  CONDITIONAL.
- That branch table **reaches the screen**. The render probe ran the Q2 case through the shipped
  `VerdictDetailPanel` (section 2 names the renderer and the test that covers it) and reported four
  rows, one per known **alternate** `sapo_event_type` value rather than one per published value:
  the registry publishes five (`street_event`, `block_party`, `plaza_event`, `other_sapo_class`,
  `unknown`) and `alternativeValues` (`packages/engine/src/verdict.ts:147-168`) drops both the
  current answer and `unknown` before rendering, which on a Q2 case is the same value twice. The
  four street-size permits are named by their organizer labels in the `street event` row. The table
  therefore covers the alternatives an organizer could switch to, not the full published value set.
  This is no longer an inference from engine output, though re-deriving it means recovering the
  harness from the archive branch.
- The organizer **can enter it**. The questionnaire probe walked the same case through the shipped
  `IntakeForm` (section 2): with
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
neither exercised nor traced here. A reader who wants the recommendation to rest on a product-path
run rather than on three isolated probes should treat that as the outstanding measurement it is.

**So: keep issue #108 open, and do not close it as won't-fix or as answered by this document.** Two
measurements an earlier revision made preconditions for a Q2 decision have now been run: the plan
rendering (section 2) and the questionnaire (section 2). Neither moved the recommendation. Each
strengthened it in the same direction, by replacing an unrun measurement with a measured one at the
point it covers. Two things are still outstanding on Q2, and they differ in kind: the product-path
run just described, which a measurement would settle, and whether a branch table is adequate
presentation, which no measurement settles.

**What I am explicitly not recommending, and why. Re-priced at v2.11 rather than cited from v2.8.**
I am not recommending the ruleset alternative (converting the five boolean gates to enums carrying
`unknown`) either. The earlier document priced it on `481e1f6` at nyc.v2.8, and this brief rejects
the option on that price, so the price was re-derived on `c700698` at nyc.v2.11 on 2026-08-03 rather
than carried forward with a disclaimer. The method is a walk over every top-level ruleset array
whose members carry an `id`, plus a scan of the test tree for boolean literals submitted for those
five fields. Run against the v2.8 artifact and the v2.8 tree it reproduces the earlier document's
figures exactly (8, 11 objects, 12 conditions, 132 literals), which is what makes the v2.11 figures
below comparable rather than a different count of a different thing.

| component                                            | v2.8 (`481e1f6`) | v2.11 (`c700698`)                |
| ---------------------------------------------------- | ---------------- | -------------------------------- |
| `asked_when` expressions to rewrite                   | 8                | **7**                            |
| published objects carrying a boolean trigger condition | 11               | **16**                           |
| trigger conditions in them                            | 12               | **17**                           |
| `validate.ts` checks at risk of silent non-matching   | 2                | 2                                |
| fixture boolean literals to convert                   | 132              | **147**                          |
| ruleset publication and forward migration on `events` | both required    | both required                    |
| answer-key impact                                     | unmeasured       | still unmeasured (section 7 item 3) |
| gates the option reaches                              | 5 of 8           | 5 of 8                           |

What moved, and why:

- **8 to 7 expressions.** `food_affinity_private_exception_claimed` carried one of the eight and
  v2.9 removed the field (section 1). The remaining seven are `food_vendor_count`,
  `sound_audible_from_public_way`, `generator_gasoline_gallons`, `generator_diesel_gallons`,
  `generator_kw`, `battery_system_kwh` and `venue_license_covers_event_area`.
- **11/12 to 16/17 objects and conditions.** Five `CONF-NO-*` rules published between v2.8 and
  v2.11 (`CONF-NO-FOOD-001`, `CONF-NO-AMPLIFIED-SOUND-001`, `CONF-NO-GENERATOR-001`,
  `CONF-NO-BATTERY-001`, `CONF-NO-ALCOHOL-001`) each compare one of the five fields to `bool false`.
  The earlier count was taken before they were published; it did not miss them.
- **132 to 147 literals.** 127 named literals across the same eight files, up from 112, plus the
  same 20 positional SQL values in the five `ruleset.test.ts` event inserts, which are unchanged.
  The suite grew from 1163 tests to 1577 over the same interval.

**What the new price decides: the same rejection, on a wider margin.** One component got smaller by
one expression and two got materially larger, so nothing here is a case for taking the option that
the stale figure was hiding. The number this brief now rejects it on is 7 expressions, 16 published
objects carrying 17 trigger conditions, 2 validator checks, 147 fixture literals, a ruleset
publication and a forward migration on `events`, still reaching 5 of the 8 gates that need it. Two
limits on that re-pricing, stated rather than implied: it does not measure the answer key, which
section 7 item 3 still records as unmeasured, and it prices only the conversion of the five
booleans, not the three gates the conversion cannot reach.

Separately from the price, and decidable from section 2's corrected inventory:
the alternative converts booleans, and only five of the eight gates that lack a published `unknown`
are booleans. `headcount` (integer), `location_type` (enum) and `structure_types` (multi-enum) are
not reachable by a boolean-to-enum conversion at all, so whatever that route costs, it does not
close the gap on those three.

### Approvals this decision would require

Under `docs/DOCUMENTATION-GOVERNANCE.md` §5 and §6:

| If the team decides to                    | Row of the §6 table                                                                                                                                                                                                                                                                                                                                                                                                                  | Required approval                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Implement the tri-state semantics         | **§5 first** (the `F-201:48` reading is unresolved, section 7 item 1), then "Rule trigger, dedupe, branch, deadline, or formula semantics", **plus "Product scope, feature meaning, phase" for the undecided questionnaire-scoping question (section 6a item 4, section 7 item 2), and again if resolving `F-201:48` changes what that approved spec requires**                                                                                          | **Two prerequisites ahead of the signatures below: resolve `specs/F-201-permit-plan-generator.md:48` under §5, and obtain the product owner/team decision on whether the questionnaire follows the engine into three-state.** Only then verification owner (Dev 4) plus engine owner (Dev 1); plus the product owner/team decision a second time if the F-201 resolution moves that spec's scheduled behaviour                                                                                                                              |
| Add fixtures distinguishing the semantics | "Executable regulatory expectation" is an approved fixture (§1); the answer key is APPROVED                                                                                                                                                                                                                                                                                                                                          | Both prerequisites and the same pair, plus the answer key's own revision authorization                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Take the ruleset alternative              | Regulatory source/status/content **and** rule semantics **and** shared enum **and** database migration touching shared/core tables                                                                                                                                                                                                                                                                                                   | Verification owner plus rules reviewer, plus engine owner, plus all affected lane owners and the architecture owner for the shared enum, **plus the database owner** for the migration                                                                                                                                                                                                                                                                                                                                                    |
| Do nothing (this recommendation)          | none                                                                                                                                                                                                                                                                                                                                                                                                                                 | none; the issue stays open                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |

**The `F-201:48` question is a prerequisite, not a detail, and an earlier revision of this table got
that wrong by listing only the two owners.** Section 7 item 1 says the brief cannot determine
whether the approved sentence at `specs/F-201-permit-plan-generator.md:48` ("a field never asked is
not a material unknown") forbids the tri-state behaviour. Section 5 gives a reading on which it does
not, and says the engine owner should be the one to rule; that is still my reading and it is not a
resolution. Governance §1 makes an approved `specs/F-xxx-*.md` authoritative for scheduled feature
behaviour, and `AGENTS.md:17` and governance §5 say what happens when an artifact in that position
is contradictory or unclear: stop the affected implementation, record a `SPEC-CONFLICT` with both
locations and the user-visible consequence, and **resolve the source artifact first**. §5 also names
what must not happen, that a contributor "silently select the version they prefer". Two lane owners
picking a reading of an approved spec between them is exactly that, so the verification and engine
signatures cannot be the mechanism that settles it. If the resolution turns out to change what F-201
requires rather than just to state which reading was always meant, §6's "Product scope, feature
meaning, phase" row adds the product-owner/team-decision capacity on top. This document does not
resolve `F-201:48`, does not decide which of the two routes the resolution takes, and records no
approval of either.

**The second prerequisite is the questionnaire-scoping decision, and an earlier revision of this
table let the row authorise implementation without it.** Section 6a item 4 and section 7 item 2
record it as unresolved: attempt B changes the engine's scoping and leaves `visibility.ts`
two-state, so the engine would call a dependent's scope unknown and material while the form does not
ask it and `validate.ts` rejects an answer to it. Either outcome is organizer-visible F-101
behaviour, whether the divergence is accepted deliberately or the questionnaire is changed to follow
the engine, so it is "Product scope, feature meaning, phase" under §6 and the product owner/team
decides it. It also fixes the implementation's size: while it is open, attempt B's two-file diff is a
lower bound rather than a scope. That is why it belongs in the prerequisite column and not in the
caveats: a row that sequences only the `F-201:48` question authorises shipping while a controlling,
organizer-visible behaviour is still undecided. **This document does not decide it, does not state a
preferred outcome, and records no product-owner approval of either.**

**An earlier revision of this table carried a third prerequisite, a §5 reconciliation of the
architecture boundary at `docs/ARCHITECTURE.md:83`, and it is removed here because the conflict it
named does not exist.** That line reads: "Unknown-capable active fields use explicit `unknown`
values, never NULL-as-unknown." It sits in the `events` column description and governs how an
answer is stored, and attempt B does not store anything: `blockersFor` records a blocker exactly
when the raw value is `undefined` or `null`, which treats the NULL as unanswered and propagates
tri-state uncertainty from it, rather than reading it as the organizer's explicit `unknown` answer.
The two stay distinct in attempt B's own measured behaviour: section 2's Q2 engine probe shows an
explicit `"unknown"` scoping the four SAPO dependents out and producing a byte-identical plan on
both trees, while section 2's street-event case, where `obstructs_public_way` is left NULL, is the
one that moves, from 9 findings to 20. Two approved
artifacts confirm that reading is the intended one. `docs/EVENT-REVISION-CONTRACT.md:246-248`
requires that "legacy unanswered/`NULL`, explicit `unknown`, `false`, and other concrete values
remain distinct", which is a distinctness requirement rather than a bar on deriving uncertainty from
a NULL, and `docs/ARCHITECTURE.md:249-250`, in the tri-state condition-evaluation section, already
publishes evaluation deriving `unknown` from a NULL answer ("Null numeric answers on a selected
structure/generator evaluate `unknown`, not `false`") for the numeric case. So there is no
contradiction to record and no ADR capacity to add, and the row above is back to the semantics
signatures plus the two prerequisites it does name.

**What would bring that prerequisite back.** An implementation that collapses the two
representations rather than keeping them distinct: normalising or backfilling a NULL gate to the
published `"unknown"` value on write, reading a raw NULL as that answer so the two produce the same
scoping (for `sapo_event_type`, dependents scoped out rather than branched), or any change that
makes the stored states indistinguishable to a reader. Any of those contradicts
`ARCHITECTURE.md:83` and `EVENT-REVISION-CONTRACT.md:246-248` directly, and then §5 applies in full
and the architecture owner's ADR approval returns with it. Attempt B as measured does none of them,
which is a statement about the prototype this document measured and not a guarantee about an
implementation nobody has written yet.

**The database-owner row is not optional and is not held.** The ruleset alternative converts gate
columns in `events` from `boolean` to text carrying `"unknown"`, which is a forward migration on a
shared core table. `docs/DOCUMENTATION-GOVERNANCE.md:96` requires "Database owner plus all affected
lane owners" for that class, separately from the shared-enum row, and an earlier revision of this
table named only the lane and architecture owners. `docs/DESIGN.md:73` puts DB migrations in Dev 4's
lane, so the database owner and the verification owner are the same person here, which is exactly
why the capacity has to be named separately rather than assumed covered by the verification
signature already in the row. No such approval has been given, and nothing in this document should
be read as recording one. `AGENTS.md:46-47` is the standing constraint on the
same table: the `events` schema migration is the four-lane contract, PR #137's one-time overwrite is
the sole recorded exception and creates no precedent, and every later change requires the normal §6
team decision.

`AGENTS.md` states the semantics requirement from the other direction: "Rule-semantics changes also
need the engine owner's (Dev 1) review." Per `docs/DESIGN.md:70` and `:73`, Dev 1 owns engine
fidelity to the ruleset and the fixture suite, and Dev 4 owns verification sign-off. This document
holds none of the approvals in the table above and implements nothing.

## 7. What could not be determined

Stated plainly rather than left as silence:

1. **Whether the engine owner reads `F-201:48` as forbidding the change.** Section 5 gives my reading
   and the reason for it. It is a spec-interpretation call and it is theirs, not mine. Because
   `F-201` is approved and authoritative for scheduled feature behaviour (governance §1), §5 makes
   resolving it the first step rather than a parallel one, and section 6's approvals table states it
   as a prerequisite to any implementation approval.
2. **Whether the questionnaire should follow the engine into three-state.** Section 6a item 4. This
   is a product and UX decision as much as an engine one, and no artifact in the repo answers it.
   Until it is answered, `visibility.ts` stays in scope for any Q1 implementation and attempt B's
   two-file diff is a lower bound on implementation size. Section 6's approvals table carries it as
   a prerequisite under §6's "Product scope, feature meaning, phase" row, ahead of the verification
   and engine-owner signatures.
3. **The ruleset alternative's answer-key impact.** Unmeasured here and unmeasured in the earlier
   document. Measuring it requires converting the 147 fixture literals section 6b re-prices at
   v2.11 first, because `readFieldValue`
   rejects a boolean for an enum field, so every scenario fails validation before any answer key is
   reached. I did not do that work and I do not have a number for it.
4. **Whether attempt B is correct across the gate inventory and across grammars the current ruleset
   does not use.** Two separate gaps, both unmeasured. First, the published `asked_when` grammar is
   conjunction-only, so attempt B's three-valued handling was exercised against conjunctions and
   nothing else; a future ruleset introducing disjunction or negation at the expression level would
   need the same analysis redone. Second, and nearer to hand: no run in this document omits
   `structure_types`, the only multi-enum among the ten gates, so attempt B has never been measured
   with a multi-enum as the blocking gate. The source trace of why that path looks unsafe (scalar
   branch candidates meeting `contains` conditions) went with the appendices and is not reproduced
   here; what stands is that neither the failure nor its absence has been reproduced. Until it is,
   the 1577/1577 result and the diff-size figure are claims about the measured inputs, not about a
   correct implementation.

   **Third, and unlike the other two this one is demonstrable from source rather than unmeasured:
   attempt B leaves the branch table unable to express the explicit-`unknown` path on the two gates
   that publish one.** Take a Q1 intake with `obstructs_public_way: "yes"` and `sapo_event_type`
   unanswered. Attempt B promotes `sapo_event_type` to a blocker (its rule is the raw value being
   `undefined` or `null`) and then reaches the unchanged branch expansion at
   `packages/engine/src/verdict.ts:272-306`, which enumerates candidates through `alternativeValues`.
   That filter, at `packages/engine/src/verdict.ts:154-160`, drops a declared value when
   `value !== intake[field]` fails **or** when the value is `UNKNOWN_ANSWER` and
   `RESCOPE_EXCLUDES_UNKNOWN_VALUES` is set, and that constant is `true`
   (`packages/engine/src/proposals.ts:166`). The second test does not consult the current value, so
   the published `"unknown"` is stripped even though the raw value here is `null` and `"unknown"` is
   therefore a value the organizer could still give. The four enumerated branches are
   `street_event`, `block_party`, `plaza_event` and `other_sapo_class`; the omitted fifth has
   behaviour none of them has, because it scopes all four size/class dependents out
   (`street_event_size`, `plaza_level`, `plaza_multiple_blocks`, `has_amusement_ride`, whose
   `asked_when` expressions each name a specific class), which is the same scoping section 2's Q2
   engine probe measured. Since the branch signatures and path verdicts at `verdict.ts:298-300` are
   computed over the enumerated branches only, agreement across them can be reached, and the unknown
   called immaterial, without the valid explicit-`unknown` path ever being considered.
   `obstructs_public_way` is the other gate publishing `"unknown"` and sits in the same position at
   the filter. The constant's own rationale (`proposals.ts:140-165`) is about rescope suggestions,
   where "telling an organizer to un-know a fact is not a rescope" and `unknown` is correctly never
   suggested; the branch table is the other caller and does not carry that justification when the
   field is unanswered. This is recorded, not fixed: nothing in `packages/engine` is changed here,
   and any fix is a branch-semantics change under §6 with the approvals section 6 names. What it
   removes is the framing that the unresolved current-gate risk is `structure_types` alone.
5. **Whether any state, migration or fixture in a lane I did not run could reach the unanswered
   state.** I ran the full 1577-test suite against a live database, which covers every suite in the
   repo. I did not audit the seed or demo tooling.
6. **Whether Q2's branch-table presentation is adequate** (section 2, section 6b). Three points on
   the path are measured: the questionnaire asks `sapo_event_type` and offers `"unknown"` as "I
   don't know", the engine scopes the four dependents out on that value, and `VerdictDetailPanel`
   renders the four street permits on screen by their published labels. What remains undetermined
   is the judgement, whether a branch table is the right place for them or whether they belong on
   the plan lines as `may_be_required` findings, and that is a product and engine-owner call rather
   than a measurement.
7. **Whether the Q2 path holds together end to end when actually run.** Separate from item 6 and
   settleable by measurement, which item 6 is not. The questionnaire probe fakes `fetch`, the engine
   probe calls `evaluate` directly and the render probe renders a plan object in isolation (all three
   harnesses went with the appendices), so the API validation, the `events` insert, plan
   generation from the stored row and retrieval back into the page are neither exercised nor traced
   here. Nothing measured here suggests they fail; nothing here shows they do not.
8. _(Withdrawn.)_ An earlier revision listed the reconciliation of `docs/ARCHITECTURE.md:83`
   against a NULL-as-materially-unknown semantics here, and section 6's approvals table carried it
   as a §5 prerequisite. Both are removed: that line governs storage, attempt B keeps unanswered and
   explicit `unknown` distinct, and the approved contracts cited in section 6 say the two must stay
   distinct rather than that uncertainty cannot be derived from a NULL. Section 6 states what would
   have to be true for the prerequisite to come back. The numbering is kept so earlier
   cross-references do not silently point at a different item.
