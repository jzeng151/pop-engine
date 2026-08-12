// Rule → finding. Step 1 of the verdict algorithm: resolve triggers tri-state, merge by
// dedupe key retaining every contributing rule, and date each finding.

import { createScopeResolver, evaluateTrigger } from "./conditions";
import { CONFIRM_WITH_AGENCY, computeDeadline } from "./deadlines";
import type { DeadlineContext, PlanContext } from "./deadlines";
import { addCalendarDays, differenceInCalendarDays } from "./calendar";
import {
  DEFAULT_DISPOSITION_BY_RULE_KIND,
  DEPENDENCY_SEQUENCING_BINDINGS,
  UNKNOWN_TRIGGER_DISPOSITION,
} from "./proposals";
import type {
  EngineRule,
  EngineRuleset,
  EvaluationTraceEntry,
  EventIntake,
  Finding,
  FindingKind,
  FindingRoute,
  FindingSource,
  MergedFinding,
  Deadline,
  DeadlineStatus,
  Disposition,
  HeadlineMode,
  TriggeredBy,
  RuleUserSummary,
  Tristate,
  UnmergedFinding,
  VerificationStatus,
} from "./types";

/** Which routes resolved on their own triggers, which is what decides whether a missed window may close a plan (#254). */
export type DefiniteRoutes = {
  /**
   * Rules that published a disposition at or above `required` AND whose own trigger resolved, so
   * the requirement or bar they assert does not hang off an unanswered question. `verdict.ts` reads
   * this to decide which resolved prohibitions or missed routes may close a plan.
   */
  readonly blockingRuleIds: ReadonlySet<string>;
};

export type ResolvedFindings = {
  readonly findings: readonly Finding[];
  readonly trace: readonly EvaluationTraceEntry[];
  /** Intake fields whose unanswered state left at least one finding conditional. */
  readonly unknownFields: readonly string[];
  readonly definiteRoutes: DefiniteRoutes;
};

function findingKind(rule: EngineRule): FindingKind {
  // A classification rule persists as a note finding, keeping its rule id for provenance (#73).
  return rule.kind === "classification" ? "note" : rule.kind;
}

function resolveDisposition(rule: EngineRule, result: Tristate): Disposition {
  const published = rule.publishedDisposition ?? DEFAULT_DISPOSITION_BY_RULE_KIND[rule.kind];
  // An unknown-triggered finding is never definitive; weaker dispositions already say
  // what they mean and are left alone (proposals §2).
  return result === "unknown" && published === "required" ? UNKNOWN_TRIGGER_DISPOSITION : published;
}

/** The rule's own notes, plus the published caveats that qualify what it says: the deadline's `qualification` (which instrument applies, calendar vs business days) and the verification block's, both of which are regulatory text and neither of which may be dropped just because the engine computed a date. */
function ruleNotes(rule: EngineRule, deadlineStatus: DeadlineStatus): string[] {
  const needsAgencyConfirmation =
    deadlineStatus === "not_calculable" && rule.verificationStatus !== "RESEARCH_REQUIRED";
  return [
    ...rule.notes,
    ...(rule.deadline?.qualification === undefined || rule.deadline.qualification === null
      ? []
      : [rule.deadline.qualification]),
    ...(rule.verificationQualification === null ? [] : [rule.verificationQualification]),
    ...(needsAgencyConfirmation ? [CONFIRM_WITH_AGENCY] : []),
  ];
}

function ruleSources(rule: EngineRule): FindingSource[] {
  return rule.source === null
    ? []
    : [{ ruleId: rule.id, citation: rule.source.citation, urls: rule.source.urls }];
}

