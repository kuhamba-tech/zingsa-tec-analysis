"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { getScientificUpdates } from "@/lib/api";
import type { ScientificDiscussion, SolarActivityFull } from "@/lib/types";
import { scientificEvents, scientificSnapshot, utcLabel } from "@/lib/scientificUpdate";
import { bulletinZimbabweReading, type SwpcBulletin } from "@/lib/swpcBulletin";
import { observationEpoch } from "@/lib/monitoringStatus";
import { ZIMBABWE_TRANSLATION } from "@/lib/scientistBulletin";
import SwSectionBanner from "./SwSectionBanner";
import styles from "./ScientificSpaceWeatherUpdates.module.css";

const BULLETIN_CAP = 8;

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function bulletinOf(alert: Record<string, unknown>): SwpcBulletin {
  const raw = alert.bulletin;
  return raw && typeof raw === "object" ? (raw as SwpcBulletin) : {};
}

function kindOf(bulletin: SwpcBulletin, headline: string): string {
  const raw = (bulletin.kind || headline.split(":")[0] || "Bulletin").trim();
  return raw.replace(/\s+/g, " ");
}

function substance(headline: string, kind: string): string {
  const stripped = headline.replace(new RegExp(`^${kind.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*:\\s*`, "i"), "");
  return stripped.trim() || headline;
}

function kindTone(kind: string): string {
  const value = kind.toUpperCase();
  if (value.includes("CANCEL")) return styles.kindCancel;
  if (value.includes("WARNING")) return styles.kindWarning;
  if (value.includes("ALERT")) return styles.kindAlert;
  if (value.includes("WATCH")) return styles.kindWatch;
  if (value.includes("SUMMARY")) return styles.kindSummary;
  return styles.kindWatch;
}

