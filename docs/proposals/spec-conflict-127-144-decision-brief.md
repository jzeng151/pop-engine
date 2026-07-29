# Decision brief: SPEC-CONFLICT #127 and #144

**Status:** PROPOSED, and not a decision. This document resolves nothing.

**Measured against `a7158c6`**, which is the commit this document's own parent is, and every claim
below is stated against that tree and no other. An earlier revision measured against `048bff3` and
kept saying so after being rebased, which put it four merges behind and made three of its claims
false on the tree actually receiving it. Where re-measuring removed a cost or a blocker, this
document now says the cost has DISAPPEARED rather than quietly dropping the line, because the
product owner has been carrying some of them.

Re-measured against `a7158c6`, three claims changed:

| earlier claim, against `048bff3` | on `a7158c6` |
|---|---|
| PR #131 is open and sequencing-blocks option B | **gone.** `8d91e8c` merged it. Option B has no sequencing blocker |
| `specs/F-203-deadline-alerts.md` has no 2026-07-27 amendments | **false.** `65730ec`, `951d2f4` and `54f659b` amended it that day |
| OPEN-QUESTIONS T-4 cites sections that do not exist | **gone.** `7626391` merged the #161 citation fix |

**Method:** every claim below was checked against `main` rather than taken from the issue. Where a
claim could not be verified either way it says so. No approved artifact is changed by this document,
and no permit fact is asserted anywhere in it.

---

# SPEC-CONFLICT #127: two F-id assignments

## Every location the issue cites verifies exactly

| Issue claim | On `main` | Verdict |
|---|---|---|
| `ROADMAP.md:57` lists F-203 (full) for escalations, digests, team reminders | `- **F-203 (full)** — alert escalations, digests, team reminders.` | accurate |
| `specs/F-203-deadline-alerts.md` is APPROVED | `**Status:** APPROVED (2026-07-25; …)` | accurate |
| `ROADMAP.md:103` lists Square/POS with no F-id | `- Square/POS integrations.` | accurate |
| `ROADMAP.md:90` already scopes F-408 | `- **F-408 · Inventory Low-Stock Alerts** — manual counts or Square webhook (deliberately last).` | accurate |

Section context, which the issue does not give: `:57` sits under "Phase 2 — Execution Hardening
(post-capstone)" and `:103` under "Phase 4 — Platform, AI & Expansion", where it is the only
un-idented bullet in a list of F-7xx admin features.

## One correction to the framing this task was dispatched with

The framing said F-203's spec was being amended alongside the decision. It was, and an earlier
revision of this section denied it: measured against `a7158c6`, `specs/F-203-deadline-alerts.md`
carries three commits dated **2026-07-27** (`65730ec`, `951d2f4`, `54f659b`), on top of the
2026-07-26 group (`74551f3`, `e4f04b1`, `33eac8c`). The spec IS moving alongside the decision.

That does not change either option's change set, because none of those commits touches the Phase 1
Scope Cut sentence the decision turns on. It does mean the spec is under active amendment, so
whichever option is taken should be sequenced against whatever is in flight on it rather than
assuming a static file.

## The finding that most narrows item 1

F-203's own APPROVED spec already assigns the Phase 2 scope to F-203. Its "Phase 1 Scope Cut" reads:

> Happy path only. Escalations, digests, team reminders, per-user preferences: Phase 2 (F-203 full,
> per ROADMAP).

So `ROADMAP.md:57` and the approved F-203 spec **agree on three capabilities and not on a fourth**,
which an earlier revision of this brief stated as unqualified agreement. Set side by side:

| capability | `specs/F-203-deadline-alerts.md:53` | `docs/ROADMAP.md:57` | `docs/PRD.md:206` |
|---|---|---|---|
| escalations | yes | yes | yes |
| digests | yes | yes | yes |
| team reminders | yes | yes | yes |
| **per-user preferences** | **yes** | **absent** | **absent** |

The spec assigns four Phase 2 capabilities; the Roadmap and the PRD assign three. So there is no
disagreement about what F-203 MEANS, which is what the issue's §5 citation implies, and there is a
gap about what its Phase 2 depth CONTAINS.

**That gap is a live scope item, not a wording slip, and neither option currently prices it.** Option
B's rewrite covers the three capabilities the Roadmap names and would leave per-user preferences
assigned by a spec and by nothing else. Option A would move three capabilities to a new id and leave
the fourth behind. The product owner has to choose explicitly among retaining per-user preferences
under whichever id takes the depth, retargeting it with the other three, or removing it, and this
brief takes no position on which.

**And there is no §7 problem either, which an earlier draft of this brief got wrong.** That draft
read §7's "Every scheduled F-id receives one spec" as already biting, and reframed item 1 as how a
second phase of one feature gets a compliant spec. The word doing the work is SCHEDULED, and on
`main` the Phase 2 depth is not:

> `docs/PRD.md:187` — "## 5. REQUIREMENTS — PLANNED SCOPE (Phases 2–4; outlined for delegation,
> specs written when scheduled)"

> `docs/DESIGN.md:105` — "Phases 2+ get specs when scheduled, not now."

Listing the F-203 expansion in the Phase 2 roadmap is what those two artifacts call planned scope,
not scheduling. §7 therefore demands no spec for it today, and nothing in the tree is out of
compliance. The correction is a reduction: item 1 has no live compliance problem attached to it, and
the finding that `ROADMAP.md:57` and the approved spec agree stands on its own with nothing left to
be in tension with.

**What the product owner is actually choosing, and when.** The choice is whether the Phase 2 depth
of alerting is eventually delivered under F-203 or under a new id, and it is a naming and tracking
decision rather than a compliance one. It becomes live at the moment that work is SCHEDULED, because
scheduling is what turns §7's one-spec requirement on. Until then either answer leaves the tree
compliant, and deciding early buys only the ability to write the id into the Roadmap now. Deciding
late costs nothing that this brief could find.

## What governance permits and forbids here

Rather than leaving these to be re-derived:

- **§5's prohibition is scoped to contributors.** "Change an established feature ID's meaning"
  appears in §5's "Contributors must not" list. It binds contributors and agents. It is not a
  restriction on the PRD/Roadmap decision process, and §7 routes scope decisions there explicitly:
  "Scope expansion returns to the PRD/Roadmap decision process."
- **§7 forbids silent expansion, not decided expansion.** "A spec may clarify but may not silently
  expand its Roadmap feature." An explicit, recorded Roadmap decision is the permitted path; an
  implementer widening F-203 on their own is not.
- **§7 requires one spec per SCHEDULED F-id**, and that is what makes item 1 a question for later
  rather than now. `PRD.md:187` and `DESIGN.md:105` both put Phases 2-4 in planned scope with specs
  written when scheduled, so the requirement does not bite until the Phase 2 depth is scheduled. It
  is the constraint that will decide item 1; it is not one the tree is failing today.
- **DESIGN.md's approved ID policy adds two rules the issue does not cite.** "Once assigned, an ID's
  meaning never changes, and IDs are never reused." And, directly relevant to item 2: "Closely
  related capabilities are absorbed into existing IDs rather than split: run-of-show lives in F-405
  (day-of runbook); consent separation lives in F-403 (lead capture & consent)."

**Option A for item 1 is NOT compliant as written, and an earlier revision said both options were.**
The absorption rule quoted above was cited here as "directly relevant to item 2" and then not applied
to item 1, which was an assertion rather than a reading. It says closely related capabilities are
absorbed into existing ids rather than SPLIT, and it gives two examples of exactly that shape:
run-of-show into F-405, consent separation into F-403. Option A splits capabilities this brief itself
calls the Phase 2 DEPTH of F-203, already assigned to F-203 by the Roadmap, the PRD and the spec.
That is the case the rule names.

