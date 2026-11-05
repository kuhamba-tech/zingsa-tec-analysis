import { ImageResponse } from "next/og";
import type { AdvisoryCard } from "./advisoryShare";

export function advisoryImage(card: AdvisoryCard): ImageResponse {
  const tone =
    card.severity === "Warning" ? "#f59e0b" : card.severity === "Watch" ? "#fbbf24" : card.severity === "Unavailable" ? "#94a3b8" : "#34d399";
  const lines = card.indicators.slice(0, 8);
  return new ImageResponse(
    (
      <div
        style={{
          width: "1200px",
          height: "630px",
          display: "flex",
          flexDirection: "column",
          background: "#071422",
          color: "#e8f1f8",
          padding: "42px 48px",
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ display: "flex", fontSize: 28, letterSpacing: 1, color: "#7dd3fc" }}>
            ZINGSA NAVIGATION NEWS
          </div>
          <div style={{ display: "flex", fontSize: 24, color: tone }}>{card.severity}</div>
        </div>
        <div style={{ display: "flex", fontSize: 42, fontWeight: 700, marginTop: 18 }}>{card.title}</div>
        <div style={{ display: "flex", fontSize: 22, color: "#94a3b8", marginTop: 8 }}>
          {card.category} · {card.publishedLabel}
        </div>
        <div style={{ display: "flex", flexDirection: "column", marginTop: 22, fontSize: 22, lineHeight: 1.35 }}>
          {lines.map((line) => (
            <div key={line} style={{ display: "flex" }}>
              {line}
            </div>
          ))}
        </div>
        <div style={{ display: "flex", marginTop: "auto", fontSize: 20, color: "#94a3b8" }}>{card.url}</div>
      </div>
    ),
    { width: 1200, height: 630 },
  );
}
