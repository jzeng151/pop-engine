// Checklist bodies as `apps/api`'s `checklistView` serves them, shared by this feature's two
// suites.
//
// EVERY regulatory value here is READ FROM THE PUBLISHED RULESET, never written by hand. The
// first version of this file hand-wrote them, and every one was wrong: a $25 fee for a rule that
// publishes "$11,000 per location per day + $25 nonrefundable processing fee", a guessed portal
// URL for a rule that publishes E-Apply's, a permit name for a rule called "Street Event Permit
// (Medium)", and a `deadline.type` the schema does not define. 107 tests passed against it, which
// is the whole problem: a fixture carrying invented regulatory data makes a green suite read as
// verification of values no artifact ever published. AGENTS.md's authority order (published rule →
// engine output → UI copy) applies to test data too.
//
// So the projection below is the engine's own. `parseEngineRuleset` produces the same `EngineRule`
// the evaluator builds findings from, and each field is taken off it exactly where
// `packages/engine/src/findings.ts` takes it. A rule renamed or repriced upstream changes these
// fixtures with it; nothing here can drift from the artifact, because nothing here restates it.
//
// The exception, stated rather than hidden: the per-event fields an evaluation COMPUTES —
// `latestApplyDate`, `applyAfterDate`, `deadlineStatus`, `deadlineUnknownFields`,
// `timelineUnresolvedReason` — are not published values and depend on an event's date and today's
// date. They default to the "nothing computed" answer and are set per test through `computed`.

import { readFileSync } from "node:fs";
import {
  DEFAULT_DISPOSITION_BY_RULE_KIND,
  parseEngineRuleset,
  type Deadline,
} from "@pop-engine/engine";
import { rulesFileIn } from "../rules-file";

/**
 * The published ruleset, found rather than named — the resolver #138 added here, now shared with
 * the rest of this app rather than living only in the file that happened to break first.
 * `RULES_FILE` still overrides, because `apps/web/app/pages.test.tsx` sets it; the override's
 * precedence, including what an empty one means, is decided in one place rather than here.
 */
const RULES_FILE = rulesFileIn("rules");

const RULESET = parseEngineRuleset(JSON.parse(readFileSync(RULES_FILE, "utf8")));

const RULES = new Map(RULESET.rules.map((rule) => [rule.id, rule]));

/** The pair the published artifact carries, for the checklist's current plan. */
export const PUBLISHED_SNAPSHOT = {
  rulesetVersion: RULESET.rulesetVersion,
  snapshotDate: RULESET.snapshotDate,
} as const;

/** Rule ids the suites cite. Named so a rule removed upstream fails here, not in an assertion. */
export const STREET_MEDIUM = "SAPO-STREET-MEDIUM-001";
export const STREET_LARGE = "SAPO-STREET-LARGE-001";
export const INSURANCE = "SAPO-INSURANCE-001";
export const SOUND = "NYPD-SOUND-001";
export const PARKS_TUA = "PARKS-TUA-001";
export const SOUND_DEPENDENCY = "NYPD-SOUND-PARKS-DEP-001";
export const ALCOHOL_ADVISORY = "ADV-ALCOHOL-PUBLIC-001";
export const NOISE_ADVISORY = "ADV-NOISE-CODE-001";

const ruleOf = (ruleId: string) => {
  const rule = RULES.get(ruleId);
  if (rule === undefined) throw new Error(`${ruleId} is not in ${RULES_FILE}`);
  return rule;
};

/** The published prose a deadline carries, on the variants that publish one. */
const deadlineDisplayOf = (deadline: Deadline | null): string | null =>
  deadline !== null && "display" in deadline ? deadline.display : null;

/** The published organizer-facing name of a requirement. */
export const nameOf = (ruleId: string): string => {
  const rule = ruleOf(ruleId);
  const name = rule.userSummary?.heading ?? rule.name;
  if (name === null) throw new Error(`${ruleId} publishes no name`);
  return name;
};

