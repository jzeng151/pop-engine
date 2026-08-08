// Section 3.1: why the draft does not load through `parseEngineRuleset`, one error at a time.
//
// Each adaptation is applied to an in-memory clone and the parser is run again, so the table in the
// document is the parser's own sequence of messages rather than a reading of the schema. The file
// in `rules/` is never written.

import { parseEngineRuleset } from "../../packages/engine/src/ruleset.ts";

const clone = (value) => JSON.parse(JSON.stringify(value));

const allRules = (ruleset) => [...ruleset.rules, ...ruleset.advisories];

/** Deadline types the engine has a case for; anything else fails `parseDeadline`. */
const ENGINE_DEADLINE_TYPES = new Set([
  "published_minimum",
  "published_minimum_by_level",
  "composite",
  "business_days_minimum",
  "before_issuance",
  "research_required",
]);

/** Rewrite every trigger leaf that uses an operator the engine has no case for. */
function rewriteLeaves(node, rewrite) {
  if (node === null || typeof node !== "object") return node;
  if (Array.isArray(node)) return node.map((child) => rewriteLeaves(child, rewrite));
  if (typeof node.op === "string") return rewrite(node);
  const rewritten = {};
  for (const [key, value] of Object.entries(node)) rewritten[key] = rewriteLeaves(value, rewrite);
  return rewritten;
}

export const ADAPTATIONS = [
  {
    label: "none",
    apply: () => {},
  },
  {
    label:
      "drop the deadlines whose type the engine has no case for, and the `published_minimum` " +
      "deadlines that publish no `calendar_days`",
    apply: (ruleset) => {
      for (const rule of allRules(ruleset)) {
        const deadline = rule.output?.deadline;
        if (deadline === undefined || deadline === null) continue;
        const unsupportedType = !ENGINE_DEADLINE_TYPES.has(deadline.type);
        const missingDays =
          deadline.type === "published_minimum" && typeof deadline.calendar_days !== "number";
        if (unsupportedType || missingDays) delete rule.output.deadline;
      }
    },
  },
  {
    label: "map the verification statuses the engine does not declare onto statuses it does",
    apply: (ruleset) => {
      const mapping = { VERIFIED_WITH_QUALIFICATION: "VERIFIED", CONDITIONAL: "RESEARCH_REQUIRED" };
      for (const rule of allRules(ruleset)) {
        const mapped = mapping[rule.verification?.status];
        if (mapped !== undefined) rule.verification.status = mapped;
      }
    },
  },
  {
    label:
      "map the rule kinds the engine does not declare, and publish `config.business_day_math.calendar`",
    apply: (ruleset) => {
      const mapping = {
        conditional_requirement: "permit",
        approval: "permit",
        certificate: "insurance",
      };
      for (const rule of allRules(ruleset)) {
        const mapped = mapping[rule.kind];
        if (mapped !== undefined) rule.kind = mapped;
      }
      ruleset.config ??= {};
      ruleset.config.business_day_math ??= {};
      ruleset.config.business_day_math.calendar = "US-NY";
      ruleset.config.slack_warning_days ??= { value: 7 };
    },
  },
  {
    label: "DIAGNOSTIC ONLY, semantics-changing: rewrite the `is_null` and `lte` leaves",
    apply: (ruleset) => {
      for (const rule of allRules(ruleset)) {
        rule.trigger = rewriteLeaves(rule.trigger, (leaf) => {
          if (leaf.op === "is_null") return { field: leaf.field, op: "eq", value: "unknown" };
          if (leaf.op === "lte") return { field: leaf.field, op: "gte", value: leaf.value };
          return leaf;
        });
      }
    },
  },
  {
    label: "DIAGNOSTIC ONLY: declare the derived values the triggers read as intake fields",
    apply: (ruleset) => {
      const declared = new Set(ruleset.intake_fields.map((field) => field.field));
      const read = new Set();
      const collect = (node) => {
        if (node === null || typeof node !== "object") return;
        if (Array.isArray(node)) return node.forEach(collect);
        if (typeof node.field === "string" && !declared.has(node.field)) read.add(node.field);
        Object.values(node).forEach(collect);
      };
      for (const rule of allRules(ruleset)) collect(rule.trigger);
      for (const name of read) {
        ruleset.intake_fields.push({ field: name, type: "number", nullable: true });
      }
    },
  },
  {
    label: "DIAGNOSTIC ONLY: collapse every verification status",
    apply: (ruleset) => {
      for (const rule of allRules(ruleset)) rule.verification.status = "VERIFIED";
    },
  },
];

/** Apply each adaptation in turn and record the parser's next complaint. */
export function stagingSequence(draft) {
  const staged = clone(draft);
  return ADAPTATIONS.map((adaptation) => {
    adaptation.apply(staged);
    let error = null;
    try {
      parseEngineRuleset(clone(staged));
    } catch (thrown) {
      error = thrown instanceof Error ? thrown.message : String(thrown);
    }
    return { adaptation: adaptation.label, error };
  });
}
