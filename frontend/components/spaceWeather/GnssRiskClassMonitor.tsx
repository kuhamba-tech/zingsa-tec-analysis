"use client";

import { useMemo } from "react";
import { buildGnssRiskWatch, GNSS_RISK_BANDS, gnssRiskGuideParagraphs } from "@/lib/gnssRiskWatch";
import type { SpaceWeatherCurrent, TimelinePoint } from "@/lib/types";
import styles from "./FlareClassMonitor.module.css";

export default function GnssRiskClassMonitor({
  sw,
  points,
}: {
  sw: SpaceWeatherCurrent | null;
  points?: TimelinePoint[] | null;
}) {
  const watch = useMemo(() => buildGnssRiskWatch(sw, points), [sw, points]);
  const guide = useMemo(() => gnssRiskGuideParagraphs(watch), [watch]);

  return (
    <section className={`card ${styles.panel}`} aria-label="GNSS risk class monitor">
      <h2 className={styles.title}>GNSS risk class monitor</h2>
      <p className={styles.now}>
        Risk now:{" "}
        <strong>{watch.label ?? "Updating"}</strong>
        . Provisional ZGIIS label.
      </p>
      <div
        className={styles.scale}
        role="list"
        aria-label="GNSS risk classes in this series"
        style={{ gridTemplateColumns: "repeat(4, minmax(0, 1fr))" }}
      >
        {GNSS_RISK_BANDS.map((band) => {
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
      {watch.alert ? (
        <div className={`${styles.alert} banner banner-alert`} role="alert">
          <strong>GNSS risk alert.</strong> {watch.alert}
          {watch.observedLabel ? ` Snapshot ${watch.observedLabel}.` : ""}
        </div>
      ) : (
        <p className={styles.quiet}>
          {watch.label
            ? `No GNSS risk alert. The label is ${watch.label}. The warning starts at High.`
            : "The GNSS risk label is not in this snapshot, so no warning is issued."}
        </p>
      )}
      {watch.episodes.length > 0 && (
        <ul className={styles.list}>
          {watch.episodes.map((episode) => (
            <li key={`${episode.timeLabel}-${episode.score}`}>
              <span className={styles.listClass}>{episode.label}</span>
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
