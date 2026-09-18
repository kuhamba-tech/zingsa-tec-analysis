export default function DashboardLoading() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
      <h1 className="page-title">Space Weather Operations Dashboard</h1>
      <p className="page-subtitle" style={{ color: "var(--text-muted)" }}>
        Loading live indices, timelines, and CORS network status…
      </p>
    </div>
  );
}
