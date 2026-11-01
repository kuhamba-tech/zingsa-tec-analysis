"use client";

import { useEffect, useState } from "react";
import { getSolarBrief, type SolarBriefResponse } from "@/lib/api";
import type { SolarActivityFull, SpaceWeatherCurrent } from "@/lib/types";
import SwSectionBanner from "./SwSectionBanner";
import {
  buildZimbabweIndexAlerts,
  densityWords,
  fieldWords,
  formatAlertUtc,
  kpWords,
  orientationWords,
  windWords,
} from "@/lib/zimbabweIndexAlerts";
import styles from "./ZimbabweIndexAlerts.module.css";

function numberText(value: number | null | undefined, digits: number, suffix: string): string {
  if (value == null || !Number.isFinite(value)) return "not available";
  const number = value.toFixed(digits);
  return suffix ? `${number} ${suffix}` : number;
}

function forecastSentence(brief: SolarBriefResponse): string {
  const parts: string[] = [];
  if (brief.earth_directed_cme === false) {
    parts.push("NOAA's coronagraph check shows no Earth-directed coronal mass ejection.");
  } else if (brief.earth_directed_cme === true) {
    parts.push("NOAA reports an Earth-directed coronal mass ejection.");
  }
  if (brief.coronal_hole_stream) {
    const polarity = brief.stream_polarity ? `${brief.stream_polarity}-polarity ` : "";
    const window = brief.storm_window ? ` The stated arrival window is ${brief.storm_window}.` : "";
    parts.push(`A ${polarity}coronal-hole high-speed stream is in the forecast.${window}`);
  }
  if (brief.expected_kp != null) {
    const scale = brief.expected_kp_scale ? ` (${brief.expected_kp_scale})` : "";
    const window = brief.expected_kp_window ? ` for ${brief.expected_kp_window}` : "";
    parts.push(`The greatest expected 3-hour Kp${window} is ${brief.expected_kp}${scale}.`);
  }
  parts.push("Over Zimbabwe that arrival is checked on TEC and S4 from the CORS network.");
  return parts.join(" ");
}

