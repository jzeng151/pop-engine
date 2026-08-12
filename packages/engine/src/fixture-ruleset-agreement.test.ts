import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { PUBLISHED_RULES_FILE } from "./__fixtures__/published-ruleset";
import { evaluate, parseEngineRuleset, routesOf, triggerFields } from "./index";
import { UNCONSUMED_INTAKE_FIELDS } from "./ruleset";
import type { EventIntake, Finding, FindingRoute, HolidayCalendar, PermitPlan } from "./types";
import {
  FIXTURE_TODAY,
  SCENARIO_INTAKE_FIXTURES,
  fixtureSubmission,
} from "./intake/scenario-intake-fixtures";

const repoFile = (relativePath: string): string =>
  fileURLToPath(new URL(`../../../${relativePath}`, import.meta.url));

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

const RULE_ID = /\b[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)*-\d{3}\b/g;

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

const DOCUMENTED_FIELD_ALIASES: Readonly<Record<string, string>> = {
  open_to_public: "event_open_to_public",
};

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

const DOCUMENTED_GROUPINGS_PER_SCENARIO: Readonly<Record<string, number>> = {
  A: 0,
  B: 0,
  C: 0,
  D: 0,
  E: 1,
  F: 0,
};

const SCENARIOS_DOCUMENTING_A_BLOCKER: readonly string[] = ["A"];

const DISPOSITION_BY_DOCUMENTED_PHRASE: readonly {
  readonly phrase: RegExp;
  readonly value: Finding["disposition"];
}[] = [{ phrase: /\bno new permit\b/, value: "no_new_requirement" }];

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

