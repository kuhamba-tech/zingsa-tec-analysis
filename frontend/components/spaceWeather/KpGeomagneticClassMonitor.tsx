"use client";

import { useMemo } from "react";
import {
  buildKpGeomagneticWatch,
  kpGeomagneticGuideParagraphs,
} from "@/lib/kpGeomagneticWatch";
import { formatKpDisplay, KP_GEOMAGNETIC_SCALE } from "@/lib/spaceWeatherMetrics";
import type { SpaceWeatherCurrent, TimelinePoint } from "@/lib/types";
import styles from "./FlareClassMonitor.module.css";

export default function KpGeomagneticClassMonitor({
  sw,
  points,
}: {
  sw: SpaceWeatherCurrent | null;
  points?: TimelinePoint[] | null;
}) {
  const watch = useMemo(() => buildKpGeomagneticWatch(sw, points), [sw, points]);
  const guide = useMemo(() => kpGeomagneticGuideParagraphs(watch), [watch]);

  return (
    <section className={`card ${styles.panel}`} aria-label="Geomagnetic storm scale">
      <h2 className={styles.title}>Geomagnetic storm scale</h2>
      <p className={styles.now}>
        Kp now:{" "}
        <strong>{watch.kp != null ? formatKpDisplay(watch.kp) : "Updating"}</strong>
        {watch.bandLabel ? ` · ${watch.bandLabel}` : ""}. NOAA SWPC Kp → G-scale.
      </p>
      <div className={`${styles.scale} ${styles.scaleKp}`} role="list" aria-label="Kp classes in this series">
        {KP_GEOMAGNETIC_SCALE.map((band) => {
          const active = watch.band === band.id;
          return (
            <div
              key={band.id}
              role="listitem"
              className={`${styles.step}${active ? ` ${styles.stepOn}` : ""}`}
              style={{ color: band.color }}
            >
              <span className={styles.letter} style={{ fontSize: "0.72rem" }}>{band.short}</span>
              <span className={styles.count}>{watch.counts[band.id]}</span>
              <span className={styles.desc}>{band.code}</span>
            </div>
          );
        })}
      </div>
      {watch.alert ? (
        <div className={`${styles.alert} banner banner-alert`} role="alert">
          <strong>Kp alert.</strong> {watch.alert}
          {watch.observedLabel ? ` Snapshot ${watch.observedLabel}.` : ""}
        </div>
      ) : (
        <p className={styles.quiet}>
          {watch.kp != null
            ? `No Kp alert. Kp is ${formatKpDisplay(watch.kp)}, ${watch.bandLabel}. The watch starts at Kp 4, Active. G1 begins at Kp 5.`
            : "Kp is not in the current index snapshot, so no geomagnetic alert is issued."}
        </p>
      )}
      {watch.episodes.length > 0 && (
        <ul className={styles.list}>
          {watch.episodes.map((episode) => (
            <li key={`${episode.timeLabel}-${episode.kp}`}>
              <span className={styles.listClass}>{episode.label} · Kp {formatKpDisplay(episode.kp)}</span>
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
