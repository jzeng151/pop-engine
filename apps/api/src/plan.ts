// F-201 plan generation: read the event row, evaluate it with the pure engine, and store an
// immutable plan snapshot (AD-7). All database and clock access lives here, never in the engine.

import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { compareToPinned, evaluate } from "@pop-engine/engine";
import type {
  EngineRuleset,
  EventIntake,
  Finding,
  HolidayCalendar,
  IntakeValue,
  PermitPlan,
} from "@pop-engine/engine";

type StoredFinding = Finding & { readonly lastVerifiedDate: string | null };

/**
 * A stored plan whose items no longer match what was written. F-201 AC 5: a partial plan is never
 * presented as complete, so a read that cannot rebuild every finding fails instead of returning
 * the survivors with the original verdict — which would look like a complete, cheaper plan.
 */
export class PlanIntegrityError extends Error {
  constructor(planId: string, detail: string) {
    super(`stored plan ${planId} is incomplete: ${detail}`);
    this.name = "PlanIntegrityError";
  }
}

export class EventNotFoundError extends Error {
  constructor(eventId: string) {
    super(`event ${eventId} not found`);
    this.name = "EventNotFoundError";
  }
}

/**
 * A generation that would rebuild a plan from a ruleset older than the one the plan it supersedes
 * pinned (F-201 AC 12). The superseded plan was shown to an organizer, so a requirement that only
 * the newer ruleset publishes would disappear from a replacement that looks internally consistent
 * and says nothing about its basis having got worse.
 *
 * Both versions and the direction ride on the error rather than only in prose: an endpoint that
 * fails closed and cannot be diagnosed is its own harm, and the one thing an operator needs to know
 * is which two rulesets are involved and which way round they stand.
 */
export class PlanRulesetDowngradeError extends Error {
  constructor(
    readonly rulesetVersion: string,
    readonly pinnedRulesetVersion: string,
    readonly standing: "older" | "different",
  ) {
    super(
      standing === "older"
        ? `plan generation refused: the latest plan for this event pinned ruleset ${pinnedRulesetVersion}, ` +
            `and this service is running ${rulesetVersion}, which is older. Regenerating would rebuild the ` +
            `plan from superseded rules and can drop a requirement the organizer was already shown. ` +
            `Generate again from a service running ${pinnedRulesetVersion} or newer.`
        : `plan generation refused: the latest plan for this event pinned ruleset ${pinnedRulesetVersion}, ` +
            `this service is running ${rulesetVersion}, and the two cannot be ordered. Nothing establishes ` +
            `that regenerating would not move the plan backwards, so it is refused. Generate again from a ` +
            `service running ${pinnedRulesetVersion} or a later version of it.`,
    );
    this.name = "PlanRulesetDowngradeError";
  }
}

const VERDICT_COLUMN_VALUE = {
  FEASIBLE: "feasible",
  FEASIBLE_AT_RISK: "feasible_at_risk",
  CONDITIONAL: "conditional",
  INFEASIBLE: "infeasible",
} as const;

export type StoredPlan = {
  readonly id: string;
  readonly eventId: string;
  readonly eventRevision: number;
  readonly rulesetVersion: string;
  /**
   * The publication date of the ruleset that produced this plan, pinned with the version at
   * generation (F-206 AC 4). The two travel together: the banner states this date, never the live
   * file's, because a pinned version beside the live file's date is a pair that never existed.
   * Null on plans generated before migration 002 added the column, and left null — no derivation
   * can witness which artifact those plans read.
   */
  readonly snapshotDate: string | null;
  readonly verdict: PermitPlan["verdict"];
  readonly verdictDetail: PermitPlan["verdictDetail"];
  readonly today: string;
  readonly calendarId: string;
  readonly generatedAt: string;
  readonly findings: readonly StoredFinding[];
};

export type PlanService = {
  generate(eventId: string): Promise<StoredPlan>;
  latest(eventId: string): Promise<StoredPlan | null>;
};

/**
 * node-postgres materializes a PostgreSQL `date` at LOCAL midnight. `toISOString()` on that value
 * shifts it to the previous calendar day anywhere east of UTC, which would move every computed
 * deadline by a day and can turn an on-track window into a missed one. Read the local calendar
 * components instead, which recover the stored `YYYY-MM-DD` in any timezone.
 */
const pad = (value: number): string => String(value).padStart(2, "0");

export function calendarDateFrom(value: Date | string): string {
  if (typeof value === "string") return value.slice(0, 10);
  return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
}

