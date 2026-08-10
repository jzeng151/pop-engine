// Which intake questions this event actually gets asked.

import type { AskedWhenClause } from "../types";
import type { IntakeField, IntakeRegistry } from "./registry";

export type IntakeValue = string | number | boolean | readonly string[] | null;
export type IntakeAnswers = Readonly<Record<string, IntakeValue | undefined>>;

function termHolds(term: AskedWhenClause, answer: IntakeValue): boolean {
  switch (term.kind) {
    case "compare":
      // On a multi-enum ("structure_types != none") the comparison is membership: a list holding
      // only "none" is not "some structure other than none", it is no structure at all.
      if (Array.isArray(answer)) {
        const holdsMember = answer.includes(String(term.value));
        return term.op === "=" ? holdsMember : !holdsMember;
      }
      return term.op === "=" ? answer === term.value : answer !== null && answer !== term.value;
    case "in":
      return typeof answer === "string" && term.values.includes(answer);
    case "at_least":
      return typeof answer === "number" && answer >= term.threshold;
    case "truthy":
      return answer === true;
    case "member":
      return Array.isArray(answer) && answer.includes(term.member);
  }
}

/** The questions this event is asked, in registry order. */
export function askedFields(registry: IntakeRegistry, answers: IntakeAnswers): IntakeField[] {
  const asked = new Set<string>();
  for (let pass = 0; pass <= registry.length; pass += 1) {
    const newlyAsked = registry.filter(
      (field) =>
        !asked.has(field.field) &&
        field.askedWhen.every(
          (term) => asked.has(term.field) && termHolds(term, answers[term.field] ?? null),
        ),
    );
    if (newlyAsked.length === 0) break;
    for (const field of newlyAsked) asked.add(field.field);
  }
  return registry.filter((field) => asked.has(field.field));
}

/** The names of the questions this event is asked. */
export function askedFieldNames(registry: IntakeRegistry, answers: IntakeAnswers): Set<string> {
  return new Set(askedFields(registry, answers).map((field) => field.field));
}