So option A additionally requires amendments or recorded approved exceptions to **two** DESIGN rules,
`:27`'s absorption policy and `:25`'s "an assigned ID's meaning never changes", with the status header
and BASELINE consequences those carry. `:25` applies because retargeting approved capabilities away
from F-203 narrows what that id means, and the rule bars changing a meaning rather than only
enlarging one. Option B remains
compliant without an exception: expanding F-203 explicitly is permitted because the prohibition is on
silent expansion and on contributor-initiated meaning changes, and it is what the absorption rule
points at.

Nothing here forbids option A. An approved policy can be amended by the body that approved it, and
the product owner may decide that a phase of a feature is not a "closely related capability" in the
rule's sense. What is corrected is the claim that option A needs no such decision.

**BOTH ITEMS COLLIDE WITH THE SAME DESIGN SECTION, FROM OPPOSITE DIRECTIONS, and that is the shape
of the decision rather than two separate hazards.** `docs/DESIGN.md` lines 24 to 26 carry three ID
rules, and one branch of each item runs into one of them:

| | the branch | the rule it runs into |
|---|---|---|
| item 1, option A | mints F-215 for the Phase 2 depth of F-203 | `:26` capabilities are absorbed rather than **split** |
| item 1, option A | AND removes approved capabilities from F-203 | `:25` an assigned ID's **meaning never changes** |
| item 2, widening | grows F-408 from inventory alerts into POS integrations | `:25` an assigned ID's **meaning never changes** |

**Option A runs into BOTH rules, which an earlier revision missed by reading `:25` as being about
growth only.** It is not: it says an assigned id's meaning never CHANGES, and narrowing is a change.
Option A takes approved Phase 2 capabilities away from F-203, so F-203 afterwards means less than the
Roadmap, the PRD and its own spec currently say it means. That is the same rule the widening branch
runs into, reached from the other side.

So the comparison this brief drew earlier needs restating, and it is not symmetrical after all:

Rechecked branch by branch against BOTH rules rather than at the branch last reported, which is the
third time this comparison has been restated and the first time it was derived rather than sampled:

| branch | `:26` split | `:25` meaning change | why |
|---|---|---|---|
| item 1 A, all three branches | **yes** | **yes** | splits the depth onto a new id, and narrows F-203 whichever branch is taken, because F-203 loses capabilities in every one |
| item 1 B, retain | no | no | absorption, and the Roadmap and PRD are corrected to match what the approved spec already assigns, which is reconciliation rather than a meaning change |
| item 1 B, **drop** | no | **yes** | deleting per-user preferences from the approved spec removes a capability F-203 currently has. Recorded as engaging nothing by an earlier revision |
| item 2 A | no | **yes** | the `:90` boundary sentence and the `PRD.md:226` retarget both move the Square webhook away from F-408, which narrows it. **Found by this recheck, not reported** |
| item 2 B, widening | no | **yes** | grows F-408 into the standalone capability |
| item 2 B, narrowing | no | no | F-408 keeps exactly its current scope; the broader capability is recorded as dropped without ever having been F-408's |

**So FOUR of the six branches engage `:25`, after an earlier revision recorded none of them.** The
pattern behind the repeated miss is one reading: `:25` was taken to be about growth, so every branch
that removed or moved a capability was scored clean. It bars a meaning from CHANGING, and narrowing,
splitting away and moving-out are all changes.

The narrowing branch of item 2 remains the only branch that engages neither rule, and item 1 option
B's retain branch is the only other that engages neither.

One splits and narrows; the other grows. Both directions are meaning changes, and only the
absorption rule distinguishes them, which is why option A carries the extra collision. The two branches that DO NOT collide are item 1 option B (expand F-203 explicitly, which
is absorption) and item 2's narrowing branch (keep F-408 as it is and record the broader scope as
dropped). So on the policy as written, one option per item is clean and the other needs an amendment
or a recorded exception, with the status and BASELINE consequences either carries.

That is a statement about what the approved text says, not a recommendation. The product owner may
amend the policy, or decide these are not the cases it names. What this brief corrects is having
previously priced both collisions at zero.

**This should be read consistently with PR #171**, which proposes absorbing a host/guest
authorisation spec into F-108 under this same rule. If the rule reaches that case it reaches this
one; the two should not be read differently, and if the product owner reads them differently the
reason belongs in whichever document is amended.

**For item 2 the approved ID policy leans one way** without forbidding the other. The absorption rule
and its two named precedents point at keeping POS support inside F-408. That is a stated preference
in an approved document, not a prohibition on minting an id.

## The F-id inventory, because "assign a new F-id" is not actionable without it

Referenced across `ROADMAP.md`, `PRD.md`, `specs/` and all 300 tracker issues: 64 distinct F-ids.
`specs/` currently holds 12 files: F-101, F-102, F-201, F-202, F-203, F-204, F-205, F-206, F-301,
F-302, F-401, F-402.

| Family | Taken | Lowest unused |
|---|---|---|
| F-1xx | F-101 … F-109 | F-110 |
| F-2xx | F-201 … F-214 | F-215 |
| F-3xx | F-301 … F-309 | F-310 |
| F-4xx | F-401 … F-413 | F-414 |
| F-5xx | F-501 … F-503 | F-504 |
| F-6xx | F-601 … F-606 | F-607 |
| F-7xx | F-701 … F-704, F-710 … F-715 | F-705 |

**The part that costs more than it looks.** DESIGN.md's approved lifecycle model declares each
stage's id range, and every range is exactly saturated:

| Stage | Declared range | Taken | Free inside the range |
|---|---|---|---|
| 1 IDEATE | F-101–F-109 | F-101–F-109 | none |
| 2 COMPLY | F-201–F-214 | F-201–F-214 | none |
| 3 MARKET | F-301–F-309 | F-301–F-309 | none |
| 4 OPERATE & ADMINISTER | F-401–F-413 | F-401–F-413 | none |

So minting F-215 (item 1's stage) or F-414 (item 2's stage) is not a one-line Roadmap edit. It
extends a range published in APPROVED `DESIGN.md`, which makes the new-id options edits to **two**
approved artifacts rather than one. That is a real cost difference between the options and it is not
visible from the issue.

## How these change sets were derived, and the searches to re-run

Rounds 1, 2 and 3 each extended a change set by whatever that round's reviewer happened to find:
the F-203 spec pointer, then `docs/PRD.md:206` and `docs/PRD.md:226` and
`docs/ARCHITECTURE-FUTURE.md:336`, then the absorption policy, the spec's own approval records and
the PRD half of option B. Three rounds, one defect: a change set priced against fewer approved
artifacts than the change touches. Extending it a fourth time would repeat the method that produced
the first three, so the change sets below are DERIVED rather than assembled, by the procedure here.

**The procedure, applied to each option of each item.**

1. Search every approved artifact for the id being moved, AND for the capability being reassigned by
   name. The id search alone is what missed things: an artifact can assign a capability without
   naming the id, and a declared id RANGE can be broken by an id that does not appear in it yet.
2. Classify every hit as **moves**, **stays**, or **flagged**, and for anything flagged NAME ITS
   APPROVER from `DOCUMENTATION-GOVERNANCE.md`'s change-class table rather than defaulting to the
   product owner. Record the classification, so a later round can disagree with a judgement rather
   than rediscover the hit. Defaulting was itself a defect: three flags in this document routed an
   architecture decision to the product owner because that is who the brief is addressed to, which
   is not the same question as who approves it.
3. For every artifact that MOVES, include its status header and its BASELINE row. That pairing has
   been the missing half three times, so it is now part of the derivation and not a step to remember.
