"use client";

import { useId, useState, type ReactNode } from "react";

/** A per-item expand, for progressive disclosure that hides nothing. */
export function Disclosure({
  label,
  ariaLabel,
  children,
  className,
  defaultOpen = false,
  onOpenChange,
}: {
  /**
   * What this expands, named. "Details for Block Party Permit", never "more": a screen-reader user
   * moving by control hears a list of buttons with no page context, and eight buttons all reading
   * "more" name nothing.
   */
  readonly label: string;
  readonly ariaLabel?: string;
  readonly children: ReactNode;
  readonly className?: string;
  readonly defaultOpen?: boolean;
  readonly onOpenChange?: (open: boolean) => void;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const regionId = useId();

  return (
    <div className={className === undefined ? "disclosure" : `disclosure ${className}`}>
      <button
        type="button"
        className="disclosure__toggle"
        aria-label={ariaLabel}
        aria-expanded={open}
        aria-controls={regionId}
        onClick={() => {
          setOpen(!open);
          onOpenChange?.(!open);
        }}
      >
        {/* Decoration only: `aria-expanded` above is what conveys the state. Hidden from the
            accessibility tree so it is not read as content. */}
        <span className="disclosure__marker" aria-hidden="true">
          {open ? "▾" : "▸"}
        </span>
        {label}
      </button>
      {/* Unmounted rather than hidden when closed, so a collapsed line's detail fields are not in
          the accessibility tree, not focusable, and not found by a text search of the page. A
          visually hidden block would still be all three. */}
      {open && (
        <div className="disclosure__panel" id={regionId}>
          {children}
        </div>
      )}
    </div>
  );
}
