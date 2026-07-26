// F-202 compliance checklist + document uploads (ARCHITECTURE.md API Surface).
//
// The checklist is the execution view of a plan: one trackable row per permit/insurance line
// of the latest plan, each still linked to the plan item it came from, so rule, deadline,
// citation and portal travel with the work (spec AC 1).
//
// Plans are immutable snapshots (AD-7), so a rescope produces a NEW plan rather than editing the
// old one. Supersession is therefore a relationship between two plans, not a flag on either, and
// this file returns it as explicit fields (`planChanged`, `inLatestPlan`, `planStale`) so a client
// renders rather than re-derives it. Nothing is ever deleted or rewritten (spec AC 6).
//
// The two are answered from different places, deliberately. `inLatestPlan` is per row, so it is a
// comparison against the latest plan's items. `planChanged` is about the plan as a whole and is
// answered from `checklist_acknowledgements` — which plan the organizer last converted — because
// the checklist's own rows cannot answer it: a regeneration that removes every trackable
// requirement leaves nothing to compare, and that is the case the prompt most needs to fire in.

import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import { Router, type NextFunction, type Request, type Response } from "express";
import { DatabaseError } from "pg";
import type { Pool, PoolClient, QueryResult, QueryResultRow } from "pg";
import { CHECKLIST_STATUSES } from "@pop-engine/engine";
import type {
  ChecklistStatus,
  Deadline,
  Disposition,
  DeadlineStatus,
  Finding,
  FindingKind,
  VerificationStatus,
} from "@pop-engine/engine";
import { calendarDateFrom, renderingKey, PlanIntegrityError, type FindingRendering } from "./plan";
import { DocumentStorageError, type DocumentStorage } from "./storage";

const isChecklistStatus = (value: unknown): value is ChecklistStatus =>
  typeof value === "string" && (CHECKLIST_STATUSES as readonly string[]).includes(value);

/**
 * Only permit and insurance lines become trackable tasks; every other finding kind renders as
 * read-only context (spec: "one per permit/insurance plan item; advisories render as read-only
 * context, not trackable tasks"). Kinds themselves come from the engine, never a local copy.
 */
const TRACKABLE_FINDING_KINDS: ReadonlySet<FindingKind> = new Set<FindingKind>([
  "permit",
  "insurance",
]);

/** Spec AC 3: PDF/PNG/JPG up to 10 MB. */
const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;

/**
 * The accepted upload types, each with the byte prefix its format is required to start with.
 * A `Content-Type` header is a claim by the caller, so the bytes are checked against it: an
 * executable renamed and announced as a PDF must not reach the bucket.
 */
