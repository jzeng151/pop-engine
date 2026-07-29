import type { ReactNode } from "react";
import type { Metadata } from "next";
import "./intake.css";

export const metadata: Metadata = {
  title: "Describe your event",
};

/** Route segment for intake — styles only; fonts/canvas come from the root pe-shell. */
export default function IntakeLayout({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
