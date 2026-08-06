import type { HolidayCalendar } from "@pop-engine/engine";

/**
 * The pinned holiday calendar is unavailable, so business-day deadlines cannot be computed.
 *
 * `config.business_day_math` pins `us-ny-business-days@2026.1` but states in the same block that
 * the holiday list itself is still RESEARCH_REQUIRED, and no artifact publishes one. Substituting
 * weekday-only arithmetic would count a holiday as a business day, push every business-day
 * deadline later than it really is, and can report an already-missed filing window as on track.
 * Overclaiming feasibility is the failure this product exists to prevent, and inventing holidays
 * to fill the gap is not an option (AGENTS.md, Golden Rule 1).
 *
 * This condition is now per finding, not per plan. Four published rules use business-day
 * deadlines (DOB-TENT-001, DOB-ASSEMBLY-001, SLA-ONEDAY-001, SLA-CATERING-001); a plan that
 * triggers none of them is fully computable and is generated normally. A plan that does trigger
 * one gets that line rendered NOT_CALCULABLE with "confirm with agency" and excluded from verdict
 * arithmetic — the ruleset's own treatment for a deadline the engine cannot compute
 * (engine_conventions) — rather than the whole plan being withheld. Declining to claim one date
 * tells an organizer exactly which item needs confirmation; withholding a correct plan tells them
 * nothing. The under-claiming risk is still covered, because NOT_CALCULABLE never counts toward
 * FEASIBLE.
 */
export class MissingHolidayCalendarError extends Error {
  constructor(calendarId: string) {
    super(
      `holiday calendar "${calendarId}" has no published holiday list; business-day deadlines ` +
        `render as "confirm with agency" until the product owner publishes it`,
    );
    this.name = "MissingHolidayCalendarError";
  }
}

