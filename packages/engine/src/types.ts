// Shared engine contracts (ARCHITECTURE.md "Rules Engine"). Both apps import these;
// nobody redefines intake, finding, or verdict types locally (AGENTS.md "Shared contracts").

/** Intake keys are the ruleset's own `intake_fields` names, so triggers resolve without a mapping table. */
export type IntakeValue = string | number | boolean | readonly string[] | null;

/**
 * The evaluated intake. A key that is absent or `null` means "asked, not answered"
 * (ARCHITECTURE: a null numeric on a selected structure evaluates unknown, not false);
 * a field the registry's `asked_when` does not scope in is never material, whatever it holds.
 */
export type EventIntake = Readonly<Record<string, IntakeValue>>;

export type Tristate = "true" | "false" | "unknown";

/** The intake field every backward deadline is computed from. */
export const EVENT_DATE_FIELD = "event_date";

export type ConditionOperator = "eq" | "in" | "gt" | "gte" | "bool" | "contains" | "contains_any";

export type Condition = {
  readonly field: string;
  readonly op: ConditionOperator;
  readonly value: unknown;
  /**
   * Declared when an answer exactly on this threshold is unresolved rather than below it.
   * DOB-TENT-001 publishes it for "more than 400 sq ft", whose own note says exactly 400 renders
   * CONDITIONAL. Per condition, because it is a fact about that threshold: FDNY-GENERATOR-001's
   * 2.5 gallons and DOB-STAGE-001's 2 feet exclude their exact values and say so by declaring
   * nothing.
   */
  readonly boundary: ConditionBoundary | null;
};

export type ConditionBoundary = "conditional";

export type TriggerNode =
  Condition | { readonly all: readonly TriggerNode[] } | { readonly any: readonly TriggerNode[] };

/**
 * The published caveat that qualifies a deadline's number, which any deadline type can carry.
 */
type DeadlineBound = {
  readonly qualification: string | null;
};

/**
 * Whether a published day count is an inclusive or exclusive bound, on the deadline types that
 * express a single filing bound and date it by counting back from the event.
 *
 * `inclusive` (the default when a rule declares nothing) is "at least N days before" — filing on
 * day N is valid. `exclusive` is "earlier than N days before" — day N is already too late, so the
 * last valid filing day is one unit earlier. The difference decides whether an event exactly N
 * days out is at risk or already missed, so it is published data rather than something the engine
 * infers from the qualification prose.
 *
 * Every dated variant carries one, `composite` included. It was excluded on the grounds that its
 * hard floor meant something different — day N already missed — but that reading came from an
 * F-102 sentence the published rule contradicted, and correcting it removed the difference: on the
 * floor, latest_apply_date equals today, which is the last valid day, exactly what an inclusive
 * bound means. With no difference left to describe there is no special case to keep, and a future
 * composite publishing "earlier than" can say so like any other rule.
 */
export type DeadlineBoundary = "inclusive" | "exclusive";

type BoundedDeadline = DeadlineBound & {
  readonly boundary: DeadlineBoundary;
};

export type Deadline =
  | ({
      readonly type: "published_minimum";
      readonly calendarDays: number;
      readonly display: string | null;
    } & BoundedDeadline)
  | ({
      readonly type: "published_minimum_by_level";
      readonly levels: Readonly<
        Record<string, { readonly calendarDays: number; readonly multiBlockDays: number | null }>
      >;
      readonly unknownLevelBehavior: string | null;
    } & BoundedDeadline)
  | ({
      readonly type: "composite";
      readonly hardFloorDays: number;
      readonly processingRangeDays: readonly [number, number];
      readonly display: string | null;
    } & BoundedDeadline)
  | ({
      readonly type: "business_days_minimum";
      readonly businessDays: number;
      readonly display: string | null;
    } & BoundedDeadline)
  | ({ readonly type: "before_issuance"; readonly display: string | null } & DeadlineBound)
  | ({
      readonly type: "research_required";
      readonly display: string | null;
    } & DeadlineBound);

