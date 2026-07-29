import { Router, type Request, type Response } from "express";
import type { Pool, QueryResult, QueryResultRow } from "pg";

// F-402 live ops dashboard stats (ARCHITECTURE.md API Surface).
// Polled ~5s from the organizer dashboard. Counts are check-ins (arrivals) only —
// there is no exit tracking in MVP (F-410), so presence claims are unsupported.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type StatsDependencies = {
  database: Pool;
};

export type EventStats = {
  checkins_total: number;
  checkins_registered: number;
  checkins_walk_in: number;
  rsvps_total: number;
  capacity: number | null;
  checkins_last_10min: number;
};

type Queryable = {
  query<Row extends QueryResultRow>(text: string, values?: unknown[]): Promise<QueryResult<Row>>;
};

type StatsResult =
  | { status: 200; body: EventStats }
  | { status: 400 | 404; body: { error: string } };

const asCount = (value: string | number | null | undefined): number => {
  const parsed = typeof value === "number" ? value : Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
};

type StatsRow = {
  capacity: number | null;
  checkins_total: string;
  checkins_registered: string;
  checkins_walk_in: string;
  checkins_last_10min: string;
  rsvps_total: string;
};

/**
 * Check-in and RSVP totals for one event, plus optional confirmed capacity.
 * `rsvps_total` is confirmed RSVPs only (same definition as the guest list).
 * `checkins_registered` / `checkins_walk_in` split on `checkins.rsvp_id` (F-302 AC 4).
 * All counters come from one statement so concurrent inserts cannot yield
 * `checkins_last_10min > checkins_total`.
 */
export async function readEventStats(database: Queryable, eventId: string): Promise<StatsResult> {
  if (!UUID.test(eventId)) {
    return { status: 400, body: { error: "That event link is not valid." } };
  }

  const { rows } = await database.query<StatsRow>(
    `SELECT
       e.capacity,
       (SELECT count(*)::text FROM checkins c
         WHERE c.event_id = e.id) AS checkins_total,
       (SELECT count(*)::text FROM checkins c
         WHERE c.event_id = e.id AND c.rsvp_id IS NOT NULL) AS checkins_registered,
       (SELECT count(*)::text FROM checkins c
         WHERE c.event_id = e.id AND c.rsvp_id IS NULL) AS checkins_walk_in,
       (SELECT count(*)::text FROM checkins c
         WHERE c.event_id = e.id
           AND c.checked_in_at >= now() - interval '10 minutes') AS checkins_last_10min,
       (SELECT count(*)::text FROM rsvps r
         WHERE r.event_id = e.id AND r.status = 'confirmed') AS rsvps_total
     FROM events e
     WHERE e.id = $1`,
    [eventId],
  );

  const row = rows[0];
  if (row === undefined) {
    return { status: 404, body: { error: "That event was not found." } };
  }

  return {
    status: 200,
    body: {
      checkins_total: asCount(row.checkins_total),
      checkins_registered: asCount(row.checkins_registered),
      checkins_walk_in: asCount(row.checkins_walk_in),
      rsvps_total: asCount(row.rsvps_total),
      capacity: row.capacity,
      checkins_last_10min: asCount(row.checkins_last_10min),
    },
  };
}

const handle =
  (route: (req: Request, res: Response) => Promise<void>) =>
  (req: Request, res: Response, next: (error?: unknown) => void): void => {
    route(req, res).catch(next);
  };

export function createStatsRouter(dependencies: StatsDependencies): Router {
  const { database } = dependencies;
  const router = Router();

  router.get(
    "/events/:id/stats",
    handle(async (req, res) => {
      const result = await readEventStats(database, req.params.id ?? "");
      res.status(result.status).json(result.body);
    }),
  );

  return router;
}
