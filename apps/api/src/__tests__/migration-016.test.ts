import type { MigrationBuilder } from "node-pg-migrate";
import { Client } from "pg";
import { describe, expect, it, vi } from "vitest";
import { down, up } from "../../migrations/016_alert_rule_identity";

const databaseUrl = process.env.DATABASE_URL ?? "";

const migrationSql = (): string => {
  const sql = vi.fn();
  up({ addColumn: vi.fn(), sql, addConstraint: vi.fn() } as unknown as MigrationBuilder);
  return String(sql.mock.calls[0]?.[0]);
};

describe("migration 016", () => {
  it("backfills and rekeys item alerts without guessing an ambiguous rule", () => {
    const addColumn = vi.fn();
    const sql = vi.fn();
    const addConstraint = vi.fn();

    up({ addColumn, sql, addConstraint } as unknown as MigrationBuilder);

    expect(addColumn).toHaveBeenCalledWith("alerts", { rule_id: { type: "text" } });
    const backfill = String(sql.mock.calls[0]?.[0]);
    expect(backfill).toContain("rendering->>'headline_rule_id'");
    expect(backfill).toContain("cardinality(item.rule_ids) = 1");
    expect(backfill).toContain("migration 016 cannot safely attribute or rekey alerts");
    expect(backfill).toContain("ORDER BY (alert.status = 'sent') DESC");
    expect(backfill).toContain("FROM alert_send_attempts AS attempt");
    expect(addConstraint).toHaveBeenCalledWith("alerts", "alerts_item_rule_required", {
      check: "checklist_item_id IS NULL OR rule_id IS NOT NULL",
    });
  });

  it("restores task-based keys only while writers are stopped", () => {
    const dropConstraint = vi.fn();
    const sql = vi.fn();
    const dropColumn = vi.fn();

    down({ dropConstraint, sql, dropColumn } as unknown as MigrationBuilder);

    expect(dropConstraint).toHaveBeenCalledWith("alerts", "alerts_item_rule_required");
    expect(String(sql.mock.calls[0]?.[0])).toContain("alert.checklist_item_id::text");
    expect(dropColumn).toHaveBeenCalledWith("alerts", "rule_id");
  });
});

