"use client";

import { useRef, useState } from "react";
import { CHECKLIST_STATUSES, CONFIRM_WITH_AGENCY, type ChecklistStatus } from "@pop-engine/engine";
import { Disclosure } from "../disclosure";
import { PortalBlock } from "../portal-block";
import { formatSnapshotDate } from "../plan/snapshot-banner";
import { CANDIDATE_HEADING } from "../plan/plan-line";
import { includesAgencyConfirmation, NOT_COVERED_BY_RULESET } from "../verification-copy";
import type { ConsumedRoute } from "../plan/plan-api";
import { MovedDeadlineNoticeBlock } from "./moved-deadline-notice";
import {
  ACCEPTED_DOCUMENT_TYPES,
  documentRejection,
  type ChecklistItem,
  type PlanContext,
  type SourcePlan,
  type UploadOutcome,
} from "./checklist-api";

// One checklist row. F-202 AC 2–5 and AC 8 all land here, and the row is deliberately the whole
// unit of rendering: F-204's portal deep links, F-205's insurance card and F-206's per-row
// provenance all attach to a checklist item, so a row is one component with one set of inputs
// rather than markup spread across the view.
//
// Nothing here composes regulatory prose. Every string an organizer reads is either published in
// the rules artifact and carried through the plan, or one of the schema's own status tokens.

const humanize = (token: string): string => token.replace(/_/g, " ");

/** Two or more, the same guard both surfaces make: one route is not a choice between routes. */
const isCandidateRow = (context: PlanContext): boolean =>
  context.headlineMode === "candidate" && (context.routes?.length ?? 0) >= 2;

/**
 * THE HEADING IS THE QUESTION, NOT A PERMIT, on this surface as on the plan line.
 *
 * Design §5.3 settles it: a candidate group has not decided which of its routes applies, so a
 * heading taken from the summary or the binding route's name states one unresolved candidate as the
 * requirement. The plan line has done this since the heading moved; the checklist inherited the
 * MERGED `userSummary.heading` through this function instead, and `mergeUserSummary` takes that
 * heading from the first route in binding order that publishes one — so the row an organizer works
 * was titled with one candidate's permit name (#252 review).
 *
 * `CANDIDATE_HEADING` is imported rather than restated, so the two surfaces cannot drift into two
 * sentences for one question.
 */
const displayName = (context: PlanContext): string =>
  isCandidateRow(context)
    ? CANDIDATE_HEADING
    : (context.userSummary?.heading ?? context.permitName ?? "Additional plan context");

/**
 * What the row's CONTROLS are labelled with, which is a different question from what it is headed
 * with: a status select, a notes box and an upload need a NOUN, and the deciding question is not
 * one. "Status for The answers so far do not say which of these applies." names nothing.
 *
 * On a candidate row they may not take the merged summary heading either, for the reason above — it
 * is one contributing rule's — so they fall back the way every other surface here falls back when a
 * route publishes no name of its own: the rule ids. That composes no new copy. What it does NOT do
 * is give the row a settled name, and it cannot: the whole point is that the answers have not
 * decided which permit this task is. Naming it would be a copy decision this lane does not hold.
 *
 * `permitName` IS NOT A FALLBACK HERE, AND THE ROUND THAT USED IT AS ONE WAS WRONG. On a candidate
 * row that is not scalar-free, `permitName` is the BINDING route's name — one candidate of several
 * — so labelling the controls with it named the row after one route while the heading beside it
 * said the answers do not decide which. The previous round narrowed the heading and left the
 * ACCESSIBLE NAME saying the old thing, so a screen-reader user was given a settled attribution a
 * sighted user was not, on controls that update the COMBINED item (#252 review). The rule ids name
 * every contributing rule and prefer none, which is what the controls act on.
 */
const trackingLabel = (context: PlanContext): string =>
  isCandidateRow(context) ? context.ruleIds.join(", ") : displayName(context);

/**
 * Whether this row has anything to say about timing. `deadlineStatus` is always set, so
 * `not_applicable` with no dates, no prose and no published deadline means there is nothing to
 * render.
 */
const hasDeadlineData = (context: PlanContext): boolean =>
  context.deadlineDisplay !== null ||
  context.latestApplyDate !== null ||
  context.applyAfterDate !== null ||
  context.deadlineStatus !== "not_applicable" ||
  context.deadline !== null ||
  gatedRoutesOf(context).length > 0;

