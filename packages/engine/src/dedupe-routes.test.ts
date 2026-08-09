// The dedupe route list, tested from the co-firing sets that were MEASURED rather than invented.
//
// Every fixture below is one of the concrete intakes in `docs/research/draft-dedupe-cofiring.md`
// (branch `measure/draft-dedupe-cofiring`, PR #251), rebuilt as a synthetic ruleset because the
// v2 full draft does not load through `parseEngineRuleset` (measurement §3.1) and no branch may
// edit a rules artifact to make its tests pass. What is reproduced is each set's SHAPE, meaning
// how many members reach the merge, which of their triggers resolved, and what each publishes;
// the rule ids and the published values are the draft's own, quoted from the measurement.
//
// Plus the exhaustive route-state sweep the "36 more optimistic merged verdicts" figure came from,
// which is the regression guard: merging two rules under a shared dedupe key must never move the
// plan verdict in either direction.

import { describe, expect, it } from "vitest";
import { evaluate, parseEngineRuleset } from "./index";
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
      // Every trigger is conjoined with a condition that is always true on this intake, so the
      // loader's "declared but unread" guard sees `headcount` consumed without any rule's own
      // conditions changing. `headcount` is 50 on every intake below.
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

/** Fires whatever the intake says, so a set's membership is decided by the fields it names. */
const ALWAYS = { all: [{ field: "headcount", op: "gte", value: 10 }] };