/**
 * Published holiday lists, keyed by the calendar id a ruleset pins. Empty on purpose: an entry
 * appears here only when the product owner publishes the dates for that calendar, and publishing
 * one is regulatory publication: `docs/DOCUMENTATION-GOVERNANCE.md` §6 routes it to the product
 * owner and needs no second signatory even for a list they authored. Publishing a first list for a
 * calendar id also settles which holiday-calendar source governs it, which is
 * `docs/ARCHITECTURE-FUTURE.md` §18's gate 2 and a durable architecture decision, so §6 requires
 * that choice be recorded as an approved ADR as well: the approval on its own does not satisfy it.
 * A missing entry yields `holidays: null`, which the engine reads as "no list published" — distinct
 * from a published list that happens to hold no dates.
 *
 * `us-ny-business-days@2026.1` was researched for publication and then deliberately NOT published.
 * If you are here to add it, read this first: the blocker is not that nobody looked up the dates.
 *
 * ONE CALENDAR ID SERVES RULES FROM TWO GOVERNMENTS, AND THEIR PUBLISHED STAFF HOLIDAY SCHEDULES
 * DIFFER. DOB-TENT-001 and DOB-ASSEMBLY-001 are New York CITY agency rules; SLA-ONEDAY-001 and
 * SLA-CATERING-001 are New York STATE agency rules. What was established is a divergence between
 * three EMPLOYEE holiday schedules — which days staff are off — and one statute enumerating legal
 * holidays. DOB also publishes an office-closings page, fetched in Round 5; it states when DOB is
 * closed and does not mention TUP, TPA, filing deadlines, or business-day computation. No
 * SLA-published closure source was fetched. Each source is labelled below for what it actually is,
 * because the labels are the whole point:
 *   - Fri 2026-07-03 — on the city's PAYROLL holiday list ("07/03 - Independence Day (Observed)",
 *     nyc.gov/site/opa/my-payroll/list-of-holidays.page, Office of Payroll Administration) and on
 *     the federal EMPLOYEE schedule (opm.gov 2026, "Friday, July 03"). Not on the state's CIVIL
 *     SERVICE calendar, which records Saturday 2026-07-04 as a "pass day holiday" (cs.ny.gov) —
 *     an employee-attendance treatment.
 *   - Thu 2026-02-12 — a state legal holiday under General Construction LAW §24, which is a
 *     statute and not a staff schedule; in the city a floating holiday for EMPLOYEES hired before
 *     2004-07-01, which is a staff-leave entitlement rather than a citywide closure.
 *   - Tue 2026-11-03 — a state and city holiday; not federal.
 * The observance rules differ too, and that comparison has the same shape: §24 rolls a holiday
 * forward only when it falls on a Sunday ("if any of such days except Flag day is Sunday, the next
 * day thereafter") and states no Saturday rule at all, while DCAS PERSONNEL SERVICES Bulletin
 * 440-2 and the federal EMPLOYEE schedule both roll a Saturday holiday back to the preceding
 * Friday. That is one statute set beside two staff schedules, not two filing calendars compared.
 *
 * WHAT FOLLOWS FROM THOSE DATES IS CONDITIONAL, and the condition is unestablished. IF an agency's
 * staff closure stops that agency's filing counter, THEN no single list is right for both
 * governments and this one calendar id cannot serve all four rules. Whether it does is precisely
 * the question the leads below are leads for, and nothing consulted here answers it. An earlier
 * draft of this comment said the closure calendars "provably differ" and that "any single list is
 * wrong for one of them": the dates are real evidence and they stand, but the regulatory
 * consequence drawn from them was asserted rather than established, so it is withdrawn to the
 * conditional above rather than left for the next reader to inherit.
 *
 * THE DEEPER GAP, which is the INDEPENDENT and sufficient reason this stays empty: no source
 * consulted here defines "business day" for a filing lead. It rests on nothing above — the dates
 * and their downgrade to a conditional leave it exactly as it was, and the conditional's
 * unestablished premise is this same gap seen from the other side. GCL §24
 * (nysenate.gov/legislation/laws/GCN/24) enumerates public holidays; it does not say an agency's
 * filing counter stops on them. The DOB Temporary Use Permit page publishes "no later than 15
 * business days prior" without defining the unit, and the ruleset defines it no further. The two
 * named statutory leads were run on 2026-07-27; neither supplied a rule removing agency closures
 * from the assessed backward counts. Every candidate list is therefore an inference about what a
 * published closure means for a filing, not a published fact — and a comment can document an
 * inference without authorizing it. The decision not to publish stands on this paragraph.
 *
 * A UNION of the city and state staff schedules was considered and rejected. It never counts a closed day
 * as open, so it can only move a deadline earlier, which reads as the safe direction and is not:
 * an over-early date can raise `published_deadline_missed`, which the verdict turns into
 * INFEASIBLE. On any day between the union-derived date and the real one the engine would tell an
 * organizer their event cannot happen when it still can. F-201 AC 4 names over-prescribing as a
 * failure mode alongside overclaiming.
 *
 * A citation trap, before the leads: cite General CONSTRUCTION Law §24, path GCN/24. GCT/24 is
 * General CITY Law §24, a different statute with no holidays in it; landing there suggests,
 * wrongly, that the citation is bad.
 *
 * TWO NAMED LEADS, RUN 2026-07-27. The fetched statutes and cases are quoted with retrieval metadata
 * in docs/VERIFICATION-SOURCES.md Round 5.
 *   - GENERAL CONSTRUCTION LAW §25-a (GCN/25-A), "Public holiday, Saturday or Sunday in statutes;
 *     extension of time where performance of act is due on Saturday, Sunday or public holiday". Its
 *     scope clause includes a period "before which" an act must be done. In 208 W 20th St. LLC v
 *     Blanchard, §25-a made a terminal filing timely inside a separate backward-counted
 *     minimum-notice scheme, but did not cure noncompliance with that minimum notice. The fetched
 *     cases do not state that a holiday or agency closure inside a minimum-notice period is omitted
 *     from its count, and none concerns a business-day lead or any rule here.
 *   - NY PUBLIC OFFICERS LAW §62 (PBO/62), "Business in public offices on public holidays":
 *     "Holidays and Saturdays shall be considered as Sunday for all purposes relating to the
 *     transaction of business in the public offices of the state". The section does not define
 *     SLA's business-day unit or state that every SLA-published closure is excluded from a backward
 *     count. It does not reach DOB, which is a city agency.
 *
 * SCOPE OF THAT FOLLOW-UP: DOB-TENT-001 was assessed against a fetched DOB closure source. For
 * SLA-ONEDAY-001 and SLA-CATERING-001, the permit leads and state-office holiday treatment were
 * fetched, but no SLA-published closure source was fetched; the agency-closure question therefore
 * remains unassessed for those paths. DOB-ASSEMBLY-001 is a fourth business-day rule using this
 * shared calendar, but its TPA filing path was also not assessed. Nothing in the TUP result
 * establishes what a DOB closure does to the TPA counter. Publication of this shared calendar
 * therefore remains unsupported for those independent reasons too.
 *
 * WHAT DOB PUBLISHES ELSEWHERE, AND WHAT IT DOES NOT PUBLISH FOR TUP. This is not a third lead. The
 * two leads above are candidate authorities that might answer the question; this is not one of them,
 * it does not bear on what the TUP filing counter does, and nothing below should be read as a rule
 * that reaches TUP. It is recorded because it bounds what the TUP materials' silence can be taken
 * for. DOB publishes an explicit weekend-and-holiday rule for a backward-counted construction
 * notice in three places in Building Code Chapter 33 — verbatim, from DOB's own
 * published Chapter 33 (nyc.gov/assets/buildings/codes-pdf/cons_codes_2022/
 * 2022BC_Chapter33_Con_DemoSafetyWBwm.pdf, retrieved 2026-07-26; the amlegal mirror at
 * codelibrary.amlegal.com/codes/newyorkcity/latest/NYCadmin/0-0-0-185903 carries the same section
 * but refuses automated retrieval):
 *   - §3306.3.1, demolition, notice to the department 24-48 hours before commencement: "If the
 *     notification date falls on a weekend or official holiday, the permit holder shall notify the
 *     department on the last business day before the commencement date."
 *   - §3304.3.1, soil and foundation work, the same 24-48 hour notice: "Should the notification date
 *     fall on a weekend or official holiday, the permit holder ... shall notify the department on
 *     the last business day before the commencement date." Its cancellation notice carries the
 *     mirror-image rule, rolling FORWARD to "the next business day after the intended commencement
 *     date" — so where DOB publishes such a rule it publishes the direction of the roll too.
 *   - §3314.4.1.5, adjustable suspended scaffold installation and removal, again 24-48 hours:
 *     "Should the notification date fall on a weekend or official holiday, the notification shall be
 *     made on the last business day before the commencement date of the installation or removal."
 * Against that, the TUP materials publish the lead and stop. Checked 2026-07-26, and stated per
 * source because they do not all say the same thing: the TUP page
 * (nyc.gov/site/buildings/industry/tup.page) and the TUP service notice
 * (nyc.gov/assets/buildings/pdf/tup-sn.pdf) each state the lead as "no later than 15 business days
 * prior"; the TUP intake form and checklist (nyc.gov/assets/buildings/pdf/tup-formchecklist.pdf)
 * states no lead time at all, being a document checklist plus fees and submission mechanics. None of
 * the three defines "business day", states a weekend or holiday rule, or cross-references §3306.3.1
 * or either of the others. Those are the observables, and they are where this stops. The per-source
 * split matters enough to keep: an earlier draft of this paragraph attributed the lead to all three
 * at once, which is false of the checklist, and docs/VERIFICATION-SOURCES.md Round 5 carries the
 * same breakdown in a table.
 *
 * WHAT THE OMISSION MEANS IS NOT ESTABLISHED, and no located source reaches it. Nothing in the TUP
 * materials, in Chapter 33, or anywhere else consulted says the omission was considered, and no
 * source speaks to DOB's intent at all. An innocent explanation sits inside the evidence above and
 * is complete on its own: all three analogues are counted in CLOCK HOURS, where no business-day unit
 * is in play, so their weekend rule supplies what an hour count lacks. If DOB has never published a
 * weekend-and-holiday rule for anything counted in BUSINESS DAYS — and nothing here shows that it
 * has — then the TUP omission needs no intent to explain it, because the question may simply never
 * have been addressed. Chapter 33 points the same way: it uses "business day" in all three rules and
 * never defines it, so even where DOB does publish a holiday rule it leaves undefined the same unit
 * THE DEEPER GAP above is about. So what this evidence does is narrow what the silence can be taken
 * for: it rules out the reading that DOB has no way of publishing such a rule, or no practice of it.
 * It does not show that the TUP omission was deliberate, and it does not establish what the TUP
 * counter does — §3306.3.1 governs a different notification and the TUP materials do not incorporate
 * it. An earlier draft of this paragraph said the absence "reads as a deliberate silence rather than
 * an oversight" and moved the record "from absence of evidence toward evidence of absence". That
 * inferred an agency's intent from the absence of text, which no source supports; it is withdrawn to
 * the observables above. The framing was specified in the brief this finding was recorded under and
 * was caught in review of PR #133, not by the brief — recorded here because this file has been
 * corrected twice for the same class of error (a consequence asserted past its sources) and a third
 * would be a pattern rather than a slip. The record is more complete than it was; the argument it
 * supports is weaker than that draft claimed, and the decision below is unchanged either way.
 *
 * FOLLOW-UP EVIDENCE IS ON FILE. On 2026-07-27 the named leads were run and the DOB TUP page, DOB
 * closure page, ABC Law §97 and §98, 9 NYCRR Part 29 and SLA permit materials were fetched with
 * quotes, URLs and retrieval dates. docs/VERIFICATION-SOURCES.md Round 5 records what each source
 * states and does not state. The earlier reported-only Pass B remains history, not independent
 * corroboration; the listed sources are now fetched evidence instead of relying on that report.
 * Pass A compared staff schedules and statutes and did not fetch a DOB or SLA closure source.
 *
 * What would unblock DOB-TENT-001 is not a better list of dates, but a source establishing that
 * DOB's published closure stops the TUP filing counter. The SLA paths first need an applicable
 * SLA-published closure source, then a source establishing its effect on those counters. Publishing
 * this shared calendar also requires a supported answer for DOB-ASSEMBLY-001's separate TPA path.
 *
 * MEANWHILE, AN APPROVED CRITERION CANNOT BE MET: F-201 AC 10 requires Scenario F's business-day
 * count "against the pinned calendar" and ARCHITECTURE AD-11 requires real business-day math
 * against it, and neither happens in production while this record is empty — affected findings
 * render NOT_CALCULABLE instead. That is recorded as SPEC-CONFLICT #130, which also states the
 * resolutions and their costs. Publishing this list is one of them, so publication is an EXPECTED
 * outcome here and not a regression; `plan.test.ts` notifies when it happens and says the same thing.
 */
