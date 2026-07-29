import { PlanView } from "../../../plan/plan-view";
import "./checklist-entry.css";

// The plan route. The plan and the ruleset meta are both fetched from the browser, because the
// Cloudflare Access cookie is the browser's and not this server's (BASELINE.md provider baseline).
export default async function PlanPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:3001";
  return (
    <>
      <PlanView apiBaseUrl={apiBaseUrl} eventId={id} />
      {/* F-202 AC 1's "one click" needs somewhere to click from, and after generating a plan the
          organizer is here. Nothing else in `apps/web/app` reached the checklist route, so the
          conversion step and the Scenario A demo path were only reachable by typing the URL.

          It lives in the ROUTE rather than in `PlanView` deliberately: `apps/web/app/plan/*` is
          F-204's and F-205's, and this file is the wiring shim, so the link lands without taking
          a component another lane is about to work in. The cost of that boundary is that this
          renders whether or not a plan exists yet — a server component sees no plan state. It is
          honest either way: an event with no plan lands on the checklist's own "generate the
          permit plan first" state rather than on a broken page. A link that appears only once a
          plan exists belongs in `PlanView`, and is theirs to add. */}
      <nav className="plan-next" aria-label="Next steps">
        <a href={`/events/${id}/checklist`}>Track this plan on your compliance checklist</a>
        <span aria-hidden="true"> · </span>
        <a href={`/events/${id}/dashboard`}>Live ops — door-day check-ins</a>
      </nav>
    </>
  );
}
