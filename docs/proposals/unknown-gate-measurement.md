# Measuring issue #108's actual question: a gate ANSWERED "unknown"

**Status:** PROPOSED

This document is a MEASUREMENT. It proposes no change, recommends no option and does not decide
issue #108. The branch carrying it contains no rule, ruleset, spec, answer-key, manifest or engine
change.

Measured at `bd8d05e`, ruleset `nyc-rules.v2.8.json`, Node v24.18.0, suite size 1196. Later rounds'
corrections were re-measured on the rebased branch at suite size 1356 against the same ruleset:
round 4's `readChecked` runtime measurement in R3, the branch-versus-threshold split in R5 and the
enumerable recount there; round 5's rebuilt S2/S3 probe, the numeric recount in R5, and the trigger
propagation table in S4; round 6's two-rule split in S2/S3, the `plaza_level` recount in R5, and the
persistence measurement below; round 7's surfacing-versus-silence separation in S4 and the four
answer states measured there; round 8's AC 6 split in R3, the `DOB-TENT-001` correction in R5, and
the live restatement of both conditions in S4; round 9's level-field finding-set diff in S4 and the
answer-key confirmation in R1; round 10's provenance diff in S4, the authority order in R1, and the
per-measurement method table below; round 11's row-by-row walk of that table; round 12's envelope
audit and re-measured render; round 13's two-field restatement in section 2, the food prerequisite
in section 1, and the walk arithmetic below; round 14's per-channel attribution in section 2 and the
conclusions sweep in sections 6, 7 and R6.

**What layer each result requires, and what the harness was where this document records it.** Five
statements of this have now been wrong, each in a different way, and the reason the last one failed
is worth stating before the table: it promised exact guard PROVENANCE for every measurement, and for
rounds 1 to 4 this document does not record the harness that produced each number. Provenance at
that granularity is not recoverable for those rounds without re-running them.

So the table below promises something weaker and exactly checkable instead: **the lowest layer each
stated result requires**, which can be verified from the result itself, plus the harness in the
cases where the document does record it (round 2's method header, section 4's own sentence, and
every measurement from round 5 on, which were run for these rounds).

**The walk, stated as arithmetic rather than as a number, because the number has now been wrong in
three consecutive rounds.** Round 11 reported nine walked above a table of eleven. Round 12 said two
of eleven moved and nine did not, then listed ten categories, one of which was a row that had
moved. Both failures were unverifiable from the text, so the accounting below names every row and
shows the sums.

**Total rows: 11**, numbered here in the order they appear in the table.

**Moved in the round-12 walk: 2.** Rows 5 and 6, and they are one correction rather than two: R5's
six-scenario table has a "Branch reasons on screen" column, which is a component-path result and was
sitting in the evaluation-only row. It left row 5 and joined row 6. R5 therefore joins R1 and R3 as
a section holding measurements of more than one kind, and being split once in round 9 did not make
it settled.

**Unchanged: 9.** Row 1 the parsed-ruleset row, row 2 the scope-resolution row, row 3 the
validator-only row, row 4 the fixture-reading row, row 7 R3's direct-parser row, row 8 the S2/S3
row, row 9 S4's per-rule row, row 10 the persistence row, row 11 the no-submission row.

**2 moved + 9 unchanged = 11 total**, and rows 5 and 6 appear in the moved list and in no other, so
the two lists partition the table. The four corrections round 11 made, from the previous walk, still
stand.

| Result                                                                                                                                                                                   | Lowest layer it requires                                                                                                                                                                                                                                                                                                             |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Section 1's gate, dependent and clause columns; section 3's rule counts                                                                                                                  | the PARSED ruleset (`parseEngineRuleset`, `parseIntakeContract`). No submission.                                                                                                                                                                                                                                                     |
| Section 1's `"unknown"` holds and dependents-scoped-out columns; section 3's "leaves scope" claim                                                                                        | scope resolution over an intake (`createScopeResolver`, `termHolds`). No `evaluate`.                                                                                                                                                                                                                                                 |
| Section 1's `"unknown"` acceptance results; **R5's two recounts** (the 8 non-nullable enumerable fields, and `headcount` and `food_vendor_count`)                                        | `parseIntakeContract` -> `validateIntake` ONLY. Most of these probes are REJECTED by the validator, which IS the result; they never reach `evaluate`.                                                                                                                                                                                |
| Section 4's per-scenario answer table                                                                                                                                                    | reading `SCENARIO_INTAKE_FIXTURES` through `fixtureSubmission`, as section 4 states. No validator, no engine.                                                                                                                                                                                                                        |
| Section 2; **R5's per-scenario missing-fact and branch-count columns** and its `plaza_level` and `DOB-TENT-001` results; R3's AC 6 split; S4's plan-level results and diffs              | `parseIntakeContract` -> `validateIntake` -> `evaluate`. R5's `DOB-TENT-001` result pairs an evaluated finding with a read of `plan-line.tsx`.                                                                                                                                                                                       |
| **R1's Scenario F block** (verdict, missing-fact and branch counts, and the branch text absent from the screen); R2; R3's "On screen" column; **R5's "Branch reasons on screen" column** | the component path: `PlanView` rendered with `@testing-library/react` and a stubbed `fetch` in the page's three-call shape, over a plan body from `validateIntake` -> `evaluate`, per round 2's method header. `apps/api/src/plan.ts` is NOT in the loop; the stub stands in for it, and the stub envelope is the one audited below. |
| R3's runtime member measurement                                                                                                                                                          | `evaluate`, then a JSON round trip, then the web's own parser (`readChecked`, `arrayOf`, `shapedLike`) called directly. No component is rendered.                                                                                                                                                                                    |
| S2, S3                                                                                                                                                                                   | `parseEngineRuleset` -> `parseIntakeContract` -> `validateIntake` -> `evaluate`                                                                                                                                                                                                                                                      |
| S4's per-rule tables                                                                                                                                                                     | `evaluateTrigger` and `evaluateCondition` called directly, because per-rule `unknownFields` and `triggeredBy` are not observable from the plan                                                                                                                                                                                       |
| S2's persistence result                                                                                                                                                                  | a direct `INSERT` against the migrated `events` table                                                                                                                                                                                                                                                                                |
| **R1's artifact reading** (F-102, the answer key, the authority hierarchy, governance section 2); R4; sections 5, 6 and 7                                                                | no submission. R4 is a repo-wide search for a renderer, and section 5's layer table is read from the code.                                                                                                                                                                                                                           |

Three consequences that were previously implied or wrong, stated instead:

- **`apps/api/src/plan.ts` is not exercised at runtime by anything here.** Rounds 4 to 9 listed it in
  the chain; R2 stubs `fetch` and section 5 reads it. Nothing is stored and reloaded, so nothing
  exercises persistence either.
- **R1, R3 and R5 each contain measurements of more than one kind**, which is what defeated the
  single-row-per-section versions in rounds 9 and 10.
- **A validator-only result is a real result** and not the same claim as an evaluated one. The
  recounts establish that those fields cannot reach `evaluate` at all.

**Audit of the one stubbed envelope in this document, because a setup that asserts something untrue
is the same failure as the fabricated probe.** The component-path measurements are the only ones fed
by a hand-built stored-plan envelope. **Restricting that to what it covers, because the table above
already says the rest:** among the measurements that consume a plan payload at all, rows 5 and 7,
none uses a stub. Row 5 reads `evaluate` output directly and row 7 JSON round-trips real
`missingFacts` with nothing added. The other rows consume no plan payload, so the question does not
arise for them: rows 1 and 4 read artifacts, row 2 resolves scope, row 3 stops at the validator, row
9 calls `evaluateTrigger` directly, row 10 is a database `INSERT`, and row 11 measures no submission.
This is the fourth time a global sentence about provenance has contradicted the table, and it is the
last one in the document: everything else that was said globally is now said per row. Two defects were
found in that envelope and both are fixed:

1. **An ordering the product cannot produce.** Round 2's envelope carried
   `generatedAt: 2026-07-25` beside `snapshotDate: 2026-07-26`, so the rendered header read
   "published July 26, 2026" above "generated 2026-07-25". `insertPlan` writes the LOADED ruleset's
   `snapshotDate` (`apps/api/src/plan.ts:242`) and takes `generated_at` from the database at insert
   (`RETURNING generated_at`, `:147`), so a plan generated from the published v2.8 artifact cannot
   predate it. No clock condition rescues the ordering either: `rules/nyc-rules.v2.8.json` was added
   to the repository on 2026-07-26, its own snapshot date, so on 2026-07-25 there was no v2.8 to
   load.
2. **A member the API always supplies and the stub omitted.** `apps/api/src/plan.ts:254-256` maps
   every finding through `lastVerifiedDate: finding.lastVerifiedDate ?? null`, and the engine leaves
   the member absent on rules that publish no verification date. A stub built straight from
   `evaluate` output is REJECTED by `plan-api.ts`'s `nullOr(isString)` check and the page renders
   "The API returned a plan this page cannot read." So the envelope has to normalise it the way the
   API does.

**Re-measured with a reachable envelope.** Same submission shape, `lastVerifiedDate` normalised, and
`generatedAt` set to 2026-07-25 (the impossible one), 2026-07-26 (the earliest reachable) and
2026-07-28. The rendered result is identical in all three except the date string itself:

```
Your permit plan
Rules snapshot nyc.v2.8 · published July 26, 2026
Depends on: sapo event type · generated 2026-07-26 · revision 1
```

`Depends on: sapo event type` with no branch reasons, collapsed or expanded, at every date. So the
rendering conclusion did not depend on the impossible input, which is worth saying explicitly rather
than leaving the reader to assume it.

**One precision the re-measurement adds.** R2 says the `plaza_level` line reaches the screen
verbatim. It does, but only inside the per-finding "Details for ..." disclosure: with the panel
collapsed there are zero `.line__timeline` nodes in the document, and expanding the five disclosures
produces exactly one, reading "the plan was never asked plaza_level, which this deadline keys on".
The branch reasons stay absent in both states.

