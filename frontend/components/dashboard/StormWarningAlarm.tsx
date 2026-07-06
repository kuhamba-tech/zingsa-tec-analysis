"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ackEkfAlert, getEkfAlertLog } from "@/lib/api";
import {
  geomagneticAlertLevel,
  startStormAlarmBeep,
  stopStormAlarmBeep,
  unlockStormAlarmAudio,
} from "@/lib/stormAlarmSound";
import type { EkfAlert, EkfStatus, SpaceWeatherCurrent } from "@/lib/types";

/** Prominent warning alarm bar for active / possible geomagnetic storms. */
export default function StormWarningAlarm({
  ekf,
  sw,
  pendingAlerts: externalPending,
  onAcknowledged,
}: {
  ekf: EkfStatus | null;
  sw: SpaceWeatherCurrent | null;
  pendingAlerts?: EkfAlert[];
  /** Called after acknowledge so the parent can clear cached alert lists. */
  onAcknowledged?: () => void;
}) {
  /** User chose to silence beeps for the current storm episode (session only). */
  const [soundMuted, setSoundMuted] = useState(false);
  /** User dismissed the banner for the current alert episode. */
  const [dismissed, setDismissed] = useState(false);
  const wasStormRef = useRef(false);
  const [pendingAlerts, setPendingAlerts] = useState<EkfAlert[]>(externalPending ?? []);

  // Drop legacy 1-hour mute so past sessions do not silence new storms.
  useEffect(() => {
    try {
      localStorage.removeItem("zgiis-storm-alarm-muted-until");
    } catch {
      /* ignore */
    }
  }, []);

  const loadAlerts = useCallback(async () => {
    if (externalPending !== undefined) return;
    const rows = await getEkfAlertLog(24).catch(() => []);
    setPendingAlerts(rows.filter((a) => !a.acknowledged_status));
  }, [externalPending]);

  useEffect(() => {
    if (externalPending !== undefined) {
      setPendingAlerts(externalPending);
      return;
    }
    loadAlerts();
    const id = window.setInterval(loadAlerts, 120000);
    return () => window.clearInterval(id);
  }, [loadAlerts, externalPending]);

  const kp = sw?.kp ?? null;
  const dst = sw?.dst ?? null;
  const geoLevel = geomagneticAlertLevel(sw);
  const activeStorm = geoLevel === "storm";
  const elevated = geoLevel === "possible";
  const ekfCount = ekf?.active_alert_count ?? pendingAlerts.length;
  const banner = ekf?.banner;
  const geomagneticStorm = activeStorm;
  const severeStorm = kp != null && kp >= 7;

  // Each new geomagnetic storm episode starts with sound ON and banner visible.
  useEffect(() => {
    if (geomagneticStorm && !wasStormRef.current) {
      setSoundMuted(false);
      setDismissed(false);
    }
    wasStormRef.current = geomagneticStorm;
  }, [geomagneticStorm]);

  const showBanner =
    !dismissed && (activeStorm || elevated || ekfCount > 0 || !!banner);
  const shouldBeep = geomagneticStorm && !soundMuted && !dismissed;

  const label = useMemo(() => {
    const parts: string[] = [];
    if (activeStorm && kp != null) {
      parts.push(`GEOMAGNETIC STORM — Kp ${kp.toFixed(0)}${ekf?.kp_storm_level ? ` (${ekf.kp_storm_level})` : ""}`);
    } else if (elevated && kp != null) {
      parts.push(`Possible geomagnetic storm — Kp ${kp.toFixed(0)}`);
    } else if (elevated && dst != null) {
      parts.push(`Possible geomagnetic storm — Dst ${dst.toFixed(0)} nT`);
    }
    if (banner) parts.push(banner.replace(/^⚠\s?/, ""));
    const total = Math.max(ekfCount, pendingAlerts.length) + (activeStorm ? 1 : 0);
    return { text: parts.join(" · ") || "Geomagnetic conditions require attention", total };
  }, [activeStorm, elevated, kp, dst, banner, ekfCount, pendingAlerts.length, ekf?.kp_storm_level]);

  useEffect(() => {
    if (!shouldBeep) {
      stopStormAlarmBeep();
      return;
    }

    const stop = startStormAlarmBeep(severeStorm);

    const unlock = () => {
      unlockStormAlarmAudio();
      document.removeEventListener("pointerdown", unlock);
      document.removeEventListener("keydown", unlock);
    };
    document.addEventListener("pointerdown", unlock);
    document.addEventListener("keydown", unlock);
    unlockStormAlarmAudio();

    return () => {
      stop();
      document.removeEventListener("pointerdown", unlock);
      document.removeEventListener("keydown", unlock);
    };
  }, [shouldBeep, severeStorm]);

  const handleMute = () => {
    stopStormAlarmBeep();
    setSoundMuted(true);
  };

  const handleUnmute = () => {
    setSoundMuted(false);
    unlockStormAlarmAudio();
  };

  const handleAckAll = async () => {
    stopStormAlarmBeep();
    const unacked = pendingAlerts.filter((a) => !a.acknowledged_status);
    await Promise.all(unacked.map((a) => ackEkfAlert(a.alert_id).catch(() => null)));
    if (externalPending !== undefined) {
      onAcknowledged?.();
    } else {
      await loadAlerts();
    }
    setDismissed(true);
  };

  if (!showBanner) return null;

  const severityClass = activeStorm || (ekf?.kp_storm_level && kp != null && kp >= 7)
    ? "storm-alarm-bar--severe"
    : "storm-alarm-bar--warn";

  return (
    <div className={`storm-alarm-bar ${severityClass}`} role="alert" aria-live="assertive">
      <div className="storm-alarm-bar-main">
        <span className="storm-alarm-bar-icon" aria-hidden>
          {soundMuted || !geomagneticStorm ? "🔇" : "🔊"}
        </span>
        <div className="storm-alarm-bar-copy">
          <strong>WARNING ALARM — {label.total} active alert{label.total === 1 ? "" : "s"}</strong>
          <span className="storm-alarm-bar-msg">
            {label.text}
            {geomagneticStorm && soundMuted ? " · Alarm sound muted" : ""}
          </span>
        </div>
      </div>
      <div className="storm-alarm-bar-actions">
        {geomagneticStorm && (
          soundMuted ? (
            <button type="button" className="storm-alarm-btn" onClick={handleUnmute} title="Turn alarm sound back on">
              🔊 Unmute
            </button>
          ) : (
            <button type="button" className="storm-alarm-btn" onClick={handleMute} title="Silence alarm beeps for this storm">
              🔇 Mute
            </button>
          )
        )}
        <button type="button" className="storm-alarm-btn storm-alarm-btn-ack" onClick={handleAckAll}>
          ✓ Acknowledge
        </button>
      </div>
    </div>
  );
}
