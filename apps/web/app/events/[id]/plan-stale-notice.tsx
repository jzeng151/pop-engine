"use client";

import { useEffect, useRef, useState } from "react";

import { loadEvent, regeneratePlan } from "../../intake/events-api";

/**
 * F-101 Acceptance Criterion 8, second half: a plan the event has been edited past is marked
 * stale and can be regenerated in one click. The intake form raised this until its save began
 * redirecting here, which left the notice mounted on a screen the organizer no longer sees.
 *
 * The plan endpoint is F-201's (`POST /api/events/:id/plan`); this asks for it and reports what
 * came back. Plans are immutable snapshots (AD-7), so regeneration is a new plan for the current
 * revision, never a patch.
 */
export function PlanStaleNotice({ apiBaseUrl, eventId }: { apiBaseUrl: string; eventId: string }) {
  const [stale, setStale] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [regeneratedRevision, setRegeneratedRevision] = useState<number | null>(null);
  const revision = useRef<number | null>(null);

  useEffect(() => {
    let mounted = true;

    void loadEvent(apiBaseUrl, eventId).then((result) => {
      // An event that cannot be read says nothing about its plan. Rendering the warning would
      // assert an edit nobody observed; rendering the cleared state would assert the opposite.
      if (!mounted || !result.ok) return;
      revision.current = result.loaded.event.revision_counter;
      setStale(result.loaded.plan_stale);
    });

    return () => {
      mounted = false;
    };
  }, [apiBaseUrl, eventId]);

  if (!stale && regeneratedRevision === null) return null;

  const regenerate = async () => {
    const requested = revision.current;
    setRegenerating(true);
    setFailure(null);
    const result = await regeneratePlan(apiBaseUrl, eventId);
    setRegenerating(false);

    if (!result.ok) {
      setFailure(result.message);
      return;
    }

    // A plan generated for another revision does not make this one current. Clearing the warning
    // on it would tell the organizer their plan matches an event it does not describe.
    if (result.eventRevision !== null && result.eventRevision !== requested) return;

    setStale(false);
    setRegeneratedRevision(requested);
  };

  if (!stale) {
    return (
      <p className="riso-overview__notice" role="status">
        Plan regenerated for revision {regeneratedRevision}.
      </p>
    );
  }

  return (
    <section className="riso-overview__notice riso-overview__notice--stale">
      <p>This event has been edited since its plan was generated, so the plan is out of date.</p>
      <button disabled={regenerating} onClick={() => void regenerate()} type="button">
        {regenerating ? "Regenerating plan…" : "Regenerate plan"}
      </button>
      {failure !== null && <p role="alert">{failure}</p>}
    </section>
  );
}
