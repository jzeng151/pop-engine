import type { MovedDeadlineNotice } from "./checklist-api";
import { formatSnapshotDate } from "../plan/snapshot-banner";

// F-202 AC 9: the moved-deadline notice. Copy is deliberately narrow — it states what PopEngine
// computes and must not imply anything about a filed application (SPEC-CONFLICT #121). Previous
// values carry their full provenance floor (verification, sources, conflict text, pinned pair).

const humanize = (token: string): string => token.replace(/_/g, " ");

function dateChangeCopy(notice: MovedDeadlineNotice): string | null {
  const change = notice.dateChange;
  if (change === null) return null;
  switch (change.kind) {
    case "both":
      return (
        `The deadline PopEngine computes for this requirement has changed. ` +
        `Previous: ${change.previous}. Current: ${change.current}.`
      );
    case "became_not_calculable":
      return (
        `PopEngine previously computed a filing date of ${change.previous} for this requirement. ` +
        `A filing window still applies, but no date could be produced now` +
        (change.reason !== null ? ` (${change.reason})` : "") +
        `.`
      );
    case "became_not_applicable":
      return (
        `PopEngine previously computed a filing date of ${change.previous} for this requirement. ` +
        `The requirement no longer carries a filing date of its own.`
      );
    case "now_computed":
      return `PopEngine now computes a filing deadline of ${change.current} for this requirement.`;
  }
}

function stateChangeCopy(notice: MovedDeadlineNotice): string | null {
  const change = notice.stateChange;
  if (change === null) return null;
  const previous = humanize(change.previous.deadlineStatus);
  const current = humanize(change.current.deadlineStatus);
  const gate =
    change.previous.gated !== change.current.gated
      ? change.current.gated
        ? " It is now gated on another permit decision."
        : " It is no longer gated on another permit decision."
      : "";
  return `What applied before about this deadline: ${previous}. What applies now: ${current}.${gate}`;
}

/**
 * Per-row notice when the latest plan recomputed this requirement's deadline differently from the
 * plan item the checklist row still points at. Clears when the organizer reviews the checklist.
 */
export function MovedDeadlineNoticeBlock({ notice }: { notice: MovedDeadlineNotice }) {
  const dateCopy = dateChangeCopy(notice);
  const stateCopy = stateChangeCopy(notice);
  if (dateCopy === null && stateCopy === null) return null;

  const provenance = notice.previousProvenance;

  return (
    <aside className="check-item__deadline-notice" data-testid="moved-deadline-notice" role="note">
      {dateCopy !== null && <p>{dateCopy}</p>}
      {stateCopy !== null && <p>{stateCopy}</p>}
      <p className="check-item__deadline-notice-provenance">
        Previous value from rules snapshot {provenance.rulesetVersion}
        {provenance.snapshotDate === null
          ? ""
          : ` · published ${formatSnapshotDate(provenance.snapshotDate)}`}
        {" · "}
        <span
          className={`badge badge--${provenance.verificationStatus.toLowerCase()}`}
          data-testid="previous-verification-status"
        >
          {humanize(provenance.verificationStatus)}
        </span>
        {provenance.lastVerifiedDate !== null
          ? ` · last verified ${provenance.lastVerifiedDate}`
          : ""}
      </p>
      {provenance.conflictText !== null && (
        <p className="check-item__deadline-notice-conflict">{provenance.conflictText}</p>
      )}
      {provenance.sources.length > 0 && (
        <ul className="check-item__deadline-notice-sources" data-testid="previous-sources">
          {provenance.sources.map((source) => (
            <li key={`${source.ruleId}:${source.citation}`}>
              {source.citation}
              {source.urls.length > 0 && (
                <>
                  {" "}
                  {source.urls.map((url, index) => (
                    <a key={url} href={url} target="_blank" rel="noreferrer noopener">
                      {source.urls.length === 1 ? "source" : `source ${index + 1}`}
                    </a>
                  ))}
                </>
              )}
            </li>
          ))}
        </ul>
      )}
      {provenance.sourceUrl !== null && (
        <p className="check-item__deadline-notice-source-url">
          Primary source:{" "}
          <a href={provenance.sourceUrl} target="_blank" rel="noreferrer noopener">
            {provenance.sourceUrl}
          </a>
        </p>
      )}
      {notice.rulesetVersionsDiffer && (
        <p className="check-item__deadline-notice-rulesets">
          These plans were generated from different published rulesets (
          {notice.previousRulesetVersion} and {notice.currentRulesetVersion}). That difference is
          noted; it is not named as the cause of the change.
        </p>
      )}
      <p className="check-item__deadline-notice-limit">
        A change in the deadline PopEngine computes does not by itself establish anything about a
        filed application.
      </p>
    </aside>
  );
}
