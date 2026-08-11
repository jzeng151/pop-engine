// Tri-state condition evaluation (ARCHITECTURE "Condition evaluation").

import { EvaluationError } from "./types";
import type {
  AskedWhenClause,
  Condition,
  EngineRuleset,
  ScopedField,
  EventIntake,
  IntakeValue,
  TriggeredBy,
  Tristate,
  TriggerNode,
} from "./types";

export const UNKNOWN_ANSWER = "unknown";

type ResolvedAnswer =
  | { readonly state: "not_asked" }
  | { readonly state: "unknown"; readonly isExplicitUnknown: boolean }
  | { readonly state: "answered"; readonly value: Exclude<IntakeValue, null> };

export type TriggerEvaluation = {
  readonly result: Tristate;
  /** Fields whose unanswered state is what made the trigger `unknown` — the branchable facts. */
  readonly unknownFields: readonly string[];
  readonly triggeredBy: readonly TriggeredBy[];
};

export type ScopeResolver = { isInScope: (field: string) => boolean };

/** The registry's `asked_when` grammar, parsed once rather than re-read per evaluation. */
export function parseAskedWhen(
  expression: string,
  fields: readonly ScopedField[],
): AskedWhenClause[] {
  return expression.split(" AND ").map((clause) => parseAskedWhenClause(clause.trim(), fields));
}

/** Every operand is checked against the field it names, not just the field's existence. */
function declaredValuesOf(field: string, fields: readonly ScopedField[]): readonly string[] | null {
  return fields.find((entry) => entry.field === field)?.values ?? null;
}

function fieldTypeOf(field: string, fields: readonly ScopedField[]): string {
  return fields.find((entry) => entry.field === field)?.type ?? "";
}

const NUMERIC_FIELD_TYPES = new Set(["integer", "number"]);

/** The operand as the field's own runtime type, so evaluation's strict comparison can match. */
function typedOperand(
  operand: string,
  type: string,
  declaredValues: readonly string[] | null,
): string | number | boolean {
  if (declaredValues !== null) return operand;
  if (NUMERIC_FIELD_TYPES.has(type)) return Number(operand);
  if (type === "boolean") return operand === "true";
  return operand;
}

function rejectClause(clause: string, reason: string): never {
  throw new EvaluationError(`asked_when clause "${clause}" ${reason}`);
}

function parseAskedWhenClause(clause: string, fields: readonly ScopedField[]): AskedWhenClause {
  const declared = new Set(fields.map((field) => field.field));

  const inMatch = /^(\S+) in (\S+)$/.exec(clause);
  if (inMatch?.[1] !== undefined && inMatch[2] !== undefined && declared.has(inMatch[1])) {
    const field = inMatch[1];
    const values = inMatch[2].split("/");
    const allowed = declaredValuesOf(field, fields);
    if (allowed === null) {
      rejectClause(clause, `uses "in" on "${field}", which declares no values to match against`);
    }
    const undeclared = values.filter((value) => !allowed.includes(value));
    if (undeclared.length > 0) {
      rejectClause(
        clause,
        `matches "${field}" against ${undeclared.map((value) => `"${value}"`).join(", ")}, ` +
          `which ${undeclared.length === 1 ? "is not a" : "are not"} declared value${undeclared.length === 1 ? "" : "s"} of it`,
      );
    }
    return { kind: "in", field, values };
  }

  const comparison = /^(\S+) (=|!=|gte) (\S+)$/.exec(clause);
  if (comparison?.[1] !== undefined && declared.has(comparison[1])) {
    const field = comparison[1];
    const operand = comparison[3] ?? "";
    const type = fieldTypeOf(field, fields);

    if (comparison[2] === "gte") {
      if (!NUMERIC_FIELD_TYPES.has(type)) {
        rejectClause(clause, `orders "${field}", which is a ${type} field, with "gte"`);
      }
      const threshold = Number(operand);
      if (!Number.isFinite(threshold)) {
        rejectClause(clause, `compares "${field}" against a non-numeric threshold "${operand}"`);
      }
      return { kind: "at_least", field, threshold };
    }

    const allowed = declaredValuesOf(field, fields);
    if (allowed !== null && !allowed.includes(operand)) {
      rejectClause(clause, `compares "${field}" against "${operand}", which it does not declare`);
    }
    if (allowed === null && NUMERIC_FIELD_TYPES.has(type) && !Number.isFinite(Number(operand))) {
      rejectClause(clause, `compares numeric "${field}" against non-numeric "${operand}"`);
    }
    if (allowed === null && type === "boolean" && operand !== "true" && operand !== "false") {
      rejectClause(clause, `compares boolean "${field}" against "${operand}"`);
    }
    // The operand is typed at load, not left as the text it was written as.
    return {
      kind: "compare",
      field,
      op: comparison[2] === "=" ? "=" : "!=",
      value: typedOperand(operand, type, allowed),
    };
  }

  // A bare token is either a boolean field ("food_present") or a declared member of a
  // multi-select field ("tent_canopy" means structure_types includes tent_canopy).
  if (declared.has(clause)) {
    const type = fieldTypeOf(clause, fields);
    if (type !== "boolean") {
      rejectClause(clause, `reads "${clause}" as a flag, but it is a ${type} field`);
    }
    return { kind: "truthy", field: clause };
  }
  const owners = fields.filter((field) => field.values?.includes(clause) === true);
  if (owners.length === 0) {
    rejectClause(clause, "names no declared field or value");
  }
  // Two fields declaring the same option leave the clause ambiguous, and picking the first would
  // silently scope on whichever the registry happened to list earlier.
  if (owners.length > 1) {
    rejectClause(
      clause,
      `is a value of more than one field (${owners.map((field) => field.field).join(", ")})`,
    );
  }
  return { kind: "member", field: (owners[0] as ScopedField).field, member: clause };
}

