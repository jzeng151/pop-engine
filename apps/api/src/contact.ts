// Contact details as DESTINATIONS rather than as typed.

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

/** The same canonical form for a stored alert destination, WITHOUT imposing validation. */
export const canonicalOptionalPhone = (raw: string | null): string | null => {
  const normalized = normalizeOptionalPhone(raw);
  return normalized.ok ? normalized.phone : raw;
};
