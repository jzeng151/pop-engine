import type { ConsumedFinding } from "./plan-api";

// F-205: a dedicated insurance card on top of — never instead of — the plan line each finding
// still renders from via PlanLine (AC 5; removing this file loses only the card). R10 and R11
// already ship in the day-one ruleset (F-201); this component adds no rule and reads no field a
// test cannot trace to the published artifact.
//
// Nothing here composes regulatory prose. Every string an organizer reads is either published in
// the rules artifact and carried through the plan, or one of the schema's own disposition tokens.

/**
 * The three published rules this feature surfaces. Matched by id rather than by `kind` — which
 * `ConsumedFinding` deliberately does not carry (`./plan-api`'s F-206 boundary: a field not read
 * elsewhere in this app is not in the type) — because a fixed, small id set is exactly what a
 * dedicated card for three named rules needs, and adding `kind` back for one caller would reopen
 * a boundary the rest of this feature already enforces without it.
 */
const INSURANCE_RULE_IDS: ReadonlySet<string> = new Set([
  "SAPO-INSURANCE-001",
  "SAPO-INSURANCE-BLOCK-PARTY-RIDE-001",
  "PARKS-INSURANCE-NOTE-001",
]);

/**
 * The subset of `INSURANCE_RULE_IDS` that is `kind: insurance` — a checklist item with a document
 * slot (`apps/api/src/checklist.ts`'s `TRACKABLE_FINDING_KINDS`) — as opposed to
 * `PARKS-INSURANCE-NOTE-001`, which is `kind: note` and read-only context with nothing to upload
 * against. `kind` never softens: an `unknown`-triggered SAPO-INSURANCE-001 renders `disposition:
 * may_be_required` (`UNKNOWN_TRIGGER_DISPOSITION`, `packages/engine/src/proposals.ts`) but is
 * still the same trackable row, so link eligibility is keyed on the rule id, never on disposition.
 */
const TRACKABLE_INSURANCE_RULE_IDS: ReadonlySet<string> = new Set([
  "SAPO-INSURANCE-001",
  "SAPO-INSURANCE-BLOCK-PARTY-RIDE-001",
]);

const humanize = (token: string): string => token.replace(/_/g, " ");

/**
 * The published deadline's own type, for SAPO-INSURANCE-001's `{type: "before_issuance"}` — no
 * computable date, so "before issuance" is the whole timing requirement (ARCHITECTURE.md's
 * "Rules loading" table states it the same way: "obtain before permit issuance"). Guarded the same
 * way `plan-line.tsx` guards it: only when nothing else timing-related is published, so a future
 * rule that adds a computed date is never silently dropped in favor of the bare type.
 */
const deadlineTypeLabel = (finding: ConsumedFinding): string | null =>
  finding.deadline !== null &&
  finding.deadlineDisplay === null &&
  finding.latestApplyDate === null &&
  finding.applyAfterDate === null
    ? humanize(finding.deadline.type)
    : null;

/**
 * Whether this card is a hard requirement or informational (AC 1/2). The engine's own disposition
 * token is the distinction — `required` for SAPO-INSURANCE-001 and the block-party-ride rule
 * (both `kind: insurance`), `no_new_requirement` for PARKS-INSURANCE-NOTE-001 (`kind: note`) — so
 * the card never states "informational" or "required" in words this feature composed; it renders
 * the published disposition and styles by it.
 */
const isRequired = (finding: ConsumedFinding): boolean => finding.disposition === "required";

/** Whether a checklist row exists for this finding to receive the certificate against (AC 4). */
const isTrackable = (finding: ConsumedFinding): boolean =>
  finding.ruleIds.some((ruleId) => TRACKABLE_INSURANCE_RULE_IDS.has(ruleId));

/**
 * One insurance card. Styling is disposition-based (AC 1/2: required renders the warning
 * treatment, anything else — `no_new_requirement` for the parks note, `may_be_required` for an
 * unknown-triggered insurance rule — renders neutral). The checklist link is a separate question,
 * gated on `isTrackable` rather than on disposition: a `may_be_required` insurance finding is
 * still a trackable checklist row, and withholding the link there would leave an organizer with
 * nowhere to put a certificate for a requirement that may well apply.
 */
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

/**
 * The dedicated insurance panel (F-205). Renders one card per matching finding, above the plan's
 * own line items, and nothing at all when none match.
 *
 * AC 3's silence is deliberate and unconditional: a private-venue event triggers none of the three
 * rules, so `insuranceFindings` is empty and this returns `null` — no empty state, no "no
 * insurance required" affirmation. Either would assert an absence no source establishes; the
 * answer key is silent, so this is. The same path covers the block-party-without-a-ride edge case
 * (Scenario D) and a street-to-private-venue rescope (Scenario A): neither triggers an insurance
 * rule, so neither renders a card, without this component knowing why.
 */
export function InsurancePanel({
  findings,
  eventId,
}: {
  findings: readonly ConsumedFinding[];
  eventId: string;
}) {
  const insuranceFindings = findings.filter((finding) =>
    finding.ruleIds.some((ruleId) => INSURANCE_RULE_IDS.has(ruleId)),
  );

  if (insuranceFindings.length === 0) return null;

  return (
    <section className="insurance" aria-label="Insurance">
      {insuranceFindings.map((finding) => (
        <InsuranceCard key={finding.ruleIds.join("+")} finding={finding} eventId={eventId} />
      ))}
    </section>
  );
}
