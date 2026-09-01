import "@fontsource-variable/fraunces";
import "@fontsource-variable/manrope";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import "leaflet/dist/leaflet.css";

import "./globals.css";

export const metadata: Metadata = {
  title: "Roofline | Prism Roofing CRM",
  description:
    "A field-ready workspace for finding and qualifying roofing opportunities.",
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