const DOCUMENT_TYPES = {
  "application/pdf": { extension: "pdf", signature: [0x25, 0x50, 0x44, 0x46] },
  "image/png": { extension: "png", signature: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
  "image/jpeg": { extension: "jpg", signature: [0xff, 0xd8, 0xff] },
} as const satisfies Record<string, { extension: string; signature: readonly number[] }>;

type DocumentContentType = keyof typeof DOCUMENT_TYPES;

const DOCUMENT_CONTENT_TYPES = Object.keys(DOCUMENT_TYPES) as DocumentContentType[];

/** Enough of the body to hold the longest signature above, and no more. */
const SIGNATURE_BYTES = Math.max(
  ...Object.values(DOCUMENT_TYPES).map((type) => type.signature.length),
);

/**
 * Long enough for a browser to follow the redirect and download, short enough that a URL that
 * leaks (chat history, a proxy log) is dead by the time anyone reuses it. Not a regulatory
 * value; an engineering one.
 */
const DOWNLOAD_URL_TTL_SECONDS = 300;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type ChecklistDependencies = {
  database: Pool;
  storage: DocumentStorage;
};

type Queryable = {
  query<Row extends QueryResultRow>(text: string, values?: unknown[]): Promise<QueryResult<Row>>;
};

/**
 * A requirement's identity across plans. A regenerated plan writes new plan-item rows with new
 * uuids, so the stable identity of "the same requirement" is the set of rule ids behind it —
 * the same provenance `plan.ts` uses to zip findings back onto stored items.
 *
 * Identity is the WHOLE set, and partial overlap is deliberately not a match. Findings sharing a
 * `dedupe_key` merge into one line carrying every contributing rule id, so changing a dedupe key
 * (live on #89 for the two DOB structure rules) turns two lines into one or one into two. A
 * merged line asserts something neither contributing line did on its own — both citations, both
 * sources, a deadline resolved across both — so carrying a "submitted" over to it would claim
 * the organizer filed for a requirement whose scope had just changed. Under whole-set matching
 * the old items survive struck through with their status and documents, the new line is appended
 * untouched, and `planChanged` is true: a visible review rather than a silent wrong answer.
 *
 * Sorted, because merge order follows the rule file's order and is not part of what a requirement
 * IS. (`plan.ts` joins unsorted, which is correct there: it zips positionally against renderings
 * written by the same evaluation, where order is guaranteed. Across two plans it is not.)
 */
const requirementKey = (ruleIds: readonly string[]): string => [...ruleIds].sort().join(",");

type PlanItemRow = {
  id: string;
  plan_id: string;
  rule_ids: string[];
  permit_name: string | null;
  agency: string | null;
  kind: FindingKind;
  disposition: Disposition;
  deadline: Deadline | null;
  latest_apply_date: Date | string | null;
  apply_after_date: Date | string | null;
  deadline_status: DeadlineStatus;
  verification_status: VerificationStatus;
  fee_display: string | null;
  portal_name: string | null;
  portal_url: string | null;
  sources: Finding["sources"];
  source_url: string | null;
  last_verified_date: Date | string | null;
  source_ruleset_version: string;
  source_snapshot_date: Date | string | null;
};

const PLAN_ITEM_COLUMNS = `id, plan_id, rule_ids, permit_name, agency, kind, disposition, deadline,
   latest_apply_date, apply_after_date, deadline_status, verification_status, fee_display,
   portal_name, portal_url, sources, source_url, last_verified_date`;

/**
 * Plan items carry uuid primary keys, so the table has no stable order of its own (F-201 hit
 * the same wall reading plans back). The soonest published filing date first is both stable and
 * the order the work actually happens in; the trailing keys break ties for undated lines.
 */
const PLAN_ITEM_ORDER = `latest_apply_date NULLS LAST, permit_name, rule_ids`;

/**
 * The order of checklist rows created together, which is a different question.
 *
 * Every task of one materialization shares a `created_at` (Postgres fixes `current_timestamp` per
 * transaction), so this is not a tiebreak that rarely fires: it decides the whole order of a
 * cohort, and for a first checklist that is the entire list. It therefore may not read anything an
 * evaluation recomputes, and `latest_apply_date` is exactly that. `cohort_position` is the filing
 * order the requirement had when it became a task, written once and never rewritten (migration
 * 007), so the checklist still leads with the soonest deadline without re-reading a date that a
 * later plan moved.
 *
 * `rule_ids` last is what makes the order total, and is what rows predating migration 007 fall
 * through to: `materialize` keeps one row per requirement, so no two rows can share it.
 */
const CHECKLIST_COHORT_ORDER = `checklist.cohort_position, item.rule_ids`;

type ChecklistRow = PlanItemRow & {
  checklist_item_id: string;
  plan_item_id: string;
  status: ChecklistStatus;
  notes: string | null;
  updated_at: Date;
};

type DocumentRow = {
  id: string;
  checklist_item_id: string;
  filename: string;
  content_type: string;
  size_bytes: string;
  uploaded_at: Date;
};

const isoDate = (value: Date | string | null): string | null =>
  value === null ? null : calendarDateFrom(value);

/**
 * Shown on a row whose published filing date has moved since the organizer last worked it.
 *
 * Two sentences, on F-206's at-risk model: state the fact, attribute it, claim nothing further.
 * What it deliberately does not say is as load-bearing as what it does. Not "must", because the
 * product does not know the agency's position on an application already filed. Not that the
 * earlier application is void, for the same reason. Nothing that implies PopEngine files anything.
 * And it attributes the move to the plan changing rather than to the organizer changing their
 * event date: a regeneration moves filing dates for any intake edit that shifts a deadline, and
 * which field the organizer touched is not something this code can witness.
 */
export const REAPPLY_NOTICE =
  "This requirement's filing date moved when your plan changed. You will need to reapply.";

/**
 * The statuses the notice is worth showing on, derived from what "reapply" presupposes rather than
 * from how much work a status represents.
 *
 * F-202 AC 2 fixes the vocabulary (not_started → in_progress → submitted → approved / rejected, any
 * transition allowed) and says nothing about a notice, so this is a reading of the copy against it:
 *
 *  - `submitted` is the sharpest case and the reason this exists: an application is with the agency,
 *    filed against a date that no longer applies.
 *  - `approved` holds a decision made against that same date, so the moved date reaches it too.
 *  - `in_progress` is excluded. Work is invested, but nothing has been filed, so "reapply" would be
 *    false on its face, and the row already displays the new date, which is what that organizer
 *    needs.
 *  - `not_started` is excluded: nothing was invested.
 *  - `rejected` is excluded, which is the one that is not obvious. They did apply, so "reapply" is
 *    grammatical, but there is no live application the moved date disturbs, and whether to file
 *    again was already open because of the rejection. Showing it here would attribute that decision
 *    to the date change, which is not its cause.
 */
const REAPPLY_NOTICE_STATUSES: ReadonlySet<ChecklistStatus> = new Set<ChecklistStatus>([
  "submitted",
  "approved",
]);

/** One plan of an event, with the filing date it published for each requirement. */
type PlanSnapshot = {
  generatedAt: Date;
  dateByRequirement: Map<string, string | null>;
};

/**
 * Every plan of the event, oldest first, so a row can be read against the plan that was current
 * when the organizer last worked it.
 *
 * No column records the date they were working to, and none is added, because nothing needs one:
 * plans are immutable and never deleted (AD-7), so the whole history of published filing dates is
 * already in `permit_plans` and `permit_plan_items`. Keyed by requirement rather than by plan item
 * id, because a regeneration writes new item rows and the requirement is what persists across them.
 */
async function planHistory(database: Queryable, eventId: string): Promise<PlanSnapshot[]> {
  const { rows } = await database.query<{
    id: string;
    generated_at: Date;
    rule_ids: string[];
    latest_apply_date: Date | string | null;
  }>(
    `SELECT plan.id, plan.generated_at, item.rule_ids, item.latest_apply_date
       FROM permit_plans AS plan
       JOIN permit_plan_items AS item ON item.plan_id = plan.id
      WHERE plan.event_id = $1
      ORDER BY plan.generated_at, plan.id`,
    [eventId],
  );
  const byPlan = new Map<string, PlanSnapshot>();
  for (const row of rows) {
    let snapshot = byPlan.get(row.id);
    if (snapshot === undefined) {
      snapshot = { generatedAt: row.generated_at, dateByRequirement: new Map() };
      byPlan.set(row.id, snapshot);
    }
    snapshot.dateByRequirement.set(requirementKey(row.rule_ids), isoDate(row.latest_apply_date));
  }
  return [...byPlan.values()];
}

/**
 * The filing date this row was showing the last time the organizer worked it.
 *
 * This is the comparison the notice needs, and the row's own plan item is NOT it. That item is
 * whichever plan last raised the requirement before a re-materialize re-pointed it, which is only
 * the date they worked against if they last worked the row before any regeneration. Comparing it
 * against the newest plan instead resurrects the notice: once any later plan exists, a guard on
 * "did they work this before the current plan" is true again while the row still points at the
 * original date, so a regeneration that moved nothing since they filed asks them to act on nothing
 * (#117 review round 1).
 *
 * So the plan is chosen the way the view chose it at that moment: the latest plan generated at or
 * before they last worked the row, and within it the item for this requirement. A plan that did not
 * raise the requirement falls back to the row's own item, which is exactly what the view rendered
 * then (`current ?? item`).
 */
function dateWhenLastWorked(
  history: readonly PlanSnapshot[],
  row: ChecklistRow,
  lastWorked: Date,
): string | null {
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const snapshot = history[index] as PlanSnapshot;
    if (snapshot.generatedAt.getTime() > lastWorked.getTime()) continue;
    const published = snapshot.dateByRequirement.get(requirementKey(row.rule_ids));
    return published === undefined ? isoDate(row.latest_apply_date) : published;
  }
  return isoDate(row.latest_apply_date);
}

