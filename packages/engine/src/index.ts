// pop-engine rules engine.

export const ENGINE_NAME = "pop-engine-engine";

// The intake contract (F-101): the ruleset's field registry, the asked-when conditions, and submission validation.
export type {
  IntakeContract,
  IntakeField,
  IntakeFieldType,
  IntakeRegistry,
  PublishedNotice,
} from "./intake/registry";
export { parseIntakeContract } from "./intake/registry";
export type { IntakeAnswers, IntakeValue } from "./intake/visibility";
export { askedFieldNames, askedFields } from "./intake/visibility";
export type { IntakeIssue, IntakeRecord, IntakeValidation } from "./intake/validate";
export {
  intakeColumnNames,
  intakeWarnings,
  isIntakeUnchanged,
  mergeIntakeEdit,
  validateIntake,
} from "./intake/validate";

/** Hello-world placeholder. Deterministic and side-effect free by construction. */
export function describeEngine(): string {
  return `${ENGINE_NAME} ready`;
}

export { evaluate } from "./evaluate";
export { parseEngineRuleset, triggerFields } from "./ruleset";
export { compareToPinned, parseRulesetVersion } from "./ruleset-version";
export {
  addCalendarDays,
  countBusinessDays,
  differenceInCalendarDays,
  subtractBusinessDays,
} from "./calendar";
export { CONFIRM_WITH_AGENCY } from "./deadlines";
export { branchesForceInfeasible, computeWindowVerdict, windowIsMissed } from "./verdict";
// The one correct fallback for a finding that carries no route list: an unmerged finding, or a replayed artifact stored before the field existed, is its own single route.
export {
  FILING_DISPOSITIONS,
  PUBLISHED_ROUTE_FIELDS,
  ROUTE_FIELD_ORIGIN,
  type RouteFieldOrigin,
  bindingRouteOf,
  headlineOf,
  canBlockWhenMissed,
  canBlockOverall,
  offersAFilingAction,
  mergedDispositionOf,
  noRouteSuppliesScalars,
  routesOf,
} from "./findings";
export { UNKNOWN_ANSWER } from "./conditions";
export {
  DEFAULT_DISPOSITION_BY_RULE_KIND,
  // F-203 names the dependency in `dependency_unlocked` copy, which means naming the upstream requirement a gated finding waits on.
  DEPENDENCY_SEQUENCING_BINDINGS,
  UNKNOWN_TRIGGER_DISPOSITION,
} from "./proposals";
// The answer key's scenario intakes, exported so a CONSUMER can run its own boundary over what `evaluate` actually emits rather than over payloads a test author wrote.
export {
  FIXTURE_TODAY,
  SCENARIO_INTAKE_FIXTURES,
  fixtureSubmission,
  type ScenarioIntakeFixture,
} from "./intake/scenario-intake-fixtures";
export * from "./types";
