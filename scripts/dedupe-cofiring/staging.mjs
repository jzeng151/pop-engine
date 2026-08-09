// Section 3.1: why the draft does not load through `parseEngineRuleset`, one error at a time.
//
// Each adaptation is applied to an in-memory clone and the parser is run again, so the table in the
// document is the parser's own sequence of messages rather than a reading of the schema. The file
// in `rules/` is never written.

import { parseEngineRuleset } from "../../packages/engine/src/ruleset.ts";
import { loadControl } from "./harness.mjs";

const clone = (value) => JSON.parse(JSON.stringify(value));

const allRules = (ruleset) => [...ruleset.rules, ...ruleset.advisories];

/**
 * Ask the engine's parser one question, by putting it to the parser.
 *
 * Three of this file's adaptations turn on what vocabulary the engine declares: deadline types, rule
 * kinds and verification statuses. None of those tables is exported, and `parseDeadline`, `RULE_KINDS`
 * and `VERIFICATION_STATUSES` are all module-private, so the only way to ask is to publish the value
 * on a rule of the control, which parses cleanly, and run `parseEngineRuleset` over the result. The
 * answer is the parser's own message, or `null` where it accepted the value.
 *
 * Restating any of the three as a literal set here would go stale in the one direction that matters:
 * the first error in section 3.1's table is raised by an earlier `conditional` deadline, so the
 * engine gaining a case for a later type, kind or status leaves every error in that table unchanged
 * while a stale set kept adapting a value the engine could now read, and the document claimed a
 * parser gap that had closed.
 */
const probeCache = new Map();

function probeControl(key, publish) {
  const cached = probeCache.get(key);
  if (cached !== undefined) return cached;

  const probe = clone(loadControl());
  publish(probe.rules[0]);
  let message = null;
  try {
    parseEngineRuleset(probe);
  } catch (thrown) {
    message = thrown instanceof Error ? thrown.message : String(thrown);
  }
  probeCache.set(key, message);
  return message;
}

/** What the parser makes of one deadline: whether it parses, and if not, whether on its type. */
export function probeDeadline(deadline) {
  const message = probeControl(`deadline:${JSON.stringify(deadline)}`, (rule) => {
    rule.output.deadline = clone(deadline);
  });
  return {
    supported: message === null,
    unsupportedType: message !== null && message.includes("deadline.type has unsupported value"),
    message,
  };
}

/**
 * Whether the engine declares a rule kind or a verification status.
 *
 * The probe rule sits in a dedupe group, so publishing a status on it can fail the load on
 * `rejectMixedDedupeVerificationStatuses` rather than on the vocabulary. The question asked is
 * therefore the specific one: did the parser reject this value as undeclared? Any other complaint
 * means the value itself was accepted.
 */
const declares = (label, key, value, publish) =>
  !(probeControl(`${key}:${value}`, publish) ?? "").includes(
    `${label} has unsupported value "${value}"`,
  );

export const engineDeclaresKind = (kind) =>
  declares(".kind", "kind", kind, (rule) => {
    rule.kind = kind;
  });

export const engineDeclaresStatus = (status) =>
  declares("verification.status", "status", status, (rule) => {
    rule.verification.status = status;
  });

/**
 * Fail when a mapping this file applies has parted company with the engine's vocabulary, in either
 * direction: a key the engine has since declared would still be rewritten, and a target the engine
 * has since dropped would rewrite one undeclared value into another.
 */
