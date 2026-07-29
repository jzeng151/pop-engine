// Verification-status copy that more than one feature renders, in one place.
//
// This string is mandated, not chosen. The published legend in `rules/nyc-rules.v2.9.json` defines
// COVERAGE_GAP as "combination not modeled by this ruleset version; advisory asserts nothing".
// That is a statement about what this ruleset version covers, and it says nothing about whether a
// source exists. The copy this replaced announced that a source had not yet been established, which
// is a different status' meaning: RESEARCH_REQUIRED is "no primary source located in two research
// passes", and it renders as `CONFIRM_WITH_AGENCY`. See SPEC-CONFLICT #145.
//
// Two sentences on purpose. The first states the limit, the second states what that limit means
// for the organizer, because a scope gap the reader cannot act on is not an honest disclosure.
//
// It lives here rather than inline at each site because it is rendered by both the plan line and
// the checklist item, and two copies of a mandated string is how this defect arose in the first
// place. `verification-copy.test.ts` holds it apart from RESEARCH_REQUIRED's rendering so the two
// cannot silently converge again.
import { CONFIRM_WITH_AGENCY } from "@pop-engine/engine";

export const NOT_COVERED_BY_RULESET =
  "Not covered by this ruleset version. This plan may be incomplete for your event.";

export const includesAgencyConfirmation = (
  renderedProse: readonly (string | null | undefined)[],
): boolean => renderedProse.some((text) => text?.includes(CONFIRM_WITH_AGENCY));