export default function ZimbabweIndexAlerts({
  sw,
  solar,
  now,
}: {
  sw: SpaceWeatherCurrent | null;
  solar: SolarActivityFull | null;
  now: number;
}) {
  const [brief, setBrief] = useState<SolarBriefResponse | null>(null);
  const [briefFailed, setBriefFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      getSolarBrief()
        .then((payload) => {
          if (cancelled) return;
          setBrief((current) => {
            if ((current?.c_percent != null || current?.earth_facing_region_count != null) && payload.mode === "unavailable") {
              return current;
            }
            return payload;
          });
          setBriefFailed(false);
        })
        .catch(() => {
          if (!cancelled) setBriefFailed(true);
        });
    };
    load();
    const timer = window.setInterval(load, 5 * 60_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  const clock = new Date(now);
  const alerts = buildZimbabweIndexAlerts(sw, solar, clock);
  const retrieved = formatAlertUtc(sw?.updated_utc) ?? formatAlertUtc(solar?.updated);
  const plasmaFresh = Boolean(solar?.feed_status?.solar_wind_plasma?.fresh);
  const magFresh = Boolean(solar?.feed_status?.solar_wind_mag?.fresh);
  const speed = plasmaFresh ? solar?.solar_wind?.speed : null;
  const density = plasmaFresh ? solar?.solar_wind?.density : null;
  const bt = magFresh ? solar?.solar_wind?.bt : null;
  const bz = magFresh ? solar?.solar_wind?.bz : null;
  const regionCount = brief?.earth_facing_region_count ?? brief?.spotted_region_count ?? null;

  return (
    <section className={`card ${styles.panel}`} aria-labelledby="zimbabwe-index-alerts-title">
      <SwSectionBanner
        icon="🇿🇼"
        title="Zimbabwe index alerts"
        titleId="zimbabwe-index-alerts-title"
        tone={alerts.length ? "warn" : sw ? "ok" : "off"}
        meta={<span>{alerts.length ? `${alerts.length} past a limit` : "No limit crossed"}</span>}
      />
      <p className={styles.note}>
        These codes belong to this dashboard. A code is issued only when a measured index passes the
        limit already used here. The value, what it means, the retrieval time, and the validity time
        are on each alert. NOAA bulletins stay in the list below and keep the bureau codes.
      </p>

      <div>
        <h3 className={styles.heading}>Geomagnetics{retrieved ? ` as of ${retrieved}` : ""}</h3>
        <div className={styles.facts}>
          <Fact label="Kp" value={sw?.kp == null ? "not available" : `${sw.kp.toFixed(1)}: ${kpWords(sw.kp)}`} />
          <Fact label="Solar wind speed" value={speed == null || speed <= 0 ? "not available" : `${speed.toFixed(0)} km/s: ${windWords(speed)}`} />
          <Fact label="Solar wind density" value={density == null || density <= 0 ? "not available" : `${density.toFixed(1)} /cm³: ${densityWords(density)}`} />
          <Fact label="IMF strength" value={bt == null || bt <= 0 ? "not available" : `${bt.toFixed(1)} nT: ${fieldWords(bt)}`} />
          <Fact label="IMF orientation" value={bz == null ? "not available" : `${orientationWords(bz)} (${bz.toFixed(1)} nT)`} />
          <Fact label="Dst" value={numberText(sw?.dst, 0, "nT")} />
          <Fact label="Zimbabwe TEC" value={numberText(sw?.mean_vtec, 1, "TECU")} />
          <Fact label="S4" value={numberText(sw?.s4, 2, "")} />
        </div>
      </div>

      <div>
        <h3 className={styles.heading}>Solar activity (UTC)</h3>
        <p>
          {regionCount == null
            ? briefFailed
              ? "The NOAA region summary could not be read."
              : "Waiting for the NOAA region summary."
            : `There ${regionCount === 1 ? "is" : "are"} ${regionCount} sunspot region${regionCount === 1 ? "" : "s"} on the Earth-facing side.`}
          {brief?.sunspot_number != null ? ` The sunspot number from those centers is ${brief.sunspot_number}.` : ""}
        </p>
        <h3 className={styles.heading}>Flaring probabilities</h3>
        <div className={styles.facts}>
          <Fact label="C-flaring" value={brief?.c_percent == null ? "—" : `${brief.c_percent}%`} />
          <Fact label="M-flaring" value={brief?.m_percent == null ? "—" : `${brief.m_percent}%`} />
          <Fact label="X-flaring" value={brief?.x_percent == null ? "—" : `${brief.x_percent}%`} />
        </div>
        <h3 className={styles.heading}>Solar flaring</h3>
        <p>
          {brief?.flares_today
            ? `Today so far: ${brief.flares_today.label}. Yesterday: ${brief.flares_yesterday?.label ?? "—"}. These are GOES flares of class C or higher.`
            : "The GOES flare list for today and yesterday is not available."}
        </p>
        <h3 className={styles.heading}>Forecast</h3>
        <p>{brief ? forecastSentence(brief) : "Waiting for the NOAA forecast."}</p>
      </div>

      <div>
        <h3 className={styles.heading}>Codes past a limit</h3>
        {alerts.length === 0 ? (
          <p>No measured index is past its limit at this retrieval.</p>
        ) : (
          <ul className={styles.list}>
            {alerts.map((alert) => (
              <li key={alert.code} className={styles.alert}>
                <div className={styles.codeRow}>
                  <strong>{alert.code}</strong>
                  <span>{alert.name}</span>
                  <span className={styles.severity}>{alert.severity}</span>
                </div>
                <p><strong>Value:</strong> {alert.valueText}. <strong>Limit:</strong> {alert.limitText}</p>
                <p>{alert.meaning} {alert.explanation}</p>
                <p>
                  Retrieved {alert.retrievedAt}. Valid from {alert.validFrom} to {alert.validTo}.
                  {alert.expired ? " This copy is past that validity; it remains the latest sample held." : ""}
                </p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className={styles.fact}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}
