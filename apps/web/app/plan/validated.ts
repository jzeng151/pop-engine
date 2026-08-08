// Validating what this feature reads, without a list that can drift out of step with it.
//
// F-206 took four review findings of one shape: a field was read that nothing had validated. Each
// round validated the field it was told about, and the next round found another — `generatedAt`
// (`.slice()` on undefined), `eventRevision` (a non-number makes `current > pinned` false, so an
// edited event renders as CURRENT with nothing thrown and nothing logged), `verdict` (an unknown
// token renders an empty verdict line), then a finding's `verificationStatus` (`.toLowerCase()` on
// undefined) and an event's `revision_counter` (the silent-false case again). Enumerating the fifth
// would have invited a sixth: a hand-written list of validated fields is a second copy of "what the
// page reads", and the two drift the moment someone reads a new field.
//
// So coverage is not listed. It is derived, and the derivation closes in both directions:
//
//   1. The consumed types (`PlanResponse`, `ConsumedFinding`, `ConsumedEvent`) are the only shapes
//      this feature can see, and they contain exactly the fields it reads. Reading anything else
//      does not compile.
//   2. `FieldChecks<T>` is mapped over `keyof T` with `-?`, so a field present in one of those
//      types with no runtime check does not compile either.
//
// A future field therefore cannot be consumed without being validated: adding the read fails on (1)
// until the type carries it, and carrying it fails on (2) until a check exists. `pnpm typecheck` is
// a CI step, so this is enforced on every push rather than caught in review — which is what the four
// rounds show review does not reliably do.
//
// What this deliberately does NOT do is police fields nothing reads. Those are absent from the
// consumed types on purpose: refusing a body over a field the page never touches would reject a plan
// it renders correctly, and a finding's remaining members are the engine's schema to police rather
// than the client's. Both are boundaries F-206 set; the change is that they are now enforced by the
// types instead of asserted in a comment.

/**
 * One runtime check per field of `T`, and each check must PROVE that field's declared type.
 *
 * Two guarantees, not one. Mapped over `keyof T` with `-?`, so every field is required: a field in a
 * consumed type with no check is a compile error, and a check for a field not in the type is one too.
 * And the check is a type predicate over `T[K]`, not a bare `boolean`, so a check that proves the
 * wrong type is also a compile error — if a field's type changes upstream, the check stops
 * compiling instead of quietly going on rejecting valid bodies or accepting obsolete ones.
 */
export type FieldChecks<T> = {
  readonly [K in keyof T]-?: (value: unknown) => value is T[K];
};

export const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

/**
 * Applies a complete set of field checks to an untrusted body. The cast is sound rather than
 * asserted: `FieldChecks<T>` is exhaustive over `keyof T` and every check proves its own field.
 */
export function readChecked<T>(checks: FieldChecks<T>, body: unknown): T | null {
  const record = asRecord(body);
  if (record === null) return null;
  for (const field of Object.keys(checks)) {
    const check = (checks as Record<string, (value: unknown) => boolean>)[field];
    if (check !== undefined && !check(record[field])) return null;
  }
  return record as T;
}

/** A nested shape, checked by the same exhaustive mechanism as the body that contains it. */
export const shapedLike =
  <T>(checks: FieldChecks<T>) =>
  (value: unknown): value is T =>
    readChecked(checks, value) !== null;

export const isString = (value: unknown): value is string => typeof value === "string";

/**
 * `NaN` and the infinities are not guarded against: they cannot arrive here. Every body this runs on
 * comes from `response.json()`, and JSON has no encoding for them — `JSON.stringify` writes `null`,
 * which this rejects. A `Number.isFinite` call would be a guard against a value the transport cannot
 * deliver, and there would be no way to write a test that fails without it.
 */
export const isNumber = (value: unknown): value is number => typeof value === "number";

export const nullOr =
  <T>(check: (value: unknown) => value is T) =>
  (value: unknown): value is T | null =>
    value === null || check(value);

/**
 * A field an api build older than this page does not send yet.
 *
 * Distinct from `nullOr`, and the distinction is what it lets a caller say: null is an answer the
 * api gave, absent is one it has not learned to give. A reader of an absent field must not turn it
 * into a value — the notices that consume one say what they said before rather than claiming
 * either way. Narrow on purpose: each use names the rollout it exists for.
 */
export const absentOr =
  <T>(check: (value: unknown) => value is T) =>
  (value: unknown): value is T | undefined =>
    value === undefined || check(value);

export const arrayOf =
  <T>(check: (value: unknown) => value is T) =>
  (value: unknown): value is readonly T[] =>
    Array.isArray(value) && value.every(check);

/**
 * A list the wire contract says is present-or-null and never shorter than `minimum`, enforced rather
 * than documented.
 *
 * `every` is vacuously true on an empty array, so an empty list is not a harmless degenerate case
 * here: it is the one value that answers every question asked of it in the affirmative. A finding
 * carrying `routes: []` passed the shape check and then told `hasOnlyUndatedDeadlines` that all of
 * its routes were undated, printing "No dated deadlines identified." on a FEASIBLE plan beside a
 * line showing a date (#252 review).
 *
 * A SHORT LIST IS THE SAME DEFECT ONE ENTRY LATER, which is why the bound is a parameter. `routes`
 * is published only for a finding that MERGED, so its contract minimum is two, and every consumer
 * already tests `length > 1` before reading a line as merged — `candidateRoutesOf` and `Routes` on
 * the plan, the deciding-question guard on the checklist row. A one-entry list therefore passed the
 * shape check and was then read as unmerged, so a `candidate` line fell back to the permit heading
 * and never showed the deciding question, presenting an incomplete route set as a complete line
 * (#252 review). A shape the contract says cannot exist is rejected here, not reinterpreted
 * downstream, so a reader never has to guess which of "no routes" and "unmerged" a short list meant.
 */
export const atLeast =
  <T>(minimum: number, check: (value: unknown) => value is readonly T[]) =>
  (value: unknown): value is readonly T[] =>
    check(value) && value.length >= minimum;

/**
 * A token set that cannot fall behind the engine's union, and that carries the union it came from so
 * `isToken` proves the right one. `Record<Union, true>` is exhaustive, so adding a member to
 * `Verdict` or `VerificationStatus` upstream breaks the caller until it is listed; the phantom
 * `union` marker is what stops a set being paired with a different union than it was built for.
 */
export type TokenSet<Union extends string> = ReadonlySet<string> & {
  readonly union?: Union;
};

export const tokensOf = <Union extends string>(
  members: Readonly<Record<Union, true>>,
): TokenSet<Union> => new Set(Object.keys(members)) as TokenSet<Union>;

export const isToken =
  <Union extends string>(tokens: TokenSet<Union>) =>
  (value: unknown): value is Union =>
    typeof value === "string" && tokens.has(value);
