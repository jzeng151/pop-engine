"use client";

import { useEffect, useRef, useState } from "react";

import { loadEvent } from "../../intake/events-api";

/**
 * F-101 Acceptance Criterion 8, second half: a plan the event has been edited past is marked
 * stale and can be regenerated in one click. The intake form raised this until its save began
 * redirecting here, which left the notice mounted on a screen the organizer no longer sees.
 *
 * This surface reports the staleness and does NOT offer the regeneration. That is the fourth
 * #232 round's finding taken at its word rather than approximated, and the reason is in
 * `REGENERATION_NOT_OFFERED`: the criterion's one click is not implemented here until the write
 * can refuse a downgrade itself. AC 8 is therefore only half met on this surface, which is
 * recorded on the PR and as `docs/OPEN-QUESTIONS.md` T-5, not quietly.
 */

/**
 * Why the button is not here.
 *
 * Regeneration evaluates whatever ruleset the SERVICE has loaded, not the one this plan pinned, so
 * offering it while the service sits behind the plan rebuilds the plan from superseded rules and
 * can drop requirements the organizer has already been shown. Three rounds of this component tried
 * to establish from the browser that that will not happen — comparing the pinned version against
 * `/api/rules/meta`, then re-reading staleness after it, then issuing all three reads together.
 * None of them can, and the shape is why rather than the sequencing: every one of them decides on
 * reads that have already returned and then writes afterwards. A plan pinned to a newer ruleset can
 * be stored by another deployment in that interval, and no ordering of client reads observes it —
 * the reads that would have to see it are the ones that already answered.
 *
 * The precondition can only hold where the two facts are seen at once: inside the request that
 * generates and stores the plan, which knows both the ruleset it is about to evaluate with and the
 * plan it is about to supersede. That is `POST /api/events/:id/plan`, F-201's endpoint, and this
 * branch does not touch another lane's endpoint (AGENTS.md scope contract). So this surface refuses
 * rather than races, and says so where an organizer sees it. The stale warning itself stands: it
 * rests on one read that answered, and states nothing about what a write would do.
 */
const REGENERATION_NOT_OFFERED =
  "Regenerating is not offered here. Whether it is safe depends on which rules the service is " +
  "running at the moment the plan is rebuilt, and nothing this page can read settles that: the " +
  "answer can change between the check and the rebuild, and a rebuild from rules older than this " +
  "plan's is not guaranteed to reproduce the requirements you have already been shown. The plan " +
  'under "Open permit plan" is unchanged.';

export function PlanStaleNotice({ apiBaseUrl, eventId }: { apiBaseUrl: string; eventId: string }) {
  const [stale, setStale] = useState(false);
  /**
   * Which event the state above describes. React keeps one instance across a prop change, so
   * without this the previous event's warning survives into the next one, stating an edit nobody
   * made to the event now on screen. It is a ref rather than state because the read that installs
   * the warning has to be checked against the CURRENT event when it lands, not the one captured
   * when it was started.
   */
  const describedEventId = useRef(eventId);
  /** The event the last render described, so a render can tell that it has been handed another. */
  const [renderedEventId, setRenderedEventId] = useState(eventId);

  // Clearing in an effect would be one render too late: the effect runs after React has already
  // shown the new event's id under the previous event's warning. Updating here makes React
  // re-render before anything is committed, so no render can observe the mismatch.
  if (renderedEventId !== eventId) {
    // State only. The identity ref is NOT touched here: React may begin a concurrent render for
    // another event and then abandon it, and a ref mutation survives that abandonment while the
    // old event stays committed. The in-flight read for the still-visible event would then fail
    // its identity check and never install its warning. The ref is advanced in the effect below,
    // which only runs on a commit.
    setRenderedEventId(eventId);
    setStale(false);
  }

  useEffect(() => {
    let mounted = true;
    // Commit phase, so an abandoned concurrent render cannot advance it. Between the render-phase
    // reset above and this line the ref still names the previous event, which is safe: that reset
    // has already hidden the warning, so there is nothing on screen to be wrong about.
    describedEventId.current = eventId;
    // The result below is about the event that was current when its request went out. `mounted`
    // alone cannot say that: React keeps this instance across an eventId change and runs the
    // cleanup AFTER the new id has committed, so a slow read for the previous event lands with
    // `mounted` still true and installs that event's warning over the new one.
    const requestedEventId = eventId;

    void loadEvent(apiBaseUrl, eventId).then((result) => {
      // An event that cannot be read says nothing about its plan. Rendering the warning would
      // assert an edit nobody observed; rendering the cleared state would assert the opposite.
      if (!mounted || describedEventId.current !== requestedEventId) return;
      if (!result.ok || !result.loaded.plan_stale) return;
      setStale(true);
    });

    return () => {
      mounted = false;
    };
  }, [apiBaseUrl, eventId]);

  if (!stale) return null;

  return (
    // Inserted only once the event read resolves, so a screen-reader user who lands here after an
    // edit is never moved to it. The intake form's `.intake__saved` carried aria-live="polite" for
    // exactly this state and that behaviour was lost when the affordance moved to the overview;
    // F-705 Acceptance Criterion 7 and the design system both require this surface to be announced.
    // Polite rather than assertive: the plan being out of date is not an interruption.
    <section aria-live="polite" className="riso-overview__notice riso-overview__notice--stale">
      <p>This event has been edited since its plan was generated, so the plan is out of date.</p>
      <p>{REGENERATION_NOT_OFFERED}</p>
    </section>
  );
}
