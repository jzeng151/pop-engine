// Verdict algorithm, ARCHITECTURE steps 3–6. Branch evaluation for unknowns runs before any
// window check, so an unknown-conditioned finding can never render INFEASIBLE (Scenario F).

import { DISPOSITION_STRENGTH, resolveFindings } from "./findings";
import type { PlanContext } from "./deadlines";
import {
  MISSED_MAY_BE_REQUIRED_IS_CONDITIONAL,
  RESCOPE_EXCLUDES_UNKNOWN_VALUES,
} from "./proposals";
import { UNKNOWN_ANSWER } from "./conditions";
import { triggerFields } from "./ruleset";
import type {
  EngineRuleset,
  EventIntake,
  Finding,
  IntakeValue,
  MissingFact,
  RescopeSuggestion,
  TriggerNode,
  UnresolvedTimeline,
  Verdict,
  VerdictDetail,
} from "./types";

const VERDICT_RANK: Readonly<Record<Verdict, number>> = {
  INFEASIBLE: 0,
  CONDITIONAL: 1,
  FEASIBLE_AT_RISK: 2,
  FEASIBLE: 3,
};

export type WindowVerdict = {
  readonly verdict: Verdict;
  readonly blockingFinding: Finding | null;
  readonly missedRuleIds: readonly string[];
  readonly minSlackDays: number | null;
};

const isMissed = (finding: Finding): boolean =>
  finding.deadlineStatus === "published_deadline_missed";

/**
 * Whether a missed finding blocks. `required` is the bar, not the whole set: `prohibited_or_ineligible`
 * sits ABOVE `required` in `DISPOSITION_STRENGTH`, so testing for equality let a finding that is both
 * barred and past its published window fall through to the missed-but-not-blocking branch and read
 * CONDITIONAL. Product owner, 2026-08-08.
 */
const blocksWhenMissed = (finding: Finding): boolean =>
  DISPOSITION_STRENGTH.indexOf(finding.disposition) >= DISPOSITION_STRENGTH.indexOf("required");

/**
 * Steps 4–6: the window checks, with no branch expansion. Also the per-branch and per-rescope
 * verdict, which is why it is separate from `computeVerdict`.
 */
export function computeWindowVerdict(findings: readonly Finding[]): WindowVerdict {
  const missed = findings.filter(isMissed);
  const missedRuleIds = missed.flatMap((finding) => finding.ruleIds);
  const slacks = findings
    .filter((finding) => finding.slackDays !== null && !isMissed(finding))
    .map((finding) => finding.slackDays as number);
  const minSlackDays = slacks.length === 0 ? null : Math.min(...slacks);

  // The blocking finding is the missed one with the longest published lead, i.e. the earliest date.
  const blocking = missed
    .filter(blocksWhenMissed)
    .sort((left, right) =>
      (left.latestApplyDate ?? "").localeCompare(right.latestApplyDate ?? ""),
    )[0];

  if (blocking !== undefined) {
    return { verdict: "INFEASIBLE", blockingFinding: blocking, missedRuleIds, minSlackDays };
  }
  if (MISSED_MAY_BE_REQUIRED_IS_CONDITIONAL && missed.length > 0) {
    return { verdict: "CONDITIONAL", blockingFinding: null, missedRuleIds, minSlackDays };
  }
  if (findings.some((finding) => finding.deadlineStatus === "deadline_approaching")) {
    return { verdict: "FEASIBLE_AT_RISK", blockingFinding: null, missedRuleIds, minSlackDays };
  }
  return { verdict: "FEASIBLE", blockingFinding: null, missedRuleIds, minSlackDays };
}

const ruleIdsOf = (findings: readonly Finding[]): string[] =>
  findings.flatMap((finding) => finding.ruleIds).sort();

/**
 * What a branch has to agree on before its unknown can be called immaterial: ARCHITECTURE step 3
 * makes an unknown that changes the finding set OR THE TIMELINE conditional, so the signature
 * carries each finding's date, not just the verdict.
 */
const branchSignature = (verdict: Verdict, findings: readonly Finding[]): string =>
  [
    verdict,
    ...[...findings]
      .map((finding) => `${finding.ruleIds.join("+")}@${finding.latestApplyDate ?? "-"}`)
      .sort(),
  ].join("|");

