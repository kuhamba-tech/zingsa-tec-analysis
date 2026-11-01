"use client";

import { useMemo } from "react";
import { buildSolarWindWatch, solarWindGuideParagraphs, WIND_BANDS } from "@/lib/solarWindWatch";
import type { SolarActivityFull, TimelinePoint } from "@/lib/types";
import styles from "./FlareClassMonitor.module.css";

export default function SolarWindClassMonitor({
  solar,
  points,
}: {
  solar: SolarActivityFull | null;
  points?: TimelinePoint[] | null;
}) {
  const watch = useMemo(() => buildSolarWindWatch(solar, points), [solar, points]);
  const guide = useMemo(() => solarWindGuideParagraphs(watch), [watch]);

  return (
    <section className={`card ${styles.panel}`} aria-label="Solar wind class monitor">
      <h2 className={styles.title}>Solar wind class monitor</h2>
      <p className={styles.now}>
        Speed now:{" "}
        <strong>{watch.speed != null ? `${Math.round(watch.speed)} km/s` : "Updating"}</strong>
        {watch.bandLabel ? ` · ${watch.bandLabel}` : ""}. NOAA SWPC RTSW.
      </p>
      <div className={styles.scale} role="list" aria-label="Solar wind speed classes in this series">
        {WIND_BANDS.map((band) => {
          const active = watch.band === band.id;
          return (
            <div
              key={band.id}
              role="listitem"
              className={`${styles.step}${active ? ` ${styles.stepOn}` : ""}`}
              style={{ color: band.color }}
            >
              <span className={styles.letter} style={{ fontSize: "0.72rem" }}>{band.label}</span>
              <span className={styles.count}>{watch.counts[band.id]}</span>
              <span className={styles.desc}>{band.desc}</span>
            </div>
          );
        })}
      </div>
      {watch.alerts.length > 0 ? (
        <div className={`${styles.alert} banner banner-alert`} role="alert">
          <strong>Solar wind alert.</strong> {watch.alerts.join(" ")}
          {watch.observedLabel ? ` Sample ${watch.observedLabel}.` : ""}
        </div>
      ) : (
        <p className={styles.quiet}>
          {watch.speed != null
            ? `No solar-wind alert. Speed is ${watch.bandLabel ?? "inside the scale"}, density ${watch.density != null ? `${watch.density.toFixed(1)} /cm³` : "is not in this sample"}, Bz ${watch.bz != null ? `${watch.bz.toFixed(1)} nT` : "is not in this sample"}, and Bt ${watch.bt != null ? `${watch.bt.toFixed(1)} nT` : "is not in this sample"}.`
            : "Solar wind speed is not in the current feed, so no wind alert is issued."}
        </p>
      )}
      {watch.episodes.length > 0 && (
        <ul className={styles.list}>
          {watch.episodes.map((episode) => (
            <li key={`${episode.timeLabel}-${episode.speed}`}>
              <span className={styles.listClass}>{episode.label} · {episode.speed} km/s</span>
              <span>{episode.timeLabel}</span>
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
