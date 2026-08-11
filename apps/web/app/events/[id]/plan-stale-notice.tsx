"use client";

import { parseRulesetVersion } from "@pop-engine/engine";
import { useEffect, useLayoutEffect, useRef, useState } from "react";

import {
  loadEvent,
  regeneratePlan,
  type LoadedEvent,
  type RegenerationRefusal,
} from "../../_lib/events-api";

/** Said when the endpoint refused the write because of how the two rulesets stand (F-201 AC 12). */
function downgradeRefusalCopy({
  pinnedRulesetVersion,
  rulesetVersion,
  standing,
}: RegenerationRefusal): string {
  return (
    "Your plan was not regenerated, and nothing about it has changed. It was generated from " +
    `ruleset ${pinnedRulesetVersion}, and the service is currently running ${rulesetVersion}, ` +
    // Version ordering establishes that the rebuild COULD differ and nothing more: published bumps have moved no finding at all (`docs/BASELINE.md` lineage rows).
    (standing === "older"
      ? "which is older. A rebuild from older rules is not guaranteed to reproduce the " +
        "requirements you have already been shown, so the service refused to store one rather " +
        "than risk it."
      : "and the two versions cannot be ordered. Nothing establishes that a rebuild would " +
        "reproduce the requirements you have already been shown, so the service refused to store " +
        "one rather than risk it.") +
    " That is about which rules the service is running, not about your event: the plan under " +
    '"Open permit plan" is still the one those rules produced. ' +
    // A deployment is the way out only when the pinned version is one a later ruleset can be ordered against.
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

/** Said when the endpoint refused but its answer did not name the two versions in a form this can read. */
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

/** Said when the POST stored a plan and the read after it reports the plan stale anyway: the event was edited again while the generation was running, so the stored plan pins the revision it evaluated (AD-7) and the warning that is still up is about the newer edit. */
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

/** The revision a read confirms the plan is current for, or null if it confirms nothing. */
function confirmedCurrentRevision(loaded: LoadedEvent): number | null {
  const revision = loaded.event.revision_counter;
  if (!loaded.plan_stale_reported || loaded.plan_stale) return null;
  return typeof revision === "number" && Number.isFinite(revision) ? revision : null;
}

export function PlanStaleNotice({ apiBaseUrl, eventId }: { apiBaseUrl: string; eventId: string }) {
  const [stale, setStale] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  /** An outcome the organizer may act on again: the api answered and stored nothing. */
  const [failure, setFailure] = useState<string | null>(null);
  /** An outcome that withdraws the button, and why. */
  const [withheld, setWithheld] = useState<string | null>(null);
  /** What is said in place of the warning once a read has confirmed the plan current, and the record that it has been. */
  const [cleared, setCleared] = useState<string | null>(null);
  /** Which event the state above describes. */
  const describedEventId = useRef(eventId);
  /** The event the last render described, so a render can tell that it has been handed another. */
  const [renderedEventId, setRenderedEventId] = useState(eventId);

  // Clearing in an effect would be one render too late: the effect runs after React has already shown the new event's id under the previous event's warning and button, and a click in that window posts an immutable plan.
  if (renderedEventId !== eventId) {
    // State only.
    setRenderedEventId(eventId);
    setStale(false);
    setRegenerating(false);
    setFailure(null);
    setWithheld(null);
    setCleared(null);
  }

  // A layout effect advances the id only after commit but before queued microtasks; a passive effect
  // lets the previous event's request pass the identity check and update the new screen.
  useLayoutEffect(() => {
    describedEventId.current = eventId;
  }, [eventId]);

  useEffect(() => {
    let mounted = true;
    // The result below is about the event that was current when its request went out.
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

  if (!stale && cleared === null) return null;

  const regenerate = async () => {
    // Every outcome below is about THIS event.
    const regeneratedEventId = eventId;
    const stillDescribed = () => describedEventId.current === regeneratedEventId;

    setRegenerating(true);
    setFailure(null);
    const result = await regeneratePlan(apiBaseUrl, eventId);
    if (!stillDescribed()) return;

    if (!result.ok) {
      // The endpoint's guard decides before it inserts, so a refusal stored nothing and is certain about that.
      if (result.refused) {
        setRegenerating(false);
        setWithheld(
          result.refusal === null
            ? `${REFUSED_WITHOUT_VERSIONS} ${result.message}`
            : downgradeRefusalCopy(result.refusal),
        );
        return;
      }

      // Any other failure may still have reached the api and committed, which stores an immutable plan (AD-7) this browser never saw a response for.
      const recheck = await loadEvent(apiBaseUrl, eventId);
      if (!stillDescribed()) return;
      setRegenerating(false);
      if (recheck.ok && recheck.loaded.plan_stale_reported && recheck.loaded.plan_stale) {
        setFailure(result.message);
        return;
      }
      // That same read can settle the other way: an event that explicitly reports its plan current is not an event whose plan is out of date, whatever became of the POST's answer.
      const confirmed = recheck.ok ? confirmedCurrentRevision(recheck.loaded) : null;
      if (confirmed !== null) {
        setStale(false);
        setCleared(
          "The regeneration request failed to report what it did, but this event was re-read " +
            `afterwards and its plan is current for revision ${confirmed}. There is nothing out of ` +
            "date and nothing to regenerate.",
        );
        return;
      }
      setWithheld(`${RETRY_WITHHELD} ${result.message}`);
      return;
    }

    // Re-read after generation because the event can change while the POST is in flight.
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

    // A read that answers neither the staleness question nor the revision is the
    // stored-but-unconfirmed outcome, not a success.
    const confirmed = confirmedCurrentRevision(recheck.loaded);
    if (confirmed === null) {
      setWithheld(
        `${STORED_UNCONFIRMED} The event was read, but it did not report whether the plan is current.`,
      );
      return;
    }

    setStale(false);
    setCleared(`Plan regenerated for revision ${confirmed}.`);
  };

  if (!stale) {
    return (
      <p aria-live="polite" className="riso-overview__notice" role="status">
        {cleared}
      </p>
    );
  }

  return (
    // Inserted only once the event read resolves, so a screen-reader user who lands here after an edit is never moved to it.
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
