import type { HolidayCalendar } from "@pop-engine/engine";

/** The pinned holiday calendar is unavailable, so business-day deadlines cannot be computed. */
export class MissingHolidayCalendarError extends Error {
  constructor(calendarId: string) {
    super(
      `holiday calendar "${calendarId}" has no published holiday list; business-day deadlines ` +
        `render as "confirm with agency" until the product owner publishes it`,
    );
    this.name = "MissingHolidayCalendarError";
  }
}

/** Published holiday lists, keyed by the calendar id a ruleset pins. */
const PUBLISHED_HOLIDAY_CALENDARS: Readonly<Record<string, readonly string[]>> = {};

export function pinnedCalendar(calendarId: string): HolidayCalendar {
  return { id: calendarId, holidays: PUBLISHED_HOLIDAY_CALENDARS[calendarId] ?? null };
}

/** The clock a plan's `today` is read from, per jurisdiction. */
const JURISDICTION_TIME_ZONES: Readonly<Record<string, string>> = {
  "US-NY-NYC": "America/New_York",
};

export class UnmappedJurisdictionError extends Error {
  constructor(jurisdiction: string) {
    super(`no local time zone is mapped for jurisdiction "${jurisdiction}"`);
    this.name = "UnmappedJurisdictionError";
  }
}

/** The zone a jurisdiction's calendar day belongs to, for the readers that cannot take a day. */
export function jurisdictionTimeZone(jurisdiction: string): string {
  const timeZone = JURISDICTION_TIME_ZONES[jurisdiction];
  if (timeZone === undefined) throw new UnmappedJurisdictionError(jurisdiction);
  return timeZone;
}

/** The jurisdiction's calendar day as SQL derives it, at the moment the statement is evaluated. */
export function jurisdictionDayInSql(timeZoneParameter: string): string {
  return `((statement_timestamp() AT TIME ZONE ${timeZoneParameter})::date)`;
}

/** `today` in the jurisdiction's own calendar, as an ISO date the engine can take as a parameter. */
export function todayInJurisdiction(jurisdiction: string, now: Date = new Date()): string {
  const timeZone = jurisdictionTimeZone(jurisdiction);
  // en-CA formats as YYYY-MM-DD, which is the shape every date in a plan uses.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/** The instant a given local hour falls on, on a published calendar day in the jurisdiction. */
export function instantAtLocalHour(jurisdiction: string, isoDate: string, hour: number): Date {
  const timeZone = jurisdictionTimeZone(jurisdiction);
  const [year, month, day] = isoDate.split("-").map(Number) as [number, number, number];
  const naive = Date.UTC(year, month - 1, day, hour);
  return new Date(naive - zoneOffsetMs(new Date(naive), timeZone));
}

/** How far ahead of UTC the zone is at `instant`, in milliseconds. */
function zoneOffsetMs(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(instant);
  const field = (type: Intl.DateTimeFormatPartTypes): number =>
    Number(parts.find((part) => part.type === type)?.value ?? "0");
  // `hour` formats midnight as 24 under hour12: false; Date.UTC normalizes it to the next day,
  // which is the same instant, so no special case is needed.
  const asUtc = Date.UTC(
    field("year"),
    field("month") - 1,
    field("day"),
    field("hour"),
    field("minute"),
    field("second"),
  );
  return asUtc - instant.getTime();
}

/** Operational warning at boot: plans still generate, but business-day lines will not be dated. */
export function holidayCalendarWarning(calendar: HolidayCalendar): string | null {
  return calendar.holidays === null ? new MissingHolidayCalendarError(calendar.id).message : null;
}
