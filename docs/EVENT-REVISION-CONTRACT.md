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
- Organizer-created revisions have non-null `created_by` and `created_at`. Deterministic legacy
  backfill sets both to `NULL`; a null `created_at` means the source recorded no revision-creation
  time and is never replaced with a plan, Event, or migration timestamp.
- Derived authority or classification output is not accepted from the browser as regulatory truth.

### 2.4 Reject stale writes; do not merge them silently

- A save names the `base_revision_id` it was edited from. `null` is valid only when the event has no revision.
- In one transaction, the server locks the Event, compares `base_revision_id` with `current_revision_id`, validates the proposed answers, appends the revision, and advances the pointer.
- A changed save appends exactly one revision. Its `supersedes_revision_id` equals the validated
  `base_revision_id`; only the first revision has `supersedes_revision_id = NULL`.
- A save is a no-op only when its `input_schema_version`, `jurisdiction_code`, and
  schema-canonical `answers_json` match the current revision. It returns that revision and appends
  nothing; changing any member of that tuple appends a revision.
- A stale base returns HTTP `409` with stable code `revision_conflict` and the current revision identifier.
- The server never performs an automatic field merge. The user reloads and explicitly reconciles.
- Plans evaluate `complete` revisions only. F-107 may save `incomplete` revisions but does not add a separate submission transition.

The exact HTTP request and error schemas belong in the reviewed OpenAPI contract.

### 2.5 Plans bind to exact revisions

- Every new plan references one `event_revision_id`.
- The database must reject a plan whose `event_id` and revision belong to different events.
- Before evaluation and persistence, the selected published ruleset's jurisdiction must exactly
  equal the referenced revision's `jurisdiction_code`. Generation and persistence reject a
  mismatch.
- Plans, findings, traces, and their regulatory snapshots remain immutable.
- A plan is stale when its revision differs from `events.current_revision_id`.
- Generating a candidate does not move `current_plan_id`.
- Every candidate records the exact `today` engine input used to evaluate it.
- An acceptance request names the accepted `base_plan_id` against which the candidate was presented;
  `null` is valid only when the Event has no accepted plan.
- Accepting a candidate locks the Event and rechecks that the candidate belongs to it, that
  `candidate.event_revision_id === events.current_revision_id`, and that
  `base_plan_id === events.current_plan_id`. While holding that lock, acceptance also derives the
  current calendar date in the candidate's jurisdiction timezone and requires it to equal the
  candidate's recorded `today`; otherwise it rejects the candidate and requires regeneration. Only
  then may the same transaction move `current_plan_id`, apply the approved deterministic workflow
  reconciliation, and persist obsolete message-job cancellations plus any required replacement
  job/outbox rows. A mismatch or failure rolls back all of those changes. External delivery occurs
  only after commit. A later edit may make an accepted plan stale, but an already-stale candidate, a
  candidate evaluated on an obsolete local date, or a candidate based on a superseded accepted plan
  is never accepted.
- The migration that introduces `current_plan_id` sets it from the same-event
  `checklist_acknowledgements.plan_id` when an acknowledgement exists and to `NULL` otherwise. It
  never treats the latest generated plan as accepted.
- For a backfilled plan, its canonical `intake_snapshot` must equal the engine-input projection of
  the revision it references under the plan's mapped schema. Questionnaire answers the engine did
  not consume may remain in that revision without being copied into the historical plan snapshot.
- Existing numeric `permit_plans.event_revision` and `intake_snapshot` remain historical migration inputs, not the authority for new writes after cutover.

### 2.6 Backfill without guessing or deleting history

Before mutation, F-107's approved compatibility package must define:

- one unambiguous mapping from every historical `ruleset_version` to the Event Input schema that
  produced its plan snapshot;
- one exact `input_schema_version` and `jurisdiction_code` for the Phase 1 Event row at cutover,
  including an Event with no historical plan. This mapping is explicit and does not derive either
  value from a latest plan, display text, or migration time;
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
5. always build the current Event/current revision from the Phase 1 row under the compatibility
   package's exact cutover `input_schema_version` and `jurisdiction_code`, even when a plan has the
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

F-107 is not authorized to activate before the joint F-701–F-703 gate. `created_by = NULL` is
reserved for deterministic legacy backfill together with `created_at = NULL`; this contract defines
no demo or system actor. Every organizer-created revision requires the authenticated actor and
server-recorded creation time.

During compatibility rollout, every successful revision transaction must update old `events`
projections in the same transaction while any deployed Phase 1 reader still uses them. Projection
updates may stop only after every reader has atomically cut over to Event Revisions. Event Revision
remains the only write authority.

The backfill and writer-authority cutover must leave no window in which a Phase 1 writer can commit
an Event edit that is absent from the resulting current revision. A legacy write committed before
the snapshot is included in that revision; after cutover, every write uses the revision transaction.
F-107 must enforce that boundary by quiescing or locking legacy writers, or by deploying a
transactional dual-write path before the snapshot. If it cannot prove the boundary, migration
aborts.

### 2.7 Compare findings and plan outcomes deterministically

- Finding identity is the sorted `rule_ids` array. When a scalar map key is needed, use its canonical JSON serialization (for example, `JSON.stringify([...ruleIds].sort())`), never delimiter joining.
- A finding is:
  - `added` when its key appears only in the candidate;
  - `removed` when its key appears only in the accepted base; or
  - `changed` when the same key has a different canonical regulatory rendering.
