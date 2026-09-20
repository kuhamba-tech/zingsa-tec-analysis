import type { Metadata, Viewport } from "next";
import { Suspense } from "react";
import "./globals.css";
import AppShell from "@/components/layout/AppShell";
import ChunkLoadRecovery from "@/components/ChunkLoadRecovery";

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
    var vercel = host.indexOf("vercel.app") >= 0 || host.indexOf("vercel.com") >= 0;
    var base;
    // Prefer Next /backend proxy for local + Cursor/cloud previews. Only Vercel uses /api.
    if (port === "3000" || port === "3001" || port === "43128") {
      base = origin + "/backend";
    } else if (local && port === "8000") {
      base = origin;
    } else if (local || !vercel) {
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
    var timer = ctrl ? setTimeout(function () { try { ctrl.abort(); } catch (e) {} }, 5000) : null;
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

    // Warm solar-activity in parallel — flare/wind cards need it for first paint.
    try {
      var saPath = "/space-weather/solar-activity";
      var saUrl = base + saPath;
      if (base.slice(-4) === "/api") {
        saUrl = base + "/space-weather-router/?__zr=" + encodeURIComponent(saPath);
      }
      var saCtrl = typeof AbortController !== "undefined" ? new AbortController() : null;
      var saTimer = saCtrl ? setTimeout(function () { try { saCtrl.abort(); } catch (e) {} }, 10000) : null;
      fetch(saUrl + (saUrl.indexOf("?") >= 0 ? "&" : "?") + "_ts=" + Date.now(), {
        cache: "no-store",
        signal: saCtrl ? saCtrl.signal : undefined
      })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (d) {
          if (d && (d.flare_class || d.mode || d.solar_wind)) {
            window.__ZGIIS_SA_BOOT = d;
          }
        })
        .catch(function () {})
        .then(function () { if (saTimer) clearTimeout(saTimer); });
    } catch (e) {}
  } catch (e) {}
})();
`;

/**
 * Inline boot script that runs during HTML parse on the server response.
 * On the client, use text/plain so React does not warn that script tags
 * inside components never execute during client rendering (they already ran).
 * See: next/dist/docs/.../preventing-flash-before-hydration.md
 */
function SpaceWeatherBootScript() {
  return (
    <script
      id="zgiis-sw-boot"
      type={typeof window === "undefined" ? "text/javascript" : "text/plain"}
      suppressHydrationWarning
      dangerouslySetInnerHTML={{ __html: SPACE_WEATHER_BOOT_SCRIPT }}
    />
  );
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
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
