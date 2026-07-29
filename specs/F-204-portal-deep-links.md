# F-204 · Portal Deep Links + Prepared Packages

**Status:** APPROVED (2026-07-25; amended 2026-07-27, product-owner approved, resolving SPEC-CONFLICT #149 — acceptance criteria reduced to portals the published ruleset carries; required documents, DOHMH/SLA portals, and per-facet verification are out of scope until a future ruleset publish) · **Reviewer/approver:** product owner + affected lane owners via the approval PR · **Owner:** see Lane below · see `docs/BASELINE.md`.
**Phase:** 1 (core, week 2) · **Lane:** Dev 3 · **Depends on:** F-201 (portal data on findings), F-202 (renders on checklist) · **Open verification facts (do not block implementation):** remaining portal-path confirmations (OPEN-QUESTIONS §2, Dev 4 owns)

## User Story

As an independent organizer ready to apply, each checklist item that has a published application path takes me straight to that portal (or states the in-person filing instructions), so I never hunt through nyc.gov for the routes this ruleset version models.

## Inputs

Per plan item from the rules data, when the rule publishes them: `portal.name`, `portal.url`, `portal.instructions`.

## Outputs

On each plan/checklist item that carries portal fields: a portal block with link (or filing instructions). No portal block when the rule publishes none.

## Acceptance Criteria

1. Every permit/notification finding that publishes an application path in the rules data renders it:
   - SAPO classes → E-Apply (`nyceventpermits.nyc.gov/cems/Login`)
   - Parks → `nyceventpermits.nyc.gov/parks`
   - NYPD sound → no URL by design: in-person filing instructions ("file at the precinct local to the event; certified check or money order; form PD 656-041A")
   - FDNY (fuel / open flame / generator) → FDNY Business (`fires.fdnycloud.org/CitizenAccess/Default.aspx`)
2. The UI never implies PopEngine submits anything (non-goal): copy is "apply at [portal]", and links open in a new tab.
3. Demo path: Scenario A's rescoped plan and Scenario C's plan each show correct, distinct portal blocks (E-Apply vs. Parks vs. precinct instructions) for the portals the ruleset publishes.

## Edge Cases

- Advisory/note items (R11, R13, A1–A3): no portal block at all.
- Alcohol paths: the venue-license branch renders no portal (nothing to file). SLA one-day/catering rules publish no `output.portal` on this ruleset version — render no portal block; never treat a citation `source.urls` entry (including `sla.ny.gov/permits-available-online`) as an application path.
- Findings without published portal fields (including DOHMH organizer notification / vendor permit on this ruleset version): no portal block; do not invent a name, URL, or instructions.
- Whole-rule verification status continues to render as today (F-206). Per-facet portal/fee caveats are not in scope until the ruleset publishes per-facet verification.

## Answer-Key Scenarios Exercised

- A (E-Apply for SAPO).
- C (Parks portal + precinct instructions, sequenced).
- E (published portals among multi-agency findings: SAPO, FDNY Business, precinct — not invented DOHMH/SLA portals).

## Published on nyc.v2.9

Eleven rules carry `output.portal` (name / url / optional instructions): six SAPO E-Apply classes, `PARKS-EVENT-001`, three FDNY Business rules, and `NYPD-SOUND-001` (`url: null` + in-person instructions). That subset is the acceptance surface above.

## Out of scope until a future ruleset publish

Not acceptance criteria for this ruleset version (SPEC-CONFLICT #149 resolved by dropping them from the done definition rather than inventing data):

- DOHMH / SLA `output.portal` (name ± url/instructions). DOHMH vendor lead-time research remains OPEN-QUESTIONS R-11; that is not a portal fact.
- `required_documents` lists and document-level caveats.
- Per-facet verification (e.g. verified URL with an unverified fee caveated independently).
- Unresolved-portal fallback copy ("confirm application path with agency" for a portal whose portal facet is unresolved) — the ruleset has no portal verification facet to read.
