import { describe, expect, it } from "vitest";
import { evaluate, noRouteSuppliesScalars, parseEngineRuleset } from "./index";
import type { EventIntake, Verdict } from "./types";

const TODAY = "2026-07-22";
const EVENT_DATE = "2026-12-04";

type RuleSpec = {
  readonly id: string;
  readonly kind?: string;
  readonly dedupeKey: string | null;
  readonly trigger: unknown;
  readonly output: Record<string, unknown>;
};

function ruleset(rules: readonly RuleSpec[], fields: readonly unknown[] = []) {
  return parseEngineRuleset({
    ruleset_version: "test.v1",
    jurisdiction: "US-NY-NYC",
    snapshot_date: "2026-07-22",
    config: {
      slack_warning_days: { value: 14 },
      business_day_math: { calendar: "test-calendar@2026" },
    },
    intake_fields: [
      { field: "event_date", type: "date" },
      { field: "headcount", type: "integer" },
      ...fields,
    ],
    rules: rules.map((rule) => ({
      id: rule.id,
      kind: rule.kind ?? "permit",

      trigger: { all: [rule.trigger, { field: "headcount", op: "gte", value: 0 }] },
      output: {
        ...rule.output,
        ...(rule.dedupeKey === null ? {} : { dedupe_key: rule.dedupeKey }),
      },
      verification: { status: "SOURCE_CONFIRMED" },
      source: { citation: `citation ${rule.id}`, urls: [`https://example.test/${rule.id}`] },
    })),
    advisories: [],
  });
}

const plan = (
  rules: readonly RuleSpec[],
  intake: Record<string, unknown> = {},
  fields: readonly unknown[] = [],
) =>
  evaluate(
    { event_date: EVENT_DATE, headcount: 50, ...intake } as unknown as EventIntake,
    ruleset(rules, fields),
    TODAY,
    {
      id: "test-calendar@2026",
      holidays: [],
    },
  );

const ALWAYS = { all: [{ field: "headcount", op: "gte", value: 10 }] };