function buildFinding(
  rule: EngineRule,
  result: Tristate,
  triggeredBy: readonly TriggeredBy[],
  context: DeadlineContext,
): Finding {
  const dated = computeDeadline(rule.deadline, rule.levelBinding, context);
  return {
    ruleIds: [rule.id],
    kind: findingKind(rule),
    disposition: resolveDisposition(rule, result),
    name: rule.name,
    agency: rule.agency,
    deadline: rule.deadline,
    deadlineDisplay: dated.deadlineDisplay,
    latestApplyDate: dated.latestApplyDate,
    // Filled by the dependency pass below when a gating binding applies.
    applyAfterDate: null,
    deadlineStatus: dated.deadlineStatus,
    slackDays: dated.slackDays,
    feeDisplay: rule.feeDisplay,
    portalName: rule.portalName,
    portalUrl: rule.portalUrl,
    portalInstructions: rule.portalInstructions,
    notes: ruleNotes(rule, dated.deadlineStatus),
    noteText: rule.noteText,
    deadlineUnknownFields: dated.unknownFields,
    timelineUnresolvedReason: dated.timelineUnresolvedReason,
    // An OFFICIAL_CONFLICT rule renders both readings and every source; it never resolves silently.
    conflictText: rule.verificationStatus === "OFFICIAL_CONFLICT" ? rule.noteText : null,
    sources: ruleSources(rule),
    // Preserve byte-stable historical finding shapes until a published rule carries the field.
    ...(rule.userSummary === null ? {} : { userSummary: rule.userSummary }),
    verificationStatus: rule.verificationStatus,
    ...(rule.verificationLastVerifiedDate === null
      ? {}
      : { lastVerifiedDate: rule.verificationLastVerifiedDate }),
    triggeredBy,
  };
}

/** Weakest to strongest. */
export const DISPOSITION_STRENGTH: readonly Disposition[] = [
  "no_new_requirement",
  "advisory",
  "may_be_required",
  "required",
  "prohibited_or_ineligible",
];

/** The strongest a route whose own trigger did not resolve can contribute (§8.4, and see below). */
const UNRESOLVED_ROUTE_CEILING: Disposition = "may_be_required";

/** The weakest disposition a missed finding can close a plan on (`verdict.ts`, F-102 AC 10). */
export const BLOCKING_DISPOSITION_FLOOR: Disposition = "required";

/** The weakest RESOLVED contribution a group can hold for that ceiling to bite (see below). */
const UNRESOLVED_ROUTE_CAP_TRIGGER: Disposition = "required";

/** Where each of a route's values COMES FROM: the published rule, or the intake this plan was evaluated against. */
export type RouteFieldOrigin = "intake" | "published";

export const ROUTE_FIELD_ORIGIN: {
  readonly [Field in keyof Required<FindingRoute>]: RouteFieldOrigin;
} = {
  ruleId: "published",
  triggerResult: "intake",
  disposition: "intake",
  unknownFields: "intake",
  name: "published",
  agency: "published",
  deadline: "published",
  deadlineDisplay: "intake",
  latestApplyDate: "intake",
  applyAfterDate: "intake",
  deadlineStatus: "intake",
  slackDays: "intake",
  feeDisplay: "published",
  portalName: "published",
  portalUrl: "published",
  portalInstructions: "published",
  notes: "published",
  conflictText: "published",
};

/** The route fields no answer can move, derived from the mapping above rather than typed out again. */
export const PUBLISHED_ROUTE_FIELDS: readonly (keyof FindingRoute)[] = (
  Object.keys(ROUTE_FIELD_ORIGIN) as (keyof FindingRoute)[]
).filter((field) => ROUTE_FIELD_ORIGIN[field] === "published");

/** The dispositions that denote something an organizer FILES. */
export const FILING_DISPOSITIONS: ReadonlySet<Disposition> = new Set<Disposition>([
  "required",
  "may_be_required",
]);

/** Whether a surface may offer a FILING ACTION for this route or finding: "apply at", an Apply link, a published filing instruction, "apply within N days". */
export const offersAFilingAction = (
  candidate: { readonly disposition: Disposition; readonly triggerResult?: Tristate },
  headlineMode?: HeadlineMode | null,
): boolean =>
  FILING_DISPOSITIONS.has(candidate.disposition) &&
  headlineMode !== "candidate" &&
  candidate.triggerResult !== "unknown";

/** Whether a route is one a MISSED window may close a plan on, which is membership in `blockingRuleIds` stated as the predicate it always was. */
export const canBlockWhenMissed = (
  route: Pick<FindingRoute, "disposition" | "triggerResult">,
  verificationStatus: VerificationStatus,
): boolean =>
  route.triggerResult === "true" &&
  verificationStatus !== "OFFICIAL_CONFLICT" &&
  DISPOSITION_STRENGTH.indexOf(route.disposition) >=
    DISPOSITION_STRENGTH.indexOf(BLOCKING_DISPOSITION_FLOOR);

