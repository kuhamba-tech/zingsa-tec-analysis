"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { getBroadcastOverview, sendNavigationWhatsApp } from "@/lib/api";
import { audienceRoleLabel } from "@/lib/navigationNewsAudiences";
import { accessibilityLabel, languageLabel } from "@/lib/navigationDeliveryOptions";
import type { BroadcastRecipient, NavigationBroadcastRunResult, NavigationBroadcastStatus } from "@/lib/types";

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
  const [sending, setSending] = useState(false);
  const [sendResult, setSendResult] = useState<NavigationBroadcastRunResult | null>(null);

  const summary = useMemo(() => {
    const active = recipients.filter((r) => r.active);
    const phones = active.filter((r) => r.recipient_type === "phone").length;
    const groups = active.filter((r) => r.recipient_type === "group");
    const groupMembers = groups.reduce((sum, r) => sum + (r.member_count || 1), 0);
    const roles = [...new Set(active.map((r) => r.audience))];
    return { active: active.length, phones, groups: groups.length, groupMembers, roles };
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

  async function runSend(live: boolean) {
    setSending(true);
    setError(null);
    setSendResult(null);
    try {
      const out = await sendNavigationWhatsApp(live);
      setSendResult(out);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "WhatsApp send failed");
    } finally {
      setSending(false);
    }
  }

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
              {summary.phones > 0 || summary.groups > 0
                ? [
                    summary.phones > 0 ? `${summary.phones} individual(s)` : null,
                    summary.groups > 0 ? `${summary.groups} group(s) · ${summary.groupMembers} member(s)` : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")
                : "None configured yet"}
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

      <div className="gnwi-broadcast-actions" style={{ marginTop: "1rem" }}>
        <button
          type="button"
          className="btn"
          disabled={sending || !status}
          onClick={() => void runSend(false)}
        >
          {sending ? "Sending…" : "Send now (dry run)"}
        </button>
        <button
          type="button"
          className="btn btn-primary"
          disabled={
            sending ||
            !status ||
            !status.whatsapp_configured ||
            status.dry_run ||
            status.active_recipient_count === 0
          }
          onClick={() => {
            if (
              !window.confirm(
                `Send live Navigation News to ${status?.active_recipient_count ?? 0} WhatsApp recipient(s) now?`,
              )
            ) {
              return;
            }
            void runSend(true);
          }}
          title={
            !status?.whatsapp_configured
              ? "Set WHATSAPP_ACCESS_TOKEN and WHATSAPP_PHONE_NUMBER_ID in backend/.env"
              : status?.dry_run
                ? "Set BROADCAST_DRY_RUN=false for live delivery"
                : status?.active_recipient_count === 0
                  ? "Add recipients in static/data/broadcast_recipients.private.json"
                  : "Deliver tailored briefs to all active recipients"
          }
        >
          {sending ? "Sending…" : "Send live to WhatsApp"}
        </button>
      </div>

      {sendResult && (
        <div
          className={`banner ${sendResult.ok ? "banner-info" : "banner-warn"}`}
          style={{ marginTop: "0.75rem" }}
          role="status"
        >
          {sendResult.skipped
            ? `Skipped: ${sendResult.reason ?? "no recipients"}`
            : sendResult.dry_run
              ? `Dry run — ${sendResult.recipient_count ?? 0} recipient(s) would receive "${sendResult.headline ?? "Navigation News"}".`
              : `Sent to ${(sendResult.deliveries ?? []).filter((d) => d.ok).length}/${sendResult.recipient_count ?? 0} recipient(s).`}
        </div>
      )}

      {recipients.length > 0 && (
        <div className="table-scroll compact">
          <table className="dark-table gnwi-broadcast-table">
            <thead>
              <tr>
                <th>Label</th>
                <th>Type</th>
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
                  <td>
                    {rec.recipient_type === "group"
                      ? `Group (${rec.member_count} member${rec.member_count === 1 ? "" : "s"})`
                      : "Individual"}
                  </td>
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
        <strong>Setup:</strong> Add Meta WhatsApp Cloud API credentials to{" "}
        <code>backend/.env</code> (<code>WHATSAPP_ACCESS_TOKEN</code>,{" "}
        <code>WHATSAPP_PHONE_NUMBER_ID</code>), set <code>BROADCAST_DRY_RUN=false</code> for live
        sends, and register recipients in{" "}
        <code>static/data/broadcast_recipients.private.json</code> (copy from the{" "}
        <code>.example</code> file). Each entry needs: contact label, WhatsApp number (E.164, e.g.{" "}
        <code>263771234567</code>), role (farmer, surveyor, etc.), language, and format.
      </p>
      <p className="gnwi-broadcast-muted" style={{ marginTop: "0.5rem" }}>
        <strong>WhatsApp groups:</strong> Meta&apos;s Cloud API can&apos;t post into a WhatsApp
        group chat directly — there&apos;s no API for that — so a &quot;group&quot; entry sends the
        same brief individually to every member&apos;s own chat. Set{" "}
        <code>&quot;recipient_type&quot;: &quot;group&quot;</code> and list every member&apos;s
        number in <code>whatsapp_to</code>, comma-separated (e.g.{" "}
        <code>&quot;263771234567,263779876543&quot;</code>).
      </p>
    </div>
  );
}
