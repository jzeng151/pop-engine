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
};

export function PortalBlock({
  portalName,
  portalUrl,
  portalInstructions,
  className,
  instructionsClassName,
}: PortalBlockProps) {
  const hasPortal =
    portalName !== null || portalUrl !== null || portalInstructions !== null;
  if (!hasPortal) return null;

  const label = portalName ?? portalUrl;

  return (
    <>
      {label !== null && (
        <p className={className}>
          {portalUrl !== null ? (
            <>
              apply at{" "}
              <a href={portalUrl} target="_blank" rel="noreferrer noopener">
                {portalName ?? portalUrl}
              </a>
            </>
          ) : (
            <>apply at {portalName}</>
          )}
        </p>
      )}
      {portalInstructions !== null && (
        <p className={instructionsClassName}>{portalInstructions}</p>
      )}
    </>
  );
}
