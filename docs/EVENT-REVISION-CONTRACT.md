# PopEngine — Event and Event Revision Contract

**Status:** APPROVED (2026-07-27; access-gated synthetic-data demo authority. Strict production ratification remains required before F-701–F-703 activation.)

**Decision owner:** `@jzeng151`

**Approval record:** after the other lane owners were unavailable, `@jzeng151` explicitly invoked a one-time product-owner overwrite for PR #137 and the access-gated synthetic-data demo. This is one person's decision, not approval by `@brovaset`, `@bofrompursuit`, or `@naquanm621`. It does not authorize production activation or relax approval requirements for later shared-contract changes.

## 1. Purpose and Scope

This contract does two things:

1. ratifies the cumulative Phase 1 `events` shape produced by migrations `001`, `005`, `006`, and the separately approved F-110 amendment in `012`, independent of unrelated later migrations; and
2. fixes the logical Event Revision contract that Phase 2 features must express in reviewed OpenAPI, JSON Schema, and forward migrations.

It resolves `OPEN-QUESTIONS` B-3 under the approval record above. It does not activate Phase 2, approve F-107, create an endpoint or table, amend a merged migration, or change a regulatory rule, fixture, verdict, deadline, or finding.

## 2. Decisions

### 2.1 Ratify the Phase 1 schema as the historical contract

- The merged `events` schema is the cumulative result of:
  - `apps/api/migrations/001_initial_schema.ts`;
  - `apps/api/migrations/005_event_public_page_fields.ts`; and
  - `apps/api/migrations/006_events_battery_present.ts`; and
  - `apps/api/migrations/012_events_assembly_document_coverage.ts`, the separately approved F-110 amendment.
- Unrelated later migrations do not change which migrations define this ratified `events` shape.
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

Once an Event carries `jurisdiction_code`, every revision save and persisted revision must use that
same jurisdiction. A mismatch is rejected. Changing an Event's jurisdiction requires a separately
approved atomic transition; a revision save cannot change it by itself.

Stable Event metadata, such as the organizer-facing name or title, is not questionnaire data and a
metadata-only update does not append an Event Revision. Every stable-metadata update supplies the
opaque Event concurrency token returned by the Event read. In one transaction, the server locks the
Event, compares that token, validates and applies the metadata, and advances the token. A stale token
rejects the whole update; it never becomes a last-write-wins overwrite. A command that changes both
stable metadata and questionnaire answers checks the Event token and `base_revision_id` under the
same lock and commits both changes or neither.

At cutover, the Phase 1 `PATCH /api/events/:id` path must either be disabled or route stable metadata
and questionnaire changes through that combined transaction; it cannot remain an independent writer
to compatibility projections. The exact token representation, HTTP request, and error schemas
belong in the reviewed OpenAPI contract.

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
  backfill sets `created_by`, `created_at`, and `supersedes_revision_id` to `NULL`; the source
  recorded neither a revision-creation time nor a predecessor, so neither is inferred from plan
  order, Event data, or migration time.
- Derived authority or classification output is not accepted from the browser as regulatory truth.

### 2.4 Reject stale writes; do not merge them silently

- A save names the `base_revision_id` it was edited from. `null` is valid only when the event has no revision.
- In one transaction, the server locks the Event, compares `base_revision_id` with `current_revision_id`, validates the proposed answers, appends the revision, and advances the pointer.
- A changed save appends exactly one revision. Its `supersedes_revision_id` equals the validated
  `base_revision_id`; only the first organizer-created revision and the deterministic legacy
  backfill described in §2.3 have `supersedes_revision_id = NULL`.
- A save is a no-op only when its `input_schema_version`, `jurisdiction_code`, and
  schema-canonical `answers_json` match the current revision. It returns that revision and appends
  nothing. Changing the schema or answers appends a revision; a jurisdiction different from the
  Event is rejected under §2.2 unless a separately approved atomic jurisdiction transition applies.
