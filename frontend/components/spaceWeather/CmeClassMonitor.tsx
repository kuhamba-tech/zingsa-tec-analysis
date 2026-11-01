"use client";

import { useMemo } from "react";
import { buildCmeWatch, CME_BANDS, cmeGuideParagraphs } from "@/lib/cmeWatch";
import type { SolarActivityFull } from "@/lib/types";
import styles from "./FlareClassMonitor.module.css";

export default function CmeClassMonitor({
  solar,
  now = Date.now(),
}: {
  solar: SolarActivityFull | null;
  now?: number;
}) {
  const watch = useMemo(() => buildCmeWatch(solar, now), [solar, now]);
  const guide = useMemo(() => cmeGuideParagraphs(watch), [watch]);

  return (
    <section className={`card ${styles.panel}`} aria-label="CME class monitor">
      <h2 className={styles.title}>CME class monitor</h2>
      <p className={styles.now}>
        Newest CME:{" "}
        <strong>{watch.newest ? watch.newest.label : "None in this window"}</strong>
        . {watch.sourceLabel}.
      </p>
      <div className={styles.scale} role="list" aria-label="CME classes in this window">
        {CME_BANDS.map((band) => {
          const active = watch.newest?.band === band.id;
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
          <strong>CME alert.</strong> The catalog records {watch.alert.label}
          {watch.alert.speed != null ? ` at ${Math.round(watch.alert.speed)} km/s` : ""}, starting {watch.alert.timeLabel}. Earth-directed plasma can still be in transit.
        </div>
      ) : (
        <p className={styles.quiet}>
          {watch.newest
            ? `No CME alert. The newest ejection is ${watch.newest.label}, at ${watch.newest.timeLabel}. A catalog count does not set the direction.`
            : "No coronal mass ejection is in this window, so no CME alert is issued."}
        </p>
      )}
      {watch.recent.length > 0 && (
        <ul className={styles.list}>
          {watch.recent.map((event) => (
            <li key={`${event.band}-${event.timeMs}`}>
              <span className={styles.listClass}>
                {event.label}{event.speed != null ? ` · ${Math.round(event.speed)} km/s` : ""}
              </span>
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
