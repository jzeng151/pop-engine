/**
 * The exports of `spec-conflict-scan.mjs` that TYPESCRIPT callers use.
 *
 * The scanner is JavaScript because it runs as CI's own guard with no build step, and the suites
 * that drive it are `.mjs` for the same reason. `apps/api/src/rsvps.test.ts` is the one TypeScript
 * caller, and it exists because the classification below is a REGULATORY question that must not be
 * answered twice: a rule belongs to the city health agency by its published agency as well as by
 * its id, and a second copy of that test in a `.ts` file is a second answer that can drift.
 *
 * This file declares only what that caller imports. It is not type-checked against the scanner, so
 * a renamed export fails at runtime rather than at `tsc`; the importing suite is what catches it.
 */

/** A published rule or advisory, as it is written in `rules/nyc-rules.v2.11.json`. */
export interface PublishedRuleShape {
  id?: string;
  output?: { agency?: string | null } | null;
}

/** The rule id or published agency that makes a rule the city health agency's. */
export declare const cityHealthRule: (rule: PublishedRuleShape) => boolean;