- A stale base returns HTTP `409` with stable code `revision_conflict` and the current revision identifier.
- The server never performs an automatic field merge. The user reloads and explicitly reconciles.
- Plans evaluate `complete` revisions only. F-107 may save `incomplete` revisions but does not add a separate submission transition.

The exact HTTP request and error schemas belong in the reviewed OpenAPI contract.

### 2.5 Plans bind to exact revisions

- Every new plan references one `event_revision_id`.
- After Event Revisions are enabled, every plan-generation path, including a still-deployed Phase 1
  path, must read `current_revision_id` in the same consistency boundary as the exact answers it
  evaluates and persist that captured revision ID on the plan. It never attaches whatever revision
  is current after evaluation. Alternatively, deployment must atomically disable the legacy
  generator before enabling Event Revisions.
- The database must reject a plan whose `event_id` and revision belong to different events.
- Before evaluation and persistence, the selected published ruleset's jurisdiction must exactly
  equal the referenced revision's `jurisdiction_code`. Generation and persistence reject a
  mismatch.
- The selected published evaluation contract names the exact Event Input schema it accepts. Before
  evaluation, the referenced revision must either use that `input_schema_version` or pass an
  approved lossless transform into it and then pass complete validation under the target schema.
  Missing compatibility, transform loss, or incomplete validation rejects generation; it never
  interprets an older answer under changed field or enum semantics.
- Every plan persists the exact canonical engine input it evaluated. When a compatibility transform
  is used, that transform is an immutable approved artifact whose version and checksum are also
  persisted on the plan. Replay uses the persisted engine-input snapshot; it never reruns whichever
  transform is current later.
- The selected ruleset pins the exact calendar artifact used for evaluation. Generation resolves
  that artifact and rejects a calendar whose ID, version, checksum, or jurisdiction does not match
  the ruleset's declaration. Persisting calendar provenance does not substitute for validating the
  binding before evaluation.
- Generation resolves the exact IANA `jurisdictionTimezone`, requires it to match the selected
  jurisdiction's approved timezone binding, passes that exact value to the engine, and persists it
  on the plan. A mismatch rejects generation. This does not authorize an Event `timezone` field;
  that target field remains deferred under §2.2.
- Plans, findings, traces, and their regulatory snapshots remain immutable.
- A plan is stale when its revision differs from `events.current_revision_id`.
- Generating a candidate does not move `current_plan_id`.
- Every candidate records the exact `today` engine input used to evaluate it.
- An acceptance request names the accepted `base_plan_id` against which the candidate was presented;
  `null` is valid only when the Event has no accepted plan.
- The acceptance request includes the explicit deterministic reconciliation mapping the organizer
  reviewed. A prior non-default workflow status carries only through that reviewed mapping; an
  omitted or explicitly reset item starts in its default state. The server never invents a mapping
  or automatically attaches an old approval to a materially different finding, and it validates the
  supplied mapping against the canonical plan diff before applying it. The request also supplies the
  optimistic-concurrency token the organizer reviewed for every source workflow item the
  reconciliation would carry, reset, or omit to its default state.
- Accepting a candidate locks the Event and rechecks that the candidate belongs to it, that
  `candidate.event_revision_id === events.current_revision_id`, and that
  `base_plan_id === events.current_plan_id`. While holding that lock, acceptance also derives the
  current calendar date in the candidate's persisted `jurisdictionTimezone`, after rechecking that
  timezone against the jurisdiction binding, and requires it to equal the candidate's recorded
  `today`; otherwise it rejects the candidate and requires regeneration. The same
  transaction locks every source workflow item covered by that token set in a deterministic order
  and rechecks its concurrency token. A workflow mismatch rejects acceptance as a conflict.
  Only then may the transaction move `current_plan_id`, apply the approved deterministic workflow
  reconciliation, and persist obsolete message-job cancellations plus any required replacement
  job/outbox rows. The transaction also appends the plan-acceptance audit event with the actor, base
  plan, candidate plan, accepted Event Revision, and server-recorded acceptance time. A mismatch,
  reconciliation failure, job/outbox failure, or audit failure rolls back all of those changes.
  External delivery occurs only after commit.
