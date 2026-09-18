"use client";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body>
        <div className="page-stack" style={{ padding: "1.5rem" }}>
          <h2>The application failed to load</h2>
          <p>{error.message || "An unexpected error occurred."}</p>
          <button type="button" onClick={reset}>
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
