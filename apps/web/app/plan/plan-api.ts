// The browser's calls to the plan and rules-meta endpoints (F-206).

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
import {
  PUBLISHED_ROUTE_FIELDS,
  bindingRouteOf,
  branchesForceInfeasible,
  canBlockWhenMissed,
  mergedDispositionOf,
  noRouteSuppliesScalars,
  windowIsMissed,
} from "@pop-engine/engine";
import { CREDENTIALED } from "../_lib/events-api";
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

/** The whole body `GET /api/events/:id/plan` serves (F-201's `StoredPlan`). */
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

/** The `Finding` members this feature reads, and only those. */
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
  /** Read for the same one reason the finding's is: `businessDayNotice` discriminates on the published deadline TYPE, and a route whose window is `not_calculable` has no other way to say what its exact date turns on (F-201 AC 13). */
  readonly deadline: ConsumedDeadline | null;
  /** This route's own published notes. */
  readonly notes?: readonly string[];
  /** This route's own `conflictText`: both readings of an OFFICIAL_CONFLICT rule, verbatim. */
  readonly conflictText?: string | null;
};

/** The only part of a `Deadline` this feature reads: the published type, rendered when a rule states a deadline kind and nothing else. */
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
  /** One `{ruleId, result}` per evaluated rule, read for one reason: an UNMERGED finding carries no route list, so this is the only place its own trigger result is recorded. */
  readonly trace?: readonly ConsumedTraceEntry[];
};

/** The engine's own trace entry. `false` is included: every rule is traced, not only the triggered. */
export type ConsumedTraceEntry = { readonly ruleId: string; readonly result: Tristate };

/** What the loaded rules file says about itself, as `GET /api/rules/meta` serves it. */
export type RulesMetaResponse = {
  readonly ruleset_version: string;
  readonly snapshot_date: string;
};

export type PlanResult =
  | { ok: true; plan: PlanResponse }
  /** `missing` separates "this event has no plan yet", which generating answers, from "a plan may exist but could not be read", which it does not. */
  | { ok: false; missing: boolean; message: string };
export type RulesMetaResult =
  { ok: true; meta: RulesMetaResponse } | { ok: false; message: string };

export type PlanGenerationResult =
  | { ok: true; plan: PlanResponse }
  /** `stored` says whether a plan row exists despite the failure. */
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

/** A route is never "false": a trigger that resolves false produces no finding to merge, so the F-201 route contract publishes exactly two results. */
const TRIGGER_RESULTS = tokensOf<Exclude<Tristate, "false">>({ true: true, unknown: true });

/**
 * The trace's tokens, which are the WHOLE tristate rather than the two a route can publish:
 * `evaluate` traces every rule it reads, including the ones whose triggers came back `false` and
 * produced no finding at all.
 */
const TRACE_RESULTS = tokensOf<Tristate>({ true: true, unknown: true, false: true });

