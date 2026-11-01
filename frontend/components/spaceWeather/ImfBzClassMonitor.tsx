"use client";

import { useMemo } from "react";
import { buildImfBzWatch, BZ_BANDS, imfBzGuideParagraphs } from "@/lib/imfBzWatch";
import type { SolarActivityFull, TimelinePoint } from "@/lib/types";
import styles from "./FlareClassMonitor.module.css";

function signed(value: number): string {
  return `${value >= 0 ? "+" : ""}${value.toFixed(1)}`;
}

export default function ImfBzClassMonitor({
  solar,
  points,
}: {
  solar: SolarActivityFull | null;
  points?: TimelinePoint[] | null;
}) {
  const watch = useMemo(() => buildImfBzWatch(solar, points), [solar, points]);
  const guide = useMemo(() => imfBzGuideParagraphs(watch), [watch]);

  return (
    <section className={`card ${styles.panel}`} aria-label="IMF Bz class monitor">
      <h2 className={styles.title}>IMF Bz class monitor</h2>
      <p className={styles.now}>
        Bz now:{" "}
        <strong>{watch.bz != null ? `${signed(watch.bz)} nT` : "Updating"}</strong>
        {watch.bandLabel ? ` · ${watch.bandLabel}` : ""}. NOAA SWPC RTSW.
      </p>
      <div className={styles.scale} role="list" aria-label="IMF Bz classes in this series">
        {BZ_BANDS.map((band) => {
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
          <strong>IMF Bz alert.</strong> {watch.alert}
          {watch.observedLabel ? ` Sample ${watch.observedLabel}.` : ""}
        </div>
      ) : (
        <p className={styles.quiet}>
          {watch.bz != null
            ? `No IMF Bz alert. Bz is ${signed(watch.bz)} nT, class ${watch.bandLabel}. The coupling alert starts at −5 nT.`
            : "IMF Bz is not in the current feed, so no field alert is issued."}
        </p>
      )}
      {watch.episodes.length > 0 && (
        <ul className={styles.list}>
          {watch.episodes.map((episode) => (
            <li key={`${episode.timeLabel}-${episode.bz}`}>
              <span className={styles.listClass}>Coupling · {signed(episode.bz)} nT</span>
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
