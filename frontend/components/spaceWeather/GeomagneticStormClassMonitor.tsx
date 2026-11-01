"use client";

import { useMemo } from "react";
import {
  buildGeomagneticStormWatch,
  geomagneticStormGuideParagraphs,
  GST_BANDS,
} from "@/lib/geomagneticStormWatch";
import { formatKpDisplay } from "@/lib/spaceWeatherMetrics";
import type { SolarActivityFull, SpaceWeatherCurrent } from "@/lib/types";
import styles from "./FlareClassMonitor.module.css";

export default function GeomagneticStormClassMonitor({
  solar,
  sw,
  now = Date.now(),
}: {
  solar: SolarActivityFull | null;
  sw: SpaceWeatherCurrent | null;
  now?: number;
}) {
  const watch = useMemo(() => buildGeomagneticStormWatch(solar, sw, now), [solar, sw, now]);
  const guide = useMemo(() => geomagneticStormGuideParagraphs(watch), [watch]);
  const alerting = Boolean(watch.alert) || watch.liveAlert;

  return (
    <section className={`card ${styles.panel}`} aria-label="Geomagnetic storm class monitor">
      <h2 className={styles.title}>Geomagnetic storm class monitor</h2>
      <p className={styles.now}>
        Kp now:{" "}
        <strong>
          {watch.liveKp != null ? formatKpDisplay(watch.liveKp) : "Updating"}
        </strong>
        {watch.liveLabel ? ` · ${watch.liveLabel}` : ""}. {watch.sourceLabel}.
      </p>
      <div className={styles.scale} role="list" aria-label="Geomagnetic storm classes in this window">
        {GST_BANDS.map((band) => {
          const active = watch.alert?.code === band.id || watch.liveCode === band.id;
          return (
            <div
              key={band.id}
              role="listitem"
              className={`${styles.step}${active ? ` ${styles.stepOn}` : ""}`}
              style={{ color: band.color }}
            >
              <span className={styles.letter}>{band.label}</span>
              <span className={styles.count}>{watch.counts[band.id]}</span>
              <span className={styles.desc}>{band.desc}</span>
            </div>
          );
        })}
      </div>
      {alerting ? (
        <div className={`${styles.alert} banner banner-alert`} role="alert">
          <strong>Geomagnetic storm alert.</strong>{" "}
          {watch.liveAlert && watch.liveKp != null
            ? `Live Kp is ${formatKpDisplay(watch.liveKp)}, ${watch.liveLabel}, at or above the G1 line. `
            : ""}
          {watch.alert
            ? `A ${watch.alert.code} interval, Kp ${formatKpDisplay(watch.alert.kp)}, began at ${watch.alert.timeLabel}.`
            : ""}
          {watch.alert && !watch.liveAlert && watch.liveLabel
            ? ` Live Kp is ${watch.liveKp != null ? formatKpDisplay(watch.liveKp) : "unavailable"}, ${watch.liveLabel}, which is below the G1 line.`
            : ""}
        </div>
      ) : (
        <p className={styles.quiet}>
          {watch.liveKp != null
            ? `No geomagnetic-storm alert. Kp is ${formatKpDisplay(watch.liveKp)}, ${watch.liveLabel}, below the G1 line.${
                watch.newest
                  ? ` The newest listed storm is ${watch.newest.code}, Kp ${formatKpDisplay(watch.newest.kp)}, at ${watch.newest.timeLabel}.`
                  : " No storm interval is in this window."
              }`
            : "Kp is not in the current snapshot, so no geomagnetic-storm alert is issued."}
        </p>
      )}
      {watch.recent.length > 0 && (
        <ul className={styles.list}>
          {watch.recent.map((event) => (
            <li key={`${event.code}-${event.timeMs}`}>
              <span className={styles.listClass}>{event.code} · Kp {formatKpDisplay(event.kp)}</span>
              <span>{event.timeLabel}</span>
            </li>
          ))}
        </ul>
      )}
      {guide.map((paragraph) => (
        <p key={paragraph.slice(0, 48)} className={styles.body}>
          {paragraph}
        </p>
      ))}
    </section>
  );
}