export const ROUTE_CHECKS: FieldChecks<ConsumedRoute> = {
  notes: (value: unknown): value is readonly string[] | undefined =>
    value === undefined || arrayOf(isString)(value),
  conflictText: (value: unknown): value is string | null | undefined =>
    value === undefined || value === null || isString(value),
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

/** What the route list and its headline mode SAY TOGETHER, which no per-field check can see. */
export const routeContractHolds = (carrier: {
  readonly ruleIds: readonly string[];
  readonly routes?: readonly ConsumedRoute[] | null;
  readonly headlineMode?: HeadlineMode | null;
}): boolean => {
  const routes = carrier.routes ?? null;
  const mode = carrier.headlineMode ?? null;
  if (routes === null || mode === null) return routes === null && mode === null;
  if (!routesMatchRuleIds(routes, carrier.ruleIds)) return false;
  if (!routes.every(unknownFieldsMatchTriggerResult)) return false;
  if (mode === "applies_together") {
    return routes.every((route) => route.triggerResult === "true");
  }
  return routes.some((route) => route.triggerResult === "unknown");
};

/** AN UNRESOLVED ROUTE NAMES WHAT WOULD SETTLE IT, AND A RESOLVED ONE NAMES NOTHING. */
const unknownFieldsMatchTriggerResult = (route: ConsumedRoute): boolean =>
  route.triggerResult === "unknown"
    ? route.unknownFields.length > 0
    : route.unknownFields.length === 0;

/** ONE ROUTE PER CONTRIBUTING RULE, AND THE SAME RULES THE LINE ALREADY NAMES. */
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

/** THE HEADLINE IS THE BINDING ROUTE'S, AND THE BINDING ROUTE IS `routes[0]`. */
const HEADLINE_SCALARS = [
  "name",
  "agency",
  "deadlineDisplay",
  "latestApplyDate",
  "applyAfterDate",
  "deadlineStatus",
  "feeDisplay",
  "portalName",
  "portalUrl",
  "portalInstructions",
] as const satisfies readonly (keyof ConsumedFinding & keyof ConsumedRoute)[];

/** ONE NOTION OF "AGREES WITH A ROUTE", shared by every tuple that claims to come from one. */
export const agreesWithRoute = <Carrier extends object>(
  record: Carrier,
  route: ConsumedRoute,
  fields: readonly (keyof Carrier & keyof ConsumedRoute)[],
): boolean => {
  // Compare only the published deadline type; some carriers intentionally omit deadlines.
  const carried = (record as { readonly deadline?: ConsumedDeadline | null }).deadline;
  if (carried !== undefined && (carried?.type ?? null) !== (route.deadline?.type ?? null)) {
    return false;
  }
  return fields.every((field) => (record[field] as unknown) === (route[field] as unknown));
};

const publishesNoScalars = (finding: ConsumedFinding): boolean =>
  finding.deadlineStatus === "not_calculable" &&
  finding.deadline === null &&
  HEADLINE_SCALARS.every((field) => field === "deadlineStatus" || finding[field] === null) &&
  noRouteSuppliesScalars((finding.routes ?? []) as readonly FindingRoute[]);

/** `routes[0]` IS THE BINDING ROUTE, WHICH WAS ASSUMED AND IS NOW CHECKED. */
const bindsWhereTheEngineWouldBind = (finding: ConsumedFinding): boolean => {
  const routes = (finding.routes ?? []) as readonly FindingRoute[];
  const binding = bindingRouteOf(routes);
  return binding === null || binding.ruleId === routes[0]?.ruleId;
};

const headlineMatchesBinding = (finding: ConsumedFinding): boolean => {
  const binding = finding.routes?.[0];
  if (binding === undefined) return true;
  if (publishesNoScalars(finding)) return true;
  return agreesWithRoute(finding, binding, HEADLINE_SCALARS);
};

/** THE ONE HEADLINE VALUE THAT IS NOT `routes[0]`'S STILL HAS TO FOLLOW FROM THE ROUTES. */
const dispositionFollowsFromRoutes = (finding: ConsumedFinding): boolean => {
  const routes = (finding.routes ?? []) as readonly FindingRoute[];
  if (routes.length === 0) return true;
  return finding.disposition === mergedDispositionOf(routes);
};

const isConsumedFinding = (value: unknown): value is ConsumedFinding =>
  shapedLike(FINDING_CHECKS)(value) &&
  routeContractHolds(value) &&
  dispositionFollowsFromRoutes(value) &&
  bindsWhereTheEngineWouldBind(value) &&
  headlineMatchesBinding(value);

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

/** The keys `verdict.ts` added to `blockingFinding` when it started narrowing the blocker to its own route. */
export const WIDENED_BLOCKER_KEYS: readonly (keyof ConsumedBlockingFinding)[] = [
  "agency",
  "disposition",
  "deadlineDisplay",
  "latestApplyDate",
  "deadlineStatus",
  "feeDisplay",
  "portalName",
  "portalUrl",
  "portalInstructions",
  "sources",
  "userSummary",
];

/** ALL OF THE WIDENED KEYS OR NONE OF THEM, because the consumer reads their presence as a version. */
const blockerWideningIsComplete = (blocker: ConsumedBlockingFinding): boolean => {
  const present = WIDENED_BLOCKER_KEYS.filter((key) => key in blocker).length;
  return present === 0 || present === WIDENED_BLOCKER_KEYS.length;
};

const isConsumedBlockingFinding = (value: unknown): value is ConsumedBlockingFinding =>
  shapedLike(BLOCKING_FINDING_CHECKS)(value) && blockerWideningIsComplete(value);

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
  blockingFinding: nullOr(isConsumedBlockingFinding),
  missedRuleIds: arrayOf(isString),
  // Older stored plans may omit this array; treat absence as empty.
  unresolvedTimelines: (value: unknown): value is readonly ConsumedUnresolvedTimeline[] =>
    value === undefined || arrayOf(shapedLike(UNRESOLVED_TIMELINE_CHECKS))(value),
  rescopeSuggestions: arrayOf(shapedLike(RESCOPE_CHECKS)),
  trace: (value: unknown): value is readonly ConsumedTraceEntry[] | undefined =>
    value === undefined || arrayOf(shapedLike(TRACE_CHECKS))(value),
};

const TRACE_CHECKS: FieldChecks<ConsumedTraceEntry> = {
  ruleId: isString,
  result: isToken(TRACE_RESULTS),
};