/** `date` columns arrive as Date objects and `numeric` columns as strings; the registry says which is which. */
function intakeFromEventRow(row: Record<string, unknown>, ruleset: EngineRuleset): EventIntake {
  const intake: Record<string, IntakeValue> = {};
  for (const field of ruleset.intakeFields) {
    const value = row[field.field];
    if (value === undefined) continue;
    if (value instanceof Date) {
      intake[field.field] = calendarDateFrom(value);
    } else if (typeof value === "string" && (field.type === "number" || field.type === "integer")) {
      intake[field.field] = Number(value);
    } else {
      intake[field.field] = value as IntakeValue;
    }
  }
  return intake;
}

/**
 * Per-finding text the plan-item table has no column for: the published notes, an
 * OFFICIAL_CONFLICT rule's two readings, and the deadline's display string. AC 2 requires all
 * three to render on every read, migration 001 is merged and immutable, and a feature branch
 * does not add columns (AGENTS.md), so they ride in the plan's verdict_detail and are zipped
 * back onto the items by rule ids. Reported on the PR as a schema gap for a later migration.
 */
export type FindingRendering = {
  rule_ids: readonly string[];
  notes: readonly string[];
  note_text: string | null;
  conflict_text: string | null;
  deadline_display: string | null;
  slack_days: number | null;
  deadline_unknown_fields: readonly string[];
  timeline_unresolved_reason: string | null;
  portal_instructions: string | null;
  /** Absent on plans stored before organizer summaries were introduced. */
  user_summary?: Finding["userSummary"];
};

const renderingOf = (finding: Finding): FindingRendering => ({
  rule_ids: finding.ruleIds,
  notes: finding.notes,
  note_text: finding.noteText,
  conflict_text: finding.conflictText,
  deadline_display: finding.deadlineDisplay,
  slack_days: finding.slackDays,
  deadline_unknown_fields: finding.deadlineUnknownFields,
  timeline_unresolved_reason: finding.timelineUnresolvedReason,
  portal_instructions: finding.portalInstructions,
  user_summary: finding.userSummary ?? null,
});

export const renderingKey = (ruleIds: readonly string[]): string => ruleIds.join(",");

async function insertPlan(
  client: PoolClient,
  eventId: string,
  eventRevision: number,
  intake: EventIntake,
  plan: PermitPlan,
  snapshotDate: string,
): Promise<{ id: string; generatedAt: string }> {
  const planId = randomUUID();
  const { rows } = await client.query<{ generated_at: Date }>(
    `INSERT INTO permit_plans
       (id, event_id, event_revision, ruleset_version, snapshot_date, verdict, verdict_detail,
        intake_snapshot)
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb)
     RETURNING generated_at`,
    [
      planId,
      eventId,
      eventRevision,
      plan.rulesetVersion,
      // Written with the version, not after it. A plan generated between this migration and the
      // banner reading the column would otherwise store NULL permanently, and nothing later can
      // recover which snapshot date it was evaluated against.
      snapshotDate,
      VERDICT_COLUMN_VALUE[plan.verdict],
      JSON.stringify({
        ...plan.verdictDetail,
        today: plan.today,
        calendar_id: plan.calendarId,
        finding_renderings: plan.findings.map(renderingOf),
      }),
      JSON.stringify(intake),
    ],
  );

  for (const finding of plan.findings) {
    await client.query(
      `INSERT INTO permit_plan_items
         (id, plan_id, rule_ids, triggered_by, permit_name, agency, deadline, latest_apply_date,
          apply_after_date, fee_display, required_documents, portal_name, portal_url, sources,
          source_url, last_verified_date, kind, disposition, deadline_status, verification_status)
       VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7::jsonb, $8, $9, $10, $11::jsonb, $12, $13, $14::jsonb,
               $15, $16, $17, $18, $19, $20)`,
      [
        randomUUID(),
        planId,
        finding.ruleIds,
        JSON.stringify(finding.triggeredBy),
        finding.name,
        finding.agency,
        finding.deadline === null ? null : JSON.stringify(finding.deadline),
        finding.latestApplyDate,
        finding.applyAfterDate,
        finding.feeDisplay,
        // No published rule lists required documents, and the engine may not invent any.
        null,
        finding.portalName,
        finding.portalUrl,
        JSON.stringify(finding.sources),
        finding.sources[0]?.urls[0] ?? null,
        finding.lastVerifiedDate ?? null,
        finding.kind,
        finding.disposition,
        finding.deadlineStatus,
        finding.verificationStatus,
      ],
    );
  }

  return { id: planId, generatedAt: (rows[0]?.generated_at ?? new Date()).toISOString() };
}

