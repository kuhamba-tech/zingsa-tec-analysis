"use client";
import type { Station } from "@/lib/types";
import { siteStatusColor, stationDetailRows } from "@/lib/stationDetails";

interface Props {
  station: Station;
  onClose: () => void;
}

export default function SiteDetailsPanel({ station, onClose }: Props) {
  const rows = stationDetailRows(station);
  const statusColor = siteStatusColor(
    rows.find((r) => r.label === "Site Status")?.value ?? station.status,
  );

  return (
    <aside
      className="site-details-panel"
      style={{
        width: "min(280px, 38%)",
        flexShrink: 0,
        background: "linear-gradient(180deg, #0c1628 0%, #0a1018 100%)",
        borderLeft: "1px solid #244d73",
        display: "flex",
        flexDirection: "column",
        fontSize: "0.78rem",
        color: "#e2e8f0",
        maxHeight: "100%",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "0.55rem 0.75rem",
          borderBottom: "1px solid #244d73",
          background: "rgba(22, 139, 210, 0.12)",
        }}
      >
        <span style={{ fontWeight: 700, fontSize: "0.85rem" }}>Details</span>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close details"
          style={{
            background: "transparent",
            border: "none",
            color: "#94a3b8",
            cursor: "pointer",
            fontSize: "1.1rem",
            lineHeight: 1,
            padding: "0 0.2rem",
          }}
        >
          ×
        </button>
      </div>

      <div style={{ padding: "0.65rem 0.75rem", overflowY: "auto", flex: 1 }}>
        <div style={{ fontWeight: 700, marginBottom: "0.15rem", fontSize: "0.9rem" }}>
          {station.name}
        </div>
        <div style={{ color: "#64748b", fontSize: "0.68rem", marginBottom: "0.65rem" }}>
          {station.code.toUpperCase()} · {station.mountpoint ?? station.marker_name ?? "CORS"}
        </div>

        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <tbody>
            {rows.map(({ label, value, highlight }) => (
              <tr key={label} style={{ borderBottom: "1px solid rgba(36, 77, 115, 0.35)" }}>
                <td
                  style={{
                    padding: "0.35rem 0.4rem 0.35rem 0",
                    color: "#64748b",
                    verticalAlign: "top",
                    whiteSpace: "nowrap",
                    width: "42%",
                  }}
                >
                  {label}
                </td>
                <td
                  style={{
                    padding: "0.35rem 0",
                    fontWeight: highlight ? 700 : 500,
                    color: highlight ? statusColor : "#f1f5f9",
                    wordBreak: "break-word",
                  }}
                >
                  {value}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {station.constellations?.length > 0 && (
          <div style={{ marginTop: "0.65rem", fontSize: "0.72rem", color: "#64748b" }}>
            Constellations: {station.constellations.join(", ")}
          </div>
        )}
      </div>
    </aside>
  );
}
