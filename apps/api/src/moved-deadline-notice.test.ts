import { describe, expect, it } from "vitest";
import type { FindingRoute } from "@pop-engine/engine";
import type { FindingRendering } from "./plan";
import { movedDeadlineNotice, type NoticePlanItem } from "./moved-deadline-notice";

const rendering = (overrides: Partial<FindingRendering> = {}): FindingRendering => ({
  rule_ids: ["SAPO-STREET-MEDIUM-001"],
  notes: [],
  note_text: null,
  conflict_text: null,
  deadline_display: "at least 30 days ahead",
  slack_days: 10,
  deadline_unknown_fields: [],
  timeline_unresolved_reason: null,
  portal_instructions: null,
  ...overrides,
});

const item = (overrides: Partial<NoticePlanItem> = {}): NoticePlanItem => ({
  deadline: {
    type: "published_minimum",
    calendarDays: 30,
    display: "at least 30 days ahead",
    boundary: "inclusive",
    qualification: null,
  },
  latest_apply_date: "2026-07-12",
  apply_after_date: null,
  deadline_status: "on_track",
  verification_status: "SOURCE_CONFIRMED",
  last_verified_date: "2026-07-01",
  sources: [
    {
      ruleId: "SAPO-STREET-MEDIUM-001",
      citation: "SAPO FAQ",
      urls: ["https://example.gov"],
    },
  ],
  source_url: "https://example.gov",
  source_ruleset_version: "nyc.v2.3",
  source_snapshot_date: "2026-07-20",
  ...overrides,
});

describe("movedDeadlineNotice (F-202 AC 9)", () => {
  it("returns null when date and state are unchanged", () => {
    const previous = item();
    expect(movedDeadlineNotice(previous, rendering(), previous, rendering())).toBeNull();
  });

  it("names previous and current dates when both sides are dated", () => {
    const notice = movedDeadlineNotice(
      item({ latest_apply_date: "2026-07-12" }),
      rendering(),
      item({ latest_apply_date: "2026-08-30" }),
      rendering(),
    );
    expect(notice?.dateChange).toEqual({
      kind: "both",
      previous: "2026-07-12",
      current: "2026-08-30",
    });
    expect(notice?.stateChange).toBeNull();
  });

  it("does not treat a countdown-status-only move as a state change", () => {
    const notice = movedDeadlineNotice(
      item({ deadline_status: "on_track", latest_apply_date: "2026-07-12" }),
      rendering(),
      item({ deadline_status: "deadline_approaching", latest_apply_date: "2026-07-12" }),
      rendering(),
    );
    expect(notice).toBeNull();
  });

  it("reports became_not_calculable with the confirm-with-agency floor when undated", () => {
    const notice = movedDeadlineNotice(
      item({ latest_apply_date: "2026-07-12" }),
      rendering(),
      item({ latest_apply_date: null, deadline_status: "not_calculable" }),
      rendering({ timeline_unresolved_reason: null, deadline_unknown_fields: [] }),
    );
    expect(notice?.dateChange).toEqual({
      kind: "became_not_calculable",
      previous: "2026-07-12",
      reason: "confirm with agency",
    });
  });

  it("reports became_not_applicable without calling it undatable", () => {
    const notice = movedDeadlineNotice(
      item({ latest_apply_date: "2026-07-12" }),
      rendering(),
      item({ latest_apply_date: null, deadline_status: "not_applicable" }),
      rendering(),
    );
    expect(notice?.dateChange).toEqual({
      kind: "became_not_applicable",
      previous: "2026-07-12",
    });
  });

  it("carries previous provenance on every notice", () => {
    const notice = movedDeadlineNotice(
      item({
        verification_status: "RESEARCH_REQUIRED",
        last_verified_date: null,
        source_ruleset_version: "nyc.v2.1",
      }),
      rendering({ conflict_text: "both readings" }),
      item({
        latest_apply_date: "2026-08-01",
        source_ruleset_version: "nyc.v2.3",
      }),
      rendering(),
    );
    expect(notice?.previousProvenance.verificationStatus).toBe("RESEARCH_REQUIRED");
    expect(notice?.previousProvenance.lastVerifiedDate).toBeNull();
    expect(notice?.previousProvenance.conflictText).toBe("both readings");
    expect(notice?.rulesetVersionsDiffer).toBe(true);
  });

  it("treats apply-after presence as a state change, not its calendar value", () => {
    const notice = movedDeadlineNotice(
      item({ apply_after_date: null, latest_apply_date: "2026-07-12" }),
      rendering(),
      item({ apply_after_date: "2026-08-01", latest_apply_date: "2026-07-12" }),
      rendering(),
    );
    expect(notice?.dateChange).toBeNull();
    expect(notice?.stateChange?.previous.gated).toBe(false);
    expect(notice?.stateChange?.current.gated).toBe(true);
  });

  /**
   * #252 review: the gate a merged row renders is not always the gate its scalar carries.
   *
   * A binding route publishing a gate but no window, beside a sibling publishing the window, makes
   * `filingRouteOf` select the sibling, so the row's `applyAfterDate` is the sibling's null and the
   * binding route's gate is rendered one line down by `gatedRoutesOf`. Reading the scalar alone put
   * `gated: false` on both sides of a regeneration that removed that gate, so no notice was emitted
   * for a date the row visibly stopped showing.
   */
  describe("a gate published by a route the row's scalar is not read off", () => {
    const route = (ruleId: string, overrides: Partial<FindingRoute> = {}): FindingRoute => ({
      ruleId,
      triggerResult: "true",
      disposition: "required",
      unknownFields: [],
      name: ruleId,
      agency: "DOB",
      deadline: null,
      deadlineDisplay: null,
      latestApplyDate: null,
      applyAfterDate: null,
      deadlineStatus: "not_applicable",
      slackDays: null,
      feeDisplay: null,
      portalName: null,
      portalUrl: null,
      portalInstructions: null,
      ...overrides,
    });
    /** The sibling the row's window, and so its null gate, is read off. */
    const window = route("SAPO-STREET-MEDIUM-001", {
      latestApplyDate: "2026-07-12",
      deadlineStatus: "on_track",
    });
    const merged = (gate: string | null) =>
      rendering({ routes: [route("DOB-TENT-001", { applyAfterDate: gate }), window] });
    // The filing route's, which is null on both sides: this is the scalar the old reading used.
    const filed = item({ apply_after_date: null, latest_apply_date: "2026-07-12" });

    it("reports the gate the row loses", () => {
      const notice = movedDeadlineNotice(filed, merged("2026-08-01"), filed, merged(null));
      expect(notice?.dateChange).toBeNull();
      expect(notice?.stateChange?.previous.gated).toBe(true);
      expect(notice?.stateChange?.current.gated).toBe(false);
    });

    it("stays silent while every rendered gate is unchanged", () => {
      expect(
        movedDeadlineNotice(filed, merged("2026-08-01"), filed, merged("2026-08-01")),
      ).toBeNull();
      // And the gate's calendar value still moves without reporting one, as it does on the scalar.
      expect(
        movedDeadlineNotice(filed, merged("2026-08-01"), filed, merged("2026-08-09")),
      ).toBeNull();
    });
  });
});
