"use client";

import { useCallback, useEffect, useState } from "react";
import {
  getScientificRagDocuments,
  getScientificRagStatus,
  syncScientificRag,
  type ScientificRagDocument,
  type ScientificRagStatus,
} from "@/lib/api";

export default function ScientificLibraryAdminPage() {
  const [status, setStatus] = useState<ScientificRagStatus | null>(null);
  const [docs, setDocs] = useState<ScientificRagDocument[]>([]);
  const [adminKey, setAdminKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setError(null);
    try {
      const [s, d] = await Promise.all([getScientificRagStatus(), getScientificRagDocuments(200)]);
      setStatus(s);
      setDocs(d.documents || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function runSync() {
    setBusy(true);
    setMessage(null);
    setError(null);
    try {
      const result = await syncScientificRag(3, adminKey.trim() || undefined);
      setMessage(result.message || (result.ok ? "Sync tick completed." : "Sync failed."));
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page" style={{ maxWidth: 1100, margin: "0 auto", padding: "1.25rem" }}>
      <h1 style={{ color: "#ffffff", marginBottom: "0.35rem" }}>Scientific Library (Google Drive RAG)</h1>
      <p style={{ color: "#ffffff", marginBottom: "1rem", lineHeight: 1.5 }}>
        Connect credentials in <code>backend/.env</code> only. This page shows index status and runs short
        incremental sync ticks (suitable for Vercel). Put the Drive folder ID/URL in env — not in the browser.
      </p>

      {error ? <div className="banner banner-warn">{error}</div> : null}
      {message ? <div className="banner banner-info">{message}</div> : null}

      <section className="card" style={{ marginBottom: "1rem", color: "#ffffff" }}>
        <h2 style={{ marginTop: 0 }}>Connection status</h2>
        {!status ? (
          <p>Loading…</p>
        ) : (
          <ul style={{ margin: 0, paddingLeft: "1.1rem", lineHeight: 1.6 }}>
            <li>RAG enabled: {status.enabled ? "yes" : "no"}</li>
            <li>Folder ID set: {status.folder_id_set ? "yes" : "no"}</li>
            <li>Drive configured: {status.drive_configured ? "yes" : "no"}</li>
            <li>Auth mode: {status.auth_mode || "none"}</li>
            <li>Embeddings ready: {status.openai_embeddings_ready ? "yes" : "no"}</li>
            <li>Database ready: {status.database_ready ? "yes" : "no"}{status.database_error ? ` (${status.database_error})` : ""}</li>
            <li>
              Counts: indexed {status.counts.indexed ?? 0} · failed {status.counts.failed ?? 0} · pending{" "}
              {status.counts.pending ?? 0} · chunks {status.counts.chunks ?? 0}
            </li>
          </ul>
        )}
      </section>

      <section className="card" style={{ marginBottom: "1rem", color: "#ffffff" }}>
        <h2 style={{ marginTop: 0 }}>Synchronise documents</h2>
        <p style={{ fontSize: "0.86rem", lineHeight: 1.5 }}>
          Requires <code>X-Scientific-Rag-Admin-Key</code> (or leave blank in local non-production when no key is set).
          Each click indexes up to 3 files.
        </p>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", alignItems: "center" }}>
          <input
            className="form-input"
            type="password"
            placeholder="Admin key"
            value={adminKey}
            onChange={(e) => setAdminKey(e.target.value)}
            style={{ minWidth: "14rem" }}
          />
          <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void runSync()}>
            {busy ? "Syncing…" : "Sync next batch"}
          </button>
          <button type="button" className="btn" onClick={() => void refresh()}>
            Refresh
          </button>
        </div>
      </section>

      <section className="card" style={{ color: "#ffffff" }}>
        <h2 style={{ marginTop: 0 }}>Indexed publications</h2>
        {docs.length === 0 ? (
          <p>No documents indexed yet. Configure Drive env vars, apply <code>scientific_rag.sql</code>, then sync.</p>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table className="sw-report-table" style={{ width: "100%" }}>
              <thead>
                <tr>
                  <th>Title</th>
                  <th>Status</th>
                  <th>Pages</th>
                  <th>Indexed</th>
                  <th>Link</th>
                </tr>
              </thead>
              <tbody>
                {docs.map((doc) => (
                  <tr key={doc.drive_file_id}>
                    <td>{doc.title}</td>
                    <td>
                      {doc.status}
                      {doc.error_message ? ` — ${doc.error_message}` : ""}
                    </td>
                    <td>{doc.page_count ?? "—"}</td>
                    <td>{doc.indexed_at ? doc.indexed_at.slice(0, 19).replace("T", " ") : "—"}</td>
                    <td>
                      {doc.source_url ? (
                        <a href={doc.source_url} target="_blank" rel="noreferrer" style={{ color: "#7dd3fc" }}>
                          Drive
                        </a>
                      ) : (
                        "—"
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
