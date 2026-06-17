interface Props {
  className?: string;
}

export default function TecHeatMapLegend({ className = "" }: Props) {
  return (
    <div
      className={`tec-heatmap-legend ${className}`.trim()}
      role="note"
      aria-label="TEC Heat Map colour scale"
    >
      <div className="tec-heatmap-legend-scale">
        <span className="tec-heatmap-legend-scale-label">Low TEC</span>
        <div className="tec-heatmap-legend-gradient" aria-hidden="true" />
        <span className="tec-heatmap-legend-scale-label">High TEC</span>
      </div>
      <p className="tec-heatmap-legend-copy">
        <strong>TEC Heat Map</strong> — Colour represents Vertical Total Electron Content (VTEC)
        interpolated across Zimbabwe.{" "}
        <span className="tec-heatmap-legend-blue">Blue</span> = low ionospheric electron content;{" "}
        <span className="tec-heatmap-legend-green">green</span> = moderate;{" "}
        <span className="tec-heatmap-legend-red">red</span> = high TEC. Station dots show measured
        (bright) and spatially estimated (dim) VTEC values. Click any dot for details.
      </p>
    </div>
  );
}
