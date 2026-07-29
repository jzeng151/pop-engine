import type { Verdict } from "@pop-engine/engine";
import type { ConsumedVerdictDetail } from "./plan-api";
import { verdictCopy } from "./verdict-copy";

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

function RescopeLadder({
  suggestions,
}: {
  suggestions: ConsumedVerdictDetail["rescopeSuggestions"];
}) {
  if (suggestions.length === 0) return null;

  return (
    <section className="verdict-detail__rescopes" data-testid="rescope-ladder">
      <h3 className="verdict-detail__section-title">What you could change</h3>
      <p className="verdict-detail__lede">
        Each suggestion is a full re-evaluation of your event under that change — not a static tip.
      </p>
      <ul className="verdict-detail__rescope-list">
        {suggestions.map((suggestion) => (
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
              Re-evaluated verdict: {verdictCopy(suggestion.reevaluatedVerdict)}
              {suggestion.reevaluatedVerdict === "FEASIBLE_AT_RISK" &&
                suggestion.minSlackDays !== null &&
                ` · ${suggestion.minSlackDays} day${suggestion.minSlackDays === 1 ? "" : "s"} slack`}
              {suggestion.atRiskFindingName !== null &&
                ` · tightest: ${suggestion.atRiskFindingName}`}
            </p>
            {suggestion.droppedRuleIds.length > 0 && (
              <p className="verdict-detail__rescope-dropped">
                Requirements that would no longer apply:{" "}
                <span className="verdict-detail__rule-ids">
                  {suggestion.droppedRuleIds.join(", ")}
                </span>
              </p>
            )}
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
}: {
  verdict: Verdict;
  detail: ConsumedVerdictDetail;
}) {
  if (verdict === "CONDITIONAL" && detail.missingFacts.length > 0) {
    return (
      <div className="verdict-detail" data-testid="verdict-detail">
        <h2 className="verdict-detail__section-title">What still depends on your answers</h2>
        <p className="verdict-detail__lede">
          Each unanswered fact below was evaluated on every published answer.
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
      </div>
    );
  }

  if (verdict === "INFEASIBLE") {
    const blocker = detail.blockingFinding;
    return (
      <div className="verdict-detail" data-testid="verdict-detail">
        {blocker !== null && (
          <section className="verdict-detail__blocker" data-testid="blocking-finding">
            <h2 className="verdict-detail__section-title">What blocks this date as scoped</h2>
            <p className="verdict-detail__blocker-name">
              {blocker.name ?? blocker.ruleIds.join(", ")}
            </p>
            <p className="verdict-detail__rule-ids">{blocker.ruleIds.join(", ")}</p>
            {detail.missedRuleIds.length > 1 && (
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
