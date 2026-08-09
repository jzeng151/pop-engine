import type {
  Deadline,
  DeadlineStatus,
  FindingSource,
  VerificationStatus,
} from "@pop-engine/engine";
import { CONFIRM_WITH_AGENCY } from "@pop-engine/engine";
import type { FindingRendering } from "./plan";

/**
 * F-202 AC 9: the moved-deadline notice, computed on read from the plan item a checklist row still
 * points at (previous) and the latest plan's item for the same requirement (current).
 *
 * Nothing here is stored on the checklist row. Plans are immutable snapshots; reviewing re-points
 * the row and the notice clears because the two sides become one plan.
 */

/** Provenance that travels with a previous deadline value (AC 9 floor). */
type PreviousDeadlineProvenance = {
  readonly verificationStatus: VerificationStatus;
  readonly lastVerifiedDate: string | null;
  readonly sources: readonly FindingSource[];
  readonly sourceUrl: string | null;
  readonly conflictText: string | null;
  readonly rulesetVersion: string;
  readonly snapshotDate: string | null;
};

type DateChange =
  | { readonly kind: "both"; readonly previous: string; readonly current: string }
  | {
      readonly kind: "became_not_calculable";
      readonly previous: string;
      readonly reason: string | null;
    }
  | { readonly kind: "became_not_applicable"; readonly previous: string }
  | { readonly kind: "now_computed"; readonly current: string };

type DeadlineStateSide = {
  readonly deadlineStatus: DeadlineStatus;
  readonly deadline: Deadline | null;
  readonly deadlineDisplay: string | null;
  readonly timelineUnresolvedReason: string | null;
  readonly deadlineUnknownFields: readonly string[];
  /** Presence of a gate, not its calendar value — the value moves with `today`. */
  readonly gated: boolean;
};

type MovedDeadlineNotice = {
  readonly dateChange: DateChange | null;
  readonly stateChange: {
    readonly previous: DeadlineStateSide;
    readonly current: DeadlineStateSide;
  } | null;
  readonly previousProvenance: PreviousDeadlineProvenance;
  readonly rulesetVersionsDiffer: boolean;
  readonly previousRulesetVersion: string;
  readonly currentRulesetVersion: string;
};

export type NoticePlanItem = {
  readonly deadline: Deadline | null;
  readonly latest_apply_date: string | null;
  readonly apply_after_date: string | null;
  readonly deadline_status: DeadlineStatus;
  readonly verification_status: VerificationStatus;
  readonly last_verified_date: string | null;
  readonly sources: readonly FindingSource[];
  readonly source_url: string | null;
  readonly source_ruleset_version: string;
  readonly source_snapshot_date: string | null;
};

/**
 * Stored deadline fields AC 9 names for comparison. Drawn from what a plan persists, not from the
 * ruleset's published field names (`level_field` / `multi_block_field` are lifted out at parse).
 */
function deadlineSnapshot(deadline: Deadline | null): unknown {
  if (deadline === null) return null;
  const base: Record<string, unknown> = {
    type: deadline.type,
    qualification: "qualification" in deadline ? deadline.qualification : null,
    display: "display" in deadline ? deadline.display : null,
  };
  if ("boundary" in deadline) base.boundary = deadline.boundary;
  if ("calendarDays" in deadline) base.calendarDays = deadline.calendarDays;
  if ("businessDays" in deadline) base.businessDays = deadline.businessDays;
  if ("levels" in deadline) base.levels = deadline.levels;
  if ("unknownLevelBehavior" in deadline) {
    base.unknownLevelBehavior = deadline.unknownLevelBehavior;
  }
  if ("hardFloorDays" in deadline) base.hardFloorDays = deadline.hardFloorDays;
  if ("processingRangeDays" in deadline) {
    base.processingRangeDays = deadline.processingRangeDays;
  }
  return base;
}

const sameJson = (left: unknown, right: unknown): boolean =>
  JSON.stringify(left) === JSON.stringify(right);

/**
 * Countdown statuses among dated findings are not a state change here — each plan computes them
 * against its own `today`. What counts is dated vs not_calculable vs not_applicable.
 */
const coarseStatus = (status: DeadlineStatus): "dated" | "not_calculable" | "not_applicable" =>
  status === "not_calculable" || status === "not_applicable" ? status : "dated";

