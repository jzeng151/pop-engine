# PopEngine Code Comment Audit: Before and After

**Status:** PROPOSED

**Review date:** 2026-08-10

**Scope:** Tracked first-party TypeScript, JavaScript, CSS, environment examples, CI configuration, and database migrations. Generated output, dependencies, lockfiles, prose documentation, and rules JSON are excluded.

**Purpose:** Show how to remove narration and review history while retaining constraints, gotchas, and provenance that the code cannot express.

**Implementation:** Approved and applied to live source and tests in this change. Migrations 001–014 remain untouched.

The migration “after” examples below are the standard new migrations should follow, not instructions to rewrite migrations 001–014; `AGENTS.md` prohibits editing merged migrations.

## Summary

The scan found 3,480 comment tokens spanning 7,696 lines and approximately 548 KB of text across 193 TypeScript/JavaScript files. The implementation reduced that to 1,066 tokens, 1,626 lines, and approximately 119 KB: 6,070 fewer comment lines and a 78% reduction in comment text.

The desired rule is:

> Comment the invariant or surprising constraint. Let names, types, tests, specifications, issues, and version control carry behavior, examples, and history.

Keep executable directives such as `@vitest-environment`, generated `next-env.d.ts` references, JSDoc type annotations used by tooling, `ponytail:` ceiling markers, security warnings in environment examples, and explanations for irreversible or intentionally empty operations.

## Repository-wide before and after

### 1. Delete feature labels that only repeat the path

Before:

```ts
// F-301 public event page (ARCHITECTURE.md API Surface).
```

After:

```ts
// Delete.
```

The filename, router path, exports, and tests already identify the feature.

### 2. Delete test narratives already expressed by the test

Before:

```ts
// #252 review: NAMING THE RIGHT ROUTE IS NOT THE SAME AS CARRYING ITS VALUES.
// Membership alone still accepted a row whose date, status, fee or portal came
// from a different route than the one it names ...
```

After:

```ts
it("rejects filing values from a route other than filingRouteRuleId", () => {
  // Test body is the explanation.
});
```

The regression number may remain in the test name when traceability matters. Review-round chronology does not belong beside the assertion.

### 3. Reduce incident history to the invariant

Before, from `apps/api/src/alert-delivery.ts`:

```ts
/**
 * Transport failures that PROVE the request never reached the provider.
 *
 * THE MEMBERSHIP RULE ...
 * [approximately 3,300 more characters covering prior reports and rejected codes]
 */
```

After:

```ts
// Only failures proven to occur before the first request byte are safe to mark
// as not handed off. Ambiguous post-write failures remain unresolved.
```

The set and its tests enumerate membership; the comment states the selection rule.

### 4. Keep null/absence semantics; delete consumer history

Before, representative of several comments in `packages/engine/src/types.ts`:

```ts
/**
 * This route's own published notes ...
 * WITHOUT IT THE ATTRIBUTION EXISTS NOWHERE ...
 * [history of the consumer that once read the wrong route]
 * Optional because a plan stored before this field ...
 */
```

After:

```ts
/** This route's published notes. Absent means an older stored plan did not record them. */
```

The compatibility distinction is durable. The bug and affected consumer belong in the regression test and issue.

### 5. Keep database/time semantics in one sentence

Before, from `apps/api/src/alerts.ts`:

```ts
/**
 * `statement_timestamp()` RATHER THAN `current_timestamp` ...
 * [transaction history and four-query walkthrough]
 */
```

After:

```ts
// Use statement_timestamp(): transaction time may be stale, while
// clock_timestamp() can disagree within one statement.
```

### 6. Keep useful CSS navigation, delete visual narration

Before:

```css
/* F-402 live ops — field clipboard on the shared pe-shell canvas. */
```

After:

```css
/* Delete. */
```

Keep short section labels such as `/* Organizer overview */` in the 2,000-line global stylesheet. Keep comments explaining browser or accessibility behavior, for example why `legend` must remain in normal flow or why an animation is intentionally one-shot.

## Migration comment review

### Findings

