// The browser's calls to the checklist, document-upload and download-URL endpoints (F-202).

import {
  CHECKLIST_STATUSES,
  bindingRouteOf,
  mergedDispositionOf,
  noRouteSuppliesScalars,
} from "@pop-engine/engine";
import type {
  ChecklistStatus,
  Deadline,
  DeadlineStatus,
  Disposition,
  FindingKind,
  FindingRoute,
  FindingSource,
  HeadlineMode,
  RuleUserSummary,
  VerificationStatus,
} from "@pop-engine/engine";
import { CREDENTIALED } from "../_lib/events-api";
import {
  HEADLINE_MODES,
  ROUTE_CHECKS,
  agreesWithRoute,
  routeContractHolds,
  type ConsumedRoute,
} from "../plan/plan-api";
import {
  absentOr,
  arrayOf,
  asRecord,
  atLeast,
  type FieldChecks,
  isNumber,
  isString,
  isToken,
  nullOr,
  readChecked,
  shapedLike,
  tokensOf,
} from "../plan/validated";

/** Spec AC 3. The api enforces both; these are what the file picker offers and pre-checks. */
export const ACCEPTED_DOCUMENT_TYPES = ["application/pdf", "image/png", "image/jpeg"] as const;
export const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;

/**
 * The plan a checklist row's displayed values came from (AC 8), read off the row rather than the
 * live rules file. The two travel together and are never split: a pinned version beside another
 * source's date is a pair that never existed (F-206 AC 4).
 */
export type SourcePlan = {
  readonly rulesetVersion: string;
  readonly snapshotDate: string | null;
};

/**
 * The only part of a `Deadline` this feature reads. Same widening as the plan view's, for the same
 * reason: the token is humanised for display, so pinning it to today's union would make the
 * validator refuse a whole checklist the moment the engine publishes a new deadline kind.
 */
export type ConsumedDeadline = {
  readonly [K in keyof Pick<Deadline, "type">]: string;
};

/** The regulatory half of a checklist row: what the plan item says, carried through by the api's `planContext`. */
export type PlanContext = {
  readonly ruleIds: readonly string[];
  readonly permitName: string | null;
  readonly userSummary: Pick<RuleUserSummary, "heading"> | null;
  readonly agency: string | null;
  readonly kind: FindingKind;
  readonly disposition: Disposition;
  readonly deadline: ConsumedDeadline | null;
  readonly deadlineDisplay: string | null;
  readonly latestApplyDate: string | null;
  readonly applyAfterDate: string | null;
  readonly deadlineStatus: DeadlineStatus;
  readonly deadlineUnknownFields: readonly string[];
  readonly timelineUnresolvedReason: string | null;
  readonly verificationStatus: VerificationStatus;
  /**
   * The date the plan item stored, or null when it stored none (F-206 AC 5). Null renders no date
   * at all: the snapshot's publication date is a different fact and must never stand in for it.
   */
  readonly lastVerifiedDate: string | null;
  /** Published regulatory text. Never the organizer's `notes`, which are a different field. */
  readonly publishedNotes: readonly string[];
  readonly noteText: string | null;
  readonly conflictText: string | null;
  readonly feeDisplay: string | null;
  readonly portalName: string | null;
  readonly portalUrl: string | null;
  readonly portalInstructions: string | null;
  readonly sources: readonly FindingSource[];
  readonly sourcePlan: SourcePlan;
  /** Every contributing route of a merged dedupe line, each with its own name, window and fee. */
  readonly routes?: readonly ConsumedRoute[] | null;
  readonly headlineMode?: HeadlineMode | null;
  readonly filingRouteRuleId?: string | null;
};

export type ChecklistDocument = {
  readonly id: string;
  readonly filename: string;
};

