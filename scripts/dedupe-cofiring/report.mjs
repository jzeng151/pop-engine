// One call that produces every table in `docs/research/draft-dedupe-cofiring.md`.

import { parseEngineRuleset } from "../../packages/engine/src/ruleset.ts";
import {
  buildFieldDefinitions,
  loadControl,
  loadDraft,
  multiMemberGroups,
  sweepControl,
  sweepGroup,
} from "./harness.mjs";
import * as inventory from "./inventory.mjs";
import { stagingSequence } from "./staging.mjs";

export function measure() {
  const draft = loadDraft();
  const definitions = new Map(
    buildFieldDefinitions(draft, { translateAskedWhen: true }).map((field) => [field.field, field]),
  );

  const groups = multiMemberGroups(draft).map((group) => sweepGroup(group, definitions));
  const byKey = new Map(groups.map((group) => [group.key, group]));
  const control = sweepControl(parseEngineRuleset(loadControl()));

  return {
    draft,
    groups,
    group: (key) => byKey.get(key),
    control,
    staging: stagingSequence(draft),
    inventory,
    totalIntakes: groups.reduce((total, group) => total + group.sweep, 0),
  };
}

/** Co-firing events in a group: intakes where at least two members reached the merge. */
export const coFiringEvents = (group) =>
  group.findings.slice(2).reduce((total, count) => total + count, 0);

/** How often each field was unsettled across a group's co-firing events. */
export function unsettledAcrossCoFiring(group) {
  const totals = new Map();
  for (const set of group.sets) {
    for (const [field, count] of set.unsettled) {
      totals.set(field, (totals.get(field) ?? 0) + count);
    }
  }
  return totals;
}

/** Co-firing sets that include a named member with a named trigger result. */
export const setsWith = (group, memberId, result) =>
  group.sets.filter((set) => set.results[group.memberIds.indexOf(memberId)] === result);

const percent = (part, whole) => (whole === 0 ? "0.0%" : `${((part / whole) * 100).toFixed(1)}%`);

export function printTables(measurement) {
  const rows = measurement.groups.map((group) => ({
    group: group.key,
    members: group.memberIds.length,
    sweep: group.sweep,
    findings: group.findings.join(" / "),
    true: group.true.join(" / "),
    complete: group.complete,
    completeShare: percent(group.complete, group.sweep),
    completeAndTwoFindings: group.completeAndTwoFindings,
    completeAndTwoTrue: group.completeAndTwoTrue,
    shareAtLeastTwo: percent(coFiringEvents(group), group.sweep),
  }));
  console.table(rows);
  console.table(
    measurement.groups.flatMap((group) =>
      group.sets.map((set) => ({
        group: group.key,
        set: set.members
          .map((id) => `${id}:${set.results[group.memberIds.indexOf(id)]}`)
          .join(" + "),
        count: set.count,
        groupComplete: set.complete,
        setComplete: set.setComplete,
      })),
    ),
  );
  console.table([
    { row: "findings", ...Object.fromEntries(measurement.control.findings.map((n, i) => [i, n])) },
    { row: "true", ...Object.fromEntries(measurement.control.true.map((n, i) => [i, n])) },
    {
      row: "complete",
      ...Object.fromEntries(measurement.control.completeFindings.map((n, i) => [i, n])),
    },
    {
      row: "complete+true",
      ...Object.fromEntries(measurement.control.completeTrue.map((n, i) => [i, n])),
    },
  ]);
  console.table(
    measurement.staging.map((step) => ({ adaptation: step.adaptation, error: step.error })),
  );
}
