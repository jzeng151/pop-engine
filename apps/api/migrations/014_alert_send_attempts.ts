import type { ColumnDefinitions, MigrationBuilder } from "node-pg-migrate";

export const shorthands: ColumnDefinitions | undefined = undefined;

/**
 * That PopEngine handed an alert to a provider, recorded BEFORE the handoff.
 *
 * Until now nothing was written until a send had already succeeded, so a process that died between
 * the provider accepting the message and the COMMIT left a row byte-identical to one that had never
 * been tried. Those two states need opposite treatment — the untried row must go out, the other one
 * may already have reached the recipient — and no column on `alerts` could tell them apart.
 *
 * A TABLE RATHER THAN A COLUMN, for a mechanical reason rather than a modelling preference. The
 * intent has to survive a transaction that is about to roll back, so it is written on a second
 * connection and committed on its own. The sending transaction holds the `alerts` row locked for
 * the whole send, so a second connection cannot write to that row at all; it can insert a child row,
 * because a foreign key takes only FOR KEY SHARE on the parent (`alerts.ts` claims the row FOR NO
 * KEY UPDATE for exactly this reason).
 *
 * `outcome_recorded_at` NULL is the whole point: it means nobody ever observed what the provider
 * did with this attempt. A crash leaves it null forever, and so does a request that timed out —
 * a timeout is not an answer. It is set when the provider answered, delivery or refusal alike,
 * because either answer tells this side what happened.
 *
 * The key is stored because it is what a reconciliation would look the message up by at the
 * provider. It is a digest of the destination, never the destination itself (AGENTS.md: no
 * unredacted contact data).
 *
 * `superseded_at` says the SCHEDULE this attempt was made for has ended, and it is a different
 * statement from `outcome_recorded_at`: one is about what the provider did, the other about which
 * queue membership the attempt belongs to. An alert cancelled by a regeneration and revived by a
 * later one comes back as a fresh schedule (`alerts.ts` clears its failure count and backoff for
 * the same reason), and without this the withdrawn schedule's unresolved attempt kept excluding
 * the revived row from every scan for good. Set, never cleared; the attempt stays unresolved
 * because nobody ever did learn what the provider did with it.
 */
