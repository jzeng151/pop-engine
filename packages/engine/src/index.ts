// pop-engine rules engine.
//
// PURE module (AGENTS.md "Engine invariants"): no database, HTTP, environment reads,
// randomness, or system clock. `today`, the ruleset, and the holiday calendar are always
// explicit inputs. `evaluate(intake, ruleset, today, calendar)` is the entry point (F-201).

export const ENGINE_NAME = "pop-engine-engine";

// The intake contract (F-101): the ruleset's field registry, the asked-when conditions,
// and submission validation. Shared by apps/api and apps/web (AD-8) so the contract has
// exactly one implementation.
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
export { computeWindowVerdict, windowIsMissed } from "./verdict";
// The one correct fallback for a finding that carries no route list: an unmerged finding, or a
// replayed artifact stored before the field existed, is its own single route.
// `canBlockWhenMissed` is the third rule exported so a boundary can RECOMPUTE it rather than
// restate it in prose, after the merged disposition and the scalar-free test.
export {
  canBlockWhenMissed,
  mergedDispositionOf,
  noRouteSuppliesScalars,
  routesOf,
} from "./findings";
export { UNKNOWN_ANSWER } from "./conditions";
export {
  DEFAULT_DISPOSITION_BY_RULE_KIND,
  // F-203 names the dependency in `dependency_unlocked` copy, which means naming the upstream
  // requirement a gated finding waits on. The binding is what links the two rule ids; without it
  // the api would have to re-derive the link from prose.
  DEPENDENCY_SEQUENCING_BINDINGS,
  UNKNOWN_TRIGGER_DISPOSITION,
} from "./proposals";
export * from "./types";
