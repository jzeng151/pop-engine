"use client";

import { useRef, useState } from "react";
import { CHECKLIST_STATUSES, CONFIRM_WITH_AGENCY, type ChecklistStatus } from "@pop-engine/engine";
import { Disclosure } from "../disclosure";
import { PortalBlock } from "../portal-block";
import { formatSnapshotDate } from "../plan/snapshot-banner";
import { includesAgencyConfirmation, NOT_COVERED_BY_RULESET } from "../verification-copy";
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

const displayName = (context: PlanContext): string =>
  context.userSummary?.heading ?? context.permitName ?? "Additional plan context";

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
  context.deadline !== null;

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
  context.conflictText !== null ||
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
  const filingRoute =
    context.filingRouteRuleId == null
      ? null
      : ((context.routes ?? []).find((route) => route.ruleId === context.filingRouteRuleId) ??
        null);
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
          and this names it. Rendered only when the line publishes no window of its own, which is
          the only case anything above was read off a different rule. */}
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
          label={`Details for ${displayName(context)}`}
          className="check-item__detail"
          onOpenChange={setDetailsOpen}
        >
          {/* No last-verified date here: the summary above already states it. */}
          {/* Both readings of an official conflict, verbatim; never resolved to one silently. The
              badge in the summary already says OFFICIAL CONFLICT. */}
          {context.conflictText !== null && (
            <p className="check-item__caveat">{context.conflictText}</p>
          )}
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

          {/* F-204: application path from the rules data only. AC 2 — "apply at [portal]", new tab. */}
          <PortalBlock
            portalName={context.portalName}
            portalUrl={context.portalUrl}
            portalInstructions={context.portalInstructions}
            className="check-item__text"
            instructionsClassName="check-item__text"
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
            aria-label={`Status for ${name}`}
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
            aria-label={`Notes for ${name}`}
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
            aria-label={`Add a document to ${name}`}
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
