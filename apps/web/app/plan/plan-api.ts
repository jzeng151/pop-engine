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
import {
  canBlockWhenMissed,
  mergedDispositionOf,
  noRouteSuppliesScalars,
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
  /**
   * This route's own published notes.
   *
   * ALREADY ON THE WIRE, WHICH IS WHY THIS NEEDS NO WIDENING OF THE CONTRACT. `plan.ts` serves
   * `routes: finding.routes ?? null` — the whole `FindingRoute`, not a projection — so the engine's
   * per-route notes have been transmitted since the field was added and only this type ignored
   * them. A round of this review recorded narrowing them as blocked on a wire change; it was not,
   * and the note saying so was wrong (#252 review).
   *
   * Optional because a plan stored before `FindingRoute.notes` carries none, and absence means "not
   * recorded" rather than "this route publishes none", which is `[]`.
   */
  readonly notes?: readonly string[];
  /**
   * This route's own `conflictText`: both readings of an OFFICIAL_CONFLICT rule, verbatim.
   *
   * The merged line's value is NOT a concatenation — `mergeGroup` falls back through the routes in
   * binding order and takes the first that publishes any — so the line carries one route's text with
   * nothing recording whose, and an entry rendering the line's showed one rule's conflict under
   * another's name. `alerts.ts` had the same defect one round earlier and on a different surface
   * (#252 review).
   *
   * Optional for the same reason `notes` is: absent on a plan stored before the engine carried it,
   * and `null` is the value meaning this route publishes no conflict.
   */
  readonly conflictText?: string | null;
};

/**
 * WHAT THIS TYPE PROJECTS, STATED IN FULL so the next dropped field is a decision rather than an
 * omission. `FindingRoute` carries 18 fields. This projects 17: `ruleId`, `triggerResult`,
 * `disposition`, `unknownFields`, `name`, `agency`, `deadline` (widened to its published type),
 * `deadlineDisplay`, `latestApplyDate`, `applyAfterDate`, `deadlineStatus`, `feeDisplay`,
 * `portalName`, `portalUrl`, `portalInstructions`, `notes` and `conflictText`.
 *
 * ONE IS DELIBERATELY ABSENT: `slackDays`. No web surface renders a route's slack — the verdict
 * computes the minimum over routes in the engine, and the rescope ladder names the route holding it
 * through `atRiskFindingName`, which the api resolves before serving. Adding it would put a value on
 * the wire that nothing reads. Three fields have now been found missing from this projection one
 * round at a time (`notes`, then `conflictText` on the alerts side, then `conflictText` here); this
 * paragraph is what ends that, because the audit is written down rather than repeated.
 */

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
  if (!routes.every(unknownFieldsMatchTriggerResult)) return false;
  if (mode === "applies_together") {
    return routes.every((route) => route.triggerResult === "true");
  }
  return routes.some((route) => route.triggerResult === "unknown");
};

/**
 * AN UNRESOLVED ROUTE NAMES WHAT WOULD SETTLE IT, AND A RESOLVED ONE NAMES NOTHING.
 *
 * The engine cannot produce either half wrong. `evaluateTrigger` returns `unknown` only when some
 * child returned `unknown`, and every unknown leaf carries its own `condition.field`, so an
 * unresolved trigger always names at least one field; every decisive branch returns
 * `unknownFields: []`. This is that invariant read at the door rather than assumed through it.
 *
 * What it stops: a `candidate` route with `triggerResult: "unknown"` and an empty list renders as
 * "May apply" with nothing saying what would decide it, on both surfaces — the plan line's
 * introduction and its unsettled sentence are built from these fields, and so is the checklist's
 * deciding question, so the one actionable thing about the route disappears with no sign it is
 * missing. The other direction is a resolved route carrying fields it does not turn on, which puts
 * an answered question into a sentence that says answering it would decide something.
 */
const unknownFieldsMatchTriggerResult = (route: ConsumedRoute): boolean =>
  route.triggerResult === "unknown"
    ? route.unknownFields.length > 0
    : route.unknownFields.length === 0;

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

