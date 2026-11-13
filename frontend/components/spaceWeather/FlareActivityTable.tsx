"use client";

import { useEffect, useState } from "react";
import { getSolarBrief, type SolarBriefResponse } from "@/lib/api";
import type { SolarActivityFull } from "@/lib/types";
import styles from "./FlareActivityTable.module.css";

const SUPERSCRIPTS = "⁰¹²³⁴⁵⁶⁷⁸⁹";

function superscript(value: number): string {
  const sign = value < 0 ? "⁻" : "";
  const digits = String(Math.abs(value)).replace(/\d/g, (digit) => SUPERSCRIPTS[Number(digit)] ?? digit);
  return `${sign}${digits}`;
}

function fluxText(flux: number | null | undefined): string {
  if (flux == null || !Number.isFinite(flux) || flux <= 0) return "Unavailable";
  const [mantissa, exponent] = flux.toExponential(1).split("e");
  const power = Number(exponent);
  if (!mantissa || !Number.isFinite(power)) return "Unavailable";
  return `${mantissa}×10${superscript(power)} W/m²`;
}

function countText(value: number | null | undefined, loading: boolean): string {
  if (loading) return "Updating…";
  if (value == null || !Number.isFinite(value)) return "Unavailable";
  return String(value);
}

function Cell({ label, value }: { label: string; value: string }) {
  return (
    <div className={styles.cell}>
      <span className={styles.dot} aria-hidden />
      <div className={styles.label}>{label}</div>
      <div className={styles.value}>{value}</div>
    </div>
  );
}

function flareTone(label: string): "A" | "B" | "C" | "M" | "X" {
  const letter = label.trim().slice(0, 1).toUpperCase();
  if (letter === "X" || letter === "M" || letter === "C" || letter === "B" || letter === "A") {
    return letter;
  }
  return "A";
}

export default function FlareActivityTable({ solar }: { solar: SolarActivityFull | null }) {
  const [brief, setBrief] = useState<SolarBriefResponse | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getSolarBrief()
      .then((payload) => {
        if (!cancelled) setBrief(payload);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const loading = !brief && !failed;
  const flare = brief?.latest_flare_class?.trim() || null;
  const events = brief?.sun_events;
  const flareClass = {
    A: styles.flareA,
    B: styles.flareB,
    C: styles.flareC,
    M: styles.flareM,
    X: styles.flareX,
  };

  return (
    <section className={styles.panel} aria-label="Are there solar flares today?">
      <h2 className={styles.title}>Are There Solar Flares Today?</h2>
      <h3 className={styles.section}>Current activity</h3>
      <div className={styles.grid}>
        <Cell label="Active regions" value={countText(brief?.earth_facing_region_count, loading)} />
        <Cell label="Visible sunspots" value={countText(brief?.visible_spot_count, loading)} />
        <Cell label="Latest flare" value={loading ? "Updating…" : flare || "Unavailable"} />
        <Cell label="Current X-ray flux" value={fluxText(solar?.flux)} />
      </div>

      <div className={styles.events}>
        <div className={styles.eventsHead}>
          <h3 className={styles.eventsTitle}>Events on the Sun past 24 hours</h3>
          <span className={styles.eventsUtc}>All times in UTC</span>
        </div>
        {loading ? (
          <p className={styles.eventsNote}>Updating…</p>
        ) : events == null ? (
          <p className={styles.eventsNote}>Unavailable</p>
        ) : events.length === 0 ? (
          <p className={styles.eventsNote}>No solar X-ray flares were recorded in the past 24 hours.</p>
        ) : (
          <div className={styles.eventsScroll}>
            <table className={styles.eventsTable}>
              <thead>
                <tr>
                  <th scope="col">Date</th>
                  <th scope="col">Region</th>
                  <th scope="col">Solar flare</th>
                  <th scope="col">Start</th>
                  <th scope="col">Maximum</th>
                  <th scope="col">End</th>
                </tr>
              </thead>
              <tbody>
                {events.map((event) => (
                  <tr key={`${event.date}-${event.maximum}-${event.flare_class}`}>
                    <td>{event.date}</td>
                    <td>
                      <span className={event.region ? styles.region : styles.regionEmpty}>
                        {event.region ?? "–"}
                      </span>
                    </td>
                    <td>
                      <span className={`${styles.flare} ${flareClass[flareTone(event.flare_class)]}`}>
                        {event.flare_class}
                      </span>
                    </td>
                    <td className={styles.clock}>{event.start ?? "–"}</td>
                    <td className={styles.clock}>{event.maximum}</td>
                    <td className={styles.clock}>{event.end ?? "–"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className={styles.eventsSource}>
          Source: NOAA SWPC GOES X-ray flare list, with region numbers from the NOAA edited event file.
        </p>
      </div>
    </section>
  );
}