- Cancelling a pending job is insufficient when a worker has already leased it. Claim/cancel
  serialization or a mandatory current-plan and cancellation-state recheck at the provider-delivery
  boundary must prevent a leased job made obsolete by acceptance from being sent.
- A later edit may make an accepted plan stale, but an already-stale candidate, a candidate evaluated
  on an obsolete local date, or a candidate based on a superseded accepted plan is never accepted.
- The migration that introduces `current_plan_id` sets it from the same-event
  `checklist_acknowledgements.plan_id` when an acknowledgement exists and to `NULL` otherwise. It
  never treats the latest generated plan as accepted.
- Until every deployed acceptance path uses `current_plan_id`, the legacy checklist-review path and
  the new acceptance path must perform acceptance through the same Event-lock transaction and
  update both `checklist_acknowledgements.plan_id` and `events.current_plan_id` to the same plan.
  Alternatively, deployment must atomically disable the legacy acceptance writer before enabling
  the new one. There is no rollout state in which both writers are active without that transactional
  dual-write, and `current_plan_id` becomes the sole authority only after the legacy writer is gone.
- For a backfilled plan, its canonical `intake_snapshot` must equal the engine-input projection of
  the revision it references under the plan's mapped schema. Questionnaire answers the engine did
  not consume may remain in that revision without being copied into the historical plan snapshot.
- Exact provenance is mandatory for every plan generated after cutover. A preserved pre-cutover plan
  follows §2.6's recovery-or-sentinel rule and is never represented as exactly replayable when any
  required provenance was not recorded.
- Existing numeric `permit_plans.event_revision` and `intake_snapshot` remain historical migration inputs, not the authority for new writes after cutover.

### 2.6 Backfill without guessing or deleting history

Before mutation, F-107's approved compatibility package must define:

- one unambiguous mapping from every historical `ruleset_version` to the Event Input schema that
  produced its plan snapshot;
- for every engine, calendar, rules-schema, Event Input schema, compatibility-transform,
  `jurisdictionTimezone`, and other required provenance field absent from a pre-cutover plan, either
  one exact value recovered from approved immutable historical evidence or SQL `NULL` with the sole
  meaning `legacy_unrecorded`. A current artifact, deployment state, display text, `generated_at`, or
  migration time is not evidence of what a historical plan evaluated;
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
   inputs even when the old numeric `event_revision` did not change. Every migration-created
   revision, including the current-row revision, has `supersedes_revision_id = NULL`;
4. populate each preserved plan's newly introduced provenance fields only from the compatibility
   package's approved recovery entries, using the `legacy_unrecorded` null sentinel for every
   unrecoverable field. New plan writes reject that sentinel;
5. assign those backfilled revisions a deterministic, strictly increasing order defined and tested
   by F-107. Every distinct plan-snapshot revision created in step 3 precedes the current-row
   revision, which receives the greatest backfilled revision number; every later live append receives
   a greater number. The order must not be inferred from version-string sorting or migration
   execution time;
6. always build the current Event/current revision from the Phase 1 row under the compatibility
   package's exact cutover `input_schema_version` and `jurisdiction_code`, even when a plan has the
   same legacy revision number. Stable values such as the Event name and questionnaire values such
   as `location_name` and `capacity` must survive through the exhaustive row mapping;
7. set that current revision to `complete` when full validation passes, or to `incomplete` only when
   F-107's partial-save validator accepts it;
8. compare same-number plans with the current row only after projecting both through their resolved
   schemas. A plan may reference the current revision only when the compatibility package can
   losslessly replay that revision under the plan's mapped schema, its canonical engine inputs
   match, and the revision is `complete`; otherwise the plan remains bound to its separate legacy
   revision and is stale; and
9. set `events.current_revision_id`, preserve every existing plan and synthetic history, and abort
   the transaction rather than partially mutating on any failure.

