import type { Station } from "@/lib/types";

export function decimalToDms(decimal: number, isLat: boolean): string {
  const abs = Math.abs(decimal);
  const deg = Math.floor(abs);
  const minFloat = (abs - deg) * 60;
  const min = Math.floor(minFloat);
  const sec = ((minFloat - min) * 60).toFixed(3);
  const hemi = isLat ? (decimal >= 0 ? "N" : "S") : decimal >= 0 ? "E" : "W";
  const pad = isLat ? 2 : 3;
  return `${String(deg).padStart(pad, "0")}° ${String(min).padStart(2, "0")}' ${sec}" ${hemi}`;
}

export function siteStatusColor(label: string | null | undefined): string {
  const t = (label ?? "").toLowerCase();
  if (t.includes("disconnect") || t.includes("not connected") || t.includes("offline")) return "#ef4444";
  if (t.includes("receive data") || t.includes("site up") || t === "connected") return "#00ff88";
  return "#ffffff";
}

function ntripVerdictLabel(verdict: string | null | undefined): string | null {
  switch (verdict) {
    case "msm_streaming":
      return "MSM observations streaming";
    case "rtcm_no_msm":
      return "Connected — no MSM observations";
    case "connected_no_data":
      return "Connected — no RTCM yet";
    case "offline":
      return "Mountpoint offline";
    default:
      return verdict ? verdict.replace(/_/g, " ") : null;
  }
}

/** Plain-language note when map status disagrees with router reachability. */
export function stationConnectivityExplanation(station: Station): string | null {
  const live = station.status === "online";
  if (live) return null;

  const source = station.status_source;
  const spiderOffline = source === "spider" && station.status === "offline";
  const ntrip = station.ntrip_verdict;

  if (spiderOffline && ntrip === "rtcm_no_msm") {
    return "Router/caster may respond, but Leica Spider reports this GNSS site disconnected and the NTRIP mountpoint is not sending MSM — live VTEC will stay unavailable until the receiver is connected in Spider.";
  }
  if (spiderOffline) {
    const when = station.last_update ? ` Last Spider update: ${station.last_update}.` : "";
    return `Map status follows Leica Spider Site Status (not router login). Spider reports this site disconnected.${when} Check receiver power, antenna, and Spider Site Map.`;
  }
  if (ntrip === "rtcm_no_msm") {
    return "NTRIP mountpoint accepts connections but is not streaming MSM observations required for live VTEC.";
  }
  if (source === "catalog") {
    return "Live Spider status unavailable — showing archive catalog only.";
  }
  return null;
}

export function stationDetailRows(s: Station): { label: string; value: string; highlight?: boolean }[] {
  const ntripLabel = ntripVerdictLabel(s.ntrip_verdict);
  const statusAuthority =
    s.status_source === "spider"
      ? "Leica Spider Site Status"
      : s.status_source === "ntrip"
        ? "NTRIP ingest"
        : s.status_source === "catalog"
          ? "Archive catalog"
          : null;

  return [
    { label: "Site code", value: s.code.toUpperCase() },
    { label: "RTCM ID", value: s.rtcm_id ?? "0000" },
    { label: "Marker name", value: s.marker_name ?? s.mountpoint ?? s.code.toUpperCase() },
    { label: "Marker number", value: s.marker_number ?? s.code.toUpperCase() },
    {
      label: "Site Status",
      value: s.site_status_label ?? s.status,
      highlight: true,
    },
    ...(statusAuthority
      ? [{ label: "Status source", value: statusAuthority }]
      : []),
    ...(ntripLabel
      ? [{ label: "NTRIP stream", value: ntripLabel, highlight: ntripLabel.includes("no MSM") }]
      : []),
    ...(s.connected_rovers != null
      ? [
          {
            label: "Connected rovers",
            value:
              s.rover_share_pct != null
                ? `${s.connected_rovers} · ${s.rover_share_pct}% of network${
                    s.rover_rank != null ? ` · #${s.rover_rank}` : ""
                  }`
                : String(s.connected_rovers),
            highlight: true,
          },
        ]
      : []),
    ...(s.rover_peak_24h != null
      ? [{ label: "Rover peak (24h)", value: String(s.rover_peak_24h) }]
      : []),
    { label: "Latitude", value: decimalToDms(s.lat, true) },
    { label: "Longitude", value: decimalToDms(s.lon, false) },
    {
      label: "Height [m]",
      value: s.height_m != null && s.height_m > 0 ? s.height_m.toFixed(1) : "—",
    },
    { label: "Last update", value: s.last_update || "—" },
    { label: "Site server", value: s.site_server ?? "Local Site Server" },
    {
      label: "VTEC",
      value: s.current_tec != null ? `${s.current_tec.toFixed(2)} TECU` : "N/A",
    },
    ...(s.sourcetable_mismatch
      ? [
          {
            label: "Sourcetable check",
            value: s.sourcetable_note || `Caster identifies this mountpoint as "${s.sourcetable_identifier}"`,
            highlight: true,
          },
        ]
      : []),
  ];
}
