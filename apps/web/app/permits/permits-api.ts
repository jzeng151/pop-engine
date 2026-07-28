// DEMO SCOPE. The browser's calls to the obtained-permits read path and its one write. This is
// NOT F-208 and will be superseded by it.
//
// Web and api are separate origins behind Cloudflare Access (BASELINE.md provider baseline), so
// every call sends credentials. Document upload and signed download links are F-202's and are
// imported from `../checklist/checklist-api` rather than reimplemented here.

import { CREDENTIALED } from "../intake/events-api";
import { asRecord, isString, nullOr } from "../plan/validated";

export type ObtainedPermitDocument = {
  readonly id: string;
  readonly filename: string;
};

export type ObtainedPermit = {
  readonly id: string;
  readonly permitName: string | null;
  readonly agency: string | null;
  /** Only ever what the organizer typed. Null means they recorded none. */
  readonly permitNumber: string | null;
  readonly issuedOn: string | null;
  readonly expiresOn: string | null;
  /** Null when no expiry was recorded: an unrecorded expiry is not an unexpired one. */
  readonly expired: boolean | null;
  readonly notes: string | null;
  /** When the organizer last changed this record, which is the only time the row stores. */
  readonly recordedAt: string;
  readonly documents: readonly ObtainedPermitDocument[];
};

export type ObtainedPermitsResponse = {
  readonly asOf: string;
  readonly items: readonly ObtainedPermit[];
};

export type PermitsResult =
  | { ok: true; permits: ObtainedPermitsResponse }
  | { ok: false; message: string };

export type RecordResult = { ok: true } | { ok: false; message: string };

const UNREACHABLE = "The API could not be reached. Check that it is running and try again.";

const readJson = async (response: Response): Promise<unknown> => {
  try {
    return await response.json();
  } catch {
    return null;
  }
};

const failureMessage = (body: unknown, fallback: string): string => {
  const error = asRecord(body)?.error;
  return typeof error === "string" && error.length > 0 ? error : fallback;
};

/** One row as this page reads it. A field it cannot read makes the whole response unreadable. */
function permitFrom(value: unknown): ObtainedPermit | null {
  const row = asRecord(value);
  if (row === null) return null;
  const { id, permitName, agency, permitNumber, issuedOn, expiresOn, expired, notes, recordedAt } =
    row;
  if (!isString(id) || !isString(recordedAt)) return null;
  if (!nullOr(isString)(permitName) || !nullOr(isString)(agency)) return null;
  if (!nullOr(isString)(permitNumber)) return null;
  if (!nullOr(isString)(issuedOn) || !nullOr(isString)(expiresOn)) return null;
  if (expired !== null && typeof expired !== "boolean") return null;
  if (!nullOr(isString)(notes)) return null;
  if (!Array.isArray(row.documents)) return null;
  const documents: ObtainedPermitDocument[] = [];
  for (const entry of row.documents) {
    const document = asRecord(entry);
    if (document === null || !isString(document.id) || !isString(document.filename)) return null;
    documents.push({ id: document.id, filename: document.filename });
  }
  return {
    id,
    permitName,
    agency,
    permitNumber,
    issuedOn,
    expiresOn,
    expired,
    notes,
    recordedAt,
    documents,
  };
}

export async function loadObtainedPermits(
  apiBaseUrl: string,
  eventId: string,
): Promise<PermitsResult> {
  let response: Response;
  try {
    response = await fetch(`${apiBaseUrl}/api/events/${eventId}/obtained-permits`, {
      ...CREDENTIALED,
    });
  } catch {
    return { ok: false, message: UNREACHABLE };
  }

  const body = await readJson(response);
  if (!response.ok) {
    return {
      ok: false,
      message: failureMessage(body, `The permits could not be read (HTTP ${response.status}).`),
    };
  }

  const payload = asRecord(body);
  if (payload === null || !isString(payload.asOf) || !Array.isArray(payload.items)) {
    return { ok: false, message: "The API returned permits this page cannot read." };
  }
  const items: ObtainedPermit[] = [];
  for (const entry of payload.items) {
    const permit = permitFrom(entry);
    if (permit === null) {
      return { ok: false, message: "The API returned permits this page cannot read." };
    }
    items.push(permit);
  }
  return { ok: true, permits: { asOf: payload.asOf, items } };
}

export type PermitRecord = {
  readonly permitNumber: string | null;
  readonly issuedOn: string | null;
  readonly expiresOn: string | null;
};

export async function recordPermit(
  apiBaseUrl: string,
  itemId: string,
  record: PermitRecord,
): Promise<RecordResult> {
  let response: Response;
  try {
    response = await fetch(`${apiBaseUrl}/api/checklist-items/${itemId}/permit-record`, {
      ...CREDENTIALED,
      method: "PATCH",
      body: JSON.stringify(record),
    });
  } catch {
    return { ok: false, message: UNREACHABLE };
  }
  if (!response.ok) {
    return {
      ok: false,
      message: failureMessage(
        await readJson(response),
        `The permit details could not be saved (HTTP ${response.status}).`,
      ),
    };
  }
  return { ok: true };
}
