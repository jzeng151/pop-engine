import express, { type Express, type Response } from "express";
import { describeEngine, EvaluationError } from "@pop-engine/engine";
import { createAlertsRouter, type AlertsDependencies } from "./alerts";
import { createCheckinsRouter } from "./checkins";
import { createChecklistRouter, type ChecklistDependencies } from "./checklist";
import { createEventsRouter, type EventsDependencies } from "./events";
import { EventNotFoundError, PlanIntegrityError, type PlanService } from "./plan";
import { createPublicPageRouter } from "./public-page";
import { createRsvpsRouter } from "./rsvps";
import { createStatsRouter } from "./stats";
import { requireSupabaseAuth, type VerifyAccessToken } from "./auth";

/**
 * What the loaded rules file says about itself (F-206). `snapshotDate` is the date the ruleset
 * was published, not a date on which its facts were re-verified — the banner copy must never
 * read "verified as of".
 */
export type RulesMeta = { rulesetVersion: string; snapshotDate: string };

export type AppDependencies = EventsDependencies & {
  /** Absent in the scaffold's own tests; the plan routes register only when it is supplied. */
  planService?: PlanService;
  /** Same contract for F-202: the checklist routes register only when storage is supplied. */
  checklist?: ChecklistDependencies;
  /** Same contract for F-203: the alert test route registers only when senders are supplied. */
  alerts?: AlertsDependencies;
  /** Absent in the scaffold's own tests; the rules-meta route registers only when it is supplied. */
  rulesMeta?: RulesMeta;
  /** F-701 foundation only: verifies identity; it does not infer workspace or role authorization. */
  verifyAccessToken?: VerifyAccessToken;
};

// The Express app factory. Kept separate from the server bootstrap (index.ts) so tests
// can drive it with supertest without opening a port.
export function createApp(dependencies: AppDependencies): Express {
  const app = express();

  // The web app is served from a different origin than the api in both local dev and on
  // Railway (DEPLOY.md), so browser calls need CORS. Single allowed origin per
  // ARCHITECTURE.md; CORS is not authorization (AD-5, the gate is Cloudflare Access).
  const webOrigin = process.env.WEB_ORIGIN ?? "http://localhost:3000";
  app.use((req, res, next) => {
    res.setHeader("Access-Control-Allow-Origin", webOrigin);
    // Behind Cloudflare Access the web host calls the api with credentials so the
    // CF_Authorization cookie rides along; credentialed CORS requires this header and a
    // single non-wildcard origin (which `webOrigin` already is).
    res.setHeader("Access-Control-Allow-Credentials", "true");
    if (req.method === "OPTIONS") {
      res.setHeader("Access-Control-Allow-Methods", "GET,POST,PATCH,DELETE,OPTIONS");
      // X-Filename carries a document upload's display name (F-202). A preflight that lists a
      // header this allowlist omits fails in the browser before the route is ever reached, and
      // web and api are separately hosted, so that is the normal path rather than an edge case.
      res.setHeader(
        "Access-Control-Allow-Headers",
        "Authorization, Content-Type, X-Filename, X-Upload-Key",
      );
      res.sendStatus(204);
      return;
    }
    next();
  });

  app.use(express.json());

  // Liveness probe for Railway / Cloudflare health checks. The `engine` field also
  // proves the @pop-engine/engine workspace package resolves end to end.
  app.get("/health", (_req, res) => {
    res.json({ status: "ok", service: "pop-engine-api", engine: describeEngine() });
  });

  if (dependencies.verifyAccessToken === undefined) {
    app.get("/api/session", (_req, res) => {
      res.status(503).json({ error: "Supabase authentication is not configured." });
    });
  } else {
    app.get("/api/session", requireSupabaseAuth(dependencies.verifyAccessToken), (_req, res) => {
      res.json({ actor: res.locals.actor as { id: string; email?: string } });
    });
  }

  app.use("/api", createEventsRouter(dependencies));
  // F-401 / F-302: only need pool (+ today for RSVP date checks) already on AppDependencies —
  // no index.ts wiring beyond what events already use.
  app.use(
    "/api",
    createCheckinsRouter({ database: dependencies.database, today: dependencies.today }),
  );
  app.use(
    "/api",
    createRsvpsRouter({ database: dependencies.database, today: dependencies.today }),
  );
  // F-402: organizer live-ops totals; polled ~5s. Same Access gate as /guests (not CF-bypassed).
  app.use("/api", createStatsRouter({ database: dependencies.database }));
  // F-301: registers GET /e/:eventId at the app root (ARCHITECTURE) plus organizer
  // /api/events/:id/public-page routes on the same router.
  app.use(createPublicPageRouter({ database: dependencies.database }));
  if (dependencies.planService !== undefined) registerPlanRoutes(app, dependencies.planService);
  if (dependencies.checklist !== undefined) {
    app.use("/api", createChecklistRouter(dependencies.checklist));
  }
  if (dependencies.alerts !== undefined) {
    app.use("/api", createAlertsRouter(dependencies.alerts));
  }
  if (dependencies.rulesMeta !== undefined) registerRulesRoutes(app, dependencies.rulesMeta);

  return app;
}

/**
 * F-206: what the snapshot banner reads. The values come from the rules file the api loaded at
 * boot, so the banner states the artifact rather than a copy of it.
 */
function registerRulesRoutes(app: Express, meta: RulesMeta): void {
  app.get("/api/rules/meta", (_req, res) => {
    res.json({ ruleset_version: meta.rulesetVersion, snapshot_date: meta.snapshotDate });
  });
}

/**
 * F-201/F-102 plan routes. A rule-evaluation failure returns an explicit error and never a
 * plan with no findings, so the api can never present a failure as "nothing required" (AC 5).
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * A malformed id must not reach `WHERE id = $1`: Postgres raises 22P02 coercing it to uuid, which
 * would surface as a 500 carrying driver error text. Client mistakes get a client error, and
 * database internals stay on the server.
 */
function rejectMalformedId(id: string, res: Response): boolean {
  if (UUID.test(id)) return false;
  res.status(400).json({ error: "event id must be a uuid" });
  return true;
}

/** Only our own messages are safe to echo; anything else could carry driver detail. */
function respondWithFailure(res: Response, error: unknown, summary: string): void {
  if (error instanceof EvaluationError || error instanceof PlanIntegrityError) {
    res.status(500).json({ error: summary, detail: error.message });
    return;
  }
  console.error(summary, error);
  res.status(500).json({ error: summary });
}

function registerPlanRoutes(app: Express, planService: PlanService): void {
  app.post("/api/events/:id/plan", (req, res) => {
    const eventId = req.params.id;
    if (rejectMalformedId(eventId, res)) return;
    planService
      .generate(eventId)
      .then((plan) => res.status(201).json(plan))
      .catch((error: unknown) => {
        if (error instanceof EventNotFoundError) {
          res.status(404).json({ error: error.message });
          return;
        }
        respondWithFailure(res, error, "plan generation failed");
      });
  });

  app.get("/api/events/:id/plan", (req, res) => {
    const eventId = req.params.id;
    if (rejectMalformedId(eventId, res)) return;
    planService
      .latest(eventId)
      .then((plan) => {
        if (plan === null) {
          res.status(404).json({ error: `no plan generated for event ${eventId}` });
          return;
        }
        res.json(plan);
      })
      .catch((error: unknown) => {
        if (error instanceof EventNotFoundError) {
          res.status(404).json({ error: error.message });
          return;
        }
        respondWithFailure(res, error, "plan lookup failed");
      });
  });
}
