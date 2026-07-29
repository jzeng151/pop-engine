"use client";

import { useEffect, useState } from "react";
import { loadPublicEvent, submitPublicRsvp, type PublicEvent } from "./public-api";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type EventPageViewProps = {
  eventId: string;
  apiBaseUrl: string;
};

export function EventPageView({ eventId, apiBaseUrl }: EventPageViewProps) {
  const [event, setEvent] = useState<PublicEvent | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [rsvpMessage, setRsvpMessage] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!UUID.test(eventId)) {
      setFailure("That event link is not valid.");
      return;
    }
    let cancelled = false;
    void loadPublicEvent(apiBaseUrl, eventId).then((result) => {
      if (cancelled) return;
      if (!result.ok) {
        setFailure(result.message);
        return;
      }
      setEvent(result.event);
    });
    return () => {
      cancelled = true;
    };
  }, [apiBaseUrl, eventId]);

  if (failure !== null && event === null) {
    return (
      <div className="event-page">
        <h1 className="event-page__title">Event unavailable</h1>
        <p className="event-page__error" role="alert">
          {failure}
        </p>
        <p className="event-page__note">
          Ask the organizer for a current link. Demo data only (AD-12).
        </p>
      </div>
    );
  }

  if (event === null) {
    return (
      <div className="event-page">
        <p className="event-page__lede" role="status">
          Opening event…
        </p>
      </div>
    );
  }

  const venueLabel = event.venue ?? event.borough.replace(/_/g, " ");

  const saveRsvp = async () => {
    setRsvpMessage(null);
    setFailure(null);
    setSubmitting(true);
    const result = await submitPublicRsvp(apiBaseUrl, eventId, {
      name,
      email,
      phone: phone.trim() === "" ? undefined : phone,
    });
    setSubmitting(false);
    if (!result.ok) {
      setFailure(result.message);
      return;
    }
    setRsvpMessage(`You're on the list, ${name.trim()}.`);
    setName("");
    setEmail("");
    setPhone("");
  };

  return (
    <div className="event-page">
      <p className="pe-eyebrow">{event.event_date}</p>
      <h1 className="event-page__title">{event.title}</h1>
      <p className="event-page__lede">{venueLabel}</p>
      {event.description !== null && event.description.length > 0 && (
        <p className="event-page__lede">{event.description}</p>
      )}
      {event.map_url !== null && (
        <p>
          <a className="event-page__map" href={event.map_url} target="_blank" rel="noreferrer">
            Open map
          </a>
        </p>
      )}

      {event.rsvp_enabled && (
        <form
          onSubmit={(submitEvent) => {
            submitEvent.preventDefault();
            void saveRsvp();
          }}
        >
          <h2 className="pe-eyebrow">RSVP</h2>
          <label className="event-page__field">
            <span className="event-page__label">Name</span>
            <input
              className="event-page__input"
              name="name"
              required
              autoComplete="name"
              value={name}
              onChange={(change) => setName(change.target.value)}
            />
          </label>
          <label className="event-page__field">
            <span className="event-page__label">Email</span>
            <input
              className="event-page__input"
              name="email"
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(change) => setEmail(change.target.value)}
            />
          </label>
          <label className="event-page__field">
            <span className="event-page__label">Phone (optional)</span>
            <input
              className="event-page__input"
              name="phone"
              autoComplete="tel"
              value={phone}
              onChange={(change) => setPhone(change.target.value)}
            />
          </label>
          {failure !== null && (
            <p className="event-page__error" role="alert">
              {failure}
            </p>
          )}
          {rsvpMessage !== null && (
            <p className="event-page__success" role="status">
              {rsvpMessage}
            </p>
          )}
          <button className="event-page__submit" type="submit" disabled={submitting}>
            {submitting ? "Saving…" : "RSVP"}
          </button>
          <p className="event-page__note">
            Synthetic demo contacts only (AD-12). No account required.
          </p>
        </form>
      )}
    </div>
  );
}
