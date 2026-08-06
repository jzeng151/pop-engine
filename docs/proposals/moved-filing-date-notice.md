# PopEngine — Moved-Filing-Date Notice

**Status:** ARCHIVED (2026-07-26) — historical research, never current authority (`docs/DOCUMENTATION-GOVERNANCE.md` §3). Its premise defect was tested and held; `specs/F-202-compliance-checklist.md` Acceptance Criterion 9 is the approved outcome, and it is narrower than anything proposed here. §2's criteria were NOT approved and were not adopted. §4's research is retained because it is the evidence for what was rejected. `docs/BASELINE.md` already classes `docs/proposals/*` as ARCHIVED / PROPOSED drafts, so this needs no manifest row of its own and none was added.
**Covered by:** `docs/BASELINE.md`, "Superseded/draft material" row (`docs/proposals/*`): _never build from these_.
**Proposed:** new acceptance criteria on `specs/F-202-compliance-checklist.md`, plus the rule data and schema they would require.
**Blocked:** PR #117, which implemented this behaviour. #117 is superseded rather than unblocked — see below.
**Drafted:** 2026-07-26

---

## 0. Outcome (2026-07-26): the premise defect was decisive, not a caveat

SPEC-CONFLICT #121 was resolved by approving **F-202 Acceptance Criterion 9**, which authorises a notice that makes two claims and forbids a third. Read that criterion, not §2 of this document, before implementing anything.

**Approved.** The row may state that the deadline PopEngine **computes** for the item has changed, and where the two plans pin different `ruleset_version`s it may state that, naming both versions.

What it compares, which dates it names, and what it must say when either date is absent are **AC 9's to state, and are deliberately not restated here**. This section records which way SPEC-CONFLICT #121 was resolved; it is not a second copy of the criterion. An earlier revision of this paragraph did paraphrase the mechanics, and the paraphrase drifted from the approved text inside a single review round: it said "earlier" where AC 9 requires "previous" and explains why, and it collapsed `not_applicable` into `not_calculable`, a distinction AC 9 was revised to preserve. Both were corrections AC 9 had already made. A summary that has to be re-patched every time the criterion is refined is the wrong artifact, so it now points rather than paraphrases.

**Rejected: every claim about the organizer's filed application.** Not "you may need to contact the agency about amending your application", not a re-application, not a linked procedure, not the per-agency branch table in §2, not AC-N+6's three-way copy split.

**Why, and it is this document's own §2 finding taken to its conclusion.** "Known defect in AC-N: the trigger is wider than the premise" recorded that `latest_apply_date` is computed and moves when any input moves, and offered option 2 (reword) as a mitigation and option 1 (record the cause of the change at regeneration) as the fix. Neither was adopted, because the defect turned out to be disqualifying for the whole class of claim rather than a wording problem: no source establishes that a change in **our arithmetic** obliges an organizer to do anything at all. §4.3's research answers a different question — what happens when the **event** changes — and it answers it for two of its seven grouped rows, which is a narrower result than it sounds: those seven rows are groupings, not findings, and §4.2 counts thirteen date-capable findings plus one merged requirement behind them. Four reachable findings were never surveyed at all (`SAPO-BLOCK-PARTY-001`, `DOB-ASSEMBLY-001`, `SLA-ONEDAY-001`, `SLA-CATERING-001`), and neither was the merged `dob-structure` requirement. A notice built on that research would attach an amendment procedure, honestly cited, to an event that did not change.

**The worked example, taken from what is already merged rather than from anything pending.** `apps/api/src/calendar.ts` publishes no holiday list for the calendar the ruleset pins, and deliberately: SPEC-CONFLICT #130 records that no consulted source establishes that a published closure stops an agency's filing counter. So every `business_days_minimum` finding — `DOB-TENT-001`, `DOB-ASSEMBLY-001`, `SLA-ONEDAY-001`, `SLA-CATERING-001` — renders NOT_CALCULABLE today, with no `latest_apply_date` at all. Publishing that list is one of #130's own resolutions, and the day it happens every one of those dates appears at once; any future ruleset that corrects a lead time or a boundary moves them again. Nothing about any organizer's event changes in either direction. Under PR #117's behaviour every organizer holding one of those items would have been told their filing date moved and sent to the agency about amending their filing, on the strength of a change in our arithmetic alone. What that change does or does not mean for a filing already with an agency is not something this document establishes in either direction, which is the whole of the rejection below.

An earlier draft of this section illustrated the same point with a then-pending correction to `DOB-ASSEMBLY-001`'s lead time and boundary. It was removed because at the time of writing that correction was unpublished. Describing an unpublished correction to a disputed regulatory semantic as established fact is the exact failure Acceptance Criterion 9 exists to prevent, and a document arguing for that criterion cannot be the thing that does it.

