import type { Metadata } from "next";
import localFont from "next/font/local";
import { Toaster } from "@/app/components/toast";
import "./globals.css";

// Self-hosted variable fonts (no Google Fonts download at build time, so the
// build works offline inside a container).
const geistSans = localFont({
  src: "../public/fonts/Geist-Variable.woff2",
  variable: "--font-geist-sans",
});

const geistMono = localFont({
  src: "../public/fonts/GeistMono-Variable.woff2",
  variable: "--font-geist-mono",
});

export const metadata: Metadata = {
  title: "VSIS Time Sheet System",
  description: "Track and manage timesheet entries for VSIS projects.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        {children}
        <Toaster />
      </body>
    </html>
  );
}
