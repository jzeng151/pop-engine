"use client";

import { useEffect, useRef, useState } from "react";
import { CHECKLIST_STATUSES, type ChecklistStatus } from "@pop-engine/engine";
import { loadRulesMeta, type RulesMetaResponse } from "../plan/plan-api";
import { compareToPinned, SnapshotBanner } from "../plan/snapshot-banner";
import {
  createChecklist,
  documentUrl,
  loadChecklist,
  updateChecklistItem,
  uploadDocument,
  type ChecklistResponse,
  type ChecklistResult,
  type SourcePlan,
  type StatusRollup,
} from "./checklist-api";
import { ChecklistItemCard, ContextLine } from "./checklist-item";

// The checklist view (F-202): the execution surface for a permit plan.

type ChecklistState =
  | { status: "loading" }
  /** The event has no plan yet, so there is nothing to convert. */
  | { status: "no_plan"; message: string }
  /** Anything else went wrong. A checklist may well exist; we just could not read it. */
  | { status: "unavailable"; message: string }
  | { status: "ready"; checklist: ChecklistResponse };

const stateFrom = (result: ChecklistResult): ChecklistState =>
  result.ok
    ? { status: "ready", checklist: result.checklist }
    : result.noPlan
      ? { status: "no_plan", message: result.message }
      : { status: "unavailable", message: result.message };

/** AC 2's rollup, as the api counted it. */
const rollupOf = (rollup: StatusRollup): readonly [ChecklistStatus, number][] =>
  CHECKLIST_STATUSES.map((status) => [status, rollup[status]] as [ChecklistStatus, number]).filter(
    ([, count]) => count > 0,
  );

const humanize = (token: string): string => token.replace(/_/g, " ");

/**
 * What an organizer calls the channel. Unknown tokens fall through to themselves rather than
 * being dropped: a channel this page has not been taught about still has to be reported, because
 * the whole point of the notice is that something did not arrive.
 */
const CHANNEL_NAMES: Readonly<Record<string, string>> = {
  sms: "text message",
  email: "email",
};

/** F-203 AC 5, and the reason it is a sentence here rather than the string the api stores. */
export function simulatedDeliveryNotice(delivery: { channel: string; sentCount: number }): string {
  const name = CHANNEL_NAMES[delivery.channel] ?? delivery.channel;
  const alerts = delivery.sentCount === 1 ? "alert" : "alerts";
  const lead = `No ${name}s have been sent.`;
  const detail =
    `PopEngine recorded ${delivery.sentCount} ${name} ${alerts} for this event, but ${name} ` +
    `sending is not switched on yet, so nothing was delivered.`;
  // NO "but email is fine" REASSURANCE.
  return `${lead} ${detail}`;
}

/** A channel whose alerts were attempted and failed, which is a different fact from the one above. */
export function failedDeliveryNotice(failure: {
  channel: string;
  failedCount: number;
  heldForReview?: boolean;
  attemptedWithoutOutcome?: boolean;
}): string {
  const name = CHANNEL_NAMES[failure.channel] ?? failure.channel;
  const alerts = failure.failedCount === 1 ? "alert" : "alerts";
  const have = failure.failedCount === 1 ? "has" : "have";
  // UNCONFIRMED, NOT UNDELIVERED.
  const lead = `${failure.failedCount} ${name} ${alerts} for this event ${have} not been confirmed as delivered.`;
  // Read from the plans the FAILED ROWS hang off, not from the latest plan, which is what `planStale` describes.
  if (failure.heldForReview !== true) {
    return (
      `${lead} PopEngine keeps retrying them. If the ${name} address below is wrong, correcting ` +
      `it will redirect the alerts that have not gone out.`
    );
  }
  const paused =
    `${lead} Retrying is paused because this event changed after their plan was made: ` +
    `regenerate the plan and review the checklist to start it again.`;
  // AND THE ACTION DOES NOT ALWAYS WORK, which the sentence above promised it did.
  return failure.attemptedWithoutOutcome === true
    ? `${paused} That will not restart any that were already attempted with no outcome recorded: ` +
        `those stay paused until someone checks with the sending service, or until PopEngine's ` +
        `own wait on them runs out.`
    : paused;
}

