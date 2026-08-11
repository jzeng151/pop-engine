import { randomUUID } from "node:crypto";
import { Router, type Request, type Response } from "express";
import type { Pool, QueryResult, QueryResultRow } from "pg";

// F-401 app-less QR check-in (ARCHITECTURE.md API Surface + checkins schema).

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Loose email shape: local@domain with at least one dot in the domain. */
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type CheckinsDependencies = {
  database: Pool;
  today: () => string;
};

export type CheckinRow = {
  id: string;
  event_id: string;
  rsvp_id: string | null;
  name: string;
  contact: string;
  checked_in_at: Date | string;
};

type CheckinEvent = {
  id: string;
  name: string;
  event_date: string;
};

type Queryable = {
  query<Row extends QueryResultRow>(text: string, values?: unknown[]): Promise<QueryResult<Row>>;
};

export type NormalizedContact =
  { ok: true; contact: string; kind: "email" | "phone" } | { ok: false; message: string };

/**
 * Contact is the check-in identity key. Emails lower-case and trim; phones keep
 * digits only so "(555) 123-4567" and "5551234567" collide. The same rules are
 * applied when matching an RSVP email or phone for the same event.
 */
export function normalizeContact(raw: string): NormalizedContact {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return { ok: false, message: "contact is required" };
  }
  if (trimmed.includes("@")) {
    const email = trimmed.toLowerCase();
    if (!EMAIL.test(email)) {
      return { ok: false, message: "contact must be a valid email or phone number" };
    }
    return { ok: true, contact: email, kind: "email" };
  }
  if (!/^[0-9+ ()-]+$/.test(trimmed)) {
    return { ok: false, message: "contact must be a valid email or phone number" };
  }
  const digits = trimmed.replace(/\D/g, "");
  if (digits.length < 10 || digits.length > 15) {
    return { ok: false, message: "contact must be a valid email or phone number" };
  }
  return { ok: true, contact: digits, kind: "phone" };
}

type CheckinBody = { name: string; contact: string };

function readCheckinBody(
  body: unknown,
): { ok: true; value: CheckinBody } | { ok: false; message: string } {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { ok: false, message: "body must be a JSON object" };
  }
  const record = body as Record<string, unknown>;
  if (typeof record.name !== "string" || record.name.trim().length === 0) {
    return { ok: false, message: "name is required" };
  }
  if (typeof record.contact !== "string") {
    return { ok: false, message: "contact is required" };
  }
  return { ok: true, value: { name: record.name.trim(), contact: record.contact } };
}

async function readCheckinEvent(
  database: Queryable,
  eventId: string,
): Promise<CheckinEvent | null> {
  const { rows } = await database.query<CheckinEvent>(
    "SELECT id, name, event_date::text AS event_date FROM events WHERE id = $1",
    [eventId],
  );
  return rows[0] ?? null;
}

type GetCheckinEventResult =
  | { status: 200; body: { event: Pick<CheckinEvent, "id" | "name"> } }
  | { status: 400 | 404 | 410; body: { error: string } };

/** Public name-only projection used to render the app-less check-in form. */
async function getCheckinEvent(
  database: Queryable,
  eventId: string,
  today: string,
): Promise<GetCheckinEventResult> {
  if (!UUID.test(eventId)) {
    return { status: 400, body: { error: "That check-in link is not valid." } };
  }
  const event = await readCheckinEvent(database, eventId);
  if (event === null) {
    return { status: 404, body: { error: "That event was not found." } };
  }
  if (event.event_date < today) {
    return { status: 410, body: { error: "That event has ended." } };
  }
  return { status: 200, body: { event: { id: event.id, name: event.name } } };
}

/**
 * Match an RSVP on the same event when the normalized contact equals the RSVP's
 * email (lower-cased) or its phone digits. Cancelled rows stay matchable — the
 * schema links check-ins to the guest-list row, and F-401 does not redefine RSVP
 * status semantics.
 */
async function findMatchingRsvp(
  database: Queryable,
  eventId: string,
  contact: string,
): Promise<string | null> {
  const { rows } = await database.query<{ id: string }>(
    `SELECT id
       FROM rsvps
      WHERE event_id = $1
        AND (
          lower(trim(email)) = $2
          OR (
            phone IS NOT NULL
            AND regexp_replace(phone, '\\D', '', 'g') = $2
          )
        )
      ORDER BY created_at ASC
      LIMIT 1`,
    [eventId, contact],
  );
  return rows[0]?.id ?? null;
}

export type RecordCheckinResult =
  | { status: 200 | 201; body: { checkin: CheckinRow } }
  | { status: 400 | 404 | 410; body: { error: string } };

/**
 * Record a check-in. Over-capacity never blocks (door policy is the organizer's;
 * F-402 flags it). Duplicate contact on the same event updates the existing row
 * instead of inserting a second count.
 */
export async function recordCheckin(
  database: Queryable,
  eventId: string,
  body: unknown,
  today: string,
): Promise<RecordCheckinResult> {
  if (!UUID.test(eventId)) {
    return { status: 400, body: { error: "That check-in link is not valid." } };
  }

  const parsed = readCheckinBody(body);
  if (!parsed.ok) {
    return { status: 400, body: { error: parsed.message } };
  }

  const normalized = normalizeContact(parsed.value.contact);
  if (!normalized.ok) {
    return { status: 400, body: { error: normalized.message } };
  }

  const event = await readCheckinEvent(database, eventId);
  if (event === null) {
    return { status: 404, body: { error: "That event was not found." } };
  }
  if (event.event_date < today) {
    return { status: 410, body: { error: "That event has ended." } };
  }

  const rsvpId = await findMatchingRsvp(database, eventId, normalized.contact);
  const id = randomUUID();
  const { rows } = await database.query<CheckinRow & { was_inserted: boolean }>(
    `INSERT INTO checkins (id, event_id, rsvp_id, name, contact, checked_in_at)
     VALUES ($1, $2, $3, $4, $5, current_timestamp)
     ON CONFLICT (event_id, contact) DO UPDATE
       SET name = EXCLUDED.name,
           rsvp_id = EXCLUDED.rsvp_id,
           checked_in_at = EXCLUDED.checked_in_at
     RETURNING id, event_id, rsvp_id, name, contact, checked_in_at,
               (xmax = 0) AS was_inserted`,
    [id, eventId, rsvpId, parsed.value.name, normalized.contact],
  );
  const row = rows[0];
  if (row === undefined) {
    // Should be unreachable: INSERT … RETURNING always yields a row on success.
    return { status: 400, body: { error: "Check-in could not be recorded." } };
  }
  const { was_inserted, ...checkin } = row;
  return {
    status: was_inserted ? 201 : 200,
    body: { checkin },
  };
}

/** Fail the request the way Express expects, so one thrown query cannot hang a client. */
const handle =
  (route: (req: Request, res: Response) => Promise<void>) =>
  (req: Request, res: Response, next: (error?: unknown) => void): void => {
    route(req, res).catch(next);
  };

export function createCheckinsRouter(dependencies: CheckinsDependencies): Router {
  const { database, today } = dependencies;
  const router = Router();

  router.get(
    "/events/:id/checkins",
    handle(async (req, res) => {
      const result = await getCheckinEvent(database, req.params.id ?? "", today());
      res.status(result.status).json(result.body);
    }),
  );

  router.post(
    "/events/:id/checkins",
    handle(async (req, res) => {
      const result = await recordCheckin(database, req.params.id ?? "", req.body, today());
      res.status(result.status).json(result.body);
    }),
  );

  return router;
}