describe("the measured co-firing sets", () => {
  /**
   * Measurement §5.1. Fourteen members on one line, and only ever when `sapo_event_type` is
   * unanswered: the true-only maximum is 1 across all 6,480 sweep intakes. The widest set, 14 of
   * 14, occurs 10 times, at `sapo_event_type=unknown`.
   *
   * The measurement's own summary of the disagreement is what makes this the hardest case: across
   * the 14 members the published windows are 14, 30, 45, 10, 60, 30, 45, 14 and 60 calendar days,
   * the names are six different instruments, and the fees run from "$25 processing fee" to
   * "Up to $66,000 per location per day". Agency and portal are the only fields all 14 share.
   */
  const SAPO_WINDOWS = [14, 30, 45, 10, 60, 30, 45, 14, 60, 21, 35, 7, 90, 5];
  const sapoPermit = (index: number): RuleSpec => ({
    id: `SAPO-PERMIT-${String(index).padStart(3, "0")}`,
    dedupeKey: "sapo_permit",
    // Every member keys on the same classifying question, on a different answer, so they are
    // disjoint on a settled answer and all fourteen are `unknown` when it is not.
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
    // Not one of the fourteen is known to apply, so the line is a candidate list, not a filing.
    expect(merged?.headlineMode).toBe("candidate");
    expect(merged?.routes?.every((route) => route.triggerResult === "unknown")).toBe(true);
    // Fourteen distinct published windows, fourteen names, and both fee displays: this is the
    // information the merge used to destroy, and the count is what proves it is retained.
    expect(new Set(merged?.routes?.map((route) => route.latestApplyDate)).size).toBe(
      new Set(SAPO_WINDOWS).size,
    );
    expect(new Set(merged?.routes?.map((route) => route.name)).size).toBe(14);
    expect(new Set(merged?.routes?.map((route) => route.feeDisplay)).size).toBe(2);
    // Every route names the question that decides it, which is what the headline copy reads.
    expect(new Set(merged?.routes?.flatMap((route) => route.unknownFields))).toEqual(
      new Set(["sapo_event_type"]),
    );
  });

  it("renders a settled sapo_event_type as one route and no candidate list", () => {
    // The true-only maximum of 1: on a settled answer the fourteen are disjoint, so nothing merges.
    const settled = plan(SAPO_GROUP, { sapo_event_type: "type_3" }, SAPO_FIELD).findings;
    expect(settled).toHaveLength(1);
    expect(settled[0]?.routes).toBeUndefined();
    expect(settled[0]?.name).toBe("SAPO instrument 3");
  });

  /**
   * Measurement §5.2. Five members, reaching 2 on answered facts, publishing BYTE-IDENTICAL
   * outputs: same permit name, same agency, same `research_required` deadline with the same display
   * text, no fee, no portal. The intake is the measurement's own: a stage both large enough and
   * long-lived enough, which fires `DOB-STAGE-001` and `DOB-STRUCTURE-DURATION-001` on 360 events.
   *
   * There is nothing to reconcile here, and that is exactly what has to render as it did before.
   */
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
    // The two routes publish the same thing, so the line reads exactly as an unmerged one does.
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
    // Two routes, and every published value on them equal. `plan-line.tsx` renders nothing extra
    // for exactly this state; the check there is the same comparison.
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

  /**
   * Measurement §5.4. Four members, never 2 on answered facts, and the substantive disagreement is
   * the sharpest in the draft: `SAPO-INSURANCE-GENERAL-001` publishes a $1,000,000 certificate
   * requirement with a `before issuance` dependency deadline, and `SAPO-INSURANCE-BLOCK-EXEMPT-001`
   * is a note whose entire content is that the general $1 million requirement does not apply. They
   * co-fire on the measurement's own intake, `sapo_event_type=unknown, block_party_has_ride=no`.
   *
   * One line cannot be both, and before the route list it silently was one of them.
   */
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

  it("keeps both readings when one route requires a $1,000,000 certificate and another says it does not apply", () => {
    const merged = plan(
      SAPO_INSURANCE,
      { sapo_event_type: "unknown", block_party_has_ride: "no" },
      INSURANCE_FIELDS,
    ).findings[0];
    expect(merged?.headlineMode).toBe("candidate");
    expect(merged?.routes).toHaveLength(2);
    const general = merged?.routes?.find((route) => route.ruleId === "SAPO-INSURANCE-GENERAL-001");
    const exempt = merged?.routes?.find(
      (route) => route.ruleId === "SAPO-INSURANCE-BLOCK-EXEMPT-001",
    );
    // Neither reading is asserted over the other, and both are on the finding rather than one of
    // them surviving as the line and the other as a note nobody attributes.
    expect(general?.disposition).toBe("may_be_required");
    expect(exempt?.disposition).toBe("no_new_requirement");
    expect(general?.triggerResult).toBe("unknown");
    expect(exempt?.triggerResult).toBe("unknown");
    // Both routes' published text survives, and the reader can tell whose is whose by rule id.
    expect(merged?.sources.map((source) => source.ruleId)).toEqual([
      "SAPO-INSURANCE-GENERAL-001",
      "SAPO-INSURANCE-BLOCK-EXEMPT-001",
    ]);
    expect(merged?.noteText).toContain("$1,000,000");
  });

  /**
   * Measurement §5.5 and §6. The one group of the nine that BOTH co-fires on answered facts AND
   * disagrees, and the shape the two headline modes were not written for: the Sound Device Permit
   * fires `true` with a 5-calendar-day window, a "$45 per sound device for the first day, plus $5
   * per device for each additional day" fee and the precinct portal, while the section 10-108
   * prohibition is `unknown` because `sound_purpose` is unanswered (54 of 360 intakes).
   *
   * The decision this pins: the mode is a PER-ROUTE property and the headline is derived from the
   * resolved subset, rather than a group-level flag with a third value
   * (`docs/proposals/dedupe-route-list.md` §4.2).
   */
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
    // One route resolved, one did not, so this is a candidate list, and the headline is the route
    // that is KNOWN to apply rather than the one that might.
    expect(merged?.headlineMode).toBe("candidate");
    expect(merged?.name).toBe("Sound Device Permit");
    expect(merged?.latestApplyDate).toBe("2026-11-29");
    expect(merged?.feeDisplay).toContain("$45 per sound device");
    // The prohibition is a route with its own values and its own deciding question, not a note
    // whose disposition was folded into the line.
    const prohibition = merged?.routes?.find((route) =>
      route.ruleId.includes("COMMERCIAL-ADVERTISING"),
    );
    expect(prohibition?.triggerResult).toBe("unknown");
    expect(prohibition?.disposition).toBe("prohibited_or_ineligible");
    expect(prohibition?.unknownFields).toEqual(["sound_purpose"]);
    expect(prohibition?.latestApplyDate).toBeNull();
  });

  it("reads the nypd_sound headline as the prohibition when both routes resolve", () => {
    // Measurement §5.5's both-true set, 15 of 360 intakes. Every trigger resolved, so the routes
    // genuinely apply together and the strongest disposition is the headline's.
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
    // THE DEFECT THIS BRANCH REMOVES: the line no longer names the prohibition while quoting the
    // permit's apply-by date, its fee and its "on track" status. Those are the permit route's, on
    // the permit route.
    expect(merged?.latestApplyDate).toBeNull();
    expect(merged?.deadlineStatus).toBe("not_applicable");
    expect(merged?.feeDisplay).toBeNull();
    const permit = merged?.routes?.find((route) => route.ruleId === "NYPD-SOUND-PUBLIC-001");
    expect(permit?.latestApplyDate).toBe("2026-11-29");
    expect(permit?.deadlineStatus).toBe("on_track");
    expect(permit?.feeDisplay).toContain("$45 per sound device");
  });
});

