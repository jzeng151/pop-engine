import { randomUUID } from "node:crypto";
export { normalizeOptionalPhone } from "./contact";
import { normalizeOptionalPhone } from "./contact";
import { Router, type Request, type Response } from "express";
import type { Pool, PoolClient, QueryResult, QueryResultRow } from "pg";

// F-302 RSVP / guest list (ARCHITECTURE.md API Surface + rsvps schema).
// Capacity is F-101 headcount (spec AC 2) — not events.capacity (that gauge is F-402).
// Public POST requires F-301 public_page_published so unpublished events cannot collect RSVPs.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type RsvpsDependencies = {
  database: Pool;
  /** Injected calendar day in the jurisdiction; never Date.now() inside the handler. */
  today: () => string;
};

export type RsvpRow = {
  id: string;
  event_id: string;
  name: string;
  email: string;
  phone: string | null;
  status: "confirmed" | "cancelled";
  created_at: Date | string;
};

type Queryable = {
  query<Row extends QueryResultRow>(text: string, values?: unknown[]): Promise<QueryResult<Row>>;
};

export type NormalizedEmail = { ok: true; email: string } | { ok: false; message: string };

export function normalizeEmail(raw: string): NormalizedEmail {
  const email = raw.trim().toLowerCase();
  if (email.length === 0) {
    return { ok: false, message: "email is required" };
  }
  if (!EMAIL.test(email)) {
    return { ok: false, message: "email must be a valid address" };
  }
  return { ok: true, email };
}

/** Optional phone: digits only when present, so F-401 matching stays consistent. */

type RsvpBody = { name: string; email: string; phone: string | null };

function readRsvpBody(
  body: unknown,
): { ok: true; value: RsvpBody } | { ok: false; message: string } {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { ok: false, message: "body must be a JSON object" };
  }
  const record = body as Record<string, unknown>;
  if (typeof record.name !== "string" || record.name.trim().length === 0) {
    return { ok: false, message: "name is required" };
  }
  if (typeof record.email !== "string") {
    return { ok: false, message: "email is required" };
  }
  const email = normalizeEmail(record.email);
  if (!email.ok) return email;
  const phone = normalizeOptionalPhone(record.phone);
  if (!phone.ok) return phone;
  return {
    ok: true,
    value: { name: record.name.trim(), email: email.email, phone: phone.phone },
  };
}

type EventCapacity = {
  id: string;
  name: string;
  headcount: number;
  event_date: string;
  public_page_published: boolean;
};

async function lockEvent(client: Queryable, eventId: string): Promise<EventCapacity | null> {
  const { rows } = await client.query<EventCapacity>(
    `SELECT id, name, headcount, event_date::text AS event_date, public_page_published
       FROM events
      WHERE id = $1
      FOR UPDATE`,
    [eventId],
  );
  return rows[0] ?? null;
}

async function countConfirmed(client: Queryable, eventId: string): Promise<number> {
  const { rows } = await client.query<{ count: string }>(
    `SELECT count(*)::text AS count
       FROM rsvps
      WHERE event_id = $1
        AND status = 'confirmed'`,
    [eventId],
  );
  return Number(rows[0]?.count ?? 0);
}

