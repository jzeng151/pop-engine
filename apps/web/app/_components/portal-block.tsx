/** F-204 portal block for a plan line or checklist row. */

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
  /** The words leading the portal paragraph. */
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