/**
 * Whether the filing date moved since the organizer last worked the row.
 *
 * Both dates must exist. A requirement whose deadline became RESEARCH_REQUIRED has no date to have
 * moved, and "you will need to reapply" is not what that change means.
 *
 * An organizer who works the row after a regeneration was looking at the new date as they did it,
 * so from that point the two are equal and the notice stops on its own. The cost is that any edit,
 * a note included, reads as having seen the current date. That direction is the safe one: this copy
 * asks someone to file again, so not claiming is better than claiming wrongly.
 */
const filingDateMoved = (workedAgainst: string | null, now: string | null): boolean =>
  workedAgainst !== null && now !== null && workedAgainst !== now;

/**
 * The plan context a checklist row renders: deadline, agency, portal, verification badge — and
 * every published qualification that goes with them.
 *
 * A date and a status are not the whole regulatory answer. A `research_required` deadline has no
 * date at all and its meaning lives entirely in the published notes ("confirm the lead time with
 * the agency"); an OFFICIAL_CONFLICT line means nothing without both readings and both sources.
 * Dropping any of that renders an unresolved requirement as a resolved one, which AGENTS.md
 * forbids end to end. The persisted rendering fields ride in the plan's `verdict_detail` because
 * the item table has no columns for them (see `plan.ts`); they are carried through here rather
 * than restated, so there is one copy of each string.
 */
const planContext = (item: PlanItemRow, rendering: FindingRendering) => ({
  ruleIds: item.rule_ids,
  permitName: item.permit_name,
  agency: item.agency,
  kind: item.kind,
  disposition: item.disposition,
  deadline: item.deadline,
  deadlineDisplay: rendering.deadline_display,
  latestApplyDate: isoDate(item.latest_apply_date),
  applyAfterDate: isoDate(item.apply_after_date),
  deadlineStatus: item.deadline_status,
  slackDays: rendering.slack_days,
  deadlineUnknownFields: rendering.deadline_unknown_fields,
  timelineUnresolvedReason: rendering.timeline_unresolved_reason,
  verificationStatus: item.verification_status,
  lastVerifiedDate: isoDate(item.last_verified_date),
  // `publishedNotes`, not `notes`: a checklist item already has `notes`, and those are the
  // organizer's. Published regulatory text and a user's scratchpad must never share a field.
  publishedNotes: rendering.notes,
  noteText: rendering.note_text,
  // Both readings of an OFFICIAL_CONFLICT rule; never resolved to one silently.
  conflictText: rendering.conflict_text,
  feeDisplay: item.fee_display,
  portalName: item.portal_name,
  portalUrl: item.portal_url,
  portalInstructions: rendering.portal_instructions,
  sources: item.sources,
  sourceUrl: item.source_url,
  sourcePlan: {
    rulesetVersion: item.source_ruleset_version,
    snapshotDate: isoDate(item.source_snapshot_date),
  },
});

type LatestPlan = {
  id: string;
  rulesetVersion: string;
  snapshotDate: string | null;
  /** The `events.revision_counter` this plan evaluated (AD-13). */
  eventRevision: number;
  /** The event's revision now. Higher than `eventRevision` means the plan is stale. */
  currentRevision: number;
};

async function latestPlan(database: Queryable, eventId: string): Promise<LatestPlan | null> {
  const { rows } = await database.query<{
    id: string;
    ruleset_version: string;
    snapshot_date: Date | string | null;
    event_revision: number;
    revision_counter: number;
  }>(
    `SELECT plan.id, plan.ruleset_version, plan.snapshot_date, plan.event_revision,
            event.revision_counter
       FROM permit_plans AS plan
       JOIN events AS event ON event.id = plan.event_id
      WHERE plan.event_id = $1
      ORDER BY plan.generated_at DESC, plan.id DESC LIMIT 1`,
    [eventId],
  );
  const row = rows[0];
  if (row === undefined) return null;
  return {
    id: row.id,
    rulesetVersion: row.ruleset_version,
    snapshotDate: isoDate(row.snapshot_date),
    eventRevision: row.event_revision,
    currentRevision: row.revision_counter,
  };
}

/**
 * The per-finding text each plan persists in `verdict_detail` (see `plan.ts`), keyed by plan and
 * by the rule ids of the finding it belongs to.
 */
async function renderingsFor(
  database: Queryable,
  planIds: readonly string[],
): Promise<Map<string, FindingRendering>> {
  const byPlanAndRules = new Map<string, FindingRendering>();
  if (planIds.length === 0) return byPlanAndRules;
  const { rows } = await database.query<{
    id: string;
    finding_renderings: FindingRendering[] | null;
  }>(
    `SELECT id, verdict_detail->'finding_renderings' AS finding_renderings
       FROM permit_plans WHERE id = ANY($1)`,
    [planIds],
  );
  for (const row of rows) {
    for (const rendering of row.finding_renderings ?? []) {
      byPlanAndRules.set(`${row.id}:${renderingKey(rendering.rule_ids)}`, rendering);
    }
  }
  return byPlanAndRules;
}

