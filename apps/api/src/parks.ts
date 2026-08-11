import { Router, type Request, type Response as ExpressResponse } from "express";

const PARKS_ENDPOINT = "https://data.cityofnewyork.us/resource/c5vm-g2dk.json";
const BOROUGHS = new Set(["M", "B", "Q", "X", "R"]);
const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 50;
const MAX_NAME_LENGTH = 80;
const PARKS_TIMEOUT_MS = 5_000;

export type ParksFetch = (input: string | URL, init?: RequestInit) => Promise<Response>;

type ParkRow = {
  system?: unknown;
  gispropnum?: unknown;
  name?: unknown;
  areatype?: unknown;
  acres?: unknown;
};

const nonEmptyString = (value: unknown): string | null =>
  typeof value === "string" && value.trim().length > 0 ? value.trim() : null;

const stringOr = (value: unknown, fallback: string): string => nonEmptyString(value) ?? fallback;

function readLimit(value: unknown): number | null {
  if (value === undefined) return DEFAULT_LIMIT;
  if (typeof value !== "string" || !/^\d+$/.test(value)) return null;
  const limit = Number(value);
  return limit >= 1 && limit <= MAX_LIMIT ? limit : null;
}

function readName(value: unknown): string | null | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") return null;
  const name = value.trim();
  return name.length >= 1 &&
    name.length <= MAX_NAME_LENGTH &&
    ![...name].some((character) => character < " " || character === "\u007f")
    ? name
    : null;
}

function parksUrl(borough: string, limit: number, name: string | undefined): string {
  const where = [`borough='${borough}'`];
  if (name !== undefined) {
    // SoQL string literals escape apostrophes by doubling them.
    where.push(`upper(name) LIKE '%${name.toUpperCase().replaceAll("'", "''")}%'`);
  }
  const query = new URLSearchParams({
    $select: "system,gispropnum,name,borough,areatype,acres",
    $where: where.join(" AND "),
    $order: "name ASC,system ASC,gispropnum ASC",
    $limit: String(limit),
  });
  return `${PARKS_ENDPOINT}?${query}`;
}

const handle =
  (route: (req: Request, res: ExpressResponse) => Promise<void>) =>
  (req: Request, res: ExpressResponse): void => {
    route(req, res).catch(() => {
      res.status(502).json({ error: "NYC Parks discovery is temporarily unavailable" });
    });
  };

export function createParksRouter(fetchParks: ParksFetch = fetch): Router {
  const router = Router();

  router.get(
    "/nyc/discover",
    handle(async (req, res) => {
      const borough = req.query.borough;
      if (typeof borough !== "string" || !BOROUGHS.has(borough)) {
        res.status(400).json({ error: "borough must be one of M, B, Q, X, R" });
        return;
      }

      const limit = readLimit(req.query.limit);
      if (limit === null) {
        res.status(400).json({ error: `limit must be an integer from 1 to ${MAX_LIMIT}` });
        return;
      }

      const name = readName(req.query.name);
      if (name === null) {
        res.status(400).json({ error: `name must be from 1 to ${MAX_NAME_LENGTH} characters` });
        return;
      }

      const response = await fetchParks(parksUrl(borough, limit, name), {
        signal: AbortSignal.timeout(PARKS_TIMEOUT_MS),
      });
      if (!response.ok) throw new Error("NYC Open Data request failed");

      const body: unknown = await response.json();
      if (!Array.isArray(body)) throw new Error("NYC Open Data response was not an array");

      const spaces = body.flatMap((value: unknown) => {
        if (value === null || typeof value !== "object") return [];
        const park = value as ParkRow;
        const locationId = nonEmptyString(park.system) ?? nonEmptyString(park.gispropnum);
        const parkName = nonEmptyString(park.name);
        if (locationId === null || parkName === null) return [];
        return [
          {
            locationId,
            parkName,
            borough,
            type: stringOr(park.areatype, "Special Event Area"),
            acres: stringOr(park.acres, "N/A"),
          },
        ];
      });

      res.json({ status: "SUCCESS", spaces });
    }),
  );

  return router;
}