describe("the measured co-firing sets", () => {
  const SAPO_WINDOWS = [14, 30, 45, 10, 60, 30, 45, 14, 60, 21, 35, 7, 90, 5];
  const sapoPermit = (index: number): RuleSpec => ({
    id: `SAPO-PERMIT-${String(index).padStart(3, "0")}`,
    dedupeKey: "sapo_permit",
    trigger: { all: [{ field: "sapo_event_type", op: "eq", value: `type_${index}` }] },
    output: {
      permit_name: `SAPO instrument ${index}`,
      agency: "SAPO (CECM)",
      deadline: { type: "published_minimum", calendar_days: SAPO_WINDOWS[index] },
      fee: { display: index === 0 ? "$25 processing fee" : "Up to $66,000 per location per day" },
      portal: { name: "E-Apply", url: "https://nyceventpermits.nyc.gov/" },
    },
  });
  const SAPO_GROUP = SAPO_WINDOWS.map((_, index) => sapoPermit(index));
  const SAPO_FIELD = [
    {
      field: "sapo_event_type",
      type: "enum",
      values: ["unknown", ...SAPO_WINDOWS.map((_, index) => `type_${index}`)],
    },
  ];

  it("keeps all fourteen sapo_permit routes, each with its own window and fee", () => {
    const merged = plan(SAPO_GROUP, { sapo_event_type: "unknown" }, SAPO_FIELD).findings[0];
    expect(merged?.ruleIds).toHaveLength(14);
    expect(merged?.routes).toHaveLength(14);
    expect(merged?.headlineMode).toBe("candidate");
    expect(merged?.routes?.every((route) => route.triggerResult === "unknown")).toBe(true);
    expect(new Set(merged?.routes?.map((route) => route.latestApplyDate)).size).toBe(
      new Set(SAPO_WINDOWS).size,
    );
    expect(new Set(merged?.routes?.map((route) => route.name)).size).toBe(14);
    expect(new Set(merged?.routes?.map((route) => route.feeDisplay)).size).toBe(2);
    expect(new Set(merged?.routes?.flatMap((route) => route.unknownFields))).toEqual(
      new Set(["sapo_event_type"]),
    );
  });

  it("renders a settled sapo_event_type as one route and no candidate list", () => {
    const settled = plan(SAPO_GROUP, { sapo_event_type: "type_3" }, SAPO_FIELD).findings;
    expect(settled).toHaveLength(1);
    expect(settled[0]?.routes).toBeUndefined();
    expect(settled[0]?.name).toBe("SAPO instrument 3");
  });

  const identicalOutput = {
    permit_name: "DOB Alteration Type 2 or 3 Temporary Structure Permit",
    agency: "DOB",
    deadline: { type: "research_required", display: "Lead time not published; confirm with DOB" },
  };
  const DOB_TEMPORARY_STRUCTURE = [
    {
      id: "DOB-STAGE-001",
      dedupeKey: "dob_temporary_structure",
      trigger: {
        all: [
          { field: "structure_type", op: "eq", value: "stage" },
          { field: "structure_height_ft", op: "gte", value: 2 },
        ],
      },
      output: identicalOutput,
    },
    {
      id: "DOB-STRUCTURE-DURATION-001",
      dedupeKey: "dob_temporary_structure",
      trigger: { all: [{ field: "structure_duration_days", op: "gte", value: 30 }] },
      output: identicalOutput,
    },
  ] satisfies RuleSpec[];
  const DOB_FIELDS = [
    { field: "structure_type", type: "enum", values: ["stage", "tent"] },
    { field: "structure_height_ft", type: "integer" },
    { field: "structure_duration_days", type: "integer" },
  ];

  it("merges the byte-identical dob_temporary_structure pair with nothing to reconcile", () => {
    const merged = plan(
      DOB_TEMPORARY_STRUCTURE,
      { structure_type: "stage", structure_height_ft: 3, structure_duration_days: 30 },
      DOB_FIELDS,
    ).findings[0];
    expect(merged?.ruleIds).toEqual(["DOB-STAGE-001", "DOB-STRUCTURE-DURATION-001"]);
    expect(merged?.headlineMode).toBe("applies_together");
    const unmerged = plan(
      DOB_TEMPORARY_STRUCTURE.slice(0, 1),
      { structure_type: "stage", structure_height_ft: 3 },
      DOB_FIELDS.slice(0, 2),
    ).findings[0];
    for (const field of [
      "name",
      "agency",
      "disposition",
      "deadlineDisplay",
      "latestApplyDate",
      "deadlineStatus",
      "feeDisplay",
      "portalName",
    ] as const) {
      expect(merged?.[field]).toEqual(unmerged?.[field]);
    }
    expect(merged?.routes).toHaveLength(2);
    const published = merged?.routes?.map((route) =>
      JSON.stringify([
        route.name,
        route.agency,
        route.disposition,
        route.deadlineDisplay,
        route.feeDisplay,
      ]),
    );
    expect(new Set(published).size).toBe(1);
  });

  const SAPO_INSURANCE = [
    {
      id: "SAPO-INSURANCE-GENERAL-001",
      kind: "insurance",
      dedupeKey: "sapo_insurance",
      trigger: { all: [{ field: "sapo_event_type", op: "eq", value: "type_0" }] },
      output: {
        permit_name: "Certificate of Insurance",
        agency: "SAPO (CECM)",
        deadline: {
          type: "before_issuance",
          display: "Must be provided before SAPO permit issuance",
        },
        note_text: "General liability of $1,000,000 per occurrence is required.",
      },
    },
    {
      id: "SAPO-INSURANCE-BLOCK-EXEMPT-001",
      kind: "note",
      dedupeKey: "sapo_insurance",
      trigger: {
        all: [
          { field: "sapo_event_type", op: "eq", value: "type_1" },
          { field: "block_party_has_ride", op: "eq", value: "no" },
        ],
      },
      output: {
        disposition: "NO_NEW_REQUIREMENT_IDENTIFIED",
        note_text: "The general $1,000,000 certificate requirement does not apply to this event.",
      },
    },
  ] satisfies RuleSpec[];
  const INSURANCE_FIELDS = [
    { field: "sapo_event_type", type: "enum", values: ["unknown", "type_0", "type_1"] },
    { field: "block_party_has_ride", type: "enum", values: ["unknown", "yes", "no"] },
  ];

  it("omits an unresolved no-new-requirement reading without losing its uncertainty", () => {
    const result = plan(
      SAPO_INSURANCE,
      { sapo_event_type: "unknown", block_party_has_ride: "no" },
      INSURANCE_FIELDS,
    );
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]).toMatchObject({
      ruleIds: ["SAPO-INSURANCE-GENERAL-001"],
      disposition: "may_be_required",
    });
    expect(result.verdictDetail.trace).toEqual(
      expect.arrayContaining([
        { ruleId: "SAPO-INSURANCE-GENERAL-001", result: "unknown" },
        { ruleId: "SAPO-INSURANCE-BLOCK-EXEMPT-001", result: "unknown" },
      ]),
    );
    expect(result.verdictDetail.missingFacts.map((fact) => fact.field)).toContain(
      "sapo_event_type",
    );
  });

  const NYPD_SOUND = [
    {
      id: "NYPD-SOUND-PUBLIC-001",
      dedupeKey: "nypd_sound",
      trigger: {
        all: [
          { field: "amplified_sound", op: "bool", value: true },
          { field: "location_type", op: "eq", value: "street" },
        ],
      },
      output: {
        permit_name: "Sound Device Permit",
        agency: "NYPD",
        deadline: {
          type: "published_minimum",
          calendar_days: 5,
          display: "File at the precinct no fewer than five days before use",
        },
        fee: {
          display:
            "$45 per sound device for the first day, plus $5 per device for each additional day",
        },
        portal: { name: "NYPD precinct", instructions: "File in person at the precinct" },
      },
    },
    {
      id: "NYPD-SOUND-COMMERCIAL-ADVERTISING-PROHIBITED-001",
      kind: "eligibility",
      dedupeKey: "nypd_sound",
      trigger: {
        all: [
          { field: "amplified_sound", op: "bool", value: true },
          { field: "sound_purpose", op: "eq", value: "commercial_advertising" },
        ],
      },
      output: {
        disposition: "PROHIBITED_OR_INELIGIBLE",
        permit_name: "Commercial advertising by sound device",
        note_text: "Sound devices may not be used for commercial advertising.",
      },
    },
  ] satisfies RuleSpec[];
  const SOUND_FIELDS = [
    { field: "amplified_sound", type: "boolean" },
    { field: "location_type", type: "enum", values: ["unknown", "street", "private_indoor"] },
    {
      field: "sound_purpose",
      type: "enum",
      values: ["unknown", "commercial_advertising", "entertainment"],
    },
  ];

  it("reads the nypd_sound headline off the resolved route when one route is unknown", () => {
    const merged = plan(
      NYPD_SOUND,
      { amplified_sound: true, location_type: "street", sound_purpose: null },
      SOUND_FIELDS,
    ).findings[0];
    expect(merged?.headlineMode).toBe("candidate");
    expect(merged?.name).toBe("Sound Device Permit");
    expect(merged?.latestApplyDate).toBe("2026-11-29");
    expect(merged?.feeDisplay).toContain("$45 per sound device");
    const prohibition = merged?.routes?.find((route) =>
      route.ruleId.includes("COMMERCIAL-ADVERTISING"),
    );
    expect(prohibition?.triggerResult).toBe("unknown");
    expect(prohibition?.disposition).toBe("prohibited_or_ineligible");
    expect(prohibition?.unknownFields).toEqual(["sound_purpose"]);
    expect(prohibition?.latestApplyDate).toBeNull();
  });

  it("reads the nypd_sound headline as the prohibition when both routes resolve", () => {
    const merged = plan(
      NYPD_SOUND,
      {
        amplified_sound: true,
        location_type: "street",
        sound_purpose: "commercial_advertising",
      },
      SOUND_FIELDS,
    ).findings[0];
    expect(merged?.headlineMode).toBe("applies_together");
    expect(merged?.disposition).toBe("prohibited_or_ineligible");
    expect(merged?.name).toBe("Commercial advertising by sound device");
    expect(merged?.latestApplyDate).toBeNull();
    expect(merged?.deadlineStatus).toBe("not_applicable");
    expect(merged?.feeDisplay).toBeNull();
    const permit = merged?.routes?.find((route) => route.ruleId === "NYPD-SOUND-PUBLIC-001");
    expect(permit?.latestApplyDate).toBe("2026-11-29");
    expect(permit?.deadlineStatus).toBe("on_track");
    expect(permit?.feeDisplay).toContain("$45 per sound device");
  });
});