**That reason has since expired, and this paragraph is retained as history rather than as a live caution.** `rules/nyc-rules.v2.8.json` is APPROVED in `docs/BASELINE.md` and publishes the correction: `DOB-ASSEMBLY-001` now carries `business_days_minimum`, `business_days: 10` and `boundary: inclusive`, with its own `qualification` citing two independent primary sources. `nyc-rules.v2.7.json` no longer exists in the tree. What has not changed is `docs/OPEN-QUESTIONS.md` R-4, which remains open and still says "pin exact wording before UI copy ships"; that is a question about the wording UI copy uses, not about whether the rule is published.

**§4 is retained deliberately.** The per-agency table is the evidence for the rejection: it shows that AMEND was established for SAPO and a cancel-then-re-request for FDNY generators, that five of seven rows located nothing, and — the load-bearing part — that even the two established procedures address a changed event date rather than a changed computation. Deleting the research would leave the rejection looking like an untested preference. §4.4's no-inheritance rule and the §4 method note stand on their own and are worth keeping for any future survey.

**PR #117 is superseded, not revived.** It built the rejected claim, and it carried migration 008's `checklist_items.worked_against_date`. AC 9 needs no new column: the persisted plan item already carries the date the row is pointed at. That is a coarser signal than #117's column — it tracks the last conversion or review of the checklist rather than each individual action on a row — and AC 9 is written against what it actually says, which is why AC-N+3's persist-at-the-moment-of-work machinery is not part of the approved criterion either. #117's column was never merged and is not being added.

Still open and untouched by this outcome: §5 step 2's observation that procedure research state cannot be expressed through `verification.status` without relabelling a whole finding. It only matters if procedure text is ever published, which AC 9 does not require.

---

## 1. Why this document exists

> **Historical from here down (2026-07-26).** Everything below §0 was written before SPEC-CONFLICT #121 was filed and resolved, and it is retained as the record of what was planned and researched — not as work to do. Where a paragraph below states a task or a status, §0 is what actually happened. The inline corrections marked **[SUPERSEDED]** are the places where following the old text would now cause harm rather than merely repeat history.

PR #117 implements a moved-filing-date notice on the compliance checklist: when a requirement the organizer has already filed for shows a filing date different from the one they worked against, the row carries a notice.

Review established that **no approved acceptance criterion covers any of it**. Not the behaviour, not the statuses that trigger it, not the persisted column migration 008 adds to `checklist_items`. The whole contract is inferred from a reading of what the product ought to do, and `AGENTS.md:19-20` forbids exactly that: an inferred contract is not a contract.

The product owner has **parked** the work rather than approving criteria under review pressure. That is the right call and this document records it, so the next person does not rediscover the gap or, worse, read #117's merged code as the specification.

**#117 is not merged and should not be merged until this is approved as acceptance criteria on F-202.** — **[SUPERSEDED]** approving criteria did not unblock #117. AC 9 authorises a narrower notice than #117 built and forbids the claim it was built around, so #117 is superseded; see §0.

### The required conflict record did not exist yet

> **[SUPERSEDED]** It exists and is closed: **SPEC-CONFLICT #121**, resolved by AC 9. Do not file another for this gap.

Parking the code in a proposal is **not** the record governance asks for, and this document should not be mistaken for it. `docs/DOCUMENTATION-GOVERNANCE.md` §5 requires a conflict record when a required artifact is missing, with the exact artifact locations and the user-visible consequence. Checked across the repository's issues at the time of drafting: **no SPEC-CONFLICT existed for the moved-date gap.** #115 is F-206 provenance, which is a different artifact and a different defect.

So filing it was a **prerequisite step, not an alternative to this document**, and it was step 0 of §5. This proposal is the design record; the issue is the tracking record; the two are not interchangeable, and a proposal that quietly stands in for a conflict record is the process failure that let #117 reach review with an inferred contract in the first place.

### What the approved specs actually say

Checked rather than asserted, against `specs/F-202-compliance-checklist.md` and `specs/F-206-rules-snapshot-banner.md` at commit `0122eca`:

- **Neither spec has an acceptance criterion about a filing date moving**, about reapplication, or about amending an application.
- The nearest approved criterion is **F-202 AC 5**: "Checklist shows each item's `latest_apply_date` (and `apply_after_date` when gated) so the deadline context lives where the work happens." That requires the date to be **shown**. It says nothing about surfacing that the date has **changed**, which is the entire subject here.
- The only textual match for "amend" in either file is in F-206's own status header, recording that F-206's Acceptance Criterion 4 was amended on 2026-07-26 for SPEC-CONFLICT #115. That is a spec edit, not a permit procedure, and it is not evidence of coverage.