4. Record the searches themselves, below, so the next round re-runs them instead of re-deriving them.
5. **Check that every branch leaves the artifacts agreeing.** A capability that moves in one artifact
   and not its pair recreates the disagreement the change set exists to close. Three branches had
   this and each looked complete on its own: option A's leave-with-F-203 branch assigned a capability
   by spec alone, option B's retain branch amended the PRD and not the Roadmap, and option B's drop
   branch left the spec broader than both. The check is one matrix per option, artifacts across,
   branches down, and it is in the option A section as the worked example.
6. **Check that every flag reaches a change set.** A derivation that finds a flag and a change set
   that silently drops it is worse than not deriving, because it looks complete. This step exists
   because it happened: three flags were derived and only two were carried, and
   `docs/ARCHITECTURE-FUTURE.md:396` reached no option. The audit is one comparison, table against
   change sets, and it is part of the procedure rather than a thing to remember.

**The searches, runnable as written.** The artifact set is the APPROVED rows of `docs/BASELINE.md`,
which is 25 files: `AGENTS.md`, `CONTRIBUTING.md`, `DEPLOY.md`, the nine approved `docs/*.md`, the
published ruleset, and the twelve `specs/F-*.md`.

```
# by id
grep -n "F-203" <approved artifacts>
grep -n "F-408" <approved artifacts>

# by capability name, which the id search cannot reach
grep -nEi "escalation|digest|team reminder|per-user preference" <approved artifacts>
grep -nEi "square|\bPOS\b|webhook|low-stock|inventory" <approved artifacts>

# by declared id range, which neither of the above reaches
grep -nE "F-[0-9]{3}[–-]F-[0-9]{3}" <approved artifacts>
```

**Item 1, the F-203 Phase 2 depth.**

| location | classification | why |
|---|---|---|
| `docs/ROADMAP.md:57` | **moves** under A | assigns the Phase 2 scope |
| `docs/PRD.md:206` | **moves** under A | assigns the same scope; found round 2 |
| `specs/F-203-deadline-alerts.md:53` | **moves** under A and B | names the destination; B rewrites it anyway |
| `docs/DESIGN.md:34` STAGE 2 `F-201–F-214` | **moves** under A | saturated, so a new id extends it |
| `docs/DESIGN.md:27` absorption policy | **moves or exception** under A | see below; found round 3 |
| `docs/ARCHITECTURE-FUTURE.md:328` `F-208–F-214` | **flagged, architecture ADR approval** | a new F-215 falls outside every ownership row in §9.3. Which module owns it is a technical boundary, routed by governance to architecture, not to the product owner. **Found by the range search, not by the id search** |
| `docs/ARCHITECTURE-FUTURE.md:396` | **flagged, architecture ADR approval** | lists F-203 among the outbound worker's consumers; whether the depth is a distinct consumer is a delivery-architecture reading, same route |
| `docs/ARCHITECTURE.md:58` `COMPLY (F-201–F-206)` | **stays** | a Phase 0-1.5 subset, not an enumeration: F-207 to F-214 already exist and are already outside it |
| `docs/DESIGN.md` 12, 16, 18, 73, 80, 86; `docs/PRD.md:167`; `docs/ROADMAP.md:29`, `:53`; `docs/ARCHITECTURE.md:193`, `:276`, `:281`; `specs/F-102`, `F-201`, `F-202` | **stay** | name F-203 as the Phase 1 feature: tracks, lanes, dependency graph, Twilio reuse, endpoints |

**Item 2, the Square/POS scope.**

| location | classification | why |
|---|---|---|
| `docs/ROADMAP.md:103` | **moves** under A and B | the standalone entry itself |
| `docs/ROADMAP.md:90` | **moves** under A and under B's WIDENING branch | F-408's entry, bounded under A, absorbing under B's widening. B's narrowing branch records the broader capability as dropped and leaves F-408's entry as it is |
| `docs/PRD.md:226` | **moves** under A and under B's WIDENING branch only | assigns the Square webhook to F-408. It does NOT move on B's narrowing branch, which keeps exactly that scope, so there is nothing to widen. An earlier revision marked it as moving under all of B, which contradicted the change set derived from this table |
| `docs/ARCHITECTURE-FUTURE.md:336` | **moves** under A | maps webhooks to F-408 and no other id; found round 2 |
| `docs/DESIGN.md:36` STAGE 4 `F-401–F-413` | **moves** under A | saturated |
| `docs/ARCHITECTURE-FUTURE.md:331` `F-401–F-413` | **flagged, architecture ADR approval** | a second declared range covering the same band. A new F-414 sits outside it, and whether it belongs here or in the External integrations row at `:336` is a module-boundary question, routed to architecture. **Found by the range search, not by the id search** |
| `docs/ARCHITECTURE-FUTURE.md:67`, `:401` | **stay** | name POS and webhooks in a directory layout and a worker consumer list, both id-agnostic |

**Does the derived set differ from the current one anywhere other than the three findings? Yes, in
two places, and both are the same shape.** `docs/ARCHITECTURE-FUTURE.md:328` and `:331` are declared
id ranges in a second approved artifact, and neither the id search nor the capability search reaches
them, because the new id does not appear in either row and neither row names the capability. Both are
flagged rather than moved, because which ownership row should cover a new id is not this brief's to
decide. **It is also not the product owner's.** `DOCUMENTATION-GOVERNANCE.md` routes "Technical
boundaries and invariants" to `ARCHITECTURE.md` plus approved ADRs, and its change-class table routes
a "Durable architecture decision or dependency" to **Architecture ADR approval**. §9.3 maps modules
to feature ranges and the entities they own, which is exactly that. So both option-A costs were short
an entire approval route, not just an artifact.

An earlier revision routed all three of these to the product owner, which was defaulting to the
person the brief is addressed to rather than reading the table. The method above now requires naming
the approver for anything flagged, so that default cannot recur silently.

## Governance's conflict protocol, audited step by step

`DOCUMENTATION-GOVERNANCE.md` §5 sets seven steps for resolving a SPEC-CONFLICT. This brief has cited
that file more than any other for eight rounds and never checked itself against the whole list. Doing
that now:

| step | status |
|---|---|
| 1. Stop the affected implementation | **satisfied by circumstance.** Nothing is being implemented on either item: the Phase 2 depth is unscheduled, and the advisories are shipped rather than in progress |
| 2. Record a SPEC-CONFLICT issue with both exact artifact locations and the user-visible consequence | **satisfied.** #127 names both Roadmap entries and states the consequence, that drafting either into `/specs` would create duplicate or untraceable authority |
| 3. Identify the concern and its authoritative artifact | **satisfied.** #127 names feature identity and scheduling, authoritative artifact `docs/ROADMAP.md` under §1 |
| 4. If the authoritative artifact is unclear, assign an owner and add a blocking OPEN-QUESTIONS item | **not applicable to #127**, whose authority is clear; **satisfied for #144** by T-4 |
| 5. Resolve the source artifact first | **satisfied by ordering.** Every change set below starts at `docs/ROADMAP.md`, which §1 makes the authoritative ID registry, before the PRD, the spec or anything derived |
| 6. Update all derived contracts in the same reconciliation PR or explicitly track each follow-up | **satisfied.** The change sets carry the derived artifacts, and the architecture items are explicitly tracked follow-ups rather than silent omissions |
| 7. **Add a regression test or validation rule so the contradiction cannot silently return** | **NOT ADDRESSED IN ANY OPTION, and this is the finding.** |

**Step 7 is mandatory and every option omitted it.** The derivation added a one-time matrix check, run
by whoever executes the change set, which is not a validation rule: it closes the contradiction once
and leaves it free to return on the next edit to any of the three artifacts. So a change set this
brief called governance-compliant was not, and the omission survived eight rounds inside the document
that quotes §5 most.