export function up(pgm: MigrationBuilder): void {
  pgm.createTable("alert_send_attempts", {
    id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
    alert_id: {
      type: "uuid",
      notNull: true,
      references: "alerts",
      onDelete: "CASCADE",
    },
    idempotency_key: { type: "text", notNull: true },
    attempted_at: { type: "timestamptz", notNull: true, default: pgm.func("clock_timestamp()") },
    outcome_recorded_at: { type: "timestamptz" },
    superseded_at: { type: "timestamptz" },
  });
  // The one question asked of this table on every scan: does this alert have an attempt nobody ever
  // saw the end of, made for the schedule the alert is on now. Partial, because a resolved attempt
  // is history and a superseded one belongs to a schedule that ended; neither is ever selected.
  pgm.createIndex("alert_send_attempts", ["alert_id"], {
    name: "alert_send_attempts_unresolved_idx",
    where: "outcome_recorded_at IS NULL AND superseded_at IS NULL",
  });
  // WHAT THIS TABLE'S ABSENCE MEANT BEFORE IT EXISTED, which is not what it means afterwards. From
  // here on, an alert with no attempt row was never handed to anybody, and the poller reads that
  // as safe to send at any age. Applied over a database that has been running, the same absence is
  // true of every row that was already attempted, because nothing recorded attempts. A row that
  // failed under that code may have failed the unobserved way — a timeout, or a reset after the
  // provider had the message — and its key can be older than the 24 hours the provider honours it
  // for, so the first post-upgrade retry would be a second delivery to a real person rather than
  // one the provider deduplicates. Left unseeded, the mechanism this migration exists for would
  // start life blind to the whole population it was written to protect.
  //
  // FAILED ONLY, and that boundary is the decision rather than a detail. `failed` is the one state
  // that is proof of an attempt. A legacy `pending` row is the ordinary case — not yet due, or due
  // and never picked up — so seeding those would hold an entire queue on the possibility that one
  // of them crashed mid-send, turning a possible duplicate into certain non-delivery for
  // everything. That is the failure F-203 exists to prevent, and `alerts.ts` refuses the same
  // trade where it refuses to hold a row by age.
  //
  // EMAIL ONLY, because SMS has never had a provider to duplicate at: every shipped sender for it
  // is the labelled in-product simulation (`alert-delivery.ts`), so a legacy SMS failure cannot be
  // a message sitting at a provider unacknowledged. Holding one would ask a person to reconcile
  // something nothing sent.
  //
  // TEST ROWS ARE LEFT ALONE for the reason every other predicate leaves them alone: an AC 6 demo
  // send is an operator action against no deadline, and a hold on one is an operational warning
  // about a message no organizer was waiting for.
  //
  // AND SO ARE THE FAILURES THAT NEVER REACHED ANYBODY, which is the one place `failed` is not
  // proof of a provider handoff. A database that ran without RESEND_API_KEY or SMTP_FROM failed
  // its email alerts inside the process: `unconfiguredEmailSender` throws before a socket is
  // opened, so no provider can be holding those messages and no retry of one can be a second
  // delivery. Seeding them would hold every such row permanently, and the whole point of failing
  // that way rather than simulating a send is that adding the credentials later delivers the
  // alert. The row's own recorded error is the only evidence of why it failed, so it is what is
  // read. The literal is repeated here rather than imported because a merged migration must keep
  // meaning what it meant on the day it ran; `alerts.test.ts` pins it against the live sender.
  //
  // ONE FAILURE, THOUGH, AND NOT MERELY THIS ERROR. `last_error` is the LATEST failure and is
  // overwritten by every attempt, so it says nothing whatever about the ones before it. A row that
  // reached Resend, lost its COMMIT to a crash, and was then retried in a deployment whose
  // credentials had gone carries this exact local message while the earlier provider outcome
  // stays unknown — the ambiguous history this whole table exists for, skipped on the strength of
  // an error that postdates it. `failure_count` (migration 008) is the column that can tell the
  // two apart: exactly one recorded failure, and the error on the row is that failure, so nothing
  // ever reached a provider. More than one, and the earlier attempts are unaccounted for, so the
  // row is seeded and the uncertainty is preserved. A legacy row that predates 008 counts zero,
  // which is not one, so it is seeded too — that is the same conservative reading, since a row
  // whose attempt history is unrecorded is the definition of ambiguous here.
  //
  // `-infinity` RATHER THAN A DATE, because the attempt time is not merely unknown, it is
  // unknowable from anything on the row — nothing recorded when the last attempt happened. Any
  // stamp this migration invented would be a claim about a provider's dedup window that no
  // evidence supports, and a recent-looking one would be the permissive reading again, wearing a
  // timestamp. Older than every window, from every reader, without naming a number that would then
  // have to be kept in step with `PROVIDER_DEDUP_WINDOW_HOURS`.
  //
  // The seeded rows are unresolved and stay that way: nobody ever did find out what the provider
  // did with these, which is exactly what a hold says. The way out is the way out for any hold — a
  // person checks the provider for the key and then marks the alert sent or clears the attempt.
  pgm.sql(`INSERT INTO alert_send_attempts (alert_id, idempotency_key, attempted_at)
           SELECT id, idempotency_key, '-infinity'::timestamptz
             FROM alerts
            WHERE status = 'failed'
              AND channel = 'email'
              AND coalesce(payload->>'test', 'false') <> 'true'
              AND NOT (failure_count = 1
                       AND coalesce(payload->>'last_error', '') = $$RESEND_API_KEY and SMTP_FROM are not configured; email alerts stay pending until they are$$)`);
}

export function down(pgm: MigrationBuilder): void {
  pgm.dropTable("alert_send_attempts");
}