/** A trackable row: the organizer's state, plus the plan context it is tracking. */
export type ChecklistItem = PlanContext & {
  readonly id: string;
  readonly status: ChecklistStatus;
  readonly notes: string | null;
  /** True once plan history ends this task; terminal rows stay struck if the identity returns. */
  readonly struckThrough: boolean;
  /**
   * F-202 AC 9: the deadline PopEngine computes moved between the plan item this row still points
   * at and the latest plan's item for the same requirement. Null when nothing moved, the row is
   * struck through, or a review has already re-pointed the row.
   */
  readonly deadlineNotice: MovedDeadlineNotice | null;
  readonly documents: readonly ChecklistDocument[];
};

/**
 * F-202 AC 9 wire shape. Dates are named "previous" / "current", never "earlier" — a recalculated
 * deadline can land later than the one it replaces.
 */
export type MovedDeadlineNotice = {
  readonly dateChange: DateChange | null;
  readonly stateChange: {
    readonly previous: DeadlineStateSide;
    readonly current: DeadlineStateSide;
  } | null;
  readonly previousProvenance: PreviousDeadlineProvenance;
  readonly rulesetVersionsDiffer: boolean;
  readonly previousRulesetVersion: string;
  readonly currentRulesetVersion: string;
};

export type DateChange =
  | { readonly kind: "both"; readonly previous: string; readonly current: string }
  | {
      readonly kind: "became_not_calculable";
      readonly previous: string;
      readonly reason: string | null;
    }
  | { readonly kind: "became_not_applicable"; readonly previous: string }
  | { readonly kind: "now_computed"; readonly current: string };

export type DeadlineStateSide = {
  readonly deadlineStatus: DeadlineStatus;
  /**
   * Full stored deadline object AC 9 compares. Wider than PlanContext's ConsumedDeadline: the
   * notice must name field-level moves (calendarDays, businessDays, boundary, levels, …), not
   * only the type token the row head humanises.
   */
  readonly deadline: Deadline | null;
  readonly deadlineDisplay: string | null;
  readonly timelineUnresolvedReason: string | null;
  readonly deadlineUnknownFields: readonly string[];
  readonly gated: boolean;
};

export type PreviousDeadlineProvenance = {
  readonly verificationStatus: VerificationStatus;
  readonly lastVerifiedDate: string | null;
  readonly sources: readonly FindingSource[];
  readonly sourceUrl: string | null;
  readonly conflictText: string | null;
  readonly rulesetVersion: string;
  readonly snapshotDate: string | null;
};

/**
 * AC 2's rollup as the api counted it: current-plan rows only, one count per status. AC 11 derives
 * the visible task-only rollup from the returned rows because blocker statuses stay stored but are
 * not displayed.
 */
export type StatusRollup = Readonly<Record<ChecklistStatus, number>>;

/** A channel that recorded alerts as sent without delivering them (F-203 AC 5). */
export type SimulatedAlertDelivery = {
  readonly channel: string;
  readonly sentCount: number;
};

/** A channel whose alerts tried to send and did not (F-203). */
export type FailedAlertDelivery = {
  readonly channel: string;
  readonly failedCount: number;
  /** Whether these rows are held because their own plan is behind the event, not the latest one. */
  readonly heldForReview: boolean;
  /** Whether any of them was attempted with no outcome ever recorded, which the paused sentence has to qualify: a review restarts an ordinary held row and does not restart one of these. */
  readonly attemptedWithoutOutcome?: boolean;
};

/** A channel with alerts under a bounded reconciliation hold (F-203). */
export type ReconciliationHold = {
  readonly channel: string;
  readonly heldCount: number;
};

export type AlertContacts = {
  readonly email: string | null;
  readonly phone: string | null;
};