describe("merging is verdict-neutral over every route-state pair", () => {
  const WINDOWS = {
    none: undefined,
    open: { type: "published_minimum", calendar_days: 45 },
    approaching: { type: "published_minimum", calendar_days: 130 },
    missed: { type: "published_minimum", calendar_days: 400 },
    undatable: { type: "business_days_minimum", business_days: 15 },
    unpublished: { type: "research_required", display: "Lead time not published" },
  } as const;
  const DISPOSITIONS = [
    "REQUIRED",
    "MAY_BE_REQUIRED",
    "PROHIBITED_OR_INELIGIBLE",
    "ADVISORY",
    "NO_NEW_REQUIREMENT_IDENTIFIED",
  ] as const;
  const WINDOW_NAMES = Object.keys(WINDOWS) as (keyof typeof WINDOWS)[];

  const routeRule = (
    id: string,
    disposition: string,
    window: keyof typeof WINDOWS,
    dedupeKey: string | null,
  ): RuleSpec => ({
    id,
    dedupeKey,
    trigger: ALWAYS,
    output: {
      permit_name: `${id} permit`,
      agency: "DOB",
      disposition,
      ...(WINDOWS[window] === undefined ? {} : { deadline: WINDOWS[window] }),
    },
  });

  const verdictOf = (
    left: readonly [string, keyof typeof WINDOWS],
    right: readonly [string, keyof typeof WINDOWS],
    dedupeKey: string | null,
  ): Verdict =>
    plan([
      routeRule("RULE-A", left[0], left[1], dedupeKey),
      routeRule("RULE-B", right[0], right[1], dedupeKey),
    ]).verdict;

  it("moves no plan verdict, in either direction, on any of the pairs", () => {
    const states = DISPOSITIONS.flatMap((disposition) =>
      WINDOW_NAMES.map((window) => [disposition, window] as const),
    );
    const moved: string[] = [];
    for (const left of states) {
      for (const right of states) {
        const merged = verdictOf(left, right, "shared");
        const unmerged = verdictOf(left, right, null);
        if (merged !== unmerged) {
          moved.push(
            `${left.join("/")} + ${right.join("/")}: merged ${merged}, unmerged ${unmerged}`,
          );
        }
      }
    }
    expect(moved).toEqual([]);
    expect(states.length).toBe(DISPOSITIONS.length * WINDOW_NAMES.length);
    expect(states.length ** 2).toBe(900);
  });
});

