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
 * The endpoint's ruleset-downgrade refusal (F-201 AC 12), as the browser receives it.
 *
 * `pinnedRulesetVersion` is what the plan this generation would have superseded pinned, and
 * `rulesetVersion` is what the service that refused is running. Both travel with the refusal
 * because a refusal an organizer cannot be told the reason for is its own harm.
 */
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
      // Whether the API actually answered the staleness question, as distinct from answering
      // "no". A caller deciding "is it stale" wants the boolean above; a caller deciding
      // "was freshness confirmed" cannot use it, because a body that omits the field would read
      // as confirmed-current.
      plan_stale_reported: typeof asRecord(body)?.plan_stale === "boolean",
    },
  };
}

/**
 * The two versions and the direction, read off a 409 body, or null if it did not carry them.
 *
 * A 409 that cannot be read this way is reported as an ordinary failure rather than guessed at:
 * the copy this feeds names both versions and says which is older, and stating either wrongly is
 * worse than falling back to the endpoint's own sentence.
 */
function readRefusal(body: unknown): RegenerationRefusal | null {
  const record = asRecord(body);
  if (record === null) return null;
  const { rulesetVersion, pinnedRulesetVersion, standing } = record;
  if (typeof rulesetVersion !== "string" || typeof pinnedRulesetVersion !== "string") return null;
  if (standing !== "older" && standing !== "different") return null;
  return { rulesetVersion, pinnedRulesetVersion, standing };
}

/**
 * One-click plan regeneration (F-101 spec #8). The endpoint is F-201's
 * (`POST /api/events/:id/plan`, ARCHITECTURE.md API Surface); intake only asks for it and reports
 * what came back. Plans are immutable snapshots (AD-7), so regeneration is a new plan for the
 * current revision, never a patch.
 *
 * This does not decide whether generating is safe before asking. F-201 AC 12 puts that decision
 * inside the transaction that inserts, under a row lock, which is the only place both the ruleset
 * being evaluated with and the plan being superseded are visible at once. So the browser attempts
 * the write and handles the answer, including the 409 the guard returns.
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
      : { ok: false, refused: false, message };
  }
  return { ok: true };
}