export type VerificationStatus =
  "SOURCE_CONFIRMED" | "OFFICIAL_CONFLICT" | "RESEARCH_REQUIRED" | "COVERAGE_GAP" | "VERIFIED";

/** Rule kinds as published. `classification` is a rule role, never a persisted finding kind (#73). */
export type RuleKind =
  | "permit"
  | "insurance"
  | "notification"
  | "registration"
  | "eligibility"
  | "prohibition"
  | "dependency"
  | "classification"
  | "advisory"
  | "note";

export type FindingKind = Exclude<RuleKind, "classification">;

export type Disposition =
  "required" | "may_be_required" | "prohibited_or_ineligible" | "advisory" | "no_new_requirement";

export type DeadlineStatus =
  | "on_track"
  | "deadline_approaching"
  | "published_deadline_missed"
  | "not_calculable"
  | "not_applicable";

export type Verdict = "FEASIBLE" | "FEASIBLE_AT_RISK" | "CONDITIONAL" | "INFEASIBLE";

export type RuleSource = { readonly citation: string; readonly urls: readonly string[] };

export type UserSummaryPointKind = "overview" | "deadline" | "fee" | "action" | "warning";

export type SummarySourceLink = {
  readonly label: string;
  readonly url: string;
};

export type UserSummaryPoint = {
  readonly kind: UserSummaryPointKind;
  readonly text: string;
  readonly sources: readonly SummarySourceLink[];
};

export type RuleUserSummary = {
  readonly heading: string;
  readonly points: readonly UserSummaryPoint[];
};

export type IntakeFieldDefinition = {
  readonly field: string;
  readonly type: string;
  readonly values: readonly string[] | null;
  readonly askedWhen: string | null;
  /** The parsed form of `askedWhen`, validated when the ruleset loads; null when unscoped. */
  readonly askedWhenClauses: readonly AskedWhenClause[] | null;
  readonly nullable: boolean;
};

/** The minimum a parser needs to check an `asked_when` clause against a field. */
export type ScopedField = {
  readonly field: string;
  readonly type: string;
  readonly values: readonly string[] | null;
};

export type AskedWhenClause =
  | { readonly kind: "in"; readonly field: string; readonly values: readonly string[] }
  | {
      readonly kind: "compare";
      readonly field: string;
      readonly op: "=" | "!=";
      /** Typed to the field it compares: a boolean field yields a boolean, a numeric one a number. */
      readonly value: string | number | boolean;
    }
  | { readonly kind: "at_least"; readonly field: string; readonly threshold: number }
  | { readonly kind: "truthy"; readonly field: string }
  | { readonly kind: "member"; readonly field: string; readonly member: string };

/**
 * The intake fields a by-level deadline keys on.
 *
 * Held on the rule rather than on the deadline, because it is how the engine resolves the
 * deadline and not part of what the deadline publishes. A finding snapshots `rule.deadline`
 * verbatim, and a snapshot is only replayable if its shape is the shape the artifact published:
 * nyc.v2.1–v2.3 declared no binding, so a legacy plan's stored deadline has no such keys and must
 * not grow them when it is re-evaluated (AD-7).
 */
export type LevelBinding = {
  readonly levelField: string;
  readonly multiBlockField: string;
};

