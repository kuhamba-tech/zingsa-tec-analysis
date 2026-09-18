export default function SpaceWeatherLoading() {
  return (
    <div className="page-stack">
      <h1 className="page-title">☀️ Space Weather Monitoring</h1>
      <p className="page-subtitle" style={{ color: "var(--text-muted)" }}>
        Loading live solar and geomagnetic indices…
      </p>
    </div>
  );
}
