"use client";

import { useEffect, useRef, useState } from "react";

import { loadEvent, regeneratePlan } from "../../intake/events-api";
import {
  loadPlan,
  loadRulesMeta,
  type PlanResult,
  type RulesMetaResult,
} from "../../plan/plan-api";
import { regenerationRefusal } from "../../plan/plan-view";
import { compareToPinned } from "../../plan/snapshot-banner";

/**
 * F-101 Acceptance Criterion 8, second half: a plan the event has been edited past is marked
 * stale and can be regenerated in one click. The intake form raised this until its save began
 * redirecting here, which left the notice mounted on a screen the organizer no longer sees.
 *
 * The plan endpoint is F-201's (`POST /api/events/:id/plan`); this asks for it and reports what
 * came back. Plans are immutable snapshots (AD-7), so regeneration is a new plan for the current
 * revision, never a patch.
 */

/** Whether this surface may offer the regeneration, and why not when it may not. */
type Regeneration =
  { status: "checking" } | { status: "offered" } | { status: "refused"; reason: string };

/**
 * The ruleset downgrade guard, asked rather than repeated.
 *
 * Regeneration evaluates whatever ruleset the SERVICE has loaded, not the one this plan pinned, so
 * offering it while the service sits behind the plan rebuilds the plan from superseded rules and
 * can drop requirements the organizer has already been shown. `regenerationRefusal` in the plan
 * view owns that decision; this only supplies it the two versions.
 *
 * A plan that cannot be read supplies no pinned version, so nothing establishes that regenerating
 * would not move the plan backwards. That is refused too, reported with the read failure itself
 * rather than a second sentence about it.
 */
const RECHECK_UNAVAILABLE =
  "This plan's staleness could not be re-read, so regeneration is not offered here. Reload this page to check.";

function regenerationGuard(plan: PlanResult, meta: RulesMetaResult): Regeneration {
  if (!plan.ok) return { status: "refused", reason: plan.message };
  const liveVersion = meta.ok ? meta.meta.ruleset_version : null;
  const refusal = regenerationRefusal(
    plan.plan.rulesetVersion,
    liveVersion,
    liveVersion === null ? null : compareToPinned(liveVersion, plan.plan.rulesetVersion),
    // The plan the refusal preserves is not on this screen; the overview's Comply section links to
    // it. Naming that link is the only wording here that points at the artifact being described.
    'the plan under "Open permit plan"',
  );
  return refusal === null ? { status: "offered" } : { status: "refused", reason: refusal };
}

