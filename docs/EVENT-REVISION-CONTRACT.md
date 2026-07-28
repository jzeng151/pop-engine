# PopEngine — Event and Event Revision Contract

**Status:** APPROVED (2026-07-27; access-gated synthetic-data demo authority. Strict production ratification remains required before F-701–F-703 activation.)

**Decision owner:** `@jzeng151`

**Approval record:** after the other lane owners were unavailable, `@jzeng151` explicitly invoked a one-time product-owner overwrite for PR #137 and the access-gated synthetic-data demo. This is one person's decision, not approval by `@brovaset`, `@bofrompursuit`, or `@naquanm621`. It does not authorize production activation or relax approval requirements for later shared-contract changes.

## 1. Purpose and Scope

This contract does two things:

1. ratifies the cumulative Phase 1 `events` shape produced by migrations `001`, `005`, and `006`, independent of the later migration head; and
2. fixes the logical Event Revision contract that Phase 2 features must express in reviewed OpenAPI, JSON Schema, and forward migrations.

It resolves `OPEN-QUESTIONS` B-3 under the approval record above. It does not activate Phase 2, approve F-107, create an endpoint or table, amend a merged migration, or change a regulatory rule, fixture, verdict, deadline, or finding.

## 2. Decisions

### 2.1 Ratify the Phase 1 schema as the historical contract

- The merged `events` schema is the cumulative result of:
  - `apps/api/migrations/001_initial_schema.ts`;
  - `apps/api/migrations/005_event_public_page_fields.ts`; and
  - `apps/api/migrations/006_events_battery_present.ts`.
- Later migrations do not change which migrations define this ratified `events` shape.
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
- the full snapshot of answers supplied in `answers_json`; an `incomplete` revision may omit unanswered keys, while a `complete` revision passes the validation required for plan generation;
- `revision_state`: `incomplete` or `complete`;
- validation/conflict results recorded at save time;
- `created_by`, `created_at`, and `supersedes_revision_id`.

Required invariants:

- `(event_id, revision_number)` is unique; revision numbers need not be contiguous.
- `supersedes_revision_id`, when present, belongs to the same event.
- A stored revision is never updated or deleted. A correction appends another revision.
- An omitted answer key means unanswered in that schema version.
- An explicit `unknown` value means the user answered unknown.
- Completeness is validation state, not an organizer-visible submission workflow. Explicit `unknown` counts as answered where the schema permits it.
- SQL `NULL` never means unknown.
- Derived authority or classification output is not accepted from the browser as regulatory truth.

### 2.4 Reject stale writes; do not merge them silently

- A save names the `base_revision_id` it was edited from. `null` is valid only when the event has no revision.
- In one transaction, the server locks the Event, compares `base_revision_id` with `current_revision_id`, validates the proposed answers, appends the revision, and advances the pointer.
- A changed save appends exactly one revision.
- A no-op save returns the current revision and appends nothing.
- A stale base returns HTTP `409` with stable code `revision_conflict` and the current revision identifier.
- The server never performs an automatic field merge. The user reloads and explicitly reconciles.
- Plans evaluate `complete` revisions only. F-107 may save `incomplete` revisions but does not add a separate submission transition.

The exact HTTP request and error schemas belong in the reviewed OpenAPI contract.

### 2.5 Plans bind to exact revisions

- Every new plan references one `event_revision_id`.
- The database must reject a plan whose `event_id` and revision belong to different events.
- Plans, findings, traces, and their regulatory snapshots remain immutable.
- A plan is stale when its revision differs from `events.current_revision_id`.
- Generating a candidate does not move `current_plan_id`.
- Accepting a candidate locks the Event and rechecks that the candidate belongs to it and that
  `candidate.event_revision_id === events.current_revision_id`. Only then may the same transaction
  move `current_plan_id`. A mismatch is rejected as a conflict without moving the pointer or
  reconciling workflow/messages. A later edit may make an accepted plan stale, but an already-stale
  candidate is never accepted.
- For a backfilled plan, its canonical `intake_snapshot` must equal the engine-input projection of
  the revision it references under the plan's mapped schema. Questionnaire answers the engine did
  not consume may remain in that revision without being copied into the historical plan snapshot.
- Existing numeric `permit_plans.event_revision` and `intake_snapshot` remain historical migration inputs, not the authority for new writes after cutover.

### 2.6 Backfill without guessing or deleting history

Before mutation, F-107's approved compatibility package must define:

- one unambiguous mapping from every historical `ruleset_version` to the Event Input schema that
  produced its plan snapshot;
- validation and a lossless canonical comparison transform for every mapped schema. Omission,
  legacy unanswered/`NULL`, explicit `unknown`, `false`, and other concrete values remain distinct
  unless recorded source data makes a conversion lossless; and