**The S2/S3 probe passes four guards and cannot pass persistence.** It passes `parseEngineRuleset`,
`parseIntakeContract`, `validateIntake` and `evaluate`, which rounds 3 and 4 could not because their
probe invented its rules and `parseIntakeContract` rejected it. It cannot pass PERSISTENCE:
`events.generator_present` is `boolean, notNull` and Postgres rejects `"unknown"` outright (S2), so
no stored event can carry this state and `apps/api/src/plan.ts` can never reload one. S3 is a
contract-and-engine result, not an end-to-end product one. Round 5 called those four checks the full
guard chain, which is the same kind of over-broad methodology claim round 4 made one layer in, and
round 8 found a third variant of it in the word "every"; hence the table above.

PR #167 measured a gate that was legitimately NOT ASKED because its parent held a different value.
This measures a gate that was ASKED and ANSWERED `"unknown"`, which is the case issue #108's title
describes.

---

## Summary

**The scoping mechanism is real. The invisibility is not.**

The proposed mechanism was that a gate answered `"unknown"` fails every `termHolds` clause kind, its
dependents are never added to the asked set, the dependent resolves `not_asked`, the condition
returns `false` before any operator runs, and the requirement disappears **with no unknown, no
finding and no visible trace**.

The first four steps hold for exactly one gate. The fifth does not hold at all on v2.8.

1. **"Fails every clause kind" is false.** `termHolds` handles `!=` as
   `answer !== null && answer !== term.value`, so `"unknown" != "no"` is TRUE. Two of the three
   gates that declare `unknown` gate their dependents with `!=`, and their dependents stay in scope.
2. **One gate does scope its dependents out**: `sapo_event_type`, whose four dependents all use
   `compare` with `=`. `"unknown" === "street_event"` is false, so all four leave scope.
3. **The requirement does not vanish silently.** Answering `sapo_event_type: "unknown"` on a street
   event turns the verdict CONDITIONAL, names `sapo_event_type` as a missing fact, and publishes a
   branch table that names the lost rules explicitly, including `SAPO-STREET-LARGE-001`.

So the harm issue #108 names, a false negative on a permit requirement with no trace, **is not
reachable on the published ruleset**. What is reachable is a weaker version: the specific
requirement is replaced by a conditional branch entry, and the branch entry does not reach the
organizer's screen.

---

## 1. Which gates can be answered "unknown", and what happens to their dependents

Ten registry fields declare `unknown` among their values. Only three of them are gates, meaning
they appear in another field's `asked_when`:

| Gate                   | Dependents                                                                        | Clause              | `"unknown"` holds? | Dependents scoped out? |
| ---------------------- | --------------------------------------------------------------------------------- | ------------------- | ------------------ | ---------------------- |
| `obstructs_public_way` | `sapo_event_type`                                                                 | `compare != no`     | **yes**            | no                     |
| `event_open_to_public` | `food_affinity_private_exception_claimed`                                         | `compare != yes`    | **yes**            | no                     |
| `sapo_event_type`      | `street_event_size`, `plaza_level`, `plaza_multiple_blocks`, `has_amusement_ride` | `compare = <value>` | no                 | **YES, all four**      |

The other seven fields that declare `unknown` gate nothing: `street_event_size`, `plaza_level`,
`food_affinity_private_exception_claimed`, `sound_audible_from_public_way`,
`structure_over_10ft_tall`, `venue_license_covers_event_area`, `venue_has_assembly_approval`.

`validateIntake` accepts `"unknown"` for all three gates, because it is a declared value and
`readFieldValue` checks membership. One interaction worth recording, found by measuring rather than
by reading: answering `event_open_to_public: "unknown"` can make
`food_affinity_private_exception_claimed` REQUIRED, because the `!=` clause widens scope rather than
narrowing it.

**The prerequisite matters and round 1 left it out.** That dependent's `asked_when` is
`food_present AND event_open_to_public != yes`, so the gate's unknown only pulls it into scope when
food is present. Measured both ways, with the dependent omitted:

```
food_present=false, event_open_to_public="unknown": ACCEPTED
food_present=true,  event_open_to_public="unknown": REJECTED
  food_affinity_private_exception_claimed: required
```

So the behaviour is conditional, not universal: on a submission with no food the gate's unknown
changes nothing about what is required.

**So the mechanism's blast radius is one gate, not the registry.**

## 2. What the plan actually does when `sapo_event_type` is "unknown"

Two submissions, both through `validateIntake` and `evaluate`, on a street event large enough that
`SAPO-STREET-LARGE-001` fires when the type is answered.

**They differ in two fields, not one, and they have to.** Round 1 described this as a one-field
variation, which is not a submission `validateIntake` accepts: `street_event_size` is asked only
when `sapo_event_type = street_event`, so retaining `"large"` beside the unknown gate is rejected.
Measured:

```
unknown gate, street_event_size retained as "large":
  REJECTED street_event_size not_applicable
  "street_event_size is only asked when sapo_event_type = street_event;
   remove it or change the answer that triggers it"
```

So the unknown submission also nulls `street_event_size`. That is the mechanism under test rather
than a confound, and it is worth naming as an input change rather than leaving it implicit: the
scoped-out dependent must be withdrawn for the submission to be valid at all, which is the same
`asked_when` scoping the section is measuring. The other three dependents `sapo_event_type` gates
(`plaza_level`, `plaza_multiple_blocks`, `has_amusement_ride`) are unanswered in both submissions
here, and each is rejected `not_applicable` the same way if answered beside the unknown gate.

**Re-measured with the inputs stated exactly, and the finding-set diff does not change:**

```
A  sapo_event_type="street_event", street_event_size="large"
   FEASIBLE_AT_RISK, 2 findings: SAPO-INSURANCE-001, SAPO-STREET-LARGE-001
C  sapo_event_type="unknown",     street_event_size=null
   CONDITIONAL, 5 findings: ADV-SAPO-OTHER-CLASS-001, SAPO-BLOCK-PARTY-001,
   SAPO-BLOCK-PARTY-SPONSOR-001, SAPO-INSURANCE-001, SAPO-PLAZA-001

   dropped: ["SAPO-STREET-LARGE-001"]
   added:   ["ADV-SAPO-OTHER-CLASS-001","SAPO-BLOCK-PARTY-001",
             "SAPO-BLOCK-PARTY-SPONSOR-001","SAPO-PLAZA-001"]
```

|                              | `sapo_event_type: "street_event"`, `street_event_size: "large"` | `sapo_event_type: "unknown"` |
| ---------------------------- | --------------------------------------------------------------- | ---------------------------- |
| accepted by `validateIntake` | yes                                                             | yes                          |
| verdict                      | `FEASIBLE_AT_RISK`                                              | **`CONDITIONAL`**            |
| findings                     | 2                                                               | **5**                        |
| `SAPO-STREET-LARGE-001`      | present, required                                               | **absent from findings**     |

Rules that appear only in the unknown case: `SAPO-BLOCK-PARTY-001`,
`SAPO-BLOCK-PARTY-SPONSOR-001`, `SAPO-PLAZA-001`, `ADV-SAPO-OTHER-CLASS-001`, all
`may_be_required`.

**The lost rule is named in the plan.** `verdictDetail.missingFacts` carries:

```
{ "field": "sapo_event_type",
  "branches": [
    { "value": "street_event",     "verdict": "CONDITIONAL",
      "reason": "adds SAPO-STREET-LARGE-001, SAPO-STREET-MEDIUM-001, SAPO-STREET-SMALL-001,
                 SAPO-STREET-XL-001; drops ADV-SAPO-OTHER-CLASS-001, SAPO-BLOCK-PARTY-001, ..." },
    { "value": "block_party",      "verdict": "INFEASIBLE",  ... },
    { "value": "plaza_event",      "verdict": "CONDITIONAL", ... },
    { "value": "other_sapo_class", "verdict": "FEASIBLE",    ... }
  ] }
```

**Which channel names WHICH loss, because rounds 1 to 13 counted three and the count was wrong.**
Two other channels carry content, and neither carries THIS loss:

| Channel                     | What it names                                                                                                                                                                        |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `missingFacts` branch table | **the street-permit loss itself**: the `street_event` branch reason reads "adds SAPO-STREET-LARGE-001, SAPO-STREET-MEDIUM-001, SAPO-STREET-SMALL-001, SAPO-STREET-XL-001; drops ..." |
| `unresolvedTimelines`       | **a different rule's different loss**: `SAPO-PLAZA-001` could not date itself because `plaza_level` was not asked. Real, and not about the street permit.                            |
| `trace`                     | **nothing about either.** It records `SAPO-STREET-LARGE-001` as `false`, which is what it records when the rule genuinely does not apply.                                            |

The `trace` row is measured rather than argued. Answering the gate `street_event` with
`street_event_size: "small"`, where the large-event permit genuinely does not apply, gives:

```
A  street_event + "small"   trace[SAPO-STREET-LARGE-001] = {"result":"false"}   FEASIBLE
C  gate "unknown"           trace[SAPO-STREET-LARGE-001] = {"result":"false"}   CONDITIONAL
```

Byte-identical. The trace cannot distinguish a requirement lost to an unknown gate from one that
does not apply, which is the same thing S3 measures on the synthetic probe. So **exactly one channel
names the street-permit loss**, and the earlier "three channels" figure counted a different rule's
timeline and a trace entry that carries no information about the loss at all.

**Why this works, and what it depends on.** `sapo_event_type` is itself referenced by rule triggers,
so a rule condition on it resolves to an explicit unknown, the field enters `unknownFields`, and
`evaluateConditional` branches over its declared values. The branch table exists because the gate is
visible to the trigger layer, not because the scoping layer reported anything. The scoping layer
reports nothing; `askedFields` returns a set with no record of what it excluded or why.

