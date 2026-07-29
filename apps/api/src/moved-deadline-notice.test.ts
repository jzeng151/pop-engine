import { describe, expect, it } from "vitest";
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
});
