import type { NextRequest } from "next/server";
import { monitoringFreshness } from "@/lib/monitoringStatus";
import {
  DST_RING_SCALE, dstColor, dstRingScaleId,
  SOLAR_WIND_SPEED_SCALE, solarWindSpeedScaleId,
} from "@/lib/spaceWeatherMetrics";

export const dynamic = "force-dynamic";

function escape(value: unknown): string {
  return String(value ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function formatKp(kp: number | null): string {
  if (kp == null) return "—";
  const rounded = Math.round(kp * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

function formatDst(dst: number | null): string {
  if (dst == null) return "Unavailable";
  const rounded = Math.round(dst);
  return `${rounded >= 0 ? "+" : ""}${rounded} nT`;
}

const NOAA_G_SCALE = [
  { code: "G0", color: "#22c55e" },
  { code: "G1", color: "#f97316" },
  { code: "G2", color: "#ef4444" },
  { code: "G3", color: "#dc2626" },
  { code: "G4", color: "#991b1b" },
  { code: "G5", color: "#a855f7" },
] as const;

const TEC_SCALE = [
  { code: "N", color: "#00ff88", desc: "Low" },
  { code: "D", color: "#38bdf8", desc: "Typical" },
  { code: "H", color: "#eab308", desc: "High" },
  { code: "S", color: "#ef4444", desc: "Storm" },
  { code: "X", color: "#a855f7", desc: "Extreme" },
] as const;

function kpScale(kp: number | null): { display: string; color: string; code: string; subtitle: string } {
  if (kp == null) {
    return { display: "Unavailable", color: "#ffffff", code: "—", subtitle: "kP=—" };
  }
  const subtitle = `kP=${formatKp(kp)}`;
  if (kp < 3) return { display: "Quiet", color: "#22c55e", code: "G0", subtitle };
  if (kp < 4) return { display: "Unsettled", color: "#84cc16", code: "G0", subtitle };
  if (kp < 5) return { display: "Active", color: "#eab308", code: "G0", subtitle };
  if (kp < 6) return { display: "Minor Storm", color: "#f97316", code: "G1", subtitle };
  if (kp < 7) return { display: "Moderate G2", color: "#ef4444", code: "G2", subtitle };
  if (kp < 8) return { display: "Strong G3", color: "#dc2626", code: "G3", subtitle };
  if (kp < 9) return { display: "Severe G4", color: "#991b1b", code: "G4", subtitle };
  return { display: "Extreme G5", color: "#a855f7", code: "G5", subtitle };
}

function windMeta(speed: number | null): { value: string; color: string; subtitle: string | null } {
  const band = SOLAR_WIND_SPEED_SCALE.find(item => item.id === solarWindSpeedScaleId(speed));
  if (speed == null || !band) return { value: "Unavailable", color: "#ffffff", subtitle: null };
  const value = `${Math.round(speed)} km/s`;
  return { value, color: band.color, subtitle: band.label };
}

function tecMeta(tec: number | null): {
  value: string;
  color: string;
  code: string;
  note: string;
} {
  if (tec == null) {
    return { value: "No recent TEC", color: "#ffffff", code: "—", note: "CORS mean VTEC" };
  }
  const value = `${tec.toFixed(1)} TECU`;
  if (tec < 10) return { value, color: "#00ff88", code: "N", note: "Low band · CORS mean VTEC" };
  if (tec < 40) return { value, color: "#38bdf8", code: "D", note: "Typical band · CORS mean VTEC" };
  if (tec < 100) return { value, color: "#eab308", code: "H", note: "High band · CORS mean VTEC" };
  if (tec < 200) return { value, color: "#ef4444", code: "S", note: "Storm band · CORS mean VTEC" };
  return { value, color: "#a855f7", code: "X", note: "Extreme band · CORS mean VTEC" };
}

function corsColor(online: number | null, total: number | null): string {
  if (online == null || total == null || total <= 0) return "#ffffff";
  const ratio = online / total;
  if (ratio >= 0.7) return "#168bd2";
  if (ratio >= 0.4) return "#eab308";
  return "#f97316";
}

function scaleHtml(
  items: readonly { code?: string; desc?: string; range?: string; color: string }[],
  active: string | null,
  letterKey: "code" | "desc",
): string {
  return `<div class="scale">${items
    .map((item) => {
      const letter = letterKey === "code" ? item.code ?? "" : item.desc ?? "";
      const key = letterKey === "code" ? item.code ?? "" : item.code ?? "";
      const activeItem = active != null && active === key;
      return `<div class="scale-item${activeItem ? " is-active" : ""}">
        <div class="scale-bar" style="background:${escape(item.color)};height:${activeItem ? 4 : 2}px;opacity:${activeItem || !active || active === "—" ? 1 : 0.45}"></div>
        <div class="scale-letter" style="color:${escape(item.color)};font-weight:${activeItem ? 900 : 800}">${escape(letter)}</div>
        ${item.range ? `<div class="scale-range">${escape(item.range)}</div>` : ""}
      </div>`;
    })
    .join("")}</div>`;
}

type MetricCard = {
  icon: string;
  label: string;
  value: string;
  valueColor: string;
  subtitle?: string | null;
  note?: string;
  source: string;
  scaleHtml?: string;
  freshness: "LIVE" | "DELAYED" | "UNAVAILABLE";
};

export async function GET(request: NextRequest) {
  const local = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(request.nextUrl.hostname);
  async function read(group: string, path: string): Promise<Record<string, unknown> | null> {
    const url = local
      ? `${process.env.INTERNAL_API_URL || "http://127.0.0.1:8000"}${path}`
      : `${request.nextUrl.origin}/api/${group}-router/?__zr=${encodeURIComponent(path)}`;
    try {
      const response = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(7000) });
      if (!response.ok) return null;
      return await response.json();
    } catch {
      return null;
    }
  }

  const [weather, network] = await Promise.all([
    read("space-weather", "/space-weather/current"),
    read("cors", "/cors/connected"),
  ]);

  const now = new Date().toISOString().replace("T", " ").slice(0, 19);
  const observed = typeof weather?.updated_utc === "string" ? weather.updated_utc : null;
  const online = asNumber(network?.online);
  const total = asNumber(network?.total);
  const vtec = asNumber(network?.mean_vtec ?? weather?.mean_vtec);
  const kp = asNumber(weather?.kp);
  const dst = asNumber(weather?.dst);
  const wind = asNumber(weather?.plasma_speed);

  const g = kpScale(kp);
  const tec = tecMeta(vtec);
  const stream = windMeta(wind);
  const corsValue =
    online != null && total != null ? `${Math.round(online)} / ${Math.round(total)}` : "Unavailable";

  const cards: MetricCard[] = [
    {
      icon: "📡",
      label: "CORS Connected",
      value: corsValue,
      valueColor: corsColor(online, total),
      note: "Zimbabwe CORS station connection status",
      source: "ZINGSA CORS",
      freshness: online != null ? "LIVE" : "UNAVAILABLE",
    },
    {
      icon: "🇿🇼",
      label: "Zimbabwe Ionosphere",
      value: tec.value,
      valueColor: tec.color,
      note: tec.note,
      source: "ZINGSA CORS",
      freshness: vtec != null ? "LIVE" : "UNAVAILABLE",
      scaleHtml: scaleHtml(TEC_SCALE, tec.code, "desc"),
    },
    {
      icon: "🌌",
      label: "Geomagnetic Storm",
      value: g.display,
      valueColor: g.color,
      subtitle: g.subtitle,
      source: "NOAA SWPC Kp → G-scale",
      freshness: kp != null ? "LIVE" : "UNAVAILABLE",
      scaleHtml: scaleHtml(NOAA_G_SCALE, g.code, "code"),
    },
    {
      icon: "🌡️",
      label: "Dst / SYM-H",
      value: formatDst(dst),
      valueColor: dstColor(dst),
      note: "Ring current · SYM-H when available",
      source: "NOAA / Kyoto Dst",
      freshness: dst != null ? "LIVE" : "UNAVAILABLE",
      scaleHtml: scaleHtml(DST_RING_SCALE.map(band => ({ code: band.id, desc: band.label, range: `${band.short} nT`, color: band.color })), dstRingScaleId(dst), "desc")
        + '<div class="scale-caption">Illustrative ZINGSA ring-current scale</div>',
    },
    {
      icon: "🌬️",
      label: "Solar Wind",
      value: stream.value,
      valueColor: stream.color,
      subtitle: stream.subtitle,
      source: "NOAA SWPC RTSW",
      freshness: wind != null ? "LIVE" : "UNAVAILABLE",
      scaleHtml: scaleHtml(SOLAR_WIND_SPEED_SCALE.map(band => ({ code: band.id, desc: band.label, range: `${band.short} km/s`, color: band.color })), solarWindSpeedScaleId(wind), "desc"),
    },
    {
      icon: "🛰️",
      label: "Estimated GNSS Risk",
      value: typeof weather?.gnss_risk === "string" && weather.gnss_risk ? weather.gnss_risk : "Unavailable",
      valueColor: typeof weather?.gnss_risk_color === "string" ? weather.gnss_risk_color : "#ffffff",
      note: "Provisional estimate · local positioning impact has not been verified",
      source: "ZGIIS risk label",
      freshness: monitoringFreshness(observed, Date.now(), Boolean(weather?.gnss_risk)),
    },
  ];

  // Standalone HTML deliberately skips React hydration, chart libraries and map
  // tiles so older embedded touchscreen browsers can still show the readings.
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="refresh" content="120">
<meta name="color-scheme" content="dark">
<title>ZINGSA Touchscreen Display</title>
<style>
*{box-sizing:border-box}
body{
  margin:0;min-height:100vh;background:#06101c;color:#ffffff;
  font:18px "Segoe UI", Arial, sans-serif;line-height:1.4;
  -webkit-tap-highlight-color:transparent;touch-action:manipulation;
}
main{max-width:1680px;margin:auto;padding:28px 32px 36px}
.brand{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;flex-wrap:wrap;margin-bottom:20px}
.brand-mark{display:flex;align-items:center;gap:14px;min-width:0}
.logo{
  width:64px;height:64px;border-radius:14px;object-fit:cover;flex:0 0 auto;
  background:#061428;border:1px solid rgba(125,211,252,.45);
}
h1{font-size:32px;margin:0;line-height:1.15}
.sub{margin:6px 0 0;color:#ffffff;font-size:16px}
.live-chip{
  display:inline-flex;align-items:center;gap:8px;padding:10px 16px;border-radius:999px;
  border:1px solid #244d73;background:rgba(0,0,0,.55);color:#ffffff;font-size:14px;font-weight:700;
}
.live-dot{width:10px;height:10px;border-radius:50%;background:#00ff88;box-shadow:0 0 0 4px rgba(0,255,136,.15)}
.warning{background:#49340e;border:1px solid #e6b85c;border-radius:10px;padding:14px 16px;margin:0 0 16px}
.cards{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px}
.card{
  display:flex;flex-direction:column;align-items:center;justify-content:flex-start;text-align:center;
  min-height:210px;padding:18px 16px 14px;width:100%;
  background:rgba(0,0,0,.94);border:1px solid #244d73;border-radius:8px;
}
.icon{font-size:28px;line-height:1;margin-bottom:8px}
.label{font-size:15px;font-weight:750;letter-spacing:.02em;line-height:1.2;color:#ffffff}
.value{margin-top:8px;font-size:42px;font-weight:900;line-height:1.05;font-variant-numeric:tabular-nums;word-break:break-word}
.subtitle{margin-top:6px;font-size:15px;color:#ffffff}
.note{margin-top:10px;font-size:13px;color:#ffffff;line-height:1.3;width:100%}
.meta{display:flex;flex-wrap:wrap;align-items:center;justify-content:center;gap:6px 10px;margin-top:10px;font-size:12px;color:#ffffff}
.fresh{font-weight:800;letter-spacing:.04em;text-transform:uppercase}
.fresh-live{color:#00ff88}
.fresh-delayed{color:#eab308}
.fresh-unavailable{color:#ffffff}
.scale{display:flex;width:100%;gap:4px;margin-top:12px}
.scale-item{flex:1;min-width:0;text-align:center}
.scale-bar{width:100%;border-radius:1px;margin-bottom:4px}
.scale-letter{font-size:11px;line-height:1.1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.scale-range{margin-top:4px;color:#ffffff;font-size:11px;line-height:1.25;overflow-wrap:anywhere}
.scale-caption{margin-top:6px;color:#ffffff;font-size:11px;line-height:1.25}
.advice{
  margin:18px 0 0;padding:14px 16px;border-radius:8px;border:1px solid #244d73;
  background:rgba(0,0,0,.55);color:#ffffff;font-size:16px;
}
.links{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;margin-top:16px}
.links a{
  display:flex;align-items:center;justify-content:center;text-align:center;
  min-height:60px;padding:12px 16px;border:2px solid #3a7ab5;border-radius:8px;
  background:rgba(0,0,0,.85);color:#ffffff;text-decoration:none;font-size:17px;font-weight:700;
}
.links a:focus,.links a:active{outline:3px solid #ffd166;outline-offset:2px}
footer{margin-top:20px;border-top:1px solid #244d73;padding-top:14px;color:#ffffff;font-size:14px}
footer p{margin:0 0 8px}
@media(max-width:1100px){.cards{grid-template-columns:repeat(2,minmax(0,1fr))}.links{grid-template-columns:1fr}}
@media(max-width:640px){
  main{padding:16px}h1{font-size:24px}.cards{grid-template-columns:1fr}
  .value{font-size:34px}.card{min-height:180px}
}
</style>
</head>
<body>
<main>
  <header class="brand">
    <div class="brand-mark">
      <img class="logo" src="/zingsa_logo.webp" alt="Zimbabwe National Geospatial and Space Agency">
      <div>
        <h1>ZINGSA Space Weather Monitoring</h1>
        <p class="sub">Touchscreen display · Zimbabwe · refreshes every 2 minutes</p>
      </div>
    </div>
    <div class="live-chip"><span class="live-dot" aria-hidden="true"></span> Live readings</div>
  </header>

  ${!weather || !network
    ? '<p class="warning">Some live data is temporarily unavailable. This display will retry automatically.</p>'
    : ""}

  <div class="cards">
    ${cards
      .map(
        (card) => `<section class="card">
      <div class="icon" aria-hidden="true">${card.icon}</div>
      <div class="label">${escape(card.label)}</div>
      <div class="value" style="color:${escape(card.valueColor)}">${escape(card.value)}</div>
      ${card.subtitle ? `<div class="subtitle">${escape(card.subtitle)}</div>` : ""}
      ${card.scaleHtml ?? ""}
      ${card.note ? `<div class="note">${escape(card.note)}</div>` : ""}
      <div class="meta">
        <span class="fresh ${card.freshness === "LIVE" ? "fresh-live" : "fresh-unavailable"}">${card.freshness}</span>
        <span>${escape(card.source)}</span>
      </div>
    </section>`,
      )
      .join("")}
  </div>

  <p class="advice">Space weather can affect GPS signals. Before precise work, check your receiver, correction service and a known control point. Follow official aviation and operational procedures.</p>

  <div class="links">
    <a href="/display/">Refresh readings</a>
    <a href="/?full=1">Full dashboard</a>
    <a href="/space-weather/gnss-intelligence/?full=1">Navigation news</a>
  </div>

  <footer>
    <p>Weather observation: ${observed ? escape(observed) : "Unavailable"}. Display generated: ${escape(now)} UTC. Station status and TEC can have different observation times.</p>
    <p>Sources: ZINGSA CORS network, NOAA SWPC and Kyoto Dst. Missing readings are shown as unavailable.</p>
  </footer>
</main>
</body>
</html>`;

  return new Response(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
