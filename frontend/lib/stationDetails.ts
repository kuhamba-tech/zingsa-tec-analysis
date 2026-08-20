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
  if (t.includes("receive data") || t.includes("site up") || t.includes("connected")) return "#00ff88";
  if (t.includes("disconnect") || t.includes("offline")) return "#ef4444";
  return "#94a3b8";
}

export function stationDetailRows(s: Station): { label: string; value: string; highlight?: boolean }[] {
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
