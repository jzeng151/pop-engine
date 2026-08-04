"use client";

import { useEffect, useRef, useState } from "react";
import { cancelGuest, loadGuestList, type GuestList } from "./guests-api";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type GuestListProps = {
  eventId: string;
  apiBaseUrl: string;
};

export function GuestListView({ eventId, apiBaseUrl }: GuestListProps) {
  const [list, setList] = useState<GuestList | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [cancellingIds, setCancellingIds] = useState<ReadonlySet<string>>(() => new Set());
  // Request epoch vs last successfully applied reload — a failed newer cancel must not
  // discard an older cancel that already refreshed the authoritative list.
  const listEpoch = useRef(0);
  const appliedEpoch = useRef(0);

  useEffect(() => {
    if (!UUID.test(eventId)) {
      setFailure("That event link is not valid.");
      return;
    }
    let cancelled = false;
    void loadGuestList(apiBaseUrl, eventId).then((result) => {
      if (cancelled) return;
      if (!result.ok) {
        setFailure(result.message);
        return;
      }
      setList(result.list);
    });
    return () => {
      cancelled = true;
    };
  }, [apiBaseUrl, eventId]);

  if (failure !== null && list === null) {
    return (
      <main className="guests">
        <p className="pe-eyebrow">PopEngine · Guests</p>
        <h1>Guest list</h1>
        <p className="guests__error" role="alert">
          {failure}
        </p>
      </main>
    );
  }

  if (list === null) {
    return (
      <main className="guests">
        <p className="pe-eyebrow">PopEngine · Guests</p>
        <p className="guests__lede" role="status">
          Loading guest list…
        </p>
      </main>
    );
  }

  const onCancel = async (rsvpId: string) => {
    setFailure(null);
    const epoch = ++listEpoch.current;
    setCancellingIds((prev) => new Set(prev).add(rsvpId));
    const result = await cancelGuest(apiBaseUrl, eventId, rsvpId);
    setCancellingIds((prev) => {
      const next = new Set(prev);
      next.delete(rsvpId);
      return next;
    });
    if (!result.ok) {
      setFailure(result.message);
      return;
    }
    if (epoch > appliedEpoch.current) {
      appliedEpoch.current = epoch;
      setList(result.list);
    }
  };

  return (
    <main className="guests">
      <p className="pe-eyebrow">PopEngine · Guests</p>
      <h1>{list.event.name}</h1>
      <p className="guests__lede">Guest list · {list.event.event_date}</p>
      <p className="guests__count" aria-live="polite">
        {list.event.capacity === null
          ? `${list.confirmed_count} confirmed`
          : `${list.confirmed_count} of ${list.event.capacity} confirmed`}
      </p>
      <p className="guests__note">
        {/* Source-neutral on purpose: during the rollout window `readLimit` may have taken this
            number from a pre-rename API's `headcount`, so naming it a confirmed capacity would
            state something the responding API has not. */}
        Synthetic demo data only (AD-12). Admission uses the event's current admission limit; with
        none set there is no limit. Guests RSVP from the published public event page.{" "}
        <a href={`/events/${eventId}/promote`}>Promote / publish</a>
        {" · "}
        <a href={`/events/${eventId}/dashboard`}>Live ops</a>
        {" · "}
        <a href={`/intake/${eventId}`}>Edit intake</a>
      </p>

      {failure !== null && (
        <p className="guests__error" role="alert">
          {failure}
        </p>
      )}

      {list.rsvps.length === 0 ? (
        <p className="guests__empty">No RSVPs yet.</p>
      ) : (
        <ul className="guests__list">
          {list.rsvps.map((rsvp) => (
            <li
              key={rsvp.id}
              className={
                rsvp.status === "cancelled" ? "guests__row guests__cancelled" : "guests__row"
              }
            >
              <div className="guests__identity">
                <span className="guests__name">{rsvp.name}</span>
                <span className="guests__meta">
                  {rsvp.email}
                  {rsvp.phone !== null ? ` · ${rsvp.phone}` : ""}
                  {rsvp.status === "cancelled" ? " · cancelled" : ""}
                </span>
              </div>
              {rsvp.status === "confirmed" && (
                <button
                  type="button"
                  className="guests__cancel"
                  disabled={cancellingIds.has(rsvp.id)}
                  onClick={() => {
                    void onCancel(rsvp.id);
                  }}
                >
                  {cancellingIds.has(rsvp.id) ? "Cancelling…" : "Cancel RSVP"}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
