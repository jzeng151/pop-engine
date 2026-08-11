// The browser's calls to the events API.

import type { IntakeValue } from "@pop-engine/engine";

export const CREDENTIALED = {
  credentials: "include",
  headers: { "Content-Type": "application/json" },
} as const satisfies RequestInit;

export type SavedEvent = {
  id: string;
  revision_counter: number;
  [column: string]: unknown;
};

type Answers = Record<string, IntakeValue>;

export type PendingCreate = {
  key: string;
  body: Answers;
  answers: Answers;
  eventId?: string;
};

const PENDING_CREATE_STORAGE = "pop-engine.pending-event-create";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const isIntakeValue = (value: unknown): value is IntakeValue =>
  value === null ||
  typeof value === "string" ||
  typeof value === "number" ||
  typeof value === "boolean" ||
  (Array.isArray(value) && value.every((entry) => typeof entry === "string"));

const isAnswers = (value: unknown): value is Answers =>
  typeof value === "object" &&
  value !== null &&
  !Array.isArray(value) &&
  Object.values(value).every(isIntakeValue);

const pendingCreateStorageKey = (apiBaseUrl: string): string =>
  `${PENDING_CREATE_STORAGE}:${apiBaseUrl}`;

type PendingCreateRead = { pending: PendingCreate | null; resolved: boolean };

function readPendingCreate(apiBaseUrl: string): PendingCreateRead {
  const storageKey = pendingCreateStorageKey(apiBaseUrl);
  const discardUnreadable = (): PendingCreateRead => {
    try {
      sessionStorage.removeItem(storageKey);
      return { pending: null, resolved: true };
    } catch {
      return { pending: null, resolved: false };
    }
  };
  try {
    const stored = sessionStorage.getItem(storageKey);
    if (stored === null) return { pending: null, resolved: true };
    const value: unknown = JSON.parse(stored);
    const record =
      typeof value === "object" && value !== null && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : null;
    if (
      record === null ||
      typeof record.key !== "string" ||
      !UUID.test(record.key) ||
      !isAnswers(record.body) ||
      !isAnswers(record.answers) ||
      (record.eventId !== undefined && typeof record.eventId !== "string")
    ) {
      return discardUnreadable();
    }
    return {
      pending: {
        key: record.key,
        body: record.body,
        answers: record.answers,
        ...(typeof record.eventId === "string" ? { eventId: record.eventId } : {}),
      },
      resolved: true,
    };
  } catch {
    return discardUnreadable();
  }
}

export function loadPendingCreate(apiBaseUrl: string): PendingCreate | null {
  return readPendingCreate(apiBaseUrl).pending;
}

export function storePendingCreate(apiBaseUrl: string, pending: PendingCreate | null): boolean {
  try {
    const storageKey = pendingCreateStorageKey(apiBaseUrl);
    if (pending === null) sessionStorage.removeItem(storageKey);
    else sessionStorage.setItem(storageKey, JSON.stringify(pending));
    return true;
  } catch {
    return false;
  }
}

export const isPendingCreateForEvent = (
  pending: PendingCreate | null,
  eventId: string,
): pending is PendingCreate & { eventId: string } =>
  pending?.eventId?.toLowerCase() === eventId.toLowerCase();

/** Clear only the recovery operation whose first plan this page has confirmed. */
export function clearPendingCreateForEvent(apiBaseUrl: string, eventId: string): boolean {
  const read = readPendingCreate(apiBaseUrl);
  return (
    read.resolved &&
    (!isPendingCreateForEvent(read.pending, eventId) || storePendingCreate(apiBaseUrl, null))
  );
}

export type LoadedEvent = {
  event: SavedEvent;
  plan_stale: boolean;
  /** Whether the response carried the field at all; see the parser. */
  plan_stale_reported: boolean;
};

export type LoadResult = { ok: true; loaded: LoadedEvent } | { ok: false; message: string };

/** The endpoint's ruleset-downgrade refusal (F-201 AC 12), as the browser receives it. */
export type RegenerationRefusal = {
  readonly rulesetVersion: string;
  readonly pinnedRulesetVersion: string;
  readonly standing: "older" | "different";
};

export type PlanRegenerationResult =
  | { ok: true }
  /**
   * `refused` is the 409 above. It decides before it inserts, so it is certain that nothing was
   * stored and that the same request to the same deployment is refused identically. `refusal` is
   * the detail behind it, null when the body did not carry it in a form this can read.
   */
  | { ok: false; refused: true; refusal: RegenerationRefusal | null; message: string }
  | { ok: false; refused: false; message: string };

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
      // Whether the API actually answered the staleness question, as distinct from answering "no".
      plan_stale_reported: typeof asRecord(body)?.plan_stale === "boolean",
    },
  };
}

/** The two versions and the direction, read off a 409 body, or null if it did not carry them. */
function readRefusal(body: unknown): RegenerationRefusal | null {
  const record = asRecord(body);
  if (record === null) return null;
  const { rulesetVersion, pinnedRulesetVersion, standing } = record;
  if (typeof rulesetVersion !== "string" || typeof pinnedRulesetVersion !== "string") return null;
  if (standing !== "older" && standing !== "different") return null;
  return { rulesetVersion, pinnedRulesetVersion, standing };
}

/** One-click plan regeneration (F-101 spec #8). */
export async function regeneratePlan(
  apiBaseUrl: string,
  eventId: string,
  initialCreateKey?: string,
): Promise<PlanRegenerationResult> {
  let response: Response;
  try {
    response = await fetch(`${apiBaseUrl}/api/events/${eventId}/plan`, {
      method: "POST",
      ...CREDENTIALED,
      headers:
        initialCreateKey === undefined
          ? CREDENTIALED.headers
          : { ...CREDENTIALED.headers, "Idempotency-Key": initialCreateKey },
    });
  } catch {
    return { ok: false, refused: false, message: UNREACHABLE };
  }

  const body = await readJson(response);
  if (!response.ok) {
    const message = failureMessage(
      body,
      `The plan could not be regenerated (HTTP ${response.status}).`,
    );
    return response.status === 409
      ? { ok: false, refused: true, refusal: readRefusal(body), message }
      : {
          ok: false,
          refused: false,
          message,
        };
  }
  return { ok: true };
}