Current-only Phase 1 values must not be copied backward into older plan-backed revisions.

F-107 is not authorized to activate before the joint F-701–F-703 gate. `created_by = NULL` is
reserved for deterministic legacy backfill together with `created_at = NULL`; this contract defines
no demo or system actor. Every organizer-created revision requires the authenticated actor and
server-recorded creation time.

During compatibility rollout, every successful changed revision transaction must update old
`events` projections and increment `events.revision_counter` in the same transaction while any
deployed Phase 1 reader still uses them. A true no-op changes neither the projections nor
`revision_counter`. Projection and counter updates may stop only after every reader has atomically
cut over to Event Revisions. Event Revision remains the only write authority.

While any Phase 1 reader uses those projections, a revision save succeeds only when the revision can
be projected losslessly and satisfies every legacy column constraint. The server rejects an
incomplete save that omits a legacy-required value; it never retains the previous value, substitutes
a default, or writes `NULL` to make that save appear compatible. Incomplete saves that cannot meet
that rule activate only after the last legacy reader atomically cuts over.

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
  Event Input schema, compatibility-transform, engine, or calendar version/checksum differs, when
  the persisted canonical engine input differs, when `snapshot_date` differs, or when the recorded
  `today` or `jurisdictionTimezone` evaluation input differs. This applies even when every finding
  and plan outcome matches.
- For each provenance field, `legacy_unrecorded` compares equal only to the same sentinel and differs
  from every concrete value. A diff retains the complete list of unrecorded provenance fields, and a
  plan with any such field cannot claim exact replay; replay never substitutes a current artifact.
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
- preservation of current Phase 1 questionnaire values absent from historical plan snapshots,
  including `venue_paco_covers_exact_event` and
  `venue_fdny_pa_permit_current_for_event_space` from migration `012`;
- mismatch abort with no partial mutation;
- every migration-created revision has null actor/time/predecessor sentinels, while every
  organizer-created revision records actor/time and every changed organizer save records its
  validated base as predecessor;
- a legacy write racing the backfill is either included in the resulting current revision or
  committed through the revision transaction, never lost between authorities;
- revision immutability;
- two concurrent saves produce one success and one `revision_conflict`;
- two concurrent stable-metadata updates from the same Event token produce one success and one
  conflict, with no last-write-wins overwrite;
- a combined stable-metadata and questionnaire update rejects stale Event or revision input without
  changing either authority, and otherwise commits both atomically;
- the Phase 1 Event edit path cannot write questionnaire projections independently after cutover;
- a save with matching schema, jurisdiction, and answers creates no revision, while changing only
  the schema creates one and a jurisdiction mismatch is rejected;
- every changed non-initial organizer save links the appended revision to its validated base, while
  the first organizer revision has no predecessor;
- legacy backfill is the only path to `created_by = NULL`; organizer saves reject a missing
  authenticated actor;
- missing and explicit `unknown` remain distinct;
- plans reference exact revisions and staleness is server-derived;
- a legacy generation path racing a revision save either persists the revision ID captured with the
  exact projected answers it evaluated or is disabled before Event Revisions activate; it never
  binds the plan to a later current revision;
- a revision save rejects a jurisdiction different from the Event's jurisdiction, and an Event
  jurisdiction change cannot occur through the revision-save path;
- plan generation and persistence reject a ruleset/revision jurisdiction mismatch;
- plan generation rejects a revision whose Event Input schema is neither the selected evaluation
  contract's exact schema nor losslessly transformed and completely revalidated under it;
- every plan persists the exact canonical engine input evaluated, and replay remains byte-stable
  after the compatibility transform used at generation is replaced by another version;
- plan generation rejects a calendar artifact whose ID, version, checksum, or jurisdiction does not
  match the selected ruleset's declaration;
- plan generation rejects a `jurisdictionTimezone` that does not match the selected jurisdiction's
  approved binding, and the plan persists the exact timezone passed to the engine without requiring
  a deferred Event `timezone` field;