export const portalNameOf = (ruleId: string): string | null => ruleOf(ruleId).portalName;
export const portalUrlOf = (ruleId: string): string | null => ruleOf(ruleId).portalUrl;
export const feeOf = (ruleId: string): string | null => ruleOf(ruleId).feeDisplay;
export const noteTextOf = (ruleId: string): string | null => ruleOf(ruleId).noteText;
export const citationOf = (ruleId: string): string => {
  const source = ruleOf(ruleId).source;
  if (source === null) throw new Error(`${ruleId} publishes no source`);
  return source.citation;
};

/**
 * The regulatory half of a row: `planContext` in `apps/api/src/checklist.ts`, projected off the
 * published rule exactly as `buildFinding` projects it.
 *
 * `computed` sets the fields an evaluation produces for a particular event, and `overrides` is for
 * the few cases a test needs a value the artifact does not publish for this rule (a checklist row
 * whose plan pinned an older snapshot, for instance).
 */
export const planContext = (
  ruleId: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> => {
  const rule = ruleOf(ruleId);
  return {
    ruleIds: [rule.id],
    permitName: rule.name,
    userSummary: rule.userSummary,
    agency: rule.agency,
    kind: rule.kind,
    disposition: rule.publishedDisposition ?? DEFAULT_DISPOSITION_BY_RULE_KIND[rule.kind],
    deadline: rule.deadline === null ? null : { type: rule.deadline.type },
    deadlineDisplay: deadlineDisplayOf(rule.deadline),
    // Computed per event, not published: no evaluation has run for this fixture.
    latestApplyDate: null,
    applyAfterDate: null,
    deadlineStatus: "not_applicable",
    slackDays: null,
    deadlineUnknownFields: [],
    timelineUnresolvedReason: null,
    verificationStatus: rule.verificationStatus,
    lastVerifiedDate: rule.verificationLastVerifiedDate,
    publishedNotes: rule.notes,
    noteText: rule.noteText,
    // An OFFICIAL_CONFLICT rule renders both readings; every other rule carries none.
    conflictText: rule.verificationStatus === "OFFICIAL_CONFLICT" ? rule.noteText : null,
    feeDisplay: rule.feeDisplay,
    portalName: rule.portalName,
    portalUrl: rule.portalUrl,
    portalInstructions: rule.portalInstructions,
    sources:
      rule.source === null
        ? []
        : [{ ruleId: rule.id, citation: rule.source.citation, urls: rule.source.urls }],
    sourceUrl: rule.source?.urls[0] ?? null,
    sourcePlan: { ...PUBLISHED_SNAPSHOT },
    ...overrides,
  };
};

/** A trackable row: the organizer's state on top of that plan context. */
export const trackedItem = (
  ruleId: string = STREET_MEDIUM,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> => ({
  ...planContext(ruleId),
  id: `item-${ruleId}`,
  planItemId: `plan-item-${ruleId}`,
  status: "not_started",
  notes: null,
  updatedAt: "2026-07-26T09:00:00.000Z",
  struckThrough: false,
  deadlineNotice: null,
  documents: [],
  ...overrides,
});

export const checklistBody = (
  overrides: Record<string, unknown> = {},
): Record<string, unknown> => ({
  eventId: "event-1",
  planId: "plan-2",
  ...PUBLISHED_SNAPSHOT,
  created: false,
  planChanged: false,
  planStale: false,
  statusRollup: {
    not_started: 0,
    in_progress: 0,
    submitted: 0,
    approved: 0,
    rejected: 0,
  },
  items: [],
  contextItems: [],
  // Present on every real response, so it is present here: `checklistView` returns it
  // unconditionally and empty is the answer whenever nothing was simulated (F-203 AC 5).
  simulatedAlertDeliveries: [],
  // Likewise present on every real response: empty is the answer whenever nothing has failed.
  failedAlertDeliveries: [],
  // Likewise: empty is the answer whenever no alert has been left unresolved long enough for the
  // poller to stop on it, which is the ordinary state.
  alertsHeldForReconciliation: [],
  // Likewise: the contact store answers for every event, and nulls are what an event nobody has
  // given a contact for looks like (migration 009).
  alertContacts: { email: null, phone: null },
  ...overrides,
});