export function createScopeResolver(intake: EventIntake, ruleset: EngineRuleset): ScopeResolver {
  const definitions = new Map(ruleset.intakeFields.map((field) => [field.field, field]));
  const cache = new Map<string, boolean>();
  const resolving = new Set<string>();

  const valueOf = (field: string): IntakeValue => {
    if (!isInScope(field)) return null;
    return intake[field] ?? null;
  };

  const evaluateClause = (clause: AskedWhenClause): boolean => {
    const value = valueOf(clause.field);
    switch (clause.kind) {
      case "in":
        return clause.values.includes(String(value));
      case "compare":
        // On a multi-select ("structure_types != none") the comparison is membership.
        if (Array.isArray(value)) {
          const holdsMember = value.includes(String(clause.value));
          return clause.op === "=" ? holdsMember : !holdsMember;
        }
        return clause.op === "="
          ? value === clause.value
          : value !== null && value !== clause.value;
      case "at_least":
        return typeof value === "number" && value >= clause.threshold;
      case "truthy":
        return value === true;
      case "member":
        return Array.isArray(value) ? value.includes(clause.member) : value === clause.member;
    }
  };

  function isInScope(field: string): boolean {
    const cached = cache.get(field);
    if (cached !== undefined) return cached;

    const definition = definitions.get(field);
    if (definition === undefined)
      throw new EvaluationError(`intake field "${field}" is not declared by the ruleset`);
    if (definition.askedWhenClauses === null) {
      cache.set(field, true);
      return true;
    }
    if (resolving.has(field)) throw new EvaluationError(`asked_when for "${field}" is cyclic`);

    resolving.add(field);
    try {
      const inScope = definition.askedWhenClauses.every(evaluateClause);
      cache.set(field, inScope);
      return inScope;
    } finally {
      resolving.delete(field);
    }
  }

  return { isInScope };
}

function resolveAnswer(field: string, intake: EventIntake, scope: ScopeResolver): ResolvedAnswer {
  if (!scope.isInScope(field)) return { state: "not_asked" };
  const value = intake[field];
  if (value === undefined || value === null) return { state: "unknown", isExplicitUnknown: false };
  if (value === UNKNOWN_ANSWER) return { state: "unknown", isExplicitUnknown: true };
  return { state: "answered", value };
}

function requireNumber(value: unknown, condition: Condition): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new EvaluationError(`${condition.field} must be numeric for op "${condition.op}"`);
  }
  return value;
}

function asStringArray(value: Exclude<IntakeValue, null>): readonly string[] | null {
  return Array.isArray(value) ? (value as readonly string[]) : null;
}

/** True when the answer sits exactly on a threshold the rule publishes as unresolved there. */
function isAtDeclaredBoundary(condition: Condition, answer: number): boolean {
  return condition.boundary === "conditional" && answer === condition.value;
}

