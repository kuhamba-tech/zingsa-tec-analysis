"use client";

import { useMemo } from "react";
import { buildFlareWatch, flareGuideParagraphs, type FlareLetter } from "@/lib/flareEruption";
import type { SolarActivityFull } from "@/lib/types";
import { FLARE_SCALE } from "@/lib/solarEventColors";
import styles from "./FlareClassMonitor.module.css";

const ORDER: FlareLetter[] = ["A", "B", "C", "M", "X"];

export default function FlareClassMonitor({
  solar,
  now = Date.now(),
}: {
  solar: SolarActivityFull | null;
  now?: number;
}) {
  const watch = useMemo(() => buildFlareWatch(solar, now), [solar, now]);
  const guide = useMemo(() => flareGuideParagraphs(watch), [watch]);
  const alert = watch.alert;

  return (
    <section className={`card ${styles.panel}`} aria-label="Flare class monitor">
      <h2 className={styles.title}>Flare class monitor</h2>
      <p className={styles.now}>
        X-ray level now:{" "}
        <strong style={{ color: watch.currentLetter ? undefined : "var(--text-muted)" }}>
          {watch.currentClass ?? "Updating"}
        </strong>
        . GOES 0.1–0.8 nm.
      </p>
      <div className={styles.scale} role="list" aria-label="Flare classes in this feed">
        {ORDER.map((letter) => {
          const tone = FLARE_SCALE.find((item) => item.cls === letter);
          const active = watch.currentLetter === letter || alert?.letter === letter;
          return (
            <div
              key={letter}
              role="listitem"
              className={`${styles.step}${active ? ` ${styles.stepOn}` : ""}`}
              style={{ color: tone?.color }}
            >
              <span className={styles.letter}>{letter}</span>
              <span className={styles.count}>{watch.counts[letter]}</span>
              <span className={styles.desc}>{tone?.desc}</span>
            </div>
          );
        })}
      </div>
      {alert ? (
        <div className={`${styles.alert} banner banner-alert`} role="alert">
          <strong>Flare alert.</strong> GOES measured a {alert.classText} flare. The soft X-ray peak was{" "}
          {alert.peakLabel}.
        </div>
      ) : (
        <p className={styles.quiet}>
          {watch.latest
            ? `No C, M, or X flare has peaked in the last 48 hours. The newest listed flare is ${watch.latest.classText} at ${watch.latest.peakLabel}.${
                watch.lastSignificant
                  ? ` The last C-class or larger flare in this feed is ${watch.lastSignificant.classText} at ${watch.lastSignificant.peakLabel}.`
                  : ""
              }`
            : "No flare peak is in the current GOES list, so no eruption alert is issued."}
        </p>
      )}
      {watch.recent.length > 0 && (
        <ul className={styles.list}>
          {watch.recent.map((peak) => (
            <li key={`${peak.classText}-${peak.peakMs}`}>
              <span className={styles.listClass}>{peak.classText}</span>
              <span>{peak.peakLabel}</span>
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
