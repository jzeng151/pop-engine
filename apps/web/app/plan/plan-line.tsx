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

// F-206 AC 2 and AC 3: every plan line carries its citation and its verification status, both
// visible. Every string an organizer reads is either published in the rules artifact and carried
// through the plan, one of the schema's own status/kind tokens, or approved copy that adds no
// regulatory value of its own. There is one of the last: `businessDayNotice`, whose copy is approved
// as regulatory content (product owner, 2026-08-08; recorded in `docs/BASELINE.md`) and which states
// no deadline, no count and no agency practice, only the agency's published name.
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

/**
 * The published deadline's own type, for a rule that states a kind of deadline but no prose and
 * no computable date. SAPO-INSURANCE-001 publishes `{type: "before_issuance"}` and nothing else:
 * "before issuance" is the whole timing requirement, and dropping it leaves the line silent about
 * when the insurance has to exist.
 *
 * A ROUTE PUBLISHES THAT SHAPE TOO. A non-binding route in it has `deadlineStatus: "not_applicable"`
 * and no dates, so the route entry's timing block was suppressed whole and the type went with it,
 * on the one surface a merged line has for a non-binding route's window (#252 review). Same rule,
 * same copy, read off whichever of the two is asking.
 */
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

/**
 * The published values a reader compares two routes on. Two routes "publish the same thing" when
 * every one of these is equal, which is a comparison of published values rather than a judgement.
 *
 * `triggerResult` IS ONE OF THEM, and leaving it out made the whole candidate block vanish on the
 * plan a candidate block exists for. Two routes alike in name, window and fee but differing in
 * whether their trigger resolved are not two renderings of one permit: one is triggered and the
 * other is the open question, the entries below label them differently, and the introduction is
 * built out of exactly that difference. Collapsed to one signature, `Routes` returned null and the
 * plan page said nothing while `checklist-item.tsx` rendered its deciding question off the same
 * payload — two surfaces disagreeing on one plan (#252 review).
 *
 * READ ONLY IN `applies_together` MODE, which is the other half of that same defect and is enforced
 * at the call rather than by a further field here. See `Routes`.
 */
/**
 * The deciding question a candidate line is headed by, which is the approved route-list design
 * §5.3: "the heading is the question, not a permit". A candidate group has not settled which of
 * its published routes applies, so the heading a line would otherwise carry — the summary heading
 * or the binding route's permit name — states one unresolved candidate as the requirement. The
 * same sentence the routes block used to lead with, moved to where the design puts it and rendered
 * once.
 */
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

/**
 * What an entry renders, so two routes rendering the same thing are the same entry.
 *
 * THE PUBLISHED DEADLINE TYPE IS PART OF IT, because the entry renders it (`deadlineTypeLabel`).
 * Left out, two routes whose ONLY timing difference is a typed-only deadline signed identically and
 * suppressed the whole routes block as "these publish the same thing", which is the block dropping
 * published timing rather than declining to repeat it (#252 review). Design §5.1 names ten fields
 * for that comparison and this is an eleventh, for the same reason `triggerResult` is already a
 * twelfth: the rule is that identical ENTRIES are not listed twice, and a field the entry shows
 * cannot be missing from the test of whether two entries are identical.
 */
/**
 * What an entry renders, so two routes rendering the same thing are the same entry.
 *
 * DERIVED FROM THE ROUTE RATHER THAN HAND-LISTED, and that is the correction. A list of fields has
 * to be extended every time a route gains one, and it was not: the typed deadline was missed when
 * route entries started rendering it, and `conflictText` was missed the round it was added, each
 * time collapsing a group whose entries differ into one entry and dropping the sibling's published
 * value silently. Same defect class as a validator that compares the fields someone thought of
 * (#252 review).
 *
 * EVERY FIELD BY DEFAULT, so a new one is compared without anyone remembering to add it, and
 * excluding a field becomes the deliberate act rather than including one. Two are treated
 * specially and both are stated where they happen: `deadline` reduces to its published TYPE,
 * because that is the only part the entry renders; and `ruleId` is replaced by the name the entry
 * actually shows, since the id differs on every pair and comparing it would collapse nothing at
 * all. Keys are sorted so two routes built by different producers cannot differ by insertion order.
 *
 * IT FAILS IN THE SAFE DIRECTION. A field the wire carries and the entry does NOT render — today
 * `unknownFields`, which the introduction reads rather than the entry — makes two otherwise
 * identical routes sign differently, so the block renders both instead of collapsing them. Showing
 * an organizer two identical-looking entries is a rendering fault; dropping a route's published
 * conflict or window is a regulatory one, and this trades the first for the second.
 */
const routeSignature = (route: ConsumedRoute): string => {
  const { ruleId, ...rest } = route;
  const compared: Record<string, unknown> = {
    ...rest,
    // The NAME AS RENDERED, not the id. `ruleId` differs on every pair by definition, so comparing
    // it would collapse nothing and §5.1's byte-identical groups — three of the draft's nine, and
    // the ones that merge most often — would list one permit twice. But the entry falls back to the
    // id where a route publishes no name, so two unnamed routes DO render differently and this is
    // what carries that: the expression the entry renders, rather than either field alone.
    renderedName: route.name ?? ruleId,
    deadline: route.deadline?.type ?? null,
  };
  return JSON.stringify(
    Object.keys(compared)
      .sort()
      .map((key) => [key, compared[key]]),
  );
};