/**
 * THE SWEEP. Every ordered pair of route states, evaluated twice: once with the two rules sharing a
 * dedupe key and once with no key at all. The plan verdict must be the same both ways.
 *
 * This is the guard for the adversarial review's finding that 36 merged verdicts read strictly more
 * optimistic than the same rules unmerged. Optimism is the failure that matters, but the assertion
 * is EQUALITY rather than "not better": the split also read PESSIMISTIC on pairs where a closed
 * window in one tier was crossed with a stronger disposition in another, and a merge that invents a
 * blocker is as wrong as one that hides a filing. A shared `dedupe_key` is a statement about
 * rendering, not about feasibility, so it must move no verdict at all.
 */
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
    // Reported rather than counted, so a failure names the pair instead of a number.
    expect(moved).toEqual([]);
    // The sweep is exhaustive over the state space and the size is asserted so a shrinking
    // enumeration cannot quietly turn this into a weaker check.
    expect(states.length).toBe(DISPOSITIONS.length * WINDOW_NAMES.length);
    expect(states.length ** 2).toBe(900);
  });
});

/**
 * #252. The INFEASIBLE panel names a route, and the engine is what narrows it. Before this, the
 * blocking finding carried only a rule id and a name, so a consumer had to find the finding again
 * by rule id and got back the whole merged line: it rendered the HEADLINE route's name, portal and
 * apply-by date under a heading about the missed one, and where the headline route's window was
 * still open the date it printed was in the FUTURE of the plan's own clock.
 */
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

  /**
   * #252 review: `blockerView` narrows the fee, the agency, the disposition, the status and the
   * portal instructions, and the `VerdictDetail` serialization carried six fields of the ten the
   * F-102 amendment names. A route filing through instructions rather than a url — the `nypd_sound`
   * precinct route publishes a null portal url and files in person — then reached the panel with
   * nothing on it that says where to file, and the widening itself is what stops the panel falling
   * back to the whole finding for them.
   */
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
    // The only statement of where to file this route: it publishes no url for the panel to link.
    expect(blocker?.portalUrl).toBeNull();
    expect(blocker?.portalName).toBe("NYPD precinct");
    expect(blocker?.portalInstructions).toBe("File in person at the precinct");
  });

  it("names the missed route and quotes ITS window, fee and portal", () => {
    const evaluated = plan([OPEN, MISSED]);
    // The line reads as the open route: it is the tightest AVAILABLE window, and the closed one
    // ranks below it.
    expect(evaluated.findings[0]?.name).toBe("OPEN-001 permit");
    expect(evaluated.findings[0]?.latestApplyDate).toBe("2026-08-22");

    expect(evaluated.verdict).toBe("INFEASIBLE");
    const blocker = evaluated.verdictDetail.blockingFinding;
    expect(blocker?.ruleIds).toEqual(["MISSED-001"]);
    expect(blocker?.name).toBe("MISSED-001 permit");
    // Every one of these was the OPEN route's before, including a date three weeks in the future
    // of the plan's own clock under a heading saying the deadline had been missed.
    expect(blocker?.latestApplyDate).toBe("2026-06-03");
    expect(blocker?.deadlineDisplay).toBeNull();
    expect(blocker?.portalName).toBe("missed portal");
    expect(blocker?.portalUrl).toBe("https://example.test/missed");
    // THE CITATIONS ARE THE BLOCKING ROUTE'S TOO, which this used to assert the opposite of. The
    // whole group's sources rode through on the spread, in the order the rules sit in the published
    // FILE, while the heading beside them is in BINDING order. `verdict-detail.tsx` takes the first
    // source with a URL for its "More information" link, so on a group whose two orders differ the
    // panel pointed the organizer at a rule its own heading does not name (#252 review).
    expect(blocker?.sources?.map((source) => source.ruleId)).toEqual(["MISSED-001"]);
  });

  /**
   * THE MERGE IS DISJUNCTIVE AND THE WINDOW CHECK IS CONJUNCTIVE, and this pins that they are.
   *
   * `mergeGroup` reads a group as alternative routes to one requirement, so any route applying
   * means the requirement applies and the merged disposition is the strongest on offer.
   * `computeWindowVerdict` blocks if ANY route's published window has closed, so this plan is
   * INFEASIBLE while OPEN-001's own window is open. That difference is deliberate and recorded in
   * `verdict.ts`: nothing published says filing under one route cures another's missed date, and a
   * disjunctive check would make the verdict depend on whether two rules share a `dedupe_key`,
   * which is the whole defect the route-reading window check exists to remove.
   */
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

  /**
   * #252 review: THE ORGANIZER SUMMARY IS NOT THE HEADLINE ROUTE'S EITHER.
   *
   * The narrowing kept `userSummary` whenever the blocking route was also the headline route, on
   * the reading that the merged summary is then that rule's own. It is not: `mergeUserSummary`
   * takes its heading from the first route in binding order that publishes one, so a binding route
   * publishing none inherits a sibling's, and the points concatenate over every contributing route
   * unconditionally. The infeasible panel leads with that heading and links from its first source,
   * so the narrowed name and citations sat under another route's summary.
   *
   * Built so the BLOCKING route is the headline route — the same route on both sides, which is
   * exactly the case the old condition let through.
   */
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
    // The tightest window and the missed one, so this route is both the binding route and the
    // blocker. It publishes no summary of its own, so the merged heading is the SIBLING's.
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
    // The merged line really does carry the sibling's heading, so the case is the one described.
    expect(evaluated.findings[0]?.routes?.[0]?.ruleId).toBe("BLOCKING-001");
    expect(evaluated.findings[0]?.userSummary?.heading).toBe("SIBLING-001 heading");

    expect(evaluated.verdict).toBe("INFEASIBLE");
    const blocker = evaluated.verdictDetail.blockingFinding;
    expect(blocker?.ruleIds).toEqual(["BLOCKING-001"]);
    expect(blocker?.userSummary).toBeNull();
  });

  /**
   * The other half, so the fix cannot be written as "a blocker never carries a summary". An
   * unmerged finding never went through `mergeUserSummary`, so its summary IS the rule's own.
   */
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

