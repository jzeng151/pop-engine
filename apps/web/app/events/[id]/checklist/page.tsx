import { ChecklistView } from "../../../checklist/checklist-view";
import type { Metadata } from "next";
import "../../../checklist/checklist.css";

export const metadata: Metadata = {
  title: "Compliance checklist",
};

// The checklist route (F-202). The checklist, its updates and its uploads are all fetched from
// the browser, because the Cloudflare Access cookie is the browser's and not this server's
// (BASELINE.md provider baseline).
export default async function ChecklistPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:3001";
  return <ChecklistView apiBaseUrl={apiBaseUrl} eventId={id} />;
}