describe("the blocking route of a merged line (#252)", () => {
  const OPEN = {
    id: "OPEN-001",
    dedupeKey: "shared",
    trigger: ALWAYS,
    output: {
      permit_name: "OPEN-001 permit",
      deadline: { type: "published_minimum", calendar_days: 104 },
      fee: { display: "$40" },
      portal: { name: "open portal", url: "https://example.test/open" },
    },
  } as const;
  const MISSED = {
    id: "MISSED-001",
    dedupeKey: "shared",
    trigger: ALWAYS,
    output: {
      permit_name: "MISSED-001 permit",
      deadline: { type: "published_minimum", calendar_days: 184 },
      fee: { display: "$900" },
      portal: { name: "missed portal", url: "https://example.test/missed" },
    },
  } as const;

  it("serializes every published value the blocking route was narrowed to", () => {
    const inPerson = {
      ...MISSED,
      output: {
        ...MISSED.output,
        agency: "NYPD",
        portal: { name: "NYPD precinct", instructions: "File in person at the precinct" },
      },
    };
    const blocker = plan([OPEN, inPerson]).verdictDetail.blockingFinding;
    expect(blocker?.ruleIds).toEqual(["MISSED-001"]);
    expect(blocker?.agency).toBe("NYPD");
    expect(blocker?.disposition).toBe("required");
    expect(blocker?.deadlineStatus).toBe("published_deadline_missed");
    expect(blocker?.feeDisplay).toBe("$900");
    expect(blocker?.portalUrl).toBeNull();
    expect(blocker?.portalName).toBe("NYPD precinct");
    expect(blocker?.portalInstructions).toBe("File in person at the precinct");
  });

  it("names the missed route and quotes ITS window, fee and portal", () => {
    const evaluated = plan([OPEN, MISSED]);
    expect(evaluated.findings[0]?.name).toBe("OPEN-001 permit");
    expect(evaluated.findings[0]?.latestApplyDate).toBe("2026-08-22");

    expect(evaluated.verdict).toBe("INFEASIBLE");
    const blocker = evaluated.verdictDetail.blockingFinding;
    expect(blocker?.ruleIds).toEqual(["MISSED-001"]);
    expect(blocker?.name).toBe("MISSED-001 permit");
    expect(blocker?.latestApplyDate).toBe("2026-06-03");
    expect(blocker?.deadlineDisplay).toBeNull();
    expect(blocker?.portalName).toBe("missed portal");
    expect(blocker?.portalUrl).toBe("https://example.test/missed");
    expect(blocker?.sources?.map((source) => source.ruleId)).toEqual(["MISSED-001"]);
  });

  it("blocks on a closed route while another route's window is open, and matches unmerged", () => {
    const merged = plan([OPEN, MISSED]);
    const unmerged = plan([
      { ...OPEN, dedupeKey: null },
      { ...MISSED, dedupeKey: null },
    ]);
    expect(merged.verdict).toBe("INFEASIBLE");
    expect(unmerged.verdict).toBe("INFEASIBLE");
    expect(merged.findings[0]?.routes?.some((route) => route.deadlineStatus === "on_track")).toBe(
      true,
    );
  });

  it("drops the merged summary even where the blocking route is the headline route", () => {
    const summary = (heading: string, id: string) => ({
      heading,
      points: [
        {
          kind: "overview",
          text: `${id} point`,
          sources: [{ label: "citation", url: `https://example.test/${id}` }],
        },
      ],
    });

    const blocking = {
      id: "BLOCKING-001",
      dedupeKey: "shared",
      trigger: ALWAYS,
      output: {
        permit_name: "BLOCKING-001 permit",
        deadline: { type: "published_minimum", calendar_days: 200 },
      },
    } as const;
    const sibling = {
      id: "SIBLING-001",
      dedupeKey: "shared",
      trigger: ALWAYS,
      output: {
        permit_name: "SIBLING-001 permit",
        deadline: { type: "published_minimum", calendar_days: 184 },
        user_summary: summary("SIBLING-001 heading", "SIBLING-001"),
      },
    } as const;

    const evaluated = plan([blocking, sibling]);

    expect(evaluated.findings[0]?.routes?.[0]?.ruleId).toBe("BLOCKING-001");
    expect(evaluated.findings[0]?.userSummary?.heading).toBe("SIBLING-001 heading");

    expect(evaluated.verdict).toBe("INFEASIBLE");
    const blocker = evaluated.verdictDetail.blockingFinding;
    expect(blocker?.ruleIds).toEqual(["BLOCKING-001"]);
    expect(blocker?.userSummary).toBeNull();
  });

  it("keeps an unmerged blocker's own summary", () => {
    const alone = {
      id: "ALONE-001",
      dedupeKey: null,
      trigger: ALWAYS,
      output: {
        permit_name: "ALONE-001 permit",
        deadline: { type: "published_minimum", calendar_days: 184 },
        user_summary: {
          heading: "ALONE-001 heading",
          points: [
            {
              kind: "overview",
              text: "ALONE-001 point",
              sources: [{ label: "citation", url: "https://example.test/ALONE-001" }],
            },
          ],
        },
      },
    } as const;

    const evaluated = plan([alone]);
    expect(evaluated.verdict).toBe("INFEASIBLE");
    expect(evaluated.verdictDetail.blockingFinding?.userSummary?.heading).toBe("ALONE-001 heading");
  });
});

