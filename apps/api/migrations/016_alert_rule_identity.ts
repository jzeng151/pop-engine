import type { ColumnDefinitions, MigrationBuilder } from "node-pg-migrate";

export const shorthands: ColumnDefinitions | undefined = undefined;

const RULE_CONSTRAINT = "alerts_item_rule_required";

export function up(pgm: MigrationBuilder): void {
  pgm.addColumn("alerts", { rule_id: { type: "text" } });
  pgm.sql(`
    WITH attributed AS (
      SELECT alert.id,
             coalesce(
               CASE
                 WHEN alert.alert_type = 'deadline_reminder'
                      AND array_length(string_to_array(alert.idempotency_key, ':'), 1) = 7
                      AND (string_to_array(alert.idempotency_key, ':'))[5] = ANY(item.rule_ids)
                   THEN (string_to_array(alert.idempotency_key, ':'))[5]
                 WHEN alert.alert_type = 'dependency_unlocked'
                      AND array_length(string_to_array(alert.idempotency_key, ':'), 1) = 6
                      AND (string_to_array(alert.idempotency_key, ':'))[4] = ANY(item.rule_ids)
                   THEN (string_to_array(alert.idempotency_key, ':'))[4]
               END,
               (
                 SELECT rendering->>'headline_rule_id'
                   FROM jsonb_array_elements(coalesce(plan.verdict_detail->'finding_renderings', '[]'))
                        AS rendering
                  WHERE rendering->'rule_ids' = to_jsonb(item.rule_ids)
                    AND rendering->>'headline_rule_id' = ANY(item.rule_ids)
                  LIMIT 1
               ),
               CASE WHEN cardinality(item.rule_ids) = 1 THEN item.rule_ids[1] END
             ) AS rule_id
        FROM alerts AS alert
        JOIN checklist_items AS checklist ON checklist.id = alert.checklist_item_id
        JOIN permit_plan_items AS item ON item.id = checklist.plan_item_id
        JOIN permit_plans AS plan ON plan.id = item.plan_id
    )
    UPDATE alerts AS alert
       SET rule_id = attributed.rule_id
      FROM attributed
     WHERE alert.id = attributed.id;

    DO $$
    DECLARE ambiguous_ids text;
    BEGIN
      SELECT string_agg(id::text, ', ' ORDER BY id)
        INTO ambiguous_ids
        FROM alerts
       WHERE checklist_item_id IS NOT NULL
         AND (
           rule_id IS NULL
           OR (
             alert_type = 'deadline_reminder'
             AND coalesce((string_to_array(idempotency_key, ':'))[4], '') !~ '^[0-9]+$'
           )
         );
      IF ambiguous_ids IS NOT NULL THEN
        RAISE EXCEPTION 'migration 016 cannot safely attribute or rekey alerts: %', ambiguous_ids;
      END IF;
    END $$;

    CREATE TEMP TABLE alert_rule_identity_016 ON COMMIT DROP AS
    SELECT alert.id,
           alert.event_id::text || ':' || alert.alert_type || ':' ||
             CASE WHEN alert.alert_type = 'deadline_reminder'
                  THEN (string_to_array(alert.idempotency_key, ':'))[4] || ':'
                  ELSE '' END ||
             alert.rule_id || ':' || alert.channel || ':' ||
             (string_to_array(alert.idempotency_key, ':'))[
               array_length(string_to_array(alert.idempotency_key, ':'), 1)
             ] AS new_key,
           row_number() OVER (
             PARTITION BY alert.event_id, alert.alert_type,
               CASE WHEN alert.alert_type = 'deadline_reminder'
                    THEN (string_to_array(alert.idempotency_key, ':'))[4]
                    ELSE '' END,
               alert.rule_id, alert.channel,
               (string_to_array(alert.idempotency_key, ':'))[
                 array_length(string_to_array(alert.idempotency_key, ':'), 1)
             ]
             ORDER BY (alert.status = 'sent') DESC,
                      EXISTS (
                        SELECT 1 FROM alert_send_attempts AS attempt
                         WHERE attempt.alert_id = alert.id
                           AND attempt.outcome_recorded_at IS NULL
                           AND attempt.superseded_at IS NULL
                      ) DESC,
                      (
                        SELECT min(attempt.attempted_at)
                          FROM alert_send_attempts AS attempt
                         WHERE attempt.alert_id = alert.id
                           AND attempt.outcome_recorded_at IS NULL
                           AND attempt.superseded_at IS NULL
                      ) NULLS LAST,
                      (alert.status IN ('pending', 'failed')) DESC,
                      alert.sent_at NULLS LAST,
                      alert.id
           ) AS identity_rank,
           row_number() OVER (
             PARTITION BY alert.event_id, alert.alert_type,
               CASE WHEN alert.alert_type = 'deadline_reminder'
                    THEN (string_to_array(alert.idempotency_key, ':'))[4]
                    ELSE '' END,
               alert.rule_id, alert.channel,
               (string_to_array(alert.idempotency_key, ':'))[
                 array_length(string_to_array(alert.idempotency_key, ':'), 1)
               ]
             ORDER BY (alert.status IN ('pending', 'failed')) DESC, alert.id
           ) AS active_rank
      FROM alerts AS alert
     WHERE alert.checklist_item_id IS NOT NULL;

    UPDATE alerts AS winner
       SET checklist_item_id = active.checklist_item_id,
           send_at = active.send_at,
           status = active.status,
           sent_at = active.sent_at,
           failure_count = active.failure_count,
           next_attempt_at = active.next_attempt_at,
           payload = active.payload
      FROM alert_rule_identity_016 AS winner_identity
      JOIN alert_rule_identity_016 AS active_identity
        ON active_identity.new_key = winner_identity.new_key
       AND active_identity.active_rank = 1
      JOIN alerts AS active ON active.id = active_identity.id
     WHERE winner.id = winner_identity.id
       AND winner_identity.identity_rank = 1
       AND winner.id <> active.id
       AND winner.status <> 'sent'
       AND active.status IN ('pending', 'failed');

    UPDATE alerts AS alert
       SET status = 'cancelled'
      FROM alert_rule_identity_016 AS identity
     WHERE alert.id = identity.id
       AND identity.identity_rank > 1
       AND alert.status IN ('pending', 'failed');

    UPDATE alerts AS alert
       SET idempotency_key = identity.new_key
      FROM alert_rule_identity_016 AS identity
     WHERE alert.id = identity.id
       AND identity.identity_rank = 1;
  `);
  pgm.addConstraint("alerts", RULE_CONSTRAINT, {
    check: "checklist_item_id IS NULL OR rule_id IS NOT NULL",
  });
}

