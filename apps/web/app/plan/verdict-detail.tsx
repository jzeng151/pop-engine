import type { Verdict } from "@pop-engine/engine";
import { offersAFilingAction } from "@pop-engine/engine";
import { PortalBlock, type PortalFields } from "../_components/portal-block";
import { WIDENED_BLOCKER_KEYS } from "./plan-api";
import type { ConsumedFinding, ConsumedVerdictDetail } from "./plan-api";
import { AT_RISK_BUFFER_NOTE, verdictCopy } from "./verdict-copy";

// F-102's branch table (CONDITIONAL) and rescope ladder (INFEASIBLE).

const humanize = (token: string): string => token.replace(/_/g, " ");

export type FindingReference = {
  readonly ruleIds: readonly string[];
  readonly label: string;
  readonly source: { readonly label: string; readonly url: string } | null;
  readonly portalName: string | null;
  readonly portalUrl: string | null;
  /** Whether the answers have decided that this route applies. */
  readonly settled?: boolean;
};

/**
 * Structurally what a reference is built from, so a blocking finding — which carries the blocking
 * ROUTE's published values rather than the merged line's, and is absent those fields entirely on a
 * plan stored before it carried them — is rendered by the same function as a plan line.
 */
type ReferenceSource = Pick<ConsumedFinding, "ruleIds" | "name"> &
  Partial<
    Pick<
      ConsumedFinding,
      "userSummary" | "sources" | "portalName" | "portalUrl" | "headlineMode" | "disposition"
    >
  >;

const referenceFromFinding = (finding: ReferenceSource): FindingReference => {
  const summarySource = finding.userSummary?.points.flatMap((point) => point.sources)[0];
  const fallbackSource = (finding.sources ?? []).find((source) => source.urls.length > 0);
  return {
    ruleIds: finding.ruleIds,
    label: finding.userSummary?.heading ?? finding.name ?? finding.ruleIds.join(", "),
    source:
      summarySource ??
      (fallbackSource === undefined
        ? null
        : { label: fallbackSource.citation, url: fallbackSource.urls[0] as string }),
    portalName: finding.portalName ?? null,
    portalUrl: finding.portalUrl ?? null,
    // ONE PREDICATE FOR EVERY SURFACE THAT OFFERS A FILING ACTION.
    settled:
      finding.disposition === undefined ||
      offersAFilingAction({ disposition: finding.disposition }, finding.headlineMode),
  };
};

function referencesForRuleIds(
  ruleIds: readonly string[],
  findings: readonly ConsumedFinding[],
  rulesetReferences: readonly FindingReference[] = [],
): FindingReference[] {
  const references: FindingReference[] = [];
  const seen = new Set<string>();
  for (const ruleId of ruleIds) {
    const finding = findings.find((candidate) => candidate.ruleIds.includes(ruleId));
    const key = finding?.ruleIds.join("|") ?? ruleId;
    if (seen.has(key)) continue;
    seen.add(key);
    references.push(
      finding === undefined
        ? (rulesetReferences.find((reference) => reference.ruleIds.includes(ruleId)) ?? {
            ruleIds: [ruleId],
            label: ruleId,
            source: null,
            portalName: null,
            portalUrl: null,
          })
        : referenceFromFinding(finding),
    );
  }
  return references;
}

const humanizeRuleCodes = (text: string, rulesetReferences: readonly FindingReference[]): string =>
  rulesetReferences.reduce(
    (humanized, reference) =>
      reference.ruleIds.reduce(
        (result, ruleId) => result.split(ruleId).join(reference.label),
        humanized,
      ),
    text,
  );

