import { describe, expect, it } from "vitest";
import type { ConsumedFinding } from "./plan-api";
import {
  hasOnlyUndatedDeadlines,
  isNearEmptyPlan,
  isIdentifiedCityEventRequirement,
} from "./plan-framing";

const finding = (overrides: Partial<ConsumedFinding>): ConsumedFinding => ({
  ruleIds: ["X"],
  kind: "permit",
  disposition: "required",
  name: null,
  agency: null,
  deadline: null,
  deadlineDisplay: null,
  latestApplyDate: null,
  applyAfterDate: null,
  deadlineStatus: "not_applicable",
  feeDisplay: null,
  portalName: null,
  portalUrl: null,
  portalInstructions: null,
  notes: [],
  noteText: null,
  deadlineUnknownFields: [],
  timelineUnresolvedReason: null,
  conflictText: null,
  sources: [],
  verificationStatus: "SOURCE_CONFIRMED",
  lastVerifiedDate: null,
  ...overrides,
});

describe("isNearEmptyPlan / isIdentifiedCityEventRequirement", () => {
  it("treats an empty plan as near-empty", () => {
    expect(isNearEmptyPlan([])).toBe(true);
  });

  it("keeps Scenario B confirmations as near-empty", () => {
    expect(
      isNearEmptyPlan([
        finding({
          ruleIds: ["DOHMH-VENDOR-PERMIT-001"],
          kind: "permit",
          disposition: "required",
          deadlineStatus: "not_calculable",
        }),
        finding({
          ruleIds: ["DOHMH-ORGANIZER-NOTIFY-001"],
          kind: "notification",
          disposition: "may_be_required",
          deadlineStatus: "published_deadline_missed",
        }),
        finding({
          ruleIds: ["ADV-VENUE-OCCUPANCY-001"],
          kind: "advisory",
          disposition: "advisory",
          deadlineStatus: "not_applicable",
        }),
      ]),
    ).toBe(true);
  });

  it("rejects a dated may-be permit (Scenario F shape)", () => {
    expect(
      isIdentifiedCityEventRequirement(
        finding({
          kind: "permit",
          disposition: "may_be_required",
          deadlineStatus: "deadline_approaching",
        }),
      ),
    ).toBe(true);
    expect(
      isNearEmptyPlan([
        finding({
          kind: "permit",
          disposition: "may_be_required",
          deadlineStatus: "on_track",
        }),
      ]),
    ).toBe(false);
  });

  it("rejects required insurance and official conflicts", () => {
    expect(
      isIdentifiedCityEventRequirement(
        finding({ kind: "insurance", disposition: "required", deadlineStatus: "not_applicable" }),
      ),
    ).toBe(true);
    expect(
      isIdentifiedCityEventRequirement(
        finding({
          disposition: "may_be_required",
          verificationStatus: "OFFICIAL_CONFLICT",
          deadlineStatus: "not_applicable",
        }),
      ),
    ).toBe(true);
  });
});

describe("hasOnlyUndatedDeadlines", () => {
  it("is true for empty and for only not_applicable / not_calculable", () => {
    expect(hasOnlyUndatedDeadlines([])).toBe(true);
    expect(
      hasOnlyUndatedDeadlines([
        finding({ deadlineStatus: "not_applicable" }),
        finding({ deadlineStatus: "not_calculable" }),
      ]),
    ).toBe(true);
  });

  it("is false when any dated status appears", () => {
    expect(hasOnlyUndatedDeadlines([finding({ deadlineStatus: "on_track" })])).toBe(false);
  });
});
