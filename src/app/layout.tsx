import type { Metadata } from "next";
// Self-hosted and version-pinned via the `geist` package rather than
// next/font/google, matching justin06lee.dev: Google refetches at build time,
// so an upstream metrics change would silently shift the mono glyph grid.
import { GeistMono } from "geist/font/mono";
import "./globals.css";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://coffee.justin06lee.dev";

const DESCRIPTION = "grab a slot on my calendar. coffee, code review, or a chat.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: "coffee",
    template: "%s | coffee",
  },
  description: DESCRIPTION,
  applicationName: "coffee.justin06lee.dev",
  authors: [{ name: "justin06lee" }],
  creator: "justin06lee",
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    locale: "en_US",
    url: SITE_URL,
    siteName: "coffee.justin06lee.dev",
    title: "coffee",
    description: DESCRIPTION,
  },
  robots: { index: true, follow: true },
};

export const viewport = {
  themeColor: "#000000",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="bg-black">
      <body
        className={`${GeistMono.variable} min-h-dvh bg-black text-white antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