function describeDifference(base: readonly Finding[], candidate: readonly Finding[]): string {
  const baseIds = new Set(ruleIdsOf(base));
  const candidateIds = new Set(ruleIdsOf(candidate));
  const added = [...candidateIds].filter((id) => !baseIds.has(id));
  const dropped = [...baseIds].filter((id) => !candidateIds.has(id));
  // Rule ids, not organizer headings. This prose is persisted on the plan row, so the id is the
  // permanent anchor back to the published rule that produced the sentence; a heading is not unique
  // and any later ruleset publish may reword it. The organizer never reads the id: the plan view's
  // `humanizeRuleCodes` swaps each id for the same heading at render time.
  const describeMissed = (finding: Finding, id: string): string =>
    finding.deadlineStatus === "published_deadline_missed"
      ? `${id} (published deadline missed as scoped)`
      : id;
  const describeAdded = (id: string): string => {
    const finding = candidate.find((entry) => entry.ruleIds.includes(id));
    // F-102 AC 6: the no-license branch must surface the missed-window reason, not only the rule id.
    return finding === undefined ? id : describeMissed(finding, id);
  };

  // Same rule ids can still tighten: Scenario F's unresolved base already carries SLA-ONEDAY /
  // SLA-CATERING as may_be_required, and the no-license branch makes them required with a missed
  // window. Report that even when another finding is merely dropped (AC 6).
  const tightened: string[] = [];
  for (const finding of candidate) {
    const prior = base.find((entry) =>
      entry.ruleIds.some((ruleId) => finding.ruleIds.includes(ruleId)),
    );
    if (prior === undefined) continue;
    if (
      prior.disposition === finding.disposition &&
      prior.deadlineStatus === finding.deadlineStatus
    ) {
      continue;
    }
    if (finding.deadlineStatus === "published_deadline_missed") {
      tightened.push(`${finding.ruleIds.join(", ")} (published deadline missed as scoped)`);
      continue;
    }
    if (prior.disposition !== finding.disposition) {
      tightened.push(`${finding.ruleIds.join(", ")} becomes ${finding.disposition}`);
    }
  }

  const parts = [
    added.length > 0 ? `adds ${added.map(describeAdded).join(", ")}` : null,
    dropped.length > 0 ? `drops ${dropped.join(", ")}` : null,
    ...tightened,
  ].filter((part): part is string => part !== null);
  return parts.length > 0 ? parts.join("; ") : "same findings, re-dated";
}

type BranchValue = { readonly display: string; readonly value: IntakeValue };

/**
 * Declared alternatives for a field, minus its current answer and minus `unknown`. Booleans
 * enumerate as true/false: the registry declares no `values` for them, but an unanswered flag has
 * exactly two branches and leaving it out would drop it from the branch table (P1-B).
 */
function alternativeValues(
  field: string,
  intake: EventIntake,
  ruleset: EngineRuleset,
): BranchValue[] {
  const definition = ruleset.intakeFields.find((entry) => entry.field === field);
  if (definition === undefined) return [];
  if (definition.values !== null) {
    return definition.values
      .filter(
        (value) =>
          value !== intake[field] && !(RESCOPE_EXCLUDES_UNKNOWN_VALUES && value === UNKNOWN_ANSWER),
      )
      .map((value) => ({ display: value, value }));
  }
  if (definition.type === "boolean") {
    return [true, false]
      .filter((value) => value !== intake[field])
      .map((value) => ({ display: String(value), value }));
  }
  return [];
}

/**
 * Closed set of ruleset eras whose stored plans serialized pre-F-102 detail shapes (three-field
 * rescopes; threshold prose without conditional-boundary enrichment). Evaluating those artifacts
 * must keep that shape for AD-7 replay; nyc.v2.8+ emits the enriched fields.
 */
const PRE_F102_DETAIL_ERAS: ReadonlySet<string> = new Set([
  "nyc.v2.1",
  "nyc.v2.2",
  "nyc.v2.3",
  "nyc.v2.4",
  "nyc.v2.5",
  "nyc.v2.6",
  "nyc.v2.7",
]);

function emitsF102DetailEnrichment(rulesetVersion: string): boolean {
  return !PRE_F102_DETAIL_ERAS.has(rulesetVersion);
}

/**
 * The published thresholds that decide a field the engine cannot enumerate, so a numeric unknown
 * still tells a client what to ask for instead of leaving an empty branch table (P2).
 *
 * When a condition declares `boundary: "conditional"`, the exact threshold is unresolved (not
 * "below the line"), so the description must say so — e.g. DOB-TENT-001 at exactly 400 sq ft.
 * That clause is current-line enrichment only; superseded eras keep the shorter historical prose.
 */
