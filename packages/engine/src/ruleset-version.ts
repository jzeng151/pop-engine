// How two ruleset versions stand relative to one another.
//
// Pure string math on a published identifier, so it satisfies the engine's purity invariant and
// lives here for the reason the intake contract does (AD-8): apps/api and apps/web both have to
// order these values, and two implementations of an ordering is two answers to "is this a
// downgrade". The F-206 snapshot banner and the F-201 generation guard read the same one.

/**
 * `nyc.vMAJOR.MINOR` is the only ruleset version shape BASELINE.md declares, so the parts are
 * parsed and compared as numbers. String comparison would order v2.10 below v2.9.
 */
const RULESET_VERSION = /^([a-z-]+)\.v(\d+)\.(\d+)$/;

type ParsedVersion = { jurisdiction: string; major: number; minor: number };

export function parseRulesetVersion(version: string): ParsedVersion | null {
  const parsed = RULESET_VERSION.exec(version);
  if (parsed === null) return null;
  return {
    jurisdiction: parsed[1] ?? "",
    major: Number(parsed[2]),
    minor: Number(parsed[3]),
  };
}

/**
 * How the service's live ruleset stands relative to the one a plan pinned.
 *
 * "different" covers a version either side cannot be parsed, and versions from two different
 * jurisdictions, because neither can be ordered. A rollback is a real operation now that three
 * versions are published, and telling an organizer to regenerate onto an OLDER ruleset would
 * downgrade their plan — so directional copy is only used when the direction is actually known.
 */
export function compareToPinned(
  live: string,
  pinned: string,
): "same" | "newer" | "older" | "different" {
  // Parsed before the strings are compared: two artifacts both labelled `draft` are two unknown
  // artifacts, and a reused label says nothing about their regulatory content. Equality is only
  // trusted for identifiers in the published format.
  const liveVersion = parseRulesetVersion(live);
  const pinnedVersion = parseRulesetVersion(pinned);
  if (
    liveVersion === null ||
    pinnedVersion === null ||
    liveVersion.jurisdiction !== pinnedVersion.jurisdiction
  ) {
    return "different";
  }
  if (live === pinned) return "same";
  if (liveVersion.major !== pinnedVersion.major) {
    return liveVersion.major > pinnedVersion.major ? "newer" : "older";
  }
  if (liveVersion.minor === pinnedVersion.minor) return "different";
  return liveVersion.minor > pinnedVersion.minor ? "newer" : "older";
}
