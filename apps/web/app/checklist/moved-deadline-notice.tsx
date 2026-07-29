import type { Deadline, DeadlineStatus } from "@pop-engine/engine";
import type { DeadlineStateSide, MovedDeadlineNotice } from "./checklist-api";
import { formatSnapshotDate } from "../plan/snapshot-banner";

// F-202 AC 9: the moved-deadline notice. Copy is deliberately narrow — it states what PopEngine
// computes and must not imply anything about a filed application (SPEC-CONFLICT #121). Previous
// values carry their full provenance floor (verification, sources, conflict text, pinned pair).

const humanize = (token: string): string => token.replace(/_/g, " ");

const sameJson = (left: unknown, right: unknown): boolean =>
  JSON.stringify(left) === JSON.stringify(right);

/**
 * Countdown statuses among dated findings are not a state change here — each plan computes them
 * against its own `today`. What the notice compares and names is dated vs not_calculable vs
 * not_applicable (F-202 AC 9).
 */
const coarseStatus = (status: DeadlineStatus): "dated" | "not_calculable" | "not_applicable" =>
  status === "not_calculable" || status === "not_applicable" ? status : "dated";

/**
 * Stored deadline fields AC 9 names for comparison. Mirrors the api's snapshot so the notice
 * names the same moves the server detected.
 */
function deadlineSnapshot(deadline: Deadline | null): Record<string, unknown> | null {
  if (deadline === null) return null;
  const base: Record<string, unknown> = {
    type: deadline.type,
    qualification: "qualification" in deadline ? deadline.qualification : null,
    display: "display" in deadline ? deadline.display : null,
  };
  if ("boundary" in deadline) base.boundary = deadline.boundary;
  if ("calendarDays" in deadline) base.calendarDays = deadline.calendarDays;
  if ("businessDays" in deadline) base.businessDays = deadline.businessDays;
  if ("levels" in deadline) base.levels = deadline.levels;
  if ("unknownLevelBehavior" in deadline) {
    base.unknownLevelBehavior = deadline.unknownLevelBehavior;
  }
  if ("hardFloorDays" in deadline) base.hardFloorDays = deadline.hardFloorDays;
  if ("processingRangeDays" in deadline) {
    base.processingRangeDays = deadline.processingRangeDays;
  }
  return base;
}

const formatSnapshotValue = (value: unknown): string => {
  if (value === null || value === undefined) return "none";
  if (typeof value === "string") return value.length > 0 ? value : "none";
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
};

function deadlineFieldCopy(previous: Deadline | null, current: Deadline | null): string | null {
  const prev = deadlineSnapshot(previous);
  const curr = deadlineSnapshot(current);
  if (sameJson(prev, curr)) return null;
  if (prev === null || curr === null) {
    return `Published deadline: previous ${
      prev === null ? "none" : formatSnapshotValue(prev)
    }; current ${curr === null ? "none" : formatSnapshotValue(curr)}.`;
  }
  const keys = new Set([...Object.keys(prev), ...Object.keys(curr)]);
  const parts: string[] = [];
  for (const key of keys) {
    if (sameJson(prev[key], curr[key])) continue;
    parts.push(
      `${humanize(key)}: previous ${formatSnapshotValue(prev[key])}; current ${formatSnapshotValue(
        curr[key],
      )}`,
    );
  }
  return parts.length === 0 ? null : `Published deadline fields — ${parts.join("; ")}.`;
}

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
  const changes: string[] = [];
  const previous: DeadlineStateSide = change.previous;
  const current: DeadlineStateSide = change.current;

  const previousCoarse = coarseStatus(previous.deadlineStatus);
  const currentCoarse = coarseStatus(current.deadlineStatus);
  if (previousCoarse !== currentCoarse) {
    changes.push(
      `Deadline state: previous ${humanize(previousCoarse)}; current ${humanize(currentCoarse)}.`,
    );
  }

  const deadlineFields = deadlineFieldCopy(previous.deadline, current.deadline);
  if (deadlineFields !== null) changes.push(deadlineFields);

  if (previous.deadlineDisplay !== current.deadlineDisplay) {
    changes.push(
      `Published deadline details: previous ${previous.deadlineDisplay ?? "none"}; current ${
        current.deadlineDisplay ?? "none"
      }.`,
    );
  }
  if (previous.timelineUnresolvedReason !== current.timelineUnresolvedReason) {
    changes.push(
      `Timeline unresolved reason: previous ${previous.timelineUnresolvedReason ?? "none"}; current ${
        current.timelineUnresolvedReason ?? "none"
      }.`,
    );
  }
  if (previous.deadlineUnknownFields.join(",") !== current.deadlineUnknownFields.join(",")) {
    changes.push(
      `Unknown fields: previous ${previous.deadlineUnknownFields.join(", ") || "none"}; current ${
        current.deadlineUnknownFields.join(", ") || "none"
      }.`,
    );
  }
  if (previous.gated !== current.gated) {
    changes.push(
      current.gated
        ? "This requirement is now gated on another permit decision."
        : "This requirement is no longer gated on another permit decision.",
    );
  }

  return changes.length > 0 ? changes.join(" ") : null;
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
          ? // F-206 AC 4: pre-migration-002 plans never fall back to the live file's date.
            " · publication date not recorded for that plan"
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
