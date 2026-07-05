"use client";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="page-stack">
      <div className="banner banner-alert">
        <h2 className="page-title" style={{ fontSize: "1.1rem", marginBottom: "0.5rem" }}>
          Page failed to load
        </h2>
        <p style={{ fontSize: "0.85rem", marginBottom: "0.75rem" }}>
          {error.message || "An unexpected error occurred while rendering this page."}
        </p>
        <button type="button" className="btn" onClick={reset}>
          Try again
        </button>
        <p style={{ fontSize: "0.75rem", marginTop: "0.85rem", color: "var(--text-muted)" }}>
          If the main area stays blank, stop the app and run{" "}
          <code>powershell -File dev.ps1</code> from the project root (this clears a stale Next.js
          cache). Then hard-refresh the browser with Ctrl+Shift+R.
        </p>
      </div>
    </div>
  );
}
