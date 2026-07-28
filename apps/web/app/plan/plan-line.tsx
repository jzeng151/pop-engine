import { useEffect } from "react";
import { CONFIRM_WITH_AGENCY, type FindingSource } from "@pop-engine/engine";
import { Disclosure } from "../disclosure";
import { PortalBlock } from "../portal-block";
import { includesAgencyConfirmation, NOT_COVERED_BY_RULESET } from "../verification-copy";
import type { ConsumedFinding } from "./plan-api";

// F-206 AC 2 and AC 3: every plan line carries its citation and its verification status, both
// visible. Nothing here composes regulatory prose — every string an organizer reads is either
// published in the rules artifact and carried through the plan, or one of the schema's own
// status/kind tokens.
//
// PROGRESSIVE DISCLOSURE, and nothing is removed. A line renders twenty-three distinct blocks, and
// Scenario F renders eight lines, which is a page an organizer scrolls past rather than reads. The
// split below is only between what is visible before an interaction and what is one interaction
// away; every field this file rendered before still renders.
//
// WHAT IS IN THE SUMMARY, and why each thing that is not obvious is there:
//
//   • name, agency, fee, the deadline, the verification badge and the citation — what the organizer
//     came for: what is required, what it costs, when, and on whose authority.
//   • DISPOSITION, which no brief listed and which belongs here more than most: "required" versus
//     "may be required" versus "prohibited or ineligible" is the answer to "what do I actually have
//     to do", and a summary that omits it makes eight lines look alike.
//   • deadlineDisplay and the deadline TYPE label, because they are part of the deadline rather
//     than decoration on it. A NOT_CALCULABLE line has no computed date, so the published prose is
//     the only timing it has; SAPO-INSURANCE-001 has neither prose nor date and its type label
//     ("before issuance") is its whole timing requirement. Hiding those leaves a line that states
//     no deadline at all, which is the one thing the summary exists to state.
//   • the RESEARCH_REQUIRED and COVERAGE_GAP lines, because each explains an ABSENCE the summary
//     would otherwise show as an empty cell. A citation slot with nothing in it reads as a
//     rendering fault; "confirm with the agency" reads as the finding it is.
//
// Everything else is in the panel: the sources beyond the first, the rule ids, the last-verified
// date, the notes and note text, the portal block, the conflict text, the earliest-realistic-filing
// date, and the two timeline explanations. The conflict text sits there while the badge saying
// OFFICIAL CONFLICT stays in the summary, so the caveat is signalled where it is scannable and
// stated in full one interaction away.

const humanize = (token: string): string => token.replace(/_/g, " ");

/**
 * Whether this line has anything to say about timing. `deadlineStatus` is always set, so
 * `not_applicable` with no dates, no prose and no published deadline means there is nothing to
 * render.
 */
const hasDeadlineData = (finding: ConsumedFinding): boolean =>
  finding.deadlineDisplay !== null ||
  finding.latestApplyDate !== null ||
  finding.applyAfterDate !== null ||
  finding.deadlineStatus !== "not_applicable" ||
  finding.deadline !== null;

/**
 * The published deadline's own type, for a rule that states a kind of deadline but no prose and
 * no computable date. SAPO-INSURANCE-001 publishes `{type: "before_issuance"}` and nothing else:
 * "before issuance" is the whole timing requirement, and dropping it leaves the line silent about
 * when the insurance has to exist.
 */
const deadlineTypeLabel = (finding: ConsumedFinding): string | null =>
  finding.deadlineDisplay === null &&
  finding.latestApplyDate === null &&
  finding.applyAfterDate === null &&
  finding.deadlineStatus === "not_applicable" &&
  finding.deadline !== null
    ? humanize(finding.deadline.type)
    : null;

/**
 * The status is the plan item's stored `verification_status` (canonical, NOT NULL). The nullable
 * `verified_status` column in migration 001 is a deprecated duplicate and is never read.
 */
function VerificationBadge({ status }: { status: ConsumedFinding["verificationStatus"] }) {
  return (
    <span className={`line__status line__status--${status.toLowerCase()}`}>{humanize(status)}</span>
  );
}