export default function ScientificSpaceWeatherUpdates({ solar }: { solar: SolarActivityFull | null }) {
  const [discussion, setDiscussion] = useState<ScientificDiscussion | null>(null);
  const [now, setNow] = useState(0);
  useEffect(() => {
    let active = true;
    let loading = false;
    async function refresh() {
      if (loading) return;
      loading = true;
      try {
        const value = await getScientificUpdates();
        if (active) setDiscussion(value);
      } catch {
        if (active) setDiscussion(previous => previous ? { ...previous, status:"stale", note:"Refresh failed. Retained text is not verified as the latest guidance." } : {source:"NOAA SWPC",source_url:"https://services.swpc.noaa.gov/text/discussion.txt",status:"unavailable",note:"Official discussion unavailable. No forecast is substituted."});
      } finally { loading = false; }
    }
    setNow(Date.now());
    void refresh();
    const clock = setInterval(()=>setNow(Date.now()),60_000);
    const poll = setInterval(()=>{if(!document.hidden) void refresh();},180_000);
    return ()=>{active=false;clearInterval(clock);clearInterval(poll);};
  }, []);
  const snapshots = scientificSnapshot(solar, now);
  const events = scientificEvents(solar, now);
  const bulletins = useMemo(() => {
    const alerts = [...(solar?.alerts ?? [])].sort(
      (a, b) =>
        (observationEpoch(text(b.issue_datetime) ?? text(bulletinOf(b).issue_time)) ?? 0) -
        (observationEpoch(text(a.issue_datetime) ?? text(bulletinOf(a).issue_time)) ?? 0),
    );
    const seen = new Set<string>();
    const rows = [];
    for (const alert of alerts) {
      const bulletin = bulletinOf(alert);
      const code = text(bulletin.code) ?? text(alert.product_id) ?? "NOAA bulletin";
      const serial = text(bulletin.serial);
      const key: string = `${code}-${serial ?? text(alert.issue_datetime) ?? rows.length}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const headline = text(bulletin.headline) ?? code;
      const kind = kindOf(bulletin, headline);
      rows.push({
        key,
        code,
        serial,
        kind,
        tone: kindTone(kind),
        title: substance(headline, kind),
        issued: text(bulletin.issue_time) ?? text(alert.issue_datetime) ?? "Issue time unavailable",
        validFrom: text(bulletin.valid_from),
        validTo: text(bulletin.valid_to),
        condition: text(bulletin.condition),
        scale: text(bulletin.noaa_scale),
        serialNote: [
          bulletin.continuation_of ? `Continues serial ${bulletin.continuation_of}` : "",
          bulletin.extension_to ? `Extends serial ${bulletin.extension_to}` : "",
        ].filter(Boolean).join(" · "),
        reading: bulletinZimbabweReading(bulletin),
      });
    }
    return rows;
  }, [solar]);
  const shown = bulletins.slice(0, BULLETIN_CAP);
  const stale = discussion?.status !== "current" || !discussion.issued_at || now-Date.parse(discussion.issued_at)>18*3600_000;
  return <section className={`card ${styles.panel}`} aria-labelledby="scientific-updates-title">
    <SwSectionBanner
      title="Scientific space-weather updates"
      titleId="scientific-updates-title"
      meta={<span className={styles.badge}>Automatically assembled</span>}
    />
    <p className={styles.kicker}>Research briefing · Sun → solar wind → geospace → Zimbabwe</p>
    <p>Each card keeps the bureau fields (code, serial, issue time, validity, scale) and then states what the product means for Zimbabwe TEC and S4.</p>
    <p className={styles.meta}>Brief assembled: {now ? utcLabel(new Date(now).toISOString()) : "Preparing…"}. Instrument sample times appear on each card.</p>
    <div className={styles.grid}>{snapshots.map(s=><article className={styles.observation} key={s.title}>
      <div className={styles.cardTop}>
        <span className={styles.tag}>Observation</span>
        <span className={styles.code}>{s.source}</span>
      </div>
      <h3>{s.title}</h3>
      <dl className={styles.facts}>
        <div><dt>Sample</dt><dd>{utcLabel(s.time)}</dd></div>
        <div><dt>Reading</dt><dd>{s.reading}</dd></div>
      </dl>
      <h4>What this means</h4>
      <p>{s.meaning}</p>
      <h4>Scientific explanation</h4>
      <p>{s.explanation}</p>
    </article>)}</div>
    <section className={styles.discussion} aria-label="NOAA alerts, watches and warnings">
      <SwSectionBanner as="h3" title="Alerts, watches and warnings" />
      <p className={styles.meta}>
        Structured from the NOAA SWPC feed
        {bulletins.length ? ` · ${bulletins.length} bulletin${bulletins.length === 1 ? "" : "s"}` : ""}.
        The scientific note is the Zimbabwe reading. The bureau impact text stays on the source page.
      </p>
      {shown.length ? <div className={styles.grid}>{shown.map(row => <article className={`${styles.observation} ${row.tone}`} key={row.key}>
        <div className={styles.cardTop}>
          <span className={styles.tag}>{row.kind}</span>
          <span className={styles.code}>{row.code}{row.serial ? ` · serial ${row.serial}` : ""}</span>
        </div>
        <h3>{row.title}</h3>
        <p className={styles.issued}>Issued {row.issued}</p>
        <dl className={styles.facts}>
          {row.validFrom ? <div><dt>Valid from</dt><dd>{row.validFrom}</dd></div> : null}
          {row.validTo ? <div><dt>Valid to</dt><dd>{row.validTo}</dd></div> : null}
          {row.condition ? <div><dt>Condition</dt><dd>{row.condition}</dd></div> : null}
          {row.scale ? <div><dt>NOAA scale</dt><dd>{row.scale}</dd></div> : null}
          {row.serialNote ? <div><dt>Series</dt><dd>{row.serialNote}</dd></div> : null}
        </dl>
        <h4>What this means</h4>
        <p>{row.reading.meaning}</p>
        <h4>Scientific explanation</h4>
        <p>{row.reading.explanation}</p>
      </article>)}</div> : <p>No NOAA bulletins in this response. The instrument cards above still show the latest samples.</p>}
      {bulletins.length > shown.length ? <p className={styles.meta}>{`${bulletins.length - shown.length} earlier ${bulletins.length - shown.length === 1 ? "bulletin is" : "bulletins are"} on the alerts page.`}</p> : null}
      <p className={styles.links}>
        <Link href="/storm-watch/">Open the full alerts page</Link>
        <a href="https://www.swpc.noaa.gov/products/alerts-watches-and-warnings" target="_blank" rel="noopener noreferrer">NOAA alerts, watches and warnings</a>
      </p>
    </section>
    <section className={styles.discussion} aria-label="Official forecast discussion">
      <h2>NOAA forecaster discussion <span className={styles.tag}>{discussion ? stale ? "Stale / not current" : "Current issue" : "Loading"}</span></h2>
      <p className={styles.meta}>Issued: {utcLabel(discussion?.issued_at)} · Retrieved: {utcLabel(discussion?.checked_at)}.</p>
      <p>{discussion?.note ?? "Retrieving the official discussion; no forecast is assumed while loading."}</p>
      {stale && discussion?.sections?.length ? <p role="status">This issue is not verified as current. Its forecast text is retained for reference.</p> : null}
      <div className={styles.grid}>{discussion?.sections?.map(s=><details key={s.topic} className={styles.topic} open={s.topic==="Solar Activity"}>
        <summary>{s.topic}</summary>
        <h4>Observed · NOAA 24-hour summary</h4><p>{s.observed || "Summary not supplied."}</p>
        <h4>{stale ? "Forecast in retained issue" : "Forecast · NOAA guidance"}</h4><p>{s.forecast || "Forecast not supplied."}</p>
      </details>)}</div>
      <a href="https://services.swpc.noaa.gov/text/discussion.txt" target="_blank" rel="noopener noreferrer">Read the original NOAA discussion</a>
    </section>
    <details className={styles.discussion}>
      <summary>Recent event chronology · catalogue observations and analyses</summary>
      <p className={styles.meta}>Catalogue coverage: {solar?.donki_date_start || "unknown"} to {solar?.donki_date_end || "unknown"}. Entries can be delayed, incomplete or revised; absence is not proof that no event occurred.</p>
      {events.length ? <ol className={styles.events}>{events.map((e,i)=><li key={`${e.id}-${i}`}>
        <time>{utcLabel(e.time)}</time><h4>{e.title}</h4><p>{e.detail}</p><span className={styles.meta}>{e.kind} · {e.source}</span>
      </li>)}</ol> : <p>No timestamped catalogue events available in this response.</p>}
    </details>
    <aside className={styles.local}><h2>Zimbabwe research interpretation</h2><p>{ZIMBABWE_TRANSLATION}</p>
      <p>Use the Zimbabwe Ionospheric Response tab for station coverage, local TEC and gradients. A local anomaly requires an appropriate baseline; GNSS impact requires measured receiver performance. The official global forecast does not supply a validated local RTK working window.</p></aside>
    <nav className={styles.sources} aria-label="Scientific update sources">
      <a href="https://www.spaceweather.gov/products/forecast-discussion" target="_blank" rel="noopener noreferrer">NOAA discussion methodology</a>
      <a href="https://services.swpc.noaa.gov/json/goes/primary/xrays-1-day.json" target="_blank" rel="noopener noreferrer">GOES X-rays</a>
      <a href="https://kauai.ccmc.gsfc.nasa.gov/DONKI/" target="_blank" rel="noopener noreferrer">NASA DONKI catalogue</a>
      <a href="https://solarham.com/news_current_month.htm" target="_blank" rel="noopener noreferrer">SolarHam updates · independent commentary</a>
    </nav>
    <p className={styles.meta}>SolarHam informed the dated-update format. These notes use the measurements and official guidance identified above; SolarHam articles are not reproduced or treated as instrument data.</p>
  </section>;
}
