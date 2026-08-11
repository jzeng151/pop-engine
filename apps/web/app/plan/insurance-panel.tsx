import type { ConsumedFinding } from "./plan-api";

// F-205: a dedicated insurance card on top of — never instead of — the plan line each finding still renders from via PlanLine (AC 5; removing this file loses only the card).

/** The three published rules this feature surfaces. */
const INSURANCE_RULE_IDS: ReadonlySet<string> = new Set([
  "SAPO-INSURANCE-001",
  "SAPO-INSURANCE-BLOCK-PARTY-RIDE-001",
  "PARKS-INSURANCE-NOTE-001",
]);

/** The subset of `INSURANCE_RULE_IDS` that is `kind: insurance` — a checklist item with a document slot (`apps/api/src/planning/checklist.ts`'s `TRACKABLE_FINDING_KINDS`) — as opposed to `PARKS-INSURANCE-NOTE-001`, which is `kind: note` and read-only context with nothing to upload against. */
const TRACKABLE_INSURANCE_RULE_IDS: ReadonlySet<string> = new Set([
  "SAPO-INSURANCE-001",
  "SAPO-INSURANCE-BLOCK-PARTY-RIDE-001",
]);

const humanize = (token: string): string => token.replace(/_/g, " ");

/** The published deadline's own type, for SAPO-INSURANCE-001's `{type: "before_issuance"}` — no computable date, so "before issuance" is the whole timing requirement (ARCHITECTURE.md's "Rules loading" table states it the same way: "obtain before permit issuance"). */
const deadlineTypeLabel = (finding: ConsumedFinding): string | null =>
  finding.deadline !== null &&
  finding.deadlineDisplay === null &&
  finding.latestApplyDate === null &&
  finding.applyAfterDate === null
    ? humanize(finding.deadline.type)
    : null;

/** Whether this card is a hard requirement or informational (AC 1/2). */
const isRequired = (finding: ConsumedFinding): boolean => finding.disposition === "required";

/** The insurance rule's OWN published values, where the line it arrived on merged. */
const insuranceView = (finding: ConsumedFinding): ConsumedFinding => {
  const routes = finding.routes ?? [];
  if (routes.length < 2) return finding;
  const route = routes.find((entry) => INSURANCE_RULE_IDS.has(entry.ruleId));
  if (route === undefined) return finding;
  return {
    ...finding,
    ruleIds: [route.ruleId],
    name: route.name,
    agency: route.agency,
    disposition: route.disposition,
    deadline: route.deadline,
    deadlineDisplay: route.deadlineDisplay,
    latestApplyDate: route.latestApplyDate,
    applyAfterDate: route.applyAfterDate,
    deadlineStatus: route.deadlineStatus,
    feeDisplay: route.feeDisplay,
    portalName: route.portalName,
    portalUrl: route.portalUrl,
    portalInstructions: route.portalInstructions,
    // THE ROUTE'S OWN NOTES, and the round that called this blocked was wrong.
    notes: route.notes ?? finding.notes,
    noteText: null,
    sources: finding.sources.filter((source) => source.ruleId === route.ruleId),
  };
};

/** Whether a checklist row exists for this finding to receive the certificate against (AC 4). */
const isTrackable = (finding: ConsumedFinding): boolean =>
  finding.ruleIds.some((ruleId) => TRACKABLE_INSURANCE_RULE_IDS.has(ruleId));

/** One insurance card. */
function InsuranceCard({ finding, eventId }: { finding: ConsumedFinding; eventId: string }) {
  const headingId = `insurance-${finding.ruleIds.join("-")}`;
  const required = isRequired(finding);
  const trackable = isTrackable(finding);
  const deadlineLabel = deadlineTypeLabel(finding);

  return (
    <article
      className={required ? "insurance__card insurance__card--required" : "insurance__card"}
      aria-labelledby={headingId}
    >
      <div className="insurance__head">
        <h3 className="insurance__name" id={headingId}>
          {finding.name ?? finding.ruleIds.join(", ")}
        </h3>
        <span className="insurance__badge">{humanize(finding.disposition)}</span>
      </div>

      {/* Agency is omitted rather than rendered empty: PARKS-INSURANCE-NOTE-001 legitimately
          publishes none, the same convention plan-line.tsx and checklist-item.tsx follow. */}
      {(finding.agency !== null || deadlineLabel !== null) && (
        <p className="insurance__meta">
          {finding.agency !== null && <span>{finding.agency}</span>}
          {deadlineLabel !== null && <span>{deadlineLabel}</span>}
        </p>
      )}

      {/* The rule's own primary text (the block-party-ride exemption + DOB inspection-certificate
          note; the parks borough-office note) and its published notes (SAPO-INSURANCE-001's
          exceptions and the R-8 certificate-wording caveat), verbatim and in full — never
          summarized down to the exceptions this component's own prose would have to compose. */}
      {finding.noteText !== null && <p className="insurance__note">{finding.noteText}</p>}
      {finding.notes.map((note) => (
        <p className="insurance__note" key={note}>
          {note}
        </p>
      ))}

      {trackable && (
        <p className="insurance__action">
          <a href={`/events/${eventId}/checklist`}>
            Track the certificate on your compliance checklist
          </a>
        </p>
      )}
    </article>
  );
}

/** The dedicated insurance panel (F-205). */
export function InsurancePanel({
  findings,
  eventId,
}: {
  findings: readonly ConsumedFinding[];
  eventId: string;
}) {
  const insuranceFindings = findings
    .filter((finding) => finding.ruleIds.some((ruleId) => INSURANCE_RULE_IDS.has(ruleId)))
    .map(insuranceView);

  if (insuranceFindings.length === 0) return null;

  return (
    <section className="insurance" aria-label="Insurance">
      {insuranceFindings.map((finding) => (
        <InsuranceCard key={finding.ruleIds.join("+")} finding={finding} eventId={eventId} />
      ))}
    </section>
  );
}
