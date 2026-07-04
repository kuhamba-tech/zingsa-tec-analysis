import type { ChartAnalysisBlock } from "./multiSourceChartAnalysis";
import type { GicTimelineBundle } from "@/components/dashboard/GicLiveTimelinePanel";
import type { StationUptimeRow, TimelinePoint } from "./types";

function fmt(v: number | null | undefined, digits = 1, suffix = ""): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "n/a";
  return `${v.toFixed(digits)}${suffix}`;
}

function mean(values: number[]): number | null {
  if (!values.length) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function validValues(points: TimelinePoint[]): number[] {
  return points.map((p) => p.v).filter((v): v is number => v != null && Number.isFinite(v));
}

function peakPoint(points: TimelinePoint[]): { t: string; v: number } | null {
  let best: { t: string; v: number } | null = null;
  for (const p of points) {
    if (p.v == null || !Number.isFinite(p.v)) continue;
    if (!best || p.v > best.v) best = { t: p.t, v: p.v };
  }
  return best;
}

function troughPoint(points: TimelinePoint[]): { t: string; v: number } | null {
  let best: { t: string; v: number } | null = null;
  for (const p of points) {
    if (p.v == null || !Number.isFinite(p.v)) continue;
    if (!best || p.v < best.v) best = { t: p.t, v: p.v };
  }
  return best;
}

function dayKey(iso: string): string {
  return iso.slice(0, 10);
}

function dailyMax(points: TimelinePoint[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const p of points) {
    if (p.v == null || !Number.isFinite(p.v)) continue;
    const d = dayKey(p.t);
    out.set(d, Math.max(out.get(d) ?? -Infinity, p.v));
  }
  return out;
}

function dailyMin(points: TimelinePoint[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const p of points) {
    if (p.v == null || !Number.isFinite(p.v)) continue;
    const d = dayKey(p.t);
    out.set(d, Math.min(out.get(d) ?? Infinity, p.v));
  }
  return out;
}

function kpStormClass(kp: number): string {
  if (kp >= 9) return "G5 extreme storm";
  if (kp >= 8) return "G4 severe storm";
  if (kp >= 7) return "G3 strong storm";
  if (kp >= 6) return "G2 moderate storm";
  if (kp >= 5) return "G1 minor storm";
  if (kp >= 4) return "active";
  return "quiet";
}

function dstStormNote(dst: number): string {
  if (dst <= -200) return "intense ring-current storm";
  if (dst <= -100) return "moderate storm main phase";
  if (dst <= -50) return "weak storm / disturbed ring current";
  return "below storm threshold (−50 nT)";
}

function addCalendarDays(dateStr: string, delta: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + delta);
  return dt.toISOString().slice(0, 10);
}

function preStormRunUp(stormDate: string, daysBefore = 3): string[] {
  return Array.from({ length: daysBefore + 1 }, (_, i) => addCalendarDays(stormDate, -(daysBefore - i)));
}

function latestPoint(points: TimelinePoint[]): { t: string; v: number } | null {
  for (let i = points.length - 1; i >= 0; i--) {
    if (points[i].v != null && Number.isFinite(points[i].v!)) {
      return { t: points[i].t, v: points[i].v! };
    }
  }
  return null;
}

