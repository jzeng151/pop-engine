import { randomUUID } from "node:crypto";
import { Router, type Request, type Response } from "express";
import { types, type Pool, type QueryResult, type QueryResultRow } from "pg";
import {
  intakeColumnNames,
  intakeWarnings,
  isIntakeUnchanged,
  mergeIntakeEdit,
  validateIntake,
  type IntakeAnswers,
  type IntakeContract,
  type IntakeRecord,
} from "@pop-engine/engine";

// F-101 intake endpoints (ARCHITECTURE.md API Surface): create, read, and edit the one event row every later module reads.
const DATE_OID = 1082;
const NUMERIC_OID = 1700;
types.setTypeParser(DATE_OID, (value) => value);
types.setTypeParser(NUMERIC_OID, Number);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type EventsDependencies = {
  database: Pool;
  intakeContract: IntakeContract;
  /** Injected so the past-date check is testable; the engine never reads a clock. */
  today: () => string;
};

type EventRow = Record<string, unknown> & { id: string; revision_counter: number };
type CreateReplayRow = EventRow & { create_request_matches: boolean };

/** A pool or a single pooled connection. Reads that must agree with each other take the
 * same connection, so they see one consistent moment of the database. */
type Queryable = {
  query<Row extends QueryResultRow>(text: string, values?: unknown[]): Promise<QueryResult<Row>>;
};

const quoted = (columns: readonly string[]): string =>
  columns.map((column) => `"${column}"`).join(", ");

async function readEvent(database: Queryable, id: string): Promise<EventRow | null> {
  const { rows } = await database.query<EventRow>("SELECT * FROM events WHERE id = $1", [id]);
  return rows[0] ?? null;
}

/**
 * A plan is stale once the event has been edited past the revision the plan evaluated
 * (AD-13). No plan yet is not stale.
 */
async function isPlanStale(database: Queryable, event: EventRow): Promise<boolean> {
  const { rows } = await database.query<{ event_revision: number }>(
    "SELECT event_revision FROM permit_plans WHERE event_id = $1 ORDER BY generated_at DESC LIMIT 1",
    [event.id],
  );
  const latest = rows[0];
  return latest !== undefined && latest.event_revision < event.revision_counter;
}

/** A response held until the work behind it is durable, rather than sent mid-transaction. */
type EventResponse = { status: number; body: unknown };

async function eventResponse(
  database: Queryable,
  intakeContract: IntakeContract,
  event: EventRow,
  status: number,
): Promise<EventResponse> {
  const activeEvent = { ...event };
  delete activeEvent.food_affinity_private_exception_claimed;
  delete activeEvent.venue_has_assembly_approval;
  delete activeEvent.create_idempotency_key;
  delete activeEvent.create_request_body;
  return {
    status,
    body: {
      event: activeEvent,
      warnings: intakeWarnings(intakeContract, event as IntakeAnswers),
      plan_stale: await isPlanStale(database, event),
    },
  };
}

const notFound: EventResponse = { status: 404, body: { error: "event not found" } };

/** Run an edit against an event with its row locked for the whole decision. */
async function withLockedEvent(
  database: Pool,
  id: string,
  edit: (client: Queryable, stored: EventRow | null) => Promise<EventResponse>,
): Promise<EventResponse> {
  const client = await database.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query<EventRow>("SELECT * FROM events WHERE id = $1 FOR UPDATE", [
      id,
    ]);
    const response = await edit(client, rows[0] ?? null);
    await client.query("COMMIT");
    return response;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

function readSubmission(req: Request, res: Response): Record<string, unknown> | null {
  const body: unknown = req.body;
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    res.status(400).json({
      errors: [{ field: "body", code: "invalid_body", message: "body must be a JSON object" }],
      warnings: [],
    });
    return null;
  }
  if (hasUnsafeNumber(body)) {
    res.status(400).json({
      errors: [{ field: "body", code: "invalid_body", message: "body numbers must be safe" }],
      warnings: [],
    });
    return null;
  }
  return body as Record<string, unknown>;
}

function hasUnsafeNumber(value: unknown): boolean {
  if (typeof value === "number") {
    return !Number.isFinite(value) || (Number.isInteger(value) && !Number.isSafeInteger(value));
  }
  if (Array.isArray(value)) return value.some(hasUnsafeNumber);
  return typeof value === "object" && value !== null && Object.values(value).some(hasUnsafeNumber);
}

function readIdempotencyKey(req: Request, res: Response): string | null {
  const key = req.get("Idempotency-Key");
  if (key !== undefined && UUID.test(key)) return key.toLowerCase();
  res.status(400).json({
    errors: [
      {
        field: "Idempotency-Key",
        code: key === undefined ? "required" : "invalid_value",
        message:
          key === undefined ? "Idempotency-Key is required" : "Idempotency-Key must be a UUID",
      },
    ],
    warnings: [],
  });
  return null;
}

/** Fail the request the way Express expects, so one thrown query cannot hang a client. */
const handle =
  (route: (req: Request, res: Response) => Promise<void>) =>
  (req: Request, res: Response, next: (error?: unknown) => void): void => {
    route(req, res).catch(next);
  };