/**
 * THE HEADLINE IS THE BINDING ROUTE'S, AND THE BINDING ROUTE IS `routes[0]`.
 *
 * `mergeGroup()` spreads the binding route into the merged finding and leads `routes` with it, so on
 * every merged line the headline tuple and the first route entry are the same rule's published
 * values. Nothing checked it: `routeContractHolds` reads the ids, the list and the mode, so a body
 * carrying valid matching `routes` and `ruleIds` beside a headline taken from a DIFFERENT route
 * cleared the boundary, and `PlanLine` rendered the crossed tuple as the heading — which is the
 * cross-route attribution the whole route shape exists to prevent (#252 review).
 *
 * THE ALL-NULL STATE IS APPROVED AND IS NOT A FAILURE. Where the group holds a resolved route and
 * none of them contributes the merged disposition, the line publishes no scalars at all and
 * `deadlineStatus` reads `not_calculable` (design §4.3, amended 2026-08-09). That is a line whose
 * headline is deliberately nobody's, so it is accepted as its own state rather than compared.
 *
 * `disposition` IS NOT IN THE TUPLE, deliberately: the merged disposition is the STRONGEST any route
 * contributes, so it is the group's rather than the binding route's and differs from `routes[0]`'s
 * legitimately. Nor are `noteText`, `conflictText` or `timelineUnresolvedReason`, which fall back
 * through the remaining routes in binding order where the binding route publishes none.
 */
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

/**
 * THE EXCEPTION IS A CONDITION, NOT A SHAPE. §4.3's amendment publishes no headline scalars in ONE
 * case: the group holds a resolved route and none of them contributes the merged disposition. Read
 * as a shape — "everything null and `not_calculable`" — it accepted that state on ANY merged group,
 * so an ordinary `applies_together` group could null its name, dates, fee and portal and skip the
 * binding-route comparison entirely, and a plan silently missing every one of those published values
 * passed validation (#252 review). The routes carry what decides it, so the condition is tested.
 *
 * `noRouteSuppliesScalars` is the engine's own, exported from beside the merge that produces the
 * state rather than restated here: a second copy of a rule this specific would drift, and a drifted
 * copy of THIS rule reads as enforcement while allowing the thing it forbids.
 */
/**
 * ONE NOTION OF "AGREES WITH A ROUTE", shared by every tuple that claims to come from one.
 *
 * Three boundaries now validate a tuple against a route: the merged headline against `routes[0]`,
 * the checklist row's filing fields against the route it names, and the narrowed blocker against the
 * route its own `ruleIds` identify. What they share is only this comparison. What they do NOT share
 * is stated where each calls it, because pretending otherwise is how a fourth tuple gets the wrong
 * one: the ROUTE SELECTION differs (positional, self-naming with a positional fallback, and named by
 * the tuple's own ids against a different object), the FIELD NAMES differ (`permitName` on a
 * checklist row, `name` everywhere else), the FIELD SETS differ, and each has its own exception —
 * the scalar-free condition for two of them, versioned absence for the third.
 *
 * So the comparison is factored and the selection is not. What that makes impossible is a boundary
 * inventing a looser notion of agreement: `??`-style null tolerance, or comparing `deadline` by
 * identity rather than by its published type, which is the only part of it either side carries.
 * What it cannot prevent is a caller choosing the wrong route, or omitting the check.
 */