/**
 * #252, the case the reviewer could not execute. `applyDependencySequencing` computes the
 * FINDING-level `slackDays` off the merged line's own `latestApplyDate` while `sequenceRoute`
 * computes each route's off that route's. NYPD-SOUND-001 carries no `dedupe_key` on the published
 * ruleset, so the two can only disagree on a synthetic group, which is what this builds.
 */
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
  /** The gated rule, merged with a second route that publishes a DIFFERENT window. */
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

    // The line binds to the tightest window, which is the ALTERNATE route's, and that route is not
    // the gated one.
    expect(sound?.latestApplyDate).toBe("2026-10-05");
    expect(sound?.routes?.[0]?.ruleId).toBe("NYPD-SOUND-ALT-001");
    expect(gatedRoute?.latestApplyDate).toBe("2026-11-29");

    // SO THE HEADLINE IS NOT SEQUENCED (#252 review). Writing the gate onto the merged scalars put
    // the NYPD gate and the gated slack beside a name, a window and a status belonging to a route
    // that is not gated at all, while that route's own entry read `applyAfterDate: null` two lines
    // below. The scalars stay the binding route's: no gate, and its own ungated 75-day slack from
    // today to 2026-10-05.
    expect(sound?.applyAfterDate).toBeNull();
    expect(sound?.slackDays).toBe(75);

    // The gated ROUTE carries the sequencing, measured against ITS OWN window: 109 days from the
    // 2026-08-12 gate to its 2026-11-29 deadline. `verdict.ts` reads the routes, so the narrowed
    // slack is still what the verdict sees.
    expect(gatedRoute?.applyAfterDate).toBe("2026-08-12");
    expect(gatedRoute?.slackDays).toBe(109);
    // The route that is not gated is untouched by the sequencing.
    expect(otherRoute?.applyAfterDate).toBeNull();
    // The sequence is still stated on the line, because the note is one sentence about the group.
    expect(sound?.notes.some((note) => note.includes("sequenced after PARKS-EVENT-001"))).toBe(
      true,
    );
  });

  it("states the gated route's own window in the note, not the binding route's", () => {
    const evaluated = plan([PARKS, DEPENDENCY, SOUND, SOUND_ALT]);
    const sound = evaluated.findings.find((finding) => finding.ruleIds.includes("NYPD-SOUND-001"));
    const note = sound?.notes.find((entry) => entry.includes("sequenced after PARKS-EVENT-001"));

    // 109 days, from the 2026-08-12 gate to the GATED route's own 2026-11-29 deadline, which is
    // the same figure the route entry carries. Built from the merged scalars the sentence read
    // "leaving 54 days", which is the distance to the BINDING route's 2026-10-05 deadline: the
    // slack of a route that is not gated, offered as the gated route's filing window (#252
    // review).
    expect(note).toContain("leaving 109 days to file");
    expect(note).not.toContain("leaving 54 days");
  });

  /**
   * The gated route's own deadline, 2026-07-01, has already passed, so its window is less
   * available than the alternate's and the alternate binds. The 2026-08-12 gate falls after the
   * gated route's deadline and well inside the binding route's, so the sequence closes a window
   * the scalars say is open.
   */
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

    // Both scalars belong to the alternate route, whose window is open and on track. Read off
    // them, the sequence looked open and the note said "leaving 54 days to file"; it also offered
    // "filing directly may still be open" for a route whose own published deadline had passed.
    expect(sound?.routes?.[0]?.ruleId).toBe("NYPD-SOUND-ALT-001");
    expect(sound?.latestApplyDate).toBe("2026-10-05");
    expect(sound?.deadlineStatus).toBe("on_track");

    expect(note).toContain("leaves no window to file in");
    expect(note).toContain("this permit's own 2026-07-01 deadline");
    expect(note).not.toContain("filing directly may still be open");
  });
});