export function createEventsRouter(dependencies: EventsDependencies): Router {
  const { database, intakeContract, today } = dependencies;
  const columns = intakeColumnNames(intakeContract);
  const router = Router();

  const readCreateReplay = async (
    key: string,
    requestBody: string,
  ): Promise<{ event: EventRow; matches: boolean } | null> => {
    const { rows } = await database.query<CreateReplayRow>(
      `SELECT events.*, create_request_body = $2::jsonb AS create_request_matches
         FROM events
        WHERE create_idempotency_key = $1`,
      [key, requestBody],
    );
    const row = rows[0];
    if (row === undefined) return null;
    const { create_request_matches: matches, ...event } = row;
    return { event, matches };
  };

  const insert = async (
    key: string,
    requestBody: string,
    values: IntakeRecord,
  ): Promise<EventRow | null> => {
    const id = randomUUID();
    const { rows } = await database.query<EventRow>(
      `INSERT INTO events (id, create_idempotency_key, create_request_body, ${quoted(columns)})
       VALUES ($1, $2, $3::jsonb, ${columns.map((_column, index) => `$${index + 4}`).join(", ")})
       ON CONFLICT (create_idempotency_key) DO NOTHING
       RETURNING *`,
      [id, key, requestBody, ...columns.map((column) => values[column] ?? null)],
    );
    return rows[0] ?? null;
  };

  // Every edit bumps the revision counter server-side, which is what marks an existing
  // plan stale (spec #8) — plans pin the revision they evaluated rather than being patched.
  const update = async (client: Queryable, id: string, values: IntakeRecord): Promise<EventRow> => {
    const assignments = columns.map((column, index) => `"${column}" = $${index + 2}`).join(", ");
    const { rows } = await client.query<EventRow>(
      `UPDATE events
          SET ${assignments},
              revision_counter = revision_counter + 1,
              updated_at = current_timestamp
        WHERE id = $1
        RETURNING *`,
      [id, ...columns.map((column) => values[column] ?? null)],
    );
    return rows[0] as EventRow;
  };

  router.post(
    "/events",
    handle(async (req, res) => {
      const key = readIdempotencyKey(req, res);
      if (key === null) return;
      const submission = readSubmission(req, res);
      if (submission === null) return;
      const requestBody = JSON.stringify(submission);

      const replay = await readCreateReplay(key, requestBody);
      if (replay !== null) {
        if (!replay.matches) {
          res.status(409).json({ error: "Idempotency-Key was already used with a different body" });
          return;
        }
        const response = await eventResponse(database, intakeContract, replay.event, 200);
        res.status(response.status).json(response.body);
        return;
      }

      const { values, errors, warnings } = validateIntake(intakeContract, submission, today());
      if (values === null) {
        res.status(400).json({ errors, warnings });
        return;
      }

      const inserted = await insert(key, requestBody, values);
      const result =
        inserted === null
          ? await readCreateReplay(key, requestBody)
          : { event: inserted, matches: true };
      if (result === null) throw new Error("idempotent event create committed no readable result");
      if (!result.matches) {
        res.status(409).json({ error: "Idempotency-Key was already used with a different body" });
        return;
      }
      const created = await eventResponse(
        database,
        intakeContract,
        result.event,
        inserted === null ? 200 : 201,
      );
      res.status(created.status).json(created.body);
    }),
  );

  router.get(
    "/events/:id",
    handle(async (req, res) => {
      const id = req.params.id ?? "";
      const event = UUID.test(id) ? await readEvent(database, id) : null;
      const response =
        event === null ? notFound : await eventResponse(database, intakeContract, event, 200);
      res.status(response.status).json(response.body);
    }),
  );

  router.patch(
    "/events/:id",
    handle(async (req, res) => {
      const submission = readSubmission(req, res);
      if (submission === null) return;

      const id = req.params.id ?? "";
      if (!UUID.test(id)) {
        res.status(notFound.status).json(notFound.body);
        return;
      }

      // Every read this response is built from is taken under the row lock, so the event, the decision about whether anything changed, and the plan's revision all describe the same moment.
      const response = await withLockedEvent(database, id, async (client, stored) => {
        if (stored === null) return notFound;

        // The whole intake is re-validated after the edit is applied, so an edit cannot leave the row in a state the intake would have refused to create.
        const edited = mergeIntakeEdit(intakeContract, pickIntake(stored, columns), submission);
        const { values, errors, warnings } = validateIntake(intakeContract, edited, today());
        if (values === null) return { status: 400, body: { errors, warnings } };
        // A save that changes no answer is not an edit (AD-13), so it leaves the revision counter alone.
        const event = isIntakeUnchanged(intakeContract, stored, values)
          ? stored
          : await update(client, stored.id, values);
        return eventResponse(client, intakeContract, event, 200);
      });
      res.status(response.status).json(response.body);
    }),
  );

  return router;
}

function pickIntake(row: EventRow, columns: readonly string[]): Record<string, unknown> {
  return Object.fromEntries(columns.map((column) => [column, row[column]]));
}
