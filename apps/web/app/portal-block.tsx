/**
 * F-204 portal block for a plan line or checklist row.
 *
 * Renders only what the published rule carried onto the finding: name, URL, instructions.
 * Never invents a portal, never treats a citation `source.urls` entry as an application path,
 * and never implies PopEngine submits anything — copy is "apply at [portal]", links open in a
 * new tab (AC 2).
 *
 * SPEC-CONFLICT #149 resolved by amending F-204 to drop required documents, DOHMH/SLA portals,
 * and per-facet verification from acceptance until a future ruleset publish. This component still
 * never reads `source.urls`.
 */

export type PortalFields = {
  readonly portalName: string | null;
  readonly portalUrl: string | null;
  readonly portalInstructions: string | null;
};

type PortalBlockProps = PortalFields & {
  /** Class on the "apply at …" paragraph. */
  readonly className: string;
  /** Class on the instructions paragraph when present. */
  readonly instructionsClassName: string;
  /**
   * The words leading the portal paragraph. "apply at" is an instruction to file, and it is right
   * wherever the line has decided that this is the filing. On a candidate route it is not: the
   * intake fields deciding which route applies are still unanswered, and the approved design
   * requires that no candidate entry render as an action (`docs/proposals/dedupe-route-list.md`
   * §5.3). "portal" names the published field instead, which drops the instruction and keeps the
   * rule's own value.
   */
  readonly lead?: "apply at" | "portal";
};

export function PortalBlock({
  portalName,
  portalUrl,
  portalInstructions,
  className,
  instructionsClassName,
  lead = "apply at",
}: PortalBlockProps) {
  const hasPortal = portalName !== null || portalUrl !== null || portalInstructions !== null;
  if (!hasPortal) return null;

  const label = portalName ?? portalUrl;

  return (
    <>
      {label !== null && (
        <p className={className}>
          {portalUrl !== null ? (
            <>
              {lead === "portal" ? "portal: " : "apply at "}
              <a href={portalUrl} target="_blank" rel="noreferrer noopener">
                {portalName ?? portalUrl}
              </a>
            </>
          ) : (
            <>
              {lead === "portal" ? "portal: " : "apply at "}
              {portalName}
            </>
          )}
        </p>
      )}
      {/* THE INSTRUCTIONS ARE THE ACTION, so they go with the lead rather than beside it. "portal"
          is what this component renders where no route is known to be the one, and the rule's own
          instruction — "File in person at the precinct" — is a filing instruction whatever word
          introduces the portal above it. Neutralising the lead and leaving this rendered the
          imperative the swap exists to withhold, on the plan line, on each candidate entry and on
          the checklist row, which is every surface that passes `lead` (#252 review).

          SUPPRESSED RATHER THAN RELABELLED, because a label is new copy and the approved design
          settles only that no candidate entry renders as an action (§5.3). What is not withheld is
          the portal itself: the name still renders above, so the published filing path is still
          named and still linked, and the instruction returns the moment the answers settle. */}
      {portalInstructions !== null && lead !== "portal" && (
        <p className={instructionsClassName}>{portalInstructions}</p>
      )}
    </>
  );
}