export type EngineRule = {
  readonly id: string;
  readonly kind: RuleKind;
  readonly trigger: TriggerNode;
  readonly name: string | null;
  readonly agency: string | null;
  readonly publishedDisposition: Disposition | null;
  readonly deadline: Deadline | null;
  /** Non-null exactly when `deadline` is a by-level deadline. */
  readonly levelBinding: LevelBinding | null;
  readonly feeDisplay: string | null;
  readonly portalName: string | null;
  readonly portalUrl: string | null;
  readonly portalInstructions: string | null;
  readonly noteText: string | null;
  readonly notes: readonly string[];
  readonly dedupeKey: string | null;
  readonly verificationStatus: VerificationStatus;
  readonly verificationQualification: string | null;
  /**
   * The date a rule's facts were last confirmed against their sources, when one is published.
   *
   * Optional and null throughout nyc.v2.11: every fact is still pre-VERIFIED, and a date this repo
   * cannot evidence would be an invented permit fact. `permit_plan_items.last_verified_date` and
   * F-206's per-line date have had a column and a writer since migration 001 with nothing to read;
   * this is what they will read when verification rounds resume.
   */
  readonly verificationLastVerifiedDate: string | null;
  readonly source: RuleSource | null;
  readonly userSummary: RuleUserSummary | null;
};

export type EngineRuleset = {
  readonly rulesetVersion: string;
  /** e.g. "US-NY-NYC". The api maps this to the local clock a plan's `today` is read from. */
  readonly jurisdiction: string;
  readonly snapshotDate: string;
  readonly slackWarningDays: number;
  readonly calendarId: string;
  readonly intakeFields: readonly IntakeFieldDefinition[];
  /** Published `rules` followed by `advisories`, in file order — the engine's evaluation order. */
  readonly rules: readonly EngineRule[];
};

/**
 * The pinned holiday calendar (AD-11). Injected; the engine never derives holidays itself.
 *
 * `holidays: null` means no list has been published for this calendar id — distinct from a
 * published list that happens to be empty. A business-day deadline cannot be computed without
 * one, so findings that need it render NOT_CALCULABLE rather than falling back to weekday-only
 * arithmetic, which would push the date later than it really is.
 */
export type HolidayCalendar = { readonly id: string; readonly holidays: readonly string[] | null };

/** A calendar whose holiday list has been published, so business-day math can run. */
export type PublishedHolidayCalendar = HolidayCalendar & { readonly holidays: readonly string[] };

export type TriggeredBy = { readonly field: string; readonly value: IntakeValue };

export type FindingSource = {
  readonly ruleId: string;
  readonly citation: string;
  readonly urls: readonly string[];
};

/**
 * One contributing rule of a merged dedupe group, with its own published values and its own
 * trigger result. Every value here is that rule's own; nothing on a route is derived from the
 * group. A merged line has room for one name, one window and one fee, so before this existed the
 * merge had to discard the losing routes' versions of all three (`docs/proposals/dedupe-route-list.md`).
 *
 * `verificationStatus` is deliberately absent: `rejectMixedDedupeVerificationStatuses` refuses at
 * load any ruleset whose dedupe key mixes verification statuses, so it is a constant within a group.
 */