export function analyzeKpDstTimeline(
  kpPoints: TimelinePoint[],
  dstPoints: TimelinePoint[],
  hasKpEkf: boolean,
  hasDstEkf: boolean,
): ChartAnalysisBlock {
  const kpPeak = peakPoint(kpPoints);
  const dstTrough = troughPoint(dstPoints);
  const latestKp = latestPoint(kpPoints);
  const latestDst = latestPoint(dstPoints);

  const bullets: string[] = [
    "Left axis — Kp: planetary geomagnetic storm index (≥ 5 = storm). Right axis — Dst: ring-current intensity in nT (more negative = stronger storm, ≤ −50 nT threshold).",
    "Solid lines are observed NOAA/SWPC values; dashed lines are Extended Kalman Filter predictions for comparison.",
  ];

  if (kpPeak) {
    bullets.push(
      `Highest Kp in this window: ${fmt(kpPeak.v)} on ${dayKey(kpPeak.t)} (${kpStormClass(kpPeak.v)}). Red/orange spikes on the left track geomagnetic disturbance at Earth.`,
    );
  }
  if (dstTrough) {
    bullets.push(
      `Most negative Dst: ${fmt(dstTrough.v, 0)} nT on ${dayKey(dstTrough.t)} — ${dstStormNote(dstTrough.v)}. Sharp negative dips on the right confirm ring-current storm main phase.`,
    );
  }

  if (kpPeak && kpPeak.v >= 5 && dstTrough) {
    const stormDay = dayKey(kpPeak.t);
    const kpDaily = dailyMax(kpPoints);
    const dstDaily = dailyMin(dstPoints);
    const window = preStormRunUp(stormDay);
    const runUp = window.map((date) => ` ${date}: Kp ${fmt(kpDaily.get(date) ?? null)}, Dst ${fmt(dstDaily.get(date) ?? null, 0)} nT`).join(";");
    bullets.push(`3 days before peak storm (Kp ${fmt(kpPeak.v)} on ${stormDay}):${runUp}. Kp and Dst should rise/fall together when a CME-driven storm arrives.`);
  }

  if (latestKp && latestDst) {
    bullets.push(
      `Latest sample: Kp ${fmt(latestKp.v)} (${kpStormClass(latestKp.v)}), Dst ${fmt(latestDst.v, 0)} nT — ${latestKp.v >= 5 || latestDst.v <= -50 ? "storm-level conditions in the most recent data." : "currently below classic storm thresholds in the latest bin."}`,
    );
  }

  if (hasKpEkf || hasDstEkf) {
    bullets.push(
      "When observed and EKF lines diverge sharply, the filter may flag an unusual disturbance — check the storm alert banner at the top of the dashboard.",
    );
  }

  const lead =
    kpPeak && kpPeak.v >= 5
      ? `Geomagnetic storm activity detected — peak Kp ${fmt(kpPeak.v)} with Dst down to ${fmt(dstTrough?.v ?? null, 0)} nT in this 7-day window.`
      : "Dual-axis storm monitor — Kp proves storms at Earth; Dst shows ring-current intensity. Watch both together.";

  return { lead, bullets };
}

export function analyzeF107Timeline(points: TimelinePoint[]): ChartAnalysisBlock {
  const vals = validValues(points);
  const peak = peakPoint(points);
  const latest = latestPoint(points);
  const bullets: string[] = [
    "F10.7 is solar radio flux (sfu) — measures how active the Sun is. It drives long-term ionospheric background TEC but does not by itself prove a geomagnetic storm (use Kp/Dst for that).",
  ];
  if (peak && vals.length) {
    bullets.push(
      `Peak ${fmt(peak.v, 1)} sfu on ${dayKey(peak.t)}; window mean ${fmt(mean(vals), 1)} sfu. Values above ~150 sfu indicate an active Sun and higher baseline TEC over Zimbabwe.`,
    );
  }
  if (latest) {
    bullets.push(`Current flux ${fmt(latest.v, 1)} sfu (${dayKey(latest.t)}). Rising F10.7 over weeks raises average TEC; sudden storms still appear first on the Kp/Dst chart.`);
  }
  return {
    lead: "Solar flux timeline — Sun activity proxy, not an Earth storm detector.",
    bullets,
  };
}

export function analyzeSolarWindTimeline(points: TimelinePoint[]): ChartAnalysisBlock {
  const vals = validValues(points);
  const peak = peakPoint(points);
  const latest = latestPoint(points);
  const bullets: string[] = [
    "Solar wind speed (km/s) from NOAA — fast wind (> 500 km/s) or sudden jumps often precede geomagnetic storms when a CME or coronal hole stream arrives at Earth.",
  ];
  if (peak) {
    bullets.push(`Fastest wind in window: ${fmt(peak.v, 0)} km/s on ${dayKey(peak.t)}${peak.v >= 600 ? " — elevated; watch Kp/Dst for storm response within hours to days." : "."}`);
  }
  if (latest && vals.length) {
    const avg = mean(vals);
    bullets.push(
      `Latest ${fmt(latest.v, 0)} km/s vs window mean ${fmt(avg, 0)} km/s. Sustained high speed plus southward Bz (not shown here) drives Dst depression on the dual-axis chart.`,
    );
  }
  return {
    lead: "Solar wind driver — fast streams and CME shocks trigger geomagnetic storms when they reach Earth.",
    bullets,
  };
}

