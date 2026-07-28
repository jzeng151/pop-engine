import { Router, type Request, type Response as ExpressResponse } from "express";

const PARKS_ENDPOINT = "https://data.cityofnewyork.us/resource/c5vm-g2dk.json";
const BOROUGHS = new Set(["M", "B", "Q", "X", "R"]);
const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 50;

export type ParksFetch = (input: string | URL) => Promise<Response>;

type ParkRow = {
  system?: unknown;
  gispropnum?: unknown;
  name?: unknown;
  areatype?: unknown;
  acres?: unknown;
};

const stringOr = (value: unknown, fallback: string): string =>
  typeof value === "string" && value.length > 0 ? value : fallback;

function readLimit(value: unknown): number | null {
  if (value === undefined) return DEFAULT_LIMIT;
  if (typeof value !== "string" || !/^\d+$/.test(value)) return null;
  const limit = Number(value);
  return limit >= 1 && limit <= MAX_LIMIT ? limit : null;
}

function parksUrl(borough: string, limit: number): string {
  const query = new URLSearchParams({
    $select: "system,gispropnum,name,borough,areatype,acres",
    $where: `borough='${borough}'`,
    $order: "name ASC,system ASC",
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

      const response = await fetchParks(parksUrl(borough, limit));
      if (!response.ok) throw new Error("NYC Open Data request failed");

      const body: unknown = await response.json();
      if (!Array.isArray(body)) throw new Error("NYC Open Data response was not an array");

      const spaces = body.map((value: unknown) => {
        const park = value !== null && typeof value === "object" ? (value as ParkRow) : {};
        return {
          locationId: stringOr(park.system, stringOr(park.gispropnum, "")),
          parkName: stringOr(park.name, "NYC Park Zone"),
          borough,
          type: stringOr(park.areatype, "Special Event Area"),
          acres: stringOr(park.acres, "N/A"),
        };
      });

      res.json({ status: "SUCCESS", spaces });
    }),
  );

  return router;
}