export type ChecklistResponse = {
  /**
   * The plan these rows were built from. Read so the page can say WHICH plan it is showing when
   * it asks the api to record a review: the acknowledgement names a specific plan, and the server
   * refuses to pick one on the caller's behalf.
   */
  readonly planId: string;
  /** The current plan's pinned pair, for the checklist's own banner (F-206 AC 1). */
  readonly rulesetVersion: string;
  readonly snapshotDate: string | null;
  /** Whether a checklist has ever been created; the rows cannot say, because zero is a real answer. */
  readonly created: boolean;
  /** The plan has been regenerated since the organizer last reviewed the checklist (AC 6). */
  readonly planChanged: boolean;
  /** The event has been edited since even the latest plan was generated; creation is refused. */
  readonly planStale: boolean;
  readonly statusRollup: StatusRollup;
  readonly items: readonly ChecklistItem[];
  /** Advisories and notes: read-only context, never trackable tasks. */
  readonly contextItems: readonly PlanContext[];
  /** Empty in every configuration where every alert that reported sent was actually delivered. */
  readonly simulatedAlertDeliveries: readonly SimulatedAlertDelivery[];
  /** Empty when no alert for this event has an attempt behind it that failed. */
  readonly failedAlertDeliveries: readonly FailedAlertDelivery[];
  /** Empty when no alert for this event has an attempt the poller has given up on. */
  readonly alertsHeldForReconciliation: readonly ReconciliationHold[];
  readonly alertContacts: AlertContacts;
};

export type ChecklistResult =
  | { ok: true; checklist: ChecklistResponse }
  /** `noPlan` and `superseded` distinguish safe retry paths from unreadable state. */
  | { ok: false; noPlan: boolean; superseded?: true; message: string };

export type ChecklistItemUpdate = {
  readonly id: string;
  readonly status: ChecklistStatus;
  readonly notes: string | null;
};

export type ItemUpdateResult =
  { ok: true; item: ChecklistItemUpdate } | { ok: false; message: string };

/** What a failed upload leaves behind, which decides whether sending the same file again is safe. */
export type UploadOutcome =
  /** The api refused before storing anything, or stored nothing and said so. Safe to resend. */
  | "not_stored"
  /** The api answered 2xx: the document is stored. Resending would store a second copy. */
  | "stored"
  /** The request never completed. It may or may not have been stored, and nothing here can say. */
  | "unknown";

export type UploadResult =
  | { ok: true; document: ChecklistDocument }
  | { ok: false; outcome: UploadOutcome; message: string };

export type DownloadResult = { ok: true; url: string } | { ok: false; message: string };

const UNREACHABLE = "The API could not be reached.";
const UNREADABLE_CHECKLIST = "The API returned a checklist this page cannot read.";
/**
 * Said for an upload that never came back, which is not the same as an upload that never landed.
 * The wording states the uncertainty rather than resolving it in either direction, because
 * nothing on this side can resolve it.
 */
const INCOMPLETE_UPLOAD =
  "The connection did not complete, so whether this document was stored is not known.";

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    // A non-JSON body (a proxy error page, an Access challenge) still has a status.
    return null;
  }
}

function failureMessage(body: unknown, fallback: string): string {
  const error = asRecord(body)?.error;
  return typeof error === "string" && error.length > 0 ? error : fallback;
}

const isBoolean = (value: unknown): value is boolean => typeof value === "boolean";

const DISPOSITIONS = tokensOf<Disposition>({
  required: true,
  may_be_required: true,
  prohibited_or_ineligible: true,
  advisory: true,
  no_new_requirement: true,
});

const FINDING_KINDS = tokensOf<FindingKind>({
  permit: true,
  insurance: true,
  notification: true,
  registration: true,
  eligibility: true,
  prohibition: true,
  dependency: true,
  advisory: true,
  note: true,
});

const DEADLINE_STATUSES = tokensOf<DeadlineStatus>({
  on_track: true,
  deadline_approaching: true,
  published_deadline_missed: true,
  not_calculable: true,
  not_applicable: true,
});

const VERIFICATION_STATUSES = tokensOf<VerificationStatus>({
  SOURCE_CONFIRMED: true,
  OFFICIAL_CONFLICT: true,
  RESEARCH_REQUIRED: true,
  COVERAGE_GAP: true,
  VERIFIED: true,
});