/**
 * The routes carrying a dependency gate that the row's own scalars do not.
 *
 * A merged line's scalars are the BINDING route's, entirely, so a gated rule that is a non-binding
 * member of the group sequences its OWN route and leaves the headline alone — the engine's
 * deliberate choice, so that a line can never date one route off another. The consequence here is
 * that `applyAfterDate` on the row is the binding route's, which for such a group is null, and F-202
 * AC 5 requires a gated item to show its start date. `filingRouteOf` does not reach the case either:
 * it declines the moment the row publishes its own window, which is exactly this shape (#252 review).
 *
 * So the gate is read off the route that carries it, and rendered NAMING that route. Attributing it
 * to the row would tell an organizer the binding filing cannot realistically begin until a date that
 * belongs to a different rule. The one route skipped is the one whose gate the scalar above already
 * carries, so no gate is shown twice.
 *
 * WHICH ROUTE THAT IS, is not always `routes[0]`. Where the binding route publishes no window of its
 * own the checklist response fills the whole timing block from the filing route instead, gate
 * included, and `filingRouteRuleId` names it. Skipping index 0 there dropped the case the other way
 * round: a binding route carrying a gate but no deadline, beside a sibling publishing a deadline but
 * no gate, rendered the sibling's null gate on the row and skipped the binding route here, so the
 * F-202 AC 5 start date was on neither surface (#252 review).
 */
const gatedRoutesOf = (context: PlanContext): readonly ConsumedRoute[] => {
  const routes = context.routes ?? [];
  // NOTHING IS SKIPPED WHERE THE ROW SHOWS NO GATE. The skip exists so a gate the scalar above
  // already carries is not repeated, and a row publishing no `applyAfterDate` carries none to
  // repeat. Reaching for `routes[0]` regardless treated the binding route's gate as already
  // rendered on a scalar-free row, where by construction the row publishes no scalars at all, so
  // the F-202 AC 5 start date appeared on neither surface (#252 review). This is `routes[0]`-as-
  // binding once more, in a place the #263 enumeration missed; the row is now in that table.
  const onTheRow =
    context.applyAfterDate === null
      ? null
      : (context.filingRouteRuleId ?? routes[0]?.ruleId ?? null);
  return routes.filter((route) => route.applyAfterDate !== null && route.ruleId !== onTheRow);
};

/**
 * The published deadline's own type, for a rule that states a kind of deadline but no prose and
 * no computable date. SAPO-INSURANCE-001 publishes `{type: "before_issuance"}` and nothing else,
 * and it is a trackable insurance line, so without this its checklist row would be silent about
 * when the certificate has to exist.
 */
const deadlineTypeLabel = (context: PlanContext): string | null =>
  context.deadlineDisplay === null &&
  context.latestApplyDate === null &&
  context.applyAfterDate === null &&
  context.deadlineStatus === "not_applicable" &&
  context.deadline !== null
    ? humanize(context.deadline.type)
    : null;

/**
 * Every official-conflict reading this row carries, with the rule that published each.
 *
 * An unmerged row is its own route and keeps the single unnamed paragraph it always rendered. A
 * merged row lists one per contributing route that publishes any, in the order the routes arrive,
 * which is binding order. A route with no per-route value recorded — a plan stored before
 * `FindingRoute.conflictText` — contributes nothing rather than being read as publishing none, and
 * the row falls back to the merged text so such a plan loses nothing it had.
 */
const conflictReadings = (
  context: PlanContext,
): readonly { ruleId: string; name: string | null; text: string }[] => {
  const routes = context.routes ?? [];
  const perRoute = routes.filter((route) => route.conflictText != null);
  if (perRoute.length === 0) {
    return context.conflictText === null
      ? []
      : [{ ruleId: context.ruleIds.join("+"), name: null, text: context.conflictText }];
  }
  return perRoute.map((route) => ({
    ruleId: route.ruleId,
    // The same fallback the gate beside it uses, so a route publishing no name is still named.
    name: routes.length > 1 ? (route.name ?? route.ruleId) : null,
    text: route.conflictText as string,
  }));
};

/** Two snapshot pairs are the same pair, so the row has nothing the banner has not already said. */
const samePlan = (left: SourcePlan, right: SourcePlan): boolean =>
  left.rulesetVersion === right.rulesetVersion && left.snapshotDate === right.snapshotDate;

