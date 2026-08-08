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
  DeadlineStatus,
  Disposition,
  HeadlineMode,
  TriggeredBy,
  RuleUserSummary,
  Tristate,
} from "./types";

/**
 * Which routes resolved on their own triggers, which is what decides whether a missed window may
 * close a plan (#254). The trigger result is not on `Finding`, so `verdict.ts` cannot recover it.
 *
 * ONE SET, NOT THE TWO #254 INTRODUCED. That change carried a second set naming the route each
 * merged line's TIMELINE was read off, because under AD-19 a line's disposition and its window came
 * from different routes and neither was recoverable from the line. `verdict.ts` no longer reads
 * merged lines at all: it reads route entries, and each entry pairs a disposition with the window
 * published by the SAME rule, so one id answers both halves of the question and the second set has
 * nothing left to distinguish. What #254 fixed is unchanged, because it is this set that does the
 * work: a route whose trigger came back `unknown` is absent here whatever it publishes.
 */
export type DefiniteRoutes = {
  /**
   * Rules that published a disposition at or above `required` AND whose own trigger resolved, so
   * the requirement or bar they assert does not hang off an unanswered question. `verdict.ts` reads
   * this to decide which missed routes may close a plan; see `blocksWhenMissed` there.
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

/**
 * The rule's own notes, plus the published caveats that qualify what it says: the deadline's
 * `qualification` (which instrument applies, calendar vs business days) and the verification
 * block's, both of which are regulatory text and neither of which may be dropped just because the
 * engine computed a date. Any deadline the engine could not compute also gets the published
 * "confirm with agency" treatment. RESEARCH_REQUIRED itself does not add the same text here:
 * renderers own that visible status treatment, and adding it to notes renders it twice.
 */
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

/**
 * Weakest to strongest. A merged finding carries one disposition where its contributing rules may
 * publish several, and the group's is the strongest any contributing route still offers: rules
 * sharing a dedupe key are several published routes to one requirement, so any one of them applying
 * means the requirement applies. A weaker value would tell an organizer that a filing they must
 * make merely might apply.
 *
 * `prohibited_or_ineligible` sits at the top because `ARCHITECTURE-FUTURE.md` §8.4 already settles
 * that end: a blocking eligibility or prohibition finding is never erased by a permit finding with
 * the same key.
 */
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

/**
 * One contributing route to a group's requirement: its finding, and whether its own trigger
 * resolved. The trigger result is not on `Finding` and is not published anywhere; it is carried
 * here only so the merge can honor §8.4's "candidate requirements produced by official-conflict or
 * unknown branches remain conditional; they are not promoted by deduplication".
 */
type Contribution = {
  readonly finding: Finding;
  readonly triggerResult: Tristate;
  /** The intake fields this rule's own trigger could not resolve. */
  readonly unknownFields: readonly string[];
};

/**
 * Whether the ceiling bites on this group. What §8.4 forbids is deduplication PROMOTING an
 * unresolved candidate, so the cap only has something to do where the group already holds a
 * RESOLVED route the unresolved one would be promoted PAST, which means a resolved `required` or
 * `prohibited_or_ineligible`. Applying it unconditionally instead DEMOTED groups §8.4 says nothing
 * about: two conditional blockers on one key, or a conditional blocker beside an advisory, rendered
 * `may_be_required` where a lone conditional blocker renders as the blocking answer it publishes,
 * and `plan-line.tsx` dropped the blocker styling with it (#244 review).
 *
 * Setting that bar at the ceiling itself rather than above it kept one case of the same defect: a
 * resolved `may_be_required` route beside a conditional blocker capped the blocker to
 * `may_be_required` too, so an unrelated rule on the same key publishing MAY_BE_REQUIRED rather
 * than ADVISORY was the whole difference between a line styled as a blocker and one that reads
 * "may be required". Capping there promotes the blocker past nothing: `may_be_required` is what the
 * cap produces, so the merged line says exactly what the resolved route already said, while the
 * blocking route's own published `prohibited_or_ineligible` is lost. Preserving it is not a
 * promotion by deduplication, because `resolveDisposition()` only demotes a `required` rule, so the
 * blocking route published that value on its own finding (#244 review).
 */
function unresolvedRouteCeilingApplies(group: readonly Contribution[]): boolean {
  return group.some(
    ({ finding, triggerResult }) =>
      triggerResult !== "unknown" &&
      DISPOSITION_STRENGTH.indexOf(finding.disposition) >=
        DISPOSITION_STRENGTH.indexOf(UNRESOLVED_ROUTE_CAP_TRIGGER),
  );
}

/**
 * What a route contributes to the group's disposition, which is its own published value except
 * that an unresolved route cannot carry the group past `may_be_required` where the ceiling applies
 * (above). `resolveDisposition()` already applies that to a `required` rule on its own finding; a
 * `prohibited_or_ineligible` one keeps its published value there, because a single conditional
 * blocker still renders as the blocking answer it publishes, and it keeps it here too unless the
 * group holds a resolved route at or above the ceiling. Past such a route is exactly what §8.4
 * forbids deduplication promoting it: merging would make an unanswered question the whole line's
 * definite blocker, so a plan could call an event ineligible when the missing answer may remove the
 * blocker. The route stays in `ruleIds`, `sources`, `notes` and `triggeredBy`, and its unanswered
 * field stays a material unknown, so the conditional blocker is asked about rather than dropped.
 */
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

function strongestDisposition(dispositions: readonly Disposition[]): Disposition {
  return dispositions.reduce((strongest, value) =>
    DISPOSITION_STRENGTH.indexOf(value) > DISPOSITION_STRENGTH.indexOf(strongest)
      ? value
      : strongest,
  );
}

/**
 * How available a route's filing window is, lowest first. A group's members are alternative
 * published routes to one requirement, so the route that binds the merged line is the tightest one
 * the organizer can still use:
 *
 * 0. a published window that is dated and still open. It is the only case where the merged line can
 *    name a day the requirement can still be filed by, so it binds ahead of everything below.
 *    Ranking an undatable route first instead discarded a computed apply-by date, and with it the
 *    binding route's permit name, fee and portal, for a route that says nothing about when to file
 *    (#244 review).
 * 1. a published window that has closed. It is dated, and what it says is that the filing is
 *    already late, which is a fact about the requirement the merged line has to carry: it binds
 *    ahead of a window the engine could not date, because otherwise the merged line dropped
 *    `published_deadline_missed`, the closed route's apply-by date and its fee, and an INFEASIBLE
 *    plan read FEASIBLE (#244 review). A closed route never outranks an open one, so a group with
 *    one closed and one open route is not missed, and a group whose routes have all closed is.
 * 2. a published window the engine could not date. It constrains filing and its width is unknown,
 *    so it still binds ahead of a route that publishes no window at all: ranking it last lost the
 *    window, its status, its fee and its summary under the deployed configuration, which publishes
 *    no holiday list, so DOB-TENT-001's 15-business-day window is real and `not_calculable`. It
 *    ranks below a closed window rather than above it because an undatable route is not KNOWN to be
 *    open: a `research_required` lead time means no agency published one at all, and `deadlines.ts`
 *    excludes it from verdict and slack arithmetic, so letting it bind would decide the group's
 *    timeline on the route that says least about timing. Over-warning is the safe direction;
 *    understating how soon an organizer must file is the failure this cannot risk.
 * 3. no published window at all. Such a route says nothing about when the requirement must be
 *    filed, so it cannot decide the group's timeline.
 */
function windowAvailability(finding: Finding): number {
  if (finding.deadline === null) return 3;
  if (finding.deadlineStatus === "published_deadline_missed") return 1;
  return finding.latestApplyDate === null ? 2 : 0;
}

/**
 * The contributing rule whose published filing window binds the group, and so the rule the merged
 * line reads as: the most available window (above), the earlier of two equally available ones, and
 * the lower rule id when neither of those separates them. Ranked over every route in the group,
 * whatever disposition each contributes, so no filing window can be dropped for sitting in a
 * weaker disposition tier (`mergeGroup`).
 *
 * Earlier rather than later because a merged line shows one date, and showing the later of two
 * published windows understates urgency — an organizer would still be inside the rendered window
 * after the real one had closed. The rule-id tie-break is not a judgement about which rule matters
 * more; it exists so the answer depends on the rules rather than on where they sit in the file.
 *
 * A total order over the group, so which member wins does not depend on the order they arrive in,
 * which is the whole point (#239).
 */
function compareBinding(a: Finding, b: Finding): number {
  const available = windowAvailability(a) - windowAvailability(b);
  if (available !== 0) return available;
  if (
    a.latestApplyDate !== b.latestApplyDate &&
    a.latestApplyDate !== null &&
    b.latestApplyDate !== null
  ) {
    return a.latestApplyDate < b.latestApplyDate ? -1 : 1;
  }
  return (a.ruleIds[0] ?? "") <= (b.ruleIds[0] ?? "") ? -1 : 1;
}

/**
 * The group's plain-language block: the binding rule's heading over every contributing rule's
 * points, or absent when no contributing rule publishes one. The heading is single-valued published
 * text, so where the binding rule publishes no summary it falls back through the remaining routes
 * in binding order, like the other three. Falling back through contributing order instead left the
 * rendered h3 of a three-route group decided by which rule sits earlier in the published file,
 * which is the #239 defect class surviving in one scalar (#244 review).
 */
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
  finding: Finding,
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
  };
}

