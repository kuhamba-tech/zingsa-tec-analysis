import type { NextRequest } from "next/server";

export const dynamic = "force-dynamic";

function escape(value: unknown): string {
  return String(value ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}
function number(value: unknown, digits = 1): string {
  return typeof value === "number" && Number.isFinite(value) ? value.toFixed(digits) : "Unavailable";
}

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
    } catch { return null; }
  }
  const [weather, network] = await Promise.all([
    read("space-weather", "/space-weather/current"), read("cors", "/cors/connected"),
  ]);
  const now = new Date().toISOString().replace("T", " ").slice(0, 19);
  const observed = weather?.updated_utc;
  const cards = [
    ["Zimbabwe CORS online", network ? `${number(network.online, 0)} / ${number(network.total, 0)}` : "Unavailable", "Station connection status"],
    ["Zimbabwe mean VTEC", number(network?.mean_vtec ?? weather?.mean_vtec), "TECU · electrons along the GPS signal path"],
    ["Geomagnetic activity", number(weather?.kp), "Kp · global scale 0–9"],
    ["Earth's magnetic response", number(weather?.dst, 0), "Dst · nT"],
    ["Solar wind speed", number(weather?.plasma_speed, 0), "km/s"],
    ["GNSS performance", "Check locally", "TEC and Kp alone do not verify positioning accuracy"],
  ];
  // Standalone HTML deliberately skips React hydration, chart libraries and map
  // tiles so older embedded touchscreen browsers can still show the readings.
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="refresh" content="120"><meta name="color-scheme" content="dark"><title>ZINGSA Touchscreen Display</title><style>
*{box-sizing:border-box}body{margin:0;background:#06101c;color:#fff;font:20px Arial,sans-serif;line-height:1.5}main{max-width:1600px;margin:auto;padding:32px}h1{font-size:34px;margin:0 0 8px}p{margin:8px 0 20px}.muted{color:#c3d3e4}.cards{display:flex;flex-wrap:wrap;margin:0 -8px}.card{width:calc(33.333% - 16px);margin:8px;padding:24px;background:#10263b;border:1px solid #375f80;border-radius:10px}.card h2{font-size:20px;margin:0}.value{font-size:42px;font-weight:bold;color:#64d5ff;margin:12px 0}.note{font-size:17px}.links a{display:inline-block;min-height:52px;margin:8px 12px 8px 0;padding:12px 20px;border:2px solid #64d5ff;border-radius:8px;background:#10263b;color:#fff;text-decoration:none}a:focus{outline:3px solid #ffd166}footer{margin-top:24px;border-top:1px solid #375f80;padding-top:16px}.warning{background:#49340e;border:1px solid #e6b85c;padding:16px}@media(max-width:1000px){.card{width:calc(50% - 16px)}}@media(max-width:560px){main{padding:16px}.card{width:calc(100% - 16px)}h1{font-size:27px}.value{font-size:34px}}
</style></head><body><main><h1>ZINGSA Space Weather &amp; Navigation</h1><p class="muted">Touchscreen display · Zimbabwe · refreshes every 2 minutes</p>${!weather || !network ? '<p class="warning">Some live data is temporarily unavailable. This display will retry automatically.</p>' : ""}<div class="cards">${cards.map(([label, value, unit]) => `<section class="card"><h2>${escape(label)}</h2><div class="value">${escape(value)}</div><div class="note">${escape(unit)}</div></section>`).join("")}</div><p class="muted">Space weather can affect GPS signals. Before precise work, check your receiver, correction service and a known control point. Follow official aviation and operational procedures.</p><div class="links"><a href="/display/">Refresh readings</a><a href="/?full=1">Full dashboard</a><a href="/space-weather/gnss-intelligence/?full=1">Navigation news</a></div><footer class="note"><p>Weather observation: ${observed ? escape(observed) : "Unavailable"}. Display generated: ${escape(now)} UTC. Station status and TEC can have different observation times.</p><p>Sources: ZINGSA CORS network, NOAA SWPC and Kyoto Dst. Missing readings are shown as unavailable.</p></footer></main></body></html>`;
  return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
}