/**
 * #252: A BRANCH SIGNATURE BUILT FROM THE MERGED SCALAR CANNOT SEE A ROUTE'S TIMELINE.
 *
 * The window checks read every route. The branch comparison read the merged line's one
 * `latestApplyDate`, so an unknown that moves only a NON-BINDING route's date left the verdict, the
 * merged rule ids and that scalar all equal: the branches signed identically, the unknown was
 * called immaterial and the plan read FEASIBLE with a material timing question discarded.
 * ARCHITECTURE step 3 makes an unknown that changes the finding set OR THE TIMELINE conditional.
 */
describe("an unknown that moves only a non-binding route's window (#252)", () => {
  const PLAZA_FIELD = [
    { field: "plaza_level", type: "enum", values: ["unknown", "a", "b"] },
    { field: "plaza_multiple_blocks", type: "boolean" },
  ];
  /** The binding route: the tightest window on the line, and the same date on every branch. */
  const BINDING = {
    id: "SAPO-EVENT-001",
    dedupeKey: "plaza",
    trigger: ALWAYS,
    output: {
      permit_name: "Plaza event permit",
      deadline: { type: "published_minimum", calendar_days: 60 },
    },
  } as const;
  /**
   * The non-binding route. Its window is published BY LEVEL, so the unanswered level is what stops
   * it being dated — and every level publishes a window looser than the binding route's 60 days, so
   * resolving it moves this route's date and nothing else on the line.
   */
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
    // NOT VACUOUS: on both branches the merged line is byte-identical — same rule ids, same name,
    // same window, same status — which is exactly why the scalar signature could not tell them
    // apart. The difference is one route's date.
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

    // So the unanswered level is a material unknown, and the plan says so instead of resolving it
    // silently to whichever date the branch happened to produce.
    const unresolved = evaluated("unknown");
    expect(unresolved.verdict).toBe("CONDITIONAL");
    expect(unresolved.verdictDetail.missingFacts.map((fact) => fact.field)).toContain(
      "plaza_level",
    );
  });
});

