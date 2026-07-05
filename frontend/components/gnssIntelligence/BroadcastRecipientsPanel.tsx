"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { getBroadcastOverview } from "@/lib/api";
import { audienceRoleLabel } from "@/lib/navigationNewsAudiences";
import { accessibilityLabel, languageLabel } from "@/lib/navigationDeliveryOptions";
import type { BroadcastRecipient, NavigationBroadcastStatus } from "@/lib/types";

function fmtTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  return iso.replace("T", " ").slice(0, 19) + " UTC";
}

/** Public broadcast status — recipient IDs and registration are managed privately server-side. */
export default function BroadcastRecipientsPanel() {
  const [recipients, setRecipients] = useState<BroadcastRecipient[]>([]);
  const [status, setStatus] = useState<NavigationBroadcastStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const summary = useMemo(() => {
    const active = recipients.filter((r) => r.active);
    const phones = active.filter((r) => r.recipient_type === "phone").length;
    const roles = [...new Set(active.map((r) => r.audience))];
    return { active: active.length, phones, roles };
  }, [recipients]);

  const load = useCallback(async () => {
    setError(null);
    try {
      const overview = await getBroadcastOverview();
      setRecipients(overview.recipients);
      setStatus(overview.status);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Could not load broadcast settings";
      setError(
        msg.includes("404")
          ? `${msg} — run dev.ps1 to start the FastAPI backend on port 8000.`
          : msg,
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const id = window.setInterval(load, 120_000);
    return () => window.clearInterval(id);
  }, [load]);

  if (loading) {
    return (
      <div className="card gnwi-broadcast-panel">
        <p className="gnwi-broadcast-muted">Loading WhatsApp broadcast status…</p>
      </div>
    );
  }

  return (
    <div className="card gnwi-broadcast-panel">
      <h3 className="gnwi-broadcast-title">WhatsApp Navigation News</h3>
      <p className="gnwi-broadcast-lead">
        Tailored Navigation News briefs are delivered every 4 hours in each recipient&apos;s preferred
        language and format — including visual briefs for deaf users and screen-reader friendly text
        for blind users. WhatsApp numbers are configured privately by ZINGSA staff.
      </p>

      {error && <div className="banner banner-error">{error}</div>}

      {status && (
        <div className="gnwi-broadcast-stats">
          <div className="gnwi-broadcast-stat">
            <span className="gnwi-broadcast-stat-label">Broadcast schedule</span>
            <strong>{status.enabled ? "Active" : "Paused"}</strong>
            <span className="gnwi-broadcast-stat-sub">Every {status.interval_hours}h</span>
          </div>
          <div className="gnwi-broadcast-stat">
            <span className="gnwi-broadcast-stat-label">Active recipients</span>
            <strong>{status.active_recipient_count}</strong>
            <span className="gnwi-broadcast-stat-sub">
              {summary.phones > 0 ? `${summary.phones} phone(s)` : "None configured yet"}
            </span>
          </div>
          <div className="gnwi-broadcast-stat">
            <span className="gnwi-broadcast-stat-label">Last broadcast</span>
            <strong style={{ fontSize: "0.9rem" }}>{fmtTime(status.last_broadcast_at)}</strong>
          </div>
          <div className="gnwi-broadcast-stat">
            <span className="gnwi-broadcast-stat-label">Next broadcast</span>
            <strong style={{ fontSize: "0.9rem" }}>{fmtTime(status.next_broadcast_at)}</strong>
          </div>
          <div className="gnwi-broadcast-stat">
            <span className="gnwi-broadcast-stat-label">Delivery mode</span>
            <strong>{status.whatsapp_configured ? "WhatsApp ready" : "Not configured"}</strong>
            <span className="gnwi-broadcast-stat-sub">{status.dry_run ? "Dry run (no live sends)" : "Live sends"}</span>
          </div>
        </div>
      )}

      {summary.roles.length > 0 && (
        <p className="gnwi-broadcast-role-preview">
          <strong>Audiences covered:</strong>{" "}
          {summary.roles.map((role) => audienceRoleLabel(role)).join(" · ")}
        </p>
      )}

      {recipients.length > 0 && (
        <div className="table-scroll compact">
          <table className="dark-table gnwi-broadcast-table">
            <thead>
              <tr>
                <th>Label</th>
                <th>Role / brief</th>
                <th>Language</th>
                <th>Format</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {recipients.map((rec) => (
                <tr key={rec.recipient_id}>
                  <td>{rec.display_name}</td>
                  <td>{audienceRoleLabel(rec.audience)}</td>
                  <td>{rec.language_label ?? languageLabel(rec.language ?? "en")}</td>
                  <td>{rec.accessibility_label ?? accessibilityLabel(rec.accessibility ?? "standard")}</td>
                  <td>{rec.active ? "Active" : "Paused"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {status && status.recent_deliveries.length > 0 && (
        <>
          <h4 className="gnwi-broadcast-form-title" style={{ marginTop: "1.25rem" }}>
            Recent deliveries
          </h4>
          <ul className="gnwi-broadcast-delivery-list">
            {status.recent_deliveries.map((d) => (
              <li key={d.delivery_id} className={d.ok ? "gnwi-delivery-ok" : "gnwi-delivery-fail"}>
                <span>{fmtTime(d.sent_at)}</span>
                <span>{d.display_name ?? "Recipient"}</span>
                <span>{d.audience ? audienceRoleLabel(d.audience) : "—"}</span>
                <span>{d.dry_run ? "dry-run" : d.ok ? "sent" : "failed"}</span>
              </li>
            ))}
          </ul>
        </>
      )}

      <p className="gnwi-broadcast-muted" style={{ marginTop: "1rem" }}>
        To register privately, send your administrator: contact label, WhatsApp number, role (farmer,
        surveyor, etc.), preferred language (English, ChiShona, isiNdebele), and format (standard,
        deaf/visual, or blind/screen-reader). Example private file entry:
        {" "}
        <code>static/data/broadcast_recipients.private.json</code>
      </p>
    </div>
  );
}
