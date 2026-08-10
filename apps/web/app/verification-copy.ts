// Verification-status copy that more than one feature renders, in one place.
import { CONFIRM_WITH_AGENCY } from "@pop-engine/engine";

export const NOT_COVERED_BY_RULESET =
  "Not covered by this ruleset version. This plan may be incomplete for your event.";

export const includesAgencyConfirmation = (
  renderedProse: readonly (string | null | undefined)[],
): boolean => renderedProse.some((text) => text?.includes(CONFIRM_WITH_AGENCY));
