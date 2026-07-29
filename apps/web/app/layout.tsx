import type { ReactNode } from "react";
import type { Metadata } from "next";
import { Barlow_Condensed, IBM_Plex_Mono, Public_Sans } from "next/font/google";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "PopEngine",
    template: "%s | PopEngine",
  },
  description: "Synthetic-data demo, access-gated (AD-12).",
};

/* Self-hosted via next/font so check-in and other routes do not block on fonts.googleapis.com. */
const barlowCondensed = Barlow_Condensed({
  subsets: ["latin"],
  weight: ["600", "700", "800"],
  variable: "--font-barlow-condensed",
  display: "swap",
});

const publicSans = Public_Sans({
  subsets: ["latin"],
  weight: ["400", "600", "700"],
  variable: "--font-public-sans",
  display: "swap",
});

const ibmPlexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-ibm-plex-mono",
  display: "swap",
});

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html
      lang="en"
      className={`${barlowCondensed.variable} ${publicSans.variable} ${ibmPlexMono.variable}`}
    >
      <body>
        <div
          aria-hidden="true"
          data-impeccable-contract
          dangerouslySetInnerHTML={{
            __html:
              "<!-- THESIS: Riso Field Guide turns the organizer workspace into a practical printed manual, not a generic SaaS dashboard. OWN-WORLD: federal blue, signal coral, registration yellow, paper grain, condensed type, and offset ink marks. STORY: one event moves through Ideate, Comply, Market, and Operate while regulatory provenance remains attached. FIRST VIEWPORT: a blue lifecycle rail anchors a paper work area with the active event and current task. FORM: selected Riso Field Guide direction, seed 7a503d37. FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, and DESIGN.md -->",
          }}
          hidden
        />
        <div className="pe-shell">{children}</div>
      </body>
    </html>
  );
}
