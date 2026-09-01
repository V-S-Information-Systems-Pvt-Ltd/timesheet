import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import { Toaster } from "@/app/components/toast";
import { BrandingProvider } from "@/app/components/branding-provider";
import { DEFAULT_BRANDING, derivePalette } from "@/lib/branding";
import { repo } from "@/lib/db";
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

export async function generateMetadata(): Promise<Metadata> {
  try {
    const res = await repo.getBranding();
    const appName = res.data?.appName || DEFAULT_BRANDING.appName;
    return {
      title: appName,
      description: "Reliable time tracking for VSIS teams—transforming technology to business success.",
    };
  } catch {
    return {
      title: DEFAULT_BRANDING.appName,
      description: "Reliable time tracking for VSIS teams—transforming technology to business success.",
    };
  }
}

export async function generateViewport(): Promise<Viewport> {
  try {
    const res = await repo.getBranding();
    return {
      themeColor: res.data?.primaryColor || "#ffffff",
    };
  } catch {
    return {
      themeColor: "#ffffff",
    };
  }
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  let branding = DEFAULT_BRANDING;
  try {
    const res = await repo.getBranding();
    if (res.data) branding = res.data;
  } catch {
    // fallback to DEFAULT_BRANDING on error/offline
  }

  const palette = derivePalette(branding.primaryColor);
  const brandingStyles = {
    '--primary-50': palette.shades[50],
    '--primary-100': palette.shades[100],
    '--primary-200': palette.shades[200],
    '--primary-300': palette.shades[300],
    '--primary-400': palette.shades[400],
    '--primary-500': palette.shades[500],
    '--primary-600': palette.shades[600],
    '--primary-700': palette.shades[700],
    '--primary-800': palette.shades[800],
    '--primary-900': palette.shades[900],
  } as React.CSSProperties;

  return (
    <html
      lang="en"
      className={`${workSans.variable} ${geistMono.variable} h-full antialiased`}
      style={brandingStyles}
    >
      <body className="min-h-full flex flex-col">
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-[100] focus:rounded-lg focus:bg-white focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-primary-700 focus:shadow-card focus:ring-2 focus:ring-primary-600/25"
        >
          Skip to content
        </a>
        <BrandingProvider branding={branding}>
          {children}
        </BrandingProvider>
        <Toaster />
      </body>
    </html>
  );
}
