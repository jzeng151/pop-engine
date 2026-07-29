// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { MovedDeadlineNotice } from "./checklist-api";
import { MovedDeadlineNoticeBlock } from "./moved-deadline-notice";

afterEach(cleanup);

const provenance = {
  verificationStatus: "SOURCE_CONFIRMED" as const,
  lastVerifiedDate: null,
  sources: [],
  sourceUrl: null,
  conflictText: null,
  rulesetVersion: "test.v1",
  snapshotDate: "2026-07-20",
};

const noticeOf = (overrides: Partial<MovedDeadlineNotice>): MovedDeadlineNotice => ({
  dateChange: null,
  stateChange: null,
  previousProvenance: provenance,
  rulesetVersionsDiffer: false,
  previousRulesetVersion: "test.v1",
  currentRulesetVersion: "test.v1",
  ...overrides,
});

describe("MovedDeadlineNoticeBlock", () => {
  it("names stored deadline field deltas while both sides stay not calculable", () => {
    render(
      <MovedDeadlineNoticeBlock
        notice={noticeOf({
          stateChange: {
            previous: {
              deadlineStatus: "not_calculable",
              deadline: {
                type: "business_days_minimum",
                businessDays: 10,
                display: null,
                boundary: "inclusive",
                qualification: null,
              },
              deadlineDisplay: null,
              timelineUnresolvedReason: null,
              deadlineUnknownFields: [],
              gated: false,
            },
            current: {
              deadlineStatus: "not_calculable",
              deadline: {
                type: "business_days_minimum",
                businessDays: 15,
                display: null,
                boundary: "inclusive",
                qualification: "confirm with agency",
              },
              deadlineDisplay: null,
              timelineUnresolvedReason: null,
              deadlineUnknownFields: [],
              gated: false,
            },
          },
        })}
      />,
    );

    const notice = screen.getByTestId("moved-deadline-notice");
    expect(notice.textContent).toContain("businessDays: previous 10; current 15");
    expect(notice.textContent).toContain(
      "qualification: previous none; current confirm with agency",
    );
    expect(notice.textContent).not.toContain("previous not calculable; current not calculable");
  });

  it("does not report countdown-status progression as a deadline-state delta", () => {
    render(
      <MovedDeadlineNoticeBlock
        notice={noticeOf({
          stateChange: {
            previous: {
              deadlineStatus: "on_track",
              deadline: {
                type: "published_minimum",
                calendarDays: 30,
                display: "at least 30 days ahead",
                boundary: "inclusive",
                qualification: null,
              },
              deadlineDisplay: "at least 30 days ahead",
              timelineUnresolvedReason: null,
              deadlineUnknownFields: [],
              gated: false,
            },
            current: {
              // Real AC 9 change: day count moved. Countdown also advanced with the clock.
              deadlineStatus: "deadline_approaching",
              deadline: {
                type: "published_minimum",
                calendarDays: 45,
                display: "at least 45 days ahead",
                boundary: "inclusive",
                qualification: null,
              },
              deadlineDisplay: "at least 45 days ahead",
              timelineUnresolvedReason: null,
              deadlineUnknownFields: [],
              gated: false,
            },
          },
        })}
      />,
    );

    const notice = screen.getByTestId("moved-deadline-notice");
    expect(notice.textContent).toContain("calendarDays: previous 30; current 45");
    expect(notice.textContent).not.toContain("on track");
    expect(notice.textContent).not.toContain("deadline approaching");
    expect(notice.textContent).not.toContain("Deadline state:");
  });

  it("says a legacy previous plan's publication date was not recorded", () => {
    render(
      <MovedDeadlineNoticeBlock
        notice={noticeOf({
          dateChange: {
            kind: "both",
            previous: "2026-07-12",
            current: "2026-08-30",
          },
          previousProvenance: {
            ...provenance,
            snapshotDate: null,
          },
        })}
      />,
    );

    const notice = screen.getByTestId("moved-deadline-notice");
    expect(notice.textContent).toContain("publication date not recorded for that plan");
    expect(notice.textContent).not.toContain("published ");
  });
});
