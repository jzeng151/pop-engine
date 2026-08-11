// Validating what this feature reads, without a list that can drift out of step with it.

/** One runtime check per field of `T`, and each check must PROVE that field's declared type. */
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

/** `NaN` and the infinities are not guarded against: they cannot arrive here. */
export const isNumber = (value: unknown): value is number => typeof value === "number";

export const nullOr =
  <T>(check: (value: unknown) => value is T) =>
  (value: unknown): value is T | null =>
    value === null || check(value);

/** A field an api build older than this page does not send yet. */
export const absentOr =
  <T>(check: (value: unknown) => value is T) =>
  (value: unknown): value is T | undefined =>
    value === undefined || check(value);

export const arrayOf =
  <T>(check: (value: unknown) => value is T) =>
  (value: unknown): value is readonly T[] =>
    Array.isArray(value) && value.every(check);

/** A list the wire contract says is present-or-null and never shorter than `minimum`, enforced rather than documented. */
export const atLeast =
  <T>(minimum: number, check: (value: unknown) => value is readonly T[]) =>
  (value: unknown): value is readonly T[] =>
    check(value) && value.length >= minimum;

/** A token set that cannot fall behind the engine's union, and that carries the union it came from so `isToken` proves the right one. */
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
