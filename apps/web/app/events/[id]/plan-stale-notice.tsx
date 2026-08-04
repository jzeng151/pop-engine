"use client";

import { parseRulesetVersion } from "@pop-engine/engine";
import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { loadEvent, regeneratePlan, type RegenerationRefusal } from "../../intake/events-api";

/**
 * F-101 Acceptance Criterion 8, second half: a plan the event has been edited past is marked
 * stale and can be regenerated in one click. The intake form raised this until its save began
 * redirecting here, which left the notice mounted on a screen the organizer no longer sees.
 *
 * The one click was withdrawn from this surface during #232 and is restored here. What changed is
 * not this component's confidence about the write: it is that `POST /api/events/:id/plan` now
 * refuses to store a plan rebuilt from a ruleset older than the one the plan it supersedes pinned,
 * or from one that cannot be ordered against it, decided inside the inserting transaction under a
 * row lock (F-201 AC 12). That is the only place both facts are visible at once, which is why
 * three rounds of browser-side checking here could not hold: each decided on reads that had
 * already returned and then wrote afterwards.
 *
 * So this surface does not check and then write. It writes, and reports the answer, including the
 * 409, which carries both versions and which way round they stand.
 */

/** Said when the endpoint refused the write because of how the two rulesets stand (F-201 AC 12). */
function downgradeRefusalCopy({
  pinnedRulesetVersion,
  rulesetVersion,
  standing,
}: RegenerationRefusal): string {
  return (
    "Your plan was not regenerated, and nothing about it has changed. It was generated from " +
    `ruleset ${pinnedRulesetVersion}, and the service is currently running ${rulesetVersion}, ` +
    // Version ordering establishes that the rebuild COULD differ and nothing more: published bumps
    // have moved no finding at all (`docs/BASELINE.md` lineage rows). Saying a requirement was
    // dropped would assert a regulatory fact from an ordering that does not carry it.
    (standing === "older"
      ? "which is older. A rebuild from older rules is not guaranteed to reproduce the " +
        "requirements you have already been shown, so the service refused to store one rather " +
        "than risk it."
      : "and the two versions cannot be ordered. Nothing establishes that a rebuild would " +
        "reproduce the requirements you have already been shown, so the service refused to store " +
        "one rather than risk it.") +
    " That is about which rules the service is running, not about your event: the plan under " +
    '"Open permit plan" is still the one those rules produced. ' +
    // A deployment is the way out only when the pinned version is one a later ruleset can be
    // ordered against. A plan pinned to a label outside the published form is unorderable against
    // every version the service could run, including the same label again, so naming a deployment
    // would name a wait that ends at this same refusal.
    (parseRulesetVersion(pinnedRulesetVersion) === null
      ? `Waiting will not clear this: ${pinnedRulesetVersion} is not a published ruleset version, ` +
        "so no version the service runs can be ordered against it and every attempt is refused the " +
        "same way. Ask whoever runs this deployment to look at the ruleset version this plan " +
        "recorded; nothing on this page can settle it."
      : `Regenerating will work once the service is running ${pinnedRulesetVersion} or a later ` +
        "version of it, so try again then, or ask whoever runs this deployment which ruleset it " +
        "is on.")
  );
}

/**
 * Said when the endpoint refused but its answer did not name the two versions in a form this can
 * read. The refusal itself is not in doubt, a 409 from this endpoint being the guard and deciding
 * before it inserts, so the retry is withheld either way; only the specifics are missing, and the
 * endpoint's own sentence carries them in prose.
 */
const REFUSED_WITHOUT_VERSIONS =
  "Your plan was not regenerated, and nothing about it has changed. The service refused to rebuild " +
  "it from the rules it is currently running, and did not name the two ruleset versions in a form " +
  'this page can read. The plan under "Open permit plan" is still the one those rules produced. ' +
  "Regenerating is not offered again here, because the same request to the same service would be " +
  "refused the same way. What the service said:";

/** Said when a POST answered 2xx and the read that would confirm the stored plan did not. */
const STORED_UNCONFIRMED =
  "Your plan was regenerated, but the event could not be re-read to confirm the new plan is " +
  "current, so the warning above stays. Reload this page to check; regenerating again would store " +
  "a second plan.";

/**
 * Said when the POST stored a plan and the read after it reports the plan stale anyway: the event
 * was edited again while the generation was running, so the stored plan pins the revision it
 * evaluated (AD-7) and the warning that is still up is about the newer edit. Returning silently
 * here would leave the organizer the same warning and the same live button they just pressed, with
 * nothing said about the plan that landed.
 */
const STORED_FOR_EARLIER_REVISION =
  "Your plan was regenerated and stored, but it was built from an earlier revision of this event: " +
  "the event was edited again while that was running. The warning above is now about that newer " +
  "edit. Regenerating again will store another plan, built from the event as it stands now.";