Being read by a trigger is necessary but not sufficient, which S4 measures per rule: five of the
eleven rules that read `sapo_event_type` here contribute nothing to `unknownFields`, and the four
SAPO-STREET rules that are actually lost are among them.

## 3. Blast radius

**5 published rules** reference a field that leaves scope when `sapo_event_type` is answered
`"unknown"`:

- `SAPO-STREET-LARGE-001`, `SAPO-STREET-MEDIUM-001`, `SAPO-STREET-SMALL-001`, `SAPO-STREET-XL-001`
  (all reference `street_event_size`)
- `SAPO-INSURANCE-BLOCK-PARTY-RIDE-001` (references `has_amusement_ride`)

No advisory is affected. `plaza_level` and `plaza_multiple_blocks` are referenced by no rule
trigger; `plaza_level` is read by `SAPO-PLAZA-001`'s deadline, which is why its absence surfaces as
an unresolved timeline rather than as a missing rule.

The other two `unknown`-declaring gates contribute **0** rules, because their `!=` clauses keep
their dependents in scope.

## 4. The six approved scenarios

**None of the six answers a gate `"unknown"`.** Measured by reading
`SCENARIO_INTAKE_FIXTURES` through `fixtureSubmission`:

| Scenario | `sapo_event_type` | fields answered `"unknown"`                                                                                                                  |
| -------- | ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| A        | `street_event`    | none                                                                                                                                         |
| B        | not asked         | none                                                                                                                                         |
| C        | not asked         | none                                                                                                                                         |
| D        | `block_party`     | none                                                                                                                                         |
| E        | `plaza_event`     | `structure_over_10ft_tall`                                                                                                                   |
| F        | not asked         | `food_affinity_private_exception_claimed`, `sound_audible_from_public_way`, `venue_license_covers_event_area`, `venue_has_assembly_approval` |

Scenarios E and F answer five fields `"unknown"`, and **every one of them is a dependent that gates
nothing**. So no approved answer key depends on the behaviour measured here, and the question of
whether an answer key is "correct only for another reason" does not arise: the mechanism is not
exercised by any of the six.

## 5. Does "visible end to end" hold on this path

`AGENTS.md:28` states two things. The first is that `SOURCE_CONFIRMED`, `OFFICIAL_CONFLICT`,
`RESEARCH_REQUIRED` and `COVERAGE_GAP` stay visible end to end; **that clause is not engaged here**,
because no verification status changes when a gate is answered unknown. The second is "Never present
a partial plan as complete", and that is the clause this path tests.

Traced through the layers:

| Layer                          | What it carries                                                                                                                                                       |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `evaluate`                     | `CONDITIONAL`, missing fact `sapo_event_type`, branch table naming the four SAPO-STREET rules, unresolved timeline naming `plaza_level`, trace with `result: "false"` |
| `apps/api/src/plan.ts`         | persists and serves `verdictDetail` whole, including `missingFacts` and its branches                                                                                  |
| `apps/web/.../verdict-copy.ts` | renders `CONDITIONAL: sapo event type`                                                                                                                                |

**The clause holds.** The plan is not presented as complete: the verdict is CONDITIONAL and the
field the plan is waiting on is named on screen.

**What the organizer does not see is the branch table.** `verdictCopy` maps `missingFacts` to their
field names only, so the reason text naming `SAPO-STREET-LARGE-001` and the other three is served by
the API and not rendered by the plan view. An organizer who answers "I do not know what kind of
street event this is" is told the plan is conditional on that answer; they are not told that one
branch requires a large street event permit. That is a rendering gap rather than an engine one, and
it is the only part of the original concern that survives measurement.

## 6. What was refuted, precisely

Stated plainly because the request was to confirm or refute rather than to soften:

| Claim                                                                                         | Result                                                                                                                                                                                                                                                                                                                                                        |
| --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `termHolds` returns a plain boolean and a gate answered `"unknown"` fails every clause kind   | **Refuted.** `!=` holds on `"unknown"`. Two of three gates are unaffected.                                                                                                                                                                                                                                                                                    |
| `askedFields` never adds the dependent                                                        | **Confirmed**, for `sapo_event_type`'s four dependents only                                                                                                                                                                                                                                                                                                   |
| The dependent resolves `not_asked` and the condition returns `false` before any operator runs | **Confirmed.** The trace records `SAPO-STREET-LARGE-001` as `false`.                                                                                                                                                                                                                                                                                          |
| The requirement disappears with no unknown, no finding and no visible trace                   | **Refuted, but by one channel rather than three.** An unknown is present (verdict CONDITIONAL) and findings are added rather than only removed, and the branch table names the lost rules explicitly. It is the ONLY channel that does: `unresolvedTimelines` names a different rule's loss and `trace` is byte-identical to a genuine non-match (section 2). |

**The scoping layer is silent; the plan is not.** `askedFields` genuinely discards the information
that a dependent was excluded and why, which is the defect issue #108 describes. On v2.8 the verdict
machinery independently reconstructs the consequence, because the same gate that scoped the
dependents out is itself an explicit unknown that rules read. The two facts are separate, and the
second is what prevents the harm today.

## 7. What this measurement does not establish

- ~~**It does not test a gate that scopes dependents out and is invisible to the trigger layer.**~~
  **Superseded by round 3.** Round 1 called this a question about a ruleset that does not exist and
  offered a code reading in place of a measurement. S1 to S5 measured it, on a probe whose `rules`,
  `advisories` and `config` are the published file byte for byte, and the answer is yes: the
  requirement is lost with no missing fact, no branch and no unresolved timeline (S3). The published
  ruleset already carries scope-only gates, and `generator_present` is one (S2). The bullet is kept
  struck through rather than deleted so a reader who saw round 1 can see it was answered.
- **It does not measure PR #167's question**, which was a gate left unanswered rather than answered
  `"unknown"`. The two produce different engine states: unanswered reaches `resolveAnswer` as
  `state: "unknown", isExplicitUnknown: false`, while `"unknown"` reaches it as
  `isExplicitUnknown: true`, which is what lets a rule listing `unknown` among its accepted values
  be answered by it.
- **Every COUNT in rounds 1 and 2 is about v2.8**, not about the engine in general. Round 3's
  results are the other way round: S4's conditions are statements about the engine, and what is
  specific to v2.8 is which of them happen not to be reachable today (S4's three incidental
  safeguards).

## Reproduction

1. `git checkout bd8d05e` and `pnpm install --frozen-lockfile`.
2. `pnpm --filter api migrate up` against an empty database.
3. Build a submission from the street-event shape in section 2, vary `sapo_event_type` between
   `"street_event"` with `street_event_size: "large"` and `"unknown"`, pass each through
   `validateIntake` and then `evaluate` with the ruleset's own `calendarId`.
4. Compare `plan.verdict`, the rule ids in `plan.findings`, and `plan.verdictDetail.missingFacts`.

---

# Round 2: the rendering gap, measured

Round 1 established that the branch table exists and is not on screen. This measures what that
costs, through the real component path: `PlanView` rendered with `@testing-library/react`, fed by a
stubbed `fetch` in the same three-call shape the page makes, with the plan body produced by
`validateIntake` -> `evaluate` on the published ruleset. No JSX was read and inferred from.

## R1. It is already required by an APPROVED spec, and it is unimplemented

**This reclassifies the whole thing, so it goes first.**

`specs/F-102-feasibility-verdict.md` is **APPROVED (2026-07-24)**. Its Outputs table sets the copy
rule for one verdict explicitly:

| Verdict     | detail carries                                        | Copy rule                 |
| ----------- | ----------------------------------------------------- | ------------------------- |
| CONDITIONAL | each missing fact + every branch's verdict and reason | **branch table rendered** |

And AC 6, **Branching**: "every material unknown produces a fully evaluated branch (Scenario F:
license coverage, assembly approval, sound audibility -> **branch table with per-branch verdicts**;
the no-license branch shows the one-business-day miss)."

So rendering the branch table is **not a new requirement**. It is an acceptance criterion of an
approved spec, naming an approved fixture scenario, and it is not implemented. `plan-view.tsx:19`
records the boundary rather than the gap: "F-102's branch tables and rescope ladder are its own
feature."

**Measured against Scenario F itself**, which is what AC 6 names:

- verdict `CONDITIONAL`, two missing facts, four branches
- on screen: `Depends on: sound audible from public way, venue license covers event area`
- branch reason text on screen: **none of the four**
- per-branch verdicts on screen: **none**
- the `venue_license_covers_event_area = "no"` branch carries verdict **INFEASIBLE**, and neither
  the branch nor its verdict is visible

**A second approved artifact requires the same thing, independently of F-102.**
`docs/test-scenario-answer-key.md` is APPROVED in `docs/BASELINE.md` line 18 (v3 team-ratified
2026-07-22 with the ruleset, v4 and v5 authorized by the product owner 2026-07-25) and is the
green-gate acceptance suite. Its Scenario F expected verdict says so in its own words:

> "EXPECTED VERDICT: CONDITIONAL - branch table rendered: [license covers rooftop + assembly
> approval in place] -> feasible path; [no license coverage] -> infeasible path (SLA window missed
> by one business day); [sound audible from street] -> add sound permit. Three follow-up questions,
> not one (v1 corrected)."

So the branch table is required by the authoritative fixture as well as by F-102's Outputs table and
AC 6, and this document was wrong to treat the requirement as an open question. Two approved
artifacts, one spec and one acceptance suite, and neither is implemented.

**The interaction with the AC 6 split in R3, stated without deciding it.** The answer key expects a
branch for assembly approval, and the engine emits no missing fact for
`venue_has_assembly_approval`: it is answered `"unknown"` in the fixture and appears nowhere in the
plan, because `DOB-ASSEMBLY-001`'s trigger reads `location_type` and `headcount` only (R3). The
engine produces missing facts for the other two Scenario F unknowns,
`sound_audible_from_public_way` and `venue_license_covers_event_area`.

