/** Browser hub: last event opened on Live ops (home deep-link). */

export const LAST_EVENT_STORAGE_KEY = "popengine.lastEvent";

const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

export function rememberLastEvent(context: { id: string; name: string }): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      LAST_EVENT_STORAGE_KEY,
      JSON.stringify({ id: context.id, name: context.name }),
    );
  } catch {
    // Private mode / quota — hub entry is optional.
  }
}

export function readLastEvent(): { id: string; name: string } | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(LAST_EVENT_STORAGE_KEY);
    if (raw === null) return null;
    const parsed = asRecord(JSON.parse(raw) as unknown);
    if (parsed === null) return null;
    if (typeof parsed.id !== "string" || typeof parsed.name !== "string") return null;
    return { id: parsed.id, name: parsed.name };
  } catch {
    return null;
  }
}