/** Whether a resolved published prohibition or ineligibility closes the plan without a deadline. */
export const canBlockOverall = (
  route: Pick<FindingRoute, "disposition" | "triggerResult">,
  verificationStatus: VerificationStatus,
): boolean =>
  route.triggerResult === "true" &&
  verificationStatus !== "OFFICIAL_CONFLICT" &&
  route.disposition === "prohibited_or_ineligible";

/** One contributing route to a group's requirement: its finding, and whether its own trigger resolved. */
type Contribution = {
  readonly finding: Finding;
  readonly triggerResult: Tristate;
  /** The intake fields this rule's own trigger could not resolve. */
  readonly unknownFields: readonly string[];
};

/** Whether the ceiling bites on this group. */
function unresolvedRouteCeilingApplies(group: readonly Contribution[]): boolean {
  return group.some(
    ({ finding, triggerResult }) =>
      triggerResult !== "unknown" &&
      DISPOSITION_STRENGTH.indexOf(finding.disposition) >=
        DISPOSITION_STRENGTH.indexOf(UNRESOLVED_ROUTE_CAP_TRIGGER),
  );
}

/** What a route contributes to the group's disposition, which is its own published value except that an unresolved route cannot carry the group past `may_be_required` where the ceiling applies (above). */
function contributedDisposition(
  { finding, triggerResult }: Contribution,
  ceilingApplies: boolean,
): Disposition {
  if (triggerResult !== "unknown" || !ceilingApplies) return finding.disposition;
  return DISPOSITION_STRENGTH.indexOf(finding.disposition) >
    DISPOSITION_STRENGTH.indexOf(UNRESOLVED_ROUTE_CEILING)
    ? UNRESOLVED_ROUTE_CEILING
    : finding.disposition;
}

/** Whether a merged line's own scalars can come from any of its routes: the condition §4.3's amendment of 2026-08-09 states, read off the route list alone. */
const routeResolved = (route: FindingRoute): boolean => route.triggerResult !== "unknown";

/** What each route contributes to its group's disposition, off the route entries alone. */
function routeContributions(routes: readonly FindingRoute[]): (route: FindingRoute) => Disposition {
  const ceilingApplies = routes.some(
    (route) =>
      routeResolved(route) &&
      DISPOSITION_STRENGTH.indexOf(route.disposition) >=
        DISPOSITION_STRENGTH.indexOf(UNRESOLVED_ROUTE_CAP_TRIGGER),
  );
  return (route) =>
    routeResolved(route) || !ceilingApplies
      ? route.disposition
      : DISPOSITION_STRENGTH.indexOf(route.disposition) >
          DISPOSITION_STRENGTH.indexOf(UNRESOLVED_ROUTE_CEILING)
        ? UNRESOLVED_ROUTE_CEILING
        : route.disposition;
}

/** The disposition a merged line must publish, recomputed from its route entries. */
export function mergedDispositionOf(routes: readonly FindingRoute[]): Disposition | null {
  if (routes.length === 0) return null;
  return strongestDisposition(routes.map(routeContributions(routes)));
}

export function noRouteSuppliesScalars(routes: readonly FindingRoute[]): boolean {
  if (routes.length < 2) return false;
  const contributed = routeContributions(routes);
  const disposition = strongestDisposition(routes.map(contributed));
  return (
    routes.some(routeResolved) &&
    !routes.some((route) => routeResolved(route) && contributed(route) === disposition)
  );
}

function strongestDisposition(dispositions: readonly Disposition[]): Disposition {
  return dispositions.reduce((strongest, value) =>
    DISPOSITION_STRENGTH.indexOf(value) > DISPOSITION_STRENGTH.indexOf(strongest)
      ? value
      : strongest,
  );
}

/** How available a route's filing window is, lowest first. */
function windowAvailability(candidate: BindingCandidate): number {
  if (candidate.deadline === null) return 3;
  if (candidate.deadlineStatus === "published_deadline_missed") return 1;
  return candidate.latestApplyDate === null ? 2 : 0;
}