/**
 * The regulatory content of a row, shared by trackable items and by the read-only context lines,
 * because the two say exactly the same things about a requirement and only differ in whether the
 * organizer can act on them.
 */
/** One citation with click-through to each official page it rests on. */
function ContextCitation({ source }: { source: PlanContext["sources"][number] }) {
  return (
    <li key={`${source.ruleId}:${source.citation}`}>
      <span>{source.citation}</span>
      {source.urls.map((url, index) => (
        <a key={url} href={url} target="_blank" rel="noreferrer noopener">
          source {source.urls.length > 1 ? index + 1 : ""}
        </a>
      ))}
    </li>
  );
}

/**
 * Whether this row has anything behind its expand, so an empty control is never rendered.
 *
 * Every field the panel renders is listed here, and only fields the panel renders are.
 * `lastVerifiedDate` is absent because the row states it in its summary, above.
 */
const hasContextDetail = (context: PlanContext): boolean =>
  context.sources.length > 1 ||
  conflictReadings(context).length > 0 ||
  (context.noteText !== null && context.noteText !== context.conflictText) ||
  context.publishedNotes.length > 0 ||
  context.portalName !== null ||
  context.portalUrl !== null ||
  context.portalInstructions !== null ||
  context.timelineUnresolvedReason !== null ||
  context.deadlineUnknownFields.length > 0;