| Migration                                            | Comment lines | Verdict                                                                                 | Ideal comment lines |
| ---------------------------------------------------- | ------------: | --------------------------------------------------------------------------------------- | ------------------: |
| `001_initial_schema.ts`                              |             0 | Lean                                                                                    |                   0 |
| `002_checklist_acknowledgement_and_snapshot_date.ts` |            17 | Three useful constraints buried in application behavior                                 |                   4 |
| `004_checklist_item_created_at.ts`                   |            15 | Repeats ordering scenarios and alternatives                                             |                   2 |
| `005_event_public_page_fields.ts`                    |            15 | Mostly stale proposal and numbering history                                             |                   1 |
| `006_events_battery_present.ts`                      |            46 | Important destructive-backfill assumption, heavily repeated                             |                   5 |
| `007_checklist_item_cohort_position.ts`              |            44 | Useful backfill invariant expanded into a defect narrative                              |                   4 |
| `008_alert_failure_count.ts`                         |            12 | Column name and spec already say nearly everything                                      |                   1 |
| `009_event_alert_contacts.ts`                        |            23 | One valuable event-vs-message lifetime distinction                                      |                   2 |
| `010_alert_retry_backoff.ts`                         |            14 | One valuable schedule-vs-retry distinction                                              |                   2 |
| `011_alert_queue_index.ts`                           |            30 | Query-plan essay; retain index intent and partial predicate                             |                   3 |
| `012_events_assembly_document_coverage.ts`           |             9 | Keep non-inference/backfill reason; delete numbering                                    |                   2 |
| `013_stale_assembly_document_plans.ts`               |             2 | Appropriate irreversible-down explanation                                               |                   2 |
| `014_alert_send_attempts.ts`                         |           137 | Most egregious: design document, rollout guide, incident log, and code comment combined |                  10 |
| **Total**                                            |       **364** |                                                                                         |        **about 38** |

The ideal form is roughly 90% shorter. Existing migrations remain untouched because they are merged historical records.

### Migration 001 — keep as is

There are no comments. The schema declarations are readable without narration.

### Migration 002 — acknowledgements and snapshot date

Before:

```ts
// What the organizer last reviewed, so "your plan changed" can be answered ...
// The checklist cannot answer it ...
// One row per event ... The upsert must set acknowledged_at explicitly ...
// The target a composite foreign key needs ...
```

After:

```ts
// One acknowledgement per event; the composite foreign key prevents a plan
// from being acknowledged for the wrong event.

// Nullable for older plans; this is the ruleset publication date, not a
// verification date.
```

The upsert behavior is application logic and belongs beside that upsert, not in the schema migration.

### Migration 004 — checklist creation time

Before:

```ts
// When a requirement became a checklist task ...
// permit_plans.generated_at answers a different question ...
// checklist_items.updated_at cannot stand in either ...
// [scenario explaining a removed and reintroduced requirement]
```

After:

```ts
// Stable task creation time. Existing rows share the migration timestamp
// because their original creation times were never recorded.
```

### Migration 005 — public-page fields

Before:

```ts
/**
 * Resolves SPEC-CONFLICT #100 for F-301.
 * [field list, abandoned migration number, and obsolete approval narrative]
 */
```

After:

```ts
// F-301 promotion fields; public pages default to unpublished.
```

The current comment calls a merged migration a “proposed resolution” and preserves an abandoned filename. Both are stale history.

### Migration 006 — battery presence

Before:

```ts
// A POSITIVE kWh answer is evidence of a battery ...
// `> 0` rather than `IS NOT NULL` ...
// [fixture history, negative-value reasoning, null semantics, test-helper
// compatibility, and a hypothetical migration for a real database]
```

After:

```ts
// Legacy kWh values backfill presence: positive means present; zero means absent.
// Null also becomes absent only because no persisted event rows existed when this
// migration shipped. The column stays nullable for partial test inserts.
```

This is one of the few migrations where the deployment-state assumption is load-bearing: mapping null to false would otherwise invent an answer. Keep that assumption; delete repeated proofs and hypothetical redesigns.

### Migration 007 — checklist cohort position

Before:

```ts
// Where a task sits among the tasks created with it ...
// [Postgres timestamp behavior, two rejected orderings, old display walkthrough,
// measurement result, and current deployment inventory]
```

After:

```ts
// Freeze each task's order within its creation cohort. For existing rows,
// preserve the pre-007 display order because original insertion order is
// unrecoverable.
```

The SQL already shows the exact backfill ordering. The comment should explain why that order is being preserved, not restate every column.

### Migration 008 — alert failure count

Before:

```ts
/**
 * F-203 edge case "Twilio/SMTP outage" ...
 * [retry narrative, payload discussion, and migration immutability reminder]
 */
```

After:

```ts
// Retry count is delivery state, separate from the immutable alert payload.
```

### Migration 009 — event alert contacts

Before:

```ts
/**
 * Where an event's alerts are sent, as a fact about the EVENT ...
 * [three failure scenarios and rejected normalized-table design]
 */
```

After:

```ts
// Event destinations are mutable; alert recipients remain immutable delivery
// history. A row is omitted when neither destination exists.
```

