// PROPOSAL ARTIFACT — not shipped code, not part of any package, imported by no runtime.
// `docs/proposals/tsconfig.json` type-checks it; `scripts/spec-conflict-resolutions.test.mjs`
// reads it. Nothing else may import it until F-103 and F-502 are APPROVED and a consuming
// feature moves the membership into the package that implements the metric.
import type { Disposition, FindingKind, VerificationStatus } from "../../packages/engine/src/types";

/**
 * `permit-burden/v1` — the membership sets behind the shared product metric that
 * `specs/F-103-scope-comparator.md` defines and `specs/F-502-historical-event-comparison.md`
 * consumes unchanged. Both specs are PROPOSED.
 *
 * These lived in the spec's prose until 2026-08-03, with a guard that parsed that prose to check
 * the sets partitioned the engine's enumerations. The guard was repaired four times — it read only
 * the first list item, then matched substrings, then compared sets one way, then collapsed
 * duplicates — because prose admits unbounded shapes that satisfy any one parsing rule while
 * breaking the invariant. Declaring the sets makes the check set equality against the types below
 * and removes the parser entirely.
 *
 * They lived in `packages/engine/src/permit-burden.ts` for one day, until review pointed out that
 * an engine export makes an undecided membership part of `@pop-engine/engine`'s public runtime API,
 * so a consumer could depend on semantics the approval process may still change. The declaration
 * moved here on 2026-08-03: a proposal artifact belongs to the proposal, and the engine exports
 * nothing new. The engine's types are imported type-only, so this file adds no runtime edge in
 * either direction.
 *
 * The spec still decides what belongs in each set and why; this file only states the membership it
 * decided, so `docs/DOCUMENTATION-GOVERNANCE.md` §1 authority is unchanged. The exhaustive
 * `satisfies` annotations are what make a new engine member a compile error here rather than a
 * silent omission from an organizer's burden.
 */

/** Kinds whose findings enter the burden count. */
export const BURDEN_COUNTED_KINDS = [
  "permit",
  "insurance",
  "notification",
  "registration",
  "eligibility",
  "prohibition",
  "dependency",
] as const;

/** Kinds that never enter it: they raise no requirement to carry. */
export const BURDEN_EXCLUDED_KINDS = ["advisory", "note"] as const;

/** Dispositions whose findings enter the count. */
export const BURDEN_COUNTED_DISPOSITIONS = [
  "required",
  "may_be_required",
  "prohibited_or_ineligible",
] as const;

/** Dispositions that never enter it. */
export const BURDEN_EXCLUDED_DISPOSITIONS = ["advisory", "no_new_requirement"] as const;

/** Verification statuses under which a counted finding is definite. */
export const BURDEN_DEFINITE_STATUSES = ["SOURCE_CONFIRMED", "VERIFIED"] as const;

/** Verification statuses under which a counted finding is unresolved; unresolved wins ties. */
export const BURDEN_UNRESOLVED_STATUSES = [
  "OFFICIAL_CONFLICT",
  "RESEARCH_REQUIRED",
  "COVERAGE_GAP",
] as const;

// Every member named above must be a real engine member. A typo or an invented token fails to
// compile rather than reaching the guard as a plausible-looking string.
const _kinds = [...BURDEN_COUNTED_KINDS, ...BURDEN_EXCLUDED_KINDS] satisfies readonly FindingKind[];
const _dispositions = [
  ...BURDEN_COUNTED_DISPOSITIONS,
  ...BURDEN_EXCLUDED_DISPOSITIONS,
] satisfies readonly Disposition[];
const _statuses = [
  ...BURDEN_DEFINITE_STATUSES,
  ...BURDEN_UNRESOLVED_STATUSES,
] satisfies readonly VerificationStatus[];
void _kinds;
void _dispositions;
void _statuses;