/**
 * A plan item whose published text cannot be found is a partial answer, and F-201 AC 5 already
 * settled that a partial plan is never served as a complete one. Failing is louder than quietly
 * rendering a `research_required` permit with no "confirm with agency" on it.
 */
function renderingOrFail(
  renderings: Map<string, FindingRendering>,
  item: PlanItemRow,
): FindingRendering {
  const rendering = renderings.get(`${item.plan_id}:${renderingKey(item.rule_ids)}`);
  if (rendering === undefined) {
    throw new PlanIntegrityError(
      item.plan_id,
      `no stored rendering for finding ${renderingKey(item.rule_ids)}`,
    );
  }
  return rendering;
}

async function planItems(database: Queryable, planId: string): Promise<PlanItemRow[]> {
  const { rows } = await database.query<PlanItemRow>(
    `SELECT ${PLAN_ITEM_COLUMNS.split(",")
      .map((column) => `item.${column.trim()}`)
      .join(", ")},
            plan.ruleset_version AS source_ruleset_version,
            plan.snapshot_date AS source_snapshot_date
       FROM permit_plan_items AS item
       JOIN permit_plans AS plan ON plan.id = item.plan_id
      WHERE item.plan_id = $1
      ORDER BY ${PLAN_ITEM_ORDER}`,
    [planId],
  );
  return rows;
}

/**
 * When each requirement became a checklist task, keyed the same way identity is.
 *
 * This is what "new items appended" orders by (AC 6). It reads `checklist_items.created_at` rather
 * than the plans, because the plans answer a different question: a requirement that appeared in an
 * early plan, was absent when the checklist was created, and returned later has an early plan
 * timestamp and a late task, and ordering by the plan sorts it ahead of everything the organizer
 * has been working instead of appending it. Re-pointing a surviving row at the current plan does
 * not touch `created_at`, so the order also survives every regeneration.
 */
async function taskCreatedByRequirement(
  database: Queryable,
  eventId: string,
): Promise<Map<string, number>> {
  const { rows } = await database.query<{ rule_ids: string[]; created_at: Date }>(
    `SELECT item.rule_ids, checklist.created_at
       FROM checklist_items AS checklist
       JOIN permit_plan_items AS item ON item.id = checklist.plan_item_id
       JOIN permit_plans AS plan ON plan.id = item.plan_id
      WHERE plan.event_id = $1`,
    [eventId],
  );
  const createdAt = new Map<string, number>();
  for (const row of rows) {
    // Identity is the whole rule-id set, order-insensitively, so the same requirement written two
    // ways is one key and the earlier task is the one that dates it.
    const key = requirementKey(row.rule_ids);
    const at = row.created_at.getTime();
    createdAt.set(key, Math.min(createdAt.get(key) ?? at, at));
  }
  return createdAt;
}

/**
 * Every checklist row of the event, in the order rows created together are displayed in.
 * `checklistView` then stably re-groups them by when each requirement first appeared, which is the
 * display order.
 *
 * Deliberately says nothing about the plan each row currently points at, nor about anything that
 * plan recomputed. The plan a row points at is not a property of the task, it is a property of the
 * last regeneration that kept it: a rescope re-points the survivors and leaves a dropped
 * requirement on the plan that raised it, so ordering on `plan.generated_at` sorted the struck row
 * ahead of the cohort it was created with, and ordering on `latest_apply_date` reshuffled the
 * cohort whenever a recalculated date crossed a historical one. Both are the derivation from plan
 * data that migration 004 was added to remove, one layer apart (#92, and #111 round 1).
 */
async function checklistRows(database: Queryable, eventId: string): Promise<ChecklistRow[]> {
  const { rows } = await database.query<ChecklistRow>(
    `SELECT checklist.id AS checklist_item_id, checklist.plan_item_id, checklist.status,
            checklist.notes, checklist.updated_at,
            ${PLAN_ITEM_COLUMNS.split(",")
              .map((column) => `item.${column.trim()}`)
              .join(", ")},
            plan.ruleset_version AS source_ruleset_version,
            plan.snapshot_date AS source_snapshot_date
       FROM checklist_items AS checklist
       JOIN permit_plan_items AS item ON item.id = checklist.plan_item_id
       JOIN permit_plans AS plan ON plan.id = item.plan_id
      WHERE plan.event_id = $1
      ORDER BY ${CHECKLIST_COHORT_ORDER}`,
    [eventId],
  );
  return rows;
}

async function documentsFor(
  database: Queryable,
  checklistItemIds: readonly string[],
): Promise<Map<string, DocumentRow[]>> {
  const byItem = new Map<string, DocumentRow[]>();
  if (checklistItemIds.length === 0) return byItem;
  const { rows } = await database.query<DocumentRow>(
    `SELECT id, checklist_item_id, filename, content_type, size_bytes, uploaded_at
       FROM documents WHERE checklist_item_id = ANY($1) ORDER BY uploaded_at, id`,
    [checklistItemIds],
  );
  for (const row of rows) {
    const existing = byItem.get(row.checklist_item_id);
    if (existing === undefined) byItem.set(row.checklist_item_id, [row]);
    else existing.push(row);
  }
  return byItem;
}

const documentView = (row: DocumentRow) => ({
  id: row.id,
  filename: row.filename,
  contentType: row.content_type,
  // bigint arrives as a string; a document size fits a number long before it loses precision.
  sizeBytes: Number(row.size_bytes),
  uploadedAt: row.uploaded_at.toISOString(),
});

