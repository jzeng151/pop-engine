// Contact details as DESTINATIONS rather than as typed.
//
// Two callers need the same answer for different reasons, which is why this is its own module
// rather than one importing the other. `rsvps.ts` normalizes a guest's number before storing it,
// and `alerts.ts` needs the same canonical form because `idempotency_key` hashes the destination:
// a number retyped as `+1 (212) 555-0100` rather than `+12125550100` reads as a different
// destination, mints a replacement set of alerts, and re-sends every already-due SMS. Alerts
// importing from the RSVP module to get it would put a dependency between two features that only
// share a helper.

/**
 * A phone number reduced to the digits that identify it, or null when none was given.
 *
 * The ok/message shape is kept exactly as it was: `rsvps.ts` reports the failure to its caller, and
 * moving the function must not change what that endpoint accepts.
 */
export function normalizeOptionalPhone(
  raw: unknown,
): { ok: true; phone: string | null } | { ok: false; message: string } {
  if (raw === undefined || raw === null || raw === "") {
    return { ok: true, phone: null };
  }
  if (typeof raw !== "string") {
    return { ok: false, message: "phone must be a string" };
  }
  const digits = raw.trim().replace(/\D/g, "");
  if (digits.length < 10) {
    return { ok: false, message: "phone must be a valid number when provided" };
  }
  return { ok: true, phone: digits };
}

/**
 * The same canonical form for a stored alert destination, WITHOUT imposing validation.
 *
 * The alert contact path has never rejected a number and this is not the round to start: the
 * checklist endpoint accepts what the organizer types, and turning a formatting difference into a
 * 400 is a policy the intake does not enforce. So a number that cannot be normalized is stored as
 * typed rather than refused. What that costs is stated rather than hidden: two spellings of a
 * number too short to normalize still read as two destinations. What it buys is that every number
 * the product would actually dial reads as one.
 */
export const canonicalOptionalPhone = (raw: string | null): string | null => {
  const normalized = normalizeOptionalPhone(raw);
  return normalized.ok ? normalized.phone : raw;
};
