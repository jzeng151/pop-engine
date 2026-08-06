// The fixture suite and the published ruleset must agree about which rules each scenario reaches.
//
// Every regulatory defect closed this week was one artifact disagreeing with another while nothing
// compared them. The answer key names the rules each scenario is expected to produce; the ruleset
// decides which rules an intake actually reaches; and until now only a human reading both could
// tell when they diverged. This evaluates every published trigger against each scenario's intake
// and compares the result to what the key lists.
//
// It uses the engine's real evaluation, not a reimplementation of trigger matching. That matters:
// a version of this check that skipped `asked_when` scoping reported the SAPO rules as conditional
// in Scenario B purely because `obstructs_public_way` is never asked at a private venue. Reading
// the trace the engine already produces means this check can only ever agree with the engine.
//
// Known disagreements are allowlisted with the issue that owns them, in the shape
// finding-kinds.test.ts uses: a recorded disagreement stays visible and attributed, and a NEW one
// fails. Nothing here edits a fixture or a rule to make the comparison pass — that would be the
// engine bending to a broken expectation, which the authority order forbids.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { PUBLISHED_RULES_FILE } from "./__fixtures__/published-ruleset";
import { evaluate, parseEngineRuleset, triggerFields } from "./index";
import { UNCONSUMED_INTAKE_FIELDS } from "./ruleset";
import type { EventIntake, Finding, HolidayCalendar, PermitPlan } from "./types";
import {
  FIXTURE_TODAY,
  SCENARIO_INTAKE_FIXTURES,
  fixtureSubmission,
} from "./intake/scenario-intake-fixtures";

const repoFile = (relativePath: string): string =>
  fileURLToPath(new URL(`../../../${relativePath}`, import.meta.url));

/** Only the fields this file reads off the published artifact; the engine's parser owns the rest. */
type PublishedRule = {
  id: string;
  exercised_by_scenarios?: string[];
  output?: { dedupe_key?: string; deadline?: { calendar_days?: number } };
};

const publishedRuleset: { rules: PublishedRule[]; advisories: PublishedRule[] } = JSON.parse(
  readFileSync(PUBLISHED_RULES_FILE, "utf8"),
);

const ruleset = parseEngineRuleset(publishedRuleset);
const answerKey = readFileSync(repoFile("docs/test-scenario-answer-key.md"), "utf8");
const calendar: HolidayCalendar = { id: ruleset.calendarId, holidays: [] };
const approvedFixtureConsumers = [
  "docs/PRD.md",
  "docs/DESIGN.md",
  "specs/F-101-event-intake.md",
  "specs/F-201-permit-plan-generator.md",
] as const;

/**
 * A published rule id: uppercase segments ending in a three-digit suffix. Deliberately narrow so
 * prose in the key (section references, dollar amounts, code citations) cannot be mistaken for one.
 */
const RULE_ID = /\b[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)*-\d{3}\b/g;

/**
 * The rule ids the key lists under a scenario's "Expected findings".
 *
 * Scoped to that block on purpose. Scenario D's fixture-guard note names
 * SAPO-BLOCK-PARTY-ELIG-001 while saying it belongs to a separate unit fixture, so reading the
 * whole section would import an id the scenario explicitly does not expect.
 */