const STATUSES = tokensOf<ChecklistStatus>({
  not_started: true,
  in_progress: true,
  submitted: true,
  approved: true,
  rejected: true,
});

const DEADLINE_CHECKS: FieldChecks<ConsumedDeadline> = { type: isString };

const SOURCE_PLAN_CHECKS: FieldChecks<SourcePlan> = {
  rulesetVersion: isString,
  // Null on a plan generated before migration 002 recorded the date its version carried.
  snapshotDate: nullOr(isString),
};

const SOURCE_CHECKS: FieldChecks<FindingSource> = {
  ruleId: isString,
  citation: isString,
  urls: arrayOf(isString),
};

const PLAN_CONTEXT_CHECKS: FieldChecks<PlanContext> = {
  ruleIds: arrayOf(isString),
  permitName: nullOr(isString),
  userSummary: nullOr(shapedLike({ heading: isString })),
  agency: nullOr(isString),
  kind: isToken(FINDING_KINDS),
  disposition: isToken(DISPOSITIONS),
  deadline: nullOr(shapedLike(DEADLINE_CHECKS)),
  deadlineDisplay: nullOr(isString),
  latestApplyDate: nullOr(isString),
  applyAfterDate: nullOr(isString),
  deadlineStatus: isToken(DEADLINE_STATUSES),
  deadlineUnknownFields: arrayOf(isString),
  timelineUnresolvedReason: nullOr(isString),
  verificationStatus: isToken(VERIFICATION_STATUSES),
  lastVerifiedDate: nullOr(isString),
  publishedNotes: arrayOf(isString),
  noteText: nullOr(isString),
  conflictText: nullOr(isString),
  feeDisplay: nullOr(isString),
  portalName: nullOr(isString),
  portalUrl: nullOr(isString),
  portalInstructions: nullOr(isString),
  sources: arrayOf(shapedLike(SOURCE_CHECKS)),
  sourcePlan: shapedLike(SOURCE_PLAN_CHECKS),
  // Absent from an api deployed before the checklist read routes, which is the deploy window this
  // change opens. Absence is "not served", never "this line has no routes".
  routes: absentOr(nullOr(atLeast(2, arrayOf(shapedLike(ROUTE_CHECKS))))),
  headlineMode: absentOr(nullOr(isToken(HEADLINE_MODES))),
  filingRouteRuleId: absentOr(nullOr(isString)),
};

/** A FILING ROUTE THE ROW DOES NOT CARRY NAMES NOTHING. */
const FILED_FIELDS = [
  "deadlineDisplay",
  "latestApplyDate",
  "applyAfterDate",
  "deadlineStatus",
  "feeDisplay",
  "portalName",
  "portalUrl",
  "portalInstructions",
] as const satisfies readonly (keyof PlanContext & keyof ConsumedRoute)[];

/** THE EXCEPTION IS A CONDITION, NOT A SHAPE, for the same reason the plan boundary's is. */
const publishesNoFilingFields = (context: PlanContext): boolean =>
  context.deadlineStatus === "not_calculable" &&
  context.deadline === null &&
  context.permitName === null &&
  context.agency === null &&
  FILED_FIELDS.every((field) => field === "deadlineStatus" || context[field] === null) &&
  noRouteSuppliesScalars((context.routes ?? []) as readonly FindingRoute[]);

/** `agreesWithRoute` is the plan boundary's, shared so the three tuples cannot drift on what
 * "agrees" means; the route SELECTION stays here, because this one is named by the row. */
const matchesRoute = (context: PlanContext, route: ConsumedRoute): boolean =>
  agreesWithRoute(context, route, FILED_FIELDS);

/** THE ROW'S IDENTITY IS ITS BINDING ROUTE'S, WHATEVER ROUTE ITS FILING FIELDS CAME FROM. */
const identityMatchesBinding = (context: PlanContext, route: ConsumedRoute): boolean =>
  context.permitName === route.name && context.agency === route.agency;