const PUBLISHED_HOLIDAY_CALENDARS: Readonly<Record<string, readonly string[]>> = {};

export function pinnedCalendar(calendarId: string): HolidayCalendar {
  return { id: calendarId, holidays: PUBLISHED_HOLIDAY_CALENDARS[calendarId] ?? null };
}

/**
 * The clock a plan's `today` is read from, per jurisdiction. A deadline is a calendar day in the
 * city that publishes it, so deriving `today` from UTC would roll over between 8pm and midnight
 * New York time and could mark a window missed hours before it closes. This is a deployment
 * mapping, not a regulatory fact: the ruleset publishes the jurisdiction but no timezone.
 */
const JURISDICTION_TIME_ZONES: Readonly<Record<string, string>> = {
  "US-NY-NYC": "America/New_York",
};

export class UnmappedJurisdictionError extends Error {
  constructor(jurisdiction: string) {
    super(`no local time zone is mapped for jurisdiction "${jurisdiction}"`);
    this.name = "UnmappedJurisdictionError";
  }
}

/**
 * The zone a jurisdiction's calendar day belongs to, for the readers that cannot take a day.
 *
 * A day is derived from a clock and a zone, and only the zone is a fact about the jurisdiction:
 * the clock is whichever one the reader is about to act on. Everything in this file that computes
 * a day reads the mapping through here, and so does every statement that derives its own day in
 * SQL, which is what keeps the two from disagreeing about which clock a calendar day belongs to.
 */
