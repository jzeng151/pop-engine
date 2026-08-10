import { Fragment, useEffect, useState } from "react";
import {
  CONFIRM_WITH_AGENCY,
  type FindingSource,
  type SummarySourceLink,
} from "@pop-engine/engine";
import { Disclosure } from "../disclosure";
import { PortalBlock } from "../portal-block";
import { includesAgencyConfirmation, NOT_COVERED_BY_RULESET } from "../verification-copy";
import { businessDayNotice } from "./business-day-notice";
import type { ConsumedFinding, ConsumedRoute } from "./plan-api";
import type { HeadlineMode } from "@pop-engine/engine";
import { offersAFilingAction } from "@pop-engine/engine";

// F-206 AC 2 and AC 3: every plan line carries its citation and its verification status, both visible.

const humanize = (token: string): string => token.replace(/_/g, " ");

/** A list as a sentence reads it: "a", "a and b", "a, b and c". No serial comma, no invented words. */
const naturally = (items: readonly string[]): string =>
  items.length < 2
    ? (items[0] ?? "")
    : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;

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
 * The published timing fields, which a merged line and one of its routes both carry. Structural so
 * the rule below is written once: the shape is what decides it, not which of the two published it.
 */
type PublishedTiming = Pick<
  ConsumedFinding,
  "deadline" | "deadlineDisplay" | "latestApplyDate" | "applyAfterDate" | "deadlineStatus"
>;

/** The published deadline's own type, for a rule that states a kind of deadline but no prose and no computable date. */
const deadlineTypeLabel = (timing: PublishedTiming): string | null =>
  timing.deadlineDisplay === null &&
  timing.latestApplyDate === null &&
  timing.applyAfterDate === null &&
  timing.deadlineStatus === "not_applicable" &&
  timing.deadline !== null
    ? humanize(timing.deadline.type)
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

/** Report EVERY source that has no resolved URL, whether or not its citation is currently on screen. */
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

const SUMMARY_LABEL = {
  overview: "What this means",
  deadline: "Deadline",
  fee: "Fee",
  action: "Next step",
  warning: "Important",
} as const;

function SummarySources({ sources }: { sources: readonly SummarySourceLink[] }) {
  if (sources.length === 0) return null;
  return (
    <span className="line__point-sources">
      {" "}
      {sources.length === 1 ? "Source: " : "Sources: "}
      {sources.map((source, index) => (
        <span key={`${source.label}:${source.url}`}>
          {index > 0 && ", "}
          <a href={source.url} target="_blank" rel="noreferrer noopener">
            {source.label}
          </a>
        </span>
      ))}
    </span>
  );
}

/** The deciding question a candidate line is headed by, which is the approved route-list design §5.3: "the heading is the question, not a permit". */
export const CANDIDATE_HEADING = "The answers so far do not say which of these applies.";

/**
 * The routes of a line whose headline mode says the answers do not decide it. Two or more, which is
 * the same guard `Routes` makes: one route is not a choice between routes.
 */
const candidateRoutesOf = (finding: ConsumedFinding): readonly ConsumedRoute[] | null => {
  const routes = finding.routes ?? null;
  if (routes === null || finding.headlineMode !== "candidate" || routes.length < 2) return null;
  return routes;
};

/** EXACTLY WHAT THE ENTRY DISPLAYS, as the values it displays, so that rendering and comparing read one list instead of two. */
const entryValues = (route: ConsumedRoute, mode: HeadlineMode) => ({
  label:
    mode === "candidate" ? (route.triggerResult === "true" ? "Conditions met" : "May apply") : null,
  name: route.name ?? route.ruleId,
  disposition: humanize(route.disposition),
  agency: route.agency,
  deadlineDisplay: route.deadlineDisplay,
  deadlineType: deadlineTypeLabel(route),
  latestApplyDate: route.latestApplyDate,
  deadlineStatus: route.deadlineStatus === "not_applicable" ? null : humanize(route.deadlineStatus),
  applyAfterDate: route.applyAfterDate,
  businessDayWindow: businessDayNotice(route),
  feeDisplay: route.feeDisplay,
  conflictText: route.conflictText ?? null,
  portalName: route.portalName,
  portalUrl: route.portalUrl,
  portalInstructions: route.portalInstructions,
});

