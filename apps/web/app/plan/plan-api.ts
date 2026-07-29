// The browser's calls to the plan and rules-meta endpoints (F-206).
//
// Web and api are separate origins behind Cloudflare Access (BASELINE.md provider baseline), so
// every call sends credentials and the api answers with `Access-Control-Allow-Credentials`.

import type {
  BranchOutcome,
  Deadline,
  DeadlineStatus,
  Disposition,
  Finding,
  FindingKind,
  FindingSource,
  MissingFact,
  PermitPlan,
  RescopeSuggestion,
  Verdict,
  VerdictDetail,
  VerificationStatus,
} from "@pop-engine/engine";
import { CREDENTIALED } from "../intake/events-api";
import {
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
} from "./validated";

/**
 * The whole body `GET /api/events/:id/plan` serves (F-201's `StoredPlan`). This documents the wire
 * contract; it is NOT what the page is handed. `PlanResponse` below narrows it to the fields that
 * have been validated, and the narrowing is what the rest of `apps/web/app/plan` sees.
 *
 * The evaluated plan is `PermitPlan`, taken from the engine rather than restated, so
 * `rulesetVersion`, `verdict`, `verdictDetail`, `findings` and `today` all track the engine's
 * declarations. What is spelled out is the api's storage envelope, and only that: those five fields
 * belong to `permit_plans`, not to the engine, and `apps/api`'s `StoredPlan` is not importable here
 * — `apps/web` depends on `@pop-engine/engine` alone, which is the boundary ARCHITECTURE draws. That
 * is a real limit and the reason this half stays hand-written.
 */
type ServedPlan = PermitPlan & {
  readonly id: string;
  readonly eventId: string;
  readonly eventRevision: number;
  /**
   * The publication date the pinned version carried, beside it (AC 4). Null on a plan generated
   * before migration 002 added the column; the banner says so rather than substituting a date.
   */
  readonly snapshotDate: string | null;
  readonly generatedAt: string;
};

/**
 * The plan's own fields this feature reads. `today`, `id` and `eventId` are absent because nothing
 * under `apps/web/app/plan` reads them — the boundary F-206 set, now enforced instead of stated:
 * they are not in the type, so reading one does not compile.
 */
export type PlanResponse = Omit<
  Pick<
    ServedPlan,
    | "eventRevision"
    | "rulesetVersion"
    | "snapshotDate"
    | "verdict"
    | "verdictDetail"
    | "generatedAt"
    | "findings"
  >,
  "findings" | "verdictDetail"
> & {
  readonly findings: readonly ConsumedFinding[];
  readonly verdictDetail: ConsumedVerdictDetail;
};

/**
 * The `Finding` members this feature reads, and only those. `slackDays` and `triggeredBy` stay
 * absent: nothing here reads them. `kind` is consumed for F-201 AC 4's near-empty framing (a
 * may-be notification confirmation is not an identified city-event permit line).
 */
export type ConsumedFinding = Omit<
  Pick<
    Finding,
    | "ruleIds"
    | "kind"
    | "disposition"
    | "name"
    | "agency"
    | "deadline"
    | "deadlineDisplay"
    | "latestApplyDate"
    | "applyAfterDate"
    | "deadlineStatus"
    | "feeDisplay"
    | "portalName"
    | "portalUrl"
    | "portalInstructions"
    | "notes"
    | "noteText"
    | "deadlineUnknownFields"
    | "timelineUnresolvedReason"
    | "conflictText"
    | "sources"
    | "verificationStatus"
    | "lastVerifiedDate"
  >,
  "deadline" | "lastVerifiedDate"
> & {
  readonly deadline: ConsumedDeadline | null;
  /** Required on the stored-plan wire even though pre-field engine replays omit it internally. */
  readonly lastVerifiedDate: string | null;
};