- `current_plan_id` backfills from the same-event checklist acknowledgement, or remains null when
  none exists, regardless of newer generated plans;
- while legacy and new acceptance paths coexist, accepting through either path atomically leaves
  `checklist_acknowledgements.plan_id` and `events.current_plan_id` naming the same plan;
- an Event with no historical plan backfills its current revision under the exact cutover Event
  Input schema and jurisdiction named by the compatibility package;
- every distinct plan-snapshot revision created during backfill has a lower revision number than the
  current-row revision, and the first live append has a greater revision number than every backfilled
  revision;
- accepting a candidate races safely with a revision save and rejects the stale candidate;
- accepting a candidate after its jurisdiction-local evaluation date has passed rejects it and
  requires regeneration;
- accepting a candidate whose persisted `jurisdictionTimezone` no longer matches the jurisdiction
  binding rejects it and requires regeneration;
- two candidates accepted concurrently from the same accepted base produce one success and one
  conflict;
- a non-default workflow status carries only through the deterministic mapping the organizer
  reviewed, while an omitted or reset item starts in its default state and a materially changed
  finding never receives an old approval automatically;
- a checklist status or notes update committed after the organizer reviewed the reconciliation makes
  acceptance conflict without changing the plan pointer, workflow, jobs, or audit log;
- an acceptance reconciliation or job/outbox failure leaves the plan pointer, workflow, and jobs
  unchanged;
- plan acceptance appends its actor, base plan, candidate plan, accepted Event Revision, and
  server-recorded time to the activity log atomically with the plan pointer, and an audit-write
  failure rolls back acceptance;
- a worker that leased an obsolete message job before plan acceptance cannot send it after acceptance
  commits;
- while a Phase 1 reader remains, a revision save and subsequent plan generation cannot observe
  different questionnaire answers;
- while a Phase 1 reader remains, a changed save atomically increments
  `events.revision_counter` with its compatibility projections, while a true no-op changes neither;
- while a Phase 1 reader remains, an incomplete save that omits a legacy-required projected value
  is rejected without appending a revision or changing any projection;
- a `note_text`-only finding change is reported as `changed`;
- a `verification.qualification`-only finding change is reported as `changed`;
- a change to only one of the scope, deadline, fee, required-documents, or portal verification
  statuses is reported as `changed`;
- a result-completeness or result-completeness-reason-only change is reported when every finding
  rendering matches;
- a verdict or user-visible `verdictDetail`-only change, including a `rescopeSuggestions`-only
  change, is reported when every finding rendering matches;
- a plan-provenance-only change is reported when every finding and plan outcome matches, including
  when only the recorded `today` or `jurisdictionTimezone` evaluation input differs;
- legacy plan backfill recovers a missing provenance value only from its approved immutable mapping,
  uses `legacy_unrecorded` for an unrecoverable value, and never copies a current artifact into
  historical provenance;
- `legacy_unrecorded` compares equal only to itself, differs from every concrete provenance value,
  remains visible in diff output, and prevents an exact-replay claim;
- diff identity and output are byte-stable; and
- cross-workspace reads and writes fail after tenancy activation.

The full existing fixture and boundary suite must remain green. This contract changes no expected regulatory output.

## 5. Approval and Activation

On 2026-07-27, `@jzeng151` explicitly invoked the one-time access-gated-demo overwrite recorded in `docs/DOCUMENTATION-GOVERNANCE.md` §6. It supersedes the all-lane and teammate-review requirements for PR #137 only. No approval is attributed to another account.

B-3 is resolved for the access-gated synthetic-data demo by this record. Issue #2 closes when PR #137 merges. Strict all-lane and architecture-owner ratification remains B-4 and must land before production activation.

Approval fixes the shared logical contract for demo implementation. Each implementation still needs its consuming approved F-id, OpenAPI/JSON Schema, and forward migration. Production additionally remains blocked on B-4 and the F-701–F-703 gate.