export type FindingRoute = {
  readonly ruleId: string;
  /** "true" or "unknown". Never "false": a trigger that resolves false produces no finding. */
  readonly triggerResult: Tristate;
  /**
   * This rule's own disposition, as `resolveDisposition` produced it, before any group arithmetic.
   * Not capped by the unresolved-route ceiling: the ceiling constrains what the merged HEADLINE may
   * claim, and a route entry claims nothing about the group.
   */
  readonly disposition: Disposition;
  /**
   * The intake fields this route's OWN trigger could not resolve, which is the question that
   * decides whether it applies. Empty when `triggerResult` is "true". Per route rather than per
   * finding: `deadlineUnknownFields` on the merged line concatenates over the group and says which
   * answers stopped a DATE resolving, which is a different question from which answers stopped a
   * route resolving.
   */
  readonly unknownFields: readonly string[];
  readonly name: string | null;
  readonly agency: string | null;
  readonly deadline: Deadline | null;
  readonly deadlineDisplay: string | null;
  readonly latestApplyDate: string | null;
  readonly applyAfterDate: string | null;
  readonly deadlineStatus: DeadlineStatus;
  readonly slackDays: number | null;
  readonly feeDisplay: string | null;
  readonly portalName: string | null;
  readonly portalUrl: string | null;
  readonly portalInstructions: string | null;
  /**
   * This route's own published notes, as `ruleNotes()` built them for its own rule: the rule's
   * `notes`, its deadline qualification, its verification qualification, and the confirm-with-agency
   * floor where its own window could not be dated.
   *
   * WITHOUT IT THE ATTRIBUTION EXISTS NOWHERE. The merged line's `notes` concatenate over the group
   * with no marker saying which rule published which string, so a consumer holding one route cannot
   * recover its notes from the line — and `alerts.ts` sends a reminder headed with ONE route's name
   * and filing date, so it was quoting another route's threshold and qualification as if they
   * qualified this filing (#252 review). Every other value that reminder reads is already per route;
   * this was the one the merge alone knew.
   *
   * Optional because a plan stored before this field carries no per-route notes, and a replayed
   * artifact is read as it was written. A consumer treats absence as "not recorded" rather than as
   * "this route publishes none"; there is no way to tell the two apart on such a plan, which is why
   * absence is not a value.
   */
  readonly notes?: readonly string[];
  /**
   * This route's own `conflictText`: both readings of an OFFICIAL_CONFLICT rule, verbatim, or null
   * where its own rule publishes none.
   *
   * SINGLE-VALUED ON THE MERGED LINE, WHICH IS WHY IT NEEDED CARRYING TOO. `mergeGroup` does not
   * concatenate this one — it falls back through the routes in binding order and takes the first
   * that publishes any — so the line's value is exactly ONE route's text with nothing recording
   * whose. A consumer that narrows the rest of a message to one route and leaves this quoted both
   * readings of another rule's conflict under this route's name and date (#252 review). The same
   * shape as `notes`, one field over, and the same fix.
   *
   * Optional for the same reason `notes` is: a plan stored before this field carries no per-route
   * value, and a consumer treats absence as "not recorded" rather than as "this route publishes
   * none", which `null` is.
   */
  readonly conflictText?: string | null;
};

/**
 * Why a group's routes arrived on one line, which is what decides how the line reads.
 *
 * `applies_together`: every contributing trigger resolved, so the recorded answers meet each
 * route's own conditions. `candidate`: at least one did not, so the group holds routes whose
 * conditions are not known to be met and the line names the question rather than asserting one.
 *
 * THIS IS A STATEMENT ABOUT TRIGGERS, NOT ABOUT DISPOSITIONS, and copy reading it must say so. A
 * route whose trigger resolved can still publish `MAY_BE_REQUIRED` or `NO_NEW_REQUIREMENT`;
 * DOB-TALL-STRUCTURE-001 publishes the first and SAPO-INSURANCE-BLOCK-EXEMPT-001 the second. The
 * name is retained because it is the stored value on plans already written, but "together" here
 * means the triggers fired together, and what each route then requires is its own `disposition`.
 *
 * Derived from the routes' own `triggerResult`s and stored only so a client need not recompute it.
 * There is no third value for the mixed case: the resolved subset is recoverable from the routes,
 * and a group-level flag would have to say two things at once about two different routes
 * (`docs/proposals/dedupe-route-list.md` §4.2).
 */
export type HeadlineMode = "applies_together" | "candidate";