/**
 * Every route a finding holds, and the ONE correct fallback for a finding that carries no list:
 * an unmerged finding is its own single route, and so is a replayed artifact stored before the
 * field existed. Consumers read routes through this rather than writing the fallback themselves,
 * because a consumer that forgets it silently stops seeing an unmerged finding's window.
 *
 * The synthesized route's `triggerResult` is `"true"`: the trigger result is not on `Finding` and
 * cannot be recovered from one, and every reader of this value asks whether a route is known to
 * apply, which for an unmerged finding is answered by its own `disposition` instead.
 */
export function routesOf(finding: Finding): readonly FindingRoute[] {
  return finding.routes ?? [routeFrom(finding, "true", [])];
}

/**
 * One finding for a dedupe group, retaining every contributing rule, source, trigger reason AND
 * every route's own published values.
 *
 * THE MERGED LINE IS NO LONGER THE ONLY PLACE A ROUTE'S FACTS CAN LIVE, and that is the whole
 * change. A group's members are alternative published routes to one requirement, and the line has
 * room for one name, one window, one fee. Three orderings of "which route wins the slot" were
 * tried: the first contributing rule (#239), one binding route for every field, and a per-field
 * split with identity following the strongest disposition and the timeline following the tightest
 * window (AD-19). Each moved the defect rather than removing it, and the last produced a line
 * naming route A while quoting route B's deadline and status, with A's own window unrecoverable
 * from anywhere on the finding. No ordering can be right: when the strongest disposition and the
 * tightest window select different routes, two routes have a claim on one slot.
 *
 * So every route keeps its own values in `routes`, and the line reads as ONE of them.
 *
 * 1. `disposition` is unchanged from AD-19: the strongest any route still offers, because any one
 *    route applying means the requirement applies, with a route whose own trigger resolved
 *    `unknown` capped at `may_be_required` where the group holds a resolved route at or above that
 *    ceiling (`unresolvedRouteCeilingApplies`). It never understates what an organizer must do.
 * 2. THE HEADLINE MODE SAYS WHY THE ROUTES CO-FIRED, because that is what decides how the line
 *    reads. A trigger that evaluates `unknown` produces a finding and enters the merge exactly like
 *    a `true` one, so co-firing is two situations wearing one shape: routes that genuinely apply
 *    together, and routes we cannot yet tell apart. Measured over the v2 full draft, five of the
 *    nine multi-member groups reach two members ONLY through unknowns, and `sapo_permit` reaches
 *    fourteen only when `sapo_event_type` is unanswered (`docs/research/draft-dedupe-cofiring.md`
 *    §4.2, §5.1). Collapsing that into one candidate's name, window and fee destroys the most
 *    information exactly when the organizer knows the least.
 * 3. IDENTITY AND TIMELINE COME FROM ONE ROUTE, the binding route, so a line can never name one
 *    route and date another. AD-19 split them because a published window must not be dropped for
 *    sitting in a weaker disposition tier; that reason is gone, because no window is dropped now.
 *    The binding route is the tightest window among the routes contributing the merged disposition,
 *    intersected with the RESOLVED routes where any resolved route exists, so the headline only ever
 *    moves from a route that might apply to one that does. The intersection is skipped where it
 *    would be empty, which is where the headline disposition comes only from unresolved routes: the
 *    mode is `candidate` there and the copy says so.
 * 4. `ruleIds`, `notes`, `sources`, `triggeredBy`, `deadlineUnknownFields` and the summary points
 *    concatenate over every route in contributing order, which is the approved contract that a
 *    merged finding retains every contributing rule and source. `lastVerifiedDate` is the earliest
 *    across the group when every route publishes one, being provenance for the whole line.
 * 5. The four single-valued published text fields (`noteText`, `conflictText`, the summary heading
 *    and `timelineUnresolvedReason`) cannot concatenate like `notes` and carry text that must not be
 *    dropped, so where the binding route publishes none they fall back through the remaining routes
 *    in binding order. That order is total, so it is not the file order the defect was, and the
 *    fallback only ever fills a field the binding route leaves empty.
 *
 * THE LOSING ROUTES' FEE AND PORTAL ARE STILL NOT ON THE HEADLINE. Two fees or two portals in one
 * slot would read as two payments or two filings. They are on the route entries instead, which is
 * where a reader can tell whose they are.
 *
 * NO APPROVED ARTIFACT STATES THESE MERGED VALUES. `ARCHITECTURE.md` says only that a group merges
 * deterministically, retaining every contributing rule and source; the precedence table
 * `ARCHITECTURE-FUTURE.md` §8.4 calls for is Phase 2+ direction and does not exist yet. What is
 * taken from §8.4 is the three things it settles now, that a blocking finding is never erased on a
 * shared key, an unknown or official-conflict branch's candidate is not promoted by deduplication,
 * and merge order is deterministic rather than incidental array order. The rest is the safe
 * direction for a regulatory product. AD-19 is the approved record of the rule this replaces;
 * `docs/proposals/dedupe-route-list.md` is PROPOSED and NOT APPROVED, and states exactly which
 * sentence of AD-19 it supersedes. Nothing here asserts a new regulatory fact: every value on the
 * line and on every route is some contributing rule's own published value.
 */
