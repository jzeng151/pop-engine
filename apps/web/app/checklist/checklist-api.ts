// The browser's calls to the checklist, document-upload and download-URL endpoints (F-202).
//
// Web and api are separate origins behind Cloudflare Access (BASELINE.md provider baseline), so
// every call sends credentials and the api answers with `Access-Control-Allow-Credentials`.
//
// The validation discipline is `apps/web/app/plan`'s, and its helpers are imported rather than
// copied: a consumed type carries exactly the fields this feature reads, `FieldChecks` is mapped
// over `keyof` that type, so a field cannot be read without a runtime check existing for it. The
// reason it is worth the weight here is the same one it was worth there — every field below is
// regulatory content or organizer state, and a silently-undefined one renders as an answer.

import { CHECKLIST_STATUSES } from "@pop-engine/engine";
import type {
  ChecklistStatus,
  Deadline,
  DeadlineStatus,
  Disposition,
  FindingSource,
  RuleUserSummary,
  VerificationStatus,
} from "@pop-engine/engine";
import { CREDENTIALED } from "../intake/events-api";
import {
  absentOr,
  arrayOf,
  asRecord,
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

/**
 * The regulatory half of a checklist row: what the plan item says, carried through by the api's
 * `planContext`. Every published qualification is here rather than only the resolved values —
 * a `research_required` deadline has no date and its meaning lives entirely in the published
 * notes, and dropping those renders an unresolved requirement as a resolved one.
 */
export type PlanContext = {
  readonly ruleIds: readonly string[];
  readonly permitName: string | null;
  readonly userSummary: Pick<RuleUserSummary, "heading"> | null;
  readonly agency: string | null;
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
 * AC 2's rollup as the api counted it: current-plan rows only, one count per status. The counting
 * rule lives there and only there, so this feature reads the answer rather than recomputing it.
 */
export type StatusRollup = Readonly<Record<ChecklistStatus, number>>;

/**
 * A channel that recorded alerts as sent without delivering them (F-203 AC 5).
 *
 * Twilio A2P 10DLC registration is not approved, so SMS is the labelled in-product simulation
 * DESIGN.md permits — "simulated email send shown in-product" is on its list of permitted demo
 * fallbacks, and AGENTS.md allows a simulation only while the UI labels it. The row carries an
 * operator's version of that label; what an organizer needs is the plain fact that no message
 * arrived, which is why this consumes the channel and the count and leaves the stored string to
 * the audit record it belongs to.
 *
 * `channel` is a plain string for the reason `ConsumedDeadline.type` is: it is humanised for
 * display, so pinning it to today's two values would make a future channel reject an entire
 * checklist the page would otherwise render correctly.
 */
export type SimulatedAlertDelivery = {
  readonly channel: string;
  readonly sentCount: number;
};

/**
 * Where this event's deadline alerts are sent (F-203 Inputs: entered at checklist creation, since
 * the MVP has no account to read an address off).
 *
 * A fact about the EVENT, which is why it round-trips: the organizer sees what is on file and can
 * correct it. It is not read off a sent alert — that records where one message went, which is a
 * different fact that must not change once it is true.
 */
/**
 * A channel whose alerts tried to send and did not (F-203).
 *
 * Observed, not inferred: the api counts rows whose latest attempt failed. An absent entry means
 * no failures were observed, which is NOT the same as the channel working — nothing may have been
 * attempted — so nothing is rendered from an absence.
 */
export type FailedAlertDelivery = {
  readonly channel: string;
  readonly failedCount: number;
  /** Whether these rows are held because their own plan is behind the event, not the latest one. */
  readonly heldForReview: boolean;
  /**
   * Whether any of them was attempted with no outcome ever recorded, which the paused sentence has
   * to qualify: a review restarts an ordinary held row and does not restart one of these.
   *
   * OPTIONAL FOR THE ROLLOUT, and for the same reason `alertsHeldForReconciliation` is defaulted
   * below: web deploys BEFORE the api (`DEPLOY.md`, "Release order"), so this page runs for a while
   * against an api that does not send the field. Absent is read as "not known", and the notice then
   * says what it said before rather than making a claim in either direction.
   */
  readonly attemptedWithoutOutcome?: boolean;
};

/**
 * A channel with alerts the poller has permanently stopped on (F-203).
 *
 * Distinct from a failure: a failure is retried, and this is not. The api counts alerts that were
 * handed to a provider whose answer nobody ever saw, long enough ago that a retry would be a
 * second delivery rather than a deduplicated one, so no tick will take them again.
 */
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
  /**
   * `noPlan` separates "this event has no plan to convert", which the plan view answers, from
   * "a checklist may exist but could not be read", which nothing on this page answers. Offering
   * creation for the second would POST against a plan whose state is unknown.
   */
  /**
   * `superseded` means the api refused the review because the plan this page was showing is no
   * longer the latest, and — this is the part that matters — RECORDED NOTHING. The organizer is
   * re-presented with the current plan and reviews again, rather than having an acknowledgement
   * filed against a plan they never read.
   */
  | { ok: false; noPlan: boolean; superseded?: true; message: string };

export type ChecklistItemUpdate = {
  readonly id: string;
  readonly status: ChecklistStatus;
  readonly notes: string | null;
};

export type ItemUpdateResult =
  { ok: true; item: ChecklistItemUpdate } | { ok: false; message: string };

/**
 * What a failed upload leaves behind, which decides whether sending the same file again is safe.
 *
 * Three states rather than a `retryable` boolean, because the boolean had no way to say the third
 * one and defaulted it to the wrong answer. The api reasons in exactly these terms internally —
 * `metadataOutcome` in `apps/api/src/checklist.ts` returns written / not_written / unknown, and
 * keeps the stored bytes whenever the outcome is unknown rather than assuming.
 */
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
};

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
  items: arrayOf(shapedLike(ITEM_CHECKS)),
  contextItems: arrayOf(shapedLike(PLAN_CONTEXT_CHECKS)),
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

/** The fields this feature reads off a checklist row, exposed so a test can assert coverage. */
export const CONSUMED_ITEM_FIELDS: readonly string[] = Object.keys(ITEM_CHECKS);

/**
 * The one field this page will accept a body without, because the two services deploy separately.
 *
 * Web and api are hosted apart, so a rollout puts one of them ahead of the other for as long as
 * the second takes. With `alertsHeldForReconciliation` required, a web-first deployment turns
 * every checklist load into "the API returned a checklist this page cannot read" until the api
 * catches up — the organizer loses their whole checklist over a notice that has nothing to report
 * yet, which is a far worse outcome than the notice arriving a few minutes late.
 *
 * ABSENT IS READ AS NONE, and that is honest rather than a convenience: an api that does not know
 * about reconciliation holds is not reporting zero of them, and the page renders nothing from an
 * empty list either way. It is the same reading the api itself gives a channel with no holds.
 *
 * NARROW ON PURPOSE, and it stays narrow. Every other field is still required, so the consumed-type
 * discipline is untouched: this is one named field with a stated rollout reason, not a general
 * tolerance for missing data. It goes away when the api deployment that adds the field is the
 * oldest one in service.
 */
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

/**
 * Turn the latest plan into a checklist, and re-run the same call to review it after a
 * regeneration (AC 1 and AC 6 are one idempotent endpoint). A second call creates nothing and
 * returns the checklist that already exists, so a double click cannot duplicate anything.
 *
 * `displayedPlanId` is the plan THIS PAGE WAS SHOWING, and it is required. A review records which
 * plan the organizer read, so the api compares this against the latest plan and refuses when they
 * differ rather than quietly re-pointing the acknowledgement at a plan that arrived while the
 * organizer was reading. Sending the id the page rendered from is what makes that check possible;
 * sending the latest id fetched at click time would defeat it.
 */
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
      // The plan the organizer was reading, and where the alerts go, in one body. The contact is
      // sent WITH the conversion because that is the moment F-203 collects it: this call used to
      // carry no contact at all, so the api resolved no channel and scheduled nothing, and the
      // whole feature was unreachable from the product.
      //
      // An empty box is null rather than "", which is how the api tells "clear this" from "the
      // request said nothing about it" — and a review that submits both boxes as the organizer
      // left them is stating both, which is what should overwrite.
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
    // The api answers 409 for two different states and they are not interchangeable: the plan was
    // superseded while this page was reading it, or the EVENT was edited and the plan needs
    // regenerating first. Only the first is a re-present, and it is told apart by the field the
    // api sends with it rather than by the status code, which both share.
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

/**
 * The idempotency key for uploading this file, derived from the file itself.
 *
 * It has to survive a page reload, because the case that motivates it is an organizer whose
 * upload was interrupted, who refreshes and picks the same file again. Anything held in component
 * state, or in this tab's storage, is gone by then — so nothing is held. The key is a function of
 * what the organizer re-selects, which means re-selecting the same file reproduces it across a
 * reload, a new tab, or a restarted browser.
 *
 * `lastModified` is what keeps it honest in the other direction: a corrected file saved under the
 * same name is a different key and a different document, which is what an organizer replacing an
 * application expects. Uploading a byte-identical file to the same item twice does collapse into
 * one document, and that is the intended reading — a second copy of the same file on the same
 * requirement is the accident this exists to prevent, not a case worth preserving.
 *
 * ASCII by construction, so it is a legal header value with no encoding step of its own.
 */
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

/**
 * Stream one document up for an item (`POST /api/checklist-items/:id/documents`).
 *
 * The body is the file itself: the api reads the declared content type and length off the
 * request, which the browser sets from the `File`, and it never buffers the whole body. The
 * filename rides in a header because it is a display name only — the api generates the storage
 * key, so nothing a caller sends decides where the bytes land.
 *
 * It is percent-encoded because a header value is a ByteString: assigning "文件.pdf" or an emoji
 * name throws a `TypeError` while the request is being constructed, before a byte is sent, and
 * the throw lands in the same `catch` as a network failure. A valid PDF was unuploadable and the
 * organizer was told the API could not be reached. The api decodes it back (`decodeFilename`).
 *
 * `X-Upload-Key` is what makes a repeat harmless. The api derives the document id and the storage
 * key from it, so the same key names the same document however many times it arrives — and a
 * client that cannot observe whether a request landed no longer has to.
 */
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
    // `fetch` rejects for every failure that leaves no response, and that is not the same set as
    // "nothing was stored". A connection dropped after the body was sent, processed and committed
    // rejects here too, with the object in the bucket and the metadata row written — and the api
    // mints a fresh document id and storage key per request, so resending would store a second
    // copy. This branch used to claim nothing had been stored and invite exactly that retry.
    return { ok: false, outcome: "unknown", message: INCOMPLETE_UPLOAD };
  }

  const body = await readJson(response);
  if (!response.ok) {
    // A response usually means the api decided, and decided that nothing was stored: a refusal
    // never reached storage, and the api deletes the object whenever it establishes that the
    // metadata row is absent. The exception is the one case it cannot establish — the insert's
    // result was lost AND the lookup that would settle it also failed — and there the api says so
    // on the wire rather than leaving a bare 500 to be read as safe. Believing that read is what
    // duplicates a committed row.
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
