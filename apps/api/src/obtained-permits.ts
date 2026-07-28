// DEMO SCOPE. The read path behind the "Obtained permits" view, plus the one write that records
// what the organizer typed off a permit they already hold. This is NOT F-208 and will be
// superseded by it: no spec, no BASELINE row, and no verdict of any kind is computed here.
//
// It builds on F-202's `checklist_items` and `documents` rather than adding a subsystem. An item
// the organizer set to `approved` (F-202 AC 2 permits setting that directly, which is how an
// already-obtained permit is representable today) is what this lists, and every displayed value
// is either published plan content or something the organizer entered.
//
// THE INVARIANT THIS FILE KEEPS: nothing here infers a permit fact. A permit number, an issue
// date and an expiry are returned only when the organizer stored them, null otherwise, and the
// `approved` status is reported as the organizer's own record rather than as an agency decision.

import { Router, type NextFunction, type Request, type Response } from "express";
import type { Pool, QueryResultRow } from "pg";
import { calendarDateFrom } from "./plan";

export type ObtainedPermitsDependencies = {
  database: Pool;
  /** Today as `YYYY-MM-DD`, the same injected clock the check-in routes read. */
  today: () => string;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

type PermitRow = {
  id: string;
  permit_name: string | null;
  agency: string | null;
  permit_number: string | null;
  issued_on: Date | null;
  expires_on: Date | null;
  notes: string | null;
  updated_at: Date;
};

type DocumentRow = {
  id: string;
  checklist_item_id: string;
  filename: string;
  content_type: string;
  size_bytes: string;
  uploaded_at: Date;
};

const isoDate = (value: Date | null): string | null =>
  value === null ? null : calendarDateFrom(value);

/**
 * A supplied `YYYY-MM-DD`, or `undefined` when the field is absent, or `null` to clear it.
 * `false` means the value was supplied and is not a date this will store.
 */
function readDate(value: unknown): string | null | undefined | false {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== "string" || !ISO_DATE.test(value)) return false;
  // A well-formed string that names no day (2026-02-30) round-trips to a different date, and
  // storing it would show the organizer a date they did not type.
  return new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value ? value : false;
}

