import { ICAO_TEC_MOD, ICAO_TEC_SEV, TEC_SCALE_MAX, TEC_SCALE_MIN } from "@/lib/icaoTecAdvisory";
import { icaoMarkerPercent, TEC_HEATMAP_GRADIENT, vtecToRgb } from "@/lib/tecHeatmapColors";

const COLORBAR_TICKS = [0, 40, 80, 120, 160, 200];

function verticalTecGradient(): string {
  const stops = [0, 25, 50, 80, 100, ICAO_TEC_MOD, ICAO_TEC_SEV, TEC_SCALE_MAX];
  const parts = stops.map((value) => {
    const [r, g, b] = vtecToRgb(value);
    const pct = ((value - TEC_SCALE_MIN) / (TEC_SCALE_MAX - TEC_SCALE_MIN)) * 100;
    return `rgb(${r},${g},${b}) ${pct}%`;
  });
  return `linear-gradient(to top, ${parts.join(", ")})`;
}

/** Vertical TEC colour key, same placement as a scientific map colour bar. */
export function TecMapColorbar() {
  const span = TEC_SCALE_MAX - TEC_SCALE_MIN;
  return (
    <div className="tec-map-colorbar" role="img" aria-label={`TEC colour scale, ${TEC_SCALE_MIN} to ${TEC_SCALE_MAX} TECU. Blue is low, red is high.`}>
      <div className="tec-map-colorbar-ticks" aria-hidden="true">
        {COLORBAR_TICKS.map((tick) => (
          <span key={tick} style={{ bottom: `${((tick - TEC_SCALE_MIN) / span) * 100}%` }}>
            {tick}
          </span>
        ))}
      </div>
      <div className="tec-map-colorbar-bar" style={{ background: verticalTecGradient() }} aria-hidden="true" />
      <div className="tec-map-colorbar-title">TEC [TECU]</div>
    </div>
  );
}

interface Props {
  className?: string;
  maxVtec?: number | null;
}

export default function TecHeatMapLegend({ className = "", maxVtec = null }: Props) {
  const modPct = icaoMarkerPercent(ICAO_TEC_MOD);
  const sevPct = icaoMarkerPercent(ICAO_TEC_SEV);
  const gradient = `linear-gradient(to right, ${TEC_HEATMAP_GRADIENT.join(", ")})`;

  return (
    <div
      className={`tec-heatmap-legend ${className}`.trim()}
      role="note"
      aria-label="TEC Heat Map colour scale with ICAO GNSS advisory thresholds"
    >
      <div className="tec-heatmap-legend-scale">
        <div className="tec-heatmap-legend-scale-row">
          <span className="tec-heatmap-legend-scale-label">{TEC_SCALE_MIN} TECU</span>
          <span className="tec-heatmap-legend-scale-label">{TEC_SCALE_MAX} TECU</span>
        </div>
        <div className="tec-heatmap-legend-gradient-wrap">
          <div className="tec-heatmap-legend-gradient" style={{ background: gradient }} aria-hidden="true" />
          <span
            className="tec-heatmap-legend-marker tec-heatmap-legend-marker--mod"
            style={{ left: `${modPct}%` }}
            title={`ICAO GNSS advisory MOD — ${ICAO_TEC_MOD} TECU`}
          />
          <span
            className="tec-heatmap-legend-marker tec-heatmap-legend-marker--sev"
            style={{ left: `${sevPct}%` }}
            title={`ICAO GNSS advisory SEV — ${ICAO_TEC_SEV} TECU`}
          />
        </div>
        <div className="tec-heatmap-legend-marker-labels">
          <span style={{ left: `${modPct}%` }}>MOD {ICAO_TEC_MOD}</span>
          <span style={{ left: `${sevPct}%` }}>SEV {ICAO_TEC_SEV}</span>
        </div>
        <div className="tec-heatmap-legend-scale-row">
          <span className="tec-heatmap-legend-scale-label">Low TEC</span>
          <span className="tec-heatmap-legend-scale-label">High TEC</span>
        </div>
      </div>
      <p className="tec-heatmap-legend-copy">
        <strong>Absolute VTEC scale (0–{TEC_SCALE_MAX} TECU)</strong> — colours use a fixed ionospheric
        range, not the current min/max.{" "}
        <span className="tec-heatmap-legend-orange">MOD {ICAO_TEC_MOD}</span> and{" "}
        <span className="tec-heatmap-legend-red">SEV {ICAO_TEC_SEV}</span> TECU markers follow ICAO Doc 10100
        GNSS advisory thresholds for aviation navigation.
        {maxVtec != null && Number.isFinite(maxVtec) ? (
          <>
            {" "}
            Current national max: <strong>{maxVtec.toFixed(1)} TECU</strong>.
          </>
        ) : null}
      </p>
    </div>
  );
}
