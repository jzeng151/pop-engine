import { DashboardView } from "./dashboard-view";
import type { Metadata } from "next";
import "./dashboard.css";

export const metadata: Metadata = {
  title: "Live ops",
};

// Organizer live-ops dashboard for F-402. Polled check-in totals (arrivals only).

export default async function DashboardPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:3001";
  return <DashboardView eventId={id} apiBaseUrl={apiBaseUrl} />;
}
