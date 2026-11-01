"use client";

import { useMemo } from "react";
import { buildDstWatch, DST_BANDS, dstGuideParagraphs, formatDstNt } from "@/lib/dstWatch";
import type { SpaceWeatherCurrent, TimelinePoint } from "@/lib/types";
import styles from "./FlareClassMonitor.module.css";

export default function DstClassMonitor({
  sw,
  points,
}: {
  sw: SpaceWeatherCurrent | null;
  points?: TimelinePoint[] | null;
}) {
  const watch = useMemo(() => buildDstWatch(sw, points), [sw, points]);
  const guide = useMemo(() => dstGuideParagraphs(watch), [watch]);

  return (
    <section className={`card ${styles.panel}`} aria-label="Dst class monitor">
      <h2 className={styles.title}>Dst class monitor</h2>
      <p className={styles.now}>
        Dst now:{" "}
        <strong>{watch.dst != null ? `${formatDstNt(watch.dst)} nT` : "Updating"}</strong>
        {watch.bandLabel ? ` · ${watch.bandLabel}` : ""}. NOAA / Kyoto Dst.
      </p>
      <div className={styles.scale} role="list" aria-label="Dst classes in this series">
        {DST_BANDS.map((band) => {
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
          <strong>Dst alert.</strong> {watch.alert}
          {watch.observedLabel ? ` Snapshot ${watch.observedLabel}.` : ""}
        </div>
      ) : (
        <p className={styles.quiet}>
          {watch.dst != null
            ? `No Dst alert. Dst is ${formatDstNt(watch.dst)} nT, class ${watch.bandLabel}. The watch starts at −30 nT and a storm reading begins at −50 nT.`
            : "Dst is not in the current index snapshot, so no ring-current alert is issued."}
        </p>
      )}
      {watch.episodes.length > 0 && (
        <ul className={styles.list}>
          {watch.episodes.map((episode) => (
            <li key={`${episode.timeLabel}-${episode.dst}`}>
              <span className={styles.listClass}>{episode.label} · {formatDstNt(episode.dst)} nT</span>
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
