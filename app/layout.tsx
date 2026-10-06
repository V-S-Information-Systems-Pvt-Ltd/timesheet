import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import { cookies } from "next/headers";
import { connection } from "next/server";
import { Toaster } from "@/app/components/toast";
import { BrandingProvider } from "@/app/components/branding-provider";
import { ThemeProvider } from "@/app/components/theme-provider";
import { THEME_COOKIE, THEME_INIT_SCRIPT, parseTheme } from "@/app/components/theme";
import { DEFAULT_BRANDING, derivePalette } from "@/lib/branding";
import { getCachedBranding } from "@/lib/branding-server";
import { isMaintenanceMode } from "@/lib/maintenance";
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

// Display face: Geist (self-hosted variable woff2, already vendored). Its clean,
// technical letterforms and precise tabular figures carry the "blueprint
// instrument" personality on headings, the brand wordmark, and the hero hour
// figures; body text stays Work Sans.
const geistSans = localFont({
  src: "../public/fonts/Geist-Variable.woff2",
  variable: "--font-geist",
  weight: "100 900",
  display: "swap",
});

async function getLayoutBranding() {
  // The runtime flag and branding read must wait for a request, including metadata.
  await connection();
  return isMaintenanceMode() ? DEFAULT_BRANDING : getCachedBranding();
}

export async function generateMetadata(): Promise<Metadata> {
  const branding = await getLayoutBranding();
  const appName = branding.appName || DEFAULT_BRANDING.appName;
  return {
    title: appName,
    description: "Reliable time tracking for VSIS teams—transforming technology to business success.",
  };
}

export async function generateViewport(): Promise<Viewport> {
  const branding = await getLayoutBranding();
  return {
    themeColor: branding.primaryColor || "#ffffff",
  };
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const branding = await getLayoutBranding();

  // Read the saved theme preference so we can render the correct initial
  // `class` on <html> server-side. `system` is resolved client-side (the
  // server can't read the OS setting) by THEME_INIT_SCRIPT before first paint.
  const cookieStore = await cookies();
  const themeCookie = cookieStore.get(THEME_COOKIE)?.value;
  const initialTheme = parseTheme(themeCookie);

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
      className={`${workSans.variable} ${geistMono.variable} ${geistSans.variable} h-full antialiased${initialTheme === "dark" ? " dark" : ""}`}
      style={brandingStyles}
      suppressHydrationWarning
    >
      <body className="min-h-full flex flex-col">
        {/* Blocking, pre-paint theme resolution — prevents a light/dark flash
            (incl. the `system` case the server can't resolve). */}
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-[100] focus:rounded-lg focus:bg-card focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-primary-700 dark:focus:text-primary-200 focus:shadow-card focus:ring-2 focus:ring-primary-600/25"
        >
          Skip to content
        </a>
        <ThemeProvider initialTheme={initialTheme}>
          <BrandingProvider branding={branding}>
            {children}
          </BrandingProvider>
          <Toaster />
        </ThemeProvider>
      </body>
    </html>
  );
}