function assertMapsUndeclaredOntoDeclared(mapping, declaresValue, what) {
  for (const [from, to] of Object.entries(mapping)) {
    if (declaresValue(from)) {
      throw new Error(`the engine now declares the ${what} "${from}", so nothing needs mapping it`);
    }
    if (!declaresValue(to)) {
      throw new Error(
        `this file maps the ${what} "${from}" onto "${to}", which the engine rejects`,
      );
    }
  }
}

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
      const byUnsupportedType = {};
      let byMissingCalendarDays = 0;
      for (const rule of allRules(ruleset)) {
        const deadline = rule.output?.deadline;
        if (deadline === undefined || deadline === null) continue;
        const probe = probeDeadline(deadline);
        if (probe.supported) continue;
        if (probe.unsupportedType) {
          byUnsupportedType[deadline.type] = (byUnsupportedType[deadline.type] ?? 0) + 1;
        } else if (probe.message.includes("calendar_days")) {
          byMissingCalendarDays += 1;
        } else {
          // The document's left column publishes exactly these two classes. A third one arriving
          // silently would be counted under a label that does not describe it.
          throw new Error(
            `${rule.id} publishes a deadline the parser rejects for a third reason: ${probe.message}`,
          );
        }
        delete rule.output.deadline;
      }
      return { deadlinesDropped: { byUnsupportedType, byMissingCalendarDays } };
    },
  },
  {
    label: "map the verification statuses the engine does not declare onto statuses it does",
    apply: (ruleset) => {
      const mapping = { VERIFIED_WITH_QUALIFICATION: "VERIFIED", CONDITIONAL: "RESEARCH_REQUIRED" };
      assertMapsUndeclaredOntoDeclared(mapping, engineDeclaresStatus, "verification status");
      const statusesMapped = {};
      for (const rule of allRules(ruleset)) {
        const status = rule.verification?.status;
        const mapped = mapping[status];
        if (mapped === undefined) continue;
        statusesMapped[status] = (statusesMapped[status] ?? 0) + 1;
        rule.verification.status = mapped;
      }
      return { statusesMapped };
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
      assertMapsUndeclaredOntoDeclared(mapping, engineDeclaresKind, "rule kind");
      const kindsMapped = {};
      for (const rule of allRules(ruleset)) {
        const mapped = mapping[rule.kind];
        if (mapped === undefined) continue;
        kindsMapped[rule.kind] = (kindsMapped[rule.kind] ?? 0) + 1;
        rule.kind = mapped;
      }
      ruleset.config ??= {};
      ruleset.config.business_day_math ??= {};
      ruleset.config.business_day_math.calendar = "US-NY";
      ruleset.config.slack_warning_days ??= { value: 7 };
      return { kindsMapped };
    },
  },
  {
    label: "DIAGNOSTIC ONLY, semantics-changing: rewrite the `is_null` and `lte` leaves",
    apply: (ruleset) => {
      const operatorsRewritten = {};
      const count = (op) => {
        operatorsRewritten[op] = (operatorsRewritten[op] ?? 0) + 1;
      };
      for (const rule of allRules(ruleset)) {
        rule.trigger = rewriteLeaves(rule.trigger, (leaf) => {
          if (leaf.op === "is_null") {
            count("is_null");
            return { field: leaf.field, op: "eq", value: "unknown" };
          }
          if (leaf.op === "lte") {
            count("lte");
            return { field: leaf.field, op: "gte", value: leaf.value };
          }
          return leaf;
        });
      }
      return { operatorsRewritten };
    },
  },
  {
    label: "DIAGNOSTIC ONLY: declare the derived values the triggers read as intake fields",
    apply: (ruleset) => {
      const declared = new Set(ruleset.intake_fields.map((field) => field.field));
      const publishedAsDerived = new Set(ruleset.derived_values.map((value) => value.name));
      const read = new Set();
      const collect = (node) => {
        if (node === null || typeof node !== "object") return;
        if (Array.isArray(node)) return node.forEach(collect);
        if (typeof node.field === "string" && !declared.has(node.field)) read.add(node.field);
        Object.values(node).forEach(collect);
      };
      for (const rule of allRules(ruleset)) collect(rule.trigger);
      for (const name of read) {
        // Only a name the draft publishes under `derived_values` is a derived value. Anything else
        // a trigger reads and no `intake_fields` entry declares is a raw-field typo, and declaring
        // it here as a nullable number would adapt it away: the load would go on to fail on a later
        // error, this step's row would still read "the 3 derived values", and the document would
        // have counted a fabricated intake field among them (#251 review).
        if (!publishedAsDerived.has(name)) {
          throw new Error(
            `rule triggers read "${name}", which the draft declares neither as an intake field nor ` +
              `under derived_values; this adaptation declares derived values, not undeclared fields`,
          );
        }
        ruleset.intake_fields.push({ field: name, type: "number", nullable: true });
      }
      return { derivedValuesDeclared: [...read].sort() };
    },
  },
  {
    label: "DIAGNOSTIC ONLY: collapse every verification status",
    apply: (ruleset) => {
      for (const rule of allRules(ruleset)) rule.verification.status = "VERIFIED";
    },
  },
];

/**
 * Apply each adaptation in turn and record the parser's next complaint, plus what the adaptation
 * touched.
 *
 * `changed` is what section 3.1's left column counts: how many deadlines were dropped and why, how
 * many rules carry a verification status or a kind the engine does not declare, and how many leaves
 * each undeclared operator was rewritten on. It is returned rather than written into the document by
 * hand so that a draft that gains one more `conditional_requirement`, or one more `is_null` leaf,
 * fails the suite instead of quietly making the published count stale.
 */
export function stagingSequence(draft) {
  const staged = clone(draft);
  return ADAPTATIONS.map((adaptation) => {
    const changed = adaptation.apply(staged) ?? null;
    let error = null;
    try {
      parseEngineRuleset(clone(staged));
    } catch (thrown) {
      error = thrown instanceof Error ? thrown.message : String(thrown);
    }
    return { adaptation: adaptation.label, changed, error };
  });
}
