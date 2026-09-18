const GEOMAGNETIC_BANDS = [
  { min: 0, label: "Quiet", kp: "Kp 0-2", color: "#00ff88" },
  { min: 3, label: "Unsettled", kp: "Kp 3", color: "#52e34f" },
  { min: 4, label: "Active", kp: "Kp 4", color: "#c8f018" },
  { min: 5, label: "Minor Storm G1", kp: "Kp 5", color: "#ffb000" },
  { min: 6, label: "Moderate G2", kp: "Kp 6", color: "#ff7a00" },
  { min: 7, label: "Strong G3", kp: "Kp 7", color: "#ff2e2e" },
  { min: 8, label: "Severe G4", kp: "Kp 8", color: "#ff0080" },
  { min: 9, label: "Extreme G5", kp: "Kp 9", color: "#b000ff" },
] as const;

export function geomagneticConditionForKp(kp: number | null | undefined): string | null {
  if (kp === null || kp === undefined || !Number.isFinite(kp)) return null;
  const band = [...GEOMAGNETIC_BANDS].reverse().find((item) => kp >= item.min) ?? GEOMAGNETIC_BANDS[0];
  return `${band.label} (${band.kp})`;
}

export default function GeomagneticConditionScale() {
  return (
    <section className="card scale-reference geomagnetic-condition-scale" aria-label="Geomagnetic condition scale">
      <div className="scale-row">
        <div className="scale-row-label">Geomagnetic Condition Scale</div>
        <div className="scale-items">
          {GEOMAGNETIC_BANDS.map((item) => (
            <div className="scale-item" key={item.label}>
              <div className="scale-range">{item.label}</div>
              <div className="scale-text">{item.kp}</div>
              <div className="scale-bar" style={{ backgroundColor: item.color }} />
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
