import type { Verdict } from "@pop-engine/engine";
import type { ConsumedFinding, ConsumedVerdictDetail } from "./plan-api";
import { AT_RISK_BUFFER_NOTE, verdictCopy } from "./verdict-copy";

// F-102's branch table (CONDITIONAL) and rescope ladder (INFEASIBLE). The approved verdict line
// above this panel stays in `verdictCopy`; this panel is the detail the copy rule points at —
// every missing fact's branches, or the blocking finding plus each re-evaluated rescope.

const humanize = (token: string): string => token.replace(/_/g, " ");

function BranchTable({
  field,
  branches,
  thresholds,
}: {
  field: string;
  branches: ConsumedVerdictDetail["missingFacts"][number]["branches"];
  thresholds: string | null;
}) {
  return (
    <section className="verdict-detail__fact" data-testid="missing-fact">
      <h3 className="verdict-detail__fact-title">{humanize(field)}</h3>
      {thresholds !== null && (
        <p className="verdict-detail__thresholds">
          Published thresholds that decide this answer: {thresholds}
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
                <td>{branch.reason}</td>
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
}: {
  suggestions: ConsumedVerdictDetail["rescopeSuggestions"];
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
                Requirements that would no longer apply:{" "}
                <span className="verdict-detail__rule-ids">
                  {suggestion.droppedRuleIds.join(", ")}
                </span>
              </p>
            )}
            {suggestion.introducedRuleIds.length > 0 && (
              <p className="verdict-detail__rescope-introduced">
                Findings that would newly appear under this change:{" "}
                <span className="verdict-detail__rule-ids">
                  {suggestion.introducedRuleIds.join(", ")}
                </span>
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
}: {
  missedRuleIds: readonly string[];
  findings: readonly ConsumedFinding[];
}) {
  // One finding can carry multiple contributing rule ids; list each finding once.
  const missed: {
    readonly ruleIds: readonly string[];
    readonly name: string | null;
    readonly disposition: ConsumedFinding["disposition"] | null;
  }[] = [];
  const seenFindingKeys = new Set<string>();
  for (const ruleId of missedRuleIds) {
    const finding = findings.find((entry) => entry.ruleIds.includes(ruleId));
    if (finding === undefined) {
      missed.push({ ruleIds: [ruleId], name: null, disposition: null });
      continue;
    }
    const key = finding.ruleIds.join("|");
    if (seenFindingKeys.has(key)) continue;
    seenFindingKeys.add(key);
    missed.push({
      ruleIds: finding.ruleIds.filter((id) => missedRuleIds.includes(id)),
      name: finding.name,
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
          <li key={entry.ruleIds.join("|")}>
            <span className="verdict-detail__rule-ids">{entry.ruleIds.join(", ")}</span>
            {entry.name !== null ? ` — ${entry.name}` : ""}
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
}: {
  verdict: Verdict;
  detail: ConsumedVerdictDetail;
  /** Needed to name missed may-be-required findings on the Scenario B conditional path. */
  findings?: readonly ConsumedFinding[];
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
                  <span className="verdict-detail__rule-ids">{entry.ruleIds.join(", ")}</span>
                  {": "}
                  {entry.reason}
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
          />
        ))}
        {detail.missedRuleIds.length > 0 && (
          <MissedMayBeRequiredSection missedRuleIds={detail.missedRuleIds} findings={findings} />
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
                <span className="verdict-detail__rule-ids">{entry.ruleIds.join(", ")}</span>
                {": "}
                {entry.reason}
              </li>
            ))}
          </ul>
        </section>
        {detail.missedRuleIds.length > 0 && (
          <MissedMayBeRequiredSection missedRuleIds={detail.missedRuleIds} findings={findings} />
        )}
      </div>
    );
  }

  // Scenario B / green-gate: CONDITIONAL solely because a may-be-required published window is past.
  if (verdict === "CONDITIONAL" && detail.missedRuleIds.length > 0) {
    return (
      <div className="verdict-detail" data-testid="verdict-detail">
        <MissedMayBeRequiredSection missedRuleIds={detail.missedRuleIds} findings={findings} />
      </div>
    );
  }

  if (verdict === "INFEASIBLE") {
    const blocker = detail.blockingFinding;
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
              {blocker.name ?? blocker.ruleIds.join(", ")}
            </p>
            <p className="verdict-detail__rule-ids">{blocker.ruleIds.join(", ")}</p>
            {missedFindings.length > 1 && (
              <p className="verdict-detail__missed">
                All published deadlines missed as scoped:{" "}
                <span className="verdict-detail__rule-ids">{detail.missedRuleIds.join(", ")}</span>
              </p>
            )}
          </section>
        )}
        <RescopeLadder suggestions={detail.rescopeSuggestions} />
      </div>
    );
  }

  return null;
}
