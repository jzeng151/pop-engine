# A merged dedupe line keeps every route, and its headline mode says why the routes co-fired

**Status:** APPROVED 2026-08-08 by the product owner (recorded in `docs/BASELINE.md`; AD-19 amended
in `docs/ARCHITECTURE-FUTURE.md` §2). It was PROPOSED from the day it was written until that date,
and the engine implemented it while it was unapproved; `SPEC-CONFLICT` #253 records that divergence
and the approval closes it. What the approval covers is the design in sections 3 to 8 as written:
one route list carrying each route's own published values and its own trigger result, the two
headline modes and how they are computed, the mixed resolved-and-unknown case answered per route
rather than by a third mode value, and the verdict reading the routes. It supersedes exactly the one
sentence of AD-19 named in section 9. §4.2's closing paragraph was amended on 2026-08-09 by a
product-owner decision recorded in `docs/BASELINE.md`, which corrects what that paragraph said about
how the draft's `nypd_sound` prohibition renders. That amendment approves nothing new, moves no
other section, and changes no engine behaviour; the 2026-08-08 approval stands as given.

**Issue:** #239 (dedupe merge), continuing PR #244.
**Reads:** `docs/research/draft-dedupe-cofiring.md` (MEASUREMENT, branch `measure/draft-dedupe-cofiring`, PR #251),
`docs/ARCHITECTURE-FUTURE.md` §2 AD-19 and §8.4, `docs/BASELINE.md` (AD-19 record),
`docs/OPEN-QUESTIONS.md` T-12, `specs/F-102-feasibility-verdict.md`, `specs/F-103-scope-comparator.md`,
`specs/F-201-permit-plan-generator.md`.
**Approval:** given 2026-08-08 by the product owner, under `docs/DOCUMENTATION-GOVERNANCE.md` §6,
on all four rows section 10 lists. Recorded in `docs/BASELINE.md` and in AD-19.

## 1. What is wrong, stated once

Rules sharing a `dedupe_key` merge into one plan line. That line has room for one permit name, one
deadline, one fee, one portal. When two members publish different values, something has to choose.

Three orderings have been tried. `{ ...first }` chose by file position (#239). PR #244 round 2 chose
one binding route for every field. PR #244 as it stands splits the choice per field: identity
(`kind`, `name`, `agency`, `feeDisplay`, the three portal fields, `verificationStatus`, `noteText`,
`conflictText`, the summary heading) follows the strongest disposition, and the timeline (`deadline`,
`deadlineDisplay`, `latestApplyDate`, `applyAfterDate`, `deadlineStatus`, `slackDays`,
`timelineUnresolvedReason`) follows the tightest window.

Each ordering moved the defect. The current one produces a line that names route A and quotes route
B's deadline and status, with A's own window unrecoverable from anywhere on the finding. PR #244's
own suite pins an instance of it: a line whose disposition is `prohibited_or_ineligible`, whose name
is "barred route", whose `latestApplyDate` is `2026-10-20` and whose `deadlineStatus` is `on_track`.
Rendered, that is "barred route, not eligible at this location, apply by 2026-10-20, on track", and
F-203 schedules deadline reminders at a date belonging to a permit the line says the organizer may
not file for.

The reason is structural rather than a bad choice among three. **When the strongest disposition and
the tightest window select different routes, no ordering of "one route decides every field" can be
right, because the merged line has one slot and two routes have a claim on it.** The fix is not a
fourth ordering. It is to stop making the line the only place a route's facts can live.

## 2. What the measurement changed about the design

`docs/research/draft-dedupe-cofiring.md` measures, per dedupe group, how often two or more members
produce a finding for the same event. Four of its results are load-bearing here.

**A trigger that evaluates `unknown` produces a finding and enters the merge exactly like a `true`
one** (`findings.ts:562`, measurement §2). So a "co-firing group" is two different situations wearing
one shape.

**Five of the draft's nine multi-member groups never co-fire on answered facts** (measurement §4.2).
They reach two or more members only through unknowns. `sapo_permit` merges up to fourteen members
onto one line, and only ever when `sapo_event_type` is unanswered.

**Three of the groups that do co-fire on answered facts publish byte-identical outputs.**
`dob_temporary_structure` (5 members, merges on 26.0% of its sweep), `fdny_generator` (3 members,
8.5%) and `dob_assembly` (3 members, 7.5%) have nothing to reconcile (measurement §5.2, §5.7, §5.8).

**The groups that disagree substantively disagree only under unknowns**, except one.
`sapo_permit`, `sla_alcohol` and `sapo_insurance` reach their conflicts only through an unanswered
classifying question. `nypd_sound` both co-fires on answered facts and disagrees. So does
`block_party_eligibility`, on 7.9% of a 19.5-million-intake factorial, though its two members
publish no permit name, deadline, fee or portal, so its conflict is confined to disposition
(measurement §5.9).

The conclusion the measurement forces: **the merge is usually not reconciling "two rules both apply".
It is usually collapsing "we do not know which of these applies" into one line and picking one
candidate's name, window and fee.** That is information-destroying, and it destroys the most
information exactly when the organizer knows the least. No per-field ordering addresses that,
because the problem is not which route wins the slot. It is that there is one slot.

The published ruleset is a smaller version of the same thing, not an exception to it. Its one
multi-member group, `dob-structure`, co-fires on 15.8% of a 3,200-intake control sweep and on 3.3%
with everything answered, and its two members differ in name, disposition, deadline and fee
(measurement §4.3). Any claim that this is only a draft-ruleset problem is false.

## 3. The data shape

### 3.1 What is added

One new type, and two optional fields on `Finding`.

```ts
/**
 * One contributing rule of a merged dedupe group, with its own published values and its own
 * trigger result. Every value here is the rule's own; nothing on a route is derived from the
 * group.
 */
export type FindingRoute = {
  readonly ruleId: string;
  /** "true" or "unknown". A route is never "false": a false trigger produces no finding. */
  readonly triggerResult: Tristate;
  readonly disposition: Disposition;
  /** The intake fields this route's OWN trigger could not resolve; empty when it resolved. */
  readonly unknownFields: readonly string[];
  readonly name: string | null;
  readonly agency: string | null;
  readonly deadline: Deadline | null;
  readonly deadlineDisplay: string | null;
  readonly latestApplyDate: string | null;
  readonly applyAfterDate: string | null;
  readonly deadlineStatus: DeadlineStatus;
  readonly slackDays: number | null;
  readonly feeDisplay: string | null;
  readonly portalName: string | null;
  readonly portalUrl: string | null;
  readonly portalInstructions: string | null;
};

export type HeadlineMode = "applies_together" | "candidate";
```

On `Finding`:

```ts
  /** Present exactly when this finding merged two or more rules. */
  readonly routes?: readonly FindingRoute[];
  /** Present exactly when `routes` is. Derived from the routes' own trigger results. */
  readonly headlineMode?: HeadlineMode;
```

`route.disposition` is the value `resolveDisposition()` produced for that rule on its own, before
any group arithmetic: the rule's published disposition, demoted to `may_be_required` when the rule
publishes `required` and its own trigger resolved `unknown`. It is not the group's disposition and
is not capped by the unresolved-route ceiling. That is the point: the ceiling is a statement about
what the merged HEADLINE may claim, and a route entry claims nothing about the group.

`route.unknownFields` is what lets the candidate copy name the question that decides a route. It is
per route rather than per finding because `deadlineUnknownFields` on the merged line concatenates
over the group and says which answers stopped a DATE resolving, which is a different question from
which answers stopped a ROUTE resolving.

`route.applyAfterDate`, `route.deadlineStatus` and `route.slackDays` carry any dependency sequencing
that applied to that route, so the route list and the headline never disagree about a sequenced
window.

**`verificationStatus` is deliberately not on a route.** `rejectMixedDedupeVerificationStatuses()`
(`packages/engine/src/ruleset.ts:665`) refuses at load any ruleset whose dedupe key mixes
verification statuses, so within a group it is a constant and a per-route copy would carry no
information. This is a departure from `specs/F-103-scope-comparator.md`'s Route 2, which names both
`disposition` and `verificationStatus`; see section 8.

### 3.2 Present exactly when the finding merged

`routes` and `headlineMode` are absent on a finding that came from a single rule. A single-rule
finding is its own route and every scalar on it is that rule's; a one-entry list would restate the
finding and would make "did this merge?" unanswerable from the shape.

The consequence, stated so it is not discovered later: **every consumer that reads `routes` must
fall back to the finding itself when `routes` is absent.** The engine ships one helper for that,
`routesOf(finding)`, which returns `finding.routes` when present and a single synthesized route
built from the finding otherwise. There is exactly one correct fallback and no consumer should be
writing it twice.

### 3.3 What is dropped from the current merged finding

**Nothing on the finding is removed.** Every field `mergeGroup()` produces today it still produces.
What is dropped is a RULE, not a field: the identity/timeline split.

Today identity comes from the tightest-window route among those contributing the merged disposition,
and the timeline comes from the tightest-window route over the whole group. Under this proposal both
come from ONE route, the binding route (section 4.3). The split existed for one reason, stated in
`findings.ts:305-308` and in AD-19: a published filing window may never be dropped for sitting in a
weaker disposition tier. That reason is gone, because the window is no longer dropped. It is on the
route entry, and section 6 makes the verdict read it.

So the change to the finding's scalars is: **`deadline`, `deadlineDisplay`, `latestApplyDate`,
`applyAfterDate`, `deadlineStatus`, `slackDays` and `timelineUnresolvedReason` move from the
whole-group window binding back to the identity binding.** That is the part of AD-19 this supersedes,
and it is the only part.

## 4. The two headline modes

### 4.1 How the mode is chosen

```
resolved = routes where triggerResult === "true"
mode = resolved.length === routes.length ? "applies_together" : "candidate"
```

**`applies_together`.** Every contributing trigger resolved. These rules genuinely apply together:
each one's own conditions are met on the facts as answered. The headline carries the strongest
disposition, as AD-19 already has it, and the routes are listed so an organizer sees every filing
the group holds rather than one of them.

Where the routes publish identical values, the routes block renders nothing and the line is exactly
what it shows today. That is not an optimization; it is a requirement. Three of the draft's nine
groups are in that state (`dob_temporary_structure`, `fdny_generator`, `dob_assembly`), and they are
the ones that merge most often. A "both of these apply" block listing the same permit twice would be
a rendering fault presented as regulatory content.

**`candidate`.** At least one contributing trigger did not resolve. The group holds routes that are
not known to apply, and on the measurement's own numbers this is the common case: five of nine draft
groups reach two members only this way, and `sapo_permit` reaches fourteen only this way. The
headline names the question that decides it, and every route is listed with its own name, window and
fee. Nothing on the line asserts that a candidate route applies.

### 4.2 The `nypd_sound` question, and the answer

`nypd_sound` is the group the two modes were not written for. From the measurement §5.5 and §6, the
sets are:

| set                                                                            | count of 360 | shape                                    |
| ------------------------------------------------------------------------------ | ------------ | ---------------------------------------- |
| `NYPD-SOUND-PUBLIC-001` true + `...COMMERCIAL-ADVERTISING-PROHIBITED-001` true | 15           | both resolved, and they disagree         |
| `NYPD-SOUND-PRIVATE-AUDIBLE-001` true + prohibition true                       | 3            | both resolved, and they disagree         |
| permit true + prohibition unknown                                              | 54           | one resolved, one not, and they disagree |

The 54-intake set is the shape neither mode fits: the permit definitely applies, with a
`published_minimum` of 5 calendar days, a $45-plus-$5 fee and a precinct portal; the section 10-108
prohibition may or may not apply, because `sound_purpose` is unanswered.

**Decision: the mode is derived from a per-route property, and the headline is derived from the
resolved subset. There is no third mode value.**

`triggerResult` lives on each route. `headlineMode` is computed from those and stored only so a
client does not have to recompute it; it carries no information the routes do not. When the resolved
subset is non-empty, the binding route is chosen from it; when it is empty, from the whole group.
The 54-intake set therefore renders as: the Sound Device Permit as the headline, with its own
5-day window, its own fee, its own portal, and the prohibition listed beneath as a candidate route
naming `sound_purpose` as the question that decides it.

**Justified against the actual sets rather than against taste.** Three reasons, in order of weight.

1. **A third value would have to mean two things at once about two different routes.** On the
   54-intake set, a group-level `mixed` would have to be true of a route that definitely applies and
   of a route that might. There is no headline sentence a group flag can produce that is true of
   both without naming which route is which, and once the routes are named the flag has added
   nothing. The per-route property is where the fact already lives.

2. **A third value collapses distinctions the widest group in the draft actually makes.**
   `sapo_permit` reaches sets of 1 resolved + 13 unresolved and sets of 0 resolved + 14 unresolved
   (measurement §5.1; the 14-of-14 set occurs 10 times, and the distribution runs 2, 3, 4, 5, 6, 7,
   8, 9, 10, 11, 12, 14). A group flag makes those the same value. They are not remotely the same
   organizer situation: the first names one permit that definitely applies plus thirteen questions,
   the second names fourteen questions and no answer. Deriving the headline from the resolved subset
   separates them for nothing: the first has a resolved subset of one and reads as that permit, the
   second has an empty resolved subset and reads as the question.

3. **A stored third value is an asserted fact no route publishes.** Every other value in this design
   is either some route's own published value or its own trigger result. `mixed` would be the one
   value the engine invents about a group, on a shape no approved artifact describes, and inventing
   regulatory-adjacent vocabulary is what `AGENTS.md` forbids. `headlineMode` as a derived
   two-valued convenience is defensible because it is recomputable from the routes and adding a
   third value to it would not be.

**The alternative rejected: `headlineMode: "applies_together" | "candidate" | "mixed"` as a
group-level flag.** It was rejected for the three reasons above, and one more that is specific to
the measurement: `nypd_sound` is the ONLY group of the nine that would ever take the third value on
answered facts, and it takes it on 54 of 360 intakes in one draft ruleset that does not load through
`parseEngineRuleset` today (measurement §3.1). Adding a third state to a shared enum, which is a
governance §6 row of its own, to describe one group of one unloadable draft, is the wrong trade
against a per-route property that describes every group including that one.

**The prohibition on the both-resolved sets, amended by the product owner on 2026-08-09.** This
decision does not settle blocker handling in general, and the 15-intake and 3-intake both-resolved
sets do render the prohibition today. On both sets each route's own trigger resolves `true`, so
`unresolvedRouteCeilingApplies` does not cap what the prohibition contributes,
`prohibited_or_ineligible` is the top of `DISPOSITION_STRENGTH`, and §4.3 steps 2 and 3 bind the
headline to that route: it is the only route contributing the merged disposition, and it is in the
resolved subset. The rule still publishes no `output.disposition` and needs none, because it
declares `kind: "prohibition"`, which `DEFAULT_DISPOSITION_BY_RULE_KIND` (`proposals.ts:54`) maps to
`prohibited_or_ineligible`. The `eligibility` row this paragraph used to cite is no longer the row
that applies. **Why it changed.** PR #254, merged as `91a1894b`, rewrote `kind` from `eligibility`
to `prohibition` on the four blocking rules of the draft, on the finding that declaring "blocking"
only through `severity` and `output.status`, which no engine code reads, was a rule-authoring error
rather than the rules-schema gap this paragraph had diagnosed it as. The engine's map did not
change; the artifact did. What is unchanged by it and by this: `rules/proposals/*` is still draft
material, the draft still does not load through `parseEngineRuleset` for the unrelated reasons at
measurement §3.1, and nothing here approves it.

### 4.3 The binding route

The headline's identity AND its timeline both come from one route:

1. compute the headline `disposition` exactly as AD-19 does today: the strongest disposition any
   route contributes, where a route whose own trigger resolved `unknown` contributes no more than
   `may_be_required` if and only if the group holds a route whose own trigger DID resolve at or
   above that ceiling (`unresolvedRouteCeilingApplies`, `contributedDisposition`). Unchanged. It
   never understates what an organizer must do.
2. take the candidate set: routes contributing that disposition, intersected with the resolved
   subset when the resolved subset is non-empty.
3. the binding route is the candidate with the most available window, ties broken by the earlier
   published date and then the lower rule id (`compareBinding`, `windowAvailability`). Unchanged.

Step 2's intersection is new and is the mechanical form of "the headline is derived from the
resolved subset". It only ever moves the headline from a route that might apply to one that does.

The four single-valued published texts (`noteText`, `conflictText`, the summary heading,
`timelineUnresolvedReason`) still fall back through the remaining routes in binding order where the
binding route publishes none, so no published caveat is dropped. They now all use one order, because
there is now one binding.

## 5. Organizer-facing copy

Every string below is either a route's own published value carried verbatim, an intake field name
the registry declares, or one of the fixed sentences given here. Nothing composes a regulatory claim.

### 5.1 `applies_together`, routes publishing identical values

Renders exactly as today. No routes block, no additional sentence. `dob_temporary_structure`,
`fdny_generator` and `dob_assembly` are this case.

Two routes "publish identical values" when their `name`, `agency`, `disposition`, `deadlineDisplay`,
`latestApplyDate`, `deadlineStatus`, `feeDisplay`, `portalName`, `portalUrl` and `portalInstructions`
are all equal. That is a comparison of published values, not a judgement.

### 5.2 `applies_together`, routes differing

Heading unchanged (the binding route's). Beneath the line's summary:

> **Both of these apply.** The published rules give more than one route to this requirement, and on
> the answers recorded in this plan each of them applies.

For three or more routes, "Both of these apply" becomes "All of these apply." Then one entry per
route:

> **{route.name or route.ruleId}**: {humanized route.disposition}{, route.agency}
> {route.deadlineDisplay}{ · apply by {route.latestApplyDate}}{ · {humanized route.deadlineStatus}}
> {route.feeDisplay}
> {portal block, as the line already renders one}

### 5.3 `candidate`

The heading is the question, not a permit. Above the routes:

> **The answers so far do not say which of these applies.** {N} published routes are open on the
> answers recorded in this plan{, and {M} of them applies on the answers so far}. Answering
> {field list} would decide it. Until then, treat none of the routes below as settled.

The `{M} of them applies` clause is present only when the resolved subset is non-empty, and it
names the resolved routes. `{field list}` is the `deadlineUnknownFields` and trigger fields the
unresolved routes' triggers left open, humanized by the same `humanize()` the line already uses on
`deadlineUnknownFields`.

Then one entry per route, in binding order, each labelled:

> **Applies**: {route.name or route.ruleId} … (for a resolved route)
> **May apply**: {route.name or route.ruleId} … (for an unresolved route)

with the same body as 5.2.

**A candidate list must not read as a list of requirements**, and three things enforce that: the
list is introduced by a sentence that says the answers do not decide it; every unresolved entry is
prefixed "May apply"; and no entry is rendered as an action. The line's existing "Next step" summary
point is not repeated per route.

### 5.4 What the copy does not say

It does not say a candidate route does not apply. It does not rank the candidates by likelihood. It
does not total the fees. It does not say how many routes an organizer will end up filing. The
system knows none of those things.

## 6. The verdict

`computeWindowVerdict()` (`packages/engine/src/verdict.ts:46`) currently reads the merged finding's
single `deadlineStatus`, `slackDays` and `disposition`. Once every route retains its own window, it
reads the ROUTE LIST instead:

- a finding is missed when ANY of its routes is `published_deadline_missed`;
- `missedRuleIds` are the rule ids of the missed ROUTES, not of the whole group;
- `minSlackDays` is the minimum over routes that are not missed;
- the blocking finding is selected over routes whose OWN disposition is exactly `required` and whose
  own window is missed, earliest `latestApplyDate` first, and it is returned as the merged finding
  narrowed to that route's `ruleIds`, `name`, `disposition` and `latestApplyDate`, so the copy names
  the route that blocks rather than the line that holds it.

**What this does NOT change: what a verdict MEANS.** The four verdicts, their ranks, the branch
expansion, the unknown handling, the rescope ladder, the `MISSED_MAY_BE_REQUIRED_IS_CONDITIONAL`
treatment and the `pathVerdicts` arithmetic are all untouched. Only which findings the window check
reads changes.

**What it buys.** Merging two rules under a shared `dedupe_key` becomes verdict-neutral by
construction: the window check sees the same set of (disposition, deadlineStatus, slackDays,
latestApplyDate) tuples whether the rules share a key or not. That is the whole content of what
earlier rounds called "the bigger fix", and it falls out of the data shape rather than being a
separate rule.

**KNOWN RESIDUAL, not fixed here.** `computeWindowVerdict` blocks only on a disposition of exactly
`required` (`verdict.ts:55`), so a route whose disposition is `prohibited_or_ineligible` with a
missed window reads CONDITIONAL rather than INFEASIBLE. That is pre-existing, it applies to a lone
unmerged finding of that shape too, it is filed, and it is F-102's to decide. Widening the filter
would be a change to what a verdict means, which this proposal explicitly does not make.

## 7. API and clients

### 7.1 What the response gains

`FindingRendering` in `apps/api/src/plan.ts` gains two optional members, alongside `user_summary`:

```ts
  /** Absent on plans stored before the route list was introduced. */
  routes?: readonly FindingRoute[] | null;
  /** Absent on the same plans. */
  headline_mode?: HeadlineMode | null;
```

They ride in `verdict_detail.finding_renderings` for the same reason `user_summary`, `notes`,
`note_text`, `conflict_text` and the rest do: migration 001 is merged and immutable and a feature
branch does not add columns (`AGENTS.md`). This is reported as a schema gap for a later migration,
exactly as the existing block is.

### 7.2 Does an older client break

**No, and the reason is a precedent rather than an assurance.** Plans are persisted and replayed. A
plan stored before this change carries no `routes` key in its stored rendering. Three properties
make that safe:

1. **Additive only.** No existing field changes name, type or nullability. A client that does not
   read `routes` sees exactly the response it saw before, except where the headline moved (section
   9), which is a value change within an existing field and not a shape change.
2. **Optional-and-normalized, which is the established pattern.** `user_summary` is declared
   `user_summary?: Finding["userSummary"]` on the rendering type, written as `finding.userSummary ??
null`, and read back as `rendering.user_summary ?? null` (`plan.ts:149`, `162`, `511`). `routes`
   and `headline_mode` follow that exactly: optional on the type, normalized on write, normalized to
   `null` on read. A replayed pre-change plan reads `routes: null`.
3. **`null` has a defined meaning and it is not "no routes".** `routes: null` means the stored plan
   predates the field, and a consumer falls back to the finding itself, which is what it did before
   the field existed. `routes: []` is never emitted. A merged finding always has two or more routes
   and an unmerged one omits the field entirely.

The web client reads `routes` only through the same fallback, so a replayed pre-change plan renders
as it did.

**The one thing that is not backward compatible, stated rather than buried:** a plan REGENERATED
after this change may carry a different headline from the plan stored for the same event before it,
in the cases section 9 lists. That is a plan-generation change, not a replay change; AD-7 replay of
a stored artifact is unaffected because a stored plan's scalars are read from its own columns.

## 8. Approved specs whose acceptance criteria change

**`specs/F-102-feasibility-verdict.md` (APPROVED).** The window checks are F-102's. This changes
which findings they read. AC 5's slack definition (`latest_apply − apply_after`) is unchanged in
meaning but is now computed per route; AC 6's missed-window reporting now names missed routes rather
than the merged line. F-102's acceptance criteria have to be re-stated in terms of routes before
this is implementable as F-102 work. **That is a change to an approved spec's acceptance criteria
and is the product owner's under governance §6.** F-102 also owns the residual in section 6.

**`specs/F-201-permit-plan-generator.md` (APPROVED).** F-201 AC 1 requires every finding to reference
its rule ID, and the merged finding still does. What changes is that a merged line now carries
per-route detail F-201's output contract does not describe. F-201's acceptance criteria have to name
`routes` before a plan carrying it satisfies them.

**`specs/F-103-scope-comparator.md` (PROPOSED, not approved).** Its Route 2 already names part of
this shape: "per-contributing-rule `disposition` and `verificationStatus` on `FindingSource`, which
is what lets this metric apply unresolved-wins across a group instead of reading one scalar chosen by
position". This proposal **is** Route 2, in a different place and with one member dropped.

- Same intent: per-contributing-rule `disposition`, so `permit-burden/v1`'s definite/unresolved split
  reads each route rather than one merged scalar.
- Different carrier: a `routes` list rather than fields on `FindingSource`. `FindingSource` is a
  citation (`ruleId`, `citation`, `urls`) and is emitted once per source; a route is a filing, with a
  window and a fee. Putting a disposition on a citation would make `sources` do two jobs.
- `verificationStatus` dropped, for the reason in section 3.1: it is a constant within a group by
  load-time guard, so a per-route copy carries no information. If F-103 wants it anyway, that is
  F-103's call and the field is trivial to add; this proposal states why it is absent rather than
  omitting it silently.
- **This does not close #239 and does not satisfy F-103 AC-03.** Whether the route list satisfies
  AC-03 is F-103's approval to make, exactly as `docs/BASELINE.md` records for AD-19. F-103 is
  PROPOSED and its approval blocker is its own.

**`docs/test-scenario-answer-key.md`.** Scenario E's item 8 describes the DOB line as "One finding
carrying both rule ids". Under this proposal that line also carries a two-entry route list and a
`candidate` mode, because both DOB rules evaluate `unknown` at Scenario E's intake
(`tent_area_sqft: 400` on a `boundary: "conditional"` comparison, `structure_over_10ft_tall:
"unknown"`). The answer key's prose is still true and its rendering guidance gains a case. Scenario
E's own decided values do NOT move: with both routes unresolved the binding route is unchanged, and
the deployed configuration still renders the tent permit's name, its `not_calculable`
15-business-day window, its TUP fee and its heading. Section 9.1 states which `nyc.v2.11` intakes do
move.

## 9. Interaction with AD-19, and what is superseded

**AD-19 is amended, not left standing beside a second rule.** `docs/ARCHITECTURE-FUTURE.md` §2 AD-19,
its §8.4 note, and its `docs/BASELINE.md` record all state the per-field identity/timeline split as
the rule in force. Two rules stated as both in force is the failure this avoids, so the branch
carrying this proposal wrote a SUPERSESSION NOTICE onto AD-19's own row and onto the §8.4 note,
naming this document, naming the single sentence that would be replaced, and saying that until the
product owner approved it AD-19's row was the rule in force. **On 2026-08-08 the product owner
approved it**, so the supersession is now applied rather than noticed: AD-19's row records the
approval and states the replaced sentence as replaced, and the notice's conditional wording goes
with it. Amending an approved ADR is the product owner's under governance §6, and this records that
amendment rather than making it.

Precisely what of AD-19 survives and what does not:

**Survives.** The reading that a group's members are alternative published routes to one
requirement. The strongest-contributing-disposition rule. The unresolved-route ceiling and its
carve-out (the ceiling applies only where the group holds a resolved route at or above it). The
four-level window availability order. The earlier-date and lower-rule-id tie-breaks. The
concatenation of `ruleIds`, `notes`, `sources`, `triggeredBy`, `deadlineUnknownFields` and summary
points in contributing order. `lastVerifiedDate` as the earliest across the group. The
single-valued-text fallback. The collision rule where §8.4's blocking-finding guarantee meets its
no-promotion guarantee.

**Superseded.** Exactly one sentence: that identity and timeline read from different routes. Under
this proposal they read from the same route, and the reason AD-19 split them (a published window must
not be dropped for sitting in a weaker disposition tier) is satisfied by the route list and the
verdict read instead.

**Extended.** The binding route is now chosen from the resolved subset when one exists. AD-19 has no
position on that, because before the route list the trigger result was invisible to every field but
the disposition.

**AD-19's recorded loss is recovered.** Its BASELINE record states: "Where the merged disposition is
`prohibited_or_ineligible` and the group's tightest window has closed, the merged line carries
`published_deadline_missed` … but the plan reads CONDITIONAL where the same two rules read INFEASIBLE
without a shared key." Under section 6 the verdict reads the closed route's own `required`
disposition, so that case reads INFEASIBLE, the same as unmerged. What is NOT recovered is the case
where the closed route's own disposition is `prohibited_or_ineligible`; that is the residual in
section 6 and it is unmerged behaviour too.

### 9.1 What moves on the published ruleset

**THE 64 THIS SECTION USED TO STATE IS WITHDRAWN, and the field set it claimed was wrong as well as
the count.** It was measured over an unrecorded base intake by a harness that was never committed,
and neither committed harness reproduces it. The standard is this branch's own, stated in AD-19
where it withdrew the 224 of 1,600: a number in a governing record nobody can reproduce is the
shape of claim this PR series exists to remove. It applies to the figure this section inherited as
much as to the one it corrected, so the 64 is withdrawn rather than reported beside a reproducible
figure as though the two were alternatives. What replaces it is what
`scripts/dedupe-route-sweep.mts` produces from this tree, on the same four dimensions with every
other collected intake field answered, run against this branch's engine and against `main`'s:

- **56 of 3,200 plans differ from `main`, on both a published and an unpublished holiday list. 0
  verdicts differ on either.** PR #244's head is byte-identical to `main` on the same sweep, so
  those 56 are this proposal's, not #244's.
- **Every one of the 56 has `structure_over_10ft_tall: "yes"` with the tent rule unresolved.** On
  those intakes the tall-structure rule DEFINITELY applies and the tent rule might.
- **What changes on them is the NAME, and only the name.** It moves from the tent route to the
  tall-structure route. The filing date, the deadline status, the fee and the number of
  `deadline_reminder` alerts the F-203 scheduler writes are identical to `main` on all 56, read off
  the tent route and attributed to it. The withdrawn figure claimed the deadline, apply-by date,
  status, slack, fee and summary heading moved too; they do not, and `docs/BASELINE.md` and
  `docs/ARCHITECTURE-FUTURE.md` §2 AD-19 state the same field set as this bullet.
- **Why the move is correct:** the tall-structure rule's trigger resolved and the tent rule's did
  not, so the line now reads as the route that is known to apply. Nothing published is lost: the
  tent route's name, window and fee are on its route entry, and its rule id, citation, notes and
  summary points concatenate onto the line as they already did.

This is a change to an organizer-facing outcome on the published ruleset, and it is why section 10
routes this through the product owner rather than treating it as an engine refactor.

**`docs/OPEN-QUESTIONS.md` T-12 stays open.** This is still not §8.4's precedence table. It is a
better stand-in for it, and publishing the real table still supersedes it.

## 10. Approval this would need

Under `docs/DOCUMENTATION-GOVERNANCE.md` §6, this matches three rows at once and the product owner
approves each:

| what                                                                | row                                                                                                                                                                       |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| the merge rule and the verdict read                                 | "Rule trigger, dedupe, branch, deadline, or formula semantics"                                                                                                            |
| `routes`, `headlineMode`, the `HeadlineMode` enum, the API response | "Event Input, rules schema, OpenAPI, shared enum"                                                                                                                         |
| a new organizer-facing outcome (the candidate list and its copy)    | "Product scope, feature meaning, phase", and the first row, because the copy states permit, deadline and fee facts and so is regulatory publication rather than copy-only |
| superseding AD-19's identity/timeline split                         | "Durable architecture decision or dependency", recorded as an approved ADR                                                                                                |

**Approved on all four rows at once, 2026-08-08, by the product owner**, which is the whole
requirement for each since the second-party review requirement was retired on 2026-08-05. The record
is the dated decision in `docs/BASELINE.md`; the durable-architecture row's ADR obligation is met by
the amendment to AD-19 rather than by that record alone, because §6 carves that row out and an
approval leaving no ADR does not satisfy it.

## 11. What this does not establish

- It does not publish a ruleset, change a rule, a trigger, a deadline, a fee, an agency, a threshold,
  a portal, an exception or a verification status.
- It does not decide `docs/OPEN-QUESTIONS.md` T-12 or write §8.4's precedence table.
- It does not close issue #239 and does not decide F-103 AC-03.
- It does not change what any verdict means, and does not widen `computeWindowVerdict`'s
  `required`-only blocking filter.
- It does not make the draft ruleset loadable. `rules/proposals/nyc-rules.v2-full-draft.json` still
  fails `parseEngineRuleset` for the reasons in the measurement §3.1, and the draft's blocker
  vocabulary is still unread by any engine code.
- It does not make a merged plan order-independent end to end: the retained lists still concatenate
  in contributing order, so the rendered summary-point order still follows file position. That is
  retention, which is the approved contract.
- It does not claim the route list is what an organizer should see in every case. It claims the
  facts are no longer destroyed, and it proposes one rendering of them.
