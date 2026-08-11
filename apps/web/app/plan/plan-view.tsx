"use client";

import { useEffect, useRef, useState } from "react";
import {
  clearPendingCreateForEvent,
  isPendingCreateForEvent,
  loadEvent,
  loadPendingCreate,
  type LoadResult,
  type SavedEvent,
} from "../_lib/events-api";
import {
  generatePlan,
  loadPlan,
  loadRulesMeta,
  type PlanResponse,
  type PlanResult,
  type RulesMetaResponse,
} from "./plan-api";
import { InsurancePanel } from "./insurance-panel";
import { PlanLine } from "./plan-line";
import { compareToPinned, SnapshotBanner } from "./snapshot-banner";
import { AT_RISK_BUFFER_NOTE, verdictCopy } from "./verdict-copy";
import { hasOnlyUndatedDeadlines, NO_DATED_DEADLINES_NOTE } from "./undated-deadlines";
import { type FindingReference, VerdictDetailPanel } from "./verdict-detail";
import { type FieldChecks, isNumber, readChecked } from "./validated";

// The plan view.

const RECOVERY_CLEANUP_FAILURE =
  "The plan is ready, but this browser could not clear its saved recovery information. Refresh this page to try again before creating another event.";

/** What came back for the plan itself. */
type PlanState =
  | { status: "loading" }
  /** The plan endpoint says this event has no plan yet — the only state that can be generated from. */
  | { status: "missing"; message: string }
  /** Anything else went wrong. A plan may well exist; we just could not read it. */
  | { status: "unavailable"; message: string }
  | { status: "ready"; plan: PlanResponse };

/** What came back for the event, which is what says whether the plan is still current. */
type EventState =
  { status: "loading" } | { status: "found"; revision: number } | { status: "unavailable" };

// The plan and the event are two facts that arrive separately, and every path through this component applies them separately.

const planStateFrom = (result: PlanResult): PlanState =>
  result.ok
    ? { status: "ready", plan: result.plan }
    : result.missing
      ? { status: "missing", message: result.message }
      : { status: "unavailable", message: result.message };

/** The one field this page reads off an event body, checked before it is believed. */
type ConsumedEvent = Pick<SavedEvent, "revision_counter">;

const EVENT_CHECKS: FieldChecks<ConsumedEvent> = { revision_counter: isNumber };

const eventStateFrom = (result: LoadResult): EventState => {
  if (!result.ok) return { status: "unavailable" };
  const event = readChecked(EVENT_CHECKS, result.loaded.event);
  // A body whose revision cannot be read is an event we could not read: the page already says
  // currency is unconfirmed for that, which is the honest answer and not a claim of currency.
  if (event === null) return { status: "unavailable" };
  return { status: "found", revision: event.revision_counter };
};

const isNearEmpty = (findings: PlanResponse["findings"]): boolean =>
  findings.every(
    ({ disposition }) => disposition !== "required" && disposition !== "prohibited_or_ineligible",
  );

/** Why regenerating this plan is refused, or null when it is safe to offer. */
function regenerationRefusal(
  pinnedVersion: string,
  liveVersion: string | null,
  standing: ReturnType<typeof compareToPinned> | null,
  preservedPlan: string,
): string | null {
  if (standing === "same" || standing === "newer") return null;
  return (
    `This plan was generated from ruleset ${pinnedVersion}. ` +
    (liveVersion === null
      ? "The ruleset the service is currently running could not be read, so it cannot be confirmed to be that version or newer. "
      : `The service is currently running ${liveVersion}, which is not that version or newer. `) +
    "Regenerating would rebuild your plan from the service's rules, so it is unavailable until the " +
    "service is back on " +
    pinnedVersion +
    " or newer. This is the service being behind, not a problem with your event, and " +
    preservedPlan +
    " is still the one those rules produced."
  );
}

