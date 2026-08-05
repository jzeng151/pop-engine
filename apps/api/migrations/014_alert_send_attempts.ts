import type { ColumnDefinitions, MigrationBuilder } from "node-pg-migrate";

export const shorthands: ColumnDefinitions | undefined = undefined;

/**
 * That PopEngine was about to hand an alert to a provider, recorded BEFORE the handoff.
 *
 * An intent rather than a receipt: the row is written before `sender(...)` is called, so a process
 * that dies in between leaves exactly what one that died mid-send leaves. Nothing reading this
 * table can say the provider ended up with the message.
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
 * `superseded_at` says this attempt has stopped speaking for its alert, and it is a different
 * statement from `outcome_recorded_at`: one is about what the provider did, the other about which
 * send the attempt belongs to. TWO CAUSES SET IT, and a reader that knows only the first
 * misclassifies the second. An alert cancelled by a regeneration and revived by a later one comes
 * back as a fresh schedule (`alerts.ts` clears its failure count and backoff for the same reason),
 * and without this the withdrawn schedule's unresolved attempt kept excluding the revived row from
 * every scan for good. A retry made after `UNRESOLVED_ATTEMPT_HOLD_LIMIT_HOURS` sets it too, on an
 * alert nobody cancelled and whose schedule never ended: the retry is the send that speaks for the
 * alert now, and the attempt it overtook can no longer be duplicated by anything. Set, never
 * cleared; the attempt stays unresolved either way, because nobody ever did learn what the
 * provider did with it.
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
  // A POINT IN TIME, WHICH IS WHY THE ROLLOUT HAS AN ORDER. This statement sweeps once. An api
  // process from the build before this one sends without writing attempt rows, so anything it
  // sends after this commits is a row in the old shape that no later sweep would find: absence of
  // an attempt would say "never handed over" about a send that may be sitting at the provider, and
  // a retry past the dedup window would be a second deadline reminder at a real organizer. Nothing
  // in this repository can stop a process that is running the previous build, so the constraint is
  // recorded where the person doing the rollout works, in `DEPLOY.md` under "Release order": stop
  // the running api, then let the new build apply this. The guard in
  // `apps/api/src/deployment-order.test.ts` fails if that step goes missing while this backfill
  // and its readers are still here.
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
  // A LOCAL FAILURE IS NOT EXEMPTED, and that is a decision this predicate reached by running out
  // of evidence rather than by preferring the hold. A database that ran without RESEND_API_KEY or
  // SMTP_FROM failed its email alerts inside the process: `unconfiguredEmailSender` throws before
  // a socket is opened, so THAT failure reached no provider. What the row cannot say is whether an
  // EARLIER send did. `last_error` is the latest failure and is overwritten by every attempt.
  // `failure_count` (migration 008) is incremented by the same transaction that marks the row
  // failed, so the crash this table exists for takes the increment down with it: a send that
  // reached Resend and lost its COMMIT leaves the count exactly where it was, and a later
  // unconfigured failure then records count 1 with the local error — indistinguishable from a row
  // that was only ever tried locally. No other column carries attempt history at all; that is why
  // this table is being created. So nothing on an `alerts` row can prove a provider was never
  // reached, and a predicate that skipped on count 1 would be reading a number a crash erased.
  //
  // WHICH WAY THE UNPROVABLE CASE FALLS. Seeding these rows costs a credential-less deployment a
  // reconciliation hold per failed email alert, cleared the way any hold is cleared: a person
  // checks the provider for the key and then marks the alert sent or clears the attempt. Skipping
  // them costs a duplicate deadline alert to an organizer, sent once the credentials return after
  // the provider's dedup window, with no way back. Operator work against a message a real person
  // receives twice is not a close trade, and F-203 already refuses the mirror image of it where
  // `alerts.ts` refuses to hold a row by age. Seeded, therefore, and the uncertainty preserved.
  //
  // THE STAMP IS THE UPGRADE, LESS THE PROVIDER'S DEDUP WINDOW, and it encodes exactly one claim:
  // this attempt is at least as old as the window Resend honours a repeated `Idempotency-Key` for.
  // Nothing on the row says when the attempt happened, so that is the strongest thing the evidence
  // carries — and it is the NEWEST stamp consistent with it, which is what makes it the safe one:
  // an older stamp would release the row sooner, not later.
  //
  // WHY NOT `-infinity`, which this seed used to write. It said "older than every window, from
  // every reader", and that reading was correct while a hold had no end. Under the bounded hold the
  // product owner recorded on 2026-08-04 (`docs/BASELINE.md`, resolving SPEC-CONFLICT #240), a row
  // is held from `PROVIDER_DEDUP_WINDOW_HOURS` after its attempt until
  // `UNRESOLVED_ATTEMPT_HOLD_LIMIT_HOURS` after it, and an attempt time older than every bound is
  // past the far edge as well as the near one: every seeded row would have been retried on the
  // first tick after the upgrade, which is the duplicate burst this seed exists to prevent.
  //
  // WHY NOT THE UPGRADE ITSELF, the other obvious anchor. The near edge is what makes a retry safe,
  // so a row stamped now is one the poller may retry immediately and freely for the next
  // `PROVIDER_DEDUP_WINDOW_HOURS` — the same burst, arriving by the permissive reading rather than
  // the permanent one. The stamp has to sit at or before the near edge for the hold to begin at the
  // upgrade at all.
  //
  // So a seeded row is held from the upgrade, and retried one dedup window after it: the same hold
  // LENGTH every other row gets, from the same predicate, with no value in this column meaning
  // something different from its neighbours. The rows stay unresolved throughout, because nobody
  // ever did find out what the provider did with them, and the two ways out are the two any hold
  // has — a person checks the provider for the key and then marks the alert sent or clears the
  // attempt, or the limit passes and the poller retries it.
  //
  // THE INTERVAL IS A LITERAL AND ITS DERIVATION IS THIS COMMENT. 24 hours is the value of
  // `PROVIDER_DEDUP_WINDOW_HOURS` on the day this migration was written, and the two say the same
  // thing on the day it runs, which is what the seed needs. Read from the constant instead, they
  // would also say the same thing on every later day, and that is the wrong property here: a
  // change to the window would rewrite what this already-applied migration is understood to have
  // done, and a database migrated after that change would seed a different stamp from one migrated
  // before it out of the same migration set. Frozen, this migration keeps the number it ran with,
  // and a change to the window is what a change to a shipped migration has always been — a new
  // ordered one (AGENTS.md). `migration-014.test.ts` pins the literal and the absence of the read.
  pgm.sql(`INSERT INTO alert_send_attempts (alert_id, idempotency_key, attempted_at)
           SELECT id, idempotency_key,
                  clock_timestamp() - interval '24 hours'
             FROM alerts
            WHERE status = 'failed'
              AND channel = 'email'
              AND coalesce(payload->>'test', 'false') <> 'true'`);
}

export function down(pgm: MigrationBuilder): void {
  pgm.dropTable("alert_send_attempts");
}