export function PlanContextBody({
  context,
  currentPlan,
}: {
  context: PlanContext;
  /**
   * The snapshot the checklist's banner states. A row whose values came from that same snapshot
   * does not repeat it; a row from a different one states its own (F-206 AC 4, F-202 AC 8).
   */
  currentPlan: SourcePlan;
}) {
  const [primarySource, ...furtherSources] = context.sources;
  const [detailsOpen, setDetailsOpen] = useState(false);
  /**
   * The route the filing date, fee and filing details above belong to, whenever the row does not
   * name it somewhere else.
   *
   * TWO WAYS A ROW CAN CARRY ONE ROUTE'S SCALARS. `filingRouteRuleId` names the route where the
   * line publishes no window of its own. Where it DOES publish one, the scalars are the binding
   * route's, `routes[0]`, and the row said so through its heading — until the heading became the
   * deciding question. On a candidate row that leaves an agency, an apply-by date, a fee and a
   * portal under a generic question with nothing naming which rule published them, which is worse
   * than the attribution it replaced: those values went from belonging to a permit that might not
   * apply to belonging to nothing at all (#252 review).
   *
   * So the sentence below is rendered for both, and it is the SAME sentence: the heading no longer
   * carries the attribution, so the paragraph that already existed for the one case carries it for
   * the other. A row that is not a candidate is unchanged, because its heading still names the
   * permit.
   */
  const namedFilingRoute =
    context.filingRouteRuleId == null
      ? null
      : ((context.routes ?? []).find((route) => route.ruleId === context.filingRouteRuleId) ??
        null);
  const filingRoute =
    namedFilingRoute ?? (isCandidateRow(context) ? ((context.routes ?? [])[0] ?? null) : null);
  // THE QUESTION THAT WOULD DECIDE IT, on the surface the organizer works the item on.
  //
  // The conditionality already reached this row — the disposition badge above reads "may be
  // required" — but the answer that would settle it did not. It was served on the checklist
  // response and read by nothing, so the plan page said "the answers so far do not say which of
  // these applies, answering tent area would decide it" while the checklist said only "may be
  // required", and the one actionable thing about the row lived on the page the organizer is not
  // working from (#252 review). AC 5's reasoning for keeping `applyAfterDate` here is the same
  // reasoning: the checklist is where the item is worked, so what to do next about it is summary
  // information there.
  //
  // The routes themselves are NOT listed here. The plan line is where a reader compares two routes'
  // windows, fees and portals; what the checklist needs is the question, and the fields naming it
  // are each route's own `unknownFields`, deduplicated. Nothing is composed: the sentence is fixed
  // and the field names are the intake registry's.
  const candidateRoutes = context.headlineMode === "candidate" ? (context.routes ?? []) : [];
  // The trigger unknowns AND the deadline unknowns, the same union the plan line makes, for the
  // reason written there: a route's `unknownFields` are its trigger's only, and a candidate group
  // whose filing timeline also waits on an answer would otherwise be told a shorter list of
  // fields "would decide it" than actually does (design §5.3, #252 review).
  const decidingFields = [
    ...new Set([
      ...candidateRoutes.flatMap((route) => route.unknownFields),
      ...(candidateRoutes.length > 0 ? context.deadlineUnknownFields : []),
    ]),
  ];
  const triggeredRoutes = candidateRoutes.filter((route) => route.triggerResult === "true").length;
  const summaryShowsResearchTreatment =
    context.verificationStatus === "RESEARCH_REQUIRED" &&
    includesAgencyConfirmation([context.deadlineDisplay, context.feeDisplay]);
  const detailsShowResearchTreatment =
    context.verificationStatus === "RESEARCH_REQUIRED" &&
    includesAgencyConfirmation([
      context.conflictText,
      context.noteText,
      context.timelineUnresolvedReason,
      context.portalInstructions,
      ...context.publishedNotes,
    ]);

  return (
    <>
      {/* THE UNSETTLED STATEMENT COMES BEFORE THE SCALARS IT QUALIFIES, which is the order the plan
          line already renders the routes block in and for the same reason. The apply-by date, the
          gate, the fee and the filing attribution below are ONE route's, and on a candidate row no
          route is known to be the one. Rendered after them, this sentence corrected filing work the
          organizer had already read as theirs to do (#252 review).

          See `decidingFields` above. Two routes or it is not a merged line, the same guard the plan
          line makes. The leading sentence branches because a candidate group can already have a
          triggered route: where one has, the requirement is reached and what is open is which
          routes reach it, and a sentence saying the requirement itself may not apply would be
          false. Neither branch repeats the filing-route sentence's opening words, so a reader (and
          a test) can tell the two apart by their first clause. */}
      {candidateRoutes.length >= 2 && (
        <p className="check-item__text" data-testid="deciding-question">
          {triggeredRoutes > 0
            ? "The answers so far do not say which of the published routes to this requirement apply."
            : "The answers so far do not say whether this requirement applies."}
          {decidingFields.length > 0 &&
            ` Answering ${decidingFields.map(humanize).join(", ")} would decide it.`}
        </p>
      )}

      <p className="check-item__meta">
        {/* F-206 AC 2: every line shows its verification status, on the line itself. Rendered here
            rather than in either head, so a trackable row and a read-only context row carry it
            the same way and neither can be given one without the other. The status is the plan
            item's stored `verification_status`; the deprecated nullable `verified_status` column
            is never read. */}
        <span
          className={`badge badge--${context.verificationStatus.toLowerCase()}`}
          data-testid="verification-status"
        >
          {humanize(context.verificationStatus)}
        </span>
        {/* advisory and note lines legitimately publish no agency, so the label is omitted
            rather than rendered empty. */}
        {context.agency !== null && <span>{context.agency}</span>}
        <span>{humanize(context.disposition)}</span>
        {/* F-206 AC 5: the date the plan item stored, and only when it stored one. A null renders
            nothing at all — the snapshot's publication date is a different fact, and standing it in
            here would state a verification that never happened. */}
        {context.lastVerifiedDate !== null && (
          <span className="check-item__verified-date">
            last verified {context.lastVerifiedDate}
          </span>
        )}
      </p>

      {/* A RESEARCH_REQUIRED line has no located primary source, which the organizer has to see
          on the row itself rather than behind an expand: the absence IS the finding. */}
      {context.verificationStatus === "RESEARCH_REQUIRED" &&
        !summaryShowsResearchTreatment &&
        !(detailsOpen && detailsShowResearchTreatment) && (
          <p className="check-item__caveat" role="note">
            {CONFIRM_WITH_AGENCY}
          </p>
        )}

      {/* AC 5: the deadline context lives where the work happens. The published prose is optional
          and ten dated rules omit it, so any deadline data at all renders the block.

          `applyAfterDate` stays VISIBLE here, unlike on the plan line, because F-202 AC 5 requires
          each item's latest_apply_date and its apply_after_date when gated to appear on the
          checklist. The checklist is where the organizer works the item, so the window it can be
          worked in is summary information there and detail on the plan. */}
      {hasDeadlineData(context) && (
        <p className="check-item__deadline">
          {context.deadlineDisplay !== null && <span>{context.deadlineDisplay}</span>}
          {deadlineTypeLabel(context) !== null && <span>{deadlineTypeLabel(context)}</span>}
          {context.latestApplyDate !== null && (
            <span>
              {context.deadlineDisplay !== null && " · "}apply by {context.latestApplyDate}
            </span>
          )}
          {/* When pursuit can realistically begin, NOT a bar on filing earlier: the strictness of
              the ordering is RESEARCH_REQUIRED on the dependency rule, so "not before" would
              assert a sequence the verification owner declined to assert. */}
          {context.applyAfterDate !== null && (
            <span>
              {" · "}earliest realistic filing {context.applyAfterDate}
            </span>
          )}
          {gatedRoutesOf(context).map((route) => (
            <span key={route.ruleId} data-testid="route-apply-after">
              {" · "}earliest realistic filing for {route.name ?? route.ruleId}{" "}
              {route.applyAfterDate}
            </span>
          ))}
          {context.deadlineStatus !== "not_applicable" && (
            <span>
              {" · "}
              {humanize(context.deadlineStatus)}
            </span>
          )}
        </p>
      )}

      {/* Rendered only when the ruleset publishes an amount. See apps/web/app/plan/plan-line.tsx:
          an absent fee and an explicit null are one value by the time a finding carries it, so no
          sentence here can say which this row is. */}
      {context.feeDisplay !== null && <p className="check-item__text">{context.feeDisplay}</p>}

      {/* WHOSE WINDOW THIS IS, when it is not this line's own. A merged dedupe line takes its name
          from the binding route, and where that route publishes no window the filing date, fee and
          portal above come from another route of the same requirement. Saying so is what keeps a
          checklist row from naming one rule and dating another: the values are all one route's,
          and this names it. Rendered for the two cases `filingRoute` covers: a line publishing no
          window of its own, and a CANDIDATE row, whose heading is the deciding question and so no
          longer names the binding route the scalars above belong to. */}
      {filingRoute !== null && (
        <p className="check-item__text">
          The published rules give this requirement {(context.routes ?? []).length} routes. The
          filing date, fee and filing details above are {filingRoute.name ?? filingRoute.ruleId}
          &apos;s.
        </p>
      )}

      {/* Same copy as the plan line, for the same reason: COVERAGE_GAP is an unmodelled
          combination, not a missing source. A summary field, because it explains why no citation
          follows. See apps/web/app/plan/plan-line.tsx. */}
      {context.verificationStatus === "COVERAGE_GAP" && context.sources.length === 0 && (
        <p className="check-item__text">{NOT_COVERED_BY_RULESET}</p>
      )}
      {primarySource !== undefined && (
        <ul className="check-item__citations">
          <ContextCitation source={primarySource} />
        </ul>
      )}

      {hasContextDetail(context) && (
        <Disclosure
          label={`Details for ${trackingLabel(context)}`}
          className="check-item__detail"
          onOpenChange={setDetailsOpen}
        >
          {/* No last-verified date here: the summary above already states it. */}
          {/* Both readings of an official conflict, verbatim; never resolved to one silently. The
              badge in the summary already says OFFICIAL CONFLICT.

              EVERY ROUTE THAT PUBLISHES A CONFLICT, NOT THE ONE THE MERGE KEPT. `mergeGroup` does
              not concatenate this field: it falls back through the routes in binding order and
              takes the first that publishes any, so `context.conflictText` is exactly one rule's
              text and a sibling's official reading was dropped from the row entirely. The plan
              line's route entries render this per route already; this is the same field on the
              fourth surface (#252 review).

              NAMED, NOT MERGED INTO ONE PARAGRAPH. Two rules' readings run together under one
              caveat would read as four readings of one requirement. Each is its own paragraph led
              by that route's published name, which is the attribution the plan line's entry gets
              from its heading, and no sentence is composed around either value. */}
          {conflictReadings(context).map(({ ruleId, name, text }) => (
            <p className="check-item__caveat" key={ruleId}>
              {name !== null && <strong>{name} </strong>}
              {text}
            </p>
          ))}
          {context.noteText !== null && context.noteText !== context.conflictText && (
            <p className="check-item__text">{context.noteText}</p>
          )}

          {context.timelineUnresolvedReason !== null && (
            <p className="check-item__text">{context.timelineUnresolvedReason}</p>
          )}
          {context.deadlineUnknownFields.length > 0 && (
            <p className="check-item__text">
              depends on: {context.deadlineUnknownFields.map(humanize).join(", ")}
            </p>
          )}

          {/* F-204: application path from the rules data only. AC 2 — "apply at [portal]", new tab.
              NO CANDIDATE ROW OFFERS A FILING ACTION, the rule the plan line's route entries
              already carry (design §5.3), on the surface the organizer actually works the item on.
              The row states above that the answers do not decide which route applies, and these
              scalars are one route's; saying "apply at" under that sentence tells an organizer to
              file the permit the same row just said was undecided (#252 review). The portal is a
              published value, so it is named rather than dropped. */}
          <PortalBlock
            portalName={context.portalName}
            portalUrl={context.portalUrl}
            portalInstructions={context.portalInstructions}
            className="check-item__text"
            instructionsClassName="check-item__text"
            lead={candidateRoutes.length > 0 ? "portal" : "apply at"}
          />

          {context.publishedNotes.map((note) => (
            <p className="check-item__text" key={note}>
              {note}
            </p>
          ))}

          {furtherSources.length > 0 && (
            <ul className="check-item__citations">
              {furtherSources.map((source) => (
                <ContextCitation key={`${source.ruleId}:${source.citation}`} source={source} />
              ))}
            </ul>
          )}
        </Disclosure>
      )}

      {/* AC 8: the plan whose values this row is showing, read off the row and never off the live
          rules file. The version and the date travel together, because a pinned version beside
          another source's date is a pair that never existed. Rows from the checklist's own
          snapshot do not repeat what the banner already states. */}
      {!samePlan(context.sourcePlan, currentPlan) && (
        <p className="check-item__provenance">
          Dates from rules snapshot {context.sourcePlan.rulesetVersion}
          {context.sourcePlan.snapshotDate === null
            ? " · publication date not recorded for that plan"
            : ` · published ${formatSnapshotDate(context.sourcePlan.snapshotDate)}`}
        </p>
      )}
    </>
  );
}