/**
 * Serializes this generation against every other generation for the same event.
 *
 * The precondition below is a read followed by a write, so it is only a guard if nothing can
 * commit a plan in between, which is the exact defect it replaces, where the browser decided on
 * reads that had already returned. `permit_plans` has no row to lock (the offending row is the one
 * that does not exist yet) and a feature branch adds no constraint, so the lock goes on the parent
 * `events` row, which every generation for this event must take. Under READ COMMITTED a generation
 * that blocks here re-reads on a fresh snapshot once the holder commits, so the competing plan is
 * visible to the check below. SERIALIZABLE would also close it, at the cost of 40001 retries on an
 * endpoint that writes an immutable row, which is a worse trade for one lock on one row.
 */
async function lockEventForGeneration(client: PoolClient, eventId: string): Promise<void> {
  await client.query("SELECT id FROM events WHERE id = $1 FOR UPDATE", [eventId]);
}

/**
 * F-201 AC 12. Refuses when this service's ruleset is older than the version the latest stored plan
 * pinned, or when the two cannot be ordered at all.
 *
 * Unorderable pairs (a second jurisdiction, an unparseable version) are refused rather than
 * allowed. Allowing them reopens the hole this exists to close, and the failure it prevents is
 * silently dropping a regulatory requirement an organizer was already shown. The cost is a lane
 * that fails closed after a jurisdiction rename until a plan is pinned to the new prefix, and that
 * cost is paid down by the error naming both versions and the direction rather than reading as a
 * generic failure.
 */
async function refuseRulesetDowngrade(
  client: PoolClient,
  eventId: string,
  rulesetVersion: string,
): Promise<void> {
  const { rows } = await client.query<{ ruleset_version: string }>(
    `SELECT ruleset_version FROM permit_plans WHERE event_id = $1
      ORDER BY generated_at DESC, id DESC LIMIT 1`,
    [eventId],
  );
  const pinned = rows[0]?.ruleset_version;
  // No stored plan means nothing to supersede: a first plan is safe on any ruleset.
  if (pinned === undefined) return;

  const standing = compareToPinned(rulesetVersion, pinned);
  if (standing === "older" || standing === "different") {
    throw new PlanRulesetDowngradeError(rulesetVersion, pinned, standing);
  }
}

export function createPlanService(
  pool: Pool,
  ruleset: EngineRuleset,
  // Resolved per generation so a plan always records the calendar state it actually evaluated
  // against. When the pinned calendar has no published holiday list, the engine renders only the
  // findings that need business-day math as NOT_CALCULABLE; the rest of the plan still computes.
  resolveCalendar: (calendarId: string) => HolidayCalendar,
  today: () => string,
): PlanService {
  const loadEvent = async (eventId: string): Promise<Record<string, unknown>> => {
    const { rows } = await pool.query<Record<string, unknown>>(
      "SELECT * FROM events WHERE id = $1",
      [eventId],
    );
    const row = rows[0];
    if (row === undefined) throw new EventNotFoundError(eventId);
    return row;
  };

  return {
    async generate(eventId) {
      const row = await loadEvent(eventId);
      const intake = intakeFromEventRow(row, ruleset);
      // Evaluation runs before the transaction opens: a rule-evaluation failure must surface
      // as an error, never as a stored plan with no findings (AC 5).
      const plan = evaluate(intake, ruleset, today(), resolveCalendar(ruleset.calendarId));
      const eventRevision = Number(row.revision_counter);

      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await lockEventForGeneration(client, eventId);
        await refuseRulesetDowngrade(client, eventId, ruleset.rulesetVersion);
        const { id, generatedAt } = await insertPlan(
          client,
          eventId,
          eventRevision,
          intake,
          plan,
          ruleset.snapshotDate,
        );
        await client.query("COMMIT");
        // The same value `insertPlan` just wrote, so the response a generation returns carries the
        // pinned pair the stored row does rather than leaving the caller to re-read it.
        return {
          id,
          eventId,
          eventRevision,
          generatedAt,
          snapshotDate: ruleset.snapshotDate,
          ...plan,
          findings: plan.findings.map((finding) => ({
            ...finding,
            userSummary: finding.userSummary ?? null,
            lastVerifiedDate: finding.lastVerifiedDate ?? null,
          })),
        };
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    },

    async latest(eventId) {
      await loadEvent(eventId);
      const { rows } = await pool.query<PlanRow>(
        `SELECT id, event_revision, ruleset_version, snapshot_date, verdict, verdict_detail,
                generated_at
           FROM permit_plans WHERE event_id = $1 ORDER BY generated_at DESC, id DESC LIMIT 1`,
        [eventId],
      );
      const planRow = rows[0];
      if (planRow === undefined) return null;

      const { rows: itemRows } = await pool.query<PlanItemRow>(
        `SELECT rule_ids, triggered_by, permit_name, agency, deadline, latest_apply_date, apply_after_date,
                fee_display, portal_name, portal_url, sources, last_verified_date, kind,
                disposition, deadline_status, verification_status
           FROM permit_plan_items WHERE plan_id = $1 ORDER BY id`,
        [planRow.id],
      );

      const {
        today,
        calendar_id: calendarId,
        finding_renderings: renderings,
        ...verdictDetail
      } = planRow.verdict_detail;
      const byRuleIds = new Map(itemRows.map((row) => [renderingKey(row.rule_ids), row]));
      if (itemRows.length !== renderings.length) {
        throw new PlanIntegrityError(
          planRow.id,
          `${renderings.length} findings were written, ${itemRows.length} are stored`,
        );
      }
      return {
        id: planRow.id,
        eventId,
        eventRevision: planRow.event_revision,
        rulesetVersion: planRow.ruleset_version,
        // Read off the plan's own row, beside the version it is paired with. `date` comes back as
        // a Date at local midnight, so the same calendar-component read every other date here
        // uses recovers the stored day in any timezone.
        snapshotDate: isoDate(planRow.snapshot_date),
        verdict: ENGINE_VERDICT[planRow.verdict],
        verdictDetail,
        today,
        calendarId,
        generatedAt: planRow.generated_at.toISOString(),
        // Ordered by the engine's finding order, which the renderings preserve: plan items
        // carry uuid primary keys, so the table itself has no stable order to read back.
        findings: renderings.map((rendering) => {
          const row = byRuleIds.get(renderingKey(rendering.rule_ids));
          if (row === undefined) {
            throw new PlanIntegrityError(
              planRow.id,
              `no stored item for finding ${renderingKey(rendering.rule_ids)}`,
            );
          }
          return findingFromRow(row, rendering);
        }),
      };
    },
  };
}