describe("dependency sequencing over a merged gated line (#252)", () => {
  const PARKS = {
    id: "PARKS-EVENT-001",
    dedupeKey: null,
    trigger: ALWAYS,
    output: {
      permit_name: "Parks permit",
      deadline: {
        type: "composite",
        calendar_days: 30,
        hard_floor_days: 7,
        processing_range_days: [21, 30],
      },
    },
  } as const;
  const DEPENDENCY = {
    id: "NYPD-SOUND-PARKS-DEP-001",
    kind: "dependency",
    dedupeKey: null,
    trigger: ALWAYS,
    output: { note_text: "sound permit follows the parks approval" },
  } as const;

  const SOUND = {
    id: "NYPD-SOUND-001",
    dedupeKey: "sound",
    trigger: ALWAYS,
    output: {
      permit_name: "Sound Device Permit",
      deadline: { type: "published_minimum", calendar_days: 5 },
    },
  } as const;
  const SOUND_ALT = {
    id: "NYPD-SOUND-ALT-001",
    dedupeKey: "sound",
    trigger: ALWAYS,
    output: {
      permit_name: "Sound Device Permit, alternate basis",
      deadline: { type: "published_minimum", calendar_days: 60 },
    },
  } as const;

  it("sequences the gated ROUTE off its own window, and leaves the headline to its own route", () => {
    const evaluated = plan([PARKS, DEPENDENCY, SOUND, SOUND_ALT]);
    const sound = evaluated.findings.find((finding) => finding.ruleIds.includes("NYPD-SOUND-001"));
    const gatedRoute = sound?.routes?.find((route) => route.ruleId === "NYPD-SOUND-001");
    const otherRoute = sound?.routes?.find((route) => route.ruleId === "NYPD-SOUND-ALT-001");

    expect(sound?.latestApplyDate).toBe("2026-10-05");
    expect(sound?.routes?.[0]?.ruleId).toBe("NYPD-SOUND-ALT-001");
    expect(gatedRoute?.latestApplyDate).toBe("2026-11-29");

    expect(sound?.applyAfterDate).toBeNull();
    expect(sound?.slackDays).toBe(75);

    expect(gatedRoute?.applyAfterDate).toBe("2026-08-12");
    expect(gatedRoute?.slackDays).toBe(109);

    expect(otherRoute?.applyAfterDate).toBeNull();

    expect(sound?.notes.some((note) => note.includes("sequenced after PARKS-EVENT-001"))).toBe(
      true,
    );

    const gatedNote = gatedRoute?.notes?.find((note) =>
      note.includes("sequenced after PARKS-EVENT-001"),
    );
    expect(gatedNote).toContain("Strict issued-before-filed sequencing is not confirmed");

    expect(sound?.notes.find((note) => note.includes("sequenced after PARKS-EVENT-001"))).toBe(
      gatedNote,
    );

    expect(otherRoute?.notes?.some((note) => note.includes("sequenced after"))).toBe(false);
  });

  it("states the gated route's own window in the note, not the binding route's", () => {
    const evaluated = plan([PARKS, DEPENDENCY, SOUND, SOUND_ALT]);
    const sound = evaluated.findings.find((finding) => finding.ruleIds.includes("NYPD-SOUND-001"));
    const note = sound?.notes.find((entry) => entry.includes("sequenced after PARKS-EVENT-001"));

    expect(note).toContain("leaving 109 days to file");
    expect(note).not.toContain("leaving 54 days");
  });

  const SOUND_PAST = {
    id: "NYPD-SOUND-001",
    dedupeKey: "sound",
    trigger: ALWAYS,
    output: {
      permit_name: "Sound Device Permit",
      deadline: { type: "published_minimum", calendar_days: 156 },
    },
  } as const;

  it("reports the closed sequence off the gated route, and its missed direct filing", () => {
    const evaluated = plan([PARKS, DEPENDENCY, SOUND_PAST, SOUND_ALT]);
    const sound = evaluated.findings.find((finding) => finding.ruleIds.includes("NYPD-SOUND-001"));
    const note = sound?.notes.find((entry) => entry.includes("sequenced after PARKS-EVENT-001"));

    expect(sound?.routes?.[0]?.ruleId).toBe("NYPD-SOUND-ALT-001");
    expect(sound?.latestApplyDate).toBe("2026-10-05");
    expect(sound?.deadlineStatus).toBe("on_track");

    expect(note).toContain("leaves no window to file in");
    expect(note).toContain("this permit's own 2026-07-01 deadline");
    expect(note).not.toContain("filing directly may still be open");
  });
});