async function withTransaction<T>(
  database: Pool,
  work: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await database.connect();
  try {
    await client.query("BEGIN");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export type CreateRsvpResult =
  | { status: 200 | 201; body: { rsvp: RsvpRow; confirmed_count: number; headcount: number } }
  | { status: 400 | 404; body: { error: string } };

/**
 * Create or update an RSVP. Duplicate email on the same event updates the row
 * (spec AC 3). New confirmed seats are refused at headcount with "event is full".
 * Count checks run under the event row lock so concurrent RSVPs cannot overbook.
 */
export async function createRsvp(
  database: Pool,
  eventId: string,
  body: unknown,
  today: string,
): Promise<CreateRsvpResult> {
  if (!UUID.test(eventId)) {
    return { status: 400, body: { error: "That event link is not valid." } };
  }

  const parsed = readRsvpBody(body);
  if (!parsed.ok) {
    return { status: 400, body: { error: parsed.message } };
  }

  return withTransaction(database, async (client) => {
    const event = await lockEvent(client, eventId);
    if (event === null) {
      return { status: 404, body: { error: "That event was not found." } };
    }
    // Match F-301 visibility: unpublished pages must not accept public RSVPs (replay / stale tab).
    if (!event.public_page_published) {
      return { status: 404, body: { error: "That event page is not available." } };
    }
    if (event.event_date < today) {
      return { status: 400, body: { error: "this event has passed." } };
    }

    const { rows: existingRows } = await client.query<RsvpRow>(
      `SELECT id, event_id, name, email, phone, status, created_at
         FROM rsvps
        WHERE event_id = $1
          AND email = $2
        FOR UPDATE`,
      [eventId, parsed.value.email],
    );
    const existing = existingRows[0];

    if (existing !== undefined) {
      const reactivating = existing.status === "cancelled";
      if (reactivating) {
        const confirmed = await countConfirmed(client, eventId);
        if (confirmed >= event.headcount) {
          return { status: 400, body: { error: "event is full" } };
        }
      }
      const { rows } = await client.query<RsvpRow>(
        `UPDATE rsvps
            SET name = $3,
                phone = $4,
                status = 'confirmed'
          WHERE event_id = $1
            AND id = $2
          RETURNING id, event_id, name, email, phone, status, created_at`,
        [eventId, existing.id, parsed.value.name, parsed.value.phone],
      );
      const rsvp = rows[0];
      if (rsvp === undefined) {
        return { status: 400, body: { error: "RSVP could not be saved." } };
      }
      return {
        status: 200,
        body: {
          rsvp,
          confirmed_count: await countConfirmed(client, eventId),
          headcount: event.headcount,
        },
      };
    }

    const confirmed = await countConfirmed(client, eventId);
    if (confirmed >= event.headcount) {
      return { status: 400, body: { error: "event is full" } };
    }

    const id = randomUUID();
    const { rows } = await client.query<RsvpRow>(
      `INSERT INTO rsvps (id, event_id, name, email, phone, status)
       VALUES ($1, $2, $3, $4, $5, 'confirmed')
       RETURNING id, event_id, name, email, phone, status, created_at`,
      [id, eventId, parsed.value.name, parsed.value.email, parsed.value.phone],
    );
    const rsvp = rows[0];
    if (rsvp === undefined) {
      return { status: 400, body: { error: "RSVP could not be saved." } };
    }
    return {
      status: 201,
      body: {
        rsvp,
        confirmed_count: confirmed + 1,
        headcount: event.headcount,
      },
    };
  });
}

export type ListRsvpsResult =
  | {
      status: 200;
      body: {
        event: { id: string; name: string; headcount: number; event_date: string };
        rsvps: RsvpRow[];
        confirmed_count: number;
      };
    }
  | { status: 400 | 404; body: { error: string } };

/** Organizer guest list: every RSVP row plus count vs headcount. */
export async function listRsvps(database: Queryable, eventId: string): Promise<ListRsvpsResult> {
  if (!UUID.test(eventId)) {
    return { status: 400, body: { error: "That event link is not valid." } };
  }

  const { rows: events } = await database.query<{
    id: string;
    name: string;
    headcount: number;
    event_date: string;
  }>(
    `SELECT id, name, headcount, event_date::text AS event_date
       FROM events
      WHERE id = $1`,
    [eventId],
  );
  const event = events[0];
  if (event === undefined) {
    return { status: 404, body: { error: "That event was not found." } };
  }

  const { rows: rsvps } = await database.query<RsvpRow>(
    `SELECT id, event_id, name, email, phone, status, created_at
       FROM rsvps
      WHERE event_id = $1
      ORDER BY created_at ASC`,
    [eventId],
  );
  const confirmed_count = rsvps.filter((row) => row.status === "confirmed").length;
  return {
    status: 200,
    body: {
      event: {
        id: event.id,
        name: event.name,
        headcount: event.headcount,
        event_date: event.event_date,
      },
      rsvps,
      confirmed_count,
    },
  };
}

export type CancelRsvpResult =
  | { status: 200; body: { rsvp: RsvpRow; confirmed_count: number; headcount: number } }
  | { status: 400 | 404; body: { error: string } };

/** Organizer cancel: status → cancelled, frees a confirmed seat (spec AC 5). */
export async function cancelRsvp(
  database: Pool,
  eventId: string,
  rsvpId: string,
): Promise<CancelRsvpResult> {
  if (!UUID.test(eventId) || !UUID.test(rsvpId)) {
    return { status: 400, body: { error: "That RSVP link is not valid." } };
  }

  return withTransaction(database, async (client) => {
    const event = await lockEvent(client, eventId);
    if (event === null) {
      return { status: 404, body: { error: "That event was not found." } };
    }

    const { rows } = await client.query<RsvpRow>(
      `UPDATE rsvps
          SET status = 'cancelled'
        WHERE event_id = $1
          AND id = $2
        RETURNING id, event_id, name, email, phone, status, created_at`,
      [eventId, rsvpId],
    );
    const rsvp = rows[0];
    if (rsvp === undefined) {
      return { status: 404, body: { error: "That RSVP was not found." } };
    }
    return {
      status: 200,
      body: {
        rsvp,
        confirmed_count: await countConfirmed(client, eventId),
        headcount: event.headcount,
      },
    };
  });
}

const handle =
  (route: (req: Request, res: Response) => Promise<void>) =>
  (req: Request, res: Response, next: (error?: unknown) => void): void => {
    route(req, res).catch(next);
  };

export function createRsvpsRouter(dependencies: RsvpsDependencies): Router {
  const { database, today } = dependencies;
  const router = Router();

  // Public create stays on /rsvps so Access can bypass that path for attendees.
  // Organizer list/cancel live on /guests — required with F-301: Access bypass matches
  // path not method (DEPLOY.md §5 / issue #13), so GET cannot stay on /rsvps.
  router.post(
    "/events/:id/rsvps",
    handle(async (req, res) => {
      const result = await createRsvp(database, req.params.id ?? "", req.body, today());
      res.status(result.status).json(result.body);
    }),
  );

  router.get(
    "/events/:id/guests",
    handle(async (req, res) => {
      const result = await listRsvps(database, req.params.id ?? "");
      res.status(result.status).json(result.body);
    }),
  );

  router.patch(
    "/events/:id/guests/:rsvpId",
    handle(async (req, res) => {
      const body = req.body;
      const status =
        typeof body === "object" && body !== null && !Array.isArray(body)
          ? (body as Record<string, unknown>).status
          : undefined;
      if (status !== "cancelled") {
        res.status(400).json({ error: "Only status cancelled is supported." });
        return;
      }
      const result = await cancelRsvp(database, req.params.id ?? "", req.params.rsvpId ?? "");
      res.status(result.status).json(result.body);
    }),
  );

  return router;
}