/** THE IDENTITY EXCEPTION IS NOT THE FILING-TUPLE EXCEPTION, and reading them as one refused a checklist the engine itself produces. */
const identityIsWhatTheRoutesAllow = (context: PlanContext, binding: ConsumedRoute): boolean =>
  noRouteSuppliesScalars((context.routes ?? []) as readonly FindingRoute[])
    ? context.permitName === null && context.agency === null
    : identityMatchesBinding(context, binding);

/** A NULL FILING ROUTE IS A CLAIM TOO, and it was the one this check waved through. */
const filingRouteIsCarried = (context: PlanContext): boolean => {
  const routes = context.routes ?? [];
  if (routes.length === 0) return true;
  const binding = routes[0] as ConsumedRoute;
  if (!identityIsWhatTheRoutesAllow(context, binding)) return false;
  if (publishesNoFilingFields(context)) return true;
  if (context.filingRouteRuleId == null) return matchesRoute(context, binding);
  const named = routes.filter((route) => route.ruleId === context.filingRouteRuleId);
  if (named.length !== 1) return false;
  return matchesRoute(context, named[0] as ConsumedRoute);
};

/** THE THREE ROUTE FIELDS ARE ONE VERSIONED GROUP, served together or not at all. */
const ROUTE_GROUP_FIELDS: readonly (keyof PlanContext)[] = [
  "routes",
  "headlineMode",
  "filingRouteRuleId",
];

const routeGroupIsWhole = (context: PlanContext): boolean => {
  const present = ROUTE_GROUP_FIELDS.filter((field) => field in context).length;
  return present === 0 || present === ROUTE_GROUP_FIELDS.length;
};

/** The same invariant the plan boundary applies to its headline disposition, on the row that renders the same value as a badge. */
const dispositionFollowsFromRoutes = (context: PlanContext): boolean => {
  const routes = (context.routes ?? []) as readonly FindingRoute[];
  if (routes.length === 0) return true;
  return context.disposition === mergedDispositionOf(routes);
};

/** `routes[0]` IS THE BINDING ROUTE HERE TOO, and this is the third boundary to check the claim rather than define it. */
const bindsWhereTheEngineWouldBind = (context: PlanContext): boolean => {
  const routes = (context.routes ?? []) as readonly FindingRoute[];
  const binding = bindingRouteOf(routes);
  return binding === null || binding.ruleId === routes[0]?.ruleId;
};

const isPlanContext = (value: unknown): value is PlanContext =>
  shapedLike(PLAN_CONTEXT_CHECKS)(value) &&
  routeGroupIsWhole(value) &&
  routeContractHolds(value) &&
  dispositionFollowsFromRoutes(value) &&
  bindsWhereTheEngineWouldBind(value) &&
  filingRouteIsCarried(value);

const DOCUMENT_CHECKS: FieldChecks<ChecklistDocument> = { id: isString, filename: isString };

const isDateChange = (value: unknown): value is DateChange => {
  const record = asRecord(value);
  if (record === null || !isString(record.kind)) return false;
  switch (record.kind) {
    case "both":
      return isString(record.previous) && isString(record.current);
    case "became_not_calculable":
      return isString(record.previous) && (record.reason === null || isString(record.reason));
    case "became_not_applicable":
      return isString(record.previous);
    case "now_computed":
      return isString(record.current);
  }
  return false;
};

/**
 * Accepts the engine's Deadline union without pinning every variant field. Variants differ by
 * which keys are present; refusing a body over an unread key would reject a checklist the notice
 * can otherwise render. A non-object or typeless value is still refused.
 */
const isDeadline = (value: unknown): value is Deadline => {
  const record = asRecord(value);
  return record !== null && isString(record.type);
};

const STATE_SIDE_CHECKS: FieldChecks<DeadlineStateSide> = {
  deadlineStatus: isToken(DEADLINE_STATUSES),
  deadline: nullOr(isDeadline),
  deadlineDisplay: nullOr(isString),
  timelineUnresolvedReason: nullOr(isString),
  deadlineUnknownFields: arrayOf(isString),
  gated: isBoolean,
};