/**
 * One contributing route of a merged line, with its own name, window and fee.
 *
 * `Conditions met` prefixes a resolved entry rather than restating the disposition in a second
 * voice: in a candidate list an organizer has to be able to tell, per entry, which routes' own
 * conditions the recorded answers meet. It does not say "Applies", because those are different
 * claims and only the first is one this label can make: a route whose trigger resolved can still
 * publish `MAY_BE_REQUIRED`, and DOB-TALL-STRUCTURE-001 does. What the route then requires is the
 * disposition beside it, in the rule's own words. `May apply` is unchanged.
 *
 * THIS WORDING IS APPROVED COPY, amended into design §5.3 on 2026-08-09 by a product-owner decision
 * recorded in `docs/BASELINE.md`. The section as approved said `Applies`, and an earlier revision of
 * this branch substituted `Triggered` on the reasoning above, which was the right diagnosis and not
 * this lane's decision to act on (#252 review). The amendment settles it in neither word: `Applies`
 * overstates what a resolved trigger asserts, and `Triggered` is engine vocabulary in copy an
 * organizer reads.
 */
function Route({ route, mode }: { route: ConsumedRoute; mode: HeadlineMode }) {
  const label =
    mode === "candidate" ? (route.triggerResult === "true" ? "Conditions met" : "May apply") : null;
  // F-201 AC 13 on the route that actually has the undatable window. A merged line's scalars are the
  // binding route's, so where a non-binding route is the `business_days_minimum` one the criterion's
  // sentence has nowhere else to go: the finding-level call reads the binding route's fields and
  // returns null, and this entry would say "not calculable" and stop (#252 review). Same sentence,
  // same approved copy, read off this route's own agency and published deadline type.
  const businessDayWindow = businessDayNotice(route);
  return (
    <li className="line__route">
      <p className="line__route-head">
        {label !== null && <span className="line__route-label">{label}</span>}
        <span className="line__route-name">{route.name ?? route.ruleId}</span>
        <span className="line__route-disposition">{humanize(route.disposition)}</span>
        {route.agency !== null && <span className="line__route-agency">{route.agency}</span>}
      </p>
      {(route.deadlineDisplay !== null ||
        route.latestApplyDate !== null ||
        route.deadlineStatus !== "not_applicable" ||
        route.deadline !== null) && (
        <p className="line__route-deadline">
          {route.deadlineDisplay !== null && route.deadlineDisplay}
          {deadlineTypeLabel(route) !== null && (
            <span className="line__route-deadline-type">{deadlineTypeLabel(route)}</span>
          )}
          {route.latestApplyDate !== null && (
            <span>
              {route.deadlineDisplay !== null && " · "}apply by {route.latestApplyDate}
            </span>
          )}
          {route.deadlineStatus !== "not_applicable" && (
            <span>
              {" · "}
              {humanize(route.deadlineStatus)}
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
      {route.applyAfterDate !== null && (
        <p className="line__route-deadline-notice">
          <strong>Earliest realistic filing:</strong> {route.applyAfterDate}
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
      {businessDayWindow !== null && (
        <p className="line__route-deadline-notice">
          {mode === "candidate" ? null : <strong>Apply by:</strong>} {businessDayWindow}
        </p>
      )}
      {route.feeDisplay !== null && <p className="line__route-fee">{route.feeDisplay}</p>}
      {/* BOTH READINGS, ON THE ROUTE THAT PUBLISHES THEM. The merged line's `conflictText` is not a
          concatenation: it falls back through the routes in binding order and takes the first that
          publishes any, so the line carries one route's text and the entry beside it rendered
          nothing at all. An OFFICIAL_CONFLICT route's two readings belong on its own entry, verbatim
          and unsummarised, for the reason the line renders them (#252 review). */}
      {route.conflictText != null && <p className="line__route-conflict">{route.conflictText}</p>}
      {/* NO CANDIDATE ENTRY RENDERS AS AN ACTION (design §5.3), and this is the entry's only
          action. "apply at <portal>" under an entry labelled "May apply" tells an organizer to
          file a permit the recorded answers have not decided they need, which is the one thing a
          candidate list must not do. It is suppressed for every entry while the group is in
          candidate mode, including a triggered one: what is unresolved there is which of the
          routes apply, so no entry in the group is a settled filing yet. The portal is still
          published, so it is named rather than dropped, and the rule's own instructions are
          untouched (#252 review). */}
      <PortalBlock
        portalName={route.portalName}
        portalUrl={route.portalUrl}
        portalInstructions={route.portalInstructions}
        className="line__route-portal"
        instructionsClassName="line__portal-instructions"
        lead={mode === "candidate" ? "portal" : "apply at"}
      />
    </li>
  );
}

/**
 * The contributing routes of a merged dedupe line, and why they arrived on one line.
 *
 * NOTHING RENDERS WHEN THE ROUTES PUBLISH THE SAME THING, AND ONLY WHEN THEY ALSO APPLY TOGETHER.
 * Three of the nine multi-member groups in the v2 full draft publish byte-identical outputs and are
 * the ones that merge most often (`docs/research/draft-dedupe-cofiring.md` §5.2, §5.7, §5.8), and
 * listing one permit twice under a heading saying two routes were triggered would be a rendering
 * fault presented as regulatory content. That argument is entirely about the `applies_together`
 * heading, and applying it to a candidate list deleted the only surface that carries the question.
 *
 * A CANDIDATE INTRODUCTION IS NOT A SECOND COPY OF THE ENTRIES. It says how many published routes
 * are open, how many are triggered so far, and WHICH ANSWERS WOULD DECIDE IT — none of which is on
 * an entry, and the last of which is the organizer's way out of the unresolved state. Where every
 * route is unresolved and the outputs match, every signature is equal (`unknownFields` is not one of
 * them and every `triggerResult` is "unknown"), so the collapse threw all of that away and the plan
 * page said nothing while `checklist-item.tsx` rendered the deciding question off the same payload:
 * the same two-surface disagreement, one case further on (#252 review).
 *
 * NOT REPAIRED BY WIDENING THE SIGNATURE, which is the tempting version. Adding `unknownFields`
 * leaves the case reported intact whenever the routes are open on the SAME answers, which is the
 * commonest candidate group there is. The mode is what decides whether the collapse is sound at all,
 * so the mode is where the test belongs.
 *
 * A CANDIDATE LIST MUST NOT READ AS A LIST OF REQUIREMENTS. Three things keep it from doing so: the
 * introduction says the answers do not decide it, every unresolved entry is prefixed "May apply",
 * and no entry is rendered as an action. Nothing here composes a regulatory claim: every value is a
 * route's own published value, and the only sentences are the fixed ones below.
 */
function Routes({ finding }: { finding: ConsumedFinding }) {
  const routes = finding.routes ?? null;
  const mode = finding.headlineMode ?? null;
  if (routes === null || mode === null || routes.length < 2) return null;
  if (mode === "applies_together" && new Set(routes.map(routeSignature)).size === 1) return null;

  // BOTH SETS OF UNKNOWNS, which is what the approved copy asks for: "the `deadlineUnknownFields`
  // and trigger fields the unresolved routes' triggers left open" (design §5.3). A route's
  // `unknownFields` are only its trigger's. A candidate group can also have an unanswered field
  // that its filing timeline depends on, and listing only the trigger fields told the organizer
  // that answering those "would decide it" while the dates stayed unresolved on an answer the
  // sentence never named (#252 review). `deadlineUnknownFields` is the finding's, concatenated
  // over every route, because a deadline unknown is not per route on the merged line.
  const deciding = [
    ...new Set([
      ...routes.flatMap((route) => route.unknownFields),
      ...finding.deadlineUnknownFields,
    ]),
  ];
  const applying = routes.filter((route) => route.triggerResult === "true").length;
  // The last entry an organizer can act on, and what still hangs over it: the unsettled routes by
  // their own published names, and the fields THEIR triggers left open, which are not the whole
  // group's `deciding` list. Rendered only in candidate mode and only where there is a settled entry
  // to sit beneath; in candidate mode there is always at least one unsettled route.
  const unsettled = routes.filter((route) => route.triggerResult === "unknown");
  const lastSettled = routes.reduce(
    (last, route, index) => (route.triggerResult === "true" ? index : last),
    -1,
  );
  const unsettledFields = [...new Set(unsettled.flatMap((route) => route.unknownFields))];
  // INTERROGATIVE, NOT PREDICTIVE, and that is the whole point of the sentence's shape. An
  // unknown-triggered `required` rule is demoted to `may_be_required` by `resolveDisposition`, so
  // the unsettled route's own entry one line below reads "May apply" beside `may be required`.
  // "X would also be required" promoted it back to a definite requirement, contradicting its own
  // entry one line apart and reinstating exactly the claim `Applies` was amended away for
  // (product owner, 2026-08-09, correcting the same day's own amendment). "Whether X also applies"
  // asserts nothing about X: it names the open question, which is what the routes already say.
  //
  // No fields, no sentence: there would be nothing to name as the thing it turns on, and
  // `routeContractHolds` refuses an unresolved route that names no field, so in candidate mode
  // there is always at least one.
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
  // (design §5.3, #252 review). `name` is still what the disclosure labels this requirement by,
  // because a control's label has to name the thing it opens; the heading is the question.
  const isCandidate = candidateRoutesOf(finding) !== null;
  const heading = isCandidate ? CANDIDATE_HEADING : name;
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
        label={hasUserSummary ? "Legal details and all sources" : `Details for ${name}`}
        ariaLabel={hasUserSummary ? `Legal details and all sources for ${name}` : undefined}
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
        {hasUserSummary && finding.name !== null && finding.name !== name && (
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
          lead={isCandidate ? "portal" : "apply at"}
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