describe("an unknown that moves only a non-binding route's window (#252)", () => {
  const PLAZA_FIELD = [
    { field: "plaza_level", type: "enum", values: ["unknown", "a", "b"] },
    { field: "plaza_multiple_blocks", type: "boolean" },
  ];

  const BINDING = {
    id: "SAPO-EVENT-001",
    dedupeKey: "plaza",
    trigger: ALWAYS,
    output: {
      permit_name: "Plaza event permit",
      deadline: { type: "published_minimum", calendar_days: 60 },
    },
  } as const;

  const BY_LEVEL = {
    id: "SAPO-PLAZA-001",
    dedupeKey: "plaza",
    trigger: ALWAYS,
    output: {
      permit_name: "Plaza permit by level",
      deadline: {
        type: "published_minimum_by_level",
        level_field: "plaza_level",
        multi_block_field: "plaza_multiple_blocks",
        levels: { a: { calendar_days: 30 }, b: { calendar_days: 20 } },
      },
    },
  } as const;

  const evaluated = (level: string) =>
    plan([BINDING, BY_LEVEL], { plaza_level: level, plaza_multiple_blocks: false }, PLAZA_FIELD);

  it("reads CONDITIONAL, because the branches do not observe the same timelines", () => {
    const withA = evaluated("a").findings[0];
    const withB = evaluated("b").findings[0];
    expect(withA?.ruleIds).toEqual(withB?.ruleIds);
    expect(withA?.latestApplyDate).toBe("2026-10-05");
    expect(withB?.latestApplyDate).toBe("2026-10-05");
    expect(withA?.deadlineStatus).toBe(withB?.deadlineStatus);
    expect(withA?.routes?.[1]?.latestApplyDate).toBe("2026-11-04");
    expect(withB?.routes?.[1]?.latestApplyDate).toBe("2026-11-14");
    expect(evaluated("a").verdict).toBe("FEASIBLE");
    expect(evaluated("b").verdict).toBe("FEASIBLE");

    const unresolved = evaluated("unknown");
    expect(unresolved.verdict).toBe("CONDITIONAL");
    expect(unresolved.verdictDetail.missingFacts.map((fact) => fact.field)).toContain(
      "plaza_level",
    );
  });
});

describe("the reason for a branch that misses only a non-binding route (#252)", () => {
  const FIELDS = [
    { field: "plaza_level", type: "enum", values: ["unknown", "a", "b"] },
    { field: "plaza_multiple_blocks", type: "boolean" },
    { field: "plaza_gated", type: "boolean" },
  ];

  const BINDING = {
    id: "SAPO-EVENT-001",
    dedupeKey: "plaza",
    trigger: ALWAYS,
    output: {
      permit_name: "Plaza event permit",
      deadline: { type: "published_minimum", calendar_days: 60 },
    },
  } as const;

  const BY_LEVEL = {
    id: "SAPO-PLAZA-001",
    dedupeKey: "plaza",
    trigger: { all: [{ field: "plaza_gated", op: "eq", value: true }] },
    output: {
      permit_name: "Plaza permit by level",
      deadline: {
        type: "published_minimum_by_level",
        level_field: "plaza_level",
        multi_block_field: "plaza_multiple_blocks",
        levels: { a: { calendar_days: 30 }, b: { calendar_days: 200 } },
      },
    },
  } as const;

  const evaluated = (level: string) =>
    plan([BINDING, BY_LEVEL], { plaza_level: level, plaza_multiple_blocks: false }, FIELDS);

  it("states the filing-window miss the merged scalar cannot see", () => {
    const missing = evaluated("b").findings[0];
    expect(missing?.deadlineStatus).not.toBe("published_deadline_missed");
    expect(missing?.routes?.[1]?.deadlineStatus).toBe("published_deadline_missed");

    const level = evaluated("unknown").verdictDetail.missingFacts.find(
      (fact) => fact.field === "plaza_level",
    );
    const branchB = level?.branches.find((branch) => branch.value === "b");
    expect(branchB?.reason).toContain("published deadline missed as scoped");

    const branchA = level?.branches.find((branch) => branch.value === "a");
    expect(branchA?.reason).not.toContain("published deadline missed as scoped");
  });
});

describe("naming the at-risk route of a rescoped merged line (#252)", () => {
  const VENUE_FIELD = [
    { field: "venue_type", type: "enum", values: ["unknown", "park", "private"] },
  ];

  const BLOCKER = {
    id: "PARKS-MISSED-001",
    dedupeKey: null,
    trigger: { all: [{ field: "venue_type", op: "eq", value: "park" }] },
    output: {
      permit_name: "Parks special event permit",
      deadline: { type: "published_minimum", calendar_days: 200 },
    },
  } as const;

  const BINDING = {
    id: "PLAZA-BIND-001",
    dedupeKey: "plaza",
    trigger: ALWAYS,
    output: {
      permit_name: "Plaza event permit",
      deadline: { type: "published_minimum", calendar_days: 60 },
    },
  } as const;

  const AT_RISK = {
    id: "PLAZA-SOFT-001",
    dedupeKey: "plaza",
    trigger: ALWAYS,
    output: {
      permit_name: "Plaza block closure approval",
      disposition: "MAY_BE_REQUIRED",
      deadline: { type: "published_minimum", calendar_days: 130 },
    },
  } as const;

  it("labels the suggestion with the route that holds the minimum slack", () => {
    const scoped = plan([BLOCKER, BINDING, AT_RISK], { venue_type: "park" }, VENUE_FIELD);
    expect(scoped.verdict).toBe("INFEASIBLE");

    const rescope = scoped.verdictDetail.rescopeSuggestions.find(
      (suggestion) => suggestion.change.field === "venue_type",
    );
    expect(rescope?.reevaluatedVerdict).toBe("FEASIBLE_AT_RISK");

    const merged = plan([BINDING, AT_RISK]).findings[0];
    expect(merged?.name).toBe("Plaza event permit");
    expect(merged?.slackDays).not.toBe(rescope?.minSlackDays);
    expect(rescope?.atRiskFindingName).toBe("Plaza block closure approval");
  });
});