const PREVIOUS_PROVENANCE_CHECKS: FieldChecks<PreviousDeadlineProvenance> = {
  verificationStatus: isToken(VERIFICATION_STATUSES),
  lastVerifiedDate: nullOr(isString),
  sources: arrayOf(shapedLike(SOURCE_CHECKS)),
  sourceUrl: nullOr(isString),
  conflictText: nullOr(isString),
  rulesetVersion: isString,
  snapshotDate: nullOr(isString),
};

const DEADLINE_NOTICE_CHECKS: FieldChecks<MovedDeadlineNotice> = {
  dateChange: nullOr(isDateChange),
  stateChange: nullOr(
    shapedLike({
      previous: shapedLike(STATE_SIDE_CHECKS),
      current: shapedLike(STATE_SIDE_CHECKS),
    }),
  ),
  previousProvenance: shapedLike(PREVIOUS_PROVENANCE_CHECKS),
  rulesetVersionsDiffer: isBoolean,
  previousRulesetVersion: isString,
  currentRulesetVersion: isString,
};

const ITEM_CHECKS: FieldChecks<ChecklistItem> = {
  ...PLAN_CONTEXT_CHECKS,
  id: isString,
  status: isToken(STATUSES),
  notes: nullOr(isString),
  struckThrough: isBoolean,
  deadlineNotice: nullOr(shapedLike(DEADLINE_NOTICE_CHECKS)),
  documents: arrayOf(shapedLike(DOCUMENT_CHECKS)),
};

/** An item is a `PlanContext` with the row's own fields, so it carries the same route contract. */
const isChecklistItem = (value: unknown): value is ChecklistItem =>
  shapedLike(ITEM_CHECKS)(value) &&
  routeGroupIsWhole(value) &&
  routeContractHolds(value) &&
  dispositionFollowsFromRoutes(value) &&
  bindsWhereTheEngineWouldBind(value) &&
  filingRouteIsCarried(value);

/**
 * One count per status, keyed off the engine's own list, so a status added upstream stops this
 * compiling rather than going uncounted on screen.
 */
const ROLLUP_CHECKS = Object.fromEntries(
  CHECKLIST_STATUSES.map((status) => [status, isNumber]),
) as FieldChecks<StatusRollup>;

const SIMULATED_DELIVERY_CHECKS: FieldChecks<SimulatedAlertDelivery> = {
  channel: isString,
  sentCount: isNumber,
};

const FAILED_DELIVERY_CHECKS: FieldChecks<FailedAlertDelivery> = {
  channel: isString,
  failedCount: isNumber,
  heldForReview: isBoolean,
  attemptedWithoutOutcome: absentOr(isBoolean),
};

const RECONCILIATION_HOLD_CHECKS: FieldChecks<ReconciliationHold> = {
  channel: isString,
  heldCount: isNumber,
};

const ALERT_CONTACTS_CHECKS: FieldChecks<AlertContacts> = {
  email: nullOr(isString),
  phone: nullOr(isString),
};

const CHECKLIST_CHECKS: FieldChecks<ChecklistResponse> = {
  planId: isString,
  rulesetVersion: isString,
  snapshotDate: nullOr(isString),
  created: isBoolean,
  planChanged: isBoolean,
  planStale: isBoolean,
  statusRollup: shapedLike(ROLLUP_CHECKS),
  items: arrayOf(isChecklistItem),
  contextItems: arrayOf(isPlanContext),
  simulatedAlertDeliveries: arrayOf(shapedLike(SIMULATED_DELIVERY_CHECKS)),
  failedAlertDeliveries: arrayOf(shapedLike(FAILED_DELIVERY_CHECKS)),
  alertsHeldForReconciliation: arrayOf(shapedLike(RECONCILIATION_HOLD_CHECKS)),
  alertContacts: shapedLike(ALERT_CONTACTS_CHECKS),
};