/**
 * The only part of a `Deadline` this feature reads: the published type, rendered when a rule states a
 * deadline kind and nothing else. The KEY is projected, so renaming it upstream stops this
 * compiling; the VALUE is deliberately widened from `Deadline["type"]`'s literal union to `string`.
 *
 * That widening is a decision, not a shortcut. The token is only humanised for display, so pinning it
 * to today's union would make the validator refuse a whole plan the moment the engine publishes a new
 * deadline kind — rejecting a valid new API response, which is the failure this mechanism exists to
 * prevent, arrived at from the other side.
 */
export type ConsumedDeadline = {
  readonly [K in keyof Pick<Deadline, "type">]: string;
};

/**
 * The `verdictDetail` members the plan page reads for F-102 copy and the branch/rescope panels.
 * Projected from the engine's `VerdictDetail` rather than restated, so an upstream rename fails
 * the typecheck instead of leaving the web build green against a silent empty panel.
 */
export type ConsumedBranchOutcome = Pick<BranchOutcome, "value" | "verdict" | "reason">;

export type ConsumedMissingFact = {
  readonly field: MissingFact["field"];
  readonly branches: readonly ConsumedBranchOutcome[];
  readonly thresholds: MissingFact["thresholds"];
};

export type ConsumedRescopeSuggestion = {
  readonly change: RescopeSuggestion["change"];
  readonly reevaluatedVerdict: RescopeSuggestion["reevaluatedVerdict"];
  readonly droppedRuleIds: RescopeSuggestion["droppedRuleIds"];
};

export type ConsumedBlockingFinding = NonNullable<VerdictDetail["blockingFinding"]>;

export type ConsumedVerdictDetail = {
  readonly minSlackDays: VerdictDetail["minSlackDays"];
  readonly missingFacts: readonly ConsumedMissingFact[];
  readonly blockingFinding: ConsumedBlockingFinding | null;
  readonly missedRuleIds: VerdictDetail["missedRuleIds"];
  readonly rescopeSuggestions: readonly ConsumedRescopeSuggestion[];
};

/**
 * What the loaded rules file says about itself, as `GET /api/rules/meta` serves it.
 *
 * Hand-written, and it cannot be projected: this is the api's own snake_case envelope, assembled in
 * `app.ts` from the loaded ruleset's `rulesetVersion`/`snapshotDate`. No engine type carries these
 * two keys in this casing, so there is nothing upstream to derive from. Recorded rather than left
 * looking like an oversight — it is the second and last unprojected shape in this file.
 */
export type RulesMetaResponse = {
  readonly ruleset_version: string;
  readonly snapshot_date: string;
};

export type PlanResult =
  | { ok: true; plan: PlanResponse }
  /**
   * `missing` separates "this event has no plan yet", which generating answers, from "a plan may
   * exist but could not be read", which it does not. The plan endpoint answers 404 for both a
   * missing plan and a missing event, so the caller confirms the event exists before offering to
   * create one — a 404 alone is not enough to justify writing an immutable plan row.
   */
  | { ok: false; missing: boolean; message: string };
export type RulesMetaResult =
  { ok: true; meta: RulesMetaResponse } | { ok: false; message: string };

export type PlanGenerationResult =
  | { ok: true; plan: PlanResponse }
  /**
   * `stored` says whether a plan row exists despite the failure. A POST that answered 2xx wrote one
   * even if nothing readable came back, and the caller has to stop describing the event as having no
   * plan — offering to generate again would write a second immutable row for one organizer action
   * (AD-7). A POST that never succeeded leaves the page's existing state alone.
   */
  | { ok: false; stored: boolean; message: string };

const UNREACHABLE = "The API could not be reached.";

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

const UNREADABLE_PLAN = "The API returned a plan this page cannot read.";

// The field checks below are complete by construction; `./validated` explains why and enforces it.

const VERDICTS = tokensOf<Verdict>({
  FEASIBLE: true,
  FEASIBLE_AT_RISK: true,
  CONDITIONAL: true,
  INFEASIBLE: true,
});

