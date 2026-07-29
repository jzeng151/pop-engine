export type ParkSuggestion = {
  locationId: string;
  parkName: string;
  borough: string;
  type: string;
  acres: string;
};

export type ParksResult = { ok: true; spaces: ParkSuggestion[] } | { ok: false; message: string };

const BOROUGH_CODES = new Map([
  ["manhattan", "M"],
  ["brooklyn", "B"],
  ["queens", "Q"],
  ["bronx", "X"],
  ["staten_island", "R"],
]);

export const parksBoroughCode = (borough: unknown): string | null =>
  typeof borough === "string" ? (BOROUGH_CODES.get(borough) ?? null) : null;

const isParkSuggestion = (value: unknown): value is ParkSuggestion => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const park = value as Record<string, unknown>;
  return (
    typeof park.locationId === "string" &&
    typeof park.parkName === "string" &&
    typeof park.borough === "string" &&
    typeof park.type === "string" &&
    typeof park.acres === "string"
  );
};

export async function discoverParks(
  apiBaseUrl: string,
  borough: string,
  name: string,
  signal: AbortSignal,
): Promise<ParksResult> {
  const query = new URLSearchParams({ borough, name, limit: "20" });
  let response: Response;
  try {
    response = await fetch(`${apiBaseUrl}/api/permits/nyc/discover?${query}`, {
      credentials: "include",
      signal,
    });
  } catch {
    return { ok: false, message: "Park suggestions are unavailable." };
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return { ok: false, message: "Park suggestions are unavailable." };
  }
  const record =
    typeof body === "object" && body !== null && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : null;
  const spaces = record?.spaces;
  if (
    !response.ok ||
    record?.status !== "SUCCESS" ||
    !Array.isArray(spaces) ||
    !spaces.every(isParkSuggestion)
  ) {
    return { ok: false, message: "Park suggestions are unavailable." };
  }

  return {
    ok: true,
    spaces,
  };
}
