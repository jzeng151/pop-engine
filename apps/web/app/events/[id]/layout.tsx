import type { ReactNode } from "react";

import { EventWorkspace } from "./event-workspace";

export default async function EventLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return (
    <EventWorkspace
      apiBaseUrl={process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:3001"}
      eventId={id}
      hidePlannedModules={process.env.NEXT_PUBLIC_HIDE_PLANNED_MODULES === "true"}
    >
      {children}
    </EventWorkspace>
  );
}