**Round 9 recorded this as an open question with two coequal readings. That was wrong: the
repository has already decided it, and leaving it open is not neutral.** The answer key settles it
in its own header, on the line above the scenarios:

> "**Authority hierarchy:** approved primary source -> published rule (`nyc-rules.v2.8.json`) ->
> this fixture suite -> engine output -> UI copy. **This document is derived from the ruleset, not
> an independent authority.** If a fixture and the published ruleset disagree, the fixture is wrong;
> if the ruleset and a primary source disagree, the ruleset is wrong. Fix the lower authority."

And `docs/DOCUMENTATION-GOVERNANCE.md` section 2 says what to do with the disagreement:

> "When levels disagree, inspect and correct the lower-authority artifact. Never alter an engine
> merely to reproduce an unsupported expected result."

The fixture suite is level 3 and the published rule is level 2. So the Scenario F assembly-approval
branch is **an answer-key defect**, not an open choice between two artifacts. The key's own rule,
"if a fixture and the published ruleset disagree, the fixture is wrong", applies to it directly.

**Why saying "open" was worse than saying nothing.** An open question between a level-2 and a level-3
artifact licenses closing it from either end, and closing it from the fixture end means changing a
rule or the engine to reproduce an expected output that no source supports. That is the exact move
governance section 2 exists to forbid. Recording the authority order removes the license.

**The escape hatch, which is real and is the only route the other way.** A level-1 approved primary
source could still require `DOB-ASSEMBLY-001` to read `venue_has_assembly_approval`, and then the
ruleset would be the artifact that is wrong and would change. That is a primary-source finding,
which is what `packages/engine/src/ruleset.ts:622-628` is holding the field open for on issue #89.
What cannot carry it is the fixture's expectation on its own.

**What this does NOT settle, because the hierarchy does not list it.** The authority order runs
approved primary source -> published rule -> fixture suite -> engine output -> UI copy. A SPEC is
not a level in it, so the order resolves the answer key against the ruleset and says nothing about
`specs/F-102-feasibility-verdict.md` AC 6, which independently names three Scenario F unknowns and
requires a branch for each. The AC 6 half stays what R3 calls it: blocked on a rules or engine
question for `venue_has_assembly_approval`, open on issue #89. Two artifacts expect the branch, and
only one of them is placed by the hierarchy.

This document proposes no change to any artifact and does not decide when the defect should be
fixed. What is recorded is that the two artifacts do not agree today, that the disagreement is on
one of the three Scenario F unknowns, and that the repository's own authority order names which of
those two is the lower one.

## R2. What the organizer actually sees

Literal visible text for the `sapo_event_type: "unknown"` submission, in order, at the top of the
page. The envelope is the corrected one described above: `generatedAt` on or after the ruleset's
own snapshot date, since a plan generated from v2.8 cannot predate v2.8.

```
Your permit plan
Rules snapshot nyc.v2.8 · published July 26, 2026
Depends on: sapo event type · generated 2026-07-26 · revision 1
```

Re-measured at 2026-07-25, 2026-07-26 and 2026-07-28: only the date string moves.

