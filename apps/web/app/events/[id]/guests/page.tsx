import { GuestListView } from "./guest-list";
import type { Metadata } from "next";
import "./guests.css";

export const metadata: Metadata = {
  title: "Guests",
};

// Organizer guest list for F-302. Public RSVP UI lives on the published F-301 page.

export default async function GuestsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:3001";
  return <GuestListView eventId={id} apiBaseUrl={apiBaseUrl} />;
}
