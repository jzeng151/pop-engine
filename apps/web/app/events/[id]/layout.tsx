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
    <EventWorkspace apiBaseUrl={process.env.API_BASE_URL ?? "http://localhost:3001"} eventId={id}>
      {children}
    </EventWorkspace>
  );
}