describe.runIf(databaseUrl.length > 0)("migration 016 data rewrite", () => {
  const seedTables = async (client: Client): Promise<void> => {
    await client.query(`
      CREATE TEMP TABLE alerts (
        id text, event_id text, checklist_item_id text, rule_id text, alert_type text,
        idempotency_key text, channel text, status text, sent_at timestamptz
      );
      CREATE TEMP TABLE checklist_items (id text, plan_item_id text);
      CREATE TEMP TABLE permit_plan_items (id text, plan_id text, rule_ids text[]);
      CREATE TEMP TABLE permit_plans (id text, verdict_detail jsonb);
      CREATE TEMP TABLE alert_send_attempts (
        alert_id text, idempotency_key text, attempted_at timestamptz,
        outcome_recorded_at timestamptz, superseded_at timestamptz
      );
    `);
  };

  it("keeps the sent row when task keys converge and keeps different rules separate", async () => {
    const client = new Client({ connectionString: databaseUrl });
    await client.connect();
    try {
      await seedTables(client);
      await client.query(`
        INSERT INTO permit_plans VALUES
          ('plan-a', '{"finding_renderings":[]}'::jsonb),
          ('plan-b', '{"finding_renderings":[]}'::jsonb),
          ('plan-c', '{"finding_renderings":[]}'::jsonb);
        INSERT INTO permit_plan_items VALUES
          ('item-a', 'plan-a', ARRAY['RULE-A']),
          ('item-b', 'plan-b', ARRAY['RULE-A']),
          ('item-c', 'plan-c', ARRAY['RULE-B']);
        INSERT INTO checklist_items VALUES
          ('task-a', 'item-a'), ('task-b', 'item-b'), ('task-c', 'item-c');
        INSERT INTO alerts VALUES
          ('pending-a', 'event', 'task-a', NULL, 'deadline_reminder',
           'event:task-a:deadline_reminder:7:email:digest', 'email', 'pending', NULL),
          ('sent-a', 'event', 'task-b', NULL, 'deadline_reminder',
           'event:task-b:deadline_reminder:7:email:digest', 'email', 'sent', current_timestamp),
          ('pending-b', 'event', 'task-c', NULL, 'deadline_reminder',
           'event:task-c:deadline_reminder:7:email:digest', 'email', 'pending', NULL);
      `);

      await client.query(migrationSql());
      const { rows } = await client.query(
        "SELECT id, rule_id, idempotency_key, status FROM alerts ORDER BY id",
      );
      expect(rows).toEqual([
        {
          id: "pending-a",
          rule_id: "RULE-A",
          idempotency_key: "event:task-a:deadline_reminder:7:email:digest",
          status: "cancelled",
        },
        {
          id: "pending-b",
          rule_id: "RULE-B",
          idempotency_key: "event:deadline_reminder:7:RULE-B:email:digest",
          status: "pending",
        },
        {
          id: "sent-a",
          rule_id: "RULE-A",
          idempotency_key: "event:deadline_reminder:7:RULE-A:email:digest",
          status: "sent",
        },
      ]);
    } finally {
      await client.end();
    }
  });

  it("keeps an unresolved attempt on the canonical unsent row", async () => {
    const client = new Client({ connectionString: databaseUrl });
    await client.connect();
    try {
      await seedTables(client);
      await client.query(`
        INSERT INTO permit_plans VALUES
          ('plan-a', '{"finding_renderings":[]}'::jsonb),
          ('plan-b', '{"finding_renderings":[]}'::jsonb);
        INSERT INTO permit_plan_items VALUES
          ('item-a', 'plan-a', ARRAY['RULE-A']),
          ('item-b', 'plan-b', ARRAY['RULE-A']);
        INSERT INTO checklist_items VALUES ('task-a', 'item-a'), ('task-b', 'item-b');
        INSERT INTO alerts VALUES
          ('ordinary', 'event', 'task-a', NULL, 'deadline_reminder',
           'event:task-a:deadline_reminder:7:email:digest', 'email', 'pending', NULL),
          ('attempted', 'event', 'task-b', NULL, 'deadline_reminder',
           'event:task-b:deadline_reminder:7:email:digest', 'email', 'pending', NULL);
        INSERT INTO alert_send_attempts VALUES
          ('attempted', 'event:task-b:deadline_reminder:7:email:digest',
           current_timestamp, NULL, NULL);
      `);

      await client.query(migrationSql());
      const { rows } = await client.query(
        "SELECT id, idempotency_key, status FROM alerts ORDER BY id",
      );
      expect(rows).toEqual([
        {
          id: "attempted",
          idempotency_key: "event:deadline_reminder:7:RULE-A:email:digest",
          status: "pending",
        },
        {
          id: "ordinary",
          idempotency_key: "event:task-a:deadline_reminder:7:email:digest",
          status: "cancelled",
        },
      ]);
    } finally {
      await client.end();
    }
  });

  it("rejects a historical multi-rule row with no recorded attribution", async () => {
    const client = new Client({ connectionString: databaseUrl });
    await client.connect();
    try {
      await seedTables(client);
      await client.query(`
        INSERT INTO permit_plans VALUES
          ('plan', '{"finding_renderings":[{"rule_ids":["RULE-A","RULE-B"]}]}'::jsonb);
        INSERT INTO permit_plan_items VALUES
          ('item', 'plan', ARRAY['RULE-A', 'RULE-B']);
        INSERT INTO checklist_items VALUES ('task', 'item');
        INSERT INTO alerts VALUES
          ('ambiguous', 'event', 'task', NULL, 'deadline_reminder',
           'event:task:deadline_reminder:7:email:digest', 'email', 'pending', NULL);
      `);

      await expect(client.query(migrationSql())).rejects.toThrow(
        /migration 016 cannot safely attribute or rekey alerts: ambiguous/,
      );
    } finally {
      await client.end();
    }
  });
});
