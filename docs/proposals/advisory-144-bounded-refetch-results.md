# Results of the bounded re-fetch for the #144 advisory reconciliation

**Status:** `PROPOSED`, one of governance section 3's five states.

**This document promotes nothing and publishes nothing.** It is the evidence a promotion decision
would rest on, not the decision. No rule, ruleset, spec, answer key, BASELINE row or engine file is
changed by it, no verification status is moved, and no advisory text is narrowed or removed.
**Promotion is the verification owner's act**, recorded under a named reviewer, and no fetch result
promotes itself.

**It is also not a dossier round.** `docs/VERIFICATION-SOURCES.md` is the verification owner's record
and is untouched. What follows is a proposal for a round, in the shape Round 5 and Round 6 use, so
that adopting it is a copy rather than a rewrite.

**What it does.** It performs section 3 of `docs/proposals/advisory-144-bounded-reconciliation-scope.md`
(PR #177) and maps the results through section 4's per-claim outcome functions. It serves the product
owner's decision of 2026-07-28 on issue #144 and the amendment of the same date. The publication half
is separately blocked on issue #178, where four pieces of work already claim the next ruleset version.

> ## MERGE ORDER: this file must not merge before PR #177
>
> `docs/proposals/advisory-144-bounded-reconciliation-scope.md` **is not in this tree.** It is PR
> #177's file and PR #177 is unmerged. The section 3 fetch list this document executes and the
> section 4 outcome functions it maps through therefore **cannot be opened by a reviewer of this
> branch alone**, and a reader who lands on `main` after this merges but before #177 does would find
> every cross-reference below dangling.
>
> **This document depends on that file and does not treat it as available or authoritative.** Every
> claim below rests on a quote from a page retrieved on 2026-07-28, reproduced here and committed
> alongside this file, not on anything PR #177 asserts. What #177 supplies is the question list and
> the outcome mapping, which is why the order matters and the dependency is not removable by
> restructuring.
>
> **The rule this states, learned on #177 itself:** a document may DEPEND on an unmerged artifact and
> must not treat it as available or authoritative. #177 was first told to cite an unmerged file, then
> told to defer to one, and both were wrong for the same reason. Stating the dependency and the order
> is the version that is neither.

**Headline, because it changes the shape of the decision.** The CECM FAQ **does** carry an alcohol
prohibition, and it names all four of the categories `ADV-ALCOHOL-PUBLIC-001` prints. The dossier
fetched that page four times without capturing the sentence. Section 5 states what that does and does
not settle, including for issue #181, and section 6 reports two places where section 4 has no state
for what the fetch actually found.

---

## 1. Method

**Retrieved 2026-07-28**, all eight URLs in section 3's table, with a browser user-agent:

```
Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36
```

**The dossier's 403 caveat still holds and was re-tested rather than assumed.**
`docs/VERIFICATION-SOURCES.md:5` records that most nyc.gov pages "block generic fetchers (HTTP 403)
and were retrieved with a browser user-agent". Against `fees.page` on the same day: `curl`'s default
user-agent returned **403**, a `Python-urllib/3.11` user-agent returned **403**, and the browser
user-agent above returned **200**. An empty user-agent also returned 200, which is a detail worth
recording for whoever automates this next; it is not what was used here.

**All eight returned HTTP 200. No page was unfetchable**, so nothing below is inferred from the
dossier in place of a retrieval.

**None of the eight publishes a "last updated" date**, checked rather than assumed, so **the retrieval
date is the as-of date**, exactly as Rounds 3 and 4 record for the same pages.

**The retrieved bytes are committed alongside this file**, under
`docs/proposals/advisory-144-refetch-2026-07-28/`, 240 KB across eight files. An earlier revision
recorded only the digests, which **proves nothing once the page changes**: a hash with no preimage
cannot be recomputed by anyone, so a later reviewer holding only the number can neither confirm the
quote nor detect a substitution. **This reconciliation exists because a dossier recorded a page and
that page's content is now in question**, which is the strongest possible argument for keeping the
bytes rather than a fingerprint of them.

| Row | Committed preimage | sha256 |
| --- | --- | --- |
| 1 | `01-block-parties.page.html` | `646dc3b274456dc5a722205c6c1059a93c790aaf0aa08bde8af3f33f2dbb56bb` |
| 2 | `02-frequently-asked-questions.page.html` | `abdada1ace8b3eaef356959c7a7d009825648dc28a28f139035b58a5c1c40f8d` |
| 3 | `03-permit-deadlines.page.html` | `95a1501394e7fc381647191d3ceb05c700d2fadfea1aafc2736dc3e85b67cec6` |
| 4 | `04-open-culture.page.html` | `8783f4b568e3ec30cbfea2d7bb579e6a27fdd4cc24639ebe94d0e96eadf9cda1` |
| 5 | `05-single-block-festivals.page.html` | `c846b615e7adbe12cc0804299a4e006a71ae3fbd12de18897a94ac13e262d4ff` |
| 6 | `06-street-events.page.html` | `80829da4f5d65761c470a3f6df4d9e3fbef5f1c3ecc2a37760b49f5b2713a8f0` |
| 7 | `07-street-festivals.page.html` | `11f4e567bdb64aca13735244302ea8fd68d937f25570221112ba07445f95ebce` |
| 8 | `08-fees.page.html` | `d02117d5b7b4aa91808961f3d20f573f128beb0f666b96cbc3ed85c80e4d36cb` |

Recomputable with one command from the repository root, and it depends on nothing but the files:

```
sha256sum docs/proposals/advisory-144-refetch-2026-07-28/*.html
```

**What the preimages do and do not settle.** They let anyone verify that a quote below appears in the
document that was retrieved, and they let anyone diff a future retrieval against this one. **They do
not establish that the page said the same thing before 2026-07-28**, which is section 4's point and
the reason section 5 leaves a question open rather than closing it. A stored copy is evidence of one
retrieval, not of a page's history.

---

## 2. Row by row, with the text

### Row 1, `https://www.nyc.gov/site/cecm/permitting/permit-types/block-parties.page`

Retrieved 2026-07-28. **The sentence is present as quoted.** Verbatim:

> Alcohol, vendors, commercial branding and sponsorships are not permitted at block parties

That matches `docs/VERIFICATION-SOURCES.md:194` (Round 4) word for word, including the trailing "at
block parties" that Round 2 #6 at `:115` omitted. Round 2 #6's other quotes from the same page are
also still present: "A block party is a community sponsored, public event where there are no sales of
goods or services", "Applicants must be a member of a block association and given permission by their
neighbors", and "Applications must be submitted 60 days prior to the event".

**Observation: alcohol prohibition sentence present as quoted.** Decides row 1, an input to A-1.

### Row 2, `https://www.nyc.gov/site/cecm/support/frequently-asked-questions.page`

Retrieved 2026-07-28. **This is the row that changes the decision.**

**2(a), the alcohol observation.** The page carries a question and answer the dossier does not record.
Verbatim, question and answer:

> Is alcohol allowed at my event?
>
> Alcohol is prohibited at Parades, Block Parties, Street Event and Street Festivals. To learn more
> about the sale of alcoholic beverages, please visit the Rules of City of New York.

"Street Event" is singular on the page; that is the source's text, not a transcription slip. The
closing link points at `library.amlegal.com`, Administrative Code title 10 chapter 1, anchor
`JD_10-125`. **That link was not followed**: doing so is source discovery, which section 6 of the
scope document places outside this task.

**Observation 2(a): an alcohol prohibition sentence appears, naming Parades, Block Parties, Street
Event and Street Festivals**, which is all four of the categories the advisory prints. Section 3
allowed sixteen states for this observation; this is the one where all four are named.

**2(b), 2(c), 2(d), the deadline observations.** From the same page's application-deadline list,
verbatim:

> Production Events - 10 days before the event.
>
> Street Festivals - December 31st of the year before the event.
>
> Single Block Festivals - December 31st of the year before the event.

**Observations: 2(b) production, as printed. 2(c) street festival, as printed. 2(d) single block
festival, as printed.**

Two further items on this page bear on later sections and are recorded rather than used. The same
list still publishes "Street Events - 14 to 45 days before the event, depending on the event size",
consistent with the dossier's RF-2 at `:16`. And the page separately states, verbatim, that a
"parade" is a procession "of 25 or more pedestrians, vehicles, bicycles, or other devices" and that
"Parade permits are issued by the New York Police Department (NYPD)."

### Row 3, `https://www.nyc.gov/site/cecm/permitting/permit-deadlines.page`

Retrieved 2026-07-28. From the "Street Activity Permit Deadlines" table, verbatim rows:

> Open Culture Events | 15 days
>
> Single Block Festivals | 90 days
>
> Street Festivals | December 31st of the year before
>
> Extra Large Events | Up to 60 days | Depends on Plaza Levels, if plazas are used

**Observations: open-culture figure as printed; single-block-festival figure as printed.** Both match
Round 2 #4 at `:113` and Round 2 #5 at `:114`.

### Row 4, `https://www.nyc.gov/site/cecm/permitting/permit-types/open-culture.page`

Retrieved 2026-07-28. Verbatim:

> Applications must be submitted 15 days prior to the event

**Observation: open-culture figure as printed.** Second of the two pages Round 2 #4 named.

### Row 5, `https://www.nyc.gov/site/cecm/permitting/permit-types/single-block-festivals.page`

Retrieved 2026-07-28. Verbatim:

> Applications must be submitted 90 days before the event.

**Observation: single-block-festival figure as printed.**

### Row 6, `https://www.nyc.gov/site/cecm/permitting/permit-types/street-events.page`

Retrieved 2026-07-28. **No alcohol provision appears on this page.** The string "alcohol" does not
occur in the retrieved document in any case form. The page's own list of what a street-event organizer
must keep in mind covers deadlines by size, site plan, insurance and the supporting-agency permits,
and names none for alcohol.

**Observation 6: no alcohol provision.**

### Row 7, `https://www.nyc.gov/site/cecm/permitting/permit-types/street-festivals.page`

Retrieved 2026-07-28.

**7(a): no alcohol provision.** The string "alcohol" does not occur in the retrieved document.

**7(b), the street-festival figure**, verbatim:

> Applications can be submitted as earliest as the first business day in November, but no later than
> December 31st of the year preceding the event

**Observation 7(b): as printed.** "December 31st of the year preceding the event" is the same reading
as the advisory's "Dec 31 of prior year" and as row 2(c)'s "the year before the event". The page adds
an opening date the advisory does not carry and the advisory does not contradict.

### Row 8, `https://www.nyc.gov/site/cecm/permitting/fees.page`

Retrieved 2026-07-28. The "Street Activity Permit Fees" table transcribes identically to Round 3's
capture at `:145` to `:161`, including the intro sentences. The five rows that decide B-1, verbatim:

> Street Festival | 20% of the total fees paid by vendors to participate
>
> Single Block Festival | 20% of the total fees paid by vendors to participate
>
> Production Events (with curb lane or sidewalk only) | $290 per day | Capped at $1,000 if over 3 days
>
> Production Events (with curb lane and sidewalk) | $700 per day
>
> Open Culture Event | Application fee only
>
> Extra Large Event | Up to $66,000

**There is no row labelled "plaza-and-street extra large".** The published label is **"Extra Large
Event"** on this schedule and **"Extra Large Events"** on row 3's deadline table, whose note reads
"Depends on Plaza Levels, if plazas are used". Round 3 of the dossier recorded the same thing, and
section 4 of the scope document predicted this observation exactly.

---

## 3. The claims, mapped through section 4

### 3.1 `ADV-ALCOHOL-PUBLIC-001`

| claim | inputs observed | section 4 outcome |
| --- | --- | --- |
| **A-1** block parties | row 1 present as quoted; row 2(a) names Block Parties | **The prohibition is supported by both pages. The actor is not.** See A-0 below. Retained iff the verification owner promotes |
| **A-2** street events | row 2(a) names Street Event; row 6 no provision | **The prohibition is supported by the FAQ. The actor is not.** Same |
| **A-3** festivals | row 2(a) names Street Festivals; row 7(a) no provision | **The prohibition is supported for street festivals only, and the actor is not.** See section 6, defect 1: the claim is broader than the sentence |
| **A-4** parades | row 2(a) names Parades | **The prohibition is supported by the FAQ. The actor is not, and here the record points the other way**: the same page says parade permits are issued by NYPD. See section 6, defect 2 |
| **A-0** the actor, "**SAPO** prohibits" | row 2(a); row 1 | **UNRESOLVED.** Neither page attributes the prohibition to an agency. This is a claim in its own right and it is not settled by this fetch |
| **A-5** attribution to a source | derived | Every category with a supported prohibition is carried by the FAQ, so **"per the CECM FAQ" is accurate for all four as a source citation**. A-1 is additionally carried by `block-parties.page`. This is separate from A-0: naming the page a claim comes from is not naming the agency that prohibits |

**A-0 is split out because an earlier revision of this document did not have it, and calling A-1
confirmed without it overstated the fetch.** The advisory does not say alcohol is prohibited at block
parties. It says "**SAPO prohibits** alcohol at block parties, street events, festivals, and parades".
That is two claims: a prohibition, and an agency holding the authority behind it.

**The fetch settles the first and not the second.** The FAQ sentence is agentless: "Alcohol is
prohibited at Parades, Block Parties, Street Event and Street Festivals." The block-parties page is
likewise passive: "Alcohol, vendors, commercial branding and sponsorships are not permitted at block
parties." **Neither says who prohibits.** Both pages are published by CECM, which houses SAPO, and
that is context rather than a statement of authority. For parades the record actively cuts against
the advisory's wording, since the same FAQ says parade permits are NYPD's.

**Why this is not pedantry:** which agency holds authority is a regulatory claim, and the promotion
decision rests on this mapping. An organizer told that SAPO prohibits something knows who to ask; one
told the wrong agency does not. **This document asserts nothing about which agency prohibits what.**

**What would settle A-0**, stated so it can be scoped rather than guessed at:

- **A codified rule naming the actor.** The FAQ's own alcohol answer links to the Administrative Code
  on `library.amlegal.com`, title 10 chapter 1, anchor `JD_10-125`. That link was not followed, per
  section 8. Following it is the smallest bounded step available and it is **not** taken here.
- **50 RCNY §1-01 to §1-12**, the codified SAPO rules, read for an alcohol provision. Round 1 and
  Round 2 of the dossier already fetched §1-01, §1-03 and §1-08, so the access path is known.
- **Failing both, dropping the actor from the claim.** "Alcohol is prohibited at ..." is what the
  sources say, and it is a smaller claim than the advisory currently makes.

**None of that promotes anything.** Section 4's retention rule is "supported **and** promoted", and
this document performs only the first half. All four categories remain unpromoted, and
`ADV-ALCOHOL-PUBLIC-001` remains `COVERAGE_GAP` with no `source`.

### 3.2 `ADV-SAPO-OTHER-CLASS-001`

| claim | inputs observed | section 4 outcome |
| --- | --- | --- |
| **B-1a** street festival | row 8: "Street Festival" | **On the schedule.** See section 6, defect 3, on which of the three states that is |
| **B-1b** single block festival | row 8: "Single Block Festival" | Same |
| **B-1c** production event | row 8: "Production Events (with curb lane or sidewalk only)" and "(with curb lane and sidewalk)" | Same, with the qualifier noted below |
| **B-1d** open culture | row 8: "Open Culture Event" | Same |
| **B-1e** plaza-and-street extra large | row 8: "Extra Large Event"; row 3: "Extra Large Events" | **Different published label**, unambiguously. Section 4's rule keeps the class **under the label the schedule publishes** |
| **B-2** "known published" | derived | Retained for whichever figures survive, which on these observations is all four |
| **B-3** production 10 days | row 2(b) as printed | **As printed.** Retained iff promoted |
| **B-4** open culture 15 days | rows 3 and 4 both as printed, and they agree | **As printed on both.** Retained iff promoted. No conflict |
| **B-5** street festival Dec 31 | rows 2(c) and 7(b) both as printed, and they agree | **As printed on both.** Retained iff promoted. No conflict |
| **B-6** single block festival 90 days | rows 3 and 5 both as printed, and they agree | **As printed on both.** Retained iff promoted |
| **B-7** single block festival Dec 31 | row 2(d) as printed | **As printed.** Retained iff promoted |
| **B-8** the two are both live | derived, `B-6 ∧ B-7` | **TRUE on today's pages.** 90 days on `permit-deadlines.page` and `single-block-festivals.page`, December 31st of the year before on the FAQ, all three fetched in the same hour |

**The `OFFICIAL_CONFLICT` the advisory prints is live and was re-confirmed.** Round 2 #5 recorded it
on 2026-07-22 and it holds on 2026-07-28: two official CECM pages publish 90 days while a third
publishes a prior-year December 31 for the same event class. Section 4 derives B-8 as the conjunction
of B-6 and B-7 rather than fetching it separately, and both conjuncts hold.

**On B-1c's qualifier.** The fee schedule splits production events into two priced rows by whether
the curb lane and the sidewalk are both used. That is a fee distinction inside one class, not a
renaming of the class: the FAQ and the deadline table both publish the plain label "Production
Events". It is recorded because a reader comparing the advisory's "production event" against the fee
table alone would see two rows and neither matches the advisory's words exactly.

---

## 4. What did not change, and what the dossier had missed

**Nothing on any of the eight pages contradicts what the dossier recorded.** Every figure the dossier
captured on 2026-07-22 and 2026-07-24 is still published in the same words six days later. There is
no "this page no longer says what the dossier recorded" finding in this pass, and that is worth
stating plainly because it was the outcome most worth catching.

**One page says more than the dossier recorded**, which is a different failure and a real one. The
CECM FAQ carries an alcohol prohibition. The dossier cites that page in five separate places
(`:16`, `:49`, `:55`, `:76`, `:114`), for sampling, insurance, deadlines and the single-block-festival
conflict, and **not one of the four research passes captured the alcohol question and answer**. The
page is not new to the record; the sentence is.

**What that does not establish.** It does not establish that the sentence was on the page in July when
those passes ran. No fetched artifact bears a date, the page publishes no revision history, and this
retrieval says only what the page says today. **Whether the earlier passes missed the sentence or the
sentence postdates them is not determinable from anything fetched here**, and this document does not
guess. Either way the record was incomplete on 2026-07-28 and now has a quote. **Section 5 sets out
the two readings that survive and declines to pick one**, which an earlier revision of this document
did not do.

---

## 5. Issue #181, which this fetch narrows without closing

Issue #181 records that `SAPO-BLOCK-PARTY-ELIG-001` carries `verification.status: SOURCE_CONFIRMED`
with a `source.citation` reading "CECM block-parties page; FAQ alcohol prohibition", and states that
the CECM FAQ "is named as a second source for the same prohibition and does not carry it."

**Against the page retrieved on 2026-07-28, the FAQ does carry it**, in the sentence quoted in row 2
above, and it names Block Parties explicitly. **So the citation is accurate as of this retrieval**,
in the narrow sense that both named sources carry the block-party prohibition today.

**That is as far as a current fetch reaches, and an earlier revision of this document went further
than it should have.** It concluded that "the defect was an incomplete evidence record, not a false
attribution", which is a claim about the state of the world in July, decided from a page read in
July six days later. **A current fetch cannot settle a historical question.** Section 4 above says the
timing is not determinable and the categorisation then quietly assumed one of the two readings.

**Both readings survive this fetch and neither is eliminated by it:**

- **The sentence was on the page and four research passes missed it.** Then the citation was correct
  when written, the dossier was incomplete, and #181's premise fails.
- **The sentence postdates those passes.** Then the citation named a source that did not carry the
  claim at the time it was written, **#181's premise holds for the period it describes**, and today's
  page has since made the citation true by accident rather than by verification.

Nothing retrieved distinguishes them. No page bears a date or a revision history, the committed
preimages are evidence of one retrieval rather than of a page's history, and this document has no
standing to guess. **Issue #181's premise is therefore open, not failed**, and any summary of this
work that says otherwise, including an earlier revision of this document, overstates it.

**What would close it** is a dated copy of the FAQ from before 2026-07-22: a web archive capture, or
a retrieval artifact from one of the four research passes if any was kept. **Neither was looked for**,
because that is source discovery and section 8 records why it is out of scope.

**The same open question applies to `ADV-ALCOHOL-PUBLIC-001`'s "per the CECM FAQ".** PR #158
established from the record that the located prohibition was on `block-parties.page` while the
advisory cited the FAQ. On today's page the advisory's source attribution holds for all four
categories. Whether it held when written is the same undecided question, and it is separate again
from A-0 in section 3.1, which asks who prohibits rather than which page says so.

**What this does to the amendment's pricing.** The amendment prices leaving the block-party claim on
`SAPO-BLOCK-PARTY-ELIG-001` as cheapest of three shapes precisely because that rule already carries
the claim at `SOURCE_CONFIRMED`, and flags that if the citation is wrong the pricing needs
re-checking. **The pricing rests on the claim being supported, which it is on both readings**: the
block-parties page carries the prohibition, and neither reading above questions that. So the pricing
stands, and it stands for a narrower reason than "the citation is fine".

### 5.1 What a citation fix actually costs, since it is not an artifact-field edit

Recorded because issue #181 describes the correction as "a `source.citation` edit to an immutable
published artifact", which understates its reach.

**`packages/engine/src/findings.ts:66-69` copies the citation into every generated `Finding`:**

```
return rule.source === null
  ? []
  : [{ ruleId: rule.id, citation: rule.source.citation, urls: rule.source.urls }];
```

From there it is **serialized engine output and user-visible text**, not a field only a rules reader
sees:

| Reached | Where |
| --- | --- |
| Rendered on the plan | `apps/web/app/plan/plan-line.tsx`, the per-line citation F-206 AC 2 requires |
| Rendered on the checklist | `apps/web/app/checklist/checklist-item.tsx:71` prints `{source.citation}` |
| **Persisted** | `apps/api/src/plan.ts:191` writes `JSON.stringify(finding.sources)` into `permit_plan_items.sources`, a `jsonb` column declared in migration `001_initial_schema.ts:208` |
| Persisted again | the checklist's own `sources` column, read back at `apps/api/src/checklist.ts:199` |

**And the persistence cuts the other way from the obvious reading.** `docs/ARCHITECTURE.md:128`
describes that column as "immutable citation + URL snapshots", and AD-7 makes plans immutable
snapshots. So a corrected citation **does not reach plans already generated**: every existing row
keeps the text it was written with, by design. A citation fix changes what future plans say and
leaves the past ones alone, which is the correct behaviour for an immutable snapshot and is also the
reason a correction cannot be described as making the record right.

**So the cost of correcting `SAPO-BLOCK-PARTY-ELIG-001`'s citation is a publication, plus moved
engine output, plus rendered user-visible text, plus a divergence between old and new stored plans.**
That is issue #181's to weigh; this document does not propose the correction and, per section 5
above, does not conclude that one is needed.

**This document does not choose a shape** for the block-party claim either.

---

## 6. Three places where section 4 has no state for what was found

Section 4.3 asserts the mapping is total and single-valued. The task instruction says that a result
landing nowhere is a defect in section 4 to be reported rather than resolved by picking a nearest
outcome. **Three results land nowhere.** Two are the same defect in two places.

**Defect 1: the source supports a NARROWER claim than A-3 makes.** The advisory prints "festivals".
The FAQ names "Street Festivals". **Single Block Festivals are a distinct SAPO class on that same
page**, listed separately in both the event-type list and the deadline list, and the alcohol sentence
does not name them. Section 4's A-3 observation is binary, "does either name festivals", and has no
state for "names a narrower class than the claim". Mapping this to *supported* would license the
advisory's broader word on a narrower sentence; mapping it to *unsupported* would discard a quote that
plainly supports street festivals. **Neither is right and section 4 offers only those two.**

**Defect 2: the source supports A-4's prohibition but not its attributed agent.** The advisory says
"**SAPO** prohibits alcohol at ... parades". The FAQ sentence names no agent: "Alcohol is prohibited
at Parades ...". The same page states that "Parade permits are issued by the New York Police
Department (NYPD)". Section 4's A-4 observation is "does row 2(a) name parades", which it does, and
there is no state for "names the category, does not support the attributed agency". **This document
asserts nothing about which agency prohibits what**; it reports that the fetched sentence does not
say, and that section 4 cannot express the difference. The same gap exists for A-1 through A-3, where
it happens not to bite because those three are SAPO permit classes on a SAPO page.

**Defects 1 and 2 are one defect.** Section 4's alcohol observations were designed to answer "is there
primary text for this category", which was the right question when the expected answer was no. Now
that there is text, the question that matters is "does the text support **this** claim, as worded, with
its attribution", and the observation cannot carry that. **The fix belongs in section 4 and is not
attempted here.**

**Defect 3: B-1's three states are not defined precisely enough to apply.** Section 4 asks, per class
name, whether it is on the schedule "as printed", "under a different published label", or "absent".
The advisory prints lowercase generic forms ("street festival", "open culture"); the schedule
publishes title-case class names ("Street Festival", "Open Culture Event"). **Under a reading that
ignores case and singular-plural, four of the five are as printed and only B-1e differs. Under a
strict-string reading, all five differ.** Section 4 does not say which reading it means, so B-1a to
B-1d land on different outcomes depending on a choice the document leaves open.

**This is the one place where the reported outcome depends on a decision that is not mine**, so it is
reported rather than taken. The tables in section 3.2 above use the looser reading and say so; a
reader who wants the strict one can apply it to the same quotes without re-fetching. **B-1e is
unaffected either way**: "plaza-and-street extra large" is not the published label under any reading,
and the published label is "Extra Large Event".

---

## 7. Which outcomes would change engine behaviour

Nothing in this document triggers either, and neither engine change is proposed here. Recorded so the
promotion decision sees them, from the amendment on issue #144 and PR #177 section 5.0.

| Outcome | Engine consequence |
| --- | --- |
| Promoting `ADV-ALCOHOL-PUBLIC-001` off `COVERAGE_GAP` | `packages/engine/src/intake/validate.ts:248` emits the issue code as the literal `coverage_gap` while the status travels separately from the advisory, and the intake page renders both together. Four tests pin the pair |
| Promoting `ADV-SAPO-OTHER-CLASS-001` off `COVERAGE_GAP` | `packages/engine/src/verdict.ts:345` drops a rescope suggestion only for a `COVERAGE_GAP` finding, and `packages/engine/src/proposals.ts:152-155` names "hold it as some other SAPO class" as the case that clause exists to prevent |
| Leaving both at `COVERAGE_GAP` and narrowing the text | Neither site moves |
| Correcting `SAPO-BLOCK-PARTY-ELIG-001`'s citation only | Neither of the two sites above moves, but **it is not free either**: `findings.ts:66-69` copies the citation into every generated `Finding`, so it moves serialized engine output, the plan and checklist rendering, and diverges new stored plans from old. Section 5.1, and issue #181 |

**The three constraints from the decision are unchanged by these results.** A status change is still
not a remedy, both outcomes still require a publication, and **retaining the block-party category is
still conditional on the verification owner promoting it.** This fetch satisfies the first half of
that condition for A-1 and leaves the second where it belongs.

---

## 8. What was not done

- **No promotion.** No verification status is moved and no `source` block is written.
- **No publication.** `rules/`, `docs/BASELINE.md` and every approved artifact are untouched. Issue
  #178 owns the scheduling of the next version.
- **No dossier round.** `docs/VERIFICATION-SOURCES.md` is unmodified. Section 2 above is written in
  the shape a round takes so that adopting it is a copy.
- **No source discovery.** The `library.amlegal.com` link in the FAQ's alcohol answer was recorded and
  **not followed**. The FAQ happening to carry the sentence is exactly the case the task anticipated:
  record it and stop, which is what section 2 row 2 does.
- **No advisory text drafted.** PR #177 section 4 holds the drafts. This document reports which
  outcome each claim lands on, not what the resulting sentence should say.
- **No archived capture sought.** Closing the timing question in section 5 needs a dated copy of the
  FAQ from before 2026-07-22. None was looked for; that is discovery, and it is named there as what
  would close the question rather than done here.
- **No citation correction proposed.** Section 5.1 prices one because issue #181 understates its
  reach. Whether to make it is #181's decision.