const ITEM_UPDATE_CHECKS: FieldChecks<ChecklistItemUpdate> = {
  id: isString,
  status: isToken(STATUSES),
  notes: nullOr(isString),
};

/** Members a row may legitimately omit, because an api deployed before the checklist read routes does not serve them. */
const OPTIONAL_ITEM_FIELDS: readonly string[] = ["routes", "headlineMode", "filingRouteRuleId"];

/** The fields this feature reads off a checklist row, exposed so a test can assert coverage. */
export const CONSUMED_ITEM_FIELDS: readonly string[] = Object.keys(ITEM_CHECKS).filter(
  (field) => !OPTIONAL_ITEM_FIELDS.includes(field),
);

/** The one field this page will accept a body without, because the two services deploy separately. */
const withRolloutDefaults = (body: unknown): unknown => {
  const record = asRecord(body);
  return record === null || record.alertsHeldForReconciliation !== undefined
    ? body
    : { ...record, alertsHeldForReconciliation: [] };
};

const readChecklist = (body: unknown): ChecklistResponse | null =>
  readChecked(CHECKLIST_CHECKS, withRolloutDefaults(body));

/** The event's checklist, whether or not one has been created (`GET /api/events/:id/checklist`). */
export async function loadChecklist(apiBaseUrl: string, eventId: string): Promise<ChecklistResult> {
  let response: Response;
  try {
    response = await fetch(`${apiBaseUrl}/api/events/${eventId}/checklist`, { ...CREDENTIALED });
  } catch {
    return { ok: false, noPlan: false, message: UNREACHABLE };
  }

  const body = await readJson(response);
  if (!response.ok) {
    return {
      ok: false,
      // The endpoint answers 404 only when the event has no plan to build a checklist from.
      noPlan: response.status === 404,
      message: failureMessage(
        body,
        response.status === 404
          ? "No plan has been generated for this event yet."
          : `The checklist could not be loaded (HTTP ${response.status}).`,
      ),
    };
  }

  const checklist = readChecklist(body);
  if (checklist === null) return { ok: false, noPlan: false, message: UNREADABLE_CHECKLIST };
  return { ok: true, checklist };
}

/** Turn the latest plan into a checklist, and re-run the same call to review it after a regeneration (AC 1 and AC 6 are one idempotent endpoint). */
export async function createChecklist(
  apiBaseUrl: string,
  eventId: string,
  displayedPlanId: string,
  contacts: AlertContacts,
): Promise<ChecklistResult> {
  let response: Response;
  try {
    response = await fetch(`${apiBaseUrl}/api/events/${eventId}/checklist`, {
      method: "POST",
      ...CREDENTIALED,
      // The plan the organizer was reading, and where the alerts go, in one body.
      body: JSON.stringify({
        planId: displayedPlanId,
        contactEmail: contacts.email === null || contacts.email === "" ? null : contacts.email,
        contactPhone: contacts.phone === null || contacts.phone === "" ? null : contacts.phone,
      }),
    });
  } catch {
    return { ok: false, noPlan: false, message: UNREACHABLE };
  }

  const body = await readJson(response);
  if (!response.ok) {
    // The api answers 409 for two different states and they are not interchangeable: the plan was superseded while this page was reading it, or the EVENT was edited and the plan needs regenerating first.
    const superseded =
      response.status === 409 && typeof asRecord(body)?.supersededPlanId === "string";
    return {
      ok: false,
      noPlan: response.status === 404,
      ...(superseded ? { superseded: true as const } : {}),
      message: failureMessage(
        body,
        `The checklist could not be created (HTTP ${response.status}).`,
      ),
    };
  }

  const checklist = readChecklist(body);
  if (checklist === null) return { ok: false, noPlan: false, message: UNREADABLE_CHECKLIST };
  return { ok: true, checklist };
}

/**
 * A status change, a note, or both (`PATCH /api/checklist-items/:id`). Every transition is
 * allowed — agencies are messy (AC 2) — so nothing here refuses one.
 */
