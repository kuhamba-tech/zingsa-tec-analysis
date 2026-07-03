"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ackEkfAlert, getEkfAlertLog } from "@/lib/api";
import type { EkfAlert, EkfStatus, SpaceWeatherCurrent } from "@/lib/types";

const MUTE_KEY = "zgiis-storm-alarm-muted-until";

function isMuted(): boolean {
  if (typeof window === "undefined") return false;
  const until = Number(localStorage.getItem(MUTE_KEY) || 0);
  return until > Date.now();
}

/** Prominent warning alarm bar for active / possible geomagnetic storms. */
export default function StormWarningAlarm({
  ekf,
  sw,
}: {
  ekf: EkfStatus | null;
  sw: SpaceWeatherCurrent | null;
}) {
  const [muted, setMuted] = useState(false);
  const [pendingAlerts, setPendingAlerts] = useState<EkfAlert[]>([]);

  const loadAlerts = useCallback(async () => {
    const rows = await getEkfAlertLog(24).catch(() => []);
    setPendingAlerts(rows.filter((a) => !a.acknowledged_status));
  }, []);

  useEffect(() => {
    setMuted(isMuted());
    loadAlerts();
    const id = window.setInterval(loadAlerts, 120000);
    return () => window.clearInterval(id);
  }, [loadAlerts]);

  const kp = sw?.kp ?? null;
  const activeStorm = kp != null && kp >= 5;
  const elevated = kp != null && kp >= 4;
  const ekfCount = ekf?.active_alert_count ?? pendingAlerts.length;
  const banner = ekf?.banner;
  const show = !muted && (activeStorm || elevated || ekfCount > 0 || !!banner);

  const label = useMemo(() => {
    const parts: string[] = [];
    if (activeStorm && kp != null) {
      parts.push(`ACTIVE GEOMAGNETIC STORM — Kp ${kp.toFixed(0)}${ekf?.kp_storm_level ? ` (${ekf.kp_storm_level})` : ""}`);
    } else if (elevated && kp != null) {
      parts.push(`Elevated geomagnetic activity — Kp ${kp.toFixed(0)}`);
    }
    if (banner) parts.push(banner.replace(/^⚠\s?/, ""));
    const total = Math.max(ekfCount, pendingAlerts.length) + (activeStorm ? 1 : 0);
    return { text: parts.join(" · ") || "Geomagnetic conditions require attention", total };
  }, [activeStorm, elevated, kp, banner, ekfCount, pendingAlerts.length, ekf?.kp_storm_level]);

  const handleMute = () => {
    const until = Date.now() + 60 * 60 * 1000;
    localStorage.setItem(MUTE_KEY, String(until));
    setMuted(true);
  };

  const handleAckAll = async () => {
    const unacked = pendingAlerts.filter((a) => !a.acknowledged_status);
    await Promise.all(unacked.map((a) => ackEkfAlert(a.alert_id).catch(() => null)));
    await loadAlerts();
  };

  if (!show) return null;

  const severityClass = activeStorm || (ekf?.kp_storm_level && kp != null && kp >= 7)
    ? "storm-alarm-bar--severe"
    : "storm-alarm-bar--warn";

  return (
    <div className={`storm-alarm-bar ${severityClass}`} role="alert" aria-live="assertive">
      <div className="storm-alarm-bar-main">
        <span className="storm-alarm-bar-icon" aria-hidden>🔊</span>
        <div className="storm-alarm-bar-copy">
          <strong>WARNING ALARM — {label.total} active alert{label.total === 1 ? "" : "s"}</strong>
          <span className="storm-alarm-bar-msg">{label.text}</span>
        </div>
      </div>
      <div className="storm-alarm-bar-actions">
        <button type="button" className="storm-alarm-btn" onClick={handleMute} title="Mute for 1 hour">
          🔇 Mute
        </button>
        <button type="button" className="storm-alarm-btn storm-alarm-btn-ack" onClick={handleAckAll}>
          ✓ Acknowledge
        </button>
      </div>
    </div>
  );
}