const PLAN_CHECKS: FieldChecks<PlanResponse> = {
  eventRevision: isNumber,
  rulesetVersion: isString,
  // A plan that omits the field entirely is unreadable, not legacy.
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

/** The widened blocker's values, checked against the route its own `ruleIds` name. */
const BLOCKER_ROUTE_FIELDS = [
  "name",
  "agency",
  "disposition",
  "deadlineDisplay",
  "latestApplyDate",
  "deadlineStatus",
  "feeDisplay",
  "portalName",
  "portalUrl",
  "portalInstructions",
] as const satisfies readonly (keyof ConsumedBlockingFinding & keyof ConsumedRoute)[];

/** The trigger result the plan recorded for one rule, or null where it recorded none. */
const triggerResultOf = (plan: PlanResponse, ruleId: string): Tristate | null =>
  (plan.verdictDetail.trace ?? []).find((entry) => entry.ruleId === ruleId)?.result ?? null;

const blockerIsANarrowedMissedRoute = (plan: PlanResponse): boolean => {
  const blocker = plan.verdictDetail.blockingFinding;

  // TWO SHAPES MAKE NO CLAIM, and they are the only two accepted without evaluating the conditions.
  if (blocker === null) return true;
  if (!WIDENED_BLOCKER_KEYS.some((key) => key in blocker)) return true;

  // 1. It names one rule.
  if (blocker.ruleIds.length !== 1) return false;
  const ruleId = blocker.ruleIds[0] as string;

  // 2.
  const finding = plan.findings.find((entry) => entry.ruleIds.includes(ruleId));
  if (finding === undefined) return false;

  // 3.
  if (!plan.verdictDetail.missedRuleIds.includes(ruleId)) return false;

  // TWO SHAPES THE ENGINE PRODUCES, AND ONLY ONE OF THEM IS THE RETURNED FINDING.
  if (narrowedBlockerHolds(plan, blocker, finding, ruleId)) return true;

  // WHAT A PROMOTED BLOCKER CAN BE CHECKED AGAINST, which is not the base tuple.
  const branchVerdicts = plan.verdictDetail.missingFacts.flatMap((fact) =>
    fact.branches.map((branch) => branch.verdict),
  );
  if (!branchesForceInfeasible(branchVerdicts)) return false;
  const publisher = (finding.routes ?? []).find((entry) => entry.ruleId === ruleId) ?? finding;
  const immutable = BLOCKER_ROUTE_FIELDS.filter((field) =>
    (PUBLISHED_ROUTE_FIELDS as readonly string[]).includes(field),
  );
  if (
    immutable.some(
      (field) =>
        blocker[field] !== undefined &&
        (blocker[field] as unknown) !== (publisher[field] as unknown),
    )
  ) {
    return false;
  }
  // ITS CITATIONS ARE THE NAMED ROUTE'S OWN, BY VALUE.
  return sourcesAreTheRoutesOwn(blocker, finding, ruleId);
};

/** The blocker's citations are the named rule's own, by value. */
const sourcesAreTheRoutesOwn = (
  blocker: ConsumedBlockingFinding,
  finding: ConsumedFinding,
  ruleId: string,
): boolean => {
  if (blocker.sources === undefined) return true;
  const own = (finding.sources ?? []).filter((source) => source.ruleId === ruleId);
  return JSON.stringify(blocker.sources) === JSON.stringify(own);
};

/** Conditions 4 to 7: the blocker IS the returned finding, narrowed to the route it names. */
const narrowedBlockerHolds = (
  plan: PlanResponse,
  blocker: ConsumedBlockingFinding,
  finding: ConsumedFinding,
  ruleId: string,
): boolean => {
  // 4. Its citations are that rule's. `blockerView` filters rather than copies, so this is set
  //    equality against the finding's own sources for that rule.
  if (!sourcesAreTheRoutesOwn(blocker, finding, ruleId)) return false;

  // 5. Its summary is the null the engine writes, on a merged finding.
  const merged = (finding.routes?.length ?? 0) > 1;
  if (merged && blocker.userSummary !== undefined && blocker.userSummary !== null) return false;

  // 6. Its published values are that route's. An unmerged finding is its own route; a merged one
  //    that does not carry the named route is a route list disagreeing with its own blocker.
  const route = (finding.routes ?? []).find((entry) => entry.ruleId === ruleId);
  if (route === undefined) {
    if (finding.routes != null) return false;
    // 7 on an unmerged finding, whose trigger result is READ rather than assumed.
    const traced = triggerResultOf(plan, ruleId);
    if (traced === null) return false;
    if (
      !windowIsMissed(finding) ||
      !canBlockWhenMissed(
        { disposition: finding.disposition, triggerResult: traced },
        finding.verificationStatus,
      )
    ) {
      return false;
    }
    return BLOCKER_ROUTE_FIELDS.every(
      (field) => (blocker[field] as unknown) === (finding[field] as unknown),
    );
  }

  // 7. It is a route a missed window may close a plan on.
  if (!windowIsMissed(route) || !canBlockWhenMissed(route, finding.verificationStatus))
    return false;

  return agreesWithRoute(blocker, route, BLOCKER_ROUTE_FIELDS);
};

const readPlan = (body: unknown): PlanResponse | null => {
  const plan = readChecked(PLAN_CHECKS, body);
  if (plan === null) return null;
  return blockerIsANarrowedMissedRoute(plan) ? normalizePlan(plan) : null;
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

/** Generate a plan for this event and return the plan that was stored. */
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