function expectedRuleIds(scenario: string): string[] {
  const section = answerKey
    .split(/^## Scenario /m)
    .find((candidate) => candidate.startsWith(`${scenario} `));
  if (section === undefined) throw new Error(`answer key has no Scenario ${scenario} section`);
  const findings = section.split("**Expected findings:**")[1]?.split("**EXPECTED VERDICT")[0];
  if (findings === undefined)
    throw new Error(`Scenario ${scenario} has no expected-findings block`);
  return [...new Set(findings.match(RULE_ID) ?? [])];
}

/**
 * The intake the answer key documents for a scenario, and the prose it states that this cannot
 * read.
 *
 * The key's Inputs line is written for people: `field=value` pairs separated by ·, with emphasis,
 * parenthetical commentary, and free-form phrases like "no structures". The pairs are read; the
 * prose is returned rather than guessed at, so what this comparison does not cover is visible
 * instead of implied. A parenthetical carrying an `=` is unwrapped rather than dropped, because
 * three scenarios state real answers inside brackets.
 */
function documentedInputs(scenario: string): {
  pairs: Map<string, string>;
  prose: string[];
} {
  const section = answerKey
    .split(/^## Scenario /m)
    .find((candidate) => candidate.startsWith(`${scenario} `));
  if (section === undefined) throw new Error(`answer key has no Scenario ${scenario} section`);
  const line = section.split("\n").find((candidate) => candidate.startsWith("**Inputs:**"));
  if (line === undefined) throw new Error(`Scenario ${scenario} states no inputs`);

  const body = line
    .replace("**Inputs:**", "")
    .replace(/\*\*/g, "")
    // Unwrapped, never deleted. Dropping a parenthetical that carries no `=` erased real inputs
    // before either reader saw them: Scenario E states its generator as "(gasoline 5 gal, 50 kW)",
    // and both are mapped fixture values, so the gallons or the kW could move to any other
    // above-threshold number with every assertion still green. Unwrapping sends them to `prose`
    // instead, where the silently-skips test pins them verbatim — so a changed number fails and
    // someone decides, rather than the text vanishing on the way in.
    .replace(/\(([^)]*)\)/g, (_whole, inner: string) => `· ${inner}`);

  const pairs = new Map<string, string>();
  const prose: string[] = [];
  for (const segment of body.split(/[·,;]/)) {
    const token = segment.trim();
    if (token === "") continue;
    const pair = /^([a-z0-9_]+)\s*=\s*(.+)$/.exec(token);
    if (pair?.[1] !== undefined && pair[2] !== undefined) pairs.set(pair[1], pair[2].trim());
    else prose.push(token);
  }
  return { pairs, prose };
}

/** The key writes one field in shorthand; every other name is the registry's own. */
const DOCUMENTED_FIELD_ALIASES: Readonly<Record<string, string>> = {
  open_to_public: "event_open_to_public",
};

/**
 * The slack statements each scenario makes, split by which engine field they are about.
 *
 * `findings` counts the parenthesised counts on finding lines, each of which is that finding's
 * `slackDays`. `verdictLine` is whether the verdict line states the plan's `minSlackDays`. Pinned
 * separately rather than as one total, because a reader can lose one half and keep the other and a
 * single number would hide that.
 */
const DOCUMENTED_SLACK_PER_SCENARIO: Readonly<
  Record<string, { readonly findings: number; readonly verdictLine: boolean }>
> = {
  A: { findings: 1, verdictLine: false },
  B: { findings: 0, verdictLine: false },
  C: { findings: 0, verdictLine: false },
  D: { findings: 1, verdictLine: true },
  E: { findings: 1, verdictLine: true },
  F: { findings: 0, verdictLine: false },
};

/**
 * How many lines state that two rule ids share one finding, per scenario. Pinned so the sentence
 * cannot be deleted or reworded into silence: E's DOB line is the only one, and it is the grouping
 * #89 item 6 was about.
 */
const DOCUMENTED_GROUPINGS_PER_SCENARIO: Readonly<Record<string, number>> = {
  A: 0,
  B: 0,
  C: 0,
  D: 0,
  E: 1,
  F: 0,
};

/** The scenarios whose verdict line names a blocking finding, pinned so one going quiet fails. */
const SCENARIOS_DOCUMENTING_A_BLOCKER: readonly string[] = ["A"];

/**
 * Disposition-shaped English the key uses that maps onto `Disposition` without interpretation.
 *
 * Only one entry, and the omissions are the point. "MAY apply" cannot be mapped: Scenario B uses it
 * for a finding the engine emits as `required` and Scenario F uses the same words for one it emits
 * as `may_be_required`. "CONDITIONAL at the boundary" is a verdict token, not a disposition. Reading
 * either as a disposition would be a guess, so neither is read.
 */
const DISPOSITION_BY_DOCUMENTED_PHRASE: readonly {
  readonly phrase: RegExp;
  readonly value: Finding["disposition"];
}[] = [{ phrase: /\bno new permit\b/, value: "no_new_requirement" }];

/**
 * The mappable disposition statements each scenario makes, and how many sit on a branch sub-line.
 *
 * Two numbers rather than one: a sub-line that stops parsing as a branch still matches the phrase,
 * so `statements` would hold while the comparison quietly fell back to the scenario's own plan.
 * F's single statement is on the `yes` branch, so its two numbers are equal, and either dropping
 * to zero fails.
 */
const DOCUMENTED_DISPOSITIONS_PER_SCENARIO: Readonly<
  Record<string, { readonly statements: number; readonly onBranch: number }>
> = {
  A: { statements: 0, onBranch: 0 },
  B: { statements: 0, onBranch: 0 },
  C: { statements: 0, onBranch: 0 },
  D: { statements: 0, onBranch: 0 },
  E: { statements: 0, onBranch: 0 },
  F: { statements: 1, onBranch: 1 },
};

/** Read the documented text as the type the fixture holds, so a comparison is like for like. */
function asFixtureType(documented: string, fixtureValue: unknown): unknown {
  if (typeof fixtureValue === "boolean") return documented === "yes";
  if (typeof fixtureValue === "number") return Number(documented);
  if (Array.isArray(fixtureValue)) {
    return documented
      .replace(/^\[|\]$/g, "")
      .split("/")
      .map((entry) => entry.trim())
      .filter((entry) => entry !== "");
  }
  return documented;
}

/**
 * The prose each scenario states that the pair reader cannot compare. Recorded so the gap is
 * explicit: if the key rewords one of these, or adds a new statement, this fails and someone
 * decides whether it can now be compared rather than it quietly going unchecked.
 */
const UNCOMPARED_PROSE: Readonly<Record<string, readonly string[]>> = {
  A: [
    "brooklyn",
    "multi-block activation",
    "35 days out",
    "no structures",
    "no flame",
    "no generator",
    "battery none",
    "no alcohol",
  ],
  B: [
    "manhattan",
    "private_venue",
    "21 days out",
    "prepackaged snacks",
    "free",
    "the gallery itself",
    "no structures/flame/generator/alcohol",
    "battery none",
  ],
  C: ["brooklyn", "park", "56 days out", "no food", "nothing else"],
  D: [
    "queens",
    "street",
    "70 days out",
    "no public food service",
    "neighbors' own grills",
    "no structures",
    "no generator",
    "battery none",
    "no alcohol",
  ],
  // "gasoline 5 gal" and "50 kW" are `generator_gasoline_gallons` and `generator_kw`, both mapped
  // fixture values. They are pinned here rather than parsed: reading them would mean mapping a
  // phrase to a field, which is the prose interpretation this suite exists to remove. Pinned, a
  // change to either number fails this test and someone decides — which is what the erasure they
  // replace could not do.
  E: [
    "manhattan",
    "plaza",
    "135 days out",
    "free sampling",
    "20×20",
    "no flame",
    "gasoline 5 gal",
    "50 kW",
    "battery none",
    "no alcohol",
  ],
  F: [
    "manhattan",
    "private_venue",
    "rooftop",
    "20 days out",
    "invite-only",
    "food catered",
    "nothing sold",
    "the caterer",
    "no structures",
    "no flame",
    "no generator",
    "battery none",
  ],
};

/**
 * The rules a scenario reaches: fired or conditional, in one list.
 *
 * Deliberately not two lists. Every check here asks the same question — does this scenario reach
 * this rule — and twice now a call site answered it with `fired` alone: once in the metadata
 * check, once in the answer-key comparison. A conditional finding is a line the organizer sees, so
 * a rule reached through a material unknown is reached. One helper owns the notion.
 */
function reachedIn(scenario: string): string[] {
  const fixture = SCENARIO_INTAKE_FIXTURES.find((entry) => entry.scenario === scenario);
  if (fixture === undefined) throw new Error(`no intake fixture for Scenario ${scenario}`);
  const plan = evaluate(
    fixtureSubmission(fixture) as EventIntake,
    ruleset,
    FIXTURE_TODAY,
    calendar,
  );
  return plan.verdictDetail.trace
    .filter((entry) => entry.result === "true" || entry.result === "unknown")
    .map((entry) => entry.ruleId);
}

/**
 * A scenario's whole markdown section, so the output readers below split it the same way the
 * id reader above does rather than each inventing its own idea of where a scenario starts.
 */
function sectionFor(scenario: string): string {
  const section = answerKey
    .split(/^## Scenario /m)
    .find((candidate) => candidate.startsWith(`${scenario} `));
  if (section === undefined) throw new Error(`answer key has no Scenario ${scenario} section`);
  return section;
}

/** The plan the engine produces for a scenario's documented intake. */
function planFor(scenario: string): PermitPlan {
  const fixture = SCENARIO_INTAKE_FIXTURES.find((entry) => entry.scenario === scenario);
  if (fixture === undefined) throw new Error(`no intake fixture for Scenario ${scenario}`);
  return evaluate(fixtureSubmission(fixture) as EventIntake, ruleset, FIXTURE_TODAY, calendar);
}

/**
 * The engine's own deadline statuses, read off the type rather than retyped, so a status the engine
 * gains is not silently absent from what this reader recognises.
 *
 * Restricted to these five on purpose: the key writes `→ TOKEN` for several things that are not
 * statuses at all (`→ SAPO`, `→ PACO`, `→ VERIFIED`), so a scrape matching any uppercase token
 * after an arrow would compare prose to a status field.
 */
const DEADLINE_STATUSES: readonly Finding["deadlineStatus"][] = [
  "on_track",
  "deadline_approaching",
  "published_deadline_missed",
  "not_calculable",
  "not_applicable",
];

/** The four verdicts, in the spelling the key uses (`FEASIBLE-AT-RISK`) and the engine's. */
const VERDICT_BY_DOCUMENTED_NAME: Readonly<Record<string, PermitPlan["verdict"]>> = {
  FEASIBLE: "FEASIBLE",
  "FEASIBLE-AT-RISK": "FEASIBLE_AT_RISK",
  CONDITIONAL: "CONDITIONAL",
  INFEASIBLE: "INFEASIBLE",
};

/**
 * One numbered line from a scenario's "Expected findings" block that names a rule, with whatever
 * outputs the key states about it.
 *
 * The block, not the whole section: Scenario D's fixture-guard note and the demo notes name rule ids
 * outside it, and the verdict line states a verdict that is the plan's rather than a finding's.
 */
type DocumentedFinding = {
  readonly ruleId: string;
  /**
   * Every rule id the line names, in order. `ruleId` stays the first one because every check that
   * predates this field keys on it; this is additive so the grouping comparison can ask which ids a
   * line puts together without changing what anything else reads.
   */
  readonly ruleIds: readonly string[];
  readonly dates: readonly string[];
  readonly status: Finding["deadlineStatus"] | null;
  /**
   * The branch this line documents, when it is a sub-line under a "branch on <field>" parent.
   *
   * Scenario F's finding 2 is the case: the parent names the field and each sub-line names the
   * value, so a `yes →` line documents the output for that field being yes, not the output of the
   * scenario's own intake, which leaves the field unknown.
   */
  readonly branch: { readonly field: string; readonly value: string } | null;
  readonly line: string;
};

function documentedFindings(scenario: string): DocumentedFinding[] {
  const block = sectionFor(scenario)
    .split("**Expected findings:**")[1]
    ?.split("**EXPECTED VERDICT")[0];
  if (block === undefined) throw new Error(`Scenario ${scenario} has no expected-findings block`);

  const documented: DocumentedFinding[] = [];
  // The field a "branch on <field>" parent line puts its sub-lines under, cleared by the next
  // numbered item so a sub-line cannot inherit a branch from an unrelated finding above it.
  let branchField: string | null = null;
  for (const line of block.split("\n")) {
    const parent = /branch on ([a-z_]+)/.exec(line);
    if (parent !== null) branchField = parent[1]!;
    else if (/^\d+\./.test(line.trim())) branchField = null;
    const branchValue = /^\s*-\s*(yes|no)\s*→/.exec(line)?.[1];
    const ruleId = new RegExp(RULE_ID.source).exec(line)?.[0];
    if (ruleId === undefined) continue;
    const statuses = DEADLINE_STATUSES.filter((status) => line.includes(status.toUpperCase()));
    documented.push({
      ruleId,
      // Distinct, because grouping is a question about WHICH ids a line names, and a line may name
      // one twice: E's DOB line mentions DOB-TALL-STRUCTURE-001 in its prose and again in the
      // sentence that states the two share a finding.
      ruleIds: [...new Set([...line.matchAll(new RegExp(RULE_ID.source, "g"))].map((m) => m[0]))],
      dates: [...line.matchAll(/\b(20\d\d-\d\d-\d\d)\b/g)].map((match) => match[1]!),
      // Two statuses on one line would make "the status this line states" ambiguous, so it states
      // none rather than the reader picking.
      status: statuses.length === 1 ? statuses[0]! : null,
      branch:
        branchField !== null && branchValue !== undefined
          ? { field: branchField, value: branchValue }
          : null,
      line: line.trim(),
    });
  }
  return documented;
}

/** The verdict the key states for a scenario, in the engine's spelling. */
function documentedVerdict(scenario: string): PermitPlan["verdict"] {
  const stated = /\*\*EXPECTED VERDICT:\s*[^A-Z]*([A-Z][A-Z-]+)/.exec(sectionFor(scenario))?.[1];
  const verdict = stated === undefined ? undefined : VERDICT_BY_DOCUMENTED_NAME[stated];
  if (verdict === undefined) {
    throw new Error(`Scenario ${scenario} states no verdict this reader recognises: ${stated}`);
  }
  return verdict;
}

/**
 * The rules a scenario reaches only by being rescoped, keyed by the metadata name for it.
 *
 * `A-rescope` is a real scenario id in `exercised_by_scenarios`, and round 3 taught the reader to
 * accept the name without ever evaluating it — which reads as coverage from outside while checking
 * nothing, the same shape as the allowlist this suite refuses. So the variants are evaluated.
 *
 * They come from the engine's own `rescopeSuggestions` rather than from parsing the key's prose:
 * the key documents A's three as size=medium, size=small and private venue, and those are exactly
 * the three changes the engine proposes, so reading them off the plan tests the documented set
 * without introducing a second interpretation of the document.
 *
 * "Reaches only by being rescoped" is the definition, because a rule the base scenario already
 * reaches is named by the base scenario's own id.
 */
function rescopeReachedIn(scenario: string): string[] {
  const fixture = SCENARIO_INTAKE_FIXTURES.find((entry) => entry.scenario === scenario);
  if (fixture === undefined) throw new Error(`no intake fixture for Scenario ${scenario}`);
  const submission = fixtureSubmission(fixture) as EventIntake;
  const base = evaluate(submission, ruleset, FIXTURE_TODAY, calendar);
  const baseReached = new Set(reachedIn(scenario));

  const reached = new Set<string>();
  for (const suggestion of base.verdictDetail.rescopeSuggestions) {
    const variant = evaluate(
      { ...submission, [suggestion.change.field]: suggestion.change.value } as EventIntake,
      ruleset,
      FIXTURE_TODAY,
      calendar,
    );
    for (const entry of variant.verdictDetail.trace) {
      if (entry.result !== "true" && entry.result !== "unknown") continue;
      if (!baseReached.has(entry.ruleId)) reached.add(entry.ruleId);
    }
  }
  return [...reached];
}

/**
 * The plan a scenario re-evaluates to under one documented rescope.
 *
 * Built the same way `rescopeReachedIn` builds its variants, and needed separately because the
 * rescope bullets state outputs (dates and a deadline status) that only the re-evaluated plan can
 * be compared against. `rescopeReachedIn` answers which rules are reached and throws the plan away.
 */
function rescopePlan(scenario: string, change: { field: string; value: unknown }): PermitPlan {
  const fixture = SCENARIO_INTAKE_FIXTURES.find((entry) => entry.scenario === scenario);
  if (fixture === undefined) throw new Error(`no intake fixture for Scenario ${scenario}`);
  return evaluate(
    { ...(fixtureSubmission(fixture) as EventIntake), [change.field]: change.value } as EventIntake,
    ruleset,
    FIXTURE_TODAY,
    calendar,
  );
}

/**
 * The key's shorthand for the fields its rescope bullets name, mapped onto the registry's own. The
 * key writes `size=medium`; the registry field is `street_event_size`. One entry, declared rather
 * than inferred, for the same reason `DOCUMENTED_FIELD_ALIASES` exists.
 */
const RESCOPE_FIELD_ALIASES: Readonly<Record<string, string>> = {
  size: "street_event_size",
};

/**
 * Disagreements that exist today between two approved artifacts. Each is a decision someone owns,
 * not something a test may resolve: changing either side is the product owner's under governance §6,
 * whose approval is the whole requirement even for a regulatory publication the product owner
 * authored.
 */
const KNOWN_DISAGREEMENTS: readonly {
  scenarios: readonly string[];
  ruleId: string;
  kind: "reaches-but-key-omits" | "claims-scenario-it-cannot-reach" | "reaches-scenario-it-omits";
  issue: string;
}[] = [
  {
    scenarios: ["B"],
    ruleId: "DOHMH-EXEMPTION-001",
    kind: "claims-scenario-it-cannot-reach",
    issue:
      "#89: the rule lists B in exercised_by_scenarios, but B's event_open_to_public = yes and the " +
      "trigger needs no/unknown, so it cannot fire there. Stale metadata on a published rule.",
  },
  {
    scenarios: ["F"],
    ruleId: "DOHMH-EXEMPTION-001",
    kind: "reaches-scenario-it-omits",
    issue:
      "#89: the same rule fires in F (invite-only, catered) and does not list F. Its scenario " +
      "metadata is wrong in both directions — it names the one scenario it cannot reach and omits " +
      "the one it does.",
  },
  {
    scenarios: ["B"],
    ruleId: "DOHMH-ORGANIZER-NOTIFY-001",
    kind: "reaches-scenario-it-omits",
    issue:
      "#89: the rule fires in B and B's expected findings list it, but its exercised_by_scenarios " +
      "names only A and E.",
  },
  {
    scenarios: ["E"],
    ruleId: "DOB-TALL-STRUCTURE-001",
    kind: "reaches-scenario-it-omits",
    issue:
      "#89: the rule is conditional in E — structure_over_10ft_tall is unknown there — and E's " +
      "expected findings name it inside item 8, but its exercised_by_scenarios is empty. Found by " +
      "widening the reverse check from fired to reached.",
  },
];

const isKnown = (scenario: string, ruleId: string, kind: string): boolean =>
  KNOWN_DISAGREEMENTS.some(
    (entry) => entry.scenarios.includes(scenario) && entry.ruleId === ruleId && entry.kind === kind,
  );

/**
 * Rules a scenario reaches whose `exercised_by_scenarios` omits it.
 *
 * Reached, not fired. A rule a scenario only reaches through a material unknown is still exercised
 * by it — it appears in the plan as a conditional finding — so checking only the rules that fired
 * let a conditional-only rule lose its metadata silently. Pure so the case can be tested directly
 * rather than waiting for the published ruleset to grow one.
 */
export function metadataOmissions(
  scenario: string,
  reached: readonly string[],
  claims: ReadonlyMap<string, readonly string[]>,
): string[] {
  return reached.filter((ruleId) => !(claims.get(ruleId) ?? []).includes(scenario));
}

/**
 * The scenarios each artifact names, so the loops below cannot run over a universe one of them
 * does not share.
 *
 * Taking the universe from the fixtures alone made every parameterized check below vacuous for
 * anything the fixtures happen not to cover: a scenario added to the approved key with no fixture
 * is never visited, and an `exercised_by_scenarios` entry naming a scenario that does not exist is
 * never compared against anything. Both leave the suite green while the thing it exists to check
 * has a hole in it.
 */
const scenarioIdsIn = {
  fixtures: () => SCENARIO_INTAKE_FIXTURES.map((fixture) => fixture.scenario),
  answerKey: () =>
    [...answerKey.matchAll(/^## Scenario ([A-Z])\b/gm)].map((match) => match[1] as string),
  /**
   * Plus the rescopes a scenario documents. `SAPO-STREET-MEDIUM-001` and `SAPO-STREET-SMALL-001`
   * are exercised by Scenario A's size=medium and size=small rescopes, which the key states under
   * A's "Expected rescopes" block rather than as sections of their own, and their metadata says
   * `A-rescope`. That is the key being read correctly, not metadata naming something that does not
   * exist — so the reader has to know the shape rather than the allowlist absorbing it.
   */
  answerKeyIncludingRescopes: () =>
    scenarioIdsIn.answerKey().flatMap((id) => {
      const section = answerKey.slice(answerKey.indexOf(`## Scenario ${id}`));
      const body = section.slice(0, section.indexOf("\n## ") + 1 || undefined);
      return body.includes("**Expected rescopes") ? [id, `${id}-rescope`] : [id];
    }),
  ruleMetadata: () => [
    ...new Set(
      [...publishedRuleset.rules, ...publishedRuleset.advisories].flatMap(
        (rule) => rule.exercised_by_scenarios ?? [],
      ),
    ),
  ],
};

const sorted = (ids: readonly string[]): string[] => [...new Set(ids)].sort();

describe("the three artifacts name the same scenarios", () => {
  it.each(approvedFixtureConsumers)("%s selects only fixture v7", (path) => {
    const versions = [
      ...readFileSync(repoFile(path), "utf8").matchAll(
        /(?:test-scenario-answer-key\.md|Scenario fixtures)[^\n]{0,80}?\bv(\d+)\b/gi,
      ),
    ].map((match) => match[1]);
    expect(versions.length, `${path} fixture pointers`).toBeGreaterThan(0);
    expect([...new Set(versions)]).toEqual(["7"]);
  });

  // Runs before anything parameterized: a disagreement here means every check below is looping
  // over the wrong set, so reporting it as its own failure is clearer than a downstream symptom.
  it("the answer key and the intake fixtures cover the same scenarios", () => {
    expect(sorted(scenarioIdsIn.fixtures())).toEqual(sorted(scenarioIdsIn.answerKey()));
  });

  it("no rule claims a scenario that does not exist", () => {
    expect(
      scenarioIdsIn
        .ruleMetadata()
        .filter((id) => !scenarioIdsIn.answerKeyIncludingRescopes().includes(id)),
      "exercised_by_scenarios naming a scenario the answer key does not define",
    ).toEqual([]);
  });
});

const scenarios = scenarioIdsIn.fixtures();

describe("the fixture suite and the published ruleset agree", () => {
  it.each(scenarios)("Scenario %s evaluates the intake the answer key documents", (scenario) => {
    // Without this the guard checks rule ids against a fixture it never verifies: change a
    // scenario's inputs in the key and every suite here stays green while evaluating the old one.
    const { pairs } = documentedInputs(scenario);
    const fixture = SCENARIO_INTAKE_FIXTURES.find((entry) => entry.scenario === scenario);
    const submission = fixtureSubmission(fixture as (typeof SCENARIO_INTAKE_FIXTURES)[number]);
    const declared = new Set(ruleset.intakeFields.map((field) => field.field));

    for (const [documentedName, documentedValue] of pairs) {
      const field = DOCUMENTED_FIELD_ALIASES[documentedName] ?? documentedName;
      // A name the registry does not declare means the key uses a shorthand nobody mapped; that
      // has to be noticed rather than skipped.
      expect(declared, `Scenario ${scenario} documents "${documentedName}"`).toContain(field);
      expect(
        submission[field],
        `Scenario ${scenario}: the key documents ${field}=${documentedValue}`,
      ).toEqual(asFixtureType(documentedValue, submission[field]));
    }
  });

  it.each(scenarios)("Scenario %s states nothing this comparison silently skips", (scenario) => {
    const { pairs, prose } = documentedInputs(scenario);
    // Guards the reader itself: a reformat that stopped matching would leave the comparison above
    // asserting nothing at all.
    expect(pairs.size, `Scenario ${scenario} documented pairs`).toBeGreaterThanOrEqual(5);
    expect(prose, `Scenario ${scenario} prose the reader cannot compare`).toEqual(
      UNCOMPARED_PROSE[scenario],
    );
  });

  it("evaluates on the clock the answer key pins", () => {
    const clock = /`today = (\d{4}-\d{2}-\d{2})`/.exec(answerKey)?.[1];
    expect(clock, "the key states its fixture clock").toBeDefined();
    expect(FIXTURE_TODAY).toBe(clock);
  });

  it("Scenario F documents exactly the material facts that branch its verdict", () => {
    const documented = [
      ...(sectionFor("F").match(/material branch facts: ([^.]+)\./)?.[1] ?? "").matchAll(
        /`([^`]+)`/g,
      ),
    ].map((match) => match[1]);
    expect(documented).toHaveLength(2);
    expect(
      planFor("F")
        .verdictDetail.missingFacts.map((fact) => fact.field)
        .sort(),
    ).toEqual(documented.sort());
  });

  it("reads a rule id out of every scenario's expected findings", () => {
    // Guards the scrape itself: a reformat of the key that stopped matching would otherwise turn
    // this whole file into a no-op that still reports green.
    for (const scenario of scenarios) {
      expect(
        expectedRuleIds(scenario).length,
        `Scenario ${scenario} expected findings`,
      ).toBeGreaterThan(0);
    }
    expect(expectedRuleIds("A")).toContain("SAPO-STREET-LARGE-001");
    // Scoped to the expected-findings block, so D's separate-unit-fixture note stays out.
    expect(expectedRuleIds("D")).not.toContain("SAPO-BLOCK-PARTY-ELIG-001");
  });

  it.each(scenarios)("Scenario %s reaches nothing the answer key omits", (scenario) => {
    // Reached, not fired. A conditional finding is a line the organizer sees, so a rule reached
    // through a material unknown and absent from the key is a false addition just as a fired one
    // is — and checking only fired meant deleting a conditional line from the key went unnoticed.
    const expected = expectedRuleIds(scenario);
    const unlisted = reachedIn(scenario)
      .filter((ruleId) => !expected.includes(ruleId))
      .filter((ruleId) => !isKnown(scenario, ruleId, "reaches-but-key-omits"));
    expect(
      unlisted,
      `rules ${scenario} reaches, fired or conditional, that its expected findings omit`,
    ).toEqual([]);
  });

  it.each(scenarios)("Scenario %s reaches everything the answer key lists", (scenario) => {
    // A listed rule may be conditional rather than firing — the key lists the DOB structure rules
    // in E precisely because they are unresolved — but it may not be inert.
    const reached = reachedIn(scenario);
    const inert = expectedRuleIds(scenario).filter((ruleId) => !reached.includes(ruleId));
    expect(inert, `rules the key lists for ${scenario} that no intake answer reaches`).toEqual([]);
  });

  it.each(["A"])(
    "Scenario %s's documented rescopes agree with exercised_by_scenarios",
    (scenario) => {
      // The same bidirectional check as the scenarios below, run over the rescope variants. Admitting
      // "A-rescope" as a valid name without this evaluates nothing about it: an unrelated rule could
      // claim the rescope, or a rule the rescope reaches could drop the claim, and the union of names
      // would still look right.
      const name = `${scenario}-rescope`;
      const reached = rescopeReachedIn(scenario);
      expect(
        reached.length,
        `${name} reaches nothing, so this check would assert nothing`,
      ).toBeGreaterThan(0);

      const claims = new Map(
        [...publishedRuleset.rules, ...publishedRuleset.advisories].map((rule) => [
          rule.id,
          rule.exercised_by_scenarios ?? [],
        ]),
      );

      const claimsButCannotReach = [...claims]
        .filter(([ruleId, listed]) => listed.includes(name) && !reached.includes(ruleId))
        .map(([ruleId]) => ruleId)
        .filter((ruleId) => !isKnown(name, ruleId, "claims-scenario-it-cannot-reach"));
      expect(claimsButCannotReach, `rules claiming ${name} that no rescope reaches`).toEqual([]);

      const reachesButOmits = metadataOmissions(name, reached, claims).filter(
        (ruleId) => !isKnown(name, ruleId, "reaches-scenario-it-omits"),
      );
      expect(
        reachesButOmits,
        `rules ${name} reaches, fired or conditional, whose exercised_by_scenarios omits it`,
      ).toEqual([]);
    },
  );

  it.each(scenarios)("Scenario %s agrees with exercised_by_scenarios", (scenario) => {
    const reached = reachedIn(scenario);
    const claims = new Map(
      [...publishedRuleset.rules, ...publishedRuleset.advisories].map((rule) => [
        rule.id,
        rule.exercised_by_scenarios ?? [],
      ]),
    );

    const claimsButCannotReach = [...claims]
      .filter(([ruleId, listed]) => listed.includes(scenario) && !reached.includes(ruleId))
      .map(([ruleId]) => ruleId)
      .filter((ruleId) => !isKnown(scenario, ruleId, "claims-scenario-it-cannot-reach"));
    expect(claimsButCannotReach, `rules claiming ${scenario} that it never reaches`).toEqual([]);

    const reachesButOmits = metadataOmissions(scenario, reached, claims).filter(
      (ruleId) => !isKnown(scenario, ruleId, "reaches-scenario-it-omits"),
    );
    expect(
      reachesButOmits,
      `rules ${scenario} reaches, fired or conditional, whose exercised_by_scenarios omits it`,
    ).toEqual([]);
  });

  it("catches a rule a scenario reaches only conditionally", () => {
    // The check this replaces looked at fired alone, so a rule reached only through a material
    // unknown could lose its scenario from exercised_by_scenarios and stay green. That is the
    // check that caught DOHMH-EXEMPTION-001 being wrong in both directions, so it is worth
    // pinning against synthetic input rather than waiting for the ruleset to grow another case.
    const claims = new Map<string, readonly string[]>([
      ["FIRES-001", ["X"]],
      ["CONDITIONAL-001", []],
      ["DOCUMENTED-001", ["X"]],
    ]);

    expect(metadataOmissions("X", ["FIRES-001", "DOCUMENTED-001"], claims)).toEqual([]);
    // reached-but-not-fired, and its metadata does not name the scenario
    expect(metadataOmissions("X", ["FIRES-001", "CONDITIONAL-001"], claims)).toEqual([
      "CONDITIONAL-001",
    ]);
    // a rule with no metadata at all is an omission, not an exemption
    expect(metadataOmissions("X", ["UNKNOWN-001"], claims)).toEqual(["UNKNOWN-001"]);
  });

  it("keeps the allowlist honest: every recorded disagreement still exists", () => {
    // The mirror of the checks above. Once a disagreement is resolved its entry must go, or the
    // list becomes a place where a real finding can hide behind an issue number.
    for (const entry of KNOWN_DISAGREEMENTS) {
      for (const scenario of entry.scenarios) {
        // A rescope id names variants of a scenario rather than a fixture of its own, so it is
        // reached the same way the check that records it reaches it.
        const rescopeOf = /^([A-Z])-rescope$/.exec(scenario)?.[1];
        const reached = rescopeOf === undefined ? reachedIn(scenario) : rescopeReachedIn(rescopeOf);
        const claims =
          [...publishedRuleset.rules, ...publishedRuleset.advisories].find(
            (rule) => rule.id === entry.ruleId,
          )?.exercised_by_scenarios ?? [];

        const stillDisagrees =
          entry.kind === "reaches-but-key-omits"
            ? reached.includes(entry.ruleId) && !expectedRuleIds(scenario).includes(entry.ruleId)
            : entry.kind === "claims-scenario-it-cannot-reach"
              ? claims.includes(scenario) && !reached.includes(entry.ruleId)
              : reached.includes(entry.ruleId) && !claims.includes(scenario);

        expect(
          stillDisagrees,
          `${entry.ruleId} / Scenario ${scenario} no longer disagrees — remove its allowlist entry`,
        ).toBe(true);
      }
    }
  });

  it("keeps the unconsumed-field exemptions current with the published registry", () => {
    // The loader applies this list to any ruleset, so whether an entry is still needed can only be
    // judged against the artifact it was written about. Two ways to go stale: the field gained a
    // consumer, or it left the registry — the second matters because a dead entry would silently
    // cover the name if it were ever reintroduced without one.
    const declared = new Set(ruleset.intakeFields.map((field) => field.field));
    for (const [field, reason] of Object.entries(UNCONSUMED_INTAKE_FIELDS)) {
      expect(
        declared,
        `${field} is exempted but the published registry no longer declares it`,
      ).toContain(field);
      expect(reason, `${field} needs a reason, not just an exemption`).not.toBe("");
    }

    // And the exemptions must still be the only unconsumed fields: anything newly inert fails the
    // load, but a field that quietly gained a consumer would leave a dead entry behind.
    const consumed = new Set([
      ...ruleset.rules.flatMap((rule) => triggerFields(rule.trigger)),
      ...ruleset.intakeFields.flatMap((field) =>
        (field.askedWhenClauses ?? []).map((clause) => clause.field),
      ),
      "event_date",
      ...ruleset.rules.flatMap((rule) =>
        rule.levelBinding === null
          ? []
          : [rule.levelBinding.levelField, rule.levelBinding.multiBlockField],
      ),
    ]);
    for (const field of Object.keys(UNCONSUMED_INTAKE_FIELDS)) {
      expect(consumed, `${field} is now consumed; remove its exemption`).not.toContain(field);
    }
  });

  it("names every published street-size window in the unknown ladder", () => {
    // #89 item 1: the key's ladder line said "14/30/45" while the registry permits a fourth size
    // and SAPO-STREET-XL-001 publishes a 60-day window, so the one fixture that documents what an
    // organizer of unknown size is shown omitted the longest window that might apply — and the
    // extra-large arm is the only one that is not FEASIBLE, so the omission hid the case that
    // matters. Nothing caught it: this file compares the six lettered scenarios, and the unknown
    // ladder is a boundary fixture, so the key line was compared to nothing at all.
    //
    // Reads the day counts out of the published rules rather than restating them, so a ruleset that
    // adds, drops or retimes a size arm fails here until the key's ladder is updated to match.
    const published = publishedRuleset.rules
      .filter((rule) => rule.id.startsWith("SAPO-STREET-"))
      .map(
        (rule) => (rule as { output: { deadline?: { calendar_days?: number } } }).output.deadline,
      )
      .map((deadline) => deadline?.calendar_days)
      .filter((days): days is number => typeof days === "number")
      .sort((left, right) => left - right);
    expect(published.length, "published street-size arms").toBeGreaterThan(1);

    // The boundary-fixture bullet, not any prose that happens to mention the field — the status
    // paragraph names it too, and matching that made this assert nothing.
    const ladder = answerKey
      .split("\n")
      .find((line) => line.startsWith("- street_event_size=unknown"));
    expect(ladder, "the key documents the unknown-size ladder").toBeDefined();
    const stated = (/((?:\d+\/)+\d+)-day ladder/.exec(ladder ?? "")?.[1] ?? "")
      .split("/")
      .map(Number)
      .sort((left, right) => left - right);

    expect(stated, `ladder line states every published window: ${ladder}`).toEqual(published);
  });

  it("pairs every dedupe key with at least one other rule", () => {
    // #89 item 6 was a dedupe key declared on exactly one rule: DOB-TALL-STRUCTURE-001 published
    // `dob-structure` and said in its own note_text that it deduplicates with the area/duration DOB
    // rules, but DOB-TENT-001 published no key, so the key paired with nothing and one permit
    // rendered as two findings. A lone dedupe key is always a dangling reference — merging is what
    // the key is for — and this is the reverse check that makes the next one fail on arrival, the
    // same shape as #91's guard against an intake field no trigger consumes.
    //
    // It also covers the gap that let item 6 through this file: the comparison above reads rule-id
    // SETS, so a key that names both DOB rules inside one numbered entry agreed with a plan that
    // rendered them as two lines. Grouping is invisible to a set comparison; this is structural.
    const byKey = new Map<string, string[]>();
    for (const rule of [...publishedRuleset.rules, ...publishedRuleset.advisories]) {
      const key = rule.output?.dedupe_key;
      if (key === undefined) continue;
      byKey.set(key, [...(byKey.get(key) ?? []), rule.id]);
    }
    expect(byKey.size, "the published ruleset declares at least one dedupe key").toBeGreaterThan(0);
    for (const [key, ruleIds] of byKey) {
      expect(
        ruleIds.length,
        `dedupe key "${key}" is declared only by ${ruleIds[0]}`,
      ).toBeGreaterThan(1);
    }
  });

  it("gives every OFFICIAL_CONFLICT rule the note_text its conflict line renders from", () => {
    // F-206 AC 2 requires an OFFICIAL_CONFLICT line to render BOTH readings with BOTH sources, and
    // `findings.ts` builds that line from exactly one field:
    //
    //   conflictText: rule.verificationStatus === "OFFICIAL_CONFLICT" ? rule.noteText : null
    //
    // `noteText` is read from `output.note_text` alone (ruleset.ts). A rule whose conflict prose
    // lives in the `notes` ARRAY instead therefore parses fine, evaluates fine, and renders a
    // conflict badge with NOTHING in it. The criterion holds today only by luck: both published
    // OFFICIAL_CONFLICT rules happen to carry note_text.
    //
    // Nothing in the suite caught this. It was measured, not guessed: flipping DOB-ASSEMBLY-001 to
    // OFFICIAL_CONFLICT left the suite 808/808 GREEN while the rendering was broken, because every
    // other check compares rule ids, dispositions and dates, and none reads the field the conflict
    // line is made of. This is the ABSENT-not-disagreeing shape the rest of this file has been
    // moved toward: it fails when a rule arrives without the field, rather than only when two
    // artifacts state that field differently.
    //
    // Asserted over the whole published ruleset (`ruleset.rules` is rules followed by advisories in
    // file order) rather than a fixture list, so a third OFFICIAL_CONFLICT rule added later is
    // covered without anyone remembering to extend a test.
    //
    // Two assertions, not one, because "the field is present" and "the field carries something a
    // reader can see" are different claims and a note_text of " " satisfies the first while
    // producing exactly the empty badge this guard exists to prevent. They are kept separate so the
    // failure names which of the two happened: a missing field means the prose is somewhere else
    // (probably the notes array), a blank one means the prose was never written.
    //
    // Non-whitespace is the strongest claim this check can honestly make. F-206 AC 2 wants BOTH
    // readings with BOTH sources, and no length threshold tests for that: a one-character note_text
    // passes any minimum, and a long one can still state a single reading. Whether two readings are
    // actually present is a reading-comprehension judgement that belongs to the product owner,
    // not to a character count invented here. So this asserts renderability, which is mechanical,
    // and deliberately stops short of adequacy, which is not.
    const conflictRules = ruleset.rules.filter(
      (rule) => rule.verificationStatus === "OFFICIAL_CONFLICT",
    );
    expect(
      conflictRules.length,
      "the published ruleset declares at least one OFFICIAL_CONFLICT rule",
    ).toBeGreaterThan(0);

    for (const rule of conflictRules) {
      expect(
        rule.noteText,
        `${rule.id} is OFFICIAL_CONFLICT but publishes no output.note_text, so findings.ts ` +
          `computes conflictText: null and F-206's conflict line renders empty. OFFICIAL_CONFLICT ` +
          `requires note_text because conflictText reads that field and nothing else. If this ` +
          `rule's prose is in the output.notes array, move it into note_text rather than changing ` +
          `the rule's verification status.`,
      ).not.toBeNull();

      expect(
        (rule.noteText ?? "").trim().length,
        `${rule.id} is OFFICIAL_CONFLICT and its output.note_text is present but blank (whitespace ` +
          `only), so findings.ts computes a non-null conflictText that renders as an empty ` +
          `conflict badge. F-206 AC 2 requires the line to state BOTH readings with BOTH sources, ` +
          `so write that prose into note_text; a present-but-empty field is the same defect as a ` +
          `missing one from the reader's side.`,
      ).toBeGreaterThan(0);
    }
  });

  // ---------------------------------------------------------------------------------------------
  // The key's OUTPUTS, not just its rule ids.
  //
  // Until now this file reduced each "Expected findings" block to its rule ids, so the key's filing
  // dates, deadline statuses and expected verdicts were compared to nothing at all: change Scenario
  // A's documented deadline from July 12 to July 13, or its verdict from INFEASIBLE to FEASIBLE,
  // and every check above stayed green (#89 item 8).
  //
  // `acceptance.test.ts` asserts those same outputs but stores them as TypeScript literals rather
  // than reading the key, and the audit called that a second source of truth for one fact. The
  // duplication is not what made drift silent, though — the MISSING EDGE was. The three artifacts
  // form a triangle: the key, the engine, and those literals. `acceptance.test.ts` closes
  // engine-to-literals. This block closes key-to-engine. With both edges live, a key that disagrees
  // with a literal must fail one of them, so no third check is needed and the literals can stay
  // where a reader can see them. That is why they are left alone rather than derived or deleted:
  // moving every output check into markdown parsing would trade a readable, robust check for a
  // fragile one, and a parser that silently matches nothing reports green — which is the failure
  // the scrape guards below exist for.
  //
  // The transitivity closes only where the two overlap. Outputs `acceptance.test.ts` asserts and
  // this block does not read can still drift, which is the argument for reading as much of the key
  // as can be read without interpreting its prose.
  // ---------------------------------------------------------------------------------------------

  it.each(scenarios)(
    "Scenario %s's documented verdict is the one the engine reaches",
    (scenario) => {
      expect(planFor(scenario).verdict, `Scenario ${scenario} verdict`).toBe(
        documentedVerdict(scenario),
      );
    },
  );

  it.each(scenarios)(
    "Scenario %s's documented deadline statuses are the ones the engine assigns",
    (scenario) => {
      const plan = planFor(scenario);
      const statusByRuleId = new Map(
        plan.findings.flatMap((finding) =>
          finding.ruleIds.map((ruleId) => [ruleId, finding.deadlineStatus] as const),
        ),
      );
      const disagreements = documentedFindings(scenario)
        .filter((documented) => documented.status !== null)
        .filter((documented) => statusByRuleId.get(documented.ruleId) !== documented.status)
        .map(
          (documented) =>
            `${documented.ruleId}: key says ${documented.status}, engine says ${
              statusByRuleId.get(documented.ruleId) ?? "no finding"
            }`,
        );
      expect(disagreements, `Scenario ${scenario} deadline statuses`).toEqual([]);
    },
  );

  it.each(scenarios)(
    "Scenario %s states no date the engine does not produce for that finding",
    (scenario) => {
      const plan = planFor(scenario);
      const fixture = SCENARIO_INTAKE_FIXTURES.find((entry) => entry.scenario === scenario);
      const eventDate = String(
        (fixtureSubmission(fixture!) as Record<string, unknown>).event_date ?? "",
      );

      const disagreements: string[] = [];
      for (const documented of documentedFindings(scenario)) {
        if (documented.dates.length === 0) continue;
        const finding = plan.findings.find((candidate) =>
          candidate.ruleIds.includes(documented.ruleId),
        );
        // Every date the key states about a finding must be a date the engine produced for it: its
        // filing deadline or its earliest-filing date. The event date is a third possibility, but
        // only for a line that is measuring time REMAINING TO the event rather than naming a
        // filing deadline, and only for the date that phrase points at.
        //
        // Scenario F is the line that earns the exception: "only 14 business days remain to
        // 2026-08-11" states the EVENT date, not the deadline the engine computes (2026-07-21).
        // Permitting the event date for every finding instead, which an earlier revision did,
        // opens a hole big enough to swallow the drift this check exists for: Scenario A's
        // "45-day deadline = 2026-07-12" could be swapped for its own event date 2026-08-26 and
        // stay green, because the event date was permitted everywhere. So the allowance is scoped
        // to the key's own prose, which says which reading it means.
        const measuredToEvent = new Set(
          [...documented.line.matchAll(/\bremain(?:s|ing)?\s+to\s+\**(20\d\d-\d\d-\d\d)/g)].map(
            (match) => match[1]!,
          ),
        );
        for (const date of documented.dates) {
          const permitted = [
            finding?.latestApplyDate,
            finding?.applyAfterDate,
            ...(measuredToEvent.has(date) ? [eventDate] : []),
          ].filter(
            (candidate): candidate is string =>
              typeof candidate === "string" && candidate.length > 0,
          );
          if (!permitted.includes(date)) {
            disagreements.push(
              `${documented.ruleId}: key states ${date}, engine has ${permitted.join(", ") || "no dates"}`,
            );
          }
        }
      }
      expect(disagreements, `Scenario ${scenario} documented dates`).toEqual([]);
    },
  );

  /**
   * The scenarios whose prose states how many findings they expect, which is the only statement the
   * key makes about GROUPING rather than about which ids appear. Scenario E is the one, and it is
   * the one that mattered: it said eight while the rules produced nine, and every id-set check
   * passed because both artifacts named the same nine ids.
   */
  const SCENARIOS_STATING_A_FINDING_COUNT: readonly string[] = ["E"];

  it.each(scenarios)(
    "Scenario %s's stated finding count is the number the engine emits",
    (scenario) => {
      // The grouping half of #89 item 8, and the check that would have caught item 6: the key said
      // Scenario E had eight findings while the published rules produced nine, and every id-set
      // comparison above passed because both artifacts named the same nine ids — the disagreement
      // was purely how they grouped. A count is the one statement about grouping the key makes in
      // words, so it is the one that can be compared without interpreting its numbering. Its
      // numbered items are NOT one-per-finding: Scenario B's item 4 is a negative statement naming
      // no rule, and Scenario F's item 2 is a branch listing three alternatives, so counting items
      // would compare two different things.
      const written: Readonly<Record<string, number>> = {
        one: 1,
        two: 2,
        three: 3,
        four: 4,
        five: 5,
        six: 6,
        seven: 7,
        eight: 8,
        nine: 9,
        ten: 10,
        eleven: 11,
        twelve: 12,
      };
      const stated = new RegExp(`\\b(${Object.keys(written).join("|")}) findings\\b`).exec(
        sectionFor(scenario),
      );

      // An earlier revision returned here when the regex missed, which made the file's only
      // grouping comparison switch itself off the moment the key was reworded, the same silence
      // that let #89 item 6 through in the first place. Not every scenario states a count, so the
      // claim is not "each one does"; it is that the SET which does cannot shrink. Pinned both
      // ways: a scenario that stops stating its count fails, and one that starts stating a count
      // nothing compares fails too.
      if (!SCENARIOS_STATING_A_FINDING_COUNT.includes(scenario)) {
        expect(
          stated?.[1] ?? null,
          `Scenario ${scenario} states a finding count nothing pins`,
        ).toBe(null);
        return;
      }
      expect(stated?.[1] ?? null, `Scenario ${scenario} states a finding count`).not.toBeNull();
      expect(planFor(scenario).findings.length, `Scenario ${scenario} finding count`).toBe(
        written[stated![1]!],
      );
    },
  );

  it("Scenario A's documented rescope outputs are the ones the engine re-evaluates to", () => {
    // The scope half: the rescopes are documented outputs that nothing evaluated. Two things this
    // reader gets wrong if it is written the obvious way, both found on review:
    //
    // Pairing. Matching the suggestion's VALUE anywhere in the bullet text pairs on "medium"
    // appearing at all, so a bullet mentioning it for an unrelated reason pairs wrongly, and a
    // value that is a substring of another word pairs wrongly too. F-201 AC 9 names the field as
    // well as the value (`size=medium`, `size=small`), so both are parsed and both must agree.
    //
    // Coverage. `documentedFindings` splits each section at `**EXPECTED VERDICT` and keeps what
    // precedes it, which is right for the expected-findings block and means these bullets, which
    // sit AFTER that marker, are read by nothing else in this file. Their two filing dates and
    // their ON_TRACK are documented outputs, so they are compared here rather than left to the
    // split. The bullets name no rule id, so the comparison is the one the dates check already
    // makes: a date or status the key states must be one the re-evaluated plan actually produced.
    const plan = planFor("A");
    const bullets = sectionFor("A")
      .split("\n")
      .filter((line) => /^- \([a-z]\) /.test(line));
    expect(bullets.length, "A documents rescope bullets").toBeGreaterThan(0);

    const compared: string[] = [];
    const comparedOutputs: string[] = [];
    const disagreements: string[] = [];
    for (const suggestion of plan.verdictDetail.rescopeSuggestions) {
      const value = String(suggestion.change.value);
      const matching = bullets.filter((bullet) => {
        const documented = /\*\*([a-z_]+)=([a-z_]+)\*\*/.exec(bullet);
        if (documented === null) return false;
        const field = RESCOPE_FIELD_ALIASES[documented[1]!] ?? documented[1]!;
        return field === suggestion.change.field && documented[2]! === value;
      });
      if (matching.length !== 1) continue;
      const bullet = matching[0]!;
      const stated = /→[^→]*?\b(FEASIBLE-AT-RISK|FEASIBLE|CONDITIONAL|INFEASIBLE)\b/.exec(
        bullet,
      )?.[1];
      // (c) documents which findings drop rather than a verdict, and names no field=value pair
      // either, so it pairs with nothing and states no verdict to compare.
      if (stated === undefined) continue;
      compared.push(value);
      const documentedVerdictName = VERDICT_BY_DOCUMENTED_NAME[stated]!;
      if (suggestion.reevaluatedVerdict !== documentedVerdictName) {
        disagreements.push(
          `${value}: key says ${documentedVerdictName}, engine re-evaluates to ${suggestion.reevaluatedVerdict}`,
        );
      }

      const variant = rescopePlan("A", suggestion.change);
      const producedDates = variant.findings
        .flatMap((finding) => [finding.latestApplyDate, finding.applyAfterDate])
        .filter((date): date is string => typeof date === "string" && date.length > 0);
      for (const date of [...bullet.matchAll(/\b(20\d\d-\d\d-\d\d)\b/g)].map(
        (match) => match[1]!,
      )) {
        comparedOutputs.push(`${value}:${date}`);
        if (!producedDates.includes(date)) {
          disagreements.push(
            `${value}: key states ${date}, re-evaluated plan has ${producedDates.join(", ") || "no dates"}`,
          );
        }
      }
      const producedStatuses = variant.findings.map((finding) => finding.deadlineStatus);
      for (const status of DEADLINE_STATUSES.filter((candidate) =>
        bullet.includes(candidate.toUpperCase()),
      )) {
        comparedOutputs.push(`${value}:${status}`);
        if (!producedStatuses.includes(status)) {
          disagreements.push(
            `${value}: key states ${status}, re-evaluated plan has ${[...new Set(producedStatuses)].join(", ")}`,
          );
        }
      }
    }
    expect(disagreements, "A's rescope outputs").toEqual([]);
    // Guards the pairing: A documents a verdict for two of its three rescopes.
    expect(compared.sort(), "rescopes whose documented verdict was compared").toEqual([
      "medium",
      "small",
    ]);
    // And guards this comparison the way the scrape guard below guards the others: exact, so a
    // bullet that stops stating a date or a status fails rather than quietly comparing less.
    expect(comparedOutputs.sort(), "rescope outputs compared").toEqual([
      "medium:2026-07-27",
      "small:2026-08-12",
      "small:on_track",
    ]);
  });

  it.each(scenarios)(
    "Scenario %s's documented grouping is the grouping the engine emits",
    (scenario) => {
      // F-201 AC 7 and the residue of #89 item 6. The status and date checks flatten a finding to its
      // rule ids and match by `includes`, so nothing asserts which ids share ONE finding. If E's two
      // DOB ids split while some same-status pair merged, the id set is unchanged, the finding count
      // is unchanged, and every comparison above passes while the grouping the key specifies is gone.
      //
      // Read from the key's own statement rather than from line layout, because layout does not mean
      // grouping here: Scenario F names SLA-ONEDAY-001 and SLA-CATERING-001 on one line and the engine
      // emits them as two findings, correctly. E's line says "One finding carrying both rule ids", so
      // that sentence is the claim, and the count of such statements is pinned below so deleting the
      // sentence fails rather than quietly removing the only grouping this compares.
      const merged = documentedFindings(scenario).filter((documented) =>
        /One finding carrying both rule ids/.test(documented.line),
      );
      const disagreements = merged
        .filter((documented) => {
          const finding = planFor(scenario).findings.find((candidate) =>
            candidate.ruleIds.includes(documented.ruleIds[0]!),
          );
          const emitted = [...(finding?.ruleIds ?? [])].sort();
          return JSON.stringify(emitted) !== JSON.stringify([...documented.ruleIds].sort());
        })
        .map((documented) => {
          const finding = planFor(scenario).findings.find((candidate) =>
            candidate.ruleIds.includes(documented.ruleIds[0]!),
          );
          return `${documented.ruleIds.join("+")}: key groups them as one finding, engine emits ${
            finding ? finding.ruleIds.join("+") : "no finding"
          }`;
        });
      expect(disagreements, `Scenario ${scenario} documented grouping`).toEqual([]);
      // Pinned per scenario for the round-2 reason: without this, deleting the sentence empties the
      // reader and the comparison passes having compared nothing, which is the defect this test
      // exists to close rather than to reproduce.
      expect(merged.length, `Scenario ${scenario} grouping statements read out of the key`).toBe(
        DOCUMENTED_GROUPINGS_PER_SCENARIO[scenario] ?? 0,
      );
    },
  );

  it.each(scenarios)(
    "Scenario %s's documented slack days are the ones the engine computes",
    (scenario) => {
      // F-102 AC 5. The date reader is ISO-only, so "(10 days)" was invisible to every check. Two
      // different statements against two different engine fields, deliberately not conflated:
      // a parenthesised count on a FINDING line is that finding's `slackDays`, and a count on the
      // verdict line is the PLAN's `minSlackDays`. Changing either to nine moved no date, status,
      // verdict or count before this.
      //
      // Narrow on purpose. The key states lead times in the same units all over these lines ("45-day
      // deadline", "≥5 days", "15 business days", "processing 21–30 days"), and none of those is
      // slack. Only a parenthetical that contains nothing but the count is read, which is the shape
      // the key uses when it means slack.
      const plan = planFor(scenario);
      const disagreements: string[] = [];
      let findingSlackRead = 0;
      for (const documented of documentedFindings(scenario)) {
        const stated = /\((~?)(\d+) days?(?: slack)?\)/.exec(documented.line);
        if (stated === null) continue;
        findingSlackRead += 1;
        const finding = plan.findings.find((candidate) =>
          candidate.ruleIds.includes(documented.ruleId),
        );
        if (finding?.slackDays !== Number(stated[2]!)) {
          disagreements.push(
            `${documented.ruleId}: key states ${stated[2]} days of slack, engine computes ${finding?.slackDays ?? "no finding"}`,
          );
        }
      }
      const verdictLine = sectionFor(scenario)
        .split("\n")
        .find((line) => line.startsWith("**EXPECTED VERDICT"));
      const statedMin = /(?:within|with)\s*~?(\d+) days/.exec(verdictLine ?? "");
      if (statedMin !== null && plan.verdictDetail.minSlackDays !== Number(statedMin[1]!)) {
        disagreements.push(
          `verdict line: key states ${statedMin[1]} days, engine computes minSlackDays ${plan.verdictDetail.minSlackDays}`,
        );
      }
      expect(disagreements, `Scenario ${scenario} documented slack`).toEqual([]);
      // Pinned, because both readers above skip silently when their pattern misses: delete Scenario
      // A's "(5 days)" or reword it to "(five days)" and `disagreements` stays empty, so the key can
      // stop stating an output this check claims to protect while the suite goes green having
      // compared nothing. The verdict half fails the same way when its own pattern misses, so the
      // two are pinned separately: they are different engine fields and a reader can lose one and
      // keep the other. The grouping check above already does this; this block did not.
      expect(
        { findings: findingSlackRead, verdictLine: statedMin !== null },
        `Scenario ${scenario} slack statements read out of the key`,
      ).toEqual(DOCUMENTED_SLACK_PER_SCENARIO[scenario] ?? { findings: 0, verdictLine: false });
    },
  );

  it.each(scenarios)(
    "Scenario %s's documented blocking finding is the one the engine blocks on",
    (scenario) => {
      // `blockingFinding` appeared nowhere in this file, so the rule the key names as the blocker was
      // compared by nothing: only the top-level INFEASIBLE token was, and swapping the named blocker
      // for any other rule the scenario lists passed.
      //
      // The name is compared directly against `verdictDetail.blockingFinding.name`, which the engine
      // copies from the rule's published `permit_name`, so the name identifies the rule and no
      // mapping is needed. An earlier revision declared an alias from "SAPO Street Event (Large)"
      // onto the rule id and asserted `ruleIds` only, which let a name disagreement survive: the key
      // was calling the same finding "Street Event Permit (Large)" on its own finding line and
      // "SAPO Street Event (Large)" on its verdict line, and the alias declared the two equivalent
      // instead of surfacing it. The key's verdict line is corrected in the same commit, because the
      // published rule outranks the fixture (DOCUMENTATION-GOVERNANCE §2 "Regulatory authority hierarchy", and the key says so
      // itself at its own line 5). Checked across all six scenarios before correcting: A is the only
      // verdict line that names a blocking finding at all, so there was no naming convention to
      // defend.
      const verdictLine =
        sectionFor(scenario)
          .split("\n")
          .find((line) => line.startsWith("**EXPECTED VERDICT")) ?? "";
      const stated = /blocking finding:\s*([^;]+?)\s*;/.exec(verdictLine)?.[1]?.trim();
      if (stated === undefined) {
        expect(
          SCENARIOS_DOCUMENTING_A_BLOCKER.includes(scenario),
          `Scenario ${scenario} states no blocking finding`,
        ).toBe(false);
        return;
      }
      expect(
        SCENARIOS_DOCUMENTING_A_BLOCKER.includes(scenario),
        `Scenario ${scenario} states a blocking finding nothing pins`,
      ).toBe(true);
      expect(
        planFor(scenario).verdictDetail.blockingFinding?.name ?? null,
        `Scenario ${scenario} blocking finding name`,
      ).toBe(stated);
    },
  );

  it.each(scenarios)(
    "Scenario %s's documented no-new-requirement results are the engine's disposition",
    (scenario) => {
      // The key does not state a disposition for most findings, and where it uses disposition-shaped
      // English the phrase does not map onto the enum one-to-one: Scenario B writes "MAY apply" for a
      // finding the engine emits as `required`, while Scenario F writes "may apply" for one it emits
      // as `may_be_required`. One phrase, two engine values, so a table over that phrase would encode
      // a guess and would manufacture a disagreement on B. Reported rather than mapped.
      //
      // What IS unambiguous is "no new permit", which names the `no_new_requirement` disposition in
      // the key's own words. That is mapped and compared.
      //
      // Compared against the plan the LINE is about, which is not always the scenario's own plan. F
      // states this one on the `yes →` sub-line of a "branch on venue_license_covers_event_area"
      // parent, while F's fixture leaves that field `unknown`. Reading `planFor("F")` compared the
      // conditional placeholder the unknown plan emits instead of the documented branch output, so
      // branch evaluation could stop emitting SLA-VENUE-LICENSE-001 for `yes` and this check, and
      // the base-plan rule-id checks, would all stay green. The branch is re-evaluated with that one
      // field set, through the same `rescopePlan` the rescope comparison uses rather than a second
      // mechanism.
      const disagreements: string[] = [];
      let stated = 0;
      let onBranch = 0;
      for (const documented of documentedFindings(scenario)) {
        const disposition = DISPOSITION_BY_DOCUMENTED_PHRASE.find((entry) =>
          entry.phrase.test(documented.line),
        );
        if (disposition === undefined) continue;
        stated += 1;
        if (documented.branch !== null) onBranch += 1;
        const plan =
          documented.branch === null ? planFor(scenario) : rescopePlan(scenario, documented.branch);
        const finding = plan.findings.find((candidate) =>
          candidate.ruleIds.includes(documented.ruleId),
        );
        if (finding?.disposition !== disposition.value) {
          disagreements.push(
            `${documented.ruleId}${
              documented.branch === null
                ? ""
                : ` on ${documented.branch.field}=${documented.branch.value}`
            }: key states ${disposition.value}, engine emits ${finding?.disposition ?? "no finding"}`,
          );
        }
      }
      expect(disagreements, `Scenario ${scenario} documented dispositions`).toEqual([]);
      // Pinned on both axes, because the branch half can go quiet on its own. If the sub-line stops
      // parsing as a branch while still matching the phrase, `stated` holds and the comparison
      // silently falls back to the scenario's own plan, which is the defect being fixed here. That
      // regression has been the finding three times tonight; counting only the statements would
      // leave the door open a fourth.
      expect(
        { statements: stated, onBranch },
        `Scenario ${scenario} dispositions read out of the key`,
      ).toEqual(DOCUMENTED_DISPOSITIONS_PER_SCENARIO[scenario] ?? { statements: 0, onBranch: 0 });
    },
  );

  it("reads an output out of the key for every scenario, so a reformat cannot empty these", () => {
    // The scrape guard the checks above depend on. A key whose formatting drifts would make every
    // reader return nothing, and each `toEqual([])` would pass while comparing nothing — the shape
    // this whole file exists to refuse.
    const statusesRead = scenarios.flatMap((scenario) =>
      documentedFindings(scenario).filter((documented) => documented.status !== null),
    );
    const datesRead = scenarios.flatMap((scenario) =>
      documentedFindings(scenario).flatMap((documented) => documented.dates),
    );
    // Exact, not floors. A floor is the weaker statement and it is what let this file drift: at
    // ">= 12" against 16 recognised status lines, four could stop parsing with nobody noticing, so
    // misspelling one documented status would drop it out of the comparison and stay green. Pinned
    // to the true numbers, both directions surface: a parser that reads less fails, and a key that
    // grows a documented output fails until someone extends the comparison to cover it.
    expect(statusesRead.length, "deadline statuses read out of the key").toBe(16);
    expect(datesRead.length, "dates read out of the key").toBe(8);
    // Per scenario, and per OUTPUT rather than per line. Counting lines was the hole: it claimed to
    // stop one scenario's block going quiet while another grew, and did not, because a status or a
    // date can move BETWEEN scenarios without any line count changing. Remove ON_TRACK from
    // Scenario A's NYPD line and add it to Scenario E's DOB line and every earlier assertion holds:
    // the global 16 is unchanged, both lines still parse so both counts are unchanged, and both
    // findings are `on_track` so every engine comparison still agrees. A had stopped stating an
    // expected status and the suite was green.
    //
    // Counts of the parsed outputs, not their identities, because the identities are what the
    // status and date comparisons above already assert against the engine finding by finding; a
    // second copy here would mean two places to update for one approved key change. What is needed
    // is the shape of what was read, per scenario, which is what a migration changes.
    expect(
      Object.fromEntries(
        scenarios.map((scenario) => {
          const documented = documentedFindings(scenario);
          return [
            scenario,
            {
              findings: documented.length,
              statuses: documented.filter((entry) => entry.status !== null).length,
              dates: documented.flatMap((entry) => entry.dates).length,
            },
          ];
        }),
      ),
      "outputs read out of the key per scenario",
    ).toEqual({
      A: { findings: 6, statuses: 4, dates: 2 },
      B: { findings: 4, statuses: 1, dates: 1 },
      C: { findings: 5, statuses: 2, dates: 1 },
      D: { findings: 5, statuses: 3, dates: 1 },
      E: { findings: 9, statuses: 5, dates: 2 },
      F: { findings: 7, statuses: 1, dates: 1 },
    });
    for (const scenario of scenarios) {
      // Throws rather than returning a default if the verdict line stops matching.
      expect(documentedVerdict(scenario)).toBeDefined();
    }
  });

  it("cites an owning issue for every recorded disagreement", () => {
    for (const entry of KNOWN_DISAGREEMENTS) {
      expect(entry.issue, `${entry.ruleId} in ${entry.scenarios.join(", ")}`).toMatch(/#\d+/);
      expect(entry.scenarios.length, `${entry.ruleId} covers no scenario`).toBeGreaterThan(0);
    }
  });
});