/** An alert PopEngine has stopped on, said as stopping rather than as failing. */
export function reconciliationHoldNotice(hold: { channel: string; heldCount: number }): string {
  const name = CHANNEL_NAMES[hold.channel] ?? hold.channel;
  const one = hold.heldCount === 1;
  const alerts = one ? "alert" : "alerts";
  const were = one ? "was" : "were";
  const them = one ? "it" : "them";
  const they = one ? "it" : "they";
  const their = one ? "its" : "their";
  const dates = one ? "the filing date it covers" : "the filing dates they cover";
  const attempted = one ? "an attempted send" : "attempted sends";
  return (
    `${hold.heldCount} ${name} ${alerts} for this event ${were} recorded as ${attempted}, and no ` +
    `outcome ever came back: PopEngine cannot tell whether ${they} reached the sending service ` +
    `at all. Too much time has passed to try ${them} again straight away without risking a second ` +
    `copy, so PopEngine has paused ${them}: nothing on ${their} current schedule sends ${them} ` +
    `again for now. Someone can check with the sending service whether ${they} went out, and what ` +
    `that check records decides whether this schedule sends ${them} sooner; if nobody does, ` +
    `PopEngine tries once more when the pause ends, and that may arrive as a second copy. Until ` +
    `then, do not count on ${them} to remind you of ${dates}.`
  );
}

