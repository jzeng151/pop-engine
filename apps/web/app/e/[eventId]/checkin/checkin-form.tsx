"use client";

import { useEffect, useState } from "react";
import { loadCheckinEvent, submitCheckin } from "./checkin-api";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type CheckinFormProps = {
  eventId: string;
  apiBaseUrl: string;
};

type Phase =
  | { kind: "loading" }
  | { kind: "invalid"; message: string }
  | { kind: "form"; eventName: string }
  | { kind: "success"; name: string; eventName: string };

export function CheckinForm({ eventId, apiBaseUrl }: CheckinFormProps) {
  const [phase, setPhase] = useState<Phase>(() =>
    UUID.test(eventId)
      ? { kind: "loading" }
      : { kind: "invalid", message: "That check-in link is not valid." },
  );
  const [name, setName] = useState("");
  const [contact, setContact] = useState("");
  const [failure, setFailure] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!UUID.test(eventId)) return;
    let cancelled = false;
    void loadCheckinEvent(apiBaseUrl, eventId).then((result) => {
      if (cancelled) return;
      if (!result.ok) {
        setPhase({ kind: "invalid", message: result.message });
        return;
      }
      setPhase({ kind: "form", eventName: result.name });
    });
    return () => {
      cancelled = true;
    };
  }, [apiBaseUrl, eventId]);

  if (phase.kind === "loading") {
    return (
      <div className="checkin">
        <p className="checkin__lede" role="status">
          Opening check-in…
        </p>
      </div>
    );
  }

  if (phase.kind === "invalid") {
    return (
      <div className="checkin">
        <h1 className="checkin__title">Check-in unavailable</h1>
        <p className="checkin__error" role="alert">
          {phase.message}
        </p>
        <p className="checkin__note">
          Ask a staff member for a current QR code. Demo data only (AD-12).
        </p>
      </div>
    );
  }

  if (phase.kind === "success") {
    return (
      <div className="checkin checkin__success" role="status">
        <p className="pe-eyebrow">{phase.eventName}</p>
        <h1>You&rsquo;re checked in, {phase.name}</h1>
        <p className="checkin__lede">Thanks for coming. Show this screen if a host asks.</p>
        <p className="checkin__note">Synthetic demo data only — not a production guest list.</p>
      </div>
    );
  }

  const save = async () => {
    setFailure(null);
    setSubmitting(true);
    const result = await submitCheckin(apiBaseUrl, eventId, { name, contact });
    setSubmitting(false);
    if (!result.ok) {
      setFailure(result.message);
      return;
    }
    setPhase({
      kind: "success",
      name: result.checkin.name,
      eventName: phase.eventName,
    });
  };

  return (
    <form
      className="checkin"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <p className="pe-eyebrow">{phase.eventName}</p>
      <h1 className="checkin__title">Check in</h1>
      <p className="checkin__lede">Two fields. No account. No app install.</p>

      <label className="checkin__field">
        <span className="checkin__label">Name</span>
        <input
          className="checkin__input"
          name="name"
          autoComplete="name"
          required
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
      </label>

      <label className="checkin__field">
        <span className="checkin__label">Email or phone</span>
        <input
          className="checkin__input"
          name="contact"
          autoComplete="email"
          inputMode="email"
          required
          value={contact}
          onChange={(event) => setContact(event.target.value)}
        />
      </label>

      {failure !== null && (
        <p className="checkin__error" role="alert">
          {failure}
        </p>
      )}

      <button className="checkin__submit" type="submit" disabled={submitting}>
        {submitting ? "Checking in…" : "Check in"}
      </button>

      <p className="checkin__note">
        Use a synthetic name and contact for this demo (AD-12). Do not enter real attendee PII.
      </p>
    </form>
  );
}
