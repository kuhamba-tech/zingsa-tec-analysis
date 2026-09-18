import type { Metadata, Viewport } from "next";
import { Suspense } from "react";
import "./globals.css";
import AppShell from "@/components/layout/AppShell";

export const metadata: Metadata = {
  title: "Zimbabwe Space Weather & Navigation",
  description: "Real-time space weather, ionospheric TEC, and GNSS navigation from Zimbabwe's CORS network",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

/** Runs before React hydrates so National Dashboard metrics can paint from cache. */
const SPACE_WEATHER_BOOT_SCRIPT = `
(function () {
  try {
    var host = location.hostname;
    var port = location.port;
    var local = host === "localhost" || host === "127.0.0.1" || host === "[::1]";
    var base = local
      ? (port === "8000" ? location.origin : location.origin + "/backend")
      : location.origin + "/api";
    fetch(base + "/space-weather/current?_ts=" + Date.now(), { cache: "no-store" })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        if (d && d.kp != null) window.__ZGIIS_SW_BOOT = d;
      })
      .catch(function () {});
  } catch (e) {}
})();
`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: SPACE_WEATHER_BOOT_SCRIPT }} />
      </head>
      <body>
        <Suspense fallback={<div className="app-main">{children}</div>}>
          <AppShell>{children}</AppShell>
        </Suspense>
      </body>
    </html>
  );
}