function publishedThresholds(field: string, ruleset: EngineRuleset): string | null {
  const described: string[] = [];
  const enrichBoundary = emitsF102DetailEnrichment(ruleset.rulesetVersion);
  const walk = (node: TriggerNode, ruleId: string): void => {
    if ("field" in node) {
      if (node.field !== field || typeof node.value !== "number") return;
      const comparison = node.op === "gt" ? "above" : node.op === "gte" ? "at or above" : null;
      if (comparison === null) return;
      if (enrichBoundary && node.boundary === "conditional") {
        described.push(
          `${ruleId} applies ${comparison} ${node.value}; exactly ${node.value} is a conditional boundary (confirm with the publishing agency)`,
        );
      } else {
        described.push(`${ruleId} applies ${comparison} ${node.value}`);
      }
      return;
    }
    for (const child of "all" in node ? node.all : node.any) walk(child, ruleId);
  };
  // As in `describeDifference`: the persisted string carries the rule id, and the plan view
  // humanizes it at render time.
  for (const rule of ruleset.rules) walk(rule.trigger, rule.id);
  return described.length === 0 ? null : described.join("; ");
}

/** True when not_calculable is solely from an unpublished holiday list (SPEC-CONFLICT #130). */
function isUnpublishedCalendarUnresolved(reason: string | null): boolean {
  return reason !== null && reason.includes("holiday list; no list is published");
}

type ConditionalEvaluation = {
  readonly findings: readonly Finding[];
  readonly window: WindowVerdict;
  readonly verdict: Verdict;
  /**
   * The finding whose closed window explains an INFEASIBLE verdict. Usually the base window's,
   * but when the verdict is INFEASIBLE only because every branch of an unknown misses, the base
   * window has none: an unknown-triggered finding is downgraded to may_be_required and so never
   * blocks. Carrying the branch blocker out keeps the "published deadline missed" copy and the
   * rescope suggestions working instead of returning an unexplained INFEASIBLE.
   */
  readonly blockingFinding: Finding | null;
  readonly missingFacts: readonly MissingFact[];
  readonly unresolvedTimelines: readonly UnresolvedTimeline[];
};

/**
 * ARCHITECTURE step 3, recursively: every branch is evaluated FULLY, which means the unknowns that
 * remain inside a branch are branched there too. Resolving one field and then running the plain
 * window check would let the others vanish from that branch's verdict (P1-C).
 */
function evaluateConditional(
  intake: EventIntake,
  ruleset: EngineRuleset,
  context: PlanContext,
): ConditionalEvaluation {
  const resolved = resolveFindings(intake, ruleset, context);
  const window = computeWindowVerdict(resolved.findings);
  const unresolvedTimelines = resolved.findings
    .filter((finding) => finding.timelineUnresolvedReason !== null)
    .map((finding) => ({
      ruleIds: finding.ruleIds,
      reason: finding.timelineUnresolvedReason as string,
    }));

  const unknownFields = ruleset.intakeFields
    .map((definition) => definition.field)
    .filter((field) => resolved.unknownFields.includes(field));

  const missingFacts: MissingFact[] = [];
  const pathVerdicts: Verdict[] = [];
  const branchBlockers: Finding[] = [];
  let diverges = false;
  let hasNonEnumerableUnknown = false;

  for (const field of unknownFields) {
    const values = alternativeValues(field, intake, ruleset);
    if (values.length === 0) {
      hasNonEnumerableUnknown = true;
      missingFacts.push({ field, branches: [], thresholds: publishedThresholds(field, ruleset) });
      continue;
    }

    const branches = values.map((candidate) => {
      const branchIntake = { ...intake, [field]: candidate.value };
      return {
        display: candidate.display,
        ...evaluateConditional(branchIntake, ruleset, { ...context, intake: branchIntake }),
      };
    });

    missingFacts.push({
      field,
      thresholds: null,
      branches: branches.map((branch) => ({
        value: branch.display,
        verdict: branch.verdict,
        reason: describeDifference(resolved.findings, branch.findings),
      })),
    });

    const signatures = branches.map((branch) => branchSignature(branch.verdict, branch.findings));
    if (new Set(signatures).size > 1) diverges = true;
    pathVerdicts.push(...branches.map((branch) => branch.verdict));
    branchBlockers.push(
      ...branches
        .map((branch) => branch.blockingFinding)
        .filter((finding): finding is Finding => finding !== null),
    );
  }

  const verdict = resolveVerdict({
    window,
    pathVerdicts,
    diverges,
    hasNonEnumerableUnknown,
    hasUnresolvedTimeline: unresolvedTimelines.length > 0,
  });

  return {
    findings: resolved.findings,
    window,
    verdict,
    blockingFinding:
      verdict === "INFEASIBLE"
        ? (window.blockingFinding ?? longestLeadBlocker(branchBlockers))
        : null,
    missingFacts,
    unresolvedTimelines,
  };
}

