import { IntakeForm } from "../intake-form";
import { intakeFormProps } from "../intake-page-props";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Edit your event",
};

// The edit route.
export default async function EditIntakePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <IntakeForm {...await intakeFormProps()} eventId={id} />;
}
