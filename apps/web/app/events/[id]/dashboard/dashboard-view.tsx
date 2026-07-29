"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { rememberLastEvent } from "../../../last-event";
import {
  loadEventDoorContext,
  loadEventStats,
  STATS_FETCH_TIMEOUT_MS,
  STATS_POLL_MS,
  type EventDoorContext,
  type EventStats,
} from "./dashboard-api";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Stable production clock — an inline default would recreate each render and restart the poll effect. */
const systemNow = (): number => Date.now();

export type DashboardViewProps = {
  eventId: string;
  apiBaseUrl: string;
  /** Injectable clock for tests; production uses Date.now. */
  now?: () => number;
  /** Injectable poll interval; production uses STATS_POLL_MS. */
  pollMs?: number;
  /** Injectable fetch abort timeout; production uses STATS_FETCH_TIMEOUT_MS. */
  fetchTimeoutMs?: number;
};

/**
 * Capacity gauge copy + measuring-strip fill. Never invents a percentage when capacity is unset —
 * that would be inventing a number from an unknown denominator (F-402 / same class as AC 3).
 */
export function capacitySummary(stats: EventStats): {
  label: string;
  overCapacity: boolean;
  percentLabel: string | null;
  /** 0–100 strip width; null when capacity is unset (no fill). */
  fillPercent: number | null;
} {
  if (stats.capacity === null) {
    return {
      label: "capacity not set",
      overCapacity: false,
      percentLabel: null,
      fillPercent: null,
    };
  }
  const raw = (stats.checkins_total / stats.capacity) * 100;
  const overCapacity = stats.checkins_total > stats.capacity;
  return {
    label: `${stats.checkins_total} of ${stats.capacity} capacity`,
    overCapacity,
    percentLabel: `${Math.round(raw)}%`,
    fillPercent: Math.min(100, Math.max(0, raw)),
  };
}

/** Staleness line after a failed poll; a frozen live-looking number is worse than an honest age. */
export function lastUpdatedLabel(lastSuccessAt: number, nowMs: number): string {
  const seconds = Math.max(0, Math.floor((nowMs - lastSuccessAt) / 1000));
  return `last updated ${seconds}s ago`;
}

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return false;
  }
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function contextLine(context: EventDoorContext): string {
  const venue =
    context.location_name !== null && context.location_name.length > 0
      ? ` · ${context.location_name}`
      : "";
  return `${context.event_date}${venue}`;
}

