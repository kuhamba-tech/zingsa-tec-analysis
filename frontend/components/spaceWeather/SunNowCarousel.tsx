"use client";

import { useEffect, useState } from "react";
import styles from "./SunNowCarousel.module.css";

/** Slides from https://sdo.gsfc.nasa.gov/#carouselExampleIndicators */
const SLIDES = [
  { file: "latest_512_0193.jpg", title: "AIA 0193" },
  { file: "latest_512_0171.jpg", title: "AIA 0171" },
  { file: "latest_512_0304.jpg", title: "AIA 0304" },
  { file: "latest_512_0211.jpg", title: "AIA 0211" },
  { file: "latest_512_0131.jpg", title: "AIA 0131" },
  { file: "latest_512_0335.jpg", title: "AIA 0335" },
  { file: "latest_512_0094.jpg", title: "AIA 094" },
  { file: "latest_512_1600.jpg", title: "AIA 1600" },
  { file: "latest_512_1700.jpg", title: "AIA 1700" },
  { file: "latest_1024_211193171.jpg", title: "AIA 211, 193, 171" },
  { file: "f_304_211_171_512.jpg", title: "AIA 304, 211, 171" },
  { file: "f_094_335_193_512.jpg", title: "AIA 094, 335, 193" },
  { file: "f_HMImag_171_512.jpg", title: "AIA 171 & HMIB" },
  { file: "latest_512_HMIB.jpg", title: "HMI Magnetogram" },
  { file: "latest_512_HMII.jpg", title: "HMI Intensitygram" },
  { file: "latest_512_HMID.jpg", title: "HMI Dopplergram" },
] as const;

const IMAGE_ROOT = "https://sdo.gsfc.nasa.gov/assets/img/latest/";
const SOURCE = "https://sdo.gsfc.nasa.gov/#carouselExampleIndicators";

export default function SunNowCarousel() {
  const [index, setIndex] = useState(0);
  const [shown, setShown] = useState(0);
  const [paused, setPaused] = useState(false);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState<Record<number, boolean>>({});
  const [stamp, setStamp] = useState(() => Math.floor(Date.now() / 900_000));
  const slide = SLIDES[shown];
  const src = `${IMAGE_ROOT}${slide.file}?v=${stamp}`;

  useEffect(() => {
    const refresh = window.setInterval(() => {
      setStamp(Math.floor(Date.now() / 900_000));
      setFailed({});
    }, 15 * 60 * 1000);
    return () => window.clearInterval(refresh);
  }, []);

  useEffect(() => {
    let cancel = false;
    setReady(false);
    const incoming = SLIDES[index];
    const preload = new Image();
    preload.onload = () => {
      if (cancel) return;
      setShown(index);
      setReady(true);
    };
    preload.onerror = () => {
      if (cancel) return;
      setFailed((current) => ({ ...current, [index]: true }));
      setReady(false);
    };
    preload.src = `${IMAGE_ROOT}${incoming.file}?v=${stamp}`;
    return () => {
      cancel = true;
    };
  }, [index, stamp]);

  useEffect(() => {
    if (paused || !ready) return;
    const timer = window.setTimeout(() => {
      setIndex((current) => (current + 1) % SLIDES.length);
    }, 6000);
    return () => window.clearTimeout(timer);
  }, [paused, ready, index]);

  const step = (delta: number) => {
    setIndex((current) => (current + delta + SLIDES.length) % SLIDES.length);
  };

  return (
    <section
      className={styles.card}
      aria-label="The Sun Now"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
    >
      <div className={styles.header}>The Sun Now</div>
      <div className={styles.frame}>
        {failed[shown] && failed[index] ? (
          <p className={styles.missing}>This SDO frame could not be loaded.</p>
        ) : (
          <img
            key={`${slide.file}-${stamp}`}
            src={src}
            alt={`${slide.title} from NASA SDO, The Sun Now`}
          />
        )}
        <p className={styles.caption}>{slide.title}</p>
        <button type="button" className={styles.prev} onClick={() => step(-1)} aria-label="Previous solar image">
          ‹
        </button>
        <button type="button" className={styles.next} onClick={() => step(1)} aria-label="Next solar image">
          ›
        </button>
      </div>
      <p className={styles.source}>
        <a href={SOURCE} target="_blank" rel="noopener noreferrer">
          NASA SDO · The Sun Now
        </a>
      </p>
    </section>
  );
}