The rejected alternative schema and issue history do not affect how this migration runs.

### Migration 010 — retry backoff

Before:

```ts
/**
 * When a failed alert becomes eligible again ...
 * [delivery-budget walkthrough and queue starvation scenario]
 */
```

After:

```ts
// Retry eligibility is separate from send_at, which remains the original
// schedule used to measure delivery latency. Null means eligible now.
```

### Migration 011 — due-alert index

Before:

```ts
/**
 * The index the due-alert scan needs ...
 * [table-growth forecast, planner walkthrough, INCLUDE rationale, and exclusions]
 */
```

After:

```ts
// Partial index keeps completed audit rows out of the due queue.
// failure_count/send_at match queue ordering; next_attempt_at is included for
// retry eligibility without enlarging the index key.
```

The SQL expresses the indexed columns and predicate. Retain only the non-obvious reason for the partial and included columns.

### Migration 012 — assembly document coverage

Before:

```ts
/**
 * F-110 replaces the coarse assembly-approval question ...
 * Number 012 follows the current migration head inspected on 2026-07-29 ...
 */
```

After:

```ts
// Preserve the deprecated coarse answer as history; affected drafts receive
// explicit unknowns rather than inferred document coverage.
```

Migration numbering is visible in the filename and should not be dated in prose.

### Migration 013 — stale assembly plans

Before and after:

```ts
// The previous revision may already have been evaluated after this migration ran,
// so rollback cannot safely decrement it.
export function down(_pgm: MigrationBuilder): void {}
```

This is exactly the kind of comment worth keeping: it explains an intentionally empty rollback and the data-loss risk of the obvious inverse.

### Migration 014 — alert send attempts

Before:

```ts
/**
 * That PopEngine was about to hand an alert to a provider ...
 * [39 lines covering transaction design, lock modes, every field, and incidents]
 */

// WHAT THIS TABLE'S ABSENCE MEANT BEFORE IT EXISTED ...
// [94 lines covering rollout order, every excluded population, competing
// timestamps, provider configuration, reconciliation policy, and literal history]
```

After:

```ts
// Record send intent on an independent connection before provider handoff so it
// survives rollback. A null outcome means the provider result is unknown;
// superseded_at means the attempt no longer owns the alert's current schedule.

// Only unresolved attempts for the current schedule are queried.

// Backfill legacy failed email alerts, excluding test sends, as unresolved at
// upgrade time minus Resend's frozen 24-hour dedup window. Drain the old API
// before migrating (DEPLOY.md) so no unrecorded sends occur after this sweep.
// Keep the literal in this immutable migration; do not read live configuration.
```

What remains is genuinely load-bearing:

- the intent must survive the sending transaction's rollback;
- null means uncertainty, not failure or non-delivery;
- the backfill deliberately includes only failed, non-test email alerts;
- rollout order closes the one-time sweep race;
- 24 hours is frozen migration history rather than current configuration.

Everything else is duplication of `DEPLOY.md`, tests, application code, issue history, or the SQL predicate itself.

## Comments that should be added

These are the few places where a short comment would prevent an unsafe simplification:

| Location                                                  | Proposed comment                                                                                                  |
| --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `apps/api/src/auth.ts`, settings check                    | `// Fail closed unless email auto-confirm is disabled; authenticated sessions must still require verified email.` |
| `apps/web/app/auth/actions.ts`, unexpected signup session | `// A signup session means email confirmation was bypassed; revoke it before failing.`                            |
| `apps/web/app/auth/return-path.ts`                        | `// Fixed allowlist prevents authentication callback open redirects.`                                             |
| `apps/web/lib/supabase/config.ts`, `siteUrl`              | `// Callback configuration must be a bare origin: no credentials, path, query, or fragment.`                      |
| `apps/web/middleware.ts`, cookie `setAll`                 | `// Update this render's request view and copy the refreshed cookies and headers to the response.`                |
| `apps/api/src/ruleset.ts`, advisory lock                  | `// Serialize delete/reseed across API instances for this ruleset version.`                                       |
| `apps/api/src/parks.ts`, apostrophe replacement           | `// SoQL string literals escape apostrophes by doubling them.`                                                    |

## Implementation result

1. Migrations 001–014 were not edited.
2. Test narration was removed while executable directives such as `@vitest-environment` were retained.
3. Production essays and incident histories were reduced to invariants, including embedded SQL comments.
4. The seven missing security and correctness comments above were added.
5. No dependencies or runtime behavior were added.

Net result: **6,070 fewer parsed comment lines** and **429 KB less comment text** across the same 193 TypeScript/JavaScript files.