export function DashboardView({
  eventId,
  apiBaseUrl,
  now = systemNow,
  pollMs = STATS_POLL_MS,
  fetchTimeoutMs = STATS_FETCH_TIMEOUT_MS,
}: DashboardViewProps) {
  const [stats, setStats] = useState<EventStats | null>(null);
  const [context, setContext] = useState<EventDoorContext | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [lastSuccessAt, setLastSuccessAt] = useState<number | null>(null);
  const [staleTick, setStaleTick] = useState(0);
  const [countTicking, setCountTicking] = useState(false);
  const nowRef = useRef(now);
  nowRef.current = now;
  const previousTotal = useRef<number | null>(null);

  // Intake identity once per event — name/date/venue from F-101, not re-polled with stats.
  useEffect(() => {
    setContext(null);
    if (!UUID.test(eventId)) return;

    let alive = true;
    const abort = new AbortController();
    void loadEventDoorContext(apiBaseUrl, eventId, { signal: abort.signal }).then((result) => {
      if (!alive) return;
      if (result.ok) {
        setContext(result.context);
        rememberLastEvent(result.context);
      }
    });
    return () => {
      alive = false;
      abort.abort();
    };
  }, [apiBaseUrl, eventId]);

  useEffect(() => {
    // Drop the previous event's totals immediately so a slow/failed fetch cannot leave them up.
    setStats(null);
    setFailure(null);
    setLastSuccessAt(null);
    previousTotal.current = null;
    setCountTicking(false);

    if (!UUID.test(eventId)) {
      setFailure("That event link is not valid.");
      return;
    }

    let alive = true;
    let inFlight = false;
    let activeAbort: AbortController | null = null;

    const refresh = async () => {
      // Serialize polls: if latency exceeds pollMs, overlapping requests would each
      // supersede the last and the dashboard would never leave "Loading check-ins…".
      if (inFlight) return;
      inFlight = true;
      const abort = new AbortController();
      activeAbort = abort;
      try {
        const result = await loadEventStats(apiBaseUrl, eventId, {
          signal: abort.signal,
          timeoutMs: fetchTimeoutMs,
        });
        if (!alive) return;
        if (!result.ok) {
          setFailure(result.message);
          return;
        }
        setFailure(null);
        setStats(result.stats);
        setLastSuccessAt(nowRef.current());
      } finally {
        if (activeAbort === abort) activeAbort = null;
        inFlight = false;
      }
    };

    void refresh();
    const poll = window.setInterval(() => {
      void refresh();
    }, pollMs);
    const staleClock = window.setInterval(() => {
      setStaleTick((tick) => tick + 1);
    }, 1000);

    return () => {
      alive = false;
      activeAbort?.abort();
      window.clearInterval(poll);
      window.clearInterval(staleClock);
    };
  }, [apiBaseUrl, eventId, fetchTimeoutMs, pollMs]);

  // Signature motion: one mechanical counter tick when check-ins rise (skipped for reduced motion).
  useEffect(() => {
    if (stats === null) return;
    const prior = previousTotal.current;
    previousTotal.current = stats.checkins_total;
    if (prior === null || stats.checkins_total <= prior || prefersReducedMotion()) {
      return;
    }
    setCountTicking(true);
    const clear = window.setTimeout(() => setCountTicking(false), 280);
    return () => window.clearTimeout(clear);
  }, [stats]);

  if (failure !== null && stats === null) {
    return (
      <div className="ops">
        <p className="pe-eyebrow">Door</p>
        <h1>Live ops</h1>
        <p className="ops__error" role="alert">
          {failure}
        </p>
      </div>
    );
  }

  if (stats === null) {
    return (
      <div className="ops">
        <p className="ops__lede" role="status">
          Loading check-ins…
        </p>
      </div>
    );
  }

  const gauge = capacitySummary(stats);
  const showStale = failure !== null && lastSuccessAt !== null;
  // staleTick forces a re-render each second so the age label advances while polling is down.
  void staleTick;

  const gaugeClass = [
    "ops__gauge",
    gauge.overCapacity ? "ops__gauge--over" : "",
    gauge.fillPercent === null ? "ops__gauge--unset" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className="ops">
      <p className="pe-eyebrow">Door</p>
      <h1>{context?.name ?? "Live ops"}</h1>
      {context !== null && (
        <p className="ops__event" data-testid="event-context">
          {contextLine(context)}
        </p>
      )}
      <p className="ops__lede">
        Arrivals only — labeled check-ins, not how many people are still on site. Capacity is the
        confirmed value from intake when you set one.
      </p>

      <p className="ops__total" data-testid="checkins-total">
        <span
          className={
            countTicking ? "ops__total-number ops__total-number--tick" : "ops__total-number"
          }
        >
          {stats.checkins_total}
        </span>
        <span className="ops__total-label"> check-ins</span>
      </p>

      {stats.checkins_total === 0 && (
        <p className="ops__zero" role="status" data-testid="zero-state">
          0 check-ins so far.
        </p>
      )}

      <p className="ops__recent" data-testid="checkins-last-10min">
        {stats.checkins_last_10min} check-ins in the last 10 minutes
      </p>

      <section className={gaugeClass} aria-label="Capacity" data-testid="capacity-gauge">
        <p className="ops__gauge-label">{gauge.label}</p>
        {gauge.percentLabel !== null && (
          <p className="ops__gauge-percent">{gauge.percentLabel}</p>
        )}
        <div
          className="ops__rule"
          data-testid="capacity-rule"
          style={
            gauge.fillPercent === null
              ? undefined
              : ({ "--ops-fill": `${gauge.fillPercent}%` } as CSSProperties)
          }
          aria-hidden={gauge.fillPercent === null}
        >
          <div className="ops__rule-fill" />
        </div>
        {gauge.overCapacity && (
          <p className="ops__warning" role="status">
            Check-ins are over the confirmed capacity.
          </p>
        )}
      </section>

      <p className="ops__compare" data-testid="rsvp-compare">
        {stats.rsvps_total} RSVPs confirmed · {stats.checkins_total} check-ins
      </p>
      <p className="ops__split" data-testid="checkin-split">
        {stats.checkins_registered} registered check-ins · {stats.checkins_walk_in} walk-in check-ins
      </p>

      <p className="ops__links">
        <a href={`/events/${eventId}/guests`}>Guest list</a>
        {" · "}
        <a href={`/events/${eventId}/promote`}>Promote</a>
        {" · "}
        <a href={`/e/${eventId}/checkin`}>Door check-in</a>
      </p>

      {showStale && lastSuccessAt !== null && (
        <p className="ops__stale" role="status" data-testid="stale-indicator">
          {lastUpdatedLabel(lastSuccessAt, now())}
        </p>
      )}
      {failure !== null && showStale && (
        <p className="ops__error" role="alert">
          {failure}
        </p>
      )}
    </div>
  );
}