/** The four published values the binding order is decided on, which a `Finding` and a `FindingRoute` both carry. */
type BindingCandidate = {
  readonly ruleId: string;
  readonly deadline: Deadline | null;
  readonly deadlineStatus: DeadlineStatus;
  readonly latestApplyDate: string | null;
};

const bindingCandidateOf = (finding: UnmergedFinding): BindingCandidate => ({
  ruleId: finding.ruleIds[0] ?? "",
  deadline: finding.deadline,
  deadlineStatus: finding.deadlineStatus,
  latestApplyDate: finding.latestApplyDate,
});

function compareBindingCandidates(a: BindingCandidate, b: BindingCandidate): number {
  const available = windowAvailability(a) - windowAvailability(b);
  if (available !== 0) return available;
  if (
    a.latestApplyDate !== b.latestApplyDate &&
    a.latestApplyDate !== null &&
    b.latestApplyDate !== null
  ) {
    return a.latestApplyDate < b.latestApplyDate ? -1 : 1;
  }
  return a.ruleId <= b.ruleId ? -1 : 1;
}

function compareBinding(a: UnmergedFinding, b: UnmergedFinding): number {
  return compareBindingCandidates(bindingCandidateOf(a), bindingCandidateOf(b));
}

/** Which route a merged line's identity and timeline come from, recomputed from the route entries. */
export function bindingRouteOf(routes: readonly FindingRoute[]): FindingRoute | null {
  if (routes.length < 2) return null;
  const contributed = routeContributions(routes);
  const disposition = strongestDisposition(routes.map(contributed));
  const contributing = routes.filter((route) => contributed(route) === disposition);
  const resolved = contributing.filter(routeResolved);
  const pool = resolved.length > 0 ? resolved : contributing;
  return (
    [...pool].sort((a, b) =>
      compareBindingCandidates({ ...a, ruleId: a.ruleId }, { ...b, ruleId: b.ruleId }),
    )[0] ?? null
  );
}

/** The group's plain-language block: the binding rule's heading over every contributing rule's points, or absent when no contributing rule publishes one. */
function mergeUserSummary(
  group: readonly Finding[],
  byBinding: readonly Finding[],
): RuleUserSummary | null {
  const heading = byBinding
    .map((finding) => finding.userSummary?.heading)
    .find((value) => value !== undefined);
  if (heading === undefined) return null;
  return { heading, points: group.flatMap((finding) => finding.userSummary?.points ?? []) };
}

/**
 * One route entry: a contributing rule's own published values and its own trigger result, so the
 * merge no longer has to discard the losing routes' name, window and fee to fit one line.
 */
function routeFrom(
  finding: UnmergedFinding,
  triggerResult: Tristate,
  unknownFields: readonly string[],
): FindingRoute {
  return {
    ruleId: finding.ruleIds[0] as string,
    triggerResult,
    disposition: finding.disposition,
    unknownFields,
    name: finding.name,
    agency: finding.agency,
    deadline: finding.deadline,
    deadlineDisplay: finding.deadlineDisplay,
    latestApplyDate: finding.latestApplyDate,
    applyAfterDate: finding.applyAfterDate,
    deadlineStatus: finding.deadlineStatus,
    slackDays: finding.slackDays,
    feeDisplay: finding.feeDisplay,
    portalName: finding.portalName,
    portalUrl: finding.portalUrl,
    portalInstructions: finding.portalInstructions,
    notes: finding.notes,
    conflictText: finding.conflictText,
  };
}

/** Every route a finding holds, and the ONE correct fallback for a finding that carries no list: an unmerged finding is its own single route, and so is a replayed artifact stored before the field existed. */
export function routesOf(finding: Finding): readonly FindingRoute[] {
  return finding.routes ?? [routeFrom(finding, "true", [])];
}

/** The route whose values lead the line, or null for a merged line with no attributable headline. */
export function headlineOf(finding: Finding): FindingRoute | null {
  if (finding.routes === undefined) return routeFrom(finding, "true", []);
  if (finding.headlineRouteId === null) return null;
  return finding.routes.find((route) => route.ruleId === finding.headlineRouteId) ?? null;
}

