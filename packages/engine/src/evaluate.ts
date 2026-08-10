// The engine entry point (ARCHITECTURE "Rules Engine").

import { differenceInCalendarDays } from "./calendar";
import { computeVerdict } from "./verdict";
import { EVENT_DATE_FIELD, EvaluationError } from "./types";
import type { EngineRuleset, EventIntake, HolidayCalendar, PermitPlan } from "./types";

export function evaluate(
  intake: EventIntake,
  ruleset: EngineRuleset,
  today: string,
  calendar: HolidayCalendar,
): PermitPlan {
  const eventDate = intake[EVENT_DATE_FIELD];
  if (typeof eventDate !== "string") {
    throw new EvaluationError(`intake.${EVENT_DATE_FIELD} is required to date a plan`);
  }
  // Validates both dates up front: a plan dated from an unparseable clock is an error,
  // never a plan with no requirements (AC 5).
  differenceInCalendarDays(today, eventDate);

  if (calendar.id !== ruleset.calendarId) {
    throw new EvaluationError(
      `calendar "${calendar.id}" does not match the ruleset's pinned calendar "${ruleset.calendarId}"`,
    );
  }

  const { findings, verdict, verdictDetail } = computeVerdict(intake, ruleset, {
    intake,
    eventDate,
    today,
    calendar,
    slackWarningDays: ruleset.slackWarningDays,
  });

  return {
    rulesetVersion: ruleset.rulesetVersion,
    today,
    calendarId: calendar.id,
    findings,
    verdict,
    verdictDetail,
  };
}