const VERIFICATION_STATUSES = tokensOf<VerificationStatus>({
  SOURCE_CONFIRMED: true,
  OFFICIAL_CONFLICT: true,
  RESEARCH_REQUIRED: true,
  COVERAGE_GAP: true,
  VERIFIED: true,
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

const DEADLINE_CHECKS: FieldChecks<ConsumedDeadline> = { type: isString };

/** Every field of a citation is read — the text, the rule it belongs to, and each URL. */
const SOURCE_CHECKS: FieldChecks<FindingSource> = {
  ruleId: isString,
  citation: isString,
  urls: arrayOf(isString),
};

const FINDING_CHECKS: FieldChecks<ConsumedFinding> = {
  ruleIds: arrayOf(isString),
  kind: isToken(FINDING_KINDS),
  disposition: isToken(DISPOSITIONS),
  name: nullOr(isString),
  agency: nullOr(isString),
  // Read for its null-ness and its published `type`; nothing else on a `Deadline` is rendered.
  deadline: nullOr(shapedLike(DEADLINE_CHECKS)),
  deadlineDisplay: nullOr(isString),
  latestApplyDate: nullOr(isString),
  applyAfterDate: nullOr(isString),
  deadlineStatus: isToken(DEADLINE_STATUSES),
  feeDisplay: nullOr(isString),
  portalName: nullOr(isString),
  portalUrl: nullOr(isString),
  portalInstructions: nullOr(isString),
  notes: arrayOf(isString),
  noteText: nullOr(isString),
  deadlineUnknownFields: arrayOf(isString),
  timelineUnresolvedReason: nullOr(isString),
  conflictText: nullOr(isString),
  sources: arrayOf(shapedLike(SOURCE_CHECKS)),
  verificationStatus: isToken(VERIFICATION_STATUSES),
  lastVerifiedDate: nullOr(isString),
};

const BRANCH_OUTCOME_CHECKS: FieldChecks<ConsumedBranchOutcome> = {
  value: isString,
  verdict: isToken(VERDICTS),
  reason: isString,
};

const MISSING_FACT_CHECKS: FieldChecks<ConsumedMissingFact> = {
  field: isString,
  branches: arrayOf(shapedLike(BRANCH_OUTCOME_CHECKS)),
  thresholds: nullOr(isString),
};

const RESCOPE_CHANGE_CHECKS: FieldChecks<RescopeSuggestion["change"]> = {
  field: isString,
  value: isString,
};

const RESCOPE_CHECKS: FieldChecks<ConsumedRescopeSuggestion> = {
  change: shapedLike(RESCOPE_CHANGE_CHECKS),
  reevaluatedVerdict: isToken(VERDICTS),
  droppedRuleIds: arrayOf(isString),
};

const BLOCKING_FINDING_CHECKS: FieldChecks<ConsumedBlockingFinding> = {
  ruleIds: arrayOf(isString),
  name: nullOr(isString),
};

const VERDICT_DETAIL_CHECKS: FieldChecks<ConsumedVerdictDetail> = {
  minSlackDays: nullOr(isNumber),
  missingFacts: arrayOf(shapedLike(MISSING_FACT_CHECKS)),
  blockingFinding: nullOr(shapedLike(BLOCKING_FINDING_CHECKS)),
  missedRuleIds: arrayOf(isString),
  rescopeSuggestions: arrayOf(shapedLike(RESCOPE_CHECKS)),
};

const PLAN_CHECKS: FieldChecks<PlanResponse> = {
  eventRevision: isNumber,
  rulesetVersion: isString,
  // A plan that omits the field entirely is unreadable, not legacy. Only an explicit null means
  // "generated before migration 002", and that is the one case the banner may say so for; reading
  // an absent field as null would put that copy under a plumbing mismatch instead.
  snapshotDate: nullOr(isString),
  verdict: isToken(VERDICTS),
  verdictDetail: shapedLike(VERDICT_DETAIL_CHECKS),
  generatedAt: isString,
  findings: arrayOf(shapedLike(FINDING_CHECKS)),
};

/** The plan fields and finding members this feature reads, exposed so a test can assert coverage. */
export const CONSUMED_PLAN_FIELDS: readonly string[] = Object.keys(PLAN_CHECKS);
export const CONSUMED_FINDING_FIELDS: readonly string[] = Object.keys(FINDING_CHECKS);

const readPlan = (body: unknown): PlanResponse | null => readChecked(PLAN_CHECKS, body);

/** The plan a set of findings was generated as (`GET /api/events/:id/plan`). */
export async function loadPlan(apiBaseUrl: string, eventId: string): Promise<PlanResult> {
  let response: Response;
  try {
    response = await fetch(`${apiBaseUrl}/api/events/${eventId}/plan`, { ...CREDENTIALED });
  } catch {
    return { ok: false, missing: false, message: UNREACHABLE };
  }

  const body = await readJson(response);
  if (!response.ok) {
    return {
      ok: false,
      missing: response.status === 404,
      message: failureMessage(
        body,
        response.status === 404
          ? "No plan has been generated for this event yet."
          : `The plan could not be loaded (HTTP ${response.status}).`,
      ),
    };
  }

  const plan = readPlan(body);
  if (plan === null) return { ok: false, missing: false, message: UNREADABLE_PLAN };
  return { ok: true, plan };
}

/**
 * Generate a plan for this event and return the plan that was stored.
 *
 * `POST /api/events/:id/plan` answers 201 with the complete plan it just wrote, so this installs
 * that rather than throwing it away and asking for the same plan again. Re-reading made the plan
 * the organizer had just created conditional on a second request: a slow one left the old plan on
 * screen, and a failed one replaced it with "could not be read" for a plan that exists — and in
 * that state the regenerate button disappears, so there was no way to retry without a reload.
 *
 * The GET survives for exactly one case: the POST succeeded but its body is not readable as a plan.
 * A plan row was still written, so reporting a failure would be wrong about what happened, and
 * POSTing again would write a second immutable row for one organizer action (AD-7). Re-reading is
 * the only way to show what was created, so that is where a re-read is genuinely necessary.
 */
export async function generatePlan(
  apiBaseUrl: string,
  eventId: string,
): Promise<PlanGenerationResult> {
  let response: Response;
  try {
    response = await fetch(`${apiBaseUrl}/api/events/${eventId}/plan`, {
      method: "POST",
      ...CREDENTIALED,
    });
  } catch {
    return { ok: false, stored: false, message: UNREACHABLE };
  }

  const body = await readJson(response);
  if (!response.ok) {
    return {
      ok: false,
      stored: false,
      message: failureMessage(body, `The plan could not be generated (HTTP ${response.status}).`),
    };
  }

  const plan = readPlan(body);
  if (plan !== null) return { ok: true, plan };

  const reread = await loadPlan(apiBaseUrl, eventId);
  return reread.ok
    ? { ok: true, plan: reread.plan }
    : { ok: false, stored: true, message: UNREADABLE_PLAN };
}

/**
 * What the api's own rules file says about itself. The banner needs it to tell an organizer
 * when a plan was generated from an older ruleset than the one now published.
 */
export async function loadRulesMeta(apiBaseUrl: string): Promise<RulesMetaResult> {
  let response: Response;
  try {
    response = await fetch(`${apiBaseUrl}/api/rules/meta`, { ...CREDENTIALED });
  } catch {
    return { ok: false, message: UNREACHABLE };
  }

  const body = await readJson(response);
  if (!response.ok) {
    return {
      ok: false,
      message: failureMessage(
        body,
        `The ruleset version could not be read (HTTP ${response.status}).`,
      ),
    };
  }

  const meta = asRecord(body);
  if (
    meta === null ||
    typeof meta.ruleset_version !== "string" ||
    typeof meta.snapshot_date !== "string"
  ) {
    return { ok: false, message: "The API returned a ruleset version this page cannot read." };
  }
  return { ok: true, meta: meta as unknown as RulesMetaResponse };
}