/** Two entries displaying the same values are one entry. */
const routeSignature = (route: ConsumedRoute, mode: HeadlineMode): string =>
  JSON.stringify(entryValues(route, mode));

/** One contributing route of a merged line, with its own name, window and fee. */
function Route({ route, mode }: { route: ConsumedRoute; mode: HeadlineMode }) {
  // EVERY VALUE THIS ENTRY DISPLAYS, read once. `routeSignature` stringifies the same object, so
  // the collapse test cannot compare a field this does not render or miss one it does.
  const shown = entryValues(route, mode);
  return (
    <li className="line__route">
      <p className="line__route-head">
        {shown.label !== null && <span className="line__route-label">{shown.label}</span>}
        <span className="line__route-name">{shown.name}</span>
        <span className="line__route-disposition">{shown.disposition}</span>
        {shown.agency !== null && <span className="line__route-agency">{shown.agency}</span>}
      </p>
      {(shown.deadlineDisplay !== null ||
        shown.latestApplyDate !== null ||
        shown.deadlineStatus !== null ||
        shown.deadlineType !== null) && (
        <p className="line__route-deadline">
          {shown.deadlineDisplay !== null && shown.deadlineDisplay}
          {shown.deadlineType !== null && (
            <span className="line__route-deadline-type">{shown.deadlineType}</span>
          )}
          {shown.latestApplyDate !== null && (
            <span>
              {shown.deadlineDisplay !== null && " · "}apply by {shown.latestApplyDate}
            </span>
          )}
          {shown.deadlineStatus !== null && (
            <span>
              {" · "}
              {shown.deadlineStatus}
            </span>
          )}
        </p>
      )}
      {/* THE GATE THE ROUTE CARRIES, on the surface that lists the routes. `mergeGroup` leaves the
          headline gate alone where the gated rule is a non-binding member and stores it on that
          route instead, so the entry is the only place a plan can show it — and this renderer never
          read the field, so the checklist and the reminders had the earliest realistic filing date
          and the plan did not (#252 review). Named as this route's, never attributed to the line,
          which is the same rule `gatedRoutesOf` follows on the checklist. */}
      {shown.applyAfterDate !== null && (
        <p className="line__route-deadline-notice">
          <strong>Earliest realistic filing:</strong> {shown.applyAfterDate}
        </p>
      )}
      {/* Beside the status token rather than in place of it, which is how the pre-summary line above
          renders the same pair: the entry still reports `not_calculable`, and this says what the
          date turns on. No citation follows it, for the reason `business-day-notice.ts` gives. */}
      {/* THE LABEL GOES ON A CANDIDATE ENTRY, NOT THE SENTENCE. "Apply by:" frames the note as this
          route's filing instruction, which is the claim a candidate entry may not make; the note
          itself says the exact date depends on which days the agency counts and to confirm with
          them, which is not a filing action and is approved copy that must not be dropped. So the
          frame is withheld and the sentence is not — the fourth surface the candidate-action rule
          reached, found by enumerating them rather than by a fifth review (#252 review). */}
      {shown.businessDayWindow !== null && (
        <p className="line__route-deadline-notice">
          {mode === "candidate" ? null : <strong>Apply by:</strong>} {shown.businessDayWindow}
        </p>
      )}
      {shown.feeDisplay !== null && <p className="line__route-fee">{shown.feeDisplay}</p>}
      {/* BOTH READINGS, ON THE ROUTE THAT PUBLISHES THEM. The merged line's `conflictText` is not a
          concatenation: it falls back through the routes in binding order and takes the first that
          publishes any, so the line carries one route's text and the entry beside it rendered
          nothing at all. An OFFICIAL_CONFLICT route's two readings belong on its own entry, verbatim
          and unsummarised, for the reason the line renders them (#252 review). */}
      {shown.conflictText !== null && <p className="line__route-conflict">{shown.conflictText}</p>}
      {/* NO CANDIDATE ENTRY RENDERS AS AN ACTION (design §5.3), and this is the entry's only
          action. "apply at <portal>" under an entry labelled "May apply" tells an organizer to
          file a permit the recorded answers have not decided they need, which is the one thing a
          candidate list must not do. It is suppressed for every entry while the group is in
          candidate mode, including a triggered one: what is unresolved there is which of the
          routes apply, so no entry in the group is a settled filing yet. The portal is still
          published, so it is named rather than dropped, and the rule's own instructions are
          untouched (#252 review). */}
      <PortalBlock
        portalName={shown.portalName}
        portalUrl={shown.portalUrl}
        portalInstructions={shown.portalInstructions}
        className="line__route-portal"
        instructionsClassName="line__portal-instructions"
        lead={offersAFilingAction(route, mode) ? "apply at" : "portal"}
      />
    </li>
  );
}

