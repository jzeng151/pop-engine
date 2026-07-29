// Organizer live-ops stats for F-402. Credentialed for Cloudflare Access (AD-12).

const CREDENTIALED = {
  credentials: "include",
  headers: { "Content-Type": "application/json" },
} as const satisfies RequestInit;

export type EventStats = {
  checkins_total: number;
  checkins_registered: number;
  checkins_walk_in: number;
  rsvps_total: number;
  capacity: number | null;
  checkins_last_10min: number;
};

export type StatsResult = { ok: true; stats: EventStats } | { ok: false; message: string };

type LoadEventStatsOptions = {
  /** Abort when the caller unmounts or switches events. */
  signal?: AbortSignal;
  /** Bound a hung fetch so serialized polling can resume (default STATS_FETCH_TIMEOUT_MS). */
  timeoutMs?: number;
};

const UNREACHABLE = "The API could not be reached.";

const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

function failureMessage(body: unknown, fallback: string): string {
  const error = asRecord(body)?.error;
  return typeof error === "string" && error.length > 0 ? error : fallback;
}

function parseStats(body: unknown): EventStats | null {
  const record = asRecord(body);
  if (record === null) return null;
  if (
    typeof record.checkins_total !== "number" ||
    typeof record.checkins_registered !== "number" ||
    typeof record.checkins_walk_in !== "number" ||
    typeof record.rsvps_total !== "number" ||
    typeof record.checkins_last_10min !== "number" ||
    !(record.capacity === null || typeof record.capacity === "number")
  ) {
    return null;
  }
  return {
    checkins_total: record.checkins_total,
    checkins_registered: record.checkins_registered,
    checkins_walk_in: record.checkins_walk_in,
    rsvps_total: record.rsvps_total,
    capacity: record.capacity,
    checkins_last_10min: record.checkins_last_10min,
  };
}

/**
 * Read JSON with the request abort still armed. A stall after headers but mid-body must not
 * leave DashboardView permanently `inFlight` (timeout cleared too early).
 */
async function readJsonBody(
  response: Response,
  signal: AbortSignal,
): Promise<{ ok: true; body: unknown } | { ok: false }> {
  try {
    return { ok: true, body: await response.json() };
  } catch {
    if (signal.aborted) return { ok: false };
    return { ok: true, body: null };
  }
}

export async function loadEventStats(
  apiBaseUrl: string,
  eventId: string,
  options: LoadEventStatsOptions = {},
): Promise<StatsResult> {
  const timeoutMs = options.timeoutMs ?? STATS_FETCH_TIMEOUT_MS;
  const controller = new AbortController();
  const onExternalAbort = () => {
    controller.abort();
  };
  if (options.signal !== undefined) {
    if (options.signal.aborted) {
      return { ok: false, message: UNREACHABLE };
    }
    options.signal.addEventListener("abort", onExternalAbort);
  }
  const timer = setTimeout(() => {
    controller.abort();
  }, timeoutMs);

  try {
    let response: Response;
    try {
      response = await fetch(`${apiBaseUrl}/api/events/${eventId}/stats`, {
        ...CREDENTIALED,
        signal: controller.signal,
      });
    } catch {
      return { ok: false, message: UNREACHABLE };
    }

    // Timeout stays active through body consumption — headers-only success can still hang on JSON.
    const parsed = await readJsonBody(response, controller.signal);
    if (!parsed.ok) {
      return { ok: false, message: UNREACHABLE };
    }
    const body = parsed.body;

    if (!response.ok) {
      return {
        ok: false,
        message: failureMessage(
          body,
          response.status === 404
            ? "That event was not found."
            : `Live ops stats could not be loaded (HTTP ${response.status}).`,
        ),
      };
    }
    const stats = parseStats(body);
    if (stats === null) {
      return { ok: false, message: "The API returned stats this page cannot read." };
    }
    return { ok: true, stats };
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", onExternalAbort);
  }
}

/** Polling interval from the F-402 spec (~5 seconds; no websockets in MVP). */
export const STATS_POLL_MS = 5_000;

/** Expire a hung fetch so `inFlight` clears and the next poll tick can run. */
export const STATS_FETCH_TIMEOUT_MS = 8_000;