**The guard, priced into every option below as a required step.** What has to hold after any branch
is the invariant the matrix checks by hand: `docs/ROADMAP.md`, `docs/PRD.md` and
`specs/F-203-deadline-alerts.md` must agree on which id carries each Phase 2 alerting capability, and
for item 2, `docs/ROADMAP.md`, `docs/PRD.md` and `docs/ARCHITECTURE-FUTURE.md` must agree on which id
carries the Square/POS scope. That is a text-level agreement between approved artifacts, which is the
same shape as the checks `scripts/check-baseline-drift.mjs` already performs over that artifact set,
so the natural home is a case there rather than a new mechanism.

This brief does not write it, name its author or design it beyond the invariant, because the
capability set it has to encode is exactly what the product owner is deciding. It is listed as a
required step in each change set so that the cost is visible and the step is not discovered after the
decision.

## Exact change sets

Line numbers are given only to locate the current text; the edits are described by content.

### Item 1, option A: assign a new F-id to the Phase 2 expansion

**Option A has the per-user-preferences branch too, and an earlier revision gave it only to option
B.** The Roadmap and the PRD assign three capabilities; the F-203 spec assigns four. Step 14 retargets
the spec sentence that names all four, so a replacement naming only three either moves the fourth
without assigning it anywhere or needs different edits. The branch is the same one option B carries,
and the product owner answers it once for whichever option is taken.

- **RETAIN under the new id:** steps 1, 3 and 14 all name four capabilities, and the new Roadmap entry
  and PRD line read "escalations, digests, team reminders, per-user preferences".
- **LEAVE IT WITH F-203:** steps 1 and 3 name three for the new id AND **keep an F-203 Phase 2 entry
  naming per-user preferences**, so the Roadmap and the PRD each carry two entries afterwards. Step 13
  rewrites the spec sentence to split the four between the two destinations. An earlier revision of
  this branch replaced the Roadmap and PRD entries with the new id alone, which left per-user
  preferences assigned by the spec and by nothing else, recreating the exact spec-versus-Roadmap gap
  this brief exists to close. This is the most artifact-heavy branch of the option for that reason.
- **DROP IT:** steps 1 and 3 name three, and step 14 removes per-user preferences from the spec
  sentence and records it as dropped rather than moved.

**Every branch is checked for a capability that moves in one artifact and not its pair**, because
that is what the LEAVE branch had. The rule is that after any branch, `ROADMAP.md`, `PRD.md` and the
F-203 spec must agree on which id carries each of the four capabilities:

| branch | Roadmap | PRD | spec | agree? |
|---|---|---|---|---|
| retain under new id | 4 on F-215 | 4 on F-215 | 4 on F-215 | yes |
| leave with F-203 | 3 on F-215 + 1 on F-203 | same | same split | yes, once the F-203 entries are kept |
| drop | 3 on F-215 | 3 on F-215 | 3, fourth recorded dropped | yes |

The steps below are written for the retain branch, which is the one that keeps all four capabilities
together; the other two branches change steps 1, 3 and 14 as described.

1. `docs/ROADMAP.md:57`: replace `- **F-203 (full)** — alert escalations, digests, team reminders.`
   with an entry naming the new id, for example `- **F-215 · Alert Escalations & Digests** — alert
   escalations, digests, team reminders, per-user preferences (the Phase 2 depth of F-203).`
2. `docs/DESIGN.md`, lifecycle model: extend STAGE 2's declared range from `F-201–F-214` to
   `F-201–F-215`. Required because the range is saturated.
3. `docs/PRD.md:206`: **required, and missing from an earlier revision of this list.** It carries the
   same assignment as the Roadmap, "**F-203 (full)** — alert escalations, digests, and team
   reminders". Retargeting only the Roadmap leaves one planned scope assigned to two different ids
   across two approved artifacts.
4. `docs/ROADMAP.md` status header: record the id assignment, product-owner approved, dated.
5. `docs/DESIGN.md` status header: record the range extension.
6. `docs/PRD.md` status header: record the retarget.
7. `specs/F-203-deadline-alerts.md` status header: **required, and missing from an earlier revision.**
   Step 14 edits the spec's content, so leaving its approval metadata alone would publish a spec whose
   text points at the new id while its own header still describes the previously approved version.
8. `docs/DESIGN.md`, **BOTH ID rules, not one**: `:27`'s absorption policy, because option A splits
   rather than absorbs, and `:25`'s "an assigned ID's meaning never changes", because option A also
   NARROWS F-203 by taking approved capabilities away from it. Each needs an amendment or a recorded
   approved exception, with its own status-header entry. An earlier revision requested only the
   absorption amendment, having read `:25` as being about growth alone.
9. `docs/BASELINE.md`: the rows for `docs/ROADMAP.md`, `docs/DESIGN.md`, `docs/PRD.md` AND the
   `Phase 1–1.5 specs` row covering `specs/F-*.md`. The spec's row was missing for the same reason its
   header was: the change set listed the artifacts whose text changes and not the records that carry
   their approval.
10. `docs/ARCHITECTURE-FUTURE.md:328`: **flagged, and it needs ARCHITECTURE ADR APPROVAL rather than
    the product owner's.** Its §9.3 ownership table maps `F-208–F-214` to application execution, and a
    new F-215 falls outside every row. Which module owns it, or whether a new row is needed, is a
    technical boundary, which governance routes to `ARCHITECTURE.md` plus approved ADRs. **Option A
    therefore needs a second approval route, not just a further artifact**, and an earlier revision
    of this list routed it to the product owner by default. Surfaced by the range search recorded
    above, which neither the id search nor the capability search reaches.
11. `docs/ARCHITECTURE-FUTURE.md:396`: **flagged, architecture ADR approval, and missing from an
    earlier revision of this list.** It names F-203 alone as the outbound worker's alert consumer. If
    F-215 takes the alert depth, the architecture owner still has to decide whether that list keeps
    F-203 alone, names F-215 beside it, or replaces it. The derivation flagged this and the change set
    dropped it, which is the failure mode step 5 of the procedure now audits for.
12. **The §5 step 7 guard**, required: a validation rule asserting that the Roadmap, the PRD and the
    F-203 spec agree on which id carries each of the four capabilities after this change. Without it
    the reconciliation is one-time and the mismatch can return on any later edit.
13. Tracker: open the F-215 issue; F-203's own issue needs no change.
14. `specs/F-203-deadline-alerts.md:53`: **required, not optional.** Its Phase 1 Scope Cut reads
   "Phase 2 (F-203 full, per ROADMAP)". Step 1 removes the `F-203 (full)` entry that sentence points
   at, so without this edit an APPROVED spec cites a Roadmap entry that no longer exists. Governance
   §5 makes that a conflict requiring reconciliation, so option A either retargets the pointer to the
   new id in the same change set or opens a tracked reconciliation for it. An earlier draft of this
   brief called the edit unnecessary and the retarget optional; that was wrong, and it understated
   option A by one approved artifact. See the sequencing note below.

### Item 1, option B: expand F-203 explicitly, without changing its meaning

1. `docs/ROADMAP.md:57`: keep the entry, and record that the Phase 2 depth is ASSIGNED to F-203 by
   decision rather than held there by default. **The word matters and an earlier revision used
   "scheduled".** `PRD.md:187` and `DESIGN.md:105` make scheduling the thing that turns §7's
   full-spec requirements on, so a step recording the depth as scheduled activates obligations the
   remaining steps deliberately omit, which is the split this option's step 2 makes explicit. The
   scope stays PLANNED and assigned under F-203.