/** The contributing routes of a merged dedupe line, and why they arrived on one line. */
function Routes({ finding }: { finding: ConsumedFinding }) {
  const routes = finding.routes ?? null;
  const mode = finding.headlineMode ?? null;
  if (routes === null || mode === null || routes.length < 2) return null;
  if (
    mode === "applies_together" &&
    new Set(routes.map((route) => routeSignature(route, mode))).size === 1
  ) {
    return null;
  }

  // BOTH SETS OF UNKNOWNS, which is what the approved copy asks for: "the `deadlineUnknownFields` and trigger fields the unresolved routes' triggers left open" (design §5.3).
  const deciding = [
    ...new Set([
      ...routes.flatMap((route) => route.unknownFields),
      ...finding.deadlineUnknownFields,
    ]),
  ];
  const applying = routes.filter((route) => route.triggerResult === "true").length;
  // The last entry an organizer can act on, and what still hangs over it: the unsettled routes by their own published names, and the fields THEIR triggers left open, which are not the whole group's `deciding` list.
  const unsettled = routes.filter((route) => route.triggerResult === "unknown");
  const lastSettled = routes.reduce(
    (last, route, index) => (route.triggerResult === "true" ? index : last),
    -1,
  );
  const unsettledFields = [...new Set(unsettled.flatMap((route) => route.unknownFields))];
  // INTERROGATIVE, NOT PREDICTIVE, and that is the whole point of the sentence's shape.
  const unsettledSentence =
    mode !== "candidate" ||
    lastSettled === -1 ||
    unsettled.length === 0 ||
    unsettledFields.length === 0
      ? null
      : `Whether ${naturally(unsettled.map((route) => route.name ?? route.ruleId))} also ` +
        `${unsettled.length === 1 ? "applies" : "apply"} turns on ` +
        `${naturally(unsettledFields.map(humanize))}.`;

  return (
    <section className="line__routes">
      <p className="line__routes-intro">
        {mode === "applies_together" ? (
          <>
            {/* APPROVED COPY, amended into design §5.2 on 2026-08-09 by a product-owner decision
                recorded in `docs/BASELINE.md`, as an extension of the same day's §5.3 amendment.
                The section as approved read "Both of these apply ... each of them applies", which
                overstates in exactly the way §5.3's `Applies` did: both triggers resolving says the
                conditions are met, not that each route requires anything, and
                DOB-TALL-STRUCTURE-001 publishes MAY_BE_REQUIRED in an applies-together group as
                readily as in a candidate one. An earlier revision of this branch substituted
                "triggered" here with no authority to do so, which the #252 review was right to
                stop; the amendment settles the wording rather than reverting it, because two
                vocabularies for one claim on one screen is worse than either alone. */}
            <strong>
              {routes.length === 2
                ? "Both of these have their conditions met."
                : "All of these have their conditions met."}
            </strong>{" "}
            The published rules give more than one route to this requirement, and on the answers
            recorded in this plan each of their conditions is met. What each one then requires is
            beside its name.
          </>
        ) : (
          <>
            {/* NOT REPEATED HERE, because in candidate mode it is the line's HEADING: design §5.3,
                "the heading is the question, not a permit". It used to lead this paragraph while
                the heading above it named a permit, so the line presented an unresolved route as
                the requirement and only then said the routes were unsettled (#252 review). */}
            {routes.length} published routes are open on the answers recorded in this plan
            {applying > 0 &&
              `, and ${applying === 1 ? "one" : applying} of them has its conditions met on the answers so far`}
            .
            {deciding.length > 0 &&
              ` Answering ${deciding.map(humanize).join(", ")} would decide it.`}{" "}
            {applying > 0
              ? "Until then, treat the routes marked “May apply” as unsettled."
              : "Until then, treat none of the routes below as settled."}
          </>
        )}
      </p>
      <ul className="line__route-list">
        {routes.map((route, index) => (
          <Fragment key={route.ruleId}>
            <Route route={route} mode={mode} />
            {/* WHAT THE ORGANIZER STILL FACES, BENEATH THE ENTRY THEY CAN ACT ON. A candidate group
                with one settled route reads as a filing they can start, and the routes that might
                join it are further down the list under "May apply" with no statement of what they
                turn on. Approved copy, amended into design §5.3 on 2026-08-09 by a product-owner
                decision recorded in `docs/BASELINE.md`.

                THE FIELD NAMES ARE THE UNSETTLED ROUTES' OWN and nothing else. Naming the threshold
                an answer would be measured against — "over 400 square feet" — is a published fact no
                artifact carries: `unknownFields` is field names, the registry publishes no
                thresholds, and composing one would be inventing regulatory content. That is issue
                #259 and is deliberately not attempted here. */}
            {index === lastSettled && unsettledSentence !== null && (
              <li className="line__route-unsettled">{unsettledSentence}</li>
            )}
          </Fragment>
        ))}
      </ul>
    </section>
  );
}