export function ChecklistView({ apiBaseUrl, eventId }: { apiBaseUrl: string; eventId: string }) {
  const [state, setState] = useState<ChecklistState>({ status: "loading" });
  const [creating, setCreating] = useState(false);
  const [creationFailure, setCreationFailure] = useState<string | null>(null);
  /** What the api's own rules file says about itself, or null when it could not be read. */
  const [meta, setMeta] = useState<RulesMetaResponse | null>(null);

  /** Where this event's deadline alerts go, as the organizer is editing it. */
  const [contacts, setContacts] = useState<{ email: string; phone: string }>({
    email: "",
    phone: "",
  });

  /**
   * Which event this page is showing. The create handler runs outside the effect, so it cannot
   * rely on the effect's cleanup: it re-checks this after its await and drops the result if the
   * page has moved to another event in the meantime.
   */
  const showing = `${apiBaseUrl}|${eventId}`;
  const active = useRef(showing);

  /** Which re-read a reload belongs to, and which one is on screen. */
  const writeEpoch = useRef(0);
  const appliedEpoch = useRef(0);

  /** Re-reads scheduled after a conversion, so a delivery failure can reach the screen it is for. */
  const deliveryReads = useRef<ReturnType<typeof setTimeout>[]>([]);
  const ALERT_POLL_INTERVAL_MS = 60_000;
  const ALERT_DELIVERY_BOUND_MS = 120_000;

  useEffect(() => {
    active.current = showing;
    let abandoned = false;

    // Everything on screen belongs to one event, so navigating clears it before the new request
    // runs. One organizer's checklist must never be read under another event's id.
    setState({ status: "loading" });
    setCreationFailure(null);
    setCreating(false);
    // Reload epochs belong to the checklist that was on screen, not to the one arriving.
    writeEpoch.current = 0;
    appliedEpoch.current = 0;

    setMeta(null);
    // A contact belongs to one event, so it is cleared on the way in for the same reason the
    // items are: nothing of one organizer's event may render under another's id.
    setContacts({ email: "", phone: "" });

    void loadChecklist(apiBaseUrl, eventId).then((result) => {
      if (abandoned) return;
      setState(stateFrom(result));
      // Seeded from what is stored, so the boxes show what alerts are actually going to and a
      // review that changes nothing else re-states the same contact rather than clearing it.
      if (result.ok) {
        setContacts({
          email: result.checklist.alertContacts.email ?? "",
          phone: result.checklist.alertContacts.phone ?? "",
        });
      }
    });

    // The checklist never waits for this: the banner states its plan's own pinned pair without it,
    // and the live version only decides whether a newer ruleset exists.
    void loadRulesMeta(apiBaseUrl).then((result) => {
      if (abandoned) return;
      if (result.ok) setMeta(result.meta);
    });

    return () => {
      abandoned = true;
      // One organizer's pending re-read must never land on another organizer's checklist.
      for (const timer of deliveryReads.current.splice(0)) clearTimeout(timer);
    };
  }, [apiBaseUrl, eventId, showing]);

  /** Convert the latest plan into a checklist, and re-run the same call to review it after a regeneration. */
  const convert = async (displayedPlanId: string) => {
    const requested = showing;
    setCreating(true);
    setCreationFailure(null);

    const result = await createChecklist(apiBaseUrl, eventId, displayedPlanId, contacts);
    if (active.current !== requested) return;
    if (!result.ok) {
      // Superseded is not a failure to report and stop at: the plan moved while this page was being read, NOTHING was recorded, and the organizer needs the newer plan in front of them to review it.
      if (result.superseded === true) {
        const reloadFailure = await reload(requested);
        setCreationFailure(
          reloadFailure ??
            "The plan changed while you were reading it, so nothing was recorded. " +
              "The current plan is now shown — review it and press the button again.",
        );
        setCreating(false);
        return;
      }
      setCreationFailure(result.message);
      setCreating(false);
      return;
    }
    // The conversion's own response is NOT installed, even though it is the checklist the api just wrote.
    setCreationFailure(await reload(requested));
    setCreating(false);

    // Only when there is somewhere for an alert to go. With no contact the api schedules nothing
    // and says so, and there is no delivery whose failure could arrive later.
    if (contacts.email.trim() !== "" || contacts.phone.trim() !== "") {
      for (const timer of deliveryReads.current.splice(0)) clearTimeout(timer);
      for (const delay of [ALERT_POLL_INTERVAL_MS, ALERT_DELIVERY_BOUND_MS]) {
        deliveryReads.current.push(
          setTimeout(() => {
            // Through the same epoch-ordered re-read as every other refresh, so a late one cannot
            // put stale counts back over a status the organizer has changed since.
            void reload(requested);
          }, delay),
        );
      }
    }
  };

  /** Re-read the whole checklist after a write, and report what stopped that from working. */
  const reload = async (requested: string): Promise<string | null> => {
    const epoch = ++writeEpoch.current;
    const result = await loadChecklist(apiBaseUrl, eventId);
    if (active.current !== requested) return null;
    // An older reload landing after a newer one must not put the older answer back on screen.
    if (epoch < appliedEpoch.current) return null;
    appliedEpoch.current = epoch;
    if (!result.ok) {
      return `The change was saved, but the checklist could not be reloaded: ${result.message}`;
    }
    setState({ status: "ready", checklist: result.checklist });
    return null;
  };

  const setStatus = async (itemId: string, status: ChecklistStatus): Promise<string | null> => {
    const requested = showing;
    const result = await updateChecklistItem(apiBaseUrl, itemId, { status });
    if (!result.ok) return result.message;
    return reload(requested);
  };

  const saveNotes = async (itemId: string, notes: string): Promise<string | null> => {
    const requested = showing;
    const result = await updateChecklistItem(apiBaseUrl, itemId, { notes });
    if (!result.ok) return result.message;
    return reload(requested);
  };

  const upload = async (itemId: string, file: File) => {
    const requested = showing;
    const result = await uploadDocument(apiBaseUrl, itemId, file);
    if (result.ok) {
      const failure = await reload(requested);
      // The document is stored either way; a reload that failed is not a resend.
      return failure === null ? null : { message: failure, outcome: "stored" as const };
    }
    // An api that stored nothing needs no reconciling: the row is exactly as it was.
    if (result.outcome === "not_stored")
      return { message: result.message, outcome: result.outcome };

    // Anything else may be on the item already, so the checklist is re-read and the list shown rather than guessed at.
    const failure = await reload(requested);
    return {
      message:
        failure === null
          ? `${result.message} The checklist has been refreshed; it may not show an upload that is still finishing.`
          : `${result.message} The checklist could not be refreshed either: ${failure}`,
      outcome: result.outcome,
    };
  };

  /** Follow a document's short-lived signed URL. */
  const download = async (documentId: string): Promise<string | null> => {
    const target = window.open("", "_blank");
    if (target !== null) target.opener = null;

    const result = await documentUrl(apiBaseUrl, documentId);
    if (!result.ok) {
      target?.close();
      return result.message;
    }
    if (target === null || target.closed) {
      return "The download was blocked by the browser. Allow pop-ups for this site and try again.";
    }
    target.location.href = result.url;
    return null;
  };

  if (state.status === "loading") {
    return (
      <main className="checklist">
        <p className="pe-eyebrow">PopEngine · Checklist</p>
        <p className="intake__lede" role="status">
          Loading your checklist…
        </p>
      </main>
    );
  }

  if (state.status !== "ready") {
    return (
      <main className="checklist">
        <p className="pe-eyebrow">PopEngine · Checklist</p>
        <h1>Your compliance checklist</h1>
        <p className="intake__error" role="alert">
          {state.message}
        </p>
        {/* A checklist is built from a plan, so the answer to "there is no plan" is the plan
            view, not a button here that would have nothing to convert. */}
        {state.status === "no_plan" && (
          <p className="checklist__lede">
            <a href={`/events/${eventId}/plan`}>Generate the permit plan first</a>
          </p>
        )}
      </main>
    );
  }

  const { checklist } = state;
  const currentPlan: SourcePlan = {
    rulesetVersion: checklist.rulesetVersion,
    snapshotDate: checklist.snapshotDate,
  };
  const rollup = rollupOf(checklist.statusRollup);
  // Only "newer" is actionable.
  const supersededRuleset =
    meta !== null && compareToPinned(meta.ruleset_version, checklist.rulesetVersion) === "newer";
  const blockers = [
    ...checklist.items.filter((item) => item.disposition === "prohibited_or_ineligible"),
    ...checklist.contextItems.filter(
      (context) => context.disposition === "prohibited_or_ineligible",
    ),
  ];
  const taskItems = checklist.items.filter(
    (item) => item.disposition !== "prohibited_or_ineligible",
  );
  const advisoryContext = checklist.contextItems.filter(
    (context) => context.disposition !== "prohibited_or_ineligible",
  );
  const retained = taskItems.filter((item) => item.struckThrough).length;

  return (
    <main className="checklist">
      <p className="pe-eyebrow">PopEngine · Checklist</p>
      <h1>Your compliance checklist</h1>

      {/* The snapshot the rows below are read against, both values off the checklist's own current
          plan. Rows from a different snapshot state their own beneath them; rows from this one do
          not repeat it. `meta` supplies the live-versus-pinned comparison only — it is not where
          either displayed value comes from (F-206 AC 4). */}
      <SnapshotBanner
        rulesetVersion={checklist.rulesetVersion}
        snapshotDate={checklist.snapshotDate}
        meta={meta}
      />

      {/* The banner names an action, so the page says where it lives. Regenerating is the plan
          view's, not the checklist's: this view converts a plan, it does not produce one. Saying a
          newer ruleset exists and leaving an organizer to find the button is the failure the plan
          view already recorded about its own banner. */}
      {supersededRuleset && (
        <p className="checklist__lede">
          A newer ruleset is published than the one this plan pinned.{" "}
          <a href={`/events/${eventId}/plan`}>Regenerate the plan</a> to rebuild the checklist
          against it.
        </p>
      )}

      {/* AD-13: a plan pins the revision it evaluated. If the event has moved on, these
          requirements answer an intake the organizer has already replaced, and the api refuses to
          materialize them — so the page says why rather than offering a button that 409s. */}
      {checklist.planStale && (
        <p className="checklist__flag" role="alert">
          The event has been edited since this plan was generated, so the plan no longer matches it.{" "}
          <a href={`/events/${eventId}/plan`}>Regenerate the plan</a> before converting it.
        </p>
      )}

      {/* AC 6: the plan was regenerated after this checklist was built. Everything is kept — new
          requirements are appended and dropped ones are struck through — and reviewing is the
          same idempotent conversion call. */}
      {checklist.created && checklist.planChanged && (
        <p className="checklist__flag" role="alert">
          The plan has changed; review items. Nothing has been removed: requirements the new plan no
          longer raises are struck through below, and new ones are added when you review.
        </p>
      )}

      {/* AC 5: an alert channel that reported sent without delivering. Placed with the other flags
          rather than beside a requirement, because it is a fact about this event's alerts as a
          whole and not about any one filing — and an organizer who reads nothing else on this page
          still has to learn that a message they are counting on did not arrive. */}
      {checklist.simulatedAlertDeliveries.map((delivery) => (
        <p className="checklist__flag" role="alert" key={delivery.channel}>
          {simulatedDeliveryNotice(delivery)}
        </p>
      ))}

      {/* A channel that tried to send and failed. Its own block rather than folded into the one
          above: "switched off by design" and "attempted and did not arrive" are different facts,
          and an organizer needs to tell them apart. F-203 exists so a filing deadline does not
          pass unnoticed, and an alert failing silently is precisely that — until this, nothing on
          any surface said so. Nothing renders when no failure was observed, because an empty
          count is not evidence the channel works. */}
      {checklist.failedAlertDeliveries.map((failure) => (
        <p className="checklist__flag" role="alert" key={`failed-${failure.channel}`}>
          {failedDeliveryNotice(failure)}
        </p>
      ))}

      {/* A channel PopEngine has stopped on, which is a third fact and not a louder version of the
          one above. Failing means being retried; this means nobody will try again until a person
          checks with the sending service. Both can be true of the same channel at once, which is
          why they are separate blocks rather than a branch inside one sentence. */}
      {checklist.alertsHeldForReconciliation.map((hold) => (
        <p className="checklist__flag" role="alert" key={`held-${hold.channel}`}>
          {reconciliationHoldNotice(hold)}
        </p>
      ))}

      {/* THE CONTACT OUTLIVES THE CONVERSION, so it is not rendered by the conversion's condition.
          Both used to hang off "there is something to convert", which meant that the moment a
          checklist was current the inputs and the only button that submits them disappeared: an
          organizer who mistyped an address had no way to correct it, and the alerts already
          scheduled went on retrying the unusable one until some unrelated regeneration happened to
          bring the button back. `planStale` still hides it, because the api refuses the POST in
          that state and a control that cannot succeed is worse than none. */}
      {!checklist.planStale && (
        <div className="checklist__actions">
          {/* F-203: where the deadline reminders go. Collected at conversion because that is the
              moment the spec collects it, and editable afterwards because an address is a fact
              about the event rather than about that one click. Left blank, no alerts are scheduled
              and the api says so; there is no account to fall back on in the MVP. */}
          <label className="intake__label" htmlFor="alert-email">
            Email for deadline reminders
          </label>
          <input
            id="alert-email"
            className="intake__input"
            type="email"
            value={contacts.email}
            onChange={(event) => setContacts({ ...contacts, email: event.target.value })}
          />
          <label className="intake__label" htmlFor="alert-phone">
            Mobile number (optional)
          </label>
          <input
            id="alert-phone"
            className="intake__input"
            type="tel"
            value={contacts.phone}
            onChange={(event) => setContacts({ ...contacts, phone: event.target.value })}
          />
          {/* Said before they type it, not after a message fails to arrive. A number entered on
              the strength of an unqualified "mobile number" box would be one the organizer is
              relying on, and text sending is not switched on yet.

              WRITTEN FROM THIS EVENT'S CONTACTS, NOT FROM WHAT THE FEATURE CAN DO. Both contact
              columns are nullable and the scheduler only takes channels that have a destination, so
              phone-only is a supported configuration in which NO email alert is scheduled at all.
              The unconditional version reassured that organizer about a delivery path they do not
              have, which is the worst version of this sentence: it is read by exactly the person
              for whom it is false.

              The alternative was to require an email before offering reminders, and it is the wrong
              trade. The schema permits phone-only deliberately, and refusing to store a number
              until an address exists would break a configuration the api supports in order to make
              one sentence easier to write. Saying what the current pair produces costs nothing and
              tells the organizer something they can act on.

              Tense, since it differs from the two notices above: those describe what HAS happened
              and read it off the alert rows, while this describes what the form will produce and
              reads it off the inputs. Both are state; only the state differs.

              AND IT PROMISES ROUTING, NOT ARRIVAL, which is the second half and the one the first
              pass missed. There are three things this sentence could key on and they are not the
              same question: whether a CONTACT exists, whether the SENDER is configured, and whether
              rows were actually SCHEDULED. Keying on the contact alone still told an organizer with
              a perfectly good address that their reminders go to their email while
              `sendersFromEnv` had selected `unconfiguredEmailSender`, which is the supported bare
              and local configuration, and every one of those alerts fails and retries.

              The page cannot key on the sender, and that is not an oversight to fix here: the
              checklist response reports contacts and rows and says nothing about provider
              credentials. `simulatedDeliveryNotice` above already refuses to reassure for exactly
              this reason, in a comment written in round 7, and this sentence was breaking that rule
              one function below where it is stated.

              So it says where reminders are ADDRESSED, which the contacts settle on their own, and
              claims nothing about arrival. What did not arrive is the failed-delivery notice's job,
              and that one counts real rows. */}
          <p className="checklist__lede">
            {contacts.email.trim() === ""
              ? "Text messages are not being sent yet, and no email address is set, so no deadline reminders will be delivered. Add an email address to receive them. A number entered now is stored for when text sending is switched on."
              : "Text messages are not being sent yet, so deadline reminders are addressed to your email instead. A number entered now is stored for when text sending is switched on."}
          </p>
          {/* One endpoint, one button, because the conversion IS idempotent: posting the plan the
              page is showing when nothing has changed creates nothing and records the contact.
              What changes is what the button honestly says it will do. */}
          <button
            className="intake__submit"
            type="button"
            onClick={() => void convert(checklist.planId)}
            disabled={creating}
          >
            {creating
              ? "Working…"
              : !checklist.created
                ? "Create the checklist from this plan"
                : checklist.planChanged
                  ? "Review items against the current plan"
                  : "Save contact details"}
          </button>
        </div>
      )}

      {creationFailure !== null && (
        <p className="intake__error" role="alert">
          {creationFailure}
        </p>
      )}

      {checklist.created && (
        <p className="checklist__rollup" aria-live="polite">
          {rollup.length === 0
            ? "No trackable requirements in the current plan."
            : rollup.map(([status, count]) => `${count} ${humanize(status)}`).join(" · ")}
          {/* Counted and labelled separately, so a rollup covering only current-plan rows never
              looks like it has omitted the retained rows visible beneath it (AC 2). */}
          {retained > 0 && ` · plus ${retained} retained from an earlier plan, not counted above`}
        </p>
      )}

      {checklist.created && taskItems.length === 0 && (
        /* The synthetic zero-trackable-items case: creation was offered and ran, and it produced
           an empty checklist rather than a failure. The read-only context below is the rest of
           what the plan says. */
        <p className="checklist__empty">
          Nothing to track; keep confirmation notes here if you like.
        </p>
      )}

      {blockers.length > 0 && (
        <section className="checklist__group" aria-labelledby="checklist-blockers-heading">
          <h2 id="checklist-blockers-heading">Blockers</h2>
          {blockers.map((context) => (
            <ContextLine
              key={context.ruleIds.join("+")}
              context={context}
              currentPlan={currentPlan}
            />
          ))}
        </section>
      )}

      {taskItems.length > 0 && (
        <section className="checklist__group" aria-labelledby="checklist-tasks-heading">
          <h2 id="checklist-tasks-heading">Permit and insurance tasks</h2>
          {taskItems.map((item) => (
            <ChecklistItemCard
              key={item.id}
              item={item}
              currentPlan={currentPlan}
              onStatusChange={(status) => setStatus(item.id, status)}
              onNotesSave={(notes) => saveNotes(item.id, notes)}
              onUpload={(file) => upload(item.id, file)}
              onDownload={download}
            />
          ))}
        </section>
      )}

      {advisoryContext.length > 0 && (
        <section className="checklist__group" aria-labelledby="checklist-context-heading">
          <h2 id="checklist-context-heading">Advisories and notifications</h2>
          {advisoryContext.map((context) => (
            <ContextLine
              key={context.ruleIds.join("+")}
              context={context}
              currentPlan={currentPlan}
            />
          ))}
        </section>
      )}
    </main>
  );
}