2. `specs/F-203-deadline-alerts.md`: record that the Phase 2 depth stays under F-203 by decision.
   The existing "Phase 1 Scope Cut" section becomes a phase boundary inside one spec rather than a
   deferral to a different id.

   **This does NOT pull §7's contents list forward, and an earlier revision of this step did.** That
   step required acceptance criteria, fixtures, footprint and rollout for escalations, digests and
   team reminders as part of choosing the id, which contradicts this brief's own finding above: the
   Phase 2 depth is PLANNED scope, `PRD.md:187` and `DESIGN.md:105` say specs are written when
   scheduled, and §7 does not bite until then. Writing that content now is the scheduling change, not
   the id change.

   **So the two are separated, and only the first is on the table.** Choosing option B assigns the id
   and records the decision. When the work is later scheduled, §7's contents list applies to this spec
   and that is a second change set with its own approval, exactly as it would be for a new id under
   option A. Leaving them fused meant choosing option B silently took on a Phase 2 spec obligation the
   product owner is not being asked for, and made option B look more expensive than it is.
3. `specs/F-203-deadline-alerts.md` status header, plus its BASELINE row.
4. `docs/ROADMAP.md` status header and BASELINE row.
5. **The per-user preferences branch, and BOTH branches move an artifact an earlier revision left
   alone.** The spec assigns four Phase 2 capabilities; `ROADMAP.md:57` and `PRD.md:206` assign three.

   - **RETAIN:** `docs/PRD.md:206` AND `docs/ROADMAP.md:57` are both amended to name per-user
     preferences, each with its status header and BASELINE row. An earlier revision amended the PRD
     alone while step 1 kept the Roadmap entry as-is, which left the approved spec broader than the
     Roadmap, which is the gap this brief exists to close.
   - **DROP:** `specs/F-203-deadline-alerts.md:53` is amended to remove per-user preferences and
     record it as dropped. An earlier revision said "the PRD already matches and none of that
     applies", which was true of the PRD and false of the spec: leaving the spec at four while the
     Roadmap and PRD carry three preserves the original gap rather than closing it.

   So neither branch is free, and the artifact counts below account for both.
6. `docs/DESIGN.md:25`, **on the DROP branch only.** Deleting per-user preferences from the approved
   F-203 spec removes a capability F-203 currently has, which narrows an assigned id's meaning. That
   branch needs an amendment or a recorded approved exception with its status header and BASELINE
   row. An earlier revision said neither branch engages the ID policy, which was true of `:26`, which
   this option satisfies by absorbing, and false of `:25` on this branch. **The retain branch engages
   neither**, because correcting the Roadmap and PRD to match what the approved spec already assigns
   is reconciliation rather than a change of meaning.
7. **The §5 step 7 guard**, required on both branches: the same Roadmap/PRD/spec agreement rule.
8. No new tracker issue.

**Per BRANCH: THREE artifacts on the retain branch** (Roadmap, PRD, spec) **and THREE on the drop
branch too** (Roadmap, spec, and `docs/DESIGN.md` for the `:25` exception), which is a correction: the
drop branch was priced at two before its `:25` collision was found. An earlier revision priced the option at two unconditionally and then at
two-or-three with the PRD alone on retain; both undercounted, because each branch has to reconcile
all three artifacts rather than the one that happens to be wrong in the obvious direction.

**Option B has no mirror of option A's step 7, and that was checked rather than assumed.** B keeps
the `F-203 (full)` Roadmap entry, so the spec's "per ROADMAP" pointer still resolves and needs no
retarget on that account; and B's step 2 already rewrites the Scope Cut section, so the sentence is
priced there in any case. The asymmetry in the two lists is therefore real and not an artefact of
one being written more carefully: A touches an approved spec that B was already touching.

**This option is cheaper in artifacts, and its sequencing blocker has merged away.** See below.

### Item 2, option A: assign a permanent F-id to Square/POS

1. `docs/ROADMAP.md:103`: replace `- Square/POS integrations.` with an F-id entry, for example
   `- **F-414 · Square/POS Integrations** — …`, and state its relationship to F-408 so the two are
   not read as overlapping.
2. `docs/ROADMAP.md:90`: F-408's "manual counts or Square webhook" needs a boundary sentence, or
   the two entries both claim the Square webhook.
3. `docs/PRD.md:226`: **required, and missing from an earlier revision of this list.** It assigns the
   Square-webhook scope exclusively to F-408: "**F-308 / F-408** — ticketing integration/export;
   inventory low-stock alerts (manual counts or Square webhook; deliberately last)". A Roadmap
   boundary sentence does not reach it, so without this the product requirement keeps assigning the
   capability to F-408.
4. `docs/ARCHITECTURE-FUTURE.md:336`: **required, same reason.** Its external-integrations row maps
   webhook events and provider mappings to `F-108, F-212, F-308, F-408` and to no other id, so a new
   id owning POS integration is absent from the architecture mapping until this row names it.
5. `docs/DESIGN.md`: extend STAGE 4's declared range from `F-401–F-413` to `F-401–F-414`.
6. Status headers and BASELINE rows for all FOUR documents: `docs/ROADMAP.md`, `docs/PRD.md`,
   `docs/ARCHITECTURE-FUTURE.md` and `docs/DESIGN.md`. An earlier revision said "both documents",
   which was counted before the sweep below was done.
7. `docs/ARCHITECTURE-FUTURE.md:331`: **flagged, and it needs ARCHITECTURE ADR APPROVAL**, for the
   same reason as its item 1 counterpart. Its §9.3 table maps `F-401–F-413` to event operations, so a
   new F-414 sits outside that range, while the External integrations row at `:336` is where a POS id
   would more naturally belong. Choosing between them is a module-boundary decision, not a product
   one. **So item 2 option A is also short an approval route**, and both option-A costs now carry it.
8. **The §5 step 7 guard**, required: a validation rule asserting that the Roadmap, the PRD and
   `docs/ARCHITECTURE-FUTURE.md` agree on which id carries the Square/POS scope.
9. Tracker: open the F-414 issue.

### Item 2, option B: remove the standalone entry, keep POS inside F-408

**Option B has two branches and they do not cost the same. The counts below are per BRANCH**, because
an option-level figure is wrong for both: an earlier revision priced the option at two artifacts,
which overstated one branch and understated the other.

The branch is a product-owner decision and this brief does not make it: either F-408 is widened to
absorb the standalone capability, or the absorption is narrowed to the inventory webhook that already
exists and the broader POS capability is recorded as dropped. The second is a real answer, not a
formality: `ROADMAP.md:103` is a one-line entry with no spec and no stated contents beyond its title.

**Branch 1, NARROWING. One artifact.**

1. `docs/ROADMAP.md:103`: delete `- Square/POS integrations.`, and record the broader POS capability
   as dropped rather than absorbed.
2. `docs/ROADMAP.md` status header and its BASELINE row.
3. **No `docs/PRD.md` change.** `:226` already scopes F-408 to "inventory low-stock alerts (manual
   counts or Square webhook)", which is exactly what this branch keeps, so there is nothing to widen
   and no status or baseline record to move. An earlier revision counted the PRD here, which
   overpriced the cheapest branch on the board.
4. **No `docs/DESIGN.md` change.** F-408 keeps its meaning, so `:25` is not engaged.
5. **The §5 step 7 guard**, required: the same Roadmap/PRD/ARCHITECTURE-FUTURE agreement rule.
6. No new id, no new tracker issue, no architecture route.

**Branch 2, WIDENING. Three artifacts.**

1. `docs/ROADMAP.md:103` and `:90`: delete the standalone entry and widen F-408's entry to absorb it.
2. `docs/PRD.md:226`: widen the product requirement to match, since it currently describes only the
   inventory webhook and would otherwise contradict the Roadmap.
3. `docs/DESIGN.md:25`: "Once assigned, an ID's meaning never changes, and IDs are never reused."
   Widening F-408 from `Inventory Low-Stock Alerts` into the broader capability changes what F-408
   means, which is the case that rule names, so this branch needs an amendment or a recorded approved
   exception.
