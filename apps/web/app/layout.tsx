import type { ReactNode } from "react";
import "./globals.css";

export const metadata = {
  title: "PopEngine",
  description: "Synthetic-data demo, access-gated (AD-12).",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,600&family=IBM+Plex+Mono:wght@400;500;600&family=Nunito+Sans:wght@400;600;700&display=swap"
          rel="stylesheet"
        />
        <div className="pe-shell">{children}</div>
      </body>
    </html>
  );
}
