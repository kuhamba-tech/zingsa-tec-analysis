export default function GlobalLoading() {
  return (
    <div className="page-stack" role="status" aria-live="polite">
      <p className="page-subtitle" style={{ color: "var(--text-muted)" }}>
        Loading page…
      </p>
    </div>
  );
}
