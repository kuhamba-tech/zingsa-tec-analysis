"use client";

import { useCallback, useEffect, useState } from "react";
import {
  getNavigationFacebookStatus,
  testNavigationFacebookPost,
} from "@/lib/api";
import { OFFLINE_FACEBOOK_STATUS } from "@/lib/navigationFacebookDefaults";
import type { NavigationFacebookPostResult, NavigationFacebookStatus } from "@/lib/types";

/** Test post Navigation News to the Stellar Aspirations Facebook Page. */
export default function FacebookPostPanel() {
  const [status, setStatus] = useState<NavigationFacebookStatus>(OFFLINE_FACEBOOK_STATUS);
  const [backendOnline, setBackendOnline] = useState(false);
  const [result, setResult] = useState<NavigationFacebookPostResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setStatus(await getNavigationFacebookStatus());
      setBackendOnline(true);
    } catch (e) {
      setStatus(OFFLINE_FACEBOOK_STATUS);
      setBackendOnline(false);
      const msg = e instanceof Error ? e.message : "Could not load Facebook status";
      setError(
        msg.includes("unreachable") || msg.includes("timed out") || msg.includes("Failed to fetch")
          ? `${msg} Start the FastAPI backend with dev.ps1 (port 8000).`
          : msg.includes("404")
            ? `${msg} — restart the backend with dev.ps1 so Navigation News routes are registered.`
            : msg,
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function runTest(live: boolean) {
    setPosting(true);
    setError(null);
    setResult(null);
    try {
      const out = await testNavigationFacebookPost(live);
      setResult(out);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Facebook test post failed");
    } finally {
      setPosting(false);
    }
  }

  if (loading) {
    return <p className="gnwi-broadcast-muted">Loading Facebook publish settings…</p>;
  }

  return (
    <div className="card gnwi-broadcast-panel gnwi-facebook-panel">
      <h3 className="gnwi-agent-api-title">Facebook Page — Navigation News</h3>
      <p className="gnwi-agent-api-lead">
        Posts a tailored Navigation News digest to the Stellar Aspirations Facebook Page every 4 hours
        (with WhatsApp broadcasts). Page:{" "}
        <a href={status.page_url} target="_blank" rel="noopener noreferrer">
          Stellar Aspirations on Facebook
        </a>
      </p>

      {error && <div className="banner banner-warn" style={{ marginBottom: "0.75rem" }}>{error}</div>}

      <div className="gnwi-broadcast-status-grid">
        <div className="gnwi-broadcast-stat">
          <span className="gnwi-broadcast-stat-label">Page ID</span>
          <strong style={{ fontSize: "0.85rem" }}>{backendOnline ? status.page_id : "—"}</strong>
          <span className="gnwi-broadcast-stat-sub">
            {!backendOnline
              ? "Start backend to load"
              : status.configured
                ? "Resolved from your page token"
                : "Add token in backend/.env"}
          </span>
        </div>
        <div className="gnwi-broadcast-stat">
          <span className="gnwi-broadcast-stat-label">API token</span>
          <strong>
            {!backendOnline ? "Unknown" : status.configured ? "Configured" : "Missing"}
          </strong>
          <span className="gnwi-broadcast-stat-sub">
            {backendOnline ? "Loaded from backend/.env (private)" : "backend/.env on port 8000"}
          </span>
        </div>
        <div className="gnwi-broadcast-stat">
          <span className="gnwi-broadcast-stat-label">Mode</span>
          <strong>{!backendOnline ? "—" : status.dry_run ? "Dry run" : "Live"}</strong>
          <span className="gnwi-broadcast-stat-sub">
            {!backendOnline ? "Backend offline" : status.enabled ? "Enabled" : "Disabled"}
          </span>
        </div>
      </div>

      <div className="gnwi-broadcast-actions">
        <button type="button" className="btn" disabled={posting || !backendOnline} onClick={() => runTest(false)}>
          {posting ? "Running…" : "Verify post (dry run)"}
        </button>
        <button
          type="button"
          className="btn"
          disabled={posting || !backendOnline || !status.configured || status.dry_run}
          onClick={() => {
            if (!window.confirm("Publish a real test post to the Stellar Aspirations Facebook Page now?")) return;
            void runTest(true);
          }}
          title={
            !status.configured
              ? "Set FACEBOOK_PAGE_ACCESS_TOKEN in backend/.env"
              : status.dry_run
                ? "Set BROADCAST_DRY_RUN=false for live posts"
                : "Post live to Facebook"
          }
        >
          Post live test
        </button>
      </div>

      <p className="gnwi-broadcast-muted" style={{ marginTop: "0.75rem" }}>
        Token and page id are read from <code>backend/.env</code> (or{" "}
        <code>static/data/facebook_credentials.private.json</code>) — never shown on this page.
        Set <code>FACEBOOK_PAGE_ACCESS_TOKEN</code>, optional <code>FACEBOOK_PAGE_ID</code>, and{" "}
        <code>BROADCAST_DRY_RUN=false</code>, then run <code>dev.ps1</code> and refresh.
      </p>

      {result && (
        <div className={`banner ${result.ok ? "banner-ok" : "banner-alert"}`} style={{ marginTop: "0.75rem", fontSize: "0.82rem" }}>
          <strong>{result.ok ? (result.dry_run ? "Post verified (dry run)" : "Posted to Facebook") : "Post failed"}</strong>
          {result.dry_run && result.ok && " — preview only, nothing published"}
          {!result.ok && !status.configured && !result.dry_run && (
            <> · Add <code>FACEBOOK_PAGE_ACCESS_TOKEN</code> to <code>backend/.env</code></>
          )}
          {result.detail && <> · {result.detail}</>}
          {result.message_preview && (
            <p style={{ margin: "0.5rem 0 0", whiteSpace: "pre-wrap" }}>{result.message_preview}</p>
          )}
        </div>
      )}
    </div>
  );
}