/** One finding for a dedupe group, retaining every contributing rule, source, trigger reason AND every route's own published values. */
function mergeGroup(group: readonly Contribution[]): Finding {
  const first = group[0] as Contribution;
  if (group.length === 1) return first.finding;

  const ceilingApplies = unresolvedRouteCeilingApplies(group);
  const contributed = (contribution: Contribution): Disposition =>
    contributedDisposition(contribution, ceilingApplies);
  const disposition = strongestDisposition(group.map(contributed));
  const findings = group.map((contribution) => contribution.finding as UnmergedFinding);

  // The routes that contributed the headline disposition, narrowed to those known to apply where any of them is.
  const contributing = group.filter((contribution) => contributed(contribution) === disposition);
  const isResolved = (contribution: Contribution): boolean =>
    contribution.triggerResult !== "unknown";
  const resolved = contributing.filter(isResolved);
  const bindingPool = resolved.length > 0 ? resolved : contributing;
  // THE GROUP HOLDS A SETTLED ROUTE AND NONE OF THEM CARRIES THE HEADLINE, which is the one case §4.2 and §4.3 step 2 pointed at different routes for, amended 2026-08-09 by the product owner so that the line picks neither.
  const unattributable = resolved.length === 0 && group.some(isResolved);
  const binding = bindingPool
    .map((contribution) => contribution.finding as UnmergedFinding)
    .sort(compareBinding)[0] as UnmergedFinding;
  // The binding route first, then the rest, for the single-valued texts it leaves empty.
  const bindingOrder = [
    binding,
    ...findings.filter((finding) => finding !== binding).sort(compareBinding),
  ];
  const publishedText = (read: (finding: UnmergedFinding) => string | null): string | null =>
    bindingOrder.map(read).find((text) => text !== null) ?? null;
  const userSummary = mergeUserSummary(findings, bindingOrder);
  const verificationDates = findings.map((finding) => finding.lastVerifiedDate);
  const published = verificationDates.filter((date): date is string => typeof date === "string");
  const lastVerifiedDate: string | null =
    published.length === group.length
      ? published.reduce((earliest, date) => (date < earliest ? date : earliest))
      : null;
  // IN BINDING ORDER, NOT CONTRIBUTING ORDER.
  const contributionOf = new Map(group.map((contribution) => [contribution.finding, contribution]));
  const routes = bindingOrder.map((finding) => {
    const { triggerResult, unknownFields } = contributionOf.get(finding) as Contribution;
    return routeFrom(finding, triggerResult, unknownFields);
  });
  const headlineMode: HeadlineMode = routes.every((route) => route.triggerResult !== "unknown")
    ? "applies_together"
    : "candidate";

  const {
    name: _name,
    agency: _agency,
    deadline: _deadline,
    deadlineDisplay: _deadlineDisplay,
    latestApplyDate: _latestApplyDate,
    applyAfterDate: _applyAfterDate,
    deadlineStatus: _deadlineStatus,
    slackDays: _slackDays,
    feeDisplay: _feeDisplay,
    portalName: _portalName,
    portalUrl: _portalUrl,
    portalInstructions: _portalInstructions,
    ...bindingWithoutRouteValues
  } = binding;
  return {
    ...bindingWithoutRouteValues,
    disposition,
    ruleIds: findings.flatMap((finding) => finding.ruleIds),
    notes: findings.flatMap((finding) => finding.notes),
    sources: findings.flatMap((finding) => finding.sources),
    ...(userSummary === null ? {} : { userSummary }),
    triggeredBy: findings.flatMap((finding) => finding.triggeredBy),
    deadlineUnknownFields: findings.flatMap((finding) => finding.deadlineUnknownFields),
    noteText: publishedText((finding) => finding.noteText),
    conflictText: publishedText((finding) => finding.conflictText),
    timelineUnresolvedReason: publishedText((finding) => finding.timelineUnresolvedReason),
    ...(verificationDates.some((date) => date !== undefined) ? { lastVerifiedDate } : {}),
    routes,
    headlineMode,
    headlineRouteId: unattributable ? null : (binding.ruleIds[0] as string),
  } satisfies MergedFinding;
}

