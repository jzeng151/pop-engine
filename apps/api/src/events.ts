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

// F-101 intake endpoints (ARCHITECTURE.md API Surface): create, read, and edit the one
// event row every later module reads. All field rules come from the engine's intake
// contract, which is parsed from the published ruleset — this file only moves rows.

// Postgres returns `date` and `numeric` as driver-specific shapes: a Date in the server's
// local zone (which can shift the calendar day) and a string. Intake stores plain
// calendar dates and small decimals, so read them back as the JSON types they went in as.
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

/**
 * Run an edit against an event with its row locked for the whole decision.
 *
 * Reading the row, deciding whether the edit changes anything, writing, and reading the
 * plan's revision all have to describe one moment. Without the lock a concurrent PATCH
 * can commit between the read and the response, and this request answers with a row
 * that no longer exists as described — an event rolled back to an older revision, or a
 * plan reported current against a revision the event has already passed.
 *
 * The response is built inside the transaction but returned for sending after the
 * commit: a client that reads back the moment it is answered must not be able to see a
 * state older than the one it was just told about.
 */
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
  return body as Record<string, unknown>;
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

  const insert = async (values: IntakeRecord): Promise<EventRow> => {
    const id = randomUUID();
    const { rows } = await database.query<EventRow>(
      `INSERT INTO events (id, ${quoted(columns)})
       VALUES ($1, ${columns.map((_column, index) => `$${index + 2}`).join(", ")})
       RETURNING *`,
      [id, ...columns.map((column) => values[column] ?? null)],
    );
    return rows[0] as EventRow;
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
      const submission = readSubmission(req, res);
      if (submission === null) return;

      const { values, errors, warnings } = validateIntake(intakeContract, submission, today());
      if (values === null) {
        res.status(400).json({ errors, warnings });
        return;
      }
      const created = await eventResponse(database, intakeContract, await insert(values), 201);
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

      // Every read this response is built from is taken under the row lock, so the
      // event, the decision about whether anything changed, and the plan's revision all
      // describe the same moment. A concurrent edit either lands entirely before this
      // one or waits for it.
      const response = await withLockedEvent(database, id, async (client, stored) => {
        if (stored === null) return notFound;

        // The whole intake is re-validated after the edit is applied, so an edit cannot
        // leave the row in a state the intake would have refused to create. Answers the
        // edit hides are cleared by the merge, so a rescope (street event → park) saves
        // without the client having to null out every SAPO answer by hand.
        const edited = mergeIntakeEdit(intakeContract, pickIntake(stored, columns), submission);
        const { values, errors, warnings } = validateIntake(intakeContract, edited, today());
        if (values === null) return { status: 400, body: { errors, warnings } };
        // A save that changes no answer is not an edit (AD-13), so it leaves the revision
        // counter alone. Bumping it would report a plan as stale against an intake it
        // still matches exactly, forcing a regeneration that can only produce the same
        // plan. Checked here rather than in the client so it holds for every caller.
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
