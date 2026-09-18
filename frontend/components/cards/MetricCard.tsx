"use client";

interface Props {
  label: string;
  value: string | number | null;
  unit?: string;
  sub?: string;
  color?: string;
  variant?: "ok" | "warn" | "alert" | "accent";
}

export default function MetricCard({ label, value, unit, sub, color, variant = "accent" }: Props) {
  const display = value === null || value === undefined ? "N/A" : String(value);
  return (
    <div className={`card card-${variant}`} style={{ minHeight: "5.5rem" }}>
      <div className="metric-label">{label}</div>
      <div className="metric-value" style={color ? { color } : undefined}>
        {display}{unit && value !== null ? <span style={{ fontSize: "0.7em", marginLeft: "0.2em" }}>{unit}</span> : null}
      </div>
      {sub && <div className="metric-label" style={{ marginTop: "0.3rem" }}>{sub}</div>}
    </div>
  );
}
