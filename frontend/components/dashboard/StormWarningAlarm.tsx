"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  geomagneticAlertLevel,
  geomagneticAlertMessages,
} from "@/lib/geomagneticStormAlerts";
import {
  startStormAlarmBeep,
  stopStormAlarmBeep,
  unlockStormAlarmAudio,
} from "@/lib/stormAlarmSound";
import type { SpaceWeatherCurrent } from "@/lib/types";

/** Warning alarm for observed geomagnetic storm conditions (Kp / Dst only). */
export default function StormWarningAlarm({
  sw,
}: {
  sw: SpaceWeatherCurrent | null;
  /** @deprecated Ignored — storm alarm is index-based, not EKF. */
  ekf?: unknown;
  /** @deprecated Ignored — storm alarm is index-based, not EKF. */
  pendingAlerts?: unknown;
  onAcknowledged?: () => void;
}) {
  const [soundMuted, setSoundMuted] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const wasStormRef = useRef(false);

  useEffect(() => {
    try {
      localStorage.removeItem("zgiis-storm-alarm-muted-until");
    } catch {
      /* ignore */
    }
  }, []);

  const kp = sw?.kp ?? null;
  const dst = sw?.dst ?? null;
  const geoLevel = geomagneticAlertLevel(sw);
  const activeStorm = geoLevel === "storm";
  const elevated = geoLevel === "possible";
  const geomagneticStorm = activeStorm;
  const severeStorm = kp != null && kp >= 7;

  useEffect(() => {
    if (geomagneticStorm && !wasStormRef.current) {
      setSoundMuted(false);
      setDismissed(false);
    }
    wasStormRef.current = geomagneticStorm;
  }, [geomagneticStorm]);

  const showBanner = !dismissed && (activeStorm || elevated);
  const shouldBeep = geomagneticStorm && !soundMuted && !dismissed;

  const label = useMemo(() => {
    const messages = geomagneticAlertMessages(kp, dst);
    const titleParts: string[] = [];
    if (activeStorm && kp != null && kp >= 5) {
      titleParts.push(`GEOMAGNETIC STORM — Kp ${kp.toFixed(0)}`);
    } else if (activeStorm && dst != null && dst <= -50) {
      titleParts.push(`GEOMAGNETIC STORM — Dst ${dst.toFixed(0)} nT`);
    } else if (elevated && kp != null && kp >= 4) {
      titleParts.push(`Possible geomagnetic storm — Kp ${kp.toFixed(0)}`);
    } else if (elevated && dst != null && dst <= -30) {
      titleParts.push(`Possible geomagnetic storm — Dst ${dst.toFixed(0)} nT`);
    }
    return {
      title: titleParts[0] ?? "Geomagnetic conditions require attention",
      text: messages.join(" · ") || titleParts.join(" · "),
      total: Math.max(1, messages.length),
    };
  }, [activeStorm, elevated, kp, dst]);

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

  const handleDismiss = () => {
    stopStormAlarmBeep();
    setDismissed(true);
  };

  if (!showBanner) return null;

  const severityClass = activeStorm || severeStorm
    ? "storm-alarm-bar--severe"
    : "storm-alarm-bar--warn";

  return (
    <div className={`storm-alarm-bar ${severityClass}`} role="alert" aria-live="assertive">
      <div className="storm-alarm-bar-main">
        <span className="storm-alarm-bar-icon" aria-hidden>
          {soundMuted || !geomagneticStorm ? "🔇" : "🔊"}
        </span>
        <div className="storm-alarm-bar-copy">
          <strong>
            WARNING ALARM — {label.title}
            {label.total > 1 ? ` · ${label.total} indicators` : ""}
          </strong>
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
        <button type="button" className="storm-alarm-btn storm-alarm-btn-ack" onClick={handleDismiss}>
          ✓ Dismiss
        </button>
      </div>
    </div>
  );
}
