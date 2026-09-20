import type { Metadata, Viewport } from "next";
import { Suspense } from "react";
import "./globals.css";
import AppShell from "@/components/layout/AppShell";
import ChunkLoadRecovery from "@/components/ChunkLoadRecovery";
import SpaceWeatherBootScript from "@/components/SpaceWeatherBootScript";

export const metadata: Metadata = {
  title: "Zimbabwe Space Weather & Navigation",
  description: "Real-time space weather, ionospheric TEC, and GNSS navigation from Zimbabwe's CORS network",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Static boot runs before app/layout.js — includes ChunkLoadError recovery */}
        <SpaceWeatherBootScript />
      </head>
      <body>
        <ChunkLoadRecovery />
        <Suspense fallback={<div className="app-main">{children}</div>}>
          <AppShell>{children}</AppShell>
        </Suspense>
      </body>
    </html>
  );
}