export type Finding = {
  readonly ruleIds: readonly string[];
  readonly kind: FindingKind;
  readonly disposition: Disposition;
  readonly name: string | null;
  readonly agency: string | null;
  readonly deadline: Deadline | null;
  readonly deadlineDisplay: string | null;
  readonly latestApplyDate: string | null;
  readonly applyAfterDate: string | null;
  readonly deadlineStatus: DeadlineStatus;
  readonly slackDays: number | null;
  readonly feeDisplay: string | null;
  readonly portalName: string | null;
  readonly portalUrl: string | null;
  /**
   * How to file when the portal is not a URL. NYPD-SOUND-001 publishes no URL and carries the
   * precinct and form number here, so dropping it leaves the only actionable filing detail on the
   * floor and F-204 with no in-person path to render.
   */
  readonly portalInstructions: string | null;
  readonly notes: readonly string[];
  /** The rule's published note text, verbatim — carries eligibility rescope guidance and scope caveats. */
  readonly noteText: string | null;
  /** Intake fields that stopped this finding's deadline from resolving (e.g. an unknown plaza level). */
  readonly deadlineUnknownFields: readonly string[];
  /**
   * Why this finding's published deadline could not be turned into a date, when the cause is a
   * missing input rather than an unanswered question — today, only an unpublished holiday list.
   * The requirement is real and dated by the agency; it is the timeline we cannot compute, so the
   * plan stays CONDITIONAL rather than dropping the window from the arithmetic (P1-A).
   */
  readonly timelineUnresolvedReason: string | null;
  /** Both readings of an OFFICIAL_CONFLICT rule, verbatim; null otherwise. */
  readonly conflictText: string | null;
  readonly sources: readonly FindingSource[];
  readonly userSummary?: RuleUserSummary | null;
  readonly verificationStatus: VerificationStatus;
  /**
   * Earliest contributing rule verification date when every contributing rule publishes one;
   * null otherwise. Absent on replayed artifacts that predate this field so their serialized
   * finding shape remains reproducible. This is fact provenance, never the ruleset publication.
   */
  readonly lastVerifiedDate?: string | null;
  readonly triggeredBy: readonly TriggeredBy[];
  /**
   * Every contributing route, present exactly when this finding merged two or more rules. A
   * single-rule finding is its own route and every scalar on it is that rule's, so a one-entry list
   * would restate the finding and make "did this merge?" unanswerable from the shape. Absent on
   * replayed artifacts that predate this field. Read it through `routesOf`, which is the one
   * correct fallback.
   */
  readonly routes?: readonly FindingRoute[];
  /** Present exactly when `routes` is. */
  readonly headlineMode?: HeadlineMode;
};

export type BranchOutcome = {
  readonly value: string;
  readonly verdict: Verdict;
  readonly reason: string;
};

export type MissingFact = {
  readonly field: string;
  readonly branches: readonly BranchOutcome[];
  /**
   * Set when the field cannot be enumerated into branches (a numeric answer has no declared
   * values), naming the published thresholds that decide it. The fact is still listed: a client
   * that only sees "conditional" with an empty branch table cannot tell what to ask for.
   */
  readonly thresholds: string | null;
};

export type RescopeSuggestion = {
  readonly change: { readonly field: string; readonly value: string };
  readonly reevaluatedVerdict: Verdict;
  readonly droppedRuleIds: readonly string[];
  /**
   * F-102 enrichment on the current ruleset line (nyc.v2.8+). Omitted entirely when evaluating a
   * superseded era so AD-7 replay keeps the historical three-field suggestion shape.
   */
  readonly introducedRuleIds?: readonly string[];
  /** Published organizer-facing labels for the findings behind `introducedRuleIds`. */
  readonly introducedFindings?: readonly {
    readonly ruleIds: readonly string[];
    readonly label: string | null;
    readonly source: SummarySourceLink | null;
    readonly portalName: string | null;
    readonly portalUrl: string | null;
  }[];
  /** Facts the improved re-evaluation still needs before it can leave CONDITIONAL. */
  readonly remainingMissingFields?: readonly string[];
  /** Published timelines the improved re-evaluation still cannot date. */
  readonly remainingTimelineReasons?: readonly string[];
  /**
   * Present on at-risk re-evaluations when enrichment is emitted. Omitted on other suggestions and
   * on three-field historical eras.
   */
  readonly minSlackDays?: number | null;
  readonly atRiskFindingName?: string | null;
};

