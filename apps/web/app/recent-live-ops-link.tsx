"use client";

import { useEffect, useState } from "react";
import { readLastEvent } from "./last-event";

/**
 * Deep-link to Live ops for the intake event this browser last opened on the door dashboard.
 * Bound to the organizer's own event id — not a generic demo template.
 */
export function RecentLiveOpsLink() {
  const [recent, setRecent] = useState<{ id: string; name: string } | null>(null);

  useEffect(() => {
    setRecent(readLastEvent());
  }, []);

  if (recent === null) return null;

  return (
    <p className="home__recent">
      <a className="home__recent-link" href={`/events/${recent.id}/dashboard`}>
        Live ops · {recent.name}
      </a>
    </p>
  );
}
