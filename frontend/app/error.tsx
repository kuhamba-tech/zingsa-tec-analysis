"use client";

import { isChunkLoadFailure } from "@/components/ChunkLoadRecovery";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const chunkFailed = isChunkLoadFailure(error);

  const retry = () => {
    if (!chunkFailed) {
      reset();
      return;
    }
    const url = new URL(window.location.href);
    url.searchParams.set("_chunk", String(Date.now()));
    window.location.replace(url.toString());
  };

  return (
    <div className="page-stack">
      <div className="banner banner-alert">
        <h2 className="page-title" style={{ fontSize: "1.1rem", marginBottom: "0.5rem" }}>
          Page failed to load
        </h2>
        <p style={{ fontSize: "0.85rem", marginBottom: "0.75rem" }}>
          {chunkFailed
            ? "A file required by this page could not load. Reload the page to try again."
            : error.message || "An unexpected error occurred while rendering this page."}
        </p>
        <button type="button" className="btn" onClick={retry}>
          {chunkFailed ? "Reload page" : "Try again"}
        </button>
      </div>
    </div>
  );
}
