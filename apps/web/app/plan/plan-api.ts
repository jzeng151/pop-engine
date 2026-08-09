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
  FindingRoute,
  FindingSource,
  HeadlineMode,
  MissingFact,
  PermitPlan,
  RuleUserSummary,
  RescopeSuggestion,
  SummarySourceLink,
  Tristate,
  UnresolvedTimeline,
  UserSummaryPoint,
  UserSummaryPointKind,
  Verdict,
  VerdictDetail,
  VerificationStatus,
} from "@pop-engine/engine";
import { CREDENTIALED } from "../intake/events-api";
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
 * The `Finding` members this feature reads, and only those. `kind`, `slackDays` and `triggeredBy`
 * are deliberately absent: nothing here reads them, so they stay the engine's schema to police
 * rather than the client's — F-206's boundary, unchanged, and now enforced the same way.
 *
 * `kind` was briefly consumed, to decide whether a finding was the sort of filing that could carry a
 * fee, so that a null `feeDisplay` could be reported as an unpublished amount. That split is
 * withdrawn: an absent fee and an explicit `fee: null` are one value by the time a finding carries
 * one, so no reading of `kind` could say which a given finding was, and deciding it from what OTHER
 * rules of the same kind publish is a claim about this filing taken from a fact about another. A
 * null fee now renders nothing, which needs no kind.
 */
export type ConsumedFinding = Omit<
  Pick<
    Finding,
    | "ruleIds"
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
    | "userSummary"
    | "verificationStatus"
    | "lastVerifiedDate"
  >,
  "deadline" | "lastVerifiedDate" | "userSummary"
> & {
  readonly deadline: ConsumedDeadline | null;
  /** Required on the stored-plan wire even though pre-field engine replays omit it internally. */
  readonly lastVerifiedDate: string | null;
  /** Normalized to null for plans stored before organizer summaries existed. */
  readonly userSummary?: RuleUserSummary | null;
  /**
   * Every contributing route of a merged line. Null on an unmerged line and on plans stored before
   * the field existed; never an empty array.
   */
  readonly routes?: readonly ConsumedRoute[] | null;
  /** Present exactly when `routes` is non-null. */
  readonly headlineMode?: HeadlineMode | null;
};

/** One contributing rule of a merged line, with its own published values. */
export type ConsumedRoute = Omit<
  Pick<
    FindingRoute,
    | "ruleId"
    | "triggerResult"
    | "disposition"
    | "unknownFields"
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
  >,
  "deadline"
> & {
  /**
   * Read for the same one reason the finding's is: `businessDayNotice` discriminates on the
   * published deadline TYPE, and a route whose window is `not_calculable` has no other way to say
   * what its exact date turns on (F-201 AC 13). Widened to `ConsumedDeadline` for the reason given
   * there, so a new engine deadline kind does not make the validator refuse the whole plan.
   */
  readonly deadline: ConsumedDeadline | null;
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
  /** Null when unpublished or when a pre-thresholds stored plan omitted the key. */
  readonly thresholds: string | null;
};

export type ConsumedRescopeSuggestion = {
  readonly change: RescopeSuggestion["change"];
  readonly reevaluatedVerdict: RescopeSuggestion["reevaluatedVerdict"];
  readonly droppedRuleIds: RescopeSuggestion["droppedRuleIds"];
  /** Empty when omitted on a historical three-field suggestion. */
  readonly introducedRuleIds: readonly string[];
  /** Empty when omitted on a plan generated before human-readable rescope labels. */
  readonly introducedFindings: NonNullable<RescopeSuggestion["introducedFindings"]>;
  /** Empty when omitted on a historical rescope. */
  readonly remainingMissingFields: readonly string[];
  /** Empty when omitted on a historical rescope. */
  readonly remainingTimelineReasons: readonly string[];
  /** Null when omitted on a historical three-field suggestion or when not at-risk. */
  readonly minSlackDays: number | null;
  readonly atRiskFindingName: string | null;
};

export type ConsumedUnresolvedTimeline = Pick<UnresolvedTimeline, "ruleIds" | "reason">;

export type ConsumedBlockingFinding = NonNullable<VerdictDetail["blockingFinding"]>;