export function createObtainedPermitsRouter(dependencies: ObtainedPermitsDependencies): Router {
  const { database, today } = dependencies;
  const router = Router();

  router.get(
    "/events/:id/obtained-permits",
    handle(async (req, res) => {
      const eventId = req.params.id ?? "";
      if (rejectMalformedId(eventId, res, "event id")) return;

      const { rows: events } = await database.query<{ id: string }>(
        "SELECT id FROM events WHERE id = $1",
        [eventId],
      );
      if (events[0] === undefined) {
        res.status(404).json({ error: `event ${eventId} not found` });
        return;
      }

      const { rows } = await database.query<PermitRow>(
        `SELECT checklist.id, item.permit_name, item.agency, checklist.permit_number,
                checklist.issued_on, checklist.expires_on, checklist.notes, checklist.updated_at
           FROM checklist_items AS checklist
           JOIN permit_plan_items AS item ON item.id = checklist.plan_item_id
           JOIN permit_plans AS plan ON plan.id = item.plan_id
          WHERE plan.event_id = $1 AND checklist.status = 'approved'
          ORDER BY checklist.cohort_position, item.rule_ids`,
        [eventId],
      );

      const documents = await documentsFor(
        database,
        rows.map((row) => row.id),
      );
      const asOf = today();

      res.json({
        eventId,
        asOf,
        items: rows.map((row) => {
          const expiresOn = isoDate(row.expires_on);
          return {
            id: row.id,
            permitName: row.permit_name,
            agency: row.agency,
            permitNumber: row.permit_number,
            issuedOn: isoDate(row.issued_on),
            expiresOn,
            // Null when no expiry was recorded. An unrecorded expiry is not an unexpired one,
            // and the view says which of the two it is.
            expired: expiresOn === null ? null : expiresOn < asOf,
            notes: row.notes,
            recordedAt: row.updated_at.toISOString(),
            documents: (documents.get(row.id) ?? []).map((document) => ({
              id: document.id,
              filename: document.filename,
              contentType: document.content_type,
              sizeBytes: Number(document.size_bytes),
              uploadedAt: document.uploaded_at.toISOString(),
            })),
          };
        }),
      });
    }),
  );

  router.patch(
    "/checklist-items/:id/permit-record",
    handle(async (req, res) => {
      const id = req.params.id ?? "";
      if (rejectMalformedId(id, res, "checklist item id")) return;

      const body: unknown = req.body;
      if (typeof body !== "object" || body === null || Array.isArray(body)) {
        res.status(400).json({ error: "body must be a JSON object" });
        return;
      }
      const { permitNumber, issuedOn, expiresOn } = body as {
        permitNumber?: unknown;
        issuedOn?: unknown;
        expiresOn?: unknown;
      };

      if (
        permitNumber !== undefined &&
        permitNumber !== null &&
        typeof permitNumber !== "string"
      ) {
        res.status(400).json({ error: "permitNumber must be a string or null" });
        return;
      }
      const issued = readDate(issuedOn);
      const expires = readDate(expiresOn);
      if (issued === false || expires === false) {
        res.status(400).json({ error: "issuedOn and expiresOn must be YYYY-MM-DD dates or null" });
        return;
      }
      if (permitNumber === undefined && issued === undefined && expires === undefined) {
        res.status(400).json({
          error: "nothing to record: send permitNumber, issuedOn, expiresOn, or any of them",
        });
        return;
      }

      // An empty number is stored as null rather than as an empty string, so "recorded" and
      // "not recorded" stay one distinction instead of two the view has to tell apart.
      const number =
        permitNumber === undefined
          ? undefined
          : permitNumber === null || permitNumber.trim() === ""
            ? null
            : permitNumber.trim();

      const { rows } = await database.query<PermitRow & { status: string }>(
        `UPDATE checklist_items
            SET permit_number = CASE WHEN $2::boolean THEN $3 ELSE permit_number END,
                issued_on = CASE WHEN $4::boolean THEN $5::date ELSE issued_on END,
                expires_on = CASE WHEN $6::boolean THEN $7::date ELSE expires_on END,
                updated_at = current_timestamp
          WHERE id = $1
          RETURNING id, status, permit_number, issued_on, expires_on, notes, updated_at`,
        [
          id,
          number !== undefined,
          number ?? null,
          issued !== undefined,
          issued ?? null,
          expires !== undefined,
          expires ?? null,
        ],
      );
      const updated = rows[0];
      if (updated === undefined) {
        res.status(404).json({ error: `checklist item ${id} not found` });
        return;
      }
      res.json({
        id: updated.id,
        status: updated.status,
        permitNumber: updated.permit_number,
        issuedOn: isoDate(updated.issued_on),
        expiresOn: isoDate(updated.expires_on),
        recordedAt: updated.updated_at.toISOString(),
      });
    }),
  );

  router.use((error: unknown, _req: Request, res: Response, _next: NextFunction): void => {
    console.error("obtained permits request failed", error);
    res.status(500).json({ error: "obtained permits request failed" });
  });

  return router;
}

async function documentsFor(
  database: { query<Row extends QueryResultRow>(text: string, values?: unknown[]): Promise<{ rows: Row[] }> },
  checklistItemIds: readonly string[],
): Promise<Map<string, DocumentRow[]>> {
  const byItem = new Map<string, DocumentRow[]>();
  if (checklistItemIds.length === 0) return byItem;
  const { rows } = await database.query<DocumentRow>(
    `SELECT id, checklist_item_id, filename, content_type, size_bytes, uploaded_at
       FROM documents WHERE checklist_item_id = ANY($1) ORDER BY uploaded_at, id`,
    [checklistItemIds],
  );
  for (const row of rows) {
    const existing = byItem.get(row.checklist_item_id);
    if (existing === undefined) byItem.set(row.checklist_item_id, [row]);
    else existing.push(row);
  }
  return byItem;
}

/** A malformed id must never reach `WHERE id = $1`: Postgres 22P02 would surface as driver text. */
function rejectMalformedId(id: string, res: Response, label: string): boolean {
  if (UUID.test(id)) return false;
  res.status(400).json({ error: `${label} must be a uuid` });
  return true;
}

const handle =
  (route: (req: Request, res: Response) => Promise<void>) =>
  (req: Request, res: Response, next: NextFunction): void => {
    route(req, res).catch(next);
  };
