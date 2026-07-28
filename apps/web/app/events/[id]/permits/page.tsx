import { ObtainedPermitsView } from "../../../permits/permits-view";

// DEMO SCOPE. The obtained-permits route. Not F-208; it will be superseded by it.
//
// Fetched from the browser, like the checklist route, because the Cloudflare Access cookie is the
// browser's and not this server's (BASELINE.md provider baseline).
export default async function ObtainedPermitsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:3001";
  return <ObtainedPermitsView apiBaseUrl={apiBaseUrl} eventId={id} />;
}