/**
 * Of the blockers the branches produced, the one with the longest published lead — the same
 * "earliest latest-apply date" rule the window check uses, so the copy names the same kind of
 * finding whether the block was definite or common to every branch.
 */
function longestLeadBlocker(blockers: readonly Finding[]): Finding | null {
  return (
    [...blockers].sort((left, right) =>
      (left.latestApplyDate ?? "").localeCompare(right.latestApplyDate ?? ""),
    )[0] ?? null
  );
}

function resolveVerdict({
  window,
  pathVerdicts,
  diverges,
  hasNonEnumerableUnknown,
  hasUnresolvedTimeline,
}: {
  window: WindowVerdict;
  pathVerdicts: readonly Verdict[];
  diverges: boolean;
  hasNonEnumerableUnknown: boolean;
  hasUnresolvedTimeline: boolean;
}): Verdict {
  // A closed published window is not softened by an unknown that cannot reopen it: when every
  // path misses, the plan misses. This only ever makes a verdict worse, so it cannot overclaim.
  if (pathVerdicts.length > 0 && pathVerdicts.every((verdict) => verdict === "INFEASIBLE")) {
    return "INFEASIBLE";
  }
  if (window.verdict === "INFEASIBLE" && pathVerdicts.length === 0) return "INFEASIBLE";
  // An unknown that moves the finding set or the timeline, one the registry cannot enumerate, or a
  // published window we cannot date, all leave the outcome genuinely undetermined.
  if (diverges || hasNonEnumerableUnknown || hasUnresolvedTimeline) return "CONDITIONAL";
  return pathVerdicts.length > 0 ? (pathVerdicts[0] as Verdict) : window.verdict;
}

/** Fields whose `asked_when` chain the blocking rule ultimately hangs off (proposals §6, R1). */
function rootGatingFields(fields: readonly string[], ruleset: EngineRuleset): string[] {
  const declared = new Map(
    ruleset.intakeFields.map((definition) => [definition.field, definition]),
  );
  const roots = new Set<string>();
  const seen = new Set<string>();

  const walk = (field: string): void => {
    if (seen.has(field)) return;
    seen.add(field);
    const askedWhen = declared.get(field)?.askedWhen ?? null;
    if (askedWhen === null) {
      roots.add(field);
      return;
    }
    for (const token of askedWhen.split(/[^a-z_]+/)) if (declared.has(token)) walk(token);
  };

  for (const field of fields) walk(field);
  return [...roots];
}