/** A read-only line: an advisory, a notification or a prohibition. Never a trackable task. */
export function ContextLine({
  context,
  currentPlan,
}: {
  context: PlanContext;
  currentPlan: SourcePlan;
}) {
  const headingId = `context-${context.ruleIds.join("-")}`;

  return (
    <article className="check-item check-item--context" aria-labelledby={headingId}>
      <div className="check-item__head">
        <h3 className="check-item__name" id={headingId}>
          {displayName(context)}
        </h3>
        <span className="badge">context</span>
      </div>
      <PlanContextBody context={context} currentPlan={currentPlan} />
    </article>
  );
}

export type ChecklistItemCardProps = {
  item: ChecklistItem;
  currentPlan: SourcePlan;
  /** Resolves to a failure message, or null when the change was saved. */
  onStatusChange: (status: ChecklistStatus) => Promise<string | null>;
  onNotesSave: (notes: string) => Promise<string | null>;
  /** Resolves to a failure and what it left behind, which decides whether a resend is safe. */
  onUpload: (file: File) => Promise<{ message: string; outcome: UploadOutcome } | null>;
  onDownload: (documentId: string) => Promise<string | null>;
};

export function ChecklistItemCard({
  item,
  currentPlan,
  onStatusChange,
  onNotesSave,
  onUpload,
  onDownload,
}: ChecklistItemCardProps) {
  const name = displayName(item);
  // The controls name a thing to act on; the heading answers what the row is about.
  const label = trackingLabel(item);
  const [notesDraft, setNotesDraft] = useState(item.notes ?? "");
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  /** Run one organizer action, holding the row while it is in flight and reporting what it said. */
  const run = async (action: () => Promise<string | null>) => {
    setBusy(true);
    setFailure(null);
    const message = await action();
    setFailure(message);
    setBusy(false);
  };

  const upload = async () => {
    if (file === null) return;
    setBusy(true);
    setFailure(null);
    const failed = await onUpload(file);
    // The file is cleared only when the document is known to be stored, because then there is
    // nothing left to do with it. It used to be cleared for an uncertain outcome as well, to stop
    // a one-click resend of something that might already be there — that guard is gone because
    // what it guarded against is gone: the api now derives the document id from the upload key,
    // so sending the same file again is the same document, not a second one.
    if (failed === null || failed.outcome === "stored") {
      setFile(null);
      if (fileInput.current !== null) fileInput.current.value = "";
    }
    setFailure(
      failed === null
        ? null
        : failed.outcome === "not_stored"
          ? // True of every refusal, which "you can try again" was not: a file the api rejected as
            // too large or the wrong type is refused identically on a second click. What the
            // organizer needs to know is that nothing landed, and that the file they picked is the
            // one still selected.
            `${failed.message} Nothing was stored, so the file is still selected.`
          : failed.outcome === "unknown"
            ? // The one thing an organizer can act on, and it is now safe: the file is still
              // selected and sending it again cannot produce a second copy.
              `${failed.message} The file is still selected — uploading it again is safe, because the same file cannot be stored twice on this item.`
            : failed.message,
    );
    setBusy(false);
  };

  const chooseFile = (chosen: File | null) => {
    setFailure(chosen === null ? null : documentRejection(chosen));
    setFile(chosen);
  };

  return (
    <article
      className={item.struckThrough ? "check-item check-item--dropped" : "check-item"}
      aria-labelledby={`check-${item.id}`}
    >
      <div className="check-item__head">
        <h3 className="check-item__name" id={`check-${item.id}`}>
          {name}
        </h3>
        <span className={`badge check-item__status badge--${item.status}`}>
          {humanize(item.status)}
        </span>
      </div>

      {/* AC 6/9: a terminal task is struck through and kept with its organizer record. */}
      {item.struckThrough && (
        <p className="check-item__retained" role="note">
          This earlier task has ended. It is kept with everything recorded against it; nothing has
          been deleted.
        </p>
      )}

      {item.deadlineNotice !== null && <MovedDeadlineNoticeBlock notice={item.deadlineNotice} />}

      <PlanContextBody context={item} currentPlan={currentPlan} />

      <div className="check-item__track">
        <label className="check-item__field">
          <span className="check-item__field-label">Status</span>
          {/* AC 2: any transition, in any order. Agencies are messy, so the control offers every
              status from every status rather than a next-step ladder. */}
          <select
            className="check-item__select"
            aria-label={`Status for ${label}`}
            value={item.status}
            disabled={busy}
            onChange={(event) => {
              const status = event.target.value as ChecklistStatus;
              void run(() => onStatusChange(status));
            }}
          >
            {CHECKLIST_STATUSES.map((status) => (
              <option key={status} value={status}>
                {humanize(status)}
              </option>
            ))}
          </select>
        </label>

        <label className="check-item__field">
          <span className="check-item__field-label">Notes</span>
          <textarea
            className="check-item__notes"
            aria-label={`Notes for ${label}`}
            rows={2}
            value={notesDraft}
            disabled={busy}
            onChange={(event) => setNotesDraft(event.target.value)}
          />
        </label>
        <button
          type="button"
          className="check-item__button"
          disabled={busy || notesDraft === (item.notes ?? "")}
          onClick={() => void run(() => onNotesSave(notesDraft))}
        >
          Save notes
        </button>
      </div>

      <div className="check-item__documents">
        {item.documents.length > 0 && (
          <ul className="check-item__document-list">
            {item.documents.map((document) => (
              <li key={document.id}>
                <span>{document.filename}</span>
                <button
                  type="button"
                  className="check-item__button"
                  disabled={busy}
                  onClick={() => void run(() => onDownload(document.id))}
                >
                  Download
                </button>
              </li>
            ))}
          </ul>
        )}

        <label className="check-item__field">
          <span className="check-item__field-label">
            Add a document (PDF, PNG or JPG, up to 10 MB)
          </span>
          <input
            ref={fileInput}
            type="file"
            aria-label={`Add a document to ${label}`}
            accept={ACCEPTED_DOCUMENT_TYPES.join(",")}
            disabled={busy}
            onChange={(event) => chooseFile(event.target.files?.[0] ?? null)}
          />
        </label>
        <button
          type="button"
          className="check-item__button"
          disabled={busy || file === null || documentRejection(file) !== null}
          onClick={() => void upload()}
        >
          {busy ? "Working…" : "Upload"}
        </button>
      </div>

      {failure !== null && (
        <p className="check-item__error" role="alert">
          {failure}
        </p>
      )}
    </article>
  );
}
