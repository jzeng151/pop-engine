import { ChecklistView } from "../../../checklist/checklist-view";
import type { Metadata } from "next";
import "../../../checklist/checklist.css";

export const metadata: Metadata = {
  title: "Compliance checklist",
};

// The checklist route (F-202).
export default async function ChecklistPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:3001";
  return <ChecklistView apiBaseUrl={apiBaseUrl} eventId={id} />;
}