export function analyzeTecTimeline(points: TimelinePoint[]): ChartAnalysisBlock {
  const vals = validValues(points);
  const peak = peakPoint(points);
  const latest = latestPoint(points);
  const avg = mean(vals);
  const bullets: string[] = [
    "Network mean VTEC (TECU) from Zimbabwe CORS archive — total electron content in the ionosphere over the station network. Higher TEC can reduce GNSS accuracy, especially with scintillation (S4 chart).",
  ];
  if (peak && avg != null) {
    bullets.push(
      `Peak ${fmt(peak.v, 2)} TECU on ${dayKey(peak.t)}; mean ${fmt(avg, 2)} TECU. Compare spikes with Kp/Dst — storm-day TEC often rises when Kp ≥ 5.`,
    );
  }
  if (latest && avg != null) {
    const delta = latest.v - avg;
    bullets.push(
      `Latest ${fmt(latest.v, 2)} TECU (${delta >= 0 ? "+" : ""}${fmt(delta, 2)} vs window mean) on ${dayKey(latest.t)}.`,
    );
  }
  return {
    lead: "Ionospheric TEC over Zimbabwe — local response to solar and geomagnetic forcing.",
    bullets,
  };
}

export function analyzeS4Timeline(points: TimelinePoint[]): ChartAnalysisBlock {
  const vals = validValues(points);
  const peak = peakPoint(points);
  const latest = latestPoint(points);
  const bullets: string[] = [
    "S4 scintillation index (0–1) — GNSS signal fading from ionospheric irregularities. S4 > 0.5 indicates strong scintillation; often elevated during geomagnetic storms at low latitudes.",
  ];
  if (peak) {
    bullets.push(
      `Peak S4 ${fmt(peak.v, 2)} on ${dayKey(peak.t)}${peak.v >= 0.5 ? " — strong scintillation; GNSS positioning degraded." : peak.v >= 0.3 ? " — moderate scintillation possible." : " — mostly quiet scintillation."}`,
    );
  }
  if (latest) {
    bullets.push(`Latest S4 ${fmt(latest.v, 2)} on ${dayKey(latest.t)}. Cross-check with Kp and TEC when S4 rises during storm intervals.`);
  }
  return {
    lead: "Scintillation monitor — GNSS quality over Zimbabwe, sensitive to storm-time ionospheric irregularities.",
    bullets,
  };
}

const GNSS_RISK_LABELS = ["Low", "Moderate", "High", "Critical"];

export function analyzeGnssRiskTimeline(points: TimelinePoint[]): ChartAnalysisBlock {
  const vals = validValues(points);
  const peak = peakPoint(points);
  const latest = latestPoint(points);
  const bullets: string[] = [
    "Composite GNSS risk score (0 = low → 3 = critical) from Kp, Dst, TEC, S4 and station health — operational summary for positioning users.",
  ];
  if (peak) {
    bullets.push(`Highest risk score ${fmt(peak.v, 0)} (${GNSS_RISK_LABELS[Math.round(peak.v)] ?? "—"}) on ${dayKey(peak.t)}.`);
  }
  if (latest) {
    bullets.push(`Current risk ${fmt(latest.v, 0)} (${GNSS_RISK_LABELS[Math.round(latest.v)] ?? "—"}) — aligns with storm indices and ionospheric charts above.`);
  }
  if (vals.length) {
    const highBins = vals.filter((v) => v >= 2).length;
    if (highBins > 0) {
      bullets.push(`${highBins} sample(s) at high/critical risk in this window — review Kp/Dst and S4 timelines for drivers.`);
    }
  }
  return {
    lead: "GNSS operations risk — combined index for survey and navigation users.",
    bullets,
  };
}

