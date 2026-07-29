import { IntakeForm } from "../intake-form";
import { intakeFormProps } from "../intake-page-props";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Edit your event",
};

// The edit route. An organizer who navigated away (or refreshed) reaches their saved
// event here, so the revision/stale-plan/regenerate path is reachable rather than
// stranded behind a blank create form. The form loads GET /api/events/:id from the
// browser, because the Cloudflare Access cookie is the browser's, not this server's.
export default async function EditIntakePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <IntakeForm {...await intakeFormProps()} eventId={id} />;
}