So the gap is total, and it is a gap in F-202. F-206 governs snapshot provenance and is not the right home for it.

---

## 2. Proposed acceptance criteria

These are drafted as criteria for adoption into F-202, in F-202's numbering style. They are proposals: nothing below is approved.

**AC-N (the notice).** When a checklist item at status `submitted` or `approved` shows a `latest_apply_date` different from the one displayed when the organizer last worked that row, the checklist surfaces a notice on that row. The notice states that the filing date moved. It then states the **project's** knowledge of what to do about it, never the agency's silence:

- where a published procedure has been established for that requirement **in the state the row is in**, the notice states it with its citation **and its own verification status**, per the branches below;
- where a search was run and located nothing, the notice says exactly that, in those terms: no published procedure was found, confirm with the agency;
- where **no search has been run** for that requirement, the notice says _that_, and does not borrow the wording above. See AC-N+6.

**The procedure carries its own verification state, and the notice renders it.** A procedure is a published regulatory fact like any other, so it gets the treatment F-206 AC 2 already requires of every plan line, not a private exemption for being new. Collapsing every status into "here is the procedure" or "nothing found" would let a procedure marked OFFICIAL_CONFLICT reach an organizer looking settled, which is the one outcome this product refuses everywhere else:

| Procedure status  | What the notice renders                                                 |
| ----------------- | ----------------------------------------------------------------------- |
| SOURCE_CONFIRMED  | the procedure with its citation                                         |
| RESEARCH_REQUIRED | the procedure, plus "confirm with agency" **visibly**, not in a tooltip |
| OFFICIAL_CONFLICT | **both readings with both sources**, never resolved to one              |
| COVERAGE_GAP      | says the combination is not covered by this ruleset version, and asserts nothing further |

This is the same status vocabulary F-201 AC 2 and F-206 AC 2 use, deliberately, so a reader does not have to learn a second one. It is also the reason §5 needs field-level verification metadata: without it there is no status to render here, and AC-N+1's requirement to load procedure verification metadata has nothing to load.

The notice never says that an agency publishes nothing. Two unsuccessful research passes establish what this project failed to locate, not what the agency has. Section 4's caveat is not a footnote on the research, it is a constraint on the copy: asserting agency silence turns incomplete research into regulatory advice, which is the failure this product is built against. (Corrected on review; an earlier draft of this criterion had the notice say the agency publishes nothing.)

### Known defect in AC-N: the trigger is wider than the premise

**Read this before AC-N is adopted.** It is a defect in the premise, not in the drafting, and it is not resolved below. It is recorded here rather than in a footnote because a reader who meets AC-N and not this paragraph will implement the wrong thing carefully.

**What the trigger detects:** the filing date PopEngine **computes** for this requirement changed between two plans.

**What the procedures address:** the date **on the filed application or granted permit** changed. 50 RCNY 1-07 is about amending an application's date.

Those are different sets, and the trigger is neither sufficient nor necessary for the premise.

**Not sufficient.** `latest_apply_date` is computed from the event date, the rule's published lead time, and for business-day rules the pinned holiday calendar. Every one of the other inputs can move with the event date untouched:

- a newer ruleset changes a lead time (`published_minimum`, `business_days_minimum`). This repository bumped its ruleset six times in one week;
- a level or size input changes, so `published_minimum_by_level` resolves to a different number of days. `SAPO-PLAZA-001` is exactly this shape, and SAPO is the one agency for which an amendment procedure is established;
- the pinned holiday calendar changes. This one is scheduled rather than hypothetical: `us-ny-business-days@2026.1` currently carries an **empty** holiday list, published as RESEARCH_REQUIRED. The day it is published, every `business_days_minimum` date moves at once, which is `DOB-TENT-001`, `DOB-ASSEMBLY-001`, `SLA-ONEDAY-001` and `SLA-CATERING-001`, and every `submitted` row among them would be told to ask its agency about amending a date that never changed.

**Not necessary.** The inverse also holds. An event moved between two days that `subtractBusinessDays` maps to the same deadline leaves `latest_apply_date` identical, so the notice stays silent although the date on the application genuinely changed. That is the case the organizer most needs and the trigger cannot see it.

**Why this is not fixed by narrowing the trigger to event-date edits.** The checklist cannot see which intake field moved. It compares two computed dates on two plans; #117 established that the row cannot even reconstruct which plan was on screen without persisting it. "Only fire when the event date changed" is not expressible against what the checklist holds.

**What resolving it would take**, neither of which is proposed here:

1. **Record the cause of the change at regeneration.** Persist enough with the plan to answer "did the event date move between these two plans, or did something else". That is a plan-writer and schema change of the same class as §5 step 3, and it is the only option that lets the criteria keep selecting an amendment procedure honestly.
2. **Describe the recomputation instead of implying the application's date moved.** Wording that would be true as things stand, offered because the brief asks for it if it exists: _"The filing date PopEngine computes for this requirement has changed since you last worked this row. If your event date has changed, confirm with the agency whether your existing application needs amending."_