/**
 * The whole checklist for an event: its items with live plan context, the read-only lines of
 * the latest plan, and whether the plan the checklist was built from has been superseded.
 */
/**
 * The plan the organizer last converted into a checklist, or null if they never have.
 *
 * `materialize` writes this row in the same transaction that creates the checklist, so a checklist
 * cannot exist without one. That is what makes its absence mean "no checklist yet" rather than
 * "checklist of unknown vintage".
 */
async function acknowledgedPlanId(database: Queryable, eventId: string): Promise<string | null> {
  const { rows } = await database.query<{ plan_id: string }>(
    "SELECT plan_id FROM checklist_acknowledgements WHERE event_id = $1",
    [eventId],
  );
  return rows[0]?.plan_id ?? null;
}

async function checklistView(database: Queryable, eventId: string, plan: LatestPlan) {
  const unordered = await checklistRows(database, eventId);
  const taskCreated = await taskCreatedByRequirement(database, eventId);
  // Stable, so the filing-date order the query already applied survives as the tiebreak.
  const items = [...unordered].sort(
    (left, right) =>
      (taskCreated.get(requirementKey(left.rule_ids)) ?? 0) -
      (taskCreated.get(requirementKey(right.rule_ids)) ?? 0),
  );
  const latestItems = await planItems(database, plan.id);
  // Read once for the whole view: the notice below needs the date each row was showing when it was
  // last worked, which is a question about the event's plan history rather than about any one plan.
  const history = await planHistory(database, eventId);
  const documents = await documentsFor(
    database,
    items.map((item) => item.checklist_item_id),
  );
  const renderings = await renderingsFor(database, [
    plan.id,
    ...new Set(items.map((item) => item.plan_id)),
  ]);

  const latestByKey = new Map(latestItems.map((item) => [requirementKey(item.rule_ids), item]));

  const view = items.map((item) => {
    const current = latestByKey.get(requirementKey(item.rule_ids));
    // Deadlines come from the latest plan while the requirement still stands: the plan is
    // recalculated, not patched (PRD principle 6). A dropped requirement keeps the dates of
    // the last plan that raised it, which is the honest last-known state.
    const source = current ?? item;
    return {
      id: item.checklist_item_id,
      planItemId: item.plan_item_id,
      status: item.status,
      notes: item.notes,
      updatedAt: item.updated_at.toISOString(),
      // A requirement the latest plan no longer raises is struck through, never deleted (AC 6).
      inLatestPlan: current !== undefined,
      // Rendering a recalculated date is not the same as telling the organizer what it means for
      // work they already did, and until now nothing did the second. A notice, not a status and
      // not a gate: every action available before is still available, and the row is unchanged
      // apart from carrying this string. Only for a requirement the latest plan still raises,
      // since a dropped one is struck through and has no filing to redo.
      reapplyNotice:
        current !== undefined &&
        REAPPLY_NOTICE_STATUSES.has(item.status) &&
        filingDateMoved(
          dateWhenLastWorked(history, item, item.updated_at),
          isoDate(current.latest_apply_date),
        )
          ? REAPPLY_NOTICE
          : null,
      ...planContext(source, renderingOrFail(renderings, source)),
      documents: (documents.get(item.checklist_item_id) ?? []).map(documentView),
    };
  });

  const statusRollup = Object.fromEntries(
    CHECKLIST_STATUSES.map((status) => [
      status,
      view.filter((item) => item.inLatestPlan && item.status === status).length,
    ]),
  );

  // Asked of the plan and the acknowledgement, never of the checklist's own rows: is the latest
  // plan the one the organizer last reviewed? `materialize` records the plan it ran against, so
  // the answer is no immediately afterwards and yes again the moment a regeneration replaces it —
  // including the rescope where the requirements are identical and only the filing dates moved.
  //
  // Every earlier shape of this asked the checklist to report on a plan it does not hold, and each
  // one broke on the same case: a regeneration that removes every trackable requirement leaves
  // nothing on the latest plan to compare against, so the largest possible change produced
  // silence. Comparing two plan ids has no such blind spot, because it never consults the item
  // set — the item set being empty tells it nothing and therefore hides nothing.
  //
  // Null means no checklist has ever been created, which is not a change to review; the organizer
  // is offered creation instead (AC 6 flags an existing checklist).
  const acknowledged = await acknowledgedPlanId(database, eventId);
  const planChanged = acknowledged !== null && acknowledged !== plan.id;

  return {
    eventId,
    planId: plan.id,
    rulesetVersion: plan.rulesetVersion,
    snapshotDate: plan.snapshotDate,
    // Whether a checklist exists at all, which the rows cannot say: a plan whose every requirement
    // is an advisory materialises to zero items (Scenario B), and so does never having pressed
    // create. Those render differently — "nothing to track" against "turn this plan into a
    // checklist" — and only the acknowledgement distinguishes them, because `materialize` writes it
    // in the same transaction that creates the checklist.
    created: acknowledged !== null,
    planChanged,
    // The event has been edited since even the latest plan was generated (AD-13), so these
    // requirements answer an intake the organizer has already moved on from. Creation is refused
    // in that state; a read says so rather than presenting the plan as current.
    planStale: plan.eventRevision < plan.currentRevision,
    statusRollup,
    items: view,
    // Advisories, notifications, prohibitions and notes: shown for context, not tracked.
    contextItems: latestItems
      .filter((item) => !TRACKABLE_FINDING_KINDS.has(item.kind))
      .map((item) => planContext(item, renderingOrFail(renderings, item))),
  };
}