function sectionFor(scenario: string): string {
  const section = answerKey
    .split(/^## Scenario /m)
    .find((candidate) => candidate.startsWith(`${scenario} `));
  if (section === undefined) throw new Error(`answer key has no Scenario ${scenario} section`);
  return section;
}

function planFor(scenario: string): PermitPlan {
  const fixture = SCENARIO_INTAKE_FIXTURES.find((entry) => entry.scenario === scenario);
  if (fixture === undefined) throw new Error(`no intake fixture for Scenario ${scenario}`);
  return evaluate(fixtureSubmission(fixture) as EventIntake, ruleset, FIXTURE_TODAY, calendar);
}

const DEADLINE_STATUSES: readonly FindingRoute["deadlineStatus"][] = [
  "on_track",
  "deadline_approaching",
  "published_deadline_missed",
  "not_calculable",
  "not_applicable",
];

const VERDICT_BY_DOCUMENTED_NAME: Readonly<Record<string, PermitPlan["verdict"]>> = {
  FEASIBLE: "FEASIBLE",
  "FEASIBLE-AT-RISK": "FEASIBLE_AT_RISK",
  CONDITIONAL: "CONDITIONAL",
  INFEASIBLE: "INFEASIBLE",
};

type DocumentedFinding = {
  readonly ruleId: string;
  readonly ruleIds: readonly string[];
  readonly dates: readonly string[];
  readonly status: Finding["deadlineStatus"] | null;
  readonly branch: { readonly field: string; readonly value: string } | null;
  readonly line: string;
};

function documentedFindings(scenario: string): DocumentedFinding[] {
  const block = sectionFor(scenario)
    .split("**Expected findings:**")[1]
    ?.split("**EXPECTED VERDICT")[0];
  if (block === undefined) throw new Error(`Scenario ${scenario} has no expected-findings block`);

  const documented: DocumentedFinding[] = [];
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
      ruleIds: [...new Set([...line.matchAll(new RegExp(RULE_ID.source, "g"))].map((m) => m[0]))],
      dates: [...line.matchAll(/\b(20\d\d-\d\d-\d\d)\b/g)].map((match) => match[1]!),
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

function documentedVerdict(scenario: string): PermitPlan["verdict"] {
  const stated = /\*\*EXPECTED VERDICT:\s*[^A-Z]*([A-Z][A-Z-]+)/.exec(sectionFor(scenario))?.[1];
  const verdict = stated === undefined ? undefined : VERDICT_BY_DOCUMENTED_NAME[stated];
  if (verdict === undefined) {
    throw new Error(`Scenario ${scenario} states no verdict this reader recognises: ${stated}`);
  }
  return verdict;
}

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

const RESCOPE_FIELD_ALIASES: Readonly<Record<string, string>> = {
  size: "street_event_size",
};

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

export function metadataOmissions(
  scenario: string,
  reached: readonly string[],
  claims: ReadonlyMap<string, readonly string[]>,
): string[] {
  return reached.filter((ruleId) => !(claims.get(ruleId) ?? []).includes(scenario));
}

const scenarioIdsIn = {
  fixtures: () => SCENARIO_INTAKE_FIXTURES.map((fixture) => fixture.scenario),
  answerKey: () =>
    [...answerKey.matchAll(/^## Scenario ([A-Z])\b/gm)].map((match) => match[1] as string),
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
    const { pairs } = documentedInputs(scenario);
    const fixture = SCENARIO_INTAKE_FIXTURES.find((entry) => entry.scenario === scenario);
    const submission = fixtureSubmission(fixture as (typeof SCENARIO_INTAKE_FIXTURES)[number]);
    const declared = new Set(ruleset.intakeFields.map((field) => field.field));

    for (const [documentedName, documentedValue] of pairs) {
      const field = DOCUMENTED_FIELD_ALIASES[documentedName] ?? documentedName;
      expect(declared, `Scenario ${scenario} documents "${documentedName}"`).toContain(field);
      expect(
        submission[field],
        `Scenario ${scenario}: the key documents ${field}=${documentedValue}`,
      ).toEqual(asFixtureType(documentedValue, submission[field]));
    }
  });

  it.each(scenarios)("Scenario %s states nothing this comparison silently skips", (scenario) => {
    const { pairs, prose } = documentedInputs(scenario);
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
    for (const scenario of scenarios) {
      expect(
        expectedRuleIds(scenario).length,
        `Scenario ${scenario} expected findings`,
      ).toBeGreaterThan(0);
    }
    expect(expectedRuleIds("A")).toContain("SAPO-STREET-LARGE-001");
    expect(expectedRuleIds("D")).not.toContain("SAPO-BLOCK-PARTY-ELIG-001");
  });

  it.each(scenarios)("Scenario %s reaches nothing the answer key omits", (scenario) => {
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
    const reached = reachedIn(scenario);
    const inert = expectedRuleIds(scenario).filter((ruleId) => !reached.includes(ruleId));
    expect(inert, `rules the key lists for ${scenario} that no intake answer reaches`).toEqual([]);
  });

  it.each(["A"])(
    "Scenario %s's documented rescopes agree with exercised_by_scenarios",
    (scenario) => {
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
    const claims = new Map<string, readonly string[]>([
      ["FIRES-001", ["X"]],
      ["CONDITIONAL-001", []],
      ["DOCUMENTED-001", ["X"]],
    ]);

    expect(metadataOmissions("X", ["FIRES-001", "DOCUMENTED-001"], claims)).toEqual([]);
    expect(metadataOmissions("X", ["FIRES-001", "CONDITIONAL-001"], claims)).toEqual([
      "CONDITIONAL-001",
    ]);
    expect(metadataOmissions("X", ["UNKNOWN-001"], claims)).toEqual(["UNKNOWN-001"]);
  });

  it("keeps the allowlist honest: every recorded disagreement still exists", () => {
    for (const entry of KNOWN_DISAGREEMENTS) {
      for (const scenario of entry.scenarios) {
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
    const declared = new Set(ruleset.intakeFields.map((field) => field.field));
    for (const [field, reason] of Object.entries(UNCONSUMED_INTAKE_FIELDS)) {
      expect(
        declared,
        `${field} is exempted but the published registry no longer declares it`,
      ).toContain(field);
      expect(reason, `${field} needs a reason, not just an exemption`).not.toBe("");
    }

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
    const published = publishedRuleset.rules
      .filter((rule) => rule.id.startsWith("SAPO-STREET-"))
      .map(
        (rule) => (rule as { output: { deadline?: { calendar_days?: number } } }).output.deadline,
      )
      .map((deadline) => deadline?.calendar_days)
      .filter((days): days is number => typeof days === "number")
      .sort((left, right) => left - right);
    expect(published.length, "published street-size arms").toBeGreaterThan(1);

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

  const SCENARIOS_STATING_A_FINDING_COUNT: readonly string[] = ["E"];

  it.each(scenarios)(
    "Scenario %s's stated finding count is the number the engine emits",
    (scenario) => {
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
      const producedStatuses = variant.findings
        .flatMap(routesOf)
        .map((route) => route.deadlineStatus);
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
    expect(compared.sort(), "rescopes whose documented verdict was compared").toEqual([
      "medium",
      "small",
    ]);
    expect(comparedOutputs.sort(), "rescope outputs compared").toEqual([
      "medium:2026-07-27",
      "small:2026-08-12",
      "small:on_track",
    ]);
  });

  it.each(scenarios)(
    "Scenario %s's documented grouping is the grouping the engine emits",
    (scenario) => {
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
      expect(merged.length, `Scenario ${scenario} grouping statements read out of the key`).toBe(
        DOCUMENTED_GROUPINGS_PER_SCENARIO[scenario] ?? 0,
      );
    },
  );

  it.each(scenarios)(
    "Scenario %s's documented slack days are the ones the engine computes",
    (scenario) => {
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
      expect(
        { findings: findingSlackRead, verdictLine: statedMin !== null },
        `Scenario ${scenario} slack statements read out of the key`,
      ).toEqual(DOCUMENTED_SLACK_PER_SCENARIO[scenario] ?? { findings: 0, verdictLine: false });
    },
  );

  it.each(scenarios)(
    "Scenario %s's documented blocking finding is the one the engine blocks on",
    (scenario) => {
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
      expect(
        { statements: stated, onBranch },
        `Scenario ${scenario} dispositions read out of the key`,
      ).toEqual(DOCUMENTED_DISPOSITIONS_PER_SCENARIO[scenario] ?? { statements: 0, onBranch: 0 });
    },
  );

  it("reads an output out of the key for every scenario, so a reformat cannot empty these", () => {
    const statusesRead = scenarios.flatMap((scenario) =>
      documentedFindings(scenario).filter((documented) => documented.status !== null),
    );
    const datesRead = scenarios.flatMap((scenario) =>
      documentedFindings(scenario).flatMap((documented) => documented.dates),
    );
    expect(statusesRead.length, "deadline statuses read out of the key").toBe(16);
    expect(datesRead.length, "dates read out of the key").toBe(8);
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
