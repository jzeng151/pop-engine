import { CheckinForm } from "./checkin-form";
import type { Metadata } from "next";
import "./checkin.css";

export const metadata: Metadata = {
  title: "Check in",
};

// Mobile check-in target for the printed QR (`/e/:eventId/checkin`, F-401).
// The Access cookie is the browser's, so the form loads the event client-side.

export default async function CheckinPage({ params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = await params;
  const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:3001";
  return <CheckinForm eventId={eventId} apiBaseUrl={apiBaseUrl} />;
}
