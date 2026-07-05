export default function StormWatchLoading() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
      <h1 className="page-title">Storm Watch</h1>
      <p className="page-subtitle" style={{ color: "var(--text-muted)" }}>
        Loading storm conditions and alert log…
      </p>
    </div>
  );
}