/**
 * #252: the branch is retained; its ORGANIZER-FACING REASON reads the wrong route.
 *
 * `computeWindowVerdict` blocks on any route's missed window, so an unknown can close a NON-BINDING
 * route's window while the binding route stays open and the merged scalar `deadlineStatus` still
 * says `on_track`. `describeDifference` tested that scalar, so the reason persisted on the plan row
 * said "same findings, re-dated" on exactly the branch F-102 AC 6 requires to state the miss.
 *
 * The non-binding route here is non-binding because its own trigger is unresolved: the binding route
 * is the tightest window among the routes contributing the merged disposition, intersected with the
 * RESOLVED routes, so an `unknown` route is excluded however early its date. That is the only shape
 * in which a missed route is not the headline, since a past date is otherwise the tightest there is.
 */
describe("the reason for a branch that misses only a non-binding route (#252)", () => {
  const FIELDS = [
    { field: "plaza_level", type: "enum", values: ["unknown", "a", "b"] },
    { field: "plaza_multiple_blocks", type: "boolean" },
    { field: "plaza_gated", type: "boolean" },
  ];
  /** The binding route: resolved, required, and open on every branch. */
  const BINDING = {
    id: "SAPO-EVENT-001",
    dedupeKey: "plaza",
    trigger: ALWAYS,
    output: {
      permit_name: "Plaza event permit",
      deadline: { type: "published_minimum", calendar_days: 60 },
    },
  } as const;
  /** Unresolved, so it never binds, and dated by the level: `b`'s window closed before today. */
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
    // NOT VACUOUS: on branch `b` the merged line still reads open, which is why the scalar said
    // nothing had tightened. The miss is one route down.
    const missing = evaluated("b").findings[0];
    expect(missing?.deadlineStatus).not.toBe("published_deadline_missed");
    expect(missing?.routes?.[1]?.deadlineStatus).toBe("published_deadline_missed");

    const level = evaluated("unknown").verdictDetail.missingFacts.find(
      (fact) => fact.field === "plaza_level",
    );
    const branchB = level?.branches.find((branch) => branch.value === "b");
    expect(branchB?.reason).toContain("published deadline missed as scoped");
    // And the branch that does not miss still says so, so the sentence distinguishes them.
    const branchA = level?.branches.find((branch) => branch.value === "a");
    expect(branchA?.reason).not.toContain("published deadline missed as scoped");
  });
});

/**
 * #252: the rescope ladder reaches FEASIBLE_AT_RISK and does not say what is at risk.
 *
 * `computeWindowVerdict` takes `minSlackDays` over every ROUTE, so on a merged line the minimum can
 * belong to a route that is not the headline: the binding route is the tightest window among the
 * routes contributing the merged DISPOSITION, so a route published at a weaker disposition never
 * binds however tight its window. `buildRescopeSuggestions` searched the findings for
 * `slackDays === minSlackDays`, the merged scalar belongs to the binding route, and the search
 * matched nothing — so the ladder named a change that reaches FEASIBLE_AT_RISK with no label for the
 * requirement at risk, on a route that publishes a name.
 */