/**
 * Report EVERY source that has no resolved URL, whether or not its citation is currently on screen.
 *
 * F-206's Edge Cases pair the text-only fallback below with "log loudly", and loudly is the
 * operative half. The state should be unreachable — every rule in the published ruleset carries at
 * least one URL on its source — so reaching it means a stored plan has lost its click-through, and
 * a plan row is immutable with nothing re-deriving it, so no later read repairs or reports it. The
 * log is the only way an operator finds out. Not surfaced to the organizer: they can do nothing
 * with it, and the citation text they see is still correct.
 *
 * ON THE LINE RATHER THAN INSIDE `Citation`, which is where it used to be. Every source past the
 * first renders inside the disclosure, and the disclosure is UNMOUNTED while collapsed, so an
 * effect inside the citation never ran for them: a second source that had lost its URL was reported
 * only if an operator happened to expand that one line, which is not a check. The line is mounted
 * whatever the disclosure is doing, so the audit sees all of `finding.sources` and the panel can
 * stay unmounted.
 */
function useSourceUrlAudit(sources: readonly FindingSource[]): void {
  useEffect(() => {
    for (const source of sources) {
      if (source.urls.length > 0) continue;
      console.error(
        "F-206: a stored plan finding carries citation text with no source URL; rendering the citation without a link",
        { ruleId: source.ruleId, citation: source.citation },
      );
    }
  }, [sources]);
}

/**
 * A citation with click-through to each official page it rests on. A source with no resolved URL
 * renders its citation text and nothing clickable, so a line never offers a dead link. The reporting
 * of that state is `useSourceUrlAudit` above, deliberately not here.
 */
function Citation({ source }: { source: FindingSource }) {
  const hasNoUrl = source.urls.length === 0;

  return (
    <li className="line__citation">
      <span className="line__citation-text">{source.citation}</span>
      {hasNoUrl ? null : (
        <span className="line__citation-links">
          {source.urls.map((url, index) => (
            <a key={url} href={url} target="_blank" rel="noreferrer noopener">
              source {source.urls.length > 1 ? index + 1 : ""}
            </a>
          ))}
        </span>
      )}
    </li>
  );
}

