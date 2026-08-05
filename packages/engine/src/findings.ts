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
  FindingSource,
  DeadlineStatus,
  Disposition,
  TriggeredBy,
  RuleUserSummary,
  Tristate,
} from "./types";

export type ResolvedFindings = {
  readonly findings: readonly Finding[];
  readonly trace: readonly EvaluationTraceEntry[];
  /** Intake fields whose unanswered state left at least one finding conditional. */
  readonly unknownFields: readonly string[];
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
const DISPOSITION_STRENGTH: readonly Disposition[] = [
  "no_new_requirement",
  "advisory",
  "may_be_required",
  "required",
  "prohibited_or_ineligible",
];

/** The strongest a route whose own trigger did not resolve can contribute (§8.4, and see below). */
const UNRESOLVED_ROUTE_CEILING: Disposition = "may_be_required";

/**
 * One contributing route to a group's requirement: its finding, and whether its own trigger
 * resolved. The trigger result is not on `Finding` and is not published anywhere; it is carried
 * here only so the merge can honor §8.4's "candidate requirements produced by official-conflict or
 * unknown branches remain conditional; they are not promoted by deduplication".
 */
type Contribution = { readonly finding: Finding; readonly triggerResult: Tristate };

/**
 * What a route contributes to the group's disposition, which is its own published value except
 * that an unresolved route cannot carry the group past `may_be_required`. `resolveDisposition()`
 * already applies that to a `required` rule on its own finding; a `prohibited_or_ineligible` one
 * keeps its published value there, because a single conditional blocker still renders as the
 * blocking answer it publishes. What §8.4 forbids is deduplication promoting it: merging would
 * make an unanswered question the whole line's definite blocker, so a plan could call an event
 * ineligible when the missing answer may remove the blocker. The route stays in `ruleIds`,
 * `sources`, `notes` and `triggeredBy`, and its unanswered field stays a material unknown, so the
 * conditional blocker is asked about rather than dropped.
 */
function contributedDisposition({ finding, triggerResult }: Contribution): Disposition {
  if (triggerResult !== "unknown") return finding.disposition;
  return DISPOSITION_STRENGTH.indexOf(finding.disposition) >
    DISPOSITION_STRENGTH.indexOf(UNRESOLVED_ROUTE_CEILING)
    ? UNRESOLVED_ROUTE_CEILING
    : finding.disposition;
}

function strongerDisposition(strongest: Disposition, contribution: Contribution): Disposition {
  const contributed = contributedDisposition(contribution);
  return DISPOSITION_STRENGTH.indexOf(contributed) > DISPOSITION_STRENGTH.indexOf(strongest)
    ? contributed
    : strongest;
}

/**
 * How available a route's filing window is, lowest first. A group's members are alternative
 * published routes to one requirement, so the route that binds the merged line is the tightest one
 * the organizer can still use:
 *
 * 0. a published window the engine could not date. It constrains filing and its width is unknown,
 *    so it cannot be ranked behind a window that happens to be datable, which would render the
 *    group `on_track` while one of its routes has an uncomputed window. It is also what the
 *    deployed configuration produces: with no published holiday list, DOB-TENT-001's 15-business-day
 *    window is real and `not_calculable`, and ranking it behind a rule that publishes no window at
 *    all lost the window, its status, its fee and its summary in production (#244 review).
 * 1. a published window that is dated and still open.
 * 2. a published window that has closed. A closed route is no longer a route, so it never binds
 *    while another is open; a group whose routes have all closed still renders as missed.
 * 3. no published window at all. Such a route says nothing about when the requirement must be
 *    filed, so it cannot decide the group's timeline.
 */
function windowAvailability(finding: Finding): number {
  if (finding.deadline === null) return 3;
  if (finding.deadlineStatus === "published_deadline_missed") return 2;
  return finding.latestApplyDate === null ? 0 : 1;
}

/**
 * The contributing rule whose published filing window binds the group, and so the rule the merged
 * line reads as: the most available window (above), the earlier of two equally available ones, and
 * the lower rule id when neither of those separates them.
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
 * points, or absent when no contributing rule publishes one.
 */
function mergeUserSummary(group: readonly Finding[], binding: Finding): RuleUserSummary | null {
  const summaries = group.flatMap((finding) =>
    finding.userSummary === undefined || finding.userSummary === null ? [] : [finding.userSummary],
  );
  if (summaries.length === 0) return null;
  const heading = binding.userSummary?.heading ?? (summaries[0] as RuleUserSummary).heading;
  return { heading, points: summaries.flatMap((summary) => summary.points) };
}

/**
 * One finding for a dedupe group, retaining every contributing rule, source and trigger reason.
 *
 * ONE RULE DECIDES EVERY FIELD, and it is a reading of what a dedupe group is: its members are
 * alternative published routes to one requirement. That reading gives three classes of field.
 *
 * 1. `disposition` is the strongest any route still offers, because any one route applying means
 *    the requirement applies. An unresolved route is capped at `may_be_required` per §8.4.
 * 2. Every scalar the organizer would act on, meaning `name`, `agency`, `deadline`, `deadlineDisplay`,
 *    `latestApplyDate`, `deadlineStatus`, `slackDays`, `feeDisplay`, `portalName`, `portalUrl`,
 *    `portalInstructions`, the summary heading and `verificationStatus`, comes from ONE route, the
 *    binding rule, so the line describes a filing an organizer can actually make. The binding rule
 *    is the route that supplies the merged disposition and binds tightest (`compareBinding`).
 *    Taking the disposition from one route and the filing detail from another is what produced
 *    hybrids: a blocked requirement carrying a permit's apply-by date, fee and portal (#244
 *    review). None of these fields falls back to another route, because a value acted on has to
 *    belong to the route the line describes.
 * 3. `ruleIds`, `notes`, `sources`, `triggeredBy`, `deadlineUnknownFields` and the summary points
 *    concatenate over every route in contributing order, which is the approved contract that a
 *    merged finding retains every contributing rule and source. `lastVerifiedDate` is the earliest
 *    across the group when every route publishes one; it is fact provenance, not a rendered filing
 *    detail.
 * 4. The three published text fields (`noteText`, `conflictText` and `timelineUnresolvedReason`)
 *    are the binding route's, and where the binding route publishes none they fall back through the
 *    remaining routes in the same binding order. They are single-valued, so they cannot concatenate
 *    like `notes`, and they carry text that must not be dropped: a scope or eligibility caveat,
 *    both readings of an official conflict, and the reason a published window could not be dated,
 *    which `verdict.ts` reads to keep a plan conditional. The fallback is ordered by the same total
 *    order, so it is not the file order the defect was, and it only ever fills a field the binding
 *    route leaves empty.
 *
 * THE LOSING ROUTES' `feeDisplay` AND PORTAL FIELDS ARE NOT RENDERED ON THE MERGED LINE. That is a
 * consequence of (2) and is stated rather than left implicit: two fees or two portals on one line
 * would read as two payments or two filings, which no artifact supports. Nothing is fabricated and
 * the alternate route is not hidden: it keeps its rule id, citation, notes, trigger reasons and
 * its own summary points (including any fee or action point it publishes), so an organizer sees
 * that a second published route exists and what it says.
 *
 * Ruleset order is not a regulatory fact, and until this it decided all of the above: nyc.v2.11's
 * `dob-structure` group mixes disposition and deadline, so reversing those two rules in the
 * published file turned a `required` finding with a filing date into a `may_be_required` one with
 * none, no regulatory fact having changed (#239).
 *
 * NO APPROVED ARTIFACT STATES THESE MERGED VALUES. `ARCHITECTURE.md` says only that a group merges
 * deterministically, retaining every contributing rule and source; the precedence table
 * `ARCHITECTURE-FUTURE.md` §8.4 calls for is Phase 2+ direction and does not exist yet. What is
 * taken from §8.4 is the three things it settles now, that a blocking finding is never erased on a
 * shared key, an unknown or official-conflict branch's candidate is not promoted by deduplication,
 * and merge order is deterministic rather than incidental array order. The rest is the safe
 * direction for a regulatory product: understating what an organizer must file, or how soon, is the
 * failure this cannot risk. It is approved as product scope (`docs/BASELINE.md`, AD-18). Nothing
 * here asserts a new regulatory fact. Every merged value is some contributing rule's own published
 * value, and every contributing rule stays in `ruleIds` and `sources`.
 */
function mergeGroup(group: readonly Contribution[]): Finding {
  const first = group[0] as Contribution;
  if (group.length === 1) return first.finding;

  const disposition = group.reduce(strongerDisposition, contributedDisposition(first));
  const binding = group
    .filter((contribution) => contributedDisposition(contribution) === disposition)
    .map((contribution) => contribution.finding)
    .sort(compareBinding)[0] as Finding;
  const findings = group.map((contribution) => contribution.finding);
  // The binding route first, then the rest in the same order, for the text fields it leaves empty.
  const byBinding = [binding, ...findings.filter((f) => f !== binding).sort(compareBinding)];
  const publishedText = (read: (finding: Finding) => string | null): string | null =>
    byBinding.map(read).find((text) => text !== null) ?? null;
  const userSummary = mergeUserSummary(findings, binding);
  const verificationDates = findings.map((finding) => finding.lastVerifiedDate);
  const published = verificationDates.filter((date): date is string => typeof date === "string");
  const lastVerifiedDate: string | null =
    published.length === group.length
      ? published.reduce((earliest, date) => (date < earliest ? date : earliest))
      : null;

  return {
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
function applyDependencySequencing(
  findings: readonly Finding[],
  context: DeadlineContext,
): Finding[] {
  const byRuleId = new Map(findings.map((finding) => [finding.ruleIds[0] ?? "", finding]));
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

    sequenced.set(binding.gatedRuleId, {
      ...gated,
      // `apply_after_date` is an actionable gate: F-202 renders it as the start date and F-203
      // schedules `dependency_unlocked` at it. When the upstream decision is expected after this
      // finding's own deadline there is no such date — unlocking the task then would be unlocking
      // it late — so the field is null and the note below carries the conflict instead. Both
      // consumers read the field: a date means "wait until this date", null means there is no
      // gate to wait for.
      applyAfterDate: sequenceClosedWindow ? null : applyAfterDate,
      // Slack for a gated finding is the window it can actually be filed in, not the distance
      // from today to its own deadline (F-102 AC 5: latest_apply − apply_after). Keeping the
      // ungated figure overstates the buffer that deadline copy and F-203's alerts read.
      slackDays: sequenceClosedWindow ? null : (gatedWindowDays ?? gated.slackDays),
      deadlineStatus:
        isSqueezed && gated.deadlineStatus === "on_track"
          ? "deadline_approaching"
          : gated.deadlineStatus,
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

  return findings.map((finding) => sequenced.get(finding.ruleIds[0] ?? "") ?? finding);
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

  for (const rule of ruleset.rules) {
    const evaluation = evaluateTrigger(rule.trigger, intake, scope);
    trace.push({ ruleId: rule.id, result: evaluation.result });
    if (evaluation.result === "false") continue;
    for (const field of evaluation.unknownFields) unknownFields.add(field);
    const finding = buildFinding(rule, evaluation.result, evaluation.triggeredBy, deadlineContext);
    // An unknown that surfaces while dating a finding is as material as one from its trigger.
    for (const field of finding.deadlineUnknownFields) unknownFields.add(field);
    triggered.push({ finding, triggerResult: evaluation.result, dedupeKey: rule.dedupeKey });
  }

  return {
    findings: applyDependencySequencing(dedupe(triggered), deadlineContext),
    trace,
    unknownFields: [...unknownFields],
  };
}