function compareAnswer(condition: Condition, value: Exclude<IntakeValue, null>): Tristate {
  const asTristate = (matched: boolean): Tristate => (matched ? "true" : "false");
  const list = asStringArray(value);

  switch (condition.op) {
    case "eq":
      return asTristate(value === condition.value);
    case "in": {
      const candidates = Array.isArray(condition.value) ? (condition.value as unknown[]) : [];
      // A multi-select field matches `in` when any selected member matches (DOB-TALL-STRUCTURE-001).
      if (list !== null) return asTristate(list.some((entry) => candidates.includes(entry)));
      return asTristate(candidates.includes(value));
    }
    case "gt": {
      const answer = requireNumber(value, condition);
      if (isAtDeclaredBoundary(condition, answer)) return "unknown";
      return asTristate(answer > requireNumber(condition.value, condition));
    }
    case "gte":
      return asTristate(
        requireNumber(value, condition) >= requireNumber(condition.value, condition),
      );
    case "bool":
      return asTristate(value === condition.value);
    case "contains":
      if (list === null)
        throw new EvaluationError(`${condition.field} must be a multi-select for op "contains"`);
      return asTristate(list.includes(String(condition.value)));
    case "contains_any": {
      if (list === null)
        throw new EvaluationError(
          `${condition.field} must be a multi-select for op "contains_any"`,
        );
      const candidates = Array.isArray(condition.value) ? (condition.value as unknown[]) : [];
      return asTristate(list.some((entry) => candidates.includes(entry)));
    }
    default:
      throw new EvaluationError(`unsupported operator "${String(condition.op)}"`);
  }
}

function evaluateCondition(
  condition: Condition,
  intake: EventIntake,
  scope: ScopeResolver,
): TriggerEvaluation {
  const answer = resolveAnswer(condition.field, intake, scope);
  const contribution: TriggeredBy = {
    field: condition.field,
    value: intake[condition.field] ?? null,
  };

  if (answer.state === "not_asked") return { result: "false", unknownFields: [], triggeredBy: [] };

  if (answer.state === "unknown") {
    // A rule that lists "unknown" among its accepted values is answered by it, not blocked by it
    // (SLA-CATERING-001, ADV-NOISE-CODE-001, DOHMH-EXEMPTION-001).
    const acceptsUnknown =
      answer.isExplicitUnknown &&
      ((condition.op === "in" &&
        Array.isArray(condition.value) &&
        (condition.value as unknown[]).includes(UNKNOWN_ANSWER)) ||
        (condition.op === "eq" && condition.value === UNKNOWN_ANSWER));
    if (acceptsUnknown) return { result: "true", unknownFields: [], triggeredBy: [contribution] };
    return { result: "unknown", unknownFields: [condition.field], triggeredBy: [contribution] };
  }

  const result = compareAnswer(condition, answer.value);
  return {
    result,
    unknownFields: result === "unknown" ? [condition.field] : [],
    triggeredBy: result === "false" ? [] : [contribution],
  };
}

/** Evaluate a trigger tree to true / false / unknown, collecting what drove the answer. */
export function evaluateTrigger(
  node: TriggerNode,
  intake: EventIntake,
  scope: ScopeResolver,
): TriggerEvaluation {
  if ("field" in node) return evaluateCondition(node, intake, scope);

  const isAll = "all" in node;
  const children = (isAll ? node.all : node.any).map((child) =>
    evaluateTrigger(child, intake, scope),
  );
  const decisive: Tristate = isAll ? "false" : "true";
  const otherwise: Tristate = isAll ? "true" : "false";

  if (children.some((child) => child.result === decisive)) {
    return {
      result: decisive,
      unknownFields: [],
      // A decisive `any` is settled by its true children alone, so only those are the answers that triggered the finding (AC 1).
      triggeredBy:
        decisive === "true"
          ? children
              .filter((child) => child.result === "true")
              .flatMap((child) => child.triggeredBy)
          : [],
    };
  }

  const unknownChildren = children.filter((child) => child.result === "unknown");
  const result = unknownChildren.length > 0 ? "unknown" : otherwise;
  return {
    result,
    unknownFields: [...new Set(unknownChildren.flatMap((child) => child.unknownFields))],
    triggeredBy: result === "false" ? [] : children.flatMap((child) => child.triggeredBy),
  };
}