type PlanRow = {
  id: string;
  event_revision: number;
  ruleset_version: string;
  /** Null on plans generated before migration 002 added the column. */
  snapshot_date: Date | string | null;
  verdict: keyof typeof ENGINE_VERDICT;
  // `today` and the calendar id ride in verdict_detail: the plan must name the exact clock and
  // calendar it evaluated against to stay reproducible (AD-7), and the table has no column for them.
  verdict_detail: PermitPlan["verdictDetail"] & {
    today: string;
    calendar_id: string;
    finding_renderings: FindingRendering[];
  };
  generated_at: Date;
};

type PlanItemRow = {
  rule_ids: string[];
  triggered_by: Finding["triggeredBy"];
  permit_name: string | null;
  agency: string | null;
  deadline: Finding["deadline"];
  latest_apply_date: Date | string | null;
  apply_after_date: Date | string | null;
  fee_display: string | null;
  portal_name: string | null;
  portal_url: string | null;
  sources: Finding["sources"];
  last_verified_date: Date | string | null;
  kind: Finding["kind"];
  disposition: Finding["disposition"];
  deadline_status: Finding["deadlineStatus"];
  verification_status: Finding["verificationStatus"];
};

const ENGINE_VERDICT = {
  feasible: "FEASIBLE",
  feasible_at_risk: "FEASIBLE_AT_RISK",
  conditional: "CONDITIONAL",
  infeasible: "INFEASIBLE",
} as const;

const isoDate = (value: Date | string | null): string | null =>
  value === null ? null : calendarDateFrom(value);

/** The persisted columns rebuild the finding a client reads; snake_case stays inside this file. */
function findingFromRow(row: PlanItemRow, rendering: FindingRendering): StoredFinding {
  return {
    ruleIds: row.rule_ids,
    kind: row.kind,
    disposition: row.disposition,
    name: row.permit_name,
    agency: row.agency,
    deadline: row.deadline,
    deadlineDisplay: rendering.deadline_display,
    latestApplyDate: isoDate(row.latest_apply_date),
    applyAfterDate: isoDate(row.apply_after_date),
    deadlineStatus: row.deadline_status,
    slackDays: rendering.slack_days,
    feeDisplay: row.fee_display,
    portalName: row.portal_name,
    portalUrl: row.portal_url,
    portalInstructions: rendering.portal_instructions,
    notes: rendering.notes,
    noteText: rendering.note_text,
    deadlineUnknownFields: rendering.deadline_unknown_fields,
    timelineUnresolvedReason: rendering.timeline_unresolved_reason,
    conflictText: rendering.conflict_text,
    sources: row.sources,
    userSummary: rendering.user_summary ?? null,
    verificationStatus: row.verification_status,
    lastVerifiedDate: isoDate(row.last_verified_date),
    triggeredBy: row.triggered_by,
  };
}
