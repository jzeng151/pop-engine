"use client";

import { useId, useState, type ReactNode } from "react";

/**
 * A per-item expand, for progressive disclosure that hides nothing.
 *
 * Every field a line rendered before still renders; the split is only between what is visible
 * before an interaction and what is one interaction away. Scenario F produces eight findings of
 * twenty-three rendered blocks each, which is a page an organizer scrolls rather than reads.
 *
 * A NATIVE BUTTON, deliberately. It is focusable, Enter and Space activate it, and screen readers
 * announce it as a button, all without a keydown handler to get wrong. `aria-expanded` carries the
 * state programmatically, so the triangle and any colour are decoration rather than the only signal
 * (the specs require this and the demo is judged on it).
 *
 * `<details>`/`<summary>` was the other candidate and is not used: its open state is not reliably
 * announced across the assistive-technology matrix this project cannot test against, and a
 * controlled button plus `aria-expanded` is the pattern with no such ambiguity.
 */
export function Disclosure({
  label,
  children,
  className,
  defaultOpen = false,
}: {
  /**
   * What this expands, named. "Details for Block Party Permit", never "more": a screen-reader user
   * moving by control hears a list of buttons with no page context, and eight buttons all reading
   * "more" name nothing.
   */
  readonly label: string;
  readonly children: ReactNode;
  readonly className?: string;
  readonly defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const regionId = useId();

  return (
    <div className={className === undefined ? "disclosure" : `disclosure ${className}`}>
      <button
        type="button"
        className="disclosure__toggle"
        aria-expanded={open}
        aria-controls={regionId}
        onClick={() => setOpen((wasOpen) => !wasOpen)}
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