function buildRescopeSuggestions(
  blocking: Finding,
  intake: EventIntake,
  ruleset: EngineRuleset,
  context: PlanContext,
  base: { readonly findings: readonly Finding[]; readonly verdict: Verdict },
): RescopeSuggestion[] {
  const blockingRules = ruleset.rules.filter((rule) => blocking.ruleIds.includes(rule.id));
  const triggerFieldNames = blockingRules.flatMap((rule) => triggerFields(rule.trigger));
  const candidateFields = new Set([
    ...triggerFieldNames,
    ...rootGatingFields(triggerFieldNames, ruleset),
  ]);
  const baseRuleIds = new Set(ruleIdsOf(base.findings));
  const baseAgencies = new Set(base.findings.map((finding) => finding.agency));
  const suggestions: RescopeSuggestion[] = [];

  for (const definition of ruleset.intakeFields) {
    if (!candidateFields.has(definition.field)) continue;
    for (const candidateValue of alternativeValues(definition.field, intake, ruleset)) {
      const candidateIntake = { ...intake, [definition.field]: candidateValue.value };
      const candidate = evaluateConditional(candidateIntake, ruleset, {
        ...context,
        intake: candidateIntake,
      });
      if (VERDICT_RANK[candidate.verdict] <= VERDICT_RANK[base.verdict]) continue;

      const introduced = candidate.findings.filter((finding) =>
        finding.ruleIds.every((ruleId) => !baseRuleIds.has(ruleId)),
      );
      // R3 (proposals §6): a coverage gap asserts nothing, another agency's permit is not
      // relief, and a scope whose timeline is unresolved is not a scope it can recommend —
      // except when the only block is an unpublished holiday calendar (SPEC-CONFLICT #130),
      // which must not erase F-102 AC 7's private-venue ladder step.
      if (introduced.some((finding) => finding.verificationStatus === "COVERAGE_GAP")) continue;
      if (
        introduced.some(
          (finding) => finding.disposition === "required" && !baseAgencies.has(finding.agency),
        )
      ) {
        continue;
      }
      if (
        introduced.some(
          (finding) =>
            finding.deadlineStatus === "not_calculable" &&
            !isUnpublishedCalendarUnresolved(finding.timelineUnresolvedReason),
        )
      ) {
        continue;
      }

      const candidateIds = new Set(ruleIdsOf(candidate.findings));
      const suggestion: RescopeSuggestion = {
        change: { field: definition.field, value: candidateValue.display },
        reevaluatedVerdict: candidate.verdict,
        droppedRuleIds: [...baseRuleIds].filter((ruleId) => !candidateIds.has(ruleId)),
      };
      // Superseded eras keep the historical three-field shape. Current-line enrichment carries
      // introduced rule ids on every suggestion, plus at-risk slack/name only when at risk.
      if (!emitsF102DetailEnrichment(ruleset.rulesetVersion)) {
        suggestions.push(suggestion);
        continue;
      }
      const introducedRuleIds = [...candidateIds]
        .filter((ruleId) => !baseRuleIds.has(ruleId))
        .sort();
      const introducedFindings =
        introduced.length > 0 && introduced.every((finding) => finding.userSummary != null)
          ? introduced.map((finding) => ({
              ruleIds: finding.ruleIds,
              label: finding.userSummary?.heading ?? null,
              source: finding.userSummary?.points.flatMap((point) => point.sources)[0] ?? null,
              portalName: finding.portalName,
              portalUrl: finding.portalUrl,
            }))
          : null;
      const remainingMissingFields = candidate.missingFacts.map((fact) => fact.field);
      const remainingTimelineReasons = candidate.unresolvedTimelines.map(
        (timeline) => timeline.reason,
      );
      if (candidate.verdict === "FEASIBLE_AT_RISK") {
        const minSlackDays = candidate.window.minSlackDays;
        const atRiskFinding =
          minSlackDays !== null
            ? (candidate.findings.find((finding) => finding.slackDays === minSlackDays) ?? null)
            : null;
        suggestions.push({
          ...suggestion,
          introducedRuleIds,
          ...(introducedFindings === null ? {} : { introducedFindings }),
          remainingMissingFields,
          remainingTimelineReasons,
          minSlackDays,
          atRiskFindingName: atRiskFinding?.name ?? null,
        });
      } else {
        suggestions.push({
          ...suggestion,
          introducedRuleIds,
          ...(introducedFindings === null ? {} : { introducedFindings }),
          remainingMissingFields,
          remainingTimelineReasons,
        });
      }
    }
  }
  // F-102 AC 7 demonstration ladder on the current ruleset line only. Historical eras keep
  // discovery order so AD-7 replay stays byte-stable with their original suggestion sequence.
  if (!emitsF102DetailEnrichment(ruleset.rulesetVersion)) {
    return suggestions;
  }
  return [...suggestions].sort((left, right) => rescopeLadderRank(left) - rescopeLadderRank(right));
}

/**
 * Preferred display order for Scenario A's approved ladder. Unknown suggestions keep engine
 * discovery order after the named steps.
 */
function rescopeLadderRank(suggestion: RescopeSuggestion): number {
  const key = `${suggestion.change.field}:${suggestion.change.value}`;
  if (key === "street_event_size:medium") return 0;
  if (key === "street_event_size:small") return 1;
  if (key === "location_type:private_venue") return 2;
  return 100;
}

export function computeVerdict(
  intake: EventIntake,
  ruleset: EngineRuleset,
  context: PlanContext,
): {
  readonly findings: readonly Finding[];
  readonly verdict: Verdict;
  readonly verdictDetail: VerdictDetail;
} {
  const resolved = resolveFindings(intake, ruleset, context);
  const evaluated = evaluateConditional(intake, ruleset, context);
  const { window, verdict, blockingFinding } = evaluated;

  const rescopeSuggestions =
    blockingFinding !== null
      ? buildRescopeSuggestions(blockingFinding, intake, ruleset, context, {
          findings: evaluated.findings,
          verdict,
        })
      : [];

  return {
    findings: evaluated.findings,
    verdict,
    verdictDetail: {
      blockingFinding:
        blockingFinding === null
          ? null
          : { ruleIds: blockingFinding.ruleIds, name: blockingFinding.name },
      // A blocker promoted out of the branches misses in every branch but not in the unresolved
      // base, so it belongs in the missed list the copy reads from.
      missedRuleIds: [
        ...new Set([
          ...window.missedRuleIds,
          ...(blockingFinding === null ? [] : blockingFinding.ruleIds),
        ]),
      ],
      minSlackDays: window.minSlackDays,
      missingFacts: evaluated.missingFacts,
      unresolvedTimelines: evaluated.unresolvedTimelines,
      rescopeSuggestions,
      trace: resolved.trace,
    },
  };
}
