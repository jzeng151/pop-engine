import type { Verdict } from "@pop-engine/engine";
import type { ConsumedVerdictDetail } from "./plan-api";

// The verdict's user-facing copy, in one place.

const VERDICT_COPY: Readonly<Record<Verdict, string>> = {
  FEASIBLE: "On track",
  FEASIBLE_AT_RISK: "At risk",
  CONDITIONAL: "Depends on",
  INFEASIBLE: "Blocked as scoped",
};

/** The label F-102's verdict table requires beside FEASIBLE-AT-RISK: "threshold labeled as PopEngine's **internal planning buffer**, never an official threshold". */
export const AT_RISK_BUFFER_NOTE =
  "“apply within” counts down PopEngine's internal planning buffer, not an agency filing deadline. Each requirement below carries its own published date.";

/** `detail` is narrowed to the two members this copy reads, not the engine's whole `VerdictDetail`. */
export function verdictCopy(verdict: Verdict, detail?: ConsumedVerdictDetail): string {
  const base = VERDICT_COPY[verdict];

  if (verdict === "FEASIBLE_AT_RISK") {
    const days = detail?.minSlackDays;
    // What the buffer is gets said on screen, in `AT_RISK_BUFFER_NOTE`, not in this comment.
    return typeof days === "number" ? `${base} — apply within ${days} days` : base;
  }

  if (verdict === "CONDITIONAL") {
    const facts = (detail?.missingFacts ?? []).map((fact) => fact.field.replace(/_/g, " "));
    return facts.length > 0 ? `${base}: ${facts.join(", ")}` : base;
  }

  return base;
}