function FindingReferences({ references }: { references: readonly FindingReference[] }) {
  return references.map((reference, index) => {
    const showSource = reference.source !== null && reference.source.url !== reference.portalUrl;
    return (
      <span key={reference.ruleIds.join("|")}>
        {index > 0 ? ", " : ""}
        {reference.label}
        {(showSource || reference.portalUrl !== null) && (
          <>
            {" ("}
            {showSource && (
              <a href={reference.source?.url} target="_blank" rel="noreferrer">
                More information
              </a>
            )}
            {showSource && reference.portalUrl !== null ? " · " : ""}
            {reference.portalUrl !== null &&
              (reference.settled === false ? (
                // Named and still linked, never an instruction: the same treatment `PortalBlock` gives a candidate route's portal on the plan line and the checklist row.
                <>
                  {"portal: "}
                  <a href={reference.portalUrl} target="_blank" rel="noreferrer">
                    {reference.portalName ?? reference.portalUrl}
                  </a>
                </>
              ) : (
                <a href={reference.portalUrl} target="_blank" rel="noreferrer">
                  Apply{reference.portalName === null ? "" : ` through ${reference.portalName}`}
                </a>
              ))}
            {")"}
          </>
        )}
      </span>
    );
  });
}

function BranchTable({
  field,
  branches,
  thresholds,
  rulesetReferences,
}: {
  field: string;
  branches: ConsumedVerdictDetail["missingFacts"][number]["branches"];
  thresholds: string | null;
  rulesetReferences: readonly FindingReference[];
}) {
  return (
    <section className="verdict-detail__fact" data-testid="missing-fact">
      <h3 className="verdict-detail__fact-title">{humanize(field)}</h3>
      {thresholds !== null && (
        <p className="verdict-detail__thresholds">
          Published thresholds that decide this answer:{" "}
          {humanizeRuleCodes(thresholds, rulesetReferences)}
        </p>
      )}
      {branches.length > 0 ? (
        <table className="verdict-detail__branches">
          <thead>
            <tr>
              <th scope="col">If answered</th>
              <th scope="col">Verdict</th>
              <th scope="col">Reason</th>
            </tr>
          </thead>
          <tbody>
            {branches.map((branch) => (
              <tr key={`${branch.value}:${branch.verdict}:${branch.reason}`}>
                <td>{humanize(branch.value)}</td>
                <td>{verdictCopy(branch.verdict)}</td>
                <td>{humanizeRuleCodes(branch.reason, rulesetReferences)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : thresholds !== null ? (
        <p className="verdict-detail__empty-branches">
          No enumerated answers for this field; the thresholds above decide it.
        </p>
      ) : (
        <p className="verdict-detail__empty-branches">
          This unanswered fact has no enumerated branches and no published thresholds on this plan.
        </p>
      )}
    </section>
  );
}

function rescopeVerdictLine(
  suggestion: ConsumedVerdictDetail["rescopeSuggestions"][number],
  rulesetReferences: readonly FindingReference[],
): string {
  if (suggestion.reevaluatedVerdict === "FEASIBLE_AT_RISK") {
    const base = verdictCopy("FEASIBLE_AT_RISK", {
      minSlackDays: suggestion.minSlackDays,
      missingFacts: [],
      blockingFinding: null,
      missedRuleIds: [],
      unresolvedTimelines: [],
      rescopeSuggestions: [],
    });
    return suggestion.atRiskFindingName !== null
      ? `${base} · on ${suggestion.atRiskFindingName}`
      : base;
  }
  if (suggestion.reevaluatedVerdict === "CONDITIONAL") {
    const remaining = [
      suggestion.remainingMissingFields.length > 0
        ? `needs answers about ${suggestion.remainingMissingFields.map(humanize).join(", ")}`
        : null,
      suggestion.remainingTimelineReasons.length > 0
        ? `timeline still unresolved: ${suggestion.remainingTimelineReasons
            .map((reason) => humanizeRuleCodes(reason, rulesetReferences))
            .join("; ")}`
        : null,
    ].filter((reason): reason is string => reason !== null);
    if (remaining.length > 0) return `Still conditional — ${remaining.join("; ")}`;
    return suggestion.introducedRuleIds.length > 0
      ? "Still conditional — review the newly introduced findings below"
      : "Still conditional — more event details are needed";
  }
  return verdictCopy(suggestion.reevaluatedVerdict);
}

/** THE SAME REFERENCE THE BLOCKER SECTION SHOWS, NOT ONE RE-FOUND BY RULE ID. */
function RescopeReason({
  suggestion,
  blockingFinding,
  blockerReference,
}: {
  suggestion: ConsumedVerdictDetail["rescopeSuggestions"][number];
  blockingFinding: ConsumedVerdictDetail["blockingFinding"];
  blockerReference: FindingReference | null;
}) {
  if (blockingFinding === null) return null;
  const removesBlocker = suggestion.droppedRuleIds.some((ruleId) =>
    blockingFinding.ruleIds.includes(ruleId),
  );
  return (
    <p className="verdict-detail__rescope-reason">
      Why this helps:{" "}
      {removesBlocker ? (
        <>
          This removes{" "}
          {blockerReference === null ? null : <FindingReferences references={[blockerReference]} />}{" "}
          — the missed-deadline finding that blocks the current event date.
        </>
      ) : (
        "A full re-evaluation under this change no longer returns the current missed-deadline result."
      )}
    </p>
  );
}

function RescopeLadder({
  suggestions,
  blockingFinding,
  blockerReference,
  findings,
  rulesetReferences,
}: {
  suggestions: ConsumedVerdictDetail["rescopeSuggestions"];
  blockingFinding: ConsumedVerdictDetail["blockingFinding"];
  blockerReference: FindingReference | null;
  findings: readonly ConsumedFinding[];
  rulesetReferences: readonly FindingReference[];
}) {
  if (suggestions.length === 0) return null;
  // F-102 AC 7: Medium → Small → private venue, even when a stored plan serialized field order.
  const ordered = [...suggestions].sort((left, right) => {
    const rank = (suggestion: (typeof suggestions)[number]): number => {
      const key = `${suggestion.change.field}:${suggestion.change.value}`;
      if (key === "street_event_size:medium") return 0;
      if (key === "street_event_size:small") return 1;
      if (key === "location_type:private_venue") return 2;
      return 100;
    };
    return rank(left) - rank(right);
  });
  const hasAtRisk = ordered.some(
    (suggestion) => suggestion.reevaluatedVerdict === "FEASIBLE_AT_RISK",
  );

  return (
    <section className="verdict-detail__rescopes" data-testid="rescope-ladder">
      <h3 className="verdict-detail__section-title">What you could change</h3>
      <p className="verdict-detail__lede">
        Each suggestion is a full re-evaluation of your event under that change — not a static tip.
      </p>
      {hasAtRisk && (
        <p className="verdict-detail__buffer" role="note" data-testid="rescope-at-risk-buffer">
          {AT_RISK_BUFFER_NOTE}
        </p>
      )}
      <ul className="verdict-detail__rescope-list">
        {ordered.map((suggestion) => (
          <li
            key={`${suggestion.change.field}:${suggestion.change.value}`}
            className="verdict-detail__rescope"
            data-testid="rescope-suggestion"
          >
            <p className="verdict-detail__rescope-change">
              Set <strong>{humanize(suggestion.change.field)}</strong> to{" "}
              <strong>{humanize(suggestion.change.value)}</strong>
            </p>
            <p className="verdict-detail__rescope-verdict">
              Re-evaluated result: {rescopeVerdictLine(suggestion, rulesetReferences)}
            </p>
            <RescopeReason
              suggestion={suggestion}
              blockingFinding={blockingFinding}
              blockerReference={blockerReference}
            />
            {suggestion.droppedRuleIds.length > 0 && (
              <p className="verdict-detail__rescope-dropped">
                Findings that would no longer appear:{" "}
                <FindingReferences
                  references={referencesForRuleIds(
                    suggestion.droppedRuleIds,
                    findings,
                    rulesetReferences,
                  )}
                />
              </p>
            )}
            {suggestion.introducedRuleIds.length > 0 && (
              <p className="verdict-detail__rescope-introduced">
                Findings that would newly appear under this change:{" "}
                {suggestion.introducedFindings.length > 0 ? (
                  <FindingReferences
                    references={suggestion.introducedFindings.map((finding) => ({
                      ...finding,
                      label: finding.label ?? finding.ruleIds.join(", "),
                    }))}
                  />
                ) : (
                  <FindingReferences
                    references={referencesForRuleIds(
                      suggestion.introducedRuleIds,
                      findings,
                      rulesetReferences,
                    )}
                  />
                )}
              </p>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

type MissedRoute = {
  readonly reference: FindingReference;
  readonly disposition: ConsumedFinding["disposition"] | null;
};

/** One entry per MISSED ROUTE, narrowed to that route's own published values. */
function missedRouteEntries(
  missedRuleIds: readonly string[],
  findings: readonly ConsumedFinding[],
  rulesetReferences: readonly FindingReference[],
): MissedRoute[] {
  const missed: MissedRoute[] = [];
  const seenFindingKeys = new Set<string>();
  for (const ruleId of missedRuleIds) {
    const finding = findings.find((entry) => entry.ruleIds.includes(ruleId));
    if (finding === undefined) {
      missed.push({
        reference: referencesForRuleIds([ruleId], findings, rulesetReferences)[0] ?? {
          ruleIds: [ruleId],
          label: ruleId,
          source: null,
          portalName: null,
          portalUrl: null,
        },
        disposition: null,
      });
      continue;
    }
    const route = finding.routes?.find((entry) => entry.ruleId === ruleId);
    if (route !== undefined) {
      if (seenFindingKeys.has(ruleId)) continue;
      seenFindingKeys.add(ruleId);
      const source = (finding.sources ?? []).find(
        (entry) => entry.ruleId === ruleId && entry.urls.length > 0,
      );
      missed.push({
        reference: {
          ruleIds: [ruleId],
          label: route.name ?? ruleId,
          source:
            source === undefined ? null : { label: source.citation, url: source.urls[0] as string },
          portalName: route.portalName,
          portalUrl: route.portalUrl,
          // The route's own trigger AND its own disposition.
          settled: offersAFilingAction(route, finding.headlineMode),
        },
        disposition: route.disposition,
      });
      continue;
    }
    // No route list: an unmerged line, or an artifact stored before the field existed. Its own
    // rule ids are its routes and the line's values are the route's, so it is listed once.
    const key = finding.ruleIds.join("|");
    if (seenFindingKeys.has(key)) continue;
    seenFindingKeys.add(key);
    missed.push({
      reference: {
        ...referenceFromFinding(finding),
        ruleIds: finding.ruleIds.filter((id) => missedRuleIds.includes(id)),
      },
      disposition: finding.disposition,
    });
  }
  return missed;
}

function MissedMayBeRequiredSection({
  missedRuleIds,
  findings,
  rulesetReferences,
}: {
  missedRuleIds: readonly string[];
  findings: readonly ConsumedFinding[];
  rulesetReferences: readonly FindingReference[];
}) {
  const missed = missedRouteEntries(missedRuleIds, findings, rulesetReferences);
  // What is actually in the list, which is what the sentence above it may claim.
  const barred = missed.filter((entry) => entry.disposition === "prohibited_or_ineligible");
  // `may_be_required` EXACTLY, not "everything that is not barred".
  const hedged = missed.filter((entry) => entry.disposition === "may_be_required");
  // The two shapes the three earlier branches described as disagreement.
  const nonFiling = missed.filter(
    (entry) => entry.disposition === "advisory" || entry.disposition === "no_new_requirement",
  );
  const unrecorded = missed.filter((entry) => entry.disposition === null);
  return (
    <section className="verdict-detail__missed-conditional" data-testid="missed-may-be-required">
      {/* THE HEADING STATES THE SECTION'S SUBJECT, and the conditionality is the lede's, where it is
          already branched. "past only if the requirement applies" is false of a route whose own
          trigger resolved and whose rule publishes no requirement to apply, which is the whole of
          the fourth branch below (product owner, 2026-08-10; `specs/F-102-feasibility-verdict.md`
          Amendment section, and `docs/BASELINE.md`). */}
      <h2 className="verdict-detail__section-title">Published windows that are past</h2>
      <p className="verdict-detail__lede">
        {/* BRANCHED ON THE DISPOSITIONS ACTUALLY LISTED, not asserted over them. The sentence said
            every finding below carries a may-be-required disposition, and the list two lines down
            renders each route's own: a barred route whose own trigger is unresolved reaches this
            section — `blocksWhenMissed` requires the trigger to have RESOLVED before a bar can close
            a plan, so an unresolved one stays conditional and is listed here — and the copy then
            contradicted the "(prohibited or ineligible)" printed beside it (#252 review).

            Branched rather than neutralised. One sentence covering a bar and a may-be-required
            equally has to describe the weaker of the two, and understating a published prohibition
            is a defect this repository has shipped once already. What keeps the verdict conditional
            is different in the two cases and the copy now says which: a hedged disposition for one,
            an unanswered trigger for the other. */}
        {barred.length === 0 && hedged.length === missed.length
          ? "These findings carry a may-be-required disposition, so a passed published date keeps the verdict conditional rather than treating the window as a definitive miss."
          : hedged.length === 0 && barred.length === missed.length
            ? "The findings below publish a prohibition or an ineligibility, and their own triggers are unresolved, so a passed published date keeps the verdict conditional rather than closing the plan. The bar stands as each rule publishes it."
            : nonFiling.length === missed.length
              ? "The findings below publish no filing of their own, and their published windows are past. Each keeps the disposition its own rule publishes, printed beside it."
              : unrecorded.length === missed.length
                ? "The findings below have published windows that are past. This plan does not record what each of them publishes, so nothing here states it."
                : "The findings below differ in what they publish, and a passed published date settles none of them: it keeps the verdict conditional rather than treating the window as a definitive miss. Each keeps the disposition its own rule publishes, printed beside it."}{" "}
        {/* NOT ON THE BRANCH WHOSE FINDINGS ARE NOT ON THE PAGE. This sentence sends the organizer
            to a plan line for the published date and qualification, and the unrecorded branch is
            reached precisely because the missed rules are absent from `findings` — a replayed or
            rescoped plan. Pointing at regulatory detail the page cannot show is worse than saying
            nothing, which is what the branch above already says (#252 review). */}
        {unrecorded.length === missed.length
          ? null
          : "Each finding below states its own published date and qualification on the plan line."}
      </p>
      <ul>
        {missed.map((entry) => (
          <li key={entry.reference.ruleIds.join("|")}>
            <FindingReferences references={[entry.reference]} />
            {entry.disposition !== null ? ` (${humanize(entry.disposition)})` : ""}
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * The F-102 detail under the verdict line: CONDITIONAL → branch tables; INFEASIBLE → blocker +
 * rescope ladder. Other verdicts render nothing here — their copy (and the at-risk buffer note)
 * already lives beside the verdict line.
 */
export function VerdictDetailPanel({
  verdict,
  detail,
  findings = [],
  rulesetReferences = [],
}: {
  verdict: Verdict;
  detail: ConsumedVerdictDetail;
  /** Needed to name missed may-be-required findings on the Scenario B conditional path. */
  findings?: readonly ConsumedFinding[];
  /** Deployed ruleset references, supplied only when that version matches the plan's snapshot. */
  rulesetReferences?: readonly FindingReference[];
}) {
  // `rulesetReferences` is supplied only when the deployed ruleset is the exact version this plan pinned, so after the next publish every stored plan would render raw ids like `SLA-ONEDAY-001` in its branch prose.
  const references = [
    ...rulesetReferences,
    ...findings.filter((finding) => finding.ruleIds.length === 1).map(referenceFromFinding),
  ];

  if (verdict === "CONDITIONAL" && detail.missingFacts.length > 0) {
    const hasThresholdOnlyFact = detail.missingFacts.some((fact) => fact.branches.length === 0);
    return (
      <div className="verdict-detail" data-testid="verdict-detail">
        <h2 className="verdict-detail__section-title">What still depends on your answers</h2>
        <p className="verdict-detail__lede">
          {hasThresholdOnlyFact
            ? "Each unanswered fact below is listed with its published branches or thresholds — numeric fields cannot be exhaustively branched."
            : "Each unanswered fact below was evaluated on every published answer."}
          {detail.unresolvedTimelines.length === 0
            ? " The overall verdict stays conditional until those answers land."
            : " Answering them may still leave the verdict conditional when a published filing window cannot be dated from the inputs supplied."}
        </p>
        {detail.unresolvedTimelines.length > 0 && (
          <section className="verdict-detail__timelines" data-testid="unresolved-timelines">
            <h3 className="verdict-detail__section-title">
              Published windows that could not be dated
            </h3>
            <ul>
              {detail.unresolvedTimelines.map((entry) => (
                <li key={entry.ruleIds.join("+")}>
                  <FindingReferences
                    references={referencesForRuleIds(entry.ruleIds, findings, references)}
                  />
                  {": "}
                  {humanizeRuleCodes(entry.reason, references)}
                </li>
              ))}
            </ul>
          </section>
        )}
        {detail.missingFacts.map((fact) => (
          <BranchTable
            key={fact.field}
            field={fact.field}
            branches={fact.branches}
            thresholds={fact.thresholds}
            rulesetReferences={references}
          />
        ))}
        {detail.missedRuleIds.length > 0 && (
          <MissedMayBeRequiredSection
            missedRuleIds={detail.missedRuleIds}
            findings={findings}
            rulesetReferences={references}
          />
        )}
      </div>
    );
  }

  // CONDITIONAL with only unresolved timelines (no missing facts)
  if (verdict === "CONDITIONAL" && detail.unresolvedTimelines.length > 0) {
    return (
      <div className="verdict-detail" data-testid="verdict-detail">
        <h2 className="verdict-detail__section-title">What still depends on dating</h2>
        <p className="verdict-detail__lede">
          A published filing window could not be dated from the inputs supplied, so the verdict
          stays conditional independently of the answered questions.
        </p>
        <section className="verdict-detail__timelines" data-testid="unresolved-timelines">
          <ul>
            {detail.unresolvedTimelines.map((entry) => (
              <li key={entry.ruleIds.join("+")}>
                <FindingReferences
                  references={referencesForRuleIds(entry.ruleIds, findings, references)}
                />
                {": "}
                {humanizeRuleCodes(entry.reason, references)}
              </li>
            ))}
          </ul>
        </section>
        {detail.missedRuleIds.length > 0 && (
          <MissedMayBeRequiredSection
            missedRuleIds={detail.missedRuleIds}
            findings={findings}
            rulesetReferences={references}
          />
        )}
      </div>
    );
  }

  // Scenario B / green-gate: CONDITIONAL solely because a may-be-required published window is past.
  if (verdict === "CONDITIONAL" && detail.missedRuleIds.length > 0) {
    return (
      <div className="verdict-detail" data-testid="verdict-detail">
        <MissedMayBeRequiredSection
          missedRuleIds={detail.missedRuleIds}
          findings={findings}
          rulesetReferences={references}
        />
      </div>
    );
  }

  if (verdict === "INFEASIBLE") {
    // THE BLOCKER IS READ OFF `blockingFinding`, NOT RE-FOUND AMONG THE PLAN'S LINES.
    const blocker = detail.blockingFinding;
    // A PLAN STORED BEFORE THE BLOCKER CARRIED ITS OWN VALUES CARRIES NONE OF THEM, and reading one as though it did is how this section went blank.
    const blockerWasWidened =
      blocker !== null && WIDENED_BLOCKER_KEYS.some((key) => key in blocker);
    const storedBlockerFinding =
      blocker === null || blockerWasWidened
        ? undefined
        : findings.find((finding) =>
            finding.ruleIds.some((ruleId) => blocker.ruleIds.includes(ruleId)),
          );
    /** Where this section's published values come from: the blocking route, or the stored line. */
    const blockerFacts = storedBlockerFinding ?? blocker;
    const blockerReference =
      blocker === null
        ? null
        : blockerWasWidened || storedBlockerFinding !== undefined
          ? referenceFromFinding(storedBlockerFinding ?? blocker)
          : // Neither: the plan predates the widening AND its blocking line is no longer among the
            // findings — a rescoped or replayed plan. The deployed ruleset's own reference is the
            // last thing that can still supply a citation and a portal link for it.
            (references.find((reference) =>
              reference.ruleIds.some((ruleId) => blocker.ruleIds.includes(ruleId)),
            ) ?? referenceFromFinding(blocker));
    // ONE ENTRY PER MISSED ROUTE.
    const missedRoutes = missedRouteEntries(detail.missedRuleIds, findings, references);
    // A ROUTE CAN PUBLISH ITS FILING PATH AS INSTRUCTIONS AND NO URL, and a reference renders a url or nothing.
    const referenceShowsPortal = blockerReference?.portalUrl != null;
    const blockerPortal: PortalFields = {
      portalName: referenceShowsPortal ? null : (blockerFacts?.portalName ?? null),
      portalUrl: referenceShowsPortal ? null : (blockerFacts?.portalUrl ?? null),
      portalInstructions: blockerFacts?.portalInstructions ?? null,
    };
    // AND THE WORST INSTANCE OF THE SAME RULE.
    const blockerOffersFiling =
      blockerFacts?.disposition === undefined
        ? true
        : offersAFilingAction({ disposition: blockerFacts.disposition }, null);
    return (
      <div className="verdict-detail" data-testid="verdict-detail">
        {blocker !== null && (
          <section className="verdict-detail__blocker" data-testid="blocking-finding">
            <h2 className="verdict-detail__section-title">What blocks this date as scoped</h2>
            <p className="verdict-detail__blocker-name">
              {blockerReference === null ? null : (
                <FindingReferences references={[blockerReference]} />
              )}
            </p>
            <p className="verdict-detail__blocker-reason">
              This blocks the date because the published deadline was missed as scoped.
              {blockerFacts?.deadlineDisplay != null &&
                ` Published timing: ${blockerFacts.deadlineDisplay}.`}
              {blockerFacts?.latestApplyDate != null &&
                ` The latest published apply-by date was ${blockerFacts.latestApplyDate}.`}
            </p>
            <PortalBlock
              {...blockerPortal}
              className="verdict-detail__blocker-portal"
              instructionsClassName="verdict-detail__blocker-instructions"
              lead={blockerOffersFiling ? "apply at" : "portal"}
            />
            {missedRoutes.length > 1 && (
              <p className="verdict-detail__missed">
                All published deadlines missed as scoped:{" "}
                <FindingReferences references={missedRoutes.map((entry) => entry.reference)} />
              </p>
            )}
          </section>
        )}
        <RescopeLadder
          suggestions={detail.rescopeSuggestions}
          blockingFinding={blocker}
          blockerReference={blockerReference}
          findings={findings}
          rulesetReferences={references}
        />
      </div>
    );
  }

  return null;
}