export function PlanView({
  apiBaseUrl,
  eventId,
  rulesetReferences,
}: {
  apiBaseUrl: string;
  eventId: string;
  rulesetReferences?: {
    readonly rulesetVersion: string;
    readonly findings: readonly FindingReference[];
  };
}) {
  const [planState, setPlanState] = useState<PlanState>({ status: "loading" });
  const [eventState, setEventState] = useState<EventState>({ status: "loading" });
  const [meta, setMeta] = useState<RulesMetaResponse | null>(null);
  const [regenerating, setRegenerating] = useState(false);
  const [regenerationFailure, setRegenerationFailure] = useState<string | null>(null);

  /**
   * Which event this page is currently showing. `generate()` runs outside the effect, so it
   * cannot rely on the effect's cleanup: it re-checks this after every await and drops its
   * results if the page has moved to another event in the meantime.
   */
  const showing = `${apiBaseUrl}|${eventId}`;
  const active = useRef(showing);

  useEffect(() => {
    active.current = showing;
    let abandoned = false;

    // Everything on screen belongs to one event.
    setPlanState({ status: "loading" });
    setEventState({ status: "loading" });
    setMeta(null);
    setRegenerationFailure(null);
    // A generation belonging to the event we just left is no longer this page's business: its result is dropped by the guard in `generate`, and its in-flight label must not sit on the new event's button.
    setRegenerating(false);

    void loadPlan(apiBaseUrl, eventId).then((result) => {
      const cleanupFailed = result.ok && !clearPendingCreateForEvent(apiBaseUrl, eventId);
      if (abandoned) return;
      if (cleanupFailed) setRegenerationFailure(RECOVERY_CLEANUP_FAILURE);
      setPlanState(planStateFrom(result));
    });

    // A plan pins the revision it evaluated (AD-13), and the plan endpoint serves the latest plan whether or not the event has moved on since.
    void loadEvent(apiBaseUrl, eventId).then((result) => {
      if (abandoned) return;
      setEventState(eventStateFrom(result));
    });

    // The banner states the plan's own pinned version without this, so the plan is never held up
    // waiting for it; the live version only decides how the two rulesets stand.
    void loadRulesMeta(apiBaseUrl).then((result) => {
      if (abandoned) return;
      if (result.ok) setMeta(result.meta);
    });

    return () => {
      abandoned = true;
    };
  }, [apiBaseUrl, eventId, showing]);

  /**
   * Generate a plan for the event as it stands now: the first one when none exists, the
   * replacement when an edit or a rules update has left the stored one behind.
   */
  const generate = async () => {
    const requested = showing;
    setRegenerating(true);
    setRegenerationFailure(null);

    const recovery = loadPendingCreate(apiBaseUrl);
    if (!recovery.resolved) {
      setRegenerationFailure(
        "This browser could not safely read or clear the saved event recovery. Reload this page once session storage is available before generating a plan.",
      );
      setRegenerating(false);
      return;
    }
    const generated = await generatePlan(
      apiBaseUrl,
      eventId,
      isPendingCreateForEvent(recovery.pending, eventId) ? recovery.pending.key : undefined,
    );
    const cleanupFailed = generated.ok && !clearPendingCreateForEvent(apiBaseUrl, eventId);
    if (active.current !== requested) return;
    if (!generated.ok) {
      setRegenerationFailure(generated.message);
      setRegenerating(false);
      return;
    }

    // The generation's own response IS the plan it stored, so it goes on screen here.
    setPlanState({ status: "ready", plan: generated.plan });
    if (cleanupFailed) setRegenerationFailure(RECOVERY_CLEANUP_FAILURE);
    setRegenerating(false);

    // The revision this plan will be compared against is a separate question, and one this page no longer knows the answer to: the event may have been edited again while the generation ran, so the revision read before it is.
    setEventState({ status: "loading" });
    void loadEvent(apiBaseUrl, eventId).then((result) => {
      if (active.current !== requested) return;
      setEventState(eventStateFrom(result));
    });
  };

  if (planState.status === "loading") {
    return (
      <main className="plan">
        <p className="intake__lede" role="status">
          Loading your permit plan…
        </p>
      </main>
    );
  }

  const plan = planState.status === "ready" ? planState.plan : null;
  const standing =
    plan === null || meta === null
      ? null
      : compareToPinned(meta.ruleset_version, plan.rulesetVersion);

  const isStale =
    plan !== null && eventState.status === "found" && eventState.revision > plan.eventRevision;
  // The banner tells the organizer a newer ruleset exists, so the page has to offer the action it names.
  const wouldOffer =
    eventState.status === "found" &&
    (planState.status === "missing" || isStale || standing === "newer");
  // No pinned plan means nothing to downgrade: a first plan is always safe to generate, whatever
  // the service is running. Everything else defers to the ruleset check.
  const refusal =
    plan === null
      ? null
      : regenerationRefusal(
          plan.rulesetVersion,
          meta?.ruleset_version ?? null,
          standing,
          "the plan below",
        );
  const canGenerate = wouldOffer && refusal === null;

  return (
    <main className="plan">
      <nav aria-label="Plan sections" className="plan__tabs">
        <a aria-current="page" href={`/events/${eventId}/plan`}>
          Permit plan
        </a>
        <span>
          Documents <small>Planned</small>
        </span>
        <span>
          Activity <small>Planned</small>
        </span>
      </nav>

      <h1>Permit plan</h1>

      {plan !== null && (
        /* AC 4: the version this plan was generated from AND the publication date that version
           carried, both read off the plan itself, so a plan viewed after a rules update states the
           pair that produced it rather than a pinned version beside the live file's date. `meta`
           only decides how the live ruleset stands relative to this one. */
        <SnapshotBanner
          rulesetVersion={plan.rulesetVersion}
          snapshotDate={plan.snapshotDate}
          meta={meta}
        />
      )}

      {/* A missing plan and an unreadable one are different facts. Only the first can be answered
          by generating; offering it for the second would write a second immutable plan row for an
          event whose existing plan merely could not be read. */}
      {planState.status !== "ready" && (
        <p className="intake__error" role="alert">
          {planState.message}
        </p>
      )}

      {/* The plan endpoint serves the latest plan whether or not the event has moved on since it
          was generated. Presenting deadlines computed from an older headcount, date or location
          as current is the failure F-101's revision counter exists to prevent. */}
      {isStale && plan !== null && eventState.status === "found" && (
        <p className="plan__stale" role="alert">
          This plan was generated for revision {plan.eventRevision}; the event has since been edited
          and is now at revision {eventState.revision}. The dates and verdict below were computed
          from the older answers.
        </p>
      )}

      {/* Without the event we cannot say whether the plan still matches it, and silence would
          read as confirmation that it does. `loading` says that as loudly as `unavailable`: the
          two requests are independent, so a plan that resolves first renders its verdict and
          deadlines with the revision check still outstanding, and an event request that never
          settles after an edit leaves a superseded plan on screen looking current. Not-yet-checked
          and could-not-be-checked are both unconfirmed until the check comes back. */}
      {plan !== null && eventState.status !== "found" && (
        <p className="plan__unconfirmed" role="status">
          {eventState.status === "loading"
            ? "Checking whether this plan still matches the event; whether it is current is unconfirmed until then."
            : "The event could not be read, so whether this plan is still current is unconfirmed."}
        </p>
      )}

      {/* Said only where it took an action away — when the page would otherwise be offering
          regeneration. Greying out a button, or dropping it silently, leaves an organizer to
          conclude their event is the problem; this says the service is behind and names both
          versions, so waiting is an informed choice rather than a guess. (The banner states how the
          two rulesets stand; this states what it means for the action.) */}
      {wouldOffer && refusal !== null && (
        <p className="plan__refused" role="status">
          {refusal}
        </p>
      )}

      {/* One place the regeneration action and its failure are rendered, whatever else is on
          screen. A failure that only appeared in the no-plan branch left an organizer clicking a
          re-enabled button with no idea it had failed, and each attempt writes a plan row. */}
      {(canGenerate || regenerationFailure !== null) && (
        <div className="plan__actions">
          {canGenerate && (
            <button
              className="intake__submit"
              type="button"
              onClick={() => void generate()}
              disabled={regenerating}
            >
              {regenerating
                ? "Generating plan…"
                : planState.status === "missing"
                  ? "Generate the plan"
                  : "Regenerate the plan"}
            </button>
          )}
          {regenerationFailure !== null && (
            <p className="intake__error" role="alert">
              {regenerationFailure}
            </p>
          )}
        </div>
      )}

      {plan !== null && (
        <>
          <p className={`plan__verdict plan__verdict--${plan.verdict.toLowerCase()}`} role="status">
            <strong>{verdictCopy(plan.verdict, plan.verdictDetail)}</strong> · generated{" "}
            {plan.generatedAt.slice(0, 10)} · revision {plan.eventRevision}
          </p>

          <ol aria-label="Compliance workflow" className="plan__route">
            <li className="plan__route-step plan__route-step--complete">
              <a href={`/intake/${eventId}`}>
                <span aria-hidden="true">✓</span>
                <strong>Intake</strong>
                <small>Event record</small>
              </a>
            </li>
            <li aria-current="step" className="plan__route-step plan__route-step--current">
              <span aria-hidden="true">⌕</span>
              <strong>Review</strong>
              <small>Current plan</small>
            </li>
            <li className="plan__route-step">
              <a href={`/events/${eventId}/checklist`}>
                <span aria-hidden="true">☑</span>
                <strong>Checklist</strong>
                <small>Track the work</small>
              </a>
            </li>
          </ol>

          {/* F-102's verdict table requires the at-risk threshold to be labelled as PopEngine's
              internal planning buffer, never an official one. On screen, beside the countdown it
              qualifies — an organizer reading "apply within 10 days" otherwise has nothing telling
              them it is not the agency's deadline. */}
          {plan.verdict === "FEASIBLE_AT_RISK" && (
            <p className="plan__buffer" role="note">
              {AT_RISK_BUFFER_NOTE}
            </p>
          )}

          {/* F-102 Edge Cases: only undated deadlines → FEASIBLE with this note. */}
          {plan.verdict === "FEASIBLE" && hasOnlyUndatedDeadlines(plan.findings) && (
            <p className="plan__undated" role="note" data-testid="no-dated-deadlines">
              {NO_DATED_DEADLINES_NOTE}
            </p>
          )}

          <section className="plan__workbench">
            <div className="plan__review-column">
              <h2>Review</h2>

              <VerdictDetailPanel
                verdict={plan.verdict}
                detail={plan.verdictDetail}
                findings={plan.findings}
                rulesetReferences={
                  rulesetReferences?.rulesetVersion === plan.rulesetVersion
                    ? rulesetReferences.findings
                    : []
                }
              />

              {/* F-205: a dedicated card for R10/R11's insurance findings, above the line items each
                  still renders from (AC 5). Nothing at all when none of the three rules triggered
                  (AC 3) — that silence is `InsurancePanel`'s own, not a state this page decides. */}
              <InsurancePanel findings={plan.findings} eventId={eventId} />

              {isNearEmpty(plan.findings) && (
                <p className="plan__empty">
                  No definite city event requirement identified from your answers.
                </p>
              )}
              {plan.findings.length > 0 && (
                <div className="plan__lines">
                  {plan.findings.map((finding) => (
                    <PlanLine key={finding.ruleIds.join("+")} finding={finding} />
                  ))}
                </div>
              )}
            </div>

            <aside className="plan__checklist-column">
              <div>
                <span aria-hidden="true">☑</span>
                <h2>Checklist</h2>
              </div>
              <p>Track the supported requirements from this plan in the event checklist.</p>
              <a href={`/events/${eventId}/checklist`}>Open event checklist</a>
            </aside>
          </section>
        </>
      )}
    </main>
  );
}
