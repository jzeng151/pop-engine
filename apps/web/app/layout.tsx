import type { ReactNode } from "react";
import { Fraunces, IBM_Plex_Mono, Nunito_Sans } from "next/font/google";
import "./globals.css";

export const metadata = {
  title: "PopEngine",
  description: "Synthetic-data demo, access-gated (AD-12).",
};

/* Self-hosted via next/font so check-in and other routes do not block on fonts.googleapis.com. */
const fraunces = Fraunces({
  subsets: ["latin"],
  weight: ["600"],
  variable: "--font-fraunces",
  display: "swap",
  axes: ["opsz"],
});

const nunitoSans = Nunito_Sans({
  subsets: ["latin"],
  weight: ["400", "600", "700"],
  variable: "--font-nunito-sans",
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
      className={`${fraunces.variable} ${nunitoSans.variable} ${ibmPlexMono.variable}`}
    >
      <body>
        <div className="pe-shell">{children}</div>
      </body>
    </html>
  );
}
