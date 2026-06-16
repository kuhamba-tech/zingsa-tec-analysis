import { getStations, getSpaceWeather } from "@/lib/api";
import MetricCard from "@/components/cards/MetricCard";
import CorsMapWithLayers from "@/components/maps/CorsMapWithLayers";
import type { Station, SpaceWeatherCurrent } from "@/lib/types";
import Link from "next/link";
import Image from "next/image";

const MODULES = [
  { href: "/processing",        icon: "⚙️",  title: "Processing",        desc: "Upload and process RINEX/CMN files" },
  { href: "/time-series",       icon: "📈",  title: "Time Series",       desc: "VTEC trends over time" },
  { href: "/prn-explorer",      icon: "🛰️",  title: "PRN Explorer",      desc: "Per-satellite TEC analysis" },
  { href: "/tec-heatmap",       icon: "🗺️",  title: "TEC Heatmap",       desc: "Interpolated VTEC grid over Zimbabwe" },
  { href: "/anomaly-detection", icon: "🔬",  title: "Anomaly Detection", desc: "Storm correlation and anomaly flagging" },
  { href: "/ai-assistant",      icon: "🤖",  title: "AI Assistant",      desc: "Ask questions about TEC and ionosphere" },
];

export default async function HomePage() {
  let stations: Station[] = [];
  let sw: SpaceWeatherCurrent | null = null;

  try { stations = await getStations(); } catch { /* offline */ }
  try { sw = await getSpaceWeather(); } catch { /* offline */ }

  const kpColor = sw?.kp_color ?? "#168bd2";
  const gnssRisk = sw?.gnss_risk ?? "N/A";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
      {/* Title + ZINGSA logo */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "1rem" }}>
        <div>
          <h1 className="page-title" style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
            🛰️ GNSS Based TEC Analysis Using Zimbabwe CORS Network
          </h1>
          <p className="page-subtitle">
            Dual-frequency GPS/GNSS Total Electron Content (TEC) computation from Zimbabwe CORS RINEX observations
          </p>
        </div>
        <Image
          src="/zingsa_logo.webp"
          alt="ZINGSA — Zimbabwe National Geospatial and Space Agency"
          width={120}
          height={120}
          style={{ borderRadius: "12px", flexShrink: 0 }}
          priority
        />
      </div>

      {/* Live space weather metrics */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: "0.8rem" }}>
        <MetricCard label="Kp Index"    value={sw?.kp?.toFixed(1) ?? null}  sub={sw?.kp_condition ?? "Planetary activity"} color={kpColor} variant={sw?.kp && sw.kp >= 5 ? "alert" : "ok"} />
        <MetricCard label="Geomagnetic condition" value={sw?.kp_condition ?? null} sub="Current state" color={kpColor} />
        <MetricCard label="GNSS Risk"   value={gnssRisk} color={sw?.gnss_risk_color ?? undefined} sub="Navigation impact" variant={gnssRisk === "High" ? "alert" : gnssRisk === "Moderate" ? "warn" : "ok"} />
        <MetricCard label="Stations Online" value={sw?.stations_online !== null && sw?.stations_total ? `${sw.stations_online}/${sw.stations_total}` : "N/A"} sub="Live telemetry unavailable" variant="accent" />
      </div>

      {/* Map with layer switcher */}
      <CorsMapWithLayers stations={stations} height={480} riskLevel={gnssRisk} />

      {/* Module cards */}
      <div>
        <h2 style={{ fontSize: "0.78rem", fontWeight: 700, marginBottom: "0.8rem", color: "var(--text-muted)", letterSpacing: "0.08em", textTransform: "uppercase" }}>
          Analysis Modules
        </h2>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "0.75rem" }}>
          {MODULES.map(({ href, icon, title, desc }) => (
            <Link key={href} href={href} style={{ textDecoration: "none" }}>
              <div className="card card-accent" style={{ cursor: "pointer" }}>
                <div style={{ fontSize: "1.4rem", marginBottom: "0.4rem" }}>{icon}</div>
                <div style={{ fontWeight: 700, marginBottom: "0.2rem" }}>{title}</div>
                <div style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>{desc}</div>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