**Option 2 does not close this finding, and should not be recorded as though it does.** It removes the false statement, which is worth having, but AC-N would still _select_ an amendment procedure on a trigger that does not establish the amendment's premise, and it pushes the discrimination onto the organizer, who at least does know whether their event date moved. It is a mitigation, not a fix. The fix is option 1.

**AC-N+1 (the procedure comes from the row's own source plan).** The procedure text, its citation and its verification metadata are read from the same versioned plan data the row's other values and its provenance come from, never from the live rules file.

Without this the notice reproduces the defect SPEC-CONFLICT #115 was filed over. A retained row viewed after a ruleset update would pair an old row and its worked-against date with procedure text published later: a pinned version beside data it never carried, which F-206 AC 4 forbids in as many words. If the procedure is not available from the row's source plan, the notice falls back to the located-nothing wording above rather than reaching for the live file.

**AC-N+2 (a notice, never a requirement).** The notice changes nothing else about the row. No status changes, no status transition is blocked, nothing is gated on it, and the row stays fully editable. Everything the organizer could do before the date moved, they can still do.

**AC-N+3 (persistence, not derivation).** The filing date the organizer worked against is **persisted at the moment they work the row**, and is never derived afterwards from plan timestamps.

**"Work the row" is defined as an enumerated set of actions, not left to the implementer.** F-202 treats status changes, note edits and document uploads as separate user actions, and uploads do not go through the same endpoint, so "when they work the row" is ambiguous exactly where it is load-bearing. Every action below acknowledges the date on screen, so every one records it:

| Action          | Endpoint                                  | Records the displayed date                               |
| --------------- | ----------------------------------------- | -------------------------------------------------------- |
| Status change   | `PATCH /api/checklist-items/:id`          | yes                                                      |
| Note edit       | `PATCH /api/checklist-items/:id`          | yes                                                      |
| Document upload | `POST /api/checklist-items/:id/documents` | **yes**, and this is the one an implementation will miss |

The upload path is called out because it is the likeliest omission and the most damaging: an organizer uploading their filed application while looking at the current filing date has plainly seen it, and a later regeneration would otherwise warn them about a date they already worked against. An implementation that records only on `PATCH` satisfies the words and not the criterion.

Deletion of a document is deliberately **not** in the set: it withdraws work rather than acknowledging a date. Any action added to F-202 later must be classified explicitly against this list rather than inheriting a default.

The reason is not stylistic. `permit_plans.generated_at` defaults to `current_timestamp`, which in PostgreSQL is the **generating transaction's start time**, while the plan becomes visible only at COMMIT. Timestamp ordering therefore cannot distinguish a plan that was visible to the organizer from one still uncommitted: a checklist update landing inside a generation transaction carries a later timestamp than a plan nobody could see. A derivation reads that invisible plan as what the organizer worked against and **suppresses the notice for work done against a date the organizer could not have seen**.

This was **measured on #117, not reasoned about**: a test holds a generation open with its plan and items inserted and uncommitted, updates the row inside that window, then commits. The derivation stays silent; the persisted value does not.

**AC-N+4 (excluded statuses, and the proxy they rest on).** The notice does not appear at `not_started`, `in_progress` or `rejected`.

The reasoning is that the notice speaks about an application already with an agency. But **the checklist status is a proxy for that fact, not the fact itself**, and F-202 AC 2 allows every transition in both directions, so the proxy is wrong in a case that matters: an organizer who filed and then moved the row back to `in_progress` while addressing agency corrections **has** an application with the agency, and this criterion suppresses the notice for exactly the person most affected by the date moving.

It compounds with AC-N+3. Returning the row to `submitted` is itself work, so the worked-against date is replaced with the current one at that moment, and the notice they should have seen never fires at all.

Recorded rather than papered over, and the trigger set is deliberately **not** widened to hide it: adding `in_progress` would show the notice to every organizer who has filed nothing, which is the false direction for copy that tells someone to contact an agency. Closing it properly means tracking **whether the requirement was ever filed and is still live** as its own fact, separate from the current status label, which is a further contract change beyond the column #117 adds. Until that exists, the exclusion stands and this paragraph is the record of what it misses.

---

**AC-N+6 (unsurveyed is its own state, and says so).** A requirement nobody has researched must not wear the copy that reports an unsuccessful search.

"No published procedure was found" is defined in AC-N as the outcome of a search that ran and located nothing. Four reachable findings have had no search at all (§4.2), and giving them that wording would state a result this project never obtained, which is the same overclaim as asserting agency silence, one step further back. The distinction is cheap to keep and impossible to recover once collapsed.

So a third branch, with its own copy and its own metadata: **not yet checked**. Wording of the shape _"PopEngine has not yet checked what this agency publishes about a changed filing date. Confirm with the agency."_ Both branches send the organizer to the same place, which is why the temptation is to merge them; they differ in what the product claims about itself, which is why they must not be. A row in this state is also a work item, and it should be visible as one to whoever picks up §5 step 2, which a shared "found nothing" string would hide.

## 3. Edge cases the criteria must cover

- **No published procedure located.** The common case, not the exception: for six of the eight rows surveyed below, this project located nothing. The notice must say that in those terms rather than inventing a procedure, staying silent, or asserting that the agency has none.
- **A procedure established for one state only, where the data cannot tell the states apart.** A source can establish what to do at one status and be silent at another. The procedure is displayed only in the state its source covers, and a procedure existing nearby is not evidence it applies.

  FDNY is the worked example and it fails the test twice. Round 1 narrowed it to a pending or scheduled inspection, but **the checklist cannot express that state**: `CHECKLIST_STATUSES` is `not_started, in_progress, submitted, approved, rejected`, with no inspection state at all, so a `submitted` row may have no inspection requested, one scheduled, or one already completed and nothing distinguishes them. A restriction the data cannot evaluate is not a narrowing, it is an unimplementable criterion. And separately, `FDNY-GENERATOR-001` carries a `research_required` deadline, so it never has a `latest_apply_date` and the notice cannot fire on it at all.

  So FDNY **falls to the located-nothing wording**, and the research is retained in §4.3 as scoped research rather than as a publishable procedure. Making it reachable would need both an inspection-state input on the checklist and a calculable FDNY lead time; neither is proposed here, and until both exist no criterion may depend on distinguishing those states.

- **No recorded worked-against date.** A row nobody has worked, or one worked before the mechanism existed. The notice **stays silent**, and the date is **never inferred from plan timestamps** to fill the gap. Silence is the honest answer; an inferred date reintroduces exactly the defect AC-N+3 exists to prevent.
- **A displayed null date.** A requirement can be raised with no `latest_apply_date` at all, for instance when its deadline is RESEARCH_REQUIRED. There is no date to have moved, so there is no notice. "A requirement with a null date" and "no requirement" are different states and must not collapse into each other.

---

## 4. Research: what the notice could say, keyed by finding

This is the expensive half of this document. Two independent passes, and a round-2 review that found the survey keyed to the wrong thing in both directions. Read §4.1 before §4.3: the survey's shape was wrong before its content was.

### 4.1 The survey was keyed by permit type; the product is keyed by finding

An earlier draft of this table had a row per permit type, because the external survey was organised that way. The checklist is not. F-202 AC 1 creates one row per **permit or insurance plan item**, and a plan item is one **finding**, which is one rule id. Two consequences, both of which would have shipped wrong data:

- **One finding was split across two rows with different verdicts.** `FDNY-GENERATOR-001` is a single rule, published as `FDNY Generator/Battery Permit`, triggered by `any(generator_gasoline_gallons > 2.5, generator_diesel_gallons > 10, battery_system_kwh > 20)`. The draft gave "FDNY generator / fuel" a REAPPLY procedure and "FDNY battery" a NOT PUBLISHED verdict. Published row by row, a **battery-only** event would have rendered a procedure whose source covers postponing an inspection of fuelled equipment. Where one finding spans trigger paths with different evidence, the procedure may only be shown when the **triggering facts are the ones its source covers**, and every other path falls back. Expressing that needs procedure metadata conditioned on the trigger path, which is a further reason the schema work in §5 cannot be skipped.
- **Rows were surveyed that the notice can never reach, and rows it can reach were missed.** AC-N fires only when a `latest_apply_date` moves, so a finding that never carries one is out of scope no matter what its agency publishes. Checked against `rules/nyc-rules.v2.6.json`, not assumed.

**A rule id is still one level off, which round 2 did not catch.** `packages/engine/src/findings.ts` merges findings that share a `dedupe_key`, keeping the first finding's fields and concatenating the rule ids, and `checklist.ts` defines a row's identity as the **whole sorted rule-id set** (`requirementKey`). So a checklist row is not a rule, it is a set of them, and the survey must be keyed to the set.

`nyc.v2.6` publishes one such key, `dob-structure`, shared by `DOB-TENT-001` (`business_days_minimum`, dated) and `DOB-TALL-STRUCTURE-001` (no deadline). PR #116 is what gave `DOB-TENT-001` that key. When both trigger, the merged row keeps the tent rule's filing date, so **it reaches the notice**, and carries both rule ids, so it is a requirement the survey has no entry for. An implementation matching by rule id would find the tent-only research and attach it to a line that also asserts the tall-structure requirement, whose scope was never surveyed.

This is the same defect as the FDNY generator/battery split one level up: round 2 moved the survey from permit type to rule id, and rule id is still not what a row is.

### 4.2 Scope, checked against the published ruleset

**Trackable findings that can carry a filing date, and can therefore reach the notice: 13.**

| Finding                  | Deadline type                | Surveyed?                    |
| ------------------------ | ---------------------------- | ---------------------------- |
| `SAPO-STREET-SMALL-001`  | `published_minimum`          | yes, SAPO row                |
| `SAPO-STREET-MEDIUM-001` | `published_minimum`          | yes, SAPO row                |
| `SAPO-STREET-LARGE-001`  | `published_minimum`          | yes, SAPO row                |
| `SAPO-STREET-XL-001`     | `published_minimum`          | yes, SAPO row                |
| `SAPO-PLAZA-001`         | `published_minimum_by_level` | yes, SAPO row                |
| `SAPO-BLOCK-PARTY-001`   | `published_minimum`          | **no**                       |
| `NYPD-SOUND-001`         | `published_minimum`          | yes                          |
| `PARKS-TUA-001`          | `published_minimum`          | yes                          |
| `PARKS-EVENT-001`        | `composite`                  | yes                          |
| `DOB-TENT-001`           | `business_days_minimum`      | yes, DOB temporary structure |
| `DOB-ASSEMBLY-001`       | `published_minimum`          | **no**                       |
| `SLA-ONEDAY-001`         | `business_days_minimum`      | **no**                       |
| `SLA-CATERING-001`       | `business_days_minimum`      | **no**                       |

**Requirements formed by a merge.** One more reachable requirement exists that is not a single rule:

| Requirement (sorted rule-id set)                                        | Why it is reachable                                          | Surveyed?                             |
| ----------------------------------------------------------------------- | ------------------------------------------------------------ | ------------------------------------- |
| `DOB-TENT-001` + `DOB-TALL-STRUCTURE-001` (`dedupe_key: dob-structure`) | the merge keeps the tent rule's `business_days_minimum` date | **no**, only `DOB-TENT-001` alone was |

**Trackable findings that never carry a filing date on their own, so the notice cannot reach them unmerged: 10.** `DOHMH-VENDOR-PERMIT-001`, `FDNY-FUEL-001`, `FDNY-OPENFLAME-001`, `FDNY-GENERATOR-001` and `DOB-STAGE-001` are `research_required`; `SAPO-INSURANCE-001` is `before_issuance`; `SAPO-INSURANCE-BLOCK-PARTY-RIDE-001`, `PARKS-EVENT-EXACTLY-20-001`, `DOB-PROP-TRUSS-001` and `DOB-TALL-STRUCTURE-001` publish no deadline at all.

**"On their own" is doing real work in that sentence.** `DOB-TALL-STRUCTURE-001` carries no deadline and an earlier revision of this section therefore filed it as unreachable, full stop. That is true of the rule and false of the row: merged under `dob-structure` it rides a dated finding straight into the notice. Any future `dedupe_key` has the same effect, so reachability is a property of the requirement, not of the rule, and this list must be re-derived whenever a dedupe key is added or changed.

**Not a checklist row at all:** `DOHMH-ORGANIZER-NOTIFY-001` is kind `notification`, so it never becomes a trackable item under F-202 AC 1. The earlier draft surveyed it anyway.

**So the survey was misaligned in both directions.** Four of its eight rows described findings the notice can never reach (DOHMH TFSE, FDNY generator/battery, FDNY fuel, FDNY open flame), one described a finding that is not a checklist row (DOHMH Article 88), and **four dated findings were never surveyed**: `SAPO-BLOCK-PARTY-001`, `DOB-ASSEMBLY-001`, `SLA-ONEDAY-001`, `SLA-CATERING-001`. The reviewer named the last three; `SAPO-BLOCK-PARTY-001` is this pass's own finding, and it is the instructive one, because 50 RCNY 1-07 is a SAPO rule and the temptation is to assume it reaches a SAPO permit the survey did not name. It may well. That is a reading, not a citation, and it is exactly the inheritance §4.4 forbids.

**The unsurveyed four fall to the NOT-YET-CHECKED wording of AC-N+6, not to the located-nothing wording.** An earlier revision of this section sent them to "no published procedure was found", which reports a search that was never run; that is corrected here. An unsurveyed finding also does not inherit a neighbour's procedure, not from the same agency and not from the same rule family. They are not researched here: this document records the gap so it is scoped, and scoping it is not the same as closing it.

### 4.3 What was established

**Caveat, to be carried verbatim wherever this table is reused:**

> NOT PUBLISHED does not mean no agency action is required, only that public sources do not establish which action is required.

`NOT PUBLISHED` is a verdict on **this project's search**, not on the agency. It is kept as the label because the caveat above is written against that word, but it does not license the copy: AC-N requires the notice to say that no published procedure was **located**, and forbids it from saying an agency publishes nothing. A later implementer reading this table straight into notice text is the specific path this is guarding.

| Findings                                                  | Procedure on a date change                                       | Source and scope                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| --------------------------------------------------------- | ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SAPO-STREET-SMALL/MEDIUM/LARGE/XL-001`, `SAPO-PLAZA-001` | **AMEND**, filed application and granted permit                  | Title 50 RCNY 1-07: an applicant proposing to amend the date of a filed application **or a granted permit** must notify SAPO in writing; the Director approves or denies after agency and community board review. Scope covers both states explicitly. Not extended to `SAPO-BLOCK-PARTY-001`, which the survey did not cover.                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `NYPD-SOUND-001`                                          | **NOT PUBLISHED**                                                | §10-108 publishes the date field, the five-day deadline and the revocation authority. No change procedure located.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `PARKS-EVENT-001`, `PARKS-TUA-001`                        | **NOT PUBLISHED**                                                | 56 RCNY 2-08(d) lets **Parks** offer an alternative date after a denial. That is an agency power, not an applicant procedure.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `DOB-TENT-001` **alone**                                  | **NOT PUBLISHED**                                                | Post Approval Amendments exist for approved-scope changes, but nothing located says a date-only change is a PAA rather than a new filing. Surveyed for the tent requirement only: the merged `DOB-TENT-001` + `DOB-TALL-STRUCTURE-001` requirement is a different line and is **not yet checked** (AC-N+6).                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `FDNY-GENERATOR-001`                                      | **Researched, currently unreachable. Falls to located-nothing.** | FDNY District Office Street-Fair/Special Event Guide, pp. 2-3: if the **inspection** must be postponed, the applicant requests cancellation and creates a new inspection request. p. 21 ties the inspection date to the event's first day; p. 23 lists gasoline and diesel generators. Three limits, any one of which is disqualifying on its own: the guide does not address re-dating an already-issued permit; the guide covers fuelled equipment while the same finding is also triggered by `battery_system_kwh` alone; and the rule's deadline is `research_required`, so the finding carries no `latest_apply_date` and the notice cannot fire on it at all. Retained as research in case the deadline becomes calculable, **not** as a procedure to publish. |
| `DOHMH-VENDOR-PERMIT-001`                                 | **NOT PUBLISHED**, and unreachable                               | The permit is annual, and the located amendment form covers contacts and addresses, not an event date. Deadline is `research_required`, so the notice cannot reach it either way.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `FDNY-FUEL-001`, `FDNY-OPENFLAME-001`                     | **NOT PUBLISHED**, and unreachable                               | No procedure located for a date change. Both are `research_required`, so the notice cannot reach them.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |

### 4.4 No inheritance

A procedure applies to the requirements its source covers and to no others. Not to another finding of the same agency, not to another rule in the same family, not to another trigger path of the same rule, not to a state the source does not address, and **not to a merged requirement that adds a rule the source never mentioned**. Every one of the four defects above is a different way of violating that one rule, which is why it is stated once here rather than repeated per row.

### Method note: where to look next time

The two passes agreed everywhere **except FDNY generators**.

The first pass searched at **rule level** (the Fire Code and the RCNY) and concluded nothing was published. The second pass found the procedure in an **operational guide** for district offices, which is where FDNY documents how an applicant actually reschedules an inspection.

That is worth recording as method, not trivia: for this class of question, an agency's published rules may be silent while its operational or applicant-facing guidance is explicit. A pass that stops at rule level will report NOT PUBLISHED with false confidence. Search both levels before concluding a procedure does not exist, and record which level produced the answer.

---

## 5. What implementing this would take

> **[SUPERSEDED] as a plan; retained as analysis.** Step 0 is done (#121, closed). Step 1 did not happen as written — §2's criteria were not adopted; AC 9 was written instead and is narrower. Steps 2 and 3 describe work AC 9 does not require, because AC 9 publishes no procedure text. Step 4 is void: #117 is superseded, not awaiting rebase. What survives is the analysis inside the steps, particularly step 2's finding about `verification.status` and step 4's two open defects, which would matter to any future work of this shape.

Scope as it was understood before the outcome in §0. Five pieces, in order. The sequence matters: an earlier draft had three, and it let a ruleset bump stand in for engine and persistence work it does not cover.

0. **File the SPEC-CONFLICT.** Per §1, no conflict record exists for this gap and this document is not one. It names the missing artifact (`specs/F-202-compliance-checklist.md` has no criterion for a moved filing date), the code that inferred it (#117), and the user-visible consequence. Nothing below is properly tracked until it exists.
1. **Approve the criteria onto F-202.** Sections 2 and 3 above, adopted into `specs/F-202-compliance-checklist.md` with its numbering, reviewed by the product owner and the affected lane owners as that spec's status header requires. Nothing below is safe to start first: the schema and the rule data both encode decisions these criteria make.
2. **Publish the procedures as rule data, and the gaps honestly.** The counts come from §4's table and are not restated here, because a number repeated away from its table is how the earlier draft of this step came to say five where the table said six: **every row of §4 that records a procedure** carries it with its citation, and **every row that records none** carries the unresolved state. Work the table row by row; if a row is added or split there, this step covers it without editing.

   Two things this step must not do, both of which the existing contract makes easy to get wrong:

   - **It cannot express procedure research state through `verification.status`.** That field is one canonical value for the whole rule, published as a single `verification` block and persisted to one NOT NULL `permit_plan_items.verification_status` column. Marking a SAPO or DOHMH permit `RESEARCH_REQUIRED` because its **date-change procedure** was not located would relabel the entire finding, flipping a source-confirmed permit's badge everywhere F-201 AC 2 renders it. What this needs is **field-level verification metadata**: the procedure carries its own status and evidence, and the rule's own status is preserved end to end. That is a **rules-schema change**, not a value change, and it should be designed as one rather than smuggled through the existing field.
   - **It is published on the product owner's approval.** Per `docs/DOCUMENTATION-GOVERNANCE.md` §6, this step crosses three change classes, and since 2026-08-04 every one of them requires the product owner and no separate verification, rules-reviewer, engine, lane or architecture capacity: regulatory source, status and content; publishing procedure semantics the engine must interpret; and the field-level metadata above, which is a rules-schema change. That approval is the whole requirement, the second-party review requirement having been retired on 2026-08-05.

   With those settled it is a **ruleset version bump**, with the answer key and fixtures following it, and it is what lets the notice state a procedure without the procedure living in application code.

3. **Make the procedure reachable from a plan, which is engine and persistence work, not a version bump.** AC-N+1 requires the procedure, its citation and its verification metadata to come from the row's **own source plan**. Nothing today can supply that: `apps/api/src/plan.ts` persists no procedure text, citation or procedure verification metadata on `permit_plan_items`, and the repository keeps only the current rules file (`rules/nyc-rules.v2.6.json`), so a plan pinned to an older version has nothing to recover them from. Publishing the data in the ruleset therefore does **not** make it available to a row generated before the bump.

   That means: the engine carries the procedure fields onto the finding, the plan writer persists them with the plan, and the schema gains somewhere to put them, alongside the trigger-path conditioning §4.1 requires. Every row generated before that work lands falls back to the located-nothing wording permanently, which is correct rather than unfortunate: those plans genuinely never carried the data. Skipping this step does not produce a smaller implementation, it produces one that reads live procedure text against a pinned row, which is the thing AC-N+1 exists to forbid.

4. **Rebase #117 and review it against the approved criteria**, including its two findings still open at review round 3:
   - **`checklist.ts:959`, stale-tab plan selection.** The update records the plan visible to the server at the moment it runs, not the plan actually rendered to the client. A checklist page left open in another tab while a regeneration commits elsewhere records the new date and suppresses the notice for work done against the old one. Closing this means carrying the plan or date the client was actually served, rather than re-reading server state.
   - **`checklist.ts:968`, the null-date COALESCE.** When the current plan still raises the requirement but its `latest_apply_date` is null, the fallback substitutes the previous plan item's date. If a later plan restores a date, the notice fires although the organizer last worked the row with no date displayed. Closing this means distinguishing "a matching row whose date is null" from "no matching row", which is the same distinction §3 draws.

   **Migration 008 is a separate approval, and approving F-202's criteria does not grant it.** `docs/DOCUMENTATION-GOVERNANCE.md` line 96: a database migration touching a shared or core table needs the **database owner plus all affected lane owners**. `checklist_items` is core and F-202, F-203 and the checklist API all read it, so #117 cannot merge on the product owner's criteria approval alone. The same gate applies to whatever schema step 3 needs for the procedure fields.

---

## 6. What this document is not

It is not a specification, and it confers no permission. It is in `docs/proposals/` because `docs/BASELINE.md` classes everything there as ARCHIVED or PROPOSED draft material with the instruction _never build from these_, and that is the correct status for it today.

Nothing here has been approved: not the criteria, not the column, not the copy the notice would carry, and not the rule data in §4. The research in §4 is a record of what public sources establish as of the drafting date; it is not a verification pass, and promoting any of it to `SOURCE_CONFIRMED` is the verification owner's decision under `docs/OPEN-QUESTIONS.md` §2.
