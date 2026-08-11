import { Router, type Request, type Response } from "express";
import type { Pool, QueryResult, QueryResultRow } from "pg";

// F-301 public event page (ARCHITECTURE.md API Surface).

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type PublicPageDependencies = {
  database: Pool;
};

type Queryable = {
  query<Row extends QueryResultRow>(text: string, values?: unknown[]): Promise<QueryResult<Row>>;
};

type EventPublicRow = {
  id: string;
  name: string;
  event_date: string;
  location_name: string | null;
  borough: string;
  headcount: number;
  description: string | null;
  public_page_published: boolean;
};

export type PublicEventPayload = {
  id: string;
  title: string;
  event_date: string;
  venue: string | null;
  borough: string;
  description: string | null;
  /** Null when intake has no venue — do not link a borough-only search (F-301 AC 5). */
  map_url: string | null;
  rsvp_enabled: true;
};

/** Maps search link — no maps API (spec AC 5). Requires a venue address. */
export function mapUrlForVenue(locationName: string | null, borough: string): string | null {
  if (locationName === null || locationName.trim() === "") {
    return null;
  }
  const query = [locationName.trim(), borough.replace(/_/g, " "), "NYC"].join(", ");
  return `https://maps.google.com/?q=${encodeURIComponent(query)}`;
}

function toPublicPayload(row: EventPublicRow): PublicEventPayload {
  return {
    id: row.id,
    title: row.name,
    event_date: row.event_date,
    venue: row.location_name,
    borough: row.borough,
    description: row.description,
    map_url: mapUrlForVenue(row.location_name, row.borough),
    // F-302 is present in this deploy path; AC 4's degradation is for builds without it.
    rsvp_enabled: true,
  };
}

async function readEvent(database: Queryable, eventId: string): Promise<EventPublicRow | null> {
  const { rows } = await database.query<EventPublicRow>(
    `SELECT id, name, event_date::text AS event_date, location_name, borough, headcount,
            description, public_page_published
       FROM events
      WHERE id = $1`,
    [eventId],
  );
  return rows[0] ?? null;
}

async function latestVerdict(database: Queryable, eventId: string): Promise<string | null> {
  const { rows } = await database.query<{ verdict: string }>(
    `SELECT verdict
       FROM permit_plans
      WHERE event_id = $1
      ORDER BY generated_at DESC, id DESC
      LIMIT 1`,
    [eventId],
  );
  return rows[0]?.verdict ?? null;
}

export type GetPublicEventResult =
  { status: 200; body: PublicEventPayload } | { status: 400 | 404; body: { error: string } };

/** Public read — unpublished or unknown → friendly 404, never stack/driver text. */
export async function getPublicEvent(
  database: Queryable,
  eventId: string,
): Promise<GetPublicEventResult> {
  if (!UUID.test(eventId)) {
    return { status: 400, body: { error: "That event link is not valid." } };
  }
  const event = await readEvent(database, eventId);
  if (event === null || !event.public_page_published) {
    return { status: 404, body: { error: "That event page is not available." } };
  }
  return { status: 200, body: toPublicPayload(event) };
}

export type OrganizerPublicPage = {
  event_id: string;
  title: string;
  event_date: string;
  venue: string | null;
  borough: string;
  description: string | null;
  public_page_published: boolean;
  public_path: string;
  map_url: string | null;
  infeasible_warning: boolean;
};

export type GetOrganizerPageResult =
  { status: 200; body: OrganizerPublicPage } | { status: 400 | 404; body: { error: string } };

export async function getOrganizerPublicPage(
  database: Queryable,
  eventId: string,
): Promise<GetOrganizerPageResult> {
  if (!UUID.test(eventId)) {
    return { status: 400, body: { error: "That event link is not valid." } };
  }
  const event = await readEvent(database, eventId);
  if (event === null) {
    return { status: 404, body: { error: "That event was not found." } };
  }
  const verdict = await latestVerdict(database, eventId);
  return {
    status: 200,
    body: {
      event_id: event.id,
      title: event.name,
      event_date: event.event_date,
      venue: event.location_name,
      borough: event.borough,
      description: event.description,
      public_page_published: event.public_page_published,
      public_path: `/e/${event.id}`,
      map_url: mapUrlForVenue(event.location_name, event.borough),
      infeasible_warning: verdict === "infeasible",
    },
  };
}

export type PatchOrganizerPageResult =
  { status: 200; body: OrganizerPublicPage } | { status: 400 | 404; body: { error: string } };

export async function patchOrganizerPublicPage(
  database: Queryable,
  eventId: string,
  body: unknown,
): Promise<PatchOrganizerPageResult> {
  if (!UUID.test(eventId)) {
    return { status: 400, body: { error: "That event link is not valid." } };
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { status: 400, body: { error: "body must be a JSON object" } };
  }
  const record = body as Record<string, unknown>;
  const hasDescription = Object.prototype.hasOwnProperty.call(record, "description");
  const hasPublished = Object.prototype.hasOwnProperty.call(record, "public_page_published");
  if (!hasDescription && !hasPublished) {
    return {
      status: 400,
      body: { error: "Provide description and/or public_page_published." },
    };
  }

  let description: string | null | undefined;
  if (hasDescription) {
    if (record.description === null) {
      description = null;
    } else if (typeof record.description === "string") {
      description = record.description.trim() === "" ? null : record.description.trim();
    } else {
      return { status: 400, body: { error: "description must be a string or null" } };
    }
  }

  let published: boolean | undefined;
  if (hasPublished) {
    if (typeof record.public_page_published !== "boolean") {
      return { status: 400, body: { error: "public_page_published must be a boolean" } };
    }
    published = record.public_page_published;
  }

  // Update only supplied columns so a description-only save cannot clobber a concurrent
  // publish/unpublish (or the reverse) from a stale read-merge-write.
  const sets = ["updated_at = current_timestamp"];
  const values: unknown[] = [eventId];
  let next = 2;
  if (description !== undefined) {
    sets.push(`description = $${next}`);
    values.push(description);
    next += 1;
  }
  if (published !== undefined) {
    sets.push(`public_page_published = $${next}`);
    values.push(published);
    next += 1;
  }

  const { rows } = await database.query<{ id: string }>(
    `UPDATE events
        SET ${sets.join(", ")}
      WHERE id = $1
      RETURNING id`,
    values,
  );
  if (rows[0] === undefined) {
    return { status: 404, body: { error: "That event was not found." } };
  }

  // Publishing does not bump revision_counter — description is promotion copy, not intake.
  return getOrganizerPublicPage(database, eventId);
}

const handle =
  (route: (req: Request, res: Response) => Promise<void>) =>
  (req: Request, res: Response, next: (error?: unknown) => void): void => {
    route(req, res).catch(next);
  };

export function createPublicPageRouter(dependencies: PublicPageDependencies): Router {
  const { database } = dependencies;
  const router = Router();

  // Mounted at app root so GET /e/:eventId matches ARCHITECTURE (not under /api).
  router.get(
    "/e/:eventId",
    handle(async (req, res) => {
      const result = await getPublicEvent(database, req.params.eventId ?? "");
      res.status(result.status).json(result.body);
    }),
  );

  router.get(
    "/api/events/:id/public-page",
    handle(async (req, res) => {
      const result = await getOrganizerPublicPage(database, req.params.id ?? "");
      res.status(result.status).json(result.body);
    }),
  );

  router.patch(
    "/api/events/:id/public-page",
    handle(async (req, res) => {
      const result = await patchOrganizerPublicPage(database, req.params.id ?? "", req.body);
      res.status(result.status).json(result.body);
    }),
  );

  return router;
}
