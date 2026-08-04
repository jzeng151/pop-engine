// The browser's calls to the events API.
//
// Web and api are separate origins behind Cloudflare Access (BASELINE.md provider
// baseline), so every call sends credentials and the api answers with
// `Access-Control-Allow-Credentials`.

export const CREDENTIALED = {
  credentials: "include",
  headers: { "Content-Type": "application/json" },
} as const satisfies RequestInit;

export type SavedEvent = {
  id: string;
  revision_counter: number;
  [column: string]: unknown;
};

export type LoadedEvent = {
  event: SavedEvent;
  plan_stale: boolean;
  /** Whether the response carried the field at all; see the parser. */
  plan_stale_reported: boolean;
};

export type LoadResult = { ok: true; loaded: LoadedEvent } | { ok: false; message: string };

const UNREACHABLE = "The API could not be reached.";

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    // A non-JSON body (a proxy error page, an Access challenge) still has a status.
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

/** Load a saved event so it can be edited (`GET /api/events/:id`). */
export async function loadEvent(apiBaseUrl: string, eventId: string): Promise<LoadResult> {
  let response: Response;
  try {
    response = await fetch(`${apiBaseUrl}/api/events/${eventId}`, { ...CREDENTIALED });
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
          : `The event could not be loaded (HTTP ${response.status}).`,
      ),
    };
  }

  const event = asRecord(asRecord(body)?.event);
  if (event === null || typeof event.id !== "string") {
    return { ok: false, message: "The API returned an event this form cannot read." };
  }
  return {
    ok: true,
    loaded: {
      event: event as SavedEvent,
      plan_stale: asRecord(body)?.plan_stale === true,
      // Whether the API actually answered the staleness question, as distinct from answering
      // "no". A caller deciding "is it stale" wants the boolean above; a caller deciding
      // "was freshness confirmed" cannot use it, because a body that omits the field would read
      // as confirmed-current.
      plan_stale_reported: typeof asRecord(body)?.plan_stale === "boolean",
    },
  };
}