- one exhaustive Phase 1 row mapping. It assigns every existing column either to the stable Event,
  the current revision's questionnaire answers, or a named non-questionnaire compatibility
  projection. A value cannot be dropped merely because `ruleset.intakeFields` did not consume it.

No match, multiple matches, an unhandled column, or a missing/ambiguous transform aborts before any
row is mutated. The compatibility package may use a legacy replay schema containing only the
engine-relevant fields a historical `intake_snapshot` actually stored.

The F-107 forward migration must then:

1. resolve and validate each plan snapshot under its mapped schema before comparing snapshots;
2. canonicalize snapshots only through that schema's lossless transform. More than one canonical
   answer set for the same `(event_id, event_revision, input_schema_version)` aborts, but different
   schema versions at the same legacy revision do not;
3. create one `complete` legacy revision for each distinct
   `(event_id, event_revision, input_schema_version, canonical answer set)` and bind every matching
   plan to it. Plans generated before and after a schema change therefore retain exact, separate
   inputs even when the old numeric `event_revision` did not change;
4. assign those backfilled revisions a deterministic, strictly increasing order defined and tested
   by F-107. It must not infer schema order from version-string sorting or migration execution time;
5. always build the current Event/current revision from the Phase 1 row, even when a plan has the
   same legacy revision number. Stable values such as the Event name and questionnaire values such
   as `location_name` and `capacity` must survive through the exhaustive row mapping;
6. set that current revision to `complete` when full validation passes, or to `incomplete` only when
   F-107's partial-save validator accepts it;
7. compare same-number plans with the current row only after projecting both through their resolved
   schemas. A plan may reference the current revision only when the compatibility package can
   losslessly replay that revision under the plan's mapped schema, its canonical engine inputs
   match, and the revision is `complete`; otherwise the plan remains bound to its separate legacy
   revision and is stale; and
8. set `events.current_revision_id`, preserve every existing plan and synthetic history, and abort
   the transaction rather than partially mutating on any failure.

Current-only Phase 1 values must not be copied backward into older plan-backed revisions.

Legacy rows may have no user actor; `created_by = NULL` is reserved for deterministic legacy backfill. New revisions require the authenticated actor after the F-701–F-703 gate.

During compatibility rollout, a successful revision transaction may update old `events` projections for Phase 1 readers. Event Revision remains the only write authority.

### 2.7 Use collision-free finding identity for deterministic diffs

- Finding identity is the sorted `rule_ids` array. When a scalar map key is needed, use its canonical JSON serialization (for example, `JSON.stringify([...ruleIds].sort())`), never delimiter joining.
- A finding is:
  - `added` when its key appears only in the candidate;
  - `removed` when its key appears only in the accepted base; or
  - `changed` when the same key has a different canonical regulatory rendering.
- Canonical comparison includes kind, disposition, rule provenance, trigger trace, sources, verification state/date, name, agency, the complete published and computed deadline state (`deadline`, `deadline_display`, `latest_apply_date`, `apply_after_date`, `deadline_status`, `slack_days`, `deadline_unknown_fields`, and `timeline_unresolved_reason`), fee, required documents, portal name/URL/instructions, `notes`, `note_text`, and conflict text.
- Database IDs, plan IDs, timestamps, row order, and workflow status do not make a regulatory finding changed.
- Diff output is deterministic and derived from immutable plans. No `plan_diffs` table is authorized until a consuming approved feature requires stored diffs.
- This future candidate-plan diff is not F-202 Acceptance Criterion 9's narrower current-checklist notice; that criterion deliberately excludes clock-only movement among countdown statuses.

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
- lossless backfill across an input-schema change that did not increment the legacy revision;
- preservation of current Phase 1 questionnaire values absent from historical plan snapshots;
- mismatch abort with no partial mutation;
- revision immutability;
- two concurrent saves produce one success and one `revision_conflict`;
- no-op save creates no revision;
- missing and explicit `unknown` remain distinct;
- plans reference exact revisions and staleness is server-derived;
- accepting a candidate races safely with a revision save and rejects the stale candidate;
- a `note_text`-only finding change is reported as `changed`;
- diff identity and output are byte-stable; and
- cross-workspace reads and writes fail after tenancy activation.

The full existing fixture and boundary suite must remain green. This contract changes no expected regulatory output.

## 5. Approval and Activation

On 2026-07-27, `@jzeng151` explicitly invoked the one-time access-gated-demo overwrite recorded in `docs/DOCUMENTATION-GOVERNANCE.md` §6. It supersedes the all-lane and teammate-review requirements for PR #137 only. No approval is attributed to another account.

B-3 is resolved for the access-gated synthetic-data demo by this record. Issue #2 closes when PR #137 merges. Strict all-lane and architecture-owner ratification remains B-4 and must land before production activation.

Approval fixes the shared logical contract for demo implementation. Each implementation still needs its consuming approved F-id, OpenAPI/JSON Schema, and forward migration. Production additionally remains blocked on B-4 and the F-701–F-703 gate.