export async function updateChecklistItem(
  apiBaseUrl: string,
  itemId: string,
  changes: { status?: ChecklistStatus; notes?: string | null },
): Promise<ItemUpdateResult> {
  let response: Response;
  try {
    response = await fetch(`${apiBaseUrl}/api/checklist-items/${itemId}`, {
      method: "PATCH",
      ...CREDENTIALED,
      body: JSON.stringify(changes),
    });
  } catch {
    return { ok: false, message: UNREACHABLE };
  }

  const body = await readJson(response);
  if (!response.ok) {
    return {
      ok: false,
      message: failureMessage(body, `The item could not be updated (HTTP ${response.status}).`),
    };
  }

  const item = readChecked(ITEM_UPDATE_CHECKS, body);
  if (item === null) {
    return { ok: false, message: "The API returned an item this page cannot read." };
  }
  return { ok: true, item };
}

/** The idempotency key for uploading this file, derived from the file itself. */
export const uploadKey = (file: File): string =>
  `${file.size}-${file.lastModified}-${encodeURIComponent(file.name)}`;

/** Why this file cannot be uploaded, or null when it can (AC 3). */
export function documentRejection(file: File): string | null {
  if (!(ACCEPTED_DOCUMENT_TYPES as readonly string[]).includes(file.type)) {
    return "Documents must be a PDF, PNG or JPG.";
  }
  if (file.size > MAX_DOCUMENT_BYTES) return "Documents must be 10 MB or smaller.";
  if (file.size === 0) return "That file is empty.";
  return null;
}

/** Stream one document up for an item (`POST /api/checklist-items/:id/documents`). */
export async function uploadDocument(
  apiBaseUrl: string,
  itemId: string,
  file: File,
): Promise<UploadResult> {
  let response: Response;
  try {
    response = await fetch(`${apiBaseUrl}/api/checklist-items/${itemId}/documents`, {
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": file.type,
        "X-Filename": encodeURIComponent(file.name),
        "X-Upload-Key": uploadKey(file),
      },
      body: file,
    });
  } catch {
    // `fetch` rejects for every failure that leaves no response, and that is not the same set as "nothing was stored".
    return { ok: false, outcome: "unknown", message: INCOMPLETE_UPLOAD };
  }

  const body = await readJson(response);
  if (!response.ok) {
    // A response usually means the api decided, and decided that nothing was stored: a refusal never reached storage, and the api deletes the object whenever it establishes that the metadata row is absent.
    return {
      ok: false,
      outcome: asRecord(body)?.storedOutcome === "unknown" ? "unknown" : "not_stored",
      message: failureMessage(
        body,
        `The document could not be uploaded (HTTP ${response.status}).`,
      ),
    };
  }

  const document = readChecked(DOCUMENT_CHECKS, body);
  if (document === null) {
    // The api answered 2xx, so the document IS stored; only its description is unreadable.
    return {
      ok: false,
      outcome: "stored",
      message: "The document was uploaded, but the API returned a response this page cannot read.",
    };
  }
  return { ok: true, document };
}

/** A short-lived signed download URL for a stored document (`GET /api/documents/:id/url`). */
export async function documentUrl(apiBaseUrl: string, documentId: string): Promise<DownloadResult> {
  let response: Response;
  try {
    response = await fetch(`${apiBaseUrl}/api/documents/${documentId}/url`, { ...CREDENTIALED });
  } catch {
    return { ok: false, message: UNREACHABLE };
  }

  const body = await readJson(response);
  if (!response.ok) {
    return {
      ok: false,
      message: failureMessage(
        body,
        `The document link could not be read (HTTP ${response.status}).`,
      ),
    };
  }

  const url = asRecord(body)?.url;
  if (typeof url !== "string" || url.length === 0) {
    return { ok: false, message: "The API returned a download link this page cannot read." };
  }
  return { ok: true, url };
}