Then five findings, each `may be required`: `SAPO-BLOCK-PARTY-001` ("apply by 2026-07-18 ·
published deadline missed"), `SAPO-BLOCK-PARTY-SPONSOR-001`, `SAPO-PLAZA-001`,
`SAPO-INSURANCE-001` (the liability insurance certificate), and the `ADV-SAPO-OTHER-CLASS-001`
coverage-gap advisory ending "Not covered by this ruleset version. This plan may be incomplete for
your event."

**"Depends on: sapo event type"** is the entire branch table as rendered. `verdictCopy` maps
`missingFacts` to `fact.field.replace(/_/g, " ")`, so the organizer is shown a de-underscored
registry field name and no branch.

One raw field name does reach the screen verbatim, inside the `SAPO-PLAZA-001` line: **"the plan
was never asked plaza_level, which this deadline keys on"**. That is `unresolvedTimelines` rendered
as written, underscore included, and it sits behind the finding's "Details for ..." disclosure
rather than in the default view: collapsed, the document contains zero `.line__timeline` nodes;
expanding all five disclosures produces exactly one, carrying that sentence. The branch reasons are
absent in both states.

## R3. What is in `verdictDetail` and not on screen

For the same submission, every member measured:

| Member                            | Size       | On screen                                          |
| --------------------------------- | ---------- | -------------------------------------------------- |
| `missingFacts` (the branch table) | 757 chars  | **No**, except each `field` as de-underscored text |
| `trace`                           | 1884 chars | **No**                                             |
| `missedRuleIds`                   | 24 chars   | **No**                                             |
| `unresolvedTimelines`             | 109 chars  | **Yes**, verbatim, on the finding it belongs to    |
| `blockingFinding`                 | null       | n/a                                                |
| `minSlackDays`                    | null       | n/a                                                |
| `rescopeSuggestions`              | empty      | n/a                                                |

**The branches are not dropped by the renderer, and rounds 1 to 3 were wrong to say they are
dropped at the type boundary. Nothing drops them. They are present at runtime and no code looks
at them.** `apps/web/app/plan/plan-api.ts:134` defines what the web consumes:

```ts
export type ConsumedVerdictDetail = Omit<
  Pick<VerdictDetail, "minSlackDays" | "missingFacts">,
  "missingFacts"
> & { readonly missingFacts: readonly Pick<MissingFact, "field">[] };
```

with `MISSING_FACT_CHECKS: FieldChecks<Pick<MissingFact, "field">> = { field: isString }`.

That is a NARROWING, not a PROJECTION, and the distinction is the whole point. `readChecked` in
`apps/web/app/plan/validated.ts:53` validates the properties named in `checks` and then does
`return record as T` (line 60) on the object it was handed. `shapedLike` (line 64) is a type
predicate over `readChecked`, and `arrayOf` (line 84) is `Array.isArray(value) && value.every(check)`.
No member is copied, deleted or rebuilt anywhere on that path. The declared type narrows to
`Pick<MissingFact, "field">`; the runtime value is whatever the API sent.

Measured, by taking the six approved scenarios through `evaluate`, JSON round-tripping the
`missingFacts` array the way the wire does, and running it through the web's own parser:

```
Scenario E  AFTER_READCHECKED [["field","branches","thresholds"],["field","thresholds","branches"]]
Scenario F  AFTER_READCHECKED [["field","thresholds","branches"],["field","thresholds","branches"]]
```

So `branches` and `thresholds` arrive in the browser and sit there unread. `unresolvedTimelines`,
`trace`, `blockingFinding`, `missedRuleIds` and `rescopeSuggestions` are likewise not declared in
`ConsumedVerdictDetail` but likewise not stripped by it. `unresolvedTimelines` reaches the screen by
another path: it is carried on the finding, not on the verdict detail.

**What this changes about the F-102 AC 6 work, split by unknown rather than stated as one number.**
Rounds 1 to 3 called this a plumbing problem, data dropped in transit, which is wrong: nothing is
dropped and no API change, response member or serialization work is needed, because
`apps/api/src/plan.ts` stores and returns `verdict_detail` whole. Rounds 4 to 6 then called it a
renderer-only task, which is right for the unknowns the engine already surfaces and wrong for one of
the three AC 6 names. Both statements reached the product owner, so both are corrected here.

AC 6 names three unknowns for Scenario F, and the fixture answers all three `"unknown"`. Measured:

```
F answers: sound=unknown  venue_license=unknown  assembly=unknown
F missingFacts: ["sound_audible_from_public_way","venue_license_covers_event_area"]
venue_has_assembly_approval appears anywhere in the plan: false
```

| AC 6 unknown                      | Engine emits a missing fact           | What AC 6 needs                                           |
| --------------------------------- | ------------------------------------- | --------------------------------------------------------- |
| `sound_audible_from_public_way`   | yes, 2 branches                       | renderer only                                             |
| `venue_license_covers_event_area` | yes, 2 branches                       | renderer only                                             |
| **`venue_has_assembly_approval`** | **no, absent from the plan entirely** | **a rules or engine resolution FIRST, then the renderer** |

Widening `ConsumedVerdictDetail` and `MISSING_FACT_CHECKS` cannot render a branch the engine never
produces. The reason is recorded in the ruleset guard itself, in
`packages/engine/src/ruleset.ts:622-628`'s exemption entry for the field, quoted verbatim:

> "The rule now says that in its notes instead of describing a branch nothing evaluates, but its
> trigger still reads location_type and headcount only, so answering this changes no output. Open on
> issue #89, blocks F-102 AC 6."

Measured against the published rule: `DOB-ASSEMBLY-001` fires in Scenario F, and its trigger is
`all` of `location_type = private_venue` and `headcount gte 75`. It never reads
`venue_has_assembly_approval`, so the answer cannot enter `unknownFields` by any route in S4's
surfacing condition.

So AC 6 is renderer-only for two of its three unknowns and blocked on a rules or engine question for
the third, which is open on issue #89. **Connection worth recording, not a decision:** PR #171's
spec would make that field consumed, which is one route to unblocking the third branch. Whether to
take it is not this document's call.

On whether the UI honours the engine's own completeness rule: `verdict.ts` treats leaving a branch
out as a defect ("drop it from the branch table (P1-B)"). The UI does not render the table, so the
question of honouring per-branch completeness does not arise; there is no partial table, there is
none.

## R4. Whether an existing renderer is being missed

**No.** Searching the web app for a branch-table or missing-fact renderer outside test files returns
exactly one file, `apps/web/app/plan/verdict-copy.ts`, and its only use of `missingFacts` is the
field-name join quoted above. There is no component that renders branches, and no path that reaches
one.

So this is "not built", not "built and unreached". That is the larger of the two readings.

## R5. How many situations reach it

**The gap is general, not specific to the unknown gate.** Any ENUMERABLE missing fact produces
branches, and no missing fact renders them. The qualifier is load-bearing and the paragraph below
measures it: a missing fact with no enumerable candidates gets `branches: []` and a threshold string
instead, which `tent_area_sqft` does in Scenario E.

Measured across the six approved scenarios, through the same component path:

| Scenario | Verdict          | Missing facts                                                      | Facts with branches | Branch reasons on screen |
| -------- | ---------------- | ------------------------------------------------------------------ | ------------------- | ------------------------ |
| A        | INFEASIBLE       | none                                                               | 0                   | n/a                      |
| B        | CONDITIONAL      | none                                                               | 0                   | n/a                      |
| C        | FEASIBLE         | none                                                               | 0                   | n/a                      |
| D        | FEASIBLE_AT_RISK | none                                                               | 0                   | n/a                      |
| E        | CONDITIONAL      | `tent_area_sqft`, `structure_over_10ft_tall`                       | 1                   | none                     |
| F        | CONDITIONAL      | `sound_audible_from_public_way`, `venue_license_covers_event_area` | 2                   | none                     |

**These are two distinct rendering gaps, not one.** A missing fact does not always carry branches.
When `alternativeValues` returns no enumerable candidates, `evaluateConditional` pushes
`{ field, branches: [], thresholds: publishedThresholds(field, ruleset) }` instead
(`packages/engine/src/verdict.ts:199`), which is a threshold string with no branch table at all.
Scenario E contains one of each, measured:

```
E: [{"field":"tent_area_sqft","branches":0,"thresholds":"DOB-TENT-001 applies above 400"},
    {"field":"structure_over_10ft_tall","branches":2,"thresholds":null}]
F: [{"field":"sound_audible_from_public_way","branches":2,"thresholds":null},
    {"field":"venue_license_covers_event_area","branches":2,"thresholds":null}]
```

So **three missing facts across the six approved scenarios reach an unrendered branch table**, one
in scenario E and two in scenario F, and **one reaches unrendered threshold guidance instead** (`tent_area_sqft` in E).
Having a missing fact and having a branch table are different conditions, and a fix for one does not
cover the other. Rounds 1 to 3 collapsed them.

**Correction to round 5 on what the threshold gap costs.** Round 5 said the organizer is never shown
the 400 sq ft number that decides the requirement. That is wrong, and it was relayed as the concrete
cost. `DOB-TENT-001` is a finding on the same plan, and the number is in its published name and
notes, both of which are rendered (`apps/web/app/plan/plan-line.tsx:99` for the name, `:188` for the
notes). Measured on Scenario E:

```
DOB-TENT-001 finding present? true
name  = "DOB permit - tent/canopy over 400 gross sq ft or in place 30+ days"
notes = ["Exactly 400 sq ft (e.g. 20x20) sits ON the published 'more than 400' boundary -> engine
          renders CONDITIONAL, not REQUIRED, with 'confirm footprint calculation with DOB'.", ...]
missingFact thresholds = "DOB-TENT-001 applies above 400"
```

So `MissingFact.thresholds` is an unread detail member whose regulatory content is duplicated
visibly on the finding. It is still a real gap, because a reader working through the missing-fact
list is not given the number there and has to connect it to a separate finding, but it is not a
user-facing omission of the deciding number and this document should not have said it was.

Upper bound on the surface, recounted. Round 3 said 15 fields, taking every enumerable
trigger-referenced field. That overstates it: `validateIntake` closes the route for a field that
declares no `unknown` value. Measured, by submitting `"unknown"` and `null` for each of the 15
against the published contract:

- **8 of the 15 cannot resolve unknown at all.** `location_type`, `has_amusement_ride`,
  `food_present`, `selling_anything`, `amplified_sound`, `alcohol`, `structure_types` and
  `open_flame_or_cooking` are non-nullable and declare no `unknown` member, so `"unknown"` is
  rejected `invalid_value` and `null` is rejected `required` (except where scoping makes the field
  not applicable, which is not an unknown either).
- **7 of the 15 can**, and each was accepted as `"unknown"` in at least one approved scenario:
  `obstructs_public_way` (A, D, E), `sapo_event_type` (A, D, E), `street_event_size` (A),
  `structure_over_10ft_tall` (E), `event_open_to_public` (all six),
  `sound_audible_from_public_way` (F), `venue_license_covers_event_area` (F). Outside those
  scenarios each is rejected `not_applicable` rather than accepted, so scope narrows the reachable
  surface further per submission.

The remaining 10 trigger-referenced fields are numeric, and take the `branches: []` path above:
threshold guidance where the ruleset publishes one, nothing where it does not, also unrendered. But
**only 8 of those 10 can reach it**, which round 4 did not check. Measured through `validateIntake`
across all six approved scenarios:

- `headcount` is non-nullable and required in every scenario: `null` and omission both fail
  `required`, and `"unknown"` fails `invalid_value` because the integer validator does not take a
  string. There is no submission in which it resolves unknown.
- `food_vendor_count` is non-nullable and fails the same way wherever it is in scope. It accepts
  `null` in scenarios C and D only, and only because `food_present` is false there, which makes it
  not-asked rather than unknown. A not-asked field resolves `false` with an empty `unknownFields`
  and never enters `verdict.ts`'s `unknownFields` filter, so it produces no missing fact either way,
  which the measured `missingFacts` for C and D (both empty) confirms.
- The other eight (`tent_area_sqft`, `tent_days_in_place`, `stage_height_ft`, `stage_area_sqft`,
  `generator_gasoline_gallons`, `generator_diesel_gallons`, `generator_kw`, `battery_system_kwh`)
  are `nullable: true` and accept `null` in all six scenarios, which is how `tent_area_sqft` reaches
  the threshold path in scenario E above.

**One enumerable field is reachable that no trigger reads, so 7 is the trigger-only count and not
the total.** `plaza_level` is read by no rule trigger, which is why it never appeared in the list of 15. It is read by `SAPO-PLAZA-001`'s deadline as `level_field`, and `resolveFindings` unions
deadline unknown fields into the same set `evaluateConditional` consumes (`findings.ts:261-263`).
Measured on approved scenario E, where `SAPO-PLAZA-001` fires:

```
E plaza_level="unknown": ACCEPTED verdict=CONDITIONAL
  missingFacts=["plaza_level","tent_area_sqft","structure_over_10ft_tall"]
  plaza_levelEntry=branches=4 thresholds=null
```

Four branches, unrendered like the rest. `plaza_multiple_blocks`, the deadline's other bound field,
does not add a case: it is `required` in scenario E and rejects `"unknown"` as a boolean, so it was
checked and produces nothing.

Stated with both numbers rather than one doing two jobs:

| Count                            | Enumerable            | Numeric |
| -------------------------------- | --------------------- | ------- |
| Trigger-referenced and reachable | 7                     | 8       |
| Plus deadline-only consumption   | **8** (`plaza_level`) | 8       |

So the reachable surface is **at least 8 enumerable fields plus 8 numeric ones**, not 15 plus 10.
"At least" is meant literally: the count is over fields the published ruleset consumes today, and
S4 records that consumption route, not field type, is what decides whether an unknown surfaces.

## R6. What this round establishes and does not

Establishes:

- rendering the branch table is required by TWO approved artifacts and implemented by neither: an
  acceptance criterion and Outputs rule of `specs/F-102-feasibility-verdict.md`, and the Scenario F
  expected verdict of `docs/test-scenario-answer-key.md`, the green-gate acceptance suite;
- the answer key's Scenario F assembly-approval branch is an ANSWER-KEY DEFECT under the
  repository's own authority order, not an open choice between two artifacts, unless a level-1
  primary source first requires the rule to change (R1);
- the organizer sees a de-underscored field name and nothing else of the table;
- the branches arrive in the browser and are read by nothing, so AC 6 is a rendering task rather
  than a plumbing one for the two Scenario F unknowns the engine surfaces, and blocked on a rules or
  engine question for the third, `venue_has_assembly_approval`, which no trigger reads (issue #89);
- no renderer exists anywhere in the web app;
- two of six approved scenarios reach it today, and at least 8 enumerable fields can resolve
  unknown, 7 read by triggers plus `plaza_level` read only by a deadline; a further gap, unrendered
  threshold guidance, is separate from the branch table and is reachable through 8 of the 10 numeric
  fields, not all 10; for `tent_area_sqft` the deciding number is duplicated on a rendered finding,
  so that gap costs a reader of the missing-fact list a connection rather than the number itself.

Does not establish, and is outside this measurement:

- whether `DOB-ASSEMBLY-001` SHOULD read `venue_has_assembly_approval`, which is the rules question
  behind Scenario F's third named unknown. What R1 does establish is the authority order that
  applies to it: the fixture is level 3 and the published rule level 2, so the key is the artifact
  to correct unless a level-1 primary source says otherwise. Which artifact changes and when is not
  decided here;
- ~~whether the approved answer key expects the branch table on screen~~ **, which R1 now
  establishes rather than leaves open: the key's Scenario F expected verdict says "branch table
  rendered" and names the license, assembly-approval and sound branches. Struck through rather than
  deleted because it was listed as outside the measurement for three rounds after R1 answered it;**
- anything about whether #108 should be closed, which this document does not address.

Every bullet in this section was re-checked against what the document now establishes, not only the
one that was flagged. Two moved, both above. The remaining "establishes" bullets each trace to a
measurement in R1 to R5 and none were weakened by round 3's results, which measure the engine rather
than the renderer.

---

# Round 3: is the engine safe, or is v2.8 safe

Round 1 found that answering `sapo_event_type: "unknown"` surfaces the loss through a branch table,
and noted that this happens **because that gate is itself read by rule triggers**. That left one
question open, and it is the one the #108 disposition turns on: is the surfacing a property of the
engine, or an overlap in this particular ruleset?

**Answer: v2.8 happens to be safe. The engine is not.**

## S1. The dangerous shape is expressible, and the loader accepts it

The first thing to check was whether the schema forbids a gate that no trigger reads, because a
validator that rejects the shape would be a real guarantee. It does not.

`rejectUnconsumedFields` (`ruleset.ts:654`) counts a field as consumed when a trigger reads it, when
a deadline resolves against it, **or when it scopes another question**:

```ts
const consumed = new Set<string>([
  ...published.flatMap((rule) => triggerFields(rule.trigger)),
  ...deadlineConsumedFields(published),
  ...intakeFields.flatMap((field) => (field.askedWhenClauses ?? []).map((clause) => clause.field)),
]);
```

So gating something is sufficient to be consumed. A gate read by nothing else loads cleanly.

## S2. The probe, built from published content

**Correction to round 4, which was the second attempt at this and also wrong.** Round 3 published a
probe carrying a fabricated rule: `PROBE-REQUIREMENT-001`, `output: { permit_name: "Probe
requirement", agency: "PROBE" }`, a citation with a url, and `verification: { status:
"SOURCE_CONFIRMED" }` beside its own statement that no source exists. Round 4 renamed the id to
`PROBE-SYNTHETIC-NOT-A-RULE`, emptied `output`, dropped `source` and moved the status to
`RESEARCH_REQUIRED`, and called that a fix. It was not. It still declared a rule of `kind: "permit"`,
still invented a trigger for it, and still assigned it a verification status. The regulatory
semantics were relabelled, not removed. Both attempts are recorded here because two corrections on
the same point should be visible as two.

**Why the minimal-rule approach could not have worked, which is a finding about the artifact format
rather than about the probe.** Round 4 measured the parser's requirements exactly:

| Member                  | Required?                  | Measured against `parseEngineRuleset`                                                 |
| ----------------------- | -------------------------- | ------------------------------------------------------------------------------------- |
| `verification`          | **yes**                    | omitting it fails `ruleset.rules[0].verification must be an object`                   |
| `verification.status`   | **yes**, from a closed set | `""` fails "must be a non-empty string"; `NOT_A_STATUS` fails "has unsupported value" |
| `source`                | no                         | omitted entirely, parses                                                              |
| `output`                | present, may be empty      | `{}` parses                                                                           |
| `id`, `kind`, `trigger` | yes                        | `kind` accepts permit, note, advisory, prohibition, registration                      |

`verification.status` cannot be omitted and cannot be a value outside the published set. There is
therefore **no way to express a non-regulatory rule in this schema**: every rule the parser accepts
carries a `kind`, a trigger, and a claim about how well sourced it is. The format has no "this is
not a real requirement" state. Any minimal invented rule is a regulatory assertion by construction,
which is why the round-4 rename changed nothing, and why no third attempt at one was made.

**What replaced it: `rules` and `advisories` are published content, byte for byte.** The probe loads
`rules/nyc-rules.v2.8.json` and touches nothing except `intake_fields` gating, which is the thing
under test:

```ts
raw.intake_fields = raw.intake_fields.map((f) =>
  // The gate. Published as a boolean, which cannot be answered "unknown"; re-typed here so the
  // three-state answer is expressible. Values only, no rule, no output, no verification.
  f.field === "generator_present"
    ? { field: f.field, type: "enum", values: ["yes", "no", "unknown"], collected: true }
    : // The published clause is the bare truthiness `generator_present`; made explicit against the
      // enum so "unknown" scopes the dependents out.
      f.asked_when === "generator_present"
      ? { ...f, asked_when: "generator_present = yes" }
      : f,
);
```

Measured, not asserted:

```
RULES_ADVISORIES_CONFIG_UNCHANGED true
```

`generator_present` is a real published field, and the published ruleset already makes it a
scope-only gate: no trigger and no deadline reads it, and its whole job is to gate
`generator_gasoline_gallons`, `generator_diesel_gallons` and `generator_kw`. **Those three belong to
TWO published rules, not one**, which round 5 got wrong by attributing all three to FDNY:

| Gated dependent              | Read by                                          | Threshold |
| ---------------------------- | ------------------------------------------------ | --------- |
| `generator_gasoline_gallons` | `FDNY-GENERATOR-001` (`kind: "permit"`)          | `gt 2.5`  |
| `generator_diesel_gallons`   | `FDNY-GENERATOR-001`                             | `gt 10`   |
| `generator_kw`               | `DEP-GENERATOR-REG-001` (`kind: "registration"`) | `gte 40`  |

`FDNY-GENERATOR-001`'s third trigger condition reads `battery_system_kwh`, which
`battery_present` gates, not `generator_present`. Both rules are published content, quoted here
rather than invented:

```json
{ "id": "FDNY-GENERATOR-001", "kind": "permit",
  "trigger": { "any": [ { "field": "generator_gasoline_gallons", "op": "gt", "value": 2.5 },
                        { "field": "generator_diesel_gallons",  "op": "gt", "value": 10 },
                        { "field": "battery_system_kwh",        "op": "gt", "value": 20 } ] },
  "output": { "permit_name": "FDNY Generator/Battery Permit", "agency": "FDNY" },
  "verification": { "status": "SOURCE_CONFIRMED" } }

{ "id": "DEP-GENERATOR-REG-001", "kind": "registration",
  "trigger": { "all": [ { "field": "generator_kw", "op": "gte", "value": 40 } ] },
  "output": { "requirement_name": "DEP generator registration (40 kW or greater)",
              "agency": "NYC DEP" },
  "verification": { "status": "SOURCE_CONFIRMED" } }
```

Nothing regulatory is invented anywhere in this probe. The only synthetic element is the gate's
type and its `asked_when` wiring.

**Which guards this probe passed, and the one it cannot.** Round 5 called the four checks below the
full guard chain. They are not: they are the contract-and-engine guards, and the product has one
more. Naming them precisely, because this document has now overstated a methodology claim twice and
the correction should be exact rather than softer.

Passed, because the published rules are intact and `parseIntakeContract` no longer rejects the
ruleset:

```
parseEngineRuleset:   ACCEPTED
parseIntakeContract:  ACCEPTED
validateIntake:       ACCEPTED for all three answers
evaluate:             ran on all three
```

NOT passed, and not passable: **persistence**. `apps/api/migrations/001_initial_schema.ts:103`
declares `generator_present: { type: "boolean", notNull: true }`, and the events router inserts the
validated record verbatim (`apps/api/src/events.ts:178` then `insert(values)`). A submission
carrying `"unknown"` is rejected by Postgres before it is ever stored, measured directly:

```
=# INSERT INTO events (generator_present) VALUES ('unknown');
ERROR:  invalid input syntax for type boolean: "unknown"
```

This cuts both ways and both matter:

- **Against the probe.** It does not show that a real submission can reach the engine in this state.
  The plan service reloads a stored event, and no such event can exist, so S3 is a
  contract-and-engine result rather than an end-to-end product result.
- **For the safety of v2.8.** The column is a second independent thing standing between the
  published product and the dangerous shape, alongside `validateIntake` rejecting `"unknown"` for a
  boolean field. It belongs in the "what saves v2.8 today" list in S4, and it is worth noting that
  it saves by accident of the column type rather than by any check that understands gates.

## S3. The result

Base intake is approved scenario C, unchanged apart from the generator answers. The qualifying
answers are 5 gasoline gallons (over FDNY's 2.5) and 50 kW (over DEP's 40), so both rules fire when
the gate is answered `"yes"`.

| Answer to `generator_present` | Verdict      | Findings | `FDNY-GENERATOR-001` | `DEP-GENERATOR-REG-001` | `missingFacts` | Gate named anywhere in the plan |
| ----------------------------- | ------------ | -------- | -------------------- | ----------------------- | -------------- | ------------------------------- |
| `"yes"`, 5 gal + 50 kW        | FEASIBLE     | 6        | **present**          | **present**             | none           | no                              |
| `"no"`                        | FEASIBLE     | 4        | absent               | absent                  | none           | no                              |
| **`"unknown"`**               | **FEASIBLE** | **4**    | **absent**           | **absent**              | **none**       | **no**                          |

**TWO published requirements leave the plan with no missing fact, no branch, no finding and no
unresolved timeline**: an FDNY permit and a DEP registration, from two different agencies. The
verdict stays FEASIBLE, which is the engine saying the plan is complete.

The sharpest form of the result:

```
plan(generator_present = "no") === plan(generator_present = "unknown")   ->   true
```

The two plans are byte-identical JSON. There is no channel, rendered or unrendered, that
distinguishes "I do not know whether there is a generator" from "there is no generator". The
`trace` is identical too, and records the unknown answer as a settled false for both rules.

**For contrast, the engine handles an unanswered DEPENDENT correctly.** With `generator_present`
answered `"yes"` and the amounts left null, the same probe reports `generator_kw` as a missing fact
with a branch table. So the gap is specific to the GATE. An unknown one level down is branched; an
unknown at the gate is consumed by the scoping layer and never reaches the trigger layer that does
the branching.

## S4. Which world we are in

**V2.8 happens to be safe.** Stated without hedging, because the disposition turns on it.

**What saves v2.8 today, all three of them incidental.** None is a check that understands gates:

1. **The ruleset shape.** `sapo_event_type` is the only gate whose `"unknown"` scopes dependents
   out, and it is read directly by SAPO rule triggers, which makes it a missing fact in its own
   right and fires the branch machinery. The branch table in round 1 came from the trigger layer
   noticing the gate, not from the scoping layer reporting what it excluded.
2. **The intake contract.** `generator_present`, the one published field that is a scope-only gate
   today, is declared `boolean`, so `validateIntake` rejects `"unknown"` for it with
   `invalid_value`. The probe had to re-type it to a three-state enum to test the mechanism at all.
3. **The events table.** `generator_present` is `boolean, notNull` at
   `apps/api/migrations/001_initial_schema.ts:103`, so even a submission that got past the contract
   could not be stored: `ERROR: invalid input syntax for type boolean: "unknown"` (S2). This one is
   a column type doing safety work by accident, and it applies per column rather than per gate.

Numbers 2 and 3 both stop the specific probe, and neither would stop a gate published as an enum
that declares `unknown` and is stored as `text`, which is how `sapo_event_type` and `plaza_level`
are already declared.

Remove that overlap, as the probe does, and the whole surfacing apparatus is silent. Round 1 said
the scoping layer "returns a set with no record of what it excluded or why"; this measures what that
costs when nothing else happens to compensate.

**The unsafe surface is LARGER than round 4 stated, not smaller.** Round 4 gave the condition as
"the gate is consumed exclusively by `asked_when` scoping". That still qualifies on whether a
trigger MENTIONS the gate, and mentioning is not propagating. `evaluateTrigger`
(`packages/engine/src/conditions.ts:352`) short-circuits: when any child of an `all` is false, or
any child of an `any` is true, it returns that decisive result with `unknownFields: []`. An unknown
sibling in the same node contributes nothing. `resolveFindings` therefore never sees it, and the
gate is silent even though a trigger reads it.

This is not hypothetical, and v2.8 demonstrates it. Answering `sapo_event_type: "unknown"` on
approved scenario A, eleven published rules read the gate, and measured per rule:

| Rule reading the gate                 | Trigger result | `unknownFields` propagated |
| ------------------------------------- | -------------- | -------------------------- |
| `SAPO-STREET-SMALL-001`               | false          | **none**                   |
| `SAPO-STREET-MEDIUM-001`              | false          | **none**                   |
| `SAPO-STREET-LARGE-001`               | false          | **none**                   |
| `SAPO-STREET-XL-001`                  | false          | **none**                   |
| `SAPO-INSURANCE-BLOCK-PARTY-RIDE-001` | false          | **none**                   |
| `SAPO-BLOCK-PARTY-001`                | unknown        | `["sapo_event_type"]`      |
| `SAPO-BLOCK-PARTY-ELIG-001`           | unknown        | `["sapo_event_type"]`      |
| `SAPO-BLOCK-PARTY-SPONSOR-001`        | unknown        | `["sapo_event_type"]`      |
| `SAPO-PLAZA-001`                      | unknown        | `["sapo_event_type"]`      |
| `SAPO-INSURANCE-001`                  | unknown        | `["sapo_event_type"]`      |
| `ADV-SAPO-OTHER-CLASS-001`            | unknown        | `["sapo_event_type"]`      |

The five that propagate nothing are `all` nodes whose OTHER condition reads a dependent the gate
itself has just scoped out, so the sibling resolves `not_asked` -> false and settles the node before
the unknown is reached. **The four SAPO-STREET rules are precisely the requirements that are lost,
and they are exactly the rules that report nothing about losing them.** What saves v2.8 is the other
six: five whose trigger is a lone condition on the gate and so have no sibling to short-circuit on,
plus `SAPO-BLOCK-PARTY-ELIG-001`, whose sibling `any` is not decisively false on this submission.
The branch table round 1 measured is entirely their doing, and none of them is a rule the answer
would have added.

So the condition to qualify on is a live evaluation, not a static mention. Rounds 4 to 6 stated one
condition here and used it for two different questions; the two are separated below under
"Surfacing is not the same question as silence".

Scope-only consumption, round 4's condition, is one way for a gate to go unpropagated. The
short-circuit is another, and it is reachable in a ruleset where every trigger reads the gate. A ruleset author
cannot tell from the rule text whether a gate is covered; it depends on what the other conditions in
the same node evaluate to for that submission.

**Deadline-only consumption is a third route, and it runs the other way: it rescues.** `plaza_level`
is read by no trigger, so on the trigger side alone it would be silent, but `SAPO-PLAZA-001` uses it
as its deadline's `level_field`. When the rule fires and the field is unanswered,
`deadlines.ts:148` returns `{ kind: "unknown", field: "plaza_level" }`, `findings.ts:263` unions it
into `unknownFields`, and `evaluateConditional` produces a branch table for it like any other
missing fact. Measured on approved scenario E, `plaza_level: "unknown"` is accepted and yields a
four-branch entry (R5). So the consumption route decides whether an unknown surfaces, in both
directions, and none of the three is visible from the rule's own text.

**Whether the three are exhaustive: the routes are not, but the underlying condition is.**
"Scope-only", "short-circuit" and "deadline-only" are three patterns that were observed, and there
is no argument here that no fourth pattern exists. The condition beneath them is closed, though,
because `resolveFindings` has exactly two places that add to the set (`findings.ts:260` from trigger
evaluation and `:263` from `finding.deadlineUnknownFields`), and nothing else in the engine writes
to it. `deadlineUnknownFields` in turn has exactly two producers, `deadlines.ts:148` for the level
field and `:183` for the multi-block field. So:

> **SURFACING.** A field's unknown reaches `unknownFields`, and therefore `missingFacts`, if and
> only if some trigger evaluation in the run RETURNS it in `unknownFields`, or some firing rule's
> deadline computation RETURNS `{ kind: "unknown", field }` for it.

Both halves are stated as returned output rather than as what a rule reads, because the second half
has the same static-versus-live gap the first one had. A deadline that reads a field does not
necessarily emit it. Measured: on `sapo_event_type: "unknown"` in scenario A, `SAPO-PLAZA-001` fires
and its deadline keys on `plaza_level`, but the field is out of scope, so `deadlines.ts:140-143`
returns a `timelineUnresolvedReason` instead of an unknown field:

```
SAPO-PLAZA-001 fires? true
plaza_level in missingFacts? false
unresolvedTimelines=[{"ruleIds":["SAPO-PLAZA-001"],
  "reason":"the plan was never asked plaza_level, which this deadline keys on"}]
```

Same rule, same deadline, same field: emitted as an unknown in scenario E (R5) and as an unresolved
timeline here. Only the live return distinguishes them.

Every route, named or not yet named, is a way of failing or satisfying that disjunction.

### Surfacing is not the same question as silence

Rounds 4, 5 and 6 each stated a condition here and then used it to conclude that the requirement is
lost silently. That is a substitution, and it does not hold. The condition above answers **is the
unknown visible**. Silence needs a second thing: **did nothing else in the plan move**. A case can
satisfy the first and fail the second.

`evaluateCondition` is where they come apart (`packages/engine/src/conditions.ts:319-325`). A
trigger that reads the field with `eq "unknown"` or `in [..., "unknown"]` treats an EXPLICIT
`"unknown"` as an answer rather than as a blocker, and returns

```ts
{ result: "true", unknownFields: [], triggeredBy: [contribution] }
```

Empty `unknownFields`, so nothing surfaces. A `triggeredBy` contribution and a `true` result, so a
FINDING IS EMITTED. The published ruleset already depends on this; the comment at `:317-318` names
`SLA-CATERING-001`, `ADV-NOISE-CODE-001` and `DOHMH-EXEMPTION-001`, and all three are published
rules whose trigger carries `in ["no", "unknown"]`.

Measured on `DOHMH-EXEMPTION-001` (`all` of `food_present = true` and
`event_open_to_public in ["no", "unknown"]`), varying only that one answer:

| Answer state             | Trigger result | `unknownFields`            | `triggeredBy`                                         |
| ------------------------ | -------------- | -------------------------- | ----------------------------------------------------- |
| answered `"no"`          | true           | `[]`                       | `food_present`, `event_open_to_public: "no"`          |
| **explicit `"unknown"`** | **true**       | **`[]`**                   | **`food_present`, `event_open_to_public: "unknown"`** |
| in scope, `null`         | unknown        | `["event_open_to_public"]` | both fields                                           |
| not asked (out of scope) | false          | `[]`                       | none                                                  |

So the explicit unknown satisfies BOTH halves of the surfacing condition being false, nothing
propagates it and no deadline reads it, and the plan still changes: an advisory the organizer would
not otherwise get is added, and `trace` records the rule as `true`. It is invisible in
`unknownFields` and in `missingFacts` while altering findings and trace. Stated separately:

> **SILENCE, a SCREENING HEURISTIC and not a sufficient condition.** A question the gate scopes out
> is a CANDIDATE for silent loss when the gate's unknown does not surface, no rule's trigger
> evaluation RETURNS a non-false result carrying the gate in `triggeredBy`, and no firing rule's
> deadline RETURNS a `timelineUnresolvedReason` naming that dependent. Confirm every candidate by
> diffing the two plans; the heuristic has been insufficient at every statement of it so far.

The third clause is new in round 9 and it is the reason the predicates alone were never enough.
`computeDeadline` has a branch for a level or multi-block field that is OUT OF SCOPE
(`deadlines.ts:140-143`) that is separate from the unanswered branch at `:147`: it returns a
`timelineUnresolvedReason` naming the DEPENDENT rather than an unknown for the GATE. Nothing about
the gate changes, so all three of the earlier predicates keep holding, and the plan still reports
the loss.

**Proved by comparing plans, not by predicate.** The predicates are what kept being insufficient, so
this is a finding-set diff. Same technique as S2, `rules`, `advisories` and `config` byte-identical,
and only `intake_fields` changed: `generator_present` re-typed to a three-state enum as before, and
`plaza_level`'s `asked_when` pointed at it, which makes the gated question a firing rule's deadline
`level_field`. Base intake is approved scenario E, where `SAPO-PLAZA-001` fires.

```
A. gate = "yes", plaza_level answered "a"
   verdict=CONDITIONAL findings=8
   [DEP-GENERATOR-REG-001, DOB-TENT-001+DOB-TALL-STRUCTURE-001, DOHMH-ORGANIZER-NOTIFY-001,
    DOHMH-VENDOR-PERMIT-001, FDNY-GENERATOR-001, NYPD-SOUND-001, SAPO-INSURANCE-001, SAPO-PLAZA-001]
   unresolvedTimelines=[]

B. gate = "unknown", plaza_level and the generator amounts all scoped out
   verdict=CONDITIONAL findings=6
   [DOB-TENT-001+DOB-TALL-STRUCTURE-001, DOHMH-ORGANIZER-NOTIFY-001, DOHMH-VENDOR-PERMIT-001,
    NYPD-SOUND-001, SAPO-INSURANCE-001, SAPO-PLAZA-001]
   unresolvedTimelines=[{"ruleIds":["SAPO-PLAZA-001"],
     "reason":"the plan was never asked plaza_level, which this deadline keys on"}]

FINDING SET DIFF (A -> B)
   dropped: ["FDNY-GENERATOR-001","DEP-GENERATOR-REG-001"]
   added:   []
   SAPO-PLAZA-001 present in B: true
   gate named anywhere in either plan: false
```

One gate, one answer, and the two kinds of dependent behave differently. The generator amounts are
dropped silently, which is the S3 result. `plaza_level` is not: `SAPO-PLAZA-001` survives as a
finding and `verdictDetail` names the missing question in words, underscore included. So the
earlier condition, applied to the gate, would have predicted a silent loss for both, and the plan
comparison shows it is wrong for one of them.

**The predicate above is a SCREENING HEURISTIC, not a sufficient condition, and this section no
longer leans on it.** Round 9 said the diff is what should be trusted and then still let the
predicate carry the conclusion. Finishing that thought: the predicate cannot be made sufficient by
adding clauses, because it is stated on trigger and deadline output while the claim is about the
whole plan, and each added clause has only closed the one hole that was found.

Here is the hole that defeats the round-9 version. `FDNY-GENERATOR-001`'s trigger is an `any` over
three amounts. `battery_system_kwh` is gated by `battery_present`, the other two by
`generator_present`. Give the battery arm a qualifying answer so it stays decisively true, and the
finding survives the gate going unknown; but the decisive-`any` path (`conditions.ts:352-366`)
rebuilds `triggeredBy` from the true children only, so the scoped-out amount silently leaves the
finding's provenance. Measured, same technique as S2, `rules`, `advisories` and `config`
byte-identical, base intake approved scenario C, `generator_kw` held under DEP's 40 kW threshold so
that rule fires in neither run and provenance is the only thing that can move:

```
A. gate = "yes", gasoline 5, battery 30 kWh
   FEASIBLE, 5 findings
   FDNY triggeredBy = [{"generator_gasoline_gallons":5},{"battery_system_kwh":30}]

B. gate = "unknown", amounts scoped out, battery 30 kWh
   FEASIBLE, 5 findings
   FDNY triggeredBy = [{"battery_system_kwh":30}]

COMPARISON
   finding SETS equal?    true
   plan payloads equal?   FALSE
   FDNY provenance equal? false
   lost from provenance:  ["generator_gasoline_gallons"]
   missingFacts, unresolvedTimelines: empty in both
   gate named anywhere:   false in both
```

All three clauses of the predicate hold. The finding set is identical. And the plan is NOT the same:
the organizer's answer that half-drove an FDNY permit is gone from the record of why that permit
applies, with nothing anywhere saying so. That is the fifth proxy and the fifth contradiction. Round
4 qualified on what a trigger MENTIONS, rounds 5 and 6 on live trigger propagation, round 7 on what
a trigger ACCEPTS, round 8 on returned trigger output, round 9 on that plus deadline reasons.

**So S4's conclusion rests on the plan comparisons, and the predicate is kept only to say where to
look.** The two comparisons together are what the section establishes:

| Comparison                              | What moved between answered and unknown                                                  |
| --------------------------------------- | ---------------------------------------------------------------------------------------- |
| S3 (generator amounts, no other reader) | two findings DROPPED, `FDNY-GENERATOR-001` and `DEP-GENERATOR-REG-001`, nothing reported |
| the `plaza_level` diff above            | no finding dropped; the loss REPORTED as an unresolved timeline                          |
| the `any`-arm diff here                 | no finding dropped; provenance changed, nothing reported                                 |

Silence in the sense #108 alleges is the first row and only the first row. The third row is a
smaller and different harm, a plan that is right about what applies and wrong about why. Anyone
reusing the predicate should diff the plans.

**Third statement of this condition, and the same failure mode each time.** Rounds 4 to 6 qualified
on what a trigger MENTIONS; round 7 qualified on what a trigger ACCEPTS. Both are properties of the
rule text, and a live evaluation contradicted both. Static acceptance is not enough because
`evaluateTrigger` (`conditions.ts:352-366`) can settle the node before the accepting leaf matters:
if the accepting leaf sits in an `all` whose sibling is false, the decisive-false path returns empty
`unknownFields` AND empty `triggeredBy`, the trace stays false, and nothing is emitted. Measured on
`DOHMH-EXEMPTION-001` with `event_open_to_public: "unknown"` both ways:

```
food_present TRUE : result=true  unknownFields=[] triggeredBy=[food_present, event_open_to_public:"unknown"]
                    trace=true   inFindings=true
food_present FALSE: result=false unknownFields=[] triggeredBy=[]
                    trace=false  inFindings=false
```

Identical rule, identical answer to the gate, opposite outcome. The condition above is therefore
phrased on the returned `triggeredBy` and nothing else. Any restatement in terms of what a trigger
says will be wrong again.

Surfacing is about visibility; silence is about the plan being unchanged. The S3 probe result is a
silence result, and it holds, because the gate there is read by no trigger at all and so no trigger
can accept it either. Rounds 4 to 6 were right about that case and wrong to state the surfacing
condition as if it settled the general one.

**Whether the isolated case is reachable on v2.8: measured no, and the reason is incidental again.**
All three accepting rules read a field that a NON-accepting rule also reads, and the non-accepting
one propagates on the same submission. On `DOHMH-EXEMPTION-001`'s own answer above,
`DOHMH-VENDOR-PERMIT-001` (`event_open_to_public eq "yes"`) goes `unknown` and propagates the field.
The same holds for `venue_license_covers_event_area` (`SLA-VENUE-LICENSE-001` and `SLA-ONEDAY-001`
both `eq`) and `sound_audible_from_public_way` (`NYPD-SOUND-001` `eq "yes"`). Checked across all six
approved scenarios: in every case where an accepting rule fired on `"unknown"`, a sibling rule
surfaced the field. So on v2.8 the accepting trigger always arrives with a channel that reports the
unknown, and nothing published today is both plan-changing and invisible.

**The not-asked and omitted cases, which are a different thing again.** `acceptsUnknown` requires
`answer.isExplicitUnknown`, and `resolveAnswer` (`conditions.ts:238-244`) only sets that for the
literal `"unknown"` string. The bottom two rows of the table above are the consequence, measured
rather than reasoned:

- **In scope and unanswered (`null`).** Not accepted. The condition returns `unknown` and propagates
  the field, so an accepting trigger behaves like any other one and the fact surfaces. For all three
  fields the comment names, `validateIntake` rejects this state anyway with `required`, so it is not
  reachable through the product.
- **Not asked (scoped out).** `conditions.ts:315` returns `false` with an empty `unknownFields` and
  an empty `triggeredBy`, so the accepting rule does not fire. An accepting trigger changes nothing
  here: this is the silent case, and accepting the unknown does not rescue it, because there is no
  unknown to accept. This is the state PR #167 measured and the one rounds 5 and 6 keep next to it.

The distinction that has now bitten twice, put plainly: `"unknown"` and unanswered are different
answers to the engine, and a rule that accepts the first does nothing for the second.

**Is the condition reachable by a valid published ruleset? Yes on both routes.** For scope-only
consumption, `rejectUnconsumedFields` (`packages/engine/src/ruleset.ts:654`) builds its `consumed`
set from trigger fields, deadline-consumed fields and `askedWhenClauses` fields, and accepts a field
appearing only in the third. That is the same code quoted in S1: the guard whose stated purpose is
to catch fields that change nothing treats scoping-only consumption as sufficient, and
`generator_present` is a published field in exactly that position today. For the short-circuit
route, no guard is involved at all: the five rows above are published v2.8 rules behaving as
written.

**What follows for #108, stated as measurement rather than recommendation:** a future published rule
that gates a question, where a plan diff between the answered and unknown submissions shows the
requirement DROPPED and nothing added in its place (the S3 row of the comparison table above),
reintroduces exactly the silent requirement-drop #108 alleges, and the F-102 rendering fix would not
touch it, because there is nothing in `verdictDetail` to render. Whether that is worth
acting on before such a rule exists is the product owner's call, and this document does not make it.

## S5. What this does not establish

- It does not show that any such gate is likely, or that anyone intends to write one. It shows the
  loader accepts it, that v2.8 already carries scope-only gates, and that the engine goes quiet on
  the shape.
- The re-typing of `generator_present` from boolean to a three-state enum is synthetic. What it
  shows is that IF the gate can carry `"unknown"`, the requirements below it that nothing else
  reports are lost silently, which S4's finding-set diff shows is not every requirement below it; it does
  not show that anyone will re-type it. As published, `generator_present` is a boolean and
  `validateIntake` rejects `"unknown"` for it, and `events.generator_present` is `boolean, notNull`,
  so the contract and the schema each close this route on v2.8 today.
- **It is not an end-to-end product result.** The probe passes `parseEngineRuleset`,
  `parseIntakeContract`, `validateIntake` and `evaluate`, and cannot pass persistence, so no stored
  event can exist in this state and the plan service cannot reload one. What it establishes is that
  the contract and the engine lose the requirement silently, not that a real submission can get
  there.
- The probe uses `=` for the gate clause. Round 1 established that `!=` clauses keep dependents in
  scope, so a gate written with `!=` does not exhibit this.
- S4's short-circuit result is measured on one submission (approved scenario A). Which rules
  short-circuit depends on what their sibling conditions evaluate to, so the split is per-submission
  rather than a property of the ruleset.
- The accepting-trigger case in S4 is measured on `DOHMH-EXEMPTION-001` and checked against the two
  other accepting rules the engine comment names across the six approved scenarios. It shows that a
  plan-changing invisible unknown is expressible and that v2.8 does not currently produce one, not
  that no other published rule shape could.
