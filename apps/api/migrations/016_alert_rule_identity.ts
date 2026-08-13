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
           ) AS identity_rank
      FROM alerts AS alert
     WHERE alert.checklist_item_id IS NOT NULL;

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
    WITH legacy_keys AS (
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
    )
    UPDATE alerts AS alert
       SET idempotency_key = legacy.old_key
      FROM legacy_keys AS legacy
     WHERE alert.id = legacy.id;
  `);
  pgm.dropColumn("alerts", "rule_id");
}
