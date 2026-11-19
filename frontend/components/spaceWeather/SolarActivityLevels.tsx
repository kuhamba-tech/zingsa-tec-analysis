export default function SolarActivityLevels() {
  return (
  <div className="card">
    <div className="metric-label" style={{ marginBottom: "0.7rem" }}>Solar Activity Levels</div>
    <div style={{ display: "flex", gap: "0.6rem", flexWrap: "wrap" }}>
      {[
        { label: "Low",      color: "#22c55e", desc: "A/B/C flares, quiet wind" },
        { label: "Moderate", color: "#eab308", desc: "M-class or fast wind" },
        { label: "High",     color: "#f97316", desc: "X-class flare" },
        { label: "Severe",   color: "#ef4444", desc: "G3–G4 at Earth" },
        { label: "Extreme",  color: "#a855f7", desc: "G5, as in May 2024" },
      ].map(({ label, color, desc }) => (
        <div key={label} style={{ display: "flex", alignItems: "center", gap: "0.5rem", background: "#0a1929", borderRadius: "8px", padding: "0.45rem 0.8rem", flex: "1 1 100px" }}>
          <span style={{ display: "inline-block", width: "10px", height: "10px", borderRadius: "50%", background: color, flexShrink: 0 }} />
          <div>
            <div style={{ fontSize: "0.85rem", fontWeight: 700, color }}>{label}</div>
            <div style={{ fontSize: "0.85rem", color: "var(--text-muted)" }}>{desc}</div>
          </div>
        </div>
      ))}
    </div>
  </div>
  );
}
