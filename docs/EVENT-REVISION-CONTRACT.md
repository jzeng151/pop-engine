# PopEngine — Event and Event Revision Contract

**Status:** PROPOSED (2026-07-26) — the product owner approved this decision package; it is not implementable until the remaining three lane owners approve the ratification PR and this file plus `docs/BASELINE.md` are promoted to `APPROVED`.

**Decision owner:** `@jzeng151`

**Required reviewers:** `@brovaset`, `@bofrompursuit`, `@naquanm621`

## 1. Purpose and Scope

This contract does two things:

1. ratifies the cumulative Phase 1 `events` shape produced by migrations `001`, `005`, and `006` at migration head `007`; and
2. fixes the logical Event Revision contract that Phase 2 features must express in reviewed OpenAPI, JSON Schema, and forward migrations.

It resolves `OPEN-QUESTIONS` B-3 only after all four owners have approved the ratification PR. It does not activate Phase 2, approve F-107, create an endpoint or table, amend a merged migration, or change a regulatory rule, fixture, verdict, deadline, or finding.

## 2. Decisions

### 2.1 Ratify the Phase 1 schema as the historical contract

- The merged `events` schema is the cumulative result of:
  - `apps/api/migrations/001_initial_schema.ts`;
  - `apps/api/migrations/005_event_public_page_fields.ts`; and
  - `apps/api/migrations/006_events_battery_present.ts`.
- Migration `007` is the current migration head at ratification time and does not alter `events`.
- These merged migrations are immutable. Corrections or future fields use new ordered migrations.
- Through Phase 1.5, the `events` row remains the authoritative intake record and `revision_counter` remains the plan-staleness mechanism.
- Ratification does not approve another column. Every later shared/core-table change still requires the approvals in `docs/DOCUMENTATION-GOVERNANCE.md` §6.

### 2.2 Separate stable Event identity from questionnaire revisions

At the F-107 cutover:

- `events` is the stable aggregate container.
- `event_revisions.answers_json` is the sole authority for questionnaire answers.
- Existing intake columns on `events` may remain temporarily as derived compatibility projections, but no client or service may write them independently.
- A later forward migration may remove those projections only after every reader uses Event Revisions.

The stable Event container gains fields only with their consuming feature:

| Field                 | Owner and invariant                                                                            |
| --------------------- | ---------------------------------------------------------------------------------------------- |
| `workspace_id`        | F-702. Backfilled before authenticated user-owned data is enabled, then required.              |
| `current_revision_id` | F-107. Points to the latest saved revision for the same event.                                 |
| `current_plan_id`     | Plan-acceptance work. Points to the explicitly accepted plan, not merely the newest candidate. |

The database must reject a current revision or current plan that belongs to another event.

Other target fields in `docs/ARCHITECTURE-FUTURE.md` remain deferred until a scheduled feature consumes them.

### 2.3 Event Revisions are append-only

The logical `event_revisions` record contains:

- `id`, `event_id`, and a strictly increasing `revision_number`;
- `input_schema_version` and `jurisdiction_code`;
- the complete saved answer set in `answers_json`, which may still be partial for an incomplete draft;
- `revision_state`: `incomplete`, `complete_unsubmitted`, or `submitted`;
- validation/conflict results recorded at save time;
- `created_by`, `created_at`, and `supersedes_revision_id`.

Required invariants:

- `(event_id, revision_number)` is unique; revision numbers need not be contiguous.
- `supersedes_revision_id`, when present, belongs to the same event.
- A stored revision is never updated or deleted. A correction appends another revision.
- An omitted answer key means unanswered in that schema version.
- An explicit `unknown` value means the user answered unknown.
- SQL `NULL` never means unknown.
- Derived authority or classification output is not accepted from the browser as regulatory truth.

### 2.4 Reject stale writes; do not merge them silently

- A save names the `base_revision_id` it was edited from. `null` is valid only when the event has no revision.
- In one transaction, the server locks the Event, compares `base_revision_id` with `current_revision_id`, validates the proposed answers, appends the revision, and advances the pointer.
- A changed save appends exactly one revision.
- A no-op save returns the current revision and appends nothing.
- A stale base returns HTTP `409` with stable code `revision_conflict` and the current revision identifier.
- The server never performs an automatic field merge. The user reloads and explicitly reconciles.
- Submitting changes `revision_state` by appending a submitted revision. Plans evaluate submitted revisions only.

