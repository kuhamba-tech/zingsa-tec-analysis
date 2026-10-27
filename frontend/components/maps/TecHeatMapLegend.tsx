import { ICAO_TEC_MOD, ICAO_TEC_SEV, TEC_SCALE_MAX, TEC_SCALE_MIN } from "@/lib/icaoTecAdvisory";
import { vtecToRgb } from "@/lib/tecHeatmapColors";

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
