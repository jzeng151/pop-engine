import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Event overview",
};

export default async function EventOverview({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const sections = [
    {
      label: "Comply",
      links: [
        {
          description:
            "Review the engine-generated verdict, findings, provenance, and coverage notices.",
          href: `/events/${id}/plan`,
          label: "Open permit plan",
        },
        {
          description: "Turn supported plan requirements into trackable event work.",
          href: `/events/${id}/checklist`,
          label: "Open checklist",
        },
      ],
    },
    {
      label: "Market",
      links: [
        {
          description: "Prepare the public event page from the same event record.",
          href: `/events/${id}/promote`,
          label: "Edit event page",
        },
        {
          description: "Manage the synthetic guest list used in this capstone demo.",
          href: `/events/${id}/guests`,
          label: "View guests",
        },
      ],
    },
    {
      label: "Operate",
      links: [
        {
          description: "Use the attendee check-in surface for this synthetic event.",
          href: `/e/${id}/checkin`,
          label: "Open check-in",
        },
        {
          description: "See the event-day operational view backed by the current event.",
          href: `/events/${id}/dashboard`,
          label: "Open live ops",
        },
      ],
    },
  ];

  return (
    <main className="riso-overview">
      <header className="riso-overview__intro">
        <h1>Event field guide</h1>
        <p>
          One event record carries the work from permit planning through promotion and door-day
          operations.
        </p>
        <a className="button button--primary" href={`/intake/${id}`}>
          Review event intake
        </a>
      </header>

      <div className="riso-overview__sections">
        {sections.map((section, sectionIndex) => (
          <section
            aria-labelledby={`overview-${section.label.toLowerCase()}`}
            className="riso-overview__section"
            key={section.label}
          >
            <div className="riso-overview__section-heading">
              <span>{String(sectionIndex + 1).padStart(2, "0")}</span>
              <h2 id={`overview-${section.label.toLowerCase()}`}>{section.label}</h2>
            </div>
            <div className="riso-overview__links">
              {section.links.map((link) => (
                <a href={link.href} key={link.label}>
                  <span>{link.label}</span>
                  <small>{link.description}</small>
                </a>
              ))}
            </div>
          </section>
        ))}
      </div>
    </main>
  );
}