describe("a merged line no route can supply the scalars for (#252)", () => {
  const FIELD = [{ field: "sidewalk_use", type: "enum", values: ["unknown", "cafe", "display"] }];

  const RESOLVED_ADVISORY = {
    id: "DOT-SIDEWALK-ADVISORY-001",
    kind: "advisory",
    dedupeKey: "sidewalk",
    trigger: ALWAYS,
    output: {
      permit_name: "Sidewalk clearance advisory",
      agency: "DOT",
      deadline: { type: "published_minimum", calendar_days: 60 },
      fee: { display: "No fee" },
      portal: { name: "DOT sidewalk desk", url: "https://example.test/dot" },
    },
  } as const;

  const UNRESOLVED_CANDIDATE = {
    id: "DOT-SIDEWALK-CAFE-001",
    kind: "eligibility",
    dedupeKey: "sidewalk",
    trigger: { all: [{ field: "sidewalk_use", op: "eq", value: "cafe" }] },
    output: {
      permit_name: "Sidewalk cafe licence",
      agency: "DCWP",
      deadline: { type: "published_minimum", calendar_days: 10 },
      fee: { display: "$1,050 licence fee" },
      portal: { name: "DCWP licence centre", url: "https://example.test/dcwp" },
    },
  } as const;

  const merged = () =>
    plan([RESOLVED_ADVISORY, UNRESOLVED_CANDIDATE], { sidewalk_use: null }, FIELD).findings[0];

  it("publishes no name, timeline, fee or portal of its own", () => {
    const line = merged();

    expect(line?.disposition).toBe("may_be_required");
    expect(line?.headlineMode).toBe("candidate");

    expect(line?.name).toBeNull();
    expect(line?.agency).toBeNull();
    expect(line?.deadline).toBeNull();
    expect(line?.deadlineDisplay).toBeNull();
    expect(line?.latestApplyDate).toBeNull();
    expect(line?.applyAfterDate).toBeNull();
    expect(line?.slackDays).toBeNull();
    expect(line?.feeDisplay).toBeNull();
    expect(line?.portalName).toBeNull();
    expect(line?.portalUrl).toBeNull();
    expect(line?.portalInstructions).toBeNull();

    expect(line?.deadlineStatus).toBe("not_calculable");
  });

  it("keeps every route's own name, window, fee and portal beneath", () => {
    const routes = merged()?.routes ?? [];
    expect(routes).toHaveLength(2);
    const advisory = routes.find((route) => route.ruleId === "DOT-SIDEWALK-ADVISORY-001");
    const candidate = routes.find((route) => route.ruleId === "DOT-SIDEWALK-CAFE-001");
    expect(advisory?.name).toBe("Sidewalk clearance advisory");
    expect(advisory?.feeDisplay).toBe("No fee");
    expect(advisory?.portalUrl).toBe("https://example.test/dot");
    expect(advisory?.latestApplyDate).not.toBeNull();
    expect(candidate?.name).toBe("Sidewalk cafe licence");
    expect(candidate?.feeDisplay).toBe("$1,050 licence fee");
    expect(candidate?.portalUrl).toBe("https://example.test/dcwp");
    expect(candidate?.latestApplyDate).not.toBeNull();

    expect(merged()?.ruleIds).toHaveLength(2);
    expect(merged()?.sources.map((source) => source.ruleId)).toEqual([
      "DOT-SIDEWALK-ADVISORY-001",
      "DOT-SIDEWALK-CAFE-001",
    ]);
  });

  it("still binds the scalars where a resolved route does contribute the disposition", () => {
    const settled = plan([RESOLVED_ADVISORY, UNRESOLVED_CANDIDATE], { sidewalk_use: "cafe" }, FIELD)
      .findings[0];
    expect(settled?.headlineMode).toBe("applies_together");
    expect(settled?.name).toBe("Sidewalk cafe licence");
    expect(settled?.feeDisplay).toBe("$1,050 licence fee");
    expect(settled?.deadlineStatus).not.toBe("not_calculable");
  });
});

