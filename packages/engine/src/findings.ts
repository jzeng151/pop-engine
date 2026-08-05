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
 * publish several, and the group's is the strongest of them: rules sharing a dedupe key are several
 * published routes to one requirement, so any one of them applying means the requirement applies.
 * A weaker value would tell an organizer that a filing they must make merely might apply.
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

function strongerDisposition(strongest: Disposition, finding: Finding): Disposition {
  return DISPOSITION_STRENGTH.indexOf(finding.disposition) > DISPOSITION_STRENGTH.indexOf(strongest)
    ? finding.disposition
    : strongest;
}

/**
 * The contributing rule whose published filing window binds the group, and so the rule the merged
 * line reads as: a dated rule over an undated one, the earlier window between two dated ones, and
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
function bindsTighter(a: Finding, b: Finding): Finding {
  if (a.latestApplyDate !== b.latestApplyDate) {
    if (a.latestApplyDate === null) return b;
    if (b.latestApplyDate === null) return a;
    return a.latestApplyDate < b.latestApplyDate ? a : b;
  }
  return (a.ruleIds[0] ?? "") <= (b.ruleIds[0] ?? "") ? a : b;
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
 * The merged line reads as its binding rule rather than as whichever rule the ruleset happens to
 * list first, and carries the group's strongest disposition. Ruleset order is not a regulatory
 * fact, and until this it decided both: nyc.v2.11's `dob-structure` group mixes disposition and
 * deadline, so reversing those two rules in the published file turned a `required` finding with a
 * filing date into a `may_be_required` one with none, no regulatory fact having changed (#239).
 *
 * NO APPROVED ARTIFACT STATES THESE MERGED VALUES. `ARCHITECTURE.md` says only that a group merges
 * deterministically, retaining every contributing rule and source; the precedence table
 * `ARCHITECTURE-FUTURE.md` §8.4 calls for is Phase 2+ direction and does not exist yet. What is
 * taken from §8.4 is the two things it settles now — a blocking finding is never erased on a shared
 * key, and merge order is deterministic rather than incidental array order. The rest is the safe
 * direction for a regulatory product: understating what an organizer must file, or how soon, is the
 * failure this cannot risk. Nothing here asserts a new regulatory fact. Every merged value is some
 * contributing rule's own published value, and every contributing rule stays in `ruleIds` and
 * `sources`, so neither route to the requirement is hidden.
 */
function mergeGroup(group: readonly Finding[]): Finding {
  const first = group[0] as Finding;
  if (group.length === 1) return first;

  const binding = group.reduce(bindsTighter);
  const userSummary = mergeUserSummary(group, binding);
  const verificationDates = group.map((finding) => finding.lastVerifiedDate);
  const published = verificationDates.filter((date): date is string => typeof date === "string");
  const lastVerifiedDate: string | null =
    published.length === group.length
      ? published.reduce((earliest, date) => (date < earliest ? date : earliest))
      : null;
  const firstNonNull = <T>(values: readonly (T | null)[]): T | null =>
    values.find((value): value is T => value !== null) ?? null;

  return {
    ...binding,
    disposition: group.reduce(strongerDisposition, first.disposition),
    ruleIds: group.flatMap((finding) => finding.ruleIds),
    notes: group.flatMap((finding) => finding.notes),
    sources: group.flatMap((finding) => finding.sources),
    ...(userSummary === null ? {} : { userSummary }),
    triggeredBy: group.flatMap((finding) => finding.triggeredBy),
    deadlineUnknownFields: group.flatMap((finding) => finding.deadlineUnknownFields),
    timelineUnresolvedReason: firstNonNull(group.map((f) => f.timelineUnresolvedReason)),
    noteText: firstNonNull(group.map((finding) => finding.noteText)),
    conflictText: firstNonNull(group.map((finding) => finding.conflictText)),
    ...(verificationDates.some((date) => date !== undefined) ? { lastVerifiedDate } : {}),
  };
}

/** Findings sharing a dedupe key merge deterministically, retaining every contributing rule and source. */
function dedupe(findings: readonly { finding: Finding; dedupeKey: string | null }[]): Finding[] {
  const groups: Finding[][] = [];
  const positionByKey = new Map<string, number>();
  for (const { finding, dedupeKey } of findings) {
    const existing = dedupeKey === null ? undefined : positionByKey.get(dedupeKey);
    if (existing === undefined) {
      if (dedupeKey !== null) positionByKey.set(dedupeKey, groups.length);
      groups.push([finding]);
      continue;
    }
    (groups[existing] as Finding[]).push(finding);
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
  const triggered: { finding: Finding; dedupeKey: string | null }[] = [];
  const unknownFields = new Set<string>();

  for (const rule of ruleset.rules) {
    const evaluation = evaluateTrigger(rule.trigger, intake, scope);
    trace.push({ ruleId: rule.id, result: evaluation.result });
    if (evaluation.result === "false") continue;
    for (const field of evaluation.unknownFields) unknownFields.add(field);
    const finding = buildFinding(rule, evaluation.result, evaluation.triggeredBy, deadlineContext);
    // An unknown that surfaces while dating a finding is as material as one from its trigger.
    for (const field of finding.deadlineUnknownFields) unknownFields.add(field);
    triggered.push({ finding, dedupeKey: rule.dedupeKey });
  }

  return {
    findings: applyDependencySequencing(dedupe(triggered), deadlineContext),
    trace,
    unknownFields: [...unknownFields],
  };
}