The exact HTTP request and error schemas belong in the reviewed OpenAPI contract.

### 2.5 Plans bind to exact revisions

- Every new plan references one `event_revision_id`.
- The database must reject a plan whose `event_id` and revision belong to different events.
- Plans, findings, traces, and their regulatory snapshots remain immutable.
- A plan is stale when its revision differs from `events.current_revision_id`.
- Generating a candidate does not move `current_plan_id`.
- Accepting a candidate moves `current_plan_id` transactionally; workflow reconciliation and message cancellation remain governed by their consuming specs.
- Existing numeric `permit_plans.event_revision` and `intake_snapshot` remain historical migration inputs, not the authority for new writes after cutover.

### 2.6 Backfill without guessing or deleting history

The F-107 forward migration must:

1. group existing plans by `(event_id, event_revision)`;
2. canonicalize the snapshots and abort if one event/revision pair has more than one distinct answer set;
3. create one revision for each valid event/revision pair;
4. create the current event revision from the Phase 1 intake columns when that revision is not already represented by a plan;
5. compare the current row with an existing revision at the same number and abort on a mismatch;
6. set `events.current_revision_id` and each plan's `event_revision_id`; and
7. preserve all existing plans and synthetic history.

Legacy rows may have no user actor; `created_by = NULL` is reserved for deterministic legacy backfill. New revisions require the authenticated actor after the F-701–F-703 gate.

During compatibility rollout, a successful revision transaction may update old `events` projections for Phase 1 readers. Event Revision remains the only write authority.

### 2.7 Use the existing finding identity for deterministic diffs

- Finding identity is the current checklist key: `rule_ids` sorted and joined with `,`.
- A finding is:
  - `added` when its key appears only in the candidate;
  - `removed` when its key appears only in the accepted base; or
  - `changed` when the same key has a different canonical regulatory rendering.
- Canonical comparison includes kind, disposition, rule provenance, trigger trace, sources, verification state/date, name, agency, deadline and computed dates, fee, required documents, portal, and regulatory payload.
- Database IDs, plan IDs, timestamps, row order, and workflow status do not make a regulatory finding changed.
- Diff output is deterministic and derived from immutable plans. No `plan_diffs` table is authorized until a consuming approved feature requires stored diffs.

## 3. Implementation Ownership

| Work                                                                                     | Owning feature or gate                                          |
| ---------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| `workspace_id` and legacy workspace backfill                                             | F-702                                                           |
| `event_revisions`, `current_revision_id`, append/conflict behavior, and plan revision FK | F-107                                                           |
| `current_plan_id` and explicit plan acceptance                                           | Approved plan-acceptance contract                               |
| Finding diff API or stored diff                                                          | First approved consumer, such as F-103 or F-503                 |
| OpenAPI/JSON Schema and generated-type handoff                                           | Architecture decision gate; separate from this logical approval |

No feature may bundle another row's work merely because this contract names the shared boundary.

## 4. Required Verification

Before activation, the consuming implementation must prove:

- migration and deterministic backfill on empty, current, and historical-plan databases;
- mismatch abort with no partial mutation;
- revision immutability;
- two concurrent saves produce one success and one `revision_conflict`;
- no-op save creates no revision;
- missing and explicit `unknown` remain distinct;
- plans reference exact revisions and staleness is server-derived;
- diff identity and output are byte-stable; and
- cross-workspace reads and writes fail after tenancy activation.

The full existing fixture and boundary suite must remain green. This contract changes no expected regulatory output.

## 5. Approval and Activation

Product-owner approval of the package is recorded on 2026-07-26. B-3 remains open until:

1. `@brovaset`, `@bofrompursuit`, and `@naquanm621` each submit an explicit approving review;
2. this file and its `docs/BASELINE.md` row are promoted to `APPROVED`;
3. `docs/OPEN-QUESTIONS.md` records B-3 as resolved; and
4. issue #2 is closed with a link to the ratification merge.

Approval fixes the shared logical contract. Implementation remains blocked on the consuming F-id, OpenAPI/JSON Schema, forward migration, and the F-701–F-703 production gate.
