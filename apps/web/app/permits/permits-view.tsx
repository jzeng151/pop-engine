"use client";

import { useEffect, useRef, useState } from "react";
import {
  ACCEPTED_DOCUMENT_TYPES,
  documentRejection,
  documentUrl,
  uploadDocument,
} from "../checklist/checklist-api";
import {
  loadObtainedPermits,
  recordPermit,
  type ObtainedPermit,
  type ObtainedPermitsResponse,
} from "./permits-api";

// DEMO SCOPE. The "Obtained permits" view: what the organizer already holds, as they recorded it.
// This is NOT F-208 and will be superseded by it. It has no spec and computes no verdict.
//
// THE ONE RULE THIS FILE KEEPS, and it is the reason the copy below reads the way it does: the
// product must never state a permit fact it cannot back. So every sentence here either reports a
// value the organizer entered, attributed to them, or says that they entered none. Nothing on this
// page passes judgement on what an event needs: `Verdict` has no such value, and this screen
// evaluates nothing in the first place. It displays a record.

type ViewState =
  | { status: "loading" }
  | { status: "unavailable"; message: string }
  | { status: "ready"; permits: ObtainedPermitsResponse };

/** The three things an expiry field can be, said in words rather than by colour. */
function expiryLine(permit: ObtainedPermit, asOf: string): string {
  if (permit.expiresOn === null) return "You have not recorded an expiry date.";
  if (permit.expired === true) {
    return `The expiry date you recorded, ${permit.expiresOn}, has passed as of ${asOf}.`;
  }
  return `You recorded an expiry date of ${permit.expiresOn}.`;
}

export function ObtainedPermitsView({
  apiBaseUrl,
  eventId,
}: {
  apiBaseUrl: string;
  eventId: string;
}) {
  const [state, setState] = useState<ViewState>({ status: "loading" });
  const [editing, setEditing] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [links, setLinks] = useState<Record<string, string>>({});

  const showing = `${apiBaseUrl}|${eventId}`;
  const active = useRef(showing);

  const reload = async () => {
    const result = await loadObtainedPermits(apiBaseUrl, eventId);
    if (active.current !== showing) return;
    setState(
      result.ok
        ? { status: "ready", permits: result.permits }
        : { status: "unavailable", message: result.message },
    );
  };

  useEffect(() => {
    active.current = showing;
    setState({ status: "loading" });
    setEditing(null);
    setFailure(null);
    setLinks({});
    void loadObtainedPermits(apiBaseUrl, eventId).then((result) => {
      if (active.current !== showing) return;
      setState(
        result.ok
          ? { status: "ready", permits: result.permits }
          : { status: "unavailable", message: result.message },
      );
    });
  }, [apiBaseUrl, eventId, showing]);

  if (state.status === "loading") {
    return <p role="status">Loading your recorded permits…</p>;
  }
  if (state.status === "unavailable") {
    return <p role="alert">{state.message}</p>;
  }

  const { asOf, items } = state.permits;

  const save = async (permit: ObtainedPermit, form: HTMLFormElement) => {
    const data = new FormData(form);
    const text = (name: string): string | null => {
      const value = data.get(name);
      const trimmed = typeof value === "string" ? value.trim() : "";
      return trimmed === "" ? null : trimmed;
    };
    const result = await recordPermit(apiBaseUrl, permit.id, {
      permitNumber: text("permitNumber"),
      issuedOn: text("issuedOn"),
      expiresOn: text("expiresOn"),
    });
    if (!result.ok) {
      setFailure(result.message);
      return;
    }
    setFailure(null);
    setEditing(null);
    await reload();
  };

  const attach = async (permit: ObtainedPermit, file: File) => {
    const rejection = documentRejection(file);
    if (rejection !== null) {
      setFailure(rejection);
      return;
    }
    const result = await uploadDocument(apiBaseUrl, permit.id, file);
    if (!result.ok) {
      setFailure(result.message);
      return;
    }
    setFailure(null);
    await reload();
  };

  const download = async (documentId: string) => {
    const result = await documentUrl(apiBaseUrl, documentId);
    if (!result.ok) {
      setFailure(result.message);
      return;
    }
    setFailure(null);
    setLinks((current) => ({ ...current, [documentId]: result.url }));
  };

  return (
    <main>
      <h1>Obtained permits</h1>
      <p>
        The permits you have marked as approved for this event, with the details you recorded for
        each one. Everything on this page is what you entered; this page does not check anything
        with an agency.
      </p>
      {failure !== null && <p role="alert">{failure}</p>}
      {items.length === 0 ? (
        <p>
          You have not marked any permits as approved for this event. Mark an item approved on the
          checklist and it will appear here so you can record its number, dates and paperwork.
        </p>
      ) : (
        <ul>
          {items.map((permit) => (
            <li key={permit.id}>
              <h2>{permit.permitName ?? "Unnamed checklist item"}</h2>
              {permit.agency !== null && <p>Agency: {permit.agency}</p>}
              <p>
                You marked this as approved. You last updated this record on{" "}
                {permit.recordedAt.slice(0, 10)}.
              </p>
              <p>
                {permit.permitNumber === null
                  ? "You have not recorded a permit number."
                  : `Permit number you recorded: ${permit.permitNumber}`}
              </p>
              <p>
                {permit.issuedOn === null
                  ? "You have not recorded an issue date."
                  : `You recorded an issue date of ${permit.issuedOn}.`}
              </p>
              <p>{expiryLine(permit, asOf)}</p>
              {permit.notes !== null && <p>Your notes: {permit.notes}</p>}
              {permit.documents.length === 0 ? (
                <p>You have not attached a document to this permit.</p>
              ) : (
                <ul>
                  {permit.documents.map((document) => (
                    <li key={document.id}>
                      {document.filename}{" "}
                      {links[document.id] === undefined ? (
                        <button type="button" onClick={() => void download(document.id)}>
                          Get download link for {document.filename}
                        </button>
                      ) : (
                        <a href={links[document.id]} target="_blank" rel="noreferrer noopener">
                          Download {document.filename}
                        </a>
                      )}
                    </li>
                  ))}
                </ul>
              )}

              {editing === permit.id ? (
                <form
                  aria-label={`Edit recorded details for ${permit.permitName ?? "this item"}`}
                  onSubmit={(event) => {
                    event.preventDefault();
                    void save(permit, event.currentTarget);
                  }}
                >
                  <label>
                    Permit number
                    <input
                      name="permitNumber"
                      type="text"
                      defaultValue={permit.permitNumber ?? ""}
                    />
                  </label>
                  <label>
                    Issue date
                    <input name="issuedOn" type="date" defaultValue={permit.issuedOn ?? ""} />
                  </label>
                  <label>
                    Expiry date
                    <input name="expiresOn" type="date" defaultValue={permit.expiresOn ?? ""} />
                  </label>
                  <label>
                    Attach the permit document
                    <input
                      name="document"
                      type="file"
                      accept={ACCEPTED_DOCUMENT_TYPES.join(",")}
                      onChange={(event) => {
                        const file = event.currentTarget.files?.[0];
                        if (file !== undefined) void attach(permit, file);
                      }}
                    />
                  </label>
                  <button type="submit">Save recorded details</button>
                </form>
              ) : (
                <button type="button" onClick={() => setEditing(permit.id)}>
                  Edit recorded details for {permit.permitName ?? "this item"}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