/** Findings sharing a dedupe key merge deterministically, retaining every contributing rule and source. */
function dedupe(
  findings: readonly (Contribution & { readonly dedupeKey: string | null })[],
): Finding[] {
  const groups: Contribution[][] = [];
  const positionByKey = new Map<string, number>();
  for (const { dedupeKey, ...contribution } of findings) {
    const existing = dedupeKey === null ? undefined : positionByKey.get(dedupeKey);
    if (existing === undefined) {
      if (dedupeKey !== null) positionByKey.set(dedupeKey, groups.length);
      groups.push([contribution]);
      continue;
    }
    (groups[existing] as Contribution[]).push(contribution);
  }
  return groups.map(mergeGroup);
}

/**
 * The same gate applied to one route, off that route's own published window. The note stays on the
 * finding: it is one sentence about the sequence, not a per-route value.
 */
function sequenceRoute(
  route: FindingRoute,
  applyAfterDate: string,
  slackWarningDays: number,
  sequencingNote: string,
): FindingRoute {
  const windowDays =
    route.latestApplyDate === null
      ? null
      : differenceInCalendarDays(applyAfterDate, route.latestApplyDate);
  const closed = windowDays !== null && windowDays < 0;
  return {
    ...route,
    // The caveat too: a route's notes are captured when the group merges and this runs after, so
    // without it the per-route readers state the sequence and lose the sentence qualifying it.
    notes: [...(route.notes ?? []), sequencingNote],
    applyAfterDate: closed ? null : applyAfterDate,
    slackDays: closed ? null : (windowDays ?? route.slackDays),
    deadlineStatus:
      windowDays !== null && windowDays < slackWarningDays && route.deadlineStatus === "on_track"
        ? "deadline_approaching"
        : route.deadlineStatus,
  };
}

function applyDependencySequencing(
  findings: readonly Finding[],
  context: DeadlineContext,
): Finding[] {
  // Keyed by every contributing rule id, not by `ruleIds[0]`.
  const byRuleId = new Map<string, Finding>();
  for (const finding of findings) {
    for (const ruleId of finding.ruleIds) byRuleId.set(ruleId, finding);
  }
  const sequenced = new Map<string, Finding>();

  for (const binding of DEPENDENCY_SEQUENCING_BINDINGS) {
    const dependency = byRuleId.get(binding.dependencyRuleId);
    const upstream = byRuleId.get(binding.upstreamRuleId);
    const gated = byRuleId.get(binding.gatedRuleId);
    if (dependency === undefined || upstream === undefined || gated === undefined) continue;
    const upstreamHeadline = headlineOf(upstream);
    if (upstreamHeadline?.deadline?.type !== "composite") continue;

    const [earliestDecisionDays, latestDecisionDays] =
      upstreamHeadline.deadline.processingRangeDays;
    const applyAfterDate = addCalendarDays(context.today, earliestDecisionDays);
    // WHOSE WINDOW IS BEING SEQUENCED: the gated RULE's, which on a merged line is its route entry rather than the line's scalars.
    const gatedRoute =
      gated.routes?.find((route) => route.ruleId === binding.gatedRuleId) ?? headlineOf(gated);
    if (gatedRoute === null) continue;
    const gatedLatestApplyDate = gatedRoute.latestApplyDate;
    const gatedDeadlineStatus = gatedRoute.deadlineStatus;

    // Window width: between the earliest upstream decision and the gated item's own deadline
    // (F-102 AC 5). Narrow or negative means the sequence is a squeeze.
    const gatedWindowDays =
      gatedLatestApplyDate === null
        ? null
        : differenceInCalendarDays(applyAfterDate, gatedLatestApplyDate);

    // The sequencing may tighten the rendering but may never close a window on its own: the dependency rule's verification block says a strict issued-before-filed order is NOT confirmed by located primary text.
    const isSqueezed = gatedWindowDays !== null && gatedWindowDays < context.slackWarningDays;

    // A window that closed before it opened is not a countdown.
    const sequenceClosedWindow = gatedWindowDays !== null && gatedWindowDays < 0;

    // Strict issued-before-filed sequencing is not confirmed, so the direct route stays open — but only while this finding's own published deadline is.
    const directFilingOpen = gatedDeadlineStatus !== "published_deadline_missed";

    // WHOSE WINDOW THE HEADLINE SEQUENCING IS ABOUT.
    /** The caveat this sequence has to travel with, composed once and attached BOTH to the finding and to the gated route. */
    const sequencingNote =
      `sequenced after ${binding.upstreamRuleId} per ${binding.dependencyRuleId}: earliest ` +
      `pursuit ${applyAfterDate}, once the ${earliestDecisionDays}–${latestDecisionDays} day ` +
      `decision window opens` +
      (gatedWindowDays === null
        ? ""
        : sequenceClosedWindow
          ? `, which is after this permit's own ${gatedLatestApplyDate ?? ""} deadline, so ` +
            `the sequence leaves no window to file in. Strict issued-before-filed sequencing ` +
            `is not confirmed by located primary text` +
            (directFilingOpen
              ? ` — filing directly may still be open, so confirm the order with the agency`
              : `, so confirm the order with the agency`)
          : `, leaving ${gatedWindowDays} days to file. Strict issued-before-filed sequencing ` +
            `is not confirmed by located primary text — confirm the order with the agency`);

    if (gated.routes === undefined) {
      sequenced.set(binding.gatedRuleId, {
        ...gated,
        applyAfterDate: sequenceClosedWindow ? null : applyAfterDate,
        slackDays: sequenceClosedWindow ? null : (gatedWindowDays ?? gated.slackDays),
        deadlineStatus:
          isSqueezed && gated.deadlineStatus === "on_track"
            ? "deadline_approaching"
            : gated.deadlineStatus,
        notes: [...gated.notes, sequencingNote],
      });
    } else {
      sequenced.set(binding.gatedRuleId, {
        ...gated,
        routes: gated.routes.map((route) =>
          route.ruleId === binding.gatedRuleId
            ? sequenceRoute(route, applyAfterDate, context.slackWarningDays, sequencingNote)
            : route,
        ),
        notes: [...gated.notes, sequencingNote],
      });
    }
  }

  return findings.map((finding) => {
    const gatedRuleId = finding.ruleIds.find((ruleId) => sequenced.has(ruleId));
    return gatedRuleId === undefined ? finding : (sequenced.get(gatedRuleId) as Finding);
  });
}

