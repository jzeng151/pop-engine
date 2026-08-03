"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";

import { loadEvent } from "../../intake/events-api";
import { ThemeToggle } from "../../theme-toggle";

type EventWorkspaceProps = {
  apiBaseUrl: string;
  children: ReactNode;
  eventId: string;
};

const navigationGroups = [
  {
    label: "Ideate",
    items: [
      {
        icon: "overview",
        path: (eventId: string) => `/events/${eventId}`,
        label: "Overview",
      },
      {
        icon: "intake",
        path: (eventId: string) => `/intake/${eventId}`,
        label: "Event intake",
      },
    ],
  },
  {
    label: "Comply",
    items: [
      {
        icon: "plan",
        path: (eventId: string) => `/events/${eventId}/plan`,
        label: "Permit plan",
      },
      {
        icon: "checklist",
        path: (eventId: string) => `/events/${eventId}/checklist`,
        label: "Checklist",
      },
    ],
  },
  {
    label: "Market",
    items: [
      {
        icon: "promote",
        path: (eventId: string) => `/events/${eventId}/promote`,
        label: "Event page",
      },
      {
        icon: "guests",
        path: (eventId: string) => `/events/${eventId}/guests`,
        label: "Guests",
      },
    ],
  },
  {
    label: "Operate",
    items: [
      {
        icon: "checkin",
        path: (eventId: string) => `/e/${eventId}/checkin`,
        label: "Check-in",
      },
      {
        icon: "live",
        path: (eventId: string) => `/events/${eventId}/dashboard`,
        label: "Live ops",
      },
    ],
  },
] as const;

type NavigationIcon = (typeof navigationGroups)[number]["items"][number]["icon"];

function NavIcon({ icon }: { icon: NavigationIcon }) {
  const shared = {
    fill: "none",
    stroke: "currentColor",
    strokeLinecap: "square" as const,
    strokeLinejoin: "miter" as const,
    strokeWidth: 1.7,
  };

  return (
    <svg aria-hidden="true" className="riso-nav__icon" viewBox="0 0 24 24">
      {icon === "overview" && (
        <>
          <circle cx="12" cy="10" r="5.5" {...shared} />
          <path d="M9 16.5h6M10 20h4M5 10H2.5M21.5 10H19M12 2.5V1" {...shared} />
        </>
      )}
      {icon === "intake" && (
        <>
          <path d="M5 2.5h10l4 4v15H5zM15 2.5v4h4M8 11h8M8 15h8M8 19h5" {...shared} />
        </>
      )}
      {icon === "plan" && (
        <>
          <path d="M7 4h10v3h3v15H4V7h3zM8 12h8M8 16h8M8 20h5" {...shared} />
          <path d="M9 2h6v5H9z" {...shared} />
        </>
      )}
      {icon === "checklist" && (
        <path d="M3 4h18v18H3zM7 9l2 2 4-5M7 16l2 2 4-5M15 9h3M15 16h3" {...shared} />
      )}
      {icon === "promote" && (
        <path d="M3 11v5h4l8 4V6l-8 5zM15 9l5-2v12l-5-2M7 16l1.5 5" {...shared} />
      )}
      {icon === "guests" && (
        <>
          <circle cx="9" cy="8" r="3.5" {...shared} />
          <circle cx="17" cy="10" r="2.5" {...shared} />
          <path d="M2.5 21c0-4 2.5-6.5 6.5-6.5s6.5 2.5 6.5 6.5M14 15c4 0 6.5 2 6.5 6" {...shared} />
        </>
      )}
      {icon === "checkin" && (
        <path d="M3 8V3h5M16 3h5v5M21 16v5h-5M8 21H3v-5M6 12h12" {...shared} />
      )}
      {icon === "live" && <path d="M2 13h4l2-6 4 12 3-9 2 3h5" {...shared} />}
    </svg>
  );
}

