"use client";

import { useEffect, useState } from "react";

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
function regenerationGuard(plan: PlanResult, meta: RulesMetaResult): Regeneration {
  if (!plan.ok) return { status: "refused", reason: plan.message };
  const liveVersion = meta.ok ? meta.meta.ruleset_version : null;
  const refusal = regenerationRefusal(
    plan.plan.rulesetVersion,
    liveVersion,
    liveVersion === null ? null : compareToPinned(liveVersion, plan.plan.rulesetVersion),
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

  useEffect(() => {
    let mounted = true;

    void loadEvent(apiBaseUrl, eventId).then(async (result) => {
      // An event that cannot be read says nothing about its plan. Rendering the warning would
      // assert an edit nobody observed; rendering the cleared state would assert the opposite.
      if (!mounted || !result.ok || !result.loaded.plan_stale) return;
      setStale(true);

      // Only a stale plan can be regenerated, so the two reads the guard needs are made only once
      // there is an action to guard.
      const [plan, meta] = await Promise.all([
        loadPlan(apiBaseUrl, eventId),
        loadRulesMeta(apiBaseUrl),
      ]);
      if (!mounted) return;
      setRegeneration(regenerationGuard(plan, meta));
    });

    return () => {
      mounted = false;
    };
  }, [apiBaseUrl, eventId]);

  if (!stale && regeneratedRevision === null) return null;

  const regenerate = async () => {
    setRegenerating(true);
    setFailure(null);
    const result = await regeneratePlan(apiBaseUrl, eventId);

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
    setRegenerating(false);
    if (!recheck.ok) {
      setUnconfirmed(recheck.message);
      return;
    }
    if (recheck.loaded.plan_stale) return;

    setStale(false);
    setRegeneratedRevision(recheck.loaded.event.revision_counter);
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