export function resolveFindings(
  intake: EventIntake,
  ruleset: EngineRuleset,
  context: PlanContext,
): ResolvedFindings {
  const scope = createScopeResolver(intake, ruleset);
  const deadlineContext: DeadlineContext = { ...context, scope };
  const trace: EvaluationTraceEntry[] = [];
  const triggered: (Contribution & { dedupeKey: string | null })[] = [];
  const unknownFields = new Set<string>();
  const blockingRuleIds = new Set<string>();

  for (const rule of ruleset.rules) {
    const evaluation = evaluateTrigger(rule.trigger, intake, scope);
    trace.push({ ruleId: rule.id, result: evaluation.result });
    if (evaluation.result === "false") continue;
    for (const field of evaluation.unknownFields) unknownFields.add(field);
    // A no-new-requirement claim is only safe after its trigger resolves. Keep the
    // unknown in the trace and branch inputs, but do not emit the claim itself (#179).
    if (
      evaluation.result === "unknown" &&
      resolveDisposition(rule, evaluation.result) === "no_new_requirement"
    ) {
      continue;
    }
    const finding = buildFinding(rule, evaluation.result, evaluation.triggeredBy, deadlineContext);
    // An unknown that surfaces while dating a finding is as material as one from its trigger.
    for (const field of finding.deadlineUnknownFields) unknownFields.add(field);
    // OFFICIAL_CONFLICT is excluded because F-102 states it plainly: an official-conflict finding never flips the verdict by itself.
    if (
      canBlockWhenMissed(
        { disposition: finding.disposition, triggerResult: evaluation.result },
        rule.verificationStatus,
      )
    ) {
      blockingRuleIds.add(rule.id);
    }
    triggered.push({
      finding,
      triggerResult: evaluation.result,
      unknownFields: evaluation.unknownFields,
      dedupeKey: rule.dedupeKey,
    });
  }

  return {
    findings: applyDependencySequencing(dedupe(triggered), deadlineContext),
    trace,
    unknownFields: [...unknownFields],
    definiteRoutes: { blockingRuleIds },
  };
}