- Canonical comparison includes kind, disposition, rule provenance, trigger trace, sources,
  overall verification state/date/qualification, the separate scope, deadline, fee, required
  documents, and portal verification statuses, name, agency, the complete published and computed
  deadline state (`deadline`, `deadline_display`, `latest_apply_date`, `apply_after_date`,
  `deadline_status`, `slack_days`, `deadline_unknown_fields`, and
  `timeline_unresolved_reason`), fee, required documents, portal name/URL/instructions, `notes`,
  `note_text`, and conflict text.
- The diff separately reports a changed plan outcome when result completeness or its complete reasons,
  `verdict`, or canonical user-visible `verdictDetail` differs, even if every finding rendering is
  unchanged. That detail consists of `blockingFinding`, `missedRuleIds`, `minSlackDays`,
  `missingFacts` (including each fact's `field`, `thresholds`, and complete `branches`),
  `unresolvedTimelines`, and `rescopeSuggestions` (including `change`, `reevaluatedVerdict`, and
  `droppedRuleIds`).
- The diff separately reports changed plan provenance when any persisted ruleset, rules-schema,
  Event Input schema, engine, or calendar version/checksum differs, or when `snapshot_date` differs.
  This applies even when every finding and plan outcome matches.
- Database IDs, plan IDs, created/generated/updated timestamps, row order, workflow status, and the
  debugging-only evaluation `trace` do not make a regulatory finding, plan outcome, or provenance
  changed.
- Diff output is deterministic and derived from immutable plans. No `plan_diffs` table is authorized until a consuming approved feature requires stored diffs.
- This future candidate-plan diff is not F-202 Acceptance Criterion 9's narrower current-checklist notice; that criterion deliberately excludes clock-only movement among countdown statuses.

## 3. Implementation Ownership

| Work                                                                                     | Owning feature or gate                                          |
| ---------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| `workspace_id` and legacy workspace backfill                                             | F-702                                                           |
| `event_revisions`, `current_revision_id`, append/conflict behavior, and plan revision FK | F-107                                                           |
| `current_plan_id`, acknowledgement backfill, acceptance, and workflow reconciliation     | Approved plan-acceptance contract                               |
| Finding diff API or stored diff                                                          | First approved consumer, such as F-103 or F-503                 |
| OpenAPI/JSON Schema and generated-type handoff                                           | Architecture decision gate; separate from this logical approval |

No feature may bundle another row's work merely because this contract names the shared boundary.

## 4. Required Verification

Before activation, the consuming implementation must prove:

- migration and deterministic backfill on empty, current, and historical-plan databases;
- lossless backfill across an input-schema change that did not increment the legacy revision;
- preservation of current Phase 1 questionnaire values absent from historical plan snapshots;
- mismatch abort with no partial mutation;
- every legacy backfilled revision has null actor/time sentinels, while every organizer-created
  revision records both;
- a legacy write racing the backfill is either included in the resulting current revision or
  committed through the revision transaction, never lost between authorities;
- revision immutability;
- two concurrent saves produce one success and one `revision_conflict`;
- a save with matching schema, jurisdiction, and answers creates no revision, while changing only
  the schema or jurisdiction creates one;
- every changed non-initial save links the appended revision to its validated base, while the first
  revision has no predecessor;
- legacy backfill is the only path to `created_by = NULL`; organizer saves reject a missing
  authenticated actor;
- missing and explicit `unknown` remain distinct;
- plans reference exact revisions and staleness is server-derived;
- plan generation and persistence reject a ruleset/revision jurisdiction mismatch;
- `current_plan_id` backfills from the same-event checklist acknowledgement, or remains null when
  none exists, regardless of newer generated plans;
- an Event with no historical plan backfills its current revision under the exact cutover Event
  Input schema and jurisdiction named by the compatibility package;
- accepting a candidate races safely with a revision save and rejects the stale candidate;
- accepting a candidate after its jurisdiction-local evaluation date has passed rejects it and
  requires regeneration;
- two candidates accepted concurrently from the same accepted base produce one success and one
  conflict;
- an acceptance reconciliation or job/outbox failure leaves the plan pointer, workflow, and jobs
  unchanged;
- while a Phase 1 reader remains, a revision save and subsequent plan generation cannot observe
  different questionnaire answers;
- a `note_text`-only finding change is reported as `changed`;
- a `verification.qualification`-only finding change is reported as `changed`;
- a change to only one of the scope, deadline, fee, required-documents, or portal verification
  statuses is reported as `changed`;
- a result-completeness or result-completeness-reason-only change is reported when every finding
  rendering matches;
- a verdict or user-visible `verdictDetail`-only change, including a `rescopeSuggestions`-only
  change, is reported when every finding rendering matches;
- a plan-provenance-only change is reported when every finding and plan outcome matches;
- diff identity and output are byte-stable; and
- cross-workspace reads and writes fail after tenancy activation.

The full existing fixture and boundary suite must remain green. This contract changes no expected regulatory output.

## 5. Approval and Activation

On 2026-07-27, `@jzeng151` explicitly invoked the one-time access-gated-demo overwrite recorded in `docs/DOCUMENTATION-GOVERNANCE.md` §6. It supersedes the all-lane and teammate-review requirements for PR #137 only. No approval is attributed to another account.

B-3 is resolved for the access-gated synthetic-data demo by this record. Issue #2 closes when PR #137 merges. Strict all-lane and architecture-owner ratification remains B-4 and must land before production activation.

Approval fixes the shared logical contract for demo implementation. Each implementation still needs its consuming approved F-id, OpenAPI/JSON Schema, and forward migration. Production additionally remains blocked on B-4 and the F-701–F-703 gate.
