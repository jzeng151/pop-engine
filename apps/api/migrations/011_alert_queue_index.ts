import type { ColumnDefinitions, MigrationBuilder } from "node-pg-migrate";

export const shorthands: ColumnDefinitions | undefined = undefined;

/**
 * The index the due-alert scan needs, which nothing so far provided (issue #151).
 *
 * `alerts` has had only its primary key and the `idempotency_key` unique index since migration
 * 001, and 008 and 010 added the ordering and retry columns without indexing them. The poller runs
 * its scan every sixty seconds, and sent and cancelled rows are retained indefinitely because they
 * are the audit record AC 2 and AC 7 rest on, so the table only grows while the queue it is
 * looking for does not. Scanning all of it, evaluating the correlated staleness predicates and
 * sorting merely to return at most twenty-four ids spends the delivery budget before any provider
 * work starts.
 *
 * PARTIAL, on the two statuses the scan asks for. That is what keeps the index proportional to the
 * QUEUE rather than to the table: every sent and cancelled row is excluded from it, which is most
 * of them in any event that has been running a while, so the index stays small while the audit
 * trail grows without bound.
 *
 * The column order follows the query: `send_at` is the range the scan filters on and the first
 * thing it orders by after `failure_count`, and `failure_count` leads because it is the outer sort
 * key and the planner can then walk the index in the order the query already wants. Ordering the
 * remainder — the channel rank and the type tiebreak — is not something an index can supply, and
 * they are computed over a set the LIMIT has already bounded.
 *
 * `next_attempt_at` is included rather than indexed: it is nullable, its predicate is an OR with a
 * NULL check, and carrying it in the leaf pages lets the eligibility test be answered without
 * visiting the heap.
 *
 * Deliberately NOT covering the staleness predicates. Those are correlated subqueries against
 * `checklist_items`, `permit_plan_items`, `permit_plans` and `events`, and an index on `alerts`
 * cannot help them; they are evaluated against the rows this index has already narrowed to.
 */
export function up(pgm: MigrationBuilder): void {
  pgm.sql(`
    CREATE INDEX alerts_due_queue_idx
        ON alerts (failure_count, send_at)
     INCLUDE (next_attempt_at)
       WHERE status IN ('pending', 'failed')
  `);
}

export function down(pgm: MigrationBuilder): void {
  pgm.sql("DROP INDEX IF EXISTS alerts_due_queue_idx");
}
