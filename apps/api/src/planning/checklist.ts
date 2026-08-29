// F-202 compliance checklist + document uploads (ARCHITECTURE.md API Surface).

import { createHash, randomUUID } from "node:crypto";
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
  FindingRoute,
  VerificationStatus,
} from "@pop-engine/engine";
import {
  alertContacts,
  alertDeliveryHealth,
  parseContacts,
  simulatedDeliveries,
  type AlertScheduler,
} from "../alerts/alerts";
import { movedDeadlineNotice, type NoticePlanItem } from "./moved-deadline-notice";
import {
  calendarDateFrom,
  filingRouteOf,
  renderingKey,
  FILING_ORDER_DATE,
  FILING_ORDER_JOIN,
  PlanIntegrityError,
  type FindingRendering,
} from "./plan";
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

/**
 * Namespace for the deterministic document ids below. A fixed, arbitrary UUID, as RFC 4122 §4.3
 * requires: it only has to be constant, so that the same key always names the same document.
 */
const UPLOAD_NAMESPACE = "f2b0c1a4-6d3e-4f57-9a8b-0c2d4e6f8a10";

/** The document id a given upload key names, derived rather than minted. */
function documentIdFor(checklistItemId: string, uploadKey: string): string {
  const namespace = Buffer.from(UPLOAD_NAMESPACE.replace(/-/g, ""), "hex");
  const hash = createHash("sha1")
    .update(namespace)
    .update(`${checklistItemId}:${uploadKey}`, "utf8")
    .digest();
  // Version 5 in the high nibble of byte 6, RFC 4122 variant in the top bits of byte 8.
  hash[6] = ((hash[6] as number) & 0x0f) | 0x50;
  hash[8] = ((hash[8] as number) & 0x3f) | 0x80;
  const hex = hash.subarray(0, 16).toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

/** The client's idempotency key for this upload, or null when it sent none. */
function uploadKeyOf(supplied: string | undefined): string | null {
  if (supplied === undefined) return null;
  const cleaned = supplied.replace(/[^A-Za-z0-9%._~-]/g, "_").slice(0, 200);
  return cleaned === "" ? null : cleaned;
}

export type ChecklistDependencies = {
  database: Pool;
  storage: DocumentStorage;
  /** F-203. */
  scheduleAlerts: AlertScheduler;
  /** F-203. */
  jurisdiction: string;
};

type Queryable = {
  query<Row extends QueryResultRow>(text: string, values?: unknown[]): Promise<QueryResult<Row>>;
};

/** A requirement's identity across plans. */
const requirementKey = (ruleIds: readonly string[], kind: FindingKind): string =>
  `${kind}:${[...ruleIds].sort().join(",")}`;

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

/** Plan items carry uuid primary keys, so the table has no stable order of its own (F-201 hit the same wall reading plans back). */
const PLAN_ITEM_ORDER = `${FILING_ORDER_DATE} NULLS LAST, item.permit_name, item.rule_ids`;

/** The order of checklist rows created together, which is a different question. */
const CHECKLIST_COHORT_ORDER =
  "checklist.created_at, checklist.cohort_position, item.rule_ids, checklist.id";

type ChecklistRow = PlanItemRow & {
  checklist_item_id: string;
  plan_item_id: string;
  status: ChecklistStatus;
  notes: string | null;
  created_at: Date;
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

type StoredDocumentRow = DocumentRow & { storage_key: string };

type UploadOperands = {
  checklistItemId: string;
  filename: string;
  contentType: string;
  sizeBytes: number;
};

/** Answer from committed metadata without trusting an idempotency key to identify the body. */
function sendCommittedUpload(
  res: Response,
  row: DocumentRow,
  expected: UploadOperands,
  matchingStatus: 200 | 201,
): void {
  if (row.checklist_item_id !== expected.checklistItemId) {
    res.status(409).json({ error: "that upload key names a document on another item" });
    return;
  }
  if (
    row.filename !== expected.filename ||
    row.content_type !== expected.contentType ||
    Number(row.size_bytes) !== expected.sizeBytes
  ) {
    res.status(409).json({ error: "that upload key was already used for another document" });
    return;
  }
  res.status(matchingStatus).json(documentView(row));
}

const isoDate = (value: Date | string | null): string | null =>
  value === null ? null : calendarDateFrom(value);

/** The value a field takes when a filing route is what the row renders: THAT ROUTE'S, INCLUDING ITS NULLS. */
const fromFilingRoute =
  (filing: FindingRoute | null) =>
  <Value>(read: (route: FindingRoute) => Value, columnValue: Value): Value =>
    filing === null ? columnValue : read(filing);

const planContext = (item: PlanItemRow, rendering: FindingRendering) => {
  const filing = filingRouteOf(item, rendering);
  const filed = fromFilingRoute(filing);
  return {
    ruleIds: item.rule_ids,
    permitName: item.permit_name,
    userSummary: rendering.user_summary ?? null,
    agency: item.agency,
    kind: item.kind,
    disposition: item.disposition,
    deadline: filed((route) => route.deadline, item.deadline),
    deadlineDisplay: filed((route) => route.deadlineDisplay, rendering.deadline_display),
    latestApplyDate: filed((route) => route.latestApplyDate, isoDate(item.latest_apply_date)),
    applyAfterDate: filed((route) => route.applyAfterDate, isoDate(item.apply_after_date)),
    deadlineStatus: filed((route) => route.deadlineStatus, item.deadline_status),
    slackDays: filed((route) => route.slackDays, rendering.slack_days),
    /** Every contributing route of a merged dedupe line, and which one the window, status and fee above were read off when the line publishes none of its own. */
    routes: rendering.routes ?? null,
    headlineMode: rendering.headline_mode ?? null,
    filingRouteRuleId: filing?.ruleId ?? null,
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
    // The filing route's fee, not another route's: it travels with the window above so an organizer
    // reads one rule's date and that same rule's price, never one of each.
    feeDisplay: filed((route) => route.feeDisplay, item.fee_display),
    portalName: filed((route) => route.portalName, item.portal_name),
    portalUrl: filed((route) => route.portalUrl, item.portal_url),
    portalInstructions: filed((route) => route.portalInstructions, rendering.portal_instructions),
    sources: item.sources,
    sourceUrl: item.source_url,
    sourcePlan: {
      rulesetVersion: item.source_ruleset_version,
      snapshotDate: isoDate(item.source_snapshot_date),
    },
  };
};

/** The window a moved-deadline notice compares against, which is the same window the checklist row renders. */
const noticeItemFrom = (item: PlanItemRow, rendering: FindingRendering): NoticePlanItem => {
  const filing = filingRouteOf(item, rendering);
  const filed = fromFilingRoute(filing);
  // THE PROVENANCE OF THE DEADLINE ABOVE IT, WHICH IS THE SAME ROUTE OR IT IS NOT PROVENANCE.
  const ownSources =
    filing === null
      ? item.sources
      : item.sources.filter((source) => source.ruleId === filing.ruleId);
  return {
    deadline: filed((route) => route.deadline, item.deadline),
    latest_apply_date: filed((route) => route.latestApplyDate, isoDate(item.latest_apply_date)),
    apply_after_date: filed((route) => route.applyAfterDate, isoDate(item.apply_after_date)),
    deadline_status: filed((route) => route.deadlineStatus, item.deadline_status),
    verification_status: item.verification_status,
    last_verified_date: isoDate(item.last_verified_date),
    sources: ownSources,
    source_url: filing === null ? item.source_url : (ownSources[0]?.urls[0] ?? null),
    source_ruleset_version: item.source_ruleset_version,
    source_snapshot_date: isoDate(item.source_snapshot_date),
  };
};

/** The rendering that goes with `noticeItemFrom`'s item, read off the same route. */
const noticeRenderingFrom = (item: PlanItemRow, rendering: FindingRendering): FindingRendering => {
  const filing = filingRouteOf(item, rendering);
  if (filing === null) return rendering;
  return {
    ...rendering,
    deadline_display: filing.deadlineDisplay,
    // `undefined` is the pre-field plan and falls back; `null` is this route publishing no
    // conflict and must NOT, for the reason `fromFilingRoute` refuses `??` on the fee and portal.
    conflict_text:
      filing.conflictText === undefined ? rendering.conflict_text : filing.conflictText,
  };
};

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
       ${FILING_ORDER_JOIN}
      WHERE item.plan_id = $1
      ORDER BY ${PLAN_ITEM_ORDER}`,
    [planId],
  );
  return rows;
}

/** Every checklist row of the event, in the order rows created together are displayed in. */
async function checklistRows(database: Queryable, eventId: string): Promise<ChecklistRow[]> {
  const { rows } = await database.query<ChecklistRow>(
    `SELECT checklist.id AS checklist_item_id, checklist.plan_item_id, checklist.status,
            checklist.notes, checklist.created_at, checklist.updated_at,
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

/**
 * A row is terminal once any later immutable plan omits its complete rule-id-set-and-kind identity.
 * The latest plan may raise that identity again; the missing intervening plan is the durable fact
 * that keeps the old task struck and makes the return a new task (F-202 AC 9).
 */
async function struckChecklistItemIds(
  database: Queryable,
  eventId: string,
  latestPlanId: string,
  items: readonly ChecklistRow[],
): Promise<Set<string>> {
  if (items.length === 0) return new Set();

  const { rows } = await database.query<{
    plan_id: string;
    rule_ids: string[] | null;
    kind: FindingKind | null;
  }>(
    `SELECT plan.id AS plan_id, item.rule_ids, item.kind
       FROM permit_plans AS plan
       LEFT JOIN permit_plan_items AS item ON item.plan_id = plan.id
      WHERE plan.event_id = $1
      ORDER BY plan.generated_at, plan.id`,
    [eventId],
  );

  const identitiesByPlan = new Map<string, Set<string>>();
  for (const row of rows) {
    const identities = identitiesByPlan.get(row.plan_id) ?? new Set<string>();
    if (row.rule_ids !== null && row.kind !== null) {
      identities.add(requirementKey(row.rule_ids, row.kind));
    }
    identitiesByPlan.set(row.plan_id, identities);
  }

  const planIds = [...identitiesByPlan.keys()];
  const latestIndex = planIds.indexOf(latestPlanId);
  if (latestIndex < 0) {
    throw new PlanIntegrityError(latestPlanId, "latest plan is absent from its event history");
  }

  const struck = new Set<string>();
  // ponytail: quadratic in checklist rows × plan history; persist only if measured event histories
  // outgrow the bounded capstone workload.
  for (const item of items) {
    const sourceIndex = planIds.indexOf(item.plan_id);
    if (sourceIndex < 0) {
      throw new PlanIntegrityError(
        item.plan_id,
        "checklist source plan is absent from event history",
      );
    }
    const identity = requirementKey(item.rule_ids, item.kind);
    for (let index = sourceIndex + 1; index <= latestIndex; index += 1) {
      if (!identitiesByPlan.get(planIds[index] as string)?.has(identity)) {
        struck.add(item.checklist_item_id);
        break;
      }
    }
  }
  return struck;
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

/** The plan the organizer last converted into a checklist, or null if they never have. */
async function acknowledgedPlanId(database: Queryable, eventId: string): Promise<string | null> {
  const { rows } = await database.query<{ plan_id: string }>(
    "SELECT plan_id FROM checklist_acknowledgements WHERE event_id = $1",
    [eventId],
  );
  return rows[0]?.plan_id ?? null;
}

async function checklistView(
  database: Queryable,
  eventId: string,
  plan: LatestPlan,
  /** The jurisdiction whose calendar day the health statement classifies holds against. */
  jurisdiction: string,
) {
  const items = await checklistRows(database, eventId);
  const struck = await struckChecklistItemIds(database, eventId, plan.id, items);
  const latestItems = await planItems(database, plan.id);
  const documents = await documentsFor(
    database,
    items.map((item) => item.checklist_item_id),
  );
  const renderings = await renderingsFor(database, [
    plan.id,
    ...new Set(items.map((item) => item.plan_id)),
  ]);

  const latestByKey = new Map(
    latestItems.map((item) => [requirementKey(item.rule_ids, item.kind), item]),
  );

  const view = items.map((item) => {
    const struckThrough = struck.has(item.checklist_item_id);
    const current = latestByKey.get(requirementKey(item.rule_ids, item.kind));
    if (!struckThrough && current === undefined) {
      throw new PlanIntegrityError(plan.id, "active checklist task is absent from the latest plan");
    }
    // A struck row keeps its persisted regulatory values and provenance. An active row displays
    // the latest immutable plan snapshot (F-202 AC 8; F-206 AC 4).
    const source = struckThrough ? item : (current as PlanItemRow);
    return {
      id: item.checklist_item_id,
      planItemId: item.plan_item_id,
      status: item.status,
      notes: item.notes,
      updatedAt: item.updated_at.toISOString(),
      struckThrough,
      ...planContext(source, renderingOrFail(renderings, source)),
      deadlineNotice:
        !struckThrough && current !== undefined && current.id !== item.id
          ? movedDeadlineNotice(
              noticeItemFrom(item, renderingOrFail(renderings, item)),
              noticeRenderingFrom(item, renderingOrFail(renderings, item)),
              noticeItemFrom(current, renderingOrFail(renderings, current)),
              noticeRenderingFrom(current, renderingOrFail(renderings, current)),
            )
          : null,
      documents: (documents.get(item.checklist_item_id) ?? []).map(documentView),
    };
  });

  const statusRollup = Object.fromEntries(
    CHECKLIST_STATUSES.map((status) => [
      status,
      view.filter((item) => !item.struckThrough && item.status === status).length,
    ]),
  );

  // Asked of the plan and the acknowledgement, never of the checklist's own rows: is the latest plan the one the organizer last reviewed?
  const acknowledged = await acknowledgedPlanId(database, eventId);
  const planChanged = acknowledged !== null && acknowledged !== plan.id;
  // F-203: both alert-delivery notices from ONE snapshot.
  const alertHealth = await alertDeliveryHealth(database, eventId, jurisdiction);

  return {
    eventId,
    planId: plan.id,
    rulesetVersion: plan.rulesetVersion,
    snapshotDate: plan.snapshotDate,
    // Whether a checklist exists at all, which the rows cannot say: a plan whose every requirement is an advisory materialises to zero items (Scenario B), and so does never having pressed create.
    created: acknowledged !== null,
    planChanged,
    // The event has been edited since even the latest plan was generated (AD-13), so these requirements answer an intake the organizer has already moved on from.
    planStale: plan.eventRevision < plan.currentRevision,
    statusRollup,
    // F-203: channels that reported an alert sent without delivering it, with the label that says so.
    simulatedAlertDeliveries: await simulatedDeliveries(database, eventId),
    // F-203: where this event's alerts go, so the organizer can see and correct it.
    failedAlertDeliveries: alertHealth.failedDeliveries,
    // F-203: alerts the poller has permanently stopped on, kept apart from the failures above for the same reason those are kept apart from the simulation.
    alertsHeldForReconciliation: alertHealth.reconciliationHolds,
    alertContacts: await alertContacts(database, eventId),
    items: view,
    // Advisories, notifications, prohibitions and notes: shown for context, not tracked.
    contextItems: latestItems
      .filter((item) => !TRACKABLE_FINDING_KINDS.has(item.kind))
      .map((item) => planContext(item, renderingOrFail(renderings, item))),
  };
}

/** Bring the checklist into line with the latest plan, returning how many items were created. */
async function materialize(client: PoolClient, eventId: string, planId: string): Promise<number> {
  const existing = await checklistRows(client, eventId);
  const struck = await struckChecklistItemIds(client, eventId, planId, existing);
  const trackedByKey = new Map(
    existing
      .filter((item) => !struck.has(item.checklist_item_id))
      .map((item) => [requirementKey(item.rule_ids, item.kind), item.checklist_item_id]),
  );
  let created = 0;
  for (const item of await planItems(client, planId)) {
    if (!TRACKABLE_FINDING_KINDS.has(item.kind)) continue;
    const tracked = trackedByKey.get(requirementKey(item.rule_ids, item.kind));
    if (tracked === undefined) {
      // `created` is this task's position among the tasks this call creates, and the loop walks the plan in published filing-date order, so the position freezes that order at creation (migration 007).
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

  // Converting the plan into a checklist is the organizer reviewing it (AC 1, and AC 6's "review items" — the same idempotent call, which is why this needs no endpoint of its own).
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

/** Everything a header value cannot carry, percent-decoded back. */
function decodeFilename(supplied: string | undefined): string {
  if (supplied === undefined) return "";
  try {
    return decodeURIComponent(supplied);
  } catch {
    return supplied;
  }
}

/** A display name only. */
function displayFilename(supplied: string | undefined, extension: string): string {
  const lastSegment = decodeFilename(supplied).split(/[\\/]/).pop() ?? "";
  const cleaned = lastSegment
    .replace(/[^\p{L}\p{N}\p{M}._ -]/gu, "_")
    .replace(/^[.\s]+/u, "")
    .trim()
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

/** Read the leading `size` bytes without consuming them, so the format check runs before a single byte is forwarded to storage. */
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

/** Delete an object whose metadata write is known not to have landed, so the bucket does not keep bytes nothing points at. */
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
  { state: "written"; row: StoredDocumentRow } | { state: "not_written" } | { state: "unknown" };

/** A rejected query is not the same as a rejected statement. */
async function metadataOutcome(
  database: Queryable,
  documentId: string,
  error: unknown,
): Promise<MetadataOutcome> {
  if (error instanceof DatabaseError) return { state: "not_written" };
  try {
    const { rows } = await database.query<StoredDocumentRow>(
      `SELECT id, checklist_item_id, filename, content_type, size_bytes, storage_key, uploaded_at
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
  const { database, storage, scheduleAlerts, jurisdiction } = dependencies;
  const router = Router();

  router.post(
    "/events/:id/checklist",
    handle(async (req, res) => {
      const eventId = req.params.id ?? "";
      if (rejectMalformedId(eventId, res, "event id")) return;

      // WHICH PLAN THE ORGANIZER WAS LOOKING AT WHEN THEY PRESSED REVIEW.
      const displayedPlanId: unknown = (req.body as { planId?: unknown } | undefined)?.planId;
      if (typeof displayedPlanId !== "string" || !UUID.test(displayedPlanId)) {
        res.status(400).json({
          error:
            "planId is required and must be the uuid of the plan being displayed; a review " +
            "records which plan the organizer read, so the server will not choose one for it",
        });
        return;
      }

      // Where the alerts go (F-203 Inputs: contact fields are entered at checklist creation, since there is no account to read them off in the MVP).
      const parsed = parseContacts(req.body);
      if ("error" in parsed) {
        res.status(400).json({ error: parsed.error });
        return;
      }

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
        // A plan pins the revision it evaluated (AD-13).
        if (plan.eventRevision < plan.currentRevision) {
          await client.query("ROLLBACK");
          res.status(409).json({
            error: `plan for event ${eventId} was generated against revision ${plan.eventRevision}, but the event is at revision ${plan.currentRevision}; regenerate the plan first`,
          });
          return;
        }
        // THE STALE TAB.
        if (displayedPlanId !== plan.id) {
          const current = await checklistView(client, eventId, plan, jurisdiction);
          await client.query("ROLLBACK");
          res.status(409).json({
            error: `plan ${displayedPlanId} is no longer the latest plan for event ${eventId}; nothing was recorded — review the current plan shown here and submit again`,
            supersededPlanId: displayedPlanId,
            checklist: current,
          });
          return;
        }
        const created = await materialize(client, eventId, plan.id);
        // Schedule after materialization, in the same transaction as the checklist rows.
        const alerts = await scheduleAlerts(client, eventId, plan.id, parsed.contacts);
        const view = await checklistView(client, eventId, plan, jurisdiction);
        await client.query("COMMIT");
        // A second call creates nothing and returns the checklist that already exists.
        res.status(created > 0 ? 201 : 200).json({ ...view, alerts });
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
      res.json(await checklistView(database, eventId, plan, jurisdiction));
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

      // The declared length is what bounds the upload and what S3 signs the PUT against.
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

      // The id names the document, and the key names its bytes.
      const uploadKey = uploadKeyOf(req.get("x-upload-key"));
      const documentId =
        uploadKey === null ? randomUUID() : documentIdFor(checklistItemId, uploadKey);
      const storageKey =
        `checklist-items/${checklistItemId}/${documentId}/` +
        `${randomUUID()}.${accepted.extension}`;
      const filename = displayFilename(req.get("x-filename"), accepted.extension);
      const expected = { checklistItemId, filename, contentType, sizeBytes };

      const { rows: items } = await database.query<{ id: string }>(
        "SELECT id FROM checklist_items WHERE id = $1",
        [checklistItemId],
      );
      if (items[0] === undefined) {
        notFound(res, `checklist item ${checklistItemId} not found`);
        return;
      }

      if (uploadKey !== null) {
        const { rows: existing } = await database.query<StoredDocumentRow>(
          `SELECT id, checklist_item_id, filename, content_type, size_bytes, storage_key, uploaded_at
             FROM documents WHERE id = $1`,
          [documentId],
        );
        const previous = existing[0];
        if (previous !== undefined) {
          sendCommittedUpload(res, previous, expected, 200);
          return;
        }
      }

      const { head, ended } = await peek(req, SIGNATURE_BYTES);
      if (!startsWithSignature(head, accepted.signature)) {
        res.status(400).json({ error: `document contents are not a valid ${contentType} file` });
        return;
      }

      // Every attempt owns a different object, so a concurrent loser can remove its bytes without
      // touching the winner. No database connection is held while the request streams to storage.
      try {
        await storage.put(storageKey, ended ? Readable.from(head) : req, contentType, sizeBytes);
      } catch (error) {
        // A provider can store the object and lose only its acknowledgement. This attempt owns the
        // unique key, so compensating is safe whether the bytes landed or not.
        await removeOrphanedObject(storage, storageKey);
        throw error;
      }
      try {
        const { rows: created } = await database.query<StoredDocumentRow>(
          `INSERT INTO documents (id, checklist_item_id, filename, content_type, size_bytes, storage_key)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (id) DO NOTHING
           RETURNING id, checklist_item_id, filename, content_type, size_bytes, storage_key, uploaded_at`,
          [documentId, checklistItemId, filename, contentType, sizeBytes, storageKey],
        );
        const stored = created[0];
        if (stored !== undefined) {
          res.status(201).json(documentView(stored));
          return;
        }

        const { rows: existing } = await database.query<StoredDocumentRow>(
          `SELECT id, checklist_item_id, filename, content_type, size_bytes, storage_key, uploaded_at
             FROM documents WHERE id = $1`,
          [documentId],
        );
        const previous = existing[0];
        if (previous === undefined) {
          console.error(
            `document ${documentId} lost its conflicting metadata row; object ${storageKey} ` +
              "is kept and needs reconciling by hand",
          );
          res.status(500).json({
            error: "the document may have been stored; the checklist will show whether it was",
            storedOutcome: "unknown",
          });
          return;
        }

        await removeOrphanedObject(storage, storageKey);
        sendCommittedUpload(res, previous, expected, 200);
      } catch (error) {
        const outcome = await metadataOutcome(database, documentId, error);
        if (outcome.state === "written") {
          const thisAttemptWon = outcome.row.storage_key === storageKey;
          if (!thisAttemptWon) await removeOrphanedObject(storage, storageKey);
          sendCommittedUpload(res, outcome.row, expected, thisAttemptWon ? 201 : 200);
          return;
        }
        if (outcome.state === "not_written") {
          // Nothing references the object and nothing will, so a retry writes exactly one.
          await removeOrphanedObject(storage, storageKey);
        } else {
          // Nobody can say whether the row landed.
          console.error(
            `document ${documentId} may have been written for object ${storageKey}; the object ` +
              `is kept and needs reconciling by hand (metadata outcome: ${outcome.state})`,
            error,
          );
          res.status(500).json({
            error: "the document may have been stored; the checklist will show whether it was",
            storedOutcome: "unknown",
          });
          return;
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
        url: await storage.signedDownloadUrl(
          document.storage_key,
          DOWNLOAD_URL_TTL_SECONDS,
          document.filename,
        ),
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
