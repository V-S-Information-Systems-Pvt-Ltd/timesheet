import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import { Toaster } from "@/app/components/toast";
import "./globals.css";

// Self-hosted variable fonts (no Google Fonts download at build time, so the
// build works offline inside a container).
const workSans = localFont({
  src: "../public/fonts/WorkSans-Variable.ttf",
  variable: "--font-work-sans",
  weight: "100 900",
});

const geistMono = localFont({
  src: "../public/fonts/GeistMono-Variable.woff2",
  variable: "--font-geist-mono",
});

export const metadata: Metadata = {
  title: "VSIS Timesheet",
  description: "Reliable time tracking for VSIS teams—transforming technology to business success.",
};

// Browser-chrome color matches the page background.
export const viewport: Viewport = {
  themeColor: "#ffffff",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${workSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-[100] focus:rounded-lg focus:bg-white focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-primary-700 focus:shadow-card focus:ring-2 focus:ring-primary-600/25"
        >
          Skip to content
        </a>
        {children}
        <Toaster />
      </body>
    </html>
  );
}