/**
 * EVERY GATE THE ROW RENDERS, NOT ONLY THE ONE ITS SCALAR CARRIES.
 *
 * A merged row shows two kinds of gate: its own `applyAfterDate`, which is the filing route's where
 * one was selected, and one line per OTHER route that publishes a gate (`checklist-item.tsx`
 * `gatedRoutesOf`). Reading the scalar alone missed the second kind entirely, and the shape that
 * reaches it is ordinary: a binding route publishing a gate but no window, beside a sibling
 * publishing the window, makes `filingRouteOf` select the sibling, so the scalar is the sibling's
 * null gate. A regeneration that adds or removes the binding route's gate then moved a date the row
 * visibly renders while both sides read `gated: false`, and no notice was emitted (#252 review).
 * F-202 AC 9 counts gate presence as a deadline-state change.
 *
 * Presence over the union, which is what the notice's own copy says: "this requirement is now gated
 * on another permit decision", about the requirement rather than about one route. Naming which route
 * gained or lost the gate would be a different notice and a wider contract than AC 9 describes.
 *
 * No two-route guard, because none is needed here: a one-entry list's route is the row itself and
 * its gate is the scalar already read, so the union is the same either way.
 */
const rendersGate = (item: NoticePlanItem, rendering: FindingRendering): boolean =>
  item.apply_after_date !== null ||
  (rendering.routes ?? []).some((route) => route.applyAfterDate !== null);

function stateSide(item: NoticePlanItem, rendering: FindingRendering): DeadlineStateSide {
  return {
    deadlineStatus: item.deadline_status,
    deadline: item.deadline,
    deadlineDisplay: rendering.deadline_display,
    timelineUnresolvedReason: rendering.timeline_unresolved_reason,
    deadlineUnknownFields: rendering.deadline_unknown_fields,
    gated: rendersGate(item, rendering),
  };
}

function stateMoved(previous: DeadlineStateSide, current: DeadlineStateSide): boolean {
  if (coarseStatus(previous.deadlineStatus) !== coarseStatus(current.deadlineStatus)) {
    return true;
  }
  if (!sameJson(deadlineSnapshot(previous.deadline), deadlineSnapshot(current.deadline))) {
    return true;
  }
  if (previous.deadlineDisplay !== current.deadlineDisplay) return true;
  if (previous.timelineUnresolvedReason !== current.timelineUnresolvedReason) return true;
  if (!sameJson(previous.deadlineUnknownFields, current.deadlineUnknownFields)) return true;
  if (previous.gated !== current.gated) return true;
  return false;
}

function dateChangeOf(
  previousDate: string | null,
  currentDate: string | null,
  currentStatus: DeadlineStatus,
  currentRendering: FindingRendering,
): DateChange | null {
  if (previousDate === currentDate) return null;
  if (previousDate !== null && currentDate !== null) {
    return { kind: "both", previous: previousDate, current: currentDate };
  }
  if (previousDate !== null && currentDate === null) {
    if (currentStatus === "not_applicable") {
      return { kind: "became_not_applicable", previous: previousDate };
    }
    // not_calculable, or any other undated current — window still applies but could not be dated.
    const reason =
      currentRendering.timeline_unresolved_reason ??
      (currentRendering.deadline_unknown_fields.length > 0
        ? `unknown: ${currentRendering.deadline_unknown_fields.join(", ")}`
        : CONFIRM_WITH_AGENCY);
    return { kind: "became_not_calculable", previous: previousDate, reason };
  }
  if (previousDate === null && currentDate !== null) {
    return { kind: "now_computed", current: currentDate };
  }
  return null;
}

/**
 * Compare the previous plan item a checklist row still points at with the latest plan's item for
 * the same requirement. Returns null when nothing AC 9 cares about moved.
 */
export function movedDeadlineNotice(
  previous: NoticePlanItem,
  previousRendering: FindingRendering,
  current: NoticePlanItem,
  currentRendering: FindingRendering,
): MovedDeadlineNotice | null {
  const dateChange = dateChangeOf(
    previous.latest_apply_date,
    current.latest_apply_date,
    current.deadline_status,
    currentRendering,
  );
  const previousState = stateSide(previous, previousRendering);
  const currentState = stateSide(current, currentRendering);
  const stateDidMove = stateMoved(previousState, currentState);

  if (dateChange === null && !stateDidMove) return null;

  return {
    dateChange,
    stateChange: stateDidMove ? { previous: previousState, current: currentState } : null,
    previousProvenance: {
      verificationStatus: previous.verification_status,
      lastVerifiedDate: previous.last_verified_date,
      sources: previous.sources,
      sourceUrl: previous.source_url,
      conflictText: previousRendering.conflict_text,
      rulesetVersion: previous.source_ruleset_version,
      snapshotDate: previous.source_snapshot_date,
    },
    rulesetVersionsDiffer: previous.source_ruleset_version !== current.source_ruleset_version,
    previousRulesetVersion: previous.source_ruleset_version,
    currentRulesetVersion: current.source_ruleset_version,
  };
}