export function jurisdictionTimeZone(jurisdiction: string): string {
  const timeZone = JURISDICTION_TIME_ZONES[jurisdiction];
  if (timeZone === undefined) throw new UnmappedJurisdictionError(jurisdiction);
  return timeZone;
}

/**
 * The jurisdiction's calendar day as SQL derives it, at the moment the statement is evaluated.
 *
 * A DAY DERIVED BEFORE A STATEMENT IS A DAY BOUND INTO IT, and that is a different shape from a
 * day computed early and carried. Every reader here already derives its day as late as this
 * process can (inline at the call, or from a function invoked while the parameter list is being
 * built), and that is still one wait short of the decision: issuing a statement is itself a wait
 * nothing bounds, so a day materialized as a bind parameter can be yesterday by the time
 * PostgreSQL evaluates the predicate it was bound into. The process cannot notice, because its
 * own answer is the stale one. So the day crosses the wire as a ZONE and the statement derives the
 * day, which puts the derivation and the decision in the same evaluation by construction.
 *
 * `statement_timestamp()` RATHER THAN `current_timestamp`, for the reason the send path already
 * records about its own clock: `current_timestamp` is the TRANSACTION's start, and a checklist
 * review holds one open across several reads. It is also not `clock_timestamp()`, which advances
 * DURING a statement: these predicates appear several times in one statement and a day that could
 * differ between two of them would let one statement disagree with itself.
 */
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

/**
 * The instant a given local hour falls on, on a published calendar day in the jurisdiction.
 *
 * F-203 schedules from dates, and a date is not an instant. Scheduling `latest_apply_date − 7` at
 * UTC midnight would send the reminder at 8pm New York time on the day BEFORE the one it names,
 * which is a day the copy does not claim. The mapping this reads is the same deployment mapping
 * `todayInJurisdiction` uses, so the whole api agrees on which clock a calendar day belongs to.
 *
 * The offset is read at the naive instant and applied once. Every jurisdiction here changes offset
 * at 2am local, so a sending hour in the working day is never the ambiguous or skipped hour a
 * two-pass resolution exists to handle.
 */
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
