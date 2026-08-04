// Organizer guest-list calls for F-302. Credentialed for Cloudflare Access (AD-12).

export const CREDENTIALED = {
  credentials: "include",
  headers: { "Content-Type": "application/json" },
} as const satisfies RequestInit;

export type GuestRsvp = {
  id: string;
  event_id: string;
  name: string;
  email: string;
  phone: string | null;
  status: "confirmed" | "cancelled";
  created_at: string;
};

export type GuestList = {
  event: { id: string; name: string; capacity: number | null; event_date: string };
  rsvps: GuestRsvp[];
  confirmed_count: number;
};

export type GuestListResult = { ok: true; list: GuestList } | { ok: false; message: string };
export type CancelResult = { ok: true; list: GuestList } | { ok: false; message: string };

const UNREACHABLE = "The API could not be reached.";

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

function failureMessage(body: unknown, fallback: string): string {
  const error = asRecord(body)?.error;
  return typeof error === "string" && error.length > 0 ? error : fallback;
}

function parseList(body: unknown): GuestList | null {
  const record = asRecord(body);
  const event = asRecord(record?.event);
  if (
    event === null ||
    typeof event.id !== "string" ||
    typeof event.name !== "string" ||
    !(typeof event.capacity === "number" || event.capacity === null) ||
    typeof event.event_date !== "string" ||
    !Array.isArray(record?.rsvps) ||
    typeof record.confirmed_count !== "number"
  ) {
    return null;
  }
  return {
    event: {
      id: event.id,
      name: event.name,
      capacity: event.capacity,
      event_date: event.event_date,
    },
    rsvps: record.rsvps as GuestRsvp[],
    confirmed_count: record.confirmed_count,
  };
}

export async function loadGuestList(apiBaseUrl: string, eventId: string): Promise<GuestListResult> {
  let response: Response;
  try {
    response = await fetch(`${apiBaseUrl}/api/events/${eventId}/guests`, { ...CREDENTIALED });
  } catch {
    return { ok: false, message: UNREACHABLE };
  }
  const body = await readJson(response);
  if (!response.ok) {
    return {
      ok: false,
      message: failureMessage(
        body,
        response.status === 404
          ? "That event was not found."
          : `The guest list could not be loaded (HTTP ${response.status}).`,
      ),
    };
  }
  const list = parseList(body);
  if (list === null) {
    return { ok: false, message: "The API returned a guest list this page cannot read." };
  }
  return { ok: true, list };
}

export async function cancelGuest(
  apiBaseUrl: string,
  eventId: string,
  rsvpId: string,
): Promise<CancelResult> {
  let response: Response;
  try {
    response = await fetch(`${apiBaseUrl}/api/events/${eventId}/guests/${rsvpId}`, {
      method: "PATCH",
      ...CREDENTIALED,
      body: JSON.stringify({ status: "cancelled" }),
    });
  } catch {
    return { ok: false, message: UNREACHABLE };
  }
  const body = await readJson(response);
  if (!response.ok) {
    return {
      ok: false,
      message: failureMessage(body, `The RSVP could not be cancelled (HTTP ${response.status}).`),
    };
  }
  // Reload the list so counts stay authoritative after cancel.
  return loadGuestList(apiBaseUrl, eventId);
}

/** Public RSVP create — used by tests and ready for the F-301 page when #100 lands. */
export async function createRsvp(
  apiBaseUrl: string,
  eventId: string,
  input: { name: string; email: string; phone?: string },
): Promise<{ ok: true } | { ok: false; message: string }> {
  let response: Response;
  try {
    response = await fetch(`${apiBaseUrl}/api/events/${eventId}/rsvps`, {
      method: "POST",
      ...CREDENTIALED,
      body: JSON.stringify(input),
    });
  } catch {
    return { ok: false, message: UNREACHABLE };
  }
  const body = await readJson(response);
  if (!response.ok) {
    return {
      ok: false,
      message: failureMessage(body, `RSVP could not be saved (HTTP ${response.status}).`),
    };
  }
  return { ok: true };
}