/**
 * Bring the checklist into line with the latest plan, returning how many items were created.
 *
 * A requirement already tracked is re-pointed at the current plan's row rather than left on the
 * superseded one: `checklist_items` is mutable user state, not a plan snapshot, so moving the
 * link neither deletes nor rewrites history, and the status, notes and documents ride along. It
 * is also what makes `planChanged` fall back to false once the organizer has re-created the
 * checklist — without it, the AC 6 prompt would latch on at the first regeneration and never
 * clear. A requirement the latest plan dropped keeps pointing at the last plan that raised it,
 * which is what still renders it struck through.
 */
async function materialize(client: PoolClient, eventId: string, planId: string): Promise<number> {
  const trackedByKey = new Map(
    (await checklistRows(client, eventId)).map((item) => [
      requirementKey(item.rule_ids),
      item.checklist_item_id,
    ]),
  );
  let created = 0;
  for (const item of await planItems(client, planId)) {
    if (!TRACKABLE_FINDING_KINDS.has(item.kind)) continue;
    const tracked = trackedByKey.get(requirementKey(item.rule_ids));
    if (tracked === undefined) {
      // `created` is this task's position among the tasks this call creates, and the loop walks
      // the plan in published filing-date order, so the position freezes that order at creation
      // (migration 007). Recorded rather than re-read, because the date it came from is
      // recalculated by every later regeneration and the order the organizer learned is not.
      await client.query(
        `INSERT INTO checklist_items (id, plan_item_id, cohort_position) VALUES ($1, $2, $3)
           ON CONFLICT (plan_item_id) DO NOTHING`,
        [randomUUID(), item.id, created],
      );
      created += 1;
      continue;
    }
    // Deliberately does not touch `updated_at`: re-pointing is not the organizer doing something.
    await client.query("UPDATE checklist_items SET plan_item_id = $2 WHERE id = $1", [
      tracked,
      item.id,
    ]);
  }

  // Converting the plan into a checklist is the organizer reviewing it (AC 1, and AC 6's "review
  // items" — the same idempotent call, which is why this needs no endpoint of its own). One row
  // per event, so a later review replaces the earlier one rather than accumulating.
  //
  // `acknowledged_at` is set explicitly because Postgres does not re-evaluate a column default on
  // conflict: updating `plan_id` alone would leave the timestamp reporting the first review
  // forever (migration 002).
  await client.query(
    `INSERT INTO checklist_acknowledgements (event_id, plan_id, acknowledged_at)
       VALUES ($1, $2, current_timestamp)
     ON CONFLICT (event_id)
       DO UPDATE SET plan_id = EXCLUDED.plan_id, acknowledged_at = EXCLUDED.acknowledged_at`,
    [eventId, planId],
  );
  return created;
}

const notFound = (res: Response, message: string): void => {
  res.status(404).json({ error: message });
};

/** A malformed id must never reach `WHERE id = $1`: Postgres 22P02 would surface as driver text. */
function rejectMalformedId(id: string, res: Response, label: string): boolean {
  if (UUID.test(id)) return false;
  res.status(400).json({ error: `${label} must be a uuid` });
  return true;
}

/** Only our own messages are safe to echo; anything else could carry driver or SDK detail. */
function respondWithFailure(res: Response, error: unknown, summary: string): void {
  if (error instanceof DocumentStorageError) {
    // The item keeps its state and no metadata row was written, so retrying is safe (spec edge case).
    res.status(503).json({ error: error.message, retryable: true });
    return;
  }
  console.error(summary, error);
  res.status(500).json({ error: summary });
}

const handle =
  (route: (req: Request, res: Response) => Promise<void>) =>
  (req: Request, res: Response, next: NextFunction): void => {
    route(req, res).catch(next);
  };

/**
 * A display name only. The client's filename is untrusted: it is reduced to its last path
 * segment and a conservative character set, and it never contributes to the storage key.
 */
function displayFilename(supplied: string | undefined, extension: string): string {
  const lastSegment = (supplied ?? "").split(/[\\/]/).pop() ?? "";
  const cleaned = lastSegment
    .replace(/[^A-Za-z0-9._-]/g, "_")
    .replace(/^\.+/, "")
    .slice(0, 120);
  return cleaned === "" ? `document.${extension}` : cleaned;
}

const startsWithSignature = (body: Buffer, signature: readonly number[]): boolean =>
  body.length >= signature.length && signature.every((byte, index) => body[index] === byte);

/** The declared body length, or null when the client sent none or sent nonsense. */
function declaredLength(req: Request): number | null {
  const header = req.get("content-length");
  if (header === undefined) return null;
  const length = Number(header);
  return Number.isInteger(length) && length >= 0 ? length : null;
}

/**
 * Read the leading `size` bytes without consuming them, so the format check runs before a single
 * byte is forwarded to storage. Only the head is buffered; the rest of the body is never held in
 * memory. `ended` says the whole body arrived within those bytes, which matters because a stream
 * cannot be unshifted after it has ended — the caller re-sends the head instead.
 */
function peek(req: Request, size: number): Promise<{ head: Buffer; ended: boolean }> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let buffered = 0;
    const settle = (ended: boolean): void => {
      req.removeListener("readable", take);
      req.removeListener("end", atEnd);
      const head = Buffer.concat(chunks, buffered);
      if (!ended && head.length > 0) req.unshift(head);
      resolve({ head, ended });
    };
    const atEnd = (): void => settle(true);
    function take(): void {
      let chunk: Buffer | null;
      while ((chunk = req.read() as Buffer | null) !== null) {
        chunks.push(chunk);
        buffered += chunk.length;
        if (buffered >= size) {
          settle(false);
          return;
        }
      }
    }
    req.once("error", reject);
    req.on("readable", take);
    req.once("end", atEnd);
    take();
  });
}