function PublishedDeadline({ finding }: { finding: ConsumedFinding }) {
  if (!hasDeadlineData(finding)) return null;
  return (
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
  );
}

export function PlanLine({ finding }: { finding: ConsumedFinding }) {
  const ruleIds = finding.ruleIds.join(", ");
  const isResearchRequired = finding.verificationStatus === "RESEARCH_REQUIRED";
  const [detailsOpen, setDetailsOpen] = useState(false);
  const summaryShowsResearchTreatment =
    isResearchRequired && includesAgencyConfirmation([finding.deadlineDisplay, finding.feeDisplay]);
  const detailsShowResearchTreatment =
    isResearchRequired &&
    includesAgencyConfirmation([
      finding.conflictText,
      finding.noteText,
      finding.timelineUnresolvedReason,
      finding.portalInstructions,
      ...finding.notes,
    ]);
  const businessDayWindow = businessDayNotice(finding);
  const userSummary = finding.userSummary ?? null;
  const hasUserSummary = userSummary !== null;
  const name = userSummary?.heading ?? finding.name ?? ruleIds;
  // THE HEADING AND WHAT LEADS THE LINE ARE CHOSEN BY `headlineMode`, not decorated afterwards
  // (design §5.3, #252 review).
  const isCandidate = candidateRoutesOf(finding) !== null;
  const heading = isCandidate ? CANDIDATE_HEADING : name;
  // WHAT THE DISCLOSURE IS LABELLED BY, which is not `name` on a candidate line.
  const labelledBy = isCandidate ? ruleIds : name;
  const [primarySource, ...furtherSources] = finding.sources;
  const deadlineSources = [
    ...new Map(
      (userSummary?.points ?? [])
        .filter((point) => point.kind === "deadline")
        .flatMap((point) => point.sources)
        .map((source) => [source.url, source]),
    ).values(),
  ];

  useSourceUrlAudit(finding.sources);

  return (
    /* An article rather than a list item: each finding is a self-contained requirement, and its
       citations are the list inside it. */
    <article
      className={finding.disposition === "prohibited_or_ineligible" ? "line line--blocker" : "line"}
      data-testid={
        finding.disposition === "prohibited_or_ineligible" ? "prohibited-finding" : undefined
      }
      aria-labelledby={`line-${finding.ruleIds.join("-")}`}
    >
      <div className="line__head">
        <h3 className="line__name" id={`line-${finding.ruleIds.join("-")}`}>
          {heading}
        </h3>
        <VerificationBadge status={finding.verificationStatus} />
      </div>

      {/* THE UNSETTLED STATEMENT COMES BEFORE THE SCALARS IT QUALIFIES. The merged summary, the
          disposition and the apply-by date below are ONE route's — the binding route's — and on a
          candidate line no route is known to be the one. Rendered after them, the routes block
          corrected a requirement the organizer had already read. */}
      {isCandidate && <Routes finding={finding} />}

      {hasUserSummary && (
        <p className="line__meta">
          {finding.agency !== null && <span className="line__agency">{finding.agency}</span>}
          <span className="line__disposition">{humanize(finding.disposition)}</span>
        </p>
      )}

      {hasUserSummary ? (
        <ul className="line__summary">
          {userSummary?.points.map((point, index) => (
            <li className={`line__point line__point--${point.kind}`} key={`${point.kind}:${index}`}>
              <strong>{SUMMARY_LABEL[point.kind]}:</strong> {point.text}
              <SummarySources sources={point.sources} />
            </li>
          ))}
          {finding.latestApplyDate !== null && (
            <li className="line__point line__point--deadline">
              <strong>Apply by:</strong> {finding.latestApplyDate}
              {finding.deadlineStatus !== "not_applicable" &&
                ` · ${humanize(finding.deadlineStatus)}`}
              <SummarySources sources={deadlineSources} />
            </li>
          )}
          {finding.latestApplyDate === null &&
            finding.deadlineStatus === "not_calculable" &&
            (businessDayWindow === null ? (
              <li className="line__point line__point--warning">
                <strong>Exact apply-by date:</strong> not calculable — {CONFIRM_WITH_AGENCY}
                <SummarySources sources={deadlineSources} />
              </li>
            ) : (
              /* A published window with no computable date. The line says what the date turns on
                 rather than only that we could not compute it, and keeps `--warning` because the
                 state it reports is unchanged: this is still `not_calculable`.

                 NO CITATION FOLLOWS THIS SENTENCE, and the omission is the point. `deadlineSources`
                 are the deadline summary point's sources, and this sentence is about which days an
                 agency counts as business days, which `docs/VERIFICATION-SOURCES.md` records that
                 none of them answers: the TUP page is listed as not defining "business day" (:251,
                 :276), the SLA permit page the same (:283), and ":294" lists a definition of the
                 unit for any of the three examined rules under Not established. An official link
                 beside a claim its page does not make is a citation an organizer can follow and
                 find nothing. The branch above keeps the same sources because it asserts nothing
                 that a source has to carry. If a source that does address business-day counting is
                 ever located and published, it belongs here; none is. */
              <li className="line__point line__point--warning">
                <strong>Apply by:</strong> {businessDayWindow}
              </li>
            ))}
        </ul>
      ) : (
        <>
          <p className="line__meta">
            {/* advisory, note and classification findings legitimately publish no agency, so the
                label is omitted rather than rendered empty. */}
            {finding.agency !== null && <span className="line__agency">{finding.agency}</span>}
            <span className="line__disposition">{humanize(finding.disposition)}</span>
          </p>
          <PublishedDeadline finding={finding} />
          {/* The same approved sentence, on the branch a plan stored before organizer summaries
              existed renders. `loadPlan` normalizes a missing `userSummary` to null, so those plans
              take this branch for good and are immutable, while carrying the same published deadline
              and the same agency as a plan generated today. The line above them states the window
              and the status token; without this they would keep "not calculable" as their whole
              answer, which is the line the decision in `docs/BASELINE.md` replaces, for every plan
              rather than for a rendering variant. No citation here either, for the reason given on
              the summary branch. */}
          {businessDayWindow !== null && (
            <p className="line__deadline-notice">
              <strong>Apply by:</strong> {businessDayWindow}
            </p>
          )}
          {/* An absent fee and an explicit null are indistinguishable, so null renders nothing. */}
          {finding.feeDisplay !== null && <p className="line__fee">{finding.feeDisplay}</p>}
        </>
      )}

      {/* The contributing routes of a merged line, visible before any interaction. In candidate
          mode this is the whole answer to "which of these do I actually have to file", and it is
          rendered above rather than here. */}
      {!isCandidate && <Routes finding={finding} />}

      {/* A RESEARCH_REQUIRED line has no located primary source, which the organizer has to see
          on the line itself rather than discover behind an expand: the absence IS the finding. */}
      {isResearchRequired &&
        !summaryShowsResearchTreatment &&
        !(detailsOpen && detailsShowResearchTreatment) && (
          <p className="line__research" role="note">
            {CONFIRM_WITH_AGENCY}
          </p>
        )}

      {/* COVERAGE_GAP means this ruleset version does not model the combination, not that a
          source is missing (published legend, rules/nyc-rules.v2.11.json). Saying "no source" here
          would state RESEARCH_REQUIRED's meaning, which renders CONFIRM_WITH_AGENCY above. Also a
          summary field, because it too explains why no citation follows. */}
      {finding.verificationStatus === "COVERAGE_GAP" && finding.sources.length === 0 && (
        <p className="line__not-covered">{NOT_COVERED_BY_RULESET}</p>
      )}

      {!hasUserSummary && primarySource !== undefined && (
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
      <Disclosure
        label={hasUserSummary ? "Legal details and all sources" : `Details for ${labelledBy}`}
        ariaLabel={hasUserSummary ? `Legal details and all sources for ${labelledBy}` : undefined}
        className="line__detail"
        onOpenChange={setDetailsOpen}
      >
        <p className="line__meta">
          <span className="line__rule-ids">{ruleIds}</span>
          {finding.lastVerifiedDate !== null && (
            <span className="line__verified-date">last verified {finding.lastVerifiedDate}</span>
          )}
        </p>

        {hasUserSummary && <PublishedDeadline finding={finding} />}
        {hasUserSummary && finding.feeDisplay !== null && (
          <p className="line__fee">{finding.feeDisplay}</p>
        )}
        {/* NOT ON A CANDIDATE LINE, where `finding.name` is the binding route's permit name and this
            paragraph renders it alone, unattributed, as what the requirement is called. The routes
            block above already lists every contributing route's name against its own entry, so
            nothing published is lost by withholding it here and the one unattributed statement of a
            single candidate's name goes with it (#252 review). */}
        {hasUserSummary && !isCandidate && finding.name !== null && finding.name !== name && (
          <p className="line__note">{finding.name}</p>
        )}

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

        {/* F-204: application path from the rules data only. AC 2 — "apply at [portal]", new tab.
            THE SAME SUPPRESSION AS THE ROUTE ENTRIES, because this is the same route's action.
            `mergeGroup` builds the merged finding by spreading the binding route
            (`packages/engine/src/findings.ts:481`), so on a candidate line these scalars are one
            route's portal and no route is known to be the one. Neutralizing the entries alone left
            the binding route's duplicate action here, still saying "apply at" for the entry that
            had just stopped saying it (#252 review). */}
        <PortalBlock
          portalName={finding.portalName}
          portalUrl={finding.portalUrl}
          portalInstructions={finding.portalInstructions}
          className="line__portal"
          instructionsClassName="line__portal-instructions"
          lead={
            offersAFilingAction(finding, isCandidate ? "candidate" : null) ? "apply at" : "portal"
          }
        />

        {finding.notes.map((note) => (
          <p className="line__note" key={note}>
            {note}
          </p>
        ))}

        {(hasUserSummary ? finding.sources : furtherSources).length > 0 && (
          <ul className="line__citations">
            {(hasUserSummary ? finding.sources : furtherSources).map((source) => (
              <Citation key={`${source.ruleId}:${source.citation}`} source={source} />
            ))}
          </ul>
        )}
      </Disclosure>
    </article>
  );
}