export function down(pgm: MigrationBuilder): void {
  pgm.dropConstraint("alerts", RULE_CONSTRAINT);
  pgm.sql(`
    CREATE TEMP TABLE alert_legacy_identity_016 ON COMMIT DROP AS
    SELECT alert.id,
             alert.event_id::text || ':' || alert.checklist_item_id::text || ':' ||
               alert.alert_type || ':' ||
               CASE WHEN alert.alert_type = 'deadline_reminder'
                    THEN (string_to_array(alert.idempotency_key, ':'))[3] || ':'
                    ELSE '' END ||
               CASE WHEN jsonb_array_length(coalesce(rendering.value->'routes', '[]')) >= 2
                    THEN alert.rule_id || ':'
                    ELSE '' END ||
               alert.channel || ':' ||
               (string_to_array(alert.idempotency_key, ':'))[
                 array_length(string_to_array(alert.idempotency_key, ':'), 1)
               ] AS old_key
        FROM alerts AS alert
        JOIN checklist_items AS checklist ON checklist.id = alert.checklist_item_id
        JOIN permit_plan_items AS item ON item.id = checklist.plan_item_id
        JOIN permit_plans AS plan ON plan.id = item.plan_id
        LEFT JOIN LATERAL jsonb_array_elements(
          coalesce(plan.verdict_detail->'finding_renderings', '[]')
        ) AS rendering(value) ON rendering.value->'rule_ids' = to_jsonb(item.rule_ids)
       WHERE split_part(alert.idempotency_key, ':', 2) = alert.alert_type
    ;

    DO $$
    DECLARE live_collisions text;
    BEGIN
      SELECT string_agg(occupied.id::text, ', ' ORDER BY occupied.id)
        INTO live_collisions
        FROM alert_legacy_identity_016 AS legacy
        JOIN alerts AS occupied ON occupied.idempotency_key = legacy.old_key
                               AND occupied.id <> legacy.id
       WHERE occupied.status <> 'cancelled';
      IF live_collisions IS NOT NULL THEN
        RAISE EXCEPTION 'migration 016 cannot safely restore legacy alert keys: %', live_collisions;
      END IF;
    END $$;

    UPDATE alerts AS occupied
       SET idempotency_key = occupied.idempotency_key || ':superseded-016:' || occupied.id::text
      FROM alert_legacy_identity_016 AS legacy
     WHERE occupied.idempotency_key = legacy.old_key
       AND occupied.id <> legacy.id
       AND occupied.status = 'cancelled';

    UPDATE alerts AS alert
       SET idempotency_key = legacy.old_key
      FROM alert_legacy_identity_016 AS legacy
     WHERE alert.id = legacy.id;
  `);
  pgm.dropColumn("alerts", "rule_id");
}
