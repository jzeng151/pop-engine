import type { Verdict } from "@pop-engine/engine";
import type { ConsumedFinding, ConsumedVerdictDetail } from "./plan-api";
import { AT_RISK_BUFFER_NOTE, verdictCopy } from "./verdict-copy";

// F-102's branch table (CONDITIONAL) and rescope ladder (INFEASIBLE). The approved verdict line
// above this panel stays in `verdictCopy`; this panel is the detail the copy rule points at —
// every missing fact's branches, or the blocking finding plus each re-evaluated rescope.

const humanize = (token: string): string => token.replace(/_/g, " ");

export type FindingReference = {
  readonly ruleIds: readonly string[];
  readonly label: string;
  readonly source: { readonly label: string; readonly url: string } | null;
  readonly portalName: string | null;
  readonly portalUrl: string | null;
};

const referenceFromFinding = (finding: ConsumedFinding): FindingReference => {
  const summarySource = finding.userSummary?.points.flatMap((point) => point.sources)[0];
  const fallbackSource = finding.sources.find((source) => source.urls.length > 0);
  return {
    ruleIds: finding.ruleIds,
    label: finding.userSummary?.heading ?? finding.name ?? finding.ruleIds.join(", "),
    source:
      summarySource ??
      (fallbackSource === undefined
        ? null
        : { label: fallbackSource.citation, url: fallbackSource.urls[0] as string }),
    portalName: finding.portalName,
    portalUrl: finding.portalUrl,
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
            {reference.portalUrl !== null && (
              <a href={reference.portalUrl} target="_blank" rel="noreferrer">
                Apply{reference.portalName === null ? "" : ` through ${reference.portalName}`}
              </a>
            )}
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
  return verdictCopy(suggestion.reevaluatedVerdict);
}

function RescopeLadder({
  suggestions,
  findings,
  rulesetReferences,
}: {
  suggestions: ConsumedVerdictDetail["rescopeSuggestions"];
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
              Re-evaluated verdict: {rescopeVerdictLine(suggestion)}
            </p>
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

function MissedMayBeRequiredSection({
  missedRuleIds,
  findings,
  rulesetReferences,
}: {
  missedRuleIds: readonly string[];
  findings: readonly ConsumedFinding[];
  rulesetReferences: readonly FindingReference[];
}) {
  // One finding can carry multiple contributing rule ids; list each finding once.
  const missed: {
    readonly reference: FindingReference;
    readonly disposition: ConsumedFinding["disposition"] | null;
  }[] = [];
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

  return (
    <section className="verdict-detail__missed-conditional" data-testid="missed-may-be-required">
      <h2 className="verdict-detail__section-title">
        Published windows that are past only if the requirement applies
      </h2>
      <p className="verdict-detail__lede">
        These findings carry a may-be-required disposition, so a passed published date keeps the
        verdict conditional rather than treating the window as a definitive miss. Each finding below
        states its own published date and qualification on the plan line.
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
            <h3 className="verdict-detail__section-title">Published windows that could not be dated</h3>
            <ul>
              {detail.unresolvedTimelines.map((entry) => (
                <li key={entry.ruleIds.join("+")}>
                  <FindingReferences
                    references={referencesForRuleIds(entry.ruleIds, findings, rulesetReferences)}
                  />
                  {": "}
                  {humanizeRuleCodes(entry.reason, rulesetReferences)}
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
            rulesetReferences={rulesetReferences}
          />
        ))}
        {detail.missedRuleIds.length > 0 && (
          <MissedMayBeRequiredSection
            missedRuleIds={detail.missedRuleIds}
            findings={findings}
            rulesetReferences={rulesetReferences}
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
                  references={referencesForRuleIds(entry.ruleIds, findings, rulesetReferences)}
                />
                {": "}
                {humanizeRuleCodes(entry.reason, rulesetReferences)}
              </li>
            ))}
          </ul>
        </section>
        {detail.missedRuleIds.length > 0 && (
          <MissedMayBeRequiredSection
            missedRuleIds={detail.missedRuleIds}
            findings={findings}
            rulesetReferences={rulesetReferences}
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
          rulesetReferences={rulesetReferences}
        />
      </div>
    );
  }

  if (verdict === "INFEASIBLE") {
    const blocker = detail.blockingFinding;
    const blockerFinding =
      blocker === null
        ? undefined
        : findings.find((finding) =>
            finding.ruleIds.some((ruleId) => blocker.ruleIds.includes(ruleId)),
          );
    const rulesetBlockerReference =
      blocker === null
        ? undefined
        : rulesetReferences.find((reference) =>
            reference.ruleIds.some((ruleId) => blocker.ruleIds.includes(ruleId)),
          );
    const blockerReference =
      blocker === null
        ? null
        : blockerFinding === undefined
          ? (rulesetBlockerReference ?? {
              ruleIds: blocker.ruleIds,
              label: blocker.name ?? blocker.ruleIds.join(", "),
              source: null,
              portalName: null,
              portalUrl: null,
            })
          : referenceFromFinding(blockerFinding);
    // One finding can carry multiple rule ids; count findings, not provenance ids (F-102 edge case).
    const missedFindings = findings.filter((finding) =>
      finding.ruleIds.some((ruleId) => detail.missedRuleIds.includes(ruleId)),
    );
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
            {missedFindings.length > 1 && (
              <p className="verdict-detail__missed">
                All published deadlines missed as scoped:{" "}
                <FindingReferences
                  references={referencesForRuleIds(
                    detail.missedRuleIds,
                    findings,
                    rulesetReferences,
                  )}
                />
              </p>
            )}
          </section>
        )}
        <RescopeLadder
          suggestions={detail.rescopeSuggestions}
          findings={findings}
          rulesetReferences={rulesetReferences}
        />
      </div>
    );
  }

  return null;
}
