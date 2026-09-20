/**
 * Early boot: prefetch space-weather + recover from webpack ChunkLoadError
 * before the app/layout.js chunk finishes loading.
 * URL rules must stay aligned with lib/clientApiBase.ts.
 */
(function () {
  try {
    window.addEventListener("unhandledrejection", function (event) {
      try {
        var reason = event && event.reason;
        if (reason instanceof Event) {
          event.preventDefault();
          return;
        }
        var msg = reason && reason.message ? String(reason.message) : String(reason || "");
        var name = reason && reason.name ? String(reason.name) : "";
        if (name === "NotAllowedError" || /clipboard|Document is not focused|writeText/i.test(msg)) {
          event.preventDefault();
        }
      } catch (e) {}
    });

    // Chunk recovery must live outside app/layout.js — when that chunk times out,
    // React client recovery never mounts.
    (function installChunkRecovery() {
      var RELOAD_KEY = "zgiis:chunk-load-reload";
      var armed = true;
      function isChunkFail(value) {
        if (!value) return false;
        if (typeof value === "string") {
          return /ChunkLoadError|Loading chunk .+ failed/i.test(value);
        }
        if (typeof value === "object") {
          var name = value.name ? String(value.name) : "";
          var message = value.message ? String(value.message) : "";
          return name === "ChunkLoadError" || /ChunkLoadError|Loading chunk .+ failed/i.test(message);
        }
        return false;
      }
      function reloadOnce() {
        if (!armed) return;
        try {
          if (sessionStorage.getItem(RELOAD_KEY) === "1") return;
          sessionStorage.setItem(RELOAD_KEY, "1");
        } catch (e) {}
        armed = false;
        try {
          var url = new URL(window.location.href);
          url.searchParams.set("_chunk", String(Date.now()));
          window.location.replace(url.toString());
        } catch (e) {
          window.location.reload();
        }
      }
      window.setTimeout(function () {
        try {
          sessionStorage.removeItem(RELOAD_KEY);
        } catch (e) {}
      }, 12000);
      window.addEventListener("error", function (event) {
        if (isChunkFail(event && event.error) || isChunkFail(event && event.message)) {
          reloadOnce();
        }
      });
      window.addEventListener("unhandledrejection", function (event) {
        if (isChunkFail(event && event.reason)) {
          reloadOnce();
        }
      });
    })();

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
    var timer = ctrl
      ? setTimeout(function () {
          try {
            ctrl.abort();
          } catch (e) {}
        }, 5000)
      : null;
    fetch(url + (url.indexOf("?") >= 0 ? "&" : "?") + "_ts=" + Date.now(), {
      cache: "no-store",
      signal: ctrl ? ctrl.signal : undefined,
    })
      .then(function (r) {
        return r.ok ? r.json() : null;
      })
      .then(function (d) {
        if (
          d &&
          (d.kp != null ||
            d.dst != null ||
            d.gnss_risk ||
            d.mean_vtec != null ||
            d.stations_online != null)
        ) {
          window.__ZGIIS_SW_BOOT = d;
        }
      })
      .catch(function () {})
      .then(function () {
        if (timer) clearTimeout(timer);
      });

    // Warm solar-activity in parallel — flare/wind cards need it for first paint.
    try {
      var saPath = "/space-weather/solar-activity";
      var saUrl = base + saPath;
      if (base.slice(-4) === "/api") {
        saUrl = base + "/space-weather-router/?__zr=" + encodeURIComponent(saPath);
      }
      var saCtrl = typeof AbortController !== "undefined" ? new AbortController() : null;
      var saTimer = saCtrl
        ? setTimeout(function () {
            try {
              saCtrl.abort();
            } catch (e) {}
          }, 10000)
        : null;
      fetch(saUrl + (saUrl.indexOf("?") >= 0 ? "&" : "?") + "_ts=" + Date.now(), {
        cache: "no-store",
        signal: saCtrl ? saCtrl.signal : undefined,
      })
        .then(function (r) {
          return r.ok ? r.json() : null;
        })
        .then(function (d) {
          if (d && (d.flare_class || d.mode || d.solar_wind)) {
            window.__ZGIIS_SA_BOOT = d;
          }
        })
        .catch(function () {})
        .then(function () {
          if (saTimer) clearTimeout(saTimer);
        });
    } catch (e) {}
  } catch (e) {}
})();