describe("every merged line the engine emits reads as its binding route, or as nobody (#252)", () => {
  const HEADLINE_SCALARS = [
    "name",
    "agency",
    "deadlineDisplay",
    "latestApplyDate",
    "applyAfterDate",
    "deadlineStatus",
    "feeDisplay",
    "portalName",
    "portalUrl",
    "portalInstructions",
  ] as const;

  const assertInvariant = (evaluated: ReturnType<typeof plan>) => {
    const merged = evaluated.findings.filter((finding) => (finding.routes?.length ?? 0) > 1);
    expect(merged.length).toBeGreaterThan(0);
    for (const finding of merged) {
      const routes = finding.routes as NonNullable<typeof finding.routes>;
      if (noRouteSuppliesScalars(routes)) {
        expect(finding.deadlineStatus).toBe("not_calculable");
        expect(finding.deadline).toBeNull();
        for (const field of HEADLINE_SCALARS) {
          if (field === "deadlineStatus") continue;
          expect({ ruleIds: finding.ruleIds, field, value: finding[field] }).toEqual({
            ruleIds: finding.ruleIds,
            field,
            value: null,
          });
        }
        continue;
      }
      const binding = routes[0] as (typeof routes)[number];
      expect(finding.deadline?.type ?? null).toBe(binding.deadline?.type ?? null);
      for (const field of HEADLINE_SCALARS) {
        expect({ ruleIds: finding.ruleIds, field, value: finding[field] }).toEqual({
          ruleIds: finding.ruleIds,
          field,
          value: binding[field],
        });
      }
    }
  };

  it("holds on a group whose binding route supplies the scalars", () => {
    assertInvariant(
      plan([
        {
          id: "OPEN-001",
          dedupeKey: "shared",
          trigger: ALWAYS,
          output: {
            permit_name: "OPEN-001 permit",
            deadline: { type: "published_minimum", calendar_days: 104 },
            fee: { display: "$40" },
            portal: { name: "open portal", url: "https://example.test/open" },
          },
        },
        {
          id: "MISSED-001",
          dedupeKey: "shared",
          trigger: ALWAYS,
          output: {
            permit_name: "MISSED-001 permit",
            deadline: { type: "published_minimum", calendar_days: 184 },
            fee: { display: "$900" },
          },
        },
      ]),
    );
  });

  it("holds on a group no route can supply the scalars for", () => {
    const FIELD = [{ field: "sidewalk_use", type: "enum", values: ["unknown", "cafe"] }];
    assertInvariant(
      plan(
        [
          {
            id: "DOT-SIDEWALK-ADVISORY-001",
            kind: "advisory",
            dedupeKey: "sidewalk",
            trigger: ALWAYS,
            output: {
              permit_name: "Sidewalk clearance advisory",
              deadline: { type: "published_minimum", calendar_days: 60 },
            },
          },
          {
            id: "DOT-SIDEWALK-CAFE-001",
            kind: "eligibility",
            dedupeKey: "sidewalk",
            trigger: { all: [{ field: "sidewalk_use", op: "eq", value: "cafe" }] },
            output: {
              permit_name: "Sidewalk cafe licence",
              deadline: { type: "published_minimum", calendar_days: 10 },
            },
          },
        ],
        { sidewalk_use: null },
        FIELD,
      ),
    );
  });

  it("holds after dependency sequencing writes a gate onto a scalar-free group", () => {
    const FIELD = [{ field: "sound_purpose", type: "enum", values: ["unknown", "amplified"] }];
    assertInvariant(
      plan(
        [
          {
            id: "PARKS-EVENT-001",
            dedupeKey: null,
            trigger: ALWAYS,
            output: {
              permit_name: "Parks event permit",
              deadline: {
                type: "composite",
                hard_floor_days: 21,
                processing_range_days: [21, 30],
              },
            },
          },

          {
            id: "NYPD-SOUND-PARKS-DEP-001",
            kind: "dependency",
            dedupeKey: null,
            trigger: ALWAYS,
            output: { note_text: "sound permit follows the parks approval" },
          },
          {
            id: "NYPD-SOUND-001",
            kind: "eligibility",
            dedupeKey: "sound",
            trigger: { all: [{ field: "sound_purpose", op: "eq", value: "amplified" }] },
            output: {
              permit_name: "Sound Device Permit",
              deadline: { type: "published_minimum", calendar_days: 5 },
            },
          },
          {
            id: "NYPD-SOUND-ADVISORY-001",
            kind: "advisory",
            dedupeKey: "sound",
            trigger: ALWAYS,
            output: {
              permit_name: "Sound advisory",
              deadline: { type: "published_minimum", calendar_days: 90 },
            },
          },
        ],
        { sound_purpose: null },
        FIELD,
      ),
    );
  });
});

describe("the branch reason names the route that missed, not its line (#252)", () => {
  const FIELDS = [
    { field: "plaza_level", type: "enum", values: ["unknown", "a", "b"] },
    { field: "plaza_multiple_blocks", type: "boolean" },
  ];

  const OPEN = {
    id: "SAPO-EVENT-001",
    dedupeKey: "plaza",
    trigger: ALWAYS,
    output: {
      permit_name: "Plaza event permit",
      deadline: { type: "published_minimum", calendar_days: 60 },
    },
  } as const;

  const BY_LEVEL = {
    id: "SAPO-PLAZA-001",
    dedupeKey: "plaza",
    trigger: ALWAYS,
    output: {
      permit_name: "Plaza permit by level",
      deadline: {
        type: "published_minimum_by_level",
        level_field: "plaza_level",
        multi_block_field: "plaza_multiple_blocks",
        levels: { a: { calendar_days: 30 }, b: { calendar_days: 200 } },
      },
    },
  } as const;

  it("states the missed route alone in the branch reason", () => {
    const level = plan(
      [OPEN, BY_LEVEL],
      { plaza_level: "unknown", plaza_multiple_blocks: false },
      FIELDS,
    ).verdictDetail.missingFacts.find((fact) => fact.field === "plaza_level");
    const branchB = level?.branches.find((branch) => branch.value === "b");

    expect(branchB?.reason).toContain("SAPO-PLAZA-001 (published deadline missed as scoped)");

    expect(branchB?.reason).not.toContain("SAPO-EVENT-001 (published deadline missed");
    expect(branchB?.reason).not.toContain("SAPO-EVENT-001, SAPO-PLAZA-001 (published");
  });
});
