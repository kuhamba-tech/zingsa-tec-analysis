"use client";

import { useEffect, useState, type CSSProperties } from "react";
import { getSolarBrief, type SolarBriefResponse } from "@/lib/api";
import type { SolarActivityFull, SpaceWeatherCurrent } from "@/lib/types";
import {
  buildZimbabweIndexAlerts,
  buildZingsaSpaceWeatherUpdate,
  densityWords,
  fieldWords,
  formatAlertUtc,
  kpWords,
  orientationWords,
  windWords,
  type ZimbabweAlertSeverity,
} from "@/lib/zimbabweIndexAlerts";
import {
  dstColor,
  flareProbabilityColor,
  imfBtColor,
  imfBzColor,
  noaaGScaleFromKp,
  s4Color,
  solarWindColor,
  solarWindDensityColor,
  vtecColor,
} from "@/lib/spaceWeatherMetrics";
import styles from "./ZimbabweIndexAlerts.module.css";

function numberText(value: number | null | undefined, digits: number, suffix: string): string {
  if (value == null || !Number.isFinite(value)) return "Unavailable";
  const number = value.toFixed(digits);
  return suffix ? `${number} ${suffix}` : number;
}

function forecastSentence(
  brief: SolarBriefResponse,
  sw: SpaceWeatherCurrent | null,
  solar: SolarActivityFull | null,
): string {
  const parts: string[] = [];
  if (brief.earth_directed_cme === false) {
    parts.push("No Earth-directed coronal mass ejection is reported in the current coronagraph assessment.");
  } else if (brief.earth_directed_cme === true) {
    parts.push("An Earth-directed coronal mass ejection is reported.");
  }
  if (brief.coronal_hole_stream) {
    const polarity = brief.stream_polarity ? `${brief.stream_polarity}-polarity ` : "";
    const window = brief.storm_window ? ` Arrival window: ${brief.storm_window}.` : "";
    parts.push(`A ${polarity}coronal-hole high-speed stream is in the forecast.${window}`);
  }
  if (brief.expected_kp != null) {
    const scale = brief.expected_kp_scale ? ` (${brief.expected_kp_scale})` : "";
    const window = brief.expected_kp_window ? ` for ${brief.expected_kp_window}` : "";
    parts.push(`Greatest expected 3-hour Kp${window}: ${brief.expected_kp}${scale}.`);
  }
  const update = buildZingsaSpaceWeatherUpdate(sw, solar, brief);
  parts.push(update.couplingLine, update.localLine);
  return parts.join(" ");
}

function severityClass(severity: ZimbabweAlertSeverity): string {
  if (severity === "Severe") return styles.alertSevere;
  if (severity === "High") return styles.alertHigh;
  return styles.alertModerate;
}

