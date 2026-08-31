"use client";

import { useRef, useState } from "react";
import {
  CHECKLIST_STATUSES,
  CONFIRM_WITH_AGENCY,
  type ChecklistStatus,
  offersAFilingAction,
} from "@pop-engine/engine";
import { Disclosure } from "../_components/disclosure";
import { PortalBlock } from "../_components/portal-block";
import { formatSnapshotDate } from "../plan/snapshot-banner";
import { CANDIDATE_HEADING } from "../plan/plan-line";
import { includesAgencyConfirmation, NOT_COVERED_BY_RULESET } from "../_lib/verification-copy";
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

// One checklist row.

const humanize = (token: string): string => token.replace(/_/g, " ");

/** Two or more, the same guard both surfaces make: one route is not a choice between routes. */
const isCandidateRow = (context: PlanContext): boolean =>
  context.headlineMode === "candidate" && (context.routes?.length ?? 0) >= 2;

/** THE HEADING IS THE QUESTION, NOT A PERMIT, on this surface as on the plan line. */
const displayName = (context: PlanContext): string =>
  isCandidateRow(context)
    ? CANDIDATE_HEADING
    : (context.userSummary?.heading ?? context.permitName ?? "Additional plan context");

/** What the row's CONTROLS are labelled with, which is a different question from what it is headed with: a status select, a notes box and an upload need a NOUN, and the deciding question is not one. */
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

/** The routes carrying a dependency gate that the row's own scalars do not. */
const gatedRoutesOf = (context: PlanContext): readonly ConsumedRoute[] => {
  const routes = context.routes ?? [];
  // NOTHING IS SKIPPED WHERE THE ROW SHOWS NO GATE.
  const onTheRow =
    context.applyAfterDate === null
      ? null
      : (context.filingRouteRuleId ?? routes[0]?.ruleId ?? null);
  return routes.filter((route) => route.applyAfterDate !== null && route.ruleId !== onTheRow);
};

/** The published deadline's own type, for a rule that states a kind of deadline but no prose and no computable date. */
const deadlineTypeLabel = (context: PlanContext): string | null =>
  context.deadlineDisplay === null &&
  context.latestApplyDate === null &&
  context.applyAfterDate === null &&
  context.deadlineStatus === "not_applicable" &&
  context.deadline !== null
    ? humanize(context.deadline.type)
    : null;

/** Every official-conflict reading this row carries, with the rule that published each. */
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

/** The route the row's date, fee and filing details belong to, whichever way it was chosen. */
const attributedRouteOf = (context: PlanContext): ConsumedRoute | null => {
  const routes = context.routes ?? [];
  const named =
    context.filingRouteRuleId == null
      ? null
      : (routes.find((route) => route.ruleId === context.filingRouteRuleId) ?? null);
  return named ?? (isCandidateRow(context) ? (routes[0] ?? null) : null);
};

/** The row's citations with the filing route's own first, because the first one is PROMOTED. */
const citationsLedByFilingRoute = (
  context: PlanContext,
): { lead: PlanContext["sources"][number] | undefined; rest: PlanContext["sources"] } => {
  const ruleId = attributedRouteOf(context)?.ruleId;
  const [first, ...others] = context.sources;
  if (ruleId === undefined) return { lead: first, rest: others };
  const own = context.sources.filter((source) => source.ruleId === ruleId);
  const siblings = context.sources.filter((source) => source.ruleId !== ruleId);
  // A filing route whose rule publishes no source of its own promotes NOTHING rather than a sibling's page: `ruleSources` returns `[]` for a rule with no `source` block.
  const [leadOwn, ...furtherOwn] = own;
  return { lead: leadOwn, rest: [...furtherOwn, ...siblings] };
};

/** Two snapshot pairs are the same pair, so the row has nothing the banner has not already said. */
const samePlan = (left: SourcePlan, right: SourcePlan): boolean =>
  left.rulesetVersion === right.rulesetVersion && left.snapshotDate === right.snapshotDate;

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
  // THE CITATIONS THE DISCLOSURE ACTUALLY HOLDS, not the count before they were narrowed.
  citationsLedByFilingRoute(context).rest.length > 0 ||
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
  const { lead: primarySource, rest: furtherSources } = citationsLedByFilingRoute(context);
  const [detailsOpen, setDetailsOpen] = useState(false);
  /** The route the paragraph below names, and the route the promoted citation above came from: one selection, `attributedRouteOf`, because a sentence naming one rule beside a citation from another is the crossing this row exists to remove. */
  const filingRoute = attributedRouteOf(context);
  // THE QUESTION THAT WOULD DECIDE IT, on the surface the organizer works the item on.
  const candidateRoutes = context.headlineMode === "candidate" ? (context.routes ?? []) : [];
  // The trigger unknowns AND the deadline unknowns, the same union the plan line makes, for the reason written there: a route's `unknownFields` are its trigger's only, and a candidate group whose filing timeline also waits.
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
  // THE TEXTS THE DISCLOSURE ACTUALLY RENDERS.
  const detailsShowResearchTreatment =
    context.verificationStatus === "RESEARCH_REQUIRED" &&
    includesAgencyConfirmation([
      ...conflictReadings(context).map(({ text }) => text),
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
            // The row's own values are the attributed route's, so the rule is asked of that
            // route where there is one and of the row's own disposition where there is not.
            lead={
              offersAFilingAction(
                filingRoute ?? context,
                candidateRoutes.length > 0 ? "candidate" : null,
              )
                ? "apply at"
                : "portal"
            }
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

function RetainedTaskNotice() {
  return (
    <p className="check-item__retained" role="note">
      This earlier task has ended. It is kept with everything recorded against it; nothing has been
      deleted.
    </p>
  );
}

/** A read-only checklist line. A blocking disposition stays visibly separate from ordinary context. */
export function ReadOnlyChecklistLine({
  context,
  currentPlan,
  headingId,
  retained = false,
}: {
  context: PlanContext;
  currentPlan: SourcePlan;
  headingId: string;
  retained?: boolean;
}) {
  const isBlocker = context.disposition === "prohibited_or_ineligible";

  return (
    <article
      className={`check-item ${isBlocker ? "check-item--blocker" : "check-item--context"}${retained ? " check-item--dropped" : ""}`}
      aria-labelledby={headingId}
    >
      <div className="check-item__head">
        <h3 className="check-item__name" id={headingId}>
          {displayName(context)}
        </h3>
        <span className="badge">{isBlocker ? "blocker" : humanize(context.kind)}</span>
      </div>
      {retained && <RetainedTaskNotice />}
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
    // The file is cleared only when the document is known to be stored, because then there is nothing left to do with it.
    if (failed === null || failed.outcome === "stored") {
      setFile(null);
      if (fileInput.current !== null) fileInput.current.value = "";
    }
    setFailure(
      failed === null
        ? null
        : failed.outcome === "not_stored"
          ? // True of every refusal, which "you can try again" was not: a file the api rejected as
            // too large or the wrong type is refused identically on a second click.
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
      {item.struckThrough && <RetainedTaskNotice />}

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