export function PlanLine({ finding }: { finding: ConsumedFinding }) {
  const ruleIds = finding.ruleIds.join(", ");
  const isResearchRequired = finding.verificationStatus === "RESEARCH_REQUIRED";
  const deadlineShowsResearchTreatment =
    isResearchRequired && includesAgencyConfirmation(finding.deadlineDisplay);
  const name = finding.name ?? ruleIds;
  const [primarySource, ...furtherSources] = finding.sources;

  useSourceUrlAudit(finding.sources);

  return (
    /* An article rather than a list item: each finding is a self-contained requirement, and its
       citations are the list inside it. */
    <article className="line" aria-labelledby={`line-${finding.ruleIds.join("-")}`}>
      <div className="line__head">
        <h3 className="line__name" id={`line-${finding.ruleIds.join("-")}`}>
          {name}
        </h3>
        <VerificationBadge status={finding.verificationStatus} />
      </div>

      <p className="line__meta">
        {/* advisory, note and classification findings legitimately publish no agency, so the
            label is omitted rather than rendered empty. */}
        {finding.agency !== null && <span className="line__agency">{finding.agency}</span>}
        <span className="line__disposition">{humanize(finding.disposition)}</span>
      </p>

      {/* The published prose is optional and ten dated rules omit it, including
          SAPO-STREET-LARGE-001 — the demo anchor's blocking finding. Gating the block on the
          prose hid the computed apply-by date and the missed status, which are the two facts
          that line exists to state. Any deadline data at all renders the block. */}
      {hasDeadlineData(finding) && (
        <p className="line__deadline">
          {finding.deadlineDisplay !== null && (
            <span className="line__deadline-display">{finding.deadlineDisplay}</span>
          )}
          {deadlineTypeLabel(finding) !== null && (
            <span className="line__deadline-type">{deadlineTypeLabel(finding)}</span>
          )}
          {finding.latestApplyDate !== null && (
            <span className="line__deadline-date">
              {finding.deadlineDisplay !== null && " · "}apply by {finding.latestApplyDate}
            </span>
          )}
          {finding.deadlineStatus !== "not_applicable" && (
            <span className="line__deadline-status">
              {" · "}
              {humanize(finding.deadlineStatus)}
            </span>
          )}
        </p>
      )}

      {/* Rendered when the ruleset publishes an amount, and NOTHING when it does not.
          No "fee not published" line: `ruleset.ts` collapses an absent `fee` and an explicit
          `fee: null` to one value, so a finding cannot distinguish "this filing has no fee" from
          "the amount was not published", and nothing downstream can recover the difference. Saying
          either would be a claim the data does not carry. A blank row is not the alternative — the
          row is absent, so nothing reads as a rendering fault. */}
      {finding.feeDisplay !== null && <p className="line__fee">{finding.feeDisplay}</p>}

      {/* A RESEARCH_REQUIRED line has no located primary source, which the organizer has to see
          on the line itself rather than discover behind an expand: the absence IS the finding. */}
      {isResearchRequired && !deadlineShowsResearchTreatment && (
        <p className="line__research" role="note">
          {CONFIRM_WITH_AGENCY}
        </p>
      )}

      {/* COVERAGE_GAP means this ruleset version does not model the combination, not that a
          source is missing (published legend, rules/nyc-rules.v2.8.json). Saying "no source" here
          would state RESEARCH_REQUIRED's meaning, which renders CONFIRM_WITH_AGENCY above. Also a
          summary field, because it too explains why no citation follows. */}
      {finding.verificationStatus === "COVERAGE_GAP" && finding.sources.length === 0 && (
        <p className="line__not-covered">{NOT_COVERED_BY_RULESET}</p>
      )}

      {primarySource !== undefined && (
        <ul className="line__citations">
          <Citation source={primarySource} />
        </ul>
      )}

      {/* UNCONDITIONAL, and that is a correctness property rather than a preference. `ruleIds` is
          always non-empty — F-201 AC 1 requires every finding to reference its rule ID — but it
          renders inside this panel, so gating the panel on the OPTIONAL fields took the rule ids off
          the page entirely for a finding that has none of them. DOHMH-EXEMPTION-001 in Scenario B is
          exactly that shape: one source, no notes, no portal, no conflict. Rendering the panel
          always means no field moved into it can disappear with it, for any finding shape, rather
          than that one hole being patched. */}
      <Disclosure label={`Details for ${name}`} className="line__detail">
        <p className="line__meta">
          <span className="line__rule-ids">{ruleIds}</span>
          {finding.lastVerifiedDate !== null && (
            <span className="line__verified-date">last verified {finding.lastVerifiedDate}</span>
          )}
        </p>

        {/* Both readings of an official conflict, verbatim. The badge in the summary already
              says OFFICIAL CONFLICT, so this states what the summary signals. */}
        {finding.conflictText !== null && <p className="line__conflict">{finding.conflictText}</p>}
        {finding.noteText !== null && finding.noteText !== finding.conflictText && (
          <p className="line__note">{finding.noteText}</p>
        )}

        {/* When pursuit can realistically begin, NOT a bar on filing earlier. The engine dates
              this from the upstream's published processing range and says in findings.ts why it
              stops short of the stronger claim: the strictness of the ordering is
              RESEARCH_REQUIRED on the dependency rule, whose own note_text — rendered just above —
              states that a strict issued-before-filed sequence is not confirmed by located primary
              text. "Not before" would assert the sequencing the verification owner declined to
              assert. It sits beside that note rather than in the summary for that reason: the
              caveat and the date are one fact. */}
        {finding.applyAfterDate !== null && (
          <p className="line__deadline-after">earliest realistic filing {finding.applyAfterDate}</p>
        )}
        {finding.timelineUnresolvedReason !== null && (
          <p className="line__timeline">{finding.timelineUnresolvedReason}</p>
        )}
        {finding.deadlineUnknownFields.length > 0 && (
          <p className="line__unknowns">
            depends on: {finding.deadlineUnknownFields.map(humanize).join(", ")}
          </p>
        )}

        {/* F-204: application path from the rules data only. AC 2 — "apply at [portal]", new tab. */}
        <PortalBlock
          portalName={finding.portalName}
          portalUrl={finding.portalUrl}
          portalInstructions={finding.portalInstructions}
          className="line__portal"
          instructionsClassName="line__portal-instructions"
        />

        {finding.notes.map((note) => (
          <p className="line__note" key={note}>
            {note}
          </p>
        ))}

        {furtherSources.length > 0 && (
          <ul className="line__citations">
            {furtherSources.map((source) => (
              <Citation key={`${source.ruleId}:${source.citation}`} source={source} />
            ))}
          </ul>
        )}
      </Disclosure>
    </article>
  );
}
