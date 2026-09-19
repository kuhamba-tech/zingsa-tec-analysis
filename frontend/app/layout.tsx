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

/** Runs before React hydrates so National Dashboard metrics can paint from cache.
 * URL rules must stay aligned with lib/clientApiBase.ts. */
const SPACE_WEATHER_BOOT_SCRIPT = `
(function () {
  try {
    window.addEventListener("unhandledrejection", function (event) {
      try {
        var reason = event && event.reason;
        if (reason instanceof Event) { event.preventDefault(); return; }
        var msg = reason && reason.message ? String(reason.message) : String(reason || "");
        var name = reason && reason.name ? String(reason.name) : "";
        if (name === "NotAllowedError" || /clipboard|Document is not focused|writeText/i.test(msg)) {
          event.preventDefault();
        }
      } catch (e) {}
    });
    var host = location.hostname;
    var port = location.port;
    var origin = location.origin;
    var local = host === "localhost" || host === "127.0.0.1" || host === "[::1]";
    var base;
    if (port === "3000" || port === "3001" || port === "43128") {
      base = origin + "/backend";
    } else if (local && port === "8000") {
      base = origin;
    } else if (local) {
      base = origin + "/backend";
    } else {
      base = origin + "/api";
    }
    var path = "/space-weather/current";
    var url = base + path;
    if (base.slice(-4) === "/api") {
      url = base + "/space-weather-router/?__zr=" + encodeURIComponent(path);
    }
    var ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
    var timer = ctrl ? setTimeout(function () { try { ctrl.abort(); } catch (e) {} }, 8000) : null;
    fetch(url + (url.indexOf("?") >= 0 ? "&" : "?") + "_ts=" + Date.now(), {
      cache: "no-store",
      signal: ctrl ? ctrl.signal : undefined
    })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        if (d && (d.kp != null || d.dst != null || d.gnss_risk || d.mean_vtec != null || d.stations_online != null)) {
          window.__ZGIIS_SW_BOOT = d;
        }
      })
      .catch(function () {})
      .then(function () { if (timer) clearTimeout(timer); });
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