function mergeGroup(group: readonly Contribution[]): Finding {
  const first = group[0] as Contribution;
  if (group.length === 1) return first.finding;

  const ceilingApplies = unresolvedRouteCeilingApplies(group);
  const contributed = (contribution: Contribution): Disposition =>
    contributedDisposition(contribution, ceilingApplies);
  const disposition = strongestDisposition(group.map(contributed));
  const findings = group.map((contribution) => contribution.finding);

  // The routes that contributed the headline disposition, narrowed to those known to apply where
  // any of them is. Skipped where that leaves nothing, i.e. where the headline disposition comes
  // only from routes whose triggers did not resolve.
  const contributing = group.filter((contribution) => contributed(contribution) === disposition);
  const resolved = contributing.filter((contribution) => contribution.triggerResult !== "unknown");
  const bindingPool = resolved.length > 0 ? resolved : contributing;
  const binding = bindingPool
    .map((contribution) => contribution.finding)
    .sort(compareBinding)[0] as Finding;
  // The binding route first, then the rest, for the single-valued texts it leaves empty.
  const bindingOrder = [
    binding,
    ...findings.filter((finding) => finding !== binding).sort(compareBinding),
  ];
  const publishedText = (read: (finding: Finding) => string | null): string | null =>
    bindingOrder.map(read).find((text) => text !== null) ?? null;
  const userSummary = mergeUserSummary(findings, bindingOrder);
  const verificationDates = findings.map((finding) => finding.lastVerifiedDate);
  const published = verificationDates.filter((date): date is string => typeof date === "string");
  const lastVerifiedDate: string | null =
    published.length === group.length
      ? published.reduce((earliest, date) => (date < earliest ? date : earliest))
      : null;
  // IN BINDING ORDER, NOT CONTRIBUTING ORDER. `ruleIds`, `notes` and `sources` concatenate in
  // contributing order because they are provenance a reader scans; this list is the first place
  // the order becomes a ranked visual list an organizer chooses a permit from, and contributing
  // order is where the rules sit in the published file. That is the #239 defect class, arriving in
  // the new list (#252 review). `bindingOrder` is total and leads with the route the headline
  // reads, so the entry the line is about is the entry read first.
  const contributionOf = new Map(group.map((contribution) => [contribution.finding, contribution]));
  const routes = bindingOrder.map((finding) => {
    const { triggerResult, unknownFields } = contributionOf.get(finding) as Contribution;
    return routeFrom(finding, triggerResult, unknownFields);
  });
  const headlineMode: HeadlineMode = routes.every((route) => route.triggerResult !== "unknown")
    ? "applies_together"
    : "candidate";

  return {
    // Identity and timeline, both off the binding route.
    ...binding,
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
  };
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
 * Dependency sequencing (ARCHITECTURE "Typed deadlines": apply_after = upstream apply date +
 * processing range; slack for gated items = latest_apply − apply_after).
 *
 * The gated finding's window opens when the upstream decision could come back — the earliest end
 * of the upstream's own published processing range, counted from today, since applying now is the
 * best case available to the organizer. The upstream rule publishes that range; nothing here is
 * invented. The strictness of the ordering is RESEARCH_REQUIRED on the dependency rule, so this
 * dates when pursuit can realistically begin rather than asserting that filing earlier is barred.
 */
/**
 * The same gate applied to one route, off that route's own published window. The note stays on the
 * finding: it is one sentence about the sequence, not a per-route value.
 */
function sequenceRoute(
  route: FindingRoute,
  applyAfterDate: string,
  slackWarningDays: number,
): FindingRoute {
  const windowDays =
    route.latestApplyDate === null
      ? null
      : differenceInCalendarDays(applyAfterDate, route.latestApplyDate);
  const closed = windowDays !== null && windowDays < 0;
  return {
    ...route,
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
  // Keyed by every contributing rule id, not by `ruleIds[0]`. After a merge `ruleIds` concatenates
  // in contributing order, so the first entry is whichever member sits earlier in the published
  // file; keying on it silently skipped sequencing for a bound rule that merged and was not listed
  // first, which decided `applyAfterDate` and `slackDays` on file position (#244 review).
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
    if (upstream.deadline?.type !== "composite") continue;

    const [earliestDecisionDays, latestDecisionDays] = upstream.deadline.processingRangeDays;
    const applyAfterDate = addCalendarDays(context.today, earliestDecisionDays);
    // Window width: between the earliest upstream decision and the gated item's own deadline
    // (F-102 AC 5). Narrow or negative means the sequence is a squeeze.
    const gatedWindowDays =
      gated.latestApplyDate === null
        ? null
        : differenceInCalendarDays(applyAfterDate, gated.latestApplyDate);

    // The sequencing may tighten the rendering but may never close a window on its own: the
    // dependency rule's verification block says a strict issued-before-filed order is NOT
    // confirmed by located primary text. Reporting PUBLISHED_DEADLINE_MISSED off an unconfirmed
    // sequence would invent a blocker the sources do not support, so the worst it can do is warn.
    const isSqueezed = gatedWindowDays !== null && gatedWindowDays < context.slackWarningDays;

    // A window that closed before it opened is not a countdown. The upstream decision is expected
    // after this finding's own deadline, so there is no number of days to apply within — and
    // because the sequence is unconfirmed the finding is not missed either, since filing directly
    // is still possible today. Reporting the negative would put "apply within -5 days" into the
    // deadline copy and F-203's alerts; reporting null says what is true, that no gated countdown
    // exists, and leaves the conflict to the note below. The finding keeps its own published date.
    const sequenceClosedWindow = gatedWindowDays !== null && gatedWindowDays < 0;

    // Strict issued-before-filed sequencing is not confirmed, so the direct route stays open —
    // but only while this finding's own published deadline is. Past it, saying so would assert a
    // window the rule itself closed.
    const directFilingOpen = gated.deadlineStatus !== "published_deadline_missed";

    // WHOSE WINDOW THE HEADLINE SEQUENCING IS ABOUT. The merged line's scalars are the BINDING
    // route's, entirely, so that a line can never name one route and date another; `routes[0]` is
    // that route, because `mergeGroup` builds the list in binding order. Where the gated rule is a
    // non-binding member, sequencing the line wrote the gate, the gated slack and the squeezed
    // status onto scalars belonging to a route that is not gated at all — a headline naming the
    // ungated route while displaying the NYPD gate, with that route's own entry still reading
    // `applyAfterDate: null` beside it (#252 review). The route entries are sequenced either way,
    // which is where the gated route's own window has lived since `verdict.ts` began reading them,
    // so nothing is dropped by leaving the scalars to their route.
    //
    // An unmerged finding has one route and it is the binding one, so this is the whole of the
    // change: every single-rule line sequences exactly as before.
    const gatedRouteBinds =
      gated.routes === undefined || gated.routes[0]?.ruleId === binding.gatedRuleId;

    sequenced.set(binding.gatedRuleId, {
      ...gated,
      // `apply_after_date` is an actionable gate: F-202 renders it as the start date and F-203
      // schedules `dependency_unlocked` at it. When the upstream decision is expected after this
      // finding's own deadline there is no such date — unlocking the task then would be unlocking
      // it late — so the field is null and the note below carries the conflict instead. Both
      // consumers read the field: a date means "wait until this date", null means there is no
      // gate to wait for.
      applyAfterDate: !gatedRouteBinds
        ? gated.applyAfterDate
        : sequenceClosedWindow
          ? null
          : applyAfterDate,
      // Slack for a gated finding is the window it can actually be filed in, not the distance
      // from today to its own deadline (F-102 AC 5: latest_apply − apply_after). Keeping the
      // ungated figure overstates the buffer that deadline copy and F-203's alerts read.
      slackDays: !gatedRouteBinds
        ? gated.slackDays
        : sequenceClosedWindow
          ? null
          : (gatedWindowDays ?? gated.slackDays),
      deadlineStatus:
        isSqueezed && gatedRouteBinds && gated.deadlineStatus === "on_track"
          ? "deadline_approaching"
          : gated.deadlineStatus,
      // The gated rule's own route carries the same sequencing, computed off ITS OWN window rather
      // than off the merged line's. `verdict.ts` reads the routes, so a route left unsequenced
      // would put the ungated slack back into the verdict the sequencing just narrowed.
      ...(gated.routes === undefined
        ? {}
        : {
            routes: gated.routes.map((route) =>
              route.ruleId === binding.gatedRuleId
                ? sequenceRoute(route, applyAfterDate, context.slackWarningDays)
                : route,
            ),
          }),
      notes: [
        ...gated.notes,
        `sequenced after ${binding.upstreamRuleId} per ${binding.dependencyRuleId}: earliest ` +
          `pursuit ${applyAfterDate}, once the ${earliestDecisionDays}–${latestDecisionDays} day ` +
          `decision window opens` +
          (gatedWindowDays === null
            ? ""
            : sequenceClosedWindow
              ? `, which is after this permit's own ${gated.latestApplyDate ?? ""} deadline, so ` +
                `the sequence leaves no window to file in. Strict issued-before-filed sequencing ` +
                `is not confirmed by located primary text` +
                (directFilingOpen
                  ? ` — filing directly may still be open, so confirm the order with the agency`
                  : `, so confirm the order with the agency`)
              : `, leaving ${gatedWindowDays} days to file. Strict issued-before-filed sequencing ` +
                `is not confirmed by located primary text — confirm the order with the agency`),
      ],
    });
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
    const finding = buildFinding(rule, evaluation.result, evaluation.triggeredBy, deadlineContext);
    // An unknown that surfaces while dating a finding is as material as one from its trigger.
    for (const field of finding.deadlineUnknownFields) unknownFields.add(field);
    // OFFICIAL_CONFLICT is excluded because F-102 states it plainly: an official-conflict finding
    // never flips the verdict by itself. The rule's own reading of its window may be one of the two
    // that disagree, so closing a plan on it would resolve the conflict in the engine, in the
    // direction of the harsher reading, and `ARCHITECTURE-FUTURE.md` §8.4 says the same of
    // deduplication ("candidate requirements produced by official-conflict [...] branches remain
    // conditional"). The line still renders as published, with both readings and every source, and
    // it still contributes its window and its disposition to a merged line; it just cannot be the
    // route that closes the plan. Excluding it here rather than rejecting the disposition at parse
    // time is deliberate: what a rule publishes is regulatory content and the published ruleset is
    // authoritative over the engine (AGENTS.md), so the engine may decline to block on it but may
    // not overwrite it. A group cannot smuggle one in either, since `parseEngineRuleset` refuses a
    // dedupe key that mixes verification statuses, so an official-conflict route only ever merges
    // with other official-conflict routes (#254 review).
    if (
      evaluation.result === "true" &&
      rule.verificationStatus !== "OFFICIAL_CONFLICT" &&
      DISPOSITION_STRENGTH.indexOf(finding.disposition) >=
        DISPOSITION_STRENGTH.indexOf(BLOCKING_DISPOSITION_FLOOR)
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
