import { PromoteView } from "./promote-view";
import type { Metadata } from "next";
import "./promote.css";

export const metadata: Metadata = {
  title: "Event page",
};

// Organizer promote controls for F-301 (description, publish toggle, share URL).

export default async function PromotePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:3001";
  // Optional override only — share links default to the browser origin in PromoteView
  // so production is not stuck on localhost when NEXT_PUBLIC_WEB_ORIGIN is unset.
  const webOrigin = process.env.NEXT_PUBLIC_WEB_ORIGIN;
  return <PromoteView eventId={id} apiBaseUrl={apiBaseUrl} webOrigin={webOrigin} />;
}