export const agreesWithRoute = <Carrier extends object>(
  record: Carrier,
  route: ConsumedRoute,
  fields: readonly (keyof Carrier & keyof ConsumedRoute)[],
): boolean => {
  // `deadline` is compared by its published TYPE, which is the only part of it either side carries,
  // and only where the carrier has one at all: `ConsumedBlockingFinding` does not, because
  // `VerdictDetail` never widened to include it.
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

const headlineMatchesBinding = (finding: ConsumedFinding): boolean => {
  const binding = finding.routes?.[0];
  if (binding === undefined) return true;
  if (publishesNoScalars(finding)) return true;
  return agreesWithRoute(finding, binding, HEADLINE_SCALARS);
};

/**
 * THE ONE HEADLINE VALUE THAT IS NOT `routes[0]`'S STILL HAS TO FOLLOW FROM THE ROUTES.
 *
 * `disposition` is excluded from `headlineMatchesBinding` on purpose — the merged value is the
 * strongest any route CONTRIBUTES, so it is the group's rather than the binding route's — and that
 * left it checked by nothing at all. A body carrying valid routes and valid binding scalars beside a
 * headline of `prohibited_or_ineligible` that no route contributes cleared the boundary, and
 * `PlanLine` renders blocker styling and blocker copy off that value (#252 review).
 *
 * `mergedDispositionOf` is the engine's own arithmetic, exported from beside the merge: the cap on
 * an unresolved route is part of it, so a hand-written comparison here would have to restate the
 * ceiling rule and would drift from it.
 */
const dispositionFollowsFromRoutes = (finding: ConsumedFinding): boolean => {
  const routes = (finding.routes ?? []) as readonly FindingRoute[];
  if (routes.length === 0) return true;
  return finding.disposition === mergedDispositionOf(routes);
};

const isConsumedFinding = (value: unknown): value is ConsumedFinding =>
  shapedLike(FINDING_CHECKS)(value) &&
  routeContractHolds(value) &&
  dispositionFollowsFromRoutes(value) &&
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

/**
 * The keys `verdict.ts` added to `blockingFinding` when it started narrowing the blocker to its own
 * route. A stored plan carrying none of them was written before that, and is read the way it was
 * written; a stored plan carrying all of them was written after. There is no third state, and
 * `blockerWideningIsComplete` is what makes that true rather than assumed.
 *
 * Exported so the panel reads the same list this boundary enforces. Two copies of it would drift,
 * and the drift would be invisible: the panel decides whether to consult the plan's own line by
 * asking whether ANY of these is present, so a key it knew and the boundary did not is a key that
 * turns the fallback off without being validated.
 */
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

/**
 * ALL OF THE WIDENED KEYS OR NONE OF THEM, because the consumer reads their presence as a version.
 *
 * `verdict-detail.tsx` turns the legacy fallback off as soon as ANY widened key is present, on the
 * reading that presence means the api wrote the narrowed blocker. Validated one at a time, a payload
 * carrying `agency` alone satisfied every check and still turned the fallback off, so the INFEASIBLE
 * panel rendered the citation, the portal and the apply-by date blank instead of either refusing the
 * payload or recovering them from the stored line — on the one section that tells an organizer why
 * their event is infeasible (#252 review).
 *
 * PRESENCE, NOT VALUE, which is the same rule the panel applies: a blocker that genuinely publishes
 * no portal writes `portalName: null`, and null is a value the panel must honour rather than re-find.
 *
 * TWO STATES AND NOT THREE. The widening landed whole on this branch and `main` still carries
 * `{ruleIds, name}`, so no stored plan holds a partial set, and the intermediate generation this
 * branch passed through never reached a database. If a later widening adds a key, it adds a third
 * state and this predicate has to learn it; that is a smaller problem than the silent blank, and it
 * is stated here so the next widening does not discover it.
 */
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

/**
 * The widened blocker's values, checked against the route its own `ruleIds` name.
 *
 * THE THIRD TUPLE VALIDATED FOR PRESENCE RATHER THAN FOR AGREEMENT, and the one where it costs
 * most. `blockerView` narrows the merged line to the route whose window closed, so every field the
 * wire carries is that route's; nothing compared them, so a payload could name one route in
 * `ruleIds` and carry another's date, fee and portal. `VerdictDetailPanel` reads a widened blocker
 * and DELIBERATELY turns the legacy fallback off, so a crossed tuple reaches the INFEASIBLE panel
 * with nothing behind it to catch the crossing (#252 review).
 *
 * CROSS-OBJECT, which is why it runs here rather than inside `BLOCKING_FINDING_CHECKS`: the route
 * lives on a finding and the blocker lives on `verdictDetail`, so the whole body has to be readable
 * first. `sources`, `userSummary` and `ruleIds` are deliberately not compared — `blockerView`
 * FILTERS the sources to the route's rule, nulls a merged summary rather than reattributing it, and
 * rewrites `ruleIds` to the single route — so none of the three is a value the route publishes.
 *
 * SKIPPED, NEVER REFUSED, in two states that are not crossings: a blocker with none of the widened
 * keys, which is a plan stored before the narrowing and carries no values to check; and one whose
 * route is not among the plan's findings, which is a rescoped or replayed plan whose blocking line
 * is gone — the same state the panel's own last-resort reference exists for.
 */
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

/**
 * WHAT A WIDENED BLOCKER HAS TO BE, stated once as one claim rather than as the fields three rounds
 * of review happened to think of.
 *
 * The claim the payload makes is: **this is a MISSED ROUTE of a finding on this plan, narrowed to
 * that route by `blockerView`.** Written as "compare the fields I thought of", it was wrong three
 * times in three different ways — a crossed scalar tuple, a sibling's sources or a merged summary,
 * and a rule id belonging to a route that is not missed at all. Each round added a field. The
 * framing is what was wrong, so this is the framing, and every condition below is a clause OF that
 * claim rather than a check bolted onto it (#252 review).
 *
 * The claim decomposes into six conditions, and they are exhaustive over what the payload can
 * support:
 *
 * 1. IT NAMES ONE RULE. `blockerView` rewrites `ruleIds` to `[route.ruleId]`, so a widened blocker
 *    naming none or several is not one it produced.
 * 2. THAT RULE IS ON THIS PLAN. The finding carrying it is where the route's published values live;
 *    without it there is nothing to check the blocker against.
 * 3. THAT RULE'S WINDOW IS MISSED. `verdictDetail.missedRuleIds` holds the route ids whose windows
 *    closed, and the panel's whole sentence is that this route's deadline was missed. A blocker
 *    naming an on-track sibling makes the panel state a miss for a route that has none.
 * 4. ITS PUBLISHED VALUES ARE THAT ROUTE'S. The identity, disposition, window, status, fee and
 *    portal, compared through `agreesWithRoute` like every other tuple this boundary checks.
 * 5. ITS CITATIONS ARE THAT RULE'S. `blockerView` filters rather than copies, so the test is set
 *    equality against the finding's sources filtered by `FindingSource.ruleId`.
 * 6. ITS SUMMARY IS THE NULL THE ENGINE WRITES, on a merged finding. `mergeUserSummary` takes the
 *    heading from the first route in binding order that publishes one and concatenates the points
 *    over the group, so a merged summary is never the blocking route's own. An unmerged blocker
 *    keeps its own, which is why the test is on the finding's route list rather than on the blocker.
 * 7. IT IS A ROUTE A MISSED WINDOW MAY CLOSE A PLAN ON. Conditions 3 and 4 say the named route is
 *    missed and that the values are its own; neither says the ENGINE would have blocked on it. A
 *    resolved advisory route and an unresolved barred route both satisfy every condition above and
 *    neither can produce a blocker, so the panel would state INFEASIBLE off a route the engine
 *    reads as CONDITIONAL. Recomputed through the engine's own `canBlockWhenMissed` rather than
 *    restated here, for the reason this file recomputes the merged disposition through
 *    `mergedDispositionOf` instead of restating the ceiling rule (#252 review).
 *
 * WHAT IS STILL NOT CHECKED AFTER THIS, named rather than left implicit:
 *
 * - THE TRIGGER RESULT OF AN UNMERGED BLOCKER, which is one clause of condition 7 and not the
 *   condition. `triggerResult` is on `ConsumedRoute` and a merged blocker is checked on all three
 *   clauses; an unmerged finding serves `routes: null`, and `ConsumedFinding` carries no trigger
 *   result, so only the disposition and conflict clauses are evaluable there. The gap is narrow by
 *   construction: `resolveDisposition` demotes an unknown-triggered `required` to
 *   `may_be_required`, which condition 7's floor already refuses, so the disposition clause proves
 *   the trigger resolved for every value except `prohibited_or_ineligible`, which `proposals.ts` §2
 *   deliberately leaves undemoted. Closing it needs the finding's own trigger result on the wire.
 *   THE EARLIER NOTE HERE WAS WRONG and is corrected rather than deleted: it said this whole
 *   selection needed `DefiniteRoutes` and that nothing of it was on the wire. `plan.ts` serves
 *   `routes: finding.routes ?? null`, whole, and `FindingRoute` has carried `triggerResult` and
 *   `disposition` since the field landed. `verificationStatus` is the finding's and is every
 *   route's, since `parseEngineRuleset` refuses a `dedupe_key` mixing statuses.
 * - WHICH OF SEVERAL BLOCKING ROUTES IS THE ONE PICKED. Where two routes both satisfy condition 7,
 *   `computeWindowVerdict` takes the earlier `latestApplyDate`. That is checkable — the dates are
 *   on the wire — and it is deliberately not checked, because it is a rule about which of two
 *   valid blockers was chosen rather than about whether this payload describes a blocker at all. A
 *   payload naming the later of two blocking routes states a real miss of a real blocking route.
 * - THAT THE VERDICT IS INFEASIBLE. The engine only sets a blocker on that verdict, but the field
 *   is optional and stored plans replay as written, so refusing on it would be a cross-field rule
 *   about verdicts rather than about the blocker.
 * - ANYTHING ABOUT A PRE-NARROWING BLOCKER. A payload carrying none of the widened keys is a plan
 *   stored before the narrowing; it has no values to check and is accepted whole, which is what
 *   `WIDENED_BLOCKER_KEYS` decides.
 * - THE ROUTE'S EXISTENCE ON A REPLAYED PLAN. Where the blocking line is no longer among the
 *   findings — a rescoped or replayed plan — there is nothing to compare against, and the panel has
 *   its own last-resort reference for exactly that state.
 */
const blockerIsANarrowedMissedRoute = (plan: PlanResponse): boolean => {
  const blocker = plan.verdictDetail.blockingFinding;

  // TWO SHAPES MAKE NO CLAIM, and they are the only two accepted without evaluating the conditions.
  // Neither is a bypass: there is nothing to verify, and neither is TRUSTED downstream.
  //
  //   • No blocker at all. Nothing is asserted and the panel renders no blocker section.
  //   • A blocker carrying none of the widened keys, which is `{ruleIds, name}` from a plan stored
  //     before the narrowing. It has no published values to check, and `verdict-detail.tsx` reads
  //     exactly that absence to keep its legacy fallback ON, so the name it shows comes from the
  //     plan's own line rather than from this payload.
  //
  // EVERYTHING ELSE GOES THROUGH THE CONDITIONS, with no early acceptance in front of them. That is
  // the correction this round: the predicate was right and the PATH around it was not. A blocker
  // whose rule is absent from the findings returned `true` before reaching any condition — and it
  // is precisely the shape that must not be trusted, because it carries the widened keys, so the
  // panel turns the fallback OFF and renders a name, deadline, portal and citations nothing on the
  // plan can corroborate. Three rounds found three ways past this validator and each was a path
  // rather than a missing field (#252 review).
  if (blocker === null) return true;
  if (!WIDENED_BLOCKER_KEYS.some((key) => key in blocker)) return true;

  // 1. It names one rule.
  if (blocker.ruleIds.length !== 1) return false;
  const ruleId = blocker.ruleIds[0] as string;

  // 2. That rule is on this plan. A WIDENED blocker always is: `computeVerdict` narrows it from the
  //    same findings it returns, and a stored plan serves its own generation's findings beside its
  //    own `verdict_detail`. So absence is not a replayed plan, it is a payload nothing corroborates.
  const finding = plan.findings.find((entry) => entry.ruleIds.includes(ruleId));
  if (finding === undefined) return false;

  // 3. That rule's window is missed.
  if (!plan.verdictDetail.missedRuleIds.includes(ruleId)) return false;

  // 4. Its citations are that rule's. `blockerView` filters rather than copies, so this is set
  //    equality against the finding's own sources for that rule.
  if (blocker.sources !== undefined) {
    const own = (finding.sources ?? []).filter((source) => source.ruleId === ruleId);
    if (JSON.stringify(blocker.sources) !== JSON.stringify(own)) return false;
  }

  // 5. Its summary is the null the engine writes, on a merged finding.
  const merged = (finding.routes?.length ?? 0) > 1;
  if (merged && blocker.userSummary !== undefined && blocker.userSummary !== null) return false;

  // 6. Its published values are that route's. An unmerged finding is its own route; a merged one
  //    that does not carry the named route is a route list disagreeing with its own blocker.
  const route = (finding.routes ?? []).find((entry) => entry.ruleId === ruleId);
  if (route === undefined) {
    if (finding.routes != null) return false;
    // 7 on an unmerged finding, which carries no trigger result. `triggerResult: "true"` is what
    // `routesOf` synthesizes for exactly this line, and it is the one clause this shape cannot
    // corroborate; the floor and the conflict exclusion are checked on the finding's own values.
    if (
      !canBlockWhenMissed(
        { disposition: finding.disposition, triggerResult: "true" },
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
  if (!canBlockWhenMissed(route, finding.verificationStatus)) return false;

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