/**
 * Said when the POST itself came back with no usable outcome. It may have reached the api and
 * committed before the connection dropped, so it is not known whether a plan was stored, and a
 * retry would store a second one (AD-7) if it was.
 */
const RETRY_WITHHELD =
  "The regeneration request failed, so it is not known whether a plan was stored. It is not " +
  "offered again here, because a second attempt would store a second plan if the first one landed. " +
  "Reload this page to check.";

export function PlanStaleNotice({ apiBaseUrl, eventId }: { apiBaseUrl: string; eventId: string }) {
  const [stale, setStale] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  /** An outcome the organizer may act on again: the api answered and stored nothing. */
  const [failure, setFailure] = useState<string | null>(null);
  /**
   * An outcome that withdraws the button, and why. Either a plan may exist and cannot be shown to
   * be current, where a second POST would write a second immutable plan (AD-7) for one organizer
   * action, or the endpoint refused and a retry would be refused identically until the service moves.
   */
  const [withheld, setWithheld] = useState<string | null>(null);
  const [regeneratedRevision, setRegeneratedRevision] = useState<number | null>(null);
  /**
   * Which event the state above describes. React keeps one instance across a prop change, so
   * without this the previous event's warning survives into the next one, and the button it
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
    // outcome. The ref is advanced in the layout effect below, which only runs on a commit.
    setRenderedEventId(eventId);
    setStale(false);
    setRegenerating(false);
    setFailure(null);
    setWithheld(null);
    setRegeneratedRevision(null);
  }

  // Commit phase, so an abandoned concurrent render cannot advance it, and the LAYOUT phase rather
  // than a passive effect because React runs this inside the commit that puts the new event on
  // screen, before it yields to any microtask. A passive effect leaves a window between that commit
  // and the effect: a request for the PREVIOUS event resolving inside it still passes the identity
  // check below and installs the previous event's outcome over the event now on screen, where the
  // render-phase reset has already cleared everything. That is the whole point of the check.
  useLayoutEffect(() => {
    describedEventId.current = eventId;
  }, [eventId]);

  useEffect(() => {
    let mounted = true;
    // The result below is about the event that was current when its request went out. `mounted`
    // alone cannot say that: React keeps this instance across an eventId change and runs the
    // cleanup AFTER the new id has committed, so a slow read for the previous event lands with
    // `mounted` still true and installs that event's warning over the new one. The button it leaves
    // enabled then posts against the new event and stores an immutable plan (AD-7) nobody asked for.
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
      // The endpoint's guard decides before it inserts, so a refusal stored nothing and is certain
      // about that. There is nothing to re-read and nothing a retry would change: the same request
      // to the same deployment is refused the same way.
      if (result.refused) {
        setRegenerating(false);
        setWithheld(
          result.refusal === null
            ? `${REFUSED_WITHOUT_VERSIONS} ${result.message}`
            : downgradeRefusalCopy(result.refusal),
        );
        return;
      }

      // Any other failure may still have reached the api and committed, which stores an immutable
      // plan (AD-7) this browser never saw a response for. Re-offering the button on the strength
      // of the error alone therefore writes a second plan for one organizer action. The button
      // comes back only on an explicit "still stale" read AFTER the POST, not on the state this
      // component held before it; anything else withholds it and says why.
      const recheck = await loadEvent(apiBaseUrl, eventId);
      if (!stillDescribed()) return;
      setRegenerating(false);
      if (recheck.ok && recheck.loaded.plan_stale_reported && recheck.loaded.plan_stale) {
        setFailure(result.message);
        return;
      }
      setWithheld(`${RETRY_WITHHELD} ${result.message}`);
      return;
    }

    // The event can be edited again while the generation is in flight, so a revision this page read
    // before the POST is not evidence about the plan that just replaced it: both sides of that
    // comparison could read 3 while a PATCH moved the event to 4. The API recomputes staleness
    // against the stored plan on every read, so the warning is cleared on that answer and on
    // nothing else. An event that cannot be re-read leaves the warning up: unconfirmed is not
    // current. It is also reported, rather than returned from silently, because the organizer would
    // otherwise see the same warning and the same live button after a POST that stored a plan,
    // and press it again.
    const recheck = await loadEvent(apiBaseUrl, eventId);
    if (!stillDescribed()) return;
    setRegenerating(false);
    if (!recheck.ok) {
      setWithheld(`${STORED_UNCONFIRMED} ${recheck.message}`);
      return;
    }
    if (recheck.loaded.plan_stale) {
      setFailure(STORED_FOR_EARLIER_REVISION);
      return;
    }

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
      setWithheld(
        `${STORED_UNCONFIRMED} The event was read, but it did not report whether the plan is current.`,
      );
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
      {withheld === null && (
        <button disabled={regenerating} onClick={() => void regenerate()} type="button">
          {regenerating ? "Regenerating plan…" : "Regenerate plan"}
        </button>
      )}
      {withheld !== null && <p role="alert">{withheld}</p>}
      {failure !== null && <p role="alert">{failure}</p>}
    </section>
  );
}