export type ConsumedVerdictDetail = {
  readonly minSlackDays: VerdictDetail["minSlackDays"];
  readonly missingFacts: readonly ConsumedMissingFact[];
  readonly blockingFinding: ConsumedBlockingFinding | null;
  readonly missedRuleIds: VerdictDetail["missedRuleIds"];
  readonly unresolvedTimelines: readonly ConsumedUnresolvedTimeline[];
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

const USER_SUMMARY_POINT_KINDS = tokensOf<UserSummaryPointKind>({
  overview: true,
  deadline: true,
  fee: true,
  action: true,
  warning: true,
});

const SUMMARY_SOURCE_CHECKS: FieldChecks<SummarySourceLink> = {
  label: isString,
  url: isString,
};

const SUMMARY_POINT_CHECKS: FieldChecks<UserSummaryPoint> = {
  kind: isToken(USER_SUMMARY_POINT_KINDS),
  text: isString,
  sources: arrayOf(shapedLike(SUMMARY_SOURCE_CHECKS)),
};

const USER_SUMMARY_CHECKS: FieldChecks<RuleUserSummary> = {
  heading: isString,
  points: arrayOf(shapedLike(SUMMARY_POINT_CHECKS)),
};

/** Every field of a citation is read — the text, the rule it belongs to, and each URL. */
const SOURCE_CHECKS: FieldChecks<FindingSource> = {
  ruleId: isString,
  citation: isString,
  urls: arrayOf(isString),
};

export const HEADLINE_MODES = tokensOf<HeadlineMode>({ applies_together: true, candidate: true });

/**
 * A route is never "false": a trigger that resolves false produces no finding to merge, so the
 * F-201 route contract publishes exactly two results.
 *
 * NARROWED HERE RATHER THAN LEFT AS THE FULL `Tristate`, because this is the wire boundary and the
 * whole point of the boundary is to refuse what the contract does not permit. Validating against
 * the union let a stored or upstream `triggerResult: "false"` through `readPlan`, and a plan
 * carrying one with `headlineMode: "applies_together"` renders "the answers recorded in this plan
 * meet each route's own conditions" over a route whose own trigger says it does not (#252 review).
 * The route list then reads as a settled statement built out of a value the contract has no
 * meaning for.
 */
const TRIGGER_RESULTS = tokensOf<Exclude<Tristate, "false">>({ true: true, unknown: true });

export const ROUTE_CHECKS: FieldChecks<ConsumedRoute> = {
  ruleId: isString,
  triggerResult: isToken(TRIGGER_RESULTS),
  disposition: isToken(DISPOSITIONS),
  unknownFields: arrayOf(isString),
  name: nullOr(isString),
  agency: nullOr(isString),
  // Read for its null-ness and its published `type`, the same two things the finding's is read for.
  deadline: nullOr(shapedLike(DEADLINE_CHECKS)),
  deadlineDisplay: nullOr(isString),
  latestApplyDate: nullOr(isString),
  applyAfterDate: nullOr(isString),
  deadlineStatus: isToken(DEADLINE_STATUSES),
  feeDisplay: nullOr(isString),
  portalName: nullOr(isString),
  portalUrl: nullOr(isString),
  portalInstructions: nullOr(isString),
};

const FINDING_CHECKS: FieldChecks<ConsumedFinding> = {
  ruleIds: arrayOf(isString),
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
  userSummary: (value: unknown): value is RuleUserSummary | null =>
    value === undefined || value === null || shapedLike(USER_SUMMARY_CHECKS)(value),
  verificationStatus: isToken(VERIFICATION_STATUSES),
  lastVerifiedDate: nullOr(isString),
  routes: (value: unknown): value is readonly ConsumedRoute[] | null =>
    value === undefined || value === null || atLeast(2, arrayOf(shapedLike(ROUTE_CHECKS)))(value),
  headlineMode: (value: unknown): value is HeadlineMode | null =>
    value === undefined || value === null || isToken(HEADLINE_MODES)(value),
};

/**
 * What the route list and its headline mode SAY TOGETHER, which no per-field check can see.
 *
 * The two findings this closes are one shape: a body whose every field is a permitted token, in a
 * combination the contract has no meaning for, read downstream as a settled statement. `readChecked`
 * runs one predicate per field, so a cross-field rule has nowhere to live but here.
 *
 * `applies_together` IS A CLAIM ABOUT EVERY ROUTE. The routes block renders it as "the answers
 * recorded in this plan meet each route's own conditions", so a route whose own `triggerResult` is
 * `unknown` under that mode has the page telling the organizer their answers settled a question
 * they have not answered. Narrowing `TRIGGER_RESULTS` to exclude `"false"` refused one token; it did
 * not refuse this pairing, which is built entirely out of tokens the contract permits (#252 review).
 * `candidate` is the mode for the routes we cannot yet tell apart, so at least one must be `unknown`.
 *
 * A ROUTE LIST IS A MERGE, so it has at least two entries. `candidateRoutesOf` and `Routes` both
 * test `length > 1` before treating a line as merged, so a one-entry list passed the shape check and
 * was then read as unmerged: a `candidate` line fell back to the permit heading and the deciding
 * question it exists to ask was not shown, an incomplete route set presented as a complete line.
 *
 * THE TWO FIELDS ARE PRESENT TOGETHER OR ABSENT TOGETHER, which is what the engine's own type says
 * (`Finding.headlineMode`: "Present exactly when `routes` is") and what nothing enforced. The mode
 * was previously read only to select which rule to apply, so a list carrying a valid multi-route
 * `routes` and no mode at all fell through every branch and was accepted. `Routes` then returns null
 * because the mode is missing, and the page renders the binding scalar alone: the other route's
 * name, window, fee and portal are gone from a line that has them, and a partial merged plan reads
 * as a complete one. The reverse pairing is refused for the same reason: a mode with no list is a
 * claim about routes the body did not send. Neither is a shape the engine emits, so both are
 * rejected here rather than given a meaning downstream (#252 review).
 *
 * SHARED WITH THE CHECKLIST BOUNDARY, which serves the same two fields on `PlanContext` and applied
 * none of this. `PlanContextBody` reads routes only in `candidate` mode, so a checklist row could
 * carry `triggerResult: "unknown"` under `applies_together` and have the deciding question
 * suppressed on the surface where the organizer works the item. One rule, both doors.
 */
export const routeContractHolds = (carrier: {
  readonly ruleIds: readonly string[];
  readonly routes?: readonly ConsumedRoute[] | null;
  readonly headlineMode?: HeadlineMode | null;
}): boolean => {
  const routes = carrier.routes ?? null;
  const mode = carrier.headlineMode ?? null;
  if (routes === null || mode === null) return routes === null && mode === null;
  if (!routesMatchRuleIds(routes, carrier.ruleIds)) return false;
  if (mode === "applies_together") {
    return routes.every((route) => route.triggerResult === "true");
  }
  return routes.some((route) => route.triggerResult === "unknown");
};

/**
 * ONE ROUTE PER CONTRIBUTING RULE, AND THE SAME RULES THE LINE ALREADY NAMES. `mergeGroup()` builds
 * `routes` and `ruleIds` from one group, so the two carry the same rule ids and each id once. Every
 * check above reads the list's shape and its trigger results; none read it against the ids the
 * carrier itself publishes, so a body declaring `ruleIds: ["A", "B"]` beside two routes both named
 * `A`, or beside routes for unrelated rules, cleared the boundary. The page then renders the
 * duplicate and B's window, fee and portal are absent from a line that names B: an incomplete
 * merged plan presented as a complete one, which is the same failure the one-entry list produced
 * (#252 review). Comparing sizes and membership refuses both the duplicate and the mismatch, and
 * refuses a repeated `ruleIds` entry with them.
 */
const routesMatchRuleIds = (
  routes: readonly ConsumedRoute[],
  ruleIds: readonly string[],
): boolean => {
  const routeIds = new Set(routes.map((route) => route.ruleId));
  const namedIds = new Set(ruleIds);
  return (
    routeIds.size === routes.length &&
    namedIds.size === ruleIds.length &&
    routeIds.size === namedIds.size &&
    ruleIds.every((ruleId) => routeIds.has(ruleId))
  );
};

const isConsumedFinding = (value: unknown): value is ConsumedFinding =>
  shapedLike(FINDING_CHECKS)(value) && routeContractHolds(value);

const BRANCH_OUTCOME_CHECKS: FieldChecks<ConsumedBranchOutcome> = {
  value: isString,
  verdict: isToken(VERDICTS),
  reason: isString,
};

/** Absent thresholds on pre-field stored plans normalize to null (legacy). */
const optionalNullString = (value: unknown): value is string | null =>
  value === undefined || value === null || typeof value === "string";

const optionalNullNumber = (value: unknown): value is number | null =>
  value === undefined || value === null || typeof value === "number";

const MISSING_FACT_CHECKS: FieldChecks<ConsumedMissingFact> = {
  field: isString,
  branches: arrayOf(shapedLike(BRANCH_OUTCOME_CHECKS)),
  thresholds: optionalNullString,
};

const RESCOPE_CHANGE_CHECKS: FieldChecks<RescopeSuggestion["change"]> = {
  field: isString,
  value: isString,
};

type IntroducedFinding = ConsumedRescopeSuggestion["introducedFindings"][number];

const INTRODUCED_FINDING_CHECKS: FieldChecks<IntroducedFinding> = {
  ruleIds: arrayOf(isString),
  label: nullOr(isString),
  source: nullOr(shapedLike(SUMMARY_SOURCE_CHECKS)),
  portalName: nullOr(isString),
  portalUrl: nullOr(isString),
};

const RESCOPE_CHECKS: FieldChecks<ConsumedRescopeSuggestion> = {
  change: shapedLike(RESCOPE_CHANGE_CHECKS),
  reevaluatedVerdict: isToken(VERDICTS),
  droppedRuleIds: arrayOf(isString),
  // Pre-enrichment stored plans omit these; accept absence and normalize below.
  introducedRuleIds: (value: unknown): value is readonly string[] =>
    value === undefined || arrayOf(isString)(value),
  introducedFindings: (value: unknown): value is readonly IntroducedFinding[] =>
    value === undefined || arrayOf(shapedLike(INTRODUCED_FINDING_CHECKS))(value),
  remainingMissingFields: (value: unknown): value is readonly string[] =>
    value === undefined || arrayOf(isString)(value),
  remainingTimelineReasons: (value: unknown): value is readonly string[] =>
    value === undefined || arrayOf(isString)(value),
  minSlackDays: optionalNullNumber,
  atRiskFindingName: optionalNullString,
};

// Everything below `name` is absent on plans stored before the blocker carried its own published
// values, so each accepts `undefined`. A consumer renders what is there and nothing where it is not.
const BLOCKING_FINDING_CHECKS: FieldChecks<ConsumedBlockingFinding> = {
  ruleIds: arrayOf(isString),
  name: nullOr(isString),
  agency: absentOr(nullOr(isString)),
  disposition: absentOr(isToken(DISPOSITIONS)),
  deadlineDisplay: absentOr(nullOr(isString)),
  latestApplyDate: absentOr(nullOr(isString)),
  deadlineStatus: absentOr(isToken(DEADLINE_STATUSES)),
  feeDisplay: absentOr(nullOr(isString)),
  portalName: absentOr(nullOr(isString)),
  portalUrl: absentOr(nullOr(isString)),
  portalInstructions: absentOr(nullOr(isString)),
  sources: (value: unknown): value is readonly FindingSource[] | undefined =>
    value === undefined || arrayOf(shapedLike(SOURCE_CHECKS))(value),
  userSummary: (value: unknown): value is RuleUserSummary | null | undefined =>
    value === undefined || value === null || shapedLike(USER_SUMMARY_CHECKS)(value),
};

const UNRESOLVED_TIMELINE_CHECKS: FieldChecks<ConsumedUnresolvedTimeline> = {
  ruleIds: arrayOf(isString),
  reason: isString,
};

const VERDICT_DETAIL_CHECKS: FieldChecks<ConsumedVerdictDetail> = {
  minSlackDays: nullOr(isNumber),
  missingFacts: arrayOf(shapedLike(MISSING_FACT_CHECKS)),
  blockingFinding: nullOr(shapedLike(BLOCKING_FINDING_CHECKS)),
  missedRuleIds: arrayOf(isString),
  // Older stored plans may omit this array; treat absence as empty.
  unresolvedTimelines: (value: unknown): value is readonly ConsumedUnresolvedTimeline[] =>
    value === undefined || arrayOf(shapedLike(UNRESOLVED_TIMELINE_CHECKS))(value),
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
  findings: arrayOf(isConsumedFinding),
};

/** The plan fields and finding members this feature reads, exposed so a test can assert coverage. */
export const CONSUMED_PLAN_FIELDS: readonly string[] = Object.keys(PLAN_CHECKS);
/**
 * Members a stored plan may legitimately omit, because it was written before the field existed.
 * Each is normalized to `null` below, so the page never has to tell "absent" from "no value".
 */
const OPTIONAL_FINDING_FIELDS: readonly string[] = ["userSummary", "routes", "headlineMode"];

export const CONSUMED_FINDING_FIELDS: readonly string[] = Object.keys(FINDING_CHECKS).filter(
  (field) => !OPTIONAL_FINDING_FIELDS.includes(field),
);

function normalizePlan(plan: PlanResponse): PlanResponse {
  return {
    ...plan,
    findings: plan.findings.map((finding) => ({
      ...finding,
      userSummary: finding.userSummary ?? null,
      routes: finding.routes ?? null,
      headlineMode: finding.headlineMode ?? null,
    })),
    verdictDetail: {
      ...plan.verdictDetail,
      unresolvedTimelines: plan.verdictDetail.unresolvedTimelines ?? [],
      missingFacts: plan.verdictDetail.missingFacts.map((fact) => ({
        ...fact,
        thresholds: fact.thresholds ?? null,
      })),
      rescopeSuggestions: plan.verdictDetail.rescopeSuggestions.map((suggestion) => ({
        ...suggestion,
        introducedRuleIds: suggestion.introducedRuleIds ?? [],
        introducedFindings: suggestion.introducedFindings ?? [],
        remainingMissingFields: suggestion.remainingMissingFields ?? [],
        remainingTimelineReasons: suggestion.remainingTimelineReasons ?? [],
        minSlackDays: suggestion.minSlackDays ?? null,
        atRiskFindingName: suggestion.atRiskFindingName ?? null,
      })),
    },
  };
}

const readPlan = (body: unknown): PlanResponse | null => {
  const plan = readChecked(PLAN_CHECKS, body);
  return plan === null ? null : normalizePlan(plan);
};

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