export type EvaluationTraceEntry = { readonly ruleId: string; readonly result: Tristate };

/** A finding whose published window exists but could not be computed from the inputs supplied. */
export type UnresolvedTimeline = { readonly ruleIds: readonly string[]; readonly reason: string };

export type VerdictDetail = {
  /**
   * The route whose published window closed, never the merged line that holds it.
   *
   * THE PUBLISHED VALUES TRAVEL WITH IT, and that is what this carries beyond a rule id and a name.
   * A consumer given only those two had to find the finding again by rule id, which on a merged
   * dedupe line returns the whole line: the panel then rendered the HEADLINE route's name, portal
   * and apply-by date under a heading about the missed one, and on a two-route group with one open
   * window the date it printed was in the future of the plan's own clock (#252 review). Every field
   * here is the blocking route's own, as `blockerView` narrowed it.
   *
   * ALL OF WHAT F-102 NAMES, NOT THE SUBSET THE PANEL HAPPENED TO READ. The amended edge case lists
   * the blocking route's "rule id, name, agency, disposition, window, status, fee, portal,
   * instructions and citations", and `blockerView` narrows every one of them; this serialization
   * carried six. A route filing through instructions rather than a URL — the `nypd_sound` precinct
   * route publishes a null portal url and files in person — then reached the panel with nothing
   * that says where to file, and the widening had already turned the legacy fallback off, so
   * consulting the whole finding could not supply it either (#252 review).
   *
   * Optional because plans stored before this widening carry only `ruleIds` and `name`; a replayed
   * detail is read as it was written, and a consumer treats absence as "not recorded".
   */
  readonly blockingFinding: {
    readonly ruleIds: readonly string[];
    readonly name: string | null;
    readonly agency?: string | null;
    readonly disposition?: Disposition;
    readonly deadlineDisplay?: string | null;
    readonly latestApplyDate?: string | null;
    readonly deadlineStatus?: DeadlineStatus;
    readonly feeDisplay?: string | null;
    readonly portalName?: string | null;
    readonly portalUrl?: string | null;
    readonly portalInstructions?: string | null;
    readonly sources?: readonly FindingSource[];
    /**
     * Null where the blocking route is not the route the merged line reads: the heading is written
     * about a rule and belongs to that one, so it is dropped rather than reattributed.
     */
    readonly userSummary?: RuleUserSummary | null;
  } | null;
  readonly missedRuleIds: readonly string[];
  readonly minSlackDays: number | null;
  readonly missingFacts: readonly MissingFact[];
  readonly unresolvedTimelines: readonly UnresolvedTimeline[];
  readonly rescopeSuggestions: readonly RescopeSuggestion[];
  readonly trace: readonly EvaluationTraceEntry[];
};

export type PermitPlan = {
  readonly rulesetVersion: string;
  readonly today: string;
  readonly calendarId: string;
  readonly findings: readonly Finding[];
  readonly verdict: Verdict;
  readonly verdictDetail: VerdictDetail;
};

/**
 * The status an organizer tracks a plan line at (F-202). It is app state rather than rule output,
 * so the engine neither reads nor writes it — but it is a shared contract, and a contract with two
 * definitions is a contract that eventually disagrees with itself. It lives here so the api and
 * the web client compile against one vocabulary (AGENTS.md "Shared contracts"), the same reason
 * #90 collapsed the two `asked_when` parsers.
 *
 * Mirrors the `checklist_items.status` CHECK constraint; `checklist.test.ts` asserts they are
 * equal against the live schema.
 */
export const CHECKLIST_STATUSES = [
  "not_started",
  "in_progress",
  "submitted",
  "approved",
  "rejected",
] as const;

export type ChecklistStatus = (typeof CHECKLIST_STATUSES)[number];

/** Rule evaluation never degrades to "no requirement": failures throw this instead (AC 5). */
export class EvaluationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EvaluationError";
  }
}