export function PlanStaleNotice({ apiBaseUrl, eventId }: { apiBaseUrl: string; eventId: string }) {
  const [stale, setStale] = useState(false);
  const [regeneration, setRegeneration] = useState<Regeneration>({ status: "checking" });
  const [regenerating, setRegenerating] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [regeneratedRevision, setRegeneratedRevision] = useState<number | null>(null);
  /**
   * Carries the read failure when the POST stored a plan and the follow-up event read could not
   * confirm it. Distinct from `failure`, which means no plan was written: this one has to say a
   * plan exists, and it withdraws the button, because a second POST writes a second immutable
   * plan (AD-7) for one organizer action.
   */
  const [unconfirmed, setUnconfirmed] = useState<string | null>(null);
  /**
   * Which event the state above describes. React keeps one instance across a prop change, so
   * without this the previous event's warning survives into the next one — and the button it
   * leaves enabled posts against the new event, storing an immutable plan (AD-7) for an event
   * nobody said was stale. It is a ref rather than state because a regeneration already in flight
   * has to read the CURRENT event when it lands, not the one captured when it was started.
   */
  const describedEventId = useRef(eventId);
  /** The event the last render described, so a render can tell that it has been handed another. */
  const [renderedEventId, setRenderedEventId] = useState(eventId);

  // Clearing in an effect would be one render too late: the effect runs after React has already
  // shown the new event's id under the previous event's warning and button, and a click in that
  // window posts an immutable plan (AD-7) for an event nobody said was stale. Updating here makes
  // React re-render before anything is committed, so no render can observe the mismatch.
  if (renderedEventId !== eventId) {
    // State only. The identity ref is NOT touched here: React may begin a concurrent render for
    // another event and then abandon it, and a ref mutation survives that abandonment while the
    // old event stays committed. Every in-flight read and regeneration for the still-visible event
    // would then fail its identity check, leaving a committed button disabled forever with no
    // outcome. The ref is advanced in the effect below, which only runs on a commit.
    setRenderedEventId(eventId);
    setStale(false);
    setRegeneration({ status: "checking" });
    setRegenerating(false);
    setFailure(null);
    setRegeneratedRevision(null);
    setUnconfirmed(null);
  }

  useEffect(() => {
    let mounted = true;
    // Commit phase, so an abandoned concurrent render cannot advance it. Between the render-phase
    // reset above and this line the ref still names the previous event, which is safe: that reset
    // has already hidden the warning and the button, so there is nothing for a click to act on.
    describedEventId.current = eventId;
    // Every async result below is about the event that was current when its request went out.
    // `mounted` alone cannot say that: React keeps this instance across an eventId change and runs
    // the cleanup AFTER the new id has committed, so a slow read for the previous event lands with
    // `mounted` still true and installs that event's warning over the new one. The button it leaves
    // enabled then posts against the new event and stores an immutable plan (AD-7) nobody asked
    // for. `regenerate` already compares identity this way; this is the same rule applied to the
    // reads, so no async path in this component is guarded on liveness alone.
    const requestedEventId = eventId;
    const stillDescribed = () => mounted && describedEventId.current === requestedEventId;

    void loadEvent(apiBaseUrl, eventId).then(async (result) => {
      // An event that cannot be read says nothing about its plan. Rendering the warning would
      // assert an edit nobody observed; rendering the cleared state would assert the opposite.
      if (!stillDescribed() || !result.ok || !result.loaded.plan_stale) return;
      setStale(true);

      // Only a stale plan can be regenerated, so the two reads the guard needs are made only once
      // there is an action to guard.
      const [plan, meta] = await Promise.all([
        loadPlan(apiBaseUrl, eventId),
        loadRulesMeta(apiBaseUrl),
      ]);
      if (!stillDescribed()) return;

      // Another tab can regenerate while these two reads are in flight, which leaves the plan
      // already current, and the event can be edited again after that, which leaves it stale for a
      // revision this component has never seen. Comparing the plan's own revision against the
      // revision read before it cannot tell those apart: both read 3 whether or not a PATCH has
      // since moved the event to 4, and answering "current" there withdraws a true warning and
      // shows the organizer a plan their edit is not in. The api recomputes staleness against the
      // stored plan on every read, so ask it again here, after the reads its answer has to be
      // newer than. Withdrawal takes an explicit "not stale" and nothing else.
      const recheck = await loadEvent(apiBaseUrl, eventId);
      if (!stillDescribed()) return;
      // No answer is not "still stale" and not "current". The warning stays, because nothing
      // withdrew it, and the button does not appear, because the plan may already have been
      // regenerated and a second POST writes a second immutable plan (AD-7) for one revision.
      // `plan_stale_reported` rather than `plan_stale`, for the reason given at the POST recheck:
      // a 2xx body that omits the field would otherwise read as an answer.
      if (!recheck.ok || !recheck.loaded.plan_stale_reported) {
        setRegeneration({ status: "refused", reason: RECHECK_UNAVAILABLE });
        return;
      }
      if (!recheck.loaded.plan_stale) {
        setStale(false);
        return;
      }
      setRegeneration(regenerationGuard(plan, meta));
    });

    return () => {
      mounted = false;
    };
  }, [apiBaseUrl, eventId]);

  if (!stale && regeneratedRevision === null) return null;

  const regenerate = async () => {
    // Every outcome below is about THIS event. If the component has been handed another one while
    // the request was in flight, none of it can be reported: the screen now describes an event the
    // POST never touched.
    const regeneratedEventId = eventId;
    const stillDescribed = () => describedEventId.current === regeneratedEventId;

    setRegenerating(true);
    setFailure(null);
    const result = await regeneratePlan(apiBaseUrl, eventId);
    if (!stillDescribed()) return;

    if (!result.ok) {
      setRegenerating(false);
      setFailure(result.message);
      return;
    }

    // The event can be edited again while the generation is in flight, so a revision this page read
    // before the POST is not evidence about the plan that just replaced it — both sides of that
    // comparison could read 3 while a PATCH moved the event to 4. The API recomputes staleness
    // against the stored plan on every read, so the warning is cleared on that answer and on
    // nothing else. An event that cannot be re-read leaves the warning up: unconfirmed is not
    // current. It is also reported, rather than returned from silently — the organizer would
    // otherwise see the same warning and the same live button after a POST that stored a plan,
    // and press it again.
    const recheck = await loadEvent(apiBaseUrl, eventId);
    if (!stillDescribed()) return;
    setRegenerating(false);
    if (!recheck.ok) {
      setUnconfirmed(recheck.message);
      return;
    }
    if (recheck.loaded.plan_stale) return;

    // `loadEvent` normalises a missing `plan_stale` to `false`, which is right for a reader asking
    // "is it stale" and wrong for this one, which is asking "was freshness confirmed". A 2xx body
    // that simply omits the field would otherwise clear the warning as though the API had answered.
    // Same for a revision that is not a number: the confirmation would read "regenerated for
    // revision undefined". Either is the stored-but-unconfirmed outcome, not a success.
    const revision = recheck.loaded.event.revision_counter;
    const confirmed =
      recheck.loaded.plan_stale_reported &&
      typeof revision === "number" &&
      Number.isFinite(revision);
    if (!confirmed) {
      setUnconfirmed("The event was read, but it did not report whether the plan is current.");
      return;
    }

    setStale(false);
    setRegeneratedRevision(revision);
  };

  if (!stale) {
    return (
      <p aria-live="polite" className="riso-overview__notice" role="status">
        Plan regenerated for revision {regeneratedRevision}.
      </p>
    );
  }

  return (
    // Inserted only once the event read resolves, so a screen-reader user who lands here after an
    // edit is never moved to it. The intake form's `.intake__saved` carried aria-live="polite" for
    // exactly this state and that behaviour was lost when the affordance moved to the overview;
    // F-705 Acceptance Criterion 7 and the design system both require this surface to be announced.
    // Polite rather than assertive: the plan being out of date is not an interruption.
    <section aria-live="polite" className="riso-overview__notice riso-overview__notice--stale">
      <p>This event has been edited since its plan was generated, so the plan is out of date.</p>
      {regeneration.status === "offered" && unconfirmed === null && (
        <button disabled={regenerating} onClick={() => void regenerate()} type="button">
          {regenerating ? "Regenerating plan…" : "Regenerate plan"}
        </button>
      )}
      {unconfirmed !== null && (
        <p role="alert">
          Your plan was regenerated, but the event could not be re-read to confirm the new plan is
          current, so the warning above stays. Reload this page to check; regenerating again would
          store a second plan. {unconfirmed}
        </p>
      )}
      {regeneration.status === "refused" && <p role="alert">{regeneration.reason}</p>}
      {failure !== null && <p role="alert">{failure}</p>}
    </section>
  );
}