export function analyzeStationsOnlineTimeline(points: TimelinePoint[]): ChartAnalysisBlock {
  const vals = validValues(points);
  const min = troughPoint(points);
  const latest = latestPoint(points);
  const bullets: string[] = [
    "Count of Zimbabwe CORS stations reporting live data — network availability for TEC and scintillation products.",
  ];
  if (min && latest) {
    bullets.push(
      `Range ${fmt(min.v, 0)}–${fmt(peakPoint(points)?.v ?? latest.v, 0)} stations online; latest ${fmt(latest.v, 0)} on ${dayKey(latest.t)}.`,
    );
  }
  if (min && min.v < (peakPoint(points)?.v ?? min.v) - 2) {
    bullets.push(`Lowest availability ${fmt(min.v, 0)} stations on ${dayKey(min.t)} — check station status archive below for outages; data gaps can affect mean TEC and S4.`);
  }
  return {
    lead: "CORS network health — more online stations mean more reliable ionospheric coverage.",
    bullets,
  };
}

export function analyzeGicTimeline(data: GicTimelineBundle | null): ChartAnalysisBlock {
  if (!data?.series?.points?.length && !data?.liveModel?.points?.length) {
    return {
      lead: "GIC (geomagnetically induced current) at ZETDC transformers — driven by rapid magnetic field changes (dB/dt).",
      bullets: ["No GIC data in the last 24 h. When available, spikes above 25 A indicate elevated grid risk during geomagnetic storms."],
    };
  }
  const measured = (data.series?.points ?? []).filter((p) => p.observed != null);
  const model = (data.liveModel?.points ?? []).filter((p) => p.gic_est_a != null);
  const vals = measured.length
    ? measured.map((p) => Math.abs(p.observed!))
    : model.map((p) => Math.abs(p.gic_est_a!));
  const peak = Math.max(...vals);
  const peakIdx = measured.length
    ? measured.findIndex((p) => Math.abs(p.observed!) === peak)
    : model.findIndex((p) => Math.abs(p.gic_est_a!) === peak);
  const peakTime = (measured[peakIdx]?.t ?? model[peakIdx]?.t ?? "").slice(0, 16).replace("T", " ");
  const latest = measured.at(-1)?.observed ?? model.at(-1)?.gic_est_a;
  const bullets: string[] = [
    measured.length
      ? `Measured transformer-neutral GIC at ${data.stationId}. Solid = observed, dashed = EKF predicted.`
      : `Modelled GIC from plane-wave estimate (K·dB/dt) until field sensors report measured values.`,
    `Peak |GIC| ${fmt(peak, 1)} A${peakTime ? ` around ${peakTime} UTC` : ""}${peak >= 50 ? " — high grid risk band." : peak >= 25 ? " — moderate grid risk band." : " — below moderate threshold (25 A)."}`,
    "GIC rises when dB/dt is high — compare timing with Kp/Dst storms and INTERMAGNET dB/dt on the Time Series tab.",
  ];
  if (latest != null) {
    bullets.push(`Latest ${fmt(Math.abs(latest), 1)} A. Storm-time Kp ≥ 5 and fast dB/dt at southern-African observatories drive these currents in the ZETDC network.`);
  }
  return {
    lead: peak >= 25 ? `Elevated GIC activity detected — peak ${fmt(peak, 1)} A in the last 24 h.` : "Live GIC monitor for the ZETDC grid — watch during geomagnetic storms.",
    bullets,
  };
}

export function analyzeStationUptime(rows: StationUptimeRow[]): ChartAnalysisBlock {
  if (!rows.length) {
    return { lead: "", bullets: [] };
  }
  const sorted = [...rows].sort((a, b) => a.online_pct - b.online_pct);
  const worst = sorted.slice(0, 3);
  const avg = mean(rows.map((r) => r.online_pct));
  const bullets: string[] = [
    "Percentage of time each CORS station was online in the last 7 days — affects TEC map coverage and GNSS product reliability.",
    `Network mean online time ${fmt(avg, 1)}% across ${rows.length} stations.`,
  ];
  if (worst[0] && worst[0].online_pct < 95) {
    bullets.push(
      `Lowest uptime: ${worst.map((r) => `${r.station_code?.toUpperCase() ?? r.station_name} ${fmt(r.online_pct, 1)}%`).join(", ")} — check recent status events below.`,
    );
  }
  return {
    lead: "Station availability — gaps here mean missing VTEC/scintillation data on the timelines above.",
    bullets,
  };
}