4. Status headers for all three, and their BASELINE rows.
5. No new id and no new tracker issue.

**So the two branches differ by two artifacts AND by a policy collision**, and the narrowing branch is
the only one of the six branches in this brief that touches a single approved artifact and engages no
policy rule. That pairing is stated here rather than left to be assembled from two sections.

This is the option DESIGN.md's absorption rule and its two precedents point at, and still the
cheapest of the four, and its cost is stated per branch below rather than here: **narrowing is one
artifact**, the Roadmap alone, and **widening is three**. An earlier revision of this sentence said
option B is no longer a single-artifact change, which was an option-level figure that had already
stopped being meaningful, and it contradicted the branch definition one section down. It is the third
time this figure has been wrong, which is why the sentence now points at the branches instead of
restating a number.

## Sequencing note: PR #131, which has merged

**This blocker no longer exists.** It is recorded rather than deleted because option B was priced as
sequencing-blocked on the strength of it, and the product owner was being asked to carry that.

`8d91e8c` merged PR #131 into `a7158c6`. Its footprint included `specs/F-203-deadline-alerts.md`, so
while it was open, item 1 option B's edit to that spec, and option A's if the pointer is retargeted,
had to land after it or be coordinated with its owner. Neither does now.

Two consequences: option B is no longer the slower option on sequencing grounds, and the two options
no longer differ on when they could start.

---

# SPEC-CONFLICT #144: the vocabulary question

Item 1 of its required decisions governs the other four and is not attempted here. What follows is
verification only.

## What #146 already settled, which is one full bullet of the conflict

The issue's second internal-inconsistency bullet says `specs/F-206`, `docs/PRD.md`,
`docs/DESIGN.md` and `apps/web/app/plan/plan-line.tsx` present a source-less `COVERAGE_GAP` as a
source that is not yet established. **That is now entirely obsolete.**

The four superseded phrasings are named descriptively rather than quoted below, because the guard
PR #146 added denies them repo-wide with no exceptions, and it fails on any file that reproduces
one. It caught the first draft of this brief, which is the guard working: a document explaining
that a phrasing is gone is exactly the shape a copy-paste out of git history also has, and the
guard cannot tell them apart. Paraphrasing here costs nothing.

| Superseded phrasing | Occurrences on `main` |
|---|---|
| the spaced form asserting a source is not yet established | 0 files |
| its hyphenated run-together, used adjectivally | 0 files |
| the spaced form asserting that a source has not been published | 0 files |
| the hyphenated no-plus-source compound | 0 files |

All four cited locations now state the published meaning instead. F-206 AC 2 and the PRD and DESIGN
lines all read that a source-less COVERAGE_GAP "visibly states that the combination is not covered by
this ruleset version", and the render site emits `NOT_COVERED_BY_RULESET`. A guard test asserts the
superseded wordings appear nowhere in the repository.

**Consequence for the decision:** the COVERAGE_GAP half of this conflict is narrower than the issue
describes. What remains of it is one item, immediately below, and it is a rules-artifact question
rather than a copy question.

## What is still true, and is the live half

The two claim-bearing advisories are unchanged. Both carry `verification.status = COVERAGE_GAP`,
both have `source: null`, and both assert regulatory content in `advisory_text`:

- **ADV-ALCOHOL-PUBLIC-001**, quoted verbatim: "Alcohol in public space is outside this ruleset version's validated
  coverage (SAPO prohibits alcohol at block parties, street events, festivals, and parades per the
  CECM FAQ; other paths not evaluated). Confirm with the relevant agency." Evidence ref: "CECM FAQ
  prohibition quote, VS Round2 #6".
- **ADV-SAPO-OTHER-CLASS-001**, quoted verbatim: "This SAPO class … is outside this ruleset version's validated
  coverage. Known published deadlines for reference: production 10 days; open culture 15 days; street
  festival Dec 31 of prior year; single block festival OFFICIAL CONFLICT (90 days vs Dec 31 of prior
  year). Confirm with SAPO." Evidence ref: "VS Round2 #4-5".

The legend they carry says "combination not modeled by this ruleset version; advisory asserts
nothing". Both texts assert something. That contradiction is live, and it belongs to the
verification owner PLUS the rules reviewer, which is how governance's change-class table routes
regulatory status and content; an earlier revision named only the first of the two
under the issue's own authority section.

### Whether the claims are evidenced, re-derived claim by claim

An earlier draft of this brief said the issue's "without source records" was imprecise because both
advisories carry `evidence` references, and treated the claims as evidenced on that basis. **That
inherited a citation label as if it were a source record.** The labels have now been read against the
source text. The result does not go the way either the earlier draft or the review expected, so each
claim is set out separately with the located text quoted rather than summarised.

**ADV-ALCOHOL-PUBLIC-001** claims a prohibition for four categories. Its evidence ref is "CECM FAQ
prohibition quote, VS Round2 #6". Round 2 #6 reads, in full:

> **Block party** (`block-parties.page`): community-sponsored public event, "no sales of goods or
> services"; "Alcohol, vendors, commercial branding and sponsorships are not permitted"; applicant
> "must be a member of a block association and given permission by their neighbors"; 60-day
> deadline. Community-board recommendation per SAPO rules §1-04(h).

| claim | located in the dossier |
|---|---|
| block parties | **candidate lead located**, in the quoted line above |
| street events | **no candidate lead located** |
| festivals | **no candidate lead located** |
| parades | **no candidate lead located** — "parade" appears nowhere in `VERIFICATION-SOURCES.md` |

Two further precisions. The located prohibition is on `block-parties.page`, not on the CECM FAQ the
advisory names, so the attribution does not match the record even for the one category with a lead.
And the whole document was searched, not only the cited entry, before writing "no candidate lead located".

**NEITHER "SUPPORTED" NOR "UNSUPPORTED" IS THE RIGHT WORD, AND ROUND 1 GOT THIS WRONG TWICE OVER.**
Round 1 declined the review's finding on `ADV-SAPO-OTHER-CLASS-001` by citing RF-2, as though
locating text there settled that the deadlines are supported. It does not, and the document says so
about itself on its own third line:

> **Purpose:** Candidate primary sources for the 11 open `[VERIFY]` items in `OPEN-QUESTIONS.md` §2,
> collected 2026-07-22 by a four-agent research pass. **Nothing in this document is a verification.**
> … SUPPORT / CONTRADICT / NOT ADDRESS labels are the researchers' candidate assessments of fetched
> text against the encoded claim, for triage only.

Three of its own section headings repeat it: "Findings for rule authoring (candidate, not
promoted)", "Per-rule attribution located (candidate, not promoted)", "Notes for rule authoring
(candidate, not promoted)". `OPEN-QUESTIONS.md:48` puts promotion elsewhere: "Every promotion to
VERIFIED follows the governance rules: primary sources only, record URL + date checked, update the
rules file's `verification` block, named reviewer."

So what the dossier establishes is narrower than either side of the round-1 exchange said:

