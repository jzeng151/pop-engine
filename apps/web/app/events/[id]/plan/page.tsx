import { PlanView } from "../../../plan/plan-view";
import type { FindingReference } from "../../../plan/verdict-detail";
import { rulesFileIn } from "../../../_lib/rules-file";
import { parseEngineRuleset } from "@pop-engine/engine";
import type { Metadata } from "next";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import "./checklist-entry.css";

export const metadata: Metadata = {
  title: "Permit plan",
};

// The plan route. The plan and the ruleset meta are both fetched from the browser, because the
// Cloudflare Access cookie is the browser's and not this server's (BASELINE.md provider baseline).
export default async function PlanPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:3001";
  const ruleset = parseEngineRuleset(
    JSON.parse(await readFile(resolve(rulesFileIn("../../rules")), "utf8")),
  );
  const rulesetReferences: FindingReference[] = ruleset.rules.flatMap((rule) => {
    if (rule.userSummary === null) return [];
    return [
      {
        ruleIds: [rule.id],
        label: rule.userSummary.heading,
        source: rule.userSummary.points.flatMap((point) => point.sources)[0] ?? null,
        portalName: rule.portalName,
        portalUrl: rule.portalUrl,
      },
    ];
  });
  return (
    <>
      <PlanView
        apiBaseUrl={apiBaseUrl}
        eventId={id}
        rulesetReferences={{
          rulesetVersion: ruleset.rulesetVersion,
          findings: rulesetReferences,
        }}
      />
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
      <nav className="plan-next" aria-label="Next step">
        <a href={`/events/${id}/checklist`}>Track this plan on your compliance checklist</a>
      </nav>
    </>
  );
}