function severityTextClass(severity: ZimbabweAlertSeverity): string {
  if (severity === "Severe") return styles.severitySevere;
  if (severity === "High") return styles.severityHigh;
  return styles.severityModerate;
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
  const update = buildZingsaSpaceWeatherUpdate(sw, solar, brief);

  return (
    <section className={`card ${styles.panel}`} aria-labelledby="zimbabwe-index-alerts-title">
      <header className={styles.header}>
        <div className={styles.brand}>
          <div className={styles.mark} aria-hidden>
            ZW
          </div>
          <div className={styles.titleBlock}>
            <h2 id="zimbabwe-index-alerts-title">Zimbabwe Index Alerts</h2>
            <p>
              ZINGSA national operating thresholds. Codes are issued only when a measured index
              crosses its configured limit, with value, interpretation, and validity shown below.
            </p>
          </div>
        </div>
        <div className={`${styles.statusChip} ${alerts.length ? styles.statusChipWarn : ""}`}>
          <span className={styles.statusDot} aria-hidden />
          {alerts.length ? `${alerts.length} past limit` : "Within limits"}
        </div>
      </header>

      <div className={styles.section}>
        <h3 className={styles.heading}>
          {update.title}
          {retrieved ? <span className={styles.headingMeta}> · {retrieved}</span> : null}
        </h3>
        <p className={styles.copy}>{update.body}</p>
      </div>

      <div className={styles.section}>
        <h3 className={styles.heading}>
          Geomagnetic conditions
          {retrieved ? <span className={styles.headingMeta}> · {retrieved}</span> : null}
        </h3>
        <div className={styles.facts}>
          <Fact
            label="Kp"
            value={sw?.kp == null ? "Unavailable" : `${sw.kp.toFixed(1)} · ${kpWords(sw.kp)}`}
            valueColor={sw?.kp == null ? undefined : noaaGScaleFromKp(sw.kp).color}
          />
          <Fact
            label="Solar wind speed"
            value={speed == null || speed <= 0 ? "Unavailable" : `${speed.toFixed(0)} km/s · ${windWords(speed)}`}
            valueColor={speed == null || speed <= 0 ? undefined : solarWindColor(speed)}
          />
          <Fact
            label="Solar wind density"
            value={density == null || density <= 0 ? "Unavailable" : `${density.toFixed(1)} /cm³ · ${densityWords(density)}`}
            valueColor={density == null || density <= 0 ? undefined : solarWindDensityColor(density)}
          />
          <Fact
            label="IMF strength"
            value={bt == null || bt <= 0 ? "Unavailable" : `${bt.toFixed(1)} nT · ${fieldWords(bt)}`}
            valueColor={bt == null || bt <= 0 ? undefined : imfBtColor(bt)}
          />
          <Fact
            label="IMF orientation"
            value={bz == null ? "Unavailable" : `${orientationWords(bz)} · ${bz.toFixed(1)} nT`}
            valueColor={bz == null ? undefined : imfBzColor(bz)}
          />
          <Fact
            label="Dst"
            value={numberText(sw?.dst, 0, "nT")}
            valueColor={sw?.dst == null ? undefined : dstColor(sw.dst)}
          />
          <Fact
            label="Zimbabwe TEC"
            value={numberText(sw?.mean_vtec, 1, "TECU")}
            valueColor={sw?.mean_vtec == null ? undefined : vtecColor(sw.mean_vtec)}
          />
          <Fact
            label="S4"
            value={numberText(sw?.s4, 2, "")}
            valueColor={sw?.s4 == null ? undefined : s4Color(sw.s4)}
          />
        </div>
      </div>

      <div className={styles.section}>
        <h3 className={styles.heading}>Solar activity</h3>
        <p className={styles.copy}>
          {regionCount == null
            ? briefFailed
              ? "Earth-facing sunspot summary is unavailable."
              : "Loading Earth-facing sunspot summary…"
            : `${regionCount} Earth-facing sunspot region${regionCount === 1 ? "" : "s"}${
                brief?.sunspot_number != null ? ` · sunspot number ${brief.sunspot_number}` : ""
              }.`}
        </p>
        <h3 className={styles.heading}>Flaring probabilities</h3>
        <div className={styles.flareRow}>
          <Fact
            label="C-class"
            value={brief?.c_percent == null ? "—" : `${brief.c_percent}%`}
            valueColor={flareProbabilityColor("C", brief?.c_percent ?? null)}
          />
          <Fact
            label="M-class"
            value={brief?.m_percent == null ? "—" : `${brief.m_percent}%`}
            valueColor={flareProbabilityColor("M", brief?.m_percent ?? null)}
          />
          <Fact
            label="X-class"
            value={brief?.x_percent == null ? "—" : `${brief.x_percent}%`}
            valueColor={flareProbabilityColor("X", brief?.x_percent ?? null)}
          />
        </div>
        <h3 className={styles.heading}>Observed flares</h3>
        <p className={styles.copy}>
          {brief?.flares_today
            ? `Today: ${brief.flares_today.label}. Yesterday: ${brief.flares_yesterday?.label ?? "—"}. GOES soft X-ray flares, class C and above.`
            : "GOES flare summary for today and yesterday is unavailable."}
        </p>
        <h3 className={styles.heading}>Outlook</h3>
        <p className={styles.copy}>
          {brief ? forecastSentence(brief, sw, solar) : "Solar outlook is loading…"}
        </p>
      </div>

      <div className={styles.section}>
        <h3 className={styles.heading}>Active codes</h3>
        {alerts.length === 0 ? (
          <p className={styles.empty}>All monitored indices are within ZINGSA operating limits.</p>
        ) : (
          <ul className={styles.list}>
            {alerts.map((alert) => (
              <li key={alert.code} className={`${styles.alert} ${severityClass(alert.severity)}`}>
                <div className={styles.codeRow}>
                  <span className={styles.code}>{alert.code}</span>
                  <span className={styles.name}>{alert.name}</span>
                  <span className={`${styles.severity} ${severityTextClass(alert.severity)}`}>{alert.severity}</span>
                </div>
                <div className={styles.metrics}>
                  <span><strong>Value</strong>{alert.valueText}</span>
                  <span><strong>Limit</strong>{alert.limitText}</span>
                </div>
                <p className={styles.body}>
                  {alert.meaning} {alert.explanation}
                </p>
                <p className={styles.validity}>
                  Retrieved {alert.retrievedAt}. Valid {alert.validFrom} – {alert.validTo}.
                  {alert.expired ? " Sample is outside its validity window; latest available reading retained." : ""}
                </p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function Fact({
  label,
  value,
  valueColor,
}: {
  label: string;
  value: string;
  valueColor?: string;
}) {
  const elevated = Boolean(valueColor && valueColor !== "#94a3b8" && valueColor !== "#ffffff");
  return (
    <div
      className={`${styles.fact}${elevated ? ` ${styles.factTinted}` : ""}`}
      style={
        valueColor
          ? ({
              ["--fact-accent" as string]: valueColor,
              borderColor: `${valueColor}55`,
            } as CSSProperties)
          : undefined
      }
    >
      <span>{label}</span>
      <strong style={valueColor ? { color: valueColor } : undefined}>{value}</strong>
    </div>
  );
}