| claim | status against the dossier |
|---|---|
| production 10 days | **candidate lead located** (RF-2), fetched 2026-07-22, never promoted |
| open culture 15 days | **candidate lead located** (Round 2 #4), same |
| street festival Dec 31 of prior year | **candidate lead located** (RF-2), same |
| single block festival 90 days vs Dec 31 | **candidate lead located** (Round 2 #5), same |
| alcohol prohibited at block parties | **candidate lead located** (Round 2 #6), same |
| alcohol prohibited at street events | **no candidate lead located** |
| alcohol prohibited at festivals | **no candidate lead located** |
| alcohol prohibited at parades | **no candidate lead located.** "parade" appears nowhere in the dossier |

**What promotion would cost, and it is not four fetches.** An earlier revision priced it as a
re-fetch of four URLs plus one `verification` edit. That is the research half only, and it omits the
publication workflow that a change to a rule's `verification` block triggers, because the rules file
is a published artifact:

- `ARCHITECTURE-FUTURE.md:26` and `:101` make a published ruleset immutable and require the version
  pointer to advance rather than the file to be edited in place, so a promotion is a NEW ruleset
  version, not a field update.
- `BASELINE.md:3` requires the baseline update in the same PR as the status change.
- `DOCUMENTATION-GOVERNANCE.md:137` requires the regulatory suite, the changelog and replay
  verification after publication.

**PR #171 has already enumerated this same workflow, and this brief cites it rather than deriving a
second account of it.** Its "Every constant coupled to the published artifact, enumerated once"
section sweeps the couplings rather than listing the ones anyone remembered, including the boot
comparisons in `apps/api/src/ruleset.ts` that fail the API at startup on a version or rule-count
mismatch, and the version-pinned test expectations. Two documents deriving that list separately is
how they come to disagree about what publishing costs, so the enumeration lives there and is
referenced here.

**The research pass is two passes with different shapes, and an earlier revision priced only the
first.** "Four URLs and a judgement" covers the SAPO deadline candidates and nothing else:

- **The deadline re-fetch is BOUNDED.** Four known URLs, already located and read on 2026-07-22: the
  CECM per-type deadlines page, `open-culture.page`, `single-block-festivals.page` and 50 RCNY §1-08.
  Re-fetch behind a browser user-agent, record URL and date against each, form a judgement. The work
  is knowable in advance because the starting points exist.
- **The block-party alcohol candidate is bounded on the same terms**, one more URL, and an earlier
  revision left it out of the count entirely.
- **The street-event, festival and parade alcohol claims are OPEN-ENDED.** This brief has already
  established that NO candidate lead exists for any of them, so there is no URL to re-fetch and no
  starting point to bound the work. It is source discovery, not verification, and it may end with no
  source found after any amount of effort. That is a real possible outcome rather than a failure of
  the pass.

**And the open-ended half does not change whether a publication happens**, which is what makes the
distinction safe to state. Both outcomes of that investigation land in the same workflow: a source
found promotes the claim, a source not found narrows or removes the assertion or changes the status,
and each is an edit to an immutable published ruleset. So the honest statement is that one half is a
bounded re-fetch, the other is unbounded research whose result changes the CONTENT of a publication
and not its necessity, and the publication itself is a ruleset version bump with its baseline row,
digest, lineage record, boot constants, pinned tests, changelog and replay verification, per PR
#171's enumeration cited above.

**And finding no source does NOT avoid the publication cost**, which an earlier revision of this
section claimed. If the search for the three alcohol categories comes back empty, that settles the
question and does not close it: `ADV-ALCOHOL-PUBLIC-001` still asserts three prohibitions while its
`COVERAGE_GAP` status promises an advisory that asserts nothing, and the only ways to resolve that
are to narrow or remove `advisory_text`. **Removal or narrowing is MANDATORY; a status change may
accompany it and can never replace it.** An earlier revision offered the status change as an
alternative, and a later one corrected the reasoning below while leaving that sentence standing, so
the section argued both ways at once. It says one thing now.

`RESEARCH_REQUIRED` accurately reports that no source was located. It does not license the assertion
sitting beside it: the advisory would then say no source was found AND state the prohibition anyway.
`COVERAGE_GAP` is worse, because it promises an advisory that asserts nothing, which is the
contradiction being fixed. Neither status makes unsupported regulatory content publishable, because
no status does. The claim is the problem, not the label on it.

So on the no-source branch the text MUST be narrowed or removed. **What it narrows TO is itself
conditional, which an earlier revision of this sentence got wrong by saying the record "supports" the
block-party prohibition.** It does not: `VERIFICATION-SOURCES.md:3` says nothing in that document is a
verification, and this brief has already recorded that its block-party entry is a candidate lead
fetched on 2026-07-22 and never promoted. So the block-party claim stands on the same footing as the
other three, one step further along.

That gives the no-source branch two outcomes rather than one, and both belong in the decision:

- **If the bounded re-fetch confirms the block-party source and the verification owner promotes it**,
  the advisory narrows to that one prohibition and the other three categories are removed.
- **If the re-fetch fails, or the verification owner does not confirm it**, nothing in the advisory
  has a promoted source and the publication removes the claim entirely, all four categories. The
  advisory would then say what a `COVERAGE_GAP` is supposed to say and nothing more.

Naming only the first outcome would have left the publication narrowing to a claim that is itself
unpromoted, which is the same defect one category smaller. A status change is
accompanying metadata that may travel with that edit and never a remedy that replaces it. Written the
other way, the publication workflow could carry three invented prohibitions through a version bump,
a baseline row, a changelog and a replay verification, and finish believing it had complied. That is
CONTRIBUTING's first golden rule reached by paperwork rather than by intent, which is the more
dangerous route because every gate reports green.

Every one of those is
an edit to the published ruleset, which is immutable, so every one is a new version carrying the same
baseline row, digest, lineage record, boot constants, pinned tests, changelog and replay verification
enumerated in PR #171 and cited above rather than restated here.

So **both outcomes of the verification pass require a publication, and they differ only in what the
publication says**: one records a promoted status against re-fetched sources, the other records an
advisory narrowed to what the sources support. Only the promotion STEP disappears when no source is
found. The workflow it feeds does not, and pricing the empty result at zero made the cheaper-looking
outcome look free when it is the same publication.

**So the issue's original statement is closer to right than either round-1 revision allowed**, and
precisely: `ADV-ALCOHOL-PUBLIC-001` asserts a prohibition for three categories with no located
candidate, and `ADV-SAPO-OTHER-CLASS-001` asserts four deadlines whose candidates are located but
unpromoted. Different defects, different remedies, and this brief previously treated the two
advisories as one.

**Recorded for the revision history, because this correction was made twice at two different
depths.** Round 1 corrected this brief for treating an evidence LABEL as a source record, and then
made the same mistake one level down, treating the dossier's CONTENT as a verification without
reading the dossier's own status header. The review confirmed that decline without checking the
header either. The shape is identical both times, taking a label for the thing it labels, which is
the same failure as trusting a line number behind a section sigil. What catches it is reading an
artifact's own statement of what it is before quoting anything out of it.

**What survives of the earlier draft's correction.** The distinction between a missing `source`
object and unevidenced claims is still real, and SPEC-CONFLICT #75's exemption still permits the
absent `source` for an assertion-free COVERAGE_GAP. What does not survive is using that distinction
to call the claims evidenced: it is true of `ADV-SAPO-OTHER-CLASS-001` and false of
`ADV-ALCOHOL-PUBLIC-001` for three of its four categories. The two advisories are in different
positions and this brief previously treated them as one.

The legend contradiction stated above is unaffected: both texts assert while the legend they carry
says an advisory asserts nothing. That remains the verification owner's AND the rules reviewer's,
which is the routing governance's change-class table gives regulatory status and content, and this
brief decides none of it.

## Everything else in the issue, verified

| Issue claim | Status on `main` |
|---|---|
| `PRD.md:225` and `ROADMAP.md:88` require F-109's five scope-support states | **true**, both present, five values unchanged |
| `ARCHITECTURE-FUTURE.md` §7.1 publishes four result-completeness values and leaves the relationship open | **true**, and §7.1 says so in terms |
| ruleset legend defines COVERAGE_GAP as an unmodeled combination asserting nothing | **true** |
| the F-109 draft on PR #134 has no approved mapping and its AC-01 adopts the four values | **true**, PR #134 is OPEN and carries `specs/F-109-coverage-state-classification.md` |
| SPEC-CONFLICT #75 is closed and does not reconcile the claim-bearing advisories | **true** |
| issue #54's title is stale | **true**, still reads "[F-109] Coverage-state classification (phase-4)" |
| OPEN-QUESTIONS T-4 tracks the question | **true**, and T-4 is the better statement of it than the issue is |

**Line citations:** 11 of the issue's 12 file:line references still resolve to what it claims. The
exception is `specs/F-206-rules-snapshot-banner.md:41`, now a blank line; the COVERAGE_GAP edge case
it pointed at is at `:51`, moved by #154's additions to AC 4.

## Staleness in the F-109 draft beyond what the issue records

Checked against PR #134's head (`agent/draft-future-feature-specs`):

1. The spec is titled **"F-109 · Coverage-State Classification"** and its filename is
   `F-109-coverage-state-classification.md`. Both predate #136's retitle to "Scope-Support
   Classification".
2. Its AC-01 names the four values as `COMPLETE_WITHIN_VALIDATED_COVERAGE`, **`CONDITIONAL`**,
   `CANNOT_DETERMINE` and `OUTSIDE_VALIDATED_COVERAGE`. **#136 replaced `CONDITIONAL` with
   `OPEN_FACTS_MAY_CHANGE_OUTCOME`**, which the draft never mentions. So AC-01 both conflicts with the
   approved five-state requirement, as the issue says, and misquotes the four-value set it adopts.
3. **Could not verify** the issue's "the pending edit restores the five values". The branch head still
   carries the four-value AC-01. Either the edit has not landed on that branch or the claim is stale;
   this brief does not decide which.

## What #154 settled, which for this issue is almost nothing

#154 re-keyed F-206 AC 4's attribution cases and corrected two F-202 cross-references. It did not
touch F-206 AC 2, the COVERAGE_GAP legend, the advisories, or any scope-axis vocabulary. Its only
effect on this issue is that one line citation moved. Recorded so the decision is not delayed looking
for an interaction that is not there.

## Approval classes the resolution would need, and whether any are satisfied

The issue's authority section and OPEN-QUESTIONS T-4 agree, and T-4 is more precise. Summarising
without deciding:

| Decision | Class | Satisfied? |
|---|---|---|
| Item 1, one axis or three (in documents only) | durable architecture decision; product owner as architecture owner | **no** |
| Item 1 or 2, once implemented as a consumed shared enum | all affected lane owners plus architecture owner | **no** |
| Item 3, the legend and the two advisories | regulatory status/content: verification owner plus rules reviewer | **no** |
| Item 4, F-206/PRD/DESIGN/UI conformance | lower authority, follows the rules resolution | the COVERAGE_GAP copy half is **already done** by #146 |
| Item 5, fixtures and a rules-artifact check | follows whichever invariant is approved | **no** |

**None of #144's five decisions is satisfied.** #136 carried only the rename, and it says so.

**THE ADVISORY CONTRADICTION IS LIVE NOW AND DOES NOT WAIT ON THE AXIS DECISION.** An earlier
revision of this brief ordered it behind #144's item 1, which let a future scope-axis choice govern a
current defect. T-4 says the opposite in terms:

> **Blocks F-109 and F-601. Not the shipped engine:** `COVERAGE_GAP` works today and §7.1's values are
> implemented nowhere, so no current work waits on this.

The two advisories are PUBLISHED, in the shipped ruleset, and they contradict the shipped legend
today: both assert regulatory content while `COVERAGE_GAP` promises an advisory that asserts nothing,
and three of `ADV-ALCOHOL-PUBLIC-001`'s four categories have no located candidate lead at all.
Sequencing that behind item 1 leaves unsupported regulatory assertions live until unrelated Phase 2
work is scheduled, which may be never on any date this brief can see.

**So it is an independent current reconciliation.** It needs the verification owner and the rules
reviewer, it needs the publication workflow described above whichever way the sources come back, and
it needs neither the axis decision nor either #127 item. If the axis is later retired or redefined in
a way that changes what `COVERAGE_GAP` means, that is a separate change against whatever the ruleset
says at that point, and it is handled then.

This is a change to WHEN, not only to what, and it is the most consequential correction in this
revision: the previous ordering made a live defect wait on a decision that T-4 says blocks nothing
shipped.

T-4 adds one routing point worth carrying into the decision: because one option on the table would
retire or redefine the shipped `COVERAGE_GAP`, a closing change taking that path is *also* a
regulatory status change, and the other two paths do not reach the verification owner at all. So the
choice of option determines which owners must sign, and two of the three options can be fully
approved without the only owner who changes verification statuses.

## A defect in where those approval classes were recorded, since fixed

An earlier revision flagged OPEN-QUESTIONS T-4 for citing governance "§98", "§95" and "§93" when
`DOCUMENTATION-GOVERNANCE.md` has §1 through §10 only. **That is fixed on `a7158c6`:** `7626391`
merged PR #161, "Cite governance change classes by their rows, not by line numbers read as sections",
and T-4 no longer carries those citations. The approval routing a reader consults is sound.

Retained rather than deleted because the flag was raised to the product owner and its disappearance
is part of the record. Nothing in either decision depends on it.

---

# Summary of what would make each decision cheapest

Stated as observations, not recommendations.

**#127 item 1** is narrower than filed, and narrower again than an earlier draft of this brief made
it: the two artifacts already agree on F-203's meaning, and the Phase 2 depth is planned rather than
scheduled scope, so no §7 obligation is outstanding today. What remains is a naming and tracking
choice that becomes live when that work is scheduled. Option B touches THREE approved artifacts on either
branch: the Roadmap and the F-203 spec on both, plus `docs/PRD.md:206` on retain and
`docs/DESIGN.md:25` on drop, since deleting a capability from the approved spec narrows F-203's
meaning. Its drop branch was priced at two until that collision was found. Its PR #131 sequencing
block has merged away. Option A touches FOUR
approved artifacts at SIX locations once the derivation above is run rather than a list assembled:
the Roadmap entry, `docs/PRD.md:206`, the F-203 spec pointer its own step 1 invalidates, and
`docs/DESIGN.md` three times, for its saturated STAGE 2 range and for BOTH ID rules, `:27`'s
absorption policy because option A splits and `:25`'s meaning-never-changes because option A also
narrows F-203. Two further locations are flagged rather than priced, both declared id ranges in
`docs/ARCHITECTURE-FUTURE.md`. **Every option additionally carries governance §5 step 7's validation
rule**, which is not an approved artifact and so is not in these counts, but is a required step that
no option carried for eight rounds. **Option A is therefore not compliant as written, against two rules
rather than one**, which earlier revisions denied and then understated; it becomes compliant with
decisions the product owner is entitled to make and has not yet been asked for.

**#127 item 2** has an approved policy pointing at option B, with two precedents, and option B is the
cheapest of the four change sets. Its two branches are priced separately, because no option-level
figure is right for both: **narrowing is ONE artifact**, the Roadmap alone, since `docs/PRD.md:226`
already scopes F-408 to the inventory webhook that branch keeps and F-408's meaning does not change;
**widening is THREE**, adding the PRD and `docs/DESIGN.md:25`, because it changes an assigned id's
meaning. Two earlier revisions priced this option at one artifact and then at two, and both were
wrong for one branch. The narrowing branch is the only one of the six branches in this brief that
touches a single approved artifact and engages no policy rule, which is the sharpest pricing fact
available and was previously obscured by an option-level count.

**#144** has lost one of its three internal-inconsistency bullets to #146 and retains one live
regulatory item, the two claim-bearing advisories, which is the only part with a named owner who has
not signed anything. Items 1 and 2 remain untouched by anything that has merged as of `a7158c6`, and the F-109 draft they
depend on is stale against #136 in three ways; that draft is on PR #134, which is still OPEN on the
recorded tree and so is still a draft rather than an approved mapping.
