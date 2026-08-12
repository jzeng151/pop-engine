export const CREDENTIALED = {
  credentials: "include",
  headers: { "Content-Type": "application/json" },
} as const satisfies RequestInit;

export type PromoteState = {
  event_id: string;
  title: string;
  event_date: string;
  venue: string | null;
  borough: string;
  description: string | null;
  public_page_published: boolean;
  public_path: string;
  map_url: string | null;
  infeasible_warning: boolean;
  plan_available: boolean;
  publication_blocked: boolean;
};

export type PromoteResult = { ok: true; state: PromoteState } | { ok: false; message: string };

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

function parseState(body: unknown): PromoteState | null {
  const record = asRecord(body);
  if (
    record === null ||
    typeof record.event_id !== "string" ||
    typeof record.title !== "string" ||
    typeof record.public_path !== "string" ||
    typeof record.public_page_published !== "boolean" ||
    typeof record.plan_available !== "boolean" ||
    typeof record.publication_blocked !== "boolean"
  ) {
    return null;
  }
  return record as PromoteState;
}

export async function loadPromoteState(
  apiBaseUrl: string,
  eventId: string,
): Promise<PromoteResult> {
  let response: Response;
  try {
    response = await fetch(`${apiBaseUrl}/api/events/${eventId}/public-page`, {
      ...CREDENTIALED,
    });
  } catch {
    return { ok: false, message: UNREACHABLE };
  }
  const body = await readJson(response);
  if (!response.ok) {
    return {
      ok: false,
      message: failureMessage(body, `Promote controls could not load (HTTP ${response.status}).`),
    };
  }
  const state = parseState(body);
  if (state === null) {
    return { ok: false, message: "The API returned promote data this page cannot read." };
  }
  return { ok: true, state };
}

export async function savePromoteState(
  apiBaseUrl: string,
  eventId: string,
  patch: { description?: string | null; public_page_published?: boolean },
): Promise<PromoteResult> {
  let response: Response;
  try {
    response = await fetch(`${apiBaseUrl}/api/events/${eventId}/public-page`, {
      method: "PATCH",
      ...CREDENTIALED,
      body: JSON.stringify(patch),
    });
  } catch {
    return { ok: false, message: UNREACHABLE };
  }
  const body = await readJson(response);
  if (!response.ok) {
    return {
      ok: false,
      message: failureMessage(body, `Could not save promote settings (HTTP ${response.status}).`),
    };
  }
  const state = parseState(body);
  if (state === null) {
    return { ok: false, message: "The API returned promote data this page cannot read." };
  }
  return { ok: true, state };
}
