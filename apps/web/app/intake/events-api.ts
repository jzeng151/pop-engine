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

/**
 * A plan regeneration. `eventRevision` is the revision the new plan evaluated, read from
 * the plan endpoint's own `eventRevision` (F-201 serves plans in camelCase; the events
 * routes serve database rows in snake_case). The caller uses it to ignore a response for
 * a revision the event has already moved past. It is null when the response does not say,
 * which the caller must treat as "cannot confirm" rather than "matches".
 */
export type PlanRegenerationResult =
  { ok: true; eventRevision: number | null } | { ok: false; message: string };

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

/**
 * One-click plan regeneration (F-101 spec #8). The endpoint is F-201's
 * (`POST /api/events/:id/plan`, ARCHITECTURE.md API Surface); intake only asks for it
 * and reports what came back. Plans are immutable snapshots (AD-7), so regeneration is
 * a new plan for the current revision, never a patch.
 */
export async function regeneratePlan(
  apiBaseUrl: string,
  eventId: string,
): Promise<PlanRegenerationResult> {
  let response: Response;
  try {
    response = await fetch(`${apiBaseUrl}/api/events/${eventId}/plan`, {
      method: "POST",
      ...CREDENTIALED,
    });
  } catch {
    return { ok: false, message: UNREACHABLE };
  }

  const body = await readJson(response);
  if (!response.ok) {
    return {
      ok: false,
      message: failureMessage(body, `The plan could not be regenerated (HTTP ${response.status}).`),
    };
  }
  const revision = asRecord(body)?.eventRevision;
  return { ok: true, eventRevision: typeof revision === "number" ? revision : null };
}
