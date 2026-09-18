import { ICAO_TEC_MOD, ICAO_TEC_SEV, TEC_SCALE_MAX, TEC_SCALE_MIN } from "@/lib/icaoTecAdvisory";
import { icaoMarkerPercent, TEC_HEATMAP_GRADIENT } from "@/lib/tecHeatmapColors";

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
