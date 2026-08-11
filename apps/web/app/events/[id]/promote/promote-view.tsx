"use client";

import { useEffect, useState } from "react";
import { loadPromoteState, savePromoteState, type PromoteState } from "./promote-api";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type PromoteViewProps = {
  eventId: string;
  apiBaseUrl: string;
  /** Optional absolute origin override; defaults to `window.location.origin`. */
  webOrigin?: string;
};

export function PromoteView({ eventId, apiBaseUrl, webOrigin }: PromoteViewProps) {
  const [state, setState] = useState<PromoteState | null>(null);
  const [description, setDescription] = useState("");
  const [failure, setFailure] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [browserOrigin, setBrowserOrigin] = useState("");

  useEffect(() => {
    if (webOrigin === undefined || webOrigin.trim() === "") {
      setBrowserOrigin(window.location.origin);
    }
  }, [webOrigin]);

  useEffect(() => {
    if (!UUID.test(eventId)) {
      setFailure("That event link is not valid.");
      return;
    }
    let cancelled = false;
    void loadPromoteState(apiBaseUrl, eventId).then((result) => {
      if (cancelled) return;
      if (!result.ok) {
        setFailure(result.message);
        return;
      }
      setState(result.state);
      setDescription(result.state.description ?? "");
    });
    return () => {
      cancelled = true;
    };
  }, [apiBaseUrl, eventId]);

  if (failure !== null && state === null) {
    return (
      <main className="promote">
        <p className="pe-eyebrow">PopEngine · Promote</p>
        <h1>Promote</h1>
        <p className="promote__error" role="alert">
          {failure}
        </p>
      </main>
    );
  }

  if (state === null) {
    return (
      <main className="promote">
        <p className="pe-eyebrow">PopEngine · Promote</p>
        <p className="promote__lede" role="status">
          Loading promote controls…
        </p>
      </main>
    );
  }

  const origin = (
    webOrigin !== undefined && webOrigin.trim() !== "" ? webOrigin : browserOrigin
  ).replace(/\/$/, "");
  const shareUrl = origin.length > 0 ? `${origin}${state.public_path}` : state.public_path;

  const persist = async (patch: {
    description?: string | null;
    public_page_published?: boolean;
  }) => {
    setFailure(null);
    setStatusMessage(null);
    setSaving(true);
    const result = await savePromoteState(apiBaseUrl, eventId, patch);
    setSaving(false);
    if (!result.ok) {
      setFailure(result.message);
      return;
    }
    setState(result.state);
    setDescription(result.state.description ?? "");
    setStatusMessage(
      result.state.public_page_published ? "Public page is live." : "Page unpublished.",
    );
  };

  return (
    <main className="promote">
      <p className="pe-eyebrow">PopEngine · Promote</p>
      <h1>{state.title}</h1>
      <p className="promote__lede">
        Public event page · {state.event_date}
        {state.venue !== null ? ` · ${state.venue}` : ""}
      </p>

      {state.infeasible_warning && (
        <p className="promote__warning" role="status">
          The latest plan is infeasible (published deadline missed as scoped). You can still publish
          — that call is yours.
        </p>
      )}

      {!state.plan_available && (
        <p className="promote__warning" role="status">
          Generate a permit plan before publishing this page.{" "}
          <a href={`/events/${eventId}/plan`}>Open permit plan</a>
        </p>
      )}

      <label className="promote__field">
        <span className="promote__label">Description</span>
        <textarea
          className="promote__textarea"
          value={description}
          onChange={(change) => setDescription(change.target.value)}
        />
      </label>

      <div className="promote__row">
        <button
          type="button"
          className="promote__button"
          disabled={saving}
          onClick={() => {
            void persist({ description: description.trim() === "" ? null : description.trim() });
          }}
        >
          {saving ? "Saving…" : "Save description"}
        </button>
        <button
          type="button"
          className="promote__button promote__secondary"
          disabled={saving || (!state.plan_available && !state.public_page_published)}
          onClick={() => {
            void persist({
              description: description.trim() === "" ? null : description.trim(),
              public_page_published: !state.public_page_published,
            });
          }}
        >
          {state.public_page_published ? "Unpublish page" : "Publish page"}
        </button>
      </div>

      <p className="promote__note">
        Status: {state.public_page_published ? "published" : "unpublished"}
      </p>
      <p className="promote__share">{shareUrl}</p>
      <div className="promote__row">
        <button
          type="button"
          className="promote__button promote__secondary"
          onClick={() => {
            void (async () => {
              setFailure(null);
              setStatusMessage(null);
              if (typeof navigator.clipboard?.writeText !== "function") {
                setFailure("Copy isn't available here — select the link above.");
                return;
              }
              try {
                await navigator.clipboard.writeText(shareUrl);
                setStatusMessage("Link copied.");
              } catch {
                setFailure("Couldn't copy the link — select and copy it from above.");
              }
            })();
          }}
        >
          Copy link
        </button>
        <a href={state.public_path}>Open public page</a>
        <a href={`/events/${eventId}/guests`}>Guest list</a>
        <a href={`/events/${eventId}/dashboard`}>Live ops</a>
        <a href={`/intake/${eventId}`}>Edit intake</a>
      </div>

      {failure !== null && (
        <p className="promote__error" role="alert">
          {failure}
        </p>
      )}
      {statusMessage !== null && (
        <p className="promote__lede" role="status">
          {statusMessage}
        </p>
      )}
      <p className="promote__note">Synthetic demo only (AD-12).</p>
    </main>
  );
}