/**
 * Delete an object whose metadata write is known not to have landed, so the bucket does not keep
 * bytes nothing points at. If the delete itself fails there is nothing further to try — the
 * repository has no cleanup queue, and the outbox that would give one is Phase 2
 * (ARCHITECTURE-FUTURE) — so the key is logged for manual deletion and the original failure is
 * still what the client is told.
 */
async function removeOrphanedObject(storage: DocumentStorage, key: string): Promise<void> {
  try {
    await storage.remove(key);
  } catch (error) {
    console.error(
      `orphaned document object ${key} could not be removed and needs manual deletion`,
      error,
    );
  }
}

/**
 * Whether the metadata row exists after the insert reported failure, and the row itself when it
 * does. The lookup has already read it, and a caller that has to re-read it to answer would be
 * making a second trip for something it was just handed.
 */
type MetadataOutcome =
  | { state: "written"; row: DocumentRow }
  | { state: "not_written" }
  | { state: "unknown" };

/**
 * A rejected query is not the same as a rejected statement. If Postgres commits the insert and
 * the connection drops before the result gets back, node-postgres rejects while the row exists.
 *
 * That distinction decides which failure the organizer gets, and the two are not equally bad. An
 * orphaned object costs storage and nobody ever sees it. Orphaned metadata is a document the
 * organizer can see in their checklist and click and get nothing from — a visible lie about what
 * they uploaded. So the object is deleted only when the row is known to be absent, and every
 * uncertain path keeps the bytes.
 *
 * `DatabaseError` means the server answered with an error, so the statement never committed. Any
 * other failure happened somewhere in the round trip and settles nothing by itself, so the id —
 * freshly generated and unique to this request, which no retry or concurrent upload can reuse —
 * is looked up once. A lookup that cannot answer leaves the outcome unknown, and unknown keeps
 * the object.
 */
async function metadataOutcome(
  database: Queryable,
  documentId: string,
  error: unknown,
): Promise<MetadataOutcome> {
  if (error instanceof DatabaseError) return { state: "not_written" };
  try {
    const { rows } = await database.query<DocumentRow>(
      `SELECT id, checklist_item_id, filename, content_type, size_bytes, uploaded_at
         FROM documents WHERE id = $1`,
      [documentId],
    );
    const row = rows[0];
    return row === undefined ? { state: "not_written" } : { state: "written", row };
  } catch {
    return { state: "unknown" };
  }
}

