"use client";

import { useEffect, useState } from "react";
import { getSolarBrief, type SolarBriefResponse } from "@/lib/api";
import type { SolarActivityFull } from "@/lib/types";
import styles from "./FlareActivityTable.module.css";
import { startVisiblePolling } from "@/lib/visiblePolling";

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

export default function FlareActivityTable({ solar, summaryOnly = false }: { solar: SolarActivityFull | null; summaryOnly?: boolean }) {
  const [brief, setBrief] = useState<SolarBriefResponse | null>(null);
  const [failed, setFailed] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [utcDay, setUtcDay] = useState(() => new Date().toISOString().slice(0, 10));

  useEffect(() => {
    let cancelled = false;
    let first = true;
    const stop = startVisiblePolling(async () => {
      setRefreshing(true);
      setUtcDay(new Date().toISOString().slice(0, 10));
      await getSolarBrief(first && refresh > 0)
      .then((payload) => {
        if (!cancelled) { setBrief(payload); setFailed(false); }
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
      first = false;
      if (!cancelled) setRefreshing(false);
    }, 60_000);
    return () => {
      cancelled = true;
      stop();
    };
  }, [refresh]);

  const loading = !brief && !failed;
  const flare = brief?.latest_flare_class?.trim() || null;
  const events = summaryOnly ? undefined : brief?.sun_events?.filter(event => event.date.replaceAll("/", "-") === utcDay)
    .slice().sort((a, b) => a.maximum.localeCompare(b.maximum));
  const counts = { C: 0, M: 0, X: 0 };
  let strongest = "";
  const rank = (label: string) => "ABCMX".indexOf(label[0]?.toUpperCase()) * 1000 + (Number(label.slice(1)) || 0);
  for (const event of events ?? []) {
    const letter = event.flare_class[0] as keyof typeof counts;
    if (letter in counts) counts[letter]++;
    if (!strongest || rank(event.flare_class) > rank(strongest)) strongest = event.flare_class;
  }
  const stale = failed || !brief?.updated_utc || Date.now() - Date.parse(brief.updated_utc) > 10 * 60_000;
  const flareClass = {
    A: styles.flareA,
    B: styles.flareB,
    C: styles.flareC,
    M: styles.flareM,
    X: styles.flareX,
  };

  return (
    <section className={styles.panel} aria-label="Are there solar flares today?">
      {summaryOnly && <>
        <h2 className={styles.section}>Solar Flare (GOES X-Ray)</h2>
        <p className={styles.eventsNote}>Current GOES class · {solar?.flare_class?.trim() || "Unavailable"}</p>
      </>}
      {summaryOnly ? <h3 className={styles.title}>Solar flares on {utcDay} UTC</h3> : <h2 className={styles.title}>Solar flares on {utcDay} UTC</h2>}
      <p className={styles.eventsNote}>Updates automatically every minute · NOAA data may be cached for up to five minutes.
        {" "}<button type="button" className="btn" disabled={refreshing} onClick={() => setRefresh(value => value + 1)}>{refreshing ? "Updating…" : "Refresh now"}</button>
      </p>
      <p className={styles.eventsNote} role="status">Last successful source fetch: {brief?.updated_utc?.replace("T", " ").replace("Z", " UTC") ?? "Not yet available"}{stale && !loading ? " · Update unavailable or stale; retained values are not confirmed current." : ""}</p>
      <h3 className={styles.section}>Current activity</h3>
      <div className={styles.grid}>
        <Cell label="Active regions" value={countText(brief?.earth_facing_region_count, loading)} />
        <Cell label="Visible sunspots" value={countText(brief?.visible_spot_count, loading)} />
        <Cell label="Latest flare" value={loading ? "Updating…" : flare || "Unavailable"} />
        <Cell label="Current X-ray flux" value={fluxText(solar?.flux)} />
      </div>

      {!summaryOnly && <div className={styles.events}>
        <div className={styles.eventsHead}>
          <h3 className={styles.eventsTitle}>Today’s GOES flare analysis</h3>
          <span className={styles.eventsUtc}>All times in UTC</span>
        </div>
        {loading ? (
          <p className={styles.eventsNote}>Updating…</p>
        ) : events == null ? (
          <p className={styles.eventsNote}>Unavailable</p>
        ) : events.length === 0 ? (
          <p className={styles.eventsNote}>No solar X-ray flare events are listed for today in the latest available NOAA response.</p>
        ) : (
          <div className={styles.eventsScroll}>
            <table className={styles.eventsTable}>
              <thead>
                <tr>
                  <th scope="col">Solar flare</th>
                  <th scope="col">Region of origin</th>
                  <th scope="col">Start time (UT)</th>
                  <th scope="col">End time (UT)</th>
                  <th scope="col">Peak time (UT)</th>
                  <th scope="col">Duration (min)</th>
                </tr>
              </thead>
              <tbody>
                {events.map((event) => (
                  <tr className={/^[MX]/i.test(event.flare_class) ? styles.significant : undefined} key={`${event.date}-${event.maximum}-${event.flare_class}`}>
                    <td><span className={`${styles.flare} ${flareClass[flareTone(event.flare_class)]}`}>{event.flare_class}</span></td>
                    <td>
                      <span className={event.region ? styles.region : styles.regionEmpty}>
                        {event.region ?? "–"}
                      </span>
                    </td>
                    <td className={styles.clock}>{event.start ?? "–"}</td>
                    <td className={styles.clock}>{event.end ?? "–"}</td>
                    <td className={styles.clock}>{event.maximum}</td>
                    <td className={styles.clock}>{event.duration_minutes ?? "–"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {events != null && events.length > 0 && <p className={styles.eventsNote}>
          {events.length} listed flare event(s) today: {counts.C} C, {counts.M} M and {counts.X} X. Strongest listed flare: <strong>{strongest}</strong>.
          {" "}M- and X-class events are highlighted. A flare’s X-rays can affect the sunlit ionosphere; this table alone does not establish a TEC disturbance in Zimbabwe.
        </p>}
        <p className={styles.eventsSource}>
          Source: <a href="https://services.swpc.noaa.gov/json/goes/primary/xray-flares-7-day.json" target="_blank" rel="noreferrer">NOAA SWPC GOES X-ray flare list</a>, with region numbers from the NOAA edited event file. Times are UTC. Duration is end minus start, including events crossing midnight; missing source fields remain blank (–). The instantaneous GOES class above is separate from an event’s peak class.
        </p>
      </div>}
    </section>
  );
}