const plannedModules = [
  "Applications",
  "Calendar",
  "Runbook",
  "Team",
  "Insights",
  "AI assistant",
  "Rules admin",
] as const;

function WorkspaceNavigation({ eventId, pathname }: { eventId: string; pathname: string }) {
  return (
    <nav aria-label="Event lifecycle" className="riso-nav__groups">
      {navigationGroups.map((group) => (
        <section className="riso-nav__group" key={group.label}>
          <h2>{group.label}</h2>
          <ul>
            {group.items.map((item) => {
              const href = item.path(eventId);
              const active =
                href === `/events/${eventId}` ? pathname === href : pathname.startsWith(href);

              return (
                <li key={item.label}>
                  <a aria-current={active ? "page" : undefined} href={href}>
                    <span className="riso-nav__link-label">
                      <NavIcon icon={item.icon} />
                      {item.label}
                    </span>
                  </a>
                </li>
              );
            })}
          </ul>
        </section>
      ))}

      <section className="riso-nav__group riso-nav__group--planned">
        <h2>Planned</h2>
        <ul>
          {plannedModules.map((module) => (
            <li key={module}>
              {/* The PLANNED stamp is the group's, not each button's — `docs/DESIGN-SYSTEM.md`
                  publishes one clipped insert stamped once, and F-705 AC 5 defers to it. */}
              <button disabled type="button">
                <span>{module}</span>
              </button>
            </li>
          ))}
        </ul>
      </section>
    </nav>
  );
}

export function EventWorkspace({ apiBaseUrl, children, eventId }: EventWorkspaceProps) {
  const pathname = usePathname();
  const [eventName, setEventName] = useState("Event workspace");
  const [loadState, setLoadState] = useState<"loading" | "ready" | "unavailable">("loading");

  useEffect(() => {
    let mounted = true;

    void loadEvent(apiBaseUrl, eventId).then((result) => {
      if (!mounted) return;

      if (!result.ok) {
        setLoadState("unavailable");
        return;
      }

      // F-705 state table: `ready` means the event responded with a name. A blank or absent one is
      // `unavailable` — the same state as a failed read, because the placeholder on screen is the
      // same placeholder and calling it `ready` would report it as the event's name.
      const loadedName = result.loaded.event.name;
      if (typeof loadedName !== "string" || loadedName.trim().length === 0) {
        setLoadState("unavailable");
        return;
      }
      setEventName(loadedName.trim());
      setLoadState("ready");
    });

    return () => {
      mounted = false;
    };
  }, [apiBaseUrl, eventId]);

  return (
    <div className="riso-workspace">
      <a className="pe-skip-link" href="#event-workspace-content">
        Skip to event content
      </a>

      <aside className="riso-nav">
        <div className="riso-nav__brand riso-nav__brand--desktop">
          <a href="/">PopEngine</a>
          <span>Field guide</span>
        </div>

        <details className="riso-nav__mobile">
          <summary>
            <span className="riso-nav__brand">
              <strong>PopEngine</strong>
              <span>Field guide</span>
            </span>
            <span aria-hidden="true">Menu</span>
          </summary>
          <WorkspaceNavigation eventId={eventId} pathname={pathname} />
        </details>

        <div className="riso-nav__desktop">
          <WorkspaceNavigation eventId={eventId} pathname={pathname} />
        </div>
      </aside>

      <div className="riso-workspace__paper">
        <header className="riso-masthead">
          <div>
            <p className="riso-masthead__label">Active event</p>
            <p aria-live="polite" className="riso-masthead__event" data-load-state={loadState}>
              {eventName}
            </p>
          </div>
          <div className="riso-masthead__controls">
            <ThemeToggle />
            <p className="riso-masthead__mode">Synthetic data demo</p>
          </div>
        </header>

        <div id="event-workspace-content" tabIndex={-1}>
          {children}
        </div>
      </div>
    </div>
  );
}