describe("naming the at-risk route of a rescoped merged line (#252)", () => {
  const VENUE_FIELD = [
    { field: "venue_type", type: "enum", values: ["unknown", "park", "private"] },
  ];
  /** Missed, required and unmerged: the current scope is INFEASIBLE, so a ladder is built. */
  const BLOCKER = {
    id: "PARKS-MISSED-001",
    dedupeKey: null,
    trigger: { all: [{ field: "venue_type", op: "eq", value: "park" }] },
    output: {
      permit_name: "Parks special event permit",
      deadline: { type: "published_minimum", calendar_days: 200 },
    },
  } as const;
  /** The binding route: strongest disposition, so it takes the headline and its slack is 75 days. */
  const BINDING = {
    id: "PLAZA-BIND-001",
    dedupeKey: "plaza",
    trigger: ALWAYS,
    output: {
      permit_name: "Plaza event permit",
      deadline: { type: "published_minimum", calendar_days: 60 },
    },
  } as const;
  /** Resolved, tighter, and weaker: it holds the minimum slack and can never be the headline. */
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
    // NOT VACUOUS: the merged line's own slack is the binding route's 75 days, which is not the
    // minimum the suggestion reports, so no finding on the plan carries the number searched for.
    const merged = plan([BINDING, AT_RISK]).findings[0];
    expect(merged?.name).toBe("Plaza event permit");
    expect(merged?.slackDays).not.toBe(rescope?.minSlackDays);
    expect(rescope?.atRiskFindingName).toBe("Plaza block closure approval");
  });
});

/**
 * #252: a group holding a resolved route can still bind its headline to an unresolved one.
 *
 * The resolved subset the binding route is chosen from is the GROUP's (design §4.2: "when the
 * resolved subset is non-empty, the binding route is chosen from it; when it is empty, from the
 * whole group"). Computing it over the routes CONTRIBUTING the merged disposition instead leaves it
 * empty whenever no contributing route resolved, and the fallback then binds an unresolved route
 * while the group holds a resolved one.
 *
 * The shape that reaches it: a resolved route below `required`, so `unresolvedRouteCeilingApplies`
 * does not bite and an unknown-triggered route carries the group to a disposition the resolved route
 * does not contribute. A resolved advisory beside an unknown-triggered eligibility rule is that,
 * and the merged line published the candidate's name, window, fee and portal.
 */
describe("the binding route of a group whose resolved route does not contribute (#252)", () => {
  const FIELD = [{ field: "sidewalk_use", type: "enum", values: ["unknown", "cafe", "display"] }];
  /** Resolved, and `advisory` is below the cap trigger, so the ceiling never bites on this group. */
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
  /** Unresolved, and the only route contributing `may_be_required`. Its window is the tighter one. */
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

  it("binds the headline to the resolved route, not to the candidate that set the disposition", () => {
    const line = merged();
    // NOT VACUOUS: the candidate is the only route contributing the merged disposition, and its
    // window is the tighter of the two, so both of the other orderings would pick it.
    expect(line?.disposition).toBe("may_be_required");
    expect(
      line?.routes?.find((route) => route.ruleId === "DOT-SIDEWALK-CAFE-001")?.triggerResult,
    ).toBe("unknown");

    expect(line?.name).toBe("Sidewalk clearance advisory");
    expect(line?.agency).toBe("DOT");
    expect(line?.feeDisplay).toBe("No fee");
    expect(line?.portalName).toBe("DOT sidewalk desk");
    expect(line?.portalUrl).toBe("https://example.test/dot");
  });

  it("keeps the candidate's own name, window, fee and portal on its route entry", () => {
    const candidate = merged()?.routes?.find((route) => route.ruleId === "DOT-SIDEWALK-CAFE-001");
    expect(candidate?.name).toBe("Sidewalk cafe licence");
    expect(candidate?.feeDisplay).toBe("$1,050 licence fee");
    expect(candidate?.portalUrl).toBe("https://example.test/dcwp");
    // Nothing on the line asserts the candidate applies, so the mode still says so.
    expect(merged()?.headlineMode).toBe("candidate");
  });
});