export function createChecklistRouter(dependencies: ChecklistDependencies): Router {
  const { database, storage } = dependencies;
  const router = Router();

  router.post(
    "/events/:id/checklist",
    handle(async (req, res) => {
      const eventId = req.params.id ?? "";
      if (rejectMalformedId(eventId, res, "event id")) return;

      // The event row is locked for the decision so two clicks cannot both find the checklist
      // missing and both materialize it. The UNIQUE plan_item_id backs that up.
      const client = await database.connect();
      try {
        await client.query("BEGIN");
        const { rows } = await client.query<{ id: string }>(
          "SELECT id FROM events WHERE id = $1 FOR UPDATE",
          [eventId],
        );
        if (rows[0] === undefined) {
          await client.query("ROLLBACK");
          notFound(res, `event ${eventId} not found`);
          return;
        }
        const plan = await latestPlan(client, eventId);
        if (plan === null) {
          await client.query("ROLLBACK");
          notFound(res, `no plan generated for event ${eventId}`);
          return;
        }
        // A plan pins the revision it evaluated (AD-13). If the event has been edited since,
        // materializing it would present requirements computed from an intake the organizer has
        // already replaced, silently omitting anything the edit introduced — a checklist that
        // looks current and is not. Read under the same row lock as the event, so an edit
        // committing mid-request cannot slip past this.
        if (plan.eventRevision < plan.currentRevision) {
          await client.query("ROLLBACK");
          res.status(409).json({
            error: `plan for event ${eventId} was generated against revision ${plan.eventRevision}, but the event is at revision ${plan.currentRevision}; regenerate the plan first`,
          });
          return;
        }
        const created = await materialize(client, eventId, plan.id);
        const view = await checklistView(client, eventId, plan);
        await client.query("COMMIT");
        // A second call creates nothing and returns the checklist that already exists.
        res.status(created > 0 ? 201 : 200).json(view);
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    }),
  );

  router.get(
    "/events/:id/checklist",
    handle(async (req, res) => {
      const eventId = req.params.id ?? "";
      if (rejectMalformedId(eventId, res, "event id")) return;
      const plan = await latestPlan(database, eventId);
      if (plan === null) {
        notFound(res, `no plan generated for event ${eventId}`);
        return;
      }
      res.json(await checklistView(database, eventId, plan));
    }),
  );

  router.patch(
    "/checklist-items/:id",
    handle(async (req, res) => {
      const id = req.params.id ?? "";
      if (rejectMalformedId(id, res, "checklist item id")) return;

      const body: unknown = req.body;
      if (typeof body !== "object" || body === null || Array.isArray(body)) {
        res.status(400).json({ error: "body must be a JSON object" });
        return;
      }
      const { status, notes } = body as { status?: unknown; notes?: unknown };
      // Every transition is allowed — agencies are messy (AC 2) — so only the value is checked.
      if (status !== undefined && !isChecklistStatus(status)) {
        res.status(400).json({ error: `status must be one of ${CHECKLIST_STATUSES.join(", ")}` });
        return;
      }
      if (notes !== undefined && notes !== null && typeof notes !== "string") {
        res.status(400).json({ error: "notes must be a string or null" });
        return;
      }
      if (status === undefined && notes === undefined) {
        res.status(400).json({ error: "nothing to update: send status, notes, or both" });
        return;
      }

      const { rows } = await database.query<{
        id: string;
        plan_item_id: string;
        status: ChecklistStatus;
        notes: string | null;
        updated_at: Date;
      }>(
        `UPDATE checklist_items
            SET status = COALESCE($2, status),
                notes = CASE WHEN $3::boolean THEN $4 ELSE notes END,
                updated_at = current_timestamp
          WHERE id = $1
          RETURNING id, plan_item_id, status, notes, updated_at`,
        [id, status ?? null, notes !== undefined, notes ?? null],
      );
      const updated = rows[0];
      if (updated === undefined) {
        notFound(res, `checklist item ${id} not found`);
        return;
      }
      res.json({
        id: updated.id,
        planItemId: updated.plan_item_id,
        status: updated.status,
        notes: updated.notes,
        updatedAt: updated.updated_at.toISOString(),
      });
    }),
  );

  router.post(
    "/checklist-items/:id/documents",
    handle(async (req, res) => {
      const checklistItemId = req.params.id ?? "";
      if (rejectMalformedId(checklistItemId, res, "checklist item id")) return;

      const contentType = (req.get("content-type") ?? "").split(";")[0]?.trim() ?? "";
      const accepted = DOCUMENT_TYPES[contentType as DocumentContentType] as
        (typeof DOCUMENT_TYPES)[DocumentContentType] | undefined;
      if (accepted === undefined) {
        res
          .status(415)
          .json({ error: `content type must be one of ${DOCUMENT_CONTENT_TYPES.join(", ")}` });
        return;
      }

      // The declared length is what bounds the upload and what S3 signs the PUT against. Without
      // it the only way to know the size is to buffer the whole body, which is the thing this
      // route exists not to do, so an undeclared length is refused rather than guessed at.
      const sizeBytes = declaredLength(req);
      if (sizeBytes === null) {
        res.status(411).json({ error: "content-length is required to upload a document" });
        return;
      }
      if (sizeBytes === 0) {
        res.status(400).json({ error: "document body is empty" });
        return;
      }
      if (sizeBytes > MAX_DOCUMENT_BYTES) {
        res.status(413).json({ error: `document must be ${MAX_DOCUMENT_BYTES} bytes or smaller` });
        return;
      }

      const { head, ended } = await peek(req, SIGNATURE_BYTES);
      if (!startsWithSignature(head, accepted.signature)) {
        res.status(400).json({ error: `document contents are not a valid ${contentType} file` });
        return;
      }

      const { rows } = await database.query<{ id: string }>(
        "SELECT id FROM checklist_items WHERE id = $1",
        [checklistItemId],
      );
      if (rows[0] === undefined) {
        notFound(res, `checklist item ${checklistItemId} not found`);
        return;
      }

      // The key is generated, never derived from the filename: a caller cannot choose where
      // its bytes land or overwrite another item's document.
      const storageKey = `checklist-items/${checklistItemId}/${randomUUID()}.${accepted.extension}`;
      // Storage first, metadata second: a failed upload leaves no row pointing at bytes that
      // are not there (spec edge case), and the client can simply retry. The request itself is
      // what gets streamed — a body that ended inside the peek is re-sent from the head, since
      // an ended stream cannot be unshifted.
      await storage.put(storageKey, ended ? Readable.from(head) : req, contentType, sizeBytes);

      const documentId = randomUUID();
      const filename = displayFilename(req.get("x-filename"), accepted.extension);
      try {
        const { rows: created } = await database.query<DocumentRow>(
          `INSERT INTO documents (id, checklist_item_id, filename, content_type, size_bytes, storage_key)
           VALUES ($1, $2, $3, $4, $5, $6)
           RETURNING id, checklist_item_id, filename, content_type, size_bytes, uploaded_at`,
          [documentId, checklistItemId, filename, contentType, sizeBytes, storageKey],
        );
        res.status(201).json(documentView(created[0] as DocumentRow));
      } catch (error) {
        const outcome = await metadataOutcome(database, documentId, error);
        if (outcome.state === "written") {
          // The row is there and the object is there; only the result was lost. Reporting a
          // failure would tell the organizer a stored document did not store, and the retry that
          // invites writes a second object and a second row: new id, new key, every attempt.
          // The upload succeeded, so it is answered as one, from the row that proves it.
          res.status(201).json(documentView(outcome.row));
          return;
        }
        if (outcome.state === "not_written") {
          // Nothing references the object and nothing will, so a retry writes exactly one.
          await removeOrphanedObject(storage, storageKey);
        } else {
          // Nobody can say whether the row landed. Deleting on that would leave a document the
          // organizer can click and get nothing from, so the bytes stay and the key is logged.
          console.error(
            `document ${documentId} may have been written for object ${storageKey}; the object ` +
              `is kept and needs reconciling by hand (metadata outcome: ${outcome.state})`,
            error,
          );
        }
        throw error;
      }
    }),
  );

  router.get(
    "/documents/:id/url",
    handle(async (req, res) => {
      const documentId = req.params.id ?? "";
      if (rejectMalformedId(documentId, res, "document id")) return;
      const { rows } = await database.query<{ storage_key: string; filename: string }>(
        "SELECT storage_key, filename FROM documents WHERE id = $1",
        [documentId],
      );
      const document = rows[0];
      if (document === undefined) {
        notFound(res, `document ${documentId} not found`);
        return;
      }
      res.json({
        url: await storage.signedDownloadUrl(document.storage_key, DOWNLOAD_URL_TTL_SECONDS),
        filename: document.filename,
        expiresInSeconds: DOWNLOAD_URL_TTL_SECONDS,
      });
    }),
  );

  // Anything a route threw answers in JSON like every other error, rather than as an HTML stack
  // from Express's default handler.
  router.use((error: unknown, _req: Request, res: Response, _next: NextFunction): void => {
    respondWithFailure(res, error, "checklist request failed");
  });

  return router;
}
